// AC-STE-601.14 — real-traffic replay (the M_4df444 method). UNCOLLECTED helper:
// the file name does not end in `.test.ts`, so `bun test` never runs it.
//
//   bun run tests/_command_traffic_replay.ts [--base <sha>]
//   bun run tests/_command_traffic_replay.ts --pr-only
//
// AC-STE-615.7 adds the second form. `--pr-only` runs the PR legs ALONE: no
// base-resolver `git archive`, no commit classification. The retired anchored
// prefix `/^gh pr create\b/` is the "before" side and `resolvePrTargetFromPayload`
// is the "after" side, so one pass over a multi-gigabyte corpus answers the
// question instead of two classifications per command. Both differences are
// printed as LISTS, not merely counted, because the AC asks for every command in
// the difference to be hand-classified as a real creation or a mention.
//
// Reads every `*.jsonl` under `$CLAUDE_CONFIG_DIR/projects/` (default
// `~/.claude/projects/`), extracts the distinct Bash `tool_use` commands, and
// classifies each twice: through the resolver at the milestone's fixed base
// commit (extracted with `git archive` into a temp dir) and through the
// post-change resolver in this working tree.
//
// Both sides resolve with a filesystem-free root lookup (every absolute
// directory is its own checkout) and no git aliases, so the replay does not
// depend on which checkouts or aliases exist today. Only counts and command
// lists reach stdout; no transcript text is written anywhere.
//
// AC-STE-614.15 adds three counts over the same corpus:
//   * commit-bearing commands the post-change resolver leaves UNRESOLVED
//     (`repoRoot === null`) — the leg that prints the exit-1 `Reminder:`;
//   * commit-bearing commands naming SEVERAL checkouts (`repoRoots.length > 1`);
//   * gate-check / tdd / spec-review Skill calls whose paired `tool_result`
//     carried `is_error: true` — the NF-3 traffic, counted over TRANSCRIPTS
//     rather than over commands.
//
// PAIRING RULE — the third count applies the rule `scanSkillCalls` implements in
// `templates/hooks/_lib/session.ts:404-459`: a block is a Skill call when it is a
// `tool_use` named `Skill` whose `input.skill` IS the needle (never a substring
// match), and a `tool_result` retires the call whose `id` equals its
// `tool_use_id` when it carries `is_error: true`. That function and its
// `transcriptBlocks` reader are MODULE-PRIVATE, and the exported face,
// `findSkillToolUse`, answers one boolean for one transcript rather than a
// per-call count — so the rule could not be imported and is restated here,
// deliberately field-for-field, as this file's only copy of it.

import { spawnSync } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { resolveCommitTarget } from "../adapters/_shared/src/commit_target_repo";
import { gitRemotesOf, resolvePrTargetFromPayload } from "../adapters/_shared/src/pr_target_repo";

export const DEFAULT_BASE_SHA = "ff41e4e42506cd119bf2b8b2866f9654fc113aec";
const RESOLVER_DIR = "plugins/dev-process-toolkit/adapters/_shared/src";

/** The part of a resolver's answer the replay compares. */
export interface Classification {
  isCommit: boolean;
  repoRoot: string | null;
  advisory: string | null;
  /** Every distinct checkout the command names. Empty on a base resolver without the field. */
  repoRoots: string[];
  /**
   * True when the target could not be PLACED (an unexpandable word, an unplaced
   * wrapper, `--git-dir`): the leg that prints the exit-1 Reminder. False on a
   * base resolver that has no such field — which is honest, since the base has
   * no Reminder leg either.
   */
  unplaced: boolean;
}

type Resolver = (command: string, sessionCwd: string, roots: (dir: string) => string | null, ...rest: never[]) => {
  isCommit: boolean;
  repoRoot: string | null;
  advisory?: string | null;
  repoRoots?: string[];
  unplaced?: boolean;
};

/** The three skills whose denied or failed calls AC-STE-614.15 counts. */
export const GATE_SKILLS = [
  "dev-process-toolkit:gate-check",
  "dev-process-toolkit:tdd",
  "dev-process-toolkit:spec-review",
] as const;

/** Every absolute directory is its own checkout; nothing else is inside one. */
export const selfRoot = (dir: string): string | null => (isAbsolute(dir) ? dir : null);
const noAliases = (): null => null;

/** Classify one command through a resolver (default: the post-change one). */
export function classifyCommand(
  command: string,
  sessionCwd = "/",
  resolver: Resolver = resolveCommitTarget as unknown as Resolver,
): Classification {
  const r = (resolver as (...a: unknown[]) => ReturnType<Resolver>)(command, sessionCwd, selfRoot, noAliases);
  return {
    isCommit: r.isCommit,
    repoRoot: r.repoRoot,
    advisory: r.advisory ?? null,
    repoRoots: Array.isArray(r.repoRoots) ? r.repoRoots : r.repoRoot === null ? [] : [r.repoRoot],
    unplaced: r.unplaced === true,
  };
}

// ---------------------------------------------------------------------------
// AC-STE-615.7 — the PR legs.
// ---------------------------------------------------------------------------

/**
 * THE RETIRED MATCHER, restated verbatim from the hook it was deleted from
 * (`templates/hooks/_lib/hooks/pre-pr-spec-review.ts:16` at `ff41e4e4`):
 *
 *   if (!/^gh pr create\b/.test(cmd)) { ...permit... }
 *
 * It is copied rather than imported because the line no longer exists to import:
 * this FR is what removes it. A replay that asked the NEW code for the OLD
 * answer would compare the resolver with itself and measure nothing.
 */
export const RETIRED_PR_ANCHOR = /^gh pr create\b/;

/** The part of a PR resolver's answer the replay compares. */
export interface PrClassification {
  isPr: boolean;
  repoRoot: string | null;
  repoRoots: string[];
  /** The known-foreign slug, verbatim, or null. */
  foreign: string | null;
  /** Non-null exactly when the target could not be determined. */
  unresolved: string | null;
}

/**
 * `git remote -v` per checkout, asked at most ONCE per root.
 *
 * The corpus names the same handful of checkouts thousands of times over, and
 * the listing is the only spawn the PR resolver makes. Without the memo a
 * single pass would fork git once per slug-bearing command; with it the spawn
 * count is bounded by the number of distinct roots, which is small.
 *
 * A root that does not exist on this machine answers `null` — ignorance, not an
 * empty remote list — so it lands in `unresolved`, never in `known-foreign`.
 */
function memoisedRemotes(): (root: string) => string[] | null {
  const seen = new Map<string, string[] | null>();
  return (root) => {
    if (!seen.has(root)) seen.set(root, gitRemotesOf(root));
    return seen.get(root) ?? null;
  };
}

/** Classify one command through the post-change PR resolver. */
export function classifyPrCommand(
  command: string,
  sessionCwd = "/",
  remotes: (root: string) => string[] | null = gitRemotesOf,
): PrClassification {
  const t = resolvePrTargetFromPayload(
    { cwd: sessionCwd, tool_input: { command } },
    selfRoot,
    remotes,
  );
  return {
    isPr: t.isPr,
    repoRoot: t.repoRoot,
    repoRoots: t.repoRoots,
    foreign: t.foreign,
    unresolved: t.unresolved,
  };
}

/** Load the base commit's resolver via `git archive`. Returns it plus a cleanup. */
export async function loadBaseResolver(sha: string): Promise<{ resolver: Resolver; cleanup: () => void }> {
  const top = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: import.meta.dir, encoding: "utf8" });
  if (top.status !== 0) throw new Error("not inside a git checkout");
  const repo = top.stdout.trim();
  const dir = mkdtempSync(join(tmpdir(), "ste601-replay-base-"));
  const cleanup = () => rmSync(dir, { recursive: true, force: true });
  const archive = spawnSync("git", ["-C", repo, "archive", "--format=tar", sha, RESOLVER_DIR], {
    maxBuffer: 256 * 1024 * 1024,
  });
  if (archive.status !== 0) {
    cleanup();
    throw new Error(`git archive ${sha} failed: ${archive.stderr?.toString() ?? ""}`);
  }
  mkdirSync(dir, { recursive: true });
  const untar = spawnSync("tar", ["-x", "-C", dir], { input: archive.stdout });
  if (untar.status !== 0) {
    cleanup();
    throw new Error(`tar -x failed: ${untar.stderr?.toString() ?? ""}`);
  }
  const mod = (await import(join(dir, RESOLVER_DIR, "commit_target_repo.ts"))) as { resolveCommitTarget: Resolver };
  return { resolver: mod.resolveCommitTarget, cleanup };
}

function* jsonlFiles(dir: string): Generator<string> {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* jsonlFiles(p);
    else if (e.isFile() && e.name.endsWith(".jsonl")) yield p;
  }
}

/** Distinct Bash commands (first-seen session cwd kept) from one jsonl, read line by line. */
async function collectCommands(file: string, into: Map<string, string>): Promise<void> {
  const rl = createInterface({ input: createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.includes('"tool_use"') || !line.includes('"Bash"')) continue;
    let obj: { cwd?: unknown; message?: { content?: unknown } };
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    const content = obj.message?.content;
    if (!Array.isArray(content)) continue;
    const cwd = typeof obj.cwd === "string" && isAbsolute(obj.cwd) ? obj.cwd : "/";
    for (const c of content as Array<{ type?: unknown; name?: unknown; input?: { command?: unknown } }>) {
      if (c?.type !== "tool_use" || c.name !== "Bash") continue;
      const cmd = c.input?.command;
      if (typeof cmd === "string" && cmd.length > 0 && !into.has(cmd)) into.set(cmd, cwd);
    }
  }
}

/** Per-skill tallies of Skill calls in the corpus (AC-STE-614.15, third count). */
export type SkillCallTally = Record<string, { calls: number; errored: number }>;

export function emptyTally(): SkillCallTally {
  const t: SkillCallTally = {};
  for (const s of GATE_SKILLS) t[s] = { calls: 0, errored: 0 };
  return t;
}

/**
 * Tally one transcript's gate-skill Skill calls and how many were retired by an
 * `is_error: true` result, using the pairing rule named in this file's header.
 *
 * Pairing is per FILE: a `tool_result` belongs to the `tool_use` whose `id` it
 * carries, and the two sit on different lines of the same transcript. A call
 * with no `id` is unpairable and so can never be counted as errored.
 */
async function tallySkillCalls(file: string, into: SkillCallTally): Promise<void> {
  const rl = createInterface({ input: createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
  const callsById: Array<{ id: string | null; skill: string }> = [];
  const erroredIds = new Set<string>();
  for await (const line of rl) {
    if (!line.includes('"tool_use"') && !line.includes('"tool_result"')) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      continue; // a truncated line decides nothing, exactly as the guard does
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const blocks: Array<Record<string, unknown>> = [raw as Record<string, unknown>];
    const content = (raw as { message?: { content?: unknown } }).message?.content;
    if (Array.isArray(content)) {
      for (const b of content) if (b !== null && typeof b === "object" && !Array.isArray(b)) blocks.push(b as Record<string, unknown>);
    }
    for (const block of blocks) {
      const input = block.input as { skill?: unknown } | undefined;
      if (
        block.type === "tool_use" &&
        block.name === "Skill" &&
        input !== null &&
        typeof input === "object" &&
        typeof input?.skill === "string" &&
        (GATE_SKILLS as readonly string[]).includes(input.skill)
      ) {
        const id = typeof block.id === "string" && block.id !== "" ? block.id : null;
        callsById.push({ id, skill: input.skill });
      } else if (block.type === "tool_result" && block.is_error === true && typeof block.tool_use_id === "string") {
        erroredIds.add(block.tool_use_id);
      }
    }
  }
  for (const call of callsById) {
    const slot = into[call.skill]!;
    slot.calls++;
    if (call.id !== null && erroredIds.has(call.id)) slot.errored++;
  }
}

function argValue(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  if (i >= 0) return argv[i + 1];
  const eq = argv.find((a) => a.startsWith(`${flag}=`));
  return eq?.slice(flag.length + 1);
}

function printList(title: string, cmds: string[]): void {
  console.log(`\n## ${title} (${cmds.length})`);
  for (const c of cmds) console.log(`- ${JSON.stringify(c)}`);
}

/**
 * AC-STE-615.7 — the PR legs over an already-collected corpus.
 *
 * Deliberately NOT a second walk: it is handed the command map the one pass
 * already built, and it loads no base resolver, because the "before" side is a
 * three-token regex rather than a module.
 */
function reportPrOnly(commands: ReadonlyMap<string, string>, fileCount: number): void {
  const remotes = memoisedRemotes();
  let anchored = 0;
  let resolver = 0;
  let foreign = 0;
  let unresolved = 0;
  const newlyRecognised: string[] = [];
  const noLongerRecognised: string[] = [];
  const foreignCommands: string[] = [];
  const unresolvedCommands: string[] = [];

  for (const [cmd, cwd] of commands) {
    const before = RETIRED_PR_ANCHOR.test(cmd);
    const after = classifyPrCommand(cmd, cwd, remotes);
    if (before) anchored++;
    if (!after.isPr) {
      if (before) noLongerRecognised.push(cmd);
      continue;
    }
    resolver++;
    if (!before) newlyRecognised.push(cmd);
    // Foreign outranks unresolved in the resolver's own verdict, so the two
    // tallies here are disjoint for the same reason the hook's two legs are.
    if (after.foreign !== null) {
      foreign++;
      foreignCommands.push(cmd);
    } else if (after.unresolved !== null) {
      unresolved++;
      unresolvedCommands.push(cmd);
    }
  }

  console.log(
    `\n## AC-STE-615.7 (PR creation over the corpus)` +
      ` — ${commands.size} distinct commands, ${fileCount} transcript files`,
  );
  console.log(`anchored regex PR-creating: ${anchored}`);
  console.log(`resolver PR-creating: ${resolver}`);
  console.log(`newly recognised as PR creation: ${newlyRecognised.length}`);
  console.log(`no longer recognised as PR creation: ${noLongerRecognised.length}`);
  console.log(`known-foreign targets: ${foreign}`);
  console.log(`unresolved targets: ${unresolved}`);
  printList("newly recognised as PR creation", newlyRecognised);
  printList("no longer recognised as PR creation", noLongerRecognised);
  printList("known-foreign targets", foreignCommands);
  printList("unresolved targets", unresolvedCommands);
}

async function main(argv: string[]): Promise<number> {
  const prOnly = argv.includes("--pr-only");
  const base = argValue(argv, "--base") ?? DEFAULT_BASE_SHA;
  const configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
  const projects = resolve(configDir, "projects");

  const files = existsSync(projects) ? [...jsonlFiles(projects)] : [];
  console.log(`corpus: ${projects}`);
  console.log(`transcript files read: ${files.length}`);
  if (files.length === 0) {
    console.log("corpus empty, not measured");
    return 0;
  }

  const commands = new Map<string, string>();
  for (const f of files) await collectCommands(f, commands);
  console.log(`distinct commands: ${commands.size}`);

  if (prOnly) {
    reportPrOnly(commands, files.length);
    return 0;
  }

  const { resolver: baseResolver, cleanup } = await loadBaseResolver(base);
  try {
    let before = 0;
    let after = 0;
    const newlyRecognised: string[] = [];
    const newlyUnplaced: string[] = [];
    const newlyAdvised: string[] = [];
    // AC-STE-613.7 — resolution delta over commands commit-bearing on both sides.
    const newlyResolved: string[] = [];
    const targetChanged: string[] = [];
    const stillUnresolvable: string[] = [];
    // AC-STE-614.15 — the two command-side counts.
    let unresolvedLeg = 0;
    const multiCheckout: string[] = [];
    for (const [cmd, cwd] of commands) {
      const b = classifyCommand(cmd, cwd, baseResolver);
      const a = classifyCommand(cmd, cwd);
      if (b.isCommit) before++;
      if (a.isCommit) after++;
      if (a.isCommit && !b.isCommit) newlyRecognised.push(cmd);
      if (a.isCommit && a.repoRoot === null && !(b.isCommit && b.repoRoot === null)) newlyUnplaced.push(cmd);
      if (a.advisory !== null && b.advisory === null) newlyAdvised.push(cmd);
      if (a.isCommit && b.isCommit) {
        if (b.repoRoot === null && a.repoRoot !== null) newlyResolved.push(cmd);
        else if (b.repoRoot !== null && a.repoRoot !== null && a.repoRoot !== b.repoRoot) targetChanged.push(cmd);
      }
      if (a.isCommit && a.repoRoot === null) stillUnresolvable.push(cmd);
      // AC-STE-614.15 — the exit-1 Reminder leg and the several-checkouts leg,
      // both read off the POST-change resolver alone.
      //
      // The Reminder leg is `unplaced`, NOT `repoRoot === null`: a null root is
      // also what a fully resolved MULTI-checkout command carries (it has
      // `repoRoots`, and the gate refuses it by name rather than reminding),
      // and what a directory that resolved into no checkout carries (exit 0,
      // silent). Counting nulls made the recorded figure a superset of the
      // multi-checkout figure beside it.
      if (a.isCommit && a.unplaced) unresolvedLeg++;
      if (a.isCommit && a.repoRoots.length > 1) multiCheckout.push(cmd);
    }
    console.log(`base: ${base}`);
    console.log(`commit-bearing before: ${before}`);
    console.log(`commit-bearing after: ${after}`);
    console.log(`newly recognised: ${newlyRecognised.length}`);
    console.log(`newly unplaced: ${newlyUnplaced.length}`);
    console.log(`newly advised: ${newlyAdvised.length}`);
    printList("newly recognised", newlyRecognised);
    printList("newly unplaced", newlyUnplaced);
    printList("newly advised", newlyAdvised);
    console.log(`\nnewly resolved: ${newlyResolved.length}`);
    console.log(`target changed: ${targetChanged.length}`);
    console.log(`still unresolvable after: ${stillUnresolvable.length}`);
    printList("newly resolved", newlyResolved);
    printList("target changed", targetChanged);

    // --- AC-STE-614.15 ------------------------------------------------------
    console.log(`\n## AC-STE-614.15 (out of ${commands.size} distinct commands, ${files.length} transcript files)`);
    console.log(`commit-bearing in the unresolved leg (exit-1 Reminder): ${unresolvedLeg}`);
    console.log(`commit-bearing naming several checkouts: ${multiCheckout.length}`);
    printList("several checkouts", multiCheckout);

    const tally = emptyTally();
    for (const f of files) await tallySkillCalls(f, tally);
    let calls = 0;
    let errored = 0;
    for (const s of GATE_SKILLS) {
      const slot = tally[s]!;
      calls += slot.calls;
      errored += slot.errored;
      console.log(`${s}: ${slot.calls} Skill tool_use, ${slot.errored} with an is_error result`);
    }
    console.log(`gate-skill Skill calls: ${calls}, of which errored/denied: ${errored}`);
  } finally {
    cleanup();
  }
  return 0;
}

if (import.meta.main) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(String(err instanceof Error ? err.message : err));
      process.exit(1);
    },
  );
}
