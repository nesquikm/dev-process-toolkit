// STE-733 — the pull-request gate's relay reads, kept out of the hook entry
// point. The guard family reads a transcript through `session.ts` alone
// (AC-STE-598.3): every filesystem read the relay needs — the receipt store,
// the other session's transcript directory, the receipt's current bytes —
// lives here, and `pre-pr-spec-review.ts` only asks the question.

import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, sep } from "node:path";

import { relayedAnnouncements } from "../../../templates/hooks/_lib/session.ts";
import {
  announcesGateReceiptFor,
  GATE_RECEIPT_KIND,
  headOf,
  sessionReceiptFiles,
} from "./gate_receipt.ts";
import { isRemoteHeadEqualToHead, isWorkingTreeClean } from "./archive_only_change.ts";
import { receiptsRoot } from "./dpt_paths.ts";
import { receiptDigest } from "./tracker_receipts.ts";

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
export function relayPermits(root: string, selfSession: string, selfTranscript: string): boolean {
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
export function anotherSessionHoldsReceipt(root: string, selfSession: string): boolean {
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
