// M_4df444 / STE-595 — the run-from-a-file rule and the live-child count, at
// every spawn site (AC.5 meta-test, AC.6 structure).
//
// THE SITE SETS ARE DERIVED on every run by `tests/_spawn_fences.ts`, never
// hand-counted:
//   * AC.5 sites: the /conformance-loop Phase A fence (found by shape: the fence
//     naming `--tracker` with a column-0 `{ … } &` group) plus EVERY
//     /smoke-test fence holding a `claude -p` command line, backgrounded or not.
//     AC.5 names the loop's Phase A only, so the loop's foreground Phase B fence
//     is outside that set.
//   * AC.6 sites: every fence in either driver that backgrounds a `claude -p`
//     spawn and captures `$!`, i.e. every fence whose children a count can find.
//
// THE RULE, as a site must state it (in the prose leading into the fence, or as
// a comment inside it): the literal `bash <file>` with stdin named within 300
// characters. Write the fence to a file, run `bash <file>`, never feed it to
// bash through stdin.
//
// THE COUNT, as a fence must carry it:
//   * after every backgrounded spawn, and before any `exit`, `return` or
//     `${X:?}` that could skip it (or armed as an EXIT trap), a
//     `ps -p <pid> -o comm=` identity check beside a `kill -0` probe;
//   * a line printing `launched=<n> live=<n>`;
//   * on a mismatch, a line naming the ABORT and the teardown, then a non-zero
//     `exit`. The loop's mismatch names § Per-leg abort teardown, or runs its
//     recipe, which prints `teardown_spawned_legs=`.
// The behaviour itself is proven by RUNNING the fences, in
// tests/m_4df444-ste-595-phase-a-fence-run.test.ts.

import { describe, expect, test } from "bun:test";

import {
  classify,
  COUNT_LINE_TEXT_RE,
  countSites,
  countWindowLines,
  firstIdentityIndex,
  hasExitTrapCount,
  isBackgroundSpawnFence,
  isSpawnFence,
  KILL0_RE,
  label,
  parseFences,
  phaseAFence,
  readDoc,
  ruleSites,
  spawnCounts,
  statesRunFromFileRule,
  type Fence,
} from "./_spawn_fences";

const RULE_SITES = ruleSites();
const COUNT_SITES = countSites();
const LOOP_FENCES = parseFences("conformance-loop", readDoc("conformance-loop"));
const SMOKE_FENCES = parseFences("smoke-test", readDoc("smoke-test"));
const PHASE_A = phaseAFence(LOOP_FENCES);

function syntheticFence(lines: string[]): Fence {
  return {
    doc: "smoke-test",
    openLine: 1,
    closeLine: lines.length + 2,
    info: "bash",
    lines,
    body: lines.join("\n"),
    region: "",
  };
}

// ===========================================================================
// Controls: the derivation discriminates, and is not vacuous.
// ===========================================================================

describe("site derivation — parsed, never hand-counted (CONTROLS)", () => {
  test("the loop's Phase A fence is found by shape", () => {
    expect(PHASE_A, "no loop fence names --tracker with a column-0 `{ … } &` group").toBeDefined();
    expect(PHASE_A!.body).toContain("--tracker");
    expect(isBackgroundSpawnFence(PHASE_A!)).toBe(true);
  });

  test("the rule site set holds Phase A and anchors each /smoke-test spawn family", () => {
    expect(PHASE_A).toBeDefined();
    expect(RULE_SITES.map(label)).toContain(label(PHASE_A!));
    const smoke = RULE_SITES.filter((f) => f.doc === "smoke-test");
    expect(smoke.some((f) => f.body.includes("claude -p /dev-process-toolkit:gate-check")), "non-prompt-bearing spawns").toBe(true);
    expect(smoke.some((f) => f.body.includes("/dev-process-toolkit:setup") && f.body.includes("<<'PROMPT_EOF' &")), "prompt-bearing spawns").toBe(true);
    expect(smoke.some((f) => f.body.includes("setup.attempt1.log")), "the retry worked example").toBe(true);
    expect(smoke.some((f) => !isBackgroundSpawnFence(f)), "a foreground spawn fence (Phase 8) is a rule site too").toBe(true);
  });

  test("a fence that only MENTIONS claude -p in echo text is not a site", () => {
    const ctx = LOOP_FENCES.find((f) => f.body.includes("LOOP-CTX: headless (claude -p)"));
    expect(ctx, "control subject: the LOOP-CTX probe fence").toBeDefined();
    expect(ctx!.body).toContain("claude -p");
    expect(isSpawnFence(ctx!)).toBe(false);
  });

  test("the count site set is every backgrounded spawn fence: Phase A in, the foreground fences out", () => {
    expect(COUNT_SITES.length).toBeGreaterThan(0);
    expect(PHASE_A).toBeDefined();
    const counted = COUNT_SITES.map(label);
    expect(counted).toContain(label(PHASE_A!));
    const foreground = [...LOOP_FENCES, ...SMOKE_FENCES].filter((f) => isSpawnFence(f) && !isBackgroundSpawnFence(f));
    expect(foreground.length, "control: foreground spawn fences exist").toBeGreaterThan(0);
    for (const f of foreground) expect(counted).not.toContain(label(f));
  });

  test("heredoc bodies are never read as code, and a quoted `<<` opens no heredoc", () => {
    expect(classify(["cat <<'EOF'", "claude -p x &", "EOF", "exit 1"])).toEqual(["code", "heredoc", "code", "code"]);
    expect(classify(['echo "never bash <<EOF"', "claude -p y &"])).toEqual(["code", "code"]);
    expect(classify(["bash <<< 'x &'", "claude -p z &"])).toEqual(["code", "code"]);
  });
});

// ===========================================================================
// AC-STE-595.5 — the rule, pinned at every site.
// ===========================================================================

describe("AC-STE-595.5 — each spawn site states the run-from-a-file rule", () => {
  test("CONTROL: the matcher accepts the rule and rejects its near-misses", () => {
    expect(statesRunFromFileRule("Write this fence to a file and run `bash <file>`; never feed it to bash through stdin.")).toBe(true);
    expect(statesRunFromFileRule("# run it from a file: bash <file> — never through stdin")).toBe(true);
    expect(statesRunFromFileRule("#### Heredoc-on-stdin for prompt-bearing children")).toBe(false);
    expect(statesRunFromFileRule("run `bash <file>` to start it")).toBe(false);
  });

  test("CONTROL: there is at least one rule site per driver", () => {
    expect(RULE_SITES.some((f) => f.doc === "conformance-loop")).toBe(true);
    expect(RULE_SITES.some((f) => f.doc === "smoke-test")).toBe(true);
  });

  for (const site of RULE_SITES) {
    test(`${label(site)} states it: write the fence to a file, run \`bash <file>\`, never through stdin`, () => {
      expect(
        statesRunFromFileRule(site.region),
        `no \`bash <file>\` + stdin rule in the prose leading into ${label(site)} or inside it. ` +
          `Region opens: ${JSON.stringify(site.region.slice(0, 240))}`,
      ).toBe(true);
    });
  }
});

// ===========================================================================
// AC-STE-595.6 — the count, structurally, at every backgrounded spawn fence.
// ===========================================================================

describe("AC-STE-595.6 — CONTROLS for the placement rule", () => {
  const spawn = ["claude -p x > /tmp/l 2>&1 &", "echo $! > /tmp/p"];
  const count = [
    "LIVE=0; P=$(cat /tmp/p); kill -0 \"$P\" 2>/dev/null && [ \"$(ps -p \"$P\" -o comm=)\" = claude ] && LIVE=1",
  ];
  const abort = ["if [ -n \"$X\" ]; then", "  exit 1", "fi"];

  test("an exit between a spawn and its count is flagged", () => {
    const [c] = spawnCounts(syntheticFence([...spawn, ...abort, ...count]));
    expect(c!.identityIndex).not.toBeNull();
    expect(c!.abortIndex).not.toBeNull();
  });

  test("a count placed before the exit passes", () => {
    const [c] = spawnCounts(syntheticFence([...spawn, ...count, ...abort]));
    expect(c!.identityIndex).not.toBeNull();
    expect(c!.abortIndex).toBeNull();
  });

  test("a spawn with no count after it is flagged", () => {
    const [c] = spawnCounts(syntheticFence([...count, ...spawn]));
    expect(c!.identityIndex).toBeNull();
  });

  test("an exit inside a heredoc body is text, not an abort", () => {
    const [c] = spawnCounts(syntheticFence([...spawn, "cat <<EOF >> /tmp/log", "exit 1", "EOF", ...count]));
    expect(c!.abortIndex).toBeNull();
  });
});

for (const site of COUNT_SITES) {
  describe(`AC-STE-595.6 — ${label(site)} counts its live children`, () => {
    const counts = spawnCounts(site);
    const trapped = hasExitTrapCount(site);

    test("every backgrounded spawn is followed by a `ps -p <pid> -o comm=` identity check", () => {
      for (const c of counts) {
        expect(
          c.identityIndex !== null || trapped,
          `spawn at fence body line ${c.spawnIndex + 1} (${JSON.stringify(site.lines[c.spawnIndex]!.trim())}) has no identity-checked count after it`,
        ).toBe(true);
      }
    });

    test("no exit, return or ${X:?} sits between a spawn and its count, so an earlier abort cannot skip it", () => {
      if (trapped) return; // an EXIT trap runs on every path out
      for (const c of counts) {
        expect(
          c.abortIndex,
          c.abortIndex === null
            ? ""
            : `${JSON.stringify(site.lines[c.abortIndex]!.trim())} can end the fence between the spawn at body line ${c.spawnIndex + 1} and its count`,
        ).toBeNull();
      }
    });

    test("the count probes liveness with `kill -0` beside the identity check", () => {
      const idx = firstIdentityIndex(site);
      expect(idx, "no identity check in the fence").not.toBeNull();
      expect(countWindowLines(site, idx!, 12, 12).join("\n")).toMatch(KILL0_RE);
    });

    test("the count prints `launched=<n> live=<n>` on one line", () => {
      const idx = firstIdentityIndex(site);
      expect(idx, "no identity check in the fence").not.toBeNull();
      expect(countWindowLines(site, idx!).join("\n")).toMatch(COUNT_LINE_TEXT_RE);
    });

    test("a mismatch aborts: an ABORT line names the teardown, and the fence exits non-zero", () => {
      const idx = firstIdentityIndex(site);
      expect(idx, "no identity check in the fence").not.toBeNull();
      const window = countWindowLines(site, idx!);
      expect(window.some((l) => /ABORT/.test(l) && /teardown/i.test(l)), "no line names both the ABORT and the teardown").toBe(true);
      expect(window.some((l) => !/^\s*#/.test(l) && /\bexit\s+[1-9]/.test(l)), "no non-zero exit on the mismatch path").toBe(true);
    });

    if (site.doc === "conformance-loop") {
      test("the loop's mismatch routes through § Per-leg abort teardown", () => {
        const idx = firstIdentityIndex(site);
        expect(idx, "no identity check in the fence").not.toBeNull();
        expect(countWindowLines(site, idx!).join("\n")).toMatch(/per-leg abort teardown|teardown_spawned_legs/i);
      });
    }
  });
}
