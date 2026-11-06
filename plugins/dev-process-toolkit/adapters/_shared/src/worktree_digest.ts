// STE-715 / STE-716 — the worktree digest.
//
// `worktreeDigest(root)` names the uncommitted changes of a checkout (tracked
// and untracked). It runs git and hashes untracked files; it reads no
// CLAUDE.md or settings bytes. It lives apart from `gate_reuse_key.ts` so the
// tool-call capture hook can load it without loading the reuse-key module;
// `gate_reuse_key.ts` re-exports it.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const sha256Hex = (bytes: string | Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

function git(root: string, args: readonly string[]) {
  // `env` is passed, never left to default: under Bun an omitted `env` resolves
  // `git` against the PATH the process started with (HS-1 review).
  return spawnSync("git", ["-C", root, ...args], { encoding: "buffer", maxBuffer: 1024 * 1024 * 1024, env: process.env });
}

function gitOrThrow(root: string, args: readonly string[]): Buffer {
  const p = git(root, args);
  if (p.error) throw p.error;
  if (p.status !== 0) throw new Error(`git ${args.join(" ")} failed in ${root}: ${String(p.stderr)}`);
  return p.stdout as Buffer;
}

/** `git rev-parse HEAD`, or `null` on an unborn branch. */
export function headOrNull(root: string): string | null {
  const p = git(root, ["rev-parse", "--verify", "-q", "HEAD"]);
  if (p.status !== 0) return null;
  const head = ((p.stdout as Buffer) ?? Buffer.alloc(0)).toString("utf-8").trim();
  return head.length > 0 ? head : null;
}

/**
 * `sha256:` over `git diff HEAD --binary --no-ext-diff` (`git diff --cached
 * --binary` on an unborn branch), then, for each untracked path of
 * `git ls-files --others --exclude-standard -z` in byte order, the path, a NUL,
 * and the sha256 hex of its content. Ignored files are outside the digest.
 */
export function worktreeDigest(root: string): string {
  const h = createHash("sha256");
  const unborn = headOrNull(root) === null;
  h.update(gitOrThrow(root, unborn ? ["diff", "--cached", "--binary"] : ["diff", "HEAD", "--binary", "--no-ext-diff"]));
  const others = gitOrThrow(root, ["ls-files", "--others", "--exclude-standard", "-z"])
    .toString("utf-8")
    .split("\0")
    .filter((p) => p.length > 0)
    .sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  for (const p of others) {
    h.update(p);
    h.update("\0");
    h.update(sha256Hex(readFileSync(join(root, p))));
  }
  return `sha256:${h.digest("hex")}`;
}
