// STE-710 AC-STE-710.17 — the copy plan for /setup --template.
//
// planTemplateCopy composes the proposed content of every selected template
// file BEFORE the Step 5 diff and before the Step 4 project-identifying
// rewrite. It writes nothing. A copied `specs/settings.yaml` passes the
// NEW_KEYS filter: every NEW_KEYS key is dropped (line-wise, so every other
// byte is the template's), and a parent the drop leaves empty goes with it.
// A 3.x template (one carrying `specs/settings.yaml`) refuses a per-category
// selection holding CLAUDE.md without the settings file, or the reverse.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { NEW_KEYS, SETTINGS_FILE } from "../project_settings";

export const SETTINGS_REL = SETTINGS_FILE;
export const CLAUDE_MD_REL = "CLAUDE.md";

export type TemplateCopyOptions = { mode: "per-category"; selection: string[] } | { mode: "whole-project" };

export interface TemplateCopyPlan {
  files: Record<string, string>;
  dropped: string[];
  report: string;
}

function listTree(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        if (dir === root && name === ".git") continue;
        walk(p);
      } else {
        out.push(relative(root, p).split("\\").join("/"));
      }
    }
  };
  walk(root);
  return out;
}

const indentOf = (line: string): number => line.length - line.trimStart().length;
const isContent = (line: string): boolean => line.trim() !== "" && !line.trimStart().startsWith("#");

/** End index (exclusive) of the block opened by the key line at `start`. */
function blockEnd(lines: string[], start: number): number {
  const base = indentOf(lines[start]!);
  let lastContent = start;
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i]!;
    if (!isContent(l)) continue;
    if (indentOf(l) <= base) break;
    lastContent = i;
  }
  return lastContent + 1;
}

/** Index of the line `key:` at a child indent within [from, to), or -1. */
function findKey(lines: string[], from: number, to: number, key: string): number {
  let childIndent = -1;
  for (let i = from; i < to; i++) {
    const l = lines[i]!;
    if (!isContent(l)) continue;
    const ind = indentOf(l);
    if (childIndent === -1) childIndent = ind;
    if (ind !== childIndent) continue;
    const m = /^([A-Za-z0-9_.-]+|"[^"]*"|'[^']*'):(\s|$)/.exec(l.trimStart());
    if (m && m[1]!.replace(/^["']|["']$/g, "") === key) return i;
  }
  return -1;
}

/**
 * For a key line carrying an inline flow value, drop `rest` from that value.
 * Returns "unchanged" when the line holds no inline value (block style),
 * null when the inline value lacks the path, "empty" when the drop leaves
 * the value empty, else the rewritten line.
 */
function dropFromFlow(line: string, rest: string[]): string | "unchanged" | "empty" | null {
  const m = /^(\s*(?:[A-Za-z0-9_.-]+|"[^"]*"|'[^']*'):)\s*(.*)$/.exec(line);
  if (!m) return "unchanged";
  const raw = m[2]!.replace(/\s+#.*$/, "").trim();
  if (raw === "" || raw.startsWith("#")) return "unchanged";
  let value: unknown;
  try {
    value = Bun.YAML.parse(raw);
  } catch {
    return null;
  }
  const chain: Record<string, unknown>[] = [];
  let cur: unknown = value;
  for (const part of rest) {
    if (cur === null || typeof cur !== "object" || Array.isArray(cur) || !(part in (cur as object))) return null;
    chain.push(cur as Record<string, unknown>);
    cur = (cur as Record<string, unknown>)[part];
  }
  delete chain[chain.length - 1]![rest[rest.length - 1]!];
  for (let i = chain.length - 1; i > 0; i--) {
    if (Object.keys(chain[i]!).length > 0) break;
    delete chain[i - 1]![rest[i - 1]!];
  }
  if (Object.keys(chain[0]!).length === 0) return "empty";
  return `${m[1]} ${JSON.stringify(chain[0])}`;
}

/** Drop every NEW_KEYS key from a settings file's text; returns the filtered text + the dropped keys. */
export function filterNewKeys(text: string): { text: string; dropped: string[] } {
  let lines = text.split("\n");
  const dropped: string[] = [];
  for (const dotted of NEW_KEYS) {
    const parts = dotted.split(".");
    const chain: number[] = [];
    let from = 0;
    let to = lines.length;
    let found = true;
    for (let p = 0; p < parts.length; p++) {
      const idx = findKey(lines, from, to, parts[p]!);
      if (idx === -1) {
        found = false;
        break;
      }
      chain.push(idx);
      if (p < parts.length - 1) {
        // A flow-style value (`key: { a: { b: 1 } }`) holds the rest of the path inline.
        const flow = dropFromFlow(lines[idx]!, parts.slice(p + 1));
        if (flow === null) {
          found = false;
          break;
        }
        if (flow !== "unchanged") {
          if (flow !== "empty") {
            lines[idx] = flow;
            dropped.push(dotted);
            found = false; // handled in place
            break;
          }
          break; // the whole line goes: treat it as the leaf
        }
      }
      from = idx + 1;
      to = blockEnd(lines, idx);
    }
    if (!found) continue;
    // Remove the leaf, then every parent the removal left empty.
    let level = chain.length - 1;
    let start = chain[level]!;
    let end = blockEnd(lines, start);
    while (level > 0) {
      const parent = chain[level - 1]!;
      const pEnd = blockEnd(lines, parent);
      const remaining = lines.slice(parent + 1, pEnd).filter((l, i) => {
        const abs = parent + 1 + i;
        return isContent(l) && (abs < start || abs >= end);
      });
      if (remaining.length > 0) break;
      start = parent;
      end = pEnd;
      level--;
    }
    lines = [...lines.slice(0, start), ...lines.slice(end)];
    dropped.push(dotted);
  }
  return { text: lines.join("\n"), dropped };
}

function pairRefusal(selected: string, missing: string, templateRoot: string): Error {
  return new Error(
    [
      `Refusing: the selection copies ${selected} without ${missing}; a template carrying ${SETTINGS_REL} keeps its settings in that file, and ${CLAUDE_MD_REL} and ${SETTINGS_REL} travel as a pair.`,
      `Remedy: select both ${CLAUDE_MD_REL} and ${SETTINGS_REL}, or neither, and re-run /setup --template.`,
      `Context: template=${templateRoot}, selected=${selected}, missing=${missing}; nothing was written.`,
    ].join("\n"),
  );
}

export function planTemplateCopy(templateRoot: string, targetRoot: string, opts: TemplateCopyOptions): TemplateCopyPlan {
  void targetRoot; // the plan reads only the template; the target is untouched until Step 5.
  const isV3 = existsSync(join(templateRoot, SETTINGS_REL));
  let selection: string[];
  if (opts.mode === "whole-project") {
    selection = listTree(templateRoot);
  } else {
    selection = [...opts.selection];
    if (isV3) {
      const hasMd = selection.includes(CLAUDE_MD_REL);
      const hasSettings = selection.includes(SETTINGS_REL);
      if (hasMd && !hasSettings) throw pairRefusal(CLAUDE_MD_REL, SETTINGS_REL, templateRoot);
      if (hasSettings && !hasMd) throw pairRefusal(SETTINGS_REL, CLAUDE_MD_REL, templateRoot);
    }
  }
  const files: Record<string, string> = {};
  let dropped: string[] = [];
  for (const rel of selection) {
    const body = readFileSync(join(templateRoot, rel), "utf8");
    if (rel === SETTINGS_REL) {
      const filtered = filterNewKeys(body);
      files[rel] = filtered.text;
      dropped = filtered.dropped;
    } else {
      files[rel] = body;
    }
  }
  const report =
    dropped.length === 0
      ? ""
      : `${SETTINGS_REL}: dropped ${dropped.length} key(s) this toolkit version introduces (NEW_KEYS) — ${dropped.join(", ")}. The target opts in on its own.`;
  return { files, dropped, report };
}
