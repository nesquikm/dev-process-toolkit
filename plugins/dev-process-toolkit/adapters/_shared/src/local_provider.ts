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
import type { FRMetadata, FRSpec, LockResult, Provider, SyncResult } from "./provider";
import { mintId as mintIdImpl } from "./ulid";

export interface LocalProviderOptions {
  repoRoot: string;
  specsDir?: string;
  locksDir?: string;
  now?: () => string;
  gitUserEmail?: string;
}

function parseFrontmatter(md: string): Record<string, unknown> {
  const match = /^---\n([\s\S]*?)\n---/m.exec(md);
  if (!match) throw new Error("local_provider: FR file has no YAML frontmatter");
  const lines = match[1]!.split("\n");
  const out: Record<string, unknown> = {};
  let currentKey: string | null = null;
  for (const raw of lines) {
    if (raw.length === 0) continue;
    if (raw.startsWith("  ") && currentKey !== null) {
      // nested map (tracker: {key: val})
      const inner = raw.trim();
      const c = inner.indexOf(":");
      if (c < 0) continue;
      const k = inner.slice(0, c).trim();
      const v = inner.slice(c + 1).trim();
      const map = out[currentKey] as Record<string, unknown> | undefined;
      if (map && typeof map === "object") {
        map[k] = v === "null" ? null : v;
      }
      continue;
    }
    const c = raw.indexOf(":");
    if (c < 0) continue;
    const key = raw.slice(0, c).trim();
    const rest = raw.slice(c + 1).trim();
    if (rest === "" || rest === "{}") {
      out[key] = rest === "{}" ? {} : null;
      currentKey = rest === "" ? key : null;
    } else if (rest === "null") {
      out[key] = null;
      currentKey = null;
    } else {
      out[key] = rest;
      currentKey = null;
    }
  }
  return out;
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

  constructor(options: LocalProviderOptions) {
    this.repoRoot = options.repoRoot;
    this.specsDir = options.specsDir ?? join(options.repoRoot, "specs");
    this.locksDir = options.locksDir ?? join(options.repoRoot, ".dpt-locks");
    this.now = options.now ?? (() => new Date().toISOString());
    this.gitUserEmail = options.gitUserEmail ?? "";
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
}

function extractBranch(lockContent: string): string | null {
  const m = /^branch:\s*(.+)$/m.exec(lockContent);
  return m ? m[1]!.trim() : null;
}
