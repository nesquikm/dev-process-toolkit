// M137 — THE ARCHIVAL BLIND SPOT, closed as a CLASS rather than one more time.
//
// THE RECURRENCE. A milestone's FRs live in `specs/frs/` while it is open and in
// `specs/frs/archive/` the moment it ships; its plan moves the same way. The
// archive commit is the ONE transition no gate run precedes — the tree changes
// underneath a suite that has already been graded green. A test that reaches its
// own FR through a hardcoded `join(REPO_ROOT, "specs", "frs", "STE-<n>.md")`
// therefore passes every run up to and including the ship, then throws ENOENT on
// the archive commit itself.
//
// This has now bitten this repository FOUR times, and the pattern behind the
// recurrence is the point: each fix was applied to the suites that existed at the
// time, and the NEXT guard someone wrote re-introduced the defect. M137 was
// pre-empted for its two dogfood legs (STE-534, STE-535) and still went red on
// the archive commit, because STE-533 and STE-536 — written afterwards — reached
// for the active tree directly.
//
// So the fix here is not another per-suite fallback. It is a leg that reads the
// SUITE SOURCES THEMSELVES and fails when any of them names a live spec file
// under the repository root without also naming its archived twin. The next
// guard someone adds is caught by a test on the branch that adds it, rather than
// by a red gate at the next archive commit.
//
// WHAT COUNTS AS SAFE — the two idioms this repository already ships:
//
//   (1) THE PAIR. Name both paths and pick whichever exists:
//
//         const active   = join(REPO_ROOT, "specs", "frs", "STE-531.md");
//         const archived = join(REPO_ROOT, "specs", "frs", "archive", "STE-531.md");
//
//       Thirty-eight suites already do this. The guard below accepts it, and
//       pairs strictly BY FILENAME: an archived reference to some other FR does
//       not excuse an unpaired active one.
//
//   (2) THE SHARED RESOLVER. `resolveSpecFile` / `readSpecFile` in
//       `tests/_spec_tree.ts`, which does the active-then-archive lookup once
//       and reports WHICH path answered. These take the directory as an
//       argument and never name a rooted active path, so they raise nothing.
//
// WHAT IS DELIBERATELY NOT FLAGGED: staged-fixture keys such as
// `makeTree({ "specs/frs/STE-970.md": body })`. Those name paths inside a temp
// root that the test itself just wrote — they are not reaching for this
// repository's tree at all, and flagging them would make the guard unusable in
// the very suites that need fixture trees most. The discriminator is the ROOT:
// a reference counts only when the expression is anchored at `REPO_ROOT` or a
// `repoRoot` parameter.
//
// FALSIFIABILITY. Six fixture legs below drive the scanner against sources
// written to break each rule — an unpaired FR read, an unpaired plan read, a
// pair whose archive half names the WRONG file, and a template-literal form —
// and against two sources that must stay silent. A guard that returned `[]`
// unconditionally would fail four of them.

import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const TESTS_DIR = import.meta.dir;

/**
 * This file itself. It is excluded from the scan because its fixture sources
 * below quote the very expressions it forbids — the same carve-out
 * `m120-ste-444-jira-binding-prose.test.ts` takes for its own marker list. The
 * exclusion is asserted to be exactly one file so it cannot quietly widen.
 */
const SELF = "m137-archive-blind-spot-class.test.ts";

const read = (abs: string): string => readFileSync(abs, "utf-8");

// ---------------------------------------------------------------- the scanner

/** A rooted reference to one concrete spec file found in a test source. */
interface SpecPathRef {
  /** Basename of the test source the reference was found in. */
  file: string;
  /** 1-indexed line of the expression's first character. */
  line: number;
  /**
   * What the expression names: the spec file (`STE-533.md`, `${id}.md`) for the
   * FILE shape, the repo-relative directory (`specs/frs`, `specs/plan/archive`)
   * for the DIRECTORY shape.
   */
  token: string;
  kind: "active" | "archive";
  /**
   * WHICH SHAPE of the defect this reference is — and the two take two rules,
   * because they fail differently. A hardcoded FILE goes ENOENT at the archive
   * commit and must name its archived twin. A hardcoded DIRECTORY throws
   * nothing: the walk returns `[]` and the suite reports a clean pass over an
   * empty subject, which many suites are legitimately entitled to do, so the
   * directory shape is SEEN here and left to the asymmetry rule below.
   */
  shape: "file" | "directory";
  /** The expression, whitespace collapsed — quoted in failure messages. */
  expression: string;
}

/** An active-tree reference with no archived twin for the same file. */
interface UnpairedRef {
  file: string;
  line: number;
  token: string;
  expression: string;
}

/**
 * Every `join(...)` call in `src`, with its start offset. Parens are balanced by
 * hand rather than by regex so a nested `join(join(...))` or a call spanning
 * several lines comes back whole; a truncated expression would drop the very
 * `"archive"` segment the pairing rule reads.
 */
function joinCalls(src: string): { text: string; at: number }[] {
  const out: { text: string; at: number }[] = [];
  const re = /\bjoin\s*\(/g;
  for (let m = re.exec(src); m !== null; m = re.exec(src)) {
    let depth = 0;
    let i = m.index + m[0].length - 1;
    for (; i < src.length; i++) {
      const ch = src[i];
      if (ch === "(") depth += 1;
      else if (ch === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    if (depth !== 0) continue;
    out.push({ text: src.slice(m.index, i + 1), at: m.index });
  }
  return out;
}

/** Any `.md` string literal — single-quoted, double-quoted or a template. */
const MD_LITERAL = /(["'`])((?:[^"'`\\]|\\.)*?\.md)\1/g;

/**
 * The concrete spec files an expression names. A segment is a spec file when its
 * BASENAME is `STE-<n>.md`, `M<n>.md`, or a single interpolation followed by
 * `.md` (`${id}.md`, `${DOGFOOD_MILESTONE}.md` — both shipped in this repo).
 * Anything else (`plan.md.template`, a fixture called `notes.md`) is not a spec
 * file this rule governs.
 */
function specFileTokens(expression: string): string[] {
  const out: string[] = [];
  for (const m of expression.matchAll(new RegExp(MD_LITERAL.source, "g"))) {
    const base = (m[2] as string).split("/").pop() as string;
    if (/^(?:\$\{[A-Za-z_$][\w$]*\}|STE-\d+|M\d+)\.md$/.test(base)) out.push(base);
  }
  return out;
}

/** 1-indexed line number of character offset `at` in `src`. */
function lineAt(src: string, at: number): number {
  return src.slice(0, at).split("\n").length;
}

/** Top-level, comma-separated arguments of a whitespace-collapsed `join(...)`. */
function joinArgs(expression: string): string[] {
  const open = expression.indexOf("(");
  const inner = expression.slice(open + 1, expression.lastIndexOf(")"));
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of inner) {
    if ("([{".includes(ch)) depth += 1;
    else if (")]}".includes(ch)) depth -= 1;
    else if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim().length > 0) out.push(cur.trim());
  return out;
}

/**
 * The plain string-literal path segments an expression names after its root, or
 * `null` when ANY argument after the root is something else — a spread, an
 * identifier, a call. A directory a reader cannot spell out of the source is a
 * directory this guard declines to claim it recognised.
 */
function literalSegmentsAfterRoot(expression: string): string[] | null {
  const args = joinArgs(expression);
  if (args.length < 2) return null;
  const segments: string[] = [];
  for (const arg of args.slice(1)) {
    const m = /^(["'`])((?:[^"'`\\]|\\.)*)\1$/.exec(arg);
    if (m === null) return null;
    segments.push(m[2] as string);
  }
  return segments;
}

/** The four spec directories the archival rules govern. */
const SPEC_DIRECTORY = /^specs\/(?:frs|plan)(?:\/archive)?$/;

/**
 * Every rooted spec-file reference in one test source.
 *
 * Two shapes are recognised, both anchored at a repository root:
 *
 *   join(REPO_ROOT, "specs", "frs", "STE-533.md")   — the segment form
 *   `${REPO_ROOT}/specs/plan/M137.md`               — the template form
 *
 * `repoRoot` is accepted alongside `REPO_ROOT` because several suites take the
 * root as a parameter so their own fixture legs can pass a temp tree.
 */
export function specPathRefs(file: string, src: string): SpecPathRef[] {
  const refs: SpecPathRef[] = [];

  for (const call of joinCalls(src)) {
    const expression = call.text.replace(/\s+/g, " ");
    if (!/^join\(\s*(?:REPO_ROOT|repoRoot)\b/.test(expression)) continue;
    if (!/specs/.test(expression)) continue;
    if (!/\b(?:frs|plan)\b/.test(expression)) continue;
    const kind = /\barchive\b/.test(expression) ? "archive" : "active";
    const tokens = specFileTokens(expression);
    if (tokens.length > 0) {
      for (const token of tokens) {
        refs.push({
          file,
          line: lineAt(src, call.at),
          token,
          kind,
          shape: "file",
          expression,
        });
      }
      continue;
    }
    // No `.md` literal — so if every argument after the root is a plain string
    // segment and they spell one of the four governed directories, this is the
    // DIRECTORY shape. Requiring plain segments is what keeps
    // `join(repoRoot, ...segments, "archive")` (the shared resolver's own line)
    // out: a spread names no directory a reader can check.
    const segments = literalSegmentsAfterRoot(expression);
    if (segments === null) continue;
    const dir = segments.join("/");
    if (!SPEC_DIRECTORY.test(dir)) continue;
    refs.push({
      file,
      line: lineAt(src, call.at),
      token: dir,
      kind: dir.endsWith("/archive") ? "archive" : "active",
      shape: "directory",
      expression,
    });
  }

  const tpl = /\$\{\s*(?:REPO_ROOT|repoRoot)\s*\}\/(specs\/(?:frs|plan)\/[^`"'\s)]+\.md)/g;
  for (let m = tpl.exec(src); m !== null; m = tpl.exec(src)) {
    const path = m[1] as string;
    const base = path.split("/").pop() as string;
    if (!/^(?:\$\{[A-Za-z_$][\w$]*\}|STE-\d+|M\d+)\.md$/.test(base)) continue;
    refs.push({
      file,
      line: lineAt(src, m.index),
      token: base,
      kind: path.includes("/archive/") ? "archive" : "active",
      shape: "file",
      expression: m[0],
    });
  }

  return refs;
}

/**
 * The active-tree references in `src` that no archived reference in the SAME
 * source pairs with, matched by filename.
 *
 * Same-file is the right scope: a suite that reads an FR must itself know where
 * to look. Filename-matched is the right key: an archived reference to a
 * DIFFERENT spec file proves nothing about the one being read, and a rule that
 * only looked for the word `archive` somewhere in the file would be satisfied by
 * a comment.
 */
export function unpairedActiveRefs(file: string, src: string): UnpairedRef[] {
  const refs = specPathRefs(file, src);
  const archived = new Set(refs.filter((r) => r.kind === "archive").map((r) => r.token));
  const seen = new Set<string>();
  const out: UnpairedRef[] = [];
  for (const r of refs) {
    // The DIRECTORY shape is deliberately not a violation — see `shape`. A
    // suite walking "whatever active specs exist" is correct to measure nothing
    // when there are none; what that shape owes is SYMMETRY between its two
    // paths, which the shared resolver owns and a separate leg grades.
    if (r.shape !== "file") continue;
    if (r.kind !== "active") continue;
    if (archived.has(r.token)) continue;
    if (seen.has(r.token)) continue;
    seen.add(r.token);
    out.push({ file: r.file, line: r.line, token: r.token, expression: r.expression });
  }
  return out;
}

// ------------------------------------------------------------------ the roster

/** Every test-side source the guard scans — `.test.ts` suites and their helpers. */
function scannedSources(): string[] {
  return readdirSync(TESTS_DIR)
    .filter((n) => n.endsWith(".ts") && n !== SELF)
    .sort();
}

/** This milestone's own suites — named so the M137 scope is pinned, not implied. */
const M137_SUITES = [
  "m137-ste-532-stage-status-block.test.ts",
  "m137-ste-533-stage-block-adoption.test.ts",
  "m137-ste-534-fr-word-caps.test.ts",
  "m137-ste-535-plan-narrative-cap.test.ts",
  "m137-ste-536-budget-single-source.test.ts",
];

// ============================================================================
// NON-VACUITY — the scan has a real subject and the extractor really parses it
// ============================================================================

describe("the archive-blind-spot scan has a real subject", () => {
  test("the roster covers this milestone's suites and excludes only this file", () => {
    const scanned = scannedSources();
    for (const suite of M137_SUITES) expect(scanned).toContain(suite);
    expect(scanned).not.toContain(SELF);

    const all = readdirSync(TESTS_DIR).filter((n) => n.endsWith(".ts")).sort();
    // Exactly one carve-out. A guard whose exclusion list grows is a guard that
    // stops guarding, one file at a time.
    expect(all.length - scanned.length).toBe(1);
    expect(all).toContain(SELF);
    // The scan is repository-wide on purpose: scoping it to `m137-*` would leave
    // the M138 suites to rediscover this the hard way.
    expect(scanned.length).toBeGreaterThan(100);
  });

  test("the extractor finds rooted spec references across many suites", () => {
    // A scanner that silently matched nothing would satisfy the "no unpaired
    // references" leg below byte-identically. Measured 2026-08-31: 90 rooted
    // references across 38 sources.
    const refs = scannedSources().flatMap((n) => specPathRefs(n, read(join(TESTS_DIR, n))));
    expect(refs.length).toBeGreaterThanOrEqual(50);
    expect(new Set(refs.map((r) => r.file)).size).toBeGreaterThanOrEqual(20);
    expect(refs.some((r) => r.kind === "active")).toBe(true);
    expect(refs.some((r) => r.kind === "archive")).toBe(true);
    // Both governed spec kinds are actually represented in what it found.
    expect(refs.some((r) => /^STE-\d+\.md$/.test(r.token))).toBe(true);
    expect(refs.some((r) => /^M\d+\.md$/.test(r.token))).toBe(true);
  });

  test("this milestone's own suites are among the sources actually parsed", () => {
    // The M137 scope, stated as a measurement rather than as a comment: at least
    // one of this milestone's suites carries rooted references, so the guard
    // below is grading real M137 material and not just older milestones'.
    const m137Refs = M137_SUITES.flatMap((n) => specPathRefs(n, read(join(TESTS_DIR, n))));
    expect(m137Refs.length).toBeGreaterThan(0);
    expect(m137Refs.some((r) => r.kind === "archive")).toBe(true);
  });
});

// ============================================================================
// THE GUARD
// ============================================================================

describe("no test resolves a spec file by a hardcoded active-tree path", () => {
  test("every rooted active-tree reference names its archived twin too", () => {
    const violations = scannedSources().flatMap((n) =>
      unpairedActiveRefs(n, read(join(TESTS_DIR, n))),
    );
    expect(
      violations.map((v) => `${v.file}:${v.line} — ${v.token} — ${v.expression}`),
      "these reach the active spec tree with no archive fallback; they go ENOENT " +
        "at the archive commit, the one transition no gate run precedes. Pair the " +
        "path, or read it through `resolveSpecFile`/`readSpecFile` in tests/_spec_tree.ts",
    ).toEqual([]);
  });
});

// ============================================================================
// FALSIFIABILITY — the scanner reddens on sources written to break each rule
// ============================================================================

describe("the guard BITES — deliberately hardcoded sources are caught", () => {
  const FIXTURE = "fixture.test.ts";

  test("an unpaired FR read is flagged, with its line and the file it names", () => {
    const src = [
      "const REPO_ROOT = join(import.meta.dir, '..', '..');",
      "test('x', () => {",
      '  const body = read(join(REPO_ROOT, "specs", "frs", "STE-533.md"));',
      "  expect(body).toContain('x');",
      "});",
    ].join("\n");
    const hits = unpairedActiveRefs(FIXTURE, src);
    expect(hits.length).toBe(1);
    expect(hits[0]!.token).toBe("STE-533.md");
    expect(hits[0]!.line).toBe(3);
    expect(hits[0]!.expression).toContain("specs");
  });

  test("an unpaired PLAN read is flagged too — plans archive on the same commit", () => {
    const src = 'const plan = read(join(REPO_ROOT, "specs", "plan", "M137.md"));';
    const hits = unpairedActiveRefs(FIXTURE, src);
    expect(hits.map((h) => h.token)).toEqual(["M137.md"]);
  });

  test("ISOLATION — the same read WITH its archived twin is silent", () => {
    const src = [
      'const active = join(REPO_ROOT, "specs", "frs", "STE-533.md");',
      'const archived = join(REPO_ROOT, "specs", "frs", "archive", "STE-533.md");',
      "const abs = existsSync(active) ? active : archived;",
    ].join("\n");
    expect(unpairedActiveRefs(FIXTURE, src)).toEqual([]);
    // …and the scanner did see both halves, so the silence is a pairing and not
    // a failure to parse.
    const kinds = specPathRefs(FIXTURE, src).map((r) => r.kind).sort();
    expect(kinds).toEqual(["active", "archive"]);
  });

  test("the pairing is BY FILENAME — an archived twin for a different FR is no excuse", () => {
    // The mutation that a "does the word archive appear" rule would sail past.
    const src = [
      'const active = join(REPO_ROOT, "specs", "frs", "STE-533.md");',
      'const other = join(REPO_ROOT, "specs", "frs", "archive", "STE-999.md");',
    ].join("\n");
    expect(unpairedActiveRefs(FIXTURE, src).map((h) => h.token)).toEqual(["STE-533.md"]);
  });

  test("the template-literal form is caught as well as the segment form", () => {
    const src = "const abs = `${REPO_ROOT}/specs/frs/STE-536.md`;";
    expect(unpairedActiveRefs(FIXTURE, src).map((h) => h.token)).toEqual(["STE-536.md"]);
  });

  test("the SHARED RESOLVER is the sanctioned escape and raises nothing", () => {
    const src = [
      'import { readSpecFile } from "./_spec_tree";',
      'const self = readSpecFile(REPO_ROOT, "specs/frs", "STE-533.md");',
      'expect(["active", "archive"]).toContain(self.source);',
    ].join("\n");
    expect(unpairedActiveRefs(FIXTURE, src)).toEqual([]);
    expect(specPathRefs(FIXTURE, src)).toEqual([]);
  });

  test("STAGED-FIXTURE keys are NOT flagged — the discriminator is the root", () => {
    // These name paths inside a temp tree the test just wrote. Flagging them
    // would false-red every suite that builds a fixture spec tree, which is most
    // of M137. The rooted read on the last line is what must be caught.
    const src = [
      'const fx = makeTree({ "specs/frs/STE-970.md": body, "specs/plan/M909.md": plan });',
      'writeFileSync(join(fx.root, "specs", "frs", "STE-971.md"), body);',
      'const real = read(join(REPO_ROOT, "specs", "plan", "M999.md"));',
    ].join("\n");
    expect(unpairedActiveRefs(FIXTURE, src).map((h) => h.token)).toEqual(["M999.md"]);
  });
});

// ============================================================================
// PR #76 ROUND C — C4: THE GUARD HAD THE BLIND SPOT IT EXISTS TO CATCH
// ============================================================================
//
// THE MEASUREMENT. The guard above recognises a spec reference only when the
// expression names a concrete spec FILE — `STE-533.md`, `M137.md`, `${id}.md`.
// The DIRECTORY form names no file at all:
//
//     mdFilesIn(join(repoRoot, "specs", "frs"))
//
// `specFileTokens` finds no `.md` literal in it, so it yields zero refs and the
// expression is INVISIBLE to a guard written to close this class. Two of this
// milestone's own dogfoods reach the active tree exactly that way — STE-534 and
// STE-536 — and both went unremarked while the guard reported clean.
//
// WHY THE DIRECTORY FORM IS A DIFFERENT FAILURE. A hardcoded FILE path throws
// ENOENT at the archive commit: loud, immediate, unmissable. A hardcoded
// DIRECTORY path does not throw — `mdFilesIn` returns `[]`, the scan measures
// nothing, and the suite reports a clean pass over an empty subject. It is the
// same class arriving quietly, which is the worse half.
//
// SO THE TWO SHAPES TAKE TWO RULES, and conflating them would be a third bug:
//
//   FILE form      — must name its archived twin (the rule above). Unpaired is
//                    a violation, because the failure is a crash.
//   DIRECTORY form — is NOT reported by `unpairedActiveRefs`: plenty of suites
//                    legitimately walk "whatever active specs exist" and are
//                    correct to go vacuous when there are none. What IS a
//                    violation is ASYMMETRY: a suite that milestone-scopes its
//                    ARCHIVE fallback and leaves its ACTIVE walk unfiltered
//                    grades this milestone's rules over the next milestone's
//                    material the moment M138 opens an FR.
//
// The sanctioned escape for the second rule already ships and has never been
// called: `milestoneSpecFiles` in `tests/_spec_tree.ts` filters BOTH paths by
// frontmatter and reports which one answered. Three suites hand-rolled it and
// two of the three got it wrong — the two-renderers defect, in test sources.

const SPEC_TREE_MODULE = "_spec_tree.ts";
const PROSE_ALTITUDE_DOC = join(TESTS_DIR, "..", "docs", "prose-altitude.md");

/** The sources that hand-roll a milestone-scoped active/archive walk. */
function milestoneScopedSources(): string[] {
  return scannedSources().filter(
    (n) => n !== SPEC_TREE_MODULE && read(join(TESTS_DIR, n)).includes("boundToMilestone("),
  );
}

/** The sources that go through the shared milestone-scoped resolver. */
function sharedResolverSources(): string[] {
  return scannedSources().filter((n) =>
    read(join(TESTS_DIR, n)).includes("milestoneSpecFiles("),
  );
}

describe("C4 — the guard SEES the directory form, not only the file form", () => {
  const FIXTURE = "fixture.test.ts";

  test("a rooted ACTIVE spec-directory expression is extracted, with its directory named", () => {
    const src = 'const active = mdFilesIn(join(repoRoot, "specs", "frs"));';
    const refs = specPathRefs(FIXTURE, src);
    expect(refs.map((r) => [r.kind, r.shape, r.token])).toEqual([
      ["active", "directory", "specs/frs"],
    ]);
    expect(refs[0]!.line).toBe(1);
  });

  test("the ARCHIVE directory form is extracted too, and classified as the archive half", () => {
    const src = 'const archived = mdFilesIn(join(REPO_ROOT, "specs", "plan", "archive"));';
    const refs = specPathRefs(FIXTURE, src);
    expect(refs.map((r) => [r.kind, r.shape, r.token])).toEqual([
      ["archive", "directory", "specs/plan/archive"],
    ]);
  });

  test("the FILE form still reports `shape: \"file\"` — the two shapes stay distinguishable", () => {
    const src = 'const abs = join(REPO_ROOT, "specs", "frs", "STE-533.md");';
    const refs = specPathRefs(FIXTURE, src);
    expect(refs.map((r) => [r.kind, r.shape, r.token])).toEqual([
      ["active", "file", "STE-533.md"],
    ]);
  });

  test("a temp-root directory walk is NOT a rooted reference — the discriminator is still the root", () => {
    const src = [
      'const fx = makeTree({ "specs/frs/STE-970.md": body });',
      'const files = mdFilesIn(join(fx.root, "specs", "frs"));',
    ].join("\n");
    expect(specPathRefs(FIXTURE, src)).toEqual([]);
  });

  test("an UNPAIRED directory walk is NOT reported as an unpaired ref — a vacuous walk is not an ENOENT", () => {
    // Deliberate: `filename-convention.test.ts`, `gate-check-root-hygiene.test.ts`
    // and friends walk whatever active specs exist and are correct to measure
    // nothing when there are none. Flagging them would make the guard unusable.
    const src = 'const files = mdFilesIn(join(repoRoot, "specs", "frs"));';
    expect(unpairedActiveRefs(FIXTURE, src)).toEqual([]);
    // …but the ref itself was seen, so the silence is a decision and not a miss.
    expect(specPathRefs(FIXTURE, src).length).toBe(1);
  });

  test("the extractor finds directory-form references in the REAL suite roster", () => {
    // Non-vacuity for the widening: an extractor that matched no directory
    // expression anywhere would satisfy every leg above on fixtures alone.
    const refs = scannedSources().flatMap((n) => specPathRefs(n, read(join(TESTS_DIR, n))));
    const dirs = refs.filter((r) => r.shape === "directory");
    expect(dirs.length).toBeGreaterThanOrEqual(5);
    expect(new Set(dirs.map((r) => r.file)).size).toBeGreaterThanOrEqual(3);
    expect(dirs.some((r) => r.kind === "active")).toBe(true);
    expect(dirs.some((r) => r.kind === "archive")).toBe(true);
    // The file form is still found, so the widening ADDED a shape rather than
    // replacing one.
    expect(refs.some((r) => r.shape === "file")).toBe(true);
  });
});

describe("C4 — a milestone-scoped fallback uses the SHARED resolver, so both paths get filtered", () => {
  test("no suite hand-rolls the milestone-scoped active/archive walk", () => {
    expect(
      milestoneScopedSources(),
      "these filter one path by frontmatter and hand-roll the other; that is the F8 " +
        "defect — the ARCHIVE half scoped to one milestone while the ACTIVE half takes " +
        "every file in the directory, so the moment the next milestone opens an FR this " +
        "milestone's rules are graded over that milestone's material. Route the subject " +
        "through `milestoneSpecFiles` in tests/_spec_tree.ts, which filters BOTH paths " +
        "and reports which one answered",
    ).toEqual([]);
  });

  test("the shared resolver is CALLED — it shipped with zero callers", () => {
    // `milestoneSpecFiles` landed in `_spec_tree.ts` as the sanctioned idiom and
    // measured 2026-09-01 had NO caller at all, while three suites hand-rolled
    // it beside it. A resolver nobody calls cannot be the single owner of
    // anything.
    const callers = sharedResolverSources().filter((n) => n !== SPEC_TREE_MODULE);
    expect(callers.length).toBeGreaterThanOrEqual(3);
  });

  test("exactly ONE file is carved out of the hand-rolling rule, and it is the resolver's home", () => {
    // The rule exempts `_spec_tree.ts` because that is where the walk is
    // SUPPOSED to live. Asserted so the exemption cannot quietly widen.
    const withCall = scannedSources().filter((n) =>
      read(join(TESTS_DIR, n)).includes("boundToMilestone("),
    );
    expect(withCall).toContain(SPEC_TREE_MODULE);
    expect(withCall.filter((n) => n !== SPEC_TREE_MODULE)).toEqual([]);
  });
});

// ============================================================================
// THE META-PATTERN, RECORDED — not as a commit-body line
// ============================================================================

describe("the guard-blind-spot lesson is written where the NEXT guard author reads it", () => {
  test("`docs/prose-altitude.md` records it, with the measurement and the check", () => {
    const doc = readFileSync(PROSE_ALTITUDE_DOC, "utf-8");
    // The pattern: a guard written to close a class shares the class's own
    // blind spot. Sixth instance of "a fix reaches only the clause you name",
    // and the first where the thing not reached was the guard itself.
    expect(doc).toMatch(/class-closing guard/i);
    expect(doc).toMatch(/sixth/i);
    // The two forms, named — the whole content of the lesson is that the guard
    // saw one shape of the defect and not the other.
    expect(doc).toMatch(/directory[ -]form/i);
    expect(doc).toMatch(/file[ -]form/i);
    // The actionable instruction, stated BEFORE the next guard gets written.
    expect(doc).toMatch(/enumerate the forms/i);
    // Anchored to the guard it is about, so a reader can go look at it.
    expect(doc).toContain(SELF);
  });
});
