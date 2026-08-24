// STE-465 AC-STE-465.{4,5} — /gate-check probe #76
// `best_practices_manifest_hygiene`. Severity: error.
//
// Pins the contract of the pure probe
// `adapters/_shared/src/best_practices_manifest_hygiene.ts` (STE-369
// `plan_ship_coherence` module shape):
//
//   runBestPracticesManifestHygieneProbe(projectRoot: string)
//     => Promise<{ violations: Violation[]; notes: string[] }>
//
// Invariants:
//   - `specs/best-practices.yaml` absent → VACUOUS (zero violations, zero
//     notes — the day-one default for every existing consumer project).
//   - Manifest present but malformed (shape error from the
//     best_practices_manifest reader) → ERROR violation carrying the NFR-10
//     canonical shape; never a silent skip, never a crash.
//   - Manifest well-formed → every entry's `path` MUST resolve on disk
//     relative to projectRoot; each missing file is one ERROR violation.
//   - Violation shape follows probe #16/#63: `note` is
//     `<repo-relative-file>:<line> — <reason>`, `message` is the multi-line
//     canonical shape with `Remedy:` and `Context:` sub-lines.
//
// AC-STE-465.5 mutation coverage: every guard has a fixture on BOTH sides —
// flip the shape-validity condition, the per-entry existence condition, or
// the absent-file vacuity condition and at least one test below goes red.
//
// Fixtures are on-disk tmpdir trees via mkdtempSync per the probe convention
// (`tests/gate-check-plan-ship-coherence.test.ts`). Filter by AC with
// `bun test -t "AC-STE-465.N"`.

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runBestPracticesManifestHygieneProbe } from "../adapters/_shared/src/best_practices_manifest_hygiene";

const pluginRoot = join(import.meta.dir, "..");
const repoRoot = join(pluginRoot, "..", "..");

const PROBE = "best_practices_manifest_hygiene";
const MANIFEST_REL = "specs/best-practices.yaml";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

interface Fixture {
  root: string;
  cleanup: () => void;
}

function makeFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "bp-manifest-hygiene-"));
  mkdirSync(join(root, "specs"), { recursive: true });
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function writeManifestRaw(root: string, body: string): void {
  writeFileSync(join(root, "specs", "best-practices.yaml"), body);
}

/** Create a repo-relative doc file (with parent dirs) inside the fixture. */
function writeDoc(root: string, relPath: string): void {
  const abs = join(root, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, "# fixture doc\n");
}

// ---------------------------------------------------------------------------
// AC-STE-465.4 — vacuous when the manifest is absent
// ---------------------------------------------------------------------------

describe("AC-STE-465.4 — vacuous when specs/best-practices.yaml is absent", () => {
  test("no manifest → zero violations, zero notes", async () => {
    const fx = makeFixture();
    try {
      const report = await runBestPracticesManifestHygieneProbe(fx.root);
      expect(report.violations).toEqual([]);
      expect(report.notes).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("no specs/ directory at all → still vacuous (no crash)", async () => {
    const root = mkdtempSync(join(tmpdir(), "bp-manifest-hygiene-nospecs-"));
    try {
      const report = await runBestPracticesManifestHygieneProbe(root);
      expect(report.violations).toEqual([]);
      expect(report.notes).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// AC-STE-465.4 / AC-STE-465.5 — positive fixtures (clean pass)
// ---------------------------------------------------------------------------

describe("AC-STE-465.5 — positive fixture: valid manifest, every path on disk", () => {
  test("well-formed manifest whose entries all resolve → zero violations", async () => {
    const fx = makeFixture();
    try {
      writeDoc(fx.root, "docs/best-practices/errors.md");
      writeDoc(fx.root, "docs/best-practices/naming.md");
      writeManifestRaw(
        fx.root,
        [
          "best_practices:",
          "  - name: errors",
          "    path: docs/best-practices/errors.md",
          "    topics: [errors]",
          "  - name: naming",
          "    path: docs/best-practices/naming.md",
          "",
        ].join("\n"),
      );
      const report = await runBestPracticesManifestHygieneProbe(fx.root);
      expect(report.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("empty manifest `best_practices: []` present on disk → valid, zero violations", async () => {
    const fx = makeFixture();
    try {
      writeManifestRaw(fx.root, "best_practices: []\n");
      const report = await runBestPracticesManifestHygieneProbe(fx.root);
      expect(report.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// AC-STE-465.5 — negative fixture: manifest shape invalid
// ---------------------------------------------------------------------------

describe("AC-STE-465.5 — negative fixture: malformed manifest is an ERROR violation", () => {
  test("shape error surfaces as a violation (never a throw, never a silent skip)", async () => {
    const fx = makeFixture();
    try {
      writeManifestRaw(fx.root, "best_practices: [unclosed\n  - bad");
      const report = await runBestPracticesManifestHygieneProbe(fx.root);
      expect(report.violations.length).toBeGreaterThanOrEqual(1);
      const v = report.violations[0]!;
      expect(v.note).toMatch(new RegExp(`^${MANIFEST_REL}:\\d+ — `));
      expect(v.message).toContain(PROBE);
      expect(v.message).toMatch(/^Remedy: /m);
      expect(v.message).toMatch(/^Context: /m);
    } finally {
      fx.cleanup();
    }
  });

  test("closed-schema breach (unknown entry key) is a shape violation too", async () => {
    const fx = makeFixture();
    try {
      writeDoc(fx.root, "docs/ok.md");
      writeManifestRaw(
        fx.root,
        [
          "best_practices:",
          "  - name: sneaky",
          "    path: docs/ok.md",
          "    owner: bob",
          "",
        ].join("\n"),
      );
      const report = await runBestPracticesManifestHygieneProbe(fx.root);
      expect(report.violations.length).toBeGreaterThanOrEqual(1);
      // Exact line pin: the reader's reason names entry line 2 (`- name:`),
      // and lineFromShapeReason must carry it into the note (a fallback-to-1
      // mutation of that extraction goes red here).
      expect(report.violations[0]!.note).toMatch(new RegExp(`^${MANIFEST_REL}:2 — `));
    } finally {
      fx.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// AC-STE-465.5 — negative fixture: entry path does not resolve on disk
// ---------------------------------------------------------------------------

describe("AC-STE-465.5 — negative fixture: missing referenced document", () => {
  test("one entry whose path is absent → exactly one violation naming the entry's path", async () => {
    const fx = makeFixture();
    try {
      writeManifestRaw(
        fx.root,
        [
          "best_practices:",
          "  - name: ghost",
          "    path: docs/does-not-exist.md",
          "",
        ].join("\n"),
      );
      const report = await runBestPracticesManifestHygieneProbe(fx.root);
      expect(report.violations.length).toBe(1);
      const v = report.violations[0]!;
      // Exact line pin: `path:` is manifest line 3 (mutation guard for
      // findPathLine — a fallback-to-1 or wrong-line mutation goes red here).
      expect(v.note).toMatch(new RegExp(`^${MANIFEST_REL}:3 — `));
      expect(v.note).toContain("docs/does-not-exist.md");
      expect(v.message).toContain(PROBE);
      expect(v.message).toMatch(/^Remedy: /m);
      expect(v.message).toMatch(/^Context: /m);
    } finally {
      fx.cleanup();
    }
  });

  test("MUTATION GUARD (every-entry clause): 1 missing + 1 present → exactly one violation, and it names the MISSING path", async () => {
    const fx = makeFixture();
    try {
      writeDoc(fx.root, "docs/present.md");
      writeManifestRaw(
        fx.root,
        [
          "best_practices:",
          "  - name: present",
          "    path: docs/present.md",
          "  - name: ghost",
          "    path: docs/ghost.md",
          "",
        ].join("\n"),
      );
      const report = await runBestPracticesManifestHygieneProbe(fx.root);
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]!.note).toContain("docs/ghost.md");
      expect(report.violations[0]!.note).not.toContain("docs/present.md");
      // Exact line pin: ghost's `path:` is manifest line 5, not line 3 (the
      // present entry's) — kills a findPathLine first-match mutation.
      expect(report.violations[0]!.note).toMatch(new RegExp(`^${MANIFEST_REL}:5 — `));
    } finally {
      fx.cleanup();
    }
  });

  test("MUTATION GUARD (per-entry accumulation): two missing entries → two violations", async () => {
    const fx = makeFixture();
    try {
      writeManifestRaw(
        fx.root,
        [
          "best_practices:",
          "  - name: ghost-a",
          "    path: docs/ghost-a.md",
          "  - name: ghost-b",
          "    path: docs/ghost-b.md",
          "",
        ].join("\n"),
      );
      const report = await runBestPracticesManifestHygieneProbe(fx.root);
      expect(report.violations.length).toBe(2);
      const notes = report.violations.map((v) => v.note).join("\n");
      expect(notes).toContain("docs/ghost-a.md");
      expect(notes).toContain("docs/ghost-b.md");
    } finally {
      fx.cleanup();
    }
  });

  test("MUTATION GUARD (resolution root): path exists relative to projectRoot, not cwd", async () => {
    const fx = makeFixture();
    try {
      // The doc exists ONLY inside the fixture root. A probe that resolved
      // against process.cwd() (where no docs/present-only-in-fixture.md
      // exists) would flag it; resolving against projectRoot passes.
      writeDoc(fx.root, "docs/present-only-in-fixture.md");
      writeManifestRaw(
        fx.root,
        [
          "best_practices:",
          "  - name: rooted",
          "    path: docs/present-only-in-fixture.md",
          "",
        ].join("\n"),
      );
      const report = await runBestPracticesManifestHygieneProbe(fx.root);
      expect(report.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// AC-STE-465.4 — gate-check SKILL registration row #76 (meta-test)
// ---------------------------------------------------------------------------

describe("AC-STE-465.4 — gate-check SKILL.md registers probe #76 best_practices_manifest_hygiene", () => {
  const gateCheckSkill = (): string =>
    readFileSync(join(pluginRoot, "skills", "gate-check", "SKILL.md"), "utf-8");

  test("row #76 exists, numbered, named best_practices_manifest_hygiene", () => {
    expect(gateCheckSkill()).toMatch(/^76\.\s+\*\*`best_practices_manifest_hygiene`\*\*/m);
  });

  test("row names the runner, the module path, error severity, vacuity, and the test file", () => {
    const body = gateCheckSkill();
    const idx = body.indexOf("`best_practices_manifest_hygiene`");
    expect(idx).toBeGreaterThan(-1);
    const block = body.slice(idx, idx + 2500);
    expect(block).toContain("runBestPracticesManifestHygieneProbe(projectRoot)");
    expect(block).toContain("adapters/_shared/src/best_practices_manifest_hygiene.ts");
    expect(block).toContain("**Severity: error.**");
    expect(block).toMatch(/[Vv]acuous/);
    expect(block).toContain("tests/gate-check-best-practices-manifest-hygiene.test.ts");
  });

  test("the numbered probe list is contiguous 1..80", () => {
    // Recalibrated 76 → 77: M126 added #77 first_turn_refusal_marker.
    const numbers = [...gateCheckSkill().matchAll(/^(\d+)\. \*\*/gm)].map((m) => Number(m[1]));
    expect(numbers.length).toBe(80);
    expect([...numbers].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 80 }, (_, i) => i + 1),
    );
  });
});

// ---------------------------------------------------------------------------
// Dogfood — this repo ships no specs/best-practices.yaml, so the probe is
// vacuous on the live tree (and MUST NOT crash it).
// ---------------------------------------------------------------------------

describe("dogfood — real repo run is clean", () => {
  test("zero violations on the live tree", async () => {
    const report = await runBestPracticesManifestHygieneProbe(repoRoot);
    expect(report.violations).toEqual([]);
  });
});
