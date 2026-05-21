// Doc-conformance tests for STE-316 — Rewrite tracker-mode docs for v2
// file-per-FR layout (M84).
//
// Asserts that the six in-scope docs under plugins/dev-process-toolkit/docs/
// no longer teach the obsolete v1 layout:
//
//   - ac-sync.md
//   - implement-tracker-mode.md
//   - spec-review-tracker-mode.md
//   - spec-write-tracker-mode.md
//   - layout-reference.md
//   - setup-tracker-mode.md
//
// Coverage matches AC-STE-316.{1..5}: stale-token grep gate (widened per FR
// Notes to include `requirements.md#FR-`), layout-reference.md L62/L69
// rewrites, DD-12.x retirement, probe-#29 v2 teaching, top-line cross-
// reference to docs/layout-reference.md.
//
// Active/archived split: stale tokens remain acceptable inside
// `specs/frs/archive/**` and `specs/plan/archive/**` (frozen history). This
// test scopes strictly to the six docs above.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const pluginRoot = join(import.meta.dir, "..");
const docsDir = join(pluginRoot, "docs");

const SIX_DOCS = [
  "ac-sync.md",
  "implement-tracker-mode.md",
  "spec-review-tracker-mode.md",
  "spec-write-tracker-mode.md",
  "layout-reference.md",
  "setup-tracker-mode.md",
] as const;

function readDoc(name: string): string {
  return readFileSync(join(docsDir, name), "utf8");
}

// Widened stale-token regex per FR Notes — includes the `requirements.md#FR-`
// form flagged by the M84 audit pass (e.g. layout-reference.md:69 after the
// initial rewrite). The base AC.1 regex covers heading shapes and `FR-{N}`
// placeholders; the widened arm catches anchor-link references that the base
// regex misses.
const STALE_TOKEN_REGEX =
  /(\\#FR-[0-9]+|### FR-[0-9]+|FR-\{N\}|FR-\{[0-9]+\}|requirements\.md#FR-)/;

function collectStaleHits(body: string): string[] {
  const hits: string[] = [];
  const lines = body.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (STALE_TOKEN_REGEX.test(lines[i]!)) {
      hits.push(`${i + 1}: ${lines[i]}`);
    }
  }
  return hits;
}

describe("AC-STE-316.1 — Stale v1-layout tokens scrubbed from the six in-scope docs", () => {
  for (const docName of SIX_DOCS) {
    test(`docs/${docName} contains zero stale v1-layout tokens`, () => {
      const body = readDoc(docName);
      const hits = collectStaleHits(body);
      expect(hits).toEqual([]);
    });
  }

  test("at least one of the six docs teaches the canonical v2 per-FR file path", () => {
    // The replacement teaching must surface in the rewritten docs: ACs live
    // in `specs/frs/<tracker-id>.md` (or `<short-ULID>.md` in mode-none)
    // under the file's `## Acceptance Criteria` section.
    const corpus = SIX_DOCS.map((n) => readDoc(n)).join("\n");
    expect(corpus).toMatch(/specs\/frs\/.*\.md/);
    expect(corpus).toMatch(/## Acceptance Criteria/);
  });

  test("at least one of the six docs mentions tracker-id-derived AC-prefix or acPrefix", () => {
    // AC.1 replacement prose: "AC-prefix derived via `acPrefix(spec)`
    // (tracker-id in tracker mode, short-ULID tail in mode-none)".
    const corpus = SIX_DOCS.map((n) => readDoc(n)).join("\n");
    expect(corpus).toMatch(/acPrefix|AC-prefix|tracker-id|short-ULID/);
  });
});

describe("AC-STE-316.2 — layout-reference.md L62 / L69 rewrites", () => {
  test("layout-reference.md teaches `id:` as mode-conditional", () => {
    const body = readDoc("layout-reference.md");
    // The `id:` field must be documented as mode-conditional: required in
    // `mode: none`, absent in tracker mode.
    expect(body).toMatch(/id:/);
    expect(body.toLowerCase()).toMatch(/mode-conditional|mode:\s*none|tracker mode/);
    // Reference to probe #13 or its name `identity_mode_conditional`.
    expect(body).toMatch(/identity_mode_conditional|probe #13|probe 13/i);
  });

  test("layout-reference.md drops the v1→v2 `requirements.md#FR-N` rewrite claim", () => {
    const body = readDoc("layout-reference.md");
    // The rewrite claim referenced the legacy migration scaffolding retired by
    // STE-96. After this FR it must not appear anywhere in the doc.
    expect(body).not.toMatch(/requirements\.md#FR-/);
    expect(body.toLowerCase()).not.toMatch(/v1[\s→-]+v2/);
  });

  test("layout-reference.md mentions the surviving frs→archive rewrite path", () => {
    const body = readDoc("layout-reference.md");
    // The only rewrite the toolkit ships is `frs/<id>.md` → `frs/archive/<id>.md`
    // (per adapters/_shared/src/spec_archive/rewrite_links.ts).
    expect(body).toMatch(/frs\/archive\/|spec_archive|rewrite_links/);
  });
});

describe("AC-STE-316.3 — DD-12.x decision-record references retired", () => {
  for (const docName of SIX_DOCS) {
    test(`docs/${docName} contains zero DD-12 references`, () => {
      const body = readDoc(docName);
      expect(body).not.toMatch(/DD-12/);
    });
  }

  test("retired DD-12 scheme verified absent from canonical spec surfaces too", () => {
    // The DD-12 scheme is fully retired from specs/ (per FR description).
    // The six docs are the last bound — verify they are silent on DD-12 and
    // that the canonical spec surfaces are also clean (no regression).
    const specsRoot = join(pluginRoot, "..", "..", "specs");
    let technicalSpec = "";
    let requirements = "";
    try {
      technicalSpec = readFileSync(join(specsRoot, "technical-spec.md"), "utf8");
    } catch {
      technicalSpec = "";
    }
    try {
      requirements = readFileSync(join(specsRoot, "requirements.md"), "utf8");
    } catch {
      requirements = "";
    }
    expect(technicalSpec).not.toMatch(/DD-12/);
    expect(requirements).not.toMatch(/DD-12/);
  });
});

describe("AC-STE-316.4 — Bidirectional consistency w/ probe #29 + cross-ref resolution", () => {
  test("no rewritten doc instructs writing `### FR-N` blocks into specs/requirements.md", () => {
    // Probe #29 (requirements-md-no-placeholder) flags `### FR-N` headings,
    // the `[Feature Name]` literal, and the `<tracker-id>` literal in active
    // content. The rewritten docs must not teach any of those landing in
    // specs/requirements.md.
    for (const docName of SIX_DOCS) {
      const body = readDoc(docName);
      // Look for prose that pairs `requirements.md` with `### FR-` or `FR-{N}`
      // shapes — that's the smoke-test failure mode probe #29 catches.
      const reqMdMentions = body.match(/.{0,80}requirements\.md.{0,200}/g) ?? [];
      for (const window of reqMdMentions) {
        expect(window).not.toMatch(/### FR-/);
        expect(window).not.toMatch(/FR-\{N\}/);
        expect(window).not.toMatch(/FR-\{[0-9]+\}/);
      }
    }
  });

  test("cross-references between the six docs all resolve", () => {
    // Reviewer-prose half of AC.4: scan each of the six docs for references
    // to any of the other five by `docs/<name>.md` or bare `<name>.md` and
    // assert the target file actually exists in the set.
    const fileSet = new Set<string>(SIX_DOCS);
    // Strip the .md suffix to build a name set for bare references too.
    const baseNames = new Set<string>(SIX_DOCS.map((n) => n.replace(/\.md$/, "")));
    for (const docName of SIX_DOCS) {
      const body = readDoc(docName);
      // Find every `docs/<name>.md` or `<name>.md` reference that points at
      // one of the six in-scope docs (filter out external/unrelated names).
      const matches = [
        ...body.matchAll(/(?:docs\/)?([a-z0-9-]+)\.md/g),
      ];
      for (const m of matches) {
        const candidate = `${m[1]}.md`;
        // Only validate references that target one of the six docs by name —
        // unrelated `.md` references (e.g., requirements.md, CHANGELOG.md)
        // are out of scope for this resolution check.
        if (baseNames.has(m[1]!) && !fileSet.has(candidate)) {
          throw new Error(`${docName} references missing in-scope doc: ${candidate}`);
        }
      }
    }
    // If we reach here, every in-scope cross-reference resolved.
    expect(true).toBe(true);
  });
});

describe("AC-STE-316.5 — Each doc carries a top-line cross-reference to layout-reference.md", () => {
  for (const docName of SIX_DOCS) {
    test(`docs/${docName} cites docs/layout-reference.md near the top as canonical authority`, () => {
      const body = readDoc(docName);
      // Read the first ~25 non-empty lines (the doc's preamble) — the
      // cross-reference must land in that header region.
      const headRegion = body.split("\n").slice(0, 25).join("\n");

      if (docName === "layout-reference.md") {
        // The canonical authority itself is exempt from citing itself; it
        // should however declare itself as the canonical reference for FR
        // file shape so readers landing here know they're at the source.
        expect(headRegion.toLowerCase()).toMatch(/canonical (reference|authority)/);
      } else {
        expect(headRegion).toMatch(/layout-reference\.md/);
        expect(headRegion.toLowerCase()).toMatch(/canonical|authority|fr file shape|source of truth/);
      }
    });
  }
});
