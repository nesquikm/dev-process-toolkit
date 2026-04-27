import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// STE-133 — Conventional Commits commit-msg hook.
//
// Exercises the shell hook template via Bun.spawn against the
// AC-STE-133.10 fixture matrix. Each fixture writes a candidate commit
// message to a temp file, invokes `sh <hook> <tmp>`, and asserts:
//
//   - exit code (0 = accept, 1 = reject)
//   - for rejected fixtures, stderr contains the failing rule name
//     (`type-prefix-missing` / `unknown-type` / `missing-colon-or-description`
//     / `subject-too-long`) AND the offending subject line verbatim.
//
// The hook lives at templates/git-hooks/commit-msg.sh — this test is the
// deterministic regression gate per AC-STE-133.1. The same hook ships to
// adopting projects via /setup (AC-STE-133.2) and to this repo's local
// .git/hooks/commit-msg (AC-STE-133.9), so a green run here is the proof
// that all three install paths behave identically.

const pluginRoot = join(import.meta.dir, "..");
const hookPath = join(pluginRoot, "templates", "git-hooks", "commit-msg.sh");

interface RunResult {
  exitCode: number;
  stderr: string;
  stdout: string;
}

async function runHook(message: string): Promise<RunResult> {
  const tmpDir = mkdtempSync(join(tmpdir(), "ste-133-hook-"));
  const msgFile = join(tmpDir, "COMMIT_EDITMSG");
  writeFileSync(msgFile, message);
  try {
    const proc = Bun.spawn(["sh", hookPath, msgFile], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;
    return { exitCode, stdout, stderr };
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("AC-STE-133.1 — hook template exists at the documented path", () => {
  test("templates/git-hooks/commit-msg.sh is present", () => {
    expect(existsSync(hookPath)).toBe(true);
  });

  test("script parses on POSIX shell (sh -n)", async () => {
    const proc = Bun.spawn(["sh", "-n", hookPath], {
      stderr: "pipe",
    });
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
  });
});

describe("AC-STE-133.10 — valid Conventional Commit messages exit 0", () => {
  const validFixtures: Array<{ name: string; message: string }> = [
    { name: "vanilla feat", message: "feat: add new helper\n" },
    {
      name: "scoped fix",
      message: "fix(adapters/linear): handle null assignee\n",
    },
    { name: "breaking marker", message: "feat!: drop legacy API\n" },
    { name: "release commit", message: 'chore(release): v1.37.0\n' },
    { name: "scoped docs", message: "docs(readme): clarify install\n" },
    {
      name: "subject + body + footer",
      message:
        "feat(setup): install commit-msg hook\n\nLong-form body explaining the change.\n\nRefs: STE-133\n",
    },
  ];

  for (const fx of validFixtures) {
    test(`accepts: ${fx.name}`, async () => {
      const result = await runHook(fx.message);
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
    });
  }
});

describe("AC-STE-133.10 — invalid messages exit 1 with the right rule name", () => {
  const invalidFixtures: Array<{
    name: string;
    message: string;
    rule: string;
  }> = [
    {
      name: "no type prefix",
      message: "add a feature without a type\n",
      rule: "type-prefix-missing",
    },
    {
      name: "unknown type",
      message: "fixme: not a recognized type\n",
      rule: "unknown-type",
    },
    {
      name: "missing colon",
      message: "feat add a feature with no colon\n",
      rule: "type-prefix-missing",
    },
    {
      name: "empty description after colon",
      message: "feat: \n",
      rule: "missing-colon-or-description",
    },
    {
      name: "subject too long (>72 chars)",
      message:
        "feat(setup): a subject this long should be rejected because it goes way past seventy two chars\n",
      rule: "subject-too-long",
    },
  ];

  for (const fx of invalidFixtures) {
    test(`rejects (${fx.rule}): ${fx.name}`, async () => {
      const result = await runHook(fx.message);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(fx.rule);
      // The offending subject line (first non-blank, non-comment line, with trailing
      // newline stripped) must appear verbatim in stderr per AC-STE-133.1.
      const subject = fx.message
        .split("\n")
        .find((line) => line.trim() !== "" && !line.startsWith("#")) ?? "";
      expect(result.stderr).toContain(subject);
    });
  }
});

describe("AC-STE-133.1 — abort path: empty / comment-only messages are allowed", () => {
  test("empty message exits 0 (git itself aborts)", async () => {
    const result = await runHook("");
    expect(result.exitCode).toBe(0);
  });

  test("whitespace-only message exits 0", async () => {
    const result = await runHook("   \n\n   \n");
    expect(result.exitCode).toBe(0);
  });

  test("comment-only message exits 0 (every non-blank line starts with #)", async () => {
    const result = await runHook(
      "# Please enter the commit message for your changes.\n# Lines starting with # are ignored.\n",
    );
    expect(result.exitCode).toBe(0);
  });
});

describe("AC-STE-133.1 — comment lines and blank-prefix lines are skipped when locating the subject", () => {
  test("blank lines before the real subject are skipped", async () => {
    const result = await runHook("\n\nfeat: add a thing\n");
    expect(result.exitCode).toBe(0);
  });

  test("leading comment lines are skipped — first real line is the subject", async () => {
    const result = await runHook(
      "# instruction comment\nfeat(scope): valid subject after comment\n",
    );
    expect(result.exitCode).toBe(0);
  });

  test("subject exactly 72 chars is accepted (boundary)", async () => {
    const subject = "feat(setup): " + "x".repeat(72 - "feat(setup): ".length);
    expect(subject.length).toBe(72);
    const result = await runHook(subject + "\n");
    expect(result.exitCode).toBe(0);
  });

  test("subject 73 chars is rejected (boundary +1)", async () => {
    const subject = "feat(setup): " + "x".repeat(73 - "feat(setup): ".length);
    expect(subject.length).toBe(73);
    const result = await runHook(subject + "\n");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("subject-too-long");
  });

  test("leading whitespace on the subject is trimmed before regex/length checks", async () => {
    // Defensive: a stray-indented subject must validate against its trimmed form
    // (otherwise a valid `feat: thing` with two leading spaces would be rejected
    // because the regex anchors on `^feat`). Length check also runs on the
    // trimmed form so the leading whitespace doesn't push a 70-char subject
    // past 72.
    const result = await runHook("  feat: trimmed subject\n");
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
  });

  test("trailing whitespace on the subject is trimmed before length check", async () => {
    const subject = "feat(setup): " + "x".repeat(72 - "feat(setup): ".length);
    expect(subject.length).toBe(72);
    const result = await runHook(subject + "   \n");
    expect(result.exitCode).toBe(0);
  });
});
