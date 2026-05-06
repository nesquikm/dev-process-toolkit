// Tests for find_current_session — STE-229 AC-STE-229.4.
//
// Slug + mtime heuristic: derive `<cwd-slug>` from the cwd by replacing
// every `/` with `-`, list `*.jsonl` files in
// `~/.claude/projects/<cwd-slug>/`, return the most-recent-mtime path or
// `null` if no candidate exists.
//
// The HOME directory is overrideable via the second argument so the
// tests don't touch the operator's real `~/.claude` tree.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  utimesSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cwdToSlug,
  defaultConfigDir,
  findCurrentSession,
} from "./find_current_session";

function makeFakeConfig(): {
  configDir: string;
  cleanup: () => void;
} {
  // Each fake "config dir" is a tmp dir that stands in for `~/.claude`
  // (or whatever path `CLAUDE_CONFIG_DIR` would otherwise resolve to).
  const configDir = mkdtempSync(join(tmpdir(), "find-session-config-"));
  return {
    configDir,
    cleanup: () => rmSync(configDir, { recursive: true, force: true }),
  };
}

function plantSession(
  configDir: string,
  cwd: string,
  filename: string,
  ageSecondsAgo: number,
): string {
  const slug = cwdToSlug(cwd);
  const dir = join(configDir, "projects", slug);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, filename);
  writeFileSync(path, "{}\n");
  const t = Date.now() / 1000 - ageSecondsAgo;
  utimesSync(path, t, t);
  return path;
}

describe("cwdToSlug", () => {
  test("replaces every '/' with '-' for an absolute path", () => {
    expect(cwdToSlug("/Users/foo/bar")).toBe("-Users-foo-bar");
  });

  test("a leading slash becomes a leading dash", () => {
    expect(cwdToSlug("/")).toBe("-");
  });

  test("a path with multiple segments preserves segment count via dashes", () => {
    expect(cwdToSlug("/a/b/c/d")).toBe("-a-b-c-d");
  });

  test("a path without a leading slash gets the same dash transform", () => {
    expect(cwdToSlug("a/b/c")).toBe("a-b-c");
  });
});

describe("findCurrentSession — empty / missing cases", () => {
  test("returns null when the slug directory does not exist", () => {
    const { configDir, cleanup } = makeFakeConfig();
    try {
      expect(findCurrentSession("/Users/never/exists", configDir)).toBeNull();
    } finally {
      cleanup();
    }
  });

  test("returns null when the slug directory exists but contains no JSONL", () => {
    const { configDir, cleanup } = makeFakeConfig();
    try {
      const slug = cwdToSlug("/tmp/empty-cwd");
      const dir = join(configDir, "projects", slug);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "ignore.txt"), "not a session");
      expect(findCurrentSession("/tmp/empty-cwd", configDir)).toBeNull();
    } finally {
      cleanup();
    }
  });
});

describe("findCurrentSession — single / multi-mtime cases", () => {
  test("returns the only JSONL when the dir has one entry", () => {
    const { configDir, cleanup } = makeFakeConfig();
    try {
      const path = plantSession(configDir, "/cwd/single", "abc.jsonl", 60);
      expect(findCurrentSession("/cwd/single", configDir)).toBe(path);
    } finally {
      cleanup();
    }
  });

  test("returns the most-recent-mtime entry when multiple are present", () => {
    const { configDir, cleanup } = makeFakeConfig();
    try {
      const old = plantSession(configDir, "/cwd/multi", "old.jsonl", 600);
      const newer = plantSession(configDir, "/cwd/multi", "newer.jsonl", 60);
      const newest = plantSession(configDir, "/cwd/multi", "newest.jsonl", 5);
      // Sanity: all three exist.
      expect(old).toContain("old.jsonl");
      expect(newer).toContain("newer.jsonl");
      expect(findCurrentSession("/cwd/multi", configDir)).toBe(newest);
    } finally {
      cleanup();
    }
  });

  test("ignores non-JSONL files even when newer", () => {
    const { configDir, cleanup } = makeFakeConfig();
    try {
      const session = plantSession(configDir, "/cwd/mixed", "session.jsonl", 600);
      // Plant a newer non-JSONL.
      const slug = cwdToSlug("/cwd/mixed");
      const dir = join(configDir, "projects", slug);
      const noise = join(dir, "noise.log");
      writeFileSync(noise, "log line");
      const t = Date.now() / 1000 - 5;
      utimesSync(noise, t, t);
      expect(findCurrentSession("/cwd/mixed", configDir)).toBe(session);
    } finally {
      cleanup();
    }
  });
});

describe("findCurrentSession — slug derivation correctness", () => {
  test("the function uses the cwd-slug naming rule, not literal cwd path", () => {
    const { configDir, cleanup } = makeFakeConfig();
    try {
      const cwd = "/Users/foo/bar/baz";
      const path = plantSession(configDir, cwd, "session.jsonl", 60);
      // `<config-dir>/projects/-Users-foo-bar-baz/session.jsonl` is the
      // documented layout; a literal cwd-path subdir would not be found.
      expect(path).toContain("-Users-foo-bar-baz");
      expect(findCurrentSession(cwd, configDir)).toBe(path);
    } finally {
      cleanup();
    }
  });
});

describe("defaultConfigDir — CLAUDE_CONFIG_DIR resolution", () => {
  // Mutate process.env in this block; restore between tests.
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.CLAUDE_CONFIG_DIR;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR;
    } else {
      process.env.CLAUDE_CONFIG_DIR = originalEnv;
    }
  });

  test("returns CLAUDE_CONFIG_DIR when set (e.g., ~/.claude-st operators)", () => {
    process.env.CLAUDE_CONFIG_DIR = "/tmp/fake-claude-st";
    expect(defaultConfigDir()).toBe("/tmp/fake-claude-st");
  });

  test("falls back to <homedir()>/.claude when CLAUDE_CONFIG_DIR is unset", () => {
    delete process.env.CLAUDE_CONFIG_DIR;
    const dir = defaultConfigDir();
    expect(dir.endsWith("/.claude")).toBe(true);
  });

  test("falls back to <homedir()>/.claude when CLAUDE_CONFIG_DIR is empty", () => {
    process.env.CLAUDE_CONFIG_DIR = "";
    const dir = defaultConfigDir();
    expect(dir.endsWith("/.claude")).toBe(true);
  });
});
