// M131 STE-507 — seed the runnability contract into an already-bootstrapped
// project's `## Verification` block (AC-STE-507.3..5).
//
// M131 widened the `## Verification` key set with `run_cmd` / `e2e_cmd`, and
// `/setup` now settles `run_cmd` on its check-skill step (§ 8c) — but only on
// that step's ACCEPT path, which is opt-in and writes nothing on decline. So
// the trees this entry has to answer for are two, not one: every tree
// bootstrapped BEFORE M131, and every tree that declined § 8c. Both carry a
// block with the key simply absent — and an absent key is not an answer, it is
// silence. This entry supplies the one answer that is knowable without asking
// anybody: a project that documents no way to run itself gets `run_cmd: none`.
//
// SPLICE, NEVER RE-RENDER — the constraint the whole module is shaped around.
//
//   `renderVerificationSection` (../../verification_config) UNCONDITIONALLY
//   emits a `verify_mode:` line, defaulting to `advisory`. Healing the block by
//   round-tripping it through that renderer would therefore stamp
//   `verify_mode: advisory` onto every migrated project whose block never
//   declared the key — permanently defeating the run_cmd-keyed `blocking`
//   default `resolveVerifyMode` ships (STE-505), on exactly the projects this
//   entry touches, and silently. It would also eat the operator's own bytes:
//   comments, blank lines, key order, and any prose that lives inside the
//   section. So this module NEVER calls the renderer. It inserts ONE line into
//   the lines array it read and writes the rest back untouched, line endings
//   included.
//
// WHAT IT DECLINES, AND WHY THE SILENCE IS A DECISION.
//
//   * A RUNNABLE project — one where `detectRunnability` fires on any of its
//     four closed sources — is left alone. The migration must never invent a
//     run command it cannot verify: the detector knows a `dev` script exists,
//     not that `bun run dev` is the command this operator wants driven, and a
//     wrong `run_cmd` under the STE-505 default is a BLOCKING gate on a command
//     that does not work. That project already belongs to the gate: probe #80
//     (`runnability_declared`) fails it, names the source that fired, and
//     offers `none` in its remedy. One surface asks the question; this one only
//     answers where the answer is knowable.
//   * `e2e_cmd` is NEVER written, on either path. Nothing in the closed source
//     set inspects an end-to-end suite, so `none` there would be a guess about
//     a question the detector never asked.
//   * A block that already declares `run_cmd` — ANY value, `none` included — is
//     already answered, and a re-run must not second-guess it.
//   * A CLAUDE.md with no `## Verification` section at all is not a target.
//     Manufacturing a block is `/setup`'s job, with the operator present.
//
// IDEMPOTENCY. `applies` is keyed on what `apply` will ACTUALLY write, via the
// single `planRunCmdSplice` helper both halves call — so "did this fire?" and
// "what gets spliced?" cannot disagree, and detect-after-apply is false by
// construction. `/upgrade` step 6 re-runs every applied entry's detector and
// treats a still-detecting entry as a bug in the entry.
//
// VERSION: `introduced_in` is the SHIPPING release (2.70.0). `specs/plan/M131.md`
// declares `migration: verification-run-keys`, and both `assertMigrationDeclared`
// and probe #68 require this field to equal the version the declaring plan
// ships. Here the two readings of `introduced_in` coincide anyway — the keys
// become mandatory in the same release that heals their absence.
//
// No retired path literal is composed here: `## Verification`, `run_cmd` and
// `none` are LIVE shapes owned by `../../verification_config`, not retired ones,
// so `../legacy_paths` has nothing to say about this entry.

import { readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { detectRunnability } from "../../detect_runnability";
import { VERIFICATION_HEADING } from "../../verification_config";
import type { ApplyResult, DetectResult, MigrationEntry } from "../index";

/** The key this entry seeds, and the only value it is ever willing to write. */
const RUN_CMD_KEY = "run_cmd";
const RUN_CMD_ANSWER = "none";
const RUN_CMD_LINE = `${RUN_CMD_KEY}: ${RUN_CMD_ANSWER}`;

/**
 * The section's canonical key order. `verification_config`'s `CLOSED_KEYS` is
 * module-private, so this is a deliberate hand copy of it rather than an
 * import. Used ONLY to decide WHERE the spliced line lands — never to validate
 * a key, never to reorder one — so a migrated block reads like a rendered one
 * even though nothing was rendered.
 */
const CANONICAL_KEY_ORDER = ["verify_skill", "verify_mode", "run_cmd", "e2e_cmd"] as const;

/** A flat `key: value` line inside the section — the Schema L grammar. */
const SECTION_KEY_RE = /^([a-z0-9_]+):\s*(.*)$/;

/**
 * Every section key declared inside ONE element of the `lines` array, in order.
 *
 * A chunk is normally exactly one line — but `splitLines` commits to a SINGLE
 * separator, so a file that MIXES line endings hands this module chunks with
 * lone `\n`s still inside them: a CRLF file hand-edited on a POSIX box arrives
 * as `verify_skill: demo-drive\nrun_cmd: none` in one chunk. `SECTION_KEY_RE`
 * anchors to the whole string (no `m` flag), so a direct `exec` cannot see the
 * `run_cmd:` hiding after the embedded LF, and the already-answered scan would
 * splice a SECOND `run_cmd` into a block that already declares one. Splitting
 * the chunk on the other separator here is what makes that scan see a declared
 * key whatever the line endings — while `lines` and `eol` stay untouched, so a
 * pure-CRLF file still round-trips losslessly through `join(eol)`.
 */
function sectionKeysIn(chunk: string): string[] {
  const keys: string[] = [];
  for (const physical of chunk.split("\n")) {
    const m = SECTION_KEY_RE.exec(physical.replace(/\r+$/, ""));
    if (m !== null) keys.push(m[1]!);
  }
  return keys;
}

/**
 * The section terminator, byte-for-byte the parser's own rule in
 * `verification_config` (`/^#{1,4} /`): `#` through `####`, and deliberately
 * NOT "any heading level" — a `##### ` line terminates the block in neither
 * place. Copying the parser's exact range is what keeps the two from
 * disagreeing about where the section ends.
 */
const HEADING_RE = /^#{1,4} /;

/** Exactly what `apply` would write, computed once and shared with `detect`. */
interface PlannedSplice {
  /** Absolute path to the file that changes. */
  file: string;
  /** Project-relative path — what `evidence` and `changed` name. */
  rel: string;
  /** The file's lines, split on `eol`; `join(eol)` reproduces the bytes. */
  lines: string[];
  /** The line separator the file was authored with (`\n` or `\r\n`). */
  eol: string;
  /** Index in `lines` the new line is inserted BEFORE. */
  insertAt: number;
  /** The exact line to insert. */
  line: string;
}

/**
 * Split `raw` losslessly: whichever separator the file was authored with, a
 * later `lines.join(eol)` reproduces the original bytes exactly. A CRLF file
 * therefore stays CRLF, and no lone LF is ever introduced.
 */
function splitLines(raw: string): { lines: string[]; eol: string } {
  const eol = raw.includes("\r\n") ? "\r\n" : "\n";
  return { lines: raw.split(eol), eol };
}

/** File bytes, or `null` when the path is missing or unreadable. Never throws. */
function readTextOrNull(absPath: string): string | null {
  try {
    return readFileSync(absPath, "utf-8");
  } catch {
    return null;
  }
}

/** Canonical rank of a section key, or `null` when it is not one of the four. */
function keyRank(key: string): number | null {
  const at = (CANONICAL_KEY_ORDER as readonly string[]).indexOf(key);
  return at === -1 ? null : at;
}

/**
 * Where a `run_cmd:` line belongs inside `[start, end)` so the block keeps
 * canonical key order: after the last declared key that sorts before it, else
 * before the first that sorts after it, else on the section's first non-blank
 * line — which is where a rendered block puts its first key.
 *
 * Only the position is computed here. Nothing about the operator's existing
 * lines is touched, reordered, or normalized.
 */
function splicePosition(lines: readonly string[], start: number, end: number): number {
  const mine = keyRank(RUN_CMD_KEY)!;
  let afterLower = -1;
  let beforeHigher = -1;

  for (let i = start; i < end; i++) {
    for (const key of sectionKeysIn(lines[i]!)) {
      const rank = keyRank(key);
      if (rank === null) continue;
      if (rank < mine) afterLower = i;
      else if (rank > mine && beforeHigher === -1) beforeHigher = i;
    }
  }

  if (afterLower !== -1) return afterLower + 1;
  if (beforeHigher !== -1) return beforeHigher;

  let at = start;
  while (at < end && lines[at]!.trim() === "") at++;
  return at;
}

/**
 * The ONE computation of "what would change", shared by `detect` and `apply`.
 *
 * Pure, synchronous, filesystem-only and network-free per the registry
 * contract: it reads CLAUDE.md and the four runnability sources, spawns
 * nothing, and never writes. Returns `null` — meaning the entry does not apply
 * — for every case documented in the header: no CLAUDE.md, no
 * `## Verification` section, a block already declaring `run_cmd`, and a project
 * whose runnability the detector actually established.
 */
function planRunCmdSplice(projectRoot: string): PlannedSplice | null {
  const file = join(projectRoot, "CLAUDE.md");
  const raw = readTextOrNull(file);
  if (raw === null) return null;

  const { lines, eol } = splitLines(raw);

  // Whole-line match on the shared heading constant — never a substring, never
  // a private copy of the literal, so the entry and the parser can never
  // disagree about where the section is.
  const start = lines.indexOf(VERIFICATION_HEADING);
  if (start < 0) return null;

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (HEADING_RE.test(lines[i]!)) {
      end = i;
      break;
    }
  }

  // Already answered — any value counts, `none` included, and whatever line
  // endings the file mixes (see `sectionKeysIn`).
  for (let i = start + 1; i < end; i++) {
    if (sectionKeysIn(lines[i]!).includes(RUN_CMD_KEY)) return null;
  }

  // The project documents how to run itself: probe #80 owns it, and writing
  // `none` here would be a lie while writing a real command would be a guess.
  if (detectRunnability(projectRoot).runnable) return null;

  return {
    file,
    rel: relative(projectRoot, file),
    lines,
    eol,
    insertAt: splicePosition(lines, start + 1, end),
    line: RUN_CMD_LINE,
  };
}

export const verificationRunKeys: MigrationEntry = {
  id: "verification-run-keys",
  introduced_in: "2.70.0",
  title: "Seed the runnability contract: add `run_cmd: none` to a not-runnable project's ## Verification block",
  kind: "script",
  detect(projectRoot): DetectResult {
    const plan = planRunCmdSplice(projectRoot);
    if (plan === null) return { applies: false, evidence: [] };
    // One evidence row per change, naming the file AND the exact line — the
    // operator approves the literal bytes, not a description of them.
    return {
      applies: true,
      evidence: [
        `${plan.rel} — the ## Verification block declares no ${RUN_CMD_KEY}: key and no run-instruction source fired, so the answer is knowable: splice \`${plan.line}\` into the block. Exactly one line is added; nothing else in the file is rewritten, and no e2e_cmd: is invented.`,
      ],
    };
  },
  apply(projectRoot): ApplyResult {
    const plan = planRunCmdSplice(projectRoot);
    if (plan === null) {
      // Nothing to seed: no block, the key already answered, or a project whose
      // runnability the detector established and this entry declines to answer
      // for. Re-applying is a no-op by construction — the same helper `detect`
      // consulted is the one that says so.
      return {
        changed: [],
        summary: "No ## Verification block is missing a run_cmd: answer this entry can supply — nothing to do.",
      };
    }

    const lines = [...plan.lines];
    lines.splice(plan.insertAt, 0, plan.line);
    writeFileSync(plan.file, lines.join(plan.eol), "utf-8");

    return {
      changed: [plan.rel],
      summary: `Seeded the runnability contract in ${plan.rel}: added \`${plan.line}\` to the ## Verification block. No run-instruction source fired for this project, so \`${RUN_CMD_ANSWER}\` is the declared answer rather than a guess — replace it with the real command if the project can in fact be run. The block was spliced, not re-rendered: no verify_mode: line was introduced, so a project that later declares a real run command still resolves to blocking.`,
    };
  },
};
