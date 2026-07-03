import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// M96 "smoke-driver wait discipline" — prose-conformance meta-tests for the
// two project-local driver SKILL.mds. This file carries the M96 family;
// each FR gets its own describe blocks.
//
// STE-357 — Enforce the wait discipline: bounded multi-iteration polls, no
// turn-end with live pidfiles (2026-07-02 iter-2 finding F1 — both legs
// executed the M95 detached spawn correctly, then fire-and-exited at the
// WAIT step; the harness's leading-sleep block hint steered drivers into
// the forbidden background-wait pattern).
//
// AC-STE-357.1: both drivers' poll fences become bounded multi-iteration
//   loops (`for i in $(seq 1 18); do kill -0 … || break; sleep 30; done`,
//   ≈ ≤540 s per call — one call per ~9 min instead of ~80 single-check
//   calls per 40-min grandchild); no single-check-then-end-turn shape
//   remains sanctioned.
//
// AC-STE-357.2: red-flag prose in both SKILL.mds names the harness
//   foreground-sleep block's error hint (recommending
//   `run_in_background`/Monitor) as NOT-license — background-wait +
//   end-turn IS the F3 fire-and-exit failure.
//
// AC-STE-357.3: driver self-check — before emitting any final message,
//   run the pidfile-liveness fence over the run's pidfile glob; any live
//   pidfile ⇒ resume polling, never end the turn. Runtime validation
//   ships `[~]` (next conformance run: both legs poll to completion);
//   these meta-tests pin only the fence + prose.

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

// § Grandchild spawn lifecycle — the smoke driver's poll-fence home.
function lifecycleSlice(body: string): string {
  return sectionSlice(
    body,
    "#### Grandchild spawn lifecycle",
    "#### Phase 2 child-spawn discipline",
  );
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

// A fence's executable lines — comments and blanks stripped, so pseudocode
// fences that only *mention* `kill -0 + sleep 30` in comments don't count
// as poll fences.
function executableLines(fence: string): string[] {
  return fence
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

// The bounded multi-iteration poll shape: `for … in $(seq 1 18)`.
const BOUNDED_LOOP_RE = /for \w+ in \$\(seq 1 18\)/;

// The multi-iteration poll fence within a section (the one carrying the
// seq-1-18 bound).
function multiIterationPollFence(section: string): string | undefined {
  return bashFences(section).find((fence) => fence.includes("seq 1 18"));
}

// Every fence that polls (executable `kill -0` + `sleep`) but lacks the
// seq-1-18 bound — i.e., the sanctioned-single-check offenders. Must be
// empty: one check then end-of-call is the F1 fire-and-exit surface.
function pollFencesLackingBound(body: string): string[] {
  return bashFences(body).filter((fence) => {
    const exec = executableLines(fence).join("\n");
    return (
      exec.includes("kill -0") &&
      /\bsleep \d+/.test(exec) &&
      !exec.includes("seq 1 18")
    );
  });
}

// Paragraph-proximity: some blank-line-delimited paragraph satisfies all
// the given patterns (avoids trivially matching two unrelated sentences).
function someParagraphMatches(body: string, patterns: RegExp[]): boolean {
  return body
    .split(/\n\n+/)
    .some((paragraph) => patterns.every((re) => re.test(paragraph)));
}

// ---------------------------------------------------------------------------
// AC-STE-357.1 — bounded multi-iteration poll fences
// ---------------------------------------------------------------------------

describeIfPresent("AC-STE-357.1 — /smoke-test poll fence is a bounded multi-iteration loop", () => {
  test("§ Grandchild spawn lifecycle carries the multi-iteration poll fence: for … seq 1 18 + kill -0 + sleep 30 + break", () => {
    const lifecycle = lifecycleSlice(skill!);
    expect(lifecycle.length).toBeGreaterThan(0);
    const fence = multiIterationPollFence(lifecycle);
    expect(fence).toBeDefined();
    expect(fence!).toMatch(BOUNDED_LOOP_RE);
    expect(fence!).toContain("kill -0");
    expect(fence!).toContain("sleep 30");
    expect(fence!).toContain("break");
  });

  test("the poll call never LEADs with sleep — kill -0 gates the iteration before sleep 30 (harness leading-sleep block)", () => {
    const fence = multiIterationPollFence(lifecycleSlice(skill!));
    expect(fence).toBeDefined();
    const exec = executableLines(fence!);
    expect(exec.length).toBeGreaterThan(0);
    expect(exec[0]).not.toMatch(/^sleep/);
    const joined = exec.join("\n");
    expect(joined.indexOf("kill -0")).toBeGreaterThan(-1);
    expect(joined.indexOf("kill -0")).toBeLessThan(joined.indexOf("sleep 30"));
  });

  test("the per-call bound is documented — up to 18 checks ≈ 9 min, under the harness ceiling", () => {
    const lifecycle = lifecycleSlice(skill!);
    expect(lifecycle).toMatch(/9 ?min|540 ?s/);
    expect(lifecycle).toMatch(/600 ?s|10-minute|ten-minute/i);
  });

  test("no single-check-then-end-turn poll shape remains sanctioned — every kill-0-plus-sleep fence carries the seq-1-18 bound", () => {
    expect(pollFencesLackingBound(skill!)).toEqual([]);
  });
});

describeIfConformanceLoopPresent("AC-STE-357.1 — /conformance-loop Phase A poll fence is a bounded multi-iteration loop", () => {
  test("Phase A carries the multi-iteration poll fence: for … seq 1 18 + kill -0 + sleep 30 + break", () => {
    const phaseA = phaseASlice(conformanceLoop!);
    expect(phaseA.length).toBeGreaterThan(0);
    const fence = multiIterationPollFence(phaseA);
    expect(fence).toBeDefined();
    expect(fence!).toMatch(BOUNDED_LOOP_RE);
    expect(fence!).toContain("kill -0");
    expect(fence!).toContain("sleep 30");
    expect(fence!).toContain("break");
  });

  test("the bounded loop iterates both legs' pidfiles inside the same loop", () => {
    const fence = multiIterationPollFence(phaseASlice(conformanceLoop!));
    expect(fence).toBeDefined();
    expect(fence!).toMatch(/dpt-conformance-loop-[^\n]*\.pid/);
    expect(fence!).toContain("linear");
    expect(fence!).toContain("jira");
  });

  test("the poll call never LEADs with sleep — kill -0 gates the iteration before sleep 30", () => {
    const fence = multiIterationPollFence(phaseASlice(conformanceLoop!));
    expect(fence).toBeDefined();
    const exec = executableLines(fence!);
    expect(exec.length).toBeGreaterThan(0);
    expect(exec[0]).not.toMatch(/^sleep/);
    const joined = exec.join("\n");
    expect(joined.indexOf("kill -0")).toBeGreaterThan(-1);
    expect(joined.indexOf("kill -0")).toBeLessThan(joined.indexOf("sleep 30"));
  });

  test("the per-call bound is documented — up to 18 checks ≈ 9 min per call", () => {
    expect(phaseASlice(conformanceLoop!)).toMatch(/9 ?min|540 ?s/);
  });

  test("no single-check-then-end-turn poll shape remains sanctioned — every kill-0-plus-sleep fence carries the seq-1-18 bound", () => {
    expect(pollFencesLackingBound(conformanceLoop!)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-357.2 + AC-STE-357.3 — per-driver prose + self-check pins
// ---------------------------------------------------------------------------

// [driver name, body (null if the project-local skill is absent), the run's
// pidfile-glob shape the AC-357.3 self-check fence must scan].
const drivers: ReadonlyArray<[string, string | null, RegExp]> = [
  ["/smoke-test driver", skill, /dpt-smoke-[^\n]*\*[^\n]*\.pid/],
  [
    "/conformance-loop driver",
    conformanceLoop,
    /dpt-conformance-loop-[^\n]*\*[^\n]*\.pid/,
  ],
];

for (const [name, body, pidfileGlobRe] of drivers) {
  const describeIfDriverPresent = body === null ? describe.skip : describe;

  describeIfDriverPresent(`AC-STE-357.2 — ${name}: harness sleep-block hint is NOT license`, () => {
    test("one paragraph names the foreground-sleep block's hint (run_in_background / Monitor) and rejects it as NOT license", () => {
      expect(
        someParagraphMatches(body!, [
          /run_in_background/,
          /Monitor/,
          /not[- ]license/i,
          /sleep/i,
        ]),
      ).toBe(true);
    });

    test('the warning quotes the harness hint text ("To wait for a condition")', () => {
      expect(body!).toContain("To wait for a condition");
    });

    test("background-wait + end-turn is named as the F3 fire-and-exit failure in the same paragraph", () => {
      expect(
        someParagraphMatches(body!, [
          /run_in_background|Monitor/,
          /fire-and-exit/i,
          /\bF3\b/,
        ]),
      ).toBe(true);
    });
  });

  describeIfDriverPresent(`AC-STE-357.3 — ${name}: final-message self-check`, () => {
    test("a self-check fence runs the pidfile-liveness check (kill -0) over the run's pidfile glob", () => {
      const fence = bashFences(body!).find(
        (candidate) =>
          pidfileGlobRe.test(candidate) && candidate.includes("kill -0"),
      );
      expect(fence).toBeDefined();
    });

    test("the hard rule: before emitting any final message (success or failure), a live pidfile means resume polling", () => {
      expect(
        someParagraphMatches(body!, [
          /final message/i,
          /success or failure/i,
          /pidfile/i,
          /resume/i,
        ]),
      ).toBe(true);
    });

    test("a live pidfile never ends the turn", () => {
      expect(body!).toMatch(/never end the turn/i);
    });
  });
}
