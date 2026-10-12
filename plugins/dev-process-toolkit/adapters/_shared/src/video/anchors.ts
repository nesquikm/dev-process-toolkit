// STE-665 — anchor resolution: a word-anchored cut `{ segment, word }` (both
// 1-based) resolves to that word's `start` in the segment's alignment plus the
// segment's offset in the edit list. A missing segment or word refuses in the
// NFR-10 shape (Refusing / Remedy / Context) naming it.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Edl, EdlAnchorRef } from "./edl";
import type { WordTiming } from "./tts";

function refuse(what: string, remedy: string, context: string): Error {
  return new Error(
    [`Refusing: video anchor ${what}`, `Remedy: ${remedy}`, `Context: mode=video-anchor, ${context}`].join("\n"),
  );
}

export function resolveAnchor(ref: EdlAnchorRef, edl: Edl, alignments: Record<number, WordTiming[]>): number {
  const { segment, word } = ref;
  const voice = edl.voice.find((v) => v.segment === segment);
  const words = alignments[segment];
  if (!voice || !words) {
    throw refuse(
      `names segment ${segment}, which has no voice entry or alignment`,
      `point the anchor at an existing segment, or add segment ${segment} to the edit list's voice track.`,
      `segment=${segment}`,
    );
  }
  const timing = words[word - 1];
  if (!Number.isInteger(word) || word < 1 || !timing) {
    throw refuse(
      `names word ${word} of segment ${segment}, which has ${words.length} words`,
      `use a 1-based word index between 1 and ${words.length} for segment ${segment}.`,
      `segment=${segment}, word=${word}`,
    );
  }
  return timing.start + voice.offset;
}

/** An anchor's time in seconds: a literal number, or a word reference resolved via `resolveAnchor`. */
export function anchorSeconds(
  at: number | EdlAnchorRef,
  edl: Edl,
  alignments: Record<number, WordTiming[]> = {},
): number {
  return typeof at === "number" ? at : resolveAnchor(at, edl, alignments);
}

/** A clip as placed on the output timeline: source window, start time, and a frozen-frame tail. */
export interface PlacedClip {
  in: number;
  out: number;
  start: number;
  /** Seconds the clip's last frame is held so the next anchored clip starts on time. */
  hold: number;
  /** Seconds the clip's first frame is held before it (a first clip anchored after 0). */
  lead: number;
}

/**
 * Requirement "Anchor cuts": a clip whose `at` resolves to T starts at T. The clip
 * before it is fitted to end at T — its last frame held when it ends early, its
 * out point trimmed when it would overrun. Clips with no `at` follow on directly.
 */
export function placeClips(edl: Edl, alignments: Record<number, WordTiming[]> = {}): PlacedClip[] {
  const placed: PlacedClip[] = [];
  let cursor = 0;
  edl.clips.forEach((clip, i) => {
    let start = cursor;
    let lead = 0;
    if (clip.at !== undefined) {
      const t = anchorSeconds(clip.at, edl, alignments);
      const prev = placed[placed.length - 1];
      if (!prev) {
        lead = t;
      } else {
        const prevFirstFrame = prev.start + prev.lead;
        if (t < prevFirstFrame) {
          throw refuse(
            `places clip ${i} at ${t}s, before clip ${i - 1} starts (${prevFirstFrame}s)`,
            `anchor clip ${i} at or after ${prevFirstFrame}s, or reorder the clips.`,
            `clip=${i}, at=${t}`,
          );
        }
        const prevEnd = prev.start + prev.lead + (prev.out - prev.in) + prev.hold;
        if (t > prevEnd) prev.hold += t - prevEnd;
        else if (t < prevEnd) prev.out = prev.in + (t - prev.start - prev.lead);
      }
      start = prev ? t : 0;
    }
    placed.push({ in: clip.in, out: clip.out, start, hold: 0, lead });
    cursor = start + lead + (clip.out - clip.in);
  });
  return placed;
}

/** The programme length once every clip is placed on the output timeline. */
export function placedDuration(edl: Edl, alignments: Record<number, WordTiming[]> = {}): number {
  return placeClips(edl, alignments).reduce((sum, c) => sum + c.lead + (c.out - c.in) + c.hold, 0);
}

/** Read `alignment/<n>.json` under `workDir` for every voice segment that has one. */
export function readAlignments(workDir: string, edl: Edl): Record<number, WordTiming[]> {
  const out: Record<number, WordTiming[]> = {};
  for (const v of edl.voice) {
    const file = join(workDir, "alignment", `${v.segment}.json`);
    if (existsSync(file)) out[v.segment] = JSON.parse(readFileSync(file, "utf8")) as WordTiming[];
  }
  return out;
}
