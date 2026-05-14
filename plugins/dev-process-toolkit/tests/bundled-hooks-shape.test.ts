// STE-289 — Hooks bundling redo regression guard.
//
// The 4 Process-category hooks moved from `/setup --hooks` writing to user
// `.claude/settings.json` over to plugin-bundled `hooks/hooks.json` so the
// Claude Code harness auto-discovers them at session start and expands
// `${CLAUDE_PLUGIN_ROOT}` against the plugin's runtime cache path.
//
// This single test file is the doc-conformance regression guard for all six
// ACs of STE-289 (the verify lines for AC.1 and AC.6 both point at
// `bun test plugins/dev-process-toolkit/tests/bundled-hooks-shape.test.ts`).
//
// AC mapping:
//   AC-STE-289.1 — bundled hooks.json shape (file + entry shape).
//   AC-STE-289.2 — install_hooks.ts + 5 setup test files + 1 stale test
//                  file (`tests/hooks-capability-rows.test.ts`) deleted.
//   AC-STE-289.3 — `--hooks` + `parsePreselectFlag` prose removed from
//                  skills/setup/SKILL.md.
//   AC-STE-289.4 — fixture group 8 removed from smoke-test SKILL.md.
//   AC-STE-289.5 — docs/hooks-reference.md rewritten to bundled model
//                  (mentions `hooks/hooks.json`; no `--hooks`).
//   AC-STE-289.6 — this test file exists and passes (covers AC.1 shape +
//                  defence against rename/delete drift on the hook scripts).

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const PLUGIN_ROOT = join(REPO_ROOT, "plugins", "dev-process-toolkit");

const HOOKS_JSON_PATH = join(PLUGIN_ROOT, "hooks", "hooks.json");
const HOOK_SCRIPTS_DIR = join(PLUGIN_ROOT, "templates", "hooks", "process");

const SETUP_SKILL_MD = join(PLUGIN_ROOT, "skills", "setup", "SKILL.md");
const SETUP_INSTALL_HOOKS_TS = join(
  PLUGIN_ROOT,
  "skills",
  "setup",
  "install_hooks.ts",
);
const SETUP_TESTS_DIR = join(PLUGIN_ROOT, "skills", "setup", "__tests__");
const HOOKS_CAPABILITY_ROWS_TEST = join(
  PLUGIN_ROOT,
  "tests",
  "hooks-capability-rows.test.ts",
);
const SMOKE_TEST_SKILL_MD = join(
  REPO_ROOT,
  ".claude",
  "skills",
  "smoke-test",
  "SKILL.md",
);
const HOOKS_REFERENCE_MD = join(PLUGIN_ROOT, "docs", "hooks-reference.md");

const DELETED_SETUP_TESTS = [
  "hooks_menu_prompt.test.ts",
  "hooks_merge_settings.test.ts",
  "setup_hooks_flag.test.ts",
  "setup_hooks_preselect.test.ts",
  "smoke_fixture_group_8_doc_conformance.test.ts",
];

const EXPECTED_COMMAND_PREFIX =
  '"${CLAUDE_PLUGIN_ROOT}"/templates/hooks/process/';

type HookEntry = {
  type?: string;
  command?: string;
  timeout?: number;
};

type MatcherEntry = {
  matcher?: string;
  hooks?: HookEntry[];
};

type HooksJson = {
  hooks?: {
    PreToolUse?: MatcherEntry[];
    UserPromptSubmit?: MatcherEntry[];
    [key: string]: MatcherEntry[] | undefined;
  };
};

function readHooksJson(): HooksJson {
  const body = readFileSync(HOOKS_JSON_PATH, "utf-8");
  return JSON.parse(body) as HooksJson;
}

/**
 * Flatten the (matcher, hooks[]) groups of one event into a list of
 * { matcher, command } pairs in declaration order.
 */
function flattenEvent(
  groups: MatcherEntry[] | undefined,
): Array<{ matcher: string; command: string; timeout: number | undefined }> {
  if (!groups) {
    return [];
  }
  const out: Array<{
    matcher: string;
    command: string;
    timeout: number | undefined;
  }> = [];
  for (const group of groups) {
    const matcher = group.matcher ?? "";
    for (const h of group.hooks ?? []) {
      out.push({
        matcher,
        command: h.command ?? "",
        timeout: h.timeout,
      });
    }
  }
  return out;
}

describe("AC-STE-289.1 / AC-STE-289.6 — bundled hooks.json shape", () => {
  test("plugins/dev-process-toolkit/hooks/hooks.json exists", () => {
    expect(existsSync(HOOKS_JSON_PATH)).toBe(true);
  });

  test("hooks.json parses as valid JSON with top-level `hooks` object", () => {
    const parsed = readHooksJson();
    expect(parsed).toBeDefined();
    expect(typeof parsed.hooks).toBe("object");
    expect(parsed.hooks).not.toBeNull();
  });

  test("hooks.json carries exactly 4 total hook entries", () => {
    const parsed = readHooksJson();
    const pre = flattenEvent(parsed.hooks?.PreToolUse);
    const ups = flattenEvent(parsed.hooks?.UserPromptSubmit);
    expect(pre.length + ups.length).toBe(4);
  });

  test("PreToolUse has 3 hooks under matcher `Bash`", () => {
    const parsed = readHooksJson();
    const pre = flattenEvent(parsed.hooks?.PreToolUse);
    expect(pre.length).toBe(3);
    for (const entry of pre) {
      expect(entry.matcher).toBe("Bash");
    }
  });

  test("UserPromptSubmit has 1 hook under matcher `*`", () => {
    const parsed = readHooksJson();
    const ups = flattenEvent(parsed.hooks?.UserPromptSubmit);
    expect(ups.length).toBe(1);
    expect(ups[0]!.matcher).toBe("*");
  });

  test("every command field starts with the literal `${CLAUDE_PLUGIN_ROOT}` token prefix", () => {
    const parsed = readHooksJson();
    const all = [
      ...flattenEvent(parsed.hooks?.PreToolUse),
      ...flattenEvent(parsed.hooks?.UserPromptSubmit),
    ];
    expect(all.length).toBeGreaterThan(0);
    for (const entry of all) {
      expect(entry.command.startsWith(EXPECTED_COMMAND_PREFIX)).toBe(true);
    }
  });

  test("every hook entry carries `timeout: 5000`", () => {
    const parsed = readHooksJson();
    const all = [
      ...flattenEvent(parsed.hooks?.PreToolUse),
      ...flattenEvent(parsed.hooks?.UserPromptSubmit),
    ];
    for (const entry of all) {
      expect(entry.timeout).toBe(5000);
    }
  });

  test("each command path resolves to an existing .sh file under templates/hooks/process/", () => {
    const parsed = readHooksJson();
    const all = [
      ...flattenEvent(parsed.hooks?.PreToolUse),
      ...flattenEvent(parsed.hooks?.UserPromptSubmit),
    ];
    expect(all.length).toBeGreaterThan(0);
    for (const entry of all) {
      // Strip the literal-token prefix to recover the relative script path,
      // then resolve against the on-disk templates dir. Defends against
      // script rename/delete drift.
      const rel = entry.command.slice(EXPECTED_COMMAND_PREFIX.length);
      expect(rel.endsWith(".sh")).toBe(true);
      const resolved = join(HOOK_SCRIPTS_DIR, rel);
      expect(existsSync(resolved)).toBe(true);
    }
  });

  test("≥ 4 raw-byte occurrences of the literal `${CLAUDE_PLUGIN_ROOT}` token in hooks.json source", () => {
    // AC.1's verify line spirit: at least one literal-token reference per
    // hook entry. We assert against the raw JSON bytes (not the parsed AST)
    // so a future shape change that swaps the literal for an absolute path
    // trips this guard immediately. The chosen inline form quotes the var
    // (`"${CLAUDE_PLUGIN_ROOT}"/templates/hooks/process/<name>.sh`), so the
    // raw bytes carry `\"` around the token after JSON escaping; we count
    // the bare `${CLAUDE_PLUGIN_ROOT}` token instead, which is invariant
    // across quote-wrapping choices.
    const body = readFileSync(HOOKS_JSON_PATH, "utf-8");
    const needle = "${CLAUDE_PLUGIN_ROOT}";
    let count = 0;
    let from = 0;
    while (true) {
      const idx = body.indexOf(needle, from);
      if (idx === -1) break;
      count += 1;
      from = idx + needle.length;
    }
    expect(count).toBeGreaterThanOrEqual(4);
  });
});

describe("AC-STE-289.2 — install_hooks.ts + 5 setup test files + hooks-capability-rows.test.ts deleted", () => {
  test("plugins/dev-process-toolkit/skills/setup/install_hooks.ts does NOT exist", () => {
    expect(existsSync(SETUP_INSTALL_HOOKS_TS)).toBe(false);
  });

  for (const fname of DELETED_SETUP_TESTS) {
    test(`setup test file ${fname} does NOT exist`, () => {
      expect(existsSync(join(SETUP_TESTS_DIR, fname))).toBe(false);
    });
  }

  test("plugins/dev-process-toolkit/tests/hooks-capability-rows.test.ts does NOT exist (logically forced by AC.3 prose removal)", () => {
    expect(existsSync(HOOKS_CAPABILITY_ROWS_TEST)).toBe(false);
  });
});

describe("AC-STE-289.3 — `--hooks` and `parsePreselectFlag` removed from setup SKILL.md", () => {
  test("skills/setup/SKILL.md exists", () => {
    expect(existsSync(SETUP_SKILL_MD)).toBe(true);
  });

  test("skills/setup/SKILL.md has zero occurrences of `--hooks`", () => {
    const body = readFileSync(SETUP_SKILL_MD, "utf-8");
    expect(body.includes("--hooks")).toBe(false);
  });

  test("skills/setup/SKILL.md has zero occurrences of `parsePreselectFlag`", () => {
    const body = readFileSync(SETUP_SKILL_MD, "utf-8");
    expect(body.includes("parsePreselectFlag")).toBe(false);
  });
});

describe("AC-STE-289.4 — fixture group 8 removed from smoke-test SKILL.md", () => {
  test(".claude/skills/smoke-test/SKILL.md exists", () => {
    expect(existsSync(SMOKE_TEST_SKILL_MD)).toBe(true);
  });

  test("smoke-test SKILL.md has zero occurrences of `fixture group 8`", () => {
    const body = readFileSync(SMOKE_TEST_SKILL_MD, "utf-8");
    expect(body.includes("fixture group 8")).toBe(false);
  });

  test("smoke-test SKILL.md has zero occurrences of `STE-285 hooks runtime regression`", () => {
    const body = readFileSync(SMOKE_TEST_SKILL_MD, "utf-8");
    expect(body.includes("STE-285 hooks runtime regression")).toBe(false);
  });
});

describe("AC-STE-290.3 — bash shims reduced to 2-line `exec bun run` wrappers", () => {
  // STE-290 ports session.sh + per-hook bash logic into Bun TS modules under
  // `_lib/hooks/`. The bash entry-points at `process/<name>.sh` shrink to a
  // shebang + a single `exec bun run "${CLAUDE_PLUGIN_ROOT}/templates/hooks/_lib/hooks/<name>.ts"`
  // line. Filenames + `.sh` extension preserved so AC-STE-289.6's
  // command-path-resolves test stays GREEN.
  const SHIMS = [
    "pre-commit-gate-check",
    "pre-pr-spec-review",
    "pre-commit-tdd-orchestrator",
    "pre-spec-write-brainstorm-reminder",
  ];

  for (const name of SHIMS) {
    test(`${name}.sh is at most 3 lines (shebang + exec + optional trailing newline)`, () => {
      const path = join(HOOK_SCRIPTS_DIR, `${name}.sh`);
      expect(existsSync(path)).toBe(true);
      const body = readFileSync(path, "utf-8");
      // Trim a single trailing newline so a POSIX-conformant file with a
      // final \n doesn't artificially count as an extra line.
      const trimmed = body.endsWith("\n") ? body.slice(0, -1) : body;
      const lineCount = trimmed.split("\n").length;
      expect(lineCount).toBeLessThanOrEqual(3);
    });

    test(`${name}.sh body invokes \`bun run\` against the corresponding _lib/hooks/<name>.ts module`, () => {
      const path = join(HOOK_SCRIPTS_DIR, `${name}.sh`);
      const body = readFileSync(path, "utf-8");
      // The new contract: shim execs the TS module via `bun run`. Path
      // anchored on `${CLAUDE_PLUGIN_ROOT}` so the harness expands it.
      expect(body).toContain("bun run");
      expect(body).toContain(`_lib/hooks/${name}.ts`);
    });
  }
});

describe("AC-STE-289.5 — docs/hooks-reference.md rewritten to bundled-hooks model", () => {
  test("plugins/dev-process-toolkit/docs/hooks-reference.md exists", () => {
    expect(existsSync(HOOKS_REFERENCE_MD)).toBe(true);
  });

  test("hooks-reference.md mentions `hooks/hooks.json` at least once", () => {
    const body = readFileSync(HOOKS_REFERENCE_MD, "utf-8");
    const count = body.split("hooks/hooks.json").length - 1;
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test("hooks-reference.md has zero occurrences of `--hooks`", () => {
    const body = readFileSync(HOOKS_REFERENCE_MD, "utf-8");
    expect(body.includes("--hooks")).toBe(false);
  });
});
