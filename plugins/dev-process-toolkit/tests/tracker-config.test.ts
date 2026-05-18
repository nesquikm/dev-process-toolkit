// STE-302 — per-project tracker-config.yaml loader + role/status mappers.
//
// Covers AC-STE-302.1 through AC-STE-302.7 — the public surface of the new
// `adapters/_shared/src/tracker_config.ts` module:
//
//   - readTrackerConfig(specsDir)  → TrackerConfig | null
//   - writeTrackerConfig(specsDir, config) → void
//   - validateTrackerConfig(config) → void (throws on invalid)
//   - roleToStatus(config, role)   → string (throws on unknown role)
//   - statusToRole(config, status) → Role | null | "unknown"
//   - TrackerConfigShapeError (NFR-10 canonical refusal shape)
//
// The canonical four-role enum is locked at: initial, in_progress, in_review,
// done. Schema invariants: top-level `statuses:` (>=1 string, verbatim from
// tracker) + `roles:` (map declaring all four canonical roles, each value
// MUST appear in `statuses:`) + `tracker_key:` (`linear` | `jira`) for
// cross-reference with the active adapter.

import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readTrackerConfig,
  writeTrackerConfig,
  validateTrackerConfig,
  roleToStatus,
  statusToRole,
  TrackerConfigShapeError,
  type TrackerConfig,
} from "../adapters/_shared/src/tracker_config";

const CANONICAL_ROLES = ["initial", "in_progress", "in_review", "done"] as const;

function makeSpecsDir(): { specsDir: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "tracker-config-"));
  const specsDir = join(root, "specs");
  mkdirSync(specsDir, { recursive: true });
  return { specsDir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function validConfig(overrides: Partial<TrackerConfig> = {}): TrackerConfig {
  return {
    tracker_key: "linear",
    statuses: ["Backlog", "In Progress", "In Review", "Done"],
    roles: {
      initial: "Backlog",
      in_progress: "In Progress",
      in_review: "In Review",
      done: "Done",
    },
    ...overrides,
  };
}

function writeYaml(specsDir: string, body: string): string {
  const path = join(specsDir, "tracker-config.yaml");
  writeFileSync(path, body);
  return path;
}

describe("AC-STE-302.1 — module surface + happy path", () => {
  test("readTrackerConfig parses a well-formed file", () => {
    const ctx = makeSpecsDir();
    try {
      writeYaml(
        ctx.specsDir,
        [
          "tracker_key: linear",
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
      const config = readTrackerConfig(ctx.specsDir);
      expect(config).not.toBeNull();
      expect(config!.tracker_key).toBe("linear");
      expect(config!.statuses).toEqual(["Backlog", "In Progress", "In Review", "Done"]);
      expect(config!.roles.initial).toBe("Backlog");
      expect(config!.roles.in_progress).toBe("In Progress");
      expect(config!.roles.in_review).toBe("In Review");
      expect(config!.roles.done).toBe("Done");
    } finally {
      ctx.cleanup();
    }
  });

  test("readTrackerConfig returns null when the file is absent", () => {
    const ctx = makeSpecsDir();
    try {
      const config = readTrackerConfig(ctx.specsDir);
      expect(config).toBeNull();
    } finally {
      ctx.cleanup();
    }
  });

  test("readTrackerConfig throws TrackerConfigShapeError on malformed YAML", () => {
    const ctx = makeSpecsDir();
    try {
      // Garbage that cannot parse as the documented schema.
      writeYaml(ctx.specsDir, "this is: not\n  -valid-\n yaml::::\n");
      expect(() => readTrackerConfig(ctx.specsDir)).toThrow(TrackerConfigShapeError);
    } finally {
      ctx.cleanup();
    }
  });

  test("TrackerConfigShapeError carries NFR-10 canonical refusal shape", () => {
    let err: unknown;
    try {
      validateTrackerConfig({ tracker_key: "linear", statuses: [], roles: {} } as TrackerConfig);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(TrackerConfigShapeError);
    const message = (err as Error).message;
    expect(message).toMatch(/Refusing:/);
    expect(message).toMatch(/Remedy:/);
    expect(message).toMatch(/Context:/);
  });
});

describe("AC-STE-302.2 — schema validation", () => {
  test("statuses MUST contain >=1 entry — empty array rejected", () => {
    const cfg = validConfig({ statuses: [], roles: {
      initial: "Backlog", in_progress: "In Progress", in_review: "In Review", done: "Done",
    } });
    expect(() => validateTrackerConfig(cfg)).toThrow(TrackerConfigShapeError);
  });

  test("missing statuses key rejected", () => {
    const cfg = { tracker_key: "linear", roles: validConfig().roles } as unknown as TrackerConfig;
    expect(() => validateTrackerConfig(cfg)).toThrow(TrackerConfigShapeError);
  });

  test("missing roles key rejected", () => {
    const cfg = { tracker_key: "linear", statuses: ["Backlog"] } as unknown as TrackerConfig;
    expect(() => validateTrackerConfig(cfg)).toThrow(TrackerConfigShapeError);
  });

  test("role value not in statuses rejected, error names the gap", () => {
    const cfg = validConfig({
      statuses: ["Backlog", "In Progress", "In Review", "Done"],
      roles: {
        initial: "Backlog",
        in_progress: "Coding",          // not in statuses
        in_review: "In Review",
        done: "Done",
      },
    });
    let err: unknown;
    try {
      validateTrackerConfig(cfg);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(TrackerConfigShapeError);
    expect((err as Error).message).toMatch(/Coding/);
    expect((err as Error).message).toMatch(/in_progress/);
  });

  test("tracker_key must be linear or jira — unknown rejected", () => {
    const cfg = validConfig({ tracker_key: "asana" as unknown as "linear" });
    expect(() => validateTrackerConfig(cfg)).toThrow(TrackerConfigShapeError);
  });

  test("tracker_key mismatch against active adapter surfaces validation error", () => {
    // The mismatch check is a separate API: validateTrackerConfig accepts an
    // optional activeAdapterKey arg and refuses when present + different.
    const cfg = validConfig({ tracker_key: "linear" });
    expect(() => validateTrackerConfig(cfg, "jira")).toThrow(TrackerConfigShapeError);

    // Same key → no throw.
    expect(() => validateTrackerConfig(cfg, "linear")).not.toThrow();
  });
});

describe("AC-STE-302.3 — canonical four-role enum locked", () => {
  test("roles MUST declare all four canonical roles — missing role rejected and names the gap", () => {
    for (const missing of CANONICAL_ROLES) {
      const roles: Record<string, string> = {
        initial: "Backlog",
        in_progress: "In Progress",
        in_review: "In Review",
        done: "Done",
      };
      delete roles[missing];
      const cfg = validConfig({ roles: roles as TrackerConfig["roles"] });
      let err: unknown;
      try {
        validateTrackerConfig(cfg);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(TrackerConfigShapeError);
      expect((err as Error).message).toMatch(new RegExp(missing));
    }
  });

  test("extra role outside the four-value enum rejected", () => {
    const cfg = validConfig({
      roles: {
        initial: "Backlog",
        in_progress: "In Progress",
        in_review: "In Review",
        done: "Done",
        // @ts-expect-error — testing rejection of unknown role
        blocked: "Blocked",
      },
    });
    let err: unknown;
    try {
      validateTrackerConfig(cfg);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(TrackerConfigShapeError);
    expect((err as Error).message).toMatch(/blocked/);
  });
});

describe("AC-STE-302.4 — roleToStatus + statusToRole semantics", () => {
  const cfg = validConfig({
    statuses: ["Backlog", "In Progress", "In Review", "In QA", "Done", "Cancelled"],
    roles: {
      initial: "Backlog",
      in_progress: "In Progress",
      in_review: "In Review",
      done: "Done",
    },
  });

  test("roleToStatus returns the mapped status string for each canonical role", () => {
    expect(roleToStatus(cfg, "initial")).toBe("Backlog");
    expect(roleToStatus(cfg, "in_progress")).toBe("In Progress");
    expect(roleToStatus(cfg, "in_review")).toBe("In Review");
    expect(roleToStatus(cfg, "done")).toBe("Done");
  });

  test("roleToStatus throws TrackerConfigShapeError on unknown role (not in four-value enum)", () => {
    expect(() => roleToStatus(cfg, "blocked" as unknown as "done")).toThrow(TrackerConfigShapeError);
    expect(() => roleToStatus(cfg, "cancelled" as unknown as "done")).toThrow(TrackerConfigShapeError);
  });

  test("statusToRole returns the role name when the status maps to a role", () => {
    expect(statusToRole(cfg, "Backlog")).toBe("initial");
    expect(statusToRole(cfg, "In Progress")).toBe("in_progress");
    expect(statusToRole(cfg, "In Review")).toBe("in_review");
    expect(statusToRole(cfg, "Done")).toBe("done");
  });

  test("statusToRole returns null for known-non-key statuses (in statuses but not in any role)", () => {
    expect(statusToRole(cfg, "In QA")).toBeNull();
    expect(statusToRole(cfg, "Cancelled")).toBeNull();
  });

  test("statusToRole returns 'unknown' sentinel for statuses not in statuses: at all", () => {
    expect(statusToRole(cfg, "Wibbling")).toBe("unknown");
    expect(statusToRole(cfg, "")).toBe("unknown");
  });

  test("statusToRole never throws even for genuinely weird input", () => {
    expect(() => statusToRole(cfg, "")).not.toThrow();
    expect(() => statusToRole(cfg, "###")).not.toThrow();
  });
});

describe("AC-STE-302.7 — round-trip equivalence", () => {
  test("writeTrackerConfig then readTrackerConfig returns equivalent config", () => {
    const ctx = makeSpecsDir();
    try {
      const original = validConfig({
        statuses: ["Backlog", "In Progress", "In Review", "In QA", "Done", "Cancelled"],
        roles: {
          initial: "Backlog",
          in_progress: "In Progress",
          in_review: "In Review",
          done: "Done",
        },
      });
      writeTrackerConfig(ctx.specsDir, original);
      expect(existsSync(join(ctx.specsDir, "tracker-config.yaml"))).toBe(true);

      const readBack = readTrackerConfig(ctx.specsDir);
      expect(readBack).not.toBeNull();
      expect(readBack!.tracker_key).toBe(original.tracker_key);
      expect(readBack!.statuses).toEqual(original.statuses);
      expect(readBack!.roles).toEqual(original.roles);
    } finally {
      ctx.cleanup();
    }
  });

  test("writeTrackerConfig refuses to write an invalid config", () => {
    const ctx = makeSpecsDir();
    try {
      const bad = { tracker_key: "linear", statuses: [], roles: {} } as TrackerConfig;
      expect(() => writeTrackerConfig(ctx.specsDir, bad)).toThrow(TrackerConfigShapeError);
      // Refused write should not have created the file.
      expect(existsSync(join(ctx.specsDir, "tracker-config.yaml"))).toBe(false);
    } finally {
      ctx.cleanup();
    }
  });

  test("writeTrackerConfig writes to the canonical specs/tracker-config.yaml path", () => {
    const ctx = makeSpecsDir();
    try {
      writeTrackerConfig(ctx.specsDir, validConfig());
      const onDisk = readFileSync(join(ctx.specsDir, "tracker-config.yaml"), "utf8");
      expect(onDisk).toMatch(/tracker_key:\s*linear/);
      expect(onDisk).toMatch(/statuses:/);
      expect(onDisk).toMatch(/roles:/);
      expect(onDisk).toMatch(/initial:\s*Backlog/);
      expect(onDisk).toMatch(/done:\s*Done/);
    } finally {
      ctx.cleanup();
    }
  });
});
