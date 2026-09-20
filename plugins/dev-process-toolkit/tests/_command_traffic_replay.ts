// AC-STE-601.14 — real-traffic replay (the M_4df444 method). UNCOLLECTED helper:
// the file name does not end in `.test.ts`, so `bun test` never runs it.
//
//   bun run tests/_command_traffic_replay.ts [--base <sha>]
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

import { spawnSync } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { resolveCommitTarget } from "../adapters/_shared/src/commit_target_repo";

export const DEFAULT_BASE_SHA = "ff41e4e42506cd119bf2b8b2866f9654fc113aec";
const RESOLVER_DIR = "plugins/dev-process-toolkit/adapters/_shared/src";

/** The part of a resolver's answer the replay compares. */
export interface Classification {
  isCommit: boolean;
  repoRoot: string | null;
  advisory: string | null;
}

type Resolver = (command: string, sessionCwd: string, roots: (dir: string) => string | null, ...rest: never[]) => {
  isCommit: boolean;
  repoRoot: string | null;
  advisory?: string | null;
};

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
  return { isCommit: r.isCommit, repoRoot: r.repoRoot, advisory: r.advisory ?? null };
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

async function main(argv: string[]): Promise<number> {
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
