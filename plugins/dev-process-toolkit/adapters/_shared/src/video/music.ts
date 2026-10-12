// STE-664 — background music source.
//
// AC-STE-664.7: `elevenlabs` makes one music request whose length equals the
// video's planned length; `file` returns the committed track and makes no
// request; `none` returns no track and makes no request.

import { join } from "node:path";
import type { VideoMusicConfig } from "./config";
import { ELEVENLABS, type FetchFn, postJson, type WaitFn, writeWorkFile } from "./tts";

export interface ResolveMusicOpts {
  music: VideoMusicConfig;
  projectRoot: string;
  slug: string;
  plannedSeconds: number;
  style?: string;
  apiKey?: string;
  fetch: FetchFn;
  wait: WaitFn;
}

const DEFAULT_PROMPT = "Calm, unobtrusive instrumental background music for a product explainer video.";

export async function resolveMusicTrack(opts: ResolveMusicOpts): Promise<string | null> {
  const { music } = opts;
  if (music.source === "none") return null;
  if (music.source === "file") return join(opts.projectRoot, music.file);

  const prompt = opts.style?.trim() ? `${DEFAULT_PROMPT} Style: ${opts.style.trim()}` : DEFAULT_PROMPT;
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
