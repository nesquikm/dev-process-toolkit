// STE-321 (M84) — Adapter shape: drop tracker_config allowlist + align
// mode-none frontmatter.
//
// Covers AC-STE-321.{1, 2, 3, 4, 8, 9, 10}. Per-AC test groups assert the
// byte-checkable invariants:
//
//   - AC.1: tracker_config.ts drops `type TrackerKey` and
//     `SUPPORTED_TRACKER_KEYS`; tracker_config_proposal.ts drops the
//     `TrackerKey` import + `as TrackerKey` cast.
//   - AC.2: `readAdapterName(claudeMdPath, adaptersDir, mode)` exists at
//     `adapters/_shared/src/read_adapter_name.ts` and round-trips
//     name extraction + MalformedAdapterMetadataError on missing.
//   - AC.3: specs/technical-spec.md mode-none Schema Q example shows no
//     `tracker: {}` line, only the 5 mode-invariant keys + `id:`.
//   - AC.4: skills/gate-check/SKILL.md probe #2 (line ~26) drops `tracker`
//     from the mode-invariant list and documents `id:` / `tracker:` as
//     mode-conditional.
//   - AC.8: skills/gate-check/SKILL.md probe #52 prose drops the literal
//     `tracker_key ∈ {linear, jira}` and adopts the adapter-name
//     cross-check phrasing.
//   - AC.9: `validateTrackerConfig` continues to be the schema authority;
//     read-time `readTrackerConfig` does NOT cross-check `tracker_key`
//     against the active adapter (probe path owns enforcement).
//   - AC.10: identity_mode_conditional.ts exports a
//     `scanFrontmatterForTracker` helper used by probe #13.

import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const pluginRoot = join(import.meta.dir, "..");
const repoRoot = join(pluginRoot, "..", "..");

function read(path: string): string {
  return readFileSync(path, "utf8");
}

// ---------------------------------------------------------------------------
// AC-STE-321.1 — allowlist removed from tracker_config.ts (+ lockstep edit
// to tracker_config_proposal.ts).
// ---------------------------------------------------------------------------

describe("AC-STE-321.1 — tracker_config.ts drops TrackerKey + SUPPORTED_TRACKER_KEYS", () => {
  const src = read(join(pluginRoot, "adapters", "_shared", "src", "tracker_config.ts"));

  test("`type TrackerKey` declaration removed", () => {
    expect(src).not.toMatch(/^export\s+type\s+TrackerKey\b/m);
    expect(src).not.toMatch(/^\s*type\s+TrackerKey\s*=/m);
  });

  test("`SUPPORTED_TRACKER_KEYS` const removed", () => {
    expect(src).not.toMatch(/\bSUPPORTED_TRACKER_KEYS\b/);
  });

  test("the literal `linear`/`jira` allowlist (string-list form) is gone", () => {
    // No hard-coded `["linear", "jira"]` allowlist anywhere in tracker_config.ts.
    expect(src).not.toMatch(/\[\s*"linear"\s*,\s*"jira"\s*\]/);
  });

  test("validator no longer rejects non-linear/non-jira tracker_key in isolation", async () => {
    const { validateTrackerConfig } = await import(
      join(pluginRoot, "adapters", "_shared", "src", "tracker_config.ts")
    );
    const cfg = {
      tracker_key: "gitlab",
      statuses: ["Backlog", "In Progress", "In Review", "Done"],
      roles: {
        initial: "Backlog",
        in_progress: "In Progress",
        in_review: "In Review",
        done: "Done",
      },
    };
    // Without an activeAdapterKey argument, validateTrackerConfig must NOT
    // reject `gitlab` outright — the allowlist is gone.
    expect(() => validateTrackerConfig(cfg)).not.toThrow();
  });

  test("validator throws on mismatch with activeAdapterKey (cross-check survives)", async () => {
    const { validateTrackerConfig, TrackerConfigShapeError } = await import(
      join(pluginRoot, "adapters", "_shared", "src", "tracker_config.ts")
    );
    const cfg = {
      tracker_key: "gitlab",
      statuses: ["Backlog", "In Progress", "In Review", "Done"],
      roles: {
        initial: "Backlog",
        in_progress: "In Progress",
        in_review: "In Review",
        done: "Done",
      },
    };
    expect(() => validateTrackerConfig(cfg, "linear")).toThrow(TrackerConfigShapeError);
  });
});

describe("AC-STE-321.1 lockstep — tracker_config_proposal.ts drops TrackerKey import + cast", () => {
  const src = read(
    join(pluginRoot, "adapters", "_shared", "src", "tracker_config_proposal.ts"),
  );

  test("import block no longer references TrackerKey", () => {
    // Scan only the top-of-file import-block, not the whole module.
    const imports = src.split("\n").slice(0, 40).join("\n");
    expect(imports).not.toMatch(/\bTrackerKey\b/);
  });

  test("`as TrackerKey` cast removed", () => {
    expect(src).not.toMatch(/as\s+TrackerKey\b/);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-321.2 — readAdapterName helper exists + works.
// ---------------------------------------------------------------------------

describe("AC-STE-321.2 — readAdapterName helper at adapters/_shared/src/read_adapter_name.ts", () => {
  const helperPath = join(pluginRoot, "adapters", "_shared", "src", "read_adapter_name.ts");

  test("helper module exists", () => {
    expect(existsSync(helperPath)).toBe(true);
  });

  test("exports `readAdapterName(claudeMdPath, adaptersDir, mode)`", async () => {
    const mod = await import(helperPath);
    expect(typeof mod.readAdapterName).toBe("function");
    expect(mod.readAdapterName.length).toBe(3);
  });

  test("returns the `name:` field from adapters/<mode>.md frontmatter", async () => {
    const { readAdapterName } = await import(helperPath);
    const adaptersDir = join(pluginRoot, "adapters");
    const claudeMdPath = join(repoRoot, "CLAUDE.md");
    expect(readAdapterName(claudeMdPath, adaptersDir, "linear")).toBe("linear");
    expect(readAdapterName(claudeMdPath, adaptersDir, "jira")).toBe("jira");
  });

  test("throws MalformedAdapterMetadataError when adapter file is absent", async () => {
    const { readAdapterName } = await import(helperPath);
    const { MalformedAdapterMetadataError } = await import(
      join(pluginRoot, "adapters", "_shared", "src", "resolver_config.ts")
    );
    const adaptersDir = join(pluginRoot, "adapters");
    const claudeMdPath = join(repoRoot, "CLAUDE.md");
    expect(() =>
      readAdapterName(claudeMdPath, adaptersDir, "no-such-adapter"),
    ).toThrow(MalformedAdapterMetadataError);
  });

  test("throws MalformedAdapterMetadataError when frontmatter lacks `name:`", async () => {
    const { readAdapterName } = await import(helperPath);
    const { MalformedAdapterMetadataError } = await import(
      join(pluginRoot, "adapters", "_shared", "src", "resolver_config.ts")
    );
    const tmpRoot = mkdtempSync(join(tmpdir(), "ste-321-read-adapter-name-"));
    try {
      const adaptersDir = join(tmpRoot, "adapters");
      mkdirSync(adaptersDir, { recursive: true });
      const adapterPath = join(adaptersDir, "wonky.md");
      writeFileSync(
        adapterPath,
        "---\nmcp_server: wonky\n---\n\n# wonky adapter without name: field\n",
      );
      const claudeMdPath = join(tmpRoot, "CLAUDE.md");
      writeFileSync(claudeMdPath, "## Task Tracking\n\nmode: wonky\n");
      expect(() => readAdapterName(claudeMdPath, adaptersDir, "wonky")).toThrow(
        MalformedAdapterMetadataError,
      );
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// AC-STE-321.3 — specs/technical-spec.md Schema Q mode-none example.
// ---------------------------------------------------------------------------

describe("AC-STE-321.3 — technical-spec.md Schema Q mode-none example drops `tracker: {}`", () => {
  const body = read(join(repoRoot, "specs", "technical-spec.md"));

  // The example block for mode-none lives near line 260 in the heredoc and
  // historically rendered `tracker: {}                          # empty map`.
  // Post-fix the line is gone.
  test("no `tracker: {}` line anywhere in the mode-none example surface", () => {
    // Locate the Schema Q mode-none example heredoc and assert that line is
    // gone. We scope to the spec body; the literal `tracker: {}` substring
    // is the precise drift to remove.
    expect(body).not.toMatch(/^tracker:\s*\{\}\b/m);
  });

  test("the mode-none example still shows the 5 mode-invariant keys + `id:`", () => {
    // Heuristic: find the first `id: fr_<...>` line and assert the five
    // mode-invariant keys appear within the same 25-line window.
    const lines = body.split("\n");
    const idIdx = lines.findIndex((l) => /^id: fr_<26-char-ULID>/.test(l));
    expect(idIdx).toBeGreaterThan(-1);
    const window = lines.slice(Math.max(0, idIdx - 2), idIdx + 25).join("\n");
    for (const key of ["title:", "milestone:", "status:", "archived_at:", "created_at:"]) {
      expect(window).toContain(key);
    }
    // And the `tracker:` line MUST NOT appear in that window.
    expect(window).not.toMatch(/^tracker:/m);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-321.4 — skills/gate-check/SKILL.md probe #2 line rewrite.
// ---------------------------------------------------------------------------

describe("AC-STE-321.4 — gate-check SKILL.md probe #2 drops `tracker` from mode-invariant list", () => {
  const body = read(join(pluginRoot, "skills", "gate-check", "SKILL.md"));

  test("probe #2 line lists the 5 mode-invariant keys WITHOUT `tracker`", () => {
    // Locate the `Required frontmatter fields` probe block.
    const probeIdx = body.indexOf("Required frontmatter fields");
    expect(probeIdx).toBeGreaterThan(-1);
    const block = body.slice(probeIdx, probeIdx + 600);
    // The 5 mode-invariant keys must all appear in the block.
    for (const key of ["title", "milestone", "status", "archived_at", "created_at"]) {
      expect(block).toContain("`" + key + "`");
    }
    // The 5-key declaration line must NOT include `tracker` as a
    // mode-invariant key. Capture the sentence between
    // "mode-invariant Schema Q keys" and the first sentence terminator.
    const sentenceMatch = block.match(/mode-invariant Schema Q keys[^.]*\./);
    expect(sentenceMatch).not.toBeNull();
    expect(sentenceMatch![0]).not.toContain("`tracker`");
  });

  test("probe #2 names `tracker:` as mode-conditional (enforced by probe #13)", () => {
    const probeIdx = body.indexOf("Required frontmatter fields");
    const block = body.slice(probeIdx, probeIdx + 800);
    expect(block).toMatch(/`tracker`.*mode-conditional|mode-conditional.*`tracker`/);
    expect(block).toMatch(/identity_mode_conditional/);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-321.8 — probe #52 prose drops the literal `{linear, jira}` allowlist.
// ---------------------------------------------------------------------------

describe("AC-STE-321.8 — gate-check SKILL.md probe #52 prose drops `tracker_key ∈ {linear, jira}`", () => {
  const body = read(join(pluginRoot, "skills", "gate-check", "SKILL.md"));

  test("`tracker_config_shape` probe description no longer carries the literal allowlist", () => {
    // Find the probe block and isolate ~600 chars of its prose.
    const probeIdx = body.indexOf("`tracker_config_shape`");
    expect(probeIdx).toBeGreaterThan(-1);
    const block = body.slice(probeIdx, probeIdx + 1200);
    expect(block).not.toMatch(/tracker_key\s*∈\s*\{linear,?\s*jira\}/);
    expect(block).not.toMatch(/tracker_key.*\{linear,?\s*jira\}/);
  });

  test("`tracker_config_shape` prose adopts the adapter-name cross-check phrasing", () => {
    const probeIdx = body.indexOf("`tracker_config_shape`");
    const block = body.slice(probeIdx, probeIdx + 1200);
    // Adapter `name:` field must be referenced as the cross-check source.
    expect(block).toMatch(/active adapter.*`?name:?`?|adapter's `?name:?`?/i);
  });

  test("repo-wide: no surviving `tracker_key ∈ {linear, jira}` outside archive", () => {
    // The FR's AC.8 promise: `git grep -nE 'tracker_key.*\{linear,? jira\}'
    // plugins/dev-process-toolkit/{skills,docs,specs}` is zero outside archive.
    const { execSync } = require("node:child_process") as typeof import("node:child_process");
    let stdout = "";
    try {
      stdout = execSync(
        "git grep -nE 'tracker_key.*\\{linear,? jira\\}' plugins/dev-process-toolkit/skills plugins/dev-process-toolkit/docs plugins/dev-process-toolkit/specs",
        { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      );
    } catch {
      // grep exit 1 = zero matches, which is the desired post-fix state.
      stdout = "";
    }
    // Strip archive paths from the match list.
    const hits = stdout
      .split("\n")
      .filter((l) => l.length > 0)
      .filter((l) => !/\/archive\//.test(l));
    expect(hits).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-321.9 — validator API surface: readTrackerConfig does NOT cross-check
// against activeAdapterKey at read time. The probe path owns enforcement.
// ---------------------------------------------------------------------------

describe("AC-STE-321.9 — readTrackerConfig does NOT enforce adapter cross-check at read time", () => {
  test("readTrackerConfig accepts a custom tracker_key without an activeAdapterKey argument", async () => {
    const { readTrackerConfig } = await import(
      join(pluginRoot, "adapters", "_shared", "src", "tracker_config.ts")
    );
    const tmpRoot = mkdtempSync(join(tmpdir(), "ste-321-read-tracker-config-"));
    try {
      const specsDir = join(tmpRoot, "specs");
      mkdirSync(specsDir, { recursive: true });
      writeFileSync(
        join(specsDir, "tracker-config.yaml"),
        [
          "tracker_key: gitlab",
          "statuses:",
          "  - Backlog",
          "  - In Progress",
          "  - In Review",
          "  - Done",
          "roles:",
          "  initial: Backlog",
          "  in_progress: In Progress",
          "  in_review: In Review",
          "  done: Done",
          "",
        ].join("\n"),
      );
      const config = readTrackerConfig(specsDir);
      expect(config).not.toBeNull();
      expect(config!.tracker_key).toBe("gitlab");
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test("readTrackerConfig signature has not grown an activeAdapterKey parameter", async () => {
    const { readTrackerConfig } = await import(
      join(pluginRoot, "adapters", "_shared", "src", "tracker_config.ts")
    );
    // Arity test — adding a required activeAdapterKey arg would push length
    // to 2. AC.9 documents this is out of scope for this FR.
    expect(readTrackerConfig.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-321.10 — identity_mode_conditional.ts exports a scanFrontmatterForTracker
// helper used by probe #13 to detect the bidirectional tracker: invariant.
// ---------------------------------------------------------------------------

describe("AC-STE-321.10 — identity_mode_conditional.ts exposes scanFrontmatterForTracker", () => {
  const probePath = join(pluginRoot, "adapters", "_shared", "src", "identity_mode_conditional.ts");

  test("module exports a `scanFrontmatterForTracker` function", async () => {
    const mod = await import(probePath);
    expect(typeof mod.scanFrontmatterForTracker).toBe("function");
  });

  test("scanFrontmatterForTracker detects a populated `tracker:` block", async () => {
    const { scanFrontmatterForTracker } = await import(probePath);
    const fm = `---
title: Sample
tracker:
  linear: STE-9999
---

Body.
`;
    const scan = scanFrontmatterForTracker(fm);
    expect(scan.present).toBe(true);
    expect(scan.empty).toBe(false);
  });

  test("scanFrontmatterForTracker detects an empty `tracker: {}` block", async () => {
    const { scanFrontmatterForTracker } = await import(probePath);
    const fm = `---
title: Sample
tracker: {}
---

Body.
`;
    const scan = scanFrontmatterForTracker(fm);
    expect(scan.present).toBe(true);
    expect(scan.empty).toBe(true);
  });

  test("scanFrontmatterForTracker returns present=false when `tracker:` is absent", async () => {
    const { scanFrontmatterForTracker } = await import(probePath);
    const fm = `---
title: Sample
---

Body.
`;
    const scan = scanFrontmatterForTracker(fm);
    expect(scan.present).toBe(false);
  });
});
