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

import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, sep } from "node:path";

import {
  emitNFR10,
  findSkillToolUse,
  harnessAbsent,
  oneLine,
  parseHookPayload,
  relayedAnnouncements,
  requireSkillToolUse,
} from "../session.ts";
import { resolvePrTargetFromPayload } from "../../../../adapters/_shared/src/pr_target_repo.ts";
// `checkoutRootOf` comes from the RECEIPT module, not from a target resolver:
// the session's own root is a key into the receipt store, and the store keys on
// git's own top level, realpath'd. The commit gates read it from the same
// place, so the three gates cannot disagree about which checkout a session is in.
import {
  announcesGateReceiptFor,
  checkoutRootOf,
  GATE_RECEIPT_KIND,
  gateEvidenceTarget,
  headOf,
  sessionReceiptFiles,
} from "../../../../adapters/_shared/src/gate_receipt.ts";
import {
  isBranchArchiveOnly,
  isRemoteHeadEqualToHead,
  isWorkingTreeClean,
} from "../../../../adapters/_shared/src/archive_only_change.ts";
import { receiptsRoot } from "../../../../adapters/_shared/src/dpt_paths.ts";
import { receiptDigest } from "../../../../adapters/_shared/src/tracker_receipts.ts";

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

/** A realpath, or null when the path cannot be resolved. */
function real(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

/**
 * STE-733 AC.3 — the relay: whether ANOTHER session S's spec-review receipt R,
 * in `root`'s receipt store, vouches for the request this session opens.
 * Every condition must hold:
 *   - R is a gate receipt of dev-process-toolkit:spec-review filed under S's
 *     store (S is not this session), naming this checkout;
 *   - R parses, and `evidence.head` equals HEAD, which equals the remote head;
 *   - S's transcript is `<projects>/<slug>/<S>.jsonl`, `<projects>` being the
 *     directory two levels above this session's transcript, reached through no
 *     symlink (its realpath is its own spelling, so nothing escapes the root);
 *   - that transcript holds a spec-review Skill call followed by a front-door
 *     run's result announcing R's path with a digest equal to R's bytes now;
 *   - the tracked working tree is clean.
 * Never throws: any failure to read is a `false`.
 */
function relayPermits(root: string, selfSession: string, selfTranscript: string): boolean {
  const subject = "dev-process-toolkit:spec-review";
  try {
    if (!isWorkingTreeClean(root)) return false;
    const head = headOf(root);
    if (head === null) return false;
    const realRoot = real(root);
    const selfReal = real(selfTranscript);
    if (realRoot === null || selfReal === null) return false;
    const projects = dirname(dirname(selfReal));
    const store = receiptsRoot(realRoot);
    if (!existsSync(store)) return false;
    const target = {
      roots: [] as string[],
      receiptLeg: () => null,
      announcesReceipts: (command: string) => announcesGateReceiptFor(command, subject),
    };
    for (const session of readdirSync(store).sort()) {
      if (session === selfSession) continue;
      let receipts: ReturnType<typeof sessionReceiptFiles>;
      try {
        receipts = sessionReceiptFiles(realRoot, session);
      } catch {
        continue; // a path-unsafe store name keys no session
      }
      const candidates = receipts.filter(
        (r) =>
          r.record.kind === GATE_RECEIPT_KIND &&
          r.record.subject === subject &&
          typeof r.record.root === "string" &&
          real(r.record.root) === realRoot &&
          r.record.evidence?.head === head,
      );
      if (candidates.length === 0) continue;
      // The one network call, asked only once a local candidate exists: a store
      // holding no other session's receipt for HEAD never contacts the remote.
      if (!isRemoteHeadEqualToHead(root)) return false;
      for (const slug of readdirSync(projects).sort()) {
        const transcript = join(projects, slug, `${session}.jsonl`);
        // Confinement: the realpath IS the spelling, one level below the root.
        if (real(transcript) !== transcript || dirname(dirname(transcript)) !== projects) continue;
        if (!transcript.startsWith(projects + sep)) continue;
        const announced = relayedAnnouncements(subject, transcript, target);
        if (announced === null) continue;
        for (const r of candidates) {
          // The digest of R's CURRENT bytes, which must also be the bytes parsed.
          const path = real(r.path);
          const digest = receiptDigest(readFileSync(r.path));
          if (path === null || digest !== receiptDigest(r.bytes)) continue;
          if (announced.some((a) => real(a.path) === path && a.digest === digest)) return true;
        }
      }
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * STE-733 AC.5 — whether `root`'s receipt store holds a spec-review gate
 * receipt filed under a session other than this one: the sign that this request
 * is a relay that did not hold, so the refusal names that route. A store with no
 * such receipt keeps the plain remedy byte-for-byte. Never throws.
 */
function anotherSessionHoldsReceipt(root: string, selfSession: string): boolean {
  try {
    const realRoot = real(root);
    if (realRoot === null) return false;
    const store = receiptsRoot(realRoot);
    if (!existsSync(store)) return false;
    for (const session of readdirSync(store)) {
      if (session === selfSession) continue;
      try {
        if (sessionReceiptFiles(realRoot, session).some(
          (r) => r.record.kind === GATE_RECEIPT_KIND && r.record.subject === "dev-process-toolkit:spec-review",
        )) return true;
      } catch {
        continue;
      }
    }
  } catch {
    return false;
  }
  return false;
}

const RELAY_REMEDY =
  "Or, if another session ran the review, relay it: that worker session's transcript must hold its " +
  "/dev-process-toolkit:spec-review Skill call followed by the gate_receipt.ts front-door run announcing " +
  "its spec-review receipt, whose digest still matches and whose evidence.head equals HEAD and the " +
  "pushed remote head, on a clean working tree.";

const stdin = await Bun.stdin.text();
const payload = parseHookPayload(stdin);
// STE-614 AC.2 — one of two evidence-free legs (the other: the
// archive-only pass of the commit and pull request gates), asked BEFORE any
// other verdict: empty or unparseable stdin, or a `transcript_path` naming a
// file that is not there.
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
// AC-STE-700.5 — a request placed in exactly one checkout whose branch diff
// against the PR base (from their merge-base) is archive-only needs no
// spec-review evidence: there is no implementation for the review to audit.
// The pass grades the CHECKED-OUT branch, so a request naming `--head`/`-H`
// (another branch, possibly carrying code) gets none.
if (!target.unplaced && !target.headNamed && target.repoRoots.length === 1 &&
  // STE-702 AC.2 — EVERY distinct base the command's creations name is graded.
  target.bases.length > 0 &&
  target.bases.every((base) => isBranchArchiveOnly(target.repoRoots[0]!, base)) &&
  // STE-702 — the pass grades the branch the pull request opens: the REMOTE
  // branch must hold exactly the checked-out commit. Asked last: it is the one
  // network call, paid only by a branch that is otherwise archive-only.
  isRemoteHeadEqualToHead(target.repoRoots[0]!)) {
  process.exit(0);
}
// STE-733 AC.3 — the relay, asked only when this session holds no spec-review
// evidence of its own, and only for a request placed in exactly one checkout
// opening its checked-out branch.
if (
  !findSkillToolUse("dev-process-toolkit:spec-review", payload).found &&
  !target.unplaced && !target.headNamed && target.repoRoots.length === 1 &&
  relayPermits(target.repoRoots[0]!, payload.session_id, payload.transcript_path)
) {
  process.exit(0);
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
  !target.unplaced && target.repoRoots.length === 1 &&
    anotherSessionHoldsReceipt(target.repoRoots[0]!, payload.session_id)
    ? RELAY_REMEDY
    : undefined,
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
