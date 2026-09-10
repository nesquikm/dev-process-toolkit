// active_plan_ship_ready — /gate-check probe #75 (STE-462).
//
// Invariant (AC-STE-462.1): walk every ACTIVE plan under `specs/plan/`
// (numeric `M<N>` and epic-keyed `M_<epic-key>` filenames alike) and classify
// it ship-ready ⇔ zero ACTIVE FRs (`specs/frs/*.md`) carry its milestone
// token in frontmatter AND ≥ 1 ARCHIVED FR (`specs/frs/archive/*.md`) does.
//
// Severity: warning (NotesOnly) — `violations` is ALWAYS empty; hits render a
// single NOTES row. Pure file reads — no git, no network, no LLM judgment.
//
//   - `ship_state: parked` on the active plan → excluded from the ship-ready
//     row AND from shipReadyMilestones (both consumers — /gate-check and
//     /implement — share this one predicate); surfaced via the parked-note
//     idiom of `plan_ship_coherence.ts` (`parked milestones: <list>`).
//   - `shipped_in: null` template sentinel → unshipped, still eligible.
//   - real `shipped_in: v<X.Y.Z>` stamp → never nudged.
//   - zero bound FRs (fresh / plan-only) → never flagged.
//   - `specs/plan/` absent or empty → vacuous.
//   - a plan that would otherwise be ship-ready and declares `spans_repos:`
//     is read through `resolveSpansRepos`: a declared sibling that still holds
//     active FRs demotes it to the `awaiting-sibling milestones:` row (never
//     ship-ready), and an unlocatable sibling adds a `sibling-unlocatable
//     milestones:` row while the verdict stands. A malformed declaration
//     propagates its `SpansReposError` refusal.

import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
// Union grammar: `M<N>` and `M_<epic-key>` active plans are both walked.
import { PLAN_FILENAME_RE, compareMilestoneTokens } from "./milestone_token";
import { normalizeFrontmatterSource } from "./frontmatter";
import { SpansReposError, resolveSpansRepos } from "./spans_repos";

export interface ActivePlanShipReadyReport {
  /** Always empty — the probe is warning-only by contract (NotesOnly). */
  violations: never[];
  notes: string[];
}

const STAMP_RE = /^v\d+\.\d+\.\d+$/;

/** Canonical remedy suffix on the ship-ready NOTES row. */
const NOTE_SUFFIX = " — run /spec-archive M<N> then /ship-milestone M<N>";

/** Scan the frontmatter block for a scalar key's trimmed value, or null. */
function scanFrontmatterField(content: string, key: string): string | null {
  // Fold BOM + CRLF/lone-CR first, or a Windows-authored file reads as
  // having no frontmatter and this check silently passes on an unparsed file.
  content = normalizeFrontmatterSource(content);
  if (!content.startsWith("---\n")) return null;
  const closeIdx = content.indexOf("\n---", 4);
  if (closeIdx < 0) return null;
  let value: string | null = null;
  for (const line of content.slice(4, closeIdx).split("\n")) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line);
    if (m && m[1] === key) value = (m[2] ?? "").trim();
  }
  return value;
}

/** List `.md` files directly under `dir` (non-recursive); [] if absent. */
async function listMarkdownFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.endsWith(".md"))
      .map((e) => join(dir, e.name))
      .sort();
  } catch {
    return [];
  }
}

/** One FR file: its id (filename stem) and the `milestone:` token it binds to. */
interface FrBindingRow {
  id: string;
  /** The trimmed `milestone:` value, or null when the key is absent. */
  milestone: string | null;
}

/**
 * The ONE walk of an FR directory in this module. Both readings of the binding
 * — the token multiset the ship-ready predicate needs and the per-milestone id
 * lists `milestoneFrBinding` returns — are derived from these rows, so the
 * directory is scanned by one loop with one frontmatter reader rather than two
 * that could drift apart.
 */
async function readFrDir(dir: string): Promise<FrBindingRow[]> {
  const rows: FrBindingRow[] = [];
  for (const file of await listMarkdownFiles(dir)) {
    let content: string;
    try {
      content = await readFile(file, "utf-8");
    } catch {
      continue;
    }
    rows.push({
      id: basename(file, ".md"),
      milestone: scanFrontmatterField(content, "milestone"),
    });
  }
  return rows;
}

/** The multiset of `milestone:` tokens these rows bind to (blanks dropped). */
function boundTokens(rows: readonly FrBindingRow[]): Set<string> {
  const tokens = new Set<string>();
  for (const row of rows) {
    if (row.milestone) tokens.add(row.milestone);
  }
  return tokens;
}

/** Ids among `rows` whose frontmatter binds them to `milestone`, sorted. */
function idsBoundTo(rows: readonly FrBindingRow[], milestone: string): string[] {
  return rows
    .filter((row) => row.milestone === milestone)
    .map((row) => row.id)
    .sort();
}

export interface Classification {
  shipReady: string[]; // sorted via compareMilestoneTokens
  parked: string[]; // sorted via compareMilestoneTokens
  /** `<token> (<name>: <n> active FRs)` — a declared sibling still holds work. */
  awaitingSiblings: string[]; // sorted via compareMilestoneTokens
  /** `<token> (<name> at <declaredPath>)` — a declared sibling cannot be located. */
  unlocatableSiblings: string[]; // sorted via compareMilestoneTokens
}

/**
 * The milestone token a rendered sibling entry leads with —
 * `M7 (glacy-app-be: 1 active FRs)` → `M7`. The entry is rendered in this
 * module, so its parse lives here too rather than in each consumer.
 */
export function leadingToken(entry: string): string {
  return entry.split(" ", 1)[0]!;
}

/** Order rendered sibling entries by milestone token, not lexicographically. */
function byLeadingToken(a: string, b: string): number {
  return compareMilestoneTokens(leadingToken(a), leadingToken(b));
}

/** Walk active plans and classify each one; shared core of every export. */
export async function classifyActivePlans(projectRoot: string): Promise<Classification> {
  const planDir = join(projectRoot, "specs", "plan");
  const planFiles = (await listMarkdownFiles(planDir)).filter((f) =>
    PLAN_FILENAME_RE.test(basename(f)),
  );
  const out: Classification = {
    shipReady: [],
    parked: [],
    awaitingSiblings: [],
    unlocatableSiblings: [],
  };
  if (planFiles.length === 0) return out;

  const frsDir = join(projectRoot, "specs", "frs");
  const activeFrTokens = boundTokens(await readFrDir(frsDir));
  const archivedFrTokens = boundTokens(await readFrDir(join(frsDir, "archive")));

  for (const file of planFiles) {
    let content: string;
    try {
      content = await readFile(file, "utf-8");
    } catch {
      continue;
    }
    const token = basename(file, ".md");
    // Real `shipped_in: v<X.Y.Z>` stamp → already shipped, never nudged.
    // (`shipped_in: null` is the plan template's pre-ship sentinel: unshipped.)
    const shippedIn = scanFrontmatterField(content, "shipped_in");
    if (shippedIn !== null && STAMP_RE.test(shippedIn)) continue;
    // Parked plans are excluded from the predicate (no /gate-check nudge, no
    // /implement close offer) but surfaced so parking never goes silent.
    if (scanFrontmatterField(content, "ship_state") === "parked") {
      out.parked.push(token);
      continue;
    }
    // Ship-ready ⇔ zero active FRs bound AND ≥ 1 archived FR bound.
    if (!activeFrTokens.has(token) && archivedFrTokens.has(token)) {
      // A spanning milestone waits for every declared sibling: one holding
      // active FRs demotes it; one that cannot be located is reported, but
      // does not block the local verdict. Undeclared plans resolve to [].
      const siblings = (
        await resolveSpansRepos({
          planBody: content,
          milestone: token,
          invokingRepo: projectRoot,
        })
      ).filter((s) => !s.self);
      const busy = siblings.filter(
        (s) => s.binding !== null && s.binding.activeFrIds.length > 0,
      );
      if (busy.length > 0) {
        for (const s of busy) {
          out.awaitingSiblings.push(
            `${token} (${s.name}: ${s.binding!.activeFrIds.length} active FRs)`,
          );
        }
        continue;
      }
      for (const s of siblings) {
        if (s.root === null) {
          out.unlocatableSiblings.push(`${token} (${s.name} at ${s.declaredPath})`);
        }
      }
      out.shipReady.push(token);
    }
  }

  out.shipReady.sort(compareMilestoneTokens);
  out.parked.sort(compareMilestoneTokens);
  out.awaitingSiblings.sort(byLeadingToken);
  out.unlocatableSiblings.sort(byLeadingToken);
  return out;
}

/**
 * Shared predicate: bare milestone tokens of every active plan that is
 * ship-ready (zero active FRs, ≥ 1 archived FR, not parked, not stamped, and
 * no declared `spans_repos:` sibling still holding active FRs), sorted via
 * compareMilestoneTokens.
 *
 * Call sites: `/gate-check` probe #75 (via runActivePlanShipReadyProbe) and
 * the `/implement` FR-form close offer — ONE predicate, two consumers.
 */
export async function shipReadyMilestones(projectRoot: string): Promise<string[]> {
  return (await classifyActivePlans(projectRoot)).shipReady;
}

/** FR ids bound to one milestone, split by archive status. */
export interface MilestoneFrBinding {
  /** Ids of FRs under `specs/frs/` carrying this milestone token. */
  activeFrIds: string[];
  /** Ids of FRs under `specs/frs/archive/` carrying this milestone token. */
  archivedFrIds: string[];
}

/**
 * ADDITIVE (STE-498): the milestone-scoped view of the SAME active/archived FR
 * binding this module's ship-ready predicate is derived from.
 *
 * `shipReadyMilestones` answers a yes/no; a consumer that also needs to tell
 * "nothing built yet" from "some FRs already landed and archived" would
 * otherwise walk the FR directories itself and become a second source of truth
 * for the binding. It calls this instead. Pure reads; the probe and the
 * ship-ready predicate are untouched.
 */
export async function milestoneFrBinding(
  projectRoot: string,
  milestone: string,
): Promise<MilestoneFrBinding> {
  const frsDir = join(projectRoot, "specs", "frs");
  return {
    activeFrIds: idsBoundTo(await readFrDir(frsDir), milestone),
    archivedFrIds: idsBoundTo(await readFrDir(join(frsDir, "archive")), milestone),
  };
}

/**
 * Warning-only probe report: `violations` is always empty; ship-ready hits
 * render a single comma-separated NOTES row plus the parked-milestones row.
 * Pure function — no side effects, no writes.
 *
 * Call site: `/gate-check` probe #75 + the STE-462 integration test at
 * `tests/gate-check-active-plan-ship-ready.test.ts`.
 */
export async function runActivePlanShipReadyProbe(
  projectRoot: string,
): Promise<ActivePlanShipReadyReport> {
  const { shipReady, parked, awaitingSiblings, unlocatableSiblings } =
    await classifyActivePlans(projectRoot);
  const notes: string[] = [];
  if (shipReady.length > 0) {
    notes.push(`ship-ready milestones: ${shipReady.join(", ")}${NOTE_SUFFIX}`);
  }
  if (parked.length > 0) {
    notes.push(`parked milestones: ${parked.join(", ")}`);
  }
  if (awaitingSiblings.length > 0) {
    notes.push(`awaiting-sibling milestones: ${awaitingSiblings.join(", ")}`);
  }
  if (unlocatableSiblings.length > 0) {
    notes.push(`sibling-unlocatable milestones: ${unlocatableSiblings.join(", ")}`);
  }
  return { violations: [], notes };
}

// Read-only CLI mirroring `upgrade_staleness.ts`: `/implement`'s ship-ready
// close offer runs the shared predicate through this entrypoint instead of
// re-deriving the classification in prose. Imported by tests,
// `import.meta.main` is false and this block never runs — keeping the module
// free of side effects at import. Prints one ship-ready milestone per line;
// empty stdout means none.
if (import.meta.main) {
  const projectRoot = process.argv[2] ?? process.cwd();
  try {
    const shipReady = await shipReadyMilestones(projectRoot);
    if (shipReady.length > 0) console.log(shipReady.join("\n"));
  } catch (e) {
    // A malformed `spans_repos:` on an otherwise ship-ready plan is a refusal,
    // not a crash: its NFR-10 message goes to stderr and stdout stays EMPTY,
    // so the /implement close offer's "empty stdout = none" reading holds.
    if (!(e instanceof SpansReposError)) throw e;
    console.error(e.message);
    process.exitCode = 1;
  }
}
