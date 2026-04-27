// STE-119 AC-STE-119.4 / AC-STE-119.5 — frontmatter-milestone-not-archived
// probe (#27).
//
// For each `status: active` FR file under `specs/frs/`:
//   1. Read frontmatter `milestone:` value.
//   2. If `<specsDir>/plan/archive/<value>.md` exists → hard fail (collision).
//   3. If matching active plan file → pass.
//   4. If neither → hard fail (orphan, separate diagnostic).
//
// Vacuous on archived FRs (their milestone naturally matches an archived
// plan file by construction). Mode-agnostic.

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runFrontmatterMilestoneNotArchivedProbe } from "../adapters/_shared/src/frontmatter_milestone_not_archived";

interface Fixture {
  root: string;
  cleanup: () => void;
}

function makeFixture(opts: {
  active?: { id: string; milestone: string }[];
  archived?: { id: string; milestone: string }[];
  malformed?: { id: string; body: string }[];
  activePlans?: number[];
  archivedPlans?: number[];
}): Fixture {
  const root = mkdtempSync(join(tmpdir(), "ftmillgate-"));
  const specs = join(root, "specs");
  mkdirSync(join(specs, "frs"), { recursive: true });
  mkdirSync(join(specs, "frs", "archive"), { recursive: true });
  mkdirSync(join(specs, "plan"), { recursive: true });
  mkdirSync(join(specs, "plan", "archive"), { recursive: true });

  for (const fr of opts.active ?? []) {
    writeFileSync(
      join(specs, "frs", `${fr.id}.md`),
      `---\ntitle: t\nmilestone: ${fr.milestone}\nstatus: active\narchived_at: null\ntracker: {}\ncreated_at: 2026-04-27T00:00:00Z\n---\n\nbody\n`,
    );
  }
  for (const fr of opts.archived ?? []) {
    writeFileSync(
      join(specs, "frs", "archive", `${fr.id}.md`),
      `---\ntitle: t\nmilestone: ${fr.milestone}\nstatus: archived\narchived_at: 2026-04-25T00:00:00Z\ntracker: {}\ncreated_at: 2026-04-25T00:00:00Z\n---\n\nbody\n`,
    );
  }
  for (const fr of opts.malformed ?? []) {
    writeFileSync(join(specs, "frs", `${fr.id}.md`), fr.body);
  }
  for (const n of opts.activePlans ?? []) {
    writeFileSync(join(specs, "plan", `M${n}.md`), `---\nmilestone: M${n}\nstatus: active\n---\n`);
  }
  for (const n of opts.archivedPlans ?? []) {
    writeFileSync(join(specs, "plan", "archive", `M${n}.md`), `---\nmilestone: M${n}\nstatus: archived\n---\n`);
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

describe("happy path: active FR matches active plan file", () => {
  test("STE-117 → M31 (active plan exists) → pass", async () => {
    const fx = makeFixture({
      active: [{ id: "STE-117", milestone: "M31" }],
      activePlans: [31],
    });
    try {
      const r = await runFrontmatterMilestoneNotArchivedProbe(fx.root);
      expect(r.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });
});

describe("vacuous: archived FRs", () => {
  test("archived FR pointing at archived plan → vacuous pass", async () => {
    const fx = makeFixture({
      archived: [{ id: "STE-100", milestone: "M27" }],
      archivedPlans: [27],
    });
    try {
      const r = await runFrontmatterMilestoneNotArchivedProbe(fx.root);
      expect(r.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });
});

describe("hard fail: collision (active FR pointing at archived plan)", () => {
  test("active STE-118 → M28 (archived) → fail naming both files", async () => {
    const fx = makeFixture({
      active: [{ id: "STE-118", milestone: "M28" }],
      archivedPlans: [28],
    });
    try {
      const r = await runFrontmatterMilestoneNotArchivedProbe(fx.root);
      expect(r.violations.length).toBe(1);
      const v = r.violations[0]!;
      expect(v.note).toMatch(/STE-118\.md/);
      expect(v.note).toMatch(/M28/);
      expect(v.note).toMatch(/collision/i);
      expect(v.message).toMatch(/Remedy:/);
      expect(v.message).toMatch(/Context:/);
      expect(v.message).toMatch(/probe=frontmatter_milestone_not_archived/);
    } finally {
      fx.cleanup();
    }
  });
});

describe("hard fail: orphan (no plan file at all)", () => {
  test("active FR pointing at non-existent plan → fail (orphan diagnostic)", async () => {
    const fx = makeFixture({
      active: [{ id: "STE-200", milestone: "M99" }],
    });
    try {
      const r = await runFrontmatterMilestoneNotArchivedProbe(fx.root);
      expect(r.violations.length).toBe(1);
      expect(r.violations[0]!.note).toMatch(/orphan|no plan file/i);
    } finally {
      fx.cleanup();
    }
  });
});

describe("hard fail: malformed frontmatter", () => {
  test("FR file missing milestone: → fail (malformed diagnostic)", async () => {
    const fx = makeFixture({
      malformed: [{ id: "STE-300", body: "---\ntitle: t\nstatus: active\n---\n\nbody\n" }],
    });
    try {
      const r = await runFrontmatterMilestoneNotArchivedProbe(fx.root);
      expect(r.violations.length).toBe(1);
      expect(r.violations[0]!.note).toMatch(/malformed|missing/i);
    } finally {
      fx.cleanup();
    }
  });
});

describe("multi-FR cohort", () => {
  test("mix: 1 active OK + 1 collision + 1 archived (vacuous) → 1 violation only", async () => {
    const fx = makeFixture({
      active: [
        { id: "STE-117", milestone: "M31" },
        { id: "STE-118", milestone: "M28" }, // collision
      ],
      archived: [{ id: "STE-100", milestone: "M27" }],
      activePlans: [31],
      archivedPlans: [27, 28],
    });
    try {
      const r = await runFrontmatterMilestoneNotArchivedProbe(fx.root);
      expect(r.violations.length).toBe(1);
      expect(r.violations[0]!.note).toMatch(/STE-118\.md/);
    } finally {
      fx.cleanup();
    }
  });
});

describe("vacuous when specs/ does not exist", () => {
  test("absent specs dir → no violations", async () => {
    const root = mkdtempSync(join(tmpdir(), "ftmillgate-empty-"));
    try {
      const r = await runFrontmatterMilestoneNotArchivedProbe(root);
      expect(r.violations).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
