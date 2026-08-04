// plan_identity_mode_conditional — /gate-check probe #73.
//
// The plan-file twin of probe #13, over `specs/plan/**` (active + archive):
//   - mode: none      → a MINTED plan (`M_<key>`, the shape
//                       `milestoneIdFromUlid` derives) MUST carry
//                       `id: fr_<26-char ULID>` — the value `Provider.mintId()`
//                       returned, verbatim, `fr_` prefix included.
//   - mode: <tracker> → NO plan file may carry an `id:` line at all,
//                       whatever its id shape.
//
// LEGACY COEXISTENCE. The mode-none `id:`-REQUIRED rule is keyed on the plan-id
// SHAPE, not on the mode alone: a flat "every mode-none plan needs `id:`" rule
// would hard-fail every pre-existing plan in every tracker-less consumer project
// on upgrade — the migration the spec explicitly rules out. So the requirement
// is scoped to exactly `milestoneIdFromUlid`'s OUTPUT RANGE (`M_` + a 6-char
// Crockford base32 tail). Nothing outside that range is ever asked for an `id:`,
// but the two out-of-range shapes part company on what IS asked of them:
//   - Epic-keyed `M_PROJ_500` plans carried over by a jira → none mode
//     transition are grandfathered UNCONDITIONALLY. They never had a ULID to
//     record and their operator cannot satisfy any identity remedy, so no
//     evidence could change the disposition and none is gathered.
//   - sequential `M<N>` plans are grandfathered BY PROVENANCE — see the
//     PROVENANCE block below. Shape alone cannot separate a plan written before
//     minting existed from one mis-named moments ago, because the two are
//     byte-identical, so the shape-only carve-out passed both forever and the
//     invariant was unenforceable for exactly the new plans it exists to catch.
// Scoping by the producer's own range is not the fragile charset heuristic the
// spec ruled out for the token GRAMMAR — that rejected proposal was a third
// parser `kind` affecting every consumer. This is one probe declining to police
// ids it can prove it did not mint. A real Jira key sanitizes to `PROJ_500`
// (letters, `_`, digits), so it cannot land inside the tail range by accident.
// The tracker-mode direction stays unconditional; no plan of any shape may
// carry `id:`.
//
// PROVENANCE. A sequential `M<N>` plan under `mode: none` is dispositioned by
// when git says it ARRIVED, into exactly four labels (`classifyPlanProvenance`):
// `fresh` is an error-severity violation, `legacy` and `exempt` say nothing —
// that is the upgrade-safety property the carve-out has always bought — and
// `undecidable` (a git repository whose introducing commit is unreachable) is a
// warning-severity ADVISORY, the only disposition that neither reddens CI on a
// plan the operator cannot fix nor restores the silent blind spot. `kind:
// legacy` in the frontmatter clears it permanently. Severity therefore travels
// per VIOLATION and the report takes the maximum across its rows, so one
// advisory never masks a hard failure and an advisory-only run stays green.
//
// SIBLING MODULE, NOT AN EXTENSION of `identity_mode_conditional.ts`. That
// module documents a deliberate scope-isolation boundary (FR-only walk, zero
// runtime dep on `ulid.ts`); widening it to plan files would violate the
// boundary, so the plan invariant ships as its own module and keeps its own
// walk. Rendering (`buildNote` / `buildMessage` NFR-10 canonical shape) and
// mode resolution (`readTaskTrackingSection`) follow probe #13's precedent.
//
// Filename acceptance rides the shared `milestone_token` union matcher
// (`PLAN_FILENAME_RE` / `parseMilestoneToken`) — never a private `M\d+` copy.
//
// CROSS-FILE DUPLICATE PASS. Every check above is PER-FILE self-consistency:
// a plan's `id:` must derive a plan's OWN basename. Self-consistency is not
// uniqueness. Two independently minted plans whose short ULIDs collide on the
// same 6-char tail each derive their own filename, so both pass the per-file
// check and sit green side by side — one in `specs/plan/`, one in
// `specs/plan/archive/`, invisible to a walk that keeps no cross-file state.
// The token is the key every downstream reader uses (archive lookup, ship
// stamp, milestone resolution), so a collision silently resolves to whichever
// file the reader walks first. The walk therefore accumulates a
// basename → files index across BOTH trees and, after the walk, raises one
// violation per token claimed by more than one plan. The pass is
// mode-independent: a duplicate token is a defect whether or not the project
// runs a tracker, and it is keyed on the FILENAME so legacy sequential plans
// (which carry no `id:` to derive from) are covered too.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { normalizeFrontmatterSource, parseFrontmatter } from "./frontmatter";
import { PLAN_FILENAME_RE, milestoneIdFromUlid, parseMilestoneToken } from "./milestone_token";
import { readTaskTrackingSection } from "./resolver_config";
import { ULID_REGEX } from "./ulid";

const ANY_ID_LINE_RE = /^id:\s*(.*)$/;

/**
 * The module's DECLARED severity — a regression must hard-fail, not slip through
 * as `GATE PASSED WITH NOTES`.
 *
 * No longer the report-wide value: rows carry their own severity and the report
 * takes the maximum, because one walk can emit a hard failure and an advisory
 * together. This stays the fallback for a ZERO-row report, where there is no
 * maximum to take, so the registration's declared severity is still readable
 * without running the probe.
 */
export const PLAN_IDENTITY_MODE_CONDITIONAL_SEVERITY: "warning" | "error" = "error";

export interface PlanIdentityModeViolation {
  file: string;
  line: number;
  expected:
    | "present"
    | "absent"
    | "fr_<26-char ULID>"
    | "an id: the filename derives from"
    | "exactly one id: line"
    | "one plan file per milestone token"
    | "a minted M_<6-char Crockford> plan"
    | "a discoverable introducing commit";
  actual: string;
  /**
   * Per-row severity. `error` fails the gate; `warning` is an advisory the run
   * reports without going red. It travels with the ROW, not the report, because
   * one walk can now emit both: a mis-named fresh plan is a hard failure while
   * an unreadable provenance is only an advisory, and a report-wide constant
   * would collapse the pair to whichever value was written last.
   */
  severity: "warning" | "error";
  note: string;
  message: string;
}

export interface PlanIdentityModeConditionalReport {
  mode: string;
  severity: "warning" | "error";
  violations: PlanIdentityModeViolation[];
}

/** One plan file's contribution to the cross-file duplicate index. */
interface PlanTokenClaim {
  file: string;
  rel: string;
  /** The `id:` line if the plan carries one, else 1 — notes must cite a line. */
  line: number;
  /** The recorded minted id, or `""` for a legacy plan that carries none. */
  id: string;
}

interface IdScan {
  present: boolean;
  line: number;
  value: string;
  wellFormed: boolean;
  /** 1-based line of every `id:` key found. Length > 1 ⇒ ambiguous identity. */
  idLines: number[];
}

/**
 * Locate every `id:` key inside the plan's frontmatter block.
 *
 * Normalising through the shared `normalizeFrontmatterSource` is load-bearing,
 * not cosmetic. The scan anchors on a literal `---\n` opener, so ANY unhandled
 * BOM or `\r\n` separator makes a whole plan file read as "no frontmatter" —
 * silently wrong in BOTH directions: in tracker mode it PASSES a plan carrying a
 * forbidden `id:` (false negative on an error-severity probe), and in
 * `mode: none` it reports a well-formed minted plan as missing its key
 * (false-positive GATE FAILED). Both were reproduced against real fixtures.
 * The shared helper is also what `classifyPlanProvenance` reads `kind:` through,
 * so the two entry points agree on what counts as frontmatter by construction.
 */
function scanFrontmatterForId(rawContent: string): IdScan {
  const absent: IdScan = { present: false, line: 0, value: "", wellFormed: false, idLines: [] };
  const content = normalizeFrontmatterSource(rawContent);
  if (!content.startsWith("---\n")) return absent;
  const closeIdx = content.indexOf("\n---", 4);
  if (closeIdx < 0) return absent;
  const fmLines = content.slice(4, closeIdx).split("\n");

  const idLines: number[] = [];
  let first: { line: number; value: string } | null = null;
  for (let i = 0; i < fmLines.length; i++) {
    const m = ANY_ID_LINE_RE.exec(fmLines[i]!);
    if (!m) continue;
    // +2: one for the leading `---\n` line, one for 1-based indexing.
    const line = i + 2;
    idLines.push(line);
    if (first === null) first = { line, value: (m[1] ?? "").trim() };
  }
  if (first === null) return absent;

  return {
    present: true,
    line: first.line,
    value: first.value,
    wellFormed: ULID_REGEX.test(first.value),
    idLines,
  };
}

function resolveMode(projectRoot: string): string {
  const section = readTaskTrackingSection(join(projectRoot, "CLAUDE.md"));
  const mode = section["mode"];
  if (!mode || mode.length === 0) return "none";
  return mode;
}

/**
 * Every plan file under `specs/plan/**` — active dir and `archive/` alike.
 * `PLAN_FILENAME_RE` gates the walk, so `README.md` / `notes.txt` and any
 * other non-plan file living beside the plans is ignored.
 */
async function listPlanFiles(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listPlanFiles(full)));
    } else if (entry.isFile() && PLAN_FILENAME_RE.test(entry.name)) {
      files.push(full);
    }
  }
  return files.sort();
}

function buildNote(file: string, line: number, reason: string, projectRoot: string): string {
  return `${relative(projectRoot, file)}:${line} — ${reason}`;
}

function buildMessage(reason: string, remedy: string, context: Record<string, string>): string {
  // NFR-10 canonical shape: verdict + remedy + context fused.
  const contextStr = Object.entries(context)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
  return `plan_identity_mode_conditional: ${reason}\nRemedy: ${remedy}\nContext: ${contextStr}`;
}

/**
 * The exact output range of `milestoneIdFromUlid`: `M_` + the 6-char Crockford
 * base32 tail of a ULID. Narrower than `{kind: "epic"}` on purpose — see the
 * LEGACY COEXISTENCE note in the module header for why Epic-keyed ids are
 * grandfathered rather than policed.
 */
const MINTED_TAIL_RE = /^[0-9A-HJKMNP-TV-Z]{6}$/;

/** A minted (`M_<short-ULID>`) plan id — the shape `milestoneIdFromUlid` derives. */
function isMintedPlanId(fileName: string): boolean {
  const token = parseMilestoneToken(fileName.replace(/\.md$/, ""));
  return token?.kind === "epic" && MINTED_TAIL_RE.test(token.key);
}

// The mint epoch: 2026-07-26T00:00:00Z, the ship date of v2.56.0 "Mint" — the
// release that taught the producer to mint milestone ids, and so the instant
// after which a sequential `M<N>` plan can no longer have been written in good
// faith. A plan whose introducing commit is dated strictly BEFORE it gets the
// legacy carve-out and stays silent; a plan dated at or after it is `fresh`.
export const MINT_EPOCH = "2026-07-26T00:00:00Z";

/** The complete provenance vocabulary — exactly four labels, nothing else. */
export type PlanProvenanceClass = "fresh" | "legacy" | "undecidable" | "exempt";

/**
 * `kind:` values that opt a plan out of the provenance check entirely.
 *
 * `scaffolding` is the vocabulary `/setup` already writes (read by
 * `plan_only_archival.ts` and, through it, `tracker_local_reconciliation_drift`);
 * `legacy` is the operator's permanent way to clear an `undecidable` advisory.
 * A two-value allow-list on purpose — carrying *a* `kind:` key exempts nothing.
 */
const EXEMPT_PLAN_KINDS: readonly string[] = ["scaffolding", "legacy"];

/**
 * Run a git query in `projectRoot`, returning `null` when git refuses.
 *
 * stderr is piped rather than inherited so a severed-object repository does not
 * spray `fatal: bad object` across an otherwise clean gate run.
 */
function gitQuery(projectRoot: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      cwd: projectRoot,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return null;
  }
}

/**
 * Classify one plan's provenance — the signal that separates a freshly
 * mis-named sequential plan from a genuinely legacy one.
 *
 * A pure function of exactly three inputs: the project root, the plan's path,
 * and the plan's raw frontmatter source. It reads git and the string it was
 * handed; it never re-reads the path, never writes, and never mutates the
 * working tree, so repeated calls agree and `git status` is unchanged after.
 *
 * The resolution order is load-bearing:
 *
 *   1. `kind: scaffolding` / `kind: legacy` ⇒ `exempt`, whatever git says.
 *   2. Not a git working tree ⇒ `legacy`. There is no provenance to read, and
 *      failing here would be the forced migration this design exists to avoid.
 *      Asked of git (`rev-parse --show-toplevel`), not inferred from a `.git`
 *      entry at the project root — a monorepo package has none and is still
 *      fully datable.
 *   3. Untracked ⇒ `fresh`. A file git does not know cannot predate anything;
 *      it was written by the current session. Earliest, cheapest catch.
 *      A git that REFUSES to answer is not the same as one answering "not
 *      tracked" and degrades to `undecidable` instead — see the note at the
 *      `ls-files` call.
 *   4. Tracked but absent from the tip tree ⇒ `fresh` (staged, never
 *      committed). THE discriminator: staged-and-never-committed and
 *      severed-history read identically on `ls-files` (present) and
 *      `git log --diff-filter=A` (empty). Only `HEAD:<path>` parts them, so a
 *      classifier that stops at those two misfiles the cheapest catch as an
 *      advisory.
 *   5. No discoverable introducing commit ⇒ `undecidable`.
 *   6. Otherwise compare the introducing commit's author date to `MINT_EPOCH`,
 *      inclusive at the boundary: at-or-after ⇒ `fresh`, before ⇒ `legacy`.
 *      The date is keyed on the milestone token's two canonical paths — see
 *      `introducingCommitDate` — without which archiving a legacy plan would
 *      re-date it to the archive commit.
 *
 * Scope is the caller's job: this answers "when did it arrive", not "is it a
 * plan the probe polices".
 */
export function classifyPlanProvenance(
  projectRoot: string,
  planPath: string,
  rawPlanSource: string,
): PlanProvenanceClass {
  // `parseFrontmatter` normalises through `normalizeFrontmatterSource`, so
  // CRLF- and BOM-prefixed plans resolve their `kind:` like any other.
  const kind = parseFrontmatter(rawPlanSource, { lenient: true })["kind"];
  if (typeof kind === "string" && EXEMPT_PLAN_KINDS.includes(kind.trim())) return "exempt";

  // Ask git whether this is a working tree, rather than testing for a `.git`
  // ENTRY at the project root. A package inside a monorepo has no `.git` of
  // its own, so the `existsSync` test this replaces classified every plan
  // there `legacy` — silently, including one created moments ago, which is
  // the blind spot this probe exists to close.
  if (gitQuery(projectRoot, ["rev-parse", "--show-toplevel"]) === null) return "legacy";

  // git speaks POSIX separators even on Windows, where `relative` yields `\`.
  const rel = relative(projectRoot, planPath).split("\\").join("/");

  // A git that cannot answer AT ALL is not evidence of freshness. Distinguish
  // "git says untracked" (empty output, a real answer) from "git refused"
  // (null — missing binary, corrupt object store, unreadable index). The
  // second degrades to the advisory, because an operator whose git is broken
  // cannot fix it by renaming a plan, and an ERROR row there would hard-fail
  // every legacy plan in the repository on a condition they did not cause.
  const tracked = gitQuery(projectRoot, ["ls-files", "--", rel]);
  if (tracked === null) return "undecidable";
  if (tracked.trim().length === 0) return "fresh";

  // `./` prefix is load-bearing. `<rev>:<path>` resolves path from the REPO
  // ROOT, while `rel` is project-root-relative and `gitQuery` runs with the
  // project root as cwd — so in a monorepo package the bare form asks about a
  // path that does not exist, git errors, and every legacy plan there reads
  // `fresh` and hard-fails. A leading `./` switches the syntax to
  // cwd-relative, which is what `rel` already is.
  if (gitQuery(projectRoot, ["cat-file", "-e", `HEAD:./${rel}`]) === null) return "fresh";

  const introducedAt = introducingCommitDate(projectRoot, rel);
  if (introducedAt === null) return "undecidable";

  return introducedAt >= Date.parse(MINT_EPOCH) ? "fresh" : "legacy";
}

/**
 * The author date of the commit that introduced `rel`, in epoch millis, or
 * `null` when no introducing commit is discoverable.
 *
 * ARCHIVE-AWARE, and that is the load-bearing part. `git log --diff-filter=A`
 * scoped to a single path stops at the archive move: a plan relocated into
 * `specs/plan/archive/` reports the ARCHIVE commit's date, not the date the
 * plan was written. Archival is exactly what `/spec-archive` and `/implement`
 * Phase 4 do to every plan they close, so a query blind to it would read a
 * genuinely legacy plan as post-epoch the moment it was archived, classify
 * `fresh`, and hard-fail — the forced migration this design exists to avoid,
 * fired by the toolkit's own archival step.
 *
 * Deliberately NOT `git log --follow`, and not git rename detection at all.
 * Both resolve renames by content SIMILARITY, and plan files are
 * template-shaped: unrelated plans routinely clear the default 50% threshold,
 * so a fresh mis-named plan gets reported as a "rename" of some older one and
 * dated before the epoch. That laundering is the precise failure this probe
 * exists to catch, so no similarity heuristic is usable here. (Observed
 * against the incident fixture under `--follow`, and again under explicit
 * per-commit rename detection: the post-epoch plan silently classified
 * `legacy`.) Keying on the token's own two paths removes the heuristic
 * entirely rather than tuning it.
 *
 * Instead we hop renames EXPLICITLY. Find the commit that added the current
 * path; ask that one commit whether the path arrived as a rename destination;
 * if so, continue from the source path. Rename detection stays scoped to a
 * single commit's own diff, where the pairing is unambiguous, rather than being
 * inferred across unrelated history. A path that was never renamed costs one
 * extra `git show` and stops immediately.
 *
 * The hop count is bounded so a pathological or cyclic history cannot spin.
 */
function introducingCommitDate(projectRoot: string, rel: string): number | null {
  // IDENTITY-KEYED, NOT RENAME-DETECTED. A plan's milestone token IS its
  // identity, and a sequential plan can only ever live at two canonical paths:
  // `specs/plan/<token>.md` while active, `specs/plan/archive/<token>.md` once
  // archived. So the introduction date is simply the OLDEST add across those
  // two paths — no rename detection, no hop walk, no similarity heuristic.
  //
  // Three defects died with the walk this replaces, each reproduced first:
  //
  //   1. CONTENT-CHANGING ARCHIVAL. Git only emits an `R` row above its 50%
  //      similarity threshold. `/implement` Phase 4 appends a `## Summary`
  //      section and a `shipped_in` stamp in the same commit that archives,
  //      which drops the pair below it — git reports plain `D` + `A`, the
  //      rename lookup found nothing, and a legacy plan re-dated to its
  //      archive commit and hard-failed. Verbatim the forced migration this
  //      design forbids, fired by the toolkit's own archival step.
  //   2. REOPEN CYCLES. `--diff-filter=A -1` returns the MOST RECENT add, so
  //      an archived → reopened → re-archived plan walked
  //      `archive/M2` → `M2` → `archive/M2`, tripped its own cycle guard, and
  //      returned `undecidable`. 31 of THIS repository's 118 archived plans
  //      (M84–M118, every modern one) classified that way.
  //   3. CROSS-TOKEN LAUNDERING. Git pairs renames by greedy global similarity
  //      over the whole commit. One commit that stamps-and-archives `M2` while
  //      creating a fresh `M3` yields `R078 M2 → M3`, so the fresh plan
  //      inherited the old date and classified `legacy` — the precise
  //      laundering `--follow` was rejected for, reintroduced by the explicit
  //      walk. Restricting the query to THIS token's two paths makes a sibling
  //      plan structurally unreachable, so no similarity score can launder it.
  //
  // `--full-history` is load-bearing: default history simplification prunes
  // the introducing commit of a path that was later renamed away, so the plain
  // query returns empty for exactly the archived plans this must date. Dates
  // sort lexicographically because `%aI` is strict ISO-8601 with a fixed-width
  // offset, so `sort()` on the raw strings is a chronological sort.
  const token = basename(rel, ".md");
  const out = gitQuery(projectRoot, [
    "log",
    "--full-history",
    "--diff-filter=A",
    "--format=%aI",
    "--",
    `specs/plan/${token}.md`,
    `specs/plan/archive/${token}.md`,
  ]);
  if (out === null) return null;

  const dates = out
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((iso) => Date.parse(iso))
    .filter((n) => Number.isFinite(n));
  if (dates.length === 0) return null;

  return Math.min(...dates);
}

/**
 * Scan every plan file under `projectRoot/specs/plan/**` and return the list
 * of violations. Pure function — no side effects, no writes.
 *
 * Call site: `/gate-check` probe #73 + the integration test at
 * `tests/gate-check-plan-identity-mode-conditional.test.ts`.
 */
export async function runPlanIdentityModeConditionalProbe(
  projectRoot: string,
): Promise<PlanIdentityModeConditionalReport> {
  const mode = resolveMode(projectRoot);
  const isTracker = mode !== "none";
  const files = await listPlanFiles(join(projectRoot, "specs", "plan"));
  const violations: PlanIdentityModeViolation[] = [];
  // basename (= milestone token) → every plan file claiming it, across
  // `specs/plan/` and `specs/plan/archive/` together. `listPlanFiles` already
  // recurses into `archive/` and sorts, so insertion order is deterministic.
  const claimsByToken = new Map<string, PlanTokenClaim[]>();

  for (const file of files) {
    let content: string;
    try {
      content = await readFile(file, "utf-8");
    } catch {
      continue;
    }
    const rel = relative(projectRoot, file);
    const scan = scanFrontmatterForId(content);

    // Cross-file accumulation happens for EVERY walked plan, before any
    // mode branch or grandfathering `continue` — a token collision is not
    // conditional on mode, id shape, or whether the plan carries an id at all.
    const token = basename(file, ".md");
    const claim: PlanTokenClaim = {
      file,
      rel,
      line: scan.present ? scan.line : 1,
      id: scan.present ? scan.value : "",
    };
    const claims = claimsByToken.get(token);
    if (claims === undefined) claimsByToken.set(token, [claim]);
    else claims.push(claim);

    if (isTracker) {
      // Tracker mode: `id:` must be absent — shape-independent.
      if (!scan.present) continue;
      const expected = "absent" as const;
      const actual = scan.value;
      violations.push({
        file,
        line: scan.line,
        expected,
        actual,
        severity: "error",
        note: buildNote(file, scan.line, `expected ${expected}, actual ${actual}`, projectRoot),
        message: buildMessage(
          `tracker-mode plan carries an id: line that should be absent (observed ${actual})`,
          `delete the id: line from ${rel} frontmatter — the tracker ID is the canonical identity in tracker mode`,
          { mode, file: rel, line: String(scan.line) },
        ),
      });
      continue;
    }

    // mode: none — only MINTED plan ids carry the key. A NON-minted plan is
    // dispositioned by git PROVENANCE rather than by its filename shape: the
    // shape alone cannot tell a plan written before minting existed from one
    // mis-named moments ago, so the shape-only carve-out passed both, forever.
    if (!isMintedPlanId(basename(file))) {
      // Epic-keyed `M_PROJ_500` plans stay grandfathered unconditionally: they
      // are carried over by a jira → none transition, never had a ULID to
      // record, and their operator cannot satisfy any identity remedy. Only
      // sequential `M<N>` plans are queried, which also bounds the git cost.
      if (parseMilestoneToken(token)?.kind !== "numeric") continue;

      const provenance = classifyPlanProvenance(projectRoot, file, content);
      if (provenance === "fresh") {
        const expected = "a minted M_<6-char Crockford> plan" as const;
        const actual = `sequential ${token} introduced at or after the mint epoch`;
        violations.push({
          file,
          line: 1,
          expected,
          actual,
          severity: "error",
          note: buildNote(file, 1, `expected ${expected}, actual ${actual}`, projectRoot),
          message: buildMessage(
            `tracker-less plan ${basename(file)} is a NEW sequential milestone — git introduces it at or after the mint epoch, so it cannot be a legacy plan`,
            `re-mint this milestone and rename ${rel} to the M_<6-char Crockford> filename its minted id derives, recording that id verbatim in the frontmatter. If the plan genuinely predates minting and git provenance is misleading (a re-created tree, a squashed import), declare it with kind: legacy in the frontmatter instead`,
            { mode, file: rel, provenance, epoch: MINT_EPOCH },
          ),
        });
      } else if (provenance === "undecidable") {
        // Advisory, not a failure: the project IS a git repository but the
        // introducing commit is unreachable. Failing would go red on plans the
        // operator cannot fix; passing silently would restore the blind spot.
        const expected = "a discoverable introducing commit" as const;
        const actual = `no introducing commit for ${token} is reachable in this repository`;
        violations.push({
          file,
          line: 1,
          expected,
          actual,
          severity: "warning",
          note: buildNote(file, 1, `expected ${expected}, actual ${actual}`, projectRoot),
          message: buildMessage(
            `tracker-less plan ${basename(file)} has unreadable provenance — git cannot reach the commit that introduced it, so it can be neither cleared as legacy nor failed as new`,
            `add kind: legacy to the frontmatter of ${rel} to clear this advisory permanently — that is the only remedy that works here. The introducing commit is unreachable in this object store (severed or pruned), or git declined to answer; restoring the missing object would also clear it, but deepening a shallow clone will not, because a shallow clone answers this query with its boundary commit rather than failing it`,
            { mode, file: rel, provenance, epoch: MINT_EPOCH },
          ),
        });
      }
      // `legacy` and `exempt` produce nothing — the upgrade-safety property.
      continue;
    }

    if (scan.idLines.length > 1) {
      // YAML duplicate keys are last-wins in `parseFrontmatter`, but this scan
      // reads the first — so a duplicate is a genuine ambiguity in which the
      // probe and every other reader can disagree about the plan's identity.
      // Refuse to adjudicate; make the operator collapse it.
      const expected = "exactly one id: line" as const;
      const actual = `${scan.idLines.length} id: lines (${scan.idLines.join(", ")})`;
      violations.push({
        file,
        line: scan.idLines[0]!,
        expected,
        actual,
        severity: "error",
        note: buildNote(file, scan.idLines[0]!, `expected ${expected}, actual ${actual}`, projectRoot),
        message: buildMessage(
          `mode-none minted plan carries ${scan.idLines.length} id: lines (${actual})`,
          `collapse ${rel} to a single id: line — duplicate YAML keys are last-wins to the shared frontmatter parser but first-wins to this scan, so the plan's identity is ambiguous`,
          { mode, file: rel, lines: scan.idLines.join(",") },
        ),
      });
    } else if (!scan.present) {
      const expected = "present" as const;
      violations.push({
        file,
        line: 1,
        expected,
        actual: "missing",
        severity: "error",
        note: buildNote(file, 1, `expected id: line ${expected}, actual missing`, projectRoot),
        message: buildMessage(
          `mode-none minted plan is missing its id: line`,
          `add the minted id: fr_<26-char ULID> line to ${rel} frontmatter — the plan id derives from it, so the plan must record the value verbatim. If this plan was never minted (hand-authored or ported, so no id ever existed), rename it off the minted M_<6-char Crockford> shape AND declare kind: legacy in the same edit — a sequential M<N> name is dispositioned by git provenance, not by its shape, so a rename landing today reads as a NEW mis-named plan and fails unless the frontmatter says otherwise`,
          { mode, file: rel },
        ),
      });
    } else if (!scan.wellFormed) {
      const expected = "fr_<26-char ULID>" as const;
      const actual = scan.value;
      violations.push({
        file,
        line: scan.line,
        expected,
        actual,
        severity: "error",
        note: buildNote(file, scan.line, `expected ${expected}, actual ${actual}`, projectRoot),
        message: buildMessage(
          `mode-none minted plan has a malformed id: value (observed ${actual})`,
          `fix the id: line in ${rel} to match ${expected} — the value Provider.mintId() returned, verbatim`,
          { mode, file: rel, line: String(scan.line) },
        ),
      });
    } else if (milestoneIdFromUlid(scan.value) !== basename(file, ".md")) {
      // The key is only load-bearing if the filename actually derives from it.
      // A well-formed but unrelated ULID would otherwise pass clean, leaving
      // the plan's real minted identity unreconstructable — the plan-side twin
      // of the FR-side `id: ≡ filename stem` invariant.
      const expected = "an id: the filename derives from" as const;
      const derived = milestoneIdFromUlid(scan.value);
      violations.push({
        file,
        line: scan.line,
        expected,
        actual: `${scan.value} (derives ${derived})`,
        severity: "error",
        note: buildNote(
          file,
          scan.line,
          `expected ${expected}, actual ${scan.value} derives ${derived}`,
          projectRoot,
        ),
        message: buildMessage(
          `mode-none minted plan's id: does not derive its own filename (${scan.value} derives ${derived}, file is ${basename(file)})`,
          `either restore the id: line in ${rel} to the ULID this plan was minted from, or rename the plan to ${derived}.md — the filename is the 6-char tail of the recorded id`,
          { mode, file: rel, line: String(scan.line), derived },
        ),
      });
    }
  }

  // Cross-file pass, APPENDED after the per-file walk so the existing
  // per-file violation ordering is untouched.
  for (const [token, claims] of claimsByToken) {
    if (claims.length < 2) continue;
    const first = claims[0]!;
    const relProse = claims.map((c) => c.rel).join(", ");
    const relCtx = claims.map((c) => c.rel).join(" | ");
    const idCtx = claims.map((c) => (c.id.length > 0 ? c.id : "(no id:)")).join(" | ");
    const expected = "one plan file per milestone token" as const;
    const actual = `${claims.length} plan files derive ${token} (${relProse})`;
    violations.push({
      file: first.file,
      line: first.line,
      expected,
      actual,
      severity: "error",
      note: buildNote(first.file, first.line, `expected ${expected}, actual ${actual}`, projectRoot),
      message: buildMessage(
        `duplicate milestone token — ${claims.length} plan files collide on ${token} across specs/plan/ and specs/plan/archive/ (${relProse})`,
        `rename all but one of ${relProse} off ${token} — for a minted plan, re-mint it and rewrite both its filename and its id: line together, since the filename is the 6-char tail of the recorded id. Each file is individually self-consistent, so nothing else flags this: every reader keyed on the token (archive lookup, ship stamp, milestone resolution) silently resolves to whichever colliding file it walks first`,
        { mode, token, files: relCtx, ids: idCtx },
      ),
    });
  }

  return {
    mode,
    // Maximum across the rows, so one advisory never masks a hard failure and
    // an advisory-only run does not fail the gate. With zero rows there is no
    // maximum to take, so the report falls back to the module's declared
    // default — the value the gate has always read for an empty report.
    severity:
      violations.length === 0
        ? PLAN_IDENTITY_MODE_CONDITIONAL_SEVERITY
        : violations.some((v) => v.severity === "error")
          ? "error"
          : "warning",
    violations,
  };
}
