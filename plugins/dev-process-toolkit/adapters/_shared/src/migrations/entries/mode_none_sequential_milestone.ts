// M119 STE-442 — repair entry: mis-named `mode: none` sequential milestone
// plans (AC-STE-442.1).
//
// A tracker-less (`mode: none`) project mints its milestone identity as
// `M_<tail>` from a ULID (v2.56.0 "Mint"). Plans created before that — or by a
// hand that spelled the old sequential `M<N>` form — carry no `id:` key and a
// filename the minting invariant rejects. This entry finds those plans and
// repairs the identity together with every binding that points at it.
//
// OVER-DETECTION, DELIBERATE: the registry contract makes `detect` a "pure,
// deterministic, filesystem-only predicate" (`../index.ts`), so this entry may
// NOT read git. Filenames are all it has. It therefore cannot part a genuinely
// legacy plan from a fresh one someone just mis-named, and offers to repair
// both. Gate probe #73 (`plan_identity_mode_conditional.ts`) is git-keyed — it
// classifies each plan's provenance from the commit that introduced it and
// fails only on the `fresh` ones — so the set detected here is deliberately
// WIDER than the set that probe reds on. That is safe rather than merely
// tolerable: `requires_explicit_approval: true` keeps the entry out of the
// auto-apply path, and `/upgrade`'s preview prints one evidence row per
// affected plan (AC-STE-442.3) before asking, so an operator who disagrees
// about any single plan sees it named and can decline the whole entry.
//
// VERSION: `introduced_in` is the SHIPPING release (2.59.0), not 2.56.0 —
// `coverage.ts` resolves the declaring plan's release against this field, so
// the release that carries the migration is the only value that ships.

import { readFileSync, readdirSync, renameSync, writeFileSync, type Dirent } from "node:fs";
import { basename, join, relative } from "node:path";
import { joinFrontmatter, parseFrontmatter, splitFrontmatter } from "../../frontmatter";
import { mintMilestoneId } from "../../mint_milestone_id";
import { PLAN_FILENAME_RE, parseMilestoneToken } from "../../milestone_token";
import { readTaskTrackingSection } from "../../resolver_config";
import type { ApplyResult, DetectResult, MigrationEntry } from "../index";

/**
 * `kind:` values that opt a plan out permanently, so a plan the operator cleared
 * for probe #73 is never re-offered for repair here. Carrying *a* `kind:` key
 * exempts nothing.
 *
 * A DELIBERATE COPY of the list in `plan_identity_mode_conditional.ts`, not a
 * shared import, and the duplication is the lesser evil rather than a tidiness
 * failure: that module pulls in `node:child_process` for its git provenance
 * query, and the registry contract requires every detector here to stay pure,
 * synchronous and network-free. Importing it would point a migration entry at a
 * gate probe and drag a process-spawning dependency into the detector path.
 *
 * The cost is real and worth stating: a THIRD exempt kind added to probe #73
 * would not reach this list, and this entry would go on offering to repair
 * plans the operator had already cleared at the gate. Whoever widens that list
 * has to widen this one in the same change.
 */
const EXEMPT_PLAN_KINDS: readonly string[] = ["scaffolding", "legacy"];

/** One repairable plan, resolved once so `detect` and the repair agree on the set. */
interface RepairablePlan {
  /** Absolute path to the plan file. */
  file: string;
  /** Project-relative path — what evidence rows and `changed` entries name. */
  rel: string;
  /** The sequential milestone token (`M5`), i.e. the basename without `.md`. */
  token: string;
  /** The plan's raw source, read once. */
  raw: string;
  /**
   * The plan's frontmatter, parsed once during the walk that admitted it.
   * Every later reader (the `shipped_in` guard) takes it from here rather than
   * re-parsing `raw`, so the walk's view of a plan and the repair's view of the
   * same plan cannot come from two different parses.
   */
  frontmatter: Record<string, unknown>;
}

/**
 * The project's declared tracker mode. An absent CLAUDE.md, an absent
 * `## Task Tracking` section and an empty `mode:` all resolve to `none` — the
 * reading `resolver_config` documents (AC-29.5) and probe #73 shares. A
 * detector that disagreed would leave the very plans the probe fails
 * unrepairable.
 */
function resolveMode(projectRoot: string): string {
  const mode = readTaskTrackingSection(join(projectRoot, "CLAUDE.md"))["mode"];
  return mode === undefined || mode.length === 0 ? "none" : mode;
}

/**
 * Every ACTIVE sequential plan under `specs/plan/` that still needs an identity.
 *
 * Non-recursive on purpose: `specs/plan/archive/` is out of scope, because
 * renaming an archived plan is exactly what the archive-coherence probe (#63)
 * forbids. Filenames ride the shared `milestone_token` union matcher, never a
 * private `M\d+` copy, so `README.md` / `notes.txt` and the minted (`M_<tail>`)
 * and Epic-keyed (`M_PROJ_500`) shapes all fall out of the walk for free.
 *
 * Names are sorted so two runs over the same tree agree exactly.
 */
function findRepairablePlans(projectRoot: string): RepairablePlan[] {
  const planDir = join(projectRoot, "specs", "plan");
  let names: string[];
  try {
    names = readdirSync(planDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && PLAN_FILENAME_RE.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch {
    // No `specs/plan/` (or unreadable): nothing to repair, never a throw that
    // would take the whole registry walk down with it.
    return [];
  }

  const plans: RepairablePlan[] = [];
  for (const name of names) {
    const token = basename(name, ".md");
    // Only the sequential branch of the grammar is mis-named: a minted plan
    // already carries its identity and an Epic-keyed one never had a ULID.
    if (parseMilestoneToken(token)?.kind !== "numeric") continue;

    const file = join(planDir, name);
    let raw: string;
    try {
      raw = readFileSync(file, "utf-8");
    } catch {
      continue;
    }

    // `lenient: true` + the shared normalizer, so a CRLF- or BOM-prefixed plan
    // resolves its keys like any other rather than silently reading as "no
    // frontmatter" — which would report an already-repaired plan as repairable.
    const fm = parseFrontmatter(raw, { lenient: true });
    if ("id" in fm) continue;

    const kind = fm["kind"];
    if (typeof kind === "string" && EXEMPT_PLAN_KINDS.includes(kind.trim())) continue;

    plans.push({ file, rel: relative(projectRoot, file), token, raw, frontmatter: fm });
  }
  return plans;
}

/**
 * Shared by `detect` and `apply`'s guard, so "did this fire?" and "is there
 * anything left to do?" can never answer differently.
 *
 * Pure, synchronous and filesystem-only per the registry contract: it reads
 * CLAUDE.md and `specs/plan/`, spawns nothing, and never writes. One `evidence`
 * row PER PLAN — `/upgrade` Step 3 renders the rows verbatim, so a merged row
 * would hide every plan after the first from the operator's approval.
 *
 * Detection behaviour is owned by AC-STE-442.3; the repair by AC-STE-442.4..7.
 */
function detectModeNoneSequentialMilestone(projectRoot: string): DetectResult {
  // Tracker mode owns milestone identity through the tracker, so no plan of any
  // shape is repairable here, however mis-named.
  if (resolveMode(projectRoot) !== "none") return { applies: false, evidence: [] };

  // `applies` is keyed on what apply WILL repair, not on what merely matches
  // the mis-named shape. AC-STE-442.6 requires a second run to "detect
  // nothing", and `/upgrade` Step 6 re-runs detect after applying and treats a
  // still-detecting entry as a bug in the entry, loudly. A shipped plan is
  // declined permanently by AC-STE-442.5, so counting it toward `applies`
  // would brand this entry buggy on every future run of every project holding
  // one — forever, and unclearably, on exactly the shape AC-STE-442.5 designs
  // for. Declined plans are still surfaced as evidence when the entry fires,
  // just never as the reason it fires.
  const { repairable, declined } = partitionByRepairability(findRepairablePlans(projectRoot));

  const evidence = [
    ...repairable.map(
      (plan) =>
        `${plan.rel} — tracker-less sequential milestone ${plan.token} carries no id: key and no kind: exemption; repair mints an id, renames the plan to the M_<tail>.md it derives, and rebinds every FR bound to ${plan.token}`,
    ),
    ...declined.map(
      (d) =>
        `${d.plan.rel} — tracker-less sequential milestone ${d.plan.token} is mis-named but NOT repairable by this entry (${d.reason}); reported only, never renamed`,
    ),
  ];

  return { applies: repairable.length > 0, evidence };
}

/** A plan this entry can see but will never rewrite, and why. */
interface DeclinedPlan {
  plan: RepairablePlan;
  reason: string;
}

/**
 * Split the mis-named plans into the ones `apply` will actually repair and the
 * ones it permanently declines.
 *
 * The declined set is the reason `detect` and `apply` can agree about "is there
 * anything left to do" across runs. Both predicates below are properties of the
 * plan's own bytes, so they are stable: a declined plan is declined on every
 * future run too, which is precisely what makes excluding it from `applies`
 * safe rather than a way to hide work.
 */
function partitionByRepairability(plans: RepairablePlan[]): {
  repairable: RepairablePlan[];
  declined: DeclinedPlan[];
} {
  const repairable: RepairablePlan[] = [];
  const declined: DeclinedPlan[] = [];

  for (const plan of plans) {
    const stamp = shippedIn(plan.frontmatter);
    if (stamp !== null) {
      // Renaming a shipped plan trips the ship-coherence probe (#63) — the
      // milestone token is already stamped into the changelog.
      declined.push({ plan, reason: `already shipped in ${stamp}` });
      continue;
    }
    if (!hasFrontmatterBlock(plan.raw)) {
      // The lenient walk admits a plan with no `---` block (it answers `{}`),
      // but there is nowhere to write the minted `id:`. Renaming it anyway
      // would produce an `M_<tail>.md` carrying no identity, which probe #73
      // hard-fails — strictly worse than the name being repaired.
      declined.push({ plan, reason: "no YAML frontmatter block to record the minted id: in" });
      continue;
    }
    repairable.push(plan);
  }

  return { repairable, declined };
}

/**
 * The plan's ship stamp, or `null` when it carries none. The `shipped_in: null`
 * sentinel the plan template scaffolds is NOT a stamp — `parseFrontmatter`
 * coerces it to a real `null`, so only a non-empty string counts. A shipped
 * plan is out of the repair's scope (AC-STE-442.4): its identity is already
 * cemented in a release.
 *
 * Reads the record the walk already parsed, never `raw` a second time.
 */
function shippedIn(frontmatter: Record<string, unknown>): string | null {
  const value = frontmatter["shipped_in"];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

const MILESTONE_LINE_RE = /^milestone:\s*(.*)$/;

/**
 * The `milestone:` key's value as written — quotes stripped, whitespace
 * trimmed — or `null` when the line is not a `milestone:` key at all.
 *
 * ONE place knows the line grammar, because both writers below depend on it for
 * different reasons: the FR sweep asks "does this binding point at the old
 * token?", the plan rewrite asks "which line do I anchor the `id:` insert on?".
 * Split across two call sites, a quoted `milestone: "M5"` could match for one
 * and miss for the other, and the FR sweep would then rebind an FR whose plan
 * never got renamed.
 */
function milestoneLineValue(line: string): string | null {
  const m = MILESTONE_LINE_RE.exec(line);
  if (m === null) return null;
  const value = (m[1] ?? "").trim();
  if (value.length >= 2) {
    const head = value[0];
    if ((head === '"' || head === "'") && value.endsWith(head)) return value.slice(1, -1).trim();
  }
  return value;
}

/**
 * Every `*.md` under `specs/frs/` — active AND archived. Archived FRs are
 * rewritten on purpose: the archive is immutable as to WHICH milestone owns an
 * FR, and leaving an archived FR pointing at a token no plan answers to is the
 * dangling binding this repair exists to prevent. Recursive, so a deeper
 * archive layout is covered without a second walk; sorted for run-to-run
 * determinism.
 */
function listFrFiles(projectRoot: string): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile() && entry.name.endsWith(".md")) files.push(abs);
    }
  };
  walk(join(projectRoot, "specs", "frs"));
  return files;
}

/**
 * The rollback journal for ONE plan's repair (AC-STE-442.7).
 *
 * Every mutating step registers its inverse here BEFORE it runs, so a step that
 * throws part-way through its own write (a truncated file, say) is still
 * covered. `rollback` replays the entries in reverse, which is why the rename's
 * inverse is registered only once the rename has landed.
 */
type Journal = Array<() => void>;

/**
 * Undo one plan's completed steps, newest first.
 *
 * Best-effort by construction: a rollback step that itself fails must not mask
 * the original failure, which is what `apply` reports to the operator. Nothing
 * here can leave a step half-applied — each inverse is a single whole-file
 * write or a single rename.
 */
function rollback(journal: Journal): void {
  for (let i = journal.length - 1; i >= 0; i--) {
    try {
      journal[i]!();
    } catch {
      // Intentionally swallowed — see above.
    }
  }
}

/** An error's message, whatever was thrown. */
function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Point every FR bound to `oldToken` at `newToken`, returning the
 * project-relative paths actually rewritten.
 *
 * The edit goes through `splitFrontmatter`/`joinFrontmatter`, so the body
 * (and the file's original line endings and BOM) survive byte-for-byte, and an
 * FR bound to any OTHER milestone is never opened for writing at all.
 *
 * Each rewrite records its restore-the-original inverse in `journal` first: an
 * FR sweep that dies on its fifth file must leave the first four exactly as
 * they were (AC-STE-442.7).
 */
function rebindFrs(projectRoot: string, oldToken: string, newToken: string, journal: Journal): string[] {
  const rewritten: string[] = [];
  for (const file of listFrFiles(projectRoot)) {
    let raw: string;
    try {
      raw = readFileSync(file, "utf-8");
    } catch {
      continue;
    }
    const split = splitFrontmatter(raw);
    if (split === null) continue;

    let touched = false;
    const lines = split.lines.map((line) => {
      if (milestoneLineValue(line) !== oldToken) return line;
      touched = true;
      return `milestone: ${newToken}`;
    });
    if (!touched) continue;

    journal.push(() => writeFileSync(file, raw, "utf-8"));
    writeFileSync(file, joinFrontmatter(split, lines), "utf-8");
    rewritten.push(relative(projectRoot, file));
  }
  return rewritten;
}

/**
 * The plan's own identity rewrite: the minted id recorded VERBATIM as `id:`
 * (probe #73 re-derives the filename from this exact value) and its own
 * `milestone:` key moved to the new token — the plan is a binding like any FR.
 *
 * Returns `null` when the plan carries no frontmatter block to edit, which the
 * caller treats as a FAILED repair rather than a skipped step. The two readers
 * disagree by construction and that is why the case exists: the walk admits a
 * plan through `parseFrontmatter(..., { lenient: true })`, which answers `{}`
 * for a plan with no frontmatter at all — no `id:` key, no `kind:` exemption, so
 * repairable — while `splitFrontmatter` has no block to write into. Renaming
 * such a plan anyway would produce an `M_<tail>.md` carrying no `id:`, which
 * probe #73 fails outright, where the sequential name it started with was only
 * ever dispositioned by git provenance.
 */
/**
 * Does this plan carry a YAML frontmatter block the minted `id:` can go into?
 *
 * Same predicate `rewritePlanIdentity` applies, hoisted so the partition can
 * decline such a plan UP FRONT instead of discovering it mid-repair. Routed
 * through the same `splitFrontmatter` the writer uses, never a private `---`
 * scan, so the two can never disagree about what counts as a block.
 */
function hasFrontmatterBlock(raw: string): boolean {
  return splitFrontmatter(raw) !== null;
}

function rewritePlanIdentity(raw: string, newToken: string, mintedId: string): string | null {
  const split = splitFrontmatter(raw);
  if (split === null) return null;

  const lines = [...split.lines];
  let milestoneIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (milestoneLineValue(lines[i]!) === null) continue;
    lines[i] = `milestone: ${newToken}`;
    milestoneIndex = i;
    break;
  }

  const idLine = `id: ${mintedId}`;
  if (milestoneIndex >= 0) lines.splice(milestoneIndex + 1, 0, idLine);
  else lines.push(idLine);

  return joinFrontmatter(split, lines);
}

export const modeNoneSequentialMilestone: MigrationEntry = {
  id: "mode-none-sequential-milestone",
  introduced_in: "2.59.0",
  title: "Repair mis-named tracker-less milestone plans: mint an id, rename the plan, rebind its FRs",
  kind: "script",
  // AC-STE-442.1 rail: identity rewrites are never swept into a batch approval.
  requires_explicit_approval: true,
  detect: detectModeNoneSequentialMilestone,
  apply(projectRoot): ApplyResult {
    const specsDir = join(projectRoot, "specs");
    const planDir = join(specsDir, "plan");
    const changed: string[] = [];
    const repaired: string[] = [];
    /** Shipped plans the repair deliberately declined — reported, never touched. */
    const shipped: string[] = [];
    /** Plans whose repair failed and was rolled back — reported, never thrown. */
    const failed: string[] = [];

    // ONE partition, shared with `detect` (AC-STE-442.6). A shipped plan's
    // identity is already cemented in a release, so renaming it would trip the
    // ship-coherence probe; it is reported, never touched. The report names the
    // plan AND the reason, because the operator has to decide by hand whether
    // the release history can absorb a rename.
    const { repairable, declined } = partitionByRepairability(findRepairablePlans(projectRoot));

    // Re-apply is a no-op by construction: with no plan left in EITHER bucket
    // there is nothing to heal or to report, so we never touch the tree.
    //
    // Guarded on the partition rather than on `detect().applies`, and the
    // difference is load-bearing. `applies` counts only the REPAIRABLE bucket
    // (AC-STE-442.6, so a permanently-declined plan cannot keep the entry
    // detecting forever), but a declined plan still has to reach the operator
    // as a report when this runs — AC-STE-442.5 requires the summary to name
    // it. Guarding on `applies` here would swallow exactly that report on a
    // project whose only mis-named plan is one this entry declines.
    if (repairable.length === 0 && declined.length === 0) {
      return { changed: [], summary: "No mis-named tracker-less milestone plans found — nothing to do." };
    }

    for (const d of declined) shipped.push(`${d.plan.rel} (${d.reason})`);

    // One plan at a time, START TO FINISH: the rename lands before the next
    // plan is minted, so `mintMilestoneId`'s collision probe sees the identity
    // just taken and two plans in one run can never share a tail.
    for (const plan of repairable) {
      // ALL-OR-NOTHING, PER PLAN (AC-STE-442.7). Every step below registers its
      // inverse in this plan's journal before it runs; any throw unwinds them in
      // reverse and the plan is reported as failed rather than left half-repaired
      // — a plan renamed away from the FRs still pointing at it, or an id: key
      // recorded on a file no binding answers to, is strictly worse than the
      // mis-naming this entry exists to fix.
      //
      // The failure is caught PER PLAN and never rethrown: `/upgrade` runs one
      // registry walk, so a throw here would abort every other entry's repair
      // too, and the sibling plans in THIS walk would never be attempted.
      const journal: Journal = [];
      try {
        // 1. MINT — pure: it names a file, it never creates one, so a failure
        //    before the first write needs no undo step.
        const minted = mintMilestoneId(specsDir);

        // 2. REBIND — every FR that points at the old token, then the plan's own
        //    frontmatter, both written at the OLD path.
        const rebound = rebindFrs(projectRoot, plan.token, minted.milestoneId, journal);
        const body = rewritePlanIdentity(plan.raw, minted.milestoneId, minted.id);
        if (body === null) {
          // NOT a skippable step. Falling through to the rename would leave an
          // `M_<tail>.md` with no `id:` key — a hard probe-#73 failure, strictly
          // worse than the mis-naming — so this joins the rolled-back-and-
          // reported path with every other failure (AC-STE-442.7).
          throw new Error(
            `plan has no frontmatter block to record the minted id: in — repair it by hand, or declare kind: legacy to opt out`,
          );
        }
        journal.push(() => writeFileSync(plan.file, plan.raw, "utf-8"));
        writeFileSync(plan.file, body, "utf-8");

        // 3. RENAME LAST — until this lands the plan still carries its old name
        //    and the detector still recognises the repair as unfinished. Its
        //    inverse is registered only AFTER it succeeds: a rename that never
        //    happened has nothing to undo.
        const target = join(planDir, `${minted.milestoneId}.md`);
        renameSync(plan.file, target);
        journal.push(() => renameSync(target, plan.file));

        changed.push(relative(projectRoot, target), ...rebound);
        repaired.push(`${plan.token} → ${minted.milestoneId}`);
      } catch (error) {
        rollback(journal);
        failed.push(`${plan.rel} (${failureMessage(error)})`);
      }
    }

    // Both halves of the report are assembled from the same walk, so a run that
    // only DECLINED plans still speaks (`changed` stays empty, the summary does
    // not) and a mixed run carries the repair and the refusal in one string.
    const parts: string[] = [];
    if (repaired.length > 0) {
      parts.push(
        `Repaired ${repaired.length} tracker-less milestone plan(s): ${repaired.join(", ")}. Each plan now records its minted id: verbatim, is named after that id, and every FR bound to the old token — active and archived — follows it.`,
      );
    }
    if (shipped.length > 0) {
      parts.push(
        `Left ${shipped.length} mis-named milestone plan(s) untouched: ${shipped.join(", ")}. A plan stamped shipped_in names a milestone already cemented in a release, and renaming it would break the plan_ship_coherence gate probe (#63), which cross-checks the stamp against the CHANGELOG heading; a plan with no frontmatter block has nowhere to record the minted id, so renaming it would produce an M_<tail>.md that probe #73 fails outright. Both are permanently declined by this entry — repair them by hand alongside the release history that names them, or declare kind: legacy to opt out.`,
      );
    }

    if (failed.length > 0) {
      parts.push(
        `Failed to repair ${failed.length} tracker-less milestone plan(s): ${failed.join(", ")}. Each failure was rolled back — that plan's file, its identity key and every FR binding it owns are exactly as they were, so no partial repair remains on disk. Clear the cause and re-run /upgrade; the entry is idempotent, so the plans repaired in this run are not re-touched.`,
      );
    }

    if (parts.length === 0) return { changed: [], summary: "" };

    return { changed, summary: parts.join(" ") };
  },
};
