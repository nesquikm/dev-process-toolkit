import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// STE-356 AC-STE-356.3 — allowlist-inert runtime detector (unit tests).
//
// The 2026-07-02 conformance run (finding F4, high) showed grandchildren
// spawned in fresh test-project cwds IGNORING the scaffolded
// `.claude/settings.json` allow-list — captured logs open with
//
//   Ignoring 10 permissions.allow entries from .claude/settings.json:
//   this workspace has not been trusted
//
// so the STE-252 policy artifact was inert at the grandchild layer and the
// canonical chain ran on auto-mode classifier goodwill (allow-list inert =
// policy breach).
//
// Contract pinned here (implemented by
// adapters/_shared/src/smoke_child_capture.ts, alongside the STE-350 and
// STE-355 detector families):
//
//   checkAllowlistInert(raw: string, child: string): ChildSpawnFinding[]
//
//   - RAW-TEXT detector: `raw` is the capture's raw text (the warning is a
//     stderr line interleaved into the 2>&1 NDJSON log, or echoed inside an
//     assistant text block when a child relays its grandchild's stderr) —
//     no NDJSON parsing is required to fire
//   - a capture whose raw text carries ALL THREE markers
//     `Ignoring` + `permissions.allow entries` + `has not been trusted`
//     yields EXACTLY ONE finding in the ChildSpawnFinding shape
//     ({ severity: "high", diagnostic }) whose diagnostic is
//       STE-356 regression: allow-list inert — <child> (workspace untrusted)
//   - a healthy capture (no warning) yields []
//   - fewer than all three markers ⇒ [] (no false positives on unrelated
//     "Ignoring …" prose or allow-list discussion)
//   - the entry count is NOT pinned — "Ignoring 3 permissions.allow
//     entries …" fires the same as "Ignoring 10 …"
//   - emptiness/denial/truncation detection stays with
//     checkChildSpawnCapture / assertChainIntegrity — the detectors are
//     orthogonal by design

import { checkAllowlistInert } from "../adapters/_shared/src/smoke_child_capture";

const DIAG_PREFIX = "STE-356 regression: allow-list inert — ";

const INERT_WARNING =
  "Ignoring 10 permissions.allow entries from .claude/settings.json: this workspace has not been trusted";

const fixtureDir = join(import.meta.dir, "fixtures", "smoke-child-capture");
const inert = readFileSync(join(fixtureDir, "allowlist-inert.ndjson"), "utf8");
const healthy = readFileSync(join(fixtureDir, "healthy-child.ndjson"), "utf8");

const assistantText = (text: string): string =>
  JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "text", text }], stop_reason: null },
  });

describe("AC-STE-356.3 — checkAllowlistInert: exported contract", () => {
  test("checkAllowlistInert is exported from smoke_child_capture", () => {
    expect(typeof checkAllowlistInert).toBe("function");
  });
});

describe("AC-STE-356.3 — checkAllowlistInert: inert-warning capture", () => {
  test("the inert-warning fixture yields exactly one high-severity finding with the pinned diagnostic", () => {
    const findings = checkAllowlistInert(inert, "implement");
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("high");
    expect(findings[0].diagnostic).toBe(
      `${DIAG_PREFIX}implement (workspace untrusted)`,
    );
  });

  test("the diagnostic names the child that was passed in", () => {
    const findings = checkAllowlistInert(inert, "spec-write");
    expect(findings).toHaveLength(1);
    expect(findings[0].diagnostic).toBe(
      `${DIAG_PREFIX}spec-write (workspace untrusted)`,
    );
  });

  test("the warning fires from raw text even when echoed inside an assistant text block (grandchild stderr relay)", () => {
    const ndjson = [
      assistantText(`the grandchild's log opened with: ${INERT_WARNING}`),
      JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: false,
        result: "done",
        permission_denials: [],
      }),
      "",
    ].join("\n");
    const findings = checkAllowlistInert(ndjson, "gate-check");
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("high");
    expect(findings[0].diagnostic).toBe(
      `${DIAG_PREFIX}gate-check (workspace untrusted)`,
    );
  });

  test("the entry count is not pinned — a 3-entry warning fires the same as a 10-entry one", () => {
    const raw = [
      "Ignoring 3 permissions.allow entries from .claude/settings.json: this workspace has not been trusted",
      healthy,
    ].join("\n");
    const findings = checkAllowlistInert(raw, "setup");
    expect(findings).toHaveLength(1);
    expect(findings[0].diagnostic).toBe(
      `${DIAG_PREFIX}setup (workspace untrusted)`,
    );
  });

  test("a repeated warning (child + grandchild both untrusted) still yields exactly ONE finding", () => {
    const raw = [INERT_WARNING, healthy.trimEnd(), INERT_WARNING, ""].join(
      "\n",
    );
    const findings = checkAllowlistInert(raw, "simplify");
    expect(findings).toHaveLength(1);
    expect(findings[0].diagnostic).toBe(
      `${DIAG_PREFIX}simplify (workspace untrusted)`,
    );
  });
});

describe("AC-STE-356.3 — checkAllowlistInert: healthy / negative captures", () => {
  test("a healthy capture yields no findings", () => {
    expect(checkAllowlistInert(healthy, "spec-write")).toEqual([]);
  });

  test("an empty capture yields no findings — emptiness is checkChildSpawnCapture's job, the detectors are orthogonal", () => {
    expect(checkAllowlistInert("", "implement")).toEqual([]);
  });

  test("unrelated 'Ignoring …' prose without the trust warning does not fire", () => {
    const ndjson = [
      assistantText("Ignoring the stale lockfile; proceeding with bun install."),
      "",
    ].join("\n");
    expect(checkAllowlistInert(ndjson, "setup")).toEqual([]);
  });

  test("allow-list discussion without 'Ignoring' + 'has not been trusted' does not fire", () => {
    const ndjson = [
      assistantText(
        "The tracked permissions.allow entries cover every Bash pattern the chain needs.",
      ),
      "",
    ].join("\n");
    expect(checkAllowlistInert(ndjson, "gate-check")).toEqual([]);
  });

  test("'has not been trusted' alone (no allow-list markers) does not fire", () => {
    const ndjson = [
      assistantText("this workspace has not been trusted yet — seeding trust now"),
      "",
    ].join("\n");
    expect(checkAllowlistInert(ndjson, "spec-review")).toEqual([]);
  });
});
