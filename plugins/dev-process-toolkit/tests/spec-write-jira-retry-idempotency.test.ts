import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { specWriteStep7Map } from "./_skill-md";

// STE-157 — /spec-write idempotency hardening on Gateway-Timeout retry.
//
// The implementation is in-skill prose (LLM executes the contract; no TS driver
// exists for `Provider.sync(spec)` → `upsertTicketMetadata(null, …)`). These
// probes assert the prose carries the canonical backoff contract that smoke #6
// finding F6 motivated:
//
//   AC-STE-157.1 — spec-write SKILL.md § 0b step 4 names the backoff schedule
//                  (1s + 2s + 4s, three attempts) on the tracker-mode retry
//                  path, with the existing single-shot probe staying as the
//                  fast path.
//   AC-STE-157.3 — Step 7 plain-language map carries the
//                  `tracker_idempotency_uncertain` capability key with
//                  canonical prose.
//   AC-STE-157.4 — adapters/jira.md § `upsert_ticket_metadata` row documents
//                  the schedule + fallback; adapters/linear.md carries a
//                  one-line symmetric note for Linear's Gateway-Timeout class
//                  of failure mode.
//
// AC-STE-157.2 (regression test) is satisfied by *this* test file — the
// contract under test is the in-skill prose, so the regression is a
// doc-conformance probe. AC-STE-157.5 (smoke #8 re-run) is a live gate, not a
// unit test.

const pluginRoot = join(import.meta.dir, "..");
const specWriteSkill = join(pluginRoot, "skills", "spec-write", "SKILL.md");
const jiraAdapter = join(pluginRoot, "adapters", "jira.md");
const linearAdapter = join(pluginRoot, "adapters", "linear.md");

function read(path: string): string {
  return readFileSync(path, "utf8");
}

function extractStep4(body: string): string {
  // Step 4 is the `Provider.sync(spec)` step inside § 0b. The leading prose
  // may carry inline subsection markers (e.g., STE-220's "Draft acceptance
  // gate" preface that runs before the sync call) — anchor on the `\n4. `
  // line-start, then validate the slice contains "Provider.sync(spec)" so
  // the right step is being read regardless of leading-prose drift. End on
  // the next structural numbered step (a literal "5. " line at column 0).
  const start = body.indexOf("\n4. ");
  expect(start).toBeGreaterThan(-1);
  const tail = body.slice(start + 1);
  const endRel = tail.search(/\n5\. /);
  const slice = endRel === -1 ? body.slice(start) : body.slice(start, start + 1 + endRel);
  // Defense against the regex matching an unrelated `\n4. ` (e.g., a nested
  // numbered list). Step 4 of § 0b is the only one with the sync call.
  expect(slice).toContain("Provider.sync(spec)");
  return slice;
}

describe("STE-157 AC-STE-157.1 — spec-write step 4 names the backoff retry contract", () => {
  test("step 4 prose names the canonical 1+2+4s schedule", () => {
    const step4 = extractStep4(read(specWriteSkill));
    expect(step4).toMatch(/1\s*\+\s*2\s*\+\s*4\s*s|1s\s*\+\s*2s\s*\+\s*4s|1, 2, 4 seconds/);
  });

  test("step 4 prose names the three-attempt count", () => {
    const step4 = extractStep4(read(specWriteSkill));
    expect(step4).toMatch(/three attempts|3 attempts/i);
  });

  test("step 4 prose names the JQL idempotency probe + Gateway-Timeout trigger", () => {
    const step4 = extractStep4(read(specWriteSkill));
    expect(step4).toMatch(/JQL/i);
    expect(step4).toMatch(/Gateway-Timeout|gateway timeout|network[- ]?error/i);
  });

  test("step 4 prose preserves the single-shot probe as the fast path", () => {
    const step4 = extractStep4(read(specWriteSkill));
    expect(step4).toMatch(/single-shot|fast path/i);
  });

  test("step 4 prose names the still-ambiguous fallback path (capability key)", () => {
    const step4 = extractStep4(read(specWriteSkill));
    expect(step4).toMatch(/tracker_idempotency_uncertain/);
  });
});

describe("STE-157 AC-STE-157.3 — Step 7 plain-language map carries tracker_idempotency_uncertain", () => {
  test("the map contains the canonical key", () => {
    const map = specWriteStep7Map(read(specWriteSkill));
    expect(map).toMatch(/\| `tracker_idempotency_uncertain` \|/);
  });

  test("the rendered prose names the failure mode (idempotency probe still ambiguous)", () => {
    const map = specWriteStep7Map(read(specWriteSkill));
    // Pin both the operator-actionable signal ("manually verify") and the
    // shape ("warning row") so the prose can't drift back to the toolkit's
    // internal AC ID.
    expect(map).toMatch(/idempotency.+ambiguous|backoff probe|duplicate.+possible/i);
    expect(map).toMatch(/manually verify|operator/i);
  });
});

describe("STE-157 AC-STE-157.4 — adapter docs document the backoff contract", () => {
  test("adapters/jira.md upsert_ticket_metadata row names the 1+2+4s schedule", () => {
    const body = read(jiraAdapter);
    // The op-detail section is the body anchor — the table row is the surface.
    const opSection = body.slice(body.indexOf("### `upsert_ticket_metadata"));
    expect(opSection).toMatch(/1\s*\+\s*2\s*\+\s*4\s*s|1s\s*\+\s*2s\s*\+\s*4s/);
    expect(opSection).toMatch(/JQL/i);
    expect(opSection).toMatch(/three attempts|3 attempts/i);
  });

  test("adapters/jira.md names the still-ambiguous fallback (warning row)", () => {
    const body = read(jiraAdapter);
    const opSection = body.slice(body.indexOf("### `upsert_ticket_metadata"));
    expect(opSection).toMatch(/tracker_idempotency_uncertain/);
  });

  test("adapters/linear.md carries a symmetric note for Linear's Gateway-Timeout failure mode", () => {
    const body = read(linearAdapter);
    const opSection = body.slice(body.indexOf("### `upsert_ticket_metadata"));
    // Symmetric note: Linear's save_issue has the same Gateway-Timeout class
    // of failure mode, even though smoke #6 surfaced the defect on Jira only.
    expect(opSection).toMatch(/Gateway-Timeout|gateway timeout/i);
    expect(opSection).toMatch(/backoff|retry/i);
  });
});
