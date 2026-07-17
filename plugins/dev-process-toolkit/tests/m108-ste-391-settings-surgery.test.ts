// M108 STE-391 AC-STE-391.5 + AC-STE-391.6 — the two settings-surgery seed
// entries.
//
// AC.5 — stale v2.21 hook entries: detector matches the four dead
// `dev-process-toolkit` hook entries that `/setup --hooks` (v2.21.0–v2.22.1)
// wrote into `.claude/settings.json`; action removes exactly those entries and
// preserves every other byte of user settings (merge-aware JSON surgery,
// STE-209 precedent).
//
// AC.6 — permission shapes: detector matches glob-shaped `Bash(<cmd> *)` rules
// in `permissions.allow` and `{"transport": ...}`-shaped `.mcp.json` entries
// (both retired in v2.7.0); action rewrites to explicit-subcommand allowlists
// projected from `templates/permissions.json` and the `{"type": "http"}` entry
// shape. This entry NEVER auto-applies (`requires_explicit_approval: true`).

import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { MIGRATIONS, type MigrationEntry } from "../adapters/_shared/src/migrations/index";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const PERMISSIONS_TEMPLATE = join(PLUGIN_ROOT, "templates", "permissions.json");

// The four dead hook scripts /setup --hooks used to register (STE-285/STE-288).
const DEAD_HOOK_BASENAMES = [
  "pre-commit-gate-check.sh",
  "pre-pr-spec-review.sh",
  "pre-commit-tdd-orchestrator.sh",
  "pre-spec-write-brainstorm-reminder.sh",
];
const HOOK_PATH_FRAGMENT = "templates/hooks/process/";

const tmpRoots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "ste-391-settings-"));
  tmpRoots.push(root);
  return root;
}

function cleanup(): void {
  while (tmpRoots.length > 0) {
    const dir = tmpRoots.pop()!;
    if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
}

function writeJson(root: string, rel: string, value: unknown): string {
  const full = join(root, ...rel.split("/"));
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, `${JSON.stringify(value, null, 2)}\n`);
  return full;
}

function detecting(root: string): MigrationEntry[] {
  return MIGRATIONS.filter((e) => e.detect(root).applies);
}

function soleDetectingEntry(root: string): MigrationEntry {
  const hits = detecting(root);
  expect(hits.map((e) => e.id).length).toBe(1);
  return hits[0]!;
}

function staleHook(basename: string, prefix: string): Record<string, unknown> {
  return {
    type: "command",
    command: "bash",
    args: [`${prefix}${HOOK_PATH_FRAGMENT}${basename}`],
    timeout: 5000,
  };
}

const USER_HOOK = { type: "command", command: "./my-own-hook.sh" };

/** Legacy settings.json carrying the four dead entries + genuine user content. */
function legacyHookSettings(prefix: string): Record<string, unknown> {
  return {
    model: "opus-4",
    permissions: { allow: ["Bash(git status)"] },
    hooks: {
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [
            staleHook("pre-commit-gate-check.sh", prefix),
            staleHook("pre-pr-spec-review.sh", prefix),
            staleHook("pre-commit-tdd-orchestrator.sh", prefix),
            USER_HOOK,
          ],
        },
      ],
      UserPromptSubmit: [
        {
          matcher: "*",
          hooks: [staleHook("pre-spec-write-brainstorm-reminder.sh", prefix)],
        },
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// AC-STE-391.5 — stale v2.21 hook entries
// ---------------------------------------------------------------------------

describe("AC-STE-391.5 — detector matches both shipped stale shapes", () => {
  test("the v2.22.1 literal-token shape (${CLAUDE_PLUGIN_ROOT}/…) fires", () => {
    const root = makeRoot();
    writeJson(root, ".claude/settings.json", legacyHookSettings("${CLAUDE_PLUGIN_ROOT}/"));
    const entry = soleDetectingEntry(root);
    expect(entry.kind).toBe("script");
    expect(entry.requires_explicit_approval).toBeFalsy();
    const res = entry.detect(root);
    expect(res.applies).toBe(true);
    expect(res.evidence.join("\n")).toMatch(/templates\/hooks\/process|pre-commit-gate-check/);
    cleanup();
  });

  test("the v2.21.0 dev-clone absolute-path shape fires too", () => {
    const root = makeRoot();
    writeJson(
      root,
      ".claude/settings.json",
      legacyHookSettings("/Users/someone/workspace/dev-process-toolkit/plugins/dev-process-toolkit/"),
    );
    expect(soleDetectingEntry(root).detect(root).applies).toBe(true);
    cleanup();
  });

  test("settings with ONLY user hooks do not fire, and detect leaves the file untouched", () => {
    const root = makeRoot();
    const file = writeJson(root, ".claude/settings.json", {
      model: "opus-4",
      hooks: { PreToolUse: [{ matcher: "Bash", hooks: [USER_HOOK] }] },
    });
    const before = { content: readFileSync(file, "utf-8"), mtimeMs: statSync(file).mtimeMs };

    expect(detecting(root).map((e) => e.id)).toEqual([]);
    expect(readFileSync(file, "utf-8")).toBe(before.content);
    expect(statSync(file).mtimeMs).toBe(before.mtimeMs);
    cleanup();
  });
});

describe("AC-STE-391.5 — apply removes exactly the four dead entries", () => {
  test("stale entries gone; user hook, model, and permissions preserved", () => {
    const root = makeRoot();
    const file = writeJson(root, ".claude/settings.json", legacyHookSettings("${CLAUDE_PLUGIN_ROOT}/"));
    const entry = soleDetectingEntry(root);

    const result = entry.apply!(root);
    expect(result.changed.length).toBeGreaterThan(0);
    expect(result.summary.length).toBeGreaterThan(0);

    const parsed = JSON.parse(readFileSync(file, "utf-8")) as {
      model?: unknown;
      permissions?: unknown;
      hooks?: Record<string, Array<{ matcher: string; hooks: Array<{ command: string; args?: string[] }> }>>;
    };

    // Every trace of the dead registrations is gone…
    const serialized = JSON.stringify(parsed);
    expect(serialized).not.toContain(HOOK_PATH_FRAGMENT);
    for (const basename of DEAD_HOOK_BASENAMES) {
      expect(serialized).not.toContain(basename);
    }

    // …while user content survives the surgery.
    expect(parsed.model).toBe("opus-4");
    expect(parsed.permissions).toEqual({ allow: ["Bash(git status)"] });
    const preToolUse = parsed.hooks?.PreToolUse ?? [];
    const survivingCommands = preToolUse.flatMap((m) => m.hooks.map((h) => h.command));
    expect(survivingCommands).toContain("./my-own-hook.sh");

    // Merge-aware surgery leaves no dangling empty matcher shells behind.
    for (const matchers of Object.values(parsed.hooks ?? {})) {
      for (const m of matchers) expect(m.hooks.length).toBeGreaterThan(0);
    }
    cleanup();
  });

  test("apply → detect=false; re-apply is a byte-level no-op", () => {
    const root = makeRoot();
    const file = writeJson(root, ".claude/settings.json", legacyHookSettings("${CLAUDE_PLUGIN_ROOT}/"));
    const entry = soleDetectingEntry(root);

    entry.apply!(root);
    expect(entry.detect(root).applies).toBe(false);

    const before = readFileSync(file, "utf-8");
    const second = entry.apply!(root);
    expect(second.changed).toEqual([]);
    expect(readFileSync(file, "utf-8")).toBe(before);
    cleanup();
  });
});

// ---------------------------------------------------------------------------
// AC-STE-391.6 — permission shapes
// ---------------------------------------------------------------------------

describe("AC-STE-391.6 — detector matches both retired v2.7.0 shapes", () => {
  test("a glob-shaped Bash rule in permissions.allow fires", () => {
    const root = makeRoot();
    writeJson(root, ".claude/settings.json", {
      model: "opus-4",
      permissions: {
        allow: ["Bash(bun *)", "Bash(git status)", "Read(~/.zshrc)"],
        deny: ["Bash(sudo rm)"],
      },
    });
    const entry = soleDetectingEntry(root);
    expect(entry.kind).toBe("script");
    const res = entry.detect(root);
    expect(res.applies).toBe(true);
    expect(res.evidence.join("\n")).toContain("Bash(bun *)");
    cleanup();
  });

  test("a transport-shaped .mcp.json entry fires (no settings.json needed)", () => {
    const root = makeRoot();
    writeJson(root, ".mcp.json", {
      mcpServers: {
        linear: { transport: "streamable-http", url: "https://mcp.linear.app/mcp" },
      },
    });
    expect(soleDetectingEntry(root).detect(root).applies).toBe(true);
    cleanup();
  });

  test("explicit-subcommand rules + type:http entries do NOT fire, and detect touches nothing", () => {
    const root = makeRoot();
    const settings = writeJson(root, ".claude/settings.json", {
      permissions: { allow: ["Bash(bun test)", "Bash(git status)"] },
    });
    const mcp = writeJson(root, ".mcp.json", {
      mcpServers: { linear: { type: "http", url: "https://mcp.linear.app/mcp" } },
    });
    const before = [settings, mcp].map((f) => ({
      content: readFileSync(f, "utf-8"),
      mtimeMs: statSync(f).mtimeMs,
    }));

    expect(detecting(root).map((e) => e.id)).toEqual([]);
    [settings, mcp].forEach((f, i) => {
      expect(readFileSync(f, "utf-8")).toBe(before[i]!.content);
      expect(statSync(f).mtimeMs).toBe(before[i]!.mtimeMs);
    });
    cleanup();
  });

  test("the entry carries the never-auto-apply rail: requires_explicit_approval === true", () => {
    const root = makeRoot();
    writeJson(root, ".claude/settings.json", {
      permissions: { allow: ["Bash(bun *)"] },
    });
    const entry = soleDetectingEntry(root);
    // AC.6: explicit per-entry operator approval is required even when the
    // auto-approve marker is present — it rewrites the user's security config.
    expect(entry.requires_explicit_approval).toBe(true);
    cleanup();
  });
});

describe("AC-STE-391.6 — apply rewrites to the canonical shapes", () => {
  test("glob rules become the explicit-subcommand projection from templates/permissions.json", () => {
    const root = makeRoot();
    const file = writeJson(root, ".claude/settings.json", {
      model: "opus-4",
      permissions: {
        allow: ["Bash(bun *)", "Bash(git status)", "Read(~/.zshrc)"],
        deny: ["Bash(sudo rm)"],
      },
    });
    const entry = soleDetectingEntry(root);
    const result = entry.apply!(root);
    expect(result.changed.length).toBeGreaterThan(0);

    const parsed = JSON.parse(readFileSync(file, "utf-8")) as {
      model?: unknown;
      permissions: { allow: string[]; deny?: string[] };
    };

    // No glob-shaped Bash rule survives (the STE-209 GLOB_RULE shape).
    for (const rule of parsed.permissions.allow) {
      expect(rule).not.toMatch(/^Bash\([^)]*\s\*\)$/);
    }

    // The projection comes from the template, not from thin air: every
    // explicit bun subcommand the template declares replaces `Bash(bun *)`.
    const template = JSON.parse(readFileSync(PERMISSIONS_TEMPLATE, "utf-8")) as {
      stacks: Record<string, string[]>;
    };
    expect(template.stacks.bun!.length).toBeGreaterThan(0);
    for (const rule of template.stacks.bun!) {
      expect(parsed.permissions.allow).toContain(rule);
    }

    // Non-glob user rules and every other user byte survive.
    expect(parsed.permissions.allow).toContain("Bash(git status)");
    expect(parsed.permissions.allow).toContain("Read(~/.zshrc)");
    expect(parsed.permissions.deny).toEqual(["Bash(sudo rm)"]);
    expect(parsed.model).toBe("opus-4");
    cleanup();
  });

  test("transport-shaped .mcp.json entries become {\"type\": \"http\"}; stdio entries untouched", () => {
    const root = makeRoot();
    const file = writeJson(root, ".mcp.json", {
      mcpServers: {
        linear: { transport: "streamable-http", url: "https://mcp.linear.app/mcp" },
        local: { command: "bun", args: ["run", "server.ts"] },
      },
    });
    const entry = soleDetectingEntry(root);
    entry.apply!(root);

    const parsed = JSON.parse(readFileSync(file, "utf-8")) as {
      mcpServers: Record<string, Record<string, unknown>>;
    };
    expect(parsed.mcpServers.linear).toEqual({
      type: "http",
      url: "https://mcp.linear.app/mcp",
    });
    // The stdio schema branch is out of scope and must survive byte-for-byte.
    expect(parsed.mcpServers.local).toEqual({ command: "bun", args: ["run", "server.ts"] });
    cleanup();
  });

  test("apply → detect=false; re-apply is a no-op", () => {
    const root = makeRoot();
    const settings = writeJson(root, ".claude/settings.json", {
      permissions: { allow: ["Bash(bun *)"] },
    });
    writeJson(root, ".mcp.json", {
      mcpServers: { linear: { transport: "streamable-http", url: "https://mcp.linear.app/mcp" } },
    });
    const entry = soleDetectingEntry(root);

    entry.apply!(root);
    expect(entry.detect(root).applies).toBe(false);

    const before = readFileSync(settings, "utf-8");
    const second = entry.apply!(root);
    expect(second.changed).toEqual([]);
    expect(readFileSync(settings, "utf-8")).toBe(before);
    cleanup();
  });
});
