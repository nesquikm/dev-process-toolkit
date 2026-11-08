// STE-715 (M_7bc805) — the outcome front door, the ran receipt with the switch
// on, the switch-off byte identity, key errors, and the skill needles.
//
// AC.3, AC.4, AC.5, AC.6, AC.9 (needles + re-base), AC.13, AC.17 live here.
// Every receipt is written by SPAWNING the shipped CLI; every hook is driven
// through its shipped wrapper. Every spawn is serial.
//
// AC.11 mutation anchors in this file:
//   - removing the `key_stable` comparison        -> "AC.6 an unstaged edit between run and outcome records key_stable: false"
//   - removing the receipt CLI's switch check     -> "AC.13 switch off: recordGateRun writes evidence { head } ..." and
//                                                    "AC.13 switch off: the receipt CLI prints exactly its v3.0.0 line"
//   - removing the outcome front door's off-check -> "AC.13 switch off: the outcome CLI exits 0 silently and writes nothing"
//   - printing `outcome: on` with the switch off  -> "AC.13 switch off: the receipt CLI prints exactly its v3.0.0 line"
//   - letting a key error refuse the receipt      -> "AC.17 an unreadable manifest degrades ..."
//   - dropping the `--step` name pattern          -> "AC.5 unknown-outcome: a step name holding a backtick" / "... `$(`"
//   - computing the key before `.dpt/.gitignore`  -> "AC.6 a bare repository with no .dpt/ before the run records key_stable: true"
//
// AC.17 design note: the key's `plugin` field reads the manifest of the plugin
// the front door RUNS FROM (`<front door>/../../..`), while the settings loader
// keeps reading `CLAUDE_PLUGIN_ROOT`. In a real session the two are the same
// plugin; the test separates them so a manifest the key cannot read does not
// also turn the switch off through the loader's version-floor check.

import { afterAll, describe, expect, spyOn, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  HOOKS,
  PLUGIN_REL,
  PLUGIN_ROOT,
  REPO_ROOT,
  SHORT_OF,
  SID,
  V300,
  atV300,
  bashCall,
  cleanupTemps,
  git,
  makeTree,
  mentionRuleViolations,
  mintRun,
  parseAnnouncement,
  pluginCopy,
  readJson,
  receiptCommand,
  receiptDirOf,
  receiptFiles,
  runCli,
  runHook,
  sentences,
  skillCall,
  stageCodeAndTest,
  tempDir,
  writeTranscript,
  type SwitchState,
} from "./_m_7bc805_gate_outcome_fixture";

type AnyMod = Record<string, any>;
const T = 120_000;

afterAll(cleanupTemps);

const sha = (bytes: string | Buffer): string => createHash("sha256").update(bytes).digest("hex");
const KEY_FIELDS = ["bun", "clean", "commands", "head", "plugin", "settings", "v", "worktree"];

async function reuseKeyModule(): Promise<AnyMod> {
  return (await import("../adapters/_shared/src/gate_reuse_key")) as AnyMod;
}
async function receiptModule(): Promise<AnyMod> {
  return (await import("../adapters/_shared/src/gate_receipt")) as AnyMod;
}

function outcome(root: string, skill: string, verdict: string, steps: string[] = [], extra: string[] = []) {
  return runCli(["outcome", skill, root, verdict, ...steps.flatMap((s) => ["--step", s]), ...extra]);
}

function expectRefusal(r: { exitCode: number; stdout: string; stderr: string }, reason: string): void {
  expect(r.exitCode).toBe(1);
  expect(r.stdout).toBe("");
  expect(r.stderr).toContain("Refusing:");
  expect(r.stderr).toContain("Remedy:");
  expect(r.stderr).toContain("Context:");
  expect(r.stderr).toContain(`reason=${reason}`);
}

function onlyOutcomeFile(root: string, before: string[]): string {
  const added = receiptFiles(root).filter((n) => !before.includes(n));
  expect(added.length).toBe(1);
  return join(receiptDirOf(root), added[0]!);
}

// ===========================================================================
// AC-STE-715.3 — the ran receipt with the switch on
// ===========================================================================

describe("AC-STE-715.3 the ran receipt carries the key with the switch on", () => {
  test("evidence is exactly { head, key, key_digest }, head unchanged, key_digest = reuseKeyDigest(key)", async () => {
    const root = makeTree("ran-on", "on");
    const { path } = mintRun(root);
    const r = readJson(path);
    expect(r.kind).toBe("gate");
    expect(r.decision).toBe("ran");
    const ev = r.evidence as Record<string, any>;
    expect(Object.keys(ev).sort()).toEqual(["head", "key", "key_digest"]);
    expect(ev.head).toBe(git(root, "rev-parse", "HEAD").trim());
    expect(Object.keys(ev.key).sort()).toEqual(KEY_FIELDS);
    expect(ev.key.head).toBe(ev.head);
    const m = await reuseKeyModule();
    expect(ev.key_digest).toBe(m.reuseKeyDigest(ev.key));
    expect(ev.key_digest).toMatch(/^sha256:[0-9a-f]{64}$/);
  }, T);

  test("the key is computed after `.dpt/.gitignore` is created: it lists that file as untracked (clean: false)", () => {
    const root = makeTree("ran-gitignore", "on");
    expect(existsSync(join(root, ".dpt"))).toBe(false);
    const { path } = mintRun(root);
    const ev = readJson(path).evidence as Record<string, any>;
    expect(existsSync(join(root, ".dpt", ".gitignore"))).toBe(true);
    expect(ev.key.clean).toBe(false);
  }, T);
});

// ===========================================================================
// AC-STE-715.4 — one gate-outcome receipt, announced once
// ===========================================================================

describe("AC-STE-715.4 the outcome CLI records one gate-outcome receipt", () => {
  test("fields, the one dpt-gate-outcome line, its digest, exit 0", async () => {
    const root = makeTree("outcome-ok", "on");
    const run = mintRun(root);
    const before = receiptFiles(root);
    const r = outcome(root, "gate-check", "pass", ["lint=pass", "tests=fail"]);
    expect({ code: r.exitCode, err: r.stderr }).toEqual({ code: 0, err: "" });
    const lines = r.stdout.split("\n");
    expect(lines.length).toBe(2);
    expect(lines[1]).toBe("");
    expect(lines[0]!.startsWith("dpt-receipt: ")).toBe(false);
    const ann = parseAnnouncement(lines[0]!, "dpt-gate-outcome: ");
    expect(ann).not.toBeNull();
    const file = onlyOutcomeFile(root, before);
    expect(ann!.path).toBe(file);
    expect(ann!.digest).toBe(sha(readFileSync(file)));

    const rec = readJson(file);
    expect(rec.kind).toBe("gate-outcome");
    expect(rec.subject).toBe("dev-process-toolkit:gate-check");
    expect(rec.decision).toBe("pass");
    expect(rec.sessionId).toBe(SID);
    const ev = rec.evidence as Record<string, any>;
    expect(Object.keys(ev).sort()).toEqual(["key", "key_digest", "key_stable", "run", "steps"]);
    expect(ev.run).toBe(sha(readFileSync(run.path)));
    expect(Object.keys(ev.key).sort()).toEqual(KEY_FIELDS);
    const m = await reuseKeyModule();
    expect(ev.key_digest).toBe(m.reuseKeyDigest(ev.key));
    expect(ev.key_stable).toBe(true);
    expect(ev.key_digest).toBe((readJson(run.path).evidence as Record<string, any>).key_digest);
    expect(ev.steps).toEqual([
      { name: "lint", result: "pass" },
      { name: "tests", result: "fail" },
    ]);
  }, T);

  test("a `fail` verdict records decision fail; no --step records steps []", () => {
    const root = makeTree("outcome-fail", "on");
    mintRun(root, "tdd");
    const before = receiptFiles(root);
    const r = outcome(root, "tdd", "fail");
    expect(r.exitCode).toBe(0);
    const rec = readJson(onlyOutcomeFile(root, before));
    expect(rec.subject).toBe("dev-process-toolkit:tdd");
    expect(rec.decision).toBe("fail");
    expect((rec.evidence as Record<string, any>).steps).toEqual([]);
  }, T);

  test("pairing: two runs, two outcomes — the latest unpaired run first, then the earlier one", () => {
    const root = makeTree("outcome-pairing", "on");
    const first = mintRun(root);
    const second = mintRun(root);
    let before = receiptFiles(root);
    expect(outcome(root, "gate-check", "pass").exitCode).toBe(0);
    const o1 = readJson(onlyOutcomeFile(root, before));
    before = receiptFiles(root);
    expect(outcome(root, "gate-check", "pass").exitCode).toBe(0);
    const o2 = readJson(onlyOutcomeFile(root, before));
    expect((o1.evidence as Record<string, any>).run).toBe(sha(readFileSync(second.path)));
    expect((o2.evidence as Record<string, any>).run).toBe(sha(readFileSync(first.path)));
  }, T);
});

// ===========================================================================
// AC-STE-715.5 — refusals
// ===========================================================================

describe("AC-STE-715.5 refusals: no-run and unknown-outcome", () => {
  test("GATE_RECEIPT_REASONS names no-run and unknown-outcome", async () => {
    const reasons = (await receiptModule()).GATE_RECEIPT_REASONS as string[];
    expect(reasons).toContain("no-run");
    expect(reasons).toContain("unknown-outcome");
  });

  test("no-run: the session holds no run receipt at all", () => {
    const root = makeTree("norun-empty", "on");
    const r = outcome(root, "gate-check", "pass");
    expectRefusal(r, "no-run");
    expect(receiptFiles(root)).toEqual([]);
  }, T);

  test("no-run: a second outcome for an already-paired run", () => {
    const root = makeTree("norun-paired", "on");
    mintRun(root);
    expect(outcome(root, "gate-check", "pass").exitCode).toBe(0);
    const before = receiptFiles(root);
    expectRefusal(outcome(root, "gate-check", "pass"), "no-run");
    expect(receiptFiles(root)).toEqual(before);
  }, T);

  test("no-run: the only run receipt is for another subject", () => {
    const root = makeTree("norun-subject", "on");
    mintRun(root, "gate-check");
    const before = receiptFiles(root);
    expectRefusal(outcome(root, "tdd", "pass"), "no-run");
    expect(receiptFiles(root)).toEqual(before);
  }, T);

  test("no-run: the only run receipt is another session's", () => {
    const root = makeTree("norun-session", "on");
    mintRun(root, "gate-check", { sid: "othersession" });
    expectRefusal(outcome(root, "gate-check", "pass"), "no-run");
    expect(receiptFiles(root)).toEqual([]);
  }, T);

  const malformed: Array<[string, string, string[]]> = [
    ["a verdict of `passed`", "passed", []],
    ["--step lint (no result)", "pass", ["lint"]],
    ["--step lint=pass:ok (a summary is no longer accepted)", "pass", ["lint=pass:ok"]],
    ["--step lint=maybe", "pass", ["lint=maybe"]],
    ["a step name holding a backtick", "pass", ["li`nt=pass"]],
    ["a step name holding `$(`", "pass", ["$(id)=pass"]],
    ["an upper-case step name", "pass", ["Lint=pass"]],
    ["a step name of 41 characters", "pass", [`a${"b".repeat(40)}=pass`]],
  ];
  for (const [name, verdict, steps] of malformed) {
    test(`unknown-outcome: ${name}`, () => {
      const root = makeTree("unknown-outcome", "on");
      mintRun(root);
      const before = receiptFiles(root);
      expectRefusal(outcome(root, "gate-check", verdict, steps), "unknown-outcome");
      expect(receiptFiles(root)).toEqual(before);
    }, T);
  }

  test("CONTROL: a 40-character lowercase step name is accepted", () => {
    const root = makeTree("step-40", "on");
    mintRun(root);
    expect(outcome(root, "gate-check", "pass", [`a${"b".repeat(39)}=pass`]).exitCode).toBe(0);
  }, T);
});

// ===========================================================================
// AC-STE-715.6 — key stability
// ===========================================================================

describe("AC-STE-715.6 key_stable", () => {
  function stableAfter(root: string, between: () => void): boolean {
    mintRun(root);
    between();
    const before = receiptFiles(root);
    const r = outcome(root, "gate-check", "pass");
    expect(r.exitCode).toBe(0);
    return (readJson(onlyOutcomeFile(root, before)).evidence as Record<string, any>).key_stable;
  }

  test("an unstaged edit between run and outcome records key_stable: false", () => {
    const root = makeTree("unstable", "on");
    expect(stableAfter(root, () => writeFileSync(join(root, "package.json"), '{"name":"moved"}\n'))).toBe(false);
  }, T);

  test("no edit between run and outcome records key_stable: true", () => {
    const root = makeTree("stable", "on");
    expect(stableAfter(root, () => {})).toBe(true);
  }, T);

  test("a bare repository with no .dpt/ before the run records key_stable: true", () => {
    const root = makeTree("bare", "on");
    expect(existsSync(join(root, ".dpt"))).toBe(false);
    expect(stableAfter(root, () => {})).toBe(true);
  }, T);
});

// ===========================================================================
// AC-STE-715.13 — switch off: v3.0.0 behaviour, byte for byte
// ===========================================================================

const OFF_STATES: SwitchState[] = ["absent", "false", "legacy", "none"];

describe("AC-STE-715.13 switch off", () => {
  for (const state of OFF_STATES) {
    test(`switch off (${state}): recordGateRun writes evidence { head } and never calls gateReuseKey`, async () => {
      const root = makeTree(`off-inproc-${state}`, state);
      const grk = await reuseKeyModule();
      const spy = spyOn(grk, "gateReuseKey");
      const prev = process.env.CLAUDE_CODE_SESSION_ID;
      process.env.CLAUDE_CODE_SESSION_ID = SID;
      try {
        const gr = await receiptModule();
        const path = await gr.recordGateRun("gate-check", root);
        expect(readJson(path).evidence).toEqual({ head: git(root, "rev-parse", "HEAD").trim() });
        expect(spy).toHaveBeenCalledTimes(0);
      } finally {
        spy.mockRestore();
        if (prev === undefined) delete process.env.CLAUDE_CODE_SESSION_ID;
        else process.env.CLAUDE_CODE_SESSION_ID = prev;
      }
    }, T);

    test(`switch off (${state}): the receipt CLI prints exactly its v3.0.0 line`, () => {
      const root = makeTree(`off-cli-${state}`, state);
      const { run, path } = mintRun(root);
      const digest = sha(readFileSync(path));
      expect(run.stdout).toBe(`dpt-receipt: ${path} sha256:${digest}\n`);
      expect(run.stderr).toBe("");
      expect(readJson(path).evidence).toEqual({ head: git(root, "rev-parse", "HEAD").trim() });
    }, T);

    test(`switch off (${state}): the outcome CLI exits 0 silently and writes nothing`, () => {
      const root = makeTree(`off-outcome-${state}`, state);
      mintRun(root);
      const before = receiptFiles(root);
      const forms: Array<{ args: string[]; cwd?: string }> = [
        { args: ["outcome", "gate-check", root, "pass", "--step", "lint=pass"] },
        { args: ["outcome", "gate-check", root, "passed", "--step", "lint"] },
        { args: ["outcome", "gate-check", root, "pass", "--step", "li`nt=pass:ok"] },
        { args: ["outcome", "not-a-gate", root, "pass"] },
        { args: ["outcome", "gate-check"], cwd: root },
        { args: ["outcome"], cwd: root },
      ];
      for (const f of forms) {
        const r = runCli(f.args, { cwd: f.cwd });
        expect({ args: f.args, code: r.exitCode, out: r.stdout, err: r.stderr }).toEqual({
          args: f.args,
          code: 0,
          out: "",
          err: "",
        });
      }
      expect(receiptFiles(root)).toEqual(before);
    }, T);
  }

  test("CONTROL: with the switch on, the spy does see gateReuseKey called (the spy is live)", async () => {
    const root = makeTree("on-inproc", "on");
    const grk = await reuseKeyModule();
    const spy = spyOn(grk, "gateReuseKey");
    const prev = process.env.CLAUDE_CODE_SESSION_ID;
    process.env.CLAUDE_CODE_SESSION_ID = SID;
    try {
      const gr = await receiptModule();
      const path = await gr.recordGateRun("gate-check", root);
      expect(Object.keys(readJson(path).evidence as object).sort()).toEqual(["head", "key", "key_digest"]);
      expect(spy.mock.calls.length).toBeGreaterThanOrEqual(1);
    } finally {
      spy.mockRestore();
      if (prev === undefined) delete process.env.CLAUDE_CODE_SESSION_ID;
      else process.env.CLAUDE_CODE_SESSION_ID = prev;
    }
  }, T);

  test("SUPERSEDED: the v3.0.0 front door refused `outcome` with reason=unknown-skill; today's is silent when off", () => {
    const dir = tempDir("v300-tree");
    const tar = spawnSync(
      "bash",
      ["-c", `git -C '${REPO_ROOT}' archive ${V300} ${PLUGIN_REL}/adapters ${PLUGIN_REL}/skills ${PLUGIN_REL}/templates ${PLUGIN_REL}/.claude-plugin | tar -x -C '${dir}'`],
      { encoding: "utf-8" },
    );
    expect(tar.status).toBe(0);
    const trunkDoor = join(dir, PLUGIN_REL, "adapters", "_shared", "src", "gate_receipt.ts");
    const root = makeTree("superseded", "absent");
    const trunk = runCli(["outcome", "gate-check", root, "pass"], { frontDoor: trunkDoor });
    expect(trunk.exitCode).toBe(1);
    expect(trunk.stdout).toBe("");
    expect(trunk.stderr).toContain("reason=unknown-skill, skill=outcome");
    const now = runCli(["outcome", "gate-check", root, "pass"]);
    expect({ code: now.exitCode, out: now.stdout, err: now.stderr }).toEqual({ code: 0, out: "", err: "" });
  }, T);

  test("switch on: the receipt CLI prints exactly two lines, the announcement then `outcome: on`", () => {
    const root = makeTree("on-two-lines", "on");
    const { run, path } = mintRun(root);
    // Amended by AC-STE-724.20: two lines -> three when reuse is on.
    expect(run.stdout).toBe(`dpt-receipt: ${path} sha256:${sha(readFileSync(path))}\noutcome: on\n`);
    expect(run.stderr).toBe("");
  }, T);

  for (const hook of HOOKS) {
    test(`switch on: ${hook} hook permits on the two-line output exactly as on the one-line form`, async () => {
      const root = makeTree(`on-hook-${hook}`, "on");
      stageCodeAndTest(root);
      const skill = SHORT_OF[hook];
      const { run } = mintRun(root, skill);
      expect(run.stdout.split("\n")[1]).toBe("outcome: on");
      const dir = tempDir("tr");
      const two = writeTranscript(dir, [...skillCall(hook), ...bashCall("b1", receiptCommand(skill, root), run.stdout)]);
      const one = writeTranscript(dir, [
        ...skillCall(hook),
        ...bashCall("b1", receiptCommand(skill, root), `${run.stdout.split("\n")[0]}\n`),
      ]);
      const rTwo = await runHook(hook, root, two);
      const rOne = await runHook(hook, root, one);
      expect({ code: rTwo.exitCode, err: rTwo.stderr }).toEqual({ code: 0, err: "" });
      expect({ code: rTwo.exitCode, err: rTwo.stderr }).toEqual({ code: rOne.exitCode, err: rOne.stderr });
    }, T);
  }
});

// ===========================================================================
// AC-STE-715.17 — a key error never blocks
// ===========================================================================

describe("AC-STE-715.17 a key error never blocks", () => {
  function brokenManifestDoor(): string {
    const copy = pluginCopy("broken-manifest");
    rmSync(join(copy, ".claude-plugin", "plugin.json"));
    return join(copy, "adapters", "_shared", "src", "gate_receipt.ts");
  }

  test("an unreadable manifest degrades: exit 0, one announcement line, evidence { head, key: null, key_digest: null }, one stderr note", () => {
    const door = brokenManifestDoor();
    const root = makeTree("key-error", "on");
    const r = runCli(["gate-check", root], { frontDoor: door, env: { CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT } });
    expect(r.exitCode).toBe(0);
    const lines = r.stdout.split("\n");
    expect(lines.length).toBe(2);
    expect(lines[1]).toBe("");
    const ann = parseAnnouncement(lines[0]!, "dpt-receipt: ");
    expect(ann).not.toBeNull();
    expect(readJson(ann!.path).evidence).toEqual({
      head: git(root, "rev-parse", "HEAD").trim(),
      key: null,
      key_digest: null,
    });
    const notes = r.stderr.split("\n").filter((l) => l.trim().length > 0);
    expect(notes.length).toBe(1);
    expect(notes[0]).toMatch(/DptVersionError|manifest/);
  }, T);

  for (const hook of HOOKS) {
    test(`${hook} hook permits on the key-error output exactly as on a switch-off run`, async () => {
      const door = brokenManifestDoor();
      const skill = SHORT_OF[hook];
      const onRoot = makeTree(`key-error-${hook}`, "on");
      stageCodeAndTest(onRoot);
      const bad = runCli([skill, onRoot], { frontDoor: door, env: { CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT } });
      expect(bad.exitCode).toBe(0);
      const offRoot = makeTree(`key-error-off-${hook}`, "absent");
      stageCodeAndTest(offRoot);
      const off = mintRun(offRoot, skill);
      const dir = tempDir("tr");
      const trBad = writeTranscript(dir, [...skillCall(hook), ...bashCall("b1", receiptCommand(skill, onRoot), bad.stdout)]);
      const trOff = writeTranscript(dir, [...skillCall(hook), ...bashCall("b1", receiptCommand(skill, offRoot), off.run.stdout)]);
      const rBad = await runHook(hook, onRoot, trBad);
      const rOff = await runHook(hook, offRoot, trOff);
      expect({ code: rOff.exitCode, err: rOff.stderr }).toEqual({ code: 0, err: "" });
      expect({ code: rBad.exitCode, err: rBad.stderr }).toEqual({ code: 0, err: "" });
    }, T);
  }
});

// ===========================================================================
// AC-STE-715.9 — skill needles, and the gate-check freeze re-base
// ===========================================================================

const SKILL = (name: string): string => join(PLUGIN_ROOT, "skills", name, "SKILL.md");
const GATE_CHECK_REL = `${PLUGIN_REL}/skills/gate-check/SKILL.md`;

/** skills/gate-check/SKILL.md line 9 at the v3.0.0 merge commit, byte for byte. */
const TRUNK_LINE_9 = "Run the project's gating checks and report a clear pass/fail for each \u2014 for ONE checkout: the one `$ARGUMENTS` names by path, or the session's working directory when no path is given. Resolve that checkout root first, run every command below with it as the working directory, and before any of them record the run against it with `bun run \"${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/gate_receipt.ts\" gate-check \"<that checkout root>\"` \u2014 if that refuses, stop and report its block verbatim rather than grading anything. **Invoking this skill is itself the token the commit gate reads.** The `pre-commit-gate-check` hook wants both halves: a `Skill` `tool_use` of `dev-process-toolkit:gate-check` in the current session's transcript AND that run's receipt inside the repository the commit targets, so running the same typecheck, lint and tests by hand yields a green result the hook cannot see and the commit is still refused with `exit 2`.";

const OUTCOME_ORDER = 'bun run "${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/gate_receipt.ts" outcome';

describe("AC-STE-715.9 gate-check line 9", () => {
  test("CONTROL: the pinned trunk literal is line 9 at the v3.0.0 merge commit", () => {
    expect(atV300(GATE_CHECK_REL).split("\n")[8]).toBe(TRUNK_LINE_9);
    expect(TRUNK_LINE_9).toContain('`bun run "${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/gate_receipt.ts" gate-check "<that checkout root>"`');
    expect(TRUNK_LINE_9).toContain("**Invoking this skill is itself the token the commit gate reads.**");
  });

  test("the line count and the STE-<n> token count are unchanged from v3.0.0", () => {
    const now = readFileSync(SKILL("gate-check"), "utf-8");
    const then = atV300(GATE_CHECK_REL);
    expect(now.split("\n").length).toBe(then.split("\n").length);
    expect((now.match(/STE-\d+/g) ?? []).length).toBe((then.match(/STE-\d+/g) ?? []).length);
  });

  test("line 9 starts with its trunk text byte for byte, then carries exactly one appended sentence", () => {
    const line = readFileSync(SKILL("gate-check"), "utf-8").split("\n")[8]!;
    expect(line.startsWith(TRUNK_LINE_9)).toBe(true);
    const tail = line.slice(TRUNK_LINE_9.length);
    expect(tail.startsWith(" ")).toBe(true);
    const appended = tail.slice(1);
    expect(sentences(appended).length).toBe(1);
    expect(appended).toContain("`outcome: on`");
    expect(appended).toContain(`${OUTCOME_ORDER} gate-check`);
    expect(appended).toContain("--step");
    expect(appended).toContain("`pass`");
    expect(appended).toContain("`fail`");
    expect(appended).toContain("GATE PASSED WITH NOTES");
    expect(appended).toContain("GATE FAILED");
    expect(appended.replace("GATE PASSED WITH NOTES", "")).toContain("GATE PASSED");
    expect(appended.indexOf("`pass`")).toBeLessThan(appended.indexOf("GATE FAILED"));
    expect(appended.indexOf("`fail`")).toBeGreaterThan(appended.indexOf("`pass`"));
  });

  test("the mention rule holds in gate-check, tdd and spec-review (every outcome sentence names `outcome: on`)", () => {
    for (const s of ["gate-check", "tdd", "spec-review"]) {
      expect({ skill: s, violations: mentionRuleViolations(readFileSync(SKILL(s), "utf-8")) }).toEqual({ skill: s, violations: [] });
    }
  });

  test("tdd names the outcome call with its pass rule (audit status: ok), the Halt path (fail) and `outcome: on`", () => {
    const hits = sentences(readFileSync(SKILL("tdd"), "utf-8")).filter((s) => s.includes(`${OUTCOME_ORDER} tdd`));
    expect(hits.length).toBe(1);
    const s = hits[0]!;
    expect(s).toContain("`outcome: on`");
    expect(s).toContain("`pass`");
    expect(s).toContain("`status: ok`");
    expect(s).toContain("`fail`");
    expect(s).toMatch(/Halt/);
  });

  test("spec-review names the outcome call with its pass rule (drift_count 0, every row done) and `outcome: on`", () => {
    const hits = sentences(readFileSync(SKILL("spec-review"), "utf-8")).filter((s) => s.includes(`${OUTCOME_ORDER} spec-review`));
    expect(hits.length).toBe(1);
    const s = hits[0]!;
    expect(s).toContain("`outcome: on`");
    expect(s).toContain("`pass`");
    expect(s).toContain("`fail`");
    expect(s).toContain("drift_count");
    expect(s).toMatch(/`done`/);
  });

  test("CONTROL: a planted second outcome mention without `outcome: on` is a mention-rule violation", () => {
    const planted = `${readFileSync(SKILL("tdd"), "utf-8")}\nThen run \`${OUTCOME_ORDER} tdd "<root>" pass\`.\n`;
    expect(mentionRuleViolations(planted).length).toBe(1);
  });
});

describe("AC-STE-715.9 the AC-STE-618.8 freeze is re-based once, onto the line-9 edit commit", () => {
  const FREEZE = join(PLUGIN_ROOT, "tests", "m_2306b6-ste-618-live-proof-gate.test.ts");
  const PERMITTED = [120, 124, 128, 154];

  /** The AC-STE-618.8 guard, as tests/m_2306b6-ste-618-live-proof-gate.test.ts defines it. */
  function driftBeyond(before: string, after: string, permitted: readonly number[]): string[] {
    const a = before.split("\n");
    const b = after.split("\n");
    if (a.length !== b.length) return [`line count ${a.length} → ${b.length}`];
    const out: string[] = [];
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && !permitted.includes(i + 1)) out.push(`line ${i + 1}`);
    return out;
  }

  function kickoff(): string {
    const m = /^const KICKOFF = "([0-9a-f]+)";$/m.exec(readFileSync(FREEZE, "utf-8"));
    expect(m).not.toBeNull();
    return m![1]!;
  }

  function editCommit(): string {
    const out = spawnSync("git", ["log", "-n", "1", "--format=%H", "-G", "outcome: on", "--", GATE_CHECK_REL], {
      cwd: REPO_ROOT,
      encoding: "utf-8",
    }).stdout.trim();
    expect(out).toMatch(/^[0-9a-f]{40}$/);
    return out;
  }

  test("the line-9 edit is its own commit: it touches only skills/gate-check/SKILL.md, and only line 9", () => {
    const c = editCommit();
    const files = spawnSync("git", ["show", "--name-only", "--format=", c], { cwd: REPO_ROOT, encoding: "utf-8" })
      .stdout.split("\n")
      .filter((l) => l.length > 0);
    expect(files).toEqual([GATE_CHECK_REL]);
    const parent = spawnSync("git", ["show", `${c}^:${GATE_CHECK_REL}`], { cwd: REPO_ROOT, encoding: "utf-8" }).stdout;
    const at = spawnSync("git", ["show", `${c}:${GATE_CHECK_REL}`], { cwd: REPO_ROOT, encoding: "utf-8" }).stdout;
    expect(driftBeyond(parent, at, [])).toEqual(["line 9"]);
  });

  test("KICKOFF names the edit commit, a RE-BASED comment names the ruling and line 9, PERMITTED_LINES is unchanged", () => {
    const src = readFileSync(FREEZE, "utf-8");
    expect(editCommit().startsWith(kickoff())).toBe(true);
    const at = src.indexOf("RE-BASED (operator ruling 2026-11-04, M_7bc805 / STE-715)");
    expect(at).toBeGreaterThanOrEqual(0);
    expect(src.slice(at, at + 600)).toMatch(/line 9/);
    expect(src).toContain("const PERMITTED_LINES: readonly number[] = [120, 124, 128, 154];");
    expect(src).toContain("expect(PERMITTED_LINES).toEqual([120, 124, 128, 154]);");
  });

  test("at KICKOFF line 9 already holds the edit: the freeze is green on today's file", () => {
    const then = spawnSync("git", ["show", `${kickoff()}:${GATE_CHECK_REL}`], { cwd: REPO_ROOT, encoding: "utf-8" }).stdout;
    const now = readFileSync(SKILL("gate-check"), "utf-8");
    expect(then.split("\n")[8]).toBe(now.split("\n")[8]);
    expect(driftBeyond(then, now, PERMITTED)).toEqual([]);
  });

  test("NEIGHBOUR CONTROL: a changed line 10 still fails driftBeyond", () => {
    const then = spawnSync("git", ["show", `${kickoff()}:${GATE_CHECK_REL}`], { cwd: REPO_ROOT, encoding: "utf-8" }).stdout;
    const lines = readFileSync(SKILL("gate-check"), "utf-8").split("\n");
    lines[9] = `${lines[9]} (edited)`;
    expect(driftBeyond(then, lines.join("\n"), PERMITTED)).toEqual(["line 10"]);
  });
});

