// consume_scaffold_plan — STE-481: `/setup`'s bootstrap plan is CONSUMED by
// `/spec-write`'s tracker-less minted branch, never left beside it.
//
// THE DEFECT. `/setup` step 8 scaffolds `specs/plan/M1.md` carrying
// `kind: scaffolding`. `/spec-write` under `mode: none` then mints an
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
// class-(5) inventory, which calls `specs/plan/M1.md` a deliverable "emitted
// unconditionally" — trading one untrue shipped surface for another. Consuming
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
// PRESERVATION. The rename is in place and the body below the frontmatter is
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
  const split = splitFrontmatter(raw);
  if (split === null) return null;

  const lines: string[] = [];
  let milestoneIndex = -1;
  for (const line of split.lines) {
    if (KIND_LINE_RE.test(line) || ID_LINE_RE.test(line)) continue;
    if (milestoneIndex < 0 && MILESTONE_LINE_RE.test(line)) {
      milestoneIndex = lines.length;
      lines.push(`milestone: ${milestoneId}`);
      continue;
    }
    lines.push(line);
  }

  const idLine = `id: ${id}`;
  if (milestoneIndex >= 0) lines.splice(milestoneIndex + 1, 0, idLine);
  else lines.push(`milestone: ${milestoneId}`, idLine);

  return joinFrontmatter(split, lines);
}

/**
 * Consume `/setup`'s bootstrap scaffold into this milestone's plan file.
 *
 * Four outcomes, exhaustively:
 *
 *   - no `identity.id` (tracker mode) ⇒ `{ consumed: false, from: null, to }`,
 *     and the scaffold is untouched on disk. Tracker mode keeps `plan/M1.md`.
 *   - no scaffold ⇒ `{ consumed: false, from: null, to }` and `to` is NOT
 *     created; the caller writes a fresh plan there.
 *   - scaffold + `id` ⇒ the scaffold is renamed in place to
 *     `<planDir>/<milestoneId>.md` with its frontmatter rewritten and its body
 *     preserved byte-for-byte.
 *   - `<milestoneId>.md` already present ⇒ THROW. A plan is never clobbered,
 *     and the scaffold is left exactly where it was.
 *
 * The write lands at the OLD path before the rename, and the original bytes are
 * restored if the rename then fails: a half-consumed scaffold — rewritten
 * identity under the old filename, or the new filename over the old content —
 * is worse than the duplicate this closes.
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

  if (existsSync(to)) {
    throw new Error(
      `consumeScaffoldPlan: ${to} already exists — refusing to consume ${from} over an existing ` +
        `plan. Milestone ${identity.milestoneId} is already allocated; re-mint, or resolve the ` +
        `two plans by hand.`,
    );
  }

  const raw = readFileSync(from, "utf-8");
  const body = rewriteConsumedFrontmatter(raw, identity.milestoneId, id);
  if (body === null) {
    throw new Error(
      `consumeScaffoldPlan: ${from} has no YAML frontmatter block to record the minted id: in — ` +
        `renaming it would produce a minted-shaped plan with no identity, which gate probe #73 ` +
        `fails outright. Repair the scaffold's frontmatter, or declare kind: legacy to opt out.`,
    );
  }

  writeFileSync(from, body, "utf-8");
  try {
    renameSync(from, to);
  } catch (error) {
    // Put the scaffold back exactly as it was, then surface the real cause.
    try {
      writeFileSync(from, raw, "utf-8");
    } catch {
      // Intentionally swallowed — it must not mask the rename failure.
    }
    throw error;
  }

  return { consumed: true, from, to };
}
