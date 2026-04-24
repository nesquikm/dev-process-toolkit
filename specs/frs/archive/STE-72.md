---
id: fr_01KPXFS374YX9YEDFBDFKD3BG4
title: Mechanical API signature extraction (ground truth for packages-mode reference docs)
milestone: M20
status: archived
archived_at: 2026-04-24T12:10:37Z
tracker:
  linear: STE-72
created_at: 2026-04-23T15:04:00Z
---

## Requirement

The single largest unmitigated failure mode identified in the M20 brainstorm duck council is **LLM-invented API signatures that look authoritative**: subtle wrong defaults, missing overloads, hallucinated generic bounds, wrong error-case documentation. These errors pass unit tests (because they're in docs, not code), get skimmed by reviewers as "boilerplate doc diffs", and poison the repo as copy-pasted reference that users then file bugs against.

STE-72 closes this by making the LLM a **prose writer, not a signature inventor**. Before `/docs --full` or `/docs --commit` produces any packages-mode reference content, a deterministic extraction pass collects the public API's actual signatures from source (preferring native tools, falling back to AST, finally regex). These signatures become the `SignatureGroundTruth` passed to the LLM as a pinned context block. The LLM's job is to write prose *around* each signature — descriptions, examples, caveats, cross-references — reproducing the signature itself **verbatim**. A post-generation validator verifies every signature block in the LLM output appears in the ground truth; mismatches trigger a bounded retry, and persistent mismatches fail loudly rather than silently shipping wrong content.

v1 of STE-72 supports TypeScript via `typedoc` (if installed) or `ts-morph` AST (bundled dep). Other stacks get a warning and fall through to LLM-inferred signatures with a "manual review advised" banner in the generated reference pages.

## Acceptance Criteria

- AC-STE-72.1: New module `plugins/dev-process-toolkit/adapters/_shared/src/signature_extractor.ts` exports `extractSignatures(projectRoot: string, config: DocsConfig): SignatureGroundTruth` where:

  ```typescript
  export interface SignatureGroundTruth {
    strategy: "typedoc" | "ts-morph" | "regex-fallback";
    modules: ModuleSignatures[];
    warnings: string[];  // e.g., "typedoc not installed; fell back to ts-morph"
  }

  export interface ModuleSignatures {
    modulePath: string;  // e.g., "adapters/_shared/src/task_tracking_config.ts"
    exports: ExportSignature[];
  }

  export interface ExportSignature {
    name: string;
    kind: "function" | "class" | "type" | "interface" | "const" | "enum";
    signature: string;       // the verbatim signature string, as it appears in source (or typedoc output)
    docComment?: string;     // JSDoc/TSDoc if present
    sourceFile: string;
    sourceLineStart: number;
    sourceLineEnd: number;
  }
  ```

- AC-STE-72.2: Strategy resolution order: (1) check for `typedoc` in `node_modules/.bin` or on `PATH`; if found, invoke with `--json` and parse the output; (2) else use `ts-morph` directly (bundled with this plugin's adapter deps); (3) else regex fallback per AC-STE-72.4. The chosen strategy is recorded in `SignatureGroundTruth.strategy`.
- AC-STE-72.3: LLM prompt for packages-mode reference content (in `docs/docs-reference.md` or skill prose) contains the explicit constraint:

  > Below is the SignatureGroundTruth for this module's public API. You MUST reproduce each signature verbatim as a code block. Write descriptive prose above and below each signature — what it does, when to use it, parameters, return value, errors. Do NOT alter signatures. Do NOT add signatures not in this list. If you believe a signature in the ground truth is wrong, flag it in a `<!-- CORRECTNESS WARNING: ... -->` comment rather than fixing it.
  >
  > <SignatureGroundTruth as JSON>

- AC-STE-72.4: Post-generation validator parses the LLM output for ```typescript (or ```ts) code blocks and code-block-nested `function` / `class` / `type` / `interface` / `const` / `enum` declarations. For each declaration: assert the name exists in `SignatureGroundTruth.modules[*].exports[*].name` AND the declaration string matches (whitespace-normalized). Mismatch → reject, retry once with a strictened prompt (re-emphasizing AC-STE-72.3). Second mismatch → fail `/docs` with NFR-10:

  ```
  /docs: LLM-generated reference for <module-path> introduced signatures not in ground truth: <names>.
  Remedy: review the LLM output manually; this typically indicates the ground truth extraction missed an export (bug in extractor) or the LLM ignored the verbatim constraint (re-run with --full). If the missing signatures are legitimate, file a bug against signature_extractor.ts.
  Context: strategy=<strategy>, module=<module-path>, skill=docs
  ```
- AC-STE-72.5: Non-TypeScript stacks (detected via absence of `tsconfig.json` / `package.json` with TS deps): extraction returns `SignatureGroundTruth.strategy: "regex-fallback"` with warnings including `signature extraction for <stack> uses regex fallback; manual review of generated reference docs is strongly advised.` Generated reference files gain a top-of-file banner:

  ```html
  <!-- WARNING: This reference was generated without mechanical signature extraction for this stack. Signatures may be imprecise. Review carefully before publishing. -->
  ```

- AC-STE-72.6: `/setup`'s packages-mode prompt (STE-68 AC-STE-68.1 prompt 2) augments its default-yes message with a probe result: "`Generate packages-style API reference docs? (typedoc <detected|not found>, ts-morph <bundled>, stack: <ts|other>)`". This gives the user immediate visibility into which strategy will be used at `/docs` time.
- AC-STE-72.7: Extracted `SignatureGroundTruth` is cached to `docs/.pending/<fr-id>.signatures.json` alongside any accompanying `.md` fragment when `/docs --quick` runs. `/docs --commit` reads the cached JSON to validate consistency (did the signature still exist in the canonical docs at merge time?). Cache is deleted with the fragment on successful merge.
- AC-STE-72.8: `signature_extractor.test.ts` covers: typedoc happy path (mocked subprocess), ts-morph AST happy path (real parser, fixture TS files), regex fallback on non-TS fixture, module with no exports (returns empty `exports[]`), module with JSDoc preserved, module with conditional types (tricky ts-morph case).

## Technical Design

**Strategy implementations:**

*typedoc strategy:* Spawn `typedoc --json <tempfile> <modules>`, parse the emitted JSON into `ModuleSignatures[]`. typedoc output already normalizes signatures; minimal transformation needed. Failure modes: typedoc non-zero exit (log warning, fall through to ts-morph), typedoc stdout not valid JSON (same).

*ts-morph strategy:* Direct use of `ts-morph` project:

```typescript
import { Project, ExportedDeclarations } from "ts-morph";

function extractViaTsMorph(projectRoot: string): ModuleSignatures[] {
  const project = new Project({ tsConfigFilePath: `${projectRoot}/tsconfig.json` });
  const result: ModuleSignatures[] = [];
  for (const sf of project.getSourceFiles()) {
    const exports = sf.getExportedDeclarations();
    const modExports: ExportSignature[] = [];
    for (const [name, decls] of exports) {
      for (const decl of decls) {
        modExports.push({
          name,
          kind: classifyKind(decl),
          signature: decl.getText(),
          docComment: extractJsDoc(decl),
          sourceFile: sf.getFilePath(),
          sourceLineStart: decl.getStartLineNumber(),
          sourceLineEnd: decl.getEndLineNumber(),
        });
      }
    }
    if (modExports.length > 0) result.push({ modulePath: sf.getFilePath(), exports: modExports });
  }
  return result;
}
```

*regex fallback:* Pattern-match lines starting with `export function|class|type|interface|const|enum`. Captures name + rest-of-signature (best effort, limited to single-line declarations). Multi-line signatures get truncated with a `<!-- truncated -->` marker in the `signature` field.

**Validator implementation:**

```typescript
export function validateGeneratedReference(
  llmOutput: string,
  ground: SignatureGroundTruth
): ValidatorResult {
  const declaredNames = new Set<string>();
  for (const mod of ground.modules) for (const exp of mod.exports) declaredNames.add(exp.name);

  const codeBlocks = extractTsCodeBlocks(llmOutput);
  const invented: string[] = [];
  for (const block of codeBlocks) {
    for (const decl of parseDeclarationsInBlock(block)) {
      if (!declaredNames.has(decl.name)) invented.push(decl.name);
    }
  }
  return invented.length === 0 ? { ok: true } : { ok: false, invented };
}
```

## Testing

Unit tests for each strategy, a shared fixture of TypeScript source files with known exports:

```
tests/fixtures/signature_extraction/
├── tsconfig.json
└── src/
    ├── simple_function.ts   # one exported function
    ├── generic_class.ts     # class with generics
    ├── type_alias.ts        # exported type + interface
    ├── overloads.ts         # function with multiple overloads
    └── internal_helper.ts   # no exports (tests empty-exports case)
```

Validator tests: LLM output with all-matching declarations passes; output with one invented declaration fails with correct `invented: [<name>]`; output with no code blocks passes trivially (pure prose).

## Notes

**Why typedoc-preferred over ts-morph-always.** typedoc is the canonical TS documentation tool; its output is battle-tested across many TS codebases. If the project already has typedoc as a dev dependency, using it ensures the extraction matches what the user's team would produce manually. ts-morph is our fallback because it ships with the plugin's adapters (no user-install required) — but it produces more raw, less-normalized output.

**Why regex is the final fallback, not the only strategy.** Regex can't distinguish overloads, can't resolve type aliases, misses multi-line signatures — all of which matter for correctness. It's present only because "plausibly correct with a loud warning" beats "refuse to generate docs for non-TS stacks".

**The retry-once bound.** Infinite retry loops are expensive (API calls) and rarely helpful — if the LLM ignored the verbatim constraint once, a second attempt with a strictened prompt may fix it; a third almost never does. Fail loudly on second miss rather than burning tokens.

**Why cache to `.pending/<fr-id>.signatures.json`.** At merge time (`/docs --commit`), the ground truth that drove a fragment may have shifted (e.g., a later commit renamed a function). Cached ground truth lets `--commit` detect "this fragment references `oldName` but the current ground truth has `newName`" and flag the stale fragment for manual reconciliation rather than silently merging bit-rotted content.

**NFR-22 (proposed, shared with STE-71).** "LLM doc-signature grounding invariant — LLM-generated reference content must never include symbols absent from `ImpactSet.symbols` (for fragments) or `SignatureGroundTruth` (for full/commit regeneration). Enforced per AC-STE-71.7 and AC-STE-72.4."

**Release target:** v1.23.0. Phase B of M20, parallel with STE-70 and STE-71.
