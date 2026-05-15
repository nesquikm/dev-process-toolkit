// STE-284 AC-STE-284.1 — nextFreeMilestoneNumber with optional tracker provider.
//
// Verifies the three-way scan extended to a four-way union when a tracker
// Provider is supplied. The new return shape adds `sources.tracker: number[]`
// alongside the existing `active`, `archived`, and `changelog` arrays.
//
// Source-of-truth note: the FR text calls the field `archive` but the
// existing implementation/tests use `archived`. We keep `archived` (per the
// orchestrator's deviation note) to avoid breaking the eight existing tests
// in `next_free_milestone_number.test.ts`.

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nextFreeMilestoneNumber } from "../next_free_milestone_number";

interface Fixture {
  specsDir: string;
  changelogPath: string;
  cleanup: () => void;
}

function makeFixture(opts: { active?: number[]; archived?: number[] }): Fixture {
  const root = mkdtempSync(join(tmpdir(), "next-free-tracker-"));
  const specsDir = join(root, "specs");
  mkdirSync(join(specsDir, "plan"), { recursive: true });
  mkdirSync(join(specsDir, "plan", "archive"), { recursive: true });
  for (const n of opts.active ?? []) {
    writeFileSync(join(specsDir, "plan", `M${n}.md`), `---\nmilestone: M${n}\n---\n`);
  }
  for (const n of opts.archived ?? []) {
    writeFileSync(
      join(specsDir, "plan", "archive", `M${n}.md`),
      `---\nmilestone: M${n}\nstatus: archived\n---\n`,
    );
  }
  const changelogPath = join(root, "CHANGELOG.md");
  return { specsDir, changelogPath, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

interface MilestoneProviderStub {
  listMilestones: (project?: string) => Promise<{ name: string }[]>;
  calls: number;
}

function makeProvider(names: string[]): MilestoneProviderStub {
  const stub: MilestoneProviderStub = {
    calls: 0,
    async listMilestones(_project?: string) {
      stub.calls += 1;
      return names.map((n) => ({ name: n }));
    },
  };
  return stub;
}

describe("AC-STE-284.1: tracker-only collision", () => {
  test("local empty + tracker returns [M70] → next = 71, sources.tracker = [70]", async () => {
    const fx = makeFixture({});
    try {
      const provider = makeProvider(["M70"]);
      const got = await nextFreeMilestoneNumber(fx.specsDir, fx.changelogPath, provider);
      expect(got.next).toBe(71);
      expect(got.sources.tracker).toEqual([70]);
      expect(got.sources.active).toEqual([]);
      expect(got.sources.archived).toEqual([]);
      expect(provider.calls).toBe(1);
    } finally {
      fx.cleanup();
    }
  });
});

describe("AC-STE-284.1: both-side collision", () => {
  test("local M70 + tracker M70 → next = 71 (union, not double-counted)", async () => {
    const fx = makeFixture({ active: [70] });
    try {
      const provider = makeProvider(["M70"]);
      const got = await nextFreeMilestoneNumber(fx.specsDir, fx.changelogPath, provider);
      expect(got.next).toBe(71);
      expect(got.sources.active).toEqual([70]);
      expect(got.sources.tracker).toEqual([70]);
    } finally {
      fx.cleanup();
    }
  });

  test("local M68 + tracker M70 → next = 71 (max wins)", async () => {
    const fx = makeFixture({ active: [68] });
    try {
      const provider = makeProvider(["M70"]);
      const got = await nextFreeMilestoneNumber(fx.specsDir, fx.changelogPath, provider);
      expect(got.next).toBe(71);
      expect(got.sources.active).toEqual([68]);
      expect(got.sources.tracker).toEqual([70]);
    } finally {
      fx.cleanup();
    }
  });
});

describe("AC-STE-284.1: mode-none vacuous", () => {
  test("no provider supplied → tracker source is []", async () => {
    const fx = makeFixture({ active: [30] });
    try {
      const got = await nextFreeMilestoneNumber(fx.specsDir, fx.changelogPath);
      expect(got.next).toBe(31);
      expect(got.sources.tracker).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("provider whose listMilestones returns [] → tracker source is []", async () => {
    const fx = makeFixture({ active: [30] });
    try {
      const provider = makeProvider([]);
      const got = await nextFreeMilestoneNumber(fx.specsDir, fx.changelogPath, provider);
      expect(got.next).toBe(31);
      expect(got.sources.tracker).toEqual([]);
      expect(provider.calls).toBe(1);
    } finally {
      fx.cleanup();
    }
  });
});

describe("AC-STE-284.1: backward-compat 2-arg signature", () => {
  test("existing 2-arg call (specsDir, changelogPath) still works", async () => {
    const fx = makeFixture({ active: [30] });
    try {
      const got = await nextFreeMilestoneNumber(fx.specsDir, fx.changelogPath);
      expect(got.next).toBe(31);
      expect(got.sources.active).toEqual([30]);
      // tracker source MUST be present and empty when omitted.
      expect(got.sources.tracker).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("existing 1-arg call (specsDir only) still works", async () => {
    const fx = makeFixture({ active: [12] });
    try {
      const got = await nextFreeMilestoneNumber(fx.specsDir);
      expect(got.next).toBe(13);
      expect(got.sources.tracker).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });
});

describe("AC-STE-284.1: tracker names that are not M<N> are ignored", () => {
  test("'Backlog' / 'Cycle 7' / 'M70' → only M70 enters the union", async () => {
    const fx = makeFixture({});
    try {
      const provider = makeProvider(["Backlog", "Cycle 7", "M70", "Garbage"]);
      const got = await nextFreeMilestoneNumber(fx.specsDir, fx.changelogPath, provider);
      expect(got.sources.tracker).toEqual([70]);
      expect(got.next).toBe(71);
    } finally {
      fx.cleanup();
    }
  });
});
