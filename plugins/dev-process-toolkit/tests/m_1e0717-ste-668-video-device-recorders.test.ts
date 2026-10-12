// M_1e0717 STE-668 — simulator and emulator recorders (ios-sim, android-emu).
//
// AC coverage:
//   AC-STE-668.1 — ios-sim issues `xcrun simctl io booted recordVideo --codec h264 <clip>`, then
//                  the driver argv, then SIGINT to the recorder after the driver exits, and waits
//                  for the recorder to exit before validating (the fake recorder writes its clip
//                  only after SIGINT, with a delay; validation's ffprobe call is logged too).
//   AC-STE-668.2 — android-emu issues `adb shell screenrecord <device-path>`, the driver argv, a
//                  stop, and `adb pull <device-path> <clip>`, in that order.
//   AC-STE-668.3 — the driver receives the four RECORDER_ENV variables (the one constant the
//                  command recorder uses); markers it writes reach the markers file. Neither new
//                  module spells a `DPT_VIDEO_` literal of its own.
//   AC-STE-668.4 — `xcrun` / `adb` absent from PATH, or a device listing with no booted device,
//                  refuses before any recording starts, naming the tool or the device check.
//   AC-STE-668.5 — android-emu with durationHint > 180 refuses before recording, naming the
//                  180-second screenrecord limit (180 itself is accepted).
//   AC-STE-668.6 — a driver exiting non-zero still stops the recording, then refuses naming the
//                  shot and quoting its stderr tail (last 20 lines).
//
// Module contract this suite drives (adapters/_shared/src/video/):
//   recorder.ts
//     export interface Shot { id; scenario; durationHint; recorder?: RecorderKind;
//       driver?: string[] }   // NEW: the shot's argv driver command (ios-sim / android-emu)
//     recordShot(opts) gains `spawner?: Spawner` and dispatches kind `ios-sim` → recordIosSim
//       (device = config.device) and `android-emu` → recordAndroidEmu (device = config.device).
//   Spawner shape (an injected process launcher; default wraps Bun.spawn):
//     type Spawner = (argv: string[], opts: { cwd: string; env: Record<string, string | undefined> })
//       => SpawnedProcess
//     interface SpawnedProcess {
//       exited: Promise<number>;           // exit code
//       stdout: Promise<string>;           // full stdout text
//       stderr: Promise<string>;           // full stderr text
//       kill(signal?: NodeJS.Signals): void;
//     }
//     Every child the recorders start — device listing, recorder, driver, stop, pull — goes
//     through the spawner. The driver runs with cwd = project root and env = process.env plus
//     the four RECORDER_ENV variables.
//   recorder_ios.ts
//     export async function recordIosSim(opts: { projectRoot: string; slug: string; shot: Shot;
//       device: string; spawner?: Spawner; runner?: Runner; which?: Which }):
//       Promise<{ clip: string; markers: string }>
//       — preflight: which("xcrun"), then `xcrun simctl list devices` (plain text) must show a
//         `(Booted)` device; then recordVideo, driver, SIGINT, await recorder exit, validate.
//   recorder_android.ts
//     export async function recordAndroidEmu(opts: { projectRoot: string; slug: string; shot: Shot;
//       device?: string; spawner?: Spawner; runner?: Runner; which?: Which }):
//       Promise<{ clip: string; markers: string }>
//       — preflight: durationHint <= 180, which("adb"), `adb devices` must list a `device` row;
//         then `adb shell screenrecord <device-path>`, driver, stop (a signal to the screenrecord
//         process OR an `adb shell pkill|kill … screenrecord` spawn), `adb pull <device-path> <clip>`.
//   Outputs are shotOutputs(videoWorkDir(projectRoot, slug), shot.id) — cleared before recording.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { videoWorkDir } from "../adapters/_shared/src/dpt_paths";
import { RECORDER_ENV, recordShot, shotOutputs } from "../adapters/_shared/src/video/recorder";
import { recordAndroidEmu } from "../adapters/_shared/src/video/recorder_android";
import { recordIosSim } from "../adapters/_shared/src/video/recorder_ios";
import { defaultRunner, type Runner } from "../adapters/_shared/src/video/render";

const PLUGIN_ROOT = resolve(import.meta.dir, "..");
const VIDEO_SRC = join(PLUGIN_ROOT, "adapters", "_shared", "src", "video");
const FIXTURES = join(import.meta.dir, "fixtures", "video-device-recorders");
const SLOW = 60_000;
const SLUG = "demo";
const DRIVER = ["fake-driver", "--run", "ui-test"];

const temps: string[] = [];
function tempDir(prefix: string): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  temps.push(d);
  return d;
}

afterAll(() => {
  for (const d of temps) {
    spawnSync("rm", ["-rf", d]);
    if (existsSync(d)) throw new Error(`temp dir not removed: ${d}`);
  }
});

let goodMp4: string;
beforeAll(() => {
  const media = tempDir("ste668-media-");
  goodMp4 = join(media, "good.mp4");
  const r = spawnSync(
    "/opt/homebrew/bin/ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc=duration=2:size=160x120:rate=10",
      "-pix_fmt", "yuv420p", "-c:v", "libx264", goodMp4],
    { encoding: "utf8" },
  );
  if (r.status !== 0) throw new Error(`fixture ffmpeg failed: ${r.stderr}`);
});

const fixture = (name: string) => readFileSync(join(FIXTURES, name), "utf8");

// ---------------------------------------------------------------------------
// Fake spawner: logs spawns, signals and exits in one ordered event list.
// ---------------------------------------------------------------------------

type Event =
  | { type: "spawn"; id: number; argv: string[]; cwd: string; env: Record<string, string | undefined> }
  | { type: "signal"; id: number; signal: string }
  | { type: "exit"; id: number; code: number }
  | { type: "run"; argv: string[] };

interface FakeOpts {
  simctlList?: string;
  adbDevices?: string;
  driverCode?: number;
  driverStderr?: string;
  driverMarkers?: { name: string; t: number }[];
  /** FIX-4: false = the driver writes no markers file at all. */
  driverWritesMarkers?: boolean;
}

const STOP_WORDS = ["pkill", "kill", "killall"];

function fakeDevices(o: FakeOpts = {}) {
  const log: Event[] = [];
  let next = 0;
  const recorders: { id: number; argv: string[]; finish: (code: number) => void }[] = [];

  const spawner = (argv: string[], opts: { cwd: string; env: Record<string, string | undefined> }) => {
    const id = next++;
    log.push({ type: "spawn", id, argv: [...argv], cwd: opts.cwd, env: { ...opts.env } });
    let resolveExit!: (code: number) => void;
    let done = false;
    const exited = new Promise<number>((r) => (resolveExit = r));
    let stdout = "";
    let stderr = "";
    const finish = (code: number) => {
      if (done) return;
      done = true;
      log.push({ type: "exit", id, code });
      resolveExit(code);
    };
    const tool = basename(argv[0] ?? "");
    let onKill: (signal: string) => void = () => finish(143);

    const isStop = argv.some((a) => STOP_WORDS.includes(a));
    if (tool === "xcrun" && argv.includes("simctl") && argv.includes("list")) {
      stdout = o.simctlList ?? fixture("simctl-list-booted.txt");
      setTimeout(() => finish(0), 5);
    } else if (tool === "adb" && argv[argv.length - 1] === "devices") {
      stdout = o.adbDevices ?? fixture("adb-devices-one.txt");
      setTimeout(() => finish(0), 5);
    } else if (tool === "xcrun" && argv.includes("recordVideo")) {
      // Long-running: writes its clip ONLY after SIGINT, a little later, then exits.
      const clip = argv[argv.length - 1];
      onKill = (signal) => {
        if (signal !== "SIGINT") return finish(137);
        setTimeout(() => {
          copyFileSync(goodMp4, clip);
          finish(0);
        }, 150);
      };
      recorders.push({ id, argv, finish });
    } else if (tool === "adb" && argv.includes("screenrecord") && !isStop) {
      onKill = () => setTimeout(() => finish(0), 50);
      recorders.push({ id, argv, finish });
    } else if (tool === "adb" && argv.includes("screenrecord") && isStop) {
      for (const r of recorders) setTimeout(() => r.finish(0), 50);
      setTimeout(() => finish(0), 5);
    } else if (tool === "adb" && argv[1] === "pull") {
      copyFileSync(goodMp4, argv[argv.length - 1]);
      setTimeout(() => finish(0), 5);
    } else if (argv[0] === DRIVER[0]) {
      const markersPath = opts.env[RECORDER_ENV.outMarkers];
      if (markersPath && o.driverWritesMarkers !== false) {
        writeFileSync(markersPath, JSON.stringify(o.driverMarkers ?? [{ name: "start", t: 0.1 }, { name: "done", t: 1.2 }]));
      }
      stderr = o.driverStderr ?? "";
      setTimeout(() => finish(o.driverCode ?? 0), 30);
    } else {
      setTimeout(() => finish(0), 5);
    }

    return {
      exited,
      stdout: exited.then(() => stdout),
      stderr: exited.then(() => stderr),
      kill(signal: string = "SIGTERM") {
        log.push({ type: "signal", id, signal });
        onKill(signal);
      },
    };
  };

  const runner: Runner = async (argv, opts) => {
    log.push({ type: "run", argv: [...argv] });
    return defaultRunner(argv, opts);
  };

  return { log, spawner: spawner as never, runner };
}

const realWhich = (bin: string) => Bun.which(bin);
const whichWith = (missing: string[] = []) => (bin: string) => {
  if (missing.includes(bin)) return null;
  if (bin === "xcrun" || bin === "adb") return `/fake/bin/${bin}`;
  return realWhich(bin);
};

const shot = (id: string, extra: Record<string, unknown> = {}) =>
  ({ id, scenario: `scenario-of-${id}`, durationHint: 4, driver: DRIVER, ...extra }) as never;

function project(): string {
  return tempDir("ste668-project-");
}

const spawns = (log: Event[]) => log.filter((e): e is Extract<Event, { type: "spawn" }> => e.type === "spawn");
const idxOf = (log: Event[], pred: (e: Event) => boolean) => log.findIndex(pred);
const toolIs = (argv: string[], tool: string) => basename(argv[0] ?? "") === tool;

async function refusal(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error("expected a refusal, but the call resolved");
}

// ---------------------------------------------------------------------------

describe("AC-STE-668.1 ios-sim records with simctl and stops with SIGINT", () => {
  test(
    "recordVideo → driver → driver exit → SIGINT → recorder exit → validation, in that order",
    async () => {
      const root = project();
      const f = fakeDevices();
      const out = await recordShot({
        projectRoot: root,
        slug: SLUG,
        shot: shot("ios-hero"),
        config: { kind: "ios-sim", device: "booted" },
        spawner: f.spawner,
        runner: f.runner,
        which: whichWith(),
      } as never);

      const { clip, markers } = shotOutputs(videoWorkDir(root, SLUG), "ios-hero");
      expect(out).toMatchObject({ kind: "ios-sim", clip, markers });

      const log = f.log;
      const recIdx = idxOf(log, (e) => e.type === "spawn" && e.argv.includes("recordVideo"));
      expect(recIdx).toBeGreaterThanOrEqual(0);
      const rec = log[recIdx] as Extract<Event, { type: "spawn" }>;
      expect(toolIs(rec.argv, "xcrun")).toBe(true);
      expect(rec.argv.slice(1)).toEqual(["simctl", "io", "booted", "recordVideo", "--codec", "h264", clip]);

      const drvIdx = idxOf(log, (e) => e.type === "spawn" && e.argv[0] === DRIVER[0]);
      const drv = log[drvIdx] as Extract<Event, { type: "spawn" }>;
      expect(drv.argv).toEqual(DRIVER);
      const drvExit = idxOf(log, (e) => e.type === "exit" && e.id === drv.id);
      const sigIdx = idxOf(log, (e) => e.type === "signal" && e.id === rec.id);
      const recExit = idxOf(log, (e) => e.type === "exit" && e.id === rec.id);
      const probeIdx = idxOf(log, (e) => e.type === "run" && e.argv.includes(clip));

      expect(recIdx).toBeLessThan(drvIdx);
      expect(drvIdx).toBeLessThan(drvExit);
      expect(drvExit).toBeLessThan(sigIdx);
      expect((log[sigIdx] as Extract<Event, { type: "signal" }>).signal).toBe("SIGINT");
      expect(sigIdx).toBeLessThan(recExit);
      expect(probeIdx).toBeGreaterThan(recExit);

      expect(existsSync(clip)).toBe(true);
    },
    SLOW,
  );
});

describe("AC-STE-668.2 android-emu records with screenrecord and pulls the file", () => {
  test(
    "screenrecord → driver → stop → pull, in that order",
    async () => {
      const root = project();
      const f = fakeDevices();
      const out = await recordShot({
        projectRoot: root,
        slug: SLUG,
        shot: shot("droid-hero"),
        config: { kind: "android-emu" },
        spawner: f.spawner,
        runner: f.runner,
        which: whichWith(),
      } as never);

      const { clip, markers } = shotOutputs(videoWorkDir(root, SLUG), "droid-hero");
      expect(out).toMatchObject({ kind: "android-emu", clip, markers });

      const log = f.log;
      const recIdx = idxOf(
        log,
        (e) => e.type === "spawn" && e.argv.includes("screenrecord") && !e.argv.some((a) => STOP_WORDS.includes(a)),
      );
      expect(recIdx).toBeGreaterThanOrEqual(0);
      const rec = log[recIdx] as Extract<Event, { type: "spawn" }>;
      expect(toolIs(rec.argv, "adb")).toBe(true);
      const devicePath = rec.argv[rec.argv.length - 1];
      expect(devicePath.startsWith("/")).toBe(true);
      expect(devicePath.endsWith(".mp4")).toBe(true);
      expect(rec.argv.slice(1)).toEqual(["shell", "screenrecord", devicePath]);

      const drvIdx = idxOf(log, (e) => e.type === "spawn" && e.argv[0] === DRIVER[0]);
      expect((log[drvIdx] as Extract<Event, { type: "spawn" }>).argv).toEqual(DRIVER);
      const drvId = (log[drvIdx] as Extract<Event, { type: "spawn" }>).id;
      const drvExit = idxOf(log, (e) => e.type === "exit" && e.id === drvId);
      const stopIdx = idxOf(
        log,
        (e) =>
          (e.type === "signal" && e.id === rec.id) ||
          (e.type === "spawn" && e.argv.includes("screenrecord") && e.argv.some((a) => STOP_WORDS.includes(a))),
      );
      const pullIdx = idxOf(log, (e) => e.type === "spawn" && toolIs(e.argv, "adb") && e.argv[1] === "pull");
      expect(pullIdx).toBeGreaterThanOrEqual(0);
      expect((log[pullIdx] as Extract<Event, { type: "spawn" }>).argv.slice(1)).toEqual(["pull", devicePath, clip]);

      expect(recIdx).toBeLessThan(drvIdx);
      expect(drvExit).toBeLessThan(stopIdx);
      expect(stopIdx).toBeLessThan(pullIdx);
      expect(existsSync(clip)).toBe(true);
    },
    SLOW,
  );
});

describe("AC-STE-668.3 the driver gets the command recorder's env and its markers land", () => {
  for (const kind of ["ios-sim", "android-emu"] as const) {
    test(
      `${kind}: the four RECORDER_ENV variables carry the shot's values; markers reach the file`,
      async () => {
        const root = project();
        const written = [
          { name: "open", t: 0.25 },
          { name: "result", t: 1.5 },
        ];
        const f = fakeDevices({ driverMarkers: written });
        const id = `${kind}-env`;
        await recordShot({
          projectRoot: root,
          slug: SLUG,
          shot: shot(id),
          config: kind === "ios-sim" ? { kind, device: "booted" } : { kind },
          spawner: f.spawner,
          runner: f.runner,
          which: whichWith(),
        } as never);

        const { clip, markers } = shotOutputs(videoWorkDir(root, SLUG), id);
        const drv = spawns(f.log).find((e) => e.argv[0] === DRIVER[0]);
        expect(drv).toBeTruthy();
        expect(drv!.cwd).toBe(root);
        expect(drv!.env[RECORDER_ENV.shot]).toBe(id);
        expect(drv!.env[RECORDER_ENV.scenario]).toBe(`scenario-of-${id}`);
        expect(drv!.env[RECORDER_ENV.outClip]).toBe(clip);
        expect(drv!.env[RECORDER_ENV.outMarkers]).toBe(markers);
        expect(JSON.parse(readFileSync(markers, "utf8"))).toEqual(written);
      },
      SLOW,
    );
  }

  test("neither device recorder spells its own DPT_VIDEO_ variable names or .dpt/ paths", () => {
    for (const file of ["recorder_ios.ts", "recorder_android.ts"]) {
      const src = readFileSync(join(VIDEO_SRC, file), "utf8");
      expect(src).toContain("RECORDER_ENV");
      expect(src).not.toMatch(/DPT_VIDEO_/);
      expect(src).not.toMatch(/\.dpt\//);
    }
  });
});

describe("AC-STE-668.4 preflight refuses before any recording starts", () => {
  test("xcrun absent from PATH → refusal naming xcrun; nothing spawned", async () => {
    const f = fakeDevices();
    const msg = await refusal(
      recordIosSim({
        projectRoot: project(), slug: SLUG, shot: shot("no-xcrun"), device: "booted",
        spawner: f.spawner, runner: f.runner, which: whichWith(["xcrun"]),
      } as never),
    );
    expect(msg).toMatch(/^Refusing:/);
    expect(msg).toContain("xcrun");
    expect(msg).toMatch(/PATH/);
    expect(spawns(f.log)).toEqual([]);
  });

  test("adb absent from PATH → refusal naming adb; nothing spawned", async () => {
    const f = fakeDevices();
    const msg = await refusal(
      recordAndroidEmu({
        projectRoot: project(), slug: SLUG, shot: shot("no-adb"),
        spawner: f.spawner, runner: f.runner, which: whichWith(["adb"]),
      } as never),
    );
    expect(msg).toMatch(/^Refusing:/);
    expect(msg).toContain("adb");
    expect(msg).toMatch(/PATH/);
    expect(spawns(f.log)).toEqual([]);
  });

  test("simctl listing with no booted simulator → refusal naming the device check; no recordVideo, no driver", async () => {
    const f = fakeDevices({ simctlList: fixture("simctl-list-none-booted.txt") });
    const msg = await refusal(
      recordIosSim({
        projectRoot: project(), slug: SLUG, shot: shot("no-sim"), device: "booted",
        spawner: f.spawner, runner: f.runner, which: whichWith(),
      } as never),
    );
    expect(msg).toMatch(/^Refusing:/);
    expect(msg).toContain("simctl list devices");
    expect(msg).toMatch(/booted/i);
    expect(spawns(f.log).some((e) => e.argv.includes("recordVideo"))).toBe(false);
    expect(spawns(f.log).some((e) => e.argv[0] === DRIVER[0])).toBe(false);
    // The listing itself was consulted (the refusal comes from the device check, not a guess).
    expect(spawns(f.log).some((e) => e.argv.includes("simctl") && e.argv.includes("list"))).toBe(true);
  });

  test("adb devices listing with no device → refusal naming the device check; no screenrecord, no driver", async () => {
    const f = fakeDevices({ adbDevices: fixture("adb-devices-none.txt") });
    const msg = await refusal(
      recordAndroidEmu({
        projectRoot: project(), slug: SLUG, shot: shot("no-emu"),
        spawner: f.spawner, runner: f.runner, which: whichWith(),
      } as never),
    );
    expect(msg).toMatch(/^Refusing:/);
    expect(msg).toContain("adb devices");
    expect(spawns(f.log).some((e) => e.argv.includes("screenrecord"))).toBe(false);
    expect(spawns(f.log).some((e) => e.argv[0] === DRIVER[0])).toBe(false);
    expect(spawns(f.log).some((e) => e.argv[e.argv.length - 1] === "devices")).toBe(true);
  });
});

describe("AC-STE-668.5 android screenrecord's 180-second limit", () => {
  test("durationHint 181 refuses before recording, naming the 180-second screenrecord limit", async () => {
    const f = fakeDevices();
    const msg = await refusal(
      recordAndroidEmu({
        projectRoot: project(), slug: SLUG, shot: shot("too-long", { durationHint: 181 }),
        spawner: f.spawner, runner: f.runner, which: whichWith(),
      } as never),
    );
    expect(msg).toMatch(/^Refusing:/);
    expect(msg).toContain("too-long");
    expect(msg).toContain("180");
    expect(msg).toContain("screenrecord");
    expect(spawns(f.log).some((e) => e.argv.includes("screenrecord"))).toBe(false);
    expect(spawns(f.log).some((e) => e.argv[0] === DRIVER[0])).toBe(false);
  });

  test(
    "durationHint exactly 180 records",
    async () => {
      const root = project();
      const f = fakeDevices();
      const out = await recordAndroidEmu({
        projectRoot: root, slug: SLUG, shot: shot("at-limit", { durationHint: 180 }),
        spawner: f.spawner, runner: f.runner, which: whichWith(),
      } as never);
      expect(out.clip).toBe(shotOutputs(videoWorkDir(root, SLUG), "at-limit").clip);
      expect(spawns(f.log).some((e) => e.argv.includes("screenrecord"))).toBe(true);
    },
    SLOW,
  );
});

describe("AC-STE-668.6 a failing driver still stops the recording, then refuses", () => {
  const stderrLines = Array.from({ length: 30 }, (_, i) => `driver-err-line-${String(i + 1).padStart(2, "0")}`);
  const driverStderr = `${stderrLines.join("\n")}\n`;

  test(
    "ios-sim: SIGINT is still sent; refusal names the shot and quotes the last 20 stderr lines",
    async () => {
      const f = fakeDevices({ driverCode: 3, driverStderr });
      const msg = await refusal(
        recordIosSim({
          projectRoot: project(), slug: SLUG, shot: shot("ios-broken"), device: "booted",
          spawner: f.spawner, runner: f.runner, which: whichWith(),
        } as never),
      );
      const rec = spawns(f.log).find((e) => e.argv.includes("recordVideo"))!;
      const drv = spawns(f.log).find((e) => e.argv[0] === DRIVER[0])!;
      const drvExit = idxOf(f.log, (e) => e.type === "exit" && e.id === drv.id);
      const sig = idxOf(f.log, (e) => e.type === "signal" && e.id === rec.id && e.signal === "SIGINT");
      expect(sig).toBeGreaterThan(drvExit);
      expect(f.log.some((e) => e.type === "exit" && e.id === rec.id)).toBe(true);

      expect(msg).toMatch(/^Refusing:/);
      expect(msg).toContain("ios-broken");
      expect(msg).toContain("driver-err-line-30");
      expect(msg).toContain("driver-err-line-11");
      expect(msg).not.toContain("driver-err-line-10");
    },
    SLOW,
  );

  test(
    "android-emu: the screenrecord is still stopped; refusal names the shot and quotes the stderr tail",
    async () => {
      const f = fakeDevices({ driverCode: 1, driverStderr });
      const msg = await refusal(
        recordAndroidEmu({
          projectRoot: project(), slug: SLUG, shot: shot("droid-broken"),
          spawner: f.spawner, runner: f.runner, which: whichWith(),
        } as never),
      );
      const rec = spawns(f.log).find((e) => e.argv.includes("screenrecord") && !e.argv.some((a) => STOP_WORDS.includes(a)))!;
      const drv = spawns(f.log).find((e) => e.argv[0] === DRIVER[0])!;
      const drvExit = idxOf(f.log, (e) => e.type === "exit" && e.id === drv.id);
      const stop = idxOf(
        f.log,
        (e) =>
          (e.type === "signal" && e.id === rec.id) ||
          (e.type === "spawn" && e.argv.includes("screenrecord") && e.argv.some((a) => STOP_WORDS.includes(a))),
      );
      expect(stop).toBeGreaterThan(drvExit);
      expect(f.log.some((e) => e.type === "exit" && e.id === rec.id)).toBe(true);

      expect(msg).toMatch(/^Refusing:/);
      expect(msg).toContain("droid-broken");
      expect(msg).toContain("driver-err-line-30");
      expect(msg).toContain("driver-err-line-11");
      expect(msg).not.toContain("driver-err-line-10");
    },
    SLOW,
  );
});

// ---------------------------------------------------------------------------
// HARDEN-G — android-emu: the wait for screenrecord to exit after the stop is bounded
// ---------------------------------------------------------------------------

describe("HARDEN-G android-emu stop wait is bounded by a timeout", () => {
  test(
    "HARDEN-G a screenrecord that never exits after pkill → refusal naming the shot and the stop timeout; the recorder is killed",
    async () => {
      const f = fakeDevices();
      // Wrap the fake spawner: the screenrecord recorder ignores the pkill and never exits on its own;
      // only kill() ends it.
      const signals: { id: number; signal: string }[] = [];
      let recorderId = -1;
      const spawner = ((argv: string[], opts: { cwd: string; env: Record<string, string | undefined> }) => {
        const isRecorder =
          basename(argv[0] ?? "") === "adb" && argv.includes("screenrecord") && !argv.some((a) => STOP_WORDS.includes(a));
        if (!isRecorder) return (f.spawner as any)(argv, opts);
        recorderId = 1000;
        f.log.push({ type: "spawn", id: recorderId, argv: [...argv], cwd: opts.cwd, env: { ...opts.env } });
        let resolveExit!: (code: number) => void;
        const exited = new Promise<number>((r) => (resolveExit = r));
        return {
          exited,
          stdout: exited.then(() => ""),
          stderr: exited.then(() => ""),
          kill(signal: string = "SIGTERM") {
            signals.push({ id: recorderId, signal });
            f.log.push({ type: "signal", id: recorderId, signal });
            resolveExit(137);
          },
        };
      }) as never;

      const HANG = Symbol("hang");
      const outcome = await Promise.race([
        refusal(
          recordAndroidEmu({
            projectRoot: project(),
            slug: SLUG,
            shot: shot("droid-stuck"),
            spawner,
            runner: f.runner,
            which: whichWith(),
            stopTimeoutMs: 200,
          } as never),
        ),
        new Promise<typeof HANG>((r) => setTimeout(() => r(HANG), 5_000)),
      ]);
      expect(outcome, "recordAndroidEmu hung waiting for screenrecord to exit").not.toBe(HANG);
      const msg = outcome as string;
      expect(msg).toMatch(/^Refusing:/);
      expect(msg).toContain("droid-stuck");
      expect(msg).toMatch(/time(?:d)?[ -]?out/i);
      expect(msg).toMatch(/stop|screenrecord/i);
      // The stuck recorder process is killed.
      expect(signals.length).toBeGreaterThan(0);
      // No pull of a file the recorder never finalised.
      expect(spawns(f.log).some((e) => toolIs(e.argv, "adb") && e.argv[1] === "pull")).toBe(false);
    },
    SLOW,
  );
});

// ===========================================================================
// FIX-4 — STE-668 Requirement "the driver … MAY write markers": a driver that
// writes none yields a valid recording with markers [] (no refusal).
// ===========================================================================

describe("FIX-4 a driver that writes no markers still yields a valid recording with markers []", () => {
  for (const kind of ["ios-sim", "android-emu"] as const) {
    test(
      `FIX-4 ${kind}: no markers written by the driver → recording resolves, markers file reads []`,
      async () => {
        const root = project();
        const f = fakeDevices({ driverWritesMarkers: false });
        const id = `${kind}-nomarkers`;
        const out = await recordShot({
          projectRoot: root,
          slug: SLUG,
          shot: shot(id),
          config: kind === "ios-sim" ? { kind, device: "booted" } : { kind },
          spawner: f.spawner,
          runner: f.runner,
          which: whichWith(),
        } as never);
        const { clip, markers } = shotOutputs(videoWorkDir(root, SLUG), id);
        // Control: the driver really ran, with the markers path in its env, and wrote nothing.
        const drv = spawns(f.log).find((e) => e.argv[0] === DRIVER[0]);
        expect(drv?.env[RECORDER_ENV.outMarkers]).toBe(markers);
        expect(out).toMatchObject({ kind, clip, markers });
        expect(existsSync(clip)).toBe(true);
        expect(JSON.parse(readFileSync(markers, "utf8"))).toEqual([]);
      },
      SLOW,
    );
  }
});
