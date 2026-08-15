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

import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
// Union grammar: `M<N>` and `M_<epic-key>` active plans are both walked.
import { PLAN_FILENAME_RE, compareMilestoneTokens } from "./milestone_token";
import { normalizeFrontmatterSource } from "./frontmatter";

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

/** Collect the multiset of `milestone:` frontmatter tokens across FR files. */
async function readFrMilestones(files: string[]): Promise<Set<string>> {
  const tokens = new Set<string>();
  for (const file of files) {
    let content: string;
    try {
      content = await readFile(file, "utf-8");
    } catch {
      continue;
    }
    const milestone = scanFrontmatterField(content, "milestone");
    if (milestone) tokens.add(milestone);
  }
  return tokens;
}

interface Classification {
  shipReady: string[]; // sorted via compareMilestoneTokens
  parked: string[]; // sorted via compareMilestoneTokens
}

/** Walk active plans and classify each one; shared core of both exports. */
async function classifyActivePlans(projectRoot: string): Promise<Classification> {
  const planDir = join(projectRoot, "specs", "plan");
  const planFiles = (await listMarkdownFiles(planDir)).filter((f) =>
    PLAN_FILENAME_RE.test(basename(f)),
  );
  const out: Classification = { shipReady: [], parked: [] };
  if (planFiles.length === 0) return out;

  const frsDir = join(projectRoot, "specs", "frs");
  const activeFrTokens = await readFrMilestones(await listMarkdownFiles(frsDir));
  const archivedFrTokens = await readFrMilestones(
    await listMarkdownFiles(join(frsDir, "archive")),
  );

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
      out.shipReady.push(token);
    }
  }

  out.shipReady.sort(compareMilestoneTokens);
  out.parked.sort(compareMilestoneTokens);
  return out;
}

/**
 * Shared predicate: bare milestone tokens of every active plan that is
 * ship-ready (zero active FRs, ≥ 1 archived FR, not parked, not stamped),
 * sorted via compareMilestoneTokens.
 *
 * Call sites: `/gate-check` probe #75 (via runActivePlanShipReadyProbe) and
 * the `/implement` FR-form close offer — ONE predicate, two consumers.
 */
export async function shipReadyMilestones(projectRoot: string): Promise<string[]> {
  return (await classifyActivePlans(projectRoot)).shipReady;
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
  const { shipReady, parked } = await classifyActivePlans(projectRoot);
  const notes: string[] = [];
  if (shipReady.length > 0) {
    notes.push(`ship-ready milestones: ${shipReady.join(", ")}${NOTE_SUFFIX}`);
  }
  if (parked.length > 0) {
    notes.push(`parked milestones: ${parked.join(", ")}`);
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
  const shipReady = await shipReadyMilestones(projectRoot);
  if (shipReady.length > 0) console.log(shipReady.join("\n"));
}
