// M121 / STE-461 — the EXECUTED half. E1 (the instance) and E2 (the class),
// plus AC.1, AC.3–AC.8 and AC.15.
//
// THE DEFECT, as measured rather than as it reads.
// `LocalProvider.claimLock` builds `chore(locks): claim lock for ${id} on
// ${branch}`. The fixed part costs 62 characters — a 29-character prefix, a
// 29-character minted id, and 4 for ` on ` — and the `commit-msg` hook this
// toolkit installs into every project it bootstraps rejects any subject over
// 72. So the branch may be at most TEN characters, while the toolkit's own
// branch convention routinely produces 35. Executed: `main` (4) → 66 accepted;
// `feat/m121-mode-none-conformance-leg` (35) → 97 refused.
//
// WHY NO TEST COULD HAVE CAUGHT IT, and why that is the finding rather than a
// footnote. Nothing in this suite has ever installed a hook into a
// lock-provider fixture. Every `claimLock` test commits into a hook-free repo,
// so the toolkit's producer and the toolkit's own gate had never met. The full
// gate was green over a shipped defect because the collision was unreachable by
// construction, not because it was rare.
//
// TWO EXPERIMENTS, AND THE SECOND IS THE POINT.
//
//   E1 — the instance. Real shipped hook, real `claimLock`, branches of 4, 35
//        and 68 characters. Three byte-identical subjects, each within the cap,
//        three commits that LAND.
//   E2 — the class. A legal subject, but a `pre-commit` hook that exits 1 — a
//        rejection with nothing to do with subject length. The exception must
//        PROPAGATE, the tree must be clean, the lock must be gone.
//
// E1 alone would license a subject-only patch. E2 is what says the failure MODE
// is the subject of the repair: a downstream project's own hook, a signing
// failure, a full disk all reach the same split state, in which the lock exists
// with no witness commit and `/implement` refuses at Phase 1 exit forever.
//
// THE TRAP THIS FILE IS BUILT AROUND (`specs/plan/M121.md`, fixture group 10
// mutation 3). "The tree is clean after the failure" is satisfied JUST AS WELL
// by a provider that threw before writing anything as by one that wrote, staged
// and rolled back. A mutation that merely relocates the throw would redden
// nothing and would be recorded as evidence of a working rollback. So every
// rollback assertion here is paired with the `pre-commit` hook's OWN
// observation of what was staged at the moment it ran: the hook cannot have run
// unless the write and the stage happened first, and it cannot report a staged
// lock unless the lock was really there.

import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  attempt,
  buildHookedFixture,
  CLAIM_SUBJECT_PREFIX,
  cleanup,
  git,
  gitTry,
  installCustomCommitMsgHook,
  installedCommitMsgHookBytes,
  installRejectingPreCommit,
  isMissingCommitlintDependency,
  lastBody,
  lastSubject,
  lockExists,
  porcelain,
  proveHookAccepts,
  proveHookRejects,
  provider,
  RELEASE_SUBJECT_PREFIX,
  SHIPPED_COMMIT_MSG_HOOKS,
  shippedCommitlintCap,
  shippedCommitlintOverriddenRules,
  shippedShellHookCap,
  stagedWhenHookRan,
  subjects,
} from "./_hooked-lock-fixture";
import { describeLockCleanupFailure } from "../adapters/_shared/src/local_provider";

// One id across all three E1 repos. Byte-identity of the three subjects is only
// a claim about the BRANCH if everything else about them is held fixed.
const ID = "fr_01HZ7XJFKP0000000000000E1A";

/** An id long enough that even the branch-free subject breaches the cap. */
const LONG_ID = `fr_${"L".repeat(45)}`;

const B4 = "main";
const B35 = "feat/m121-mode-none-conformance-leg";
const B68 = "feat/m121-subject-must-not-scale-with-the-branch-name-experiment-e1x";

/**
 * The claim subject, DERIVED from the shipped module rather than restated here.
 *
 * MEASURED DEFECT this repairs. As a test-local constant
 * (`${CLAIM_SUBJECT_PREFIX}${ID}`) this string was independent of the producer,
 * so restoring ` on ${branch}` to `local_provider.ts` reddened 45 tests across
 * six files and left the commitlint arm GREEN — the arm whose whole claim is
 * "conformance is asserted against BOTH shipped hooks". A subject the producer
 * does not emit cannot demonstrate conformance for the producer.
 *
 * The regex requires the template to END after `${id}`, so the branch-bearing
 * form does not merely produce a different string — it fails to match at all
 * and throws here, which is the loud form.
 */
function producerClaimSubject(id: string): string {
  const src = readFileSync(
    join(import.meta.dir, "..", "adapters/_shared/src/local_provider.ts"),
    "utf8",
  );
  const m = /const subject = `(chore\(locks\): claim lock for \$\{id\})`;/.exec(src);
  if (m === null) {
    throw new Error(
      "producerClaimSubject: local_provider.ts's claim subject template is not the " +
        "branch-free form this suite asserts conformance for. Deriving rather than " +
        "restating is deliberate: a private copy stayed green under exactly the " +
        "producer regression it existed to catch.",
    );
  }
  return m[1]!.replace("${id}", id);
}

const EXPECTED_SUBJECT = producerClaimSubject(ID);
const CAP = 72;

const PRE_COMMIT_REJECTION = "pre-commit: policy-denied by the STE-461 fixture";

// ═════════════════════════ AC-STE-461.15 — the harness ═══════════════════════
//
// First, because everything below is worthless if the hook is not really there
// and really running. A `commit-msg` hook that is not executable is skipped by
// git IN SILENCE, and an experiment run in such a repo passes while measuring
// nothing at all.

describe("AC-STE-461.15 — a real shipped hook, really installed, really running", () => {
  test("both shipped commit-msg hooks exist as files the harness can install", () => {
    expect(Object.keys(SHIPPED_COMMIT_MSG_HOOKS).sort()).toEqual(["commitlint", "shell"]);
    for (const [variant, path] of Object.entries(SHIPPED_COMMIT_MSG_HOOKS)) {
      expect({ variant, exists: existsSync(path) }).toEqual({ variant, exists: true });
    }
  });

  test("EXECUTED: the installed hook is the shipped bytes, verbatim — not a paraphrase", () => {
    for (const variant of ["shell", "commitlint"] as const) {
      const f = buildHookedFixture({ branch: B4, commitMsgHook: variant, label: "ste461-bytes" });
      try {
        expect({ variant, bytes: installedCommitMsgHookBytes(f) }).toEqual({
          variant,
          bytes: readFileSync(SHIPPED_COMMIT_MSG_HOOKS[variant], "utf8"),
        });
      } finally {
        cleanup(f);
      }
    }
  });

  test("EXECUTED: the shell hook is LIVE — it refuses an over-long subject and accepts a legal one", () => {
    const f = buildHookedFixture({ branch: B4, commitMsgHook: "shell", label: "ste461-live" });
    try {
      const refused = proveHookRejects(f);
      expect(refused.exitCode).not.toBe(0);
      expect(refused.stderr).toContain("commit-msg: subject-too-long");
      // The control. Without it, "the hook refuses" is indistinguishable from
      // "this repo refuses every commit", and the whole harness would be
      // measuring an unrelated failure.
      expect(proveHookAccepts(f).exitCode).toBe(0);
    } finally {
      cleanup(f);
    }
  });

  test("EXECUTED: a hook-FREE control repo accepts the same over-long subject", () => {
    // This is what attributes the refusal above to the hook rather than to git,
    // to the branch name, or to the fixture's own setup. It is also the shape
    // every `claimLock` test in this suite has silently been until now.
    const f = buildHookedFixture({ branch: B4, commitMsgHook: null, label: "ste461-nohook" });
    try {
      expect(installedCommitMsgHookBytes(f)).toBeNull();
      expect(proveHookRejects(f).exitCode).toBe(0);
    } finally {
      cleanup(f);
    }
  });

  test("EXECUTED: the harness carries a LocalProvider that writes into the hooked repo", async () => {
    const f = buildHookedFixture({ branch: B4, commitMsgHook: "shell", label: "ste461-wired" });
    try {
      const outcome = await attempt(() => provider(f).claimLock(ID, B4));
      expect({ threw: outcome.threw, message: outcome.message }).toEqual({
        threw: false,
        message: null,
      });
      expect(lockExists(f, ID)).toBe(true);
    } finally {
      cleanup(f);
    }
  });
});

// ══════════════════════ E1 — the instance (AC-STE-461.1/.2) ══════════════════

describe("E1 — the instance: three branches, one subject (AC-STE-461.1, AC-STE-461.2)", () => {
  test("the three fixture branches really are 4, 35 and 68 characters", () => {
    expect([B4.length, B35.length, B68.length]).toEqual([4, 35, 68]);
  });

  test("EXECUTED: the OLD subject form is what the shipped hook refuses — the defect, measured", () => {
    // The falsifiability floor for everything below, and the arithmetic in the
    // FR's § Requirement reproduced by execution rather than restated. It runs
    // the RETIRED subject shape directly against the real hook, so it holds
    // before and after the repair and pins WHY the repair is needed.
    const f = buildHookedFixture({ branch: B4, commitMsgHook: "shell", label: "ste461-oldform" });
    try {
      const rows = [B4, B35, B68].map((branch) => {
        const old = `${CLAIM_SUBJECT_PREFIX}${ID} on ${branch}`;
        const run = gitTry(f.root, "commit", "--allow-empty", "--quiet", "-m", old);
        if (run.exitCode === 0) git(f.root, "reset", "--hard", "--quiet", "HEAD~1");
        return { branch: branch.length, length: old.length, accepted: run.exitCode === 0 };
      });
      expect(rows).toEqual([
        { branch: 4, length: 66, accepted: true },
        { branch: 35, length: 97, accepted: false },
        { branch: 68, length: 130, accepted: false },
      ]);
    } finally {
      cleanup(f);
    }
  }, 30_000);

  test("EXECUTED: three shipped-hook repos, byte-identical subjects, three landed commits", async () => {
    const observed: { branch: number; subject: string; body: string; porcelain: string; lock: boolean; landed: boolean }[] = [];
    for (const branch of [B4, B35, B68]) {
      const f = buildHookedFixture({ branch, commitMsgHook: "shell", label: "ste461-e1" });
      try {
        // The hook is live in THIS repo, not merely in the one the liveness
        // test built. A per-fixture proof, because that is the assumption an
        // experiment like this dies on.
        expect({ branch: branch.length, hookLive: proveHookRejects(f).exitCode !== 0 }).toEqual({
          branch: branch.length,
          hookLive: true,
        });
        const outcome = await attempt(() => provider(f).claimLock(ID, branch));
        expect({ branch: branch.length, threw: outcome.threw, message: outcome.message }).toEqual({
          branch: branch.length,
          threw: false,
          message: null,
        });
        observed.push({
          branch: branch.length,
          subject: lastSubject(f),
          body: lastBody(f),
          porcelain: porcelain(f),
          lock: lockExists(f, ID),
          landed: subjects(f).length === 2,
        });
      } finally {
        cleanup(f);
      }
    }

    // BYTE-IDENTICAL — the subject stopped being a function of the branch.
    expect(new Set(observed.map((o) => o.subject)).size).toBe(1);
    expect(observed.map((o) => o.subject)).toEqual([
      EXPECTED_SUBJECT,
      EXPECTED_SUBJECT,
      EXPECTED_SUBJECT,
    ]);
    // …and within the cap the shipped hook actually enforces, read from the
    // shipped script rather than restated as a literal.
    expect(shippedShellHookCap()).toBe(CAP);
    expect(observed.map((o) => o.subject.length)).toEqual([58, 58, 58]);
    // The commits LANDED, and landed clean.
    expect(observed.map((o) => o.landed)).toEqual([true, true, true]);
    expect(observed.map((o) => o.porcelain)).toEqual(["", "", ""]);
    expect(observed.map((o) => o.lock)).toEqual([true, true, true]);
    // AC-STE-461.1 — the branch is PRESERVED, on a body line. The hook
    // validates only the first non-blank non-comment line, so the body is
    // unconstrained however long the branch gets.
    expect(observed.map((o) => o.body.includes(`branch: ${B4}`))).toEqual([true, false, false]);
    expect(observed[1]!.body).toContain(`branch: ${B35}`);
    expect(observed[2]!.body).toContain(`branch: ${B68}`);
  }, 60_000);

  test("EXECUTED: conformance against the --commitlint variant", async () => {
    // TWO ARMS, and the second exists because the first cannot be relied on to
    // discriminate here. The shipped `--commitlint` hook execs `bunx commitlint`,
    // which resolves `@commitlint/config-conventional` FROM THE REPO UNDER TEST.
    // This repo deliberately does not depend on commitlint
    // (`tests/commitlint-config.test.ts` says so and simulates the rule instead),
    // so in a temp fixture the resolution fails and the hook refuses EVERY
    // subject, conforming or not.
    //
    // Arm 1 (config-derived, always runs, never vacuous): the cap is read out of
    // the SHIPPED `commitlint.config.js`, the override list is asserted to be
    // exactly `header-max-length` — which is what "delegates every other rule
    // upstream" means — and all three subjects are measured against it.
    //
    // Arm 2 (executed, opportunistic but LOUD): the real hook runs. It must
    // either accept, or refuse for a reason that is NOT a lint violation. A
    // `header-max-length` failure fails this arm on any machine, resolvable or
    // not, because the rule name would appear in the output.
    const cap = shippedCommitlintCap();
    expect({ cap, overrides: shippedCommitlintOverriddenRules() }).toEqual({
      cap: CAP,
      overrides: ["header-max-length"],
    });
    const checked = [B4, B35, B68].map((branch) => ({
      branch: branch.length,
      subject: EXPECTED_SUBJECT,
      withinCap: EXPECTED_SUBJECT.length <= cap,
    }));
    expect(checked).toEqual([
      { branch: 4, subject: EXPECTED_SUBJECT, withinCap: true },
      { branch: 35, subject: EXPECTED_SUBJECT, withinCap: true },
      { branch: 68, subject: EXPECTED_SUBJECT, withinCap: true },
    ]);

    const f = buildHookedFixture({ branch: B35, commitMsgHook: "commitlint", label: "ste461-cl" });
    try {
      const outcome = await attempt(() => provider(f).claimLock(ID, B35));
      const run = gitTry(f.root, "commit", "--allow-empty", "--quiet", "-m", EXPECTED_SUBJECT);
      const text = `${run.stdout}\n${run.stderr}\n${outcome.message ?? ""}`;
      expect({
        landedOrMissingDep: run.exitCode === 0 || isMissingCommitlintDependency(run),
        namesALengthViolation: /header-max-length/.test(text),
        namesAnyRuleViolation: /\bfound \d+ problems?/.test(text),
      }).toEqual({
        landedOrMissingDep: true,
        namesALengthViolation: false,
        namesAnyRuleViolation: false,
      });
    } finally {
      cleanup(f);
    }
  }, 60_000);

  test("the module no longer builds the branch into the subject", () => {
    // Source-level companion to the executed arms. Not a substitute for them —
    // it is what stops the retired form returning under a green suite in a code
    // path the three experiments above do not happen to walk.
    const src = readFileSync(
      join(import.meta.dir, "..", "adapters/_shared/src/local_provider.ts"),
      "utf8",
    );
    expect(src).not.toContain("claim lock for ${id} on ${branch}");
    expect(src).toContain("chore(locks): claim lock for ${id}");
  });
});

// ═══════════════════ E2 — the class (AC-STE-461.4/.5/.6/.7) ══════════════════

describe("E2 — the class: a rejection unrelated to subject length (AC-STE-461.4, AC-STE-461.5)", () => {
  test("EXECUTED: the write really happened, and the tree is clean afterwards anyway", async () => {
    const f = buildHookedFixture({ branch: B35, commitMsgHook: "shell", label: "ste461-e2" });
    try {
      installRejectingPreCommit(f, { message: PRE_COMMIT_REJECTION });
      const outcome = await attempt(() => provider(f).claimLock(ID, B35));

      // AC-STE-461.5 — the rollback stops the wreckage; it must NOT convert a
      // loud failure into a silent one. A provider whose every claim silently
      // fails would be indistinguishable from one whose claims succeed.
      expect({ threw: outcome.threw, returned: outcome.returned }).toEqual({
        threw: true,
        returned: undefined,
      });

      // THE DISCRIMINATOR, and the reason this test is not satisfied by a
      // provider that threw before writing anything. The hook only runs after
      // `git add`, and it reports what the index held at that moment.
      const staged = stagedWhenHookRan(f);
      expect(staged).not.toBeNull();
      expect(staged!).toContain(`.dpt/locks/${ID}`);
      expect(staged!).toMatch(/^A\s/m);

      // AC-STE-461.4 — and having really written and staged it, the provider
      // put the tree back.
      expect(porcelain(f)).toBe("");
      expect(lockExists(f, ID)).toBe(false);
      expect(subjects(f)).toEqual(["chore: seed the tracker-less fixture"]);
    } finally {
      cleanup(f);
    }
  }, 30_000);

  test("EXECUTED: the diagnostic names the subject, its length, the cap and the rejection", async () => {
    // AC-STE-461.6. `\b58\b` is checked against the message with every copy of
    // the subject REMOVED first — the id is Crockford base32 and can contain
    // the digits of the count, so a naive search would pass on a message that
    // states no count at all.
    const f = buildHookedFixture({ branch: B35, commitMsgHook: "shell", label: "ste461-diag" });
    try {
      installRejectingPreCommit(f, { message: PRE_COMMIT_REJECTION });
      const outcome = await attempt(() => provider(f).claimLock(ID, B35));
      expect(outcome.threw).toBe(true);
      const message = outcome.message ?? "";
      expect(message).toContain(EXPECTED_SUBJECT);
      const withoutSubject = message.split(EXPECTED_SUBJECT).join("␟");
      expect(withoutSubject).toMatch(new RegExp(`\\b${EXPECTED_SUBJECT.length}\\b`));
      expect(withoutSubject).toMatch(/\b72\b/);
      // The underlying hook stderr, propagated rather than swallowed.
      expect(message).toContain(PRE_COMMIT_REJECTION);
    } finally {
      cleanup(f);
    }
  }, 30_000);

  test("EXECUTED: a stricter downstream commit-msg hook — the stderr says subject-too-long", async () => {
    // AC-STE-461.6's named scenario. The repaired subject is 58 characters, so
    // the SHIPPED 72-char hook can no longer produce a `subject-too-long`
    // rejection against it — which is the repair working. The class the FR
    // names ("a downstream project's own hook") is reproduced by taking the
    // shipped script and lowering its cap by exactly one measured byte change.
    const shipped = readFileSync(SHIPPED_COMMIT_MSG_HOOKS.shell, "utf8");
    const strict = shipped.replace('-gt 72 ]', '-gt 40 ]');
    if (strict === shipped) {
      throw new Error(
        "the stricter-hook derivation did not apply — the shipped hook's `-gt 72` " +
          "anchor moved. A mutation that silently no-ops reports 'no difference' " +
          "rather than 'my mutation missed' (follow-ups § 0b).",
      );
    }
    const f = buildHookedFixture({ branch: B35, commitMsgHook: "shell", label: "ste461-strict" });
    try {
      // No `pre-commit` hook here: it runs BEFORE `commit-msg` and would mask
      // the very rejecter this scenario is about.
      installCustomCommitMsgHook(f, strict);
      const outcome = await attempt(() => provider(f).claimLock(ID, B35));
      expect(outcome.threw).toBe(true);
      expect(outcome.message ?? "").toContain("commit-msg: subject-too-long");
      expect(porcelain(f)).toBe("");
      expect(lockExists(f, ID)).toBe(false);
    } finally {
      cleanup(f);
    }
  }, 30_000);
});

describe("AC-STE-461.7 — when the rollback itself fails, the original survives", () => {
  test("EXECUTED: both the original rejection AND a distinct cleanup clause are reported", async () => {
    // The sabotage makes the lock DIRECTORY read-only from inside the hook,
    // after the lock has been written and staged. The unstage can still
    // succeed; the unlink cannot. That is a cleanup failure produced by the
    // real filesystem rather than by an injected stub.
    const f = buildHookedFixture({ branch: B35, commitMsgHook: "shell", label: "ste461-cleanupfail" });
    try {
      installRejectingPreCommit(f, {
        message: PRE_COMMIT_REJECTION,
        sabotage: 'chmod 500 "$(git rev-parse --show-toplevel)/.dpt/locks"',
      });
      const outcome = await attempt(() => provider(f).claimLock(ID, B35));
      expect(outcome.threw).toBe(true);
      const message = outcome.message ?? "";

      // The sabotage really bit — otherwise this test would be asserting a
      // cleanup-failure clause on a run whose cleanup succeeded.
      expect(lockExists(f, ID)).toBe(true);

      // NEVER SUBSTITUTED. The original is what tells the operator why the
      // commit was refused; the cleanup failure is a second, separate fact.
      expect(message).toContain(PRE_COMMIT_REJECTION);
      // …and a DISTINCT clause naming the path that may remain staged.
      expect(message).toContain(`.dpt/locks/${ID}`);
      expect(message).toMatch(/clean\s*-?up|rollback|could not (?:remove|unstage|unlink)/i);
      // The two are separate clauses, not one sentence doing double duty: the
      // cleanup text appears somewhere the original does not occupy.
      expect(message.indexOf(PRE_COMMIT_REJECTION)).not.toBe(-1);
      expect(message.replace(PRE_COMMIT_REJECTION, "").length).toBeGreaterThan(
        EXPECTED_SUBJECT.length,
      );
    } finally {
      cleanup(f);
    }
  }, 30_000);
});

// ═════════════ AC-STE-461.3 — the pre-write cap, before any write ════════════

describe("AC-STE-461.3 — the cap is asserted BEFORE the lock is written", () => {
  test("EXECUTED: an over-long subject throws with nothing written, staged or committed", async () => {
    const f = buildHookedFixture({ branch: B4, commitMsgHook: "shell", label: "ste461-prewrite" });
    try {
      // The recording hook is installed precisely so its ABSENCE of an
      // observation is evidence. If the provider wrote and staged and only then
      // discovered the length, the hook would have run and left a file behind.
      installRejectingPreCommit(f, { message: "the commit path was reached — it should not have been" });
      const subject = `${CLAIM_SUBJECT_PREFIX}${LONG_ID}`;
      expect(subject.length).toBe(77);
      expect(subject.length).toBeGreaterThan(CAP);

      const outcome = await attempt(() => provider(f).claimLock(LONG_ID, B4));
      expect({ threw: outcome.threw, returned: outcome.returned }).toEqual({
        threw: true,
        returned: undefined,
      });
      expect(stagedWhenHookRan(f)).toBeNull();
      expect(lockExists(f, LONG_ID)).toBe(false);
      expect(porcelain(f)).toBe("");
      expect(subjects(f)).toEqual(["chore: seed the tracker-less fixture"]);

      const message = outcome.message ?? "";
      expect(message).toContain(subject);
      const withoutSubject = message.split(subject).join("␟");
      expect(withoutSubject).toMatch(/\b77\b/);
      expect(withoutSubject).toMatch(/\b72\b/);
    } finally {
      cleanup(f);
    }
  }, 30_000);
});

// ═══════ AC-STE-461.8 — all three lock subjects, not just the claim ══════════

describe("AC-STE-461.8 — release and stale-cleanup carry the same guard", () => {
  test("EXECUTED: a rejected release leaves no staged deletion — the lock is still held", async () => {
    // The reason this arm matters more than it looks: a rejected release leaves
    // `D .dpt/locks/<id>` staged, which READS as released and is not. The next
    // run resolves `already-released` against a lock that is still held.
    const f = buildHookedFixture({ branch: B35, commitMsgHook: "shell", label: "ste461-release" });
    try {
      const claimed = await attempt(() => provider(f).claimLock(ID, B35));
      expect(claimed.threw).toBe(false);
      const held = readFileSync(join(f.root, ".dpt", "locks", ID), "utf8");

      installRejectingPreCommit(f, { message: PRE_COMMIT_REJECTION });
      const outcome = await attempt(() => provider(f).releaseLock(ID));
      expect({ threw: outcome.threw, returned: outcome.returned }).toEqual({
        threw: true,
        returned: undefined,
      });

      // The hook ran, and what it saw was the staged DELETION — so the release
      // really got as far as mutating the index before it was refused.
      const staged = stagedWhenHookRan(f);
      expect(staged).not.toBeNull();
      expect(staged!).toContain(`.dpt/locks/${ID}`);
      expect(staged!).toMatch(/^D\s/m);

      // …and it was put back, content and all.
      expect(porcelain(f)).toBe("");
      expect(lockExists(f, ID)).toBe(true);
      expect(readFileSync(join(f.root, ".dpt", "locks", ID), "utf8")).toBe(held);
    } finally {
      cleanup(f);
    }
  }, 30_000);

  test("EXECUTED: releaseLock asserts its own subject's length before touching the index", async () => {
    const f = buildHookedFixture({ branch: B4, commitMsgHook: "shell", label: "ste461-relcap" });
    try {
      // Seed a lock for the over-long id WITHOUT going through claimLock —
      // claimLock now refuses it, and the subject under test here is the
      // release one (`chore(locks): release lock for <id>`, 31 + len(id)).
      mkdirSync(join(f.root, ".dpt", "locks"), { recursive: true });
      writeFileSync(
        join(f.root, ".dpt", "locks", LONG_ID),
        `ulid: ${LONG_ID}\nbranch: ${B4}\nclaimed_at: 2026-08-09T00:00:00Z\nclaimer: ste461@example.invalid\n`,
      );
      git(f.root, "add", "-A");
      git(f.root, "commit", "--quiet", "-m", "chore: seed an over-long lock id");

      const subject = `${RELEASE_SUBJECT_PREFIX}${LONG_ID}`;
      expect(subject.length).toBe(79);
      expect(subject.length).toBeGreaterThan(CAP);

      installRejectingPreCommit(f, { message: "the commit path was reached — it should not have been" });
      const outcome = await attempt(() => provider(f).releaseLock(LONG_ID));
      expect({ threw: outcome.threw, returned: outcome.returned }).toEqual({
        threw: true,
        returned: undefined,
      });
      expect(stagedWhenHookRan(f)).toBeNull();
      expect(porcelain(f)).toBe("");
      expect(lockExists(f, LONG_ID)).toBe(true);
      expect(outcome.message ?? "").toContain(subject);
    } finally {
      cleanup(f);
    }
  }, 30_000);

  test("EXECUTED: a rejected stale-cleanup leaves every lock in place", async () => {
    const f = buildHookedFixture({ branch: B4, commitMsgHook: "shell", label: "ste461-stale" });
    try {
      const p = provider(f);
      const ids = ["fr_01HZ7XJFKP0000000000000ST1", "fr_01HZ7XJFKP0000000000000ST2"];
      for (const [i, id] of ids.entries()) {
        const branch = `feat/stale-${i}`;
        git(f.root, "checkout", "--quiet", "-b", branch);
        const claimed = await attempt(() => p.claimLock(id, branch));
        expect({ id, threw: claimed.threw }).toEqual({ id, threw: false });
        git(f.root, "checkout", "--quiet", B4);
        git(f.root, "merge", "--quiet", "--no-ff", branch, "-m", `chore: merge ${branch}`);
        git(f.root, "branch", "--quiet", "-D", branch);
      }
      expect(await p.findStaleLocks()).toHaveLength(2);

      installRejectingPreCommit(f, { message: PRE_COMMIT_REJECTION });
      const outcome = await attempt(() => p.cleanupStaleLocks());
      expect({ threw: outcome.threw, returned: outcome.returned }).toEqual({
        threw: true,
        returned: undefined,
      });
      const staged = stagedWhenHookRan(f);
      expect(staged).not.toBeNull();
      expect(staged!).toMatch(/^D\s/m);
      expect(porcelain(f)).toBe("");
      expect(ids.map((id) => lockExists(f, id))).toEqual([true, true]);
    } finally {
      cleanup(f);
    }
  }, 60_000);

  test("EXECUTED: all three shipped lock subjects fit the cap on a healthy run", async () => {
    // STATED LIMIT, because an unfalsifiable arm dressed as a guard is what
    // this milestone keeps finding: the stale-cleanup subject is
    // `chore(locks): clean up N stale locks` — 36 characters plus the digits of
    // N — so it cannot breach 72 for any reachable N. Its cap arm is therefore
    // satisfied by construction and only its ROLLBACK arm above is load-bearing.
    // The claim and release subjects DO scale with the id, and those are the two
    // the pre-write assertion is really for.
    const f = buildHookedFixture({ branch: B68, commitMsgHook: "shell", label: "ste461-allthree" });
    try {
      const p = provider(f);
      const id = "fr_01HZ7XJFKP0000000000000A99";
      const staleId = "fr_01HZ7XJFKP0000000000000A98";

      git(f.root, "checkout", "--quiet", "-b", "feat/gone");
      expect((await attempt(() => p.claimLock(staleId, "feat/gone"))).threw).toBe(false);
      git(f.root, "checkout", "--quiet", B68);
      git(f.root, "merge", "--quiet", "--no-ff", "feat/gone", "-m", "chore: merge feat/gone");
      git(f.root, "branch", "--quiet", "-D", "feat/gone");

      expect((await attempt(() => p.claimLock(id, B68))).threw).toBe(false);
      const claimSubject = lastSubject(f);
      expect((await attempt(() => p.releaseLock(id))).threw).toBe(false);
      const releaseSubject = lastSubject(f);
      expect((await attempt(() => p.cleanupStaleLocks({ mainBranch: B68 }))).threw).toBe(false);
      const cleanupSubject = lastSubject(f);

      expect([claimSubject, releaseSubject, cleanupSubject]).toEqual([
        `${CLAIM_SUBJECT_PREFIX}${id}`,
        `${RELEASE_SUBJECT_PREFIX}${id}`,
        "chore(locks): clean up 1 stale lock",
      ]);
      expect([claimSubject, releaseSubject, cleanupSubject].map((s) => s.length <= CAP)).toEqual([
        true,
        true,
        true,
      ]);
      expect(porcelain(f)).toBe("");
    } finally {
      cleanup(f);
    }
  }, 60_000);

  test("the shipped stale-cleanup pin still names the subject it has always named", () => {
    // AC-STE-461.8 records that `local_provider.test.ts` pins the stale-cleanup
    // subject with `toMatch(/clean up 2 stale locks/)` — and that the pin is
    // INVISIBLE to a same-line two-term grep for `chore(locks)` + `claim lock`,
    // because it contains neither. Naming it here is what stops the third
    // subject being edited by a sweep that only ever saw two.
    const suite = readFileSync(
      join(import.meta.dir, "..", "adapters/_shared/src/local_provider.test.ts"),
      "utf8",
    );
    expect(suite).toContain("clean up 2 stale locks");
  });
});

// ═══════ The hook is installed but never bypassed — the rejected route ═══════

describe("--no-verify is not the repair (AC-STE-461 § Requirement, out of scope)", () => {
  test("no lock commit path passes --no-verify", () => {
    // Explicitly rejected in the FR: it contradicts the deterministic-gates
    // principle, teaches downstream users that bypassing their own gate is
    // normal, and leaves non-conforming subjects in histories other machinery
    // reads. Pinned so the cheapest way out of a future red is not that one.
    const src = readFileSync(
      join(import.meta.dir, "..", "adapters/_shared/src/local_provider.ts"),
      "utf8",
    );
    expect(src).not.toContain("--no-verify");
    // `-n` is `--no-verify`'s short form on `git commit`. Scoped to a commit
    // invocation so an unrelated `-n` in prose or in another flag cannot
    // satisfy or trip it.
    expect(src).not.toMatch(/git commit[^`\n]*\s-n(\s|`)/);
  });

  test("EXECUTED: the fixture's hook is not bypassed by the provider's own commits", async () => {
    // The behavioural form of the same claim: if `claimLock` bypassed the hook,
    // a repo whose hook refuses EVERYTHING would still get a commit.
    const f = buildHookedFixture({ branch: B35, commitMsgHook: null, label: "ste461-bypass" });
    try {
      installCustomCommitMsgHook(f, "#!/bin/sh\nprintf 'commit-msg: refuse-everything\\n' >&2\nexit 1\n");
      const outcome = await attempt(() => provider(f).claimLock(ID, B35));
      expect(outcome.threw).toBe(true);
      expect(subjects(f)).toEqual(["chore: seed the tracker-less fixture"]);
      expect(porcelain(f)).toBe("");
      expect(lockExists(f, ID)).toBe(false);
    } finally {
      cleanup(f);
    }
  }, 30_000);
});

// ═══ AC-STE-461.7 / .8 — the DIRECTION discriminant, which nothing observed ═══

describe("the cleanup diagnostic's two directions are distinguishable", () => {
  // MEASURED VACUITY THIS REPAIRS. The AUDIT killed the `removal` branch of
  // `describeLockCleanupFailure` and then collapsed its wording, running the FULL
  // gate after each: both returned 7178 pass / 15 skip / 0 fail / 20231 expect()
  // — BYTE-IDENTICAL to baseline. The branch existed to repair a backwards-remedy
  // defect (the write path's "remove it by hand" is exactly wrong for a lock that
  // is still held and only LOOKS released), and it was itself unexercised. The
  // executed rollback-failure scenario runs on the CLAIM path only, so no test
  // reached the removal direction at all.
  //
  // These are unit assertions on the exported formatter rather than another
  // fixture, deliberately: the defect is that the STRING is unobserved, and a
  // second sabotage fixture would cost minutes per run to assert what one call
  // asserts directly.

  const FAILURES = ["git rm --cached failed: permission denied"];

  test("the WRITE direction tells the operator to REMOVE the residue", () => {
    const msg = describeLockCleanupFailure({
      kind: "write",
      lockPath: ".dpt/locks/fr_X",
      failures: FAILURES,
    });
    expect(msg).toContain("may remain on disk and staged");
    expect(msg).toContain("remove it by hand");
    expect(msg).toContain(FAILURES[0]!);
    // …and must NOT give the opposite advice.
    expect(msg).not.toContain("Restore it by hand");
    expect(msg).not.toContain("READS as released");
  });

  test("the REMOVAL direction tells the operator to RESTORE it, and says why", () => {
    const msg = describeLockCleanupFailure({
      kind: "removal",
      lockPath: ".dpt/locks/fr_X",
      failures: FAILURES,
    });
    expect(msg).toContain("may remain DELETED with the deletion staged");
    expect(msg).toContain("Restore it by hand");
    // The REASON is the point — a staged deletion reads as a completed release
    // to anything checking absence, which is the predicate two FRs made two-sided.
    expect(msg).toContain("READS as released while the lock is still held");
    expect(msg).toContain(FAILURES[0]!);
    // …and must NOT give the write path's backwards advice.
    expect(msg).not.toContain("remove it by hand");
  });

  test("the two directions are not the same string", () => {
    const write = describeLockCleanupFailure({
      kind: "write",
      lockPath: ".dpt/locks/fr_X",
      failures: FAILURES,
    });
    const removal = describeLockCleanupFailure({
      kind: "removal",
      lockPath: ".dpt/locks/fr_X",
      failures: FAILURES,
    });
    expect(write).not.toBe(removal);
    // Collapsing the branch to a single arm is the exact mutation the full gate
    // could not see; this is what sees it.
    expect({ writeSaysRemove: /remove it by hand/.test(write), removalSaysRestore: /Restore it by hand/.test(removal) })
      .toEqual({ writeSaysRemove: true, removalSaysRestore: true });
  });

  test("an absent kind defaults to the WRITE direction", () => {
    const msg = describeLockCleanupFailure({ lockPath: ".dpt/locks/fr_X", failures: FAILURES });
    expect(msg).toContain("remove it by hand");
  });
});

// ═══ AC-STE-461.16 — a SUCCESSFUL fail-safe must not report itself as failed ══

describe("AC-STE-461.16 — the rollback only reports an unstage it actually needed", () => {
  test("EXECUTED: `git add` fails, the tree still comes back clean, and NO cleanup warning is emitted", async () => {
    // THE MEASURED DEFECT. A stale `.git/index.lock` — which any concurrent git
    // process leaves behind — makes `git add` fail BEFORE the commit is ever
    // attempted. The rollback still ran, `git rm --cached` failed on a path the
    // index had never held, that failure was collected, and the operator was
    // told the cleanup was incomplete and to remove a file by hand — while the
    // lock was gone and the tree was clean.
    //
    // A successful fail-safe reported as a failed one, with a remedy pointing at
    // a file that no longer exists. Same wrong-remedy shape as the write/removal
    // mix-up AC.7's branch prevents, one direction over.
    const f = buildHookedFixture({ branch: B4, commitMsgHook: "shell", label: "ste461-addfail" });
    try {
      writeFileSync(join(f.root, ".git", "index.lock"), "");
      const outcome = await attempt(() => provider(f).claimLock(ID, B4));

      // The exception still PROPAGATES — the guard must not have quieted it.
      expect(outcome.threw).toBe(true);
      // The fail-safe genuinely worked: no residue, clean tree.
      expect(lockExists(f, ID)).toBe(false);
      expect(porcelain(f)).toBe("");
      // …and it does NOT claim otherwise. These are the two assertions that
      // discriminate a correct report from a confidently incorrect one.
      expect(outcome.message ?? "").not.toContain("rollback ITSELF failed");
      expect(outcome.message ?? "").not.toContain("remove it by hand");
    } finally {
      rmSync(join(f.root, ".git", "index.lock"), { force: true });
      cleanup(f);
    }
  }, 30_000);

  test("the probe fails CLOSED — an unreadable index reports staged, never clean", () => {
    // Direction matters. Reporting "not staged" on a broken probe would SILENCE
    // a genuine incomplete cleanup; reporting "staged" at worst re-raises a
    // false alarm the operator can dismiss. This repository takes the loud
    // trade every time, and the source states the direction so a future edit
    // cannot flip it while looking like a simplification.
    const src = readFileSync(
      join(import.meta.dir, "..", "adapters/_shared/src/local_provider.ts"),
      "utf8",
    );
    const probe = /private async isPathStaged\([\s\S]*?\n  \}/.exec(src);
    expect(probe).not.toBeNull();
    expect(probe![0]).toContain("catch");
    // The catch arm returns true. Pinned as the whole return statement, not the
    // token — `true` alone occurs throughout the module.
    expect(probe![0]).toMatch(/catch\s*\{\s*return true;\s*\}/);
  });
});
