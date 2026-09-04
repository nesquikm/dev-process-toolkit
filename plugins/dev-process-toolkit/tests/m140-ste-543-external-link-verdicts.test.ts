// M140 / STE-543 — "Gate probe grading recorded external-link verdicts".
//
// THE SUBJECT THE IMPLEMENTER WRITES:
//
//     adapters/_shared/src/external_link_verdicts.ts        ← NEW (probe #83)
//
// built ON TOP of STE-542's shipped surfaces — `scanExternalReferences`
// (adapters/_shared/src/scan_design_references.ts) for the row parser and the
// two section names, and `check_external_link.ts` for the verdict vocabulary.
// NEVER a reader-side copy of the parser: producer/consumer asymmetry has
// shipped in this repository three times.
//
// NOTE FOR THE IMPLEMENTER — the FR's Technical Design names a module
// `adapters/_shared/src/external_link_record.ts` as the home of the section
// names, the row parser and `EXTERNAL_LINK_TTL_DAYS`. MEASURED TODAY: that
// file DOES NOT EXIST. STE-542 shipped the parser inside
// `scan_design_references.ts` (as `scanExternalReferences`) and shipped no TTL
// constant at all. So this suite imports `EXTERNAL_LINK_TTL_DAYS` from the NEW
// module, which must define (or re-export) it — AC-STE-543.4 requires only
// that the threshold be EXPORTED, not which file exports it.
//
// THE CONTRACT THESE TESTS PIN, stated once so nothing has to be guessed:
//
//   export const PROBE_ID = "external_link_verdicts"
//   export const EXTERNAL_LINK_TTL_DAYS: number
//
//   export interface VerdictRule { id: string; /* … */ }
//   export const VERDICT_RULES: readonly VerdictRule[]   // carries id "dead-required"
//
//   export interface ExternalLinkVerdictViolation {
//     file: string; line: number; severity: "error";
//     reason: string; note: string; message: string;   // runnability_declared.ts:73 shape
//   }
//   export interface ExternalLinkVerdictsReport {
//     violations: ExternalLinkVerdictViolation[];
//     notes: string[];        // best_practices_manifest_hygiene.ts:37 shape
//     vacuous: boolean;       // runnability_declared.ts:73 shape
//   }
//
//   export function runExternalLinkVerdictsProbe(
//     projectRoot: string,
//     now?: Date,                              // INJECTED — never the wall clock
//     rules?: readonly VerdictRule[],          // defaulted LAST, mirroring
//   ): ExternalLinkVerdictsReport | Promise<…>  // runUpgradeStalenessProbe(root, registry)
//
//   plus an `if (import.meta.main)` front door — without one, registering the
//   probe in skills/gate-check/SKILL.md turns probe #81 red (that file says so
//   itself at :245).
//
// CLASSIFICATION IS THE SECTION, not a token on the row. STE-542's
// `recordExternalReferences` routes REQUIRED links to `## Design References`
// and INFORMATIONAL links to `## External References`, and
// `formatExternalReferenceLine` writes no classification word. So
// `section: "design"` ⇒ required and `section: "external"` ⇒ informational,
// and the "one token" that separates the AC.2 / AC.3 fixture pairs is the
// heading word.
//
// Every `runExternalLinkVerdictsProbe` call below passes an EXPLICIT `now`:
// a fixture with a hard-coded `checked_at` graded against the wall clock
// passes today and rots silently (AC-STE-543.4).
//
// Fixtures are on-disk tmpdir trees via `mkdtempSync` — the 212-file house
// idiom (`tests/gate-check-best-practices-manifest-hygiene.test.ts:53`).
// Filter by AC with `bun test -t "AC-STE-543.N"`.

import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  EXTERNAL_LINK_TTL_DAYS,
  PROBE_ID,
  VERDICT_RULES,
  runExternalLinkVerdictsProbe,
} from "../adapters/_shared/src/external_link_verdicts";
import {
  ORDERED_UNREACHABLE_PIN,
  runModuleReachabilityProbe,
} from "../adapters/_shared/src/module_reachability";

// ---------------------------------------------------------------------------
// Paths + tiny helpers
// ---------------------------------------------------------------------------

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");

/**
 * `ORDERED_UNREACHABLE_PIN` as it stood entering M140 — a bare literal on
 * purpose, following the frozen-historical idiom in
 * `tests/m139-ste-541-linear-minted-milestone.test.ts` and
 * `tests/m141-ste-545-release-writer-door.test.ts`. Importing the live
 * constant here would compare it against itself and assert nothing.
 */
const PIN_ENTERING_M140 = 130;
const README = join(REPO_ROOT, "README.md");
const GATE_CHECK_SKILL = join(PLUGIN_ROOT, "skills", "gate-check", "SKILL.md");

const MODULE_REL = "adapters/_shared/src/external_link_verdicts.ts";
const MODULE_ABS = join(PLUGIN_ROOT, ...MODULE_REL.split("/"));
const TEST_FILE_REL = "tests/m140-ste-543-external-link-verdicts.test.ts";

const read = (path: string): string => readFileSync(path, "utf-8");

const DAY_MS = 24 * 60 * 60 * 1000;
/** A fixed clock. Injected into every probe call — never `new Date()`. */
const NOW = new Date("2026-09-04T12:00:00.000Z");
const daysBefore = (n: number): string =>
  new Date(NOW.getTime() - n * DAY_MS).toISOString();
/** One day old — comfortably inside any sane TTL. */
const FRESH = daysBefore(1);

interface Fixture {
  root: string;
  cleanup: () => void;
}

function makeFixture(slug: string): Fixture {
  const root = mkdtempSync(join(tmpdir(), `ste543-${slug}-`));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function writeSpec(root: string, rel: string, body: string): void {
  const abs = join(root, ...rel.split("/"));
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body);
}

/** The recorded line shape `formatExternalReferenceLine` emits. */
const recordedRow = (url: string, caption: string, checkedAt: string, verdict: string): string =>
  `- \`${url}\` — ${caption} (checked ${checkedAt}: ${verdict})`;

/** The same row with NO `(checked …)` tail — the check never ran. */
const unrecordedRow = (url: string, caption: string): string =>
  `- \`${url}\` — ${caption}`;

/**
 * A one-section FR body. `heading` is the ONLY thing that varies between the
 * required and informational halves of the AC.2 / AC.3 pairs.
 */
const oneSectionBody = (heading: string, row: string): string =>
  ["---", "title: fixture", "---", "", "# Fixture", "", `## ${heading}`, "", row, ""].join("\n");

/** Count of lines that differ between two bodies of equal length. */
function differingLines(a: string, b: string): string[] {
  const la = a.split("\n");
  const lb = b.split("\n");
  const n = Math.max(la.length, lb.length);
  const diffs: string[] = [];
  for (let i = 0; i < n; i++) {
    if (la[i] !== lb[i]) diffs.push(`${i + 1}: ${la[i] ?? "<eof>"} | ${lb[i] ?? "<eof>"}`);
  }
  return diffs;
}

// ===========================================================================
// AC-STE-543.1 — both sections, active and archive, by FILE READS ONLY
// ===========================================================================

/**
 * Four spec files across the full glob (root spec, active FR, ARCHIVED FR,
 * plan), each carrying ONE `## Design References` row (required) and ONE
 * `## External References` row (informational). Every row is recorded `dead`
 * and FRESH, so required rows land in `violations` and informational rows land
 * in `notes` — the split that makes the per-section count assertable.
 */
const AC1_FILES: readonly string[] = [
  "specs/requirements.md",
  "specs/frs/STE-543.md",
  "specs/frs/archive/STE-100.md",
  "specs/plan/M140.md",
];

const ac1Slug = (rel: string): string => rel.replace(/[^a-z0-9]+/gi, "-");

function buildAc1Tree(root: string): void {
  for (const rel of AC1_FILES) {
    const slug = ac1Slug(rel);
    writeSpec(
      root,
      rel,
      [
        "---",
        "title: fixture",
        "---",
        "",
        "# Fixture",
        "",
        "## Design References",
        "",
        recordedRow(`https://example.invalid/${slug}/required`, "required doc", FRESH, "dead"),
        "",
        "## External References",
        "",
        recordedRow(`https://example.invalid/${slug}/informational`, "informational doc", FRESH, "dead"),
        "",
      ].join("\n"),
    );
  }
}

describe("AC-STE-543.1 — walks both sections across active AND archived specs", () => {
  test("PER-SECTION, PER-FILE row counts — never a bare total of eight", async () => {
    const fx = makeFixture("ac1-glob");
    try {
      buildAc1Tree(fx.root);
      const report = await runExternalLinkVerdictsProbe(fx.root, NOW);

      // A total of 8 is reachable by walking ONE section twice. These two
      // buckets are section-discriminated: design ⇒ required ⇒ violation,
      // external ⇒ informational ⇒ note.
      expect(report.violations.length).toBe(AC1_FILES.length);
      expect(report.notes.length).toBe(AC1_FILES.length);
      expect(report.vacuous).toBe(false);

      // Exactly one violation per file, and exactly one note naming that file.
      const violationsPerFile = Object.fromEntries(
        AC1_FILES.map((rel) => [rel, report.violations.filter((v) => v.file === rel).length]),
      );
      expect(violationsPerFile).toEqual(
        Object.fromEntries(AC1_FILES.map((rel) => [rel, 1])),
      );

      const notesPerFile = Object.fromEntries(
        AC1_FILES.map((rel) => [rel, report.notes.filter((n) => n.includes(rel)).length]),
      );
      expect(notesPerFile).toEqual(Object.fromEntries(AC1_FILES.map((rel) => [rel, 1])));

      // The URL halves cannot have been crossed: every violation names a
      // `/required` URL and every note names an `/informational` one.
      expect(report.violations.every((v) => v.message.includes("/required"))).toBe(true);
      expect(report.notes.every((n) => n.includes("/informational"))).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  test("ISOLATING HALF: `## Notes` and `### External References` yield ZERO rows", async () => {
    const fx = makeFixture("ac1-isolation");
    try {
      const url = "https://example.invalid/hidden";
      writeSpec(
        fx.root,
        "specs/frs/STE-999.md",
        [
          "# Fixture",
          "",
          "## Notes",
          "",
          recordedRow(url, "under the wrong h2", FRESH, "dead"),
          "",
          "### External References",
          "",
          recordedRow(url, "under a demoted h3", FRESH, "dead"),
          "",
        ].join("\n"),
      );
      const report = await runExternalLinkVerdictsProbe(fx.root, NOW);
      expect({
        violations: report.violations.length,
        notes: report.notes.length,
        vacuous: report.vacuous,
      }).toEqual({ violations: 0, notes: 0, vacuous: true });

      // POSITIVE CONTROL, same test: promote the h3 to an h2 and the SAME URL
      // is found. Without this, "zero rows" is satisfied by a scan that reads
      // nothing at all.
      writeSpec(
        fx.root,
        "specs/frs/STE-999.md",
        ["# Fixture", "", "## External References", "", recordedRow(url, "promoted", FRESH, "dead"), ""].join("\n"),
      );
      const promoted = await runExternalLinkVerdictsProbe(fx.root, NOW);
      expect(promoted.notes.length).toBe(1);
      expect(promoted.notes[0]).toContain(url);
      expect(promoted.vacuous).toBe(false);
    } finally {
      fx.cleanup();
    }
  });

  test("PURITY (a): zero fetch calls — with the double's own positive control", async () => {
    const fx = makeFixture("ac1-fetch");
    const originalFetch = globalThis.fetch;
    let calls = 0;
    const double = (async (_input: unknown, _init?: unknown) => {
      calls++;
      return { status: 200 } as unknown as Response;
    }) as unknown as typeof fetch;
    try {
      buildAc1Tree(fx.root);
      globalThis.fetch = double;
      const report = await runExternalLinkVerdictsProbe(fx.root, NOW);
      globalThis.fetch = originalFetch;

      // The probe read four files carrying eight URLs and issued no request.
      expect(report.violations.length + report.notes.length).toBe(8);
      expect(calls).toBe(0);

      // POSITIVE CONTROL, same test: a call count on a double that was never
      // wired reads clean. Prove the counter can move.
      await double("https://example.invalid/control");
      expect(calls).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
      fx.cleanup();
    }
  });

  test("PURITY (b): no socket / child-process / git imports — with a search control", () => {
    // The fetch double covers only the `fetch` path; a socket module or a
    // `git` shell-out would sail past it.
    const importSpecifiers = (src: string): string[] =>
      [...src.matchAll(/(?:\bfrom|\brequire\(|\bimport\()\s*["']([^"']+)["']/g)].map(
        (m) => m[1]!,
      );

    const FORBIDDEN = ["node:child_process", "node:https", "node:http", "node:net"];
    const specs = importSpecifiers(read(MODULE_ABS));
    const offenders = specs.filter(
      (s) => FORBIDDEN.includes(s) || /git/i.test(s),
    );
    expect({ module: MODULE_REL, offenders }).toEqual({ module: MODULE_REL, offenders: [] });

    // POSITIVE CONTROL, same test: the IDENTICAL extraction DOES find
    // `node:child_process` in `falsifiability_harness.ts` — proof the search
    // can hit rather than being a regex that matches nothing anywhere.
    const controlAbs = join(PLUGIN_ROOT, "adapters", "_shared", "src", "falsifiability_harness.ts");
    expect(importSpecifiers(read(controlAbs))).toContain("node:child_process");
  });

  test("probes #68 and #69 need NO edit — their purity prose is byte-unchanged", () => {
    // Asserted rather than assumed: this probe reading only files is exactly
    // what lets those two keep saying `no git, no network`.
    const lines = read(GATE_CHECK_SKILL).split("\n");
    // SKILL.md:155 and :156 (1-indexed) — measured today.
    expect(lines[154]).toMatch(/^68\. \*\*`migration_coverage`\*\*/);
    expect(lines[154]).toContain("no git, no network");
    expect(lines[155]).toMatch(/^69\. \*\*`upgrade_staleness`\*\*/);
    expect(lines[155]).toContain("no git, no network");
  });

  test("the module exports a PROBE_ID and a runnable probe", () => {
    expect(PROBE_ID).toBe("external_link_verdicts");
    expect(typeof runExternalLinkVerdictsProbe).toBe("function");
  });
});

// ===========================================================================
// AC-STE-543.2 — a RECORDED DEAD link
// ===========================================================================

const DEAD_URL = "https://example.invalid/gone";
const AC2_REQUIRED_BODY = oneSectionBody(
  "Design References",
  recordedRow(DEAD_URL, "the vanished doc", FRESH, "dead"),
);
const AC2_INFORMATIONAL_BODY = oneSectionBody(
  "External References",
  recordedRow(DEAD_URL, "the vanished doc", FRESH, "dead"),
);

describe("AC-STE-543.2 — recorded dead: required FAILS, informational NOTES", () => {
  test("the two fixtures differ in EXACTLY ONE line (the classification)", () => {
    // Guard the isolation itself: without this, a verdict flip could be caused
    // by some other edit that crept into one half.
    const diffs = differingLines(AC2_REQUIRED_BODY, AC2_INFORMATIONAL_BODY);
    expect(diffs.length).toBe(1);
    expect(diffs[0]).toContain("## Design References");
    expect(diffs[0]).toContain("## External References");
  });

  test("dead + REQUIRED (design section) ⇒ GATE FAILED", async () => {
    const fx = makeFixture("ac2-required");
    try {
      writeSpec(fx.root, "specs/frs/STE-543.md", AC2_REQUIRED_BODY);
      const report = await runExternalLinkVerdictsProbe(fx.root, NOW);
      expect(report.violations.length).toBe(1);
      const [v] = report.violations;
      expect(v!.severity).toBe("error");
      expect(v!.file).toBe("specs/frs/STE-543.md");
      expect(v!.message).toContain(DEAD_URL);
      // Zero notes rows for that link: a probe emitting BOTH would satisfy the
      // informational leg below by accident.
      expect(report.notes.filter((n) => n.includes(DEAD_URL)).length).toBe(0);
    } finally {
      fx.cleanup();
    }
  });

  test("dead + INFORMATIONAL (external section) ⇒ GATE PASSED WITH NOTES", async () => {
    const fx = makeFixture("ac2-informational");
    try {
      writeSpec(fx.root, "specs/frs/STE-543.md", AC2_INFORMATIONAL_BODY);
      const report = await runExternalLinkVerdictsProbe(fx.root, NOW);
      expect(report.violations).toEqual([]);
      const naming = report.notes.filter((n) => n.includes(DEAD_URL));
      expect(naming.length).toBe(1);
      expect(report.notes.length).toBe(1);
    } finally {
      fx.cleanup();
    }
  });
});

// ===========================================================================
// AC-STE-543.3 — NO RECORD AT ALL
// ===========================================================================

const UNRECORDED_URL = "https://example.invalid/never-checked";
const AC3_REQUIRED_BODY = oneSectionBody(
  "Design References",
  unrecordedRow(UNRECORDED_URL, "never checked"),
);
const AC3_INFORMATIONAL_BODY = oneSectionBody(
  "External References",
  unrecordedRow(UNRECORDED_URL, "never checked"),
);

describe("AC-STE-543.3 — no record: required FAILS (the check never ran)", () => {
  test("the two fixtures differ in EXACTLY ONE line (the classification)", () => {
    const diffs = differingLines(AC3_REQUIRED_BODY, AC3_INFORMATIONAL_BODY);
    expect(diffs.length).toBe(1);
    expect(diffs[0]).toContain("## Design References");
    expect(diffs[0]).toContain("## External References");
  });

  test("required + no record ⇒ one violation whose reason is DISTINCT from the dead-link reason", async () => {
    const missing = makeFixture("ac3-required");
    const dead = makeFixture("ac3-dead-comparand");
    try {
      writeSpec(missing.root, "specs/frs/STE-543.md", AC3_REQUIRED_BODY);
      const missingReport = await runExternalLinkVerdictsProbe(missing.root, NOW);
      expect(missingReport.violations.length).toBe(1);
      const mv = missingReport.violations[0]!;
      expect(mv.severity).toBe("error");
      expect(mv.message).toContain(UNRECORDED_URL);
      // The reason names the MISSING RECORD; the message says the check never ran.
      expect(mv.reason).toMatch(/record/i);
      expect(mv.message).toMatch(/never ran/i);

      // A single generic message would satisfy this leg AND AC.2's. Compare
      // the two reasons directly.
      writeSpec(dead.root, "specs/frs/STE-543.md", AC2_REQUIRED_BODY);
      const deadReport = await runExternalLinkVerdictsProbe(dead.root, NOW);
      expect(deadReport.violations.length).toBe(1);
      expect(mv.reason).not.toBe(deadReport.violations[0]!.reason);
    } finally {
      missing.cleanup();
      dead.cleanup();
    }
  });

  test("informational + no record ⇒ zero violations, exactly one note", async () => {
    const fx = makeFixture("ac3-informational");
    try {
      writeSpec(fx.root, "specs/frs/STE-543.md", AC3_INFORMATIONAL_BODY);
      const report = await runExternalLinkVerdictsProbe(fx.root, NOW);
      expect(report.violations).toEqual([]);
      expect(report.notes.length).toBe(1);
      expect(report.notes[0]).toContain(UNRECORDED_URL);
    } finally {
      fx.cleanup();
    }
  });
});

// ===========================================================================
// AC-STE-543.4 — TTL: staleness OUTRANKS classification
// ===========================================================================

describe("AC-STE-543.4 — a record older than the exported TTL is NOTES, never GATE FAILED", () => {
  test("the threshold is EXPORTED and is a positive number of days", () => {
    expect(typeof EXTERNAL_LINK_TTL_DAYS).toBe("number");
    expect(EXTERNAL_LINK_TTL_DAYS).toBeGreaterThan(0);
  });

  // Both halves use the SAME dead+required fixture, so the leg proves
  // staleness OUTRANKS classification rather than merely coinciding with an
  // already-clean row.
  const deadRequiredAged = (ageDays: number): string =>
    oneSectionBody(
      "Design References",
      recordedRow(DEAD_URL, "the vanished doc", daysBefore(ageDays), "dead"),
    );

  test("exactly EXTERNAL_LINK_TTL_DAYS old ⇒ STILL the violation", async () => {
    const fx = makeFixture("ac4-boundary-fresh");
    try {
      writeSpec(fx.root, "specs/frs/STE-543.md", deadRequiredAged(EXTERNAL_LINK_TTL_DAYS));
      const report = await runExternalLinkVerdictsProbe(fx.root, NOW);
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]!.severity).toBe("error");
    } finally {
      fx.cleanup();
    }
  });

  test("one day older ⇒ ZERO violations and one staleness note", async () => {
    const fx = makeFixture("ac4-boundary-stale");
    try {
      writeSpec(fx.root, "specs/frs/STE-543.md", deadRequiredAged(EXTERNAL_LINK_TTL_DAYS + 1));
      const report = await runExternalLinkVerdictsProbe(fx.root, NOW);
      expect(report.violations).toEqual([]);
      expect(report.notes.length).toBe(1);
      expect(report.notes[0]).toContain(DEAD_URL);
      expect(report.notes[0]).toMatch(/stale/i);
    } finally {
      fx.cleanup();
    }
  });

  test("`now` is INJECTED — a different clock moves the verdict", async () => {
    // A wall-clock probe passes today and rots silently. Same bytes on disk,
    // two clocks, two verdicts.
    const fx = makeFixture("ac4-injected-clock");
    try {
      writeSpec(fx.root, "specs/frs/STE-543.md", deadRequiredAged(EXTERNAL_LINK_TTL_DAYS));
      const atNow = await runExternalLinkVerdictsProbe(fx.root, NOW);
      const later = new Date(NOW.getTime() + 2 * DAY_MS);
      const atLater = await runExternalLinkVerdictsProbe(fx.root, later);
      expect(atNow.violations.length).toBe(1);
      expect(atLater.violations.length).toBe(0);
    } finally {
      fx.cleanup();
    }
  });
});

// ===========================================================================
// AC-STE-543.5 — the NFR-10 canonical shape
// ===========================================================================

describe("AC-STE-543.5 — every violation renders in the NFR-10 canonical shape", () => {
  test("note is `specs/…:<line> — reason`; message carries Remedy:, Context: and the URL", async () => {
    const fx = makeFixture("ac5-shape");
    try {
      writeSpec(fx.root, "specs/frs/STE-543.md", AC2_REQUIRED_BODY);
      const report = await runExternalLinkVerdictsProbe(fx.root, NOW);
      expect(report.violations.length).toBe(1);
      const v = report.violations[0]!;

      expect(v.note).toMatch(/^specs\/[^:]+:\d+ — /);
      expect(v.message).toContain("Remedy:");
      expect(v.message).toContain("Context:");
      expect(v.message).toContain(DEAD_URL);

      // The one-indexed line is the ROW's line, not the heading's and not 0.
      const rowLine = AC2_REQUIRED_BODY.split("\n").findIndex((l) => l.includes(DEAD_URL)) + 1;
      expect(rowLine).toBeGreaterThan(0);
      expect(v.line).toBe(rowLine);
      expect(v.note).toContain(`specs/frs/STE-543.md:${rowLine} — `);

      // RunnabilityDeclaredViolation-shaped: every key present.
      expect(Object.keys(v).sort()).toEqual(
        ["file", "line", "message", "note", "reason", "severity"],
      );
    } finally {
      fx.cleanup();
    }
  });

  test("ISOLATING HALF: two dead required links in different files ⇒ two DISTINCT renderings", async () => {
    // One message reused for both would pass a single-row assertion.
    const fx = makeFixture("ac5-two-files");
    try {
      const urlA = "https://example.invalid/alpha";
      const urlB = "https://example.invalid/beta";
      writeSpec(
        fx.root,
        "specs/frs/STE-001.md",
        oneSectionBody("Design References", recordedRow(urlA, "alpha", FRESH, "dead")),
      );
      writeSpec(
        fx.root,
        "specs/frs/STE-002.md",
        [
          "---",
          "title: fixture",
          "---",
          "",
          "# Fixture",
          "",
          "Extra prose so the row lands on a DIFFERENT line number.",
          "",
          "## Design References",
          "",
          recordedRow(urlB, "beta", FRESH, "dead"),
          "",
        ].join("\n"),
      );
      const report = await runExternalLinkVerdictsProbe(fx.root, NOW);
      expect(report.violations.length).toBe(2);

      const pairs = report.violations.map((v) => `${v.file}:${v.line}`);
      expect(new Set(pairs).size).toBe(2);
      expect(new Set(report.violations.map((v) => v.note)).size).toBe(2);
      expect(new Set(report.violations.map((v) => v.message)).size).toBe(2);

      const messages = report.violations.map((v) => v.message).join("\n");
      expect(messages).toContain(urlA);
      expect(messages).toContain(urlB);
      // Each message names its OWN url and not the other's.
      for (const v of report.violations) {
        const mine = v.file.endsWith("STE-001.md") ? urlA : urlB;
        const theirs = v.file.endsWith("STE-001.md") ? urlB : urlA;
        expect(v.message).toContain(mine);
        expect(v.message).not.toContain(theirs);
      }
    } finally {
      fx.cleanup();
    }
  });
});

// ===========================================================================
// AC-STE-543.6 — falsifiability by mutation of the rule table
// ===========================================================================

describe("AC-STE-543.6 — removing the dead-required rule turns the fixture green", () => {
  test("the mutant is COUNTED, not merely built — then it flips the verdict", async () => {
    // COUNTS, NOT PRESENCE (falsifiability_harness.ts rule 3): a filter that
    // matched nothing leaves this suite green and reads as a pass.
    const mutant = VERDICT_RULES.filter((r) => r.id !== "dead-required");
    expect(mutant.length).toBe(VERDICT_RULES.length - 1);
    expect(VERDICT_RULES.some((r) => r.id === "dead-required")).toBe(true);

    const fx = makeFixture("ac6-mutation");
    try {
      writeSpec(fx.root, "specs/frs/STE-543.md", AC2_REQUIRED_BODY);
      const live = await runExternalLinkVerdictsProbe(fx.root, NOW, VERDICT_RULES);
      const mutated = await runExternalLinkVerdictsProbe(fx.root, NOW, mutant);
      expect(live.violations.length).toBe(1);
      expect(mutated.violations.length).toBe(0);
    } finally {
      fx.cleanup();
    }
  });

  test("the rule table is a defaulted THIRD parameter — omitting it uses VERDICT_RULES", async () => {
    // Mirrors `runUpgradeStalenessProbe(projectRoot, registry)` where the
    // registry is defaulted last (upgrade_staleness.ts).
    const fx = makeFixture("ac6-default-arg");
    try {
      writeSpec(fx.root, "specs/frs/STE-543.md", AC2_REQUIRED_BODY);
      const defaulted = await runExternalLinkVerdictsProbe(fx.root, NOW);
      const explicit = await runExternalLinkVerdictsProbe(fx.root, NOW, VERDICT_RULES);
      expect(defaulted).toEqual(explicit);
      expect(defaulted.violations.length).toBe(1);
    } finally {
      fx.cleanup();
    }
  });
});

// ===========================================================================
// AC-STE-543.7 — vacuity, WITH its positive control
// ===========================================================================

describe("AC-STE-543.7 — vacuous where neither reference section exists", () => {
  test("a spec tree with neither section is vacuous — and ADDING one flips it", async () => {
    const fx = makeFixture("ac7-vacuous");
    try {
      writeSpec(
        fx.root,
        "specs/frs/STE-543.md",
        ["# Fixture", "", "## Summary", "", "No references here at all.", ""].join("\n"),
      );
      const report = await runExternalLinkVerdictsProbe(fx.root, NOW);
      expect(report).toEqual({ violations: [], notes: [], vacuous: true });

      // POSITIVE CONTROL, same test: `vacuous: true` is a MEASURED state, not
      // a scan that silently found nothing.
      writeSpec(
        fx.root,
        "specs/frs/STE-543.md",
        [
          "# Fixture",
          "",
          "## External References",
          "",
          recordedRow("https://example.invalid/added", "added", FRESH, "dead"),
          "",
        ].join("\n"),
      );
      const flipped = await runExternalLinkVerdictsProbe(fx.root, NOW);
      expect(flipped.vacuous).toBe(false);
      expect(flipped.violations.length + flipped.notes.length).toBeGreaterThanOrEqual(1);
    } finally {
      fx.cleanup();
    }
  });

  test("an absent specs/ directory is vacuous and does not throw", async () => {
    const fx = makeFixture("ac7-nospecs");
    try {
      expect(existsSync(join(fx.root, "specs"))).toBe(false);
      const report = await runExternalLinkVerdictsProbe(fx.root, NOW);
      expect(report).toEqual({ violations: [], notes: [], vacuous: true });
    } finally {
      fx.cleanup();
    }
  });

  test("THIS repository is vacuous today — the state at which the probe ships", async () => {
    const report = await runExternalLinkVerdictsProbe(REPO_ROOT, NOW);
    expect({ violations: report.violations, vacuous: report.vacuous }).toEqual({
      violations: [],
      vacuous: true,
    });
  });
});

// ===========================================================================
// AC-STE-543.8 — the probe-count cascade, edited BY SUBJECT and never by digit
// ===========================================================================
//
// MEASURED TODAY, and every one located BY GREPPING THE ASSERTION TEXT rather
// than by line number — AC-STE-543.8 exists precisely to forbid digit-wise
// editing, and the FR's own cited line numbers are stale by +4:
//
//   tests/m137-ste-533-stage-block-adoption.test.ts
//     `Array.from({ length: 82 }, …)`      FR says :2053 — REALLY :2061  → 83
//     `expect(mine[0]!.number).toBe(82);`  FR says :2058 — REALLY :2066  → STAYS 82
//     `const STALE_PROBE_COUNT = 81;`      FR says :2359 — REALLY :2367  → 82
//     `expect(live).toBe(82);`             FR says :2372 — REALLY :2380  → 83
//     `expect(PROBE_COUNT_PINS.length)…40` FR says :2393 — REALLY :2401  → unchanged
//
// The FOURTH 82 is `stage_block_adoption`'s OWN probe number, not a count. A
// sweep of that file is the failure mode this leg exists to catch.

const M137_ADOPTION_TEST_REL = "tests/m137-ste-533-stage-block-adoption.test.ts";

/**
 * The count these pins read BEFORE probe #83 — the number that must be gone.
 *
 * REPAIRED, NOT INHERITED: M137 shipped `STALE_PROBE_COUNT = 81` while the
 * live count was already 82, so its staleness half could never fail again.
 * That file is repointed to 82 as part of this change (asserted below) and
 * this table starts at the count it is actually replacing.
 */
const STALE_PROBE_COUNT = 82;
/** The count after this FR registers `external_link_verdicts`. */
const NEW_PROBE_COUNT = 83;

/**
 * Every surface carrying the probe count, as `[repo-relative-or-plugin-relative
 * path, template]`. `{N}` is the count. The M137 shape, verbatim, plus the two
 * rows for M137's OWN suite that nothing previously pinned.
 */
const PINS: readonly (readonly [string, string])[] = [
  ["README.md", "{N} numbered `/gate-check` probes"],
  ["README.md", String.raw`layers {N} probes`],

  ["tests/gate-check-active-plan-ship-ready.test.ts", String.raw`contiguous 1..{N}`],
  ["tests/gate-check-active-plan-ship-ready.test.ts", String.raw`expect(numbers.length).toBe({N});`],
  ["tests/gate-check-active-plan-ship-ready.test.ts", String.raw`Array.from({ length: {N} }, (_, i) => i + 1)`],

  ["tests/gate-check-best-practices-manifest-hygiene.test.ts", String.raw`contiguous 1..{N}`],
  ["tests/gate-check-best-practices-manifest-hygiene.test.ts", String.raw`expect(numbers.length).toBe({N});`],
  ["tests/gate-check-best-practices-manifest-hygiene.test.ts", String.raw`Array.from({ length: {N} }, (_, i) => i + 1)`],

  ["tests/gate-check-claudemd-probe-managed-guard.test.ts", String.raw`README documents {N} probes`],
  ["tests/gate-check-claudemd-probe-managed-guard.test.ts", String.raw`documents {N} numbered /gate-check probes`],
  ["tests/gate-check-claudemd-probe-managed-guard.test.ts", String.raw`\b{N}\b.*numbered`],
  ["tests/gate-check-claudemd-probe-managed-guard.test.ts", String.raw`\b{N}\b\s+probes`],

  ["tests/gate-check-public-surface-count-drift.test.ts", String.raw`\b{N}\b.*numbered`],
  ["tests/gate-check-public-surface-count-drift.test.ts", String.raw`\b{N}\b\s+probes`],

  ["tests/gate-check-runnability-declared.test.ts", String.raw`contiguous 1..{N}`],
  ["tests/gate-check-runnability-declared.test.ts", String.raw`expect(numbers.length).toBe({N});`],
  ["tests/gate-check-runnability-declared.test.ts", String.raw`Array.from({ length: {N} }, (_, i) => i + 1)`],
  ["tests/gate-check-runnability-declared.test.ts", String.raw`expect(Math.max(...numbers)).toBe({N});`],

  ["tests/gate-check-spec-write-next-line-doc.test.ts", String.raw`"{N} numbered"`],
  ["tests/gate-check-spec-write-next-line-doc.test.ts", String.raw`layers {N} probes`],
  ["tests/gate-check-spec-write-next-line-doc.test.ts", String.raw`expect(Math.max(...numbers)).toBe({N});`],
  ["tests/gate-check-spec-write-next-line-doc.test.ts", String.raw`expect(Number(counted![1])).toBe({N});`],

  ["tests/gate-check-upgrade-staleness.test.ts", String.raw`expect(Math.max(...numbers)).toBe({N});`],
  ["tests/gate-check-upgrade-staleness.test.ts", String.raw`expect(numbers.length).toBe({N});`],

  ["tests/m108-ste-393-docs-pins.test.ts", String.raw`\b{N}\b\s+numbered`],
  ["tests/m108-ste-393-docs-pins.test.ts", String.raw`layers {N} probes`],

  ["tests/m109-ste-394-docs-pins.test.ts", String.raw`\b{N}\b\s+numbered`],
  ["tests/m109-ste-394-docs-pins.test.ts", String.raw`layers {N} probes`],
  ["tests/m109-ste-394-docs-pins.test.ts", String.raw`expect(Math.max(...numbers)).toBe({N});`],
  ["tests/m109-ste-394-docs-pins.test.ts", String.raw`"{N} numbered"`],
  ["tests/m109-ste-394-docs-pins.test.ts", String.raw`toBe({N})`],
  ["tests/m109-ste-394-docs-pins.test.ts", String.raw`\\b{N}\\b\\s+probes`],

  ["tests/m115-ste-417-docs-pins.test.ts", String.raw`\b{N}\b\s+numbered`],
  ["tests/m115-ste-417-docs-pins.test.ts", String.raw`layers {N} probes`],
  ["tests/m115-ste-417-docs-pins.test.ts", String.raw`expect(Math.max(...numbers)).toBe({N});`],
  ["tests/m115-ste-417-docs-pins.test.ts", String.raw`expect(numbers.length).toBe({N});`],

  ["tests/m116-ste-424-short-ulid-collision.test.ts", String.raw`exactly {N} probes`],
  ["tests/m116-ste-424-short-ulid-collision.test.ts", String.raw`expect(numbers.length).toBe({N});`],
  ["tests/m116-ste-424-short-ulid-collision.test.ts", String.raw`expect(Math.max(...numbers)).toBe({N});`],

  ["tests/m120-ste-443-jira-plan-provenance.test.ts", String.raw`expect(Math.max(...numbers)).toBe({N});`],
  ["tests/m120-ste-443-jira-plan-provenance.test.ts", String.raw`expect(numbers.length).toBe({N});`],
  ["tests/m120-ste-443-jira-plan-provenance.test.ts", String.raw`\b{N}\b.*numbered`],
  ["tests/m120-ste-443-jira-plan-provenance.test.ts", String.raw`\b{N}\b\s+probes`],

  ["tests/m137-ste-534-fr-word-caps.test.ts", "{N} numbered `/gate-check` probes"],
  ["tests/m137-ste-534-fr-word-caps.test.ts", String.raw`expect(Math.max(...numbers)).toBe({N});`],

  ["tests/m137-ste-535-plan-narrative-cap.test.ts", "{N} numbered `/gate-check` probes"],
  ["tests/m137-ste-535-plan-narrative-cap.test.ts", String.raw`expect(Math.max(...numbers)).toBe({N});`],

  // M137's own cascade table, which nothing previously pinned.
  [M137_ADOPTION_TEST_REL, String.raw`Array.from({ length: {N} }, (_, i) => i + 1)`],
  [M137_ADOPTION_TEST_REL, String.raw`expect(live).toBe({N});`],
] as const;

const fill = (template: string, n: number): string =>
  template.split("{N}").join(String(n));

const surfaceAbs = (rel: string): string =>
  rel === "README.md" ? README : join(PLUGIN_ROOT, ...rel.split("/"));

const surfaceBody = (rel: string): string => read(surfaceAbs(rel));

/** The numbered `/gate-check` probe registrations, in order. House idiom. */
function probeRegistrationLines(): { number: number; line: string }[] {
  return read(GATE_CHECK_SKILL)
    .split("\n")
    .flatMap((line) => {
      const m = /^(\d+)\. \*\*/.exec(line);
      return m === null ? [] : [{ number: Number(m[1]), line }];
    });
}

/** The live count, RE-DERIVED off the shipped registry — never hand-typed. */
const liveProbeCount = (): number => probeRegistrationLines().length;

/**
 * LOCAL copy of the `onlyLine` uniqueness helper. It is unexported and already
 * copied privately in five suites (incl.
 * `tests/gate-check-public-surface-count-drift.test.ts:49`), so it cannot be
 * imported. Returns the line AND its 1-indexed position.
 */
function onlyLine(body: string, anchor: RegExp): { line: string; number: number } {
  const hits = body
    .split("\n")
    .map((line, i) => ({ line, number: i + 1 }))
    .filter((h) => anchor.test(h.line));
  if (hits.length !== 1) {
    throw new Error(`expected exactly 1 line matching ${anchor}, found ${hits.length}`);
  }
  return hits[0]!;
}

describe("AC-STE-543.8 — the probe-count cascade moved as one", () => {
  test("the live count is 83 and the numbers are contiguous 1..83", () => {
    const registrations = probeRegistrationLines();
    expect(liveProbeCount()).toBe(NEW_PROBE_COUNT);
    expect(registrations.map((r) => r.number)).toEqual(
      Array.from({ length: NEW_PROBE_COUNT }, (_, i) => i + 1),
    );
  });

  test("EVERY enumerated pin reads the live count — none left behind", () => {
    const live = liveProbeCount();
    const missing: string[] = [];
    const stale: string[] = [];
    for (const [rel, template] of PINS) {
      const body = surfaceBody(rel);
      if (!body.includes(fill(template, live))) {
        missing.push(`${rel} — ${fill(template, live)}`);
      }
      if (body.includes(fill(template, STALE_PROBE_COUNT))) {
        stale.push(`${rel} — ${fill(template, STALE_PROBE_COUNT)}`);
      }
    }
    // ANTI-VACUITY: an empty table reports a clean cascade by moving nothing.
    // Deliberately above the shipped `>= 40`, which 47 rows already cleared.
    expect(PINS.length).toBeGreaterThanOrEqual(44);
    expect({ missing, stale }).toEqual({ missing: [], stale: [] });
  });

  test("every named surface EXISTS — a pin on a deleted file is not a pin", () => {
    for (const [rel] of PINS) {
      expect({ rel, exists: existsSync(surfaceAbs(rel)) }).toEqual({ rel, exists: true });
    }
  });

  test("README's TWO pins read 83, each on its own unique measured line", () => {
    const readme = read(README);
    const gates = onlyLine(readme, /numbered `\/gate-check` probes/);
    expect(gates.number).toBe(14);
    expect(gates.line).toContain(`${NEW_PROBE_COUNT} numbered \`/gate-check\` probes`);

    const layers = onlyLine(readme, /which layers \d+ probes on top/);
    expect(layers.number).toBe(109);
    expect(layers.line).toContain(`layers ${NEW_PROBE_COUNT} probes`);
  });

  test("REPAIR FIRST: M137's dead staleness half is repointed, its OWN probe number is NOT", () => {
    const body = read(join(PLUGIN_ROOT, ...M137_ADOPTION_TEST_REL.split("/")));

    // The staleness half was frozen at 81 while live was already 82 — a count
    // assertion that could never fail. Repaired to 82 as part of this change.
    expect(body).toContain("const STALE_PROBE_COUNT = 82;");
    expect(body).not.toContain("const STALE_PROBE_COUNT = 81;");

    // THE FOURTH 82 SURVIVES UNMOVED: `stage_block_adoption`'s own probe
    // number is not a count, and a digit-wise sweep of this file is exactly
    // the regression AC-STE-543.8 forbids.
    expect(body).toContain("expect(mine[0]!.number).toBe(82);");
    expect(body).not.toContain("expect(mine[0]!.number).toBe(83);");

    // The anti-vacuity floor there is untouched.
    expect(body).toContain("expect(PROBE_COUNT_PINS.length).toBeGreaterThanOrEqual(40);");
  });

  test("ISOLATING HALF: deliberately frozen NON-probe numbers survive the cascade", () => {
    // Proof the edit was by subject, not by digit.
    const retirement = read(join(PLUGIN_ROOT, "tests", "gate-check-active-plan-ship-ready.test.ts"));
    expect(retirement).toContain("`74 numbered`");

    const drift = read(join(PLUGIN_ROOT, "tests", "gate-check-public-surface-count-drift.test.ts"));
    expect(drift).toContain("42 numbered `/gate-check` probes");

    const wordCaps = read(join(PLUGIN_ROOT, "tests", "m137-ste-534-fr-word-caps.test.ts"));
    // An 81-WORD count, not a probe count.
    expect(wordCaps).toContain("expect(countWords(overBody.join(\"\\n\"))).toBe(81);");
  });

  test("the registration itself carries the house shape", () => {
    const registrations = probeRegistrationLines();
    const mine = registrations.filter((r) => r.line.includes(`\`${PROBE_ID}\``));
    expect(mine.length).toBe(1);
    expect(mine[0]!.number).toBe(NEW_PROBE_COUNT);
    expect(mine[0]!.line).toContain("**Severity: error**");
    expect(mine[0]!.line).toContain("runExternalLinkVerdictsProbe(projectRoot)");
    expect(mine[0]!.line).toContain(MODULE_REL);
    expect(mine[0]!.line).toContain(TEST_FILE_REL);
  });

  test("the UNPINNED prose at SKILL.md:245 now names probe #83", () => {
    // `PROBE_COUNT_PINS` has no SKILL.md row, so nothing else would catch it.
    const skill = read(GATE_CHECK_SKILL);
    expect(skill).toContain("registering probe #83 will turn probe #81 red");
    expect(skill).not.toContain("registering probe #82 will turn probe #81 red");
  });

  test("gate-check SKILL.md stays within the NFR-1 line cap (358)", () => {
    // NFR-1 is 358 — specs/requirements.md:17, and the number the seven
    // sibling `const SKILL_LINE_CAP = 358;` declarations enforce. This leg
    // originally pinned 354 while CALLING it the NFR-1 cap: 354 is a
    // superseded historical value (351 → 352 under STE-373 → 354 under
    // STE-374 → 358), so the pin was four lines tighter than the shipped
    // contract and would have redded a legitimate future registration while
    // citing an NFR that permits it. Measured 352 at HEAD, 354 after this
    // FR's registration row.
    const SKILL_LINE_CAP = 358;
    expect(read(GATE_CHECK_SKILL).split("\n").length).toBeLessThanOrEqual(
      SKILL_LINE_CAP,
    );
  });

  test("the new module carries an `import.meta.main` front door", () => {
    expect(read(MODULE_ABS)).toContain("import.meta.main");
  });

  test("probe #81 stays clean: the pin LOWERED and the probe actually RAN", async () => {
    // `runModuleReachabilityProbe` is async — an unawaited Promise makes any
    // assertion on `.violations` pass vacuously.
    const report = await runModuleReachabilityProbe(REPO_ROOT);
    // The FR predicted the pin would sit unmoved at 131. Both halves of that
    // were wrong: it stood at 130 entering M140 (M139/STE-541 lowered it), and
    // this FR lowers it again. The FR mandates BOTH a shared row parser
    // ("never a reader-side copy") and an `import.meta.main` front door; those
    // two together necessarily make `scan_design_references.ts` reachable, so
    // the count MUST fall. Freezing the pin and satisfying the FR are mutually
    // exclusive — see the rationale block on the constant itself.
    expect(ORDERED_UNREACHABLE_PIN).toBe(129);
    // Direction is the real invariant: this pin has never been raised.
    expect(ORDERED_UNREACHABLE_PIN).toBeLessThan(PIN_ENTERING_M140);
    // BOTH halves: the pin alone is satisfied by a probe that never ran.
    expect(report.orderedUnreachable).toBe(ORDERED_UNREACHABLE_PIN);
    expect(report.ok).toBe(true);
    // NOT `violations).toEqual([])`, which is unsatisfiable by construction:
    // at the pinned count with a non-zero count the probe ALWAYS pushes one
    // warning-severity catalogue row (module_reachability.ts:553-575) and
    // still returns ok — the "catalogued, not failed" design. "Clean" here
    // means no ERROR row, which is what actually distinguishes a clean run.
    expect(report.violations.filter((v) => v.severity === "error")).toEqual([]);
    expect(report.violations.every((v) => v.severity === "warning")).toBe(true);
    // Anti-vacuity for the two clauses above: `.every` is true on an empty
    // array, so pin the catalogue row's presence rather than inferring it.
    expect(report.violations.length).toBe(1);
    // Anti-vacuity: the walk really found references to classify.
    expect(report.records.length).toBeGreaterThan(0);
  });
});
