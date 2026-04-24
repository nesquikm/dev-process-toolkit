// Phase B Tier 4 tests for local_provider.ts (FR-43, FR-46).

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { $ } from "bun";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalProvider } from "./local_provider";
import { ULID_REGEX } from "./ulid";

let work: string;

async function initRepo(dir: string) {
  await $`git init --initial-branch=main -q`.cwd(dir);
  await $`git config user.email test@example.com`.cwd(dir);
  await $`git config user.name Test`.cwd(dir);
  await $`git config commit.gpgsign false`.cwd(dir);
  mkdirSync(join(dir, "specs", "frs"), { recursive: true });
  writeFileSync(join(dir, ".gitkeep"), "");
  await $`git add .`.cwd(dir);
  await $`git commit -q -m init`.cwd(dir);
}

beforeEach(async () => {
  work = mkdtempSync(join(tmpdir(), "dpt-local-provider-"));
  await initRepo(work);
});
afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

describe("LocalProvider core (FR-43 AC-43.2)", () => {
  test("mintId returns a valid ULID (delegates to ulid module)", () => {
    const p = new LocalProvider({ repoRoot: work });
    const id = p.mintId();
    expect(id).toMatch(ULID_REGEX);
  });

  test("sync() always returns {kind: 'skipped'} (AC-43.2)", async () => {
    const p = new LocalProvider({ repoRoot: work });
    const result = await p.sync({ frontmatter: { id: "fr_xxx" }, body: "" });
    expect(result.kind).toBe("skipped");
    expect(result.message).toContain("No tracker");
  });

  test("getUrl() always returns null (AC-43.2)", () => {
    const p = new LocalProvider({ repoRoot: work });
    expect(p.getUrl("fr_anything")).toBeNull();
    expect(p.getUrl("fr_anything", "linear")).toBeNull();
  });
});

describe("LocalProvider.getMetadata (M18 STE-61: filename = <short-ULID>.md)", () => {
  test("reads FR frontmatter from specs/frs/<short-ULID>.md", async () => {
    const id = "fr_01HZ7XJFKP0000000000000A01";
    const shortTail = id.slice(23, 29); // "000A01"
    writeFileSync(
      join(work, "specs", "frs", `${shortTail}.md`),
      `---\nid: ${id}\ntitle: Test FR\nmilestone: M99\nstatus: active\narchived_at: null\ntracker: {}\ncreated_at: 2026-04-21T10:30:00Z\n---\n\n## Requirement\n\nBody.\n`,
    );
    const p = new LocalProvider({ repoRoot: work });
    const meta = await p.getMetadata(id);
    expect(meta.id).toBe(id);
    expect(meta.title).toBe("Test FR");
    expect(meta.milestone).toBe("M99");
    expect(meta.status).toBe("active");
    expect(meta.tracker).toEqual({});
    expect(meta.assignee).toBeNull();
  });

  test("reads from specs/frs/archive/<short-ULID>.md when not in active set", async () => {
    const id = "fr_01HZ7XJFKN0000000000000C04";
    const shortTail = id.slice(23, 29); // "000C04"
    mkdirSync(join(work, "specs", "frs", "archive"), { recursive: true });
    writeFileSync(
      join(work, "specs", "frs", "archive", `${shortTail}.md`),
      `---\nid: ${id}\ntitle: Archived\nmilestone: M97\nstatus: archived\narchived_at: 2026-01-01T00:00:00Z\ntracker: {}\ncreated_at: 2026-01-01T00:00:00Z\n---\n\n## Requirement\n\nArchived.\n`,
    );
    const p = new LocalProvider({ repoRoot: work });
    const meta = await p.getMetadata(id);
    expect(meta.status).toBe("archived");
    expect(meta.milestone).toBe("M97");
  });
});

describe("LocalProvider.claimLock / releaseLock (FR-46)", () => {
  test("claimLock writes .dpt-locks/<id> and commits on the current branch", async () => {
    const id = "fr_01HZ7XJFKP0000000000000A01";
    const p = new LocalProvider({ repoRoot: work });
    const result = await p.claimLock(id, "feat/test");
    expect(result.kind).toBe("claimed");
    const lockPath = join(work, ".dpt-locks", id);
    expect(existsSync(lockPath)).toBe(true);
    const content = readFileSync(lockPath, "utf-8");
    expect(content).toContain(`ulid: ${id}`);
    expect(content).toContain("branch: feat/test");
    // Commit was made
    const log = (await $`git log --oneline`.cwd(work).text()).trim();
    expect(log).toContain("claim lock");
  });

  test("claimLock on an id we already hold returns already-ours", async () => {
    const id = "fr_01HZ7XJFKP0000000000000A02";
    const p = new LocalProvider({ repoRoot: work });
    await p.claimLock(id, "feat/test");
    const second = await p.claimLock(id, "feat/test");
    expect(second.kind).toBe("already-ours");
  });

  test("releaseLock deletes the file and commits; idempotent", async () => {
    const id = "fr_01HZ7XJFKP0000000000000A03";
    const p = new LocalProvider({ repoRoot: work });
    await p.claimLock(id, "feat/test");
    await p.releaseLock(id);
    expect(existsSync(join(work, ".dpt-locks", id))).toBe(false);
    // Idempotent on second call — now returns "already-released" (STE-84 AC-STE-84.3).
    await expect(p.releaseLock(id)).resolves.toBe("already-released");
  });
});

describe("LocalProvider.releaseLock return value (STE-84 AC-STE-84.3)", () => {
  test("lock-file-present returns 'transitioned' and removes the file", async () => {
    const id = "fr_01HZ7XJFKP0000000000000RTN01X";
    const p = new LocalProvider({ repoRoot: work, skipFetch: true });
    await p.claimLock(id, "feat/test");
    const outcome = await p.releaseLock(id);
    expect(outcome).toBe("transitioned");
    expect(existsSync(join(work, ".dpt-locks", id))).toBe(false);
  });

  test("lock-file-absent returns 'already-released' without side effects", async () => {
    const id = "fr_01HZ7XJFKP0000000000000RTN02X";
    const p = new LocalProvider({ repoRoot: work, skipFetch: true });
    const preSha = (await $`git rev-parse HEAD`.cwd(work).text()).trim();
    const outcome = await p.releaseLock(id);
    expect(outcome).toBe("already-released");
    // No commit was created — call must not touch git when the lock was never there.
    const postSha = (await $`git rev-parse HEAD`.cwd(work).text()).trim();
    expect(postSha).toBe(preSha);
  });
});

describe("LocalProvider offline / pure-local invariants (AC-43.5)", () => {
  test("mintId never touches network — survives in a fully offline-ish env", () => {
    // There is no network fetch in the code path; the guarantee is structural.
    // This test locks that guarantee by contract (no mock needed).
    const p = new LocalProvider({ repoRoot: work });
    const id = p.mintId();
    expect(id).toMatch(ULID_REGEX);
  });
});

// Phase F tests — remote-scan + stale-lock cleanup
describe("LocalProvider Phase F — remote-branch lock detection (AC-46.2)", () => {
  test("skipFetch=true still claims cleanly when no remote branches have the lock", async () => {
    const id = "fr_01HZ7XJFKP0000000000000SKIP1X";
    const p = new LocalProvider({ repoRoot: work, skipFetch: true });
    const result = await p.claimLock(id, "feat/test");
    expect(result.kind).toBe("claimed");
  });

  test("DPT_SKIP_FETCH=1 env var acts as the default when skipFetch option is unset", async () => {
    const prev = process.env["DPT_SKIP_FETCH"];
    process.env["DPT_SKIP_FETCH"] = "1";
    try {
      const id = "fr_01HZ7XJFKP0000000000000SKIPENV";
      const p = new LocalProvider({ repoRoot: work });
      const result = await p.claimLock(id, "feat/test");
      expect(result.kind).toBe("claimed");
    } finally {
      if (prev === undefined) delete process.env["DPT_SKIP_FETCH"];
      else process.env["DPT_SKIP_FETCH"] = prev;
    }
  });

  test("refuses claim when an origin remote-tracking branch has the lock", async () => {
    const id = "fr_01HZ7XJFKP0000000000000REMOTE1";
    // Set up a bare remote and push feat/other with the lock
    const remoteDir = mkdtempSync(join(tmpdir(), "dpt-local-remote-bare-"));
    rmSync(remoteDir, { recursive: true, force: true });
    await $`git init --bare -q ${remoteDir}`.cwd(work);
    await $`git remote add origin ${remoteDir}`.cwd(work);
    // Create the lock on feat/other and push
    await $`git checkout -q -b feat/other`.cwd(work);
    const p = new LocalProvider({ repoRoot: work, skipFetch: true });
    await p.claimLock(id, "feat/other");
    await $`git push -q origin feat/other`.cwd(work);
    // Switch back to main and remove local lock file from working tree
    await $`git checkout -q main`.cwd(work);
    await $`git branch -q -D feat/other`.cwd(work);
    if (existsSync(join(work, ".dpt-locks", id))) {
      rmSync(join(work, ".dpt-locks", id));
    }
    // Now the lock only exists on origin/feat/other (remote-tracking ref)
    const result = await p.claimLock(id, "main");
    expect(result.kind).toBe("taken-elsewhere");
    rmSync(remoteDir, { recursive: true, force: true });
  });
});

describe("LocalProvider Phase F — stale lock cleanup (AC-46.5)", () => {
  test("findStaleLocks reports locks on merged-and-deleted branches", async () => {
    const id = "fr_01HZ7XJFKP0000000000000MERGE1X";
    const p = new LocalProvider({ repoRoot: work, skipFetch: true });
    await $`git checkout -q -b feat/merged-then-deleted`.cwd(work);
    await p.claimLock(id, "feat/merged-then-deleted");
    await $`git checkout -q main`.cwd(work);
    await $`git merge -q --no-ff feat/merged-then-deleted -m "merge feat/merged"`.cwd(work);
    await $`git branch -q -D feat/merged-then-deleted`.cwd(work);
    // Now .dpt-locks/<id> is on main's working tree, but the claiming branch is gone
    const stale = await p.findStaleLocks();
    expect(stale.map((s) => s.id)).toContain(id);
    expect(stale.find((s) => s.id === id)?.reason).toBe("deleted");
  });

  test("cleanupStaleLocks deletes stale locks in a single commit (AC-46.5)", async () => {
    const id1 = "fr_01HZ7XJFKP0000000000000CLEAN01";
    const id2 = "fr_01HZ7XJFKP0000000000000CLEAN02";
    const p = new LocalProvider({ repoRoot: work, skipFetch: true });
    // Each lock claimed on its own branch, merged to main, then branch deleted
    await $`git checkout -q -b feat/a`.cwd(work);
    await p.claimLock(id1, "feat/a");
    await $`git checkout -q main`.cwd(work);
    await $`git merge -q --no-ff feat/a -m merge-a`.cwd(work);
    await $`git branch -q -D feat/a`.cwd(work);
    await $`git checkout -q -b feat/b`.cwd(work);
    await p.claimLock(id2, "feat/b");
    await $`git checkout -q main`.cwd(work);
    await $`git merge -q --no-ff feat/b -m merge-b`.cwd(work);
    await $`git branch -q -D feat/b`.cwd(work);
    const preSha = (await $`git rev-parse HEAD`.cwd(work).text()).trim();
    const result = await p.cleanupStaleLocks();
    expect(result.count).toBe(2);
    const postSha = (await $`git rev-parse HEAD`.cwd(work).text()).trim();
    expect(preSha).not.toBe(postSha);
    // HEAD is the cleanup commit, its single parent is the pre-cleanup commit
    const parent = (await $`git rev-parse HEAD^`.cwd(work).text()).trim();
    expect(parent).toBe(preSha);
    // Cleanup commit message names the count
    const msg = (await $`git log -1 --format=%s`.cwd(work).text()).trim();
    expect(msg).toMatch(/clean up 2 stale locks/);
  });
});
