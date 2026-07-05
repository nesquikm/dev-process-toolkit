import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// M98 "fire-and-exit guard" — prose-conformance meta-tests for the two
// project-local driver SKILL.mds. STE-365 attacks the recurring F3
// fire-and-exit failure (2026-07-04 /conformance-loop run: both legs spawned
// the /setup grandchild via the Bash tool's `run_in_background` task, then
// ended the turn "waiting for the completion notification" — which under
// `claude -p` never arrives, so /setup was torn down mid-run). M96/STE-357's
// prose guardrails were already present and did NOT prevent it; this FR adds a
// runtime context probe the driver executes, a co-located hard prohibition at
// the exact spawn site, and this byte-checkable drift meta-test.
//
// AC-STE-365.1 — /smoke-test Phase 2 opens with a `SMOKE-CTX:` context probe
//   (`[ -t 0 ]` stdin-tty test) whose headless branch states background-task
//   notifications will NOT arrive and the bounded kill-0 poll is the only wait.
// AC-STE-365.2 — a co-located ⛔ FORBIDDEN callout at the smoke-test
//   `#### Phase 2 child-spawn discipline` spawn site (not only in the separate
//   `#### Grandchild spawn lifecycle` section) names run_in_background +
//   Monitor + turn-yield + F3 + fire-and-exit + the only-sanctioned-wait.
// AC-STE-365.3 — drift guard: the detached spawn + pidfile-capture + bounded
//   `kill -0` poll snippet STILL exists, so the fix cannot delete the pattern
//   it protects. (This AC is a regression guard for an existing invariant — it
//   is GREEN before implementation by design; the RED signal lives in .1/.2/.4.)
// AC-STE-365.4 — parity: the same co-located ⛔ FORBIDDEN callout is added to
//   /conformance-loop's Phase A leg-spawn site.
// AC-STE-365.5 is runtime-deferred `[~]` — no test here.

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

// § Phase 2 (the canonical chain) — the SMOKE-CTX probe's home. Spans the
// whole Phase 2 body up to the Phase 2.X runtime-fixture wall.
function phase2Slice(body: string): string {
  return sectionSlice(
    body,
    "### Phase 2 — Run the canonical chain",
    "### Phase 2.X",
  );
}

// § Phase 2 child-spawn discipline — the actual spawn-snippet region, sliced
// to the next ###/## heading ("### Phase 2.X"). Deliberately EXCLUDES the
// separate "#### Grandchild spawn lifecycle" section (where M96's red-flag
// prose already lives) so AC-365.2 pins a callout co-located at the spawn site.
function childSpawnDisciplineSlice(body: string): string {
  return sectionSlice(
    body,
    "#### Phase 2 child-spawn discipline",
    "### Phase 2.X",
  );
}

// § Grandchild spawn machinery — lifecycle + child-spawn discipline + heredoc +
// stream-idle worked example. The drift guard (AC-365.3) scans this for the
// detached-spawn + pidfile + bounded-poll snippet it must never let the fix
// delete.
function grandchildMachinery(body: string): string {
  return sectionSlice(body, "#### Grandchild spawn lifecycle", "### Phase 2.X");
}

// § Phase A of /conformance-loop — spawn + poll + RC collection.
function phaseASlice(body: string): string {
  return sectionSlice(
    body,
    "### Phase A — Parallel /smoke-test fan-out + aggregation",
    "## Findings",
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

// Paragraph-proximity: some blank-line-delimited paragraph satisfies all the
// given patterns (avoids trivially matching two unrelated sentences).
function someParagraphMatches(body: string, patterns: RegExp[]): boolean {
  return body
    .split(/\n\n+/)
    .some((paragraph) => patterns.every((re) => re.test(paragraph)));
}

// The bounded multi-iteration poll shape: `for … in $(seq 1 18)`.
const BOUNDED_LOOP_RE = /for \w+ in \$\(seq 1 18\)/;

// The co-located FORBIDDEN callout contract (shared by AC-365.2 + AC-365.4):
// one paragraph carries the ⛔/FORBIDDEN marker AND names, together, the
// Bash-tool `run_in_background` parameter, the `Monitor` tool, the F3
// fire-and-exit failure, and the only-sanctioned-wait rule. The uppercase
// FORBIDDEN / ⛔ marker is the distinguisher from M96's lowercase "forbidden"
// red-flag prose, so this predicate is RED until the new callout lands.
function hasColocatedForbiddenCallout(section: string): boolean {
  return someParagraphMatches(section, [
    /⛔|FORBIDDEN/,
    /run_in_background/,
    /Monitor/,
    /\bF3\b/,
    /fire-and-exit/i,
    /sanctioned wait/i,
  ]);
}

// ---------------------------------------------------------------------------
// AC-STE-365.1 — Phase-2-entry context-detection probe (SMOKE-CTX banner)
// ---------------------------------------------------------------------------

describeIfPresent("AC-STE-365.1 — /smoke-test Phase 2 SMOKE-CTX context probe", () => {
  test("Phase 2 opens with a SMOKE-CTX banner probe gated on an [ -t 0 ] stdin-tty test", () => {
    const region = phase2Slice(skill!);
    expect(region.length).toBeGreaterThan(0);
    expect(region).toContain("SMOKE-CTX:");
    expect(region).toContain("[ -t 0 ]");
  });

  test("both branches print byte-checkable banners: `SMOKE-CTX: interactive` and `SMOKE-CTX: headless`", () => {
    const region = phase2Slice(skill!);
    expect(region).toMatch(/SMOKE-CTX: interactive/);
    expect(region).toMatch(/SMOKE-CTX: headless/);
  });

  test("the headless branch states notifications will NOT arrive and the bounded poll is the only sanctioned wait", () => {
    expect(
      someParagraphMatches(phase2Slice(skill!), [
        /headless/i,
        /notification/i,
        /\bNOT\b|will not/,
        /poll/i,
      ]),
    ).toBe(true);
  });

  test("the probe sits before the first grandchild spawn — ahead of the child-spawn-discipline snippets", () => {
    const region = phase2Slice(skill!);
    const ctxIdx = region.indexOf("SMOKE-CTX:");
    const spawnIdx = region.indexOf("#### Phase 2 child-spawn discipline");
    expect(ctxIdx).toBeGreaterThanOrEqual(0);
    expect(spawnIdx).toBeGreaterThanOrEqual(0);
    expect(ctxIdx).toBeLessThan(spawnIdx);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-365.2 — co-located ⛔ FORBIDDEN callout at the smoke-test spawn site
// ---------------------------------------------------------------------------

describeIfPresent("AC-STE-365.2 — /smoke-test: FORBIDDEN callout co-located at the spawn site", () => {
  test("the `#### Phase 2 child-spawn discipline` section carries a ⛔ FORBIDDEN callout", () => {
    const section = childSpawnDisciplineSlice(skill!);
    expect(section.length).toBeGreaterThan(0);
    expect(section).toMatch(/⛔|FORBIDDEN/);
  });

  test("the callout names run_in_background + Monitor + F3 + fire-and-exit + only-sanctioned-wait in one paragraph", () => {
    expect(hasColocatedForbiddenCallout(childSpawnDisciplineSlice(skill!))).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// AC-STE-365.3 — drift guard: detached spawn + pidfile + bounded kill-0 poll
// (regression guard for an existing invariant — GREEN before implementation)
// ---------------------------------------------------------------------------

describeIfPresent("AC-STE-365.3 — /smoke-test drift guard: spawn+poll snippet survives", () => {
  test("the bounded kill-0 poll snippet still exists (for … seq 1 18 + kill -0 + sleep 30 + .pid)", () => {
    const machinery = grandchildMachinery(skill!);
    const pollFence = bashFences(machinery).find(
      (fence) => fence.includes("kill -0") && fence.includes(".pid"),
    );
    expect(pollFence).toBeDefined();
    expect(pollFence!).toMatch(BOUNDED_LOOP_RE);
    expect(pollFence!).toContain("sleep 30");
  });

  test("the detached spawn + pidfile-capture snippet still exists (`&` background + `echo $! > ….pid`)", () => {
    const machinery = grandchildMachinery(skill!);
    const spawnFence = bashFences(machinery).find(
      (fence) =>
        fence.includes("&") &&
        /echo \$! >/.test(fence) &&
        fence.includes(".pid"),
    );
    expect(spawnFence).toBeDefined();
  });

  test("a single fence still carries the combined detached-spawn + pidfile + kill-0 pattern the fix protects", () => {
    const machinery = grandchildMachinery(skill!);
    const combined = bashFences(machinery).find(
      (fence) =>
        fence.includes("&") &&
        fence.includes(".pid") &&
        fence.includes("kill -0"),
    );
    expect(combined).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// AC-STE-365.4 — parity: co-located ⛔ FORBIDDEN callout at /conformance-loop's
// Phase A leg-spawn site
// ---------------------------------------------------------------------------

describeIfConformanceLoopPresent("AC-STE-365.4 — /conformance-loop: FORBIDDEN callout co-located at the Phase A spawn site", () => {
  test("Phase A carries a ⛔ FORBIDDEN callout", () => {
    const section = phaseASlice(conformanceLoop!);
    expect(section.length).toBeGreaterThan(0);
    expect(section).toMatch(/⛔|FORBIDDEN/);
  });

  test("the callout names run_in_background + Monitor + F3 + fire-and-exit + only-sanctioned-wait in one paragraph", () => {
    expect(hasColocatedForbiddenCallout(phaseASlice(conformanceLoop!))).toBe(
      true,
    );
  });
});
