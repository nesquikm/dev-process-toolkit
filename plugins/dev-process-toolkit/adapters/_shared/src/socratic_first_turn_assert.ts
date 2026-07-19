// STE-237 AC-STE-237.4 driver wrapper CLI — invoked by /smoke-test Phase 8
// to wire NDJSON -> TranscriptEntry[] -> assertFirstTurnShape and emit a
// single-line verdict the smoke summary parses.
//
// Usage:
//   bun socratic_first_turn_assert.ts <skill> <fixture.json> [projectRoot]
//
// Reads <fixture.json> as NDJSON, projects via parseStreamJsonTranscript,
// passes to assertFirstTurnShape (scoping scaffolding detection to
// [projectRoot] when supplied — STE-399 AC-STE-399.6), and prints exactly
// one of:
//   <skill>: ok-asked askIndex=<i>
//   <skill>: ok-refused askIndex=<i>
//   <skill>: vacuous askIndex=-1
//   <skill>: violation tool=<X> index=<i>
// Exit codes: ok-* ⇒ 0, violation ⇒ 1, vacuous ⇒ 3 (STE-399 AC-STE-399.2 —
// vacuous is a non-pass, distinct from violation so the smoke driver can
// tell "did nothing" from "scaffolded early").

import { parseStreamJsonTranscript } from "./socratic_first_turn_stream";
import {
  assertFirstTurnShape,
  type FirstTurnOptions,
  SocraticFirstTurnViolationError,
  type TranscriptEntry,
} from "./socratic_first_turn";

export interface AssertVerdict {
  line: string;
  exitCode: number;
}

/**
 * Map a transcript to the CLI's single-line verdict + exit code. Pure — the
 * `if (import.meta.main)` wrapper below feeds it the parsed transcript and
 * prints/exits. Unit-tested directly (no subprocess spawn).
 */
export function verdictFor(
  skill: string,
  transcript: ReadonlyArray<TranscriptEntry>,
  opts?: FirstTurnOptions,
): AssertVerdict {
  try {
    const r = assertFirstTurnShape(transcript, opts);
    if (r.outcome === "vacuous") {
      return { line: `${skill}: vacuous askIndex=-1`, exitCode: 3 };
    }
    return {
      line: `${skill}: ${r.outcome} askIndex=${r.askIndex ?? -1}`,
      exitCode: 0,
    };
  } catch (e) {
    if (e instanceof SocraticFirstTurnViolationError) {
      return {
        line: `${skill}: violation tool=${e.toolName} index=${e.index}`,
        exitCode: 1,
      };
    }
    throw e;
  }
}

if (import.meta.main) {
  const [skill, fixturePath, projectRoot] = process.argv.slice(2);
  if (!skill || !fixturePath) {
    console.error(
      "usage: bun socratic_first_turn_assert.ts <skill> <fixture.json> [projectRoot]",
    );
    process.exit(2);
  }
  const ndjson = await Bun.file(fixturePath).text();
  const transcript = parseStreamJsonTranscript(ndjson);
  const verdict = verdictFor(
    skill,
    transcript,
    projectRoot ? { projectRoot } : undefined,
  );
  console.log(verdict.line);
  process.exit(verdict.exitCode);
}
