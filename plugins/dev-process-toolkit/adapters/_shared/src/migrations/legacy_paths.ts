// M108 STE-391 AC-STE-391.1 — retired-path single source of truth.
//
// The retired-path twin of `dpt_paths.ts`: where that module is the sole
// composer of every LIVE `.dpt` path literal, this one is the sole non-test
// composer of the RETIRED literals the migration registry detects and heals.
// No other non-test file may compose these strings — the registry's own
// meta-test walks `migrations/` proving it, and the STE-384 path-drift gate
// carries a scoped carve-out for exactly this file (AC-STE-391.8).
//
// Pure path/shape composition — no I/O, no existence checks — mirroring
// `dpt_paths.ts`. Detectors that need the filesystem own their own reads.

import { join } from "node:path";

/**
 * Pre-M104 tracked plan-lock folder, legacy since v2.46.0 (STE-382):
 * `<projectRoot>/.dpt-locks`. Superseded by `.dpt/locks/`.
 */
export function legacyLocksDir(projectRoot: string): string {
  return join(projectRoot, ".dpt-locks");
}

/**
 * Pre-M104 git-ignored token-ledger folder, legacy since v2.46.0 (STE-383):
 * `<projectRoot>/.dev-process`. Superseded by `.dpt/ledger/`.
 */
export function legacyLedgerDir(projectRoot: string): string {
  return join(projectRoot, ".dev-process");
}

/**
 * The stale line the pre-M104 setup (STE-344 AC.5) appended to the consumer's
 * ROOT `.gitignore` to hide the legacy ledger folder. v2.46.0 moved ignore
 * ownership to the committed nested `.dpt/.gitignore`.
 */
export const LEGACY_ROOT_GITIGNORE_LINE = ".dev-process/";

/**
 * v1-era layout marker, dead since v1.20.0 (STE-56):
 * `<projectRoot>/specs/.dpt-layout`.
 */
export function legacyLayoutMarker(projectRoot: string): string {
  return join(projectRoot, "specs", ".dpt-layout");
}

/**
 * v1-era generated spec index, dead since v1.20.0 (STE-57):
 * `<projectRoot>/specs/INDEX.md`.
 */
export function legacySpecsIndex(projectRoot: string): string {
  return join(projectRoot, "specs", "INDEX.md");
}

/**
 * Dead CLAUDE.md subsection heading under `## Task Tracking`, parser-ignored
 * since v1.20.0 (STE-58): `### Sync log`.
 */
export const LEGACY_SYNC_LOG_HEADING = "### Sync log";

/**
 * Stale v2.21-era hook-script folder inside the plugin tree: the retired
 * `/setup --hooks` installer (v2.21.0–v2.22.1, STE-285/STE-288) wrote
 * `.claude/settings.json` hook entries whose `args` pointed at scripts under
 * it; the plugin-bundled hooks.json (v2.22.2, STE-289) superseded them.
 *
 * Only the SUFFIX identifies a dead entry, because the prefix in front of this
 * fragment differs across the two shipped shapes: v2.22.1 wrote the literal
 * `${CLAUDE_PLUGIN_ROOT}` token, while v2.21.0 pinned the absolute path of the
 * installing clone. See `isLegacyHookScriptRef`.
 */
export const LEGACY_HOOK_DIR_FRAGMENT = "templates/hooks/process/";

/** The four hook scripts the retired v2.21-era installer registered. */
export const LEGACY_HOOK_SCRIPT_NAMES = [
  "pre-commit-gate-check.sh",
  "pre-pr-spec-review.sh",
  "pre-commit-tdd-orchestrator.sh",
  "pre-spec-write-brainstorm-reminder.sh",
] as const;

/**
 * Does a hook entry's `command`/`args` string point at one of the four retired
 * installer-era scripts? Prefix-agnostic, so it catches both shipped shapes
 * (see `LEGACY_HOOK_DIR_FRAGMENT`) — and, by the same token, spares the blessed
 * override recipe from `docs/hooks-reference.md`, which snapshot-copies a
 * script to `.claude/hooks/<script>.sh`: that path drops the folder fragment,
 * so an operator's own copy never matches.
 */
export function isLegacyHookScriptRef(value: string): boolean {
  return LEGACY_HOOK_SCRIPT_NAMES.some((script) =>
    value.includes(`${LEGACY_HOOK_DIR_FRAGMENT}${script}`),
  );
}

/**
 * The retired glob-shaped `permissions.allow` rule, dead since v2.7.0
 * (STE-209): `Bash(<cmd> *)`. The harness denies any glob-shaped Bash rule when
 * `/setup` writes settings.json on a fresh repo, so v2.7.0 replaced the shape
 * with explicit-subcommand allowlists.
 *
 * Written as a pattern rather than as sample strings on purpose: spelling out a
 * literal `Bash(<cmd> *)` here would plant the very shape the toolkit's own
 * hygiene probes scan for. The capture group is the globbed command prefix.
 */
export const LEGACY_GLOB_BASH_RULE = /^Bash\(([^)]*)\s\*\)$/;

/** Is this allow-rule the retired v2.7.0 glob shape? */
export function isLegacyGlobBashRule(rule: string): boolean {
  return LEGACY_GLOB_BASH_RULE.test(rule);
}

/**
 * The command a retired glob rule globbed over (`Bash(bun *)` → `bun`), or null
 * when the rule is not the retired shape. This is the key the replacement
 * allowlist is projected against.
 */
export function legacyGlobBashCommand(rule: string): string | null {
  const match = rule.match(LEGACY_GLOB_BASH_RULE);
  if (match === null) return null;
  const command = match[1]!.trim();
  return command.length > 0 ? command : null;
}

/**
 * The retired `.mcp.json` server key, dead since v2.7.0 (STE-209 F6): the
 * toolkit's docs shipped remote servers as `{"transport": "streamable-http"}`,
 * a field name that appears nowhere in Claude Code's MCP schema — `/doctor`
 * rejects the entry outright. The canonical shape is `{"type": "http"}`, which
 * is live config and therefore lives with the entry that writes it, not here.
 */
export const LEGACY_MCP_TRANSPORT_KEY = "transport";
