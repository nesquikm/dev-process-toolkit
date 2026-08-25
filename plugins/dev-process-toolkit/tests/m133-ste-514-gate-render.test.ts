// M133 / STE-514 — "The confirm gate shows the command's bytes, not a retelling".
//
// THE DEFECT, measured. `/deliver`'s pre-spawn confirm gate is ordered in prose
// ("Render the classified state *and* the exact chain intended"), and what the
// operator actually sees is whatever the reader chose to write down. On the M130
// run (2026-08-24) the reader rendered the resume state as its own one-line
// prose —
//
//     **Resume state** → ready_to_implement
//
// — and self-approved it. Nothing could tell that apart from a real
// classification, because nothing was comparing the two. An acceptance criterion
// asserting only that a gate was SHOWN passes on that run. That emission is the
// fixture in AC.4 below, and the predicate must REJECT it.
//
// THE MODULE THE IMPLEMENTER WRITES (suggested path, and the one these legs
// load):
//
//     adapters/_shared/src/resume_gate_render.ts        ← NEW
//
// THE CONTRACT THESE TESTS PIN, stated once so the implementer does not guess:
//
//     export interface ResumeGateVerdict {
//       readonly ok: boolean;
//       readonly reasons: readonly string[];
//     }
//     export const GATE_RENDER_ABSENT      = "gate-render-absent";
//     export const GATE_RENDER_PARAPHRASED = "gate-render-paraphrased";
//     export const GATE_RENDER_NO_CAPTURE  = "gate-render-no-capture";
//     export function verifyResumeGateRender(
//       rendered: string | null | undefined,
//       capturedStdout: string,
//     ): ResumeGateVerdict;
//
//   * `ok: true` IFF the capture is non-blank AND `rendered` contains the
//     capture's bytes as ONE CONTIGUOUS RUN. Containment, not equality: the gate
//     legitimately wraps the record in its own prompt text. Line endings are
//     normalized on both sides before the comparison (this repo has lost a whole
//     transform to CRLF twice); nothing else is.
//   * A BLANK CAPTURE IS NEVER A PASS. The empty string is contained in every
//     string, so a predicate that skipped this guard would grade every gate
//     `ok` the day the capture went missing. Blank capture ⇒ `ok: false` with
//     `GATE_RENDER_NO_CAPTURE`.
//   * ON FAILURE THE TWO MODES ARE NAMED APART (AC.5). `GATE_RENDER_PARAPHRASED`
//     when the rendering REFERENCES the record — it carries one of the eight
//     `DECISION_FIELDS` labels in canonical (`resume_state`) or spaced
//     (`resume state`) form, case-insensitive, OR a captured field value token
//     of 8+ characters verbatim. `GATE_RENDER_ABSENT` otherwise. The two are
//     mutually exclusive: a paraphrase is never reported as an absence, because
//     the two failures have different remedies and reporting one as the other
//     sends the reader looking for the wrong thing.
//
// PIN DISCIPLINE (docs/patterns.md Pattern 31; house precedents
// `m133-ste-513-deliver-decision.test.ts`, `m133-ste-516-spawn-receipt.test.ts`):
//
//   * AC.4 IS THE LOAD-BEARING LEG AND IT PROVES IT CAN FAIL. The real M130
//     emission is asserted rejected — and the same assertion is then run against
//     a deliberately permissive stand-in predicate, which must throw. A leg that
//     cannot fail on an accepting predicate is not evidence about this FR.
//   * THE CAPTURE COMES FROM THE SHIPPED RENDERER, AND ONCE FROM THE REAL
//     COMMAND. `renderDecisionRecord` supplies the deterministic fixture bytes;
//     one leg additionally runs `deliver_decision.ts` as a subprocess against a
//     temp fixture tree and re-runs the rejection against ITS stdout, so AC.4 is
//     grounded in bytes the command really printed and not only in bytes this
//     file composed.
//   * THE COMMAND LINE IS EXECUTED, NOT ADMIRED (AC.1). The one command line is
//     extracted FROM the shipped surface, its placeholders substituted, and the
//     result run. "Written so it can be copied and executed" is graded by
//     copying and executing it.
//   * AC.2 IS PER-MODULE, NEVER COLLECTIVE. Each of the six delegated modules
//     gets its own expectation naming itself. The test forbids the PAIRING of a
//     module reference with a delegation imperative on one line — descriptive
//     prose naming a module is untouched, so the implementer is not forced to
//     strip the taxonomy along with the order.
//
//     HONEST RESTATEMENT (audit-raised, measured 2026-08-25). An earlier draft
//     of this comment claimed "a fix that retires five orders and leaves one
//     still reddens with the survivor named". That over-claimed. The six order
//     lines on the pre-FR surface (SKILL.md:34, :50, :83, :106, :151, :203 at
//     `git show HEAD`) map to FIVE modules — `resume_classifier` carries two
//     (:50 and :83) — and `orchestration_config`'s only pre-FR mention (:123,
//     "Read `readOrchestrationConfig().defaultEffort` …") pairs with NO order
//     marker at all. So the `orchestration_config` leg had zero matching lines
//     before this FR and could not have failed: it is a REGRESSION guard
//     against a future order, not proof that one was retired.
//
//     A leg that cannot fail is not evidence, so the audit-raised section at
//     the foot of this file proves each per-module leg's subject is real by
//     INJECTING one synthetic surviving order per module and asserting that
//     module's leg reddens while the other five stay green. That grounds the
//     claim in something stable — the detector's own reach — rather than in a
//     `git show HEAD` baseline that moves the moment this FR commits.
//   * PARITY IS MUTATION-VERIFIED IN BOTH DIRECTIONS (AC.10/AC.11), and each
//     mutation ASSERTS IT APPLIED — a mutation that never landed reads as a pass
//     (measured M124). Equal-but-empty is not parity either: the verdict requires
//     the clause PRESENT on both surfaces, so "both surfaces say nothing" fails.
//
// NOT IN SCOPE, deliberately: `docs/deliver-reference.md` also carries "the
// orchestrating session" (line 92 at the time of writing). AC.7 names the
// OPERATIVE surface and only that, so this file asserts zero on
// `skills/deliver/SKILL.md` alone. Widening it here would assert something the
// FR does not say and would red a compliant implementation.

import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DECISION_FIELDS,
  renderDecisionRecord,
} from "../adapters/_shared/src/deliver_decision";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const SRC_DIR = join(PLUGIN_ROOT, "adapters", "_shared", "src");

// The module STE-514 introduces. Absolute path + dynamic import on purpose: a
// static import of a not-yet-written module fails the WHOLE file at resolution
// time, collapsing eleven ACs into one opaque red. Loading per test keeps each
// AC's RED attributable to that AC.
const RENDER_MODULE = join(SRC_DIR, "resume_gate_render.ts");
const DECISION_COMMAND = join(SRC_DIR, "deliver_decision.ts");

const DELIVER_SKILL = join(PLUGIN_ROOT, "skills", "deliver", "SKILL.md");
const DELIVER_REFERENCE = join(PLUGIN_ROOT, "docs", "deliver-reference.md");

const SKILL_LABEL = "skills/deliver/SKILL.md";
const REFERENCE_LABEL = "docs/deliver-reference.md";

const read = (p: string): string => readFileSync(p, "utf-8");

/** Load the module under test, or fail the leg with the path it looked for. */
async function loadModule(): Promise<any> {
  return await import(RENDER_MODULE);
}

// ===========================================================================
// The capture — bytes the shipped renderer produced.
// ===========================================================================

const FIXTURE_MILESTONE = "M900";
const FIXTURE_FR = "STE-900";

const CHAIN_STEPS = [
  `  1. /implement ${FIXTURE_MILESTONE} (worker)`,
  `  2. /ship-milestone ${FIXTURE_MILESTONE} (worker)`,
  `  3. /pr ${FIXTURE_MILESTONE} (worker)`,
];

/** One real decision record, rendered by the shipped renderer, not composed. */
const CAPTURE = renderDecisionRecord({
  argument_kind: "milestone_identity",
  target_repo_route: "invoking",
  resume_state: "ready_to_implement",
  chain: CHAIN_STEPS.join("\n"),
  merge_policy: "offer -> offer",
  gate_class: "content",
  gate_relays: "yes",
  // M134 STE-519 appended an eighth field; a seven-field record now refuses,
  // and this fixture is evaluated at module load, so omitting it would abort
  // the whole file rather than fail one leg.
  remote_control: "dev-process-toolkit-m900",
});

/** A gate that shows the bytes, wrapped in its own prompt text. */
const FAITHFUL_GATE = [
  `Before anything is spawned, here is the delivery decision for ${FIXTURE_MILESTONE}:`,
  "",
  CAPTURE,
  "",
  "Confirm this chain, edit it, or abort.",
].join("\n");

/**
 * THE REAL FAILURE (M130, 2026-08-24). A worker rendered the resume state as
 * its own one line of prose and self-approved it. Verbatim, not a stand-in.
 */
const REAL_PARAPHRASE = "**Resume state** → ready_to_implement";

/** The same emission as a whole gate, prompt text and all — as it was shown. */
const REAL_PARAPHRASE_GATE = [
  `Resuming ${FIXTURE_MILESTONE}.`,
  "",
  REAL_PARAPHRASE,
  "",
  "Proceeding to spawn the worker — confirm?",
].join("\n");

/** A paraphrase carrying only a VALUE, no label: still a paraphrase. */
const VALUE_ONLY_PARAPHRASE = "→ ready_to_implement, so I will go straight to /implement.";

/** No gate at all. */
const ABSENT_GATE = "Everything checks out. Shall I go ahead and start the run?";

// ===========================================================================
// The fixture project: one resumable milestone with one active FR.
// (The `m133-ste-513-deliver-decision.test.ts` shape, reused rather than
// reinvented, so the command under AC.1 runs against a tree that does not
// change state as this repo's own milestones ship.)
// ===========================================================================

function newFixture(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ste514-fx-")));
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
  return root;
}

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

function runTokens(tokens: readonly string[], cwd: string): RunResult {
  const proc = Bun.spawnSync([...tokens], {
    cwd,
    stdin: "ignore",
    env: { ...process.env, NO_COLOR: "1" },
  });
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    code: proc.exitCode ?? -1,
  };
}

// ===========================================================================
// Surface readers.
// ===========================================================================

/**
 * Every line on `text` that names the decision command. The command is the
 * subject of AC.1 and the anchor of its mutation in AC.11.
 */
function commandLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.includes("deliver_decision.ts"));
}

/**
 * The command line made executable: `${CLAUDE_PLUGIN_ROOT}` resolved, and the
 * `<placeholder>` / `[placeholder]` positionals replaced, in order, by the
 * arguments a real run takes. "Copied and executed" is graded by doing it.
 */
function executableTokens(commandLine: string, args: readonly string[]): string[] {
  const resolved = commandLine
    .replaceAll("${CLAUDE_PLUGIN_ROOT}", PLUGIN_ROOT)
    .replaceAll("$CLAUDE_PLUGIN_ROOT", PLUGIN_ROOT);
  const out: string[] = [];
  let next = 0;
  for (const token of resolved.split(/\s+/).filter((t) => t.length > 0)) {
    if (/^[<[].*[>\]]$/.test(token)) {
      if (next < args.length) out.push(args[next]!);
      next += 1;
      continue;
    }
    out.push(token);
  }
  return out;
}

// ===========================================================================
// AC.1 — one runnable command line on the operative surface.
// ===========================================================================

describe("AC-STE-514.1 — the operative surface carries ONE runnable command line", () => {
  test("exactly one command line names the decision command", () => {
    expect({
      surface: SKILL_LABEL,
      count: commandLines(read(DELIVER_SKILL)).length,
    }).toEqual({ surface: SKILL_LABEL, count: 1 });
  });

  test("it is spelled as a bun run invocation of the shipped module", () => {
    const [line] = commandLines(read(DELIVER_SKILL));
    expect(line ?? "").toMatch(/^bun run \S*adapters\/_shared\/src\/deliver_decision\.ts\b/);
  });

  test("copied and executed, it prints the eight-field record and exits 0", () => {
    const [line] = commandLines(read(DELIVER_SKILL));
    expect(line ?? "").toContain("deliver_decision.ts");
    const fixture = newFixture();
    const tokens = executableTokens(line!, [FIXTURE_MILESTONE, fixture]);
    const result = runTokens(tokens, PLUGIN_ROOT);
    expect({
      code: result.code,
      missingFields: DECISION_FIELDS.filter((f) => !result.stdout.includes(`${f}:`)),
      stderr: result.stderr.slice(0, 400),
    }).toEqual({ code: 0, missingFields: [], stderr: "" });
  });

  test("each step of the record it prints names its own placement", () => {
    // The record is what the gate then shows verbatim. A chain whose steps do
    // not say where they run is a chain the operator confirms without seeing —
    // which is precisely what AC.6 makes uneditable.
    const [line] = commandLines(read(DELIVER_SKILL));
    const fixture = newFixture();
    const result = runTokens(executableTokens(line!, [FIXTURE_MILESTONE, fixture]), PLUGIN_ROOT);
    const steps = result.stdout
      .split("\n")
      .filter((l) => /^\s+\d+\.\s+\//.test(l));
    expect({
      stepCount: steps.length > 0,
      unplaced: steps.filter((l) => !/\((inline|worker)\)\s*$/.test(l)),
    }).toEqual({ stepCount: true, unplaced: [] });
  });
});

// ===========================================================================
// AC.2 — the six prose orders are gone, and none survives as a second
// instruction.
// ===========================================================================

/** The six delegated modules, each with the spellings that NAME it on prose. */
const DELEGATED_MODULES = [
  {
    module: "deliver_argument",
    names: ["deliver_argument", "classifyDeliverArgument", "resolveDeliverArgument"],
  },
  {
    module: "resume_classifier",
    names: ["resume_classifier", "classifyResume", "resumeChain", "the same classifier"],
  },
  { module: "target_repo", names: ["target_repo.ts", "routeMilestone"] },
  {
    module: "orchestration_config",
    names: ["orchestration_config", "readOrchestrationConfig"],
  },
  {
    module: "merge_policy_ratchet",
    names: ["merge_policy_ratchet", "runMergePolicy", "overrideFromStatement"],
  },
  { module: "gate_class", names: ["gate_class.ts", "relayRequired", "classifyGate"] },
] as const;

/**
 * The imperative markers the retired orders carry, measured off the surface as
 * it stood when this FR opened (SKILL.md lines 34, 50, 83, 106, 151, 203).
 */
const ORDER_MARKERS = [
  "by eye",
  "judging it in prose",
  "prose judgement",
  "route on the configured value directly",
] as const;

/** Lines that pair a reference to `names` with a delegation imperative. */
function survivingOrders(text: string, names: readonly string[]): string[] {
  return text
    .split("\n")
    .filter(
      (line) =>
        names.some((name) => line.includes(name)) &&
        ORDER_MARKERS.some((marker) => line.toLowerCase().includes(marker)),
    )
    .map((line) => line.trim().slice(0, 120));
}

describe("AC-STE-514.2 — the six prose orders are retired", () => {
  for (const { module, names } of DELEGATED_MODULES) {
    test(`no order survives for ${module}`, () => {
      expect({
        module,
        survivors: survivingOrders(read(DELIVER_SKILL), names),
      }).toEqual({ module, survivors: [] });
    });
  }

  test("the by-eye imperative appears nowhere on the operative surface", () => {
    // MATCH ON THE WHOLE LINE, EXCERPT ONLY FOR THE REPORT. Matching on a
    // truncated excerpt is a false green here: every retired order on this
    // surface sits past column 120 of its paragraph line.
    const hits = read(DELIVER_SKILL)
      .split("\n")
      .map((raw, i) => ({ line: i + 1, raw }))
      .filter((row) => /by eye/i.test(row.raw))
      .map((row) => ({ line: row.line, excerpt: row.raw.trim().slice(0, 120) }));
    expect(hits).toEqual([]);
  });

  test("the command line is what replaced them — it is present", () => {
    // Retiring the orders without landing the replacement would satisfy every
    // leg above while leaving the surface with no instruction at all.
    expect(commandLines(read(DELIVER_SKILL)).length).toBe(1);
  });
});

// ===========================================================================
// AC.3 — the predicate compares the rendering against the captured bytes.
// ===========================================================================

describe("AC-STE-514.3 — bytes, not a retelling", () => {
  test("a gate that shows the bytes inside its own prompt text passes", async () => {
    const mod = await loadModule();
    const verdict = mod.verifyResumeGateRender(FAITHFUL_GATE, CAPTURE);
    expect({ ok: verdict.ok, reasons: [...verdict.reasons] }).toEqual({ ok: true, reasons: [] });
  });

  test("a gate that IS the bytes, with nothing around them, passes", async () => {
    const mod = await loadModule();
    expect(mod.verifyResumeGateRender(CAPTURE, CAPTURE).ok).toBe(true);
  });

  test("CRLF in the rendering does not break the comparison", async () => {
    // This repo has lost an entire transform to CRLF twice. Line endings are
    // normalized on both sides; nothing else is.
    const mod = await loadModule();
    expect(mod.verifyResumeGateRender(FAITHFUL_GATE.replaceAll("\n", "\r\n"), CAPTURE).ok).toBe(
      true,
    );
  });

  test("the same lines, reordered, is a retelling and fails", async () => {
    const mod = await loadModule();
    const lines = CAPTURE.split("\n");
    const shuffled = [lines[1]!, lines[0]!, ...lines.slice(2)].join("\n");
    expect(mod.verifyResumeGateRender(shuffled, CAPTURE).ok).toBe(false);
  });

  test("one field reworded is a retelling and fails", async () => {
    const mod = await loadModule();
    const edited = CAPTURE.replace("merge_policy: offer -> offer", "merge_policy: offer");
    expect(edited).not.toBe(CAPTURE); // the mutation applied
    expect(mod.verifyResumeGateRender(edited, CAPTURE).ok).toBe(false);
  });

  test("a blank capture is never a pass", async () => {
    // The empty string is contained in every string. Without this guard the
    // predicate grades every gate `ok` the day the capture goes missing.
    const mod = await loadModule();
    for (const capture of ["", "   ", "\n\n"]) {
      const verdict = mod.verifyResumeGateRender(FAITHFUL_GATE, capture);
      expect({
        capture: JSON.stringify(capture),
        ok: verdict.ok,
        namesTheCause: verdict.reasons.some((r: string) => r.includes(mod.GATE_RENDER_NO_CAPTURE)),
      }).toEqual({ capture: JSON.stringify(capture), ok: false, namesTheCause: true });
    }
  });
});

// ===========================================================================
// AC.4 — falsified against the real failure.
// ===========================================================================

/**
 * The assertion AC.4 IS. Factored out so it can be run against the shipped
 * predicate (must hold) and against a permissive stand-in (must throw) — a leg
 * that cannot fail on an accepting predicate is not evidence about this FR.
 */
function assertRejectsRealParaphrase(
  predicate: (rendered: string, capture: string) => { ok: boolean },
  capture: string,
): void {
  expect({
    fixture: "REAL_PARAPHRASE",
    ok: predicate(REAL_PARAPHRASE, capture).ok,
  }).toEqual({ fixture: "REAL_PARAPHRASE", ok: false });
  expect({
    fixture: "REAL_PARAPHRASE_GATE",
    ok: predicate(REAL_PARAPHRASE_GATE, capture).ok,
  }).toEqual({ fixture: "REAL_PARAPHRASE_GATE", ok: false });
}

describe("AC-STE-514.4 — the M130 emission is rejected", () => {
  test("the one-line prose a worker actually produced returns false", async () => {
    const mod = await loadModule();
    assertRejectsRealParaphrase(mod.verifyResumeGateRender, CAPTURE);
  });

  test("it is rejected against bytes the command really printed", async () => {
    // Not only against bytes this file composed: run the shipped command and
    // re-run the rejection against its stdout.
    const fixture = newFixture();
    const result = runTokens(
      ["bun", "run", DECISION_COMMAND, FIXTURE_MILESTONE, fixture],
      PLUGIN_ROOT,
    );
    expect({ code: result.code, hasState: result.stdout.includes("resume_state:") }).toEqual({
      code: 0,
      hasState: true,
    });
    const mod = await loadModule();
    assertRejectsRealParaphrase(mod.verifyResumeGateRender, result.stdout);
  });

  test("a predicate that ACCEPTS the M130 emission fails this test", () => {
    // The falsifiability half: the assertion above is only worth something if
    // an accepting predicate reddens it. This proves it does.
    const permissive = () => ({ ok: true, reasons: [] as string[] });
    expect(() => assertRejectsRealParaphrase(permissive, CAPTURE)).toThrow();
  });

  test("the predicate is not trivially always-false", async () => {
    // The mirror guard. `() => ({ ok: false })` satisfies every rejection leg in
    // this file, so rejection alone is not evidence: the faithful render must
    // pass through the SAME function that rejected the paraphrase.
    const mod = await loadModule();
    const verdict = mod.verifyResumeGateRender(FAITHFUL_GATE, CAPTURE);
    expect({ faithful: verdict.ok, paraphrase: mod.verifyResumeGateRender(REAL_PARAPHRASE, CAPTURE).ok }).toEqual({
      faithful: true,
      paraphrase: false,
    });
  });
});

// ===========================================================================
// AC.5 — absent and paraphrased are distinguishable in the reasons.
// ===========================================================================

describe("AC-STE-514.5 — absence and paraphrase are named apart", () => {
  test("the two reason codes are distinct constants", async () => {
    const mod = await loadModule();
    expect(mod.GATE_RENDER_ABSENT).not.toBe(mod.GATE_RENDER_PARAPHRASED);
    expect(typeof mod.GATE_RENDER_ABSENT).toBe("string");
    expect(typeof mod.GATE_RENDER_PARAPHRASED).toBe("string");
  });

  test("an absent gate is reported as an absence, not a paraphrase", async () => {
    const mod = await loadModule();
    for (const rendered of ["", "   ", ABSENT_GATE, null, undefined]) {
      const verdict = mod.verifyResumeGateRender(rendered, CAPTURE);
      const reasons = verdict.reasons.join(" | ");
      expect({
        rendered: JSON.stringify(rendered),
        ok: verdict.ok,
        absent: reasons.includes(mod.GATE_RENDER_ABSENT),
        paraphrased: reasons.includes(mod.GATE_RENDER_PARAPHRASED),
      }).toEqual({
        rendered: JSON.stringify(rendered),
        ok: false,
        absent: true,
        paraphrased: false,
      });
    }
  });

  test("a paraphrase is reported as a paraphrase, not an absence", async () => {
    const mod = await loadModule();
    for (const rendered of [REAL_PARAPHRASE, REAL_PARAPHRASE_GATE, VALUE_ONLY_PARAPHRASE]) {
      const verdict = mod.verifyResumeGateRender(rendered, CAPTURE);
      const reasons = verdict.reasons.join(" | ");
      expect({
        rendered: rendered.slice(0, 48),
        ok: verdict.ok,
        paraphrased: reasons.includes(mod.GATE_RENDER_PARAPHRASED),
        absent: reasons.includes(mod.GATE_RENDER_ABSENT),
      }).toEqual({
        rendered: rendered.slice(0, 48),
        ok: false,
        paraphrased: true,
        absent: false,
      });
    }
  });

  test("the two verdicts do not read alike", async () => {
    // Distinguishable IN THE REASONS: a reader holding one verdict must be able
    // to tell which remedy they need without holding the other.
    const mod = await loadModule();
    const absent = mod.verifyResumeGateRender(ABSENT_GATE, CAPTURE).reasons.join(" | ");
    const paraphrased = mod.verifyResumeGateRender(REAL_PARAPHRASE, CAPTURE).reasons.join(" | ");
    expect(absent.length).toBeGreaterThan(0);
    expect(paraphrased.length).toBeGreaterThan(0);
    expect(absent).not.toBe(paraphrased);
  });
});

// ===========================================================================
// The surface clauses — AC.6, AC.8, and the AC.1 command line — plus the
// parity (AC.10) and mutation (AC.11) machinery they share.
// ===========================================================================

interface SurfaceClause {
  readonly id: string;
  readonly what: string;
  /** Identifies candidate lines. Mutation deletes exactly these. */
  readonly anchor: (line: string) => boolean;
  /** All of these must hold on one anchored line for the clause to be present. */
  readonly required: readonly { readonly name: string; readonly re: RegExp }[];
}

const PLACEMENT_CLAUSE: SurfaceClause = {
  id: "AC.6",
  what: "an edit at the gate may reorder or drop steps, never change a placement",
  anchor: (line) => /placement/i.test(line) && /\bedit/i.test(line),
  required: [
    { name: "reorder", re: /reorder/i },
    { name: "drop", re: /drop/i },
    { name: "prohibition", re: /\b(never|not|cannot|may not)\b/i },
    { name: "placement", re: /placement/i },
  ],
};

const TOP_OF_PIPELINE_CLAUSE: SurfaceClause = {
  id: "AC.8",
  what: "/deliver is the top of a pipeline and never a step inside one",
  anchor: (line) => /\/deliver/.test(line) && /(never|not) a step/i.test(line),
  required: [
    { name: "top-of-pipeline", re: /top of/i },
    { name: "never-a-step", re: /(never|not) a step/i },
    { name: "worker", re: /worker/i },
    { name: "what-to-key-in", re: /\/implement/ },
  ],
};

const COMMAND_CLAUSE: SurfaceClause = {
  id: "AC.1",
  what: "the one runnable decision-command line",
  anchor: (line) => line.includes("deliver_decision.ts"),
  required: [
    { name: "bun-run", re: /^\s*bun run\b/ },
    { name: "the-module", re: /adapters\/_shared\/src\/deliver_decision\.ts/ },
  ],
};

const PARITY_CLAUSES = [COMMAND_CLAUSE, PLACEMENT_CLAUSE, TOP_OF_PIPELINE_CLAUSE] as const;

/** Anchored lines on `text`, with their 1-based line numbers. */
function anchoredLines(text: string, clause: SurfaceClause): { line: number; raw: string }[] {
  return text
    .split("\n")
    .map((raw, i) => ({ line: i + 1, raw }))
    .filter((row) => clause.anchor(row.raw));
}

/** The first anchored line satisfying every requirement, or null. */
function clauseLine(text: string, clause: SurfaceClause): string | null {
  for (const { raw } of anchoredLines(text, clause)) {
    if (clause.required.every((r) => r.re.test(raw))) return raw;
  }
  return null;
}

/** Which requirements a surface satisfies — the vector, for a readable diff. */
function clauseVector(text: string, clause: SurfaceClause): Record<string, boolean> {
  const anchored = anchoredLines(text, clause).map((row) => row.raw);
  const out: Record<string, boolean> = { anchored: anchored.length > 0 };
  for (const { name, re } of clause.required) {
    out[name] = anchored.some((raw) => re.test(raw));
  }
  return out;
}

interface ParityVerdict {
  readonly presentOnSkill: boolean;
  readonly presentOnReference: boolean;
  readonly consistent: boolean;
  readonly ok: boolean;
}

/**
 * Parity for one clause across the two surfaces.
 *
 * Present on BOTH — equal-but-empty is not parity, so "both surfaces say
 * nothing" fails here rather than passing as agreement (the M131/M132 drift
 * class this FR is written against). Consistent means the two surfaces satisfy
 * the SAME requirement vector, so a rule that landed on one in a weaker form
 * than on the other fails too.
 */
function parityVerdict(
  clause: SurfaceClause,
  skillText: string,
  referenceText: string,
): ParityVerdict {
  const presentOnSkill = clauseLine(skillText, clause) !== null;
  const presentOnReference = clauseLine(referenceText, clause) !== null;
  const skillVector = JSON.stringify(clauseVector(skillText, clause));
  const referenceVector = JSON.stringify(clauseVector(referenceText, clause));
  const consistent = skillVector === referenceVector;
  return {
    presentOnSkill,
    presentOnReference,
    consistent,
    ok: presentOnSkill && presentOnReference && consistent,
  };
}

/** Delete every anchored line for `clause`. Returns the text and what it cut. */
function deleteClause(
  text: string,
  clause: SurfaceClause,
): { mutated: string; removed: number } {
  const lines = text.split("\n");
  const kept = lines.filter((line) => !clause.anchor(line));
  return { mutated: kept.join("\n"), removed: lines.length - kept.length };
}

// ===========================================================================
// AC.6 — placement is not editable at the gate.
// ===========================================================================

describe("AC-STE-514.6 — an edit may reorder or drop, never re-place", () => {
  test("the operative surface states it", () => {
    expect({
      surface: SKILL_LABEL,
      ...clauseVector(read(DELIVER_SKILL), PLACEMENT_CLAUSE),
    }).toEqual({
      surface: SKILL_LABEL,
      anchored: true,
      reorder: true,
      drop: true,
      prohibition: true,
      placement: true,
    });
  });
});

// ===========================================================================
// AC.7 — the undefined phrase is deleted, not redefined.
// ===========================================================================

describe("AC-STE-514.7 — 'orchestrating session' reaches zero on the operative surface", () => {
  test("zero occurrences remain", () => {
    // The phrase sits at the END of a long paragraph line, so the match runs
    // against the whole line and only the report is truncated.
    const hits = read(DELIVER_SKILL)
      .split("\n")
      .map((raw, i) => ({ line: i + 1, raw }))
      .filter((row) => /orchestrating session/i.test(row.raw))
      .map((row) => ({ line: row.line, excerpt: row.raw.trim().slice(-120) }));
    expect(hits).toEqual([]);
  });

  test("it was deleted, not redefined — no definition of it survives either", () => {
    // "Deleted, not redefined" is the FR's own wording: a surface that added
    // "by 'this orchestrating session' we mean ..." would zero no occurrence.
    // The leg above already covers that; this one states the intent so a future
    // reader does not weaken the check into "mentions it at most once".
    expect(/orchestrating session/i.test(read(DELIVER_SKILL))).toBe(false);
  });
});

// ===========================================================================
// AC.8 — the delivery pipeline is the top of a pipeline, never a step in one.
// ===========================================================================

describe("AC-STE-514.8 — /deliver is a top, not a step", () => {
  test("the operative surface states the rule and names what to key in instead", () => {
    expect({
      surface: SKILL_LABEL,
      ...clauseVector(read(DELIVER_SKILL), TOP_OF_PIPELINE_CLAUSE),
    }).toEqual({
      surface: SKILL_LABEL,
      anchored: true,
      "top-of-pipeline": true,
      "never-a-step": true,
      worker: true,
      "what-to-key-in": true,
    });
  });
});

// ===========================================================================
// AC.9 — the spawn pre-flight probe gains a trigger on the resume path.
// ===========================================================================

/** The body of a `## `-delimited section, by heading prefix. */
function section(text: string, headingPrefix: string): string {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.startsWith(headingPrefix));
  if (start === -1) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^## /.test(line));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

describe("AC-STE-514.9 — the pre-flight probe triggers on the resume path", () => {
  test("the pre-flight section names the resume path as a trigger", () => {
    // Today the probe is mandated "before Phase 1 begins" and a resume never
    // enters Phase 1 — so the one phase the probe guards is the one the resume
    // path skips, and the probe never runs on it.
    const preflight = section(read(DELIVER_SKILL), "## Pre-flight");
    expect({
      section: "## Pre-flight",
      namesPhase1: /phase 1/i.test(preflight),
      namesResume: /resum/i.test(preflight),
    }).toEqual({ section: "## Pre-flight", namesPhase1: true, namesResume: true });
  });

  test("the resume section points back at the probe", () => {
    // The other half: the section describing the path has to say the probe runs
    // on it, or the trigger lives only in the section a resume never reads.
    const resume = section(read(DELIVER_SKILL), "## Resume");
    expect({
      section: "## Resume",
      namesTheProbe: /pre-flight|spawn-agent/i.test(resume),
    }).toEqual({ section: "## Resume", namesTheProbe: true });
  });
});

// ===========================================================================
// AC.10 — sibling-surface parity for the AC.1, AC.6 and AC.8 clauses.
// ===========================================================================

describe("AC-STE-514.10 — parity across the operative surface and its reference", () => {
  for (const clause of PARITY_CLAUSES) {
    test(`${clause.id} — ${clause.what} — lands on both surfaces and they agree`, () => {
      const verdict = parityVerdict(clause, read(DELIVER_SKILL), read(DELIVER_REFERENCE));
      expect({
        clause: clause.id,
        ...verdict,
        skill: clauseVector(read(DELIVER_SKILL), clause),
        reference: clauseVector(read(DELIVER_REFERENCE), clause),
      }).toEqual({
        clause: clause.id,
        presentOnSkill: true,
        presentOnReference: true,
        consistent: true,
        ok: true,
        skill: clauseVector(read(DELIVER_SKILL), clause),
        reference: clauseVector(read(DELIVER_SKILL), clause),
      });
    });
  }

  test("the reference carries exactly one decision-command line too", () => {
    expect({
      surface: REFERENCE_LABEL,
      count: commandLines(read(DELIVER_REFERENCE)).length,
    }).toEqual({ surface: REFERENCE_LABEL, count: 1 });
  });

  test("the two surfaces spell the command identically", () => {
    // TWO NULLS ARE NOT AGREEMENT. Comparing `skillLine ?? null` against itself
    // is satisfied by both surfaces carrying no command at all, which is the
    // pre-FR state — so presence is asserted first, then equality.
    const [skillLine] = commandLines(read(DELIVER_SKILL));
    const [referenceLine] = commandLines(read(DELIVER_REFERENCE));
    expect({
      skillPresent: typeof skillLine === "string" && skillLine.length > 0,
      referencePresent: typeof referenceLine === "string" && referenceLine.length > 0,
    }).toEqual({ skillPresent: true, referencePresent: true });
    expect(referenceLine).toBe(skillLine!);
  });
});

// ===========================================================================
// AC.11 — the parity assertion is mutation-verified in BOTH directions.
// ===========================================================================

describe("AC-STE-514.11 — deleting from either surface alone turns AC.10 red", () => {
  for (const clause of PARITY_CLAUSES) {
    test(`${clause.id} — deleting from the operative surface reddens it`, () => {
      const skillText = read(DELIVER_SKILL);
      const referenceText = read(DELIVER_REFERENCE);
      expect(parityVerdict(clause, skillText, referenceText).ok).toBe(true);

      const { mutated, removed } = deleteClause(skillText, clause);
      // The mutation must APPLY: a mutation that never landed reads as a pass.
      expect({ clause: clause.id, surface: SKILL_LABEL, applied: removed > 0 }).toEqual({
        clause: clause.id,
        surface: SKILL_LABEL,
        applied: true,
      });
      expect({
        clause: clause.id,
        ...parityVerdict(clause, mutated, referenceText),
      }).toEqual({
        clause: clause.id,
        presentOnSkill: false,
        presentOnReference: true,
        consistent: false,
        ok: false,
      });
    });

    test(`${clause.id} — deleting from the reference reddens it`, () => {
      const skillText = read(DELIVER_SKILL);
      const referenceText = read(DELIVER_REFERENCE);
      expect(parityVerdict(clause, skillText, referenceText).ok).toBe(true);

      const { mutated, removed } = deleteClause(referenceText, clause);
      expect({ clause: clause.id, surface: REFERENCE_LABEL, applied: removed > 0 }).toEqual({
        clause: clause.id,
        surface: REFERENCE_LABEL,
        applied: true,
      });
      expect({
        clause: clause.id,
        ...parityVerdict(clause, skillText, mutated),
      }).toEqual({
        clause: clause.id,
        presentOnSkill: true,
        presentOnReference: false,
        consistent: false,
        ok: false,
      });
    });
  }
});

// ###########################################################################
// AUDIT-RAISED ROUND — 2026-08-25.
//
// The milestone-level audit of the shipped STE-514 work measured six defects
// the legs above structurally could not see. Everything below is additive: no
// leg above is weakened, deleted, or re-scoped.
//
// THE CONTRACT THIS ROUND ADDS, stated once so the implementer does not guess:
//
//     export const GATE_RENDER_CAPTURE_NOT_A_RECORD = "gate-render-capture-not-a-record";
//
//   * THE CAPTURE IS VALIDATED BEFORE IT GRADES ANYTHING (item 1). Both
//     parameters are plain strings from the same caller that composed the
//     rendering, so nothing tied `capturedStdout` to an execution — and
//     measured on the shipped module,
//     `verifyResumeGateRender(REAL_PARAPHRASE, REAL_PARAPHRASE)` returned
//     `{ok:true, reasons:[]}`: the exact emission AC.4 exists to reject,
//     greened by handing it in as its own capture. A non-blank capture that
//     does not carry all eight `DECISION_FIELDS` as labelled lines is not a
//     decision record and cannot grade one — `ok: false` with
//     `GATE_RENDER_CAPTURE_NOT_A_RECORD`, a code distinct from ABSENT,
//     PARAPHRASED and NO_CAPTURE because the remedy is distinct (run the
//     command and capture its stdout, rather than fix the rendering).
//     Precedence: blank ⇒ NO_CAPTURE first, then the record check, then
//     containment. Compare STE-516, which refuses a handle "the reporting
//     stage composed", and STE-515, which reads a capture off disk.
//
//   * THE PREDICATE HAS AN INVOKER (item 2). Measured: `verifyResumeGateRender`
//     was imported by exactly one file, its own test, carried no
//     `import.meta.main` entry — unlike `deliver_decision.ts:313` and
//     `spawn_receipt.ts:445`, the two sibling M133 modules — and was named on
//     NEITHER surface, while `verifyDeliverStageCapture` is named at
//     SKILL.md:213, :215 and deliver-reference.md:197 precisely so an LLM
//     reader reaches it. SKILL.md:83 told the reader to paste verbatim and
//     nothing graded the paste. This is the M132 `captureSkipBaseline` shape.
//     So: an `import.meta.main` block on the shipped idiom —
//
//         bun run resume_gate_render.ts <argument> [projectRoot] <renderedPath>
//
//     (SUPERSEDED SIGNATURE, round 3 item A2. This round shipped
//     `<renderedPath> <capturedStdoutPath>`, and a capture handed in as a file
//     is a capture the tool cannot authenticate — see the round-3 block at the
//     foot of this file. The channel discipline below is unchanged.)
//
//     — exit 0 with the affirmative verdict on STDOUT when the verdict is
//     `ok` (a silent exit 0 is what a module with no CLI already does, so
//     saying so is the only way the leg can fail), non-zero otherwise with the
//     canonical `Refusing:` / `Remedy:` / `Context:` envelope on STDERR
//     carrying the reason code, and NOTHING on stdout on a failure (the same
//     channel discipline both siblings keep). Under `import` the block does
//     not run, so the module stays side-effect free. And both surfaces name
//     the predicate the way they name `verifyDeliverStageCapture`,
//     mutation-verified in both directions.
//
//   * A BOM ON THE CAPTURE IS A FALSE RED, NOT A RETELLING (item 6). Measured:
//     `verifyResumeGateRender(FAITHFUL_GATE, "\uFEFF" + CAPTURE)` returned
//     `gate-render-paraphrased` on a FAITHFUL render. The header's stated
//     reason for stopping at `\r\n` — that further normalization "would start
//     accepting the retellings this module exists to reject" — is true of
//     whitespace runs, case and punctuation and FALSE of a leading U+FEFF,
//     which accepts no retelling and only removes that false red. Sibling
//     modules already strip it (`carrier_phrase_probe.ts:125`,
//     `first_turn_refusal_marker.ts:109`, `deliver_stage_capture.ts:254`).
//
//     CORRECTED, round 3 item C. An earlier draft of this paragraph also cited
//     `archive_fr.ts:81`. That citation was false: `archive_fr.ts` PRESERVES a
//     BOM, lifting it to the front of a synthesized frontmatter block so a
//     U+FEFF is not buried mid-document. It strips nothing. The round-3 legs
//     below check every module a BOM-strip claim cites, on this file and on the
//     module's own header, so a fourth false citation cannot be written here
//     either. Strip it on both sides, before the record check —
//     and the header's stated reason must then match what the code does.
// ###########################################################################

/** A module's own header: everything above its first `import` line. */
function moduleHeader(source: string): string {
  const parts = source.split(/^import /m);
  return parts[0] ?? source;
}

/** Write `contents` into a fresh temp dir and hand back the path. */
function tempFile(name: string, contents: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "ste514-cli-")));
  const path = join(dir, name);
  writeFileSync(path, contents);
  return path;
}

/**
 * The shipped decision command, run for real against `fixture`. Its stdout is
 * the ONLY thing in this file that counts as a capture from here on: round 3
 * item A2 measured that a capture handed in as a file authenticates nothing.
 */
function realCapture(fixture: string): string {
  const result = runTokens(
    ["bun", "run", DECISION_COMMAND, FIXTURE_MILESTONE, fixture],
    PLUGIN_ROOT,
  );
  if (result.code !== 0) {
    throw new Error(`the decision command refused on the fixture tree: ${result.stderr}`);
  }
  return result.stdout;
}

/** A gate that shows `capture` wrapped in the gate's own prompt text. */
function gateWrapping(capture: string): string {
  return [
    `Before anything is spawned, here is the delivery decision for ${FIXTURE_MILESTONE}:`,
    "",
    capture,
    "",
    "Confirm this chain, edit it, or abort.",
  ].join("\n");
}

/**
 * The module's CLI under its AUTHENTICATED contract (round 3 item A2):
 * `<argument> [projectRoot] <renderedPath>`. There is no capture argument —
 * the tool runs the decision itself, so the bytes it grades against are the
 * ones that command just produced, in this process, now.
 *
 * MIGRATED, NOT WEAKENED. Every leg that ran through the previous two-file form
 * is kept below with the same subject; each one is now additionally grounded in
 * an execution it does not supply. The one leg whose subject the new contract
 * DELETES — a retelling handed in as its own capture — is replaced by the leg
 * that proves the door it came through is gone, and its predicate-level
 * coverage in ITEM 1 is untouched.
 */
function runGateCli(
  rendered: string,
  opts: { readonly argument?: string; readonly projectRoot?: string } = {},
): RunResult {
  const fixture = opts.projectRoot ?? newFixture();
  return runTokens(
    [
      "bun",
      "run",
      RENDER_MODULE,
      opts.argument ?? FIXTURE_MILESTONE,
      fixture,
      tempFile("rendered.txt", rendered),
    ],
    PLUGIN_ROOT,
  );
}

// ===========================================================================
// ITEM 1 (HIGH) — a retelling supplied as its own capture must not pass.
// Extends AC.3 / AC.5.
// ===========================================================================

/** Drop the line that carries `field:` from a rendered record. */
function withoutField(record: string, field: string): string {
  const kept = record.split("\n").filter((line) => !line.startsWith(`${field}:`));
  return kept.join("\n");
}

/**
 * The assertion item 1 IS, factored out so it can be run against the shipped
 * predicate (must hold) and against the pre-audit behaviour — plain
 * containment — which must throw. A guard that cannot fail on the predicate it
 * replaces is not evidence.
 */
function assertRefusesNonRecordCapture(
  predicate: (rendered: string, capture: string) => { ok: boolean },
): void {
  // The auditor's first exact probe, verbatim.
  expect({
    probe: "paraphrase-as-its-own-capture",
    ok: predicate(REAL_PARAPHRASE, REAL_PARAPHRASE).ok,
  }).toEqual({ probe: "paraphrase-as-its-own-capture", ok: false });
  // The auditor's second exact probe, verbatim.
  expect({
    probe: "truncated-capture",
    ok: predicate(
      "resume_state: ready_to_implement\n(everything else as before)",
      "resume_state: ready_to_implement",
    ).ok,
  }).toEqual({ probe: "truncated-capture", ok: false });
}

describe("ITEM 1 — the capture is validated as a decision record before it grades anything", () => {
  test("the auditor's two exact probes are refused", async () => {
    const mod = await loadModule();
    assertRefusesNonRecordCapture(mod.verifyResumeGateRender);
  });

  test("plain containment — the pre-audit behaviour — fails these probes", () => {
    // FALSIFIABILITY. The shipped module's `text.includes(capture)` graded both
    // probes `{ok:true, reasons:[]}` when the audit measured it. This proves the
    // assertion above reddens on exactly that predicate.
    const containment = (rendered: string, capture: string) => ({
      ok: capture.trim().length > 0 && rendered.includes(capture),
      reasons: [] as string[],
    });
    expect(() => assertRefusesNonRecordCapture(containment)).toThrow();
  });

  test("the refusal carries its own reason code, distinct from the other three", async () => {
    const mod = await loadModule();
    const codes = [
      mod.GATE_RENDER_ABSENT,
      mod.GATE_RENDER_PARAPHRASED,
      mod.GATE_RENDER_NO_CAPTURE,
      mod.GATE_RENDER_CAPTURE_NOT_A_RECORD,
    ];
    expect({
      allStrings: codes.every((c) => typeof c === "string" && c.length > 0),
      distinct: new Set(codes).size,
    }).toEqual({ allStrings: true, distinct: 4 });
  });

  test("each probe is reported with THAT code, not as an absence or a paraphrase", async () => {
    const mod = await loadModule();
    const cases = [
      { probe: "paraphrase-as-its-own-capture", rendered: REAL_PARAPHRASE, capture: REAL_PARAPHRASE },
      {
        probe: "truncated-capture",
        rendered: "resume_state: ready_to_implement\n(everything else as before)",
        capture: "resume_state: ready_to_implement",
      },
    ];
    for (const { probe, rendered, capture } of cases) {
      const reasons = mod.verifyResumeGateRender(rendered, capture).reasons.join(" | ");
      expect({
        probe,
        notARecord: reasons.includes(mod.GATE_RENDER_CAPTURE_NOT_A_RECORD),
        absent: reasons.includes(mod.GATE_RENDER_ABSENT),
        paraphrased: reasons.includes(mod.GATE_RENDER_PARAPHRASED),
        noCapture: reasons.includes(mod.GATE_RENDER_NO_CAPTURE),
      }).toEqual({
        probe,
        notARecord: true,
        absent: false,
        paraphrased: false,
        noCapture: false,
      });
    }
  });

  test("every one of the eight fields is load-bearing in that check", async () => {
    // Per-field, never collective: a check that only looked for `resume_state:`
    // would pass the truncated probe the moment someone added a second line.
    // Each leg hands in a rendering that DOES carry the mutilated capture's
    // bytes verbatim, so containment alone would grade every one of them `ok`.
    const mod = await loadModule();
    for (const field of DECISION_FIELDS) {
      const mutilated = withoutField(CAPTURE, field);
      expect(mutilated).not.toBe(CAPTURE); // the mutation applied
      const verdict = mod.verifyResumeGateRender(`Here it is:\n\n${mutilated}\n\nConfirm?`, mutilated);
      expect({
        field,
        ok: verdict.ok,
        notARecord: verdict.reasons.join(" | ").includes(mod.GATE_RENDER_CAPTURE_NOT_A_RECORD),
      }).toEqual({ field, ok: false, notARecord: true });
    }
  });

  test("the reason names the fields that were missing", async () => {
    // The remedy is "run the command and capture its stdout" — actionable only
    // if the reader can see WHAT the capture was missing.
    const mod = await loadModule();
    const capture = "resume_state: ready_to_implement";
    const reasons = mod
      .verifyResumeGateRender(`${capture}\n(everything else as before)`, capture)
      .reasons.join(" | ");
    const missing = DECISION_FIELDS.filter((f) => f !== "resume_state");
    expect({
      unnamed: missing.filter((f) => !reasons.includes(f)),
    }).toEqual({ unnamed: [] });
  });

  test("the guard is not always-false — a whole record still grades the rendering", async () => {
    // The mirror guard. `() => ({ok:false})` satisfies every refusal above, so
    // refusal alone is not evidence: a real capture must still pass THROUGH the
    // same function, and a paraphrase of a real capture must still be reported
    // as a paraphrase rather than swallowed by the new code.
    const mod = await loadModule();
    const faithful = mod.verifyResumeGateRender(FAITHFUL_GATE, CAPTURE);
    const paraphrased = mod.verifyResumeGateRender(REAL_PARAPHRASE, CAPTURE);
    expect({
      faithful: faithful.ok,
      faithfulReasons: [...faithful.reasons],
      paraphraseOk: paraphrased.ok,
      stillParaphrased: paraphrased.reasons.join(" | ").includes(mod.GATE_RENDER_PARAPHRASED),
      notMisreported: paraphrased.reasons
        .join(" | ")
        .includes(mod.GATE_RENDER_CAPTURE_NOT_A_RECORD),
    }).toEqual({
      faithful: true,
      faithfulReasons: [],
      paraphraseOk: false,
      stillParaphrased: true,
      notMisreported: false,
    });
  });

  test("a blank capture is still NO_CAPTURE, not the new code", async () => {
    // PRECEDENCE. Collapsing the two would lose the distinction AC.5 is about:
    // "nothing was captured" and "what was captured is not a record" send the
    // reader to different places.
    const mod = await loadModule();
    for (const capture of ["", "   ", "\n\n"]) {
      const reasons = mod.verifyResumeGateRender(FAITHFUL_GATE, capture).reasons.join(" | ");
      expect({
        capture: JSON.stringify(capture),
        noCapture: reasons.includes(mod.GATE_RENDER_NO_CAPTURE),
        notARecord: reasons.includes(mod.GATE_RENDER_CAPTURE_NOT_A_RECORD),
      }).toEqual({
        capture: JSON.stringify(capture),
        noCapture: true,
        notARecord: false,
      });
    }
  });

  test("bytes the real command printed pass the record check", async () => {
    // Grounded in an execution, not only in bytes this file composed: the check
    // must accept what `deliver_decision.ts` actually prints, or it has closed
    // the seam by rejecting everything.
    const fixture = newFixture();
    const result = runTokens(["bun", "run", DECISION_COMMAND, FIXTURE_MILESTONE, fixture], PLUGIN_ROOT);
    expect(result.code).toBe(0);
    const mod = await loadModule();
    const verdict = mod.verifyResumeGateRender(`Gate:\n\n${result.stdout}\n\nConfirm?`, result.stdout);
    expect({ ok: verdict.ok, reasons: [...verdict.reasons] }).toEqual({ ok: true, reasons: [] });
  });
});

// ===========================================================================
// ITEM 2 (HIGH) — the predicate has an invoker: a CLI entry and two surfaces
// that name it. Extends AC.3 (reachability) and AC.10/AC.11 (parity).
// ===========================================================================

describe("ITEM 2a — the module carries the shipped `import.meta.main` idiom", () => {
  test("the guard is present, spelled as the two sibling M133 modules spell it", () => {
    const GUARD = /^if \(import\.meta\.main\) \{/m;
    const siblings = {
      deliver_decision: GUARD.test(read(join(SRC_DIR, "deliver_decision.ts"))),
      spawn_receipt: GUARD.test(read(join(SRC_DIR, "spawn_receipt.ts"))),
    };
    expect({
      ...siblings,
      resume_gate_render: GUARD.test(read(RENDER_MODULE)),
    }).toEqual({ deliver_decision: true, spawn_receipt: true, resume_gate_render: true });
  });

  test("importing the module still prints nothing — the entry is side-effect free", () => {
    const probe = tempFile("import_probe.ts", `await import(${JSON.stringify(RENDER_MODULE)});\n`);
    const result = runTokens(["bun", "run", probe], PLUGIN_ROOT);
    expect({ code: result.code, stdout: result.stdout, stderr: result.stderr.slice(0, 300) }).toEqual({
      code: 0,
      stdout: "",
      stderr: "",
    });
  });
});

describe("ITEM 2b — the CLI grades a real rendering against a real capture", () => {
  test("a faithful gate exits 0 and SAYS SO on stdout", () => {
    // MEASURED: asserting only `code === 0` here passed against a module with
    // NO CLI at all — `bun run` on a module whose top level does nothing exits
    // 0 with an empty stderr. A leg that a no-op satisfies is not evidence, so
    // the affirmative verdict must reach stdout, the way both sibling modules
    // print their record on success.
    //
    // ROUND 3: the rendering is now built from bytes the command really
    // printed, and the CLI is handed no capture at all — so a pass also proves
    // it obtained those bytes itself.
    const fixture = newFixture();
    const result = runGateCli(gateWrapping(realCapture(fixture)), { projectRoot: fixture });
    expect({
      code: result.code,
      stdoutNonEmpty: result.stdout.trim().length > 0,
      saysOk: /\bok\b/i.test(result.stdout),
      stderr: result.stderr.slice(0, 400),
    }).toEqual({ code: 0, stdoutNonEmpty: true, saysOk: true, stderr: "" });
  });

  test("the M130 emission exits non-zero, naming the paraphrase code on stderr", () => {
    const result = runGateCli(REAL_PARAPHRASE_GATE);
    expect({
      nonZero: result.code !== 0,
      namesCode: result.stderr.includes("gate-render-paraphrased"),
      stdout: result.stdout,
    }).toEqual({ nonZero: true, namesCode: true, stdout: "" });
  });

  test("an absent gate exits non-zero, naming the absence code on stderr", () => {
    const result = runGateCli(ABSENT_GATE);
    expect({
      nonZero: result.code !== 0,
      namesCode: result.stderr.includes("gate-render-absent"),
      stdout: result.stdout,
    }).toEqual({ nonZero: true, namesCode: true, stdout: "" });
  });

  test("a retelling can no longer be handed in as its own capture — the door is gone", () => {
    // THE MIGRATED LEG. Its old subject — `runGateCli(REAL_PARAPHRASE,
    // REAL_PARAPHRASE)` exiting non-zero with the not-a-record code — was a
    // guard on a door the new contract removes: the CLI takes no capture path,
    // so the only way to reach the grader is through an execution. What is
    // asserted now is that the removal is real. The predicate-level coverage
    // of the not-a-record code is untouched in ITEM 1 above.
    // And the refusal must come from the DECISION, not from a grading: under
    // the new contract the first positional is an identity, so two file paths
    // cannot be graded at all. MEASURED on the shipped CLI, this same call
    // refused with `gate-render-capture-not-a-record` — proof it still read the
    // second path as a capture and graded against it.
    const retelling = tempFile("retelling.txt", REAL_PARAPHRASE);
    const result = runTokens(["bun", "run", RENDER_MODULE, retelling, retelling], PLUGIN_ROOT);
    expect({
      nonZero: result.code !== 0,
      envelope: /^Refusing: /m.test(result.stderr),
      stdout: result.stdout,
      gradedItAnyway: /^ok\b/im.test(result.stdout),
      readTheSecondPathAsACapture: result.stderr.includes("gate-render-capture-not-a-record"),
    }).toEqual({
      nonZero: true,
      envelope: true,
      stdout: "",
      gradedItAnyway: false,
      readTheSecondPathAsACapture: false,
    });
  });

  test("every refusal wears the canonical three-line envelope", () => {
    const result = runGateCli(REAL_PARAPHRASE_GATE);
    expect({
      refusing: /^Refusing: /m.test(result.stderr),
      remedy: /^Remedy: /m.test(result.stderr),
      context: /^Context: /m.test(result.stderr),
    }).toEqual({ refusing: true, remedy: true, context: true });
  });

  test("missing arguments are refused, not defaulted", () => {
    const result = runTokens(["bun", "run", RENDER_MODULE], PLUGIN_ROOT);
    expect({
      nonZero: result.code !== 0,
      envelope: /^Refusing: /m.test(result.stderr),
      stdout: result.stdout,
    }).toEqual({ nonZero: true, envelope: true, stdout: "" });
  });

  test("an unreadable path is refused, not silently graded", () => {
    const missing = join(realpathSync(mkdtempSync(join(tmpdir(), "ste514-gone-"))), "nope.txt");
    const result = runTokens(
      ["bun", "run", RENDER_MODULE, FIXTURE_MILESTONE, newFixture(), missing],
      PLUGIN_ROOT,
    );
    expect({
      nonZero: result.code !== 0,
      envelope: /^Refusing: /m.test(result.stderr),
      stdout: result.stdout,
    }).toEqual({ nonZero: true, envelope: true, stdout: "" });
  });
});

/**
 * The predicate named on a surface the way `verifyDeliverStageCapture` is named
 * at SKILL.md:213, :215 and deliver-reference.md:197 — as a call, on a line
 * that says what it does. A module an LLM reader never meets is a module that
 * never runs.
 */
const PREDICATE_CLAUSE: SurfaceClause = {
  id: "ITEM.2c",
  what: "the gate-render predicate is named on the surface, as a call",
  anchor: (line) => line.includes("verifyResumeGateRender"),
  required: [
    { name: "as-a-call", re: /verifyResumeGateRender\([^)]*\)/ },
    { name: "the-module", re: /resume_gate_render/ },
    { name: "says-what-it-does", re: /(grade|verif|reject|paraphrase|retelling|verbatim)/i },
  ],
};

/**
 * The two triggers are MUTUALLY EXCLUSIVE — a run is either fresh or resumed,
 * trigger 1 fires iff fresh and trigger 2 iff resumed — so each run has exactly
 * ONE applicable trigger and it is MANDATORY. `SKILL.md:85` already says this
 * correctly ("the resume path's only trigger for it").
 */
const TRIGGER_EXCLUSIVITY_CLAUSE: SurfaceClause = {
  id: "ITEM.4",
  what: "each run has exactly one applicable trigger and it is mandatory",
  anchor: (line) => /trigger/i.test(line) && /(fresh|resum)/i.test(line),
  required: [
    { name: "exactly-one", re: /exactly one/i },
    { name: "mandatory", re: /\b(mandatory|not optional|never optional|is required)\b/i },
    { name: "fresh", re: /fresh/i },
    { name: "resume", re: /resum/i },
  ],
};

const AUDIT_PARITY_CLAUSES = [PREDICATE_CLAUSE, TRIGGER_EXCLUSIVITY_CLAUSE] as const;

describe("ITEM 2c / ITEM 4 — the audit-raised clauses land on BOTH surfaces", () => {
  for (const clause of AUDIT_PARITY_CLAUSES) {
    test(`${clause.id} — ${clause.what} — present on both and they agree`, () => {
      const verdict = parityVerdict(clause, read(DELIVER_SKILL), read(DELIVER_REFERENCE));
      expect({
        clause: clause.id,
        ...verdict,
        skill: clauseVector(read(DELIVER_SKILL), clause),
        reference: clauseVector(read(DELIVER_REFERENCE), clause),
      }).toEqual({
        clause: clause.id,
        presentOnSkill: true,
        presentOnReference: true,
        consistent: true,
        ok: true,
        skill: clauseVector(read(DELIVER_SKILL), clause),
        reference: clauseVector(read(DELIVER_SKILL), clause),
      });
    });
  }
});

describe("ITEM 2c / ITEM 4 — mutation-verified in both directions", () => {
  for (const clause of AUDIT_PARITY_CLAUSES) {
    test(`${clause.id} — deleting it from the operative surface reddens parity`, () => {
      const skillText = read(DELIVER_SKILL);
      const referenceText = read(DELIVER_REFERENCE);
      expect(parityVerdict(clause, skillText, referenceText).ok).toBe(true);

      const { mutated, removed } = deleteClause(skillText, clause);
      expect({ clause: clause.id, surface: SKILL_LABEL, applied: removed > 0 }).toEqual({
        clause: clause.id,
        surface: SKILL_LABEL,
        applied: true,
      });
      expect({ clause: clause.id, ...parityVerdict(clause, mutated, referenceText) }).toEqual({
        clause: clause.id,
        presentOnSkill: false,
        presentOnReference: true,
        consistent: false,
        ok: false,
      });
    });

    test(`${clause.id} — deleting it from the reference reddens parity`, () => {
      const skillText = read(DELIVER_SKILL);
      const referenceText = read(DELIVER_REFERENCE);
      expect(parityVerdict(clause, skillText, referenceText).ok).toBe(true);

      const { mutated, removed } = deleteClause(referenceText, clause);
      expect({ clause: clause.id, surface: REFERENCE_LABEL, applied: removed > 0 }).toEqual({
        clause: clause.id,
        surface: REFERENCE_LABEL,
        applied: true,
      });
      expect({ clause: clause.id, ...parityVerdict(clause, skillText, mutated) }).toEqual({
        clause: clause.id,
        presentOnSkill: true,
        presentOnReference: false,
        consistent: false,
        ok: false,
      });
    });
  }
});

// ===========================================================================
// ITEM 3 (MEDIUM) — the AC.2 per-module legs have real, reachable subjects.
// ===========================================================================

/** One synthetic surviving order for `names[0]` — a name PAIRED with a marker. */
function syntheticOrder(names: readonly string[]): string {
  return `Decide it with \`${names[0]}\` by eye rather than by running the command.`;
}

describe("ITEM 3 — every per-module AC.2 leg reddens on a survivor for ITS module", () => {
  test("the detector is armed — each order marker fires on its own", () => {
    // A silently emptied ORDER_MARKERS greens all six per-module legs at once.
    expect(ORDER_MARKERS.length).toBe(4);
    const fired = ORDER_MARKERS.map((marker) => ({
      marker,
      hits: survivingOrders(`Use \`deliver_argument\` and ${marker} instead.`, ["deliver_argument"])
        .length,
    }));
    expect(fired).toEqual(ORDER_MARKERS.map((marker) => ({ marker, hits: 1 })));
  });

  for (const { module, names } of DELEGATED_MODULES) {
    test(`injecting a surviving order for ${module} reddens ${module} and nothing else`, () => {
      // ISOLATION IS HALF THE TEST. A clause must fire on its subject AND stay
      // quiet on its siblings, or a single injected line would red six legs and
      // "the survivor is named" would be untrue.
      const injected = `${read(DELIVER_SKILL)}\n${syntheticOrder(names)}`;
      const census = DELEGATED_MODULES.map((entry) => ({
        module: entry.module,
        survivors: survivingOrders(injected, entry.names).length,
      }));
      expect(census).toEqual(
        DELEGATED_MODULES.map((entry) => ({
          module: entry.module,
          survivors: entry.module === module ? 1 : 0,
        })),
      );
    });
  }

  test("orchestration_config's leg is a regression guard, and it can still fail", () => {
    // HONEST RESTATEMENT. This module carried NO order marker on the pre-FR
    // surface (its only mention, SKILL.md:123, is descriptive), so its leg
    // proves nothing was retired — it proves nothing may be ADDED. That is
    // worth having only if it can fail, which is what this asserts.
    const shipped = survivingOrders(read(DELIVER_SKILL), ["orchestration_config", "readOrchestrationConfig"]);
    expect({ shipped }).toEqual({ shipped: [] });
    const injected = `${read(DELIVER_SKILL)}\nRead \`readOrchestrationConfig().defaultEffort\` by eye instead.`;
    expect(
      survivingOrders(injected, ["orchestration_config", "readOrchestrationConfig"]).length,
    ).toBe(1);
  });
});

// ===========================================================================
// ITEM 4 (MEDIUM) — neither surface offers the "one of them covered it" reading.
// ===========================================================================

/** The hedges that read as a choice, or as covering a case that cannot arise. */
const CHOICE_PHRASES: readonly { readonly name: string; readonly re: RegExp }[] = [
  { name: "either-trigger", re: /either trigger/i },
  { name: "firing-is-enough", re: /\bis enough\b/i },
  { name: "probing-twice", re: /probing twice/i },
  { name: "probing-on-both", re: /probing on both/i },
  { name: "idempotent", re: /\bidempotent\b/i },
  { name: "cheap-and-harmless", re: /cheap and harmless/i },
];

/** Choice-reading hits, scoped to the lines that talk about triggers/probes. */
function choiceHits(text: string): { line: number; phrase: string; excerpt: string }[] {
  const out: { line: number; phrase: string; excerpt: string }[] = [];
  text.split("\n").forEach((raw, i) => {
    if (!/trigger|prob(e|es|ing)\b/i.test(raw)) return;
    for (const { name, re } of CHOICE_PHRASES) {
      if (re.test(raw)) out.push({ line: i + 1, phrase: name, excerpt: raw.trim().slice(0, 120) });
    }
  });
  return out;
}

describe("ITEM 4 — the two triggers are mutually exclusive, so neither is optional", () => {
  for (const [label, path] of [
    [SKILL_LABEL, DELIVER_SKILL],
    [REFERENCE_LABEL, DELIVER_REFERENCE],
  ] as const) {
    test(`${label} offers no choice reading and no twice-in-one-run hedge`, () => {
      expect({ surface: label, hits: choiceHits(read(path)) }).toEqual({ surface: label, hits: [] });
    });

    test(`${label} — the detector fires when the hedge is put back`, () => {
      // MUTATION, BOTH DIRECTIONS. The M130-era sentence, verbatim.
      const mutated = `${read(path)}\nEither trigger firing is enough; probing twice in one run is cheap and harmless.`;
      const hits = choiceHits(mutated).map((h) => h.phrase);
      expect({
        surface: label,
        sawEither: hits.includes("either-trigger"),
        sawEnough: hits.includes("firing-is-enough"),
        sawTwice: hits.includes("probing-twice"),
        sawHarmless: hits.includes("cheap-and-harmless"),
      }).toEqual({
        surface: label,
        sawEither: true,
        sawEnough: true,
        sawTwice: true,
        sawHarmless: true,
      });
    });

    test(`${label} — the detector fires on the reference's own idempotence hedge`, () => {
      const mutated = `${read(path)}\nProbing on both triggers in one run is idempotent; the skill is either registered or it is not.`;
      const hits = choiceHits(mutated).map((h) => h.phrase);
      expect({
        surface: label,
        sawBoth: hits.includes("probing-on-both"),
        sawIdempotent: hits.includes("idempotent"),
      }).toEqual({ surface: label, sawBoth: true, sawIdempotent: true });
    });
  }
});

// ===========================================================================
// ITEM 5 (LOW) — no stale single-trigger prose survives in either pre-flight
// section. Extends AC.9.
// ===========================================================================

/** `## `-delimited section body WITH 1-based line numbers. */
function sectionRows(text: string, headingPrefix: string): { line: number; raw: string }[] {
  const rows = text.split("\n").map((raw, i) => ({ line: i + 1, raw }));
  const start = rows.findIndex((row) => row.raw.startsWith(headingPrefix));
  if (start === -1) return [];
  const rest = rows.slice(start + 1);
  const end = rest.findIndex((row) => /^## /.test(row.raw));
  return end === -1 ? rest : rest.slice(0, end);
}

/**
 * Lines in a pre-flight section that state where the probe runs in terms of
 * Phase 1 WITHOUT naming the resume path. On the resume path there is no Phase
 * 1 to proceed to, so an unqualified "Present ⇒ proceed to Phase 1" or "the
 * probe runs before Phase 1" is the single-trigger model the later paragraph
 * then quietly amends.
 */
function unqualifiedPhase1Rows(rows: readonly { line: number; raw: string }[]) {
  return rows
    .filter((row) => /phase 1/i.test(row.raw) && !/resum/i.test(row.raw))
    .map((row) => ({ line: row.line, excerpt: row.raw.trim().slice(0, 120) }));
}

describe("ITEM 5 — the pre-flight sections do not state the single-trigger model", () => {
  for (const [label, path] of [
    [SKILL_LABEL, DELIVER_SKILL],
    [REFERENCE_LABEL, DELIVER_REFERENCE],
  ] as const) {
    test(`${label} — every Phase-1 line in ## Pre-flight also names the resume path`, () => {
      const rows = sectionRows(read(path), "## Pre-flight");
      const phase1 = rows.filter((row) => /phase 1/i.test(row.raw));
      expect({
        surface: label,
        // NOT VACUOUS BY DELETION: the fresh-run trigger's own timing IS
        // "before Phase 1", so the section must still say so — deleting every
        // Phase-1 mention must not be a way to green this leg.
        sectionFound: rows.length > 0,
        namesPhase1: phase1.length > 0,
        unqualified: unqualifiedPhase1Rows(rows),
      }).toEqual({ surface: label, sectionFound: true, namesPhase1: true, unqualified: [] });
    });

    test(`${label} — the detector fires on the stale wording`, () => {
      const rows = [
        { line: 1, raw: "2. Present ⇒ proceed to Phase 1." },
        { line: 2, raw: "The probe runs **before Phase 1**, not before Phase 3." },
      ];
      expect(unqualifiedPhase1Rows(rows).map((r) => r.line)).toEqual([1, 2]);
      // …and stays quiet once the resume path is named on the same line.
      expect(
        unqualifiedPhase1Rows([
          { line: 1, raw: "2. Present ⇒ proceed — to Phase 1 on a fresh run, to the resume gate on a resumed one." },
        ]),
      ).toEqual([]);
    });
  }
});

// ===========================================================================
// ITEM 6 (LOW) — a leading U+FEFF is a false red, and the header says what the
// code does. Extends AC.3.
// ===========================================================================

const BOM = "\uFEFF";

describe("ITEM 6 — a BOM does not turn a faithful render into a retelling", () => {
  test("a BOM on the capture leaves a faithful render passing", async () => {
    // MEASURED on the shipped module: this returned `gate-render-paraphrased`
    // on a FAITHFUL render — a false red, and the loudest possible way to be
    // wrong about a healthy gate.
    const mod = await loadModule();
    const verdict = mod.verifyResumeGateRender(FAITHFUL_GATE, BOM + CAPTURE);
    expect({ ok: verdict.ok, reasons: [...verdict.reasons] }).toEqual({ ok: true, reasons: [] });
  });

  test("a BOM on the rendering, on the capture, or on both, all pass", async () => {
    const mod = await loadModule();
    const cases = [
      { where: "rendered", rendered: BOM + FAITHFUL_GATE, capture: CAPTURE },
      { where: "capture", rendered: FAITHFUL_GATE, capture: BOM + CAPTURE },
      { where: "both", rendered: BOM + FAITHFUL_GATE, capture: BOM + CAPTURE },
      { where: "bom+crlf", rendered: BOM + FAITHFUL_GATE.replaceAll("\n", "\r\n"), capture: BOM + CAPTURE },
    ];
    for (const { where, rendered, capture } of cases) {
      expect({ where, ok: mod.verifyResumeGateRender(rendered, capture).ok }).toEqual({
        where,
        ok: true,
      });
    }
  });

  test("stripping it accepts NO retelling — the reason the header must give", async () => {
    // The whole justification for stripping U+FEFF and not whitespace/case is
    // that this normalization widens nothing. Asserted, not asserted-about.
    const mod = await loadModule();
    for (const [name, rendered] of [
      ["REAL_PARAPHRASE", REAL_PARAPHRASE],
      ["REAL_PARAPHRASE_GATE", REAL_PARAPHRASE_GATE],
      ["VALUE_ONLY_PARAPHRASE", VALUE_ONLY_PARAPHRASE],
      ["ABSENT_GATE", ABSENT_GATE],
    ] as const) {
      expect({
        fixture: name,
        ok: mod.verifyResumeGateRender(BOM + rendered, BOM + CAPTURE).ok,
      }).toEqual({ fixture: name, ok: false });
    }
  });

  test("a BOM'd whole record is not mistaken for a non-record", async () => {
    // ORDER OF OPERATIONS. Strip before the item-1 field check, or the BOM
    // false-red simply moves to a different reason code.
    const mod = await loadModule();
    const reasons = mod.verifyResumeGateRender(FAITHFUL_GATE, BOM + CAPTURE).reasons.join(" | ");
    expect(reasons.includes(mod.GATE_RENDER_CAPTURE_NOT_A_RECORD)).toBe(false);
  });

  test("the header's stated reason matches what the code does", () => {
    // The shipped header justified stopping at `\r\n` by saying further
    // normalization "would start accepting the retellings this module exists to
    // reject" and that line endings are normalized "AND NOTHING ELSE IS". Both
    // become false the moment U+FEFF is stripped. A header that contradicts its
    // own module is how the next reader re-introduces the bug.
    const header = moduleHeader(read(RENDER_MODULE));
    expect({
      namesTheBom: /BOM|U\+FEFF|\\uFEFF/.test(header),
      claimsNothingElse: /nothing else is/i.test(header),
      claimsItStops: /normalization stops at/i.test(header),
    }).toEqual({ namesTheBom: true, claimsNothingElse: false, claimsItStops: false });
  });

  test("that header check can fail — it fires on the shipped wording", () => {
    const shipped = [
      "// LINE ENDINGS ARE NORMALIZED ON BOTH SIDES, AND NOTHING ELSE IS.",
      "// ... so the normalization stops at `\\r\\n` -> `\\n`.",
      "",
    ].join("\n");
    expect({
      namesTheBom: /BOM|U\+FEFF|\\uFEFF/.test(shipped),
      claimsNothingElse: /nothing else is/i.test(shipped),
      claimsItStops: /normalization stops at/i.test(shipped),
    }).toEqual({ namesTheBom: false, claimsNothingElse: true, claimsItStops: true });
  });
});

// ###########################################################################
// AUDIT ROUND 3 — the final audit-raised round. Three items.
//
// Everything below is additive except the ITEM 2b block and the `runGateCli`
// helper, which were MIGRATED in place to the authenticated CLI contract item
// A2 introduces: every one of those legs keeps its subject and gains an
// execution it does not supply, and the single leg whose subject the new
// contract deletes is replaced by the leg proving the deletion is real. No leg
// anywhere in this file was weakened or dropped.
//
//   * ITEM A (HIGH) — THE CAPTURE IS STILL UNAUTHENTICATED. Round 2 raised the
//     bar from "any non-blank string" to "any string SHAPED like a record". It
//     did not tie the capture to an execution. Measured by the audit through
//     the SHIPPED CLI, all three of these returned rc 0 and printed
//     `ok: … all 7 labelled fields, as printed`:
//
//       (i)   seven bare labels with EMPTY values, handed in as both files;
//       (ii)  a hand-typed plausible seven-field record, never executed;
//       (iii) a real capture with ONE VALUE doctored
//             (`ready_to_implement` -> `ship_ready`), all seven labels intact.
//
//     `missingRecordFields` only tests `line.startsWith(field + ":")`, and the
//     affirmative verdict then claims "AS PRINTED" when nothing was printed —
//     a false claim in the tool's own output. Two fixes, both pinned here:
//
//     A1 — A LABEL WITHOUT A VALUE IS NOT A FIELD. Each of the eight labels
//     must carry a non-empty value: on its own line after the colon, or — for
//     `chain`, the one multi-line field, which `renderDecisionRecord` prints as
//     a BARE `chain:` followed by its step lines — on at least one non-blank
//     continuation line before the next label. Verdict stays
//     `GATE_RENDER_CAPTURE_NOT_A_RECORD`: the remedy is the same one (run the
//     command), and a fifth code would split a class that has one remedy.
//     Kills (i).
//
//     A2 — THE CLI OBTAINS THE CAPTURE BY RUNNING THE COMMAND. New contract:
//
//         bun run resume_gate_render.ts <argument> [projectRoot] <renderedPath>
//
//     `projectRoot` defaults to `process.cwd()`, the `?? process.cwd()` shape
//     `deliver_decision.ts:315` already uses. There is NO capture argument, so
//     the bytes graded are the ones the decision just printed, in this process,
//     now. Kills (ii) and (iii) — neither survives contact with a capture the
//     hander-in did not choose. This is the idiom the two sibling FRs of this
//     milestone already use: STE-516 resolves the handle through the tool's own
//     ownership check rather than believing a reported one, and STE-515 reads a
//     capture off disk rather than accepting a composed one.
//
//     THE IN-PROCESS PREDICATE IS UNCHANGED. `verifyResumeGateRender(rendered,
//     capturedStdout)` stays a pure two-string predicate — 91 legs depend on
//     it, and a pure predicate is the right shape for the question it answers.
//     It is the CLI's PROVENANCE that changes. The premise leg below states
//     this plainly: the predicate CANNOT tell (ii) or (iii) apart from a real
//     capture, and is not asked to.
//
//     A NOTE FOR THE IMPLEMENTER, because AC.1 is a trap here: the surface
//     sentence describing this command must NOT contain the literal
//     `deliver_decision.ts`. AC.1's first leg pins EXACTLY ONE line on the
//     operative surface naming that file, and a second mention on the
//     resume_gate_render sentence turns it red.
//
//   * ITEM B (MEDIUM) — AN UNGUARDED FALSE RED ON A FAITHFUL GATE.
//     `deliver_decision.ts` prints through `console.log`, so a shell capture
//     ends with `\n`. A rendering that ends exactly at the record with no
//     trailing newline fails `text.includes(capture)` and is graded
//     `gate-render-paraphrased` ON A FAITHFUL GATE. Reproduced by the audit as
//
//         printf 'Here is the decision:\n\n%s' "$(cat capture.txt)"
//
//     and `$(...)` strips trailing newlines, so this is the COMMON shape, not
//     an exotic one — the same class as the BOM false red ITEM 6 closed. The
//     fix tolerates a difference in TRAILING WHITESPACE ONLY, which is why the
//     non-widening legs below re-run every rejection fixture and additionally
//     pin that dropping a non-blank tail line still fails.
//
//   * ITEM C (LOW) — A FALSE CLAIM IN THE MODULE HEADER, WRITTEN BY ROUND 2.
//     `resume_gate_render.ts` says four siblings "already strip the BOM …
//     (carrier_phrase_probe.ts, first_turn_refusal_marker.ts,
//     deliver_stage_capture.ts, archive_fr.ts)". `archive_fr.ts:80-84` does NOT
//     strip a BOM — it PRESERVES one, lifting it to the front of a synthesized
//     frontmatter block so a U+FEFF is not buried mid-document, for an
//     unrelated reason. The class is also LARGER than four:
//     `toolkit_managed.ts:87` and `claudemd_docs_section.ts:65` strip via
//     `charCodeAt(0) === 0xfeff`, and `frontmatter.ts:43` strips a literal BOM.
//     This milestone has now corrected FOUR false claims written onto surfaces
//     or into comments, three of them authored by its own forks. So the header
//     is checked rather than trusted: every module a BOM-strip claim CITES must
//     actually strip, and any count it states must match the measured class.
//     Dropping the citation is an accepted fix — restating it loosely is not,
//     which is what the synthetic falsifiers below hold the check to.
// ###########################################################################

// ---------------------------------------------------------------------------
// ITEM A1 — a label without a value is not a field.
// ---------------------------------------------------------------------------

/** The auditor's probe (i): bare labels, no values — one per DECISION_FIELDS entry. */
const BARE_LABEL_RECORD = DECISION_FIELDS.map((field) => `${field}:`).join("\n");

/** True when `line` opens one of the eight fields. */
function isFieldLabel(line: string): boolean {
  return DECISION_FIELDS.some((field) => line.startsWith(`${field}:`));
}

/**
 * `record` with ONE field's value emptied and its label left standing — the
 * per-field shape of probe (i). For a scalar field the text after the colon
 * goes; for `chain`, the continuation step lines go and the bare `chain:`
 * label stays. Containment is deliberately preserved by the callers, so a
 * grader that only looks for labels grades every one of these clean.
 */
function blankFieldValue(record: string, field: string): string {
  const out: string[] = [];
  let inTarget = false;
  for (const line of record.split("\n")) {
    if (isFieldLabel(line)) {
      inTarget = line.startsWith(`${field}:`);
      out.push(inTarget ? `${field}:` : line);
      continue;
    }
    if (!inTarget) out.push(line);
  }
  return out.join("\n");
}

/** The same, but the value is whitespace rather than absent. */
function whitespaceFieldValue(record: string, field: string): string {
  return blankFieldValue(record, field)
    .split("\n")
    .map((line) => (line === `${field}:` ? `${field}:   ` : line))
    .join("\n");
}

/**
 * The assertion ITEM A1 IS, factored out so it can run against the shipped
 * predicate (must hold) and against the round-2 behaviour — labels only —
 * which must throw.
 */
function assertRefusesValuelessLabels(
  predicate: (rendered: string, capture: string) => { ok: boolean },
): void {
  // The auditor's probe (i), verbatim: the same bytes as both files.
  expect({
    probe: "bare-labels-as-both-files",
    ok: predicate(BARE_LABEL_RECORD, BARE_LABEL_RECORD).ok,
  }).toEqual({ probe: "bare-labels-as-both-files", ok: false });

  // Per field, never collective — including `chain`, whose value lives on the
  // lines BELOW its label and which a same-line-only check would get wrong in
  // the other direction.
  for (const field of DECISION_FIELDS) {
    for (const [shape, mutilate] of [
      ["empty", blankFieldValue],
      ["whitespace", whitespaceFieldValue],
    ] as const) {
      const mutilated = mutilate(CAPTURE, field);
      expect({ field, shape, applied: mutilated !== CAPTURE }).toEqual({
        field,
        shape,
        applied: true,
      });
      expect({
        field,
        shape,
        ok: predicate(`Gate:\n\n${mutilated}\n\nConfirm?`, mutilated).ok,
      }).toEqual({ field, shape, ok: false });
    }
  }
}

describe("ITEM A1 — a labelled field with no value is not a record", () => {
  test("the auditor's probe (i) and its per-field forms are refused", async () => {
    const mod = await loadModule();
    assertRefusesValuelessLabels(mod.verifyResumeGateRender);
  });

  test("the round-2 label-only check — the shipped behaviour — fails these probes", () => {
    // FALSIFIABILITY. `missingRecordFields` tests only
    // `line.startsWith(field + ":")`, which every probe above satisfies. This
    // stand-in reproduces it exactly, and must throw.
    const labelOnly = (rendered: string, capture: string) => {
      const lines = capture.split("\n");
      const missing = DECISION_FIELDS.filter(
        (field) => !lines.some((line) => line.startsWith(`${field}:`)),
      );
      return {
        ok: capture.trim().length > 0 && missing.length === 0 && rendered.includes(capture),
        reasons: [] as string[],
      };
    };
    expect(() => assertRefusesValuelessLabels(labelOnly)).toThrow();
  });

  test("each valueless field is reported with the not-a-record code, and named", async () => {
    const mod = await loadModule();
    for (const field of DECISION_FIELDS) {
      const mutilated = blankFieldValue(CAPTURE, field);
      const verdict = mod.verifyResumeGateRender(`Gate:\n\n${mutilated}\n\nConfirm?`, mutilated);
      const reasons = verdict.reasons.join(" | ");
      expect({
        field,
        ok: verdict.ok,
        notARecord: reasons.includes(mod.GATE_RENDER_CAPTURE_NOT_A_RECORD),
        namesTheField: reasons.includes(field),
        absent: reasons.includes(mod.GATE_RENDER_ABSENT),
        paraphrased: reasons.includes(mod.GATE_RENDER_PARAPHRASED),
      }).toEqual({
        field,
        ok: false,
        notARecord: true,
        namesTheField: true,
        absent: false,
        paraphrased: false,
      });
    }
  });

  test("probe (i) is not reported as an absence or a paraphrase", async () => {
    const mod = await loadModule();
    const reasons = mod
      .verifyResumeGateRender(BARE_LABEL_RECORD, BARE_LABEL_RECORD)
      .reasons.join(" | ");
    expect({
      notARecord: reasons.includes(mod.GATE_RENDER_CAPTURE_NOT_A_RECORD),
      absent: reasons.includes(mod.GATE_RENDER_ABSENT),
      paraphrased: reasons.includes(mod.GATE_RENDER_PARAPHRASED),
      noCapture: reasons.includes(mod.GATE_RENDER_NO_CAPTURE),
    }).toEqual({ notARecord: true, absent: false, paraphrased: false, noCapture: false });
  });

  test("the value check is not always-false — a whole record still grades", async () => {
    // THE MIRROR. `() => ({ok:false})` satisfies every refusal above. The
    // multi-line `chain` field is the one a naive same-line value check breaks:
    // it is printed as a BARE `chain:` label with its steps below, so a record
    // the command really produced must still pass.
    const mod = await loadModule();
    const faithful = mod.verifyResumeGateRender(FAITHFUL_GATE, CAPTURE);
    expect({ ok: faithful.ok, reasons: [...faithful.reasons] }).toEqual({ ok: true, reasons: [] });

    const printed = realCapture(newFixture());
    const fromCommand = mod.verifyResumeGateRender(`Gate:\n\n${printed}\n\nConfirm?`, printed);
    expect({ ok: fromCommand.ok, reasons: [...fromCommand.reasons] }).toEqual({
      ok: true,
      reasons: [],
    });

    // …and the chain steps are what a same-line check would have eaten.
    expect(CAPTURE.split("\n").includes("chain:")).toBe(true);
  });

  test("a paraphrase of a whole record is still a paraphrase, not a non-record", async () => {
    const mod = await loadModule();
    const reasons = mod.verifyResumeGateRender(REAL_PARAPHRASE, CAPTURE).reasons.join(" | ");
    expect({
      paraphrased: reasons.includes(mod.GATE_RENDER_PARAPHRASED),
      notARecord: reasons.includes(mod.GATE_RENDER_CAPTURE_NOT_A_RECORD),
    }).toEqual({ paraphrased: true, notARecord: false });
  });
});

// ---------------------------------------------------------------------------
// ITEM A2 — the CLI runs the decision command itself.
// ---------------------------------------------------------------------------

/** The auditor's probe (ii): a plausible whole record that was never executed. */
const HAND_TYPED_RECORD = renderDecisionRecord({
  argument_kind: "milestone_identity",
  target_repo_route: "invoking",
  resume_state: "ship_ready",
  chain: [`  1. /ship-milestone ${FIXTURE_MILESTONE} (worker)`, `  2. /pr ${FIXTURE_MILESTONE} (worker)`].join("\n"),
  merge_policy: "auto -> auto",
  gate_class: "content",
  gate_relays: "no",
  // M134 STE-519's eighth field. Evaluated at module load like the fixture
  // above, so an omission aborts the file instead of failing one leg.
  remote_control: "dev-process-toolkit-m900",
});

/** The auditor's probe (iii): a real capture with ONE value doctored. */
function doctorOneValue(capture: string): string {
  return capture.replace("ready_to_implement", "ship_ready");
}

describe("ITEM A2 — the capture is an execution, not an argument", () => {
  test("the affirmative verdict is reachable ONLY through a run it did itself", () => {
    // The CLI is handed an identity, a project root and a rendering. It is
    // handed no bytes. A clean verdict therefore means it produced the record.
    const fixture = newFixture();
    const result = runGateCli(gateWrapping(realCapture(fixture)), { projectRoot: fixture });
    expect({
      code: result.code,
      saysOk: /\bok\b/i.test(result.stdout),
      stderr: result.stderr.slice(0, 400),
    }).toEqual({ code: 0, saysOk: true, stderr: "" });
  });

  test("probe (ii) — a hand-typed plausible record, never executed, is refused", () => {
    const fixture = newFixture();
    expect(HAND_TYPED_RECORD).not.toBe(realCapture(fixture).trimEnd()); // it is a different record
    const result = runGateCli(gateWrapping(HAND_TYPED_RECORD), { projectRoot: fixture });
    expect({
      nonZero: result.code !== 0,
      namesCode: result.stderr.includes("gate-render-paraphrased"),
      stdout: result.stdout,
    }).toEqual({ nonZero: true, namesCode: true, stdout: "" });
  });

  test("probe (iii) — a real capture with ONE value doctored is refused", () => {
    const fixture = newFixture();
    const printed = realCapture(fixture);
    const doctored = doctorOneValue(printed);
    expect({ applied: doctored !== printed, stillAllLabels: DECISION_FIELDS.every((f) => doctored.includes(`${f}:`)) }).toEqual({
      applied: true,
      stillAllLabels: true,
    });
    const result = runGateCli(gateWrapping(doctored), { projectRoot: fixture });
    expect({
      nonZero: result.code !== 0,
      namesCode: result.stderr.includes("gate-render-paraphrased"),
      stdout: result.stdout,
    }).toEqual({ nonZero: true, namesCode: true, stdout: "" });
  });

  test("probe (i) as a RENDERING — bare labels — is refused", () => {
    const result = runGateCli(gateWrapping(BARE_LABEL_RECORD));
    expect({ nonZero: result.code !== 0, stdout: result.stdout }).toEqual({
      nonZero: true,
      stdout: "",
    });
  });

  test("the predicate alone cannot tell (ii) or (iii) apart — which is why the CLI runs the command", async () => {
    // THE PREMISE, stated as a leg rather than as a comment. Both probes are
    // whole records with real values, so the pure two-string predicate grades
    // each one clean against itself — correctly, because it was never given
    // anything to authenticate them with. Authentication is a PROVENANCE
    // property and it lives at the entrypoint. If this ever goes false the
    // round-3 reasoning above needs rewriting, not quietly deleting.
    const mod = await loadModule();
    expect({
      handTyped: mod.verifyResumeGateRender(HAND_TYPED_RECORD, HAND_TYPED_RECORD).ok,
      doctored: mod.verifyResumeGateRender(
        doctorOneValue(CAPTURE),
        doctorOneValue(CAPTURE),
      ).ok,
    }).toEqual({ handTyped: true, doctored: true });
  });

  test("the affirmative verdict names what produced the bytes it claims were printed", () => {
    // MEASURED: the shipped verdict says "all 7 labelled fields, as printed"
    // while nothing had been printed — a false claim in the tool's own output.
    // With the run inside the tool the claim is true, and the verdict must say
    // what it ran so a reader can check it.
    const fixture = newFixture();
    const result = runGateCli(gateWrapping(realCapture(fixture)), { projectRoot: fixture });
    expect({
      code: result.code,
      namesTheCommand: /deliver_decision|decision command/i.test(result.stdout),
      namesTheArgument: result.stdout.includes(FIXTURE_MILESTONE),
    }).toEqual({ code: 0, namesTheCommand: true, namesTheArgument: true });
  });

  test("`projectRoot` is optional and defaults to the working directory", () => {
    const fixture = newFixture();
    const renderedPath = tempFile("rendered.txt", gateWrapping(realCapture(fixture)));
    const result = runTokens(
      ["bun", "run", RENDER_MODULE, FIXTURE_MILESTONE, renderedPath],
      fixture,
    );
    expect({
      code: result.code,
      saysOk: /\bok\b/i.test(result.stdout),
      stderr: result.stderr.slice(0, 400),
    }).toEqual({ code: 0, saysOk: true, stderr: "" });
  });

  test("one argument alone is refused — a rendering with no identity grades nothing", () => {
    const result = runTokens(["bun", "run", RENDER_MODULE, FIXTURE_MILESTONE], PLUGIN_ROOT);
    expect({
      nonZero: result.code !== 0,
      envelope: /^Refusing: /m.test(result.stderr),
      stdout: result.stdout,
    }).toEqual({ nonZero: true, envelope: true, stdout: "" });
  });

  test("a refusal from the decision command is forwarded, not graded", () => {
    // The gate is never graded against a record that could not be produced.
    // The refusal the reader sees is the decision command's own, which is the
    // one that says what to fix.
    const result = runGateCli(FAITHFUL_GATE, { argument: "M999999" });
    expect({
      nonZero: result.code !== 0,
      envelope: /^Refusing: /m.test(result.stderr),
      stdout: result.stdout,
      gradedAnyway:
        result.stderr.includes("gate-render-paraphrased") ||
        result.stderr.includes("gate-render-absent"),
    }).toEqual({ nonZero: true, envelope: true, stdout: "", gradedAnyway: false });
  });

  test("the module takes no capture path — and keeps the two-string predicate", () => {
    const source = read(RENDER_MODULE);
    expect({
      capturePathArg: source.includes("capturedStdoutPath"),
      predicateParamKept: /verifyResumeGateRender\(\s*[\s\S]{0,200}?capturedStdout\b/.test(source),
      usageNamesArgument: /<argument>/.test(source),
      usageNamesRendered: /<renderedPath>/.test(source),
    }).toEqual({
      capturePathArg: false,
      predicateParamKept: true,
      usageNamesArgument: true,
      usageNamesRendered: true,
    });
  });
});

/**
 * The gate-render command line as both surfaces must now spell it. The negative
 * requirement is a real one: the shipped sentence names `<capturedStdoutPath>`,
 * and a surface that still offers a capture argument documents a door the tool
 * no longer has.
 */
const GATE_CLI_CLAUSE: SurfaceClause = {
  id: "ITEM.A2",
  what: "the gate-render command line takes an identity and a rendering, never a capture",
  anchor: (line) => line.includes("resume_gate_render.ts"),
  required: [
    { name: "bun-run", re: /bun run [^`]*resume_gate_render\.ts/ },
    { name: "argument", re: /<argument>/ },
    { name: "project-root", re: /\[projectRoot\]/ },
    { name: "rendered-path", re: /<renderedPath>/ },
    { name: "no-capture-argument", re: /^(?!.*capturedStdoutPath).*$/ },
  ],
};

describe("ITEM A2 — the new command line lands on BOTH surfaces", () => {
  test("present on both, and the two agree", () => {
    const verdict = parityVerdict(GATE_CLI_CLAUSE, read(DELIVER_SKILL), read(DELIVER_REFERENCE));
    expect({
      ...verdict,
      skill: clauseVector(read(DELIVER_SKILL), GATE_CLI_CLAUSE),
      reference: clauseVector(read(DELIVER_REFERENCE), GATE_CLI_CLAUSE),
    }).toEqual({
      presentOnSkill: true,
      presentOnReference: true,
      consistent: true,
      ok: true,
      skill: clauseVector(read(DELIVER_SKILL), GATE_CLI_CLAUSE),
      reference: clauseVector(read(DELIVER_SKILL), GATE_CLI_CLAUSE),
    });
  });

  test("deleting it from the operative surface reddens parity", () => {
    const skillText = read(DELIVER_SKILL);
    const referenceText = read(DELIVER_REFERENCE);
    expect(parityVerdict(GATE_CLI_CLAUSE, skillText, referenceText).ok).toBe(true);
    const { mutated, removed } = deleteClause(skillText, GATE_CLI_CLAUSE);
    expect({ surface: SKILL_LABEL, applied: removed > 0 }).toEqual({
      surface: SKILL_LABEL,
      applied: true,
    });
    expect(parityVerdict(GATE_CLI_CLAUSE, mutated, referenceText)).toEqual({
      presentOnSkill: false,
      presentOnReference: true,
      consistent: false,
      ok: false,
    });
  });

  test("deleting it from the reference reddens parity", () => {
    const skillText = read(DELIVER_SKILL);
    const referenceText = read(DELIVER_REFERENCE);
    expect(parityVerdict(GATE_CLI_CLAUSE, skillText, referenceText).ok).toBe(true);
    const { mutated, removed } = deleteClause(referenceText, GATE_CLI_CLAUSE);
    expect({ surface: REFERENCE_LABEL, applied: removed > 0 }).toEqual({
      surface: REFERENCE_LABEL,
      applied: true,
    });
    expect(parityVerdict(GATE_CLI_CLAUSE, skillText, mutated)).toEqual({
      presentOnSkill: true,
      presentOnReference: false,
      consistent: false,
      ok: false,
    });
  });

  test("the surfaces spell the argument list exactly as the module's own USAGE does", () => {
    // The module's refusals quote `USAGE`. If the surfaces and the refusal
    // disagree, one of them is telling the reader to run something that does
    // not exist — the drift class AC.10 is written against, one level down.
    const usage = read(RENDER_MODULE).match(/resume_gate_render\.ts([^`"'\n]*)/);
    const tail = (line: string): string =>
      (line.match(/resume_gate_render\.ts([^`"'\n]*)/)?.[1] ?? "").trim();
    const skillLine = read(DELIVER_SKILL)
      .split("\n")
      .find((line) => /bun run [^`]*resume_gate_render\.ts/.test(line));
    const referenceLine = read(DELIVER_REFERENCE)
      .split("\n")
      .find((line) => /bun run [^`]*resume_gate_render\.ts/.test(line));
    expect({
      moduleUsage: (usage?.[1] ?? "").trim(),
      skill: tail(skillLine ?? ""),
      reference: tail(referenceLine ?? ""),
    }).toEqual({
      moduleUsage: "<argument> [projectRoot] <renderedPath>",
      skill: "<argument> [projectRoot] <renderedPath>",
      reference: "<argument> [projectRoot] <renderedPath>",
    });
  });
});

// ---------------------------------------------------------------------------
// ITEM B — a missing trailing newline is not a retelling.
// ---------------------------------------------------------------------------

/** The shape `printf '…%s' "$(cat capture)"` produces: no trailing newline. */
function gateEndingAtTheRecord(capture: string): string {
  return `Here is the decision:\n\n${capture.replace(/\n+$/, "")}`;
}

/** The assertion ITEM B IS, so it can be run against a strict stand-in too. */
function assertTrailingNewlineIsNotARetelling(
  predicate: (rendered: string, capture: string) => { ok: boolean },
): void {
  for (const [renderedTail, captureTail] of [
    ["", "\n"],
    ["", ""],
    ["\n", "\n"],
    ["\n", ""],
    ["", "\n\n"],
  ] as const) {
    const rendered = gateEndingAtTheRecord(CAPTURE) + renderedTail;
    expect({
      renderedTail: JSON.stringify(renderedTail),
      captureTail: JSON.stringify(captureTail),
      ok: predicate(rendered, CAPTURE + captureTail).ok,
    }).toEqual({
      renderedTail: JSON.stringify(renderedTail),
      captureTail: JSON.stringify(captureTail),
      ok: true,
    });
  }
}

describe("ITEM B — a faithful gate passes with or without the capture's trailing newline", () => {
  test("the auditor's shape passes in every trailing-whitespace combination", async () => {
    // MEASURED on the shipped module: `console.log` gives the capture a
    // trailing `\n`, `$(...)` strips it from the rendering, and the faithful
    // gate was graded `gate-render-paraphrased` — the loudest possible way to
    // be wrong about a healthy gate.
    const mod = await loadModule();
    assertTrailingNewlineIsNotARetelling(mod.verifyResumeGateRender);
  });

  test("strict containment — the shipped behaviour — fails that assertion", () => {
    const strict = (rendered: string, capture: string) => ({
      ok: capture.trim().length > 0 && rendered.includes(capture),
      reasons: [] as string[],
    });
    expect(() => assertTrailingNewlineIsNotARetelling(strict)).toThrow();
  });

  test("end to end: `printf '…%s' \"$(cat capture)\"` grades clean through the CLI", () => {
    // The auditor's reproduction, run rather than described. The capture file
    // is written by the real command; the rendering is built by the shell shape
    // that strips its trailing newline; the CLI re-obtains the capture itself.
    const fixture = newFixture();
    const capturePath = tempFile("capture.txt", realCapture(fixture));
    const renderedPath = join(realpathSync(mkdtempSync(join(tmpdir(), "ste514-shell-"))), "rendered.txt");
    const shell = runTokens(
      [
        "bash",
        "-c",
        `printf 'Here is the decision:\\n\\n%s' "$(cat ${JSON.stringify(capturePath)})" > ${JSON.stringify(renderedPath)}`,
      ],
      PLUGIN_ROOT,
    );
    expect({ shellCode: shell.code, shellStderr: shell.stderr }).toEqual({
      shellCode: 0,
      shellStderr: "",
    });
    const rendered = read(renderedPath);
    expect({ endsWithNewline: rendered.endsWith("\n") }).toEqual({ endsWithNewline: false });

    const result = runTokens(
      ["bun", "run", RENDER_MODULE, FIXTURE_MILESTONE, fixture, renderedPath],
      PLUGIN_ROOT,
    );
    expect({
      code: result.code,
      saysOk: /\bok\b/i.test(result.stdout),
      stderr: result.stderr.slice(0, 400),
    }).toEqual({ code: 0, saysOk: true, stderr: "" });
  });

  test("tolerating it accepts NO retelling — every rejection fixture still fails", async () => {
    const mod = await loadModule();
    const reordered = CAPTURE.split("\n").reverse().join("\n");
    const reworded = CAPTURE.replace("ready_to_implement", "ready to implement");
    for (const [name, rendered] of [
      ["REAL_PARAPHRASE", REAL_PARAPHRASE],
      ["REAL_PARAPHRASE_GATE", REAL_PARAPHRASE_GATE],
      ["VALUE_ONLY_PARAPHRASE", VALUE_ONLY_PARAPHRASE],
      ["ABSENT_GATE", ABSENT_GATE],
      ["reordered", `Gate:\n\n${reordered}`],
      ["reworded", `Gate:\n\n${reworded}`],
    ] as const) {
      for (const captureTail of ["", "\n"]) {
        expect({
          fixture: name,
          captureTail: JSON.stringify(captureTail),
          ok: mod.verifyResumeGateRender(rendered, CAPTURE + captureTail).ok,
        }).toEqual({
          fixture: name,
          captureTail: JSON.stringify(captureTail),
          ok: false,
        });
      }
    }
  });

  test("it is TRAILING WHITESPACE only — a dropped tail line still fails", async () => {
    // The guard on the guard. Tolerating a missing `\n` must not become
    // tolerating a missing LINE: the last field is exactly the one a truncated
    // paste loses.
    const mod = await loadModule();
    const lines = CAPTURE.split("\n");
    const truncated = lines.slice(0, -1).join("\n");
    expect({ applied: truncated !== CAPTURE, lastLine: lines.at(-1) }).toEqual({
      applied: true,
      // M134 STE-519 appended remote_control, so IT is now the tail line a
      // truncated paste loses — which is exactly what this leg measures.
      lastLine: `remote_control: dev-process-toolkit-m900`,
    });
    expect({
      ok: mod.verifyResumeGateRender(`Gate:\n\n${truncated}`, CAPTURE + "\n").ok,
    }).toEqual({ ok: false });
  });

  test("it composes with the BOM and CRLF transforms rather than replacing them", async () => {
    const mod = await loadModule();
    const cases = [
      { where: "bom+no-trailing-nl", rendered: BOM + gateEndingAtTheRecord(CAPTURE), capture: BOM + CAPTURE + "\n" },
      {
        where: "crlf+no-trailing-nl",
        rendered: gateEndingAtTheRecord(CAPTURE).replaceAll("\n", "\r\n"),
        capture: CAPTURE + "\r\n",
      },
    ];
    for (const { where, rendered, capture } of cases) {
      expect({ where, ok: mod.verifyResumeGateRender(rendered, capture).ok }).toEqual({
        where,
        ok: true,
      });
    }
  });
});

// ---------------------------------------------------------------------------
// ITEM C — the header's cited list is checked, not trusted.
// ---------------------------------------------------------------------------

/** Comment markers stripped, so a claim broken across `//` lines reads whole. */
function commentProse(source: string): string {
  return source
    .split("\n")
    .map((line) => line.replace(/^\s*(\/\/|\*|\/\*\*?)\s?/, ""))
    .join(" ")
    .replace(/\s+/g, " ");
}

/** The two shipped BOM-STRIPPING idioms. `archive_fr.ts` matches neither. */
const BOM_STRIP_IDIOMS: readonly RegExp[] = [
  /\.replace\(\/\^(?:\\uFEFF|\uFEFF)\/,\s*""\)/,
  /charCodeAt\(0\) === 0xfeff\s*\?\s*\w+\.slice\(1\)/i,
];

function stripsBom(source: string): boolean {
  return BOM_STRIP_IDIOMS.some((re) => re.test(source));
}

/** Every `*.ts` module in the shared adapter source directory that strips a BOM. */
function measuredStrippers(): string[] {
  return readdirSync(SRC_DIR)
    .filter((name) => name.endsWith(".ts") && name !== "resume_gate_render.ts")
    .filter((name) => stripsBom(read(join(SRC_DIR, name))))
    .sort();
}

/**
 * Sentences, with `.ts` protected so a module name does not end one. The
 * SENTENCE is the unit a claim is made in, and scoping to it is what lets the
 * check tell "these modules strip a BOM" from "this module does NOT".
 */
function sentences(prose: string): string[] {
  const guarded = prose.replaceAll(".ts", "\u0001ts");
  return guarded.split(/(?<=[.!?])\s+/).map((s) => s.replaceAll("\u0001ts", ".ts"));
}

/**
 * Every sentence making an AFFIRMATIVE BOM-stripping claim. A citation inside
 * one is a claim about the modules it names; a `.ts` name in ordinary prose,
 * and a sentence saying a module does NOT strip or PRESERVES instead, are both
 * left alone — a correction is not a citation.
 */
function bomStripWindows(prose: string): string[] {
  return sentences(prose).filter(
    (s) =>
      /strip/i.test(s) &&
      /(BOM|U\+FEFF)/i.test(s) &&
      !/\b(not|never|no)\b/i.test(s) &&
      !/preserv/i.test(s),
  );
}

/** The modules a BOM-stripping claim cites, with any `:line` suffix dropped. */
function citedBomModules(prose: string): string[] {
  const cited = new Set<string>();
  for (const window of bomStripWindows(prose)) {
    for (const match of window.matchAll(/`([A-Za-z0-9_]+\.ts)(?::\d+)?`/g)) {
      cited.add(match[1]!);
    }
  }
  return [...cited].sort();
}

/** Any count a BOM-stripping claim states about the sibling class. */
function claimedSiblingCount(prose: string): number | null {
  const words: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  };
  for (const window of bomStripWindows(prose)) {
    const m = window.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:other\s+|sibling\s+)*modules?\b/i);
    if (m) {
      const token = m[1]!.toLowerCase();
      return words[token] ?? Number(token);
    }
  }
  return null;
}

/**
 * The assertion ITEM C IS. Every module a BOM-strip claim cites must actually
 * strip, and any count it states must match the measured class. A header that
 * cites nothing passes — dropping the citation is an accepted fix; restating it
 * loosely is not.
 */
function assertBomCitationIsAccurate(prose: string, label: string): void {
  const cited = citedBomModules(prose);
  const wrong = cited.filter((name) => {
    const path = join(SRC_DIR, name);
    return !existsSync(path) || !stripsBom(read(path));
  });
  const claimed = claimedSiblingCount(prose);
  const measured = measuredStrippers().length;
  // ONE assertion, both halves: reported separately, a fix for the false
  // citation would hide the stale count until the next run.
  expect({
    label,
    citedButDoesNotStrip: wrong,
    countClaimMatchesTheClass: claimed === null || claimed === measured,
    claimed,
    measured,
  }).toEqual({
    label,
    citedButDoesNotStrip: [],
    countClaimMatchesTheClass: true,
    claimed,
    measured,
  });
}

describe("ITEM C — every module a BOM-strip claim cites actually strips one", () => {
  test("the module header's citation is accurate", async () => {
    assertBomCitationIsAccurate(commentProse(moduleHeader(read(RENDER_MODULE))), "resume_gate_render header");
  });

  test("the header does not cite `archive_fr.ts`, which preserves rather than strips", () => {
    expect({
      cited: citedBomModules(commentProse(moduleHeader(read(RENDER_MODULE)))).includes("archive_fr.ts"),
    }).toEqual({ cited: false });
  });

  test("ground truth — `archive_fr.ts` preserves a BOM and strips none", () => {
    // The measurement the finding rests on, pinned so it is not re-litigated
    // from memory: `archive_fr.ts:80-84` lifts an existing BOM to the front of
    // a synthesized frontmatter block so a U+FEFF is not buried mid-document.
    const source = read(join(SRC_DIR, "archive_fr.ts"));
    expect({
      strips: stripsBom(source),
      preserves: /hasBom\(/.test(source) && /\$\{bom\}|bom === ""|bom \+/.test(source),
    }).toEqual({ strips: false, preserves: true });
  });

  test("the measured class is what the citation is checked against", () => {
    // Named, not counted from memory, and asserted as a SUPERSET so a future
    // module that starts stripping does not false-red this leg — the count
    // claim above is where a stale number is caught. Round 2 said "four" and
    // named four; the class was already bigger, because two strip via
    // `charCodeAt(0) === 0xfeff` and two more via a literal U+FEFF.
    const measured = measuredStrippers();
    expect({
      missing: [
        "carrier_phrase_probe.ts",
        "claudemd_docs_section.ts",
        "deliver_stage_capture.ts",
        "first_turn_refusal_marker.ts",
        "frontmatter.ts",
        "orchestration_config.ts",
        "toolkit_managed.ts",
      ].filter((name) => !measured.includes(name)),
      includesThePreserver: measured.includes("archive_fr.ts"),
    }).toEqual({ missing: [], includesThePreserver: false });
  });

  test("this file's own audit comments cite accurately too", () => {
    // Three of the four false claims this milestone has corrected were written
    // by its own forks, into files like this one.
    assertBomCitationIsAccurate(commentProse(read(join(PLUGIN_ROOT, "tests", "m133-ste-514-gate-render.test.ts"))), "this test file");
  });

  test("the check fires on the shipped wording — it is not vacuous", () => {
    const shipped = commentProse(
      [
        "// four sibling modules already strip the BOM for the same reason",
        "// (`carrier_phrase_probe.ts`, `first_turn_refusal_marker.ts`,",
        "// `deliver_stage_capture.ts`, `archive_fr.ts`).",
      ].join("\n"),
    );
    expect(citedBomModules(shipped)).toEqual([
      "archive_fr.ts",
      "carrier_phrase_probe.ts",
      "deliver_stage_capture.ts",
      "first_turn_refusal_marker.ts",
    ]);
    expect(claimedSiblingCount(shipped)).toBe(4);
    expect(() => assertBomCitationIsAccurate(shipped, "shipped wording")).toThrow();
  });

  test("a wrong COUNT alone reddens it, even with every citation accurate", () => {
    const miscounted = commentProse(
      "// three sibling modules already strip the BOM (`carrier_phrase_probe.ts`, `toolkit_managed.ts`).",
    );
    expect(citedBomModules(miscounted)).toEqual(["carrier_phrase_probe.ts", "toolkit_managed.ts"]);
    expect(() => assertBomCitationIsAccurate(miscounted, "miscounted")).toThrow();
  });

  test("an accurate citation passes, and so does dropping it entirely", () => {
    const accurate = commentProse(
      "// A leading U+FEFF is stripped, as `carrier_phrase_probe.ts` and `toolkit_managed.ts` already strip it.",
    );
    expect(() => assertBomCitationIsAccurate(accurate, "accurate")).not.toThrow();
    const dropped = commentProse(
      "// A leading U+FEFF is stripped here for the same reason the CRLF fold exists.",
    );
    expect(citedBomModules(dropped)).toEqual([]);
    expect(() => assertBomCitationIsAccurate(dropped, "dropped")).not.toThrow();
  });
});
