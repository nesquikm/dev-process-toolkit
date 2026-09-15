// M_4df444 / STE-593 — /implement Phase 3 (supervisor pre-review R1): an idle
// LIVE session's shell snapshot is never planned.
//
// The shell-snapshot rule was "born in the window, and named in no live
// process's command line". A live session names its snapshot only while one of
// its Bash calls is running (`/bin/zsh -c source <snapshot> … && …`); between
// calls nothing names it, so an idle live session's snapshot read as an orphan
// and a delete would silently strip that session's shell functions and aliases.
// Snapshots carry no session id, so the rule is narrowed by time instead: a
// snapshot born at or after the earliest live session's `startedAt` may belong to
// that session and is kept. That only ever deletes less.

import { afterEach, describe, expect, test } from "bun:test";
import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defaultProbes, type PlanContext, PLANNERS } from "./smoke_session_cleanup";

const HOUR = 3_600_000;
const MIN = 60_000;
const roots: string[] = [];
const procs: ChildProcess[] = [];
afterEach(() => {
  for (const p of procs.splice(0)) {
    try {
      p.kill("SIGKILL");
    } catch {}
  }
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function fixture(registryInSecondConfigDir = false) {
  const root = mkdtempSync(join(tmpdir(), "ste593-snap-"));
  roots.push(root);
  const home = join(root, "home");
  const cfg1 = join(home, ".claude-st");
  const cfg2 = join(home, ".claude");
  for (const d of [cfg1, cfg2]) mkdirSync(join(d, "shell-snapshots"), { recursive: true });
  const now = Date.now();
  const window = { startMs: now - 3 * HOUR, endMs: now };
  const liveStart = now - 2 * HOUR;
  const live = spawn("sleep", ["300"], { stdio: "ignore" });
  procs.push(live);
  const regDir = join(registryInSecondConfigDir ? cfg2 : cfg1, "sessions");
  mkdirSync(regDir, { recursive: true });
  writeFileSync(
    join(regDir, `${live.pid}.json`),
    JSON.stringify({ pid: live.pid, sessionId: randomUUID(), cwd: "/work", startedAt: liveStart, kind: "interactive", entrypoint: "cli" }),
  );
  const before = join(cfg1, "shell-snapshots", `snapshot-zsh-${liveStart - 30 * MIN}-aaaaaa.sh`);
  const after = join(cfg1, "shell-snapshots", `snapshot-zsh-${liveStart + 10 * MIN}-bbbbbb.sh`);
  for (const p of [before, after]) writeFileSync(p, "# shell snapshot\n");
  const ctx: PlanContext = {
    roots: { configDirs: [cfg1, cfg2], cacheRoot: join(root, "cache"), homeDir: home, cmuxDir: join(root, "cmux"), projectRoot: join(root, "proj") },
    runSet: new Set(),
    window,
    manual: false,
    // Idle: no live process names any snapshot right now.
    probes: { ...defaultProbes(), commandLines: () => [], isHeld: () => false },
  };
  return { ctx, before, after, live };
}

describe("AC-STE-593.2 / AC-STE-593.8 — Phase 3: an idle live session's shell snapshot is never planned", () => {
  test("a snapshot born after a live session started is kept; one born before it is still planned", async () => {
    const f = fixture();
    const got = await PLANNERS.shell_snapshots(f.ctx);
    expect(got).toContain(f.before);
    expect(got).not.toContain(f.after);
  });

  test("the live session's registry is read from every config dir in play", async () => {
    const f = fixture(true);
    const got = await PLANNERS.shell_snapshots(f.ctx);
    expect(got).not.toContain(f.after);
    expect(got).toContain(f.before);
  });

  test("polarity: once that session is dead, both snapshots are the run's to plan", async () => {
    const f = fixture();
    await new Promise<void>((res) => {
      f.live.once("exit", () => res());
      f.live.kill("SIGKILL");
    });
    const got = await PLANNERS.shell_snapshots(f.ctx);
    expect(got).toContain(f.before);
    expect(got).toContain(f.after);
  });
});
