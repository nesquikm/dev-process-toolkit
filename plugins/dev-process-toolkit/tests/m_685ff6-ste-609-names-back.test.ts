// STE-609 (M_685ff6) — AC-STE-609.8: post-ship probe #63 grades names-back by
// repository, not by path string.
//
// A release made from a sibling-directory worktree of this repository used to
// raise "does not name this repo back": the sibling's plan names the PRIMARY
// checkout, and the check compared that path with the worktree's as strings.
// It now asks `sameRepository`. An unlocatable sibling stays a note, because
// archived plans are permanent; a sibling naming an unrelated path still fails.
//
// REAL git repositories from `tests/_span_fixture.ts` (GIT_ENV), torn down in a
// `finally`.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import {
  type PlanShipCoherenceReport,
  runPlanShipCoherenceProbe,
} from "../adapters/_shared/src/plan_ship_coherence";
import { git, makeSpanFixture, type SpanFixture } from "./_span_fixture";
import { A_NAME, B_NAME, MILESTONE, writePlan } from "./_sibling_state_fixture";

const LOCAL_VERSION = "2.83.0";
const DISAGREE = "does not name this repo back";

const describeReport = (r: PlanShipCoherenceReport): string =>
  `violations:\n${r.violations.map((v) => `  - [${v.kind}] ${v.reason}`).join("\n") || "  (none)"}\n` +
  `notes:\n${r.notes.map((n) => `  - ${n}`).join("\n") || "  (none)"}`;

async function withSpan<T>(body: (fx: SpanFixture, extra: string[]) => Promise<T>): Promise<T> {
  const fx = makeSpanFixture(MILESTONE);
  const extra: string[] = [];
  try {
    return await body(fx, extra);
  } finally {
    try {
      fx.cleanup();
    } finally {
      for (const d of extra) rmSync(d, { recursive: true, force: true });
    }
  }
}

/**
 * A worktree of A in a SIBLING directory of A (directly in the temp dir, so a
 * relative path to B reads the same from it as from A), holding the shipped
 * half: A's archived plan stamped `v2.83.0` and the matching CHANGELOG heading.
 * Returns the worktree root — the root the release was made from.
 */
function releaseFromWorktree(fx: SpanFixture, extra: string[], bPath?: string): string {
  const parent = mkdtempSync(join(tmpdir(), "dpt-609-rel-"));
  extra.push(parent);
  const wt = `${parent}-wt`;
  extra.push(wt);
  git(fx.a, "worktree", "add", "-q", "-b", "release", wt);
  writePlan(
    wt,
    "archive",
    MILESTONE,
    { [A_NAME]: ".", [B_NAME]: bPath ?? relative(wt, fx.b) },
    { shippedIn: `v${LOCAL_VERSION}` },
  );
  writeFileSync(
    join(wt, "CHANGELOG.md"),
    ["# Changelog", "", `## [${LOCAL_VERSION}] — 2026-09-10 — "Fixture"`, "", "- x", ""].join("\n"),
  );
  return wt;
}

describe("AC-STE-609.8 — probe #63 grades names-back with sameRepository", () => {
  test("a release made from a sibling-directory worktree raises no names-back violation when the sibling names the primary checkout (red on HEAD)", async () => {
    await withSpan(async (fx, extra) => {
      const wt = releaseFromWorktree(fx, extra);
      // B's plan names A back — by the PRIMARY checkout's path, as B's author wrote it.
      writePlan(
        fx.b,
        "archive",
        MILESTONE,
        { [A_NAME]: relative(fx.b, fx.a), [B_NAME]: "." },
        { shippedIn: "v1.4.0" },
      );
      const report = await runPlanShipCoherenceProbe(wt);
      expect(
        report.violations.filter((v) => v.reason.includes(DISAGREE)),
        describeReport(report),
      ).toEqual([]);
      expect(report.violations, describeReport(report)).toEqual([]);
    });
  });

  test("(control) the same release from the primary checkout raises no names-back violation", async () => {
    await withSpan(async (fx) => {
      writePlan(
        fx.a,
        "archive",
        MILESTONE,
        { [A_NAME]: ".", [B_NAME]: relative(fx.a, fx.b) },
        { shippedIn: `v${LOCAL_VERSION}` },
      );
      writeFileSync(
        join(fx.a, "CHANGELOG.md"),
        ["# Changelog", "", `## [${LOCAL_VERSION}] — 2026-09-10 — "Fixture"`, "", "- x", ""].join("\n"),
      );
      writePlan(
        fx.b,
        "archive",
        MILESTONE,
        { [A_NAME]: relative(fx.b, fx.a), [B_NAME]: "." },
        { shippedIn: "v1.4.0" },
      );
      const report = await runPlanShipCoherenceProbe(fx.a);
      expect(report.violations, describeReport(report)).toEqual([]);
    });
  });

  test("(control) a sibling that names an unrelated path still raises the names-back violation, from the worktree too", async () => {
    await withSpan(async (fx, extra) => {
      const wt = releaseFromWorktree(fx, extra);
      const unrelated = mkdtempSync(join(tmpdir(), "dpt-609-unrelated-"));
      extra.push(unrelated);
      writePlan(
        fx.b,
        "archive",
        MILESTONE,
        { [A_NAME]: relative(fx.b, unrelated), [B_NAME]: "." },
        { shippedIn: "v1.4.0" },
      );
      const report = await runPlanShipCoherenceProbe(wt);
      const rows = report.violations.filter((v) => v.reason.includes(DISAGREE));
      expect(rows, describeReport(report)).toHaveLength(1);
      expect(rows[0]!.reason).toContain(B_NAME);
    });
  });

  test("(control) an unlocatable sibling stays a note, never a violation", async () => {
    await withSpan(async (fx, extra) => {
      const wt = releaseFromWorktree(fx, extra, `${relative(fx.a, fx.b)}-gone`);
      const report = await runPlanShipCoherenceProbe(wt);
      expect(report.violations, describeReport(report)).toEqual([]);
      expect(
        report.notes.some((n) => n.includes(`${MILESTONE} → ${B_NAME} (unlocatable)`)),
        describeReport(report),
      ).toBe(true);
    });
  });
});
