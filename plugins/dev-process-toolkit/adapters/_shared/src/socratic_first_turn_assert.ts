// STE-237 AC-STE-237.4 driver wrapper CLI — invoked by /smoke-test Phase 8
// to wire NDJSON -> TranscriptEntry[] -> assertFirstTurnShape and emit a
// single-line verdict the smoke summary parses.
//
// Usage:
//   bun socratic_first_turn_assert.ts <skill> <fixture.json>
//
// Reads <fixture.json> as NDJSON, projects via parseStreamJsonTranscript,
// passes to assertFirstTurnShape, and prints exactly one of:
//   <skill>: ok-asked askIndex=<i>
//   <skill>: ok-refused askIndex=<i>
//   <skill>: violation tool=<X> index=<i>
// The violation case exits non-zero (1); the ok-* cases exit 0.

import { parseStreamJsonTranscript } from "./socratic_first_turn_stream";
import {
  assertFirstTurnShape,
  SocraticFirstTurnViolationError,
} from "./socratic_first_turn";

const [skill, fixturePath] = process.argv.slice(2);
if (!skill || !fixturePath) {
  console.error(
    "usage: bun socratic_first_turn_assert.ts <skill> <fixture.json>",
  );
  process.exit(2);
}

const ndjson = await Bun.file(fixturePath).text();
const transcript = parseStreamJsonTranscript(ndjson);

try {
  const r = assertFirstTurnShape(transcript);
  console.log(`${skill}: ${r.outcome} askIndex=${r.askIndex ?? -1}`);
} catch (e) {
  if (e instanceof SocraticFirstTurnViolationError) {
    console.log(`${skill}: violation tool=${e.toolName} index=${e.index}`);
    process.exit(1);
  }
  throw e;
}
