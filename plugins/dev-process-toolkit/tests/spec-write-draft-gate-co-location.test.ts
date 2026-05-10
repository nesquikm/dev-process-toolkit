import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// STE-220 — make Auto-mode / -p draft-gate default-apply actually fire at
// runtime. STE-213 (M55) added the Auto-mode carve-out paragraph in § 4
// only; the actual gate fires from the LLM's reading of § 0b step 4
// (Provider.sync), reaching § 4 too late in the read order. STE-220
// co-locates the carve-out at every gate site (§ 0b step 4, § 4, § 7a).
//
// **STE-262 supersession (M69, AC-STE-262.4 + AC-STE-262.7).** The
// original STE-220 detection contract — "the literal `Auto Mode Active`
// system-reminder token and `claude -p` invocation flag at every gate
// site" — is REPLACED by STE-262's runtime-byte-grep helper
// (`check_marker_runtime.ts`). The phrase `Auto Mode` is now a FORBIDDEN
// alternate-trigger phrase per AC-STE-262.4 (the byte-grep approach
// closes the LLM-inference path STE-220's prose-only detection couldn't).
// The tests below are updated to validate STE-262's superseding
// contract: the marker-detection block + `check_marker_runtime.ts` +
// canonical contract sentence at each gate site, plus the capability-row
// invariants that have been stable across STE-213 → STE-220 → STE-226
// → STE-262.
//
// These tests still catch the silent-runtime-regression class — the new
// gate decision is the script's stdout, not LLM context inference, so
// per-site presence of the marker-detection invocation is the load-
// bearing signal.

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

describe("AC-STE-220.1 — carve-out co-located at every gate site (STE-262 supersession)", () => {
  test("§ 0b step 4 (Provider.sync) carries the marker-detection block + capability row", () => {
    // Step 4 begins with "4. **Draft acceptance gate" and runs until step 5
    // ("5. **Post-write self-checks**"). The marker-detection block (STE-262
    // AC-STE-262.2 superseding the STE-220 prose-only carve-out) MUST appear
    // *within* step 4 so the LLM reading the step encounters the runtime
    // gate decision before executing the create — STE-213 left this site
    // without a carve-out, STE-220 added prose-only detection, STE-262
    // replaces both with the runtime byte-grep helper invocation.
    const body = read();
    const step4 = sectionSlice(
      body,
      /^4\. \*\*Draft acceptance gate/m,
      /^5\. \*\*Post-write self-checks/m,
    );
    expect(step4).toMatch(/draft[\s-]?(?:gate|acceptance)/i);
    expect(step4).toMatch(/Marker-detection/);
    expect(step4).toContain("check_marker_runtime.ts");
    expect(step4).toMatch(/spec_write_draft_default_applied/);
  });

  test("§ 4 (Review and confirm) carries the capability-key references", () => {
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
    // STE-262 supersession: the canonical contract anchor "marker is the
    // single deterministic mechanism" already appears here per legacy
    // STE-226 prose; that anchor is also a /gate-check carve-out signature.
    expect(sec4).toMatch(/single deterministic mechanism/);
  });

  test("§ 7a (commit gate) carries the marker-detection block + capability row", () => {
    const body = read();
    const sec7a = sectionSlice(
      body,
      /^### 7a\./m,
      /^### 7\. Report/m,
    );
    expect(sec7a).toMatch(/spec_write_commit_default_applied/);
    expect(sec7a).toMatch(/Marker-detection/);
    expect(sec7a).toContain("check_marker_runtime.ts");
  });
});

describe("AC-STE-220.2 — explicit detection contract at every gate site (STE-262 supersession)", () => {
  test("the runtime byte-grep helper is invoked at all three gate sites worth of fire-points", () => {
    // STE-262 AC-STE-262.2 supersession: the legacy `Auto Mode Active`
    // system-reminder token byte-check is REMOVED — that phrase is now a
    // forbidden alternate-trigger paraphrase per AC-STE-262.4 (a positive-
    // form mention would itself trigger the new probe). The replacement
    // load-bearing signal is the runtime-byte-grep helper invocation. It
    // appears at the two actual gate-fire sites: § 0b step 4 (draft gate)
    // and § 7a (commit gate). § 4 (Review and confirm) is the cross-
    // reference summary site and delegates to those two — it carries the
    // canonical contract anchor `single deterministic mechanism` instead.
    const body = read();
    const matches = body.match(/check_marker_runtime\.ts/g) ?? [];
    // At least 2 fire-site occurrences (§ 0b step 4 + § 7a). Counting
    // `>= 2` allows future additions (e.g., doc cross-references) without
    // breaking the test, but tightly catches a regression where a fire site
    // loses the helper invocation.
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  test("the canonical contract sentence pairs runtime-byte-grep + non-inference at every fire site", () => {
    // STE-262 AC-STE-262.2: the byte-checkable contract sentence
    // "the script's output is the single deterministic gate decision; no
    // LLM inference, no autonomous-mode reminder, no 'work without stopping'
    // framing influences the auto-apply branch" must appear at each gate
    // fire site (§ 0b step 4, § 7a). The pairing of the canonical anchor
    // (`single deterministic gate decision`) with the no-inference clause
    // is the load-bearing signal — paragraph proximity proves paste-not-
    // paraphrase across sites.
    const body = read();
    const pairings =
      body.match(
        /single deterministic gate decision[\s\S]{0,200}no LLM inference|no LLM inference[\s\S]{0,200}single deterministic gate decision/g,
      ) ?? [];
    expect(pairings.length).toBeGreaterThanOrEqual(2);
  });

  test("each gate fire site's marker-detection block carries the canonical contract sentence", () => {
    // Per-site assertion: each of the 2 gate fire sites must individually
    // carry the canonical contract anchor + helper invocation. A weaker
    // test could pass by stuffing 2 instances into one site; this stricter
    // test catches that. § 4 is the cross-reference summary and delegates
    // to the fire sites — it does NOT need the full block, only the
    // canonical anchor.
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
    expect(step4).toContain("single deterministic gate decision");
    expect(step4).toContain("check_marker_runtime.ts");
    expect(sec7a).toContain("single deterministic gate decision");
    expect(sec7a).toContain("check_marker_runtime.ts");
    // § 4 carries the canonical anchor (legacy STE-226 prose) but delegates
    // helper invocation to the fire sites.
    expect(sec4).toMatch(/single deterministic mechanism/);
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
