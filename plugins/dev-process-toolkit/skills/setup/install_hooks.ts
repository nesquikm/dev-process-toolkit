// `/setup` hook installer + merge helper (STE-285 AC-STE-285.3).
//
// Selected hooks are written into the user's `.claude/settings.json` via
// key-level merge — existing entries are preserved. Each plugin hook
// uses exec form:
//
//   { "type": "command", "command": "bash",
//     "args": ["<plugin-root>/templates/hooks/process/<name>.sh"],
//     "timeout": 5000 }
//
// Conflict resolution (per STE-133):
//   - same matcher + identical command  → no-op (idempotent re-run)
//   - same matcher + different command  → conflict surfaced to caller
//     (the skill prose handles the diff + prompt UX)
//
// Settings shape (Claude Code hooks v1):
//
//   { "hooks": { "<EventName>": [
//       { "matcher": "<Matcher>",
//         "hooks": [{ "type": "command", "command": "bash",
//                     "args": [...], "timeout"?: number }, ...] },
//       ...
//   ] } }

import { readFileSync, writeFileSync } from "node:fs";

// ----- Constants -----

/**
 * Literal prefix written into / read out of `args[0]` for every plugin
 * hook entry. STE-288: the `${CLAUDE_PLUGIN_ROOT}` token is left
 * un-expanded in settings.json on purpose — Claude Code resolves it at
 * hook-dispatch time, which keeps the file portable across clones.
 */
const HOOK_ARGS_PREFIX = "${CLAUDE_PLUGIN_ROOT}/templates/hooks/process/";

// ----- Types -----

export type HookEntryCommand = {
  type: "command";
  command: string;
  args?: string[];
  timeout?: number;
};

export type MatcherEntry = {
  matcher: string;
  hooks: HookEntryCommand[];
};

export type HooksByEvent = Record<string, MatcherEntry[] | undefined>;

export type Settings = {
  hooks?: HooksByEvent;
  // Other settings keys are preserved as-is.
  [extra: string]: unknown;
};

/** A single addition: event + matcher + the hook descriptor to install. */
export type HookAddition = {
  event: string;
  matcher: string;
  hook: HookEntryCommand;
};

/** Conflict surfaced when same matcher carries a different command. */
export type HookConflict = {
  event: string;
  matcher: string;
  existingCommand: string;
  proposedCommand: string;
};

export type MergeResult = {
  merged: Settings;
  conflicts: HookConflict[];
};

// ----- Internals -----

/**
 * Extract the script basename (e.g. `pre-commit-gate-check.sh`) from a
 * hook command. The basename is the conflict-identity for "same hook"
 * detection — a user-vendored copy at a different path still represents
 * the same logical hook.
 */
function scriptBasename(hook: HookEntryCommand): string | null {
  const first = hook.args?.[0];
  if (!first) return null;
  const slash = first.lastIndexOf("/");
  return slash === -1 ? first : first.slice(slash + 1);
}

/**
 * Render a hook command as a single string for diff display in the
 * conflict prompt. Format mirrors what the user sees in settings.json.
 */
function renderCommand(hook: HookEntryCommand): string {
  const cmd = hook.command;
  const args = (hook.args ?? []).join(" ");
  return args ? `${cmd} ${args}` : cmd;
}

/** Deep clone via JSON round-trip — settings are pure data. */
function cloneSettings(s: Settings): Settings {
  return JSON.parse(JSON.stringify(s)) as Settings;
}

// ----- Public API -----

/**
 * Key-level merge of `additions` into `existing`. Existing entries
 * (unrelated event keys, unrelated matchers, unrelated commands under
 * the same matcher) are preserved verbatim.
 *
 * For each addition:
 *   - if the matcher does not yet exist for that event → create it,
 *     append the addition's hook;
 *   - if the matcher exists and already carries a hook with the SAME
 *     script basename and SAME args[0] → no-op (idempotent);
 *   - if the matcher exists and carries a hook with the SAME script
 *     basename but a DIFFERENT args[0] → conflict surfaced (no write);
 *   - otherwise → append the addition's hook alongside.
 */
export function mergeHooksIntoSettings(
  existing: Settings,
  additions: HookAddition[],
): MergeResult {
  const merged = cloneSettings(existing);
  if (!merged.hooks) merged.hooks = {};
  const conflicts: HookConflict[] = [];

  for (const addition of additions) {
    const { event, matcher, hook } = addition;
    const proposedBase = scriptBasename(hook);
    const proposedFirstArg = hook.args?.[0] ?? "";

    const list: MatcherEntry[] = merged.hooks[event] ?? [];
    if (!merged.hooks[event]) merged.hooks[event] = list;

    // Locate any matcher entry that matches this addition's matcher.
    const matcherEntry = list.find((e) => e.matcher === matcher);

    if (!matcherEntry) {
      // New matcher → create with the proposed hook.
      list.push({ matcher, hooks: [hook] });
      continue;
    }

    // Same matcher already exists. Check for a hook with the same
    // script basename.
    const twin = matcherEntry.hooks.find(
      (h) => scriptBasename(h) === proposedBase && proposedBase !== null,
    );

    if (!twin) {
      // Same matcher, different basename → append alongside.
      matcherEntry.hooks.push(hook);
      continue;
    }

    const twinFirstArg = twin.args?.[0] ?? "";

    if (twinFirstArg === proposedFirstArg) {
      // Idempotent — already installed, no-op.
      continue;
    }

    // Same basename, different args[0] → conflict.
    conflicts.push({
      event,
      matcher,
      existingCommand: renderCommand(twin),
      proposedCommand: renderCommand(hook),
    });
  }

  return { merged, conflicts };
}

/**
 * Per-hook event + matcher mapping for seeded plugin hooks. Hooks fire on
 * different Claude Code events — three on PreToolUse Bash (gating
 * `git commit` / `gh pr create`), one on UserPromptSubmit `*` (the
 * spec-write greenfield reminder). Misregistering a hook under the wrong
 * event silently no-ops it because Claude Code never dispatches it.
 *
 * Add a row here when seeding a new hook script under
 * `templates/hooks/process/`; unmapped names fall back to PreToolUse Bash.
 */
const HOOK_REGISTRATIONS: Record<string, { event: string; matcher: string }> = {
  "pre-commit-gate-check": { event: "PreToolUse", matcher: "Bash" },
  "pre-pr-spec-review": { event: "PreToolUse", matcher: "Bash" },
  "pre-spec-write-brainstorm-reminder": {
    event: "UserPromptSubmit",
    matcher: "*",
  },
  "pre-commit-tdd-orchestrator": { event: "PreToolUse", matcher: "Bash" },
};

/**
 * Build a HookAddition for one named plugin hook. Event + matcher come
 * from `HOOK_REGISTRATIONS`; the command is always exec form
 * `bash ${CLAUDE_PLUGIN_ROOT}/templates/hooks/process/<name>.sh` with a
 * 5000 ms timeout.
 *
 * STE-288: `args[0]` carries the LITERAL `${CLAUDE_PLUGIN_ROOT}` token —
 * Claude Code expands it at hook-dispatch time to the actual plugin root
 * on the user's machine. Writing the absolute pluginRoot path into
 * settings.json (the pre-STE-288 behavior) made the file non-portable
 * across clones and broke the smoke fixture-group-8 doc-conformance
 * assertion. The `pluginRoot` parameter is kept on the signature for
 * backward source-compat with existing callers, but is unused on the
 * write path.
 */
export function additionFor(name: string, pluginRoot: string): HookAddition {
  // pluginRoot retained for backward source-compat with existing callers
  // (e.g., installHooks) but intentionally unused on the write path; the
  // literal `${CLAUDE_PLUGIN_ROOT}` token below is what gets persisted.
  void pluginRoot;
  const reg = HOOK_REGISTRATIONS[name] ?? { event: "PreToolUse", matcher: "Bash" };
  return {
    event: reg.event,
    matcher: reg.matcher,
    hook: {
      type: "command",
      command: "bash",
      args: [`${HOOK_ARGS_PREFIX}${name}.sh`],
      timeout: 5000,
    },
  };
}

/**
 * Parse the `--hooks=<value>` non-interactive preselect flag value
 * (STE-286 AC-STE-286.1). Two forms:
 *
 *   parsePreselectFlag("all")
 *     → { all: true, names: [<all 4 names from HOOK_REGISTRATIONS>] }
 *
 *   parsePreselectFlag("pre-commit-gate-check,pre-pr-spec-review")
 *     → { all: false, names: ["pre-commit-gate-check", "pre-pr-spec-review"] }
 *
 * Surrounding whitespace per comma-separated entry is tolerated. Unknown
 * hook names are refused with an NFR-10-shaped error whose message
 * contains "Refusing:" + "unknown hook" + the offending name + at least
 * one known name (so the caller can recover from a typo). The first
 * unknown name in the list short-circuits the parse.
 */
export function parsePreselectFlag(arg: string): {
  all: boolean;
  names: string[];
} {
  const known = Object.keys(HOOK_REGISTRATIONS);
  const trimmed = arg.trim();
  if (trimmed === "all") {
    return { all: true, names: [...known] };
  }
  const names = trimmed
    .split(",")
    .map((n) => n.trim())
    .filter((n) => n.length > 0);
  if (names.length === 0) {
    throw new Error(
      `Refusing: --hooks=<value> requires a non-empty value (use "all" or a comma-separated list of known hook names). Known hooks: ${known.join(", ")}.`,
    );
  }
  for (const name of names) {
    if (!(name in HOOK_REGISTRATIONS)) {
      throw new Error(
        `Refusing: unknown hook "${name}". Known hooks: ${known.join(", ")}.`,
      );
    }
  }
  return { all: false, names };
}

/**
 * Read `settingsPath`, merge the named plugin hooks via
 * `mergeHooksIntoSettings`, and write the result back. Returns the
 * MergeResult so the caller can surface any conflicts.
 *
 * Partial-write semantics: when `result.conflicts` is non-empty, the
 * conflicting hook entries are NEVER added to the merged tree (the merge
 * loop excludes them). The on-disk write reflects the non-conflicting
 * subset only — no entry the caller has not already approved is silently
 * overwritten. The SKILL.md prose is expected to surface the conflicts
 * (diff + prompt per STE-133) and re-invoke with a resolution.
 *
 * If `settingsPath` is missing, treats existing settings as `{}`. A
 * malformed (non-JSON) existing file aborts the call by throwing a
 * SyntaxError — never silently overwritten.
 */
export function installHooks(
  settingsPath: string,
  hookNames: string[],
  pluginRoot: string,
): MergeResult {
  let existing: Settings = {};
  let raw: string | null = null;
  try {
    raw = readFileSync(settingsPath, "utf-8");
  } catch {
    // Missing file → treat as empty. The caller wrote the file path
    // explicitly; we don't need to materialize directories here.
    raw = null;
  }
  if (raw !== null && raw.trim().length > 0) {
    // Malformed JSON surfaces as SyntaxError — caller maps to NFR-10.
    existing = JSON.parse(raw) as Settings;
  }

  const additions = hookNames.map((n) => additionFor(n, pluginRoot));
  const result = mergeHooksIntoSettings(existing, additions);

  writeFileSync(settingsPath, JSON.stringify(result.merged, null, 2));
  return result;
}

/**
 * Return the list of plugin hook names currently installed in
 * `settingsPath` (i.e. entries whose `args[0]` starts with the literal
 * `${CLAUDE_PLUGIN_ROOT}/templates/hooks/process/` prefix and ends in
 * `.sh`).
 *
 * Used by `/setup --hooks` to pre-check the menu options on re-run.
 * Missing settings.json → empty array.
 *
 * STE-288: `pluginRoot` is retained on the signature for backward
 * source-compat with existing callers but is intentionally unused — the
 * literal `${CLAUDE_PLUGIN_ROOT}` token is the prefix we match against
 * (see `HOOK_ARGS_PREFIX`).
 */
export function readInstalledHookNames(
  settingsPath: string,
  pluginRoot: string,
): string[] {
  void pluginRoot;
  let raw: string;
  try {
    raw = readFileSync(settingsPath, "utf-8");
  } catch {
    return [];
  }
  let parsed: Settings;
  try {
    parsed = JSON.parse(raw) as Settings;
  } catch {
    return [];
  }
  const events = parsed.hooks ?? {};
  const names = new Set<string>();
  for (const matcherList of Object.values(events)) {
    for (const entry of matcherList ?? []) {
      for (const hook of entry.hooks ?? []) {
        const first = hook.args?.[0];
        if (!first) continue;
        if (!first.startsWith(HOOK_ARGS_PREFIX)) continue;
        const tail = first.slice(HOOK_ARGS_PREFIX.length);
        if (!tail.endsWith(".sh")) continue;
        names.add(tail.slice(0, -3));
      }
    }
  }
  return [...names];
}
