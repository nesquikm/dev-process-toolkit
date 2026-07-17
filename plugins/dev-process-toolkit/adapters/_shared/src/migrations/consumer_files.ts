// M108 STE-391 — the primitives every registry entry uses to read and heal the
// consumer's tree.
//
// The entries were built one per AC and each grew its own copy of the same four
// mechanics: git-aware removal, malformed-JSON-stays-silent parsing,
// trailing-newline-preserving JSON writes, and EOL-preserving line surgery.
// They live here once so a fix lands once.
//
// SCOPE. Mechanics only — no retired literals, no entry-specific policy. What
// counts as legacy is `./legacy_paths`; what to do about it is the entry's own.
// (The registry's meta-test walks this directory and fails any non-test module
// that composes a retired literal, so keep this file literal-free.)
//
// WRITE ONLY WHAT MOVED (STE-303 byte-compare precedent). Every writer here
// reports whether it actually wrote, so a caller's `changed` list names only
// genuinely-changed paths and a re-run never rewrites a file just to reformat
// it — which is what makes the entries' re-apply no-op provable rather than
// merely intended. The two writers gate on different things, because "did this
// change?" is a different question per format: `writeJsonIfChanged` compares
// serialized bytes (re-serializing is lossy on formatting by design), while
// `rewriteLinesIfChanged` compares the line arrays (joining is lossy on mixed
// endings — see its note).

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

/** The consumer's project-level Claude settings file. */
export function settingsPath(projectRoot: string): string {
  return join(projectRoot, ".claude", "settings.json");
}

/**
 * The parsed JSON object at `path`, or null when the file is absent,
 * unparseable, or not a JSON object (an array and `null` included — neither can
 * carry the keys any caller here looks up).
 *
 * A hand-mangled config is not a migration's problem: detectors stay silent
 * rather than throwing mid-scan and taking the whole registry walk down with
 * them.
 */
export function readJsonObject(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Serialize `value` over `path`, preserving the file's own line-ending style and
 * whether it ended with a newline. Writes only when the bytes move; returns true
 * when it wrote.
 *
 * `JSON.stringify` always emits `\n` and a fixed indent. A CRLF-authored config
 * (Windows) or a 4-space/tab-indented one would have its endings or indentation
 * silently rewritten on the first real change — the opposite of the "every other
 * byte preserved" the seed entries promise — so both the dominant ending and the
 * indent unit are read off the file and reapplied.
 *
 * The file must exist — every caller reaches here having already parsed it.
 */
export function writeJsonIfChanged(path: string, value: unknown): boolean {
  const raw = readFileSync(path, "utf-8");
  const eol = raw.includes("\r\n") ? "\r\n" : "\n";
  const body = JSON.stringify(value, null, detectJsonIndent(raw)).replace(/\n/g, eol);
  const next = body + (raw.endsWith("\n") ? eol : "");
  if (next === raw) return false;
  writeFileSync(path, next);
  return true;
}

/**
 * The indent unit of a pretty-printed JSON file (a tab, or N spaces), read from
 * its first indented line. Falls back to 2 spaces for a minified/single-line
 * file — the toolkit's own default and the safest guess when there is nothing to
 * observe.
 */
function detectJsonIndent(raw: string): string | number {
  const m = /\n(\t+| +)\S/.exec(raw);
  if (!m) return 2;
  return m[1]!.startsWith("\t") ? "\t" : m[1]!.length;
}

/** The lines of `path`, or null when it does not exist. */
export function readLines(path: string): string[] | null {
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf-8").split(/\r?\n/);
}

/**
 * Hand the lines of `path` to `transform` and write the result back. Returns
 * true when it wrote, false when the file is absent or the transform kept every
 * line as-is.
 *
 * This is line SURGERY, not a rewrite: `transform` returns the lines to keep, so
 * every line it hands back survives byte-for-byte in its original position —
 * INCLUDING the line ending it arrived with. Each line is paired with its own
 * terminator and re-emitted with it, so a file whose endings are MIXED comes
 * back mixed exactly as it was. Joining on a single dominant EOL instead would
 * rewrite the endings of lines the entry never targeted, which is the opposite
 * of the "preserved byte-for-byte" the seed entries promise.
 *
 * THE GATE IS THE LINES, NOT THE BYTES. A transform that changed nothing must
 * leave the file untouched, and a byte-compare cannot promise that on a mixed
 * file. Comparing the line arrays keeps "nothing to change" and "nothing gets
 * written" the same statement, whatever the file's endings.
 */
export function rewriteLinesIfChanged(
  path: string,
  transform: (lines: string[]) => string[],
): boolean {
  if (!existsSync(path)) return false;
  const raw = readFileSync(path, "utf-8");
  const origin = splitKeepingEol(raw);
  const lines = origin.map((entry) => entry.text);
  const kept = transform(lines);
  if (kept.length === lines.length && kept.every((line, i) => line === lines[i])) return false;
  writeFileSync(path, rejoinPreservingEol(kept, origin, raw.includes("\r\n") ? "\r\n" : "\n"));
  return true;
}

type LineEntry = { text: string; eol: string };

/**
 * Split into lines that each carry the terminator they were read with. The
 * `text` values match `raw.split(/\r?\n/)` exactly — including the trailing ""
 * a file ending in a newline produces — so callers see the line list they'd
 * expect; the terminators ride alongside for the rejoin.
 */
function splitKeepingEol(raw: string): LineEntry[] {
  const entries: LineEntry[] = [];
  const eol = /\r\n|\n/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = eol.exec(raw)) !== null) {
    entries.push({ text: raw.slice(cursor, match.index), eol: match[0] });
    cursor = match.index + match[0].length;
  }
  entries.push({ text: raw.slice(cursor), eol: "" });
  return entries;
}

/**
 * Re-emit `kept` with each line's original terminator. Surgery hands back a
 * subsequence of the original lines, so a forward two-pointer walk re-pairs each
 * survivor with the entry it came from. A line the transform INSERTED matches no
 * origin and takes `fallback` without consuming an entry — the walk stays aligned
 * for the real survivors after it.
 */
function rejoinPreservingEol(kept: string[], origin: LineEntry[], fallback: string): string {
  let cursor = 0;
  let out = "";
  for (const line of kept) {
    let probe = cursor;
    while (probe < origin.length && origin[probe].text !== line) probe++;
    if (probe < origin.length) {
      out += line + origin[probe].eol;
      cursor = probe + 1;
    } else {
      out += line + fallback;
    }
  }
  return out;
}

/**
 * Remove `target` from the index AND the working tree, returning its
 * project-relative path — or null when there was nothing there to remove.
 *
 * `git rm` rather than a bare unlink because the paths this heals were TRACKED
 * in the layouts that shipped them, and a bare unlink would leave the deletion
 * unstaged. `--ignore-unmatch` keeps an untracked path from erroring, and the
 * exit code is deliberately ignored: a non-repo (or untracked) tree is not a
 * failure, it is the case the `rmSync` fallback below exists for.
 *
 * Not for git-IGNORED paths: those have no index entry, so they want a plain
 * `rmSync` and the spawn here would be dead weight.
 */
export function removeTracked(
  projectRoot: string,
  target: string,
  options: { recursive?: boolean } = {},
): string | null {
  if (!existsSync(target)) return null;
  const rel = relative(projectRoot, target);

  // A missing/unlaunchable git must not throw uncaught — it degrades to the
  // rmSync fallback below (the same shape as the repo's safeGit convention).
  try {
    Bun.spawnSync({
      cmd: ["git", "rm", ...(options.recursive ? ["-r"] : []), "-q", "-f", "--ignore-unmatch", "--", rel],
      cwd: projectRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch {
    // fall through to the filesystem unlink
  }

  if (existsSync(target)) rmSync(target, { recursive: options.recursive ?? false, force: true });
  return rel;
}
