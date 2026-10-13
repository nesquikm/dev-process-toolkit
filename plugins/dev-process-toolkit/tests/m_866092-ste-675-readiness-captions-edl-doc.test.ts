// STE-675 — readiness checks the caption filter; the edit list is documented.
//
//   AC-STE-675.1 — captions on: `videoReadiness` asks `ffmpeg -hide_banner -filters` through an injectable
//                  runner and adds exactly one reason when `drawtext` is not listed; the reason names
//                  `drawtext`, `brew install ffmpeg-full`, the keg's `bin` first on `PATH`, or captions off.
//   AC-STE-675.2 — captions off: no ffmpeg command at all (runner call log empty); captions on + `drawtext`
//                  listed: no reason.
//   AC-STE-675.3 — the voice stage refuses on readiness before any provider call (recording fetch: 0 calls).
//   AC-STE-675.4 — the render-time caption-filter refusal and the readiness reason carry ONE shared remedy
//                  constant; neither recommends plain `brew install ffmpeg`.
//   AC-STE-675.5 — docs/video-reference.md gains an `edl.json` section naming every EDL field.
//   AC-STE-675.6 — the section is pinned to the parser both ways (doc ⊆ parser, parser ⊆ doc).
//   AC-STE-675.7 — gate-level (full `bun test`: 0 failures, skip identities equal trunk by name); no
//                  dedicated test here.
//
// Seams pinned here (documented for the implementer):
//
//   adapters/_shared/src/video/readiness.ts
//     export type SyncRunner = (argv: string[]) => { code: number; stdout: string; stderr: string };
//     export function videoReadiness(projectRoot: string, opts?: { ffmpegRunner?: SyncRunner }): VideoReadiness
//       — stays synchronous (every existing caller reads `.ready` directly). With the stored style's
//         `captions.enabled: true` it runs `[<ffmpeg>, "-hide_banner", "-filters"]` through
//         `opts.ffmpegRunner` (default: a real spawnSync runner); captions off ⇒ no call.
//
//   adapters/_shared/src/video/render.ts
//     export const CAPTION_FILTER_REMEDY: string — the one remedy text; both the readiness reason and the
//       `requireCaptionFilter` refusal carry it verbatim.
//
//   adapters/_shared/src/video_pipeline.ts
//     VideoStageDeps.ffmpegRunner?: SyncRunner — threaded into the readiness check `runVideoStage` runs first.
//
//   adapters/_shared/src/video/edl.ts
//     export const EDL_ACCEPTED_KEYS: {
//       root: readonly string[];       // edl_version, clips, voice, captions, music, anchors
//       clips: readonly string[];      // src, in, out, at, effects
//       voice: readonly string[];      // segment, audio, offset
//       captions: readonly string[];   // text, start, end
//       music: readonly string[];      // src, level_db
//       anchors: readonly string[];    // name, at
//       anchor_ref: readonly string[]; // segment, word
//     }
//     — the lists `parseEdl` hands to `rejectUnknownKeys` (no inline key-array literals remain).
//
// Doc convention the pin reads (matches the `shots.json` section): the section is the heading whose text
// contains `edl.json`, up to the next heading of the same or a higher level; a field it names is a bullet
// (any nesting depth) that opens with a backticked name, e.g. "- `src` — ...". A qualified name such as
// `clips[].src` or `music.level_db` counts as its last segment.
//
// No real ffmpeg (Homebrew's plain build lacks drawtext) and no network: injected runners and fetches only.

import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { dptEnvPath, videoConfigPath, videoStylePath, videoWorkDir } from "../adapters/_shared/src/dpt_paths";
import { writeDptGitignore } from "../adapters/_shared/src/setup/dpt_gitignore";
import * as edlModule from "../adapters/_shared/src/video/edl";
import { parseEdl } from "../adapters/_shared/src/video/edl";
import * as readinessModule from "../adapters/_shared/src/video/readiness";
import * as renderModule from "../adapters/_shared/src/video/render";
import { requireCaptionFilter } from "../adapters/_shared/src/video/render";
import { parseVideoStyle } from "../adapters/_shared/src/video/style";
import { runVideoStage } from "../adapters/_shared/src/video_pipeline";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const SRC = join(PLUGIN_ROOT, "adapters", "_shared", "src");
const VIDEO_REFERENCE = join(PLUGIN_ROOT, "docs", "video-reference.md");
const EDL_SOURCE = join(SRC, "video", "edl.ts");

const SLUG = "captioned-feature";
const FAKE_KEY = "sk-ste675-test-key";

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

const FILTERS_WITHOUT_DRAWTEXT = [
  "Filters:",
  " ... trim              V->V       Pick one continuous section from the input, drop the rest.",
  " ... scale             V->V       Scale the input video size and/or convert the image format.",
  " ... concat            N->N       Concatenate audio and video streams.",
  " ... adelay            A->A       Delay one or more audio channels.",
  "",
].join("\n");
const FILTERS_WITH_DRAWTEXT = `${FILTERS_WITHOUT_DRAWTEXT} T.C drawtext          V->V       Draw text on top of video frames using libfreetype library.\n`;

type SyncCall = string[];

/** A synchronous runner answering `-filters` with `listing`, recording every argv. */
function syncFiltersRunner(listing: string): {
  runner: (argv: string[]) => { code: number; stdout: string; stderr: string };
  calls: SyncCall[];
} {
  const calls: SyncCall[] = [];
  const runner = (argv: string[]) => {
    calls.push([...argv]);
    if (argv.includes("-filters")) return { code: 0, stdout: listing, stderr: "" };
    return { code: 0, stdout: "", stderr: "" };
  };
  return { runner, calls };
}

type ReadinessFn = (
  projectRoot: string,
  opts?: { ffmpegRunner?: (argv: string[]) => { code: number; stdout: string; stderr: string } },
) => { ready: boolean; reasons: string[] };
const videoReadiness = readinessModule.videoReadiness as unknown as ReadinessFn;

const CONFIG = ["tts:", "  provider: elevenlabs", "  voice: narrator", "recorder:", "  kind: web", "music:", "  source: none", ""].join(
  "\n",
);

/** A git project whose only possible readiness gap is the caption filter. */
function readyProject(prefix: string, captions: "on" | "off" | "default"): string {
  const root = makeTmpRoot(prefix);
  expect(git(root, ["init", "-q"])).toBe(0);
  writeDptGitignore(root);
  writeFile(videoConfigPath(root), CONFIG);
  writeFile(dptEnvPath(root), `ELEVENLABS_API_KEY=${FAKE_KEY}\n`);
  if (captions === "on") writeFile(videoStylePath(root), "captions:\n  enabled: true\n");
  if (captions === "off") writeFile(videoStylePath(root), "captions:\n  enabled: false\n");
  return root;
}

/** Plain-Homebrew-ffmpeg advice: `brew install ffmpeg` NOT followed by `-full` (or any other suffix). */
const PLAIN_BREW_FFMPEG = /brew install ffmpeg(?![-\w])/;

function remedyConstant(): string {
  const value = (renderModule as Record<string, unknown>).CAPTION_FILTER_REMEDY;
  expect(typeof value).toBe("string");
  return value as string;
}

// ===========================================================================
// AC-STE-675.1 — captions on, drawtext missing ⇒ exactly one reason with the remedy
// ===========================================================================

describe("AC-STE-675.1 — readiness asks ffmpeg for its filters when captions are on", () => {
  test("AC-STE-675.1 runs `ffmpeg -hide_banner -filters` through the injected runner", () => {
    const root = readyProject("ste675-on-missing-", "on");
    const { runner, calls } = syncFiltersRunner(FILTERS_WITHOUT_DRAWTEXT);
    videoReadiness(root, { ffmpegRunner: runner });
    const filterCalls = calls.filter((argv) => argv.includes("-filters"));
    expect(filterCalls.length).toBe(1);
    const argv = filterCalls[0]!;
    expect(basename(argv[0] ?? "")).toBe("ffmpeg");
    expect(argv.slice(1)).toEqual(["-hide_banner", "-filters"]);
  });

  test("AC-STE-675.1 drawtext missing adds exactly one reason, naming drawtext and the ffmpeg-full remedy", () => {
    const root = readyProject("ste675-on-missing-reason-", "on");
    const listed = syncFiltersRunner(FILTERS_WITH_DRAWTEXT);
    const baseline = videoReadiness(root, { ffmpegRunner: listed.runner });
    expect(baseline).toEqual({ ready: true, reasons: [] });

    const missing = syncFiltersRunner(FILTERS_WITHOUT_DRAWTEXT);
    const r = videoReadiness(root, { ffmpegRunner: missing.runner });
    expect(r.ready).toBe(false);
    expect(r.reasons.length).toBe(1);
    const reason = r.reasons[0]!;
    expect(reason).toContain("drawtext");
    expect(reason).toContain("brew install ffmpeg-full");
    expect(reason).toMatch(/\bbin\b/);
    expect(reason).toMatch(/\bPATH\b/);
    expect(reason).toMatch(/first/i);
    expect(reason).toMatch(/captions (off|\.enabled: false)|turn(ing)? (the )?captions off|captions\.enabled/i);
    expect(reason).not.toMatch(PLAIN_BREW_FFMPEG);
  });

  test("AC-STE-675.1 the default style (captions enabled) also triggers the check", () => {
    const root = readyProject("ste675-default-", "default");
    expect(parseVideoStyle("").captions.enabled).toBe(true);
    const { runner, calls } = syncFiltersRunner(FILTERS_WITHOUT_DRAWTEXT);
    const r = videoReadiness(root, { ffmpegRunner: runner });
    expect(calls.filter((a) => a.includes("-filters")).length).toBe(1);
    expect(r.reasons.filter((x) => x.includes("drawtext")).length).toBe(1);
  });

  test("HARDEN — an ffmpeg that cannot run is named as such, not as a missing drawtext", () => {
    const root = readyProject("ste675-no-ffmpeg-", "on");
    const runner: readinessModule.SyncRunner = () => ({ code: -1, stdout: "", stderr: "spawn ffmpeg ENOENT" });
    const r = videoReadiness(root, { ffmpegRunner: runner });
    expect(r.ready).toBe(false);
    expect(r.reasons.length).toBe(1);
    expect(r.reasons[0]).toContain("could not run");
    expect(r.reasons[0]).toContain("spawn ffmpeg ENOENT");
    expect(r.reasons[0]).not.toContain("does not list");
    expect(r.reasons[0]).toContain("brew install ffmpeg-full");
  });
});

// ===========================================================================
// AC-STE-675.2 — captions off ⇒ no ffmpeg call; drawtext listed ⇒ no reason
// ===========================================================================

describe("AC-STE-675.2 — no check when captions are off; no reason when drawtext is listed", () => {
  test("AC-STE-675.2 captions off: the runner is never called and readiness is ready", () => {
    const root = readyProject("ste675-off-", "off");
    const { runner, calls } = syncFiltersRunner(FILTERS_WITHOUT_DRAWTEXT);
    const r = videoReadiness(root, { ffmpegRunner: runner });
    expect(calls).toEqual([]);
    expect(r).toEqual({ ready: true, reasons: [] });
  });

  test("AC-STE-675.2 captions on and drawtext listed: no reason, and the runner WAS asked (control)", () => {
    const root = readyProject("ste675-on-listed-", "on");
    const { runner, calls } = syncFiltersRunner(FILTERS_WITH_DRAWTEXT);
    const r = videoReadiness(root, { ffmpegRunner: runner });
    expect(calls.filter((a) => a.includes("-filters")).length).toBe(1);
    expect(r).toEqual({ ready: true, reasons: [] });
  });
});

// ===========================================================================
// AC-STE-675.3 — the voice stage refuses on readiness before any provider call
// ===========================================================================

function recordingFetch(): { fetch: (url: string, init: RequestInit) => Promise<Response>; calls: string[] } {
  const calls: string[] = [];
  const fetch = async (url: string, _init: RequestInit): Promise<Response> => {
    calls.push(String(url));
    return new Response(JSON.stringify({ error: "test fetch" }), { status: 400 });
  };
  return { fetch, calls };
}

/** Captions-on project with an approved script and segments.json — the voice stage's inputs. */
function voiceReadyProject(prefix: string): string {
  const root = readyProject(prefix, "on");
  const workDir = videoWorkDir(root, SLUG);
  const script = join(workDir, "script.md");
  writeFile(script, "# Script\n\nShot 1: open the dashboard.\n");
  const sha256 = createHash("sha256").update(readFileSync(script)).digest("hex");
  writeFile(join(workDir, "script-approval.json"), JSON.stringify({ sha256, approvedAt: new Date().toISOString() }));
  writeFile(join(workDir, "segments.json"), JSON.stringify([{ index: 1, text: "Meet the pipeline." }]));
  return root;
}

describe("AC-STE-675.3 — a missing drawtext refuses the voice stage before any provider call", () => {
  test("AC-STE-675.3 voice stage rejects naming drawtext; the injected fetch records zero calls", async () => {
    const root = voiceReadyProject("ste675-voice-missing-");
    const { runner } = syncFiltersRunner(FILTERS_WITHOUT_DRAWTEXT);
    const { fetch, calls } = recordingFetch();
    let err: unknown = null;
    try {
      await runVideoStage({ projectRoot: root, slug: SLUG, stage: "voice", deps: { fetch, ffmpegRunner: runner } as any });
    } catch (e) {
      err = e;
    }
    expect(err).not.toBeNull();
    const msg = err instanceof Error ? err.message : String(err);
    expect(msg).toContain("drawtext");
    expect(msg).toContain("brew install ffmpeg-full");
    expect(calls.length).toBe(0);
  });

  test("AC-STE-675.3 control: with drawtext listed the same voice stage reaches the provider", async () => {
    const root = voiceReadyProject("ste675-voice-listed-");
    const { runner } = syncFiltersRunner(FILTERS_WITH_DRAWTEXT);
    const { fetch, calls } = recordingFetch();
    try {
      await runVideoStage({ projectRoot: root, slug: SLUG, stage: "voice", deps: { fetch, ffmpegRunner: runner } as any });
    } catch {
      // The fake provider answers 400; only the call count matters here.
    }
    expect(calls.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// AC-STE-675.4 — one shared remedy constant; no plain `brew install ffmpeg`
// ===========================================================================

function captionEdl() {
  return parseEdl(
    JSON.stringify({
      edl_version: 1,
      clips: [{ src: "clips/a.mp4", in: 0, out: 2 }],
      captions: [{ text: "Hello", start: 0, end: 1 }],
    }),
  );
}

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listFiles(p));
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

describe("AC-STE-675.4 — the render refusal and the readiness reason share one remedy constant", () => {
  test("AC-STE-675.4 CAPTION_FILTER_REMEDY names ffmpeg-full, its bin first on PATH, or captions off", () => {
    const remedy = remedyConstant();
    expect(remedy).toContain("brew install ffmpeg-full");
    expect(remedy).toMatch(/\bbin\b/);
    expect(remedy).toMatch(/\bPATH\b/);
    expect(remedy).toMatch(/captions/i);
    expect(remedy).not.toMatch(PLAIN_BREW_FFMPEG);
  });

  test("AC-STE-675.4 the render-time refusal carries the constant verbatim and no plain `brew install ffmpeg`", async () => {
    const remedy = remedyConstant();
    const workDir = makeTmpRoot("ste675-render-");
    const runner = async (argv: string[], _opts: { cwd: string }) => ({
      code: 0,
      stdout: argv.includes("-filters") ? FILTERS_WITHOUT_DRAWTEXT : "",
      stderr: "",
    });
    const style = parseVideoStyle("captions:\n  enabled: true\n");
    let msg = "";
    try {
      await requireCaptionFilter(runner, "ffmpeg", captionEdl(), style, workDir);
    } catch (e) {
      msg = e instanceof Error ? e.message : String(e);
    }
    expect(msg).toContain("drawtext");
    expect(msg).toContain(remedy);
    expect(msg).not.toMatch(PLAIN_BREW_FFMPEG);
  });

  test("AC-STE-675.4 the readiness reason carries the same constant verbatim", () => {
    const remedy = remedyConstant();
    const root = readyProject("ste675-shared-remedy-", "on");
    const { runner } = syncFiltersRunner(FILTERS_WITHOUT_DRAWTEXT);
    const reason = videoReadiness(root, { ffmpegRunner: runner }).reasons.find((r) => r.includes("drawtext")) ?? "";
    expect(reason).toContain(remedy);
  });

  test("AC-STE-675.4 the remedy text lives in exactly one source literal under adapters/_shared/src", () => {
    const hits = listFiles(SRC).filter((f) => readFileSync(f, "utf8").includes("brew install ffmpeg-full"));
    expect(hits.map((f) => f.slice(SRC.length + 1))).toEqual(["video/render.ts"]);
    const render = readFileSync(join(SRC, "video", "render.ts"), "utf8");
    expect(render.split("brew install ffmpeg-full").length - 1).toBe(1);
  });
});

// ===========================================================================
// AC-STE-675.5 / AC-STE-675.6 — the `edl.json` section, pinned to the parser
// ===========================================================================

/** The section whose heading text contains `edl.json`, up to the next heading of the same or higher level. */
function edlSection(): string {
  const lines = readFileSync(VIDEO_REFERENCE, "utf8").split("\n");
  const start = lines.findIndex((l) => /^#{1,6}\s/.test(l) && l.includes("edl.json"));
  if (start < 0) return "";
  const level = /^(#+)/.exec(lines[start]!)![1]!.length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = /^(#+)\s/.exec(lines[i]!);
    if (m && m[1]!.length <= level) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

/** Field names the section's bullets open with (qualified names reduced to their last segment). */
function sectionFieldNames(section: string): Set<string> {
  const names = new Set<string>();
  for (const line of section.split("\n")) {
    const m = /^\s*[-*]\s+`([^`]+)`/.exec(line);
    if (!m) continue;
    const segs = m[1]!.replace(/\[\]/g, "").split(".");
    names.add(segs[segs.length - 1]!.trim());
  }
  return names;
}

type AcceptedKeys = Record<"root" | "clips" | "voice" | "captions" | "music" | "anchors" | "anchor_ref", readonly string[]>;

function acceptedKeys(): AcceptedKeys {
  const value = (edlModule as Record<string, unknown>).EDL_ACCEPTED_KEYS as AcceptedKeys | undefined;
  expect(value).toBeDefined();
  expect(Object.keys(value!).sort()).toEqual(["anchor_ref", "anchors", "captions", "clips", "music", "root", "voice"]);
  return value!;
}

describe("AC-STE-675.5 — docs/video-reference.md documents edl.json", () => {
  const EXPECTED: Record<string, string[]> = {
    root: ["edl_version", "clips", "voice", "captions", "music", "anchors"],
    clips: ["src", "in", "out", "at", "effects"],
    voice: ["segment", "audio", "offset"],
    captions: ["text", "start", "end"],
    music: ["src", "level_db"],
    anchors: ["name", "at"],
    anchor_ref: ["segment", "word"],
  };

  test("AC-STE-675.5 an `edl.json` section exists", () => {
    const section = edlSection();
    expect(section).not.toBe("");
    expect(section.split("\n")[0]).toMatch(/^#{2,4}\s.*`edl\.json`/);
  });

  for (const [group, fields] of Object.entries(EXPECTED)) {
    test(`AC-STE-675.5 the section names every ${group} field: ${fields.join(", ")}`, () => {
      const named = sectionFieldNames(edlSection());
      for (const f of fields) expect({ group, field: f, named: named.has(f) }).toEqual({ group, field: f, named: true });
    });
  }

  test("AC-STE-675.5 the anchor reference form `{ segment, word }` is documented", () => {
    const section = edlSection();
    expect(section).toMatch(/\{\s*segment,\s*word\s*\}/);
  });
});

describe("AC-STE-675.6 — the edl.json section is pinned to the parser both ways", () => {
  test("AC-STE-675.6 EDL_ACCEPTED_KEYS matches what parseEdl accepts (a document using every key parses)", () => {
    const k = acceptedKeys();
    expect([...k.root].sort()).toEqual(["anchors", "captions", "clips", "edl_version", "music", "voice"]);
    expect([...k.clips].sort()).toEqual(["at", "effects", "in", "out", "src"]);
    expect([...k.voice].sort()).toEqual(["audio", "offset", "segment"]);
    expect([...k.captions].sort()).toEqual(["end", "start", "text"]);
    expect([...k.music].sort()).toEqual(["level_db", "src"]);
    expect([...k.anchors].sort()).toEqual(["at", "name"]);
    expect([...k.anchor_ref].sort()).toEqual(["segment", "word"]);
    const edl = parseEdl(
      JSON.stringify({
        edl_version: 1,
        clips: [{ src: "clips/a.mp4", in: 0, out: 2, at: { segment: 1, word: 1 }, effects: [] }],
        voice: [{ segment: 1, audio: "segments/1.mp3", offset: 0 }],
        captions: [{ text: "Hi", start: 0, end: 1 }],
        music: { src: "music.mp3", level_db: -20 },
        anchors: [{ name: "open", at: 0.5 }],
      }),
    );
    expect(edl.clips[0]!.at).toEqual({ segment: 1, word: 1 });
  });

  test("AC-STE-675.6 parseEdl draws its key lists from EDL_ACCEPTED_KEYS (no inline key-array literals)", () => {
    const src = readFileSync(EDL_SOURCE, "utf8");
    expect(src).toContain("EDL_ACCEPTED_KEYS");
    const inline = src.match(/rejectUnknownKeys\([^)]*\[\s*"/g) ?? [];
    expect(inline).toEqual([]);
  });

  test("AC-STE-675.6 every field the parser accepts is named in the section", () => {
    const k = acceptedKeys();
    const named = sectionFieldNames(edlSection());
    const accepted = [...new Set(Object.values(k).flat())].sort();
    expect(accepted.filter((f) => !named.has(f))).toEqual([]);
  });

  test("AC-STE-675.6 every field the section names is accepted by the parser", () => {
    const k = acceptedKeys();
    const named = [...sectionFieldNames(edlSection())].sort();
    expect(named.length).toBeGreaterThan(0);
    const accepted = new Set(Object.values(k).flat());
    expect(named.filter((f) => !accepted.has(f))).toEqual([]);
  });
});

// AC-STE-675.7 — gate-level: `bun test` from plugins/dev-process-toolkit reports 0 failures and skip
// identities equal the trunk baseline by name. Graded by the gate, not by a test in this file.
