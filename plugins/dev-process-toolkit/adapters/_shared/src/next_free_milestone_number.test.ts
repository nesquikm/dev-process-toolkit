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
  test("no plan files → next = 1, all sources empty", () => {
    const fx = makeFixture({});
    try {
      const got = nextFreeMilestoneNumber(fx.specsDir);
      expect(got.next).toBe(1);
      expect(got.sources.active).toEqual([]);
      expect(got.sources.archived).toEqual([]);
      expect(got.sources.changelog).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("specs dir does not exist → next = 1", () => {
    const got = nextFreeMilestoneNumber("/nonexistent/specs/path");
    expect(got.next).toBe(1);
    expect(got.sources.active).toEqual([]);
    expect(got.sources.archived).toEqual([]);
  });
});

describe("active-only", () => {
  test("active M30 → next = 31", () => {
    const fx = makeFixture({ active: [30] });
    try {
      const got = nextFreeMilestoneNumber(fx.specsDir);
      expect(got.next).toBe(31);
      expect(got.sources.active).toEqual([30]);
    } finally {
      fx.cleanup();
    }
  });
});

describe("archived-only", () => {
  test("archived M27, M28, M29 → next = 30", () => {
    const fx = makeFixture({ archived: [27, 28, 29] });
    try {
      const got = nextFreeMilestoneNumber(fx.specsDir);
      expect(got.next).toBe(30);
      expect(got.sources.archived).toEqual([27, 28, 29]);
    } finally {
      fx.cleanup();
    }
  });
});

describe("active + archived merge", () => {
  test("active M30, archived M27..29 → next = 31", () => {
    const fx = makeFixture({ active: [30], archived: [27, 28, 29] });
    try {
      const got = nextFreeMilestoneNumber(fx.specsDir);
      expect(got.next).toBe(31);
      expect(got.sources.active).toEqual([30]);
      expect(got.sources.archived).toEqual([27, 28, 29]);
    } finally {
      fx.cleanup();
    }
  });
});

describe("gaps preserved (max+1, never gap-reuse)", () => {
  test("archived M12, M13, M16 → next = 17 (does NOT pick M14 or M15)", () => {
    const fx = makeFixture({ archived: [12, 13, 16] });
    try {
      const got = nextFreeMilestoneNumber(fx.specsDir);
      expect(got.next).toBe(17);
      expect(got.sources.archived).toEqual([12, 13, 16]);
    } finally {
      fx.cleanup();
    }
  });
});

describe("CHANGELOG scan", () => {
  test("CHANGELOG with M-references → captured in sources.changelog", () => {
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
      const got = nextFreeMilestoneNumber(fx.specsDir, fx.changelogPath);
      expect(got.next).toBe(31);
      expect(got.sources.changelog).toContain(28);
      expect(got.sources.changelog).toContain(29);
    } finally {
      fx.cleanup();
    }
  });

  test("CHANGELOG missing → empty changelog source, no error", () => {
    const fx = makeFixture({ active: [30], changelog: null });
    try {
      const got = nextFreeMilestoneNumber(fx.specsDir, fx.changelogPath);
      expect(got.next).toBe(31);
      expect(got.sources.changelog).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("CHANGELOG path not provided → empty changelog source", () => {
    const fx = makeFixture({ active: [30] });
    try {
      const got = nextFreeMilestoneNumber(fx.specsDir);
      expect(got.next).toBe(31);
      expect(got.sources.changelog).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("CHANGELOG empty → empty changelog source", () => {
    const fx = makeFixture({ active: [30], changelog: "" });
    try {
      const got = nextFreeMilestoneNumber(fx.specsDir, fx.changelogPath);
      expect(got.next).toBe(31);
      expect(got.sources.changelog).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("CHANGELOG without any M-references → empty source", () => {
    const fx = makeFixture({ changelog: "# Changelog\n\nNo milestones here.\n" });
    try {
      const got = nextFreeMilestoneNumber(fx.specsDir, fx.changelogPath);
      expect(got.next).toBe(1);
      expect(got.sources.changelog).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("multiple M-references in one CHANGELOG entry deduplicated", () => {
    const changelog = "M27 then M27 then M28 — three refs but two unique numbers.";
    const fx = makeFixture({ changelog });
    try {
      const got = nextFreeMilestoneNumber(fx.specsDir, fx.changelogPath);
      expect(got.sources.changelog).toEqual([27, 28]);
    } finally {
      fx.cleanup();
    }
  });

  test("CHANGELOG-only signal still drives next", () => {
    const fx = makeFixture({ changelog: "Released M50 in v0.50.0." });
    try {
      const got = nextFreeMilestoneNumber(fx.specsDir, fx.changelogPath);
      expect(got.next).toBe(51);
      expect(got.sources.changelog).toEqual([50]);
    } finally {
      fx.cleanup();
    }
  });
});

describe("sources sorted ascending", () => {
  test("returned arrays are deterministically sorted", () => {
    const fx = makeFixture({
      active: [30, 12],
      archived: [29, 27, 28],
      changelog: "M29 M28 M27 in random order",
    });
    try {
      const got = nextFreeMilestoneNumber(fx.specsDir, fx.changelogPath);
      expect(got.sources.active).toEqual([12, 30]);
      expect(got.sources.archived).toEqual([27, 28, 29]);
      expect(got.sources.changelog).toEqual([27, 28, 29]);
    } finally {
      fx.cleanup();
    }
  });
});
