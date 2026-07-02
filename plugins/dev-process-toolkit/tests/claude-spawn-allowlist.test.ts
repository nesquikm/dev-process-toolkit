import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// STE-350 — allow-list the `claude -p` child-spawn so nested spawns are
// pre-approved and never fall to the auto-mode safety classifier.
//
// AC-STE-350.1: the toolkit repo's `.claude/settings.json`
//   `permissions.allow` contains an entry authorizing the canonical
//   child-spawn command as issued by /conformance-loop Phase A and
//   /smoke-test Phase 2; the pattern must match the exact command string
//   the skills emit (accounting for the `CLAUDE_CONFIG_DIR=` env prefix).
//
// AC-STE-350.2: the test-project `.claude/settings.json` scaffold that
//   /smoke-test Phase 1 step 6 pre-creates (shared verbatim by the
//   `linear` and `jira` paths) carries the same authorizing entry; the
//   scaffolded allow-list equals the canonical list including the entry.
//
// AC-STE-350.3: spawn command form and allow-list pattern are mutually
//   consistent. The FR selects **Resolution A**: every spawning Bash
//   block exports `CLAUDE_CONFIG_DIR` once at the top and issues a bare
//   `claude -p …` (no inline env-assignment prefix), so the allow-list
//   pattern `Bash(claude:*)` matches unambiguously. These tests encode
//   that convention so drift is caught.

const repoRoot = join(import.meta.dir, "..", "..", "..");
const settingsPath = join(repoRoot, ".claude", "settings.json");
const conformanceLoopPath = join(
  repoRoot,
  ".claude",
  "skills",
  "conformance-loop",
  "SKILL.md",
);
const smokeTestPath = join(
  repoRoot,
  ".claude",
  "skills",
  "smoke-test",
  "SKILL.md",
);

// The one canonical authorizing entry (Resolution A). A `Bash(claude:*)`
// rule prefix-matches commands that BEGIN with `claude`, which is exactly
// what the spawn blocks emit once `CLAUDE_CONFIG_DIR` is exported instead
// of inlined.
const SPAWN_ALLOW_ENTRY = "Bash(claude:*)";

// Canonical test-project scaffold allow-list (STE-106 shape) including the
// new spawn entry. The nine pre-existing entries are the scaffold's
// long-standing content; STE-350 adds only the spawn authorization.
const CANONICAL_SCAFFOLD_ALLOW = [
  "Bash(bun *)",
  "Bash(bunx *)",
  "Bash(git *)",
  "Bash(gh *)",
  "Bash(mkdir *)",
  "Bash(ls *)",
  "Bash(rm *)",
  "Bash(mv *)",
  "Bash(cp *)",
  SPAWN_ALLOW_ENTRY,
];

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

interface BashFence {
  startLine: number; // 1-based line of the opening ```bash
  body: string[]; // fence body lines (no fence markers)
}

// Extract ```bash fences. Unlike the STE-252 extractor, this one tolerates
// list-indented fences (the /smoke-test Phase 1 step 6 scaffold heredoc
// lives inside a numbered-list item and opens with `   ```bash`).
function extractBashFences(content: string): BashFence[] {
  const lines = content.split("\n");
  const out: BashFence[] = [];
  let inFence = false;
  let start = -1;
  let buf: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!inFence && /^\s*```bash\s*$/.test(line)) {
      inFence = true;
      start = i + 1;
      buf = [];
      continue;
    }
    if (inFence && /^\s*```\s*$/.test(line)) {
      out.push({ startLine: start, body: buf });
      inFence = false;
      buf = [];
      continue;
    }
    if (inFence) buf.push(line);
  }
  return out;
}

interface SpawnLine {
  fenceStartLine: number;
  offsetInFence: number; // 0-based index within the fence body
  text: string;
}

// Non-comment fence-body lines that invoke `claude -p`. Comment lines
// (`# … claude -p …`) are prose, not spawn commands. `claude-st -p` does
// NOT match (the regex requires whitespace between `claude` and `-p`).
function extractSpawnLines(fences: BashFence[]): SpawnLine[] {
  const out: SpawnLine[] = [];
  for (const fence of fences) {
    for (let i = 0; i < fence.body.length; i++) {
      const line = fence.body[i]!;
      if (/^\s*#/.test(line)) continue;
      if (/(^|\s)claude\s+-p(\s|$)/.test(line)) {
        out.push({ fenceStartLine: fence.startLine, offsetInFence: i, text: line });
      }
    }
  }
  return out;
}

// Minimal model of Claude Code's Bash permission-rule matching, sufficient
// for the fixture assertions here: `Bash(<prefix>:*)` matches a command
// equal to `<prefix>` or beginning with `<prefix> `; `Bash(<exact>)`
// matches only the exact command. A command that begins with an env
// assignment (`CLAUDE_CONFIG_DIR=…`) does NOT begin with `claude`, so
// `Bash(claude:*)` cannot match it — that is the M94 root cause.
function bashPatternMatches(pattern: string, command: string): boolean {
  const m = pattern.match(/^Bash\((.*)\)$/);
  if (!m) return false;
  const inner = m[1]!;
  if (inner.endsWith(":*")) {
    const prefix = inner.slice(0, -2);
    return command === prefix || command.startsWith(`${prefix} `);
  }
  return command === inner;
}

// Strip leading indentation and trailing line-continuation so a spawn line
// can be compared as the head of the command string the harness sees.
function commandHead(line: string): string {
  return line.trimStart().replace(/\s*\\\s*$/, "");
}

// All spawn lines across a document's ```bash fences.
function spawnLines(content: string): SpawnLine[] {
  return extractSpawnLines(extractBashFences(content));
}

// Spawn lines failing the `isOk` predicate, rendered as
// `fence@<line>: <command head>` for actionable assertion diffs.
function spawnOffenders(
  content: string,
  isOk: (s: SpawnLine) => boolean,
): string[] {
  return spawnLines(content)
    .filter((s) => !isOk(s))
    .map((s) => `fence@${s.fenceStartLine}: ${commandHead(s.text)}`);
}

// AC-STE-350.1 predicate: the spawn line's command head is matched by the
// canonical allow entry.
function matchedByAllowEntry(s: SpawnLine): boolean {
  return bashPatternMatches(SPAWN_ALLOW_ENTRY, commandHead(s.text));
}

const settingsResult = readJsonIfPresent(settingsPath);
const settings = settingsResult.parsed as
  | { permissions?: { allow?: unknown } }
  | null;
const cl = readIfPresent(conformanceLoopPath);
const st = readIfPresent(smokeTestPath);

const describeSettings = settingsResult.present ? describe : describe.skip;
const describeSkills = cl !== null && st !== null ? describe : describe.skip;

function allowList(): string[] {
  expect(settingsResult.parseError).toBeNull();
  expect(settings).not.toBeNull();
  expect(Array.isArray(settings!.permissions?.allow)).toBe(true);
  return (settings!.permissions!.allow as string[]).map((s) => s.trim());
}

describe("matcher self-check — Bash(<prefix>:*) prefix semantics fixture", () => {
  test("Bash(claude:*) matches a bare spawn and rejects the env-prefixed form", () => {
    // Fixture of the exact canonical spawn shapes. The env-prefixed form is
    // the pre-STE-350 emission that the classifier ends up gating.
    expect(
      bashPatternMatches(
        SPAWN_ALLOW_ENTRY,
        'claude -p "/smoke-test --tracker linear --linear-team STE" --plugin-dir /x',
      ),
    ).toBe(true);
    expect(bashPatternMatches(SPAWN_ALLOW_ENTRY, "claude -p")).toBe(true);
    expect(
      bashPatternMatches(
        SPAWN_ALLOW_ENTRY,
        'CLAUDE_CONFIG_DIR=~/.claude-st claude -p "/smoke-test --tracker jira"',
      ),
    ).toBe(false);
    expect(bashPatternMatches(SPAWN_ALLOW_ENTRY, "claude-st -p /x")).toBe(false);
  });
});

describeSettings(
  "AC-STE-350.1 — repo .claude/settings.json authorizes the claude -p child-spawn",
  () => {
    test("permissions.allow contains the canonical spawn entry Bash(claude:*)", () => {
      const allow = allowList();
      expect(allow).toContain(SPAWN_ALLOW_ENTRY);
    });

    test("allow-list stays sorted with the spawn entry present (byte-stable ordering)", () => {
      const allow = allowList();
      expect(allow).toContain(SPAWN_ALLOW_ENTRY);
      expect(allow).toEqual([...allow].sort());
    });
  },
);

describeSkills(
  "AC-STE-350.1 — the allow entry matches the exact command strings the skills emit",
  () => {
    test("every /conformance-loop spawn line is matched by Bash(claude:*)", () => {
      // Phase A (linear + jira) + Phase B (/spec-write + /implement) — the
      // floor guards against a broken extractor passing vacuously.
      expect(spawnLines(cl!).length).toBeGreaterThanOrEqual(4);
      expect(spawnOffenders(cl!, matchedByAllowEntry)).toEqual([]);
    });

    test("every /smoke-test spawn line is matched by Bash(claude:*)", () => {
      // Phase 2 non-prompt-bearing (3) + prompt-bearing (3) + STE-195
      // worked example (2) + Phase 8 (1) — floor of 8 guards vacuity.
      expect(spawnLines(st!).length).toBeGreaterThanOrEqual(8);
      expect(spawnOffenders(st!, matchedByAllowEntry)).toEqual([]);
    });
  },
);

describeSkills(
  "AC-STE-350.2 — /smoke-test Phase 1 scaffold carries the same authorizing entry",
  () => {
    interface ScaffoldResult {
      count: number;
      allow: string[] | null;
      parseError: string | null;
    }

    // Locate the `cat > .claude/settings.json <<'EOF'` heredoc inside the
    // Phase 1 step 6 bash fence and JSON-parse its body. The heredoc is the
    // canonical test-project allow-list (STE-106), shared verbatim by the
    // linear and jira tracker paths.
    function extractScaffoldAllow(content: string): ScaffoldResult {
      const lines = content.split("\n");
      const starts: number[] = [];
      for (let i = 0; i < lines.length; i++) {
        if (/cat\s+>\s+\.claude\/settings\.json\s+<<'EOF'/.test(lines[i]!)) {
          starts.push(i);
        }
      }
      if (starts.length !== 1) {
        return { count: starts.length, allow: null, parseError: null };
      }
      const body: string[] = [];
      for (let i = starts[0]! + 1; i < lines.length; i++) {
        if (lines[i]!.trim() === "EOF") break;
        body.push(lines[i]!);
      }
      try {
        const parsed = JSON.parse(body.join("\n")) as {
          permissions?: { allow?: unknown };
        };
        const allow = parsed.permissions?.allow;
        return {
          count: 1,
          allow: Array.isArray(allow) ? (allow as string[]) : null,
          parseError: Array.isArray(allow) ? null : "permissions.allow missing",
        };
      } catch (e) {
        return {
          count: 1,
          allow: null,
          parseError: e instanceof Error ? e.message : String(e),
        };
      }
    }

    test("the scaffold heredoc appears exactly once and is shared by both tracker paths", () => {
      const scaffold = extractScaffoldAllow(st!);
      expect(scaffold.count).toBe(1);
      // The skill's own prose pins the sharing contract — one heredoc, both
      // tracker paths ("identical in both tracker paths").
      expect(st!).toContain("identical in both tracker paths");
    });

    test("scaffolded allow-list includes the spawn entry Bash(claude:*)", () => {
      const scaffold = extractScaffoldAllow(st!);
      expect(scaffold.parseError).toBeNull();
      expect(scaffold.allow).not.toBeNull();
      expect(scaffold.allow!).toContain(SPAWN_ALLOW_ENTRY);
    });

    test("scaffolded allow-list equals the canonical test-project list including the spawn entry", () => {
      const scaffold = extractScaffoldAllow(st!);
      expect(scaffold.allow).not.toBeNull();
      // Order-insensitive equality: the canonical list defines membership;
      // the heredoc's on-page ordering is presentation, not contract.
      expect([...scaffold.allow!].sort()).toEqual(
        [...CANONICAL_SCAFFOLD_ALLOW].sort(),
      );
    });
  },
);

describeSkills(
  "AC-STE-350.3 — Resolution A: exported CLAUDE_CONFIG_DIR + bare claude -p spawns",
  () => {
    function inlinePrefixOffenders(content: string): string[] {
      return spawnOffenders(
        content,
        (s) => !/CLAUDE_CONFIG_DIR=\S*\s+claude\s+-p/.test(s.text),
      );
    }

    function bareSpawnOffenders(content: string): string[] {
      return spawnOffenders(content, (s) =>
        /^claude(\s|$)/.test(commandHead(s.text)),
      );
    }

    // Every fence that spawns `claude -p` must export CLAUDE_CONFIG_DIR
    // (with a non-empty value) on a line BEFORE its first spawn line, so
    // dropping the inline prefix does not silently retarget the child at
    // the default ~/.claude config dir.
    function missingExportOffenders(content: string): string[] {
      const out: string[] = [];
      for (const fence of extractBashFences(content)) {
        const spawns = extractSpawnLines([fence]);
        if (spawns.length === 0) continue;
        const firstSpawn = Math.min(...spawns.map((s) => s.offsetInFence));
        const exportIdx = fence.body.findIndex((line) =>
          /^\s*export\s+CLAUDE_CONFIG_DIR=\S+/.test(line),
        );
        if (exportIdx === -1 || exportIdx > firstSpawn) {
          out.push(
            `fence@${fence.startLine}: first spawn at offset ${firstSpawn}, export ${
              exportIdx === -1 ? "absent" : `at offset ${exportIdx}`
            }`,
          );
        }
      }
      return out;
    }

    test("/conformance-loop spawn lines carry no inline CLAUDE_CONFIG_DIR= prefix", () => {
      expect(inlinePrefixOffenders(cl!)).toEqual([]);
    });

    test("/smoke-test spawn lines carry no inline CLAUDE_CONFIG_DIR= prefix", () => {
      expect(inlinePrefixOffenders(st!)).toEqual([]);
    });

    test("/conformance-loop spawn lines begin bare with `claude` so Bash(claude:*) matches", () => {
      expect(bareSpawnOffenders(cl!)).toEqual([]);
    });

    test("/smoke-test spawn lines begin bare with `claude` so Bash(claude:*) matches", () => {
      expect(bareSpawnOffenders(st!)).toEqual([]);
    });

    test("/conformance-loop: every spawning fence exports CLAUDE_CONFIG_DIR before its first spawn", () => {
      expect(missingExportOffenders(cl!)).toEqual([]);
    });

    test("/smoke-test: every spawning fence exports CLAUDE_CONFIG_DIR before its first spawn", () => {
      expect(missingExportOffenders(st!)).toEqual([]);
    });
  },
);

describeSettings(
  "AC-STE-350.3 — the allow-list encodes Resolution A, not the env-prefixed form",
  () => {
    test("no allow entry is an env-prefixed Resolution-B variant (contains CLAUDE_CONFIG_DIR)", () => {
      const allow = allowList();
      const resolutionB = allow.filter((e) => e.includes("CLAUDE_CONFIG_DIR"));
      expect(resolutionB).toEqual([]);
    });
  },
);
