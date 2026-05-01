import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// STE-176 — /smoke-test coverage extension. Doc-conformance: pre-flight #9
// Jira-only ghost detector + Phase 2 stand-alone Jira comment-path probe
// (closes AC-STE-154.9 AC 6).

const repoRoot = join(import.meta.dir, "..", "..", "..");
const skillPath = join(repoRoot, ".claude", "skills", "smoke-test", "SKILL.md");

function readSkillIfPresent(): string | null {
  if (!existsSync(skillPath)) return null;
  return readFileSync(skillPath, "utf8");
}

const skill = readSkillIfPresent();
const describeIfPresent = skill === null ? describe.skip : describe;

describeIfPresent("STE-176 AC-STE-176.1 — pre-flight #9 ghost detector (Jira-only)", () => {
  test("pre-flight #9 heading exists and is Jira-only", () => {
    const body = skill!;
    expect(body).toMatch(/9\.\s*\*\*\(Jira-only\)/i);
  });

  test("pre-flight #9 names the canonical JQL filter", () => {
    const body = skill!;
    expect(body).toMatch(/labels\s*=\s*"dpt-smoke"/);
    expect(body).toMatch(/status\s*!=\s*"Done"/);
  });

  test("pre-flight #9 warns instead of refusing — does not block the run", () => {
    const body = skill!;
    // The probe must explicitly say "warn", not refuse, so the run continues.
    expect(body).toMatch(/warn(s|ing)? \(does not refuse\)|warn.*does not refuse|warn.*continues|does not refuse/i);
  });

  test("pre-flight #9 surfaces the canonical output line shape", () => {
    const body = skill!;
    expect(body).toContain(
      "orphaned dpt-smoke items in",
    );
    expect(body).toMatch(/consider one-time sweep before next run/i);
  });

  test("pre-flight #9 skips entirely on the Linear path", () => {
    const body = skill!;
    expect(body).toMatch(/Linear[\s-].*skip|Linear path skips the probe/i);
  });
});

describeIfPresent("STE-176 AC-STE-176.2 — Phase 2 stand-alone Jira comment probe", () => {
  test("Phase 2 carries a Jira-only comment-path step", () => {
    const body = skill!;
    expect(body).toMatch(/Comment-path probe \(Jira-only\)/i);
  });

  test("comment probe invokes mcp__atlassian__addCommentToJiraIssue", () => {
    const body = skill!;
    expect(body).toContain("mcp__atlassian__addCommentToJiraIssue");
  });

  test("comment-body template references AC-STE-154.9 AC 6 coverage explicitly", () => {
    const body = skill!;
    // The body shape from the FR.
    expect(body).toMatch(/Smoke probe — AC-STE-154\.9 AC 6 coverage/);
  });

  test("comment probe is skipped on the Linear branch", () => {
    const body = skill!;
    // The probe is gated on `--tracker jira`; the prose must say so.
    expect(body).toMatch(/Linear branch.*skip|skipped on the Linear|fires only when.*--tracker jira/i);
  });
});
