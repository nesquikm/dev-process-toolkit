// STE-664 — shared text-to-speech contract.
//
// AC-STE-664.1: every provider returns `{ audioPath, alignment }`, where
// `alignment` is a word list with non-decreasing `start` <= `end` (seconds).

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dptEnvPath, videoWorkDir } from "../dpt_paths";

export interface WordTiming {
  word: string;
  start: number;
  end: number;
}

export interface TtsSegment {
  index: number;
  text: string;
}

export interface SynthesisResult {
  audioPath: string;
  alignment: WordTiming[];
}

export interface TtsProvider {
  synthesize(segment: TtsSegment): Promise<SynthesisResult>;
}

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;
export type WaitFn = (ms: number) => Promise<void>;

export interface ProviderOpts {
  apiKey: string;
  voice: string;
  model?: string;
  projectRoot: string;
  slug: string;
  fetch: FetchFn;
  wait: WaitFn;
}

export const RETRY_DELAYS_MS = [1000, 2000, 4000] as const;

/** Who a request is for — names the provider and its key variable in a refusal. */
export interface RetryTarget {
  provider: string;
  keyVar: string;
}

export const ELEVENLABS: RetryTarget = { provider: "ElevenLabs", keyVar: "ELEVENLABS_API_KEY" };
export const GOOGLE_TTS: RetryTarget = { provider: "Google Cloud TTS", keyVar: "GOOGLE_TTS_API_KEY" };

function refusal(verdict: string, remedy: string, context: string): Error {
  return new Error(`${verdict}\nRemedy: ${remedy}\nContext: ${context}`);
}

/**
 * The one request path every video provider goes through (AC-STE-664.6).
 * A 401/403 refuses at once naming the provider and its key variable; a 429
 * or 5xx is retried after each of RETRY_DELAYS_MS, then refuses. The URL is
 * never echoed: it may carry the key.
 */
export async function fetchWithRetry(
  fetch: FetchFn,
  url: string,
  init: RequestInit,
  wait: WaitFn,
  target: RetryTarget,
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch {
      // A network error's message may echo the URL (and so the key): never surface it.
      throw refusal(
        `${target.provider} could not be reached (network failure).`,
        `check the network connection and re-run.`,
        `provider=${target.provider} attempts=${attempt + 1}`,
      );
    }
    if (res.status === 401 || res.status === 403) {
      throw refusal(
        `${target.provider} rejected the API key (HTTP ${res.status}).`,
        `set a valid ${target.keyVar} in ${dptEnvPath("")} and re-run.`,
        `provider=${target.provider} key=${target.keyVar} status=${res.status}`,
      );
    }
    const transient = res.status === 429 || res.status >= 500;
    if (!transient) return res;
    if (attempt >= RETRY_DELAYS_MS.length) {
      throw refusal(
        `${target.provider} kept failing (HTTP ${res.status}) after ${RETRY_DELAYS_MS.length} retries.`,
        `wait for the provider to recover (or its rate limit to reset) and re-run.`,
        `provider=${target.provider} status=${res.status} attempts=${attempt + 1}`,
      );
    }
    await wait(RETRY_DELAYS_MS[attempt]!);
  }
}

/** POST a JSON body through fetchWithRetry. */
export function postJson(
  fetch: FetchFn,
  wait: WaitFn,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  target: RetryTarget,
): Promise<Response> {
  return fetchWithRetry(fetch, url, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify(body),
  }, wait, target);
}

/** Write `data` to `<subdir>/<name>` under the video work dir (subdir "" = the work dir itself). */
export function writeWorkFile(
  projectRoot: string,
  slug: string,
  subdir: string,
  name: string,
  data: string | Uint8Array,
): string {
  const dir = join(videoWorkDir(projectRoot, slug), subdir);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, data);
  return path;
}

/**
 * Persist one synthesized segment: decoded audio to `segments/<index>.mp3`,
 * word alignment to `alignment/<index>.json`, under the video work dir.
 */
export function persistSegment(
  opts: Pick<ProviderOpts, "projectRoot" | "slug">,
  index: number,
  audioBase64: string,
  alignment: WordTiming[],
): SynthesisResult {
  const audioPath = writeWorkFile(opts.projectRoot, opts.slug, "segments", `${index}.mp3`, Buffer.from(audioBase64, "base64"));
  writeWorkFile(opts.projectRoot, opts.slug, "alignment", `${index}.json`, JSON.stringify(alignment));
  return { audioPath, alignment };
}

export async function synthesizeScript(provider: TtsProvider, segments: TtsSegment[]): Promise<SynthesisResult[]> {
  const results: SynthesisResult[] = [];
  for (const segment of segments) results.push(await provider.synthesize(segment));
  return results;
}
