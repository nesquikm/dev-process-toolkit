// M136 STE-528 — the skip-baseline capture has a caller that always fires.
//
// WHAT THIS FILE PINS, and why each leg is shaped the way it is.
//
//   AC.1  No production surface conditions the capture order on the presence of
//         a `branch_template:` key. The assertion is SCOPED — it locates every
//         capture order, computes the smallest enclosing markdown scope around
//         it, and asks whether THAT scope carries the key. A file-scoped scan
//         would pass the moment the words moved anywhere else in the file,
//         which is how a paragraph and its neighbour drift apart (the FR's own
//         Testing section says so). Measured today at
//         `skills/implement/SKILL.md:45`, whose 0.b″ bullet opens "if Schema L
//         carries `branch_template:`" and closes "Absent `branch_template:` ⇒
//         skip entirely" with the capture order standing between them.
//
//   AC.2  A SECOND and independent gate: `docs/implement-reference.md:77` opens
//         "On a successful `git checkout -b`, and only there". Predicate keyed
//         on a conditional OPENER within a bounded window ahead of the
//         `checkout -b` mention, so an order that merely names the checkout
//         positionally ("it stands ahead of the `git checkout -b`") is not an
//         offender while a gated one is. Both predicates get a self-check
//         against a synthetic sibling that must FAIL them — isolation is half a
//         test; a clause must also fail on the case it is supposed to reject.
//
//   AC.3  Parity. The two surfaces are corrected TOGETHER, and sensitivity to
//         EACH SIDE is proven by executed mutation over synthetic corrected
//         surfaces (`mutateInRegion` aborts loudly when its anchor is absent,
//         so a mutation that never applied cannot score as a pass). The real
//         files are then run through the same parity verdict.
//
//   AC.4  TWO HALVES, and they are not in the same state today.
//         (a) The entry point — `import.meta.main` in `capture_skip_baseline.ts`
//             — ALREADY SHIPPED, early, under STE-530. This leg is GREEN on
//             arrival and is recorded as already-landed rather than as new
//             work. It is still falsifiable: it RUNS the module as a command in
//             a throwaway project and reads the record back off disk, so
//             deleting the entry point reddens it.
//         (b) Both ordering surfaces order it as a RUNNABLE COMMAND FENCE. Red
//             today: both order a prose function call, which is what the
//             previous attempt shipped and what produced zero calls. Asserted
//             by EXECUTING the fence, not by matching its text.
//
//   AC.5  No argv position carries a skip count. ALREADY SHIPPED under STE-530
//         and GREEN on arrival; recorded as such. Falsifiable anyway, and
//         behaviourally: a deliberately wrong number is handed to the entry
//         point at every argv position it could occupy, and the record must
//         still carry the count DERIVED from the gate this run executed. A
//         second fixture with a different skip count proves the number is
//         derived rather than constant.
//
//   AC.6  The order stands in `/implement` Phase 1 step 0, BEFORE any branch
//         decision, and outside every conditional scope. "Unconditional" here
//         means the ORDER carries no `branch_template:` and no `checkout -b`
//         precondition — measured: the capture refuses unless HEAD is the sha
//         being captured and the tree is clean, and `/implement` runs on a
//         feature branch, so an order that always FIRES cannot mean a capture
//         that always RESULTS. What `/implement` owes is to attempt it and
//         report the actionable refusal, and that reading is pinned positively
//         rather than left to inference.
//
//   AC.7  THE LOAD-BEARING ONE. `/gate-check` on a clean trunk is the only path
//         that captures with NO operator initiative, and it already runs the
//         full suite. If it does not work, the whole ratchet is "refuses
//         helpfully" forever — a feature that never runs. Pinned hard: the
//         capture FIRES from the gate-check order on a clean trunk with no
//         operator step, asserted by reading the record OFF DISK; and it SKIPS
//         with a NAMED reason when off-trunk or dirty, never silently, with
//         nothing written on either refusing path.
//
//   AC.8  The order fires in a project that sets no `branch_template:`. The
//         fixture's `## Task Tracking` block is COPIED from this repository's
//         own CLAUDE.md and asserted byte-identical to it, because the defect
//         is precisely that the real block lacks the key and a hand-written
//         fixture is free to lack it for the wrong reason.
//
//   AC.9  The order fires when the current branch is already acceptable and no
//         checkout occurs. Asserted separately from AC.8 because the two gates
//         are independent: the fixture creates the branch itself, the shipped
//         `isCurrentBranchAcceptable` is called to prove the precondition
//         really holds, and HEAD + branch name are compared before and after
//         the run to prove no checkout happened during it.
//
//   AC.10 AC.8 and AC.9 are non-vacuous. Both read the record back OFF DISK
//         through one helper, and that helper is proven to REJECT a writer that
//         exits 0 while writing nothing — the exact failure mode this FR exists
//         to detect, run through the very code path AC.8/AC.9 are graded by.
//
// CARRIED GAP (STE-529), closed here rather than left to the next milestone.
// `deliver_stage_evidence.ts` accepts `skipNames?: readonly string[] | null` on
// the gate `CapturedRun` and forwards it to `evaluateSkipDelta`, but NO
// PRODUCTION CALLER SUPPLIES IT — verified zero hits across `adapters/`,
// `skills/` and `docs/` outside the declaration and the forward. Every real run
// therefore still makes a silently count-only comparison. That is the same
// "declared but nothing feeds it" shape this milestone exists to close, so the
// legs live here, in their own block, labelled as carried rather than as one of
// STE-528's ten ACs.
//
// A NOTE ON LINE CAPS, recorded here so a later run does not discover it.
//   * `skills/implement/SKILL.md` is 354 lines; its cap is the global NFR-1 358
//     (`tests/skill-nfr-1-length.test.ts`) ⇒ 4 lines of headroom.
//   * `skills/gate-check/SKILL.md` is 351 lines and carries a TIGHTER pin of
//     354 in `tests/m108-ste-393-docs-pins.test.ts` ⇒ 3 lines of headroom.
// A fenced command block costs 3 lines bare and 5 in a list context. Neither
// file can absorb one without giving lines back somewhere else — the
// deconditioning frees INLINE bytes in `/implement`'s 0.b″ bullet, not whole
// lines. Both caps are pinned below at their real values so the collision
// surfaces at the point of work rather than in a later gate run.

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
import { join, relative } from "node:path";

import { isCurrentBranchAcceptable } from "../adapters/_shared/src/branch_proposal";
import { skipBaselinePath } from "../adapters/_shared/src/dpt_paths";
import { mutateInRegion } from "./_sited-mutation";

// ===========================================================================
// Paths.
// ===========================================================================

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const SKILLS_DIR = join(PLUGIN_ROOT, "skills");
const DOCS_DIR = join(PLUGIN_ROOT, "docs");
const SHARED_SRC = join(PLUGIN_ROOT, "adapters", "_shared", "src");

const IMPLEMENT_SKILL = join(SKILLS_DIR, "implement", "SKILL.md");
const IMPLEMENT_REFERENCE = join(DOCS_DIR, "implement-reference.md");
const GATE_CHECK_SKILL = join(SKILLS_DIR, "gate-check", "SKILL.md");
const CAPTURE_MODULE = join(SHARED_SRC, "capture_skip_baseline.ts");
const EVIDENCE_MODULE = join(SHARED_SRC, "deliver_stage_evidence.ts");
const REPO_CLAUDE_MD = join(REPO_ROOT, "CLAUDE.md");

const read = (p: string): string => readFileSync(p, "utf-8");
const rel = (p: string): string => relative(PLUGIN_ROOT, p);

// ===========================================================================
// Markdown scoping — the smallest enclosing scope around a line.
//
// A file-scoped assertion passes the moment the words appear anywhere, which is
// how a paragraph and its neighbour drift apart. Every deconditioning leg below
// is scoped through this.
// ===========================================================================

const LIST_ITEM = /^(\s*)(?:[-*+]\s|\d+\.\s)/;
const HEADING = /^#{1,6}\s/;

function itemIndent(line: string): number | null {
  const hit = LIST_ITEM.exec(line);
  return hit === null ? null : (hit[1] as string).length;
}

interface Scope {
  readonly startLine: number;
  readonly endLine: number;
  readonly text: string;
}

/**
 * The smallest markdown scope containing `lineIdx`: the list item it belongs to
 * (up to the next item at the same or shallower indent), or, when the line is
 * not inside a list item, the section under its nearest preceding heading.
 */
function enclosingScope(body: string, lineIdx: number): Scope {
  const rows = body.split("\n");
  let start = lineIdx;
  while (
    start > 0 &&
    itemIndent(rows[start] as string) === null &&
    !HEADING.test(rows[start] as string)
  ) {
    start -= 1;
  }
  const baseIndent = itemIndent(rows[start] as string);

  let end = start + 1;
  for (; end < rows.length; end += 1) {
    const row = rows[end] as string;
    if (HEADING.test(row)) break;
    const indent = itemIndent(row);
    if (indent === null) continue;
    if (baseIndent === null) break;
    if (indent <= baseIndent) break;
  }

  return { startLine: start, endLine: end, text: rows.slice(start, end).join("\n") };
}

// ===========================================================================
// Capture-order detection.
//
// A line ORDERS the capture when it names the module or the function by name.
// `docs/layout-reference.md`'s directory tree mentions `skip-baseline.json`,
// which is the STORE and not an order, and is correctly not matched here.
// ===========================================================================

const ORDER_TOKENS = ["captureSkipBaseline", "capture_skip_baseline"] as const;

function orderLineIndices(body: string): number[] {
  const hits: number[] = [];
  body.split("\n").forEach((row, idx) => {
    if (ORDER_TOKENS.some((token) => row.includes(token))) hits.push(idx);
  });
  return hits;
}

/** Distinct enclosing scopes holding at least one capture order. */
function orderScopes(body: string): Scope[] {
  const seen = new Set<number>();
  const scopes: Scope[] = [];
  for (const idx of orderLineIndices(body)) {
    const scope = enclosingScope(body, idx);
    if (seen.has(scope.startLine)) continue;
    seen.add(scope.startLine);
    scopes.push(scope);
  }
  return scopes;
}

// ===========================================================================
// The two deconditioning predicates, plus the sibling each must reject.
// ===========================================================================

interface Offender {
  readonly startLine: number;
  readonly why: string;
}

const BRANCH_TEMPLATE_KEY = "branch_template:";

/** Capture orders standing inside a scope that carries `branch_template:`. */
function branchTemplateConditioned(body: string): Offender[] {
  return orderScopes(body)
    .filter((scope) => scope.text.includes(BRANCH_TEMPLATE_KEY))
    .map((scope) => ({
      startLine: scope.startLine + 1,
      why: `the capture order stands inside a scope carrying \`${BRANCH_TEMPLATE_KEY}\``,
    }));
}

/** Words that turn a mention of the checkout into a condition ON the capture. */
const CONDITIONAL_OPENER = /\b(if|when|only|upon|after|immediately|successful)\b/i;
const OPENER_WINDOW = 80;

/** Capture orders standing inside a scope that GATES them on `git checkout -b`. */
function checkoutConditioned(body: string): Offender[] {
  const offenders: Offender[] = [];
  for (const scope of orderScopes(body)) {
    const pattern = /checkout -b/g;
    let hit = pattern.exec(scope.text);
    while (hit !== null) {
      const before = scope.text.slice(Math.max(0, hit.index - OPENER_WINDOW), hit.index);
      if (CONDITIONAL_OPENER.test(before)) {
        offenders.push({
          startLine: scope.startLine + 1,
          why:
            `the capture order stands inside a scope gating it on \`git checkout -b\`: ` +
            `…${before.trim().slice(-60)}[checkout -b]…`,
        });
        break;
      }
      hit = pattern.exec(scope.text);
    }
  }
  return offenders;
}

// ===========================================================================
// Production surfaces — every shipped skill and doc, not a hand-listed pair.
// ===========================================================================

function markdownFilesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.endsWith(".md")) out.push(full);
    }
  };
  walk(dir);
  return out;
}

function productionSurfaces(): string[] {
  return [...markdownFilesUnder(SKILLS_DIR), ...markdownFilesUnder(DOCS_DIR)].filter((file) =>
    orderLineIndices(read(file)).length > 0,
  );
}

// ===========================================================================
// Fenced-command extraction and placeholder resolution.
//
// A shipped markdown fence cannot carry an absolute path, so a CLOSED and NAMED
// substitution table stands between extraction and execution. Anything left
// unresolved is a loud failure, never a silently-run mangled command.
// ===========================================================================

function fencedCommands(text: string): string[] {
  const out: string[] = [];
  let inside = false;
  let buffer: string[] = [];
  for (const row of text.split("\n")) {
    if (row.trim().startsWith("```")) {
      if (inside) {
        out.push(buffer.join("\n").trim());
        buffer = [];
      }
      inside = !inside;
      continue;
    }
    if (inside) buffer.push(row.trim());
  }
  return out.filter((command) => command.length > 0);
}

const SUBSTITUTIONS: ReadonlyArray<readonly [RegExp, "plugin" | "root"]> = [
  [/\$\{CLAUDE_PLUGIN_ROOT\}/g, "plugin"],
  [/\$CLAUDE_PLUGIN_ROOT\b/g, "plugin"],
  [/<projectRoot>/g, "root"],
  [/<project-root>/g, "root"],
  [/<repoRoot>/g, "root"],
  [/<repo-root>/g, "root"],
];

function resolvePlaceholders(command: string, projectRoot: string): string {
  let resolved = command;
  for (const [pattern, kind] of SUBSTITUTIONS) {
    resolved = resolved.replace(pattern, kind === "plugin" ? PLUGIN_ROOT : projectRoot);
  }
  return resolved;
}

/**
 * The single runnable capture command a surface orders.
 *
 * Throws — loudly, naming the file — when the surface orders no capture at all,
 * orders it only in prose, or orders more than one command in the same scope.
 * Each of those is a distinct failure with a distinct remedy and none may be
 * papered over into "no command found".
 */
function orderedCaptureCommand(file: string): string {
  const body = read(file);
  const scopes = orderScopes(body);
  if (scopes.length === 0) {
    throw new Error(`${rel(file)} carries NO capture order at all (AC-STE-528.4 / .7)`);
  }
  const commands = scopes
    .flatMap((scope) => fencedCommands(scope.text))
    .filter((command) => command.includes("capture_skip_baseline"));
  if (commands.length === 0) {
    throw new Error(
      `${rel(file)} orders the capture in PROSE only — no fenced command naming ` +
        `capture_skip_baseline stands in the ordering scope (AC-STE-528.4)`,
    );
  }
  if (commands.length > 1) {
    throw new Error(
      `${rel(file)} orders ${commands.length} capture commands; exactly one is the order: ` +
        JSON.stringify(commands),
    );
  }
  return commands[0] as string;
}

// ===========================================================================
// Fixture projects and the disk read-back.
// ===========================================================================

const TEMP_DIRS: string[] = [];

function tempDir(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `ste528-${label}-`));
  TEMP_DIRS.push(dir);
  return dir;
}

function gitIn(cwd: string, args: string[]): number {
  const proc = Bun.spawnSync(["git", "-c", "user.email=t@t.test", "-c", "user.name=t", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  return proc.exitCode;
}

function gitOut(cwd: string, args: string[]): string {
  const proc = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "pipe" });
  return proc.stdout.toString().trim();
}

interface FixtureOptions {
  /** How many `test.skip` cases the fixture's suite carries. */
  readonly skips?: number;
  /** A branch to create off the initial trunk commit, with nothing committed on it. */
  readonly branch?: string;
  /** Leave an uncommitted file behind, so the tree is dirty. */
  readonly dirty?: boolean;
  /** Land a commit on `branch`, so HEAD stops being the trunk commit. */
  readonly commitAhead?: boolean;
  /** CLAUDE.md bytes; defaults to this repository's own file. */
  readonly claudeMd?: string;
}

/**
 * A throwaway PROJECT the order can be driven against: a real git repository
 * standing on `main`, a genuinely runnable suite with a known skip count, and
 * `.dpt/` git-ignored exactly as a `/setup`-bootstrapped tree ignores it.
 *
 * The ignore is load-bearing and was measured: the capture writes
 * `.dpt/ledger/checkout-id`, so a fixture that tracks `.dpt/` is DIRTY from its
 * own first capture onward and every later run refuses on the artifact of the
 * earlier one.
 */
function makeFixtureProject(label: string, options: FixtureOptions = {}): string {
  const root = tempDir(`fixture-${label}`);
  const skips = options.skips ?? 2;

  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify({ name: `ste528-${label}`, private: true }, null, 2)}\n`,
  );
  writeFileSync(join(root, ".gitignore"), ".dpt/\nnode_modules/\n");
  mkdirSync(join(root, "tests"), { recursive: true });
  writeFileSync(
    join(root, "tests", "fixture.test.ts"),
    [
      'import { expect, test } from "bun:test";',
      "",
      'test("the fixture suite carries one real assertion", () => {',
      "  expect(1 + 1).toBe(2);",
      "});",
      ...Array.from({ length: skips }, (_unused, index) =>
        [
          "",
          `test.skip("deliberately skipped case ${index + 1}", () => {`,
          "  expect(1).toBe(1);",
          "});",
        ].join("\n"),
      ),
      "",
    ].join("\n"),
  );
  writeFileSync(join(root, "CLAUDE.md"), options.claudeMd ?? read(REPO_CLAUDE_MD));

  gitIn(root, ["init", "-q", "-b", "main"]);
  gitIn(root, ["add", "-A"]);
  gitIn(root, ["commit", "-q", "-m", "chore: fixture"]);

  if (options.branch !== undefined) {
    gitIn(root, ["checkout", "-q", "-b", options.branch]);
  }
  if (options.commitAhead === true) {
    writeFileSync(join(root, "ahead.txt"), "ahead\n");
    gitIn(root, ["add", "-A"]);
    gitIn(root, ["commit", "-q", "-m", "chore: ahead of trunk"]);
  }
  if (options.dirty === true) {
    writeFileSync(join(root, "uncommitted.txt"), "dirt\n");
  }

  return root;
}

interface BaselineRecord {
  readonly sha: string;
  readonly skipped: number;
  readonly names?: readonly string[];
  readonly namesSource?: string;
}

/**
 * The baseline record standing in `projectRoot`, READ BACK OFF DISK — or `null`
 * when nothing was written.
 *
 * AC-STE-528.10 lives here. Nothing above this function may grade a run by an
 * exit code or a return value: a capture path that reports success while
 * writing nothing is the failure mode this FR exists to detect, and it must not
 * be able to satisfy its own test.
 */
function baselineRecordOnDisk(projectRoot: string): BaselineRecord | null {
  const store = skipBaselinePath(projectRoot);
  if (!existsSync(store)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(read(store));
  } catch {
    return null;
  }
  const baselines = (parsed as { baselines?: Record<string, unknown> } | null)?.baselines;
  if (baselines === undefined || baselines === null) return null;
  for (const value of Object.values(baselines)) {
    const record = value as BaselineRecord | null;
    if (record !== null && typeof record === "object" && typeof record.skipped === "number") {
      return record;
    }
  }
  return null;
}

interface DriveOutcome {
  readonly command: string;
  readonly exitCode: number;
  readonly output: string;
  /** The record ON DISK afterwards — the only thing any leg below grades on. */
  readonly record: BaselineRecord | null;
}

/** Run a command inside a fixture and report what landed on disk. */
function drive(command: string, projectRoot: string): DriveOutcome {
  const resolved = resolvePlaceholders(command, projectRoot);
  const unresolved = resolved.match(/\$\{[^}]*\}|<[a-zA-Z][a-zA-Z-]*>/g);
  if (unresolved !== null) {
    throw new Error(
      `the ordered command carries placeholders outside the closed substitution table ` +
        `(${unresolved.join(", ")}): ${JSON.stringify(resolved)}`,
    );
  }
  const proc = Bun.spawnSync(["/bin/sh", "-c", resolved], {
    cwd: projectRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    command: resolved,
    exitCode: proc.exitCode,
    output: `${proc.stdout.toString()}\n${proc.stderr.toString()}`.trim(),
    record: baselineRecordOnDisk(projectRoot),
  };
}

// ===========================================================================
// AC-STE-528.1 — nothing conditions the capture on `branch_template:`.
// ===========================================================================

describe("AC-STE-528.1 — no production surface gates the capture on `branch_template:`", () => {
  test("the predicate discriminates: it flags a gated scope and clears its sibling", () => {
    const gated = [
      "   - **0.b″ Branch proposal** — if Schema L carries `branch_template:`, propose a branch.",
      "     **Skip baseline capture:** call `captureSkipBaseline(projectRoot, branch, count)`.",
      "     Absent `branch_template:` ⇒ skip entirely.",
      "   - **0.c Claim** — entry gate.",
    ].join("\n");
    const clear = [
      "   - **0 Skip baseline capture** — order the capture for the trunk commit.",
      "     Run `capture_skip_baseline.ts`; report the refusal by name when it declines.",
      "   - **0.c Claim** — entry gate.",
    ].join("\n");

    expect(branchTemplateConditioned(gated).length, "a gated scope must be flagged").toBe(1);
    expect(
      branchTemplateConditioned(clear),
      "an ungated scope must NOT be flagged — otherwise the predicate is a constant",
    ).toEqual([]);
  });

  test("no shipped skill or doc stands a capture order inside a `branch_template:` scope", () => {
    const offenders = productionSurfaces().flatMap((file) =>
      branchTemplateConditioned(read(file)).map((o) => `${rel(file)}:${o.startLine} — ${o.why}`),
    );
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  test("`/implement`'s capture-order scope no longer carries the absent-key skip sentence", () => {
    const body = read(IMPLEMENT_SKILL);
    const scopes = orderScopes(body);
    expect(scopes.length, "skills/implement/SKILL.md must still order the capture").toBeGreaterThan(
      0,
    );
    for (const scope of scopes) {
      expect(
        scope.text,
        `the scope at skills/implement/SKILL.md:${scope.startLine + 1} still skips on the absent key`,
      ).not.toContain("Absent `branch_template:` ⇒ skip entirely");
    }
  });
});

// ===========================================================================
// AC-STE-528.2 — nothing conditions the capture on a successful `checkout -b`.
// ===========================================================================

describe("AC-STE-528.2 — no production surface gates the capture on `git checkout -b`", () => {
  test("the predicate discriminates: a gated mention is flagged, a positional one is not", () => {
    const gated = [
      "### Skip baseline capture",
      "",
      "6.b On a successful `git checkout -b`, and only there, call " +
        "`captureSkipBaseline(projectRoot, branch, count)` from `adapters/_shared/src/skip_baseline.ts`.",
      "",
      "### Failure handling",
    ].join("\n");
    const positional = [
      "### Skip baseline capture",
      "",
      "6.b Order the capture. It stands ahead of the `git checkout -b` in step 6, so nothing " +
        "gates it; run `capture_skip_baseline.ts` and report the refusal by name.",
      "",
      "### Failure handling",
    ].join("\n");

    expect(checkoutConditioned(gated).length, "a gated mention must be flagged").toBe(1);
    expect(
      checkoutConditioned(positional),
      "a positional mention must NOT be flagged — otherwise the predicate is a constant",
    ).toEqual([]);
  });

  test("no shipped skill or doc gates a capture order on a successful checkout", () => {
    const offenders = productionSurfaces().flatMap((file) =>
      checkoutConditioned(read(file)).map((o) => `${rel(file)}:${o.startLine} — ${o.why}`),
    );
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  test("the two gates are INDEPENDENT — each fires on its own measured surface today", () => {
    // Not a claim about the fixed state: a claim about the defect's shape, held
    // against synthetic copies of each shipped sentence so it stays true after
    // both are corrected. Closing one leaves the other standing.
    const branchTemplateOnly = [
      "   - **0.b″ Branch proposal** — if Schema L carries `branch_template:`, propose a branch.",
      "     Call `captureSkipBaseline(projectRoot, branch, count)`.",
      "   - **0.c Claim**",
    ].join("\n");
    const checkoutOnly = [
      "### Skip baseline capture",
      "",
      "6.b On a successful `git checkout -b`, and only there, call `captureSkipBaseline(...)`.",
      "",
      "### Failure handling",
    ].join("\n");

    expect(branchTemplateConditioned(branchTemplateOnly).length).toBe(1);
    expect(checkoutConditioned(branchTemplateOnly)).toEqual([]);
    expect(checkoutConditioned(checkoutOnly).length).toBe(1);
    expect(branchTemplateConditioned(checkoutOnly)).toEqual([]);
  });
});

// ===========================================================================
// AC-STE-528.3 — the two surfaces are corrected TOGETHER, parity asserted.
// ===========================================================================

/** Every offender across both surfaces, tagged by which surface produced it. */
function parityOffenders(implementBody: string, referenceBody: string): string[] {
  const sides: ReadonlyArray<readonly [string, string]> = [
    ["skills/implement/SKILL.md", implementBody],
    ["docs/implement-reference.md", referenceBody],
  ];
  return sides.flatMap(([name, body]) =>
    [...branchTemplateConditioned(body), ...checkoutConditioned(body)].map(
      (o) => `${name}:${o.startLine} — ${o.why}`,
    ),
  );
}

const CORRECTED_IMPLEMENT = [
  "0. **Tracker-mode probes** — Before any other action:",
  "",
  "   - **0.a Skip baseline capture** — order the capture for the trunk commit, before any",
  "     branch decision is made. Run it; when it declines, report the named reason verbatim.",
  "",
  "     ```sh",
  "     bun run ${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/capture_skip_baseline.ts <projectRoot>",
  "     ```",
  "",
  "   - **0.c Claim** — entry gate.",
].join("\n");

const CORRECTED_REFERENCE = [
  "### Skip baseline capture",
  "",
  "6.a Order the capture for the trunk commit. Report the named refusal when it declines.",
  "",
  "```sh",
  "bun run ${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/capture_skip_baseline.ts <projectRoot>",
  "```",
  "",
  "### Failure handling",
].join("\n");

describe("AC-STE-528.3 — parity: deleting the change from EITHER surface reddens", () => {
  test("the parity verdict is clean on two corrected surfaces (the control)", () => {
    expect(parityOffenders(CORRECTED_IMPLEMENT, CORRECTED_REFERENCE)).toEqual([]);
  });

  test("MUTATION — restoring the `branch_template:` gate on the SKILL side alone reddens", () => {
    const anchor = "order the capture for the trunk commit, before any";
    const mutant = mutateInRegion(
      CORRECTED_IMPLEMENT,
      0,
      CORRECTED_IMPLEMENT.length,
      anchor,
      "if Schema L carries `branch_template:`, order the capture; absent it, before any",
      { label: "the corrected /implement step-0 order" },
    );
    const offenders = parityOffenders(mutant, CORRECTED_REFERENCE);
    expect(offenders.length, "the SKILL-side mutation must be caught").toBeGreaterThan(0);
    expect(offenders.join("\n")).toContain("skills/implement/SKILL.md");
    expect(
      offenders.join("\n"),
      "the doc side is untouched and must not be reported",
    ).not.toContain("docs/implement-reference.md");
  });

  test("MUTATION — restoring the `checkout -b` gate on the DOC side alone reddens", () => {
    const anchor = "6.a Order the capture for the trunk commit.";
    const mutant = mutateInRegion(
      CORRECTED_REFERENCE,
      0,
      CORRECTED_REFERENCE.length,
      anchor,
      "6.b On a successful `git checkout -b`, and only there, order the capture.",
      { label: "the corrected implement-reference order" },
    );
    const offenders = parityOffenders(CORRECTED_IMPLEMENT, mutant);
    expect(offenders.length, "the DOC-side mutation must be caught").toBeGreaterThan(0);
    expect(offenders.join("\n")).toContain("docs/implement-reference.md");
    expect(
      offenders.join("\n"),
      "the skill side is untouched and must not be reported",
    ).not.toContain("skills/implement/SKILL.md");
  });

  test("the two SHIPPED surfaces are both clean", () => {
    const offenders = parityOffenders(read(IMPLEMENT_SKILL), read(IMPLEMENT_REFERENCE));
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});

// ===========================================================================
// AC-STE-528.4 — a command-line entry point, ordered as a runnable fence.
//
// HALF (a) ALREADY SHIPPED under STE-530 and is GREEN on arrival. It is pinned
// falsifiably anyway: deleting the `import.meta.main` block reddens it.
// ===========================================================================

describe("AC-STE-528.4 — the capture carries a command-line entry point", () => {
  test("ALREADY LANDED (STE-530) — the module declares a top-level `import.meta.main` block", () => {
    const source = read(CAPTURE_MODULE);
    expect(source, `${rel(CAPTURE_MODULE)} carries no import.meta.main entry point`).toMatch(
      /^if \(import\.meta\.main\) \{/m,
    );
  });

  test("ALREADY LANDED (STE-530) — running the module as a command writes a record to disk", () => {
    const root = makeFixtureProject("entrypoint");
    const outcome = drive(`bun run "${CAPTURE_MODULE}" "${root}"`, root);
    expect(outcome.record, `no record on disk; the run said:\n${outcome.output}`).not.toBeNull();
    expect(outcome.record?.skipped).toBe(2);
    expect(outcome.exitCode).toBe(0);
  });
});

describe("AC-STE-528.4 — both ordering surfaces order a RUNNABLE COMMAND FENCE", () => {
  const surfaces: ReadonlyArray<readonly [string, string]> = [
    ["skills/implement/SKILL.md", IMPLEMENT_SKILL],
    ["docs/implement-reference.md", IMPLEMENT_REFERENCE],
  ];

  for (const [name, file] of surfaces) {
    test(`${name} orders exactly one fenced capture command`, () => {
      const command = orderedCaptureCommand(file);
      expect(command).toContain("capture_skip_baseline");
      expect(command, "the order must be a command, not a function call").not.toMatch(
        /captureSkipBaseline\s*\(/,
      );
    });

    test(`${name}'s ordered command EXECUTES and produces a record`, () => {
      const command = orderedCaptureCommand(file);
      const root = makeFixtureProject(`fence-${name.replace(/[^a-z]+/gi, "-")}`);
      const outcome = drive(command, root);
      expect(
        outcome.record,
        `\`${outcome.command}\` exited ${outcome.exitCode} and wrote NO record:\n${outcome.output}`,
      ).not.toBeNull();
    });
  }
});

// ===========================================================================
// AC-STE-528.5 — no argv position carries a skip count.
//
// ALREADY SHIPPED under STE-530; GREEN on arrival, pinned falsifiably.
// ===========================================================================

describe("AC-STE-528.5 — the count is DERIVED, never accepted from argv", () => {
  test("ALREADY LANDED (STE-530) — the module reads no argv position past the project root", () => {
    const source = read(CAPTURE_MODULE);
    expect(source, "the entry point must read argv[2] as the project root").toContain(
      "process.argv[2]",
    );
    expect(
      source.match(/process\.argv\[(3|4|5)\]/g),
      "no argv position past the project root may be read — that is where a count would enter",
    ).toBeNull();
  });

  test("ALREADY LANDED (STE-530) — a wrong number handed in at argv[3] does not reach the store", () => {
    const root = makeFixtureProject("argv-count", { skips: 2 });
    const outcome = drive(`bun run "${CAPTURE_MODULE}" "${root}" 999`, root);
    expect(outcome.record, `no record on disk:\n${outcome.output}`).not.toBeNull();
    expect(
      outcome.record?.skipped,
      "the hand-typed 999 must not be what landed",
    ).not.toBe(999);
    expect(
      outcome.record?.skipped,
      "the derived count must be the fixture's real skip count",
    ).toBe(2);
  });

  test("ALREADY LANDED (STE-530) — argv[2] is a project root, so a count there refuses", () => {
    const root = makeFixtureProject("argv-root-count");
    const outcome = drive(`bun run "${CAPTURE_MODULE}" 999 || true`, root);
    expect(
      outcome.record,
      "a bare number in the root position must not be read as a count",
    ).toBeNull();
    expect(outcome.output.length, "the refusal must not be silent").toBeGreaterThan(0);
  });

  test("ALREADY LANDED (STE-530) — the number tracks the tree, so it is measured not constant", () => {
    const three = makeFixtureProject("derive-three", { skips: 3 });
    const outcome = drive(`bun run "${CAPTURE_MODULE}" "${three}"`, three);
    expect(outcome.record, `no record on disk:\n${outcome.output}`).not.toBeNull();
    expect(outcome.record?.skipped, "a different tree must yield a different count").toBe(3);
  });

  test("ALREADY LANDED (STE-530) — the count comes through the shipped `parseTestOutput`", () => {
    const source = read(CAPTURE_MODULE);
    expect(source).toMatch(/import \{[^}]*parseTestOutput[^}]*\} from "\.\/test_count_parser"/);
    expect(source).toMatch(/parseTestOutput\(/);
  });
});

// ===========================================================================
// AC-STE-528.6 — `/implement` Phase 1 step 0 orders it unconditionally.
// ===========================================================================

describe("AC-STE-528.6 — the order stands in step 0, before any branch decision", () => {
  function lineIndexOf(body: string, pattern: RegExp): number {
    const rows = body.split("\n");
    const idx = rows.findIndex((row) => pattern.test(row));
    expect(idx, `no line matching ${pattern} in skills/implement/SKILL.md`).toBeGreaterThanOrEqual(
      0,
    );
    return idx;
  }

  test("the capture order precedes the branch-proposal step in the file", () => {
    const body = read(IMPLEMENT_SKILL);
    const orders = orderLineIndices(body);
    expect(orders.length, "skills/implement/SKILL.md must order the capture").toBeGreaterThan(0);
    const branchProposal = lineIndexOf(body, /Branch proposal\*\*/);
    const first = Math.min(...orders);
    expect(
      first,
      `the capture order stands at line ${first + 1}, AFTER the branch proposal at ` +
        `line ${branchProposal + 1} — a branch decision is made before the capture is ordered`,
    ).toBeLessThan(branchProposal);
  });

  test("the order stands inside the Phase 1 step-0 block", () => {
    const body = read(IMPLEMENT_SKILL);
    const stepZero = lineIndexOf(body, /^0\. \*\*Tracker-mode probes\*\*/);
    const stepOne = lineIndexOf(body, /^1\. \*\*Check for specs\*\*/);
    const first = Math.min(...orderLineIndices(body));
    expect(first).toBeGreaterThan(stepZero);
    expect(first).toBeLessThan(stepOne);
  });

  test("the order's own scope carries NO conditional gate of any kind", () => {
    const body = read(IMPLEMENT_SKILL);
    const forbidden: ReadonlyArray<readonly [string, RegExp]> = [
      ["the `branch_template:` key", /branch_template:/],
      ["a checkout precondition", /checkout -b/],
      ["a skip directive", /⇒ skip|skip entirely|and only there/i],
    ];
    for (const scope of orderScopes(body)) {
      for (const [what, pattern] of forbidden) {
        expect(
          pattern.test(scope.text),
          `the capture-order scope at skills/implement/SKILL.md:${scope.startLine + 1} carries ` +
            `${what}, so the order is conditional`,
        ).toBe(false);
      }
    }
  });

  test("the order states the ATTEMPT-AND-REPORT duty, not an unconditional success", () => {
    // Measured: the capture refuses unless HEAD is the sha being captured and
    // the tree is clean, and `/implement` runs on a feature branch. So an order
    // that always FIRES cannot mean a capture that always RESULTS; what the
    // skill owes is the attempt plus the actionable refusal, reported by name.
    const scopes = orderScopes(read(IMPLEMENT_SKILL));
    const text = scopes.map((scope) => scope.text).join("\n");
    expect(text, "the order must name what happens when the capture declines").toMatch(
      /refus|declin/i,
    );
    expect(text, "the refusal must be reported, not swallowed").toMatch(
      /report|surface|relay|print/i,
    );
  });

  test("skills/implement/SKILL.md stays within the NFR-1 line cap (358)", () => {
    // HEADROOM RECORDED: 354 today, cap 358. Deconditioning frees INLINE bytes
    // in the 0.b″ bullet, not whole lines, while a fenced command block costs 5
    // in a list context. Lines must be given back elsewhere in this file — most
    // plausibly to `docs/implement-reference.md`, which has no cap pin.
    expect(read(IMPLEMENT_SKILL).split("\n").length).toBeLessThanOrEqual(358);
  });
});

// ===========================================================================
// AC-STE-528.7 — `/gate-check` captures on a clean trunk, names its skips.
//
// THE LOAD-BEARING AC. `/gate-check` on a clean trunk is the only path that
// captures with NO operator initiative, and it already runs the full suite.
// ===========================================================================

describe("AC-STE-528.7 — `/gate-check` orders the capture on a clean trunk", () => {
  test("skills/gate-check/SKILL.md orders the capture at all", () => {
    const scopes = orderScopes(read(GATE_CHECK_SKILL));
    expect(
      scopes.length,
      "skills/gate-check/SKILL.md carries NO capture order — the only no-operator-initiative " +
        "capture path does not exist, so the ratchet's write side still never fires",
    ).toBeGreaterThan(0);
  });

  test("its order is a runnable fenced command", () => {
    const command = orderedCaptureCommand(GATE_CHECK_SKILL);
    expect(command).toContain("capture_skip_baseline");
  });

  test("FIRES: a clean trunk checkout captures with no operator step, read back OFF DISK", () => {
    const command = orderedCaptureCommand(GATE_CHECK_SKILL);
    const root = makeFixtureProject("gate-clean-trunk");
    expect(gitOut(root, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe("main");
    expect(gitOut(root, ["status", "--porcelain"]), "the fixture must start clean").toBe("");

    const outcome = drive(command, root);
    expect(
      outcome.record,
      `\`${outcome.command}\` exited ${outcome.exitCode} and wrote NO record:\n${outcome.output}`,
    ).not.toBeNull();
    expect(outcome.record?.skipped).toBe(2);
  });

  test("SKIPS BY NAME: off-trunk writes nothing and names the commit condition", () => {
    const command = orderedCaptureCommand(GATE_CHECK_SKILL);
    const root = makeFixtureProject("gate-off-trunk", {
      branch: "feat/m136-ahead",
      commitAhead: true,
    });
    const outcome = drive(`${command} || true`, root);
    expect(outcome.record, "an off-trunk run must write nothing").toBeNull();
    expect(outcome.output.length, "a skip that says nothing is the shape being repaired").toBeGreaterThan(0);
    expect(outcome.output, "the reason must name the commit condition").toMatch(
      /HEAD|commit|sha|trunk/i,
    );
  });

  test("SKIPS BY NAME: a dirty tree writes nothing and names the cleanliness condition", () => {
    const command = orderedCaptureCommand(GATE_CHECK_SKILL);
    const root = makeFixtureProject("gate-dirty", { dirty: true });
    const outcome = drive(`${command} || true`, root);
    expect(outcome.record, "a dirty run must write nothing").toBeNull();
    expect(outcome.output, "the reason must name the cleanliness condition").toMatch(
      /clean|uncommitted|working tree/i,
    );
  });

  test("the prose states BOTH arms and permits no silent branch", () => {
    const text = orderScopes(read(GATE_CHECK_SKILL))
      .map((scope) => scope.text)
      .join("\n");
    expect(text, "the capture arm must name the clean condition").toMatch(/clean/i);
    expect(text, "the capture arm must name the trunk condition").toMatch(/trunk|\bmain\b/i);
    expect(text, "the skip arm must order the reason to be named").toMatch(/reason|name/i);
    expect(text, "there is no silent branch").not.toMatch(/silent/i);
  });

  test("skills/gate-check/SKILL.md stays within its pinned line cap (354)", () => {
    // The tighter of the two caps: `tests/m108-ste-393-docs-pins.test.ts` pins
    // this file at 354 while the global NFR-1 cap is 358. 351 today ⇒ 3 lines
    // of headroom, and a fenced command block costs 5. Lines must come back
    // from somewhere in this file (or move to `docs/gate-check-tracker-mode.md`)
    // — the pin is restated here so the collision surfaces at the point of work.
    expect(read(GATE_CHECK_SKILL).split("\n").length).toBeLessThanOrEqual(354);
  });
});

// ===========================================================================
// AC-STE-528.8 — it fires in a project that sets no `branch_template:`.
// ===========================================================================

describe("AC-STE-528.8 — the order fires with this repository's own tracking block", () => {
  /** This repository's `## Task Tracking` block, heading included, verbatim. */
  function repoTaskTrackingBlock(): string {
    const body = read(REPO_CLAUDE_MD);
    const rows = body.split("\n");
    const start = rows.findIndex((row) => row.startsWith("## Task Tracking"));
    expect(start, "this repository's CLAUDE.md carries no `## Task Tracking` heading").toBeGreaterThanOrEqual(
      0,
    );
    let end = start + 1;
    while (end < rows.length && !(rows[end] as string).startsWith("## ")) end += 1;
    return rows.slice(start, end).join("\n");
  }

  test("the real block carries no `branch_template:` and no sixth key", () => {
    const block = repoTaskTrackingBlock();
    expect(block, "the defect is that the REAL block lacks the key").not.toContain(
      BRANCH_TEMPLATE_KEY,
    );
    const keys = block
      .split("\n")
      .map((row) => /^([a-z_]+):/.exec(row.trim()))
      .filter((hit): hit is RegExpExecArray => hit !== null)
      .map((hit) => hit[1] as string);
    expect(keys).toEqual(["mode", "mcp_server", "jira_ac_field", "team", "project"]);
  });

  test("driving the shipped order against that block lands a record ON DISK", () => {
    const block = repoTaskTrackingBlock();
    const claudeMd = ["# Fixture", "", block, ""].join("\n");
    const root = makeFixtureProject("no-branch-template", { claudeMd });

    // Copied, not authored: assert the fixture's block is this repository's,
    // byte for byte, before anything is driven against it.
    expect(read(join(root, "CLAUDE.md"))).toContain(block);
    expect(read(join(root, "CLAUDE.md"))).not.toContain(BRANCH_TEMPLATE_KEY);

    const outcome = drive(orderedCaptureCommand(IMPLEMENT_SKILL), root);
    expect(
      outcome.record,
      `\`${outcome.command}\` exited ${outcome.exitCode} and wrote NO record in a project ` +
        `that sets no \`branch_template:\`:\n${outcome.output}`,
    ).not.toBeNull();
    expect(outcome.record?.skipped).toBe(2);
  });
});

// ===========================================================================
// AC-STE-528.9 — it fires when the branch is already acceptable.
// ===========================================================================

describe("AC-STE-528.9 — the order fires when no checkout occurs", () => {
  const ACCEPTABLE_BRANCH = "fix/m136-skip-ratchet";

  test("the precondition really holds: `isCurrentBranchAcceptable` returns true", () => {
    expect(
      isCurrentBranchAcceptable(ACCEPTABLE_BRANCH, {
        kind: "fr-tracker",
        trackerId: "STE-528",
        milestoneNumber: "136",
      }),
      "the fixture branch must be one a run would NOT re-cut — otherwise this leg tests AC.8 twice",
    ).toBe(true);
  });

  test("driving the shipped order on an already-acceptable branch lands a record ON DISK", () => {
    const root = makeFixtureProject("already-acceptable", { branch: ACCEPTABLE_BRANCH });
    const headBefore = gitOut(root, ["rev-parse", "HEAD"]);
    const branchBefore = gitOut(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
    expect(branchBefore).toBe(ACCEPTABLE_BRANCH);

    const command = orderedCaptureCommand(IMPLEMENT_SKILL);
    expect(command, "the order itself must not cut a branch").not.toContain("checkout -b");

    const outcome = drive(command, root);
    expect(
      outcome.record,
      `\`${outcome.command}\` exited ${outcome.exitCode} and wrote NO record on a branch that ` +
        `needed no checkout:\n${outcome.output}`,
    ).not.toBeNull();
    expect(outcome.record?.skipped).toBe(2);

    // No checkout occurred DURING the run — the branch was already there.
    expect(gitOut(root, ["rev-parse", "HEAD"])).toBe(headBefore);
    expect(gitOut(root, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe(ACCEPTABLE_BRANCH);
  });
});

// ===========================================================================
// AC-STE-528.10 — AC.8 and AC.9 are non-vacuous.
//
// Both grade on `baselineRecordOnDisk`. These legs prove that helper REJECTS a
// run that reports success and writes nothing — the exact failure mode this FR
// exists to detect — so the two firing legs cannot satisfy themselves.
// ===========================================================================

describe("AC-STE-528.10 — the firing legs read the record off disk, not a return value", () => {
  test("the helper reports nothing once the store is deleted from a successful run", () => {
    const root = makeFixtureProject("readback-deleted");
    const outcome = drive(`bun run "${CAPTURE_MODULE}" "${root}"`, root);
    expect(outcome.record, `a real run must land a record first:\n${outcome.output}`).not.toBeNull();

    rmSync(skipBaselinePath(root), { force: true });
    expect(
      baselineRecordOnDisk(root),
      "the helper still reported a record after the store was deleted — it is not reading disk",
    ).toBeNull();
  });

  test("a writer that exits 0 while writing nothing is REJECTED by the same helper", () => {
    const root = makeFixtureProject("silent-success");
    const outcome = drive(
      `echo "skip baseline captured for deadbeef: 2 skip(s) via \\\`bun test\\\` (bun)"`,
      root,
    );
    expect(outcome.exitCode, "the silent writer reports success").toBe(0);
    expect(outcome.output, "and prints a plausible success line").toContain("skip baseline");
    expect(
      outcome.record,
      "a capture path that reports success while writing nothing must NOT pass",
    ).toBeNull();
  });

  test("an empty store file is not mistaken for a record", () => {
    const root = makeFixtureProject("empty-store");
    mkdirSync(join(root, ".dpt"), { recursive: true });
    writeFileSync(skipBaselinePath(root), "");
    expect(baselineRecordOnDisk(root)).toBeNull();

    writeFileSync(skipBaselinePath(root), JSON.stringify({ version: 2, baselines: {} }));
    expect(baselineRecordOnDisk(root)).toBeNull();
  });
});

// ===========================================================================
// CARRIED GAP (STE-529) — the evidence render is ordered skip NAMES.
//
// Not one of STE-528's ten ACs. `deliver_stage_evidence.ts` accepts
// `skipNames` on the gate `CapturedRun` and forwards it to `evaluateSkipDelta`,
// and NO PRODUCTION CALLER SUPPLIES IT, so every real run still makes a
// silently count-only comparison. Same "declared but nothing feeds it" shape
// the milestone exists to close.
// ===========================================================================

describe("carried gap (STE-529) — the surfaces ordering the evidence render also order skip names", () => {
  /** The scope in a surface that orders the implement-report evidence render. */
  function evidenceOrderScopes(body: string): Scope[] {
    const seen = new Set<number>();
    const scopes: Scope[] = [];
    body.split("\n").forEach((row, idx) => {
      if (!row.includes("renderImplementReportEvidence")) return;
      const scope = enclosingScope(body, idx);
      if (seen.has(scope.startLine)) return;
      seen.add(scope.startLine);
      scopes.push(scope);
    });
    return scopes;
  }

  test("ALREADY LANDED — the capture path CAN produce the names", () => {
    const root = makeFixtureProject("names-produced", { skips: 2 });
    const outcome = drive(`bun run "${CAPTURE_MODULE}" "${root}"`, root);
    expect(outcome.record, `no record on disk:\n${outcome.output}`).not.toBeNull();
    expect(outcome.record?.names, "the record must carry the skips by name").toHaveLength(2);
    expect(outcome.record?.namesSource, "and say where they came from").toBeTruthy();
  });

  test("`skills/implement/SKILL.md` orders the run's skip names to be supplied", () => {
    const scopes = evidenceOrderScopes(read(IMPLEMENT_SKILL));
    expect(
      scopes.length,
      "skills/implement/SKILL.md must order the evidence render",
    ).toBeGreaterThan(0);
    const text = scopes.map((scope) => scope.text).join("\n");
    expect(
      text,
      "the evidence order says nothing about `skipNames`, so every real run compares by count alone",
    ).toContain("skipNames");
  });

  test("`docs/implement-reference.md` says where those names come from", () => {
    const body = read(IMPLEMENT_REFERENCE);
    expect(
      body,
      "the reference documents the evidence rows but never names the identity input",
    ).toContain("skipNames");
  });

  test("at least one PRODUCTION site supplies `skipNames`, beyond the declaration and the forward", () => {
    const declaration = "readonly skipNames?: readonly string[] | null;";
    const forward = "run.skipNames";

    const sources = markdownFilesUnder(SKILLS_DIR)
      .concat(markdownFilesUnder(DOCS_DIR))
      .concat(
        (function walkTs(dir: string): string[] {
          const out: string[] = [];
          for (const entry of readdirSync(dir)) {
            const full = join(dir, entry);
            if (statSync(full).isDirectory()) {
              out.push(...walkTs(full));
              continue;
            }
            if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) out.push(full);
          }
          return out;
        })(join(PLUGIN_ROOT, "adapters")),
      );

    // WORD-BOUNDED, and that is load-bearing. `skipNamesSource` (the shipped
    // helper naming a record's identity provenance) contains the substring
    // `skipNames`; a substring scan counts its four occurrences as supply sites
    // and this leg goes GREEN on a gap that is entirely open. Measured.
    const SUPPLY = /\bskipNames\b/;

    const supplySites: string[] = [];
    for (const file of sources) {
      read(file)
        .split("\n")
        .forEach((row, idx) => {
          if (!SUPPLY.test(row)) return;
          if (file === EVIDENCE_MODULE && (row.includes(declaration) || row.includes(forward))) {
            return;
          }
          if (row.trim().startsWith("*") || row.trim().startsWith("//")) return;
          supplySites.push(`${rel(file)}:${idx + 1} — ${row.trim().slice(0, 120)}`);
        });
    }

    expect(
      supplySites.length,
      "ZERO production callers supply `skipNames`: the field is declared on `CapturedRun`, " +
        "forwarded to `evaluateSkipDelta`, and fed by nothing, so every real run makes a " +
        "silently count-only comparison",
    ).toBeGreaterThan(0);
  });
});

// ===========================================================================
// Teardown.
// ===========================================================================

describe("fixture teardown", () => {
  test("every throwaway project is removed", () => {
    for (const dir of TEMP_DIRS.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
    expect(TEMP_DIRS).toEqual([]);
  });
});

// ===========================================================================
// CARRIED GAP (STE-531) — THE READ SIDE HAS A FRONT DOOR THAT RUNS.
//
// Audit-driven. The supply-site leg above is satisfied by `gate_capture.ts`,
// and MEASURED against the toolkit's own shipped reachability rule
// (`buildModuleGraph`, STE-517/M133) that module is:
//
//     gate_identity_run:     entryPoint=false reachable=true  importers=2
//     capture_skip_baseline: entryPoint=true  reachable=true  importers=0
//     skip_identities:       entryPoint=false reachable=true  importers=2
//     gate_capture:          entryPoint=false reachable=FALSE importers=0
//
// Reachable, by the shipped rule, means "carries a command-line entry point, or
// something that does imports it transitively". `gate_capture.ts` satisfies
// neither clause, so NOTHING IN THE TREE CAN RUN IT. The gap the supply-site
// scan grades as closed is closed by a module that never executes — the exact
// "declared but nothing feeds it" shape this milestone was opened over, now
// reproduced INSIDE its own fix.
//
// Four things are pinned, and they are deliberately not one thing:
//
//   1. REACHABLE by the shipped rule, driven through the shipped
//      `buildModuleGraph` rather than a re-implementation of it. A second copy
//      of the rule is a second thing to keep in step, and the copy that fell
//      behind would still look like it worked.
//   2. RUNNABLE for real: the front door EXECUTES in a throwaway project and
//      emits the identities of the skips THAT run reported. Graded on the
//      emitted names, never on the exit code — a front door that exits 0 and
//      says nothing is the failure mode this whole milestone exists to detect.
//   3. ORDERED where the gate run is ordered, as a command a reader can COPY.
//      Judged by the shipped `classifyReferenceLine`, so "ordered" means here
//      exactly what probe #81 means by it, and at least one of those orders is
//      a runnable fence that leg 2 actually runs. A reader must be told HOW to
//      obtain the names, not merely that they are needed.
//   4. THE WHOLE CLASS, scoped to this milestone: every module M136 added under
//      `adapters/_shared/src/` is reachable. The set is DERIVED from the module
//      graph plus the merge-base tree — a hand-written list of the five names
//      is stale the day a sixth module lands, and this is the sixth recurrence
//      of the defect class in one milestone.
// ===========================================================================

import {
  buildModuleGraph,
  classifyReferenceLine,
} from "../adapters/_shared/src/module_reachability";

const GATE_CAPTURE_KEY = "adapters/_shared/src/gate_capture.ts";
const SHARED_SRC_PREFIX = "adapters/_shared/src/";
/** Plugin dir, repo-relative — git speaks repo paths, the graph speaks plugin paths. */
const PLUGIN_REL = "plugins/dev-process-toolkit";
/** The release M136 shipped on top of. Fixed history, not a moving ref. */
const PREVIOUS_RELEASE = "v2.73.1";

type Graph = ReturnType<typeof buildModuleGraph>;

let GRAPH: Graph | null = null;

/** The shipped graph over this repository, built once. */
function graph(): Graph {
  if (GRAPH === null) GRAPH = buildModuleGraph(REPO_ROOT);
  return GRAPH;
}

/** A one-line report of why the shipped rule answered the way it did. */
function reachabilityWhy(key: string): string {
  const g = graph();
  return (
    `${key}: entryPoint=${g.hasEntryPoint(key)} ` +
    `nonTestImporters=[${g.nonTestImporters(key).join(", ")}] ` +
    `reachable=${g.reachable(key)}`
  );
}

/**
 * Every shipped surface that orders the implement-report evidence render — the
 * scope in which the gate run, and therefore the skip identities, are ordered.
 * DERIVED from the trees, never hand-listed.
 */
function evidenceOrderingSurfaces(): string[] {
  return [...markdownFilesUnder(SKILLS_DIR), ...markdownFilesUnder(DOCS_DIR)].filter((file) =>
    read(file).includes("renderImplementReportEvidence"),
  );
}

/** The scopes within one surface that order the gate run / evidence render. */
function gateRunOrderScopes(body: string): Scope[] {
  const seen = new Set<number>();
  const scopes: Scope[] = [];
  body.split("\n").forEach((row, idx) => {
    if (!row.includes("renderImplementReportEvidence")) return;
    const scope = enclosingScope(body, idx);
    if (seen.has(scope.startLine)) return;
    seen.add(scope.startLine);
    scopes.push(scope);
  });
  return scopes;
}

/**
 * The runnable `gate_capture` commands a surface orders inside that scope,
 * split by how they are written.
 *
 * FENCED and INLINE are kept apart because they answer different questions: a
 * fence is what a reader copies, and an inline backticked invocation is what a
 * line-capped surface can afford. Both must EXECUTE; only the fence satisfies
 * the "ordered as a runnable command fence" half.
 */
interface OrderedCommands {
  readonly fenced: string[];
  readonly inline: string[];
}

function gateCaptureCommandsIn(file: string): OrderedCommands {
  const scopes = gateRunOrderScopes(read(file));
  const fenced = [
    ...new Set(
      scopes
        .flatMap((scope) => fencedCommands(scope.text))
        .filter((command) => command.includes("gate_capture")),
    ),
  ];
  const inline = new Set<string>();
  for (const scope of scopes) {
    // Single-backtick spans only: a fence's own body carries no backticks, so
    // nothing double-counts, and a ``` marker cannot match (the character right
    // after the opening backtick is another backtick).
    for (const hit of scope.text.matchAll(/`([^`\n]+)`/g)) {
      const command = (hit[1] as string).trim();
      if (!command.includes("gate_capture")) continue;
      if (!/^(bun|bunx)\s/.test(command)) continue;
      inline.add(command);
    }
  }
  return { fenced, inline: [...inline] };
}

/** Every runnable gate-capture command ordered anywhere the gate run is. */
function allOrderedGateCaptureCommands(): Array<{ surface: string; command: string }> {
  const out: Array<{ surface: string; command: string }> = [];
  for (const file of evidenceOrderingSurfaces()) {
    const { fenced, inline } = gateCaptureCommandsIn(file);
    for (const command of [...fenced, ...inline]) out.push({ surface: rel(file), command });
  }
  return out;
}

/**
 * The commit that shipped a given release, found by its `Release:` footer.
 *
 * Throws rather than returning empty: an anchor that cannot be resolved makes
 * the derivation below produce a confident empty set, which is the exact shape
 * this block exists to refuse.
 */
function releaseCommit(version: string): string {
  const proc = Bun.spawnSync(
    ["git", "-C", REPO_ROOT, "log", "--format=%H", `--grep=^Release: ${version} `, "-1"],
    { stdout: "pipe", stderr: "pipe" },
  );
  const sha = proc.exitCode === 0 ? proc.stdout.toString().trim() : "";
  if (sha.length === 0) {
    throw new Error(
      `no commit carries a \`Release: ${version}\` footer, so "what M136 added" cannot be ` +
        "anchored; an empty set would pass the leg below while measuring nothing",
    );
  }
  return sha;
}

/** Every shared-src module path present in a commit's tree. */
function sharedModulesAt(sha: string): Set<string> {
  const proc = Bun.spawnSync(
    ["git", "-C", REPO_ROOT, "ls-tree", "-r", "--name-only", sha, "--", `${PLUGIN_REL}/${SHARED_SRC_PREFIX}`],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (proc.exitCode !== 0) {
    throw new Error(`git ls-tree failed at ${sha}: ${proc.stderr.toString().trim()}`);
  }
  return new Set(
    proc.stdout
      .toString()
      .split("\n")
      .filter((line) => line.endsWith(".ts"))
      .map((line) => line.slice(`${PLUGIN_REL}/`.length)),
  );
}

/**
 * The shared modules M136 added — anchored at BOTH ENDS of the milestone.
 *
 * WHY NOT THE MERGE BASE, which is what this used to use. On the feature branch
 * the merge base was pre-merge main, so M136's modules were correctly absent
 * there and the set was right. The moment the branch MERGED, the merge base of
 * HEAD and main became HEAD itself, every module existed at the base, and the
 * set went empty — main went red on the anti-vacuity guard below. The guard was
 * correct and the anchor was not: a derivation that only has meaning on a
 * feature branch cannot be the basis of a leg that must be green on main. This
 * repository has now been bitten three times by legs that assert over history
 * and are verified one commit or one merge too early.
 *
 * WHY NOT `HEAD^1` EITHER: right for exactly one commit, then quietly wrong —
 * it would derive some later change's modules while still reporting success,
 * which trades a loud failure for a silent one.
 *
 * Both anchors here are FIXED historical commits, found by their own `Release:`
 * footers: what existed when M136 shipped, minus what existed at the release
 * before it. That difference cannot change as further commits or milestones
 * land, which is the property the leg needs and the merge base never had.
 */
function modulesAddedByThisMilestone(): string[] {
  const shippedIn = readFileSync(
    join(REPO_ROOT, "specs", "plan", "archive", "M136.md"),
    "utf-8",
  ).match(/^shipped_in:\s*(\S+)$/m);
  expect(
    shippedIn,
    "M136's archived plan carries no `shipped_in:` stamp, so the milestone cannot name its " +
      "own release and the anchors below would be guesswork",
  ).not.toBeNull();

  const after = sharedModulesAt(releaseCommit((shippedIn as RegExpMatchArray)[1] as string));
  const before = sharedModulesAt(releaseCommit(PREVIOUS_RELEASE));
  expect(
    before.size,
    `the tree at ${PREVIOUS_RELEASE} carries no shared modules at all — the anchor is wrong ` +
      "and every module would read as newly added",
  ).toBeGreaterThan(50);

  return [...after].filter((key) => !before.has(key)).sort();
}

describe("carried gap (STE-531) — the read side of the ratchet has a front door that runs", () => {
  test("the shipped rule is live and CAN say no — this leg is not measuring an empty graph", () => {
    const g = graph();
    expect(
      g.modules.length,
      "buildModuleGraph saw no modules at all; every reachability answer below would be vacuous",
    ).toBeGreaterThan(50);
    expect(
      g.modules,
      "the module under test is not even in the graph, so `reachable` would answer false " +
        "for the wrong reason",
    ).toContain(GATE_CAPTURE_KEY);
    expect(
      g.reachable(`${SHARED_SRC_PREFIX}no_such_module_exists.ts`),
      "the predicate must be able to return false, or `true` proves nothing",
    ).toBe(false);
  });

  test("`gate_capture.ts` is REACHABLE by the toolkit's own shipped rule", () => {
    expect(
      graph().reachable(GATE_CAPTURE_KEY),
      "the READ side of the skip ratchet carries no command-line entry point and nothing " +
        "carrying one imports it, so by the rule this toolkit ships (STE-517) NOTHING CAN " +
        `RUN IT — the supply-site scan is satisfied by a module that never executes.\n  ` +
        reachabilityWhy(GATE_CAPTURE_KEY),
    ).toBe(true);
  });

  test("the gate run is ordered a runnable `gate_capture` command a reader can copy", () => {
    const surfaces = evidenceOrderingSurfaces();
    expect(
      surfaces.length,
      "no shipped surface orders `renderImplementReportEvidence` at all",
    ).toBeGreaterThan(0);

    const fencedOrders = surfaces.flatMap((file) =>
      gateCaptureCommandsIn(file).fenced.map((command) => `${rel(file)} :: ${command}`),
    );
    expect(
      fencedOrders,
      "no surface that orders the gate run carries a FENCED runnable `gate_capture` command; " +
        "the reader is told the names are required and never told how to obtain them, which " +
        "is the prose-order shape that produced zero calls the first time",
    ).not.toHaveLength(0);
  });

  for (const surface of ["skills/implement/SKILL.md", "docs/implement-reference.md"]) {
    test(`${surface} ORDERS \`gate_capture.ts\` — judged by the shipped classifier`, () => {
      const file = join(PLUGIN_ROOT, surface);
      const scopes = gateRunOrderScopes(read(file));
      expect(scopes.length, `${surface} does not order the evidence render`).toBeGreaterThan(0);

      const referenceLines = scopes
        .flatMap((scope) => scope.text.split("\n"))
        .filter((row) => row.includes(`${SHARED_SRC_PREFIX}gate_capture.ts`));
      expect(
        referenceLines.length,
        `${surface}'s gate-run scope never names \`${GATE_CAPTURE_KEY}\``,
      ).toBeGreaterThan(0);

      const classes = referenceLines.map((row) => classifyReferenceLine(row));
      expect(
        classes,
        `every reference to \`gate_capture.ts\` in ${surface}'s gate-run scope classifies as ` +
          `${JSON.stringify(classes)} — probe #81 reads that as NAMING the module, not ` +
          `ordering it. A reader is told the names are required and never told to run anything.`,
      ).toContain("ordered");
    });
  }

  test("every surface that does not carry the fence POINTS, by name, at the one that does", () => {
    const carriers = evidenceOrderingSurfaces().filter(
      (file) => gateCaptureCommandsIn(file).fenced.length > 0,
    );
    expect(
      carriers.length,
      "no surface carries the fence, so there is nothing for the others to point at",
    ).toBeGreaterThan(0);
    const carrierNames = carriers.map((file) => rel(file).split("/").pop() as string);

    const orphans: string[] = [];
    for (const file of evidenceOrderingSurfaces()) {
      if (carriers.includes(file)) continue;
      const text = gateRunOrderScopes(read(file))
        .map((scope) => scope.text)
        .join("\n");
      if (carrierNames.some((name) => text.includes(name))) continue;
      orphans.push(rel(file));
    }
    expect(
      orphans,
      `these surfaces order the gate run, carry no runnable fence, and name no surface that ` +
        `does, so a reader standing on them cannot reach the command: ${orphans.join(", ")}`,
    ).toEqual([]);
  });

  test("every ordered `gate_capture` command EXECUTES and emits THIS run's skip names", () => {
    const orders = allOrderedGateCaptureCommands();
    expect(
      orders.length,
      "nothing runnable is ordered, so there is nothing to execute — see the fence leg above",
    ).toBeGreaterThan(0);

    for (const { surface, command } of orders) {
      const root = makeFixtureProject(`gc-${surface.replace(/[^a-z]+/gi, "-")}`, { skips: 2 });
      const outcome = drive(command, root);
      // GRADED ON WHAT IT SAID, never on the exit code: a front door that exits
      // 0 and names nothing is the failure mode this milestone exists to catch.
      for (const name of ["deliberately skipped case 1", "deliberately skipped case 2"]) {
        expect(
          outcome.output,
          `\`${outcome.command}\` (ordered by ${surface}) exited ${outcome.exitCode} and never ` +
            `named "${name}". Output was:\n${outcome.output}`,
        ).toContain(name);
      }
    }
  });

  test("the emitted names track THE TREE — a third skip shows up, so they are measured", () => {
    const orders = allOrderedGateCaptureCommands();
    expect(orders.length, "nothing runnable is ordered").toBeGreaterThan(0);
    const { surface, command } = orders[0] as { surface: string; command: string };

    const three = makeFixtureProject("gc-three", { skips: 3 });
    const outcome = drive(command, three);
    expect(
      outcome.output,
      `\`${outcome.command}\` (ordered by ${surface}) did not name the third skip, so the ` +
        `names it prints are not this run's:\n${outcome.output}`,
    ).toContain("deliberately skipped case 3");

    const two = makeFixtureProject("gc-two", { skips: 2 });
    const other = drive(command, two);
    expect(
      other.output,
      "a two-skip tree must not report a third skip — a constant list would pass the leg above",
    ).not.toContain("deliberately skipped case 3");
  });

  test("EVERY module M136 added under `adapters/_shared/src/` is reachable", () => {
    const added = modulesAddedByThisMilestone();

    // Non-vacuity, twice over: the derivation must have found something, and it
    // must have found the module this block was opened over. A diff over a tree
    // it cannot see reports a confident, empty, meaningless zero.
    expect(
      added.length,
      "the merge-base derivation found NO new shared modules; the leg below would certify " +
        "an empty set",
    ).toBeGreaterThan(0);
    expect(
      added,
      "the derivation does not see `gate_capture.ts`, so it is not looking at M136's modules",
    ).toContain(GATE_CAPTURE_KEY);

    const unreachable = added.filter((key) => !graph().reachable(key));
    expect(
      unreachable,
      "M136 added these modules and by the toolkit's own shipped rule nothing can run them:\n  " +
        unreachable.map((key) => reachabilityWhy(key)).join("\n  "),
    ).toEqual([]);
  });
});

// ===========================================================================
// Teardown for the block above. The earlier teardown already emptied the list
// before these fixtures existed, so this one is not redundant.
// ===========================================================================

describe("fixture teardown (STE-531 legs)", () => {
  test("every throwaway project is removed", () => {
    for (const dir of TEMP_DIRS.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
    expect(TEMP_DIRS).toEqual([]);
  });
});

// ===========================================================================
// CARRIED GAP (STE-529, part two) — SURFACE PARITY ON THE SKIP-NAME ORDER.
//
// Audit-driven, and the same class as AC-STE-528.3 one level up. The block
// above closed the skip-name gap on `/implement`; MEASURED from
// `plugins/dev-process-toolkit`, it landed on exactly one of the two
// orchestration surfaces:
//
//   grep -rln "skipNames\|gate_capture" skills/ docs/
//     -> skills/implement/SKILL.md, docs/implement-reference.md   (ONLY)
//   skills/deliver/SKILL.md                             -> 0
//   adapters/_shared/src/deliver_stage_capture.ts        -> 0
//   adapters/_shared/src/e2e_authoring.ts                -> 0
//   adapters/_shared/src/implement_report_evidence.ts    -> 0
//   POSITIVE CONTROL, same token, same search:
//   adapters/_shared/src/gate_capture.ts                 -> 4
//
// So a `/deliver`-orchestrated run hands `evaluateSkipDelta` an UNDEFINED
// `skipNames`, which that function reads as "this caller said nothing" and
// answers on its scalar path: a silently COUNT-ONLY comparison, on the surface
// where a whole milestone is graded. A run that silences one test while
// un-silencing another reads there as a clean pass.
//
// THREE THINGS ARE PINNED, and they are deliberately not one thing.
//
//   1. `skills/deliver/SKILL.md` ORDERS the current run's skip names — judged
//      by the shipped `classifyReferenceLine`, so "ordered" means here exactly
//      what probe #81 means by it, and carrying a command that RUNS, the same
//      way `/implement`'s surface does (inline there, against its line cap;
//      either form is accepted here).
//
//   2. PARITY AS A PROPERTY, not as a pair of file names: EVERY shipped surface
//      that orders the evidence render also orders the skip names. The surface
//      set is DERIVED — the evidence-section labels come out of the shipped
//      `renderStageEvidence` itself and the `##`-level sections carrying all of
//      them are the regions — so a THIRD orchestration surface added later is
//      covered without editing this leg. This is the guard the class has never
//      had: M131 hit surface-parity drift three times inside one milestone and
//      nothing generalizes over it yet.
//
//   3. FALSIFIABLE PER SURFACE. The order is deleted from each derived surface
//      IN TURN and the verdict must name that surface AND ONLY that surface, so
//      a one-surface regression cannot hide behind its neighbour. Every deletion
//      goes through `mutateInRegion`, which aborts loudly when its anchor is
//      absent from the region — a mutation that never applied cannot score as a
//      pass, which is how four pins died in M126.
//
// LINE BUDGETS, measured before a byte was written, because two neighbours have
// none and a fix aimed at the wrong file is a fix that cannot land:
//   * `skills/implement/SKILL.md` — 358 split-length against the global NFR-1
//     pin of 358 (`tests/skill-nfr-1-length.test.ts`). ZERO headroom. Untouched
//     by anything below.
//   * `skills/gate-check/SKILL.md` — carries a POSITIONAL pin (probe #26's row
//     at line 81 exactly). Untouched by anything below.
//   * `skills/deliver/SKILL.md` — `wc -l` 252, split-length 253. Its tightest
//     cap is 351 (`tests/m123-ste-464-deliver-skill.test.ts`, stricter than the
//     global 358), so it has 98 lines of headroom and a fenced or inline
//     command fits with room to spare. That is why the fix belongs there.
// ===========================================================================

import { renderStageEvidence } from "../adapters/_shared/src/deliver_stage_evidence";

/** A `gate:` / `drive:` / `e2e:` heading line and nothing else. */
const SECTION_LABEL_RE = /^([A-Za-z_][A-Za-z0-9_]*):[ \t]*$/;

/** `##`-level only: `###` starts with `##` then `#`, which is not whitespace. */
const TOP_LEVEL_HEADING = /^##\s+\S/;

/**
 * The evidence-section labels, DERIVED by running the shipped renderer and
 * reading the headings it emits — never typed out here.
 *
 * A hand-written `["gate:", "drive:", "e2e:"]` is a second copy of a shipped
 * constant, and the copy that fell behind would still look like it worked.
 */
function evidenceSectionLabels(): string[] {
  return renderStageEvidence({ required: [] })
    .lines.map((row) => row.trim())
    .filter((row) => SECTION_LABEL_RE.test(row));
}

interface EvidenceRegion {
  /** Absolute offset into the body — `mutateInRegion` bounds. */
  readonly from: number;
  readonly to: number;
  readonly text: string;
  /** The `##` heading line, for failure messages. */
  readonly label: string;
}

/**
 * The `##`-level sections of `body` that carry EVERY one of the renderer's
 * section labels — the regions in which that surface orders the evidence render.
 *
 * Section-scoped rather than file-scoped: a file-scoped predicate passes the
 * moment the words appear anywhere, which is how a paragraph and its neighbour
 * drift apart. Section-scoped rather than list-item-scoped: on
 * `docs/implement-reference.md` the labels stand in a numbered list ten lines
 * below the fence that orders the command, and an item-scoped window would
 * demand a second copy of the order beside the list.
 */
function evidenceRegions(body: string): EvidenceRegion[] {
  const rows = body.split("\n");
  const offsets: number[] = [];
  let at = 0;
  for (const row of rows) {
    offsets.push(at);
    at += row.length + 1;
  }

  const starts: number[] = [];
  rows.forEach((row, idx) => {
    if (TOP_LEVEL_HEADING.test(row)) starts.push(idx);
  });

  const labels = evidenceSectionLabels();
  const out: EvidenceRegion[] = [];
  for (let i = 0; i < starts.length; i += 1) {
    const startIdx = starts[i] as number;
    const endIdx = i + 1 < starts.length ? (starts[i + 1] as number) : rows.length;
    const text = rows.slice(startIdx, endIdx).join("\n");
    if (!labels.every((label) => text.includes(label))) continue;
    const from = offsets[startIdx] as number;
    out.push({ from, to: from + text.length, text, label: (rows[startIdx] as string).trim() });
  }
  return out;
}

/**
 * Every shipped surface that orders the evidence render. DERIVED from the two
 * shipped markdown trees plus the renderer's own labels — never hand-listed, so
 * a third orchestration surface is covered on the day it lands.
 */
function evidenceRenderSurfaces(): string[] {
  return [...markdownFilesUnder(SKILLS_DIR), ...markdownFilesUnder(DOCS_DIR)].filter(
    (file) => evidenceRegions(read(file)).length > 0,
  );
}

interface SkipNameOrderVerdict {
  /** Region lines naming the read side that `classifyReferenceLine` calls `ordered`. */
  readonly orderedLines: string[];
  /** Runnable `gate_capture` commands in those regions — fenced or inline. */
  readonly commands: string[];
  /** Whether the regions name the field the render actually consumes. */
  readonly namesTheField: boolean;
}

function skipNameOrder(body: string): SkipNameOrderVerdict {
  const regions = evidenceRegions(body);
  const orderedLines = regions.flatMap((region) =>
    region.text
      .split("\n")
      .filter((row) => row.includes(GATE_CAPTURE_KEY) && classifyReferenceLine(row) === "ordered"),
  );

  const commands = new Set<string>();
  for (const region of regions) {
    for (const command of fencedCommands(region.text)) {
      if (command.includes("gate_capture")) commands.add(command);
    }
    // Single-backtick spans: a fence body carries no backticks, so nothing
    // double-counts, and a ``` marker cannot match this pattern.
    for (const hit of region.text.matchAll(/`([^`\n]+)`/g)) {
      const command = (hit[1] as string).trim();
      if (!command.includes("gate_capture")) continue;
      if (!/^(bun|bunx)\s/.test(command)) continue;
      commands.add(command);
    }
  }

  return {
    orderedLines,
    commands: [...commands],
    namesTheField: regions.some((region) => region.text.includes("skipNames")),
  };
}

/** One line per surface that orders the render and does NOT order the names. */
function skipNameParityReport(bodies: ReadonlyMap<string, string>): string[] {
  const out: string[] = [];
  for (const [surface, body] of bodies) {
    const verdict = skipNameOrder(body);
    if (
      verdict.orderedLines.length > 0 &&
      verdict.commands.length > 0 &&
      verdict.namesTheField
    ) {
      continue;
    }
    out.push(
      `${surface} — ordered=${verdict.orderedLines.length} ` +
        `runnable=${verdict.commands.length} namesTheField=${verdict.namesTheField}`,
    );
  }
  return out;
}

/** The offending surfaces alone, sorted — what the per-surface mutations grade on. */
function skipNameParityOffenders(bodies: ReadonlyMap<string, string>): string[] {
  return skipNameParityReport(bodies)
    .map((row) => (row.split(" — ")[0] as string).trim())
    .sort();
}

/** The shipped bodies of every derived surface, keyed by plugin-relative path. */
function shippedEvidenceBodies(): Map<string, string> {
  return new Map(evidenceRenderSurfaces().map((file) => [rel(file), read(file)]));
}

/**
 * A paraphrase that NAMES the read side and orders nothing — it carries none of
 * the shipped `ORDER_PHRASES`, so `classifyReferenceLine` scores it
 * `descriptive`. Replacing every ordered line with this is the deletion the
 * per-surface mutations perform.
 */
const DESCRIPTIVE_PARAPHRASE =
  "The skip identities are produced by `adapters/_shared/src/gate_capture.ts`.";

/**
 * Delete every skip-name ORDER from one surface, in place, through
 * `mutateInRegion` — which aborts loudly when its anchor is absent from the
 * region it was aimed at, so a mutation that never applied cannot score as a
 * pass.
 *
 * Throws when the surface carries no order to delete: a surface with nothing to
 * mutate would let this leg certify a deletion it never made.
 */
function deleteSkipNameOrder(surface: string, body: string): string {
  let doc = body;
  for (let round = 0; round < 20; round += 1) {
    let target: { region: EvidenceRegion; line: string } | null = null;
    for (const region of evidenceRegions(doc)) {
      const line = region.text
        .split("\n")
        .find(
          (row) =>
            row.includes(GATE_CAPTURE_KEY) && classifyReferenceLine(row) === "ordered",
        );
      if (line !== undefined) {
        target = { region, line };
        break;
      }
    }
    if (target === null) {
      if (round === 0) {
        throw new Error(
          `${surface} carries NO skip-name order to delete, so the mutation below would ` +
            `certify a deletion it never performed. That absence is itself the defect the ` +
            `parity leg reports.`,
        );
      }
      return doc;
    }
    doc = mutateInRegion(
      doc,
      target.region.from,
      target.region.to,
      target.line,
      DESCRIPTIVE_PARAPHRASE,
      { label: `${surface} § ${target.region.label}` },
    );
  }
  throw new Error(`${surface} carries more than 20 ordered references — refusing to loop`);
}

describe("carried gap (STE-529, part two) — the derivation itself, before it certifies anything", () => {
  test("the evidence-section labels come OUT OF the shipped renderer", () => {
    const labels = evidenceSectionLabels();
    expect(
      labels.length,
      "the shipped renderer emitted no section headings at all, so every region below " +
        "would be derived from an empty label set and match nothing",
    ).toBeGreaterThan(1);
    expect(labels, "the gate section is the one carrying the skip counts").toContain("gate:");
  });

  test("the derived surface set SEES all three known orchestration surfaces", () => {
    const surfaces = evidenceRenderSurfaces().map((file) => rel(file));
    for (const known of [
      "skills/implement/SKILL.md",
      "docs/implement-reference.md",
      "skills/deliver/SKILL.md",
    ]) {
      expect(
        surfaces,
        `the derivation does not see ${known}, so it is not looking at the surfaces that ` +
          `order the evidence render: ${JSON.stringify(surfaces)}`,
      ).toContain(known);
    }
  });

  test("the derivation can say NO — it is not simply every shipped markdown file", () => {
    const all = [...markdownFilesUnder(SKILLS_DIR), ...markdownFilesUnder(DOCS_DIR)];
    const surfaces = evidenceRenderSurfaces();
    expect(
      surfaces.length,
      "the derivation selected every markdown file in both trees, so `orders the evidence " +
        "render` is not a property it can distinguish",
    ).toBeLessThan(all.length);
    expect(
      surfaces.map((file) => rel(file)),
      "`docs/deliver-reference.md` carries a `gate:` row and neither `drive:` nor `e2e:`; " +
        "a predicate that swallowed it would be matching the word, not the render",
    ).not.toContain("docs/deliver-reference.md");
  });
});

describe("carried gap (STE-529, part two) — `/deliver` orders the run's skip names", () => {
  const DELIVER_SKILL = join(SKILLS_DIR, "deliver", "SKILL.md");

  test("skills/deliver/SKILL.md ORDERS the read side — judged by the shipped classifier", () => {
    const body = read(DELIVER_SKILL);
    const regions = evidenceRegions(body);
    expect(
      regions.length,
      "skills/deliver/SKILL.md does not order the evidence render at all, so this leg is " +
        "measuring the wrong file",
    ).toBeGreaterThan(0);

    const named = regions.flatMap((region) =>
      region.text.split("\n").filter((row) => row.includes(GATE_CAPTURE_KEY)),
    );
    expect(
      named.length,
      "skills/deliver/SKILL.md's evidence section never names " +
        `\`${GATE_CAPTURE_KEY}\`. A \`/deliver\`-orchestrated run therefore hands ` +
        "`evaluateSkipDelta` an undefined `skipNames`, which it reads as \"this caller said " +
        "nothing\" and answers on its scalar path — a silently COUNT-ONLY comparison on the " +
        "surface where a whole milestone is graded.",
    ).toBeGreaterThan(0);

    const classes = named.map((row) => classifyReferenceLine(row));
    expect(
      classes,
      `every reference in skills/deliver/SKILL.md's evidence section classifies as ` +
        `${JSON.stringify(classes)} — probe #81 reads that as NAMING the module, not ` +
        `ordering it, exactly as the prose order that produced zero calls the first time.`,
    ).toContain("ordered");
  });

  test("skills/deliver/SKILL.md carries a command a reader can COPY, the way /implement does", () => {
    const { commands } = skipNameOrder(read(DELIVER_SKILL));
    expect(
      commands,
      "skills/deliver/SKILL.md's evidence section carries no runnable `gate_capture` " +
        "command — fenced or inline. `/implement`'s SKILL surface carries the inline form " +
        "against its zero-headroom line cap; deliver's tightest cap is 351 against a " +
        "split-length of 253, so it has 98 lines of room and no such excuse.",
    ).not.toHaveLength(0);
  });

  test("the command skills/deliver/SKILL.md orders EXECUTES and names THIS run's skips", () => {
    const { commands } = skipNameOrder(read(DELIVER_SKILL));
    expect(commands.length, "nothing runnable is ordered — see the leg above").toBeGreaterThan(0);
    const command = commands[0] as string;

    const root = makeFixtureProject("deliver-names", { skips: 2 });
    const outcome = drive(command, root);
    // GRADED ON WHAT IT SAID, never on the exit code: a front door that exits 0
    // and names nothing is the failure mode this milestone exists to catch.
    for (const name of ["deliberately skipped case 1", "deliberately skipped case 2"]) {
      expect(
        outcome.output,
        `\`${outcome.command}\` (ordered by skills/deliver/SKILL.md) exited ` +
          `${outcome.exitCode} and never named "${name}". Output was:\n${outcome.output}`,
      ).toContain(name);
    }

    const three = makeFixtureProject("deliver-names-three", { skips: 3 });
    expect(
      drive(command, three).output,
      "a three-skip tree must report the third skip, or the names printed are not this run's",
    ).toContain("deliberately skipped case 3");
    expect(
      outcome.output,
      "a two-skip tree must NOT report a third skip — a constant list would pass the leg above",
    ).not.toContain("deliberately skipped case 3");
  });
});

describe("carried gap (STE-529, part two) — parity as a PROPERTY over the derived surface set", () => {
  test("EVERY surface that orders the evidence render also orders the skip names", () => {
    const bodies = shippedEvidenceBodies();
    expect(bodies.size, "the derived surface set is empty — nothing would be graded").toBeGreaterThan(
      1,
    );
    const report = skipNameParityReport(bodies);
    expect(
      report,
      "these surfaces order the evidence render and do NOT order the current run's skip " +
        "names, so every run they orchestrate compares skips by COUNT alone:\n  " +
        report.join("\n  "),
    ).toEqual([]);
  });

  for (const surface of [
    "skills/implement/SKILL.md",
    "docs/implement-reference.md",
    "skills/deliver/SKILL.md",
  ]) {
    test(`MUTATION — deleting the order from ${surface} ALONE reddens, and only there`, () => {
      const bodies = shippedEvidenceBodies();
      const original = bodies.get(surface);
      expect(
        original,
        `${surface} is not in the derived surface set, so this mutation has no subject`,
      ).toBeDefined();

      // `deleteSkipNameOrder` routes every edit through `mutateInRegion`, which
      // aborts loudly when its anchor is absent from the region it was aimed
      // at — so a mutation that never applied cannot score as a pass here.
      const mutant = deleteSkipNameOrder(surface, original as string);
      expect(
        mutant,
        "the mutation left the surface byte-identical, so nothing was deleted",
      ).not.toBe(original);
      expect(
        skipNameOrder(mutant).orderedLines,
        `${surface} still carries an ordered reference after the deletion`,
      ).toEqual([]);

      bodies.set(surface, mutant);
      expect(
        skipNameParityOffenders(bodies),
        `deleting the skip-name order from ${surface} must make it — and no other surface — ` +
          `the offender. A verdict naming a neighbour instead is how a one-surface ` +
          `regression hides.`,
      ).toEqual([surface]);
    });
  }
});

// ===========================================================================
// Teardown for the parity block. The two earlier teardowns already emptied the
// list before these fixtures existed, so this one is not redundant.
// ===========================================================================

describe("fixture teardown (STE-529 parity legs)", () => {
  test("every throwaway project is removed", () => {
    for (const dir of TEMP_DIRS.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
    expect(TEMP_DIRS).toEqual([]);
  });
});
