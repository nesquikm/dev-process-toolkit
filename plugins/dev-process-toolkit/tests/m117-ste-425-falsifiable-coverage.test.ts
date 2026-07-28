// M117 STE-425 — "Make smoke fixtures falsifiable and account for unreached
// coverage".
//
// ===========================================================================
// WHAT IS BROKEN (three coverage-integrity gaps, one theme)
// ===========================================================================
//
// (1) FIXTURE 8b CANNOT FAIL. `.claude/skills/smoke-test/SKILL.md` § "Fixture
//     group 8" stages the test project's `.claude/settings.json` with
//     `Bash(claude:*)` REMOVED and asserts the resulting nested-spawn denial is
//     CAUGHT by `checkChildSpawnCapture`. On 2026-07-27 the pattern was
//     verified absent and the nested spawn still returned its token with
//     `permission_denials: []` — on BOTH legs, for the third run running. Root
//     cause: `~/.claude-st/settings.json` carries `permissions.defaultMode:
//     auto`, so the harness CLASSIFIER governs the spawn, not the tracked
//     allow-list, and `permission_denials[]` is never populated. The fixture
//     therefore passes identically whether its detector works or not.
//
// (2) AN UNREACHED GROUP RENDERS AS SILENCE. Fixture group 2 never ran on the
//     2026-07-27 Linear leg (wall-clock, not a blocker). Group footers 1, 2 and
//     3 state ONLY a PASS branch — they literally cannot render anything else —
//     so a group that did not execute is absorbed into the aggregate instead of
//     being named. And group 2 is Linear-ONLY by design, so on the Jira leg its
//     absence is legitimate: a fix that cannot tell `not-reached` from
//     `n/a-by-design` recreates the same ambiguity in a new place.
//
// (3) THE RUN DIRTIES THE TOOLKIT TREE. Phase 8 writes seven raw transcript
//     captures (106–448 KB each, 1.7 MB total) under
//     `plugins/dev-process-toolkit/tests/fixtures/socratic-first-turn/`, and
//     pre-flight #4 refuses on a dirty toolkit tree — so the NEXT run refuses
//     until somebody deals with them by hand, and the operator learns about it
//     at the start of the next run rather than at the end of this one.
//
// ===========================================================================
// THE IMPLEMENTATION DECISIONS THESE TESTS ARE WRITTEN AGAINST
// ===========================================================================
//
// AC.1 — RETIRE the live 8b negative fixture (keep 8a). A live negative cannot
//   be made falsifiable here without writing the operator's GLOBAL settings,
//   which the harness self-modification classifier reliably denies under
//   `claude -p` (the SKILL documents that denial at § Threat model). The
//   regression value moves to a DETERMINISTIC mutation check in bun, below:
//   feed `checkChildSpawnCapture` a synthesized capture carrying a
//   `claude`-headed `permission_denials[]` entry and assert it emits the
//   finding; then disable the head predicate and assert the same assertion
//   FAILS. That check can actually fail; the live fixture could not. The
//   retirement also obliges a decision about pre-flight #10
//   (`spawn_pattern_allow_check`), which refuses whole runs over a pattern that
//   is not the operative gate in this environment — kept-and-re-justified or
//   dropped, but not left silently as-is, and never incoherent with
//   `/conformance-loop`'s mirrored refusal (f).
//
// AC.2 — a machine-readable per-group execution record plus a renderer, so the
//   aggregate cannot infer a pass from silence. House precedent is
//   `adapters/_shared/src/smoke_verdict.ts` (per-LEG outcomes + an
//   `import.meta.main` CLI); this is its per-fixture-GROUP sibling at
//   `adapters/_shared/src/smoke_fixture_groups.ts`. FOUR outcomes, not three:
//   the FR's `passed` / `failed` / `not-reached`, plus `not-applicable` for a
//   group whose leg roster excludes this leg (group 2 on Jira).
//
// AC.3 — the disposal rule is GIT-IGNORE the raw per-run Phase 8 captures,
//   keeping the trimmed `regression/` derivations committed. This matches the
//   "deliberately NOT committed" policy already stated in
//   `m116-ste-422-assert-runner-projectroot.test.ts` and the ≤ 32 KB
//   derived-fixture rule there. It changes NOTHING about clean-checkout
//   behaviour (the captures were never committed) — it only makes the
//   operator's tree clean so pre-flight #4 passes. Git-ignoring is NOT
//   deleting: the local captures survive, so m116's `skipIf(!existsSync(...))`
//   verdict-equivalence checks keep running here exactly as they do today.
//
// AC.4 — a closing check that enumerates the run's OWN artifacts. Because
//   ignored files do not appear in plain `git status --porcelain`, the check
//   must use `--ignored` or name the run's tracker-scoped paths; porcelain
//   alone would be vacuous BY CONSTRUCTION once AC.3 lands. Proven below
//   against a real synthesized repository, not asserted in prose.
//
// ===========================================================================
// TEST DESIGN — the traps this file is built to avoid
// ===========================================================================
//
//  * PROJECT-LOCAL SURFACE. The driver SKILL lives at `repoRoot/.claude/skills/`,
//    OUTSIDE `plugins/dev-process-toolkit`, so it is read through
//    `join(import.meta.dir, "..", "..", "..")` + `readIfPresent` +
//    `describe.skip` — a pluginRoot-scoped sweep cannot see it and would pass
//    vacuously in a consumer checkout. Same for the repo `.gitignore` and for
//    every `git` invocation (skipped when this is not a work tree).
//  * PARAGRAPH SCOPING. Every prose claim is asserted against one fixture-group
//    slice, one pre-flight slice, or one blank-line-delimited paragraph — never
//    the whole 1379-line file, which a match forty lines away would satisfy.
//    Every negative assertion asserts its slice is non-empty FIRST.
//  * THE AC.2 MODULE IS IMPORTED DYNAMICALLY, through a non-literal specifier,
//    so its absence REDs only the AC.2 tests instead of taking the file down —
//    the AC.1/.3/.4 evidence stays readable while AC.2 is unimplemented.
//  * NO TAUTOLOGIES. The group roster is cross-checked against the SKILL's own
//    headings and footers rather than hard-coded twice. The disposal rule is
//    exercised by replaying the SHIPPED `.gitignore` in a synthesized git repo.
//    The closing check's non-vacuity is proven by demonstrating, in that same
//    repo, that plain porcelain cannot see an ignored file.
//  * CURRENTLY-GREEN PINS A CARELESS EDIT REDS (§ "hazard pins" at the bottom
//    re-asserts each one so a break is attributed HERE, not in a file this FR
//    does not own):
//      - `smoke-test-ste352-stream-capture.test.ts` pins the literals
//        `STE-350 runtime check: PASS` and `… FAIL`; a three-outcome rewrite
//        must keep BOTH substrings.
//      - `bundled-hooks-shape.test.ts` asserts ZERO occurrences of the
//        LOWERCASE literal `fixture group 8`; retirement prose written in
//        lowercase reds an unrelated test.
//      - `claude-spawn-allowlist.test.ts` requires EXACTLY ONE
//        `cat > .claude/settings.json <<'EOF'` heredoc and floors the file at
//        ≥ 8 authored `claude -p` spawn lines — a re-founded negative fixture
//        cannot be authored as a second heredoc at all.
//      - `m116-ste-423-tracker-scoped-artifacts.test.ts` requires EVERY
//        `tests/fixtures/socratic-first-turn/<name>` literal in the SKILL to
//        carry a tracker token, so the disposal rule must be written in the
//        tracker-scoped form — never as a bare `*.json` glob.
//      - `m112-ste-414-nontty-hard-gate.test.ts` reads the
//        `**Final-message self-check**` clause with an `instructionOffset` that
//        returns -1 when TWO OR MORE sentences match an anchor role. AC.4's
//        closing check must therefore live ELSEWHERE, and § "hazard pins"
//        asserts that clause is unperturbed.

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { checkChildSpawnCapture } from "../adapters/_shared/src/smoke_child_capture";
import { parseStreamJsonEvents } from "../adapters/_shared/src/stream_json_events";

// ──────────────────────────── surfaces ────────────────────────────────────

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");

const SMOKE_SKILL_PATH = join(
  REPO_ROOT,
  ".claude",
  "skills",
  "smoke-test",
  "SKILL.md",
);
const CONFORMANCE_SKILL_PATH = join(
  REPO_ROOT,
  ".claude",
  "skills",
  "conformance-loop",
  "SKILL.md",
);
const GITIGNORE_PATH = join(REPO_ROOT, ".gitignore");

/** Repo-relative fixture directory — the path the disposal rule is about. */
const FIXTURE_DIR_REL =
  "plugins/dev-process-toolkit/tests/fixtures/socratic-first-turn";
const FIXTURE_DIR_ABS = join(PLUGIN_ROOT, "tests", "fixtures", "socratic-first-turn");

function readIfPresent(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

const SKILL = readIfPresent(SMOKE_SKILL_PATH);
const CONFORMANCE = readIfPresent(CONFORMANCE_SKILL_PATH);
const GITIGNORE = readIfPresent(GITIGNORE_PATH);

const D = SKILL === null ? describe.skip : describe;
const DG = GITIGNORE === null ? describe.skip : describe;

// ──────────────────────────── markdown helpers ────────────────────────────

function sectionSlice(body: string, startMarker: string, endMarker: string): string {
  const start = body.indexOf(startMarker);
  if (start === -1) return "";
  const end = body.indexOf(endMarker, start);
  return end === -1 ? body.slice(start) : body.slice(start, end);
}

/** Drop fenced blocks (keeping paragraph boundaries) — prose-only claims. */
function proseOnly(section: string): string {
  return section.replace(/```[a-z]*\n[\s\S]*?```/g, "\n\n");
}

function paragraphs(body: string): string[] {
  return proseOnly(body)
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** Paragraph proximity: SOME paragraph satisfies ALL patterns. */
function someParagraphMatches(body: string, patterns: RegExp[]): boolean {
  return paragraphs(body).some((p) => patterns.every((re) => re.test(p)));
}

/** Every ```bash fence body inside a slice. */
function bashFences(section: string): string[] {
  const out: string[] = [];
  const re = /```bash\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(section)) !== null) out.push(m[1]!);
  return out;
}

/**
 * A bold-lead clause and everything under it up to the next bold-lead clause
 * or heading. Re-implemented from `m112-ste-414-nontty-hard-gate.test.ts` so
 * the "unperturbed" pins below read the SAME slice that file reads.
 */
function boldClause(body: string, leadIn: string): string {
  const lines = body.split("\n");
  const start = lines.findIndex((line) => line.startsWith(leadIn));
  if (start === -1) return "";
  let inFence = false;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i]!.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (/^#{2,6} /.test(lines[i]!)) return lines.slice(start, i).join("\n");
    if (/^\*\*[^*\n]+\*\*/.test(lines[i]!) && !lines[i]!.startsWith(leadIn)) {
      return lines.slice(start, i).join("\n");
    }
  }
  return lines.slice(start).join("\n");
}

function flatProse(clause: string): string {
  return proseOnly(clause).replace(/\n+/g, " ");
}

function proseSentences(clause: string): string[] {
  return flatProse(clause).split(/(?<=[.!?])\s+/);
}

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** -1 when NO sentence carries the instruction, or when SEVERAL do. */
function instructionOffset(
  clause: string,
  carries: (sentence: string) => boolean,
): number {
  const hits = proseSentences(clause).filter(carries);
  if (hits.length !== 1) return -1;
  return flatProse(clause).indexOf(hits[0]!);
}

// ──────────────────────────── SKILL region accessors ──────────────────────

/** One slice per `#### Fixture group <N> — …` block, keyed by group number. */
function fixtureGroupSlices(body: string): Map<number, string> {
  const out = new Map<number, string>();
  const re = /#### Fixture group (\d+) — [\s\S]*?(?=\n#### |\n### |$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) out.set(Number(m[1]), m[0]);
  return out;
}

function group8(): string {
  return fixtureGroupSlices(SKILL!).get(8) ?? "";
}

function phase2xSummarySection(): string {
  return sectionSlice(SKILL!, "#### Phase 2.X summary line", "#### Fixture group 4");
}

function phase8Section(): string {
  return sectionSlice(SKILL!, "### Phase 8 — Socratic Loop Entry", "### Phase 9");
}

/** Pre-flight #10 — the `spawn_pattern_allow_check` refusal block. */
function preflight10(): string {
  return sectionSlice(SKILL!, "10. **Child-spawn pattern present", "## Flow");
}

function selfCheckClause(): string {
  return boldClause(SKILL!, "**Final-message self-check");
}

/** The whole SKILL minus the m112-owned self-check clause. */
function skillOutsideSelfCheck(): string {
  const clause = selfCheckClause();
  return clause === "" ? SKILL! : SKILL!.replace(clause, "\n\n");
}

/**
 * The AC.4 closing check: from the first line that talks about UNTRACKED
 * ARTIFACTS (not the unrelated `git clean … removes untracked files` bullet in
 * the STE-195 rollback fence) through the end of that markdown block.
 */
function closingCheckSlice(): string {
  const body = skillOutsideSelfCheck();
  const lines = body.split("\n");
  const anchor = lines.findIndex(
    (line) =>
      /untracked/i.test(line) && /artifact|fixture|capture|transcript/i.test(line),
  );
  if (anchor === -1) return "";
  let end = lines.length;
  for (let i = anchor + 1; i < lines.length; i++) {
    if (/^#{2,4} /.test(lines[i]!)) {
      end = i;
      break;
    }
  }
  return lines.slice(anchor, Math.min(end, anchor + 80)).join("\n");
}

// ──────────────────────────── git helpers ─────────────────────────────────

interface GitResult {
  status: number;
  stdout: string;
}

function git(args: string[], cwd: string): GitResult {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { status: r.status ?? 1, stdout: r.stdout ?? "" };
}

const REPO_IS_WORKTREE =
  git(["rev-parse", "--is-inside-work-tree"], REPO_ROOT).stdout.trim() === "true";

/** `git check-ignore --no-index` — index-independent, so tracking is irrelevant. */
function isIgnored(repoRelPath: string): boolean {
  return (
    git(["check-ignore", "--no-index", "-q", "--", repoRelPath], REPO_ROOT).status === 0
  );
}

function withTempRepo(fn: (repo: string) => void): void {
  const repo = mkdtempSync(join(tmpdir(), "ste425-"));
  try {
    git(["init", "-q"], repo);
    git(["config", "user.email", "ste425@example.invalid"], repo);
    git(["config", "user.name", "STE-425"], repo);
    fn(repo);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

function writeFileDeep(root: string, relPath: string, body: string): void {
  const abs = join(root, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body, "utf8");
}

// ═══════════════════════════════════════════════════════════════════════════
// AC-STE-425.1 — fixture 8b is retired, and the coverage it claimed is
//                re-homed as a check that can actually fail
// ═══════════════════════════════════════════════════════════════════════════

// The mutation check the AC asks for, stated as executable code rather than as
// a live fixture. The DETECTOR is the real exported one; the MUTANT is a local
// re-implementation with the head predicate disabled — exactly the failure mode
// (`checkChildSpawnCapture` staying silent while a denial is present) that the
// live 8b claimed to fence and demonstrably could not.

const CLAUDE_SPAWN_HEAD_RE = /^claude(\s|$)/;

function deniedCapture(command: string): string {
  return [
    JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "spawning the grandchild" }] },
    }),
    JSON.stringify({
      type: "result",
      subtype: "success",
      permission_denials: [
        { tool_name: "Bash", tool_input: { command } },
      ],
    }),
  ].join("\n");
}

/** The detector with its head predicate DISABLED — the mutant under test. */
function checkChildSpawnCaptureMutant(ndjson: string, child: string): unknown[] {
  if (ndjson.trim().length === 0) {
    return [{ severity: "high", diagnostic: `empty — ${child}` }];
  }
  for (const event of parseStreamJsonEvents(ndjson)) {
    if (event.type !== "result") continue;
    const denials = (event as Record<string, unknown>).permission_denials;
    if (!Array.isArray(denials)) continue;
    for (const denial of denials) {
      const toolInput = (denial as Record<string, unknown>)?.tool_input;
      if (!toolInput || typeof toolInput !== "object") continue;
      const command = (toolInput as Record<string, unknown>).command;
      // MUTATION: the head-anchored `claude` match is neutralised. Everything
      // else — the event walk, the shape guards, the finding — is untouched.
      if (typeof command === "string" && false) {
        return [{ severity: "high", diagnostic: `denied — ${child}` }];
      }
    }
  }
  return [];
}

describe("AC-STE-425.1 — the retired fixture's coverage becomes a real mutation check", () => {
  const CHILD = "ste350-nested";

  test("the detector fires on a claude-headed permission denial (the 8b assertion)", () => {
    const findings = checkChildSpawnCapture(deniedCapture("claude -p 'reply pong'"), CHILD);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe("high");
    expect(findings[0]!.diagnostic).toBe(
      `STE-350 regression: nested claude -p spawn denied/empty — ${CHILD}`,
    );
  });

  test("MUTATION — with the head predicate disabled, the same assertion FAILS", () => {
    // This is the whole point: the live fixture scored identically whether the
    // detector worked or not. This one does not.
    const capture = deniedCapture("claude -p 'reply pong'");
    expect(checkChildSpawnCapture(capture, CHILD)).toHaveLength(1);
    expect(checkChildSpawnCaptureMutant(capture, CHILD)).toHaveLength(0);
  });

  test("the head predicate is load-bearing in the other direction too", () => {
    // A denial that merely MENTIONS `claude -p` mid-string (a grep over a
    // SKILL body) must NOT score as a nested-spawn denial — otherwise the
    // detector would 'pass' the mutation check for the wrong reason.
    expect(
      checkChildSpawnCapture(
        deniedCapture("grep -n 'claude -p' .claude/skills/smoke-test/SKILL.md"),
        CHILD,
      ),
    ).toEqual([]);
    expect(CLAUDE_SPAWN_HEAD_RE.test("grep -n 'claude -p' x")).toBe(false);
    expect(CLAUDE_SPAWN_HEAD_RE.test("claude -p 'reply pong'")).toBe(true);
  });

  test("the empty-capture arm is independent of the head predicate", () => {
    // The 0-byte-grandchild arm must survive the retirement untouched — it is
    // the arm that DID fire historically.
    expect(checkChildSpawnCapture("", CHILD)).toHaveLength(1);
    expect(checkChildSpawnCapture("   \n  ", CHILD)).toHaveLength(1);
  });
});

D("AC-STE-425.1 — the live 8b negative fixture is retired from the SKILL", () => {
  test("fixture group 8 still exists (non-vacuity: 8a is kept, not the whole group deleted)", () => {
    const g8 = group8();
    expect(g8.length).toBeGreaterThan(200);
    expect(g8).toMatch(/Sub-fixture 8a/);
  });

  test("there is no sub-fixture 8b any more", () => {
    expect(group8()).not.toMatch(/Sub-fixture 8b/);
  });

  test("the group no longer instructs staging a settings file with the pattern removed", () => {
    const g8 = group8();
    expect(g8.length).toBeGreaterThan(200);
    const stagingLines = g8
      .split("\n")
      .filter((l) => /^\s*[-*]\s*\*{0,2}(Stage|Cleanup)\b/i.test(l))
      .filter((l) => /settings\.json|permissions\.allow/.test(l));
    expect(stagingLines).toEqual([]);
  });

  test("the negative capture path is gone with the fixture that wrote it", () => {
    expect(group8()).not.toContain("ste350-denied");
  });

  test("the SKILL records WHY the tracked allow-list is not the operative gate here", () => {
    // Scoped to the two slices that could legitimately own the rationale.
    const scope = `${group8()}\n\n${preflight10()}`;
    expect(group8().length).toBeGreaterThan(200);
    expect(
      someParagraphMatches(scope, [
        /defaultMode|default permission mode/i,
        /classifier/i,
        /\bnot\b|\bnever\b/,
        /operative|enforcement|the gate|governs|allow-?list/i,
      ]),
    ).toBe(true);
  });

  test("the rationale names the observation that made the fixture vacuous", () => {
    const scope = `${group8()}\n\n${preflight10()}`;
    expect(
      someParagraphMatches(scope, [
        /permission_denials/,
        /empty|\[\]|never populated|not populated/i,
      ]),
    ).toBe(true);
  });

  test("the retired coverage is re-homed at the deterministic mutation check", () => {
    // A retirement that just deletes coverage is not what AC.1 licenses: the
    // SKILL has to say where the falsifiable replacement lives.
    expect(
      someParagraphMatches(group8(), [/checkChildSpawnCapture/, /mutation/i]),
    ).toBe(true);
  });

  test("the retirement does not re-found the negative case as a second settings heredoc", () => {
    // Gate probe #62 would demand `Bash(claude:*)` INSIDE any such heredoc, and
    // claude-spawn-allowlist.test.ts requires exactly one — a negative fixture
    // cannot be authored as a heredoc at all.
    const heredocs = SKILL!.match(/cat\s+>\s+\.claude\/settings\.json\s+<<'EOF'/g) ?? [];
    expect(heredocs).toHaveLength(1);
  });

  test("pre-flight #10 is either dropped outright or re-justified against the finding", () => {
    const present = SKILL!.includes("spawn_pattern_allow_check");
    if (!present) {
      // Dropped: no residue anywhere in the driver.
      expect(SKILL!).not.toMatch(/Child-spawn pattern present in the tracked allow-list/);
      return;
    }
    const p10 = preflight10();
    expect(p10.length).toBeGreaterThan(200);
    expect(
      someParagraphMatches(p10, [
        /classifier|defaultMode|default permission mode|auto/i,
        /\bnot\b|\bnever\b|\bonly\b/,
        /operative|sufficient|gate|enforcement|necessary/i,
      ]),
    ).toBe(true);
  });

  test("the pre-flight decision stays coherent with /conformance-loop's mirror", () => {
    if (CONFORMANCE === null) return; // consumer checkout — nothing to mirror
    expect(SKILL!.includes("spawn_pattern_allow_check")).toBe(
      CONFORMANCE.includes("spawn_pattern_allow_check"),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-STE-425.2 — passed / failed / not-reached (and n/a-by-design)
// ═══════════════════════════════════════════════════════════════════════════

// Imported through a NON-LITERAL specifier so a missing module REDs only this
// section instead of collapsing the whole file.
const FIXTURE_GROUPS_MODULE = "../adapters/_shared/src/smoke_fixture_groups";

interface GroupSpec {
  group: number;
  sut: string;
  legs: readonly string[];
}
interface GroupRecord {
  group: number;
  sut: string;
  outcome: string;
}
interface ObservedGroup {
  group: number;
  outcome: string;
}
interface FixtureGroupsModule {
  FIXTURE_GROUP_OUTCOMES: readonly string[];
  CANONICAL_FIXTURE_GROUPS: readonly GroupSpec[];
  reconcileFixtureGroups(
    observed: readonly ObservedGroup[],
    leg: string,
  ): readonly GroupRecord[];
  renderFixtureGroupLine(record: GroupRecord): string;
  renderFixtureGroupSummary(records: readonly GroupRecord[]): string;
  fixtureGroupsAggregate(records: readonly GroupRecord[]): string;
}

let fixtureGroups: FixtureGroupsModule | null = null;
let fixtureGroupsError = "";
try {
  fixtureGroups = (await import(FIXTURE_GROUPS_MODULE)) as unknown as FixtureGroupsModule;
} catch (e) {
  fixtureGroupsError = e instanceof Error ? e.message : String(e);
}

function mod(): FixtureGroupsModule {
  if (fixtureGroups === null) {
    throw new Error(
      `AC-STE-425.2 requires adapters/_shared/src/smoke_fixture_groups.ts — ` +
        `import failed: ${fixtureGroupsError}`,
    );
  }
  return fixtureGroups;
}

/** The eight groups, observed as PASSED, minus the ones named. */
function allPassedExcept(...skip: number[]): ObservedGroup[] {
  return [1, 2, 3, 4, 5, 6, 7, 8]
    .filter((g) => !skip.includes(g))
    .map((group) => ({ group, outcome: "passed" }));
}

function recordFor(records: readonly GroupRecord[], group: number): GroupRecord {
  const found = records.find((r) => r.group === group);
  if (!found) throw new Error(`no record rendered for fixture group ${group}`);
  return found;
}

describe("AC-STE-425.2 — the outcome vocabulary", () => {
  test("four outcomes: the FR's three, plus n/a-by-design", () => {
    const m = mod();
    expect([...m.FIXTURE_GROUP_OUTCOMES]).toEqual([
      "passed",
      "failed",
      "not-reached",
      "not-applicable",
    ]);
  });

  test("`not-reached` and `not-applicable` are distinct — the group-2 ambiguity", () => {
    const m = mod();
    expect(m.FIXTURE_GROUP_OUTCOMES).toContain("not-reached");
    expect(m.FIXTURE_GROUP_OUTCOMES).toContain("not-applicable");
    expect(new Set(m.FIXTURE_GROUP_OUTCOMES).size).toBe(4);
  });

  test("the canonical roster covers all eight groups, in order", () => {
    const m = mod();
    expect(m.CANONICAL_FIXTURE_GROUPS.map((s) => s.group)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
  });

  test("group 2 is the only Linear-only group in the roster", () => {
    const m = mod();
    const linearOnly = m.CANONICAL_FIXTURE_GROUPS.filter(
      (s) => s.legs.length === 1 && s.legs[0] === "linear",
    ).map((s) => s.group);
    expect(linearOnly).toEqual([2]);
    for (const spec of m.CANONICAL_FIXTURE_GROUPS) {
      if (spec.group !== 2) expect([...spec.legs].sort()).toEqual(["jira", "linear"]);
    }
  });
});

D("AC-STE-425.2 — the roster agrees with the SKILL it models", () => {
  // Not a second hard-coded copy: both halves are parsed out of the SKILL.
  test("every roster entry's `sut` is the token that group's runtime-check line uses", () => {
    const m = mod();
    const slices = fixtureGroupSlices(SKILL!);
    expect(slices.size).toBe(8);
    for (const spec of m.CANONICAL_FIXTURE_GROUPS) {
      const slice = slices.get(spec.group) ?? "";
      expect(slice.length).toBeGreaterThan(0);
      const line = slice.match(/(STE-\d+) runtime check:/);
      expect(line).not.toBeNull();
      expect(spec.sut).toBe(line![1]);
    }
  });

  test("every roster entry's `legs` agrees with the group heading's annotation", () => {
    const m = mod();
    const slices = fixtureGroupSlices(SKILL!);
    for (const spec of m.CANONICAL_FIXTURE_GROUPS) {
      const heading = (slices.get(spec.group) ?? "").split("\n")[0] ?? "";
      const linearOnly = /Linear-only/i.test(heading);
      expect(spec.legs.length === 1).toBe(linearOnly);
      if (!linearOnly) expect(heading).toMatch(/Linear \+ Jira/);
    }
  });
});

describe("AC-STE-425.2 — a group that did not execute is never rendered as a pass", () => {
  test("the 2026-07-27 Linear leg: group 2 is NOT-REACHED, not absorbed", () => {
    const m = mod();
    const records = m.reconcileFixtureGroups(allPassedExcept(2), "linear");
    expect(records).toHaveLength(8);
    const g2 = recordFor(records, 2);
    expect(g2.outcome).toBe("not-reached");
    expect(g2.outcome).not.toBe("passed");
    expect(g2.outcome).not.toBe("not-applicable");
  });

  test("on the Jira leg the same silence is n/a-by-design, not a gap", () => {
    const m = mod();
    const records = m.reconcileFixtureGroups(allPassedExcept(2), "jira");
    expect(recordFor(records, 2).outcome).toBe("not-applicable");
  });

  test("silence for a both-legs group is not-reached on EITHER leg", () => {
    const m = mod();
    for (const leg of ["linear", "jira"]) {
      const records = m.reconcileFixtureGroups(allPassedExcept(7), leg);
      expect(recordFor(records, 7).outcome).toBe("not-reached");
    }
  });

  test("an observed failure survives reconciliation unchanged", () => {
    const m = mod();
    const observed = [
      ...allPassedExcept(3),
      { group: 3, outcome: "failed" },
    ];
    const records = m.reconcileFixtureGroups(observed, "linear");
    expect(recordFor(records, 3).outcome).toBe("failed");
    expect(records.filter((r) => r.outcome === "passed")).toHaveLength(7);
  });

  test("observing nothing yields eight records and zero passes", () => {
    const m = mod();
    const records = m.reconcileFixtureGroups([], "linear");
    expect(records).toHaveLength(8);
    expect(records.filter((r) => r.outcome === "passed")).toEqual([]);
    expect(records.filter((r) => r.outcome === "not-reached")).toHaveLength(8);
  });
});

describe("AC-STE-425.2 — rendering", () => {
  const spec = { group: 8, sut: "STE-350" };

  test("the per-group line keeps the pinned PASS / FAIL vocabulary", () => {
    const m = mod();
    expect(m.renderFixtureGroupLine({ ...spec, outcome: "passed" })).toBe(
      "STE-350 runtime check: PASS",
    );
    expect(m.renderFixtureGroupLine({ ...spec, outcome: "failed" })).toBe(
      "STE-350 runtime check: FAIL",
    );
  });

  test("the two new outcomes render as neither PASS nor FAIL", () => {
    const m = mod();
    expect(m.renderFixtureGroupLine({ ...spec, outcome: "not-reached" })).toBe(
      "STE-350 runtime check: NOT-REACHED",
    );
    expect(m.renderFixtureGroupLine({ ...spec, outcome: "not-applicable" })).toBe(
      "STE-350 runtime check: N/A",
    );
  });

  test("the summary names every group, and the unreached one is not a PASS line", () => {
    const m = mod();
    const records = m.reconcileFixtureGroups(allPassedExcept(2), "linear");
    const summary = m.renderFixtureGroupSummary(records);
    for (const record of records) {
      expect(summary).toContain(m.renderFixtureGroupLine(record));
    }
    const g2Line = m.renderFixtureGroupLine(recordFor(records, 2));
    expect(g2Line).toContain("NOT-REACHED");
    expect(g2Line).not.toContain("PASS");
  });

  test("the summary head counts all three outcomes separately", () => {
    const m = mod();
    const head = m
      .renderFixtureGroupSummary(m.reconcileFixtureGroups(allPassedExcept(2), "linear"))
      .split("\n")[0]!;
    expect(head).toMatch(/^Fixture groups: FAIL\b/);
    expect(head).toMatch(/\b7 passed\b/);
    expect(head).toMatch(/\b0 failed\b/);
    expect(head).toMatch(/\b1 not-reached\b/);
    expect(head).toMatch(/\b0 n\/a\b/);
  });

  test("an n/a-by-design group does not spend the run's pass budget", () => {
    const m = mod();
    const head = m
      .renderFixtureGroupSummary(m.reconcileFixtureGroups(allPassedExcept(2), "jira"))
      .split("\n")[0]!;
    expect(head).toMatch(/^Fixture groups: PASS\b/);
    expect(head).toMatch(/\b7 passed\b/);
    expect(head).toMatch(/\b0 not-reached\b/);
    expect(head).toMatch(/\b1 n\/a\b/);
  });
});

describe("AC-STE-425.2 — the aggregate cannot infer a pass from silence", () => {
  test("a not-reached group forces the aggregate to fail", () => {
    const m = mod();
    expect(m.fixtureGroupsAggregate(m.reconcileFixtureGroups(allPassedExcept(2), "linear"))).toBe(
      "fail",
    );
  });

  test("an empty observation set is never a pass", () => {
    const m = mod();
    expect(m.fixtureGroupsAggregate(m.reconcileFixtureGroups([], "linear"))).not.toBe(
      "pass",
    );
    expect(m.fixtureGroupsAggregate(m.reconcileFixtureGroups([], "jira"))).not.toBe(
      "pass",
    );
  });

  test("a failure forces the aggregate to fail", () => {
    const m = mod();
    const observed = [...allPassedExcept(5), { group: 5, outcome: "failed" }];
    expect(
      m.fixtureGroupsAggregate(m.reconcileFixtureGroups(observed, "linear")),
    ).toBe("fail");
  });

  test("pass only when every group passed or is n/a for this leg", () => {
    const m = mod();
    expect(
      m.fixtureGroupsAggregate(m.reconcileFixtureGroups(allPassedExcept(), "linear")),
    ).toBe("pass");
    expect(
      m.fixtureGroupsAggregate(m.reconcileFixtureGroups(allPassedExcept(2), "jira")),
    ).toBe("pass");
  });
});

// The CLI shim the SKILL's Phase 2.X fence actually invokes. Subprocess-tested
// through the same `bun run <module>` idiom `m111-ste-411-upgrade-hint-pins`
// uses for `upgrade_staleness.ts`, because the driver reads this module's rc —
// and an rc contract asserted only in prose is the shape of defect this FR is
// about. Exit codes: 0 = pass aggregate, 1 = fail aggregate, 2 = bad input.
const FIXTURE_GROUPS_CLI = join(
  PLUGIN_ROOT,
  "adapters",
  "_shared",
  "src",
  "smoke_fixture_groups.ts",
);

function runGroupsCli(args: string[]): {
  stdout: string;
  stderr: string;
  exitCode: number;
} {
  const r = Bun.spawnSync({
    cmd: ["bun", "run", FIXTURE_GROUPS_CLI, ...args],
    cwd: PLUGIN_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    stdout: r.stdout.toString(),
    stderr: r.stderr.toString(),
    exitCode: r.exitCode ?? -1,
  };
}

describe("AC-STE-425.2 — the CLI carries the aggregate in its exit status", () => {
  test("a complete Jira roster (group 2 n/a) renders PASS and exits 0", () => {
    const r = runGroupsCli(["render", "--leg", "jira", "--passed", "1 3 4 5 6 7 8"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.split("\n")[0]).toMatch(/^Fixture groups: PASS\b/);
    expect(r.stdout).toContain("STE-214 runtime check: N/A");
  });

  test("the same input on the Linear leg names the gap and exits 1", () => {
    const r = runGroupsCli(["render", "--leg", "linear", "--passed", "1 3 4 5 6 7 8"]);
    expect(r.exitCode).toBe(1);
    expect(r.stdout.split("\n")[0]).toMatch(/^Fixture groups: FAIL\b/);
    expect(r.stdout).toContain("STE-214 runtime check: NOT-REACHED");
  });

  test("an unrecognized or missing --leg is a usage error, not a verdict", () => {
    // Silently computing against the everything-applies roster would report a
    // phantom group-2 gap and send the operator after the wrong thing.
    for (const args of [
      ["render", "--leg", "jirra", "--passed", "1"],
      ["render", "--passed", "1"],
    ]) {
      const r = runGroupsCli(args);
      expect(r.exitCode).toBe(2);
      expect(r.stderr).toMatch(/--leg must be one of linear \| jira/);
      expect(r.stdout).not.toContain("Fixture groups:");
    }
  });

  test("a group number outside the roster is named, not silently dropped", () => {
    const r = runGroupsCli([
      "render",
      "--leg",
      "jira",
      "--passed",
      "1 3 4 5 6 7 8 99",
    ]);
    expect(r.stderr).toMatch(/outside the canonical roster: 99/);
    expect(r.exitCode).toBe(0); // the eight canonical records still decide rc
  });

  test("an unknown subcommand exits 2 with the usage line", () => {
    const r = runGroupsCli(["tally", "--leg", "linear"]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("usage: bun smoke_fixture_groups.ts render");
  });
});

D("AC-STE-425.2 — the SKILL renders the three outcomes", () => {
  test("every fixture group documents a FAIL branch, not only a PASS one", () => {
    // Groups 1, 2 and 3 state ONLY a PASS branch today — the mechanism by
    // which an unreached group is absorbed.
    const slices = fixtureGroupSlices(SKILL!);
    expect(slices.size).toBe(8);
    const missing: string[] = [];
    for (const [group, slice] of slices) {
      const sut = slice.match(/(STE-\d+) runtime check:/)?.[1];
      if (!sut) {
        missing.push(`group ${group}: no runtime-check line`);
        continue;
      }
      if (!SKILL!.includes(`${sut} runtime check: PASS`)) {
        missing.push(`group ${group}: no \`${sut} runtime check: PASS\``);
      }
      if (!SKILL!.includes(`${sut} runtime check: FAIL`)) {
        missing.push(`group ${group}: no \`${sut} runtime check: FAIL\``);
      }
    }
    expect(missing).toEqual([]);
  });

  test("the Phase 2.X summary section documents the not-reached rendering", () => {
    const section = phase2xSummarySection();
    expect(section.length).toBeGreaterThan(200);
    expect(section).toContain("NOT-REACHED");
  });

  test("the summary section states that silence is never a pass", () => {
    const section = phase2xSummarySection();
    expect(section.length).toBeGreaterThan(200);
    expect(
      someParagraphMatches(section, [
        /not-reached/i,
        /\bpass(?:ed|es)?\b/i,
        /\bnot\b|\bnever\b|\bneither\b/i,
      ]),
    ).toBe(true);
  });

  test("the summary section distinguishes not-reached from n/a-by-design", () => {
    const section = phase2xSummarySection();
    expect(
      someParagraphMatches(section, [
        /not-reached/i,
        /N\/A|not-applicable/i,
        /Linear-only|by design|leg/i,
      ]),
    ).toBe(true);
  });

  test("the summary section points at the module that computes the rendering", () => {
    expect(phase2xSummarySection()).toContain("smoke_fixture_groups");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-STE-425.3 — disposal rule for Phase 8 transcript fixtures
// ═══════════════════════════════════════════════════════════════════════════

/** The four captures m116's verdict-equivalence checks replay when present. */
const M116_REPLAY_CAPTURES = [
  "setup-2026-07-27.json",
  "brainstorm-2026-07-27.json",
  "spec-write-2026-07-27.json",
  "report-issue-2026-07-27.json",
];

DG("AC-STE-425.3 — the shipped .gitignore disposes of raw Phase 8 captures", () => {
  const DG2 = REPO_IS_WORKTREE ? test : test.skip;

  DG2("a tracker-scoped raw capture path is ignored", () => {
    expect(isIgnored(`${FIXTURE_DIR_REL}/setup-linear-2026-07-27.json`)).toBe(true);
    expect(isIgnored(`${FIXTURE_DIR_REL}/spec-write-jira-2026-07-27.json`)).toBe(true);
  });

  DG2("the legacy unscoped raw capture names are ignored too", () => {
    // The seven artifacts actually sitting in the tree are pre-STE-423 names.
    for (const name of M116_REPLAY_CAPTURES) {
      expect(isIgnored(`${FIXTURE_DIR_REL}/${name}`)).toBe(true);
    }
  });

  DG2("the trimmed `regression/` derivations are NOT ignored — they stay committed", () => {
    expect(isIgnored(`${FIXTURE_DIR_REL}/regression/setup-2026-07-27.json`)).toBe(false);
    expect(isIgnored(`${FIXTURE_DIR_REL}/regression/setup-linear-2026-07-27.json`)).toBe(
      false,
    );
  });

  DG2("the rule does not swallow the whole fixture tree", () => {
    // A `socratic-first-turn/` or `**` rule would take the derived reproducers
    // with it and silently un-committable the regression corpus.
    expect(isIgnored(`${FIXTURE_DIR_REL}/regression/`)).toBe(false);
    expect(isIgnored("plugins/dev-process-toolkit/tests/fixtures/capability-rows/x.log")).toBe(
      false,
    );
  });
});

(REPO_IS_WORKTREE ? describe : describe.skip)(
  "AC-STE-425.3 — the toolkit tree is clean enough for the next run's pre-flight #4",
  () => {
    test("no raw Phase 8 capture shows as untracked in the fixture directory", () => {
      const out = git(
        ["status", "--porcelain", "--", FIXTURE_DIR_REL],
        REPO_ROOT,
      ).stdout;
      const rawOffenders = out
        .split("\n")
        .filter(Boolean)
        .map((line) => line.slice(3).trim())
        // `regression/` derivations are a different question (they are meant to
        // be committed, and a sibling FR is adding one right now).
        .filter((p) => !p.includes("/regression/"));
      expect(rawOffenders).toEqual([]);
    });

    test("git-ignoring is NOT deleting — the local captures survive for replay", () => {
      // m116-ste-422 / m116-ste-419 replay these under
      // `test.skipIf(!existsSync(...))`. Ignoring changes nothing about whether
      // they exist, so those checks keep running here and keep skipping on a
      // clean checkout, exactly as they already do.
      const present = M116_REPLAY_CAPTURES.filter((n) =>
        existsSync(join(FIXTURE_DIR_ABS, n)),
      );
      if (present.length === 0) return; // clean checkout — nothing to preserve
      for (const name of present) {
        expect(existsSync(join(FIXTURE_DIR_ABS, name))).toBe(true);
        expect(isIgnored(`${FIXTURE_DIR_REL}/${name}`)).toBe(true);
      }
    });
  },
);

DG("AC-STE-425.3 — dirty-tree simulation against the shipped ignore rules", () => {
  test("a fresh raw capture leaves `git status --porcelain` empty", () => {
    withTempRepo((repo) => {
      writeFileSync(join(repo, ".gitignore"), GITIGNORE!, "utf8");
      writeFileDeep(repo, `${FIXTURE_DIR_REL}/regression/setup-2026-07-27.json`, "[]\n");
      expect(git(["add", "-A"], repo).status).toBe(0);

      // The derived reproducer must still be committable — a too-broad rule
      // would silently drop it here.
      const tracked = git(["ls-files"], repo).stdout;
      expect(tracked).toContain(`${FIXTURE_DIR_REL}/regression/setup-2026-07-27.json`);

      expect(git(["commit", "-q", "-m", "seed"], repo).status).toBe(0);
      expect(git(["status", "--porcelain"], repo).stdout.trim()).toBe("");

      // Now the run happens: Phase 8 drops a raw capture into the tree.
      writeFileDeep(
        repo,
        `${FIXTURE_DIR_REL}/setup-linear-2026-07-27.json`,
        JSON.stringify({ big: "x".repeat(2048) }),
      );

      // pre-flight #4 ("Uncommitted changes in the toolkit repo") must pass.
      expect(git(["status", "--porcelain"], repo).stdout.trim()).toBe("");
    });
  });

  test("…while `--ignored` still surfaces it, so the artifact is not invisible", () => {
    withTempRepo((repo) => {
      writeFileSync(join(repo, ".gitignore"), GITIGNORE!, "utf8");
      writeFileDeep(repo, `${FIXTURE_DIR_REL}/regression/setup-2026-07-27.json`, "[]\n");
      git(["add", "-A"], repo);
      git(["commit", "-q", "-m", "seed"], repo);
      writeFileDeep(repo, `${FIXTURE_DIR_REL}/setup-linear-2026-07-27.json`, "{}\n");

      const ignored = git(
        ["status", "--porcelain", "--ignored=matching", "-uall"],
        repo,
      ).stdout;
      expect(ignored).toContain("setup-linear-2026-07-27.json");
    });
  });
});

D("AC-STE-425.3 — the SKILL states the disposal rule", () => {
  test("Phase 8 documents what happens to the raw transcript captures", () => {
    const phase8 = phase8Section();
    expect(phase8.length).toBeGreaterThan(500);
    expect(
      someParagraphMatches(phase8, [
        /git-?ignor/i,
        /tests\/fixtures\/socratic-first-turn|capture|fixture/i,
      ]),
    ).toBe(true);
  });

  test("the rule says the trimmed derivations stay committed", () => {
    expect(
      someParagraphMatches(phase8Section(), [
        /git-?ignor/i,
        /regression|derived|trimmed/i,
        /commit/i,
      ]),
    ).toBe(true);
  });

  test("the rule connects to the next run's pre-flight #4", () => {
    expect(
      someParagraphMatches(phase8Section(), [
        /pre-flight #4|dirty tree|clean tree|uncommitted/i,
        /git-?ignor|dispos/i,
      ]),
    ).toBe(true);
  });

  test("the rule does not tell the operator to delete the captures", () => {
    // Deleting them would break the m116 replay checks that run whenever the
    // artifacts are present locally. Ignoring is not deleting.
    const disposal = paragraphs(phase8Section()).filter((p) => /git-?ignor/i.test(p));
    expect(disposal.length).toBeGreaterThan(0);
    for (const p of disposal) {
      expect(p).not.toMatch(/\brm\s+-[rf]/);
      expect(p).not.toMatch(/\bdelete the (?:raw )?(?:captures|fixtures)\b/i);
    }
  });

  test("the disposal prose keeps every fixture path tracker-scoped", () => {
    // m116-ste-423 requires EVERY `tests/fixtures/socratic-first-turn/<name>`
    // literal in this SKILL to carry a tracker token — a rule written as a bare
    // `*.json` glob, or as a bare `regression/` path, reds that file.
    const TRACKER = /(?:<tracker>|\$\{TRACKER\}|\$TRACKER|linear|jira)/;
    const names = [
      ...phase8Section().matchAll(
        /tests\/fixtures\/socratic-first-turn\/([^\s`)"']+)/g,
      ),
    ].map((m) => m[1]!);
    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((n) => !TRACKER.test(n))).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-STE-425.4 — a closing check surfaces the run's own untracked artifacts
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-STE-425.4 — why porcelain alone would be vacuous", () => {
  // Not decoration: once AC.3 lands, the artifacts AC.4 is about are ignored,
  // and an ignored file is invisible to `git status --porcelain`. A closing
  // check built on porcelain alone would therefore report "nothing to see"
  // on every single run — a new can't-fail check replacing the retired one.
  test("an ignored artifact is invisible to plain porcelain and visible with --ignored", () => {
    withTempRepo((repo) => {
      writeFileSync(join(repo, ".gitignore"), "artifacts/*.json\n", "utf8");
      // A tracked sibling so git does not collapse the whole directory into a
      // single `!! artifacts/` row — the real fixture directory carries tracked
      // content too (the `regression/` derivations).
      writeFileDeep(repo, "artifacts/keep.txt", "seed\n");
      git(["add", "-A"], repo);
      git(["commit", "-q", "-m", "seed"], repo);

      writeFileDeep(repo, "artifacts/run-linear-2026-07-27.json", "{}\n");

      expect(git(["status", "--porcelain"], repo).stdout.trim()).toBe("");
      expect(
        git(["status", "--porcelain", "--ignored=matching", "-uall"], repo).stdout,
      ).toContain("artifacts/run-linear-2026-07-27.json");
    });
  });
});

D("AC-STE-425.4 — the closing check exists, and is not in the m112 clause", () => {
  test("the SKILL documents a check over the run's own untracked artifacts", () => {
    const slice = closingCheckSlice();
    expect(slice.length).toBeGreaterThan(0);
    expect(slice).toMatch(/untracked/i);
    expect(slice).toMatch(/artifact|capture|fixture|transcript/i);
  });

  test("it does not live inside the Final-message self-check clause", () => {
    // m112-ste-414 reads that clause with an `instructionOffset` that returns
    // -1 the moment two sentences match an anchor role; a `kill`/pidfile,
    // `rm -rf`/archive, or `ps -X`/claude sentence added there flips five
    // currently-green tests at once.
    const clause = selfCheckClause();
    expect(clause.length).toBeGreaterThan(500);
    expect(clause).not.toMatch(/untracked/i);
    expect(clause).not.toMatch(/git status/);
    expect(clause).not.toMatch(/--ignored/);
  });

  test("the check enumerates the run's OWN artifacts rather than trusting porcelain", () => {
    const slice = closingCheckSlice();
    expect(slice.length).toBeGreaterThan(0);
    const usesIgnoredFlag = /--ignored/.test(slice);
    const namesOwnPaths =
      /tests\/fixtures\/socratic-first-turn\/[^\s`)"']*(?:<tracker>|\$\{TRACKER\}|\$TRACKER|linear|jira)/.test(
        slice,
      );
    expect(usesIgnoredFlag || namesOwnPaths).toBe(true);
  });

  test("the check is executable, not narrated", () => {
    const slice = closingCheckSlice();
    expect(slice.length).toBeGreaterThan(0);
    const fences = bashFences(slice);
    expect(fences.length).toBeGreaterThan(0);
    expect(fences.join("\n")).toMatch(/git\s+(?:-C\s+\S+\s+)?status|git\s+check-ignore|ls\b/);
  });

  test("it reports at the END of this run, contrasted with the next run's pre-flight", () => {
    expect(
      someParagraphMatches(closingCheckSlice(), [
        /end of (?:the )?run|closing|before .*teardown|final summary/i,
        /pre-flight|next run/i,
      ]),
    ).toBe(true);
  });

  test("a clean result is stated explicitly, so silence is not the pass signal", () => {
    // The same defect shape as the unreached fixture group: a check whose only
    // documented branch is the interesting one cannot be distinguished from a
    // check that never ran.
    expect(
      someParagraphMatches(closingCheckSlice(), [
        /\bnone\b|\bzero\b|\bno untracked\b|\bclean\b|\bempty\b/i,
        /report|print|emit|surface|line/i,
      ]),
    ).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Hazard pins — currently-green invariants a careless STE-425 edit would red
// in files this FR does not own. Re-asserted here so the break is attributed
// to this change instead of surfacing as an unexplained failure elsewhere.
// ═══════════════════════════════════════════════════════════════════════════

D("hazard pins — cross-file invariants", () => {
  test("both STE-350 runtime-check literals survive the three-outcome rewrite", () => {
    // smoke-test-ste352-stream-capture.test.ts:134-138.
    expect(SKILL!).toContain("STE-350 runtime check: PASS");
    expect(SKILL!).toContain("STE-350 runtime check: FAIL");
  });

  test("the LOWERCASE literal `fixture group 8` stays at zero occurrences", () => {
    // bundled-hooks-shape.test.ts:255-258 — retirement prose written in
    // lowercase reds an unrelated AC-STE-289.4 test.
    expect(SKILL!.includes("fixture group 8")).toBe(false);
  });

  test("exactly one `.claude/settings.json` scaffold heredoc remains", () => {
    // claude-spawn-allowlist.test.ts:312-318.
    expect(SKILL!.match(/cat\s+>\s+\.claude\/settings\.json\s+<<'EOF'/g) ?? []).toHaveLength(
      1,
    );
  });

  test("the authored `claude -p` spawn-line floor of 8 is not breached", () => {
    // claude-spawn-allowlist.test.ts:255-260.
    const spawnLines = bashFences(SKILL!)
      .flatMap((f) => f.split("\n"))
      .filter((l) => /^\s*claude\s+-p\b/.test(l));
    expect(spawnLines.length).toBeGreaterThanOrEqual(8);
  });

  test("every socratic-first-turn fixture literal in the SKILL is tracker-scoped", () => {
    // m116-ste-423-tracker-scoped-artifacts.test.ts:258-266.
    const TRACKER = /(?:<tracker>|\$\{TRACKER\}|\$TRACKER|linear|jira)/;
    const names = [
      ...SKILL!.matchAll(/tests\/fixtures\/socratic-first-turn\/([^\s`)"']+)/g),
    ].map((m) => m[1]!);
    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((n) => !TRACKER.test(n))).toEqual([]);
  });

  test("the m112 self-check clause's three anchor roles each still resolve uniquely", () => {
    // m112-ste-414-nontty-hard-gate.test.ts — `instructionOffset` returns -1
    // when NO sentence or MORE THAN ONE sentence carries an anchor role.
    const clause = selfCheckClause();
    expect(clause.length).toBeGreaterThan(500);
    const PID_GLOB = "/tmp/dpt-smoke-<tracker>-*.pid";

    const reap = (s: string) =>
      /\bkill\b(?!\s*-\s*0\b)/i.test(s) &&
      new RegExp("\\brm -f " + escapeRegExp(PID_GLOB)).test(s);
    const teardown = (s: string) =>
      /\brm -rf\b/.test(s) && /archive\/close/i.test(s);
    const identity = (s: string) =>
      /\bps\b\s+-[a-zA-Z]/.test(s) && /\bclaude\b/i.test(s);

    expect(instructionOffset(clause, reap)).toBeGreaterThanOrEqual(0);
    expect(instructionOffset(clause, teardown)).toBeGreaterThanOrEqual(0);
    expect(instructionOffset(clause, identity)).toBeGreaterThanOrEqual(0);
  });

  test("no new bold-lead paragraph was inserted at the head of the m112 clause", () => {
    // `boldClause` truncates at the NEXT bold-lead line, so a bold paragraph
    // inserted immediately after the lead-in shrinks the slice to nothing.
    const clause = selfCheckClause();
    expect(clause).toContain("SMOKE-ABORT");
    expect(clause).toContain("rc=0");
    expect(clause).toContain("smoke_verdict.ts");
  });
});

// ===========================================================================
// Phase-3 hardening — the module's conservative branches, actually exercised.
//
// The end-of-FR spec audit measured four claims that this module's own doc
// comments assert but no test reached. The last one is the sharpest: the
// roster-completeness guard in `fixtureGroupsAggregate` was unreachable from
// every existing test, because they all funnel through
// `reconcileFixtureGroups`, which returns eight records by construction. So a
// can't-fail branch was sitting inside the FR whose stated purpose is killing
// can't-fail checks. Each test below calls the exported function DIRECTLY with
// the input its branch exists for, and each was confirmed to fail when its
// branch is neutered.
// ===========================================================================

describe("Phase 3 hardening — conservative branches are reachable", () => {
  test("an unrecognized outcome token degrades to not-reached, never to passed", () => {
    // STE-429's Phase 8 emits `inconclusive`, a disposition this module has no
    // row for. Silence and nonsense must both read as a gap.
    for (const token of ["inconclusive", "skipped", "", "PASSED", undefined, null, 7]) {
      const records = mod().reconcileFixtureGroups(
        [{ group: 1, outcome: token as never }],
        "linear",
      );
      const one = records.find((r) => r.group === 1);
      expect(one).toBeDefined();
      expect(one!.outcome).toBe("not-reached");
    }
  });

  test("a reported `not-applicable` is not taken on the run's word", () => {
    // N/A is derived from the roster, never self-declared: group 1 applies on
    // both legs, so a driver claiming n/a for it is reporting nonsense.
    const records = mod().reconcileFixtureGroups(
      [{ group: 1, outcome: "not-applicable" as never }],
      "linear",
    );
    expect(records.find((r) => r.group === 1)!.outcome).toBe("not-reached");
  });

  test("an observed `failed` survives even on a leg where the group is n/a", () => {
    // Group 2 is Linear-only. If something nonetheless ran it on the Jira leg
    // and failed, downgrading that to N/A would erase a real failure.
    const jira = mod().reconcileFixtureGroups([{ group: 2, outcome: "failed" }], "jira");
    expect(jira.find((r) => r.group === 2)!.outcome).toBe("failed");
    expect(mod().fixtureGroupsAggregate(jira)).toBe("fail");
    // Control: unreported on the Jira leg really is n/a-by-design, and that
    // alone does not fail the aggregate.
    const quiet = mod().reconcileFixtureGroups([], "jira");
    expect(quiet.find((r) => r.group === 2)!.outcome).toBe("not-applicable");
  });

  test("an unknown leg makes every group apply, so a typo cannot forge an exemption", () => {
    // `--leg jirra` must not silently convert group 2's real gap into N/A.
    const typo = mod().reconcileFixtureGroups([], "jirra");
    expect(typo.find((r) => r.group === 2)!.outcome).toBe("not-reached");
    expect(typo.every((r) => r.outcome !== "not-applicable")).toBe(true);
  });

  test("the aggregate requires the FULL roster — a short record set cannot pass", () => {
    // The branch no prior test could reach: called directly, not through
    // reconcileFixtureGroups (which always returns all eight).
    const full = mod().reconcileFixtureGroups([], "linear").map((r) => ({
      ...r,
      outcome: "passed" as const,
    }));
    expect(full).toHaveLength(mod().CANONICAL_FIXTURE_GROUPS.length);
    expect(mod().fixtureGroupsAggregate(full)).toBe("pass");

    // Drop any single group and the aggregate must refuse to pass, however
    // green the survivors are.
    for (const spec of mod().CANONICAL_FIXTURE_GROUPS) {
      const short = full.filter((r) => r.group !== spec.group);
      expect(short).toHaveLength(mod().CANONICAL_FIXTURE_GROUPS.length - 1);
      expect(mod().fixtureGroupsAggregate(short)).toBe("fail");
    }
    // And the degenerate case.
    expect(mod().fixtureGroupsAggregate([])).toBe("fail");
  });
});

// ===========================================================================
// Phase-3 round-2 hardening — the closing check's coverage is complete.
//
// Round 1 caught that the closing artifact check enumerated two of the three
// artifact classes the run writes into the toolkit repo: the group-8a
// nested-spawn capture was persisted unconditionally, was NOT git-ignored, and
// was NOT listed — so it would first surface as the NEXT run's pre-flight #4
// refusal, which is the exact failure AC-STE-425.4 exists to prevent. The fix
// added the third pathspec. Round 2 caught that the completeness of that list
// was itself unpinned, so the same omission could recur silently.
//
// This derives the expected set from the SKILL's own persist instructions
// rather than hard-coding it: any phase that gains a `tests/fixtures/<class>/`
// write target must appear in the check, or this reds.
// ===========================================================================

describe("Phase 3 round-2 hardening — closing check covers every persist class", () => {
  /** Every `tests/fixtures/<class>/` directory the SKILL tells the run to write. */
  function persistClassesInSkill(): Set<string> {
    const out = new Set<string>();
    const re = /tests\/fixtures\/([a-z0-9-]+)\//g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(SKILL ?? "")) !== null) out.add(m[1]!);
    return out;
  }

  /** The classes named as pathspecs inside the closing-check fence. */
  function pathspecClasses(): Set<string> {
    const fence = closingCheckSlice();
    const out = new Set<string>();
    const re = /'plugins\/dev-process-toolkit\/tests\/fixtures\/([a-z0-9-]+)\/'/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(fence)) !== null) out.add(m[1]!);
    return out;
  }

  test("the closing check names a pathspec for every fixture class the run writes", () => {
    const documented = persistClassesInSkill();
    const covered = pathspecClasses();
    expect(documented.size).toBeGreaterThan(1);
    expect(covered.size).toBeGreaterThan(1);
    // `regression/` is a committed input, not a run output — the run never
    // writes it, so it is legitimately out of scope for the closing check.
    documented.delete("regression");
    const missing = [...documented].filter((c) => !covered.has(c)).sort();
    expect(missing).toEqual([]);
  });

  test("the three known classes are each named explicitly", () => {
    const covered = pathspecClasses();
    for (const cls of ["socratic-first-turn", "capability-rows", "nested-spawn"]) {
      expect(covered.has(cls)).toBe(true);
    }
  });
});
