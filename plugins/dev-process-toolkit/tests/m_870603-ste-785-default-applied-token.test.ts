// STE-785 (M_870603) — an auto-approved spec commit carries its audit token.
//
// On the marker-approved (`PRESENT`) branch of the /spec-write § 7a commit
// gate, the run emitted `spec_write_commit_default_applied` only as a row in
// the Step 7 closing summary. Probe #45 (socratic_first_turn_post_hoc_drift)
// reads the HEAD commit BODY, so every auto-approved spec commit failed the
// gate. The fix tells the PRESENT branch to write the token into the commit
// body as well.
//
// Synthetic ids only (STE-1); temp git repos only.

import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSocraticFirstTurnPostHocDriftProbe } from "../adapters/_shared/src/socratic_first_turn_post_hoc_drift";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const SPEC_WRITE_SKILL = join(PLUGIN_ROOT, "skills/spec-write/SKILL.md");

const DEFAULT_TOKEN = "spec_write_commit_default_applied";
const OPERATOR_TOKEN = "spec_write_commit_operator_approved";
const SUBJECT = "chore(specs): write FR STE-1";

const BODY_RE = /commit body|body of the commit|into the body|in the body/i;
const SUMMARY_RE = /Step 7/;

const tempDirs: string[] = [];
afterEach(() => {
  while (tempDirs.length > 0) {
    const d = tempDirs.pop();
    if (d) rmSync(d, { recursive: true, force: true });
  }
});

function git(cwd: string, args: string[]): string {
  return execFileSync(
    "git",
    [
      "-c", "core.hooksPath=/dev/null",
      "-c", "commit.gpgsign=false",
      "-c", "user.name=Test",
      "-c", "user.email=test@example.invalid",
      ...args,
    ],
    { cwd, encoding: "utf-8" },
  );
}

/** Temp repo whose HEAD commit carries `subject` + `body`. */
function repoWithHeadCommit(subject: string, body: string): string {
  const dir = mkdtempSync(join(tmpdir(), "ste785-"));
  tempDirs.push(dir);
  git(dir, ["init", "-q"]);
  const msgFile = join(dir, ".commit-msg.txt");
  writeFileSync(msgFile, `${subject}\n\n${body}\n`);
  git(dir, ["commit", "-q", "--allow-empty", "-F", msgFile]);
  rmSync(msgFile);
  return dir;
}

/** The § 7a section of the skill text, or null when absent. */
function section7a(skillText: string): string | null {
  const start = skillText.indexOf("### 7a.");
  if (start < 0) return null;
  const end = skillText.indexOf("\n### 7. ", start);
  if (end < 0) return null;
  return skillText.slice(start, end);
}

/** The § 7a `PRESENT` bullet, or null. */
function presentBullet(skillText: string): string | null {
  const s = section7a(skillText);
  if (s === null) return null;
  return s.split("\n").find((l) => l.startsWith("- `PRESENT`")) ?? null;
}

/** The interactive-yes branch text of § 7a (between `on y` and `on n`), or null. */
function interactiveYesBranch(skillText: string): string | null {
  const s = section7a(skillText);
  if (s === null) return null;
  const tty = s
    .split("\n")
    .find((l) => l.startsWith("- `ABSENT`") && l.includes("isTTY === true"));
  if (!tty) return null;
  const y = tty.indexOf("on `y`");
  const n = tty.indexOf("on `n`");
  if (y < 0 || n < 0 || n < y) return null;
  return tty.slice(y, n);
}

/**
 * Prose pin for AC-STE-785.1 / .3 — empty means the § 7a PRESENT bullet
 * tells the run to write the default-applied token into the commit body AND
 * keeps the Step 7 summary row.
 */
function presentBranchPinProblems(skillText: string): string[] {
  const bullet = presentBullet(skillText);
  if (bullet === null) return ["§ 7a PRESENT bullet not found"];
  const problems: string[] = [];
  if (!bullet.includes(`\`${DEFAULT_TOKEN}\``)) {
    problems.push(`PRESENT bullet does not name \`${DEFAULT_TOKEN}\``);
  }
  if (!BODY_RE.test(bullet)) {
    problems.push("PRESENT bullet does not name the commit body");
  }
  if (!SUMMARY_RE.test(bullet)) {
    problems.push("PRESENT bullet dropped the Step 7 summary row");
  }
  return problems;
}

describe("AC-STE-785.1 — § 7a PRESENT branch writes the token into the commit body", () => {
  test("AC-STE-785.1: the PRESENT bullet names the commit body and keeps the Step 7 summary row", () => {
    const skill = readFileSync(SPEC_WRITE_SKILL, "utf-8");
    expect(presentBranchPinProblems(skill)).toEqual([]);
  });

  test("AC-STE-785.1: the interactive `y` branch keeps spec_write_commit_operator_approved", () => {
    const skill = readFileSync(SPEC_WRITE_SKILL, "utf-8");
    const yes = interactiveYesBranch(skill);
    expect(yes).not.toBeNull();
    expect(yes!).toContain(`\`${OPERATOR_TOKEN}\``);
    expect(yes!).not.toContain(DEFAULT_TOKEN);
  });

  test("AC-STE-785.1: the PRESENT bullet does not name the operator-approval token", () => {
    const skill = readFileSync(SPEC_WRITE_SKILL, "utf-8");
    const bullet = presentBullet(skill);
    expect(bullet).not.toBeNull();
    expect(bullet!).not.toContain(OPERATOR_TOKEN);
  });
});

describe("AC-STE-785.2 — probe #45 on a real git repo", () => {
  test("AC-STE-785.2: a spec commit whose body carries spec_write_commit_default_applied passes probe #45", async () => {
    const body = ["Writes the FR.", "", DEFAULT_TOKEN, "", "Refs: STE-1"].join("\n");
    const repo = repoWithHeadCommit(SUBJECT, body);
    const report = await runSocraticFirstTurnPostHocDriftProbe(repo);
    expect(report.violations).toEqual([]);
  });

  test("AC-STE-785.2: the same commit without the token line fails probe #45", async () => {
    const body = ["Writes the FR.", "", "Refs: STE-1"].join("\n");
    const repo = repoWithHeadCommit(SUBJECT, body);
    const report = await runSocraticFirstTurnPostHocDriftProbe(repo);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]?.capability).toBe("socratic_first_turn_post_hoc_drift_violation");
    expect(report.violations[0]?.subject).toBe(SUBJECT);
  });
});

describe("AC-STE-785.3 — the pin reddens when the PRESENT branch stops naming the commit body", () => {
  test("AC-STE-785.3: stripping the commit-body instruction from the shipped PRESENT bullet reddens the pin", () => {
    const skill = readFileSync(SPEC_WRITE_SKILL, "utf-8");
    const bullet = presentBullet(skill);
    expect(bullet).not.toBeNull();
    // Guard: the live bullet must name the body, or the mutation proves nothing.
    expect(BODY_RE.test(bullet!)).toBe(true);
    const stripped = bullet!.replace(new RegExp(BODY_RE.source, "gi"), "elsewhere");
    expect(stripped).not.toBe(bullet);
    const mutated = skill.replace(bullet!, stripped);
    expect(presentBranchPinProblems(mutated)).toContain(
      "PRESENT bullet does not name the commit body",
    );
  });

  test("AC-STE-785.3: the pin flags the pre-fix PRESENT bullet (summary-only wording)", () => {
    const preFix =
      "### 7a. Stage\n\n" +
      "- `PRESENT` → call `requireOrRefuse(..., markerPresent: true, defaultValue: \"y\", ...)` → outcome `default-applied` → commit with the canonical subject (STE-109 UX) → **MUST emit `spec_write_commit_default_applied`** (literal token, not paraphrased — STE-238 AC.1) as a row in the Step 7 summary so the operator sees the auto-apply on every quiet-mode run (interactive `y` does not emit the row).\n" +
      "\n### 7. Closing\n";
    expect(presentBranchPinProblems(preFix)).toEqual([
      "PRESENT bullet does not name the commit body",
    ]);
  });
});
