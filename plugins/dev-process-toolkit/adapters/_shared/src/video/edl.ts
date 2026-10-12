// STE-665 — the edit decision list (EDL): a closed JSON document the renderer
// turns into one ffmpeg invocation.
//
// `parseEdl` refuses in the NFR-10 canonical shape (Refusing / Remedy / Context)
// naming the offending field path (e.g. `clips.1.speed`) and never echoes values.

import { isObj, keyPath, type Obj, rejectUnknownKeys, type ShapeErrorFactory } from "./shape";

export type EdlAnchorRef = { segment: number; word: number }; // both 1-based
export interface EdlClip {
  src: string;
  in: number;
  out: number;
  at?: number | EdlAnchorRef;
  effects?: string[];
}
export interface EdlVoice {
  segment: number;
  audio: string;
  offset: number;
}
export interface EdlCaption {
  text: string;
  start: number;
  end: number;
}
export interface EdlMusic {
  src: string;
  level_db: number;
}
export interface EdlAnchor {
  name: string;
  at: number | EdlAnchorRef;
}
export interface Edl {
  edl_version: 1;
  clips: EdlClip[];
  voice: EdlVoice[];
  captions: EdlCaption[];
  music: EdlMusic | null;
  anchors: EdlAnchor[];
}

const refuse: ShapeErrorFactory = (path, reason, remedy) =>
  new Error(
    [
      `Refusing: video EDL field \`${path}\` ${reason}`,
      `Remedy: ${remedy}`,
      `Context: mode=video-edl, field=${path}`,
    ].join("\n"),
  );

function obj(v: unknown, path: string): Obj {
  if (!isObj(v)) throw refuse(path, "must be an object", `make \`${path}\` a JSON object.`);
  return v;
}

function num(o: Obj, key: string, prefix: string): number {
  const path = keyPath(prefix, key);
  const v = o[key];
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw refuse(path, "must be a finite number", `set \`${path}\` to a number.`);
  }
  return v;
}

function str(o: Obj, key: string, prefix: string): string {
  const path = keyPath(prefix, key);
  const v = o[key];
  if (typeof v !== "string" || v === "") {
    throw refuse(path, "must be a non-empty string", `set \`${path}\` to a non-empty string.`);
  }
  return v;
}

function list(o: Obj, key: string, required: boolean): unknown[] {
  if (!(key in o) && !required) return [];
  const v = o[key];
  if (!Array.isArray(v)) throw refuse(key, "must be an array", `make \`${key}\` a JSON array.`);
  return v;
}

function parseAt(v: unknown, path: string): number | EdlAnchorRef {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (isObj(v)) {
    rejectUnknownKeys(v, path, ["segment", "word"], refuse);
    for (const k of ["segment", "word"]) {
      const n = v[k];
      if (typeof n !== "number" || !Number.isInteger(n) || n < 1) {
        const p = keyPath(path, k);
        throw refuse(p, "must be a 1-based integer", `set \`${p}\` to an integer >= 1.`);
      }
    }
    return { segment: v.segment as number, word: v.word as number };
  }
  throw refuse(path, "must be seconds or { segment, word }", `set \`${path}\` to a number or { segment, word }.`);
}

function parseClip(v: unknown, path: string): EdlClip {
  const c = obj(v, path);
  rejectUnknownKeys(c, path, ["src", "in", "out", "at", "effects"], refuse);
  const clip: EdlClip = { src: str(c, "src", path), in: num(c, "in", path), out: num(c, "out", path) };
  if (clip.out < clip.in) {
    const p = keyPath(path, "out");
    throw refuse(p, "must not precede the clip's in point", `set \`${p}\` at or after \`${keyPath(path, "in")}\`.`);
  }
  if ("at" in c) clip.at = parseAt(c.at, keyPath(path, "at"));
  if ("effects" in c) {
    const p = keyPath(path, "effects");
    if (!Array.isArray(c.effects) || !c.effects.every((e) => typeof e === "string")) {
      throw refuse(p, "must be an array of strings", `make \`${p}\` an array of effect names.`);
    }
    clip.effects = [...c.effects];
  }
  return clip;
}

export function parseEdl(raw: string): Edl {
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch {
    throw refuse("(root)", "is not valid JSON", "fix the JSON syntax of the EDL.");
  }
  const root = obj(doc, "(root)");
  rejectUnknownKeys(root, "", ["edl_version", "clips", "voice", "captions", "music", "anchors"], refuse);
  if (root.edl_version !== 1) {
    throw refuse("edl_version", "must be 1", "set `edl_version` to the number 1.");
  }

  const clips = list(root, "clips", true).map((c, i) => parseClip(c, `clips.${i}`));

  const voice = list(root, "voice", false).map((v, i) => {
    const p = `voice.${i}`;
    const o = obj(v, p);
    rejectUnknownKeys(o, p, ["segment", "audio", "offset"], refuse);
    return { segment: num(o, "segment", p), audio: str(o, "audio", p), offset: num(o, "offset", p) };
  });

  const captions = list(root, "captions", false).map((v, i) => {
    const p = `captions.${i}`;
    const o = obj(v, p);
    rejectUnknownKeys(o, p, ["text", "start", "end"], refuse);
    return { text: str(o, "text", p), start: num(o, "start", p), end: num(o, "end", p) };
  });

  let music: EdlMusic | null = null;
  if (root.music !== undefined && root.music !== null) {
    const o = obj(root.music, "music");
    rejectUnknownKeys(o, "music", ["src", "level_db"], refuse);
    music = { src: str(o, "src", "music"), level_db: num(o, "level_db", "music") };
  }

  const anchors = list(root, "anchors", false).map((v, i) => {
    const p = `anchors.${i}`;
    const o = obj(v, p);
    rejectUnknownKeys(o, p, ["name", "at"], refuse);
    return { name: str(o, "name", p), at: parseAt(o.at, keyPath(p, "at")) };
  });

  return { edl_version: 1, clips, voice, captions, music, anchors };
}

/** Total programme length in seconds: the sum of every clip's (out - in). */
export function edlDuration(edl: Edl): number {
  return edl.clips.reduce((sum, c) => sum + (c.out - c.in), 0);
}
