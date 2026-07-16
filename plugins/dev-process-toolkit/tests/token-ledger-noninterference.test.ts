// STE-344 AC-STE-344.5 + AC-STE-344.6 — .gitignore wiring + non-interference.
//
// AC-STE-344.5 — the ledger directory is covered by an ignore rule that
//   /setup wires and the toolkit dogfoods, so a capture run never dirties
//   the tracked tree. The bundled hook needs no /setup install step
//   (hooks/hooks.json is auto-discovered per M74).
//
// AC-STE-344.6 — non-interference, proven by test:
//   (a) ledgerPath() resolves under a path matched by the project's ignore
//       entry, so `git status` stays clean after a hook run;
//   (b) the hook writes nothing outside the ledger tree and exits 0 even on
//       a malformed stdin payload. No tracked file is ever modified.
//
// M104 STE-382 AC-STE-382.4 — the ledger moved from the retired flat folder
// to `.dpt/ledger/`. The AC-STE-344.6 invariant is preserved verbatim under
// the new path: the fixtures below ignore `.dpt/` and the assertions follow
// the ledger to its new home.
//
// M104 STE-383 — the MECHANISM behind AC-STE-344.5 changed: /setup no longer
// appends an entry to the consumer's root `.gitignore`; it writes a nested,
// toolkit-owned `.dpt/.gitignore` instead, and the toolkit's own root
// `.gitignore` cedes `.dpt/` to it entirely. The two tests below previously
// pinned this repo's root `.gitignore` and `skills/setup/SKILL.md` prose to
// the retired entry; they are re-pointed to the file that governs now, so
// AC-STE-344.5's coverage (the ledger's ignore rule IS wired here AND IS
// documented in /setup) survives under the new design. The `check-ignore`
// polarity proof and the root-`.gitignore` no-`.dpt`-line rule live with
// their owner in `tests/m104-ste-383-dpt-gitignore.test.ts`.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { ledgerPath } from "../adapters/_shared/src/token_usage";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const PLUGIN_ROOT = join(REPO_ROOT, "plugins", "dev-process-toolkit");
const ROOT_GITIGNORE = join(REPO_ROOT, ".gitignore");
const SETUP_SKILL_MD = join(PLUGIN_ROOT, "skills", "setup", "SKILL.md");
const WRAPPER_PATH = join(
  PLUGIN_ROOT,
  "templates",
  "hooks",
  "process",
  "session-token-ledger.sh",
);

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function resolveModulePath(): string | null {
  if (!existsSync(WRAPPER_PATH)) {
    return null;
  }
  const body = readFileSync(WRAPPER_PATH, "utf-8");
  const m = body.match(/\$\{CLAUDE_PLUGIN_ROOT\}([^"'\s]+\.ts)/);
  if (!m) {
    return null;
  }
  const resolved = join(PLUGIN_ROOT, m[1]!);
  return existsSync(resolved) ? resolved : null;
}

function git(cwd: string, args: string[]): { exitCode: number; stdout: string } {
  const proc = Bun.spawnSync(
    ["git", "-c", "user.email=t@t.test", "-c", "user.name=t", ...args],
    { cwd, stdout: "pipe", stderr: "pipe" },
  );
  return { exitCode: proc.exitCode, stdout: proc.stdout.toString() };
}

/** Recursive file listing relative to root, skipping .git/. */
function listFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === ".git") continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        out.push(relative(root, full));
      }
    }
  };
  walk(root);
  return out.sort();
}

async function runHookModule(
  stdinPayload: string,
  cwd: string,
): Promise<{ exitCode: number; stderr: string }> {
  const modulePath = resolveModulePath();
  expect(modulePath).not.toBeNull();
  const proc = Bun.spawn(["bun", "run", modulePath!], {
    cwd,
    stdin: new Response(stdinPayload).body,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  return { exitCode, stderr };
}

// M102 STE-379: the capture hook now gates on the project's `## Token Stats`
// enabled flag. Existing write-path fixtures must declare `enabled: true` so
// they keep exercising the write path once the gate lands (spec-mandated
// fixture update under AC-STE-379.1); the new gate tests pass DISABLED /
// MALFORMED. `TRUE` is out of the lowercase {true,false} set ⇒ the parser
// throws and the fail-off gate treats it as OFF.
const TOKEN_STATS_ENABLED = "# fixture project\n\n## Token Stats\n\nenabled: true\n";
const TOKEN_STATS_DISABLED = "# fixture project\n\n## Token Stats\n\nenabled: false\n";
const TOKEN_STATS_MALFORMED = "# fixture project\n\n## Token Stats\n\nenabled: TRUE\n";

/**
 * A tmp git repo with a committed tracked file + a committed `.dpt/` ignore.
 * The `## Token Stats` config is committed too (default ENABLED) so a hook run
 * leaves `git status` clean regardless of the gate's decision.
 */
function makeGitProject(claudeMd: string | null = TOKEN_STATS_ENABLED): string {
  const root = mkdtempSync(join(tmpdir(), "ste-344-ni-"));
  git(root, ["init", "-q"]);
  writeFileSync(join(root, "README.md"), "# fixture project\n");
  writeFileSync(join(root, ".gitignore"), ".dpt/\n");
  if (claudeMd !== null) {
    writeFileSync(join(root, "CLAUDE.md"), claudeMd);
  }
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "init"]);
  return root;
}

/** A transcript with one real usage row — absent the gate, the hook WOULD write. */
function writeRowTranscript(scratch: string): string {
  const transcript = join(scratch, "transcript.jsonl");
  writeFileSync(
    transcript,
    JSON.stringify({
      type: "assistant",
      sessionId: "ni-session",
      gitBranch: "main",
      attributionSkill: "dev-process-toolkit:tdd",
      message: {
        role: "assistant",
        model: "claude-fable-5",
        usage: {
          input_tokens: 1,
          output_tokens: 2,
          cache_read_input_tokens: 3,
          cache_creation_input_tokens: 4,
        },
      },
    }) + "\n",
  );
  return transcript;
}

function niPayload(transcript: string, cwd: string): string {
  return JSON.stringify({
    session_id: "ni-session",
    transcript_path: transcript,
    cwd,
    hook_event_name: "SessionEnd",
  });
}

let cleanupDirs: string[] = [];

beforeEach(() => {
  cleanupDirs = [];
});

afterEach(() => {
  for (const dir of cleanupDirs) {
    if (dir && existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

// ---------------------------------------------------------------------------
// AC-STE-344.5 — .gitignore wiring
// ---------------------------------------------------------------------------

describe("AC-STE-344.5 / AC-STE-383.4 — the toolkit dogfoods the ledger's ignore rule", () => {
  test("the rule that ignores the ledger is the nested `.dpt/.gitignore`, not a root entry", () => {
    // Re-pointed from the retired root-append: the toolkit's own root
    // `.gitignore` must now stay OUT of `.dpt/` entirely, and the nested
    // toolkit-owned file is what covers the ledger.
    expect(existsSync(ROOT_GITIGNORE)).toBe(true);
    const rootLines = readFileSync(ROOT_GITIGNORE, "utf-8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("#"));
    for (const line of rootLines) {
      expect(line).not.toContain(".dpt");
    }

    const nested = join(REPO_ROOT, ".dpt", ".gitignore");
    expect(existsSync(nested)).toBe(true);
    const rules = readFileSync(nested, "utf-8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("#"));
    expect(rules).toContain("ledger/");
  });

  test("this repo's own ledger path is git-ignored under that rule", () => {
    // The AC-STE-344.6(a) invariant, asserted against the real repo rather
    // than a fixture: whatever the mechanism, the ledger must not show up.
    const ignored = git(REPO_ROOT, [
      "check-ignore",
      "-q",
      relative(REPO_ROOT, ledgerPath(REPO_ROOT)),
    ]);
    expect(ignored.exitCode).toBe(0);
  });
});

describe("AC-STE-344.5 / AC-STE-383.2 — /setup documents the idempotent ignore step", () => {
  test("skills/setup/SKILL.md documents the `.dpt/.gitignore` write in a .gitignore context", () => {
    const body = readFileSync(SETUP_SKILL_MD, "utf-8");
    expect(body).toContain(".dpt/.gitignore");
    // The retired entry must not linger anywhere in the skill.
    expect(body).not.toContain(".dev-process");
  });

  test("the step is existence-guarded + idempotent (create-if-absent, no-op on match)", () => {
    const body = readFileSync(SETUP_SKILL_MD, "utf-8");
    const paragraph = body
      .split(/\n\s*\n/)
      .find((p) => p.includes(".dpt/.gitignore"));
    expect(paragraph).toBeDefined();
    expect(paragraph!).toMatch(/idempotent|already present|no-?op|unchanged/i);
    expect(paragraph!).toMatch(/creat/i); // create `.dpt/` if absent
  });
});

// ---------------------------------------------------------------------------
// AC-STE-344.6(a) / AC-STE-382.4 — ledgerPath is matched by the `.dpt/` entry
// ---------------------------------------------------------------------------

describe("AC-STE-344.6(a) / AC-STE-382.4 — ledgerPath() resolves under the `.dpt/` .gitignore entry", () => {
  test("ledger path is git-ignored: check-ignore hits and `git status` stays clean", () => {
    const root = makeGitProject();
    cleanupDirs.push(root);

    const path = ledgerPath(root);
    // Structural: the ledger lives under `.dpt/ledger/` at the project root.
    expect(relative(root, path).split(sep)[0]).toBe(".dpt");
    expect(relative(root, path).split(sep)[1]).toBe("ledger");

    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '{"schema":"token-ledger/v1"}\n');

    const ignored = git(root, ["check-ignore", "-q", path]);
    expect(ignored.exitCode).toBe(0);

    const status = git(root, ["status", "--porcelain"]);
    expect(status.exitCode).toBe(0);
    expect(status.stdout.trim()).toBe("");
  });
});

// ---------------------------------------------------------------------------
// AC-STE-344.6(b) / AC-STE-382.4 — hook writes nothing outside .dpt/, exits 0
// ---------------------------------------------------------------------------

describe("AC-STE-344.6(b) / AC-STE-382.4 — capture path writes only under .dpt/ and never dirties the tree", () => {
  test("a hook run in a git project leaves `git status --porcelain` empty and adds files only under .dpt/", async () => {
    const root = makeGitProject();
    cleanupDirs.push(root);
    // Transcript lives OUTSIDE the project so it cannot mask a stray write.
    const scratch = mkdtempSync(join(tmpdir(), "ste-344-ni-scratch-"));
    cleanupDirs.push(scratch);

    const transcript = join(scratch, "transcript.jsonl");
    writeFileSync(
      transcript,
      JSON.stringify({
        type: "assistant",
        sessionId: "ni-session",
        gitBranch: "main",
        attributionSkill: "dev-process-toolkit:tdd",
        message: {
          role: "assistant",
          model: "claude-fable-5",
          usage: {
            input_tokens: 1,
            output_tokens: 2,
            cache_read_input_tokens: 3,
            cache_creation_input_tokens: 4,
          },
        },
      }) + "\n",
    );

    const before = listFiles(root);
    const r = await runHookModule(
      JSON.stringify({
        session_id: "ni-session",
        transcript_path: transcript,
        cwd: root,
        hook_event_name: "SessionEnd",
      }),
      root,
    );
    expect(r.exitCode).toBe(0);

    const after = listFiles(root);
    const added = after.filter((f) => !before.includes(f));
    // The hook DID write something (the ledger)…
    expect(added.length).toBeGreaterThan(0);
    // …and every new path is confined to .dpt/ledger/.
    for (const f of added) {
      expect(f.split(sep)[0]).toBe(".dpt");
      expect(f.split(sep)[1]).toBe("ledger");
    }
    // The capture path must never touch the TRACKED lock namespace.
    expect(added.some((f) => f.startsWith(join(".dpt", "locks")))).toBe(false);
    // No pre-existing (tracked) file was modified or removed.
    for (const f of before) {
      expect(after).toContain(f);
    }

    const status = git(root, ["status", "--porcelain"]);
    expect(status.stdout.trim()).toBe("");
  });

  test("malformed stdin payload → exit 0 and zero new files anywhere in the project", async () => {
    const root = makeGitProject();
    cleanupDirs.push(root);

    const before = listFiles(root);
    const r = await runHookModule("%%% not json at all", root);
    expect(r.exitCode).toBe(0);

    const after = listFiles(root);
    expect(after).toEqual(before);
    expect(existsSync(join(root, ".dpt"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-379.1 — capture-hook gate: disabled + malformed write nothing at all
// ---------------------------------------------------------------------------

describe("AC-STE-379.1 — the gate keeps the tree clean AND writes nothing when off", () => {
  test("enabled: false ⇒ zero new files anywhere (not even under .dev-process/), clean tree, exit 0", async () => {
    const root = makeGitProject(TOKEN_STATS_DISABLED);
    cleanupDirs.push(root);
    const scratch = mkdtempSync(join(tmpdir(), "ste-379-ni-scratch-"));
    cleanupDirs.push(scratch);
    const transcript = writeRowTranscript(scratch);

    const before = listFiles(root);
    const r = await runHookModule(niPayload(transcript, root), root);
    expect(r.exitCode).toBe(0);

    // The transcript has real rows, so absent the gate the hook would have
    // written the ledger — with `enabled: false` nothing is written at all.
    const after = listFiles(root);
    expect(after).toEqual(before);
    expect(existsSync(join(root, ".dpt"))).toBe(false);
    const status = git(root, ["status", "--porcelain"]);
    expect(status.stdout.trim()).toBe("");
  });

  test("malformed CLAUDE.md ⇒ fail-off: zero new files, clean tree, exit 0", async () => {
    const root = makeGitProject(TOKEN_STATS_MALFORMED);
    cleanupDirs.push(root);
    const scratch = mkdtempSync(join(tmpdir(), "ste-379-ni-scratch-mal-"));
    cleanupDirs.push(scratch);
    const transcript = writeRowTranscript(scratch);

    const before = listFiles(root);
    const r = await runHookModule(niPayload(transcript, root), root);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).not.toContain("Refusing:");

    const after = listFiles(root);
    expect(after).toEqual(before);
    expect(existsSync(join(root, ".dpt"))).toBe(false);
    const status = git(root, ["status", "--porcelain"]);
    expect(status.stdout.trim()).toBe("");
  });
});
