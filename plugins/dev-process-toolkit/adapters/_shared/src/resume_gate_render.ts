// resume_gate_render — M133 STE-514: grade what the confirm gate SHOWED against
// what the decision command PRINTED.
//
// THE DEFECT THIS EXISTS FOR, measured. `/deliver`'s pre-spawn confirm gate is
// ordered in prose, so what the operator sees is whatever the reader chose to
// write down. On the M130 run (2026-08-24) the reader rendered the resume state
// as its own one line —
//
//     **Resume state** → ready_to_implement
//
// — and self-approved it. Nothing could tell that apart from a real
// classification, because nothing was comparing the two. An acceptance
// criterion asserting only that a gate was SHOWN passes on that run.
//
// So the comparison is against BYTES, not against the presence of a gate. The
// record `deliver_decision.ts` prints is the subject; this module answers one
// question about a rendering of it: are those bytes actually in there, or is
// this a retelling?
//
// CONTAINMENT, NOT EQUALITY. The gate legitimately wraps the record in its own
// prompt text ("here is the delivery decision … confirm, edit, or abort"), so a
// rendering that carries the capture inside surrounding prose passes. What
// fails is a rendering that restates the record in the renderer's own words —
// reordered lines, a reworded field, a one-line summary.
//
// THE NORMALIZATIONS, AND WHY EACH ONE IS SAFE. `\r\n`/`\r` → `\n` and a
// leading U+FEFF (a BOM) are removed from BOTH sides, and the capture's
// TRAILING WHITESPACE is trimmed before containment — the decision command
// prints through `console.log`, so a shell capture ends in a newline, while the
// `$(...)` shape eats that newline out of the rendering; a gate ending exactly
// at the record was graded a retelling for it, a false red on a faithful gate.
// This repo has lost a whole transform to CRLF twice (M114's Linear checkbox
// push, M113's colon-only readers), and seven sibling modules already strip a
// leading BOM for the same reason (`carrier_phrase_probe.ts`,
// `claudemd_docs_section.ts`, `deliver_stage_capture.ts`,
// `first_turn_refusal_marker.ts`, `frontmatter.ts`, `orchestration_config.ts`,
// `toolkit_managed.ts`). NONE OF THE THREE WIDENS WHAT PASSES — that is the
// test each one has to meet. A BOM'd faithful render was graded a retelling and
// dropping the mark admits no retelling that was not already admitted; trimming
// the capture's tail admits none either, because a rendering that drops a whole
// LINE still fails. Whitespace runs inside the record, case and punctuation are
// a different matter: folding those WOULD start accepting the retellings this
// module exists to reject, so they are left exactly as they were written.
//
// A BLANK CAPTURE IS NEVER A PASS. The empty string is contained in every
// string, so a predicate without this guard grades every gate `ok` the day the
// capture goes missing — the exact silent-skip failure shape the house rule
// ("silent skips are worse than loud failures") is about.
//
// AND NEITHER IS A CAPTURE THAT IS NOT A RECORD. Non-blank is not the same as
// "a decision record": a retelling handed in as its own capture contains
// itself, so plain containment grades it clean — measured, on this module, at
// `verifyResumeGateRender(paraphrase, paraphrase)`. So the capture is checked
// per field, against `DECISION_FIELDS`, BEFORE any grading happens with it —
// and a LABEL IS NOT A FIELD: each of the seven has to carry a non-empty value,
// on its own line after the colon or, for the one multi-line field, on a
// continuation line before the next label. Seven bare labels were measured
// grading clean through the shipped tool.
//
// AND THE CAPTURE IS AN EXECUTION, NOT AN ARGUMENT. The predicate below is a
// pure two-string function and stays one: it cannot tell a hand-typed record
// from a printed one, and is not asked to. Authentication is a PROVENANCE
// property, so it lives at the entrypoint — the CLI takes no capture path at
// all and runs the decision itself, in this process, now. A hand-typed record
// and a real capture with one value doctored both graded `ok` through the
// two-file door this replaces.
//
// This module decides nothing about the record's CONTENT: the field names come
// from `deliver_decision`'s exported `DECISION_FIELDS`, never retyped here, so
// the predicate and the record cannot drift when a field is added.

import { readFileSync } from "node:fs";

import { DECISION_FIELDS, decideDelivery } from "./deliver_decision";

/** The verdict: a boolean plus the reason codes that explain a `false`. */
export interface ResumeGateVerdict {
  readonly ok: boolean;
  readonly reasons: readonly string[];
}

/**
 * The rendering does not reference the record at all — no gate was shown, or
 * what was shown is about something else. Remedy: show the record.
 */
export const GATE_RENDER_ABSENT = "gate-render-absent";

/**
 * The rendering REFERENCES the record but does not carry its bytes — a
 * retelling. Remedy: paste the capture instead of describing it.
 *
 * Named apart from an absence on purpose: the two failures have different
 * remedies, and reporting one as the other sends the reader looking for the
 * wrong thing.
 */
export const GATE_RENDER_PARAPHRASED = "gate-render-paraphrased";

/**
 * There was nothing to compare against — the capture is blank. Not a verdict
 * about the rendering at all, which is why it is its own code.
 */
export const GATE_RENDER_NO_CAPTURE = "gate-render-no-capture";

/**
 * Something WAS captured, but it is not a decision record — fields are missing.
 * Grading a rendering against it certifies nothing, and the worst shape it
 * takes is the retelling handed in as its own capture, which contains itself.
 *
 * Its own code, distinct from a blank capture: "nothing was captured" and "what
 * was captured is not the record" send the reader to different places.
 */
export const GATE_RENDER_CAPTURE_NOT_A_RECORD = "gate-render-capture-not-a-record";

/**
 * `\r\n` and bare `\r` → `\n`, and a leading U+FEFF removed. Both sides get
 * exactly these two, for the reason in the header: neither widens what passes.
 */
function normalizeEol(text: string): string {
  return text
    .replace(/^\uFEFF/, "")
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n");
}

/** Does `line` open one of the seven fields? */
function isFieldLabel(line: string): boolean {
  return DECISION_FIELDS.some((field) => line.startsWith(`${field}:`));
}

/**
 * Which of the seven labelled fields the capture does not carry WITH A VALUE.
 * Per field, never collective: a check that looked only for `resume_state:`
 * would pass a one-line truncation the moment a second line was added under it.
 *
 * A LABEL IS NOT A FIELD. `field:` with nothing after it is a shape, not a
 * record — seven bare labels handed in as a capture were measured grading a
 * gate clean. The value may sit on the label's own line after the colon, or, as
 * `renderDecisionRecord` prints the one multi-line field (a bare `chain:` with
 * its step lines below), on at least one non-blank continuation line before the
 * next label. Requiring it on the same line would red a real record.
 */
function missingRecordFields(capture: string): readonly string[] {
  const lines = capture.split("\n");
  return DECISION_FIELDS.filter((field) => {
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]!;
      if (!line.startsWith(`${field}:`)) continue;
      if (line.slice(field.length + 1).trim().length > 0) return false;
      for (let j = i + 1; j < lines.length; j += 1) {
        const next = lines[j]!;
        if (isFieldLabel(next)) break;
        if (next.trim().length > 0) return false;
      }
    }
    return true;
  });
}

/**
 * The two spellings a field label can wear in prose: canonical (`resume_state`)
 * and spaced (`resume state`). Compared case-insensitively, because a reader
 * writing prose title-cases (`**Resume state**` — the M130 emission verbatim).
 */
const FIELD_LABEL_SPELLINGS: readonly string[] = DECISION_FIELDS.flatMap((field) => [
  field.toLowerCase(),
  field.replaceAll("_", " ").toLowerCase(),
]);

/** The shortest value token that counts as a quotation rather than a coincidence. */
const VALUE_TOKEN_MIN = 8;

/** Punctuation a prose writer wraps a token in, stripped from the edges only. */
const EDGE_PUNCTUATION = /^[`*_"'([{<]+|[`*_"',;:.!?)\]}>]+$/g;

/**
 * The capture's own vocabulary: every whitespace-separated token of
 * `VALUE_TOKEN_MIN`+ characters, edge punctuation stripped. A rendering that
 * carries one of these verbatim is talking ABOUT the record even when it names
 * no field — the `→ ready_to_implement, so I will …` shape.
 */
function captureTokens(capture: string): readonly string[] {
  const tokens = new Set<string>();
  for (const raw of capture.split(/\s+/)) {
    const token = raw.replace(EDGE_PUNCTUATION, "");
    if (token.length >= VALUE_TOKEN_MIN) tokens.add(token);
  }
  return [...tokens];
}

/** Does `rendered` reference the record — by field label, or by a value token? */
function referencesRecord(rendered: string, capture: string): boolean {
  const lowered = rendered.toLowerCase();
  if (FIELD_LABEL_SPELLINGS.some((label) => lowered.includes(label))) return true;
  // Verbatim, not lowered: a value quoted back is quoted as it was printed.
  return captureTokens(capture).some((token) => rendered.includes(token));
}

/**
 * Grade one confirm-gate rendering against the bytes the decision command
 * captured.
 *
 * `ok: true` IFF the capture is a whole decision record AND `rendered` carries
 * its bytes as one contiguous run.
 *
 * PRECEDENCE, and it is load-bearing: a blank capture is `NO_CAPTURE`; a
 * non-blank capture that is not a record is `CAPTURE_NOT_A_RECORD`; only then
 * is the rendering itself graded, by containment first and reference second.
 */
export function verifyResumeGateRender(
  rendered: string | null | undefined,
  capturedStdout: string,
): ResumeGateVerdict {
  const capture =
    typeof capturedStdout === "string" ? normalizeEol(capturedStdout) : "";
  if (capture.trim().length === 0) {
    return {
      ok: false,
      reasons: [
        `${GATE_RENDER_NO_CAPTURE}: the decision command produced no output to ` +
          "compare the gate against, so this rendering cannot be graded at all " +
          "— an empty capture is contained in every rendering, and grading it " +
          "`ok` would pass every gate the day the capture went missing. Run " +
          "`deliver_decision.ts` and capture its stdout before showing the gate.",
      ],
    };
  }

  const missing = missingRecordFields(capture);
  if (missing.length > 0) {
    return {
      ok: false,
      reasons: [
        `${GATE_RENDER_CAPTURE_NOT_A_RECORD}: the bytes handed in as the ` +
          `capture are not a whole decision record — ${missing.length} of ` +
          `${DECISION_FIELDS.length} labelled fields are absent (` +
          `${missing.join(", ")}), so grading any rendering against them ` +
          "certifies nothing. A retelling supplied as its own capture " +
          "contains itself, which is how a one-line summary grades clean. " +
          "Run `deliver_decision.ts` and hand in the stdout it printed — the " +
          "whole record is the only thing a gate rendering can be graded " +
          "against.",
      ],
    };
  }

  const text = typeof rendered === "string" ? normalizeEol(rendered) : "";
  // The capture's TRAILING whitespace only. `console.log` gives the capture a
  // final newline that `$(...)` strips back out of the rendering, so a gate
  // ending exactly at the record is faithful, not a retelling. Dropping a whole
  // line still fails, which is the guard on this guard.
  if (text.includes(capture.replace(/\s+$/, ""))) return { ok: true, reasons: [] };

  if (referencesRecord(text, capture)) {
    return {
      ok: false,
      reasons: [
        `${GATE_RENDER_PARAPHRASED}: the gate rendering talks about the decision ` +
          "record but does not carry its bytes — it is a retelling, and a " +
          "retelling is what the operator then approves instead of the record. " +
          "Show the captured output verbatim; wrapping it in prompt text is " +
          "fine, rewriting it is not.",
      ],
    };
  }

  return {
    ok: false,
    reasons: [
      `${GATE_RENDER_ABSENT}: the gate rendering does not show the decision ` +
        "record at all, so nothing was put in front of the operator to confirm. " +
        "Render the captured output before asking for approval.",
    ],
  };
}

/** The three line prefixes a canonical NFR-10 envelope always carries. */
const ENVELOPE_PREFIXES = ["Refusing: ", "Remedy: ", "Context: "] as const;

/** The canonical NFR-10 envelope: Refusing / Remedy / Context, in that order. */
function envelope(parts: {
  verdict: string;
  remedy: string;
  context: string;
}): string {
  return [
    `${ENVELOPE_PREFIXES[0]}${parts.verdict}`,
    `${ENVELOPE_PREFIXES[1]}${parts.remedy}`,
    `${ENVELOPE_PREFIXES[2]}${parts.context}`,
  ].join("\n");
}

/** Usage, spelled once so the refusals and the surfaces cannot drift apart. */
const USAGE = "bun run resume_gate_render.ts <argument> [projectRoot] <renderedPath>";

/** Does `message` already wear all three envelope lines? */
function carriesEnvelope(message: string): boolean {
  const lines = message.split("\n");
  return ENVELOPE_PREFIXES.every((prefix) =>
    lines.some((line) => line.startsWith(prefix)),
  );
}

// Read-only CLI mirroring `deliver_decision.ts` and `spawn_receipt.ts`: the
// question "is this gate rendering the record, or a retelling of it?" is asked
// through this one entrypoint instead of being re-judged in skill prose. A
// predicate with no invoker is a predicate that never runs — measured on this
// module, which for one milestone was imported by nothing but its own test.
// Imported rather than run, `import.meta.main` is false and this block never
// executes, so the module stays side-effect free at import. Usage:
//
//   bun run resume_gate_render.ts <argument> [projectRoot] <renderedPath>
//
// THERE IS NO CAPTURE ARGUMENT, and that absence is the point. A capture handed
// in as a file authenticates nothing: measured through the previous two-file
// door, a hand-typed seven-field record and a real capture with one value
// doctored both graded `ok`. So this entry takes the IDENTITY instead and calls
// `decideDelivery` itself — the bytes it grades against are the ones that call
// just produced, in this process, now, and nobody handing in a rendering gets
// to choose them. `projectRoot` is optional and defaults to `process.cwd()`,
// the same `?? process.cwd()` shape the decision command uses for its own.
//
// A refusal raised by the decision command is FORWARDED, not graded: the gate
// is never judged against a record that could not be produced, and the refusal
// the reader sees is the one that says what to fix.
//
// A clean grade prints its verdict on stdout and exits 0. A refusal prints the
// canonical envelope on stderr, exits non-zero, and prints NOTHING on stdout —
// so a caller reading stdout gets a verdict or silence, never a half-verdict.
if (import.meta.main) {
  const [argument, second, third] = process.argv.slice(2);
  const renderedPath = third ?? second;
  const projectRoot = third === undefined ? process.cwd() : second!;
  if (argument === undefined || renderedPath === undefined) {
    console.error(
      envelope({
        verdict:
          "the gate-render check was given fewer than the identity and the " +
          "rendering it needs, and neither has a safe default — a rendering " +
          "with no identity names no delivery to grade it against.",
        remedy: `run \`${USAGE}\`, passing the identity being delivered and the rendering you are about to show.`,
        context: "mode=deliver, phase=gate-render, reason=incomplete-argv",
      }),
    );
    process.exitCode = 1;
  } else {
    let rendered: string | null = null;
    try {
      rendered = readFileSync(renderedPath, "utf-8");
    } catch (error) {
      // Refused, never graded: an unreadable path is an unknown, and grading an
      // unknown as an empty string is the silent-skip shape this module exists
      // to refuse one level up.
      console.error(
        envelope({
          verdict:
            "the rendering handed to the gate-render check could not be read, " +
            "so there is nothing to grade: " +
            (error instanceof Error ? error.message : String(error)),
          remedy: `pass a readable rendering — \`${USAGE}\` — and re-run.`,
          context: `mode=deliver, phase=gate-render, rendered=${renderedPath}, reason=unreadable-path`,
        }),
      );
      process.exitCode = 1;
    }
    let capture: string | null = null;
    if (rendered !== null) {
      try {
        capture = await decideDelivery({ argument, projectRoot });
      } catch (error) {
        const raw = error instanceof Error ? error.message : String(error);
        console.error(
          carriesEnvelope(raw)
            ? raw
            : envelope({
                verdict:
                  "the decision record this gate would be graded against could " +
                  `not be produced: ${raw}`,
                remedy:
                  "fix what the decision command reports, then re-run the " +
                  "gate-render check; a gate is never graded against a record " +
                  "that does not exist.",
                context: `mode=deliver, phase=gate-render, argument=${argument}, projectRoot=${projectRoot}, reason=decision-refused`,
              }),
        );
        process.exitCode = 1;
      }
    }
    if (capture !== null && rendered !== null) {
      const verdict = verifyResumeGateRender(rendered, capture);
      if (verdict.ok) {
        console.log(
          `ok: the gate rendering carries the decision record verbatim — all ${DECISION_FIELDS.length} labelled fields, exactly as \`deliver_decision.ts\` printed them for \`${argument}\` in this process just now.`,
        );
      } else {
        console.error(
          envelope({
            verdict: `the gate rendering does not carry the decision record — ${verdict.reasons.join(" | ")}`,
            remedy:
              "paste the bytes the decision command printed on stdout into " +
              "the gate's prompt text verbatim; wrapping them in prose is " +
              "fine, restating them is not.",
            context: `mode=deliver, phase=gate-render, rendered=${renderedPath}, argument=${argument}, projectRoot=${projectRoot}`,
          }),
        );
        process.exitCode = 1;
      }
    }
  }
}
