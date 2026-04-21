// LocalProvider — tracker-less Provider implementation (FR-43, FR-46).
//
// Behavior:
//   - mintId(): delegates to ulid module (AC-43.5 — always local, offline-safe)
//   - sync(): no-op returning skipped (AC-43.2)
//   - getUrl(): always null
//   - getMetadata(id): reads specs/frs/<id>.md or specs/frs/archive/<id>.md
//   - claimLock(id, branch): writes .dpt-locks/<id> and commits; returns
//       claimed | already-ours. The remote-scan (git fetch + cross-branch
//       contains) that returns taken-elsewhere lives in Phase F; this base
//       implementation handles the local case.
//   - releaseLock(id): deletes and commits; idempotent on missing file.

import { $ } from "bun";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "./frontmatter";
import type { FRMetadata, FRSpec, LockResult, Provider, SyncResult } from "./provider";
import { mintId as mintIdImpl } from "./ulid";

export interface LocalProviderOptions {
  repoRoot: string;
  specsDir?: string;
  locksDir?: string;
  now?: () => string;
  gitUserEmail?: string;
  /**
   * Skip `git fetch --all` before remote-branch lock scan. Mirrors the
   * DPT_SKIP_FETCH=1 env var (AC-46.7, NFR-16). When true, only local
   * refs are considered; a lock claimed on a remote that hasn't been
   * fetched yet will be missed.
   */
  skipFetch?: boolean;
}

function getFrPath(specsDir: string, id: string): string {
  const active = join(specsDir, "frs", `${id}.md`);
  if (existsSync(active)) return active;
  const archived = join(specsDir, "frs", "archive", `${id}.md`);
  if (existsSync(archived)) return archived;
  throw new Error(`local_provider: FR ${id} not found under ${specsDir}/frs/ or /archive/`);
}

export class LocalProvider implements Provider {
  private readonly repoRoot: string;
  private readonly specsDir: string;
  private readonly locksDir: string;
  private readonly now: () => string;
  private readonly gitUserEmail: string;
  private readonly skipFetch: boolean;

  constructor(options: LocalProviderOptions) {
    this.repoRoot = options.repoRoot;
    this.specsDir = options.specsDir ?? join(options.repoRoot, "specs");
    this.locksDir = options.locksDir ?? join(options.repoRoot, ".dpt-locks");
    this.now = options.now ?? (() => new Date().toISOString());
    this.gitUserEmail = options.gitUserEmail ?? "";
    this.skipFetch = options.skipFetch ?? process.env["DPT_SKIP_FETCH"] === "1";
  }

  mintId(): string {
    return mintIdImpl();
  }

  async getMetadata(id: string): Promise<FRMetadata> {
    const path = getFrPath(this.specsDir, id);
    const text = readFileSync(path, "utf-8");
    const fm = parseFrontmatter(text);
    const tracker = (typeof fm["tracker"] === "object" && fm["tracker"] !== null ? fm["tracker"] : {}) as Record<string, string | null>;
    return {
      id: String(fm["id"] ?? id),
      title: String(fm["title"] ?? ""),
      milestone: String(fm["milestone"] ?? ""),
      status: (String(fm["status"] ?? "active") as FRMetadata["status"]),
      tracker,
      inFlightBranch: null,
      assignee: null,
    };
  }

  async sync(_spec: FRSpec): Promise<SyncResult> {
    return { kind: "skipped", updated: [], conflicts: [], message: "No tracker configured" };
  }

  getUrl(_id: string, _trackerKey?: string): string | null {
    return null;
  }

  async claimLock(id: string, branch: string): Promise<LockResult> {
    const lockPath = join(this.locksDir, id);

    // Remote-scan pre-check (AC-46.2, FR-46).
    // Skipped when DPT_SKIP_FETCH=1 (AC-46.7, NFR-16 escape hatch).
    if (!this.skipFetch) {
      try {
        await $`git fetch --all --quiet`.cwd(this.repoRoot).quiet();
      } catch {
        // If fetch fails (offline, no remotes), fall through to local-only check
        // per the best-effort-by-design contract (AC-46.6).
      }
    }
    const remoteBranch = await this.findRemoteBranchWithLock(id);
    if (remoteBranch !== null && remoteBranch !== branch && !remoteBranch.endsWith(`/${branch}`)) {
      return {
        kind: "taken-elsewhere",
        branch: remoteBranch,
        message: `Lock present on remote branch ${remoteBranch}`,
      };
    }

    if (existsSync(lockPath)) {
      const existing = readFileSync(lockPath, "utf-8");
      if (existing.includes(`branch: ${branch}`)) {
        return { kind: "already-ours", branch, message: `Lock already held on ${branch}` };
      }
      return {
        kind: "taken-elsewhere",
        branch: extractBranch(existing),
        message: `Lock held on ${extractBranch(existing) ?? "<unknown>"}`,
      };
    }
    mkdirSync(this.locksDir, { recursive: true });
    const claimer = this.gitUserEmail || (await this.readGitUserEmail());
    const content = `ulid: ${id}\nbranch: ${branch}\nclaimed_at: ${this.now()}\nclaimer: ${claimer}\n`;
    writeFileSync(lockPath, content);
    await $`git add ${lockPath}`.cwd(this.repoRoot).quiet();
    await $`git commit -q -m ${`chore(locks): claim lock for ${id} on ${branch}`}`.cwd(this.repoRoot).quiet();
    return { kind: "claimed", branch, message: `Lock claimed on ${branch}` };
  }

  /**
   * Returns the first remote branch (e.g., "origin/feat/other") that
   * contains .dpt-locks/<ulid>, or null if none do.
   * Implementation: `git ls-tree -r <branch> .dpt-locks/<ulid>` per remote
   * branch. `git branch -r --contains <path>` is not a valid git command
   * (contains takes a commit, not a path), so we walk tips instead.
   */
  private async findRemoteBranchWithLock(id: string): Promise<string | null> {
    const refs = await this.safeGit("for-each-ref", "--format=%(refname:short)", "refs/remotes/");
    if (refs.length === 0) return null;
    for (const branch of refs.split("\n").map((s) => s.trim()).filter(Boolean)) {
      if (branch.endsWith("/HEAD")) continue;
      const out = await this.safeGit("ls-tree", "-r", "--name-only", branch, "--", `.dpt-locks/${id}`);
      if (out.length > 0) return branch;
    }
    return null;
  }

  async releaseLock(id: string): Promise<void> {
    const lockPath = join(this.locksDir, id);
    if (!existsSync(lockPath)) return;
    await $`git rm -q ${lockPath}`.cwd(this.repoRoot).quiet();
    await $`git commit -q -m ${`chore(locks): release lock for ${id}`}`.cwd(this.repoRoot).quiet();
  }

  private async readGitUserEmail(): Promise<string> {
    try {
      const out = await $`git config user.email`.cwd(this.repoRoot).quiet().text();
      return out.trim();
    } catch {
      return "";
    }
  }

  /**
   * Find .dpt-locks/<ulid> files on local branches whose branch is merged
   * into main OR deleted. Returns one entry per stale lock; caller applies
   * the cleanup action. (AC-46.5)
   */
  async findStaleLocks(options: { mainBranch?: string } = {}): Promise<Array<{ id: string; branch: string; reason: "merged" | "deleted" }>> {
    const mainBranch = options.mainBranch ?? "main";
    if (!existsSync(this.locksDir)) return [];
    const stale: Array<{ id: string; branch: string; reason: "merged" | "deleted" }> = [];
    const entries = require("node:fs").readdirSync(this.locksDir).filter((f: string) => !f.startsWith("."));
    const mergedBranchesOutput = await this.safeGit("branch", "--merged", mainBranch);
    const mergedBranches = mergedBranchesOutput
      .split("\n")
      .map((s) => s.replace(/^\*?\s+/, "").trim())
      .filter(Boolean);
    const allBranchesOutput = await this.safeGit("branch", "--list");
    const allBranches = allBranchesOutput
      .split("\n")
      .map((s) => s.replace(/^\*?\s+/, "").trim())
      .filter(Boolean);
    for (const id of entries) {
      const content = readFileSync(join(this.locksDir, id), "utf-8");
      const branch = extractBranch(content);
      if (branch === null) continue;
      if (!allBranches.includes(branch)) {
        stale.push({ id, branch, reason: "deleted" });
        continue;
      }
      if (branch !== mainBranch && mergedBranches.includes(branch)) {
        stale.push({ id, branch, reason: "merged" });
      }
    }
    return stale;
  }

  /**
   * Delete all stale locks in a single git commit. Reports the count.
   */
  async cleanupStaleLocks(options: { mainBranch?: string } = {}): Promise<{ count: number; ids: string[] }> {
    const stale = await this.findStaleLocks(options);
    if (stale.length === 0) return { count: 0, ids: [] };
    for (const { id } of stale) {
      await $`git rm -q ${join(this.locksDir, id)}`.cwd(this.repoRoot).quiet();
    }
    await $`git commit -q -m ${`chore(locks): clean up ${stale.length} stale lock${stale.length === 1 ? "" : "s"}`}`.cwd(this.repoRoot).quiet();
    return { count: stale.length, ids: stale.map((s) => s.id) };
  }

  private async safeGit(...args: string[]): Promise<string> {
    try {
      const proc = Bun.spawnSync({ cmd: ["git", ...args], cwd: this.repoRoot });
      if (proc.exitCode !== 0) return "";
      return new TextDecoder().decode(proc.stdout).trim();
    } catch {
      return "";
    }
  }
}

function extractBranch(lockContent: string): string | null {
  const m = /^branch:\s*(.+)$/m.exec(lockContent);
  return m ? m[1]!.trim() : null;
}
