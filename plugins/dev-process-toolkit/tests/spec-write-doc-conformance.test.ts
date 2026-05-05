import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// STE-226 — Auto-mode/`-p` carve-out: explicit pre-authorization marker.
// `/spec-write` SKILL.md must carry the canonical marker line
// `<dpt:auto-approve>v1</dpt:auto-approve>` at three byte-repeated sites:
// § 0b step 4, § 4, § 7a. The marker is a literal-string detection contract;
// parent skills inject it into the prompt body when spawning child sessions
// under `claude -p`. STE-213 / STE-220 prose-only attempts both falsified
// end-to-end; this byte-checkable contract is the third attempt.

const pluginRoot = join(import.meta.dir, "..");
const skillPath = join(pluginRoot, "skills", "spec-write", "SKILL.md");
const MARKER = "<dpt:auto-approve>v1</dpt:auto-approve>";

function read(): string {
  return readFileSync(skillPath, "utf8");
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length;
  }
  return count;
}

describe("AC-STE-226.3 — marker is byte-grep-checkable at three byte-repeated sites", () => {
  test("marker appears at least 3 times in /spec-write SKILL.md", () => {
    const body = read();
    expect(countOccurrences(body, MARKER)).toBeGreaterThanOrEqual(3);
  });

  test("§ 0b step 4 (FR-draft gate) carries the marker", () => {
    const body = read();
    // The § 0b step 4 paragraph gates Provider.sync + FR file write.
    // Anchor by the canonical phrase that opens the gate prose.
    const draftGateIdx = body.indexOf("Draft acceptance gate");
    expect(draftGateIdx).toBeGreaterThan(-1);
    // The marker must appear within the same paragraph (next ~2000 chars
    // before the next numbered step or §).
    const slice = body.slice(draftGateIdx, draftGateIdx + 2500);
    expect(slice).toContain(MARKER);
  });

  test("§ 4 (Review and confirm) carries the marker", () => {
    const body = read();
    const sec4Idx = body.indexOf("### 4. Review and confirm");
    expect(sec4Idx).toBeGreaterThan(-1);
    const sec5Idx = body.indexOf("### 5. Cross-check consistency");
    expect(sec5Idx).toBeGreaterThan(sec4Idx);
    const slice = body.slice(sec4Idx, sec5Idx);
    expect(slice).toContain(MARKER);
  });

  test("§ 7a (commit gate) carries the marker", () => {
    const body = read();
    const sec7aIdx = body.indexOf("### 7a. Stage spec changes and prompt for commit");
    expect(sec7aIdx).toBeGreaterThan(-1);
    const sec7Idx = body.indexOf("### 7. Report");
    expect(sec7Idx).toBeGreaterThan(sec7aIdx);
    const slice = body.slice(sec7aIdx, sec7Idx);
    expect(slice).toContain(MARKER);
  });
});

describe("AC-STE-226.2 / AC-STE-226.7 — legacy `Auto Mode Active` detection path is removed", () => {
  test("SKILL.md no longer carries the legacy detection contract `the conversation includes Auto Mode Active`", () => {
    const body = read();
    // The legacy active detection contract — the LLM-facing instruction
    // "default-apply y when the conversation includes `Auto Mode Active`
    // in any <system-reminder> block" — must be gone at every active
    // gate site. Migration / audit notes that reference the removed
    // mechanism are fine: they describe history, not active behavior.
    // The trigger phrasings to forbid are the legacy active-detection
    // shapes; both prior STE-213 / STE-220 gates carried the same
    // wording, so a single regex covers all sites.
    expect(body).not.toMatch(/conversation\s+includes\s+`?Auto Mode Active`?/i);
    expect(body).not.toMatch(/<system-reminder>\s+block/i);
  });

  test("SKILL.md no longer carries the legacy `claude -p non-interactive` inference contract as a default-apply trigger", () => {
    const body = read();
    // The legacy `claude -p` inference contract: "default-apply y when
    // the invocation is `claude -p` non-interactive". The marker is the
    // explicit handoff now — `claude -p` references that survive belong
    // to migration / threat-model / spawn-snippet documentation, NOT to
    // an active default-apply trigger.
    expect(body).not.toMatch(
      /default-apply.{1,80}invocation\s+is\s+`?claude -p`?\s+non-interactive/i,
    );
  });

  test("SKILL.md documents the marker as the single deterministic mechanism", () => {
    const body = read();
    expect(body).toMatch(
      /single mechanism|single deterministic mechanism|marker is the .*mechanism/i,
    );
  });
});

describe("AC-STE-226.7 — migration note documents removal of legacy detection", () => {
  test("SKILL.md contains a migration note explaining marker is the single mechanism", () => {
    const body = read();
    // Per AC-STE-226.7, the migration note must document: (a) legacy
    // Auto-Mode-Active path removed, (b) marker is the single mechanism,
    // (c) callers without the marker get interactive gating.
    expect(body).toMatch(/legacy.*removed|removed.*legacy/i);
    expect(body).toMatch(/single mechanism|single deterministic mechanism/i);
    expect(body).toMatch(/without the marker.*interactive|interactive.*without the marker/i);
  });
});
