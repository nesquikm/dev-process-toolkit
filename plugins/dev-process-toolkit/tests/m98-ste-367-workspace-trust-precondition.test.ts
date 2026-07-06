import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// M98 STE-367 — workspace-trust becomes an OPERATOR PRECONDITION (assert +
// refuse, no self-write). STE-356 had /smoke-test Phase 1 step 6b WRITE
// `hasTrustDialogAccepted:true` into the live ~/.claude-st/.claude.json (backup
// + spinlock + jq read-merge-write + atomic mv), and Phase 5 teardown REMOVE it
// (jq del + backup rm). The harness auto-mode self-modification classifier
// reliably denies that write under `claude -p` (2026-07-04 conformance F1), so
// the hands-off loop could not self-seed trust. STE-367 removes the write and
// the teardown-removal; the driver ASSERTS trust is present (operator-seeded)
// and refuses with the jq seed one-liner as the remedy if absent.
//
// AC-STE-367.1 — step 6b no longer writes: the seed spinlock + live-config
//   backup are gone; the workspace-trust gate asserts via `jq -e … == true`.
// AC-STE-367.2 — /conformance-loop gains a pre-flight asserting BOTH test-project
//   paths are trusted, refusing (NFR-10) with the jq remedy if either absent.
// AC-STE-367.3 — refusal hands the operator the jq seed one-liner; the hit path
//   logs `workspace_trust_present` (renamed from `workspace_trust_seeded`).
// AC-STE-367.4 — Phase 5 teardown no longer del's the trust entry or rm's the
//   step-6b backup (operator-owned, persistent trust across runs).
// AC-STE-367.5 is runtime-deferred [~] — no test here.

const repoRoot = join(import.meta.dir, "..", "..", "..");
const skillPath = join(repoRoot, ".claude", "skills", "smoke-test", "SKILL.md");
const conformanceLoopPath = join(
  repoRoot,
  ".claude",
  "skills",
  "conformance-loop",
  "SKILL.md",
);

function readIfPresent(path: string): string | null {
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8");
}

const skill = readIfPresent(skillPath);
const describeIfPresent = skill === null ? describe.skip : describe;

const conformanceLoop = readIfPresent(conformanceLoopPath);
const describeIfConformanceLoopPresent =
  conformanceLoop === null ? describe.skip : describe;

function sectionSlice(
  body: string,
  startMarker: string,
  endMarker: string,
): string {
  const start = body.indexOf(startMarker);
  if (start === -1) return "";
  const end = body.indexOf(endMarker, start + startMarker.length);
  return end === -1 ? body.slice(start) : body.slice(start, end);
}

// § Workspace-trust spawn gate — the assert + refusal + token home.
function spawnGateSlice(body: string): string {
  return sectionSlice(
    body,
    "#### Workspace-trust spawn gate",
    "#### Grandchild spawn lifecycle",
  );
}

// § conformance-loop pre-flight refusals block.
function preflightSlice(body: string): string {
  return sectionSlice(body, "## Pre-flight refusals", "## Flow");
}

// ---------------------------------------------------------------------------
// AC-STE-367.1 — step 6b asserts, does not write
// ---------------------------------------------------------------------------

describeIfPresent("AC-STE-367.1 — /smoke-test workspace trust is asserted, not written", () => {
  test("the trust-seed spinlock is gone (no `/tmp/dpt-claude-json.lock` mutex anywhere in the driver)", () => {
    // The mkdir spinlock existed ONLY to serialize the seed write + the
    // teardown del — both removed by STE-367.
    expect(skill!).not.toContain("dpt-claude-json.lock");
  });

  test("the live-config backup is gone (no `claude-json.bak` — the driver never writes, so nothing to back up)", () => {
    expect(skill!).not.toContain("claude-json.bak");
  });

  test("no jq read-merge-write of hasTrustDialogAccepted is EXECUTED by the driver (the merge only appears inside the operator remedy)", () => {
    // The forced-true merge-write assignment form. It may appear once, inside
    // the refusal's operator remedy; it must NOT appear as an executed step
    // with the seed spinlock/backup (asserted above). Here we pin that the
    // driver's own step 6b prose no longer describes itself as writing.
    const gate = spawnGateSlice(skill!);
    expect(gate.length).toBeGreaterThan(0);
    expect(gate).toMatch(/jq -e[\s\S]{0,200}hasTrustDialogAccepted == true/);
  });

  test("the gate is a read-only assertion positioned before the first Phase 2 spawn discipline", () => {
    const probeIdx = skill!.indexOf("hasTrustDialogAccepted == true");
    const phase1Idx = skill!.indexOf("### Phase 1 — Setup");
    const disciplineIdx = skill!.indexOf("#### Phase 2 child-spawn discipline");
    expect(probeIdx).toBeGreaterThan(-1);
    expect(phase1Idx).toBeGreaterThan(-1);
    expect(disciplineIdx).toBeGreaterThan(-1);
    expect(probeIdx).toBeGreaterThan(phase1Idx);
    expect(probeIdx).toBeLessThan(disciplineIdx);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-367.3 — refusal remedy + renamed hit-path token
// ---------------------------------------------------------------------------

describeIfPresent("AC-STE-367.3 — refusal hands the jq seed remedy; hit logs workspace_trust_present", () => {
  test("the hit path logs the renamed `workspace_trust_present` token", () => {
    expect(skill!).toContain("workspace_trust_present");
  });

  test("the old `workspace_trust_seeded` token is gone from the driver SKILL.md", () => {
    expect(skill!).not.toContain("workspace_trust_seeded");
  });

  test("the refusal remedy hands the operator the jq seed one-liner (seed trust once, then re-run)", () => {
    const gate = spawnGateSlice(skill!);
    expect(gate).toMatch(/Remedy:[\s\S]{0,400}hasTrustDialogAccepted/);
    expect(gate).toMatch(/Remedy:[\s\S]{0,400}jq/);
  });

  test("the refusal Context line still carries skill=smoke-test, pre-flight=workspace_trust_check", () => {
    const gate = spawnGateSlice(skill!);
    expect(gate).toMatch(
      /Context:[^\n]*skill=smoke-test[^\n]*pre-flight=workspace_trust_check/,
    );
  });
});

// ---------------------------------------------------------------------------
// AC-STE-367.4 — Phase 5 teardown no longer removes trust
// ---------------------------------------------------------------------------

describeIfPresent("AC-STE-367.4 — Phase 5 teardown no longer removes the trust entry", () => {
  test("teardown does not `del(.projects[…])` the trust entry (operator-owned now)", () => {
    expect(skill!).not.toMatch(/del\(\s*\.projects\[/);
  });

  test("teardown documents that trust is operator-owned / persistent across runs (STE-367)", () => {
    const phase5 = sectionSlice(skill!, "### Phase 5 — Teardown", "### Phase 8");
    expect(phase5.length).toBeGreaterThan(0);
    expect(phase5).toMatch(/operator-owned|persistent|STE-367/);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-367.2 — /conformance-loop up-front trust precondition
// ---------------------------------------------------------------------------

describeIfConformanceLoopPresent("AC-STE-367.2 — /conformance-loop pre-flight asserts both test paths trusted", () => {
  test("a pre-flight asserts BOTH dpt-test-project paths are trusted (hasTrustDialogAccepted)", () => {
    const pf = preflightSlice(conformanceLoop!);
    expect(pf.length).toBeGreaterThan(0);
    expect(pf).toContain("hasTrustDialogAccepted");
    expect(pf).toMatch(/dpt-test-project-linear/);
    expect(pf).toMatch(/dpt-test-project-jira/);
  });

  test("the trust pre-flight refuses (NFR-10 canonical refusal) with the jq seed remedy when trust is absent", () => {
    const pf = preflightSlice(conformanceLoop!);
    expect(pf).toContain("NFR-10 canonical refusal");
    expect(pf).toMatch(
      /hasTrustDialogAccepted[\s\S]{0,500}jq|jq[\s\S]{0,500}hasTrustDialogAccepted/,
    );
  });
});
