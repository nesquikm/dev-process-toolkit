// consume_scaffold_plan — STE-481: `/setup`'s bootstrap plan is CONSUMED by
// `/spec-write`'s tracker-less minted branch, never left beside it.
//
// THE DEFECT, as it stood when STE-481 closed it. `/setup` step 8 scaffolded
// `specs/plan/M1.md` in EVERY mode, carrying `kind: scaffolding` — STE-537 has
// since made that name mode-conditional, so under `mode: none` the scaffold now
// arrives already named `specs/plan/M_<tail>.md`, and only the tracker modes
// still see `M1.md`. `/spec-write` under `mode: none` then minted an
// `M_<short-ULID>` identity and wrote a SECOND plan file next to it, so a
// freshly bootstrapped tracker-less project carried two active plans under two
// naming schemes — and nothing went red, because probe #73's `kind: scaffolding`
// exemption is exactly what silenced the sequential one.
//
// WHY CONSUME RATHER THAN "DO NOT SCAFFOLD UNDER `mode: none`". The scaffold's
// content is not boilerplate: `/setup` step 8 pre-fills it with concrete file
// paths and gate commands, and its `<scaffolding>` FR row is live vocabulary
// read downstream by `plan_only_archival.ts` (plan-only closure) and
// `tracker_local_reconciliation_drift.ts` (drift suppression). Skipping the
// scaffold would throw both away AND falsify `skills/setup/SKILL.md`'s
// class-(5) inventory, which calls the bootstrap plan a deliverable "emitted
// unconditionally" — trading one untrue shipped surface for another. Since
// STE-537 that sentence names both filename shapes under a mode qualifier, so
// the deliverable it promises is the plan, not the literal `M1.md`; the
// unconditional half is what this module still has to keep true. Consuming
// keeps every one of those claims true as written.
//
// THE `id` GATE. Consumption is gated on the presence of `identity.id`, and
// that is a structural rail rather than a stylistic one: `resolveMilestoneIdentity`
// returns an `id` on the `mode: none` branch ALONE (the tracker branches must
// omit the key entirely, because probe #73 fails a tracker-mode plan carrying
// one). Keying off the `id` therefore makes consuming a tracker-mode scaffold
// impossible by construction, where keying off a `mode` argument would make it
// merely discouraged — one mis-threaded parameter away from renaming a Linear
// project's `M1.md` out from under its tracker.
//
// PRESERVATION. The rename MOVES the file and the body below the frontmatter is
// carried through byte-for-byte via `splitFrontmatter`/`joinFrontmatter`, which
// also preserve the file's BOM and its frontmatter line endings. A
// delete-and-write-fresh implementation would produce the same FILE COUNT and
// lose precisely the seeded content this direction was chosen to keep.
//
// `specs/plan/archive/` is out of scope on both sides: an archived scaffold is
// never consumed, and the target is only ever written into the active dir.
// Renaming an archived plan is what the archive-coherence probe (#63) forbids.

import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FrontmatterSplit } from "./frontmatter";
import { joinFrontmatter, parseFrontmatter, splitFrontmatter } from "./frontmatter";
import type { MilestoneIdentity } from "./resolve_milestone_identity";

/**
 * The `kind:` value `/setup` step 8 stamps on the bootstrap plan. Only THIS
 * kind is consumable — `kind: legacy` declares a plan the operator has
 * deliberately opted out of identity policing, and renaming it would be the
 * opposite of what that declaration asks for.
 */
export const SCAFFOLD_PLAN_KIND = "scaffolding";

/** The outcome of one consumption attempt. */
export interface ScaffoldConsumption {
  /** True only when a scaffold was actually renamed into `to`. */
  consumed: boolean;
  /** Absolute path of the consumed scaffold, or null when nothing was consumed. */
  from: string | null;
  /**
   * Absolute path of this milestone's plan file. Named ALWAYS, created only
   * when `consumed` is true — minting names a plan file, it never creates one,
   * and the caller writes a fresh plan here when `consumed` is false.
   */
  to: string;
}

const MILESTONE_LINE_RE = /^milestone:\s*/;
const KIND_LINE_RE = /^kind:\s*/;
const ID_LINE_RE = /^id:\s*/;

/** `<specsDir>/plan` — the ACTIVE plan directory. `archive/` is never walked. */
function activePlanDir(specsDir: string): string {
  return join(specsDir, "plan");
}

/**
 * Put `original` back at `file`, swallowing a failure of the restore ITSELF.
 *
 * ONE helper for all three write sites, so the three restores cannot drift into
 * three subtly different recoveries. The swallow is the load-bearing half: the
 * caller always rethrows the error that sent it here, and a restore that threw
 * on top would replace the real cause (ENOSPC, EFBIG, EACCES) with a second
 * error about the recovery — leaving the operator debugging the wrong failure.
 */
function restoreOrSwallow(file: string, original: string): void {
  try {
    writeFileSync(file, original, "utf-8");
  } catch {
    // Intentionally swallowed — it must not mask the failure being rethrown.
  }
}

/**
 * The ACTIVE plan under `<specsDir>/plan/` that declares `kind: scaffolding`,
 * or `null` when there is none.
 *
 * Non-recursive on purpose — `specs/plan/archive/` is out of scope.
 *
 * Candidates are every `*.md` in the active dir rather than only the ones
 * matching `PLAN_FILENAME_RE`: the discriminator here is the frontmatter key,
 * not the filename, and a scaffold whose name drifted off the canonical shape
 * is precisely the file that must still be consumed rather than silently left
 * behind as a second active plan. A non-plan `.md` sitting beside the plans
 * falls out for free — it does not declare `kind: scaffolding`.
 *
 * THE RESIDUAL THIS BREADTH LEAVES (STE-538 AC.7), recorded here because
 * nothing else records it. Gate probe #73 walks only names matching
 * `PLAN_FILENAME_RE`, so this walk is strictly broader than #73's and an
 * off-canonical scaffold is INVISIBLE to that probe. Consumption closes the
 * asymmetry BY RENAME, not by widening #73: a scaffold reached through here
 * is moved onto the canonical name, and the survivor is walked by #73 like
 * any other plan. Teaching #73 to walk every `*.md` instead would put it in
 * charge of policing every non-plan file under `specs/plan/`. What stays
 * unguarded is the LONE off-canonical scaffold nothing ever consumes —
 * `/spec-write` never reaches it, so #73 never sees it, and no gate reports
 * it. That shape is known and accepted; deleting this note deletes the only
 * record of it.
 *
 * `kind:` is read through `parseFrontmatter`, which normalises via
 * `normalizeFrontmatterSource`, so a CRLF- or BOM-prefixed scaffold resolves
 * its key like any other. Anchoring on a literal `---\n` here instead would
 * read such a file as having no frontmatter at all and report "no scaffold" —
 * the recurring blind spot, and silent in the direction that leaves the
 * duplicate plan on disk.
 *
 * Throws when the active dir holds MORE THAN ONE scaffolding plan. Picking one
 * arbitrarily would consume it and leave the other behind — the exact
 * two-active-plans state this module exists to close — and would do it
 * silently.
 */
export function findScaffoldPlan(specsDir: string): string | null {
  const planDir = activePlanDir(specsDir);

  let names: string[];
  try {
    names = readdirSync(planDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => entry.name)
      .sort();
  } catch {
    // No `specs/plan/` (or unreadable): nothing to consume, never a throw that
    // would take `/spec-write`'s milestone allocation down with it.
    return null;
  }

  return scaffoldsAmong(planDir, names);
}

/**
 * The scaffolding plans among `names`, resolved to absolute paths and reduced
 * to the single answer `findScaffoldPlan` promises.
 */
function scaffoldsAmong(planDir: string, names: string[]): string | null {
  const scaffolds: string[] = [];
  for (const name of names) {
    const file = join(planDir, name);
    let raw: string;
    try {
      raw = readFileSync(file, "utf-8");
    } catch {
      continue;
    }
    const kind = parseFrontmatter(raw, { lenient: true })["kind"];
    if (typeof kind === "string" && kind.trim() === SCAFFOLD_PLAN_KIND) scaffolds.push(file);
  }

  if (scaffolds.length > 1) {
    throw new Error(
      `consumeScaffoldPlan: ${scaffolds.length} active plans declare kind: ${SCAFFOLD_PLAN_KIND} ` +
        `(${scaffolds.join(", ")}) — consuming one would leave the others behind as extra active ` +
        `plans. Resolve them by hand (archive or re-declare kind:) before minting a milestone.`,
    );
  }
  return scaffolds[0] ?? null;
}

/** The result of the frontmatter pass both consumption legs share. */
interface SharedFrontmatterRewrite {
  /** The split to hand back to `joinFrontmatter` untouched. */
  split: FrontmatterSplit;
  /** Frontmatter lines with `kind:` dropped and `milestone:` retargeted. */
  lines: string[];
  /** Index INTO `lines` of the retargeted `milestone:` line, or -1 when absent. */
  milestoneIndex: number;
  /** True when at least one `id:` line was carried through. */
  sawId: boolean;
}

/**
 * The pass BOTH consumption legs share: split the frontmatter, drop the
 * `kind: scaffolding` line, and retarget the first `milestone:` line to the new
 * token, reporting where it landed.
 *
 * `id:` lines are carried through VERBATIM here and merely counted. Id-handling
 * is the one thing the two legs must NOT share — AC-STE-538.3 pins the adopted
 * leg's `id:` line byte-and-position identical precisely because the consumed
 * leg normalises it, and a flag selecting between them would demote that guard
 * from two distinct code paths to a runtime boolean. So each caller finishes
 * with its own id-handling and nothing here chooses for it.
 *
 * What this closes is drift in the part that is not about `id:` at all: a
 * further frontmatter key to strip, or a change to how `milestone:` is
 * retargeted, now lands once instead of in two byte-identical loops that a
 * future edit could touch only one of.
 *
 * Returns `null` when there is no frontmatter block; both callers turn that
 * into the same refusal.
 */
function rewriteSharedFrontmatter(
  raw: string,
  milestoneId: string,
): SharedFrontmatterRewrite | null {
  const split = splitFrontmatter(raw);
  if (split === null) return null;

  const lines: string[] = [];
  let milestoneIndex = -1;
  let sawId = false;
  for (const line of split.lines) {
    if (KIND_LINE_RE.test(line)) continue;
    if (ID_LINE_RE.test(line)) sawId = true;
    if (milestoneIndex < 0 && MILESTONE_LINE_RE.test(line)) {
      milestoneIndex = lines.length;
      lines.push(`milestone: ${milestoneId}`);
      continue;
    }
    lines.push(line);
  }

  return { split, lines, milestoneIndex, sawId };
}

/**
 * Rewrite a scaffold's frontmatter for its new identity, carrying the body
 * through byte-for-byte.
 *
 * Three edits and no others: `milestone:` moves to the minted token (the plan
 * is a binding like any FR), the minted id is recorded VERBATIM as `id:`
 * (probe #73 re-derives the filename from that exact value), and the
 * `kind: scaffolding` line is DROPPED — not rewritten to some other kind. The
 * key has to go rather than change: a minted plan that still carried a `kind:`
 * key would re-enter the exemption the moment anything re-classified it, which
 * is how the duplicate stayed invisible in the first place.
 *
 * Any pre-existing `id:` line is dropped alongside it, so the result carries
 * exactly one identity — two `id:` keys are an ambiguous identity probe #73
 * reports in its own right.
 *
 * Returns `null` when the plan carries no frontmatter block to write into. The
 * caller treats that as a refusal rather than a skipped step: renaming such a
 * file to `M_<tail>.md` would produce a minted-shaped plan carrying no `id:`,
 * which probe #73 hard-fails outright — strictly worse than the duplicate.
 */
function rewriteConsumedFrontmatter(raw: string, milestoneId: string, id: string): string | null {
  const shared = rewriteSharedFrontmatter(raw, milestoneId);
  if (shared === null) return null;

  // The shared pass carries `id:` lines through for the ADOPTED leg; this leg
  // wants none of them. Dropped by INDEX rather than by re-matching the
  // milestone line, so `milestoneIndex` stays exact — an `id:` line sitting
  // ABOVE `milestone:` shifts where the normalised one has to be spliced in.
  const lines: string[] = [];
  let milestoneIndex = -1;
  for (const [index, line] of shared.lines.entries()) {
    if (ID_LINE_RE.test(line)) continue;
    if (index === shared.milestoneIndex) milestoneIndex = lines.length;
    lines.push(line);
  }

  const idLine = `id: ${id}`;
  if (milestoneIndex >= 0) lines.splice(milestoneIndex + 1, 0, idLine);
  else lines.push(`milestone: ${milestoneId}`, idLine);

  return joinFrontmatter(shared.split, lines);
}

/**
 * The refusal both consumption legs raise when a scaffold has no writable
 * frontmatter block. ONE message for both, because the two legs differ in what
 * they do to the file, not in what is wrong with it.
 */
function noFrontmatterError(from: string): Error {
  return new Error(
    `consumeScaffoldPlan: ${from} has no YAML frontmatter block to record the minted id: in — ` +
      `renaming it would produce a minted-shaped plan with no identity, which gate probe #73 ` +
      `fails outright. Repair the scaffold's frontmatter, or declare kind: legacy to opt out.`,
  );
}

/**
 * Rewrite an ADOPTED scaffold's frontmatter in place (STE-538).
 *
 * Two edits, one fewer than the rename leg: `milestone:` moves to the adopted
 * token and `kind: scaffolding` is DROPPED, for the same reasons as above. The
 * recorded `id:` line is carried through VERBATIM — position, spacing and all —
 * because on this leg it is the identity being adopted, not one being written
 * over: the value the caller passes was READ from this very line. Re-emitting a
 * normalised copy would move a key that nothing asked to move, and would make
 * "adoption changed the recorded identity" indistinguishable from "adoption
 * preserved it" on the only surface that records either.
 *
 * A scaffold with no `id:` line cannot reach here through adoption, but the
 * fallback appends one rather than returning a plan whose frontmatter records
 * no identity — probe #73 hard-fails that outright.
 *
 * Returns `null` when the plan carries no frontmatter block, exactly as
 * `rewriteConsumedFrontmatter` does; the caller refuses on that.
 */
function rewriteAdoptedFrontmatter(raw: string, milestoneId: string, id: string): string | null {
  const shared = rewriteSharedFrontmatter(raw, milestoneId);
  if (shared === null) return null;

  // Every `id:` line the shared pass carried through is left exactly where and
  // as it was — this leg adds one only when the scaffold had none.
  const { lines } = shared;
  if (shared.milestoneIndex < 0) lines.push(`milestone: ${milestoneId}`);
  if (!shared.sawId) lines.push(`id: ${id}`);

  return joinFrontmatter(shared.split, lines);
}

/**
 * Consume `/setup`'s bootstrap scaffold into this milestone's plan file.
 *
 * Five outcomes, exhaustively:
 *
 *   - no `identity.id` (tracker mode) ⇒ `{ consumed: false, from: null, to }`,
 *     and the scaffold is untouched on disk. Tracker mode keeps `plan/M1.md`.
 *   - no scaffold ⇒ `{ consumed: false, from: null, to }` and `to` is NOT
 *     created; the caller writes a fresh plan there.
 *   - scaffold ALREADY NAMED `<milestoneId>.md` (the adopted identity, STE-538)
 *     ⇒ rewritten IN PLACE and `{ consumed: true, from: to, to }`. No rename,
 *     no second file, and the recorded `id:` line survives verbatim. This case
 *     is decided BEFORE the clobber guard below on purpose: since STE-537 the
 *     scaffold already carries its final name, so an adopted identity makes
 *     `to` the scaffold ITSELF and the guard would refuse the very file it
 *     exists to protect.
 *   - scaffold under some OTHER name + `id` ⇒ the scaffold is renamed to
 *     `<planDir>/<milestoneId>.md` with its frontmatter rewritten and its body
 *     preserved byte-for-byte.
 *   - a DIFFERENT file already at `<milestoneId>.md` ⇒ THROW. A plan is never
 *     clobbered, and the scaffold is left exactly where it was.
 *
 * BOTH consumption legs restore the scaffold's original bytes when their write
 * step fails, and on both the restore's OWN failure is swallowed so it cannot
 * mask the real cause. On the rename leg the rewritten bytes land at the OLD
 * path first, so the original goes back if the rename then fails; on the
 * in-place leg it goes back if the write itself throws. A half-consumed
 * scaffold — rewritten identity under the old filename, the new filename over
 * the old content, or a plan truncated mid-write — is worse than the duplicate
 * this closes, so neither leg is allowed to leave one.
 */
export function consumeScaffoldPlan(
  specsDir: string,
  identity: MilestoneIdentity,
): ScaffoldConsumption {
  const to = join(activePlanDir(specsDir), `${identity.milestoneId}.md`);
  const untouched: ScaffoldConsumption = { consumed: false, from: null, to };

  // THE STRUCTURAL RAIL. Only `resolveMilestoneIdentity`'s `mode: none` branch
  // returns an `id`, so a tracker-mode identity cannot reach the rename below
  // however this is called. Checked before the scaffold walk so a tracker-mode
  // project is never even inspected for one.
  const id = identity.id;
  if (id === undefined || id.length === 0) return untouched;

  const from = findScaffoldPlan(specsDir);
  if (from === null) return untouched;

  // THE ADOPTION LEG (STE-538), ahead of the clobber guard by necessity: the
  // scaffold IS the destination, so routing it into `existsSync(to)` would
  // refuse the file the guard exists to keep. Nothing is renamed and nothing
  // below this branch runs.
  if (from === to) {
    const rawInPlace = readFileSync(from, "utf-8");
    const rewritten = rewriteAdoptedFrontmatter(rawInPlace, identity.milestoneId, id);
    if (rewritten === null) throw noFrontmatterError(from);
    try {
      writeFileSync(from, rewritten, "utf-8");
    } catch (error) {
      // Put the scaffold back exactly as it was, then surface the real cause.
      // The same restore the rename leg runs: this write TRUNCATES before it
      // fills, so a throw partway leaves a half-written plan on disk.
      restoreOrSwallow(from, rawInPlace);
      throw error;
    }
    return { consumed: true, from, to };
  }

  if (existsSync(to)) {
    throw new Error(
      `consumeScaffoldPlan: ${to} already exists — refusing to consume ${from} over an existing ` +
        `plan. Milestone ${identity.milestoneId} is already allocated; re-mint, or resolve the ` +
        `two plans by hand.`,
    );
  }

  const raw = readFileSync(from, "utf-8");
  const body = rewriteConsumedFrontmatter(raw, identity.milestoneId, id);
  if (body === null) throw noFrontmatterError(from);

  // BOTH writes on this leg restore, not just the rename. `writeFileSync`
  // truncates at open, so a throw PARTWAY through this first write leaves the
  // scaffold corrupted under its own name — the identical failure class the
  // in-place leg guards, and the one place this leg used to leave uncovered
  // while the docstring above claimed otherwise.
  try {
    writeFileSync(from, body, "utf-8");
  } catch (error) {
    restoreOrSwallow(from, raw);
    throw error;
  }
  try {
    renameSync(from, to);
  } catch (error) {
    // Put the scaffold back exactly as it was, then surface the real cause.
    restoreOrSwallow(from, raw);
    throw error;
  }

  return { consumed: true, from, to };
}
