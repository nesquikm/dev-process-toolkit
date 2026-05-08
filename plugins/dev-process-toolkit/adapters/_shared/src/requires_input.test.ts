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

// STE-251 AC-STE-251.2 — non-tty branch matrix.
//
// `claude -p` non-interactive stdin produces "dismissed" AskUserQuestion
// responses. Without the non-tty branch the model self-rationalizes "safe
// defaults" and lands silent commits (F2 from /conformance-loop iter-1).
// The branch fires only on the `refused` path; accepting outcomes ignore
// stdin shape.
//
// Bun test convention: mock `process.stdin.isTTY` via Object.defineProperty
// with `configurable: true` so the test suite can restore the prior value.

describe("AC-STE-251.2 — non-tty branch matrix (tty x answer-shape)", () => {
  const restoreIsTTY = (prior: PropertyDescriptor | undefined) => {
    if (prior) {
      Object.defineProperty(process.stdin, "isTTY", prior);
    } else {
      // delete the test-installed property so the runtime value reasserts
      delete (process.stdin as { isTTY?: boolean }).isTTY;
    }
  };

  const withIsTTY = (value: boolean | undefined, fn: () => void) => {
    const prior = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    Object.defineProperty(process.stdin, "isTTY", {
      value,
      configurable: true,
      writable: true,
    });
    try {
      fn();
    } finally {
      restoreIsTTY(prior);
    }
  };

  test("(tty, answered): isTTY=true + userSupplied present ⇒ user-supplied (no remedy rendered)", () => {
    withIsTTY(true, () => {
      const r = requireOrRefuse(
        { ...baseSpec, userSuppliedValue: "linear" },
        "tracker_mode",
        SENTINEL,
      );
      expect(r.outcome).toBe("user-supplied");
      expect(r.value).toBe("linear");
    });
  });

  test("(tty, declined): isTTY=true + no answer ⇒ throws with TTY remedy (no non-tty wording)", () => {
    withIsTTY(true, () => {
      let captured: RequiresInputRefusedError | null = null;
      try {
        requireOrRefuse(baseSpec, "tracker_mode", SENTINEL);
      } catch (e) {
        captured = e as RequiresInputRefusedError;
      }
      expect(captured).not.toBeNull();
      const msg = captured!.message;
      // existing TTY-path remedy text — preserved unchanged
      expect(msg).toContain("Pre-bake an answer via the documented CLI flag");
      expect(msg).toContain("run the prompt interactively");
      // non-tty wording must NOT appear on the tty path
      expect(msg).not.toContain("Non-tty stdin");
      expect(msg).not.toContain("Re-invoke with `--tracker_mode=<value>`");
      // Context surfaces stdin=tty for tty-path refusals
      expect(msg).toContain("stdin=tty");
    });
  });

  test("(non-tty, answered): isTTY=false + preBaked present ⇒ pre-baked (CLI flag wins, no refusal)", () => {
    withIsTTY(false, () => {
      const r = requireOrRefuse(
        { ...baseSpec, preBakedValue: "linear" },
        "tracker_mode",
        SENTINEL,
      );
      expect(r.outcome).toBe("pre-baked");
      expect(r.value).toBe("linear");
    });
  });

  test("(non-tty, dismissed): isTTY=false + sentinel-only userSupplied ⇒ throws with non-tty remedy naming gate site + missing key + tty/pre-bake remedy", () => {
    withIsTTY(false, () => {
      let captured: RequiresInputRefusedError | null = null;
      try {
        requireOrRefuse(
          { ...baseSpec, userSuppliedValue: SENTINEL },
          "tracker_mode",
          SENTINEL,
        );
      } catch (e) {
        captured = e as RequiresInputRefusedError;
      }
      expect(captured).not.toBeNull();
      const msg = captured!.message;
      // Verdict still names the gate site + missing key
      expect(msg).toContain("/setup step 7b");
      expect(msg).toContain("tracker_mode");
      // Remedy carries the non-tty canonical wording per AC-STE-251.2
      expect(msg).toContain("Non-tty stdin");
      expect(msg).toContain("Re-invoke with `--tracker_mode=<value>`");
      expect(msg).toContain("run interactively (tty)");
      // Context surfaces stdin=non-tty for non-tty-path refusals
      expect(msg).toContain("stdin=non-tty");
      // The auto-approve marker is informational only — clarified in the remedy
      expect(msg).toContain("does not relax the requirement");
    });
  });

  test("(non-tty, dismissed) without sentinel placeholder: marker-absent fall-through still refuses with non-tty remedy", () => {
    // F2 reproduce shape: the helper is called with no userSupplied / preBaked /
    // marker — the dismissed-AskUserQuestion path that previously fell through.
    withIsTTY(false, () => {
      let captured: RequiresInputRefusedError | null = null;
      try {
        requireOrRefuse(baseSpec, "tracker_mode", SENTINEL);
      } catch (e) {
        captured = e as RequiresInputRefusedError;
      }
      expect(captured).not.toBeNull();
      expect(captured!.message).toContain("Non-tty stdin");
      expect(captured!.message).toContain("stdin=non-tty");
    });
  });

  test("isTTY=undefined (default Bun stdin in some environments) ⇒ treated as tty (preserves v2.17.0 behavior)", () => {
    // Defensive: only the literal `false` value triggers the non-tty branch.
    // `undefined` (the default for non-stream-piped Bun stdin in some setups)
    // stays on the existing tty-path remedy.
    withIsTTY(undefined, () => {
      let captured: RequiresInputRefusedError | null = null;
      try {
        requireOrRefuse(baseSpec, "tracker_mode", SENTINEL);
      } catch (e) {
        captured = e as RequiresInputRefusedError;
      }
      expect(captured).not.toBeNull();
      const msg = captured!.message;
      expect(msg).not.toContain("Non-tty stdin");
      expect(msg).toContain("stdin=tty");
    });
  });
});
