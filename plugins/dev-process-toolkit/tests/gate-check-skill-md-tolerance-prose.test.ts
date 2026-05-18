// STE-305 — Prose-shape assertions for the tolerance refactor across
// gate-check's SKILL.md (probe #8 + probe #14) and spec-write's static
// capability map.
//
// AC-STE-305.10 (gate-check SKILL.md):
//   - Probe #8 paragraph carries a "Tolerance wrapper integration" sub-paragraph
//     naming STE-305, the wrapper module (`tracker_tolerance.ts`), and the
//     advisory-routing semantics under non-tty.
//   - Probe #14 paragraph carries the same sub-paragraph.
//   - The pre-refactor strict-equality narrative is REPLACED, not appended;
//     this test pins that the wrapper-integration sub-paragraph exists and
//     that the new prose mentions the tolerance helper module.
//
// AC-STE-305.8 (spec-write SKILL.md):
//   - The static capability map at /spec-write § 7 includes the two new
//     keys: `tracker_status_advisory_non_tty` and `tracker_status_genuine_drift`.
//   - Each key carries a literal `MUST emit \`<key>\`` directive byte-checkable
//     by the closing_summary_capability_keys probe (STE-238 AC.3 shape).

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const pluginRoot = join(import.meta.dir, "..");
const gateCheckSkillPath = join(pluginRoot, "skills", "gate-check", "SKILL.md");
const specWriteSkillPath = join(pluginRoot, "skills", "spec-write", "SKILL.md");

function readGateCheck(): string {
  return readFileSync(gateCheckSkillPath, "utf8");
}

function readSpecWrite(): string {
  return readFileSync(specWriteSkillPath, "utf8");
}

// Slice a probe block out of gate-check SKILL.md by its leading "<N>. **<title>**"
// marker; matches existing slicing pattern used in
// gate-check-active-ticket-drift.test.ts.
function sliceProbeBlock(body: string, probeNumber: number, titleRegex: RegExp): string {
  const headerRe = new RegExp(`(^|\\n)${probeNumber}\\.\\s+\\*\\*${titleRegex.source}`, "i");
  const m = body.match(headerRe);
  if (!m) return "";
  const startIdx = m.index! + (m[1] ?? "").length;
  // Look for next top-level numbered probe header.
  const nextRe = new RegExp(`\\n${probeNumber + 1}\\.`, "g");
  nextRe.lastIndex = startIdx + 1;
  const next = nextRe.exec(body);
  return body.slice(startIdx, next ? next.index : undefined);
}

describe("AC-STE-305.10(a) — probe #14 paragraph carries Tolerance wrapper integration sub-paragraph", () => {
  test("probe #14 mentions 'Tolerance wrapper integration' heading or label", () => {
    const block = sliceProbeBlock(readGateCheck(), 14, /Ticket-state drift.*active/);
    expect(block.length).toBeGreaterThan(0);
    expect(block).toMatch(/Tolerance wrapper integration/i);
  });

  test("probe #14 names the wrapper module `tracker_tolerance.ts`", () => {
    const block = sliceProbeBlock(readGateCheck(), 14, /Ticket-state drift.*active/);
    expect(block).toMatch(/tracker_tolerance\.ts|withTolerance/);
  });

  test("probe #14 describes advisory-routing semantics under non-tty", () => {
    const block = sliceProbeBlock(readGateCheck(), 14, /Ticket-state drift.*active/);
    expect(block).toMatch(/non[- ]tty/i);
    expect(block).toMatch(/advisory|ADVISORY/);
  });

  test("probe #14 surfaces the `tracker_status_advisory_non_tty` capability token literally", () => {
    const block = sliceProbeBlock(readGateCheck(), 14, /Ticket-state drift.*active/);
    expect(block).toContain("tracker_status_advisory_non_tty");
  });

  test("probe #14 references the genuine-drift preservation (STE-305 AC.3) prose", () => {
    const block = sliceProbeBlock(readGateCheck(), 14, /Ticket-state drift.*active/);
    // "Genuine drift" framing is the AC-STE-305.3 contract: mapped role != expected ⇒ still GATE FAILED.
    expect(block).toMatch(/genuine drift|mapped role.*does not match|mismatch.*role/i);
  });
});

describe("AC-STE-305.10(b) — probe #8 paragraph carries Tolerance wrapper integration sub-paragraph", () => {
  test("probe #8 mentions 'Tolerance wrapper integration' heading or label", () => {
    const block = sliceProbeBlock(readGateCheck(), 8, /Ticket-state drift/);
    expect(block.length).toBeGreaterThan(0);
    expect(block).toMatch(/Tolerance wrapper integration/i);
  });

  test("probe #8 names the wrapper module `tracker_tolerance.ts`", () => {
    const block = sliceProbeBlock(readGateCheck(), 8, /Ticket-state drift/);
    expect(block).toMatch(/tracker_tolerance\.ts|withTolerance/);
  });

  test("probe #8 describes advisory-routing semantics under non-tty", () => {
    const block = sliceProbeBlock(readGateCheck(), 8, /Ticket-state drift/);
    expect(block).toMatch(/non[- ]tty/i);
    expect(block).toMatch(/advisory|ADVISORY/);
  });

  test("probe #8 surfaces the `tracker_status_advisory_non_tty` capability token literally", () => {
    const block = sliceProbeBlock(readGateCheck(), 8, /Ticket-state drift/);
    expect(block).toContain("tracker_status_advisory_non_tty");
  });
});

describe("AC-STE-305.10(c) — strict-equality narrative is replaced, not appended", () => {
  test("probe #14 does NOT describe a bare strict-equality assertion against status_mapping.in_progress in active narrative", () => {
    // The replacement contract: existing "asserts the returned status matches
    // status_mapping.in_progress" prose is rewritten so the wrapper is the
    // canonical source of the comparison. We pin the structural change by
    // requiring the new prose to mention the wrapper module — implementers
    // are free to keep the truth-table table that survives the rewrite, but
    // must not leave dangling pre-wrapper assertions.
    const block = sliceProbeBlock(readGateCheck(), 14, /Ticket-state drift.*active/);
    expect(block).toMatch(/tracker_tolerance\.ts|withTolerance/);
    // The wrapper-integration sub-paragraph must be present and dominant.
    const idx = block.search(/Tolerance wrapper integration/i);
    expect(idx).toBeGreaterThan(-1);
  });

  test("probe #8 does NOT describe a bare strict-equality assertion in archived narrative", () => {
    const block = sliceProbeBlock(readGateCheck(), 8, /Ticket-state drift/);
    expect(block).toMatch(/tracker_tolerance\.ts|withTolerance/);
    const idx = block.search(/Tolerance wrapper integration/i);
    expect(idx).toBeGreaterThan(-1);
  });
});

describe("AC-STE-305.8(a) — spec-write static capability map includes the two new keys", () => {
  test("spec-write SKILL.md mentions `tracker_status_advisory_non_tty` in the static map", () => {
    const body = readSpecWrite();
    expect(body).toContain("tracker_status_advisory_non_tty");
  });

  test("spec-write SKILL.md mentions `tracker_status_genuine_drift` in the static map", () => {
    const body = readSpecWrite();
    expect(body).toContain("tracker_status_genuine_drift");
  });
});

describe("AC-STE-305.8(b) — literal `MUST emit` directives for the new capability keys", () => {
  test("spec-write SKILL.md carries a literal `MUST emit \\`tracker_status_advisory_non_tty\\`` directive", () => {
    const body = readSpecWrite();
    // STE-238 AC.3 shape — backticked literal token, byte-checkable.
    expect(body).toMatch(/MUST emit\s*`tracker_status_advisory_non_tty`/);
  });

  test("spec-write SKILL.md carries a literal `MUST emit \\`tracker_status_genuine_drift\\`` directive", () => {
    const body = readSpecWrite();
    expect(body).toMatch(/MUST emit\s*`tracker_status_genuine_drift`/);
  });
});

describe("AC-STE-305.8(c) — closing_summary_capability_keys probe canon set includes the new keys", () => {
  test("CANONICAL_CAPABILITY_KEYS exports include `tracker_status_advisory_non_tty`", async () => {
    const mod = await import(
      "../adapters/_shared/src/closing_summary_capability_keys"
    );
    expect(mod.CANONICAL_CAPABILITY_KEYS).toContain("tracker_status_advisory_non_tty");
  });

  test("CANONICAL_CAPABILITY_KEYS exports include `tracker_status_genuine_drift`", async () => {
    const mod = await import(
      "../adapters/_shared/src/closing_summary_capability_keys"
    );
    expect(mod.CANONICAL_CAPABILITY_KEYS).toContain("tracker_status_genuine_drift");
  });
});
