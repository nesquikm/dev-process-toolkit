import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// M96 "smoke-driver wait discipline" — prose-conformance meta-tests for the
// two project-local driver SKILL.mds. STE-357's pins live in
// smoke-driver-m96-wait-discipline.test.ts; this file carries STE-358.
//
// STE-358 — Verified Phase 0.5 wipe + freshness-gated chain-completeness
// checks (2026-07-02 iter-2 findings F2 + F6 — the driver self-reported
// "Phase 0.5 — PASS (scratch cleared)" while the morning run's per-skill
// logs survived on disk; a stale result-bearing log can false-pass the
// Phase 2.Y / Phase A chain-completeness checks, which had no freshness
// gating).
//
// AC-STE-358.1: the Phase 0.5 wipe is verified on disk — a post-`rm` `ls`
//   assertion (the wiped globs yield zero survivors) replaces self-report;
//   the wipe is widened to all per-run scratch artifacts (`.log`, `.pid`,
//   `.rc`, aux); the audit-trail exclusions (findings + approval) are
//   unchanged.
//
// AC-STE-358.2 (prose sites; unit coverage lives in
//   smoke-chain-integrity-freshness.test.ts): Phase 2.Y and
//   /conformance-loop Phase A pass the run-start timestamp captured at
//   Phase 0 acceptance into the chain-completeness check; a capture whose
//   mtime predates run-start is `capture stale (pre-run)`, never healthy.
//
// AC-STE-358.3: Phase 1 step 6 documents that the child model layer denies
//   ALL .claude/settings.json writes — full-file Write AND append-only
//   Edit — so no child-side merge path exists; the parent's pre-creation
//   must carry the FULL final allow-list; children can never extend it.

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
  const end = body.indexOf(endMarker, start);
  return end === -1 ? body.slice(start) : body.slice(start, end);
}

// § Phase 0.5 — the stale-scratch wipe block.
function phase05Slice(body: string): string {
  return sectionSlice(
    body,
    "### Phase 0.5 — Clear stale per-run scratch",
    "### Phase 1 — Setup",
  );
}

// § Phase 1 — setup steps; step 6 runs from its list marker to step 6b.
function phase1Slice(body: string): string {
  return sectionSlice(
    body,
    "### Phase 1 — Setup",
    "### Phase 2 — Run the canonical chain",
  );
}

function step6Slice(phase1: string): string {
  const start = phase1.indexOf("\n6. ");
  if (start === -1) return "";
  const end = phase1.indexOf("6b.", start);
  return end === -1 ? phase1.slice(start) : phase1.slice(start, end);
}

// § Phase 2.Y — the end-of-run chain-integrity assertion step.
function phase2YSlice(body: string): string {
  return sectionSlice(body, "### Phase 2.Y", "### Phase 3 — Capture");
}

// § Phase A of /conformance-loop — fan-out + leg-completeness + aggregation.
function phaseASlice(body: string): string {
  return sectionSlice(
    body,
    "### Phase A — Parallel /smoke-test fan-out + aggregation",
    "### Phase B",
  );
}

// Every ```bash fence body inside a section.
function bashFences(section: string): string[] {
  const fences: string[] = [];
  const re = /```bash\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(section)) !== null) fences.push(match[1]);
  return fences;
}

// A fence's executable lines — comments and blanks stripped.
function executableLines(fence: string): string[] {
  return fence
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

// Paragraph-proximity: some blank-line-delimited paragraph satisfies all
// the given patterns (avoids trivially matching two unrelated sentences).
function someParagraphMatches(body: string, patterns: RegExp[]): boolean {
  return body
    .split(/\n\n+/)
    .some((paragraph) => patterns.every((re) => re.test(paragraph)));
}

// The Phase 0.5 wipe fence: the bash fence carrying the rm.
function wipeFence(phase05: string): string | undefined {
  return bashFences(phase05).find((fence) => fence.includes("rm -f"));
}

// The widened per-run scratch glob set (STE-358 Technical Design — every
// scratch class keyed on the resolved tracker, plus the two pre-existing
// prefixes).
const WIPE_GLOBS = [
  "/tmp/dpt-smoke-prompt-*.txt",
  "/tmp/dpt-smoke-<tracker>-*.log",
  "/tmp/dpt-smoke-<tracker>-*.pid",
  "/tmp/dpt-smoke-<tracker>-*.rc",
  "/tmp/dpt-smoke-<tracker>-*.start",
  "/tmp/dpt-smoke-<tracker>-*.attempt*",
  "/tmp/dpt-smoke-mcp-config-<tracker>.json",
] as const;

const STALE_REASON = "capture stale (pre-run)";

// ---------------------------------------------------------------------------
// AC-STE-358.1 — verified on-disk wipe, widened globs
// ---------------------------------------------------------------------------

describeIfPresent("AC-STE-358.1 — Phase 0.5 wipe is widened to every per-run scratch class", () => {
  test("the wipe fence carries every widened glob (.log, .pid, .rc, .start, .attempt*, prompt scratch, mcp-config)", () => {
    const phase05 = phase05Slice(skill!);
    expect(phase05.length).toBeGreaterThan(0);
    const fence = wipeFence(phase05);
    expect(fence).toBeDefined();
    for (const glob of WIPE_GLOBS) {
      expect(fence!).toContain(glob);
    }
  });

  test("audit-trail invariant unchanged: the wipe never touches the findings or approval prefixes", () => {
    const phase05 = phase05Slice(skill!);
    const fence = wipeFence(phase05);
    expect(fence).toBeDefined();
    expect(fence!).not.toContain("dpt-smoke-findings");
    expect(fence!).not.toContain("approval");
    // The exclusion is still documented as the audit-trail invariant.
    expect(phase05).toMatch(/audit-trail invariant/i);
  });
});

describeIfPresent("AC-STE-358.1 — Phase 0.5 wipe is verified on disk, not self-reported", () => {
  test("a post-rm ls assertion lives in the same fence as the rm — the wiped globs are re-listed after removal", () => {
    const fence = wipeFence(phase05Slice(skill!));
    expect(fence).toBeDefined();
    const exec = executableLines(fence!);
    const rmIdx = exec.findIndex((line) => line.includes("rm -f"));
    expect(rmIdx).toBeGreaterThan(-1);
    const lsIdx = exec.findIndex(
      (line, idx) => idx > rmIdx && /\bls\b/.test(line),
    );
    expect(lsIdx).toBeGreaterThan(rmIdx);
  });

  test("zero survivors is the pass condition; survivors trigger an NFR-10 refusal naming them", () => {
    const phase05 = phase05Slice(skill!);
    expect(phase05).toMatch(/zero survivors/i);
    expect(phase05).toContain("NFR-10");
    expect(phase05).toMatch(/naming the surviv/i);
  });

  test("self-reported “scratch cleared” without the on-disk assertion is forbidden (iter-2 F2)", () => {
    const phase05 = phase05Slice(skill!);
    expect(
      someParagraphMatches(phase05, [/self-report/i, /forbidden/i]),
    ).toBe(true);
    // Provenance: the iter-2 report said PASS while iter-1 logs survived.
    expect(phase05).toMatch(/iter-2/i);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-358.2 — both prose sites pass the run-start timestamp
// ---------------------------------------------------------------------------

describeIfPresent("AC-STE-358.2 — /smoke-test Phase 2.Y passes the run-start timestamp", () => {
  test("Phase 2.Y passes a run-start timestamp into assertChainIntegrity", () => {
    const phase2Y = phase2YSlice(skill!);
    expect(phase2Y.length).toBeGreaterThan(0);
    expect(
      someParagraphMatches(phase2Y, [
        /assertChainIntegrity/,
        /run[- ]?start/i,
      ]),
    ).toBe(true);
  });

  test("the timestamp is captured at Phase 0 acceptance", () => {
    expect(
      someParagraphMatches(phase2YSlice(skill!), [
        /run[- ]?start/i,
        /Phase 0/,
      ]),
    ).toBe(true);
  });

  test("a capture whose mtime predates run-start is the pinned `capture stale (pre-run)` finding, never healthy", () => {
    const phase2Y = phase2YSlice(skill!);
    expect(phase2Y).toContain(STALE_REASON);
    expect(phase2Y).toMatch(/mtime/i);
    expect(phase2Y).toMatch(/never healthy|predat/i);
  });
});

describeIfConformanceLoopPresent("AC-STE-358.2 — /conformance-loop Phase A passes the run-start timestamp", () => {
  test("the leg-completeness check is freshness-gated on a run-start timestamp", () => {
    const phaseA = phaseASlice(conformanceLoop!);
    expect(phaseA.length).toBeGreaterThan(0);
    expect(
      someParagraphMatches(phaseA, [
        /run[- ]?start/i,
        /stale|mtime|pre-run/i,
      ]),
    ).toBe(true);
  });

  test("the timestamp is captured at Phase 0 acceptance", () => {
    expect(
      someParagraphMatches(phaseASlice(conformanceLoop!), [
        /run[- ]?start/i,
        /Phase 0/,
      ]),
    ).toBe(true);
  });

  test("a pre-run-mtime log can never satisfy the completeness check — result-bearing alone is not enough", () => {
    const phaseA = phaseASlice(conformanceLoop!);
    expect(phaseA).toMatch(/stale/i);
    expect(phaseA).toMatch(/never healthy|never satisf|regardless of (its )?content|predat/i);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-358.3 — Phase 1 step 6: no child-side merge path (F6 doc note)
// ---------------------------------------------------------------------------

describeIfPresent("AC-STE-358.3 — Phase 1 step 6 documents the no-child-side-merge contract", () => {
  test("step 6 names append-only Edit as denied alongside full-file Write for .claude/settings.json", () => {
    const step6 = step6Slice(phase1Slice(skill!));
    expect(step6.length).toBeGreaterThan(0);
    expect(step6).toMatch(/append-only/i);
    expect(
      someParagraphMatches(step6, [
        /append-only/i,
        /\bEdit\b/,
        /den(y|ies|ied)|block(ed|s)?/i,
        /settings\.json/,
      ]),
    ).toBe(true);
  });

  test("no child-side merge path exists", () => {
    expect(step6Slice(phase1Slice(skill!))).toMatch(
      /no child-side merge path/i,
    );
  });

  test("the pre-creation must carry the FULL final allow-list", () => {
    const step6 = step6Slice(phase1Slice(skill!));
    expect(
      someParagraphMatches(step6, [
        /full final allow-list/i,
        /pre-creat/i,
      ]),
    ).toBe(true);
  });

  test("children can never extend the allow-list", () => {
    expect(step6Slice(phase1Slice(skill!))).toMatch(/never extend/i);
  });
});
