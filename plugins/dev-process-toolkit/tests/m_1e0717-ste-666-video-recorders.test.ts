// M_1e0717 STE-666 — recorder contract with footage and command recorders.
//
// AC coverage:
//   AC-STE-666.1 — `validateRecording` accepts a fixture clip with markers; refuses, naming
//                  the shot, a missing clip, a clip with no video stream, decreasing markers,
//                  and a marker past the clip's duration.
//   AC-STE-666.2 — the footage recorder transcodes the mapped file to `clips/<id>.mp4` and
//                  writes its markers; no mapping / mapping to a missing file refuses naming
//                  the shot and the path.
//   AC-STE-666.3 — the command recorder runs the configured argv with cwd = project root and
//                  the four env vars set to the shot's values (fixture echoes them into its
//                  markers file).
//   AC-STE-666.4 — non-zero exit, or exit 0 without a valid recording, refuses naming the shot
//                  and quoting the last 20 lines of stderr.
//   AC-STE-666.5 — a shot declaring `recorder: footage` in a `command` project is recorded by
//                  the footage recorder; the others by the command recorder.
//   AC-STE-666.6 — docs/video-recorders.md names every env var (read from the one exported
//                  constant) and both output files.
//
// Module contract this suite drives (adapters/_shared/src/):
//   dpt_paths.ts
//     export function videoFootageDir(projectRoot: string): string   // <root>/.dpt/video/footage
//   video/recorder.ts
//     export interface Marker { name: string; t: number }
//     export interface Shot { id: string; scenario: string; durationHint: number; recorder?: RecorderKind }
//     export const RECORDER_ENV = {
//       shot: "DPT_VIDEO_SHOT", scenario: "DPT_VIDEO_SCENARIO",
//       outClip: "DPT_VIDEO_OUT_CLIP", outMarkers: "DPT_VIDEO_OUT_MARKERS" } as const
//       — the ONE variable list; STE-668's driver reuses it.
//     export async function validateRecording(opts: { workDir: string; shot: Shot;
//       runner?: Runner; which?: Which }): Promise<{ duration: number; markers: Marker[] }>
//       — reads workDir/clips/<id>.mp4 (ffprobe: needs a video stream) and
//         workDir/markers/<id>.json (non-decreasing `t`, every t <= duration);
//         throws a refusal whose message names the shot id.
//     export type FootageMapping = Record<string, { file: string; markers?: Marker[] }>
//       — `file` is relative to videoFootageDir(projectRoot).
//     export async function recordShot(opts: { projectRoot: string; slug: string; shot: Shot;
//       config: VideoRecorderConfig; footage?: FootageMapping; runner?: Runner; which?: Which }):
//       Promise<{ kind: RecorderKind; clip: string; markers: string }>
//       — dispatcher: shot.recorder overrides config.kind.
//   video/recorder_footage.ts
//     export async function recordFootage(opts: { projectRoot: string; slug: string; shot: Shot;
//       mapping: FootageMapping; runner?: Runner; which?: Which }):
//       Promise<{ clip: string; markers: string }>
//   video/recorder_command.ts
//     export async function recordCommand(opts: { projectRoot: string; slug: string; shot: Shot;
//       command: string[]; runner?: Runner; which?: Which }): Promise<{ clip: string; markers: string }>
//       — work dir is videoWorkDir(projectRoot, slug); outputs clips/<id>.mp4 + markers/<id>.json.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { videoFootageDir, videoWorkDir } from "../adapters/_shared/src/dpt_paths";
import { RECORDER_ENV, recordShot, validateRecording } from "../adapters/_shared/src/video/recorder";
import { recordCommand } from "../adapters/_shared/src/video/recorder_command";
import { recordFootage } from "../adapters/_shared/src/video/recorder_footage";

const PLUGIN_ROOT = resolve(import.meta.dir, "..");
const FIXTURES = join(import.meta.dir, "fixtures", "video-recorders");
const DOC = join(PLUGIN_ROOT, "docs", "video-recorders.md");
const SLOW = 60_000;

const temps: string[] = [];
function tempDir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  temps.push(d);
  return d;
}

afterAll(() => {
  for (const d of temps) {
    spawnSync("rm", ["-rf", d]);
    if (existsSync(d)) throw new Error(`temp dir not removed: ${d}`);
  }
});

function ffmpeg(args: string[]): void {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`fixture ffmpeg failed: ${r.stderr}`);
}

function probe(path: string): { streams: { codec_type: string; codec_name: string }[]; format: { duration: string; format_name: string } } {
  const r = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration,format_name:stream=codec_type,codec_name", "-of", "json", path],
    { encoding: "utf8" },
  );
  if (r.status !== 0) throw new Error(`ffprobe failed: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

async function refusal(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error("expected a refusal, but the call resolved");
}

const shot = (id: string, extra: Record<string, unknown> = {}) =>
  ({ id, scenario: `scenario-of-${id}`, durationHint: 2, ...extra }) as never;

// Fixture media, generated once outside the repo.
let media: string;
let goodMp4: string; // 2s h264 video
let audioOnly: string; // 1s aac, no video stream
let footageMkv: string; // 2s mpeg4-in-matroska (needs transcoding to mp4)

beforeAll(() => {
  media = tempDir("ste666-media-");
  goodMp4 = join(media, "good.mp4");
  audioOnly = join(media, "audio.m4a");
  footageMkv = join(media, "footage.mkv");
  ffmpeg(["-f", "lavfi", "-i", "testsrc=duration=2:size=160x120:rate=10", "-pix_fmt", "yuv420p", "-c:v", "libx264", goodMp4]);
  ffmpeg(["-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:a", "aac", audioOnly]);
  ffmpeg(["-f", "lavfi", "-i", "testsrc=duration=2:size=160x120:rate=10", "-c:v", "mpeg4", footageMkv]);
});

/** A work dir holding clips/<id>.mp4 (copied from `clip`, unless null) and markers/<id>.json. */
function stageRecording(id: string, clip: string | null, markers: unknown): string {
  const workDir = tempDir("ste666-work-");
  mkdirSync(join(workDir, "clips"), { recursive: true });
  mkdirSync(join(workDir, "markers"), { recursive: true });
  if (clip) copyFileSync(clip, join(workDir, "clips", `${id}.mp4`));
  writeFileSync(join(workDir, "markers", `${id}.json`), JSON.stringify(markers));
  return workDir;
}

describe("AC-STE-666.1 validateRecording", () => {
  test(
    "accepts a fixture clip with markers and reports its duration and markers",
    async () => {
      const markers = [
        { name: "open", t: 0.2 },
        { name: "open-again", t: 0.2 },
        { name: "click", t: 1.5 },
      ];
      const workDir = stageRecording("hero", goodMp4, markers);
      const res = await validateRecording({ workDir, shot: shot("hero") });
      expect(res.duration).toBeGreaterThan(1.9);
      expect(res.duration).toBeLessThan(2.1);
      expect(res.markers).toEqual(markers);
    },
    SLOW,
  );

  test(
    "refuses a missing clip, naming the shot",
    async () => {
      const workDir = stageRecording("ghost-shot", null, []);
      const msg = await refusal(validateRecording({ workDir, shot: shot("ghost-shot") }));
      expect(msg).toContain("ghost-shot");
      expect(msg).toMatch(/Refusing/);
    },
    SLOW,
  );

  test(
    "refuses a clip with no video stream, naming the shot",
    async () => {
      const workDir = stageRecording("silent-shot", audioOnly, []);
      const msg = await refusal(validateRecording({ workDir, shot: shot("silent-shot") }));
      expect(msg).toContain("silent-shot");
      expect(msg).toMatch(/video stream/i);
    },
    SLOW,
  );

  test(
    "refuses decreasing markers, naming the shot",
    async () => {
      const workDir = stageRecording("backwards-shot", goodMp4, [
        { name: "late", t: 1.5 },
        { name: "early", t: 0.5 },
      ]);
      const msg = await refusal(validateRecording({ workDir, shot: shot("backwards-shot") }));
      expect(msg).toContain("backwards-shot");
      expect(msg).toContain("early");
    },
    SLOW,
  );

  test(
    "refuses a marker past the clip's duration, naming the shot",
    async () => {
      const workDir = stageRecording("overrun-shot", goodMp4, [
        { name: "fine", t: 1 },
        { name: "too-late", t: 9 },
      ]);
      const msg = await refusal(validateRecording({ workDir, shot: shot("overrun-shot") }));
      expect(msg).toContain("overrun-shot");
      expect(msg).toContain("too-late");
    },
    SLOW,
  );
});

function footageProject(): string {
  const projectRoot = tempDir("ste666-proj-");
  mkdirSync(videoFootageDir(projectRoot), { recursive: true });
  copyFileSync(footageMkv, join(videoFootageDir(projectRoot), "intro.mkv"));
  return projectRoot;
}

describe("AC-STE-666.2 footage recorder", () => {
  test(
    "transcodes the mapped file to clips/<id>.mp4 and writes its markers",
    async () => {
      const projectRoot = footageProject();
      const markers = [{ name: "tap", t: 0.75 }];
      const res = await recordFootage({
        projectRoot,
        slug: "demo",
        shot: shot("intro"),
        mapping: { intro: { file: "intro.mkv", markers } },
      });
      const work = videoWorkDir(projectRoot, "demo");
      expect(res.clip).toBe(join(work, "clips", "intro.mp4"));
      expect(res.markers).toBe(join(work, "markers", "intro.json"));
      const info = probe(res.clip);
      expect(info.format.format_name).toContain("mp4");
      expect(info.streams.some((s) => s.codec_type === "video")).toBe(true);
      expect(JSON.parse(readFileSync(res.markers, "utf8"))).toEqual(markers);
    },
    SLOW,
  );

  test(
    "markers default to empty when the mapping names none",
    async () => {
      const projectRoot = footageProject();
      const res = await recordFootage({
        projectRoot,
        slug: "demo",
        shot: shot("intro"),
        mapping: { intro: { file: "intro.mkv" } },
      });
      expect(JSON.parse(readFileSync(res.markers, "utf8"))).toEqual([]);
    },
    SLOW,
  );

  test(
    "a shot with no mapping refuses naming the shot and the footage path",
    async () => {
      const projectRoot = footageProject();
      const msg = await refusal(
        recordFootage({ projectRoot, slug: "demo", shot: shot("unmapped-shot"), mapping: { intro: { file: "intro.mkv" } } }),
      );
      expect(msg).toContain("unmapped-shot");
      expect(msg).toContain(videoFootageDir("."));
      expect(existsSync(join(videoWorkDir(projectRoot, "demo"), "clips", "unmapped-shot.mp4"))).toBe(false);
    },
    SLOW,
  );

  test(
    "a mapping to a missing file refuses naming the shot and the path",
    async () => {
      const projectRoot = footageProject();
      const msg = await refusal(
        recordFootage({ projectRoot, slug: "demo", shot: shot("lost-shot"), mapping: { "lost-shot": { file: "nowhere.mov" } } }),
      );
      expect(msg).toContain("lost-shot");
      expect(msg).toContain("nowhere.mov");
    },
    SLOW,
  );
});

describe("AC-STE-666.3 command recorder environment and cwd", () => {
  test(
    "runs the argv from the project root with the four variables set to the shot's values",
    async () => {
      const projectRoot = tempDir("ste666-cmd-");
      const s = shot("checkout", { scenario: "pay-with-card" });
      const res = await recordCommand({
        projectRoot,
        slug: "launch",
        shot: s,
        command: ["bash", join(FIXTURES, "echo-env.sh")],
      });
      const work = videoWorkDir(projectRoot, "launch");
      const clip = join(work, "clips", "checkout.mp4");
      const markersPath = join(work, "markers", "checkout.json");
      expect(res.clip).toBe(clip);
      expect(res.markers).toBe(markersPath);
      expect(existsSync(clip)).toBe(true);
      const names = (JSON.parse(readFileSync(markersPath, "utf8")) as { name: string }[]).map((m) => m.name);
      expect(names).toEqual([
        "shot=checkout",
        "scenario=pay-with-card",
        `clip=${clip}`,
        `markers=${markersPath}`,
        `cwd=${realpathSync(projectRoot)}`,
      ]);
    },
    SLOW,
  );
});

describe("AC-STE-666.4 command recorder refusals", () => {
  const lastTwenty = Array.from({ length: 20 }, (_, i) => `stderr-line-${String(i + 11).padStart(2, "0")}`);
  const older = Array.from({ length: 10 }, (_, i) => `stderr-line-${String(i + 1).padStart(2, "0")}`);

  test(
    "a non-zero exit refuses naming the shot and quoting the last 20 stderr lines",
    async () => {
      const projectRoot = tempDir("ste666-cmd-");
      const msg = await refusal(
        recordCommand({ projectRoot, slug: "launch", shot: shot("crashy-shot"), command: ["bash", join(FIXTURES, "fail-loud.sh")] }),
      );
      expect(msg).toContain("crashy-shot");
      for (const line of lastTwenty) expect(msg).toContain(line);
      for (const line of older) expect(msg).not.toContain(line);
    },
    SLOW,
  );

  test(
    "a zero exit without a valid recording refuses naming the shot and quoting the last 20 stderr lines",
    async () => {
      const projectRoot = tempDir("ste666-cmd-");
      const msg = await refusal(
        recordCommand({ projectRoot, slug: "launch", shot: shot("hollow-shot"), command: ["bash", join(FIXTURES, "zero-no-clip.sh")] }),
      );
      expect(msg).toContain("hollow-shot");
      for (const line of lastTwenty) expect(msg).toContain(line);
      for (const line of older) expect(msg).not.toContain(line);
    },
    SLOW,
  );

  test(
    "a zero exit without a recording refuses even when an earlier run left a valid clip and markers for the shot",
    async () => {
      const projectRoot = tempDir("ste666-cmd-");
      const work = videoWorkDir(projectRoot, "launch");
      mkdirSync(join(work, "clips"), { recursive: true });
      mkdirSync(join(work, "markers"), { recursive: true });
      const staleClip = join(work, "clips", "stale-shot.mp4");
      const staleMarkers = join(work, "markers", "stale-shot.json");
      copyFileSync(goodMp4, staleClip);
      writeFileSync(staleMarkers, JSON.stringify([{ name: "earlier-run", t: 0.5 }]));
      // Control: the stale pair is itself a valid recording, so only freshness can refuse it.
      await validateRecording({ workDir: work, shot: shot("stale-shot") });
      const msg = await refusal(
        recordCommand({ projectRoot, slug: "launch", shot: shot("stale-shot"), command: ["bash", join(FIXTURES, "zero-no-clip.sh")] }),
      );
      expect(msg).toContain("stale-shot");
      for (const line of lastTwenty) expect(msg).toContain(line);
      for (const line of older) expect(msg).not.toContain(line);
    },
    SLOW,
  );
});

describe("AC-STE-666.5 per-shot recorder override", () => {
  test(
    "a `recorder: footage` shot in a `command` project goes to footage; the others to the command",
    async () => {
      const projectRoot = footageProject();
      const config = { kind: "command", command: ["bash", join(FIXTURES, "echo-env.sh")] } as const;
      const footage = { intro: { file: "intro.mkv", markers: [{ name: "from-footage", t: 0.3 }] } };

      const a = await recordShot({ projectRoot, slug: "mix", shot: shot("intro", { recorder: "footage" }), config, footage });
      const b = await recordShot({ projectRoot, slug: "mix", shot: shot("main-flow"), config, footage });

      expect(a.kind).toBe("footage");
      expect(b.kind).toBe("command");
      expect(JSON.parse(readFileSync(a.markers, "utf8"))).toEqual([{ name: "from-footage", t: 0.3 }]);
      const bNames = (JSON.parse(readFileSync(b.markers, "utf8")) as { name: string }[]).map((m) => m.name);
      expect(bNames[0]).toBe("shot=main-flow");
      expect(a.clip).toBe(join(videoWorkDir(projectRoot, "mix"), "clips", "intro.mp4"));
      expect(b.clip).toBe(join(videoWorkDir(projectRoot, "mix"), "clips", "main-flow.mp4"));
    },
    SLOW,
  );
});

describe("AC-STE-666.6 docs/video-recorders.md", () => {
  test("RECORDER_ENV is the one list of the four recorder variables", () => {
    expect(Object.values(RECORDER_ENV).sort()).toEqual(
      ["DPT_VIDEO_OUT_CLIP", "DPT_VIDEO_OUT_MARKERS", "DPT_VIDEO_SCENARIO", "DPT_VIDEO_SHOT"],
    );
  });

  test("the doc names every variable in RECORDER_ENV and both output files", () => {
    expect(existsSync(DOC)).toBe(true);
    const doc = readFileSync(DOC, "utf8");
    const vars = Object.values(RECORDER_ENV);
    expect(vars.length).toBe(4);
    for (const v of vars) expect(doc).toContain(v);
    expect(doc).toContain("clips/<id>.mp4");
    expect(doc).toContain("markers/<id>.json");
  });
});
