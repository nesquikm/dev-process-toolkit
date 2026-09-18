// STE-284 AC-STE-284.4 — `tracker_local_reconciliation_drift` probe.
//
// Wraps `reconcileTrackerLocal` (AC-STE-284.2) for the /gate-check side. The
// helper returns three disjoint orphan lists (tracker-orphans, local-orphans,
// milestone-mismatches); this probe maps them to violation rows with a
// severity tier and adds a local-side scan for the hard FR-id collision shape
// the helper cannot see by construction (two local files both bind the same
// tracker ID — both files have a binding, so neither is an orphan).
//
// Severity tiers:
//   - info  — no drift (all three orphan lists empty + no local collisions)
//   - warning — any drift that is recoverable by re-syncing or renaming:
//       tracker-orphan (tracker has FR id with no local file), unbound local
//       FR (no `tracker:` block), milestone-mismatch.
//   - error — hard FR-id collisions:
//       (a) same tracker ID bound by two or more local files, OR
//       (b) local FR's `tracker:` value points at an FR id absent from the
//           tracker's active set.
//
// The probe is mode-aware via the underlying helper: `LocalProvider`
// (`mode: 'none'`) returns three empty lists, so the probe surfaces severity
// info with zero violations on every local-only project.
//
// Scaffolding carve-out: a LOCAL-side milestone mismatch whose plan declares
// `kind: scaffolding` is dropped here rather than in the shared helper. The
// helper's report stays faithful (its other consumer is /spec-write's preamble
// reconcile, which wants the full picture); only the gate-check render
// suppresses the row, because the bootstrap plan has no tracker milestone by
// design and every freshly bootstrapped project would otherwise open life with
// a meaningless warning. The filter keys on the structural `side`
// discriminator, never on the `details` prose.

import { join } from "node:path";
import {
  adapterOf,
  type ContainerTicket,
  classifyTicket,
  foreignLabels,
  listOrphans,
  normalizeContainerPage,
  readPages,
} from "./container_ownership";
import { evaluatePlanOnlyEligibility } from "./plan_only_archival";
import type { Provider } from "./provider";
import {
  type ClassifiedTrackerTicket,
  readLocalFRBindings,
  reconcileTrackerLocal,
} from "./reconcile_tracker_local";
import { readWorkspaceBinding, type WorkspaceBinding } from "./workspace_binding";

export type DriftSeverity = "info" | "warning" | "error";

export interface DriftViolation {
  kind:
    | "tracker-orphan"
    | "local-orphan"
    | "milestone-mismatch"
    | "duplicate-local-binding"
    | "unowned-container-ticket"
    | "bound-ticket-untagged"
    | "numeric-milestone-shared"
    | "container-partial";
  severity: "warning" | "error";
  note: string;
}

/** STE-605 — non-violation rows, reported only when container pages were supplied. */
export interface DriftInfo {
  kind: "container-not-read" | "container-empty" | "container-excluded";
  note: string;
}

export interface TrackerLocalReconciliationDriftResult {
  severity: DriftSeverity;
  violations: DriftViolation[];
  /** STE-605 — present only when `deps.containerPages` was given. */
  info?: DriftInfo[];
}

export interface RunProbeDeps {
  provider: Provider;
  /**
   * STE-605 — parsed container pages (Jira `searchJiraIssuesUsingJql` /
   * Linear `list_issues` JSON). When given, the tickets on them — classified
   * by `container_ownership.ts` — replace `provider.listActiveFRs()`. An
   * empty array is "no page supplied": a `container-not-read` skip row.
   */
  containerPages?: unknown[];
  /** STE-605 — the front door reads no milestone listing, so it grades no milestone drift. */
  skipMilestoneDrift?: boolean;
}

interface ContainerView {
  tickets: ClassifiedTrackerTicket[];
  violations: DriftViolation[];
  info: DriftInfo[];
}

/**
 * STE-605 § 3 — read the container pages through the one classifier and
 * derive the shared-only rows, the excluded-count info row and the page-set
 * outcome rows. Read-only.
 */
function readContainerView(projectRoot: string, pages: unknown[]): ContainerView {
  const adapter = adapterOf(projectRoot);
  const binding = readWorkspaceBinding(join(projectRoot, "CLAUDE.md"), adapter);
  // Strict when shared, at the point the tickets are built — never relying on
  // `listOrphans` below happening to refuse the same malformed page first.
  const all = pages.flatMap((p) => normalizeContainerPage(p, adapter, binding.shared));
  const listing = listOrphans(projectRoot, pages);
  const bound = new Set(readLocalFRBindings(join(projectRoot, "specs")).flatMap((b) => b.trackerIds));

  const tickets: ClassifiedTrackerTicket[] = all.map((t) => ({
    key: t.key,
    ownerClass: classifyTicket(t, binding),
    owner: t.creator ?? "unknown",
  }));

  const violations: DriftViolation[] = [];
  const info: DriftInfo[] = [];
  if (binding.shared && binding.repoTag !== undefined) {
    for (const t of listing.orphans) {
      if (t.cls !== "unowned") continue;
      violations.push({
        kind: "unowned-container-ticket",
        severity: "warning",
        note: `${t.key} "${t.title}" (creator ${t.owner}) carries no repository tag; any repository sharing this container may claim it.`,
      });
    }
    for (const t of all) {
      if (t.isContainer || !bound.has(t.key) || t.labels.includes(binding.repoTag)) continue;
      violations.push({
        kind: "bound-ticket-untagged",
        severity: "warning",
        note: `${t.key} is bound by a local FR here but lacks this repository's tag ${binding.repoTag}; add the label ${binding.repoTag} so sibling repositories exclude it.`,
      });
    }
    violations.push(...numericMilestoneShared(all, binding, bound));
  }
  const c = listing.counts;
  info.push({
    kind: "container-excluded",
    note: `read ${c.read} ticket(s): ${c.sibling} sibling excluded, ${c.containers} container(s) excluded.`,
  });
  if (!listing.complete) {
    violations.push({
      kind: "container-partial",
      severity: "warning",
      note: "The container page set is incomplete (a page is not the last); orphan rows may be missing.",
    });
  } else if (c.read === 0) {
    info.push({ kind: "container-empty", note: "The container page is empty and complete; no tracker tickets to reconcile." });
  }
  return { tickets, violations, info };
}

const NUMERIC_MILESTONE_RE = /^milestone-M\d+$/;

/**
 * STE-605 § 3 (LJ-1) — a numeric `milestone-M<N>` label carried by tickets of
 * more than one repository. A ticket's repository is this one when it is
 * `ours` or bound here, a sibling's tags otherwise; `unowned` and containers
 * are attributed to no repository. Tracker-keyed `milestone-M_<key>` labels
 * never match. A visible warning only — numeric labels are never rewritten.
 */
function numericMilestoneShared(
  tickets: ContainerTicket[],
  binding: WorkspaceBinding,
  bound: ReadonlySet<string>,
): DriftViolation[] {
  // A sibling repository has no registry, only its labels. Sibling tickets
  // sharing ANY foreign label are one repository (a union over labels), so a
  // sibling that also carries a generic label like `bug` is still one side.
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    // Path compression: later lookups for this chain are one hop.
    while (parent.get(x) !== root) {
      const next = parent.get(x)!;
      parent.set(x, root);
      x = next;
    }
    return root;
  };
  const siblingLabels = new Map<string, string[]>();
  for (const t of tickets) {
    if (classifyTicket(t, binding) !== "sibling" || bound.has(t.key)) continue;
    const labels = foreignLabels(t, binding);
    siblingLabels.set(t.key, labels);
    for (const l of labels) if (!parent.has(l)) parent.set(l, l);
    for (const l of labels.slice(1)) parent.set(find(l), find(labels[0]!));
  }
  // Each group's name is its sorted member labels, computed once per root.
  const members = new Map<string, string[]>();
  for (const l of parent.keys()) members.set(find(l), [...(members.get(find(l)) ?? []), l]);
  const groupName = (root: string): string => members.get(root)!.slice().sort().join("+");
  const byLabel = new Map<string, Map<string, string[]>>();
  for (const t of tickets) {
    const cls = classifyTicket(t, binding);
    let repo: string;
    if (cls === "ours" || (cls !== "container" && bound.has(t.key))) repo = "this repository";
    else if (cls === "sibling") {
      repo = groupName(find(siblingLabels.get(t.key)![0]!));
    } else continue;
    for (const label of t.labels) {
      if (!NUMERIC_MILESTONE_RE.test(label)) continue;
      const repos = byLabel.get(label) ?? new Map<string, string[]>();
      repos.set(repo, [...(repos.get(repo) ?? []), t.key]);
      byLabel.set(label, repos);
    }
  }
  const out: DriftViolation[] = [];
  for (const [label, repos] of [...byLabel.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (repos.size < 2) continue;
    const sides = [...repos.entries()].map(([repo, keys]) => `${repo}: ${keys.join(", ")}`).join("; ");
    out.push({
      kind: "numeric-milestone-shared",
      severity: "warning",
      note: `${label} is carried by tickets of more than one repository (${sides}); the bucket mixes repositories. Numeric labels are never renamed, migrated or removed.`,
    });
  }
  return out;
}

// Splits the two local-orphan sub-kinds apart: "no `tracker:` block at all"
// (warning) vs "binds to IDs the tracker does not carry" (error). This one IS
// still a `details` prose match, and deliberately so — BOTH sub-kinds are
// `side: "local"`, so the structural discriminator cannot separate them and
// widening the `side` filter to cover this branch would silently collapse the
// error tier into the warning tier. Separating them structurally needs a new
// field on `ReconcileItem`, which no AC covers; until then the byte-stability
// of the two `details` templates is pinned by
// `tests/m117-ste-430-retry-and-gate-noise.test.ts` and by
// `adapters/_shared/src/__tests__/reconcile_tracker_local.test.ts`.
const LOCAL_ORPHAN_DANGLING_RE = /binds to tracker IDs/;

/**
 * /gate-check probe wrapper for `reconcileTrackerLocal`. Returns a severity
 * tier and a flat violation list ready for the gate-check reporter.
 *
 * Severity escalates to `error` only when a hard FR-id collision is detected
 * (local-orphan-dangling OR duplicate local binding). All other drift forms
 * (tracker-orphan, milestone-mismatch, unbound local FR) surface as
 * `warning`. A clean reconcile reports `info` with zero violations.
 *
 * Pure read-side: never writes, never throws on missing directories
 * (a brand-new specs/ tree reconciles as fully empty).
 */
export async function runTrackerLocalReconciliationDriftProbe(
  projectRoot: string,
  deps: RunProbeDeps,
): Promise<TrackerLocalReconciliationDriftResult> {
  const specsDir = join(projectRoot, "specs");
  const pages = deps.containerPages;
  const violations: DriftViolation[] = [];
  let hasError = false;
  let info: DriftInfo[] | undefined;

  if (pages !== undefined && pages.length === 0) {
    info = [{ kind: "container-not-read", note: "No container page was supplied; tracker orphans were not read (skipped)." }];
    return { severity: "info", violations, info };
  }

  let view: ContainerView | undefined;
  if (pages !== undefined) {
    view = readContainerView(projectRoot, pages);
    info = view.info;
  }
  const report = await reconcileTrackerLocal(
    deps.provider,
    specsDir,
    view === undefined ? {} : { tickets: view.tickets },
  );

  for (const item of report.trackerOrphans) {
    violations.push({
      kind: "tracker-orphan",
      severity: "warning",
      note: item.details,
    });
  }

  for (const item of report.localOrphans) {
    const isDangling = LOCAL_ORPHAN_DANGLING_RE.test(item.details);
    if (isDangling) {
      hasError = true;
      violations.push({ kind: "local-orphan", severity: "error", note: item.details });
    } else {
      violations.push({ kind: "local-orphan", severity: "warning", note: item.details });
    }
  }

  for (const item of deps.skipMilestoneDrift ? [] : report.milestoneMismatches) {
    if (item.side === "local" && (await isScaffoldingPlan(specsDir, item.id))) continue;
    violations.push({
      kind: "milestone-mismatch",
      severity: "warning",
      note: item.details,
    });
  }

  // Detect duplicate local bindings — same tracker ID bound by two or more
  // local files. The reconcile helper cannot see this by construction (both
  // files have a binding, so neither is a local-orphan).
  const dupes = findDuplicateLocalBindings(specsDir);
  for (const dup of dupes) {
    hasError = true;
    violations.push({
      kind: "duplicate-local-binding",
      severity: "error",
      note: `Tracker ID ${dup.id} is bound by ${dup.files.length} local files: ${dup.files.join(", ")}.`,
    });
  }

  if (view !== undefined) violations.push(...view.violations);

  let severity: DriftSeverity;
  if (hasError) severity = "error";
  else if (violations.length > 0) severity = "warning";
  else severity = "info";

  return info === undefined ? { severity, violations } : { severity, violations, info };
}

/**
 * True when `<specsDir>/plan/<milestone>.md` declares the scaffolding kind in
 * its frontmatter — the bootstrap plan `/setup` writes, which has no tracker
 * milestone BY DESIGN and must not be reported as local-side milestone drift.
 *
 * Routed through `evaluatePlanOnlyEligibility`, which already owns this exact
 * frontmatter read and whose `parseFrontmatter(..., { lenient: true })` call
 * normalizes BOM + CRLF before matching. A hand-rolled `kind:` line scanner
 * here would re-create the CRLF/BOM blindness that was swept out of this
 * repo's frontmatter readers once already, and it would fail OPEN — an
 * unparsed scaffolding plan would resume emitting the spurious warning.
 *
 * Deliberately narrow: only `reason === "scaffolding"` suppresses. The
 * sibling `"all-checked"` eligibility reason is about archival readiness, not
 * about whether a tracker milestone is expected to exist, so a fully-checked
 * feature plan still reports drift.
 */
async function isScaffoldingPlan(specsDir: string, milestone: string): Promise<boolean> {
  const verdict = await evaluatePlanOnlyEligibility(specsDir, milestone);
  return verdict.planExists && verdict.reason === "scaffolding";
}

interface DuplicateBinding {
  id: string;
  files: string[];
}

/**
 * Group `readLocalFRBindings(specsDir)` by tracker ID and surface every ID
 * bound by ≥ 2 distinct local files. Pure grouping over the shared FS-walk
 * helper — no FS / frontmatter parsing here (canonical SoT is
 * `reconcile_tracker_local.ts`).
 */
function findDuplicateLocalBindings(specsDir: string): DuplicateBinding[] {
  const byId = new Map<string, string[]>();
  for (const fr of readLocalFRBindings(specsDir)) {
    for (const trackerId of fr.trackerIds) {
      const list = byId.get(trackerId) ?? [];
      list.push(fr.filename);
      byId.set(trackerId, list);
    }
  }
  const out: DuplicateBinding[] = [];
  for (const [id, files] of byId.entries()) {
    if (files.length > 1) out.push({ id, files: files.sort() });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

// STE-605 — front door: `bun run tracker_local_reconciliation_drift.ts <projectRoot> <page.json>...`.
// Reads the saved pages (read-only) and prints one line per row, each naming
// its kind token and every key it is about. The tracker's FR set comes from
// the pages; no milestone listing is read, so no milestone drift is graded.
if (import.meta.main) {
  const [projectRoot, ...pagePaths] = process.argv.slice(2);
  if (projectRoot === undefined) {
    console.error("usage: tracker_local_reconciliation_drift.ts <projectRoot> <page.json>...");
    process.exit(2);
  }
  try {
    const containerPages = readPages(pagePaths);
    const provider = {
      mode: "tracker",
      listActiveFRs: async () => [],
      listMilestones: async () => [],
    } as unknown as Provider;
    const result = await runTrackerLocalReconciliationDriftProbe(projectRoot, {
      provider,
      containerPages,
      skipMilestoneDrift: true,
    });
    for (const v of result.violations) console.log(`${v.severity} ${v.kind}: ${v.note}`);
    for (const i of result.info ?? []) console.log(`info ${i.kind}: ${i.note}`);
    console.log(`severity: ${result.severity}`);
    process.exit(0);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}
