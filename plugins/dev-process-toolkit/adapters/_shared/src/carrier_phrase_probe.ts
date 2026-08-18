// carrier_phrase_probe — the shared engine behind the "a carrier must name
// every derived phrase" probe shape.
//
// Hoisted (M129 refactor pass, mirroring the STE-492 `markdown_fences.findFences`
// hoist) out of two near-identical copies written in the same registration
// sweep: `delegation_irreversible_exclusion.ts` (probe #78) and
// `merge_policy_override_ratchet.ts` (probe #79). Both had re-derived the same
// four steps — carrier-anchor detection, `skills/` + `docs/` markdown walk,
// per-phrase file scan, NFR-10 violation construction — and the second copy is
// exactly where the two would have drifted apart under later edits.
//
// WHAT IS SHARED, AND WHAT DELIBERATELY IS NOT.
//
// Shared: the MECHANISM. Which trees are walked, what makes a file a carrier,
// that the phrase test is FILE-scoped rather than clause-scoped, that an absent
// plugin tree is vacuous rather than a crash, and the violation record's shape.
//
// Not shared, and passed in per probe: the probe id, the anchor, the required
// phrase list (each probe DERIVES its own from its own shipped guard list —
// that derivation is the whole anti-drift point and must stay in the module
// that owns the guards), the reason text, and the NFR-10 message body. Two
// probes running on one engine still fail independently: a phrase missing from
// a #78 carrier reddens #78 alone, because the phrases, the anchor, and the
// verdict text all come from #78's own spec.
//
// Pure file reads only — no git, no network, no child processes.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export type Severity = "error" | "warning";

/**
 * One missing phrase in one carrier. Shape follows probe #37
 * `cross_cutting_spec_stale_file_refs`: `note` is
 * `<repo-relative-file>:<line> — <reason>`, `message` is the NFR-10 canonical
 * multi-line shape, and `severity` travels per violation.
 */
export interface CarrierPhraseViolation {
  file: string;
  line: number;
  reason: string;
  note: string;
  message: string;
  severity: Severity;
}

/** Everything one probe contributes to the shared walk. */
export interface CarrierPhraseProbeSpec {
  /** The probe id, as registered in `skills/gate-check/SKILL.md`. */
  readonly probeId: string;
  /** The prose token that makes a file a carrier of this probe's claim. */
  readonly anchor: string;
  /** DERIVED from the probe's own shipped guard list — never a retyped copy. */
  requiredPhrases(): string[];
  /** Why this carrier missing this phrase is a defect. */
  reasonFor(phrase: string): string;
  /** The NFR-10 canonical `Refusing:` / `Remedy:` / `Context:` body. */
  messageFor(reason: string, phrase: string, rel: string, line: number): string;
}

/**
 * The plugin-relative trees a carrier may live in.
 *
 * BOTH, deliberately: probe #77 `first_turn_refusal_marker` walks skills only
 * because a first-turn contract can only live in a SKILL.md, but the claims
 * these probes police can be written down in either tree, and restricting to
 * `skills/` would let one be documented away in `docs/`.
 */
export const CARRIER_SCANNED_TREES = ["skills", "docs"] as const;

/** Collect every `.md` under `dir`, recursively, in deterministic order. */
export function collectMarkdownFiles(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir).sort();
  } catch {
    return out;
  }
  for (const name of entries) {
    const p = join(dir, name);
    let isDir: boolean;
    try {
      isDir = statSync(p).isDirectory();
    } catch {
      continue;
    }
    if (isDir) {
      out.push(...collectMarkdownFiles(p));
      continue;
    }
    if (name.endsWith(".md")) out.push(p);
  }
  return out;
}

/**
 * Locate the first line naming `anchor`, 1-based. Returns `0` when the file
 * names it nowhere — the out-of-scope predicate.
 */
function findAnchorLine(lines: readonly string[], anchor: string): number {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.includes(anchor)) return i + 1;
  }
  return 0;
}

/**
 * Scan one markdown file against one spec. Returns `[]` for non-carriers (no
 * claim made, so no prose owed) and for compliant carriers.
 */
export function scanCarrierFile(
  absPath: string,
  projectRoot: string,
  spec: CarrierPhraseProbeSpec,
): CarrierPhraseViolation[] {
  let content: string;
  try {
    content = readFileSync(absPath, "utf-8");
  } catch {
    return [];
  }
  // CRLF/BOM blindness — closed repo-wide on 2026-07-26 — is not re-introduced.
  const normalized = content.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const anchorLine = findAnchorLine(normalized.split("\n"), spec.anchor);
  if (anchorLine === 0) return [];

  const rel = relative(projectRoot, absPath);
  const violations: CarrierPhraseViolation[] = [];
  for (const phrase of spec.requiredPhrases()) {
    // FILE-scoped: the phrase may live outside the anchor's own sentence. The
    // shipped carriers state the claim on one line and its consequences on
    // another; demanding co-location would fail a compliant skill.
    if (normalized.includes(phrase)) continue;
    const reason = spec.reasonFor(phrase);
    violations.push({
      file: absPath,
      line: anchorLine,
      reason,
      note: `${rel}:${anchorLine} — ${reason}`,
      message: spec.messageFor(reason, phrase, rel, anchorLine),
      severity: "error",
    });
  }
  return violations;
}

/**
 * Walk `plugins/dev-process-toolkit/{skills,docs}/**\/*.md` under `projectRoot`
 * and flag every carrier that fails to name a required phrase. Pure function —
 * no side effects, no writes.
 *
 * Rooted at `plugins/dev-process-toolkit/` (the house idiom, shared with probe
 * #77 and probe #66 `public_surface_count_drift`) so a consumer project's
 * `.claude/skills/` tree is never dragged into scope, and vacuous (zero
 * violations, no crash) when that tree is absent — a consumer project that
 * never installed the toolkit's own sources cannot fail these probes.
 */
export async function runCarrierPhraseProbe(
  projectRoot: string,
  spec: CarrierPhraseProbeSpec,
): Promise<CarrierPhraseViolation[]> {
  const pluginRoot = join(projectRoot, "plugins", "dev-process-toolkit");
  const violations: CarrierPhraseViolation[] = [];
  if (!existsSync(pluginRoot)) return violations;

  for (const tree of CARRIER_SCANNED_TREES) {
    const dir = join(pluginRoot, tree);
    if (!existsSync(dir)) continue;
    for (const file of collectMarkdownFiles(dir)) {
      violations.push(...scanCarrierFile(file, projectRoot, spec));
    }
  }

  return violations;
}
