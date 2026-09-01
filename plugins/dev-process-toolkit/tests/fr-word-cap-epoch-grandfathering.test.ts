// PR #76 adversarial review, finding F11 — the FR word caps STE-534 added to
// probe #67 are RETROACTIVE, error-severity, and grandfathered by NOTHING.
//
// RED-state until the epoch arm lands in:
//   plugins/dev-process-toolkit/adapters/_shared/src/scan_fr_summary_altitude.ts
//
// THE MEASUREMENT (2026-09-01, against v2.75.0 — reproduced by this file, not
// quoted from the review): copying this repository's own
// `specs/frs/archive/*.md` into an ACTIVE `specs/frs/` and running the shipped
// scanner yields 638 `word_cap` violations across 320 of 447 files, and ZERO
// violations of the four PRE-EXISTING rules. A consumer sitting on v2.74.0
// with 20 active FRs installs v2.75.0, touches nothing, and `/gate-check`
// flips PASSED → FAILED on prose they never wrote. `specs/plan/archive/M137.md`
// declares `migration: none`, so `/upgrade` offers them nothing either.
//
// This repository escaped only because it currently has ZERO active FRs —
// exactly the vacuity that hid the defect.
//
// "The tightening IS the milestone" is true and does not settle it: deliberate
// and safe-to-ship-to-consumers are different questions.
//
// THE SHIPPED PRECEDENT, followed rather than invented — probe #73
// `plan_identity_mode_conditional` grandfathers by GIT PROVENANCE against a
// dated epoch (`MINT_EPOCH`, `JIRA_EPIC_EPOCH`): anything git says was
// introduced BEFORE the epoch is legacy and silent, anything introduced AT or
// AFTER it is graded, a tree that is not a git repository at all is legacy
// (there is no provenance to read and failing there would BE the forced
// migration the design exists to avoid), and an unreachable introducing commit
// degrades to a warning-severity ADVISORY rather than a hard failure the
// operator cannot act on. Probe #68 grandfathers pre-epoch archived plans and
// TALLIES them into a visible NOTES row rather than skipping them silently.
//
// CONTRACT PINNED HERE (the shape the implementer must build):
//
//   /** Midnight UTC on the ship date of the release that made the caps policy. */
//   export const FR_WORD_CAP_EPOCH: string;
//
//   export type FrProvenanceClass = "fresh" | "legacy" | "undecidable";
//
//   export function classifyFrProvenance(
//     projectRoot: string,
//     frPath: string,
//     epoch?: string,          // defaults to FR_WORD_CAP_EPOCH itself, never a copy
//   ): FrProvenanceClass;
//
//   export interface FrAltitudeViolationRow extends FrSummaryAltitudeViolation {
//     severity: "error" | "warning";
//   }
//   export interface FrSummaryAltitudeReport {
//     violations: FrAltitudeViolationRow[];
//     /** Repo-relative FR paths whose word_cap rows were spared. Visible, never silent. */
//     grandfathered: string[];
//     vacuous: boolean;
//   }
//   export function runFrSummaryAltitudeProbe(
//     projectRoot: string,
//     sectionRules?: readonly SectionRuleSpec[],
//   ): FrSummaryAltitudeReport;
//
// TWO PROPERTIES ARE LOAD-BEARING AND PULL IN OPPOSITE DIRECTIONS:
//
//   1. The GRANDFATHERING covers `word_cap` ALONE. The four prose rules
//      (line_cap / backtick / ac_id / path_token) are NOT new — they shipped in
//      M105 and every consumer already passes them — so an epoch that silenced
//      them would retire four working rules under cover of fixing one. Their
//      severity stays `error` under every provenance class.
//
//   2. `scanFrSummaryAltitude` is UNCHANGED. It is the pure content scanner
//      three sibling suites already pin on non-git temp fixtures; the
//      grandfathering is a PROBE-LEVEL arm layered over it, exactly as probe
//      #73 layers `classifyPlanProvenance` over its own walk. Nothing below is
//      allowed to make an existing assertion about the raw scanner false — and
//      the raw-scanner leg in `MEASURED POPULATION` below asserts that in the
//      one place it would matter most.
//
// FIXTURES ARE REAL GIT REPOSITORIES, following
// `tests/m119-ste-441-plan-provenance.test.ts`. A mock cannot exercise a
// provenance signal: the whole point is that the answer comes from git.

import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  FR_WORD_CAP_EPOCH,
  NOTES_WORD_CAP,
  SECTION_RULES,
  SUMMARY_WORD_CAP,
  TECHNICAL_DESIGN_WORD_CAP,
  classifyFrProvenance,
  runFrSummaryAltitudeProbe,
  scanFrSummaryAltitude,
  type FrProvenanceClass,
} from "../adapters/_shared/src/scan_fr_summary_altitude";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const SCANNER_SRC = join(
  PLUGIN_ROOT,
  "adapters",
  "_shared",
  "src",
  "scan_fr_summary_altitude.ts",
);
const GATE_CHECK_SKILL = join(PLUGIN_ROOT, "skills", "gate-check", "SKILL.md");
const CHANGELOG = join(REPO_ROOT, "CHANGELOG.md");
const ARCHIVE_FRS = join(REPO_ROOT, "specs", "frs", "archive");

const read = (path: string): string => readFileSync(path, "utf-8");

/** The complete provenance vocabulary. Exactly three labels. */
const CLASSES = ["fresh", "legacy", "undecidable"] as const;

/** The labels that spare `word_cap` outright — no row of any severity. */
const SILENT_CLASSES: readonly FrProvenanceClass[] = ["legacy"];

// ───────────────────────────────────────────────────────────────────────────
// Fixture plumbing — real temporary git repositories
// ───────────────────────────────────────────────────────────────────────────

/**
 * Run git inside `root` with the ambient user configuration neutralised, so a
 * developer's global `commit.gpgsign`, `core.hooksPath` or `init.templateDir`
 * cannot make these fixtures pass or fail for reasons unrelated to the probe.
 */
function git(
  root: string,
  args: string[],
  extraEnv: Record<string, string> = {},
): string {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
      GIT_TERMINAL_PROMPT: "0",
      ...extraEnv,
    },
  });
}

function commitAt(root: string, iso: string, message: string): void {
  git(root, ["commit", "-q", "-m", message], {
    GIT_AUTHOR_DATE: iso,
    GIT_COMMITTER_DATE: iso,
  });
}

// Straddling instants, all derived from the shipped constant so a changed
// epoch moves the whole fixture set with it rather than leaving stale literals.
const epochMs = (): number => Date.parse(FR_WORD_CAP_EPOCH);
const isoAt = (ms: number): string => new Date(ms).toISOString();
const ONE_SECOND = 1000;
const ONE_YEAR = 365 * 24 * 60 * 60 * 1000;

interface Project {
  root: string;
  cleanup: () => void;
}

interface FrFixture {
  /** Basename, e.g. `01K-over-cap.md`. */
  name: string;
  /** Full file bytes. */
  body: string;
  /** Author date of the commit that introduces it. Omit to leave it untracked. */
  committedAt?: string;
  /** Add to the index without committing. */
  staged?: boolean;
}

/** An FR whose `## Summary` body blows the shipped 80-word cap and nothing else. */
function overCapFr(stem: string, words = SUMMARY_WORD_CAP + 40): string {
  return [
    "---",
    `id: ${stem}`,
    "status: active",
    "---",
    "",
    `# ${stem}`,
    "",
    "## Summary",
    "",
    Array.from({ length: words }, (_, i) => `word${i}`).join(" "),
    "",
  ].join("\n");
}

/** An FR whose `## Summary` sits comfortably under every rule. */
function cleanFr(stem: string): string {
  return [
    "---",
    `id: ${stem}`,
    "status: active",
    "---",
    "",
    `# ${stem}`,
    "",
    "## Summary",
    "",
    "A short and entirely unremarkable summary sentence.",
    "",
  ].join("\n");
}

/**
 * An FR that breaks a PRE-EXISTING rule and nothing else: a backtick in the
 * summary body, well under the word cap.
 */
function backtickFr(stem: string): string {
  return [
    "---",
    `id: ${stem}`,
    "status: active",
    "---",
    "",
    `# ${stem}`,
    "",
    "## Summary",
    "",
    "This summary names `a backtick token`, which rule two forbids.",
    "",
  ].join("\n");
}

function makeProject(opts: { git?: boolean; frs: FrFixture[] }): Project {
  const useGit = opts.git ?? true;
  const root = mkdtempSync(join(tmpdir(), "fr-word-cap-epoch-"));
  mkdirSync(join(root, "specs", "frs", "archive"), { recursive: true });
  writeFileSync(join(root, "README.md"), "# Fixture project\n");

  if (useGit) {
    git(root, ["init", "-q", "."]);
    git(root, ["config", "user.email", "fixture@example.invalid"]);
    git(root, ["config", "user.name", "Fixture"]);
    git(root, ["config", "commit.gpgsign", "false"]);
    git(root, ["add", "--", "README.md"]);
    commitAt(root, isoAt(epochMs() - ONE_YEAR), "chore: fixture base");
  }

  for (const fr of opts.frs) {
    const rel = `specs/frs/${fr.name}`;
    writeFileSync(join(root, rel), fr.body);
    if (!useGit) continue;
    if (fr.committedAt !== undefined) {
      git(root, ["add", "--", rel]);
      commitAt(root, fr.committedAt, `chore: add ${fr.name}`);
    } else if (fr.staged === true) {
      git(root, ["add", "--", rel]);
    }
  }

  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/**
 * Make an FR's introducing commit undiscoverable while the FR stays tracked in
 * HEAD — a severed / pruned object store. The M119 note applies verbatim: this
 * is NOT the shallow-clone condition, which answers with a boundary commit
 * rather than failing.
 */
function severIntroducingCommit(root: string, rel: string): void {
  writeFileSync(join(root, "README.md"), "# Fixture project\n\nTrailing.\n");
  git(root, ["add", "--", "README.md"]);
  commitAt(root, isoAt(epochMs() + ONE_SECOND), "chore: trailing");

  const sha = git(root, [
    "log",
    "--diff-filter=A",
    "-1",
    "--format=%H",
    "--",
    rel,
  ]).trim();
  if (sha.length !== 40) {
    throw new Error(`fixture bug: no introducing commit to sever for ${rel}`);
  }
  const objectPath = join(root, ".git", "objects", sha.slice(0, 2), sha.slice(2));
  if (!existsSync(objectPath)) {
    throw new Error(`fixture bug: loose object for ${sha} not found`);
  }
  rmSync(objectPath);
}

const wordCapRows = (rows: readonly { rule: string }[]): typeof rows =>
  rows.filter((r) => r.rule === "word_cap");

const frPath = (root: string, name: string): string =>
  join(root, "specs", "frs", name);

// ═══════════════════════════════════════════════════════════════════════════
// 1. THE EPOCH IS A NAMED CONSTANT, DATED TO THE RELEASE THAT MADE THE POLICY
// ═══════════════════════════════════════════════════════════════════════════

describe("F11.1 — the epoch is a named constant, not a scattered literal", () => {
  test("FR_WORD_CAP_EPOCH is an exported, parseable ISO-8601 UTC instant", () => {
    expect(typeof FR_WORD_CAP_EPOCH).toBe("string");
    expect(FR_WORD_CAP_EPOCH).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00Z$/);
    expect(Number.isNaN(Date.parse(FR_WORD_CAP_EPOCH))).toBe(false);
  });

  test("it is MIDNIGHT UTC on the ship date of the release that made the caps policy", () => {
    // DERIVED from the CHANGELOG, never retyped here. STE-534 (the word caps)
    // shipped in v2.75.0; the epoch is the instant that release made the rules
    // policy, in the `SHIP_DATE_CUTOFF` shape probe #73's two epochs use.
    const heading = read(CHANGELOG)
      .split("\n")
      .find((line) => /^## \[2\.75\.0\]/.test(line));
    expect(heading).toBeDefined();
    const date = heading!.match(/(\d{4}-\d{2}-\d{2})/);
    expect(date).not.toBeNull();
    expect(FR_WORD_CAP_EPOCH).toBe(`${date![1]}T00:00:00Z`);
  });

  test("the literal is written down ONCE in the scanner source", () => {
    const src = read(SCANNER_SRC);
    const literal = FR_WORD_CAP_EPOCH;
    // Exactly one occurrence: the `export const` itself. A second copy is the
    // drift the `MINT_EPOCH` default-argument note exists to forbid.
    expect(src.split(literal).length - 1).toBe(1);
    expect(src).toMatch(
      new RegExp(`export const FR_WORD_CAP_EPOCH\\s*(?::[^=]+)?=\\s*["']${literal}["']`),
    );
  });

  test("classifyFrProvenance takes the epoch as a DEFAULTED parameter bound to the constant", () => {
    const fx = makeProject({
      frs: [
        {
          name: "straddler.md",
          body: overCapFr("straddler"),
          committedAt: isoAt(epochMs() - ONE_SECOND),
        },
      ],
    });
    try {
      const p = frPath(fx.root, "straddler.md");
      // Omitting the argument and passing the constant must agree — the
      // default IS the constant, not a second literal that can drift.
      expect(classifyFrProvenance(fx.root, p)).toBe(
        classifyFrProvenance(fx.root, p, FR_WORD_CAP_EPOCH),
      );
      // …and the parameter genuinely moves the boundary, so it is a real
      // parameter rather than an ignored one.
      expect(classifyFrProvenance(fx.root, p)).toBe("legacy");
      expect(
        classifyFrProvenance(fx.root, p, isoAt(epochMs() - ONE_YEAR)),
      ).toBe("fresh");
    } finally {
      fx.cleanup();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. THE FOUR-WAY... THREE-WAY CLASSIFICATION, STRADDLING THE EPOCH
// ═══════════════════════════════════════════════════════════════════════════

describe("F11.2 — git provenance decides, and the boundary is inclusive", () => {
  test("an FR introduced BEFORE the epoch classifies legacy", () => {
    const fx = makeProject({
      frs: [
        {
          name: "old.md",
          body: overCapFr("old"),
          committedAt: isoAt(epochMs() - ONE_SECOND),
        },
      ],
    });
    try {
      expect(classifyFrProvenance(fx.root, frPath(fx.root, "old.md"))).toBe("legacy");
    } finally {
      fx.cleanup();
    }
  });

  test("an FR introduced AT the epoch instant classifies fresh — inclusive at the boundary", () => {
    const fx = makeProject({
      frs: [
        { name: "at.md", body: overCapFr("at"), committedAt: FR_WORD_CAP_EPOCH },
      ],
    });
    try {
      expect(classifyFrProvenance(fx.root, frPath(fx.root, "at.md"))).toBe("fresh");
    } finally {
      fx.cleanup();
    }
  });

  test("an FR introduced AFTER the epoch classifies fresh", () => {
    const fx = makeProject({
      frs: [
        {
          name: "new.md",
          body: overCapFr("new"),
          committedAt: isoAt(epochMs() + ONE_SECOND),
        },
      ],
    });
    try {
      expect(classifyFrProvenance(fx.root, frPath(fx.root, "new.md"))).toBe("fresh");
    } finally {
      fx.cleanup();
    }
  });

  test("an UNTRACKED FR classifies fresh — git cannot predate what it has never seen", () => {
    const fx = makeProject({ frs: [{ name: "untracked.md", body: overCapFr("u") }] });
    try {
      expect(classifyFrProvenance(fx.root, frPath(fx.root, "untracked.md"))).toBe(
        "fresh",
      );
    } finally {
      fx.cleanup();
    }
  });

  test("a STAGED-but-never-committed FR classifies fresh, not undecidable", () => {
    // THE discriminator probe #73 records: staged-and-never-committed and
    // severed-history read identically on `ls-files` and `--diff-filter=A`.
    // Only `HEAD:<path>` parts them.
    const fx = makeProject({
      frs: [{ name: "staged.md", body: overCapFr("s"), staged: true }],
    });
    try {
      expect(classifyFrProvenance(fx.root, frPath(fx.root, "staged.md"))).toBe(
        "fresh",
      );
    } finally {
      fx.cleanup();
    }
  });

  test("a tree that is NOT a git repository classifies legacy — there is no provenance to read", () => {
    // Failing here would BE the forced migration this design exists to avoid,
    // and it is the disposition probe #73 chose for the same condition.
    const fx = makeProject({
      git: false,
      frs: [{ name: "nogit.md", body: overCapFr("n") }],
    });
    try {
      expect(classifyFrProvenance(fx.root, frPath(fx.root, "nogit.md"))).toBe(
        "legacy",
      );
    } finally {
      fx.cleanup();
    }
  });

  test("a severed introducing commit degrades to undecidable, never to fresh", () => {
    const fx = makeProject({
      frs: [
        {
          name: "severed.md",
          body: overCapFr("severed"),
          committedAt: isoAt(epochMs() - ONE_YEAR),
        },
      ],
    });
    try {
      severIntroducingCommit(fx.root, "specs/frs/severed.md");
      expect(classifyFrProvenance(fx.root, frPath(fx.root, "severed.md"))).toBe(
        "undecidable",
      );
    } finally {
      fx.cleanup();
    }
  });

  test("every label the classifier can return is in the closed vocabulary", () => {
    const seen = new Set<string>();
    const fx = makeProject({
      frs: [
        {
          name: "a.md",
          body: overCapFr("a"),
          committedAt: isoAt(epochMs() - ONE_YEAR),
        },
        { name: "b.md", body: overCapFr("b"), committedAt: FR_WORD_CAP_EPOCH },
        { name: "c.md", body: overCapFr("c") },
      ],
    });
    try {
      for (const n of ["a.md", "b.md", "c.md"]) {
        seen.add(classifyFrProvenance(fx.root, frPath(fx.root, n)));
      }
      severIntroducingCommit(fx.root, "specs/frs/a.md");
      seen.add(classifyFrProvenance(fx.root, frPath(fx.root, "a.md")));
      for (const label of seen) expect(CLASSES).toContain(label as never);
      // Non-vacuous: the sweep really did produce more than one label.
      expect(seen.size).toBeGreaterThanOrEqual(3);
    } finally {
      fx.cleanup();
    }
  });

  test("ARCHIVE-AWARE: archiving and reopening an FR does not re-date it to the reopen commit", () => {
    // The M119 defect, verbatim, in FR clothing: `git log --diff-filter=A -1`
    // returns the MOST RECENT add, so an FR archived and later reopened reads
    // as introduced at the reopen commit — post-epoch — and a genuinely legacy
    // FR hard-fails on prose nobody rewrote. `/implement` Phase 4 and
    // `/spec-archive` do this move to every FR they close, so it is the common
    // path, not a corner.
    const fx = makeProject({
      frs: [
        {
          name: "roundtrip.md",
          body: overCapFr("roundtrip"),
          committedAt: isoAt(epochMs() - ONE_YEAR),
        },
      ],
    });
    try {
      git(fx.root, [
        "mv",
        "specs/frs/roundtrip.md",
        "specs/frs/archive/roundtrip.md",
      ]);
      commitAt(fx.root, isoAt(epochMs() + ONE_SECOND), "chore: archive");
      git(fx.root, [
        "mv",
        "specs/frs/archive/roundtrip.md",
        "specs/frs/roundtrip.md",
      ]);
      commitAt(fx.root, isoAt(epochMs() + 2 * ONE_SECOND), "chore: reopen");

      // The naive query really would answer post-epoch — otherwise this test
      // proves nothing about archive-awareness.
      const naive = git(fx.root, [
        "log",
        "--diff-filter=A",
        "-1",
        "--format=%aI",
        "--",
        "specs/frs/roundtrip.md",
      ]).trim();
      expect(Date.parse(naive)).toBeGreaterThanOrEqual(epochMs());

      expect(classifyFrProvenance(fx.root, frPath(fx.root, "roundtrip.md"))).toBe(
        "legacy",
      );
    } finally {
      fx.cleanup();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. THE PROBE DISPOSES OF EACH LABEL — AND ONLY word_cap IS GRANDFATHERED
// ═══════════════════════════════════════════════════════════════════════════

describe("F11.3 — the probe grandfathers word_cap by provenance", () => {
  test("a pre-epoch FR over the cap yields NO word_cap row at any severity", () => {
    const fx = makeProject({
      frs: [
        {
          name: "old.md",
          body: overCapFr("old"),
          committedAt: isoAt(epochMs() - ONE_YEAR),
        },
      ],
    });
    try {
      // Non-vacuity: the RAW scanner does flag it, so the silence below is the
      // grandfathering and not an empty fixture.
      expect(wordCapRows(scanFrSummaryAltitude(fx.root)).length).toBe(1);

      const report = runFrSummaryAltitudeProbe(fx.root);
      expect(wordCapRows(report.violations)).toEqual([]);
      expect(report.grandfathered).toEqual(["specs/frs/old.md"]);
    } finally {
      fx.cleanup();
    }
  });

  test("a post-epoch FR over the cap yields an ERROR-severity word_cap row", () => {
    const fx = makeProject({
      frs: [
        {
          name: "new.md",
          body: overCapFr("new"),
          committedAt: isoAt(epochMs() + ONE_SECOND),
        },
      ],
    });
    try {
      const report = runFrSummaryAltitudeProbe(fx.root);
      const rows = wordCapRows(report.violations);
      expect(rows.length).toBe(1);
      expect(rows[0]).toMatchObject({
        file: "specs/frs/new.md",
        rule: "word_cap",
        section: "Summary",
        severity: "error",
      });
      expect(report.grandfathered).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("THE DISCRIMINATOR: two byte-identical FRs, parted only by their commit date", () => {
    // Shape cannot separate them; only git can. Without this leg a
    // "grandfather everything" stub and a real epoch arm are indistinguishable.
    const body = overCapFr("twin");
    const fx = makeProject({
      frs: [
        { name: "twin-old.md", body, committedAt: isoAt(epochMs() - ONE_SECOND) },
        { name: "twin-new.md", body, committedAt: isoAt(epochMs() + ONE_SECOND) },
      ],
    });
    try {
      expect(read(frPath(fx.root, "twin-old.md"))).toBe(
        read(frPath(fx.root, "twin-new.md")),
      );
      const files = wordCapRows(runFrSummaryAltitudeProbe(fx.root).violations).map(
        (r) => (r as { file: string }).file,
      );
      expect(files).toEqual(["specs/frs/twin-new.md"]);
    } finally {
      fx.cleanup();
    }
  });

  test("an undecidable FR yields a WARNING-severity row, never an error", () => {
    const fx = makeProject({
      frs: [
        {
          name: "severed.md",
          body: overCapFr("severed"),
          committedAt: isoAt(epochMs() - ONE_YEAR),
        },
      ],
    });
    try {
      severIntroducingCommit(fx.root, "specs/frs/severed.md");
      const rows = wordCapRows(runFrSummaryAltitudeProbe(fx.root).violations);
      expect(rows.length).toBe(1);
      expect((rows[0] as { severity: string }).severity).toBe("warning");
      expect(
        runFrSummaryAltitudeProbe(fx.root).violations.some(
          (v) => v.severity === "error",
        ),
      ).toBe(false);
    } finally {
      fx.cleanup();
    }
  });

  test("a non-git tree is grandfathered, not failed", () => {
    const fx = makeProject({
      git: false,
      frs: [{ name: "nogit.md", body: overCapFr("nogit") }],
    });
    try {
      expect(wordCapRows(scanFrSummaryAltitude(fx.root)).length).toBe(1);
      const report = runFrSummaryAltitudeProbe(fx.root);
      expect(wordCapRows(report.violations)).toEqual([]);
      expect(report.grandfathered).toEqual(["specs/frs/nogit.md"]);
    } finally {
      fx.cleanup();
    }
  });

  test("the grandfathering is REPORTED, not silent — a spared file is named", () => {
    // "Silent skips are worse than loud failures": probe #68 tallies its
    // grandfathered plans into a visible NOTES row rather than dropping them.
    const fx = makeProject({
      frs: [
        {
          name: "a.md",
          body: overCapFr("a"),
          committedAt: isoAt(epochMs() - ONE_YEAR),
        },
        {
          name: "b.md",
          body: overCapFr("b"),
          committedAt: isoAt(epochMs() - ONE_YEAR),
        },
        { name: "c.md", body: cleanFr("c"), committedAt: isoAt(epochMs() - ONE_YEAR) },
      ],
    });
    try {
      const report = runFrSummaryAltitudeProbe(fx.root);
      // Only files whose word_cap rows were actually spared — a clean pre-epoch
      // FR was never grandfathered because it never violated anything.
      expect(report.grandfathered).toEqual(["specs/frs/a.md", "specs/frs/b.md"]);
    } finally {
      fx.cleanup();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. THE FOUR PRE-EXISTING RULES ARE UNAFFECTED BY THE EPOCH
// ═══════════════════════════════════════════════════════════════════════════

describe("F11.4 — the epoch silences word_cap ALONE", () => {
  test("a pre-epoch FR breaking a PRE-EXISTING rule still fails, at error severity", () => {
    const fx = makeProject({
      frs: [
        {
          name: "old-backtick.md",
          body: backtickFr("old-backtick"),
          committedAt: isoAt(epochMs() - ONE_YEAR),
        },
      ],
    });
    try {
      const report = runFrSummaryAltitudeProbe(fx.root);
      const rules = report.violations.map((v) => v.rule);
      expect(rules).toContain("backtick");
      expect(rules).not.toContain("word_cap");
      for (const v of report.violations) {
        if (v.rule !== "word_cap") expect(v.severity).toBe("error");
      }
    } finally {
      fx.cleanup();
    }
  });

  test("ALL FOUR pre-existing rules fire on a pre-epoch FR — enumerated, not sampled", () => {
    const body = [
      "---",
      "id: legacy-offender",
      "status: active",
      "---",
      "",
      "# legacy-offender",
      "",
      "## Summary",
      "",
      "Line one of a summary that names `a backtick`.",
      "Line two references AC-STE-386.2 directly.",
      "Line three points at adapters/_shared/src/thing.ts as a path.",
      "Line four is filler.",
      "Line five is filler.",
      "Line six is filler.",
      "Line seven crosses the six-line cap.",
      "",
    ].join("\n");
    const fx = makeProject({
      frs: [
        {
          name: "legacy-offender.md",
          body,
          committedAt: isoAt(epochMs() - ONE_YEAR),
        },
      ],
    });
    try {
      // The raw scanner is the oracle for what SHOULD survive the epoch.
      const raw = scanFrSummaryAltitude(fx.root).filter((v) => v.rule !== "word_cap");
      const rawRules = new Set(raw.map((v) => v.rule));
      expect([...rawRules].sort()).toEqual([
        "ac_id",
        "backtick",
        "line_cap",
        "path_token",
      ]);

      const graded = runFrSummaryAltitudeProbe(fx.root).violations.filter(
        (v) => v.rule !== "word_cap",
      );
      // Byte-for-byte the same rows the raw scanner produced, in the same
      // order — the epoch arm passes them through untouched.
      expect(
        graded.map((v) => ({
          file: v.file,
          line: v.line,
          rule: v.rule,
          section: v.section,
        })),
      ).toEqual(raw.map((v) => ({ ...v })));
    } finally {
      fx.cleanup();
    }
  });

  test("MUTATION — an epoch arm that silenced the four would turn this red", () => {
    // The mutation is the WRONG implementation, applied to the fixture rather
    // than to the module: dispose of EVERY rule by provenance instead of
    // word_cap alone. If the shipped arm did that, `graded` below would be
    // empty and the assertion above would already have failed.
    const fx = makeProject({
      frs: [
        {
          name: "old-backtick.md",
          body: backtickFr("old-backtick"),
          committedAt: isoAt(epochMs() - ONE_YEAR),
        },
      ],
    });
    try {
      expect(
        classifyFrProvenance(fx.root, frPath(fx.root, "old-backtick.md")),
      ).toBe("legacy");
      expect(SILENT_CLASSES).toContain("legacy");
      // …and yet the row survives, because the label governs one rule only.
      expect(
        runFrSummaryAltitudeProbe(fx.root).violations.map((v) => v.rule),
      ).toContain("backtick");
    } finally {
      fx.cleanup();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. THE MEASURED POPULATION — non-vacuity, against 447 real FRs
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The reported consumer scenario, reproduced exactly: this repository's own
 * archived FRs, restored as ACTIVE FRs in a git repository whose history
 * predates the epoch. Every one of them is prose a consumer never rewrote.
 */
function measuredPopulation(committedAt: string): Project {
  const names = readdirSync(ARCHIVE_FRS).filter((n) => n.endsWith(".md"));
  if (names.length < 400) {
    throw new Error(`fixture bug: expected the real archive, found ${names.length}`);
  }
  const fx = makeProject({ frs: [] });
  for (const n of names) {
    copyFileSync(join(ARCHIVE_FRS, n), join(fx.root, "specs", "frs", n));
  }
  git(fx.root, ["add", "--", "specs/frs"]);
  commitAt(fx.root, committedAt, "chore: restore archived FRs as active");
  return fx;
}

describe("F11.5 — the grandfathering spares a MEASURED population, not an empty set", () => {
  test("BASELINE: the raw scanner really does fail 638 word caps over 320 real FRs", () => {
    // Measured 2026-09-01 against v2.75.0. Asserted as a FLOOR so a growing
    // archive cannot rot the pin, and as a floor large enough that no empty or
    // truncated fixture could satisfy it.
    const fx = measuredPopulation(isoAt(epochMs() - ONE_YEAR));
    try {
      const rows = wordCapRows(scanFrSummaryAltitude(fx.root));
      expect(rows.length).toBeGreaterThanOrEqual(638);
      expect(new Set(rows.map((r) => (r as { file: string }).file)).size)
        .toBeGreaterThanOrEqual(320);
    } finally {
      fx.cleanup();
    }
  });

  test("the whole pre-epoch population goes GREEN under the probe", () => {
    const fx = measuredPopulation(isoAt(epochMs() - ONE_YEAR));
    try {
      const report = runFrSummaryAltitudeProbe(fx.root);
      expect(wordCapRows(report.violations)).toEqual([]);
      // …and it is grandfathered, not merely unmeasured: every file the raw
      // scanner flagged is named in the report.
      const rawFiles = new Set(
        wordCapRows(scanFrSummaryAltitude(fx.root)).map(
          (r) => (r as { file: string }).file,
        ),
      );
      expect([...report.grandfathered].sort()).toEqual([...rawFiles].sort());
      expect(report.grandfathered.length).toBeGreaterThanOrEqual(320);
    } finally {
      fx.cleanup();
    }
  });

  test("the SAME population committed AFTER the epoch still fails — the arm is not a blanket amnesty", () => {
    const fx = measuredPopulation(isoAt(epochMs() + ONE_SECOND));
    try {
      const rows = wordCapRows(runFrSummaryAltitudeProbe(fx.root).violations);
      expect(rows.length).toBeGreaterThanOrEqual(638);
      expect(rows.every((r) => (r as { severity: string }).severity === "error")).toBe(
        true,
      );
    } finally {
      fx.cleanup();
    }
  });

  test("the four pre-existing rules are silent on this population BOTH sides of the epoch", () => {
    // Measured: the 447 archived FRs break `word_cap` 638 times and the four
    // older rules ZERO times. That is what makes grandfathering `word_cap`
    // alone sufficient to keep a v2.74.0 consumer green — and it is a
    // measurement this suite has to own rather than assume.
    for (const committedAt of [
      isoAt(epochMs() - ONE_YEAR),
      isoAt(epochMs() + ONE_SECOND),
    ]) {
      const fx = measuredPopulation(committedAt);
      try {
        expect(
          scanFrSummaryAltitude(fx.root).filter((v) => v.rule !== "word_cap"),
        ).toEqual([]);
      } finally {
        fx.cleanup();
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. WIRING — the probe the gate runs is the grandfathering one
// ═══════════════════════════════════════════════════════════════════════════

describe("F11.6 — probe #67 routes through the grandfathering entry point", () => {
  /** The #67 probe-entry block, located the way the shipped suite locates it. */
  function probe67Block(): string {
    const match = read(GATE_CHECK_SKILL).match(
      /^67\.\s+\*\*`?fr_summary_altitude`?\*\*[\s\S]*?(?=^\d+\.\s|\n## |$)/m,
    );
    expect(match).not.toBeNull();
    return match![0];
  }

  test("the gate-check entry names the grandfathering entry point", () => {
    expect(probe67Block()).toContain("runFrSummaryAltitudeProbe(projectRoot)");
  });

  test("the entry states the epoch by NAME and the grandfathered disposition", () => {
    const block = probe67Block();
    expect(block).toContain("FR_WORD_CAP_EPOCH");
    expect(block).toMatch(/grandfather/i);
    // The three dispositions are stated, so an operator reading the gate
    // documentation can predict the verdict on their own tree.
    expect(block).toMatch(/legacy/i);
    expect(block).toMatch(/undecidable/i);
  });

  test("the entry still names the raw scanner — the pure half is not retired", () => {
    // Two sibling suites pin this literal; the epoch arm layers over the
    // scanner rather than replacing it.
    expect(probe67Block()).toContain("scanFrSummaryAltitude(projectRoot)");
  });

  test("DOGFOOD — the probe is clean over THIS repository", () => {
    const report = runFrSummaryAltitudeProbe(REPO_ROOT);
    expect(report.violations.map((v) => `${v.file}:${v.line} ${v.rule}`)).toEqual([]);
  });

  test("the shipped caps are untouched by this fix", () => {
    // A "fix" that quietly raised the numbers instead of dating them would
    // also make the consumer green, and would be the wrong fix.
    expect(SUMMARY_WORD_CAP).toBe(80);
    expect(TECHNICAL_DESIGN_WORD_CAP).toBe(120);
    expect(NOTES_WORD_CAP).toBe(60);
    expect(SECTION_RULES.map((s) => [s.section, s.wordCap])).toEqual([
      ["Summary", 80],
      ["Technical Design", 120],
      ["Notes", 60],
    ]);
  });

  test("vacuity survives: an absent specs/frs yields a clean, vacuous report", () => {
    const root = mkdtempSync(join(tmpdir(), "fr-word-cap-vacuous-"));
    try {
      const report = runFrSummaryAltitudeProbe(root);
      expect(report.violations).toEqual([]);
      expect(report.grandfathered).toEqual([]);
      expect(report.vacuous).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ===========================================================================
// PR #76 ROUND C — THE UNIT MISMATCH IN THE PROBE'S OWN REPORT
// ===========================================================================
//
// `runFrSummaryAltitudeProbe` returns `violations` as ROWS and `grandfathered`
// as FILE PATHS. An operator reading the probe's two numbers side by side is
// comparing rows against files and has no way to know it: measured 2026-09-01
// on this repository's archive, 65 grandfathered FILES spared 117 word_cap
// ROWS. "65 spared, 117 flagged" reads as a ratio and is not one.
//
// This is the SAME wrong-unit error probe #67 shipped and M137 corrected —
// measuring lines where it meant words — which is this milestone's own headline
// finding. So the fix is the one that finding prescribes: report both counts,
// in named units, rather than leaving a reader to infer which is which.
//
// The discriminating fixture is an FR with TWO over-cap sections. One file,
// two rows: any report that carries a single spared number is ambiguous on it,
// and any report that carries both is not.

describe("the probe reports the spared count in the SAME unit as the flagged count", () => {
  /** One pre-epoch FR whose Summary AND Notes are both over their caps. */
  function twoBreachFr(stem: string): string {
    return [
      "---",
      `id: ${stem}`,
      "status: active",
      "---",
      "",
      `# ${stem}`,
      "",
      "## Summary",
      "",
      Array.from({ length: SUMMARY_WORD_CAP + 40 }, (_, i) => `word${i}`).join(" "),
      "",
      "## Notes",
      "",
      Array.from({ length: NOTES_WORD_CAP + 40 }, (_, i) => `note${i}`).join(" "),
      "",
    ].join("\n");
  }

  test("NON-VACUITY — the fixture really is one FILE carrying TWO word_cap rows", () => {
    const fx = makeProject({
      frs: [
        {
          name: "two-breach.md",
          body: twoBreachFr("two-breach"),
          committedAt: isoAt(epochMs() - ONE_YEAR),
        },
      ],
    });
    try {
      const raw = wordCapRows(scanFrSummaryAltitude(fx.root));
      expect(raw.length).toBe(2);
      expect(new Set(raw.map((r) => (r as { file: string }).file)).size).toBe(1);
    } finally {
      fx.cleanup();
    }
  });

  test("the spared ROWS are counted, not only the spared FILES", () => {
    const fx = makeProject({
      frs: [
        {
          name: "two-breach.md",
          body: twoBreachFr("two-breach"),
          committedAt: isoAt(epochMs() - ONE_YEAR),
        },
      ],
    });
    try {
      const report = runFrSummaryAltitudeProbe(fx.root);
      expect(wordCapRows(report.violations)).toEqual([]);
      // The file list is unchanged — this is an addition, not a replacement.
      expect(report.grandfathered).toEqual(["specs/frs/two-breach.md"]);
      // …and the row count is reported beside it, in the unit `violations`
      // speaks, so the two numbers a reader compares are comparable.
      expect(report.grandfatheredRows).toBe(2);
      expect(report.grandfatheredRows).not.toBe(report.grandfathered.length);
    } finally {
      fx.cleanup();
    }
  });

  test("a clean tree reports ZERO in both units — the field is never left undefined", () => {
    const fx = makeProject({
      frs: [
        { name: "clean.md", body: cleanFr("clean"), committedAt: isoAt(epochMs() - ONE_YEAR) },
      ],
    });
    try {
      const report = runFrSummaryAltitudeProbe(fx.root);
      expect(report.grandfathered).toEqual([]);
      expect(report.grandfatheredRows).toBe(0);
    } finally {
      fx.cleanup();
    }
  });

  test("the probe's authoring surface NAMES the unit each number is in", () => {
    // A reader of `/gate-check` meets these two numbers in prose before they
    // ever meet the type. The surface has to say which is which, or the fix
    // stops at the type and the ambiguity ships anyway.
    const skill = read(GATE_CHECK_SKILL);
    const sentence = skill
      .split(/(?<=[.!?])\s+/)
      .filter((s) => /grandfathered/i.test(s));
    expect(sentence.length).toBeGreaterThan(0);
    expect(sentence.some((s) => /\bfiles?\b/i.test(s))).toBe(true);
    expect(skill).toMatch(/grandfatheredRows/);
  });
});
