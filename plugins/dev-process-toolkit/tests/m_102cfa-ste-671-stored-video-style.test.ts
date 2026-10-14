// STE-671 — stored video style: music prompt and narration tone.
//
//   AC-STE-671.1 — parseVideoStyle accepts music.prompt / narration.tone (strings ≤ 500), refuses longer or
//                  non-string values naming the key path, and still refuses any other unknown key.
//   AC-STE-671.2 — defaults: the upbeat music prompt (byte-for-byte) and an empty narration.tone; no source
//                  file under adapters/ carries the old calm default.
//   AC-STE-671.3 — the music stage sends the stored prompt as the ElevenLabs request's prompt, exactly.
//   AC-STE-671.4 — audio tags: ElevenLabs keeps them, Google strips them; [short pause] unchanged on both.
//   AC-STE-671.5 — video_init writes both keys into a fresh style.yaml, which parses back to the defaults.
//   AC-STE-671.6 — the style refusal names its file through videoStylePath (follows the helper).
//   AC-STE-671.7 — skills/video/SKILL.md: tone as house style, tone question skipped, audio-tag rule; NFR-1 cap.
//   AC-STE-671.8 — docs/video-reference.md documents both keys, caps, defaults and the per-provider tag rule.
//   AC-STE-671.9 — mutation battery in a temp overlay (the working tree is never touched).
//
// No network: every provider call goes through an injected, recording fetch.

import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { dptEnvPath, videoConfigPath, videoStylePath, videoWorkDir } from "../adapters/_shared/src/dpt_paths";
import { writeDptGitignore } from "../adapters/_shared/src/setup/dpt_gitignore";
import { type SyncRunner, videoReadiness } from "../adapters/_shared/src/video/readiness";
import { parseVideoStyle, readVideoStyle, VIDEO_STYLE_DEFAULTS } from "../adapters/_shared/src/video/style";
import { createElevenLabsTts } from "../adapters/_shared/src/video/tts_elevenlabs";
import { createGoogleTts } from "../adapters/_shared/src/video/tts_google";
import { videoInit } from "../adapters/_shared/src/video_init";
import { runVideoStage } from "../adapters/_shared/src/video_pipeline";
import { mutateInRegion } from "./_sited-mutation";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const SRC = join(PLUGIN_ROOT, "adapters", "_shared", "src");
const SKILL_MD = join(PLUGIN_ROOT, "skills", "video", "SKILL.md");
const VIDEO_REFERENCE = join(PLUGIN_ROOT, "docs", "video-reference.md");
const THIS_FILE_REL = "tests/m_102cfa-ste-671-stored-video-style.test.ts";

/** NFR-1 — the cap `tests/skill-nfr-1-length.test.ts` enforces. */
const SKILL_LINE_CAP = 358;

/** The upbeat default prompt quoted in the FR's Requirement, byte-for-byte. */
const UPBEAT_DEFAULT =
  "Upbeat, modern instrumental track for a tech product explainer: punchy drums, bright synths, positive energy, steady driving tempo, no vocals.";
const OLD_CALM = "Calm, unobtrusive";

const SLUG = "styled-feature";
const FAKE_KEY = "sk-ste671-test-key";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const tmpRoots: string[] = [];

function makeTmpRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  tmpRoots.push(root);
  return root;
}

afterAll(() => {
  for (const root of tmpRoots) {
    rmSync(root, { recursive: true, force: true });
    if (existsSync(root)) Bun.spawnSync(["rm", "-rf", root]);
  }
});

function git(cwd: string, args: string[]): number {
  const proc = Bun.spawnSync(["git", "-c", "user.email=t@t.test", "-c", "user.name=t", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
  });
  return proc.exitCode ?? -1;
}

function writeFile(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
}

/** Run `fn` and return the thrown error (fails the test when nothing throws). */
function thrown(fn: () => unknown): Error & { keyPath?: string } {
  try {
    fn();
  } catch (e) {
    return e as Error & { keyPath?: string };
  }
  throw new Error("expected a refusal, but the call returned");
}

interface RecordedRequest {
  url: string;
  body: any;
}

function recordingFetch(reply: () => Response): {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  calls: RecordedRequest[];
} {
  const calls: RecordedRequest[] = [];
  const fetch = async (url: string, init: RequestInit): Promise<Response> => {
    const raw = init?.body === undefined || init.body === null ? "" : String(init.body);
    calls.push({ url: String(url), body: raw === "" ? null : JSON.parse(raw) });
    return reply();
  };
  return { fetch, calls };
}

const noWait = async (_ms: number): Promise<void> => {};

const MUSIC_CONFIG = [
  "tts:",
  "  provider: elevenlabs",
  "  voice: narrator",
  "recorder:",
  "  kind: web",
  "music:",
  "  source: elevenlabs",
  "",
].join("\n");

/**
 * Readiness checks `ffmpeg -filters` for `drawtext` while captions are on
 * (AC-STE-675.3). These tests are about the music prompt, not captions, so every
 * readiness / stage call answers that probe with a filter list that HAS
 * drawtext — the suite never depends on the host's ffmpeg build.
 */
const FFMPEG_WITH_DRAWTEXT: SyncRunner = () => ({
  code: 0,
  stdout: " T.C drawtext          V->V       Draw text on top of video frames using libfreetype library.\n",
  stderr: "",
});

/** A ready git project with music.source elevenlabs, an approved script and the music stage's inputs. */
async function musicReadyProject(prefix: string, styleYaml: string | null): Promise<{ root: string; workDir: string }> {
  const root = makeTmpRoot(prefix);
  expect(git(root, ["init", "-q"])).toBe(0);
  writeDptGitignore(root);
  writeFile(videoConfigPath(root), MUSIC_CONFIG);
  writeFile(dptEnvPath(root), `ELEVENLABS_API_KEY=${FAKE_KEY}\n`);
  if (styleYaml !== null) writeFile(videoStylePath(root), styleYaml);
  expect(videoReadiness(root, { ffmpegRunner: FFMPEG_WITH_DRAWTEXT })).toEqual({ ready: true, reasons: [] });

  const workDir = videoWorkDir(root, SLUG);
  writeFile(join(workDir, "script.md"), "# Script\n\nShot 1: open the dashboard.\n");
  await runVideoStage({ projectRoot: root, slug: SLUG, stage: "approve-script", deps: { ffmpegRunner: FFMPEG_WITH_DRAWTEXT } });
  writeFile(join(workDir, "segments.json"), JSON.stringify([{ index: 1, text: "Meet the pipeline." }]));
  writeFile(
    join(workDir, "alignment", "1.json"),
    JSON.stringify([
      { word: "Meet", start: 0, end: 0.3 },
      { word: "the", start: 0.35, end: 0.5 },
      { word: "pipeline.", start: 0.55, end: 1.25 },
    ]),
  );
  return { root, workDir };
}

async function runMusicStage(root: string): Promise<RecordedRequest[]> {
  const { fetch, calls } = recordingFetch(
    () => new Response(new Uint8Array([0x49, 0x44, 0x33]), { status: 200, headers: { "content-type": "audio/mpeg" } }),
  );
  await runVideoStage({ projectRoot: root, slug: SLUG, stage: "music", deps: { fetch, ffmpegRunner: FFMPEG_WITH_DRAWTEXT } });
  return calls;
}

const AUDIO_B64 = Buffer.from("ID3\x04\x00ste671-audio", "latin1").toString("base64");

function elevenLabsReply(): Response {
  return new Response(
    JSON.stringify({
      audio_base64: AUDIO_B64,
      alignment: { characters: [], character_start_times_seconds: [], character_end_times_seconds: [] },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function googleReply(): Response {
  return new Response(JSON.stringify({ audioContent: AUDIO_B64, timepoints: [] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

async function elevenLabsText(text: string): Promise<string> {
  const { fetch, calls } = recordingFetch(elevenLabsReply);
  const tts = createElevenLabsTts({
    apiKey: FAKE_KEY,
    voice: "voice-1",
    model: "eleven_v4",
    projectRoot: makeTmpRoot("ste671-el-"),
    slug: SLUG,
    fetch,
    wait: noWait,
  });
  await tts.synthesize({ index: 1, text });
  expect(calls).toHaveLength(1);
  return calls[0]!.body.text as string;
}

async function googleSynthesis(text: string): Promise<{ ssml: string; words: string[] }> {
  const { fetch, calls } = recordingFetch(googleReply);
  const tts = createGoogleTts({
    apiKey: FAKE_KEY,
    voice: "en-US-Neural2-F",
    projectRoot: makeTmpRoot("ste671-g-"),
    slug: SLUG,
    fetch,
    wait: noWait,
  });
  const result = await tts.synthesize({ index: 1, text });
  expect(calls).toHaveLength(1);
  return { ssml: calls[0]!.body.input.ssml as string, words: result.alignment.map((w) => w.word) };
}

const read = (p: string): string => readFileSync(p, "utf-8");

/** The body under the first `###` heading matching `re`, up to the next `##`/`###` heading. */
function sectionUnder(body: string, re: RegExp): string {
  const lines = body.split("\n");
  const start = lines.findIndex((l) => /^###\s/.test(l) && re.test(l));
  if (start < 0) return "";
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{2,3}\s/.test(lines[i]!)) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walkFiles(full));
    else out.push(full);
  }
  return out;
}

// ===========================================================================
// AC-STE-671.1 — the closed schema grows by exactly two capped string keys
// ===========================================================================

describe("AC-STE-671.1 — parseVideoStyle accepts music.prompt and narration.tone", () => {
  test("both keys are accepted and returned verbatim", () => {
    const style = parseVideoStyle(
      ["music:", "  prompt: Lo-fi beats with soft keys", "narration:", "  tone: dry, deadpan, a little wry", ""].join("\n"),
    ) as any;
    expect(style.music.prompt).toBe("Lo-fi beats with soft keys");
    expect(style.narration.tone).toBe("dry, deadpan, a little wry");
    // The neighbour key in the same block keeps working.
    expect(style.music.level_db).toBe(VIDEO_STYLE_DEFAULTS.music.level_db);
  });

  test("a value of exactly 500 characters is accepted for both keys", () => {
    const v = "a".repeat(500);
    const style = parseVideoStyle(`music:\n  prompt: ${v}\nnarration:\n  tone: ${v}\n`) as any;
    expect(style.music.prompt).toBe(v);
    expect(style.narration.tone).toBe(v);
  });

  // Hardening: the cap counts characters (code points), not UTF-16 units.
  test("500 emoji are 500 characters and are accepted; 501 refuse", () => {
    const v = "🎵".repeat(500);
    expect(v.length).toBe(1000);
    const style = parseVideoStyle(`narration:\n  tone: ${v}\n`) as any;
    expect(style.narration.tone).toBe(v);
    expect(thrown(() => parseVideoStyle(`narration:\n  tone: ${v}🎵\n`)).keyPath).toBe("narration.tone");
  });

  for (const path of ["music.prompt", "narration.tone"] as const) {
    const [block, key] = path.split(".") as [string, string];

    test(`a 501-character ${path} refuses, naming the key path`, () => {
      const err = thrown(() => parseVideoStyle(`${block}:\n  ${key}: ${"b".repeat(501)}\n`));
      expect(err.keyPath).toBe(path);
      expect(err.message).toMatch(/^Refusing: /m);
      expect(err.message).toContain(`\`${path}\``);
      expect(err.message).toMatch(/500/);
      expect(err.message).not.toContain("b".repeat(501));
    });

    test(`a non-string ${path} refuses, naming the key path`, () => {
      for (const bad of ["42", "true", "[a, b]", "{ x: 1 }"]) {
        const err = thrown(() => parseVideoStyle(`${block}:\n  ${key}: ${bad}\n`));
        expect(err.keyPath).toBe(path);
        expect(err.message).toContain(`\`${path}\``);
      }
    });
  }

  test("any other unknown key still refuses — in music, in narration and at the root", () => {
    expect(thrown(() => parseVideoStyle("music:\n  mood: happy\n")).keyPath).toBe("music.mood");
    expect(thrown(() => parseVideoStyle("narration:\n  pitch: high\n")).keyPath).toBe("narration.pitch");
    expect(thrown(() => parseVideoStyle("voice_tone: warm\n")).keyPath).toBe("voice_tone");
  });

  test("narration must be a mapping", () => {
    expect(thrown(() => parseVideoStyle("narration: chirpy\n")).keyPath).toBe("narration");
  });
});

// ===========================================================================
// AC-STE-671.2 — defaults
// ===========================================================================

describe("AC-STE-671.2 — the upbeat default prompt and an empty tone", () => {
  test("VIDEO_STYLE_DEFAULTS carries the upbeat prompt byte-for-byte and an empty tone", () => {
    const d = VIDEO_STYLE_DEFAULTS as any;
    expect(d.music.prompt).toBe(UPBEAT_DEFAULT);
    expect(d.narration).toEqual({ tone: "" });
  });

  test("an absent style.yaml yields the default prompt and an empty tone", () => {
    const root = makeTmpRoot("ste671-nostyle-");
    expect(existsSync(videoStylePath(root))).toBe(false);
    const style = readVideoStyle(root) as any;
    expect(style.music.prompt).toBe(UPBEAT_DEFAULT);
    expect(style.narration.tone).toBe("");
  });

  test("a style.yaml without music.prompt (and without narration) yields the defaults", () => {
    const root = makeTmpRoot("ste671-partial-");
    writeFile(videoStylePath(root), "music:\n  level_db: -18\nhumor: none\n");
    const style = readVideoStyle(root) as any;
    expect(style.music.level_db).toBe(-18);
    expect(style.music.prompt).toBe(UPBEAT_DEFAULT);
    expect(style.narration.tone).toBe("");
  });

  test("an empty document parses to the defaults, both keys included", () => {
    const style = parseVideoStyle("") as any;
    expect(style.music.prompt).toBe(UPBEAT_DEFAULT);
    expect(style.narration.tone).toBe("");
  });

  test(`no source file under adapters/ contains "${OLD_CALM}"`, () => {
    const adapters = join(PLUGIN_ROOT, "adapters");
    const files = walkFiles(adapters);
    // Control: the sweep really walks the music module.
    expect(files).toContain(join(SRC, "video", "music.ts"));
    const hits = files.filter((f) => read(f).includes(OLD_CALM));
    expect(hits).toEqual([]);
  });
});

// ===========================================================================
// AC-STE-671.3 — the music stage sends the stored prompt
// ===========================================================================

const MUSIC_AC = "AC-STE-671." + "3";

describe(`${MUSIC_AC} — the music stage's request prompt is the stored music.prompt`, () => {
  test(`${MUSIC_AC} a stored music.prompt is sent exactly, with no prefix or suffix`, async () => {
    const stored = "Chiptune arpeggios over a bouncy bassline, cheerful and quick";
    const { root, workDir } = await musicReadyProject("ste671-music-stored-", `music:\n  prompt: ${stored}\n`);
    const calls = await runMusicStage(root);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain("/v1/music");
    expect(calls[0]!.body.prompt).toBe(stored);
    expect(calls[0]!.body.music_length_ms).toBe(1250);
    expect(existsSync(join(workDir, "music.mp3"))).toBe(true);
  });

  test(`${MUSIC_AC} with no stored prompt, the request carries the upbeat default exactly`, async () => {
    const { root } = await musicReadyProject("ste671-music-default-", null);
    const calls = await runMusicStage(root);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body.prompt).toBe(UPBEAT_DEFAULT);
  });

  test(`${MUSIC_AC} a style.yaml without music.prompt also sends the default`, async () => {
    const { root } = await musicReadyProject("ste671-music-partial-", "music:\n  level_db: -12\n");
    const calls = await runMusicStage(root);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body.prompt).toBe(UPBEAT_DEFAULT);
  });

  // Hardening: only a generated track reads the prompt, so a malformed style.yaml
  // never refuses a music stage that does not use it.
  test(`${MUSIC_AC} music.source none never reads style.yaml (a malformed one does not refuse)`, async () => {
    const { root, workDir } = await musicReadyProject("ste671-music-none-", "music:\n  prompt: 7\n");
    writeFile(videoConfigPath(root), MUSIC_CONFIG.replace("source: elevenlabs", "source: none"));
    expect(() => readVideoStyle(root)).toThrow("music.prompt");
    const calls = await runMusicStage(root);
    expect(calls).toHaveLength(0);
    expect(existsSync(join(workDir, "music.mp3"))).toBe(false);
  });
});

// ===========================================================================
// AC-STE-671.4 — audio tags per provider
// ===========================================================================

const TAG_AC = "AC-STE-671." + "4";
const TAGGED = "Done [laughs] really [excited] done";

describe(`${TAG_AC} — square-bracket audio tags: ElevenLabs keeps them, Google strips them`, () => {
  test(`${TAG_AC} ElevenLabs sends both tags unchanged`, async () => {
    expect(await elevenLabsText(TAGGED)).toBe(TAGGED);
  });

  test(`${TAG_AC} ElevenLabs keeps the existing [short pause] handling`, async () => {
    expect(await elevenLabsText('Wait <break time="1s"/> now')).toBe("Wait [short pause] now");
    expect(await elevenLabsText("Wait [short pause] now [laughs]")).toBe("Wait [short pause] now [laughs]");
  });

  test(`${TAG_AC} Google strips both tags, leaving no doubled spaces`, async () => {
    const { ssml, words } = await googleSynthesis(TAGGED);
    expect(words).toEqual(["Done", "really", "done"]);
    expect(ssml).not.toContain("[");
    expect(ssml).not.toContain("]");
    expect(ssml).not.toContain("laughs");
    expect(ssml).not.toContain("excited");
    expect(ssml).not.toMatch(/ {2}/);
  });

  test(`${TAG_AC} Google keeps the existing [short pause] -> SSML break handling`, async () => {
    const { ssml, words } = await googleSynthesis("Wait [short pause] now [laughs] ok");
    expect(ssml).toContain('<break time="400ms"/>');
    expect(ssml).not.toContain("[");
    expect(ssml).not.toMatch(/ {2}/);
    expect(words).toEqual(["Wait", "now", "ok"]);
  });
});

// ===========================================================================
// AC-STE-671.5 — video_init writes both keys
// ===========================================================================

describe("AC-STE-671.5 — video_init writes music.prompt and narration.tone", () => {
  test("a fresh style.yaml spells out both keys and parses back to the defaults", () => {
    const root = makeTmpRoot("ste671-init-");
    expect(git(root, ["init", "-q"])).toBe(0);
    videoInit(root, "elevenlabs", "web", "none");
    const raw = read(videoStylePath(root));
    const doc = Bun.YAML.parse(raw) as any;
    expect(doc.music.prompt).toBe(UPBEAT_DEFAULT);
    expect(doc.narration.tone).toBe("");
    expect(parseVideoStyle(raw)).toEqual(VIDEO_STYLE_DEFAULTS);
  });
});

// ===========================================================================
// AC-STE-671.6 — the style refusal names its file through videoStylePath
// ===========================================================================

describe("AC-STE-671.6 — the style refusal names its file through videoStylePath", () => {
  test("the refusal's file= names videoStylePath relative to the project root", () => {
    const display = videoStylePath(".").replace(/^\.\//, "");
    const err = thrown(() => parseVideoStyle("bogus_key: 1\n"));
    expect(err.message).toContain(`file=${display}`);
  });

  test(
    "changing the path helper's output moves the refusal's file name with it",
    () => {
      const root = makeTmpRoot("ste671-pathhelper-");
      const overlaySrc = join(root, "src");
      const cp = Bun.spawnSync(["cp", "-R", SRC, overlaySrc], { stdout: "pipe", stderr: "pipe" });
      expect(cp.exitCode).toBe(0);
      const pathsFile = join(overlaySrc, "dpt_paths.ts");
      const before = read(pathsFile);
      const after = mutateInRegion(before, 0, before.length, 'return join(videoRoot(projectRoot), "style.yaml");',
        'return join(videoRoot(projectRoot), "house-look-ste671.yaml");', { label: "dpt_paths.ts videoStylePath" });
      writeFileSync(pathsFile, after);
      expect(read(pathsFile)).toContain("house-look-ste671.yaml");

      const script = join(root, "probe.ts");
      writeFileSync(
        script,
        [
          `import { parseVideoStyle } from ${JSON.stringify(join(overlaySrc, "video", "style.ts"))};`,
          "try { parseVideoStyle('bogus_key: 1\\n'); console.log('NO-REFUSAL'); }",
          "catch (e) { console.log((e as Error).message); }",
          "",
        ].join("\n"),
      );
      const proc = Bun.spawnSync([process.execPath, script], { cwd: root, stdout: "pipe", stderr: "pipe" });
      const out = proc.stdout.toString() + proc.stderr.toString();
      expect(out).toMatch(/^Refusing: /m);
      expect(out).toContain("house-look-ste671.yaml");
      expect(out).not.toContain("file=video/style.yaml");
    },
    60_000,
  );
});

// ===========================================================================
// AC-STE-671.7 — the skill text
// ===========================================================================

describe("AC-STE-671.7 — skills/video/SKILL.md reads narration.tone and documents the audio-tag rule", () => {
  const skill = (): string => read(SKILL_MD);

  test("the script step reads narration.tone as house style", () => {
    const script = sectionUnder(skill(), /\bScript\b(?!\s+approval)/i);
    expect(script.length).toBeGreaterThan(0);
    expect(script).toContain("narration.tone");
    expect(script).toMatch(/house style/i);
  });

  test("the brief skips the tone question when narration.tone is non-empty", () => {
    const brief = sectionUnder(skill(), /\bBrief\b/i);
    expect(brief.length).toBeGreaterThan(0);
    expect(brief).toContain("narration.tone");
    const line = brief.split("\n").find((l) => l.includes("narration.tone")) ?? "";
    expect(line).toMatch(/\b(skip|do not ask|don't ask|never ask)\b/i);
    expect(line).toMatch(/non-empty|is set|when set|not empty/i);
  });

  test("the audio-tag rule is documented: ElevenLabs keeps square-bracket tags, Google strips them", () => {
    const body = skill();
    expect(body).toMatch(/\[(excited|laughs)\]/);
    const para = body.split(/\n\s*\n/).find((p) => /audio tag/i.test(p)) ?? "";
    expect(para).toMatch(/ElevenLabs/);
    expect(para).toMatch(/Google/);
    expect(para).toMatch(/strip/i);
  });

  test(`the skill stays within the NFR-1 cap (≤ ${SKILL_LINE_CAP} lines)`, () => {
    expect(skill().split("\n").length).toBeLessThanOrEqual(SKILL_LINE_CAP);
  });
});

// ===========================================================================
// AC-STE-671.8 — the reference doc
// ===========================================================================

describe("AC-STE-671.8 — docs/video-reference.md documents both keys and the tag rule", () => {
  const doc = (): string => read(VIDEO_REFERENCE);

  test("music.prompt is documented with its 500-character cap and the upbeat default", () => {
    const body = doc();
    const para = body.split(/\n\s*\n/).find((p) => p.includes("music.prompt")) ?? "";
    expect(para).toMatch(/500/);
    expect(body).toContain(UPBEAT_DEFAULT);
  });

  test("narration.tone is documented with its 500-character cap and the empty default", () => {
    const para = doc().split(/\n\s*\n/).find((p) => p.includes("narration.tone") && /500/.test(p)) ?? "";
    expect(para).toContain("narration.tone");
    expect(para).toMatch(/empty/i);
  });

  test("the per-provider tag rule is documented", () => {
    const para = doc().split(/\n\s*\n/).find((p) => /tag/i.test(p) && /strip/i.test(p)) ?? "";
    expect(para).toMatch(/ElevenLabs/);
    expect(para).toMatch(/Google/);
    expect(para).toMatch(/\[[a-z ]+\]/);
  });
});

// ===========================================================================
// AC-STE-671.9 — mutation battery in a temp overlay
// ===========================================================================

interface OverlayRun {
  code: number;
  output: string;
  mutatedSource: string | null;
}

interface OverlayMutation {
  moduleRel: string;
  find: string;
  repl: string;
  append?: string;
  marker: string;
}

/**
 * Materialise a temp overlay of the plugin (adapters/_shared/src, this suite, the
 * sited-mutation helper), optionally mutate one module IN THE OVERLAY, assert the
 * mutation landed, then run this suite filtered to `filter`.
 */
function runOverlay(filter: string, mutation: OverlayMutation | null): OverlayRun {
  const root = makeTmpRoot("ste671-overlay-");
  const plugin = join(root, "plugins", "dev-process-toolkit");
  mkdirSync(join(plugin, "adapters", "_shared"), { recursive: true });
  mkdirSync(join(plugin, "tests"), { recursive: true });
  const copy = Bun.spawnSync(
    [
      "bash",
      "-c",
      [
        "set -e",
        `cp -R ${JSON.stringify(SRC)} ${JSON.stringify(join(plugin, "adapters", "_shared"))}/`,
        `cp ${JSON.stringify(join(PLUGIN_ROOT, THIS_FILE_REL))} ${JSON.stringify(join(plugin, "tests"))}/`,
        `cp ${JSON.stringify(join(PLUGIN_ROOT, "tests", "_sited-mutation.ts"))} ${JSON.stringify(join(plugin, "tests"))}/`,
      ].join("; "),
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (copy.exitCode !== 0) throw new Error(`overlay copy failed (exit ${copy.exitCode}): ${copy.stderr.toString().trim()}`);
  if (existsSync(join(REPO_ROOT, "node_modules"))) symlinkSync(join(REPO_ROOT, "node_modules"), join(root, "node_modules"));

  let mutatedSource: string | null = null;
  if (mutation !== null) {
    const target = join(plugin, mutation.moduleRel);
    expect(existsSync(target)).toBe(true);
    const before = read(target);
    let after = mutateInRegion(before, 0, before.length, mutation.find, mutation.repl, {
      label: `${mutation.moduleRel} (whole module)`,
    });
    if (mutation.append !== undefined) after += mutation.append;
    writeFileSync(target, after);
    // The mutation is asserted APPLIED before the target test runs.
    mutatedSource = read(target);
    expect(mutatedSource).not.toBe(before);
    expect(mutatedSource).toContain(mutation.marker);
    expect(createHash("sha256").update(mutatedSource).digest("hex")).not.toBe(
      createHash("sha256").update(before).digest("hex"),
    );
  }

  const proc = Bun.spawnSync(["bun", "test", THIS_FILE_REL, "-t", filter], { cwd: plugin, stdout: "pipe", stderr: "pipe" });
  return { code: proc.exitCode ?? -1, output: `${proc.stdout.toString()}\n${proc.stderr.toString()}`, mutatedSource };
}

const failedRow = (run: OverlayRun, name: string): boolean =>
  run.output.split("\n").some((l) => l.startsWith("(fail)") && l.includes(name));
const count = (run: OverlayRun, kind: "pass" | "fail"): number => {
  const m = run.output.match(new RegExp(`^\\s*(\\d+) ${kind}\\b`, "m"));
  return m === null ? -1 : Number.parseInt(m[1]!, 10);
};

describe("AC-STE-671.9 — the prompt pass-through and the ElevenLabs tag pass-through are mutation-verified", () => {
  test(
    "control: the unmutated overlay passes the music-prompt tests",
    () => {
      const run = runOverlay(MUSIC_AC, null);
      expect(count(run, "pass"), run.output.slice(-800)).toBeGreaterThan(0);
      expect(count(run, "fail"), run.output.slice(-800)).toBe(0);
      expect(run.code).toBe(0);
    },
    120_000,
  );

  test(
    "dropping the prompt pass-through (the request falls back to the default) turns the music-prompt tests red",
    () => {
      const marker = "/* MUTATION:STE-671.9:drop-prompt */";
      const run = runOverlay(MUSIC_AC, {
        moduleRel: "adapters/_shared/src/video/music.ts",
        find: "await postJson(",
        repl: "await __mutDropPrompt(",
        append:
          `\nfunction __mutDropPrompt(...a: any[]): any { ${marker}\n` +
          `  a[4] = { ...a[4], prompt: ${JSON.stringify(UPBEAT_DEFAULT)} };\n` +
          "  return (postJson as any)(...a);\n}\n",
        marker,
      });
      expect(run.mutatedSource).toContain(marker);
      expect(failedRow(run, MUSIC_AC), run.output.slice(-800)).toBe(true);
      expect(count(run, "fail")).toBeGreaterThan(0);
      expect(run.code).not.toBe(0);
    },
    120_000,
  );

  test(
    "control: the unmutated overlay passes the audio-tag tests",
    () => {
      const run = runOverlay(TAG_AC, null);
      expect(count(run, "pass"), run.output.slice(-800)).toBeGreaterThan(0);
      expect(count(run, "fail"), run.output.slice(-800)).toBe(0);
      expect(run.code).toBe(0);
    },
    120_000,
  );

  test(
    "stripping tags for ElevenLabs turns the audio-tag tests red",
    () => {
      const marker = "/* MUTATION:STE-671.9:strip-elevenlabs-tags */";
      const run = runOverlay(TAG_AC, {
        moduleRel: "adapters/_shared/src/video/tts_elevenlabs.ts",
        find: "export function rewriteBreaksForElevenLabs(",
        repl:
          `export function rewriteBreaksForElevenLabs(text: string): string { ${marker} ` +
          "return __unmutated_rewriteBreaksForElevenLabs(text).replace(/\\[(?!short pause\\])[^\\]]*\\]/g, \"\").replace(/\\s+/g, \" \").trim(); }\n" +
          "function __unmutated_rewriteBreaksForElevenLabs(",
        marker,
      });
      expect(run.mutatedSource).toContain(marker);
      expect(failedRow(run, TAG_AC), run.output.slice(-800)).toBe(true);
      expect(count(run, "fail")).toBeGreaterThan(0);
      expect(run.code).not.toBe(0);
    },
    120_000,
  );
});
