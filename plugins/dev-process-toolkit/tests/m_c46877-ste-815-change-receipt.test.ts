// STE-815 (M_c46877) — a settings change leaves a receipt, and one writer
// changes the settings file at a time.
//
//   AC-STE-815.1  a successful apply writes a second receipt, kind
//                 `retro-change`, evidence `{ digest, applied_at, changes }`,
//                 one `{ key, from, to }` per written key (`from` = "absent"
//                 for an unset key), after every step (register included),
//                 and no `trial_id` anywhere.
//   AC-STE-815.2  a failed step (writer refusal, register refusal, stale hash)
//                 writes no `retro-change`; the `retro-apply` receipt stays.
//   AC-STE-815.3  `writeProjectSettings(…, { expectSha256 })` refuses (NFR-10,
//                 both hashes named, nothing written) on a mismatch; apply
//                 passes the hash of the bytes it recomputed the proposal from.
//   AC-STE-815.4  the writer holds `specs/settings.yaml.lock` for its whole
//                 read-modify-write: a fresh foreign lock refuses, a lock
//                 older than 30 s is replaced, the lock is gone on every exit.
//   AC-STE-815.5  the importer allowlist of `project_settings_writer`.
//   AC-STE-815.6  docs/retro-reference.md.
//   AC-STE-815.7  is the full-suite gate the orchestrator runs; no test here.
//
// Shape assumed: `expectSha256` is the bare lowercase hex sha256 of the file
// bytes (the option names the hash itself). Apply's value is compared with any
// `sha256:` prefix stripped.
//
// Fixtures are temp git checkouts outside the repo (the STE-728 helpers); every
// session id and record uuid is synthetic.

import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import { runNestedBunTest } from "./_nested_bun_test";
import {
  IGNORE_LOCAL,
  LOCAL_SETTINGS,
  NFR10_RE,
  OFF,
  PLUGIN_ROOT,
  SETTINGS_HEAD,
  SRC,
  TOKEN_STATS_OFF,
  TOOL_CALLS_OFF,
  TWO_OFF,
  applyApproved,
  approve,
  childEnv,
  cleanupTemps,
  expectRefusal,
  makeTree,
  readOr,
  receiptFiles,
  retroApplyReceipts,
  settingsPath,
  tempDir,
  trackingYaml,
  type Approved,
  writeReport,
} from "./_m_d1b4b7_ste728_fixture";

afterAll(cleanupTemps);

const LONG = 120_000;
const TOKEN_KEY = "tracking.token_stats.enabled";
const TOOL_KEY = "tracking.tool_calls.enabled";
const RETRO_REFERENCE = join(PLUGIN_ROOT, "docs", "retro-reference.md");

function hex(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function lockPath(root: string): string {
  return join(root, "specs", "settings.yaml.lock");
}

function allReceipts(root: string, session: string): any[] {
  return receiptFiles(root, session).map((rel) => JSON.parse(readFileSync(join(root, rel), "utf-8")));
}

function changeReceipts(root: string, session: string): any[] {
  return allReceipts(root, session).filter((r) => r.kind === "retro-change");
}

function byKey(changes: { key: string }[]): { key: string }[] {
  return [...changes].sort((a, b) => a.key.localeCompare(b.key));
}

async function writerMod(): Promise<Record<string, any>> {
  return (await import("../adapters/_shared/src/project_settings_writer")) as Record<string, any>;
}

async function shapeErrorClass(): Promise<any> {
  return ((await import("../adapters/_shared/src/project_settings")) as Record<string, any>).SettingsShapeError;
}

// ---------------------------------------------------------------- apply spy

// Stage B review modes: "foreign-writer-at-write" has another writer take the lock and change the
// settings file just before apply's write; "change-receipt-fails" makes the retro-change receipt throw.
type SpyMode = "order" | "register-refuses" | "check-edits-settings" | "foreign-writer-at-write" | "change-receipt-fails";

/**
 * A nested `bun test` file that wraps the receipt writer, the precondition
 * check, the settings writer and `registerCapture` (mock.module), calls the
 * module's exported `apply`, and prints the call order, the writer's opts and
 * any thrown message.
 */
function applySpy(o: { root: string; report: string; digest: string; mode: SpyMode }): string {
  const path = join(tempDir("spy815"), "spy.test.ts");
  const src = (rel: string) => JSON.stringify(join(SRC, rel));
  const settingsFile = JSON.stringify(settingsPath(o.root));
  const body = `
import { test, mock } from "bun:test";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const calls: string[] = [];
const opts: unknown[] = [];
test("spy", async () => {
  const receipts = { ...(await import(${src("tracker_receipts.ts")})) };
  const reg = { ...(await import(${src("capture_registration.ts")})) };
  const settings = { ...(await import(${src("project_settings.ts")})) };
  const writer = { ...(await import(${src("project_settings_writer.ts")})) };
  mock.module(${src("tracker_receipts.ts")}, () => ({
    ...receipts,
    writeReceipt: (root: string, input: any) => {
      calls.push("receipt:" + input.kind);
      ${o.mode === "change-receipt-fails" ? `if (input.kind === "retro-change") throw new Error("forced receipt store failure");` : ""}
      return receipts.writeReceipt(root, input);
    },
  }));
  mock.module(${src("capture_registration.ts")}, () => ({
    ...reg,
    checkRegisterPreconditions: (root: string, o: any) => {
      calls.push("check");
      ${o.mode === "check-edits-settings" ? `if (!calls.includes("edited")) { calls.push("edited"); appendFileSync(${settingsFile}, "# edited by another writer\\n"); }` : ""}
      return reg.checkRegisterPreconditions(root, o);
    },
    registerCapture: (root: string) => {
      calls.push("register");
      ${
        o.mode === "register-refuses"
          ? `mkdirSync(join(root, ".claude"), { recursive: true });
      writeFileSync(join(root, ${JSON.stringify(LOCAL_SETTINGS)}), '{"partial": true}\\n');
      return ["Refusing: forced\\nRemedy: none\\nContext: test=spy815"];`
          : "return reg.registerCapture(root);"
      }
    },
  }));
  const write = (impl: any) => (root: string, update: any, o?: any) => {
    calls.push("write");
    opts.push(o ?? null);
    ${o.mode === "foreign-writer-at-write" ? `writeFileSync(${settingsFile} + ".lock", "held by another writer\\n"); appendFileSync(${settingsFile}, "# written by another writer\\n");` : ""}
    return impl(root, update, o);
  };
  mock.module(${src("project_settings.ts")}, () => ({ ...settings, writeProjectSettings: write(settings.writeProjectSettings) }));
  mock.module(${src("project_settings_writer.ts")}, () => ({ ...writer, writeProjectSettings: write(writer.writeProjectSettings) }));
  const mod = await import(${src("retro_proposal.ts")});
  let error: string | null = null;
  try { await mod.apply(${JSON.stringify(o.root)}, ${JSON.stringify(o.report)}, ${JSON.stringify(o.digest)}); } catch (e) { error = e instanceof Error ? e.message : String(e); }
  console.log("SPY_CALLS=" + JSON.stringify(calls.filter((c, i) => c !== calls[i - 1])));
  console.log("SPY_OPTS=" + JSON.stringify(opts));
  console.log("SPY_ERROR=" + JSON.stringify(error));
});
`;
  writeFileSync(path, body);
  return path;
}

interface SpyOut {
  calls: string[];
  opts: any[];
  error: string | null;
}

function runSpy(a: Approved, mode: SpyMode): SpyOut {
  const file = applySpy({ root: a.root, report: a.report, digest: a.digest, mode });
  const r = runNestedBunTest([file], { cwd: a.root, env: childEnv({ configDir: a.configDir, session: a.session }) });
  const out = `${r.stdout}\n${r.stderr}`;
  const grab = (tag: string) => {
    const line = out.split("\n").find((l) => l.startsWith(`${tag}=`));
    if (line === undefined) throw new Error(`the spy printed no ${tag} line (exit ${r.exitCode}):\n${out}`);
    return JSON.parse(line.slice(tag.length + 1));
  };
  return { calls: grab("SPY_CALLS"), opts: grab("SPY_OPTS"), error: grab("SPY_ERROR") };
}

// ------------------------------------------------------------------ AC.1

describe("AC-STE-815.1 a successful apply writes a retro-change receipt", () => {
  test(
    "token_stats row on a set key: one retro-change receipt, evidence exactly { digest, applied_at, changes }, from false to true",
    async () => {
      const root = makeTree("815-ac1-set");
      const report = await writeReport815("815-ac1-set", "token");
      const a = approve("815-ac1-set", root, report);
      const t0 = Date.now();
      const r = applyApproved(a);
      const t1 = Date.now();
      expect(r.status).toBe(0);

      const changes = changeReceipts(root, a.session);
      expect(changes).toHaveLength(1);
      const ev = changes[0].evidence;
      expect(Object.keys(ev).sort()).toEqual(["applied_at", "changes", "digest"]);
      expect(ev.digest).toBe(a.digest);
      expect(ev.changes).toEqual([{ key: TOKEN_KEY, from: false, to: true }]);
      expect(typeof ev.applied_at).toBe("string");
      expect(ev.applied_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
      const at = Date.parse(ev.applied_at);
      expect(at).toBeGreaterThanOrEqual(Math.floor(t0 / 1000) * 1000);
      expect(at).toBeLessThanOrEqual(t1);
    },
    LONG,
  );

  test(
    "token_stats unset and tool_calls false: one change per written key, the unset one from \"absent\"",
    async () => {
      const settings = `${SETTINGS_HEAD}tracking:\n  gate_outcomes:\n    enabled: false\n  tool_calls:\n    enabled: false\n`;
      const root = makeTree("815-ac1-absent", { settings, gitignore: IGNORE_LOCAL });
      const report = await writeReport815("815-ac1-absent", "two");
      const a = approve("815-ac1-absent", root, report);
      expect(a.lines).toContain(`set ${TOKEN_KEY}: true`);
      expect(a.lines).toContain(`set ${TOOL_KEY}: true`);
      expect(applyApproved(a).status).toBe(0);

      const changes = changeReceipts(root, a.session);
      expect(changes).toHaveLength(1);
      expect(byKey(changes[0].evidence.changes)).toEqual([
        { key: TOKEN_KEY, from: "absent", to: true },
        { key: TOOL_KEY, from: false, to: true },
      ]);
    },
    LONG,
  );

  test(
    "the two receipts are the retro-apply and the retro-change, and no receipt holds a trial_id key",
    async () => {
      const root = makeTree("815-ac1-trial");
      const report = await writeReport815("815-ac1-trial", "token");
      const a = approve("815-ac1-trial", root, report);
      expect(applyApproved(a).status).toBe(0);
      const receipts = allReceipts(root, a.session);
      expect(receipts.map((x) => x.kind).sort()).toEqual(["retro-apply", "retro-change"]);
      for (const rel of receiptFiles(root, a.session)) {
        expect(readFileSync(join(root, rel), "utf-8")).not.toContain("trial_id");
      }
    },
    LONG,
  );

  test(
    "a spy records the retro-change receipt after register, the last call of the apply",
    async () => {
      const root = makeTree("815-ac1-order", { gitignore: IGNORE_LOCAL });
      const report = await writeReport815("815-ac1-order", "tool");
      const a = approve("815-ac1-order", root, report);
      const s = runSpy(a, "order");
      expect(s.error).toBeNull();
      const outer = s.calls.filter((c) => c.startsWith("receipt:") || c === "write" || c === "register");
      expect(outer).toEqual(["receipt:retro-apply", "write", "register", "receipt:retro-change"]);
    },
    LONG,
  );
});

// ------------------------------------------------------------------ AC.2

describe("AC-STE-815.2 a failed step writes no retro-change receipt", () => {
  test(
    "a register forced to refuse: the prior bytes come back, no retro-change, the retro-apply receipt exactly as today",
    async () => {
      const root = makeTree("815-ac2-register", { gitignore: IGNORE_LOCAL });
      const report = await writeReport815("815-ac2-register", "tool");
      const prior = readOr(settingsPath(root));
      const a = approve("815-ac2-register", root, report);
      const s = runSpy(a, "register-refuses");
      expect(s.calls).toContain("register");
      expect(s.error).not.toBeNull();
      expect(readOr(settingsPath(root))).toBe(prior);
      expect(changeReceipts(root, a.session)).toEqual([]);
      const applied = retroApplyReceipts(root, a.session);
      expect(applied).toHaveLength(1);
      expect(applied[0]).toMatchObject({
        kind: "retro-apply",
        adapter: null,
        container: null,
        subject: "dev-process-toolkit:retro",
        decision: "apply",
        evidence: { answer: a.answerUuid, digest: a.digest },
      });
    },
    LONG,
  );

  test(
    "the writer refusing at the write step (malformed video section): no retro-change, one retro-apply",
    async () => {
      const root = makeTree("815-ac2-video", { settings: `${SETTINGS_HEAD}${trackingYaml(OFF)}video:\n  bogus: 1\n` });
      const report = await writeReport815("815-ac2-video", "token");
      const a = approve("815-ac2-video", root, report);
      // Precondition: this approval does apply cleanly but for the write step, so the
      // check below is a real absence, not a refusal before any step ran.
      expect(a.lines).toContain(`set ${TOKEN_KEY}: true`);
      expectRefusal(applyApproved(a));
      expect(receiptFiles(root, a.session)).toHaveLength(1);
      expect(changeReceipts(root, a.session)).toEqual([]);
      expect(retroApplyReceipts(root, a.session)).toHaveLength(1);
    },
    LONG,
  );
});

// ------------------------------------------------------------------ AC.3

describe("AC-STE-815.3 the writer refuses over bytes it did not read", () => {
  test("expectSha256 differing from the file's bytes: SettingsShapeError in NFR-10 naming both hashes, nothing written, no lock left", async () => {
    const root = makeTree("815-ac3-mismatch");
    const before = readFileSync(settingsPath(root));
    const current = hex(before);
    const stale = hex(Buffer.concat([before, Buffer.from("# another writer\n")]));
    const { writeProjectSettings } = await writerMod();
    const SettingsShapeError = await shapeErrorClass();
    let err: unknown = null;
    try {
      writeProjectSettings(root, { tracking: { token_stats: { enabled: true } } }, { expectSha256: stale });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SettingsShapeError);
    const msg = (err as Error).message;
    expect(msg).toMatch(NFR10_RE);
    expect(msg).toContain(stale);
    expect(msg).toContain(current);
    expect(readFileSync(settingsPath(root)).equals(before)).toBe(true);
    expect(existsSync(lockPath(root))).toBe(false);
  });

  test("expectSha256 equal to the file's bytes: the write goes through", async () => {
    const root = makeTree("815-ac3-match");
    const current = hex(readFileSync(settingsPath(root)));
    const { writeProjectSettings } = await writerMod();
    writeProjectSettings(root, { tracking: { token_stats: { enabled: true } } }, { expectSha256: current });
    expect(readFileSync(settingsPath(root), "utf-8")).toMatch(/token_stats:\n {4}enabled: true/);
  });

  test(
    "apply passes the sha256 of the settings bytes it recomputed the proposal from",
    async () => {
      const root = makeTree("815-ac3-passes", { gitignore: IGNORE_LOCAL });
      const report = await writeReport815("815-ac3-passes", "token");
      const read = hex(readFileSync(settingsPath(root)));
      const a = approve("815-ac3-passes", root, report);
      const s = runSpy(a, "order");
      expect(s.calls).toContain("write");
      expect(s.opts).toHaveLength(1);
      const given = s.opts[0]?.expectSha256;
      expect(typeof given).toBe("string");
      expect(String(given).replace(/^sha256:/, "")).toBe(read);
    },
    LONG,
  );

  test(
    "the settings file changed between the recompute and the write: apply refuses on the hash, the key is not written, no retro-change",
    async () => {
      const root = makeTree("815-ac3-stale", { gitignore: IGNORE_LOCAL });
      const report = await writeReport815("815-ac3-stale", "tool");
      const read = readFileSync(settingsPath(root));
      const a = approve("815-ac3-stale", root, report);
      const s = runSpy(a, "check-edits-settings");
      expect(s.calls).toContain("edited");
      const edited = Buffer.concat([read, Buffer.from("# edited by another writer\n")]);
      expect(s.error).not.toBeNull();
      expect(s.error!).toMatch(NFR10_RE);
      expect(s.error!).toContain(hex(edited));
      expect(s.error!).toContain(hex(read));
      expect(s.calls).not.toContain("register");
      expect(readFileSync(settingsPath(root)).equals(edited)).toBe(true);
      expect(changeReceipts(root, a.session)).toEqual([]);
      expect(retroApplyReceipts(root, a.session)).toHaveLength(1);
    },
    LONG,
  );
});

// ------------------------------------------------- Stage B review fixes

describe("STE-815 review: apply's rollback never writes over another writer", () => {
  test(
    "another writer holds the lock and changes the file at apply's write: apply refuses and leaves that writer's bytes and lock alone",
    async () => {
      const root = makeTree("815-rv-foreign", { gitignore: IGNORE_LOCAL });
      const report = await writeReport815("815-rv-foreign", "tool");
      const a = approve("815-rv-foreign", root, report);
      const s = runSpy(a, "foreign-writer-at-write");
      expect(s.error).not.toBeNull();
      expect(s.error!).toMatch(NFR10_RE);
      expect(readFileSync(settingsPath(root), "utf-8")).toContain("# written by another writer\n");
      expect(readOr(lockPath(root))).toBe("held by another writer\n");
      expect(changeReceipts(root, a.session)).toEqual([]);
    },
    LONG,
  );

  test(
    "the retro-change receipt fails after a successful apply: the refusal says the change is applied and needs no retry, and names the changes",
    async () => {
      const root = makeTree("815-rv-receipt", { gitignore: IGNORE_LOCAL });
      const report = await writeReport815("815-rv-receipt", "tool");
      const a = approve("815-rv-receipt", root, report);
      const s = runSpy(a, "change-receipt-fails");
      expect(s.error).not.toBeNull();
      expect(s.error!).toMatch(NFR10_RE);
      expect(s.error!).toContain("is applied");
      expect(s.error!).toContain("no retry");
      expect(s.error!).toContain("tracking.tool_calls.enabled");
      expect(readFileSync(settingsPath(root), "utf-8")).toMatch(/tool_calls:\n {4}enabled: true/);
    },
    LONG,
  );
});

describe("STE-815 review: the lock belongs to the writer that made it", () => {
  test("a lock another writer put in place during the write is not removed on exit", async () => {
    const root = makeTree("815-rv-owner");
    const { withSettingsLock } = await writerMod();
    withSettingsLock(settingsPath(root), () => writeFileSync(lockPath(root), "taken over by another writer\n"));
    expect(readOr(lockPath(root))).toBe("taken over by another writer\n");
  });

  test("a lock dated more than 30 s in the future is stale and replaced", async () => {
    const root = makeTree("815-rv-future");
    writeFileSync(lockPath(root), "from a skewed clock\n");
    const future = (Date.now() + 120_000) / 1000;
    utimesSync(lockPath(root), future, future);
    const { writeProjectSettings } = await writerMod();
    writeProjectSettings(root, { tracking: { token_stats: { enabled: true } } });
    expect(readFileSync(settingsPath(root), "utf-8")).toMatch(/token_stats:\n {4}enabled: true/);
    expect(existsSync(lockPath(root))).toBe(false);
  });

  test("a lock dated a few seconds in the future is held, and refused", async () => {
    const root = makeTree("815-rv-near-future");
    writeFileSync(lockPath(root), "held by another writer\n");
    const soon = (Date.now() + 5_000) / 1000;
    utimesSync(lockPath(root), soon, soon);
    const { writeProjectSettings } = await writerMod();
    const SettingsShapeError = await shapeErrorClass();
    let err: unknown = null;
    try {
      writeProjectSettings(root, { tracking: { token_stats: { enabled: true } } });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SettingsShapeError);
    expect(readOr(lockPath(root))).toBe("held by another writer\n");
  });

  test("a refused non-create write on a tree with no specs directory leaves no specs directory behind", async () => {
    const root = tempDir("815-rv-nospecs");
    const { writeProjectSettings } = await writerMod();
    expect(() => writeProjectSettings(root, { tracking: { token_stats: { enabled: true } } })).toThrow();
    expect(existsSync(join(root, "specs"))).toBe(false);
  });

  test("expectSha256 is bare hex: a sha256:-prefixed value does not match", async () => {
    const root = makeTree("815-rv-prefix");
    const { writeProjectSettings } = await writerMod();
    const SettingsShapeError = await shapeErrorClass();
    const prefixed = `sha256:${hex(readFileSync(settingsPath(root)))}`;
    let err: unknown = null;
    try {
      writeProjectSettings(root, { tracking: { token_stats: { enabled: true } } }, { expectSha256: prefixed });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SettingsShapeError);
  });
});

// ------------------------------------------------------------------ AC.4

/**
 * A nested `bun test` file that wraps `validateSettingsShape` (the shape check
 * the writer runs on the merged settings, mid read-modify-write) to record
 * whether the lock file exists at that moment; in "throw" mode it throws once
 * it sees the merged update, so the writer exits by an exception.
 */
function lockSpy(root: string, mode: "pass" | "throw"): { seen: boolean[]; error: string | null; exitCode: number; out: string } {
  const path = join(tempDir("lockspy815"), "lock.test.ts");
  const src = (rel: string) => JSON.stringify(join(SRC, rel));
  const body = `
import { test, mock } from "bun:test";
import { existsSync } from "node:fs";
const seen: boolean[] = [];
test("lock spy", async () => {
  const settings = { ...(await import(${src("project_settings.ts")})) };
  mock.module(${src("project_settings.ts")}, () => ({
    ...settings,
    validateSettingsShape: (x: any) => {
      seen.push(existsSync(${JSON.stringify(lockPath(root))}));
      ${mode === "throw" ? `if (x?.tracking?.token_stats?.enabled === true) throw new Error("forced validation failure");` : ""}
      return settings.validateSettingsShape(x);
    },
  }));
  const writer = await import(${src("project_settings_writer.ts")});
  let error: string | null = null;
  try { writer.writeProjectSettings(${JSON.stringify(root)}, { tracking: { token_stats: { enabled: true } } }); } catch (e) { error = e instanceof Error ? e.message : String(e); }
  console.log("LOCK_SEEN=" + JSON.stringify(seen));
  console.log("LOCK_ERROR=" + JSON.stringify(error));
});
`;
  writeFileSync(path, body);
  const r = runNestedBunTest([path], { cwd: root, env: childEnv({}) });
  const out = `${r.stdout}\n${r.stderr}`;
  const grab = (tag: string) => {
    const line = out.split("\n").find((l) => l.startsWith(`${tag}=`));
    if (line === undefined) throw new Error(`the lock spy printed no ${tag} line (exit ${r.exitCode}):\n${out}`);
    return JSON.parse(line.slice(tag.length + 1));
  };
  return { seen: grab("LOCK_SEEN"), error: grab("LOCK_ERROR"), exitCode: r.exitCode, out };
}

describe("AC-STE-815.4 one writer changes the settings file at a time", () => {
  test("a lock younger than 30 s held by another writer: NFR-10 refusal, nothing written, the other writer's lock untouched", async () => {
    const root = makeTree("815-ac4-fresh");
    const before = readFileSync(settingsPath(root));
    writeFileSync(lockPath(root), "held by another writer\n");
    const { writeProjectSettings } = await writerMod();
    const SettingsShapeError = await shapeErrorClass();
    let err: unknown = null;
    try {
      writeProjectSettings(root, { tracking: { token_stats: { enabled: true } } });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SettingsShapeError);
    expect((err as Error).message).toMatch(NFR10_RE);
    expect(readFileSync(settingsPath(root)).equals(before)).toBe(true);
    expect(readOr(lockPath(root))).toBe("held by another writer\n");
  });

  test("a lock older than 30 s is replaced: the write goes through and no lock is left", async () => {
    const root = makeTree("815-ac4-stale");
    writeFileSync(lockPath(root), "left by a dead writer\n");
    const past = (Date.now() - 120_000) / 1000;
    utimesSync(lockPath(root), past, past);
    const { writeProjectSettings } = await writerMod();
    writeProjectSettings(root, { tracking: { token_stats: { enabled: true } } });
    expect(readFileSync(settingsPath(root), "utf-8")).toMatch(/token_stats:\n {4}enabled: true/);
    expect(existsSync(lockPath(root))).toBe(false);
  });

  test(
    "the lock exists throughout the read-modify-write of a successful write, and is gone after it",
    () => {
      const root = makeTree("815-ac4-held");
      const s = lockSpy(root, "pass");
      expect(s.error).toBeNull();
      expect(s.seen.length).toBeGreaterThan(0);
      expect(s.seen.every((x) => x)).toBe(true);
      expect(readFileSync(settingsPath(root), "utf-8")).toMatch(/token_stats:\n {4}enabled: true/);
      expect(existsSync(lockPath(root))).toBe(false);
    },
    LONG,
  );

  test(
    "a throw mid read-modify-write: the lock was held, and is removed on that exit path too",
    () => {
      const root = makeTree("815-ac4-throw");
      const before = readFileSync(settingsPath(root));
      const s = lockSpy(root, "throw");
      expect(s.error).toContain("forced validation failure");
      expect(s.seen.length).toBeGreaterThan(0);
      expect(s.seen[s.seen.length - 1]).toBe(true);
      expect(existsSync(lockPath(root))).toBe(false);
      expect(readFileSync(settingsPath(root)).equals(before)).toBe(true);
    },
    LONG,
  );
});

// ------------------------------------------------------------------ AC.5

/** The pinned non-test importers of `project_settings_writer`, relative to the plugin root. */
const PINNED_IMPORTERS = [
  "adapters/_shared/src/migrations/entries/retro_priority_default.ts",
  "adapters/_shared/src/migrations/entries/settings_file.ts",
  "adapters/_shared/src/project_settings.ts",
  "adapters/_shared/src/retro_proposal.ts",
];

const SPECIFIER_RE = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)["']([^"']+)["']/g;
const WRITER_SPECIFIER_RE = /(?:^|\/)project_settings_writer(?:\.ts)?$/;

/** Every `.ts` module under `root` (outside node_modules and tests/) whose import specifiers name the writer. */
function writerImporters(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const rel = relative(root, full);
      if (name === "node_modules" || rel === "tests") continue;
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!name.endsWith(".ts")) continue;
      const text = readFileSync(full, "utf-8");
      const specs = [...text.matchAll(SPECIFIER_RE)].map((m) => m[1]!);
      if (specs.some((s) => WRITER_SPECIFIER_RE.test(s))) out.push(rel);
    }
  };
  walk(root);
  return out.sort();
}

/** Throws naming each module that is not pinned (and each pinned one that went). */
function checkImporters(found: string[], pinned: readonly string[]): void {
  const added = found.filter((f) => !pinned.includes(f));
  const gone = pinned.filter((p) => !found.includes(p));
  if (added.length > 0 || gone.length > 0) {
    throw new Error(
      `project_settings_writer importer allowlist drifted: ` +
        `${added.length > 0 ? `new importer(s) ${added.join(", ")} — the settings file has one writer path; route the change through it or pin the module here` : ""}` +
        `${added.length > 0 && gone.length > 0 ? "; " : ""}` +
        `${gone.length > 0 ? `pinned importer(s) no longer import it: ${gone.join(", ")}` : ""}`,
    );
  }
}

describe("AC-STE-815.5 the project_settings_writer importer allowlist", () => {
  test("the non-test importers under the plugin equal the pinned set", () => {
    const found = writerImporters(PLUGIN_ROOT);
    checkImporters(found, PINNED_IMPORTERS);
    expect(found).toEqual(PINNED_IMPORTERS);
  });

  test("the check fails naming a new importer, and ignores tests/, node_modules and a mention in a comment", () => {
    const root = tempDir("815-ac5-fixture");
    mkdirSync(join(root, "adapters"), { recursive: true });
    mkdirSync(join(root, "tests"), { recursive: true });
    mkdirSync(join(root, "node_modules", "x"), { recursive: true });
    writeFileSync(join(root, "adapters", "pinned.ts"), 'import { writeProjectSettings } from "./project_settings_writer";\n');
    writeFileSync(join(root, "adapters", "sneaky.ts"), 'const w = require("../adapters/project_settings_writer.ts");\n');
    writeFileSync(join(root, "adapters", "mention.ts"), "// project_settings_writer is the writer\nexport const project_settings_writer = 1;\n");
    writeFileSync(join(root, "tests", "t.ts"), 'import "../adapters/project_settings_writer";\n');
    writeFileSync(join(root, "node_modules", "x", "y.ts"), 'import "./project_settings_writer";\n');
    const found = writerImporters(root);
    expect(found).toEqual(["adapters/pinned.ts", "adapters/sneaky.ts"]);
    expect(() => checkImporters(found, ["adapters/pinned.ts"])).toThrow("adapters/sneaky.ts");
  });
});

// ------------------------------------------------------------------ AC.6

describe("AC-STE-815.6 docs/retro-reference.md", () => {
  const doc = () => readFileSync(RETRO_REFERENCE, "utf-8");
  const sentences = () => doc().split(/(?<=[.!?])\s+/);

  test("describes the change receipt: kind retro-change, its changes list of key/from/to, and \"absent\"", () => {
    const d = doc();
    expect(d).toContain("`retro-change`");
    expect(d).toMatch(/`changes`/);
    expect(d).toMatch(/`from`/);
    expect(d).toMatch(/`to`/);
    expect(d).toContain('"absent"');
  });

  test("states the write order: the retro-change receipt is written after every step succeeded", () => {
    expect(sentences().some((s) => s.includes("retro-change") && /\bafter\b/.test(s))).toBe(true);
  });

  test("describes the lock and its refusal", () => {
    const d = doc();
    expect(d).toContain("specs/settings.yaml.lock");
    expect(d).toMatch(/30 s(econds)?\b/);
  });

  test("describes the hash refusal", () => {
    expect(doc()).toContain("expectSha256");
  });
});

// --------------------------------------------------------------- reports

async function writeReport815(label: string, which: "token" | "tool" | "two"): Promise<string> {
  return writeReport(label, which === "token" ? TOKEN_STATS_OFF() : which === "tool" ? TOOL_CALLS_OFF() : TWO_OFF());
}
