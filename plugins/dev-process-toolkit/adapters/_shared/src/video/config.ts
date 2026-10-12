// STE-663 — video config parser (`.dpt/video/config.yaml`).
//
// AC-STE-663.4: `parseVideoConfig` accepts a closed schema — `tts`, `recorder`
// and `music` blocks with closed enums and kind-specific recorder fields — and
// refuses any other value or unknown key in the NFR-10 canonical shape
// (Refusing / Remedy / Context) naming the offending key path.

import { videoConfigPath } from "../dpt_paths";
import {
  enumRefusal,
  isObj,
  isPresent,
  type Obj,
  parseYamlOrRefuse,
  rejectUnknownKeys as rejectUnknown,
  VideoShapeError,
} from "./shape";

/** Project-relative display path of the config file, composed by dpt_paths. */
const CONFIG_DISPLAY_PATH = videoConfigPath(".");

export type TtsProvider = "elevenlabs" | "google";
export type RecorderKind = "web" | "ios-sim" | "android-emu" | "footage" | "command";
export type MusicSource = "elevenlabs" | "file" | "none";

export interface VideoTtsConfig {
  provider: TtsProvider;
  voice: string;
  model?: string;
}

export type VideoRecorderConfig =
  | { kind: "web" }
  | { kind: "ios-sim"; device: string }
  | { kind: "android-emu"; device?: string }
  | { kind: "footage" }
  | { kind: "command"; command: string[] };

export type VideoMusicConfig =
  | { source: "elevenlabs" }
  | { source: "none" }
  | { source: "file"; file: string };

export interface VideoConfig {
  tts: VideoTtsConfig;
  recorder: VideoRecorderConfig;
  music: VideoMusicConfig;
}

const TTS_PROVIDERS: readonly TtsProvider[] = ["elevenlabs", "google"];
const RECORDER_KINDS: readonly RecorderKind[] = ["web", "ios-sim", "android-emu", "footage", "command"];
const MUSIC_SOURCES: readonly MusicSource[] = ["elevenlabs", "file", "none"];

/** Keys each recorder kind permits besides `kind`. */
const RECORDER_KIND_KEYS: Record<RecorderKind, readonly string[]> = {
  web: [],
  "ios-sim": ["device"],
  "android-emu": ["device"],
  footage: [],
  command: ["command"],
};

/** NFR-10 refusal for a malformed video config. Never echoes key values. */
export class VideoConfigShapeError extends VideoShapeError {
  constructor(keyPath: string, reason: string, remedy: string) {
    super("config", CONFIG_DISPLAY_PATH, keyPath, reason, remedy);
    this.name = "VideoConfigShapeError";
  }
}

const refuse = (path: string, reason: string, remedy: string): Error => new VideoConfigShapeError(path, reason, remedy);

function rejectUnknownKeys(block: Obj, prefix: string, allowed: readonly string[]): void {
  rejectUnknown(block, prefix, allowed, refuse);
}

function requireBlock(parent: Obj, key: string): Obj {
  const v = parent[key];
  if (!isObj(v)) {
    throw new VideoConfigShapeError(key, "is missing or not a mapping", `add a \`${key}:\` mapping block.`);
  }
  return v;
}

function requireString(block: Obj, prefix: string, key: string): string {
  const v = block[key];
  if (typeof v !== "string" || v.trim() === "") {
    const path = `${prefix}.${key}`;
    throw new VideoConfigShapeError(path, "is required and must be a non-empty string", `set \`${path}\`.`);
  }
  return v;
}

function optionalString(block: Obj, prefix: string, key: string): string | undefined {
  if (!isPresent(block, key)) return undefined;
  return requireString(block, prefix, key);
}

function requireEnum<T extends string>(block: Obj, prefix: string, key: string, values: readonly T[]): T {
  const v = block[key];
  const path = `${prefix}.${key}`;
  if (typeof v !== "string" || !(values as readonly string[]).includes(v)) {
    throw enumRefusal(path, values, refuse);
  }
  return v as T;
}

function parseTts(block: Obj): VideoTtsConfig {
  rejectUnknownKeys(block, "tts", ["provider", "voice", "model"]);
  const provider = requireEnum(block, "tts", "provider", TTS_PROVIDERS);
  const voice = requireString(block, "tts", "voice");
  const model = optionalString(block, "tts", "model");
  return model === undefined ? { provider, voice } : { provider, voice, model };
}

function parseRecorder(block: Obj): VideoRecorderConfig {
  const kind = requireEnum(block, "recorder", "kind", RECORDER_KINDS);
  rejectUnknownKeys(block, "recorder", ["kind", ...RECORDER_KIND_KEYS[kind]]);
  switch (kind) {
    case "ios-sim":
      return { kind, device: optionalString(block, "recorder", "device") ?? "booted" };
    case "android-emu": {
      const device = optionalString(block, "recorder", "device");
      return device === undefined ? { kind } : { kind, device };
    }
    case "command": {
      const cmd = block.command;
      if (
        !Array.isArray(cmd) ||
        cmd.length === 0 ||
        !cmd.every((c) => typeof c === "string" && c.length > 0)
      ) {
        throw new VideoConfigShapeError(
          "recorder.command",
          "is required for kind `command` and must be a non-empty list of strings",
          "set `recorder.command` to an argv list, e.g. [bash, scripts/record.sh].",
        );
      }
      return { kind, command: cmd as string[] };
    }
    default:
      return { kind };
  }
}

function parseMusic(block: Obj): VideoMusicConfig {
  const source = requireEnum(block, "music", "source", MUSIC_SOURCES);
  rejectUnknownKeys(block, "music", source === "file" ? ["source", "file"] : ["source"]);
  if (source === "file") return { source, file: requireString(block, "music", "file") };
  return { source };
}

/** Parse and validate the raw text of `.dpt/video/config.yaml`. */
export function parseVideoConfig(raw: string): VideoConfig {
  const parsed = parseYamlOrRefuse(raw, "config", refuse);
  if (!isObj(parsed)) {
    throw new VideoConfigShapeError("(root)", "is not a mapping", "write the config as a YAML mapping with tts, recorder and music blocks.");
  }
  rejectUnknownKeys(parsed, "", ["tts", "recorder", "music"]);
  return {
    tts: parseTts(requireBlock(parsed, "tts")),
    recorder: parseRecorder(requireBlock(parsed, "recorder")),
    music: parseMusic(requireBlock(parsed, "music")),
  };
}
