// STE-664 — background music source.
//
// AC-STE-664.7: `elevenlabs` makes one music request whose length equals the
// video's planned length; `file` returns the committed track and makes no
// request; `none` returns no track and makes no request.

import { join } from "node:path";
import type { VideoMusicConfig } from "./config";
import { VIDEO_STYLE_DEFAULTS } from "./style";
import { ELEVENLABS, type FetchFn, postJson, type WaitFn, writeWorkFile } from "./tts";

export interface ResolveMusicOpts {
  music: VideoMusicConfig;
  projectRoot: string;
  slug: string;
  plannedSeconds: number;
  /** The stored `music.prompt`; sent exactly. Absent → the style default. */
  prompt?: string;
  apiKey?: string;
  fetch: FetchFn;
  wait: WaitFn;
}

export async function resolveMusicTrack(opts: ResolveMusicOpts): Promise<string | null> {
  const { music } = opts;
  if (music.source === "none") return null;
  if (music.source === "file") return join(opts.projectRoot, music.file);

  const prompt = opts.prompt ?? VIDEO_STYLE_DEFAULTS.music.prompt;
  const res = await postJson(
    opts.fetch,
    opts.wait,
    "https://api.elevenlabs.io/v1/music",
    { "xi-api-key": opts.apiKey ?? "" },
    { prompt, music_length_ms: Math.round(opts.plannedSeconds * 1000) },
    ELEVENLABS,
  );
  return writeWorkFile(opts.projectRoot, opts.slug, "", "music.mp3", new Uint8Array(await res.arrayBuffer()));
}
