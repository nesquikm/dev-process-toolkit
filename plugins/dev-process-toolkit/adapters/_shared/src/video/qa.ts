// STE-665 — render QA: probe `final.mp4` and leave one still per punchline anchor.
//
// `qaRender` asks ffprobe for the streams and duration of `workDir/final.mp4`,
// requires one video and one audio stream and a duration within 5% of the edit
// list's, then extracts one still per anchor into `workDir/qa/` (the filename
// carries the anchor name). It also measures the cut's integrated loudness
// (ffmpeg `ebur128`) and fails when it is more than LOUDNESS_TOLERANCE_LU
// from the target (AC-STE-674.7).

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { anchorSeconds, placedDuration } from "./anchors";
import type { Edl } from "./edl";
import { defaultRunner, probeMedia, requireRenderBinaries, type Runner, type Which } from "./render";
import { VIDEO_STYLE_DEFAULTS } from "./style";
import type { WordTiming } from "./tts";

/** Allowed relative difference between the rendered and the edit-list duration. */
export const DURATION_TOLERANCE = 0.05;

/** Allowed distance, in LU, between the measured integrated loudness and the target. */
export const LOUDNESS_TOLERANCE_LU = 1;

/** ebur128's absolute gate: a track measuring at or below this is silence. */
export const SILENCE_LUFS = -70;

/** The integrated loudness (LUFS) from an `ebur128` run's summary, or null when absent. */
export function parseIntegratedLoudness(stderr: string): number | null {
  const matches = [...stderr.matchAll(/\bI:\s+(-?\d+(?:\.\d+)?|-inf)\s+LUFS/g)];
  const last = matches[matches.length - 1];
  if (!last) return null;
  return last[1] === "-inf" ? Number.NEGATIVE_INFINITY : Number(last[1]);
}

export async function qaRender(opts: {
  workDir: string;
  edl: Edl;
  runner?: Runner;
  which?: Which;
  alignments?: Record<number, WordTiming[]>;
  targetLufs?: number;
}): Promise<{ ok: boolean; reasons: string[]; stills: string[] }> {
  const runner = opts.runner ?? defaultRunner;
  const { ffmpeg, ffprobe } = requireRenderBinaries(opts.which);
  const reasons: string[] = [];
  const stills: string[] = [];

  const probe = await probeMedia(runner, ffprobe, "final.mp4", opts.workDir);
  if (!probe.ok) {
    reasons.push(`ffprobe could not read final.mp4 (exit ${probe.code}): ${probe.stderr.trim()}`);
    return { ok: false, reasons, stills };
  }
  const videos = probe.streams.filter((s) => s.codec_type === "video").length;
  const audios = probe.streams.filter((s) => s.codec_type === "audio").length;
  if (videos !== 1) reasons.push(`expected one video stream in final.mp4, found ${videos}`);
  if (audios !== 1) reasons.push(`expected one audio stream in final.mp4, found ${audios}`);

  const expected = placedDuration(opts.edl, opts.alignments);
  const actual = probe.duration;
  if (!Number.isFinite(actual)) {
    reasons.push("final.mp4 duration is unreadable");
  } else if (Math.abs(actual - expected) > expected * DURATION_TOLERANCE) {
    reasons.push(
      `duration mismatch: final.mp4 runs ${actual.toFixed(3)}s but the edit list runs ${expected.toFixed(3)}s (tolerance ${DURATION_TOLERANCE * 100}%)`,
    );
  }

  const target = opts.targetLufs ?? VIDEO_STYLE_DEFAULTS.loudness.target_lufs;
  if (audios > 0) {
    const meter = await runner(
      [ffmpeg, "-hide_banner", "-nostats", "-i", "final.mp4", "-map", "0:a:0", "-af", "ebur128", "-f", "null", "-"],
      { cwd: opts.workDir },
    );
    const integrated = meter.code === 0 ? parseIntegratedLoudness(meter.stderr) : null;
    // A clips-only cut (no voice, no music) carries the renderer's silent track,
    // which loudnorm never touched and no target can describe.
    const silentByDesign =
      opts.edl.voice.length === 0 && opts.edl.music === null && integrated !== null && integrated <= SILENCE_LUFS;
    if (silentByDesign) {
      // nothing a loudness target can describe
    } else if (integrated === null) {
      reasons.push(`could not measure the loudness of final.mp4 (exit ${meter.code}) against the ${target} LUFS target`);
    } else if (!(Math.abs(integrated - target) <= LOUDNESS_TOLERANCE_LU)) {
      reasons.push(
        `loudness off target: final.mp4 measures ${integrated} LUFS integrated but the target is ${target} LUFS (tolerance ${LOUDNESS_TOLERANCE_LU} LU)`,
      );
    }
  }

  if (opts.edl.anchors.length > 0) mkdirSync(join(opts.workDir, "qa"), { recursive: true });
  for (const anchor of opts.edl.anchors) {
    const at = anchorSeconds(anchor.at, opts.edl, opts.alignments);
    const safe = anchor.name.replace(/[^A-Za-z0-9._-]/g, "_");
    const rel = join("qa", `${safe}.png`);
    const res = await runner(
      [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-ss", String(at), "-i", "final.mp4", "-frames:v", "1", rel],
      { cwd: opts.workDir },
    );
    if (res.code !== 0) {
      reasons.push(`could not extract the still for anchor "${anchor.name}" at ${at}s: ${res.stderr.trim()}`);
      continue;
    }
    stills.push(join(opts.workDir, rel));
  }

  return { ok: reasons.length === 0, reasons, stills };
}
