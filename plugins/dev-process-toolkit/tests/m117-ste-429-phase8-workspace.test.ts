// M117 STE-429 — "Give Phase 8 a scaffold-free workspace per in-scope skill".
//
// ===========================================================================
// WHAT IS BROKEN
// ===========================================================================
//
// `.claude/skills/smoke-test/SKILL.md` § Phase 8 spawns one `claude -p <skill>`
// child per in-scope skill (`setup`, `brainstorm`, `spec-write`,
// `report-issue`) and scores each child's first turn through
// `adapters/_shared/src/socratic_first_turn_assert.ts`. It performs NO
// workspace preparation of any kind: the children start in the canonical
// chain's own test project, which Phase 2 has already fully configured.
//
// That position makes a pass STRUCTURALLY UNREACHABLE for the skills whose
// Socratic entry is conditioned on there being something left to do. Measured
// 2026-07-27 (Jira leg): `/setup` scored `vacuous askIndex=-1` — tool sequence
// `Skill, Bash x7, ToolSearch, mcp__atlassian__*`, no `AskUserQuestion`, no
// in-scope `Write`, tree clean. It did not misbehave; there was nothing to ask
// about. `/brainstorm` scored the same. A reader of the aggregate verdict
// cannot tell that apart from a skill that was tested and behaved well.
//
// The second half of the defect is the rendering. The runner ALREADY
// distinguishes `vacuous` with its own exit code (`socratic_first_turn_assert
// .ts`: ok-* => 0, violation => 1, vacuous => 3, bad args => 2), but the driver
// prose collapses everything non-zero into one bucket — "a non-zero exit emits
// `socratic_first_turn_contract_violation` and hard-fails the smoke run" — so
// the inconclusive state the runner computes is invisible at the surface the
// operator reads.
//
// ===========================================================================
// THE IMPLEMENTATION DECISION THESE TESTS ARE WRITTEN AGAINST
// ===========================================================================
//
// The per-skill scratch workspace lives INSIDE the guarded test-project
// directory (a per-skill SUBDIRECTORY of `../dpt-test-project-<tracker>/`),
// NOT at a new sibling path. Pre-flight #6's CLOSED basename allow-list
// (`{dpt-test-project-linear, dpt-test-project-jira}`) is the load-bearing cwd
// guard the whole threat model rests on; widening it to admit per-skill
// basenames would weaken exactly the guard STE-427 is concurrently rewriting.
// A subdirectory inherits the guard for free, inherits the tracker scoping for
// free, and is removed by Phase 5's existing `rm -rf` of the parent. Phase 8
// runs AFTER Phase 4's verify-on-disk, so a scratch subdir cannot disturb the
// chain's own verification.
//
// Both halves are pinned below: the workspace is PER-SKILL and strictly under
// the test project, AND pre-flight #6's basename set stays closed at two.
//
// ===========================================================================
// TEST DESIGN — the traps this file is built to avoid
// ===========================================================================
//
//  * PROJECT-LOCAL SURFACE. The driver SKILL lives at `repoRoot/.claude/skills/`,
//    OUTSIDE `plugins/dev-process-toolkit`, so it is read through
//    `join(import.meta.dir, "..", "..", "..")` + `readIfPresent` +
//    `describe.skip` (a pluginRoot-scoped sweep cannot see it and would pass
//    vacuously in a consumer checkout). Shape borrowed from
//    `smoke-driver-m96-verified-wipe-freshness.test.ts`.
//  * PARAGRAPH SCOPING. Prose claims are asserted against the Phase 8 slice or
//    a single blank-line-delimited paragraph inside it, never the whole file —
//    a whole-file grep over a 1379-line SKILL is satisfiable from forty lines
//    away. Every negative assertion asserts its slice is non-empty FIRST.
//  * NO TAUTOLOGIES. The workspace assertions do not hard-code a path: they
//    parse the fence's own shell assignments, expand them, and compare the
//    parts against each other (third runner argument === the directory the
//    child was `cd`'d into). The disposition assertions parse the exit-code
//    mapping the SKILL documents and feed a REAL vacuous verdict through it.
//  * FENCE HAZARDS (all currently-green pins a careless edit reds):
//      - a SECOND `bun "${ASSERT_RUNNER}"` line makes m116-ste-422's
//        `documentedInvocation()` THROW, taking down that whole file;
//      - m116-ste-423's `phase8Fence()` picks the FIRST fence containing
//        `FIXTURE_DIR=`, so a new fence must not introduce that literal earlier;
//      - `namesTestProjectPath` (m116-ste-422) resolves the third argument
//        through at most three levels of WHOLE-STRING variable indirection: a
//        `WORKSPACE=${TEST_PROJECT_DIR}/…` chain does NOT resolve, because the
//        intermediate value is not a bare `${VAR}` token. § "sibling pins"
//        below re-implements that predicate and asserts it still holds;
//      - gate probe #38 (`auto_approve_marker`) exempts Phase 8 by detecting
//        the reminder substring "asked you to work without stopping for
//        clarifying questions" INSIDE the fence; a second heredoc-bearing spawn
//        fence without that line re-arms the probe. Keeping the preparation in
//        the existing wrapper fence avoids the whole question, and the
//        assertions below are written so it can.
//  * SIBLING OVERLAP inside M117. STE-428 owns the four-fixture-EXISTENCE
//    assertion on this same Phase 8 block; STE-425 owns the passed/failed/
//    not-reached rendering on the sibling Phase 2.X summary. This file owns
//    the WORKSPACE PREPARATION and the vacuous => INCONCLUSIVE rendering, plus
//    the explicit COMPOSITION with STE-425's vocabulary (an inconclusive skill
//    must not be counted as a passed group).

import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import { assertChainIntegrity } from "../adapters/_shared/src/smoke_child_capture";
import { verdictFor } from "../adapters/_shared/src/socratic_first_turn_assert";
import { parseStreamJsonTranscript } from "../adapters/_shared/src/socratic_first_turn_stream";
import type { TranscriptEntry } from "../adapters/_shared/src/socratic_first_turn";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const SMOKE_SKILL_PATH = join(
  REPO_ROOT,
  ".claude",
  "skills",
  "smoke-test",
  "SKILL.md",
);

const CAPTURE_DIR = join(PLUGIN_ROOT, "tests", "fixtures", "socratic-first-turn");
const REGRESSION_DIR = join(CAPTURE_DIR, "regression");

/** The Phase 8 rotation, in the order the driver fires them. */
const IN_SCOPE_SKILLS = [
  "setup",
  "brainstorm",
  "spec-write",
  "report-issue",
] as const;

function readIfPresent(path: string): string | null {
  try {
    return existsSync(path) ? readFileSync(path, "utf8") : null;
  } catch {
    return null;
  }
}

const skill = readIfPresent(SMOKE_SKILL_PATH);
const SKILL_TEXT = skill ?? "";
const D = skill === null ? describe.skip : describe;

// ===========================================================================
// Prose slicing (house pattern: smoke-driver-m96-verified-wipe-freshness.ts)
// ===========================================================================

function sectionSlice(body: string, startMarker: string, endMarker: string): string {
  const start = body.indexOf(startMarker);
  if (start === -1) return "";
  const end = body.indexOf(endMarker, start);
  return end === -1 ? body.slice(start) : body.slice(start, end);
}

/** § Phase 8, up to the Phase 9 heading. */
function phase8Slice(): string {
  return sectionSlice(SKILL_TEXT, "### Phase 8", "### Phase 9");
}

/** Pre-flight #6 — the cwd guard, up to pre-flight #7. */
function preflight6Slice(): string {
  return sectionSlice(
    SKILL_TEXT,
    "6. **Path-safety on the test-project location.**",
    "7. **(Jira-only) Atlassian MCP not available**",
  );
}

function stripFences(text: string): string {
  return text.replace(/```[a-zA-Z-]*\n[\s\S]*?```/g, "\n");
}

/** Phase 8 with every fenced block removed — the operator-facing contract. */
function phase8Prose(): string {
  return stripFences(phase8Slice());
}

/** Paragraph-proximity: some blank-line-delimited paragraph satisfies all patterns. */
function someParagraphMatches(body: string, patterns: RegExp[]): boolean {
  return body
    .split(/\n\n+/)
    .some((paragraph) => patterns.every((re) => re.test(paragraph)));
}

/** Every fenced block body inside `section`, in document order. */
function fencedBlocks(section: string): string[] {
  const out: string[] = [];
  const re = /```[a-zA-Z-]*\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(section)) !== null) out.push(m[1]!);
  return out;
}

/**
 * The Phase 8 driver-wrapper fence — selected by `ASSERT_RUNNER=`, the same
 * anchor m116-ste-422 uses (it pins that exactly ONE such fence exists).
 */
function driverFence(): string {
  const blocks = fencedBlocks(phase8Slice()).filter((b) =>
    /^[ \t]*(?:export[ \t]+)?ASSERT_RUNNER=/m.test(b),
  );
  return blocks[0] ?? "";
}

// ===========================================================================
// Shell-fence parsing: assignments, expansion, spawn/runner call sites.
// ===========================================================================

/** First assignment per variable name, in fence order. */
function fenceAssignments(fence: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of fence.split("\n")) {
    const m = /^[ \t]*(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!m) continue;
    if (!out.has(m[1]!)) out.set(m[1]!, m[2]!.trim());
  }
  return out;
}

const VAR_REF_RE = /\$\{([A-Za-z_][A-Za-z0-9_]*)[^}]*\}|\$([A-Za-z_][A-Za-z0-9_]*)/g;

/**
 * Expand `${VAR}` / `$VAR` references against the fence's own assignments.
 * Self-referential values (`TRACKER="${TRACKER:?…}"` — the fence's guard idiom)
 * are left literal rather than recursed into.
 */
function expandVars(
  value: string,
  assigns: Map<string, string>,
  seen: ReadonlySet<string> = new Set(),
): string {
  return value.replace(VAR_REF_RE, (whole, braced, bare) => {
    const name = (braced ?? bare) as string;
    if (seen.has(name)) return whole;
    const assigned = assigns.get(name);
    if (assigned === undefined) return whole;
    return expandVars(assigned, assigns, new Set([...seen, name]));
  });
}

/** Quotes carry no meaning for a containment comparison; drop them. */
function normalizePath(value: string): string {
  return value.replace(/["']/g, "").trim();
}

interface NamedPath {
  name: string;
  expanded: string;
}

function expandedAssignments(fence: string): NamedPath[] {
  const assigns = fenceAssignments(fence);
  return [...assigns].map(([name, raw]) => ({
    name,
    expanded: normalizePath(expandVars(raw, assigns)),
  }));
}

/** The assignment that resolves to the test-project ROOT (no trailing subpath). */
function testProjectRootVar(): NamedPath | null {
  return (
    expandedAssignments(driverFence()).find((a) =>
      /dpt-test-project-[^/]*$/.test(a.expanded),
    ) ?? null
  );
}

/**
 * The assignment that resolves to a PER-SKILL directory strictly inside the
 * test project — the workspace STE-429 exists to introduce. Per-skill means the
 * path still carries an unexpanded `${SKILL}` / `$SKILL` reference (the loop
 * variable is never assigned, so expansion leaves it literal).
 */
function perSkillWorkspaceVar(): NamedPath | null {
  return (
    expandedAssignments(driverFence()).find(
      (a) =>
        /dpt-test-project-[^/]*\/.+/.test(a.expanded) &&
        /\$\{?SKILL\}?/.test(a.expanded),
    ) ?? null
  );
}

function joinContinuations(text: string): string {
  return text.replace(/\\\r?\n[ \t]*/g, " ");
}

/** Split a shell argument list, honoring single and double quotes. */
function shellArgs(rest: string): string[] {
  const out: string[] = [];
  const re = /"(?:[^"\\]|\\.)*"|'[^']*'|[^\s]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rest)) !== null) {
    if (m[0]!.startsWith("#")) break;
    out.push(m[0]!);
  }
  return out;
}

/** The `bun <ASSERT_RUNNER> …` argument list inside the driver fence. */
function runnerArgs(): string[] | null {
  const re = /\bbun\s+"?\$\{?ASSERT_RUNNER\}?"?([^\n]*)/;
  const m = re.exec(joinContinuations(driverFence()));
  return m ? shellArgs(m[1] ?? "") : null;
}

function unquote(token: string): string {
  return token.replace(/^["']/, "").replace(/["']$/, "");
}

/**
 * m116-ste-422's `namesTestProjectPath`, re-implemented verbatim in shape.
 * Re-implemented rather than imported because that file exports nothing — and
 * because this file's whole job is to change the token it inspects. The
 * predicate resolves through at most three levels of WHOLE-STRING variable
 * indirection; a value like `${TEST_PROJECT_DIR}/.phase8/${SKILL}` is NOT a
 * bare `${VAR}` token and therefore does NOT resolve. That is the trap.
 */
function namesTestProjectPath(token: string, body: string, depth = 0): boolean {
  if (depth > 3) return false;
  const inner = unquote(token);
  if (inner.includes("dpt-test-project")) return true;
  const varName = /^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?$/.exec(inner)?.[1];
  if (!varName) return false;
  const assignment = new RegExp(
    `^[ \\t]*(?:export[ \\t]+)?${varName}=(.+)$`,
    "m",
  ).exec(body)?.[1];
  if (!assignment) return false;
  return namesTestProjectPath(assignment.trim(), body, depth + 1);
}

// ===========================================================================
// Documented exit-code disposition (AC-STE-429.3).
// ===========================================================================

type Disposition = "ok" | "violation" | "inconclusive";

/**
 * Candidate statements: markdown table rows kept whole, prose lines split into
 * clauses so `exit 1 => violation; exit 3 => inconclusive` classifies each code
 * independently.
 */
function dispositionSegments(prose: string): string[] {
  const out: string[] = [];
  for (const line of prose.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.startsWith("|")) {
      out.push(trimmed);
      continue;
    }
    for (const part of trimmed.split(/(?<=[.;:])\s+|\s+—\s+|\s+\|\s+/)) {
      if (part.trim().length > 0) out.push(part.trim());
    }
  }
  return out;
}

/** True when `segment` names runner exit code `code` explicitly and numerically. */
function documentsExitCode(segment: string, code: number): boolean {
  if (segment.startsWith("|")) {
    const cells = segment.split("|").map((c) => c.trim().replace(/`/g, ""));
    if (cells.length > 2 && cells[1] === String(code)) return true;
  }
  return new RegExp(
    String.raw`(?:\bexits?\b|\bexit code\b|\brc\b)[^0-9\n]{0,16}\b${code}\b`,
    "i",
  ).test(segment);
}

/** The disposition keyword that appears FIRST in the segment, by position. */
function dispositionOf(segment: string): Disposition | null {
  const hits: Array<[number, Disposition]> = [];
  const push = (re: RegExp, d: Disposition) => {
    const m = re.exec(segment);
    if (m) hits.push([m.index, d]);
  };
  push(/inconclusive/i, "inconclusive");
  push(/violation/i, "violation");
  push(/\bok\b|\bpass(?:es|ed|ing)?\b/i, "ok");
  if (hits.length === 0) return null;
  hits.sort((a, b) => a[0] - b[0]);
  return hits[0]![1];
}

/** Every disposition the Phase 8 PROSE assigns to runner exit code `code`. */
function documentedDispositions(code: number): Disposition[] {
  const found = new Set<Disposition>();
  for (const segment of dispositionSegments(phase8Prose())) {
    if (!documentsExitCode(segment, code)) continue;
    const d = dispositionOf(segment);
    if (d) found.add(d);
  }
  return [...found];
}

// ===========================================================================
// Fixture helpers (AC-STE-429.2).
// ===========================================================================

/**
 * The per-skill reachable-pass reproducer STE-429 AC.2 requires. Named
 * distinctly from the M116 STE-422 verdict-table fixtures
 * (`regression/<skill>-2026-07-27.json`), which record the BROKEN position's
 * outcomes (setup: violation, report-issue: vacuous) and must not be edited.
 */
const reachableFixturePath = (s: string) =>
  join(REGRESSION_DIR, `${s}-reachable-pass.json`);

interface Provenance {
  text: string;
  projectRoot: string | null;
}

/**
 * The leading provenance `user` event required by the `regression/` convention
 * (see `regression/report-issue-2026-07-27.json` for the exemplar shape), plus
 * the machine-readable `projectRoot=<abs path>` token this FR adds: the
 * workspace the child actually ran in is what the runner's third argument
 * scopes to, so the fixture has to record it to be replayable.
 *
 * The stream parser ignores `user` events, so the provenance line does not
 * shift any transcript index.
 */
function provenanceOf(raw: string): Provenance | null {
  const first = raw.split("\n").find((l) => l.trim().length > 0);
  if (!first) return null;
  let event: unknown;
  try {
    event = JSON.parse(first);
  } catch {
    return null;
  }
  const e = event as { type?: string; message?: { content?: unknown } };
  if (e?.type !== "user") return null;
  const content = e.message?.content;
  const text = Array.isArray(content)
    ? content
        .map((c) =>
          typeof (c as { text?: unknown })?.text === "string"
            ? ((c as { text: string }).text)
            : "",
        )
        .join("\n")
    : typeof content === "string"
      ? content
      : "";
  const m = /projectRoot=(\S+)/.exec(text);
  return { text, projectRoot: m ? m[1]! : null };
}

function transcriptOf(path: string): TranscriptEntry[] {
  return parseStreamJsonTranscript(readFileSync(path, "utf8"));
}

// ===========================================================================
// AC-STE-429.1 — a per-skill workspace where the Socratic entry is reachable.
// ===========================================================================

D("AC-STE-429.1 — the Phase 8 driver prepares a per-skill workspace", () => {
  test("the project-local smoke SKILL and its Phase 8 driver fence resolve", () => {
    expect(skill).not.toBeNull();
    expect(phase8Slice().length).toBeGreaterThan(1000);
    expect(driverFence().length).toBeGreaterThan(200);
  });

  test("the fence assigns a per-skill workspace under the test project", () => {
    // The headline defect: today the fence assigns exactly two paths that
    // matter — FIXTURE_DIR (under the plugin) and TEST_PROJECT_DIR (the chain's
    // own already-configured project) — and no per-skill directory at all.
    const ws = perSkillWorkspaceVar();
    expect(ws).not.toBeNull();
    expect(ws!.expanded).toMatch(/\$\{?SKILL\}?/);
  });

  test("the workspace is a SUBDIRECTORY of the test project, not a new sibling", () => {
    // Rationale (FR Technical Design + this file's header): a sibling basename
    // would have to be admitted by pre-flight #6's closed allow-list. A
    // subdirectory inherits the cwd guard and the tracker scoping for free.
    const root = testProjectRootVar();
    const ws = perSkillWorkspaceVar();
    expect(root).not.toBeNull();
    expect(ws).not.toBeNull();
    expect(ws!.expanded.startsWith(`${root!.expanded}/`)).toBe(true);
    expect(ws!.expanded).not.toBe(root!.expanded);
  });

  test("the workspace is created before the child is spawned", () => {
    const ws = perSkillWorkspaceVar();
    expect(ws).not.toBeNull();
    const ref = String.raw`\$\{?${ws!.name}\}?`;
    const lines = driverFence().split("\n");
    const spawnIdx = lines.findIndex((l) => /\bclaude\s+-p\b/.test(l));
    expect(spawnIdx).toBeGreaterThan(-1);
    const mkdirIdx = lines.findIndex((l) =>
      new RegExp(String.raw`\bmkdir\b[^\n]*${ref}`).test(l),
    );
    expect(mkdirIdx).toBeGreaterThan(-1);
    expect(mkdirIdx).toBeLessThan(spawnIdx);
  });

  test("the child actually RUNS in the workspace, not in the chain's project root", () => {
    // Preparing a directory the child never enters would leave the defect
    // exactly where it is: the cwd is what decides whether `/setup` has
    // anything left to ask about.
    const ws = perSkillWorkspaceVar();
    expect(ws).not.toBeNull();
    const ref = String.raw`\$\{?${ws!.name}\}?`;
    const lines = driverFence().split("\n");
    const spawnIdx = lines.findIndex((l) => /\bclaude\s+-p\b/.test(l));
    expect(spawnIdx).toBeGreaterThan(-1);
    const cdIdx = lines.findIndex((l) =>
      new RegExp(String.raw`(?:\bcd\b|--cwd|--add-dir)\s+"?${ref}`).test(l),
    );
    expect(cdIdx).toBeGreaterThan(-1);
    expect(cdIdx).toBeLessThanOrEqual(spawnIdx);
  });

  test("the prose states a PER-SKILL preparation, not one shared prep", () => {
    const prose = phase8Prose();
    expect(prose.length).toBeGreaterThan(500);
    expect(
      someParagraphMatches(prose, [
        /per-skill|per in-scope skill|for each in-scope skill/i,
        /workspace|scratch|working director/i,
        /prepar|state|seed/i,
      ]),
    ).toBe(true);
  });

  test("the prose states /setup's starting state is an EMPTY project", () => {
    // The measured cause: "there was nothing left for it to configure and
    // therefore nothing to ask about".
    expect(
      someParagraphMatches(phase8Prose(), [
        /\bsetup\b/,
        /\bempty\b|nothing (?:is )?configured|unconfigured|bare/i,
      ]),
    ).toBe(true);
  });

  test("the prose states the other three start MINIMALLY SCAFFOLDED", () => {
    expect(
      someParagraphMatches(phase8Prose(), [
        /spec-write|brainstorm|report-issue/,
        /minimal|minimally/i,
        /scaffold/i,
      ]),
    ).toBe(true);
  });

  test("the prose no longer leaves the children in the chain's configured output", () => {
    const prose = phase8Prose();
    expect(prose.length).toBeGreaterThan(500);
    // Paired with the positive requirements above, so deleting a sentence
    // cannot satisfy this on its own.
    expect(
      someParagraphMatches(prose, [
        /workspace|scratch|working director/i,
        /already[- ]scaffolded|already[- ]configured|chain(?:'s)? output|reachab/i,
      ]),
    ).toBe(true);
  });
});

D("AC-STE-429.1 — pre-flight #6's closed basename allow-list is NOT widened", () => {
  /** The `case "$(basename "$TEST_REAL")" in …` alternation, as authored. */
  function basenameAllowList(): string[] | null {
    const m = /case\s+"\$\(basename\s+"\$TEST_REAL"\)"\s+in\s*\n\s*([^\n)]+)\)/.exec(
      preflight6Slice(),
    );
    if (!m) return null;
    return m[1]!
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  test("pre-flight #6 still resolves and still carries its reference implementation", () => {
    const slice = preflight6Slice();
    expect(slice.length).toBeGreaterThan(500);
    expect(slice).toContain("Reference implementation");
  });

  test("the allow-list is exactly the two tracker-keyed basenames", () => {
    // A per-skill workspace basename admitted here would weaken the cwd guard
    // STE-427 is concurrently rewriting. `toEqual`, not `toContain`.
    expect(basenameAllowList()).toEqual([
      "dpt-test-project-linear",
      "dpt-test-project-jira",
    ]);
  });

  test("the prose still describes the allow-list as CLOSED", () => {
    expect(preflight6Slice()).toMatch(/closed allow-list/i);
  });

  test("no Phase 8 workspace token leaks into the cwd guard", () => {
    const ws = perSkillWorkspaceVar();
    const slice = preflight6Slice();
    expect(slice.length).toBeGreaterThan(500);
    if (ws) {
      const leaf = ws.expanded.split("/").filter(Boolean).pop()!;
      // The guard must know nothing about the workspace — containment is what
      // makes the subdirectory design safe, not an added exception.
      expect(slice).not.toContain(leaf);
    }
    expect(slice).not.toMatch(/\$\{?SKILL\}?/);
  });
});

D("AC-STE-429.1 — the sibling m116-ste-422 pins stay satisfiable", () => {
  test("the runner is still invoked exactly once, with three arguments", () => {
    // A SECOND `bun "${ASSERT_RUNNER}"` line anywhere in the file makes
    // m116-ste-422's `documentedInvocation()` THROW, which takes down every
    // test in that file rather than one.
    const fileWide = [
      ...joinContinuations(SKILL_TEXT).matchAll(
        /\bbun\s+"?\$\{?ASSERT_RUNNER\}?"?[^\n]*/g,
      ),
    ];
    expect(fileWide).toHaveLength(1);
    const args = runnerArgs();
    expect(args).not.toBeNull();
    expect(args!).toHaveLength(3);
  });

  test("the third argument resolves to the workspace the child ran in", () => {
    // AC-STE-429.1 + the STE-422 contract composed: scaffold detection must be
    // scoped to the directory the child actually operated in. Pointing it at
    // the chain's project root while the child runs one level down would let a
    // genuine in-workspace violation read as an out-of-project write.
    const args = runnerArgs();
    const ws = perSkillWorkspaceVar();
    expect(args).not.toBeNull();
    expect(ws).not.toBeNull();
    const assigns = fenceAssignments(driverFence());
    const third = normalizePath(expandVars(unquote(args![2]!), assigns));
    expect(third).toBe(ws!.expanded);
  });

  test("the third argument still satisfies m116-ste-422's namesTestProjectPath", () => {
    // THE TRAP. That predicate resolves only WHOLE-STRING `${VAR}` indirection,
    // so `WORKSPACE=${TEST_PROJECT_DIR}/.phase8/${SKILL}` fails it and reds a
    // green sibling test. The workspace assignment must itself carry the
    // `dpt-test-project` literal.
    const args = runnerArgs();
    expect(args).not.toBeNull();
    expect(namesTestProjectPath(args![2]!, SKILL_TEXT)).toBe(true);
  });

  test("the Phase 8 fixture path is unchanged in shape (tracker + <skill> scoped)", () => {
    // m116-ste-423 requires every `tests/fixtures/socratic-first-turn/<name>`
    // literal in the skill to carry a tracker segment, and — inside Phase 8 —
    // `<skill>` too. The reachable-pass fixtures this FR adds are therefore
    // deliberately NOT documented in the SKILL.
    const names = [
      ...SKILL_TEXT.matchAll(
        /tests\/fixtures\/socratic-first-turn\/([^\s`)"']+)/g,
      ),
    ].map((m) => m[1]!);
    expect(names.length).toBeGreaterThan(0);
    for (const n of names) {
      expect(n).toMatch(/<tracker>|\$\{TRACKER\}|\$TRACKER|linear|jira/);
    }
  });
});

// ===========================================================================
// AC-STE-429.2 — a reachable-pass fixture per in-scope skill.
// ===========================================================================

describe("AC-STE-429.2 — every in-scope skill has a reachable-pass fixture", () => {
  test("the committed regression fixture directory exists", () => {
    expect(existsSync(REGRESSION_DIR)).toBe(true);
  });

  for (const s of IN_SCOPE_SKILLS) {
    describe(`${s}`, () => {
      test("a reachable-pass reproducer is committed", () => {
        expect(existsSync(reachableFixturePath(s))).toBe(true);
      });

      test("it follows the regression/ convention: derived, trimmed, provenanced", () => {
        const raw = readFileSync(reachableFixturePath(s), "utf8");
        expect(raw.length).toBeGreaterThan(0);
        // The untracked source captures run 100 KB – 450 KB. A committed
        // reproducer that grows past 32 KB has stopped being derived.
        expect(raw.length).toBeLessThan(32 * 1024);

        const prov = provenanceOf(raw);
        expect(prov).not.toBeNull();
        expect(prov!.text).toMatch(/deriv/i);
        expect(prov!.text).toMatch(/STE-429|reachable/i);
      });

      test("its provenance records the per-skill workspace it was captured in", () => {
        const prov = provenanceOf(readFileSync(reachableFixturePath(s), "utf8"));
        expect(prov).not.toBeNull();
        expect(prov!.projectRoot).not.toBeNull();
        const root = prov!.projectRoot!;
        expect(root.startsWith("/")).toBe(true);
        // Inside the guarded test project (AC.1), and per-skill.
        expect(root).toContain("dpt-test-project-");
        expect(root).toContain(s);
        expect(root).not.toMatch(/dpt-test-project-(?:linear|jira)\/?$/);
      });

      test("it renders ok-asked or ok-refused — a PASS is reachable", () => {
        const raw = readFileSync(reachableFixturePath(s), "utf8");
        const prov = provenanceOf(raw);
        expect(prov?.projectRoot).toBeTruthy();
        const transcript = transcriptOf(reachableFixturePath(s));
        expect(transcript.length).toBeGreaterThan(0);

        const verdict = verdictFor(s, transcript, {
          projectRoot: prov!.projectRoot!,
        });
        expect(verdict.exitCode).toBe(0);
        expect(verdict.line).toMatch(
          new RegExp(String.raw`^${s}: ok-(?:asked|refused) askIndex=\d+$`),
        );
        expect(verdict.line).not.toContain("vacuous");
        expect(verdict.line).not.toContain("violation");
      });

      test("the scoring entry is a real ask or refusal, not an empty transcript", () => {
        // Non-vacuity for the test above: `vacuous` also never says
        // "violation", so the pass must be anchored on a decisive entry.
        const raw = readFileSync(reachableFixturePath(s), "utf8");
        const prov = provenanceOf(raw);
        const transcript = transcriptOf(reachableFixturePath(s));
        const verdict = verdictFor(s, transcript, {
          projectRoot: prov!.projectRoot!,
        });
        const idx = Number(/askIndex=(-?\d+)/.exec(verdict.line)![1]);
        expect(idx).toBeGreaterThanOrEqual(0);
        const entry = transcript[idx];
        expect(entry).toBeDefined();
        const decisive =
          entry!.type === "refusal" ||
          (entry!.type === "tool_use" &&
            (entry!.name === "AskUserQuestion" ||
              entry!.name === "RequiresInputRefusedError"));
        expect(decisive).toBe(true);
      });
    });
  }

  test("the four fixtures record FOUR DISTINCT workspaces", () => {
    // The composition with AC.1: one shared prep would produce one shared root
    // and the two structurally-unreachable skills would still be unreachable.
    const roots = IN_SCOPE_SKILLS.map((s) => {
      const p = reachableFixturePath(s);
      return existsSync(p)
        ? provenanceOf(readFileSync(p, "utf8"))?.projectRoot
        : null;
    });
    expect(roots.every((r) => typeof r === "string" && r.length > 0)).toBe(true);
    expect(new Set(roots).size).toBe(IN_SCOPE_SKILLS.length);
  });

  test("the M116 verdict-table fixtures are untouched by this FR", () => {
    // Those reproducers record the BROKEN position's outcomes (setup:
    // violation, report-issue: vacuous) and are the evidence base for
    // m116-ste-422. AC.2's fixtures are additive, never a rewrite.
    const setup = join(REGRESSION_DIR, "setup-2026-07-27.json");
    const reportIssue = join(REGRESSION_DIR, "report-issue-2026-07-27.json");
    expect(existsSync(setup)).toBe(true);
    expect(existsSync(reportIssue)).toBe(true);
    expect(verdictFor("report-issue", transcriptOf(reportIssue)).exitCode).toBe(1);
    expect(verdictFor("setup", transcriptOf(setup)).line).toContain("violation");
  });
});

// ===========================================================================
// AC-STE-429.3 — vacuous is reported as INCONCLUSIVE, never aggregated as pass.
// ===========================================================================

D("AC-STE-429.3 — the documented exit-code mapping distinguishes vacuous", () => {
  test("Phase 8 prose documents runner exit 0 as a pass", () => {
    expect(documentedDispositions(0)).toEqual(["ok"]);
  });

  test("Phase 8 prose documents runner exit 1 as a violation", () => {
    expect(documentedDispositions(1)).toEqual(["violation"]);
  });

  test("Phase 8 prose documents runner exit 3 as INCONCLUSIVE", () => {
    // The defect, isolated. The runner has emitted exit 3 for `vacuous` since
    // STE-399; the driver prose collapses every non-zero exit into
    // `socratic_first_turn_contract_violation`, so the inconclusive state the
    // runner already computes never reaches the operator.
    expect(documentedDispositions(3)).toEqual(["inconclusive"]);
  });

  test("exit 3 is not documented as a violation and not as a pass", () => {
    const d = documentedDispositions(3);
    expect(d).not.toContain("violation");
    expect(d).not.toContain("ok");
  });

  test("no paragraph collapses 'non-zero' into a single bucket", () => {
    const prose = phase8Prose();
    expect(prose.length).toBeGreaterThan(500);
    const offenders = prose
      .split(/\n\n+/)
      .filter((p) => /non-zero/i.test(p))
      .filter((p) => !/inconclusive/i.test(p) && !/\b3\b/.test(p));
    expect(offenders).toEqual([]);
  });

  test("the inconclusive result NAMES the skill it belongs to", () => {
    expect(
      someParagraphMatches(phase8Prose(), [
        /inconclusive/i,
        /<skill>|names the skill|per-skill|per skill/i,
      ]),
    ).toBe(true);
  });

  test("an inconclusive skill is never folded into the aggregate pass", () => {
    expect(
      someParagraphMatches(phase8Prose(), [
        /inconclusive/i,
        /\bnot\b|\bnever\b|\bneither\b/i,
        /aggregate|summary|verdict|count/i,
      ]),
    ).toBe(true);
  });

  test("the composition with the three-outcome group vocabulary is explicit", () => {
    // STE-425 (sibling, same milestone) renders passed / failed / not-reached.
    // "Inconclusive" is this FR's vocabulary; where the two meet, the prose has
    // to say which side an inconclusive skill lands on — and it is not `passed`.
    expect(
      someParagraphMatches(phase8Prose(), [
        /inconclusive/i,
        /\bpass(?:ed|es)?\b/i,
        /\bnot\b|\bnever\b|\bneither\b/i,
      ]),
    ).toBe(true);
  });
});

describe("AC-STE-429.3 — the rendering case: a real vacuous verdict", () => {
  /** A transcript that never asks, never refuses, never scaffolds. */
  const VACUOUS: TranscriptEntry[] = [
    { type: "text" },
    { type: "tool_use", name: "Skill" },
    { type: "tool_use", name: "Bash" },
    { type: "text" },
  ];

  test("the runner already distinguishes vacuous with its own exit code", () => {
    const verdict = verdictFor("setup", VACUOUS);
    expect(verdict.exitCode).toBe(3);
    expect(verdict.line).toBe("setup: vacuous askIndex=-1");
    // Distinct from both neighbours — the information is there to be rendered.
    expect(verdict.exitCode).not.toBe(0);
    expect(verdict.exitCode).not.toBe(1);
  });

  test("the verdict line names the skill, which the rendering must carry through", () => {
    for (const s of IN_SCOPE_SKILLS) {
      expect(verdictFor(s, VACUOUS).line.startsWith(`${s}: `)).toBe(true);
    }
  });

  (skill === null ? test.skip : test)(
    "that exit code renders as inconclusive under the DOCUMENTED mapping",
    () => {
      // Not a tautology: the mapping is parsed out of the SKILL at test time,
      // exactly as m116-ste-422 replays fixtures through the SKILL's documented
      // invocation. Today the prose maps every non-zero exit to `violation`, so
      // this fails on the real runner output the driver will actually see.
      const verdict = verdictFor("setup", VACUOUS);
      expect(documentedDispositions(verdict.exitCode)).toEqual(["inconclusive"]);
    },
  );

  (skill === null ? test.skip : test)(
    "the recorded 2026-07-27 vacuous capture renders inconclusive too",
    () => {
      // The reality anchor: `/report-issue` really did score vacuous on the
      // measured leg once its out-of-project write was scoped away.
      const setupFixture = join(REGRESSION_DIR, "setup-2026-07-27.json");
      const reportIssue = join(REGRESSION_DIR, "report-issue-2026-07-27.json");
      expect(existsSync(setupFixture)).toBe(true);
      expect(existsSync(reportIssue)).toBe(true);

      // The captured project root, derived from committed bytes (never disk):
      // the /setup transcript's decisive in-project scaffold is <root>/CLAUDE.md.
      const claudeMd = transcriptOf(setupFixture).find(
        (e) =>
          e.type === "tool_use" &&
          typeof e.path === "string" &&
          basename(e.path) === "CLAUDE.md",
      );
      expect(claudeMd?.path).toBeDefined();
      const capturedRoot = dirname(claudeMd!.path!);

      const verdict = verdictFor("report-issue", transcriptOf(reportIssue), {
        projectRoot: capturedRoot,
      });
      expect(verdict.line).toBe("report-issue: vacuous askIndex=-1");
      expect(verdict.exitCode).toBe(3);
      expect(documentedDispositions(verdict.exitCode)).toEqual(["inconclusive"]);
    },
  );
});

// ===========================================================================
// AC-STE-429.4 — the preparation disturbs neither the chain project nor its
// captures.
// ===========================================================================

/**
 * The documented workspace path, rendered relative to the test-project root and
 * resolved for one concrete skill. Derived from the SKILL's own fence, so the
 * isolation simulation below cannot pass before the workspace is documented.
 */
function documentedWorkspaceSubpath(skillName: string): string | null {
  const ws = perSkillWorkspaceVar();
  if (!ws) return null;
  const m = /dpt-test-project-[^/]*\/(.+)$/.exec(ws.expanded);
  if (!m) return null;
  return m[1]!
    .replace(/\$\{?SKILL\}?/g, skillName)
    .replace(/\$\{TRACKER[^}]*\}|\$TRACKER/g, "linear")
    .replace(/\$\{?DATE\}?/g, "2026-07-27")
    .replace(/\$\{[^}]*\}|\$[A-Za-z_][A-Za-z0-9_]*/g, "x");
}

interface FileStamp {
  bytes: string;
  mtimeMs: number;
}

/** Every FILE under `root`, keyed by path relative to `root`. */
function snapshotFiles(root: string, prefix = ""): Map<string, FileStamp> {
  const out = new Map<string, FileStamp>();
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const abs = join(root, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      for (const [k, v] of snapshotFiles(abs, rel)) out.set(k, v);
    } else if (entry.isFile()) {
      out.set(rel, {
        bytes: readFileSync(abs, "utf8"),
        mtimeMs: statSync(abs).mtimeMs,
      });
    }
  }
  return out;
}

const CHAIN_CHILDREN = [
  "setup",
  "spec-write",
  "implement",
  "gate-check",
  "spec-review",
  "simplify",
] as const;

D("AC-STE-429.4 — preparing the workspace leaves the chain untouched", () => {
  const dirs: string[] = [];

  function sandbox(): string {
    const d = mkdtempSync(join(tmpdir(), "ste429-isolation-"));
    dirs.push(d);
    return d;
  }

  function cleanup() {
    for (const d of dirs.splice(0)) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    }
  }

  test("the documented workspace resolves to a safe relative subpath", () => {
    try {
      const sub = documentedWorkspaceSubpath("setup");
      expect(sub).not.toBeNull();
      expect(sub!.startsWith("/")).toBe(false);
      expect(sub!.split("/")).not.toContain("..");
      expect(sub!).not.toMatch(/[\s"']/);
      // Per-skill: the same template must render differently for two skills.
      expect(documentedWorkspaceSubpath("brainstorm")).not.toBe(sub);
    } finally {
      cleanup();
    }
  });

  test("neither the chain's verify-on-disk outputs nor its captures change", () => {
    try {
      const root = sandbox();
      const runStart = Date.now() - 5_000;

      // ── The chain's own test project, post-Phase-4 ──
      const project = join(root, "dpt-test-project-linear");
      mkdirSync(join(project, ".claude"), { recursive: true });
      mkdirSync(join(project, "specs", "frs"), { recursive: true });
      writeFileSync(join(project, "CLAUDE.md"), "# chain CLAUDE.md\n", "utf8");
      writeFileSync(
        join(project, ".claude", "settings.json"),
        '{"permissions":{"allow":["Bash(bun test:*)"]}}\n',
        "utf8",
      );
      writeFileSync(
        join(project, "specs", "frs", "STE-1.md"),
        "# chain FR\n",
        "utf8",
      );

      // ── The chain's per-skill captures (assertChainIntegrity's input) ──
      const logDir = join(root, "tmp");
      mkdirSync(logDir, { recursive: true });
      const expectations = CHAIN_CHILDREN.map((child) => ({
        child,
        path: join(logDir, `dpt-smoke-linear-${child}.log`),
      }));
      for (const { path } of expectations) {
        writeFileSync(
          path,
          '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"ok"}]}}\n' +
            '{"type":"result","subtype":"success"}\n',
          "utf8",
        );
      }

      expect(assertChainIntegrity(expectations, runStart)).toEqual([]);
      const projectBefore = snapshotFiles(project);
      const logsBefore = snapshotFiles(logDir);
      expect(projectBefore.size).toBe(3);
      expect(logsBefore.size).toBe(CHAIN_CHILDREN.length);

      // ── Simulate the DOCUMENTED per-skill preparation, all four skills ──
      const workspaces: string[] = [];
      for (const s of IN_SCOPE_SKILLS) {
        const sub = documentedWorkspaceSubpath(s);
        expect(sub).not.toBeNull();
        const ws = join(project, sub!);
        mkdirSync(ws, { recursive: true });
        // The child then does its thing in there (e.g. /setup scaffolding a
        // CLAUDE.md into an empty project).
        writeFileSync(join(ws, "CLAUDE.md"), `# ${s} scratch\n`, "utf8");
        workspaces.push(ws);
      }
      expect(new Set(workspaces).size).toBe(IN_SCOPE_SKILLS.length);

      // ── The workspace is neither the project root nor a capture path ──
      for (const ws of workspaces) {
        expect(ws).not.toBe(project);
        expect(ws.startsWith(`${project}/`)).toBe(true);
        for (const { path } of expectations) expect(ws).not.toBe(path);
      }

      // ── AC-STE-429.4: the chain's captures are untouched ──
      expect(assertChainIntegrity(expectations, runStart)).toEqual([]);
      expect(snapshotFiles(logDir)).toEqual(logsBefore);

      // ── …and so is every pre-existing file in its test project ──
      const projectAfter = snapshotFiles(project);
      for (const [rel, before] of projectBefore) {
        expect(projectAfter.get(rel)).toEqual(before);
      }
      // The ONLY new files live under the per-skill workspaces.
      const added = [...projectAfter.keys()].filter((k) => !projectBefore.has(k));
      expect(added.length).toBe(IN_SCOPE_SKILLS.length);
      for (const rel of added) {
        expect(
          workspaces.some((ws) => join(project, rel).startsWith(`${ws}/`)),
        ).toBe(true);
      }

      // ── Phase 5's existing `rm -rf` of the parent removes the scratch ──
      rmSync(project, { recursive: true, force: true });
      for (const ws of workspaces) expect(existsSync(ws)).toBe(false);
      expect(assertChainIntegrity(expectations, runStart)).toEqual([]);
    } finally {
      cleanup();
    }
  });

  test("the prose states the preparation cannot disturb the chain's verification", () => {
    expect(
      someParagraphMatches(phase8Prose(), [
        /Phase 4|verify-on-disk/i,
        /after|already/i,
        /workspace|scratch|prepar/i,
      ]),
    ).toBe(true);
  });

  test("the prose states the scratch is removed by Phase 5's existing teardown", () => {
    expect(
      someParagraphMatches(phase8Prose(), [
        /Phase 5|teardown|rm -rf/i,
        /workspace|scratch/i,
      ]),
    ).toBe(true);
  });

  test("the driver fence writes no chain-capture log path", () => {
    // The chain's captures live at `/tmp/dpt-smoke-<tracker>-<skill>.log`.
    // Phase 8 writes only its own fixture; a redirect into a chain log would
    // clobber the evidence Phase 2.Y's completeness check reads.
    const fence = driverFence();
    expect(fence.length).toBeGreaterThan(200);
    expect(fence).not.toMatch(/dpt-smoke-[^\s"']*\.log/);
  });
});

// ===========================================================================
// Phase-3 hardening — guards that were shipped but pinned by nothing.
//
// Two gaps the end-of-FR spec audit measured, both of the "green module
// nothing reaches" class this milestone exists to close:
//
//  1. The containment invariant and all three abort clauses in the Phase 8
//     fence could be deleted outright and this file still ran 57/57. A safety
//     guard no test protects is a guard the next reflow silently drops.
//     Pre-flight #6, by contrast, IS pinned (§ "sibling pins" above) — this
//     block brings the workspace guard up to the same standard.
//
//  2. `.phase8/<skill>/` is created INSIDE the test project, and the test
//     project is a git repo (Phase 1 step 3 runs `git init`). The sibling
//     transient-retry gate reads `git status --porcelain` in exactly that
//     directory and grades non-empty output `transient_dirty_tree — no
//     auto-retry`. Unfiltered, a leg killed by a transient during Phase 8 or
//     Phase 9 forfeits its one retry over the driver's OWN scratch. The
//     pathspec exclusion is therefore load-bearing in both drivers, and it is
//     the kind of cross-FR coupling that reads as tidiness and gets "cleaned
//     up" later — so it is pinned here with the reason attached.
// ===========================================================================

const LOOP_SKILL_PATH = join(
  REPO_ROOT,
  ".claude",
  "skills",
  "conformance-loop",
  "SKILL.md",
);
const loopSkill = readIfPresent(LOOP_SKILL_PATH);
const DL = skill === null || loopSkill === null ? describe.skip : describe;

D("Phase 3 hardening — the workspace containment guard is pinned", () => {
  test("the fence carries a containment invariant on WORKSPACE", () => {
    const fence = driverFence();
    expect(fence.length).toBeGreaterThan(200);
    // The guard compares WORKSPACE against the test-project root by prefix
    // strip. Assert the mechanism, not one spelling of it.
    expect(fence).toMatch(/\$\{WORKSPACE#\$?\{?TEST_PROJECT_DIR\}?\/?\}/);
  });

  test("the containment invariant aborts rather than falling through", () => {
    const fence = driverFence();
    const idx = fence.search(/\$\{WORKSPACE#/);
    expect(idx).toBeGreaterThan(-1);
    // The failure branch may be a one-liner (`|| exit 1`) or a brace block
    // spanning several lines (`|| { echo ABORT…; exit 1; }`), so read the
    // guard plus a bounded window after it rather than one line. The window
    // must stop before the workspace is actually created, or a `rm -rf` /
    // `mkdir` further down could satisfy the match by accident.
    const rest = fence.slice(idx);
    const createIdx = rest.search(/\brm -rf\s+"?\$\{WORKSPACE\}"?/);
    // The window MUST terminate at the workspace-creation line. A byte-count
    // fallback would run past it into the next guarded construct (the `cd
    // "${WORKSPACE}" || { … exit 1; }` below), so the test could pass on that
    // clause's ABORT instead of this guard's. Require the boundary to exist.
    expect(createIdx).toBeGreaterThan(-1);
    const window = rest.slice(0, createIdx);
    expect(window).toMatch(/exit 1/);
    expect(window).toMatch(/ABORT/);
  });

  test("every cd into the workspace is guarded, not bare", () => {
    const fence = driverFence();
    // A failed `cd` would leave the child spawning in the driver's own cwd —
    // the toolkit repo, the one directory the threat model's cwd guard exists
    // to keep children out of. Each `cd "${WORKSPACE}"` must carry a failure
    // branch on the same logical line.
    const cdLines = fence
      .split("\n")
      .filter((l) => /\bcd\s+"?\$\{WORKSPACE\}"?/.test(l));
    expect(cdLines.length).toBeGreaterThan(0);
    for (const line of cdLines) {
      expect(line).toMatch(/\|\||&&|exit 1|ABORT/);
    }
  });

  test("the driver's cwd is restored after the child, before the disposition", () => {
    const fence = driverFence();
    const restore = fence.search(/\bcd\s+"?\$\{PHASE8_CWD\}"?/);
    const runner = fence.search(/bun\s+"\$\{ASSERT_RUNNER\}"/);
    expect(restore).toBeGreaterThan(-1);
    expect(runner).toBeGreaterThan(-1);
    // Restore precedes the runner call, so neither the runner nor any
    // disposition arm executes from inside a per-skill workspace.
    expect(restore).toBeLessThan(runner);
  });
});

DL("Phase 3 hardening — the retry gate excludes Phase 8 scratch", () => {
  // The exclusion must hold in BOTH drivers: the smoke driver retries Phase 2
  // spawns (which precede Phase 8, so it is defence-in-depth there), while a
  // conformance LEG spans the whole run and can genuinely die during Phase 8.
  const gates: ReadonlyArray<readonly [string, string]> = [
    ["smoke-test", SKILL_TEXT],
    ["conformance-loop", loopSkill ?? ""],
  ];

  for (const [name, body] of gates) {
    test(`${name}: no porcelain probe reads the tree unfiltered`, () => {
      expect(body.length).toBeGreaterThan(200);
      const probes = body
        .split("\n")
        .filter((l) => l.includes("git status --porcelain"));
      expect(probes.length).toBeGreaterThan(0);

      // Every probe that DECIDES a retry must exclude `.phase8`. The closing
      // artifact-accounting check is a different question (it deliberately
      // reports everything the run created, including scratch), so scope this
      // to lines that are part of a retry decision: the ones that assign the
      // dirty-tree variable, or that annotate the retry authorization.
      const decisionProbes = probes.filter(
        (l) => /\bdirty=/.test(l) || /retry authorized/.test(l),
      );
      expect(decisionProbes.length).toBeGreaterThan(0);
      for (const probe of decisionProbes) {
        expect(probe).toContain(":(exclude).phase8");
      }
    });

    test(`${name}: states WHY the exclusion is load-bearing`, () => {
      // A bare pathspec reads as tidiness and gets removed. The reason has to
      // travel with it: driver scratch is not attempt output.
      const paras = body.split(/\n\n+/).filter((p) => p.includes(".phase8"));
      expect(paras.length).toBeGreaterThan(0);
      const justified = paras.some(
        (p) =>
          /scratch/i.test(p) &&
          /(attempt|leg)/i.test(p) &&
          /(retry|forfeit|dirty)/i.test(p),
      );
      expect(justified).toBe(true);
    });
  }
});

// ===========================================================================
// Phase-3 round-2 hardening — the aggregate guard's own conjuncts.
//
// Round 1 of review caught that runner exit 3 no longer failed the phase, so a
// rotation of four `vacuous` exited 0 — contradicting AC-STE-429.3's own words
// ("never folded into an aggregate pass") and `fixtureGroupsAggregate`, which
// grades a `not-reached` record `fail`. The fix added `[ "${INCONCLUSIVE}" -eq
// 0 ]` to the fence's final guard. Round 2 then caught that the fix itself was
// pinned by nothing: every other AC.3 assertion in this file reads PROSE, so
// deleting that one conjunct restored the defect with zero reds.
//
// The guard is the single line that decides whether Phase 8 can exit green, so
// each conjunct gets an assertion. Prose describing the rule is not the rule.
// ===========================================================================

D("Phase 3 round-2 hardening — the Phase 8 aggregate guard binds", () => {
  /** The fence's final `[ … ] || exit 1` guard line. */
  function aggregateGuard(): string {
    const fence = driverFence();
    const line = fence
      .split("\n")
      .find((l) => /\|\|\s*exit 1\s*$/.test(l) && l.includes("-eq"));
    return line ?? "";
  }

  test("the guard exists and is the fence's exit decision", () => {
    expect(aggregateGuard().length).toBeGreaterThan(0);
  });

  for (const counter of ["VIOLATIONS", "FAULTS", "INCONCLUSIVE"] as const) {
    test(`a non-zero ${counter} bars a green exit`, () => {
      const guard = aggregateGuard();
      expect(guard).toContain(`"\${${counter}}" -eq 0`);
    });
  }

  test("incomplete coverage bars a green exit", () => {
    // STE-428's gate computes COVERAGE_OK outside the sentinelled block; the
    // conjunct that makes it BIND lives here, so it is pinned here.
    expect(aggregateGuard()).toContain('"${COVERAGE_OK}" -eq 1');
  });

  test("the guard agrees with fixtureGroupsAggregate on inconclusive", () => {
    // The composition STE-429's prose promises: an inconclusive Phase 8 skill
    // maps to `not-reached`, and that record grades `fail`. If the fence let
    // inconclusives through, one run's evidence would read two ways.
    const guard = aggregateGuard();
    expect(guard).toContain('"${INCONCLUSIVE}" -eq 0');
    const prose = phase8Prose();
    expect(prose).toMatch(/not-reached/);
    expect(prose).toMatch(/never (be )?folded|never to `?passed|bars the aggregate/i);
  });
});
