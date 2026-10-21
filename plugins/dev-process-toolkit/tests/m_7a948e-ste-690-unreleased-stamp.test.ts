// M_7a948e / STE-690 — an unreleased ship stamp counts as shipped.
//
// THE CONTRACT these tests build to:
//
//   * The one stamp grammar (STE-589.8) admits exactly `v<X.Y.Z>` and the
//     literal `unreleased`. The STE-589 pin over the three `STAMP_RE`
//     definitions lives in `tests/m_79b1f6-ste-589-sibling-ship-gate.test.ts`
//     and is updated there (AC-STE-690.1); this file grades the READERS.
//   * `stampShippedIn(planPath, "unreleased")` writes `shipped_in: unreleased`;
//     any other non-`v<X.Y.Z>` value is refused and the file is left untouched.
//   * Every reader reads `changelog_unversioned` through `readDocsConfig` from
//     its OWN project's CLAUDE.md (the sibling leg: the SIBLING's CLAUDE.md).
//     With the flag the sentinel is a shipped release with no CHANGELOG heading;
//     without it the sentinel is graded exactly as any other bad stamp.
//
// Each reader has a flag-on and a flag-off fixture over the SAME tree (only
// CLAUDE.md differs), plus a versioned-stamp control under the flag, so
// removing that reader's flag condition reddens its pair (AC-STE-690.10).
//
// Every temp tree is created by mkdtemp and removed in a `finally`.
//
// Filter by AC with `bun test -t "AC-STE-690.N"`.

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";

import { classifyActivePlans, shipReadyMilestones } from "../adapters/_shared/src/active_plan_ship_ready";
import { gradeLiveProof } from "../adapters/_shared/src/live_proof_gate";
import { runPlanShipCoherenceProbe, type PlanShipCoherenceReport } from "../adapters/_shared/src/plan_ship_coherence";
import { stampShippedIn } from "../adapters/_shared/src/plan_ship_stamp";
import { runReleaseSurfaceAgreement } from "../adapters/_shared/src/release_surface_agreement";
import {
  ResumeRefusedError,
  classifyResume,
  runResume,
  type ResumeOperatorGate,
} from "../adapters/_shared/src/resume_classifier";
import { type SpanFixture, makeSpanFixture } from "./_span_fixture";

// ===========================================================================
// Paths and vocabulary.
// ===========================================================================

const PLUGIN_ROOT = join(import.meta.dir, "..");
const SHARED_SRC = join(PLUGIN_ROOT, "adapters", "_shared", "src");
const SURFACE_DOOR = join(SHARED_SRC, "release_surface_agreement.ts");
const SHIP_SKILL = join(PLUGIN_ROOT, "skills", "ship-milestone", "SKILL.md");

const UNRELEASED = "unreleased";
const MILESTONE = "M77";

const read = (p: string): string => readFileSync(p, "utf-8");

/** The `## Docs` block, declaring `changelog_unversioned: <flag>`. */
const docsBlock = (flag: boolean): string =>
  [
    "## Docs",
    "",
    "user_facing_mode: false",
    "packages_mode: false",
    "changelog_ci_owned: false",
    `changelog_unversioned: ${flag}`,
    "",
  ].join("\n");

/** A whole CLAUDE.md: `undefined` writes no `## Docs` block at all. */
const claudeMd = (flag: boolean | undefined): string =>
  ["# Fixture project", "", ...(flag === undefined ? [] : [docsBlock(flag)]), "## Other", "", "nothing", ""].join("\n");

function writeAt(root: string, rel: string, body: string): string {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body);
  return abs;
}

const archivedPlanText = (milestone: string, shippedIn: string, extra: string[] = []): string =>
  [
    "---",
    `milestone: ${milestone}`,
    "status: archived",
    "archived_at: 2026-10-21T00:00:00Z",
    `shipped_in: ${shippedIn}`,
    ...extra,
    "---",
    "",
    `# ${milestone}`,
    "",
  ].join("\n");

const changelogWith = (...versions: string[]): string =>
  ["# Changelog", "", ...versions.flatMap((v) => [`## [${v}] — 2026-10-01 — "Fixture"`, "", "- something", ""])].join("\n");

async function withRoot<T>(label: string, body: (root: string) => Promise<T> | T): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), `ste690-${label}-`));
  try {
    return await body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const describeReport = (r: PlanShipCoherenceReport): string =>
  [
    ...r.violations.map((v) => `VIOLATION ${v.kind}: ${v.message}`),
    ...r.notes.map((n) => `NOTE ${n}`),
  ].join("\n") || "(clean)";

const remedyLine = (message: string): string =>
  message.split("\n").find((l) => l.startsWith("Remedy: ")) ?? "";

// ===========================================================================
// AC-STE-690.2 — the writer
// ===========================================================================

describe("AC-STE-690.2 — stampShippedIn writes `shipped_in: unreleased` and refuses any other non-version", () => {
  const PLAN = ["---", `milestone: ${MILESTONE}`, "status: archived", "shipped_in: null", "---", "", `# ${MILESTONE}`, "", "---", "", "After a rule.", ""].join("\n");

  test("`unreleased` is written verbatim — never `v`-prefixed — in the sentinel's key position", async () => {
    await withRoot("stamp", async (root) => {
      const file = writeAt(root, "specs/plan/archive/M77.md", PLAN);
      await stampShippedIn(file, UNRELEASED);
      const after = read(file);
      expect(after).toBe(PLAN.replace("shipped_in: null", "shipped_in: unreleased"));
      expect(after).not.toContain("vunreleased");
    });
  });

  test("a fresh stamp (no shipped_in key) appends exactly `shipped_in: unreleased`", async () => {
    await withRoot("stamp-fresh", async (root) => {
      const input = PLAN.replace("shipped_in: null\n", "");
      const file = writeAt(root, "specs/plan/archive/M77.md", input);
      await stampShippedIn(file, UNRELEASED);
      expect(read(file)).toBe(input.replace("status: archived\n", "status: archived\nshipped_in: unreleased\n"));
    });
  });

  test("re-stamping `unreleased` is an idempotent no-op with no write", async () => {
    await withRoot("stamp-idem", async (root) => {
      const file = writeAt(root, "specs/plan/archive/M77.md", PLAN);
      await stampShippedIn(file, UNRELEASED);
      const once = read(file);
      const past = new Date("2001-01-01T00:00:00Z");
      utimesSync(file, past, past);
      await stampShippedIn(file, UNRELEASED);
      expect(read(file)).toBe(once);
      expect(statSync(file).mtimeMs).toBe(past.getTime());
    });
  });

  for (const bad of ["banana", "2.x", "vunreleased", "Unreleased", "UNRELEASED", "v2.40", "2.40.0.1", "v2.40.0-rc", " unreleased x"]) {
    test(`a non-version, non-\`unreleased\` value ${JSON.stringify(bad)} is refused and the plan is untouched`, async () => {
      await withRoot("stamp-bad", async (root) => {
        const file = writeAt(root, "specs/plan/archive/M77.md", PLAN);
        let raised: unknown = null;
        try {
          await stampShippedIn(file, bad);
        } catch (e) {
          raised = e;
        }
        expect(raised, `stampShippedIn accepted ${JSON.stringify(bad)}`).toBeInstanceOf(Error);
        expect(String((raised as Error).message)).toMatch(/^Refusing: /m);
        expect(read(file)).toBe(PLAN);
      });
    });
  }

  test("CONTROL — a bare and a v-prefixed version are still stamped as `v<X.Y.Z>`", async () => {
    await withRoot("stamp-ver", async (root) => {
      const bare = writeAt(root, "a/M77.md", PLAN);
      const pre = writeAt(root, "b/M77.md", PLAN);
      await stampShippedIn(bare, "2.40.0");
      await stampShippedIn(pre, "v2.40.0");
      expect(read(bare)).toBe(PLAN.replace("shipped_in: null", "shipped_in: v2.40.0"));
      expect(read(pre)).toBe(read(bare));
    });
  });

  test("an existing `unreleased` stamp re-stamped with a version is a double-ship refusal", async () => {
    await withRoot("stamp-double", async (root) => {
      const file = writeAt(root, "specs/plan/archive/M77.md", PLAN.replace("shipped_in: null", "shipped_in: unreleased"));
      await expect(stampShippedIn(file, "2.40.0")).rejects.toThrow(/already stamped `shipped_in: unreleased`/);
    });
  });
});

// ===========================================================================
// AC-STE-690.3 — plan/ship coherence (probe #63), local leg
// ===========================================================================

describe("AC-STE-690.3 — probe #63 accepts `unreleased` only under the flag", () => {
  /** The same tree, flag varied: one archived plan stamped `unreleased`, no CHANGELOG. */
  const unreleasedTree = (root: string, flag: boolean | undefined, changelog?: string): void => {
    writeAt(root, `specs/plan/archive/${MILESTONE}.md`, archivedPlanText(MILESTONE, UNRELEASED));
    writeAt(root, "CLAUDE.md", claudeMd(flag));
    if (changelog !== undefined) writeAt(root, "CHANGELOG.md", changelog);
  };

  test("flag ON, no CHANGELOG.md at all: no violation (no heading is looked for)", async () => {
    await withRoot("coh-on", async (root) => {
      unreleasedTree(root, true);
      const report = await runPlanShipCoherenceProbe(root);
      expect(report.violations, describeReport(report)).toEqual([]);
    });
  });

  test("flag ON, a CHANGELOG with an `## [Unreleased]` section and older releases: no violation", async () => {
    await withRoot("coh-on-cl", async (root) => {
      unreleasedTree(root, true, ["# Changelog", "", "## [Unreleased]", "", "### Added", "", "- x", "", '## [1.0.0] — 2026-01-01 — "Old"', ""].join("\n"));
      const report = await runPlanShipCoherenceProbe(root);
      expect(report.violations, describeReport(report)).toEqual([]);
    });
  });

  for (const [label, flag] of [["flag OFF (`changelog_unversioned: false`)", false], ["no `## Docs` block", undefined]] as const) {
    test(`${label}: the same plan reports corrupt_stamp naming the stamp and the flag as the remedy`, async () => {
      await withRoot("coh-off", async (root) => {
        unreleasedTree(root, flag);
        const report = await runPlanShipCoherenceProbe(root);
        const corrupt = report.violations.filter((v) => v.kind === "corrupt_stamp");
        expect(corrupt.length, describeReport(report)).toBe(1);
        const v = corrupt[0]!;
        expect(v.reason).toContain(UNRELEASED);
        expect(v.message).toContain(`shipped_in=${UNRELEASED}`);
        expect(remedyLine(v.message), v.message).toContain("changelog_unversioned");
      });
    });
  }

  test("flag ON: a capitalised `Unreleased` is still a corrupt stamp (the sentinel is exactly lowercase)", async () => {
    await withRoot("coh-case", async (root) => {
      writeAt(root, `specs/plan/archive/${MILESTONE}.md`, archivedPlanText(MILESTONE, "Unreleased"));
      writeAt(root, "CLAUDE.md", claudeMd(true));
      const report = await runPlanShipCoherenceProbe(root);
      expect(report.violations.map((v) => v.kind), describeReport(report)).toEqual(["corrupt_stamp"]);
    });
  });

  test("AC-STE-690.9 CONTROL — flag ON: a `v<X.Y.Z>` stamp with no CHANGELOG heading is still corrupt", async () => {
    await withRoot("coh-ver", async (root) => {
      writeAt(root, `specs/plan/archive/${MILESTONE}.md`, archivedPlanText(MILESTONE, "v1.2.3"));
      writeAt(root, "CLAUDE.md", claudeMd(true));
      writeAt(root, "CHANGELOG.md", changelogWith("1.0.0"));
      const report = await runPlanShipCoherenceProbe(root);
      expect(report.violations.map((v) => v.kind), describeReport(report)).toEqual(["corrupt_stamp"]);
      expect(report.violations[0]!.reason).toContain("no matching ## [1.2.3] heading");
    });
  });

  test("AC-STE-690.9 CONTROL — flag ON: a `v<X.Y.Z>` stamp WITH its heading stays clean", async () => {
    await withRoot("coh-ver-ok", async (root) => {
      writeAt(root, `specs/plan/archive/${MILESTONE}.md`, archivedPlanText(MILESTONE, "v1.2.3"));
      writeAt(root, "CLAUDE.md", claudeMd(true));
      writeAt(root, "CHANGELOG.md", changelogWith("1.2.3"));
      const report = await runPlanShipCoherenceProbe(root);
      expect(report.violations, describeReport(report)).toEqual([]);
    });
  });
});

// ===========================================================================
// AC-STE-690.4 — the sibling leg reads the SIBLING's flag
// ===========================================================================

describe("AC-STE-690.4 — a sibling stamped `unreleased` is shipped only when the sibling declares the flag", () => {
  const SPAN = "M_GF_90";
  const A_NAME = "glacy-app-fe";
  const B_NAME = "glacy-app-be";
  const PENDING_NOTE = `siblings awaiting release: ${SPAN} → ${B_NAME} (unshipped)`;

  const spansBlock = (entries: Record<string, string>): string[] => [
    "spans_repos:",
    ...Object.entries(entries).map(([n, p]) => `  ${n}: ${p}`),
  ];

  /** A shipped (versioned, headed) half in A; B's archived half names A back and carries `bStamp`. */
  function buildSpan(fx: SpanFixture, bStamp: string): void {
    writeAt(fx.a, "CHANGELOG.md", changelogWith("2.83.0"));
    writeAt(
      fx.a,
      `specs/plan/archive/${SPAN}.md`,
      archivedPlanText(SPAN, "v2.83.0", spansBlock({ [A_NAME]: ".", [B_NAME]: relative(fx.a, fx.b) })),
    );
    writeAt(
      fx.b,
      `specs/plan/archive/${SPAN}.md`,
      archivedPlanText(SPAN, bStamp, spansBlock({ [A_NAME]: relative(fx.b, fx.a), [B_NAME]: "." })),
    );
  }

  async function withSpan<T>(body: (fx: SpanFixture) => Promise<T>): Promise<T> {
    const fx = makeSpanFixture(SPAN);
    try {
      return await body(fx);
    } finally {
      fx.cleanup();
    }
  }

  test("the sibling's own CLAUDE.md declares the flag: no pending sibling, no violation", async () => {
    await withSpan(async (fx) => {
      buildSpan(fx, UNRELEASED);
      appendFileSync(join(fx.b, "CLAUDE.md"), `\n${docsBlock(true)}`);
      const report = await runPlanShipCoherenceProbe(fx.a);
      expect(report.violations, describeReport(report)).toEqual([]);
      expect(report.notes.filter((n) => n.startsWith("siblings awaiting release")), describeReport(report)).toEqual([]);
    });
  });

  test("the sibling does NOT declare the flag: the sibling is pending (unshipped)", async () => {
    await withSpan(async (fx) => {
      buildSpan(fx, UNRELEASED);
      const report = await runPlanShipCoherenceProbe(fx.a);
      expect(report.notes, describeReport(report)).toContain(PENDING_NOTE);
    });
  });

  test("only THIS repository declares the flag: the sibling is still pending — its own CLAUDE.md decides", async () => {
    await withSpan(async (fx) => {
      buildSpan(fx, UNRELEASED);
      appendFileSync(join(fx.a, "CLAUDE.md"), `\n${docsBlock(true)}`);
      appendFileSync(join(fx.b, "CLAUDE.md"), `\n${docsBlock(false)}`);
      const report = await runPlanShipCoherenceProbe(fx.a);
      expect(report.notes, describeReport(report)).toContain(PENDING_NOTE);
    });
  });

  test("AC-STE-690.9 CONTROL — a sibling stamped `v<X.Y.Z>` is shipped with or without its flag", async () => {
    for (const flag of [true, false]) {
      await withSpan(async (fx) => {
        buildSpan(fx, "v1.4.0");
        appendFileSync(join(fx.b, "CLAUDE.md"), `\n${docsBlock(flag)}`);
        const report = await runPlanShipCoherenceProbe(fx.a);
        expect(report.notes.filter((n) => n.startsWith("siblings awaiting release")), describeReport(report)).toEqual([]);
      });
    }
  });
});

// ===========================================================================
// AC-STE-690.5 — the resume classifier
// ===========================================================================

describe("AC-STE-690.5 — classifyResume reads `unreleased` as shipped only under the flag", () => {
  const FR_ID = "STE-9690";
  const frText = [
    "---",
    `title: ${FR_ID}`,
    `milestone: ${MILESTONE}`,
    "status: archived",
    "archived_at: 2026-10-21",
    "---",
    "",
    `# ${FR_ID}`,
    "",
    "## Requirement",
    "",
    "Something.",
    "",
    "## Acceptance Criteria",
    "",
    `- AC-${FR_ID}.1: something.`,
    "",
    "## Technical Design",
    "",
    "Real content, written.",
    "",
    "## Testing",
    "",
    "Real content, written.",
    "",
    "## Notes",
    "",
    "None.",
    "",
  ].join("\n");

  const resumeTree = (root: string, stamp: string, flag: boolean | undefined): void => {
    writeAt(root, `specs/plan/archive/${MILESTONE}.md`, archivedPlanText(MILESTONE, stamp, []) + "\n## Tasks\n\n- [x] task 1\n");
    writeAt(root, `specs/frs/archive/${FR_ID}.md`, frText);
    mkdirSync(join(root, "specs", "frs"), { recursive: true });
    writeAt(root, "CLAUDE.md", claudeMd(flag));
  };

  const explodingGate: ResumeOperatorGate = {
    present() {
      throw new Error("the operator gate was PRESENTED for a shipped milestone");
    },
  };
  const sinks = {
    gate: explodingGate,
    spawn: { spawnWorker: () => { throw new Error("spawned"); } },
    inline: { runInline: () => { throw new Error("ran inline"); } },
    tracker: { claimMilestone: () => { throw new Error("claimed"); } },
  };

  test("flag ON: the milestone classifies as shipped, carrying the stamp", async () => {
    await withRoot("resume-on", async (root) => {
      resumeTree(root, UNRELEASED, true);
      const c = await classifyResume(root, MILESTONE);
      expect(c.state).toBe("shipped");
      expect(c.shippedIn).toBe(UNRELEASED);
    });
  });

  test("flag ON: the resume refusal names `shipped_in: unreleased`", async () => {
    await withRoot("resume-refuse", async (root) => {
      resumeTree(root, UNRELEASED, true);
      let raised: unknown = null;
      try {
        await runResume({ projectRoot: root, milestone: MILESTONE, ...sinks });
      } catch (e) {
        raised = e;
      }
      expect(raised).toBeInstanceOf(ResumeRefusedError);
      expect(String((raised as Error).message)).toContain("shipped_in: unreleased");
    });
  });

  for (const [label, flag] of [["flag OFF", false], ["no `## Docs` block", undefined]] as const) {
    test(`${label}: the same stamp is NOT read as shipped`, async () => {
      await withRoot("resume-off", async (root) => {
        resumeTree(root, UNRELEASED, flag);
        const c = await classifyResume(root, MILESTONE);
        expect(c.state).not.toBe("shipped");
      });
    });
  }

  test("AC-STE-690.9 CONTROL — a `v<X.Y.Z>` stamp is shipped with or without the flag", async () => {
    for (const flag of [true, false]) {
      await withRoot("resume-ver", async (root) => {
        resumeTree(root, "v9.9.9", flag);
        writeAt(root, "CHANGELOG.md", changelogWith("9.9.9"));
        const c = await classifyResume(root, MILESTONE);
        expect(c.state).toBe("shipped");
        expect(c.shippedIn).toBe("v9.9.9");
      });
    }
  });
});

// ===========================================================================
// AC-STE-690.6 — ship readiness and the ship-debt offer
// ===========================================================================

describe("AC-STE-690.6 — an `unreleased` stamp is not ship debt under the flag", () => {
  const FR_ID = "STE-9691";
  const frText = ["---", `title: ${FR_ID}`, `milestone: ${MILESTONE}`, "status: archived", "archived_at: 2026-10-21", "---", "", `# ${FR_ID}`, ""].join("\n");

  /**
   * Probe #75 walks the LIVE plan directory, so the plan sits at
   * `specs/plan/<M>.md`: zero active FRs and one archived FR bound make it
   * ship-ready unless its stamp says it already shipped.
   */
  const readyTree = (root: string, stamp: string, flag: boolean | undefined): void => {
    writeAt(root, `specs/plan/${MILESTONE}.md`, archivedPlanText(MILESTONE, stamp));
    writeAt(root, `specs/frs/archive/${FR_ID}.md`, frText);
    mkdirSync(join(root, "specs", "frs"), { recursive: true });
    writeAt(root, "CLAUDE.md", claudeMd(flag));
  };

  test("flag ON: a plan stamped `unreleased` is not ship-ready (already shipped)", async () => {
    await withRoot("ready-on", async (root) => {
      readyTree(root, UNRELEASED, true);
      expect(await shipReadyMilestones(root)).toEqual([]);
      expect((await classifyActivePlans(root)).shipReady).toEqual([]);
    });
  });

  for (const [label, flag] of [["flag OFF", false], ["no `## Docs` block", undefined]] as const) {
    test(`${label}: the same plan is still ship-ready — \`unreleased\` is not a stamp there`, async () => {
      await withRoot("ready-off", async (root) => {
        readyTree(root, UNRELEASED, flag);
        expect(await shipReadyMilestones(root)).toEqual([MILESTONE]);
      });
    });
  }

  test("AC-STE-690.9 CONTROL — a `v<X.Y.Z>` stamp is never ship-ready, flag or not", async () => {
    for (const flag of [true, false]) {
      await withRoot("ready-ver", async (root) => {
        readyTree(root, "v1.2.3", flag);
        expect(await shipReadyMilestones(root)).toEqual([]);
      });
    }
  });

  test("CONTROL — the sentinel `shipped_in: null` is still ship-ready under the flag", async () => {
    await withRoot("ready-null", async (root) => {
      readyTree(root, "null", true);
      expect(await shipReadyMilestones(root)).toEqual([MILESTONE]);
    });
  });

  test("flag ON: an archived plan stamped `unreleased` is no unshipped_debt row for the offer's predicate", async () => {
    await withRoot("debt-on", async (root) => {
      writeAt(root, `specs/plan/archive/${MILESTONE}.md`, archivedPlanText(MILESTONE, UNRELEASED));
      writeAt(root, "CLAUDE.md", claudeMd(true));
      const report = await runPlanShipCoherenceProbe(root);
      expect(report.violations.filter((v) => v.kind === "unshipped_debt"), describeReport(report)).toEqual([]);
      expect(report.violations, describeReport(report)).toEqual([]);
    });
  });

  test("the ship-debt offer's candidates are plans LACKING shipped_in — a stamped `unreleased` plan is not one", () => {
    const body = read(SHIP_SKILL);
    const start = body.indexOf("### Ship-debt offer");
    const end = body.indexOf("\n## ", start);
    expect(start).toBeGreaterThanOrEqual(0);
    const section = body.slice(start, end);
    expect(section).toContain("**lacks `shipped_in`**");
    expect(section).toContain("plan_ship_coherence");
  });
});

// ===========================================================================
// AC-STE-690.7 — release-surface agreement is vacuous under the flag
// ===========================================================================

describe("AC-STE-690.7 — release_surface_agreement.ts is vacuous under the flag", () => {
  const README = [
    "# Fixture",
    "",
    "## Release Notes",
    "",
    'See CHANGELOG.md for history. Latest: **v2.0.0 — "New"** (M11, a sentence about the release.)',
    "",
  ].join("\n");

  /** A banner the CHANGELOG disagrees with, plus a plan stamped `unreleased`. */
  const surfaceTree = (root: string, flag: boolean | undefined): void => {
    writeAt(root, "README.md", README);
    writeAt(root, "CHANGELOG.md", changelogWith("1.9.0"));
    writeAt(root, "specs/plan/archive/M10.md", archivedPlanText("M10", "v1.9.0"));
    writeAt(root, "specs/plan/archive/M11.md", archivedPlanText("M11", UNRELEASED));
    writeAt(root, "CLAUDE.md", claudeMd(flag));
  };

  const door = (root: string, ...args: string[]) => {
    const r = spawnSync("bun", ["run", SURFACE_DOOR, root, ...args], { cwd: PLUGIN_ROOT, encoding: "utf-8" });
    return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
  };

  test("flag ON: zero rows, and the door exits 0", async () => {
    await withRoot("surf-on", async (root) => {
      surfaceTree(root, true);
      expect(await runReleaseSurfaceAgreement(root)).toEqual([]);
      const run = door(root);
      expect(run.status, run.out).toBe(0);
      expect(run.out.trim(), "a vacuous check prints no disagreement row").toBe("");
    });
  });

  test("flag ON: probe #63 reports no surface disagreement on that tree", async () => {
    await withRoot("surf-probe", async (root) => {
      surfaceTree(root, true);
      const report = await runPlanShipCoherenceProbe(root);
      expect(report.violations.filter((v) => v.kind === "surface_disagreement"), describeReport(report)).toEqual([]);
    });
  });

  test("POSITIVE CONTROL — flag OFF: the same tree disagrees and the door exits non-zero", async () => {
    await withRoot("surf-off", async (root) => {
      surfaceTree(root, false);
      expect((await runReleaseSurfaceAgreement(root)).length).toBeGreaterThan(0);
      expect(door(root).status).not.toBe(0);
    });
  });
});

// ===========================================================================
// AC-STE-690.8 — the live-proof gate
// ===========================================================================

describe("AC-STE-690.8 — the live-proof gate reads `unreleased` as a release only under the flag", () => {
  const LIVE_PROOF = [
    "### Live proof",
    "",
    "| Tracker | Bundle | Run date | Nonce | Spaces | Bundle hash |",
    "| --- | --- | --- | --- | --- | --- |",
    "| jira | pending | pending | pending | pending | pending |",
    "| linear | pending | pending | pending | pending | pending |",
    "",
  ].join("\n");

  const gateTree = (root: string, stamp: string, flag: boolean | undefined, table: boolean): string => {
    const text = archivedPlanText(MILESTONE, stamp) + (table ? `\n${LIVE_PROOF}` : "");
    writeAt(root, `specs/plan/archive/${MILESTONE}.md`, text);
    writeAt(root, "CHANGELOG.md", changelogWith("1.0.0"));
    writeAt(root, "CLAUDE.md", claudeMd(flag));
    return `specs/plan/archive/${MILESTONE}.md`;
  };

  test("flag ON, no Live proof section: the stamp passes its release check (post-release mode)", async () => {
    await withRoot("lp-on", (root) => {
      const plan = gateTree(root, UNRELEASED, true, false);
      const r = gradeLiveProof({ repoRoot: root, planPath: plan });
      expect(r.reason, JSON.stringify(r)).toBe("no-live-proof-section");
      expect(r.mode).toBe("post-release");
    });
  });

  test("flag ON, pending rows: no stamp-without-release — the rows themselves are graded", async () => {
    await withRoot("lp-on-rows", (root) => {
      const plan = gateTree(root, UNRELEASED, true, true);
      const r = gradeLiveProof({ repoRoot: root, planPath: plan });
      expect(r.reason, JSON.stringify(r)).toBeNull();
      expect(r.mode).toBe("post-release");
      expect(r.trackers.jira.reason).toBe("pending");
      expect(r.trackers.linear.reason).toBe("pending");
    });
  });

  for (const [label, flag] of [["flag OFF", false], ["no `## Docs` block", undefined]] as const) {
    for (const table of [false, true]) {
      test(`${label}${table ? ", pending rows" : ""}: \`unreleased\` is an unmatched stamp (stamp-without-release)`, async () => {
        await withRoot("lp-off", (root) => {
          const plan = gateTree(root, UNRELEASED, flag, table);
          const r = gradeLiveProof({ repoRoot: root, planPath: plan });
          expect(r.reason, JSON.stringify(r)).toBe("stamp-without-release");
          expect(r.verdict).toBe("fail");
        });
      });
    }
  }

  test("AC-STE-690.9 CONTROL — flag ON: a `v<X.Y.Z>` stamp with no CHANGELOG heading is still unmatched", async () => {
    await withRoot("lp-ver", (root) => {
      const plan = gateTree(root, "v9.9.9", true, true);
      const r = gradeLiveProof({ repoRoot: root, planPath: plan });
      expect(r.reason, JSON.stringify(r)).toBe("stamp-without-release");
    });
  });
});
