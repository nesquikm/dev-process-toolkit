import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// M98 "zsh-safe glob fences" — prose-conformance meta-tests for the two
// project-local driver SKILL.mds. This file carries STE-366; the sibling
// STE-365 pins live in m98-ste-365-fire-and-exit-guard.test.ts.
//
// STE-366 — Every glob-based fence in /smoke-test and /conformance-loop must
// be safe under zsh's default `nomatch` option: an unmatched glob must expand
// to nothing (or be handled), never abort the whole command. The driver shell
// is zsh (confirmed 2026-07-04: `no matches found` fired 3× during the run,
// including inside /conformance-loop's own final-message self-check). The
// fences were authored assuming bash pass-through-glob semantics.
//
// The load-bearing case is the Phase 0.5 verified-wipe fence (F2): under zsh,
// the first unmatched glob aborts the command before `rm` runs (nothing is
// wiped) and the identical failure aborts the verify `ls`, so the survivors
// come back empty and the check reports a false PASS — re-introducing exactly
// the mode STE-358 was written to prevent, this time via the shell.
//
// AC-STE-366.1: smoke-test fences zsh-safe — the Phase 0.5 `rm`/`ls` fence via
//   `bash -c` (restore bash pass-through), the final-message pidfile
//   self-check `for` loop via a null_glob/nullglob guard.
// AC-STE-366.2: conformance-loop final-message pidfile self-check `for` loop
//   carries a null_glob/nullglob guard.
// AC-STE-366.3: the Phase 0.5 verify `ls` cannot false-PASS — it lives inside
//   a `bash -c`; no bare unguarded `ls /tmp/dpt-smoke-…*` line remains (the
//   shell-agnostic-enumeration property).
// AC-STE-366.4: drift/negative guard over every bash fence in BOTH skills —
//   every `for VAR in /tmp/dpt-…*` glob loop carries a guard token in its own
//   fence, and every Phase-0.5-style `ls /tmp/dpt-…*` verify sits inside a
//   `bash -c`. Fixed-word-list / seq loops (`for LEG in linear jira`,
//   `for i in $(seq 1 18)`, `for SKILL in setup …`) are NOT glob loops and are
//   never flagged.

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

// § Phase 0.5 — the stale-scratch verified-wipe block.
function phase05Slice(body: string): string {
  return sectionSlice(
    body,
    "### Phase 0.5 — Clear stale per-run scratch",
    "### Phase 1 — Setup",
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

// A fence's executable lines — comments and blanks stripped, so a glob that is
// only *mentioned* in a comment doesn't count as an executable glob line.
function executableLines(fence: string): string[] {
  return fence
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

// The zsh-safe guard tokens the FR accepts (task-scoped set):
// `null_glob` | `nullglob` | `bash -c`. `null_?glob` matches both spellings.
const GUARD_TOKEN_RE = /null_?glob|bash -c/;
const NULLGLOB_RE = /null_?glob/;

// A `for VAR in /tmp/dpt-…*` glob-EXPANSION loop — the only shape that needs a
// guard. Fixed word-lists (`for LEG in linear jira`, `for SKILL in setup …`),
// command-substitutions (`for i in $(seq 1 18)`), and placeholder targets
// (`for FINDING_TEXT in <…>`) do NOT match: their `in` target is not a
// /tmp/dpt-…* glob.
const GLOB_FOR_RE = /for \w+ in \/tmp\/dpt-[^\s]*\*/;

// The Phase 0.5 wipe fence: the bash fence carrying the `rm`.
function wipeFence(phase05: string): string | undefined {
  return bashFences(phase05).find((fence) => fence.includes("rm -f"));
}

// The final-message pidfile self-check fence (the one carrying the pidfile
// glob `for` loop), located by its loop needle.
function selfCheckFence(body: string, forNeedle: string): string | undefined {
  return bashFences(body).find((fence) => fence.includes(forNeedle));
}

// A null_glob/nullglob guard token appears in the fence BEFORE the `for` line —
// so an unmatched glob yields zero iterations rather than aborting under zsh.
function nullglobPrecedesForLoop(
  fence: string | undefined,
  forNeedle: string,
): boolean {
  if (fence === undefined) return false;
  const forIdx = fence.indexOf(forNeedle);
  if (forIdx === -1) return false;
  const guardIdx = fence.search(NULLGLOB_RE);
  return guardIdx !== -1 && guardIdx < forIdx;
}

// Bare, unguarded `ls /tmp/dpt-…*` executable lines in a fence — an `ls` glob
// verify NOT wrapped in a `bash -c`. Under zsh's nomatch these abort (or, with
// nullglob, degrade to a zero-arg `ls` that lists the CWD); either way they
// can false-PASS the survivor check.
function bareLsGlobLines(fence: string): string[] {
  return executableLines(fence).filter(
    (line) =>
      /\bls\b/.test(line) &&
      line.includes("/tmp/dpt-") &&
      !line.includes("bash -c"),
  );
}

// AC-STE-366.4(i): fences that expand a /tmp/dpt-…* glob in a `for` loop but
// carry NO guard token in that same fence. Must be empty.
function unguardedGlobForFences(body: string): string[] {
  return bashFences(body).filter(
    (fence) => GLOB_FOR_RE.test(fence) && !GUARD_TOKEN_RE.test(fence),
  );
}

// AC-STE-366.4(ii): every bare `ls /tmp/dpt-…*` verify line across every fence
// in a body. Must be empty.
function allBareLsGlobLines(body: string): string[] {
  return bashFences(body).flatMap((fence) => bareLsGlobLines(fence));
}

const SMOKE_SELF_CHECK_FOR = "for PIDFILE in /tmp/dpt-smoke-";
const CONFORMANCE_SELF_CHECK_FOR = "for PIDFILE in /tmp/dpt-conformance-loop-";

// ---------------------------------------------------------------------------
// AC-STE-366.1 — smoke-test fences made zsh-safe
// ---------------------------------------------------------------------------

describeIfPresent("AC-STE-366.1 — /smoke-test Phase 0.5 rm/ls fence is bash -c wrapped", () => {
  test("the Phase 0.5 wipe `rm -f <globs>` is wrapped in `bash -c` (restore bash pass-through)", () => {
    const phase05 = phase05Slice(skill!);
    expect(phase05.length).toBeGreaterThan(0);
    const fence = wipeFence(phase05);
    expect(fence).toBeDefined();
    // `bash -c 'rm -f …'` or `bash -c "rm -f …"`.
    expect(fence!).toMatch(/bash -c ['"]rm -f/);
  });

  test("the Phase 0.5 verify `ls <globs>` is wrapped in `bash -c` (never aborts, never lists the CWD)", () => {
    const fence = wipeFence(phase05Slice(skill!));
    expect(fence).toBeDefined();
    // `bash -c 'ls …'` or `bash -c "ls …"`.
    expect(fence!).toMatch(/bash -c ['"]ls\b/);
  });
});

describeIfPresent("AC-STE-366.1 — /smoke-test final-message self-check `for` loop is nullglob-guarded", () => {
  test("the pidfile-glob self-check fence carries a null_glob/nullglob guard before its `for`", () => {
    const fence = selfCheckFence(skill!, SMOKE_SELF_CHECK_FOR);
    expect(fence).toBeDefined();
    expect(fence!).toMatch(NULLGLOB_RE);
    expect(nullglobPrecedesForLoop(fence, SMOKE_SELF_CHECK_FOR)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-366.2 — conformance-loop final-message self-check `for` loop guarded
// ---------------------------------------------------------------------------

describeIfConformanceLoopPresent("AC-STE-366.2 — /conformance-loop final-message self-check `for` loop is nullglob-guarded", () => {
  test("the pidfile-glob self-check fence carries a null_glob/nullglob guard before its `for`", () => {
    const fence = selfCheckFence(conformanceLoop!, CONFORMANCE_SELF_CHECK_FOR);
    expect(fence).toBeDefined();
    expect(fence!).toMatch(NULLGLOB_RE);
    expect(nullglobPrecedesForLoop(fence, CONFORMANCE_SELF_CHECK_FOR)).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// AC-STE-366.3 — Phase 0.5 verify cannot false-PASS under zsh
// ---------------------------------------------------------------------------

describeIfPresent("AC-STE-366.3 — Phase 0.5 verify `ls` lives inside a bash -c (shell-agnostic enumeration)", () => {
  test("no bare unguarded `ls /tmp/dpt-smoke-…*` line remains in the wipe fence", () => {
    const fence = wipeFence(phase05Slice(skill!));
    expect(fence).toBeDefined();
    expect(bareLsGlobLines(fence!)).toEqual([]);
  });

  test("the wipe fence still runs both the `rm` and an `ls` verify (STE-358 rm-then-ls shape preserved)", () => {
    const fence = wipeFence(phase05Slice(skill!));
    expect(fence).toBeDefined();
    const exec = executableLines(fence!);
    const rmIdx = exec.findIndex((line) => line.includes("rm -f"));
    const lsIdx = exec.findIndex(
      (line, idx) => idx > rmIdx && /\bls\b/.test(line),
    );
    expect(rmIdx).toBeGreaterThan(-1);
    expect(lsIdx).toBeGreaterThan(rmIdx);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-366.4 — drift/negative guard over every bash fence in BOTH skills
// ---------------------------------------------------------------------------

const drivers: ReadonlyArray<[string, string | null]> = [
  ["/smoke-test driver", skill],
  ["/conformance-loop driver", conformanceLoop],
];

for (const [name, body] of drivers) {
  const describeIfDriverPresent = body === null ? describe.skip : describe;

  describeIfDriverPresent(`AC-STE-366.4 — ${name}: no unguarded glob fence remains`, () => {
    test("every `for VAR in /tmp/dpt-…*` glob loop carries a null_glob/nullglob/bash -c guard in its own fence", () => {
      expect(unguardedGlobForFences(body!)).toEqual([]);
    });

    test("every `ls /tmp/dpt-…*` verify appears only inside a `bash -c`", () => {
      expect(allBareLsGlobLines(body!)).toEqual([]);
    });

    test("negative control — fixed-word-list / seq / placeholder loops are NOT treated as glob loops", () => {
      // These currently-green shapes must never be flagged, before or after the
      // fix lands, or the guard scope would spuriously turn them RED.
      for (const fence of bashFences(body!)) {
        for (const line of fence.split("\n")) {
          const trimmed = line.trim();
          const isFixedLoop =
            /^for \w+ in linear jira\b/.test(trimmed) ||
            /^for \w+ in \$\(seq /.test(trimmed) ||
            /^for SKILL in setup /.test(trimmed) ||
            /^for FINDING_TEXT in </.test(trimmed);
          if (isFixedLoop) {
            expect(GLOB_FOR_RE.test(trimmed)).toBe(false);
          }
        }
      }
    });
  });
}
