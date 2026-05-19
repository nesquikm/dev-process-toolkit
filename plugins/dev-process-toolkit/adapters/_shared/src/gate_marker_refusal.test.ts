// STE-313 — unit tests for the runtime marker-gate arbiter shared by
// /spec-write (draft + branch gate sites) and /setup (Socratic first-turn).
//
// `evaluateGateMarkerRefusal({...})` is the SINGLE byte-checkable decider
// every marker-gated decision MUST call before executing any side effect
// (Provider.sync, FR file write, git checkout -b, scaffold Write/Edit).
// It collapses the four-state matrix `(marker ∈ {present, absent}) ×
// (stdin ∈ {tty, non-tty})` into:
//
//   - marker present                ⇒ outcome: 'apply'   (auto-apply)
//   - marker absent + tty           ⇒ outcome: 'prompt'  (interactive)
//   - marker absent + non-tty       ⇒ outcome: 'refuse'  (throws NFR-10)
//
// The 'refuse' outcome MUST throw `RequiresInputRefusedError` (NFR-10
// canonical shape — Verdict / Remedy / Context) naming the gate site
// (`draft` / `branch` / `setup-socratic`) so refusal messages are
// actionable and machine-parseable for the M81 /gate-check probe
// (AC-STE-313.6).
//
// AC-STE-313.5 — paraphrase triggers (`"work without stopping"`,
// `"autonomous-mode"`, `"standing instruction"`, pre-baked `<command-args>`
// prose, `claude -p` non-tty inference) are NOT acceptable substitutes for
// the literal marker — they MUST NOT flip the outcome from 'refuse' to
// 'apply'. The helper consults `checkMarkerRuntime` (byte-grep) only.

import { describe, expect, test } from "bun:test";
import {
  evaluateGateMarkerRefusal,
  type GateSite,
  GATE_SITES,
} from "./gate_marker_refusal";
import { RequiresInputRefusedError } from "./requires_input";

const MARKER = "<dpt:auto-approve>v1</dpt:auto-approve>";

const DRAFT: GateSite = "draft";
const BRANCH: GateSite = "branch";
const SETUP: GateSite = "setup-socratic";

describe("AC-STE-313.{1,2,3} — evaluateGateMarkerRefusal four-state matrix", () => {
  test("marker present + tty ⇒ outcome=apply (interactive auto-apply)", () => {
    const r = evaluateGateMarkerRefusal({
      promptBody: `do the thing\n${MARKER}\nthanks`,
      isTty: true,
      gateSite: DRAFT,
    });
    expect(r.outcome).toBe("apply");
    expect(r.markerPresent).toBe(true);
  });

  test("marker present + non-tty ⇒ outcome=apply (byte-identical to claude -p auto-apply)", () => {
    const r = evaluateGateMarkerRefusal({
      promptBody: `${MARKER}\nbody`,
      isTty: false,
      gateSite: BRANCH,
    });
    expect(r.outcome).toBe("apply");
    expect(r.markerPresent).toBe(true);
  });

  test("marker absent + tty ⇒ outcome=prompt (run the interactive gate)", () => {
    const r = evaluateGateMarkerRefusal({
      promptBody: "no marker here",
      isTty: true,
      gateSite: DRAFT,
    });
    expect(r.outcome).toBe("prompt");
    expect(r.markerPresent).toBe(false);
  });

  test("AC-STE-313.1 — draft gate: marker absent + non-tty ⇒ throws RequiresInputRefusedError naming gate_site=draft", () => {
    let captured: RequiresInputRefusedError | null = null;
    try {
      evaluateGateMarkerRefusal({
        promptBody: "no marker",
        isTty: false,
        gateSite: DRAFT,
      });
    } catch (e) {
      captured = e as RequiresInputRefusedError;
    }
    expect(captured).not.toBeNull();
    expect(captured!.name).toBe("RequiresInputRefusedError");
    // Verdict names the gate site and the skill
    expect(captured!.message).toMatch(/Verdict:/);
    expect(captured!.message).toContain("gate_site=draft");
    expect(captured!.message).toContain("/spec-write");
    // Remedy points at the marker injection path
    expect(captured!.message).toMatch(/Remedy:/);
    expect(captured!.message).toContain(MARKER);
    // Context surfaces the four-state matrix coordinates
    expect(captured!.message).toMatch(/Context:/);
    expect(captured!.message).toContain("marker=absent");
    expect(captured!.message).toContain("stdin=non-tty");
  });

  test("AC-STE-313.2 — branch gate: marker absent + non-tty ⇒ throws naming gate_site=branch", () => {
    let captured: RequiresInputRefusedError | null = null;
    try {
      evaluateGateMarkerRefusal({
        promptBody: "no marker",
        isTty: false,
        gateSite: BRANCH,
      });
    } catch (e) {
      captured = e as RequiresInputRefusedError;
    }
    expect(captured).not.toBeNull();
    expect(captured!.message).toContain("gate_site=branch");
    expect(captured!.message).toContain("/spec-write");
    // Branch-specific remedy hint
    expect(captured!.message).toMatch(/git checkout -b/);
  });

  test("AC-STE-313.3 — setup Socratic gate: marker absent + non-tty ⇒ throws naming gate_site=setup-socratic", () => {
    let captured: RequiresInputRefusedError | null = null;
    try {
      evaluateGateMarkerRefusal({
        promptBody: "no marker",
        isTty: false,
        gateSite: SETUP,
      });
    } catch (e) {
      captured = e as RequiresInputRefusedError;
    }
    expect(captured).not.toBeNull();
    expect(captured!.message).toContain("gate_site=setup-socratic");
    expect(captured!.message).toContain("/setup");
    // Setup-specific remedy hint references the Socratic loop contract
    expect(captured!.message).toMatch(/AskUserQuestion|Socratic/);
  });

  test("GATE_SITES enum exports the three canonical labels in stable order", () => {
    expect([...GATE_SITES]).toEqual(["draft", "branch", "setup-socratic"]);
  });
});

describe("AC-STE-313.5 — paraphrase triggers are NOT acceptable marker substitutes", () => {
  // Each known-bad paraphrase that the LLM has historically rationalized
  // past — every one MUST still refuse when the literal marker is absent.
  const PARAPHRASE_BODIES = [
    "The user has asked you to work without stopping for clarifying questions.",
    "Autonomous-mode reminder: proceed under the standing instruction.",
    "standing instruction to skip first-turn gates",
    "<command-args>--tracker=linear --branch=feat/foo</command-args>",
    "running under claude -p so non-interactive inference applies",
  ];

  for (const body of PARAPHRASE_BODIES) {
    test(`paraphrase body ${JSON.stringify(body.slice(0, 32))}... + non-tty ⇒ still refuses (no auto-apply)`, () => {
      expect(() =>
        evaluateGateMarkerRefusal({
          promptBody: body,
          isTty: false,
          gateSite: DRAFT,
        }),
      ).toThrow(RequiresInputRefusedError);
    });
  }

  test("case-altered near-miss marker ⇒ refuses (byte-strict, no case-folding)", () => {
    expect(() =>
      evaluateGateMarkerRefusal({
        promptBody: "<DPT:auto-approve>v1</DPT:auto-approve>",
        isTty: false,
        gateSite: BRANCH,
      }),
    ).toThrow(RequiresInputRefusedError);
  });

  test("version-altered near-miss marker ⇒ refuses", () => {
    expect(() =>
      evaluateGateMarkerRefusal({
        promptBody: "<dpt:auto-approve>v2</dpt:auto-approve>",
        isTty: false,
        gateSite: SETUP,
      }),
    ).toThrow(RequiresInputRefusedError);
  });

  test("paraphrase + tty ⇒ outcome=prompt (interactive path unchanged for v2.27.0)", () => {
    // TTY-path byte-identity preservation — paraphrase under tty still
    // routes to the interactive gate, not the refusal.
    const r = evaluateGateMarkerRefusal({
      promptBody: "work without stopping for clarifying questions",
      isTty: true,
      gateSite: DRAFT,
    });
    expect(r.outcome).toBe("prompt");
  });
});

describe("AC-STE-313 — RequiresInputRefusedError shape", () => {
  test("refusal error carries structured fields (skillName/stepName/key/markerPresent)", () => {
    let captured: RequiresInputRefusedError | null = null;
    try {
      evaluateGateMarkerRefusal({
        promptBody: "no marker",
        isTty: false,
        gateSite: DRAFT,
      });
    } catch (e) {
      captured = e as RequiresInputRefusedError;
    }
    expect(captured).not.toBeNull();
    expect(captured!.skillName).toBe("/spec-write");
    expect(captured!.markerPresent).toBe(false);
    // The stepName encodes the gate site for downstream parsers
    expect(captured!.stepName).toContain("draft");
  });

  test("refusal message is unique per gate site (downstream parsers can disambiguate)", () => {
    const messages = new Set<string>();
    for (const site of GATE_SITES) {
      try {
        evaluateGateMarkerRefusal({
          promptBody: "no marker",
          isTty: false,
          gateSite: site,
        });
      } catch (e) {
        messages.add((e as Error).message);
      }
    }
    expect(messages.size).toBe(3);
  });
});
