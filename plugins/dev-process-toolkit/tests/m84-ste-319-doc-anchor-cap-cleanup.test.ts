// Doc-conformance tests for STE-319 — Doc anchor + cap + Schema-tally +
// attribution cleanup (M84).
//
// Asserts the four drift strands surfaced by the 2026-05-20 review are
// resolved across `plugins/dev-process-toolkit/docs/` and the repo-root
// `specs/`:
//
//   A3  — NFR-1 line-cap (300/350 → canonical 351 from STE-305)
//   A5  — Dangling §-anchors (§7.3 / §9 / §9.3 → §3)
//   A9  — Schema L + Schema M field tallies (add `branch_template`,
//         `list_project_statuses`)
//   A17 — `/spec-review` refactor attribution (STE-296 → STE-308)
//
// Active/archived split: stale tokens remain acceptable inside
// `specs/frs/archive/**` and `specs/plan/archive/**` (frozen history).
// This test scopes strictly to active surfaces.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const pluginRoot = join(import.meta.dir, "..");
const docsDir = join(pluginRoot, "docs");
const repoRoot = join(pluginRoot, "..", "..");
const specsDir = join(repoRoot, "specs");

function readDoc(name: string): string {
  return readFileSync(join(docsDir, name), "utf8");
}

function readSpec(name: string): string {
  return readFileSync(join(specsDir, name), "utf8");
}

// Active-surface walker — returns absolute file paths for every .md file
// under `plugins/dev-process-toolkit/docs/` and `specs/` while skipping any
// directory whose path contains `archive/` (frozen history exemption).
function walkActiveMd(root: string): string[] {
  const out: string[] = [];
  function recurse(dir: string): void {
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (entry === "archive") continue;
        recurse(full);
      } else if (st.isFile() && entry.endsWith(".md")) {
        out.push(full);
      }
    }
  }
  recurse(root);
  return out;
}

function collectMatches(body: string, regex: RegExp): string[] {
  const hits: string[] = [];
  const lines = body.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (regex.test(lines[i]!)) {
      hits.push(`${i + 1}: ${lines[i]}`);
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------
// AC-STE-319.1 — NFR-1 line cap drift (300/350 → 351)
// ---------------------------------------------------------------------------
//
// 18 surfaces total: 13 under plugins/dev-process-toolkit/docs/ + the
// load-bearing `specs/technical-spec.md:86` Design Invariants line + 4 in
// `specs/requirements.md` (L17/L18/L66/L67) + `specs/testing-spec.md:27`.
// (Sum from FR table: 11 docs + 2 in technical-spec + 4 in requirements + 1
// in testing-spec = 18. The FR header's "13 surfaces" predates the M84 audit
// expansion; the FR text in AC.1 itself states 18.)

const CAP_DRIFT_REGEX = /(300|350)[- ](line|line-)?(cap|budget|lines)/i;

// ---------------------------------------------------------------------------
// WHY THESE ASSERTIONS NOW READ 358, NOT 351 (M137, closing the drift
// AC-STE-536.4 cites)
//
// STE-319's purpose was never "the number is 351". It was: every NFR-1
// citation on an active surface agrees with the cap the gate actually
// enforces. 351 was simply what `tests/skill-nfr-1-length.test.ts` enforced
// on the day this suite was written. That constant has since moved
// 351 -> 352 (STE-373) -> 354 (STE-374) -> 358, and the citations did not
// follow, so this suite was pinning the citations to a number no enforcement
// reads. A pin holding a stale number protects nothing: it lets the real
// drift widen while reporting CLEAN, which is exactly the failure STE-319
// existed to prevent.
//
// Moving the alignment target WITH the cap therefore preserves STE-319's
// intent rather than violating it. `tests/skill-nfr-1-length.test.ts`'s
// `SKILL_LINE_CAP` remains the single source of truth; if it moves again,
// these literals and the surfaces they guard must move together.
//
// The two mentions of 351 in this file's header banner and the AC-STE-319.1
// section banner are deliberately left alone: they narrate the FR's own
// history (the 300/350 -> 351 cleanup it performed) and are correct as
// written.
// ---------------------------------------------------------------------------

describe("AC-STE-319.1 — NFR-1 line cap citations track the enforced cap (358)", () => {
  test("specs/technical-spec.md Design Invariants reads 358 (load-bearing source)", () => {
    const body = readSpec("technical-spec.md");
    const lines = body.split("\n");
    // The Design Invariants row keyed "Skill file cap" must cite the
    // enforced cap, 358 — see the WHY block above.
    const designInvariantsLine = lines.find((l) =>
      /Skill file cap/.test(l),
    );
    expect(designInvariantsLine).toBeDefined();
    expect(designInvariantsLine!).toMatch(/358/);
    expect(designInvariantsLine!).not.toMatch(/300 lines/);
  });

  test("specs/technical-spec.md Risk-table cap citation reads 358 (no 300/350)", () => {
    const body = readSpec("technical-spec.md");
    const hits = collectMatches(body, CAP_DRIFT_REGEX);
    expect(hits).toEqual([]);
  });

  test("specs/requirements.md L17/L18/L66/L67 cap citations read 358", () => {
    const body = readSpec("requirements.md");
    const hits = collectMatches(body, CAP_DRIFT_REGEX);
    expect(hits).toEqual([]);
    // Affirmative: the NFR-1 prose still mentions a numeric cap, and now
    // that number must be 358 — the value the gate enforces.
    expect(body).toMatch(/358/);
  });

  test("specs/testing-spec.md L27 cap citation reads 358", () => {
    const body = readSpec("testing-spec.md");
    const hits = collectMatches(body, CAP_DRIFT_REGEX);
    expect(hits).toEqual([]);
  });

  test("plugins/dev-process-toolkit/docs/** carries zero 300/350-line-cap citations", () => {
    const offenders: string[] = [];
    for (const path of walkActiveMd(docsDir)) {
      const body = readFileSync(path, "utf8");
      const hits = collectMatches(body, CAP_DRIFT_REGEX);
      if (hits.length > 0) {
        offenders.push(`${path}\n  ${hits.join("\n  ")}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("grep gate from AC text: zero matches across active docs+specs", () => {
    // Mirrors the AC's exact verification command:
    //   git grep -nE "(300|350)[- ](line|line-)?(cap|budget|lines)" \
    //     plugins/dev-process-toolkit/docs/ specs/
    // returns zero matches outside of archive/**.
    const roots = [docsDir, specsDir];
    const offenders: string[] = [];
    for (const root of roots) {
      for (const path of walkActiveMd(root)) {
        // FR spec files (specs/frs/<id>.md) carry stale-text quotations in
        // their drift-table prose by design — scope the gate to active
        // doc/spec surfaces, excluding the FR/plan body where stale tokens
        // are reference material, not authoritative claims.
        if (path.includes(`${specsDir}/frs/`)) continue;
        if (path.includes(`${specsDir}/plan/`)) continue;
        const body = readFileSync(path, "utf8");
        const hits = collectMatches(body, CAP_DRIFT_REGEX);
        if (hits.length > 0) {
          offenders.push(`${path}\n  ${hits.join("\n  ")}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-319.2 — Dangling §-anchors rewritten to §3
// ---------------------------------------------------------------------------
//
// All 7 dangling `§7.3` / `§9` / `§9.3` citations rewritten to point at
// `specs/technical-spec.md §3 Cross-Skill Schema Definitions`.

const DANGLING_ANCHOR_REGEX = /technical-spec(\.md)? §(7\.3|9|9\.3)/;

describe("AC-STE-319.2 — Dangling §-anchors rewritten to §3", () => {
  test("plugins/dev-process-toolkit/docs/** has zero dangling §7.3 / §9 / §9.3 citations", () => {
    const offenders: string[] = [];
    for (const path of walkActiveMd(docsDir)) {
      const body = readFileSync(path, "utf8");
      const hits = collectMatches(body, DANGLING_ANCHOR_REGEX);
      if (hits.length > 0) {
        offenders.push(`${path}\n  ${hits.join("\n  ")}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("specs/requirements.md:50 Schema L row no longer cites §7.3", () => {
    const body = readSpec("requirements.md");
    const hits = collectMatches(body, DANGLING_ANCHOR_REGEX);
    expect(hits).toEqual([]);
  });

  test("specs/technical-spec.md (and other active specs) carry zero dangling §-anchor citations", () => {
    const offenders: string[] = [];
    // Walk active specs (top-level only, skipping frs/ and plan/ since they
    // are FR/plan prose that may quote stale citations as reference text).
    const entries = readdirSync(specsDir);
    for (const entry of entries) {
      const full = join(specsDir, entry);
      if (!statSync(full).isFile() || !entry.endsWith(".md")) continue;
      const body = readFileSync(full, "utf8");
      const hits = collectMatches(body, DANGLING_ANCHOR_REGEX);
      if (hits.length > 0) {
        offenders.push(`${full}\n  ${hits.join("\n  ")}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("rewrite replaces dangling anchors with §3 (Cross-Skill Schema Definitions)", () => {
    // Affirmative: at least one of the rewritten surfaces must now cite §3
    // (the actual location of Schemas L, M, W) so we know the rewrite is
    // semantically correct, not just a deletion.
    const requirements = readSpec("requirements.md");
    const trackerAdapters = readDoc("tracker-adapters.md");
    const patterns = readDoc("patterns.md");
    const corpus = `${requirements}\n${trackerAdapters}\n${patterns}`;
    expect(corpus).toMatch(/technical-spec(\.md)? §3/);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-319.3 — Schema tallies (L: 3→4, M: 10→11)
// ---------------------------------------------------------------------------

describe("AC-STE-319.3 — Schema L + Schema M field tallies updated", () => {
  test("docs/tracker-adapters.md Schema L summary lists branch_template (4 keys)", () => {
    const body = readDoc("tracker-adapters.md");
    // The summary block under `## Schemas (technical-spec ...)` describes
    // Schema L; it must now list `branch_template` alongside the original
    // three keys (`mode`, `mcp_server`, `jira_ac_field`).
    const schemaLBlock = body.match(/Schema L[\s\S]*?(?=Schema M)/);
    expect(schemaLBlock).not.toBeNull();
    expect(schemaLBlock![0]).toMatch(/branch_template/);
    expect(schemaLBlock![0]).toMatch(/mode/);
    expect(schemaLBlock![0]).toMatch(/mcp_server/);
    expect(schemaLBlock![0]).toMatch(/jira_ac_field/);
    // Tally word: should no longer say "three keys" — must be four.
    expect(schemaLBlock![0]).not.toMatch(/[Tt]hree keys/);
  });

  test("docs/tracker-adapters.md Schema M summary lists list_project_statuses (11 fields)", () => {
    const body = readDoc("tracker-adapters.md");
    const schemaMBlock = body.match(/Schema M[\s\S]*?(?=Schema N)/);
    expect(schemaMBlock).not.toBeNull();
    expect(schemaMBlock![0]).toMatch(/list_project_statuses/);
    // Tally word: 10 → 11. The old prose says "Ten fields".
    expect(schemaMBlock![0]).not.toMatch(/[Tt]en fields/);
    expect(schemaMBlock![0]).toMatch(/[Ee]leven|11 fields|11\s/);
  });

  test("specs/technical-spec.md Schema M definition includes list_project_statuses", () => {
    const body = readSpec("technical-spec.md");
    // The canonical Schema M definition is under `### Schema M:` — extract
    // that block (up to the next `### Schema` heading) and assert it names
    // the new key.
    const schemaMBlock = body.match(/### Schema M:[\s\S]*?(?=### Schema N)/);
    expect(schemaMBlock).not.toBeNull();
    expect(schemaMBlock![0]).toMatch(/list_project_statuses/);
  });

  test("STE-303 origin documented in prose for the new list_project_statuses field", () => {
    // FR AC.3: "The new field documents its STE-303 origin in one line of
    // prose." Check that at least one of the canonical surfaces (Schema M
    // definition in technical-spec.md or summary in tracker-adapters.md)
    // attributes the field to STE-303 in nearby prose.
    const tech = readSpec("technical-spec.md");
    const tracker = readDoc("tracker-adapters.md");
    const techSchemaM = tech.match(/### Schema M:[\s\S]*?(?=### Schema N)/);
    const trackerSchemaM = tracker.match(/Schema M[\s\S]*?(?=Schema N)/);
    const corpus = `${techSchemaM?.[0] ?? ""}\n${trackerSchemaM?.[0] ?? ""}`;
    expect(corpus).toMatch(/STE-303/);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-319.4 — patterns.md:722 attribution rewrite (STE-296 → STE-308)
// ---------------------------------------------------------------------------

describe("AC-STE-319.4 — /spec-review refactor attributed to STE-308", () => {
  test("docs/patterns.md cites STE-308 as the /spec-review refactor source", () => {
    const body = readDoc("patterns.md");
    // The targeted paragraph (around L722) contains the canonical-
    // precedents prose. Slice the section that mentions `/spec-review` near
    // STE-308.
    expect(body).toMatch(/STE-308[\s\S]{0,200}\/spec-review|\/spec-review[\s\S]{0,200}STE-308/);
  });

  test("docs/patterns.md cites STE-296 as the /tdd AUDIT stage origin (not /spec-review)", () => {
    const body = readDoc("patterns.md");
    // STE-296 must still appear, but tied to `/tdd` / AUDIT, not to
    // `/spec-review`. Reject the legacy phrasing "STE-296 (the /spec-review
    // refactor)" verbatim.
    expect(body).toMatch(/STE-296/);
    expect(body).not.toMatch(/STE-296[^.\n]{0,80}\/spec-review[^.\n]{0,40}refactor/);
    // Affirmative: STE-296 should now be associated with /tdd or AUDIT.
    expect(body).toMatch(/STE-296[\s\S]{0,200}(\/tdd|AUDIT|audit)/);
  });

  test("attribution lines up with CHANGELOG canonical record", () => {
    // Lightweight sanity check: the CHANGELOG mentions STE-308 in the M80
    // / v2.27.0 context and STE-296 in the M77 / v2.24.0 context. We don't
    // hard-code line numbers — we just confirm both attributions exist so
    // the doc rewrite isn't fabricating an unverifiable claim.
    const changelog = readFileSync(join(repoRoot, "CHANGELOG.md"), "utf8");
    expect(changelog).toMatch(/STE-308/);
    expect(changelog).toMatch(/STE-296/);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-319.5 — Orphan {#schema-J} anchor — default branch (a): drop
// ---------------------------------------------------------------------------

describe("AC-STE-319.5 — Orphan {#schema-J} heading dropped (branch a)", () => {
  test("specs/technical-spec.md no longer carries {#schema-J} anchor", () => {
    const body = readSpec("technical-spec.md");
    expect(body).not.toMatch(/\{#schema-J\}/);
  });

  test("specs/technical-spec.md no longer carries `### Schema J:` heading", () => {
    const body = readSpec("technical-spec.md");
    expect(body).not.toMatch(/### Schema J:/);
  });

  test("no inbound #schema-J references exist across active surfaces", () => {
    // FR verifies: `grep -rn '#schema-J' specs/ plugins/dev-process-toolkit/
    // {skills,agents,docs,templates}` returns 0. After the drop, that
    // remains true (sanity gate — if anyone re-adds an inbound link
    // without restoring the heading, the link would dangle).
    const roots = [
      specsDir,
      join(pluginRoot, "skills"),
      join(pluginRoot, "agents"),
      join(pluginRoot, "docs"),
      join(pluginRoot, "templates"),
    ];
    const offenders: string[] = [];
    for (const root of roots) {
      if (!existsSync(root)) continue;
      // Use a broader walk that includes all text-ish files, not just .md,
      // since templates/ may contain .json + .sh referenced by skills.
      function recurse(dir: string): void {
        let entries: string[] = [];
        try {
          entries = readdirSync(dir);
        } catch {
          return;
        }
        for (const entry of entries) {
          const full = join(dir, entry);
          let st;
          try {
            st = statSync(full);
          } catch {
            continue;
          }
          if (st.isDirectory()) {
            if (entry === "archive" || entry === "node_modules") continue;
            recurse(full);
          } else if (st.isFile()) {
            // Restrict to text-ish files we expect to carry cross-refs.
            if (!/\.(md|json|sh|ts|yaml|yml)$/.test(entry)) continue;
            // Skip the FR file itself which legitimately quotes #schema-J
            // in its drift-table prose as reference material.
            if (full === join(specsDir, "frs", "STE-319.md")) continue;
            const body = readFileSync(full, "utf8");
            if (body.includes("#schema-J")) {
              offenders.push(full);
            }
          }
        }
      }
      recurse(root);
    }
    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// M137 anti-recurrence — every active NFR-1 cap citation states the ENFORCED
// number, read from the enforcer rather than copied.
//
// STE-319 banned the two numbers that were stale in 2026-05 (300 and 350) and
// stopped there. That is a ban-list, and a ban-list only knows the numbers it
// was told about: when the cap moved 351 -> 352 -> 354 -> 358 the citations
// stayed at 351 and every leg above still reported CLEAN. AC-STE-536.4 names
// that outcome as the drift it exists to prevent.
//
// This leg inverts the shape — affirmative, not a ban-list. It parses
// `SKILL_LINE_CAP` out of `tests/skill-nfr-1-length.test.ts` (the one place
// enforcement happens) and requires every NFR-1 cap citation on an active
// surface to state that same number. A future bump reddens here until the
// prose follows, whatever the new number is.
//
// Scoped to citation SHAPES, not to any "3-digit number near NFR-1": the
// bump-rationale line at `specs/requirements.md` and `specs/frs/STE-536.md`
// legitimately name superseded caps while narrating the drift, and a
// proximity rule would false-RED both.
// ---------------------------------------------------------------------------

const NFR1_ENFORCER = join(pluginRoot, "tests", "skill-nfr-1-length.test.ts");

/** The shapes an NFR-1 cap citation actually takes on a shipped surface. */
const CAP_CITATION_PATTERNS: readonly RegExp[] = [
  /NFR-1(?:'s)?\s+(\d{3})-line/g, //            "NFR-1 358-line cap|budget", "NFR-1's 358-line skill cap"
  /NFR-1\s*\(≤\s*(\d{3})\s*lines\)/g, //        "under NFR-1 (≤358 lines)" (may wrap a newline)
  /≤\s*(\d{3})\s*lines?\s*\(per NFR-1\)/g, //   "≤358 lines (per NFR-1)"
  /(?:SKILL\.md|skill)\s*≤\s*(\d{3})\s*lines/gi, // "Every SKILL.md ≤ 358 lines"
  /skill file shall exceed (\d{3}) lines/gi, //  the NFR itself
  /skill approaches (\d{3}) lines/gi, //         the overflow rule
];

/** The cap the gate enforces, parsed from its enforcer. Never a copy. */
function enforcedSkillLineCap(): number {
  const hit = /const SKILL_LINE_CAP = (\d+);/.exec(readFileSync(NFR1_ENFORCER, "utf8"));
  if (hit === null) {
    throw new Error(
      "tests/skill-nfr-1-length.test.ts no longer declares `const SKILL_LINE_CAP = <n>;` — " +
        "the cap cannot be read from its enforcer, so any number asserted here would be a copy",
    );
  }
  return Number(hit[1]);
}

/** `file:line — matched text` for every cap citation on an active surface. */
function activeCapCitations(): { where: string; value: number }[] {
  const out: { where: string; value: number }[] = [];
  for (const root of [docsDir, specsDir]) {
    for (const path of walkActiveMd(root)) {
      // The findings log narrates measured drift by definition — it records
      // superseded numbers on purpose and is not a citation surface.
      if (path.startsWith(join(specsDir, "notes"))) continue;
      const body = readFileSync(path, "utf8");
      const lineStarts = body.split("\n");
      for (const pattern of CAP_CITATION_PATTERNS) {
        for (const m of body.matchAll(pattern)) {
          const before = body.slice(0, m.index ?? 0);
          const lineNo = before.split("\n").length;
          out.push({
            where: `${path.slice(repoRoot.length + 1)}:${lineNo} — ${lineStarts[lineNo - 1]?.trim()}`,
            value: Number(m[1]),
          });
        }
      }
    }
  }
  return out;
}

describe("M137 — active NFR-1 cap citations equal the enforced cap", () => {
  test("the citation set is non-empty and covers docs/ and specs/ both", () => {
    const hits = activeCapCitations();
    // Falsifiability: if the shapes stop matching, this guard would pass
    // vacuously while every surface drifted. Fail instead.
    expect(hits.length, "no NFR-1 cap citation matched at all").toBeGreaterThanOrEqual(12);
    expect(
      hits.some((h) => h.where.startsWith("plugins/dev-process-toolkit/docs/")),
      "no citation matched under docs/",
    ).toBe(true);
    expect(
      hits.some((h) => h.where.startsWith("specs/")),
      "no citation matched under specs/",
    ).toBe(true);
  });

  test("every citation states the number tests/skill-nfr-1-length.test.ts enforces", () => {
    const cap = enforcedSkillLineCap();
    const stale = activeCapCitations().filter((h) => h.value !== cap);
    expect(stale.map((h) => h.where)).toEqual([]);
  });
});
