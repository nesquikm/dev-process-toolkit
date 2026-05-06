// STE-227 AC-STE-227.9 — `/gate-check` probe `needs_technical_review_consistency`.
//
// Bidirectional invariant: when frontmatter has `needs_technical_review: true`,
// the `## Technical Design` and `## Testing` body sections MUST contain the
// canonical placeholder substring (substring match, not byte-exact, so future
// placeholder copy edits don't break old archived FRs).
//
// When the flag is absent or false, those sections MUST be non-placeholder
// content (non-empty AND not containing the placeholder substring).
//
// Severity: error. Hard fail on mismatch with NFR-10 canonical shape
// (file:line:column).
//
// This test imports the not-yet-implemented module:
//   adapters/_shared/src/needs_technical_review_consistency.ts
// — the import will fail at compile time until the file exists. That is the
// intended RED state for TDD.

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// Module not yet present — import path is the AC.9 implementation target.
import { runNeedsTechnicalReviewConsistencyProbe } from "../adapters/_shared/src/needs_technical_review_consistency";

interface Fixture {
  root: string;
  cleanup: () => void;
}

const PLACEHOLDER = "[needs technical review — run /spec-write";

function frBody(opts: {
  flag?: boolean;
  techDesignBody: string;
  testingBody: string;
  milestone?: string;
}): string {
  const lines: string[] = ["---"];
  lines.push("title: t");
  lines.push(`milestone: ${opts.milestone ?? "M60"}`);
  lines.push("status: active");
  lines.push("archived_at: null");
  lines.push("tracker:");
  lines.push("  linear: STE-227");
  if (opts.flag === true) lines.push("needs_technical_review: true");
  lines.push("created_at: 2026-05-05T13:24:13Z");
  lines.push("---");
  lines.push("");
  lines.push("# STE-227: title");
  lines.push("");
  lines.push("## Requirement");
  lines.push("");
  lines.push("Some non-empty real requirement prose.");
  lines.push("");
  lines.push("## Acceptance Criteria");
  lines.push("");
  lines.push("- AC-STE-227.1: foo");
  lines.push("");
  lines.push("## Technical Design");
  lines.push("");
  lines.push(opts.techDesignBody);
  lines.push("");
  lines.push("## Testing");
  lines.push("");
  lines.push(opts.testingBody);
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push("Notes prose.");
  return lines.join("\n") + "\n";
}

function makeFixture(files: Record<string, string>): Fixture {
  const root = mkdtempSync(join(tmpdir(), "ntr-probe-"));
  const frsDir = join(root, "specs", "frs");
  mkdirSync(frsDir, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(frsDir, name), body);
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

describe("AC-STE-227.9 — positive: flag-set + placeholder body → PASS", () => {
  test("flag:true with canonical placeholders in both sections → no violations", async () => {
    const fx = makeFixture({
      "STE-300.md": frBody({
        flag: true,
        techDesignBody: `${PLACEHOLDER} STE-300 to complete]`,
        testingBody: `${PLACEHOLDER} STE-300 to complete]`,
      }),
    });
    try {
      const r = await runNeedsTechnicalReviewConsistencyProbe(fx.root);
      expect(r.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });
});

describe("AC-STE-227.9 — positive: flag absent + non-placeholder body → PASS", () => {
  test("no flag, real Technical Design + Testing prose → no violations", async () => {
    const fx = makeFixture({
      "STE-301.md": frBody({
        techDesignBody: "Real architecture description with substance.",
        testingBody: "Real testing strategy with substance.",
      }),
    });
    try {
      const r = await runNeedsTechnicalReviewConsistencyProbe(fx.root);
      expect(r.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });
});

describe("AC-STE-227.9 — negative: flag-set + non-placeholder body → FAIL", () => {
  test("flag:true but body has real prose → violation surfaced", async () => {
    const fx = makeFixture({
      "STE-302.md": frBody({
        flag: true,
        techDesignBody: "Real architecture prose, no placeholder.",
        testingBody: "Real test plan, no placeholder.",
      }),
    });
    try {
      const r = await runNeedsTechnicalReviewConsistencyProbe(fx.root);
      expect(r.violations.length).toBeGreaterThan(0);
      const v = r.violations[0]!;
      expect(v.message).toMatch(/needs_technical_review_consistency/);
      expect(v.message).toMatch(/Remedy:/);
      expect(v.file).toMatch(/STE-302\.md/);
    } finally {
      fx.cleanup();
    }
  });
});

describe("AC-STE-227.9 — negative: flag absent + placeholder body → FAIL", () => {
  test("no flag but Technical Design contains placeholder → violation", async () => {
    const fx = makeFixture({
      "STE-303.md": frBody({
        techDesignBody: `${PLACEHOLDER} STE-303 to complete]`,
        testingBody: "Real testing prose.",
      }),
    });
    try {
      const r = await runNeedsTechnicalReviewConsistencyProbe(fx.root);
      expect(r.violations.length).toBeGreaterThan(0);
      const hit = r.violations.find((v) => v.file.endsWith("STE-303.md"));
      expect(hit).toBeDefined();
      expect(hit!.message).toMatch(/needs_technical_review_consistency/);
    } finally {
      fx.cleanup();
    }
  });
});

describe("AC-STE-227.9 — negative: flag absent + Testing section placeholder → FAIL", () => {
  test("no flag but Testing contains placeholder → violation", async () => {
    const fx = makeFixture({
      "STE-304.md": frBody({
        techDesignBody: "Real architecture prose.",
        testingBody: `${PLACEHOLDER} STE-304 to complete]`,
      }),
    });
    try {
      const r = await runNeedsTechnicalReviewConsistencyProbe(fx.root);
      expect(r.violations.length).toBeGreaterThan(0);
      const hit = r.violations.find((v) => v.file.endsWith("STE-304.md"));
      expect(hit).toBeDefined();
    } finally {
      fx.cleanup();
    }
  });
});

describe("AC-STE-227.9 — file:line:column reporting in NFR-10 shape", () => {
  test("violation note includes file:line shape", async () => {
    const fx = makeFixture({
      "STE-305.md": frBody({
        flag: true,
        techDesignBody: "Real architecture, no placeholder — violation.",
        testingBody: "Real testing, no placeholder — violation.",
      }),
    });
    try {
      const r = await runNeedsTechnicalReviewConsistencyProbe(fx.root);
      expect(r.violations.length).toBeGreaterThan(0);
      const v = r.violations[0]!;
      expect(v.line).toBeGreaterThan(0);
      // NFR-10 canonical: Remedy + Context fields present.
      expect(v.message).toMatch(/Remedy:/);
      expect(v.message).toMatch(/Context:/);
    } finally {
      fx.cleanup();
    }
  });
});

describe("AC-STE-227.9 — vacuous: archive directory and absent specs", () => {
  test("archived FRs are not walked", async () => {
    const root = mkdtempSync(join(tmpdir(), "ntr-archive-"));
    try {
      mkdirSync(join(root, "specs", "frs", "archive"), { recursive: true });
      writeFileSync(
        join(root, "specs", "frs", "archive", "STE-100.md"),
        // archived shape: status: archived, flag-set with no placeholder —
        // would fail the active-side invariant if walked, but the probe
        // must skip archive/.
        `---\ntitle: t\nmilestone: M50\nstatus: archived\narchived_at: 2026-04-25T00:00:00Z\ntracker:\n  linear: STE-100\nneeds_technical_review: true\ncreated_at: 2026-04-25T00:00:00Z\n---\n\n## Technical Design\n\nReal prose.\n\n## Testing\n\nReal prose.\n`,
      );
      const r = await runNeedsTechnicalReviewConsistencyProbe(root);
      expect(r.violations).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("absent specs/ directory → no violations (vacuous)", async () => {
    const root = mkdtempSync(join(tmpdir(), "ntr-empty-"));
    try {
      const r = await runNeedsTechnicalReviewConsistencyProbe(root);
      expect(r.violations).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("AC-STE-227.9 — substring match (not byte-exact) for placeholder", () => {
  test("placeholder copy variation still matches as long as substring present", async () => {
    // The AC says: "substring match, not byte-exact, to allow future
    // placeholder copy edits". The canonical anchor is "needs technical
    // review —" — the probe should match that prefix even if the copy
    // around it changes.
    const fx = makeFixture({
      "STE-306.md": frBody({
        flag: true,
        techDesignBody:
          "[needs technical review — please run /spec-write STE-306 to complete the technical sections]",
        testingBody:
          "[needs technical review — please run /spec-write STE-306 to complete the technical sections]",
      }),
    });
    try {
      const r = await runNeedsTechnicalReviewConsistencyProbe(fx.root);
      expect(r.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("anchor rejects bare two-word phrase without em-dash (false-positive guard)", async () => {
    // The narrower "needs technical review" substring would falsely match
    // ordinary prose like this paragraph; the em-dash anchor pins the
    // placeholder shape specifically.
    const fx = makeFixture({
      "STE-307.md": frBody({
        flag: false,
        techDesignBody:
          "This section needs technical review by an expert before merging — but it is genuine technical content.",
        testingBody:
          "Another paragraph that incidentally states this also needs technical review by reviewers.",
      }),
    });
    try {
      const r = await runNeedsTechnicalReviewConsistencyProbe(fx.root);
      expect(r.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });
});

describe("AC-STE-227.9 — empty_section violation (flag absent + empty body)", () => {
  test("flag-absent + Technical Design body empty → empty_section violation", async () => {
    const fx = makeFixture({
      "STE-308.md": frBody({
        flag: false,
        techDesignBody: "",
        testingBody: "Real testing prose.",
      }),
    });
    try {
      const r = await runNeedsTechnicalReviewConsistencyProbe(fx.root);
      expect(r.violations.length).toBe(1);
      const v = r.violations[0]!;
      expect(v.note).toMatch(/empty_section/);
      expect(v.note).toMatch(/Technical Design.*section is empty/);
      expect(v.message).toMatch(/empty body/);
    } finally {
      fx.cleanup();
    }
  });

  test("flag-absent + Testing body empty → empty_section violation", async () => {
    const fx = makeFixture({
      "STE-309.md": frBody({
        flag: false,
        techDesignBody: "Real technical prose.",
        testingBody: "",
      }),
    });
    try {
      const r = await runNeedsTechnicalReviewConsistencyProbe(fx.root);
      expect(r.violations.length).toBe(1);
      const v = r.violations[0]!;
      expect(v.note).toMatch(/empty_section/);
      expect(v.note).toMatch(/Testing.*section is empty/);
    } finally {
      fx.cleanup();
    }
  });
});

describe("AC-STE-227.9 — missing_section violation (heading absent entirely)", () => {
  test("flag-set + Technical Design heading missing → missing_section violation", async () => {
    // Construct an FR file by hand omitting the `## Technical Design` heading.
    const fr = [
      "---",
      "title: t",
      "milestone: M60",
      "status: active",
      "archived_at: null",
      "tracker:",
      "  linear: STE-310",
      "needs_technical_review: true",
      "created_at: 2026-05-05T13:24:13Z",
      "---",
      "",
      "# STE-310: title",
      "",
      "## Requirement",
      "",
      "Real prose.",
      "",
      "## Acceptance Criteria",
      "",
      "- AC-STE-310.1: foo",
      "",
      "## Testing",
      "",
      "[needs technical review — run /spec-write STE-310 to complete]",
      "",
      "## Notes",
      "",
      "Notes.",
      "",
    ].join("\n");
    const fx = makeFixture({ "STE-310.md": fr });
    try {
      const r = await runNeedsTechnicalReviewConsistencyProbe(fx.root);
      expect(r.violations.length).toBe(1);
      const v = r.violations[0]!;
      expect(v.note).toMatch(/missing_section/);
      expect(v.note).toMatch(/Technical Design.*heading entirely/);
      expect(v.message).toMatch(/canonical 5-section FR shape/);
    } finally {
      fx.cleanup();
    }
  });

  test("flag-absent + Testing heading missing → missing_section violation regardless of flag", async () => {
    const fr = [
      "---",
      "title: t",
      "milestone: M60",
      "status: active",
      "archived_at: null",
      "tracker:",
      "  linear: STE-311",
      "created_at: 2026-05-05T13:24:13Z",
      "---",
      "",
      "# STE-311: title",
      "",
      "## Requirement",
      "",
      "Real prose.",
      "",
      "## Acceptance Criteria",
      "",
      "- AC-STE-311.1: foo",
      "",
      "## Technical Design",
      "",
      "Real technical prose here.",
      "",
      "## Notes",
      "",
      "Notes.",
      "",
    ].join("\n");
    const fx = makeFixture({ "STE-311.md": fr });
    try {
      const r = await runNeedsTechnicalReviewConsistencyProbe(fx.root);
      expect(r.violations.length).toBe(1);
      expect(r.violations[0]!.note).toMatch(/Testing.*heading entirely.*missing_section/);
    } finally {
      fx.cleanup();
    }
  });
});
