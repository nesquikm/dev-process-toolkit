// Frontmatter line-ending + BOM normalization across the whole parsing family.
//
// Every frontmatter reader in this repo anchors on a literal `---\n` opener.
// A Windows-authored (CRLF), classic-Mac (lone CR) or BOM-prefixed file
// therefore read as having NO frontmatter at all — and that failure pointed
// the wrong way in BOTH directions:
//
//   - strict callers threw;
//   - `lenient: true` callers got `{}` and their gate PASSED on a file it had
//     never actually parsed (a silent gate bypass, the severe form);
//   - probe #13 simultaneously hid a forbidden `id:` and reported a populated
//     `tracker:` block as missing;
//   - probe #27 reported `malformed` on a well-formed FR;
//   - probe #40 silently skipped its check;
//   - `flipArchivedFrontmatter` took its legacy-synthesis branch and PREPENDED
//     a second frontmatter block above the real one — corruption, not merely a
//     skipped check.
//
// The fix is one shared normalizer applied at each parse boundary. It is a
// strict widening: a no-op on the LF content this repo actually contains, so
// no previously-passing case can change. Writers normalize for PARSING only
// and restore the file's original bytes on write.

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { flipArchivedFrontmatter } from "../adapters/_shared/src/archive_fr";
import {
  hasBom,
  joinFrontmatter,
  normalizeFrontmatterSource,
  parseFrontmatter,
  splitFrontmatter,
} from "../adapters/_shared/src/frontmatter";
import { runIdentityModeConditionalProbe } from "../adapters/_shared/src/identity_mode_conditional";
import { runFrontmatterMilestoneNotArchivedProbe } from "../adapters/_shared/src/frontmatter_milestone_not_archived";
import { stampShippedIn } from "../adapters/_shared/src/plan_ship_stamp";
import { parseFrontmatterFields, lineNumberOfKey } from "../adapters/_shared/src/tdd_probe_helpers";
import { parseFrFrontmatter } from "../adapters/_shared/src/tracker_project_milestone_attached";

const ULID = "fr_01K9ZQ8XJ4VDTAF4VDTAF4VDTA";
const BOM = "﻿";

/** The same logical document rendered with each line-ending flavour. */
function doc(nl: string, bom = ""): string {
  return [
    `${bom}---`,
    "title: x",
    "milestone: M1",
    "status: active",
    "archived_at: null",
    "tracker:",
    "  linear: STE-1",
    "created_at: 2026-01-01",
    "---",
    "",
    "# heading",
    "",
  ].join(nl);
}

const FLAVOURS: [string, string][] = [
  ["LF", doc("\n")],
  ["CRLF", doc("\r\n")],
  ["lone CR", doc("\r")],
  ["BOM + LF", doc("\n", BOM)],
  ["BOM + CRLF", doc("\r\n", BOM)],
];

describe("normalizeFrontmatterSource", () => {
  test.each(FLAVOURS)("%s folds to the identical LF document", (_n, src) => {
    expect(normalizeFrontmatterSource(src)).toBe(doc("\n"));
  });

  test("is idempotent", () => {
    const once = normalizeFrontmatterSource(doc("\r\n", BOM));
    expect(normalizeFrontmatterSource(once)).toBe(once);
  });

  test("preserves line COUNT, so reported line numbers stay accurate", () => {
    for (const [, src] of FLAVOURS) {
      expect(normalizeFrontmatterSource(src).split("\n").length).toBe(doc("\n").split("\n").length);
    }
  });

  test("CRLF is folded before lone CR — a CRLF never becomes a blank line", () => {
    expect(normalizeFrontmatterSource("a\r\nb")).toBe("a\nb");
  });
});

describe("parseFrontmatter accepts every flavour", () => {
  test.each(FLAVOURS)("%s parses to the same object", (_n, src) => {
    expect(parseFrontmatter(src)).toEqual({
      title: "x",
      milestone: "M1",
      status: "active",
      archived_at: null,
      tracker: { linear: "STE-1" },
      created_at: "2026-01-01",
    });
  });

  test("the lenient path no longer silently returns {} on CRLF", () => {
    // This is the silent gate bypass: 7 call sites pass `lenient: true`, so a
    // CRLF file used to yield {} and every downstream check went vacuous.
    expect(parseFrontmatter(doc("\r\n"), { lenient: true })).not.toEqual({});
  });

  test("a file with genuinely no frontmatter still throws / returns {}", () => {
    expect(() => parseFrontmatter("# just a heading\n")).toThrow();
    expect(parseFrontmatter("# just a heading\n", { lenient: true })).toEqual({});
  });
});

describe("splitFrontmatter / joinFrontmatter — non-destructive write path", () => {
  test("hasBom classifies each flavour", () => {
    expect(hasBom(doc("\n", BOM))).toBe(true);
    expect(hasBom(doc("\n"))).toBe(false);
  });

  test("split → join is byte-identical when nothing is edited", () => {
    for (const src of [doc("\r\n"), doc("\n"), doc("\r\n", BOM), doc("\n", BOM)]) {
      const s = splitFrontmatter(src)!;
      expect(s).not.toBeNull();
      expect(joinFrontmatter(s, s.lines)).toBe(src);
    }
  });

  test("the body is carried VERBATIM — a mixed-ending file keeps its body", () => {
    // CRLF frontmatter, LF body. Re-encoding the whole document to one ending
    // would rewrite body lines the edit never touched.
    const src = "---\r\ntitle: x\r\nstatus: active\r\n---\r\n\nBody 1\nBody 2\n";
    const s = splitFrontmatter(src)!;
    // `rest` begins immediately after the closing `---`, so it keeps that
    // line's own ending — matching the pre-existing slice semantics.
    expect(s.rest).toBe("\r\n\nBody 1\nBody 2\n");
    expect(s.rest).toContain("Body 1\nBody 2");
    expect(joinFrontmatter(s, ["title: x", "status: archived"])).toBe(
      "---\r\ntitle: x\r\nstatus: archived\r\n---\r\n\nBody 1\nBody 2\n",
    );
  });

  test("a lone CR used as BODY content survives untouched", () => {
    const src = "---\ntitle: x\n---\n\nProgress: 50%\rProgress: 100%\n";
    const s = splitFrontmatter(src)!;
    expect(s.rest).toContain("50%\rProgress");
    expect(joinFrontmatter(s, s.lines)).toBe(src);
  });

  test("returns null when there is no closing delimiter", () => {
    expect(splitFrontmatter("---\ntitle: x\nno close here\n")).toBeNull();
    expect(splitFrontmatter("# no frontmatter\n")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Probe-level: the wrong-in-both-directions failures, reproduced then fixed
// ---------------------------------------------------------------------------

function frProject(mode: "none" | "linear", frBody: string): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "fm-eol-"));
  mkdirSync(join(root, "specs", "frs"), { recursive: true });
  mkdirSync(join(root, "specs", "plan"), { recursive: true });
  writeFileSync(
    join(root, "CLAUDE.md"),
    mode === "none" ? "# x\n" : `# x\n\n## Task Tracking\n\nmode: ${mode}\n`,
  );
  writeFileSync(join(root, "specs", "frs", "STE-1.md"), frBody);
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

describe("probe #13 identity_mode_conditional", () => {
  test("tracker mode: a CRLF FR carrying a FORBIDDEN id: is detected", async () => {
    // Was: the id went undetected AND the populated tracker: block was
    // reported missing — two wrong answers from one unparsed file.
    const p = frProject(
      "linear",
      `---\r\ntitle: x\r\nmilestone: M1\r\nid: ${ULID}\r\nstatus: active\r\narchived_at: null\r\ntracker:\r\n  linear: STE-1\r\ncreated_at: 2026-01-01\r\n---\r\n\r\n# x\r\n`,
    );
    try {
      const r = await runIdentityModeConditionalProbe(p.root);
      expect(r.violations.map((v) => v.expected)).toEqual(["absent"]);
    } finally {
      p.cleanup();
    }
  });

  test("mode: none — a BOM-prefixed FR with a VALID id: is not falsely failed", async () => {
    const p = frProject(
      "none",
      `${BOM}---\ntitle: x\nmilestone: M1\nid: ${ULID}\nstatus: active\narchived_at: null\ncreated_at: 2026-01-01\n---\n\n# x\n`,
    );
    try {
      expect((await runIdentityModeConditionalProbe(p.root)).violations).toEqual([]);
    } finally {
      p.cleanup();
    }
  });
});

describe("probe #27 frontmatter_milestone_not_archived", () => {
  test("a CRLF FR is not reported malformed", async () => {
    const p = frProject(
      "linear",
      `---\r\ntitle: x\r\nmilestone: M1\r\nstatus: active\r\narchived_at: null\r\n---\r\n\r\n# x\r\n`,
    );
    try {
      writeFileSync(join(p.root, "specs", "plan", "M1.md"), "# M1 — Fixture\n");
      const r = await runFrontmatterMilestoneNotArchivedProbe(p.root);
      expect(r.violations).toEqual([]);
    } finally {
      p.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Writers: normalize for parsing, restore the file's own bytes on write
// ---------------------------------------------------------------------------

describe("flipArchivedFrontmatter", () => {
  test("a CRLF FR is flipped in place — NOT given a second frontmatter block", async () => {
    const dir = mkdtempSync(join(tmpdir(), "afr-eol-"));
    const file = join(dir, "STE-1.md");
    try {
      writeFileSync(
        file,
        `---\r\ntitle: x\r\nstatus: active\r\narchived_at: null\r\n---\r\n\r\n# body\r\n`,
      );
      await flipArchivedFrontmatter(file, "2026-07-26T10:00:00Z");
      const out = readFileSync(file, "utf-8");
      // Exactly two `---` delimiters: the open and the close. Before the fix
      // the synthesis branch fired and produced four.
      expect(out.match(/^---\r?$/gm)!.length).toBe(2);
      expect(out).toContain("status: archived");
      expect(out).toContain("archived_at: 2026-07-26T10:00:00Z");
      expect(out).not.toContain("status: active");
      // The file keeps its own line endings.
      expect(out).toBe(
        `---\r\ntitle: x\r\nstatus: archived\r\narchived_at: 2026-07-26T10:00:00Z\r\n---\r\n\r\n# body\r\n`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("an LF FR is byte-identical to before (strict widening)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "afr-lf-"));
    const file = join(dir, "STE-1.md");
    try {
      writeFileSync(file, `---\ntitle: x\nstatus: active\narchived_at: null\n---\n\n# body\n`);
      await flipArchivedFrontmatter(file, "2026-07-26T10:00:00Z");
      expect(readFileSync(file, "utf-8")).toBe(
        `---\ntitle: x\nstatus: archived\narchived_at: 2026-07-26T10:00:00Z\n---\n\n# body\n`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("stampShippedIn", () => {
  test("a CRLF plan is stamped instead of refused, and keeps CRLF", async () => {
    const dir = mkdtempSync(join(tmpdir(), "stamp-eol-"));
    const file = join(dir, "M1.md");
    try {
      writeFileSync(file, `---\r\nmilestone: M1\r\nstatus: archived\r\n---\r\n\r\n# M1 — x\r\n`);
      await stampShippedIn(file, "2.56.0");
      const out = readFileSync(file, "utf-8");
      expect(out).toContain("shipped_in: v2.56.0");
      expect(out).toContain("\r\n");
      expect(out).not.toContain("\n\n\r"); // no mangled endings
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("writers never rewrite content the edit did not touch", () => {
  test("flipArchivedFrontmatter: CRLF frontmatter + LF body keeps the body LF", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mixed-flip-"));
    const file = join(dir, "STE-1.md");
    try {
      writeFileSync(
        file,
        "---\r\ntitle: x\r\nstatus: active\r\narchived_at: null\r\n---\r\n\nBody 1\nBody 2\n",
      );
      await flipArchivedFrontmatter(file, "2026-07-26T10:00:00Z");
      const out = readFileSync(file, "utf-8");
      expect(out).toBe(
        "---\r\ntitle: x\r\nstatus: archived\r\narchived_at: 2026-07-26T10:00:00Z\r\n---\r\n\nBody 1\nBody 2\n",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("flipArchivedFrontmatter: a lone CR in the BODY survives the flip", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lonecr-flip-"));
    const file = join(dir, "STE-1.md");
    try {
      // A lone \r as literal content (pasted progress output), not a line
      // separator. Folding the whole document would destroy it irreversibly.
      writeFileSync(
        file,
        "---\ntitle: x\nstatus: active\narchived_at: null\n---\n\nProgress: 50%\rProgress: 100%\n",
      );
      await flipArchivedFrontmatter(file, "2026-07-26T10:00:00Z");
      const out = readFileSync(file, "utf-8");
      expect(out).toContain("50%\rProgress: 100%");
      expect(out).toContain("status: archived");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("stampShippedIn: CRLF plan + LF body stamps without touching the body", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mixed-stamp-"));
    const file = join(dir, "M1.md");
    try {
      writeFileSync(file, "---\r\nmilestone: M1\r\nstatus: archived\r\n---\r\n\nPlan body\nline two\n");
      await stampShippedIn(file, "2.56.0");
      const out = readFileSync(file, "utf-8");
      expect(out).toContain("shipped_in: v2.56.0\r\n");
      expect(out).toContain("Plan body\nline two");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("stampShippedIn still distinguishes 'never opened' from 'never closes'", async () => {
    const dir = mkdtempSync(join(tmpdir(), "stamp-refuse-"));
    try {
      const noFm = join(dir, "M1.md");
      writeFileSync(noFm, "# M1 — no frontmatter\n");
      await expect(stampShippedIn(noFm, "2.56.0")).rejects.toThrow(/no YAML frontmatter block/);

      const unclosed = join(dir, "M2.md");
      writeFileSync(unclosed, "---\nmilestone: M2\nnever closes\n");
      await expect(stampShippedIn(unclosed, "2.56.0")).rejects.toThrow(/never closes/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("an LF-only file round-trips byte-identically (strict widening)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lf-widen-"));
    const file = join(dir, "STE-1.md");
    try {
      writeFileSync(file, "---\ntitle: x\nstatus: archived\narchived_at: 2026-01-01T00:00:00Z\n---\n\n# body\n");
      const before = readFileSync(file, "utf-8");
      await flipArchivedFrontmatter(file, "2026-07-26T10:00:00Z");
      expect(readFileSync(file, "utf-8")).toBe(before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Second sweep — readers the first pass missed, found by the spec-review audit
// ---------------------------------------------------------------------------

describe("lone-CR is a real line ending on the WRITE path too", () => {
  // The first fix widened the READ path but left `splitFrontmatter` anchored on
  // `\r?\n`, so a lone-CR file still fell through to the "no frontmatter"
  // branch — which in flipArchivedFrontmatter PREPENDS a second block. The
  // docstrings claimed lone-CR tolerance the regex did not have.
  const CR_DOC = "---\rtitle: x\rstatus: active\rarchived_at: null\r---\r\r# body\r";

  test("splitFrontmatter parses it and round-trips byte-identically", () => {
    const s = splitFrontmatter(CR_DOC)!;
    expect(s).not.toBeNull();
    expect(s.eol).toBe("\r");
    expect(joinFrontmatter(s, s.lines)).toBe(CR_DOC);
  });

  test("flipArchivedFrontmatter does NOT prepend a second block", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cr-flip-"));
    const file = join(dir, "STE-1.md");
    try {
      writeFileSync(file, CR_DOC);
      await flipArchivedFrontmatter(file, "2026-07-26T10:00:00Z");
      const out = readFileSync(file, "utf-8");
      expect(out.match(/---/g)!.length).toBe(2);
      expect(out).toContain("status: archived\r");
      expect(out).toContain("# body");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("parseFrFrontmatter — shared by probe #26 and the archival assertion", () => {
  // One miss here blinds BOTH milestone-binding surfaces, which is precisely
  // the drift this shared export exists to prevent.
  const expected = { milestone: "M1", status: "active", trackerKey: "linear", trackerId: "STE-1" };

  test.each([
    ["LF", "---\ntitle: x\nmilestone: M1\nstatus: active\ntracker:\n  linear: STE-1\n---\n"],
    ["CRLF", "---\r\ntitle: x\r\nmilestone: M1\r\nstatus: active\r\ntracker:\r\n  linear: STE-1\r\n---\r\n"],
    ["lone CR", "---\rtitle: x\rmilestone: M1\rstatus: active\rtracker:\r  linear: STE-1\r---\r"],
    ["BOM", "﻿---\ntitle: x\nmilestone: M1\nstatus: active\ntracker:\n  linear: STE-1\n---\n"],
  ])("%s yields the same binding", (_n, body) => {
    expect(parseFrFrontmatter(body as string)).toEqual(expected);
  });
});

describe("tdd_probe_helpers — shared by five fork-integrity probes", () => {
  test.each([
    ["LF", "---\ncontext: fork\nagent: tdd-test-writer\nuser-invocable: false\n---\n"],
    ["CRLF", "---\r\ncontext: fork\r\nagent: tdd-test-writer\r\nuser-invocable: false\r\n---\r\n"],
    ["BOM", "﻿---\ncontext: fork\nagent: tdd-test-writer\nuser-invocable: false\n---\n"],
  ])("%s parses the fork-integrity fields", (_n, body) => {
    expect(parseFrontmatterFields(body as string)).toEqual({
      context: "fork",
      agent: "tdd-test-writer",
      "user-invocable": "false",
    });
  });

  test("lineNumberOfKey stays accurate under CRLF", () => {
    expect(lineNumberOfKey("---\r\ncontext: fork\r\nagent: x\r\n---\r\n", "agent")).toBe(
      lineNumberOfKey("---\ncontext: fork\nagent: x\n---\n", "agent"),
    );
  });
});

describe("BOM handling at the edges", () => {
  test("a BOM'd file with no frontmatter keeps its BOM at index 0 after synthesis", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bom-syn-"));
    const file = join(dir, "STE-1.md");
    try {
      writeFileSync(file, "﻿# no frontmatter here\n");
      await flipArchivedFrontmatter(file, "2026-07-26T10:00:00Z");
      const out = readFileSync(file, "utf-8");
      expect(out.charCodeAt(0)).toBe(0xfeff);
      // and it is not buried mid-document
      expect(out.slice(1)).not.toContain("﻿");
      expect(out).toContain("status: archived");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("no frontmatter reader is left unnormalized", () => {
  test("every adapters/ module that anchors on a `---` opener normalizes first", () => {
    // Structural sweep: the convention is only real if it is enforced. A new
    // probe that hand-rolls an opener check without normalizing turns this red.
    const srcDir = join(import.meta.dir, "..", "adapters", "_shared", "src");
    const anchor = /startsWith\("---|=== "---"|!== "---"|\/\^---\\n/;
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
          walk(p);
          continue;
        }
        if (!name.endsWith(".ts") || name.endsWith(".test.ts")) continue;
        const body = readFileSync(p, "utf-8");
        if (!anchor.test(body)) continue;
        if (!/normalizeFrontmatterSource|splitFrontmatter/.test(body)) {
          offenders.push(relative(srcDir, p));
        }
      }
    };
    walk(srcDir);
    expect(offenders).toEqual([]);
  });
});
