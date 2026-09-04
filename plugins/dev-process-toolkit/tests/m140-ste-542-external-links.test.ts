// M140 / STE-542 — classify, check, and record external links when they are
// authored.
//
// Three surfaces:
//   1. MODULE — `scanExternalReferences` (new sibling export of
//      `adapters/_shared/src/scan_design_references.ts`) emits URL rows as
//      their OWN row kind with no on-disk resolution, while
//      `scanDesignReferences` stays byte-identical; plus the
//      `formatExternalReferenceLine` → `scanExternalReferences` round-trip and
//      the `runExternalLinkChecks` / `recordExternalReferences` writer pair
//      from `adapters/_shared/src/check_external_link.ts`.
//   2. PROSE CONTRACT — `/spec-write` SKILL.md § 0b **step 6b** (sliced to
//      step 6b ALONE, because the whole § 0b slice already contains
//      `AskUserQuestion`, `required` and `informational` today and would pass
//      vacuously).
//   3. SHIPPED DOC — `docs/layout-reference.md`'s closed-set claim widened to
//      admit `## External References`, on the M105/STE-385 `## Summary`
//      precedent (`tests/summary-section-convention.test.ts:177`).
//
// Every absence assertion below ships with its positive control in the SAME
// test: an isolated "zero rows" / "byte-identical" / "not.toContain" is
// satisfied by a scanner that reads nothing, which is the documented failure
// mode for this FR.
//
// Fixture idiom: `makeTree(files, seed)` from
// `tests/gate-check-design-references-resolve.test.ts:44`.

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
import { dirname, join } from "node:path";
import {
  scanDesignReferences,
  scanExternalReferences,
} from "../adapters/_shared/src/scan_design_references";
import {
  formatExternalReferenceLine,
  recordExternalReferences,
  runExternalLinkChecks,
} from "../adapters/_shared/src/check_external_link";
import { CANONICAL_CAPABILITY_KEYS } from "../adapters/_shared/src/closing_summary_capability_keys";
import { specWriteStep7Map } from "./_skill-md";

const pluginRoot = join(import.meta.dir, "..");
const specWritePath = join(pluginRoot, "skills", "spec-write", "SKILL.md");
const layoutPath = join(pluginRoot, "docs", "layout-reference.md");
const skillsDir = join(pluginRoot, "skills");

const read = (p: string): string => readFileSync(p, "utf-8");

// ---------------------------------------------------------------------------
// Fixture helpers (copied idiom — see header)
// ---------------------------------------------------------------------------

function makeTree(
  files: Record<string, string>,
  seed: string[] = [],
): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "ste542-ext-refs-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  for (const rel of seed) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, "\x89PNG\r\n\x1a\n");
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/** 1-indexed line of the first line in `content` containing `needle`. */
function lineOf(content: string, needle: string): number {
  const idx = content.split("\n").findIndex((l) => l.includes(needle));
  expect(idx).toBeGreaterThan(-1);
  return idx + 1;
}

// ---------------------------------------------------------------------------
// AC-STE-542.5 — URL tokens stop being discarded; path rows are unchanged
// ---------------------------------------------------------------------------

describe("AC-STE-542.5 — URLs become their own row kind; path rows byte-identical", () => {
  test("one path row + one URL row in the SAME `## Design References` section: the path row is deep-equal to today's literal, the URL row is emitted separately", () => {
    const fr = [
      "# STE-542",
      "",
      "## Acceptance Criteria",
      "",
      "- AC-STE-542.5: urls are rows",
      "",
      "## Design References",
      "",
      "- `specs/design/frs/STE-542/mock.png` — Login mockup",
      "- `https://example.invalid/upstream-spec` — Upstream spec (checked 2026-09-04T10:00:00Z: reachable)",
      "",
      "## Notes",
      "",
    ].join("\n");

    const fx = makeTree(
      { "specs/frs/STE-542.md": fr },
      ["specs/design/frs/STE-542/mock.png"],
    );
    try {
      // (a) The path side is UNCHANGED — deep-equal against the whole literal
      // row object, so an added key, a dropped key or a shifted `line` fails.
      // This is the ONLY key-set-closure pin that exists for
      // DesignReferenceRow: every shipped assertion in
      // tests/gate-check-design-references-resolve.test.ts is field-by-field
      // `.toBe(...)` (or `toEqual([])` on an empty-result leg) and would stay
      // green against a widened row.
      expect(scanDesignReferences(fx.root)).toEqual([
        {
          path: "specs/design/frs/STE-542/mock.png",
          file: "specs/frs/STE-542.md",
          line: lineOf(fr, "mock.png"),
          resolves: true,
        },
      ]);

      // (b) POSITIVE CONTROL for (a): the URL is not merely "still dropped" —
      // it now surfaces on the sibling export. Without this leg, "the path
      // rows are unchanged" would also pass on a scanner that read nothing.
      const ext = scanExternalReferences(fx.root);
      expect(ext.length).toBe(1);
      expect(ext[0]!.url).toBe("https://example.invalid/upstream-spec");
      expect(ext[0]!.file).toBe("specs/frs/STE-542.md");
      expect(ext[0]!.line).toBe(lineOf(fr, "upstream-spec"));

      // (c) No on-disk resolution is attempted for a URL row — the probe #61
      // caller `existsSync`es every DesignReferenceRow, so a URL must never
      // carry (or be reachable through) a `resolves` field.
      expect(Object.keys(ext[0]!)).not.toContain("resolves");
      // …and the URL never leaks into the path-row stream.
      expect(
        scanDesignReferences(fx.root).map((r) => r.path),
      ).not.toContain("https://example.invalid/upstream-spec");
    } finally {
      fx.cleanup();
    }
  });

  test("a project with only path rows yields ZERO external rows, while the same tree still yields its path row (control)", () => {
    const fr = [
      "# STE-542",
      "",
      "## Design References",
      "",
      "- `specs/design/system/tokens.png` — Color tokens",
      "",
    ].join("\n");
    const fx = makeTree(
      { "specs/frs/STE-542.md": fr },
      ["specs/design/system/tokens.png"],
    );
    try {
      // Control FIRST: the scanner demonstrably reads this tree.
      expect(scanDesignReferences(fx.root).length).toBe(1);
      // Only then is the absence meaningful.
      expect(scanExternalReferences(fx.root)).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// AC-STE-542.2 — required → Design References, informational → External References
// ---------------------------------------------------------------------------

describe("AC-STE-542.2 — each external row carries its originating section", () => {
  test("a URL under `## Design References` and a URL under `## External References` land in DIFFERENT sections", () => {
    const fr = [
      "# STE-542",
      "",
      "## Acceptance Criteria",
      "",
      "- AC-STE-542.2: sections",
      "",
      "## Design References",
      "",
      "- `https://example.invalid/required-doc` — Must read (checked 2026-09-04T10:00:00Z: reachable)",
      "",
      "## External References",
      "",
      "- `https://example.invalid/terms` — Terms page (checked 2026-09-04T10:00:00Z: reachable)",
      "",
      "## Notes",
      "",
    ].join("\n");
    const fx = makeTree({ "specs/frs/STE-542.md": fr });
    try {
      const rows = scanExternalReferences(fx.root);
      expect(rows.length).toBe(2);

      const byUrl = new Map(rows.map((r) => [r.url, r]));
      expect(byUrl.get("https://example.invalid/required-doc")!.section).toBe(
        "design",
      );
      expect(byUrl.get("https://example.invalid/terms")!.section).toBe(
        "external",
      );
      // The two URLs land in different sections — asserted as a set, so a
      // scanner that stamped every row `"design"` fails here even if the two
      // per-row assertions above were loosened.
      expect(new Set(rows.map((r) => r.section))).toEqual(
        new Set<string>(["design", "external"]),
      );
    } finally {
      fx.cleanup();
    }
  });

  test("`### External References` (h3) is NOT the section — demotion yields zero rows, and the byte-identical `##` fixture yields exactly one (positive control)", () => {
    // Mirrors the shipped h3 case for `## Design References`
    // (DESIGN_REFS_HEADING_RE at scan_design_references.ts:36).
    const body = (heading: string): string =>
      [
        "# STE-542",
        "",
        heading,
        "",
        "- `https://example.invalid/terms` — Terms page (checked 2026-09-04T10:00:00Z: reachable)",
        "",
      ].join("\n");

    const h2 = makeTree({ "specs/frs/STE-542.md": body("## External References") });
    const h3 = makeTree({ "specs/frs/STE-542.md": body("### External References") });
    try {
      // POSITIVE CONTROL — the only difference between the two fixtures is the
      // extra `#`, so a scanner that read nothing could not pass this line.
      expect(scanExternalReferences(h2.root).length).toBe(1);
      // NEGATIVE — h3 is not a section heading.
      expect(scanExternalReferences(h3.root)).toEqual([]);
    } finally {
      h2.cleanup();
      h3.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// AC-STE-542.3 — the recorded line shape round-trips through the scanner
// ---------------------------------------------------------------------------

describe("AC-STE-542.3 — verdict recorded inline, round-trips through the scanner", () => {
  const RECORD_SHAPE =
    /^- `[^`]+` [—-] .+ \(checked \d{4}-\d{2}-\d{2}T[^)]*: (reachable|dead|unchecked)\)$/;

  test("formatExternalReferenceLine emits the literal AC shape", () => {
    const line = formatExternalReferenceLine({
      url: "https://example.invalid/upstream-spec",
      caption: "Upstream spec",
      checkedAt: "2026-09-04T10:00:00Z",
      verdict: "reachable",
    });
    expect(line).toMatch(RECORD_SHAPE);
    // AC-STE-542.3 writes the separator as an EM DASH, matching the shipped
    // `## Design References` idiom; the shape regex above tolerates either
    // dash, this pin does not.
    expect(line).toContain("`https://example.invalid/upstream-spec` — Upstream spec");
    expect(line).toContain("(checked 2026-09-04T10:00:00Z: reachable)");
  });

  test("the emitted string parses back to {url, caption, checkedAt, verdict} — full round-trip through scanExternalReferences", () => {
    const line = formatExternalReferenceLine({
      url: "https://example.invalid/upstream-spec",
      caption: "Upstream spec",
      checkedAt: "2026-09-04T10:00:00Z",
      verdict: "dead",
    });
    const fr = ["# STE-542", "", "## External References", "", line, ""].join("\n");
    const fx = makeTree({ "specs/frs/STE-542.md": fr });
    try {
      const rows = scanExternalReferences(fx.root);
      expect(rows.length).toBe(1);
      const r = rows[0]!;
      expect({
        url: r.url,
        caption: r.caption,
        checkedAt: r.checkedAt,
        verdict: r.verdict,
      }).toEqual({
        url: "https://example.invalid/upstream-spec",
        caption: "Upstream spec",
        checkedAt: "2026-09-04T10:00:00Z",
        verdict: "dead",
      });
    } finally {
      fx.cleanup();
    }
  });

  test("falsifiability — a line with the `(checked …)` tail removed parses to verdict null, never silently to 'reachable'", () => {
    const withTail = formatExternalReferenceLine({
      url: "https://example.invalid/upstream-spec",
      caption: "Upstream spec",
      checkedAt: "2026-09-04T10:00:00Z",
      verdict: "reachable",
    });
    const withoutTail =
      "- `https://example.invalid/upstream-spec` — Upstream spec";
    const fx = makeTree({
      "specs/frs/A.md": ["# A", "", "## External References", "", withTail, ""].join("\n"),
      "specs/frs/B.md": ["# B", "", "## External References", "", withoutTail, ""].join("\n"),
    });
    try {
      const rows = scanExternalReferences(fx.root);
      const a = rows.find((r) => r.file === "specs/frs/A.md")!;
      const b = rows.find((r) => r.file === "specs/frs/B.md")!;
      // CONTROL: the well-formed line does carry a verdict.
      expect(a.verdict).toBe("reachable");
      expect(a.checkedAt).toBe("2026-09-04T10:00:00Z");
      // The mutated line is UNVERDICTED, not defaulted.
      expect(b.verdict).toBeNull();
      expect(b.checkedAt).toBeNull();
      expect(b.url).toBe("https://example.invalid/upstream-spec");
    } finally {
      fx.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// AC-STE-542.7 / AC-STE-542.6 — absence assertions, each with its control
// ---------------------------------------------------------------------------

/** Counting fetch double: records every URL it was asked for. */
function countingFetch(status = 200) {
  const calls: string[] = [];
  return {
    calls,
    fetchImpl: async (url: string) => {
      calls.push(url);
      return { status };
    },
  };
}

const req = (url: string, caption: string) =>
  ({ url, caption, classification: "required" }) as const;
const info = (url: string, caption: string) =>
  ({ url, caption, classification: "informational" }) as const;

describe("AC-STE-542.7 — a run citing no external link is vacuous", () => {
  test("no URLs ⇒ ZERO requests; the SAME double on a two-URL run records exactly TWO (positive control)", async () => {
    const now = () => new Date("2026-09-04T10:00:00Z");

    const empty = countingFetch();
    await runExternalLinkChecks([], {
      fetchImpl: empty.fetchImpl,
      preflight: "online",
      now,
    });

    const two = countingFetch();
    const checks = await runExternalLinkChecks(
      [
        req("https://example.invalid/a", "A"),
        info("https://example.invalid/b", "B"),
      ],
      { fetchImpl: two.fetchImpl, preflight: "online", now },
    );

    // The zero is asserted ONLY alongside the two, so a permanently broken
    // caller (one that never calls fetchImpl at all) cannot pass this leg.
    expect({ empty: empty.calls.length, two: two.calls.length }).toEqual({
      empty: 0,
      two: 2,
    });
    expect(two.calls).toEqual([
      "https://example.invalid/a",
      "https://example.invalid/b",
    ]);
    expect(checks.map((c) => c.verdict)).toEqual(["reachable", "reachable"]);
  });

  test("no URLs ⇒ NO record: the FR body is byte-identical, and no empty `## External References` heading is emitted; a one-URL body is NOT byte-identical and gains exactly one heading (positive control)", () => {
    const before = [
      "# STE-542",
      "",
      "## Requirement",
      "",
      "Some requirement.",
      "",
      "## Acceptance Criteria",
      "",
      "- AC-STE-542.7: vacuous",
      "",
      "## Design References",
      "",
      "- `specs/design/frs/STE-542/mock.png` — Login mockup",
      "",
      "## Notes",
      "",
    ].join("\n");

    // ABSENCE — nothing to record, nothing changes, not one byte.
    const afterEmpty = recordExternalReferences(before, []);
    expect(afterEmpty).toBe(before);
    expect(afterEmpty).not.toContain("## External References");

    // POSITIVE CONTROL — the same helper on the same body DOES write when
    // there is something to write.
    const afterOne = recordExternalReferences(before, [
      {
        url: "https://example.invalid/terms",
        caption: "Terms page",
        classification: "informational",
        verdict: "reachable",
        checkedAt: "2026-09-04T10:00:00Z",
      },
    ]);
    expect(afterOne).not.toBe(before);
    expect(
      (afterOne.match(/^## External References$/gm) ?? []).length,
    ).toBe(1);
    expect(afterOne).toContain(
      "- `https://example.invalid/terms` — Terms page (checked 2026-09-04T10:00:00Z: reachable)",
    );
    // AC-STE-542.2 placement: the new section is created immediately after the
    // `## Design References` section.
    expect(afterOne.indexOf("## External References")).toBeGreaterThan(
      afterOne.indexOf("## Design References"),
    );
    expect(afterOne.indexOf("## External References")).toBeLessThan(
      afterOne.indexOf("## Notes"),
    );
  });

  test("a REQUIRED link is written under `## Design References`, not under a new section", () => {
    const before = [
      "# STE-542",
      "",
      "## Acceptance Criteria",
      "",
      "- AC-STE-542.2: routing",
      "",
      "## Design References",
      "",
      "- `specs/design/frs/STE-542/mock.png` — Login mockup",
      "",
      "## Notes",
      "",
    ].join("\n");
    const after = recordExternalReferences(before, [
      {
        url: "https://example.invalid/required-doc",
        caption: "Must read",
        classification: "required",
        verdict: "reachable",
        checkedAt: "2026-09-04T10:00:00Z",
      },
    ]);
    const designIdx = after.indexOf("## Design References");
    const notesIdx = after.indexOf("## Notes");
    const urlIdx = after.indexOf("https://example.invalid/required-doc");
    expect(urlIdx).toBeGreaterThan(designIdx);
    expect(urlIdx).toBeLessThan(notesIdx);
    // A required-only record does NOT open an External References section.
    expect(after).not.toContain("## External References");
    // …and the pre-existing path row survives (control that the writer did not
    // simply rewrite the section from scratch).
    expect(after).toContain(
      "- `specs/design/frs/STE-542/mock.png` — Login mockup",
    );
  });
});

describe("AC-STE-542.6 — offline never marks a link dead", () => {
  test("preflight offline + a fetch double that would answer 404 ⇒ the recorded line reads `unchecked`; the SAME fixture online records `dead` (positive control)", async () => {
    const now = () => new Date("2026-09-04T10:00:00Z");
    const rows = [info("https://example.invalid/gone", "Gone page")];
    const body = ["# STE-542", "", "## Design References", "", "- `specs/design/system/t.png` — T", "", "## Notes", ""].join("\n");

    const offlineDouble = countingFetch(404);
    const offlineChecks = await runExternalLinkChecks(rows, {
      fetchImpl: offlineDouble.fetchImpl,
      preflight: "offline",
      now,
    });
    expect(offlineChecks.map((c) => c.verdict)).toEqual(["unchecked"]);
    const offlineBody = recordExternalReferences(body, offlineChecks);
    expect(offlineBody).toContain(": unchecked)");
    expect(offlineBody).not.toContain(": dead)");

    // POSITIVE CONTROL — same rows, same 404 double, preflight online: the
    // pipeline demonstrably CAN write `dead`, so the absence above is real.
    const onlineDouble = countingFetch(404);
    const onlineChecks = await runExternalLinkChecks(rows, {
      fetchImpl: onlineDouble.fetchImpl,
      preflight: "online",
      now,
    });
    expect(onlineChecks.map((c) => c.verdict)).toEqual(["dead"]);
    const onlineBody = recordExternalReferences(body, onlineChecks);
    expect(onlineBody).toContain(": dead)");
    expect(onlineBody).not.toContain(": unchecked)");
  });

  test("the offline capability key is registered in the canonical set", () => {
    expect([...CANONICAL_CAPABILITY_KEYS]).toContain(
      "external_link_check_unchecked_offline",
    );
  });
});

// ---------------------------------------------------------------------------
// PROSE CONTRACT — /spec-write SKILL.md § 0b step 6b
// ---------------------------------------------------------------------------

/**
 * Slice § 0b (FR creation path) out of /spec-write SKILL.md. Copied from
 * `tests/design-references-capture-contract.test.ts:27`.
 */
function specWriteSection0b(body: string): string {
  const start = body.indexOf("### 0b. FR creation path");
  const end = body.indexOf("### 1. Assess current state");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return body.slice(start, end);
}

/**
 * Slice STEP 6b ALONE out of § 0b.
 *
 * § 0b is NOT tight enough on its own: measured today it already contains
 * `AskUserQuestion` once (STE-342's step 6), `required` 4×, and
 * `informational` once (the `milestone_attach_failed` "never a plain
 * informational line" sentence). Every assertion below therefore runs against
 * this narrower slice.
 */
function specWriteStep6b(body: string): string {
  const sec0b = specWriteSection0b(body);
  const start = sec0b.indexOf("6b.");
  expect(start, "§ 0b must carry a step `6b.`").toBeGreaterThan(-1);
  const end = sec0b.indexOf("7. **Token Stats");
  expect(end).toBeGreaterThan(start);
  return sec0b.slice(start, end);
}

/** The ±`radius` window around every occurrence of `needle`. */
function windowsAround(hay: string, needle: string, radius: number): string[] {
  const out: string[] = [];
  let i = hay.indexOf(needle);
  while (i !== -1) {
    out.push(hay.slice(Math.max(0, i - radius), i + needle.length + radius));
    i = hay.indexOf(needle, i + needle.length);
  }
  return out;
}

describe("AC-STE-542.1 — § 0b step 6b classifies one link at a time via an ask tool", () => {
  test("step 6b names AskUserQuestion, is one-at-a-time, and names both classes with informational as the default", () => {
    const body = read(specWritePath);
    const sec0b = specWriteSection0b(body);
    const step6b = specWriteStep6b(body);

    // ANTI-VACUITY CONTROL, asserted in the SAME test: § 0b carries exactly
    // ONE `AskUserQuestion` today (STE-342's image-capture step 6). After this
    // FR it must carry TWO — so an edit that adds prose but no ask cannot pass.
    expect((sec0b.match(/AskUserQuestion/g) ?? []).length).toBe(2);

    expect(step6b).toContain("AskUserQuestion");
    expect(step6b).toMatch(/one at a time/i);
    expect(step6b).toMatch(/required/i);
    expect(step6b).toMatch(/informational/i);
    // Default-informational proximity, asserted on the step-6b slice ONLY:
    // measured non-matching on § 0b today, but a § 0b-wide window would be
    // free to reach the pre-existing `informational` at SKILL.md:111.
    expect(step6b).toMatch(/default[\s\S]{0,60}informational/i);
  });
});

describe("AC-STE-542.2 — § 0b step 6b states which class routes to which section", () => {
  test("step 6b names both sections and binds required→Design References, informational→External References", () => {
    const step6b = specWriteStep6b(read(specWritePath));
    expect(step6b).toContain("## Design References");
    expect(step6b).toContain("## External References");
    expect(step6b).toMatch(
      /required[\s\S]{0,160}## Design References|## Design References[\s\S]{0,160}required/i,
    );
    expect(step6b).toMatch(
      /informational[\s\S]{0,160}## External References|## External References[\s\S]{0,160}informational/i,
    );
  });
});

describe("AC-STE-542.3 — § 0b step 6b carries the literal record shape", () => {
  test("step 6b spells out `(checked ` and all three verdict words", () => {
    const step6b = specWriteStep6b(read(specWritePath));
    expect(step6b).toContain("(checked ");
    expect(step6b).toContain("reachable");
    expect(step6b).toContain("dead");
    expect(step6b).toContain("unchecked");
  });
});

describe("AC-STE-542.6 — the capability directive AND the § 7 map row", () => {
  test("step 6b carries the MUST-emit directive for the offline key", () => {
    const step6b = specWriteStep6b(read(specWritePath));
    expect(step6b).toContain(
      "MUST emit `external_link_check_unchecked_offline`",
    );
  });

  test("the § 7 static map carries the key — the ONLY guard on that row", () => {
    // Load-bearing because NO probe enforces it: `scanSkillFile`
    // (closing_summary_capability_keys.ts:314) greps the WHOLE file body for
    // ``MUST emit `<key>` ``, so the § 0b directive alone satisfies the probe
    // and a missing § 7 map row is invisible to /gate-check.
    const map = specWriteStep7Map(read(specWritePath));
    expect(map).toContain("external_link_check_unchecked_offline");
  });
});

describe("AC-STE-542.7 — § 0b step 6b states the vacuous path", () => {
  test("step 6b spells the no-interview / no-network / no-record shape", () => {
    const step6b = specWriteStep6b(read(specWritePath));
    const wins = windowsAround(step6b, "acuous", 500);
    expect(
      wins.length,
      "step 6b must name the vacuous (no external link) path",
    ).toBeGreaterThan(0);
    const vac = wins.join("\n");
    expect(vac).toMatch(/no [\w`]*\s?(classification|interview|ask|prompt|question)/i);
    expect(vac).toMatch(/no [\w`]*\s?(request|network|check|fetch|probe)/i);
    expect(vac).toMatch(/no [\w`]*\s?(record|line|section|write)/i);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-542.8 — docs/layout-reference.md closed-set retirement
// ---------------------------------------------------------------------------

describe("AC-STE-542.8 — the layout contract admits `## External References`", () => {
  const CONTRACT_PHRASE = "required top-level sections";

  test("the contract window sanctions `## External References` as optional", () => {
    const layout = read(layoutPath);
    const idx = layout.indexOf(CONTRACT_PHRASE);
    expect(idx).toBeGreaterThan(-1);
    const contract = layout.slice(idx, idx + 2000);
    expect(contract).toContain("## External References");
    const wins = windowsAround(contract, "## External References", 300);
    expect(
      wins.some((w) => /optional/i.test(w)),
      "## External References must be sanctioned as optional in the contract",
    ).toBe(true);
  });

  test("the closed THREE-member optional-set claim is retired (tripwire)", () => {
    // Precedent: tests/summary-section-convention.test.ts:177 retired the
    // two-member version of this same sentence when ## Summary widened it.
    const layout = read(layoutPath);
    expect(layout).not.toContain("These three are the only optional sections");
    // Positive control, same test: without it the tripwire above is satisfied
    // by an empty read. The widened claim must be PRESENT, not merely the
    // superseded one absent.
    expect(layout).toContain("These four are the only optional sections");
  });

  test("sibling window pins survive the edit — `## Token Stats` stays inside the 2000-char contract window", () => {
    const layout = read(layoutPath);
    const idx = layout.indexOf(CONTRACT_PHRASE);
    const contract = layout.slice(idx, idx + 2000);
    // Measured today at offset 654 with 1346 chars of headroom.
    expect(contract).toContain("## Token Stats");
    expect(contract).toContain("## Summary");
    expect(contract).toContain("## Design References");
    expect(contract).toMatch(/optional/i);
  });
});

// ---------------------------------------------------------------------------
// BUDGET PINS — re-asserted here so a breach names THIS FR
// ---------------------------------------------------------------------------

describe("STE-542 budget pins — the two zero-headroom caps this FR must not breach", () => {
  const SKILL_LINE_CAP = 358; // tests/m116-ste-418-wiring.test.ts:774
  const SKILLS_STE_TOKEN_CEILING = 246; // tests/m116-ste-418-wiring.test.ts:775

  test(`skills/spec-write/SKILL.md stays within the NFR-1 line cap (${SKILL_LINE_CAP})`, () => {
    // MEASURED 2026-09-04: 357 lines — ONE line of headroom for TWO edits
    // (§ 0b step 6b AND the § 7 static-map row). One of them must ride an
    // existing line or an existing line must be compacted.
    const lines = read(specWritePath).split("\n").length;
    expect(lines).toBeLessThanOrEqual(SKILL_LINE_CAP);
  });

  test(`the skills/ STE-token ceiling (${SKILLS_STE_TOKEN_CEILING}) is not breached`, () => {
    // MEASURED at exactly 246 with ZERO headroom: § 0b step 6b and the § 7 row
    // must cite mechanisms (`check_external_link.ts`, `scanExternalReferences`)
    // and must NOT write `STE-542`.
    let count = 0;
    const walk = (d: string): void => {
      for (const name of readdirSync(d)) {
        const p = join(d, name);
        if (statSync(p).isDirectory()) {
          walk(p);
          continue;
        }
        if (!name.endsWith(".md")) continue;
        count += (
          read(p).match(/\b(STE|AC-STE)-\d+(?:\.\d+)?\b/g) ?? []
        ).length;
      }
    };
    walk(skillsDir);
    expect(count).toBeLessThanOrEqual(SKILLS_STE_TOKEN_CEILING);
  });
});

// ===========================================================================
// PRODUCER/CONSUMER SYNC GUARDS
//
// M140 ships a writer (`check_external_link.ts`) and a reader
// (`scan_design_references.ts` + `external_link_verdicts.ts`) that share a
// vocabulary but, deliberately, NOT a module: consolidating them would add an
// import edge, and probe #81's pin moves on import topology. STE-542's own FR
// says "one parser, never a reader-side copy — producer/consumer asymmetry has
// shipped in this repository three times." The copies are the sanctioned
// exception; these guards are the price of keeping them.
//
// Source-text assertions, not behavioural ones, precisely BECAUSE the modules
// must not import each other. Each carries its own positive control, so a
// guard that read nothing cannot pass.
// ===========================================================================

describe("the duplicated writer/reader vocabulary cannot drift silently", () => {
    const adaptersSrc = join(pluginRoot, "adapters", "_shared", "src");
  const writerSrc = read(join(adaptersSrc, "check_external_link.ts"));
  const scannerSrc = read(join(adaptersSrc, "scan_design_references.ts"));
  const probeSrc = read(join(adaptersSrc, "external_link_verdicts.ts"));

  test("all three sources were actually read (control for every leg below)", () => {
    // A guard whose file read returned "" passes every not-/toContain below.
    for (const [name, src] of [
      ["check_external_link.ts", writerSrc],
      ["scan_design_references.ts", scannerSrc],
      ["external_link_verdicts.ts", probeSrc],
    ] as const) {
      expect(src.length, `${name} read empty`).toBeGreaterThan(500);
    }
  });

  test("the three-verdict vocabulary is spelled identically in all three modules", () => {
    // Drift here is not cosmetic: if a fourth verdict joins `LinkVerdict` but
    // the reader's CHECKED_TAIL_RE alternation does not learn it, the row
    // parses as `verdict: null` — "never checked" — and the probe's
    // `unrecorded-required` rule raises a FALSE GATE FAILED for a link that
    // was checked and answered fine.
    expect(writerSrc).toContain(
      'export type LinkVerdict = "reachable" | "dead" | "unchecked";',
    );
    expect(scannerSrc).toContain(
      'verdict: "reachable" | "dead" | "unchecked" | null;',
    );
    expect(scannerSrc).toContain("(reachable|dead|unchecked)");
  });

  test("`LinkClassification` is declared identically in writer and probe", () => {
    // Declared verbatim in two modules with no compiler linkage between them.
    const DECL = 'export type LinkClassification = "required" | "informational";';
    expect(writerSrc).toContain(DECL);
    expect(probeSrc).toContain(DECL);
  });

  test("the writer's heading regexes match the scanner's byte for byte", () => {
    // The writer appends rows using its own copy; the reader locates them with
    // the canonical one. If the two disagree on where a section ends, a
    // freshly-checked link is written "inside" a section the reader no longer
    // considers it part of — dropped from grading with no error anywhere.
    for (const literal of [
      "/^##[ \\t]+Design References[ \\t]*$/",
      "/^##[ \\t]+External References[ \\t]*$/",
    ]) {
      expect(writerSrc, `writer lost ${literal}`).toContain(literal);
      expect(scannerSrc, `scanner lost ${literal}`).toContain(literal);
    }
  });

  test("the guards above can fail — a mutated spelling is not silently accepted", () => {
    // Falsifiability: the exact literals asserted above must be ABSENT from a
    // string that spells the vocabulary differently, or the assertions would
    // hold against any source at all.
    const mutated = writerSrc.replace(/unchecked/g, "unverified");
    expect(mutated).not.toContain(
      'export type LinkVerdict = "reachable" | "dead" | "unchecked";',
    );
    // "unchecked" (9) -> "unverified" (10): exactly one char per occurrence,
    // and there must BE occurrences, or the mutation was a no-op that reads
    // as a pass.
    const hits = (writerSrc.match(/unchecked/g) ?? []).length;
    expect(hits).toBeGreaterThan(0);
    expect(mutated.length).toBe(writerSrc.length + hits);
  });
});
