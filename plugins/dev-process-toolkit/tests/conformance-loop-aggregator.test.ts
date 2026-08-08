import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { SMOKE_LEGS } from "../adapters/_shared/src/smoke_fixture_groups";

// STE-224 AC-STE-224.5 + AC-STE-224.10 — Phase A parallel spawn + cross-leg
// dedup heuristic doc-conformance.

const repoRoot = join(import.meta.dir, "..", "..", "..");
const skillPath = join(repoRoot, ".claude", "skills", "conformance-loop", "SKILL.md");

function readSkillIfPresent(): string | null {
  if (!existsSync(skillPath)) return null;
  return readFileSync(skillPath, "utf8");
}

const skill = readSkillIfPresent();
const describeIfPresent = skill === null ? describe.skip : describe;

describeIfPresent("STE-224 AC-STE-224.5 — Phase A parallel /smoke-test fan-out", () => {
  test("Phase A documents the parallel two-tracker subprocess spawn", () => {
    const body = skill!;
    // Both /smoke-test invocations must appear (one per tracker), each
    // wrapped as a single quoted positional per STE-325 (the bare-arg
    // form was rejected by the `claude` CLI as
    // `error: unknown option '--tracker'`).
    expect(body).toMatch(/claude -p\s+"\/smoke-test\s+--tracker\s+linear/);
    expect(body).toMatch(/claude -p\s+"\/smoke-test\s+--tracker\s+jira/);
  });

  test("Phase A backgrounds the children with & and awaits them by BOUNDED POLL", () => {
    const body = skill!;
    expect(body).toMatch(/&\s*\nPID_LINEAR=/);
    expect(body).toMatch(/&\s*\nPID_JIRA=/);

    // REPAIRED BY STE-453 — this test asserted the opposite of what ships, and
    // passed for two milestones.
    //
    // It used to require `wait "${PID_LINEAR}"` and `wait "${PID_JIRA}"`
    // document-wide. STE-355 REPLACED the foreground `wait` with a detached
    // spawn plus a bounded `kill -0` poll, because a same-call wait is
    // guaranteed to hit the harness's 600 s per-call ceiling and truncate both
    // legs. Measured: the ONLY satisfier of those two regexes is the § "Why
    // detached + poll" paragraph — the sentence that quotes the retired shape
    // in order to say it is forbidden. So the pin was broken in BOTH
    // directions: re-introducing the truncating `wait` at the spawn site would
    // not have reddened it, while deleting a paragraph of pure history would.
    //
    // This is a shipped-AC supersession that was never recorded:
    // AC-STE-224.5 says "run to completion via `wait`", and STE-355 AC.1/AC.3
    // superseded it. Recorded now in `specs/plan/M121.md` — the reason it is
    // worth recording is sitting in this test.
    const spawnFence = body.slice(body.indexOf("PID_LINEAR=$!"));
    const forbiddenCallout = spawnFence.slice(0, spawnFence.indexOf("\n### "));
    expect(forbiddenCallout).toMatch(/FORBIDDEN at this spawn site/);
    expect(forbiddenCallout).toMatch(/bounded `kill -0` poll-until-exit loop/);

    // The retired shape may appear ONLY where it is labelled retired.
    for (const line of body.split("\n").filter((l) => /wait\s+"\$\{PID_(LINEAR|JIRA)\}"/.test(l))) {
      expect(line).toMatch(/old spawn shape|guaranteed to hit that ceiling|STE-355/);
    }
  });

  test("Phase A fails fast if either subprocess returns non-zero", () => {
    const body = skill!;
    expect(body).toMatch(/Fail-fast/i);
    expect(body).toMatch(/RC_LINEAR/);
    expect(body).toMatch(/RC_JIRA/);
    // Must explicitly check both return codes and exit non-zero on either failure.
    expect(body).toMatch(/RC_LINEAR.*-ne\s*0[\s\S]{0,80}RC_JIRA.*-ne\s*0/);
  });

  test("aggregator reads the canonical per-tracker findings paths", () => {
    const body = skill!;
    expect(body).toMatch(/\/tmp\/dpt-smoke-findings-\$\{?DATE\}?-linear\.md/);
    expect(body).toMatch(/\/tmp\/dpt-smoke-findings-\$\{?DATE\}?-jira\.md/);
  });

  test("aggregator emits per-iteration unified report at the canonical path", () => {
    const body = skill!;
    expect(body).toMatch(/\/tmp\/dpt-conformance-loop-\$\{?DATE\}?-iter-\$\{?ITER\}?\.md/);
  });

  test("Phase A documents NO /smoke-test changes (existing canonical paths)", () => {
    const body = skill!;
    expect(body).toMatch(/no\s+`?\/smoke-test`?\s+changes/i);
  });

  test("parallelism mechanism is Bash subprocess, NOT agent-team", () => {
    const body = skill!;
    expect(body).toMatch(/Bash subprocess parallelism/i);
    expect(body).toMatch(/NOT the agent-team primitive/i);
  });
});

// AC-STE-224.10's field spelling and arity are SUPERSEDED by AC-STE-453.4/.5:
// `tracker-coverage: [linear, jira]` became an N-way `legs:` list, because the
// two-element form is structurally incapable of expressing a third leg's
// finding. Every OPERATIVE clause of AC-STE-224.10 survives verbatim and is
// still enforced below — exactly one entry per unique regression, exact-match
// before fuzzy, the ≥ 80% threshold, the `~probable-dup` flag, single-source
// findings carrying their own coverage. The supersession is recorded in
// `specs/plan/M121.md`; nothing here was deleted to make room for it.
//
// Every assertion in this block was also RE-SCOPED, and that repair is
// independent of the rename. The anchor below used to be
// `body.search(/Cross-tracker dedup/i)`, which resolved to the skill's
// DESCRIPTION LINE at :10 and sliced 99.3% of the document — so these tests
// asserted only that their phrases existed *somewhere*, and renaming the
// heading they are named for reddened nothing.
describeIfPresent("AC-STE-224.10 (field superseded by AC-STE-453.4/.5) — cross-leg dedup heuristic", () => {
  /** The dedup section proper, with the anchor proven to hold its subject. */
  function dedupSection(): string {
    const body = skill!;
    const at = body.indexOf("#### Cross-leg dedup");
    expect(at).toBeGreaterThan(-1);
    const tail = body.slice(at + 1);
    const next = tail.search(/\n#### \S/);
    const section = next === -1 ? tail : tail.slice(0, next);
    // Non-vacuity (follow-ups.md § 0i): a slice-anchored pin has no idea what
    // it is holding. Prove the window contains the mechanism before asserting
    // anything about it.
    expect(section).toContain("Exact-match pass");
    expect(section.length).toBeLessThan(body.length / 2);
    return section;
  }

  test("dedup section names both passes (exact-match + fuzzy overlap)", () => {
    const section = dedupSection();
    expect(section).toMatch(/Exact-match pass/i);
    expect(section).toMatch(/Fuzzy-overlap pass/i);
  });

  test("exact-match pass uses the STE-<N> runtime regression diagnostic line", () => {
    expect(dedupSection()).toMatch(/STE-<N> runtime regression: <fixture>/);
  });

  test("fuzzy-overlap pass uses ≥80% normalized-body substring overlap", () => {
    const section = dedupSection();
    expect(section).toMatch(/(>=|≥)\s*80%/);
    expect(section).toMatch(/normalized?[\s-]?body/i);
    expect(section).toMatch(/substring overlap/i);
  });

  test("multi-leg dedup hits carry an N-way legs: list, derived from SMOKE_LEGS", () => {
    // REPLACES `/tracker-coverage:\s*\[linear,\s*jira\]/`. Not deleted:
    // deleting it would relax AC-STE-224.10, which is the move this milestone
    // forbids. Derived rather than restated, so a fourth leg cannot leave the
    // dedup prose describing a stale set.
    const section = dedupSection();
    expect(section).toMatch(/`legs:` list/);
    // The substantive property, not the punctuation: the list is populated
    // from whichever legs actually matched, so it has no fixed arity.
    expect(section).toMatch(/every (later )?leg that (matched|surfaced)/i);
    expect(section).toContain("SMOKE_LEGS");
    for (const leg of SMOKE_LEGS) {
      expect(section, `dedup prose does not reach leg ${leg}`).toContain(leg);
    }
  });

  test("fuzzy-overlap hits carry the ~probable-dup flag for operator review", () => {
    const section = dedupSection();
    expect(section).toContain("~probable-dup");
    expect(section).toMatch(/operator review/i);
  });

  test("single-leg findings carry a one-element legs: list, one form per registered leg", () => {
    // REPLACES the `[linear]` / `[jira]` pair. The old form named two legs by
    // hand and would have gone on passing while the tracker-less leg had no
    // single-source form at all.
    const section = dedupSection();
    for (const leg of SMOKE_LEGS) {
      expect(section, `no single-leg legs: form for ${leg}`).toMatch(
        new RegExp(`legs:\\s*\\[${leg}\\]`),
      );
    }
  });

  test("aggregated entry is never duplicated — exactly one entry per unique regression", () => {
    expect(dedupSection()).toMatch(/never duplicated|exactly one entry/i);
  });
});
