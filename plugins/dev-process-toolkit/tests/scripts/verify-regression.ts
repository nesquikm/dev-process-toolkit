#!/usr/bin/env bun
// Phase H Task 1 + Task 5 gate. Two layers of protection for the Pattern 9
// backward-compat invariant:
//
//   Layer 1 (byte-diff): recaptures every committed `mode: none` fixture
//     snapshot and byte-diffs it against its committed baseline. A byte
//     drift means one of the skills or templates leaked a mode-aware
//     change into the mode: none path — stop-ship per Pattern 9.
//
//   Layer 2 (Schema L probe, AC-34.8): runs the canonical Schema L probe
//     (`grep -c '^## Task Tracking$' CLAUDE.md`) against the required
//     fixtures and asserts mode=none on each. File-hash-only comparison
//     against a static fixture only verifies fixture stability — this
//     second layer verifies that the fixture actually satisfies the
//     probe skills would run, so a regression in the probe itself or
//     in a fresh-setup-rendered fixture can't sneak through the diff.
//
// Exit codes:
//   0  — all fixtures byte-identical to baseline AND Schema L probe
//        reports mode=none on every required fixture.
//   1  — Pattern 9 regression (byte drift) or Schema L probe failure.
//   2  — operational error (missing fixture, capture script crash).

import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const scriptDir = new URL(".", import.meta.url).pathname;
const pluginRoot = join(scriptDir, "..", "..");
const baselineDir = join(pluginRoot, "tests", "fixtures", "baselines");
const projectsDir = join(pluginRoot, "tests", "fixtures", "projects");
const captureTs = join(scriptDir, "capture-regression.ts");

// Fixture → baseline-snapshot pairs. The first entry is the original
// M12-ship fixture (kept under its historical name for traceability);
// the others widen Pattern 9 coverage to real-shape downstream projects
// (different stack, archive-heavy specs/) so a "byte-identical to pre-M12"
// claim is measured against more than one synthetic baseline.
const FIXTURES = [
  { name: "mode-none-baseline", snapshot: "m1-m11-regression.snapshot" },
  { name: "mode-none-flutter", snapshot: "mode-none-flutter.snapshot" },
  { name: "mode-none-archived", snapshot: "mode-none-archived.snapshot" },
  { name: "mode-none-v2-migration", snapshot: "mode-none-v2-migration.snapshot" },
];

// Fixtures that MUST probe to mode=none (AC-34.8). Includes mode-none-baseline
// (the canonical fixture used across M12), mode-none-fresh-setup (the
// template-derived fixture proving AC-29.7 end-to-end), and mode-none-v2-migration
// (FR-56 AC-56.3 — v2-layout mode: none shape that `/setup --migrate` must route
// into tracker-mode migration, not fresh-setup). Any fixture listed here must
// have a CLAUDE.md at its root.
const PROBE_FIXTURES = ["mode-none-baseline", "mode-none-fresh-setup", "mode-none-v2-migration"];

// Layer 3 — Schema M probe (M13, AC-49.8). Validates v2 layout invariants
// on the golden v2 fixture. Checks:
//   - every specs/frs/**/*.md filename matches ^fr_[0-9A-HJKMNP-TV-Z]{26}\.md$
//   - frontmatter id: field equals filename stem byte-for-byte (NFR-15 invariant 2)
//   - specs/.dpt-layout has version: v2
//   - regenerateIndex(specsDir) produces the committed INDEX.md byte-for-byte
// A probe failure here means the v2 fixture drifted or the generator regressed.
const V2_FIXTURE = "v2-minimal";

/**
 * Canonical Schema L probe (docs/patterns.md § Tracker Mode Probe).
 *
 * Returns:
 *   - "none"        — CLAUDE.md absent OR zero `^## Task Tracking$` lines.
 *   - "malformed"   — more than one `^## Task Tracking$` line (NFR-10).
 *   - tracker mode  — parsed `mode: <value>` under the single heading.
 *
 * Implementation mirrors the literal grep: only lines whose entire content
 * equals "## Task Tracking" count. The probe does NOT read the section
 * body unless exactly one anchor is present, matching the canonical form.
 */
export type SchemaLResult =
  | { mode: "none" }
  | { mode: "malformed"; count: number }
  | { mode: string };

export function runSchemaLProbe(claudeMdPath: string): SchemaLResult {
  if (!existsSync(claudeMdPath)) return { mode: "none" };
  const body = readFileSync(claudeMdPath, "utf8");
  let anchorCount = 0;
  const lines = body.split("\n");
  for (const line of lines) {
    if (line === "## Task Tracking") anchorCount++;
  }
  if (anchorCount === 0) return { mode: "none" };
  if (anchorCount > 1) return { mode: "malformed", count: anchorCount };

  // Exactly one anchor — extract `mode: <value>` from the section body.
  // Mirrors Schema L step 3: scan forward from the anchor, stop at the
  // next `## ` or `### ` heading (including `### Sync log`, which is
  // explicitly excluded from key: value parsing), or at EOF.
  let inSection = false;
  for (const line of lines) {
    if (line === "## Task Tracking") {
      inSection = true;
      continue;
    }
    if (!inSection) continue;
    if (line.startsWith("## ") || line.startsWith("### ")) break;
    const m = /^mode:\s*(\S+)\s*$/.exec(line);
    if (m && m[1] !== undefined) return { mode: m[1] };
  }
  // Anchor present but no `mode:` key found — treat as malformed per Schema L.
  return { mode: "malformed", count: 1 };
}

if (import.meta.main) {
  let failures = 0;

  // Layer 1 — byte-diff.
  for (const { name, snapshot } of FIXTURES) {
    const snapshotPath = join(baselineDir, snapshot);

    if (!existsSync(snapshotPath)) {
      console.error(`verify-regression: baseline snapshot not found at ${snapshotPath}`);
      process.exit(2);
    }

    const result = spawnSync("bun", ["run", captureTs, name], { encoding: "utf8" });
    if (result.status !== 0) {
      console.error(`verify-regression: capture script failed for fixture '${name}'`);
      if (result.stderr) console.error(result.stderr);
      process.exit(2);
    }

    const actual = result.stdout;
    const expected = readFileSync(snapshotPath, "utf8");

    if (actual === expected) {
      console.log(`Regression clean: ${name} byte-identical to baseline.`);
      continue;
    }

    failures++;
    console.error(`REGRESSION DETECTED in fixture '${name}': output diverges from baseline.`);
    console.error("This is a Pattern 9 violation. Stop-ship.");

    const a = expected.split("\n");
    const b = actual.split("\n");
    const max = Math.max(a.length, b.length);
    let printed = 0;
    for (let i = 0; i < max && printed < 50; i++) {
      if (a[i] !== b[i]) {
        if (a[i] !== undefined) console.error(`- ${a[i]}`);
        if (b[i] !== undefined) console.error(`+ ${b[i]}`);
        printed++;
      }
    }
  }

  // Layer 2 — Schema L probe (AC-34.8).
  for (const name of PROBE_FIXTURES) {
    const claudeMdPath = join(projectsDir, name, "CLAUDE.md");
    if (!existsSync(claudeMdPath)) {
      console.error(
        `verify-regression: probe fixture '${name}' missing CLAUDE.md at ${claudeMdPath}`,
      );
      process.exit(2);
    }
    const probe = runSchemaLProbe(claudeMdPath);
    if (probe.mode === "none") {
      console.log(`Schema L probe clean: ${name} reports mode=none (AC-34.8).`);
    } else if (probe.mode === "malformed") {
      failures++;
      console.error(
        `SCHEMA L PROBE FAILURE in '${name}': ${probe.count} '## Task Tracking' anchors found (expected 0 for mode=none). This violates AC-34.8 and Pattern 9.`,
      );
    } else {
      failures++;
      console.error(
        `SCHEMA L PROBE FAILURE in '${name}': probed mode='${probe.mode}' (expected 'none'). This violates AC-34.8 and Pattern 9.`,
      );
    }
  }

  // Layer 3 — Schema M probe (AC-49.8, v2 layout invariants).
  const v2Failures = runSchemaMProbe();
  failures += v2Failures;

  if (failures > 0) {
    console.error(`\n${failures} regression check(s) failed.`);
    process.exit(1);
  }

  console.log(
    `\nAll ${FIXTURES.length} mode-none fixtures byte-identical to baseline; Schema L probe clean on ${PROBE_FIXTURES.length} fixtures; Schema M probe clean on ${V2_FIXTURE}.`,
  );
  process.exit(0);
}

// Schema M probe (AC-49.8). Synchronous invariant checks against the
// committed v2-minimal fixture — no subprocess, no async. The INDEX.md
// regenerate-and-diff determinism check lives in index_gen.test.ts (bun
// test) so this script stays synchronous and fast.
function runSchemaMProbe(): number {
  const fixtureSpecsDir = join(pluginRoot, "tests", "fixtures", V2_FIXTURE, "specs");
  if (!existsSync(fixtureSpecsDir)) {
    console.error(`verify-regression: Schema M probe skipped — ${fixtureSpecsDir} not present.`);
    return 0;
  }

  let failures = 0;
  const ulidFilenameRe = /^fr_[0-9A-HJKMNP-TV-Z]{26}\.md$/;

  const layoutPath = join(fixtureSpecsDir, ".dpt-layout");
  if (!existsSync(layoutPath)) {
    failures++;
    console.error(`SCHEMA M PROBE FAILURE: missing ${layoutPath}`);
  } else {
    const body = readFileSync(layoutPath, "utf8");
    if (!/^version:\s*v2\s*$/m.test(body)) {
      failures++;
      console.error(`SCHEMA M PROBE FAILURE: ${layoutPath} missing 'version: v2' line`);
    }
  }

  const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
  const frsDir = join(fixtureSpecsDir, "frs");
  const scan = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        scan(full);
        continue;
      }
      if (!entry.endsWith(".md")) continue;
      if (!ulidFilenameRe.test(entry)) {
        failures++;
        console.error(`SCHEMA M PROBE FAILURE: ${full} — filename does not match ULID regex (AC-41.1)`);
        continue;
      }
      const stem = entry.replace(/\.md$/, "");
      const text = readFileSync(full, "utf8");
      const idMatch = /^id:\s*(\S+)\s*$/m.exec(text);
      if (!idMatch || idMatch[1] !== stem) {
        failures++;
        console.error(
          `SCHEMA M PROBE FAILURE: ${full} — frontmatter id='${idMatch?.[1] ?? "<missing>"}' != filename stem '${stem}' (NFR-15 invariant 2)`,
        );
      }
    }
  };
  scan(frsDir);

  if (failures === 0) console.log(`Schema M probe clean: ${V2_FIXTURE} v2-layout invariants hold (AC-49.8).`);
  return failures;
}
