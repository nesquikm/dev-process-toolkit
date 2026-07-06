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
//
// `verify_skill` names a project-local skill (a `.claude/skills/<name>`
// slug) or the literal `visual-check`. `verify_mode` gates how /implement
// treats a failing check. The top-level key set inside the section is
// CLOSED — exactly {verify_skill, verify_mode}. Unlike `## Docs` (which
// ignores unrecognized keys), an out-of-set key here throws: a typo'd key
// would otherwise silently disable the check the project declared.
//
// Absent CLAUDE.md, absent section, or absent key ⇒ defaults
// { verifySkill: null, verifyMode: "advisory" } — parallels the
// docs_config/resolver_config convention where an absent file is not a
// hard failure.
//
// Malformed input (out-of-set key, or a `verify_mode` value outside the
// lowercase literal set) throws `MalformedVerificationConfigError`
// carrying the offending key + value (NFR-10 remedy shape).

import { existsSync, readFileSync } from "node:fs";

export type VerifyMode = "advisory" | "blocking" | "manual";

export interface VerificationConfig {
  verifySkill: string | null;
  verifyMode: VerifyMode;
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

const VERIFY_MODES: readonly string[] = ["advisory", "blocking", "manual"];

const DEFAULTS: VerificationConfig = {
  verifySkill: null,
  verifyMode: "advisory",
};

/**
 * Parse the `## Verification` section of CLAUDE.md into a
 * VerificationConfig.
 *
 * Section terminates at the next heading line (`# `, `## `, `### `,
 * `#### `) — the same termination rule as `readDocsConfig`. Schema L's
 * grep contract requires flat `key: value` pairs only, no nesting.
 *
 * @throws MalformedVerificationConfigError on an out-of-closed-set key
 * inside the section, or a `verify_mode` value outside
 * {advisory, blocking, manual}.
 */
export function readVerificationConfig(
  claudeMdPath: string,
): VerificationConfig {
  if (!existsSync(claudeMdPath)) return { ...DEFAULTS };
  const md = readFileSync(claudeMdPath, "utf8");
  const lines = md.split("\n");
  const startIdx = lines.findIndex((l) => l === "## Verification");
  if (startIdx < 0) return { ...DEFAULTS };

  const result: VerificationConfig = { ...DEFAULTS };
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^#{1,4} /.test(line)) break;
    const m = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    const [, key, rawValue] = m;
    const value = (rawValue ?? "").trim();
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
      default:
        throw new MalformedVerificationConfigError(
          key!,
          value,
          "the ## Verification key set is closed to {verify_skill, verify_mode}",
        );
    }
  }
  return result;
}
