// M_1e0717 STE-664 — voice and music providers.
//
// AC coverage:
//   AC-STE-664.1 — shared contract test over BOTH adapters: `{ audioPath, alignment }`,
//                  word entries with non-decreasing start, start <= end, within duration.
//   AC-STE-664.2 — ElevenLabs: one with-timestamps request per segment (voice + model),
//                  character alignment -> word list, byte-compared to a fixture.
//   AC-STE-664.3 — `<break time="1s"/>` -> `[short pause]` (ElevenLabs);
//                  `[short pause]` -> `<break time="400ms"/>` (Google).
//   AC-STE-664.4 — Google: SSML with one `<mark name="w<i>"/>` per word, time-pointing on,
//                  timepoints -> word list.
//   AC-STE-664.5 — a three-segment script: three calls, `segments/<n>.mp3` and
//                  `alignment/<n>.json` (n = 1..3) under `videoWorkDir(projectRoot, slug)`.
//   AC-STE-664.6 — 401/403 refuse (NFR-10, provider + key variable, no retry);
//                  429/5xx retry after 1000, 2000, 4000 ms (injected wait) then refuse;
//                  a success on a retry returns normally.
//   AC-STE-664.7 — music: `elevenlabs` one request with the planned length; `file` returns the
//                  committed track, no request; `none` returns null, no request.
//   AC-STE-664.8 — no network: every adapter takes an injected fetch; the global fetch is
//                  trapped for the whole suite and must never be called.
//   AC-STE-664.9 — mutation-verified in a temp overlay of the plugin: dropping the break
//                  rewrite reds AC-STE-664.3; skipping the retry reds AC-STE-664.6.
//   AC-STE-663.8 (carried) — a sentinel API key never reaches a refusal or a file the
//                  provider modules write (the key reaching the injected fetch is expected).
//
// Module contract this suite drives (adapters/_shared/src/video/):
//   tts.ts
//     export interface WordTiming { word: string; start: number; end: number }   // seconds
//     export interface TtsSegment { index: number; text: string }               // 1-based index
//     export interface SynthesisResult { audioPath: string; alignment: WordTiming[] }
//     export interface TtsProvider { synthesize(segment: TtsSegment): Promise<SynthesisResult> }
//     export const RETRY_DELAYS_MS  // [1000, 2000, 4000]
//     export async function fetchWithRetry(fetch, url, init, ...rest): Promise<Response>
//       — the ONE retry path both adapters (and music) go through; its first three
//         parameters are (fetch, url, init). AC-STE-664.9 stubs it to a single call.
//     export async function synthesizeScript(provider, segments): Promise<SynthesisResult[]>
//   tts_elevenlabs.ts
//     export function createElevenLabsTts(opts: ProviderOpts): TtsProvider
//     export function rewriteBreaksForElevenLabs(text: string): string
//       — declared exactly once with this header; AC-STE-664.9 stubs it to identity.
//   tts_google.ts
//     export function createGoogleTts(opts: ProviderOpts): TtsProvider
//       — SSML carries `<mark name="w0"/>Word ...` per word (0-based) plus one trailing
//         `<mark name="end"/>`; word i ends where word i+1 starts, the last word ends at `end`.
//   music.ts
//     export async function resolveMusicTrack(opts: {
//       music: VideoMusicConfig; projectRoot; slug; plannedSeconds; style?; apiKey?; fetch; wait
//     }): Promise<string | null>
//   ProviderOpts = { apiKey, voice, model?, projectRoot, slug, fetch, wait }
//     fetch: (url: string, init: RequestInit) => Promise<Response>
//     wait:  (ms: number) => Promise<void>

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { dptEnvPath, videoWorkDir } from "../adapters/_shared/src/dpt_paths";
import { mutateInRegion } from "./_sited-mutation";
import { runNestedBunTest } from "./_nested_bun_test";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const VIDEO_DIR = join(PLUGIN_ROOT, "adapters", "_shared", "src", "video");
const FIXTURES = join(import.meta.dir, "fixtures", "video-providers");
const THIS_FILE_REL = "tests/m_1e0717-ste-664-video-providers.test.ts";

const MOD = {
  tts: join(VIDEO_DIR, "tts.ts"),
  elevenlabs: join(VIDEO_DIR, "tts_elevenlabs.ts"),
  google: join(VIDEO_DIR, "tts_google.ts"),
  music: join(VIDEO_DIR, "music.ts"),
} as const;
/** STE-663's key reader — outside MOD so the AC-STE-664.8 provider-module scan stays at four. */
const KEYS_MODULE = join(VIDEO_DIR, "keys.ts");

/* eslint-disable @typescript-eslint/no-explicit-any */
const loadTts = (): Promise<any> => import(MOD.tts);
const loadElevenLabs = (): Promise<any> => import(MOD.elevenlabs);
const loadGoogle = (): Promise<any> => import(MOD.google);
const loadMusic = (): Promise<any> => import(MOD.music);
const loadKeys = (): Promise<any> => import(KEYS_MODULE);

/** A key value no refusal or written file may ever carry (AC-STE-663.8 carried here). */
const SENTINEL = "sk-STE664-SENTINEL-4b7d2e9a1c";
const SLUG = "demo-video";

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

const readFixture = (name: string): string => readFileSync(join(FIXTURES, name), "utf8");
const EL_RESPONSE = JSON.parse(readFixture("elevenlabs-with-timestamps.json"));
const EL_EXPECTED = JSON.parse(readFixture("elevenlabs-expected-words.json"));
const G_RESPONSE = JSON.parse(readFixture("google-synthesize.json"));
const G_EXPECTED = JSON.parse(readFixture("google-expected-words.json"));
/** Audio durations of the recorded responses (seconds). */
const EL_DURATION = 1.0;
const G_DURATION = 1.2;
const FIXTURE_TEXT = "Hello brave world";

// ---------------------------------------------------------------------------
// helpers: temp roots, sentinel sweep, request recorder
// ---------------------------------------------------------------------------

const tmpRoots: string[] = [];
const capturedOutputs: string[] = [];
/** Every request any injected fetch saw — the sentinel control reads this. */
const allRequests: RecordedRequest[] = [];
/** `.dpt/.env` files this suite planted — the key's legitimate home, excluded from the leak sweep. */
const plantedEnvFiles: string[] = [];

function makeTmpRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  tmpRoots.push(root);
  return root;
}

function cleanup(root: string): void {
  rmSync(root, { recursive: true, force: true });
  if (existsSync(root)) Bun.spawnSync(["rm", "-rf", root]);
}

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walkFiles(full));
    else out.push(full);
  }
  return out;
}

function sentinelLeaks(root: string, exclude: string[] = []): string[] {
  return walkFiles(root)
    .filter((f) => !exclude.includes(f))
    .filter((f) => readFileSync(f).toString("latin1").includes(SENTINEL))
    .map((f) => relative(root, f));
}

interface RecordedRequest {
  url: string;
  method: string;
  headers: Headers;
  rawBody: string;
  body: any;
}

type Reply = () => Response;

/** An injected fetch: records each request, answers from a queue (last reply repeats). */
function recorder(replies: Reply[]): {
  fetch: (input: any, init?: RequestInit) => Promise<Response>;
  calls: RecordedRequest[];
} {
  const calls: RecordedRequest[] = [];
  let i = 0;
  const fetch = async (input: any, init: RequestInit = {}): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : String(input.url);
    const rawBody = init.body === undefined || init.body === null ? "" : String(init.body);
    let body: any = null;
    try {
      body = rawBody === "" ? null : JSON.parse(rawBody);
    } catch {
      body = null;
    }
    const rec: RecordedRequest = {
      url,
      method: (init.method ?? "GET").toUpperCase(),
      headers: new Headers(init.headers),
      rawBody,
      body,
    };
    calls.push(rec);
    allRequests.push(rec);
    const reply = replies[Math.min(i, replies.length - 1)]!;
    i += 1;
    return reply();
  };
  return { fetch, calls };
}

const jsonReply = (obj: unknown, status = 200): Reply => () =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
const statusReply = (status: number): Reply => () =>
  new Response(JSON.stringify({ detail: { status: "error", message: `upstream said ${status}` } }), {
    status,
    headers: { "content-type": "application/json" },
  });

function waitRecorder(): { wait: (ms: number) => Promise<void>; waits: number[] } {
  const waits: number[] = [];
  return {
    waits,
    wait: async (ms: number) => {
      waits.push(ms);
    },
  };
}

function makeProject(): string {
  return makeTmpRoot("ste664-proj-");
}

type ProviderName = "elevenlabs" | "google";

const PROVIDERS: Record<
  ProviderName,
  {
    label: RegExp;
    keyVar: string;
    voice: string;
    model?: string;
    response: any;
    expected: any;
    duration: number;
    load: () => Promise<any>;
    factory: string;
  }
> = {
  elevenlabs: {
    label: /elevenlabs/i,
    keyVar: "ELEVENLABS_API_KEY",
    voice: "voice-rachel-001",
    model: "eleven_v4",
    response: EL_RESPONSE,
    expected: EL_EXPECTED,
    duration: EL_DURATION,
    load: loadElevenLabs,
    factory: "createElevenLabsTts",
  },
  google: {
    label: /google/i,
    keyVar: "GOOGLE_TTS_API_KEY",
    voice: "en-US-Neural2-F",
    response: G_RESPONSE,
    expected: G_EXPECTED,
    duration: G_DURATION,
    load: loadGoogle,
    factory: "createGoogleTts",
  },
};

async function makeProvider(
  name: ProviderName,
  replies: Reply[],
  projectRoot = makeProject(),
): Promise<{
  provider: any;
  calls: RecordedRequest[];
  waits: number[];
  projectRoot: string;
}> {
  const spec = PROVIDERS[name];
  const mod = await spec.load();
  const { fetch, calls } = recorder(replies);
  const { wait, waits } = waitRecorder();
  const opts: Record<string, unknown> = {
    apiKey: SENTINEL,
    voice: spec.voice,
    projectRoot,
    slug: SLUG,
    fetch,
    wait,
  };
  if (spec.model !== undefined) opts.model = spec.model;
  const provider = mod[spec.factory](opts);
  return { provider, calls, waits, projectRoot };
}

async function catchRefusal(p: Promise<unknown>): Promise<string> {
  let message: string | null = null;
  try {
    await p;
  } catch (err) {
    message = err instanceof Error ? err.message : String(err);
  }
  expect(message).not.toBeNull();
  capturedOutputs.push(message!);
  return message!;
}

/** NFR-10 canonical shape: verdict line, `Remedy:` line, `Context:` line. */
function expectNfr10(message: string): void {
  const lines = message.split("\n");
  expect(lines.length).toBe(3);
  expect(lines[0]!.trim().length).toBeGreaterThan(0);
  expect(lines[0]!.startsWith("Remedy:")).toBe(false);
  expect(lines[1]!).toMatch(/^Remedy: \S/);
  expect(lines[2]!).toMatch(/^Context: \S/);
}

/** The AC-STE-664.1 contract, as a checker that throws on the first violation. */
function assertAlignmentContract(alignment: unknown, duration: number): void {
  if (!Array.isArray(alignment) || alignment.length === 0) throw new Error("alignment is not a non-empty array");
  let prevStart = -Infinity;
  alignment.forEach((e: any, i) => {
    const keys = Object.keys(e ?? {}).sort();
    if (JSON.stringify(keys) !== JSON.stringify(["end", "start", "word"])) {
      throw new Error(`entry ${i} keys are ${keys.join(",")}`);
    }
    if (typeof e.word !== "string" || e.word.trim() === "") throw new Error(`entry ${i} word is empty`);
    if (typeof e.start !== "number" || typeof e.end !== "number") throw new Error(`entry ${i} times not numbers`);
    if (!(e.start >= 0)) throw new Error(`entry ${i} start < 0`);
    if (!(e.start <= e.end)) throw new Error(`entry ${i} start > end`);
    if (!(e.end <= duration)) throw new Error(`entry ${i} end ${e.end} past duration ${duration}`);
    if (!(e.start >= prevStart)) throw new Error(`entry ${i} start decreases`);
    prevStart = e.start;
  });
}

// ---------------------------------------------------------------------------
// AC-STE-664.8 — trap the global fetch for the whole suite
// ---------------------------------------------------------------------------

const realFetch = globalThis.fetch;
const globalFetchHits: string[] = [];

beforeAll(() => {
  globalThis.fetch = (async (input: any) => {
    globalFetchHits.push(String(typeof input === "string" ? input : input?.url ?? input));
    throw new Error("STE-664: a provider module reached the global fetch — inject one instead");
  }) as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = realFetch;
  // AC-STE-664.8 — nothing in this suite opened a network connection.
  expect(globalFetchHits).toEqual([]);
  // AC-STE-663.8 carried — the sentinel never reaches a refusal or a written file.
  for (const out of capturedOutputs) expect(out).not.toContain(SENTINEL);
  for (const root of tmpRoots) {
    if (root.includes("ste664-proj-")) expect(sentinelLeaks(root, plantedEnvFiles), root).toEqual([]);
  }
  while (tmpRoots.length > 0) cleanup(tmpRoots.pop()!);
});

// ===========================================================================
// AC-STE-664.1 — one contract, both adapters
// ===========================================================================

describe("AC-STE-664.1 — both adapters satisfy one synthesis contract", () => {
  test("the contract checker itself rejects a bad alignment (control)", () => {
    expect(() => assertAlignmentContract([{ word: "a", start: 0.5, end: 0.2 }], 1)).toThrow(/start > end/);
    expect(() =>
      assertAlignmentContract(
        [
          { word: "a", start: 0.5, end: 0.6 },
          { word: "b", start: 0.1, end: 0.2 },
        ],
        1,
      ),
    ).toThrow(/decreases/);
    expect(() => assertAlignmentContract([{ word: "a", start: 0.5, end: 2 }], 1)).toThrow(/past duration/);
    expect(() => assertAlignmentContract([], 1)).toThrow(/non-empty/);
    expect(() => assertAlignmentContract(EL_EXPECTED, EL_DURATION)).not.toThrow();
  });

  for (const name of ["elevenlabs", "google"] as const) {
    test(`${name}: synthesize returns { audioPath, alignment } honouring the contract`, async () => {
      const spec = PROVIDERS[name];
      const { provider, calls, projectRoot } = await makeProvider(name, [jsonReply(spec.response)]);
      const result = await provider.synthesize({ index: 1, text: FIXTURE_TEXT });

      expect(Object.keys(result).sort()).toEqual(["alignment", "audioPath"]);
      expect(typeof result.audioPath).toBe("string");
      expect(existsSync(result.audioPath)).toBe(true);
      expect(resolve(result.audioPath).startsWith(resolve(videoWorkDir(projectRoot, SLUG)))).toBe(true);
      // The audio file holds the provider's decoded bytes.
      const audioB64 = name === "elevenlabs" ? spec.response.audio_base64 : spec.response.audioContent;
      expect(Buffer.from(readFileSync(result.audioPath)).equals(Buffer.from(audioB64, "base64"))).toBe(true);

      assertAlignmentContract(result.alignment, spec.duration);
      expect(result.alignment.map((w: any) => w.word)).toEqual(["Hello", "brave", "world"]);
      expect(calls.length).toBe(1);
    });
  }
});

// ===========================================================================
// AC-STE-664.2 — ElevenLabs with-timestamps request + character -> word conversion
// ===========================================================================

describe("AC-STE-664.2 — ElevenLabs with-timestamps request and word conversion", () => {
  test("one POST to the with-timestamps endpoint carrying the configured voice and model", async () => {
    const spec = PROVIDERS.elevenlabs;
    const { provider, calls } = await makeProvider("elevenlabs", [jsonReply(spec.response)]);
    await provider.synthesize({ index: 1, text: FIXTURE_TEXT });

    expect(calls.length).toBe(1);
    const req = calls[0]!;
    expect(req.method).toBe("POST");
    const url = new URL(req.url);
    expect(url.host).toBe("api.elevenlabs.io");
    expect(url.pathname).toBe(`/v1/text-to-speech/${spec.voice}/with-timestamps`);
    expect(req.body).not.toBeNull();
    expect(req.body.model_id).toBe("eleven_v4");
    expect(req.body.text).toBe(FIXTURE_TEXT);
    expect(req.headers.get("xi-api-key")).toBe(SENTINEL);
  });

  test("the fixture's character alignment converts to the expected word list, byte-compared", async () => {
    const { provider, projectRoot } = await makeProvider("elevenlabs", [jsonReply(EL_RESPONSE)]);
    const result = await provider.synthesize({ index: 1, text: FIXTURE_TEXT });
    expect(JSON.stringify(result.alignment)).toBe(JSON.stringify(EL_EXPECTED));
    // The written alignment file carries the same word list.
    const written = join(videoWorkDir(projectRoot, SLUG), "alignment", "1.json");
    expect(JSON.stringify(JSON.parse(readFileSync(written, "utf8")))).toBe(JSON.stringify(EL_EXPECTED));
  });

  test("two segments make two requests, one per segment", async () => {
    const { provider, calls } = await makeProvider("elevenlabs", [jsonReply(EL_RESPONSE)]);
    await provider.synthesize({ index: 1, text: "First line" });
    await provider.synthesize({ index: 2, text: "Second line" });
    expect(calls.map((c) => c.body?.text)).toEqual(["First line", "Second line"]);
  });
});

// ===========================================================================
// AC-STE-664.3 — break rewrites
// ===========================================================================

describe("AC-STE-664.3 — pause markup is rewritten per provider", () => {
  test('ElevenLabs: `A<break time="1s"/>B` reaches the request as `A [short pause] B`', async () => {
    const { provider, calls } = await makeProvider("elevenlabs", [jsonReply(EL_RESPONSE)]);
    await provider.synthesize({ index: 1, text: 'A<break time="1s"/>B' });
    expect(calls.length).toBe(1);
    expect(calls[0]!.body.text).toBe("A [short pause] B");
    expect(calls[0]!.rawBody).not.toContain("<break");
  });

  test("ElevenLabs: rewriteBreaksForElevenLabs is the rewrite", async () => {
    const mod = await loadElevenLabs();
    expect(mod.rewriteBreaksForElevenLabs('A<break time="1s"/>B')).toBe("A [short pause] B");
  });

  test('Google: `[short pause]` reaches the SSML as `<break time="400ms"/>`', async () => {
    const reply = jsonReply({
      audioContent: G_RESPONSE.audioContent,
      timepoints: [
        { markName: "w0", timeSeconds: 0.05 },
        { markName: "w1", timeSeconds: 0.7 },
        { markName: "end", timeSeconds: 0.9 },
      ],
    });
    const { provider, calls } = await makeProvider("google", [reply]);
    await provider.synthesize({ index: 1, text: "A [short pause] B" });
    expect(calls.length).toBe(1);
    const ssml: string = calls[0]!.body.input.ssml;
    expect(ssml).toContain('<break time="400ms"/>');
    expect(ssml).not.toContain("[short pause]");
    // The pause is not a word: only A and B carry marks.
    expect(ssml.match(/<mark name="w\d+"\/>/g)?.length).toBe(2);
  });
});

// ===========================================================================
// AC-STE-664.4 — Google SSML marks + timepoints
// ===========================================================================

describe("AC-STE-664.4 — Google SSML marks and timepoint conversion", () => {
  test("the request carries one `<mark name=\"w<i>\"/>` per word and time-pointing", async () => {
    const spec = PROVIDERS.google;
    const { provider, calls } = await makeProvider("google", [jsonReply(spec.response)]);
    await provider.synthesize({ index: 1, text: FIXTURE_TEXT });

    expect(calls.length).toBe(1);
    const req = calls[0]!;
    expect(req.method).toBe("POST");
    const url = new URL(req.url);
    expect(url.host).toBe("texttospeech.googleapis.com");
    expect(url.pathname).toBe("/v1beta1/text:synthesize");
    expect(req.body.enableTimePointing).toEqual(["SSML_MARK"]);
    expect(req.body.voice.name).toBe(spec.voice);

    const ssml: string = req.body.input.ssml;
    expect(ssml.startsWith("<speak>")).toBe(true);
    expect(ssml.trimEnd().endsWith("</speak>")).toBe(true);
    const marks = [...ssml.matchAll(/<mark name="(w\d+)"\/>(\S+)/g)].map((m) => [m[1], m[2]]);
    expect(marks).toEqual([
      ["w0", "Hello"],
      ["w1", "brave"],
      ["w2", "world"],
    ]);
    expect(ssml.match(/<mark name="end"\/>/g)?.length).toBe(1);
  });

  test("the fixture's timepoints convert to the expected word list", async () => {
    const { provider } = await makeProvider("google", [jsonReply(G_RESPONSE)]);
    const result = await provider.synthesize({ index: 1, text: FIXTURE_TEXT });
    expect(JSON.stringify(result.alignment)).toBe(JSON.stringify(G_EXPECTED));
  });
});

// ===========================================================================
// AC-STE-664.5 — per-segment synthesis into the work dir
// ===========================================================================

describe("AC-STE-664.5 — a three-segment script writes three segment + alignment pairs", () => {
  for (const name of ["elevenlabs", "google"] as const) {
    test(`${name}: three calls, segments/<n>.mp3 and alignment/<n>.json for n = 1..3`, async () => {
      const spec = PROVIDERS[name];
      const tts = await loadTts();
      const { provider, calls, projectRoot } = await makeProvider(name, [jsonReply(spec.response)]);
      const segments = [
        { index: 1, text: FIXTURE_TEXT },
        { index: 2, text: FIXTURE_TEXT },
        { index: 3, text: FIXTURE_TEXT },
      ];
      const results = await tts.synthesizeScript(provider, segments);

      expect(calls.length).toBe(3);
      expect(results.length).toBe(3);
      const work = videoWorkDir(projectRoot, SLUG);
      for (const n of [1, 2, 3]) {
        const mp3 = join(work, "segments", `${n}.mp3`);
        const align = join(work, "alignment", `${n}.json`);
        expect(existsSync(mp3)).toBe(true);
        expect(existsSync(align)).toBe(true);
        expect(results[n - 1].audioPath).toBe(mp3);
        expect(JSON.parse(readFileSync(align, "utf8"))).toEqual(spec.expected);
      }
    });
  }
});

// ===========================================================================
// AC-STE-664.6 — auth refusals and the retry schedule
// ===========================================================================

describe("AC-STE-664.6 — auth refusals and the 1s + 2s + 4s retry schedule", () => {
  test("RETRY_DELAYS_MS is the canonical schedule", async () => {
    const tts = await loadTts();
    expect([...tts.RETRY_DELAYS_MS]).toEqual([1000, 2000, 4000]);
  });

  for (const name of ["elevenlabs", "google"] as const) {
    const spec = PROVIDERS[name];

    for (const status of [401, 403]) {
      test(`${name}: ${status} refuses at once, naming the provider and ${spec.keyVar}`, async () => {
        const { provider, calls, waits } = await makeProvider(name, [statusReply(status)]);
        const msg = await catchRefusal(provider.synthesize({ index: 1, text: FIXTURE_TEXT }));
        expectNfr10(msg);
        expect(msg.split("\n")[0]!).toMatch(spec.label);
        expect(msg).toContain(spec.keyVar);
        expect(msg).not.toContain(SENTINEL);
        expect(calls.length).toBe(1);
        expect(waits).toEqual([]);
      });
    }

    for (const status of [429, 503]) {
      test(`${name}: ${status} retries after 1000, 2000, 4000 ms, then refuses`, async () => {
        const { provider, calls, waits } = await makeProvider(name, [statusReply(status)]);
        const msg = await catchRefusal(provider.synthesize({ index: 1, text: FIXTURE_TEXT }));
        expectNfr10(msg);
        expect(msg.split("\n")[0]!).toMatch(spec.label);
        expect(msg).not.toContain(SENTINEL);
        expect(calls.length).toBe(4);
        expect(waits).toEqual([1000, 2000, 4000]);
      });
    }

    test(`${name}: a 500 then a success returns normally after one 1000 ms wait`, async () => {
      const { provider, calls, waits } = await makeProvider(name, [statusReply(500), jsonReply(spec.response)]);
      const result = await provider.synthesize({ index: 1, text: FIXTURE_TEXT });
      expect(calls.length).toBe(2);
      expect(waits).toEqual([1000]);
      expect(JSON.stringify(result.alignment)).toBe(JSON.stringify(spec.expected));
    });

    test(`${name}: 429, 429, then success returns normally after 1000 and 2000 ms`, async () => {
      const { provider, calls, waits } = await makeProvider(name, [
        statusReply(429),
        statusReply(429),
        jsonReply(spec.response),
      ]);
      const result = await provider.synthesize({ index: 1, text: FIXTURE_TEXT });
      expect(calls.length).toBe(3);
      expect(waits).toEqual([1000, 2000]);
      expect(existsSync(result.audioPath)).toBe(true);
    });
  }
});

// ===========================================================================
// AC-STE-664.7 — music sources
// ===========================================================================

describe("AC-STE-664.7 — music: elevenlabs, file, none", () => {
  const MUSIC_BYTES = Buffer.from("ID3\x04\x00elevenlabs-recorded-music", "latin1");
  const musicReply: Reply = () =>
    new Response(MUSIC_BYTES, { status: 200, headers: { "content-type": "audio/mpeg" } });

  test("elevenlabs: one music request whose duration equals the planned length", async () => {
    const music = await loadMusic();
    const projectRoot = makeProject();
    const { fetch, calls } = recorder([musicReply]);
    const { wait } = waitRecorder();
    const track = await music.resolveMusicTrack({
      music: { source: "elevenlabs" },
      projectRoot,
      slug: SLUG,
      plannedSeconds: 42,
      apiKey: SENTINEL,
      fetch,
      wait,
    });

    expect(calls.length).toBe(1);
    const req = calls[0]!;
    expect(req.method).toBe("POST");
    const url = new URL(req.url);
    expect(url.host).toBe("api.elevenlabs.io");
    expect(url.pathname).toBe("/v1/music");
    expect(req.body.music_length_ms).toBe(42_000);
    expect(typeof req.body.prompt).toBe("string");
    expect(req.body.prompt.trim().length).toBeGreaterThan(0);
    expect(req.headers.get("xi-api-key")).toBe(SENTINEL);

    expect(typeof track).toBe("string");
    expect(resolve(track).startsWith(resolve(videoWorkDir(projectRoot, SLUG)))).toBe(true);
    expect(Buffer.from(readFileSync(track)).equals(MUSIC_BYTES)).toBe(true);
  });

  test("file: returns the committed track path and makes no request", async () => {
    const music = await loadMusic();
    const projectRoot = makeProject();
    const rel = "assets/music/track.mp3";
    mkdirSync(join(projectRoot, "assets", "music"), { recursive: true });
    writeFileSync(join(projectRoot, rel), "committed-track");
    const { fetch, calls } = recorder([musicReply]);
    const { wait } = waitRecorder();
    const track = await music.resolveMusicTrack({
      music: { source: "file", file: rel },
      projectRoot,
      slug: SLUG,
      plannedSeconds: 42,
      fetch,
      wait,
    });
    expect(track).toBe(join(projectRoot, rel));
    expect(calls.length).toBe(0);
  });

  test("none: returns no track and makes no request", async () => {
    const music = await loadMusic();
    const projectRoot = makeProject();
    const { fetch, calls } = recorder([musicReply]);
    const { wait } = waitRecorder();
    const track = await music.resolveMusicTrack({
      music: { source: "none" },
      projectRoot,
      slug: SLUG,
      plannedSeconds: 42,
      fetch,
      wait,
    });
    expect(track).toBeNull();
    expect(calls.length).toBe(0);
  });
});

// ===========================================================================
// AC-STE-664.8 — injected fetch only; keys never from process.env
// ===========================================================================

describe("AC-STE-664.8 — no network: every adapter uses its injected fetch", () => {
  test("the four provider modules exist and never touch process.env or the global fetch", () => {
    for (const path of Object.values(MOD)) {
      expect(existsSync(path)).toBe(true);
      const src = readFileSync(path, "utf8");
      expect(src).not.toMatch(/process\.env/);
      expect(src).not.toMatch(/globalThis\.fetch/);
    }
  });

  for (const name of ["elevenlabs", "google"] as const) {
    test(`${name}: a synthesis is seen by the injected recorder, never by the global fetch`, async () => {
      const before = globalFetchHits.length;
      const { provider, calls } = await makeProvider(name, [jsonReply(PROVIDERS[name].response)]);
      await provider.synthesize({ index: 1, text: FIXTURE_TEXT });
      expect(calls.length).toBe(1);
      expect(globalFetchHits.length).toBe(before);
    });
  }

  test("sentinel control: the planted key DID reach an injected fetch, so the leak sweep grades a live key", () => {
    const carried = allRequests.filter((r) => {
      let hit = false;
      r.headers.forEach((v) => {
        if (v.includes(SENTINEL)) hit = true;
      });
      return hit || r.url.includes(SENTINEL);
    });
    expect(carried.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// AC-STE-664.9 — mutation verification in a temp overlay
// ===========================================================================

interface OverlayRun {
  code: number;
  output: string;
  mutatedSource: string | null;
}

/**
 * Materialise a temp overlay of the plugin (adapters/_shared/src, this suite, its
 * fixtures, the sited-mutation helper), optionally mutate one module IN THE
 * OVERLAY, assert the mutation landed, and run this suite filtered to `filter`.
 * The working tree is never touched.
 */
function runOverlay(
  filter: string,
  mutation: { moduleRel: string; find: string; repl: string; marker: string } | null,
): OverlayRun {
  const root = makeTmpRoot("ste664-overlay-");
  const plugin = join(root, "plugins", "dev-process-toolkit");
  mkdirSync(join(plugin, "adapters", "_shared"), { recursive: true });
  mkdirSync(join(plugin, "tests", "fixtures"), { recursive: true });
  const copy = Bun.spawnSync(
    [
      "bash",
      "-c",
      [
        "set -e",
        `cp -R ${JSON.stringify(join(PLUGIN_ROOT, "adapters", "_shared", "src"))} ${JSON.stringify(join(plugin, "adapters", "_shared"))}/`,
        `cp ${JSON.stringify(join(PLUGIN_ROOT, THIS_FILE_REL))} ${JSON.stringify(join(plugin, "tests"))}/`,
        `cp ${JSON.stringify(join(PLUGIN_ROOT, "tests", "_sited-mutation.ts"))} ${JSON.stringify(join(plugin, "tests"))}/`,
        `cp ${JSON.stringify(join(PLUGIN_ROOT, "tests", "_nested_bun_test.ts"))} ${JSON.stringify(join(plugin, "tests"))}/`,
        `cp -R ${JSON.stringify(FIXTURES)} ${JSON.stringify(join(plugin, "tests", "fixtures"))}/`,
      ].join("; "),
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (copy.exitCode !== 0) {
    throw new Error(`overlay copy failed (exit ${copy.exitCode}): ${copy.stderr.toString().trim()}`);
  }
  if (existsSync(join(REPO_ROOT, "node_modules"))) {
    symlinkSync(join(REPO_ROOT, "node_modules"), join(root, "node_modules"));
  }

  let mutatedSource: string | null = null;
  if (mutation !== null) {
    const target = join(plugin, mutation.moduleRel);
    expect(existsSync(target)).toBe(true);
    const before = readFileSync(target, "utf8");
    const after = mutateInRegion(before, 0, before.length, mutation.find, mutation.repl, {
      label: `${mutation.moduleRel} (whole module)`,
    });
    writeFileSync(target, after);
    // The mutation is asserted APPLIED before the target test runs.
    mutatedSource = readFileSync(target, "utf8");
    expect(mutatedSource).not.toBe(before);
    expect(mutatedSource).toContain(mutation.marker);
  }

  const proc = runNestedBunTest([THIS_FILE_REL, "-t", filter], { cwd: plugin });
  return {
    code: proc.exitCode,
    output: `${proc.stdout}\n${proc.stderr}`,
    mutatedSource,
  };
}

const failedRow = (run: OverlayRun, name: string): boolean =>
  run.output.split("\n").some((l) => l.startsWith("(fail)") && l.includes(name));
/**
 * Summary counts ("N pass" / "N fail"). Bun prints these in every environment,
 * whereas "(pass)" rows are suppressed when it detects an agent session
 * (CLAUDECODE=1) — so the controls grade on counts, never on pass rows.
 * "(fail)" rows are printed in both modes.
 */
const count = (run: OverlayRun, kind: "pass" | "fail"): number => {
  const m = run.output.match(new RegExp(`^\\s*(\\d+) ${kind}\\b`, "m"));
  return m === null ? -1 : Number.parseInt(m[1]!, 10);
};

const BREAK_TARGET = "AC-STE-664." + "3";
const RETRY_TARGET = "AC-STE-664." + "6";

describe("AC-STE-664.9 — the break rewrite and the retry are mutation-verified", () => {
  test(
    "control: the unmutated overlay passes the break-rewrite tests",
    () => {
      const run = runOverlay(BREAK_TARGET, null);
      // Non-vacuous: a filter matching zero tests also exits 0.
      expect(count(run, "pass"), run.output.slice(-800)).toBeGreaterThan(0);
      expect(count(run, "fail"), run.output.slice(-800)).toBe(0);
      expect(failedRow(run, BREAK_TARGET)).toBe(false);
      expect(run.code).toBe(0);
    },
    120_000,
  );

  test(
    "dropping the <break> rewrite turns the break-rewrite tests red",
    () => {
      const marker = "/* MUTATION:STE-664.9:no-break-rewrite */";
      const run = runOverlay(BREAK_TARGET, {
        moduleRel: "adapters/_shared/src/video/tts_elevenlabs.ts",
        find: "export function rewriteBreaksForElevenLabs(",
        repl:
          `export function rewriteBreaksForElevenLabs(text: string): string { ${marker} return text; }\n` +
          "function __unmutated_rewriteBreaksForElevenLabs(",
        marker,
      });
      expect(run.mutatedSource).toContain(marker);
      expect(failedRow(run, BREAK_TARGET), run.output.slice(-800)).toBe(true);
      expect(count(run, "fail")).toBeGreaterThan(0);
      expect(run.code).not.toBe(0);
    },
    120_000,
  );

  test(
    "control: the unmutated overlay passes the retry tests",
    () => {
      const run = runOverlay(RETRY_TARGET, null);
      // Non-vacuous: a filter matching zero tests also exits 0.
      expect(count(run, "pass"), run.output.slice(-800)).toBeGreaterThan(0);
      expect(count(run, "fail"), run.output.slice(-800)).toBe(0);
      expect(failedRow(run, RETRY_TARGET)).toBe(false);
      expect(run.code).toBe(0);
    },
    120_000,
  );

  test(
    "skipping the retry turns the retry-schedule tests red",
    () => {
      const marker = "/* MUTATION:STE-664.9:no-retry */";
      const run = runOverlay(RETRY_TARGET, {
        moduleRel: "adapters/_shared/src/video/tts.ts",
        find: "export async function fetchWithRetry(",
        repl:
          `export async function fetchWithRetry(...args: any[]): Promise<any> { ${marker} return args[0](args[1], args[2]); }\n` +
          "async function __unmutated_fetchWithRetry(",
        marker,
      });
      expect(run.mutatedSource).toContain(marker);
      expect(failedRow(run, RETRY_TARGET), run.output.slice(-800)).toBe(true);
      expect(count(run, "fail")).toBeGreaterThan(0);
      expect(run.code).not.toBe(0);
    },
    120_000,
  );
});

// ===========================================================================
// AC-STE-663.8 (cross-FR) — a key planted in `.dpt/.env` leaks nowhere
// ===========================================================================
//
// The key travels the real path: planted in a temp project's `.dpt/.env`, read
// back with `readVideoKeys`, handed to each provider, then driven through a
// success, a 401, a 429-exhausted retry and a network failure whose error
// message carries the request URL. No surfaced message and no file under the
// project (bar the planted `.env` itself) may carry the key. The named sweep at
// the end grades every refusal and every project root this suite produced, and
// a planted-leak control proves the sweep can fail.

/** Plant SENTINEL as both provider keys in a fresh project's `.dpt/.env`; return the root. */
function plantEnvProject(): string {
  const root = makeProject();
  const envPath = dptEnvPath(root);
  mkdirSync(dirname(envPath), { recursive: true });
  writeFileSync(
    envPath,
    `# video provider keys\nELEVENLABS_API_KEY="${SENTINEL}"\nGOOGLE_TTS_API_KEY=${SENTINEL}\n`,
  );
  plantedEnvFiles.push(envPath);
  return root;
}

/** An injected fetch that fails the way a real network failure does: its message names the URL. */
function throwingFetch(): { fetch: (url: string, init: RequestInit) => Promise<Response>; urls: string[] } {
  const urls: string[] = [];
  return {
    urls,
    fetch: async (url: string) => {
      urls.push(String(url));
      throw new TypeError(`fetch failed: unable to connect to ${url}`);
    },
  };
}

const ENV_KEY_VAR: Record<ProviderName, string> = {
  elevenlabs: "ELEVENLABS_API_KEY",
  google: "GOOGLE_TTS_API_KEY",
};

async function makeEnvProvider(
  name: ProviderName,
  fetch: (url: string, init: RequestInit) => Promise<Response>,
): Promise<{ provider: any; waits: number[]; projectRoot: string }> {
  const spec = PROVIDERS[name];
  const projectRoot = plantEnvProject();
  const keys = (await loadKeys()).readVideoKeys(projectRoot);
  const apiKey = keys[ENV_KEY_VAR[name]];
  // Precondition: the key reaching the provider IS the planted sentinel.
  expect(apiKey).toBe(SENTINEL);
  const { wait, waits } = waitRecorder();
  const opts: Record<string, unknown> = { apiKey, voice: spec.voice, projectRoot, slug: SLUG, fetch, wait };
  if (spec.model !== undefined) opts.model = spec.model;
  return { provider: (await spec.load())[spec.factory](opts), waits, projectRoot };
}

async function envMusic(fetch: (url: string, init: RequestInit) => Promise<Response>): Promise<{
  run: () => Promise<string | null>;
  waits: number[];
  projectRoot: string;
}> {
  const projectRoot = plantEnvProject();
  const keys = (await loadKeys()).readVideoKeys(projectRoot);
  expect(keys.ELEVENLABS_API_KEY).toBe(SENTINEL);
  const { wait, waits } = waitRecorder();
  const music = await loadMusic();
  const run = () =>
    music.resolveMusicTrack({
      music: { source: "elevenlabs" },
      projectRoot,
      slug: SLUG,
      plannedSeconds: 12,
      apiKey: keys.ELEVENLABS_API_KEY,
      fetch,
      wait,
    });
  return { run, waits, projectRoot };
}

const MUSIC_OK: Reply = () =>
  new Response(Buffer.from("ID3\x04\x00planted-key-music", "latin1"), {
    status: 200,
    headers: { "content-type": "audio/mpeg" },
  });

describe("AC-STE-663.8 — a key planted in .dpt/.env reaches no refusal and no written file", () => {
  for (const name of ["elevenlabs", "google"] as const) {
    const spec = PROVIDERS[name];

    test(`${name}: success with the .env key writes files free of the key`, async () => {
      const { fetch, calls } = recorder([jsonReply(spec.response)]);
      const { provider, projectRoot } = await makeEnvProvider(name, fetch);
      const result = await provider.synthesize({ index: 1, text: FIXTURE_TEXT });
      expect(existsSync(result.audioPath)).toBe(true);
      expect(calls.length).toBe(1);
      expect(walkFiles(videoWorkDir(projectRoot, SLUG)).length).toBeGreaterThan(0);
      expect(sentinelLeaks(projectRoot, plantedEnvFiles)).toEqual([]);
    });

    test(`${name}: 401 with the .env key refuses without the key`, async () => {
      const { fetch } = recorder([statusReply(401)]);
      const { provider, projectRoot } = await makeEnvProvider(name, fetch);
      const msg = await catchRefusal(provider.synthesize({ index: 1, text: FIXTURE_TEXT }));
      expect(msg).toContain(spec.keyVar);
      expect(msg).not.toContain(SENTINEL);
      expect(sentinelLeaks(projectRoot, plantedEnvFiles)).toEqual([]);
    });

    test(`${name}: 429 exhausted with the .env key refuses without the key`, async () => {
      const { fetch, calls } = recorder([statusReply(429)]);
      const { provider, waits, projectRoot } = await makeEnvProvider(name, fetch);
      const msg = await catchRefusal(provider.synthesize({ index: 1, text: FIXTURE_TEXT }));
      expect(calls.length).toBe(4);
      expect(waits).toEqual([1000, 2000, 4000]);
      expect(msg).not.toContain(SENTINEL);
      expect(sentinelLeaks(projectRoot, plantedEnvFiles)).toEqual([]);
    });

    test(`${name}: a network failure whose message names the URL surfaces no key`, async () => {
      const { fetch, urls } = throwingFetch();
      const { provider, projectRoot } = await makeEnvProvider(name, fetch);
      const msg = await catchRefusal(provider.synthesize({ index: 1, text: FIXTURE_TEXT }));
      // The injected failure really did echo the request URL.
      expect(urls.length).toBeGreaterThan(0);
      expect(msg).not.toContain(SENTINEL);
      expect(msg).not.toContain(encodeURIComponent(SENTINEL));
      expect(sentinelLeaks(projectRoot, plantedEnvFiles)).toEqual([]);
    });
  }

  test("music: success with the .env key writes a track free of the key", async () => {
    const { fetch, calls } = recorder([MUSIC_OK]);
    const { run, projectRoot } = await envMusic(fetch);
    const track = await run();
    expect(typeof track).toBe("string");
    expect(existsSync(track!)).toBe(true);
    expect(calls[0]!.headers.get("xi-api-key")).toBe(SENTINEL);
    expect(sentinelLeaks(projectRoot, plantedEnvFiles)).toEqual([]);
  });

  test("music: 401 refuses at once, naming ELEVENLABS_API_KEY, without the key", async () => {
    const { fetch, calls } = recorder([statusReply(401)]);
    const { run, waits, projectRoot } = await envMusic(fetch);
    const msg = await catchRefusal(run());
    expectNfr10(msg);
    expect(msg.split("\n")[0]!).toMatch(/elevenlabs/i);
    expect(msg).toContain("ELEVENLABS_API_KEY");
    expect(msg).not.toContain(SENTINEL);
    expect(calls.length).toBe(1);
    expect(waits).toEqual([]);
    expect(sentinelLeaks(projectRoot, plantedEnvFiles)).toEqual([]);
  });

  test("music: 429 exhausted after 1000, 2000, 4000 ms refuses without the key", async () => {
    const { fetch, calls } = recorder([statusReply(429)]);
    const { run, waits, projectRoot } = await envMusic(fetch);
    const msg = await catchRefusal(run());
    expectNfr10(msg);
    expect(msg).not.toContain(SENTINEL);
    expect(calls.length).toBe(4);
    expect(waits).toEqual([1000, 2000, 4000]);
    expect(walkFiles(videoWorkDir(projectRoot, SLUG))).toEqual([]);
    expect(sentinelLeaks(projectRoot, plantedEnvFiles)).toEqual([]);
  });

  test("music: a network failure whose message names the URL surfaces no key", async () => {
    const { fetch, urls } = throwingFetch();
    const { run, projectRoot } = await envMusic(fetch);
    const msg = await catchRefusal(run());
    expect(urls.length).toBeGreaterThan(0);
    expect(msg).not.toContain(SENTINEL);
    expect(sentinelLeaks(projectRoot, plantedEnvFiles)).toEqual([]);
  });
});

// The sweep runs last (bun runs a file's tests in declaration order), so it grades
// every refusal and every project root the suite above produced.
describe("AC-STE-663.8 — named leak sweep over the whole suite", () => {
  test("planted-leak control: the sweep finds a key planted in a written file and in a message", () => {
    const root = makeTmpRoot("ste663-leak-control-");
    const leaked = join(root, "segments", "1.json");
    mkdirSync(dirname(leaked), { recursive: true });
    writeFileSync(leaked, JSON.stringify({ note: `key=${SENTINEL}` }));
    writeFileSync(join(root, "clean.json"), "{}");
    expect(sentinelLeaks(root)).toEqual([join("segments", "1.json")]);
    // The exclusion list is the only way a carrying file escapes.
    expect(sentinelLeaks(root, [leaked])).toEqual([]);
    const outputs = ["clean refusal", `Context: key=${SENTINEL}`];
    expect(outputs.filter((o) => o.includes(SENTINEL)).length).toBe(1);
  });

  test("the suite exercised planted .env keys and captured refusals to grade", () => {
    expect(plantedEnvFiles.length).toBeGreaterThan(0);
    for (const env of plantedEnvFiles) expect(readFileSync(env, "utf8")).toContain(SENTINEL);
    expect(capturedOutputs.length).toBeGreaterThan(0);
  });

  test("no captured refusal carries the key", () => {
    const leaking = capturedOutputs.filter((o) => o.includes(SENTINEL));
    expect(leaking).toEqual([]);
  });

  test("no file under any project root carries the key (bar the planted .env)", () => {
    const leaks: string[] = [];
    for (const root of tmpRoots) {
      if (!root.includes("ste664-proj-")) continue;
      for (const f of sentinelLeaks(root, plantedEnvFiles)) leaks.push(join(root, f));
    }
    expect(leaks).toEqual([]);
  });
});

// ===========================================================================
// HARDEN-H — AC-STE-663.8 / STE-664 key hygiene: the Google key rides a header
// ===========================================================================

describe("HARDEN-H — the Google adapter sends its key in `x-goog-api-key`, never in the URL", () => {
  test("HARDEN-H the request URL carries no `key=` and no sentinel; the header carries the key", async () => {
    const { provider, calls } = await makeProvider("google", [jsonReply(G_RESPONSE)]);
    await provider.synthesize({ index: 1, text: FIXTURE_TEXT });
    expect(calls.length).toBe(1);
    const req = calls[0]!;
    expect(req.url).not.toContain("key=");
    expect(req.url).not.toContain(SENTINEL);
    expect(req.url).not.toContain(encodeURIComponent(SENTINEL));
    expect(new URL(req.url).searchParams.has("key")).toBe(false);
    expect(req.headers.get("x-goog-api-key")).toBe(SENTINEL);
  });
});
