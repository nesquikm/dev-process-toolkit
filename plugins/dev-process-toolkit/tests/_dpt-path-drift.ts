import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

// M104 STE-384 — the scan primitive behind the `.dpt-locks` / `.dev-process`
// path-drift gate. Shared by two callers:
//
//   tests/dpt-path-drift.test.ts            — the live gate. Scans the real
//                                             tree; must be GREEN at all times.
//   tests/m104-ste-384-dpt-path-drift.test.ts — drives this primitive over
//                                             fixture trees, so the gate's
//                                             failure polarity is proven rather
//                                             than assumed.
//
// WHY THIS IS A MODULE AND NOT INLINE. STE-49's `archive-path-drift.test.ts`
// inlines its whole scan in one `test()` body. That shape cannot prove the gate
// fires: a grep that only ever runs against a clean tree is indistinguishable
// from a grep for a typo. Parameterising the target list is the minimum change
// that makes "it actually fires" checkable.
//
// WHY THE `_` PREFIX. This is a NON-test module, per the `tests/_skill-md.ts`
// precedent. bun resolves an imported `.test.ts` through the module cache, so
// exporting these helpers from `dpt-path-drift.test.ts` would register that
// file's tests into any importer's run. A `_` module has no such hazard.

/**
 * The retired path literals, as `grep -E` patterns.
 *
 * LOAD-BEARING: every pattern is anchored on a literal dot (`\.`). A bare
 * `dev-process` matches `dev-process-toolkit` — this plugin's own name —
 * drowning the gate in ~295 hits across 84 files (measured 2026-07-15). The
 * dot-anchored form has zero false positives. Do not widen it.
 *
 * The `.dpt/…` paths that REPLACED these are deliberately NOT matched: this is
 * a drift detector, not a `.dpt` detector. Flagging the replacement would make
 * the correct end state unreachable.
 */
export const RETIRED_LITERAL_PATTERNS: string[] = ["\\.dpt-locks", "\\.dev-process"];

/** One surviving retired literal: where it is, and what it says. */
export interface Survivor {
  /** Absolute path, exactly as the caller spelled the scan target. */
  file: string;
  /** 1-indexed line number within `file`. */
  line: number;
  /** The offending source line, verbatim — so the failure is actionable. */
  text: string;
}

/**
 * Files exempt from the scan.
 *
 * `*.test.ts` — the DECOY carve-out. STE-382's regression guards assert the
 * legacy `.dpt-locks/` literal is neither scanned nor fallen back to; there the
 * retired literal is the subject under test, so deleting it deletes the proof.
 * These mentions are deliberate negative cases, not drift.
 *
 * Scoped to the `.test.ts` SUFFIX, not a substring: a prose file that merely
 * names a test (`my.test.ts.md`) buys no immunity, and a non-test sibling in
 * the same directory still fires. Accepted residual risk: drift hiding inside a
 * genuine test file. Bounded to test files by construction.
 */
function isExempt(file: string): boolean {
  return file.endsWith(".test.ts");
}

/**
 * Resolve the scan target list.
 *
 * The base targets are mandatory and always returned. The cross-cutting specs
 * are OPTIONAL and filtered by `existsSync`: a downstream consumer project
 * running this plugin's `/gate-check` may not carry every cross-cutting spec
 * file, and a missing one must be tolerated rather than fatal. Nothing absent
 * is ever handed to grep — an unmatched operand makes grep exit >= 2, which a
 * naive read would mistake for "clean".
 *
 * DELIBERATELY OUT OF SCOPE — history surfaces. `CHANGELOG.md`,
 * `specs/frs/archive/**` and `specs/plan/archive/**` record what the old layout
 * WAS. They legitimately carry the retired literals and must not be rewritten;
 * scanning them would leave the gate permanently red on a correct tree. They are
 * exempt by OMISSION — never added to the target list — rather than by a deny
 * rule, which is why the test asserts no target is a prefix of them.
 *
 * An unexplained exemption is a bug, so every exemption states its reason where
 * it is enforced: the history surfaces here, the `*.test.ts` decoys in
 * `isExempt` above.
 */
export function dptPathDriftScanTargets(pluginRoot: string, repoRoot: string): string[] {
  const baseTargets = [
    join(pluginRoot, "docs"),
    join(pluginRoot, "skills"),
    join(pluginRoot, "adapters"),
    join(pluginRoot, "templates"),
    join(repoRoot, "README.md"),
  ];
  const optionalTargets = [
    join(repoRoot, "specs", "requirements.md"),
    join(repoRoot, "specs", "technical-spec.md"),
    join(repoRoot, "specs", "testing-spec.md"),
  ].filter(existsSync);
  return [...baseTargets, ...optionalTargets];
}

/**
 * Grep `targets` for every retired literal and return one `Survivor` per
 * offending line, exempt files removed.
 *
 * A single grep invocation over the pattern alternation, so a line carrying two
 * retired literals yields one survivor rather than a duplicate per pattern.
 */
export function findRetiredLiterals(targets: string[]): Survivor[] {
  // grep with no file operand reads stdin and hangs. Nothing to scan is clean.
  if (targets.length === 0) return [];

  const proc = spawnSync(
    "grep",
    // -r recurse, -H always print the filename (grep omits it for a lone file
    // operand), -n line numbers, -I skip binary files (a "Binary file … matches"
    // line carries no line number and would not parse), -E alternation.
    ["-rHnIE", RETIRED_LITERAL_PATTERNS.join("|"), ...targets],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );

  if (proc.error) throw proc.error;

  // grep exits 0 on match, 1 on no-match, >= 2 on error. An error that produced
  // no output means the scan did not run — report it rather than returning a
  // clean-looking empty list. Checked before parsing: it is a precondition on
  // the scan being valid at all, not a property of what was parsed.
  if (proc.status !== null && proc.status >= 2 && proc.stdout.length === 0) {
    throw new Error(
      `M104 STE-384: the retired-literal scan failed to run (grep exit ${proc.status}).\n` +
        `targets: ${targets.join(", ")}\n${proc.stderr}`,
    );
  }

  const survivors: Survivor[] = [];
  for (const raw of proc.stdout.split("\n")) {
    if (raw.length === 0) continue;
    // `path:line:text` — text may itself contain colons, so split on the first
    // two only.
    //
    // AN UNPARSEABLE LINE THROWS, it does not `continue`. grep printed it, so it
    // is a match; skipping it would drop a real survivor and report the tree
    // clean — a false-negative in the one module whose whole job is to fail
    // loudly. `-H` and `-I` are what make this shape total (filename always
    // present, no line-number-less "Binary file … matches"), so anything that
    // does not parse means an assumption broke and the gate can no longer be
    // trusted. The known break is a path containing a colon before the line
    // number (a Windows `C:\…` drive letter); this repo's tooling is POSIX-only,
    // so that surfaces as a loud failure to fix rather than a silent pass.
    const firstColon = raw.indexOf(":");
    const secondColon = firstColon === -1 ? -1 : raw.indexOf(":", firstColon + 1);
    const line = secondColon === -1 ? NaN : Number(raw.slice(firstColon + 1, secondColon));
    if (secondColon === -1 || !Number.isInteger(line)) {
      throw new Error(
        `M104 STE-384: unparseable grep output line — expected \`path:line:text\`, got:\n  ${raw}\n` +
          `Refusing to skip it: grep matched this line, so dropping it would report the tree clean ` +
          `while a retired literal survives.`,
      );
    }

    const file = raw.slice(0, firstColon);
    if (isExempt(file)) continue;

    survivors.push({ file, line, text: raw.slice(secondColon + 1) });
  }

  return survivors;
}

/**
 * Throw unless `targets` are free of retired literals. The failure names EVERY
 * survivor as `file:line`, not just the first — a gate that reports one hit at
 * a time turns a sweep into N commits.
 */
export function assertNoRetiredLiterals(targets: string[]): void {
  const survivors = findRetiredLiterals(targets);
  if (survivors.length === 0) return;

  const detail = survivors.map((s) => `  ${s.file}:${s.line}: ${s.text.trim()}`).join("\n");
  throw new Error(
    `M104 AC-STE-384.1 regression: retired path literals found in the live tree.\n` +
      `The .dpt-locks/ and .dev-process/ layouts are retired — use .dpt/ instead.\n` +
      `${survivors.length} survivor(s):\n${detail}`,
  );
}
