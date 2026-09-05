// STE-453 — this file used to be the `--dry-run` "integration coverage" and it
// covered nothing.
//
// What it was: 81 lines, six `expect(body).toMatch(...)` calls over the loop
// driver's own prose. It imported nothing, spawned nothing and executed
// nothing, while the skill it read described a `--dry-run` mode that mocked the
// subprocess spawn by "reading from a fixture directory" — a directory that has
// never existed anywhere in this repository. Its last assertion was that the
// skill mentions THIS FILE'S OWN NAME, which is circular in the exact way M121
// exists to remove: it cannot fail for any reason connected to the behaviour it
// claims to cover.
//
// What it is now, per AC-STE-453.3 — "carries the STE-452 executed-fence
// assertions instead":
//
//   (1) the `max-iterations` termination probe, EXECUTED under `bash -c`. It is
//       the ONE fence in this driver with no executed coverage: pre-flight (0)
//       and the spawn fence belong to STE-447, RC collection to
//       driver-gate-fail-open-guards + STE-452, and `green` / `no-progress` to
//       STE-452. Duplicating any of those would buy nothing; this one is the
//       gap.
//   (2) the coverage-claim ledger STE-453 § Testing prescribes — every claim
//       the skill makes about being covered is paired with the file that covers
//       it, and the three surfaces that are NOT covered are asserted to say so.
//
// ZERO assertions were carried forward from the old file. That is deliberate
// and it is the whole finding: the honest replacement prose ("there is no mock,
// no canned findings, no fixture directory") is written in the same vocabulary
// the old pins searched for, so `/--dry-run[\s\S]{0,500}mock/i` and
// `/--dry-run[\s\S]{0,500}(canned|fixture|...)/i` would BOTH have stayed green
// against text saying the opposite of what they were written to check. A pin
// that survives the deletion of its own subject is not coverage.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { SMOKE_LEGS } from "../adapters/_shared/src/smoke_fixture_groups";
import { reportShapeLegs } from "../adapters/_shared/src/leg_prose_surfaces";
import { anyFences, bashFences, fenceContaining, mutate } from "./_fence";
import { rulesBlock } from "./_skill-md";

const pluginRoot = join(import.meta.dir, "..");
const repoRoot = join(pluginRoot, "..", "..");
const LOOP_SKILL = join(repoRoot, ".claude", "skills", "conformance-loop", "SKILL.md");

/** The loop driver is a repo-local dogfood skill; skip where it is absent. */
function readIfPresent(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf-8") : null;
}

const loop = readIfPresent(LOOP_SKILL);
const describeIfLoop = loop ? describe : describe.skip;

type Outcome = { status: number; stdout: string; stderr: string };

function runScript(lines: readonly string[]): Outcome {
  const proc = Bun.spawnSync(["bash", "-c", lines.join("\n")]);
  return {
    status: proc.exitCode,
    stdout: new TextDecoder().decode(proc.stdout).trim(),
    stderr: new TextDecoder().decode(proc.stderr).trim(),
  };
}

const maxIterFence = () => fenceContaining(loop!, "STATUS=max-iterations");

/**
 * Run the documented `max-iterations` fence at a given counter/cap pair.
 *
 * The fence ends in a bare `break`, legal only inside a loop — the driver runs
 * it inside the per-iteration loop, and `for _ONE in 1` supplies exactly that
 * and nothing else. The epilogue is the probe, not part of the fence: "unset"
 * and "max-iterations" are the two outcomes that must never be confused, and a
 * fence that silently fails to assign STATUS looks identical to one that
 * decided not to terminate.
 */
function runMaxIter(opts: {
  iter: string;
  max: string;
  mutation?: (fence: string) => string;
}): Outcome {
  const fence = opts.mutation ? opts.mutation(maxIterFence()) : maxIterFence();
  return runScript([
    `ITER=${JSON.stringify(opts.iter)}`,
    `MAX_ITERATIONS=${JSON.stringify(opts.max)}`,
    "for _ONE in 1; do",
    fence,
    "done",
    'if [ -n "${STATUS+x}" ]; then echo "STATUS=[${STATUS}]"; else echo "STATUS-UNSET"; fi',
  ]);
}

const terminated = (r: Outcome) => r.stdout.includes("STATUS=[max-iterations]");

// ===========================================================================
// AC-STE-453.3 — slice sanity. Without this block every executed assertion
// below could be satisfied by an empty string: an extraction that matches
// nothing runs a zero-byte script, which exits 0 and reports nothing, and
// "did NOT terminate" would pass. STE-452 AC.2 made this its own criterion for
// the same reason.
// ===========================================================================

describeIfLoop("AC-STE-453.3 — the max-iterations extraction resolves and keeps its anchors", () => {
  test("the fence resolves and carries its operative anchors", () => {
    const fence = maxIterFence();
    expect(fence.length).toBeGreaterThan(40);
    expect(fence).toContain("STATUS=max-iterations");
    expect(fence).toContain("MAX_ITERATIONS");
    expect(fence).toContain("ITER");
    expect(fence).toContain("break");
  });

  test("exactly ONE fence in the document carries STATUS=max-iterations", () => {
    // `fenceContaining` takes the FIRST carrier. A second fence carrying the
    // marker — an illustrative example, a refusal template — would silently
    // re-point every executed assertion in this file at the wrong block.
    //
    // Counted with the BROAD grammar, not the bash-only one. A decoy in a
    // plain or ```text fence is invisible to `bashFences` while still being
    // the thing a future reader mistakes for the probe, and STE-452 recorded a
    // review catching exactly that substitution in its own uniqueness guard.
    const all = anyFences(loop!);
    expect(all.filter((f) => f.includes("STATUS=max-iterations"))).toHaveLength(1);
    // Non-vacuity: the broad grammar must find at least as many fences as the
    // bash-only one, or the parse itself has failed and the count above is
    // meaningless.
    expect(all.length).toBeGreaterThanOrEqual(bashFences(loop!).length);
  });

  test("the max-iterations fence is a DIFFERENT block from the other termination probes", () => {
    const distinct = new Set([
      maxIterFence(),
      fenceContaining(loop!, "STATUS=green"),
      fenceContaining(loop!, "STATUS=no-progress"),
    ]);
    expect(distinct.size).toBe(3);
  });
});

// ===========================================================================
// AC-STE-453.3 — the probe, EXECUTED.
// ===========================================================================

describeIfLoop("AC-STE-453.3 — the max-iterations probe, EXECUTED", () => {
  test("ITER below the cap does NOT terminate", () => {
    // The DISCRIMINATOR. Without it every "terminates" assertion below is
    // equally satisfied by a fence that is stuck closed and terminates on
    // everything.
    expect(terminated(runMaxIter({ iter: "1", max: "3" }))).toBe(false);
  });

  test("ITER EQUAL to the cap terminates — the boundary is inclusive", () => {
    expect(terminated(runMaxIter({ iter: "3", max: "3" }))).toBe(true);
  });

  test("ITER past the cap terminates", () => {
    expect(terminated(runMaxIter({ iter: "4", max: "3" }))).toBe(true);
  });

  test("a cap of 1 terminates on the first iteration", () => {
    expect(terminated(runMaxIter({ iter: "1", max: "1" }))).toBe(true);
  });

  test("WITNESS: the boundary operator is load-bearing — `-gt` breaks ONLY the equal case", () => {
    // Run the mutation against the form being REPLACED as well as the one
    // shipped (patterns.md Pattern 31, rider 3). `-ge` -> `-gt` is the single
    // most plausible edit to this fence and it is invisible to any assertion
    // that only checks ITER > MAX: the past-the-cap case is UNCHANGED under
    // it, so a suite testing only that case would prove nothing about the
    // operator. Only the equal case separates them.
    //
    // Routed through `mutate`, which THROWS when the pattern matches nothing
    // (follow-ups.md § 0b) — otherwise a regex that stopped matching would
    // leave this test asserting that a mutation it never applied changed
    // nothing, which passes for the wrong reason.
    const toGt = (f: string) => mutate(f, /-ge/, "-gt");

    expect(terminated(runMaxIter({ iter: "3", max: "3", mutation: toGt }))).toBe(false);
    // ...and the contrast that proves the witness is specific rather than
    // breaking the fence outright:
    expect(terminated(runMaxIter({ iter: "4", max: "3", mutation: toGt }))).toBe(true);
  });

});

// ===========================================================================
// AC-STE-453.6 — the probe fails CLOSED on an unusable cap.
//
// This block REPLACES a test that recorded the defect instead of fixing it. It
// asserted the `test(1)` diagnostic was emitted, specifically so that a future
// fix would turn it RED rather than let the hole sit behind a green assertion.
// It did exactly that, one turn later, against the session that wrote it — the
// scope was widened by the operator and the fix is now AC.6.
//
// The old behaviour, measured before the guard: `MAX_ITERATIONS=""` or `abc`
// with `ITER=3` gave `[: integer expression expected`, `STATUS` unset, **rc 0,
// and the loop continued**. Under `--auto-fix` that is an unbounded loop whose
// every iteration spawns children that commit.
// ===========================================================================

describeIfLoop("AC-STE-453.6 — an unusable --max-iterations REFUSES, it does not fall through", () => {
  const refused = (r: Outcome) =>
    r.status !== 0 && r.stdout.includes("refuses to iterate rather than run uncapped");

  test("the guard uses the same shape the rc gate and the green probe already carry", () => {
    // Pinned to the house pattern rather than to my wording. `case … in
    // ''|*[!0-9]*)` is the established in-file form (rc-collection's `RC_*`
    // normalization, the green probe's `HIGH_*` check); a rewrite that drops
    // the empty-string arm or the non-digit class would still refuse on `abc`
    // and silently stop refusing on an unset cap.
    const fence = maxIterFence();
    expect(fence).toMatch(/case "\$\{MAX_ITERATIONS:?-?\}" in ''\|\*\[!0-9\]\*\)/);
    expect(fence).toContain("exit 1");
  });

  test("an EMPTY cap refuses — where it previously continued at rc 0", () => {
    const r = runMaxIter({ iter: "3", max: "" });
    expect(refused(r)).toBe(true);
    expect(terminated(r)).toBe(false);
  });

  test("a NON-NUMERIC cap refuses", () => {
    expect(refused(runMaxIter({ iter: "3", max: "abc" }))).toBe(true);
  });

  test("the refusal NAMES the offending value and says why it refuses", () => {
    // A bare non-zero exit would satisfy "fails closed" while leaving the
    // operator to guess which flag broke the run.
    const r = runMaxIter({ iter: "3", max: "abc" });
    expect(r.stdout).toContain("--max-iterations is 'abc'");
    expect(r.stdout).toMatch(/only spending control/);
  });

  test("REGRESSION FLOOR: no VALID cap is refused — the fail-open must not become a run that cannot start", () => {
    // The obvious way to overshoot this fix. Every valid pair is re-executed
    // here, and each was measured to behave identically before the guard
    // landed, so this block is a genuine before/after control rather than a
    // restatement of the boundary tests above.
    for (const [iter, max, shouldTerminate] of [
      ["1", "3", false],
      ["3", "3", true],
      ["4", "3", true],
      ["1", "1", true],
      ["1", "0", true],
    ] as const) {
      const r = runMaxIter({ iter, max });
      expect(refused(r), `ITER=${iter} MAX=${max} was wrongly refused`).toBe(false);
      expect(r.status, `ITER=${iter} MAX=${max} exited non-zero`).toBe(0);
      expect(terminated(r), `ITER=${iter} MAX=${max} terminated wrongly`).toBe(shouldTerminate);
    }
  });

  test("WITNESS: deleting the guard restores the fall-through", () => {
    // Routed through `mutate`, which throws if the pattern stops matching, so
    // a regex that drifts is a loud error rather than a green test asserting
    // that a guard it never removed still works.
    const withoutGuard = (f: string) =>
      mutate(f, /case "\$\{MAX_ITERATIONS:-\}" in[\s\S]*?esac\n/, "");
    const r = runMaxIter({ iter: "3", max: "", mutation: withoutGuard });
    expect(refused(r)).toBe(false);
    expect(r.status).toBe(0); // the fail-open, reproduced
    expect(r.stderr).toMatch(/integer expression expected/);
  });
});

// ===========================================================================
// AC-STE-453.1 — the narrowed `--dry-run` prose.
// ===========================================================================

/** The `## Argument parsing` section, with its anchor asserted to resolve. */
function argSection(): string {
  const at = loop!.indexOf("\n## Argument parsing");
  expect(at).toBeGreaterThan(-1);
  const tail = loop!.slice(at + 1);
  const next = tail.search(/\n## \S/);
  return next === -1 ? tail : tail.slice(0, next);
}

/** The one bullet line that documents the flag. */
function dryRunBullet(): string {
  const lines = argSection()
    .split(/\r?\n/)
    .filter((l) => l.startsWith("- `--dry-run`"));
  // Exactly one, asserted before anything reads it: a zero-length list would
  // make every assertion below vacuous, and two bullets would mean the pins
  // bind whichever came first (follow-ups.md § 0i).
  expect(lines).toHaveLength(1);
  return lines[0]!;
}

describeIfLoop("AC-STE-453.1 — the --dry-run prose describes only what ships", () => {
  test("the bullet states the flag is inert — no branch in the document reads it", () => {
    // POSITIVE pin, deliberately paired with the ban below. A ban alone is
    // satisfied by deleting the bullet outright (patterns.md Pattern 31,
    // rider 1), which would remove the honest statement along with the
    // dishonest one.
    expect(dryRunBullet()).toMatch(/nothing in this document reads it/i);
  });

  test("the bullet names the coverage that DOES exist, and names it narrowly", () => {
    const bullet = dryRunBullet();
    expect(bullet).toContain("tests/m121-ste-452-termination-harness.test.ts");
    // ...and does not let that stand in for coverage of the whole loop.
    expect(bullet).toMatch(/termination/i);
    expect(bullet).toMatch(/model judgment|no test executes/i);
  });

  test("NO claim of a fixture directory survives anywhere in the skill", () => {
    // The ban, exempted at CLAUSE granularity rather than line granularity.
    //
    // The first version exempted any LINE carrying a negation anywhere on it,
    // and the audit measured the escape: append an unrelated sentence such as
    // "There is no tracker write in this mode." to a restored vaporware bullet
    // and the whole line is exempt, offenders drops to zero, and the claim
    // rides back in. The exemption has to sit in the same clause as the phrase
    // it excuses, or it is not excusing that phrase at all.
    //
    // Both directions are measured in the FR notes: the real pre-STE-453 text
    // yields an offender, and so does the negation-escape variant.
    const BANNED = /fixture directory|canned per-(?:tracker|leg) findings/i;
    const NEGATED = /\bno\b|\bnot\b|\bnever\b|used to|no longer/i;
    const offenders = loop!
      .split(/\r?\n/)
      .flatMap((line) => line.split(/(?<=[.;:])\s+|\s+—\s+/))
      .filter((clause) => BANNED.test(clause) && !NEGATED.test(clause));
    expect(offenders).toEqual([]);
  });

  test("the flag is still advertised in the remedy set — AC-STE-224.2 names it", () => {
    // Retiring the flag was measured and rejected: it reddens the six-flag set
    // and the ordered NFR-10 remedy in conformance-loop-args.test.ts, both
    // enforcing shipped AC-STE-224.2. AC-STE-453.1 narrows the PROSE; it does
    // not delete the flag.
    expect(argSection()).toContain("--dry-run");
  });
});

// ===========================================================================
// AC-STE-453.2 — the prose-only surfaces are named as such, in BOTH places.
// ===========================================================================

/**
 * The three surfaces AC-STE-453.2 requires to be labelled prose-only, each
 * bounded by the NEXT surface's anchor rather than by a character count.
 *
 * Fixed-width windows are what made the first draft of these pins vacuous —
 * 2600 characters from `**Aggregation.**` reaches the report-shape lead-in and
 * borrows its words. Anchor-to-anchor regions cannot donate to one another.
 */
const SURFACES: ReadonlyArray<readonly [string, string, string]> = [
  ["aggregation", "**Aggregation.**", "Aggregated report shape"],
  ["report shape", "Aggregated report shape", "# /conformance-loop iteration"],
  ["dedup", "#### Cross-leg dedup", "1. **Exact-match pass.**"],
];

/** The region between two anchors, with BOTH proven to resolve in order. */
function between(start: string, end: string): string {
  const from = loop!.indexOf(start);
  expect(from).toBeGreaterThan(-1);
  const to = loop!.indexOf(end, from + start.length);
  expect(to).toBeGreaterThan(from);
  return loop!.slice(from, to);
}

describeIfLoop("AC-STE-453.2 — aggregation, dedup and report shape are named prose-only", () => {
  // Each region is bounded by the NEXT surface's anchor rather than by a
  // character count, and that is a correction rather than a style choice.
  //
  // The first version of this block used `windowAt(anchor, 2600)`. Measured:
  // deleting the aggregation label alone left the test GREEN, because a
  // 2600-character window reaches into the report-shape lead-in and BORROWED
  // the words "model judgment" from it. Three surfaces sitting within a few
  // hundred characters of each other will donate to one another indefinitely,
  // and the test would have gone on reporting that a surface was labelled
  // after its label was gone. Pattern 31's positive twin, in the file written
  // to remove that class.
  //
  // `SURFACES` and `between` are MODULE-level so the inverse ledger check at
  // the foot of this file scans the same three regions. Two copies that drift
  // apart is how one of them ends up policing text the other never labelled.

  test("each surface carries the label at its OWN site, donated by no neighbour", () => {
    for (const [name, start, end] of SURFACES) {
      expect(between(start, end), `${name} is not labelled at its own site`).toMatch(
        /model judgment/i,
      );
    }
  });

  test("the three labels are three DISTINCT sites, not one sentence counted thrice", () => {
    const sites = SURFACES.map(([, start, end]) =>
      between(start, end)
        .split(/\r?\n/)
        .filter((l) => /model judgment/i.test(l))
        .join("|"),
    );
    expect(new Set(sites).size).toBe(3);
  });

  test("each surface's label says explicitly that NO test executes it", () => {
    for (const [name, start, end] of SURFACES) {
      expect(between(start, end), `${name} does not disclaim execution`).toMatch(
        /no (test|shell fence|module|callable)|nothing (executes|in the test suite executes)|not.{0,20}executed|no test executes/i,
      );
    }
  });

  test("`## Rules` names all three, in ONE bullet that is about exactly that", () => {
    const rules = rulesBlock(loop!);
    // Non-vacuity first: prove the slice is the right one before asserting
    // anything about its contents (follow-ups.md § 0i — a slice-anchored pin
    // has no idea what it is holding).
    expect(rules).toContain("--dry-run");

    // Scoped to the ONE bullet that carries the label, never to the whole
    // section. Measured: asserting `rules.toLowerCase()).toContain("aggregation")`
    // stayed GREEN after the word was deleted from this bullet, because the
    // sibling "Fail-fast on Phase A subprocess error" bullet says "no
    // aggregation, no Phase B dispatch". A section-wide `toContain` over a
    // section that discusses the same nouns cannot tell the two apart.
    const bullets = rules.split(/\r?\n/).filter((l) => /^- \*\*/.test(l));
    const labelled = bullets.filter((l) => /model judgment/i.test(l));
    expect(labelled).toHaveLength(1);
    for (const noun of ["aggregation", "dedup", "report shape"]) {
      expect(labelled[0]!.toLowerCase(), `the Rules label does not name ${noun}`).toContain(noun);
    }
  });

  test("`## Rules` names the termination probes as the executed contrast", () => {
    // Strictly stronger than the ban it replaces. "These three are not
    // covered" is also satisfied by a driver that covers nothing at all; this
    // asserts the positive half — which surfaces ARE executed — so the
    // sentence stays informative rather than merely pessimistic.
    const rules = rulesBlock(loop!);
    expect(rules).toContain("tests/m121-ste-452-termination-harness.test.ts");
    expect(rules).toMatch(/termination probes/i);
  });
});

// ===========================================================================
// AC-STE-453.4 — the report shape emits an N-way `legs:` list.
// ===========================================================================

describeIfLoop("AC-STE-453.4 — the aggregated report's legs: list is N-way and DERIVED", () => {
  test("the run-level legs: header enumerates exactly the registered leg set", () => {
    // The binding AC.4 needs in order to be falsifiable at all. Measured
    // before the change: rewriting the whole 34-line report template reddened
    // ZERO assertions in the suite, because the three `tracker-coverage:`
    // regexes in conformance-loop-aggregator.test.ts are written
    // `tracker-coverage:\s*\[` and cannot cross the `**` of the template's
    // `**tracker-coverage:**` — they resolved only to the dedup prose. A
    // rename with no new pin would have relocated an unbacked claim instead of
    // removing one.
    expect([...reportShapeLegs(loop!)].sort()).toEqual([...SMOKE_LEGS].sort());
  });

  test("the surface is non-vacuous — it returns nothing on a document without the header", () => {
    // `reportShapeLegs` returns [] when the header is absent, so the equality
    // above would silently pass against an empty enum. Proving the function
    // discriminates is what stops that.
    expect(reportShapeLegs("no header here")).toEqual([]);
    expect(reportShapeLegs(loop!).length).toBe(SMOKE_LEGS.length);
  });

  test("the source-file list carries one entry per registered leg", () => {
    const fence = anyFences(loop!).find((f) => f.includes("**legs:**")) ?? "";
    expect(fence).toContain("**Source files:**");
    for (const leg of SMOKE_LEGS) {
      expect(fence).toContain(`/tmp/dpt-smoke-findings-<DATE>-${leg}.md`);
    }
  });

  test("the pairwise tracker-coverage: field is gone from the report template", () => {
    const fence = anyFences(loop!).find((f) => f.includes("**legs:**")) ?? "";
    expect(fence.length).toBeGreaterThan(200);
    expect(fence).not.toContain("tracker-coverage");
    expect(fence).not.toContain("Tracker coverage");
  });
});

// ===========================================================================
// AC-STE-453.5 — the dedup walk is registry-order over all later legs.
// ===========================================================================

describeIfLoop("AC-STE-453.5 — the dedup describes a registry-order walk", () => {
  const dedupSection = () => {
    const at = loop!.indexOf("#### Cross-leg dedup");
    expect(at).toBeGreaterThan(-1);
    const tail = loop!.slice(at + 1);
    const next = tail.search(/\n#### \S/);
    const section = next === -1 ? tail : tail.slice(0, next);
    // Non-vacuity: the slice must contain its own subject before any ban runs.
    expect(section).toContain("Exact-match pass");
    expect(section).toContain("Fuzzy-overlap pass");
    return section;
  };

  test("the walk is over SMOKE_LEGS registry order, scanning LATER legs", () => {
    const section = dedupSection();
    expect(section).toContain("SMOKE_LEGS");
    expect(section).toMatch(/registry order/i);
    expect(section).toMatch(/later leg/i);
  });

  test("neither pass names one tracker as THE side of the comparison", () => {
    // The ban that matters, scoped to the two operative numbered steps. The
    // retired text read "Walk every Linear finding; ... scan Jira findings",
    // which is a two-leg algorithm stated as prose — it has no third-leg form
    // at all, and a reader following it literally would never compare the
    // tracker-less leg against anything.
    const passes = dedupSection()
      .split(/\r?\n/)
      .filter((l) => /^\d\. \*\*(Exact-match|Fuzzy-overlap) pass\.\*\*/.test(l));
    expect(passes).toHaveLength(2);
    for (const pass of passes) {
      expect(pass).not.toMatch(/\bLinear\b/);
      expect(pass).not.toMatch(/\bJira\b/);
    }
  });

  test("the dedup is explicitly labelled model judgment", () => {
    expect(dedupSection()).toMatch(/model judgment/i);
  });

  test("single-leg findings carry a one-element legs: list, per registered leg", () => {
    const section = dedupSection();
    for (const leg of SMOKE_LEGS) {
      expect(section, `no single-leg legs: form for ${leg}`).toMatch(
        new RegExp(`legs:\\s*\\[${leg}\\]`),
      );
    }
  });
});

// ===========================================================================
// STE-453 § Testing — the coverage-claim ledger.
//
// "The check that AC.1 and AC.2 actually landed is that a reader can no longer
// find a coverage claim in the skill that is not backed by an executing test.
// That is checkable by enumerating the skill's coverage claims and pairing each
// with its test."
//
// This is that check, mechanized. It is the assertion that stops the narrowed
// prose from drifting back into an overstated claim one edit at a time.
// ===========================================================================

describeIfLoop("STE-453 § Testing — every named test file exists and actually executes", () => {
  test("every `tests/<file>.test.ts` the skill cites exists on disk", () => {
    const cited = [...new Set([...loop!.matchAll(/tests\/([a-z0-9._-]+\.test\.ts)/g)].map((m) => m[1]!))];
    // Non-vacuity: the skill must cite at least one, or this loop asserts
    // nothing. A future edit that removes every citation would otherwise pass
    // here while quietly deleting the ledger's whole subject.
    expect(cited.length).toBeGreaterThan(0);
    for (const file of cited) {
      expect(existsSync(join(pluginRoot, "tests", file)), `${file} is cited but absent`).toBe(true);
    }
  });

  test("every cited test file EXECUTES something — a citation is not coverage", () => {
    // The claim the skill makes about these files is that they run the
    // driver's fences. A file that only greps prose does not support that
    // claim, and this file is itself the cautionary case: it was cited as
    // integration coverage for three paths while executing nothing at all.
    //
    // STE-565 — the predicate is "executes a subprocess", not "contains the
    // literal `Bun.spawnSync`". When the dual-shell fence runner moved into
    // `tests/_fence.ts`, two files that execute MORE than before (every fence
    // under every available shell, rather than under bash alone) stopped
    // carrying the literal and this check red on them. Pinning one spelling of
    // a capability is the same defect the sibling FR in this milestone repairs
    // in the smoke fixtures: it grades a rendering rather than the subject.
    const EXECUTES = ["Bun.spawnSync", "runInShell", "runInEveryShell"] as const;
    const cited = [...new Set([...loop!.matchAll(/tests\/([a-z0-9._-]+\.test\.ts)/g)].map((m) => m[1]!))];
    for (const file of cited) {
      const body = readFileSync(join(pluginRoot, "tests", file), "utf-8");
      expect(
        EXECUTES.some((marker) => body.includes(marker)),
        `${file} is cited as coverage but executes nothing (looked for ${EXECUTES.join(" / ")})`,
      ).toBe(true);
    }
  });

  test("the skill claims no coverage for the three model-judgment surfaces", () => {
    // The inverse direction, and the one that actually enforces AC.2's
    // honesty condition: it is not enough that the three are labelled — no
    // OTHER sentence may quietly re-assert coverage of them. A test file name
    // must never appear inside any of the three labelled regions except as
    // the executed CONTRAST (the termination harness), which is named to draw
    // exactly that distinction.
    //
    // REPAIRED after the audit, twice over. It used fixed-width windows — the
    // very shape this file repaired 200 lines above — and it covered two of
    // the three surfaces. Worse, the dedup region yielded ZERO citations, so
    // half the loop body never reached an `expect` at all: a ban iterating an
    // empty list is indistinguishable from a ban that holds.
    const all = SURFACES.flatMap(([name, start, end]) =>
      [...between(start, end).matchAll(/tests\/([a-z0-9._-]+\.test\.ts)/g)].map((m) => ({
        name,
        cite: m[1]!,
      })),
    );

    // Non-vacuity: at least one region must cite something, or this test is
    // asserting over an empty list and would pass against a document that had
    // lost every label. The aggregation region carries the executed CONTRAST,
    // so the floor is one.
    expect(all.length).toBeGreaterThan(0);

    for (const { name, cite } of all) {
      expect(cite, `the ${name} region cites ${cite} as if it covered the surface`).toBe(
        "m121-ste-452-termination-harness.test.ts",
      );
    }
  });
});
