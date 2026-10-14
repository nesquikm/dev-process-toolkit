// STE-665 — the cached render pipeline: one TTS stage per segment, then the render.
//
// Stages are "tts:<n>" (n = the 1-based segment index) and "render". The render
// stage's key names every TTS stage key, so a changed segment re-runs its own
// TTS stage and the render, and nothing else.

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { videoWorkDir } from "../dpt_paths";
import { readAlignments } from "./anchors";
import type { Edl } from "./edl";
import { checkBannedEffects } from "./ffmpeg_args";
import { renderVideo, requireCaptionFilter, requireRenderBinaries, type Runner, type Which } from "./render";
import { runCachedStage, sha256File, stageKey } from "./stage_cache";
import type { VideoStyle } from "./style";
import type { TtsProvider, TtsSegment } from "./tts";

export interface VoiceSpec {
  provider: string;
  voice: string;
  model?: string;
}

const TTS_STAGE_VERSION = 1;
const RENDER_STAGE_VERSION = 2;

/** SHA-256 hex of a file's bytes, resolved against `workDir`; null when the file does not exist. */
function fileSha256(workDir: string, rel: string): string | null {
  const path = resolve(workDir, rel);
  if (!existsSync(path)) return null;
  return sha256File(path);
}

/**
 * The render stage's named key inputs: the EDL, the style, the TTS keys, and the
 * bytes of every clip, voice audio and music file the EDL references — so a file
 * rewritten under an unchanged edl.json re-runs the render.
 */
export function renderStageInputs(
  workDir: string,
  edl: Edl,
  style: VideoStyle,
  ttsKeys: Record<string, string>,
): Record<string, unknown> {
  const clip_bytes: Record<string, string | null> = {};
  for (const clip of edl.clips) clip_bytes[clip.src] = fileSha256(workDir, clip.src);
  const voice_bytes: Record<string, string | null> = {};
  for (const v of edl.voice) voice_bytes[v.audio] = fileSha256(workDir, v.audio);
  const music_bytes = edl.music ? fileSha256(workDir, edl.music.src) : null;
  return { edl, style, tts: ttsKeys, clip_bytes, voice_bytes, music_bytes };
}

/** The TTS stage's named key inputs. */
export function ttsStageInputs(segment: TtsSegment, voice: VoiceSpec): Record<string, unknown> {
  return { index: segment.index, text: segment.text, voice };
}

/**
 * The cached TTS stages alone: one "tts:<n>" stage per segment. The voice stage
 * runs these; `runVideoPipeline` runs the same stages, so a segment voiced by
 * either is skipped by the other.
 */
export async function runTtsStages(opts: {
  projectRoot: string;
  slug: string;
  segments: TtsSegment[];
  voice: VoiceSpec;
  tts: TtsProvider;
}): Promise<{ stages: Record<string, "ran" | "skipped">; ttsKeys: Record<string, string> }> {
  const workDir = videoWorkDir(opts.projectRoot, opts.slug);
  const stages: Record<string, "ran" | "skipped"> = {};
  const ttsKeys: Record<string, string> = {};
  for (const segment of opts.segments) {
    const name = `tts:${segment.index}`;
    const inputs = ttsStageInputs(segment, opts.voice);
    ttsKeys[name] = stageKey(name, TTS_STAGE_VERSION, inputs);
    stages[name] = await runCachedStage(workDir, {
      name,
      version: TTS_STAGE_VERSION,
      inputs,
      outputs: [`segments/${segment.index}.mp3`, `alignment/${segment.index}.json`],
      run: async () => {
        await opts.tts.synthesize(segment);
      },
    });
  }
  return { stages, ttsKeys };
}

export async function runVideoPipeline(opts: {
  projectRoot: string;
  slug: string;
  segments: TtsSegment[];
  voice: VoiceSpec;
  tts: TtsProvider;
  edl: Edl;
  style: VideoStyle;
  runner: Runner;
  which?: Which;
}): Promise<{ stages: Record<string, "ran" | "skipped"> }> {
  const { ffmpeg } = requireRenderBinaries(opts.which);
  checkBannedEffects(opts.edl, opts.style);
  await requireCaptionFilter(opts.runner, ffmpeg, opts.edl, opts.style, opts.projectRoot);
  const workDir = videoWorkDir(opts.projectRoot, opts.slug);
  const { stages, ttsKeys } = await runTtsStages(opts);

  stages["render"] = await runCachedStage(workDir, {
    name: "render",
    version: RENDER_STAGE_VERSION,
    inputs: renderStageInputs(workDir, opts.edl, opts.style, ttsKeys),
    outputs: ["final.mp4"],
    run: async () => {
      await renderVideo({
        edl: opts.edl,
        style: opts.style,
        workDir,
        runner: opts.runner,
        which: opts.which,
        alignments: readAlignments(workDir, opts.edl),
      });
    },
  });

  return { stages };
}
