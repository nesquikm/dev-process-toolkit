---
name: docs
description: Generate or update project docs (requires /setup --docs first). One of --quick, --commit, --full. `--quick` stages a fragment per FR; `--commit` merges staged fragments with human approval; `--full` regenerates the canonical docs/ tree from scratch.
argument-hint: '<--quick | --commit | --full>'
---

# Generate or update docs (STE-70)

Run doc generation at the cadence that matches your current need. The three flags are **mutually exclusive**:

- `--quick` — write one fragment to `docs/.pending/<fr-id>.md` describing the current working-tree diff. Non-destructive. Invoked by `/implement` Phase 4 and manually between FRs.
- `--commit` — merge staged fragments into canonical `docs/`, show a unified diff, require explicit approval, write on approval, delete merged fragments.
- `--full` — regenerate the entire canonical `docs/` tree from specs + source + config. Highest token cost. Used by `/ship-milestone` and manually when fragment drift has accumulated.

Extended reference (LLM prompts verbatim, merge algorithm pseudocode, per-section examples) lives in `plugins/dev-process-toolkit/docs/docs-reference.md` per NFR-1 (AC-STE-70.7).

## Process

### 0. Shared preflight

Run these checks regardless of flag.

**(a) DocsConfig gate (AC-STE-70.6).** Call `readDocsConfig(CLAUDE.md)` from `adapters/_shared/src/docs_config.ts`. When **both** `userFacingMode` and `packagesMode` are `false` — or the `## Docs` section is absent entirely — refuse with the NFR-10 canonical shape:

```
/docs: docs generation is not configured for this project.
Remedy: run /setup to answer the three docs-mode prompts. At least one of user_facing_mode or packages_mode must be true.
Context: mode=<tracker-mode>, docs=disabled, skill=docs
```

Exit non-zero. Applies to all three flags; no flag bypasses this gate.

**(b) Flag parse (AC-STE-70.2).** Collect the flags passed in `$ARGUMENTS`:

- **Zero flags** — print the usage block from the top of this file and exit `0` (not an error — helps discovery).
- **Exactly one** of `--quick`, `--commit`, `--full` — proceed to that flow.
- **Two or more** — refuse with the NFR-10 canonical shape:

  ```
  /docs: flags --quick, --commit, and --full are mutually exclusive; got <list-of-passed-flags>.
  Remedy: pick exactly one. /docs --quick writes a fragment; --commit merges pending fragments; --full regenerates from scratch.
  Context: mode=<docs-mode>, skill=docs
  ```

### 1. `/docs --quick` (AC-STE-70.3, AC-STE-71.*)

Writes exactly one fragment to `docs/.pending/<fr-id>.md` and exits. Non-destructive beyond the single file write.

1. **Compute the ImpactSet** — call `computeImpactSet({ mode: "working-tree", projectRoot })` from `adapters/_shared/src/impact_set.ts`. Filter to public symbols via `filterPublicSymbols(impactSet)` (AC-STE-71.5).
2. **Empty-set no-op (AC-STE-71.6).** If `isEmptyImpactSet(publicSet)` is true, print the literal line `no doc-relevant changes detected — fragment not written` and exit `0`. Do not create an empty fragment.
3. **Resolve `<fr-id>`.** If `branch_template:` in `CLAUDE.md` maps the current branch to a tracker ID or ULID, use that. Otherwise, pick the most-recent FR whose file appears in the diff (git-log it). If neither resolves, use `_unbound-<UTC-timestamp>.md` (AC-STE-70.3) and include a `warning:` line in the fragment body.
4. **Render the fragment.** Use the LLM prompt in `docs/docs-reference.md` § Quick-fragment prompt; the prompt pins `publicSet` as authoritative and includes the NFR-22-enforced verbatim constraint from AC-STE-71.7 verbatim:

   > Write fragments ONLY for items in this set. Do NOT add content for diff changes outside this set. If a category is empty, do not write content for that category. Reproduce symbol names verbatim.

5. **Frontmatter (AC-STE-70.3).**

   ```
   ---
   fr: <fr-id or _unbound>
   impact_set: <JSON.stringify(publicSet)>
   target_section: tutorials | how-to | reference | explanation
   target_file: docs/<subpath>
   generated_at: <ISO timestamp>
   ---
   ```

   `target_section` must be one of the four Diátaxis values (STE-69 CANONICAL_ANCHORS). `target_file` must begin with `docs/<target_section>/`.

6. **Packages-mode signature cache (AC-STE-72.7).** If `DocsConfig.packagesMode === true`, also call `extractSignatures(projectRoot, docsConfig)` from `adapters/_shared/src/signature_extractor.ts` and write the result as `docs/.pending/<fr-id>.signatures.json`. `/docs --commit` reads this cache to detect bit-rotted fragments at merge time.

7. **Post-generation validator (AC-STE-71.7, NFR-22).** Scan the fragment body for TypeScript symbol mentions (backtick-quoted names). Any name not in `publicSet.symbols[*].name` → reject the fragment, re-prompt the LLM once with a strictened constraint that re-quotes the set. Second failure → write the fragment with a `<!-- warning: LLM output includes <list> not in impact set -->` header (never silent).

### 2. `/docs --commit` (AC-STE-70.4, AC-STE-70.8)

Merges staged fragments. Gated on an intact nav contract.

1. **Nav-contract gate (AC-STE-70.8).** Call `runNavContractProbe(projectRoot)` from `adapters/_shared/src/docs_nav_contract.ts`. If `ok === false`, refuse with the NFR-10 canonical shape:

   ```
   /docs --commit: docs/README.md nav contract is broken — cannot merge into a malformed tree.
   Remedy: run /docs --full to regenerate the canonical tree, or fix the README manually (must contain four ##-level headings with {#tutorials}, {#how-to}, {#reference}, {#explanation} anchors, each linking to an existing target).
   Context: violations=<probe.notes.length>, skill=docs
   ```

   Exit non-zero. Fragments under `.pending/` are preserved.

2. **Gather fragments.** Read every `.md` file under `docs/.pending/` (skip `.gitkeep`). Parse each frontmatter. If any fragment has `target_section` outside the four canonical values or `target_file` not starting with `docs/<target_section>/`, refuse with NFR-10 naming the offending fragment; fragments remain in place.

3. **Stale-signatures check (AC-STE-72.7).** For each `<fr-id>.md` that has a sibling `<fr-id>.signatures.json`, re-run `extractSignatures` on the current tree and diff names against the cached set. Any name in the cache that no longer exists → surface a `⚠ stale fragment <fr-id>: references removed signatures <list>` line in the diff header for the user to notice pre-approval. Do not auto-reject — the user decides.

4. **Merge algorithm.** Group fragments by `target_file`, concatenate bodies in `generated_at` ascending order, produce merged target content (append to existing target file, or create with seed content if target is missing). Full pseudocode: `docs/docs-reference.md` § Merge algorithm.

5. **Unified diff + approval.** Compute the diff across all target files. Print `=== Proposed diff (N files, M lines) ===`, the diff body, then `=== Apply? [y/N] ===`. Accept case-insensitive `y`/`yes`. Anything else is refusal.

6. **On approval.** Write each merged target file, delete every merged fragment (`docs/.pending/<fr-id>.md` + any `<fr-id>.signatures.json`), print a suggested commit message to stdout, but **do not run `git commit`** — the caller decides (AC-STE-70.4).

7. **On refusal.** No file writes. Fragments preserved. Print `commit declined; fragments preserved.` and exit `0`.

### 3. `/docs --full` (AC-STE-70.5, AC-STE-70.8)

Regenerates the entire canonical `docs/` tree from sources of truth. Bypasses the nav-contract gate (it IS the recovery path) but still honors the DocsConfig gate (AC-STE-70.6 ∧ AC-STE-70.8).

1. **Seed the layout (idempotent).** Call `ensureCanonicalLayout(projectRoot, docsConfig, templatesDir)` so missing directories/files are created from templates. Existing files are preserved and diff'd against the regenerated output.

2. **Gather inputs.** Read:
   - Every active spec under `specs/frs/*.md` and `specs/plan/*.md` (skip `archive/`).
   - `CLAUDE.md` (project overview, tracker mode, docs modes).
   - Project source (for `ImpactSet` + `SignatureGroundTruth` when `packagesMode === true`).
   - Current `CHANGELOG.md`.

3. **Packages-mode ground truth (AC-STE-72.*).** If `docsConfig.packagesMode === true`, call `extractSignatures(projectRoot, docsConfig)`. Pin the result as the LLM prompt's `SignatureGroundTruth` context block per AC-STE-72.3 (prompt verbatim in `docs/docs-reference.md` § Packages-mode prompt). After generation, run `validateGeneratedReference(llmOutput, ground)`:
   - `{ ok: true }` → continue.
   - `{ ok: false, invented }` → retry once with a strictened prompt re-quoting the ground truth (AC-STE-72.4). Second failure fails `/docs --full` with the NFR-10 canonical shape:

     ```
     /docs --full: LLM-generated reference for <module> introduced signatures not in ground truth: <list>.
     Remedy: review the LLM output manually; this typically indicates the ground truth extraction missed an export (bug in signature_extractor.ts) or the LLM ignored the verbatim constraint (re-run /docs --full). If the missing signatures are legitimate, file a bug against signature_extractor.ts.
     Context: strategy=<strategy>, module=<module-path>, skill=docs
     ```

4. **Non-TS stack banner (AC-STE-72.5).** If `ground.strategy === "regex-fallback"`, prepend the generated reference file with the literal banner:

   ```html
   <!-- WARNING: This reference was generated without mechanical signature extraction for this stack. Signatures may be imprecise. Review carefully before publishing. -->
   ```

5. **Full-tree diff + approval.** Compute a unified diff across every file in `docs/` (old vs. newly rendered). Print `=== Proposed diff (N files, M lines) ===`, body, `=== Apply? [y/N] ===`.

6. **On approval.** Write every target file. Delete all `docs/.pending/*.md` + `*.signatures.json` fragments (superseded by the full regeneration per AC-STE-70.5). Exit `0`.

7. **On refusal.** No file writes. `.pending/` preserved. Print `full regeneration declined; no writes.` and exit `0`.

## Rules

- **Human approval is mandatory on `--commit` and `--full`.** The approval gate is the single strongest mitigation against the top failure mode identified in the M20 brainstorm ("LLM produces plausible-but-wrong content that gets approved as boilerplate"). Do not add a `--yes` flag or any approval-skipping shortcut (AC-STE-70.4, AC-STE-70.5).
- **`--full` never runs `git commit`.** Neither does `--commit`. The skill writes files and prints a commit-message suggestion; the caller decides whether to commit. This keeps doc regenerations reviewable in the git history.
- **DocsConfig gate always fires first.** `--quick` refuses when docs are disabled — never writes a fragment against a disabled tree (AC-STE-70.6).
- **Nav contract gate fires for `--commit`.** `--full` bypasses nav-contract (it's the fix), never DocsConfig (AC-STE-70.8).
- **Regenerate-from-scratch is atomic.** `--full` writes all target files or none — any extraction failure or LLM validator rejection aborts the whole regeneration before any write.
- **Fragments are append-only until `--commit`.** `--quick` never edits an existing fragment; it writes one per invocation. Merge decides ordering at commit time via `generated_at` frontmatter.

## Red flags

- "This diff is small, just approve it" — approval is on the user, not the agent. State the proposed diff size and wait.
- "Fragment accumulated for an abandoned FR — just merge it" — `--commit` surfaces orphan-ish fragments but doesn't reject them; the user decides. Do not auto-delete.
- "Signature validator rejected my run, but I'm pretty sure the LLM is right" — retry once with the strictened prompt; if that fails, the run fails loudly (AC-STE-72.4). Do not edit the ground truth to match the LLM.
- "I'll skip `--full` regeneration and just `--commit` on a half-broken nav" — `--commit` refuses. Run `--full` instead (it IS the recovery path).
