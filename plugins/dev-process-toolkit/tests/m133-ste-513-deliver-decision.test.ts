// M133 STE-513 — one runnable front door for every delivery decision.
//
// WHAT THIS FILE PINS, and why each leg is shaped the way it is.
//
//   AC.1  The `import.meta.main` guard is asserted against the SHIPPED idiom
//         rather than in a vacuum: the same anchor is required to be present in
//         `active_plan_ship_ready.ts` — the file the AC names — so if that
//         idiom ever moves, this leg goes red and says so instead of silently
//         pinning a convention nothing follows any more.
//
//   AC.2  Import-purity is OBSERVED, not inferred: a throwaway importer file is
//         run as its own subprocess and its stdout must be exactly its own
//         marker. A test that merely `await import`ed the module inside this
//         process would be judged by the bun test runner's own output and could
//         not tell "printed nothing" from "printed into the runner's noise".
//
//   AC.3  The default is proved by DIFFERENTIAL RUN, not by reading the source:
//         one run passes the fixture root explicitly from an unrelated cwd, one
//         run passes no second positional with cwd set to the fixture, and the
//         two outputs must be byte-identical. A module that ignored argv[3] and
//         always used cwd would pass a source grep and die here.
//
//   AC.4  Two subjects, one parser. The seven labels are located in the REAL
//         command's stdout and in `renderDecisionRecord`'s return value with
//         the same `labelLines` reader, and the completeness rule ("a record
//         missing any field is a refusal, not a shorter record") is driven
//         seven times — omit each field in turn, expect a canonical refusal.
//         Order is asserted as strictly increasing line indices AND each label
//         exactly once, so a second copy of a label cannot satisfy the order.
//
//   AC.5  Per-step placement is asserted on EVERY step line, and the refusal
//         half is driven: a chain value whose step line carries no placement
//         must be refused by the renderer. Asserting only the happy path would
//         leave "is refused" unmeasured.
//
//         AND the placement is asserted to be the STEP'S OWN. The base fixture
//         resumes a milestone whose every step happens to run in a worker, so
//         `toContain("(" + step.placement + ")")` there is satisfied by a
//         renderer that hardcodes `(worker)` — measured: that mutation SURVIVED.
//         So a second fixture drives a chain that MIXES placements (an FR
//         awaiting technical review puts an `inline` /spec-write ahead of the
//         worker tail), the mix itself is asserted before the placements are,
//         and each step line's placement must equal that step's own. No single
//         literal satisfies it.
//
//   AC.6  Source-level, and deliberately narrow: the module must import all six
//         delegates AND carry no quoted literal from any of the five closed
//         vocabularies (argument kinds, routes, resume states, merge policies,
//         gate classes) in code — comments stripped first. The vocabularies are
//         IMPORTED from the delegates rather than retyped here, so a new member
//         is covered the day it ships. This leg is the weak half by design; the
//         strong half is AC.7.
//
//   AC.7  Six REAL EXECUTED stubs. A throwaway tree is built holding a copy of
//         `deliver_decision.ts` plus one file per relative import: a `export *`
//         passthrough to the shipped module for every import, and for the one
//         delegate under mutation a passthrough whose answer function is
//         wrapped to return a DIFFERENT VALID answer. The copy is then run as a
//         subprocess and its combined output must differ from baseline.
//
//         The CONTROL LEG is what makes those six mean anything: the same
//         harness with no stub at all must produce output byte-identical to the
//         direct run. Without it, "the output changed" could be the harness's
//         own doing, and six green legs would prove nothing (M127's six
//         vacuities). Control asserts EQUAL, the stubs assert DIFFERENT, and
//         both use the same comparator — a delegate whose stub leaves the bytes
//         identical fails, named.
//
//         "The output moved" is only an answer once the stubbed run PRODUCED an
//         answer: a stub that crashes moves the bytes too, and would score this
//         leg green while proving nothing about delegation. So each stubbed run
//         is first required to exit 0 and print a whole seven-field record, and
//         only then is the move counted.
//
//   AC.8  Read-only is measured by hashing the fixture tree before and after,
//         file set included, so a file DELETED by the run is caught as well as
//         one rewritten. Not a source grep for write calls.
//
//   AC.9  Two malformed/unresolvable arguments, each asserted on three counts:
//         non-zero exit, the canonical Refusing:/Remedy:/Context: envelope, and
//         NO record label anywhere in the output — the "never prints a partial
//         record" half, which an exit-code-only assertion would miss.
//
//         Those three all refuse during ARGUMENT ROUTING and never reach the
//         renderer, so their partial-record assertion cannot see a renderer that
//         emits fields as it builds them — measured: that mutation left all
//         three GREEN. A fourth case reaches the renderer and then fails (a
//         shipped milestone has an empty chain, so the record refuses on its
//         `chain` field with five answers already computed), which is where the
//         no-partial promise can actually be broken.
//
//         ALL FOUR of those raise the module's OWN refusal, which is born
//         carrying the envelope — so every one of them is green whether the CLI
//         boundary envelopes what it catches or prints `error.message` raw.
//         Measured: replacing `console.error(envelopeFor(error, …))` with
//         `console.error(error.message)` left all thirty legs GREEN, which
//         means the defect `envelopeFor` was written to fix was pinned by
//         nothing. Two further cases drive an UNENVELOPED throw all the way to
//         that boundary — an argument whose plan path is a DIRECTORY (EISDIR)
//         and one whose plan file is unreadable (EACCES). Both resolve to a
//         plan (`existsSync` is true for a directory, and true for a file with
//         mode 000), so routing succeeds and `readFileSync` then fails with a
//         bare Node error carrying no `Refusing:` of its own. Each is asserted
//         on four counts: non-zero exit, ZERO bytes on stdout, the canonical
//         envelope on stderr, and `refusal=unenveloped` in the context line —
//         the last being what proves the WRAPPING branch fired rather than the
//         pass-through one.
//
// ---------------------------------------------------------------------------
// CONTRACT NOTES FOR THE IMPLEMENTER — the legs above depend on these shapes.
// ---------------------------------------------------------------------------
//
//   * The module exports `DECISION_FIELDS` (the seven labels, in order) and
//     `renderDecisionRecord(fields)`, which returns the record text and THROWS
//     a canonical NFR-10 refusal naming the offending label when a field is
//     absent/blank or when a chain step line carries no `(inline|worker)`
//     placement. The command prints exactly what that renderer returns.
//
//   * Single-line fields render `label: value`. The chain field renders `chain:`
//     on its own line followed by the step lines, each carrying its placement —
//     the shipped `resume_classifier` step-line shape (`  1. /skill T (worker)`)
//     already satisfies that and is the obvious thing to reuse.
//
//   * REUSE MEANS IMPORT, NOT RETYPE. `resume_classifier` renders the step
//     lines an operator confirms; a byte-identical copy of that renderer living
//     in `deliver_decision` is not reuse, it is a second renderer — and the day
//     one of the two moves, the decision record stops describing the plan the
//     operator confirmed. That is the exact drift this FR exists to close,
//     reproduced inside the FR. So `resume_classifier` must EXPORT its step-line
//     renderer as `stepLines(chain: readonly ResumeChainStep[]): string[]` —
//     the same function its own `renderResumePlan` uses, not a new one beside
//     it — and `deliver_decision` must import and call it rather than format a
//     step line itself. Two legs hold that: one pins the printed chain block
//     against `renderResumePlan`'s OWN rendered output (so the two cannot
//     diverge whichever side moves), and one stubs `stepLines` in the AC.7
//     harness and requires the stub's marker to reach the printed record (so a
//     local copy that ignores the shared renderer fails, named).
//
//   * THE RECORD PRINTS UNDER NON-TTY STDIN. `resolveDeliverArgument` refuses
//     non-tty by default, which is right for the interactive pipeline and wrong
//     for this command: it spawns nothing, claims nothing and writes nothing,
//     and every environment that needs it — a test, a driver, a headless
//     capture — has non-tty stdin. Pass `stdinIsTty: true` explicitly. A
//     printer that inherits the interactive gate can never be run by the
//     tooling this FR exists to serve.
//
//   * `orchestration_config` must be consulted DIRECTLY, not only through
//     `merge_policy_ratchet.runMergePolicy` (which reaches the real config
//     module internally and is therefore invisible to a stub of it). Rendering
//     the merge-policy field as `<configured> -> <effective>` — configured from
//     `readOrchestrationConfig`, effective from `runMergePolicy` — satisfies
//     AC.6's delegate list and AC.7's per-delegate mutation at once.
//
//   * The delegate entry points the AC.7 stubs wrap, per module:
//       deliver_argument      classifyDeliverArgument, resolveDeliverArgument
//       target_repo           routeMilestone
//       resume_classifier     classifyResume
//       orchestration_config  readOrchestrationConfig
//       merge_policy_ratchet  runMergePolicy
//       gate_class            classifyGate, relayRequired
//     Reaching a delegate through some OTHER export while re-deriving the
//     answer these own is exactly the second answer AC.7 forbids.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";

import {
  DELIVER_ARGUMENT_KINDS,
  classifyDeliverArgument,
} from "../adapters/_shared/src/deliver_argument";
import { MILESTONE_ROUTES, routeMilestone } from "../adapters/_shared/src/target_repo";
import {
  RESUME_STATES,
  classifyResume,
  renderResumePlan,
  resumeChain,
} from "../adapters/_shared/src/resume_classifier";
import {
  MERGE_POLICIES,
  readOrchestrationConfig,
} from "../adapters/_shared/src/orchestration_config";
import { runMergePolicy } from "../adapters/_shared/src/merge_policy_ratchet";
import { GATE_CLASSES, classifyGate, relayRequired } from "../adapters/_shared/src/gate_class";

// ===========================================================================
// Paths + the module contract under test.
// ===========================================================================

const PLUGIN_ROOT = join(import.meta.dir, "..");
const SHARED_SRC = join(PLUGIN_ROOT, "adapters", "_shared", "src");

const MODULE_FILE = join(SHARED_SRC, "deliver_decision.ts");
const IDIOM_FILE = join(SHARED_SRC, "active_plan_ship_ready.ts");
/** The module that owns the step-line shape both renderings must share. */
const RESUME_CLASSIFIER_FILE = join(SHARED_SRC, "resume_classifier.ts");

/** The shipped command-line guard, verbatim. AC.1's anchor. */
const MAIN_GUARD = "if (import.meta.main) {";

/** The six delegates AC.6 names, in the AC's own order. */
const DELEGATES = [
  "deliver_argument",
  "target_repo",
  "resume_classifier",
  "orchestration_config",
  "merge_policy_ratchet",
  "gate_class",
] as const;
type Delegate = (typeof DELEGATES)[number];

/**
 * The seven labelled fields, in the fixed order AC.4 states.
 *
 * The AC fixes the ORDER and the SUBJECTS; the spellings are this file's, and
 * `DECISION_FIELDS` in the module is asserted equal to them so the printer and
 * this test cannot drift apart on either.
 */
const FIELDS = [
  "argument_kind",
  "target_repo_route",
  "resume_state",
  "chain",
  "merge_policy",
  "gate_class",
  "gate_relays",
] as const;

/** The gate the record reports on: /deliver's pre-spawn chain-confirm gate. */
const CONFIRM_GATE = "deliver_chain_confirm";

const read = (p: string): string => readFileSync(p, "utf-8");

// ===========================================================================
// The fixture project: one resumable milestone with one active FR.
// ===========================================================================

const FIXTURE_MILESTONE = "M900";
const FIXTURE_FR = "STE-900";

function writeFixture(root: string): void {
  mkdirSync(join(root, "specs", "plan"), { recursive: true });
  mkdirSync(join(root, "specs", "frs"), { recursive: true });
  writeFileSync(
    join(root, "CLAUDE.md"),
    ["# Fixture", "", "## Orchestration", "", "default_effort: high", "merge_policy: offer", ""].join(
      "\n",
    ),
  );
  writeFileSync(
    join(root, "specs", "plan", `${FIXTURE_MILESTONE}.md`),
    [
      "---",
      `milestone: ${FIXTURE_MILESTONE}`,
      "status: active",
      "shipped_in: null",
      "---",
      "",
      `# ${FIXTURE_MILESTONE} — fixture milestone`,
      "",
      "## Tasks",
      "",
      "- [ ] Build the thing",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(root, "specs", "frs", `${FIXTURE_FR}.md`),
    [
      "---",
      "title: Fixture FR",
      `milestone: ${FIXTURE_MILESTONE}`,
      "status: active",
      "archived_at: null",
      "tracker:",
      `  linear: ${FIXTURE_FR}`,
      "created_at: 2026-08-25T00:00:00Z",
      "changelog_category: Added",
      "---",
      "",
      "# Fixture FR",
      "",
      "## Acceptance Criteria",
      "",
      `- AC-${FIXTURE_FR}.1: it exists.`,
      "",
    ].join("\n"),
  );
}

const scratch: string[] = [];

function newTempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  scratch.push(dir);
  return dir;
}

function newFixture(): string {
  const root = newTempDir("ste513-fx-");
  writeFixture(root);
  return root;
}

/**
 * A fixture whose chain MIXES placements.
 *
 * The base fixture's chain is all-`worker`, which makes any assertion of the
 * form "the line contains `(<this step's placement>)`" satisfiable by a renderer
 * that prints one hardcoded literal. Flagging the FR for technical review moves
 * the milestone into `needs_technical_review`, which puts a `/spec-write` step
 * at the head of the chain — and `resume_classifier` places that step INLINE on
 * the invoking route while the tail stays in workers. Two placements, one chain,
 * no literal that satisfies both.
 */
function newMixedPlacementFixture(): string {
  const root = newFixture();
  const frFile = join(root, "specs", "frs", `${FIXTURE_FR}.md`);
  writeFileSync(
    frFile,
    read(frFile).replace("status: active", "status: active\nneeds_technical_review: true"),
  );
  return root;
}

/**
 * A fixture that REACHES the renderer and then fails.
 *
 * A shipped milestone has no chain left to run, so `resumeChain` returns an
 * empty list and the record cannot be completed — but only after the argument
 * has routed, the repo has been routed and the resume state has been classified.
 * That is the one path on which a renderer emitting fields as it builds them
 * would leak a partial record, and no argument-routing refusal can reach it.
 */
function newShippedFixture(): string {
  const root = newFixture();
  const planFile = join(root, "specs", "plan", `${FIXTURE_MILESTONE}.md`);
  writeFileSync(planFile, read(planFile).replace("shipped_in: null", "shipped_in: v9.9.9"));
  return root;
}

/**
 * A fixture whose plan path resolves to a DIRECTORY.
 *
 * `defaultIdentityProbe.locatePlan` accepts any path `existsSync` reports, and
 * a directory is one — so routing SUCCEEDS and the failure lands one line later,
 * when the plan is read: `EISDIR: illegal operation on a directory, read`, a
 * bare Node error carrying no refusal of its own. This is the only fixture in
 * the file that reaches the CLI's catch with an UNENVELOPED throw.
 */
function newDirectoryPlanFixture(): string {
  const root = newFixture();
  const planFile = join(root, "specs", "plan", `${FIXTURE_MILESTONE}.md`);
  rmSync(planFile, { force: true });
  mkdirSync(planFile, { recursive: true });
  return root;
}

/**
 * A fixture whose plan file exists but cannot be opened.
 *
 * Mode 000 leaves `existsSync` true, so routing succeeds exactly as above and
 * the read fails with a bare `EACCES: permission denied, open '…'`. A second,
 * independent way to reach the same boundary — a wrapper that special-cased one
 * errno would still be caught here.
 */
function newUnreadablePlanFixture(): string {
  const root = newFixture();
  const planFile = join(root, "specs", "plan", `${FIXTURE_MILESTONE}.md`);
  chmodSync(planFile, 0o000);
  chmodRestore.push(planFile);
  return root;
}

/** Files whose mode must be put back before teardown can delete them. */
const chmodRestore: string[] = [];

/** Can this process actually read `file`? The EACCES leg's own precondition. */
function isReadable(file: string): boolean {
  try {
    readFileSync(file);
    return true;
  } catch {
    return false;
  }
}

let fixture: string;

beforeAll(() => {
  fixture = newFixture();
});

afterAll(() => {
  for (const file of chmodRestore) {
    try {
      chmodSync(file, 0o644);
    } catch {
      // Already gone, or never created — teardown is not a place to fail.
    }
  }
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

// ===========================================================================
// Running the command.
// ===========================================================================

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
  /** stdout + stderr + exit code — the comparison unit for AC.7. */
  readonly combined: string;
}

function runFile(file: string, args: readonly string[], cwd: string): RunResult {
  const proc = Bun.spawnSync(["bun", "run", file, ...args], {
    cwd,
    // Deliberately non-tty: see the contract note. A printer that refuses here
    // is a printer no test, driver or headless capture can ever run.
    stdin: "ignore",
    env: { ...process.env, NO_COLOR: "1" },
  });
  const stdout = proc.stdout.toString();
  const stderr = proc.stderr.toString();
  return {
    stdout,
    stderr,
    code: proc.exitCode ?? -1,
    combined: `${stdout}\n---stderr---\n${stderr}\n---exit---\n${proc.exitCode}`,
  };
}

function runCommand(args: readonly string[], cwd = PLUGIN_ROOT): RunResult {
  return runFile(MODULE_FILE, args, cwd);
}

// ===========================================================================
// The record reader — ONE parser, used on the command's stdout and on
// `renderDecisionRecord`'s return value alike.
// ===========================================================================

/** Line indices where `label:` starts at column 0. */
function labelLines(text: string, label: string): number[] {
  const out: number[] = [];
  text.split("\n").forEach((line, i) => {
    if (line === `${label}:` || line.startsWith(`${label}: `)) out.push(i);
  });
  return out;
}

/** The single-line value of `label`, or null when the line carries none. */
function fieldValue(text: string, label: string): string | null {
  const [idx] = labelLines(text, label);
  if (idx === undefined) return null;
  const line = text.split("\n")[idx]!;
  return line === `${label}:` ? null : line.slice(label.length + 2).trim();
}

/** The lines between `chain:` and the next label line. */
function chainBlock(text: string): string[] {
  const lines = text.split("\n");
  const [start] = labelLines(text, "chain");
  if (start === undefined) return [];
  const nextLabel = FIELDS.filter((f) => f !== "chain")
    .flatMap((f) => labelLines(text, f))
    .filter((i) => i > start)
    .sort((a, b) => a - b)[0];
  return lines
    .slice(start + 1, nextLabel ?? lines.length)
    .filter((l) => l.trim().length > 0);
}

/** A step line carries its own placement: `  1. /implement M900 (worker)`. */
const STEP_LINE_RE = /^\s*\d+\.\s+\S+.*\((inline|worker)\)\s*$/;

/** The placement a step LINE claims, or null when it claims none. */
function placementOf(line: string): string | null {
  return STEP_LINE_RE.exec(line)?.[1] ?? null;
}

/** The canonical NFR-10 refusal envelope. */
function isCanonicalRefusal(text: string): boolean {
  return (
    /(^|\n)Refusing: /.test(text) &&
    /(^|\n)Remedy: /.test(text) &&
    /(^|\n)Context: /.test(text)
  );
}

// ===========================================================================
// Expected answers — asked of the delegates themselves, never hardcoded.
// ===========================================================================

async function expectedRecord(
  root: string,
  milestone: string = FIXTURE_MILESTONE,
): Promise<{
  kind: string;
  route: string;
  state: string;
  chain: readonly { skill: string; target: string; placement: string }[];
  configured: string;
  effective: string;
  gateClass: string;
  relays: boolean;
}> {
  const kind = classifyDeliverArgument(milestone).kind;
  const planBody = read(join(root, "specs", "plan", `${milestone}.md`));
  const route = routeMilestone({ planBody, invokingRepo: root }).route;
  const classification = await classifyResume(root, {
    scope: "milestone",
    milestone,
  });
  return {
    kind,
    route,
    state: classification.state,
    chain: resumeChain(classification, route),
    configured: readOrchestrationConfig(root).mergePolicy,
    effective: runMergePolicy(root).effective,
    gateClass: classifyGate(CONFIRM_GATE),
    relays: relayRequired(CONFIRM_GATE, null),
  };
}

// ===========================================================================
// AC.7 — the stub harness.
//
// A throwaway tree holding a copy of the module plus one file per relative
// import. Every import gets an `export *` passthrough to the shipped module;
// the delegate under mutation additionally re-exports a WRAPPED answer function
// whose explicit local export shadows the star (ESM ambiguity rules), so the
// copy genuinely executes a different answer for that one question and nothing
// else moves.
// ===========================================================================

const REAL = (name: string): string => JSON.stringify(join(SHARED_SRC, name));

/** Wrapped answer functions, one per delegate. Each returns a VALID alternative. */
function stubBody(delegate: Delegate): string {
  const real = REAL(delegate);
  const head = `import * as __real from ${real};\n`;
  switch (delegate) {
    case "deliver_argument":
      return (
        head +
        `const flip = (k: any) => (k === "fr_identity" ? "milestone_identity" : "fr_identity");\n` +
        `export function classifyDeliverArgument(raw: any): any {\n` +
        `  const r = __real.classifyDeliverArgument(raw);\n` +
        `  return { ...r, kind: flip(r.kind) };\n}\n` +
        `export function resolveDeliverArgument(input: any): any {\n` +
        `  const r = __real.resolveDeliverArgument(input);\n` +
        `  return { ...r, kind: flip(r.kind) };\n}\n`
      );
    case "target_repo":
      return (
        head +
        `export function routeMilestone(input: any): any {\n` +
        `  const r = __real.routeMilestone(input);\n` +
        `  const route = r.route === "reduced" ? "invoking" : "reduced";\n` +
        `  return { ...r, route, ceremony: route !== "reduced", chain: __real.stagesRequiredFor(route) };\n}\n`
      );
    case "resume_classifier":
      return (
        head +
        `export async function classifyResume(root: any, target: any): Promise<any> {\n` +
        `  const r: any = await __real.classifyResume(root, target);\n` +
        `  if (r.scope === "fr") {\n` +
        `    return { ...r, needsTechnicalReview: !r.needsTechnicalReview,\n` +
        `      state: r.state === "needs_technical_review" ? "ready_to_implement" : "needs_technical_review" };\n` +
        `  }\n` +
        `  return { ...r, state: r.state === "ship_ready" ? "ready_to_implement" : "ship_ready" };\n}\n`
      );
    case "orchestration_config":
      return (
        head +
        `export function readOrchestrationConfig(root: any): any {\n` +
        `  const r = __real.readOrchestrationConfig(root);\n` +
        `  return { ...r, mergePolicy: r.mergePolicy === "never" ? "offer" : "never",\n` +
        `    defaultEffort: r.defaultEffort === "low" ? "high" : "low" };\n}\n`
      );
    case "merge_policy_ratchet":
      return (
        head +
        `export function runMergePolicy(root: any): any {\n` +
        `  const r = __real.runMergePolicy(root);\n` +
        `  return { ...r, effective: r.effective === "never" ? "offer" : "never" };\n}\n`
      );
    case "gate_class":
      return (
        head +
        `export function classifyGate(gate: any): any {\n` +
        `  return __real.classifyGate(gate) === "mechanical" ? "content" : "mechanical";\n}\n` +
        `export function relayRequired(gate: any, delegation: any): boolean {\n` +
        `  return !__real.relayRequired(gate, delegation);\n}\n`
      );
  }
}

/** Relative import specifiers of a module's source, deduped. */
function relativeImports(source: string): string[] {
  const specs = new Set<string>();
  for (const m of source.matchAll(/from\s+["'](\.\/[^"']+)["']/g)) specs.add(m[1]!);
  for (const m of source.matchAll(/import\s*\(\s*["'](\.\/[^"']+)["']/g)) specs.add(m[1]!);
  for (const m of source.matchAll(/^\s*import\s+["'](\.\/[^"']+)["']/gm)) specs.add(m[1]!);
  return [...specs];
}

/**
 * Build the harness tree. `stubbed === null` is the CONTROL: every import is a
 * plain passthrough, so the copy must behave exactly like the shipped module.
 */
function buildHarnessWith(stubs: Readonly<Record<string, string>>): string {
  const dir = newTempDir("ste513-mut-");
  copyFileSync(MODULE_FILE, join(dir, "deliver_decision.ts"));
  for (const spec of relativeImports(read(MODULE_FILE))) {
    const name = spec.replace(/^\.\//, "").replace(/\.ts$/, "");
    const target = join(dir, `${name}.ts`);
    mkdirSync(dirname(target), { recursive: true });
    const passthrough = `export * from ${REAL(name)};\n`;
    const extra = stubs[name];
    writeFileSync(target, extra === undefined ? passthrough : passthrough + extra);
  }
  return dir;
}

function buildHarness(stubbed: Delegate | null): string {
  return buildHarnessWith(stubbed === null ? {} : { [stubbed]: stubBody(stubbed) });
}

function runHarness(stubbed: Delegate | null, root: string): RunResult {
  const dir = buildHarness(stubbed);
  return runFile(join(dir, "deliver_decision.ts"), [FIXTURE_MILESTONE, root], PLUGIN_ROOT);
}

// ===========================================================================
// Tree hashing — AC.8.
// ===========================================================================

function hashTree(root: string): string {
  const rows: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        rows.push(`d ${relative(root, full)}`);
        walk(full);
      } else {
        const digest = createHash("sha256").update(readFileSync(full)).digest("hex");
        rows.push(`f ${relative(root, full)} ${digest}`);
      }
    }
  };
  walk(root);
  return rows.join("\n");
}

// ===========================================================================
// AC.1 — the command-line guard, against the shipped idiom.
// ===========================================================================

describe("AC-STE-513.1 — import.meta.main guard, shipped idiom", () => {
  test("the module exists at the path the AC names", () => {
    expect(existsSync(MODULE_FILE)).toBe(true);
  });

  test("the idiom this AC points at is still the shipped one", () => {
    // If this fails, the AC's reference file changed shape — fix the reference,
    // do not weaken the pin below.
    expect(read(IDIOM_FILE)).toContain(MAIN_GUARD);
  });

  test("deliver_decision carries the same guard", () => {
    expect(read(MODULE_FILE)).toContain(MAIN_GUARD);
  });
});

// ===========================================================================
// AC.2 — importing runs nothing.
// ===========================================================================

describe("AC-STE-513.2 — import is side-effect free", () => {
  test("a subprocess that only imports the module prints nothing of its own", () => {
    const dir = newTempDir("ste513-imp-");
    const importer = join(dir, "importer.ts");
    writeFileSync(
      importer,
      `import ${JSON.stringify(MODULE_FILE)};\nconsole.log("IMPORT_MARKER");\n`,
    );
    const result = runFile(importer, [], PLUGIN_ROOT);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("IMPORT_MARKER\n");
  });
});

// ===========================================================================
// AC.3 — it runs, and projectRoot defaults to cwd.
// ===========================================================================

describe("AC-STE-513.3 — runs as a command; projectRoot defaults to cwd", () => {
  test("an explicit projectRoot run succeeds", () => {
    const result = runCommand([FIXTURE_MILESTONE, fixture]);
    expect(result.code).toBe(0);
    expect(result.stdout.trim().length).toBeGreaterThan(0);
  });

  test("omitting the second positional reads process.cwd()", () => {
    const explicit = runCommand([FIXTURE_MILESTONE, fixture], PLUGIN_ROOT);
    const implicit = runCommand([FIXTURE_MILESTONE], fixture);
    expect(implicit.code).toBe(0);
    expect(implicit.stdout).toBe(explicit.stdout);
  });

  test("cwd is not consulted once projectRoot is given", () => {
    // A second fixture with a DIFFERENT merge policy: a module that ignored
    // argv[3] and read cwd would print the other tree's policy here.
    const other = newFixture();
    writeFileSync(
      join(other, "CLAUDE.md"),
      ["# Fixture", "", "## Orchestration", "", "merge_policy: never", ""].join("\n"),
    );
    const result = runCommand([FIXTURE_MILESTONE, fixture], other);
    expect(result.code).toBe(0);
    expect(fieldValue(result.stdout, "merge_policy")).toContain(
      runMergePolicy(fixture).effective,
    );
  });
});

// ===========================================================================
// AC.4 — seven labelled fields, fixed order, completeness is a refusal.
// ===========================================================================

describe("AC-STE-513.4 — the seven fields, in order", () => {
  test("DECISION_FIELDS is the seven labels in the fixed order", async () => {
    const mod: any = await import(MODULE_FILE);
    expect(mod.DECISION_FIELDS).toEqual([...FIELDS]);
  });

  test("every field appears exactly once in the printed record", () => {
    const result = runCommand([FIXTURE_MILESTONE, fixture]);
    expect(result.code).toBe(0);
    for (const field of FIELDS) {
      expect({ field, hits: labelLines(result.stdout, field).length }).toEqual({
        field,
        hits: 1,
      });
    }
  });

  test("the labels appear in the fixed order", () => {
    const result = runCommand([FIXTURE_MILESTONE, fixture]);
    const indices = FIELDS.map((f) => labelLines(result.stdout, f)[0]);
    expect(indices.every((i) => i !== undefined)).toBe(true);
    const sorted = [...(indices as number[])].sort((a, b) => a - b);
    expect(indices).toEqual(sorted);
  });

  test("each field carries the answer its owning module gives", async () => {
    const result = runCommand([FIXTURE_MILESTONE, fixture]);
    const want = await expectedRecord(fixture);
    expect(fieldValue(result.stdout, "argument_kind")).toBe(want.kind);
    expect(fieldValue(result.stdout, "target_repo_route")).toBe(want.route);
    expect(fieldValue(result.stdout, "resume_state")).toBe(want.state);
    expect(fieldValue(result.stdout, "merge_policy")).toContain(want.effective);
    expect(fieldValue(result.stdout, "gate_class")).toBe(want.gateClass);
    // The relay half is a boolean, and it is not free: a non-mechanical gate
    // ALWAYS relays, so a record claiming otherwise contradicts its own class.
    const relays = fieldValue(result.stdout, "gate_relays");
    expect(["yes", "no", "true", "false"]).toContain(relays);
    expect(["yes", "true"].includes(relays!)).toBe(want.relays);
  });

  test("a record missing any field is a refusal, not a shorter record", async () => {
    const mod: any = await import(MODULE_FILE);
    const full: Record<string, string> = {
      argument_kind: "milestone_identity",
      target_repo_route: "invoking",
      resume_state: "ready_to_implement",
      chain: "  1. /implement M900 (worker)",
      merge_policy: "offer -> offer",
      gate_class: "content",
      gate_relays: "yes",
    };
    // Control: the complete map renders, and renders in order.
    const rendered: string = mod.renderDecisionRecord(full);
    const indices = FIELDS.map((f) => labelLines(rendered, f)[0]);
    expect(indices.every((i) => i !== undefined)).toBe(true);
    expect(indices).toEqual([...(indices as number[])].sort((a, b) => a - b));

    for (const omitted of FIELDS) {
      const partial = { ...full };
      delete partial[omitted];
      let message = "";
      expect(() => {
        try {
          mod.renderDecisionRecord(partial);
        } catch (e) {
          message = e instanceof Error ? e.message : String(e);
          throw e;
        }
      }).toThrow();
      expect({ omitted, canonical: isCanonicalRefusal(message) }).toEqual({
        omitted,
        canonical: true,
      });
      expect({ omitted, names: message.includes(omitted) }).toEqual({
        omitted,
        names: true,
      });
    }
  });
});

// ===========================================================================
// AC.5 — per-step placement.
// ===========================================================================

describe("AC-STE-513.5 — every chain step carries its placement", () => {
  test("the printed chain has one line per step, each with a placement", async () => {
    const result = runCommand([FIXTURE_MILESTONE, fixture]);
    const want = await expectedRecord(fixture);
    const block = chainBlock(result.stdout);
    expect(block.length).toBe(want.chain.length);
    expect(want.chain.length).toBeGreaterThan(0);
    for (const line of block) {
      expect({ line, ok: STEP_LINE_RE.test(line) }).toEqual({ line, ok: true });
    }
    for (const [i, step] of want.chain.entries()) {
      expect(block[i]).toContain(step.skill);
      expect(block[i]).toContain(step.target);
      expect(block[i]).toContain(`(${step.placement})`);
    }
  });

  test("each step line's placement is the STEP'S OWN, on a MIXED chain", async () => {
    // The leg above cannot tell a per-step placement from a hardcoded literal:
    // the base fixture's chain is all-`worker`, so `(worker)` printed
    // unconditionally satisfies every one of its assertions. Measured — that
    // mutation SURVIVED it. This fixture's chain carries both placements, so
    // no literal can.
    const root = newMixedPlacementFixture();
    const want = await expectedRecord(root);

    // The mix is asserted BEFORE the placements are. If `resume_classifier`
    // ever stops emitting an inline step here, this fixture silently becomes
    // the all-worker one again and the leg goes back to proving nothing — so
    // that regression must be a failure, not a quiet weakening.
    expect([...new Set(want.chain.map((s) => s.placement))].sort()).toEqual([
      "inline",
      "worker",
    ]);

    const result = runCommand([FIXTURE_MILESTONE, root]);
    expect(result.code).toBe(0);
    const block = chainBlock(result.stdout);
    expect(block.length).toBe(want.chain.length);
    for (const [i, step] of want.chain.entries()) {
      expect({
        step: i + 1,
        skill: step.skill,
        placement: placementOf(block[i] ?? ""),
      }).toEqual({ step: i + 1, skill: step.skill, placement: step.placement });
    }
  });

  test("a chain rendered without per-step placement is refused", async () => {
    const mod: any = await import(MODULE_FILE);
    const fields: Record<string, string> = {
      argument_kind: "milestone_identity",
      target_repo_route: "invoking",
      resume_state: "ready_to_implement",
      chain: "  1. /implement M900",
      merge_policy: "offer -> offer",
      gate_class: "content",
      gate_relays: "yes",
    };
    let message = "";
    expect(() => {
      try {
        mod.renderDecisionRecord(fields);
      } catch (e) {
        message = e instanceof Error ? e.message : String(e);
        throw e;
      }
    }).toThrow();
    expect(isCanonicalRefusal(message)).toBe(true);
  });
});

// ===========================================================================
// AC.5, second half — the step line has ONE renderer, not two.
//
// AC.5 pins the SHAPE of a step line. It does not pin WHOSE shape it is, and a
// byte-identical copy of `resume_classifier`'s renderer living in
// `deliver_decision` satisfies every leg above while being precisely the defect
// this FR exists to close: the record and the plan the operator confirms would
// then be two renderings with nothing tying them together, and the day either
// moves the record silently stops describing what was confirmed.
//
// Two legs, and they fail for different reasons on purpose:
//
//   DIVERGENCE — the printed chain block must equal the step lines inside
//   `renderResumePlan`'s own `rendered` output, compared against the real
//   function rather than a literal copied into this file. Whichever side's
//   format moves, this goes red.
//
//   SINGLE SOURCE — divergence alone cannot distinguish "imported" from
//   "copied and still in sync", so the AC.7 harness stubs `resume_classifier`'s
//   exported `stepLines` and requires the stub's marker to reach the printed
//   record. A local copy never calls the stub and never carries the marker.
// ===========================================================================

/** The marker a stubbed `stepLines` prepends. Placement stays trailing. */
const STEP_LINES_MARKER = "STEPLINES_STUB";

/**
 * Wrap `resume_classifier.stepLines` so every line it renders is visibly the
 * stub's. Prepended, not appended: `renderDecisionRecord` requires the
 * placement to stay at end-of-line, and a marker after it would be refused for
 * the wrong reason and score this leg green without measuring delegation.
 */
function stepLinesStub(): string {
  return (
    `import * as __real from ${REAL("resume_classifier")};\n` +
    `export function stepLines(chain: any): string[] {\n` +
    `  return (__real as any).stepLines(chain)` +
    `.map((l: string) => \`  <<${STEP_LINES_MARKER}>> \${l.trim()}\`);\n` +
    `}\n`
  );
}

describe("AC-STE-513.5 — the step line has one renderer, not two", () => {
  test("the printed chain block IS resume_classifier's own rendering", async () => {
    const result = runCommand([FIXTURE_MILESTONE, fixture]);
    expect(result.code).toBe(0);

    const want = await expectedRecord(fixture);
    const classification = await classifyResume(fixture, {
      scope: "milestone",
      milestone: FIXTURE_MILESTONE,
    });
    const plan = renderResumePlan(classification);

    // PRECONDITIONS, asserted before the comparison. The two sides must be
    // rendering the SAME chain, or a line-level difference would be a chain
    // difference wearing a formatting difference's clothes.
    expect(want.chain.length).toBeGreaterThan(0);
    expect(plan.chain).toEqual(want.chain);

    // The step lines are the tail of what the operator is shown. Every line in
    // that tail must actually be a step line — otherwise the slice reached into
    // the header and the comparison below would be against the wrong text.
    const renderedLines = plan.rendered.split("\n");
    const tail = renderedLines.slice(renderedLines.length - plan.chain.length);
    for (const line of tail) {
      expect({ line, isStep: STEP_LINE_RE.test(line) }).toEqual({ line, isStep: true });
    }

    // Compared against the FUNCTION, never against a literal retyped here: a
    // copy in this file would be a third renderer and would drift too.
    expect(chainBlock(result.stdout)).toEqual(tail);
  });

  test("resume_classifier exports the step-line renderer it uses itself", async () => {
    const mod: any = await import(RESUME_CLASSIFIER_FILE);
    expect({ exported: typeof mod.stepLines }).toEqual({ exported: "function" });

    // Exporting a NEW function beside the private one would satisfy the line
    // above and single-source nothing. The export must be the very renderer
    // `renderResumePlan` uses, which is provable without reading the source:
    // its output must be the tail of that plan's rendered text.
    const classification = await classifyResume(fixture, {
      scope: "milestone",
      milestone: FIXTURE_MILESTONE,
    });
    const plan = renderResumePlan(classification);
    const renderedLines = plan.rendered.split("\n");
    expect(mod.stepLines(plan.chain)).toEqual(
      renderedLines.slice(renderedLines.length - plan.chain.length),
    );
  });

  test("stubbing resume_classifier.stepLines changes the printed chain", () => {
    const baseline = runHarness(null, fixture);
    expect(baseline.code).toBe(0);

    const dir = buildHarnessWith({ resume_classifier: stepLinesStub() });
    const stubbed = runFile(join(dir, "deliver_decision.ts"), [FIXTURE_MILESTONE, fixture], PLUGIN_ROOT);

    // Same discipline as AC.7: the stubbed run must first BE an answer. A crash
    // moves the bytes too and would prove nothing about who rendered the lines.
    expect({ code: stubbed.code, stderr: stubbed.stderr }).toEqual({ code: 0, stderr: "" });
    for (const field of FIELDS) {
      expect({ field, hits: labelLines(stubbed.stdout, field).length }).toEqual({
        field,
        hits: 1,
      });
    }

    const block = chainBlock(stubbed.stdout);
    expect(block.length).toBe(chainBlock(baseline.stdout).length);
    expect(block.length).toBeGreaterThan(0);
    for (const line of block) {
      expect({ line, viaSharedRenderer: line.includes(STEP_LINES_MARKER) }).toEqual({
        line,
        viaSharedRenderer: true,
      });
    }
  });
});

// ===========================================================================
// AC.6 — assembly only: six delegates, no branch of its own.
// ===========================================================================

/** Source with block and line comments removed. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("AC-STE-513.6 — delegates to all six, decides nothing itself", () => {
  test("all six delegates are imported", () => {
    const source = stripComments(read(MODULE_FILE));
    for (const delegate of DELEGATES) {
      const imported = new RegExp(`["']\\./${delegate}["']`).test(source);
      expect({ delegate, imported }).toEqual({ delegate, imported: true });
    }
  });

  test("no closed-vocabulary literal appears in the module's code", () => {
    const vocabulary = [
      ...DELIVER_ARGUMENT_KINDS,
      ...MILESTONE_ROUTES,
      ...RESUME_STATES,
      ...MERGE_POLICIES,
      ...GATE_CLASSES,
    ];
    const source = stripComments(read(MODULE_FILE));
    for (const token of vocabulary) {
      const present = new RegExp(`["'\`]${token}["'\`]`).test(source);
      expect({ token, present }).toEqual({ token, present: false });
    }
  });
});

// ===========================================================================
// AC.7 — mutation-verified delegation, one stub per delegate.
// ===========================================================================

describe("AC-STE-513.7 — each delegate is mutation-verified", () => {
  test("CONTROL: the harness with no stub reproduces the shipped output", () => {
    const direct = runCommand([FIXTURE_MILESTONE, fixture]);
    const harness = runHarness(null, fixture);
    // If this fails, every "the output changed" verdict below is unattributable
    // and the six legs prove nothing. Fix the harness, never the stub legs.
    expect(harness.combined).toBe(direct.combined);
    expect(harness.code).toBe(0);
  });

  for (const delegate of DELEGATES) {
    test(`stubbing ${delegate} changes the printed record`, () => {
      const baseline = runHarness(null, fixture);
      const stubbed = runHarness(delegate, fixture);

      // ASSERTED BEFORE THE MOVE, and this order is the point. A stub that
      // CRASHES also moves the bytes — different stderr, different exit code —
      // and `moved: true` cannot tell that apart from a delegate answering
      // differently. So the stubbed run must first BE an answer: exit 0, with a
      // whole seven-field record. Only a run that got all the way to a complete
      // record can testify that the delegate was consulted at all.
      expect({ delegate, baselineCode: baseline.code, stubbedCode: stubbed.code }).toEqual(
        { delegate, baselineCode: 0, stubbedCode: 0 },
      );
      for (const field of FIELDS) {
        expect({
          delegate,
          field,
          hits: labelLines(stubbed.stdout, field).length,
        }).toEqual({ delegate, field, hits: 1 });
      }

      expect({
        delegate,
        moved: stubbed.combined !== baseline.combined,
      }).toEqual({ delegate, moved: true });
    });
  }
});

// ===========================================================================
// AC.7, the per-FIELD half.
//
// The mutation above is per-MODULE, and the verdict it reads is the COMBINED
// output. That is one assertion for a delegate that answers more than one
// question — and `gate_class` answers two, through two separate functions:
//
//     gate_class:   classifyGate(CONFIRM_GATE)
//     gate_relays:  relayRequired(CONFIRM_GATE, null)
//
// Both arrive from the same stubbed module, so moving ONE of the two fields
// already satisfies "the output moved". MEASURED: deleting the `relayRequired`
// delegation outright — the `gate_relays` line replaced with the literal
// `"yes"` — left the AC.7 gate_class leg GREEN (baseline `content`/`yes`,
// stubbed `mechanical`/`yes`; the bytes still moved). AC.4's leg stayed green
// too, because its `want.relays` is true and the literal is the same "yes",
// and AC.6's stayed green because "yes" belongs to no closed vocabulary. So
// `relayRequired`'s consultation was pinned by NOTHING.
//
// That is harmless only by accident: `CONFIRM_GATE` is not registered in
// `GATE_REGISTRY` today, so `relayRequired` returns a constant. STE-515
// registers that gate, at which point the field becomes informative while its
// delegation stays unmeasured.
//
// `resume_classifier` has the same shape — `classifyResume` feeds BOTH
// `resume_state` and (through `resumeChain`) the `chain` block — so it gets
// the same treatment rather than a patch aimed only at the gate case.
//
// The fix is to name, per delegate, WHICH fields its answer feeds, and require
// EACH of those fields to move on its own. A delegate that feeds one field is
// covered too, and more tightly than by combined output: `target_repo`'s route
// also reaches `resumeChain`, so a `target_repo_route` reduced to a literal
// would still move the chain lines and still satisfy the combined verdict.
// ===========================================================================

/**
 * The record fields each delegate's own answer feeds.
 *
 * This map is the claim the legs below drive. Under-claiming is caught by the
 * coverage leg (every field must be claimed by someone); over-claiming is
 * caught by the move legs themselves (a field that does not move goes red and
 * names itself).
 */
const FIELDS_FED: Record<Delegate, readonly (typeof FIELDS)[number][]> = {
  deliver_argument: ["argument_kind"],
  target_repo: ["target_repo_route"],
  resume_classifier: ["resume_state", "chain"],
  orchestration_config: ["merge_policy"],
  merge_policy_ratchet: ["merge_policy"],
  gate_class: ["gate_class", "gate_relays"],
};

/** One field's rendered text: the value line, or the whole chain block. */
function fieldText(text: string, field: string): string | null {
  if (field !== "chain") return fieldValue(text, field);
  const block = chainBlock(text);
  return block.length === 0 ? null : block.join("\n");
}

describe("AC-STE-513.7 — each delegate moves EVERY field it feeds", () => {
  test("every record field is claimed by at least one delegate", () => {
    // An unclaimed field is a field no per-field leg watches, which is exactly
    // the hole this section closes — so a new field with no owner must fail
    // here rather than arrive unmeasured.
    const claimed = new Set<string>(Object.values(FIELDS_FED).flat());
    expect([...FIELDS].filter((f) => !claimed.has(f))).toEqual([]);
  });

  test("the delegates that feed more than one field are the known two", () => {
    // A canary on the map itself. If a third delegate starts answering two
    // questions, this goes red and the map gets updated deliberately instead
    // of the new field slipping under a combined-output verdict.
    expect(DELEGATES.filter((d) => FIELDS_FED[d].length > 1)).toEqual([
      "resume_classifier",
      "gate_class",
    ]);
  });

  for (const delegate of DELEGATES) {
    test(`stubbing ${delegate} moves each of its fields independently`, () => {
      const baseline = runHarness(null, fixture);
      const stubbed = runHarness(delegate, fixture);

      // Same precondition as the combined leg, and for the same reason: a
      // crashed stub moves everything and testifies to nothing.
      expect({ delegate, baselineCode: baseline.code, stubbedCode: stubbed.code }).toEqual(
        { delegate, baselineCode: 0, stubbedCode: 0 },
      );
      for (const field of FIELDS) {
        expect({
          delegate,
          field,
          hits: labelLines(stubbed.stdout, field).length,
        }).toEqual({ delegate, field, hits: 1 });
      }

      for (const field of FIELDS_FED[delegate]) {
        const before = fieldText(baseline.stdout, field);
        const after = fieldText(stubbed.stdout, field);
        expect({
          delegate,
          field,
          rendered: before !== null && after !== null,
        }).toEqual({ delegate, field, rendered: true });
        expect({ delegate, field, moved: after !== before }).toEqual({
          delegate,
          field,
          moved: true,
        });
      }
    });
  }
});

// ===========================================================================
// AC.8 — the record is read-only.
// ===========================================================================

describe("AC-STE-513.8 — running the command writes nothing", () => {
  test("the project tree is byte-identical before and after", () => {
    const root = newFixture();
    const before = hashTree(root);
    const result = runCommand([FIXTURE_MILESTONE, root]);
    expect(result.code).toBe(0);
    expect(hashTree(root)).toBe(before);
  });

  test("no git repository, lock or ledger is created", () => {
    const root = newFixture();
    const result = runCommand([FIXTURE_MILESTONE, root]);
    // Asserted FIRST: a run that never got off the ground creates nothing
    // either, and would score this leg green without measuring anything.
    expect(result.code).toBe(0);
    expect(existsSync(join(root, ".git"))).toBe(false);
    expect(existsSync(join(root, ".dpt"))).toBe(false);
  });
});

// ===========================================================================
// AC.9 — malformed or unresolvable arguments refuse, and print no partial.
// ===========================================================================

describe("AC-STE-513.9 — refusal, never a partial record", () => {
  const cases: readonly { name: string; args: readonly string[] }[] = [
    { name: "an identity with no plan file", args: ["M901", "__ROOT__"] },
    { name: "an FR identity with no FR file", args: ["STE-901", "__ROOT__"] },
    { name: "no argument at all", args: [] },
  ];

  for (const c of cases) {
    test(`${c.name} refuses non-zero`, () => {
      const args = c.args.map((a) => (a === "__ROOT__" ? fixture : a));
      const result = runCommand(args, fixture);
      expect({ name: c.name, code: result.code !== 0 }).toEqual({
        name: c.name,
        code: true,
      });
      expect({ name: c.name, canonical: isCanonicalRefusal(result.combined) }).toEqual({
        name: c.name,
        canonical: true,
      });
      for (const field of FIELDS) {
        expect({
          name: c.name,
          field,
          leaked: labelLines(result.stdout, field).length,
        }).toEqual({ name: c.name, field, leaked: 0 });
      }
    });
  }

  test("a failure raised INSIDE the renderer prints no partial record", () => {
    // Every case above refuses during ARGUMENT ROUTING — before the renderer is
    // ever entered — so none of them can observe a renderer that emits each
    // field as it builds it. Measured: that mutation left all three GREEN.
    //
    // A shipped milestone routes cleanly, classifies cleanly and then has an
    // EMPTY chain, so the record refuses from inside `renderDecisionRecord`
    // with the earlier answers already computed. That is the only place the
    // "never a partial record" promise can actually be broken.
    const root = newShippedFixture();
    const result = runCommand([FIXTURE_MILESTONE, root]);

    expect({ nonZero: result.code !== 0 }).toEqual({ nonZero: true });
    expect(isCanonicalRefusal(result.combined)).toBe(true);

    // The refusal really came from the RENDERER: only `renderDecisionRecord`
    // names a `field=` in its context line. Without this, the fixture could
    // drift into refusing at routing again and this leg would rejoin the three
    // above in proving nothing.
    expect(result.combined).toContain("phase=decision-record");
    expect(result.combined).toContain("field=chain");

    for (const field of FIELDS) {
      expect({ field, leaked: labelLines(result.stdout, field).length }).toEqual({
        field,
        leaked: 0,
      });
    }
  });

  // =========================================================================
  // The UNENVELOPED half.
  //
  // Every case above raises the module's own refusal, which is BORN carrying
  // the envelope — so all of them stay green whether the CLI boundary wraps
  // what it catches or prints `error.message` raw. Measured: replacing
  // `console.error(envelopeFor(error, …))` with `console.error(error.message)`
  // left all thirty legs GREEN, which means the defect `envelopeFor` was
  // written to fix was pinned by nothing at all.
  //
  // These two drive a BARE Node error to that boundary. Both resolve to a plan
  // path (`existsSync` is true for a directory, and true for a mode-000 file),
  // so routing succeeds and the read is what fails — with an `EISDIR:` /
  // `EACCES:` message that carries no `Refusing:` of its own.
  //
  // `refusal=unenveloped` is the load-bearing assertion: it is written ONLY by
  // the wrapping branch, so it tells a genuine wrap apart from a refusal that
  // arrived already enveloped and merely passed through.
  // =========================================================================

  function expectUnenvelopedRefusal(name: string, root: string): void {
    const result = runCommand([FIXTURE_MILESTONE, root], PLUGIN_ROOT);

    expect({ name, nonZero: result.code !== 0 }).toEqual({ name, nonZero: true });
    // ZERO bytes, not "no labels": the record channel stays completely empty.
    expect({ name, stdout: result.stdout }).toEqual({ name, stdout: "" });
    expect({ name, canonical: isCanonicalRefusal(result.stderr) }).toEqual({
      name,
      canonical: true,
    });
    expect({ name, wrapped: result.stderr.includes("refusal=unenveloped") }).toEqual({
      name,
      wrapped: true,
    });
    // The original text is carried, not swallowed — wrapping must lose nothing.
    expect({ name, keepsCause: /Refusing: .*: E[A-Z]+:/.test(result.stderr) }).toEqual({
      name,
      keepsCause: true,
    });
  }

  test("a plan path that is a DIRECTORY refuses in the canonical envelope", () => {
    expectUnenvelopedRefusal("EISDIR", newDirectoryPlanFixture());
  });

  test("an UNREADABLE plan file refuses in the canonical envelope", () => {
    const root = newUnreadablePlanFixture();
    // The precondition, asserted rather than assumed. If this fails the runner
    // can read a mode-000 file — it is running as root — and this environment
    // cannot express EACCES at all. That is a real hole in the measurement, so
    // it fails loudly here rather than passing quietly on an untested branch.
    const planFile = join(root, "specs", "plan", `${FIXTURE_MILESTONE}.md`);
    expect({ chmodDenies: !isReadable(planFile) }).toEqual({ chmodDenies: true });
    expectUnenvelopedRefusal("EACCES", root);
  });
});
