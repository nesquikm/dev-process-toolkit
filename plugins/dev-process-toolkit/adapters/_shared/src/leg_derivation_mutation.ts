// leg_derivation_mutation — STE-445: the permanent falsifiability harness for
// the `SMOKE_LEGS` binding.
//
// THE DEFECT. `SMOKE_LEGS` in `smoke_fixture_groups.ts` is presented as the
// authority for which conformance legs exist, but widening it from
// `["linear", "jira"]` to a three-member array containing a synthetic leg and
// running the whole gate went byte-identically green. The one assertion the
// mutation could even reach was an unanchored substring regex, and a widened
// `linear | jira | zzsynthetic` still CONTAINS `linear | jira`.
//
// THE EXPECTATION IS A HARDCODED LITERAL, DELIBERATELY. The CLI builds its
// error text as `SMOKE_LEGS.join(" | ")`. If the expectation were derived from
// the same array, widening the array would move the actual and the expected
// together and the assertion could never fail — a vacuous test wearing the
// costume of a derivation. So the full canonical set is spelled out below by
// hand and matched ANCHORED. Widening the leg set is therefore required to
// break this file, which forces a human to come here and re-state the new set.
//
// THE MUTATION IS EXECUTED, NOT DESCRIBED. `smoke_fixture_groups.ts` is
// self-contained (zero imports), so the harness copies that one file to a temp
// dir, rewrites the `SMOKE_LEGS` line in the COPY, and spawns the CLI from
// there. The real source is never touched: an in-place mutation would race the
// rest of the suite and leave the tree dirty whenever an assertion threw.
//
// BOTH DIRECTIONS ARE LOAD-BEARING.
//   (i)  mutation APPLIED  => the hardcoded expectation does NOT match, so the
//        derivation assertion WOULD fail. That is falsifiability.
//   (ii) mutation ABSENT   => the same expectation DOES match. Without this, a
//        harness hardwired to report RED would look identical to a working one.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SRC_DIR = import.meta.dir;
const PLUGIN_ROOT = join(SRC_DIR, "..", "..", "..");
const FIXTURE_GROUPS_SRC = join(SRC_DIR, "smoke_fixture_groups.ts");

/**
 * A leg token deliberately absent from the canonical `SMOKE_LEGS`. Sorted last
 * so a widened array reads as an append, which is the realistic mutation shape.
 */
export const SYNTHETIC_LEG = "zzsynthetic";

/**
 * The full canonical leg set, written out BY HAND. Never build this from
 * `SMOKE_LEGS` — see the header note. Exported so the assertion sites that
 * consume it (and the AC.4 registry) can point at one literal.
 */
export const CANONICAL_LEG_ERROR_PATTERN =
  /^smoke_fixture_groups: --leg must be one of linear \| jira \(got .*\)$/;

/** Anchored, first-line-exact. `toContain` here would reinstate the defect. */
export function legErrorMatchesCanonicalSet(stderr: string): boolean {
  const firstLine = String(stderr).split(/\r?\n/, 1)[0] ?? "";
  return CANONICAL_LEG_ERROR_PATTERN.test(firstLine);
}

export interface LegCliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Bound every spawn. An unbounded `bun run` against a GENERATED temp file can
 * hang the whole harness with no ceiling — and this harness gates a milestone,
 * so a hang here reads as an unfinished run rather than a failed one. Mirrors
 * the existing subprocess precedent in `toolchain_probe.ts`, which bounds its
 * comparable spawns rather than trusting them to return.
 */
const CLI_SPAWN_TIMEOUT_MS = 30_000;

function runCliFile(file: string, args: readonly string[]): LegCliResult {
  const r = spawnSync("bun", ["run", file, ...args], {
    cwd: PLUGIN_ROOT,
    encoding: "utf8",
    timeout: CLI_SPAWN_TIMEOUT_MS,
  });
  return {
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
    exitCode: r.status ?? -1,
  };
}

/** Spawn the real, unmutated CLI. */
export function runCanonicalLegCli(args: readonly string[]): LegCliResult {
  return runCliFile(FIXTURE_GROUPS_SRC, args);
}

const SMOKE_LEGS_DECL_RE = /export const SMOKE_LEGS = \[([^\]]*)\] as const;/;

function widenSmokeLegs(
  src: string,
  syntheticLeg: string,
): { text: string; applied: boolean } {
  const match = SMOKE_LEGS_DECL_RE.exec(src);
  if (match === null) return { text: src, applied: false };
  const member = JSON.stringify(syntheticLeg);
  const widened =
    `export const SMOKE_LEGS = [${match[1]!.trim()}, ${member}] as const;`;
  const text = src.replace(SMOKE_LEGS_DECL_RE, () => widened);
  return { text, applied: text !== src && text.includes(member) };
}

/**
 * Copy the CLI to a temp dir with `SMOKE_LEGS` widened, run it there, delete
 * the copy. `mutationApplied` is false when the rewrite did not change the
 * text — a no-op rewrite is not a mutation, and reporting it as one would let
 * the harness pass while testing nothing.
 */
function withMutatedCli<T>(
  syntheticLeg: string,
  fn: (cliPath: string, applied: boolean) => T,
): T {
  const dir = mkdtempSync(join(tmpdir(), "dpt-leg-mutation-"));
  try {
    const { text, applied } = widenSmokeLegs(
      readFileSync(FIXTURE_GROUPS_SRC, "utf8"),
      syntheticLeg,
    );
    const cliPath = join(dir, "smoke_fixture_groups.ts");
    writeFileSync(cliPath, text, "utf8");
    return fn(cliPath, applied);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Spawn the CLI from a temp COPY whose `SMOKE_LEGS` gained `syntheticLeg`. */
export function runMutatedLegCli(
  syntheticLeg: string,
  args: readonly string[],
): LegCliResult {
  return withMutatedCli(syntheticLeg, (cliPath) => runCliFile(cliPath, args));
}

export interface DerivationCheck {
  name: string;
  /** Did the hardcoded expectation match the UNMUTATED CLI? (direction ii) */
  matchedCanonical: boolean;
  /** Did it match the MUTATED CLI? `false` is the falsifying result. */
  matchedMutated: boolean;
  /**
   * Did the mutated CLI actually RUN and refuse, rather than failing to start?
   *
   * Load-bearing, not diagnostic. Without it, `matchedMutated: false` conflates
   * two opposite things: the expectation correctly rejecting a widened set (a
   * genuine falsification) and the mutated copy never executing at all (bun
   * missing, a compile error, disk pressure during mkdtemp). Both yield stderr
   * that fails the expectation, so an unqualified `false` would let a BROKEN
   * harness report the milestone's halt gate as satisfied.
   */
  mutatedRanCleanly: boolean;
  /** Observed exit status of the mutated CLI; `-1` when the spawn never ran. */
  mutatedExitCode: number;
}

export interface LegMutationReport {
  syntheticLeg: string;
  mutationApplied: boolean;
  checks: readonly DerivationCheck[];
  /** Names of checks whose expectation FAILED under mutation. */
  failuresUnderMutation: readonly string[];
}

// ───────────────────────── the one-way derivation registry ─────────────────
//
// THE DIRECTION, AND ITS NARROW SCOPE. Reading a skill's markdown in order to
// ASSERT AGAINST it is legitimate — the prose is the subject under check, which
// is why `m117-ste-425` reads the smoke-test skill's markdown all over the place
// and every one of those reads stays legal. Reading it in order to COMPUTE an
// expected value inverts the direction: the expectation is then extracted from
// the very artifact it asserts against, and the assertion cannot fail.
// `DERIVATION_TARGETS` records, per check, WHERE THE EXPECTED VALUE LIVES —
// never what the check reads — so the rule lands on the expectation-defining
// module and nowhere else.
//
// WHAT THE META-TEST CAN AND CANNOT SEE. It is a STRUCTURAL, TEXTUAL check over
// declared file paths, not dataflow analysis. It can detect: an expectation
// declared to live in a markdown file; a declared source file that does not
// exist; a declared literal that is absent from (or has drifted out of) the
// declared TypeScript; a skill-path token appearing anywhere in an
// expectation-defining module; and a registry that has drifted out of step with
// the executed harness. It CANNOT distinguish a genuine read from a mention —
// naming a skill path in a comment here is enough to turn it RED, which is why
// this note spells the paths out in words. Nor can it see an expectation
// computed from prose reached indirectly: through a helper in a third module,
// through a path assembled from fragments, or through a file read by a spawned
// process. The declaration is a load-bearing honesty marker backed by three
// falsifiable structural pins, not a proof of provenance.

/** One registered derivation check: what it asserts, and where its expected
 *  VALUE originates. `expectationSource` is always TypeScript by construction —
 *  a prose-sourced expectation is the thing this registry exists to forbid. */
export interface DerivationTarget {
  /** Matches a `DerivationCheck.name`. */
  id: string;
  /** What is being asserted against — MAY be a skill file. */
  asserts: string;
  /** Where the expected VALUE lives, relative to the plugin root. */
  expectationSourceFile: string;
  expectationSource: "typescript";
  /** The expected value verbatim, as it appears in `expectationSourceFile`. */
  expectationLiteral: string;
}

/** A registry entry plus the executable it drives. Keeping the two on one
 *  record is what makes registry/harness drift impossible rather than merely
 *  detectable: both `DERIVATION_TARGETS` and the harness's `checks` are
 *  projections of this single array. */
interface DerivationSpec extends DerivationTarget {
  matches(result: LegCliResult): boolean;
}

/** This module, relative to the plugin root. */
const THIS_MODULE_PATH = "adapters/_shared/src/leg_derivation_mutation.ts";

const DERIVATION_SPECS: readonly DerivationSpec[] = [
  {
    id: "leg-error-exact-set",
    asserts:
      "smoke_fixture_groups CLI stderr, first line, on an unrecognized --leg",
    expectationSourceFile: THIS_MODULE_PATH,
    expectationSource: "typescript",
    // Verbatim `CANONICAL_LEG_ERROR_PATTERN` source. Written out by hand rather
    // than read off `.source`, so it is a second statement of the expectation
    // that must agree with the first. It is NOT self-satisfying: the escapes
    // below are doubled in this string literal, so the only text in this file
    // that contains this value is the regex literal itself. Editing the regex
    // — widening the leg set included — therefore turns AC.4 RED here as well
    // as AC.1 RED at the assertion.
    expectationLiteral:
      "^smoke_fixture_groups: --leg must be one of linear \\| jira \\(got .*\\)$",
    matches: (result) => legErrorMatchesCanonicalSet(result.stderr),
  },
];

/**
 * The declared registry. Every entry names a check and declares where its
 * expectation literal lives; the AC.4 meta-test pins the set against the checks
 * the harness actually executes, so neither can run ahead of the other.
 */
export const DERIVATION_TARGETS: readonly DerivationTarget[] =
  DERIVATION_SPECS.map(({ matches: _matches, ...target }) => target);

// An unrecognized leg, so the CLI takes its `--leg` guard branch and prints the
// canonical-set line. Deliberately NOT the synthetic leg: under mutation the
// synthetic leg is legitimate and the guard would not fire at all.
const PROBE_ARGS = ["render", "--leg", "jirra", "--passed", "1"] as const;

/**
 * The status the CLI exits with when it refuses an unrecognized `--leg`. A
 * mutated copy that exits with anything else did not reach its guard, so its
 * failure to match the expectation is not evidence of anything.
 */
const LEG_USAGE_EXIT_CODE = 2;

/**
 * Run every registered derivation check against both the real CLI and the
 * mutated copy. Zero entries in `failuresUnderMutation` is the milestone's
 * declared halt condition (`fr1_derivation_collapsed`): it means the binding
 * survives a widened enum untouched and is therefore not falsifiable.
 */
export function runLegDerivationMutation(
  syntheticLeg: string = SYNTHETIC_LEG,
): LegMutationReport {
  const canonical = runCanonicalLegCli(PROBE_ARGS);
  const { mutated, applied } = withMutatedCli(syntheticLeg, (cliPath, ok) => ({
    mutated: runCliFile(cliPath, PROBE_ARGS),
    applied: ok,
  }));

  // Executed straight off `DERIVATION_SPECS`, the same array `DERIVATION_TARGETS`
  // projects. A registered-but-unexecuted entry (decoration) or an executed-but-
  // unregistered check (unaccounted-for) is unrepresentable, not just detected.
  const checks: DerivationCheck[] = DERIVATION_SPECS.map((spec) => ({
    name: spec.id,
    matchedCanonical: spec.matches(canonical),
    matchedMutated: spec.matches(mutated),
    // The probe feeds an unrecognized leg, so a CLI that ran and refused exits
    // with the usage status. Anything else — a compile error, a missing
    // interpreter, a timeout kill — means the mutated copy never got far enough
    // to have an opinion, and its non-match is worthless as evidence.
    mutatedRanCleanly: mutated.exitCode === LEG_USAGE_EXIT_CODE,
    mutatedExitCode: mutated.exitCode,
  }));

  return {
    syntheticLeg,
    mutationApplied: applied,
    checks,
    // A check counts as falsified ONLY when the mutated CLI genuinely ran and
    // the expectation still rejected it. A failed spawn therefore yields an
    // EMPTY list, which reads as `fr1_derivation_collapsed` — a halt. That
    // direction is deliberate: a broken harness must stall the milestone, never
    // wave it through on evidence it did not actually produce.
    failuresUnderMutation: checks
      .filter((check) => !check.matchedMutated && check.mutatedRanCleanly)
      .map((check) => check.name),
  };
}
