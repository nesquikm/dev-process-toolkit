// The claim-commit fence's negative table — one entry per way the shipped
// `--grep` pattern can be widened, each paired with a subject that ONLY the
// un-widened pattern rejects.
//
// Why a table and not three inline mutations (STE-460, AC.1–AC.3). The shipped
// negative amended a claim subject by one byte (`claim lock` → `claim Lock`) and
// asserted the fence found nothing. That is a real negative, but it is only a
// negative with respect to the bytes it reworded: the leading `^` and the
// trailing space of the pattern were both measured GREEN under exactly the two
// widenings STE-461 performs. A rejection on its own proves nothing — a subject
// nothing ever matches is rejected by a healthy pattern and by a widened one
// alike, which is precisely how the one-byte rewording stayed green.
//
// So each entry carries BOTH halves:
//
//   subject(frId, branch)  a commit subject the SHIPPED pattern must REJECT
//   widen(fence)           the same fence with EXACTLY one widening applied,
//                          under which that subject must be ACCEPTED
//
// The accept/reject flip is what makes the negative discriminating, and it is
// what the consuming suites assert. Every widening is a widening in the strict
// sense — the healthy `LocalProvider.claimLock` subject still matches after it —
// so a flip is attributable to the pattern byte the label names and to nothing
// else. A "widening" that rejected the healthy subject would be a rewrite, and
// the flip would say nothing about `^` or the trailing space.

/** The single `--grep="…"` occurrence carried by each claim fence. */
const GREP_RE = /--grep="([^"]*)"/;

/**
 * Rewrite a fence's `--grep` pattern and THROW if the rewrite changed nothing.
 *
 * `specs/notes/follow-ups.md` § 0b: a mutation that silently no-ops reads as
 * "the change made no difference" rather than "the mutation missed". A widening
 * that failed to apply would turn the falsifiability arm into an assertion that
 * the SHIPPED pattern accepts the negative subject — loud is the only safe
 * failure here.
 */
function rewriteGrep(fence: string, widen: (pattern: string) => string, label: string): string {
  const m = GREP_RE.exec(fence);
  if (m === null) {
    throw new Error(`${label}: the fence carries no --grep="…" pattern to widen`);
  }
  const shipped = m[1]!;
  const widened = widen(shipped);
  if (widened === shipped) {
    throw new Error(`${label}: widening did not apply to the pattern ${JSON.stringify(shipped)}`);
  }
  return `${fence.slice(0, m.index)}--grep="${widened}"${fence.slice(m.index + m[0].length)}`;
}

export interface ClaimFenceNegative {
  /** Names the ONE widening this arm is about. Checked against the bytes. */
  label: string;
  /** A subject the shipped pattern must reject, built from the fixture's identity. */
  subject(frId: string, branch: string): string;
  /** The fence with exactly this arm's widening applied. */
  widen(fence: string): string;
}

/** The healthy subject `LocalProvider.claimLock` writes. Never a negative. */
function healthy(frId: string, branch: string): string {
  return `chore(locks): claim lock for ${frId} on ${branch}`;
}

export const CLAIM_FENCE_NEGATIVES: ClaimFenceNegative[] = [
  {
    // Carried forward from the shipped negative, unchanged in substance: the
    // two new arms are ADDITIVE, not a trade. It still proves the pattern is
    // not `.*`, which neither arm below does.
    label: "one-byte-rewording",
    subject: (frId, branch) => `chore(locks): claim Lock for ${frId} on ${branch}`,
    widen: (fence) =>
      rewriteGrep(fence, (p) => p.replace("claim lock", "claim [lL]ock"), "one-byte-rewording"),
  },
  {
    // The anchor. A subject that CONTAINS the claim line but does not START
    // with it: rejected while `^` is present, matched the moment it is gone.
    label: "anchor-drop",
    subject: (frId, branch) => `wip: squashed ${healthy(frId, branch)}`,
    widen: (fence) =>
      rewriteGrep(
        fence,
        (p) => {
          if (!p.startsWith("^")) {
            throw new Error(`anchor-drop: pattern is not anchored: ${JSON.stringify(p)}`);
          }
          return p.slice(1);
        },
        "anchor-drop",
      ),
  },
  {
    // The trailing space. A subject that ENDS at the id — the `on <branch>`
    // tail dropped — so the pattern's terminating space has nothing to match.
    // This is the exact shape STE-461's repair produces, which is why it is
    // guarded before that FR lands rather than after.
    label: "trailing-space-drop",
    subject: (frId) => `chore(locks): claim lock for ${frId}`,
    widen: (fence) =>
      rewriteGrep(
        fence,
        (p) => {
          if (!p.endsWith(" ")) {
            throw new Error(`trailing-space-drop: pattern is not space-terminated: ${JSON.stringify(p)}`);
          }
          return p.slice(0, -1);
        },
        "trailing-space-drop",
      ),
  },
];
