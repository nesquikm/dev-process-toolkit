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

/**
 * STE-711 — the one comment the `settings-file` move leaves where it removed
 * the first matched shipped template block, and after a kept block that names
 * a moved heading or key.
 */
export const SETTINGS_COMMENT_POINTER = "<!-- Project settings live in specs/settings.yaml. Edit them there. -->";

/** One shipped v2.x template comment block, `<!--` through `-->`, byte for byte. */
export interface LegacyTemplateCommentBlock {
  /** Block text from the `<!--` line to the `-->` line, no trailing newline. */
  text: string;
  /** First release whose `templates/CLAUDE.md.template` shipped this text. */
  firstRelease: string;
  /** Last release that shipped it. */
  lastRelease: string;
  /** The release commit of `lastRelease`. */
  commit: string;
}

/**
 * STE-711 — the closed list of every distinct v2.x template comment block that
 * tells the user or the model to edit a section the `settings-file` move takes
 * out of CLAUDE.md: the Task Tracking, `milestone_scan_fetch`, Verification,
 * Orchestration, Docs, Token Stats and Release Files blocks. A CLAUDE.md block
 * matches only when byte-equal to an entry's `text`.
 */
export const LEGACY_TEMPLATE_COMMENT_BLOCKS: readonly LegacyTemplateCommentBlock[] = [
  {
    firstRelease: "2.0.0",
    lastRelease: "2.6.0",
    commit: "3fbeef2c",
    text: "<!--\n===============================================================================\nOptional: Task Tracking section (generated by `/setup` only when the user\nopts in to a tracker mode — linear / jira / custom). In `mode: none`\n(default) no such section is ever generated. Its absence is equivalent to\n`mode: none` for every mode-aware skill (Schema L, FR-29 AC-29.5, AC-29.6).\n\nDo NOT paste a literal `## Task Tracking` heading into this comment — the\nSchema L probe (`grep -c '^## Task Tracking$' CLAUDE.md`) cannot distinguish\ncommented from live headings and would report a false positive, breaking\nthe Pattern 9 `mode: none` backward-compat invariant.\n\nSchema L keys `/setup` emits:\n  - mode:            none | linear | jira | <custom>\n  - mcp_server:      MCP server name from `claude mcp list`\n  - jira_ac_field:   customfield_XXXXX (Jira only)\n  - branch_template: e.g. `{type}/m{N}-{slug}` (mode: none default)\n                     or `{type}/{ticket-id}-{slug}` (tracker-mode default).\n                     Absent `branch_template:` ⇒ `/implement` branch\n                     automation disabled. Edit to customize.\n\nFor the full live-section contract (keys, sync-log form, per-tracker\nquirks), see docs/tracker-adapters.md. `/setup` emits the section when a\ntracker mode is chosen; leaving this comment intact is purely a hint to\nhumans editing the file by hand.\n===============================================================================\n-->",
  },
  {
    firstRelease: "2.0.0",
    lastRelease: "2.99.2",
    commit: "aeb2f415",
    text: "<!--\n===============================================================================\nDocs section. `/setup` step 7d sets the flags; the\nsection is always emitted, even when all three default to `false`, so\n`/docs` and the `claudemd-docs-section-present` probe (gate-check #18)\nhave something to read. Flip any flag to `true` to opt in.\n\nKeys `/setup` emits:\n  - user_facing_mode:    true | false   (narrative + mermaid state/flow diagrams)\n  - packages_mode:       true | false   (packages-style API reference)\n  - changelog_ci_owned:  true | false   (if true, /ship-milestone will not write CHANGELOG.md)\n\nValues are lowercase literal `true`/`false` — no quoting, no `yes`/`no`.\n===============================================================================\n-->",
  },
  {
    firstRelease: "2.1.0",
    lastRelease: "2.80.0",
    commit: "bcfcebde",
    text: "<!--\n===============================================================================\nRelease Files section. `/ship-milestone` reads this block to drive the\nper-release version bump. `/setup` populates it from the per-stack default\nunder `examples/<stack>/release.yml`. Edit the block to match your project's\nactual layout — kind: regex is the universal escape hatch for free-form\npatterns (e.g., a non-standard README \"Latest:\" line).\n\nPer-entry keys:\n  - path:     repo-relative path\n  - kind:     json | toml | yaml | changelog | regex\n  - field:    dot-path (json/toml/yaml only) — e.g. version, project.version,\n              plugins[0].version\n  - pattern:  regex with named (?<version>...) group (regex only)\n  - replace:  template using {version} placeholder (regex only)\n  - optional: bool (default false) — missing path is `n/a`, not error\n\nFull schema + per-kind worked examples: docs/ship-milestone-reference.md.\n===============================================================================\n-->",
  },
  {
    firstRelease: "2.7.0",
    lastRelease: "2.47.0",
    commit: "be613f11",
    text: "<!--\n===============================================================================\nOptional: Task Tracking section (generated by `/setup` only when the user\nopts in to a tracker mode — linear / jira / custom). In `mode: none`\n(default) no such section is ever generated. Its absence is equivalent to\n`mode: none` for every mode-aware skill (Schema L, FR-29 AC-29.5, AC-29.6).\n\nDo NOT paste a literal `## Task Tracking` heading into this comment — the\nSchema L probe (`grep -c '^## Task Tracking$' CLAUDE.md`) cannot distinguish\ncommented from live headings and would report a false positive, breaking\nthe Pattern 9 `mode: none` backward-compat invariant.\n\nSchema L keys `/setup` emits:\n  - mode:            none | linear | jira | <custom>\n  - mcp_server:      MCP server name from `claude mcp list`\n  - jira_ac_field:   customfield_XXXXX (Jira only)\n  - branch_template: e.g. `{type}/m{N}-{slug}` (mode: none default)\n                     or `{type}/{ticket-id}-{slug}` (tracker-mode default).\n                     Absent `branch_template:` ⇒ `/implement` branch\n                     automation disabled. Edit to customize.\n                     **Trunk-OK allowlist:** types `chore`, `docs`, `ci`\n                     are permitted on trunk (no derived-branch enforcement);\n                     `feat`, `fix`, `refactor`, `perf` enforce a derived\n                     branch via the proposal flow.\n\nFor the full live-section contract (keys, sync-log form, per-tracker\nquirks), see docs/tracker-adapters.md. `/setup` emits the section when a\ntracker mode is chosen; leaving this comment intact is purely a hint to\nhumans editing the file by hand.\n===============================================================================\n-->",
  },
  {
    firstRelease: "2.33.0",
    lastRelease: "2.56.0",
    commit: "4b7f8dea",
    text: "<!--\n===============================================================================\nOptional: milestone_scan_fetch (default false; mode-agnostic).\n\n`/spec-write`'s milestone-number allocation guard runs a cross-branch scan\n(`scanBranchMilestones`) that unions `M<N>` plan files from every git ref\ninto the next-free-number calculation. By default the scan reads only\nalready-present refs (no network). Set the standalone line\n\n  milestone_scan_fetch: true\n\nto make the guard run a best-effort `git fetch --all --quiet` first, so\nmilestones that exist only on a not-yet-fetched remote ref are included.\nResolution precedence: `/spec-write --no-fetch` > `--fetch` >\n`milestone_scan_fetch` > built-in default `false`.\n\nThis knob is **mode-agnostic**: it is read whether or not a `## Task\nTracking` section exists (the cross-branch scan runs in both tracker and\n`mode: none` repos). It is NOT a `## Task Tracking` Schema-L key — keep it\nas its own top-level line; the `task-tracking-canonical-keys` gate-check\nprobe reserves the Task-Tracking closed set {mode, mcp_server,\njira_ac_field, branch_template}. Absent line ⇒ `false`.\n===============================================================================\n-->",
  },
  {
    firstRelease: "2.38.0",
    lastRelease: "2.69.0",
    commit: "02eed3d9",
    text: "<!--\n===============================================================================\nOptional: Verification section (project-authored verification skill).\nDeclares a check that `/implement` runs after gate checks pass. Absent\nsection ⇒ no check is declared. The key set is closed — exactly the two\nkeys shown; any other key inside the section is a config error.\n\nExample (indented so the heading stays commented; paste at column 0 to\nopt in):\n\n  ## Verification\n\n  verify_skill: visual-check\n  verify_mode: advisory\n\nKeys:\n  - verify_skill: slug of a project-local `.claude/skills/<name>` skill,\n                  or the literal `visual-check` (the toolkit's built-in\n                  web-UI check).\n  - verify_mode:  advisory | blocking | manual. Absent key ⇒ default\n                  `advisory` (report the outcome, never block the commit).\n===============================================================================\n-->",
  },
  {
    firstRelease: "2.44.0",
    lastRelease: "2.101.5",
    commit: "7c139fa0",
    text: "<!--\n===============================================================================\nToken Stats section. `/setup` step 7g sets the flag; the section is always\nemitted, even when it defaults to `false`, so the bundled token-stats hook and\nthe `readTokenStatsConfig` parser have something to read. Flip the flag to\n`true` to opt in to per-skill token-usage stats. The top-level key set is\nclosed — exactly the one key shown; any other key inside the section is a\nconfig error. Absent section ⇒ OFF (existing projects stay off until they\nre-run `/setup`).\n\nKeys `/setup` emits:\n  - enabled:  true | false   (default false — per-skill token-usage capture + render)\n\nValues are lowercase literal `true`/`false` — no quoting, no `yes`/`no`.\n===============================================================================\n-->",
  },
  {
    firstRelease: "2.48.0",
    lastRelease: "2.48.0",
    commit: "7f25a891",
    text: "<!--\n===============================================================================\nOptional: Task Tracking section (generated by `/setup` only when the user\nopts in to a tracker mode — linear / jira / custom). In `mode: none`\n(default) no such section is ever generated. Its absence is equivalent to\n`mode: none` for every mode-aware skill (Schema L, FR-29 AC-29.5, AC-29.6).\n\nDo NOT paste a literal `## Task Tracking` heading into this comment — the\nSchema L probe (`grep -c '^## Task Tracking$' CLAUDE.md`) cannot distinguish\ncommented from live headings and would report a false positive, breaking\nthe Pattern 9 `mode: none` backward-compat invariant.\n\nSchema L keys `/setup` emits:\n  - mode:            none | linear | jira | <custom>\n  - mcp_server:      MCP server name from `claude mcp list`\n  - jira_ac_field:   customfield_XXXXX (Jira only)\n  - branch_template: e.g. `{type}/m{N}-{slug}` — the single seeded\n                     default in every mode. Customizable; e.g.\n                     `{type}/{ticket-id}-{slug}` keys on the ticket.\n                     Absent `branch_template:` ⇒ `/implement` branch\n                     automation disabled. Edit to customize.\n                     **Trunk-OK allowlist:** types `chore`, `docs`, `ci`\n                     are permitted on trunk (no derived-branch enforcement);\n                     `feat`, `fix`, `refactor`, `perf` enforce a derived\n                     branch via the proposal flow.\n\nFor the full live-section contract (keys, sync-log form, per-tracker\nquirks), see docs/tracker-adapters.md. `/setup` emits the section when a\ntracker mode is chosen; leaving this comment intact is purely a hint to\nhumans editing the file by hand.\n===============================================================================\n-->",
  },
  {
    firstRelease: "2.48.1",
    lastRelease: "2.80.3",
    commit: "5e64fe83",
    text: "<!--\n===============================================================================\nOptional: Task Tracking section (generated by `/setup` only when the user\nopts in to a tracker mode — linear / jira / custom). In `mode: none`\n(default) no such section is ever generated. Its absence is equivalent to\n`mode: none` for every mode-aware skill (Schema L, FR-29 AC-29.5, AC-29.6).\n\nDo NOT paste a literal `## Task Tracking` heading into this comment — the\nSchema L probe (`grep -c '^## Task Tracking$' CLAUDE.md`) cannot distinguish\ncommented from live headings and would report a false positive, breaking\nthe Pattern 9 `mode: none` backward-compat invariant.\n\nSchema L keys `/setup` emits:\n  - mode:            none | linear | jira | <custom>\n  - mcp_server:      MCP server name from `claude mcp list`\n  - jira_ac_field:   customfield_XXXXX (Jira only)\n  - branch_template: e.g. `{type}/m{N}-{slug}` — the single seeded\n                     default in every mode. Customizable; e.g.\n                     `{type}/{ticket-id}-{slug}` keys on the ticket.\n                     Absent `branch_template:` ⇒ `/implement` branch\n                     automation disabled. Edit to customize.\n                     **Trunk-OK allowlist:** only type `ci` is permitted\n                     on trunk (no derived-branch enforcement); every other\n                     type (`feat`, `fix`, `chore`, `docs`, `refactor`,\n                     `perf`, ...) enforces a derived branch via the\n                     proposal flow.\n\nFor the full live-section contract (keys, sync-log form, per-tracker\nquirks), see docs/tracker-adapters.md. `/setup` emits the section when a\ntracker mode is chosen; leaving this comment intact is purely a hint to\nhumans editing the file by hand.\n===============================================================================\n-->",
  },
  {
    firstRelease: "2.56.1",
    lastRelease: "2.101.5",
    commit: "7c139fa0",
    text: "<!--\n===============================================================================\nOptional: milestone_scan_fetch (default false; Linear only in practice).\n\n`/spec-write`'s milestone-number allocation guard runs a cross-branch scan\n(`scanBranchMilestones`) that unions `M<N>` plan files from every git ref\ninto the next-free-number calculation. By default the scan reads only\nalready-present refs (no network). Set the standalone line\n\n  milestone_scan_fetch: true\n\nto make the guard run a best-effort `git fetch --all --quiet` first, so\nmilestones that exist only on a not-yet-fetched remote ref are included.\nResolution precedence: `/spec-write --no-fetch` > `--fetch` >\n`milestone_scan_fetch` > built-in default `false`.\n\nThe knob is **read** whether or not a `## Task Tracking` section exists, but\nit only has an EFFECT where the cross-branch scan actually runs. Jira derives\nits milestone id from the Epic key and `mode: none` mints an opaque\n`M_<short-ULID>`; both bypass the scan entirely, so on those two paths this\nline — and `--fetch` / `--no-fetch` — is inert. Linear is the one mode where\nit changes anything. It is NOT a `## Task Tracking` Schema-L key — keep it\nas its own top-level line; the `task-tracking-canonical-keys` gate-check\nprobe reserves the Task-Tracking closed set {mode, mcp_server,\njira_ac_field, branch_template}. Absent line ⇒ `false`.\n===============================================================================\n-->",
  },
  {
    firstRelease: "2.63.0",
    lastRelease: "2.101.5",
    commit: "7c139fa0",
    text: "<!--\n===============================================================================\nOptional: Orchestration section. Absent section ≡ defaults — existing\nprojects need not add it and no migration is required. The key set is\nclosed — exactly the two keys shown; any other key inside the section is\na config error.\n\nExample (indented so the heading stays commented; paste at column 0 to\nopt in):\n\n  ## Orchestration\n\n  default_effort: ultracode\n  merge_policy: offer\n\nKeys:\n  - default_effort: low | medium | high | xhigh | max | ultracode.\n                    Absent key ⇒ default `ultracode`.\n  - merge_policy:   offer | auto | never. Absent key ⇒ default `offer`\n                    (`auto` is never inferred — it must be the literal\n                    lowercase line).\n\nValues are lowercase literals — no quoting, no case variants.\n===============================================================================\n-->",
  },
  {
    firstRelease: "2.70.0",
    lastRelease: "2.101.5",
    commit: "7c139fa0",
    text: "<!--\n===============================================================================\nOptional: Verification section (project-authored verification skill).\nDeclares a check that `/implement` runs after gate checks pass. Absent\nsection ⇒ no check is declared. The key set is closed — exactly the four\nkeys shown; any other key inside the section is a config error.\n\nExample (indented so the heading stays commented; paste at column 0 to\nopt in):\n\n  ## Verification\n\n  verify_skill: visual-check\n  verify_mode: advisory\n  run_cmd: bun run dev\n  e2e_cmd: bun run test:e2e\n\nKeys:\n  - verify_skill: slug of a project-local `.claude/skills/<name>` skill,\n                  or the literal `visual-check` (the toolkit's built-in\n                  web-UI check).\n  - verify_mode:  advisory | blocking | manual. A written value always\n                  wins. Absent key ⇒ the effective mode is resolved from\n                  `run_cmd`: `blocking` when `run_cmd` declares a real\n                  command (a failing check blocks the commit), `advisory`\n                  when `run_cmd` is `none`, empty, or absent (report the\n                  outcome, never block the commit).\n  - run_cmd:      declares how this project is run. Write `run_cmd: none`\n                  to declare that it cannot be run — `none` is an answer,\n                  distinct from an absent key, which is no answer at all.\n  - e2e_cmd:      declares how this project's end-to-end suite is invoked,\n                  under the same convention — `e2e_cmd: none` answers \"no\n                  e2e suite\", an absent key answers nothing.\n\nA section declaring only verify_skill and verify_mode keeps exactly its\nprevious behaviour; the newer keys are simply undeclared.\n===============================================================================\n-->",
  },
  {
    firstRelease: "2.80.1",
    lastRelease: "2.80.3",
    commit: "5e64fe83",
    text: "<!--\n===============================================================================\nRelease Files section. `/ship-milestone` reads this block to drive the\nper-release version bump. `/setup` populates it from the per-stack default\nunder `examples/<stack>/release.yml`. Edit the block to match your project's\nactual layout — kind: regex is the universal escape hatch for free-form\npatterns (e.g., a non-standard README \"Latest:\" line).\n\nPer-entry keys:\n  - path:     repo-relative path\n  - kind:     json | toml | yaml | changelog | regex\n  - field:    dot-path (json/toml/yaml only) — e.g. version, project.version,\n              plugins[0].version\n  - pattern:  regex with named (?<version>...) group (regex only). Every\n              occurrence the pattern matches is rewritten, not just the first.\n  - replace:  template using {version} and {codename} placeholders (regex\n              only). The template is written LITERALLY — `$&`, `$1` and\n              friends land as those characters. Naming {codename} when the\n              release supplies none is refused, never written as the literal\n              placeholder.\n  - optional: bool (default false) — a missing path is `n/a`, not an error,\n              and so is a pattern that matches nothing. A NON-optional entry\n              still refuses on both.\n\nFull schema + per-kind worked examples: docs/ship-milestone-reference.md.\n===============================================================================\n-->",
  },
  {
    firstRelease: "2.80.4",
    lastRelease: "2.89.0",
    commit: "07f19d3c",
    text: "<!--\n===============================================================================\nOptional: Task Tracking section (generated by `/setup` only when the user\nopts in to a tracker mode — linear / jira / custom). In `mode: none`\n(default) no such section is ever generated. Its absence is equivalent to\n`mode: none` for every mode-aware skill (Schema L, FR-29 AC-29.5, AC-29.6).\n\nDo NOT paste a literal `## Task Tracking` heading into this comment — the\nSchema L probe (`grep -c '^## Task Tracking$' CLAUDE.md`) cannot distinguish\ncommented from live headings and would report a false positive, breaking\nthe Pattern 9 `mode: none` backward-compat invariant.\n\nSchema L keys `/setup` emits:\n  - mode:            none | linear | jira | <custom>\n  - mcp_server:      MCP server name from `claude mcp list`\n  - jira_ac_field:   customfield_XXXXX (Jira only)\n  - branch_template: e.g. `{type}/m{N}-{slug}` — the single seeded\n                     default in every mode. Customizable; e.g.\n                     `{type}/{ticket-id}-{slug}` keys on the ticket.\n                     Absent `branch_template:` ⇒ `/implement` branch\n                     automation disabled. Edit to customize.\n                     **Trunk-OK allowlist:** only type `ci` is permitted\n                     on trunk (no derived-branch enforcement); every other\n                     type (`feat`, `fix`, `chore`, `docs`, `refactor`,\n                     `perf`, ...) enforces a derived branch via the\n                     proposal flow.\n\nIn tracker mode `/setup` ALSO emits a populated workspace-binding\nsub-section under `## Task Tracking`, and `/gate-check` probe #25\n(`task-tracking-workspace-binding-present`) hard-fails without it — a\nmissing sub-section, a missing key, or an empty value all fail:\n\n  ### Linear        team: <team-name>       project: <project-name>\n  ### Jira          project: <PROJECT-KEY>\n\nThe probe exists because tickets created without `project` silently\nlanded on the wrong board. A `## Task Tracking` section hand-written\nfrom the key list above ALONE will fail its first gate; the sub-section\nis not optional. See docs/patterns.md § Schema L Workspace binding\nsub-sections for the full contract.\n\nFor the rest of the live-section contract (sync-log form, per-tracker\nquirks), see docs/tracker-adapters.md. `/setup` emits the section when a\ntracker mode is chosen; leaving this comment intact is purely a hint to\nhumans editing the file by hand.\n===============================================================================\n-->",
  },
  {
    firstRelease: "2.80.4",
    lastRelease: "2.101.5",
    commit: "7c139fa0",
    text: "<!--\n===============================================================================\nRelease Files section. `/ship-milestone` reads this block to drive the\nper-release version bump. `/setup` populates it from the per-stack default\nunder `examples/<stack>/release.yml`. Edit the block to match your project's\nactual layout — kind: regex is the universal escape hatch for free-form\npatterns (e.g., a non-standard README \"Latest:\" line).\n\nPer-entry keys:\n  - path:     repo-relative path\n  - kind:     json | toml | yaml | changelog | regex\n  - field:    per-kind, and NOT interchangeable (measured against the parser):\n              json — any dot-path, array index included:\n                     version | package.version | plugins[0].version\n              toml — top-level or one-level-dotted only:\n                     version | project.version   (plugins[0].version throws at\n                     bump time: \"bumpToml: could not find [plugins[0]].version\")\n              yaml — top-level scalar only, NO dots:\n                     version                     (project.version is REFUSED at\n                     parse time: \"yaml kind only supports top-level fields\")\n  - pattern:  regex with named (?<version>...) group (regex only). Every\n              occurrence the pattern matches is rewritten, not just the first.\n  - replace:  template using {version} and {codename} placeholders (regex\n              only). The template is written LITERALLY — `$&`, `$1` and\n              friends land as those characters. Naming {codename} when the\n              release supplies none is refused, never written as the literal\n              placeholder.\n  - optional: bool (default false) — a missing path is `n/a`, not an error,\n              and so is a pattern that matches nothing. A NON-optional entry\n              still refuses on both.\n\nFull schema + per-kind worked examples: docs/ship-milestone-reference.md.\n===============================================================================\n-->",
  },
  {
    firstRelease: "2.90.0",
    lastRelease: "2.101.5",
    commit: "7c139fa0",
    text: "<!--\n===============================================================================\nOptional: Task Tracking section (generated by `/setup` only when the user\nopts in to a tracker mode — linear / jira / custom). In `mode: none`\n(default) no such section is ever generated. Its absence is equivalent to\n`mode: none` for every mode-aware skill (Schema L, FR-29 AC-29.5, AC-29.6).\n\nDo NOT paste a literal `## Task Tracking` heading into this comment — the\nSchema L probe (`grep -c '^## Task Tracking$' CLAUDE.md`) cannot distinguish\ncommented from live headings and would report a false positive, breaking\nthe Pattern 9 `mode: none` backward-compat invariant.\n\nSchema L keys `/setup` emits:\n  - mode:            none | linear | jira | <custom>\n  - mcp_server:      MCP server name from `claude mcp list`\n  - jira_ac_field:   customfield_XXXXX (Jira only)\n  - branch_template: e.g. `{type}/m{N}-{slug}` — the single seeded\n                     default in every mode. Customizable; e.g.\n                     `{type}/{ticket-id}-{slug}` keys on the ticket.\n                     Absent `branch_template:` ⇒ `/implement` branch\n                     automation disabled. Edit to customize.\n                     **Trunk-OK allowlist:** only type `ci` is permitted\n                     on trunk (no derived-branch enforcement); every other\n                     type (`feat`, `fix`, `chore`, `docs`, `refactor`,\n                     `perf`, ...) enforces a derived branch via the\n                     proposal flow.\n\nIn tracker mode `/setup` ALSO emits a populated workspace-binding\nsub-section under `## Task Tracking`, and `/gate-check` probe #25\n(`task-tracking-workspace-binding-present`) hard-fails without it — a\nmissing sub-section, a missing key, or an empty value all fail:\n\n  ### Linear        team: <team-key>        project: <project-name>\n  ### Jira          project: <PROJECT-KEY>\n\nThe probe exists because tickets created without `project` silently\nlanded on the wrong board. A `## Task Tracking` section hand-written\nfrom the key list above ALONE will fail its first gate; the sub-section\nis not optional. See docs/patterns.md § Schema L Workspace binding\nsub-sections for the full contract.\n\nFor the rest of the live-section contract (sync-log form, per-tracker\nquirks), see docs/tracker-adapters.md. `/setup` emits the section when a\ntracker mode is chosen; leaving this comment intact is purely a hint to\nhumans editing the file by hand.\n===============================================================================\n-->",
  },
  {
    firstRelease: "2.100.0",
    lastRelease: "2.100.0",
    commit: "107324aa",
    text: "<!--\n===============================================================================\nDocs section. `/setup` step 7d sets the flags; the\nsection is always emitted, even when all three default to `false`, so\n`/docs` and the `claudemd-docs-section-present` probe (gate-check #18)\nhave something to read. Flip any flag to `true` to opt in.\n\nKeys `/setup` emits:\n  - user_facing_mode:    true | false   (narrative + mermaid state/flow diagrams)\n  - packages_mode:       true | false   (packages-style API reference)\n  - changelog_ci_owned:  true | false   (if true, /ship-milestone will not write CHANGELOG.md)\n  - changelog_unversioned: true | false (if true, /ship-milestone writes no version: entries go under ## [Unreleased]; default false)\n\nValues are lowercase literal `true`/`false` — no quoting, no `yes`/`no`.\n===============================================================================\n-->",
  },
  {
    firstRelease: "2.100.1",
    lastRelease: "2.101.5",
    commit: "7c139fa0",
    text: "<!--\n===============================================================================\nDocs section. `/setup` step 7d sets the flags; the\nsection is always emitted, even when all three default to `false`, so\n`/docs` and the `claudemd-docs-section-present` probe (gate-check #18)\nhave something to read. Flip any flag to `true` to opt in.\n\nKeys `/setup` emits:\n  - user_facing_mode:    true | false   (narrative + mermaid state/flow diagrams)\n  - packages_mode:       true | false   (packages-style API reference)\n  - changelog_ci_owned:  true | false   (if true, /ship-milestone will not write CHANGELOG.md)\n\nOptional key, not emitted: changelog_unversioned: true | false (default false;\nabsent reads false). Add it by hand when git tags or CI own the version;\nif true, /ship-milestone writes no version: entries go under ## [Unreleased].\n\nValues are lowercase literal `true`/`false` — no quoting, no `yes`/`no`.\n===============================================================================\n-->",
  },
];
