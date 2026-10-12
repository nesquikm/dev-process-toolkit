// STE-665 — the renderer: one ffmpeg invocation over an edit list.
//
// `renderVideo` refuses when ffmpeg or ffprobe is missing, then runs the one
// banned-effect check (`checkBannedEffects`) before any runner call — even the
// captions `ffmpeg -filters` check — then makes ONE render call with
// cwd = workDir. The output is `workDir/final.mp4`.

import { join } from "node:path";
import type { Edl } from "./edl";
import { buildFfmpegArgs, checkBannedEffects } from "./ffmpeg_args";
import type { VideoStyle } from "./style";
import type { WordTiming } from "./tts";

export type Runner = (
  argv: string[],
  opts: { cwd: string },
) => Promise<{ code: number; stdout: string; stderr: string }>;
export type Which = (bin: string) => string | null;

export const defaultRunner: Runner = async (argv, opts) => {
  const proc = Bun.spawn(argv, { cwd: opts.cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
};

export const defaultWhich: Which = (bin) => Bun.which(bin);

function requireBinary(bin: string, which: Which): string {
  const path = which(bin);
  if (path) return path;
  throw new Error(
    [
      `Refusing: video render needs \`${bin}\`, which is not on PATH`,
      `Remedy: install ffmpeg (which ships ${bin}), e.g. \`brew install ffmpeg\` or \`apt-get install ffmpeg\`.`,
      `Context: mode=video-render, binary=${bin}`,
    ].join("\n"),
  );
}

/** Refuse (NFR-10) unless both ffmpeg and ffprobe are on PATH. Returns both paths. */
export function requireRenderBinaries(which: Which = defaultWhich): { ffmpeg: string; ffprobe: string } {
  return { ffmpeg: requireBinary("ffmpeg", which), ffprobe: requireBinary("ffprobe", which) };
}

/**
 * HARDEN-K: captions render through ffmpeg's `drawtext` filter, which an ffmpeg built
 * without libfreetype lacks. When captions are on and the edit list has any, ask
 * `ffmpeg -filters` and refuse (NFR-10) unless `drawtext` is listed. Captions off ⇒ no check.
 */
export async function requireCaptionFilter(
  runner: Runner,
  ffmpeg: string,
  edl: Edl,
  style: VideoStyle,
  cwd: string,
): Promise<void> {
  if (!style.captions.enabled || edl.captions.length === 0) return;
  const res = await runner([ffmpeg, "-hide_banner", "-filters"], { cwd });
  if (/^\s*\S+\s+drawtext\s/m.test(`${res.stdout}\n${res.stderr}`)) return;
  throw new Error(
    [
      "Refusing: video captions need ffmpeg's `drawtext` filter, which this ffmpeg does not list",
      "Remedy: install an ffmpeg built with libfreetype (e.g. `brew install ffmpeg` or `apt-get install ffmpeg`), or turn captions off in the video style.",
      `Context: mode=video-render, filter=drawtext, ffmpeg=${ffmpeg}, captions=${edl.captions.length}`,
    ].join("\n"),
  );
}

export type ProbeResult =
  | { ok: true; streams: { codec_type?: string }[]; duration: number }
  | { ok: false; code: number; stderr: string };

/**
 * Ask ffprobe for a media file's stream types and duration. `duration` is
 * NaN when ffprobe reports none; callers decide how to refuse.
 */
export async function probeMedia(runner: Runner, ffprobe: string, file: string, cwd: string): Promise<ProbeResult> {
  const res = await runner(
    [ffprobe, "-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", file],
    { cwd },
  );
  if (res.code !== 0) return { ok: false, code: res.code, stderr: res.stderr };
  const info = JSON.parse(res.stdout) as { streams?: { codec_type?: string }[]; format?: { duration?: string } };
  return { ok: true, streams: info.streams ?? [], duration: Number(info.format?.duration) };
}

export async function renderVideo(opts: {
  edl: Edl;
  style: VideoStyle;
  workDir: string;
  runner?: Runner;
  which?: Which;
  alignments?: Record<number, WordTiming[]>;
}): Promise<{ output: string }> {
  const runner = opts.runner ?? defaultRunner;
  const { ffmpeg } = requireRenderBinaries(opts.which);
  checkBannedEffects(opts.edl, opts.style);
  await requireCaptionFilter(runner, ffmpeg, opts.edl, opts.style, opts.workDir);
  const args = buildFfmpegArgs(opts.edl, opts.style, opts.alignments);
  const res = await runner([ffmpeg, ...args], { cwd: opts.workDir });
  if (res.code !== 0) {
    const tail = res.stderr.trim().split("\n").slice(-5).join(" | ");
    throw new Error(
      [
        `Refusing: ffmpeg exited ${res.code} rendering the edit list`,
        "Remedy: fix the edit list or the inputs it names, then re-run the render.",
        `Context: mode=video-render, stderr_tail=${tail}`,
      ].join("\n"),
    );
  }
  return { output: join(opts.workDir, "final.mp4") };
}
