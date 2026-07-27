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
// LEGACY COEXISTENCE. The mode-none direction is keyed on the plan-id SHAPE,
// not on the mode alone: a flat "every mode-none plan needs `id:`" rule would
// hard-fail every pre-existing plan in every tracker-less consumer project on
// upgrade — the migration the spec explicitly rules out. So the requirement is
// scoped to exactly `milestoneIdFromUlid`'s OUTPUT RANGE (`M_` + a 6-char
// Crockford base32 tail). Everything outside that range is grandfathered:
//   - sequential `M<N>` plans, which predate minted ids; and
//   - Epic-keyed `M_PROJ_500` plans carried over by a jira → none mode
//     transition, which never had a ULID to record and whose operator cannot
//     satisfy a "add the minted id" remedy.
// Scoping by the producer's own range is not the fragile charset heuristic the
// spec ruled out for the token GRAMMAR — that rejected proposal was a third
// parser `kind` affecting every consumer. This is one probe declining to police
// ids it can prove it did not mint. A real Jira key sanitizes to `PROJ_500`
// (letters, `_`, digits), so it cannot land inside the tail range by accident.
// The tracker-mode direction stays unconditional; no plan of any shape may
// carry `id:`.
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

import { readdir, readFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { normalizeFrontmatterSource } from "./frontmatter";
import { PLAN_FILENAME_RE, milestoneIdFromUlid, parseMilestoneToken } from "./milestone_token";
import { readTaskTrackingSection } from "./resolver_config";
import { ULID_REGEX } from "./ulid";

const ANY_ID_LINE_RE = /^id:\s*(.*)$/;

/** A regression must hard-fail, not slip through as `GATE PASSED WITH NOTES`. */
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
    | "one plan file per milestone token";
  actual: string;
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
 * Strip a UTF-8 BOM and fold every line-ending flavour to `\n`.
 *
 * Load-bearing, not cosmetic. The frontmatter scan below anchors on a literal
 * `---\n` opener, so ANY unhandled prefix or separator makes a whole plan file
 * read as "no frontmatter" — which is silently wrong in both directions: in
 * tracker mode it PASSES a plan carrying a forbidden `id:` (false negative on
 * an error-severity probe), and in `mode: none` it reports a well-formed
 * minted plan as missing its key (false-positive GATE FAILED). Both were
 * reproduced against real fixtures. `\r\n` is folded before lone `\r` so CRLF
 * never becomes a blank line, and neither substitution changes the line count,
 * so reported line numbers stay accurate.
 */
function normalizeSource(raw: string): string {
  return raw.replace(/^﻿/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

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
        note: buildNote(file, scan.line, `expected ${expected}, actual ${actual}`, projectRoot),
        message: buildMessage(
          `tracker-mode plan carries an id: line that should be absent (observed ${actual})`,
          `delete the id: line from ${rel} frontmatter — the tracker ID is the canonical identity in tracker mode`,
          { mode, file: rel, line: String(scan.line) },
        ),
      });
      continue;
    }

    // mode: none — only MINTED plan ids carry the key. Sequential `M<N>`
    // plans predate minting and are grandfathered (coexistence, no migration).
    if (!isMintedPlanId(basename(file))) continue;

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
        note: buildNote(file, 1, `expected id: line ${expected}, actual missing`, projectRoot),
        message: buildMessage(
          `mode-none minted plan is missing its id: line`,
          `add the minted id: fr_<26-char ULID> line to ${rel} frontmatter — the plan id derives from it, so the plan must record the value verbatim. If this plan was never minted (hand-authored or ported, so no id ever existed), rename it off the minted M_<6-char Crockford> shape instead — ids outside the minter's output range are not policed`,
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
    severity: PLAN_IDENTITY_MODE_CONDITIONAL_SEVERITY,
    violations,
  };
}
