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

/**
 * The claim-subject grep, and any grep at all. TWO INDEPENDENT PREDICATES.
 *
 * They are matched against the same fence text but they are not the same
 * expression and neither is computed from the other: `CLAIM_GREP_RE` requires
 * the claim subject, `ANY_GREP_RE` requires only that a `--grep` exists. A
 * fence carrying `--grep="^chore(locks): release lock for …"` satisfies the
 * second and not the first — that constructible disagreement is what makes the
 * divergence throw below able to fire, and a derivation whose two sides cannot
 * disagree is one expression wearing two names.
 */
export const CLAIM_GREP_RE = /--grep="\^?chore\(locks\): claim lock for /;
export const ANY_GREP_RE = /--grep="/;

/**
 * The fences carrying the claim-subject grep, DERIVED rather than listed.
 *
 * This replaced `const CLAIM_FENCE_INDICES = [1, 2]`, which was complete when
 * measured and asserted by nothing: a fourth claim fence would have been
 * silently unguarded, which is the exact failure the rest of this FR repairs.
 *
 * NEITHER PREDICATE IS USED ALONE, and the reason is measured rather than
 * cautious. Broad alone over-matches: an unrelated `--grep` fence added to this
 * group later would join the set, the claim negatives would run against it, and
 * a healthy run would go RED. Precise alone under-matches silently: if a later
 * FR renames the claim subject, this returns fewer indices and the coverage
 * shrinks without a word — the very defect being repaired here, one level up
 * and better disguised. Divergence between the two is the signal that the world
 * moved, and a throw naming both sets lets a human decide which kind of fence
 * arrived rather than having one predicate quietly win.
 */
export function claimFenceIndices(fences: string[]): number[] {
  const claim = fences.flatMap((f, i) => (CLAIM_GREP_RE.test(f) ? [i] : []));
  const anyGrep = fences.flatMap((f, i) => (ANY_GREP_RE.test(f) ? [i] : []));
  if (claim.length === 0) {
    throw new Error(
      "claimFenceIndices: no fence in fixture group 10 carries the claim-subject " +
        "grep. Either the group lost its witness fences or the subject was renamed " +
        "without updating CLAIM_GREP_RE — both are unguarded coverage, not zero work.",
    );
  }
  if (claim.length !== anyGrep.length) {
    throw new Error(
      `claimFenceIndices: the two predicates disagree — claim=[${claim}] ` +
        `anyGrep=[${anyGrep}]. A fence in this group carries a --grep that is not ` +
        `the claim subject. Decide whether it is a claim fence and widen ` +
        `CLAIM_GREP_RE, or scope it out deliberately; do not let either predicate ` +
        `win silently.`,
    );
  }
  return claim;
}
