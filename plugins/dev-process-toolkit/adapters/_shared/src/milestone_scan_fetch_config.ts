// milestone_scan_fetch_config — the deterministic reader for the one
// documented CLAUDE.md key that never had one (STE-569 AC-STE-569.13).
//
// `templates/CLAUDE.md.template` documents `milestone_scan_fetch: true` as a
// standalone top-level line with a four-way resolution precedence, exactly as
// it documents `user_facing_mode`, `verify_skill`, `merge_policy`,
// `branch_template` and the `## Release Files` block. Every one of those has a
// named reader module — `readDocsConfig`, `readVerificationConfig`,
// `readOrchestrationConfig`, `readWorkspaceBinding`, `parseReleaseFiles`. This
// one had none: it appeared in zero adapter modules and its only consumer was
// LLM prose in `skills/spec-write/SKILL.md`.
//
// That is not a false statement about behaviour — the skill really does read
// it, and the downstream flag is real (`scanBranchMilestones(repoRoot,
// {fetch})`). It was the one documented key whose contract nothing could
// verify or regression-test, and the gap was precisely the bridge from the
// config line to that flag. This module is the bridge.
//
// PARSE POSTURE: absent or malformed ⇒ `false`, silently. The key is an
// optional performance/precision knob, not a declaration a project is graded
// on; refusing a malformed line would turn a typo into a blocked `/spec-write`
// on a repository that never asked for the feature. That is the opposite of
// `readDocsConfig`, which THROWS on a malformed value — and deliberately so,
// because a docs mode that silently reads `false` changes what ships.

import { existsSync, readFileSync } from "node:fs";
import { normalizeFrontmatterSource } from "./frontmatter";

/**
 * The `milestone_scan_fetch:` value declared in a project's CLAUDE.md.
 *
 * Matched as a STANDALONE TOP-LEVEL line — no leading whitespace — because
 * that is how the template documents it and how `/setup` would emit it. The
 * anchoring is load-bearing: the same token appears indented inside the
 * template's own explanatory comment block, and a loose match would read a
 * project's documentation as its configuration.
 *
 * Only the literal `true` enables it. `yes`, `1`, `True` and a missing value
 * all resolve to `false`, matching the lowercase-literal convention every
 * other Schema-L boolean in this file uses.
 */
export function readMilestoneScanFetch(claudeMdPath: string): boolean {
  if (!existsSync(claudeMdPath)) return false;
  let text: string;
  try {
    text = normalizeFrontmatterSource(readFileSync(claudeMdPath, "utf-8"));
  } catch {
    return false;
  }
  return /^milestone_scan_fetch:[ \t]*true[ \t]*$/m.test(text);
}

/** The three inputs the documented precedence chain arbitrates between. */
export interface FetchPolicyInputs {
  /** `/spec-write --no-fetch` was passed. */
  noFetch?: boolean;
  /** `/spec-write --fetch` was passed. */
  fetch?: boolean;
  /** What `readMilestoneScanFetch` returned for this project. */
  configValue?: boolean;
}

/**
 * Resolve the documented precedence:
 *
 *   `--no-fetch` > `--fetch` > `milestone_scan_fetch` > built-in default false
 *
 * `--no-fetch` beating `--fetch` rather than erroring on the pair is the
 * template's stated contract, and it is the safe direction: the flag that
 * declines a network call wins over the one that requests it, so a script
 * passing both never surprises an operator with traffic.
 */
export function resolveFetchPolicy(inputs: FetchPolicyInputs): boolean {
  if (inputs.noFetch === true) return false;
  if (inputs.fetch === true) return true;
  return inputs.configValue === true;
}

// ---------------------------------------------------------------------------
// Front door
// ---------------------------------------------------------------------------
//
// `/spec-write` ORDERS a reader to call these two functions, and probe #81
// exists because most such orders name modules nobody can actually run. A
// module that ships with an order and no entry point raises
// ORDERED_UNREACHABLE_PIN, which ratchets DOWNWARD only — so the fix is the one
// the ledger's own precedents took for `scan_design_references.ts` and
// `next_free_milestone_number.ts`: give the order somewhere to land.
//
//   bun run adapters/_shared/src/milestone_scan_fetch_config.ts <CLAUDE.md> [--fetch|--no-fetch]
if (import.meta.main) {
  const [claudeMdPath, ...flags] = process.argv.slice(2);
  if (claudeMdPath === undefined) {
    console.error(
      [
        "Refusing: to resolve a fetch policy without a CLAUDE.md path.",
        "Remedy: bun run adapters/_shared/src/milestone_scan_fetch_config.ts <CLAUDE.md> [--fetch|--no-fetch]",
        "Context: mode=milestone-scan-fetch, phase=argv, argv=incomplete",
      ].join("\n"),
    );
    process.exitCode = 1;
  } else {
    const configValue = readMilestoneScanFetch(claudeMdPath);
    const resolved = resolveFetchPolicy({
      noFetch: flags.includes("--no-fetch"),
      fetch: flags.includes("--fetch"),
      configValue,
    });
    console.log(`milestone_scan_fetch=${configValue}`);
    console.log(`resolved-fetch=${resolved}`);
  }
}
