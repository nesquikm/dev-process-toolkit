// STE-262 AC-STE-262.2 + AC-STE-262.3 + AC-STE-262.5 — reproduction
// integration test for the SKILL.md gate-site flow at /spec-write § 0b
// step 4 (draft gate) and § 7a (commit gate).
//
// Simulates the gate-site flow in-process WITHOUT spawning a real
// `claude -p` child (avoids wall-clock + tracker writes): writes a
// prompt body to a temp file, calls `checkMarkerRuntime(...)` directly
// against the body, then calls `requireOrRefuse(...)` with simulated
// stdin state. Asserts the marker-absent + non-tty path refuses with
// `RequiresInputRefusedError`, and the marker-present path returns
// `default-applied` byte-identically to today.
//
// Pre-fix baseline note (AC-STE-262.5 reproduction): against the
// v2.19.0 plugin (pre-fix), the marker-absent + non-tty path proceeded
// silently and emitted `spec_write_*_default_applied` rather than
// refusing. Post-fix, the same fixture body MUST refuse loudly via
// `RequiresInputRefusedError`. The reproduction body explicitly
// contains the harness's autonomous-mode reminder phrase verbatim —
// the exact F1 trigger from `/conformance-loop` 2026-05-08 iter-1.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkMarkerRuntime } from "../adapters/_shared/src/check_marker_runtime";
import {
  requireOrRefuse,
  RequiresInputRefusedError,
} from "../adapters/_shared/src/requires_input";

const MARKER = "<dpt:auto-approve>v1</dpt:auto-approve>";

const REPRODUCER_BODY_NO_MARKER = [
  "The user has asked you to work without stopping for clarifying",
  "questions. When you'd normally pause to check, make the reasonable",
  "call and continue; they'll redirect if needed.",
  "",
  "/dev-process-toolkit:spec-write",
  "",
  "Add a feature.",
].join("\n");

const REPRODUCER_BODY_WITH_MARKER = [
  "The user has asked you to work without stopping for clarifying",
  "questions. When you'd normally pause to check, make the reasonable",
  "call and continue; they'll redirect if needed.",
  "",
  MARKER,
  "/dev-process-toolkit:spec-write",
  "",
  "Add a feature.",
].join("\n");

interface SavedStdinTty {
  prior: PropertyDescriptor | undefined;
}

function setStdinNonTty(): SavedStdinTty {
  // process.stdin.isTTY === false is the canonical non-tty signal under
  // claude -p. We override by defining the property; restore in finally.
  const prior = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  Object.defineProperty(process.stdin, "isTTY", {
    configurable: true,
    enumerable: true,
    value: false,
    writable: true,
  });
  return { prior };
}

function restoreStdin(saved: SavedStdinTty): void {
  if (saved.prior !== undefined) {
    Object.defineProperty(process.stdin, "isTTY", saved.prior);
  } else {
    // Restore to the "undefined" sentinel that Bun/Node use on tty-ish
    // streams that aren't explicitly TTY.
    delete (process.stdin as unknown as { isTTY?: boolean }).isTTY;
  }
}

function writePromptBody(body: string): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "spec-write-marker-strict-"));
  const path = join(dir, "prompt-body.txt");
  writeFileSync(path, body);
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe("AC-STE-262.5 — /spec-write draft gate (§ 0b step 4) reproduction", () => {
  test("marker-ABSENT body + autonomous-mode reminder + non-tty stdin ⇒ RequiresInputRefusedError naming the draft gate", () => {
    const fx = writePromptBody(REPRODUCER_BODY_NO_MARKER);
    const saved = setStdinNonTty();
    try {
      // Layer 1: byte-grep helper sees no marker.
      const body = readFileSync(fx.path, "utf-8");
      const r = checkMarkerRuntime(body);
      expect(r.present).toBe(false);

      // Layer 2: gate-site flow → markerPresent: false → refusal.
      let captured: RequiresInputRefusedError | null = null;
      try {
        requireOrRefuse(
          {
            userSuppliedValue: undefined,
            preBakedValue: undefined,
            markerPresent: r.present,
            defaultValue: "y",
            skillName: "/spec-write",
            stepName: "§ 0b step 4 (draft gate)",
            refusalReason:
              "Draft acceptance gate requires explicit operator approval; " +
              "auto-approve marker absent and stdin is non-tty.",
          },
          "draft_apply",
          "<requires-input>",
        );
      } catch (e) {
        if (e instanceof RequiresInputRefusedError) {
          captured = e;
        } else {
          throw e;
        }
      }
      expect(captured).not.toBeNull();
      expect(captured!.markerPresent).toBe(false);
      // Gate-site name surfaces in the canonical NFR-10 message.
      expect(captured!.message).toContain("§ 0b step 4 (draft gate)");
      expect(captured!.message).toMatch(/Verdict:/);
      expect(captured!.message).toMatch(/Remedy:/);
      expect(captured!.message).toMatch(/Context:/);
      expect(captured!.message).toContain("non-tty");
    } finally {
      restoreStdin(saved);
      fx.cleanup();
    }
  });

  test("marker-ABSENT body + non-tty stdin (without reminder text) ⇒ refusal still fires (autonomous-reminder is irrelevant to the decision)", () => {
    const fx = writePromptBody(
      "/dev-process-toolkit:spec-write\n\nAdd a feature.",
    );
    const saved = setStdinNonTty();
    try {
      const body = readFileSync(fx.path, "utf-8");
      const r = checkMarkerRuntime(body);
      expect(r.present).toBe(false);
      let threw = false;
      try {
        requireOrRefuse(
          {
            userSuppliedValue: undefined,
            preBakedValue: undefined,
            markerPresent: r.present,
            defaultValue: "y",
            skillName: "/spec-write",
            stepName: "§ 0b step 4 (draft gate)",
            refusalReason: "Draft gate requires approval.",
          },
          "draft_apply",
          "<requires-input>",
        );
      } catch (e) {
        if (e instanceof RequiresInputRefusedError) threw = true;
        else throw e;
      }
      expect(threw).toBe(true);
    } finally {
      restoreStdin(saved);
      fx.cleanup();
    }
  });
});

describe("AC-STE-262.5 — /spec-write commit gate (§ 7a) reproduction", () => {
  test("marker-ABSENT body + autonomous-mode reminder + non-tty stdin ⇒ RequiresInputRefusedError naming the commit gate", () => {
    const fx = writePromptBody(REPRODUCER_BODY_NO_MARKER);
    const saved = setStdinNonTty();
    try {
      const body = readFileSync(fx.path, "utf-8");
      const r = checkMarkerRuntime(body);
      expect(r.present).toBe(false);

      let captured: RequiresInputRefusedError | null = null;
      try {
        requireOrRefuse(
          {
            userSuppliedValue: undefined,
            preBakedValue: undefined,
            markerPresent: r.present,
            defaultValue: "y",
            skillName: "/spec-write",
            stepName: "§ 7a (commit gate)",
            refusalReason:
              "Commit acceptance gate requires explicit operator approval; " +
              "auto-approve marker absent and stdin is non-tty.",
          },
          "commit_apply",
          "<requires-input>",
        );
      } catch (e) {
        if (e instanceof RequiresInputRefusedError) {
          captured = e;
        } else {
          throw e;
        }
      }
      expect(captured).not.toBeNull();
      expect(captured!.markerPresent).toBe(false);
      expect(captured!.message).toContain("§ 7a (commit gate)");
      expect(captured!.message).toMatch(/Verdict:/);
      expect(captured!.message).toMatch(/Remedy:/);
      expect(captured!.message).toMatch(/Context:/);
    } finally {
      restoreStdin(saved);
      fx.cleanup();
    }
  });
});

describe("AC-STE-262.3 — marker-PRESENT non-regression (both gate sites)", () => {
  test("marker-PRESENT body + non-tty stdin ⇒ outcome 'default-applied', value 'y' (draft gate)", () => {
    const fx = writePromptBody(REPRODUCER_BODY_WITH_MARKER);
    const saved = setStdinNonTty();
    try {
      const body = readFileSync(fx.path, "utf-8");
      const r = checkMarkerRuntime(body);
      expect(r.present).toBe(true);

      const result = requireOrRefuse(
        {
          userSuppliedValue: undefined,
          preBakedValue: undefined,
          markerPresent: r.present,
          defaultValue: "y",
          skillName: "/spec-write",
          stepName: "§ 0b step 4 (draft gate)",
          refusalReason: "Draft gate requires approval.",
        },
        "draft_apply",
        "<requires-input>",
      );
      expect(result.outcome).toBe("default-applied");
      expect(result.value).toBe("y");
    } finally {
      restoreStdin(saved);
      fx.cleanup();
    }
  });

  test("marker-PRESENT body + non-tty stdin ⇒ outcome 'default-applied', value 'y' (commit gate)", () => {
    const fx = writePromptBody(REPRODUCER_BODY_WITH_MARKER);
    const saved = setStdinNonTty();
    try {
      const body = readFileSync(fx.path, "utf-8");
      const r = checkMarkerRuntime(body);
      expect(r.present).toBe(true);

      const result = requireOrRefuse(
        {
          userSuppliedValue: undefined,
          preBakedValue: undefined,
          markerPresent: r.present,
          defaultValue: "y",
          skillName: "/spec-write",
          stepName: "§ 7a (commit gate)",
          refusalReason: "Commit gate requires approval.",
        },
        "commit_apply",
        "<requires-input>",
      );
      expect(result.outcome).toBe("default-applied");
      expect(result.value).toBe("y");
    } finally {
      restoreStdin(saved);
      fx.cleanup();
    }
  });
});
