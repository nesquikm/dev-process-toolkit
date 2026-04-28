// STE-73 AC-STE-73.12 — parse test-gate output into a `{ total, failures,
// errors }` triple for the CHANGELOG closing line:
//
//     Total test count at release: <N> tests, <F> failures, <E> errors.
//
// Stack dispatch table — bun / pytest / flutter are the three stacks
// /ship-milestone targets explicitly (AC-STE-73.12 enumerates these);
// `unknown` is the NFR-10 fallback that surfaces a "could not determine
// test count" refusal asking the user to specify or skip the line. New
// stacks should land via a new FR updating AC-STE-73.12 — adding them
// here without AC coverage is undocumented scope creep.

export interface TestCount {
  total: number;
  failures: number;
  errors: number;
}

export type TestCountParseResult =
  | { ok: true; count: TestCount }
  | { ok: false; reason: string };

export type Stack = "bun" | "pytest" | "flutter" | "unknown";

function parseBun(output: string): TestCountParseResult {
  const passMatch = /(\d+)\s+pass\b/.exec(output);
  const failMatch = /(\d+)\s+fail\b/.exec(output);
  if (!passMatch && !failMatch) {
    return { ok: false, reason: "could not determine test count — no test counters in bun output" };
  }
  const pass = passMatch ? Number(passMatch[1]) : 0;
  const fail = failMatch ? Number(failMatch[1]) : 0;
  return { ok: true, count: { total: pass + fail, failures: fail, errors: 0 } };
}

function parsePytest(output: string): TestCountParseResult {
  const passedMatch = /(\d+)\s+passed/.exec(output);
  const failedMatch = /(\d+)\s+failed/.exec(output);
  const errorsMatch = /(\d+)\s+errors?\b/.exec(output);
  if (!passedMatch && !failedMatch) {
    return { ok: false, reason: "could not determine test count — no test counters in pytest output" };
  }
  const passed = passedMatch ? Number(passedMatch[1]) : 0;
  const failed = failedMatch ? Number(failedMatch[1]) : 0;
  const errors = errorsMatch ? Number(errorsMatch[1]) : 0;
  return { ok: true, count: { total: passed + failed + errors, failures: failed, errors } };
}

function parseFlutter(output: string): TestCountParseResult {
  const passMatch = /\+(\d+)/.exec(output);
  const failMatch = /-(\d+)/.exec(output);
  if (!passMatch && !failMatch) {
    return { ok: false, reason: "could not determine test count — no +N/-N counters in flutter output" };
  }
  const pass = passMatch ? Number(passMatch[1]) : 0;
  const fail = failMatch ? Number(failMatch[1]) : 0;
  return { ok: true, count: { total: pass + fail, failures: fail, errors: 0 } };
}

export function parseTestOutput(output: string, stack: Stack): TestCountParseResult {
  switch (stack) {
    case "bun":
      return parseBun(output);
    case "pytest":
      return parsePytest(output);
    case "flutter":
      return parseFlutter(output);
    case "unknown":
    default:
      return { ok: false, reason: "unknown stack — cannot parse test output" };
  }
}
