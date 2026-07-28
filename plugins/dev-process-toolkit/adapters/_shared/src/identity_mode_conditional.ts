// identity_mode_conditional — /gate-check probe (STE-86 AC-STE-86.5/6/8).
//
// Bimodal invariant:
//   - mode: none        → every active FR MUST carry `id: fr_<26-char ULID>`
//   - mode: <tracker>   → every active FR MUST NOT carry an `id:` line
//
// Severity flipped warning → error at M29 (STE-110 AC-STE-110.4): now that
// /spec-write's tracker-mode template no longer emits `id:`, regressions
// must hard-fail rather than slip through as a `GATE PASSED WITH NOTES`.
//
// Zero runtime dep on ulid.ts (AC-STE-86.8) — the ULID shape regex is
// inlined as a private constant. The probe is a bimodal-invariant enforcer
// and must not cross the scope-3 isolation boundary around mode-none
// identity minting. The 6-char tail below is likewise sliced inline rather
// than imported, for the same reason.
//
// Cross-file duplicate pass (M116): the bimodal walk above is per-file and
// active-only, so two records deriving the SAME 6-char short-ULID tail sit
// green side by side — each is individually well-formed. The tail is the key
// every downstream reader uses (filename stem, AC prefix, archive lookup), and
// the colliding twin usually lives in `specs/frs/archive/`, invisible to a
// walk that stops at the active directory and keeps no cross-file state. A
// SEPARATE accumulator therefore spans `specs/frs/` and `specs/frs/archive/`
// together and reports duplicates only.
//
// Deliberately additive, NOT a widening of the bimodal loop: this repo runs
// `mode: linear` and its archive holds 31 legacy mode-none records that each
// carry both an `id:` line and a `tracker: {}` block. Running the bimodal
// invariant over them would turn the repo's own dogfood assertion red, so the
// archive contributes tail claims and nothing else.

import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { normalizeFrontmatterSource } from "./frontmatter";
import { readTaskTrackingSection } from "./resolver_config";

// AC-STE-86.8: inlined to avoid runtime dep on ulid.ts.
const ULID_ID_LINE_RE = /^id: fr_[0-9A-HJKMNP-TV-Z]{26}$/;
const ANY_ID_LINE_RE = /^id:\s*(.*)$/;

// STE-110 AC-STE-110.4 (M29): severity flipped warning → error. The flip
// landed once /spec-write stopped emitting `id:` in tracker mode (the
// regression source). The TODO anchor below is preserved as a historical
// pointer; the literal "error" string is what /gate-check reads.
// TODO(STE-110): severity flipped warn → error in M29 ship.
export const IDENTITY_MODE_CONDITIONAL_SEVERITY: "warning" | "error" = "error";

export interface IdentityModeViolation {
  file: string;
  line: number;
  expected:
    | "present"
    | "absent"
    | "populated"
    | "fr_<26-char ULID>"
    | "one FR per short-ULID tail";
  actual: string;
  note: string;
  message: string;
}

export interface IdentityModeConditionalReport {
  mode: string;
  severity: "warning" | "error";
  violations: IdentityModeViolation[];
}

interface IdScan {
  present: boolean;
  line: number;
  value: string;
  wellFormed: boolean;
}

/**
 * Extract the line array of an FR's YAML frontmatter block, or `null` when
 * the content lacks a well-formed `---\n...\n---` opener. Shared by
 * `scanFrontmatterForId` and `scanFrontmatterForTracker` — both scanners
 * walked the same 7-line prelude before this hoist.
 */
function splitFrontmatterLines(rawContent: string): string[] | null {
  // Normalize BOM + line endings before anchoring on the `---\n` opener.
  // Without this a CRLF or BOM-prefixed FR scans as having no frontmatter,
  // which is wrong in BOTH directions: in tracker mode a forbidden `id:` goes
  // undetected AND a populated `tracker:` block is reported missing, while in
  // `mode: none` a well-formed FR is failed for a missing `id:`. All three
  // were reproduced. Line COUNT is preserved, so line numbers stay accurate.
  const content = normalizeFrontmatterSource(rawContent);
  if (!content.startsWith("---\n")) return null;
  const closeIdx = content.indexOf("\n---", 4);
  if (closeIdx < 0) return null;
  return content.slice(4, closeIdx).split("\n");
}

function scanFrontmatterForId(content: string): IdScan {
  const fmLines = splitFrontmatterLines(content);
  if (fmLines === null) {
    return { present: false, line: 0, value: "", wellFormed: false };
  }
  for (let i = 0; i < fmLines.length; i++) {
    const line = fmLines[i]!;
    const m = ANY_ID_LINE_RE.exec(line);
    if (!m) continue;
    return {
      present: true,
      // +2: one for the leading `---\n` line, one for 1-based indexing.
      line: i + 2,
      value: (m[1] ?? "").trim(),
      wellFormed: ULID_ID_LINE_RE.test(line),
    };
  }
  return { present: false, line: 0, value: "", wellFormed: false };
}

// STE-321 AC-STE-321.5 + AC-STE-321.10 — bidirectional `tracker:` invariant.
//
// Detect whether the FR frontmatter carries a `tracker:` block and whether it
// is populated. Three states:
//   - present=false              → no `tracker:` line at all
//   - present=true, empty=true   → `tracker: {}` (legacy drift in mode-none)
//   - present=true, empty=false  → `tracker:` followed by at least one nested
//                                  `<key>: <value>` line (canonical tracker mode)
//
// Twin scanner of `scanFrontmatterForId`. Exported so the test surface
// (`tests/m84-ste-321-adapter-shape.test.ts`) can byte-check the helper
// independently of the probe.

export interface TrackerScan {
  present: boolean;
  empty: boolean;
  line: number;
}

const TRACKER_LINE_RE = /^tracker:\s*(.*)$/;

export function scanFrontmatterForTracker(content: string): TrackerScan {
  const fmLines = splitFrontmatterLines(content);
  if (fmLines === null) {
    return { present: false, empty: false, line: 0 };
  }
  for (let i = 0; i < fmLines.length; i++) {
    const line = fmLines[i]!;
    const m = TRACKER_LINE_RE.exec(line);
    if (!m) continue;
    // +2: one for the leading `---\n` line, one for 1-based indexing.
    const lineNum = i + 2;
    const inlineValue = (m[1] ?? "").trim();
    // `tracker: {}` — empty inline map.
    if (inlineValue === "{}") {
      return { present: true, empty: true, line: lineNum };
    }
    // `tracker: { key: value }` — populated inline map.
    if (inlineValue.startsWith("{") && inlineValue.endsWith("}")) {
      const body = inlineValue.slice(1, -1).trim();
      return { present: true, empty: body.length === 0, line: lineNum };
    }
    // `tracker:` with trailing content other than `{...}` — treat as populated.
    if (inlineValue.length > 0) {
      return { present: true, empty: false, line: lineNum };
    }
    // `tracker:` followed by indented child lines → populated when at least
    // one nested `key: value` line appears before frontmatter close.
    for (let j = i + 1; j < fmLines.length; j++) {
      const child = fmLines[j]!;
      if (/^\s+\S/.test(child)) {
        // indented continuation — populated.
        return { present: true, empty: false, line: lineNum };
      }
      if (child.length === 0) continue;
      // un-indented sibling key → tracker: had no children, treat as empty.
      break;
    }
    return { present: true, empty: true, line: lineNum };
  }
  return { present: false, empty: false, line: 0 };
}

function resolveMode(projectRoot: string): string {
  const section = readTaskTrackingSection(join(projectRoot, "CLAUDE.md"));
  const mode = section["mode"];
  if (!mode || mode.length === 0) return "none";
  return mode;
}

/**
 * Every `*.md` directly inside `dir`, sorted. Non-recursive by design: the
 * active walk must NOT descend into `archive/`, and the archive walk is a
 * separate, explicitly-named call so the two scopes stay legible.
 *
 * A missing directory yields `[]` rather than throwing — consumer trees
 * routinely have no `specs/frs/archive/` until their first archival.
 */
async function listFRsIn(dir: string): Promise<string[]> {
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

async function listActiveFRs(projectRoot: string): Promise<string[]> {
  return listFRsIn(join(projectRoot, "specs", "frs"));
}

async function listArchivedFRs(projectRoot: string): Promise<string[]> {
  return listFRsIn(join(projectRoot, "specs", "frs", "archive"));
}

/** One FR's contribution to the cross-file short-ULID duplicate index. */
interface TailClaim {
  file: string;
  rel: string;
  /** 1-based line of the `id:` key — notes must cite a line. */
  line: number;
  /** The recorded minted id, `fr_` + 26 Crockford base32 chars. */
  id: string;
}

/**
 * The 6-char short-ULID tail of a well-formed `fr_<26-char ULID>` value.
 *
 * `slice(23, 29)` — `fr_` is 3 chars, the ULID is 26, so the tail is the last
 * six. Sliced inline to keep the zero-runtime-dep boundary above intact: this
 * probe must not import the module whose output it polices.
 */
function tailOfMintedId(id: string): string {
  return id.slice(23, 29);
}

/**
 * Record `file`'s tail claim when its frontmatter carries a well-formed minted
 * id. Malformed values are skipped — the bimodal walk already reports those in
 * `mode: none`, and slicing a garbage value would key the map on noise.
 *
 * Routed through `scanFrontmatterForId` on purpose: a whole-file `^id:` scan
 * reads fenced YAML quoted in an FR's BODY as a second identity and mints
 * phantom duplicates (`specs/frs/archive/STE-110.md` quotes exactly that).
 */
function recordTailClaim(
  claims: Map<string, TailClaim[]>,
  file: string,
  scan: IdScan,
  projectRoot: string,
): void {
  if (!scan.present || !scan.wellFormed) return;
  const tail = tailOfMintedId(scan.value);
  const bucket = claims.get(tail);
  const claim: TailClaim = {
    file,
    rel: relative(projectRoot, file),
    line: scan.line,
    id: scan.value,
  };
  if (bucket === undefined) claims.set(tail, [claim]);
  else bucket.push(claim);
}

function buildNote(file: string, line: number, reason: string, projectRoot: string): string {
  const rel = relative(projectRoot, file);
  return `${rel}:${line} — ${reason}`;
}

function buildMessage(reason: string, remedy: string, context: Record<string, string>): string {
  // NFR-10 canonical shape: verdict + remedy + context fused.
  const contextStr = Object.entries(context)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
  return `identity_mode_conditional: ${reason}\nRemedy: ${remedy}\nContext: ${contextStr}`;
}

/**
 * Scan every active FR under `projectRoot/specs/frs/*.md` and return the
 * list of violations. Pure function — no side effects, no writes.
 *
 * Call site: `/gate-check` v2 conformance probes + the STE-82 integration
 * test at `tests/gate-check-identity-mode-conditional.test.ts`.
 */
export async function runIdentityModeConditionalProbe(
  projectRoot: string,
): Promise<IdentityModeConditionalReport> {
  const mode = resolveMode(projectRoot);
  const isTracker = mode !== "none";
  const files = await listActiveFRs(projectRoot);
  const violations: IdentityModeViolation[] = [];
  // Keyed on the 6-char tail; spans active + archive. Insertion order is
  // deterministic — both walks sort, and the active walk runs first.
  const claimsByTail = new Map<string, TailClaim[]>();

  for (const file of files) {
    let content: string;
    try {
      content = await readFile(file, "utf-8");
    } catch {
      continue;
    }
    const scan = scanFrontmatterForId(content);
    const trackerScan = scanFrontmatterForTracker(content);
    recordTailClaim(claimsByTail, file, scan, projectRoot);

    if (isTracker) {
      // Tracker mode: id: must be absent.
      if (scan.present) {
        const expected = "absent" as const;
        const actual = scan.value;
        violations.push({
          file,
          line: scan.line,
          expected,
          actual,
          note: buildNote(file, scan.line, `expected ${expected}, actual ${actual}`, projectRoot),
          message: buildMessage(
            `tracker-mode FR carries an id: line that should be absent (observed ${actual})`,
            `delete the id: line from ${relative(projectRoot, file)} frontmatter — the tracker ID is the canonical identity in tracker mode`,
            { mode, file: relative(projectRoot, file), line: String(scan.line) },
          ),
        });
      }
      // STE-321 AC-STE-321.5: tracker mode requires `tracker:` present + populated.
      if (!trackerScan.present || trackerScan.empty) {
        const expected = "populated" as const;
        const actual = !trackerScan.present ? "missing" : "empty";
        const violationLine = trackerScan.present ? trackerScan.line : 1;
        violations.push({
          file,
          line: violationLine,
          expected,
          actual,
          note: buildNote(
            file,
            violationLine,
            `expected tracker: ${expected}, actual ${actual}`,
            projectRoot,
          ),
          message: buildMessage(
            `tracker-mode FR is missing a populated tracker: block (observed ${actual})`,
            `add a tracker: { ${mode}: <ticket-id> } block to ${relative(projectRoot, file)} frontmatter — tracker mode binds the FR to its ticket via this field`,
            { mode, file: relative(projectRoot, file), line: String(violationLine) },
          ),
        });
      }
    } else {
      // mode: none — id: must be present AND well-formed.
      if (!scan.present) {
        const expected = "present" as const;
        const actual = "missing";
        violations.push({
          file,
          line: 1,
          expected,
          actual,
          note: buildNote(file, 1, `expected id: line ${expected}, actual ${actual}`, projectRoot),
          message: buildMessage(
            `mode-none FR is missing its id: line`,
            `add a valid id: fr_<26-char ULID> line to ${relative(projectRoot, file)} frontmatter — mode-none identity is the short-ULID`,
            { mode, file: relative(projectRoot, file) },
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
          note: buildNote(
            file,
            scan.line,
            `expected ${expected}, actual ${actual}`,
            projectRoot,
          ),
          message: buildMessage(
            `mode-none FR has a malformed id: value (observed ${actual})`,
            `fix the id: line in ${relative(projectRoot, file)} to match ${expected}`,
            { mode, file: relative(projectRoot, file), line: String(scan.line) },
          ),
        });
      }
      // STE-321 AC-STE-321.5: mode-none requires `tracker:` ABSENT.
      if (trackerScan.present) {
        const expected = "absent" as const;
        const actual = trackerScan.empty ? "tracker: {}" : "tracker: { ... }";
        violations.push({
          file,
          line: trackerScan.line,
          expected,
          actual,
          note: buildNote(
            file,
            trackerScan.line,
            `expected tracker: ${expected}, actual ${actual}`,
            projectRoot,
          ),
          message: buildMessage(
            `mode-none FR carries a tracker: block that should be absent (observed ${actual})`,
            `delete the tracker: line from ${relative(projectRoot, file)} frontmatter — mode-none FRs identify themselves via the short-ULID id: line, not a tracker binding`,
            { mode, file: relative(projectRoot, file), line: String(trackerScan.line) },
          ),
        });
      }
    }
  }

  // Archive leg of the duplicate accumulator — claims ONLY. The bimodal
  // invariant above stays active-only (see the module header): archived
  // records are frozen history and legitimately predate the current mode.
  for (const file of await listArchivedFRs(projectRoot)) {
    let content: string;
    try {
      content = await readFile(file, "utf-8");
    } catch {
      continue;
    }
    recordTailClaim(claimsByTail, file, scanFrontmatterForId(content), projectRoot);
  }

  // Cross-file pass, APPENDED after the per-file walk so the existing
  // per-file violation ordering is untouched.
  for (const [tail, claims] of claimsByTail) {
    if (claims.length < 2) continue;
    const first = claims[0]!;
    const relProse = claims.map((c) => c.rel).join(", ");
    const expected = "one FR per short-ULID tail" as const;
    const actual = `${claims.length} FRs derive ${tail} (${relProse})`;
    violations.push({
      file: first.file,
      line: first.line,
      expected,
      actual,
      note: buildNote(first.file, first.line, `expected ${expected}, actual ${actual}`, projectRoot),
      message: buildMessage(
        `duplicate short-ULID tail — ${claims.length} FRs collide on ${tail} across specs/frs/ and specs/frs/archive/ (${relProse})`,
        `re-mint all but one of ${relProse} and rewrite each record's filename and id: line together, since the filename stem and the AC prefix are both the 6-char tail of the recorded id. Each file is individually well-formed, so nothing else flags this: every reader keyed on the tail silently resolves to whichever colliding record it walks first`,
        {
          mode,
          tail,
          files: claims.map((c) => c.rel).join(" | "),
          ids: claims.map((c) => c.id).join(" | "),
        },
      ),
    });
  }

  return {
    mode,
    severity: IDENTITY_MODE_CONDITIONAL_SEVERITY,
    violations,
  };
}
