// STE-329 AC-STE-329.5 — probe #26 adapter-aware (Jira `label` branch).
//
// Co-located unit suite for runTrackerProjectMilestoneAttachedProbe.
//
// The probe verifies, for each `status: active` tracker-bound FR, that the
// milestone landed on the ticket. The verification surface is adapter-aware:
//   - `object` binding (Linear / default): `projectMilestone.name` byte-equals
//     the canonical plan-file heading. (Exercised by the existing suite at
//     tests/gate-check-tracker-project-milestone-attached.test.ts — must stay
//     green; this file only adds the Jira branch + a Linear regression guard.)
//   - `label` binding (Jira): the ticket's `labels` array contains
//     `milestone-<M-token>`. Hard-fail (violation) on missing OR mismatched
//     label; capability-gap downgrade tokens still apply.
//
// The probe learns which binding the active adapter uses via a new
// `deps.milestoneBinding` injection (`"object"` default when absent). In
// production the gate wires it from the active adapter's
// `milestone_binding:` frontmatter; tests inject it directly. `deps.getIssue`
// widens to optionally surface `labels: string[]` so the label branch can
// assert containment; the object branch ignores it.

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTrackerProjectMilestoneAttachedProbe } from "./tracker_project_milestone_attached";

interface IssueState {
  id: string;
  projectMilestone?: { name: string } | null;
  labels?: string[];
}

interface FixtureOpts {
  active?: {
    id: string;
    milestone: string;
    trackerId?: string;
    // The tracker sub-key under the `tracker:` block. Defaults to `linear`;
    // the Jira-branch scenarios pass `jira` so the probe must identify a
    // genuine `jira: <id>` binding (not a Linear-shaped block).
    trackerKey?: string;
    body?: string;
  }[];
  activePlans?: {
    n: number;
    heading: string;
    // STE-335: when set, the plan body uses this verbatim heading LINE
    // (e.g. `## M86: …` — H2 + colon, the current /spec-write + template
    // format) instead of the legacy `# <heading>` (H1 + em-dash) the builder
    // defaults to. Lets the probe tests exercise current-format plans.
    rawHeadingLine?: string;
  }[];
}

// Minimal tracker-mode fixture (mode: linear is the harness's tracker-mode
// marker — the probe only branches on whether tracker mode is on, the actual
// adapter binding is injected via deps.milestoneBinding).
function makeFixture(opts: FixtureOpts): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "tpm-jira-"));
  const specs = join(root, "specs");
  mkdirSync(join(specs, "frs"), { recursive: true });
  mkdirSync(join(specs, "plan"), { recursive: true });
  writeFileSync(
    join(root, "CLAUDE.md"),
    "# Project\n\n## Task Tracking\n\nmode: linear\nmcp_server: linear\n",
  );
  for (const fr of opts.active ?? []) {
    const trackerBlock = fr.trackerId
      ? `tracker:\n  ${fr.trackerKey ?? "linear"}: ${fr.trackerId}\n`
      : "tracker: {}\n";
    const body = fr.body ?? "body\n";
    writeFileSync(
      join(specs, "frs", `${fr.id}.md`),
      `---\ntitle: t\nmilestone: ${fr.milestone}\nstatus: active\narchived_at: null\n${trackerBlock}created_at: 2026-05-26T00:00:00Z\n---\n\n${body}`,
    );
  }
  for (const plan of opts.activePlans ?? []) {
    const headingLine = plan.rawHeadingLine ?? `# ${plan.heading}`;
    writeFileSync(
      join(specs, "plan", `M${plan.n}.md`),
      `---\nmilestone: M${plan.n}\nstatus: active\n---\n\n${headingLine}\n`,
    );
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function makeIssueLookup(issues: IssueState[]) {
  return async (
    ticketId: string,
  ): Promise<{ projectMilestone?: { name: string } | null; labels?: string[] }> => {
    const found = issues.find((i) => i.id === ticketId);
    if (!found) return { projectMilestone: null, labels: [] };
    return { projectMilestone: found.projectMilestone ?? null, labels: found.labels ?? [] };
  };
}

describe("STE-329 AC-STE-329.5 — Jira label branch: present → pass", () => {
  test("ticket labels contains milestone-<M-token> → zero violations", async () => {
    const fx = makeFixture({
      active: [{ id: "ABC-1", milestone: "M86", trackerId: "ABC-1", trackerKey: "jira" }],
      activePlans: [{ n: 86, heading: "M86 — Jira Project-Milestone Support {#M86}" }],
    });
    try {
      const r = await runTrackerProjectMilestoneAttachedProbe(fx.root, {
        milestoneBinding: "label",
        getIssue: makeIssueLookup([
          { id: "ABC-1", labels: ["spec-driven", "milestone-M86"] },
        ]),
      });
      expect(r.violations).toEqual([]);
      expect(r.advisories).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });
});

describe("STE-329 AC-STE-329.5 — Jira label branch: absent → violation", () => {
  test("labels missing the milestone label → hard fail", async () => {
    const fx = makeFixture({
      active: [{ id: "ABC-1", milestone: "M86", trackerId: "ABC-1", trackerKey: "jira" }],
      activePlans: [{ n: 86, heading: "M86 — Jira Project-Milestone Support {#M86}" }],
    });
    try {
      const r = await runTrackerProjectMilestoneAttachedProbe(fx.root, {
        milestoneBinding: "label",
        // Has other labels but not the milestone one.
        getIssue: makeIssueLookup([{ id: "ABC-1", labels: ["spec-driven"] }]),
      });
      expect(r.violations.length).toBe(1);
      const v = r.violations[0]!;
      expect(v.note).toMatch(/ABC-1/);
      // Pin the expected label name explicitly (not an OR that bare "missing"
      // would satisfy) so a regression in label rendering can't pass silently.
      expect(v.note).toMatch(/milestone-M86/);
      expect(v.note).toMatch(/missing|not attached/i);
      expect(v.message).toMatch(/Remedy:/);
      expect(v.message).toMatch(/probe=tracker_project_milestone_attached/);
    } finally {
      fx.cleanup();
    }
  });

  test("empty labels array → hard fail", async () => {
    const fx = makeFixture({
      active: [{ id: "ABC-1", milestone: "M86", trackerId: "ABC-1", trackerKey: "jira" }],
      activePlans: [{ n: 86, heading: "M86 — Jira Project-Milestone Support {#M86}" }],
    });
    try {
      const r = await runTrackerProjectMilestoneAttachedProbe(fx.root, {
        milestoneBinding: "label",
        getIssue: makeIssueLookup([{ id: "ABC-1", labels: [] }]),
      });
      expect(r.violations.length).toBe(1);
    } finally {
      fx.cleanup();
    }
  });
});

describe("STE-329 AC-STE-329.5 — Jira label branch: mismatch → violation", () => {
  test("a different milestone label present, expected absent → hard fail", async () => {
    const fx = makeFixture({
      active: [{ id: "ABC-1", milestone: "M86", trackerId: "ABC-1", trackerKey: "jira" }],
      activePlans: [{ n: 86, heading: "M86 — Jira Project-Milestone Support {#M86}" }],
    });
    try {
      const r = await runTrackerProjectMilestoneAttachedProbe(fx.root, {
        milestoneBinding: "label",
        // Wrong milestone label (M30) present; the expected milestone-M86 absent.
        getIssue: makeIssueLookup([
          { id: "ABC-1", labels: ["spec-driven", "milestone-M30"] },
        ]),
      });
      expect(r.violations.length).toBe(1);
      const v = r.violations[0]!;
      expect(v.note).toMatch(/ABC-1/);
      expect(v.message).toMatch(/probe=tracker_project_milestone_attached/);
    } finally {
      fx.cleanup();
    }
  });
});

describe("STE-329 AC-STE-329.5 — Jira label branch: capability-gap downgrade still applies", () => {
  test("token in `## Notes` + label absent → advisory (not violation)", async () => {
    const fx = makeFixture({
      active: [
        {
          id: "ABC-1",
          milestone: "M86",
          trackerId: "ABC-1",
          trackerKey: "jira",
          body: "## Notes\n\n- Smoke fixture lacks the label (`milestone_attach_skipped_adapter_limit`).\n",
        },
      ],
      activePlans: [{ n: 86, heading: "M86 — Jira Project-Milestone Support {#M86}" }],
    });
    try {
      const r = await runTrackerProjectMilestoneAttachedProbe(fx.root, {
        milestoneBinding: "label",
        getIssue: makeIssueLookup([{ id: "ABC-1", labels: [] }]),
      });
      expect(r.violations).toEqual([]);
      expect(r.advisories.length).toBe(1);
    } finally {
      fx.cleanup();
    }
  });
});

describe("STE-329 AC-STE-329.5 — Linear object branch stays unchanged under the new signature", () => {
  test("default binding (object): projectMilestone match → pass", async () => {
    const fx = makeFixture({
      active: [{ id: "STE-117", milestone: "M31", trackerId: "STE-117" }],
      activePlans: [{ n: 31, heading: "M31 — Tracker Workflow Hardening {#M31}" }],
    });
    try {
      // No milestoneBinding passed → defaults to object (Linear). The probe
      // must verify by projectMilestone.name, NOT by labels.
      const r = await runTrackerProjectMilestoneAttachedProbe(fx.root, {
        getIssue: makeIssueLookup([
          {
            id: "STE-117",
            projectMilestone: { name: "M31 — Tracker Workflow Hardening" },
            // A stray label must NOT be consulted on the object branch.
            labels: ["milestone-M99"],
          },
        ]),
      });
      expect(r.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("object branch: projectMilestone mismatch → violation (labels ignored)", async () => {
    const fx = makeFixture({
      active: [{ id: "STE-117", milestone: "M31", trackerId: "STE-117" }],
      activePlans: [{ n: 31, heading: "M31 — Tracker Workflow Hardening {#M31}" }],
    });
    try {
      const r = await runTrackerProjectMilestoneAttachedProbe(fx.root, {
        milestoneBinding: "object",
        getIssue: makeIssueLookup([
          {
            id: "STE-117",
            projectMilestone: { name: "M31 — Old name" },
            // Even a correct label must NOT rescue an object-branch mismatch.
            labels: ["milestone-M31"],
          },
        ]),
      });
      expect(r.violations.length).toBe(1);
      const v = r.violations[0]!;
      expect(v.note).toMatch(/M31 — Tracker Workflow Hardening/);
      expect(v.note).toMatch(/M31 — Old name/);
    } finally {
      fx.cleanup();
    }
  });
});

// ───────────────────────────────────────────────────────────────────────
// STE-335 — probe #26 on CURRENT-FORMAT (`## M<N>: <title>`, H2 + colon)
// plans. Pre-fix, readPlanHeading's H1-only regex returns null on these
// plans, so the probe `continue`-skips and passes VACUOUSLY (RED: the probe
// never reaches the binding check). Post-fix readPlanHeading delegates to the
// shared parser, returns the canonical `M<N> — <title>` name, and the binding
// check fires (GREEN).
//
// The canonical name the parser yields normalizes the colon source to an
// em-dash, so the object-branch byte-equality and the label-branch M-token
// derivation both behave exactly as on a legacy em-dash plan.
// ───────────────────────────────────────────────────────────────────────

describe("STE-335 AC-STE-335.3/.5 — Linear object binding on a `## M<N>:` plan", () => {
  // RED-anchoring control: a SECOND active FR on a `## M<N>:` plan whose
  // tracker binding is wrong (mismatch). Pre-fix the H1-only readPlanHeading
  // skips BOTH FRs vacuously → 0 violations, which would let a naive
  // "→ pass" assertion pass without the fix. By pairing the matching FR with a
  // mismatching one and asserting EXACTLY ONE violation (the mismatch, not the
  // match), the test proves the probe actually reached the binding check on a
  // current-format plan — forcing RED pre-fix.
  test("AC-STE-335.5: byte-equals → pass while a sibling `## M<N>:` mismatch → violation (probe reached the check)", async () => {
    const fx = makeFixture({
      active: [
        { id: "STE-117", milestone: "M31", trackerId: "STE-117" },
        { id: "STE-200", milestone: "M88", trackerId: "STE-200" },
      ],
      activePlans: [
        {
          n: 31,
          heading: "unused",
          rawHeadingLine: "## M31: Tracker Workflow Hardening {#M31}",
        },
        {
          n: 88,
          heading: "unused",
          rawHeadingLine: "## M88: Sibling Mismatch Control {#M88}",
        },
      ],
    });
    try {
      const r = await runTrackerProjectMilestoneAttachedProbe(fx.root, {
        // default binding = object
        getIssue: makeIssueLookup([
          {
            id: "STE-117",
            // Tracker stores the em-dash canonical name; parser must derive it
            // from the colon-form plan heading for the byte-equality to hold.
            projectMilestone: { name: "M31 — Tracker Workflow Hardening" },
          },
          {
            id: "STE-200",
            // Wrong name → must violate ONLY once the probe reaches the check.
            projectMilestone: { name: "M88 — Wrong stored name" },
          },
        ]),
      });
      // Exactly one violation — the mismatch — and it names the sibling, not
      // the matching FR. (Pre-fix both skip → 0 violations → RED.)
      expect(r.violations.length).toBe(1);
      const v = r.violations[0]!;
      expect(v.note).toMatch(/STE-200/);
      expect(v.note).toMatch(/M88 — Sibling Mismatch Control/);
      expect(v.note).not.toMatch(/STE-117/);
      expect(r.advisories).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("AC-STE-335.5: projectMilestone mismatch on a `## M<N>:` plan → violation", async () => {
    const fx = makeFixture({
      active: [{ id: "STE-117", milestone: "M31", trackerId: "STE-117" }],
      activePlans: [
        {
          n: 31,
          heading: "unused",
          rawHeadingLine: "## M31: Tracker Workflow Hardening {#M31}",
        },
      ],
    });
    try {
      const r = await runTrackerProjectMilestoneAttachedProbe(fx.root, {
        milestoneBinding: "object",
        getIssue: makeIssueLookup([
          { id: "STE-117", projectMilestone: { name: "M31 — Old name" } },
        ]),
      });
      expect(r.violations.length).toBe(1);
      const v = r.violations[0]!;
      // The probe reached the binding check (NOT a vacuous skip) and rendered
      // the canonical name derived from the colon-form heading.
      expect(v.note).toMatch(/M31 — Tracker Workflow Hardening/);
      expect(v.note).toMatch(/M31 — Old name/);
    } finally {
      fx.cleanup();
    }
  });

  test("AC-STE-335.5: projectMilestone null on a `## M<N>:` plan → violation (not vacuous)", async () => {
    const fx = makeFixture({
      active: [{ id: "STE-117", milestone: "M31", trackerId: "STE-117" }],
      activePlans: [
        {
          n: 31,
          heading: "unused",
          rawHeadingLine: "## M31: Tracker Workflow Hardening {#M31}",
        },
      ],
    });
    try {
      const r = await runTrackerProjectMilestoneAttachedProbe(fx.root, {
        milestoneBinding: "object",
        getIssue: makeIssueLookup([{ id: "STE-117", projectMilestone: null }]),
      });
      expect(r.violations.length).toBe(1);
      expect(r.violations[0]!.note).toMatch(/M31 — Tracker Workflow Hardening/);
    } finally {
      fx.cleanup();
    }
  });
});

describe("STE-335 AC-STE-335.3/.4 — Jira label binding on a `## M<N>:` plan", () => {
  test("AC-STE-335.4: label present → pass while a sibling `## M<N>:` missing label → violation (probe reached the check)", async () => {
    // Same RED-anchoring control as the object branch: pair the present-label
    // FR with a sibling whose label is absent. Pre-fix both `## M<N>:` plans
    // skip vacuously (0 violations); post-fix the sibling fires exactly one
    // violation while the present-label FR stays clean.
    const fx = makeFixture({
      active: [
        { id: "ABC-1", milestone: "M86", trackerId: "ABC-1", trackerKey: "jira" },
        { id: "ABC-2", milestone: "M89", trackerId: "ABC-2", trackerKey: "jira" },
      ],
      activePlans: [
        {
          n: 86,
          heading: "unused",
          rawHeadingLine: "## M86: Jira Project-Milestone Support {#M86}",
        },
        {
          n: 89,
          heading: "unused",
          rawHeadingLine: "## M89: Sibling Missing-Label Control {#M89}",
        },
      ],
    });
    try {
      const r = await runTrackerProjectMilestoneAttachedProbe(fx.root, {
        milestoneBinding: "label",
        getIssue: makeIssueLookup([
          { id: "ABC-1", labels: ["spec-driven", "milestone-M86"] },
          // Sibling lacks milestone-M89 → must violate once the probe reaches it.
          { id: "ABC-2", labels: ["spec-driven"] },
        ]),
      });
      expect(r.violations.length).toBe(1);
      const v = r.violations[0]!;
      expect(v.note).toMatch(/ABC-2/);
      expect(v.note).toMatch(/milestone-M89/);
      expect(v.note).not.toMatch(/ABC-1/);
      expect(r.advisories).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("AC-STE-335.4: ticket missing `milestone-<M-token>` on a `## M<N>:` plan → violation", async () => {
    const fx = makeFixture({
      active: [{ id: "ABC-1", milestone: "M86", trackerId: "ABC-1", trackerKey: "jira" }],
      activePlans: [
        {
          n: 86,
          heading: "unused",
          rawHeadingLine: "## M86: Jira Project-Milestone Support {#M86}",
        },
      ],
    });
    try {
      const r = await runTrackerProjectMilestoneAttachedProbe(fx.root, {
        milestoneBinding: "label",
        getIssue: makeIssueLookup([{ id: "ABC-1", labels: ["spec-driven"] }]),
      });
      expect(r.violations.length).toBe(1);
      const v = r.violations[0]!;
      expect(v.note).toMatch(/ABC-1/);
      // M-token derived from the colon-form heading → milestone-M86.
      expect(v.note).toMatch(/milestone-M86/);
      expect(v.note).toMatch(/missing|not attached/i);
      // STE-335 (Pass-2 review): the missing-label remedy is binding-aware —
      // it points a Jira operator at the label/editJiraIssue path, never the
      // Linear-only save_issue call (mirrors STE-329's MilestoneAttachmentError).
      expect(v.message).toMatch(/editJiraIssue/);
      expect(v.message).not.toContain("mcp__linear__save_issue");
    } finally {
      fx.cleanup();
    }
  });
});
