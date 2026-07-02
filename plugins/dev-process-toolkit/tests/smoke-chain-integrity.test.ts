import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// STE-355 AC-STE-355.2 — end-of-run chain-integrity assertion (unit tests).
//
// The 2026-07-02 conformance run truncated silently on both legs (F2 + F3):
// children fired grandchild spawns in the background, exited RC 0 with
// "waiting for its completion notification", and Phases 2.X/3/4/5/8/9 never
// ran. The reliable truncation footprint on both captured legs was the
// STE-352 detector's `result: ABSENT` — a per-skill capture that exists but
// never carries a stream-json `type: "result"` event.
//
// Contract pinned here (implemented by
// adapters/_shared/src/smoke_child_capture.ts — exported there directly, or
// re-exported from a sibling module):
//
//   assertChainIntegrity(
//     expected: Array<{ child: string; path: string }>,
//   ): ChildSpawnFinding[]
//
//   - one entry per expected per-skill capture, in chain order; `path` is
//     the capture's log PATH (fixture-dir file / temp file / real /tmp log)
//   - a capture is healthy iff the file EXISTS, is NON-EMPTY, and
//     parseStreamJsonEvents finds a top-level `type: "result"` event
//   - each miss yields exactly one finding in the ChildSpawnFinding shape
//     ({ severity: "high", diagnostic }) whose diagnostic is
//       STE-355 regression: chain truncated — <child> (<reason>)
//     naming the truncated child; the result-absent reason is spelled
//     `result event absent` (the FR's pinned wording)
//   - findings come back in input (chain) order; healthy captures
//     contribute nothing

import { assertChainIntegrity } from "../adapters/_shared/src/smoke_child_capture";

const DIAG_PREFIX = "STE-355 regression: chain truncated — ";

const fixtureDir = join(import.meta.dir, "fixtures", "smoke-child-capture");
const healthyPath = join(fixtureDir, "healthy-child.ndjson");
const emptyPath = join(fixtureDir, "empty.ndjson");
const resultAbsentPath = join(fixtureDir, "result-absent.ndjson");
const deniedPath = join(fixtureDir, "denied-nested-spawn.ndjson");

// Temp-dir cases the committed fixture family can't express: a path that
// was never written (missing capture) and a capture whose only "result"
// is a substring inside assistant prose.
const tempDir = mkdtempSync(join(tmpdir(), "dpt-chain-integrity-"));
const missingPath = join(tempDir, "never-written-implement.ndjson");
const resultInProsePath = join(tempDir, "result-in-prose-only.ndjson");
writeFileSync(
  resultInProsePath,
  [
    JSON.stringify({
      type: "assistant",
      message: {
        content: [
          {
            type: "text",
            // The token {"type":"result"} appears only INSIDE assistant
            // prose — a naive substring grep would call this healthy.
            text: 'The stream should end with a {"type":"result"} event.',
          },
        ],
        stop_reason: "end_turn",
      },
    }),
    "",
  ].join("\n"),
);

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("AC-STE-355.2 — assertChainIntegrity: exported contract", () => {
  test("assertChainIntegrity is exported from smoke_child_capture", () => {
    expect(typeof assertChainIntegrity).toBe("function");
  });
});

describe("AC-STE-355.2 — assertChainIntegrity: healthy chain", () => {
  test("a fully healthy six-skill chain yields no findings", () => {
    const expected = [
      "setup",
      "spec-write",
      "implement",
      "gate-check",
      "spec-review",
      "simplify",
    ].map((child) => ({ child, path: healthyPath }));
    expect(assertChainIntegrity(expected)).toEqual([]);
  });

  test("a denied-but-complete capture is chain-healthy — denial detection is checkChildSpawnCapture's job, not chain integrity's", () => {
    // denied-nested-spawn.ndjson carries a permission_denials entry AND a
    // `type: "result"` event: the child completed, so the chain is intact.
    // The STE-350 detector fires on it separately; the two detectors are
    // orthogonal by design.
    expect(
      assertChainIntegrity([{ child: "gate-check", path: deniedPath }]),
    ).toEqual([]);
  });
});

describe("AC-STE-355.2 — assertChainIntegrity: truncation modes", () => {
  test("a missing capture file is one high-severity finding naming the child", () => {
    const findings = assertChainIntegrity([
      { child: "implement", path: missingPath },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("high");
    expect(findings[0].diagnostic).toContain(`${DIAG_PREFIX}implement`);
    // The FR's diagnostic shape carries a parenthesized reason:
    //   STE-355 regression: chain truncated — <child> (<reason>)
    expect(findings[0].diagnostic).toMatch(/\(.+\)/);
  });

  test("a 0-byte capture is one high-severity finding naming the child", () => {
    const findings = assertChainIntegrity([
      { child: "gate-check", path: emptyPath },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("high");
    expect(findings[0].diagnostic).toContain(`${DIAG_PREFIX}gate-check`);
    expect(findings[0].diagnostic).toMatch(/\(.+\)/);
  });

  test("a non-empty capture with no result event is one finding with the pinned `result event absent` reason", () => {
    const findings = assertChainIntegrity([
      { child: "implement", path: resultAbsentPath },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("high");
    expect(findings[0].diagnostic).toContain(`${DIAG_PREFIX}implement`);
    expect(findings[0].diagnostic).toContain("result event absent");
  });

  test("an existing-but-unreadable capture path is one finding, not a driver crash", () => {
    // The tempDir itself: existsSync(true) but readFileSync throws EISDIR.
    // Same degradation contract as every other miss — a finding, never an
    // uncaught exception that would kill the whole driver.
    const findings = assertChainIntegrity([
      { child: "spec-write", path: tempDir },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("high");
    expect(findings[0].diagnostic).toContain(`${DIAG_PREFIX}spec-write`);
    expect(findings[0].diagnostic).toContain("capture unreadable");
  });

  test("a result-shaped token inside assistant prose does NOT count as a result event", () => {
    const findings = assertChainIntegrity([
      { child: "spec-review", path: resultInProsePath },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("high");
    expect(findings[0].diagnostic).toContain(`${DIAG_PREFIX}spec-review`);
  });
});

describe("AC-STE-355.2 — assertChainIntegrity: mixed chains", () => {
  test("one truncated capture among healthy ones yields exactly one finding naming only the truncated child", () => {
    const findings = assertChainIntegrity([
      { child: "setup", path: healthyPath },
      { child: "implement", path: resultAbsentPath },
      { child: "simplify", path: healthyPath },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].diagnostic).toContain(`${DIAG_PREFIX}implement`);
    expect(findings[0].diagnostic).not.toContain("setup");
    expect(findings[0].diagnostic).not.toContain("simplify");
  });

  test("multiple misses yield one finding each, in chain (input) order", () => {
    const findings = assertChainIntegrity([
      { child: "setup", path: healthyPath },
      { child: "spec-write", path: emptyPath },
      { child: "implement", path: missingPath },
      { child: "gate-check", path: resultAbsentPath },
    ]);
    expect(findings).toHaveLength(3);
    expect(findings[0].diagnostic).toContain(`${DIAG_PREFIX}spec-write`);
    expect(findings[1].diagnostic).toContain(`${DIAG_PREFIX}implement`);
    expect(findings[2].diagnostic).toContain(`${DIAG_PREFIX}gate-check`);
    for (const f of findings) expect(f.severity).toBe("high");
  });
});
