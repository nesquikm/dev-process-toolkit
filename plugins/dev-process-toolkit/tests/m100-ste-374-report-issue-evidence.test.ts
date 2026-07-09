// Meta-tests for STE-374 — /report-issue evidence gate (M100).
//
// Prose + registry contracts asserted (the LLM consumes these when running the
// skill; the const feeds /gate-check's closing_summary_capability_keys probe):
//   - AC-STE-374.1: skills/report-issue/SKILL.md wires selectIncidentSession
//     (K-most-recent marker-matched selection with the mtime pick as fallback).
//   - AC-STE-374.2: the two selection-path keys are registered in
//     CANONICAL_CAPABILITY_KEYS + rendered in /spec-write § 7's static map;
//     report-issue wires the emission and states exactly one fires per run.
//   - AC-STE-374.3: skills/report-issue/SKILL.md wires verifyIncidentEvidence
//     before the publish step.
//   - AC-STE-374.4: § 6 (metadata.json shape) documents the `verification`
//     block + `verified` field, and the cap rule (high/critical + not-found =>
//     cap) prose is present; low/medium are never capped.
//   - AC-STE-374.5: the two verification keys are registered + rendered in the
//     § 7 map, with literal `MUST emit` directives in report-issue SKILL.md.
//   - AC-STE-374.6: report-issue states the evidence gate is advisory /
//     never-blocking (the publish still proceeds on the unverified path).
//
// IMPORTANT: assertions are phrase/token literals only — never STE-/AC-namespace
// tokens in skills/** prose (the shipped-prose ceiling test caps those counts).

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CANONICAL_CAPABILITY_KEYS } from "../adapters/_shared/src/closing_summary_capability_keys";
import { specWriteStep7Map } from "./_skill-md";

const pluginRoot = join(import.meta.dir, "..");

function readSkill(name: string): string {
  return readFileSync(join(pluginRoot, "skills", name, "SKILL.md"), "utf-8");
}

const reportIssueBody = readSkill("report-issue");
const specWriteBody = readSkill("spec-write");

// The four new capability keys.
const SESSION_MATCHED = "report_issue_session_matched_marker";
const SESSION_FALLBACK = "report_issue_session_fallback_mtime";
const CAPPED = "report_issue_severity_capped_unverified";
const VERIFIED = "report_issue_evidence_verified";
const ALL_KEYS = [SESSION_MATCHED, SESSION_FALLBACK, CAPPED, VERIFIED];

// Directive shape matching /gate-check's closing_summary_capability_keys probe
// (buildMustEmitRegex): literal backticked token — paraphrase does not satisfy.
function mustEmitRe(key: string): RegExp {
  return new RegExp(`MUST emit\\s*\`${key}\``);
}

/** report-issue § 6 (Compose the gist payload / metadata.json shape). */
function reportIssueSection6(): string {
  const start = reportIssueBody.indexOf("### 6.");
  expect(start).toBeGreaterThan(-1);
  const end = reportIssueBody.indexOf("### 7.", start);
  expect(end).toBeGreaterThan(start);
  return reportIssueBody.slice(start, end);
}

// -----------------------------------------------------------------------------
// AC-STE-374.1 — incident-session selection wired in report-issue.
// -----------------------------------------------------------------------------

describe("AC-STE-374.1 — selectIncidentSession wired into session selection", () => {
  test("report-issue SKILL.md wires the selectIncidentSession helper", () => {
    expect(reportIssueBody).toContain("selectIncidentSession");
  });

  test("report-issue documents marker-matched selection with the mtime pick as fallback", () => {
    expect(reportIssueBody).toMatch(/marker[- ]match/i);
    expect(reportIssueBody).toMatch(/fallback/i);
  });
});

// -----------------------------------------------------------------------------
// AC-STE-374.2 — selection-path tokens registered + rendered + wired.
// -----------------------------------------------------------------------------

describe("AC-STE-374.2 — selection-path tokens", () => {
  test("both selection keys registered in CANONICAL_CAPABILITY_KEYS", () => {
    const keys = [...CANONICAL_CAPABILITY_KEYS] as string[];
    expect(keys).toContain(SESSION_MATCHED);
    expect(keys).toContain(SESSION_FALLBACK);
  });

  test("both selection keys rendered (backticked) in the /spec-write § 7 map", () => {
    const map = specWriteStep7Map(specWriteBody);
    expect(map).toContain(`\`${SESSION_MATCHED}\``);
    expect(map).toContain(`\`${SESSION_FALLBACK}\``);
  });

  test("report-issue wires both selection tokens (backticked) into its emission site", () => {
    expect(reportIssueBody).toContain(`\`${SESSION_MATCHED}\``);
    expect(reportIssueBody).toContain(`\`${SESSION_FALLBACK}\``);
  });

  test("report-issue states exactly one selection token emits per run", () => {
    expect(reportIssueBody).toMatch(/exactly one/i);
  });
});

// -----------------------------------------------------------------------------
// AC-STE-374.3 — evidence verification wired before publish.
// -----------------------------------------------------------------------------

describe("AC-STE-374.3 — verifyIncidentEvidence wired before the publish step", () => {
  test("report-issue SKILL.md wires the verifyIncidentEvidence helper", () => {
    expect(reportIssueBody).toContain("verifyIncidentEvidence");
  });

  test("the evidence check is described as running before the gist upload", () => {
    const checkIdx = reportIssueBody.indexOf("verifyIncidentEvidence");
    const publishIdx = reportIssueBody.indexOf("gh gist create");
    expect(checkIdx).toBeGreaterThan(-1);
    expect(publishIdx).toBeGreaterThan(-1);
    expect(checkIdx).toBeLessThan(publishIdx);
  });
});

// -----------------------------------------------------------------------------
// AC-STE-374.4 — verification block + verified field + cap rule prose.
// -----------------------------------------------------------------------------

describe("AC-STE-374.4 — verification metadata + severity cap rule", () => {
  test("§ 6 metadata.json shape documents the `verified` field", () => {
    expect(reportIssueSection6()).toContain("verified");
  });

  test("§ 6 metadata.json shape documents the `verification` block (searched/found/markers)", () => {
    const section = reportIssueSection6();
    expect(section).toContain("verification");
    expect(section).toMatch(/searched[\s\S]{0,120}found[\s\S]{0,120}markers/);
  });

  test("the cap rule (high/critical + not-found => cap) prose is present", () => {
    expect(reportIssueBody).toMatch(/high[\s\S]{0,20}critical/i);
    expect(reportIssueBody).toMatch(/cap/i);
    expect(reportIssueBody).toMatch(/unverified/i);
  });

  test("low/medium reports carry the verification block but are never capped", () => {
    expect(reportIssueBody).toMatch(/low[\s\S]{0,20}medium/i);
    expect(reportIssueBody).toMatch(/never[\s\S]{0,40}cap/i);
  });
});

// -----------------------------------------------------------------------------
// AC-STE-374.5 — verification tokens registered + rendered + MUST-emit.
// -----------------------------------------------------------------------------

describe("AC-STE-374.5 — verification tokens", () => {
  test("both verification keys registered in CANONICAL_CAPABILITY_KEYS", () => {
    const keys = [...CANONICAL_CAPABILITY_KEYS] as string[];
    expect(keys).toContain(CAPPED);
    expect(keys).toContain(VERIFIED);
  });

  test("both verification keys rendered (backticked) in the /spec-write § 7 map", () => {
    const map = specWriteStep7Map(specWriteBody);
    expect(map).toContain(`\`${CAPPED}\``);
    expect(map).toContain(`\`${VERIFIED}\``);
  });

  test("report-issue carries the literal MUST-emit directive for the cap token", () => {
    expect(reportIssueBody).toMatch(mustEmitRe(CAPPED));
  });

  test("report-issue carries the literal MUST-emit directive for the verified token", () => {
    expect(reportIssueBody).toMatch(mustEmitRe(VERIFIED));
  });
});

// -----------------------------------------------------------------------------
// AC-STE-374.6 — advisory, never blocking.
// -----------------------------------------------------------------------------

describe("AC-STE-374.6 — evidence gate is advisory, never blocking", () => {
  test("report-issue states the evidence gate is advisory / never-blocking", () => {
    expect(reportIssueBody).toMatch(/advisory/i);
    expect(reportIssueBody).toMatch(
      /never block|not block|does not block|nothing aborts|still (?:publish|proceed|upload)/i,
    );
  });

  test("report-issue states the publish still proceeds on the unverified path", () => {
    expect(reportIssueBody).toMatch(/unverified/i);
    expect(reportIssueBody).toMatch(
      /still (?:publish|proceed|upload)|publish(?:es)? on the unverified|maintainer still receives/i,
    );
  });
});

// -----------------------------------------------------------------------------
// AC-STE-374.2 / .5 combined — all four keys registered + rendered.
// -----------------------------------------------------------------------------

describe("STE-374 — all four new keys present in registry + § 7 map", () => {
  test("CANONICAL_CAPABILITY_KEYS registers every new STE-374 key", () => {
    const keys = [...CANONICAL_CAPABILITY_KEYS] as string[];
    for (const k of ALL_KEYS) {
      expect(keys).toContain(k);
    }
  });

  test("the /spec-write § 7 map renders every new STE-374 key (backticked)", () => {
    const map = specWriteStep7Map(specWriteBody);
    for (const k of ALL_KEYS) {
      expect(map).toContain(`\`${k}\``);
    }
  });
});
