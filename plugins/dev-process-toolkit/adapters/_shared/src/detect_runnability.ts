// detect_runnability (STE-504, M131) — "does this repo document how to run
// itself?", answered from a CLOSED and NAMED source set.
//
// Consumed by the `runnability_declared` gate-check probe, which asks the
// author to declare `run_cmd:` only when one of these sources actually fired.
//
// The failure mode this module is designed against is an OVER-EAGER detector,
// not a missed detection. A detector that fires on every library trains the
// author to write `run_cmd: none` without reading the question, and a contract
// everyone silences is worse than no contract because it looks like coverage.
// Hence: EXACT MATCH, NEVER SUBSTRING. A `build` script is not a `dev` script,
// a `run-tests` target is not a `run` target, and a README heading "Running the
// test suite" is not "Running".
//
// The four sources, and nothing adjacent:
//   package_json_script  — `package.json` `scripts` carries the exact key
//                          `dev` or `start` (not `dev:watch`, not `predev`).
//   makefile_run_target  — a makefile declares the exact target `run:`
//                          (not `run-tests:`, `prerun:`, `dry-run:`).
//   readme_run_heading   — `README.md` carries a heading whose normalized text
//                          is exactly `Running` / `Getting Started` /
//                          `Development`.
//   claude_md_run_block  — the same closed heading set in `CLAUDE.md`.
//
// Docker/compose/Procfile/just/Task and friends are deliberately OUT of the
// set: the set is closed, and growing it is a spec change, not a patch.
//
// Pure, synchronous, filesystem-only. No child processes, no network, no
// writes, and it never throws — a malformed or unreadable input document
// yields no source, never an exception.
//
// CLAUDE.md note: this module reads CLAUDE.md as an INPUT DOCUMENT (it scans
// the file's headings), not as a managed-ness signal, so it is a recorded
// `CLAUDEMD_GUARD_EXEMPT` entry rather than a `./toolkit_managed` consumer —
// routing this scan through `isToolkitManaged` would change its semantics.

import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The closed set of run-instruction sources this detector knows about. */
export const RUNNABILITY_SOURCE_IDS = [
  "package_json_script",
  "makefile_run_target",
  "readme_run_heading",
  "claude_md_run_block",
] as const;

export type RunnabilitySourceId = (typeof RUNNABILITY_SOURCE_IDS)[number];

export interface RunnabilitySource {
  /** Which of the four closed sources fired. */
  source: RunnabilitySourceId;
  /** Concrete, quotable evidence — the file and the exact token that fired. */
  evidence: string;
}

export interface RunnabilityReport {
  /** Exactly `sources.length > 0`. */
  runnable: boolean;
  sources: RunnabilitySource[];
}

/** `scripts` keys that mean "run the thing", matched EXACTLY. */
const RUN_SCRIPT_KEYS = ["dev", "start"] as const;

/** Makefile names, in GNU make's own resolution order (first present wins). */
const MAKEFILE_NAMES = ["GNUmakefile", "makefile", "Makefile"] as const;

/**
 * A target line declaring EXACTLY `run` — `run:`, `run :`, `run: deps`, and
 * make's double-colon rule `run::`.
 *
 * The lookahead excludes GNU/POSIX make's colon-bearing ASSIGNMENT operators,
 * which are variable definitions and not targets: `run :=` (simply expanded)
 * and `run ::=` (its POSIX spelling). `run ?=` needs no lookahead — it carries
 * no `:` for the literal to match. Excluding exactly `=` and `:=` after the
 * colon is deliberately the NARROWEST edit that covers all three forms: a
 * broader class (say `(?![:=])`) would also swallow the legitimate `run::`
 * double-colon target.
 */
const RUN_TARGET_RE = /^run[ \t]*:(?!:?=)/;

/** Normalized heading texts that mean "here is how you run it", matched EXACTLY. */
const RUN_HEADING_PHRASES = ["running", "getting started", "development"] as const;

/** An ATX markdown heading: one to six `#` then whitespace then text. */
const ATX_HEADING_RE = /^(#{1,6})[ \t]+(.*)$/;

/**
 * A fenced-code-block delimiter line (CommonMark §4.5): up to three leading
 * spaces, then a run of three or more backticks or tildes, then an optional
 * info string. Group 1 is the run itself, group 2 the info string.
 *
 * Fences matter here because a `#`-prefixed line INSIDE a fence is literal
 * text — a shell comment — not an ATX heading. The shipped
 * `templates/CLAUDE.md.template` puts `# Development` inside a ```bash fence,
 * so a fence-blind scan calls every project bootstrapped from it "runnable".
 */
const FENCE_LINE_RE = /^ {0,3}((?:`{3,})|(?:~{3,}))(.*)$/;

/** File bytes, or `null` when the path is missing, unreadable, or a directory. */
function readTextOrNull(absPath: string): string | null {
  try {
    return readFileSync(absPath, "utf-8");
  } catch {
    return null;
  }
}

/** True for a non-null, non-array object — a JSON *record*. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Normalize heading TEXT (the `#`s already stripped by `ATX_HEADING_RE`) into
 * the form a closed phrase is compared against: trimmed, trailing sentence
 * punctuation dropped, lowercased. Everything else survives — which is why
 * "Running the test suite" never becomes "Running".
 */
function normalizeHeading(text: string): string {
  return text.trim().replace(/[.:!?]+$/, "").trim().toLowerCase();
}

/**
 * The first heading in `body` whose normalized text is exactly one of the
 * closed phrases, returned for evidence as its `#` prefix plus the authored
 * text trimmed (so the level is quotable and the case is preserved); `null`
 * when no heading matches.
 */
function findRunHeading(body: string): string | null {
  /** The open fence's delimiter run, or `null` when outside any fence. */
  let openFence: string | null = null;

  for (const rawLine of body.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    const fence = FENCE_LINE_RE.exec(line);

    if (openFence !== null) {
      // Inside a fence: the ONLY thing that can happen is closing it. A closing
      // fence uses the same character, is at least as long as the opener, and
      // carries no info string — so `~~~` never closes a ``` block and a
      // shorter run never closes a longer one. Everything else, `#` lines
      // included, is literal content. An opener that is never closed runs to
      // end of document (CommonMark §4.5), so the scan stays silent from here.
      if (
        fence !== null &&
        fence[1]![0] === openFence[0] &&
        fence[1]!.length >= openFence.length &&
        fence[2]!.trim() === ""
      ) {
        openFence = null;
      }
      continue;
    }

    if (fence !== null) {
      // A backtick opener's info string may not itself contain a backtick
      // (CommonMark §4.5); such a line is not a fence at all.
      if (fence[1]![0] === "`" && fence[2]!.includes("`")) continue;
      openFence = fence[1]!;
      continue;
    }

    const m = ATX_HEADING_RE.exec(line);
    if (m === null) continue;
    const raw = m[2]!.trim();
    if ((RUN_HEADING_PHRASES as readonly string[]).includes(normalizeHeading(raw))) {
      return `${m[1]!} ${raw}`;
    }
  }
  return null;
}

/** `package.json` declares an exact `dev` or `start` script. */
function detectPackageJsonScript(projectRoot: string): RunnabilitySource | null {
  const body = readTextOrNull(join(projectRoot, "package.json"));
  if (body === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;

  const scripts = parsed["scripts"];
  if (!isRecord(scripts)) return null;

  for (const key of RUN_SCRIPT_KEYS) {
    if (!Object.hasOwn(scripts, key)) continue;
    if (typeof scripts[key] !== "string") continue;
    return {
      source: "package_json_script",
      evidence: `package.json declares a \`${key}\` script`,
    };
  }
  return null;
}

/** A makefile declares an exact `run` target. */
function detectMakefileRunTarget(projectRoot: string): RunnabilitySource | null {
  for (const name of MAKEFILE_NAMES) {
    const body = readTextOrNull(join(projectRoot, name));
    if (body === null) continue;
    for (const line of body.split("\n")) {
      if (!RUN_TARGET_RE.test(line)) continue;
      return {
        source: "makefile_run_target",
        evidence: `${name} declares a \`run\` target`,
      };
    }
    // First makefile present wins, target or not — a second file is not a
    // fallback for a makefile that simply has no `run` target.
    return null;
  }
  return null;
}

/** `README.md` carries one of the closed run headings. */
function detectReadmeRunHeading(projectRoot: string): RunnabilitySource | null {
  const body = readTextOrNull(join(projectRoot, "README.md"));
  if (body === null) return null;
  const heading = findRunHeading(body);
  if (heading === null) return null;
  return {
    source: "readme_run_heading",
    evidence: `README.md carries the heading \`${heading}\``,
  };
}

/** `CLAUDE.md` carries one of the closed run headings (input document). */
function detectClaudeMdRunBlock(projectRoot: string): RunnabilitySource | null {
  const body = readTextOrNull(join(projectRoot, "CLAUDE.md"));
  if (body === null) return null;
  const heading = findRunHeading(body);
  if (heading === null) return null;
  return {
    source: "claude_md_run_block",
    evidence: `CLAUDE.md carries the heading \`${heading}\``,
  };
}

const DETECTORS: ReadonlyArray<(projectRoot: string) => RunnabilitySource | null> = [
  detectPackageJsonScript,
  detectMakefileRunTarget,
  detectReadmeRunHeading,
  detectClaudeMdRunBlock,
];

/**
 * Report whether `projectRoot` carries discoverable run instructions, naming
 * every source of the closed set that fired and the evidence that fired it.
 *
 * Never throws: a missing root, a malformed `package.json`, or an unreadable
 * document yields no source rather than an exception.
 */
export function detectRunnability(projectRoot: string): RunnabilityReport {
  const sources: RunnabilitySource[] = [];
  for (const detect of DETECTORS) {
    const hit = detect(projectRoot);
    if (hit !== null) sources.push(hit);
  }
  return { runnable: sources.length > 0, sources };
}
