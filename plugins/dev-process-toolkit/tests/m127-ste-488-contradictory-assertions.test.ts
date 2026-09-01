// M127 STE-488 — retire the fixture assertions that contradict documented
// runtime behaviour (group 4's archive clause, groups 9a/9b's verbatim probe
// messages), and tighten the two propagation-commit greps M126 made tightenable.
//
// ===========================================================================
// WHAT WAS MEASURED BEFORE ANY OF THIS WAS WRITTEN
// ===========================================================================
//
// (1) GROUP 4's ARCHIVE CLAUSE IS THE ERROR, NOT THE ADVISORY.
//
//     `.claude/skills/smoke-test/SKILL.md` says three incompatible things:
//
//       · § Phase 2 step 3's STE-181 advisory — the driver "intentionally uses
//         the `<feature-id>` form … which silent-skips Phase 5", and the
//         resulting `status: active` "is correct, not drift".
//       · § Phase 4's row — "**There is no archive commit on this leg.**"
//       · group 4 step 4 — the FR "archives to `specs/frs/archive/<id>.md`"
//         and `test -f …/archive/<id>.md` must exit 0.
//
//     The 2026-08-16 step-4 captures settle it. Assistant-scoped, through
//     `capability_row_assert`, BOTH legs' `/tmp/dpt-smoke-<leg>-no-tech-step-4.log`
//     carry `status: active` (linear 1, jira 1), `single-FR` (linear 3, jira 1)
//     and a `/spec-archive` recommendation (linear 1, jira 2). The run
//     completed, the gate passed and the ticket reached Done — and the FR was
//     NOT archived, exactly as the advisory says. The assertion is what is
//     wrong, and AC-STE-488.1 demands it be CORRECTED rather than annotated:
//     exactly one account survives the milestone.
//
// (2) GROUPS 9a/9b ARE THE STE-485 LAYER CONFUSION AGAIN.
//
//     Both require a capture to carry a probe's message VERBATIM. Measured on
//     the real `none`-leg captures:
//
//       /tmp/dpt-smoke-none-ste450-tracker-block.log
//         "mode-none FR carries a tracker: block that should be absent"
//                                          assistant=0  post-refusal=0  raw=2
//         "GATE FAILED"                    assistant=2                  raw=4
//         identity_mode_conditional        assistant=1                  raw=18
//
//       /tmp/dpt-smoke-none-ste450-plan-stem.log
//         "does not derive its own filename"
//                                          assistant=0  post-refusal=0  raw=0
//         "GATE FAILED"                    assistant=2                  raw=4
//         plan_identity_mode_conditional   assistant=1                  raw=2
//
//     The raw=2 in the first block is the probe's SOURCE FILE being read by a
//     tool call — the module layer, not the rendered answer. Both probes fired
//     and both drove `GATE FAILED`; `/gate-check` composes its verdict block as
//     prose per run and never quotes the module's sentence. So the assertions
//     are unsatisfiable as written however well the leg runs.
//
//     AC-STE-488.3's repair is re-keying onto what the runtime ACTUALLY renders
//     — `GATE FAILED` plus the probe key — and pointing the reader at the
//     module for the canonical sentence. Both clauses must be `any-of`, for the
//     same reason fixture 3c's are: the SAME jira leg rendered probe #37's id
//     underscored 17 / hyphenated 0 on 2026-07-27 and underscored 0 /
//     hyphenated 2 on 2026-08-16, a complete inversion. Re-keying onto a single
//     new capture literal repeats the defect at a different address.
//
// (3) AC-STE-488.5's PREMISE IS FALSE, AND THE FR IS SHIPPED WITH A STRONGER
//     READING IN ITS PLACE.
//
//     The AC says the greps "must be updated to STE-477's new fixed-length
//     subject, so the M126 change does not silently break group 3a", on the
//     ground that the old literal is gone and the greps now match nothing.
//     Measured: the grep is `--grep 'propagate.*removal to cross-cutting specs'`,
//     written PATH-AGNOSTIC because the pre-M126 subject interpolated the
//     removed path — and `.*` still absorbs `" file "` in the new fixed subject.
//     Run directly it MATCHES. Group 3a is not broken and never was; the test
//     `the retired loose form still matches the shipped subject` below is that
//     measurement, kept as a permanent record so the false premise cannot be
//     re-derived by the next reader.
//
//     What ships instead is satisfiable and strictly stronger: with the subject
//     now a FIXED literal, a `.*` that only ever needed to be loose for a
//     variable path is needlessly loose and would also match an unrelated
//     future commit whose message happens to carry those words. Both greps are
//     tightened to the fixed subject, and BOTH directions are pinned — it must
//     still match the real M126 subject, and it must NOT match a near-miss the
//     loose form accepted.
//
// (4) M126's SCOPE GUARD IS RETIRED HERE, WHICH IS ITS OWN AUTHORISED MOMENT.
//
//     `m126-ste-477-propagation-subject-length.test.ts` carries, under
//     `AC-STE-477.6`, a "SCOPE GUARD: … SKILL.md is byte-unchanged" test whose
//     own comment names STE-488/M127 as the authorised repairer. It compares
//     the WORKING TREE against `git show HEAD:`, so it goes green the moment
//     this milestone commits and thereafter asserts NOTHING whatever changes —
//     vacuous by construction after the first commit. Its sibling pins
//     `lines[997]` / `lines[1005]` by FIXED INDEX, which every edit in this FR
//     moves. Both are retired with the reason recorded; the property worth
//     keeping — "the propagation greps are live and match the shipped subject"
//     — is owned by AC-STE-488.5 below and asserted by EXECUTION, not by index.
//
// ===========================================================================
// THE CLAUSE SHAPES THIS FILE REQUIRES
// ===========================================================================
//
// Sub-fixture 4a, step 4 — the archive clause is inverted, not annotated:
//     `test ! -f ../dpt-test-project-linear/specs/frs/archive/<id>.md` exit 0
//   and its two surviving siblings (`git -C … log --oneline --since
//   '<step-4-start>'` ≥ 1 row, the tracker `Done` read) are untouched.
//
// Sub-fixture 9a — mirroring fixture 3c's two-clause shape exactly:
//     `bun "${CAP_ASSERT}" any-of /tmp/dpt-smoke-<tracker>-ste450-tracker-block.log identity_mode_conditional <…more spellings>` exit 0
//     `bun "${CAP_ASSERT}" any-of /tmp/dpt-smoke-<tracker>-ste450-tracker-block.log "GATE FAILED" <…more wordings>` exit 0
//   plus the section naming `identity_mode_conditional.ts`, where the canonical
//   sentence actually lives.
//
// Sub-fixture 9b — the same, against `…-ste450-plan-stem.log`, keyed on
//   `plan_identity_mode_conditional` and naming `plan_identity_mode_conditional.ts`.
//
// Two reduced captures ship as fixtures beside the existing five:
//     tests/fixtures/m127-falsifiability/gate-check-ste450-tracker-block-none.ndjson
//     tests/fixtures/m127-falsifiability/gate-check-ste450-plan-stem-none.ndjson
//   reduced from the real 2026-08-16 `none`-leg logs, PRESERVING every
//   assistant-scoped count quoted above — including the zeros, which are the
//   evidence that the retired assertions were unsatisfiable.
//
// AC-STE-488.6's registry row therefore measures FOUR clauses across TWO
// captures. A clause scored against the other sub-fixture's capture goes
// VACUOUS by measurement, not by convention: `plan_identity_mode_conditional`
// is assistant=0 in the tracker-block capture. Every clause invokes
// `capability_row_assert`, which prints a one-line VERDICT and signals through
// its exit status, so every clause MUST score `exit-code` — on stdout each half
// reads as 1 line and the pair is 1-vs-1, vacuous by construction (STE-485).

import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  FALSIFIABILITY_FIXTURE_DIR,
  M127_REPAIRS,
  M127_REPAIR_ROSTER,
  SMOKE_SKILL_RELATIVE_PATH,
  checkRepairClauses,
  extractAssertionShell,
  harnessOutcomeFor,
  uncoveredRepairs,
  type AssertionSite,
  type RepairEntry,
} from "../adapters/_shared/src/falsifiability_harness";
import { PROPAGATION_COMMIT_SUBJECT } from "../adapters/_shared/src/propagation_commit_message";

// ───────────────────────────── fixed anchors ──────────────────────────────

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const SMOKE_SKILL_PATH = join(REPO_ROOT, SMOKE_SKILL_RELATIVE_PATH);
const M126_TEST = join(PLUGIN_ROOT, "tests", "m126-ste-477-propagation-subject-length.test.ts");
// AC-STE-459.2's live-then-archive conditional — this suite must survive the
// milestone's OWN archival, which happens in the same run that writes it. A
// bare live path reddens the moment Phase 4 archives, and the failure reads as
// a defect in the assertion rather than as a moved file.
const M127_PLAN = existsSync(join(REPO_ROOT, "specs", "plan", "M127.md"))
  ? join(REPO_ROOT, "specs", "plan", "M127.md")
  : join(REPO_ROOT, "specs", "plan", "archive", "M127.md");
const CAP_ASSERT = join(PLUGIN_ROOT, "adapters", "_shared", "src", "capability_row_assert.ts");

/** The two probe modules AC-STE-488.4 forbids this FR from touching. */
const PROBE_MODULES = {
  identity: join(PLUGIN_ROOT, "adapters", "_shared", "src", "identity_mode_conditional.ts"),
  planIdentity: join(
    PLUGIN_ROOT,
    "adapters",
    "_shared",
    "src",
    "plan_identity_mode_conditional.ts",
  ),
} as const;

/**
 * sha256 of each probe module as it stands BEFORE this FR, recorded here rather
 * than derived from git.
 *
 * A `git show HEAD:` comparison is the shape M126's scope guard used, and it
 * goes vacuous the instant this milestone commits — it would then agree with
 * whatever the file happens to contain. A recorded digest cannot: it fails on
 * any edit, committed or not, forever. If a LATER milestone legitimately
 * changes a probe, it updates this constant deliberately, which is the point.
 */
// RE-RECORDED IN M137, deliberately, with evidence — read this before moving
// either value again.
//
// This pin's AC (`STE-488.4`) says "nothing in THIS FR touches the systems
// under test", and the docstring above says "as it stands BEFORE this FR".
// Both scope the claim to one FR. The IMPLEMENTATION scopes it to all future
// time: a working-tree byte digest fails for anyone who ever edits these
// modules again. That gap is a real defect in the pin, banked as its own FR —
// the durable repair is a BEHAVIOURAL pin over the two probes, not a byte
// digest, because "the module at commit X hashed to D" is an assertion about
// frozen history that can never fail once true, which would trade an
// over-strict guard for a vacuous one.
//
// `planIdentity` moved because M137 added exactly two `export` keywords and a
// comment, so `scan_plan_narrative_altitude.ts` could honour the SAME
// `kind: legacy` / `kind: scaffolding` hatch instead of declaring a second copy
// of it. A second exempt-kind list is the drift this milestone removed twice.
//
// BEHAVIOUR WAS PROVED UNCHANGED, not assumed: both probes' suites were run
// against the module before and after — 294 tests across 7 files
// (gate-check-identity-mode-conditional, gate-check-plan-identity-mode-
// conditional, m119-441, m119-442, m120-443, m126-481, m116-424) — identical
// pass/fail/skip AND identical `expect()` counts both ways.
//
// A digest that may never be re-recorded is not a pin, it is a freeze, and a
// freeze on a live module trips on every legitimate refactor while carrying no
// information. Re-recording is legitimate when it is deliberate, reviewed, and
// carries evidence. Do it that way or not at all.
const PROBE_MODULE_SHA256 = {
  identity: "ea2ca90d8e00c119bea9cd02c30d23b58f7a4a076ed7557800cb1db0e6d63326",
  planIdentity: "eb4424954dd0bbb7786d843179154f6d5fe5471608f15084a7ef22912b34fc4b",
} as const;

/** The two canonical probe sentences the retired assertions demanded verbatim. */
const CANONICAL_MESSAGES = {
  identity: "mode-none FR carries a tracker: block that should be absent",
  planIdentity: "mode-none minted plan's id: does not derive its own filename",
} as const;

/** The two reduced `none`-leg captures this FR ships. */
const NEW_FIXTURES = {
  trackerBlock: join(FALSIFIABILITY_FIXTURE_DIR, "gate-check-ste450-tracker-block-none.ndjson"),
  planStem: join(FALSIFIABILITY_FIXTURE_DIR, "gate-check-ste450-plan-stem-none.ndjson"),
} as const;

const read = (p: string): string => readFileSync(p, "utf8");
const smokeSkill = (): string => read(SMOKE_SKILL_PATH);
const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

// ───────────────────────────── section slicing ────────────────────────────

/**
 * Markdown section from the heading matching `pred` to the next equal-or-
 * shallower one, SKIPPING fenced blocks.
 *
 * Fence-awareness is load-bearing, not tidiness: a bash fence in this SKILL
 * routinely opens with a `# …` comment and a naive `^#{1,6} ` stop matches it,
 * truncating the slice so every downstream `includes(…)` reads false because
 * the text was never reached. STE-487 hit that twice in this same milestone.
 */
function sectionByHeading(body: string, pred: (line: string) => boolean): string {
  const lines = body.split("\n");
  const fence = /^\s*(```|~~~)/;
  const start = lines.findIndex((l) => /^#{1,6} /.test(l) && pred(l));
  if (start < 0) return "";
  const depth = (lines[start] as string).match(/^#+/)![0].length;
  const stop = new RegExp(`^#{1,${depth}} `);
  let inFence = false;
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i] as string;
    if (fence.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence && stop.test(line)) return lines.slice(start, i).join("\n");
  }
  return lines.slice(start).join("\n");
}

const section = (heading: string): string => {
  const re = new RegExp(`^#{1,6} ${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
  const body = sectionByHeading(smokeSkill(), (l) => re.test(l));
  expect(body.length).toBeGreaterThan(200); // the anchor still resolves
  return body;
};

const group4 = () => section("Fixture group 4");
const fixture4a = () => section("Sub-fixture 4a");
const fixture9a = () => section("Sub-fixture 9a");
const fixture9b = () => section("Sub-fixture 9b");

/** The SKILL's own bytes for one assertion site — never a paraphrase. */
const shellAt = (site: AssertionSite): string =>
  extractAssertionShell(smokeSkill(), site).shell;

// ───────────────────────────── execution helpers ──────────────────────────

const tempDirs: string[] = [];

function scratch(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const d of tempDirs) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});

interface ShellRun {
  readonly code: number;
  readonly stdout: string;
}

/** Run a shell form verbatim. A non-zero exit is DATA — `grep -c` exits 1 on 0. */
function runShell(command: string, cwd: string): ShellRun {
  const proc = spawnSync("bash", ["-c", command], {
    cwd,
    encoding: "utf8",
    env: { ...process.env },
  });
  return { code: proc.status ?? -1, stdout: (proc.stdout ?? "").trim() };
}

/** Lines on stdout, blank-stripped. */
const rows = (run: ShellRun): number =>
  run.stdout === "" ? 0 : run.stdout.split("\n").filter((l) => l.trim() !== "").length;

/** The single integer a `| wc -l` form prints. */
function countOf(run: ShellRun): number {
  const n = Number.parseInt(run.stdout, 10);
  expect(Number.isNaN(n)).toBe(false);
  return n;
}

let repoSeq = 0;

/** A throwaway git repo with deterministic identity and no hooks. */
function tempGitRepo(): string {
  const dir = scratch("ste488-git-");
  execFileSync("git", ["init", "-q", "-b", "main", dir]);
  for (const [k, v] of [
    ["user.email", "ste488@example.invalid"],
    ["user.name", "STE-488 harness"],
    ["commit.gpgsign", "false"],
  ]) {
    execFileSync("git", ["-C", dir, "config", k as string, v as string]);
  }
  return dir;
}

/**
 * One commit carrying exactly `subject`, optionally BACKDATED.
 *
 * The backdate is not decoration. `--since` with a future cut-off does not
 * exclude a commit made now — git clamps it — so "the window is empty" cannot
 * be staged by moving the cut-off forward. It is staged by moving the COMMIT
 * back, which is the real shape anyway: a step-4 window that opened after the
 * previous step's commit.
 */
function commitSubject(dir: string, subject: string, when?: string): void {
  repoSeq += 1;
  writeFileSync(join(dir, `f${repoSeq}.txt`), `${repoSeq}\n`, "utf8");
  execFileSync("git", ["-C", dir, "add", "-A"]);
  execFileSync("git", ["-C", dir, "commit", "-q", "--no-verify", "-m", subject], {
    env: when
      ? { ...process.env, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when }
      : { ...process.env },
  });
}

/** Substitute every `<placeholder>` the SKILL leaves for the driver to fill. */
function bind(shell: string, pairs: Record<string, string>): string {
  let out = shell;
  for (const [token, value] of Object.entries(pairs)) out = out.split(token).join(value);
  return out;
}

/** `bun capability_row_assert.ts <mode> <capture> <keys…>` → exit code. */
function capAssert(mode: string, capture: string, keys: string[]): ShellRun {
  const proc = spawnSync(process.execPath, [CAP_ASSERT, mode, capture, ...keys], {
    encoding: "utf8",
    cwd: REPO_ROOT,
    env: { ...process.env },
  });
  return { code: proc.status ?? -1, stdout: (proc.stdout ?? "").trim() };
}

// ══════════════════════════════════════════════════════════════════════════
// AC-STE-488.1 — the group-4 archive contradiction is resolved in the
//                advisory's favour. Exactly ONE account survives, and the
//                loser is CORRECTED, not annotated.
// ══════════════════════════════════════════════════════════════════════════

describe("AC-STE-488.1 — one account of archival survives, and it is the advisory's", () => {
  test("the two passages that WIN are still in the document, verbatim", () => {
    // The correction is only a correction if the surviving account is the one
    // the run actually produces. Retiring the assertion AND softening the
    // advisory would leave the reader with no account at all.
    const body = smokeSkill();
    expect(body).toContain("which silent-skips Phase 5");
    expect(body).toContain("The end state is correct, not drift");
    expect(body).toContain("There is no archive commit on this leg.");
  });

  test("group 4's step-4 prose no longer claims the FR archives", () => {
    const body = group4();
    expect(body).not.toContain("FR archives to");
    expect(body).not.toContain("`status: archived`");
    expect(body).not.toContain("specs/frs/archive/<id>.md` (`status: archived`)");
  });

  test("group 4 states the surviving account where the reader meets the fixture", () => {
    // Correcting the clause but leaving the WHY three sections away is how this
    // contradiction survived two conformance runs. The single-FR silent-skip is
    // named right here, with its FR id, so nobody arbitrates it a third time.
    const body = group4();
    expect(body).toContain("STE-181");
    expect(/single-FR|<feature-id>/.test(body)).toBe(true);
    expect(body).toContain("status: active");
  });

  test("no step-4 clause requires the archive file to EXIST", () => {
    // The precise defect: `test -f …/archive/<id>.md` exit 0. Any surviving
    // positive-existence form on an archive path is the same assertion under a
    // different spelling.
    const body = group4();
    for (const line of body.split("\n")) {
      if (!line.includes("archive/")) continue;
      expect(/test\s+-[fe]\s+\S*archive\//.test(line)).toBe(false);
      expect(/-f\s+\S*archive\/\S*`?\s*exit 0/.test(line)).toBe(false);
    }
  });

  test("the repaired clause asserts ABSENCE and is written as an executable test", () => {
    const shell = shellAt({ section: "Sub-fixture 4a", select: "archive/" });
    expect(shell).toContain("archive/");
    expect(/test\s+!\s+-[fe]\s/.test(shell)).toBe(true);
  });

  test("EXECUTION — the repaired clause passes on a correctly-unarchived FR", () => {
    const shell = shellAt({ section: "Sub-fixture 4a", select: "archive/" });
    const project = scratch("ste488-proj-");
    mkdirSync(join(project, "specs", "frs", "archive"), { recursive: true });
    writeFileSync(join(project, "specs", "frs", "STE-999.md"), "status: active\n", "utf8");

    const cmd = bind(shell, {
      "../dpt-test-project-linear": project,
      "<id>": "STE-999",
    });
    expect(runShell(cmd, project).code).toBe(0);
  });

  test("FALSIFIABILITY — the repaired clause goes RED when the FR IS archived", () => {
    // The half that makes the clause evidence rather than decoration. The
    // retired form could not fail on a healthy run; this one cannot pass on an
    // unhealthy one.
    const shell = shellAt({ section: "Sub-fixture 4a", select: "archive/" });
    const project = scratch("ste488-proj-archived-");
    mkdirSync(join(project, "specs", "frs", "archive"), { recursive: true });
    writeFileSync(
      join(project, "specs", "frs", "archive", "STE-999.md"),
      "status: archived\n",
      "utf8",
    );

    const cmd = bind(shell, {
      "../dpt-test-project-linear": project,
      "<id>": "STE-999",
    });
    expect(runShell(cmd, project).code).not.toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// AC-STE-488.2 — group 4 still passes on a healthy run: the other three
//                step-4 outcomes, green on BOTH legs, are untouched.
// ══════════════════════════════════════════════════════════════════════════

describe("AC-STE-488.2 — the three surviving step-4 outcomes are untouched", () => {
  test("the step-4 prose keeps gate-check, the implementation commit and the Done ticket", () => {
    const body = group4();
    expect(body).toContain("gate-check passes");
    expect(body).toContain("implementation commit lands");
    expect(body).toContain("tracker ticket reaches `Done`");
  });

  test("4a still carries the commit-landed clause and the tracker Done read", () => {
    const body = fixture4a();
    expect(body).toContain("--since '<step-4-start>'");
    expect(body).toContain("mcp__linear__get_issue");
    expect(body).toContain('status: "Done"');
  });

  test("steps 1–3 are untouched — this FR repairs step 4 only", () => {
    const body = fixture4a();
    expect(body).toContain("grep -F 'needs_technical_review: true'");
    expect(body).toContain("implement_refused_needs_technical_review");
    expect(body).toContain("--since '<step-2-start>'");
  });

  test("4b's parity clause survives, so the Jira leg inherits the repair", () => {
    const body = section("Sub-fixture 4b");
    expect(body).toContain("All other assertions identical to 4a");
  });

  test("EXECUTION — the commit-landed clause is ≥ 1 row after a commit in the window", () => {
    const shell = shellAt({ section: "Sub-fixture 4a", select: "<step-4-start>" });
    const repo = tempGitRepo();
    commitSubject(repo, "feat(greet): land the implementation");
    const cmd = bind(shell, {
      "../dpt-test-project-linear": repo,
      "<step-4-start>": "1970-01-01T00:00:00Z",
    });
    expect(rows(runShell(cmd, repo))).toBeGreaterThanOrEqual(1);
  });

  test("FALSIFIABILITY — the same clause is 0 rows when no commit landed", () => {
    const shell = shellAt({ section: "Sub-fixture 4a", select: "<step-4-start>" });
    const repo = tempGitRepo();
    // The only commit predates the window: step 4 landed nothing of its own.
    commitSubject(repo, "chore: seed before the window opens", "2000-01-01T00:00:00Z");
    const cmd = bind(shell, {
      "../dpt-test-project-linear": repo,
      "<step-4-start>": "2020-01-01T00:00:00Z",
    });
    expect(rows(runShell(cmd, repo))).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// AC-STE-488.3 — 9a and 9b are re-keyed onto what `/gate-check` renders, and
//                point at the module for the canonical sentence.
// ══════════════════════════════════════════════════════════════════════════

describe("AC-STE-488.3 — 9a/9b measure the rendered surface, not the module's sentence", () => {
  test("neither sub-fixture still demands the probe's message verbatim from a capture", () => {
    const a = fixture9a();
    const b = fixture9b();
    expect(a).not.toContain("the capture carries the probe's own message");
    expect(a.includes(CANONICAL_MESSAGES.identity) && a.includes("the capture carries")).toBe(
      false,
    );
    expect(b).not.toContain("the probe's message `mode-none minted plan's id:");
  });

  test("9a asserts the rendered probe identifier, as an any-of over ≥ 2 spellings", () => {
    // Single-literal re-keying is how fixture 3c drifted three times: the SAME
    // jira leg rendered probe #37 underscored 17 / hyphenated 0 in July and
    // underscored 0 / hyphenated 2 in August — a complete inversion.
    const shell = shellAt({
      section: "Sub-fixture 9a",
      select: 'ste450-tracker-block.log "**#13 "',
    });
    expect(shell).toContain("CAP_ASSERT");
    expect(shell).toContain("any-of");
    const keys = shell.split("ste450-tracker-block.log")[1] ?? "";
    expect(keys.trim().split(/\s+/).filter((t) => t !== "" && t !== "`").length)
      .toBeGreaterThanOrEqual(2);
  });

  test("9a asserts the rendered VERDICT, as its own any-of clause", () => {
    const shell = shellAt({
      section: "Sub-fixture 9a",
      select: 'ste450-tracker-block.log "GATE FAILED"',
    });
    expect(shell).toContain("CAP_ASSERT");
    expect(shell).toContain("any-of");
  });

  test("9b asserts the rendered probe identifier and verdict against its OWN capture", () => {
    const id = shellAt({
      section: "Sub-fixture 9b",
      select: 'ste450-plan-stem.log "**#73 "',
    });
    expect(id).toContain("any-of");
    const verdict = shellAt({
      section: "Sub-fixture 9b",
      select: 'ste450-plan-stem.log "GATE FAILED"',
    });
    expect(verdict).toContain("any-of");
  });

  test("each canonical sentence lives in exactly ONE module, and the section names it", () => {
    // This is what makes "read directly from the module" available at all: one
    // address per sentence, so the reader who wants the exact wording has one
    // place to go and no capture to interrogate.
    const grep = (needle: string): string[] =>
      execFileSync(
        "bash",
        [
          "-c",
          `grep -rl -F ${JSON.stringify(needle)} ${JSON.stringify(
            join(PLUGIN_ROOT, "adapters"),
          )} || true`,
        ],
        { encoding: "utf8" },
      )
        .split("\n")
        .filter((l) => l.trim() !== "");

    expect(grep(CANONICAL_MESSAGES.identity)).toEqual([PROBE_MODULES.identity]);
    expect(grep(CANONICAL_MESSAGES.planIdentity)).toEqual([PROBE_MODULES.planIdentity]);

    expect(fixture9a()).toContain("identity_mode_conditional.ts");
    expect(fixture9b()).toContain("plan_identity_mode_conditional.ts");
  });

  test("the shipped captures ship, and preserve the measurement that retired the old clauses", () => {
    for (const p of Object.values(NEW_FIXTURES)) expect(existsSync(p)).toBe(true);

    // The zeros are the evidence. A reduced slice that quietly dropped them
    // would let a future reader conclude the old assertions were satisfiable.
    expect(capAssert("present", NEW_FIXTURES.trackerBlock, [CANONICAL_MESSAGES.identity]).code)
      .not.toBe(0);
    expect(capAssert("present", NEW_FIXTURES.planStem, [CANONICAL_MESSAGES.planIdentity]).code)
      .not.toBe(0);

    // …and the re-keyed subjects really are there, on the assistant surface.
    expect(capAssert("present", NEW_FIXTURES.trackerBlock, ["GATE FAILED"]).code).toBe(0);
    expect(
      capAssert("present", NEW_FIXTURES.trackerBlock, ["identity_mode_conditional"]).code,
    ).toBe(0);
    expect(capAssert("present", NEW_FIXTURES.planStem, ["GATE FAILED"]).code).toBe(0);
    expect(
      capAssert("present", NEW_FIXTURES.planStem, ["plan_identity_mode_conditional"]).code,
    ).toBe(0);
  });

  test("the two captures are NOT interchangeable — each measures its own probe", () => {
    // Why AC-STE-488.6's row needs a capture per clause rather than one for the
    // repair. Scored against the wrong half, 9b's clause reads 0 and goes
    // vacuous; this is that fact pinned so a later simplification cannot merge
    // them back into one capture and still look green.
    expect(
      capAssert("present", NEW_FIXTURES.trackerBlock, ["plan_identity_mode_conditional"]).code,
    ).not.toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// AC-STE-488.4 — both probes are byte-unchanged. Nothing here touches a SUT.
// ══════════════════════════════════════════════════════════════════════════

describe("AC-STE-488.4 — the systems under test are not touched", () => {
  test("both probe modules match their recorded digests exactly", () => {
    expect(sha256(read(PROBE_MODULES.identity))).toBe(PROBE_MODULE_SHA256.identity);
    expect(sha256(read(PROBE_MODULES.planIdentity))).toBe(PROBE_MODULE_SHA256.planIdentity);
  });

  test("SANITY — the digest discriminates, and the pinned files are real files", () => {
    // HONESTY ABOUT WHAT THIS PROVES, because the name it used to carry —
    // "NON-VACUITY" — claimed more than it delivers, in the one milestone where
    // that is the whole subject.
    //
    // `sha256(text + " ") !== recorded` is GUARANTEED true the moment the base
    // digest matches, which the test above already asserted. So this cannot
    // fail while that one passes: it is a sanity check on the hash function,
    // not evidence that the pin binds.
    //
    // What actually makes the pin non-vacuous is its DESIGN plus a mutation
    // run: the digests are hard-coded literals in `PROBE_MODULE_SHA256`, never
    // recomputed from the files they check, and appending one byte to EITHER
    // probe module was measured to redden the pin above (both modules
    // independently). That is the evidence; this is the guard rail.
    expect(sha256(`${read(PROBE_MODULES.identity)} `)).not.toBe(PROBE_MODULE_SHA256.identity);
    expect(read(PROBE_MODULES.identity).length).toBeGreaterThan(1000);
    expect(read(PROBE_MODULES.planIdentity).length).toBeGreaterThan(1000);
  });

  test("both canonical sentences are still emitted by their probes", () => {
    // The digest already covers this, but the sentence is what 9a/9b point the
    // reader AT — so it is named here explicitly rather than left implicit in a
    // hash nobody can read.
    expect(read(PROBE_MODULES.identity)).toContain(CANONICAL_MESSAGES.identity);
    expect(read(PROBE_MODULES.planIdentity)).toContain(CANONICAL_MESSAGES.planIdentity);
  });

  test("git agrees: neither probe module is modified in this working tree", () => {
    // The weaker, transient half — it goes quiet once the milestone commits,
    // which is exactly why the digests above exist and this does not stand alone.
    const status = execFileSync(
      "git",
      [
        "-C",
        REPO_ROOT,
        "status",
        "--porcelain",
        "--",
        "plugins/dev-process-toolkit/adapters/_shared/src/identity_mode_conditional.ts",
        "plugins/dev-process-toolkit/adapters/_shared/src/plan_identity_mode_conditional.ts",
      ],
      { encoding: "utf8" },
    ).trim();
    expect(status).toBe("");
  });
});

// ══════════════════════════════════════════════════════════════════════════
// AC-STE-488.5 — the propagation greps are tightened onto STE-477's fixed
//                subject. Both directions pinned by EXECUTION.
// ══════════════════════════════════════════════════════════════════════════

describe("AC-STE-488.5 — the propagation greps are tightened, not merely restated", () => {
  const positive = () => shellAt({ section: "Sub-fixture 3a", select: "git log --grep" });
  const control = () => shellAt({ section: "Sub-fixture 3b", select: "git log --grep" });

  /** Both spans, bound to a real run-start. */
  const bound = (shell: string) => bind(shell, { "<run-start>": "1970-01-01T00:00:00Z" });

  /** A near-miss the LOOSE form accepted and the tightened one must not. */
  const NEAR_MISS = "docs(specs): propagate a stale removal to cross-cutting specs by hand";

  test("the retired loose form still matches the shipped subject — the premise was false", () => {
    // Recorded permanently. AC-STE-488.5 says M126 "silently broke" group 3a;
    // it did not. The old grep was written path-agnostic BECAUSE the pre-M126
    // subject interpolated the removed path, and `.*` absorbs `" file "` in the
    // new fixed subject just as happily.
    const repo = tempGitRepo();
    commitSubject(repo, PROPAGATION_COMMIT_SUBJECT);
    const legacy =
      "git log --grep 'propagate.*removal to cross-cutting specs' " +
      "--since '1970-01-01T00:00:00Z' | wc -l";
    expect(countOf(runShell(legacy, repo))).toBeGreaterThanOrEqual(1);

    // …and this is why tightening is strictly stronger rather than a repair:
    // the loose form also accepts an unrelated commit.
    const repo2 = tempGitRepo();
    commitSubject(repo2, NEAR_MISS);
    expect(countOf(runShell(legacy, repo2))).toBeGreaterThanOrEqual(1);
  });

  test("both spans carry STE-477's fixed subject, sourced from the producer module", () => {
    // Derived from `PROPAGATION_COMMIT_SUBJECT`, never re-typed: a test-local
    // copy of this very subject stayed green under the producer regression it
    // existed to catch (STE-461).
    expect(positive()).toContain(PROPAGATION_COMMIT_SUBJECT);
    expect(control()).toContain(PROPAGATION_COMMIT_SUBJECT);
  });

  test("neither span still carries the needlessly-loose wildcard", () => {
    expect(positive()).not.toContain("propagate.*removal");
    expect(control()).not.toContain("propagate.*removal");
  });

  test("EXECUTION — 3a's tightened grep still matches the real M126 subject", () => {
    const repo = tempGitRepo();
    commitSubject(repo, PROPAGATION_COMMIT_SUBJECT);
    expect(countOf(runShell(bound(positive()), repo))).toBeGreaterThanOrEqual(1);
  });

  test("FALSIFIABILITY — 3a's tightened grep does NOT match a near-miss the loose form took", () => {
    const repo = tempGitRepo();
    commitSubject(repo, NEAR_MISS);
    expect(countOf(runShell(bound(positive()), repo))).toBe(0);
  });

  test("EXECUTION — 3b's control grep is 0 in a window with no propagation commit", () => {
    const repo = tempGitRepo();
    commitSubject(repo, "feat(greet): ordinary implementation commit");
    expect(countOf(runShell(bound(control()), repo))).toBe(0);
  });

  test("FALSIFIABILITY — 3b's control grep is non-zero when a propagation commit DOES land", () => {
    // The control's own red condition. Without this half a control that matched
    // nothing at all would read as a permanent pass.
    const repo = tempGitRepo();
    commitSubject(repo, PROPAGATION_COMMIT_SUBJECT);
    expect(countOf(runShell(bound(control()), repo))).toBeGreaterThanOrEqual(1);
  });

  test("the plan records that the AC's stated premise was checked and found false", () => {
    const plan = read(M127_PLAN);
    expect(plan).toContain("AC-STE-488.5's premise");
    expect(plan).toContain("Group 3a is not broken and never was");
  });
});

// ══════════════════════════════════════════════════════════════════════════
// AC-STE-488.6 — STE-483's harness proves each rewritten assertion fails when
//                its subject genuinely misbehaves.
// ══════════════════════════════════════════════════════════════════════════

describe("AC-STE-488.6 — the falsifiability harness carries an STE-488 row", () => {
  const ste488 = (): RepairEntry | undefined =>
    M127_REPAIRS.find((e) => e.id === "STE-488");

  test("STE-488 is registered and no longer counted as uncovered", () => {
    expect(M127_REPAIR_ROSTER).toContain("STE-488");
    expect(ste488()).toBeDefined();
    expect(uncoveredRepairs(M127_REPAIRS, M127_REPAIR_ROSTER)).not.toContain("STE-488");
  });

  test("the row measures BOTH sub-fixtures — 9a and 9b are separate assertions", () => {
    const entry = ste488() as RepairEntry;
    const sections = [entry.site, ...(entry.clauses ?? []).map((c) => c.site)].map(
      (s) => s.section,
    );
    expect(sections.some((s) => s.includes("9a"))).toBe(true);
    expect(sections.some((s) => s.includes("9b"))).toBe(true);
    expect(sections.length).toBeGreaterThanOrEqual(4);
  });

  test("EVERY clause scores by exit code — stdout-count is provably vacuous here", () => {
    // `capability_row_assert` prints a one-line VERDICT and signals through its
    // exit status. Scored on stdout, both halves read as 1 line and every
    // clause would be 1-vs-1 (the STE-485 lesson).
    const entry = ste488() as RepairEntry;
    expect(entry.scoreBy).toBe("exit-code");
    for (const clause of entry.clauses ?? []) expect(clause.scoreBy).toBe("exit-code");
  });

  test("extract → bind → run against LIVE SKILL bytes: every clause is falsifiable", () => {
    const results = checkRepairClauses(ste488() as RepairEntry, smokeSkill());
    expect(results.length).toBeGreaterThanOrEqual(4);
    for (const r of results) {
      expect(r.removed).toBeGreaterThan(0); // the mutation genuinely applied
      expect(r.verdict).toBe("falsifiable");
    }
    expect(harnessOutcomeFor(results)).toBe("harness-fails");
  });

  test("the present half really clears the bar and the absent half really does not", () => {
    const entry = ste488() as RepairEntry;
    const thresholds = [entry, ...(entry.clauses ?? [])].map((c) => c.threshold);
    const results = checkRepairClauses(entry, smokeSkill());
    expect(results.length).toBe(thresholds.length);
    results.forEach((r, i) => {
      expect(r.presentCount).toBeGreaterThanOrEqual(thresholds[i] as number);
      expect(r.absentCount).toBeLessThan(thresholds[i] as number);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════
// M126's scope guard is retired HERE — this is its authorised moment, and the
// property it stood for moves to AC-STE-488.5 above.
// ══════════════════════════════════════════════════════════════════════════

describe("M126's scope guard is retired, with the reason recorded", () => {
  test("the byte-unchanged SCOPE GUARD assertion is gone", () => {
    // It compares the working tree against `git show HEAD:`, so it goes green
    // the instant this milestone commits and thereafter asserts NOTHING
    // whatever changes — vacuous by construction, not by drift. Letting it
    // self-heal silently would leave a permanently-passing test in the gate.
    const body = read(M126_TEST);
    expect(body).not.toContain("SCOPE GUARD");
    expect(body).not.toContain("SKILL.md is byte-unchanged");
  });

  test("its line-index anchors are gone — every edit in this FR moved them", () => {
    const body = read(M126_TEST);
    expect(body).not.toContain("lines[997]");
    expect(body).not.toContain("lines[1005]");
  });

  test("the retirement records WHY, naming the milestone that did it", () => {
    const body = read(M126_TEST);
    expect(body).toContain("STE-488");
    expect(/vacuous/i.test(body)).toBe(true);
  });

  test("the property it stood for survives — the greps are live and executed", () => {
    // Retiring coverage and retiring an assertion are different acts, so the
    // property M126 pinned by line index has to still be pinned somewhere.
    //
    // THIS assertion is a static count — it checks the shipped subject is
    // present in the SKILL at least twice (3a's span and 3b's), which is the
    // structural half of what the index pins said. It is NOT execution, and
    // saying so matters: a comment claiming more than its assertion does is the
    // defect class this milestone exists to remove, and an earlier draft of
    // this very comment claimed "pinned here by EXECUTION".
    //
    // The EXECUTED half lives in § AC-STE-488.5 above, which builds throwaway
    // git repositories and runs the extracted spans against them in both
    // directions — matching the real subject and rejecting the near-miss the
    // retired loose form accepted. Between the two, the property is covered
    // better than the index form ever covered it; neither alone is the claim.
    const body = smokeSkill();
    expect(body.split(PROPAGATION_COMMIT_SUBJECT).length - 1).toBeGreaterThanOrEqual(2);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// CROSS-SUBJECT ISOLATION — the pin that would have caught the false green.
//
// Found by the STE-488 spec-review audit, after two implementer passes and a
// refactor had all reported the re-key clean. The original 9a arm was the bare
// probe key `identity_mode_conditional`, which is a SUBSTRING of 9b's
// `plan_identity_mode_conditional` — so 9a's clause exited 0 against 9b's
// capture, where probe #13 never fired at all (it PASSED there; the hit was
// probe #73's row). A run in which #13 never fired could satisfy 9a purely
// because #73 did: the wrong-subject class this FR exists to remove, arriving
// inside the repair for it.
//
// The old tests pinned only the direction that already worked — each clause
// passing on its OWN capture. Nothing asserted that a clause FAILS on its
// sibling's, which is the half where a substring hazard lives. That asymmetry
// is the general lesson: a clause is not isolated because it passes where it
// should, only because it also fails where it should.
// ══════════════════════════════════════════════════════════════════════════

describe("cross-subject isolation — each sub-fixture's clause fails on its SIBLING's capture", () => {
  /** The arms as the SKILL ships them, extracted rather than retyped. */
  const armsOf = (section: string): string[] => {
    const span = shellAt({ section, select: `${section === "Sub-fixture 9a" ? "ste450-tracker-block" : "ste450-plan-stem"}.log "**#` });
    return [...span.matchAll(/"([^"]*#\d[^"]*)"/g)].map((m) => m[1] as string);
  };

  test("9a's identifier arms are satisfied by its OWN capture", () => {
    const arms = armsOf("Sub-fixture 9a");
    expect(arms.length).toBeGreaterThanOrEqual(2);
    expect(capAssert("any-of", NEW_FIXTURES.trackerBlock, arms).code).toBe(0);
  });

  test("9a's identifier arms FAIL on 9b's capture — probe #13 never fired there", () => {
    // The load-bearing half. With the retired bare-key arm this exited 0.
    expect(capAssert("any-of", NEW_FIXTURES.planStem, armsOf("Sub-fixture 9a")).code).not.toBe(0);
  });

  test("9b's identifier arms are satisfied by its OWN capture", () => {
    const arms = armsOf("Sub-fixture 9b");
    expect(arms.length).toBeGreaterThanOrEqual(2);
    expect(capAssert("any-of", NEW_FIXTURES.planStem, arms).code).toBe(0);
  });

  test("9b's identifier arms FAIL on 9a's capture", () => {
    expect(capAssert("any-of", NEW_FIXTURES.trackerBlock, armsOf("Sub-fixture 9b")).code).not.toBe(0);
  });

  test("NON-VACUITY — the retired bare key really did span both captures", () => {
    // Kept as the standing record of the defect: if someone reinstates the bare
    // key, this documents exactly what it costs. Both exit 0 — that IS the bug.
    expect(capAssert("any-of", NEW_FIXTURES.trackerBlock, ["identity_mode_conditional"]).code).toBe(0);
    expect(capAssert("any-of", NEW_FIXTURES.planStem, ["identity_mode_conditional"]).code).toBe(0);
  });
});
