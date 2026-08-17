// STE-434 (M118) — /gate-check probe `claudemd_probe_managed_guard` (#74).
//
// The structural fuse behind STE-432: every module under
// `adapters/_shared/src/` whose applicability derives from `CLAUDE.md` must
// route through the shared toolkit-managed predicate (`./toolkit_managed`),
// or be named in `CLAUDEMD_GUARD_EXEMPT` with a recorded one-line reason.
// Probe #18 drifted to guarding on nothing precisely because that question was
// re-derived by hand in five places; an omission must now be a decision.
//
// Allowlist-driven scan, mirroring probe #54 `audit_fix_loop_pattern`.
// RED-state until the implementation lands at:
//   plugins/dev-process-toolkit/adapters/_shared/src/claudemd_probe_managed_guard.ts
//
// AC coverage:
//   AC-STE-434.1 — module path + `PROBE_ID` + `runClaudeMdProbeManagedGuardProbe`
//                  + `CLAUDEMD_GUARD_EXEMPT` (module id → one-line reason).
//   AC-STE-434.2 — selection rule (CLAUDE.md path join, non-test modules) +
//                  compliance rule (import OR exemption) + exactly one
//                  violation per offending module in NFR-10 canonical shape.
//   AC-STE-434.3 — zero violations on this repo's root (self-clean).
//   AC-STE-434.4 — synthetic violating fixture module ⇒ exactly one violation
//                  naming that module.
//   AC-STE-434.5 — vacuous (zero violations) when the shared adapter layer is
//                  absent — downstream consumers that do not ship it.
//   AC-STE-434.6 — README's two documented probe counts read 74 and
//                  `runPublicSurfaceCountDriftProbe` stays clean on this repo.
//   AC-STE-434.7 — gate-check SKILL.md carries entry 74 and names this test
//                  file in the probe-authoring contract section.

import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Module not yet present — these imports drive the RED state.
import {
  CLAUDEMD_GUARD_EXEMPT,
  PROBE_ID,
  runClaudeMdProbeManagedGuardProbe,
} from "../adapters/_shared/src/claudemd_probe_managed_guard";
import { runPublicSurfaceCountDriftProbe } from "../adapters/_shared/src/public_surface_count_drift";

const pluginRoot = join(import.meta.dir, "..");
const repoRoot = join(pluginRoot, "..", "..");
const gateCheckSkillMd = join(pluginRoot, "skills", "gate-check", "SKILL.md");
const probeModulePath = join(
  pluginRoot,
  "adapters",
  "_shared",
  "src",
  "claudemd_probe_managed_guard.ts",
);

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The single line of `body` matching `anchor`.
 *
 * AC-STE-434.6 names README lines 14 and 109, but this suite anchors on content
 * rather than the absolute index — the same correction
 * `tests/gate-check-public-surface-count-drift.test.ts` already applied, where
 * a banner image shifted six pinned lines and reddened a suite that only cares
 * which NUMBERS the README claims. Asserting uniqueness keeps what the index
 * was really buying: the token lives on one identifiable line, not merely
 * somewhere in the file.
 */
function onlyLine(body: string, anchor: RegExp): string {
  const hits = body.split("\n").filter((line) => anchor.test(line));
  if (hits.length !== 1) {
    throw new Error(`expected exactly 1 line matching ${anchor}, found ${hits.length}`);
  }
  return hits[0]!;
}

/** A module body that joins a `CLAUDE.md` path — i.e. IN SCOPE for the probe. */
function readsClaudeMd(opts: { importsPredicate?: boolean } = {}): string {
  const lines = ['import { readFileSync } from "node:fs";', 'import { join } from "node:path";'];
  if (opts.importsPredicate === true) {
    lines.push('import { isToolkitManaged } from "./toolkit_managed";');
  }
  lines.push(
    "",
    "export function readsIt(projectRoot: string): string {",
    '  return readFileSync(join(projectRoot, "CLAUDE.md"), "utf-8");',
    "}",
  );
  if (opts.importsPredicate === true) {
    lines.push("", "export const managed = isToolkitManaged;");
  }
  return lines.join("\n");
}

/** A module body with no `CLAUDE.md` path join — i.e. OUT OF SCOPE. */
function ignoresClaudeMd(): string {
  return [
    'import { join } from "node:path";',
    "",
    "export function elsewhere(projectRoot: string): string {",
    '  return join(projectRoot, "specs", "requirements.md");',
    "}",
  ].join("\n");
}

interface Fixture {
  root: string;
  src: string;
  cleanup: () => void;
}

/**
 * A tmp project root carrying an (empty) shared adapter layer.
 *
 * `layout: "plugin"` nests it under `plugins/dev-process-toolkit/` the way THIS
 * repo ships it; the default flat layout is what a consumer that vendors the
 * adapter layer directly looks like. Both must be scanned.
 *
 * Fixture hygiene: every synthetic module is written HERE, never into the real
 * `adapters/_shared/src/`.
 */
function makeFixture(opts: { layout?: "flat" | "plugin" } = {}): Fixture {
  const root = mkdtempSync(join(tmpdir(), "claudemd-probe-managed-guard-"));
  const src =
    opts.layout === "plugin"
      ? join(root, "plugins", "dev-process-toolkit", "adapters", "_shared", "src")
      : join(root, "adapters", "_shared", "src");
  mkdirSync(src, { recursive: true });
  return { root, src, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function writeModule(fx: Fixture, name: string, body: string): void {
  writeFileSync(join(fx.src, name), body);
}

// ─────────────────────────────────────────────────────────────────────────────
// AC-STE-434.1 — module surface.
// ─────────────────────────────────────────────────────────────────────────────

describe("AC-STE-434.1 — probe module surface", () => {
  test("module ships at adapters/_shared/src/claudemd_probe_managed_guard.ts", () => {
    expect(existsSync(probeModulePath)).toBe(true);
  });

  test("PROBE_ID is the canonical slug", () => {
    expect(PROBE_ID).toBe("claudemd_probe_managed_guard");
  });

  test("runClaudeMdProbeManagedGuardProbe is exported as a function", () => {
    expect(typeof runClaudeMdProbeManagedGuardProbe).toBe("function");
  });

  test("CLAUDEMD_GUARD_EXEMPT maps each exempt module id to a one-line reason", () => {
    expect(typeof CLAUDEMD_GUARD_EXEMPT).toBe("object");
    expect(CLAUDEMD_GUARD_EXEMPT).not.toBeNull();
    const entries = Object.entries(CLAUDEMD_GUARD_EXEMPT);
    // The exemption list is the recorded-decision half of the contract: the
    // repo's own in-scope modules that legitimately do not consult the
    // predicate must be named here, so an empty map means the probe is only
    // self-clean by accident.
    expect(entries.length).toBeGreaterThan(0);
    for (const [moduleId, reason] of entries) {
      // Module id — basename without `.ts`, never a path and never suffixed.
      expect(moduleId).toMatch(/^[A-Za-z0-9_.-]+$/);
      expect(moduleId.endsWith(".ts")).toBe(false);
      expect(typeof reason).toBe("string");
      // A one-line reason: non-empty, and genuinely one line.
      expect(reason.trim().length).toBeGreaterThan(0);
      expect(reason).not.toContain("\n");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-STE-434.2 — selection + compliance rules, and violation shape.
// ─────────────────────────────────────────────────────────────────────────────

describe("AC-STE-434.2 — selection rule", () => {
  test("a module with no CLAUDE.md path join is out of scope ⇒ zero violations", async () => {
    const fx = makeFixture();
    try {
      writeModule(fx, "unrelated_helper.ts", ignoresClaudeMd());
      const r = await runClaudeMdProbeManagedGuardProbe(fx.root);
      expect(r.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("a *.test.ts file reading CLAUDE.md is not scanned ⇒ zero violations", async () => {
    const fx = makeFixture();
    try {
      writeModule(fx, "some_probe.test.ts", readsClaudeMd());
      const r = await runClaudeMdProbeManagedGuardProbe(fx.root);
      expect(r.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("the probe scans the plugin-nested adapter layout too", async () => {
    const fx = makeFixture({ layout: "plugin" });
    try {
      writeModule(fx, "nested_offender.ts", readsClaudeMd());
      const r = await runClaudeMdProbeManagedGuardProbe(fx.root);
      expect(r.violations.length).toBe(1);
      expect(r.violations[0]!.note).toContain("nested_offender.ts");
    } finally {
      fx.cleanup();
    }
  });
});

describe("AC-STE-434.2 — compliance rule", () => {
  test("an in-scope module importing ./toolkit_managed ⇒ zero violations", async () => {
    const fx = makeFixture();
    try {
      writeModule(fx, "routed_probe.ts", readsClaudeMd({ importsPredicate: true }));
      const r = await runClaudeMdProbeManagedGuardProbe(fx.root);
      expect(r.violations).toEqual([]);
      expect(r.vacuous).toBe(false);
    } finally {
      fx.cleanup();
    }
  });

  test("exemption path — a module named in CLAUDEMD_GUARD_EXEMPT ⇒ zero violations without the import", async () => {
    const exemptIds = Object.keys(CLAUDEMD_GUARD_EXEMPT).sort();
    expect(exemptIds.length).toBeGreaterThan(0);
    const exemptId = exemptIds[0]!;
    const fx = makeFixture();
    try {
      // Same body that fires as a violation under any other name — the ONLY
      // difference is the module id's presence in the exemption map.
      writeModule(fx, `${exemptId}.ts`, readsClaudeMd());
      const r = await runClaudeMdProbeManagedGuardProbe(fx.root);
      expect(r.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("two offending modules ⇒ exactly one violation each, one per module", async () => {
    const fx = makeFixture();
    try {
      writeModule(fx, "offender_one.ts", readsClaudeMd());
      writeModule(fx, "offender_two.ts", readsClaudeMd());
      writeModule(fx, "compliant_three.ts", readsClaudeMd({ importsPredicate: true }));
      const r = await runClaudeMdProbeManagedGuardProbe(fx.root);
      expect(r.violations.length).toBe(2);
      const named = r.violations.map((v) => v.note).join("\n");
      expect(named).toContain("offender_one.ts");
      expect(named).toContain("offender_two.ts");
      expect(named).not.toContain("compliant_three.ts");
    } finally {
      fx.cleanup();
    }
  });
});

describe("AC-STE-434.2 — NFR-10 canonical violation shape", () => {
  test("violation renders `file:line — reason` with Remedy: and Context: sub-lines", async () => {
    const fx = makeFixture();
    try {
      writeModule(fx, "shape_offender.ts", readsClaudeMd());
      const r = await runClaudeMdProbeManagedGuardProbe(fx.root);
      expect(r.violations.length).toBe(1);
      const v = r.violations[0]!;

      // `file:line — reason`, path relative to the project root.
      expect(v.note).toMatch(
        /^adapters\/_shared\/src\/shape_offender\.ts:\d+ — \S/,
      );
      expect(v.line).toBeGreaterThanOrEqual(1);
      expect(v.severity).toBe("error");
      expect(v.file).toContain("shape_offender.ts");

      // Message: note first, then the two canonical sub-lines.
      expect(v.message).toContain(v.note);
      expect(v.message).toContain(PROBE_ID);
      expect(v.message).toMatch(/^Remedy:/m);
      expect(v.message).toMatch(/^Context:/m);
      // The remedy must name both escape routes so the reader knows an
      // exemption is an option, not just the import.
      expect(v.message).toContain("toolkit_managed");
      expect(v.message).toContain("CLAUDEMD_GUARD_EXEMPT");
    } finally {
      fx.cleanup();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-STE-434.3 — self-clean on this repo.
// ─────────────────────────────────────────────────────────────────────────────

describe("AC-STE-434.3 — self-clean on this repo", () => {
  test("repo root yields zero violations", async () => {
    const r = await runClaudeMdProbeManagedGuardProbe(repoRoot);
    if (r.violations.length > 0) {
      const noted = r.violations.map((v) => `  - ${v.note}`).join("\n");
      throw new Error(
        `Expected zero claudemd_probe_managed_guard violations, got ${r.violations.length}:\n${noted}`,
      );
    }
    expect(r.violations).toEqual([]);
    expect(r.vacuous).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-STE-434.4 — synthetic violating module.
// ─────────────────────────────────────────────────────────────────────────────

describe("AC-STE-434.4 — synthetic violating fixture module", () => {
  test("module reading CLAUDE.md with neither import nor exemption ⇒ exactly one violation naming it", async () => {
    const fx = makeFixture();
    try {
      writeModule(fx, "rogue_claudemd_reader.ts", readsClaudeMd());
      const r = await runClaudeMdProbeManagedGuardProbe(fx.root);
      expect(r.violations.length).toBe(1);
      expect(r.violations[0]!.note).toContain("rogue_claudemd_reader.ts");
      expect(r.vacuous).toBe(false);
    } finally {
      fx.cleanup();
    }
  });

  test("the real adapters/_shared/src/ is never mutated by the fixtures", () => {
    // Guard rail on this suite itself: the fixture helper builds under
    // `mkdtempSync`, so no synthetic module may appear in the shipped tree.
    const realSrc = join(pluginRoot, "adapters", "_shared", "src");
    expect(existsSync(join(realSrc, "rogue_claudemd_reader.ts"))).toBe(false);
    expect(existsSync(join(realSrc, "shape_offender.ts"))).toBe(false);
    expect(existsSync(join(realSrc, "offender_one.ts"))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-STE-434.5 — vacuous when the shared adapter layer is absent.
// ─────────────────────────────────────────────────────────────────────────────

describe("AC-STE-434.5 — vacuous without the shared adapter layer", () => {
  test("a bare project root with no adapters tree ⇒ vacuous, zero violations", async () => {
    const root = mkdtempSync(join(tmpdir(), "claudemd-probe-managed-guard-bare-"));
    try {
      const r = await runClaudeMdProbeManagedGuardProbe(root);
      expect(r.violations).toEqual([]);
      expect(r.vacuous).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a project root carrying a CLAUDE.md but no adapters tree is still vacuous", async () => {
    const root = mkdtempSync(join(tmpdir(), "claudemd-probe-managed-guard-consumer-"));
    try {
      writeFileSync(join(root, "CLAUDE.md"), "# Consumer\n\n## Docs\n\nuser_facing_mode: false\n");
      const r = await runClaudeMdProbeManagedGuardProbe(root);
      expect(r.violations).toEqual([]);
      expect(r.vacuous).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-STE-434.6 — documented probe counts.
// ─────────────────────────────────────────────────────────────────────────────

describe("AC-STE-434.6 — README documents 77 probes", () => {
  // Recalibrated 76 → 77: M126 added #77 first_turn_refusal_marker.
  test("the Features bullet documents 77 numbered /gate-check probes (README.md:14)", () => {
    const readme = readFileSync(join(repoRoot, "README.md"), "utf-8");
    expect(onlyLine(readme, /numbered `\/gate-check` probes/)).toMatch(/\b77\b.*numbered/);
  });

  test("the /implement-invokes-/tdd aside documents 77 probes (README.md:109)", () => {
    const readme = readFileSync(join(repoRoot, "README.md"), "utf-8");
    expect(onlyLine(readme, /which layers \d+ probes on top/)).toMatch(/\b77\b\s+probes/);
  });

  test("runPublicSurfaceCountDriftProbe returns zero violations on this repo", async () => {
    const r = await runPublicSurfaceCountDriftProbe(repoRoot);
    if (r.violations.length > 0) {
      const noted = r.violations.map((v) => `  - ${v.note}`).join("\n");
      throw new Error(
        `Expected zero public-surface count-drift violations, got ${r.violations.length}:\n${noted}`,
      );
    }
    expect(r.violations).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-STE-434.7 — gate-check SKILL.md registration.
// ─────────────────────────────────────────────────────────────────────────────

describe("AC-STE-434.7 — registered in gate-check SKILL.md", () => {
  test("the probe is numbered entry 74", () => {
    const body = readFileSync(gateCheckSkillMd, "utf-8");
    const entry = onlyLine(body, /^74\.\s/);
    expect(entry).toContain("claudemd_probe_managed_guard");
  });

  test("entry 74 names the probe module path", () => {
    const body = readFileSync(gateCheckSkillMd, "utf-8");
    const entry = onlyLine(body, /^74\.\s/);
    expect(entry).toContain("claudemd_probe_managed_guard.ts");
  });

  test("the probe-authoring contract section names this test file", () => {
    const body = readFileSync(gateCheckSkillMd, "utf-8");
    const idx = body.indexOf("## Probe authoring contract");
    expect(idx).toBeGreaterThan(-1);
    const contract = body.slice(idx);
    expect(contract).toContain("tests/gate-check-claudemd-probe-managed-guard.test.ts");
  });
});
