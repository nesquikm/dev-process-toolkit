// STE-728 (M_d1b4b7) — `apply` round trips, refusals and rollback.
//
//   AC-STE-728.6   apply with the printed digest and a verified approval
//                  changes only the proposed keys; the only other new files are
//                  one retro-apply receipt and `.dpt/.gitignore` where absent;
//                  comments survive byte for byte.
//   AC-STE-728.7   a stale digest refuses with the tree byte-identical; a
//                  malformed `video` section still proposes, and apply refuses
//                  at the write step leaving only the receipt.
//   AC-STE-728.8   the tool_calls row writes the key and registers; a tracked
//                  local settings file refuses before the settings write, and
//                  the approval is then consumed; a spy records the order
//                  receipt -> check(settingOn: true) -> write -> register.
//   AC-STE-728.15  the ignore line: appended exactly; a changed .gitignore
//                  refuses on the digest; a refusing register rolls back the
//                  settings file, .gitignore and .claude/settings.local.json.

import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { runNestedBunTest } from "./_nested_bun_test";
import {
  IGNORE_LOCAL,
  IGNORE_OTHER,
  LOCAL_SETTINGS,
  OFF,
  SETTINGS_HEAD,
  SRC,
  TOKEN_STATS_OFF,
  TOOL_CALLS_OFF,
  applyApproved,
  approve,
  captureStatus,
  childEnv,
  cleanupTemps,
  expectRefusal,
  git,
  makeTree,
  pluginCopy,
  readOr,
  receiptFiles,
  retroApplyReceipts,
  settingsMod,
  settingsPath,
  snapshot,
  tempDir,
  trackingYaml,
  without,
  writeReport,
} from "./_m_d1b4b7_ste728_fixture";

afterAll(cleanupTemps);

// ------------------------------------------------------------------ AC.6

describe("AC-STE-728.6 apply changes only the proposed keys", () => {
  for (const dptGitignore of [true, false]) {
    test(`token_stats row, .dpt/.gitignore ${dptGitignore ? "present" : "absent"}: settings = prior + key, CLAUDE.md identical, only the receipt${dptGitignore ? "" : " and .dpt/.gitignore"} new`, async () => {
      const label = `ac6-${dptGitignore ? "dpt" : "nodpt"}`;
      const root = makeTree(label, { dptGitignore });
      const report = await writeReport(label, TOKEN_STATS_OFF());
      const { loadProjectSettings } = await settingsMod();
      const prior = loadProjectSettings(root).settings;
      const claudeMd = readFileSync(join(root, "CLAUDE.md"));
      const before = snapshot(root);
      const a = approve(label, root, report);
      const r = applyApproved(a);
      expect(r.status).toBe(0);

      const after = loadProjectSettings(root).settings;
      expect(after).toEqual({ ...prior, tracking: { ...prior.tracking, token_stats: { enabled: true } } });
      expect(readFileSync(join(root, "CLAUDE.md")).equals(claudeMd)).toBe(true);

      const snap = snapshot(root);
      const receipts = receiptFiles(root, a.session);
      expect(receipts).toHaveLength(1);
      const added = Object.keys(snap).filter((k) => !(k in before)).sort();
      expect(added).toEqual([...receipts, ...(dptGitignore ? [] : [join(".dpt", ".gitignore")])].sort());
      const changed = Object.keys(before).filter((k) => snap[k] !== before[k]);
      expect(changed).toEqual([join("specs", "settings.yaml")]);

      const [receipt] = retroApplyReceipts(root, a.session);
      expect(receipt).toMatchObject({
        kind: "retro-apply",
        adapter: null,
        container: null,
        subject: "dev-process-toolkit:retro",
        decision: "apply",
        evidence: { answer: a.answerUuid, digest: a.digest },
      });
    });
  }

  test("on a settings file holding comments, every line but the written key's is byte-identical", async () => {
    const settings =
      `${SETTINGS_HEAD}# tracking switches — keep this comment\n` +
      "tracking:\n" +
      "  # token stats\n" +
      "  token_stats:\n    enabled: false # off for now\n" +
      "  gate_outcomes:\n    enabled: false\n" +
      "  tool_calls:\n    enabled: false\n" +
      "# trailing comment\n";
    const root = makeTree("ac6-comments", { settings });
    const report = await writeReport("ac6-comments", TOKEN_STATS_OFF());
    const a = approve("ac6-comments", root, report);
    expect(applyApproved(a).status).toBe(0);
    const before = settings.split("\n");
    const after = readFileSync(settingsPath(root), "utf-8").split("\n");
    expect(after).toHaveLength(before.length);
    const diff = before.map((l, i) => (l === after[i] ? null : i)).filter((i) => i !== null) as number[];
    expect(diff).toHaveLength(1);
    expect(before[diff[0]!]).toContain("enabled: false # off for now");
    expect(after[diff[0]!]).toMatch(/^ {4}enabled: true\b/);
  });
});

// ------------------------------------------------------------------ AC.7

describe("AC-STE-728.7 a stale digest and a malformed unrelated section", () => {
  test("one byte of the settings file changed after propose: exit 1, NFR-10, tree byte-identical", async () => {
    const settings = `${SETTINGS_HEAD}# note a\n${trackingYaml(OFF)}`;
    const root = makeTree("ac7-stale", { settings });
    const report = await writeReport("ac7-stale", TOKEN_STATS_OFF());
    const a = approve("ac7-stale", root, report);
    writeFileSync(settingsPath(root), settings.replace("# note a", "# note b"));
    const before = snapshot(root);
    const r = applyApproved(a);
    expectRefusal(r);
    // The digest check is what refuses, not only the printed-lines match that also covers it (AC.13 mutation).
    expect(r.stderr).toMatch(/digest no longer matches/);
    expect(snapshot(root)).toEqual(before);
  });

  for (const dptGitignore of [true, false]) {
    test(`a malformed video section (.dpt/.gitignore ${dptGitignore ? "present" : "absent"}): propose prints the row; apply refuses at the write step leaving only the receipt`, async () => {
      const label = `ac7-video-${dptGitignore ? "dpt" : "nodpt"}`;
      const root = makeTree(label, { settings: `${SETTINGS_HEAD}${trackingYaml(OFF)}video:\n  bogus: 1\n`, dptGitignore });
      const report = await writeReport(label, TOKEN_STATS_OFF());
      const before = snapshot(root);
      const a = approve(label, root, report);
      expect(a.lines).toContain("set tracking.token_stats.enabled: true");
      const r = applyApproved(a);
      expectRefusal(r);
      const receipts = receiptFiles(root, a.session);
      expect(receipts).toHaveLength(1);
      expect(retroApplyReceipts(root, a.session)).toHaveLength(1);
      const allowed = [...receipts, ...(dptGitignore ? [] : [join(".dpt", ".gitignore")])];
      expect(without(snapshot(root), allowed)).toEqual(before);
      if (!dptGitignore) expect(existsSync(join(root, ".dpt", ".gitignore"))).toBe(true);
    });
  }
});

// ------------------------------------------------------------------ AC.8

describe("AC-STE-728.8 the tool_calls row writes the key and registers the capture hook", () => {
  test("setting off, local settings ignored: apply writes the key, registers, and status prints registration: current", async () => {
    const root = makeTree("ac8-register", { gitignore: IGNORE_LOCAL });
    const report = await writeReport("ac8-register", TOOL_CALLS_OFF());
    const a = approve("ac8-register", root, report);
    expect(a.lines.some((l) => l.startsWith("add .gitignore:"))).toBe(false);
    const r = applyApproved(a);
    expect(r.status).toBe(0);
    expect(readFileSync(settingsPath(root), "utf-8")).toMatch(/tool_calls:\n {4}enabled: true/);
    expect(existsSync(join(root, LOCAL_SETTINGS))).toBe(true);
    expect(captureStatus(root, { configDir: a.configDir })).toContain("registration: current");
  });

  test("a tracked local settings file: refuses before any settings write, only the receipt is new; after untracking, the same approval refuses as consumed", async () => {
    const root = makeTree("ac8-tracked", { gitignore: IGNORE_OTHER, trackedLocal: "{}\n" });
    const report = await writeReport("ac8-tracked", TOOL_CALLS_OFF());
    const before = snapshot(root);
    const a = approve("ac8-tracked", root, report);
    const r = applyApproved(a);
    expectRefusal(r);
    const receipts = receiptFiles(root, a.session);
    expect(receipts).toHaveLength(1);
    expect(without(snapshot(root), receipts)).toEqual(before);

    git(root, "rm", "-q", "--cached", LOCAL_SETTINGS);
    git(root, "commit", "-q", "-m", "untrack the local settings file");
    const settingsBefore = readFileSync(settingsPath(root));
    const again = applyApproved(a);
    expectRefusal(again);
    expect(again.stderr).toMatch(/consum/i);
    expect(readFileSync(settingsPath(root)).equals(settingsBefore)).toBe(true);
    expect(receiptFiles(root, a.session)).toEqual(receipts);
  });
});

// -------------------------------------------------------- AC.8 / AC.15 spies

/**
 * A nested `bun test` file that replaces the receipt writer, the precondition
 * check, the settings writer and `registerCapture` with recording wrappers
 * (mock.module), then calls the module's exported `apply`.
 */
function spyTest(o: { root: string; report: string; digest: string; mode: "order" | "register-writes-then-refuses" }): string {
  const dir = tempDir("spy");
  const path = join(dir, "spy.test.ts");
  const src = (rel: string) => JSON.stringify(join(SRC, rel));
  const body = `
import { test, expect, mock } from "bun:test";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
const calls: string[] = [];
test("spy", async () => {
  const receipts = { ...(await import(${src("tracker_receipts.ts")})) };
  const reg = { ...(await import(${src("capture_registration.ts")})) };
  const settings = { ...(await import(${src("project_settings.ts")})) };
  const writer = { ...(await import(${src("project_settings_writer.ts")})) };
  mock.module(${src("tracker_receipts.ts")}, () => ({
    ...receipts,
    writeReceipt: (root: string, input: any) => { calls.push("receipt:" + input.kind); return receipts.writeReceipt(root, input); },
  }));
  mock.module(${src("capture_registration.ts")}, () => ({
    ...reg,
    checkRegisterPreconditions: (root: string, opts: any) => { calls.push("check:" + JSON.stringify(opts)); return reg.checkRegisterPreconditions(root, opts); },
    registerCapture: (root: string) => {
      calls.push("register");
      ${
        o.mode === "register-writes-then-refuses"
          ? `mkdirSync(join(root, ".claude"), { recursive: true });
      writeFileSync(join(root, ${JSON.stringify(LOCAL_SETTINGS)}), '{"partial": true}\\n');
      return ["Refusing: forced\\nRemedy: none\\nContext: test=spy"];`
          : "return reg.registerCapture(root);"
      }
    },
  }));
  const write = (impl: any) => (root: string, update: any, opts?: any) => { calls.push("write"); return impl(root, update, opts); };
  mock.module(${src("project_settings.ts")}, () => ({ ...settings, writeProjectSettings: write(settings.writeProjectSettings) }));
  mock.module(${src("project_settings_writer.ts")}, () => ({ ...writer, writeProjectSettings: write(writer.writeProjectSettings) }));
  const mod = await import(${src("retro_proposal.ts")});
  expect(typeof mod.apply).toBe("function");
  try { await mod.apply(${JSON.stringify(o.root)}, ${JSON.stringify(o.report)}, ${JSON.stringify(o.digest)}); } catch {}
  const order = calls.filter((c, i) => c !== calls[i - 1]);
  console.log("SPY_CALLS=" + JSON.stringify(order));
});
`;
  writeFileSync(path, body);
  return path;
}

function spyCalls(stdout: string): string[] {
  const line = stdout.split("\n").find((l) => l.startsWith("SPY_CALLS="));
  if (line === undefined) throw new Error(`the spy printed no call list:\n${stdout}`);
  return JSON.parse(line.slice("SPY_CALLS=".length));
}

describe("AC-STE-728.8 a spy records the call order", () => {
  test("retro-apply receipt write, then the check with settingOn: true, then the settings write, then register", async () => {
    const root = makeTree("ac8-spy", { gitignore: IGNORE_LOCAL });
    const report = await writeReport("ac8-spy", TOOL_CALLS_OFF());
    const a = approve("ac8-spy", root, report);
    const file = spyTest({ root, report, digest: a.digest, mode: "order" });
    const r = runNestedBunTest([file], { cwd: root, env: childEnv({ configDir: a.configDir, session: a.session }) });
    expect(r.exitCode).toBe(0);
    // The outer order, up to register: registerCapture re-runs the precondition check inside itself,
    // and that inner call is not part of apply's order (worker ruling, STE-728 GREEN).
    const calls = spyCalls(`${r.stdout}\n${r.stderr}`);
    expect(calls.slice(0, calls.indexOf("register") + 1)).toEqual(["receipt:retro-apply", 'check:{"settingOn":true}', "write", "register"]);
  });
});

// ----------------------------------------------------------------- AC.15

describe("AC-STE-728.15 the ignore line", () => {
  test("not ignored: propose prints the add line; apply appends exactly it, writes the key and registers", async () => {
    const root = makeTree("ac15-append", { gitignore: IGNORE_OTHER });
    const report = await writeReport("ac15-append", TOOL_CALLS_OFF());
    const a = approve("ac15-append", root, report);
    expect(a.lines).toContain("add .gitignore: .claude/settings.local.json");
    expect(a.lines.indexOf("add .gitignore: .claude/settings.local.json")).toBe(a.lines.length - 2);
    const r = applyApproved(a);
    expect(r.status).toBe(0);
    expect(readFileSync(join(root, ".gitignore"), "utf-8")).toBe(`${IGNORE_OTHER}${LOCAL_SETTINGS}\n`);
    expect(readFileSync(settingsPath(root), "utf-8")).toMatch(/tool_calls:\n {4}enabled: true/);
    expect(captureStatus(root, { configDir: a.configDir })).toContain("registration: current");
  });

  test("no .gitignore at all: apply creates it holding exactly the line", async () => {
    const root = makeTree("ac15-create", { gitignore: null });
    const report = await writeReport("ac15-create", TOOL_CALLS_OFF());
    const a = approve("ac15-create", root, report);
    expect(a.lines).toContain("add .gitignore: .claude/settings.local.json");
    expect(applyApproved(a).status).toBe(0);
    expect(readFileSync(join(root, ".gitignore"), "utf-8")).toBe(`${LOCAL_SETTINGS}\n`);
  });

  test("a .gitignore changed after propose refuses on the digest, tree byte-identical", async () => {
    const root = makeTree("ac15-changed", { gitignore: IGNORE_OTHER });
    const report = await writeReport("ac15-changed", TOOL_CALLS_OFF());
    const a = approve("ac15-changed", root, report);
    writeFileSync(join(root, ".gitignore"), `${IGNORE_OTHER}dist/\n`);
    const before = snapshot(root);
    expectRefusal(applyApproved(a));
    expect(snapshot(root)).toEqual(before);
  });

  const rollbackCases: [string, { gitignore: string | null; local?: string }][] = [
    ["absent .gitignore and local settings file", { gitignore: null }],
    ["present .gitignore and local settings file", { gitignore: IGNORE_OTHER, local: '{\n  "permissions": {}\n}\n' }],
  ];
  for (const [name, c] of rollbackCases) {
    test(`a register forced to refuse after the writes (${name}) restores all three files; the receipt stays`, async () => {
      // Worker ruling (STE-728 GREEN): register is forced to refuse through the spy, after it writes a
      // partial local settings file. A version-less plugin copy could not do it, because the settings
      // loader refuses that copy before propose or apply's digest recompute ever reach register.
      const root = makeTree(`ac15-rollback-${c.local ? "p" : "a"}`, { gitignore: c.gitignore, untrackedLocal: c.local, dptGitignore: false });
      const report = await writeReport("ac15-rollback", TOOL_CALLS_OFF());
      const prior = {
        settings: readOr(settingsPath(root)),
        gitignore: readOr(join(root, ".gitignore")),
        local: readOr(join(root, LOCAL_SETTINGS)),
      };
      const before = snapshot(root);
      const a = approve("ac15-rollback", root, report);
      const file = spyTest({ root, report, digest: a.digest, mode: "register-writes-then-refuses" });
      const r = runNestedBunTest([file], { cwd: root, env: childEnv({ configDir: a.configDir, session: a.session }) });
      expect(r.exitCode).toBe(0);
      expect(spyCalls(`${r.stdout}\n${r.stderr}`)).toContain("register");
      expect(readOr(settingsPath(root))).toBe(prior.settings);
      expect(readOr(join(root, ".gitignore"))).toBe(prior.gitignore);
      expect(readOr(join(root, LOCAL_SETTINGS))).toBe(prior.local);
      const receipts = receiptFiles(root, a.session);
      expect(receipts).toHaveLength(1);
      expect(without(snapshot(root), [...receipts, join(".dpt", ".gitignore")])).toEqual(before);
      expect(existsSync(join(root, ".dpt", ".gitignore"))).toBe(true);
    });
  }

  test("a register that writes .claude/settings.local.json then refuses: the local file is restored too (spy)", async () => {
    const root = makeTree("ac15-spy-rollback", { gitignore: IGNORE_OTHER, untrackedLocal: '{\n  "keep": 1\n}\n' });
    const report = await writeReport("ac15-spy-rollback", TOOL_CALLS_OFF());
    const prior = {
      settings: readOr(settingsPath(root)),
      gitignore: readOr(join(root, ".gitignore")),
      local: readOr(join(root, LOCAL_SETTINGS)),
    };
    const a = approve("ac15-spy-rollback", root, report);
    const file = spyTest({ root, report, digest: a.digest, mode: "register-writes-then-refuses" });
    const r = runNestedBunTest([file], { cwd: root, env: childEnv({ configDir: a.configDir, session: a.session }) });
    expect(r.exitCode).toBe(0);
    expect(spyCalls(`${r.stdout}\n${r.stderr}`)).toContain("register");
    expect(readOr(settingsPath(root))).toBe(prior.settings);
    expect(readOr(join(root, ".gitignore"))).toBe(prior.gitignore);
    expect(readOr(join(root, LOCAL_SETTINGS))).toBe(prior.local);
    expect(retroApplyReceipts(root, a.session)).toHaveLength(1);
  });
});
