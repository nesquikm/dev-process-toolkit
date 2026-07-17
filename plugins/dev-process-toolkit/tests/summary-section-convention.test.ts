// STE-385 — FR `## Summary` section: /spec-write authors a plain-language
// summary as the first FR body section.
//
// Convention meta-test in the STE-341 (design-references-convention) →
// STE-345 (token-stats-convention) lineage: readFileSync the shipped prose
// surface, pin the required phrasing. Plus the tracker-ride fixtures the FR's
// Testing table routes here (normalize round-trip + description render).
//
// AC map:
//   AC-STE-385.1 — /spec-write § 0b authoring directive (first-in-body
//                  placement, altitude rule, draft-gate preview mention).
//   AC-STE-385.2 — docs/layout-reference.md FR-section contract names
//                  `## Summary` as a third sanctioned optional section,
//                  first-in-body; sibling phrase-pins survive the edit.
//   AC-STE-385.3 — probe #40 remedy prose no longer claims a closed
//                  5-section FR shape; no shipped prose says "exactly five
//                  sections".
//   AC-STE-385.4 — Linear normalize path is byte-blind to a leading
//                  `## Summary`; the unchanged ticket_description_template
//                  renders a description that opens with the Summary.
//   AC-STE-385.5 — the lineage pin itself (directive + placement + altitude
//                  phrases; contract line optional/first-in-body).
//   AC-STE-385.6 — calibration rides: the two SKILL line-cap pin sites agree
//                  and spec-write fits under the shared cap with the new
//                  prose landed; skills STE-token ceiling stays 246.

import { describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalize } from "../adapters/linear/src/normalize";
import { runNeedsTechnicalReviewConsistencyProbe } from "../adapters/_shared/src/needs_technical_review_consistency";

const pluginRoot = join(import.meta.dir, "..");

const specWritePath = join(pluginRoot, "skills", "spec-write", "SKILL.md");
const layoutPath = join(pluginRoot, "docs", "layout-reference.md");
const linearAdapterDocPath = join(pluginRoot, "adapters", "linear.md");
const nfrLengthTestPath = join(pluginRoot, "tests", "skill-nfr-1-length.test.ts");
const m104DuplicatePinPath = join(
  pluginRoot,
  "tests",
  "m104-ste-383-dpt-gitignore.test.ts",
);
const shippedProseTestPath = join(
  pluginRoot,
  "tests",
  "shipped-prose-no-internal-namespace.test.ts",
);

function read(path: string): string {
  return readFileSync(path, "utf8");
}

/**
 * Slice § 0b (FR creation path) out of /spec-write SKILL.md so the authoring
 * pins are scoped to the body-section contract, not the whole file — same
 * helper shape as design-references-convention.test.ts (STE-341 lineage).
 */
function specWriteSection0b(body: string): string {
  const start = body.indexOf("### 0b. FR creation path");
  const end = body.indexOf("### 1. Assess current state");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return body.slice(start, end);
}

/** All fixed-radius windows around each occurrence of `needle`. */
function windowsAround(
  haystack: string,
  needle: string,
  radius: number,
): string[] {
  const out: string[] = [];
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    out.push(
      haystack.slice(Math.max(0, idx - radius), idx + needle.length + radius),
    );
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return out;
}

// ---------------------------------------------------------------------------
// AC-STE-385.1 — /spec-write § 0b authoring directive
// ---------------------------------------------------------------------------

describe("AC-STE-385.1 — /spec-write § 0b authors ## Summary as the first body section", () => {
  test("authoring directive: ## Summary named first-in-body (after the H1, before ## Requirement)", () => {
    const sec0b = specWriteSection0b(read(specWritePath));

    // The section is named in the creation path at all.
    expect(sec0b).toContain("## Summary");

    // Placement phrase co-located with the section name: first body section.
    const wins = windowsAround(sec0b, "## Summary", 500);
    expect(
      wins.some((w) => /first[\s\S]{0,40}body section/i.test(w)),
      "§ 0b should state ## Summary is the first body section",
    ).toBe(true);

    // Both placement anchors from the AC: after the H1, before ## Requirement.
    expect(sec0b).toMatch(/after the H1/i);
    expect(sec0b).toMatch(/before\s+`?## Requirement`?/);
  });

  test("altitude rule: 3–6 non-empty lines of plain prose, zero backticks, no AC-ID tokens, no path-like tokens", () => {
    const sec0b = specWriteSection0b(read(specWritePath));

    // 3–6 non-empty lines (en-dash, em-dash, or hyphen all acceptable).
    expect(sec0b).toMatch(/3\s*[–—-]\s*6\s*non-empty lines/i);
    // Plain prose / plain-language register.
    expect(sec0b).toMatch(/plain[\s-](?:prose|language)/i);
    // Zero backtick characters.
    expect(sec0b).toMatch(/(?:zero|no) backticks?/i);
    // No AC-ID tokens.
    expect(sec0b).toMatch(/AC-ID tokens?/i);
    // No path-like tokens (slash + dot-extension in one token).
    expect(sec0b).toMatch(/path-like tokens?/i);
    expect(sec0b).toMatch(/dot-extension/i);
  });

  test("the § 0b step 4 draft-gate preview includes the Summary", () => {
    const sec0b = specWriteSection0b(read(specWritePath));

    // Co-location: some Summary mention sits in a draft-gate / preview
    // neighborhood (tolerant to whether the sentence lives in the step-2
    // directive or in step 4 itself).
    const wins = windowsAround(sec0b, "Summary", 500);
    expect(wins.length).toBeGreaterThan(0);
    expect(
      wins.some((w) => /preview|draft/i.test(w)),
      "§ 0b should state the draft-gate preview includes the Summary",
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-385.2 — layout-reference FR-section contract amendment
// ---------------------------------------------------------------------------

describe("AC-STE-385.2 — FR-section contract names ## Summary as a third optional section, first-in-body", () => {
  test("contract region names ## Summary as optional with first-in-body placement", () => {
    const layout = read(layoutPath);

    const contractIdx = layout.indexOf("required top-level sections");
    expect(contractIdx).toBeGreaterThan(-1);
    // Same 2000-char contract window the token-stats convention test greps —
    // editing inside it keeps that sibling pin green.
    const contract = layout.slice(contractIdx, contractIdx + 2000);

    expect(contract).toContain("## Summary");
    const wins = windowsAround(contract, "## Summary", 300);
    expect(
      wins.some((w) => /optional/i.test(w)),
      "## Summary must be sanctioned as optional in the contract",
    ).toBe(true);
    expect(
      wins.some((w) => /first/i.test(w)),
      "## Summary placement must be stated as first-in-body",
    ).toBe(true);
  });

  test("the closed two-member optional-set claim is retired", () => {
    const layout = read(layoutPath);
    // With ## Summary sanctioned as a THIRD optional section, the old
    // closed-set sentence is stale and must not survive verbatim.
    expect(layout).not.toContain("These two are the only optional sections");
  });

  test("sibling phrase-pins survive the edit (design-references + token-stats windows)", () => {
    const layout = read(layoutPath);

    // design-references-convention.test.ts pins.
    expect(layout).toContain("required top-level sections");
    expect(layout).toMatch(
      /optional(?:ly)?[\s\S]{0,140}Design References|Design References[\s\S]{0,140}optional(?:ly)?/i,
    );

    // token-stats-convention.test.ts pin: ## Token Stats stays inside the
    // 2000-char window after the contract phrase.
    const contractIdx = layout.indexOf("required top-level sections");
    const contract = layout.slice(contractIdx, contractIdx + 2000);
    expect(contract).toContain("## Token Stats");
    expect(contract).toMatch(/optional/i);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-385.3 — stale-wording sweep
// ---------------------------------------------------------------------------

describe("AC-STE-385.3 — no shipped prose claims a closed 5-section FR shape", () => {
  test("probe #40 missing_section remedy names Summary as optional or drops the enumeration", async () => {
    // Trigger a real missing_section violation and inspect the remedy the
    // operator actually sees (message text only — never a failure condition).
    const root = mkdtempSync(join(tmpdir(), "ste385-remedy-"));
    try {
      mkdirSync(join(root, "specs", "frs"), { recursive: true });
      const fr = [
        "---",
        "title: t",
        "milestone: M105",
        "status: active",
        "archived_at: null",
        "tracker:",
        "  linear: STE-901",
        "needs_technical_review: true",
        "created_at: 2026-07-16T09:00:00Z",
        "---",
        "",
        "# STE-901: title",
        "",
        "## Requirement",
        "",
        "Real prose.",
        "",
        "## Acceptance Criteria",
        "",
        "- AC-STE-901.1: foo",
        "",
        "## Testing",
        "",
        "[needs technical review — run /spec-write STE-901 to complete]",
        "",
        "## Notes",
        "",
        "Notes.",
        "",
      ].join("\n");
      writeFileSync(join(root, "specs", "frs", "STE-901.md"), fr);

      const r = await runNeedsTechnicalReviewConsistencyProbe(root);
      expect(r.violations.length).toBeGreaterThan(0);
      const v = r.violations.find((x) => /missing_section/.test(x.note ?? ""));
      expect(v).toBeDefined();

      // AC disjunction: the remedy either drops the 5-section enumeration
      // entirely, or keeps it while naming ## Summary as optional.
      const remedyOk =
        !/5-section/.test(v!.message) ||
        (/Summary/.test(v!.message) && /optional/i.test(v!.message));
      expect(
        remedyOk,
        "probe #40 remedy still claims a closed 5-section FR shape without naming Summary as optional",
      ).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("no other shipped prose asserts 'exactly five sections'", () => {
    const offenders: string[] = [];
    const pattern = /exactly (?:five|5)[\s-]sections?/i;
    const roots = ["skills", "docs", "adapters", "templates", "examples"];
    const walk = (d: string) => {
      for (const name of readdirSync(d)) {
        if (name === "node_modules" || name === "dist") continue;
        const p = join(d, name);
        if (statSync(p).isDirectory()) {
          walk(p);
          continue;
        }
        if (!/\.(md|ts)$/.test(name)) continue;
        if (pattern.test(readFileSync(p, "utf8"))) offenders.push(p);
      }
    };
    for (const r of roots) walk(join(pluginRoot, r));
    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-385.4 — tracker ride: normalize blindness + description render
// ---------------------------------------------------------------------------

const SUMMARY_SECTION = [
  "## Summary",
  "",
  "A plain-language recap of what this change does and why it matters.",
  "It touches the authoring flow and the review contract only.",
  "Nothing about how the gates verify specs changes.",
  "",
].join("\n");

function sampleFrBody(withSummary: boolean): string {
  return [
    "# STE-999: Sample FR title {#STE-999}",
    "",
    ...(withSummary ? [SUMMARY_SECTION] : []),
    "## Requirement",
    "",
    "Real requirement prose.",
    "",
    "## Acceptance Criteria",
    "",
    "- [ ] AC-STE-999.1: first binary criterion",
    "- [x] AC-STE-999.2: second binary criterion",
    "",
    "## Technical Design",
    "",
    "Design prose.",
    "",
    "## Testing",
    "",
    "Testing prose.",
    "",
    "## Notes",
    "",
    "A trailing note.",
    "",
  ].join("\n");
}

/** Extract the YAML block-scalar `ticket_description_template` from an adapter doc. */
function extractDescriptionTemplate(adapterDoc: string): string {
  const lines = adapterDoc.split("\n");
  const start = lines.findIndex((l) =>
    /^ticket_description_template:\s*\|\s*$/.test(l),
  );
  expect(start).toBeGreaterThan(-1);
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i]!;
    if (l === "") {
      out.push("");
      continue;
    }
    if (/^ {2}/.test(l)) {
      out.push(l.slice(2));
      continue;
    }
    break;
  }
  // Trim trailing blank lines the loop may have swallowed before the next key.
  while (out.length && out[out.length - 1] === "") out.pop();
  return out.join("\n");
}

describe("AC-STE-385.4 — tracker ride verified with zero adapter changes", () => {
  test("(a) normalize returns byte-identical canonical AC blocks with and without a leading ## Summary", () => {
    const withSummary = normalize(sampleFrBody(true));
    const withoutSummary = normalize(sampleFrBody(false));

    // Byte identity: the AC-sync path is structurally blind to the section.
    expect(withSummary).toBe(withoutSummary);

    // And the shared canonical block is the real AC block, not empty output.
    const expected =
      "## Acceptance Criteria\n" +
      "- [ ] AC-STE-999.1: first binary criterion\n" +
      "- [x] AC-STE-999.2: second binary criterion\n";
    expect(withSummary).toBe(expected);
    expect(withSummary).not.toContain("Summary");
  });

  test("(b) rendered ticket description under the unchanged template opens with the Summary section", () => {
    const template = extractDescriptionTemplate(read(linearAdapterDocPath));

    // Unchanged-template pin: {fr_body} leads the description verbatim.
    expect(template.trimStart().startsWith("{fr_body}")).toBe(true);

    const body = sampleFrBody(true);
    const rendered = template
      .replaceAll("{fr_body}", body)
      .replaceAll("{tracker_id}", "STE-999");

    // The description opens with the FR body, whose first H2 is ## Summary.
    expect(rendered.startsWith("# STE-999:")).toBe(true);
    const firstH2 = rendered
      .split("\n")
      .find((l) => l.startsWith("## "));
    expect(firstH2).toBe("## Summary");
    expect(rendered.indexOf("## Summary")).toBeLessThan(
      rendered.indexOf("## Requirement"),
    );
    // The template's trailing source line still renders.
    expect(rendered).toContain("Source: specs/frs/STE-999.md");
  });
});

// ---------------------------------------------------------------------------
// AC-STE-385.5 — the lineage convention pin
// ---------------------------------------------------------------------------

describe("AC-STE-385.5 — convention pin (STE-341 → STE-345 lineage)", () => {
  test("(a) /spec-write authoring directive, placement phrase, and altitude phrases are pinned", () => {
    const sec0b = specWriteSection0b(read(specWritePath));
    expect(sec0b).toContain("## Summary");
    expect(sec0b).toMatch(/first[\s\S]{0,40}body section/i);
    expect(sec0b).toMatch(/3\s*[–—-]\s*6\s*non-empty lines/i);
    expect(sec0b).toMatch(/backtick/i);
    expect(sec0b).toMatch(/AC-ID/);
    expect(sec0b).toMatch(/path-like/i);
  });

  test("(b) layout-reference contract names ## Summary optional / first-in-body", () => {
    const layout = read(layoutPath);
    const contractIdx = layout.indexOf("required top-level sections");
    expect(contractIdx).toBeGreaterThan(-1);
    const contract = layout.slice(contractIdx, contractIdx + 2000);
    expect(contract).toContain("## Summary");
    const wins = windowsAround(contract, "## Summary", 300);
    expect(wins.some((w) => /optional/i.test(w) && /first/i.test(w))).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// AC-STE-385.6 — calibration rides this FR
// ---------------------------------------------------------------------------

describe("AC-STE-385.6 — line-cap pin sites agree and the STE-token ceiling holds", () => {
  test("both SKILL line-cap pin sites carry the same value and spec-write (with the Summary directive) fits under it", () => {
    // Pin site 1: the NFR-1 loop test.
    const nfrSrc = read(nfrLengthTestPath);
    const capMatch = /const SKILL_LINE_CAP = (\d+);/.exec(nfrSrc);
    expect(capMatch).not.toBeNull();
    const cap = Number(capMatch![1]);

    // Pin site 2: the M104 duplicate pin (title number + assertion literal).
    const m104Src = read(m104DuplicatePinPath);
    const dupMatch = /NFR-1 line cap \((\d+)\)/.exec(m104Src);
    expect(dupMatch).not.toBeNull();
    expect(Number(dupMatch![1])).toBe(cap);
    expect(m104Src).toContain(`toBeLessThanOrEqual(${cap})`);

    // The calibration must ride WITH the new prose: spec-write carries the
    // Summary directive AND still fits under the shared cap (it sat at
    // 354/354 split-counted before this FR — any net growth forces the bump
    // at both pin sites above).
    const specWrite = read(specWritePath);
    expect(specWriteSection0b(specWrite)).toContain("## Summary");
    expect(specWrite.split("\n").length).toBeLessThanOrEqual(cap);
  });

  test("the skills STE-token ceiling stays pinned at 246", () => {
    // New skill prose must cite by mechanism, token-free — the ceiling is at
    // the pin with zero headroom and must not be loosened by this FR.
    const src = read(shippedProseTestPath);
    const m = /skills:\s*(\d+),/.exec(src);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(246);

    // The M104 duplicate ceiling pin stays at 246 too.
    expect(read(m104DuplicatePinPath)).toContain("toBeLessThanOrEqual(246)");
  });
});
