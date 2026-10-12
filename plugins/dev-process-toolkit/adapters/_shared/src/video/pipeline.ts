// STE-665 — the cached render pipeline: one TTS stage per segment, then the render.
//
// Stages are "tts:<n>" (n = the 1-based segment index) and "render". The render
// stage's key names every TTS stage key, so a changed segment re-runs its own
// TTS stage and the render, and nothing else.

import { videoWorkDir } from "../dpt_paths";
import { readAlignments } from "./anchors";
import type { Edl } from "./edl";
import { checkBannedEffects } from "./ffmpeg_args";
import { renderVideo, requireCaptionFilter, requireRenderBinaries, type Runner, type Which } from "./render";
import { runCachedStage, stageKey } from "./stage_cache";
import type { VideoStyle } from "./style";
import type { TtsProvider, TtsSegment } from "./tts";

export interface VoiceSpec {
  provider: string;
  voice: string;
  model?: string;
}

const TTS_STAGE_VERSION = 1;
const RENDER_STAGE_VERSION = 1;

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
    inputs: { edl: opts.edl, style: opts.style, tts: ttsKeys },
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
