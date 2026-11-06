// STE-715 (M_7bc805) AC.1 + AC.2 — the reuse key, computed on a temp repo.
//
// `adapters/_shared/src/gate_reuse_key.ts` names the exact input a gate graded:
// commit, uncommitted changes (tracked AND untracked), toolchain and toolkit
// versions, the `## Key Commands` section and the settings file bytes. Each
// field is recomputed here independently from git and the filesystem, so a key
// that drifted from the Requirement table cannot pass by agreeing with itself.
//
// AC.11 mutation anchors in this file:
//   - dropping untracked files from `worktreeDigest` -> "a new untracked file" and
//     "an edit to an untracked file" rows of "every input change moves the digest",
//     plus "worktree is the documented digest" in "key fields".

import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { PLUGIN_ROOT, cleanupTemps, git, makeTree, tempDir } from "./_m_7bc805_gate_outcome_fixture";

type AnyMod = Record<string, any>;

async function M(): Promise<AnyMod> {
  return (await import("../adapters/_shared/src/gate_reuse_key")) as AnyMod;
}

afterAll(cleanupTemps);

const sha = (bytes: string | Buffer): string => createHash("sha256").update(bytes).digest("hex");

function gitBytes(root: string, args: string[]): Buffer {
  const p = spawnSync("git", ["-C", root, ...args], { encoding: "buffer" });
  if (p.status !== 0) throw new Error(`git ${args.join(" ")}: ${p.stderr}`);
  return p.stdout as Buffer;
}

/** The Requirement's worktree digest, recomputed independently. */
function expectedWorktree(root: string, unborn = false): string {
  const h = createHash("sha256");
  h.update(gitBytes(root, unborn ? ["diff", "--cached", "--binary"] : ["diff", "HEAD", "--binary", "--no-ext-diff"]));
  const others = gitBytes(root, ["ls-files", "--others", "--exclude-standard", "-z"])
    .toString("utf-8")
    .split("\0")
    .filter((p) => p.length > 0)
    .sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  for (const p of others) {
    h.update(p);
    h.update("\0");
    h.update(sha(readFileSync(join(root, p))));
  }
  return `sha256:${h.digest("hex")}`;
}

/** The `## Key Commands` section: heading line through the line before the next `## ` heading. */
function keyCommandsSection(md: string): string {
  const lines = md.split("\n");
  const start = lines.findIndex((l) => l === "## Key Commands");
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) if (lines[i]!.startsWith("## ")) { end = i; break; }
  return lines.slice(start, end).join("\n");
}

function sortedJson(v: Record<string, unknown>): string {
  return JSON.stringify(Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])));
}

function pluginRootWithVersion(version: string): string {
  const root = join(tempDir("plugin-root"), "p");
  mkdirSync(join(root, ".claude-plugin"), { recursive: true });
  writeFileSync(join(root, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "dev-process-toolkit", version }));
  return root;
}

const KEY_FIELDS = ["bun", "clean", "commands", "head", "plugin", "settings", "v", "worktree"];

describe("AC-STE-715.1 key fields", () => {
  test("gateReuseKey, reuseKeyDigest and worktreeDigest are exported; offendingPaths is exported unchanged", async () => {
    const m = await M();
    expect(typeof m.gateReuseKey).toBe("function");
    expect(typeof m.reuseKeyDigest).toBe("function");
    expect(typeof m.worktreeDigest).toBe("function");
    const sb = (await import("../adapters/_shared/src/skip_baseline")) as AnyMod;
    expect(typeof sb.offendingPaths).toBe("function");
  });

  test("the key holds exactly the Requirement's fields, each with its value, on a clean committed repo", async () => {
    const m = await M();
    const root = makeTree("fields", "absent");
    const key = m.gateReuseKey(root) as Record<string, unknown>;
    expect(Object.keys(key).sort()).toEqual(KEY_FIELDS);
    const manifest = JSON.parse(readFileSync(join(PLUGIN_ROOT, ".claude-plugin", "plugin.json"), "utf-8"));
    expect(key).toEqual({
      v: 1,
      head: git(root, "rev-parse", "HEAD").trim(),
      clean: true,
      worktree: expectedWorktree(root),
      bun: Bun.version,
      plugin: manifest.version,
      commands: `sha256:${sha(keyCommandsSection(readFileSync(join(root, "CLAUDE.md"), "utf-8")))}`,
      settings: `sha256:${sha(readFileSync(join(root, "specs", "settings.yaml")))}`,
    });
  });

  test("worktree is the documented digest over staged, unstaged and untracked content; clean goes false", async () => {
    const m = await M();
    const root = makeTree("dirty", "absent");
    writeFileSync(join(root, "CLAUDE.md"), `${readFileSync(join(root, "CLAUDE.md"), "utf-8")}\nunstaged\n`);
    writeFileSync(join(root, "staged.txt"), "staged\n");
    git(root, "add", "staged.txt");
    writeFileSync(join(root, "b-untracked.txt"), "bee\n");
    writeFileSync(join(root, "a-untracked.txt"), "ay\n");
    const key = m.gateReuseKey(root) as Record<string, unknown>;
    expect(key.worktree).toBe(expectedWorktree(root));
    expect(m.worktreeDigest(root)).toBe(key.worktree);
    expect(key.clean).toBe(false);
  });

  test("an unborn branch: head null, worktree over `git diff --cached --binary`", async () => {
    const m = await M();
    const root = makeTree("unborn", "absent", { commit: false });
    const key = m.gateReuseKey(root) as Record<string, unknown>;
    expect(key.head).toBeNull();
    expect(key.worktree).toBe(expectedWorktree(root, true));
  });

  test("absent CLAUDE.md section and absent settings file read \"absent\"", async () => {
    const m = await M();
    const root = makeTree("absent", "none");
    writeFileSync(join(root, "CLAUDE.md"), "# no key commands here\n\n## Notes\n\nx\n");
    git(root, "commit", "-q", "-am", "drop key commands");
    const key = m.gateReuseKey(root) as Record<string, unknown>;
    expect(key.commands).toBe("absent");
    expect(key.settings).toBe("absent");
  });

  test("options.bunVersion and options.pluginRoot override bun and plugin", async () => {
    const m = await M();
    const root = makeTree("opts", "absent");
    const key = m.gateReuseKey(root, { bunVersion: "0.0.1-synthetic", pluginRoot: pluginRootWithVersion("9.8.7") });
    expect(key.bun).toBe("0.0.1-synthetic");
    expect(key.plugin).toBe("9.8.7");
  });

  test("reuseKeyDigest is sha256: over the key serialised as JSON with sorted keys", async () => {
    const m = await M();
    const root = makeTree("digest", "absent");
    const key = m.gateReuseKey(root) as Record<string, unknown>;
    expect(m.reuseKeyDigest(key)).toBe(`sha256:${sha(sortedJson(key))}`);
    // Key order of the input object does not move the digest.
    const reversed = Object.fromEntries(Object.entries(key).reverse());
    expect(m.reuseKeyDigest(reversed)).toBe(m.reuseKeyDigest(key));
  });
});

describe("AC-STE-715.2 every input change moves the digest", () => {
  type Change = { name: string; moves: boolean; apply: (root: string) => void; opts?: Record<string, unknown> };
  const changes: Change[] = [
    { name: "a new commit", moves: true, apply: (r) => { writeFileSync(join(r, "c.txt"), "c\n"); git(r, "add", "c.txt"); git(r, "commit", "-q", "-m", "c"); } },
    { name: "a staged edit", moves: true, apply: (r) => { writeFileSync(join(r, "package.json"), '{"name":"staged"}\n'); git(r, "add", "package.json"); } },
    { name: "an unstaged edit", moves: true, apply: (r) => writeFileSync(join(r, "package.json"), '{"name":"unstaged"}\n') },
    { name: "a new untracked file", moves: true, apply: (r) => writeFileSync(join(r, "new.txt"), "n\n") },
    { name: "an edit to an untracked file", moves: true, apply: (r) => writeFileSync(join(r, "seed-untracked.txt"), "edited\n") },
    { name: "an injected different bunVersion", moves: true, apply: () => {}, opts: { bunVersion: "0.0.0-other" } },
    { name: "a plugin root with a different manifest version", moves: true, apply: () => {}, opts: { pluginRoot: "DIFFERENT" } },
    { name: "an edited ## Key Commands section", moves: true, apply: (r) => writeFileSync(join(r, "CLAUDE.md"), readFileSync(join(r, "CLAUDE.md"), "utf-8").replace("- `bun test`", "- `bun test --bail`")) },
    { name: "an edited specs/settings.yaml", moves: true, apply: (r) => writeFileSync(join(r, "specs", "settings.yaml"), `${readFileSync(join(r, "specs", "settings.yaml"), "utf-8")}# edited\n`) },
    { name: "an edit to a git-ignored file", moves: false, apply: (r) => writeFileSync(join(r, "ignored.log"), "edited\n") },
    { name: "a recomputation with nothing changed", moves: false, apply: () => {} },
  ];

  for (const c of changes) {
    test(`${c.name} ${c.moves ? "changes" : "leaves equal"} reuseKeyDigest`, async () => {
      const m = await M();
      const root = makeTree("move", "absent");
      writeFileSync(join(root, "seed-untracked.txt"), "seed\n");
      writeFileSync(join(root, "ignored.log"), "seed\n");
      const base = pluginRootWithVersion("1.2.3");
      const before = m.reuseKeyDigest(m.gateReuseKey(root, { bunVersion: "1.0.0", pluginRoot: base }));
      c.apply(root);
      const opts: Record<string, unknown> = { bunVersion: "1.0.0", pluginRoot: base, ...(c.opts ?? {}) };
      if (opts.pluginRoot === "DIFFERENT") opts.pluginRoot = pluginRootWithVersion("1.2.4");
      const after = m.reuseKeyDigest(m.gateReuseKey(root, opts));
      expect(after).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect({ change: c.name, moved: after !== before }).toEqual({ change: c.name, moved: c.moves });
    });
  }
});
