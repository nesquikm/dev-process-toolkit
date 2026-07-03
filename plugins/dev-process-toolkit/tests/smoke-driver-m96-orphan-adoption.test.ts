import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// M96 "smoke-driver wait discipline" — prose-conformance meta-tests for the
// two project-local driver SKILL.mds. STE-357's pins live in
// smoke-driver-m96-wait-discipline.test.ts, STE-358's in
// smoke-driver-m96-verified-wipe-freshness.test.ts; this file carries
// STE-359.
//
// STE-359 — Orphan adoption for surviving grandchildren (2026-07-02 iter-2
// finding F3 — when the drivers died with live grandchildren the outcomes
// diverged nondeterministically: the Linear leg's /setup grandchild was
// killed with its parent while the Jira leg's survived as an orphan and
// completed healthily on its own; neither SKILL.md had an ownership story).
//
// AC-STE-359.1: conformance-loop Phase A post-exit — before declaring a leg
//   failed, the parent scans the leg's per-skill pidfiles
//   (/tmp/dpt-smoke-<tracker>-{setup,…,simplify}.pid); any still-answering
//   PID is ADOPTED — polled to exit with the STE-357 bounded
//   multi-iteration discipline — before the leg-completeness check runs.
//   An adopted grandchild's completed capture counts toward leg
//   completeness (adoption recovers evidence, not the chain).
//
// AC-STE-359.2: both SKILL.mds document killed-with-parent vs
//   survives-as-orphan as environment-nondeterministic residual risk;
//   process-group discipline (setsid/PGID) considered and rejected;
//   adoption is the deterministic recovery. Distinct from the pre-existing
//   M95 "Residual risk — PID reuse" paragraphs.
//
// AC-STE-359.3 is runtime-only and ships `[~]` (deferred, STE-195
//   precedent) — no meta-test here by design.

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

// § Phase A of /conformance-loop — spawn + poll + RC collection +
// leg-completeness. Ends at Phase B so the whole post-exit region is in.
function phaseASlice(body: string): string {
  return sectionSlice(
    body,
    "### Phase A — Parallel /smoke-test fan-out + aggregation",
    "### Phase B",
  );
}

// Paragraph-proximity: the blank-line-delimited paragraphs satisfying ALL
// the given patterns (avoids trivially matching unrelated sentences).
function paragraphsMatching(body: string, patterns: RegExp[]): string[] {
  return body
    .split(/\n\n+/)
    .filter((paragraph) => patterns.every((re) => re.test(paragraph)));
}

function someParagraphMatches(body: string, patterns: RegExp[]): boolean {
  return paragraphsMatching(body, patterns).length > 0;
}

// The six-skill per-leg pidfile glob the adoption scan names (canonical
// chain order; the pre-existing leg-completeness check names the same six
// with a `.log` suffix — the `.pid` suffix is the adoption scan's own).
const SIX_SKILL_PID_GLOB =
  "/tmp/dpt-smoke-<tracker>-{setup,spec-write,implement,gate-check,spec-review,simplify}.pid";

// Phase A anchors the adoption block must sit between.
const RC_COLLECTION_MARKER = "**RC collection";
const LEG_COMPLETENESS_MARKER = "**Leg-completeness check";

// ---------------------------------------------------------------------------
// AC-STE-359.1 — /conformance-loop Phase A adoption block
// ---------------------------------------------------------------------------

describeIfConformanceLoopPresent("AC-STE-359.1 — /conformance-loop Phase A adopts still-answering grandchildren before the leg-completeness check", () => {
  test("Phase A scans the leg's per-skill pidfiles — the six-skill .pid glob is named", () => {
    const phaseA = phaseASlice(conformanceLoop!);
    expect(phaseA.length).toBeGreaterThan(0);
    expect(phaseA).toContain(SIX_SKILL_PID_GLOB);
  });

  test("the adoption block sits between RC collection and the leg-completeness check", () => {
    const phaseA = phaseASlice(conformanceLoop!);
    const rcIdx = phaseA.indexOf(RC_COLLECTION_MARKER);
    const legIdx = phaseA.indexOf(LEG_COMPLETENESS_MARKER);
    const adoptionIdx = phaseA.indexOf(SIX_SKILL_PID_GLOB);
    expect(rcIdx).toBeGreaterThan(-1);
    expect(legIdx).toBeGreaterThan(rcIdx);
    expect(adoptionIdx).toBeGreaterThan(rcIdx);
    expect(adoptionIdx).toBeLessThan(legIdx);
  });

  test("a still-answering PID (kill -0) is an orphaned grandchild the parent ADOPTS — polled to exit with the STE-357 bounded multi-iteration discipline", () => {
    expect(
      someParagraphMatches(phaseASlice(conformanceLoop!), [
        /adopt/i,
        /orphan/i,
        /kill -0/,
        /bounded multi-iteration|seq 1 18/,
      ]),
    ).toBe(true);
  });

  test("an adopted grandchild's completed capture counts toward leg completeness — adoption recovers evidence, not the chain", () => {
    expect(
      someParagraphMatches(phaseASlice(conformanceLoop!), [
        /adopt/i,
        /leg[ -]completeness|completeness/i,
        /evidence/i,
        /not the chain/i,
      ]),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-359.2 — both drivers: nondeterminism residual-risk prose
// ---------------------------------------------------------------------------

// [driver name, body (null if the project-local skill is absent)].
const drivers: ReadonlyArray<[string, string | null]> = [
  ["/smoke-test driver", skill],
  ["/conformance-loop driver", conformanceLoop],
];

for (const [name, body] of drivers) {
  const describeIfDriverPresent = body === null ? describe.skip : describe;

  describeIfDriverPresent(`AC-STE-359.2 — ${name}: killed-with-parent vs survives-as-orphan residual risk`, () => {
    test("one paragraph names both outcomes — dies with the driver vs survives as an orphan — as environment-nondeterministic", () => {
      expect(
        someParagraphMatches(body!, [
          /orphan/i,
          /nondeterminis/i,
          /surviv/i,
          /(dies|died|killed)[- ]with/i,
        ]),
      ).toBe(true);
    });

    test("process-group discipline (setsid / PGID) is named as considered and rejected", () => {
      expect(
        someParagraphMatches(body!, [/setsid/i, /PGID/, /reject/i]),
      ).toBe(true);
    });

    test("adoption is named as the deterministic recovery", () => {
      expect(
        someParagraphMatches(body!, [/adopt/i, /deterministic/i, /recover/i]),
      ).toBe(true);
    });

    test("the nondeterminism prose is its own residual risk, distinct from the M95 PID-reuse paragraph", () => {
      const paragraphs = paragraphsMatching(body!, [
        /orphan/i,
        /nondeterminis/i,
      ]);
      expect(paragraphs.length).toBeGreaterThan(0);
      expect(paragraphs.some((p) => !/PID reuse/i.test(p))).toBe(true);
    });
  });
}
