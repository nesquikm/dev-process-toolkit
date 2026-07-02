import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// STE-352 — prose-conformance tests for the /smoke-test SKILL.md contract
// (M94: detect the 0-byte-grandchild false-green that hid STE-350).
//
// AC-STE-352.1: Phase 2 canonical-chain child capture uses
//   `--output-format stream-json` and parses the NDJSON via the existing
//   parseStreamJsonTranscript path, so per-probe rows and forked
//   `tdd-result` fences are parseable (F2 text-mode blind spot closed).
//
// AC-STE-352.2: after each child returns, the driver asserts non-empty
//   (`wc -c` > 0) and non-denied (no `permission_denials` entry whose
//   command head is `claude`) output; either condition is a high-severity
//   finding with the canonical diagnostic
//     STE-350 regression: nested claude -p spawn denied/empty — <child>
//
// AC-STE-352.3: a Phase 2.X fixture group (SUT = STE-350, per the
//   `STE-<sut> runtime regression: <fixture-name>` convention) reproduces a
//   nested `claude -p` spawn, asserts non-empty completion under the
//   patched allow-list, and carries a negative variant (pattern removed ⇒
//   the denial is caught). The live-runtime leg is smoke-validated; these
//   tests pin the documented fixture contract.

const repoRoot = join(import.meta.dir, "..", "..", "..");
const skillPath = join(repoRoot, ".claude", "skills", "smoke-test", "SKILL.md");

function readSkillIfPresent(): string | null {
  if (!existsSync(skillPath)) return null;
  return readFileSync(skillPath, "utf8");
}

const skill = readSkillIfPresent();
const describeIfPresent = skill === null ? describe.skip : describe;

function sectionSlice(
  body: string,
  startMarker: string,
  endMarker: string,
): string {
  const start = body.indexOf(startMarker);
  if (start === -1) return "";
  const end = body.indexOf(endMarker, start);
  return end === -1 ? body.slice(start) : body.slice(start, end);
}

// Phase 2 proper (the canonical-chain child spawns + per-child capture),
// excluding Phase 2.X (the regression-fixture library) and Phase 8 (which
// already uses stream-json and must not satisfy the Phase 2 assertions).
function phase2Slice(body: string): string {
  return sectionSlice(
    body,
    "### Phase 2 — Run the canonical chain",
    "### Phase 2.X",
  );
}

// The new Phase 2.X group whose SUT is STE-350 (group number unpinned —
// the convention is `#### Fixture group <N> — STE-<sut> …`).
function ste350GroupSlice(body: string): string {
  const match = body.match(
    /#### Fixture group \d+ — STE-350[^\n]*\n[\s\S]*?(?=\n#### |\n### |$)/,
  );
  return match ? match[0] : "";
}

const DIAG_PREFIX = "STE-350 regression: nested claude -p spawn denied/empty — ";

describeIfPresent("AC-STE-352.1 — Phase 2 canonical-chain capture is stream-json", () => {
  test("child spawns capture via --output-format stream-json (not default text mode)", () => {
    const phase2 = phase2Slice(skill!);
    expect(phase2.length).toBeGreaterThan(0);
    expect(phase2).toContain("--output-format stream-json");
  });

  test("the captured NDJSON is parsed via the existing parseStreamJsonTranscript path", () => {
    const phase2 = phase2Slice(skill!);
    expect(phase2).toContain("parseStreamJsonTranscript");
  });
});

describeIfPresent("AC-STE-352.2 — non-empty / non-denied assertion after each child", () => {
  test("Phase 2 documents the non-empty check (wc -c on the child capture)", () => {
    const phase2 = phase2Slice(skill!);
    expect(phase2).toMatch(/wc -c/);
    expect(phase2).toMatch(/non-empty|0[- ]byte/i);
  });

  test("Phase 2 documents the permission_denials check for a nested claude spawn", () => {
    const phase2 = phase2Slice(skill!);
    expect(phase2).toContain("permission_denials");
  });

  test("the canonical STE-350 diagnostic shape is documented and marked high severity", () => {
    const body = skill!;
    const idx = body.indexOf(DIAG_PREFIX);
    expect(idx).toBeGreaterThanOrEqual(0);

    // The finding must be a hard (high-severity) finding, and any rendered
    // severity line must use the canonical `**Severity:** high` form
    // (STE-295: colon inside the bold span, level word outside).
    const vicinity = body.slice(Math.max(0, idx - 600), idx + 600);
    expect(vicinity).toMatch(/\*\*Severity:\*\* high|high[- ]severity/i);
    expect(body).not.toMatch(/\*\*Severity: high\*\*/);
  });
});

describeIfPresent("AC-STE-352.3 — Phase 2.X regression fixture group for SUT STE-350", () => {
  test("a Phase 2.X fixture group names STE-350 as the system-under-test", () => {
    expect(ste350GroupSlice(skill!).length).toBeGreaterThan(0);
  });

  test("the group reproduces a nested claude -p spawn and asserts non-empty completion under the allow-list", () => {
    const group = ste350GroupSlice(skill!);
    expect(group).toMatch(/nested/i);
    expect(group).toContain("claude -p");
    expect(group).toMatch(/non-empty/i);
    expect(group).toMatch(/allow[- ]?list|Bash\(claude:\*\)|permissions\.allow/);
  });

  test("a negative variant asserts the denial is caught when the allow pattern is removed", () => {
    const group = ste350GroupSlice(skill!);
    expect(group).toMatch(/removed|absent|omitted|without the (entry|pattern)/i);
    expect(group).toMatch(/denied|denial/i);
  });

  test("diagnostics follow the Phase 2.X SUT convention (STE-350, not the test FR STE-352)", () => {
    const body = skill!;
    expect(body).toMatch(/STE-350 runtime regression: /);
    expect(body).not.toMatch(/STE-352 runtime regression/i);
  });

  test("the group contributes a per-FR runtime-check summary line (both verdicts)", () => {
    const body = skill!;
    expect(body).toContain("STE-350 runtime check: PASS");
    expect(body).toContain("STE-350 runtime check: FAIL");
  });

  test("capture artifacts land under tests/fixtures/", () => {
    const group = ste350GroupSlice(skill!);
    expect(group).toMatch(/tests\/fixtures\//);
  });
});
