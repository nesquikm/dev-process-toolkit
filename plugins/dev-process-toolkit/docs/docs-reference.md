# `/docs` skill reference (STE-70)

Extended reference for `skills/docs/SKILL.md`. Contains the LLM prompts verbatim (AC-STE-71.7, AC-STE-72.3), the merge algorithm pseudocode, fragment frontmatter examples, and per-section merge strategies. Pointed at from `SKILL.md` to keep the skill file under the NFR-1 300-line budget (AC-STE-70.7).

## Quick-fragment prompt (AC-STE-71.7, NFR-22)

Used by `/docs --quick` after it computes the `publicSet` (= `filterPublicSymbols(computeImpactSet(...))`). The prompt pins `publicSet` as authoritative.

```
You are writing a docs fragment for the following impact set:

<JSON.stringify(publicSet, null, 2)>

Write fragments ONLY for items in this set. Do NOT add content for diff
changes outside this set. If a category is empty, do not write content for
that category. Reproduce symbol names verbatim.

Target section: <target_section>        (one of: tutorials, how-to, reference, explanation)
Target file:    <target_file>           (must start with docs/<target_section>/)
FR id:          <fr-id>                 (or "_unbound" when not resolvable)

Output format: markdown body only — the frontmatter will be prepended by
the caller. Keep the fragment concise (10–40 lines). Do not use HTML
comments. Do not invent public API names or routes beyond those listed.
```

**Verbatim constraint enforcement.** After the LLM returns the body, the skill scans for backtick-quoted identifiers (``` `foo` ```) and HTML-safe identifier mentions. Any name not in `publicSet.symbols[*].name` triggers one retry with the prompt suffix:

```
PREVIOUS ATTEMPT INCLUDED THESE NAMES NOT IN THE IMPACT SET: <list>.
Rewrite the fragment using ONLY names from the JSON above. Do not substitute
plausible-sounding alternatives. If a section would be empty after this
constraint, omit the section.
```

Second failure writes the fragment with a top-of-file header:

```
<!-- warning: LLM output includes <list> not in impact set — manual review advised -->
```

and continues — never silently drops the warning.

## Packages-mode prompt (AC-STE-72.3, NFR-22)

Used by `/docs --full` and `/docs --commit` when `DocsConfig.packagesMode === true`. The prompt pins the `SignatureGroundTruth` as authoritative verbatim signatures.

```
Below is the SignatureGroundTruth for this module's public API. You MUST
reproduce each signature verbatim as a code block. Write descriptive prose
above and below each signature — what it does, when to use it, parameters,
return value, errors. Do NOT alter signatures. Do NOT add signatures not
in this list. If you believe a signature in the ground truth is wrong,
flag it in a `<!-- CORRECTNESS WARNING: ... -->` comment rather than
fixing it.

<JSON.stringify(signatureGroundTruth, null, 2)>

Output format: markdown body. For each ExportSignature, emit:

  ## <name>

  <one-paragraph description>

  ```typescript
  <signature verbatim — copy-paste, do not rephrase>
  ```

  **Parameters** — <per-parameter prose when parameters exist>
  **Returns** — <return-value prose>
  **Errors** — <error-case prose when errors are part of the contract>

  <optional usage example — markdown code block>

Do not invent overloads. Do not add signatures. Respect the exact ordering
in the JSON.
```

**Validator** (`validateGeneratedReference` — `adapters/_shared/src/signature_extractor.ts`):

1. Parse ```typescript / ```ts code fences in the LLM output.
2. Extract declarations: `export function NAME`, `export class NAME`, `export type NAME`, `export interface NAME`, `export const NAME`, `export enum NAME`.
3. For each declared `NAME`: assert `NAME` appears in `SignatureGroundTruth.modules[*].exports[*].name` AND the declaration's whitespace-normalized form matches the ground truth's normalized signature.
4. Any mismatch → `{ ok: false, invented: [names] }`.

`/docs --full` and `/docs --commit` retry once on `ok === false` with the strictened suffix:

```
PREVIOUS ATTEMPT INTRODUCED THESE SIGNATURES NOT IN THE GROUND TRUTH: <list>.
Rewrite the reference for this module using ONLY the ExportSignature blocks
provided. Do not infer additional overloads. Do not rename signatures. If
you believe a signature is missing from the ground truth, emit a
`<!-- CORRECTNESS WARNING: missing=<name> -->` comment instead of adding
the signature yourself.
```

Second failure fails the run with the NFR-10 canonical shape from AC-STE-72.4.

## Fragment frontmatter — full shape

Each `docs/.pending/<fr-id>.md` fragment is a self-contained markdown document. Frontmatter is YAML; body is freeform markdown.

```
---
fr: STE-70                    # tracker-mode ID, OR `_unbound`, OR an FR ULID
impact_set:                   # filterPublicSymbols(computeImpactSet({...}))
  symbols:
    - kind: function
      name: computeImpactSet
      file: plugins/dev-process-toolkit/adapters/_shared/src/impact_set.ts
      change: added
      visibility: public
      signatureHash: 9e47...
  routes: []
  configKeys: []
  stateEvents: []
target_section: reference     # tutorials | how-to | reference | explanation
target_file: docs/reference/impact-set.md
generated_at: 2026-04-24T09:42:36Z
---

<body — the actual prose delta the LLM produced>
```

`_unbound-<timestamp>.md` fragments additionally carry:

```
warning: FR id could not be resolved from branch or diff. Review before commit.
```

## Merge algorithm (AC-STE-70.4)

Called by `/docs --commit` after the nav-contract gate passes.

```
function merge(pending: Fragment[], targets: Map<string, string>): MergedWrites {
  // 1. Validate frontmatter.
  for (const f of pending) {
    if (!CANONICAL_ANCHORS.includes(f.target_section)) refuse(NFR10, f);
    if (!f.target_file.startsWith(`docs/${f.target_section}/`)) refuse(NFR10, f);
  }

  // 2. Group by target.
  const byTarget = new Map<string, Fragment[]>();
  for (const f of pending) {
    const list = byTarget.get(f.target_file) ?? [];
    list.push(f);
    byTarget.set(f.target_file, list);
  }

  // 3. Stable order inside each group: generated_at ascending.
  for (const list of byTarget.values()) list.sort(byGeneratedAt);

  // 4. Render per target.
  const writes: MergedWrites = new Map();
  for (const [file, fragments] of byTarget) {
    const existing = targets.get(file) ?? seedFromTemplate(file);
    const merged = appendFragments(existing, fragments);
    writes.set(file, merged);
  }
  return writes;
}

function appendFragments(existing: string, fragments: Fragment[]): string {
  // v1 strategy: append each fragment body (separated by one blank line)
  // to the end of the existing file, preserving the existing file's H1 /
  // frontmatter. Conflict detection is deferred to v2 — if two fragments
  // edit the same canonical line, last-writer-wins with a warning comment.
  const trailer = fragments.map((f) => f.body).join("\n\n");
  const sep = existing.endsWith("\n") ? "\n" : "\n\n";
  return existing + sep + trailer + "\n";
}
```

**Per-section merge notes:**

- **tutorials/** — append new step-by-step tutorials. Each new tutorial lives in its own file (e.g., `tutorials/<slug>.md`); do not append tutorials to an existing tutorial file. Frontmatter `target_file` should be the new file path.
- **how-to/** — same append-per-file discipline. Each how-to is a named task-oriented recipe.
- **reference/** — packages-mode content is driven by `SignatureGroundTruth`, not by fragments. User-facing reference content (state diagrams, enum tables) appends to existing reference files.
- **explanation/** — new architectural narrative appends to `explanation/architecture.md` or a new named file. Long narrative drift is caught by the user reviewing the `/docs --commit` diff.

## Full regeneration flow (AC-STE-70.5)

`/docs --full`:

1. `ensureCanonicalLayout(projectRoot, docsConfig, templatesDir)` — seed missing skeleton (idempotent; no overwrites).
2. **Gather sources.** Active FRs + active milestones + `CLAUDE.md` + `CHANGELOG.md` + project source (for `ImpactSet` + `SignatureGroundTruth`).
3. **Render per-section.**
   - `tutorials/` — the LLM produces fresh `getting-started.md` content from the overview sections of `CLAUDE.md` + latest milestone plan summary.
   - `how-to/` — the LLM produces recipes from the release-notes "how do I?" phrases in `CHANGELOG.md`.
   - `reference/` — packages-mode: one `reference/api/<module>.md` per `ModuleSignatures` entry, rendered via the packages-mode prompt. User-facing mode: one `reference/states.md` with mermaid state diagrams derived from the `stateEvents` extracted across active specs.
   - `explanation/` — `architecture.md` refreshed from `technical-spec.md` section headings + active milestones' "Why this milestone exists" sections.
4. **Validate.** `validateGeneratedReference` on every generated packages-mode file (AC-STE-72.4). Retry-once-then-fail on mismatch.
5. **Unified diff.** Against the currently-on-disk tree.
6. **Approval gate.** `=== Apply? [y/N] ===`.
7. **Apply.** Write every target atomically (all-or-nothing). Delete `.pending/*.md` + `*.signatures.json` (superseded).

## Typedoc strategy integration (AC-STE-72.2)

When `typedoc` is present (found on `PATH` or `<projectRoot>/node_modules/.bin/typedoc`), `extractSignatures` invokes it with `--json <outfile> <projectRoot>`, parses the output for the set of export names, and cross-references against the ts-morph extraction. Disagreement produces a warning in `SignatureGroundTruth.warnings`. Signature strings are always taken from ts-morph (which reads the source verbatim) rather than from typedoc's normalized form — this preserves the exact source text that the LLM must reproduce.

Failure modes (from the `runTypedoc` implementation):

- **non-zero exit** → warning `typedoc invocation failed (exit N); falling back to ts-morph.`; strategy = `ts-morph`.
- **no output file** → same path as non-zero exit.
- **output is not JSON** → same path as non-zero exit.

The `ts-morph` path is the always-available backstop; typedoc is an enrichment, not a hard requirement.

## Non-TS stacks (AC-STE-72.5)

When `extractSignatures` is called in a project without `tsconfig.json`, it returns:

```
{
  strategy: "regex-fallback",
  modules: [],
  warnings: ["signature extraction for this stack uses regex fallback; manual review of generated reference docs is strongly advised."]
}
```

`/docs --full` prepends every generated reference file with the banner:

```html
<!-- WARNING: This reference was generated without mechanical signature extraction for this stack. Signatures may be imprecise. Review carefully before publishing. -->
```

The banner is mandatory, not optional — reviewers will skim reference diffs as boilerplate, and without a visible warning the LLM-inferred signatures poison the docs (the exact failure mode STE-72 was written to prevent).

## Cross-references

- `adapters/_shared/src/docs_config.ts` — `readDocsConfig`, `DocsConfig`.
- `adapters/_shared/src/docs_layout.ts` — `ensureCanonicalLayout`, `LayoutReport`.
- `adapters/_shared/src/docs_nav_contract.ts` — `validateNavContract`, `runNavContractProbe`, `CANONICAL_ANCHORS`.
- `adapters/_shared/src/impact_set.ts` — `computeImpactSet`, `filterPublicSymbols`, `isEmptyImpactSet`, `ImpactSet`, `SymbolChange`, `RouteChange`, `ConfigKeyChange`, `StateEventChange`.
- `adapters/_shared/src/signature_extractor.ts` — `extractSignatures`, `validateGeneratedReference`, `SignatureGroundTruth`, `ModuleSignatures`, `ExportSignature`.
- `docs/setup-docs-mode.md` — STE-68 `/setup` docs-mode prompt flow (source of `DocsConfig`).
