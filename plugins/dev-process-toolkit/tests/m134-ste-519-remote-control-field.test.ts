// M134 / STE-519 — "The confirm gate names the worker's bridge".
//
// THE CHANGE. `/deliver`'s pre-spawn decision record carries seven labelled
// fields today, none of which says anything about the worker's remote-control
// bridge. This FR APPENDS an eighth, `remote_control`, assembled from the
// derivation module STE-518 shipped this same milestone
// (`adapters/_shared/src/deliver_worker_name.ts`), so the operator sees the
// name the worker will be reachable under BEFORE anything is spawned and
// BEFORE anything is claimed.
//
// EVERY SURFACE UNDER TEST ALREADY EXISTS. Nothing here asks for a new module:
//
//     adapters/_shared/src/deliver_decision.ts     ← DECISION_FIELDS gains an 8th
//     adapters/_shared/src/resume_gate_render.ts   ← grades the 8th per-field
//     adapters/_shared/src/deliver_worker_name.ts  ← the derivation, unchanged
//     skills/deliver/SKILL.md                      ← the operative surface
//     docs/deliver-reference.md                    ← its debugging view
//
// THE CONTRACT THESE LEGS PIN, stated once so the implementer does not guess:
//
//   * `DECISION_FIELDS` becomes eight entries. The eighth and LAST is
//     `remote_control`; the first seven are byte-identical and in the same
//     order (AC.1). Appending, never inserting — the order IS the contract.
//
//   * `decideDelivery` fills the eighth from `deliver_worker_name.ts` for
//     every argument kind that produces a record at all — today
//     `milestone_identity` and `fr_identity`; `feature_request` produces no
//     record and is asserted to produce none (AC.2). The kind list is walked
//     off the exported `DELIVER_ARGUMENT_KINDS`, so a fourth kind reds this
//     leg rather than slipping past it.
//
//   * NO NEW REFUSAL PATH. An absent or blank eighth field refuses under the
//     completeness rule already in `renderDecisionRecord`, naming the field,
//     and the refusal it prints is the SAME MESSAGE the other seven produce
//     with the field name substituted (AC.3). If the implementer writes a
//     bespoke branch for the new field, that byte comparison reds.
//
//   * DROPPING THE BRIDGE RENDERS `none`, NOT NOTHING (AC.4). The pair is the
//     point: `none` is accepted and empty/whitespace is refused, because an
//     empty field is a refusal and would abort the very run the operator was
//     trying to continue.
//
//   * `verifyResumeGateRender` GRADES THE EIGHTH FIELD, asserted DIRECTLY
//     against the predicate's verdict (AC.5). A capture carrying the first
//     seven fields WITH VALUES and the eighth as a bare label is not a whole
//     record. This is deliberately NOT inferred from the predicate importing
//     `DECISION_FIELDS`: a predicate that imports the constant and then fails
//     to apply it to the new entry passes an inferred test and must red this
//     one.
//
//   * THREE PROSE CLAUSES on the operative surface (AC.6/7/8): editing the
//     field changes a FIELD and not a STEP; bridging a worker grants no
//     capability a bridged orchestrator lacks and only while the orchestrator
//     is itself bridged, named and not enforced; and relocating who answers a
//     prompt does not relax the gate taxonomy. Each is graded as ONE anchored
//     line, which in this repo's markdown is one paragraph — the surfaces
//     write paragraphs as single lines, so a clause split across two of them
//     will not satisfy its vector.
//
//   * SIBLING-SURFACE PARITY (AC.9). All four surfaces state the record's
//     field count, and all four must state EIGHT. Mutation-verified per
//     surface in both directions: reverting any ONE of them alone reddens the
//     parity verdict while the other three stay green, so the red is
//     attributable. The sentence at `SKILL.md:85` and `deliver-reference.md:31`
//     is BYTE-IDENTICAL today and gets its own leg — that pair is exactly the
//     drift shape this AC guards.
//
// IDIOMS ARE BORROWED, NOT INVENTED: fixture records come from the shipped
// `renderDecisionRecord`, the fixture project is the
// `m133-ste-514-gate-render.test.ts` tree, and the clause-vector / mutation
// machinery is that file's, narrowed to this FR's clauses.

import { describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DECISION_FIELDS,
  decideDelivery,
  renderDecisionRecord,
} from "../adapters/_shared/src/deliver_decision";
import {
  DELIVER_ARGUMENT_KINDS,
  defaultIdentityProbe,
  resolveDeliverArgument,
} from "../adapters/_shared/src/deliver_argument";
import {
  workerIdentitySegment,
  workerRemoteControlName,
} from "../adapters/_shared/src/deliver_worker_name";
import {
  GATE_RENDER_CAPTURE_NOT_A_RECORD,
  verifyResumeGateRender,
} from "../adapters/_shared/src/resume_gate_render";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const SRC_DIR = join(PLUGIN_ROOT, "adapters", "_shared", "src");

const DECISION_MODULE = join(SRC_DIR, "deliver_decision.ts");
const RENDER_MODULE = join(SRC_DIR, "resume_gate_render.ts");
const DELIVER_SKILL = join(PLUGIN_ROOT, "skills", "deliver", "SKILL.md");
const DELIVER_REFERENCE = join(PLUGIN_ROOT, "docs", "deliver-reference.md");

const SKILL_LABEL = "skills/deliver/SKILL.md";
const REFERENCE_LABEL = "docs/deliver-reference.md";
const DECISION_LABEL = "adapters/_shared/src/deliver_decision.ts";
const RENDER_LABEL = "adapters/_shared/src/resume_gate_render.ts";

const read = (p: string): string => readFileSync(p, "utf-8");

/** The field this FR appends. Spelled once. */
const REMOTE_FIELD = "remote_control";

/**
 * The seven fields that shipped BEFORE this FR, written out rather than sliced off the
 * constant under test — slicing the subject to check the subject proves
 * nothing. AC.1's "byte-identical and in the same order" is graded against
 * these literals.
 */
const FIRST_SEVEN = [
  "argument_kind",
  "target_repo_route",
  "resume_state",
  "chain",
  "merge_policy",
  "gate_class",
  "gate_relays",
] as const;

// ===========================================================================
// The fixture project — one resumable milestone with one active FR.
// (The m133-ste-514 tree, reused rather than reinvented, so these legs do not
// change verdict as this repo's own milestones ship.)
// ===========================================================================

const FIXTURE_MILESTONE = "M900";
const FIXTURE_FR = "STE-900";

function newFixture(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ste519-fx-")));
  mkdirSync(join(root, "specs", "plan"), { recursive: true });
  mkdirSync(join(root, "specs", "frs"), { recursive: true });
  writeFileSync(
    join(root, "CLAUDE.md"),
    [
      "# Fixture",
      "",
      "## Orchestration",
      "",
      "default_effort: high",
      "merge_policy: offer",
      "",
    ].join("\n"),
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

/** One fixture tree, built once — every leg below reads it, none mutates it. */
const FIXTURE_ROOT = newFixture();

// ===========================================================================
// Record helpers.
// ===========================================================================

/**
 * Split a printed record into label → value.
 *
 * Deliberately NOT driven off `DECISION_FIELDS`: at RED the constant does not
 * carry the eighth field, and a parser that only knows the constant's labels
 * would report "field absent" for a record that actually printed it. Reading
 * the labels off the bytes keeps AC.2's red attributable to the record, not to
 * the parser.
 */
const LABEL_RE = /^([a-z][a-z0-9_]*):(.*)$/;

function recordFields(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  let current: string | null = null;
  for (const line of text.split("\n")) {
    const match = LABEL_RE.exec(line);
    if (match !== null) {
      current = match[1]!;
      out[current] = match[2]!.trim();
      continue;
    }
    if (current !== null && line.trim().length > 0) {
      out[current] = `${out[current]}\n${line}`;
    }
  }
  return out;
}

/** A complete EIGHT-field record's inputs, in one place. */
const COMPLETE_FIELDS: Readonly<Record<string, string>> = {
  argument_kind: "milestone_identity",
  target_repo_route: "invoking",
  resume_state: "ready_to_implement",
  chain: [
    `  1. /implement ${FIXTURE_MILESTONE} (worker)`,
    `  2. /ship-milestone ${FIXTURE_MILESTONE} (worker)`,
    `  3. /pr ${FIXTURE_MILESTONE} (worker)`,
  ].join("\n"),
  merge_policy: "offer -> offer",
  gate_class: "content",
  gate_relays: "yes",
  [REMOTE_FIELD]: "dev-process-toolkit-m900",
};

function withField(field: string, value: string): Record<string, string> {
  return { ...COMPLETE_FIELDS, [field]: value };
}

function withoutField(field: string): Record<string, string> {
  const copy: Record<string, string> = { ...COMPLETE_FIELDS };
  delete copy[field];
  return copy;
}

/** The refusal `renderDecisionRecord` raises for `fields`, or `""` if none. */
function refusalFor(fields: Readonly<Record<string, string>>): string {
  try {
    renderDecisionRecord(fields);
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** A gate that shows `capture` verbatim, wrapped in its own prompt text. */
function gateAround(capture: string): string {
  return [
    `Before anything is spawned, here is the delivery decision for ${FIXTURE_MILESTONE}:`,
    "",
    capture,
    "",
    "Confirm this chain, edit it, or abort.",
  ].join("\n");
}

/**
 * The same capture with its eighth field reduced to a BARE LABEL — the exact
 * shape AC.5 names. Built by filtering and appending rather than by string
 * surgery, so it is the same shape whether or not the renderer already emits
 * the field.
 */
function withBareEighthLabel(capture: string): string {
  const kept = capture
    .split("\n")
    .filter((line) => !line.startsWith(`${REMOTE_FIELD}:`));
  return [...kept, `${REMOTE_FIELD}:`].join("\n");
}

/** The same capture with the eighth field removed outright. */
function withoutEighthField(capture: string): string {
  return capture
    .split("\n")
    .filter((line) => !line.startsWith(`${REMOTE_FIELD}:`))
    .join("\n");
}

// ===========================================================================
// AC.1 — the eighth and last entry, with the first seven unmoved.
// ===========================================================================

describe("AC-STE-519.1 — DECISION_FIELDS carries remote_control eighth and last", () => {
  test("the first seven are byte-identical and in the same order", () => {
    // The PREFIX explicitly, not just the length: a constant that reordered
    // two of the seven and appended the eighth would satisfy a length check.
    expect([...DECISION_FIELDS].slice(0, 7)).toEqual([...FIRST_SEVEN]);
  });

  test("there are eight entries and the eighth is remote_control", () => {
    expect({
      length: DECISION_FIELDS.length,
      eighth: DECISION_FIELDS[7] ?? null,
      last: DECISION_FIELDS[DECISION_FIELDS.length - 1] ?? null,
    }).toEqual({ length: 8, eighth: REMOTE_FIELD, last: REMOTE_FIELD });
  });

  test("it was APPENDED, not inserted — it appears exactly once, at the end", () => {
    const positions = [...DECISION_FIELDS]
      .map((field, index) => ({ field, index }))
      .filter((row) => row.field === REMOTE_FIELD)
      .map((row) => row.index);
    expect(positions).toEqual([7]);
  });
});

// ===========================================================================
// AC.2 — the eighth field is assembled from the derivation module, for every
// argument kind that produces a record at all.
// ===========================================================================

/** Which kinds produce a record, and the identity each is asked with. */
const RECORD_PRODUCING_KINDS = [
  { kind: "milestone_identity", argument: FIXTURE_MILESTONE },
  { kind: "fr_identity", argument: FIXTURE_FR },
] as const;

/** The one kind that produces no record — asserted, not assumed. */
const NO_RECORD_KIND = "feature_request";

describe("AC-STE-519.2 — decideDelivery assembles the eighth field from the derivation", () => {
  test("the kind vocabulary is covered — every kind is either a record or a refusal", () => {
    // Driven off the exported constant, so a fourth argument kind reds this
    // leg instead of quietly going ungraded by the two legs below.
    expect([...DELIVER_ARGUMENT_KINDS].sort()).toEqual(
      [...RECORD_PRODUCING_KINDS.map((r) => r.kind), NO_RECORD_KIND].sort(),
    );
  });

  for (const { kind, argument } of RECORD_PRODUCING_KINDS) {
    test(`${kind} — the record carries remote_control, derived for THIS run`, async () => {
      const record = await decideDelivery({
        argument,
        projectRoot: FIXTURE_ROOT,
      });
      const fields = recordFields(record);

      // What the derivation module itself says the name is, reached exactly
      // the way the implementer must reach it: the routing's own identity
      // segment, then the name builder.
      const routing = resolveDeliverArgument({
        raw: argument,
        probe: defaultIdentityProbe(FIXTURE_ROOT),
        stdinIsTty: true,
      });
      const derived = workerRemoteControlName({
        repoRoot: FIXTURE_ROOT,
        identity: workerIdentitySegment(routing),
      });

      expect({
        kind,
        present: typeof fields[REMOTE_FIELD] === "string",
        value: fields[REMOTE_FIELD] ?? null,
      }).toEqual({ kind, present: true, value: derived });
    });
  }

  test("the value is DERIVED, not a constant — the two kinds disagree", () => {
    // A hardcoded `none`, or the repository basename alone, would satisfy both
    // legs above only if the derivation returned it too. This one kills the
    // constant: the FR-scoped run and the milestone-scoped run name different
    // identities, so their names must differ.
    const milestoneName = workerRemoteControlName({
      repoRoot: FIXTURE_ROOT,
      identity: FIXTURE_MILESTONE,
    });
    const frName = workerRemoteControlName({
      repoRoot: FIXTURE_ROOT,
      identity: FIXTURE_FR,
    });
    expect(milestoneName).not.toBe(frName);
  });

  test("both runs print the derived name, and the two records differ in it", async () => {
    const milestoneRecord = recordFields(
      await decideDelivery({
        argument: FIXTURE_MILESTONE,
        projectRoot: FIXTURE_ROOT,
      }),
    );
    const frRecord = recordFields(
      await decideDelivery({ argument: FIXTURE_FR, projectRoot: FIXTURE_ROOT }),
    );
    expect({
      milestone: milestoneRecord[REMOTE_FIELD] ?? null,
      fr: frRecord[REMOTE_FIELD] ?? null,
    }).toEqual({
      milestone: workerRemoteControlName({
        repoRoot: FIXTURE_ROOT,
        identity: FIXTURE_MILESTONE,
      }),
      fr: workerRemoteControlName({
        repoRoot: FIXTURE_ROOT,
        identity: FIXTURE_FR,
      }),
    });
  });

  test("the eighth field is printed LAST, after gate_relays", async () => {
    const record = await decideDelivery({
      argument: FIXTURE_MILESTONE,
      projectRoot: FIXTURE_ROOT,
    });
    const labels = record
      .split("\n")
      .map((line) => LABEL_RE.exec(line))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => m[1]!);
    expect(labels).toEqual([...FIRST_SEVEN, REMOTE_FIELD]);
  });

  test(`${NO_RECORD_KIND} — produces no record at all, so it owes no field`, async () => {
    // The bound on "every argument kind that produces a record": this one
    // does not, and asserting the refusal is what makes the enumeration above
    // complete rather than convenient.
    let refused = "";
    try {
      await decideDelivery({
        argument: "build me a way to see what the worker is doing",
        projectRoot: FIXTURE_ROOT,
      });
    } catch (error) {
      refused = error instanceof Error ? error.message : String(error);
    }
    expect({
      refused: refused.length > 0,
      enveloped: refused.startsWith("Refusing: "),
    }).toEqual({ refused: true, enveloped: true });
  });
});

// ===========================================================================
// AC.3 — absent or blank refuses under the EXISTING completeness rule.
// ===========================================================================

describe("AC-STE-519.3 — an absent or blank eighth field refuses, naming it", () => {
  test("absent — the record refuses and names remote_control", () => {
    const message = refusalFor(withoutField(REMOTE_FIELD));
    expect({
      refused: message.length > 0,
      namesField: message.includes(`\`${REMOTE_FIELD}\``),
      namesFieldInContext: message.includes(`field=${REMOTE_FIELD}`),
      enveloped:
        message.includes("Refusing: ") &&
        message.includes("Remedy: ") &&
        message.includes("Context: "),
    }).toEqual({
      refused: true,
      namesField: true,
      namesFieldInContext: true,
      enveloped: true,
    });
  });

  for (const [label, blank] of [
    ["empty string", ""],
    ["spaces", "   "],
    ["a tab", "\t"],
    ["a newline", "\n"],
  ] as const) {
    test(`blank (${label}) — refuses and names remote_control`, () => {
      const message = refusalFor(withField(REMOTE_FIELD, blank));
      expect({
        refused: message.length > 0,
        namesField: message.includes(`\`${REMOTE_FIELD}\``),
      }).toEqual({ refused: true, namesField: true });
    });
  }

  test("NO NEW REFUSAL PATH — it is the same message the other seven produce", () => {
    // The whole of AC.3's second half. `gate_relays` is the seventh field and
    // refuses under the shipped completeness rule; if the eighth's refusal is
    // that same message with the field name substituted, then no bespoke
    // branch was written for the new field. A hand-rolled refusal — different
    // wording, different remedy, an extra sentence about the bridge — reds
    // here even though every leg above stays green.
    const seventh = refusalFor(withoutField("gate_relays"));
    const eighth = refusalFor(withoutField(REMOTE_FIELD));
    expect({
      seventhRefused: seventh.length > 0,
      eighthRefused: eighth.length > 0,
    }).toEqual({ seventhRefused: true, eighthRefused: true });
    expect(seventh.replaceAll("gate_relays", REMOTE_FIELD)).toBe(eighth);
  });

  test("a complete record does not refuse — the rule is not always-on", () => {
    expect(refusalFor(COMPLETE_FIELDS)).toBe("");
  });
});

// ===========================================================================
// AC.4 — dropping the bridge renders `none`, and blank is still an abort.
// ===========================================================================

describe("AC-STE-519.4 — dropping the bridge renders `none`, never an empty field", () => {
  test("`none` is accepted and printed as the eighth field's value", () => {
    const rendered = renderDecisionRecord(withField(REMOTE_FIELD, "none"));
    expect({
      printed: rendered.includes(`${REMOTE_FIELD}: none`),
      lastLine: rendered.split("\n").at(-1) ?? null,
    }).toEqual({ printed: true, lastLine: `${REMOTE_FIELD}: none` });
  });

  test("the pair is the point — `none` renders where blank refuses", () => {
    // Asserted together, because either half alone permits the wrong design:
    // accepting `none` with blank ALSO accepted is a field that can be
    // silently empty, and refusing blank with `none` ALSO refused leaves the
    // operator who declined the bridge with no way to continue the run.
    expect({
      noneAccepted: refusalFor(withField(REMOTE_FIELD, "none")) === "",
      emptyRefused: refusalFor(withField(REMOTE_FIELD, "")) !== "",
      whitespaceRefused: refusalFor(withField(REMOTE_FIELD, "   ")) !== "",
    }).toEqual({
      noneAccepted: true,
      emptyRefused: true,
      whitespaceRefused: true,
    });
  });

  test("a record whose bridge is dropped is still a whole record to the predicate", () => {
    const capture = renderDecisionRecord(withField(REMOTE_FIELD, "none"));
    expect(verifyResumeGateRender(gateAround(capture), capture)).toEqual({
      ok: true,
      reasons: [],
    });
  });
});

// ===========================================================================
// AC.5 — the render predicate grades the eighth field, asserted DIRECTLY.
// ===========================================================================

describe("AC-STE-519.5 — verifyResumeGateRender grades the eighth field", () => {
  test("a whole eight-field record, shown verbatim, grades clean", () => {
    // The positive control, and it also pins that the capture really carries
    // eight VALUED fields — a control that passed on a seven-field capture
    // would make the leg below unattributable.
    const capture = renderDecisionRecord(COMPLETE_FIELDS);
    expect({
      carriesEighthWithValue: new RegExp(
        `^${REMOTE_FIELD}: \\S`,
        "m",
      ).test(capture),
      verdict: verifyResumeGateRender(gateAround(capture), capture),
    }).toEqual({
      carriesEighthWithValue: true,
      verdict: { ok: true, reasons: [] },
    });
  });

  test("seven valued fields plus a BARE eighth label is not a whole record", () => {
    // ASSERTED DIRECTLY against the predicate's verdict. Not inferred from the
    // predicate importing `DECISION_FIELDS`: a predicate that imports the
    // constant and then fails to apply it to the new entry passes an inferred
    // test and must red this one. The rendering shows the capture verbatim, so
    // containment cannot be what fails here — only the record check can.
    const capture = withBareEighthLabel(renderDecisionRecord(COMPLETE_FIELDS));
    const verdict = verifyResumeGateRender(gateAround(capture), capture);
    expect({
      ok: verdict.ok,
      namesTheCode: verdict.reasons.some((r) =>
        r.includes(GATE_RENDER_CAPTURE_NOT_A_RECORD),
      ),
      namesTheField: verdict.reasons.some((r) => r.includes(REMOTE_FIELD)),
    }).toEqual({ ok: false, namesTheCode: true, namesTheField: true });
  });

  test("the eighth field missing outright is not a whole record either", () => {
    const capture = withoutEighthField(renderDecisionRecord(COMPLETE_FIELDS));
    const verdict = verifyResumeGateRender(gateAround(capture), capture);
    expect({
      ok: verdict.ok,
      namesTheCode: verdict.reasons.some((r) =>
        r.includes(GATE_RENDER_CAPTURE_NOT_A_RECORD),
      ),
      namesTheField: verdict.reasons.some((r) => r.includes(REMOTE_FIELD)),
    }).toEqual({ ok: false, namesTheCode: true, namesTheField: true });
  });

  test("the bare-label check is about the EIGHTH, not about bare labels in general", () => {
    // Isolation: the same capture with a valued eighth field and everything
    // else untouched grades clean, so the red above is attributable to the
    // eighth field alone rather than to the capture being mangled.
    const whole = renderDecisionRecord(COMPLETE_FIELDS);
    const bare = withBareEighthLabel(whole);
    expect({
      whole: verifyResumeGateRender(gateAround(whole), whole).ok,
      bare: verifyResumeGateRender(gateAround(bare), bare).ok,
    }).toEqual({ whole: true, bare: false });
  });

  test("the count the predicate reports is eight, not seven", () => {
    // The reason text quotes `N of M labelled fields`. A predicate that reads
    // the constant for its list but printed a stale total would still mislead
    // the reader it is written for.
    const capture = withBareEighthLabel(renderDecisionRecord(COMPLETE_FIELDS));
    const reasons = verifyResumeGateRender(gateAround(capture), capture).reasons.join(
      " ",
    );
    expect({
      saysOfEight: /\bof\s+8\b/.test(reasons) || /\bof\s+eight\b/i.test(reasons),
      saysOfSeven: /\bof\s+7\b/.test(reasons) || /\bof\s+seven\b/i.test(reasons),
    }).toEqual({ saysOfEight: true, saysOfSeven: false });
  });
});

// ===========================================================================
// The prose clauses — AC.6, AC.7, AC.8 — and the machinery they share with
// AC.9's parity legs. (The m133-ste-514 clause-vector idiom, narrowed.)
// ===========================================================================

interface SurfaceClause {
  readonly id: string;
  readonly what: string;
  /** Identifies candidate lines. */
  readonly anchor: (line: string) => boolean;
  /** All of these must hold on ONE anchored line for the clause to be present. */
  readonly required: readonly { readonly name: string; readonly re: RegExp }[];
}

/** AC.6 — editing the remote-control field changes a FIELD, not a STEP. */
const FIELD_NOT_STEP_CLAUSE: SurfaceClause = {
  id: "AC.6",
  what: "editing the remote-control field changes a field, not a step",
  anchor: (line) => /remote[-_ ]control/i.test(line) && /\bedit/i.test(line),
  required: [
    { name: "a-field", re: /\bfield\b/i },
    { name: "not-a-step", re: /\b(not|never|rather than)\b[^.]{0,80}\bstep\b/i },
    { name: "placement-rule", re: /placement/i },
    {
      name: "unaffected",
      re: /\b(unaffected|untouched|unchanged|intact|still (holds|stands|applies))\b/i,
    },
  ],
};

/** AC.7 — the precondition the gate NAMES and nothing enforces. */
const BRIDGE_PRECONDITION_CLAUSE: SurfaceClause = {
  id: "AC.7",
  what: "bridging a worker grants no capability a bridged orchestrator lacks",
  anchor: (line) => /bridg/i.test(line) && /capabilit/i.test(line),
  required: [
    { name: "no-new-capability", re: /\bno\b[^.]{0,80}capabilit/i },
    { name: "orchestrator", re: /orchestrator/i },
    { name: "only-while-bridged", re: /\bonly\b[^.]{0,80}\b(while|when|as long as|if)\b/i },
    { name: "nothing-enforces-it", re: /\b(nothing enforces|not enforced|unenforced)\b/i },
  ],
};

/** AC.8 — relocating who answers a prompt does not relax the taxonomy. */
const TAXONOMY_UNCHANGED_CLAUSE: SurfaceClause = {
  id: "AC.8",
  what: "relocating who answers a prompt does not relax the gate taxonomy",
  anchor: (line) => /irreversible/i.test(line) && /\bhuman\b/i.test(line),
  required: [
    { name: "no-relaxation", re: /\b(does not relax|no relaxation|not relaxed|does not weaken|unchanged)\b/i },
    { name: "taxonomy", re: /taxonom/i },
    { name: "irreversible", re: /irreversible/i },
    { name: "outward-facing", re: /outward[- ]facing/i },
    { name: "per-action", re: /per-action/i },
    { name: "a-phone-is-a-human", re: /\bphone\b[^.]{0,60}\bhuman\b/i },
  ],
};

/** Anchored lines on `text`, with their 1-based line numbers. */
function anchoredLines(
  text: string,
  clause: SurfaceClause,
): { line: number; raw: string }[] {
  return text
    .split("\n")
    .map((raw, i) => ({ line: i + 1, raw }))
    .filter((row) => clause.anchor(row.raw));
}

/** Which requirements a surface satisfies — the vector, for a readable diff. */
function clauseVector(
  text: string,
  clause: SurfaceClause,
): Record<string, boolean> {
  const anchored = anchoredLines(text, clause).map((row) => row.raw);
  const out: Record<string, boolean> = { anchored: anchored.length > 0 };
  // The contract above is ONE anchored line carrying EVERY requirement — the
  // `clauseLine` idiom this borrows from m133-ste-514. Grading each requirement
  // independently with `anchored.some(...)` would let a clause split across two
  // anchored paragraphs pass, which is weaker than the interface promises and
  // is the fail-open shape this repo keeps shipping. So the vector is reported
  // for the BEST SINGLE line — the anchored line satisfying the most
  // requirements — and a clause that never lands whole on one line shows the
  // requirement it is missing rather than borrowing it from a neighbour.
  let best: string | null = null;
  let bestScore = -1;
  for (const raw of anchored) {
    const score = clause.required.filter((r) => r.re.test(raw)).length;
    if (score > bestScore) {
      bestScore = score;
      best = raw;
    }
  }
  for (const { name, re } of clause.required) {
    out[name] = best !== null && re.test(best);
  }
  return out;
}

/** The vector a satisfied clause produces: anchored, plus every requirement. */
function satisfiedVector(clause: SurfaceClause): Record<string, boolean> {
  const out: Record<string, boolean> = { anchored: true };
  for (const { name } of clause.required) out[name] = true;
  return out;
}

describe("AC-STE-519.6 — the field edit is a FIELD edit, and placement is untouched", () => {
  test("the operative surface states it", () => {
    expect({
      surface: SKILL_LABEL,
      ...clauseVector(read(DELIVER_SKILL), FIELD_NOT_STEP_CLAUSE),
    }).toEqual({ surface: SKILL_LABEL, ...satisfiedVector(FIELD_NOT_STEP_CLAUSE) });
  });

  test("the existing placement prohibition still stands on that surface", () => {
    // The other half of AC.6: "unaffected" is a claim about a rule that has to
    // still be there. A surface that stated the new clause and dropped the old
    // prohibition would satisfy the vector above and break the thing it claims.
    const skill = read(DELIVER_SKILL);
    const placement = skill
      .split("\n")
      .filter((line) => /placement/i.test(line) && /\bedit/i.test(line))
      .filter((line) => /\b(never|not|may not|cannot)\b/i.test(line));
    expect(placement.length).toBeGreaterThan(0);
  });
});

describe("AC-STE-519.7 — the precondition is NAMED, and named as unenforced", () => {
  test("the operative surface states it", () => {
    expect({
      surface: SKILL_LABEL,
      ...clauseVector(read(DELIVER_SKILL), BRIDGE_PRECONDITION_CLAUSE),
    }).toEqual({
      surface: SKILL_LABEL,
      ...satisfiedVector(BRIDGE_PRECONDITION_CLAUSE),
    });
  });
});

describe("AC-STE-519.8 — relocating who answers does not relax the gate taxonomy", () => {
  test("the operative surface states it", () => {
    expect({
      surface: SKILL_LABEL,
      ...clauseVector(read(DELIVER_SKILL), TAXONOMY_UNCHANGED_CLAUSE),
    }).toEqual({
      surface: SKILL_LABEL,
      ...satisfiedVector(TAXONOMY_UNCHANGED_CLAUSE),
    });
  });
});

// ===========================================================================
// AC.9 — sibling-surface parity on the stated field count, across FOUR
// surfaces, mutation-verified per surface in both directions.
// ===========================================================================

const COUNT_SURFACES = [
  { label: SKILL_LABEL, path: DELIVER_SKILL },
  { label: REFERENCE_LABEL, path: DELIVER_REFERENCE },
  { label: DECISION_LABEL, path: DECISION_MODULE },
  { label: RENDER_LABEL, path: RENDER_MODULE },
] as const;

/**
 * Counts that are NOT the record's field count and must not be read as one:
 * the `deliver-stage-result` block's eight SECTIONS (SKILL.md, the reference)
 * and the eight SIBLING MODULES that strip a BOM (`resume_gate_render.ts`).
 * Scrubbed before a line is classified, so an unrelated eight cannot green a
 * surface that never updated its real count — and cannot be reverted by the
 * mutation either.
 */
const NON_RECORD_COUNTS =
  /\b(six|seven|eight|nine)[-\s](sections?|siblings?|modules?)\b/gi;

/** A count line has to be ABOUT the record: fields, labels, or the record. */
const RECORD_TERM = /\b(fields?|labels?|labell?ed|record)\b/i;

/**
 * `seven of eight` is a PARTIAL count, not a stale total — the completeness
 * comment states one. Stripped before the stale check so the legitimate
 * sentence does not read as drift.
 */
const PARTIAL_OF_EIGHT =
  /\b(one|two|three|four|five|six|seven)\s+of\s+(eight|8)\b/gi;

function countText(raw: string): string {
  return raw.replace(NON_RECORD_COUNTS, " ");
}

function isCountLine(raw: string): boolean {
  const text = countText(raw);
  return /\b(seven|eight|7|8)\b/i.test(text) && RECORD_TERM.test(text);
}

interface CountVerdict {
  readonly surface: string;
  readonly statesEight: boolean;
  readonly stale: readonly { line: number; excerpt: string }[];
}

function countVerdict(surface: string, text: string): CountVerdict {
  const lines = text
    .split("\n")
    .map((raw, i) => ({ line: i + 1, raw }))
    .filter((row) => isCountLine(row.raw));
  const stale = lines
    .filter((row) =>
      /\bseven\b/i.test(countText(row.raw).replace(PARTIAL_OF_EIGHT, " ")),
    )
    .map((row) => ({ line: row.line, excerpt: row.raw.trim().slice(0, 110) }));
  const statesEight = lines.some((row) =>
    /\b(eight|8)\b/i.test(countText(row.raw)),
  );
  return { surface, statesEight, stale };
}

/** The verdict a surface that states the count correctly produces. */
function cleanVerdict(surface: string): CountVerdict {
  return { surface, statesEight: true, stale: [] };
}

/** Revert one surface's stated count from eight back to seven. */
function revertToSeven(text: string): { mutated: string; changed: number } {
  let changed = 0;
  const mutated = text
    .split("\n")
    .map((raw) => {
      if (!isCountLine(raw)) return raw;
      const next = raw
        .replace(/\bEIGHT\b/g, "SEVEN")
        .replace(/\bEight\b/g, "Seven")
        .replace(/\beight\b/g, "seven")
        .replace(/\b8\b/g, "7");
      if (next !== raw) changed += 1;
      return next;
    })
    .join("\n");
  return { mutated, changed };
}

describe("AC-STE-519.9 — every surface stating the record's field count states EIGHT", () => {
  test("all four surfaces agree, and none still says seven", () => {
    expect(
      COUNT_SURFACES.map((s) => countVerdict(s.label, read(s.path))),
    ).toEqual(COUNT_SURFACES.map((s) => cleanVerdict(s.label)));
  });

  for (const surface of COUNT_SURFACES) {
    test(`${surface.label} — states the count at all (non-vacuous)`, () => {
      // Four surfaces saying NOTHING about the count is not parity. Each has
      // to carry at least one line that states it.
      const lines = read(surface.path)
        .split("\n")
        .filter((raw) => isCountLine(raw));
      expect({ surface: surface.label, statesTheCount: lines.length > 0 }).toEqual({
        surface: surface.label,
        statesTheCount: true,
      });
    });
  }

  test("the byte-identical sentence stays byte-identical, and says eight", () => {
    // SKILL.md:85 and deliver-reference.md:31 are the same bytes today. That
    // pair is the drift shape this AC guards, so it gets its own leg: present
    // on BOTH (two nulls are not agreement), equal, and updated.
    const predicateLine = (text: string): string | null =>
      text
        .split("\n")
        .find((line) =>
          line.includes("verifyResumeGateRender(rendered, capturedStdout)"),
        ) ?? null;
    const skillLine = predicateLine(read(DELIVER_SKILL));
    const referenceLine = predicateLine(read(DELIVER_REFERENCE));
    expect({
      skillPresent: typeof skillLine === "string" && skillLine.length > 0,
      referencePresent:
        typeof referenceLine === "string" && referenceLine.length > 0,
    }).toEqual({ skillPresent: true, referencePresent: true });
    expect(referenceLine).toBe(skillLine!);
    expect({
      saysEight: /\b(eight|8)\b/i.test(countText(skillLine!)),
      saysSeven: /\bseven\b/i.test(
        countText(skillLine!).replace(PARTIAL_OF_EIGHT, " "),
      ),
    }).toEqual({ saysEight: true, saysSeven: false });
  });
});

describe("AC-STE-519.9 — mutation-verified: reverting ANY ONE surface reddens it", () => {
  for (const target of COUNT_SURFACES) {
    test(`reverting ${target.label} alone turns the parity assertion red`, () => {
      const texts = new Map(
        COUNT_SURFACES.map((s) => [s.label, read(s.path)] as const),
      );

      // Pre-condition: all four green before the mutation. Without this, a
      // surface that never shipped the update would make the mutation leg
      // pass for the wrong reason.
      expect(
        COUNT_SURFACES.map((s) => countVerdict(s.label, texts.get(s.label)!)),
      ).toEqual(COUNT_SURFACES.map((s) => cleanVerdict(s.label)));

      const { mutated, changed } = revertToSeven(texts.get(target.label)!);
      // The mutation must APPLY: one that never landed reads as a pass.
      expect({ surface: target.label, applied: changed > 0 }).toEqual({
        surface: target.label,
        applied: true,
      });

      const after = countVerdict(target.label, mutated);
      expect({
        surface: after.surface,
        statesEight: after.statesEight,
        hasStale: after.stale.length > 0,
      }).toEqual({
        surface: target.label,
        statesEight: false,
        hasStale: true,
      });

      // And the other three stay green, so the red is ATTRIBUTABLE to the one
      // surface that was reverted rather than to a global effect.
      for (const other of COUNT_SURFACES.filter(
        (s) => s.label !== target.label,
      )) {
        expect(countVerdict(other.label, texts.get(other.label)!)).toEqual(
          cleanVerdict(other.label),
        );
      }
    });
  }
});
