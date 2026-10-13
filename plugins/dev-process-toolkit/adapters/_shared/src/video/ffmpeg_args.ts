// STE-665 — the edit list -> ffmpeg argument builder.
//
// AC-STE-665.3: `buildFfmpegArgs(edl, style, alignments?)` is pure — the same inputs give a
// byte-identical argument list. The list excludes the binary, keeps every path
// relative to the work dir, and ends with the output file `final.mp4`.

import { placeClips, placedDuration } from "./anchors";
import type { Edl } from "./edl";
import type { VideoStyle } from "./style";
import type { WordTiming } from "./tts";

const OUTPUT = "final.mp4";
const FPS = 30;

/** Deterministic number rendering for filter arguments. */
const n = (x: number): string => String(Number(x.toFixed(6)));

/**
 * Escape a caption for a single-quoted drawtext `text=` value inside a filter graph.
 * A straight apostrophe cannot appear inside the quotes, so it becomes a typographic one.
 */
function drawtextEscape(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/'/g, "\u2019").replace(/:/g, "\\:").replace(/%/g, "\\%");
}

function captionY(position: string): string {
  if (position === "top") return "h*0.08";
  if (position === "center" || position === "middle") return "(h-text_h)/2";
  return "h-text_h-h*0.08";
}

/** Style-banned effect names -> the ffmpeg filters that realise them (the one table). */
const BANNED_EFFECT_FILTERS: Record<string, string[]> = {
  slow_zoom: ["zoompan"],
  ken_burns: ["zoompan"],
};

/**
 * AC-STE-665.4: refuse an edit list whose clips request a filter a banned style
 * effect maps to — before any ffmpeg process runs.
 */
export function checkBannedEffects(edl: Edl, style: VideoStyle): void {
  for (const banned of style.banned_effects) {
    const filters = BANNED_EFFECT_FILTERS[banned] ?? [banned];
    edl.clips.forEach((clip, i) => {
      const hit = (clip.effects ?? []).find((e) => filters.includes(e));
      if (hit === undefined) return;
      throw new Error(
        [
          `Refusing: video EDL clip \`clips.${i}\` requests effect \`${hit}\`, which the style bans as \`${banned}\``,
          `Remedy: remove \`${hit}\` from \`clips.${i}.effects\`, or drop \`${banned}\` from the style's \`banned_effects\`.`,
          `Context: mode=video-render, field=clips.${i}.effects, banned=${banned}`,
        ].join("\n"),
      );
    });
  }
}

/**
 * `alignments` (segment -> word timings) resolves word-anchored clips; a clip whose
 * `at` resolves to T starts at T (see `placeClips`). A word anchor whose segment has
 * no alignment refuses (NFR-10).
 */
export function buildFfmpegArgs(edl: Edl, style: VideoStyle, alignments: Record<number, WordTiming[]> = {}): string[] {
  const { width, height } = style.layout.viewport;
  const placed = placeClips(edl, alignments);
  const duration = n(placedDuration(edl, alignments));
  const args: string[] = ["-hide_banner", "-y"];
  const graph: string[] = [];
  let input = 0;

  // Video: trim each clip, fit it to the viewport, then concatenate in order.
  const clipLabels: string[] = [];
  edl.clips.forEach((clip, i) => {
    const at = placed[i]!;
    args.push("-i", clip.src);
    const label = `v${input}`;
    const zoom = (clip.effects ?? []).includes("zoompan")
      ? `,zoompan=z='min(zoom+0.0015,1.5)':d=1:s=${width}x${height}:fps=${FPS}`
      : "";
    const lead = at.lead > 0 ? `,tpad=start_mode=clone:start_duration=${n(at.lead)}` : "";
    const hold = at.hold > 0 ? `,tpad=stop_mode=clone:stop_duration=${n(at.hold)}` : "";
    // `trim` keeps the last in-window frame with its full source duration, and `fps` then fills
    // frames up to the NEXT source frame — on a variable-frame-rate clip that overruns the cut and
    // shifts every later clip. The second `trim` after `fps` cuts the segment back to out - in.
    graph.push(
      `[${input}:v]trim=start=${n(at.in)}:end=${n(at.out)},setpts=PTS-STARTPTS,` +
        `scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${FPS},trim=end=${n(at.out - at.in)}${zoom}${lead}${hold}[${label}]`,
    );
    clipLabels.push(`[${label}]`);
    input++;
  });
  graph.push(`${clipLabels.join("")}concat=n=${clipLabels.length}:v=1:a=0[vcat]`);

  // Captions: one drawtext per caption, enabled over its window.
  let videoOut = "vcat";
  if (style.captions.enabled && edl.captions.length > 0) {
    const y = captionY(style.captions.position);
    const draws = edl.captions.map(
      (c) =>
        `drawtext=text='${drawtextEscape(c.text)}':fontsize=h/14:fontcolor=white:borderw=3:bordercolor=black:` +
        `x=(w-text_w)/2:y=${y}:enable='between(t,${n(c.start)},${n(c.end)})'`,
    );
    graph.push(`[vcat]${draws.join(",")}[vout]`);
    videoOut = "vout";
  }

  // Audio: voice segments delayed to their offsets, plus music at the edit list's level, then
  // the mix normalised to the style's loudness target.
  const audioLabels: string[] = [];
  for (const v of edl.voice) {
    args.push("-i", v.audio);
    const label = `a${input}`;
    const delayMs = Math.round(v.offset * 1000);
    graph.push(`[${input}:a]adelay=${delayMs}:all=1[${label}]`);
    audioLabels.push(`[${label}]`);
    input++;
  }
  if (edl.music) {
    args.push("-i", edl.music.src);
    const label = `m${input}`;
    graph.push(`[${input}:a]volume=${n(edl.music.level_db)}dB[${label}]`);
    audioLabels.push(`[${label}]`);
    input++;
  }
  if (audioLabels.length === 0) {
    graph.push(`anullsrc=r=48000:cl=stereo,atrim=end=${duration}[aout]`);
  } else {
    const mixed =
      audioLabels.length === 1
        ? audioLabels[0]!
        : `${audioLabels.join("")}amix=inputs=${audioLabels.length}:duration=longest:normalize=0`;
    const sep = audioLabels.length === 1 ? "" : ",";
    // AC-STE-674.6: one loudness normalisation on the final mix (the voice alone without music);
    // loudnorm upsamples internally, so resample back to 48 kHz after it.
    const loudnorm = `loudnorm=I=${n(style.loudness.target_lufs)}:TP=-1.5:LRA=11,aresample=48000`;
    graph.push(`${mixed}${sep}${loudnorm},apad,atrim=end=${duration}[aout]`);
  }

  args.push(
    "-filter_complex",
    graph.join(";"),
    "-map",
    `[${videoOut}]`,
    "-map",
    "[aout]",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(FPS),
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-t",
    duration,
    "-movflags",
    "+faststart",
    OUTPUT,
  );
  return args;
}
