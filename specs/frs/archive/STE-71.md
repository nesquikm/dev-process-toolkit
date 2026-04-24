---
id: fr_01KPXFS3732H11671CYSDF12GH
title: Code-driven impact set detection (deterministic diff → {symbols, routes, configKeys, stateEvents})
milestone: M20
status: archived
archived_at: 2026-04-24T12:10:37Z
tracker:
  linear: STE-71
created_at: 2026-04-23T15:03:00Z
---

## Requirement

The biggest drift risk identified in the brainstorm duck council was **LLM freeform inference over which doc fragment a given FR touches**. Letting the LLM read the diff and decide "this change needs a doc update in states.md" produces orphan entries (missed transitive impacts), silent drift (plausible but wrong location), and cross-doc contradictions (updating states.md without noticing the flows.md reference).

STE-71 replaces that inference with **deterministic extraction**. A pure function reads the current diff (working tree or staged, depending on invocation context) and returns a structured `ImpactSet` naming exactly which code-level surfaces changed, in four categories:

- **symbols** — public functions, classes, types, interfaces added/modified/removed. Extracted from the TypeScript AST (for the plugin's own source) or regex-matched for other stacks.
- **routes** — HTTP routes (`app.get("/api/x")`), CLI commands (`cli.command("foo")`), RPC entry points. Regex-matched with stack-aware patterns.
- **configKeys** — keys added/changed in `package.json`, `plugin.json`, config files, YAML/JSON schemas. AST or JSON-diff where possible, regex fallback.
- **stateEvents** — enum values added, state-machine case branches added, action type strings added. Regex-matched against common patterns.

`/docs --quick` consumes the `ImpactSet` as **ground truth** — the LLM prompt pins the set and explicitly instructs "write fragments only for items in this set; do not infer additional impacts from the diff". Empty `ImpactSet` → `--quick` is a no-op (no fragment written).

## Acceptance Criteria

- AC-STE-71.1: New module `plugins/dev-process-toolkit/adapters/_shared/src/impact_set.ts` exports `computeImpactSet(diffInput: DiffInput): ImpactSet` where:

  ```typescript
  export interface DiffInput {
    mode: "working-tree" | "staged" | "range";
    baseRef?: string;  // required for mode === "range"
    headRef?: string;  // optional for mode === "range" (defaults to HEAD)
    projectRoot: string;
  }

  export interface ImpactSet {
    symbols: SymbolChange[];
    routes: RouteChange[];
    configKeys: ConfigKeyChange[];
    stateEvents: StateEventChange[];
  }

  export interface SymbolChange {
    kind: "function" | "class" | "type" | "interface" | "const";
    name: string;
    file: string;
    change: "added" | "modified" | "removed";
    visibility: "public" | "internal";  // based on `export` keyword
  }

  // Similar shapes for RouteChange, ConfigKeyChange, StateEventChange
  ```

- AC-STE-71.2: Extraction is deterministic — same diff + same project source produces same `ImpactSet`. No LLM calls inside `computeImpactSet`. No network I/O. Reads: `git diff` output, project source files for AST parsing, nothing else.
- AC-STE-71.3: TypeScript symbol extraction uses `ts-morph` (or direct TypeScript compiler API). Scans changed `.ts` / `.tsx` files for `export` declarations; records name, kind, visibility, and before/after signature hash (for change detection). Private / non-exported symbols are recorded with `visibility: "internal"` but excluded from the set passed to LLM (AC-STE-71.5).
- AC-STE-71.4: Non-TypeScript stacks fall back to regex extractors per stack (detected via `## Task Tracking` and package-manager files). v1 supports TypeScript (AST) and Markdown (no symbols; routes/config keys via regex only). Other stacks: log warning `impact-set extraction: regex-only fallback for <stack> — results may be incomplete` and run the regex extractors.
- AC-STE-71.5: `/docs --quick` filters the `ImpactSet` to `visibility: "public"` symbols only before passing to LLM. Internal changes are recorded but do not drive doc fragments (consistent with the principle that docs describe the public surface).
- AC-STE-71.6: Empty `ImpactSet` (all four arrays length 0) → `/docs --quick` logs `no doc-relevant changes detected — fragment not written` and exits 0. No empty fragment file is created.
- AC-STE-71.7: LLM prompt in `skills/docs/SKILL.md` (or referenced prose file) contains the explicit instruction:

  > You are writing a doc fragment for the following impact set:
  > <ImpactSet as JSON>
  > Write fragments ONLY for items in this set. Do NOT add content for diff changes outside this set. If a category is empty, do not write content for that category. Reproduce symbol names verbatim.

  This instruction is NFR-22-constrained (see NFR addition below).
- AC-STE-71.8: Fixture-based tests in `tests/impact_set.test.ts` cover: added public function, modified public function (signature change), added CLI command via `cli.command()`, added package.json script, added enum value, empty diff → empty set, internal-only change → filtered to empty public set.

## Technical Design

**Module structure:**

```
plugins/dev-process-toolkit/adapters/_shared/src/
├── impact_set.ts           # top-level orchestrator
├── extractors/
│   ├── symbols_ts.ts       # TypeScript AST extractor (ts-morph)
│   ├── symbols_regex.ts    # regex fallback for non-TS stacks
│   ├── routes.ts           # HTTP route + CLI command regex patterns
│   ├── config_keys.ts      # JSON/YAML config diff
│   └── state_events.ts     # enum / case-branch regex
└── impact_set.test.ts
```

**`computeImpactSet` flow:**

1. Run `git diff` with appropriate options based on `DiffInput.mode`.
2. Parse the diff into `{ file, hunks[] }` pairs.
3. For each changed file: classify by extension, dispatch to appropriate extractor.
4. Merge all extractor outputs into a single `ImpactSet`.
5. Return.

**Regex patterns (starter set, to be refined during impl):**

- Routes: `app\.(get|post|put|delete|patch)\(['"]([^'"]+)['"]` / `cli\.command\(['"]([^'"]+)['"]` / `@(Get|Post|Put|Delete)\(['"]([^'"]+)['"]`
- State events: `case ['"](\w+)['"]:` / `type \w+Action = \| \{ type: ['"](\w+)['"]`
- Config keys: JSON-path diff of `package.json` / `plugin.json` / `.claude-plugin/marketplace.json`.

Regex patterns are deliberately conservative — false negatives (missing a route) are safer than false positives (LLM writes doc for non-existent surface).

**Gate on LLM validator (AC-STE-71.7 complement):** `/docs --quick` after receiving LLM output scans the fragment body for symbol names. If a symbol appears that's NOT in the `ImpactSet.symbols` pinned in the prompt, the fragment is rejected and `--quick` retries once (max 1 retry to avoid infinite loops). Second failure: write the fragment with a `<!-- warning: LLM output includes <list-of-invented-symbols> not in impact set -->` header, let human reviewer catch it.

## Testing

`impact_set.test.ts` — deterministic fixtures:
- `fixtures/diffs/added_public_fn.patch` → `ImpactSet.symbols` contains one `SymbolChange` with `change: "added"`, `visibility: "public"`.
- `fixtures/diffs/modified_signature.patch` → one `SymbolChange` with `change: "modified"` and before/after hash difference.
- `fixtures/diffs/internal_helper.patch` → one `SymbolChange` with `visibility: "internal"` (AC-STE-71.5 filter test).
- `fixtures/diffs/cli_command.patch` → one `RouteChange` with `kind: "cli"`.
- `fixtures/diffs/package_json_script.patch` → one `ConfigKeyChange` on `.scripts.foo`.
- `fixtures/diffs/enum_value.patch` → one `StateEventChange`.
- `fixtures/diffs/empty.patch` → empty `ImpactSet`.

Each extractor module has its own unit tests against raw diff strings — no `git` invocation needed in tests (diff is read from fixture `.patch` files).

Coverage target: 100% on `impact_set.ts` and each extractor module (NFR-21-style).

## Notes

**Why deterministic over LLM-classified.** Per the brainstorm duck council (`project_m20_docs.md`): "An LLM guessing 'which doc fragment this FR touches' from natural language + code diffs will miss transitive impacts (renames, moved modules, behavior changes behind unchanged APIs), creating orphan diagram states and stale cross-links quickly. You likely need a heuristic that is code-driven." STE-71 is that heuristic.

**Why no LLM post-validator on the routes/config/state categories.** The LLM prompt lists them; if the LLM writes content for a route not in the set, that's the fragment's fault, but routes are often discussed narratively ("the new /users endpoint allows..."). Strict verbatim enforcement on routes would produce stilted prose. Symbols are enforced because hallucinated API signatures are the top risk.

**Future enhancements (out of scope for M20):**
- Transitive impact: if function `foo` calls `bar` and `bar` changed, mark `foo` as impacted too. Requires call-graph analysis.
- Deletion tracking: removed public API → explicit `## Deprecated` fragment. Currently a removal produces `change: "removed"` in the set but no specific deprecation handling.
- Custom regex extensions via project config: users adding their own patterns for framework-specific conventions.

**NFR addition.** Proposed NFR-22: "LLM doc-signature grounding invariant — LLM-generated API reference content must never include symbols absent from the `ImpactSet.symbols` or the `SignatureGroundTruth` (STE-72). Enforced per AC-STE-71.7 retry/warning and AC-STE-72.3 retry/fail." This NFR goes into `requirements.md` alongside the M20 work.

**Release target:** v1.23.0. Phase B of M20 plan, parallel with STE-70 and STE-72.
