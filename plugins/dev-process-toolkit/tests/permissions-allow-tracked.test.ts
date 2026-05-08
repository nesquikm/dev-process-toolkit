import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// STE-252 AC-STE-252.1 + AC-STE-252.2 — tracked `permissions.allow`
// allow-list and bypass removal in real on-disk skill files.
//
// AC-STE-252.1: tracked `.claude/settings.json` carries a non-empty
//   `permissions.allow` array covering Bash command patterns,
//   Edit/Write/Read/Grep/Glob, and the MCP tool families used by the
//   `/conformance-loop` call tree (`mcp__linear__*`, `mcp__atlassian__*`).
//   The block is byte-stable across runs and reviewable as a single-file
//   PR diff (deterministic ordering — no churn between runs).
//
// AC-STE-252.2: `--permission-mode bypassPermissions` is removed from
//   every `claude -p` fenced spawn snippet in the two project-local
//   SKILL.md files. Verifies the on-disk artifact, not a synthetic
//   fixture (the gate-check probe in
//   `gate-check-conformance-loop-bypass-removed.test.ts` covers the
//   detector's own logic).

const repoRoot = join(import.meta.dir, "..", "..", "..");
const settingsPath = join(repoRoot, ".claude", "settings.json");
const conformanceLoopPath = join(
  repoRoot,
  ".claude",
  "skills",
  "conformance-loop",
  "SKILL.md",
);
const smokeTestPath = join(repoRoot, ".claude", "skills", "smoke-test", "SKILL.md");

interface ReadJsonResult {
  present: boolean;
  parsed: unknown | null;
  parseError: string | null;
}

function readJsonIfPresent(p: string): ReadJsonResult {
  if (!existsSync(p)) return { present: false, parsed: null, parseError: null };
  const raw = readFileSync(p, "utf8");
  try {
    return { present: true, parsed: JSON.parse(raw), parseError: null };
  } catch (e) {
    return {
      present: true,
      parsed: null,
      parseError: e instanceof Error ? e.message : String(e),
    };
  }
}

function readIfPresent(p: string): string | null {
  if (!existsSync(p)) return null;
  return readFileSync(p, "utf8");
}

const settingsResult = readJsonIfPresent(settingsPath);
const settings = settingsResult.parsed as
  | { permissions?: { allow?: unknown } }
  | null;
const describeSettings = settingsResult.present ? describe : describe.skip;

describeSettings("AC-STE-252.1 — tracked permissions.allow allow-list", () => {
  test(".claude/settings.json carries `permissions.allow` as a non-empty array", () => {
    // Surface a malformed settings.json as a test failure, not a module-load
    // crash — `readJsonIfPresent` captures parse errors so we can assert on
    // them here with a clear message. A genuine JSON syntax error in the
    // tracked file IS a real bug; we want it to fail loudly but cleanly.
    expect(settingsResult.parseError).toBeNull();
    expect(settings).not.toBeNull();
    expect(settings!.permissions).toBeDefined();
    expect(Array.isArray(settings!.permissions!.allow)).toBe(true);
    const allow = settings!.permissions!.allow as unknown[];
    expect(allow.length).toBeGreaterThan(0);
    // Every entry is a non-empty string (no nulls / numbers / objects).
    for (const e of allow) {
      expect(typeof e).toBe("string");
      expect((e as string).length).toBeGreaterThan(0);
    }
  });

  test("allow-list covers the file-tool surface (Edit, Write, Read, Grep, Glob)", () => {
    const allow = (settings!.permissions!.allow as string[]).map((s) =>
      s.trim(),
    );
    // The technical-design `Allowlist content (initial)` enumerates these
    // exact bare-tool entries — no path narrowing because the realpath
    // pre-flight scopes cwd at runtime.
    expect(allow).toContain("Edit");
    expect(allow).toContain("Write");
    expect(allow).toContain("Read");
    expect(allow).toContain("Grep");
    expect(allow).toContain("Glob");
  });

  test("allow-list covers the Bash command-pattern surface used by the call tree", () => {
    const allow = (settings!.permissions!.allow as string[]).map((s) =>
      s.trim(),
    );
    // Spec-listed Bash patterns the call tree actually uses. Pattern shape
    // is `Bash(<glob>)` per Claude Code permission schema.
    const required = [
      "Bash(bun:*)",
      "Bash(bun test:*)",
      "Bash(git:*)",
      "Bash(gh:*)",
      "Bash(find:*)",
      "Bash(realpath:*)",
      "Bash(mkdir:*)",
      "Bash(rm:*)",
    ];
    for (const p of required) {
      expect(allow).toContain(p);
    }
  });

  test("allow-list covers MCP tool families (mcp__linear__*, mcp__atlassian__*)", () => {
    const allow = (settings!.permissions!.allow as string[]).map((s) =>
      s.trim(),
    );
    // Wildcard family entries are the cheapest expressive form — the
    // alternative is enumerating every tool one by one, which churns the
    // diff every time Linear/Atlassian add a tool. Family wildcards keep
    // the artifact byte-stable.
    expect(allow).toContain("mcp__linear__*");
    expect(allow).toContain("mcp__atlassian__*");
  });

  test("allow-list ordering is deterministic (byte-stable across runs)", () => {
    // Re-read the file and re-parse; the array must equal itself byte-for-byte
    // when serialized back. This catches a non-deterministic generator that
    // would churn the diff. The simplest contract: the array is sorted (or
    // at least equal to a sorted copy under whatever canonical ordering the
    // author picked). We assert sorted-ness as the cheapest deterministic
    // contract that covers "byte-stable across runs".
    const allow = settings!.permissions!.allow as string[];
    const sorted = [...allow].sort();
    expect(allow).toEqual(sorted);
  });

  test("allow-list is reviewable as a single-file PR diff (lives in tracked file, not local override)", () => {
    // `.claude/settings.json` is the tracked artifact (currently
    // `{"enabledPlugins":{}}` pre-STE-252). `.claude/settings.local.json`
    // is operator-specific and gitignored. The audit-able policy MUST
    // live in the tracked file — assert by checking the tracked path
    // resolves and carries the block.
    expect(existsSync(settingsPath)).toBe(true);
    expect(settings!.permissions).toBeDefined();
    expect(Array.isArray(settings!.permissions!.allow)).toBe(true);
  });
});

const cl = readIfPresent(conformanceLoopPath);
const st = readIfPresent(smokeTestPath);
const describeIfPresent =
  cl === null && st === null ? describe.skip : describe;

describeIfPresent(
  "AC-STE-252.2 — `--permission-mode bypassPermissions` removed from every `claude -p` fence",
  () => {
    test("/conformance-loop SKILL.md has no `--permission-mode bypassPermissions` inside any ```bash fence with `claude -p`", () => {
      if (cl === null) return;
      const offending = findOffendingFences(cl);
      expect(offending).toEqual([]);
    });

    test("/smoke-test SKILL.md has no `--permission-mode bypassPermissions` inside any ```bash fence with `claude -p`", () => {
      if (st === null) return;
      const offending = findOffendingFences(st);
      expect(offending).toEqual([]);
    });
  },
);

interface OffendingFence {
  startLine: number; // 1-based
  excerpt: string; // first ~80 chars of the fence body for diagnosis
}

function findOffendingFences(content: string): OffendingFence[] {
  const lines = content.split("\n");
  const out: OffendingFence[] = [];
  let inFence = false;
  let bufStart = -1;
  let buf: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!inFence && /^```bash\s*$/.test(line)) {
      inFence = true;
      bufStart = i + 1;
      buf = [];
      continue;
    }
    if (inFence && /^```\s*$/.test(line)) {
      const body = buf.join("\n");
      if (
        /\bclaude\s+-p\b/.test(body) &&
        /--permission-mode\s+bypassPermissions/.test(body)
      ) {
        out.push({ startLine: bufStart, excerpt: body.slice(0, 80) });
      }
      inFence = false;
      buf = [];
      continue;
    }
    if (inFence) buf.push(line);
  }
  return out;
}
