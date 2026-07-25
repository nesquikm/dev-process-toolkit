// STE-119 AC-STE-119.2 — nextFreeMilestoneNumber helper.
//
// Three-way scan: active plan files, archived plan files, CHANGELOG.md
// `M<N>` references. Returns `max(union) + 1` plus per-source breakdown
// for diagnostic reporting (AC-STE-119.7).

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nextFreeMilestoneNumber } from "./next_free_milestone_number";

interface Fixture {
  specsDir: string;
  changelogPath: string;
  cleanup: () => void;
}

function makeFixture(opts: {
  active?: number[];
  archived?: number[];
  changelog?: string | null;
}): Fixture {
  const root = mkdtempSync(join(tmpdir(), "next-free-milestone-"));
  const specsDir = join(root, "specs");
  mkdirSync(join(specsDir, "plan"), { recursive: true });
  mkdirSync(join(specsDir, "plan", "archive"), { recursive: true });
  for (const n of opts.active ?? []) {
    writeFileSync(join(specsDir, "plan", `M${n}.md`), `---\nmilestone: M${n}\n---\n`);
  }
  for (const n of opts.archived ?? []) {
    writeFileSync(join(specsDir, "plan", "archive", `M${n}.md`), `---\nmilestone: M${n}\nstatus: archived\n---\n`);
  }
  const changelogPath = join(root, "CHANGELOG.md");
  if (opts.changelog !== null && opts.changelog !== undefined) {
    writeFileSync(changelogPath, opts.changelog);
  }
  return { specsDir, changelogPath, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

describe("empty specs", () => {
  test("no plan files → next = 1, all sources empty", async () => {
    const fx = makeFixture({});
    try {
      const got = await nextFreeMilestoneNumber(fx.specsDir);
      expect(got.next).toBe(1);
      expect(got.sources.active).toEqual([]);
      expect(got.sources.archived).toEqual([]);
      expect(got.sources.changelog).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("specs dir does not exist → next = 1", async () => {
    const got = await nextFreeMilestoneNumber("/nonexistent/specs/path");
    expect(got.next).toBe(1);
    expect(got.sources.active).toEqual([]);
    expect(got.sources.archived).toEqual([]);
  });
});

describe("active-only", () => {
  test("active M30 → next = 31", async () => {
    const fx = makeFixture({ active: [30] });
    try {
      const got = await nextFreeMilestoneNumber(fx.specsDir);
      expect(got.next).toBe(31);
      expect(got.sources.active).toEqual([30]);
    } finally {
      fx.cleanup();
    }
  });
});

describe("archived-only", () => {
  test("archived M27, M28, M29 → next = 30", async () => {
    const fx = makeFixture({ archived: [27, 28, 29] });
    try {
      const got = await nextFreeMilestoneNumber(fx.specsDir);
      expect(got.next).toBe(30);
      expect(got.sources.archived).toEqual([27, 28, 29]);
    } finally {
      fx.cleanup();
    }
  });
});

describe("active + archived merge", () => {
  test("active M30, archived M27..29 → next = 31", async () => {
    const fx = makeFixture({ active: [30], archived: [27, 28, 29] });
    try {
      const got = await nextFreeMilestoneNumber(fx.specsDir);
      expect(got.next).toBe(31);
      expect(got.sources.active).toEqual([30]);
      expect(got.sources.archived).toEqual([27, 28, 29]);
    } finally {
      fx.cleanup();
    }
  });
});

describe("gaps preserved (max+1, never gap-reuse)", () => {
  test("archived M12, M13, M16 → next = 17 (does NOT pick M14 or M15)", async () => {
    const fx = makeFixture({ archived: [12, 13, 16] });
    try {
      const got = await nextFreeMilestoneNumber(fx.specsDir);
      expect(got.next).toBe(17);
      expect(got.sources.archived).toEqual([12, 13, 16]);
    } finally {
      fx.cleanup();
    }
  });
});

describe("CHANGELOG scan", () => {
  test("CHANGELOG with M-references → captured in sources.changelog", async () => {
    const changelog = [
      "# Changelog",
      "",
      "## [1.30.0] — 2026-04-25 — \"Loudly\"",
      "",
      "M29 (STE-110, STE-111).",
      "",
      "## [1.29.0] — 2026-04-23 — \"Runbook\"",
      "",
      "M28 (STE-101).",
      "",
    ].join("\n");
    const fx = makeFixture({ active: [30], archived: [27, 28, 29], changelog });
    try {
      const got = await nextFreeMilestoneNumber(fx.specsDir, fx.changelogPath);
      expect(got.next).toBe(31);
      expect(got.sources.changelog).toContain(28);
      expect(got.sources.changelog).toContain(29);
    } finally {
      fx.cleanup();
    }
  });

  test("CHANGELOG missing → empty changelog source, no error", async () => {
    const fx = makeFixture({ active: [30], changelog: null });
    try {
      const got = await nextFreeMilestoneNumber(fx.specsDir, fx.changelogPath);
      expect(got.next).toBe(31);
      expect(got.sources.changelog).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("CHANGELOG path not provided → empty changelog source", async () => {
    const fx = makeFixture({ active: [30] });
    try {
      const got = await nextFreeMilestoneNumber(fx.specsDir);
      expect(got.next).toBe(31);
      expect(got.sources.changelog).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("CHANGELOG empty → empty changelog source", async () => {
    const fx = makeFixture({ active: [30], changelog: "" });
    try {
      const got = await nextFreeMilestoneNumber(fx.specsDir, fx.changelogPath);
      expect(got.next).toBe(31);
      expect(got.sources.changelog).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("CHANGELOG without any M-references → empty source", async () => {
    const fx = makeFixture({ changelog: "# Changelog\n\nNo milestones here.\n" });
    try {
      const got = await nextFreeMilestoneNumber(fx.specsDir, fx.changelogPath);
      expect(got.next).toBe(1);
      expect(got.sources.changelog).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("multiple M-references in one CHANGELOG entry deduplicated", async () => {
    const changelog = "M27 then M27 then M28 — three refs but two unique numbers.";
    const fx = makeFixture({ changelog });
    try {
      const got = await nextFreeMilestoneNumber(fx.specsDir, fx.changelogPath);
      expect(got.sources.changelog).toEqual([27, 28]);
    } finally {
      fx.cleanup();
    }
  });

  test("CHANGELOG-only signal still drives next", async () => {
    const fx = makeFixture({ changelog: "Released M50 in v0.50.0." });
    try {
      const got = await nextFreeMilestoneNumber(fx.specsDir, fx.changelogPath);
      expect(got.next).toBe(51);
      expect(got.sources.changelog).toEqual([50]);
    } finally {
      fx.cleanup();
    }
  });
});

describe("sources sorted ascending", () => {
  test("returned arrays are deterministically sorted", async () => {
    const fx = makeFixture({
      active: [30, 12],
      archived: [29, 27, 28],
      changelog: "M29 M28 M27 in random order",
    });
    try {
      const got = await nextFreeMilestoneNumber(fx.specsDir, fx.changelogPath);
      expect(got.sources.active).toEqual([12, 30]);
      expect(got.sources.archived).toEqual([27, 28, 29]);
      expect(got.sources.changelog).toEqual([27, 28, 29]);
    } finally {
      fx.cleanup();
    }
  });
});

// STE-338 AC-STE-338.4 — branchScanner injection (fifth source).
//
// `nextFreeMilestoneNumber` gains an optional injected 4th param
// `branchScanner?: { listBranchMilestones(): Promise<number[]> }` that mirrors
// the optional `provider`. Its numbers union into the result and surface as
// `sources.branches`; an omitted scanner is vacuous (`branches: []`).
interface BranchScannerStub {
  listBranchMilestones: () => Promise<number[]>;
  calls: number;
}

function makeBranchScanner(numbers: number[]): BranchScannerStub {
  const stub: BranchScannerStub = {
    calls: 0,
    async listBranchMilestones() {
      stub.calls += 1;
      return numbers;
    },
  };
  return stub;
}

describe("AC-STE-338.4: branchScanner union", () => {
  test("injected scanner [88, 90] unions into next and sources.branches", async () => {
    const fx = makeFixture({ active: [30] });
    try {
      const scanner = makeBranchScanner([88, 90]);
      const got = await nextFreeMilestoneNumber(fx.specsDir, fx.changelogPath, undefined, scanner);
      expect(got.sources.branches).toEqual([88, 90]);
      expect(got.next).toBe(91);
      expect(got.sources.active).toEqual([30]);
      expect(scanner.calls).toBe(1);
    } finally {
      fx.cleanup();
    }
  });

  test("branch source unions but is not double-counted when it overlaps a file leg", async () => {
    const fx = makeFixture({ active: [90] });
    try {
      const scanner = makeBranchScanner([88, 90]);
      const got = await nextFreeMilestoneNumber(fx.specsDir, fx.changelogPath, undefined, scanner);
      expect(got.sources.active).toEqual([90]);
      expect(got.sources.branches).toEqual([88, 90]);
      expect(got.next).toBe(91);
    } finally {
      fx.cleanup();
    }
  });

  test("omitted scanner ⇒ sources.branches: [] with next unchanged from the four-way baseline", async () => {
    const fx = makeFixture({ active: [30] });
    try {
      const baseline = await nextFreeMilestoneNumber(fx.specsDir, fx.changelogPath);
      const got = await nextFreeMilestoneNumber(fx.specsDir, fx.changelogPath, undefined);
      expect(got.sources.branches).toEqual([]);
      expect(got.next).toBe(baseline.next);
      expect(got.next).toBe(31);
    } finally {
      fx.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// STE-376 AC-STE-376.3 — M_<epic-key> tolerance. Epic-keyed milestone ids are
// opaque: the scan accepts them without error and EXCLUDES them from the
// `max(M<N>) + 1` computation — an `M_<key>` id is never parsed as an integer
// and never bumps the sequential counter.
// ---------------------------------------------------------------------------

describe("AC-STE-376.3 — epic-keyed ids never join the sequential union", () => {
  test("active {M100, M_PROJ_500} → next 101 (epic id excluded from max)", async () => {
    const fx = makeFixture({ active: [100] });
    try {
      writeFileSync(
        join(fx.specsDir, "plan", "M_PROJ_500.md"),
        "---\nmilestone: M_PROJ_500\nstatus: active\n---\n\n## M_PROJ_500: Epic-keyed milestone\n",
      );
      const got = await nextFreeMilestoneNumber(fx.specsDir);
      expect(got.next).toBe(101);
      expect(got.sources.active).toEqual([100]);
    } finally {
      fx.cleanup();
    }
  });

  test("archived M_PROJ_500 never parses as an integer (no NaN, no 500)", async () => {
    const fx = makeFixture({ active: [40], archived: [39] });
    try {
      writeFileSync(
        join(fx.specsDir, "plan", "archive", "M_PROJ_500.md"),
        "---\nmilestone: M_PROJ_500\nstatus: archived\n---\n",
      );
      const got = await nextFreeMilestoneNumber(fx.specsDir);
      expect(got.next).toBe(41);
      // The five numeric source lists must stay integer-only — an opaque
      // epic id must never surface as NaN or as its trailing digits.
      const numericLists = [
        got.sources.active,
        got.sources.archived,
        got.sources.changelog,
        got.sources.tracker,
        got.sources.branches,
      ];
      for (const list of numericLists) {
        expect(list.every((n) => Number.isInteger(n))).toBe(true);
        expect(list).not.toContain(500);
      }
    } finally {
      fx.cleanup();
    }
  });

  test("tracker milestones {M100, M_PROJ_500, M_PROJ-500} → tracker [100], next 101, no error", async () => {
    const fx = makeFixture({});
    try {
      const provider = {
        listMilestones: async () => [
          { name: "M100" },
          { name: "M_PROJ_500" },
          { name: "M_PROJ-500" },
        ],
      };
      const got = await nextFreeMilestoneNumber(fx.specsDir, undefined, provider);
      expect(got.next).toBe(101);
      expect(got.sources.tracker).toEqual([100]);
    } finally {
      fx.cleanup();
    }
  });

  test("CHANGELOG naming M_PROJ_500 contributes no numeric ref", async () => {
    const fx = makeFixture({
      changelog: "# Changelog\n\nM99 shipped. M_PROJ_500 ships from the Epic lane.\n",
    });
    try {
      const got = await nextFreeMilestoneNumber(fx.specsDir, fx.changelogPath);
      expect(got.sources.changelog).toEqual([99]);
      expect(got.next).toBe(100);
    } finally {
      fx.cleanup();
    }
  });

  test("epic-only specs tree → next 1 (epic ids never seed the counter)", async () => {
    const fx = makeFixture({});
    try {
      writeFileSync(
        join(fx.specsDir, "plan", "M_PROJ_500.md"),
        "---\nmilestone: M_PROJ_500\nstatus: active\n---\n",
      );
      const got = await nextFreeMilestoneNumber(fx.specsDir);
      expect(got.next).toBe(1);
    } finally {
      fx.cleanup();
    }
  });
});
