// STE-669 — front door for initialising a project's video workspace (AC-STE-669.2).
//
//   bun run video_init.ts <projectRoot> <provider> <recorder> <music>
//
// Writes `config.yaml` (the three chosen values), `style.yaml` (the documented
// defaults, spelled out) and `scenarios/`, runs `writeDptGitignore`, and prints
// every key variable NAME readiness will require (provider + music source). It never
// asks for, reads or writes a key. Refuses (NFR-10 shape, non-zero exit) to
// overwrite an existing `config.yaml`, and refuses a config that would not
// parse — in both cases before writing anything.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { dptEnvPath, videoConfigPath, videoScenariosDir, videoStylePath } from "./dpt_paths";
import { writeDptGitignore } from "./setup/dpt_gitignore";
import { parseVideoConfig, type TtsProvider } from "./video/config";
import { requiredVideoKeys } from "./video/readiness";
import { nfr10Refusal } from "./video/shape";
import { VIDEO_STYLE_DEFAULTS } from "./video/style";

/** A starting voice per provider; the operator tunes `tts.voice` afterwards. */
const DEFAULT_VOICE: Record<TtsProvider, string> = {
  elevenlabs: "21m00Tcm4TlvDq8ikWAM",
  google: "en-US-Neural2-D",
};

/** Kind-specific recorder lines a fresh config needs to parse. */
const RECORDER_EXTRA: Record<string, string[]> = {
  "ios-sim": ["  device: booted"],
  command: ["  command: [bash, scripts/record.sh]"],
};

export function renderVideoConfig(provider: string, recorder: string, music: string): string {
  const voice = DEFAULT_VOICE[provider as TtsProvider] ?? "narrator";
  return [
    "tts:",
    `  provider: ${provider}`,
    `  voice: ${voice}`,
    "recorder:",
    `  kind: ${recorder}`,
    ...(RECORDER_EXTRA[recorder] ?? []),
    "music:",
    `  source: ${music}`,
    ...(music === "file" ? ["  file: music.mp3"] : []),
    "",
  ].join("\n");
}

export function renderVideoStyle(): string {
  const d = VIDEO_STYLE_DEFAULTS;
  return [
    "pacing:",
    `  words_per_minute: ${d.pacing.words_per_minute}`,
    "captions:",
    `  enabled: ${d.captions.enabled}`,
    `  position: ${d.captions.position}`,
    "music:",
    `  level_db: ${d.music.level_db}`,
    `  prompt: ${JSON.stringify(d.music.prompt)}`,
    "narration:",
    `  tone: ${JSON.stringify(d.narration.tone)}`,
    `banned_effects: [${d.banned_effects.join(", ")}]`,
    `humor: ${d.humor}`,
    "layout:",
    "  viewport:",
    `    width: ${d.layout.viewport.width}`,
    `    height: ${d.layout.viewport.height}`,
    "loudness:",
    `  target_lufs: ${d.loudness.target_lufs}`,
    "",
  ].join("\n");
}

/** A workspace path as the operator sees it, relative to the project root. */
function displayPath(compose: (root: string) => string): string {
  return compose(".").replace(/^\.\//, "");
}

export interface VideoInitResult {
  /** Every key variable readiness will require for this config, in order. */
  keyVars: string[];
}

/** Initialise the video workspace; throws an NFR-10 shaped Error on refusal, having written nothing. */
export function videoInit(projectRoot: string, provider: string, recorder: string, music: string): VideoInitResult {
  const configPath = videoConfigPath(projectRoot);
  const configDisplay = displayPath(videoConfigPath);
  if (existsSync(configPath)) {
    throw nfr10Refusal(
      `${configDisplay} already exists; video_init never overwrites it.`,
      `edit ${configDisplay} by hand, or remove it and re-run video_init.`,
      `mode=video-init, file=${configDisplay}`,
    );
  }
  const configBody = renderVideoConfig(provider, recorder, music);
  const config = parseVideoConfig(configBody); // refuses an unknown provider / recorder / music

  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, configBody);
  const stylePath = videoStylePath(projectRoot);
  if (!existsSync(stylePath)) writeFileSync(stylePath, renderVideoStyle());
  mkdirSync(videoScenariosDir(projectRoot), { recursive: true });
  writeDptGitignore(projectRoot);

  return { keyVars: requiredVideoKeys(config).map((k) => k.name) };
}

if (import.meta.main) {
  const [rootArg, provider = "", recorder = "", music = ""] = process.argv.slice(2);
  const projectRoot = resolve(rootArg ?? process.cwd());
  try {
    const { keyVars } = videoInit(projectRoot, provider, recorder, music);
    const envDisplay = displayPath(dptEnvPath);
    const lines = keyVars.map((k) => `${k}=<key>`).join(", ");
    console.log(`Video workspace initialised. Add ${lines} to ${envDisplay} (git-ignored); video_init never writes it.`);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}
