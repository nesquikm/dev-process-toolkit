// STE-142 — commitlint header-max-length parity with the shell hook.
//
// The shell hook (templates/git-hooks/commit-msg.sh) hard-codes a 72-byte
// subject cap (STE-133 AC-STE-133.1). The opt-in commitlint variant
// (`/setup --commitlint`) ships templates/git-hooks/commitlint.config.js;
// without an explicit `header-max-length` override, commitlint inherits the
// upstream `@commitlint/config-conventional` default of 100. That divergence
// silently relaxes the spec's 72-byte cap when projects choose the
// commitlint variant.
//
// Two assertions:
//
//   AC-STE-142.2 — the shipped config carries `header-max-length: [2, "always", 72]`.
//   AC-STE-142.3 — boundary parity: 72-byte subjects accept on BOTH variants;
//                  73-byte and 100-byte subjects reject on BOTH variants.
//
// `commitlint` is not a dev-dependency in this repo; the parity check
// simulates commitlint's `header-max-length` rule semantics directly (a
// header is the first line; rule fires when its character length exceeds
// the configured value). The shell hook's accept/reject path is exercised
// via Bun.spawn, mirroring the harness in tests/conventional-commits-hook.test.ts.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const pluginRoot = join(import.meta.dir, "..");
const hookPath = join(pluginRoot, "templates", "git-hooks", "commit-msg.sh");
const commitlintConfigPath = join(
  pluginRoot,
  "templates",
  "git-hooks",
  "commitlint.config.js",
);

interface RunResult {
  exitCode: number;
  stderr: string;
}

async function runShellHook(message: string): Promise<RunResult> {
  const tmpDir = mkdtempSync(join(tmpdir(), "ste-142-hook-"));
  const msgFile = join(tmpDir, "COMMIT_EDITMSG");
  writeFileSync(msgFile, message);
  try {
    const proc = Bun.spawn(["sh", hookPath, msgFile], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    return { exitCode, stderr };
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

// Parses the rule value from the shipped config without requiring the
// commitlint package. The shipped file is a CommonJS module; we read it
// textually and extract the literal rule tuple — robust against the
// repo's lack of a commitlint dev-dependency.
function readHeaderMaxLengthRule(configPath: string): [number, string, number] | null {
  const body = readFileSync(configPath, "utf-8");
  const match = body.match(/"header-max-length"\s*:\s*\[\s*(\d+)\s*,\s*"([^"]+)"\s*,\s*(\d+)\s*\]/);
  if (!match) return null;
  return [Number(match[1]), match[2]!, Number(match[3])];
}

// Simulates commitlint's `header-max-length` rule: the header is the first
// line of the message; the rule fires when the header's character length
// exceeds the configured maximum (level 2 = error). Header length is
// measured in characters, mirroring commitlint upstream — see G2 in the
// audit for the byte-vs-char divergence note (deferred).
function commitlintHeaderRulePasses(message: string, maxLength: number): boolean {
  const header = message.split("\n", 1)[0] ?? "";
  return [...header].length <= maxLength;
}

describe("STE-142 AC-STE-142.2 — commitlint config carries header-max-length: 72", () => {
  test("shipped templates/git-hooks/commitlint.config.js declares the rule with value 72", () => {
    const rule = readHeaderMaxLengthRule(commitlintConfigPath);
    expect(rule).toEqual([2, "always", 72]);
  });

  test("config still extends @commitlint/config-conventional", () => {
    const body = readFileSync(commitlintConfigPath, "utf-8");
    expect(body).toMatch(/extends:\s*\["@commitlint\/config-conventional"\]/);
  });
});

describe("STE-142 AC-STE-142.3 — shell hook ↔ commitlint variant parity", () => {
  // ASCII subjects — the byte-vs-char divergence (G2 deferred) does not
  // affect the assertions because every character is one byte.
  const subjects = [
    {
      name: "feat: short subject (16 bytes)",
      header: "feat: short test",
      expectedLength: 16,
      expectedAccept: true,
    },
    {
      name: "feat: 72-byte boundary subject (accept on both)",
      header: "feat: " + "x".repeat(72 - "feat: ".length),
      expectedLength: 72,
      expectedAccept: true,
    },
    {
      name: "feat: 73-byte subject (reject on both)",
      header: "feat: " + "x".repeat(73 - "feat: ".length),
      expectedLength: 73,
      expectedAccept: false,
    },
    {
      name: "feat: 100-byte subject (reject on both — pre-fix commitlint default would have accepted)",
      header: "feat: " + "x".repeat(100 - "feat: ".length),
      expectedLength: 100,
      expectedAccept: false,
    },
    {
      name: "feat: 101-byte subject (reject on both — beyond the upstream commitlint default too)",
      header: "feat: " + "x".repeat(101 - "feat: ".length),
      expectedLength: 101,
      expectedAccept: false,
    },
  ];

  const ruleValue = readHeaderMaxLengthRule(commitlintConfigPath)?.[2] ?? -1;

  for (const subject of subjects) {
    test(subject.name, async () => {
      expect(subject.header.length).toBe(subject.expectedLength);

      // Shell hook verdict — exit 0 on accept, exit 1 on reject.
      const shellResult = await runShellHook(subject.header + "\n");
      const shellAccept = shellResult.exitCode === 0;

      // Commitlint-rule verdict — pass when length <= configured max.
      const commitlintAccept = commitlintHeaderRulePasses(subject.header, ruleValue);

      expect(shellAccept).toBe(subject.expectedAccept);
      expect(commitlintAccept).toBe(subject.expectedAccept);
      // Parity assertion: both variants agree on every boundary subject.
      expect(shellAccept).toBe(commitlintAccept);
    });
  }
});
