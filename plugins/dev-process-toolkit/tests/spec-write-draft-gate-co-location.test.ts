import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// STE-220 — make Auto-mode / -p draft-gate default-apply actually fire at
// runtime. STE-213 (M55) added the Auto-mode carve-out paragraph in § 4
// only; the actual gate fires from the LLM's reading of § 0b step 4
// (Provider.sync), reaching § 4 too late in the read order. STE-220
// co-locates the carve-out at every gate site (§ 0b step 4, § 4, § 7a)
// AND adds an explicit detection contract that names how the LLM detects
// Auto mode / -p (the literal `Auto Mode Active` system-reminder token
// and `claude -p` invocation flag) — paste-not-paraphrase across sites.
//
// These tests would have failed against M55's STE-213 ship and pass after
// STE-220's edits, catching the silent-runtime-regression that v2.8.0
// shipped behind a green checkmark.

const pluginRoot = join(import.meta.dir, "..");
const skillPath = join(pluginRoot, "skills", "spec-write", "SKILL.md");

function read(): string {
  return readFileSync(skillPath, "utf8");
}

// Slice a section of the SKILL.md from a heading-line regex through (but not
// including) the next heading-line regex. Both regexes match anchored to
// line-start (the `m` flag). Asserts the start regex matches.
function sectionSlice(
  body: string,
  startRe: RegExp,
  endRe: RegExp,
): string {
  const m = body.match(startRe);
  if (m === null) {
    throw new Error(
      `sectionSlice: start regex did not match: ${startRe} (body length ${body.length})`,
    );
  }
  const tail = body.slice(m.index!);
  const endRel = tail.search(endRe);
  return endRel === -1 ? tail : tail.slice(0, endRel);
}

describe("AC-STE-220.1 — carve-out co-located at every gate site", () => {
  test("§ 0b step 4 (Provider.sync) carries the Auto-mode default-apply carve-out", () => {
    // Step 4 begins with "4. Call `Provider.sync(spec)`" and runs until step
    // 5 ("5. **Post-write self-checks.**"). The carve-out must appear *within*
    // step 4 so the LLM reading the step encounters the rule before executing
    // the create — STE-213 left this site without a carve-out, which is why
    // v2.8.0's `claude -p` runs hung at the draft gate.
    const body = read();
    const step4 = sectionSlice(
      body,
      /^4\. \*\*Draft acceptance gate/m,
      /^5\. \*\*Post-write self-checks/m,
    );
    expect(step4).toMatch(/draft[\s-]?(?:gate|acceptance)/i);
    expect(step4).toMatch(/Auto mode/i);
    expect(step4).toMatch(/default[-\s]?appl(?:y|ies|ied)/i);
    expect(step4).toMatch(/spec_write_draft_default_applied/);
  });

  test("§ 4 (Review and confirm) carries the carve-out reference", () => {
    const body = read();
    const sec4 = sectionSlice(
      body,
      /^### 4\. Review and confirm/m,
      /^### 5\. Cross-check/m,
    );
    // § 4 may delegate detail to § 0b step 4 / § 7a, but it MUST mention both
    // capability keys so a reader landing here sees both auto-apply contracts.
    expect(sec4).toMatch(/spec_write_draft_default_applied/);
    expect(sec4).toMatch(/spec_write_commit_default_applied/);
    expect(sec4).toMatch(/Auto mode/i);
  });

  test("§ 7a (commit gate) carries the carve-out", () => {
    const body = read();
    const sec7a = sectionSlice(
      body,
      /^### 7a\./m,
      /^### 7\. Report/m,
    );
    expect(sec7a).toMatch(/spec_write_commit_default_applied/);
    expect(sec7a).toMatch(/Auto mode/i);
  });
});

describe("AC-STE-220.2 — explicit detection contract at every gate site", () => {
  test("the system-reminder token 'Auto Mode Active' appears at all three gate sites", () => {
    // The token `Auto Mode Active` is the literal string the harness emits
    // inside <system-reminder> blocks on every Auto-mode invocation. Naming
    // the token explicitly tells the LLM what signal to look for at gate
    // time — STE-213 left this implicit, so the LLM had no reliable way to
    // know "Auto mode" from the gate prose alone.
    const body = read();
    const matches = body.match(/Auto Mode Active/g) ?? [];
    // At least 3 occurrences — one per gate site (§ 0b step 4, § 4, § 7a).
    // Counting `>= 3` rather than `=== 3` allows future additions (e.g., a
    // doc cross-reference) without breaking the test, but tightly catches
    // a regression where one site loses the token.
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });

  test("the detection contract names both signals (Auto Mode Active + claude -p) close together", () => {
    const body = read();
    // The canonical detection sentence pairs both signals so the LLM
    // doesn't have to infer the disjunction. Paragraph proximity is the
    // load-bearing signal: same sentence = paste, separate paragraphs =
    // paraphrase. We require at least 3 sentences pairing the two tokens
    // within 200 characters of each other.
    const pairings = body.match(/Auto Mode Active[\s\S]{0,200}claude -p|claude -p[\s\S]{0,200}Auto Mode Active/g) ?? [];
    expect(pairings.length).toBeGreaterThanOrEqual(3);
  });

  test("each gate site's detection sentence carries both signals", () => {
    // Per-site assertion: each of the 3 gate sites must individually carry
    // the detection-contract pairing. A weaker test could pass by stuffing
    // 3 pairings into one site; this stricter test catches that.
    const body = read();
    const step4 = sectionSlice(
      body,
      /^4\. \*\*Draft acceptance gate/m,
      /^5\. \*\*Post-write self-checks/m,
    );
    const sec7a = sectionSlice(
      body,
      /^### 7a\./m,
      /^### 7\. Report/m,
    );
    const sec4 = sectionSlice(
      body,
      /^### 4\. Review and confirm/m,
      /^### 5\. Cross-check/m,
    );
    // § 0b step 4 and § 7a are the actual fire sites — strict pairing required.
    expect(step4).toMatch(/Auto Mode Active[\s\S]{0,200}claude -p|claude -p[\s\S]{0,200}Auto Mode Active/);
    expect(sec7a).toMatch(/Auto Mode Active[\s\S]{0,200}claude -p|claude -p[\s\S]{0,200}Auto Mode Active/);
    // § 4 may delegate to those sites, but still must reference at least one
    // signal for the reader landing there.
    expect(sec4).toMatch(/Auto mode|Auto Mode Active|claude -p/i);
  });
});

describe("AC-STE-220.5 — smoke-driver pre-authorization workaround NOT in the heredoc body", () => {
  test("smoke-test SKILL.md /spec-write heredoc body does not pre-authorize the draft gate", () => {
    // The smoke driver lives at .claude/skills/smoke-test/ (toolkit-internal,
    // not part of the plugin distribution). The /spec-write heredoc body
    // must NOT carry a draft-gate pre-authorization line — the carve-out
    // fires from spec-write SKILL.md alone.
    const skillPath = join(pluginRoot, "..", "..", ".claude", "skills", "smoke-test", "SKILL.md");
    let smoke: string;
    try {
      smoke = readFileSync(skillPath, "utf8");
    } catch {
      // Smoke-test SKILL.md is toolkit-internal; if not present, skip
      // (the test is informational on the dev tree, mandatory in the smoke harness).
      return;
    }
    // The /spec-write heredoc body lives between `# /spec-write` and the
    // closing `PROMPT_EOF`. We assert it does NOT carry pre-auth tokens.
    const specWriteHeredoc = smoke.match(/# \/spec-write[\s\S]*?PROMPT_EOF[\s\S]*?PROMPT_EOF/);
    expect(specWriteHeredoc).not.toBeNull();
    const body = specWriteHeredoc![0];
    expect(body).not.toMatch(/Pre-authorized.*draft/i);
    expect(body).not.toMatch(/Default-apply.*draft.*acceptance/i);
    expect(body).not.toMatch(/Skip the.*Approve and proceed/i);
  });
});
