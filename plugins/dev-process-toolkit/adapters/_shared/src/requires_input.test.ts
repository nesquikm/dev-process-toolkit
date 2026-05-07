import { describe, expect, test } from "bun:test";
import {
  requireOrRefuse,
  RequiresInputRefusedError,
  type RequireOrRefuseSpec,
} from "./requires_input";

// STE-232 AC-STE-232.2 — `requireOrRefuse(spec, key, sentinel)` four-outcome matrix.
//
// Outcome decision tree (precedence top-to-bottom):
//   1. userSuppliedValue !== undefined && !== sentinel  → 'user-supplied'
//   2. preBakedValue   !== undefined && !== sentinel  → 'pre-baked'
//   3. markerPresent && defaultValue !== undefined    → 'default-applied'
//   4. otherwise                                       → 'refused' (throws)
//
// `requires-input:` steps pass `defaultValue: undefined`; the marker therefore
// can NEVER default-apply a `requires-input:` step — that's the contract this
// FR closes. See `docs/auto-mode-protocol.md` § The Rule.

const SENTINEL = "<deferred>";

const baseSpec: Omit<RequireOrRefuseSpec, "markerPresent"> & {
  markerPresent: boolean;
} = {
  markerPresent: false,
  skillName: "/setup",
  stepName: "step 7b",
  refusalReason: "tracker mode is a workspace-wide decision; no safe default exists.",
};

describe("AC-STE-232.2 — requireOrRefuse four-outcome matrix", () => {
  test("user-supplied: interactive answer present (and not sentinel) ⇒ outcome=user-supplied", () => {
    const r = requireOrRefuse(
      { ...baseSpec, userSuppliedValue: "linear" },
      "tracker_mode",
      SENTINEL,
    );
    expect(r.outcome).toBe("user-supplied");
    expect(r.value).toBe("linear");
  });

  test("pre-baked: --flag answer present (and not sentinel) ⇒ outcome=pre-baked", () => {
    const r = requireOrRefuse(
      { ...baseSpec, preBakedValue: "linear" },
      "tracker_mode",
      SENTINEL,
    );
    expect(r.outcome).toBe("pre-baked");
    expect(r.value).toBe("linear");
  });

  test("user-supplied wins over pre-baked when both present", () => {
    // The interactive answer is the most authoritative — it represents an
    // explicit live human choice and trumps a stale --flag.
    const r = requireOrRefuse(
      {
        ...baseSpec,
        preBakedValue: "linear",
        userSuppliedValue: "jira",
      },
      "tracker_mode",
      SENTINEL,
    );
    expect(r.outcome).toBe("user-supplied");
    expect(r.value).toBe("jira");
  });

  test("default-applied: marker present + defaultValue available ⇒ outcome=default-applied", () => {
    const r = requireOrRefuse(
      { ...baseSpec, markerPresent: true, defaultValue: "feat/{ticket-id}-{slug}" },
      "branch_template",
      SENTINEL,
    );
    expect(r.outcome).toBe("default-applied");
    expect(r.value).toBe("feat/{ticket-id}-{slug}");
  });

  test("refused: marker absent + no answer ⇒ throws RequiresInputRefusedError", () => {
    expect(() =>
      requireOrRefuse({ ...baseSpec }, "tracker_mode", SENTINEL),
    ).toThrow(RequiresInputRefusedError);
  });

  test("refused: marker present but defaultValue undefined (requires-input contract) ⇒ throws", () => {
    // The load-bearing case for this FR: marker IS present but the step is
    // `requires-input:` (defaultValue=undefined). Auto Mode does NOT relax
    // requires-input — refusal fires regardless of marker.
    expect(() =>
      requireOrRefuse(
        { ...baseSpec, markerPresent: true /* defaultValue: undefined */ },
        "tracker_mode",
        SENTINEL,
      ),
    ).toThrow(RequiresInputRefusedError);
  });

  test("refused: sentinel-still-placeholder both userSupplied AND preBaked ⇒ throws", () => {
    // Both values structurally present but each equals the sentinel — neither
    // counts as a real answer.
    expect(() =>
      requireOrRefuse(
        {
          ...baseSpec,
          preBakedValue: SENTINEL,
          userSuppliedValue: SENTINEL,
        },
        "tracker_mode",
        SENTINEL,
      ),
    ).toThrow(RequiresInputRefusedError);
  });

  test("refusal error message follows NFR-10 canonical shape (Verdict / Remedy / Context)", () => {
    let captured: RequiresInputRefusedError | null = null;
    try {
      requireOrRefuse(baseSpec, "tracker_mode", SENTINEL);
    } catch (e) {
      captured = e as RequiresInputRefusedError;
    }
    expect(captured).not.toBeNull();
    const msg = captured!.message;
    expect(msg).toContain("/setup step 7b");
    expect(msg).toContain("tracker_mode");
    expect(msg).toContain("Remedy:");
    expect(msg).toContain("Context:");
    expect(msg).toContain("docs/auto-mode-protocol.md");
    // Refusal reason from the requires-input: annotation must surface verbatim.
    expect(msg).toContain(baseSpec.refusalReason);
  });

  test("RequiresInputRefusedError carries skillName/stepName/key for programmatic inspection", () => {
    let captured: RequiresInputRefusedError | null = null;
    try {
      requireOrRefuse(baseSpec, "tracker_mode", SENTINEL);
    } catch (e) {
      captured = e as RequiresInputRefusedError;
    }
    expect(captured).not.toBeNull();
    expect(captured!.skillName).toBe("/setup");
    expect(captured!.stepName).toBe("step 7b");
    expect(captured!.key).toBe("tracker_mode");
    expect(captured!.name).toBe("RequiresInputRefusedError");
  });

  test("primitive sentinel via Symbol.for: equality check via === handles non-string sentinels", () => {
    // The sentinel comparison is reference-equality (===); callers using
    // a Symbol.for() token get correct sentinel-still-placeholder detection
    // because the same symbol is returned on every call.
    const TOKEN = Symbol.for("dpt-no-answer");
    expect(() =>
      requireOrRefuse(
        { ...baseSpec, userSuppliedValue: TOKEN },
        "tracker_mode",
        TOKEN,
      ),
    ).toThrow(RequiresInputRefusedError);
  });

  test("explicit pass-through: a non-sentinel boolean value (e.g., docs.user_facing_mode=false) ⇒ user-supplied", () => {
    // Boolean false must NOT be confused with `undefined`; explicit user-supplied
    // false is a real answer.
    const r = requireOrRefuse(
      { ...baseSpec, userSuppliedValue: false },
      "docs.user_facing_mode",
      SENTINEL,
    );
    expect(r.outcome).toBe("user-supplied");
    expect(r.value).toBe(false);
  });
});
