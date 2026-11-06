// STE-715 (M_7bc805) — the gate reuse key.
//
// `gateReuseKey(root)` names the exact input a gate graded: the commit, the
// uncommitted changes (tracked and untracked), the toolchain and toolkit
// versions, the `## Key Commands` section of CLAUDE.md and the settings file
// bytes. Every field is computed on the spot; nothing is cached.
//
// `gateReuseKey` is the toolkit's only reuse-key function. `worktreeDigest` is
// exported for STE-716.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { runningDptVersion } from "./dpt_version";
import { offendingPaths } from "./skip_baseline";

export interface GateReuseKey {
  v: 1;
  head: string | null;
  clean: boolean;
  worktree: string;
  bun: string;
  plugin: string;
  commands: string;
  settings: string;
}

export interface GateReuseKeyOptions {
  /** Overrides `Bun.version` (tests only). */
  bunVersion?: string;
  /** The plugin root whose manifest names the running toolkit version. */
  pluginRoot?: string;
}

const sha256Hex = (bytes: string | Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

function git(root: string, args: readonly string[]) {
  // `env` is passed, never left to default: under Bun an omitted `env` resolves
  // `git` against the PATH the process started with (HS-1 review).
  return spawnSync("git", ["-C", root, ...args], { encoding: "buffer", maxBuffer: 1024 * 1024 * 1024, env: process.env });
}

function gitRaw(root: string, args: readonly string[]): { status: number | null; stdout: Buffer } {
  const p = git(root, args);
  return { status: p.status, stdout: (p.stdout as Buffer) ?? Buffer.alloc(0) };
}

function gitOrThrow(root: string, args: readonly string[]): Buffer {
  const p = git(root, args);
  if (p.error) throw p.error;
  if (p.status !== 0) throw new Error(`git ${args.join(" ")} failed in ${root}: ${String(p.stderr)}`);
  return p.stdout as Buffer;
}

/** `git rev-parse HEAD`, or `null` on an unborn branch. */
function headOrNull(root: string): string | null {
  const p = gitRaw(root, ["rev-parse", "--verify", "-q", "HEAD"]);
  if (p.status !== 0) return null;
  const head = p.stdout.toString("utf-8").trim();
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

/** `sha256:` of the `## Key Commands` section (heading through the line before the next `## `), or `"absent"`. */
function commandsDigest(root: string): string {
  const file = join(root, "CLAUDE.md");
  if (!existsSync(file)) return "absent";
  const lines = readFileSync(file, "utf-8").split("\n");
  const start = lines.findIndex((l) => l === "## Key Commands");
  if (start < 0) return "absent";
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i]!.startsWith("## ")) {
      end = i;
      break;
    }
  }
  return `sha256:${sha256Hex(lines.slice(start, end).join("\n"))}`;
}

/** `sha256:` of `<root>/specs/settings.yaml` bytes, or `"absent"`. */
function settingsDigest(root: string): string {
  const file = join(root, "specs", "settings.yaml");
  if (!existsSync(file)) return "absent";
  return `sha256:${sha256Hex(readFileSync(file))}`;
}

export function gateReuseKey(root: string, options: GateReuseKeyOptions = {}): GateReuseKey {
  return {
    v: 1,
    head: headOrNull(root),
    clean: offendingPaths(root).length === 0,
    worktree: worktreeDigest(root),
    bun: options.bunVersion ?? Bun.version,
    plugin: runningDptVersion(options.pluginRoot),
    commands: commandsDigest(root),
    settings: settingsDigest(root),
  };
}

/** `sha256:` over the key serialised as JSON with sorted keys. */
export function reuseKeyDigest(key: GateReuseKey | Record<string, unknown>): string {
  const record = key as Record<string, unknown>;
  const sorted = Object.fromEntries(Object.keys(record).sort().map((k) => [k, record[k]]));
  return `sha256:${sha256Hex(JSON.stringify(sorted))}`;
}
