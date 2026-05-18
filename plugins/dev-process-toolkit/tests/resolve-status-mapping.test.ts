// STE-302 AC-STE-302.5 — Adapter-side consumer refactor for status_mapping.
//
// The helper at `adapters/_shared/src/resolve_status_mapping.ts` is the
// single integration point every status_mapping consumer threads through.
// Precedence:
//
//   1. specs/tracker-config.yaml (loaded via readTrackerConfig)
//   2. adapters/<key>.md frontmatter `status_mapping:` block
//   3. inline fallback (options.fallback)
//
// Tests cover the file-present, file-absent, and exhausted-precedence
// branches so the per-adapter frontmatter fallback documented in the FR
// stays exercised until M80+ removes it.
//
// Round-trip with writeTrackerConfig confirms the file the resolver reads
// is the same one /setup will write under FR2 — the two halves of the
// migration meet here.

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  fromTrackerConfig,
  readAdapterFrontmatterStatusMapping,
  resolveStatusMapping,
  StatusMappingUnavailableError,
} from "../adapters/_shared/src/resolve_status_mapping";
import { writeTrackerConfig, type TrackerConfig } from "../adapters/_shared/src/tracker_config";

function makeDirs(): { specsDir: string; adaptersDir: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "resolve-status-mapping-"));
  const specsDir = join(root, "specs");
  const adaptersDir = join(root, "adapters");
  mkdirSync(specsDir, { recursive: true });
  mkdirSync(adaptersDir, { recursive: true });
  return {
    specsDir,
    adaptersDir,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function writeAdapterMd(
  adaptersDir: string,
  key: string,
  frontmatter: string,
): void {
  const body = `---\n${frontmatter}\n---\n\n# ${key} adapter\n`;
  writeFileSync(join(adaptersDir, `${key}.md`), body);
}

const VALID_CONFIG: TrackerConfig = {
  tracker_key: "linear",
  statuses: ["Backlog", "In Progress", "In Review", "Done"],
  roles: {
    initial: "Backlog",
    in_progress: "In Progress",
    in_review: "In Review",
    done: "Done",
  },
};

describe("resolveStatusMapping — precedence 1: specs/tracker-config.yaml present", () => {
  test("uses tracker-config.yaml when present, ignoring adapter frontmatter", () => {
    const ctx = makeDirs();
    try {
      // Project-level config: distinct values so we can tell which source won.
      writeTrackerConfig(ctx.specsDir, {
        tracker_key: "linear",
        statuses: ["Triage", "Coding", "Review", "Shipped"],
        roles: {
          initial: "Triage",
          in_progress: "Coding",
          in_review: "Review",
          done: "Shipped",
        },
      });
      // Adapter-default values (must NOT win).
      writeAdapterMd(
        ctx.adaptersDir,
        "linear",
        [
          "name: linear",
          "status_mapping:",
          "  initial: Backlog",
          "  in_progress: In Progress",
          "  in_review: In Review",
          "  done: Done",
        ].join("\n"),
      );
      const resolved = resolveStatusMapping(ctx.specsDir, ctx.adaptersDir, "linear");
      expect(resolved.source).toBe("tracker-config");
      expect(resolved.roles.initial).toBe("Triage");
      expect(resolved.roles.in_progress).toBe("Coding");
      expect(resolved.roles.in_review).toBe("Review");
      expect(resolved.roles.done).toBe("Shipped");
    } finally {
      ctx.cleanup();
    }
  });

  test("fromTrackerConfig is a pure projection of TrackerConfig.roles", () => {
    const resolved = fromTrackerConfig(VALID_CONFIG);
    expect(resolved.source).toBe("tracker-config");
    expect(resolved.roles).toEqual(VALID_CONFIG.roles);
  });
});

describe("resolveStatusMapping — precedence 2: tracker-config absent, adapter frontmatter wins", () => {
  test("falls back to adapter frontmatter when tracker-config.yaml is absent", () => {
    const ctx = makeDirs();
    try {
      writeAdapterMd(
        ctx.adaptersDir,
        "linear",
        [
          "name: linear",
          "status_mapping:",
          "  initial: Backlog",
          "  in_progress: In Progress",
          "  in_review: In Review",
          "  done: Done",
        ].join("\n"),
      );
      const resolved = resolveStatusMapping(ctx.specsDir, ctx.adaptersDir, "linear");
      expect(resolved.source).toBe("adapter-frontmatter");
      expect(resolved.roles.initial).toBe("Backlog");
      expect(resolved.roles.in_progress).toBe("In Progress");
      expect(resolved.roles.in_review).toBe("In Review");
      expect(resolved.roles.done).toBe("Done");
    } finally {
      ctx.cleanup();
    }
  });

  test("readAdapterFrontmatterStatusMapping returns null when adapter file is absent", () => {
    const ctx = makeDirs();
    try {
      const result = readAdapterFrontmatterStatusMapping(ctx.adaptersDir, "linear");
      expect(result).toBeNull();
    } finally {
      ctx.cleanup();
    }
  });

  test("readAdapterFrontmatterStatusMapping returns null when status_mapping block is absent", () => {
    const ctx = makeDirs();
    try {
      writeAdapterMd(ctx.adaptersDir, "linear", "name: linear\nmcp_server: linear");
      const result = readAdapterFrontmatterStatusMapping(ctx.adaptersDir, "linear");
      expect(result).toBeNull();
    } finally {
      ctx.cleanup();
    }
  });
});

describe("resolveStatusMapping — precedence 3: inline fallback", () => {
  test("uses options.fallback when both tracker-config and adapter frontmatter are absent", () => {
    const ctx = makeDirs();
    try {
      const resolved = resolveStatusMapping(ctx.specsDir, ctx.adaptersDir, "linear", {
        fallback: {
          initial: "Backlog",
          in_progress: "In Progress",
          in_review: "In Review",
          done: "Done",
        },
      });
      expect(resolved.source).toBe("adapter-frontmatter");
      expect(resolved.roles.done).toBe("Done");
    } finally {
      ctx.cleanup();
    }
  });

  test("throws StatusMappingUnavailableError when every source is missing", () => {
    const ctx = makeDirs();
    try {
      expect(() => resolveStatusMapping(ctx.specsDir, ctx.adaptersDir, "linear")).toThrow(
        StatusMappingUnavailableError,
      );
    } finally {
      ctx.cleanup();
    }
  });

  test("StatusMappingUnavailableError carries NFR-10 canonical refusal shape", () => {
    const ctx = makeDirs();
    try {
      let err: unknown;
      try {
        resolveStatusMapping(ctx.specsDir, ctx.adaptersDir, "linear");
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(StatusMappingUnavailableError);
      const message = (err as Error).message;
      expect(message).toMatch(/Refusing:/);
      expect(message).toMatch(/Remedy:/);
      expect(message).toMatch(/Context:/);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("resolveStatusMapping — round-trip with writeTrackerConfig", () => {
  test("writeTrackerConfig then resolveStatusMapping yields the same role values", () => {
    const ctx = makeDirs();
    try {
      writeTrackerConfig(ctx.specsDir, VALID_CONFIG);
      const resolved = resolveStatusMapping(ctx.specsDir, ctx.adaptersDir, "linear");
      expect(resolved.source).toBe("tracker-config");
      expect(resolved.roles).toEqual(VALID_CONFIG.roles);
    } finally {
      ctx.cleanup();
    }
  });
});
