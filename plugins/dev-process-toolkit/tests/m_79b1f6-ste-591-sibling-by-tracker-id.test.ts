// M_79b1f6 / STE-591 — a sibling repository's FR is named by tracker ID, and
// the orphan remedy knows the sibling.
//
// THE DEFECT: probe #23 (`traceability_link_validity.ts`) resolves every
// `frs/<id>.md` reference against the LOCAL tree, so a path-shaped link to a
// sibling repository's FR — `](../sibling/specs/frs/GB-40.md)` — always fails.
// Only a bare tracker ID escapes its regex. The rule was written nowhere: not in
// the probe row, not in the plan template. And probe #27's orphan remedy tells
// the operator of a spanning milestone's second repository to create a second
// plan, when the plan lives in the sibling.
//
// THREE KINDS OF CHECK, labelled at each block:
//
//   NEW BEHAVIOUR (must be RED before the fix): AC.4 — the orphan remedy, read
//   from the probe's OWN output on a real fixture.
//
//   PRESENCE PINS (must be RED before the fix): AC.1, AC.5, AC.6's prose and
//   AC.7. They catch a clause being DELETED; they do not catch a model
//   misreading it. No fixture drives /gate-check, /pr or /spec-write and
//   captures what it does with the clause.
//
//   REGRESSION PINS (expected GREEN before the fix): AC.2 (the probe's source is
//   untouched and its followability pair holds), AC.3 (the archive-fallback
//   leg), AC.6's front-door half and its line cap, probe #26 on line 81, the
//   row count, and AC.8 (reachability). Each carries a control or a
//   non-vacuity check showing it can fail.
//
// Every fixture is a REAL temp root torn down in a `finally`; nothing is
// written under the plugin tree.

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { runFrontmatterMilestoneNotArchivedProbe } from "../adapters/_shared/src/frontmatter_milestone_not_archived";
import {
  ORDERED_UNREACHABLE_PIN,
  runModuleReachabilityProbe,
} from "../adapters/_shared/src/module_reachability";
import { runTraceabilityLinkValidityProbe } from "../adapters/_shared/src/traceability_link_validity";
import { type SpanFixture, makeSpanFixture } from "./_span_fixture";

// ===========================================================================
// Paths.
// ===========================================================================

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const GATE_SKILL = join(PLUGIN_ROOT, "skills", "gate-check", "SKILL.md");
const PR_SKILL = join(PLUGIN_ROOT, "skills", "pr", "SKILL.md");
const PLAN_TEMPLATE = join(PLUGIN_ROOT, "templates", "spec-templates", "plan.md.template");
/** The front door, spelled exactly as every skill must name it. */
const FRONT_DOOR = "adapters/_shared/src/sibling_release.ts";
const TRACEABILITY_MODULE = "adapters/_shared/src/traceability_link_validity.ts";
const ORPHAN_MODULE = "adapters/_shared/src/frontmatter_milestone_not_archived.ts";

/** Text with CRLF folded, for prose assertions. */
const readLf = (p: string): string => readFileSync(p, "utf-8").replace(/\r\n/g, "\n");
const splitCount = (text: string): number => text.split("\n").length;

// ===========================================================================
// Vocabulary.
// ===========================================================================

const MILESTONE = "M_GF_91";
const A_NAME = "glacy-app-fe";
const B_NAME = "glacy-app-be";
const C_NAME = "glacy-app-admin";
const SIBLING_FR = "GB-40"; // the sibling repository's FR — a tracker ID
const LOCAL_FR = "STE-9400"; // a live FR in the local tree
const ARCHIVED_FR = "STE-9401"; // an archived FR in the local tree
const B_FR = "STE-9402"; // root B's FR bound to the spanning milestone

// ===========================================================================
// Single-root fixture for the two probes.
// ===========================================================================

interface Root {
  root: string;
  cleanup(): void;
}

function makeRoot(): Root {
  const root = mkdtempSync(join(tmpdir(), "dpt-591-"));
  mkdirSync(join(root, "specs", "plan", "archive"), { recursive: true });
  mkdirSync(join(root, "specs", "frs", "archive"), { recursive: true });
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

async function withRoot<T>(body: (root: string) => Promise<T>): Promise<T> {
  const r = makeRoot();
  try {
    return await body(r.root);
  } finally {
    r.cleanup();
  }
}

async function withSpan<T>(body: (fx: SpanFixture) => Promise<T>): Promise<T> {
  const fx = makeSpanFixture(MILESTONE);
  try {
    return await body(fx);
  } finally {
    fx.cleanup();
  }
}

const frBody = (id: string, milestone: string | null, status: "active" | "archived"): string =>
  [
    "---",
    `title: ${id}`,
    ...(milestone === null ? [] : [`milestone: ${milestone}`]),
    `status: ${status}`,
    `archived_at: ${status === "archived" ? "2026-09-10T00:00:00Z" : "null"}`,
    "---",
    "",
    `# ${id}`,
    "",
  ].join("\n");

function writeFr(root: string, id: string, where: "live" | "archive", milestone = MILESTONE): void {
  const dir =
    where === "archive" ? join(root, "specs", "frs", "archive") : join(root, "specs", "frs");
  writeFileSync(join(dir, `${id}.md`), frBody(id, milestone, where === "archive" ? "archived" : "active"));
}

/** Write root's live plan for MILESTONE with the given body lines. */
function writePlanBody(root: string, bodyLines: string[]): void {
  writeFileSync(
    join(root, "specs", "plan", `${MILESTONE}.md`),
    [
      "---",
      `milestone: ${MILESTONE}`,
      "status: active",
      "archived_at: null",
      "shipped_in: null",
      "---",
      "",
      `# ${MILESTONE}`,
      "",
      ...bodyLines,
      "",
    ].join("\n"),
  );
}

// ===========================================================================
// Suite and git helpers.
// ===========================================================================

/** Run one suite in a child `bun test`; green means exit 0 AND something passed. */
function expectSuiteGreen(suite: string): void {
  const proc = spawnSync("bun", ["test", suite], { cwd: PLUGIN_ROOT, encoding: "utf-8" });
  const out = `${proc.stdout ?? ""}${proc.stderr ?? ""}`;
  expect(proc.status, `${suite} is not green:\n${out.slice(-4000)}`).toBe(0);
  // Non-vacuity: a run that collected nothing exits 0 too.
  expect(out, `${suite} collected nothing`).toMatch(/\b[1-9]\d* pass\b/);
  expect(out).toMatch(/\b0 fail\b/);
}

/** The path's working-tree bytes equal `ref`'s committed bytes, and it is tracked there. */
function expectUnedited(path: string, ref: string): void {
  const proc = spawnSync("git", ["diff", "--quiet", ref, "--", path], {
    cwd: PLUGIN_ROOT,
    encoding: "utf-8",
  });
  expect(proc.status, `${path} differs from ${ref}${proc.stderr ? `: ${proc.stderr}` : ""}`).toBe(0);
  // Non-vacuity: `git diff --quiet` on a pathspec naming nothing exits 0 too.
  const tracked = spawnSync("git", ["cat-file", "-e", `${ref}:./${path}`], {
    cwd: PLUGIN_ROOT,
    encoding: "utf-8",
  });
  expect(tracked.status, `${path} is not tracked on ${ref}`).toBe(0);
}

// ===========================================================================
// Prose extractors — located by marker, never by line number (except the pins
// that are ABOUT line numbers).
// ===========================================================================

/** The single numbered probe row whose line starts `<n>. **`. */
function probeRow(n: number): string {
  const hits = readLf(GATE_SKILL)
    .split("\n")
    .filter((l) => l.startsWith(`${n}. **`));
  expect(hits.length, `expected exactly one \`${n}. **\` row in gate-check`).toBe(1);
  return hits[0]!;
}

/** `## Ship-State Pre-Flight …` up to the next `## ` heading. */
function shipStateSection(): string {
  const lines = readLf(PR_SKILL).split("\n");
  const start = lines.findIndex((l) => l.startsWith("## Ship-State Pre-Flight"));
  expect(start, "no `## Ship-State Pre-Flight` heading in skills/pr").toBeGreaterThanOrEqual(0);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i]!.startsWith("## ")) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

/** The template's `<!-- … -->` block that documents `spans_repos`. */
function spanningComment(): string {
  const text = readLf(PLAN_TEMPLATE);
  const blocks = [...text.matchAll(/<!--[\s\S]*?-->/g)].map((m) => m[0]);
  const hits = blocks.filter((b) => b.includes("`spans_repos`") && /sibling/i.test(b));
  expect(hits.length, "expected exactly one spanning comment in the plan template").toBe(1);
  return hits[0]!;
}

// ===========================================================================
// The front door.
// ===========================================================================

interface DoorRun {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Spawn the front door exactly as the skills order it: by path, from the plugin root. */
function frontDoor(projectRoot: string, planFile: string, milestone: string): DoorRun {
  const proc = spawnSync("bun", ["run", FRONT_DOOR, projectRoot, planFile, milestone], {
    cwd: PLUGIN_ROOT,
    encoding: "utf-8",
  });
  return { status: proc.status, stdout: proc.stdout ?? "", stderr: proc.stderr ?? "" };
}

const describeDoor = (d: DoorRun): string =>
  `exit=${d.status}\n--- stdout ---\n${d.stdout}\n--- stderr ---\n${d.stderr}`;

const stdoutRows = (d: DoorRun): string[] => d.stdout.split("\n").filter((l) => l.trim() !== "");

// ===========================================================================
// AC-STE-591.1 — probe #23's row states the sibling-FR tracker-ID rule
// PRESENCE PIN: catches the clause being deleted, not a model ignoring it.
// ===========================================================================

describe("AC-STE-591.1 — skills/gate-check/SKILL.md probe #23 row states the sibling tracker-ID rule", () => {
  test("the probe #23 row says a sibling repository's FR is referenced by tracker ID only", () => {
    const row = probeRow(23);
    expect(row, "probe #23's row never mentions a sibling repository").toMatch(
      /\bsibling repositor(?:y|y's|ies)\b/i,
    );
    expect(row, "probe #23's row never names the tracker ID").toMatch(/\btracker ID\b/i);
    // The rule, not two unrelated mentions: sibling and tracker ID in one clause.
    expect(row).toMatch(/\bsibling\b[^.]{0,160}\btracker ID\b|\btracker ID\b[^.]{0,160}\bsibling\b/i);
    expect(row, "the rule does not say the tracker ID ALONE").toMatch(
      /\btracker ID\b[^.]{0,40}\b(?:only|alone)\b|\b(?:only|alone)\b[^.]{0,40}\btracker ID\b/i,
    );
  });

  test("edited in place: the row keeps its probe name and its call, on line 78", () => {
    const row = probeRow(23);
    expect(row).toStartWith(
      "23. **`traceability-link-validity`** — call `runTraceabilityLinkValidityProbe(projectRoot)` from `adapters/_shared/src/traceability_link_validity.ts`.",
    );
    const lines = readLf(GATE_SKILL).split("\n");
    expect(lines[77], "probe #23's row moved off line 78").toStartWith("23. **");
  });
});

// ===========================================================================
// AC-STE-591.2 — probe #23's source is untouched, and followable both ways
// REGRESSION PIN: the probe already fails a sibling path and passes a bare ID.
// ===========================================================================

describe("AC-STE-591.2 — traceability_link_validity.ts is unchanged and followable in both directions", () => {
  test("git diff main...HEAD on the module is empty", () => {
    const proc = spawnSync("git", ["diff", "--quiet", "main...HEAD", "--", TRACEABILITY_MODULE], {
      cwd: PLUGIN_ROOT,
      encoding: "utf-8",
    });
    expect(proc.status, `main...HEAD touches ${TRACEABILITY_MODULE}: ${proc.stderr}`).toBe(0);
  });

  test("the working tree matches main too (git diff --quiet main)", () => {
    expectUnedited(TRACEABILITY_MODULE, "main");
  });

  test("a sibling path link yields >= 1 violation naming the FR; the bare tracker ID yields zero", async () => {
    const withPath = await withRoot(async (root) => {
      writeFr(root, LOCAL_FR, "live");
      writePlanBody(root, [
        `- [ ] [${LOCAL_FR}](../frs/${LOCAL_FR}.md) — local work`,
        `- [ ] [${SIBLING_FR}](../sibling/specs/frs/${SIBLING_FR}.md) — sibling work`,
      ]);
      return runTraceabilityLinkValidityProbe(root);
    });
    const bare = await withRoot(async (root) => {
      writeFr(root, LOCAL_FR, "live");
      writePlanBody(root, [
        `- [ ] [${LOCAL_FR}](../frs/${LOCAL_FR}.md) — local work`,
        `- [ ] ${SIBLING_FR} — sibling work, in ${B_NAME}`,
      ]);
      return runTraceabilityLinkValidityProbe(root);
    });
    // Path form: fails, and for the sibling's FR — not for the resolving local link.
    expect(withPath.violations.length, JSON.stringify(withPath.violations)).toBeGreaterThanOrEqual(1);
    expect(withPath.violations.every((v) => v.reason.includes(SIBLING_FR))).toBe(true);
    // Bare tracker ID: the only form that escapes.
    expect(bare.violations, JSON.stringify(bare.violations)).toEqual([]);
  });
});

// ===========================================================================
// AC-STE-591.3 — the archive-fallback leg survives
// REGRESSION PIN.
// ===========================================================================

describe("AC-STE-591.3 — archive fallback: a live-path link to an archived FR fails, the archive link passes", () => {
  test("live-path link to an archived FR yields a violation that says the archive copy exists", async () => {
    const r = await withRoot(async (root) => {
      writeFr(root, ARCHIVED_FR, "archive");
      writePlanBody(root, [`- [x] [${ARCHIVED_FR}](../frs/${ARCHIVED_FR}.md)`]);
      return runTraceabilityLinkValidityProbe(root);
    });
    expect(r.violations.length, JSON.stringify(r.violations)).toBe(1);
    expect(r.violations[0]!.reason).toContain(ARCHIVED_FR);
    expect(r.violations[0]!.reason).toMatch(/archive exists: yes/);
  });

  test("a resolving frs/archive/<id>.md link yields none", async () => {
    const r = await withRoot(async (root) => {
      writeFr(root, ARCHIVED_FR, "archive");
      writePlanBody(root, [`- [x] [${ARCHIVED_FR}](../frs/archive/${ARCHIVED_FR}.md)`]);
      return runTraceabilityLinkValidityProbe(root);
    });
    expect(r.violations, JSON.stringify(r.violations)).toEqual([]);
  });

  test("control: an archive-form link to an FR that is not archived is verified, not waved through", async () => {
    const r = await withRoot(async (root) => {
      writeFr(root, LOCAL_FR, "live");
      writePlanBody(root, [`- [ ] [${LOCAL_FR}](../frs/archive/${LOCAL_FR}.md)`]);
      return runTraceabilityLinkValidityProbe(root);
    });
    expect(r.violations.length).toBe(1);
    expect(r.violations[0]!.reason).toMatch(/live exists: yes/);
  });
});

// ===========================================================================
// AC-STE-591.4 — the orphan remedy gains a sibling arm
// NEW BEHAVIOUR: read from the probe's own output, never from its source.
// ===========================================================================

describe("AC-STE-591.4 — frontmatter_milestone_not_archived's orphan remedy names spans_repos and the sibling's plan", () => {
  /** The `Remedy:` line of a violation message. */
  const remedyOf = (message: string): string => {
    const line = message.split("\n").find((l) => l.startsWith("Remedy: "));
    expect(line, `no Remedy line in:\n${message}`).toBeDefined();
    return line!;
  };

  /**
   * Root B of a spanning milestone: its FR is bound to MILESTONE, but the
   * milestone's plan lives in root A only — the orphan a spanning milestone's
   * second repository reports.
   */
  const orphanInB = (): Promise<Awaited<ReturnType<typeof runFrontmatterMilestoneNotArchivedProbe>>> =>
    withSpan(async (fx) => {
      fx.planA({ [A_NAME]: ".", [B_NAME]: relative(fx.a, fx.b) });
      fx.activeFr(fx.b, B_FR, MILESTONE);
      return runFrontmatterMilestoneNotArchivedProbe(fx.b);
    });

  test("the fixture is an orphan: one violation, noted `orphan`", async () => {
    const r = await orphanInB();
    expect(r.violations.length, JSON.stringify(r.violations)).toBe(1);
    expect(r.violations[0]!.note).toMatch(/\borphan\b/);
    expect(r.violations[0]!.reason).toMatch(/\borphan\b/);
  });

  test("the orphan Remedy gains a third arm naming `spans_repos` and the sibling's plan", async () => {
    const r = await orphanInB();
    const remedy = remedyOf(r.violations[0]!.message);
    expect(remedy, "the orphan remedy never names spans_repos").toContain("spans_repos");
    expect(remedy, "the orphan remedy never names the sibling's plan").toMatch(
      /\bsibling\b[^.]{0,80}\bplan\b|\bplan\b[^.]{0,80}\bsibling\b/i,
    );
  });

  test("the orphan remedy's first two arms survive", async () => {
    const r = await orphanInB();
    const remedy = remedyOf(r.violations[0]!.message);
    expect(remedy).toContain("specs/plan/<value>.md");
    expect(remedy).toMatch(/fix the frontmatter/i);
  });

  test("the collision and malformed branches survive", async () => {
    const r = await withRoot(async (root) => {
      writeFileSync(
        join(root, "specs", "plan", "archive", "M_OLD.md"),
        "---\nmilestone: M_OLD\nstatus: archived\n---\n",
      );
      writeFileSync(join(root, "specs", "frs", "COLL-1.md"), frBody("COLL-1", "M_OLD", "active"));
      writeFileSync(join(root, "specs", "frs", "MALF-1.md"), frBody("MALF-1", null, "active"));
      return runFrontmatterMilestoneNotArchivedProbe(root);
    });
    const byFile = (name: string) => r.violations.filter((v) => v.file.endsWith(name));
    expect(byFile("COLL-1.md").length, JSON.stringify(r.violations)).toBe(1);
    expect(byFile("COLL-1.md")[0]!.note).toMatch(/\bcollision\b/);
    expect(byFile("MALF-1.md").length, JSON.stringify(r.violations)).toBe(1);
    expect(byFile("MALF-1.md")[0]!.note).toMatch(/\(malformed\)/);
  });

  test("tests/gate-check-frontmatter-milestone-not-archived.test.ts is unedited against main", () => {
    expectUnedited("tests/gate-check-frontmatter-milestone-not-archived.test.ts", "main");
  });

  test("tests/gate-check-frontmatter-milestone-not-archived.test.ts is green", () => {
    expectSuiteGreen("tests/gate-check-frontmatter-milestone-not-archived.test.ts");
  }, 180_000);
});

// ===========================================================================
// AC-STE-591.5 — probe #27's row names the sibling remedy arm
// PRESENCE PIN.
// ===========================================================================

describe("AC-STE-591.5 — skills/gate-check/SKILL.md probe #27 row names the sibling remedy arm", () => {
  test("the probe #27 row names `spans_repos` and the sibling", () => {
    const row = probeRow(27);
    expect(row, "probe #27's row never names spans_repos").toContain("spans_repos");
    expect(row, "probe #27's row never names the sibling").toMatch(/\bsibling\b/i);
  });

  test("edited in place: the row keeps its call and its three diagnostics", () => {
    const row = probeRow(27);
    expect(row).toStartWith(
      "27. **`frontmatter-milestone-not-archived`** — call `runFrontmatterMilestoneNotArchivedProbe(projectRoot)` from `adapters/_shared/src/frontmatter_milestone_not_archived.ts`.",
    );
    for (const kind of ["collision", "orphan", "malformed"]) {
      expect(row).toContain(`\`${kind}\` diagnostic`);
    }
  });
});

// ===========================================================================
// AC-STE-591.6 — /pr's Ship-State Pre-Flight carries the measured Spans: rows
// ===========================================================================

describe("AC-STE-591.6 prose — skills/pr/SKILL.md's Ship-State Pre-Flight reads the front door", () => {
  // PRESENCE PINS: they catch the clauses being deleted. No fixture drives /pr
  // over two roots and captures the PR body it writes.
  test("the section names the front door by its path", () => {
    expect(shipStateSection()).toContain(FRONT_DOOR);
  });

  test("one `Spans:` row per sibling, taken from the front door's stdout", () => {
    const section = shipStateSection();
    expect(section, "the section never says one Spans: row per sibling").toMatch(
      /\bone\b[^\n]{0,30}Spans:[^\n]{0,60}\bper sibling\b/i,
    );
    expect(section, "the Spans: rows are not said to come from stdout").toMatch(
      /Spans:[^\n]{0,200}\bstdout\b|\bstdout\b[^\n]{0,200}Spans:/,
    );
  });

  test("the rows are never typed", () => {
    expect(shipStateSection()).toMatch(/\bnever\b[^.\n]{0,30}\btyped\b/i);
  });

  test("a refusal holds `[s]hip first` and the `[m]` follow-up, printing the refusal in their place", () => {
    const lines = shipStateSection().split("\n");
    const hit = lines.find(
      (l) =>
        /refus/i.test(l) &&
        /\bin their place\b/i.test(l) &&
        l.includes("[s]hip first") &&
        l.includes("[m]") &&
        /\bhe(?:ld|lds?)\b|\bhold\b/i.test(l),
    );
    expect(hit, "no line says a refusal holds [s]hip first and the [m] follow-up").toBeDefined();
  });
});

describe("AC-STE-591.6 front door — REGRESSION PIN of shipped behaviour", () => {
  // The rows /pr must inject are the front door's stdout. These spawn it exactly
  // as a skill orders it, on a real two-root tree, and grade what it prints.

  test("a clear span prints exactly the Spans: row on stdout, exit 0", async () => {
    await withSpan(async (fx) => {
      fx.planA({ [A_NAME]: ".", [B_NAME]: relative(fx.a, fx.b) });
      fx.archivedFr(fx.b, B_FR, MILESTONE);
      const door = frontDoor(fx.a, join(fx.a, "specs", "plan", `${MILESTONE}.md`), MILESTONE);
      expect(door.status, describeDoor(door)).toBe(0);
      expect(stdoutRows(door), describeDoor(door)).toEqual([`Spans: ${B_NAME}@pending`]);
    });
  }, 30_000);

  test("a shipped sibling's row carries its measured stamp", async () => {
    await withSpan(async (fx) => {
      fx.planA({ [A_NAME]: ".", [B_NAME]: relative(fx.a, fx.b) });
      writeFileSync(
        join(fx.b, "specs", "plan", `${MILESTONE}.md`),
        `---\nmilestone: ${MILESTONE}\nstatus: active\narchived_at: null\nshipped_in: v1.2.3\n---\n\n# ${MILESTONE}\n`,
      );
      fx.archivedFr(fx.b, B_FR, MILESTONE);
      const door = frontDoor(fx.a, join(fx.a, "specs", "plan", `${MILESTONE}.md`), MILESTONE);
      expect(door.status, describeDoor(door)).toBe(0);
      expect(stdoutRows(door), describeDoor(door)).toEqual([`Spans: ${B_NAME}@v1.2.3`]);
    });
  }, 30_000);

  test("two siblings print two rows, one per sibling", async () => {
    const c = mkdtempSync(join(tmpdir(), "dpt-span-c-"));
    try {
      mkdirSync(join(c, "specs", "plan"), { recursive: true });
      mkdirSync(join(c, "specs", "frs", "archive"), { recursive: true });
      await withSpan(async (fx) => {
        fx.planA({
          [A_NAME]: ".",
          [B_NAME]: relative(fx.a, fx.b),
          [C_NAME]: relative(fx.a, c),
        });
        const door = frontDoor(fx.a, join(fx.a, "specs", "plan", `${MILESTONE}.md`), MILESTONE);
        expect(door.status, describeDoor(door)).toBe(0);
        expect([...stdoutRows(door)].sort(), describeDoor(door)).toEqual(
          [`Spans: ${B_NAME}@pending`, `Spans: ${C_NAME}@pending`].sort(),
        );
      });
    } finally {
      rmSync(c, { recursive: true, force: true });
    }
  }, 30_000);

  test("a busy span exits 1 with empty stdout (the refusal /pr must print)", async () => {
    await withSpan(async (fx) => {
      fx.planA({ [A_NAME]: ".", [B_NAME]: relative(fx.a, fx.b) });
      fx.activeFr(fx.b, B_FR, MILESTONE);
      const door = frontDoor(fx.a, join(fx.a, "specs", "plan", `${MILESTONE}.md`), MILESTONE);
      expect(door.status, describeDoor(door)).toBe(1);
      expect(door.stdout, describeDoor(door)).toBe("");
      // Non-vacuity: the refusal is on stderr and names the busy sibling.
      expect(door.stderr, describeDoor(door)).toMatch(/^\/ship-milestone: /);
      expect(door.stderr).toContain(B_NAME);
    });
  }, 30_000);

  test("skills/pr/SKILL.md measures at most 358 split-lines", () => {
    // Control: the counter flags a 359-line text, so the cap can fail.
    expect(splitCount(Array.from({ length: 359 }, () => "x").join("\n"))).toBeGreaterThan(358);
    expect(splitCount(readFileSync(PR_SKILL, "utf-8"))).toBeLessThanOrEqual(358);
  });
});

// ===========================================================================
// AC-STE-591.7 — the plan template's spanning comment states the rule
// PRESENCE PIN.
// ===========================================================================

describe("AC-STE-591.7 — templates/spec-templates/plan.md.template's spanning comment states the sibling-FR tracker-ID rule", () => {
  test("the spanning comment names a sibling FR and the tracker ID", () => {
    const comment = spanningComment();
    expect(comment, "the spanning comment never names the tracker ID").toMatch(/\btracker ID\b/i);
    expect(comment, "the rule is not scoped to the sibling's FR").toMatch(
      /\bsibling\b[^.]{0,120}\bFRs?\b[^.]{0,120}\btracker ID\b|\btracker ID\b[^.]{0,120}\bsibling\b[^.]{0,120}\bFRs?\b|\bsibling\b[^.]{0,120}\btracker ID\b[^.]{0,120}\bFRs?\b|\bFRs?\b[^.]{0,120}\bsibling\b[^.]{0,120}\btracker ID\b/i,
    );
  });

  test("the comment keeps its shipped declaration example", () => {
    const comment = spanningComment();
    expect(comment).toContain("spans_repos:\n        glacy-app-fe: .\n        glacy-app-be: ../glacy-app-be");
  });
});

// ===========================================================================
// AC-STE-591.8 — no second ordered reference; the reachability pin holds
// REGRESSION PIN.
// ===========================================================================

describe("AC-STE-591.8 — module reachability holds its pin, and neither module gains an ordered reference", () => {
  test("orderedUnreachable === ORDERED_UNREACHABLE_PIN, ok true, and each module has at most one ordered reference", async () => {
    const report = await runModuleReachabilityProbe(REPO_ROOT);
    expect(report.orderedUnreachable).toBe(ORDERED_UNREACHABLE_PIN);
    expect(report.ok).toBe(true);
    const carrier = /^plugins\/dev-process-toolkit\/(?:skills|docs)\//;
    for (const mod of [TRACEABILITY_MODULE, ORPHAN_MODULE]) {
      const ordered = report.records.filter(
        (r) => r.module.endsWith(mod) && r.refClass === "ordered" && carrier.test(r.surface),
      );
      const where = ordered.map((r) => `${r.surface}:${r.line}`).join(", ");
      // Non-vacuity: the gate-check row's order is counted, so the filter matches.
      expect(ordered.length, `${mod}: no ordered reference found — filter is blind`).toBeGreaterThanOrEqual(1);
      expect(ordered.length, `${mod} gained a second ordered reference: ${where}`).toBeLessThanOrEqual(1);
    }
  }, 60_000);
});

// ===========================================================================
// Structural pins on skills/gate-check/SKILL.md — REGRESSION PINS.
// ===========================================================================

describe("structural — gate-check's probe rows stay where the pins expect them", () => {
  test("probe #26's row is on line 81, and `26. ` marks exactly one line", () => {
    const lines = readLf(GATE_SKILL).split("\n");
    expect(lines[80], "probe #26's row moved off line 81").toMatch(/^26\. /);
    // Control: the marker is unique, so line 81 is not matched by accident.
    expect(lines.filter((l) => /^26\. /.test(l)).length).toBe(1);
  });

  test("exactly 85 numbered probe rows, and no row 86", () => {
    const lines = readLf(GATE_SKILL).split("\n");
    expect(lines.filter((l) => /^[0-9]+\. \*\*/.test(l)).length).toBe(85);
    expect(lines.some((l) => /^86\. /.test(l))).toBe(false);
  });

  test("milestone budget: git diff --numstat main on gate-check shows added == deleted", () => {
    const proc = spawnSync("git", ["diff", "--numstat", "main", "--", "skills/gate-check/SKILL.md"], {
      cwd: PLUGIN_ROOT,
      encoding: "utf-8",
    });
    expect(proc.status, proc.stderr).toBe(0);
    const line = (proc.stdout ?? "").split("\n").find((l) => l.trim() !== "") ?? "0\t0\t-";
    const [added, deleted] = line.split("\t").map((n) => Number.parseInt(n!, 10));
    expect(
      added,
      `gate-check SKILL.md must be edited IN PLACE this milestone (every row edit replaces its line): ` +
        `numstat against main is +${added} -${deleted}. A row was added or removed, or a line split.`,
    ).toBe(deleted!);
  });

  test("tests/m120-ste-444-jira-binding-prose.test.ts is unedited against main", () => {
    expectUnedited("tests/m120-ste-444-jira-binding-prose.test.ts", "main");
  });

  test("tests/m120-ste-444-jira-binding-prose.test.ts is green", () => {
    expectSuiteGreen("tests/m120-ste-444-jira-binding-prose.test.ts");
  }, 180_000);
});

// ===========================================================================
// Stage C hardening (round 1). Each new check was dry-run FALSE against the
// pre-fix tree. /pr has no executable of its own, so C1-C3's prose checks are
// PRESENCE PINS: they catch a clause being deleted, not a model misreading it.
// C3's front-door half and C4 pin BEHAVIOUR: the door itself, and probe #27's
// own output on a real orphan.
// ===========================================================================

describe("Stage C hardening — /pr's refusal path, its plan path, and a remedy that says what clears the row", () => {
  test("C1 (presence): on `m` after a refusal, the refusal goes into the PR body in place of the Follow-up line", () => {
    expect(shipStateSection()).toMatch(/refusal[^\n]{0,160}\bPR body\b|\bPR body\b[^\n]{0,160}refusal/i);
  });

  test("C2 (presence): on `s` after a refusal, the refusal is printed instead of the hint", () => {
    expect(shipStateSection()).toMatch(
      /refusal[^\n]{0,120}\binstead of the hint\b|\binstead of the hint\b[^\n]{0,120}refusal/i,
    );
  });

  test("C3 (presence): /pr's gate call falls back to the live plan when the plan is not archived", () => {
    const s = shipStateSection();
    const i = s.indexOf(FRONT_DOOR);
    expect(i, "the section never names the front door").toBeGreaterThanOrEqual(0);
    const call = s.slice(i, i + 300);
    expect(call).toContain("specs/plan/archive/M<N>.md");
    expect(call).toContain("specs/plan/M<N>.md");
  });

  test("C3 (behaviour): on a live plan, the archived path cannot be read and the live path is gated", async () => {
    await withSpan(async (fx) => {
      fx.planA({ [A_NAME]: ".", [B_NAME]: relative(fx.a, fx.b) });
      const archived = frontDoor(fx.a, join(fx.a, "specs", "plan", "archive", `${MILESTONE}.md`), MILESTONE);
      expect(archived.status, describeDoor(archived)).toBe(1);
      expect(archived.stderr, describeDoor(archived)).toMatch(/cannot read the plan file/);
      const live = frontDoor(fx.a, join(fx.a, "specs", "plan", `${MILESTONE}.md`), MILESTONE);
      expect(live.status, describeDoor(live)).toBe(0);
      expect(stdoutRows(live)).toEqual([`Spans: ${B_NAME}@pending`]);
    });
  }, 60_000);

  test("C4 (behaviour): probe #27's own orphan remedy says what clears the row", async () => {
    const r = await withSpan(async (fx) => {
      fx.planA({ [A_NAME]: ".", [B_NAME]: relative(fx.a, fx.b) });
      fx.activeFr(fx.b, B_FR, MILESTONE);
      return runFrontmatterMilestoneNotArchivedProbe(fx.b);
    });
    expect(r.violations.length, JSON.stringify(r.violations)).toBe(1);
    const remedy = r.violations[0]!.message.split("\n").find((l) => l.startsWith("Remedy: ")) ?? "";
    expect(remedy, r.violations[0]!.message).toMatch(
      /\bclears?\b[^.\n]{0,120}\bown plan\b|\bown plan\b[^.\n]{0,120}\bclears?\b/i,
    );
  });

  test("C4 (presence): probe #27's row says the same thing the remedy says", () => {
    expect(probeRow(27)).toMatch(/\bclears?\b[^.\n]{0,120}\bown plan\b|\bown plan\b[^.\n]{0,120}\bclears?\b/i);
  });
});
