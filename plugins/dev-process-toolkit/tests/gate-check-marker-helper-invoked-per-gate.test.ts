// STE-313 AC-STE-313.6 — /gate-check probe `marker_helper_invoked_per_gate`.
// Severity: error.
//
// Scans the Bash-tool transcript of /spec-write and /setup runs (via the
// stream-json session-log capture path) and refuses with NFR-10 if any
// marker-gated decision proceeded without a `check_marker_runtime.ts`
// invocation.
//
// The probe consumes a session-log NDJSON file (one event per line — same
// shape as `claude -p --output-format stream-json` captures). It walks
// the Bash tool-call events looking for the canonical invocation:
//
//   `bun run plugins/dev-process-toolkit/adapters/_shared/src/check_marker_runtime.ts`
//
// (or an equivalent module-import invocation captured in the transcript).
// For each gate event (`spec_write_draft_default_applied`,
// `spec_write_commit_default_applied`, `branch_gate_default_applied`,
// `setup_socratic_first_turn_*`) the probe asserts a marker-helper call
// preceded the gate decision. Any gate event without a paired helper
// invocation surfaces a violation in NFR-10 canonical shape.
//
// Vacuous when no session log path is provided (probe accepts an
// optional `{ sessionLogPath }` deps shape).

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMarkerHelperInvokedPerGateProbe } from "../adapters/_shared/src/marker_helper_invoked_per_gate";

const MARKER_HELPER_INVOCATION =
  "bun run plugins/dev-process-toolkit/adapters/_shared/src/check_marker_runtime.ts";

function makeSessionLog(events: ReadonlyArray<unknown>): string {
  return events.map((e) => JSON.stringify(e)).join("\n") + "\n";
}

function writeSessionLog(events: ReadonlyArray<unknown>): {
  path: string;
  cleanup: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), "marker-helper-probe-"));
  const path = join(dir, "session.ndjson");
  writeFileSync(path, makeSessionLog(events));
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe("AC-STE-313.6 — marker_helper_invoked_per_gate probe", () => {
  test("vacuous when sessionLogPath is undefined ⇒ zero violations", async () => {
    const r = await runMarkerHelperInvokedPerGateProbe(process.cwd(), {});
    expect(r.violations).toEqual([]);
  });

  test("vacuous when sessionLogPath points at a missing file ⇒ zero violations", async () => {
    const r = await runMarkerHelperInvokedPerGateProbe(process.cwd(), {
      sessionLogPath: "/no/such/session.ndjson",
    });
    expect(r.violations).toEqual([]);
  });

  test("session log with marker helper invoked + draft gate fired ⇒ zero violations", async () => {
    const log = writeSessionLog([
      {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "Bash",
              input: { command: `${MARKER_HELPER_INVOCATION} -` },
            },
          ],
        },
      },
      {
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "spec_write_draft_default_applied" },
          ],
        },
      },
    ]);
    try {
      const r = await runMarkerHelperInvokedPerGateProbe(process.cwd(), {
        sessionLogPath: log.path,
      });
      expect(r.violations).toEqual([]);
    } finally {
      log.cleanup();
    }
  });

  test("session log with draft gate fired but NO marker helper call ⇒ violation, severity=error", async () => {
    const log = writeSessionLog([
      {
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "spec_write_draft_default_applied" },
          ],
        },
      },
    ]);
    try {
      const r = await runMarkerHelperInvokedPerGateProbe(process.cwd(), {
        sessionLogPath: log.path,
      });
      expect(r.violations.length).toBeGreaterThanOrEqual(1);
      const v = r.violations[0]!;
      expect(v.severity).toBe("error");
      expect(v.message).toContain("marker_helper_invoked_per_gate");
      expect(v.message).toContain("spec_write_draft_default_applied");
      expect(v.message).toMatch(/Remedy:/);
      expect(v.message).toMatch(/Context:/);
    } finally {
      log.cleanup();
    }
  });

  test("session log with branch gate fired but NO marker helper call ⇒ violation naming gate_site=branch", async () => {
    const log = writeSessionLog([
      {
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "branch_gate_default_applied" },
          ],
        },
      },
    ]);
    try {
      const r = await runMarkerHelperInvokedPerGateProbe(process.cwd(), {
        sessionLogPath: log.path,
      });
      expect(r.violations.length).toBeGreaterThanOrEqual(1);
      const messages = r.violations.map((v) => v.message).join("\n");
      expect(messages).toContain("branch_gate_default_applied");
    } finally {
      log.cleanup();
    }
  });

  test("session log with helper called AFTER the gate ⇒ violation (ordering matters)", async () => {
    // The helper must be invoked BEFORE the gate decision — a post-hoc
    // invocation is not evidence the gate honored the byte-check.
    const log = writeSessionLog([
      {
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "spec_write_draft_default_applied" },
          ],
        },
      },
      {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "Bash",
              input: { command: `${MARKER_HELPER_INVOCATION} -` },
            },
          ],
        },
      },
    ]);
    try {
      const r = await runMarkerHelperInvokedPerGateProbe(process.cwd(), {
        sessionLogPath: log.path,
      });
      expect(r.violations.length).toBeGreaterThanOrEqual(1);
    } finally {
      log.cleanup();
    }
  });

  test("session log with multiple gates each preceded by helper invocation ⇒ zero violations", async () => {
    const log = writeSessionLog([
      {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "Bash",
              input: { command: `${MARKER_HELPER_INVOCATION} -` },
            },
          ],
        },
      },
      {
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "spec_write_draft_default_applied" },
          ],
        },
      },
      {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "Bash",
              input: { command: `${MARKER_HELPER_INVOCATION} -` },
            },
          ],
        },
      },
      {
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "branch_gate_default_applied" },
          ],
        },
      },
    ]);
    try {
      const r = await runMarkerHelperInvokedPerGateProbe(process.cwd(), {
        sessionLogPath: log.path,
      });
      expect(r.violations).toEqual([]);
    } finally {
      log.cleanup();
    }
  });

  test("session log with malformed NDJSON lines ⇒ skips silently, no crash", async () => {
    const dir = mkdtempSync(join(tmpdir(), "marker-helper-probe-malformed-"));
    const path = join(dir, "session.ndjson");
    writeFileSync(
      path,
      [
        "not-json-line",
        "",
        JSON.stringify({
          type: "assistant",
          message: {
            content: [
              {
                type: "tool_use",
                name: "Bash",
                input: { command: `${MARKER_HELPER_INVOCATION} -` },
              },
            ],
          },
        }),
        JSON.stringify({
          type: "assistant",
          message: {
            content: [
              { type: "text", text: "spec_write_draft_default_applied" },
            ],
          },
        }),
      ].join("\n"),
    );
    try {
      const r = await runMarkerHelperInvokedPerGateProbe(process.cwd(), {
        sessionLogPath: path,
      });
      expect(r.violations).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("session log with refusal event (gate refused, no auto-apply) ⇒ zero violations (refusal needs no helper precedence)", async () => {
    // When the gate refuses (RequiresInputRefusedError), there's no
    // auto-apply to validate — the refusal itself is the gate outcome.
    const log = writeSessionLog([
      {
        type: "assistant",
        message: {
          content: [
            {
              type: "text",
              text: "RequiresInputRefusedError: gate_site=draft marker=absent stdin=non-tty",
            },
          ],
        },
      },
    ]);
    try {
      const r = await runMarkerHelperInvokedPerGateProbe(process.cwd(), {
        sessionLogPath: log.path,
      });
      expect(r.violations).toEqual([]);
    } finally {
      log.cleanup();
    }
  });
});
