// M_1e0717 STE-669 — the /video skill and its two front doors.
//
// AC coverage:
//   AC-STE-669.1 — skills/video/SKILL.md exists, user-invocable, within the NFR-1 cap; overflow in docs/video-reference.md.
//   AC-STE-669.2 — video_init.ts writes config/style/scenarios, runs writeDptGitignore, prints the key NAME,
//                  refuses to overwrite config.yaml, never writes .dpt/.env.
//   AC-STE-669.3 — video_pipeline.ts refuses every stage after `script` without an approval record matching
//                  the current script.md hash (NFR-10 shape); with a matching record it runs the stage.
//   AC-STE-669.4 — `approve-script` writes the record with the current hash; editing script.md re-arms the refusal.
//   AC-STE-669.5 — a not-ready project refuses EVERY stage with the readiness reasons; no provider call, no recording.
//   AC-STE-669.6 — the skill text orders the twelve steps and asks each brief question as its own AskUserQuestion.
//   AC-STE-669.7 — counts 28 / 19 on every surface; README reaches /video; probes #57 + skill_unreachable clean.
//   AC-STE-669.8 — driven-run omission of continuation offers + exactly one standalone stage-status-block.
//   AC-STE-669.9 — the full-suite gate, graded by /implement (no test here).
//
// Front-door contract this suite drives (FR § Technical Design):
//   adapters/_shared/src/video_init.ts      — CLI: <projectRoot> <provider> <recorder> <music>
//   adapters/_shared/src/video_pipeline.ts  — CLI: <projectRoot> <slug> <stage>, and in-process:
//       runVideoStage({ projectRoot, slug, stage, handlers? }) : Promise<unknown>
//     * refusals REJECT with an Error whose message is NFR-10 shaped (Refusing / Remedy / Context);
//     * `handlers` is the injection seam: a partial map stage -> async (ctx) => void that replaces the
//       stage's real work (providers, recorders, ffmpeg runner), so these tests make no network call and
//       touch no device;
//     * the script lives at `<videoWorkDir(slug)>/script.md`; the approval record lives in
//       `videoWorkDir(slug)` and carries the SHA-256 hex of script.md's bytes.

import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
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
import { dirname, join } from "node:path";

import {
  dptEnvPath,
  videoConfigPath,
  videoScenariosDir,
  videoStylePath,
  videoWorkDir,
} from "../adapters/_shared/src/dpt_paths";
import { DPT_GITIGNORE_BODY, dptGitignorePath, writeDptGitignore } from "../adapters/_shared/src/setup/dpt_gitignore";
import { parseVideoConfig } from "../adapters/_shared/src/video/config";
import { parseVideoStyle, VIDEO_STYLE_DEFAULTS } from "../adapters/_shared/src/video/style";
import { type SyncRunner, videoReadiness } from "../adapters/_shared/src/video/readiness";
import { runPublicSurfaceCountDriftProbe } from "../adapters/_shared/src/public_surface_count_drift";
import {
  checkReadmeSurfaceReachability,
  readCarveOutProse,
  readDiagramNodes,
  readShippedSkills,
} from "../adapters/_shared/src/readme_surface_reachability";
import { ADOPTING_STAGES, scanStageBlockAdoption } from "../adapters/_shared/src/stage_block_adoption";
import { closedStatusFences } from "../adapters/_shared/src/stage_status_block";
import {
  DRIVEN_SUPPRESSION_CLAUSE,
  documentsDrivenSuppression,
  scanDrivenSuppressionAdoption,
} from "../adapters/_shared/src/inline_terminal_block";
import {
  DRIVEN_OMISSION_CLAUSE,
  drivenOmissionOccurrences,
  offersForSkill,
  scanContinuationOfferAdoption,
} from "../adapters/_shared/src/continuation_offer";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const SRC = join(PLUGIN_ROOT, "adapters", "_shared", "src");
const INIT_DOOR = join(SRC, "video_init.ts");
const PIPELINE_DOOR = join(SRC, "video_pipeline.ts");
const SKILL_MD = join(PLUGIN_ROOT, "skills", "video", "SKILL.md");
const VIDEO_REFERENCE = join(PLUGIN_ROOT, "docs", "video-reference.md");

/** NFR-1 — the cap `tests/skill-nfr-1-length.test.ts` enforces (specs/requirements.md § NFR-1). */
const SKILL_LINE_CAP = 358;

/** The stage vocabulary of the pipeline front door, in pipeline order. */
const ALL_STAGES = ["script", "approve-script", "voice", "record", "music", "edl", "render", "qa"] as const;
/** Every stage after `script` that the approval gate guards. */
const GATED_STAGES = ["voice", "record", "music", "edl", "render", "qa"] as const;

const SLUG = "demo-feature";
const FAKE_KEY = "sk-ste669-test-key";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const tmpRoots: string[] = [];

function makeTmpRoot(prefix: string): string {
  // tmpdir() is outside the repo, so a nested `git init` never sees this checkout.
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

const READY_CONFIG = [
  "tts:",
  "  provider: elevenlabs",
  "  voice: narrator",
  "recorder:",
  "  kind: web",
  "music:",
  "  source: none",
  "",
].join("\n");

/**
 * Readiness checks `ffmpeg -filters` for `drawtext` whenever captions are on
 * (AC-STE-675.3). None of these tests is about captions, so every in-process
 * readiness / stage call answers that probe with a filter list that HAS
 * drawtext — the suite never depends on the host's ffmpeg build.
 */
const FFMPEG_WITH_DRAWTEXT: SyncRunner = () => ({
  code: 0,
  stdout: " T.C drawtext          V->V       Draw text on top of video frames using libfreetype library.\n",
  stderr: "",
});

function readinessOf(root: string): ReturnType<typeof videoReadiness> {
  return videoReadiness(root, { ffmpegRunner: FFMPEG_WITH_DRAWTEXT });
}

/**
 * A temp git project that `videoReadiness` reports ready. `captionsOff` is for
 * spawned front doors, where no ffmpeg runner can be injected: turning captions
 * off in the stored style removes the host-ffmpeg drawtext probe from readiness.
 */
function readyProject(prefix: string, opts: { captionsOff?: boolean } = {}): string {
  const root = makeTmpRoot(prefix);
  expect(git(root, ["init", "-q"])).toBe(0);
  writeDptGitignore(root);
  writeFile(videoConfigPath(root), READY_CONFIG);
  writeFile(dptEnvPath(root), `ELEVENLABS_API_KEY=${FAKE_KEY}\n`);
  if (opts.captionsOff === true) {
    writeFile(videoStylePath(root), "captions:\n  enabled: false\n");
    expect(videoReadiness(root)).toEqual({ ready: true, reasons: [] });
  }
  expect(readinessOf(root)).toEqual({ ready: true, reasons: [] });
  return root;
}

/** A temp git project with no video config at all — not ready. */
function notReadyProject(prefix: string): string {
  const root = makeTmpRoot(prefix);
  expect(git(root, ["init", "-q"])).toBe(0);
  expect(readinessOf(root).ready).toBe(false);
  return root;
}

function scriptPath(root: string, slug = SLUG): string {
  return join(videoWorkDir(root, slug), "script.md");
}

function writeScript(root: string, body: string, slug = SLUG): string {
  const p = scriptPath(root, slug);
  writeFile(p, body);
  return p;
}

function sha256Hex(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** Files in the work dir (recursively) other than script.md, whose text carries `needle`. */
function filesCarrying(dir: string, needle: string): string[] {
  if (!existsSync(dir)) return [];
  const hits: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name !== "script.md" && readFileSync(full, "utf-8").includes(needle)) hits.push(full);
    }
  };
  walk(dir);
  return hits;
}

function expectNfr10(message: string): void {
  expect(message).toMatch(/^Refusing: /m);
  expect(message).toMatch(/^Remedy: /m);
  expect(message).toMatch(/^Context: /m);
}

type Handler = (ctx: { projectRoot: string; slug: string; workDir?: string }) => Promise<void>;

/** A handler map whose every stage records its calls instead of doing real work. */
function spyHandlers(): { handlers: Record<string, Handler>; calls: string[] } {
  const calls: string[] = [];
  const handlers: Record<string, Handler> = {};
  for (const stage of ALL_STAGES) {
    if (stage === "approve-script") continue; // the gate's own stage is never injected
    handlers[stage] = async () => {
      calls.push(stage);
    };
  }
  return { handlers, calls };
}

async function loadPipeline(): Promise<{
  runVideoStage: (opts: {
    projectRoot: string;
    slug: string;
    stage: string;
    handlers?: Record<string, Handler>;
    deps?: { ffmpegRunner?: SyncRunner };
  }) => Promise<unknown>;
}> {
  const mod = await import(PIPELINE_DOOR);
  expect(typeof mod.runVideoStage).toBe("function");
  return mod;
}

/** Run a stage in-process; returns the refusal message, or null when the stage ran. */
async function stageRefusal(
  root: string,
  stage: string,
  handlers?: Record<string, Handler>,
  slug = SLUG,
): Promise<string | null> {
  const { runVideoStage } = await loadPipeline();
  try {
    await runVideoStage({ projectRoot: root, slug, stage, handlers, deps: { ffmpegRunner: FFMPEG_WITH_DRAWTEXT } });
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

function runDoor(door: string, args: string[]): { exitCode: number; out: string } {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !/API_KEY$/.test(k)) env[k] = v;
  }
  const proc = Bun.spawnSync([process.execPath, door, ...args], {
    cwd: PLUGIN_ROOT,
    stdout: "pipe",
    stderr: "pipe",
    env,
  });
  return {
    exitCode: proc.exitCode ?? -1,
    out: proc.stdout.toString() + proc.stderr.toString(),
  };
}

const read = (p: string): string => readFileSync(p, "utf-8");
const skillBody = (): string => read(SKILL_MD);

// ===========================================================================
// AC-STE-669.1 — the skill file, its menu slot and its size
// ===========================================================================

describe("AC-STE-669.1 — skills/video/SKILL.md", () => {
  test("the skill file exists with `name: video` frontmatter", () => {
    expect(existsSync(SKILL_MD)).toBe(true);
    const body = skillBody();
    expect(body.startsWith("---")).toBe(true);
    const fm = body.split(/^---\s*$/m)[1] ?? "";
    expect(fm).toMatch(/^name:\s*video\s*$/m);
    expect(fm).toMatch(/^description:\s*\S/m);
  });

  test("it is user-invocable — read by the same reader probe skill_unreachable uses", () => {
    const { userInvocable, dispatch } = readShippedSkills(PLUGIN_ROOT);
    expect(userInvocable).toContain("video");
    expect(dispatch).not.toContain("video");
  });

  test(`it stays within the NFR-1 cap (≤ ${SKILL_LINE_CAP} lines)`, () => {
    expect(skillBody().split("\n").length).toBeLessThanOrEqual(SKILL_LINE_CAP);
  });

  test("overflow lives in docs/video-reference.md, and the skill points at it", () => {
    expect(existsSync(VIDEO_REFERENCE)).toBe(true);
    expect(read(VIDEO_REFERENCE).trim().length).toBeGreaterThan(0);
    expect(skillBody()).toContain("docs/video-reference.md");
  });
});

// ===========================================================================
// AC-STE-669.2 — video_init.ts
// ===========================================================================

describe("AC-STE-669.2 — the video_init.ts front door", () => {
  function initProject(prefix: string): string {
    const root = makeTmpRoot(prefix);
    expect(git(root, ["init", "-q"])).toBe(0);
    return root;
  }

  test("writes a valid config.yaml carrying the three chosen values", () => {
    const root = initProject("ste669-init-config-");
    const r = runDoor(INIT_DOOR, [root, "elevenlabs", "web", "none"]);
    expect(r.exitCode).toBe(0);
    const config = parseVideoConfig(read(videoConfigPath(root)));
    expect(config.tts.provider).toBe("elevenlabs");
    expect(config.tts.voice.trim().length).toBeGreaterThan(0);
    expect(config.recorder.kind).toBe("web");
    expect(config.music.source).toBe("none");
  });

  test("honours a different provider / recorder / music triple", () => {
    const root = initProject("ste669-init-triple-");
    const r = runDoor(INIT_DOOR, [root, "google", "footage", "elevenlabs"]);
    expect(r.exitCode).toBe(0);
    const config = parseVideoConfig(read(videoConfigPath(root)));
    expect(config.tts.provider).toBe("google");
    expect(config.recorder.kind).toBe("footage");
    expect(config.music.source).toBe("elevenlabs");
  });

  test("writes style.yaml spelling out the documented defaults", () => {
    const root = initProject("ste669-init-style-");
    expect(runDoor(INIT_DOOR, [root, "elevenlabs", "web", "none"]).exitCode).toBe(0);
    const raw = read(videoStylePath(root));
    // Written out, not an empty file that merely falls back to the defaults.
    expect(raw).toContain("words_per_minute");
    expect(raw).toContain("humor");
    expect(parseVideoStyle(raw)).toEqual(VIDEO_STYLE_DEFAULTS);
  });

  test("creates the scenarios/ directory", () => {
    const root = initProject("ste669-init-scenarios-");
    expect(runDoor(INIT_DOOR, [root, "elevenlabs", "web", "none"]).exitCode).toBe(0);
    expect(existsSync(videoScenariosDir(root))).toBe(true);
    expect(statSync(videoScenariosDir(root)).isDirectory()).toBe(true);
  });

  test("runs writeDptGitignore: the canonical ignore body is in place and .dpt/.env is ignored", () => {
    const root = initProject("ste669-init-gitignore-");
    expect(existsSync(dptGitignorePath(root))).toBe(false);
    expect(runDoor(INIT_DOOR, [root, "elevenlabs", "web", "none"]).exitCode).toBe(0);
    expect(read(dptGitignorePath(root))).toBe(DPT_GITIGNORE_BODY);
    const envRel = dptEnvPath(".").replace(/^\.\//, "");
    expect(git(root, ["check-ignore", "-q", "--", envRel])).toBe(0);
  });

  test("prints the key variable NAME for elevenlabs, and never asks for or writes a key", () => {
    const root = initProject("ste669-init-key-el-");
    const r = runDoor(INIT_DOOR, [root, "elevenlabs", "web", "none"]);
    expect(r.exitCode).toBe(0);
    expect(r.out).toContain("ELEVENLABS_API_KEY");
    expect(r.out).not.toContain("GOOGLE_TTS_API_KEY");
    expect(existsSync(dptEnvPath(root))).toBe(false);
  });

  test("prints GOOGLE_TTS_API_KEY for the google provider, and writes no .dpt/.env", () => {
    const root = initProject("ste669-init-key-google-");
    const r = runDoor(INIT_DOOR, [root, "google", "web", "none"]);
    expect(r.exitCode).toBe(0);
    expect(r.out).toContain("GOOGLE_TTS_API_KEY");
    expect(existsSync(dptEnvPath(root))).toBe(false);
  });

  test("after init plus the named key, the project is ready", () => {
    const root = initProject("ste669-init-ready-");
    expect(runDoor(INIT_DOOR, [root, "elevenlabs", "web", "none"]).exitCode).toBe(0);
    writeFile(dptEnvPath(root), `ELEVENLABS_API_KEY=${FAKE_KEY}\n`);
    expect(readinessOf(root)).toEqual({ ready: true, reasons: [] });
  });

  test("refuses to overwrite an existing config.yaml, byte-for-byte, writing nothing else", () => {
    const root = initProject("ste669-init-refuse-");
    const original = "# hand-tuned\n" + READY_CONFIG;
    writeFile(videoConfigPath(root), original);
    const r = runDoor(INIT_DOOR, [root, "google", "footage", "none"]);
    expect(r.exitCode).not.toBe(0);
    expectNfr10(r.out);
    expect(read(videoConfigPath(root))).toBe(original);
    expect(existsSync(videoStylePath(root))).toBe(false);
    expect(existsSync(dptEnvPath(root))).toBe(false);
  });

  test("refuses an unknown provider without writing a config", () => {
    const root = initProject("ste669-init-badprovider-");
    const r = runDoor(INIT_DOOR, [root, "acme-tts", "web", "none"]);
    expect(r.exitCode).not.toBe(0);
    expect(r.out).toMatch(/^Refusing: /m);
    expect(existsSync(videoConfigPath(root))).toBe(false);
  });
});

// ===========================================================================
// AC-STE-669.3 — the script-approval gate
// ===========================================================================

describe("AC-STE-669.3 — stages after `script` refuse without a matching approval record", () => {
  for (const stage of GATED_STAGES) {
    test(`\`${stage}\` refuses in the NFR-10 shape when no approval record exists`, async () => {
      const root = readyProject(`ste669-gate-none-${stage}-`);
      writeScript(root, "# Script\n\nShot 1: open the dashboard.\n");
      const { handlers, calls } = spyHandlers();
      const refusal = await stageRefusal(root, stage, handlers);
      expect(refusal).not.toBeNull();
      expectNfr10(refusal!);
      expect(refusal!).toContain("approve-script");
      expect(calls).toEqual([]);
    });
  }

  test("the `script` stage itself is not gated", async () => {
    const root = readyProject("ste669-gate-script-");
    const { handlers } = spyHandlers();
    expect(await stageRefusal(root, "script", handlers)).toBeNull();
  });

  test("a record whose hash differs from the current script.md refuses", async () => {
    const root = readyProject("ste669-gate-mismatch-");
    const script = writeScript(root, "# Script\n\nShot 1: the settings page.\n");
    expect(await stageRefusal(root, "approve-script")).toBeNull();
    const hash = sha256Hex(script);
    const records = filesCarrying(videoWorkDir(root, SLUG), hash);
    expect(records.length).toBe(1);
    // Forge the record's hash; the script itself is unchanged.
    const record = records[0]!;
    writeFileSync(record, read(record).split(hash).join("0".repeat(64)));
    const { handlers, calls } = spyHandlers();
    const refusal = await stageRefusal(root, "voice", handlers);
    expect(refusal).not.toBeNull();
    expectNfr10(refusal!);
    expect(calls).toEqual([]);
  });

  for (const stage of GATED_STAGES) {
    test(`with a matching record, \`${stage}\` runs (its handler is called once)`, async () => {
      const root = readyProject(`ste669-gate-run-${stage}-`);
      writeScript(root, "# Script\n\nShot 1: create a project.\n");
      expect(await stageRefusal(root, "approve-script")).toBeNull();
      const { handlers, calls } = spyHandlers();
      expect(await stageRefusal(root, stage, handlers)).toBeNull();
      expect(calls).toEqual([stage]);
    });
  }

  test("CLI: a ready project with no approval refuses `voice` with a non-zero exit", () => {
    const root = readyProject("ste669-gate-cli-", { captionsOff: true });
    writeScript(root, "# Script\n\nShot 1.\n");
    const r = runDoor(PIPELINE_DOOR, [root, SLUG, "voice"]);
    expect(r.exitCode).not.toBe(0);
    expectNfr10(r.out);
  });
});

// ===========================================================================
// AC-STE-669.4 — approve-script writes the record; an edit re-arms the gate
// ===========================================================================

describe("AC-STE-669.4 — approve-script", () => {
  test("writes an approval record in the work dir carrying script.md's SHA-256", async () => {
    const root = readyProject("ste669-approve-record-");
    const script = writeScript(root, "# Script\n\nShot 1: sign in.\n");
    expect(filesCarrying(videoWorkDir(root, SLUG), sha256Hex(script))).toEqual([]);
    expect(await stageRefusal(root, "approve-script")).toBeNull();
    expect(filesCarrying(videoWorkDir(root, SLUG), sha256Hex(script)).length).toBe(1);
  });

  test("editing script.md after approval makes the gated stages refuse again; re-approval re-opens", async () => {
    const root = readyProject("ste669-approve-edit-");
    const script = writeScript(root, "# Script\n\nShot 1: sign in.\n");
    expect(await stageRefusal(root, "approve-script")).toBeNull();

    const first = spyHandlers();
    expect(await stageRefusal(root, "voice", first.handlers)).toBeNull();
    expect(first.calls).toEqual(["voice"]);

    writeFileSync(script, "# Script\n\nShot 1: sign in. Shot 2: sign out.\n");
    const second = spyHandlers();
    const refusal = await stageRefusal(root, "voice", second.handlers);
    expect(refusal).not.toBeNull();
    expectNfr10(refusal!);
    expect(second.calls).toEqual([]);

    expect(await stageRefusal(root, "approve-script")).toBeNull();
    expect(filesCarrying(videoWorkDir(root, SLUG), sha256Hex(script)).length).toBe(1);
    const third = spyHandlers();
    expect(await stageRefusal(root, "voice", third.handlers)).toBeNull();
    expect(third.calls).toEqual(["voice"]);
  });

  test("approve-script with no script.md refuses in the NFR-10 shape and writes no record", async () => {
    const root = readyProject("ste669-approve-noscript-");
    const refusal = await stageRefusal(root, "approve-script");
    expect(refusal).not.toBeNull();
    expectNfr10(refusal!);
    expect(refusal!).toContain("script.md");
    const work = videoWorkDir(root, SLUG);
    expect(existsSync(work) ? readdirSync(work) : []).toEqual([]);
  });

  test("CLI: approve-script exits 0 and writes the record; an edit then makes `voice` refuse", () => {
    const root = readyProject("ste669-approve-cli-", { captionsOff: true });
    const script = writeScript(root, "# Script\n\nShot 1: the CLI path.\n");
    const ok = runDoor(PIPELINE_DOOR, [root, SLUG, "approve-script"]);
    expect(ok.exitCode).toBe(0);
    expect(filesCarrying(videoWorkDir(root, SLUG), sha256Hex(script)).length).toBe(1);

    writeFileSync(script, "# Script\n\nShot 1: edited after approval.\n");
    const r = runDoor(PIPELINE_DOOR, [root, SLUG, "voice"]);
    expect(r.exitCode).not.toBe(0);
    expectNfr10(r.out);
  });
});

// ===========================================================================
// AC-STE-669.5 — not ready refuses every stage, before any provider or recorder
// ===========================================================================

describe("AC-STE-669.5 — a not-ready project refuses every stage with the readiness reasons", () => {
  for (const stage of ALL_STAGES) {
    test(`\`${stage}\` refuses, naming every readiness reason, and calls no handler`, async () => {
      const root = notReadyProject(`ste669-notready-${stage}-`);
      writeScript(root, "# Script\n\nShot 1.\n");
      const reasons = readinessOf(root).reasons;
      expect(reasons.length).toBeGreaterThan(0);
      const { handlers, calls } = spyHandlers();
      const refusal = await stageRefusal(root, stage, handlers);
      expect(refusal).not.toBeNull();
      expect(refusal!).toMatch(/^Refusing: /m);
      for (const reason of reasons) expect(refusal!).toContain(reason);
      expect(calls).toEqual([]);
    });
  }

  test("an APPROVED script on a project that stopped being ready still refuses (readiness first)", async () => {
    const root = readyProject("ste669-notready-approved-");
    writeScript(root, "# Script\n\nShot 1.\n");
    expect(await stageRefusal(root, "approve-script")).toBeNull();
    rmSync(dptEnvPath(root)); // the key goes away
    const reasons = readinessOf(root).reasons;
    expect(reasons.length).toBeGreaterThan(0);
    const { handlers, calls } = spyHandlers();
    const refusal = await stageRefusal(root, "voice", handlers);
    expect(refusal).not.toBeNull();
    for (const reason of reasons) expect(refusal!).toContain(reason);
    expect(calls).toEqual([]);
  });

  test("with the DEFAULT handlers, a not-ready refusal makes no network call and spawns no recorder", async () => {
    const root = notReadyProject("ste669-notready-defaults-");
    writeScript(root, "# Script\n\nShot 1.\n");
    const realFetch = globalThis.fetch;
    const realSpawn = Bun.spawn;
    let fetches = 0;
    let spawns = 0;
    globalThis.fetch = (async () => {
      fetches += 1;
      throw new Error("network forbidden in this test");
    }) as unknown as typeof fetch;
    (Bun as { spawn: unknown }).spawn = (() => {
      spawns += 1;
      throw new Error("spawn forbidden in this test");
    }) as unknown;
    try {
      for (const stage of GATED_STAGES) {
        const refusal = await stageRefusal(root, stage);
        expect(refusal).not.toBeNull();
        expect(refusal!).toMatch(/^Refusing: /m);
      }
    } finally {
      globalThis.fetch = realFetch;
      (Bun as { spawn: unknown }).spawn = realSpawn;
    }
    expect(fetches).toBe(0);
    expect(spawns).toBe(0);
  });

  test("CLI: a not-ready project refuses `record` with a non-zero exit and the readiness reasons", () => {
    const root = notReadyProject("ste669-notready-cli-");
    const reasons = readinessOf(root).reasons;
    const r = runDoor(PIPELINE_DOOR, [root, SLUG, "record"]);
    expect(r.exitCode).not.toBe(0);
    expect(r.out).toMatch(/^Refusing: /m);
    for (const reason of reasons) expect(r.out).toContain(reason);
  });
});

// ===========================================================================
// AC-STE-669.6 — step order and the one-question rule
// ===========================================================================

/**
 * The twelve steps, in the order the FR fixes. Each step is recognised by a
 * markdown heading; the more specific labels are tried first so a
 * "Script approval" heading is never read as "Script".
 */
const STEP_LABELS: readonly { step: string; re: RegExp }[] = [
  { step: "readiness", re: /\breadiness\b/i },
  { step: "brief", re: /\bbrief\b/i },
  { step: "research", re: /\bresearch\b/i },
  { step: "script", re: /\bscript\b(?!\s+approval)/i },
  { step: "script approval", re: /\bscript approval\b/i },
  { step: "voice", re: /\bvoice\b/i },
  { step: "record", re: /\brecord(?:ing)?\b/i },
  { step: "music", re: /\bmusic\b/i },
  { step: "edit list", re: /\bedit list\b/i },
  { step: "render", re: /\brender\b/i },
  { step: "QA", re: /\bQA\b/ },
  { step: "final-cut review", re: /\bfinal[- ]cut review\b/i },
];
const SPECIFICITY = ["script approval", "final-cut review", "edit list"];

function headingSteps(body: string): string[] {
  const ordered = [
    ...STEP_LABELS.filter((l) => SPECIFICITY.includes(l.step)),
    ...STEP_LABELS.filter((l) => !SPECIFICITY.includes(l.step)),
  ];
  const steps: string[] = [];
  for (const line of body.split("\n")) {
    const m = /^#{2,4}\s+(.*)$/.exec(line);
    if (!m) continue;
    const hit = ordered.find((l) => l.re.test(m[1]!));
    if (hit) steps.push(hit.step);
  }
  return steps;
}

/** Is `wanted` a subsequence of `seen`? */
function inOrder(seen: readonly string[], wanted: readonly string[]): boolean {
  let i = 0;
  for (const s of seen) if (s === wanted[i]) i += 1;
  return i === wanted.length;
}

/** The section under the first heading matching `re`, up to the next heading of the same or higher level. */
function sectionUnder(body: string, re: RegExp): string {
  const lines = body.split("\n");
  const start = lines.findIndex((l) => /^#{2,4}\s/.test(l) && re.test(l));
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

describe("AC-STE-669.6 — the run's step order and the one-question rule", () => {
  const WANTED = STEP_LABELS.map((l) => l.step);

  test("the skill's headings carry the twelve steps in the FR's order", () => {
    const seen = headingSteps(skillBody());
    for (const step of WANTED) expect(seen).toContain(step);
    expect(inOrder(seen, WANTED)).toBe(true);
  });

  test("FALSIFIABILITY — the order check reds on a synthetic body with two steps swapped", () => {
    const good = WANTED.map((s, i) => `### ${i + 1}. ${s[0]!.toUpperCase()}${s.slice(1)}`).join("\n\n");
    expect(inOrder(headingSteps(good), WANTED)).toBe(true);
    const swapped = good.replace("### 6. Voice", "### 6. TMP").replace("### 7. Record", "### 6. Voice").replace("### 6. TMP", "### 7. Record");
    expect(inOrder(headingSteps(swapped), WANTED)).toBe(false);
  });

  test("the brief asks each question as its own AskUserQuestion", () => {
    const brief = sectionUnder(skillBody(), /\bbrief\b/i);
    expect(brief.length).toBeGreaterThan(0);
    expect(brief).toContain("AskUserQuestion");
    // The rule, stated: one question per AskUserQuestion call.
    expect(brief).toMatch(/each[^.\n]*question[^.\n]*(?:its own|one)[^.\n]*`?AskUserQuestion`?|one question (?:at a time|per `?AskUserQuestion`?)/i);
    // The five brief topics the FR names.
    for (const topic of [/\bfeature\b/i, /\baudience\b/i, /\blength\b/i, /\bdemo\b|\btechnical depth\b/i, /\btone\b/i, /\bhumou?r\b/i]) {
      expect(brief).toMatch(topic);
    }
  });

  test("the run gates voicing on script approval and ends on the final-cut review", () => {
    const body = skillBody();
    const approval = sectionUnder(body, /\bscript approval\b/i);
    expect(approval).toContain("approve-script");
    const finalCut = sectionUnder(body, /\bfinal[- ]cut review\b/i);
    expect(finalCut.length).toBeGreaterThan(0);
    // Approve, or send back to the script or the edit (FR § Requirement, "Then").
    expect(finalCut).toMatch(/\bapprove/i);
    expect(finalCut).toMatch(/\bscript\b/i);
    expect(finalCut).toMatch(/\bedit\b/i);
  });
});

// ===========================================================================
// AC-STE-669.7 — counts 28 / 19 and README reachability
// ===========================================================================

describe("AC-STE-669.7 — skill counts and reachability", () => {
  const README = (): string => read(join(REPO_ROOT, "README.md"));
  const CLAUDE_MD = (): string => read(join(REPO_ROOT, "CLAUDE.md"));

  test("on disk: 28 skills, 19 user-invocable, 9 dispatch", () => {
    const { userInvocable, dispatch } = readShippedSkills(PLUGIN_ROOT);
    expect(userInvocable.length + dispatch.length).toBe(28);
    expect(userInvocable.length).toBe(19);
    expect(dispatch.length).toBe(9);
  });

  test("CLAUDE.md: 28 slash commands (19 user-invocable + 9 dispatch", () => {
    expect(CLAUDE_MD()).toMatch(/28\s+slash commands\s+\(19\s+user-invocable\s+\+\s+9\s+dispatch/);
  });

  test("README: `19 commands, 8 agents` and the `28 (19 + 9)` repo-tree row", () => {
    const body = README();
    expect(body.split("\n")[2] ?? "").toMatch(/19\s+commands?,\s+8\s+agents?/);
    expect(body).toMatch(/28\s*\(19\s*\+\s*9\)/);
    expect(body).toMatch(/\(19 user-invocable \+ 9 internal forks\)/);
  });

  test("specs/technical-spec.md: 19 user-invocable SKILL.md files", () => {
    expect(read(join(REPO_ROOT, "specs", "technical-spec.md"))).toMatch(/19 user-invocable SKILL\.md files/);
  });

  test("specs/testing-spec.md: all 28 skills", () => {
    expect(read(join(REPO_ROOT, "specs", "testing-spec.md"))).toMatch(/all 28 skills/);
  });

  test("the README reaches /video — a diagram node or named in the carve-out prose", () => {
    const body = README();
    const reachable = readDiagramNodes(body).includes("video") || /\/video\b/.test(readCarveOutProse(body));
    expect(reachable).toBe(true);
  });

  test("skill_unreachable reports nothing over the shipped README", () => {
    expect(checkReadmeSurfaceReachability(README(), PLUGIN_ROOT)).toEqual([]);
  });

  test("public_surface_count_drift reports nothing over the shipped tree", async () => {
    const report = await runPublicSurfaceCountDriftProbe(REPO_ROOT);
    expect(report.violations).toEqual([]);
  });
});

// ===========================================================================
// AC-STE-669.8 — driven-run omission + one standalone stage-status-block
// ===========================================================================

describe("AC-STE-669.8 — continuation offers and the closing block", () => {
  test("/video is an adopting stage of the stage-status-block contract", () => {
    expect(ADOPTING_STAGES as readonly string[]).toContain("video");
  });

  test("the skill documents exactly one closed stage-status-block, naming `stage: video`", () => {
    const fences = closedStatusFences(skillBody());
    expect(fences.length).toBe(1);
    expect(skillBody()).toMatch(/^```stage-status-block\s*\nstage:\s*video\b/m);
  });

  test("scanStageBlockAdoption reports no violation for /video", () => {
    const hits = scanStageBlockAdoption(REPO_ROOT).filter((v) => v.stage === ("video" as never));
    expect(hits).toEqual([]);
  });

  test("the closing block is skipped under the driven-run marker (DRIVEN_SUPPRESSION_CLAUSE)", () => {
    expect(documentsDrivenSuppression(skillBody())).toBe(true);
    expect(skillBody()).toContain(DRIVEN_SUPPRESSION_CLAUSE);
    const hits = scanDrivenSuppressionAdoption(REPO_ROOT).filter((v) => v.stage === ("video" as never));
    expect(hits).toEqual([]);
  });

  test("its continuation offers are omitted under the driven-run marker (DRIVEN_OMISSION_CLAUSE)", () => {
    const owed = Math.max(1, offersForSkill("video").length);
    expect(skillBody()).toContain(DRIVEN_OMISSION_CLAUSE);
    expect(drivenOmissionOccurrences(skillBody())).toBeGreaterThanOrEqual(owed);
    const hits = scanContinuationOfferAdoption(REPO_ROOT).filter((v) => v.skill === "video");
    expect(hits).toEqual([]);
  });
});

// ===========================================================================
// HARDEN — phase 3 hardening round (M_1e0717)
// ===========================================================================

/** A ready project whose script is approved; `config` overrides the ready config. */
async function approvedProject(prefix: string, config?: string): Promise<{ root: string; workDir: string }> {
  const root = readyProject(prefix);
  if (config !== undefined) {
    writeFile(videoConfigPath(root), config);
    expect(readinessOf(root)).toEqual({ ready: true, reasons: [] });
  }
  writeScript(root, "# Script\n\nShot 1: open the dashboard.\n");
  expect(await stageRefusal(root, "approve-script")).toBeNull();
  return { root, workDir: videoWorkDir(root, SLUG) };
}

function ffmpegFixture(cwd: string, args: string[]): void {
  const p = Bun.spawnSync(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (p.exitCode !== 0) throw new Error(`fixture ffmpeg failed (${p.exitCode}): ${p.stderr.toString()}`);
}

describe("HARDEN-B — the default `qa` handler resolves word anchors through the alignments", () => {
  test(
    "HARDEN-B an EDL with a { segment, word } punchline passes QA with the default handler",
    async () => {
      const { root, workDir } = await approvedProject("ste669-harden-b-");
      mkdirSync(workDir, { recursive: true });
      // A real two-second final.mp4 (one video + one audio stream). The sine is
      // raised to the default -16 LUFS target, since QA now checks loudness (STE-674).
      ffmpegFixture(workDir, [
        "-f", "lavfi", "-i", "testsrc=duration=2:size=320x240:rate=25",
        "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
        "-af", "volume=5.8dB",
        "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "final.mp4",
      ]);
      writeFile(
        join(workDir, "alignment", "1.json"),
        JSON.stringify([
          { word: "Ship", start: 0.1, end: 0.4 },
          { word: "it", start: 0.9, end: 1.2 },
        ]),
      );
      writeFile(
        join(workDir, "edl.json"),
        JSON.stringify({
          edl_version: 1,
          clips: [{ src: "clips/pattern.mp4", in: 0, out: 2 }],
          voice: [{ segment: 1, audio: "segments/1.mp3", offset: 0 }],
          anchors: [{ name: "punchline", at: { segment: 1, word: 2 } }],
        }),
      );
      const refusal = await stageRefusal(root, "qa");
      expect(refusal).toBeNull();
      expect(existsSync(join(workDir, "qa", "punchline.png"))).toBe(true);
    },
    60_000,
  );
});

describe("HARDEN-C — the default `music` stage runs before the edit list exists", () => {
  const MUSIC_CONFIG = READY_CONFIG.replace("  source: none", "  source: elevenlabs");

  test("HARDEN-C with segments + alignments but no edl.json, music succeeds at the voice-derived length", async () => {
    const { root, workDir } = await approvedProject("ste669-harden-c-", MUSIC_CONFIG);
    writeFile(
      join(workDir, "segments.json"),
      JSON.stringify([
        { index: 1, text: "Meet the pipeline." },
        { index: 2, text: "It caches stages." },
      ]),
    );
    // Planned length rule: the sum, over segments, of each segment's last word end.
    writeFile(
      join(workDir, "alignment", "1.json"),
      JSON.stringify([
        { word: "Meet", start: 0, end: 0.3 },
        { word: "the", start: 0.35, end: 0.5 },
        { word: "pipeline.", start: 0.55, end: 1.25 },
      ]),
    );
    writeFile(
      join(workDir, "alignment", "2.json"),
      JSON.stringify([
        { word: "It", start: 0, end: 0.2 },
        { word: "caches", start: 0.3, end: 0.9 },
        { word: "stages.", start: 1.0, end: 2.5 },
      ]),
    );
    expect(existsSync(join(workDir, "edl.json"))).toBe(false);

    const requests: { url: string; body: any }[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: any, init?: RequestInit) => {
      requests.push({ url: String(input), body: JSON.parse(String(init?.body ?? "{}")) });
      return new Response(new Uint8Array([0x49, 0x44, 0x33]), { status: 200 });
    }) as unknown as typeof fetch;
    let refusal: string | null;
    try {
      refusal = await stageRefusal(root, "music");
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(refusal).toBeNull();
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toContain("/v1/music");
    expect(requests[0]!.body.music_length_ms).toBe(3750);
    expect(existsSync(join(workDir, "music.mp3"))).toBe(true);
  });
});

describe("HARDEN-D — the skill tells the session to write segments.json and shots.json", () => {
  test("HARDEN-D the voice step writes segments.json in the work dir before running `voice`", () => {
    const voice = sectionUnder(skillBody(), /\bvoice\b/i);
    expect(voice).toContain("segments.json");
    expect(voice).toMatch(/\bwrite\b[^\n]*`?segments\.json`?/i);
    expect(voice.indexOf("segments.json")).toBeLessThan(voice.indexOf("`voice`"));
  });

  test("HARDEN-D the record step writes shots.json in the work dir before running `record`", () => {
    const record = sectionUnder(skillBody(), /\brecord\b/i);
    expect(record).toContain("shots.json");
    expect(record).toMatch(/\bwrite\b[^\n]*`?shots\.json`?/i);
    expect(record.indexOf("shots.json")).toBeLessThan(record.indexOf("`record`"));
  });

  test("HARDEN-D control: the edit-list step still writes edl.json", () => {
    expect(sectionUnder(skillBody(), /\bedit list\b/i)).toMatch(/\bwrite\b[^\n]*`?edl\.json`?/i);
  });
});

describe("HARDEN-E — the final-cut review survives the driven-run marker", () => {
  test("HARDEN-E the final-cut review step states it always runs", () => {
    const finalCut = sectionUnder(skillBody(), /\bfinal[- ]cut review\b/i);
    expect(finalCut).toMatch(/\balways runs\b/i);
  });

  test("HARDEN-E the driven-run omission paragraph does not name the final-cut review as an omitted offer", () => {
    const driven = skillBody()
      .split(/\n\s*\n/)
      .filter((p) => p.includes(DRIVEN_OMISSION_CLAUSE));
    expect(driven.length).toBeGreaterThan(0);
    for (const p of driven) {
      expect(p).not.toMatch(/final[- ]cut/i);
      expect(p).not.toMatch(/send[- ]back/i);
    }
  });
});

describe("HARDEN-I — the not-ready refusal remedy names `/video init`", () => {
  test("HARDEN-I the Remedy line names `/video init`, not \"the video init stage\"", async () => {
    const root = notReadyProject("ste669-harden-i-");
    writeScript(root, "# Script\n\nShot 1.\n");
    const refusal = await stageRefusal(root, "voice");
    expect(refusal).not.toBeNull();
    const remedy = refusal!.split("\n").find((l) => l.startsWith("Remedy:")) ?? "";
    expect(remedy).toContain("/video init");
    expect(remedy).not.toMatch(/video init stage/i);
  });
});

describe("HARDEN-M — video_init prints every key readiness will require", () => {
  test("HARDEN-M google + elevenlabs music prints GOOGLE_TTS_API_KEY and ELEVENLABS_API_KEY, writes no .dpt/.env", () => {
    const root = makeTmpRoot("ste669-harden-m-");
    expect(git(root, ["init", "-q"])).toBe(0);
    const r = runDoor(INIT_DOOR, [root, "google", "web", "elevenlabs"]);
    expect(r.exitCode).toBe(0);
    expect(r.out).toContain("GOOGLE_TTS_API_KEY");
    expect(r.out).toContain("ELEVENLABS_API_KEY");
    expect(existsSync(dptEnvPath(root))).toBe(false);
  });

  test("HARDEN-M control: google with no music names no ElevenLabs key", () => {
    const root = makeTmpRoot("ste669-harden-m-ctl-");
    expect(git(root, ["init", "-q"])).toBe(0);
    const r = runDoor(INIT_DOOR, [root, "google", "web", "none"]);
    expect(r.exitCode).toBe(0);
    expect(r.out).toContain("GOOGLE_TTS_API_KEY");
    expect(r.out).not.toContain("ELEVENLABS_API_KEY");
  });
});

// ===========================================================================
// FIX-2 / FIX-3 / FIX-5 — round-2 review concerns
// ===========================================================================
//
// Seam pinned here (documented for the implementer): runVideoStage accepts
//   deps?: { fetch?: (url, init) => Promise<Response>; runner?: Runner; which?: Which }
// and the DEFAULT handlers use deps.fetch for every provider call (voice and the
// render pipeline's TTS stages), deps.runner + deps.which for ffmpeg/ffprobe.
// Absent deps, they keep using the live fetch / defaultRunner / Bun.which.
//
// FIX-3 shape pinned here: a shots.json entry may carry
//   footage: { file: string; markers?: { name: string; t: number }[] }
// (`file` relative to videoFootageDir(projectRoot)); the default `record` handler
// builds the recorder's FootageMapping from those entries.

type DepsFetch = (url: string, init: RequestInit) => Promise<Response>;

async function runStageWithDeps(
  root: string,
  stage: string,
  deps: Record<string, unknown>,
  slug = SLUG,
): Promise<string | null> {
  const mod: any = await import(PIPELINE_DOOR);
  try {
    await mod.runVideoStage({ projectRoot: root, slug, stage, deps: { ffmpegRunner: FFMPEG_WITH_DRAWTEXT, ...deps } });
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/** An ElevenLabs with-timestamps answer for `text`: one char per 0.05s. */
function elevenLabsAnswer(text: string): Response {
  const characters = [...text];
  return new Response(
    JSON.stringify({
      audio_base64: Buffer.from(`audio:${text}`).toString("base64"),
      alignment: {
        characters,
        character_start_times_seconds: characters.map((_, i) => i * 0.05),
        character_end_times_seconds: characters.map((_, i) => i * 0.05 + 0.04),
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

const FIX2_SEGMENTS = [
  { index: 1, text: "Meet the pipeline." },
  { index: 2, text: "It caches stages." },
];

describe("FIX-2 — voice then render through the DEFAULT handlers spends one provider call per segment in total", () => {
  test("FIX-2 voice writes the tts:<n> manifest entries; render skips them; re-running voice and render calls nothing", async () => {
    const { root, workDir } = await approvedProject("ste669-fix2-");
    writeFile(join(workDir, "segments.json"), JSON.stringify(FIX2_SEGMENTS));
    writeFile(
      join(workDir, "edl.json"),
      JSON.stringify({
        edl_version: 1,
        clips: [{ src: "clips/intro.mp4", in: 0, out: 3 }],
        voice: [
          { segment: 1, audio: "segments/1.mp3", offset: 0 },
          { segment: 2, audio: "segments/2.mp3", offset: 1.5 },
        ],
      }),
    );

    const providerCalls: string[] = [];
    const depsFetch: DepsFetch = async (url, init) => {
      providerCalls.push(url);
      return elevenLabsAnswer(JSON.parse(String(init.body)).text);
    };
    const runnerCalls: string[][] = [];
    const runner = async (argv: string[], opts: { cwd: string }) => {
      runnerCalls.push([...argv]);
      if (argv.includes("-filters")) return { code: 0, stdout: " T.C drawtext  V->V  Draw text\n", stderr: "" };
      const out = join(opts.cwd, argv[argv.length - 1]!);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, "fake render");
      return { code: 0, stdout: "", stderr: "" };
    };
    const which = (bin: string): string | null => `/usr/local/bin/${bin}`;
    const deps = { fetch: depsFetch, runner, which };
    const renders = (): number => runnerCalls.filter((a) => a[a.length - 1] === "final.mp4").length;

    const realFetch = globalThis.fetch;
    let liveFetches = 0;
    globalThis.fetch = (async () => {
      liveFetches += 1;
      throw new Error("live network forbidden in FIX-2");
    }) as unknown as typeof fetch;
    try {
      // voice: one provider call per segment, and the cache manifest records each TTS stage.
      expect(await runStageWithDeps(root, "voice", deps)).toBeNull();
      expect(providerCalls).toHaveLength(FIX2_SEGMENTS.length);
      const { readStageManifest, stageKey } = await import("../adapters/_shared/src/video/stage_cache");
      const { ttsStageInputs } = await import("../adapters/_shared/src/video/pipeline");
      const voiceSpec = { provider: "elevenlabs", voice: "narrator", model: undefined };
      const afterVoice = readStageManifest(workDir);
      for (const seg of FIX2_SEGMENTS) {
        const name = `tts:${seg.index}`;
        expect(afterVoice.stages[name]?.key, name).toBe(stageKey(name, 1, ttsStageInputs(seg, voiceSpec)));
      }

      // render: reuses the voiced segments — no further provider call — and renders once.
      expect(await runStageWithDeps(root, "render", deps)).toBeNull();
      expect(providerCalls).toHaveLength(FIX2_SEGMENTS.length);
      expect(renders()).toBe(1);
      expect(existsSync(join(workDir, "final.mp4"))).toBe(true);

      // re-running voice reuses everything: no provider call.
      expect(await runStageWithDeps(root, "voice", deps)).toBeNull();
      expect(providerCalls).toHaveLength(FIX2_SEGMENTS.length);
      // re-running render reuses everything: no provider call, no ffmpeg render.
      expect(await runStageWithDeps(root, "render", deps)).toBeNull();
      expect(providerCalls).toHaveLength(FIX2_SEGMENTS.length);
      expect(renders()).toBe(1);
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(liveFetches).toBe(0);
  });
});

describe("FIX-3 — a shots.json footage mapping reaches the footage recorder through the default `record` handler", () => {
  const FOOTAGE_CONFIG = READY_CONFIG.replace("  kind: web", "  kind: footage");

  test("FIX-3 a shot carrying `footage: { file, markers }` records instead of refusing \"no footage mapping\"", async () => {
    const { videoFootageDir } = await import("../adapters/_shared/src/dpt_paths");
    const { root, workDir } = await approvedProject("ste669-fix3-", FOOTAGE_CONFIG);
    const footageDir = videoFootageDir(root);
    mkdirSync(footageDir, { recursive: true });
    ffmpegFixture(footageDir, ["-f", "lavfi", "-i", "testsrc=duration=1:size=160x120:rate=10", "-pix_fmt", "yuv420p", "hero.mp4"]);
    const markers = [{ name: "open", t: 0.2 }];
    writeFile(
      join(workDir, "shots.json"),
      JSON.stringify([
        { id: "hero", scenario: "open the dashboard", durationHint: 1, footage: { file: "hero.mp4", markers } },
      ]),
    );
    const refusal = await stageRefusal(root, "record");
    expect(refusal).toBeNull();
    expect(existsSync(join(workDir, "clips", "hero.mp4"))).toBe(true);
    expect(JSON.parse(read(join(workDir, "markers", "hero.json")))).toEqual(markers);
  }, 60_000);

  test("FIX-3 control: the same shot without a footage field still refuses naming the missing mapping", async () => {
    const { root, workDir } = await approvedProject("ste669-fix3-ctl-", FOOTAGE_CONFIG);
    writeFile(
      join(workDir, "shots.json"),
      JSON.stringify([{ id: "hero", scenario: "open the dashboard", durationHint: 1 }]),
    );
    const refusal = await stageRefusal(root, "record");
    expect(refusal).not.toBeNull();
    expect(refusal!).toMatch(/no footage mapping/);
  });
});

describe("FIX-5 — docs/video-reference.md documents the work-dir inputs the stages read", () => {
  const doc = (): string => read(VIDEO_REFERENCE);
  /** The section under the first heading whose text matches `re`, up to the next heading of the same or higher level. */
  function sectionNaming(body: string, re: RegExp): string {
    const lines = body.split("\n");
    const start = lines.findIndex((l) => /^#{2,4}\s/.test(l) && re.test(l));
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

  test("FIX-5 the `music` row names segments.json and alignment/<n>.json as its inputs, not edl.json", () => {
    const row = doc().split("\n").find((l) => /^\s*\|\s*`music`\s*\|/.test(l));
    expect(row, "no `music` row in the stage-inputs table").toBeDefined();
    expect(row!).toContain("segments.json");
    expect(row!).toContain("alignment/<n>.json");
    expect(row!).not.toContain("edl.json");
  });

  test("FIX-5 a section headed by segments.json documents its shape `[{ index, text }]`", () => {
    const section = sectionNaming(doc(), /segments\.json/);
    expect(section, "no heading names segments.json").not.toBe("");
    expect(section).toMatch(/\[\s*\{\s*index\s*,\s*text\s*\}\s*\]/);
  });

  test("FIX-5 a section headed by shots.json documents every shot field, including footage", () => {
    const section = sectionNaming(doc(), /shots\.json/);
    expect(section, "no heading names shots.json").not.toBe("");
    for (const field of ["id", "scenario", "durationHint", "recorder", "driver", "footage"]) {
      expect(section, field).toContain(`\`${field}\``);
    }
    expect(section).toMatch(/footage[\s\S]{0,200}\bfile\b/);
  });

});
