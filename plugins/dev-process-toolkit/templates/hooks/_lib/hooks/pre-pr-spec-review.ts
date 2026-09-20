// STE-290 — Pre-PR spec-review enforcement (per-hook entrypoint).
// STE-615 — request recognition in every shape, and a resolved target.
//
// Refusing hook: blocks pull-request-creating Bash calls when no
// `dev-process-toolkit:spec-review` Skill tool_use is present in the current
// session transcript AND vouched for by a receipt for the checkout the request
// is opened from. Other commands early-exit 0; unparseable stdin fails open.
//
// AC-STE-615.3 — the retired matcher is GONE, not kept as a fast path. It was a
// regex anchored at the start of the command line, so it saw a request only
// when the CLI was the line's first word: every careful shape (`cd <B> && …`, a
// subshell, a `&&` chain after a push, a newline) walked straight past the gate,
// while a bare `--help` — which opens nothing — was refused. Both halves of that
// were wrong, and such a regex kept "for speed" would keep answering first. Its
// spelling is deliberately not repeated here: AC-STE-615.5 scans this source for
// it, and a comment quoting it verbatim would be indistinguishable from the
// fast path returning.
//
// STE-614 — the question this gate asks now carries a repository, exactly as
// the commit gates' does: the evidence is graded per checkout, through the SAME
// composer (`gateEvidenceTarget`), so the third gate joins the one rule rather
// than growing a third reading of it.

import {
  emitNFR10,
  harnessAbsent,
  oneLine,
  parseHookPayload,
  requireSkillToolUse,
} from "../session.ts";
import { resolvePrTargetFromPayload } from "../../../../adapters/_shared/src/pr_target_repo.ts";
// `checkoutRootOf` comes from the RECEIPT module, not from a target resolver:
// the session's own root is a key into the receipt store, and the store keys on
// git's own top level, realpath'd. The commit gates read it from the same
// place, so the three gates cannot disagree about which checkout a session is in.
import {
  checkoutRootOf,
  gateEvidenceTarget,
} from "../../../../adapters/_shared/src/gate_receipt.ts";

// The Skill this gate demands and the gate's own registered name are spelled
// out at every use, as both commit gates spell theirs. `tests/_blocking_gates.ts`
// learns the set of refusing gates from these sources, and it reads the demand
// call's first two arguments as STRING LITERALS: hoisted into constants they
// become identifiers, the derivation cannot name the gate, and a reader whose
// whole job is to notice a gate goes blind to this one.

/** An NFR-10 `Reminder:`, then exit 1: visible and non-blocking (the commit gates' idiom). */
function remind(sentence: string, remedy: string): never {
  emitNFR10(
    "Reminder",
    sentence,
    remedy,
    "dev-process-toolkit:spec-review",
    "pre-pr-spec-review",
  );
  process.exit(1);
}

const stdin = await Bun.stdin.text();
const payload = parseHookPayload(stdin);
// STE-614 AC.2 — the ONE fail-open leg, asked BEFORE any other verdict: empty
// or unparseable stdin, or a `transcript_path` naming a file that is not there.
if (!payload || harnessAbsent(payload)) {
  process.exit(0);
}
// The shared gh grammar, not a regex: `pr create` and `pr new` in every shape
// the shell can carry them, and nothing that merely reads a request or asks for
// help.
const target = resolvePrTargetFromPayload(payload);
if (!target.isPr) {
  process.exit(0);
}
// AC-STE-615.3 — a KNOWN-FOREIGN target is refused EVEN WITH THE EVIDENCE. A
// spec-review run here reviewed this checkout; the request lands in another
// repository, and evidence about one repository cannot vouch for another. So
// this leg is asked before the evidence leg, because no amount of evidence
// changes its answer.
//
// The remedy names the SKILL and the checkout to run it in — never the receipt
// front door. An operator who could mint a receipt by hand could satisfy a gate
// that never ran, which is the one failure the whole receipt leg exists to make
// impossible.
if (target.foreign !== null) {
  const local = target.candidateRoots[0] ?? payload.cwd ?? process.cwd();
  emitNFR10(
    "Refusing",
    `this request names the repository ${oneLine(target.foreign)}, which no remote of ` +
      `${oneLine(local)} matches, so a dev-process-toolkit:spec-review run in this ` +
      `checkout is not evidence about it.`,
    `open the request from the checkout of ${oneLine(target.foreign)} itself, and run ` +
      `/dev-process-toolkit:spec-review there first.`,
    "dev-process-toolkit:spec-review",
    "pre-pr-spec-review",
  );
  process.exit(2);
}
// STE-614 AC.9 — WHERE this request is opened from, described for the one rule
// to grade. Which roots that becomes, and which count as vouching peers, is
// decided ONCE, beside the rule, rather than assembled again in each hook.
const { found } = requireSkillToolUse(
  "dev-process-toolkit:spec-review",
  "pre-pr-spec-review",
  payload,
  gateEvidenceTarget("dev-process-toolkit:spec-review", payload.session_id, {
    roots: target.repoRoots,
    unplaced: target.unplaced,
    candidateRoots: target.candidateRoots,
    sessionRoot: checkoutRootOf(payload.cwd ?? process.cwd()),
  }),
);
if (!found) {
  process.exit(2);
}
// AC-STE-615.4 — the evidence holds for every checkout this request could be
// opened from, but the guard still could not place the target, and that is
// worth saying out loud. The ORDER is the whole of it: without the evidence the
// request is refused (exit 2), and only once the evidence holds does an
// unresolved target downgrade to this reminder. Exit 1, not 0: a PreToolUse
// exit 0 surfaces no stderr at all, so an exit-0 notice would be a silent
// allow — and the request is opened either way.
if (target.unplaced) {
  remind(
    `${oneLine(target.unresolved ?? "the request's target repository is unplaced")}.`,
    "re-run the command naming the repository it opens a request into, and run " +
      "/dev-process-toolkit:spec-review for that checkout if the gate has not seen it.",
  );
}
process.exit(0);
