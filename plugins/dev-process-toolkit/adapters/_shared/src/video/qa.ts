// STE-665 — render QA: probe `final.mp4` and leave one still per punchline anchor.
//
// `qaRender` asks ffprobe for the streams and duration of `workDir/final.mp4`,
// requires one video and one audio stream and a duration within 5% of the edit
// list's, then extracts one still per anchor into `workDir/qa/` (the filename
// carries the anchor name).

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { anchorSeconds, placedDuration } from "./anchors";
import type { Edl } from "./edl";
import { defaultRunner, probeMedia, requireRenderBinaries, type Runner, type Which } from "./render";
import type { WordTiming } from "./tts";

/** Allowed relative difference between the rendered and the edit-list duration. */
export const DURATION_TOLERANCE = 0.05;

export async function qaRender(opts: {
  workDir: string;
  edl: Edl;
  runner?: Runner;
  which?: Which;
  alignments?: Record<number, WordTiming[]>;
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
