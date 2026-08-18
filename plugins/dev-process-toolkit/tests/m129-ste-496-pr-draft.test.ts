// M129 STE-496 — `/pr` can open a pull request as a draft.
//
// WHAT IS BROKEN, measured on this tree at authoring time (2026-08-17, v2.67.1):
//
//   * `grep -rin draft skills/pr/SKILL.md docs/pr-tracker-mode.md` → ZERO hits.
//     The pull-request surface has no draft vocabulary at all, on either the
//     tracker-less path or the tracker-mode one.
//   * `ls adapters/_shared/src/pr_draft*` → no matches. The module this file
//     specifies does not exist.
//   * `skills/pr/SKILL.md` is 61 lines with a two-key frontmatter block
//     (`name`, `description`) and NO `argument-hint` key, so there is no place
//     an explicit draft request is currently advertised.
//   * `skills/pr/SKILL.md:43` — `5. Create the PR using \`gh pr create\`:` is
//     the only PR-opening invocation on the surface, and it carries no flags.
//
// TEST STRATEGY, and why no half of it is a tautology.
//
//   * BEHAVIOUR FIRST, PROSE SECOND. This repo has a documented history of
//     prose-grep ACs reading green while the behaviour is absent (STE-492 is
//     exactly that defect). So the draft-request parser, the `gh pr create`
//     argv builder, the closing-report renderer, and the unsupported-host
//     refusal all live in `adapters/_shared/src/pr_draft.ts` and are exercised
//     as CODE. Every prose pin in this file is the second half of a pair whose
//     first half is behavioural.
//   * AC.2 IS THE BACKWARD-COMPATIBILITY SPINE, AND IT IS NOT A GREP. The
//     default is pinned three ways that all go RED if the default path moves:
//     (a) `buildPrCreateArgv({})` — draft not even mentioned — must emit an
//     argv carrying NO `--draft`; (b) a default `planPullRequest` run must emit
//     an argv carrying no `--draft` in EVERY tracker mode; (c) the six shipped
//     `## Steps` lines must still be present, verbatim, in order — asserted
//     through a helper that is itself proven to REJECT a mutated body, so the
//     order check cannot pass vacuously.
//     Scope note: AC.2 says a run that does not ask for a draft "behaves
//     exactly as it does today" — that is the invocation and the flow. AC.3
//     separately requires the state to be legible in the report, so the report
//     naming `ready for review` on a default run is AC.3 doing its job, not an
//     AC.2 regression. This file draws the line exactly there.
//   * AC.5 IS MUTATION-VERIFIED, IN BOTH DIRECTIONS. `DRAFT_SUPPORT_GUARDS` is
//     an exported list and both entry points accept a guard-list override, so
//     each guard is dropped in turn and its own host must flip from refused to
//     accepted while its siblings stay refused. A silent downgrade — a surface
//     that just opens a normal PR when draft is unsupported — fails the primary
//     leg, because `planPullRequest` on an unsupported host is asserted to
//     THROW rather than to return a `draft: false` plan. Per the M126 lesson,
//     every drop is asserted to have CHANGED the guard list before it is
//     scored: a mutation that never applied reads as a pass.
//   * ISOLATION EVERYWHERE. "Draft is never opened when unsupported" is
//     satisfied vacuously by a surface that never opens a draft at all, so the
//     supported host is asserted to genuinely produce `--draft` in the argv,
//     to genuinely report the draft state, and to do so on BOTH the tracker-mode
//     and tracker-less paths.
//   * AC.4 IS A SAMENESS PROOF, NOT A DOC GREP. The tracker-mode path is pinned
//     to produce the SAME draft argv as the tracker-less one, and the tracker
//     post-create MCP calls are pinned to be byte-identical whether or not a
//     draft was asked for — so draft support neither skips the tracker work nor
//     inflates the NFR-8 ≤ 2 MCP budget.
//
// DELIBERATE OMISSIONS.
//   * NO aggregate `/gate-check` probe-count assertion. The count is 79 after
//     STE-493 (#78) and STE-494 (#79) land in this same milestone; this FR
//     registers no probe, so any count pin here would be someone else's pin
//     and would red on their schedule, not on this FR's behaviour.
//   * NO new skill and NO new agent. The tripwires below pin 27 / 8 so a
//     "fix" that adds a `/pr-draft` skill fails here rather than in review.
//
// HARD BUDGETS, measured at authoring time:
//   * `skills/` tree: 246 / 246 STE-N tokens — ZERO headroom. New `/pr` prose
//     must cite by mechanism, never by ticket id.
//   * `skills/pr/SKILL.md`: 61 lines of a 358 cap — ample.
// This file lives under `tests/`, which carries neither budget.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { parseFrontmatter } from "../adapters/_shared/src/frontmatter";

// ===========================================================================
// Paths.
// ===========================================================================

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const SKILLS_DIR = join(PLUGIN_ROOT, "skills");
const AGENTS_DIR = join(PLUGIN_ROOT, "agents");
const DOCS_DIR = join(PLUGIN_ROOT, "docs");
const SHARED_SRC = join(PLUGIN_ROOT, "adapters", "_shared", "src");

const read = (p: string): string => readFileSync(p, "utf-8");
const skillPath = (name: string): string => join(SKILLS_DIR, name, "SKILL.md");
const skillBody = (name: string): string => read(skillPath(name));

const PR_SKILL = (): string => skillBody("pr");
const PR_TRACKER_DOC_FILE = join(DOCS_DIR, "pr-tracker-mode.md");
const PR_TRACKER_DOC = (): string => read(PR_TRACKER_DOC_FILE);

/**
 * The FR under test, resolved with the ARCHIVE FALLBACK. `/implement` Phase 4
 * `git mv`s the FR into `specs/frs/archive/` at milestone close, and a
 * meta-test that only knows the active path goes red at the archive commit —
 * the recurring failure recorded in the M100/M126 notes.
 */
function frPath(): string {
  const active = join(REPO_ROOT, "specs", "frs", "STE-496.md");
  if (existsSync(active)) return active;
  const archived = join(REPO_ROOT, "specs", "frs", "archive", "STE-496.md");
  if (existsSync(archived)) return archived;
  throw new Error(
    "STE-496.md found in neither specs/frs/ nor specs/frs/archive/",
  );
}

// ===========================================================================
// The module under test, imported LAZILY.
//
// A top-level static import of a not-yet-written module aborts the whole file,
// which would collapse five independent reds into one load error and hide
// which ACs are actually unmet. `frontmatter` IS imported statically above —
// it is shipped.
// ===========================================================================

const PR_DRAFT_MODULE = "../adapters/_shared/src/pr_draft";
const PR_DRAFT_MODULE_FILE = join(SHARED_SRC, "pr_draft.ts");

type DraftState = "draft" | "ready";
type TrackerMode = "none" | "linear" | "jira";

/** What the environment can actually do about draft pull requests. */
interface HostDraftSupport {
  /** Identity used in the refusal's `Context:` line. */
  readonly host: string;
  /** The host/repository can hold draft pull requests at all. */
  readonly draftCapable: boolean;
  /** The installed `gh` CLI accepts `--draft` on `pr create`. */
  readonly cliSupportsDraftFlag: boolean;
}

interface DraftSupportGuard {
  /** Stable id — the drop-one mutation keys on it. */
  readonly id: string;
  readonly reason: string;
  matches(host: HostDraftSupport): boolean;
}

interface DraftRequest {
  readonly draft: boolean;
  /** The invocation text with recognized flags removed. */
  readonly residualText: string;
  readonly raw: string;
}

interface PrPlan {
  readonly draft: boolean;
  readonly state: DraftState;
  /** The full `gh pr create …` invocation. */
  readonly argv: readonly string[];
  /** Tracker-mode post-create ops, in order. Empty in `mode: none`. */
  readonly mcpCalls: readonly string[];
  /** The closing report handed to the operator. */
  readonly report: string;
  readonly residualText: string;
}

interface PrPlanInput {
  /** Raw text after `/pr`. */
  readonly text: string;
  readonly mode: TrackerMode;
  readonly host: HostDraftSupport;
  readonly url?: string;
  readonly ticket?: string | null;
}

type GuardOptions = { guards?: readonly DraftSupportGuard[] };

interface ArgvInput {
  draft?: boolean;
  base?: string;
  title?: string;
  body?: string;
}

interface PrDraftModule {
  /** The literal `gh` flag. */
  GH_DRAFT_FLAG: string;
  /** The literal `/pr` invocation flag. */
  DRAFT_REQUEST_FLAG: string;
  DRAFT_STATE_LABELS: Record<DraftState, string>;
  DRAFT_SUPPORT_GUARDS: readonly DraftSupportGuard[];
  parseDraftRequest(text: string): DraftRequest;
  isDraftSupported(host: HostDraftSupport, options?: GuardOptions): boolean;
  assertDraftSupported(host: HostDraftSupport, options?: GuardOptions): void;
  buildPrCreateArgv(input?: ArgvInput): string[];
  prClosingReport(input: { url: string; draft: boolean }): string;
  planPullRequest(input: PrPlanInput, options?: GuardOptions): PrPlan;
}

async function prDraft(): Promise<PrDraftModule> {
  return (await import(PR_DRAFT_MODULE)) as unknown as PrDraftModule;
}

// ===========================================================================
// Fixtures shared across the AC blocks.
// ===========================================================================

const TRACKER_MODES: TrackerMode[] = ["none", "linear", "jira"];

const SUPPORTED_HOST: HostDraftSupport = {
  host: "github.com",
  draftCapable: true,
  cliSupportsDraftFlag: true,
};

/** One unsupported host per guard, each failing exactly ONE condition. */
const UNSUPPORTED_HOSTS: Record<string, HostDraftSupport> = {
  host_cannot_hold_drafts: {
    host: "git.internal.example",
    draftCapable: false,
    cliSupportsDraftFlag: true,
  },
  cli_lacks_draft_flag: {
    host: "github.com",
    draftCapable: true,
    cliSupportsDraftFlag: false,
  },
};

const EXPECTED_GUARD_IDS = [
  "host_cannot_hold_drafts",
  "cli_lacks_draft_flag",
] as const;

/** Invocations that ARE an explicit draft request. */
const DRAFT_REQUESTS = [
  "--draft",
  "  --draft  ",
  "--draft please be quick",
  "open it as a draft",
  "open the pull request as a draft",
] as const;

/** Invocations that are NOT a draft request — the parser's negative half. */
const NOT_DRAFT_REQUESTS = [
  "",
  "   ",
  "make it snappy",
  "use the feature branch",
  "not as a draft",
  "don't open it as a draft",
] as const;

/** The six shipped `## Steps` lines. AC.2's flow half. */
const SHIPPED_STEP_LINES = [
  "1. Check `git status` and `git log` to understand what's being submitted",
  "2. If on `main`, create a new branch from the changes:",
  "3. If there are uncommitted changes, confirm with the user before staging and committing",
  "4. Push the branch with `-u` flag",
  "5. Create the PR using `gh pr create`:",
  "6. Report the PR URL to the user",
] as const;

/** Other shipped `/pr` guarantees that must survive this FR untouched. */
const SHIPPED_PR_SENTENCES = [
  "PR titles are derived from the commit subject; amend the commit to change the title",
  "Default base branch is `main`",
  "Always confirm with the user before pushing if there are uncommitted changes",
] as const;

/** True when every needle appears in `body`, in the given order. */
function containsInOrder(body: string, needles: readonly string[]): boolean {
  let cursor = 0;
  for (const needle of needles) {
    const at = body.indexOf(needle, cursor);
    if (at === -1) return false;
    cursor = at + needle.length;
  }
  return true;
}

/** Assert an NFR-10 canonical refusal, and hand the message back for more pins. */
function expectNfr10Refusal(fn: () => unknown, label: string): string {
  let raised: unknown = null;
  try {
    fn();
  } catch (e) {
    raised = e;
  }
  expect(raised, `${label}: nothing was refused`).not.toBeNull();
  const msg = String((raised as Error).message);
  expect(msg, `${label}: no Refusing: line`).toContain("Refusing:");
  expect(msg, `${label}: no Remedy: line`).toContain("Remedy:");
  expect(msg, `${label}: no Context: line`).toContain("Context:");
  return msg;
}

const flagsOf = (argv: readonly string[]): string[] =>
  argv.filter((a) => a.startsWith("--"));

/** No element IS `--draft`, and none smuggles it inside a longer string. */
function expectNoDraftFlag(argv: readonly string[], label: string): void {
  expect(argv, `${label}: argv carries --draft`).not.toContain("--draft");
  for (const arg of argv) {
    expect(
      /(^|\s)--draft(\s|=|$)/.test(arg),
      `${label}: --draft smuggled inside ${JSON.stringify(arg)}`,
    ).toBe(false);
  }
}

// ===========================================================================
// TRIPWIRES — written first; they are what stops a bad "fix".
// ===========================================================================

describe("TRIPWIRE — the surfaces and budgets this FR's edits ride against", () => {
  const SKILL_LINE_CAP = 358;
  const SKILLS_STE_TOKEN_CEILING = 246;

  test("the FR still names all five ACs this file is written against", () => {
    const fr = read(frPath());
    for (let n = 1; n <= 5; n++) {
      expect(fr, `AC-STE-496.${n} missing from the FR`).toContain(
        `AC-STE-496.${n}:`,
      );
    }
  });

  test(`skills/pr/SKILL.md stays within the NFR-1 line cap (${SKILL_LINE_CAP})`, () => {
    // 61 / 358 at authoring time — ample room for the draft prose.
    expect(PR_SKILL().split("\n").length).toBeLessThanOrEqual(SKILL_LINE_CAP);
  });

  test(`the skills/ STE-token ceiling (${SKILLS_STE_TOKEN_CEILING}) is not breached`, () => {
    let count = 0;
    const walk = (d: string): void => {
      for (const name of readdirSync(d)) {
        const p = join(d, name);
        if (statSync(p).isDirectory()) {
          walk(p);
          continue;
        }
        if (!name.endsWith(".md")) continue;
        count += (read(p).match(/\b(STE|AC-STE)-\d+(?:\.\d+)?\b/g) ?? []).length;
      }
    };
    walk(SKILLS_DIR);
    expect(count).toBeLessThanOrEqual(SKILLS_STE_TOKEN_CEILING);
  });

  test("the roster is unchanged — 27 skills, 8 agents", () => {
    // Draft support is a `/pr` capability, not a new surface.
    expect(readdirSync(SKILLS_DIR).length).toBe(27);
    expect(readdirSync(AGENTS_DIR).length).toBe(8);
  });

  test("the tracker-mode reference is still the pointed-at companion document", () => {
    // AC.4's subject has to exist and has to be reachable from the skill, or
    // the tracker-path pins below would be about an orphan file.
    expect(existsSync(PR_TRACKER_DOC_FILE)).toBe(true);
    expect(PR_SKILL()).toContain("docs/pr-tracker-mode.md");
  });

  test("containsInOrder REJECTS a mutated body — the order helper is not vacuous", () => {
    // Without this, every "the shipped flow is intact" pin below could be
    // passing because the helper says yes to anything.
    const body = "alpha\nbeta\ngamma\n";
    expect(containsInOrder(body, ["alpha", "beta", "gamma"])).toBe(true);
    expect(containsInOrder(body, ["gamma", "alpha"])).toBe(false);
    expect(containsInOrder(body, ["alpha", "delta"])).toBe(false);
  });

  test("expectNoDraftFlag REJECTS an argv that carries the flag", () => {
    let raised: unknown = null;
    try {
      expectNoDraftFlag(["gh", "pr", "create", "--draft"], "control");
    } catch (e) {
      raised = e;
    }
    expect(raised, "the no-draft assertion accepts an argv with --draft").not.toBeNull();
  });
});

// ===========================================================================
// AC-STE-496.1 — `/pr` accepts an explicit request to open the PR as a draft.
// ===========================================================================

describe("AC-STE-496.1 — an explicit draft request is accepted", () => {
  test("the module exists at its pinned path under adapters/_shared/src", () => {
    expect(existsSync(PR_DRAFT_MODULE_FILE)).toBe(true);
  });

  test("the house flag is `--draft`, on both the /pr side and the gh side", async () => {
    const { GH_DRAFT_FLAG, DRAFT_REQUEST_FLAG } = await prDraft();
    expect(GH_DRAFT_FLAG).toBe("--draft");
    expect(DRAFT_REQUEST_FLAG).toBe("--draft");
  });

  test("every explicit draft request parses as a draft request", async () => {
    const { parseDraftRequest } = await prDraft();
    for (const text of DRAFT_REQUESTS) {
      expect(parseDraftRequest(text).draft, JSON.stringify(text)).toBe(true);
    }
  });

  test("the request survives into the argv — `gh pr create` carries `--draft`", async () => {
    const { buildPrCreateArgv, GH_DRAFT_FLAG } = await prDraft();
    const argv = buildPrCreateArgv({ draft: true });
    expect(argv.slice(0, 3)).toEqual(["gh", "pr", "create"]);
    expect(argv).toContain(GH_DRAFT_FLAG);
    expect(
      argv.filter((a) => a === GH_DRAFT_FLAG).length,
      "the draft flag is passed more than once",
    ).toBe(1);
  });

  test("END TO END: an explicit request opens a draft, argv and state together", async () => {
    const { planPullRequest, GH_DRAFT_FLAG } = await prDraft();
    for (const text of DRAFT_REQUESTS) {
      const plan = planPullRequest({
        text,
        mode: "none",
        host: SUPPORTED_HOST,
        url: "https://github.com/o/r/pull/1",
      });
      expect(plan.draft, JSON.stringify(text)).toBe(true);
      expect(plan.state, JSON.stringify(text)).toBe("draft");
      expect(plan.argv, JSON.stringify(text)).toContain(GH_DRAFT_FLAG);
    }
  });

  test("the flag is consumed as a flag, not swallowed as free text", async () => {
    // The shipped rule — free text after `/pr` is never a title — stays true,
    // and `--draft` must not be mistaken for that free text.
    const { parseDraftRequest } = await prDraft();
    expect(parseDraftRequest("--draft").residualText.trim()).toBe("");
    expect(parseDraftRequest("--draft please be quick").residualText).toContain(
      "please be quick",
    );
    expect(
      parseDraftRequest("--draft please be quick").residualText,
    ).not.toContain("--draft");
    expect(parseDraftRequest("make it snappy").residualText).toContain(
      "make it snappy",
    );
  });

  test("the raw invocation is carried through unmodified", async () => {
    const { parseDraftRequest } = await prDraft();
    for (const text of [...DRAFT_REQUESTS, ...NOT_DRAFT_REQUESTS]) {
      expect(parseDraftRequest(text).raw, JSON.stringify(text)).toBe(text);
    }
  });

  test("skills/pr/SKILL.md advertises the request in a VALID frontmatter block", async () => {
    // The prose half of AC.1. The block must still parse: an `argument-hint`
    // added as malformed YAML would take the whole skill out of the menu.
    const { DRAFT_REQUEST_FLAG } = await prDraft();
    const fm = parseFrontmatter(PR_SKILL());
    expect(fm.name).toBe("pr");
    expect(String(fm.description)).toContain("pull request");
    const hint = fm["argument-hint"];
    expect(hint, "skills/pr/SKILL.md has no argument-hint key").toBeDefined();
    expect(String(hint)).toContain(DRAFT_REQUEST_FLAG);
  });

  test("the argument-hint line follows the house quoting idiom", () => {
    // Every other skill writes it single- or double-quoted on one line; an
    // unquoted value containing `[` is not valid YAML flow scalar syntax.
    const m = PR_SKILL().match(/^argument-hint:\s*(['"])(.+?)\1\s*$/m);
    expect(m, "argument-hint is missing or not quoted on one line").not.toBeNull();
    expect(m![2]).toContain("--draft");
  });

  test("skills/pr/SKILL.md documents the flag on the gh invocation", async () => {
    const { GH_DRAFT_FLAG } = await prDraft();
    const body = PR_SKILL();
    expect(body).toContain(GH_DRAFT_FLAG);
    expect(body.toLowerCase()).toContain("draft");
  });
});

// ===========================================================================
// AC-STE-496.2 — the default remains non-draft.
//
// The backward-compatibility spine. Every leg here goes RED if the default
// path moves; none of them is a prose grep any file content would satisfy.
// ===========================================================================

describe("AC-STE-496.2 — the default invocation is unchanged and carries no --draft", () => {
  test("buildPrCreateArgv with NO draft option at all emits no --draft", async () => {
    // The true default: the option is not merely false, it is absent.
    const { buildPrCreateArgv } = await prDraft();
    expectNoDraftFlag(buildPrCreateArgv(), "buildPrCreateArgv()");
    expectNoDraftFlag(buildPrCreateArgv({}), "buildPrCreateArgv({})");
    expectNoDraftFlag(
      buildPrCreateArgv({ draft: false }),
      "buildPrCreateArgv({draft:false})",
    );
  });

  test("the default argv is still the shipped `gh pr create` shape", async () => {
    const { buildPrCreateArgv } = await prDraft();
    const argv = buildPrCreateArgv();
    expect(argv.slice(0, 3)).toEqual(["gh", "pr", "create"]);
  });

  test("NON-VACUITY: the SAME builder does emit --draft when asked", async () => {
    // Without this control, "no --draft by default" would be satisfied by a
    // builder that can never emit the flag at all.
    const { buildPrCreateArgv, GH_DRAFT_FLAG } = await prDraft();
    expect(flagsOf(buildPrCreateArgv({ draft: true }))).toContain(GH_DRAFT_FLAG);
    expect(flagsOf(buildPrCreateArgv({ draft: false }))).not.toContain(
      GH_DRAFT_FLAG,
    );
  });

  test("every non-draft invocation parses as non-draft", async () => {
    const { parseDraftRequest } = await prDraft();
    for (const text of NOT_DRAFT_REQUESTS) {
      expect(parseDraftRequest(text).draft, JSON.stringify(text)).toBe(false);
    }
  });

  test("an explicitly NEGATED draft request opens a normal pull request", async () => {
    // "don't open it as a draft" must not be pattern-matched into a draft.
    const { planPullRequest } = await prDraft();
    for (const text of ["not as a draft", "don't open it as a draft"]) {
      const plan = planPullRequest({
        text,
        mode: "none",
        host: SUPPORTED_HOST,
        url: "https://github.com/o/r/pull/2",
      });
      expect(plan.draft, JSON.stringify(text)).toBe(false);
      expectNoDraftFlag(plan.argv, JSON.stringify(text));
    }
  });

  test("EXHAUSTIVE: a default run carries no --draft in ANY tracker mode", async () => {
    const { planPullRequest } = await prDraft();
    for (const mode of TRACKER_MODES) {
      const plan = planPullRequest({
        text: "",
        mode,
        host: SUPPORTED_HOST,
        url: "https://github.com/o/r/pull/3",
        ticket: mode === "none" ? null : "STE-496",
      });
      expect(plan.draft, `mode ${mode}`).toBe(false);
      expect(plan.state, `mode ${mode}`).toBe("ready");
      expectNoDraftFlag(plan.argv, `mode ${mode}`);
    }
  });

  test("a default run on an UNSUPPORTED host is untouched — no refusal, no flag", async () => {
    // The non-regression that matters most: a repository that cannot hold
    // drafts must keep working exactly as it does today for everybody who
    // never asked for one.
    const { planPullRequest } = await prDraft();
    for (const [id, host] of Object.entries(UNSUPPORTED_HOSTS)) {
      const plan = planPullRequest({
        text: "",
        mode: "none",
        host,
        url: "https://github.com/o/r/pull/4",
      });
      expect(plan.draft, id).toBe(false);
      expectNoDraftFlag(plan.argv, id);
    }
  });

  test("the six shipped `## Steps` lines are present, verbatim, IN ORDER", async () => {
    const body = PR_SKILL();
    for (const line of SHIPPED_STEP_LINES) {
      expect(body, `shipped step line lost: ${line}`).toContain(line);
    }
    expect(
      containsInOrder(body, SHIPPED_STEP_LINES),
      "the shipped six-step flow was reordered or renumbered",
    ).toBe(true);
  });

  test("the shipped body-format fence and title rule are untouched", async () => {
    const body = PR_SKILL();
    expect(containsInOrder(body, ["## Summary", "## Test plan"])).toBe(true);
    for (const sentence of SHIPPED_PR_SENTENCES) {
      expect(body, `shipped guarantee lost: ${sentence}`).toContain(sentence);
    }
  });

  test("the shipped ship-state pre-flight and tracker probe sections survive", async () => {
    const body = PR_SKILL();
    expect(
      containsInOrder(body, [
        "## Tracker Mode Probe",
        "## Ship-State Pre-Flight (Soft)",
        "## Steps",
        "## Notes",
      ]),
      "the shipped section order of skills/pr/SKILL.md changed",
    ).toBe(true);
  });

  test("skills/pr/SKILL.md states the default in words as well", async () => {
    const body = PR_SKILL().toLowerCase();
    expect(
      /default[^.\n]{0,80}(not a draft|non-draft|ready for review)|(not a draft|non-draft)[^.\n]{0,60}default/.test(
        body,
      ),
      "skills/pr/SKILL.md never says the default is non-draft",
    ).toBe(true);
  });
});

// ===========================================================================
// AC-STE-496.3 — the draft choice appears in the closing report.
// ===========================================================================

describe("AC-STE-496.3 — the closing report names the state that was opened", () => {
  test("the two state labels exist and are distinct", async () => {
    const { DRAFT_STATE_LABELS } = await prDraft();
    expect(Object.keys(DRAFT_STATE_LABELS).sort()).toEqual(["draft", "ready"]);
    expect(DRAFT_STATE_LABELS.draft).not.toBe(DRAFT_STATE_LABELS.ready);
    expect(DRAFT_STATE_LABELS.draft.toLowerCase()).toContain("draft");
    expect(DRAFT_STATE_LABELS.ready.trim().length).toBeGreaterThan(0);
  });

  test("the draft report names the draft state AND keeps the URL", async () => {
    const { prClosingReport, DRAFT_STATE_LABELS } = await prDraft();
    const url = "https://github.com/o/r/pull/7";
    const report = prClosingReport({ url, draft: true });
    expect(report).toContain(url);
    expect(report).toContain(DRAFT_STATE_LABELS.draft);
  });

  test("the non-draft report names the ready state — legible without the host", async () => {
    // "so a reader can tell which state was opened without checking the host":
    // absence of the word `draft` is not a statement, so the default branch
    // has to name its state too.
    const { prClosingReport, DRAFT_STATE_LABELS } = await prDraft();
    const url = "https://github.com/o/r/pull/8";
    const report = prClosingReport({ url, draft: false });
    expect(report).toContain(url);
    expect(report).toContain(DRAFT_STATE_LABELS.ready);
  });

  test("the two reports are distinguishable and neither claims the other's state", async () => {
    const { prClosingReport, DRAFT_STATE_LABELS } = await prDraft();
    const url = "https://github.com/o/r/pull/9";
    const asDraft = prClosingReport({ url, draft: true });
    const asReady = prClosingReport({ url, draft: false });
    expect(asDraft).not.toBe(asReady);
    expect(asDraft, "the draft report also claims the ready state").not.toContain(
      DRAFT_STATE_LABELS.ready,
    );
    expect(asReady, "the ready report also claims the draft state").not.toContain(
      DRAFT_STATE_LABELS.draft,
    );
  });

  test("the plan's own report agrees with the plan's own state, in every mode", async () => {
    // A report rendered from a stale variable is the failure this catches.
    const { planPullRequest, DRAFT_STATE_LABELS } = await prDraft();
    for (const mode of TRACKER_MODES) {
      for (const [text, draft] of [
        ["--draft", true],
        ["", false],
      ] as const) {
        const url = `https://github.com/o/r/pull/1${mode.length}`;
        const plan = planPullRequest({
          text,
          mode,
          host: SUPPORTED_HOST,
          url,
          ticket: mode === "none" ? null : "STE-496",
        });
        expect(plan.draft, `${mode} ${text}`).toBe(draft);
        expect(plan.report, `${mode} ${text}`).toContain(url);
        expect(plan.report, `${mode} ${text}`).toContain(
          DRAFT_STATE_LABELS[draft ? "draft" : "ready"],
        );
      }
    }
  });

  test("skills/pr/SKILL.md says the report names the state", async () => {
    const { DRAFT_STATE_LABELS } = await prDraft();
    const body = PR_SKILL();
    expect(body).toContain(DRAFT_STATE_LABELS.draft);
    expect(body).toContain(DRAFT_STATE_LABELS.ready);
    // Paired with Step 6, which is what the report line rides on.
    expect(body).toContain("6. Report the PR URL to the user");
  });
});

// ===========================================================================
// AC-STE-496.4 — draft works on the TRACKER-MODE path too.
// ===========================================================================

describe("AC-STE-496.4 — the tracker-mode path opens drafts identically", () => {
  test("a draft request in tracker mode produces the draft flag", async () => {
    const { planPullRequest, GH_DRAFT_FLAG } = await prDraft();
    for (const mode of TRACKER_MODES.filter((m) => m !== "none")) {
      const plan = planPullRequest({
        text: "--draft",
        mode,
        host: SUPPORTED_HOST,
        url: "https://github.com/o/r/pull/11",
        ticket: "STE-496",
      });
      expect(plan.draft, `mode ${mode}`).toBe(true);
      expect(plan.argv, `mode ${mode}`).toContain(GH_DRAFT_FLAG);
    }
  });

  test("SAMENESS: the argv is identical across every tracker mode", async () => {
    // One builder, not a tracker-mode fork that drifts. If the tracker path
    // ever grew its own PR-opening invocation, this goes red.
    const { planPullRequest } = await prDraft();
    for (const draftText of ["--draft", ""]) {
      const argvs = TRACKER_MODES.map((mode) =>
        planPullRequest({
          text: draftText,
          mode,
          host: SUPPORTED_HOST,
          url: "https://github.com/o/r/pull/12",
          ticket: mode === "none" ? null : "STE-496",
        }).argv.join(" "),
      );
      expect(new Set(argvs).size, `argv diverged across modes for "${draftText}"`).toBe(
        1,
      );
    }
  });

  test("the tracker post-create calls are UNCHANGED by the draft choice", async () => {
    // Draft support must neither skip the tracker work nor add MCP calls.
    const { planPullRequest } = await prDraft();
    for (const mode of TRACKER_MODES.filter((m) => m !== "none")) {
      const base = planPullRequest({
        text: "",
        mode,
        host: SUPPORTED_HOST,
        url: "https://github.com/o/r/pull/13",
        ticket: "STE-496",
      });
      const drafted = planPullRequest({
        text: "--draft",
        mode,
        host: SUPPORTED_HOST,
        url: "https://github.com/o/r/pull/13",
        ticket: "STE-496",
      });
      expect(drafted.mcpCalls, `mode ${mode}`).toEqual(base.mcpCalls);
      expect(base.mcpCalls.length, `mode ${mode}: NFR-8 budget`).toBeLessThanOrEqual(
        2,
      );
      expect(base.mcpCalls, `mode ${mode}: status transition lost`).toContain(
        "transition_status",
      );
    }
  });

  test("ISOLATION: `mode: none` makes no MCP calls — the modes are really different", async () => {
    // Without this, "the calls are unchanged by draft" would be satisfied by
    // a plan that never makes any call in any mode.
    const { planPullRequest } = await prDraft();
    const plan = planPullRequest({
      text: "--draft",
      mode: "none",
      host: SUPPORTED_HOST,
      url: "https://github.com/o/r/pull/14",
    });
    expect(plan.mcpCalls).toEqual([]);
  });

  test("the tracker-mode refusal on an unsupported host is the same refusal", async () => {
    const { planPullRequest } = await prDraft();
    for (const mode of TRACKER_MODES.filter((m) => m !== "none")) {
      for (const [id, host] of Object.entries(UNSUPPORTED_HOSTS)) {
        expectNfr10Refusal(
          () =>
            planPullRequest({
              text: "--draft",
              mode,
              host,
              url: "https://github.com/o/r/pull/15",
              ticket: "STE-496",
            }),
          `${mode} / ${id}`,
        );
      }
    }
  });

  test("docs/pr-tracker-mode.md documents draft on the tracker path", async () => {
    const { GH_DRAFT_FLAG } = await prDraft();
    const doc = PR_TRACKER_DOC();
    expect(doc.toLowerCase(), "the tracker-mode reference never mentions draft").toContain(
      "draft",
    );
    expect(doc).toContain(GH_DRAFT_FLAG);
  });

  test("docs/pr-tracker-mode.md keeps its shipped post-create contract", async () => {
    // The AC.2 spirit applied to the tracker document: the draft prose is
    // additive, the existing flow is not rewritten.
    const doc = PR_TRACKER_DOC();
    expect(
      containsInOrder(doc, [
        "## Pre-flight (before PR creation)",
        "## Post-create (after `gh pr create` returns)",
        'transition_status(ticket_id, "in_review")',
        "## Capability degradation",
        "## MCP call budget (NFR-8)",
      ]),
      "the shipped structure of docs/pr-tracker-mode.md changed",
    ).toBe(true);
    expect(doc).toContain("`/pr` makes at most **2** MCP calls total");
  });
});

// ===========================================================================
// AC-STE-496.5 — an unsupported host is SAID, never silently downgraded.
//
// The load-bearing AC, mutation-verified. A silent skip is worse than a loud
// failure: a non-draft PR opened in a never-merge run is exactly the
// misrepresentation this FR exists to prevent.
// ===========================================================================

describe("AC-STE-496.5 — an unsupported draft is refused, not downgraded", () => {
  test("PRIMARY: planPullRequest THROWS rather than returning a non-draft plan", async () => {
    // This is the anti-silent-downgrade leg. A surface that merely opens a
    // normal PR here returns a plan and fails right at `expect(raised)`.
    const { planPullRequest } = await prDraft();
    for (const [id, host] of Object.entries(UNSUPPORTED_HOSTS)) {
      let plan: PrPlan | null = null;
      let raised: unknown = null;
      try {
        plan = planPullRequest({
          text: "--draft",
          mode: "none",
          host,
          url: "https://github.com/o/r/pull/16",
        });
      } catch (e) {
        raised = e;
      }
      expect(
        plan,
        `${id}: an unsupported draft was SILENTLY DOWNGRADED to a normal PR`,
      ).toBeNull();
      expect(raised, `${id}: nothing was said`).not.toBeNull();
    }
  });

  test("the refusal carries the NFR-10 canonical shape and names the host", async () => {
    const { planPullRequest } = await prDraft();
    for (const [id, host] of Object.entries(UNSUPPORTED_HOSTS)) {
      const msg = expectNfr10Refusal(
        () =>
          planPullRequest({
            text: "--draft",
            mode: "none",
            host,
            url: "https://github.com/o/r/pull/17",
          }),
        id,
      );
      expect(msg, `${id}: the refusal never names the host`).toContain(host.host);
      expect(msg.toLowerCase(), `${id}: the refusal never says draft`).toContain(
        "draft",
      );
    }
  });

  test("the refusal is a NAMED error, not a bare Error", async () => {
    const { assertDraftSupported } = await prDraft();
    let raised: unknown = null;
    try {
      assertDraftSupported(UNSUPPORTED_HOSTS.host_cannot_hold_drafts!);
    } catch (e) {
      raised = e;
    }
    expect(raised).not.toBeNull();
    expect((raised as Error).name).toMatch(/Draft/);
    expect((raised as Error).message).toMatch(/Context:.*host=/);
  });

  test("NON-VACUITY: the same shape assertion fails on a bare Error", () => {
    const bare = new Error("nope");
    expect(bare.message).not.toContain("Refusing:");
  });

  test("ISOLATION: the SUPPORTED host genuinely opens a draft", async () => {
    // Without this, "unsupported hosts are refused" would be satisfied by a
    // module that refuses every draft request it ever sees.
    const { planPullRequest, assertDraftSupported, isDraftSupported, GH_DRAFT_FLAG } =
      await prDraft();
    expect(isDraftSupported(SUPPORTED_HOST)).toBe(true);
    expect(() => assertDraftSupported(SUPPORTED_HOST)).not.toThrow();
    const plan = planPullRequest({
      text: "--draft",
      mode: "none",
      host: SUPPORTED_HOST,
      url: "https://github.com/o/r/pull/18",
    });
    expect(plan.draft).toBe(true);
    expect(plan.argv).toContain(GH_DRAFT_FLAG);
  });

  test("isDraftSupported is false for every unsupported host and true for the supported one", async () => {
    const { isDraftSupported } = await prDraft();
    for (const [id, host] of Object.entries(UNSUPPORTED_HOSTS)) {
      expect(isDraftSupported(host), id).toBe(false);
    }
    expect(isDraftSupported(SUPPORTED_HOST)).toBe(true);
  });

  test("skills/pr/SKILL.md states the refusal rather than a fallback", async () => {
    const body = PR_SKILL();
    const lower = body.toLowerCase();
    expect(lower).toContain("refusing:");
    expect(
      /cannot open a draft|can't open a draft|does not support draft|doesn't support draft|draft is not supported|draft pull requests? (are|is) not supported/.test(
        lower,
      ),
      "skills/pr/SKILL.md never names the unsupported-draft case",
    ).toBe(true);
    expect(
      /silently|silent|without saying/.test(lower),
      "skills/pr/SKILL.md never rules out the silent downgrade",
    ).toBe(true);
  });
});

describe("AC-STE-496.5 — the support guard set, and DROP-ONE mutation over it", () => {
  test("DRAFT_SUPPORT_GUARDS carries exactly the guards this file tests", async () => {
    const { DRAFT_SUPPORT_GUARDS } = await prDraft();
    expect(DRAFT_SUPPORT_GUARDS.map((g) => g.id).sort()).toEqual(
      [...EXPECTED_GUARD_IDS].sort(),
    );
    expect(Object.keys(UNSUPPORTED_HOSTS).sort()).toEqual(
      [...EXPECTED_GUARD_IDS].sort(),
    );
  });

  test("every guard names a real reason", async () => {
    const { DRAFT_SUPPORT_GUARDS } = await prDraft();
    for (const g of DRAFT_SUPPORT_GUARDS) {
      expect(g.reason.trim().length, `guard ${g.id}`).toBeGreaterThan(10);
    }
    expect(new Set(DRAFT_SUPPORT_GUARDS.map((g) => g.reason)).size).toBe(
      DRAFT_SUPPORT_GUARDS.length,
    );
  });

  test("each guard matches its OWN host and no other — isolation", async () => {
    // If two guards caught the same host, dropping either would leave the
    // other standing and the mutation below would prove nothing.
    const { DRAFT_SUPPORT_GUARDS } = await prDraft();
    for (const g of DRAFT_SUPPORT_GUARDS) {
      const host = UNSUPPORTED_HOSTS[g.id];
      expect(host, `no fixture host for guard ${g.id}`).toBeDefined();
      const hits = DRAFT_SUPPORT_GUARDS.filter((x) => x.matches(host!)).map(
        (x) => x.id,
      );
      expect(hits, `${g.id}: its host is not isolated`).toEqual([g.id]);
    }
  });

  test("no guard matches the fully supported host", async () => {
    const { DRAFT_SUPPORT_GUARDS } = await prDraft();
    expect(
      DRAFT_SUPPORT_GUARDS.filter((g) => g.matches(SUPPORTED_HOST)).map((g) => g.id),
    ).toEqual([]);
  });

  test("dropping a guard flips ITS host from refused to accepted", async () => {
    const { DRAFT_SUPPORT_GUARDS, isDraftSupported, assertDraftSupported } =
      await prDraft();
    for (const g of DRAFT_SUPPORT_GUARDS) {
      const others = DRAFT_SUPPORT_GUARDS.filter((x) => x.id !== g.id);
      // MUTATION APPLIED? A drop that silently never applied reads as a pass.
      expect(others.length, `${g.id}: drop did not apply`).toBe(
        DRAFT_SUPPORT_GUARDS.length - 1,
      );
      const host = UNSUPPORTED_HOSTS[g.id]!;
      expect(isDraftSupported(host), `${g.id}: not refused with the full set`).toBe(
        false,
      );
      expectNfr10Refusal(() => assertDraftSupported(host), `${g.id} full set`);
      expect(
        isDraftSupported(host, { guards: others }),
        `${g.id} is not load-bearing — dropping it changed nothing`,
      ).toBe(true);
      expect(
        () => assertDraftSupported(host, { guards: others }),
        `${g.id} is inert at the throwing entry point`,
      ).not.toThrow();
    }
  });

  test("dropping a guard leaves its SIBLINGS still refusing", async () => {
    // The complement: a "fix" in which one drop disables the whole check
    // would pass the leg above while destroying every other guard.
    const { DRAFT_SUPPORT_GUARDS, isDraftSupported } = await prDraft();
    for (const g of DRAFT_SUPPORT_GUARDS) {
      const others = DRAFT_SUPPORT_GUARDS.filter((x) => x.id !== g.id);
      for (const sibling of others) {
        expect(
          isDraftSupported(UNSUPPORTED_HOSTS[sibling.id]!, { guards: others }),
          `${g.id} dropped: sibling ${sibling.id} stopped refusing`,
        ).toBe(false);
      }
    }
  });

  test("with EVERY guard dropped, no unsupported host is refused", async () => {
    // Proves the guards — not an unrelated fail-closed default — are what
    // refuse. If this passed with an empty guard list, the guards would be
    // decorative and the drop-one mutation meaningless.
    const { assertDraftSupported } = await prDraft();
    for (const [id, host] of Object.entries(UNSUPPORTED_HOSTS)) {
      expect(
        () => assertDraftSupported(host, { guards: [] }),
        `${id} still refused with no guards — the guards are decorative`,
      ).not.toThrow();
    }
  });

  test("planPullRequest honours the guard override end to end", async () => {
    // The mutation reaches the public entry point, not only the predicate.
    const { DRAFT_SUPPORT_GUARDS, planPullRequest, GH_DRAFT_FLAG } = await prDraft();
    for (const g of DRAFT_SUPPORT_GUARDS) {
      const others = DRAFT_SUPPORT_GUARDS.filter((x) => x.id !== g.id);
      const host = UNSUPPORTED_HOSTS[g.id]!;
      const plan = planPullRequest(
        { text: "--draft", mode: "none", host, url: "https://github.com/o/r/pull/19" },
        { guards: others },
      );
      expect(plan.draft, `${g.id} dropped`).toBe(true);
      expect(plan.argv, `${g.id} dropped`).toContain(GH_DRAFT_FLAG);
    }
  });
});

// ---------------------------------------------------------------------------
// AC-STE-496.5 — the SKILL's documented refusal AGREES with what the module
// actually emits.
//
// Found by the STE-496 audit: the refusal text had two sources of truth — the
// module's rendered string and the SKILL's illustration — with nothing binding
// them, and they had already diverged on the Remedy sentence. That is the
// producer/consumer asymmetry class this very milestone exists to repair
// (STE-492), reintroduced inside it. The module is the producer and the single
// source; these legs pin the SKILL to it.
//
// Deliberately structural rather than byte-identical: the SKILL illustrates
// with `<host>` / `<ids>` placeholders where the module interpolates values.
// What must agree is the invariant part — the three line prefixes and the
// Context field set.
// ---------------------------------------------------------------------------

describe("AC-STE-496.5 — SKILL refusal prose and module refusal text agree", () => {
  const emitted = async (): Promise<string> => {
    const mod = await import("../adapters/_shared/src/pr_draft");
    try {
      mod.assertDraftSupported({ host: "bitbucket-server", supportsDraft: false });
      throw new Error("assertDraftSupported did not refuse an unsupported host");
    } catch (e) {
      const msg = (e as Error).message;
      if (!msg.startsWith("Refusing:")) throw e;
      return msg;
    }
  };

  test("every invariant fragment of the emitted refusal appears in the SKILL", async () => {
    const msg = await emitted();
    const skill = PR_SKILL();
    // The three canonical line heads, taken from the EMITTED text, not retyped.
    const heads = msg
      .split("\n")
      .map((l) => l.split("—")[0]!.split("<")[0]!.trimEnd())
      .filter((l) => /^(Refusing|Remedy|Context):/.test(l));
    expect(heads.length, "emitted refusal is not three canonical lines").toBe(3);
    // Normalize BOTH sides identically — the module interpolates values where
    // the SKILL illustrates with <placeholder>s, so stripping only one side
    // compares two different spellings of the same fact.
    const norm = (t: string): string =>
      t.replace(/host=\S*/g, "host=").replace(/guards=\S*/g, "guards=");
    const skillNorm = norm(skill);
    for (const head of heads) {
      const stable = norm(head);
      expect({ head: stable, inSkill: skillNorm.includes(stable) }).toEqual({
        head: stable,
        inSkill: true,
      });
    }
  });

  test("the Context field SET matches — host and guards, and no PR url", async () => {
    const msg = await emitted();
    const ctx = msg.split("\n").find((l) => l.startsWith("Context:"))!;
    expect(ctx).toContain("host=");
    expect(ctx).toContain("guards=");
    // The refusal lands BEFORE creation, so there is no URL to name. A url=
    // field here would be naming something that cannot exist yet.
    expect(ctx).not.toContain("url=");
    expect(PR_SKILL()).not.toContain("Context: host=<host>, url=<url>");
  });

  // NON-VACUITY — the agreement check must be able to fail. A fragment the
  // module does not emit must not be found "in agreement".
  test("NON-VACUITY: a fragment the module never emits is not in the SKILL's shape", async () => {
    const msg = await emitted();
    expect(msg).not.toContain("Remedy: give up");
    expect(PR_SKILL()).not.toContain("Remedy: give up");
  });

  test("the SKILL names the module as the single source of the wording", () => {
    expect(PR_SKILL()).toContain("pr_draft.ts");
    expect(PR_SKILL()).toContain("assertDraftSupported");
  });
});

// ---------------------------------------------------------------------------
// AC-STE-496.1/.5 — the prose negation window is CLAUSE-scoped.
//
// Audit finding: negation was tested across the whole residual text, so
// "open it as a draft, no rush" parsed draft:false and opened a normal pull
// request with nothing said — the silent-downgrade class AC.5 exists to
// prevent, reached through the prose path rather than the host path.
// ---------------------------------------------------------------------------

describe("AC-STE-496.1 — a negation in a LATER clause does not cancel the request", () => {
  const parse = async (t: string) => {
    const { parseDraftRequest } = await import("../adapters/_shared/src/pr_draft");
    return parseDraftRequest(t);
  };

  // POSITIVE — the draft is genuinely asked for; an unrelated later negation
  // must not silently downgrade it.
  for (const text of [
    "open it as a draft, no rush",
    "open it as a draft and do not ping anyone",
    "make it a draft pr, not urgent",
    "open as a draft. no reviewers yet",
  ]) {
    test(`still a draft request: ${JSON.stringify(text)}`, async () => {
      expect({ text, draft: (await parse(text)).draft }).toEqual({ text, draft: true });
    });
  }

  // NEGATIVE (isolation) — a negation in the SAME clause, before the phrase,
  // must still cancel it. Without this leg the fix would read as
  // "negation never cancels", which inverts the user the other way.
  for (const text of [
    "don't open it as a draft",
    "do not open it as a draft",
    "open it without a draft pull request",
    "never open it as a draft",
  ]) {
    test(`still NOT a draft request: ${JSON.stringify(text)}`, async () => {
      expect({ text, draft: (await parse(text)).draft }).toEqual({ text, draft: false });
    });
  }

  // The explicit flag is unconditional — prose cannot cancel it. Also pins the
  // punctuation fix: "--draft," and "--draft." previously matched NOTHING, so
  // the flag was neither detected nor stripped and the run silently opened a
  // normal pull request.
  test("the --draft FLAG survives adjacent punctuation and later prose", async () => {
    for (const text of [
      "--draft",
      "--draft, no rush",
      "--draft but do not ping anyone",
      "please --draft.",
      "open --draft now",
    ]) {
      expect({ text, draft: (await parse(text)).draft }).toEqual({ text, draft: true });
    }
  });

  // ISOLATION — the punctuation widening must not swallow near-miss flags.
  test("near-miss flags are still NOT a draft request", async () => {
    for (const text of ["--no-draft", "--draft-mode", "--drafting"]) {
      expect({ text, draft: (await parse(text)).draft }).toEqual({ text, draft: false });
    }
  });
});
