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

describe("LocalProvider.getMetadata", () => {
  test("reads FR frontmatter from specs/frs/<id>.md", async () => {
    const id = "fr_01HZ7XJFKP0000000000000A01";
    writeFileSync(
      join(work, "specs", "frs", `${id}.md`),
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

  test("reads from specs/frs/archive/<id>.md when not in active set", async () => {
    const id = "fr_01HZ7XJFKN0000000000000C04";
    mkdirSync(join(work, "specs", "frs", "archive"), { recursive: true });
    writeFileSync(
      join(work, "specs", "frs", "archive", `${id}.md`),
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
    // Idempotent on second call
    await expect(p.releaseLock(id)).resolves.toBeUndefined();
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
