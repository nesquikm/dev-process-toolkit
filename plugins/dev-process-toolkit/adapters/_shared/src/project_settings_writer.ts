// STE-710 — the settings-file writer. Lives beside the loader so the loader
// module stays pure (AC-STE-706.9); re-exported from `project_settings.ts`.
//
// `writeProjectSettings(projectRoot, update, opts?)` applies a deep partial
// `update` to `specs/settings.yaml`: maps merge key by key, scalars and lists
// replace, an own key whose value is `undefined` removes that key. Changed keys
// are edited in place; only a create (`{ create: true }`) serializes a whole
// file, in the fixed key order and in block style.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  isForeignSettingsFile,
  loadProjectSettings,
  PROJECT_SETTINGS_HEADING,
  SETTINGS_FILE,
  SettingsShapeError,
  settingsKeyOrder,
  validateSettingsShape,
} from "./project_settings";
import { renderTrackingStub, sectionEnd, trackingStubSlots } from "./project_settings_legacy";

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function deepEqual(a: unknown, b: unknown): boolean {
  return Bun.deepEquals(a, b, true);
}

/** `base` with `update` merged in: maps merge, scalars and lists replace, an own `undefined` removes. */
function mergeUpdate(base: Obj, update: Obj): Obj {
  const out: Obj = { ...base };
  for (const [k, v] of Object.entries(update)) {
    if (v === undefined) delete out[k];
    else if (isObj(v) && isObj(out[k])) out[k] = mergeUpdate(out[k] as Obj, v);
    else out[k] = v;
  }
  return out;
}

function childPath(path: string, key: string): string {
  return path === "" ? key : `${path}.${key}`;
}

/** Keys of `m` in the fixed key order for `path`; keys outside the order keep their own order, after. */
function orderedKeys(m: Obj, path: string): string[] {
  const order = settingsKeyOrder(path);
  const keys = Object.keys(m);
  const known = order.filter((k) => keys.includes(k));
  return [...known, ...keys.filter((k) => !order.includes(k))];
}

function scalar(v: unknown): string {
  if (typeof v === "string") {
    try {
      if (v !== "" && (Bun.YAML.parse(`k: ${v}`) as Obj)?.k === v) return v;
    } catch {
      // not a plain scalar
    }
    return JSON.stringify(v);
  }
  return v === null || v === undefined ? "null" : String(v);
}

/** Block-style lines of one `key: value` entry at `indent`. */
function serializeEntry(key: string, value: unknown, indent: number, path: string): string[] {
  const pad = " ".repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${pad}${key}: []`];
    return [`${pad}${key}:`, ...serializeItems(value, indent + 2, `${path}[]`)];
  }
  if (isObj(value)) {
    if (Object.keys(value).length === 0) return [`${pad}${key}: {}`];
    return [`${pad}${key}:`, ...serializeMap(value, indent + 2, path)];
  }
  return [`${pad}${key}: ${scalar(value)}`];
}

function serializeMap(m: Obj, indent: number, path: string): string[] {
  return orderedKeys(m, path).flatMap((k) => serializeEntry(k, m[k], indent, childPath(path, k)));
}

function serializeItems(items: unknown[], indent: number, path: string): string[] {
  const pad = " ".repeat(indent);
  return items.flatMap((item) => {
    if (isObj(item) && Object.keys(item).length > 0) {
      const lines = serializeMap(item, indent + 2, path);
      lines[0] = `${pad}- ${lines[0]!.slice(indent + 2)}`;
      return lines;
    }
    if (Array.isArray(item) && item.length > 0) {
      const lines = serializeItems(item, indent + 2, path);
      lines[0] = `${pad}- ${lines[0]!.slice(indent + 2)}`;
      return lines;
    }
    return [`${pad}- ${isObj(item) ? "{}" : Array.isArray(item) ? "[]" : scalar(item)}`];
  });
}

// ---------------------------------------------------------------------------
// In-place edit
// ---------------------------------------------------------------------------

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

function isContent(line: string): boolean {
  const t = line.trim();
  return t !== "" && !t.startsWith("#");
}

interface Entry {
  key: string;
  start: number;
  end: number;
}

/** The keys of a block map whose keys sit at `indent`, each with its line range. */
function locate(lines: string[], indent: number): Entry[] {
  const out: Entry[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (!isContent(l) || indentOf(l) !== indent || l.trimStart().startsWith("-")) continue;
    const m = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:/.exec(l.trimStart());
    if (!m) continue;
    let last = i;
    for (let j = i + 1; j < lines.length; j++) {
      const n = lines[j]!;
      if (!isContent(n)) continue;
      if (indentOf(n) > indent || (indentOf(n) === indent && n.trimStart().startsWith("-"))) last = j;
      else break;
    }
    out.push({ key: m[1]!, start: i, end: last + 1 });
    i = last;
  }
  return out;
}

/** True when the key line opens a block (nothing after the colon but a comment). */
function opensBlock(line: string): boolean {
  const rest = line.slice(line.indexOf(":") + 1).trim();
  return rest === "" || rest.startsWith("#");
}

function editMap(lines: string[], indent: number, path: string, before: Obj, after: Obj): string[] {
  let out = [...lines];
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  for (const key of keys) {
    const had = key in before;
    const has = key in after;
    if (had && has && deepEqual(before[key], after[key])) continue;
    const kPath = childPath(path, key);
    const entry = locate(out, indent).find((e) => e.key === key);
    if (entry && !has) {
      out.splice(entry.start, entry.end - entry.start);
    } else if (entry) {
      const body = out.slice(entry.start + 1, entry.end);
      const first = body.find(isContent);
      if (isObj(before[key]) && isObj(after[key]) && opensBlock(out[entry.start]!) && first && !first.trimStart().startsWith("-")) {
        const edited = editMap(body, indentOf(first), kPath, before[key] as Obj, after[key] as Obj);
        out.splice(entry.start + 1, body.length, ...edited);
      } else {
        out.splice(entry.start, entry.end - entry.start, ...replaceEntry(out[entry.start]!, entry.end - entry.start === 1, key, after[key], indent, kPath));
      }
    } else if (has) {
      out = insertEntry(out, indent, path, key, serializeEntry(key, after[key], indent, kPath));
    }
  }
  return out;
}

/** Split a line into its content and its trailing comment (with the whitespace before `#`), outside quotes. */
function splitComment(line: string): [string, string] {
  let quote = "";
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quote) {
      if (c === "\\" && quote === '"') i++;
      else if (c === quote) quote = "";
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "#" && i > 0 && /\s/.test(line[i - 1]!)) {
      const content = line.slice(0, i).trimEnd();
      return [content, line.slice(content.length)];
    }
  }
  return [line, ""];
}

function flowScalar(v: unknown): string {
  const s = scalar(v);
  return typeof v === "string" && s === v && /[,{}[\]]/.test(v) ? JSON.stringify(v) : s;
}

/** A value in flow style: `{ k: v }`, `[a, b]`, or a scalar. */
function flowValue(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(flowValue).join(", ")}]`;
  if (isObj(v)) {
    const keys = Object.keys(v);
    return keys.length === 0 ? "{}" : `{ ${keys.map((k) => `${k}: ${flowValue(v[k])}`).join(", ")} }`;
  }
  return flowScalar(v);
}

/** The replacement lines of a changed key: a flow value stays flow, a one-line entry keeps its trailing comment. */
function replaceEntry(oldLine: string, single: boolean, key: string, value: unknown, indent: number, path: string): string[] {
  const [content, comment] = splitComment(oldLine);
  const oldValue = content.slice(content.indexOf(":") + 1).trim();
  const block =
    single && /^[{[]/.test(oldValue) && (isObj(value) || Array.isArray(value))
      ? [`${" ".repeat(indent)}${key}: ${flowValue(value)}`]
      : serializeEntry(key, value, indent, path);
  if (single && comment && block.length === 1) block[0] += comment;
  return block;
}

/** Insert a new key's lines at its place in the fixed key order among its existing siblings. */
function insertEntry(lines: string[], indent: number, path: string, key: string, block: string[]): string[] {
  const order = settingsKeyOrder(path);
  const rank = order.indexOf(key);
  const siblings = locate(lines, indent);
  let at: number;
  const before = rank < 0 ? siblings : siblings.filter((s) => order.indexOf(s.key) >= 0 && order.indexOf(s.key) < rank);
  const following = rank < 0 ? [] : siblings.filter((s) => order.indexOf(s.key) > rank);
  if (before.length > 0) at = before[before.length - 1]!.end;
  else if (following.length > 0) at = following[0]!.start;
  else {
    let last = -1;
    for (let i = 0; i < lines.length; i++) if (isContent(lines[i]!)) last = i;
    at = last + 1;
  }
  const out = [...lines];
  out.splice(at, 0, ...block);
  return out;
}

function parseRaw(text: string): Obj {
  const parsed = Bun.YAML.parse(text);
  return isObj(parsed) ? parsed : {};
}

// ---------------------------------------------------------------------------
// The CLAUDE.md binding stub follows the settings (AC-STE-710.12)
// ---------------------------------------------------------------------------

/** The stub render over the settings as loaded now; "" when there is no settings file or the loader refuses. */
function currentStubRender(projectRoot: string): string {
  try {
    const { source, settings } = loadProjectSettings(projectRoot);
    return source === "settings" ? renderTrackingStub(settings) : "";
  } catch {
    return "";
  }
}

/** Insert, replace or remove CLAUDE.md's stub slot so it is byte-equal to `render`; no other byte changes. */
function syncTrackingStub(projectRoot: string, render: string): void {
  const path = join(projectRoot, "CLAUDE.md");
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  const lines = text.split("\n");
  const stub = render === "" ? [] : render.replace(/\n+$/, "").split("\n");
  const slot = trackingStubSlots(text)[0];
  if (slot) {
    const start = slot.line - 1;
    if (stub.length > 0) {
      lines.splice(start, slot.lines.length, ...stub);
    } else {
      const from = start > 0 && lines[start - 1]!.trim() === "" ? start - 1 : start;
      lines.splice(from, start + slot.lines.length - from);
    }
  } else if (stub.length > 0) {
    const heading = lines.indexOf(PROJECT_SETTINGS_HEADING);
    let at: number;
    if (heading >= 0) {
      at = sectionEnd(lines, heading);
      while (at > heading + 1 && lines[at - 1]!.trim() === "") at--;
    } else {
      at = lines.length;
      while (at > 0 && lines[at - 1]!.trim() === "") at--;
    }
    lines.splice(at, 0, "", ...stub);
  } else {
    return;
  }
  const next = lines.join("\n");
  if (next !== text) writeFileSync(path, next);
}

export function writeProjectSettings(projectRoot: string, update: Obj, opts: { create?: boolean } = {}): void {
  const path = join(projectRoot, SETTINGS_FILE);
  const exists = existsSync(path);
  if (exists && isForeignSettingsFile(projectRoot)) {
    throw new SettingsShapeError(
      `${SETTINGS_FILE} exists and is not a toolkit settings file; the writer never overwrites a foreign file`,
      `move ${SETTINGS_FILE} aside, then re-run.`,
      `file=${SETTINGS_FILE}`,
    );
  }
  if (!exists) {
    if (opts.create !== true) {
      throw new SettingsShapeError(
        `${SETTINGS_FILE} does not exist and this write is not a create`,
        "run /dev-process-toolkit:setup to create the settings file, then re-run.",
        `file=${SETTINGS_FILE}`,
      );
    }
    const initial = mergeUpdate({}, update);
    validateSettingsShape(initial);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${serializeMap(initial, 0, "").join("\n")}\n`);
    const created = currentStubRender(projectRoot);
    if (created !== "") syncTrackingStub(projectRoot, created);
    return;
  }
  const text = readFileSync(path, "utf8");
  const before = parseRaw(text);
  const after = mergeUpdate(before, update);
  if (deepEqual(before, after)) return;
  validateSettingsShape(after);
  const lines = text.endsWith("\n") ? text.slice(0, -1).split("\n") : text.split("\n");
  const renderBefore = currentStubRender(projectRoot);
  writeFileSync(path, `${editMap(lines, 0, "", before, after).join("\n")}\n`);
  const renderAfter = currentStubRender(projectRoot);
  if (renderAfter !== renderBefore) syncTrackingStub(projectRoot, renderAfter);
}
