// STE-663 — video style parser (the video `style.yaml`).
//
// AC-STE-663.5: `parseVideoStyle` accepts `pacing.words_per_minute`,
// `captions.enabled` / `captions.position`, `music.level_db`, `banned_effects`,
// `humor` ∈ {none, light, playful} and `layout.viewport`. Absent keys fall back
// to `VIDEO_STYLE_DEFAULTS`; an absent file yields the defaults outright. An
// unknown key or a wrongly-typed value refuses in the NFR-10 canonical shape
// naming the offending key path.

import { existsSync, readFileSync } from "node:fs";
import { videoStylePath } from "../dpt_paths";
import {
  enumRefusal,
  isObj,
  isPresent as has,
  keyPath,
  type Obj,
  parseYamlOrRefuse,
  rejectUnknownKeys as rejectUnknown,
  VideoShapeError,
} from "./shape";

export type VideoHumor = "none" | "light" | "playful";

export interface VideoStyle {
  pacing: { words_per_minute: number };
  captions: { enabled: boolean; position: string };
  music: { level_db: number; prompt: string };
  narration: { tone: string };
  banned_effects: string[];
  humor: VideoHumor;
  layout: { viewport: { width: number; height: number } };
}

const HUMOR_VALUES: readonly VideoHumor[] = ["none", "light", "playful"];

/** The documented house-style defaults. */
export const VIDEO_STYLE_DEFAULTS: VideoStyle = {
  pacing: { words_per_minute: 150 },
  captions: { enabled: true, position: "bottom" },
  music: {
    level_db: -20,
    prompt:
      "Upbeat, modern instrumental track for a tech product explainer: punchy drums, bright synths, positive energy, steady driving tempo, no vocals.",
  },
  narration: { tone: "" },
  banned_effects: ["slow_zoom", "ken_burns"],
  humor: "light",
  layout: { viewport: { width: 1280, height: 720 } },
};

/** NFR-10 refusal for a malformed video style. Never echoes key values. */
export class VideoStyleShapeError extends VideoShapeError {
  constructor(keyPath: string, reason: string, remedy: string) {
    super("style", videoStylePath("."), keyPath, reason, remedy);
    this.name = "VideoStyleShapeError";
  }
}

const refuse = (path: string, reason: string, remedy: string): Error => new VideoStyleShapeError(path, reason, remedy);

function rejectUnknownKeys(block: Obj, prefix: string, allowed: readonly string[]): void {
  rejectUnknown(block, prefix, allowed, refuse);
}

function optionalBlock(parent: Obj, prefix: string, key: string): Obj | undefined {
  if (!has(parent, key)) return undefined;
  const v = parent[key];
  const path = keyPath(prefix, key);
  if (!isObj(v)) {
    throw new VideoStyleShapeError(path, "must be a mapping", `write \`${path}:\` as a mapping block.`);
  }
  return v;
}

function numberAt(block: Obj, path: string, key: string, fallback: number, positive = false): number {
  if (!has(block, key)) return fallback;
  const v = block[key];
  if (typeof v !== "number" || !Number.isFinite(v) || (positive && v <= 0)) {
    throw new VideoStyleShapeError(
      path,
      positive ? "must be a positive number" : "must be a number",
      `set \`${path}\` to a ${positive ? "positive " : ""}number.`,
    );
  }
  return v;
}

/** Longest accepted `music.prompt` / `narration.tone` (AC-STE-671.1). */
const STYLE_TEXT_MAX = 500;

function cappedStringAt(block: Obj, path: string, key: string, fallback: string): string {
  if (!has(block, key)) return fallback;
  const v = block[key];
  if (typeof v !== "string") {
    throw new VideoStyleShapeError(path, "must be a string", `set \`${path}\` to a string of at most ${STYLE_TEXT_MAX} characters.`);
  }
  // Count code points, not UTF-16 units, so emoji and CJK meet the stated cap.
  if ([...v].length > STYLE_TEXT_MAX) {
    throw new VideoStyleShapeError(
      path,
      `must be at most ${STYLE_TEXT_MAX} characters`,
      `shorten \`${path}\` to at most ${STYLE_TEXT_MAX} characters.`,
    );
  }
  return v;
}

/** Parse and validate the raw text of the video `style.yaml`; absent keys take the defaults. */
export function parseVideoStyle(raw: string): VideoStyle {
  const parsed = parseYamlOrRefuse(raw, "style", refuse);
  if (parsed === null || parsed === undefined) return structuredClone(VIDEO_STYLE_DEFAULTS);
  if (!isObj(parsed)) {
    throw new VideoStyleShapeError("(root)", "is not a mapping", "write the style as a YAML mapping.");
  }
  rejectUnknownKeys(parsed, "", ["pacing", "captions", "music", "narration", "banned_effects", "humor", "layout"]);
  const d = VIDEO_STYLE_DEFAULTS;

  const pacing = optionalBlock(parsed, "", "pacing") ?? {};
  rejectUnknownKeys(pacing, "pacing", ["words_per_minute"]);
  const words_per_minute = numberAt(pacing, "pacing.words_per_minute", "words_per_minute", d.pacing.words_per_minute, true);

  const captions = optionalBlock(parsed, "", "captions") ?? {};
  rejectUnknownKeys(captions, "captions", ["enabled", "position"]);
  let enabled = d.captions.enabled;
  if (has(captions, "enabled")) {
    if (typeof captions.enabled !== "boolean") {
      throw new VideoStyleShapeError("captions.enabled", "must be a boolean", "set `captions.enabled` to true or false.");
    }
    enabled = captions.enabled;
  }
  let position = d.captions.position;
  if (has(captions, "position")) {
    if (typeof captions.position !== "string" || captions.position.trim() === "") {
      throw new VideoStyleShapeError("captions.position", "must be a non-empty string", "set `captions.position`, e.g. bottom.");
    }
    position = captions.position;
  }

  const music = optionalBlock(parsed, "", "music") ?? {};
  rejectUnknownKeys(music, "music", ["level_db", "prompt"]);
  const level_db = numberAt(music, "music.level_db", "level_db", d.music.level_db);
  const prompt = cappedStringAt(music, "music.prompt", "prompt", d.music.prompt);

  const narration = optionalBlock(parsed, "", "narration") ?? {};
  rejectUnknownKeys(narration, "narration", ["tone"]);
  const tone = cappedStringAt(narration, "narration.tone", "tone", d.narration.tone);

  let banned_effects = [...d.banned_effects];
  if (has(parsed, "banned_effects")) {
    const v = parsed.banned_effects;
    if (!Array.isArray(v) || !v.every((e) => typeof e === "string" && e.length > 0)) {
      throw new VideoStyleShapeError(
        "banned_effects",
        "must be a list of effect names",
        "set `banned_effects` to a list, e.g. [slow_zoom, ken_burns].",
      );
    }
    banned_effects = [...(v as string[])];
  }

  let humor = d.humor;
  if (has(parsed, "humor")) {
    const v = parsed.humor;
    if (typeof v !== "string" || !(HUMOR_VALUES as readonly string[]).includes(v)) {
      throw enumRefusal("humor", HUMOR_VALUES, refuse);
    }
    humor = v as VideoHumor;
  }

  const layout = optionalBlock(parsed, "", "layout") ?? {};
  rejectUnknownKeys(layout, "layout", ["viewport"]);
  const viewport = optionalBlock(layout, "layout", "viewport") ?? {};
  rejectUnknownKeys(viewport, "layout.viewport", ["width", "height"]);
  const width = numberAt(viewport, "layout.viewport.width", "width", d.layout.viewport.width, true);
  const height = numberAt(viewport, "layout.viewport.height", "height", d.layout.viewport.height, true);

  return {
    pacing: { words_per_minute },
    captions: { enabled, position },
    music: { level_db, prompt },
    narration: { tone },
    banned_effects,
    humor,
    layout: { viewport: { width, height } },
  };
}

/** Read the video `style.yaml` under `projectRoot`; an absent file yields the defaults. */
export function readVideoStyle(projectRoot: string): VideoStyle {
  const path = videoStylePath(projectRoot);
  if (!existsSync(path)) return structuredClone(VIDEO_STYLE_DEFAULTS);
  return parseVideoStyle(readFileSync(path, "utf8"));
}
