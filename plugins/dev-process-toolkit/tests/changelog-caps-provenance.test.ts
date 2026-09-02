// PR #76 adversarial review, item B — THE CHANGELOG MUST STATE THE PROVENANCE,
// and the two closures belong in ONE entry, because their consumer profiles are
// OPPOSITE and that contrast is what makes either one legible:
//
//   * The word caps (STE-534) needed a grandfathering epoch. They flagged 616
//     violations across 319 archived FRs the moment they landed — a consumer
//     upgrading and touching nothing would have watched `/gate-check` flip
//     PASSED → FAILED on prose they never wrote.
//
//   * The per-name accumulation fix needs NO epoch. 616 before, 616 after,
//     0 newly flagged, and 0 archived FRs repeat a capped section name.
//     Nothing in 32 milestones of corpus ever relied on the split shape.
//
// AND THE HONEST ENTRY IS THE STRONGER CLAIM. `line_cap` — the FIRST rule on
// that walker that carries state across lines — shipped in STE-386 (M105).
// Probe #67 has therefore been evadable by a repeated heading for 32
// milestones. M137 did not introduce the defect: it added a SECOND
// accumulating rule to a walker whose first was already evadable, then copied
// the shape into a third scanner. "Closes a defect predating the milestone by
// 32 milestones" is a bigger statement than "fixed a bug we just wrote", and it
// is the true one.
//
// RED-state until `CHANGELOG.md`'s topmost release entry carries that
// provenance, and until STE-534's existing line says what it inherited from the
// probe it was added to: the accumulator.
//
// THE NUMBERS ARE DERIVED, NOT QUOTED. 616 and 319 are re-measured here by
// copying `specs/frs/archive/*.md` into an ACTIVE `specs/frs/` and running the
// shipped scanner; the milestone span is computed from two frontmatter fields.
// The population is closed by construction: every FR authored from the epoch
// forward is graded at error severity and must clear the caps, so a future
// milestone cannot move 616 or 319. The corpus SIZE ("of 447 files") is
// deliberately NOT pinned — that number grows with every milestone, and a pin
// on it would force an edit to a historical release entry.
//
// ISOLATION IS HALF A TEST. The requirement set is exercised against a
// synthetic complete statement (which must pass) AND against four plausible
// partial ones (each must fail on exactly the clause it drops). A set that
// matched anything would otherwise read as a clean pass on the day the
// provenance was never written.

import { describe, expect, test } from "bun:test";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { scanFrSummaryAltitude } from "../adapters/_shared/src/scan_fr_summary_altitude";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const CHANGELOG = join(REPO_ROOT, "CHANGELOG.md");
const ARCHIVE_FRS = join(REPO_ROOT, "specs", "frs", "archive");
const ARCHIVE_PLANS = join(REPO_ROOT, "specs", "plan", "archive");

const read = (path: string): string => readFileSync(path, "utf-8");

/**
 * Whitespace-normalised. Real CHANGELOG bullets are one long physical line and
 * the fixtures below are wrapped for reading; normalising both is what keeps a
 * requirement about WORDING from becoming a requirement about line breaks.
 */
const flat = (text: string): string => text.replace(/\s+/g, " ").trim();

// ───────────────────────────────────────────────────────────────────────────
// The CHANGELOG, split into release entries and per-entry bullets
// ───────────────────────────────────────────────────────────────────────────

interface ReleaseEntry {
  readonly version: string;
  readonly body: string;
  readonly bullets: readonly string[];
}

/** The topmost `## [X.Y.Z]` section — the one a release ships. */
function topmostEntry(): ReleaseEntry {
  const lines = read(CHANGELOG).split("\n");
  const start = lines.findIndex((l) => /^## \[\d+\.\d+\.\d+\]/.test(l));
  if (start < 0) throw new Error("CHANGELOG.md carries no release entry at all");
  const version = /^## \[(\d+\.\d+\.\d+)\]/.exec(lines[start]!)![1]!;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## \[/.test(lines[i]!)) {
      end = i;
      break;
    }
  }
  const body = lines.slice(start, end).join("\n");
  return { version, body, bullets: splitBullets(body) };
}

/**
 * One bullet per CHANGELOG entry. A bullet opens on `- ` and runs until the
 * next bullet, a heading, or a blank line, so a wrapped bullet stays ONE entry
 * — the unit item B means by "ONE entry".
 */
function splitBullets(body: string): string[] {
  const out: string[] = [];
  let current: string[] | null = null;
  const flush = (): void => {
    if (current) out.push(flat(current.join(" ")));
    current = null;
  };
  for (const line of body.split("\n")) {
    if (/^-\s+/.test(line)) {
      flush();
      current = [line];
      continue;
    }
    if (/^#{1,6}\s/.test(line) || line.trim() === "") {
      flush();
      continue;
    }
    if (current) current.push(line);
  }
  flush();
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
// The measurement, reproduced
// ───────────────────────────────────────────────────────────────────────────

/** Level-2 heading names the shipped `SECTION_RULES` puts a word cap on. */
const CAPPED_SECTIONS: readonly string[] = ["Summary", "Technical Design", "Notes"];

interface CorpusMeasurement {
  readonly files: number;
  readonly wordCapRows: number;
  readonly wordCapFiles: number;
  readonly filesRepeatingACappedName: number;
}

let cached: CorpusMeasurement | null = null;

/**
 * Run the SHIPPED scanner over this repository's archived FRs by copying them
 * into a temporary ACTIVE `specs/frs/`. The scanner walks active FRs only, so
 * the archive is invisible to it in place — which is precisely the vacuity that
 * hid the retroactive-caps blast radius until the review measured it.
 */
function measureCorpus(): CorpusMeasurement {
  if (cached !== null) return cached;
  const names = readdirSync(ARCHIVE_FRS).filter((n) => n.endsWith(".md"));
  const root = mkdtempSync(join(tmpdir(), "caps-provenance-"));
  try {
    mkdirSync(join(root, "specs", "frs"), { recursive: true });
    for (const name of names) {
      copyFileSync(join(ARCHIVE_FRS, name), join(root, "specs", "frs", name));
    }
    const wordCap = scanFrSummaryAltitude(root).filter((v) => v.rule === "word_cap");

    let repeats = 0;
    for (const name of names) {
      const counts = new Map<string, number>();
      for (const line of read(join(ARCHIVE_FRS, name)).split("\n")) {
        const m = /^##\s+(.*?)\s*$/.exec(line);
        if (m && CAPPED_SECTIONS.includes(m[1]!)) {
          counts.set(m[1]!, (counts.get(m[1]!) ?? 0) + 1);
        }
      }
      if ([...counts.values()].some((n) => n > 1)) repeats += 1;
    }

    cached = {
      files: names.length,
      wordCapRows: wordCap.length,
      wordCapFiles: new Set(wordCap.map((v) => v.file)).size,
      filesRepeatingACappedName: repeats,
    };
    return cached;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** `milestone: M<N>` out of a frontmatter block. */
function milestoneOf(path: string): number {
  const m = /^milestone:\s*M(\d+)\s*$/m.exec(read(path));
  if (!m) throw new Error(`no \`milestone:\` frontmatter in ${path}`);
  return Number(m[1]);
}

/** The milestone the topmost release shipped, found by its `shipped_in` stamp. */
function shippingMilestone(version: string): number {
  for (const name of readdirSync(ARCHIVE_PLANS).filter((n) => n.endsWith(".md"))) {
    const path = join(ARCHIVE_PLANS, name);
    if (new RegExp(`^shipped_in:\\s*v${version.replace(/\./g, "\\.")}\\s*$`, "m").test(read(path))) {
      return milestoneOf(path);
    }
  }
  throw new Error(`no archived plan stamps shipped_in: v${version}`);
}

/** The milestone `line_cap` — the first accumulating rule — shipped in. */
const LINE_CAP_MILESTONE = milestoneOf(join(ARCHIVE_FRS, "STE-386.md"));
const MILESTONE_SPAN = shippingMilestone(topmostEntry().version) - LINE_CAP_MILESTONE;

// ───────────────────────────────────────────────────────────────────────────
// The requirement set
// ───────────────────────────────────────────────────────────────────────────

interface Requirement {
  readonly name: string;
  readonly pattern: RegExp;
}

function buildRequirements(m: CorpusMeasurement, span: number): Requirement[] {
  return [
    {
      name: `the epoch measurement — ${m.wordCapRows} rows across ${m.wordCapFiles} files`,
      pattern: new RegExp(`\\b${m.wordCapRows}\\b[\\s\\S]{0,120}?\\b${m.wordCapFiles}\\b`),
    },
    { name: "the caps needed a grandfathering epoch", pattern: /grandfather|epoch/i },
    {
      name: "the accumulation fix needs none — before and after are one number",
      pattern: new RegExp(`${m.wordCapRows} before,?\\s+${m.wordCapRows} after`, "i"),
    },
    { name: "0 newly flagged", pattern: /\b0\s+newly\s+flagged\b/i },
    {
      name: `${m.filesRepeatingACappedName} archived FRs repeat a capped section name`,
      pattern: new RegExp(`\\b${m.filesRepeatingACappedName}\\s+archived\\s+FRs?\\s+repeats?\\b`, "i"),
    },
    { name: "`line_cap` is named as the rule that already had the hole", pattern: /line_cap/ },
    { name: "its provenance: STE-386", pattern: /\bSTE-386\b/ },
    { name: `its provenance: M${LINE_CAP_MILESTONE}`, pattern: new RegExp(`\\bM${LINE_CAP_MILESTONE}\\b`) },
    {
      name: `the span — ${span} milestones/releases of evadability`,
      pattern: new RegExp(`\\b${span}\\b\\s+(?:milestones|releases)`, "i"),
    },
    {
      name: "the defect predates the milestone",
      pattern: /did\s+not\s+introduce|predat/i,
    },
    { name: "what M137 did add: a second accumulating rule", pattern: /accumulat/i },
  ];
}

const unmet = (text: string, reqs: readonly Requirement[]): string[] =>
  reqs.filter((r) => !r.pattern.test(flat(text))).map((r) => r.name);

/** The bullets that close BOTH halves — the "ONE entry" item B asks for. */
const jointBullets = (bullets: readonly string[]): string[] =>
  bullets.filter((b) => /grandfather|epoch/i.test(b) && /accumulat/i.test(b));

// ───────────────────────────────────────────────────────────────────────────

describe("item B — the measurement the provenance rests on still reproduces", () => {
  test("the archived corpus yields the numbers the entry has to state", () => {
    const m = measureCorpus();
    expect(m.files).toBeGreaterThan(400);
    expect(m.wordCapRows).toBe(616);
    expect(m.wordCapFiles).toBe(319);
  }, 60_000);

  test("nothing in the corpus relied on the split shape — so no epoch is owed", () => {
    // The whole argument for shipping the accumulation fix un-grandfathered: a
    // per-NAME accumulator can only newly flag a file that repeats a CAPPED
    // heading, and no archived FR does. (Two repeat a level-2 heading that is
    // not capped, which is why "no repeated heading at all" would be false.)
    expect(measureCorpus().filesRepeatingACappedName).toBe(0);
  }, 60_000);

  test("the span is computed from frontmatter, never typed", () => {
    expect(LINE_CAP_MILESTONE).toBe(105);
    expect(MILESTONE_SPAN).toBe(32);
  });
});

describe("item B — the requirement set discriminates before it is applied", () => {
  const COMPLETE = flat(`
    - The FR and plan word caps are graded per section NAME per file, and the
      hole they inherited predates them. \`line_cap\` — the first rule on that
      walker to carry state across lines — shipped in STE-386 (M105), so probe
      #67 has been evadable by a repeated heading for 32 milestones. M137 did
      not introduce the defect: it added a second accumulating rule to a walker
      whose first was already evadable, then copied the shape into a third
      scanner. The two closures ship as one entry because their consumer
      profiles are opposite. The caps needed a grandfathering epoch — they
      flagged 616 violations across 319 of this repository's archived FRs the
      moment they landed. The accumulation fix needs none: 616 before, 616
      after, 0 newly flagged, and 0 archived FRs repeat a capped section name.
      (STE-534, STE-535)
  `);

  test("a complete statement satisfies every clause — the set is reachable", () => {
    expect(unmet(COMPLETE, buildRequirements(measureCorpus(), MILESTONE_SPAN))).toEqual([]);
  }, 60_000);

  test("each plausible omission fails on the clause it drops", () => {
    const reqs = buildRequirements(measureCorpus(), MILESTONE_SPAN);
    const omissions: Array<readonly [string, string]> = [
      ["drops the provenance", COMPLETE.replace("STE-386 (M105)", "an earlier release")],
      ["drops the span", COMPLETE.replace("for 32 milestones", "for a while")],
      [
        "drops the no-epoch contrast",
        COMPLETE.replace("616 before, 616 after, 0 newly flagged, and ", ""),
      ],
      [
        "drops the epoch measurement",
        COMPLETE.replace("flagged 616 violations across 319 of", "flagged violations across"),
      ],
    ];
    for (const [label, text] of omissions) {
      expect(text, `${label}: the substitution did not apply`).not.toBe(COMPLETE);
      expect(unmet(text, reqs).length, `${label} still satisfied every clause`).toBeGreaterThan(0);
    }
  }, 60_000);
});

describe("item B — the shipped CHANGELOG carries it", () => {
  test("exactly ONE entry closes both — the epoch and the accumulator", () => {
    const joint = jointBullets(topmostEntry().bullets);
    expect(
      joint.length,
      "the two closures must be ONE entry: their consumer profiles are opposite " +
        "and the contrast is what makes either one legible",
    ).toBe(1);
  });

  test("that entry states the whole provenance", () => {
    const entry = topmostEntry();
    const joint = jointBullets(entry.bullets)[0];
    expect(joint, "no entry in the topmost release mentions both halves").toBeDefined();
    expect(
      unmet(joint ?? "", buildRequirements(measureCorpus(), MILESTONE_SPAN)),
      `the v${entry.version} entry drops these clauses`,
    ).toEqual([]);
  }, 60_000);

  test("STE-534's own line says what it inherited: the accumulator", () => {
    const entry = topmostEntry();
    const joint = new Set(jointBullets(entry.bullets));
    // The EXISTING STE-534 line, not the new joint one — "word caps were added
    // to the probe that already exists" is accurate and now pointed.
    const ste534 = entry.bullets.filter((b) => /\bSTE-534\b/.test(b) && !joint.has(b));
    expect(
      ste534.length,
      "the topmost release no longer carries STE-534's own line at all",
    ).toBeGreaterThan(0);
    expect(
      ste534.some((b) => /accumulat/i.test(b)),
      "STE-534's line must name what it inherited from the probe it was added to",
    ).toBe(true);
  });
});
