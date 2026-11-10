// STE-731 (M_b2fdc0) — shared fixture: lock commits carry only the lock.
//
// Every leg builds a throwaway git repository with fake ids and a locally-set
// fake author, stages "foreign" changes (paths that are not lock paths) in four
// shapes — added, modified, deleted, renamed — then drives ONE LocalProvider
// lock method and reads the outcome from git plumbing only:
//
//   - `git rev-list <before>..HEAD`          the commits the call created
//   - `git diff-tree --no-commit-id --name-only -r <sha>`   each commit's paths
//   - `git ls-files -s -- <path>`            the index entry (mode, blob) of a
//                                            foreign path, before and after
//   - `git diff --cached --name-status`      what is still staged
//
// The provider CLASS is a parameter (`ctor`) so the mutation battery can drive
// the very same legs against a mutated copy of local_provider.ts.

import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LocalProvider } from "../adapters/_shared/src/local_provider";

export const PLUGIN_ROOT = join(import.meta.dir, "..");

export type ProviderCtor = new (opts: { repoRoot: string; skipFetch?: boolean; gitUserEmail?: string }) => {
  claimLock(id: string, branch: string): Promise<{ kind: string }>;
  releaseLock(id: string): Promise<string>;
  cleanupStaleLocks(o?: { mainBranch?: string }): Promise<{ count: number; ids: string[] }>;
};

export const REAL_CTOR = LocalProvider as unknown as ProviderCtor;

/** Fake ids only — this is a public repository. */
export const LOCK_ID = "fr_01JZZZZZZZZZZZZZZZZZTEST1";
export const STALE_A = "fr_01JZZZZZZZZZZZZZZZZZSTLA1";
export const STALE_B = "fr_01JZZZZZZZZZZZZZZZZZSTLB1";
export const BRANCH = "main";

export type Method = "claim" | "release" | "cleanup";
export type Shape = "added" | "modified" | "deleted" | "renamed";
export const METHODS: readonly Method[] = ["claim", "release", "cleanup"];
export const SHAPES: readonly Shape[] = ["added", "modified", "deleted", "renamed"];

const temps: string[] = [];
export function cleanupTemps(): void {
  for (const t of temps.splice(0)) rmSync(t, { recursive: true, force: true });
}
export function tempDir(label: string): string {
  const d = mkdtempSync(join(tmpdir(), `ste731-${label}-`));
  temps.push(d);
  return d;
}

export interface GitRun {
  exitCode: number;
  stdout: string;
  stderr: string;
}
export function gitTry(cwd: string, ...args: string[]): GitRun {
  const p = Bun.spawnSync({ cmd: ["git", ...args], cwd, stdout: "pipe", stderr: "pipe" });
  return { exitCode: p.exitCode ?? -1, stdout: p.stdout.toString(), stderr: p.stderr.toString() };
}
export function git(cwd: string, ...args: string[]): string {
  const r = gitTry(cwd, ...args);
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${r.stderr || r.stdout}`);
  return r.stdout.trim();
}

export function lockRel(id: string): string {
  return `.dpt/locks/${id}`;
}

/** The lock paths a method's commit must carry, and nothing else. */
export function lockPathsFor(method: Method): string[] {
  return method === "cleanup" ? [lockRel(STALE_A), lockRel(STALE_B)].sort() : [lockRel(LOCK_ID)];
}

/** Every foreign path a shape touches (both sides of a rename). */
export function foreignPathsFor(shapes: readonly Shape[]): string[] {
  const out: string[] = [];
  for (const s of shapes) {
    if (s === "added") out.push("src/added.txt");
    if (s === "modified") out.push("src/modified.txt");
    if (s === "deleted") out.push("src/deleted.txt");
    if (s === "renamed") out.push("src/renamed-from.txt", "src/renamed-to.txt");
  }
  return out;
}

/**
 * A repository on `main` with one seed commit holding the files the foreign
 * shapes act on, plus (for release) a claimed lock and (for cleanup) two locks
 * whose branches do not exist — i.e. stale by `reason: "deleted"`.
 */
export async function makeRepo(ctor: ProviderCtor, method: Method, label: string): Promise<string> {
  const root = tempDir(`${method}-${label}`);
  git(root, "init", "--quiet");
  git(root, "symbolic-ref", "HEAD", `refs/heads/${BRANCH}`);
  git(root, "config", "user.email", "fixture@example.invalid");
  git(root, "config", "user.name", "Fixture Author");
  git(root, "config", "commit.gpgsign", "false");
  git(root, "config", "core.hooksPath", join(root, ".git", "hooks"));
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "modified.txt"), "seed modified\n");
  writeFileSync(join(root, "src", "deleted.txt"), "seed deleted\n");
  writeFileSync(join(root, "src", "renamed-from.txt"), "seed renamed — long enough to be detected as a rename\n".repeat(4));
  writeFileSync(join(root, "README.md"), "fixture\n");
  if (method === "cleanup") {
    mkdirSync(join(root, ".dpt", "locks"), { recursive: true });
    for (const [id, br] of [[STALE_A, "feat/gone-a"], [STALE_B, "feat/gone-b"]] as const) {
      writeFileSync(join(root, ".dpt", "locks", id), `ulid: ${id}\nbranch: ${br}\nclaimed_at: 2026-01-01T00:00:00Z\nclaimer: fixture@example.invalid\n`);
    }
  }
  git(root, "add", "-A");
  git(root, "commit", "--quiet", "-m", "chore: seed");
  if (method === "release") {
    const r = await new ctor({ repoRoot: root, skipFetch: true, gitUserEmail: "fixture@example.invalid" }).claimLock(LOCK_ID, BRANCH);
    if (r.kind !== "claimed") throw new Error(`fixture claim did not claim: ${JSON.stringify(r)}`);
  }
  return root;
}

/** Stage the foreign changes, in the requested shapes. */
export function stageForeign(root: string, shapes: readonly Shape[]): void {
  for (const s of shapes) {
    if (s === "added") {
      writeFileSync(join(root, "src", "added.txt"), "feature code that a refused commit left staged\n");
      git(root, "add", "--", "src/added.txt");
    }
    if (s === "modified") {
      writeFileSync(join(root, "src", "modified.txt"), "seed modified\nplus a staged edit\n");
      git(root, "add", "--", "src/modified.txt");
    }
    if (s === "deleted") git(root, "rm", "-q", "--", "src/deleted.txt");
    if (s === "renamed") git(root, "mv", "--", "src/renamed-from.txt", "src/renamed-to.txt");
  }
}

/** Each path's index entry (`<mode> <blob> <stage>`) or `absent`. */
export function indexEntries(root: string, paths: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of paths) {
    const line = git(root, "ls-files", "-s", "--", p);
    out[p] = line === "" ? "absent" : line.split("\t")[0]!;
  }
  return out;
}

/** The staged name-status lines whose path is not a lock path. */
export function stagedForeign(root: string): string[] {
  return git(root, "diff", "--cached", "--name-status", "--no-renames")
    .split("\n")
    .filter(Boolean)
    .filter((l) => !l.split("\t").slice(1).some((p) => p.startsWith(".dpt/locks/")))
    .sort();
}

export function head(root: string): string {
  return git(root, "rev-parse", "HEAD");
}

export function commitsSince(root: string, before: string): string[] {
  const out = git(root, "rev-list", `${before}..HEAD`);
  return out === "" ? [] : out.split("\n");
}

export function commitPaths(root: string, sha: string): string[] {
  return git(root, "diff-tree", "--no-commit-id", "--name-only", "-r", sha).split("\n").filter(Boolean).sort();
}

export async function drive(ctor: ProviderCtor, method: Method, root: string): Promise<unknown> {
  const p = new ctor({ repoRoot: root, skipFetch: true, gitUserEmail: "fixture@example.invalid" });
  if (method === "claim") return p.claimLock(LOCK_ID, BRANCH);
  if (method === "release") return p.releaseLock(LOCK_ID);
  return p.cleanupStaleLocks({ mainBranch: BRANCH });
}

export interface Observation {
  root: string;
  method: Method;
  shapes: Shape[];
  /** Commits the call created. */
  created: string[];
  /** HEAD's changed paths (`diff-tree`), sorted. */
  headPaths: string[];
  /** Foreign index entries before / after. */
  indexBefore: Record<string, string>;
  indexAfter: Record<string, string>;
  /** Foreign staged name-status before / after. */
  stagedBefore: string[];
  stagedAfter: string[];
  /** Foreign paths found in any created commit. */
  leaked: string[];
  threw: string | null;
}

/** Build the repo, stage the shapes, drive the method once, observe. */
export async function observe(ctor: ProviderCtor, method: Method, shapes: readonly Shape[], label: string, beforeDrive?: (root: string) => void): Promise<Observation> {
  const root = await makeRepo(ctor, method, label);
  stageForeign(root, shapes);
  const foreign = foreignPathsFor(shapes);
  const indexBefore = indexEntries(root, foreign);
  const stagedBefore = stagedForeign(root);
  beforeDrive?.(root);
  const before = head(root);
  let threw: string | null = null;
  try {
    await drive(ctor, method, root);
  } catch (e) {
    threw = e instanceof Error ? e.message : String(e);
  }
  const created = commitsSince(root, before);
  const leaked = [...new Set(created.flatMap((c) => commitPaths(root, c)).filter((p) => foreign.includes(p)))].sort();
  return {
    root,
    method,
    shapes: [...shapes],
    created,
    headPaths: created.length > 0 ? commitPaths(root, head(root)) : [],
    indexBefore,
    indexAfter: indexEntries(root, foreign),
    stagedBefore,
    stagedAfter: stagedForeign(root),
    leaked,
    threw,
  };
}

/** null when AC .1 + .2 hold for this observation, else why not. */
export function onlyLockProblem(o: Observation): string | null {
  if (o.threw !== null) return `${o.method} threw: ${o.threw}`;
  if (o.created.length !== 1) return `${o.method} created ${o.created.length} commits, expected 1`;
  const want = lockPathsFor(o.method);
  if (JSON.stringify(o.headPaths) !== JSON.stringify(want)) return `${o.method} commit paths ${JSON.stringify(o.headPaths)} !== lock paths ${JSON.stringify(want)}`;
  if (o.leaked.length > 0) return `${o.method} committed foreign paths ${JSON.stringify(o.leaked)}`;
  if (JSON.stringify(o.indexAfter) !== JSON.stringify(o.indexBefore)) return `${o.method} changed foreign index entries ${JSON.stringify(o.indexBefore)} -> ${JSON.stringify(o.indexAfter)}`;
  if (JSON.stringify(o.stagedAfter) !== JSON.stringify(o.stagedBefore)) return `${o.method} changed what is staged ${JSON.stringify(o.stagedBefore)} -> ${JSON.stringify(o.stagedAfter)}`;
  return null;
}

/** A pre-commit hook that refuses every commit. */
export function installRejectingPreCommit(root: string): void {
  const hooks = join(root, ".git", "hooks");
  mkdirSync(hooks, { recursive: true });
  writeFileSync(join(hooks, "pre-commit"), "#!/bin/sh\necho 'ste731 fixture: pre-commit refuses' >&2\nexit 1\n");
  chmodSync(join(hooks, "pre-commit"), 0o755);
}
