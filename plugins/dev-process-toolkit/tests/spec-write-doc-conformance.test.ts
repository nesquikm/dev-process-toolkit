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

// STE-227 — `--no-tech` flag and auto-resume detection.
//
// Doc-conformance assertions: the --no-tech flag must be documented at three
// surface sites (argument-hint, § 0b, § 3 — the spec-write process sections),
// the auto-resume contract for resolved FRs carrying needs_technical_review:
// true must be documented at § 0a, AC.3 tracker-mode label-push behavior
// (capability-key surface) must be documented, and the four AC.8 capability
// keys must appear in the static map. These are LLM-facing instructions the
// skill prose must carry, not behavioral runtime assertions.

describe("AC-STE-227.1 — /spec-write --no-tech runs requirement + AC interview only", () => {
  test("SKILL.md documents the --no-tech flag at the argument-hint", () => {
    const body = read();
    // The argument-hint frontmatter line must mention --no-tech so users
    // see the flag in the slash-command UI tab-completion.
    const hintMatch = body.match(/^argument-hint:\s*['"](.+?)['"]/m);
    expect(hintMatch).not.toBeNull();
    expect(hintMatch![1]).toContain("--no-tech");
  });

  test("SKILL.md documents the --no-tech flag at § 0b (FR creation path)", () => {
    const body = read();
    const sec0bIdx = body.indexOf("### 0b. FR creation path");
    expect(sec0bIdx).toBeGreaterThan(-1);
    const sec1Idx = body.indexOf("### 1. Assess current state");
    expect(sec1Idx).toBeGreaterThan(sec0bIdx);
    const slice = body.slice(sec0bIdx, sec1Idx);
    expect(slice).toContain("--no-tech");
  });

  test("SKILL.md documents the --no-tech flag at § 3 (per-spec-file flow)", () => {
    const body = read();
    const sec3Idx = body.indexOf("### 3. For each spec file");
    expect(sec3Idx).toBeGreaterThan(-1);
    const sec4Idx = body.indexOf("### 4. Review and confirm");
    expect(sec4Idx).toBeGreaterThan(sec3Idx);
    const slice = body.slice(sec3Idx, sec4Idx);
    expect(slice).toContain("--no-tech");
  });

  test("SKILL.md documents the canonical placeholder line for skipped sections", () => {
    const body = read();
    // The placeholder `[needs technical review — run /spec-write <FR-id> to complete]`
    // must appear in the prose so the LLM knows what to write into the
    // skipped Technical Design / Testing sections.
    expect(body).toMatch(/needs technical review.*run\s+\/spec-write\s+<FR-id>\s+to\s+complete/i);
  });

  test("SKILL.md documents that the technical + testing interview is skipped under --no-tech", () => {
    const body = read();
    // Acceptance: prose must explicitly state the skip behavior so the LLM
    // doesn't ask the technical interview questions on a --no-tech run.
    expect(body).toMatch(/--no-tech[\s\S]{0,500}(skip|skipped)/i);
  });
});

describe("AC-STE-227.5 — /spec-write <FR-id> auto-resume on needs_technical_review:true", () => {
  test("SKILL.md documents auto-detection of needs_technical_review at § 0a resolver entry", () => {
    const body = read();
    const sec0aIdx = body.indexOf("### 0a. Resolver entry");
    expect(sec0aIdx).toBeGreaterThan(-1);
    const sec0bIdx = body.indexOf("### 0b. FR creation path");
    expect(sec0bIdx).toBeGreaterThan(sec0aIdx);
    const slice = body.slice(sec0aIdx, sec0bIdx);
    // The resolver entry section MUST mention the auto-resume detection.
    expect(slice).toMatch(/needs_technical_review/);
  });

  test("SKILL.md documents the auto-resume flow (skip requirement+AC interview, run technical+testing)", () => {
    const body = read();
    // Prose must describe: when flag detected on resolved FR, skip the
    // already-filled requirement + AC interview, run only the technical
    // design + testing-spec interview.
    expect(body).toMatch(
      /needs_technical_review[\s\S]{0,2000}(skip|already\s+filled)[\s\S]{0,500}(technical|testing)/i,
    );
  });

  test("SKILL.md documents that the flag is removed from frontmatter on save", () => {
    const body = read();
    // Per AC.5, on save the flag is removed entirely (consistent with
    // absent ≡ false). Prose must instruct the LLM to clear the field.
    expect(body).toMatch(
      /needs_technical_review[\s\S]{0,1500}(remove|cleared|drop)/i,
    );
  });

  test("SKILL.md documents that the needs-technical-review label is removed from the tracker", () => {
    const body = read();
    // Per AC.5, the tracker label is removed on the same Provider.sync call.
    expect(body).toMatch(/needs-technical-review[\s\S]{0,500}(label[\s\S]{0,200})?(remove|drop)/i);
  });
});

describe("AC-STE-227.3 — Provider.sync still fires under --no-tech, label appended", () => {
  test("SKILL.md documents that Provider.sync still runs on --no-tech", () => {
    const body = read();
    // The flag must NOT short-circuit Provider.sync — the FR still lands
    // on the tracker, just with the label.
    expect(body).toMatch(/--no-tech[\s\S]{0,2500}Provider\.sync/);
  });

  test("SKILL.md documents the needs-technical-review label appended to defaultLabels", () => {
    const body = read();
    expect(body).toContain("needs-technical-review");
    // Prose must describe: appended to defaultLabels (when populated) or
    // seeded as a single-element array.
    expect(body).toMatch(
      /needs-technical-review[\s\S]{0,800}(defaultLabels|labels)/i,
    );
  });
});

describe("AC-STE-227.8 — capability-map additions", () => {
  test("static map carries fr_needs_technical_review row", () => {
    const body = read();
    expect(body).toContain("fr_needs_technical_review");
    // Rendered prose must mention the placeholder remediation.
    expect(body).toMatch(
      /fr_needs_technical_review[\s\S]{0,400}(placeholder|technical|testing)/i,
    );
  });

  test("static map carries fr_technical_review_cleared row", () => {
    const body = read();
    expect(body).toContain("fr_technical_review_cleared");
    expect(body).toMatch(
      /fr_technical_review_cleared[\s\S]{0,400}(cleared|completed)/i,
    );
  });

  test("static map carries needs_technical_review_label_unsupported row", () => {
    const body = read();
    expect(body).toContain("needs_technical_review_label_unsupported");
    expect(body).toMatch(
      /needs_technical_review_label_unsupported[\s\S]{0,400}(label|adapter)/i,
    );
  });

  test("static map carries implement_refused_needs_technical_review row", () => {
    const body = read();
    expect(body).toContain("implement_refused_needs_technical_review");
    expect(body).toMatch(
      /implement_refused_needs_technical_review[\s\S]{0,400}(refused|flagged)/i,
    );
  });
});
