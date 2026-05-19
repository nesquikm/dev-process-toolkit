// STE-313 AC-STE-313.4 — three-fixture regression replay loop.
//
// Replays the three verbatim conformance-loop fixture bodies committed
// under `tests/fixtures/marker-absent-non-tty/` through the runtime
// arbiter `evaluateGateMarkerRefusal({...})` (the SINGLE byte-checkable
// decider every /spec-write + /setup gate site MUST call before any
// side effect) and asserts each refuses with NFR-10 shape naming the
// correct gate site.
//
//   - spec-write-group-1b-2026-05-19.txt — /spec-write draft gate (§ 0b
//     step 4); auto-applied on master at `3cca70a` because the
//     `<system-reminder>` "work without stopping" was rationalized into
//     a marker substitute. Replay MUST refuse with `gate_site=draft`.
//
//   - spec-write-group-5b-2026-05-19.txt — /spec-write branch gate
//     (§ 7a `requireCommittableBranch`); auto-applied on master at
//     `e30bedb`. Replay MUST refuse with `gate_site=branch`.
//
//   - setup-2026-05-19.json — /setup Socratic first-turn (STE-237
//     scaffold-Write ban). Stream-json NDJSON capture; replay through
//     `parseStreamJsonTranscript` + `assertFirstTurnShape` MUST surface
//     a Socratic-first-turn violation (first scaffold Write fired at
//     `tool_use index=12` before any AskUserQuestion).
//
// The fixtures are part of the FR's deliverable — they live under
// `tests/fixtures/marker-absent-non-tty/` (not the per-date sibling
// path) so future fixture overwrites don't clobber the regression
// inputs (same convention as `socratic-first-turn/regression/`).

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  evaluateGateMarkerRefusal,
  type GateSite,
} from "../adapters/_shared/src/gate_marker_refusal";
import { RequiresInputRefusedError } from "../adapters/_shared/src/requires_input";
import {
  assertFirstTurnShape,
  SocraticFirstTurnViolationError,
} from "../adapters/_shared/src/socratic_first_turn";
import { parseStreamJsonTranscript } from "../adapters/_shared/src/socratic_first_turn_stream";

const FIXTURE_DIR = join(__dirname, "fixtures", "marker-absent-non-tty");

const DRAFT_FIXTURE = join(FIXTURE_DIR, "spec-write-group-1b-2026-05-19.txt");
const BRANCH_FIXTURE = join(FIXTURE_DIR, "spec-write-group-5b-2026-05-19.txt");
const SETUP_FIXTURE = join(FIXTURE_DIR, "setup-2026-05-19.json");

const MARKER = "<dpt:auto-approve>v1</dpt:auto-approve>";

describe("AC-STE-313.4 — regression-fixture directory exists with all three fixtures", () => {
  test("fixture directory `tests/fixtures/marker-absent-non-tty/` exists", () => {
    expect(existsSync(FIXTURE_DIR)).toBe(true);
  });

  test("draft-gate fixture (spec-write Group 1b verbatim prompt body) is committed", () => {
    expect(existsSync(DRAFT_FIXTURE)).toBe(true);
    const body = readFileSync(DRAFT_FIXTURE, "utf-8");
    // Verbatim prompt body — non-empty, no marker (this is the F1 repro shape).
    expect(body.length).toBeGreaterThan(0);
    expect(body.includes(MARKER)).toBe(false);
  });

  test("branch-gate fixture (spec-write Group 5b verbatim prompt body) is committed", () => {
    expect(existsSync(BRANCH_FIXTURE)).toBe(true);
    const body = readFileSync(BRANCH_FIXTURE, "utf-8");
    expect(body.length).toBeGreaterThan(0);
    expect(body.includes(MARKER)).toBe(false);
  });

  test("setup-Socratic fixture (stream-json NDJSON capture) is committed", () => {
    expect(existsSync(SETUP_FIXTURE)).toBe(true);
    const ndjson = readFileSync(SETUP_FIXTURE, "utf-8");
    // ≈ 112 KB on disk per FR § Requirement; assert non-trivially large.
    expect(ndjson.length).toBeGreaterThan(10_000);
  });
});

interface PromptBodyCase {
  label: string;
  fixturePath: string;
  gateSite: GateSite;
}

const PROMPT_BODY_CASES: PromptBodyCase[] = [
  { label: "Group 1b (draft gate)", fixturePath: DRAFT_FIXTURE, gateSite: "draft" },
  { label: "Group 5b (branch gate)", fixturePath: BRANCH_FIXTURE, gateSite: "branch" },
];

describe("AC-STE-313.4 — prompt-body fixture replay through evaluateGateMarkerRefusal", () => {
  for (const c of PROMPT_BODY_CASES) {
    test(`${c.label}: marker absent + non-tty ⇒ throws RequiresInputRefusedError with gate_site=${c.gateSite}`, () => {
      const body = readFileSync(c.fixturePath, "utf-8");
      let captured: RequiresInputRefusedError | null = null;
      try {
        evaluateGateMarkerRefusal({
          promptBody: body,
          isTty: false,
          gateSite: c.gateSite,
        });
      } catch (e) {
        if (e instanceof RequiresInputRefusedError) {
          captured = e;
        } else {
          throw e;
        }
      }
      expect(captured).not.toBeNull();
      expect(captured!.message).toContain(`gate_site=${c.gateSite}`);
      // NFR-10 canonical shape — Verdict / Remedy / Context blocks.
      expect(captured!.message).toMatch(/Verdict:/);
      expect(captured!.message).toMatch(/Remedy:/);
      expect(captured!.message).toMatch(/Context:/);
      // Refusal explicitly references the four-state matrix
      expect(captured!.message).toContain("marker=absent");
      expect(captured!.message).toContain("stdin=non-tty");
    });

    test(`${c.label}: marker absent + tty ⇒ outcome=prompt (interactive path unchanged)`, () => {
      const body = readFileSync(c.fixturePath, "utf-8");
      const r = evaluateGateMarkerRefusal({
        promptBody: body,
        isTty: true,
        gateSite: c.gateSite,
      });
      expect(r.outcome).toBe("prompt");
    });

    test(`${c.label}: marker injected + non-tty ⇒ outcome=apply (auto-mode preserved)`, () => {
      const body = readFileSync(c.fixturePath, "utf-8");
      const withMarker = `${MARKER}\n${body}`;
      const r = evaluateGateMarkerRefusal({
        promptBody: withMarker,
        isTty: false,
        gateSite: c.gateSite,
      });
      expect(r.outcome).toBe("apply");
    });
  }
});

describe("AC-STE-313.4 — setup-2026-05-19.json Socratic-first-turn replay", () => {
  test("stream-json NDJSON replay through assertFirstTurnShape ⇒ SocraticFirstTurnViolationError naming a scaffold tool", () => {
    const ndjson = readFileSync(SETUP_FIXTURE, "utf-8");
    const transcript = parseStreamJsonTranscript(ndjson);
    // Sanity guard: the transcript must project to a non-trivial entry list
    // — empty transcripts would silently "pass" assertFirstTurnShape.
    expect(transcript.length).toBeGreaterThan(0);

    let captured: SocraticFirstTurnViolationError | null = null;
    try {
      assertFirstTurnShape(transcript);
    } catch (e) {
      if (e instanceof SocraticFirstTurnViolationError) {
        captured = e;
      } else {
        throw e;
      }
    }
    expect(captured).not.toBeNull();
    // Per FR § Requirement Jira leg F1: the scaffold Write fired at
    // tool_use index=12 BEFORE any AskUserQuestion.
    expect(["Write", "Edit", "NotebookEdit"]).toContain(captured!.toolName);
    // NFR-10 canonical message references the helper + protocol.
    expect(captured!.message).toContain("Socratic first-turn contract violation");
    expect(captured!.message).toContain("docs/auto-mode-protocol.md");
  });

  test("setup fixture body does NOT contain the literal marker (F2 repro shape)", () => {
    const ndjson = readFileSync(SETUP_FIXTURE, "utf-8");
    expect(ndjson.includes(MARKER)).toBe(false);
  });
});
