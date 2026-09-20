// STE-290 — Pre-commit gate-check enforcement (per-hook entrypoint).
// STE-597 — commit recognition in all three shapes.
//
// Refusing hook: blocks commit-bearing Bash calls when no
// `dev-process-toolkit:gate-check` Skill tool_use is present in the current
// session transcript. Other commands early-exit 0; unparseable stdin
// fails open.
//
// AC-STE-597.3 — the commit is recognised in the same three shapes the sibling
// /tdd hook recognises (bare, `cd <dir> && git commit`, `git -C <dir> commit`),
// closing the same bypass: the retired `/^git commit\b/` matcher saw no commit
// in the two careful shapes and waved them straight through.
//
// This hook deliberately gains NO staged-path classification: inventing a
// classification it does not perform is out of scope, and an UNRESOLVABLE
// target therefore spoils nothing here — `isCommit` is still true and the
// evidence is still required.
//
// STE-614 — the question it asks DOES now carry a repository. "Was /gate-check
// run in this session?" was answerable once per session and then spent
// everywhere, which is how a gate run for one checkout let a commit into
// another one through (HS-1). So the evidence is graded per checkout the
// command writes to, and for a target that cannot be placed, per checkout it
// could write to.

import {
  emitNFR10,
  harnessAbsent,
  oneLine,
  parseHookPayload,
  requireSkillToolUse,
} from "../session.ts";
import { resolveCommitTargetFromPayload } from "../../../../adapters/_shared/src/commit_target_repo.ts";
// `checkoutRootOf` comes from the RECEIPT module, not from the commit resolver:
// the session's own root is a key into the receipt store, and the store keys on
// git's own top level, realpath'd. The sibling /tdd hook reads it from the same
// place, so the two gates cannot disagree about which checkout a session is in.
import {
  checkoutRootOf,
  gateEvidenceTarget,
} from "../../../../adapters/_shared/src/gate_receipt.ts";

/** An NFR-10 `Reminder:`, then exit 1: visible and non-blocking (the sibling /tdd hook's idiom). */
function remind(sentence: string, remedy: string): never {
  emitNFR10("Reminder", sentence, remedy, "dev-process-toolkit:gate-check", "pre-commit-gate-check");
  process.exit(1);
}

const stdin = await Bun.stdin.text();
const payload = parseHookPayload(stdin);
// STE-614 AC.2 — the ONE fail-open leg, asked BEFORE any other verdict: empty
// or unparseable stdin, or a `transcript_path` naming a file that is not there.
if (!payload || harnessAbsent(payload)) {
  process.exit(0);
}
// The SAME front door the sibling /tdd hook uses, so "is this a commit?" cannot
// be answered one way here and another way there.
const target = resolveCommitTargetFromPayload(payload);
if (!target.isCommit) {
  // AC-STE-601.9 — `pull`, `rebase`, `stash` and the writing `notes` forms are
  // out of scope for this gate but never silent. Exit 1, not 0: the harness
  // shows no stderr on exit 0. Exit 1 is visible and lets the command proceed.
  if (target.advisory !== null) {
    remind(
      `${target.advisory}.`,
      "run /dev-process-toolkit:gate-check yourself if this changes what you are about to ship.",
    );
  }
  process.exit(0);
}
// STE-614 AC.9 — WHERE this commit writes, described for the one rule to grade.
// `repoRoots` carries the checkouts a PLACED commit writes to: one, or every one
// of several (`git -C A commit && git -C B commit`), or none when the directory
// it named holds no checkout at all. An UNPLACED commit could land anywhere, so
// `gateEvidenceTarget` grades it against the session's own checkout plus every
// root the command named — which is what stops `sudo git -C <B> commit`, a
// wrapper the reader cannot see through around a literal foreign target, from
// getting easier treatment than the bare `git -C <B> commit` it runs.
//
// Which roots that becomes, and which count as vouching peers, is decided ONCE,
// beside the rule, rather than assembled again in each hook.
const { found } = requireSkillToolUse(
  "dev-process-toolkit:gate-check",
  "pre-commit-gate-check",
  payload,
  gateEvidenceTarget("dev-process-toolkit:gate-check", payload.session_id, {
    roots: target.repoRoots,
    unplaced: target.unplaced,
    candidateRoots: target.candidateRoots,
    sessionRoot: checkoutRootOf(payload.cwd ?? process.cwd()),
  }),
);
if (!found) {
  // AC-STE-601.11 — an unplaced commit (`GIT_DIR=<B>/.git git commit`) still
  // needs the evidence, but the refusal names the checkouts it could write to,
  // so the operator sees WHICH repository the refused commit was aimed at.
  if (target.repoRoot === null && target.candidateRoots.length > 0) {
    process.stderr.write(
      `Target: ${oneLine(target.unresolved ?? "unplaced")}; candidate checkouts: ${oneLine(target.candidateRoots.join(", "))}\n`,
    );
  }
  process.exit(2);
}
// STE-614 AC.9 — the evidence holds in every checkout this command could land
// in, but the guard still could not say WHICH, and that is worth saying out
// loud. Exit 1, not 0: a PreToolUse exit 0 surfaces no stderr at all, so an
// exit-0 notice would be a silent allow — and the command runs either way.
if (target.unplaced) {
  remind(
    `${oneLine(target.unresolved ?? "the commit's target repository is unplaced")}.`,
    "re-run the command naming the checkout it commits to, and run " +
      "/dev-process-toolkit:gate-check for that checkout if the gate has not seen it.",
  );
}
process.exit(0);
