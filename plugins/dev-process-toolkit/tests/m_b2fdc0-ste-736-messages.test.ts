// STE-736 (M_b2fdc0) — AC-STE-736.3 / .4 / .5: three messages say what they mean.
//
//   .3 verify_mode: required stays refused in both loaders, and the refusal and
//      docs/settings-reference.md say to use `blocking`.
//   .4 probe #45 checks `chore(specs): write FRs` like `write FR`.
//   .5 visual-check §1 names a route around a loopback refusal, under the cap.
//
// The named legs live in _m_b2fdc0_ste736_fixture.ts (shared with the mutation
// battery); the guard rows below pin what must NOT change.

import { afterAll, describe, expect, test } from "bun:test";
import { PLUGIN_ROOT, cleanupTemps, legsFor, tree } from "./_m_b2fdc0_ste736_fixture";
import { loadProjectSettings } from "../adapters/_shared/src/project_settings";
import { inspectCommit } from "../adapters/_shared/src/socratic_first_turn_post_hoc_drift";

afterAll(() => cleanupTemps());

for (const ac of ["AC-STE-736.3", "AC-STE-736.4", "AC-STE-736.5"]) {
  describe(ac, () => {
    for (const leg of legsFor(ac)) {
      test(leg.name, async () => {
        expect({ leg: leg.name, problem: await leg.check(PLUGIN_ROOT) }).toEqual({ leg: leg.name, problem: null });
      });
    }
  });
}

function settingsVerdict(value: string): "accepted" | "refused" {
  const repo = tree("guard-settings", {
    "specs/settings.yaml": `schema_version: 1\nmin_dpt_version: "3.0.0"\nverification:\n  verify_mode: ${value}\n`,
  });
  try {
    loadProjectSettings(repo);
    return "accepted";
  } catch {
    return "refused";
  }
}

function legacyVerdict(value: string): "accepted" | "refused" {
  const repo = tree("guard-legacy", { "CLAUDE.md": `# Fake\n\n## Verification\n\nverify_mode: ${value}\n` });
  try {
    loadProjectSettings(repo);
    return "accepted";
  } catch {
    return "refused";
  }
}

describe("AC-STE-736.3 guard — no value is accepted that is refused today", () => {
  const ROWS: Array<[string, "accepted" | "refused"]> = [
    ["advisory", "accepted"],
    ["blocking", "accepted"],
    ["manual", "accepted"],
    ["required", "refused"],
    ["Required", "refused"],
    ["REQUIRED", "refused"],
    ["block", "refused"],
    ["BLOCKING", "refused"],
    ["loud", "refused"],
  ];
  for (const [value, want] of ROWS) {
    test(`settings loader: verify_mode ${value} is ${want}`, () => {
      expect({ value, verdict: settingsVerdict(value) }).toEqual({ value, verdict: want });
    });
    test(`legacy loader: verify_mode ${value} is ${want}`, () => {
      expect({ value, verdict: legacyVerdict(value) }).toEqual({ value, verdict: want });
    });
  }
});

describe("AC-STE-736.4 guard — the singular subject is checked exactly as before", () => {
  const SINGULAR = "chore(specs): write FR STE-9031";
  test("singular subject with no marker is a violation", () => {
    expect(inspectCommit(SINGULAR, "Refs: STE-9031\n")).toBe("violation");
  });
  test("singular subject with an approval marker is legitimate", () => {
    expect(inspectCommit(SINGULAR, "spec_write_commit_operator_approved\n")).toBe("legitimate");
  });
  test("plural and singular subjects reach the same verdicts", () => {
    const PLURAL = "chore(specs): write FRs STE-9031, STE-9032";
    for (const body of ["", "Refs: STE-9031", "spec_write_commit_default_applied", "Verdict: Refused\nRemedy: x"]) {
      expect({ body, plural: inspectCommit(PLURAL, body) }).toEqual({ body, plural: inspectCommit(SINGULAR, body) });
    }
  });
  test("an unrelated subject stays out of scope", () => {
    expect(inspectCommit("chore(specs): rewrite links", "")).toBe("out-of-scope");
  });
});
