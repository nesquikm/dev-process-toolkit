// STE-669 — front door for the video stage pipeline (AC-STE-669.3).
//
//   bun run video_pipeline.ts <projectRoot> <slug> <stage>
//
// Stages, in pipeline order: script, approve-script, voice, record, music, edl,
// render, qa. Every stage after `script` is refused (NFR-10 shape) unless the
// approval record in the work dir carries the SHA-256 of the current
// `script.md`. `approve-script` writes that record.
//
// In-process: `runVideoStage({ projectRoot, slug, stage, handlers?, deps? })`. A
// refusal rejects with an NFR-10 shaped Error. `handlers` replaces a stage's
// real work (providers, recorders, ffmpeg runner) — the test seam. `deps`
// keeps the real handlers but swaps their I/O: `fetch` for every provider call,
// `runner` + `which` for ffmpeg/ffprobe.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { videoConfigPath, videoWorkDir } from "./dpt_paths";
import { readAlignments } from "./video/anchors";
import { parseVideoConfig, type VideoConfig } from "./video/config";
import { parseEdl, type Edl } from "./video/edl";
import { readVideoKeys } from "./video/keys";
import { resolveMusicTrack } from "./video/music";
import { runTtsStages, runVideoPipeline, type VoiceSpec } from "./video/pipeline";
import { qaRender } from "./video/qa";
import { readVideoStyle } from "./video/style";
import { type FootageMapping, recordShot, type Shot } from "./video/recorder";
import { nfr10Refusal as refusal } from "./video/shape";
import { defaultRunner, type Runner, type Which } from "./video/render";
import type { FetchFn, TtsProvider, TtsSegment, WordTiming } from "./video/tts";
import { createElevenLabsTts } from "./video/tts_elevenlabs";
import { createGoogleTts } from "./video/tts_google";
import { PROVIDER_KEY, videoReadiness } from "./video/readiness";

export const VIDEO_STAGES = ["script", "approve-script", "voice", "record", "music", "edl", "render", "qa"] as const;
export type VideoStage = (typeof VIDEO_STAGES)[number];

/** The approval record's file name inside the work dir. */
export const APPROVAL_RECORD_FILE = "script-approval.json";

/** Work-dir inputs the session writes before the stages that read them. */
const SCRIPT_FILE = "script.md";
const SEGMENTS_FILE = "segments.json";
const SHOTS_FILE = "shots.json";
const EDL_FILE = "edl.json";

/** The I/O the default handlers use; each absent entry falls back to the live one. */
export interface VideoStageDeps {
  fetch?: FetchFn;
  runner?: Runner;
  which?: Which;
}

export interface StageContext {
  projectRoot: string;
  slug: string;
  workDir: string;
  deps: VideoStageDeps;
}

export type StageHandler = (ctx: StageContext) => Promise<void>;

/** The NFR-10 Context line every stage refusal carries. */
function stageLine(stage: string, slug: string): string {
  return `stage=${stage}, slug=${slug}`;
}

function sha256Hex(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function scriptPath(workDir: string): string {
  return join(workDir, SCRIPT_FILE);
}

/** The hash an approval record carries, or null when there is no readable record. */
function recordedHash(workDir: string): string | null {
  const path = join(workDir, APPROVAL_RECORD_FILE);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as { sha256?: unknown };
    return typeof parsed.sha256 === "string" ? parsed.sha256 : null;
  } catch {
    return null;
  }
}

/** Refuse when the session has not written script.md yet; returns its path. */
function requireScript(ctx: StageContext, stage: string, reason: string, remedy: string): string {
  const script = scriptPath(ctx.workDir);
  if (!existsSync(script)) throw refusal(reason, remedy, stageLine(stage, ctx.slug));
  return script;
}

function approveScript(ctx: StageContext): void {
  const script = requireScript(
    ctx,
    "approve-script",
    `no ${SCRIPT_FILE} to approve for video "${ctx.slug}".`,
    `write the script to ${SCRIPT_FILE} in the work dir, then re-run approve-script.`,
  );
  mkdirSync(ctx.workDir, { recursive: true });
  const record = { sha256: sha256Hex(script), approvedAt: new Date().toISOString() };
  writeFileSync(join(ctx.workDir, APPROVAL_RECORD_FILE), `${JSON.stringify(record, null, 2)}\n`);
}

function requireApproval(ctx: StageContext, stage: string): void {
  const script = scriptPath(ctx.workDir);
  const recorded = recordedHash(ctx.workDir);
  const ctxLine = stageLine(stage, ctx.slug);
  if (recorded === null) {
    throw refusal(
      `stage "${stage}" runs only after the script is approved, and no approval record exists.`,
      "review script.md, then run the approve-script stage.",
      ctxLine,
    );
  }
  if (!existsSync(script) || sha256Hex(script) !== recorded) {
    throw refusal(
      `script.md changed since it was approved; stage "${stage}" would run on an unapproved script.`,
      "review the edited script.md, then re-run the approve-script stage.",
      ctxLine,
    );
  }
}

// ---------------------------------------------------------------------------
// default (real) stage handlers — the work-dir inputs the session writes
// ---------------------------------------------------------------------------

function readWorkJson<T>(ctx: StageContext, file: string, stage: string): T {
  const path = join(ctx.workDir, file);
  if (!existsSync(path)) {
    throw refusal(
      `stage "${stage}" needs ${file} in the work dir, and it is missing.`,
      `write ${file} to the work dir, then re-run the stage.`,
      stageLine(stage, ctx.slug),
    );
  }
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

function readConfig(projectRoot: string): VideoConfig {
  return parseVideoConfig(readFileSync(videoConfigPath(projectRoot), "utf-8"));
}

function readEdl(ctx: StageContext, stage: string): Edl {
  return parseEdl(JSON.stringify(readWorkJson<unknown>(ctx, EDL_FILE, stage)));
}

/**
 * The voiced length the music stage plans for (it runs before the edit list
 * exists): the sum, over segments.json, of each segment's last word end in
 * `alignment/<index>.json`.
 */
function voicedSeconds(ctx: StageContext, stage: string): number {
  let total = 0;
  for (const seg of readWorkJson<TtsSegment[]>(ctx, SEGMENTS_FILE, stage)) {
    const words = readWorkJson<WordTiming[]>(ctx, join("alignment", `${seg.index}.json`), stage);
    total += words.length > 0 ? words[words.length - 1]!.end : 0;
  }
  return total;
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const liveFetch = (url: string, init: RequestInit): Promise<Response> => fetch(url, init);

function ttsProvider(ctx: StageContext, config: VideoConfig): TtsProvider {
  const keys = readVideoKeys(ctx.projectRoot);
  const opts = {
    apiKey: keys[PROVIDER_KEY[config.tts.provider]] ?? "",
    voice: config.tts.voice,
    model: config.tts.model,
    projectRoot: ctx.projectRoot,
    slug: ctx.slug,
    fetch: ctx.deps.fetch ?? liveFetch,
    wait,
  };
  return config.tts.provider === "google" ? createGoogleTts(opts) : createElevenLabsTts(opts);
}

function voiceSpec(config: VideoConfig): VoiceSpec {
  return { provider: config.tts.provider, voice: config.tts.voice, model: config.tts.model };
}

/** A shots.json entry: a Shot, optionally carrying its footage mapping (`file` relative to the footage dir). */
type ShotEntry = Shot & { footage?: FootageMapping[string] };

function footageMapping(shots: ShotEntry[]): FootageMapping {
  const mapping: FootageMapping = {};
  for (const shot of shots) if (shot.footage) mapping[shot.id] = shot.footage;
  return mapping;
}

const DEFAULT_HANDLERS: Record<string, StageHandler> = {
  // The script is written in the session; the stage only checks it is there.
  script: async (ctx) => {
    requireScript(ctx, "script", `no ${SCRIPT_FILE} for video "${ctx.slug}".`, `write the script to ${SCRIPT_FILE} in the work dir.`);
  },
  voice: async (ctx) => {
    const config = readConfig(ctx.projectRoot);
    // The same cached tts:<n> stages render runs, so render reuses what voice made.
    await runTtsStages({
      projectRoot: ctx.projectRoot,
      slug: ctx.slug,
      segments: readWorkJson<TtsSegment[]>(ctx, SEGMENTS_FILE, "voice"),
      voice: voiceSpec(config),
      tts: ttsProvider(ctx, config),
    });
  },
  record: async (ctx) => {
    const config = readConfig(ctx.projectRoot);
    const shots = readWorkJson<ShotEntry[]>(ctx, SHOTS_FILE, "record");
    const footage = footageMapping(shots);
    for (const { footage: _footage, ...shot } of shots) {
      await recordShot({
        projectRoot: ctx.projectRoot,
        slug: ctx.slug,
        shot,
        config: config.recorder,
        footage,
        runner: ctx.deps.runner,
        which: ctx.deps.which,
      });
    }
  },
  music: async (ctx) => {
    const config = readConfig(ctx.projectRoot);
    await resolveMusicTrack({
      music: config.music,
      projectRoot: ctx.projectRoot,
      slug: ctx.slug,
      plannedSeconds: voicedSeconds(ctx, "music"),
      // Only a generated track uses the prompt; `file` / `none` never read style.yaml.
      prompt: config.music.source === "elevenlabs" ? readVideoStyle(ctx.projectRoot).music.prompt : undefined,
      apiKey: readVideoKeys(ctx.projectRoot)[PROVIDER_KEY.elevenlabs],
      fetch: ctx.deps.fetch ?? liveFetch,
      wait,
    });
  },
  edl: async (ctx) => {
    readEdl(ctx, "edl");
  },
  render: async (ctx) => {
    const config = readConfig(ctx.projectRoot);
    await runVideoPipeline({
      projectRoot: ctx.projectRoot,
      slug: ctx.slug,
      segments: readWorkJson<TtsSegment[]>(ctx, SEGMENTS_FILE, "render"),
      voice: voiceSpec(config),
      tts: ttsProvider(ctx, config),
      edl: readEdl(ctx, "render"),
      style: readVideoStyle(ctx.projectRoot),
      runner: ctx.deps.runner ?? defaultRunner,
      which: ctx.deps.which,
    });
  },
  qa: async (ctx) => {
    const edl = readEdl(ctx, "qa");
    const result = await qaRender({
      workDir: ctx.workDir,
      edl,
      alignments: readAlignments(ctx.workDir, edl),
      runner: ctx.deps.runner,
      which: ctx.deps.which,
    });
    if (!result.ok) {
      throw refusal(
        `QA found ${result.reasons.length} problem(s) in final.mp4: ${result.reasons.join("; ")}`,
        "fix the edit list or the recordings, then re-run render and qa.",
        stageLine("qa", ctx.slug),
      );
    }
  },
};

/** Run one pipeline stage; rejects with an NFR-10 shaped Error on refusal. */
export async function runVideoStage(opts: {
  projectRoot: string;
  slug: string;
  stage: string;
  handlers?: Partial<Record<string, StageHandler>>;
  deps?: VideoStageDeps;
}): Promise<void> {
  const { projectRoot, slug, stage } = opts;
  const ctx: StageContext = { projectRoot, slug, workDir: videoWorkDir(projectRoot, slug), deps: opts.deps ?? {} };
  if (!(VIDEO_STAGES as readonly string[]).includes(stage)) {
    throw refusal(
      `unknown stage "${stage}".`,
      `use one of: ${VIDEO_STAGES.join(", ")}.`,
      stageLine(stage, slug),
    );
  }
  // Readiness first (AC-STE-669.5): a not-ready project refuses every stage
  // before any approval check, provider call or recording.
  const readiness = videoReadiness(projectRoot);
  if (!readiness.ready) {
    throw refusal(
      `the project is not ready to make videos:\n${readiness.reasons.map((r) => `  - ${r}`).join("\n")}`,
      "fix each reason above (or run `/video init`), then re-run the stage.",
      stageLine(stage, slug),
    );
  }
  if (stage === "approve-script") {
    approveScript(ctx);
    return;
  }
  if (stage !== "script") requireApproval(ctx, stage);
  const handler = opts.handlers?.[stage] ?? DEFAULT_HANDLERS[stage]!;
  await handler(ctx);
}

if (import.meta.main) {
  const [rootArg, slug = "", stage = ""] = process.argv.slice(2);
  const projectRoot = resolve(rootArg ?? process.cwd());
  try {
    await runVideoStage({ projectRoot, slug, stage });
    console.log(`Stage ${stage} done for video "${slug}".`);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}
