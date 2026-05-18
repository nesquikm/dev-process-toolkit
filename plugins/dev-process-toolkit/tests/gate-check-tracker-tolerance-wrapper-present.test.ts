// STE-304 AC-STE-304.10 — /gate-check probe `tracker_tolerance_wrapper_present`.
//
// Defense-in-depth byte-check: asserts
// `plugins/dev-process-toolkit/adapters/_shared/src/tracker_tolerance.ts`
// exists AND exports `withTolerance`. Vacuous when
// `adapters/_shared/src/` is absent (non-toolkit projects).
//
// Severity: error. Mirrors STE-92 archive_plan_status probe shape.

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runTrackerToleranceWrapperPresentProbe,
  type TrackerToleranceWrapperPresentReport,
} from "../adapters/_shared/src/tracker_tolerance_wrapper_present";

const pluginRoot = join(import.meta.dir, "..");

interface FixtureCtx {
  root: string;
  sharedSrcDir: string;
  cleanup: () => void;
}

function makeFixture(opts: { withSharedSrcDir?: boolean } = {}): FixtureCtx {
  const withSharedSrcDir = opts.withSharedSrcDir ?? true;
  const root = mkdtempSync(join(tmpdir(), "tracker-tolerance-probe-"));
  const sharedSrcDir = join(
    root,
    "plugins",
    "dev-process-toolkit",
    "adapters",
    "_shared",
    "src",
  );
  if (withSharedSrcDir) {
    mkdirSync(sharedSrcDir, { recursive: true });
  }
  return {
    root,
    sharedSrcDir,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function writeWrapperModule(sharedSrcDir: string, body: string): void {
  writeFileSync(join(sharedSrcDir, "tracker_tolerance.ts"), body);
}

const CONFORMING_WRAPPER = [
  "// stub conforming module",
  "export function withTolerance(provider: unknown, specsDir: string): unknown {",
  "  void specsDir;",
  "  return provider;",
  "}",
  "",
].join("\n");

describe("AC-STE-304.10 — positive fixture: file exists + exports withTolerance ⇒ zero violations", () => {
  test("conforming module passes the probe", async () => {
    const fx = makeFixture();
    try {
      writeWrapperModule(fx.sharedSrcDir, CONFORMING_WRAPPER);
      const report: TrackerToleranceWrapperPresentReport =
        await runTrackerToleranceWrapperPresentProbe(fx.root);
      expect(report.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });
});

describe("AC-STE-304.10 — negative fixture: file absent ⇒ violation", () => {
  test("missing tracker_tolerance.ts in shared src dir → one violation, severity error", async () => {
    const fx = makeFixture();
    try {
      // shared src dir exists but no tracker_tolerance.ts inside.
      const report = await runTrackerToleranceWrapperPresentProbe(fx.root);
      expect(report.violations.length).toBeGreaterThan(0);
      const v = report.violations[0]!;
      expect(v.severity).toBe("error");
      expect(v.note).toMatch(/tracker_tolerance\.ts/);
    } finally {
      fx.cleanup();
    }
  });
});

describe("AC-STE-304.10 — negative fixture: file present but no `withTolerance` export ⇒ violation", () => {
  test("module without the withTolerance export fails the probe", async () => {
    const fx = makeFixture();
    try {
      writeWrapperModule(
        fx.sharedSrcDir,
        "// no withTolerance export here\nexport const unrelated = 1;\n",
      );
      const report = await runTrackerToleranceWrapperPresentProbe(fx.root);
      expect(report.violations.length).toBeGreaterThan(0);
      const v = report.violations[0]!;
      expect(v.severity).toBe("error");
      expect(v.note).toMatch(/withTolerance/);
    } finally {
      fx.cleanup();
    }
  });
});

describe("AC-STE-304.10 — vacuous: shared src dir absent ⇒ zero violations", () => {
  test("non-toolkit project (no adapters/_shared/src/) skips probe vacuously", async () => {
    const fx = makeFixture({ withSharedSrcDir: false });
    try {
      const report = await runTrackerToleranceWrapperPresentProbe(fx.root);
      expect(report.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });
});

describe("AC-STE-304.10 — real repo: the live source tree passes the probe", () => {
  test("plugin root's adapters/_shared/src/tracker_tolerance.ts is present + exports withTolerance", async () => {
    // The same probe applied to the actual repo. Once STE-304's
    // implementation ships, this passes byte-for-byte.
    const repoRoot = join(pluginRoot, "..", "..");
    const report = await runTrackerToleranceWrapperPresentProbe(repoRoot);
    expect(report.violations).toEqual([]);
  });
});
