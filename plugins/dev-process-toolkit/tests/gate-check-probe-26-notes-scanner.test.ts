// STE-214 — /gate-check probe #26 milestone-attach respects FR `## Notes`
// capability-gap declaration for the FULL set of milestone-attach keys.
//
// M54 (STE-198) split the milestone-attach capability into two canonical
// keys: `milestone_attach_skipped_adapter_limit` (adapter doesn't support
// project_milestone) and `milestone_create_required` (auto-created the
// milestone). The original STE-194 implementation only recognized the
// deprecated alias `milestone_attach_unavailable`; this FR widens the
// recognized set so probe #26 honors any of the three keys when scanning
// the FR's `## Notes` section before issuing GATE FAILED for a missing
// projectMilestone binding.
//
// Decision table (extension of STE-194's row set):
//   token in `## Notes`                       | binding | outcome
//   `milestone_attach_skipped_adapter_limit`  | absent  | ADVISORY
//   `milestone_attach_unavailable` (alias)    | absent  | ADVISORY
//   `milestone_create_required`               | absent  | ADVISORY
//   any of the above                          | present | PASS (binding wins)
//   none                                      | absent  | GATE FAILED (preserved)

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTrackerProjectMilestoneAttachedProbe } from "../adapters/_shared/src/tracker_project_milestone_attached";

interface IssueState {
  id: string;
  projectMilestone?: { name: string } | null;
}

interface FixtureOpts {
  active: { id: string; milestone: string; trackerId: string; body: string }[];
  activePlans: { n: number; heading: string }[];
}

function makeFixture(opts: FixtureOpts): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "probe-26-notes-scanner-"));
  const specs = join(root, "specs");
  mkdirSync(join(specs, "frs"), { recursive: true });
  mkdirSync(join(specs, "plan"), { recursive: true });
  writeFileSync(
    join(root, "CLAUDE.md"),
    `# Project\n\n## Task Tracking\n\nmode: linear\nmcp_server: linear\n\n### Linear\n\nteam: STE\nproject: DPT\n`,
  );
  for (const fr of opts.active) {
    writeFileSync(
      join(specs, "frs", `${fr.id}.md`),
      `---\ntitle: t\nmilestone: ${fr.milestone}\nstatus: active\narchived_at: null\ntracker:\n  linear: ${fr.trackerId}\ncreated_at: 2026-04-27T00:00:00Z\n---\n\n${fr.body}`,
    );
  }
  for (const plan of opts.activePlans) {
    writeFileSync(
      join(specs, "plan", `M${plan.n}.md`),
      `---\nmilestone: M${plan.n}\nstatus: active\n---\n\n# ${plan.heading}\n`,
    );
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function makeIssueLookup(issues: IssueState[]) {
  return async (ticketId: string): Promise<{ projectMilestone?: { name: string } | null }> => {
    const found = issues.find((i) => i.id === ticketId);
    if (!found) return { projectMilestone: null };
    return { projectMilestone: found.projectMilestone ?? null };
  };
}

describe("AC-STE-214.1 — probe #26 reads `## Notes` for the full milestone-attach key set", () => {
  test("`milestone_attach_skipped_adapter_limit` (canonical) in `## Notes` + no binding ⇒ ADVISORY", async () => {
    const fx = makeFixture({
      active: [
        {
          id: "STE-214a",
          milestone: "M55",
          trackerId: "STE-214a",
          body: "## Notes\n\n- Capability: `milestone_attach_skipped_adapter_limit` — adapter has no project_milestone support.\n",
        },
      ],
      activePlans: [{ n: 55, heading: "M55 — Smoke Findings Sweep" }],
    });
    try {
      const r = await runTrackerProjectMilestoneAttachedProbe(fx.root, {
        getIssue: makeIssueLookup([{ id: "STE-214a", projectMilestone: null }]),
      });
      expect(r.violations).toEqual([]);
      expect(r.advisories.length).toBe(1);
    } finally {
      fx.cleanup();
    }
  });

  test("`milestone_create_required` in `## Notes` + no binding ⇒ ADVISORY", async () => {
    const fx = makeFixture({
      active: [
        {
          id: "STE-214b",
          milestone: "M55",
          trackerId: "STE-214b",
          body: "## Notes\n\n- Capability: `milestone_create_required` — created the milestone, attach pending.\n",
        },
      ],
      activePlans: [{ n: 55, heading: "M55 — Smoke Findings Sweep" }],
    });
    try {
      const r = await runTrackerProjectMilestoneAttachedProbe(fx.root, {
        getIssue: makeIssueLookup([{ id: "STE-214b", projectMilestone: null }]),
      });
      expect(r.violations).toEqual([]);
      expect(r.advisories.length).toBe(1);
    } finally {
      fx.cleanup();
    }
  });

  test("`milestone_attach_unavailable` (deprecated alias) still works ⇒ ADVISORY", async () => {
    const fx = makeFixture({
      active: [
        {
          id: "STE-214c",
          milestone: "M55",
          trackerId: "STE-214c",
          body: "## Notes\n\n- Legacy: `milestone_attach_unavailable` (deprecated alias still honored).\n",
        },
      ],
      activePlans: [{ n: 55, heading: "M55 — Smoke Findings Sweep" }],
    });
    try {
      const r = await runTrackerProjectMilestoneAttachedProbe(fx.root, {
        getIssue: makeIssueLookup([{ id: "STE-214c", projectMilestone: null }]),
      });
      expect(r.violations).toEqual([]);
      expect(r.advisories.length).toBe(1);
    } finally {
      fx.cleanup();
    }
  });
});

describe("AC-STE-214.2 — advisory carries capability key + FR id + prose", () => {
  test("advisory message contains the capability key found", async () => {
    const fx = makeFixture({
      active: [
        {
          id: "STE-214d",
          milestone: "M55",
          trackerId: "STE-214d",
          body: "## Notes\n\n- Capability: `milestone_attach_skipped_adapter_limit`\n",
        },
      ],
      activePlans: [{ n: 55, heading: "M55 — Smoke Findings Sweep" }],
    });
    try {
      const r = await runTrackerProjectMilestoneAttachedProbe(fx.root, {
        getIssue: makeIssueLookup([{ id: "STE-214d", projectMilestone: null }]),
      });
      expect(r.advisories.length).toBe(1);
      const a = r.advisories[0]!;
      expect(a.message).toContain("milestone_attach_skipped_adapter_limit");
      expect(a.note).toMatch(/STE-214d/);
    } finally {
      fx.cleanup();
    }
  });
});

describe("AC-STE-214.3 — no declaration ⇒ GATE FAILED preserved", () => {
  test("`## Notes` empty / no capability key + no binding ⇒ violation, no advisory", async () => {
    const fx = makeFixture({
      active: [
        {
          id: "STE-214e",
          milestone: "M55",
          trackerId: "STE-214e",
          body: "## Notes\n\n- No capability declaration here.\n",
        },
      ],
      activePlans: [{ n: 55, heading: "M55 — Smoke Findings Sweep" }],
    });
    try {
      const r = await runTrackerProjectMilestoneAttachedProbe(fx.root, {
        getIssue: makeIssueLookup([{ id: "STE-214e", projectMilestone: null }]),
      });
      expect(r.advisories).toEqual([]);
      expect(r.violations.length).toBe(1);
    } finally {
      fx.cleanup();
    }
  });
});

describe("AC-STE-214.4 — substring match exactness (word-bounded)", () => {
  test("longer identifier containing the key as substring does NOT downgrade", async () => {
    const fx = makeFixture({
      active: [
        {
          id: "STE-214f",
          milestone: "M55",
          trackerId: "STE-214f",
          body: "## Notes\n\n- Random: xmilestone_attach_skipped_adapter_limitX inside a longer token.\n",
        },
      ],
      activePlans: [{ n: 55, heading: "M55 — Smoke Findings Sweep" }],
    });
    try {
      const r = await runTrackerProjectMilestoneAttachedProbe(fx.root, {
        getIssue: makeIssueLookup([{ id: "STE-214f", projectMilestone: null }]),
      });
      expect(r.advisories).toEqual([]);
      expect(r.violations.length).toBe(1);
    } finally {
      fx.cleanup();
    }
  });

  test("the key must be in `## Notes` (not in `## Acceptance Criteria` or other sections)", async () => {
    const fx = makeFixture({
      active: [
        {
          id: "STE-214g",
          milestone: "M55",
          trackerId: "STE-214g",
          body: "## Acceptance Criteria\n\n- AC.1: handle `milestone_attach_skipped_adapter_limit` upstream.\n\n## Notes\n\n- unrelated.\n",
        },
      ],
      activePlans: [{ n: 55, heading: "M55 — Smoke Findings Sweep" }],
    });
    try {
      const r = await runTrackerProjectMilestoneAttachedProbe(fx.root, {
        getIssue: makeIssueLookup([{ id: "STE-214g", projectMilestone: null }]),
      });
      expect(r.advisories).toEqual([]);
      expect(r.violations.length).toBe(1);
    } finally {
      fx.cleanup();
    }
  });
});

describe("AC-STE-214.5 — deprecated alias + canonical map to identical advisory behavior", () => {
  test("both keys produce the same advisory shape", async () => {
    const fxCanonical = makeFixture({
      active: [
        {
          id: "STE-214h",
          milestone: "M55",
          trackerId: "STE-214h",
          body: "## Notes\n\n- `milestone_attach_skipped_adapter_limit`\n",
        },
      ],
      activePlans: [{ n: 55, heading: "M55 — Smoke Findings Sweep" }],
    });
    const fxAlias = makeFixture({
      active: [
        {
          id: "STE-214i",
          milestone: "M55",
          trackerId: "STE-214i",
          body: "## Notes\n\n- `milestone_attach_unavailable`\n",
        },
      ],
      activePlans: [{ n: 55, heading: "M55 — Smoke Findings Sweep" }],
    });
    try {
      const rCanonical = await runTrackerProjectMilestoneAttachedProbe(fxCanonical.root, {
        getIssue: makeIssueLookup([{ id: "STE-214h", projectMilestone: null }]),
      });
      const rAlias = await runTrackerProjectMilestoneAttachedProbe(fxAlias.root, {
        getIssue: makeIssueLookup([{ id: "STE-214i", projectMilestone: null }]),
      });
      expect(rCanonical.advisories.length).toBe(1);
      expect(rAlias.advisories.length).toBe(1);
      // Both produce ADVISORY (not violation); the rendered prose may
      // differ on the bracketed key, but the shape is identical.
      expect(rCanonical.violations).toEqual([]);
      expect(rAlias.violations).toEqual([]);
    } finally {
      fxCanonical.cleanup();
      fxAlias.cleanup();
    }
  });
});

describe("AC-STE-214.6 — token + binding present ⇒ PASS (binding wins)", () => {
  test("any of the three keys + binding present ⇒ no advisory, no violation", async () => {
    const fx = makeFixture({
      active: [
        {
          id: "STE-214j",
          milestone: "M55",
          trackerId: "STE-214j",
          body: "## Notes\n\n- Stale: `milestone_create_required` after the milestone was attached.\n",
        },
      ],
      activePlans: [{ n: 55, heading: "M55 — Smoke Findings Sweep" }],
    });
    try {
      const r = await runTrackerProjectMilestoneAttachedProbe(fx.root, {
        getIssue: makeIssueLookup([
          { id: "STE-214j", projectMilestone: { name: "M55 — Smoke Findings Sweep" } },
        ]),
      });
      expect(r.advisories).toEqual([]);
      expect(r.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });
});
