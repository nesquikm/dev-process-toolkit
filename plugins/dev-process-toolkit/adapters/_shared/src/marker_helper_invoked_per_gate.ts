// marker_helper_invoked_per_gate (STE-313 AC-STE-313.6) — /gate-check probe
// `marker_helper_invoked_per_gate`. Severity: error.
//
// Scans the Bash-tool transcript of /spec-write and /setup runs (via the
// stream-json session-log capture path from F6 mitigation, or via a
// session-log hook) and refuses with NFR-10 if any marker-gated decision
// proceeded without a `check_marker_runtime.ts` invocation.
//
// The probe consumes a session-log NDJSON file (one event per line — the
// same shape `claude -p --output-format stream-json` emits). It walks the
// assistant events in order, tracking two state bits:
//
//   - whether a marker-helper Bash invocation has fired since the last gate
//     decision (the "helper armed" flag),
//   - which gate decision tokens have surfaced in assistant-emitted text.
//
// Canonical helper invocation byte-pattern (substring match on
// `tool_use.input.command`):
//
//   `bun run plugins/dev-process-toolkit/adapters/_shared/src/check_marker_runtime.ts`
//
// Canonical gate decision tokens (substring match on assistant `text`
// blocks):
//
//   - `spec_write_draft_default_applied`
//   - `spec_write_commit_default_applied`
//   - `branch_gate_default_applied`
//   - `setup_socratic_first_turn_*` (any token with this prefix)
//
// Refusal events (substring `RequiresInputRefusedError:` in an assistant
// text block) are NOT gate decisions — they are the gate outcome itself
// when the gate refuses. The probe ignores them: a refusal needs no
// preceding helper invocation, because there is no auto-apply to validate.
//
// Vacuous when no session log path is supplied OR when the path points at
// a missing file (downstream toolkit consumers without the F6 capture path
// shouldn't see false-positive violations).

import { existsSync, readFileSync } from "node:fs";

export type Severity = "error" | "warning";

export interface MarkerHelperInvokedPerGateDeps {
  /**
   * Path to an NDJSON session-log file (one JSON event per line, the same
   * shape `claude -p --output-format stream-json` emits). Optional — when
   * undefined or pointing at a missing file, the probe is vacuous and
   * surfaces zero violations.
   */
  sessionLogPath?: string;
}

export interface MarkerHelperInvokedPerGateViolation {
  severity: Severity;
  message: string;
}

export interface MarkerHelperInvokedPerGateReport {
  violations: MarkerHelperInvokedPerGateViolation[];
}

/**
 * Canonical Bash invocation pattern the probe greps for. Literal substring
 * match — module-import variants (e.g. `import { checkMarkerRuntime } from
 * "./check_marker_runtime"`) are not detected here; the probe documents the
 * canonical CLI path. Update both the test fixture and this constant in
 * lockstep if the helper invocation grammar evolves.
 */
const MARKER_HELPER_INVOCATION =
  "bun run plugins/dev-process-toolkit/adapters/_shared/src/check_marker_runtime.ts";

/**
 * Exact gate decision tokens the probe arbitrates. Substring match against
 * assistant text blocks — the tokens themselves are stable byte-strings, so
 * a paraphrased gate decision (e.g. "draft gate auto-applied") is by design
 * NOT detected. The skills emit these tokens verbatim when auto-applying.
 */
const EXACT_GATE_TOKENS = [
  "spec_write_draft_default_applied",
  "spec_write_commit_default_applied",
  "branch_gate_default_applied",
] as const;

/**
 * Prefix-matched gate decision tokens. Matches any token whose substring
 * starts with the prefix (e.g. `setup_socratic_first_turn_violation`,
 * `setup_socratic_first_turn_scaffold_applied`).
 */
const PREFIX_GATE_TOKENS = ["setup_socratic_first_turn_"] as const;

const REFUSAL_MARKER = "RequiresInputRefusedError";

const REMEDY =
  "every marker-gated decision (`/spec-write` draft + commit + branch gates, " +
  "`/setup` Socratic first-turn) MUST be preceded by a Bash invocation of " +
  "`bun run plugins/dev-process-toolkit/adapters/_shared/src/check_marker_runtime.ts` " +
  "in the same prompt-bearing child. The byte-checkable helper invocation is " +
  "the SOLE evaluation path; harness <system-reminder> prose, " +
  "\"work without stopping\" paraphrases, and pre-baked <command-args> are " +
  "NOT acceptable substitutes (see docs/auto-mode-protocol.md § The Rule).";

function buildMessage(token: string, reason: string): string {
  return [
    `marker_helper_invoked_per_gate: ${token} — ${reason}`,
    `Remedy: ${REMEDY}`,
    `Context: gate_token=${token}, probe=marker_helper_invoked_per_gate, severity=error`,
  ].join("\n");
}

interface AssistantBlock {
  kind: "text" | "tool_use";
  text?: string;
  toolName?: string;
  command?: string;
}

function projectAssistantEvent(event: unknown): AssistantBlock[] {
  if (!event || typeof event !== "object") return [];
  const e = event as Record<string, unknown>;
  if (e.type !== "assistant") return [];
  const message = e.message;
  if (!message || typeof message !== "object") return [];
  const content = (message as Record<string, unknown>).content;
  if (!Array.isArray(content)) return [];

  const out: AssistantBlock[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as Record<string, unknown>;
    if (b.type === "text" && typeof b.text === "string") {
      out.push({ kind: "text", text: b.text });
    } else if (b.type === "tool_use" && typeof b.name === "string") {
      const input = b.input;
      const command =
        input && typeof input === "object"
          ? (input as Record<string, unknown>).command
          : undefined;
      out.push({
        kind: "tool_use",
        toolName: b.name as string,
        command: typeof command === "string" ? command : undefined,
      });
    }
  }
  return out;
}

function matchGateToken(text: string): string | null {
  for (const tok of EXACT_GATE_TOKENS) {
    if (text.includes(tok)) return tok;
  }
  for (const prefix of PREFIX_GATE_TOKENS) {
    const idx = text.indexOf(prefix);
    if (idx === -1) continue;
    // Extract the matched token starting at the prefix; stop at first
    // non-token byte (whitespace, punctuation other than `_`).
    let end = idx + prefix.length;
    while (end < text.length && /[A-Za-z0-9_]/.test(text[end]!)) end++;
    return text.slice(idx, end);
  }
  return null;
}

function isHelperInvocation(command: string | undefined): boolean {
  return typeof command === "string" && command.includes(MARKER_HELPER_INVOCATION);
}

function isRefusalText(text: string): boolean {
  return text.includes(REFUSAL_MARKER);
}

function parseNdjsonLines(raw: string): unknown[] {
  const events: unknown[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed));
    } catch {
      // Malformed line — skip silently per probe contract.
    }
  }
  return events;
}

export async function runMarkerHelperInvokedPerGateProbe(
  _projectRoot: string,
  deps: MarkerHelperInvokedPerGateDeps = {},
): Promise<MarkerHelperInvokedPerGateReport> {
  const { sessionLogPath } = deps;
  if (!sessionLogPath) return { violations: [] };
  if (!existsSync(sessionLogPath)) return { violations: [] };

  let raw: string;
  try {
    raw = readFileSync(sessionLogPath, "utf-8");
  } catch {
    return { violations: [] };
  }

  const events = parseNdjsonLines(raw);
  const violations: MarkerHelperInvokedPerGateViolation[] = [];

  // Walk events in order. `helperArmed` flips true when a marker-helper
  // Bash invocation fires, flips false when consumed by a gate decision
  // (one armed helper covers one gate decision — every gate needs its own
  // paired invocation).
  let helperArmed = false;

  for (const event of events) {
    const blocks = projectAssistantEvent(event);
    for (const block of blocks) {
      if (block.kind === "tool_use") {
        if (block.toolName === "Bash" && isHelperInvocation(block.command)) {
          helperArmed = true;
        }
        continue;
      }
      // text block
      const text = block.text ?? "";
      if (isRefusalText(text)) {
        // Refusal is the gate outcome — no auto-apply, no helper precedence
        // requirement. Do NOT consume `helperArmed`; the next real gate
        // decision still needs its own paired invocation.
        continue;
      }
      const token = matchGateToken(text);
      if (token === null) continue;
      if (!helperArmed) {
        violations.push({
          severity: "error",
          message: buildMessage(
            token,
            "gate decision surfaced without a preceding " +
              "`check_marker_runtime.ts` Bash invocation in the same session " +
              "log; the byte-checkable helper call is the SOLE evidence the " +
              "gate honored Auto Mode's literal-marker contract.",
          ),
        });
      }
      // Consume the armed helper — a single invocation covers a single
      // gate decision; subsequent gates need their own paired invocation.
      helperArmed = false;
    }
  }

  return { violations };
}
