// M108 STE-392 — the migration registry's first `kind: "assisted"` entry: the
// monolithic `specs/requirements.md` → per-FR `specs/frs/` split.
//
// v1.16.0 pivoted the spec convention. Before it, every FR lived as a
// `### FR-N:` heading block inside one monolithic `specs/requirements.md`, with
// AC checkbox state kept separately in a flat `specs/plan.md`. After it, FR
// detail lives one-file-per-FR under `specs/frs/` and `specs/requirements.md`
// keeps cross-cutting requirements only. Trees bootstrapped before the pivot
// still carry the old shape.
//
// WHY ASSISTED, NOT SCRIPT. The split cannot be scripted end-to-end: deciding
// which legacy FRs are already shipped (and therefore freeze into the archive)
// versus still open (and therefore become live per-FR files) needs operator
// judgment, because the pre-pivot state is split-brain by construction — the
// plan's checkboxes and the monolith's AC bullets are two sources that can and
// do disagree. So this module owns the DETECTOR plus the pure mechanics the
// flow leans on; the flow itself lives in `skills/upgrade/SKILL.md`, and the
// entry carries no `apply`.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { NUMERIC_MILESTONE_NUMBER_SOURCE } from "../milestone_token";
import type { DetectResult, MigrationEntry } from "./index";

// ---------------------------------------------------------------------------
// Paths
//
// These are LIVE paths (`specs/requirements.md` and `specs/frs/` both survive
// the pivot — what changed is what goes in them), so they are composed here
// rather than in `./legacy_paths`, which is the single source of RETIRED
// literals only. The flat `specs/plan.md` is read for evidence only, never
// keyed on: its absence is a shape this detector reports, not a blocker.
// ---------------------------------------------------------------------------

function requirementsPath(projectRoot: string): string {
  return join(projectRoot, "specs", "requirements.md");
}

function frsDir(projectRoot: string): string {
  return join(projectRoot, "specs", "frs");
}

function flatPlanPath(projectRoot: string): string {
  return join(projectRoot, "specs", "plan.md");
}

// ---------------------------------------------------------------------------
// Section scanning
//
// Three markdown surfaces are read here — the monolith's FR sections, the flat
// plan's checkbox rows, and the flat plan's milestone blocks — and two of them
// are the same walk: find the heading that opens a block, collect the lines
// beneath it, stop at the heading that closes it. `walkSections` owns that walk
// once, so the scoping rule cannot drift between its callers.
// ---------------------------------------------------------------------------

/**
 * An FR heading block: `### FR-8: Widget search {#FR-8}`. Anchored at line
 * start and requiring a literal `FR-` immediately after the hashes, so
 * `### NFR-1: Performance` — which merely CONTAINS "FR-1" — is not a match.
 * Group 3 is the heading's remainder, which `frTitle` turns into the title.
 */
const FR_HEADING = /^(#{2,4})\s+FR-(\d+)\b\s*:?\s*(.*)$/;

/** Any ATX heading, with its level captured. */
const ANY_HEADING = /^(#{1,6})\s+\S/;

/**
 * The `> archived: …` pointer a hand-archived section leaves behind. Such a
 * section is a tombstone, not live work: its content already moved to the
 * archive, so counting it would overstate what the operator has to triage.
 */
const ARCHIVED_POINTER = /^\s*>\s*archived\b/i;

/**
 * HTML comments are stripped before scanning, because a commented-out heading
 * is not a section. This is load-bearing rather than defensive: the SHIPPED
 * `requirements.md.template` names `### FR-N: [Feature Name]` inside its header
 * comment in order to FORBID it, so a scanner that read comments would fire on
 * every freshly-bootstrapped tree.
 */
const HTML_COMMENT = /<!--[\s\S]*?-->/g;

/** The `{#FR-8}` explicit-anchor suffix a heading may carry. */
const HEADING_ANCHOR = /\s*\{#[^}]*\}\s*$/;

/**
 * A dotted AC id in any of the three shapes the toolkit mints: the monolith's
 * legacy `AC-8.1`, tracker mode's `AC-STE-500.1`, and `mode: none`'s short-ULID
 * `AC-K3M9QX.3`.
 */
const AC_REF = /AC-(?:[A-Za-z]+-)?[A-Za-z0-9]+\.\d+/;

/**
 * An AC bullet inside an FR section. The checkbox group is optional because the
 * pre-pivot monolith's bullets carry no state of their own — but a tree whose
 * author added some anyway still parses.
 */
const AC_BULLET = new RegExp(`^\\s*[-*]\\s+(?:\\[[ xX~]\\]\\s+)?${AC_REF.source}`);

/** A flat-plan checkbox row: `- [x] AC-8.1 — Query returns matches`. */
const PLAN_CHECKBOX_ROW = new RegExp(`^\\s*[-*]\\s+\\[([ xX~])\\]\\s+(${AC_REF.source})\\b`);

/** A heading's remainder, minus its explicit anchor: `Widget search`. */
function frTitle(remainder: string): string {
  return remainder.replace(HEADING_ANCHOR, "").trim();
}

/**
 * A markdown body as scannable lines: HTML comments stripped, split on either
 * line ending. Every scanner in this module starts here, so "a commented-out
 * heading is not a section" is decided in exactly one place (see `HTML_COMMENT`).
 */
function scannableLines(markdown: string): string[] {
  return markdown.replace(HTML_COMMENT, "").split(/\r?\n/);
}

/** A heading block: what its opening heading meant, and the lines beneath it. */
interface Section<T> {
  header: T;
  body: string[];
}

/**
 * Walk `markdown` into the blocks `opensSection` recognizes, in document order.
 *
 * SCOPE IS BY HEADING LEVEL. A heading at or above the open block's own level
 * closes it; a DEEPER one is a sub-heading, so it stays in the body along with
 * everything under it. That rule is why the walk is shared rather than written
 * out at each call site: both callers need it, and a scanner that got it wrong
 * would bleed one block's content into the next — quietly, and in a way neither
 * caller could catch on its own.
 *
 * `opensSection` is consulted BEFORE the closing rule, so a heading it
 * recognizes always opens a new block, even when nested inside an open one.
 */
function walkSections<T>(markdown: string, opensSection: (line: string) => T | null): Section<T>[] {
  const sections: Section<T>[] = [];
  let header: T | null = null;
  let level = 0;
  let body: string[] = [];

  const flush = (): void => {
    if (header !== null) sections.push({ header, body });
    header = null;
    body = [];
  };

  for (const line of scannableLines(markdown)) {
    const heading = line.match(ANY_HEADING);
    if (heading !== null) {
      const opened = opensSection(line);
      if (opened !== null) {
        flush();
        header = opened;
        level = heading[1]!.length;
        continue;
      }
      if (header !== null && heading[1]!.length <= level) {
        flush();
        continue;
      }
    }
    if (header !== null) body.push(line);
  }
  flush();

  return sections;
}

/**
 * The FR numbers of the monolith's LIVE heading sections, in document order.
 *
 * The detector needs only a count and the numbers to name in evidence, but the
 * walk that finds them — including which sections count as live — is exactly
 * `parseMonolithFRSections`'. Deriving it keeps ONE scanner in the module, so
 * the count the operator is shown at detection can never drift from the rows
 * they are handed at triage.
 */
function liveFrSectionNumbers(markdown: string): number[] {
  return parseMonolithFRSections(markdown).map((section) => section.frNumber);
}

// ---------------------------------------------------------------------------
// AC-STE-392.1 — the detector
// ---------------------------------------------------------------------------

/**
 * Does `dir` hold real per-FR content — a regular `.md` file found by a
 * recursive scan that ignores dot-entries (dotfiles AND dot-directories)?
 *
 * Only a real per-FR markdown file evidences a completed split. A `.gitkeep`,
 * an empty `archive/` scaffold, or any other non-`.md` residue is NOT content:
 * dot-entries are skipped at every level, so a `.gitkeep`-only or
 * /setup-scaffold-shaped `specs/frs/` reads as "no content seen" rather than
 * "already split".
 *
 * A throw at any level — ENOTDIR when `specs/frs` is a regular file, an
 * unreadable subtree — is caught and treated as "no content seen there",
 * preserving the detector's degrade-not-throw posture (the ENOTDIR guard the
 * caller used to keep is subsumed into this catch).
 */
function hasRealFrContent(dir: string): boolean {
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      if (entry.isDirectory()) {
        if (hasRealFrContent(join(dir, entry.name))) return true;
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * Fires on the conjunction the AC pins: FR-heading sections present in
 * `specs/requirements.md` AND `specs/frs/` absent or empty.
 *
 * BOTH limbs are load-bearing, and the second is what gives the entry its
 * re-run semantics. A half-migrated tree — sections still in the monolith but
 * per-FR files already written — is a tree whose operator is mid-flow, so the
 * detector goes quiet rather than re-proposing a split over its own output.
 * The freeze leg is what eventually clears the sections themselves.
 *
 * Pure, synchronous, network-free, non-mutating: reads three paths and returns.
 */
function detectMonolith(projectRoot: string): DetectResult {
  const requirements = requirementsPath(projectRoot);
  if (!existsSync(requirements)) return { applies: false, evidence: [] };

  let markdown: string;
  try {
    markdown = readFileSync(requirements, "utf-8");
  } catch {
    // A requirements.md that cannot be read is not a migration's problem: stay
    // silent rather than throwing mid-scan and taking the registry walk down.
    return { applies: false, evidence: [] };
  }

  const live = liveFrSectionNumbers(markdown);
  if (live.length === 0) return { applies: false, evidence: [] };

  const frs = frsDir(projectRoot);
  // Guard the readdir the same way the requirements read above is guarded: a
  // `specs/frs` that is a regular file (or otherwise unreadable) must not throw
  // ENOTDIR mid-detector and abort the registry walk — treat it as "not split".
  let split: string[] | null = null;
  if (existsSync(frs)) {
    try {
      split = readdirSync(frs);
    } catch {
      split = null;
    }
  }
  if (hasRealFrContent(frs)) return { applies: false, evidence: [] };

  const named = live.map((n) => `FR-${n}`).join(", ");
  return {
    applies: true,
    evidence: [
      `specs/requirements.md carries ${live.length} live FR-heading section(s) (${named}) — the monolithic layout retired in v1.16.0`,
      split === null
        ? "specs/frs/ is absent — no FR has been split out into a per-FR file yet"
        : "specs/frs/ carries only scaffold artifacts — no FR has been split out into a per-FR file yet",
      existsSync(flatPlanPath(projectRoot))
        ? "AC checkbox state lives in the flat specs/plan.md, split-brain from the sections' own AC bullets"
        : "no flat specs/plan.md — the sections' AC bullets carry no plan-side checkbox state to reconcile",
    ],
  };
}

export const monolithSplit: MigrationEntry = {
  id: "monolith-split",
  introduced_in: "1.16.0",
  title: "Split the monolithic specs/requirements.md FR sections into per-FR files under specs/frs/",
  kind: "assisted",
  detect: detectMonolith,
};

// ---------------------------------------------------------------------------
// Refusals
//
// Both mutating legs — the backup rail and the freeze — refuse in the NFR-10
// canonical shape (Refusing / Remedy / Context lines) so the flow can surface
// either verbatim without re-templating (`deps_manifest` precedent). The shape
// is declared ONCE here: the two subclasses differ in nothing but their name,
// and that name is the only thing a caller needs in order to tell a failed
// backup from a failed freeze.
// ---------------------------------------------------------------------------

class MonolithSplitRefusal extends Error {
  constructor(reason: string, remedy: string) {
    super(
      [
        `Refusing: ${reason}`,
        `Remedy: ${remedy}`,
        "Context: mode=upgrade, entry=monolith-split, skill=upgrade",
      ].join("\n"),
    );
    // `new.target` is the concrete subclass the caller constructed, so each
    // refusal names itself without having to restate its own name.
    this.name = new.target.name;
  }
}

/** Thrown when the backup cannot be taken. */
export class SpecsBackupError extends MonolithSplitRefusal {}

/** Thrown when the freeze cannot run. */
export class MonolithFreezeError extends MonolithSplitRefusal {}

// ---------------------------------------------------------------------------
// AC-STE-392.2 — the backup rail
//
// The flow's first act, and the only bookkeeping this skill keeps. `/upgrade`'s
// clean-tree gate makes `git checkout -- .` the undo for a TRACKED tree, but
// `specs/` may be git-ignored — and an ignored tree has no index entry, no
// diff, and no undo at all. A copy on disk is the only safety net that holds
// either way, which is why the flow takes it unconditionally rather than gating
// it on VCS state.
// ---------------------------------------------------------------------------

/** Where a backup landed, and what it copied. */
export interface SpecsBackup {
  /** Project-relative path of the backup directory. */
  path: string;
  /** Project-relative path of every file copied, in walk order. */
  files: string[];
}

const BACKUP_PREFIX = "specs-backup-";

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * A filesystem-safe ISO-8601 stamp, e.g. `2026-07-17T12-34-56`: colons are
 * illegal on some filesystems, and the fractional part buys nothing the
 * collision suffix does not already cover.
 */
function backupStamp(now: Date): string {
  return now.toISOString().replace(/\.\d+Z$/, "").replace(/:/g, "-");
}

/**
 * Create the backup directory and return its absolute path, suffixing on
 * collision so a second backup never clobbers a first.
 *
 * `mkdirSync` non-recursively rather than an `existsSync` probe: EEXIST is the
 * collision signal, and letting the filesystem arbitrate keeps the check and the
 * claim one operation. The stamp resolves only to the second, so two backups in
 * one run genuinely do collide.
 */
function createBackupDir(projectRoot: string): string {
  const base = `${BACKUP_PREFIX}${backupStamp(new Date())}`;
  for (let n = 1; n <= 100; n++) {
    const dir = join(projectRoot, n === 1 ? base : `${base}-${n}`);
    try {
      mkdirSync(dir);
      return dir;
    } catch (error) {
      if ((error as { code?: string }).code !== "EEXIST") {
        throw new SpecsBackupError(
          `could not create the backup directory ${relative(projectRoot, dir)} — ${describeError(error)}`,
          "fix the project root's permissions, then re-run `/dev-process-toolkit:upgrade`",
        );
      }
    }
  }
  throw new SpecsBackupError(
    `100 backup directories already exist for this timestamp (${base})`,
    "remove or move the stale backup directories, then re-run `/dev-process-toolkit:upgrade`",
  );
}

/** Every file under `dir`, as paths relative to `dir`. */
function walkFiles(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walkFiles(join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out;
}

/**
 * Copy the full `specs/` tree to a timestamped sibling directory at the project
 * root, returning the backup path and the files it copied.
 *
 * READ EVERYTHING BEFORE WRITING ANYTHING. The rail exists to make the flow's
 * later steps recoverable, so a backup that fails must fail cleanly: every
 * source file is read into memory before the destination directory is even
 * created. An unreadable file therefore aborts with `specs/` untouched and no
 * half-copied directory behind it — nothing to clean up, and nothing an operator
 * could mistake for a real backup. Read as bytes rather than text, because
 * `specs/design/` carries reference images alongside the markdown.
 */
export function backupSpecsTree(projectRoot: string): SpecsBackup {
  const source = join(projectRoot, "specs");
  if (!existsSync(source)) {
    throw new SpecsBackupError(
      "specs/ is absent — there is nothing to back up",
      "re-run `/dev-process-toolkit:upgrade` from the project root",
    );
  }

  let payload: { rel: string; bytes: Buffer }[];
  try {
    payload = walkFiles(source).map((rel) => ({
      rel,
      bytes: readFileSync(join(source, ...rel.split("/"))),
    }));
  } catch (error) {
    throw new SpecsBackupError(
      `could not read the specs/ tree — ${describeError(error)}`,
      "fix the unreadable path (permissions, broken symlink), then re-run `/dev-process-toolkit:upgrade`",
    );
  }

  const dest = createBackupDir(projectRoot);
  const files: string[] = [];
  try {
    for (const { rel, bytes } of payload) {
      const full = join(dest, ...rel.split("/"));
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, bytes);
      files.push(relative(projectRoot, full));
    }
  } catch (error) {
    // Every read already succeeded, so this is the destination failing (full
    // disk, read-only mount). Drop the partial copy for the same reason the
    // reads run first: a half-backup that looks whole is worse than none.
    rmSync(dest, { recursive: true, force: true });
    throw new SpecsBackupError(
      `could not write the backup to ${relative(projectRoot, dest)} — ${describeError(error)}`,
      "free space or fix the destination's permissions, then re-run `/dev-process-toolkit:upgrade`",
    );
  }

  return { path: relative(projectRoot, dest), files };
}

// ---------------------------------------------------------------------------
// AC-STE-392.3 — status triage
//
// The three pure helpers the flow's triage step derives its table from. They
// are the reason this entry is `assisted` rather than `script`: they can DERIVE
// a disposition, but they cannot ratify one. The pre-pivot layout is split-brain
// by construction — the plan's checkboxes and the monolith's AC bullets are two
// sources that drift — so what these return is a proposal the operator confirms,
// never a verdict the flow acts on by itself.
//
// String in, value out: no filesystem, no prompting. The flow reads the files
// and owns the `AskUserQuestion`; these three only decide what to propose, which
// is what makes the triage testable without a tree.
// ---------------------------------------------------------------------------

/** One live FR heading block, parsed. */
export interface MonolithFRSection {
  frNumber: number;
  title: string;
  acLines: string[];
  background: string;
}

export type AcCheckboxState = "checked" | "unchecked" | "partial";

/** One FR's triage verdict, as DERIVED — the operator may still override it. */
export interface FRClassification {
  frNumber: number;
  disposition: "shipped" | "open";
  evidence: string;
}

/**
 * Every LIVE `### FR-N:` section of the monolith, in document order.
 *
 * FR numbers carry through VERBATIM — nothing is re-indexed to 1..N. Real
 * pre-pivot trees gap their numbering (one whose FRs run 8, 12, 31 is
 * ordinary), and a parser that keyed on position would silently re-point every
 * downstream AC id at the wrong FR.
 *
 * A section whose body carries a `> archived:` pointer is a tombstone left by a
 * hand-archival, not live work: its content already moved to the archive, so it
 * contributes nothing at all rather than a phantom row in the triage table.
 */
export function parseMonolithFRSections(markdown: string): MonolithFRSection[] {
  return walkSections(markdown, (line) => {
    const fr = line.match(FR_HEADING);
    return fr === null ? null : { frNumber: Number(fr[2]), title: frTitle(fr[3] ?? "") };
  })
    .filter(({ body }) => !body.some((line) => ARCHIVED_POINTER.test(line)))
    .map(({ header, body }) => ({
      frNumber: header.frNumber,
      title: header.title,
      acLines: body.filter((line) => AC_BULLET.test(line)),
      background: body
        .filter((line) => !AC_BULLET.test(line))
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim(),
    }));
}

const CHECKBOX_STATE: Record<string, AcCheckboxState> = {
  x: "checked",
  " ": "unchecked",
  "~": "partial",
};

/**
 * A flat-plan checkbox row parsed into the AC it names and that AC's state, or
 * null when the line is not one. Both readers of the plan go through here, so
 * `[x]`/`[ ]`/`[~]` mean the same thing to the triage table and to the stubs.
 */
function planCheckboxRow(line: string): { ref: string; state: AcCheckboxState } | null {
  const row = line.match(PLAN_CHECKBOX_ROW);
  if (row === null) return null;
  const state = CHECKBOX_STATE[row[1]!.toLowerCase()];
  return state === undefined ? null : { ref: row[2]!, state };
}

/**
 * Every AC id the flat plan carries a checkbox for, mapped to its state.
 *
 * `[~]` reads as its own `partial` value rather than rounding to either pole:
 * half-done work is precisely what the operator has to see, and a parser that
 * called it `checked` would freeze it into the archive.
 *
 * Rows carrying no AC id — milestone headings, prose bullets — are not state,
 * and are skipped. The map holds AC dispositions only.
 */
export function extractPlanCheckboxState(markdown: string): Map<string, AcCheckboxState> {
  const state = new Map<string, AcCheckboxState>();
  for (const line of scannableLines(markdown)) {
    const row = planCheckboxRow(line);
    if (row !== null) state.set(row.ref, row.state);
  }
  return state;
}

/** The AC ids a section's bullets declare, in order. */
function sectionAcRefs(section: MonolithFRSection): string[] {
  return section.acLines
    .map((line) => line.match(AC_REF)?.[0])
    .filter((ref): ref is string => ref !== undefined);
}

/**
 * One derived disposition per live section, in section order.
 *
 * SPLIT-BRAIN TOLERANT. Checkbox state lives ONLY in the plan, so the
 * monolith's own AC bullets are read for their ids and nothing else. A
 * classifier that reasoned "this bullet has no checkbox, therefore not shipped"
 * would call every FR open on every pre-pivot tree — the same as not
 * classifying at all.
 *
 * CONSERVATIVE BY CONSTRUCTION. Only an FR whose every AC is checked reads
 * `shipped`. Partial, unchecked, and — critically — absent-from-the-plan all
 * read `open`, because the two errors are not symmetric: wrongly freezing an FR
 * buries live work in an archive nobody re-reads, while wrongly splitting one
 * out costs the operator a single file to archive. Every verdict carries the
 * evidence that decided it, so an operator overriding a row can see what it read.
 */
export function classifyFRs(
  sections: MonolithFRSection[],
  state: Map<string, AcCheckboxState>,
): FRClassification[] {
  return sections.map((section) => {
    const verdict = (disposition: "shipped" | "open", evidence: string): FRClassification => ({
      frNumber: section.frNumber,
      disposition,
      evidence,
    });

    const refs = sectionAcRefs(section);
    if (refs.length === 0) {
      return verdict("open", "the section declares no AC bullets — nothing here proves it shipped");
    }

    const unplanned = refs.filter((ref) => !state.has(ref));
    if (unplanned.length > 0) {
      return verdict(
        "open",
        `the plan carries no checkbox state for ${unplanned.join(", ")} — not found, so open by default`,
      );
    }

    const blocking = refs.find((ref) => state.get(ref) !== "checked");
    if (blocking !== undefined) {
      return verdict("open", `${blocking} is ${state.get(blocking)} in the plan`);
    }

    return verdict("shipped", `the plan checks every AC: ${refs.join(", ")}`);
  });
}

// ---------------------------------------------------------------------------
// AC-STE-392.4 — the AC re-key
//
// The split step's one text transform. Identity itself is NOT this module's
// business: the prefix arrives already derived by `acPrefix` — a tracker id in
// tracker mode, a short-ULID tail under `mode: none` — so this helper never
// learns which mode it is serving and needs no branch for it. It only re-keys.
// ---------------------------------------------------------------------------

/**
 * A LEGACY dotted AC id: `AC-8.1`, whose prefix is the bare FR number. The
 * digits-only prefix is the whole discriminator, and it is what makes this
 * rewrite idempotent for free: a re-keyed `AC-STE-500.1` or `AC-K3M9QX.3` has a
 * non-numeric prefix, so a second pass cannot match — and cannot re-key one FR's
 * ACs into another's.
 *
 * `\b`-anchored on both ends so a mid-token match is impossible, which is what
 * keeps ordinary prose safe: a background line mentioning `v1.16.0` or "see 8.1
 * of the old design note" carries no `AC-` and is not an id.
 */
const LEGACY_AC_ID = /\bAC-(\d+)\.(\d+)\b/g;

/**
 * Re-key one FR section's lines from the monolith's legacy `AC-<fr>.<n>` ids to
 * the derived `<prefix>`, and append the section's provenance note.
 *
 * ORDER IS THE CONTRACT. Lines come back in the order they went in, one for one,
 * with only the ids substituted — the AC prose is never reflowed, and nothing is
 * sorted, deduped, or dropped. An AC list's order is meaning (`.1` before `.2`),
 * and the operator confirmed THIS list at triage.
 *
 * CROSS-REFERENCES RE-KEY TOO, which is why the match is global per line rather
 * than anchored to the bullet's head: an AC whose body reads "same ranking rule
 * as AC-8.1" must follow its sibling to the new prefix, or the split file ships
 * a dangling pointer into a monolith that the freeze has since archived.
 *
 * KNOWN LIMITATION — same-FR references only. This rewrites EVERY `AC-<n>.<m>`
 * in the lines to the one `prefix`, so an inter-FR reference (FR-12's body citing
 * FR-8's `AC-8.1`) is re-keyed to FR-12's prefix — a wrong pointer. Splitting is
 * an operator-reviewed assisted step (the operator confirms each split file), so
 * a stray cross-FR id surfaces at review; a future signature could take the
 * legacy FR number to scope the rewrite, but the prose flow does not thread one
 * today. Cannot occur on the freeze-everything path (no split, no re-key).
 *
 * The provenance note lands LAST, after every AC, and names the legacy FR number
 * the ids themselves are about to stop carrying — once re-keyed, nothing else in
 * the file remembers where it came from. When the lines carry no legacy id there
 * is nothing to attest and no FR number to name, so no note is appended.
 */
export function rewriteAcPrefix(lines: string[], prefix: string): string[] {
  const legacy: number[] = [];
  const rewritten = lines.map((line) =>
    line.replace(LEGACY_AC_ID, (_match, frNumber: string, acNumber: string) => {
      const n = Number(frNumber);
      if (!legacy.includes(n)) legacy.push(n);
      return `AC-${prefix}.${acNumber}`;
    }),
  );

  if (legacy.length === 0) return rewritten;

  const named = legacy.map((n) => `FR-${n}`).join(", ");
  return [
    ...rewritten,
    `> Split from legacy ${named} of the monolithic \`specs/requirements.md\` by ` +
      `\`/dev-process-toolkit:upgrade\`; ACs re-keyed to the \`AC-${prefix}.<n>\` prefix.`,
  ];
}

// ---------------------------------------------------------------------------
// AC-STE-392.5 — the freeze
//
// The flow's last mutating step, and the one that actually retires the old
// layout: the split copies open work OUT of the monolith, but until the monolith
// itself moves, the tree still carries two sources of truth for the same FRs.
//
// WHERE THE HISTORY LANDS. Both legacy documents go to ONE folder nested inside
// the FR archive, `specs/frs/archive/legacy/`. Two decisions are folded in:
//
//   - TOGETHER, not one per archive. The pre-pivot pair is a single document in
//     two files — the plan's checkboxes are the only thing that explains the
//     requirements' AC state — so filing the plan under `specs/plan/archive/`
//     would strand each half from the evidence that reads it.
//   - NESTED one level, not loose in the archive. The scanners that would treat
//     a file here as a conforming archived FR — backfill_milestone_labels,
//     traceability_link_validity, archive_frontmatter_coherent,
//     needs_technical_review_consistency, and spec_archive/rewrite_links — all
//     list `*.md` DIRECTLY under the archive dir and recurse into nothing, so a
//     `legacy/` subfolder is invisible to every one of them. That is what lets
//     the freeze keep the bytes pristine: a loose drop would be scanned as a
//     conforming archived FR, and the frontmatter it would need to satisfy that
//     scan is exactly the edit "preserved byte-for-byte" forbids.
//     NOT a universal: scan_design_references (probe #61) walks `specs/frs/**`
//     recursively and does reach these files. Harmless — it only resolves
//     `## Design References` links, a convention no pre-v1.16.0 monolith carries,
//     so it passes vacuously and never asks for an edit.
// ---------------------------------------------------------------------------

/** What the freeze relocated and scaffolded — every path project-relative. */
export interface MonolithFreeze {
  /** The legacy documents now frozen in the archive: requirements, then plan. */
  legacy: string[];
  /** The freshly scaffolded cross-cutting `specs/requirements.md`. */
  requirements: string;
  /** The minted `specs/plan/M<N>.md` stubs — open-work milestones only. */
  planStubs: string[];
}

/** The frozen monolith's home: one folder, nested inside the FR archive. */
function legacyArchiveDir(projectRoot: string): string {
  return join(projectRoot, "specs", "frs", "archive", "legacy");
}

/** The plugin's shipped requirements template — the fresh scaffold's source. */
function requirementsTemplatePath(): string {
  return join(import.meta.dir, "..", "..", "..", "..", "templates", "spec-templates", "requirements.md.template");
}

/**
 * Run `git <args>`, returning true on a clean exit. A git binary missing from
 * PATH (or any spawn-launch failure) degrades to false rather than throwing
 * uncaught — the repo's safeGit convention, so an offline/gitless tree still
 * takes the filesystem-move path instead of crashing the freeze.
 */
function safeSpawnGit(projectRoot: string, args: string[]): boolean {
  try {
    return (
      Bun.spawnSync({
        cmd: ["git", ...args],
        cwd: projectRoot,
        stdout: "pipe",
        stderr: "pipe",
      }).exitCode === 0
    );
  } catch {
    return false;
  }
}

/** Is `rel` in the index? A git-ignored or non-repo tree answers false. */
function isTracked(projectRoot: string, rel: string): boolean {
  return safeSpawnGit(projectRoot, ["ls-files", "--error-unmatch", "--", rel]);
}

/**
 * Move `from` to `to`, returning the destination's project-relative path.
 *
 * `git mv` when the source is tracked, so the relocation lands STAGED and the
 * flow's commit leg sees one rename rather than a delete the operator has to
 * stage by hand. A git-ignored `specs/` tree — the pilot's shape — has no index
 * entry, so it takes `renameSync` instead, and a non-repo tree takes the same
 * path for the same reason.
 *
 * Neither branch reads or re-writes the content: `git mv` and `renameSync` both
 * relocate the inode, so "preserved byte-for-byte" is a property of the mechanism
 * rather than a promise the code has to keep. A round-trip through text would put
 * the file's line endings at risk for nothing.
 */
function relocate(projectRoot: string, from: string, to: string): string {
  const fromRel = relative(projectRoot, from);
  const toRel = relative(projectRoot, to);
  // Never clobber. A destination that already exists is residue from an earlier
  // half-run (createBackupDir suffixes to avoid exactly this); overwriting it
  // would destroy already-archived legacy history. freezeMonolith turns this
  // into a MonolithFreezeError pointing at the backup.
  if (existsSync(to)) {
    throw new Error(`refusing to overwrite an existing archive file at ${toRel}`);
  }
  mkdirSync(dirname(to), { recursive: true });

  if (isTracked(projectRoot, fromRel)) {
    const moved = safeSpawnGit(projectRoot, ["mv", "--", fromRel, toRel]);
    if (moved) return toRel;
    // `git mv` refused (or git could not launch): the file is still at `from`,
    // so the filesystem move below is a clean fallback, not a repair.
  }

  renameSync(from, to);
  return toRel;
}

/** A milestone key: `M2`, `m2`, and `2` all name `M2`. */
function milestoneKey(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^M?(\d+)$/i);
  return match === null ? trimmed : `M${match[1]}`;
}

/**
 * A flat-plan milestone heading: `## M2: Import pipeline`. Case-insensitive to
 * match `milestoneKey`, which treats `M2`/`m2`/`2` as one — a lowercase heading
 * used to slip past this and mint a stub with zero of its real rows. The token
 * shape comes from the shared `milestone_token` sources; the capture is the
 * bare number, which `milestoneKey` normalizes back to `M<N>`.
 */
const PLAN_MILESTONE_HEADING = new RegExp(
  String.raw`^#{1,6}\s+${NUMERIC_MILESTONE_NUMBER_SOURCE}\b`,
  "i",
);

/**
 * Each milestone's REMAINING checkbox rows, keyed by its legacy M-number.
 *
 * Checked rows are dropped: what survives into a stub is the work the operator
 * still owes, and a stub that re-listed shipped ACs would hand them a milestone
 * that reads as barely started. `[~]` partial rows survive — half-done is
 * remaining work, and it is the row most likely to be forgotten.
 *
 * Rows carry through VERBATIM, legacy AC ids and all. This function cannot re-key
 * them: the legacy-id → derived-prefix mapping is minted per FR by the split step
 * and is not the freeze's to reconstruct. The stub is a starting point the
 * operator finishes, and the legacy ids are the thread back to the archived plan
 * that explains each row.
 */
function remainingRowsByMilestone(planMarkdown: string): Map<string, string[]> {
  const rows = new Map<string, string[]>();
  for (const { header, body } of walkSections(
    planMarkdown,
    (line) => {
      const m = line.match(PLAN_MILESTONE_HEADING);
      return m ? milestoneKey(m[1]!) : null;
    },
  )) {
    const remaining = body.filter((line) => {
      const row = planCheckboxRow(line);
      return row !== null && row.state !== "checked";
    });
    // A milestone heading the plan repeats accumulates into one key, and one
    // carrying no remaining rows still gets an (empty) entry — a milestone the
    // plan names is a milestone that exists, whatever it has left to do.
    rows.set(header, [...(rows.get(header) ?? []), ...remaining]);
  }
  return rows;
}

/** One open-work milestone's `specs/plan/M<N>.md` stub. */
function planStubBody(milestone: string, remaining: string[], legacyPlanRel: string | null): string {
  const frozen =
    legacyPlanRel === null
      ? "the monolithic plan"
      : `the monolithic plan, frozen read-only at \`${legacyPlanRel}\``;
  return [
    "---",
    `milestone: ${milestone}`,
    "status: active",
    "archived_at: null",
    "kickoff_branch: null",
    "frozen_at: null",
    "---",
    "",
    "# Implementation Plan",
    "",
    `## ${milestone}: <!-- ADAPT: the milestone's title, from the archived plan --> {#${milestone}}`,
    "",
    "**Goal:** <!-- ADAPT: what the remaining work below achieves -->",
    "**Prerequisites:** None",
    "",
    `> Carried through the monolithic-specs split by \`/dev-process-toolkit:upgrade\` from ${frozen}. ` +
      `The \`${milestone}\` key is the LEGACY milestone number — nothing was renumbered. The rows below are ` +
      "that milestone's unfinished ACs, verbatim: re-key each to its split FR's derived AC prefix as you " +
      "flesh this stub out.",
    "",
    "**Acceptance Criteria:**",
    ...(remaining.length > 0
      ? remaining
      : ["- [ ] <!-- ADAPT: the archived plan left no unchecked row for this milestone -->"]),
    "",
    "**Gate:** `<your gate check commands>`",
    "",
  ].join("\n");
}

/**
 * The fresh cross-cutting `specs/requirements.md`: the shipped template with a
 * pointer line to the archived monolith spliced under its title.
 *
 * SCAFFOLDED FROM THE TEMPLATE, not hand-rolled and not salvaged from the
 * monolith. The template is what `/setup` writes into a tree bootstrapped today,
 * so taking it verbatim is what makes the migrated tree indistinguishable from a
 * fresh one — which is the whole point of the exercise. Salvaging the monolith's
 * § 1 instead would carry the FR sections' framing forward into the file whose
 * defining property is that it has none.
 *
 * The pointer is the operator's only thread from the live file to the history:
 * once the sections are archived, nothing else in the tree says where they went.
 */
function scaffoldFreshRequirements(legacyRequirementsRel: string, legacyPlanRel: string | null): string {
  const template = readFileSync(requirementsTemplatePath(), "utf-8");
  const plan = legacyPlanRel === null ? "" : ` (with its plan at \`${legacyPlanRel}\`)`;
  const pointer =
    "> **Legacy history frozen.** This project's pre-v1.16.0 monolithic FR sections were relocated " +
    `read-only to \`${legacyRequirementsRel}\`${plan} by \`/dev-process-toolkit:upgrade\`. ` +
    "This file carries cross-cutting requirements only; per-FR detail lives under `specs/frs/`.";

  const lines = template.split("\n");
  const title = lines.findIndex((line) => /^#\s+Requirements\s*$/.test(line));
  if (title === -1) return [pointer, "", template].join("\n");
  lines.splice(title + 1, 0, "", pointer);
  return lines.join("\n");
}

/**
 * Freeze the monolith: relocate the legacy requirements + plan into the archive,
 * scaffold a fresh cross-cutting `specs/requirements.md` pointing at them, and
 * mint a `specs/plan/M<N>.md` stub for each milestone the operator confirmed
 * still carries open work.
 *
 * `openMilestones` is the operator's ratified set, not a derived one — the freeze
 * mints exactly the stubs it names and never re-reads the checkboxes to second-
 * guess it. A milestone absent from the set is one whose every FR shipped: it
 * stays frozen in the archive, and minting it an active stub would resurrect work
 * that finished years ago as a file the tree's own probes then read as live.
 *
 * AN EMPTY SET IS LEGAL, and it is the pilot tree's own path: an operator who
 * confirms every AC actually shipped freezes everything and splits nothing. Zero
 * stubs is that outcome recorded, never a failure to detect one — so the freeze
 * takes `[]` and returns `planStubs: []` without complaint.
 *
 * READ THE PLAN BEFORE MOVING IT. The stubs are cut from the plan's own rows, so
 * the read has to happen while the plan is still at the path this function is
 * about to empty.
 */
export function freezeMonolith(projectRoot: string, openMilestones: string[]): MonolithFreeze {
  const requirements = requirementsPath(projectRoot);
  if (!existsSync(requirements)) {
    throw new MonolithFreezeError(
      "specs/requirements.md is absent — there is no monolith to freeze",
      "restore the specs/ tree from the backup this flow took, then re-run `/dev-process-toolkit:upgrade`",
    );
  }

  const flatPlan = flatPlanPath(projectRoot);
  const planMarkdown = existsSync(flatPlan) ? readFileSync(flatPlan, "utf-8") : null;

  // Both mutating legs (the relocations and the scaffold/stub writes) run under
  // one guard: an I/O failure part-way through — a collision, EACCES, EXDEV —
  // must surface as the module's own refusal naming the restore-from-backup
  // path, not a raw stack trace over a tree left half-frozen.
  try {
    const archive = legacyArchiveDir(projectRoot);
    const legacy = [relocate(projectRoot, requirements, join(archive, "requirements.md"))];
    const legacyPlanRel =
      planMarkdown === null ? null : relocate(projectRoot, flatPlan, join(archive, "plan.md"));
    if (legacyPlanRel !== null) legacy.push(legacyPlanRel);

    writeFileSync(requirements, scaffoldFreshRequirements(legacy[0]!, legacyPlanRel));

    const remaining = remainingRowsByMilestone(planMarkdown ?? "");
    const planStubs: string[] = [];
    for (const key of [...new Set(openMilestones.map(milestoneKey))]) {
      const stub = join(projectRoot, "specs", "plan", `${key}.md`);
      mkdirSync(dirname(stub), { recursive: true });
      writeFileSync(stub, planStubBody(key, remaining.get(key) ?? [], legacyPlanRel));
      planStubs.push(relative(projectRoot, stub));
    }

    return { legacy, requirements: relative(projectRoot, requirements), planStubs };
  } catch (cause) {
    if (cause instanceof MonolithFreezeError) throw cause;
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new MonolithFreezeError(
      `the freeze failed part-way through: ${detail}`,
      "restore the specs/ tree from the backup this flow took, then re-run `/dev-process-toolkit:upgrade`",
    );
  }
}
