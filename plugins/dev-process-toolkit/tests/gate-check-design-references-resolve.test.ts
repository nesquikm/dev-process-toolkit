// STE-343 AC-STE-343.{1,2,3} — /gate-check probe
// `design-references-resolve`. Severity: error (GATE FAILED).
//
// Pins the contract of the pure helper
// `adapters/_shared/src/scan_design_references.ts`:
//
//   scanDesignReferences(projectRoot: string)
//     => { file: string; line: number; path: string; resolves: boolean }[]
//
// The helper walks the spec-file glob (`specs/requirements.md`,
// `specs/frs/**/*.md` active + `archive/`, `specs/technical-spec.md`,
// `specs/testing-spec.md`, `specs/plan/**/*.md`), finds each
// `## Design References` section (level-2 heading whose text is exactly
// "Design References"), and for every list item whose first
// backtick-wrapped token is a repo-root-relative path emits a row:
//   - `path`     — the backtick-wrapped repo-root-relative path
//   - `file`     — the repo-root-relative path of the spec file
//   - `line`     — the 1-indexed line of the entry
//   - `resolves` — existsSync(join(projectRoot, path))
// Non-path prose lines under the heading are ignored; the section ends at
// the next `## ` heading. The probe (caller) GATE FAILEDs on any row with
// `resolves === false`; the helper is detection-only.
//
// Modelled on `tests/gate-check-cross-cutting-spec-stale-file-refs.test.ts`:
// build a temp spec tree with mkdtempSync, seed files, call the helper,
// assert. Filter by AC with `bun test -t "AC-STE-343.N"`.

import { describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  scanDesignReferences,
  scanExternalReferences,
} from "../adapters/_shared/src/scan_design_references";

type Row = { file: string; line: number; path: string; resolves: boolean };

/**
 * Build a real temp spec tree.
 *
 * @param files repo-root-relative spec path => file content
 * @param seed  repo-root-relative image paths to create on disk (so the
 *              referenced path `resolves`)
 */
function makeTree(
  files: Record<string, string>,
  seed: string[] = [],
): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "design-refs-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  for (const rel of seed) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, "\x89PNG\r\n\x1a\n"); // PNG magic — content is irrelevant
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/** 1-indexed line of the first line in `content` containing `needle`. */
function lineOf(content: string, needle: string): number {
  const idx = content.split("\n").findIndex((l) => l.includes(needle));
  expect(idx).toBeGreaterThan(-1);
  return idx + 1;
}

const find = (rows: Row[], path: string): Row | undefined =>
  rows.find((r) => r.path === path);

describe("AC-STE-343 — design-references-resolve helper", () => {
  test("AC-STE-343.1 — forward-resolution: present resolves, missing reports file:line+path, scan reaches requirements & plan", () => {
    const fr = [
      "# STE-343", //                                                   1
      "", //                                                            2
      "## Acceptance Criteria", //                                      3
      "", //                                                            4
      "- AC-STE-343.1: foo", //                                         5
      "", //                                                            6
      "## Design References", //                                        7
      "", //                                                            8
      "- `specs/design/frs/STE-343/present.png` — Present mockup", //   9
      "- `specs/design/frs/STE-343/missing.png` — Missing mockup", //  10
      "", //                                                           11
      "## Notes", //                                                   12
      "", //                                                           13
      "- `specs/design/frs/STE-343/notes-only.png` — after next ##", //14
      "", //                                                           15
    ].join("\n");

    const requirements = [
      "# Requirements",
      "",
      "## Design References",
      "",
      "- `specs/design/system/tokens.png` — Color tokens",
      "",
    ].join("\n");

    const plan = [
      "# M91",
      "",
      "## Design References",
      "",
      "- `specs/design/system/plan-ref.png` — Plan reference",
      "",
    ].join("\n");

    const fx = makeTree(
      {
        "specs/frs/STE-343.md": fr,
        "specs/requirements.md": requirements,
        "specs/plan/M91.md": plan,
      },
      [
        "specs/design/frs/STE-343/present.png",
        "specs/design/system/tokens.png",
        "specs/design/system/plan-ref.png",
      ],
    );
    try {
      const rows = scanDesignReferences(fx.root) as Row[];

      // Present path → resolves true, found in the active FR.
      const present = find(rows, "specs/design/frs/STE-343/present.png");
      expect(present).toBeDefined();
      expect(present!.resolves).toBe(true);
      expect(present!.file).toBe("specs/frs/STE-343.md");
      expect(present!.line).toBe(lineOf(fr, "present.png"));

      // Missing path → resolves false, with precise file:line + path so a
      // probe can render the NFR-10 canonical shape.
      const missing = find(rows, "specs/design/frs/STE-343/missing.png");
      expect(missing).toBeDefined();
      expect(missing!.resolves).toBe(false);
      expect(missing!.file).toBe("specs/frs/STE-343.md");
      expect(missing!.path).toBe("specs/design/frs/STE-343/missing.png");
      expect(missing!.line).toBe(lineOf(fr, "missing.png"));

      // Section ends at the next `## ` heading: the entry under `## Notes`
      // is NOT captured (even though it would resolve false).
      expect(
        find(rows, "specs/design/frs/STE-343/notes-only.png"),
      ).toBeUndefined();

      // Scan reaches specs/requirements.md and specs/plan/.
      expect(rows.some((r) => r.file === "specs/requirements.md")).toBe(true);
      expect(rows.some((r) => r.file === "specs/plan/M91.md")).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  test("AC-STE-343.1 — a prose line (not a list item) that mentions a backtick path is NOT captured (no false-positive GATE FAILED)", () => {
    // The contract is list-item entries only. A hand-authored prose sentence
    // under the heading that merely *mentions* a path — even a non-existent
    // one — must not produce a row, or it would hard-fail the gate spuriously.
    const fr = [
      "# STE-343",
      "",
      "## Design References",
      "",
      "See `specs/design/frs/STE-343/prose-only.png` for context — this is prose, not a list item.",
      "- `specs/design/frs/STE-343/listed.png` — a genuine list-item entry",
      "",
    ].join("\n");
    const fx = makeTree(
      { "specs/frs/STE-343.md": fr },
      // listed.png is seeded; prose-only.png is deliberately absent — if the
      // prose line were captured it would report resolves:false (false GATE FAIL).
      ["specs/design/frs/STE-343/listed.png"],
    );
    try {
      const rows = scanDesignReferences(fx.root) as Row[];
      expect(find(rows, "specs/design/frs/STE-343/prose-only.png")).toBeUndefined();
      const listed = find(rows, "specs/design/frs/STE-343/listed.png");
      expect(listed).toBeDefined();
      expect(listed!.resolves).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  test("AC-STE-343.2 — vacuous when unused: no section / h3 lookalike / empty / prose-only ⇒ zero rows", () => {
    // (a) No level-2 `## Design References` anywhere. An h3 `### Design
    //     References` lookalike with a backtick path must NOT count — the
    //     contract requires a level-2 heading whose text is exactly
    //     "Design References".
    const noSection = makeTree({
      "specs/frs/STE-343.md": [
        "# STE-343",
        "",
        "## Acceptance Criteria",
        "",
        "- AC-1: foo",
        "",
        "### Design References",
        "",
        "- `specs/design/frs/STE-343/h3.png` — under an h3, must be ignored",
        "",
        "## Notes",
        "",
      ].join("\n"),
      "specs/requirements.md": "# Requirements\n\nNo design here.\n",
    });
    try {
      expect(scanDesignReferences(noSection.root)).toEqual([]);
    } finally {
      noSection.cleanup();
    }

    // (b) Section present but empty / prose-only — no backtick-wrapped path
    //     entries ⇒ zero rows, no throw.
    const emptyOrProse = makeTree({
      "specs/frs/STE-343.md": [
        "# STE-343",
        "",
        "## Acceptance Criteria",
        "",
        "- AC-1: foo",
        "",
        "## Design References",
        "",
        "See the Figma board for current mockups; no committed images yet.",
        "",
        "## Notes",
        "",
      ].join("\n"),
      "specs/technical-spec.md": [
        "# Technical Spec",
        "",
        "## Design References",
        "",
        "## Overview",
        "",
      ].join("\n"),
    });
    try {
      expect(scanDesignReferences(emptyOrProse.root)).toEqual([]);
    } finally {
      emptyOrProse.cleanup();
    }
  });

  test("AC-STE-343.3 — archive immutability: present pass / missing fail / no-section vacuous, and an archived FR's ref still resolves", () => {
    const activeFr = [
      "# STE-343",
      "",
      "## Acceptance Criteria",
      "",
      "- AC-1: foo",
      "",
      "## Design References",
      "",
      "- `specs/design/frs/STE-343/present.png` — Present mockup",
      "- `specs/design/frs/STE-343/missing.png` — Missing mockup",
      "",
      "## Notes",
      "",
    ].join("\n");

    // An FR that has been git-mv'd into archive/. Its repo-root-relative
    // design reference still points at a file that exists on disk — the
    // immutability guarantee: the same reference stays valid after the FR
    // moves into archive/.
    const archivedFr = [
      "# STE-300 (archived)",
      "",
      "## Acceptance Criteria",
      "",
      "- AC-1: bar",
      "",
      "## Design References",
      "",
      "- `specs/design/frs/STE-300/archived.png` — Archived mockup, still valid",
      "",
      "## Notes",
      "",
    ].join("\n");

    // Real moved-file layout: both active and archive/ FRs coexist.
    const fx = makeTree(
      {
        "specs/frs/STE-343.md": activeFr,
        "specs/frs/archive/STE-300.md": archivedFr,
      },
      [
        "specs/design/frs/STE-343/present.png",
        "specs/design/frs/STE-300/archived.png",
        // NOTE: STE-343/missing.png is deliberately NOT seeded.
      ],
    );
    try {
      const rows = scanDesignReferences(fx.root) as Row[];

      // (a) present path → pass.
      const present = find(rows, "specs/design/frs/STE-343/present.png");
      expect(present).toBeDefined();
      expect(present!.resolves).toBe(true);
      expect(present!.file).toBe("specs/frs/STE-343.md");

      // (b) missing path → GATE FAILED material: file:line + path.
      const missing = find(rows, "specs/design/frs/STE-343/missing.png");
      expect(missing).toBeDefined();
      expect(missing!.resolves).toBe(false);
      expect(missing!.file).toBe("specs/frs/STE-343.md");
      expect(missing!.path).toBe("specs/design/frs/STE-343/missing.png");
      expect(missing!.line).toBe(lineOf(activeFr, "missing.png"));

      // (d) archived FR's reference still resolves → pass, proving the
      //     repo-root-relative ref survives the move into archive/.
      const archived = find(rows, "specs/design/frs/STE-300/archived.png");
      expect(archived).toBeDefined();
      expect(archived!.resolves).toBe(true);
      expect(archived!.file).toBe("specs/frs/archive/STE-300.md");
    } finally {
      fx.cleanup();
    }

    // (c) no `## Design References` section ⇒ vacuous pass (zero rows).
    const noSection = makeTree({
      "specs/frs/STE-343.md": [
        "# STE-343",
        "",
        "## Acceptance Criteria",
        "",
        "- AC-1: foo",
        "",
        "## Notes",
        "",
      ].join("\n"),
    });
    try {
      expect(scanDesignReferences(noSection.root)).toEqual([]);
    } finally {
      noSection.cleanup();
    }
  });

  test("AC-STE-343.3 — non-tautological guard: `resolves` tracks existsSync (seeded ⇒ true, absent ⇒ false)", () => {
    // Two entries of identical shape under one `## Design References`
    // section; the ONLY difference is whether the file exists on disk. If
    // the helper dropped its existsSync check (always resolves:true), the
    // `absent` row would wrongly report true and this test would fail —
    // proving the guard is real, not a tautology.
    const fr = [
      "# STE-343",
      "",
      "## Acceptance Criteria",
      "",
      "- AC-1: foo",
      "",
      "## Design References",
      "",
      "- `specs/design/system/exists.png` — seeded on disk",
      "- `specs/design/system/absent.png` — never committed",
      "",
    ].join("\n");

    const fx = makeTree(
      { "specs/frs/STE-343.md": fr },
      ["specs/design/system/exists.png"], // absent.png deliberately omitted
    );
    try {
      const rows = scanDesignReferences(fx.root) as Row[];

      const seeded = find(rows, "specs/design/system/exists.png");
      expect(seeded).toBeDefined();
      expect(seeded!.resolves).toBe(true);

      const absent = find(rows, "specs/design/system/absent.png");
      expect(absent).toBeDefined();
      expect(absent!.resolves).toBe(false);
    } finally {
      fx.cleanup();
    }
  });

  // STE-542 AC-STE-542.5 — a URL under `## Design References` must NEVER
  // become a DesignReferenceRow: probe #61 `existsSync`es every row and would
  // GATE FAILED on a scheme-bearing token. The URL's own row kind is covered
  // in tests/m140-ste-542-external-links.test.ts; this leg pins the exclusion
  // on the shipped scanner, alongside its positive control.
  test("AC-STE-542.5 — a scheme-bearing token in the same section is excluded, while the path row beside it is still emitted", () => {
    const fr = [
      "# STE-542",
      "",
      "## Design References",
      "",
      "- `specs/design/system/exists.png` — seeded on disk",
      "- `https://example.invalid/upstream-spec` — Upstream spec",
      "",
    ].join("\n");

    const fx = makeTree(
      { "specs/frs/STE-542.md": fr },
      ["specs/design/system/exists.png"],
    );
    try {
      const rows = scanDesignReferences(fx.root) as Row[];
      // POSITIVE CONTROL — the scanner demonstrably read this fixture.
      expect(find(rows, "specs/design/system/exists.png")).toBeDefined();
      // …and the URL is not among the path rows, under any field.
      expect(rows.map((r) => r.path)).not.toContain(
        "https://example.invalid/upstream-spec",
      );
      expect(rows.length).toBe(1);
    } finally {
      fx.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// STE-596 — the CONSUMING half. The storage side (M91 / STE-341 / STE-343)
// stores, cites and existence-checks design images; nothing ever hands them to
// the step that runs a project's own check skill. These legs pin the closing
// hop: `DesignReferenceRow` widens to carry the authored caption (reusing the
// sibling `ExternalReferenceRow` caption reader, not a second one), the rows
// are FR-scoped by `DesignReferenceRow.file`, and ONE shared renderer turns
// them into the block Phase 4b″ injects into the check skill's invocation and
// into the `manual`-mode reminder alike.
//
// The consumer contract these legs define (the implementer owns where it
// lives; the NAMES are load-bearing, the path is not):
//
//   designReferencesForSpec(projectRoot: string, specFile: string): DesignReferenceRow[]
//     — `scanDesignReferences(projectRoot)` filtered on `row.file === specFile`.
//       No second parser: it never opens a file and never carries a
//       `## Design References` heading regex of its own.
//
//   renderDesignReferenceBlock(rows): { lines, text, token, rendered, skipped }
//     — the SOLE definition of the block's shape. `rows: []` renders the empty
//       string (the vacuous path is byte-identical to today's invocation);
//       an unresolved path renders as skipped and never throws.
//
//   DESIGN_REFERENCE_CAPABILITY_TOKENS = { passed, none }
//     — the AC.7 pair, registered in CANONICAL_CAPABILITY_KEYS.
// ---------------------------------------------------------------------------

const SRC_DIR = join(import.meta.dir, "..", "adapters", "_shared", "src");

/**
 * The post-STE-596 key set of `DesignReferenceRow`, written out in full so
 * AC.4's single `toEqual` has a whole object to compare against.
 */
type WideRow = {
  path: string;
  file: string;
  line: number;
  resolves: boolean;
  caption: string | null;
};

interface DesignReferenceBlock {
  lines: readonly string[];
  text: string;
  token: string;
  rendered: number;
  skipped: number;
}

interface BlockModule {
  path: string;
  source: string;
  renderDesignReferenceBlock(rows: readonly WideRow[]): DesignReferenceBlock;
  designReferencesForSpec(projectRoot: string, specFile: string): WideRow[];
  DESIGN_REFERENCE_CAPABILITY_TOKENS: { passed: string; none: string };
}

/** Every shipped (non-test) TypeScript source under adapters/_shared/src. */
function shippedSources(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "__tests__") continue;
        walk(path);
        continue;
      }
      if (!entry.name.endsWith(".ts")) continue;
      if (entry.name.endsWith(".test.ts")) continue;
      out.push(path);
    }
  };
  walk(SRC_DIR);
  return out;
}

/**
 * Drop block + line comments so a source-level scan grades CODE, not prose.
 * Without this, a header comment that merely NAMES the section reads as a
 * second parser (`migrations/monolith_split.ts` mentions `## Design
 * References` in a comment and parses nothing).
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * Locate the single shipped module exporting `name`, by SCANNING rather than
 * by pinning a path — the file is an implementation decision, the export name
 * is the contract. Two homes for one renderer is itself the defect AC.2
 * forbids, so a second hit reports as "no canonical home", never as a pick.
 */
function findSoleExporter(name: string): string | null {
  const re = new RegExp(`export\\s+(?:async\\s+)?function\\s+${name}\\b`);
  const hits = shippedSources().filter((f) => re.test(readFileSync(f, "utf-8")));
  return hits.length === 1 ? hits[0]! : null;
}

async function loadBlockModule(): Promise<BlockModule> {
  const path = findSoleExporter("renderDesignReferenceBlock");
  if (path === null) {
    throw new Error(
      "no shipped module under adapters/_shared/src exports exactly one " +
        "`renderDesignReferenceBlock` — the design-reference block has no " +
        "single renderer (AC-STE-596.2)",
    );
  }
  const mod = (await import(path)) as Omit<BlockModule, "path" | "source">;
  return { path, source: readFileSync(path, "utf-8"), ...mod };
}

/** A regex LITERAL that parses the `## Design References` heading. */
const HEADING_PARSER_RE = /\/\^##[^\n]*Design References/;

describe("AC-STE-596 — design references reach the project's verification step", () => {
  test("AC-STE-596.4 — the WHOLE row deep-equals its key set in one toEqual (caption included)", () => {
    // Field-by-field `.toBe` assertions stay GREEN against an added or
    // renamed field — that is exactly how a widening slips past its own
    // tests. One `toEqual` on the whole object is the assertion that cannot.
    const fr = [
      "# STE-596", //                                                    1
      "", //                                                             2
      "## Acceptance Criteria", //                                       3
      "", //                                                             4
      "- AC-STE-596.1: foo", //                                          5
      "", //                                                             6
      "## Design References", //                                         7
      "", //                                                             8
      "- `specs/design/frs/STE-596/login.png` — Login screen, empty state", // 9
      "", //                                                            10
    ].join("\n");

    const fx = makeTree(
      { "specs/frs/STE-596.md": fr },
      ["specs/design/frs/STE-596/login.png"],
    );
    try {
      const rows = scanDesignReferences(fx.root) as unknown as WideRow[];
      expect(rows.length).toBe(1);
      expect(rows[0]).toEqual({
        path: "specs/design/frs/STE-596/login.png",
        file: "specs/frs/STE-596.md",
        line: lineOf(fr, "login.png"),
        resolves: true,
        caption: "Login screen, empty state",
      });
    } finally {
      fx.cleanup();
    }
  });

  test("AC-STE-596.4 — a caption-less entry carries `caption: null`, not an empty string", () => {
    const fr = [
      "# STE-596",
      "",
      "## Design References",
      "",
      "- `specs/design/system/tokens.png`",
      "",
    ].join("\n");
    const fx = makeTree(
      { "specs/frs/STE-596.md": fr },
      ["specs/design/system/tokens.png"],
    );
    try {
      const rows = scanDesignReferences(fx.root) as unknown as WideRow[];
      expect(rows.length).toBe(1);
      expect(rows[0]).toEqual({
        path: "specs/design/system/tokens.png",
        file: "specs/frs/STE-596.md",
        line: lineOf(fr, "tokens.png"),
        resolves: true,
        caption: null,
      });
    } finally {
      fx.cleanup();
    }
  });

  test("AC-STE-596.4 — the caption comes from the SIBLING reader: identical tails parse identically on both row kinds", () => {
    // `ExternalReferenceRow` already parses a caption off the separator dash.
    // A second, copy-pasted reader agrees on the happy path and diverges on
    // the day nobody is looking — so parity across the separator/whitespace
    // shapes is asserted directly, on the same tails, for both row kinds.
    const tails = [
      "— Em-dash caption",
      "- Hyphen caption",
      "—   Extra   spacing",
      "",
    ];
    const lines: string[] = ["# STE-596", "", "## Design References", ""];
    tails.forEach((tail, i) => {
      lines.push(`- \`specs/design/system/img-${i}.png\` ${tail}`.trimEnd());
      lines.push(`- \`https://example.invalid/ref-${i}\` ${tail}`.trimEnd());
    });
    lines.push("");
    const fr = lines.join("\n");

    const fx = makeTree(
      { "specs/frs/STE-596.md": fr },
      tails.map((_, i) => `specs/design/system/img-${i}.png`),
    );
    try {
      const design = scanDesignReferences(fx.root) as unknown as WideRow[];
      const external = scanExternalReferences(fx.root);
      // Control: both readers demonstrably read this fixture.
      expect(design.length).toBe(tails.length);
      expect(external.length).toBe(tails.length);

      for (let i = 0; i < tails.length; i++) {
        const d = design.find((r) => r.path.endsWith(`img-${i}.png`));
        const e = external.find((r) => r.url.endsWith(`ref-${i}`));
        expect(d, `design row ${i}`).toBeDefined();
        expect(e, `external row ${i}`).toBeDefined();
        expect(d!.caption, `caption parity on tail ${JSON.stringify(tails[i])}`).toBe(
          e!.caption,
        );
      }
      // …and the parity is not the trivial all-null one.
      expect(design.map((r) => r.caption)).toContain("Em-dash caption");
      expect(design.map((r) => r.caption)).toContain("Hyphen caption");
      expect(design.map((r) => r.caption)).toContain(null);
    } finally {
      fx.cleanup();
    }
  });

  test("AC-STE-596.4 — ONE caption-separator reader ships, not two", () => {
    // The source-level half of the parity leg above: the scanner declares the
    // caption separator exactly once. Two declarations are the duplication the
    // AC forbids, however identically they behave today.
    const scanner = stripComments(
      readFileSync(join(SRC_DIR, "scan_design_references.ts"), "utf-8"),
    );
    const separatorDecls = scanner.match(
      /const\s+\w*CAPTION\w*_(?:SEPARATOR|RE)\w*\s*=/g,
    );
    // Control: the declaration the scanner already ships is findable at all.
    expect(separatorDecls, "caption-separator declaration not found").not.toBeNull();
    expect(separatorDecls!.length).toBe(1);
  });

  test("AC-STE-596.3 — rows are `scanDesignReferences` filtered by the FR's own spec path", async () => {
    const inScope = [
      "# STE-596",
      "",
      "## Design References",
      "",
      "- `specs/design/frs/STE-596/mine.png` — Mine",
      "",
    ].join("\n");
    const neighbour = [
      "# STE-597",
      "",
      "## Design References",
      "",
      "- `specs/design/frs/STE-597/theirs.png` — Theirs",
      "",
    ].join("\n");
    const requirements = [
      "# Requirements",
      "",
      "## Design References",
      "",
      "- `specs/design/system/root.png` — Root-level",
      "",
    ].join("\n");

    const fx = makeTree(
      {
        "specs/frs/STE-596.md": inScope,
        "specs/frs/STE-597.md": neighbour,
        "specs/requirements.md": requirements,
      },
      [
        "specs/design/frs/STE-596/mine.png",
        "specs/design/frs/STE-597/theirs.png",
        "specs/design/system/root.png",
      ],
    );
    try {
      const mod = await loadBlockModule();

      // POSITIVE CONTROL: the unfiltered scan sees all three spec files, so
      // the narrowing below is a real filter and not an empty reader.
      expect(scanDesignReferences(fx.root).length).toBe(3);

      const scoped = mod.designReferencesForSpec(fx.root, "specs/frs/STE-596.md");
      expect(scoped.map((r) => r.path)).toEqual([
        "specs/design/frs/STE-596/mine.png",
      ]);
      expect(scoped.every((r) => r.file === "specs/frs/STE-596.md")).toBe(true);

      // The neighbour's own scope is non-empty too — the filter keys off
      // `file`, it does not just return the first row.
      expect(
        mod
          .designReferencesForSpec(fx.root, "specs/frs/STE-597.md")
          .map((r) => r.path),
      ).toEqual(["specs/design/frs/STE-597/theirs.png"]);

      // An FR that cites nothing scopes to zero rows (the vacuous path).
      expect(
        mod.designReferencesForSpec(fx.root, "specs/frs/STE-999.md"),
      ).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("AC-STE-596.3 — the consumer ships NO second design-references parser (with a positive control)", async () => {
    const mod = await loadBlockModule();
    const consumer = stripComments(mod.source);

    // POSITIVE CONTROL — the detector demonstrably hits a real heading
    // parser. Without this, the zero-hit assertion below is a vacuous claim
    // that would also pass on a detector that can never match anything.
    const knownParsers = shippedSources().filter((f) =>
      HEADING_PARSER_RE.test(stripComments(readFileSync(f, "utf-8"))),
    );
    expect(knownParsers.map((f) => f.replace(`${SRC_DIR}/`, ""))).toContain(
      "scan_design_references.ts",
    );

    // …and the consumer side is not among them.
    expect(knownParsers).not.toContain(mod.path);
    expect(HEADING_PARSER_RE.test(consumer)).toBe(false);

    // It reads no spec file of its own — the rows come from the scanner.
    expect(consumer).not.toMatch(/readFileSync|readdirSync/);
    // …which it calls by bare name, so a change to the scanner is genuinely
    // wired through instead of being shadowed by a local copy.
    expect(consumer).toMatch(/scanDesignReferences\s*\(/);
  });

  test("AC-STE-596.2 — exactly one module defines the block's shape, and this grader reads that same function", async () => {
    const mod = await loadBlockModule();
    expect(typeof mod.renderDesignReferenceBlock).toBe("function");

    // No caller re-renders the block: the header literal the renderer emits
    // lives in exactly one shipped source — its own.
    const header = "Design references:";
    const emitters = shippedSources().filter((f) =>
      stripComments(readFileSync(f, "utf-8")).includes(header),
    );
    // Control: the renderer itself is found by this scan.
    expect(emitters).toContain(mod.path);
    expect(emitters.length).toBe(1);
  });

  test("AC-STE-596.1 — the rendered block carries every row's repo-root-relative path and authored caption", async () => {
    const { renderDesignReferenceBlock } = await loadBlockModule();

    const block = renderDesignReferenceBlock([
      {
        path: "specs/design/frs/STE-596/login.png",
        file: "specs/frs/STE-596.md",
        line: 9,
        resolves: true,
        caption: "Login screen",
      },
      {
        path: "specs/design/frs/STE-596/empty.png",
        file: "specs/frs/STE-596.md",
        line: 10,
        resolves: false,
        caption: "Empty state",
      },
      {
        path: "specs/design/system/tokens.png",
        file: "specs/frs/STE-596.md",
        line: 11,
        resolves: true,
        caption: null,
      },
    ]);

    // The block's shape is DEFINED here, byte for byte — one renderer, one
    // definition, and this is it.
    expect(block.text).toBe(
      [
        "Design references:",
        "- `specs/design/frs/STE-596/login.png` — Login screen",
        "- [unresolved on disk — skipped] `specs/design/frs/STE-596/empty.png` — Empty state",
        "- `specs/design/system/tokens.png`",
      ].join("\n"),
    );
    expect(block.lines).toEqual(block.text.split("\n"));
    expect(block.rendered).toBe(2);
    expect(block.skipped).toBe(1);
  });

  test("AC-STE-596.2 — the command-line front door prints the renderer's OWN bytes", async () => {
    // Hardening pass. The front door exists so the prose executor runs the
    // renderer instead of re-emitting the block's shape by hand — which is
    // worth nothing if the two can disagree. This asserts they cannot: the
    // CLI's stdout is the in-process `text` plus the token line, byte for byte.
    const { renderDesignReferenceBlock, designReferencesForSpec } =
      await loadBlockModule();
    const cli = join(SRC_DIR, "design_reference_block.ts");

    const fx = makeTree(
      {
        "specs/frs/STE-596.md": [
          "# STE-596",
          "",
          "## Design References",
          "",
          "- `specs/design/frs/STE-596/here.png` — Present",
          "- `specs/design/frs/STE-596/gone.png` — Absent",
          "",
        ].join("\n"),
      },
      ["specs/design/frs/STE-596/here.png"],
    );
    try {
      const rows = designReferencesForSpec(fx.root, "specs/frs/STE-596.md");
      const inProcess = renderDesignReferenceBlock(rows);
      // Control: this fixture is not the vacuous one — the comparison below
      // would hold trivially if both sides rendered nothing.
      expect(inProcess.rendered).toBe(1);
      expect(inProcess.skipped).toBe(1);

      const run = Bun.spawnSync(["bun", "run", cli, fx.root, "specs/frs/STE-596.md"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(run.exitCode).toBe(0);
      const stdout = run.stdout.toString();
      expect(stdout).toBe(
        `${inProcess.text}\ndesign_reference_block: ${inProcess.token} (1 rendered, 1 skipped)\n`,
      );
    } finally {
      fx.cleanup();
    }
  });

  test("AC-STE-596.1 — the front door still SAYS something when the FR cites none", async () => {
    // Hardening pass. The vacuous path renders the empty string, so a command
    // that printed only the block would print nothing at all — leaving the
    // caller unable to tell "this FR cites none" from "the command died". The
    // token line is what carries the difference, and it is asserted here
    // against the failure case rather than assumed.
    const { DESIGN_REFERENCE_CAPABILITY_TOKENS } = await loadBlockModule();
    const cli = join(SRC_DIR, "design_reference_block.ts");

    const fx = makeTree({ "specs/frs/STE-596.md": "# STE-596\n\nNo references here.\n" });
    try {
      const ok = Bun.spawnSync(["bun", "run", cli, fx.root, "specs/frs/STE-596.md"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(ok.exitCode).toBe(0);
      expect(ok.stdout.toString()).toBe(
        `design_reference_block: ${DESIGN_REFERENCE_CAPABILITY_TOKENS.none} (0 rendered, 0 skipped)\n`,
      );

      // The failure it must not be confusable with: no arguments at all.
      const broken = Bun.spawnSync(["bun", "run", cli], { stdout: "pipe", stderr: "pipe" });
      expect(broken.exitCode).not.toBe(0);
      expect(broken.stdout.toString()).toBe("");
      expect(broken.stderr.toString()).toContain("usage:");
    } finally {
      fx.cleanup();
    }
  });

  test("AC-STE-596.3 — a root with no specs/ tree yields no rows and no throw", async () => {
    // Hardening pass: the error path a consumer actually meets first. A project
    // that has not adopted specs/ at all must render the vacuous block, not
    // raise inside Phase 4b″ after the gate already went green.
    const { designReferencesForSpec, renderDesignReferenceBlock } =
      await loadBlockModule();
    const fx = makeTree({ "README.md": "# no specs tree here\n" });
    try {
      const rows = designReferencesForSpec(fx.root, "specs/frs/STE-596.md");
      expect(rows).toEqual([]);
      expect(renderDesignReferenceBlock(rows).text).toBe("");

      // Control: the same call against a tree that DOES carry the section
      // returns rows, so the empty result above measures absence rather than a
      // permanently broken reader.
      const seeded = makeTree(
        {
          "specs/frs/STE-596.md":
            "# STE-596\n\n## Design References\n\n- `specs/design/system/x.png` — X\n",
        },
        ["specs/design/system/x.png"],
      );
      try {
        expect(designReferencesForSpec(seeded.root, "specs/frs/STE-596.md").length).toBe(1);
      } finally {
        seeded.cleanup();
      }
    } finally {
      fx.cleanup();
    }
  });

  test("AC-STE-596.5 — a caption QUOTING the skip marker cannot pass for a skipped row", async () => {
    // Round-1 review finding. With the marker written as a trailing suffix,
    // a RESOLVED row whose author wrote the marker's own words as its caption
    // rendered one em dash away from a genuinely unresolved row — and the
    // block is prose an LLM reads, which has nothing but these bytes to go on.
    // The marker now sits ahead of the code span, a slot a caption can never
    // reach, so the two are distinguishable by position rather than by wording.
    const { renderDesignReferenceBlock } = await loadBlockModule();

    const mimic = renderDesignReferenceBlock([
      {
        path: "specs/design/frs/STE-596/present.png",
        file: "specs/frs/STE-596.md",
        line: 9,
        // The caption an author would have to write to forge a skip.
        caption: "[unresolved on disk — skipped]",
        resolves: true,
      },
    ]);
    const genuine = renderDesignReferenceBlock([
      {
        path: "specs/design/frs/STE-596/present.png",
        file: "specs/frs/STE-596.md",
        line: 9,
        caption: null,
        resolves: false,
      },
    ]);

    // Control: both rows really did render, so the inequality below is not the
    // trivial one between two empty blocks.
    expect(mimic.lines.length).toBe(2);
    expect(genuine.lines.length).toBe(2);

    // The forged row is not the skipped row, byte for byte...
    expect(mimic.lines[1]).not.toBe(genuine.lines[1]);
    // ...and the marker is what leads the genuine row, never the forged one.
    expect(genuine.lines[1]!.startsWith("- [unresolved on disk — skipped] ")).toBe(true);
    expect(mimic.lines[1]!.startsWith("- [unresolved on disk — skipped] ")).toBe(false);
    // The counters agree with the rendering rather than contradicting it.
    expect(mimic.skipped).toBe(0);
    expect(genuine.skipped).toBe(1);
  });

  test("AC-STE-596.4 — a design caption ending in the `(checked …)` grammar keeps every word", async () => {
    // Round-1 review finding. The caption reader is shared with the external
    // row on purpose, but only the external row HAS somewhere to put a verdict:
    // DesignReferenceRow declares no `checkedAt` and no `verdict`. Stripping
    // that tail off a design caption would delete authored prose into fields
    // that do not exist — silently, and only for the caption unlucky enough to
    // end in that grammar.
    const caption =
      "matches the audited mock (checked 2026-01-01T00:00:00Z: reachable)";
    const fx = makeTree(
      {
        "specs/frs/STE-596.md": [
          "# STE-596",
          "",
          "## Design References",
          "",
          "- `specs/design/frs/STE-596/audited.png` — " + caption,
          "- `https://example.invalid/ref` — a link (checked 2026-01-01T00:00:00Z: reachable)",
          "",
        ].join("\n"),
      },
      ["specs/design/frs/STE-596/audited.png"],
    );
    try {
      const design = scanDesignReferences(fx.root) as unknown as WideRow[];
      // Control: the fixture is read at all, and by BOTH readers.
      expect(design.length).toBe(1);
      const external = scanExternalReferences(fx.root);
      expect(external.length).toBe(1);

      // The design caption survives whole — nothing was moved into a field
      // this row kind does not have.
      expect(design[0]!.caption).toBe(caption);
      expect(Object.keys(design[0]!).sort()).toEqual(
        ["caption", "file", "line", "path", "resolves"].sort(),
      );

      // ...while the external row, which DOES have those fields, still parses
      // the identical tail as a verdict. One reader, two row kinds, and the
      // difference is the row's own shape rather than a second parser.
      expect(external[0]!.caption).toBe("a link");
      expect(external[0]!.verdict).toBe("reachable");
    } finally {
      fx.cleanup();
    }
  });

  test("AC-STE-596.2 — the scanner cannot emit a path carrying a backtick", async () => {
    // Round-1 review finding. The renderer writes `row.path` into a backtick
    // code span verbatim, so a backtick in a path would break the span. The
    // renderer validates nothing by design; the invariant is enforced at the
    // only producer, and this is the test that says so rather than a branch in
    // the renderer that no reachable input could take.
    const fx = makeTree(
      {
        "specs/frs/STE-596.md": [
          "# STE-596",
          "",
          "## Design References",
          "",
          // An author doing the worst thing available: a second backtick pair
          // inside what they meant to be one path.
          "- `specs/design/frs/STE-596/a`b.png` — trying to break the span",
          "- `specs/design/frs/STE-596/plain.png` — an ordinary row",
          "",
        ].join("\n"),
      },
      ["specs/design/frs/STE-596/plain.png"],
    );
    try {
      const rows = scanDesignReferences(fx.root) as unknown as WideRow[];
      // Control: the scan is not vacuous — the ordinary row proves the fixture
      // is readable, so "no backtick found" is a measurement and not a silence.
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.some((r) => r.path.endsWith("plain.png"))).toBe(true);

      for (const row of rows) {
        expect(row.path, `path carries a backtick: ${row.path}`).not.toContain("`");
      }

      // What that buys the rendered block: the PATH's own span always closes,
      // so the path is recoverable as the first backticked token of its row.
      const { renderDesignReferenceBlock } = await loadBlockModule();
      const block = renderDesignReferenceBlock(rows);
      for (let i = 0; i < rows.length; i++) {
        const line = block.lines[i + 1]!;
        const firstToken = /`([^`]*)`/.exec(line);
        expect(firstToken, `no closed code span in: ${line}`).not.toBeNull();
        expect(firstToken![1]).toBe(rows[i]!.path);
      }

      // MEASURED RESIDUAL, recorded rather than asserted away. A CAPTION may
      // carry an odd backtick — it is free prose the scanner copies verbatim,
      // and this fixture's mangled line produces exactly that. It cannot forge
      // a row: the skip marker's slot is ahead of the code span and the path is
      // the first closed token either way, as the loop above just proved. What
      // it can do is leave the row's trailing prose inside an unclosed span for
      // a markdown renderer. Sanitizing it would mean rewriting authored text,
      // which is the one thing this renderer promises not to do, so the case is
      // pinned here as known rather than silently "handled".
      const mangled = block.lines.find((l) => l.includes("a`"));
      expect(mangled, "the mangled fixture row did not render").toBeDefined();
      expect((mangled!.match(/`/g) ?? []).length % 2).toBe(1);
    } finally {
      fx.cleanup();
    }
  });

  test("AC-STE-596.1 — an FR citing zero references renders NOTHING (invocation byte-identical to today)", async () => {
    const { renderDesignReferenceBlock, DESIGN_REFERENCE_CAPABILITY_TOKENS } =
      await loadBlockModule();

    const block = renderDesignReferenceBlock([]);
    // Not "an empty section", not a header with no rows — nothing at all, so
    // an FR that cites no image invokes the check skill exactly as before.
    expect(block.text).toBe("");
    expect(block.lines).toEqual([]);
    expect(block.rendered).toBe(0);
    expect(block.skipped).toBe(0);
    expect(block.token).toBe(DESIGN_REFERENCE_CAPABILITY_TOKENS.none);
  });

  test("AC-STE-596.5 — an unresolved path renders as skipped and never fails the phase", async () => {
    const { renderDesignReferenceBlock, DESIGN_REFERENCE_CAPABILITY_TOKENS } =
      await loadBlockModule();

    const onlyUnresolved = [
      {
        path: "specs/design/frs/STE-596/gone.png",
        file: "specs/frs/STE-596.md",
        line: 9,
        resolves: false,
        caption: "Deleted mockup",
      },
    ];
    // No throw — probe #61 already GATE FAILEDs this condition at error
    // severity; Phase 4b″ failing it a second time would gate the commit on
    // a condition the gate already owns.
    expect(() => renderDesignReferenceBlock(onlyUnresolved)).not.toThrow();

    const block = renderDesignReferenceBlock(onlyUnresolved);
    expect(block.text).toBe(
      [
        "Design references:",
        "- [unresolved on disk — skipped] `specs/design/frs/STE-596/gone.png` — Deleted mockup",
      ].join("\n"),
    );
    expect(block.rendered).toBe(0);
    expect(block.skipped).toBe(1);
    // The FR DID cite a reference, so the cited-none token is wrong here.
    expect(block.token).toBe(DESIGN_REFERENCE_CAPABILITY_TOKENS.passed);
  });

  test("AC-STE-596.7 — exactly one of the two tokens fires, and they are distinct", async () => {
    const { renderDesignReferenceBlock, DESIGN_REFERENCE_CAPABILITY_TOKENS } =
      await loadBlockModule();
    const { passed, none } = DESIGN_REFERENCE_CAPABILITY_TOKENS;

    expect(passed).not.toBe(none);
    // The reverse orphan-scan in `closing_summary_capability_keys` matches
    // ``MUST emit `([a-z_]+)` `` — a digit or a dash would slip past it and
    // the bidirectional invariant would go one-way for exactly these keys.
    expect(passed).toMatch(/^[a-z_]+$/);
    expect(none).toMatch(/^[a-z_]+$/);

    const cited = renderDesignReferenceBlock([
      {
        path: "specs/design/system/tokens.png",
        file: "specs/frs/STE-596.md",
        line: 9,
        resolves: true,
        caption: "Tokens",
      },
    ]);
    expect(cited.token).toBe(passed);
    expect(renderDesignReferenceBlock([]).token).toBe(none);
  });
});
