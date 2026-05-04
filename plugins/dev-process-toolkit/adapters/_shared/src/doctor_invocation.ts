// doctor_invocation — STE-209 AC-STE-209.5 helper.
//
// The /setup step 1b doctor probe should match the user's declared
// invocation prefix (e.g., `fvm flutter` when the stack uses fvm),
// not hard-code the bare command (e.g., `flutter`). On a fresh
// machine without `fvm`, a bare `flutter --version` succeeds while
// `fvm flutter --version` fails — the gate-commands declaration is
// the source of truth for "which executable proves the toolchain is
// installed."
//
// Implementation: parse `examples/<stack>/gate-commands.md` (or the
// rendered CLAUDE.md) for the first command line invoking the stack
// command. The first whitespace-separated token (or two-token wrapper
// pair like `fvm flutter`) is the invocation prefix. Falls back to
// the bare command when no wrapper is declared.

/** Stack-specific bare commands the doctor probes. The order matters
 *  — when multiple bare commands appear in gate-commands, the first
 *  match wins. Keep this short — only stacks the toolkit ships an
 *  example for. */
const KNOWN_BARE_COMMANDS = ["flutter", "dart", "bun", "npm", "node", "python", "python3", "uv", "pytest"];

/** Wrappers we recognize, paired with the commands they wrap. Allows
 *  `fvm flutter` and `fvm dart` (Flutter Version Management) and
 *  `pnpm node` / `pnpm npm` (pnpm shells out to its bundled node).
 *  A wrapper applied to an unrelated bare command is rejected — e.g.,
 *  `pnpm python` is NOT a recognized pairing and falls through to the
 *  bare-command branch. */
const KNOWN_WRAPPER_PAIRS: Record<string, string[]> = {
  fvm: ["flutter", "dart"],
  pnpm: ["node", "npm"],
};

/**
 * Extract the per-stack doctor invocation prefix from a gate-commands
 * body. Returns the first matched wrapper-prefixed pair (e.g.,
 * `"fvm flutter"`) when present, otherwise the bare command (e.g.,
 * `"flutter"`). Returns null when no known stack command is mentioned.
 *
 * Pure function — no I/O. Caller reads the gate-commands file and
 * passes the body in.
 */
export function doctorInvocationFor(stackCommand: string, gateCommandsBody: string): string | null {
  if (!KNOWN_BARE_COMMANDS.includes(stackCommand)) {
    return null;
  }
  // Local regex (not module-level) — no shared mutable lastIndex across
  // concurrent async calls; the lazy `[\s\S]*?` is safe against
  // catastrophic backtracking on well-formed input. Inputs come from
  // small-budget plugin example files (≤ a few KB), so the EOF-walk
  // case for an unterminated fence is bounded by the file size.
  const FENCE_RE = /```[\s\S]*?```/g;
  // Walk fenced blocks first — they're where the canonical commands
  // live. Outside fences may contain prose ("never use bare flutter")
  // that should not match.
  const fences: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = FENCE_RE.exec(gateCommandsBody)) !== null) {
    fences.push(m[0]);
  }
  for (const fence of fences) {
    for (const line of fence.split("\n")) {
      const trimmed = line.replace(/^```[a-z]*\s*/, "").trim();
      if (trimmed.length === 0) continue;
      // Skip backtick-only fence boundaries.
      if (/^```/.test(trimmed)) continue;
      const tokens = trimmed.split(/\s+/);
      // Wrapper case: `<wrapper> <stackCommand> ...` — only when the
      // pair is in KNOWN_WRAPPER_PAIRS (rejects nonsense pairings like
      // `pnpm python`, which falls through to the bare-token branch).
      const t0 = tokens[0] ?? "";
      const t1 = tokens[1] ?? "";
      if (KNOWN_WRAPPER_PAIRS[t0]?.includes(t1) && t1 === stackCommand) {
        return `${t0} ${t1}`;
      }
      // Bare case: first token === stackCommand.
      if (t0 === stackCommand) {
        return stackCommand;
      }
    }
  }
  // No fenced match — return null (caller falls back to the bare
  // command outside this helper).
  return null;
}
