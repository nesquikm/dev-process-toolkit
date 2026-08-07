// M121 / STE-447 — the `--legs` selector and its fail-closed zero-leg guard.
//
// WHY THIS FILE EXECUTES INSTEAD OF GREPPING. The hazard STE-447 exists to
// close is not "the skill fails to describe a guard" — it is "the loop reports
// green having tested nothing". A prose assertion cannot tell those apart: a
// `toContain("refuses")` passes against a paragraph describing a guard the
// snippet below it does not implement. So the pre-flight (0) fence is
// EXTRACTED from the driver SKILL and RUN, and every claim about refusal,
// selection and side effects is a claim about what that fence actually did.
//
// THE HAZARD, STATED ONCE. The moment an operator-supplied selector exists the
// resolved leg set can be empty. An empty run spawns nothing, so it writes no
// per-leg findings file, so it has no `**Severity:** high` lines, so the
// `green` termination probe reads it as convergence. That is this milestone's
// own vacuous-pass shape one level up: not an assertion that cannot fail, but
// the LOOP itself going vacuously green. Before `--legs` the hazard was
// unreachable — the leg count was a hardcoded two and no input could drive it
// to zero. The selector is what makes it reachable, so the selector is what
// guards it.
//
// HOW THE ABSENCE ASSERTIONS ARE KEPT HONEST. "No pidfile was written" is a
// claim that passes trivially if the thing that writes pidfiles was never
// wired up. Two constructions stop that:
//
//   1. A REACHABILITY ANCHOR — the same harness, run with a valid selection,
//      must produce the pidfiles and the green line. If the continuation ever
//      stops running, that test fails and the absence assertions lose their
//      alibi rather than silently becoming free.
//   2. A FALSIFIABILITY WITNESS — the same harness with the guard STRIPPED
//      must reach green and write artifacts. It is a standing test over
//      synthetic (in-memory) mutation rather than a one-off probe against the
//      file on disk, so it needs no backup/restore and cannot leave a mutation
//      behind if an assertion throws mid-test.
//
// AC-STE-447.1 — `--legs` parses, defaults to every registered leg, restricts
//   the spawned set. Asserted against the fence's resolved output.
// AC-STE-447.2 — an unregistered value produces an NFR-10 refusal naming the
//   value and the supported set.
// AC-STE-447.3 — a zero-leg selection refuses BEFORE any spawn: no pidfile, no
//   log, no aggregation, the termination probe never reached, no status.
// AC-STE-447.4 — `--legs ""` and an all-unknown `--legs bogus` REFUSE; the
//   test fails if either reaches `STATUS=green`.
// AC-STE-447.5 — `--jira-project` is required only when `jira` is selected.
// AC-STE-447.6 — pre-flights (c)/(d)/(e)/(h) iterate the selection.
// AC-STE-447.7 — the Phase 0 wall-clock estimate no longer multiplies by legs.
// AC-STE-447.8 — `smoke_verdict.ts emit`'s usage names a shape rule, not a
//   closed two-value set.
// (AC-STE-447.9 lives in m98-ste-366-zsh-glob-fences.test.ts, with the pin it
//  replaces.)

import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SMOKE_LEGS } from "../adapters/_shared/src/smoke_fixture_groups";

const pluginRoot = join(import.meta.dir, "..");
const repoRoot = join(pluginRoot, "..", "..");

const LOOP_SKILL = join(repoRoot, ".claude", "skills", "conformance-loop", "SKILL.md");
const FIXTURE_CLI = join(pluginRoot, "adapters", "_shared", "src", "smoke_fixture_groups.ts");
const VERDICT_CLI = join(pluginRoot, "adapters", "_shared", "src", "smoke_verdict.ts");

/**
 * The driver SKILL is a repo-local dogfood skill, not a shipped plugin skill.
 * A consumer running this suite from an installed plugin has no
 * `.claude/skills/` tree, so these describes skip rather than fail.
 */
function readIfPresent(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf-8") : null;
}

const loop = readIfPresent(LOOP_SKILL);
const describeIfLoop = loop ? describe : describe.skip;

/** Every ```bash fence body in a SKILL, in document order. */
function bashFences(body: string): string[] {
  return [...body.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1]!);
}

/**
 * Every plain (unlabelled) ``` fence body — where canonical refusals live.
 *
 * A line-state scanner, not a regex. The regex form `/```\n([\s\S]*?)```/g`
 * looks right and is wrong: a ```bash fence's CLOSING delimiter is itself
 * "```\n", so the regex opens a phantom "plain fence" there and captures the
 * PROSE that follows until the next fence. Measured on this document: 26
 * regions for ~13 real plain fences, roughly half of them prose.
 *
 * Benign for the previous consumers, which still resolved — but a helper named
 * `plainFences` that returns prose is a trap for the next caller, and the
 * refusal-template check below now depends on it returning only fences.
 */
function plainFences(body: string): string[] {
  const out: string[] = [];
  let open: string | null = null;
  let buf: string[] = [];
  for (const line of body.split("\n")) {
    const fence = /^```(.*)$/.exec(line);
    if (fence === null) {
      if (open !== null) buf.push(line);
      continue;
    }
    if (open === null) {
      open = fence[1]!.trim();
      buf = [];
    } else {
      if (open === "") out.push(`${buf.join("\n")}\n`);
      open = null;
    }
  }
  return out;
}

// ===========================================================================
// The harness: extract pre-flight (0), run it, observe what it did.
// ===========================================================================

/**
 * The pre-flight (0) fence, located by the refusal token it emits rather than
 * by any leg it names. Locating it by a leg would reinstate exactly the
 * slicing technique STE-446 retired, and would stop finding the fence the day
 * that leg is renamed.
 */
function legsFence(): string {
  return bashFences(loop!).find((f) => f.includes("legs_zero_selection")) ?? "";
}

/**
 * The test-only continuation appended after the extracted fence. It stands in
 * for everything the guard must prevent: it materializes the per-leg artifacts
 * a spawn would create, and it prints the green status the termination probe
 * would report. Nothing here is part of the skill — this text deliberately
 * does NOT live in the SKILL, because a `STATUS=green` literal inside a fence
 * ahead of the termination section would be picked up by the `green`-probe
 * derivation surface in leg_prose_surfaces.ts and re-point it at this fence.
 */
const CONTINUATION = `
# --- test-only continuation: everything pre-flight (0) must prevent ---------
for SEL in \${SELECTED_LEGS}; do
  echo $$ > "\${OUTDIR}/iter-1-\${SEL}.pid"
  : > "\${OUTDIR}/iter-1-\${SEL}.log"
done
echo "STATUS=green"
`;

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
  /** Basenames of every artifact the continuation created, sorted. */
  artifacts: string[];
}

/**
 * Run the pre-flight (0) fence (optionally mutated) with `LEGS_ARG` either
 * unset or set to `legsArg`, followed by the continuation.
 */
function runFence(
  legsArg: string | undefined,
  mutate: (fence: string) => string = (f) => f,
  cwd: string = repoRoot,
): RunResult {
  const outDir = mkdtempSync(join(tmpdir(), "ste447-"));
  try {
    const script = `set -u\nOUTDIR=${JSON.stringify(outDir)}\n${mutate(legsFence())}${CONTINUATION}`;
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      PLUGIN_DIR: pluginRoot,
    };
    // UNSET is a distinct input from SET-BUT-EMPTY and the fence branches on
    // exactly that distinction, so it must be reproduced faithfully here.
    delete env.LEGS_ARG;
    if (legsArg !== undefined) env.LEGS_ARG = legsArg;

    const proc = Bun.spawnSync(["bash", "-c", script], { env, cwd });
    return {
      status: proc.exitCode ?? -1,
      stdout: proc.stdout.toString(),
      stderr: proc.stderr.toString(),
      artifacts: readdirSync(outDir).sort(),
    };
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

/** The legs the fence reports selecting, parsed from its success line. */
function selectedLegs(r: RunResult): string[] {
  const line = r.stdout.split("\n").find((l) => l.startsWith("legs_selected="));
  return line === undefined ? [] : line.slice("legs_selected=".length).trim().split(/\s+/).filter(Boolean);
}

// ===========================================================================
// Slice sanity — the extraction resolved, and the mutations bite.
// ===========================================================================

describeIfLoop("STE-447 slice sanity — the executed fence is really there", () => {
  test("pre-flight (0)'s fence is found and carries both refusal tokens", () => {
    // Without this, every assertion below would run against an empty script:
    // `bash -c ""` exits 0, writes nothing, and prints nothing — which would
    // satisfy the refusal tests for entirely the wrong reason.
    const fence = legsFence();
    expect(fence.length).toBeGreaterThan(500);
    expect(fence).toContain("legs_zero_selection");
    expect(fence).toContain("legs_unknown_value");
    expect(fence).toContain("legs_registry_unreadable");
  });

  test("the fence resolves the registered set from the authority module, not a literal", () => {
    // A hardcoded leg list in the guard would be a fourth copy of the leg set —
    // the second-hardcoded-copy failure STE-446 exists to have ended. The
    // fence must READ the authority, not restate it. (The identifier STE-446
    // deleted is deliberately not named here — its AC.1 pins a zero-hit grep
    // for that name across adapters/ and tests/.)
    const fence = legsFence();
    expect(fence).toContain("smoke_fixture_groups.ts");
    for (const leg of SMOKE_LEGS) {
      expect(fence).not.toContain(`"${leg}"`);
    }
  });

  test("the authority CLI's `legs` subcommand prints exactly SMOKE_LEGS", () => {
    const proc = Bun.spawnSync(["bun", FIXTURE_CLI, "legs"], { cwd: pluginRoot });
    expect(proc.exitCode).toBe(0);
    expect(proc.stdout.toString().trim().split(/\s+/)).toEqual([...SMOKE_LEGS]);
  });
});

// ===========================================================================
// AC-STE-447.1 — parsing, the all-legs default, and restriction.
// ===========================================================================

describeIfLoop("AC-STE-447.1 — --legs parses, defaults to all, restricts", () => {
  test("REACHABILITY ANCHOR: an omitted --legs selects every registered leg AND reaches the continuation", () => {
    // This is the test that gives every "no artifacts were written" assertion
    // below its meaning. It proves the continuation is wired up and DOES write
    // pidfiles and logs and DOES print the green line when the guard lets it
    // through. If this ever fails, the absence assertions are vacuous and the
    // suite says so here rather than staying quietly green.
    const r = runFence(undefined);
    expect(r.status).toBe(0);
    expect(selectedLegs(r)).toEqual([...SMOKE_LEGS]);
    expect(r.stdout).toContain("STATUS=green");
    expect(r.artifacts).toEqual(
      [...SMOKE_LEGS].flatMap((l) => [`iter-1-${l}.log`, `iter-1-${l}.pid`]).sort(),
    );
  });

  test("a named subset restricts the selection to exactly that subset", () => {
    const subset = SMOKE_LEGS.slice(0, 2);
    const r = runFence(subset.join(","));
    expect(r.status).toBe(0);
    expect(selectedLegs(r)).toEqual([...subset]);
    // …and the legs NOT named produced no artifacts at all.
    for (const leg of SMOKE_LEGS.filter((l) => !subset.includes(l))) {
      expect(r.artifacts).not.toContain(`iter-1-${leg}.pid`);
    }
  });

  test("a single-leg selection RESOLVES to exactly one leg (resolution only — the spawn fence is asserted separately below)", () => {
    const r = runFence(SMOKE_LEGS[0]!);
    expect(r.status).toBe(0);
    expect(selectedLegs(r)).toEqual([SMOKE_LEGS[0]!]);
    expect(r.artifacts).toEqual([`iter-1-${SMOKE_LEGS[0]!}.log`, `iter-1-${SMOKE_LEGS[0]!}.pid`]);
  });

  test("a repeated leg is de-duplicated rather than spawned twice", () => {
    const r = runFence(`${SMOKE_LEGS[0]!},${SMOKE_LEGS[0]!}`);
    expect(r.status).toBe(0);
    expect(selectedLegs(r)).toEqual([SMOKE_LEGS[0]!]);
  });
});

// ===========================================================================
// AC-STE-447.1, third clause — the SPAWN FENCE itself restricts.
// ===========================================================================

describeIfLoop("AC-STE-447.1 — the spawn fence spawns only the selected legs", () => {
  /**
   * WHY THIS EXISTS, stated bluntly because its absence shipped a defect.
   *
   * The AC.1 tests above run the pre-flight (0) fence plus a TEST-ONLY
   * continuation, so they prove `SELECTED_LEGS` RESOLVES correctly and nothing
   * more. One of them was even called "a single-leg selection spawns exactly
   * one leg" — a name asserting something no assertion in it checked, since
   * the artifacts it counted were written by the continuation, not by the
   * skill. Meanwhile the real Phase A fence carried three UNCONDITIONAL brace
   * groups and a comment asking the driver to skip excluded ones, so
   * `--legs linear` was a three-leg run for any reader that took the fence
   * literally. The flag did not do the thing its own title promised.
   *
   * This runs the ACTUAL spawn fence with `claude` and `bun` stubbed, and
   * asserts on the artifacts THE FENCE creates.
   */
  function spawnFence(): string {
    return bashFences(loop!).find((f) => f.includes("detached:")) ?? "";
  }

  /**
   * The spawn fence sets its OWN `ITER=<N>` and `DATE=$(date +%Y-%m-%d)`, so a
   * caller cannot simply export those — the fence overwrites them, every run
   * lands on the same real-date path, and two concurrent suite runs collide in
   * /tmp. Worse, `ITER=<N>` is a stdin REDIRECT from a file called `N`, not an
   * assignment, so `${ITER}` expands empty.
   *
   * Both substitutions are asserted to have applied. A silently-no-opping
   * mutation is indistinguishable from one that had no effect — the hazard
   * recorded in specs/notes/follow-ups.md § 0b — and here it would have made
   * every artifact land somewhere the assertions do not look, which reads as
   * "the fence spawned nothing" rather than as "the test is broken".
   */
  function spawnFenceWith(token: string): string {
    const fence = spawnFence();
    let out = fence.replace(/^ITER=<N>$/m, "ITER=1");
    if (out === fence) throw new Error("ITER placeholder not substituted — test would be vacuous");
    const before = out;
    out = out.replace(/^DATE=\$\(date [^)]*\)$/m, `DATE=${token}`);
    if (out === before) throw new Error("DATE assignment not substituted — test would be vacuous");
    return out;
  }

  interface SpawnRun {
    /** Legs whose `.log` the fence actually opened. */
    logs: string[];
    /** Legs whose `.pid` the fence actually wrote. */
    pids: string[];
  }

  let spawnSeq = 0;
  function runSpawnFence(selected: readonly string[]): SpawnRun {
    const token = `ste447spawn-${process.pid}-${spawnSeq++}`;
    const bin = mkdtempSync(join(tmpdir(), "ste447-bin-"));
    try {
      // Stub every external the fence reaches for. They must succeed, so a
      // missing artifact can only mean the group did not run.
      for (const cmd of ["claude", "bun"]) {
        const p = join(bin, cmd);
        writeFileSync(p, "#!/bin/sh\ncat >/dev/null 2>&1 || true\nexit 0\n", { mode: 0o755 });
      }
      const script = [
        "set -u",
        `export PATH=${JSON.stringify(bin)}:$PATH`,
        "LINEAR_TEAM=STE",
        "JIRA_PROJECT=DST",
        `SELECTED_LEGS=${JSON.stringify(selected.join(" "))}`,
        spawnFenceWith(token),
        "wait",
      ].join("\n");
      Bun.spawnSync(["bash", "-c", script], { cwd: repoRoot });

      const seen = (ext: string) =>
        SMOKE_LEGS.filter((leg) =>
          existsSync(`/tmp/dpt-conformance-loop-${token}-iter-1-${leg}.${ext}`),
        );
      const out = { logs: seen("log"), pids: seen("pid") };
      for (const leg of SMOKE_LEGS) {
        for (const ext of ["log", "pid", "rc"]) {
          rmSync(`/tmp/dpt-conformance-loop-${token}-iter-1-${leg}.${ext}`, { force: true });
        }
      }
      return out;
    } finally {
      rmSync(bin, { recursive: true, force: true });
    }
  }

  test("slice sanity: the Phase A spawn fence resolves and carries a group per registered leg", () => {
    const fence = spawnFence();
    expect(fence.length).toBeGreaterThan(500);
    for (const leg of SMOKE_LEGS) expect(fence).toContain(`--tracker ${leg}`);
  });

  test("REACHABILITY ANCHOR: the full selection opens a log and a pidfile for every leg", () => {
    // Without this the restriction assertions below could pass because the
    // fence produces nothing under any input.
    const r = runSpawnFence(SMOKE_LEGS);
    expect(r.logs).toEqual([...SMOKE_LEGS]);
    expect(r.pids).toEqual([...SMOKE_LEGS]);
  });

  test("--legs linear spawns ONLY linear — no jira log, no none log, no pidfiles", () => {
    // The assertion the FR's title promised and the earlier tests did not make.
    const only = SMOKE_LEGS[0]!;
    const r = runSpawnFence([only]);
    expect(r.logs).toEqual([only]);
    expect(r.pids).toEqual([only]);
    for (const leg of SMOKE_LEGS.filter((l) => l !== only)) {
      expect(r.logs).not.toContain(leg);
      expect(r.pids).not.toContain(leg);
    }
  });

  test("a two-leg selection spawns exactly those two", () => {
    const subset = SMOKE_LEGS.slice(0, 2);
    const r = runSpawnFence(subset);
    expect(r.pids).toEqual([...subset]);
  });

  test("FALSIFIABILITY: strip the membership wrappers and every leg spawns again", () => {
    // The named RED input for this AC. Removing the `case ... in *" <leg> "*)`
    // wrappers restores the pre-fix fence — three unconditional groups — and a
    // single-leg selection spawns all three. This is what the shipped defect
    // looked like, kept as a standing witness rather than a memory.
    const token = `ste447strip-${process.pid}`;
    const stripped = spawnFenceWith(token)
      .replace(/^case " \$\{SELECTED_LEGS\} " in \*" [a-z]+ "\*\)\n/gm, "")
      .replace(/^;; esac\n/gm, "");
    expect(stripped).not.toBe(spawnFenceWith(token));
    const bin = mkdtempSync(join(tmpdir(), "ste447-bin-"));
    try {
      for (const cmd of ["claude", "bun"]) {
        writeFileSync(join(bin, cmd), "#!/bin/sh\ncat >/dev/null 2>&1 || true\nexit 0\n", { mode: 0o755 });
      }
      Bun.spawnSync(["bash", "-c", [
        "set -u",
        `export PATH=${JSON.stringify(bin)}:$PATH`,
        "LINEAR_TEAM=STE", "JIRA_PROJECT=DST",
        `SELECTED_LEGS=${JSON.stringify(SMOKE_LEGS[0]!)}`,
        stripped, "wait",
      ].join("\n")], { cwd: repoRoot });

      const spawned = SMOKE_LEGS.filter((leg) =>
        existsSync(`/tmp/dpt-conformance-loop-${token}-iter-1-${leg}.log`),
      );
      // Every leg, despite a single-leg selection — the defect, reproduced.
      expect(spawned).toEqual([...SMOKE_LEGS]);
      for (const leg of SMOKE_LEGS) {
        for (const ext of ["log", "pid", "rc"]) {
          rmSync(`/tmp/dpt-conformance-loop-${token}-iter-1-${leg}.${ext}`, { force: true });
        }
      }
    } finally {
      rmSync(bin, { recursive: true, force: true });
    }
  });
});

// ===========================================================================
// AC-STE-447.2 — the unknown-value refusal.
// ===========================================================================

describeIfLoop("AC-STE-447.2 — an unregistered --legs value refuses by name", () => {
  test("refuses non-zero, naming the offending value AND the supported set", () => {
    const r = runFence("bogus");
    expect(r.status).not.toBe(0);
    // The SPECIFIC refusal, not merely a non-zero status: a crash for an
    // unrelated reason also exits non-zero.
    expect(r.stderr).toContain("pre-flight=legs_unknown_value");
    expect(r.stderr).toContain("bogus");
    for (const leg of SMOKE_LEGS) expect(r.stderr).toContain(leg);
    expect(r.stderr).toMatch(/^Unknown --legs value\(s\)/m);
    expect(r.stderr).toMatch(/^Remedy:/m);
    expect(r.stderr).toMatch(/^Context: skill=conformance-loop/m);
  });

  test("a partially-valid selection refuses on the unknown member rather than proceeding on the valid one", () => {
    // The fail-open reading — "take what you recognize" — would spawn a
    // silently reduced run the operator never asked for.
    const r = runFence(`${SMOKE_LEGS[0]!},bogus`);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("pre-flight=legs_unknown_value");
    expect(r.stdout).not.toContain("STATUS=green");
    expect(r.artifacts).toEqual([]);
  });

  /**
   * Run the fence from a scratch directory containing one FILE NAMED AFTER
   * EVERY REGISTERED LEG.
   *
   * This is the whole point. The earlier version of the glob test ran from the
   * toolkit repo root, which happens to contain no file called `linear` — so
   * `--legs '*'` expanded to a list of unrelated filenames, every one of them
   * unregistered, and the refusal fired for a reason that had nothing to do
   * with the guard under test. It passed while the guard it named was
   * unreachable. A test whose subject is pathname expansion has to control the
   * directory the expansion reads.
   */
  function runFenceInLegNamedDir(legsArg: string): RunResult {
    const dir = mkdtempSync(join(tmpdir(), "ste447-glob-"));
    try {
      for (const leg of SMOKE_LEGS) writeFileSync(join(dir, leg), "");
      return runFence(legsArg, (f) => f, dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  test("`*` is an unknown value even when the cwd contains files named after every leg", () => {
    // Measured before the fix: this returned SELECTED=[linear jira none] with
    // an EMPTY unknown list — the operator's `*` silently resolved to a full
    // selection drawn from whatever happened to be on disk. Pre-flight (0)
    // runs before (a)'s cwd probe, so that directory is not even verified yet.
    const r = runFenceInLegNamedDir("*");
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("pre-flight=legs_unknown_value");
    expect(r.stdout).not.toContain("legs_selected=");
    expect(r.artifacts).toEqual([]);
  });

  test("a PARTIAL glob that matches a real leg filename is still refused", () => {
    // The sharper half, and the one the first fix attempt would have missed:
    // `li?ear` matches a file named `linear`, so with globbing on it resolved
    // to `legs_selected=linear` — an unregistered value admitted as a
    // registered one. Any glob that matches ANYTHING bypassed the guard, not
    // just `*`.
    const leg = SMOKE_LEGS[0]!;
    const wildcarded = `${leg.slice(0, 2)}?${leg.slice(3)}`;
    const r = runFenceInLegNamedDir(wildcarded);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("pre-flight=legs_unknown_value");
    expect(r.stderr).toContain(wildcarded);
    expect(r.stdout).not.toContain("legs_selected=");
  });

  test("NON-VACUITY: a valid selection still resolves from that same directory", () => {
    // Proves the leg-named scratch directory is not simply breaking the fence
    // for unrelated reasons — without this, both tests above could pass
    // because nothing works there at all.
    const dir = mkdtempSync(join(tmpdir(), "ste447-glob-ok-"));
    try {
      for (const leg of SMOKE_LEGS) writeFileSync(join(dir, leg), "");
      const r = runFence(SMOKE_LEGS[0]!, (f) => f, dir);
      expect(r.status).toBe(0);
      expect(selectedLegs(r)).toEqual([SMOKE_LEGS[0]!]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ===========================================================================
// AC-STE-447.3 + AC-STE-447.4 — the zero-leg guard, and the proof it holds.
// ===========================================================================

describeIfLoop("AC-STE-447.3/.4 — a zero-leg selection refuses before any spawn", () => {
  test('--legs "" refuses with the SPECIFIC zero-selection refusal', () => {
    const r = runFence("");
    expect(r.status).not.toBe(0);
    // Specific, not merely non-zero. AC.4's Technical Design is explicit that
    // a weaker "exited non-zero" assertion would be satisfied by an unrelated
    // crash and would therefore prove nothing.
    expect(r.stderr).toContain("pre-flight=legs_zero_selection");
    expect(r.stderr).toContain("resolved=[]");
    expect(r.stderr).toMatch(/^--legs resolved to zero legs/m);
    expect(r.stderr).toMatch(/^Context: skill=conformance-loop/m);
  });

  test('--legs "" NEVER reaches STATUS=green', () => {
    expect(runFence("").stdout).not.toContain("STATUS=green");
  });

  test("an all-unknown --legs NEVER reaches STATUS=green", () => {
    expect(runFence("bogus").stdout).not.toContain("STATUS=green");
    expect(runFence("bogus,alsobogus").stdout).not.toContain("STATUS=green");
  });

  test("ABSENCE OF SIDE EFFECTS: neither refusal path writes a pidfile or opens a log", () => {
    // This is what distinguishes refused-BEFORE-spawn from failed-AFTER-spawn.
    // A run that spawned and then died non-zero would leave these behind.
    for (const arg of ["", "bogus", "bogus,alsobogus", "*"]) {
      const r = runFence(arg);
      expect(r.artifacts).toEqual([]);
    }
  });

  test("no status of any kind is reported on a refusal path", () => {
    for (const arg of ["", "bogus"]) {
      expect(runFence(arg).stdout).not.toMatch(/STATUS=/);
      expect(runFence(arg).stdout).not.toContain("legs_selected=");
    }
  });

  test("an unreadable authority module refuses rather than resolving to an empty set", () => {
    // Reading an unreadable registry as "zero legs" would route it straight
    // into the vacuous-green path. It must be its own refusal.
    const r = runFence(undefined, (f) =>
      f.replace("${PLUGIN_DIR}/adapters/_shared/src/smoke_fixture_groups.ts", "/nonexistent/nope.ts"),
    );
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("pre-flight=legs_registry_unreadable");
    expect(r.artifacts).toEqual([]);
    expect(r.stdout).not.toContain("STATUS=green");
  });
});

// ===========================================================================
// Ordering — the guard fires before ANYTHING that touches the filesystem.
// ===========================================================================

describeIfLoop("STE-447 — pre-flight (0) is ordered before every side effect", () => {
  /**
   * Byte offset of the pre-flight (0) fence in the document. Document order
   * IS execution order in a driver SKILL — the model reads it top to bottom —
   * so an offset comparison is the real ordering check, not a proxy for one.
   */
  function guardOffset(): number {
    const fence = legsFence();
    expect(fence.length).toBeGreaterThan(0);
    return loop!.indexOf(fence);
  }

  /**
   * Every SHELL construct in this driver that creates, removes or spawns
   * something.
   *
   * Scoped to bash-fence bodies, and the scoping was forced by measurement
   * rather than chosen up front. The first version of this check ran the
   * markers over raw document text and reported `claude -p` at offset 4495,
   * ahead of the guard — which turned out to be the `--dry-run` bullet's
   * prose, "…without invoking real `claude -p` children". A sentence
   * MENTIONING a spawn is not a spawn. Prose write-INSTRUCTIONS are covered
   * separately below, so narrowing here drops a false positive without
   * dropping coverage.
   */
  const FENCE_SIDE_EFFECTS: ReadonlyArray<[string, RegExp]> = [
    ["child spawn", /\bclaude -p\b/],
    ["log redirect", />\s*"?\$\{?LOG_/],
    ["pidfile write", /echo \$! >/],
    ["rc-file redirect", />\s*"?\$\{?RC_FILE_/],
    ["remove", /\brm -[rf]/],
    ["git mutation", /\bgit (clean|checkout)\b/],
  ];

  /** Prose that INSTRUCTS a write, as opposed to prose that mentions one. */
  const PROSE_WRITE_INSTRUCTIONS: ReadonlyArray<[string, string]> = [
    ["approval-log write", "log the approval to `/tmp/dpt-conformance-loop-"],
    ["capability-token write", "log the capability-row tokens"],
  ];

  test("no side-effecting shell construct appears in a fence earlier than the guard", () => {
    const guard = guardOffset();
    for (const fence of bashFences(loop!)) {
      const at = loop!.indexOf(fence);
      if (at >= guard) continue;
      for (const [name, re] of FENCE_SIDE_EFFECTS) {
        expect(
          re.test(fence),
          `${name} in a fence at offset ${at} — BEFORE pre-flight (0) at ${guard}`,
        ).toBe(false);
      }
    }
  });

  test("no prose write-instruction precedes the guard", () => {
    const guard = guardOffset();
    const before = loop!.slice(0, guard);
    for (const [name, needle] of PROSE_WRITE_INSTRUCTIONS) {
      expect(before.includes(needle), `${name} precedes the guard`).toBe(false);
    }
  });

  test("NON-VACUITY: every marker demonstrably fires somewhere after the guard", () => {
    // Without this, a marker whose regex never matches anything would make
    // the ordering assertions above pass for free — the exact shape of
    // can't-fail assertion this milestone exists to eliminate. The `truncate`
    // and `mkdir` markers the first draft carried were removed because this
    // test caught them: they matched nothing in the driver at all.
    const guard = guardOffset();
    const laterFences = bashFences(loop!).filter((f) => loop!.indexOf(f) >= guard);
    for (const [name, re] of FENCE_SIDE_EFFECTS) {
      expect(
        laterFences.some((f) => re.test(f)),
        `${name} never matches any later fence — marker is dead`,
      ).toBe(true);
    }
    const after = loop!.slice(guard);
    for (const [name, needle] of PROSE_WRITE_INSTRUCTIONS) {
      expect(after.includes(needle), `${name} never occurs — needle is dead`).toBe(true);
    }
  });

  test("the guard precedes pre-flight (a), the first lettered refusal", () => {
    expect(guardOffset()).toBeLessThan(loop!.indexOf("(a) **Toolkit-repo cwd"));
  });

  test("the guard precedes the Phase 0 pre-approval gate and Phase A entirely", () => {
    const guard = guardOffset();
    expect(guard).toBeLessThan(loop!.indexOf("### Phase 0 — Pre-approval gate"));
    expect(guard).toBeLessThan(loop!.indexOf("### Phase A"));
  });
});

// ===========================================================================
// FALSIFIABILITY WITNESSES — the guards' absence is observable.
// ===========================================================================

describeIfLoop("STE-447 falsifiability — with the guard removed, the loop DOES go green", () => {
  /** Delete the zero-selection guard block from the fence. */
  function stripZeroGuard(fence: string): string {
    const stripped = fence.replace(
      /if \[ -z "\$\{SELECTED_LEGS\}" \];[\s\S]*?\nfi\n/,
      "",
    );
    // A replacement that silently failed to match would leave the guard in
    // place and this witness would "pass" by asserting the guard works — the
    // exact inversion that makes a witness worthless. Fail loudly instead.
    if (stripped === fence) throw new Error("zero-leg guard block not located — witness is vacuous");
    return stripped;
  }

  /** Delete the unknown-value refusal block from the fence. */
  function stripUnknownGuard(fence: string): string {
    const stripped = fence.replace(
      /if \[ -n "\$\{UNKNOWN_LEGS\}" \];[\s\S]*?\n  fi\n/,
      "",
    );
    if (stripped === fence) throw new Error("unknown-value guard block not located — witness is vacuous");
    return stripped;
  }

  test("RED-producing input: removing the zero-leg guard makes `--legs \"\"` report green", () => {
    // THIS is the named mutation that turns the AC.4 tests above red. It is a
    // standing test over an in-memory mutation rather than a probe against the
    // file on disk: no backup, no restore, nothing left behind if it throws.
    const r = runFence("", stripZeroGuard);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("STATUS=green");
    // …and it goes green having created NOTHING — the vacuous-pass shape
    // stated in its purest form: zero artifacts, zero findings, green.
    expect(r.artifacts).toEqual([]);
  });

  test("RED-producing input: removing the unknown-value refusal makes `--legs bogus` report green", () => {
    const r = runFence("bogus", (f) => stripZeroGuard(stripUnknownGuard(f)));
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("STATUS=green");
    expect(r.artifacts).toEqual([]);
  });

  test("with the unknown-value refusal removed but the zero-leg guard intact, the zero-leg guard still catches it", () => {
    // Defence in depth, measured rather than assumed: the two guards close
    // overlapping routes to the same empty set, and the second one holds
    // alone. This is why `--legs bogus` is safe even if the value check is
    // ever narrowed.
    const r = runFence("bogus", stripUnknownGuard);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("pre-flight=legs_zero_selection");
    expect(r.stdout).not.toContain("STATUS=green");
  });
});

// ===========================================================================
// Documented refusal text vs. what the fence actually prints.
// ===========================================================================

describeIfLoop("STE-447 — the documented refusals are the refusals that fire", () => {
  /** The canonical refusal templates quoted in plain fences in the (0) block. */
  function documentedContextLines(): string[] {
    return plainFences(loop!)
      .flatMap((f) => f.split("\n"))
      .filter((l) => l.startsWith("Context: skill=conformance-loop, pre-flight=legs_"));
  }

  test("slice sanity: EVERY leg-selection refusal the fence can emit is documented", () => {
    // DERIVED, not a literal count. The first form hard-asserted
    // `toHaveLength(2)` while the fence could emit THREE refusal tokens — the
    // third, `legs_registry_unreadable`, existed only inside the bash fence
    // with no canonical template above it. That is a green test PINNING A
    // DOCUMENTATION HOLE OPEN: documenting the missing refusal would have
    // turned it RED, so the test actively defended the gap it should have
    // caught. Same shape as the archive hole at ac_prefix.test.ts:174-204.
    //
    // Now the expectation is computed from the fence itself, so a refusal
    // added to the implementation without a template is RED by construction.
    const emitted = [...legsFence().matchAll(/pre-flight=(legs_[a-z_]+)/g)]
      .map((m) => m[1]!);
    const emittedTokens = [...new Set(emitted)].sort();
    expect(emittedTokens.length).toBeGreaterThan(0);

    const documented = documentedContextLines()
      .map((l) => /pre-flight=(legs_[a-z_]+)/.exec(l)?.[1] ?? "")
      .filter(Boolean)
      .sort();
    expect([...new Set(documented)]).toEqual(emittedTokens);
  });

  test("each documented Context: line is emitted verbatim by the executed fence", () => {
    // Prose-vs-implementation drift becomes RED instead of invisible: the
    // paragraph and the snippet under it are now bound by execution.
    //
    // All THREE refusal paths are driven, including the registry-unreadable
    // one. Driving only the two easy ones is what let the third ship with no
    // canonical template at all.
    const unreadable = runFence(undefined, (f) =>
      f.replace(
        "${PLUGIN_DIR}/adapters/_shared/src/smoke_fixture_groups.ts",
        "/nonexistent/nope.ts",
      ),
    );
    const emitted = [
      runFence("").stderr,
      runFence("bogus").stderr,
      unreadable.stderr,
    ].join("\n");
    for (const documented of documentedContextLines()) {
      // The templates carry <placeholders>; compare the stable prefix through
      // the pre-flight token, which is the part that identifies the refusal.
      const prefix = documented.split(",").slice(0, 2).join(",");
      expect(emitted).toContain(prefix);
    }
  });
});

// ===========================================================================
// AC-STE-447.5 / .6 — conditional --jira-project, per-leg pre-flights.
// ===========================================================================

describeIfLoop("AC-STE-447.5 — --jira-project is required only when jira is selected", () => {
  /** The `## Pre-flight refusals` section body. */
  function preflightSection(): string {
    const start = loop!.indexOf("## Pre-flight refusals");
    const end = loop!.indexOf("\n## ", start + 1);
    return end === -1 ? loop!.slice(start) : loop!.slice(start, end);
  }

  test("refusal (d) is scoped to a selection containing jira", () => {
    const d = preflightSection();
    const idx = d.indexOf("(d) **Atlassian MCP");
    expect(idx).toBeGreaterThan(-1);
    const block = d.slice(idx, d.indexOf("\n(e) ", idx));
    expect(block).toMatch(/only when `jira` is in `SELECTED_LEGS`/);
  });

  test("the non-refusing example the AC names is stated explicitly", () => {
    expect(loop!).toContain("--legs linear,none");
    expect(preflightSection()).toMatch(
      /`--legs linear,none` without `--jira-project` must proceed/,
    );
  });

  test("the argument-parsing bullet no longer calls --jira-project unconditionally required", () => {
    const start = loop!.indexOf("## Argument parsing");
    const block = loop!.slice(start, loop!.indexOf("\n## ", start + 1));
    expect(block).toMatch(/--jira-project KEY[^\n]*required only when/);
  });
});

describeIfLoop("AC-STE-447.6 — pre-flights (c)/(d)/(e)/(h) iterate the selection", () => {
  function refusalBlock(letter: string, nextMarker: string): string {
    const start = loop!.indexOf(`(${letter}) **`);
    expect(start).toBeGreaterThan(-1);
    const end = loop!.indexOf(nextMarker, start);
    return end === -1 ? loop!.slice(start) : loop!.slice(start, end);
  }

  for (const [letter, next] of [
    ["c", "\n(d) "],
    ["d", "\n(e) "],
    ["e", "\n(f) "],
    ["h", "\nEach refusal above"],
  ] as const) {
    test(`refusal (${letter}) names SELECTED_LEGS rather than a hardcoded pair`, () => {
      const block = refusalBlock(letter, next);
      expect(block).toContain("SELECTED_LEGS");
    });
  }

  test("refusal (h)'s remedy iterates the selection instead of two literal paths", () => {
    const block = refusalBlock("h", "\nEach refusal above");
    expect(block).toMatch(/for SEL in \$\{SELECTED_LEGS\}/);
    expect(block).toContain("../dpt-test-project-${SEL}");
  });

  test("the lettered refusals were NOT re-lettered", () => {
    // Every by-letter cross-reference in this file, in /smoke-test and across
    // the test suite assumes (a)…(h) mean what they always meant. Pre-flight
    // (0) is unlettered precisely so that stays true.
    for (const letter of ["a", "b", "c", "d", "e", "f", "g", "h"]) {
      expect(loop!).toContain(`(${letter}) **`);
    }
    expect(loop!).toContain("(0) **Leg selection");
  });
});

// ===========================================================================
// AC-STE-447.7 — the wall-clock estimate.
// ===========================================================================

describeIfLoop("AC-STE-447.7 — the wall-clock estimate does not multiply by leg count", () => {
  /** The `## When to use` bullet that quotes the estimate. */
  function whenToUseEstimate(): string {
    return (
      loop!.split("\n").find((l) => l.includes("wall-clock per run")) ?? ""
    );
  }

  /**
   * The Phase 0 operator-contract FENCE — the block the operator actually
   * reads at the prompt, not the whole Phase 0 section.
   *
   * The section-level slice was tried first and was still too coarse: it
   * swallows the correction paragraph that quotes the superseded form, so it
   * collided with the same documentation for the same reason as the
   * whole-document form. The fence is the surface that PRESENTS an estimate;
   * the paragraph above it explains one.
   */
  function phase0Contract(): string {
    const start = loop!.indexOf("### Phase 0 — Pre-approval gate");
    const section = loop!.slice(start, loop!.indexOf("\n### ", start + 1));
    return plainFences(section).find((f) => f.includes("Proceed? [y/n]")) ?? "";
  }

  test("no leg-count multiplier survives on any surface that PRESENTS the estimate", () => {
    // NARROWED DELIBERATELY, and the narrowing is the finding.
    //
    // The first form of this assertion was a whole-document ban:
    // `expect(loop!).not.toMatch(/~10 min[^\n]*×\s*\d/)`. It went RED — on
    // THIS FR's own correction paragraph, which quotes the superseded
    // `max-iterations × ~10 min × 2 trackers` form in order to say what was
    // wrong with it. That is the fifth instance in M121 of a textual pin
    // colliding with the prose that explains it, and the settled resolution
    // in this codebase is to narrow the pin to the real hazard rather than
    // delete the documentation: the broad form taxes documentation accuracy
    // and the prose loses.
    //
    // The real hazard is an estimate that multiplies by leg count on a
    // surface an operator reads as CURRENT. A historical quotation inside a
    // sentence labelled "the previous form … was already wrong" is not that.
    // `× ~10 min` is fine; `× 2`, `× 3`, `× N` are the shape being banned.
    const surfaces: ReadonlyArray<[string, string]> = [
      ["When-to-use bullet", whenToUseEstimate()],
      ["Phase 0 contract", phase0Contract()],
    ];
    for (const [name, surface] of surfaces) {
      expect(surface.length, `${name} slice resolved`).toBeGreaterThan(50);
      expect(surface).not.toMatch(/×\s*[\dN]/);
    }
  });

  test("the superseded form survives ONLY where it is labelled superseded", () => {
    // Strictly stronger than the blanket ban it replaces: the quotation is
    // permitted, and it is pinned to stay labelled. Re-introducing
    // `× 2 trackers` as a live estimate lands on a line with no supersession
    // marker and turns this RED.
    const lines = loop!.split("\n").filter((l) => l.includes("× 2 trackers"));
    // Non-vacuity: if the explanatory sentence is ever deleted, this test
    // stops having anything to check and says so rather than passing free.
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).toMatch(/previous form|was already wrong/);
    }
  });

  test("the Phase 0 contract states the leg-independent form", () => {
    const start = loop!.indexOf("### Phase 0 — Pre-approval gate");
    const block = loop!.slice(start, loop!.indexOf("\n### ", start + 1));
    expect(block).toContain("Estimated max wall-clock: <max-iterations × ~10 min>");
    expect(block).toMatch(/leg count does not enter this product/);
  });

  test("the reason is stated, not just the corrected number", () => {
    // A corrected constant with no rationale drifts back the next time someone
    // reasons "three legs, three times the time".
    expect(loop!).toMatch(/SLOWEST leg/);
  });
});

// ===========================================================================
// AC-STE-447.8 — smoke_verdict emit usage names a shape rule.
// ===========================================================================

describe("AC-STE-447.8 — `emit`'s usage states the shape rule it enforces", () => {
  function runEmitWithoutTracker(): { status: number; stderr: string } {
    const proc = Bun.spawnSync(["bun", VERDICT_CLI, "emit"], { cwd: pluginRoot });
    return { status: proc.exitCode ?? -1, stderr: proc.stderr.toString() };
  }

  test("the usage line no longer names a closed two-value set", () => {
    const { status, stderr } = runEmitWithoutTracker();
    expect(status).toBe(2);
    expect(stderr).toContain("usage: bun smoke_verdict.ts emit");
    expect(stderr).not.toContain("<linear|jira>");
  });

  test("it states the shape rule the guard actually applies", () => {
    const { stderr } = runEmitWithoutTracker();
    expect(stderr).toContain("[A-Za-z0-9][A-Za-z0-9_-]*");
    expect(stderr).toMatch(/validated by SHAPE, not by membership/);
  });

  test("the documented rule is TRUE — a leg outside any historic pair is accepted", () => {
    // The old usage string was wrong in both directions: it named a set the
    // guard never checked, AND that set excluded a leg the CLI has accepted
    // since STE-446. Executed rather than asserted.
    const tmp = mkdtempSync(join(tmpdir(), "ste447-emit-"));
    try {
      const out = join(tmp, "verdict.json");
      const proc = Bun.spawnSync(
        ["bun", VERDICT_CLI, "emit", "--tracker", SMOKE_LEGS[SMOKE_LEGS.length - 1]!, "--path", out],
        { cwd: pluginRoot },
      );
      expect(proc.exitCode).toBe(0);
      expect(existsSync(out)).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ===========================================================================
// The restated refusal-anchor count is machine-checked, not hand-maintained.
// ===========================================================================

describeIfLoop("STE-447 — the pre-flight section's own anchor count is derived", () => {
  test("the number the prose states equals the number of anchors present", () => {
    // The previous revision of that sentence claimed "ten markers … nine
    // refusal anchors" while the section carried nine anchors and thirteen
    // mentions. Nothing recomputed it, so it drifted silently. This does.
    const start = loop!.indexOf("## Pre-flight refusals");
    const section = loop!.slice(start, loop!.indexOf("\n## Flow", start));

    const stated = /There are \*\*(\d+) refusal anchors\*\*/.exec(section);
    expect(stated).not.toBeNull();

    // An anchor is a mention that INTRODUCES a refusal — it is followed by a
    // fenced refusal template. The summary sentence's own three mentions are
    // not anchors, and are excluded by that rule rather than by subtraction.
    const anchors = section
      .split("\n")
      .filter(
        (line) =>
          line.includes("NFR-10 canonical refusal") &&
          line.trimEnd().endsWith(":"),
      ).length;

    expect(anchors).toBe(Number(stated![1]));
  });
});
