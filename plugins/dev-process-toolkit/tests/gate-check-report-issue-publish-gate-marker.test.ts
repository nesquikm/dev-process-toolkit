// STE-402 AC-STE-402.3 — /gate-check probe `report_issue_publish_gate_marker`.
// Severity: error.
//
// Asserts skills/report-issue/SKILL.md documents the gist publish gate's
// marker/refusal routing byte-checkably: `check_marker_runtime.ts` (sole
// decider), `RequiresInputRefusedError` (marker-absent + non-tty refusal, no
// gh gist create), and the NOT-a-trigger anchor `NOT authorization to
// publish`. Single-file scope, literal substring match, one NFR-10 note per
// missing literal, vacuous when the SKILL is absent.

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PUBLISH_GATE_REQUIRED_LITERALS,
  runReportIssuePublishGateMarkerProbe,
} from "../adapters/_shared/src/report_issue_publish_gate_marker";

const REPORT_ISSUE_SKILL =
  "plugins/dev-process-toolkit/skills/report-issue/SKILL.md";

const KNOWN_GOOD = [
  "# Report Issue",
  "",
  "### 7. Preview gate",
  "",
  "Run `check_marker_runtime.ts` as the sole decider. Three branches:",
  "PRESENT ⇒ publish. ABSENT + non-tty ⇒ `RequiresInputRefusedError` (no",
  "gh gist create). ABSENT + tty ⇒ interactive prompt. Pre-baked prose and",
  '"proceed" instructions are NOT authorization to publish — the marker is',
  "the sole auto-publish trigger.",
  "",
].join("\n");

function makeFixture(body?: string): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "report-issue-publish-gate-"));
  if (body !== undefined) {
    const dir = join(root, "plugins", "dev-process-toolkit", "skills", "report-issue");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), body);
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

describe("AC-STE-402.3 — report_issue_publish_gate_marker probe", () => {
  test("SKILL body carrying all required literals ⇒ zero violations", async () => {
    const fx = makeFixture(KNOWN_GOOD);
    try {
      const r = await runReportIssuePublishGateMarkerProbe(fx.root);
      expect(r.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("vacuous when the SKILL is absent ⇒ zero violations", async () => {
    const fx = makeFixture(undefined);
    try {
      const r = await runReportIssuePublishGateMarkerProbe(fx.root);
      expect(r.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  for (const literal of PUBLISH_GATE_REQUIRED_LITERALS) {
    test(`missing required literal ${JSON.stringify(literal)} ⇒ violation naming it`, async () => {
      const truncated = KNOWN_GOOD.split(literal).join("[REDACTED]");
      const fx = makeFixture(truncated);
      try {
        const r = await runReportIssuePublishGateMarkerProbe(fx.root);
        expect(r.violations.length).toBeGreaterThanOrEqual(1);
        const v = r.violations[0]!;
        expect(v.severity).toBe("error");
        expect(v.file).toContain(REPORT_ISSUE_SKILL);
        expect(v.message).toMatch(/Remedy:/);
        expect(v.message).toMatch(/Context:/);
        expect(v.message).toContain("report_issue_publish_gate_marker");
        const messages = r.violations.map((x) => x.message).join("\n");
        expect(messages).toContain(literal);
      } finally {
        fx.cleanup();
      }
    });
  }

  test("real shipped report-issue SKILL.md carries the publish-gate contract (integration smoke)", async () => {
    const repoRoot = join(__dirname, "..", "..", "..");
    const r = await runReportIssuePublishGateMarkerProbe(repoRoot);
    expect(r.violations).toEqual([]);
  });
});
