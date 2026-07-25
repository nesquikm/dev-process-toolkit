// M108 STE-393 AC-STE-393.2/.3/.4/.5 — migration-coverage enforcement.
//
// Two surfaces sharing ONE frontmatter parser:
//   - `assertMigrationDeclared` — the /ship-milestone pre-flight (AC.2/.4).
//     Throw-based: refuses the release when the milestone plan's `migration:`
//     declaration is absent / unknown / version-mismatched.
//   - `runMigrationCoverageProbe` — the /gate-check probe #68 (AC.3/.4/.5).
//     Collect-based: archive-scoped hard ERROR checks, active-scoped advisory
//     warnings only, pre-epoch archived plans exempt (rendered as a NOTES
//     count). Pure file reads + a registry module load — no git, no network,
//     no LLM judgment.
//
// Shape precedent: `plan_ship_stamp.ts` (byte-preserving frontmatter reads,
// unclosed-frontmatter refusals) + probe #63 `plan_ship_coherence.ts` (archive
// scoping, NOTES rows, NFR-10 `note` = `file:line — reason`). `null`/empty are
// the plan-template sentinel (M103 lesson, 8ed7c80) and never a valid
// declaration on either surface.

import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
// Union grammar: `M<N>` and `M_<epic-key>` plan filenames are both walked.
import { PLAN_FILENAME_RE } from "../milestone_token";
import { MIGRATIONS, type MigrationEntry } from "./index";

/**
 * The release at which milestone-plan migration coverage begins to be enforced.
 * Bare semver (no `v`), matching a registry entry's `introduced_in` shape.
 * Provisional 2.49.0 (contends M101); correcting it on a release-target shift
 * is an explicit /ship-milestone-time checklist item.
 */
export const MIGRATION_COVERAGE_EPOCH = "2.49.0";

/** Drop a leading `v` so `v2.49.0` and `2.49.0` compare equal. */
const normalizeVersion = (v: string): string => v.replace(/^v/, "");

// ---------------------------------------------------------------------------
// Shared frontmatter parser — the one parser both surfaces walk.
// ---------------------------------------------------------------------------

type FrontmatterResult =
  | { kind: "ok"; section: string }
  | { kind: "no-frontmatter" }
  | { kind: "unclosed" };

/**
 * Extract the frontmatter block body. Frontmatter discipline mirrors
 * `plan_ship_stamp.ts`: the block MUST open with `---\n` and close with a
 * `---` line anchored PAST the opener so a body `---` HR can never match first.
 */
function readFrontmatterSection(content: string): FrontmatterResult {
  if (!content.startsWith("---\n")) return { kind: "no-frontmatter" };
  let closeIdx = content.indexOf("\n---\n", 4);
  if (closeIdx < 0) {
    if (content.endsWith("\n---")) {
      closeIdx = content.length - 4;
    } else {
      return { kind: "unclosed" };
    }
  }
  return { kind: "ok", section: content.slice(4, closeIdx) };
}

interface FieldHit {
  /** Trimmed scalar value, or null when the key is absent. */
  value: string | null;
  /** 1-based line number in the file (0 when absent). */
  line: number;
}

/** Read a scalar key's value + line from a frontmatter section (first hit). */
function readFrontmatterField(section: string, key: string): FieldHit {
  const re = new RegExp(`^${key}\\s*:\\s*(.*)$`);
  const lines = section.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = re.exec(lines[i]!);
    // +2: one for the leading `---\n`, one for 1-based line numbering.
    // Strip a YAML inline comment (whitespace + `#` to end of line). These
    // frontmatter scalars are unquoted (`none`, a kebab id, a version), so a
    // `#` after whitespace is a comment, never data — the plan template ships
    // `migration: none  # literal ...` and it must read as `none`, not an id.
    if (m) return { value: (m[1] ?? "").replace(/\s+#.*$/, "").trim(), line: i + 2 };
  }
  return { value: null, line: 0 };
}

type MigrationDecl =
  | { kind: "absent" }
  | { kind: "none" }
  | { kind: "id"; value: string };

/**
 * Classify a raw `migration:` value. The `null`/empty template sentinel
 * (M103 lesson) classifies as ABSENT and never reaches registry lookup.
 */
function classifyMigration(rawValue: string | null): MigrationDecl {
  if (rawValue === null || rawValue === "" || rawValue === "null") return { kind: "absent" };
  if (rawValue === "none") return { kind: "none" };
  return { kind: "id", value: rawValue };
}

// ---------------------------------------------------------------------------
// AC-STE-393.2/.4 — assertMigrationDeclared, the /ship-milestone pre-flight.
// ---------------------------------------------------------------------------

/** NFR-10 canonical refusal: `Refusing:` / `Remedy:` / `Context:`. */
function refuse(verdict: string, remedy: string, context: string): never {
  throw new Error(
    [`Refusing: ${verdict}`, `Remedy: ${remedy}`, `Context: ${context}`].join("\n"),
  );
}

/**
 * Gate a release on its milestone plan's `migration:` declaration.
 *
 * Resolves without throwing when the plan declares `migration: none`, or a
 * registry entry id whose `introduced_in` equals the version being shipped.
 * Otherwise throws an NFR-10-shaped `Error` naming the plan and the remedy.
 *
 * @param planPath absolute path to the plan file (e.g. `specs/plan/M108.md`)
 * @param registry the migration registry to resolve declared ids against
 * @param releaseVersion the version being shipped; a leading `v` is tolerated
 */
export async function assertMigrationDeclared(
  planPath: string,
  registry: readonly MigrationEntry[],
  releaseVersion: string,
): Promise<void> {
  const original = await readFile(planPath, "utf-8");

  const fm = readFrontmatterSection(original);
  if (fm.kind === "no-frontmatter") {
    refuse(
      "plan file has no YAML frontmatter block to read the `migration:` declaration from.",
      "ensure the plan starts with a `---` frontmatter block carrying `migration:`, then re-run.",
      `mode=migration-coverage, file=${planPath}, migration=<no-frontmatter>`,
    );
  }
  if (fm.kind === "unclosed") {
    refuse(
      "plan frontmatter opens with `---` but never closes.",
      "close the frontmatter block with a `---` line, then re-run.",
      `mode=migration-coverage, file=${planPath}, migration=<unclosed-frontmatter>`,
    );
  }

  const decl = classifyMigration(readFrontmatterField(fm.section, "migration").value);

  // ABSENT: key missing, or the `null`/empty template sentinel (M103 lesson) —
  // the sentinel classifies as absent and never reaches registry lookup.
  if (decl.kind === "absent") {
    refuse(
      "plan declares no `migration:` key — every milestone plan must declare migration coverage before shipping.",
      "add `migration: none` (release touches no consumer artifacts) or `migration: <registry entry id>` to the plan frontmatter, then re-run.",
      `mode=migration-coverage, file=${planPath}, migration=<absent>`,
    );
  }

  // `none` proceeds without ever consulting the registry.
  if (decl.kind === "none") return;

  // A declared id must resolve to a registry entry introduced at this release.
  const rawValue = decl.value;
  const entry = registry.find((e) => e.id === rawValue);
  if (entry === undefined) {
    refuse(
      `plan declares \`migration: ${rawValue}\`, but no registry entry with that id exists.`,
      "declare an existing registry entry id (see `adapters/_shared/src/migrations/index.ts`) or `migration: none`, then re-run.",
      `mode=migration-coverage, file=${planPath}, migration=${rawValue}`,
    );
  }

  const shipVersion = normalizeVersion(releaseVersion);
  const entryVersion = normalizeVersion(entry.introduced_in);
  if (entryVersion !== shipVersion) {
    refuse(
      `registry entry \`${rawValue}\` is introduced_in ${entryVersion}, but this release ships ${shipVersion} — the two versions must match.`,
      "declare the entry whose `introduced_in` equals the version being shipped, or `migration: none`, then re-run.",
      `mode=migration-coverage, file=${planPath}, migration=${rawValue}, introduced_in=${entryVersion}, shipping=${shipVersion}`,
    );
  }
}

// ---------------------------------------------------------------------------
// AC-STE-393.3/.4/.5 — runMigrationCoverageProbe, the /gate-check probe (#68).
// ---------------------------------------------------------------------------

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

function semverTuple(v: string): [number, number, number] | null {
  const m = SEMVER.exec(normalizeVersion(v));
  if (m === null) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** -1 | 0 | 1, or null when either side is not a bare/`v`-prefixed semver. */
function compareSemver(a: string, b: string): number | null {
  const ta = semverTuple(a);
  const tb = semverTuple(b);
  if (ta === null || tb === null) return null;
  for (let i = 0; i < 3; i++) {
    if (ta[i] !== tb[i]) return ta[i]! < tb[i]! ? -1 : 1;
  }
  return 0;
}

export interface MigrationCoverageViolation {
  file: string;
  line: number;
  note: string; // `file:line — reason` per STE-82
  message: string; // NFR-10 canonical multi-line shape
}

export interface MigrationCoverageReport {
  violations: MigrationCoverageViolation[]; // ERROR — archive-scoped
  warnings: MigrationCoverageViolation[]; // advisory — active-scoped
  notes: string[]; // pre-epoch exempt count (never silent)
}

/** Build a probe entry: `note` per STE-82, `message` per NFR-10. */
function makeEntry(
  rel: string,
  line: number,
  reason: string,
  remedy: string,
  context: string,
): MigrationCoverageViolation {
  const anchored = line > 0 ? line : 1;
  return {
    file: rel,
    line: anchored,
    note: `${rel}:${anchored} — ${reason}`,
    message: [`migration_coverage: ${reason}`, `Remedy: ${remedy}`, `Context: ${context}`].join(
      "\n",
    ),
  };
}

/** Ascending list of `specs/plan/**` milestone plans directly under `dir`. */
async function listPlanFiles(dir: string): Promise<string[]> {
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

/**
 * Walk `specs/plan/archive/M*.md` + `specs/plan/M*.md` and enforce migration
 * coverage. Pure — file reads + a registry module load only.
 *
 * ARCHIVED, `shipped_in` ≥ epoch → the `migration:` key MUST be present and
 * (unless `none`) resolve to a registry entry whose `introduced_in` equals the
 * plan's `shipped_in`; every miss is an ERROR-severity violation. ARCHIVED,
 * `shipped_in` < epoch → exempt, tallied into a single NOTES count. ACTIVE
 * plans missing the key → advisory WARNING only (consumer-project-safe; the
 * ship pre-flight is the hard gate). `migration: null`/empty ⇒ ABSENT.
 *
 * Call site: `/gate-check` probe #68 + the STE-393 test at
 * `tests/m108-ste-393-probe.test.ts`.
 */
export async function runMigrationCoverageProbe(
  projectRoot: string,
  registry: readonly MigrationEntry[] = MIGRATIONS,
): Promise<MigrationCoverageReport> {
  const violations: MigrationCoverageViolation[] = [];
  const warnings: MigrationCoverageViolation[] = [];
  const notes: string[] = [];

  // --- ARCHIVED plans: hard ERROR checks, pre-epoch exempt ---
  const archiveDir = join(projectRoot, "specs", "plan", "archive");
  let exemptCount = 0;
  for (const file of await listPlanFiles(archiveDir)) {
    let content: string;
    try {
      content = await readFile(file, "utf-8");
    } catch {
      continue;
    }
    const fm = readFrontmatterSection(content);
    if (fm.kind !== "ok") continue; // #63 owns malformed-frontmatter diagnostics
    const rel = relative(projectRoot, file);

    // Scope: only plans that actually shipped are judged. Absent / `null` /
    // corrupt `shipped_in` is probe #63's domain (unshipped/corrupt-stamp debt).
    const shipped = readFrontmatterField(fm.section, "shipped_in");
    if (shipped.value === null) continue;
    const shippedNorm = normalizeVersion(shipped.value);
    const cmp = compareSemver(shippedNorm, MIGRATION_COVERAGE_EPOCH);
    if (cmp === null) continue;
    if (cmp < 0) {
      // Pre-epoch: grandfathered. Even a bogus migration id is NOT retro-classified.
      exemptCount++;
      continue;
    }

    // In scope (`shipped_in` ≥ epoch): the `migration:` declaration is mandatory.
    const mig = readFrontmatterField(fm.section, "migration");
    const decl = classifyMigration(mig.value);
    if (decl.kind === "absent") {
      violations.push(
        makeEntry(
          rel,
          mig.line || shipped.line || 1,
          `post-epoch archived plan ${rel} declares no \`migration:\` key — coverage is required from ${MIGRATION_COVERAGE_EPOCH} onward`,
          "add `migration: none` (release touched no consumer artifacts) or `migration: <registry entry id>` to the plan frontmatter",
          `file=${rel}, shipped_in=${shippedNorm}, migration=<absent>, probe=migration_coverage`,
        ),
      );
      continue;
    }
    if (decl.kind === "none") continue;

    const entry = registry.find((e) => e.id === decl.value);
    if (entry === undefined) {
      violations.push(
        makeEntry(
          rel,
          mig.line || 1,
          `archived plan ${rel} declares \`migration: ${decl.value}\`, but no registry entry with that id exists`,
          "declare an existing registry entry id (see `adapters/_shared/src/migrations/index.ts`) or `migration: none`",
          `file=${rel}, migration=${decl.value}, probe=migration_coverage`,
        ),
      );
      continue;
    }
    const entryNorm = normalizeVersion(entry.introduced_in);
    if (entryNorm !== shippedNorm) {
      violations.push(
        makeEntry(
          rel,
          mig.line || 1,
          `archived plan ${rel} declares \`migration: ${decl.value}\` (introduced_in ${entryNorm}), but the plan shipped ${shippedNorm} — the two versions must match`,
          "declare the entry whose `introduced_in` equals the plan's `shipped_in`, or `migration: none`",
          `file=${rel}, migration=${decl.value}, introduced_in=${entryNorm}, shipped_in=${shippedNorm}, probe=migration_coverage`,
        ),
      );
    }
  }

  if (exemptCount > 0) {
    notes.push(
      `migration_coverage: ${exemptCount} pre-epoch archived plan(s) exempt (grandfathered — shipped before ${MIGRATION_COVERAGE_EPOCH})`,
    );
  }

  // --- ACTIVE plans: advisory WARNING only, consumer-project-safe ---
  const planDir = join(projectRoot, "specs", "plan");
  for (const file of await listPlanFiles(planDir)) {
    let content: string;
    try {
      content = await readFile(file, "utf-8");
    } catch {
      continue;
    }
    const fm = readFrontmatterSection(content);
    if (fm.kind !== "ok") continue;
    const rel = relative(projectRoot, file);
    const decl = classifyMigration(readFrontmatterField(fm.section, "migration").value);
    if (decl.kind === "absent") {
      warnings.push(
        makeEntry(
          rel,
          1,
          `active plan ${rel} declares no \`migration:\` key — declare it before shipping`,
          "add `migration: none` or `migration: <registry entry id>` to the plan frontmatter (advisory — the ship pre-flight is the hard gate)",
          `file=${rel}, migration=<absent>, probe=migration_coverage`,
        ),
      );
    }
  }

  return { violations, warnings, notes };
}
