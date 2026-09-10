// plan_ship_coherence — /gate-check probe (STE-369).
//
// Invariant (AC-STE-369.1): every `specs/plan/archive/M<N>.md` carrying a
// `shipped_in: v<X.Y.Z>` frontmatter stamp must resolve to a `## [X.Y.Z]`
// heading in CHANGELOG.md. A missing heading or a malformed stamp value is
// an ERROR-severity violation (corrupt stamp) in the NFR-10 canonical shape
// naming the plan, the stamp value, and the remedy.
//
// Scope guard: the LOCAL walk is archive-only — live plans under `specs/plan/`
// are exempt by construction. The one reader outside that scope is the STE-588
// sibling leg: for a stamped plan that spans repositories it reads each
// sibling's plan at BOTH its live and its archive path, outside `projectRoot`,
// because a sibling that has not archived yet still holds its plan live.
//
// Violation shape mirrors probe #16 (`archive_plan_status.ts`): `note` is
// `<repo-relative-file>:<line> — <reason>`, `message` is the multi-line
// canonical shape with `Remedy:` and `Context:` sub-lines.

import { readdir, readFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";
// Union grammar: `M<N>` and `M_<epic-key>` archived plans are both walked.
import { PLAN_FILENAME_RE, compareMilestoneTokens } from "./milestone_token";
import { normalizeFrontmatterSource } from "./frontmatter";
// STE-546: probe #63 also grades the two RELEASE SURFACES against each other.
// Registered here by EXTENSION rather than as a new probe id — a new number
// drags sixty pinned sites across fifteen files, and the subject is the same
// one this probe already owns: what a plan's `shipped_in:` stamp claims shipped.
import { runReleaseSurfaceAgreement } from "./release_surface_agreement";
// STE-588: a shipped plan that spans repositories is graded against its
// sibling half too. Siblings are located through the shared spanning reader
// and the sibling's plan is read through `./sibling_release` — this module
// never parses the declaration itself.
import { SpansReposError, resolveSpansRepos, type SiblingState } from "./spans_repos";
import {
  malformedDeclarationReason,
  readSiblingPlan,
  refusalLine,
  siblingPlanPaths,
} from "./sibling_release";
import { sameRepo } from "./target_repo";

const PROBE = "plan_ship_coherence";

/**
 * Canonical post-merge ship ceremony recipe. Shared verbatim with
 * docs/ship-milestone-reference.md (STE-370) — edit here, mirror there.
 */
export const SHIP_CEREMONY_RECIPE = [
  "1. /spec-archive M<N> — only when FRs are still active (skip if already archived)",
  "2. /ship-milestone M<N> — bump the release files, regenerate docs, release commit",
  "3. /pr — push the branch and open the pull request",
].join("\n");

/**
 * The closed set of conditions this probe reports (STE-574).
 *
 * `unshipped_debt` is legitimate transient state between /implement's archival
 * commit and /ship-milestone's release commit; the others are not. A
 * consumer that needs to tell them apart reads this field instead of matching
 * on `reason` prose, which is pinned bytes and not a classification.
 *
 * `sibling_unshipped` (STE-588) is a shipped spanning plan whose sibling half
 * cannot be graded as agreeing with it.
 */
export type PlanShipCoherenceViolationKind =
  | "unshipped_debt"
  | "corrupt_stamp"
  | "surface_disagreement"
  | "sibling_unshipped";

export interface PlanShipCoherenceViolation {
  kind: PlanShipCoherenceViolationKind;
  file: string;
  line: number;
  reason: string;
  note: string; // `file:line — reason` per STE-82
  message: string; // NFR-10 canonical multi-line shape
}

export interface PlanShipCoherenceReport {
  violations: PlanShipCoherenceViolation[];
  notes: string[];
}

const STAMP_RE = /^v(\d+\.\d+\.\d+)$/;

interface FieldHit {
  present: boolean;
  value: string;
  line: number; // 1-based line number in the file
}

/** Scan the frontmatter block for a scalar key, keeping its line number. */
function scanFrontmatterField(content: string, key: string): FieldHit {
  const out: FieldHit = { present: false, value: "", line: 0 };
  // Fold BOM + CRLF/lone-CR first, or a Windows-authored file reads as
  // having no frontmatter and this check silently passes on an unparsed file.
  content = normalizeFrontmatterSource(content);
  if (!content.startsWith("---\n")) return out;
  const closeIdx = content.indexOf("\n---", 4);
  if (closeIdx < 0) return out;
  const fmLines = content.slice(4, closeIdx).split("\n");
  for (let i = 0; i < fmLines.length; i++) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(fmLines[i]!);
    if (!m || m[1] !== key) continue;
    // +2: one for the leading `---\n`, one for 1-based line numbering.
    out.present = true;
    out.value = (m[2] ?? "").trim();
    out.line = i + 2;
  }
  return out;
}

/** Build the full violation record: `note` per STE-82, `message` per NFR-10. */
function makeViolation(
  kind: PlanShipCoherenceViolationKind,
  file: string,
  rel: string,
  line: number,
  reason: string,
  remedy: string,
  stamp: string,
): PlanShipCoherenceViolation {
  return {
    kind,
    file,
    line,
    reason,
    note: `${rel}:${line} — ${reason}`,
    message: [
      `${PROBE}: ${reason}`,
      `Remedy: ${remedy}`,
      `Context: file=${rel}, shipped_in=${stamp}, probe=${PROBE}`,
    ].join("\n"),
  };
}

async function listArchivePlans(projectRoot: string): Promise<string[]> {
  const dir = join(projectRoot, "specs", "plan", "archive");
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && PLAN_FILENAME_RE.test(e.name))
      .map((e) => join(dir, e.name))
      .sort();
  } catch {
    return [];
  }
}

/** Collect the set of `## [X.Y.Z]` heading versions in CHANGELOG.md. */
async function readChangelogVersions(projectRoot: string): Promise<Set<string>> {
  const versions = new Set<string>();
  let content: string;
  try {
    content = await readFile(join(projectRoot, "CHANGELOG.md"), "utf-8");
  } catch {
    return versions;
  }
  for (const line of content.split("\n")) {
    const m = /^##\s*\[(\d+\.\d+\.\d+)\]/.exec(line);
    if (m) versions.add(m[1]!);
  }
  return versions;
}

/** One shipped archived plan, as the sibling leg grades it. */
interface ShippedPlan {
  readonly file: string;
  readonly rel: string;
  readonly milestone: string;
  readonly content: string;
  readonly stampLine: number;
  readonly stamp: string;
}

/** One plan's sibling leg: its violation rows and its pending-note entries. */
interface SiblingLegResult {
  readonly violations: PlanShipCoherenceViolation[];
  readonly pending: string[];
}

/**
 * STE-588 — grade one shipped plan against its sibling halves. Vacuous unless
 * the plan spans repositories. Every row names the LOCAL plan, so the resume
 * classifier selects it.
 */
async function gradeSiblingLeg(projectRoot: string, plan: ShippedPlan): Promise<SiblingLegResult> {
  const { milestone, rel } = plan;
  const violations: PlanShipCoherenceViolation[] = [];
  const pending: string[] = [];
  // Every sibling row shares the local plan's file, stamp line and stamp.
  const violation = (reason: string, remedy: string): void => {
    violations.push(
      makeViolation("sibling_unshipped", plan.file, rel, plan.stampLine, reason, remedy, plan.stamp),
    );
  };
  const pend = (sibling: string, state: "unlocatable" | "no plan" | "unshipped"): void => {
    pending.push(`${milestone} → ${sibling} (${state})`);
  };
  const orDrop = (sibling: string): string =>
    `or drop ${sibling} from the repositories ${rel} declares if the milestone does not span it.`;

  let siblings: SiblingState[];
  try {
    siblings = await resolveSpansRepos({
      planBody: plan.content,
      milestone,
      invokingRepo: projectRoot,
    });
  } catch (e) {
    if (!(e instanceof SpansReposError)) throw e;
    // Per-plan containment: a refusing declaration is this plan's row, never a throw.
    // The parser's refusal is carried by its BODIES — its first line already rides
    // the reason — so this row keeps one Remedy: line and one Context: line.
    violation(
      malformedDeclarationReason(milestone, e.message),
      `rewrite the repository declaration in ${rel}: ${refusalLine(e.message, "Remedy")}`,
    );
    return { violations, pending };
  }
  const shipPartial = scanFrontmatterField(plan.content, "ship_partial").value === "true";
  for (const sibling of siblings) {
    if (sibling.self) continue;
    if (sibling.root === null) {
      // Unlocatable on this machine: a note, never a violation, and never silent.
      pend(sibling.name, "unlocatable");
      continue;
    }
    const siblingPlan = await readSiblingPlan(sibling.root, milestone);
    if (siblingPlan === null) {
      if (shipPartial) {
        // `ship_partial: true` downgrades ONLY the no-plan trigger, to a note.
        pend(sibling.name, "no plan");
        continue;
      }
      const [archived, live] = siblingPlanPaths(sibling.root, milestone);
      violation(
        `sibling ${sibling.name} holds no plan for ${milestone} at ${live} or ${archived} (no plan)`,
        `write the ${milestone} plan in sibling ${sibling.name}, ${orDrop(sibling.name)}`,
      );
      continue;
    }
    // Disagreement: the sibling's own declaration must locate this repository.
    let namesBack: boolean;
    // A sibling whose OWN declaration refuses cannot name anything back; its
    // refusal is kept so the remedy points at that declaration, not at a
    // missing entry.
    let refusal: string | null = null;
    try {
      const back = await resolveSpansRepos({
        planBody: siblingPlan.body,
        milestone,
        invokingRepo: sibling.root,
      });
      namesBack = back.some((s) => s.root !== null && sameRepo(s.root, projectRoot));
    } catch (e) {
      if (!(e instanceof SpansReposError)) throw e;
      namesBack = false;
      refusal = e.message;
    }
    if (!namesBack) {
      const disagreement = `sibling ${sibling.name}'s ${milestone} plan at ${siblingPlan.file} does not name this repo back`;
      if (refusal === null) {
        violation(
          disagreement,
          `declare this repository in the repositories ${siblingPlan.file} spans, ${orDrop(sibling.name)}`,
        );
      } else {
        violation(
          `${disagreement}: its own repository declaration refuses to parse`,
          `repair the repository declaration in ${siblingPlan.file} — ${refusalLine(refusal, "Refusing")} ${refusalLine(refusal, "Remedy")}`,
        );
      }
      continue;
    }
    // An agreeing sibling with no well-formed stamp is pending, never a violation.
    const siblingStamp = siblingPlan.frontmatter["shipped_in"];
    if (typeof siblingStamp !== "string" || !STAMP_RE.test(siblingStamp.trim())) {
      pend(sibling.name, "unshipped");
    }
  }
  return { violations, pending };
}

/**
 * Scan every `specs/plan/archive/M*.md` under `projectRoot` and check each
 * `shipped_in` stamp against the CHANGELOG.md release headings; a stamped
 * plan that spans repositories also has its sibling halves graded (STE-588),
 * reading each sibling's plan at its live and its archive path. Pure
 * function — no side effects, no writes.
 *
 * Call site: `/gate-check` conformance probes + the STE-369 integration
 * test at `tests/gate-check-plan-ship-coherence.test.ts` and the STE-588
 * sibling suite at `tests/m_79b1f6-ste-588-sibling-coherence.test.ts`.
 */
export async function runPlanShipCoherenceProbe(
  projectRoot: string,
): Promise<PlanShipCoherenceReport> {
  const files = await listArchivePlans(projectRoot);
  const changelogVersions = await readChangelogVersions(projectRoot);
  const violations: PlanShipCoherenceViolation[] = [];
  const notes: string[] = [];
  const parked: string[] = [];
  const pendingSiblings: string[] = [];

  for (const file of files) {
    let content: string;
    try {
      content = await readFile(file, "utf-8");
    } catch {
      continue;
    }
    const rel = relative(projectRoot, file);
    const shippedIn = scanFrontmatterField(content, "shipped_in");
    // `shipped_in: null` is the plan template's pre-ship sentinel (present
    // from plan creation, replaced by stampShippedIn at ship time). Treat it
    // — and an empty value — as unstamped so a mid-ceremony archived plan
    // classifies as unshipped debt, never as a corrupt stamp.
    if (!shippedIn.present || shippedIn.value === "null" || shippedIn.value === "") {
      const shipState = scanFrontmatterField(content, "ship_state");
      if (shipState.present && shipState.value === "parked") {
        // AC-STE-369.3 — parked plans pass, surfaced via a NOTES row so
        // parking never becomes a silent get-to-green stamp.
        // listArchivePlans filtered on PLAN_FILENAME_RE, so basename is the milestone.
        parked.push(basename(file, ".md"));
        continue;
      }
      // AC-STE-369.2 — neither stamped nor parked: unshipped debt.
      violations.push(
        makeViolation(
          "unshipped_debt",
          file,
          rel,
          1,
          `archived plan ${rel} has neither a shipped_in stamp nor ship_state: parked (unshipped debt)`,
          `run the post-merge ship ceremony:\n${SHIP_CEREMONY_RECIPE}`,
          "<absent>",
        ),
      );
      continue;
    }

    const stampLine = shippedIn.line || 1;
    const stampMatch = STAMP_RE.exec(shippedIn.value);
    if (!stampMatch) {
      violations.push(
        makeViolation(
          "corrupt_stamp",
          file,
          rel,
          stampLine,
          `malformed shipped_in stamp in ${rel}: expected v<X.Y.Z>, observed: ${shippedIn.value} (corrupt stamp)`,
          `rewrite the shipped_in stamp in ${rel} as v<X.Y.Z> matching the ` +
            `\`## [X.Y.Z]\` CHANGELOG.md heading of the release that shipped this milestone.`,
          shippedIn.value,
        ),
      );
      continue;
    }

    const version = stampMatch[1]!;
    if (!changelogVersions.has(version)) {
      violations.push(
        makeViolation(
          "corrupt_stamp",
          file,
          rel,
          stampLine,
          `shipped_in stamp ${shippedIn.value} in ${rel} has no matching ## [${version}] heading in CHANGELOG.md (corrupt stamp)`,
          `fix the shipped_in stamp in ${rel} to the version of the CHANGELOG.md ` +
            `release heading that actually shipped this milestone, or ship the release so the \`## [${version}]\` heading exists.`,
          shippedIn.value,
        ),
      );
      continue;
    }

    // STE-588 — the sibling leg, graded per plan so one plan's rows stay together.
    const leg = await gradeSiblingLeg(projectRoot, {
      file,
      rel,
      milestone: basename(file, ".md"),
      content,
      stampLine,
      stamp: shippedIn.value,
    });
    violations.push(...leg.violations);
    pendingSiblings.push(...leg.pending);
  }

  // STE-546 — the release-surface agreement rows, in this probe's own shape.
  // Vacuous (zero rows) unless the README carries the banner marker, the
  // CHANGELOG has a parseable release heading, and some plan carries a real
  // shipped stamp; see `checkReleaseSurfaceAgreement`.
  for (const row of await runReleaseSurfaceAgreement(projectRoot)) {
    const reason = `release surfaces disagree on ${row.field}: ${row.detail}`;
    violations.push({
      kind: "surface_disagreement",
      file: join(projectRoot, "README.md"),
      line: 1,
      reason,
      note: `README.md:1 — ${reason}`,
      message: [
        `${PROBE}: ${reason}`,
        `Remedy: rewrite README.md's \`Latest:\` line so its version, codename and milestone ` +
          `match the CHANGELOG entry of the released version and the plan whose \`shipped_in:\` ` +
          `stamp names it. The \`kind: regex\` release-file entry rewrites the version ONLY, so ` +
          `the codename and the milestone are hand-written.`,
        `Context: file=README.md, field=${row.field}, expected=${row.expected ?? "<none>"}, ` +
          `found=${row.found ?? "<none>"}, probe=${PROBE}`,
      ].join("\n"),
    });
  }

  if (parked.length > 0) {
    // Single GATE PASSED WITH NOTES row enumerating every parked milestone.
    // Numeric ids sort numerically and precede epic-keyed ids (lexical).
    parked.sort(compareMilestoneTokens);
    notes.push(`parked milestones: ${parked.join(", ")}`);
  }
  if (pendingSiblings.length > 0) {
    // STE-588 — one aggregated row for every pending sibling, never silent.
    notes.push(`siblings awaiting release: ${pendingSiblings.join(", ")}`);
  }

  return { violations, notes };
}
