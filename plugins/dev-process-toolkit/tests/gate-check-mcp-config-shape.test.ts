import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMcpConfigShapeProbe } from "../adapters/_shared/src/mcp_config_shape";
import { runSetupPermissionsShapeProbe } from "../adapters/_shared/src/setup_permissions_shape";

function makeRoot(): string {
  return mkdtempSync(join(tmpdir(), "dpt-mcp-shape-"));
}
function cleanup(root: string): void {
  rmSync(root, { recursive: true, force: true });
}

describe("STE-209 — mcp-config-shape probe (AC-STE-209.4)", () => {
  test("clean .mcp.json with `type: http` passes", async () => {
    const root = makeRoot();
    try {
      writeFileSync(
        join(root, ".mcp.json"),
        '{\n  "mcpServers": {\n    "linear": {\n      "type": "http",\n      "url": "https://mcp.linear.app/mcp"\n    }\n  }\n}\n',
      );
      const r = await runMcpConfigShapeProbe(root);
      expect(r.violations).toEqual([]);
    } finally {
      cleanup(root);
    }
  });

  test("legacy .mcp.json with `transport: streamable-http` flags ADVISORY", async () => {
    const root = makeRoot();
    try {
      writeFileSync(
        join(root, ".mcp.json"),
        '{\n  "mcpServers": {\n    "linear": {\n      "url": "https://mcp.linear.app/mcp",\n      "transport": "streamable-http"\n    }\n  }\n}\n',
      );
      const r = await runMcpConfigShapeProbe(root);
      expect(r.violations.length).toBe(1);
      expect(r.violations[0]!.severity).toBe("advisory");
      expect(r.violations[0]!.note).toMatch(/\.mcp\.json:\d+/);
    } finally {
      cleanup(root);
    }
  });

  test("toolkit-shipped doc with the bug shape flags ERROR (severity escalates)", async () => {
    const root = makeRoot();
    try {
      const docPath = join(
        root,
        "plugins",
        "dev-process-toolkit",
        "docs",
        "setup-tracker-mode.md",
      );
      mkdirSync(join(root, "plugins/dev-process-toolkit/docs"), { recursive: true });
      writeFileSync(
        docPath,
        '"linear": {\n  "url": "https://mcp.linear.app/mcp",\n  "transport": "streamable-http"\n}\n',
      );
      const r = await runMcpConfigShapeProbe(root);
      expect(r.violations.length).toBe(1);
      expect(r.violations[0]!.severity).toBe("error");
    } finally {
      cleanup(root);
    }
  });

  test("vacuous when no .mcp.json present and no toolkit files", async () => {
    const root = makeRoot();
    try {
      const r = await runMcpConfigShapeProbe(root);
      expect(r.violations).toEqual([]);
    } finally {
      cleanup(root);
    }
  });
});

describe("STE-209 — setup-permissions-shape probe (AC-STE-209.6)", () => {
  test("explicit-subcommand allowlist passes clean", async () => {
    const root = makeRoot();
    try {
      mkdirSync(join(root, ".claude"), { recursive: true });
      writeFileSync(
        join(root, ".claude", "settings.json"),
        '{\n  "permissions": {\n    "allow": [\n      "Bash(git status)",\n      "Bash(git diff)"\n    ]\n  }\n}\n',
      );
      const r = await runSetupPermissionsShapeProbe(root);
      expect(r.violations).toEqual([]);
    } finally {
      cleanup(root);
    }
  });

  test("flags glob-shaped `Bash(git *)` as ADVISORY", async () => {
    const root = makeRoot();
    try {
      mkdirSync(join(root, ".claude"), { recursive: true });
      writeFileSync(
        join(root, ".claude", "settings.json"),
        '{\n  "permissions": {\n    "allow": [\n      "Bash(git *)",\n      "Bash(gh *)"\n    ]\n  }\n}\n',
      );
      const r = await runSetupPermissionsShapeProbe(root);
      expect(r.violations.length).toBe(2);
      expect(r.violations[0]!.rule).toBe("git *");
      expect(r.violations[1]!.rule).toBe("gh *");
      expect(r.violations[0]!.note).toMatch(/settings\.json:\d+ —/);
    } finally {
      cleanup(root);
    }
  });

  test("vacuous when settings.json is absent", async () => {
    const root = makeRoot();
    try {
      const r = await runSetupPermissionsShapeProbe(root);
      expect(r.violations).toEqual([]);
    } finally {
      cleanup(root);
    }
  });
});
