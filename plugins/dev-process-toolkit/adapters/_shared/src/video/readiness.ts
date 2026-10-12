// STE-663 — video readiness.
//
// AC-STE-663.7: `videoReadiness(projectRoot)` reports whether a project can
// render a video. Not ready when the config is absent or invalid, when the
// provider key is missing from `.dpt/.env`, when `music.source: elevenlabs`
// lacks `ELEVENLABS_API_KEY`, or when git does not report `.dpt/.env` ignored.
// Every reason is a single line naming its remedy, and no reason ever carries
// a key value (AC-STE-663.8): config refusals name key paths only, and key
// checks name variable names only.

import { existsSync, readFileSync } from "node:fs";
import { relative } from "node:path";
import { dptEnvPath, videoConfigPath } from "../dpt_paths";
import { parseVideoConfig, type VideoConfig } from "./config";
import { readVideoKeys } from "./keys";

export interface VideoReadiness {
  ready: boolean;
  reasons: string[];
}

const CONFIG_DISPLAY = videoConfigPath(".").replace(/^\.\//, "");
const ENV_DISPLAY = dptEnvPath(".").replace(/^\.\//, "");

export const PROVIDER_KEY: Record<VideoConfig["tts"]["provider"], string> = {
  elevenlabs: "ELEVENLABS_API_KEY",
  google: "GOOGLE_TTS_API_KEY",
};

/** Every key variable a config needs in `.dpt/.env`, with why — the one key mapping. */
export function requiredVideoKeys(config: Pick<VideoConfig, "tts" | "music">): { name: string; why: string }[] {
  const providerKey = PROVIDER_KEY[config.tts.provider];
  const out = [{ name: providerKey, why: `tts.provider is ${config.tts.provider}` }];
  if (config.music.source === "elevenlabs" && providerKey !== PROVIDER_KEY.elevenlabs) {
    out.push({ name: PROVIDER_KEY.elevenlabs, why: "music.source is elevenlabs" });
  }
  return out;
}

function missingKeyReason(name: string, why: string): string {
  return `${name} is missing from ${ENV_DISPLAY} (${why}) — remedy: add \`${name}=<key>\` to ${ENV_DISPLAY}.`;
}

function readConfig(projectRoot: string): { config: VideoConfig | null; reason: string | null } {
  const path = videoConfigPath(projectRoot);
  if (!existsSync(path)) {
    return {
      config: null,
      reason: `${CONFIG_DISPLAY} is absent — remedy: create ${CONFIG_DISPLAY} with tts, recorder and music blocks.`,
    };
  }
  try {
    return { config: parseVideoConfig(readFileSync(path, "utf8")), reason: null };
  } catch (err) {
    const lines = (err instanceof Error ? err.message : String(err)).split("\n");
    const verdict = (lines[0] ?? "").replace(/^Refusing:\s*/, "");
    const remedy = (lines.find((l) => l.startsWith("Remedy:")) ?? "Remedy: fix the config.").replace(/^Remedy:\s*/, "");
    return { config: null, reason: `${CONFIG_DISPLAY} is invalid: ${verdict} — remedy: ${remedy}` };
  }
}

/** `git check-ignore` verdict for `.dpt/.env`: ignored, not ignored, or no repository (exit 128). */
function envIgnored(projectRoot: string): "ignored" | "not-ignored" | "not-a-repo" {
  const rel = relative(projectRoot, dptEnvPath(projectRoot)).split("\\").join("/");
  const proc = Bun.spawnSync(["git", "check-ignore", "-q", "--", rel], {
    cwd: projectRoot,
    stdout: "ignore",
    stderr: "ignore",
  });
  if (proc.exitCode === 0) return "ignored";
  return proc.exitCode === 128 ? "not-a-repo" : "not-ignored";
}

export function videoReadiness(projectRoot: string): VideoReadiness {
  const reasons: string[] = [];
  const { config, reason } = readConfig(projectRoot);
  if (reason !== null) reasons.push(reason);

  if (config !== null) {
    const keys = readVideoKeys(projectRoot);
    const has = (name: string): boolean => typeof keys[name] === "string" && keys[name]!.trim() !== "";
    for (const { name, why } of requiredVideoKeys(config)) {
      if (!has(name)) reasons.push(missingKeyReason(name, why));
    }
  }

  const ignored = envIgnored(projectRoot);
  if (ignored === "not-a-repo") {
    reasons.push(
      `${ENV_DISPLAY} cannot be checked against git — the project is not a git repository — remedy: run \`git init\` in the project root so git can ignore ${ENV_DISPLAY}.`,
    );
  } else if (ignored === "not-ignored") {
    reasons.push(
      `${ENV_DISPLAY} is not ignored by git — remedy: run /dev-process-toolkit:upgrade to refresh .dpt/.gitignore (or add \`.env\` to .dpt/.gitignore).`,
    );
  }

  return { ready: reasons.length === 0, reasons };
}
