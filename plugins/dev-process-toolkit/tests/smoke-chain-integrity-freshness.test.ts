import { afterAll, describe, expect, test } from "bun:test";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// STE-358 AC-STE-358.2 — freshness gating on assertChainIntegrity (unit
// tests).
//
// The iter-2 conformance run (2026-07-02, finding F2) showed a stale
// result-bearing per-skill log surviving Phase 0.5's self-reported wipe:
// iter-1's dpt-smoke-linear-implement.log carried a `result` event and would
// have false-passed an ungated Phase 2.Y / Phase A completeness check. The
// content checks alone cannot tell a fresh capture from last run's.
//
// Contract pinned here (implemented by
// adapters/_shared/src/smoke_child_capture.ts):
//
//   assertChainIntegrity(
//     expected: Array<{ child: string; path: string }>,
//     runStart?: number | Date,          // epoch ms or Date
//   ): ChildSpawnFinding[]
//
//   - when runStart is provided, a capture whose statSync(path).mtimeMs
//     predates it (`mtimeMs < runStart`) yields the pinned finding
//       STE-355 regression: chain truncated — <child> (capture stale (pre-run))
//     BEFORE the content checks run — a stale result-bearing capture is
//     never healthy
//   - the gate is strictly `<`: mtime exactly at runStart is fresh
//   - a missing capture still reports `capture missing` (the existence
//     check precedes the stat — no crash on ENOENT)
//   - omitted runStart ⇒ behavior byte-identical to the STE-355 contract
//     (no freshness gate; see smoke-chain-integrity.test.ts)

import { assertChainIntegrity } from "../adapters/_shared/src/smoke_child_capture";

const DIAG_PREFIX = "STE-355 regression: chain truncated — ";
const STALE_REASON = "capture stale (pre-run)";

const fixtureDir = join(import.meta.dir, "fixtures", "smoke-child-capture");
const healthyNdjson = readFileSync(
  join(fixtureDir, "healthy-child.ndjson"),
  "utf8",
);
const resultAbsentNdjson = readFileSync(
  join(fixtureDir, "result-absent.ndjson"),
  "utf8",
);

// Fixed whole-second run-start so mtime comparisons are float-exact
// (whole seconds survive the utimes ms→s→ms round trip losslessly).
const RUN_START_MS = Date.UTC(2026, 6, 3, 12, 0, 0);

const tempDir = mkdtempSync(join(tmpdir(), "dpt-chain-freshness-"));

function captureAt(name: string, content: string, mtimeMs: number): string {
  const path = join(tempDir, name);
  writeFileSync(path, content);
  const stamp = new Date(mtimeMs);
  utimesSync(path, stamp, stamp);
  return path;
}

// Stale family: mtime one minute BEFORE run-start.
const staleHealthyPath = captureAt(
  "stale-healthy.ndjson",
  healthyNdjson,
  RUN_START_MS - 60_000,
);
const staleResultAbsentPath = captureAt(
  "stale-result-absent.ndjson",
  resultAbsentNdjson,
  RUN_START_MS - 60_000,
);
const staleEmptyPath = captureAt(
  "stale-empty.ndjson",
  "",
  RUN_START_MS - 60_000,
);

// Fresh family: mtime one minute AFTER run-start, plus the exact-boundary case.
const freshHealthyPath = captureAt(
  "fresh-healthy.ndjson",
  healthyNdjson,
  RUN_START_MS + 60_000,
);
const boundaryHealthyPath = captureAt(
  "boundary-healthy.ndjson",
  healthyNdjson,
  RUN_START_MS,
);

// Never written — the existing capture-missing mode.
const missingPath = join(tempDir, "never-written-implement.ndjson");

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("AC-STE-358.2 — assertChainIntegrity freshness gating: stale captures", () => {
  test("a result-bearing capture whose mtime predates runStart is one high finding with the pinned `capture stale (pre-run)` reason", () => {
    const findings = assertChainIntegrity(
      [{ child: "implement", path: staleHealthyPath }],
      RUN_START_MS,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("high");
    expect(findings[0].diagnostic).toBe(
      `${DIAG_PREFIX}implement (${STALE_REASON})`,
    );
  });

  test("runStart accepts a Date — same stale verdict as the epoch-ms form", () => {
    const findings = assertChainIntegrity(
      [{ child: "gate-check", path: staleHealthyPath }],
      new Date(RUN_START_MS),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("high");
    expect(findings[0].diagnostic).toBe(
      `${DIAG_PREFIX}gate-check (${STALE_REASON})`,
    );
  });

  test("staleness precedes content checks: a stale result-absent capture reports stale, not `result event absent`", () => {
    const findings = assertChainIntegrity(
      [{ child: "implement", path: staleResultAbsentPath }],
      RUN_START_MS,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].diagnostic).toContain(STALE_REASON);
    expect(findings[0].diagnostic).not.toContain("result event absent");
  });

  test("staleness precedes content checks: a stale empty capture reports stale, not `capture empty`", () => {
    const findings = assertChainIntegrity(
      [{ child: "spec-write", path: staleEmptyPath }],
      RUN_START_MS,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].diagnostic).toContain(STALE_REASON);
    expect(findings[0].diagnostic).not.toContain("capture empty");
  });
});

describe("AC-STE-358.2 — assertChainIntegrity freshness gating: fresh captures stay healthy", () => {
  test("a result-bearing capture whose mtime postdates runStart yields no findings (epoch-ms form)", () => {
    expect(
      assertChainIntegrity(
        [{ child: "setup", path: freshHealthyPath }],
        RUN_START_MS,
      ),
    ).toEqual([]);
  });

  test("a result-bearing capture whose mtime postdates runStart yields no findings (Date form)", () => {
    expect(
      assertChainIntegrity(
        [{ child: "simplify", path: freshHealthyPath }],
        new Date(RUN_START_MS),
      ),
    ).toEqual([]);
  });

  test("mtime exactly at runStart is fresh — the gate is strictly `mtime < runStart`", () => {
    expect(
      assertChainIntegrity(
        [{ child: "spec-review", path: boundaryHealthyPath }],
        RUN_START_MS,
      ),
    ).toEqual([]);
  });
});

describe("AC-STE-358.2 — omitted runStart: behavior unchanged", () => {
  test("a pre-run-mtime healthy capture yields no findings when runStart is omitted", () => {
    expect(
      assertChainIntegrity([{ child: "implement", path: staleHealthyPath }]),
    ).toEqual([]);
  });

  test("content checks unchanged: a result-absent capture still reports `result event absent` when runStart is omitted", () => {
    const findings = assertChainIntegrity([
      { child: "implement", path: staleResultAbsentPath },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].diagnostic).toContain("result event absent");
    expect(findings[0].diagnostic).not.toContain(STALE_REASON);
  });
});

describe("AC-STE-358.2 — freshness gating composes with existing miss modes", () => {
  test("a missing capture still reports `capture missing` when runStart is provided — existence precedes the stat", () => {
    const findings = assertChainIntegrity(
      [{ child: "implement", path: missingPath }],
      RUN_START_MS,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("high");
    expect(findings[0].diagnostic).toContain(`${DIAG_PREFIX}implement`);
    expect(findings[0].diagnostic).toContain("capture missing");
    expect(findings[0].diagnostic).not.toContain(STALE_REASON);
  });

  test("mixed chain: one stale capture among fresh ones yields exactly one finding naming the stale child", () => {
    const findings = assertChainIntegrity(
      [
        { child: "setup", path: freshHealthyPath },
        { child: "implement", path: staleHealthyPath },
        { child: "simplify", path: freshHealthyPath },
      ],
      RUN_START_MS,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].diagnostic).toContain(`${DIAG_PREFIX}implement`);
    expect(findings[0].diagnostic).toContain(STALE_REASON);
  });

  test("multiple misses (stale + content) come back one finding each, in chain (input) order", () => {
    const findings = assertChainIntegrity(
      [
        { child: "setup", path: freshHealthyPath },
        { child: "spec-write", path: staleHealthyPath },
        { child: "implement", path: missingPath },
        { child: "gate-check", path: staleEmptyPath },
      ],
      RUN_START_MS,
    );
    expect(findings).toHaveLength(3);
    expect(findings[0].diagnostic).toContain(`${DIAG_PREFIX}spec-write`);
    expect(findings[0].diagnostic).toContain(STALE_REASON);
    expect(findings[1].diagnostic).toContain(`${DIAG_PREFIX}implement`);
    expect(findings[1].diagnostic).toContain("capture missing");
    expect(findings[2].diagnostic).toContain(`${DIAG_PREFIX}gate-check`);
    expect(findings[2].diagnostic).toContain(STALE_REASON);
    for (const finding of findings) expect(finding.severity).toBe("high");
  });
});
