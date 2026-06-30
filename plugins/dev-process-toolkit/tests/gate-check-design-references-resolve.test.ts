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
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { scanDesignReferences } from "../adapters/_shared/src/scan_design_references";

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
});
