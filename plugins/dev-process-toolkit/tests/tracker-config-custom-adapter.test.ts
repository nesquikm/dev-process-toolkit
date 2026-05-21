// STE-321 AC-STE-321.6 — Custom-adapter cross-check via `name:` field.
//
// Exercises the post-fix contract: a synthetic `gitlab` adapter
// (frontmatter `name: gitlab`) is ACCEPTED by validateTrackerConfig when
// `activeAdapterKey === "gitlab"`, and REJECTED only on adapter-name
// mismatch — not on the historical hard-coded `{linear, jira}` allowlist.
//
// Pre-fix this whole file would have FAILed because validateTrackerConfig
// rejected any tracker_key outside the allowlist.

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const pluginRoot = join(import.meta.dir, "..");

function makeProject(adapterName: string, mode: string): {
  projectRoot: string;
  claudeMdPath: string;
  adaptersDir: string;
  specsDir: string;
  cleanup: () => void;
} {
  const projectRoot = mkdtempSync(join(tmpdir(), "ste-321-custom-adapter-"));
  const adaptersDir = join(projectRoot, "adapters");
  const specsDir = join(projectRoot, "specs");
  mkdirSync(adaptersDir, { recursive: true });
  mkdirSync(specsDir, { recursive: true });
  writeFileSync(
    join(adaptersDir, `${adapterName}.md`),
    `---
name: ${adapterName}
mcp_server: ${adapterName}
ticket_id_regex: '^([A-Z]+-[0-9]+)$'
ticket_id_source: branch-name
ac_storage_convention: description-section
status_mapping:
  in_progress: In Progress
  in_review: In Review
  done: Done
capabilities:
  - pull_acs
project_milestone: false
ticket_description_template: |
  {fr_body}
helpers_dir: adapters/${adapterName}/src
resolver:
  id_pattern: '^[A-Z]+-\\d+$'
  url_host: 'example.com'
  url_path_regex: '/issue/([A-Z]+-\\d+)'
---

# ${adapterName} adapter (synthetic test fixture).
`,
  );
  writeFileSync(
    join(projectRoot, "CLAUDE.md"),
    `# Project\n\n## Task Tracking\n\nmode: ${mode}\nmcp_server: ${adapterName}\n`,
  );
  return {
    projectRoot,
    claudeMdPath: join(projectRoot, "CLAUDE.md"),
    adaptersDir,
    specsDir,
    cleanup: () => rmSync(projectRoot, { recursive: true, force: true }),
  };
}

function gitlabConfig(): {
  tracker_key: string;
  statuses: string[];
  roles: Record<string, string>;
} {
  return {
    tracker_key: "gitlab",
    statuses: ["Backlog", "In Progress", "In Review", "Done"],
    roles: {
      initial: "Backlog",
      in_progress: "In Progress",
      in_review: "In Review",
      done: "Done",
    },
  };
}

describe("AC-STE-321.6 — synthetic `gitlab` adapter accepted post-fix", () => {
  test("validateTrackerConfig accepts gitlab with activeAdapterKey='gitlab'", async () => {
    const { validateTrackerConfig } = await import(
      join(pluginRoot, "adapters", "_shared", "src", "tracker_config.ts")
    );
    const cfg = gitlabConfig();
    expect(() => validateTrackerConfig(cfg as never, "gitlab")).not.toThrow();
  });

  test("validateTrackerConfig accepts gitlab when no activeAdapterKey passed", async () => {
    const { validateTrackerConfig } = await import(
      join(pluginRoot, "adapters", "_shared", "src", "tracker_config.ts")
    );
    const cfg = gitlabConfig();
    // The allowlist is gone — when no cross-check is provided, schema
    // validation alone must accept any well-formed tracker_key string.
    expect(() => validateTrackerConfig(cfg as never)).not.toThrow();
  });

  test("validateTrackerConfig rejects gitlab when activeAdapterKey mismatches", async () => {
    const { validateTrackerConfig, TrackerConfigShapeError } = await import(
      join(pluginRoot, "adapters", "_shared", "src", "tracker_config.ts")
    );
    const cfg = gitlabConfig();
    expect(() => validateTrackerConfig(cfg as never, "linear")).toThrow(
      TrackerConfigShapeError,
    );
  });

  test("end-to-end: gitlab adapter + readAdapterName + validateTrackerConfig agree", async () => {
    const { validateTrackerConfig } = await import(
      join(pluginRoot, "adapters", "_shared", "src", "tracker_config.ts")
    );
    const { readAdapterName } = await import(
      join(pluginRoot, "adapters", "_shared", "src", "read_adapter_name.ts")
    );

    const ctx = makeProject("gitlab", "gitlab");
    try {
      const adapterName = readAdapterName(ctx.claudeMdPath, ctx.adaptersDir, "gitlab");
      expect(adapterName).toBe("gitlab");

      const cfg = gitlabConfig();
      // The runtime cross-check is `tracker_key === adapterName` per the
      // promoted L194-199 rule.
      expect(() => validateTrackerConfig(cfg as never, adapterName)).not.toThrow();
    } finally {
      ctx.cleanup();
    }
  });

  test("readTrackerConfig + write round-trip works for gitlab", async () => {
    const { readTrackerConfig, writeTrackerConfig } = await import(
      join(pluginRoot, "adapters", "_shared", "src", "tracker_config.ts")
    );
    const ctx = makeProject("gitlab", "gitlab");
    try {
      writeTrackerConfig(ctx.specsDir, gitlabConfig() as never);
      const readBack = readTrackerConfig(ctx.specsDir);
      expect(readBack).not.toBeNull();
      expect(readBack!.tracker_key).toBe("gitlab");
      expect(readBack!.roles.in_progress).toBe("In Progress");
    } finally {
      ctx.cleanup();
    }
  });
});
