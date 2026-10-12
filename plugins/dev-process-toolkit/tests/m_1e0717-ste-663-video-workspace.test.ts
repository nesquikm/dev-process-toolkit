// M_1e0717 STE-663 — video workspace, keys and ignore rules.
//
// AC coverage:
//   AC-STE-663.1 — video path helpers in `dpt_paths.ts`; literal scan with a planted control.
//   AC-STE-663.2 — `DPT_GITIGNORE_BODY` gains `.env` + `video/work/`; `git check-ignore` matrix.
//   AC-STE-663.3 — migration entry `dpt-gitignore-video`: detect / byte-preserving apply / idempotence.
//   AC-STE-663.4 — `parseVideoConfig` schema + NFR-10 refusals naming the key path.
//   AC-STE-663.5 — `parseVideoStyle` schema, documented defaults, unknown-key refusal.
//   AC-STE-663.6 — `readVideoKeys` parses `.dpt/.env` and leaves `process.env` untouched.
//   AC-STE-663.7 — `videoReadiness` + the `video_readiness.ts` front door.
//   AC-STE-663.8 — a sentinel key value never reaches a refusal, front-door output or written file.
//   AC-STE-663.9 — the full-suite gate, graded by the orchestrator (no test here).
//
// Module layout this suite drives (FR § Technical Design):
//   adapters/_shared/src/dpt_paths.ts            — path helpers
//   adapters/_shared/src/setup/dpt_gitignore.ts  — the ignore body
//   adapters/_shared/src/migrations/index.ts     — registry carrying `dpt-gitignore-video`
//   adapters/_shared/src/video/config.ts         — parseVideoConfig
//   adapters/_shared/src/video/style.ts          — parseVideoStyle, readVideoStyle, VIDEO_STYLE_DEFAULTS
//   adapters/_shared/src/video/keys.ts           — readVideoKeys
//   adapters/_shared/src/video/readiness.ts      — videoReadiness
//   adapters/_shared/src/video_readiness.ts      — front door

import { afterAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import * as dptPaths from "../adapters/_shared/src/dpt_paths";
import { DPT_GITIGNORE_BODY, writeDptGitignore } from "../adapters/_shared/src/setup/dpt_gitignore";
import { MIGRATIONS, type MigrationEntry } from "../adapters/_shared/src/migrations/index";
import { parseVideoConfig } from "../adapters/_shared/src/video/config";
import {
  parseVideoStyle,
  readVideoStyle,
  VIDEO_STYLE_DEFAULTS,
} from "../adapters/_shared/src/video/style";
import { readVideoKeys } from "../adapters/_shared/src/video/keys";
import { videoReadiness } from "../adapters/_shared/src/video/readiness";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const ADAPTERS_DIR = join(PLUGIN_ROOT, "adapters");
const FRONT_DOOR = join(PLUGIN_ROOT, "adapters", "_shared", "src", "video_readiness.ts");

/** A key value no code path may ever echo (AC-STE-663.8). */
const SENTINEL = "sk-STE663-SENTINEL-9f3c1a7e5d";
const OLD_BODY = "ledger/\nscratch/\nskip-baseline.json\n";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const tmpRoots: string[] = [];
/** Every project root a sentinel was planted in — swept for leaks in afterAll. */
const sentinelRoots: string[] = [];
/** Every captured refusal message / front-door output — swept for leaks. */
const capturedOutputs: string[] = [];
/**
 * Test-planted INPUT files (absolute path → the exact bytes the test wrote).
 * The leak sweep grades files the video modules write; an input the test itself
 * seeded with the sentinel is exempt only while its bytes are unchanged — a
 * module that rewrites it with the key is still caught.
 */
const plantedInputs = new Map<string, string>();

function makeTmpRoot(prefix: string): string {
  // tmpdir() is outside the repo, so a nested `git init` never sees this checkout.
  const root = mkdtempSync(join(tmpdir(), prefix));
  tmpRoots.push(root);
  return root;
}

function cleanup(root: string): void {
  rmSync(root, { recursive: true, force: true });
  if (existsSync(root)) {
    // Bun's rmSync can leave a git-created .git behind; fall back to rm -rf.
    Bun.spawnSync(["rm", "-rf", root]);
  }
  expect(existsSync(root)).toBe(false);
}

function git(cwd: string, args: string[]): { exitCode: number; stdout: string } {
  const proc = Bun.spawnSync(
    ["git", "-c", "user.email=t@t.test", "-c", "user.name=t", ...args],
    {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
    },
  );
  return { exitCode: proc.exitCode ?? -1, stdout: proc.stdout.toString() };
}

function gitInit(root: string): void {
  expect(git(root, ["init", "-q"]).exitCode).toBe(0);
}

/** `git check-ignore -q` → exit 0 = ignored, exit 1 = not ignored. */
function isIgnored(repo: string, relPath: string): boolean {
  return git(repo, ["check-ignore", "-q", "--", relPath]).exitCode === 0;
}

function writeFile(root: string, rel: string, body: string): string {
  const full = join(root, ...rel.split("/"));
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body);
  return full;
}

function catchRefusal(fn: () => unknown): string {
  let message: string | null = null;
  try {
    fn();
  } catch (err) {
    message = err instanceof Error ? err.message : String(err);
  }
  expect(message).not.toBeNull();
  capturedOutputs.push(message!);
  return message!;
}

/** NFR-10 canonical shape: a verdict line, a `Remedy:` line, a `Context:` line. */
function expectNfr10Refusal(fn: () => unknown, keyPath: string): string {
  const message = catchRefusal(fn);
  expect(message).toContain(keyPath);
  expect(message).toMatch(/^Remedy: \S/m);
  expect(message).toMatch(/^Context: \S/m);
  const firstLine = message.split("\n")[0]!;
  expect(firstLine.trim().length).toBeGreaterThan(0);
  expect(firstLine.startsWith("Remedy:")).toBe(false);
  return message;
}

const VALID_CONFIG = [
  "tts:",
  "  provider: elevenlabs",
  "  voice: Rachel",
  "  model: eleven_multilingual_v2",
  "recorder:",
  "  kind: web",
  "music:",
  "  source: none",
  "",
].join("\n");

function configWith(tts: string, recorder: string, music: string): string {
  return `tts:\n${tts}\nrecorder:\n${recorder}\nmusic:\n${music}\n`;
}

const KEY_VARS = ["ELEVENLABS_API_KEY", "GOOGLE_TTS_API_KEY"] as const;

/** Run `fn` with the provider key variables absent from process.env, restoring them after. */
function withoutKeyVarsInProcessEnv<T>(fn: () => T): T {
  const saved: Record<string, string | undefined> = {};
  for (const k of KEY_VARS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  try {
    return fn();
  } finally {
    for (const k of KEY_VARS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

/**
 * A git-initialised project with the CURRENT toolkit ignore file, a config, and
 * an optional `.dpt/.env`. Every planted key carries the sentinel.
 */
function makeVideoProject(opts: {
  config?: string | null;
  env?: string | null;
  gitignore?: "current" | "old" | "none";
}): string {
  const root = makeTmpRoot("ste663-proj-");
  gitInit(root);
  const gi = opts.gitignore ?? "current";
  if (gi === "current") writeDptGitignore(root);
  else if (gi === "old") writeFile(root, ".dpt/.gitignore", OLD_BODY);
  if (opts.config !== null && opts.config !== undefined) {
    const path = writeFile(root, ".dpt/video/config.yaml", opts.config);
    plantedInputs.set(path, opts.config);
  }
  if (opts.env !== null && opts.env !== undefined) {
    writeFile(root, ".dpt/.env", opts.env);
    sentinelRoots.push(root);
  }
  return root;
}

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === ".git") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walkFiles(full));
    else out.push(full);
  }
  return out;
}

/**
 * AC-STE-663.8 sweep — every file under `root` holding the sentinel, except the
 * key file itself and test-planted inputs whose bytes are still as planted.
 * Returns root-relative paths; the afterAll and its CONTROL share this one walk.
 */
function sentinelLeaks(root: string): string[] {
  if (!existsSync(root)) return [];
  return walkFiles(root)
    .filter((f) => f !== dptPaths.dptEnvPath(root))
    .map((f) => ({ f, body: readFileSync(f, "utf-8") }))
    .filter(({ f, body }) => plantedInputs.get(f) !== body)
    .filter(({ body }) => body.includes(SENTINEL))
    .map(({ f }) => relative(root, f));
}

afterAll(() => {
  // AC-STE-663.8 — the sentinel sweep runs over EVERYTHING this suite captured
  // and every file left in a sentinel-bearing project, before cleanup.
  for (const out of capturedOutputs) {
    expect(out).not.toContain(SENTINEL);
  }
  for (const root of sentinelRoots) {
    expect(sentinelLeaks(root), root).toEqual([]);
  }
  while (tmpRoots.length > 0) cleanup(tmpRoots.pop()!);
});

// ---------------------------------------------------------------------------
// AC-STE-663.1 — path helpers + the literal scan
// ---------------------------------------------------------------------------

describe("AC-STE-663.1 — video path helpers live in dpt_paths.ts", () => {
  const root = join(sep, "work", "proj");

  test("each helper composes the documented path under the toolkit root", () => {
    expect(dptPaths.videoRoot(root)).toBe(join(root, ".dpt", "video"));
    expect(dptPaths.videoConfigPath(root)).toBe(join(root, ".dpt", "video", "config.yaml"));
    expect(dptPaths.videoStylePath(root)).toBe(join(root, ".dpt", "video", "style.yaml"));
    expect(dptPaths.videoScenariosDir(root)).toBe(join(root, ".dpt", "video", "scenarios"));
    expect(dptPaths.videoWorkRoot(root)).toBe(join(root, ".dpt", "video", "work"));
    expect(dptPaths.videoWorkDir(root, "demo")).toBe(join(root, ".dpt", "video", "work", "demo"));
    expect(dptPaths.dptEnvPath(root)).toBe(join(root, ".dpt", ".env"));
  });

  test("helpers compose under dptRoot, so they follow the single toolkit-root literal", () => {
    const base = dptPaths.dptRoot(root);
    expect(dptPaths.videoRoot(root).startsWith(base + sep)).toBe(true);
    expect(dptPaths.dptEnvPath(root).startsWith(base + sep)).toBe(true);
  });

  test("pure composition: composing creates nothing on disk", () => {
    const ghost = join(tmpdir(), `ste663-never-created-${process.pid}-${Date.now()}`);
    dptPaths.videoWorkDir(ghost, "demo");
    dptPaths.dptEnvPath(ghost);
    expect(existsSync(ghost)).toBe(false);
  });
});

/** Matches a `.dpt/video` or `.dpt/.env` path inside a string literal. */
const LITERAL_RE = /(["'`])[^"'`\n]*\.dpt\/(?:video|\.env)[^"'`\n]*\1/;

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/(^|[^:"'`])\/\/.*$/, "$1"))
    .join("\n");
}

/** Every file under `dir` (ts/js/mjs) outside `dpt_paths.ts` holding such a literal. */
function scanForVideoLiterals(dir: string): string[] {
  const hits: string[] = [];
  for (const file of walkFiles(dir)) {
    if (!/\.(ts|js|mjs|cjs)$/.test(file)) continue;
    if (file.endsWith(`${sep}dpt_paths.ts`)) continue;
    if (file.includes(`${sep}node_modules${sep}`)) continue;
    if (LITERAL_RE.test(stripComments(readFileSync(file, "utf-8")))) hits.push(file);
  }
  return hits;
}

describe("AC-STE-663.1 — no hand-written `.dpt/video` / `.dpt/.env` literal in adapters/", () => {
  test("CONTROL: the scan finds a planted literal and ignores a comment mention and dpt_paths.ts", () => {
    const planted = makeTmpRoot("ste663-scan-control-");
    writeFile(planted, "a/leak.ts", 'export const p = ".dpt/video/config.yaml";\n');
    writeFile(planted, "b/env.ts", "const e = `${root}/.dpt/.env`;\n");
    writeFile(planted, "c/comment_only.ts", "// see .dpt/video/config.yaml\nexport const x = 1;\n");
    writeFile(planted, "d/dpt_paths.ts", 'export const p = ".dpt/video";\n');
    const hits = scanForVideoLiterals(planted).map((f) => relative(planted, f)).sort();
    expect(hits).toEqual([join("a", "leak.ts"), join("b", "env.ts")]);
  });

  test("the shipped adapters/ tree has zero hits", () => {
    expect(existsSync(ADAPTERS_DIR)).toBe(true);
    // The tree is non-trivial — a zero-hit scan over an empty dir would prove nothing.
    expect(walkFiles(ADAPTERS_DIR).filter((f) => f.endsWith(".ts")).length).toBeGreaterThan(50);
    expect(scanForVideoLiterals(ADAPTERS_DIR).map((f) => relative(PLUGIN_ROOT, f))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-663.2 — ignore body + check-ignore matrix
// ---------------------------------------------------------------------------

describe("AC-STE-663.2 — the ignore body gains `.env` and `video/work/`", () => {
  test("the body carries both new lines alongside the existing three", () => {
    const lines = DPT_GITIGNORE_BODY.split("\n").map((l) => l.trim());
    for (const rule of ["ledger/", "scratch/", "skip-baseline.json", ".env", "video/work/"]) {
      expect(lines).toContain(rule);
    }
  });

  test("git check-ignore: keys + work dir ignored; config, style and scenarios tracked", () => {
    const repo = makeTmpRoot("ste663-ignore-");
    gitInit(repo);
    writeDptGitignore(repo);
    for (const rel of [
      ".dpt/.env",
      ".dpt/video/work/demo/final.mp4",
      ".dpt/video/config.yaml",
      ".dpt/video/style.yaml",
      ".dpt/video/scenarios/a.ts",
    ]) {
      writeFile(repo, rel, "x\n");
    }
    expect(isIgnored(repo, ".dpt/.env")).toBe(true);
    expect(isIgnored(repo, ".dpt/video/work/demo/final.mp4")).toBe(true);
    expect(isIgnored(repo, ".dpt/video/config.yaml")).toBe(false);
    expect(isIgnored(repo, ".dpt/video/style.yaml")).toBe(false);
    expect(isIgnored(repo, ".dpt/video/scenarios/a.ts")).toBe(false);
  });

  test("CONTROL: under the OLD body `.dpt/.env` is NOT ignored — the matrix measures the new lines", () => {
    const repo = makeTmpRoot("ste663-ignore-old-");
    gitInit(repo);
    writeFile(repo, ".dpt/.gitignore", OLD_BODY);
    writeFile(repo, ".dpt/.env", "x\n");
    writeFile(repo, ".dpt/video/work/demo/final.mp4", "x\n");
    expect(isIgnored(repo, ".dpt/.env")).toBe(false);
    expect(isIgnored(repo, ".dpt/video/work/demo/final.mp4")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-663.3 — migration entry
// ---------------------------------------------------------------------------

function entry(): MigrationEntry {
  const found = MIGRATIONS.find((e) => e.id === "dpt-gitignore-video");
  expect(found).toBeDefined();
  return found!;
}

function gitignoreProject(body: string): string {
  const root = makeTmpRoot("ste663-mig-");
  writeFile(root, ".dpt/.gitignore", body);
  return root;
}

const readGi = (root: string): string => readFileSync(join(root, ".dpt", ".gitignore"), "utf-8");
const giLines = (body: string): string[] => body.split("\n").map((l) => l.trim());

describe("AC-STE-663.3 — migration `dpt-gitignore-video`", () => {
  test("registered as a 2.96.0 script entry with an apply", () => {
    const e = entry();
    expect(e.introduced_in).toBe("2.96.0");
    expect(e.kind).toBe("script");
    expect(typeof e.apply).toBe("function");
  });

  test("detect applies when BOTH lines are missing (the pre-2.96.0 body)", () => {
    const root = gitignoreProject(OLD_BODY);
    const r = entry().detect(root);
    expect(r.applies).toBe(true);
    expect(r.evidence.length).toBeGreaterThan(0);
  });

  test("detect applies when only `.env` is missing", () => {
    expect(entry().detect(gitignoreProject(`${OLD_BODY}video/work/\n`)).applies).toBe(true);
  });

  test("detect applies when only `video/work/` is missing", () => {
    expect(entry().detect(gitignoreProject(`${OLD_BODY}.env\n`)).applies).toBe(true);
  });

  test("detect does NOT apply when both lines are present (the canonical body)", () => {
    const r = entry().detect(gitignoreProject(DPT_GITIGNORE_BODY));
    expect(r.applies).toBe(false);
    expect(r.evidence).toEqual([]);
  });

  test("detect does NOT apply when both lines are present amid operator lines, in any order", () => {
    expect(entry().detect(gitignoreProject("# mine\nvideo/work/\nfoo.log\n.env\n")).applies).toBe(false);
  });

  test("apply appends both missing lines and keeps every other byte", () => {
    const original = "# operator note\nledger/\nscratch/\nskip-baseline.json\ncustom-thing/\n";
    const root = gitignoreProject(original);
    const result = entry().apply!(root);
    const after = readGi(root);
    expect(after.startsWith(original)).toBe(true);
    const added = giLines(after.slice(original.length)).filter((l) => l !== "");
    expect(added.sort()).toEqual([".env", "video/work/"]);
    expect(result.changed.length).toBe(1);
  });

  test("apply appends ONLY the missing line when one is already present", () => {
    const original = `${OLD_BODY}.env\n`;
    const root = gitignoreProject(original);
    entry().apply!(root);
    const after = readGi(root);
    expect(after.startsWith(original)).toBe(true);
    expect(giLines(after.slice(original.length)).filter((l) => l !== "")).toEqual(["video/work/"]);
    expect(giLines(after).filter((l) => l === ".env").length).toBe(1);
  });

  test("apply on a body with no trailing newline keeps the bytes and yields separate lines", () => {
    const original = "ledger/\nscratch/";
    const root = gitignoreProject(original);
    entry().apply!(root);
    const after = readGi(root);
    expect(after.startsWith(original)).toBe(true);
    const lines = giLines(after);
    expect(lines).toContain("scratch/");
    expect(lines).toContain(".env");
    expect(lines).toContain("video/work/");
  });

  test("after apply, a second detect reports nothing to do and a second apply changes nothing", () => {
    const root = gitignoreProject(OLD_BODY);
    entry().apply!(root);
    const once = readGi(root);
    expect(entry().detect(root).applies).toBe(false);
    const again = entry().apply!(root);
    expect(again.changed).toEqual([]);
    expect(readGi(root)).toBe(once);
  });

  test("after apply, git really ignores `.dpt/.env` and the work dir", () => {
    const root = gitignoreProject(OLD_BODY);
    gitInit(root);
    entry().apply!(root);
    writeFile(root, ".dpt/.env", "x\n");
    writeFile(root, ".dpt/video/work/demo/final.mp4", "x\n");
    expect(isIgnored(root, ".dpt/.env")).toBe(true);
    expect(isIgnored(root, ".dpt/video/work/demo/final.mp4")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-663.4 — parseVideoConfig
// ---------------------------------------------------------------------------

describe("AC-STE-663.4 — parseVideoConfig accepts the schema", () => {
  test("elevenlabs + voice + model, web recorder, no music", () => {
    const c = parseVideoConfig(VALID_CONFIG);
    expect(c.tts.provider).toBe("elevenlabs");
    expect(c.tts.voice).toBe("Rachel");
    expect(c.tts.model).toBe("eleven_multilingual_v2");
    expect(c.recorder.kind).toBe("web");
    expect(c.music.source).toBe("none");
  });

  test("google provider with model omitted", () => {
    const c = parseVideoConfig(
      configWith("  provider: google\n  voice: en-US-Neural2-F", "  kind: footage", "  source: elevenlabs"),
    );
    expect(c.tts.provider).toBe("google");
    expect(c.tts.voice).toBe("en-US-Neural2-F");
    expect(c.tts.model).toBeUndefined();
    expect(c.recorder.kind).toBe("footage");
    expect(c.music.source).toBe("elevenlabs");
  });

  test("every recorder kind is accepted with its kind-specific fields", () => {
    const tts = "  provider: elevenlabs\n  voice: Rachel";
    const music = "  source: none";
    expect(parseVideoConfig(configWith(tts, "  kind: web", music)).recorder.kind).toBe("web");
    const ios = parseVideoConfig(configWith(tts, "  kind: ios-sim\n  device: iPhone 15", music)).recorder;
    expect(ios).toMatchObject({ kind: "ios-sim", device: "iPhone 15" });
    const android = parseVideoConfig(
      configWith(tts, "  kind: android-emu\n  device: emulator-5554", music),
    ).recorder;
    expect(android).toMatchObject({ kind: "android-emu", device: "emulator-5554" });
    expect(parseVideoConfig(configWith(tts, "  kind: footage", music)).recorder.kind).toBe("footage");
    const cmd = parseVideoConfig(
      configWith(tts, "  kind: command\n  command: [bash, scripts/record.sh, --fast]", music),
    ).recorder;
    expect(cmd).toMatchObject({ kind: "command", command: ["bash", "scripts/record.sh", "--fast"] });
  });

  test("ios-sim device defaults to `booted`", () => {
    const r = parseVideoConfig(
      configWith("  provider: elevenlabs\n  voice: Rachel", "  kind: ios-sim", "  source: none"),
    ).recorder;
    expect(r).toMatchObject({ kind: "ios-sim", device: "booted" });
  });

  test("music.source: file with music.file", () => {
    const c = parseVideoConfig(
      configWith("  provider: elevenlabs\n  voice: Rachel", "  kind: web", "  source: file\n  file: music/bed.mp3"),
    );
    expect(c.music).toMatchObject({ source: "file", file: "music/bed.mp3" });
  });
});

describe("AC-STE-663.4 — parseVideoConfig refuses in the NFR-10 shape naming the key path", () => {
  const tts = "  provider: elevenlabs\n  voice: Rachel";

  test("unknown tts.provider", () => {
    expectNfr10Refusal(
      () => parseVideoConfig(configWith("  provider: polly\n  voice: Joanna", "  kind: web", "  source: none")),
      "tts.provider",
    );
  });

  test("missing tts.voice", () => {
    expectNfr10Refusal(
      () => parseVideoConfig(configWith("  provider: elevenlabs", "  kind: web", "  source: none")),
      "tts.voice",
    );
  });

  test("unknown recorder.kind", () => {
    expectNfr10Refusal(() => parseVideoConfig(configWith(tts, "  kind: screen", "  source: none")), "recorder.kind");
  });

  test("command recorder without recorder.command", () => {
    expectNfr10Refusal(() => parseVideoConfig(configWith(tts, "  kind: command", "  source: none")), "recorder.command");
  });

  test("recorder.command that is not a list of strings", () => {
    expectNfr10Refusal(
      () => parseVideoConfig(configWith(tts, "  kind: command\n  command: ./record.sh", "  source: none")),
      "recorder.command",
    );
  });

  test("a kind-specific field on the wrong kind is an unknown key", () => {
    expectNfr10Refusal(
      () => parseVideoConfig(configWith(tts, "  kind: web\n  command: [bash, x.sh]", "  source: none")),
      "recorder.command",
    );
  });

  test("unknown music.source", () => {
    expectNfr10Refusal(() => parseVideoConfig(configWith(tts, "  kind: web", "  source: spotify")), "music.source");
  });

  test("music.source: file without music.file", () => {
    expectNfr10Refusal(() => parseVideoConfig(configWith(tts, "  kind: web", "  source: file")), "music.file");
  });

  test("unknown nested key", () => {
    expectNfr10Refusal(
      () => parseVideoConfig(configWith(`${tts}\n  speed: 2`, "  kind: web", "  source: none")),
      "tts.speed",
    );
  });

  test("unknown top-level key", () => {
    expectNfr10Refusal(() => parseVideoConfig(`${VALID_CONFIG}narrator_mood: grumpy\n`), "narrator_mood");
  });
});

// ---------------------------------------------------------------------------
// AC-STE-663.5 — parseVideoStyle
// ---------------------------------------------------------------------------

describe("AC-STE-663.5 — parseVideoStyle", () => {
  test("documented defaults: banned_effects [slow_zoom, ken_burns], viewport 1280x720, humor in the enum", () => {
    expect(VIDEO_STYLE_DEFAULTS.banned_effects).toEqual(["slow_zoom", "ken_burns"]);
    expect(VIDEO_STYLE_DEFAULTS.layout.viewport).toEqual({ width: 1280, height: 720 });
    expect(["none", "light", "playful"]).toContain(VIDEO_STYLE_DEFAULTS.humor);
    expect(typeof VIDEO_STYLE_DEFAULTS.pacing.words_per_minute).toBe("number");
    expect(VIDEO_STYLE_DEFAULTS.pacing.words_per_minute).toBeGreaterThan(0);
    expect(typeof VIDEO_STYLE_DEFAULTS.captions.enabled).toBe("boolean");
    expect(typeof VIDEO_STYLE_DEFAULTS.captions.position).toBe("string");
    expect(typeof VIDEO_STYLE_DEFAULTS.music.level_db).toBe("number");
  });

  test("an absent style.yaml yields exactly the documented defaults", () => {
    const root = makeTmpRoot("ste663-style-absent-");
    expect(existsSync(dptPaths.videoStylePath(root))).toBe(false);
    expect(readVideoStyle(root)).toEqual(VIDEO_STYLE_DEFAULTS);
  });

  test("a present style.yaml is read through the path helper", () => {
    const root = makeTmpRoot("ste663-style-present-");
    writeFile(root, ".dpt/video/style.yaml", "humor: playful\n");
    expect(readVideoStyle(root).humor).toBe("playful");
  });

  test("every documented key is accepted and returned", () => {
    const s = parseVideoStyle(
      [
        "pacing:",
        "  words_per_minute: 150",
        "captions:",
        "  enabled: false",
        "  position: top",
        "music:",
        "  level_db: -24",
        "banned_effects: [whip_pan]",
        "humor: light",
        "layout:",
        "  viewport:",
        "    width: 1920",
        "    height: 1080",
        "",
      ].join("\n"),
    );
    expect(s.pacing.words_per_minute).toBe(150);
    expect(s.captions.enabled).toBe(false);
    expect(s.captions.position).toBe("top");
    expect(s.music.level_db).toBe(-24);
    expect(s.banned_effects).toEqual(["whip_pan"]);
    expect(s.humor).toBe("light");
    expect(s.layout.viewport).toEqual({ width: 1920, height: 1080 });
  });

  test("a partial style fills the rest from the defaults", () => {
    const s = parseVideoStyle("humor: none\n");
    expect(s.humor).toBe("none");
    expect(s.banned_effects).toEqual(["slow_zoom", "ken_burns"]);
    expect(s.layout.viewport).toEqual(VIDEO_STYLE_DEFAULTS.layout.viewport);
    expect(s.pacing).toEqual(VIDEO_STYLE_DEFAULTS.pacing);
  });

  test("humor outside {none, light, playful} refuses naming `humor`", () => {
    expectNfr10Refusal(() => parseVideoStyle("humor: slapstick\n"), "humor");
  });

  test("a non-numeric words_per_minute refuses naming its key path", () => {
    expectNfr10Refusal(() => parseVideoStyle("pacing:\n  words_per_minute: fast\n"), "pacing.words_per_minute");
  });

  test("an unknown top-level key refuses naming it", () => {
    expectNfr10Refusal(() => parseVideoStyle("lens_flare: true\n"), "lens_flare");
  });

  test("an unknown nested key refuses naming its path", () => {
    expectNfr10Refusal(() => parseVideoStyle("captions:\n  font: Comic Sans\n"), "captions.font");
  });
});

// ---------------------------------------------------------------------------
// AC-STE-663.6 — readVideoKeys
// ---------------------------------------------------------------------------

describe("AC-STE-663.6 — readVideoKeys parses .dpt/.env without touching process.env", () => {
  test("KEY=VALUE, comments, single/double quotes, blank lines", () => {
    const root = makeTmpRoot("ste663-keys-");
    sentinelRoots.push(root);
    writeFile(
      root,
      ".dpt/.env",
      [
        "# video keys",
        "",
        `ELEVENLABS_API_KEY=${SENTINEL}`,
        "   ",
        `GOOGLE_TTS_API_KEY='${SENTINEL}-g'`,
        "# DISABLED_KEY=nope",
        'OTHER="hello world"',
        "",
      ].join("\n"),
    );
    const envBefore = { ...process.env };
    const keys = readVideoKeys(root);
    const envAfter = { ...process.env };

    expect(keys).toEqual({
      ELEVENLABS_API_KEY: SENTINEL,
      GOOGLE_TTS_API_KEY: `${SENTINEL}-g`,
      OTHER: "hello world",
    });
    expect(envAfter).toEqual(envBefore);
    expect(Object.values(process.env)).not.toContain(SENTINEL);
  });

  test("an absent .dpt/.env yields an empty map", () => {
    const root = makeTmpRoot("ste663-keys-absent-");
    expect(readVideoKeys(root)).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// AC-STE-663.7 — videoReadiness + front door
// ---------------------------------------------------------------------------

function readiness(root: string): { ready: boolean; reasons: string[] } {
  const r = withoutKeyVarsInProcessEnv(() => videoReadiness(root));
  capturedOutputs.push(JSON.stringify(r));
  return r;
}

function expectReasonsWellFormed(reasons: string[]): void {
  for (const reason of reasons) {
    expect(reason).not.toContain("\n");
    expect(reason).toMatch(/remedy:/i);
  }
}

function runFrontDoor(root: string): { exitCode: number; stdout: string; stderr: string } {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !(KEY_VARS as readonly string[]).includes(k)) env[k] = v;
  }
  const proc = Bun.spawnSync([process.execPath, FRONT_DOOR, root], {
    cwd: PLUGIN_ROOT,
    stdout: "pipe",
    stderr: "pipe",
    env,
  });
  const out = {
    exitCode: proc.exitCode ?? -1,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
  capturedOutputs.push(out.stdout, out.stderr);
  return out;
}

describe("AC-STE-663.7 — videoReadiness", () => {
  test("ready: valid config, provider key present, .dpt/.env ignored", () => {
    const root = makeVideoProject({ config: VALID_CONFIG, env: `ELEVENLABS_API_KEY=${SENTINEL}\n` });
    expect(readiness(root)).toEqual({ ready: true, reasons: [] });
  });

  test("not ready: config absent — the reason names the config path and its remedy", () => {
    const root = makeVideoProject({ config: null, env: `ELEVENLABS_API_KEY=${SENTINEL}\n` });
    const r = readiness(root);
    expect(r.ready).toBe(false);
    expect(r.reasons.some((x) => x.includes(".dpt/video/config.yaml"))).toBe(true);
    expectReasonsWellFormed(r.reasons);
  });

  test("not ready: config invalid — the reason names the offending key path", () => {
    const root = makeVideoProject({
      config: VALID_CONFIG.replace("provider: elevenlabs", "provider: polly"),
      env: `ELEVENLABS_API_KEY=${SENTINEL}\n`,
    });
    const r = readiness(root);
    expect(r.ready).toBe(false);
    expect(r.reasons.some((x) => x.includes("tts.provider"))).toBe(true);
    expectReasonsWellFormed(r.reasons);
  });

  test("not ready: elevenlabs provider without ELEVENLABS_API_KEY", () => {
    const root = makeVideoProject({ config: VALID_CONFIG, env: `GOOGLE_TTS_API_KEY=${SENTINEL}\n` });
    const r = readiness(root);
    expect(r.ready).toBe(false);
    expect(r.reasons.some((x) => x.includes("ELEVENLABS_API_KEY") && x.includes(".dpt/.env"))).toBe(true);
    expectReasonsWellFormed(r.reasons);
  });

  test("not ready: google provider without GOOGLE_TTS_API_KEY (an ElevenLabs key does not count)", () => {
    const root = makeVideoProject({
      config: configWith("  provider: google\n  voice: en-US-Neural2-F", "  kind: web", "  source: none"),
      env: `ELEVENLABS_API_KEY=${SENTINEL}\n`,
    });
    const r = readiness(root);
    expect(r.ready).toBe(false);
    expect(r.reasons.some((x) => x.includes("GOOGLE_TTS_API_KEY"))).toBe(true);
    expectReasonsWellFormed(r.reasons);
  });

  test("ready: google provider with GOOGLE_TTS_API_KEY and no ElevenLabs music", () => {
    const root = makeVideoProject({
      config: configWith("  provider: google\n  voice: en-US-Neural2-F", "  kind: web", "  source: none"),
      env: `GOOGLE_TTS_API_KEY=${SENTINEL}\n`,
    });
    expect(readiness(root)).toEqual({ ready: true, reasons: [] });
  });

  test("not ready: music.source elevenlabs without ELEVENLABS_API_KEY (google TTS)", () => {
    const root = makeVideoProject({
      config: configWith("  provider: google\n  voice: en-US-Neural2-F", "  kind: web", "  source: elevenlabs"),
      env: `GOOGLE_TTS_API_KEY=${SENTINEL}\n`,
    });
    const r = readiness(root);
    expect(r.ready).toBe(false);
    expect(r.reasons.some((x) => x.includes("ELEVENLABS_API_KEY"))).toBe(true);
    expect(r.reasons.some((x) => x.includes("GOOGLE_TTS_API_KEY"))).toBe(false);
    expectReasonsWellFormed(r.reasons);
  });

  test("not ready: .dpt/.env NOT ignored by git (pre-2.96.0 ignore file) — asked of git, remedy named", () => {
    const root = makeVideoProject({
      config: VALID_CONFIG,
      env: `ELEVENLABS_API_KEY=${SENTINEL}\n`,
      gitignore: "old",
    });
    expect(isIgnored(root, ".dpt/.env")).toBe(false);
    const r = readiness(root);
    expect(r.ready).toBe(false);
    const reason = r.reasons.find((x) => x.includes(".dpt/.env") && /ignor/i.test(x));
    expect(reason).toBeDefined();
    expect(reason!).toMatch(/upgrade|\.gitignore/);
    expectReasonsWellFormed(r.reasons);
  });

  test("not ready: no .dpt/.env at all — the missing key is named", () => {
    const root = makeVideoProject({ config: VALID_CONFIG, env: null });
    const r = readiness(root);
    expect(r.ready).toBe(false);
    expect(r.reasons.some((x) => x.includes("ELEVENLABS_API_KEY"))).toBe(true);
  });
});

describe("AC-STE-663.7 — the video_readiness.ts front door", () => {
  test("prints `ready` and exits 0 on a ready project", () => {
    const root = makeVideoProject({ config: VALID_CONFIG, env: `ELEVENLABS_API_KEY=${SENTINEL}\n` });
    const r = runFrontDoor(root);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe("ready");
  });

  test("prints one reason per line and exits 0 on a not-ready project", () => {
    const root = makeVideoProject({
      config: configWith("  provider: google\n  voice: v", "  kind: web", "  source: elevenlabs"),
      env: `OTHER=${SENTINEL}\n`,
      gitignore: "old",
    });
    const expected = readiness(root);
    expect(expected.ready).toBe(false);
    expect(expected.reasons.length).toBeGreaterThanOrEqual(3);

    const r = runFrontDoor(root);
    expect(r.exitCode).toBe(0);
    const lines = r.stdout.split("\n").filter((l) => l.trim() !== "");
    expect(lines).toEqual(expected.reasons);
    expect(lines).not.toContain("ready");
  });

  test("a project with no config at all still exits 0 with a reason", () => {
    const root = makeVideoProject({ config: null, env: null });
    const r = runFrontDoor(root);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain(".dpt/video/config.yaml");
  });
});

// ---------------------------------------------------------------------------
// AC-STE-663.8 — the sentinel never leaks
// ---------------------------------------------------------------------------

describe("AC-STE-663.8 — a planted key value never reaches output, refusals or written files", () => {
  test("a malformed .dpt/.env line holding the sentinel is never quoted back", () => {
    const root = makeVideoProject({
      config: VALID_CONFIG,
      env: `ELEVENLABS_API_KEY="${SENTINEL}\nthis line is not KEY=VALUE ${SENTINEL}\n`,
    });
    let message = "";
    try {
      // Parsing may succeed (the value lives in memory, which is fine) or
      // refuse — but a refusal must never quote the offending line.
      readVideoKeys(root);
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).not.toContain(SENTINEL);
    capturedOutputs.push(message);
    const r = readiness(root);
    expect(JSON.stringify(r)).not.toContain(SENTINEL);
    const fd = runFrontDoor(root);
    expect(fd.stdout + fd.stderr).not.toContain(SENTINEL);
  });

  test("a config refusal in a project with a planted key never carries the key", () => {
    const root = makeVideoProject({
      config: `${VALID_CONFIG}secret: ${SENTINEL}\n`,
      env: `ELEVENLABS_API_KEY=${SENTINEL}\n`,
    });
    const r = readiness(root);
    expect(r.ready).toBe(false);
    for (const reason of r.reasons) expect(reason).not.toContain(SENTINEL);
  });

  test("the sweep instrument is live: it would see the sentinel in a written file", () => {
    // CONTROL for the afterAll sweep — a file outside .dpt/.env holding the
    // sentinel IS found by the same walk + read the sweep uses.
    // A planted input is exempt while unchanged, and caught once rewritten.
    const root = makeTmpRoot("ste663-sweep-control-");
    writeFile(root, ".dpt/video/work/demo/leak.txt", `key=${SENTINEL}\n`);
    writeFile(root, ".dpt/.env", `ELEVENLABS_API_KEY=${SENTINEL}\n`);
    const plantedBody = `${VALID_CONFIG}secret: ${SENTINEL}\n`;
    const planted = writeFile(root, ".dpt/video/config.yaml", plantedBody);
    plantedInputs.set(planted, plantedBody);
    const leakTxt = join(".dpt", "video", "work", "demo", "leak.txt");
    expect(sentinelLeaks(root)).toEqual([leakTxt]);
    // A module rewriting the planted input with the key is a leak, not an input.
    writeFileSync(planted, `${plantedBody}rewritten: ${SENTINEL}\n`);
    expect(sentinelLeaks(root).sort()).toEqual([join(".dpt", "video", "config.yaml"), leakTxt].sort());
  });
});

// ---------------------------------------------------------------------------
// HARDEN-L — AC-STE-663.7: a project that is not a git repository
// ---------------------------------------------------------------------------

describe("HARDEN-L — AC-STE-663.7 readiness outside a git repository", () => {
  test("HARDEN-L a non-git directory reports `not a git repository`, not the /upgrade remedy", () => {
    const root = makeTmpRoot("ste663-nogit-");
    writeDptGitignore(root);
    writeFile(root, ".dpt/video/config.yaml", VALID_CONFIG);
    writeFile(root, ".dpt/.env", "ELEVENLABS_API_KEY=k-harden-l\n");
    // CONTROL: this really is outside any repository — check-ignore exits 128.
    expect(git(root, ["check-ignore", "-q", "--", ".dpt/.env"]).exitCode).toBe(128);
    const r = readiness(root);
    expect(r.ready).toBe(false);
    expect(r.reasons.some((x) => /not a git repository/i.test(x))).toBe(true);
    for (const reason of r.reasons) expect(reason).not.toMatch(/upgrade/i);
    expectReasonsWellFormed(r.reasons);
  });
});
