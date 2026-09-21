// Shared parsing for the M_4df444 / STE-595 suites.
//
// Two jobs, over the three project-local driver documents
// (`.claude/skills/conformance-loop/SKILL.md`, `.claude/skills/smoke-test/SKILL.md`,
// and — STE-617 AC.3 — `.claude/skills/shared-tracker-smoke/SKILL.md`):
//
//   1. Derive the SPAWN SITES by parsing, fence-aware. A spawn site is a fenced
//      block holding a `claude -p` COMMAND line: the line's first word, after an
//      optional `{`, is `claude` followed by `-p`. A line that merely mentions
//      `claude -p` in echo text or Remedy prose is not a spawn, and heredoc BODY
//      text is never code. No site count is pinned anywhere: every set below is
//      recomputed from the documents on every run.
//
//   2. Read the live-child count those fences print. The count-line contract
//      the STE-595 suites assert is two key=value tokens on ONE line:
//
//          launched=<n> live=<n>
//
//      (either order, any surrounding text). `launched` is how many children the
//      fence started, counted independently of the pidfiles; `live` is how many
//      RECORDED pids (the pidfiles the fence already writes) still answer
//      `kill -0` AND pass the `ps -p <pid> -o comm=` identity check.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const pluginRoot = join(import.meta.dir, "..");
export const repoRoot = join(pluginRoot, "..", "..");
export const LOOP_DOC = join(repoRoot, ".claude", "skills", "conformance-loop", "SKILL.md");
export const SMOKE_DOC = join(repoRoot, ".claude", "skills", "smoke-test", "SKILL.md");
export const SHARED_DOC = join(repoRoot, ".claude", "skills", "shared-tracker-smoke", "SKILL.md");

export type DocId = "conformance-loop" | "smoke-test" | "shared-tracker-smoke";

/** Every driver document, by id — the ONE table a new document is added to. */
export const DOC_PATHS: Readonly<Record<DocId, string>> = {
  "conformance-loop": LOOP_DOC,
  "smoke-test": SMOKE_DOC,
  "shared-tracker-smoke": SHARED_DOC,
};

/** Every document id, in table order: suites iterate this, never a literal list. */
export const DOC_IDS: readonly DocId[] = Object.keys(DOC_PATHS) as DocId[];
export type LineKind = "code" | "prose" | "heredoc";

export interface Fence {
  doc: DocId;
  /** 1-based line of the opening back-tick run. */
  openLine: number;
  /** 1-based line of the closing back-tick run. */
  closeLine: number;
  info: string;
  /** Body lines exactly as written, indentation kept. */
  lines: string[];
  body: string;
  /**
   * Where a site's rule may be stated: from the later of the previous fence's
   * close and the nearest heading above, through this fence's close.
   */
  region: string;
}

export function readDoc(doc: DocId): string {
  const path = DOC_PATHS[doc];
  if (path === undefined) throw new Error(`readDoc: unknown document id ${JSON.stringify(doc)}`);
  return readFileSync(path, "utf-8");
}

/**
 * The document ids whose file is absent. The site sets below parse an absent
 * document as empty so every suite still LOADS and fails by name; each suite
 * that iterates `DOC_IDS` asserts this list is empty and that every document
 * yields spawn sites, so an absent document is a loud red, never a quiet pass.
 */
export function missingDocs(): DocId[] {
  return DOC_IDS.filter((d) => !existsSync(DOC_PATHS[d]));
}

function docOrEmpty(doc: DocId): string {
  return existsSync(DOC_PATHS[doc]) ? readDoc(doc) : "";
}

export function label(f: Fence): string {
  return `${f.doc}:L${f.openLine}-${f.closeLine}`;
}

/** Every fenced block, indented or not, in document order. */
export function parseFences(doc: DocId, text: string): Fence[] {
  const all = text.replace(/\r\n/g, "\n").split("\n");
  const out: Fence[] = [];
  let open: { idx: number; ticks: string; info: string } | null = null;
  let regionStart = 0;
  for (let i = 0; i < all.length; i++) {
    const line = all[i]!;
    if (open === null) {
      const m = /^\s*(`{3,})(.*)$/.exec(line);
      if (m) {
        open = { idx: i, ticks: m[1]!, info: m[2]!.trim() };
        continue;
      }
      if (/^#{1,6}\s/.test(line)) regionStart = i;
      continue;
    }
    const t = line.trim();
    if (/^`{3,}$/.test(t) && t.length >= open.ticks.length) {
      const lines = all.slice(open.idx + 1, i);
      out.push({
        doc,
        openLine: open.idx + 1,
        closeLine: i + 1,
        info: open.info,
        lines,
        body: lines.join("\n"),
        region: all.slice(regionStart, i + 1).join("\n"),
      });
      open = null;
      regionStart = i + 1;
    }
  }
  return out;
}

export function allFences(): Fence[] {
  return DOC_IDS.flatMap((doc) => parseFences(doc, docOrEmpty(doc)));
}

/**
 * The heredoc a line opens, if any: a `<<` outside quotes and comments that
 * is not a `<<<` here-string. Quote-aware so an echo mentioning `bash <<EOF`
 * does not swallow the rest of the fence as a phantom heredoc body.
 */
export function heredocOpener(line: string): { tag: string; dash: boolean } | null {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quote !== null) {
      if (quote === '"' && c === "\\") {
        i++;
        continue;
      }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === "#" && (i === 0 || /\s/.test(line[i - 1]!))) return null;
    if (c === "'" || c === '"') {
      quote = c;
      continue;
    }
    if (c === "<" && line[i + 1] === "<") {
      if (line[i + 2] === "<") {
        i += 2;
        continue;
      }
      const m = /^(-?)[ \t]*(['"]?)([^\s'"<>;&|()]+)\2/.exec(line.slice(i + 2));
      if (m) return { tag: m[3]!, dash: m[1] === "-" };
      i += 1;
    }
  }
  return null;
}

/** Per body line: shell code, prose (comment or blank), or heredoc body text. */
export function classify(lines: readonly string[]): LineKind[] {
  const kinds: LineKind[] = [];
  let pending: { tag: string; dash: boolean } | null = null;
  for (const line of lines) {
    if (pending !== null) {
      const probe = pending.dash ? line.replace(/^\t+/, "") : line;
      if (probe.trim() === pending.tag) {
        kinds.push("code"); // the terminator
        pending = null;
      } else {
        kinds.push("heredoc");
      }
      continue;
    }
    if (line.trim() === "" || /^\s*#/.test(line)) {
      kinds.push("prose");
      continue;
    }
    kinds.push("code");
    pending = heredocOpener(line);
  }
  return kinds;
}

export const SPAWN_LINE_RE = /^\s*(?:\{\s*)?claude\s+-p\b/;

/** 0-based body indices of `claude -p` command lines. */
export function spawnLineIndices(f: Fence): number[] {
  const kinds = classify(f.lines);
  return f.lines.flatMap((l, i) => (kinds[i] === "code" && SPAWN_LINE_RE.test(l) ? [i] : []));
}

export function isSpawnFence(f: Fence): boolean {
  return spawnLineIndices(f).length > 0;
}

/** A spawn fence that captures `$!` — its children are recorded, so a count can find them. */
export function isBackgroundSpawnFence(f: Fence): boolean {
  if (!isSpawnFence(f)) return false;
  const kinds = classify(f.lines);
  return f.lines.some((l, i) => kinds[i] === "code" && /\$!/.test(l));
}

/** Same shape `leg_prose_surfaces.ts` locates: a column-0 `{ … } &` group. */
const BRACE_GROUP_RE = /^\{[ \t]*\n[\s\S]*?^\}[^\n]*&/m;

/** The /conformance-loop Phase A spawn fence, found by shape, never by line number. */
export function phaseAFence(loopFences: readonly Fence[]): Fence | undefined {
  return loopFences.find(
    (f) =>
      f.doc === "conformance-loop" &&
      isSpawnFence(f) &&
      f.body.includes("--tracker") &&
      BRACE_GROUP_RE.test(f.body),
  );
}

/**
 * AC-STE-595.5 sites: /conformance-loop Phase A plus every /smoke-test spawn
 * fence, plus (STE-617 AC.3) every /shared-tracker-smoke spawn fence.
 */
export function ruleSites(): Fence[] {
  const loop = parseFences("conformance-loop", readDoc("conformance-loop"));
  const smoke = parseFences("smoke-test", readDoc("smoke-test"));
  const shared = parseFences("shared-tracker-smoke", docOrEmpty("shared-tracker-smoke"));
  const a = phaseAFence(loop);
  return [...(a ? [a] : []), ...smoke.filter(isSpawnFence), ...shared.filter(isSpawnFence)];
}

/**
 * STE-617 AC.3 — the fence ends with its live-child count: a CODE line
 * printing `launched=<n> live=<n>` sits after the fence's LAST spawn line.
 * Stricter than the STE-595 window rule, which only background fences meet.
 */
export function countLineAfterLastSpawn(f: Fence): boolean {
  const spawns = spawnLineIndices(f);
  if (spawns.length === 0) return false;
  const last = spawns[spawns.length - 1]!;
  const kinds = classify(f.lines);
  return f.lines.some((l, i) => i > last && kinds[i] === "code" && COUNT_LINE_TEXT_RE.test(l));
}

/** AC-STE-595.6 sites: every fence, in either driver, that backgrounds a spawn and captures `$!`. */
export function countSites(): Fence[] {
  return allFences().filter(isBackgroundSpawnFence);
}

// --- the run-from-a-file rule ----------------------------------------------

export const RULE_LITERAL = "bash <file>";

/** The rule is stated: the literal `bash <file>`, with stdin named within 300 characters. */
export function statesRunFromFileRule(region: string): boolean {
  const flat = region.replace(/\s+/g, " ");
  let from = 0;
  for (;;) {
    const at = flat.indexOf(RULE_LITERAL, from);
    if (at < 0) return false;
    const near = flat.slice(Math.max(0, at - 300), at + RULE_LITERAL.length + 300);
    if (/\bstdin\b|standard input/i.test(near)) return true;
    from = at + 1;
  }
}

// --- the live-child count --------------------------------------------------

/** `ps -p <pid> -o comm=` in either flag order. */
export const IDENTITY_RE = /\bps\b[^\n]*?(?:-p\b[^\n]*-o\s*comm=|-o\s*comm=[^\n]*-p\b)/;
export const KILL0_RE = /\bkill\s+-0\b/;
/** A statement that can end the fence before a later count runs. */
export const ABORT_STMT_RE = /(?:^|[\s;&|{(])(?:exit|return)\b|\$\{[A-Za-z_][A-Za-z0-9_]*:\?/;
export const COUNT_LINE_TEXT_RE = /launched=[^\n]*live=|live=[^\n]*launched=/;

export interface SpawnCount {
  /** 0-based body index of the spawn line. */
  spawnIndex: number;
  /** First identity-check code line after the spawn, or null. */
  identityIndex: number | null;
  /** First abort statement strictly between the spawn and its count (to the end when there is no count). */
  abortIndex: number | null;
}

function stripTrailingComment(line: string): string {
  return line.replace(/\s+#.*$/, "");
}

export function spawnCounts(f: Fence): SpawnCount[] {
  const kinds = classify(f.lines);
  const isCode = (i: number) => kinds[i] === "code";
  return spawnLineIndices(f).map((s) => {
    let identityIndex: number | null = null;
    for (let i = s + 1; i < f.lines.length; i++) {
      if (isCode(i) && IDENTITY_RE.test(f.lines[i]!)) {
        identityIndex = i;
        break;
      }
    }
    const stop = identityIndex ?? f.lines.length;
    let abortIndex: number | null = null;
    for (let i = s + 1; i < stop; i++) {
      if (isCode(i) && ABORT_STMT_RE.test(stripTrailingComment(f.lines[i]!))) {
        abortIndex = i;
        break;
      }
    }
    return { spawnIndex: s, identityIndex, abortIndex };
  });
}

/**
 * A count armed as an EXIT trap runs whatever aborts first, so its textual
 * position does not matter: accepted in place of the after-every-spawn rule.
 */
export function hasExitTrapCount(f: Fence): boolean {
  const kinds = classify(f.lines);
  const trap = f.lines.some((l, i) => kinds[i] === "code" && /^\s*trap\b[^\n]*\bEXIT\b/.test(l));
  return trap && f.lines.some((l, i) => kinds[i] === "code" && IDENTITY_RE.test(l));
}

/** The first identity-check code line at or after the first spawn (or anywhere, under an EXIT trap). */
export function firstIdentityIndex(f: Fence): number | null {
  const kinds = classify(f.lines);
  const first = spawnLineIndices(f)[0] ?? 0;
  const from = hasExitTrapCount(f) ? 0 : first;
  for (let i = from; i < f.lines.length; i++) {
    if (kinds[i] === "code" && IDENTITY_RE.test(f.lines[i]!)) return i;
  }
  return null;
}

export function countWindowLines(f: Fence, identityIndex: number, before = 12, after = 80): string[] {
  return f.lines.slice(Math.max(0, identityIndex - before), identityIndex + after);
}

export interface CountLine {
  launched: number;
  live: number;
  line: string;
}

/** Every `launched=<n> live=<n>` line in a fence run's output. */
export function countLines(output: string): CountLine[] {
  return output.split("\n").flatMap((line) => {
    const launched = /\blaunched=(\d+)\b/.exec(line);
    const live = /\blive=(\d+)\b/.exec(line);
    return launched && live
      ? [{ launched: Number(launched[1]), live: Number(live[1]), line }]
      : [];
  });
}
