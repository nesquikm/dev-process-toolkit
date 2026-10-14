// STE-674 — renders follow new footage, stay in sync and hit a loudness target.
//
//   AC-STE-674.1 — the render stage's cache inputs carry a SHA-256 of the bytes of every clip `src`, every
//                  voice segment audio file and the music file the EDL references; the render stage version
//                  is bumped. Rewritten bytes under an unchanged `edl.json` re-run render; identical bytes
//                  skip it — for a clip, for the music file and for one voice segment.
//   AC-STE-674.2 — mutation: dropping the clip bytes from the render inputs turns the clip assertion red
//                  (temp overlay; the working tree is never touched; an unmutated control passes).
//   AC-STE-674.3 — real ffmpeg: a variable-frame-rate clip placed first in a three-clip EDL; ffprobe measures
//                  when clips 2 and 3 first appear. (The plan records the unfixed measurement.)
//   AC-STE-674.4 — the same test asserts each clip's first frame lands within 1/30 s of its placed time and
//                  the final duration equals the EDL end within 1/30 s.
//   AC-STE-674.5 — style: `loudness.target_lufs` ∈ [−30, −5], default −16; non-number / out of range refuse
//                  naming `loudness.target_lufs`; an unknown `loudness.*` key refuses naming its path;
//                  `video_init` writes the key with its default.
//   AC-STE-674.6 — `buildFfmpegArgs` applies ONE `loudnorm` with `I=<target>` after `amix` (voice + music),
//                  and to the voice alone with no music; the per-input music `volume=` gain stays put.
//                  Snapshot fixtures (tests/fixtures/video-render-674/*.args.json) pin both graphs.
//   AC-STE-674.7 — QA measures integrated loudness and adds a reason when it is > 1 LU from the target; a
//                  real lavfi render passes, a fixture rendered without normalisation fails.
//   AC-STE-674.8 — gate-level (full `bun test`: 0 failures, skip identities equal trunk by name); no
//                  dedicated test here.
//
// Seams pinned here (documented for the implementer):
//
//   adapters/_shared/src/video/pipeline.ts
//     export function renderStageInputs(
//       workDir: string, edl: Edl, style: VideoStyle, ttsKeys: Record<string, string>,
//     ): Record<string, unknown>
//       — the render stage's named key inputs; `runVideoPipeline` passes its result as the render stage's
//         `inputs`. Besides the existing `edl`, `style`, `tts` it carries:
//           clip_bytes:  Record<clip src, sha256 hex of that file's bytes>
//           voice_bytes: Record<voice audio, sha256 hex of that file's bytes>
//           music_bytes: sha256 hex of the music file's bytes (absent / null with no music)
//         Paths resolve against `workDir` (the render's cwd). Declared exactly as
//         `export function renderStageInputs(` — the AC-STE-674.2 mutation wraps that declaration.
//     const RENDER_STAGE_VERSION — bumped above 1.
//
//   adapters/_shared/src/video/style.ts
//     VideoStyle.loudness: { target_lufs: number }; VIDEO_STYLE_DEFAULTS.loudness.target_lufs === -16.
//
//   adapters/_shared/src/video/qa.ts
//     qaRender(opts: { ...; targetLufs?: number }) — default VIDEO_STYLE_DEFAULTS.loudness.target_lufs. A
//       loudness reason contains the word "loudness", the measured integrated value and the target.
//
// Real-ffmpeg tests need ffmpeg + ffprobe (the gate machine has both). They never use drawtext: captions
// are off and no fixture EDL carries captions. Like the STE-665 renders, they need ffmpeg and ffprobe on PATH; a precondition test fails loudly when either is missing.

import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { videoStylePath, videoWorkDir } from "../adapters/_shared/src/dpt_paths";
import { VIDEO_STYLE_DEFAULTS, type VideoStyle } from "../adapters/_shared/src/video/style";
import { mutateInRegion } from "./_sited-mutation";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const SRC = join(PLUGIN_ROOT, "adapters", "_shared", "src");
const VIDEO_DIR = join(SRC, "video");
const FIXTURES = join(import.meta.dir, "fixtures", "video-render-674");
const THIS_FILE_REL = "tests/m_866092-ste-674-render-cache-sync-loudness.test.ts";

const MOD = {
  edl: join(VIDEO_DIR, "edl.ts"),
  anchors: join(VIDEO_DIR, "anchors.ts"),
  args: join(VIDEO_DIR, "ffmpeg_args.ts"),
  render: join(VIDEO_DIR, "render.ts"),
  qa: join(VIDEO_DIR, "qa.ts"),
  cache: join(VIDEO_DIR, "stage_cache.ts"),
  pipeline: join(VIDEO_DIR, "pipeline.ts"),
  style: join(VIDEO_DIR, "style.ts"),
  init: join(SRC, "video_init.ts"),
};

// Dynamic imports: a missing export reds the test that needs it, not the whole file.
const load = async (path: string): Promise<any> => await import(path);

const hasFfmpeg = Bun.which("ffmpeg") !== null && Bun.which("ffprobe") !== null;

test("precondition: ffmpeg and ffprobe are on PATH for the real renders below", () => {
  expect(hasFfmpeg).toBe(true);
});

const sha256 = (bytes: string | Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const tmpRoots: string[] = [];

function makeTmpRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  tmpRoots.push(root);
  return root;
}

afterAll(() => {
  for (const root of tmpRoots) {
    rmSync(root, { recursive: true, force: true });
    if (existsSync(root)) Bun.spawnSync(["rm", "-rf", root]);
  }
});

function writeFile(path: string, body: string | Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
}

/** Default style with captions OFF (no drawtext anywhere in this suite), plus overrides. */
function style(overrides: Record<string, unknown> = {}): VideoStyle {
  const base = structuredClone(VIDEO_STYLE_DEFAULTS) as unknown as Record<string, unknown>;
  base.captions = { enabled: false, position: "bottom" };
  return { ...base, ...overrides } as unknown as VideoStyle;
}

interface RunnerCall {
  argv: string[];
  cwd: string;
}

/** A fake runner: records every call; an ffmpeg call writes its last argument under cwd. */
function fakeRunner(): { runner: (argv: string[], opts: { cwd: string }) => Promise<any>; calls: RunnerCall[] } {
  const calls: RunnerCall[] = [];
  const runner = async (argv: string[], opts: { cwd: string }) => {
    calls.push({ argv: [...argv], cwd: opts.cwd });
    if (basename(argv[0] ?? "") === "ffmpeg" && !argv.includes("-filters")) {
      writeFile(join(opts.cwd, argv[argv.length - 1]!), `fake render ${calls.length}`);
    }
    return { code: 0, stdout: "", stderr: "" };
  };
  return { runner, calls };
}

const ffmpegRenders = (calls: RunnerCall[]): RunnerCall[] =>
  calls.filter((c) => basename(c.argv[0] ?? "") === "ffmpeg" && !c.argv.includes("-filters"));

const whichAll = (bin: string): string | null => `/usr/local/bin/${bin}`;

/** Expect `fn` to throw; return the error message. */
function refusal(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  throw new Error("expected a refusal, but the call returned");
}

// ===========================================================================
// AC-STE-674.1 — the render key follows the bytes of clips, voice audio and music
// ===========================================================================

const SEGMENTS = [
  { index: 1, text: "Re-recording a clip re-renders the cut." },
  { index: 2, text: "Identical bytes keep the cached cut." },
];
const VOICE = { provider: "elevenlabs", voice: "voice-a", model: "eleven_multilingual_v2" };
const CLIP = "clips/intro.mp4";
const MUSIC = "music/track.mp3";
const SEGMENT_2_AUDIO = "segments/2.mp3";

function cacheEdlText(): string {
  return JSON.stringify({
    edl_version: 1,
    clips: [{ src: CLIP, in: 0, out: 4 }],
    voice: [
      { segment: 1, audio: "segments/1.mp3", offset: 0 },
      { segment: 2, audio: SEGMENT_2_AUDIO, offset: 2 },
    ],
    music: { src: MUSIC, level_db: -18 },
  });
}

/** A fake TTS provider: writes deterministic audio + alignment under the work dir. */
function fakeTts(projectRoot: string, slug: string): { tts: any; calls: number[] } {
  const calls: number[] = [];
  const tts = {
    async synthesize(segment: { index: number; text: string }) {
      calls.push(segment.index);
      const dir = videoWorkDir(projectRoot, slug);
      const audioPath = join(dir, "segments", `${segment.index}.mp3`);
      writeFile(audioPath, `audio:${segment.text}`);
      const alignment = segment.text.split(" ").map((word, i) => ({ word, start: i * 0.3, end: i * 0.3 + 0.2 }));
      writeFile(join(dir, "alignment", `${segment.index}.json`), JSON.stringify(alignment));
      return { audioPath, alignment };
    },
  };
  return { tts, calls };
}

interface CacheHarness {
  workDir: string;
  run: () => Promise<{ stages: Record<string, string>; ttsCalls: number[]; renders: number }>;
}

async function cacheHarness(prefix: string): Promise<CacheHarness> {
  const { parseEdl } = await load(MOD.edl);
  const { runVideoPipeline } = await load(MOD.pipeline);
  const projectRoot = makeTmpRoot(prefix);
  const slug = "cache-demo";
  const workDir = videoWorkDir(projectRoot, slug);
  // The footage and the music exist before the first run, as the record / music stages leave them.
  writeFile(join(workDir, CLIP), "clip bytes: take 1");
  writeFile(join(workDir, MUSIC), "music bytes: take 1");
  const edlText = cacheEdlText();
  const run = async () => {
    const { tts, calls: ttsCalls } = fakeTts(projectRoot, slug);
    const { runner, calls } = fakeRunner();
    const res = await runVideoPipeline({
      projectRoot,
      slug,
      segments: SEGMENTS,
      voice: VOICE,
      tts,
      edl: parseEdl(edlText), // the edit list never changes across runs
      style: style(),
      runner,
      which: whichAll,
    });
    return { stages: res.stages, ttsCalls, renders: ffmpegRenders(calls).length };
  };
  return { workDir, run };
}

/** Rewrite `rel` under `workDir`: same bytes (but a fresh write) or new bytes. */
function rewrite(workDir: string, rel: string, mode: "identical" | "different"): void {
  const path = join(workDir, rel);
  const before = readFileSync(path);
  const after = mode === "identical" ? Buffer.from(before) : Buffer.concat([before, Buffer.from(" — take 2")]);
  writeFileSync(path, after);
  if (mode === "identical") expect(sha256(readFileSync(path))).toBe(sha256(before));
  else expect(sha256(readFileSync(path))).not.toBe(sha256(before));
}

const ttsRan = (stages: Record<string, string>): string[] =>
  Object.entries(stages)
    .filter(([k, v]) => k.startsWith("tts:") && v === "ran")
    .map(([k]) => k);

describe("AC-STE-674.1 — the render stage keys on the bytes of the files the EDL references", () => {
  test("AC-STE-674.1 renderStageInputs carries a SHA-256 of each clip, voice audio and music file's bytes", async () => {
    const { parseEdl } = await load(MOD.edl);
    const { renderStageInputs } = await load(MOD.pipeline);
    expect(typeof renderStageInputs).toBe("function");
    const workDir = makeTmpRoot("ste674-inputs-");
    const files: Record<string, string> = {
      [CLIP]: "clip bytes",
      "segments/1.mp3": "voice one bytes",
      [SEGMENT_2_AUDIO]: "voice two bytes",
      [MUSIC]: "music bytes",
    };
    for (const [rel, body] of Object.entries(files)) writeFile(join(workDir, rel), body);
    const edl = parseEdl(cacheEdlText());
    const inputs = renderStageInputs(workDir, edl, style(), { "tts:1": "a".repeat(64), "tts:2": "b".repeat(64) });

    expect(inputs.clip_bytes).toEqual({ [CLIP]: sha256(files[CLIP]!) });
    expect(inputs.voice_bytes).toEqual({
      "segments/1.mp3": sha256(files["segments/1.mp3"]!),
      [SEGMENT_2_AUDIO]: sha256(files[SEGMENT_2_AUDIO]!),
    });
    expect(inputs.music_bytes).toBe(sha256(files[MUSIC]!));
    // The existing named inputs stay.
    expect(inputs.edl).toEqual(edl);
    expect(inputs.tts).toEqual({ "tts:1": "a".repeat(64), "tts:2": "b".repeat(64) });
  });

  test("AC-STE-674.1 the render stage version is bumped above 1", () => {
    const source = readFileSync(MOD.pipeline, "utf8");
    const m = source.match(/RENDER_STAGE_VERSION\s*=\s*(\d+)/);
    expect(m, "pipeline.ts declares RENDER_STAGE_VERSION").not.toBeNull();
    expect(Number(m![1])).toBeGreaterThan(1);
  });

  test("AC-STE-674.1 clip bytes: a rewritten clip re-runs render under an unchanged edl.json; identical bytes skip it", async () => {
    const h = await cacheHarness("ste674-clip-");
    const first = await h.run();
    expect(first.stages["render"]).toBe("ran");
    expect(first.renders).toBe(1);

    rewrite(h.workDir, CLIP, "identical");
    const same = await h.run();
    expect(same.stages["render"]).toBe("skipped");
    expect(same.renders).toBe(0);

    rewrite(h.workDir, CLIP, "different");
    const changed = await h.run();
    expect(changed.stages["render"]).toBe("ran");
    expect(changed.renders).toBe(1);
    expect(ttsRan(changed.stages)).toEqual([]);
    expect(changed.ttsCalls).toEqual([]);
  });

  test("AC-STE-674.1 music bytes: a rewritten music file re-runs render; identical bytes skip it", async () => {
    const h = await cacheHarness("ste674-music-");
    expect((await h.run()).stages["render"]).toBe("ran");

    rewrite(h.workDir, MUSIC, "identical");
    const same = await h.run();
    expect(same.stages["render"]).toBe("skipped");
    expect(same.renders).toBe(0);

    rewrite(h.workDir, MUSIC, "different");
    const changed = await h.run();
    expect(changed.stages["render"]).toBe("ran");
    expect(changed.renders).toBe(1);
    expect(ttsRan(changed.stages)).toEqual([]);
  });

  test("AC-STE-674.1 voice bytes: a rewritten voice segment re-runs render; identical bytes skip it", async () => {
    const h = await cacheHarness("ste674-voice-");
    expect((await h.run()).stages["render"]).toBe("ran");

    rewrite(h.workDir, SEGMENT_2_AUDIO, "identical");
    const same = await h.run();
    expect(same.stages["render"]).toBe("skipped");
    expect(same.renders).toBe(0);

    rewrite(h.workDir, SEGMENT_2_AUDIO, "different");
    const changed = await h.run();
    // The TTS key follows the text, which did not change: only the render re-runs.
    expect(changed.stages["tts:2"]).toBe("skipped");
    expect(changed.ttsCalls).toEqual([]);
    expect(changed.stages["render"]).toBe("ran");
    expect(changed.renders).toBe(1);
  });
});

// ===========================================================================
// AC-STE-674.2 — mutation: dropping the clip bytes reds the clip assertion
// ===========================================================================

interface OverlayRun {
  code: number;
  output: string;
  mutatedSource: string | null;
}

/**
 * Materialise a temp overlay of the plugin (adapters/_shared/src, this suite, its fixtures, the
 * sited-mutation helper), optionally mutate one module IN THE OVERLAY, assert the mutation landed,
 * and run this suite filtered to `filter`. The working tree is never touched.
 */
function runOverlay(
  filter: string,
  mutation: { moduleRel: string; find: string; repl: string; marker: string } | null,
): OverlayRun {
  const root = makeTmpRoot("ste674-overlay-");
  const plugin = join(root, "plugins", "dev-process-toolkit");
  mkdirSync(join(plugin, "adapters", "_shared"), { recursive: true });
  mkdirSync(join(plugin, "tests", "fixtures"), { recursive: true });
  const copy = Bun.spawnSync(
    [
      "bash",
      "-c",
      [
        "set -e",
        `cp -R ${JSON.stringify(SRC)} ${JSON.stringify(join(plugin, "adapters", "_shared"))}/`,
        `cp ${JSON.stringify(join(PLUGIN_ROOT, THIS_FILE_REL))} ${JSON.stringify(join(plugin, "tests"))}/`,
        `cp ${JSON.stringify(join(PLUGIN_ROOT, "tests", "_sited-mutation.ts"))} ${JSON.stringify(join(plugin, "tests"))}/`,
        `cp -R ${JSON.stringify(FIXTURES)} ${JSON.stringify(join(plugin, "tests", "fixtures"))}/`,
      ].join("; "),
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (copy.exitCode !== 0) throw new Error(`overlay copy failed (exit ${copy.exitCode}): ${copy.stderr.toString().trim()}`);
  if (existsSync(join(REPO_ROOT, "node_modules"))) symlinkSync(join(REPO_ROOT, "node_modules"), join(root, "node_modules"));

  let mutatedSource: string | null = null;
  if (mutation !== null) {
    const target = join(plugin, mutation.moduleRel);
    expect(existsSync(target)).toBe(true);
    const before = readFileSync(target, "utf8");
    const after = mutateInRegion(before, 0, before.length, mutation.find, mutation.repl, {
      label: `${mutation.moduleRel} (whole module)`,
    });
    writeFileSync(target, after);
    // The mutation is asserted APPLIED before the target test runs.
    mutatedSource = readFileSync(target, "utf8");
    expect(mutatedSource).not.toBe(before);
    expect(mutatedSource).toContain(mutation.marker);
    expect(sha256(mutatedSource)).not.toBe(sha256(before));
  }

  const proc = Bun.spawnSync(["bun", "test", THIS_FILE_REL, "-t", filter], { cwd: plugin, stdout: "pipe", stderr: "pipe" });
  return { code: proc.exitCode ?? -1, output: `${proc.stdout.toString()}\n${proc.stderr.toString()}`, mutatedSource };
}

const failedRow = (run: OverlayRun, name: string): boolean =>
  run.output.split("\n").some((l) => l.startsWith("(fail)") && l.includes(name));
/** Summary counts; "(pass)" rows are suppressed in agent sessions, so controls grade on counts. */
const count = (run: OverlayRun, kind: "pass" | "fail"): number => {
  const m = run.output.match(new RegExp(`^\\s*(\\d+) ${kind}\\b`, "m"));
  return m === null ? -1 : Number.parseInt(m[1]!, 10);
};

// Built by concatenation so these titles never match their own inner filter.
const CLIP_TARGET = "AC-STE-674.1 clip" + " bytes";

describe("AC-STE-674.2 — the clip-bytes key input is mutation-verified", () => {
  test(
    "control: the unmutated overlay passes the clip-bytes cache test",
    () => {
      const run = runOverlay(CLIP_TARGET, null);
      // Non-vacuous: a filter matching zero tests also exits 0.
      expect(count(run, "pass"), run.output.slice(-800)).toBeGreaterThan(0);
      expect(count(run, "fail"), run.output.slice(-800)).toBe(0);
      expect(failedRow(run, CLIP_TARGET)).toBe(false);
      expect(run.code).toBe(0);
    },
    120_000,
  );

  test(
    "removing the clip bytes from the render inputs turns the clip-bytes cache test red",
    () => {
      const marker = "/* MUTATION:STE-674.2:no-clip-bytes */";
      const run = runOverlay(CLIP_TARGET, {
        moduleRel: "adapters/_shared/src/video/pipeline.ts",
        find: "export function renderStageInputs(",
        repl:
          `export function renderStageInputs(...a: any[]): Record<string, unknown> { ${marker} ` +
          "const r: Record<string, unknown> = { ...(__unmutated_renderStageInputs as any)(...a) }; delete r.clip_bytes; return r; }\n" +
          "function __unmutated_renderStageInputs(",
        marker,
      });
      expect(run.mutatedSource).toContain(marker);
      expect(failedRow(run, CLIP_TARGET), run.output.slice(-800)).toBe(true);
      expect(count(run, "fail")).toBeGreaterThan(0);
      expect(run.code).not.toBe(0);
    },
    120_000,
  );
});

// ===========================================================================
// AC-STE-674.3 / .4 — a variable-frame-rate clip keeps the clips after it on their placed times
// ===========================================================================

function ffmpegSync(args: string[], cwd: string): void {
  const p = Bun.spawnSync(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`fixture ffmpeg failed (${p.exitCode}): ${p.stderr.toString()}`);
}

function ffprobeJson(args: string[], cwd: string): any {
  const p = Bun.spawnSync(["ffprobe", "-v", "error", ...args, "-of", "json"], { cwd, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`ffprobe failed (${p.exitCode}): ${p.stderr.toString()}`);
  return JSON.parse(p.stdout.toString());
}

/** A solid-colour constant-rate clip, 160x120 @ 30 fps. */
function solidClip(cwd: string, out: string, color: string, seconds: number): void {
  mkdirSync(join(cwd, dirname(out)), { recursive: true });
  ffmpegSync(
    ["-f", "lavfi", "-i", `color=c=${color}:size=160x120:rate=30:duration=${seconds}`, "-c:v", "libx264", "-pix_fmt", "yuv420p", out],
    cwd,
  );
}

/**
 * A red VARIABLE-frame-rate clip: frames 0..30 at 1/30 s spacing (0 .. 1.0 s), then a recorder-style
 * static-screen gap — the next frame at 2.5 s — then 10 fps to 3.4 s. Placed with `out: 2`, the last
 * frame kept (t = 1.0) carries a 1.5 s source duration that reaches past the cut.
 */
function vfrClip(cwd: string, out: string): void {
  mkdirSync(join(cwd, dirname(out)), { recursive: true });
  ffmpegSync(
    [
      "-f", "lavfi", "-i", "color=c=red:size=160x120:rate=30:duration=2",
      "-vf", "select='lt(n,41)',setpts='if(lte(N,30),N/30,2.5+(N-31)/10)/TB'",
      "-fps_mode", "vfr", "-c:v", "libx264", "-pix_fmt", "yuv420p", out,
    ],
    cwd,
  );
}

type Colour = "red" | "green" | "blue" | "other";

/** Classify a frame by its mean chroma (signalstats U/V averages, 8-bit). */
function colourOf(u: number, v: number): Colour {
  if (v > 180 && u < 140) return "red";
  if (u > 180 && v < 160) return "blue";
  if (u < 128 && v < 128) return "green";
  return "other";
}

/** Every decoded frame of `file` with its pts and colour, measured with ffprobe + signalstats. */
function frameColours(cwd: string, file: string): { t: number; colour: Colour }[] {
  const info = ffprobeJson(
    ["-f", "lavfi", "-i", `movie=${file},signalstats`, "-show_entries", "frame=pts_time:frame_tags=lavfi.signalstats.UAVG,lavfi.signalstats.VAVG"],
    cwd,
  );
  return (info.frames ?? []).map((f: any) => ({
    t: Number(f.pts_time),
    colour: colourOf(Number(f.tags?.["lavfi.signalstats.UAVG"]), Number(f.tags?.["lavfi.signalstats.VAVG"])),
  }));
}

const ONE_FRAME = 1 / 30;

describe("AC-STE-674.3 / AC-STE-674.4 — a variable-frame-rate first clip keeps later clips on their placed times", () => {
  test(
    "AC-STE-674.3 AC-STE-674.4 three-clip EDL with a VFR clip first: each clip's first frame within 1/30 s of its placed time; duration = EDL end",
    async () => {
      const { parseEdl } = await load(MOD.edl);
      const { renderVideo } = await load(MOD.render);
      const { placeClips, placedDuration } = await load(MOD.anchors);
      const workDir = makeTmpRoot("ste674-vfr-");
      vfrClip(workDir, "clips/vfr.mp4");
      solidClip(workDir, "clips/green.mp4", "green", 1);
      solidClip(workDir, "clips/blue.mp4", "blue", 1);

      // Control: the first clip really is variable-frame-rate (more than one distinct frame spacing).
      const src = ffprobeJson(["-select_streams", "v", "-show_entries", "frame=pts_time", "clips/vfr.mp4"], workDir);
      const pts: number[] = (src.frames ?? []).map((f: any) => Number(f.pts_time));
      const gaps = new Set(pts.slice(1).map((t, i) => (t - pts[i]!).toFixed(3)));
      expect(gaps.size, `frame spacings ${[...gaps].join(",")}`).toBeGreaterThan(1);

      const edl = parseEdl(
        JSON.stringify({
          edl_version: 1,
          clips: [
            { src: "clips/vfr.mp4", in: 0, out: 2 },
            { src: "clips/green.mp4", in: 0, out: 1 },
            { src: "clips/blue.mp4", in: 0, out: 1 },
          ],
        }),
      );
      const st = style({ layout: { viewport: { width: 160, height: 120 } } });
      await renderVideo({ edl, style: st, workDir });

      // Placed times come from the placer (first frame = start + lead); the edit list concatenates to 0, 2, 3.
      const expectedStarts: number[] = placeClips(edl).map((p: any) => p.start + p.lead);
      expect(expectedStarts).toEqual([0, 2, 3]);
      const edlEnd: number = placedDuration(edl);
      expect(edlEnd).toBeCloseTo(4, 6);

      const frames = frameColours(workDir, "final.mp4");
      const firstOf = (c: Colour): number | null => frames.find((f) => f.colour === c)?.t ?? null;
      const measured = { red: firstOf("red"), green: firstOf("green"), blue: firstOf("blue") };
      const outInfo = ffprobeJson(["-show_entries", "format=duration", "final.mp4"], workDir);
      const duration = Number(outInfo.format?.duration);
      const report =
        `measured first frames: clip1=${measured.red} clip2=${measured.green} clip3=${measured.blue}; ` +
        `placed ${expectedStarts.join(", ")}; duration ${duration} vs EDL end ${edlEnd}`;

      expect(measured.red, report).not.toBeNull();
      expect(measured.green, report).not.toBeNull();
      expect(measured.blue, report).not.toBeNull();
      expect(Math.abs(measured.red! - expectedStarts[0]!), report).toBeLessThanOrEqual(ONE_FRAME + 1e-6);
      expect(Math.abs(measured.green! - expectedStarts[1]!), report).toBeLessThanOrEqual(ONE_FRAME + 1e-6);
      expect(Math.abs(measured.blue! - expectedStarts[2]!), report).toBeLessThanOrEqual(ONE_FRAME + 1e-6);
      expect(Math.abs(duration - edlEnd), report).toBeLessThanOrEqual(ONE_FRAME + 1e-6);
    },
    120_000,
  );
});

// ===========================================================================
// AC-STE-674.5 — the style's loudness.target_lufs
// ===========================================================================

describe("AC-STE-674.5 — the style parser accepts loudness.target_lufs (−30..−5, default −16)", () => {
  test("AC-STE-674.5 the default is −16 (defaults table and an empty style)", async () => {
    const { parseVideoStyle, VIDEO_STYLE_DEFAULTS: defaults } = await load(MOD.style);
    expect(defaults.loudness).toEqual({ target_lufs: -16 });
    expect(parseVideoStyle("").loudness).toEqual({ target_lufs: -16 });
    expect(parseVideoStyle("humor: none\n").loudness).toEqual({ target_lufs: -16 });
    expect(parseVideoStyle("loudness: {}\n").loudness).toEqual({ target_lufs: -16 });
  });

  for (const value of [-30, -23, -14, -5, -18.5]) {
    test(`AC-STE-674.5 accepts target_lufs ${value}`, async () => {
      const { parseVideoStyle } = await load(MOD.style);
      expect(parseVideoStyle(`loudness:\n  target_lufs: ${value}\n`).loudness).toEqual({ target_lufs: value });
    });
  }

  for (const [label, raw] of [
    ["below range (−30.1)", "-30.1"],
    ["above range (−4.9)", "-4.9"],
    ["positive (0)", "0"],
    ["a string", "loud"],
    ["a boolean", "true"],
    ["a list", "[-16]"],
  ] as const) {
    test(`AC-STE-674.5 refuses target_lufs ${label}, naming loudness.target_lufs`, async () => {
      const { parseVideoStyle } = await load(MOD.style);
      const msg = refusal(() => parseVideoStyle(`loudness:\n  target_lufs: ${raw}\n`));
      expect(msg).toContain("loudness.target_lufs");
    });
  }

  test("AC-STE-674.5 an unknown key under loudness refuses naming its path", async () => {
    const { parseVideoStyle } = await load(MOD.style);
    const msg = refusal(() => parseVideoStyle("loudness:\n  target_lufs: -16\n  true_peak: -1\n"));
    expect(msg).toContain("loudness.true_peak");
  });

  test("AC-STE-674.5 video_init writes loudness.target_lufs with its default", async () => {
    const { renderVideoStyle, videoInit } = await load(MOD.init);
    const { parseVideoStyle } = await load(MOD.style);
    const text: string = renderVideoStyle();
    expect(text).toMatch(/^loudness:\n {2}target_lufs: -16$/m);
    expect(parseVideoStyle(text).loudness).toEqual({ target_lufs: -16 });

    const root = makeTmpRoot("ste674-init-");
    Bun.spawnSync(["git", "init", "-q"], { cwd: root });
    videoInit(root, "elevenlabs", "web", "none");
    const written = readFileSync(videoStylePath(root), "utf8");
    expect(written).toMatch(/^loudness:\n {2}target_lufs: -16$/m);
  });
});

// ===========================================================================
// AC-STE-674.6 — one loudnorm after the mix; music gain stays per input
// ===========================================================================

const SNAPSHOT_CASES = ["voice-music", "voice-only"] as const;
const UPDATE_SNAPSHOTS = process.env.DPT_VIDEO_SNAPSHOT_UPDATE === "1";

const readFixture = (name: string): string => readFileSync(join(FIXTURES, name), "utf8");

function filterGraph(args: string[]): string {
  const i = args.indexOf("-filter_complex");
  expect(i).toBeGreaterThanOrEqual(0);
  return args[i + 1]!;
}

const loudnormCount = (graph: string): number => (graph.match(/loudnorm=/g) ?? []).length;
const statements = (graph: string): string[] => graph.split(";");
const outLabel = (stmt: string): string | null => stmt.match(/\[([^\]]+)\]$/)?.[1] ?? null;
const inLabels = (stmt: string): string[] => [...(stmt.match(/^(?:\[[^\]]+\])+/)?.[0] ?? "").matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]!);

/** True when the `loudnorm` statement consumes `filter`'s output (same chain after it, or its out label). */
function loudnormFollows(graph: string, filter: RegExp): boolean {
  const stmts = statements(graph);
  const ln = stmts.find((s) => s.includes("loudnorm="));
  const src = stmts.find((s) => filter.test(s));
  if (ln === undefined || src === undefined) return false;
  if (ln === src) return ln.search(filter) < ln.indexOf("loudnorm=");
  const label = outLabel(src);
  return label !== null && inLabels(ln).includes(label);
}

describe("AC-STE-674.6 — buildFfmpegArgs normalises loudness once, after the mix", () => {
  test("AC-STE-674.6 voice + music: one loudnorm I=-16 after amix; the music volume stays on its own input", async () => {
    const { parseEdl } = await load(MOD.edl);
    const { buildFfmpegArgs } = await load(MOD.args);
    const graph = filterGraph(buildFfmpegArgs(parseEdl(readFixture("voice-music.edl.json")), style()));
    expect(loudnormCount(graph)).toBe(1);
    expect(graph).toMatch(/loudnorm=[^;]*\bI=-16(?![\d.])/);
    expect(loudnormFollows(graph, /amix=/)).toBe(true);
    // The per-input music gain: `[<n>:a]volume=-18dB[...]` — no loudnorm on it, and it feeds the mix.
    const musicStmt = statements(graph).find((s) => /^\[\d+:a\]volume=-18dB\[[^\]]+\]$/.test(s));
    expect(musicStmt, graph).toBeDefined();
    const amixStmt = statements(graph).find((s) => s.includes("amix="))!;
    expect(inLabels(amixStmt)).toContain(outLabel(musicStmt!)!);
    // No voice chain is normalised on its own.
    for (const s of statements(graph).filter((x) => x.includes("adelay="))) expect(s).not.toContain("loudnorm");
  });

  test("AC-STE-674.6 voice alone (no music): one loudnorm I=-16 on the voice, no amix", async () => {
    const { parseEdl } = await load(MOD.edl);
    const { buildFfmpegArgs } = await load(MOD.args);
    const graph = filterGraph(buildFfmpegArgs(parseEdl(readFixture("voice-only.edl.json")), style()));
    expect(graph).not.toContain("amix=");
    expect(loudnormCount(graph)).toBe(1);
    expect(graph).toMatch(/loudnorm=[^;]*\bI=-16(?![\d.])/);
    expect(loudnormFollows(graph, /adelay=/)).toBe(true);
  });

  test("AC-STE-674.6 the target follows the style's loudness.target_lufs", async () => {
    const { parseEdl } = await load(MOD.edl);
    const { buildFfmpegArgs } = await load(MOD.args);
    const st = style({ loudness: { target_lufs: -14 } });
    for (const name of SNAPSHOT_CASES) {
      const graph = filterGraph(buildFfmpegArgs(parseEdl(readFixture(`${name}.edl.json`)), st));
      expect(loudnormCount(graph), name).toBe(1);
      expect(graph, name).toMatch(/loudnorm=[^;]*\bI=-14(?![\d.])/);
      expect(graph, name).not.toMatch(/\bI=-16(?![\d.])/);
    }
  });

  for (const name of SNAPSHOT_CASES) {
    test(`AC-STE-674.6 ${name}: the args match the pinned snapshot`, async () => {
      const { parseEdl } = await load(MOD.edl);
      const { buildFfmpegArgs } = await load(MOD.args);
      // Snapshots pin the house default style (captions as defaulted), not this suite's captions-off helper.
      const args: string[] = buildFfmpegArgs(parseEdl(readFixture(`${name}.edl.json`)), structuredClone(VIDEO_STYLE_DEFAULTS));
      expect(args[args.length - 1]).toBe("final.mp4");
      const snapPath = join(FIXTURES, `${name}.args.json`);
      if (UPDATE_SNAPSHOTS) writeFileSync(snapPath, `${JSON.stringify(args, null, 2)}\n`);
      expect(existsSync(snapPath), `snapshot ${snapPath} is missing — generate it with DPT_VIDEO_SNAPSHOT_UPDATE=1 and review it`).toBe(true);
      const pinned = readFileSync(snapPath, "utf8");
      expect(`${JSON.stringify(args, null, 2)}\n`).toBe(pinned);
      // The pinned graph itself carries the one loudnorm.
      expect(loudnormCount(filterGraph(JSON.parse(pinned)))).toBe(1);
    });
  }
});

// ===========================================================================
// AC-STE-674.7 — QA measures integrated loudness against the target
// ===========================================================================

/** A test-pattern clip + an un-normalised sine, `seconds` long, written straight to `out`. */
function unnormalisedCut(cwd: string, out: string, seconds: number): void {
  mkdirSync(join(cwd, dirname(out)), { recursive: true });
  ffmpegSync(
    [
      "-f", "lavfi", "-i", `testsrc=duration=${seconds}:size=160x120:rate=30`,
      "-f", "lavfi", "-i", `sine=frequency=330:duration=${seconds}`,
      "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", out,
    ],
    cwd,
  );
}

const loudnessReasons = (reasons: string[]): string[] => reasons.filter((r) => /loudness|LUFS/i.test(r));
const numbersIn = (s: string): number[] => (s.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);

describe("AC-STE-674.7 — QA checks the final cut's integrated loudness", () => {
  test(
    "AC-STE-674.7 a real lavfi render (normalised by the renderer) passes the loudness check",
    async () => {
      const { parseEdl } = await load(MOD.edl);
      const { renderVideo } = await load(MOD.render);
      const { qaRender } = await load(MOD.qa);
      const workDir = makeTmpRoot("ste674-loud-pass-");
      unnormalisedCut(workDir, "clips/pattern.mp4", 3);
      mkdirSync(join(workDir, "segments"), { recursive: true });
      ffmpegSync(["-f", "lavfi", "-i", "sine=frequency=330:duration=3", "segments/1.wav"], workDir);
      const edl = parseEdl(
        JSON.stringify({
          edl_version: 1,
          clips: [{ src: "clips/pattern.mp4", in: 0, out: 3 }],
          voice: [{ segment: 1, audio: "segments/1.wav", offset: 0 }],
        }),
      );
      await renderVideo({ edl, style: style({ layout: { viewport: { width: 160, height: 120 } } }), workDir });
      const qa = await qaRender({ workDir, edl });
      expect(loudnessReasons(qa.reasons)).toEqual([]);
      expect(qa.reasons).toEqual([]);
      expect(qa.ok).toBe(true);
    },
    120_000,
  );

  test(
    "AC-STE-674.7 a fixture rendered without normalisation fails, with one reason naming loudness, the measurement and the target",
    async () => {
      const { parseEdl } = await load(MOD.edl);
      const { qaRender } = await load(MOD.qa);
      const workDir = makeTmpRoot("ste674-loud-fail-");
      unnormalisedCut(workDir, "final.mp4", 3); // a bare sine measures about −21.8 LUFS
      const edl = parseEdl(JSON.stringify({ edl_version: 1, clips: [{ src: "clips/pattern.mp4", in: 0, out: 3 }] }));
      const qa = await qaRender({ workDir, edl });
      expect(qa.ok).toBe(false);
      const loud = loudnessReasons(qa.reasons);
      expect(loud, qa.reasons.join("\n")).toHaveLength(1);
      // The fixture's duration and streams are fine: loudness is the only reason.
      expect(qa.reasons).toEqual(loud);
      const nums = numbersIn(loud[0]!);
      expect(nums.some((x) => Math.abs(x - -16) < 1e-9), loud[0]).toBe(true);
      expect(nums.some((x) => x < -19 && x > -25), loud[0]).toBe(true);
    },
    120_000,
  );

  test(
    "AC-STE-674.7 the target is honoured: the same un-normalised fixture passes QA at a −22 LUFS target",
    async () => {
      const { parseEdl } = await load(MOD.edl);
      const { qaRender } = await load(MOD.qa);
      const workDir = makeTmpRoot("ste674-loud-target-");
      unnormalisedCut(workDir, "final.mp4", 3);
      const edl = parseEdl(JSON.stringify({ edl_version: 1, clips: [{ src: "clips/pattern.mp4", in: 0, out: 3 }] }));
      const atDefault = await qaRender({ workDir, edl });
      expect(loudnessReasons(atDefault.reasons)).toHaveLength(1);
      const atTarget = await qaRender({ workDir, edl, targetLufs: -22 });
      expect(atTarget.reasons).toEqual([]);
      expect(atTarget.ok).toBe(true);
    },
    120_000,
  );

  test(
    "HARDEN — a clips-only cut (no voice, no music) renders a silent track and passes the loudness check",
    async () => {
      const { parseEdl } = await load(MOD.edl);
      const { renderVideo } = await load(MOD.render);
      const { qaRender } = await load(MOD.qa);
      const workDir = makeTmpRoot("ste674-loud-silent-");
      unnormalisedCut(workDir, "clips/pattern.mp4", 2);
      const edl = parseEdl(JSON.stringify({ edl_version: 1, clips: [{ src: "clips/pattern.mp4", in: 0, out: 2 }] }));
      await renderVideo({ edl, style: style({ layout: { viewport: { width: 160, height: 120 } } }), workDir });
      const qa = await qaRender({ workDir, edl });
      expect(qa.reasons).toEqual([]);
      expect(qa.ok).toBe(true);
    },
    120_000,
  );
});

// AC-STE-674.8 — gate-level: the full `bun test` run from plugins/dev-process-toolkit reports 0 failures
// and its skip identities equal the trunk baseline by name. Graded by the gate, not by a test here.
