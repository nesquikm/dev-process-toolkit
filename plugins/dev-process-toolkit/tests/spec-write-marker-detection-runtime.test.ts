// STE-294 runtime regression — /spec-write auto-apply MUST ignore
// autonomous-mode-reminder paraphrases. The literal byte-string marker
// `<dpt:auto-approve>v1</dpt:auto-approve>` is the SOLE auto-apply
// trigger. Any LLM inference from the autonomous-mode reminder
// (`The user has asked you to work without stopping ...`), pre-baked
// `<command-args>` prose, or "standing instruction" paraphrases MUST
// NOT influence the gate decision.
//
// Covers all five ACs:
//   AC-STE-294.1 — byte-pin the four forbidden phrases inside
//                  `FORBIDDEN_PHRASES`.
//   AC-STE-294.2 — canonical NOT-a-trigger anchor sentence is byte-
//                  repeated at least 3 times in /spec-write SKILL.md
//                  (§ 0b step 4, § 7a, `## Rules`).
//   AC-STE-294.3 — regression fixture lands at
//                  `tests/fixtures/socratic-first-turn/regression/
//                   spec-write-marker-absent-reminder-present-2026-05-14.json`
//                  and the gate-evaluation flow refuses with
//                  `RequiresInputRefusedError` (NFR-10 shape, gate `draft`).
//   AC-STE-294.4 — `.claude/skills/smoke-test/SKILL.md` fixture 1b assertion
//                  + diagnostic line are byte-checkable post-TIGHTEN.
//   AC-STE-294.5 — `specs/frs/STE-294.md` § Notes section documents the
//                  cross-tracker asymmetry root-cause (or classifies as
//                  LLM stochasticity), naming Linear / Jira / log file
//                  references.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { checkMarkerRuntime } from "../adapters/_shared/src/check_marker_runtime";
import {
  requireOrRefuse,
  RequiresInputRefusedError,
} from "../adapters/_shared/src/requires_input";
import { FORBIDDEN_PHRASES } from "../adapters/_shared/src/spec_write_alternate_trigger_scan";

// Canonical anchor sentence per AC-STE-294.2 — the literal byte-string the
// probe checks for. Note: the `<path>` placeholder is intentionally part of
// the anchor (the FR doesn't specify a substitution rule).
const CANONICAL_ANCHOR =
  'Autonomous-mode reminders, pre-baked <command-args> prose, ' +
  'and "standing instruction" paraphrases are NOT acceptable ' +
  'auto-apply triggers — the marker is the SOLE decider; the ' +
  'runtime byte-grep at <path> is the SOLE evaluation path.';

// The four phrases AC-STE-294.1 mandates inside FORBIDDEN_PHRASES.
const REQUIRED_FORBIDDEN_PHRASES = [
  "autonomous-mode reminder",
  "standing instruction",
  "work without stopping",
  "default-applied per standing",
] as const;

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const SPEC_WRITE_SKILL = join(
  REPO_ROOT,
  "plugins",
  "dev-process-toolkit",
  "skills",
  "spec-write",
  "SKILL.md",
);
const SMOKE_TEST_SKILL = join(
  REPO_ROOT,
  ".claude",
  "skills",
  "smoke-test",
  "SKILL.md",
);
const REGRESSION_FIXTURE = join(
  REPO_ROOT,
  "plugins",
  "dev-process-toolkit",
  "tests",
  "fixtures",
  "socratic-first-turn",
  "regression",
  "spec-write-marker-absent-reminder-present-2026-05-14.json",
);
const STE_294_FR_ACTIVE = join(REPO_ROOT, "specs", "frs", "STE-294.md");
const STE_294_FR_ARCHIVE = join(REPO_ROOT, "specs", "frs", "archive", "STE-294.md");
const STE_294_FR = existsSync(STE_294_FR_ACTIVE) ? STE_294_FR_ACTIVE : STE_294_FR_ARCHIVE;

interface SavedStdinTty {
  prior: PropertyDescriptor | undefined;
}

function setStdinNonTty(): SavedStdinTty {
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
    delete (process.stdin as unknown as { isTTY?: boolean }).isTTY;
  }
}

/**
 * Extract the first user-message prompt body from a JSONL session-log
 * fixture (Claude Code stream-json transcript shape). Returns the
 * concatenation of all `text` blocks in the first `type:"user"` message.
 * Falls back to a top-level `prompt` string field if the fixture is a
 * minimal regression shape rather than a full session transcript.
 */
function extractPromptBody(fixturePath: string): string {
  const raw = readFileSync(fixturePath, "utf-8").trim();
  if (raw.length === 0) {
    throw new Error(`fixture is empty: ${fixturePath}`);
  }
  // Try JSONL first (canonical session-log shape).
  const lines = raw.split("\n");
  for (const line of lines) {
    if (line.trim() === "") continue;
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (
      obj !== null &&
      typeof obj === "object" &&
      (obj as { type?: unknown }).type === "user"
    ) {
      const msg = (obj as { message?: { content?: unknown } }).message;
      if (msg && Array.isArray(msg.content)) {
        const parts: string[] = [];
        for (const c of msg.content) {
          if (
            c !== null &&
            typeof c === "object" &&
            (c as { type?: unknown }).type === "text" &&
            typeof (c as { text?: unknown }).text === "string"
          ) {
            parts.push((c as { text: string }).text);
          }
        }
        if (parts.length > 0) return parts.join("\n");
      }
      if (typeof (obj as { prompt?: unknown }).prompt === "string") {
        return (obj as { prompt: string }).prompt;
      }
    }
  }
  // Fallback: minimal single-object regression fixture with a top-level
  // `prompt` string field.
  try {
    const obj = JSON.parse(raw);
    if (obj !== null && typeof obj === "object") {
      if (typeof (obj as { prompt?: unknown }).prompt === "string") {
        return (obj as { prompt: string }).prompt;
      }
      if (
        typeof (obj as { user_message?: unknown }).user_message === "string"
      ) {
        return (obj as { user_message: string }).user_message;
      }
    }
  } catch {
    /* ignore */
  }
  throw new Error(
    `could not extract user prompt body from fixture: ${fixturePath}`,
  );
}

describe("AC-STE-294.1 — FORBIDDEN_PHRASES byte-pin", () => {
  test("FORBIDDEN_PHRASES contains 'autonomous-mode reminder'", () => {
    expect(FORBIDDEN_PHRASES).toContain("autonomous-mode reminder");
  });

  test("FORBIDDEN_PHRASES contains 'standing instruction'", () => {
    expect(FORBIDDEN_PHRASES).toContain("standing instruction");
  });

  test("FORBIDDEN_PHRASES contains 'work without stopping'", () => {
    expect(FORBIDDEN_PHRASES).toContain("work without stopping");
  });

  test("FORBIDDEN_PHRASES contains 'default-applied per standing'", () => {
    expect(FORBIDDEN_PHRASES).toContain("default-applied per standing");
  });

  test("FORBIDDEN_PHRASES contains all 4 STE-294 phrases (consolidated)", () => {
    for (const phrase of REQUIRED_FORBIDDEN_PHRASES) {
      expect(FORBIDDEN_PHRASES as readonly string[]).toContain(phrase);
    }
  });
});

describe("AC-STE-294.2 — canonical NOT-a-trigger anchor sentence", () => {
  test("/spec-write SKILL.md exists and is readable", () => {
    expect(existsSync(SPEC_WRITE_SKILL)).toBe(true);
  });

  test("canonical anchor sentence appears at least 3 times (§ 0b step 4 + § 7a + ## Rules)", () => {
    const body = readFileSync(SPEC_WRITE_SKILL, "utf-8");
    // Count non-overlapping byte-identical occurrences of the anchor.
    let count = 0;
    let idx = 0;
    while (true) {
      const found = body.indexOf(CANONICAL_ANCHOR, idx);
      if (found === -1) break;
      count += 1;
      idx = found + CANONICAL_ANCHOR.length;
    }
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test("canonical anchor sentence carries every load-bearing fragment", () => {
    // Negative-shape pin so a partial paraphrase (e.g., dropping the
    // 'SOLE decider' clause) doesn't satisfy the count check above by
    // accident. Each of these substrings must appear inside the anchor.
    expect(CANONICAL_ANCHOR).toContain("Autonomous-mode reminders");
    expect(CANONICAL_ANCHOR).toContain("pre-baked <command-args> prose");
    expect(CANONICAL_ANCHOR).toContain('"standing instruction" paraphrases');
    expect(CANONICAL_ANCHOR).toContain("NOT acceptable");
    expect(CANONICAL_ANCHOR).toContain("auto-apply triggers");
    expect(CANONICAL_ANCHOR).toContain("the marker is the SOLE decider");
    expect(CANONICAL_ANCHOR).toContain("runtime byte-grep at <path>");
    expect(CANONICAL_ANCHOR).toContain("SOLE evaluation path");
  });
});

describe("AC-STE-294.3 — regression fixture + runtime refusal", () => {
  test("regression fixture file exists at the canonical path", () => {
    expect(existsSync(REGRESSION_FIXTURE)).toBe(true);
  });

  test("regression fixture prompt body contains autonomous-mode reminder phrase", () => {
    const body = extractPromptBody(REGRESSION_FIXTURE);
    // The iter-1 § F1 reproducer's load-bearing phrase — the harness's
    // autonomous-mode reminder. If the fixture is stripped to nothing
    // useful, the runtime test below would never simulate the bug.
    expect(body).toContain("work without stopping");
  });

  test("regression fixture prompt body has NO auto-approve marker", () => {
    const body = extractPromptBody(REGRESSION_FIXTURE);
    expect(body).not.toContain("<dpt:auto-approve>v1</dpt:auto-approve>");
  });

  test("gate-evaluation on the fixture body raises RequiresInputRefusedError (NFR-10 shape, gate=draft)", () => {
    const body = extractPromptBody(REGRESSION_FIXTURE);
    // Layer 1 — byte-grep helper returns present:false.
    const marker = checkMarkerRuntime(body);
    expect(marker.present).toBe(false);

    // Layer 2 — requireOrRefuse with markerPresent:false MUST throw the
    // NFR-10 canonical refusal. Simulate non-tty stdin (the F1 capture
    // ran under `claude -p`).
    const saved = setStdinNonTty();
    let captured: RequiresInputRefusedError | null = null;
    try {
      try {
        requireOrRefuse(
          {
            userSuppliedValue: undefined,
            preBakedValue: undefined,
            markerPresent: marker.present,
            defaultValue: "y",
            skillName: "/spec-write",
            stepName: "§ 0b step 4 (draft gate)",
            refusalReason:
              "Draft acceptance gate requires explicit operator approval; " +
              "auto-approve marker absent and stdin is non-tty.",
          },
          "draft",
          "<requires-input>",
        );
      } catch (e) {
        if (e instanceof RequiresInputRefusedError) {
          captured = e;
        } else {
          throw e;
        }
      }
    } finally {
      restoreStdin(saved);
    }
    expect(captured).not.toBeNull();
    expect(captured!.markerPresent).toBe(false);
    expect(captured!.key).toBe("draft");
    expect(captured!.message).toMatch(/Verdict:/);
    expect(captured!.message).toMatch(/Remedy:/);
    expect(captured!.message).toMatch(/Context:/);
    expect(captured!.message).toContain("non-tty");
    // Gate-site name surfaces in the canonical NFR-10 message.
    expect(captured!.message).toContain("draft");
  });
});

describe("AC-STE-294.4 — smoke-test SKILL.md fixture 1b byte-checkable assertion", () => {
  test("smoke-test SKILL.md exists and is readable", () => {
    expect(existsSync(SMOKE_TEST_SKILL)).toBe(true);
  });

  test("fixture 1b assertion text is updated to name Linear-side AND Jira-side both raising RequiresInputRefusedError", () => {
    const body = readFileSync(SMOKE_TEST_SKILL, "utf-8");
    // Post-TIGHTEN assertion text. The FR allows either the exact
    // replacement OR the original + new prose carried side-by-side; we
    // require the new prose to be present byte-identically.
    expect(body).toContain(
      "Linear-side AND Jira-side both raised `RequiresInputRefusedError`",
    );
  });

  test("STE-226 runtime regression diagnostic line names spec-write marker-absent fixture 1b", () => {
    const body = readFileSync(SMOKE_TEST_SKILL, "utf-8");
    expect(body).toContain(
      "STE-226 runtime regression: spec-write marker-absent fixture 1b",
    );
  });
});

describe("AC-STE-294.5 — cross-tracker asymmetry root-cause documented in STE-294.md § Notes", () => {
  test("STE-294 FR file exists", () => {
    expect(existsSync(STE_294_FR)).toBe(true);
  });

  test("FR carries a `## Notes` section", () => {
    const body = readFileSync(STE_294_FR, "utf-8");
    expect(body).toMatch(/^## Notes$/m);
  });

  test("§ Notes documents the cross-tracker asymmetry root-cause (deterministic cause OR LLM stochasticity classification)", () => {
    const body = readFileSync(STE_294_FR, "utf-8");
    // Slice from `## Notes` to EOF (the section runs to the end of the
    // file in canonical FR layout).
    const m = body.match(/## Notes\n([\s\S]+)$/);
    expect(m).not.toBeNull();
    const notes = m![1]!;
    // The FR text says either (a) deterministic cause, OR (b)
    // LLM-stochasticity classification, satisfies AC.5. Both branches
    // surface as a paragraph keyed by 'Cross-tracker asymmetry' or
    // 'root cause' / 'root-cause'.
    const hasKey =
      /[Cc]ross-tracker asymmetry/.test(notes) &&
      /(root[\- ]cause|stochastic|LLM stochasticity|deterministic cause)/i.test(
        notes,
      );
    expect(hasKey).toBe(true);
  });

  test("§ Notes paragraph names Linear and Jira and references the source log files", () => {
    const body = readFileSync(STE_294_FR, "utf-8");
    const m = body.match(/## Notes\n([\s\S]+)$/);
    expect(m).not.toBeNull();
    const notes = m![1]!;
    expect(notes).toMatch(/Linear/);
    expect(notes).toMatch(/Jira/);
    // The /tmp log diff is best-effort, but the FR mandates "log file
    // references" — at minimum the canonical iter-1 log path or the
    // smoke-test 1b log path must appear so the trail is reconstructible.
    expect(notes).toMatch(
      /(\/tmp\/dpt-(conformance-loop|smoke)-[\w\-]+\.(md|log)|dpt-smoke-(linear|jira)-spec-write-1b\.log)/,
    );
  });
});
