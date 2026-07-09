// deps_research_disposition_contract (STE-373 AC-STE-373.7) —
// /gate-check probe #65. Severity: error.
//
// Byte-checks the DEFINITION-LEVEL deps-research skip-disposition contract
// on the two parent skills that fork the deps-research subagent. Colocated
// sibling of the #51 `deps_researcher_subagent_invariants` probe; reuses the
// shared IntegrityReport/IntegrityViolation shape + NFR-10 message builder
// pattern from `adapters/_shared/src/tdd_probe_helpers.ts`.
//
// Asserts:
//   (a) both skip tokens `deps_research_skipped_no_manifest` /
//       `deps_research_skipped_no_tech` are registered in
//       CANONICAL_CAPABILITY_KEYS (guard against silent de-registration);
//   (b) the MUST-emit disposition directive AND the anti-cascade rule are
//       present in BOTH skills/brainstorm/SKILL.md and skills/spec-write/SKILL.md;
//   (c) no `deps_research_skipped_*` token name introduced in a parent skill
//       encodes `compromised` / `injected` / `disabled` state.
//
// Vacuous when the plugin skills tree is absent (neither parent SKILL.md
// exists). The behavioral companion to this source-level probe is the FR's
// smoke AC — this probe catches drift where the directive itself, the
// anti-cascade rule, or the token registry goes missing from skill prose.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  pushViolation as pushViolationShared,
  type IntegrityReport,
  type IntegrityViolation,
  type Severity,
} from "./tdd_probe_helpers";
import { CANONICAL_CAPABILITY_KEYS } from "./closing_summary_capability_keys";

export type { IntegrityReport, IntegrityViolation, Severity };

// The two legal-skip disposition tokens introduced by M100. Both MUST be
// registered in CANONICAL_CAPABILITY_KEYS and carry a MUST-emit directive in
// each parent skill.
const SKIP_TOKENS: ReadonlyArray<string> = [
  "deps_research_skipped_no_manifest",
  "deps_research_skipped_no_tech",
];

// The two parent skills that fork the deps-research subagent.
const PARENT_SKILLS: ReadonlyArray<string> = ["brainstorm", "spec-write"];

// A `deps_research`-prefixed token whose name encodes compromised/injected/
// disabled state. The `deps_research` + `[a-z_]*` prefix requirement keeps
// this from false-positiving on legitimate anti-cascade prose such as
// `holds no "fork compromised" state` or `never disables the fork` — the
// forbidden word must be part of a `deps_research`-prefixed token.
const FORBIDDEN_TOKEN_RE = /deps_research[a-z_]*(compromised|injected|disabled)/;

// The anti-cascade rule: a shape violation drops THIS seed and continues; it
// never disables the fork and carries no cross-invocation belief about fork
// health. Either canonical phrasing satisfies the rule.
const ANTI_CASCADE_RE = /never disables the fork|no cross-invocation belief/i;

function mustEmitRe(token: string): RegExp {
  return new RegExp(`MUST emit\\s*\`${token}\``);
}

function buildMessage(noteBody: string, file: string): string {
  return [
    `deps_research_disposition_contract: ${noteBody}`,
    "Remedy: restore the definition-level disposition contract. Both parent " +
      "skills — `skills/brainstorm/SKILL.md` and `skills/spec-write/SKILL.md` " +
      "— MUST carry the literal MUST-emit directives " +
      "`MUST emit \\`deps_research_skipped_no_manifest\\`` and " +
      "`MUST emit \\`deps_research_skipped_no_tech\\``, an anti-cascade rule " +
      "(the fork `never disables the fork` / holds `no cross-invocation belief`), " +
      "and no forbidden `deps_research_skipped_*` token name encoding " +
      "compromised/injected/disabled state. The skip-token pair MUST also stay " +
      "registered in CANONICAL_CAPABILITY_KEYS " +
      "(adapters/_shared/src/closing_summary_capability_keys.ts).",
    `Context: file=${file}, probe=deps_research_disposition_contract, severity=error`,
  ].join("\n");
}

function pushViolation(
  out: IntegrityViolation[],
  projectRoot: string,
  absFile: string,
  line: number,
  reason: string,
): void {
  pushViolationShared(out, projectRoot, absFile, line, reason, buildMessage);
}

export async function runDepsResearchDispositionContractProbe(
  projectRoot: string,
): Promise<IntegrityReport> {
  const skillsBase = join(
    projectRoot,
    "plugins",
    "dev-process-toolkit",
    "skills",
  );
  const skillPaths = PARENT_SKILLS.map((name) => ({
    name,
    path: join(skillsBase, name, "SKILL.md"),
  }));

  // Vacuous when neither parent skill's SKILL.md exists (plugin skills tree
  // absent). Mirrors the #51 deps_researcher_invariants vacuous early-return.
  if (!skillPaths.some((s) => existsSync(s.path))) {
    return { violations: [], vacuous: true };
  }

  const violations: IntegrityViolation[] = [];

  // Check (a): both skip tokens registered in CANONICAL_CAPABILITY_KEYS.
  // In practice both are registered, so this never fires — but the byte-check
  // guards against a silent de-registration that would strip the tokens from
  // the closing-summary directive-coverage invariant.
  const registered = new Set<string>(CANONICAL_CAPABILITY_KEYS);
  const unregistered = SKIP_TOKENS.filter((t) => !registered.has(t));
  if (unregistered.length > 0) {
    pushViolation(
      violations,
      projectRoot,
      join(
        projectRoot,
        "adapters",
        "_shared",
        "src",
        "closing_summary_capability_keys.ts",
      ),
      1,
      `skip disposition token(s) ${unregistered
        .map((t) => `\`${t}\``)
        .join(", ")} missing from CANONICAL_CAPABILITY_KEYS`,
    );
  }

  // Checks (b) + (c): per parent skill body.
  for (const { path } of skillPaths) {
    if (!existsSync(path)) continue;
    let body: string;
    try {
      body = readFileSync(path, "utf-8");
    } catch (err) {
      pushViolation(
        violations,
        projectRoot,
        path,
        1,
        `parent skill SKILL.md is not readable: ${(err as Error).message}`,
      );
      continue;
    }

    // Check (b): each MUST-emit disposition directive.
    for (const token of SKIP_TOKENS) {
      if (!mustEmitRe(token).test(body)) {
        pushViolation(
          violations,
          projectRoot,
          path,
          1,
          `missing MUST-emit disposition directive "MUST emit \`${token}\`"`,
        );
      }
    }

    // Check (b): the anti-cascade rule.
    if (!ANTI_CASCADE_RE.test(body)) {
      pushViolation(
        violations,
        projectRoot,
        path,
        1,
        `missing anti-cascade rule ("never disables the fork" / ` +
          `"no cross-invocation belief")`,
      );
    }

    // Check (c): forbidden skip-disposition token name.
    const forbidden = FORBIDDEN_TOKEN_RE.exec(body);
    if (forbidden) {
      pushViolation(
        violations,
        projectRoot,
        path,
        1,
        `forbidden deps_research_skipped_* token name encodes ` +
          `"${forbidden[1]}" state — token names encoding ` +
          `compromised/injected/disabled state are forbidden`,
      );
    }
  }

  return { violations, vacuous: false };
}
