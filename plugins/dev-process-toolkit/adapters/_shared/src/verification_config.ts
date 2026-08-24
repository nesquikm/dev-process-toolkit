// readVerificationConfig — STE-347 helper that reads the optional
// `## Verification` section from a project's CLAUDE.md and returns a typed
// `VerificationConfig` record (AC-STE-347.1).
//
// Schema (Schema L-style, optional section alongside `## Task Tracking`
// and `## Docs`):
//
//     ## Verification
//
//     verify_skill: <slug>
//     verify_mode: <advisory|blocking|manual>
//     run_cmd: <shell command | none>
//     e2e_cmd: <shell command | none>
//
// `verify_skill` names a project-local skill (a `.claude/skills/<name>`
// slug) or the literal `visual-check`. `verify_mode` gates how /implement
// treats a failing check. `run_cmd` / `e2e_cmd` (STE-503) declare how the
// project is run and how its end-to-end suite is invoked; the literal value
// `none` is an ANSWER ("this project cannot be run"), distinct from an absent
// key, which is no answer at all. The top-level key set inside the section is
// CLOSED — exactly {verify_skill, verify_mode, run_cmd, e2e_cmd}. Unlike
// `## Docs` (which ignores unrecognized keys), an out-of-set key here throws:
// a typo'd key would otherwise silently disable the check the project
// declared.
//
// Absent CLAUDE.md, absent section, or absent key ⇒ defaults
// { verifySkill: null, verifyMode: "advisory", runCmd: null, e2eCmd: null } —
// parallels the docs_config/resolver_config convention where an absent file is
// not a hard failure. That record is the DECLARED one; `resolveVerifyMode`
// (STE-505) answers the derived question of the EFFECTIVE mode, where an
// undeclared `verify_mode` on a declared-runnable project resolves to
// `blocking`.
//
// Malformed input (out-of-set key, or a `verify_mode` value outside the
// lowercase literal set) throws `MalformedVerificationConfigError`
// carrying the offending key + value (NFR-10 remedy shape).
//
// Every read of CLAUDE.md here goes through `normalizeFrontmatterSource`
// (strips a UTF-8 BOM, folds CRLF and lone CR to LF) before the heading is
// matched. The heading match is whole-line, so an unfolded CRLF file yields
// `"## Verification\r"` and the ENTIRE section goes invisible: the declared
// `verify_skill` is ignored, `resolveVerifyMode`'s run_cmd default is defeated
// by a line ending, and a typo'd key never throws — the closed-set discipline
// silently disabled by the very failure it exists to prevent. The normalizer
// preserves line COUNT, so `verificationSectionLine`'s 1-based number stays
// honest, and it is a no-op on already-LF content.

import { existsSync, readFileSync } from "node:fs";

import { normalizeFrontmatterSource } from "./frontmatter";

export type VerifyMode = "advisory" | "blocking" | "manual";

export interface VerificationConfig {
  verifySkill: string | null;
  verifyMode: VerifyMode;
  /** Declared run command; `"none"`; `""` for a bare key; null when absent. */
  runCmd: string | null;
  /** Declared e2e command; `"none"`; `""` for a bare key; null when absent. */
  e2eCmd: string | null;
}

/**
 * Thrown when the `## Verification` section contains an out-of-closed-set
 * key, or a `verify_mode` value outside {advisory, blocking, manual}.
 * Callers surface key + value so the operator can fix the exact line.
 */
export class MalformedVerificationConfigError extends Error {
  readonly key: string;
  readonly value: string;
  constructor(key: string, value: string, detail: string) {
    super(
      `verification config key "${key}" with value "${value}" is malformed — ${detail}`,
    );
    this.name = "MalformedVerificationConfigError";
    this.key = key;
    this.value = value;
  }
}

/**
 * The section's one anchor, matched as a WHOLE LINE (never a substring, never a
 * regex). Exported so a consumer that must point an operator at the section —
 * a gate probe's `file:line` note, a remedy string naming the heading — quotes
 * this rather than re-declaring the literal and drifting from the parser.
 */
export const VERIFICATION_HEADING = "## Verification";

/** Index of the section heading in `lines`, or -1 when there is no section. */
function sectionIndex(lines: readonly string[]): number {
  return lines.findIndex((l) => l === VERIFICATION_HEADING);
}

/**
 * The 1-based line of the `## Verification` heading in `claudeMdPath`, or
 * `null` when there is no such line — an absent or unreadable file, or a
 * CLAUDE.md carrying no section. Never throws.
 *
 * `readVerificationConfig` returns values, not positions; this is the
 * positional half, anchored on the same whole-line match so the two cannot
 * disagree about where the section is.
 */
export function verificationSectionLine(claudeMdPath: string): number | null {
  let body: string;
  try {
    body = readFileSync(claudeMdPath, "utf8");
  } catch {
    return null;
  }
  const idx = sectionIndex(normalizeFrontmatterSource(body).split("\n"));
  return idx < 0 ? null : idx + 1;
}

const VERIFY_MODES: readonly string[] = ["advisory", "blocking", "manual"];

const DEFAULTS: VerificationConfig = {
  verifySkill: null,
  verifyMode: "advisory",
  runCmd: null,
  e2eCmd: null,
};

/** The closed key set, in canonical authoring (and render) order. */
const CLOSED_KEYS = [
  "verify_skill",
  "verify_mode",
  "run_cmd",
  "e2e_cmd",
] as const;

/**
 * The parse's two halves: the resolved record, plus the set of keys the
 * author ACTUALLY WROTE. `readVerificationConfig` returns only the first;
 * `resolveVerifyMode` needs the second to tell a declared `verify_mode`
 * from the defaulted one. Both exports go through the single parse below,
 * so the section grammar exists exactly once.
 */
interface ParsedVerificationSection {
  config: VerificationConfig;
  declaredKeys: ReadonlySet<string>;
}

/**
 * Parse the `## Verification` section of CLAUDE.md.
 *
 * Section terminates at the next heading line (`# `, `## `, `### `,
 * `#### `) — the same termination rule as `readDocsConfig`. Schema L's
 * grep contract requires flat `key: value` pairs only, no nesting.
 *
 * @throws MalformedVerificationConfigError on an out-of-closed-set key
 * inside the section, or a `verify_mode` value outside
 * {advisory, blocking, manual}.
 */
function parseVerificationSection(
  claudeMdPath: string,
): ParsedVerificationSection {
  const declaredKeys = new Set<string>();
  if (!existsSync(claudeMdPath)) {
    return { config: { ...DEFAULTS }, declaredKeys };
  }
  const md = normalizeFrontmatterSource(readFileSync(claudeMdPath, "utf8"));
  const lines = md.split("\n");
  const startIdx = sectionIndex(lines);
  if (startIdx < 0) return { config: { ...DEFAULTS }, declaredKeys };

  const result: VerificationConfig = { ...DEFAULTS };
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^#{1,4} /.test(line)) break;
    const m = /^([a-z0-9_]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    const [, key, rawValue] = m;
    const value = (rawValue ?? "").trim();
    declaredKeys.add(key!);
    switch (key) {
      case "verify_skill":
        result.verifySkill = value;
        break;
      case "verify_mode":
        if (!VERIFY_MODES.includes(value)) {
          throw new MalformedVerificationConfigError(
            key!,
            value,
            'expected one of lowercase "advisory" | "blocking" | "manual"',
          );
        }
        result.verifyMode = value as VerifyMode;
        break;
      case "run_cmd":
        result.runCmd = value;
        break;
      case "e2e_cmd":
        result.e2eCmd = value;
        break;
      default:
        throw new MalformedVerificationConfigError(
          key!,
          value,
          `the ## Verification key set is closed to {${CLOSED_KEYS.join(", ")}}`,
        );
    }
  }
  return { config: result, declaredKeys };
}

/**
 * The DECLARED `## Verification` record. Shape and values are exactly what
 * they have always been — an absent `verify_mode` still reads back as
 * `advisory` here. The run_cmd-keyed default is a DERIVED question, answered
 * by `resolveVerifyMode` below rather than by widening this record.
 *
 * @throws MalformedVerificationConfigError — see `parseVerificationSection`.
 */
export function readVerificationConfig(
  claudeMdPath: string,
): VerificationConfig {
  return parseVerificationSection(claudeMdPath).config;
}

/**
 * The EFFECTIVE `verify_mode` — what `/implement` Phase 4b″ actually gates on
 * (STE-505):
 *
 *   1. a written `verify_mode` ⇒ that value, always. An explicit `advisory`
 *      still wins, so the guide's promote-when-stable workflow survives; only
 *      the end a declared-runnable project STARTS at changes.
 *   2. else `run_cmd` declared, non-empty, and not the literal `none`
 *      ⇒ `blocking`. A project that says how to run itself gets driven, and a
 *      failing drive gates the commit.
 *   3. else ⇒ `advisory`, byte-for-byte today's behaviour.
 *
 * Rule 2's "non-empty" clause matches `/gate-check` probe #80's
 * `hasRunCmdAnswer`: a bare `run_cmd:` is an omission that merely looks like
 * an answer, and the two layers must not disagree about it.
 *
 * @throws MalformedVerificationConfigError — a malformed section is surfaced,
 * never silently defaulted.
 */
export function resolveVerifyMode(claudeMdPath: string): VerifyMode {
  const { config, declaredKeys } = parseVerificationSection(claudeMdPath);
  if (declaredKeys.has("verify_mode")) return config.verifyMode;
  const runCmd = config.runCmd?.trim() ?? "";
  return runCmd !== "" && runCmd !== "none" ? "blocking" : config.verifyMode;
}

/**
 * Render a VerificationConfig back into a `## Verification` section body.
 *
 * Only DECLARED keys are emitted: a null `runCmd`/`e2eCmd`/`verifySkill`
 * produces no line at all, so an absent key round-trips as absent and the
 * literal `none` round-trips as `none`. `verifyMode` always has a value
 * (default `advisory`) and is always emitted.
 *
 * DO NOT USE THIS TO REWRITE AN EXISTING BLOCK. The always-emitted
 * `verify_mode` line is the trap: `readVerificationConfig` defaults that field
 * to `advisory`, so round-tripping a block that never declared the key STAMPS
 * `verify_mode: advisory` onto it — and `resolveVerifyMode` then returns that
 * written value instead of the `blocking` it owes a declared-runnable project.
 * The default would be defeated silently, on exactly the projects a rewrite
 * touches, and the operator's own comments and key order would be eaten with
 * it. A writer that edits a block someone already authored must SPLICE the
 * lines it needs (see `migrations/entries/verification_run_keys.ts`); this
 * renderer is for composing a section from scratch.
 */
export function renderVerificationSection(config: VerificationConfig): string {
  const lines: string[] = [VERIFICATION_HEADING, ""];
  if (config.verifySkill !== null) {
    lines.push(`verify_skill: ${config.verifySkill}`);
  }
  lines.push(`verify_mode: ${config.verifyMode}`);
  if (config.runCmd !== null) lines.push(`run_cmd: ${config.runCmd}`);
  if (config.e2eCmd !== null) lines.push(`e2e_cmd: ${config.e2eCmd}`);
  return `${lines.join("\n")}\n`;
}
