// M_1e0717 STE-665 — stage cache, edit list and renderer.
//
// AC coverage:
//   AC-STE-665.1 — `parseEdl` accepts the valid fixture; refuses (naming the field) an
//                  unknown field, a clip whose out point precedes its in point, and an
//                  `edl_version` other than 1.
//   AC-STE-665.2 — `{ segment: 2, word: 5 }` resolves to word 5's `start` in segment 2's
//                  alignment plus segment 2's offset; a missing segment / word refuses naming it.
//   AC-STE-665.3 — `buildFfmpegArgs(edl, style)` is pure; snapshot fixtures pin the
//                  clips-only, voice + captions and music-at-level argument lists.
//   AC-STE-665.4 — `zoompan` refuses before ffmpeg runs when `banned_effects` holds
//                  `slow_zoom` or `ken_burns` (injected runner records no call).
//   AC-STE-665.5 — after one full run, changing segment 2 of 3 re-runs `tts:2` and `render`
//                  only (manifest + stage-call recorder).
//   AC-STE-665.6 — deleting a cached output re-runs that stage although its key matches.
//   AC-STE-665.7 — ffmpeg / ffprobe absent from PATH refuses in the NFR-10 shape naming the
//                  binary and an install remedy, before any stage runs.
//   AC-STE-665.8 — a real render of a two-second lavfi fixture passes QA and writes one still
//                  per punchline anchor into `qa/`; a duration off by > 5% fails naming both.
//   AC-STE-665.9 — mutation-verified in a temp overlay: removing the banned-effect check reds
//                  AC-STE-665.4; hashing without the segment text reds AC-STE-665.5.
//
// Module contract this suite drives (adapters/_shared/src/video/):
//   edl.ts
//     export type EdlAnchorRef = { segment: number; word: number }      // both 1-based
//     export interface EdlClip { src: string; in: number; out: number; at?: number | EdlAnchorRef; effects?: string[] }
//     export interface EdlVoice { segment: number; audio: string; offset: number }
//     export interface EdlCaption { text: string; start: number; end: number }
//     export interface EdlMusic { src: string; level_db: number }
//     export interface EdlAnchor { name: string; at: number | EdlAnchorRef }   // punchline anchors
//     export interface Edl { edl_version: 1; clips: EdlClip[]; voice: EdlVoice[]; captions: EdlCaption[];
//                            music: EdlMusic | null; anchors: EdlAnchor[] }
//       — `voice`, `captions`, `anchors` default to [], `music` to null when omitted.
//     export function parseEdl(raw: string): Edl      // JSON text; throws an NFR-10 refusal
//       (Refusing / Remedy / Context) naming the offending field path; unknown fields refuse.
//     export function edlDuration(edl: Edl): number   // sum of (out - in) over clips, seconds
//   anchors.ts
//     export function resolveAnchor(ref: EdlAnchorRef, edl: Edl,
//                                   alignments: Record<number, WordTiming[]>): number
//       — alignments[segment][word - 1].start + (edl.voice entry for segment).offset
//   ffmpeg_args.ts
//     export function checkBannedEffects(edl: Edl, style: VideoStyle): void
//       — the ONE banned-effect check (slow_zoom / ken_burns -> zoompan, one table);
//         declared exactly once with this header; AC-STE-665.9 stubs it to a no-op.
//     export function buildFfmpegArgs(edl: Edl, style: VideoStyle): string[]
//       — pure; the argument list WITHOUT the binary; paths stay relative to the work dir;
//         the last argument is "final.mp4".
//   render.ts
//     export type Runner = (argv: string[], opts: { cwd: string }) =>
//       Promise<{ code: number; stdout: string; stderr: string }>
//     export type Which = (bin: string) => string | null
//     export async function renderVideo(opts: { edl: Edl; style: VideoStyle; workDir: string;
//       runner?: Runner; which?: Which }): Promise<{ output: string }>
//       — refuses when ffmpeg or ffprobe is missing, then checkBannedEffects, then ONE runner
//         call whose argv[0] basename is "ffmpeg", with cwd = workDir; output = workDir/final.mp4.
//   qa.ts
//     export async function qaRender(opts: { workDir: string; edl: Edl; runner?: Runner;
//       which?: Which; alignments?: Record<number, WordTiming[]> }):
//       Promise<{ ok: boolean; reasons: string[]; stills: string[] }>
//       — ffprobe: one video + one audio stream, duration within 5% of edlDuration;
//         one still per anchor under workDir/qa/ (filename carries the anchor name).
//   stage_cache.ts
//     export function stageKey(name: string, version: number, inputs: Record<string, unknown>): string
//       — SHA-256 hex over the named inputs and the per-stage version.
//     export interface StageManifest { stages: Record<string, { key: string; outputs: string[] }> }
//     export function readStageManifest(workDir: string): StageManifest   // absent -> { stages: {} }
//     export async function runCachedStage(workDir: string, stage: { name: string; version: number;
//       inputs: Record<string, unknown>; outputs: string[]; run: () => Promise<void> | void }):
//       Promise<"ran" | "skipped">
//       — outputs are relative to workDir; skipped only when the key matches AND every output exists.
//   pipeline.ts
//     export function ttsStageInputs(segment: TtsSegment, voice: VoiceSpec): Record<string, unknown>
//       — the TTS stage's named key inputs; declared exactly once with this header;
//         AC-STE-665.9 stubs it to drop the segment text.
//     export async function runVideoPipeline(opts: { projectRoot: string; slug: string;
//       segments: TtsSegment[]; voice: VoiceSpec; tts: TtsProvider; edl: Edl; style: VideoStyle;
//       runner: Runner; which?: Which }): Promise<{ stages: Record<string, "ran" | "skipped"> }>
//       — stages "tts:<n>" (n = 1-based segment index) and "render"; work dir is
//         videoWorkDir(projectRoot, slug); refuses on a missing binary before any stage.
//     VoiceSpec = { provider: string; voice: string; model?: string }

import { afterAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { videoWorkDir } from "../adapters/_shared/src/dpt_paths";
import { VIDEO_STYLE_DEFAULTS, type VideoStyle } from "../adapters/_shared/src/video/style";
import { mutateInRegion } from "./_sited-mutation";
import { runNestedBunTest } from "./_nested_bun_test";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const VIDEO_DIR = join(PLUGIN_ROOT, "adapters", "_shared", "src", "video");
const FIXTURES = join(import.meta.dir, "fixtures", "video-render");
const THIS_FILE_REL = "tests/m_1e0717-ste-665-video-render.test.ts";

const MOD = {
  edl: join(VIDEO_DIR, "edl.ts"),
  anchors: join(VIDEO_DIR, "anchors.ts"),
  args: join(VIDEO_DIR, "ffmpeg_args.ts"),
  render: join(VIDEO_DIR, "render.ts"),
  qa: join(VIDEO_DIR, "qa.ts"),
  cache: join(VIDEO_DIR, "stage_cache.ts"),
  pipeline: join(VIDEO_DIR, "pipeline.ts"),
};

// Dynamic imports: a missing module reds the test that needs it, not the whole file.
const load = async (path: string): Promise<any> => await import(path);

const readFixture = (name: string): string => readFileSync(join(FIXTURES, name), "utf8");

// ---------------------------------------------------------------------------
// helpers: temp roots, runners, recorders
// ---------------------------------------------------------------------------

const tmpRoots: string[] = [];

function makeTmpRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  tmpRoots.push(root);
  return root;
}

function cleanup(root: string): void {
  rmSync(root, { recursive: true, force: true });
  if (existsSync(root)) Bun.spawnSync(["rm", "-rf", root]);
}

afterAll(() => {
  const removed = [...tmpRoots];
  while (tmpRoots.length > 0) cleanup(tmpRoots.pop()!);
  for (const root of removed) expect(existsSync(root), root).toBe(false);
});

function style(overrides: Partial<VideoStyle> = {}): VideoStyle {
  return { ...structuredClone(VIDEO_STYLE_DEFAULTS), ...overrides };
}

function deepFreeze<T>(o: T): T {
  if (o !== null && typeof o === "object") {
    for (const v of Object.values(o as object)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
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
    if (basename(argv[0] ?? "") === "ffmpeg") {
      const out = join(opts.cwd, argv[argv.length - 1]!);
      mkdirSync(join(out, ".."), { recursive: true });
      writeFileSync(out, `fake render ${calls.length}`);
    }
    return { code: 0, stdout: "", stderr: "" };
  };
  return { runner, calls };
}

const ffmpegCalls = (calls: RunnerCall[]): RunnerCall[] => calls.filter((c) => basename(c.argv[0] ?? "") === "ffmpeg");

const whichAll = (bin: string): string | null => `/usr/local/bin/${bin}`;
const whichWithout = (missing: string) => (bin: string): string | null => (bin === missing ? null : `/usr/local/bin/${bin}`);

/** Expect `p` to reject; return the error message. */
async function refusal(p: Promise<unknown> | (() => unknown)): Promise<string> {
  try {
    if (typeof p === "function") await p();
    else await p;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  throw new Error("expected a refusal, but the call succeeded");
}

function expectNfr10(message: string): void {
  expect(message).toMatch(/^Refusing:/m);
  expect(message).toMatch(/^Remedy:/m);
  expect(message).toMatch(/^Context:/m);
}

// ===========================================================================
// AC-STE-665.1 — parseEdl
// ===========================================================================

describe("AC-STE-665.1 — parseEdl accepts the valid fixture and refuses named fields", () => {
  test("AC-STE-665.1 the valid fixture parses with every field intact", async () => {
    const { parseEdl } = await load(MOD.edl);
    const edl = parseEdl(readFixture("valid.edl.json"));
    expect(edl.edl_version).toBe(1);
    expect(edl.clips).toHaveLength(2);
    expect(edl.clips[0]).toMatchObject({ src: "clips/intro.mp4", in: 0, out: 2.5 });
    expect(edl.clips[1].at).toEqual({ segment: 2, word: 5 });
    expect(edl.voice.map((v: any) => v.offset)).toEqual([0, 2.5]);
    expect(edl.captions.map((c: any) => c.text)).toEqual(["Shipping", "Tomorrow"]);
    expect(edl.music).toEqual({ src: "music/track.mp3", level_db: -18 });
    expect(edl.anchors.map((a: any) => a.name)).toEqual(["punchline", "outro"]);
  });

  test("AC-STE-665.1 omitted optional blocks default (clips-only fixture)", async () => {
    const { parseEdl, edlDuration } = await load(MOD.edl);
    const edl = parseEdl(readFixture("clips-only.edl.json"));
    expect(edl.voice).toEqual([]);
    expect(edl.captions).toEqual([]);
    expect(edl.anchors).toEqual([]);
    expect(edl.music).toBeNull();
    expect(edlDuration(edl)).toBeCloseTo(2.5 + 3, 6);
  });

  test("AC-STE-665.1 an unknown top-level field refuses naming it", async () => {
    const { parseEdl } = await load(MOD.edl);
    const doc = { ...JSON.parse(readFixture("valid.edl.json")), colour: "teal" };
    const msg = await refusal(() => parseEdl(JSON.stringify(doc)));
    expectNfr10(msg);
    expect(msg).toContain("colour");
    expect(msg).not.toContain("teal");
  });

  test("AC-STE-665.1 an unknown clip field refuses naming its path", async () => {
    const { parseEdl } = await load(MOD.edl);
    const doc = JSON.parse(readFixture("valid.edl.json"));
    doc.clips[1].speed = 2;
    const msg = await refusal(() => parseEdl(JSON.stringify(doc)));
    expectNfr10(msg);
    expect(msg).toMatch(/clips(\[1\]|\.1)\.speed/);
  });

  test("AC-STE-665.1 a clip whose out precedes its in refuses naming the field", async () => {
    const { parseEdl } = await load(MOD.edl);
    const doc = JSON.parse(readFixture("valid.edl.json"));
    doc.clips[0].in = 3;
    doc.clips[0].out = 1;
    const msg = await refusal(() => parseEdl(JSON.stringify(doc)));
    expectNfr10(msg);
    expect(msg).toMatch(/clips(\[0\]|\.0)\.out/);
  });

  test("AC-STE-665.1 an edl_version other than 1 refuses naming edl_version", async () => {
    const { parseEdl } = await load(MOD.edl);
    for (const v of [2, 0, "1"]) {
      const doc = { ...JSON.parse(readFixture("valid.edl.json")), edl_version: v };
      const msg = await refusal(() => parseEdl(JSON.stringify(doc)));
      expectNfr10(msg);
      expect(msg).toContain("edl_version");
    }
  });
});

// ===========================================================================
// AC-STE-665.2 — anchor resolution
// ===========================================================================

/** Segment 2 alignment: word n (1-based) starts at 0.3 * n + 0.05 — distinct from 0-based. */
const SEG2_ALIGN = Array.from({ length: 8 }, (_, i) => ({
  word: `w${i + 1}`,
  start: Number((0.3 * (i + 1) + 0.05).toFixed(2)),
  end: Number((0.3 * (i + 1) + 0.25).toFixed(2)),
}));
const SEG1_ALIGN = [
  { word: "Shipping", start: 0, end: 0.6 },
  { word: "today", start: 0.7, end: 1.1 },
];

describe("AC-STE-665.2 — a word-anchored cut resolves to the word's start plus the segment offset", () => {
  test("AC-STE-665.2 { segment: 2, word: 5 } = alignment[2][word 5].start + offset(2)", async () => {
    const { parseEdl } = await load(MOD.edl);
    const { resolveAnchor } = await load(MOD.anchors);
    const edl = parseEdl(readFixture("valid.edl.json"));
    const t = resolveAnchor({ segment: 2, word: 5 }, edl, { 1: SEG1_ALIGN, 2: SEG2_ALIGN });
    // word 5 (1-based) = SEG2_ALIGN[4].start = 1.55; segment 2 offset = 2.5.
    expect(t).toBeCloseTo(1.55 + 2.5, 6);
  });

  test("AC-STE-665.2 the offset follows the edit list, not the alignment", async () => {
    const { parseEdl } = await load(MOD.edl);
    const { resolveAnchor } = await load(MOD.anchors);
    const doc = JSON.parse(readFixture("valid.edl.json"));
    doc.voice[1].offset = 7;
    const edl = parseEdl(JSON.stringify(doc));
    expect(resolveAnchor({ segment: 2, word: 5 }, edl, { 1: SEG1_ALIGN, 2: SEG2_ALIGN })).toBeCloseTo(1.55 + 7, 6);
  });

  test("AC-STE-665.2 a missing segment refuses naming the segment", async () => {
    const { parseEdl } = await load(MOD.edl);
    const { resolveAnchor } = await load(MOD.anchors);
    const edl = parseEdl(readFixture("valid.edl.json"));
    const msg = await refusal(() => resolveAnchor({ segment: 9, word: 1 }, edl, { 1: SEG1_ALIGN, 2: SEG2_ALIGN }));
    expect(msg).toMatch(/segment 9\b/);
  });

  test("AC-STE-665.2 a missing word refuses naming the word and its segment", async () => {
    const { parseEdl } = await load(MOD.edl);
    const { resolveAnchor } = await load(MOD.anchors);
    const edl = parseEdl(readFixture("valid.edl.json"));
    const msg = await refusal(() => resolveAnchor({ segment: 2, word: 12 }, edl, { 1: SEG1_ALIGN, 2: SEG2_ALIGN }));
    expect(msg).toMatch(/word 12\b/);
    expect(msg).toMatch(/segment 2\b/);
  });
});

// ===========================================================================
// AC-STE-665.3 — buildFfmpegArgs purity + snapshots
// ===========================================================================

const SNAPSHOT_CASES = ["clips-only", "voice-captions", "music-level"] as const;
const UPDATE_SNAPSHOTS = process.env.DPT_VIDEO_SNAPSHOT_UPDATE === "1";

describe("AC-STE-665.3 — buildFfmpegArgs is pure and pinned by snapshots", () => {
  for (const name of SNAPSHOT_CASES) {
    test(`AC-STE-665.3 ${name}: same inputs give byte-identical args matching the snapshot`, async () => {
      const { parseEdl } = await load(MOD.edl);
      const { buildFfmpegArgs } = await load(MOD.args);
      const raw = readFixture(`${name}.edl.json`);
      const edl = deepFreeze(parseEdl(raw));
      const st = deepFreeze(style());
      const a = buildFfmpegArgs(edl, st);
      const b = buildFfmpegArgs(edl, st);
      const c = buildFfmpegArgs(parseEdl(raw), style());
      expect(Array.isArray(a)).toBe(true);
      expect(a.length).toBeGreaterThan(0);
      expect(a.every((x: unknown) => typeof x === "string")).toBe(true);
      expect(JSON.stringify(b)).toBe(JSON.stringify(a));
      expect(JSON.stringify(c)).toBe(JSON.stringify(a));
      // Work-dir relative: no absolute machine paths leak into a snapshot.
      for (const arg of a) {
        expect(arg).not.toContain(PLUGIN_ROOT);
        expect(arg).not.toContain(tmpdir());
      }
      expect(a[a.length - 1]).toBe("final.mp4");

      const snapPath = join(FIXTURES, `${name}.args.json`);
      if (UPDATE_SNAPSHOTS) writeFileSync(snapPath, `${JSON.stringify(a, null, 2)}\n`);
      expect(
        existsSync(snapPath),
        `snapshot ${snapPath} is missing — generate it with DPT_VIDEO_SNAPSHOT_UPDATE=1 and review it`,
      ).toBe(true);
      expect(`${JSON.stringify(a, null, 2)}\n`).toBe(readFileSync(snapPath, "utf8"));
    });
  }

  test("AC-STE-665.3 every clip is an input", async () => {
    const { parseEdl } = await load(MOD.edl);
    const { buildFfmpegArgs } = await load(MOD.args);
    const args: string[] = buildFfmpegArgs(parseEdl(readFixture("clips-only.edl.json")), style());
    const inputs = args.flatMap((x, i) => (x === "-i" ? [args[i + 1]] : []));
    expect(inputs).toContain("clips/intro.mp4");
    expect(inputs).toContain("clips/demo.mp4");
  });

  test("AC-STE-665.3 voice + captions: each voice segment is an input and each caption text is drawn", async () => {
    const { parseEdl } = await load(MOD.edl);
    const { buildFfmpegArgs } = await load(MOD.args);
    const args: string[] = buildFfmpegArgs(parseEdl(readFixture("voice-captions.edl.json")), style());
    const inputs = args.flatMap((x, i) => (x === "-i" ? [args[i + 1]] : []));
    expect(inputs).toContain("segments/1.mp3");
    expect(inputs).toContain("segments/2.mp3");
    const joined = args.join(" ");
    expect(joined).toContain("Shipping");
    expect(joined).toContain("Tomorrow");
  });

  test("AC-STE-665.3 music at level: the track is an input at the edit list's level", async () => {
    const { parseEdl } = await load(MOD.edl);
    const { buildFfmpegArgs } = await load(MOD.args);
    const doc = JSON.parse(readFixture("music-level.edl.json"));
    const args: string[] = buildFfmpegArgs(parseEdl(JSON.stringify(doc)), style());
    const inputs = args.flatMap((x, i) => (x === "-i" ? [args[i + 1]] : []));
    expect(inputs).toContain("music/track.mp3");
    expect(args.join(" ")).toContain("volume=-18dB");
    doc.music.level_db = -12;
    const louder: string[] = buildFfmpegArgs(parseEdl(JSON.stringify(doc)), style());
    expect(louder.join(" ")).toContain("volume=-12dB");
    expect(louder.join(" ")).not.toContain("volume=-18dB");
  });
});

// ===========================================================================
// AC-STE-665.4 — banned effects refuse before ffmpeg runs
// ===========================================================================

function zoompanEdlText(): string {
  const doc = JSON.parse(readFixture("clips-only.edl.json"));
  doc.clips[0].effects = ["zoompan"];
  return JSON.stringify(doc);
}

describe("AC-STE-665.4 — a banned effect refuses before ffmpeg runs", () => {
  for (const banned of ["slow_zoom", "ken_burns"]) {
    test(`AC-STE-665.4 zoompan refuses when banned_effects holds ${banned}; the runner records no call`, async () => {
      const { parseEdl } = await load(MOD.edl);
      const { renderVideo } = await load(MOD.render);
      const workDir = makeTmpRoot("ste665-ban-");
      const { runner, calls } = fakeRunner();
      const msg = await refusal(
        renderVideo({
          edl: parseEdl(zoompanEdlText()),
          style: style({ banned_effects: [banned] }),
          workDir,
          runner,
          which: whichAll,
        }),
      );
      expectNfr10(msg);
      expect(msg).toContain("zoompan");
      expect(msg).toContain(banned);
      expect(calls).toEqual([]);
      expect(existsSync(join(workDir, "final.mp4"))).toBe(false);
    });
  }

  test("AC-STE-665.4 control: with nothing banned the same edit list reaches the runner once", async () => {
    const { parseEdl } = await load(MOD.edl);
    const { renderVideo } = await load(MOD.render);
    const workDir = makeTmpRoot("ste665-ban-ctl-");
    const { runner, calls } = fakeRunner();
    const res = await renderVideo({
      edl: parseEdl(zoompanEdlText()),
      style: style({ banned_effects: [] }),
      workDir,
      runner,
      which: whichAll,
    });
    expect(ffmpegCalls(calls)).toHaveLength(1);
    expect(ffmpegCalls(calls)[0]!.cwd).toBe(workDir);
    expect(ffmpegCalls(calls)[0]!.argv.join(" ")).toContain("zoompan");
    expect(res.output).toBe(join(workDir, "final.mp4"));
    expect(existsSync(res.output)).toBe(true);
  });
});

// ===========================================================================
// AC-STE-665.5 / .6 — the stage cache
// ===========================================================================

const SEGMENTS = [
  { index: 1, text: "Meet the new render pipeline." },
  { index: 2, text: "It caches every stage by its inputs." },
  { index: 3, text: "So one fixed sentence costs one voice call." },
];
const VOICE = { provider: "elevenlabs", voice: "voice-a", model: "eleven_multilingual_v2" };

function pipelineEdlText(): string {
  return JSON.stringify({
    edl_version: 1,
    clips: [{ src: "clips/intro.mp4", in: 0, out: 6 }],
    voice: [
      { segment: 1, audio: "segments/1.mp3", offset: 0 },
      { segment: 2, audio: "segments/2.mp3", offset: 2 },
      { segment: 3, audio: "segments/3.mp3", offset: 4 },
    ],
  });
}

/** A fake TTS provider: records synthesize calls, writes deterministic audio + alignment. */
function fakeTts(projectRoot: string, slug: string): { tts: any; calls: number[] } {
  const calls: number[] = [];
  const tts = {
    async synthesize(segment: { index: number; text: string }) {
      calls.push(segment.index);
      const dir = videoWorkDir(projectRoot, slug);
      mkdirSync(join(dir, "segments"), { recursive: true });
      mkdirSync(join(dir, "alignment"), { recursive: true });
      const audioPath = join(dir, "segments", `${segment.index}.mp3`);
      writeFileSync(audioPath, `audio:${segment.text}`);
      const alignment = segment.text.split(" ").map((word, i) => ({ word, start: i * 0.3, end: i * 0.3 + 0.2 }));
      writeFileSync(join(dir, "alignment", `${segment.index}.json`), JSON.stringify(alignment));
      return { audioPath, alignment };
    },
  };
  return { tts, calls };
}

interface PipelineHarness {
  projectRoot: string;
  slug: string;
  workDir: string;
  run: (segments: typeof SEGMENTS) => Promise<{ stages: Record<string, string>; ttsCalls: number[]; ffmpeg: number }>;
}

async function pipelineHarness(prefix: string): Promise<PipelineHarness> {
  const { parseEdl } = await load(MOD.edl);
  const { runVideoPipeline } = await load(MOD.pipeline);
  const projectRoot = makeTmpRoot(prefix);
  const slug = "render-demo";
  const workDir = videoWorkDir(projectRoot, slug);
  const run = async (segments: typeof SEGMENTS) => {
    const { tts, calls: ttsCalls } = fakeTts(projectRoot, slug);
    const { runner, calls } = fakeRunner();
    const res = await runVideoPipeline({
      projectRoot,
      slug,
      segments,
      voice: VOICE,
      tts,
      edl: parseEdl(pipelineEdlText()),
      style: style(),
      runner,
      which: whichAll,
    });
    return { stages: res.stages, ttsCalls, ffmpeg: ffmpegCalls(calls).length };
  };
  return { projectRoot, slug, workDir, run };
}

const ranStages = (stages: Record<string, string>): string[] =>
  Object.entries(stages).filter(([, v]) => v === "ran").map(([k]) => k).sort();

describe("AC-STE-665.5 — changing one segment re-runs only its TTS stage and the render", () => {
  test("AC-STE-665.5 a first full run runs every stage and records each key in the manifest", async () => {
    const { readStageManifest } = await load(MOD.cache);
    const h = await pipelineHarness("ste665-pipe-first-");
    const first = await h.run(SEGMENTS);
    expect(ranStages(first.stages)).toEqual(expect.arrayContaining(["render", "tts:1", "tts:2", "tts:3"]));
    expect(Object.values(first.stages).every((v) => v === "ran")).toBe(true);
    expect(first.ttsCalls.sort()).toEqual([1, 2, 3]);
    expect(first.ffmpeg).toBe(1);
    const manifest = readStageManifest(h.workDir);
    for (const name of ["tts:1", "tts:2", "tts:3", "render"]) {
      expect(manifest.stages[name]?.key, name).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(manifest.stages["render"]!.outputs).toContain("final.mp4");
  });

  test("AC-STE-665.5 an unchanged second run skips every stage", async () => {
    const h = await pipelineHarness("ste665-pipe-same-");
    await h.run(SEGMENTS);
    const again = await h.run(SEGMENTS);
    expect(ranStages(again.stages)).toEqual([]);
    expect(again.ttsCalls).toEqual([]);
    expect(again.ffmpeg).toBe(0);
  });

  test("AC-STE-665.5 changing segment 2's text re-runs tts:2 and render only", async () => {
    const { readStageManifest } = await load(MOD.cache);
    const h = await pipelineHarness("ste665-pipe-edit-");
    await h.run(SEGMENTS);
    const before = readStageManifest(h.workDir);
    const edited = SEGMENTS.map((s) => (s.index === 2 ? { ...s, text: "It caches each stage by what went in." } : s));
    const second = await h.run(edited);

    // Stage-call recorder: one voice call for segment 2, one ffmpeg run.
    expect(second.ttsCalls).toEqual([2]);
    expect(second.ffmpeg).toBe(1);
    // Every other stage the pipeline reports is skipped.
    expect(ranStages(second.stages)).toEqual(["render", "tts:2"]);
    for (const [name, verdict] of Object.entries(second.stages)) {
      if (name !== "render" && name !== "tts:2") expect(verdict, name).toBe("skipped");
    }
    // Manifest: tts:2 and render keys moved, tts:1 and tts:3 did not.
    const after = readStageManifest(h.workDir);
    expect(after.stages["tts:2"]!.key).not.toBe(before.stages["tts:2"]!.key);
    expect(after.stages["render"]!.key).not.toBe(before.stages["render"]!.key);
    expect(after.stages["tts:1"]!.key).toBe(before.stages["tts:1"]!.key);
    expect(after.stages["tts:3"]!.key).toBe(before.stages["tts:3"]!.key);
  });

  test("AC-STE-665.5 ttsStageInputs names the segment text, so the key follows it", async () => {
    const { ttsStageInputs } = await load(MOD.pipeline);
    const { stageKey } = await load(MOD.cache);
    const a = stageKey("tts:2", 1, ttsStageInputs(SEGMENTS[1], VOICE));
    const b = stageKey("tts:2", 1, ttsStageInputs({ ...SEGMENTS[1]!, text: "different words" }, VOICE));
    const c = stageKey("tts:2", 1, ttsStageInputs({ ...SEGMENTS[1]! }, VOICE));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).not.toBe(a);
    expect(c).toBe(a);
  });
});

describe("AC-STE-665.6 — a deleted cached output re-runs its stage although the key matches", () => {
  test("AC-STE-665.6 runCachedStage: key match + outputs present skips; a deleted output re-runs", async () => {
    const { runCachedStage, stageKey } = await load(MOD.cache);
    const workDir = makeTmpRoot("ste665-cache-");
    let runs = 0;
    const stage = {
      name: "captions",
      version: 1,
      inputs: { text: "hello" },
      outputs: ["captions/out.txt"],
      run: () => {
        runs += 1;
        mkdirSync(join(workDir, "captions"), { recursive: true });
        writeFileSync(join(workDir, "captions", "out.txt"), "hello");
      },
    };
    expect(await runCachedStage(workDir, stage)).toBe("ran");
    expect(await runCachedStage(workDir, stage)).toBe("skipped");
    expect(runs).toBe(1);
    rmSync(join(workDir, "captions", "out.txt"));
    expect(await runCachedStage(workDir, stage)).toBe("ran");
    expect(runs).toBe(2);
    // A version bump changes the key.
    expect(stageKey("captions", 2, { text: "hello" })).not.toBe(stageKey("captions", 1, { text: "hello" }));
    expect(await runCachedStage(workDir, { ...stage, version: 2 })).toBe("ran");
    expect(runs).toBe(3);
  });

  test("AC-STE-665.6 pipeline: deleting segments/2.mp3 re-runs tts:2 only among the TTS stages", async () => {
    const h = await pipelineHarness("ste665-pipe-del-");
    await h.run(SEGMENTS);
    rmSync(join(h.workDir, "segments", "2.mp3"));
    const again = await h.run(SEGMENTS);
    expect(again.ttsCalls).toEqual([2]);
    expect(again.stages["tts:2"]).toBe("ran");
    expect(again.stages["tts:1"]).toBe("skipped");
    expect(again.stages["tts:3"]).toBe("skipped");
  });

  test("AC-STE-665.6 pipeline: deleting final.mp4 re-runs the render and no TTS stage", async () => {
    const h = await pipelineHarness("ste665-pipe-delfinal-");
    await h.run(SEGMENTS);
    rmSync(join(h.workDir, "final.mp4"));
    const again = await h.run(SEGMENTS);
    expect(again.stages["render"]).toBe("ran");
    expect(again.ffmpeg).toBe(1);
    expect(again.ttsCalls).toEqual([]);
    expect(existsSync(join(h.workDir, "final.mp4"))).toBe(true);
  });
});

// ===========================================================================
// AC-STE-665.7 — missing binaries refuse before any stage
// ===========================================================================

describe("AC-STE-665.7 — a missing ffmpeg or ffprobe refuses before any stage runs", () => {
  for (const missing of ["ffmpeg", "ffprobe"]) {
    test(`AC-STE-665.7 renderVideo refuses naming ${missing} and an install remedy`, async () => {
      const { parseEdl } = await load(MOD.edl);
      const { renderVideo } = await load(MOD.render);
      const workDir = makeTmpRoot("ste665-bin-");
      const { runner, calls } = fakeRunner();
      const msg = await refusal(
        renderVideo({
          edl: parseEdl(readFixture("clips-only.edl.json")),
          style: style(),
          workDir,
          runner,
          which: whichWithout(missing),
        }),
      );
      expectNfr10(msg);
      expect(msg).toContain(missing);
      expect(msg.split("\n").find((l) => l.startsWith("Remedy:"))).toMatch(/install/i);
      expect(calls).toEqual([]);
    });

    test(`AC-STE-665.7 runVideoPipeline refuses on a missing ${missing} before any stage`, async () => {
      const { parseEdl } = await load(MOD.edl);
      const { runVideoPipeline } = await load(MOD.pipeline);
      const { readStageManifest } = await load(MOD.cache);
      const projectRoot = makeTmpRoot("ste665-bin-pipe-");
      const slug = "render-demo";
      const { tts, calls: ttsCalls } = fakeTts(projectRoot, slug);
      const { runner, calls } = fakeRunner();
      const msg = await refusal(
        runVideoPipeline({
          projectRoot,
          slug,
          segments: SEGMENTS,
          voice: VOICE,
          tts,
          edl: parseEdl(pipelineEdlText()),
          style: style(),
          runner,
          which: whichWithout(missing),
        }),
      );
      expectNfr10(msg);
      expect(msg).toContain(missing);
      expect(msg).toMatch(/install/i);
      expect(ttsCalls).toEqual([]);
      expect(calls).toEqual([]);
      expect(Object.keys(readStageManifest(videoWorkDir(projectRoot, slug)).stages)).toEqual([]);
    });
  }
});

// ===========================================================================
// AC-STE-665.8 — a real render of a lavfi fixture, then QA
// ===========================================================================

function ffmpegSync(args: string[], cwd: string): void {
  const p = Bun.spawnSync(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (p.exitCode !== 0) throw new Error(`fixture ffmpeg failed (${p.exitCode}): ${p.stderr.toString()}`);
}

/** test pattern + sine, `seconds` long, at `out` (relative to cwd). */
function lavfiClip(cwd: string, out: string, seconds: number): void {
  mkdirSync(join(cwd, out, ".."), { recursive: true });
  ffmpegSync(
    [
      "-f", "lavfi", "-i", `testsrc=duration=${seconds}:size=320x240:rate=25`,
      "-f", "lavfi", "-i", `sine=frequency=440:duration=${seconds}`,
      "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", out,
    ],
    cwd,
  );
}

const numbersIn = (s: string): number[] => (s.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);

describe("AC-STE-665.8 — a real render passes QA and leaves one still per punchline", () => {
  test("AC-STE-665.8 ffmpeg and ffprobe are on PATH on the gate machine", () => {
    expect(Bun.which("ffmpeg")).not.toBeNull();
    expect(Bun.which("ffprobe")).not.toBeNull();
  });

  test(
    "AC-STE-665.8 a two-second lavfi fixture renders to final.mp4 that QA accepts, with a still per anchor",
    async () => {
      const { parseEdl } = await load(MOD.edl);
      const { renderVideo } = await load(MOD.render);
      const { qaRender } = await load(MOD.qa);
      const workDir = makeTmpRoot("ste665-real-");
      lavfiClip(workDir, "clips/pattern.mp4", 2);
      mkdirSync(join(workDir, "segments"), { recursive: true });
      ffmpegSync(["-f", "lavfi", "-i", "sine=frequency=330:duration=2", "segments/1.wav"], workDir);
      const edl = parseEdl(
        JSON.stringify({
          edl_version: 1,
          clips: [{ src: "clips/pattern.mp4", in: 0, out: 2 }],
          voice: [{ segment: 1, audio: "segments/1.wav", offset: 0 }],
          anchors: [
            { name: "setup", at: 0.5 },
            { name: "punchline", at: 1.5 },
          ],
        }),
      );
      const res = await renderVideo({ edl, style: style({ banned_effects: ["slow_zoom", "ken_burns"] }), workDir });
      expect(res.output).toBe(join(workDir, "final.mp4"));
      expect(existsSync(res.output)).toBe(true);
      expect(statSync(res.output).size).toBeGreaterThan(0);

      const qa = await qaRender({ workDir, edl });
      expect(qa.reasons).toEqual([]);
      expect(qa.ok).toBe(true);
      const qaDir = join(workDir, "qa");
      const stills = readdirSync(qaDir).filter((f) => /\.(png|jpe?g)$/i.test(f));
      expect(stills).toHaveLength(2);
      expect(stills.some((f) => f.includes("setup"))).toBe(true);
      expect(stills.some((f) => f.includes("punchline"))).toBe(true);
      for (const f of stills) expect(statSync(join(qaDir, f)).size).toBeGreaterThan(0);
      expect(qa.stills.map((p: string) => basename(p)).sort()).toEqual([...stills].sort());
    },
    120_000,
  );

  test(
    "AC-STE-665.8 a fixture 50% longer than the edit list fails QA naming both durations",
    async () => {
      const { parseEdl } = await load(MOD.edl);
      const { qaRender } = await load(MOD.qa);
      const workDir = makeTmpRoot("ste665-real-long-");
      lavfiClip(workDir, "final.mp4", 3);
      const edl = parseEdl(
        JSON.stringify({
          edl_version: 1,
          clips: [{ src: "clips/pattern.mp4", in: 0, out: 2 }],
          anchors: [{ name: "punchline", at: 1 }],
        }),
      );
      const qa = await qaRender({ workDir, edl });
      expect(qa.ok).toBe(false);
      const durationReason = qa.reasons.find((r: string) => /duration/i.test(r));
      expect(durationReason, qa.reasons.join("\n")).toBeDefined();
      const nums = numbersIn(durationReason!);
      expect(nums.some((n) => Math.abs(n - 2) < 0.05), durationReason).toBe(true);
      expect(nums.some((n) => Math.abs(n - 3) < 0.1), durationReason).toBe(true);
    },
    120_000,
  );
});

// ===========================================================================
// AC-STE-665.9 — mutation verification in a temp overlay
// ===========================================================================

interface OverlayRun {
  code: number;
  output: string;
  mutatedSource: string | null;
}

/**
 * Materialise a temp overlay of the plugin (adapters/_shared/src, this suite, its
 * fixtures, the sited-mutation helper), optionally mutate one module IN THE
 * OVERLAY, assert the mutation landed, and run this suite filtered to `filter`.
 * The working tree is never touched.
 */
function runOverlay(
  filter: string,
  mutation: { moduleRel: string; find: string; repl: string; marker: string } | null,
): OverlayRun {
  const root = makeTmpRoot("ste665-overlay-");
  const plugin = join(root, "plugins", "dev-process-toolkit");
  mkdirSync(join(plugin, "adapters", "_shared"), { recursive: true });
  mkdirSync(join(plugin, "tests", "fixtures"), { recursive: true });
  const copy = Bun.spawnSync(
    [
      "bash",
      "-c",
      [
        "set -e",
        `cp -R ${JSON.stringify(join(PLUGIN_ROOT, "adapters", "_shared", "src"))} ${JSON.stringify(join(plugin, "adapters", "_shared"))}/`,
        `cp ${JSON.stringify(join(PLUGIN_ROOT, THIS_FILE_REL))} ${JSON.stringify(join(plugin, "tests"))}/`,
        `cp ${JSON.stringify(join(PLUGIN_ROOT, "tests", "_sited-mutation.ts"))} ${JSON.stringify(join(plugin, "tests"))}/`,
        `cp ${JSON.stringify(join(PLUGIN_ROOT, "tests", "_nested_bun_test.ts"))} ${JSON.stringify(join(plugin, "tests"))}/`,
        `cp -R ${JSON.stringify(FIXTURES)} ${JSON.stringify(join(plugin, "tests", "fixtures"))}/`,
      ].join("; "),
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (copy.exitCode !== 0) {
    throw new Error(`overlay copy failed (exit ${copy.exitCode}): ${copy.stderr.toString().trim()}`);
  }
  if (existsSync(join(REPO_ROOT, "node_modules"))) {
    symlinkSync(join(REPO_ROOT, "node_modules"), join(root, "node_modules"));
  }

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
  }

  const proc = runNestedBunTest([THIS_FILE_REL, "-t", filter], { cwd: plugin });
  return {
    code: proc.exitCode,
    output: `${proc.stdout}\n${proc.stderr}`,
    mutatedSource,
  };
}

const failedRow = (run: OverlayRun, name: string): boolean =>
  run.output.split("\n").some((l) => l.startsWith("(fail)") && l.includes(name));
/**
 * Summary counts ("N pass" / "N fail"). Bun prints these in every environment,
 * whereas "(pass)" rows are suppressed when it detects an agent session
 * (CLAUDECODE=1) — so the controls grade on counts, never on pass rows.
 * "(fail)" rows are printed in both modes.
 */
const count = (run: OverlayRun, kind: "pass" | "fail"): number => {
  const m = run.output.match(new RegExp(`^\\s*(\\d+) ${kind}\\b`, "m"));
  return m === null ? -1 : Number.parseInt(m[1]!, 10);
};

// Built by concatenation so these titles never match their own inner filter.
const BAN_TARGET = "AC-STE-665." + "4";
const CACHE_TARGET = "AC-STE-665." + "5";

describe("AC-STE-665.9 — the banned-effect check and the text hash are mutation-verified", () => {
  test(
    "control: the unmutated overlay passes the banned-effect tests",
    () => {
      const run = runOverlay(BAN_TARGET, null);
      // Non-vacuous: a filter matching zero tests also exits 0.
      expect(count(run, "pass"), run.output.slice(-800)).toBeGreaterThan(0);
      expect(count(run, "fail"), run.output.slice(-800)).toBe(0);
      expect(failedRow(run, BAN_TARGET)).toBe(false);
      expect(run.code).toBe(0);
    },
    120_000,
  );

  test(
    "removing the banned-effect check turns the banned-effect tests red",
    () => {
      const marker = "/* MUTATION:STE-665.9:no-banned-check */";
      const run = runOverlay(BAN_TARGET, {
        moduleRel: "adapters/_shared/src/video/ffmpeg_args.ts",
        find: "export function checkBannedEffects(",
        repl:
          `export function checkBannedEffects(..._args: any[]): void { ${marker} }\n` +
          "function __unmutated_checkBannedEffects(",
        marker,
      });
      expect(run.mutatedSource).toContain(marker);
      expect(failedRow(run, BAN_TARGET), run.output.slice(-800)).toBe(true);
      expect(count(run, "fail")).toBeGreaterThan(0);
      expect(run.code).not.toBe(0);
    },
    120_000,
  );

  test(
    "control: the unmutated overlay passes the stage-cache tests",
    () => {
      const run = runOverlay(CACHE_TARGET, null);
      expect(count(run, "pass"), run.output.slice(-800)).toBeGreaterThan(0);
      expect(count(run, "fail"), run.output.slice(-800)).toBe(0);
      expect(failedRow(run, CACHE_TARGET)).toBe(false);
      expect(run.code).toBe(0);
    },
    120_000,
  );

  test(
    "hashing without the segment text turns the stage-cache tests red",
    () => {
      const marker = "/* MUTATION:STE-665.9:no-text-hash */";
      const run = runOverlay(CACHE_TARGET, {
        moduleRel: "adapters/_shared/src/video/pipeline.ts",
        find: "export function ttsStageInputs(",
        repl:
          `export function ttsStageInputs(segment: any, voice: any): Record<string, unknown> { ${marker} return { index: segment.index, voice }; }\n` +
          "function __unmutated_ttsStageInputs(",
        marker,
      });
      expect(run.mutatedSource).toContain(marker);
      expect(failedRow(run, CACHE_TARGET), run.output.slice(-800)).toBe(true);
      expect(count(run, "fail")).toBeGreaterThan(0);
      expect(run.code).not.toBe(0);
    },
    120_000,
  );
});

// ===========================================================================
// HARDEN-A — AC-STE-665.2 / Requirement "Anchor cuts": buildFfmpegArgs PLACES an anchored clip
// ===========================================================================
//
// Placement rule pinned here (documented for the implementer):
//   buildFfmpegArgs(edl, style, alignments?) — a clip whose `at` resolves to T
//   (a number, or `{ segment, word }` via resolveAnchor + alignments) STARTS at T
//   on the output timeline. The clip before it is fitted to end exactly at T:
//     * it ends before T  -> its last frame is HELD: its chain gains
//       `tpad=stop_mode=clone:stop_duration=<T - its natural end>`;
//     * it would run past T -> it is TRIMMED short: `trim=start=<in>:end=<in + (T - its start)>`.
//   The programme length (`-t`) is the anchored clip's start T plus its (out - in)
//   when it is the last clip. Clips with no `at` keep the existing behaviour, so the
//   three AC-STE-665.3 snapshots (none of whose fixture clips carry `at`) are unchanged.

/** The `[i:v]` chain of the filter graph in `args`. */
function videoChain(args: string[], i: number): string {
  const graph = args[args.indexOf("-filter_complex") + 1] ?? "";
  return graph.split(";").find((s) => s.startsWith(`[${i}:v]`)) ?? "";
}
const argAfter = (args: string[], flag: string): string | undefined => args[args.indexOf(flag) + 1];

describe("HARDEN-A — an anchored clip starts at its resolved time on the output timeline", () => {
  const ALIGN = { 1: SEG1_ALIGN, 2: SEG2_ALIGN };

  test("HARDEN-A control: no snapshot fixture clip carries `at` (the snapshots stay as pinned)", () => {
    for (const name of SNAPSHOT_CASES) {
      const doc = JSON.parse(readFixture(`${name}.edl.json`));
      expect(doc.clips.some((c: any) => "at" in c), name).toBe(false);
    }
  });

  test("HARDEN-A word anchor in a gap: the previous clip is held until the word's start", async () => {
    const { parseEdl } = await load(MOD.edl);
    const { buildFfmpegArgs } = await load(MOD.args);
    const edl = parseEdl(readFixture("anchored.edl.json"));
    // T = segment 2 word 5 start (1.55) + segment 2 offset (2.5) = 4.05; intro ends at 2 -> hold 2.05s.
    const args: string[] = buildFfmpegArgs(edl, style(), ALIGN);
    expect(videoChain(args, 0)).toContain("tpad=stop_mode=clone:stop_duration=2.05");
    expect(videoChain(args, 1)).toContain("trim=start=1:end=4");
    expect(videoChain(args, 1)).not.toContain("tpad");
    expect(argAfter(args, "-t")).toBe("7.05");
    expect(args[args.length - 1]).toBe("final.mp4");
  });

  test("HARDEN-A a numeric `at` places the clip the same way as the word that resolves to it", async () => {
    const { parseEdl } = await load(MOD.edl);
    const { buildFfmpegArgs } = await load(MOD.args);
    const doc = JSON.parse(readFixture("anchored.edl.json"));
    const byWord: string[] = buildFfmpegArgs(parseEdl(JSON.stringify(doc)), style(), ALIGN);
    doc.clips[1].at = 4.05;
    const bySeconds: string[] = buildFfmpegArgs(parseEdl(JSON.stringify(doc)), style());
    expect(JSON.stringify(bySeconds)).toBe(JSON.stringify(byWord));
    // ...and differs from the same edit list with no `at` at all.
    delete doc.clips[1].at;
    const unplaced: string[] = buildFfmpegArgs(parseEdl(JSON.stringify(doc)), style());
    expect(JSON.stringify(unplaced)).not.toBe(JSON.stringify(byWord));
  });

  test("HARDEN-A a word earlier than the previous clip's end trims that clip short", async () => {
    const { parseEdl } = await load(MOD.edl);
    const { buildFfmpegArgs } = await load(MOD.args);
    const doc = JSON.parse(readFixture("anchored.edl.json"));
    doc.clips[1].at = { segment: 1, word: 2 }; // "today" starts at 0.7 + offset 0
    const args: string[] = buildFfmpegArgs(parseEdl(JSON.stringify(doc)), style(), ALIGN);
    expect(videoChain(args, 0)).toContain("trim=start=0:end=0.7");
    expect(videoChain(args, 0)).not.toContain("tpad");
    expect(argAfter(args, "-t")).toBe("3.7");
  });

  test("HARDEN-A a word anchor with no alignment for its segment refuses naming the segment", async () => {
    const { parseEdl } = await load(MOD.edl);
    const { buildFfmpegArgs } = await load(MOD.args);
    const edl = parseEdl(readFixture("anchored.edl.json"));
    const msg = await refusal(() => buildFfmpegArgs(edl, style(), { 1: SEG1_ALIGN }));
    expectNfr10(msg);
    expect(msg).toMatch(/segment 2\b/);
  });
});

// ===========================================================================
// HARDEN-K — captions need ffmpeg's `drawtext` filter: preflight before any stage
// ===========================================================================

const FILTERS_WITHOUT_DRAWTEXT = [
  "Filters:",
  " ... trim              V->V       Pick one continuous section from the input, drop the rest.",
  " ... scale             V->V       Scale the input video size and/or convert the image format.",
  " ... concat            N->N       Concatenate audio and video streams.",
  " ... adelay            A->A       Delay one or more audio channels.",
  "",
].join("\n");
const FILTERS_WITH_DRAWTEXT = `${FILTERS_WITHOUT_DRAWTEXT} T.C drawtext          V->V       Draw text on top of video frames using libfreetype library.\n`;

/** A runner that answers `ffmpeg -filters` with `listing` and fakes every other ffmpeg call. */
function filtersRunner(listing: string): { runner: (argv: string[], opts: { cwd: string }) => Promise<any>; calls: RunnerCall[] } {
  const calls: RunnerCall[] = [];
  const runner = async (argv: string[], opts: { cwd: string }) => {
    calls.push({ argv: [...argv], cwd: opts.cwd });
    if (argv.includes("-filters")) return { code: 0, stdout: listing, stderr: "" };
    if (basename(argv[0] ?? "") === "ffmpeg") {
      const out = join(opts.cwd, argv[argv.length - 1]!);
      mkdirSync(join(out, ".."), { recursive: true });
      writeFileSync(out, "fake render");
    }
    return { code: 0, stdout: "", stderr: "" };
  };
  return { runner, calls };
}
const renderCalls = (calls: RunnerCall[]): RunnerCall[] => calls.filter((c) => c.argv[c.argv.length - 1] === "final.mp4");

describe("HARDEN-K — captions on and no `drawtext` filter refuses before any stage runs", () => {
  test("HARDEN-K renderVideo refuses naming drawtext and an install remedy; ffmpeg never renders", async () => {
    const { parseEdl } = await load(MOD.edl);
    const { renderVideo } = await load(MOD.render);
    const workDir = makeTmpRoot("ste665-drawtext-");
    const { runner, calls } = filtersRunner(FILTERS_WITHOUT_DRAWTEXT);
    const msg = await refusal(
      renderVideo({ edl: parseEdl(readFixture("voice-captions.edl.json")), style: style(), workDir, runner, which: whichAll }),
    );
    expectNfr10(msg);
    expect(msg).toContain("drawtext");
    expect(msg.split("\n").find((l) => l.startsWith("Remedy:"))).toMatch(/install/i);
    expect(calls.some((c) => c.argv.includes("-filters"))).toBe(true);
    expect(renderCalls(calls)).toEqual([]);
    expect(existsSync(join(workDir, "final.mp4"))).toBe(false);
  });

  test("HARDEN-K runVideoPipeline refuses before any TTS stage when captions need drawtext", async () => {
    const { parseEdl } = await load(MOD.edl);
    const { runVideoPipeline } = await load(MOD.pipeline);
    const { readStageManifest } = await load(MOD.cache);
    const projectRoot = makeTmpRoot("ste665-drawtext-pipe-");
    const slug = "render-demo";
    const { tts, calls: ttsCalls } = fakeTts(projectRoot, slug);
    const { runner, calls } = filtersRunner(FILTERS_WITHOUT_DRAWTEXT);
    const doc = JSON.parse(pipelineEdlText());
    doc.captions = [{ text: "Meet", start: 0, end: 1 }];
    const msg = await refusal(
      runVideoPipeline({
        projectRoot,
        slug,
        segments: SEGMENTS,
        voice: VOICE,
        tts,
        edl: parseEdl(JSON.stringify(doc)),
        style: style(),
        runner,
        which: whichAll,
      }),
    );
    expectNfr10(msg);
    expect(msg).toContain("drawtext");
    expect(ttsCalls).toEqual([]);
    expect(renderCalls(calls)).toEqual([]);
    expect(Object.keys(readStageManifest(videoWorkDir(projectRoot, slug)).stages)).toEqual([]);
  });

  test("HARDEN-K control: a listing with drawtext renders once", async () => {
    const { parseEdl } = await load(MOD.edl);
    const { renderVideo } = await load(MOD.render);
    const workDir = makeTmpRoot("ste665-drawtext-ok-");
    const { runner, calls } = filtersRunner(FILTERS_WITH_DRAWTEXT);
    await renderVideo({ edl: parseEdl(readFixture("voice-captions.edl.json")), style: style(), workDir, runner, which: whichAll });
    expect(renderCalls(calls)).toHaveLength(1);
  });

  test("HARDEN-K control: captions disabled needs no filter check and renders once", async () => {
    const { parseEdl } = await load(MOD.edl);
    const { renderVideo } = await load(MOD.render);
    const workDir = makeTmpRoot("ste665-drawtext-off-");
    const { runner, calls } = filtersRunner(FILTERS_WITHOUT_DRAWTEXT);
    await renderVideo({
      edl: parseEdl(readFixture("voice-captions.edl.json")),
      style: style({ captions: { enabled: false, position: "bottom" } }),
      workDir,
      runner,
      which: whichAll,
    });
    expect(calls.some((c) => c.argv.includes("-filters"))).toBe(false);
    expect(renderCalls(calls)).toHaveLength(1);
  });
});

// ===========================================================================
// FIX-1 — round-2 review: a banned effect refuses before ffmpeg runs AT ALL,
// even with captions on (the drawtext preflight is an ffmpeg call too).
// Titles avoid the literal AC id so the AC-STE-665.9 overlay filter is unchanged.
// ===========================================================================

function captionedZoompanDoc(): any {
  const doc = JSON.parse(pipelineEdlText());
  doc.clips[0].effects = ["zoompan"];
  doc.captions = [{ text: "Meet", start: 0, end: 1 }];
  return doc;
}

describe("FIX-1 — captions on + a banned effect: refuses with the runner recording no call", () => {
  test("FIX-1 renderVideo refuses on the banned effect before any runner call (not even `ffmpeg -filters`)", async () => {
    const { parseEdl } = await load(MOD.edl);
    const { renderVideo } = await load(MOD.render);
    const workDir = makeTmpRoot("ste665-fix1-");
    const { runner, calls } = filtersRunner(FILTERS_WITH_DRAWTEXT);
    const msg = await refusal(
      renderVideo({
        edl: parseEdl(JSON.stringify(captionedZoompanDoc())),
        style: style({ banned_effects: ["slow_zoom"] }),
        workDir,
        runner,
        which: whichAll,
      }),
    );
    expectNfr10(msg);
    expect(msg).toContain("zoompan");
    expect(msg).toContain("slow_zoom");
    expect(calls).toEqual([]);
    expect(existsSync(join(workDir, "final.mp4"))).toBe(false);
  });

  test("FIX-1 runVideoPipeline refuses on the banned effect before any runner call (not even `ffmpeg -filters`)", async () => {
    const { parseEdl } = await load(MOD.edl);
    const { runVideoPipeline } = await load(MOD.pipeline);
    const projectRoot = makeTmpRoot("ste665-fix1-pipe-");
    const slug = "render-demo";
    const { tts } = fakeTts(projectRoot, slug);
    const { runner, calls } = filtersRunner(FILTERS_WITH_DRAWTEXT);
    const msg = await refusal(
      runVideoPipeline({
        projectRoot,
        slug,
        segments: SEGMENTS,
        voice: VOICE,
        tts,
        edl: parseEdl(JSON.stringify(captionedZoompanDoc())),
        style: style({ banned_effects: ["ken_burns"] }),
        runner,
        which: whichAll,
      }),
    );
    expectNfr10(msg);
    expect(msg).toContain("zoompan");
    expect(msg).toContain("ken_burns");
    expect(calls).toEqual([]);
    expect(existsSync(join(videoWorkDir(projectRoot, slug), "final.mp4"))).toBe(false);
  });

  test("FIX-1 control: nothing banned, captions on — the drawtext preflight runs and the render runs once", async () => {
    const { parseEdl } = await load(MOD.edl);
    const { renderVideo } = await load(MOD.render);
    const workDir = makeTmpRoot("ste665-fix1-ctl-");
    const { runner, calls } = filtersRunner(FILTERS_WITH_DRAWTEXT);
    await renderVideo({
      edl: parseEdl(JSON.stringify(captionedZoompanDoc())),
      style: style({ banned_effects: [] }),
      workDir,
      runner,
      which: whichAll,
    });
    expect(calls.some((c) => c.argv.includes("-filters"))).toBe(true);
    expect(renderCalls(calls)).toHaveLength(1);
  });
});
