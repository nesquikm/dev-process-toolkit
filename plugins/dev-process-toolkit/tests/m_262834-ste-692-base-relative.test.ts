// M_262834 / STE-692 — base-relative tests read the shipped grammar and imports.
//
// THE DEFECT, stated once: two suites compare the working tree against `main`
// (or `merge-base HEAD main`) at run time. On the release branch those refs
// were the pre-release tree; after the merge they ARE the release. The STE-589
// guard's main-side counter only knew the old `/^v\d` stamp-literal shape, and
// the STE-608 controls copied a fixed three-file list that misses the module
// `plan_ship_stamp.ts` now imports. Both went red on merged main only.
//
// THE CONTRACT these tests build to, in `tests/_base_relative.ts`:
//
//   * `STAMP_LITERAL_RE: RegExp` — one line carrying a stamp-shaped regex
//     literal, in EITHER shipped form: `/^v\d…` / `/^v(\d…` and the shared
//     grammar `/^(?:v\d…|unreleased)` / `/^(?:v(\d…|unreleased)`.
//   * `stampLiteralCount(src)` — lines of `src` matching STAMP_LITERAL_RE.
//   * `stampLiteralCountsAt(cwd, ref, pathspec)` — per-basename counts on a git
//     ref, using the same STAMP_LITERAL_RE in-process.
//   * `grownStampModules(onMain, live)` — modules whose live count exceeds
//     max(main count, 1), rendered `${f}: ${was} on main -> ${now} now`.
//   * `relativeImportClosure(repoRoot, ref, dir, roots)` — sorted basenames
//     reachable from `roots` via relative `./x` imports/re-exports, read from
//     `git show <ref>:<dir>/<file>`, to a fixed point.
//   * `materializeClosure(repoRoot, ref, dir, roots, outDir)` — writes exactly
//     that closure into outDir, byte-identical to the ref, returns the set.
//
// Filter by AC with `bun test -t "AC-STE-692.N"`.

import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

// Namespace import: a missing helper or export fails each test by name, not
// the whole file at link time.
import * as baseRelative from "./_base_relative";

// ===========================================================================
// Paths and helper access.
// ===========================================================================

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const SHARED_DIR_IN_REPO = "plugins/dev-process-toolkit/adapters/_shared/src";
const SUITE_589 = join(PLUGIN_ROOT, "tests", "m_79b1f6-ste-589-sibling-ship-gate.test.ts");
const SUITE_608 = join(PLUGIN_ROOT, "tests", "m_685ff6-ste-608-numeric-door.test.ts");

/** The last pre-STE-608 commit the STE-608 control was written against. */
const PRE_STE_608_COMMIT = "2c99778c";

const ns = baseRelative as unknown as Record<string, unknown>;

function fn<T>(name: string): T {
  const f = ns[name];
  if (typeof f !== "function") throw new Error(`tests/_base_relative.ts exports no \`${name}\` function`);
  return f as T;
}

function stampRe(): RegExp {
  const re = ns.STAMP_LITERAL_RE;
  if (!(re instanceof RegExp)) throw new Error("tests/_base_relative.ts exports no `STAMP_LITERAL_RE` RegExp");
  return re;
}

const stampLiteralCount = (src: string): number => fn<(s: string) => number>("stampLiteralCount")(src);
const stampLiteralCountsAt = (cwd: string, ref: string, pathspec: string): Map<string, number> =>
  fn<(c: string, r: string, p: string) => Map<string, number>>("stampLiteralCountsAt")(cwd, ref, pathspec);
const grownStampModules = (onMain: Map<string, number>, live: Map<string, string>): string[] =>
  fn<(m: Map<string, number>, l: Map<string, string>) => string[]>("grownStampModules")(onMain, live);
const relativeImportClosure = (repoRoot: string, ref: string, dir: string, roots: string[]): string[] =>
  fn<(a: string, b: string, c: string, d: string[]) => string[]>("relativeImportClosure")(repoRoot, ref, dir, roots);
const materializeClosure = (repoRoot: string, ref: string, dir: string, roots: string[], outDir: string): string[] =>
  fn<(a: string, b: string, c: string, d: string[], e: string) => string[]>("materializeClosure")(
    repoRoot,
    ref,
    dir,
    roots,
    outDir,
  );

// ===========================================================================
// Temp dirs + git.
// ===========================================================================

const temps: string[] = [];
function tempDir(tag: string): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), `ste-692-${tag}-`)));
  temps.push(d);
  return d;
}
afterAll(() => {
  for (const d of temps) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* fall through to rm -rf */
    }
    // Bun's rmSync can leave a git-created .git behind.
    spawnSync("rm", ["-rf", d]);
  }
});

const FIXED_DATE = "2026-01-01T00:00:00Z";
function git(cwd: string, ...args: string[]): string {
  const proc = spawnSync(
    "git",
    ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false", "-c", "init.defaultBranch=main", ...args],
    {
      cwd,
      encoding: "utf-8",
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: FIXED_DATE,
        GIT_COMMITTER_DATE: FIXED_DATE,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
      },
    },
  );
  if (proc.status !== 0) throw new Error(`git ${args.join(" ")} failed (${proc.status}): ${proc.stderr}`);
  return proc.stdout.trim();
}

function writeTree(root: string, files: Record<string, string>): void {
  for (const [rel, body] of Object.entries(files)) {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  }
}

// ===========================================================================
// Literal-shape vocabulary.
// ===========================================================================

const OLD_CAPTURE = "const STAMP_RE = /^v(\\d+\\.\\d+\\.\\d+)$/;";
const OLD_PLAIN = "const STAMP_RE = /^v\\d+\\.\\d+\\.\\d+$/;";
const SHARED_PLAIN = "const STAMP_RE = /^(?:v\\d+\\.\\d+\\.\\d+|unreleased)$/;";
const SHARED_CAPTURE = "const STAMP_RE = /^(?:v(\\d+\\.\\d+\\.\\d+)|unreleased)$/;";

const NON_STAMP_SHAPES: readonly string[] = [
  "  const m = /^v?(\\d+)\\.(\\d+)\\.(\\d+)$/.exec(v.trim());", // live_proof_gate.ts
  '  if (version !== UNRELEASED_STAMP && !/^v?\\d+\\.\\d+\\.\\d+$/.test(version)) {', // plan_ship_stamp.ts
  '  const version = stamp.replace(/^v/, "");', // live_proof_gate.ts
  '  return v.replace(/^v/, "");', // release_surface_agreement.ts
  "const UNRELEASED_HEADING_RE = /^## \\[Unreleased\\]/;",
  'if (stamp === UNRELEASED_STAMP) return "unreleased";',
];

// ===========================================================================
// AC-STE-692.3 / .4 / .7 — the counter recognises both forms, reports gains.
// ===========================================================================

describe("AC-STE-692.3 the stamp-literal counter recognises both shipped forms", () => {
  for (const [label, line] of [
    ["old v<X.Y.Z> capture form", OLD_CAPTURE],
    ["old v<X.Y.Z> plain form", OLD_PLAIN],
    ["shared grammar, plain", SHARED_PLAIN],
    ["shared grammar, capture", SHARED_CAPTURE],
  ] as const) {
    test(`AC-STE-692.3 ${label} is one stamp literal`, () => {
      expect(stampRe().test(line), line).toBe(true);
      expect(stampLiteralCount(`import x from "./y";\n\n${line}\n\nexport const z = 1;\n`)).toBe(1);
    });
  }

  for (const line of NON_STAMP_SHAPES) {
    test(`AC-STE-692.3 non-stamp shape counts 0: ${line.trim()}`, () => {
      expect(stampRe().test(line), line).toBe(false);
      expect(stampLiteralCount(`${line}\n`)).toBe(0);
    });
  }

  test("AC-STE-692.3 the counter counts per line across a module mixing both forms", () => {
    const src = [OLD_CAPTURE, ...NON_STAMP_SHAPES, SHARED_PLAIN, ""].join("\n");
    expect(stampLiteralCount(src)).toBe(2);
  });

  test("AC-STE-692.3 the live repo's three stamp files each carry exactly one literal on main (non-vacuity)", () => {
    const onMain = stampLiteralCountsAt(PLUGIN_ROOT, "main", "adapters/_shared/src/*.ts");
    for (const f of ["plan_ship_coherence.ts", "resume_classifier.ts", "active_plan_ship_ready.ts"]) {
      expect(onMain.get(f), `main-side stamp-literal count for ${f}`).toBe(1);
    }
    // Keys are basenames, not paths.
    for (const k of onMain.keys()) expect(k).toMatch(/^[^/]+\.ts$/);
  });

  test("AC-STE-692.3 the ref-side counter and the in-process counter agree on every shared module at HEAD", () => {
    const atHead = stampLiteralCountsAt(PLUGIN_ROOT, "HEAD", "adapters/_shared/src/*.ts");
    const committed = git(PLUGIN_ROOT, "ls-tree", "--name-only", "HEAD", "adapters/_shared/src/")
      .split("\n")
      .filter((p) => p.endsWith(".ts"))
      .map((p) => p.split("/").pop()!);
    expect(committed.length).toBeGreaterThan(20);
    for (const f of committed) {
      const src = git(PLUGIN_ROOT, "show", `HEAD:./adapters/_shared/src/${f}`);
      expect(atHead.get(f) ?? 0, f).toBe(stampLiteralCount(src));
    }
  });
});

describe("AC-STE-692.4 a second stamp literal of either form is a gain over main", () => {
  const MAIN_ONE = `${SHARED_PLAIN}\n`;
  for (const [label, planted] of [
    ["old form", "const B = /^v\\d+\\.\\d+\\.\\d+$/;"],
    ["shared grammar", "const B = /^(?:v(\\d+\\.\\d+\\.\\d+)|unreleased)$/;"],
  ] as const) {
    test(`AC-STE-692.4 (control) a planted second ${label} literal is reported`, () => {
      const onMain = new Map([["resume_classifier.ts", 1]]);
      const live = new Map([["resume_classifier.ts", `${MAIN_ONE}${planted}\n`]]);
      expect(grownStampModules(onMain, live)).toEqual(["resume_classifier.ts: 1 on main -> 2 now"]);
    });
  }

  test("AC-STE-692.4 a module's first literal is not a gain (max(main, 1)); unchanged counts are not gains", () => {
    const onMain = new Map([
      ["resume_classifier.ts", 1],
      ["other.ts", 2],
    ]);
    const live = new Map([
      ["resume_classifier.ts", MAIN_ONE],
      ["sibling_release.ts", `${OLD_CAPTURE}\n`],
      ["other.ts", `${OLD_PLAIN}\n${SHARED_CAPTURE}\n`],
      ["clean.ts", "export const x = 1;\n"],
    ]);
    expect(grownStampModules(onMain, live)).toEqual([]);
  });

  test("AC-STE-692.4 a brand-new module carrying two literals is reported as 0 on main -> 2 now", () => {
    const live = new Map([["new_mod.ts", `${OLD_PLAIN}\n${SHARED_PLAIN}\n`]]);
    expect(grownStampModules(new Map(), live)).toEqual(["new_mod.ts: 0 on main -> 2 now"]);
  });
});

// ===========================================================================
// AC-STE-692.5 / .7 — the relative-import closure walk.
// ===========================================================================

function closureFixture(): { root: string; sha: string } {
  const root = tempDir("closure");
  git(root, "init", "-q");
  writeTree(root, {
    "src/a.ts": 'import { b } from "./b";\nexport const a = b + 1;\n',
    "src/b.ts": [
      "import {",
      "  c,",
      "  type C,",
      '} from "./c";',
      "export const b: C = c;",
      "",
    ].join("\n"),
    "src/c.ts": 'export * from "./d";\nexport type C = number;\nexport const c = 1;\n',
    "src/d.ts": "export const d = 4;\n",
    "src/unreferenced.ts": 'import { a } from "./a";\nexport const u = a;\n',
    "src/also_unreferenced.ts": "export const z = 0;\n",
  });
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "fixture");
  return { root, sha: git(root, "rev-parse", "HEAD") };
}

describe("AC-STE-692.5 the closure walk follows relative imports transitively, and nothing else", () => {
  test("AC-STE-692.5 a -> b -> c -> d is followed (multi-line import + re-export); unreferenced modules are not", () => {
    const { root, sha } = closureFixture();
    const got = relativeImportClosure(root, sha, "src", ["a.ts"]);
    expect(got).toEqual(["a.ts", "b.ts", "c.ts", "d.ts"]);
    // AC-STE-692.7: a fixed list is distinguishable from the walk.
    expect(got).not.toEqual(["a.ts", "b.ts"]);
    expect(got).not.toContain("unreferenced.ts");
    expect(got).not.toContain("also_unreferenced.ts");
  });

  test("AC-STE-692.5 the walk reads the REF, not the working tree", () => {
    const { root, sha } = closureFixture();
    // Working-tree edit adds an import the ref does not have.
    writeFileSync(join(root, "src", "d.ts"), 'import { z } from "./also_unreferenced";\nexport const d = z;\n');
    expect(relativeImportClosure(root, sha, "src", ["a.ts"])).toEqual(["a.ts", "b.ts", "c.ts", "d.ts"]);
    git(root, "commit", "-q", "-am", "d imports also_unreferenced");
    expect(relativeImportClosure(root, "HEAD", "src", ["a.ts"])).toEqual([
      "a.ts",
      "also_unreferenced.ts",
      "b.ts",
      "c.ts",
      "d.ts",
    ]);
  });

  test("AC-STE-692.5 materializeClosure copies exactly the closure, byte-identical to the ref, and returns the set", () => {
    const { root, sha } = closureFixture();
    const out = tempDir("materialized");
    const copied = materializeClosure(root, sha, "src", ["b.ts"], out);
    expect(copied).toEqual(["b.ts", "c.ts", "d.ts"]);
    expect(readdirSync(out).sort()).toEqual(["b.ts", "c.ts", "d.ts"]);
    for (const f of copied) {
      expect(readFileSync(join(out, f), "utf-8"), f).toBe(`${git(root, "show", `${sha}:src/${f}`)}\n`);
    }
  });

  test("AC-STE-692.5 the real pre-STE-608 closure of archive_fr.ts + plan_ship_stamp.ts is exactly three modules", () => {
    const got = relativeImportClosure(REPO_ROOT, PRE_STE_608_COMMIT, SHARED_DIR_IN_REPO, ["archive_fr.ts", "plan_ship_stamp.ts"]);
    expect(got).toEqual(["archive_fr.ts", "frontmatter.ts", "plan_ship_stamp.ts"]);
  });

  test("AC-STE-692.7 at HEAD the same roots reach active_plan_ship_ready.ts and its multi-line imports (the fixed list misses them)", () => {
    const got = relativeImportClosure(REPO_ROOT, "HEAD", SHARED_DIR_IN_REPO, ["archive_fr.ts", "plan_ship_stamp.ts"]);
    expect(got).toContain("active_plan_ship_ready.ts");
    expect(got).toContain("workspace_binding.ts"); // reached only through a multi-line import
    expect(got).toEqual([...got].sort());
    expect(got).not.toEqual(["archive_fr.ts", "frontmatter.ts", "plan_ship_stamp.ts"]);
  });
});

describe("AC-STE-692.5 source pins on the two base-relative suites", () => {
  test("AC-STE-692.5 the STE-608 suite's baseModules() reads a named pinned commit, never merge-base HEAD main", () => {
    const src = readFileSync(SUITE_608, "utf-8");
    expect(src).not.toContain('"merge-base", "HEAD", "main"');
    expect(src).toMatch(new RegExp(`const\\s+\\w+\\s*=\\s*"${PRE_STE_608_COMMIT}[0-9a-f]*"`));
    const body = /function baseModules\([^)]*\)[^{]*\{[\s\S]*?\n\}/.exec(src)?.[0] ?? "";
    expect(body, "baseModules() is defined").not.toBe("");
    const constName = new RegExp(`const\\s+(\\w+)\\s*=\\s*"${PRE_STE_608_COMMIT}[0-9a-f]*"`).exec(src)?.[1] ?? "<none>";
    expect(body).toContain(constName);
    expect(body).toMatch(/materializeClosure|relativeImportClosure/);
    expect(src).toMatch(/from\s+"\.\/_base_relative"/);
  });

  test("AC-STE-692.3 the STE-589 suite imports STAMP_LITERAL_RE from ./_base_relative and defines no private copy", () => {
    const src = readFileSync(SUITE_589, "utf-8");
    expect(src).toMatch(/import\s*\{[^}]*\bSTAMP_LITERAL_RE\b[^}]*\}\s*from\s*"\.\/_base_relative"/);
    expect(src).not.toMatch(/const\s+STAMP_LITERAL_RE\s*=/);
  });
});

// ===========================================================================
// AC-STE-692.6 — merged-tree simulation: branch shape and merged shape.
// ===========================================================================

const FIX_DIR = "adapters/_shared/src";
const FIX_SPEC = "adapters/_shared/src/*.ts";

/**
 * The fixture's base commit — main before the branch's change. Pinned as a
 * named constant (deterministic: fixed author, committer and dates), never
 * derived from merge-base, which equals HEAD once main contains the change.
 */
const FIXTURE_BASE_SHA = "bfd3be8ac12d180abf2aea017b830c019aa5dd0d";

const BASE_TREE: Record<string, string> = {
  [`${FIX_DIR}/frontmatter.ts`]: "export const splitFrontmatter = (s: string) => s;\n",
  [`${FIX_DIR}/archive_fr.ts`]: 'import { splitFrontmatter } from "./frontmatter";\nexport const archive = splitFrontmatter;\n',
  [`${FIX_DIR}/plan_ship_stamp.ts`]: [
    'import { splitFrontmatter } from "./frontmatter";',
    'export const UNRELEASED = "unreleased";',
    "export function ok(v: string) {",
    "  return /^v?\\d+\\.\\d+\\.\\d+$/.test(v) && splitFrontmatter(v) === v;",
    "}",
    "",
  ].join("\n"),
  [`${FIX_DIR}/plan_ship_coherence.ts`]: `${OLD_CAPTURE}\nexport const f = (s: string) => STAMP_RE.exec(s);\n`,
  [`${FIX_DIR}/resume_classifier.ts`]: `${OLD_PLAIN}\nexport const g = (s: string) => STAMP_RE.test(s);\n`,
  [`${FIX_DIR}/active_plan_ship_ready.ts`]: [
    'import { splitFrontmatter } from "./frontmatter";',
    OLD_PLAIN,
    'export const UNRELEASED_STAMP = "unreleased";',
    "export const h = (s: string) => STAMP_RE.test(splitFrontmatter(s));",
    "",
  ].join("\n"),
  [`${FIX_DIR}/sibling_release.ts`]: "export const v = (s: string) => /^v(\\d+\\.\\d+\\.\\d+)$/.exec(s.trim())?.[1] ?? null;\n",
  [`${FIX_DIR}/live_proof_gate.ts`]: "export const p = (v: string) => /^v?(\\d+)\\.(\\d+)\\.(\\d+)$/.exec(v);\n",
};

const BRANCH_CHANGE: Record<string, string> = {
  [`${FIX_DIR}/plan_ship_coherence.ts`]: `${SHARED_CAPTURE}\nexport const f = (s: string) => STAMP_RE.exec(s);\n`,
  [`${FIX_DIR}/resume_classifier.ts`]: `${SHARED_PLAIN}\nexport const g = (s: string) => STAMP_RE.test(s);\n`,
  [`${FIX_DIR}/active_plan_ship_ready.ts`]: [
    'import { splitFrontmatter } from "./frontmatter";',
    SHARED_PLAIN,
    'export const UNRELEASED_STAMP = "unreleased";',
    "export const h = (s: string) => STAMP_RE.test(splitFrontmatter(s));",
    "",
  ].join("\n"),
  [`${FIX_DIR}/plan_ship_stamp.ts`]: [
    'import { splitFrontmatter } from "./frontmatter";',
    'import { UNRELEASED_STAMP } from "./active_plan_ship_ready";',
    "export const UNRELEASED = UNRELEASED_STAMP;",
    "export function ok(v: string) {",
    "  return /^v?\\d+\\.\\d+\\.\\d+$/.test(v) && splitFrontmatter(v) === v;",
    "}",
    "",
  ].join("\n"),
};

type Shape = "branch" | "merged";

function simulatedRepo(shape: Shape): { root: string; base: string } {
  const root = tempDir(`sim-${shape}`);
  git(root, "init", "-q");
  writeTree(root, BASE_TREE);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "base");
  const base = git(root, "rev-parse", "HEAD");
  git(root, "checkout", "-q", "-b", "feat");
  writeTree(root, BRANCH_CHANGE);
  git(root, "commit", "-q", "-am", "shared grammar + import");
  if (shape === "merged") {
    git(root, "checkout", "-q", "main");
    git(root, "merge", "-q", "--ff-only", "feat");
  }
  return { root, base };
}

function liveSources(root: string): Map<string, string> {
  const dir = join(root, FIX_DIR);
  return new Map(
    readdirSync(dir)
      .filter((f) => f.endsWith(".ts"))
      .map((f) => [f, readFileSync(join(dir, f), "utf-8")] as const),
  );
}

const STAMP_FILES = ["plan_ship_coherence.ts", "resume_classifier.ts", "active_plan_ship_ready.ts"] as const;
const PRE_CHANGE_CLOSURE = ["archive_fr.ts", "frontmatter.ts", "plan_ship_stamp.ts"];

describe("AC-STE-692.6 merged-tree simulation: both checks pass in branch shape and merged shape", () => {
  test("AC-STE-692.6 the fixture base sha is deterministic and equals the pinned constant", () => {
    const { base } = simulatedRepo("branch");
    expect(base).toBe(FIXTURE_BASE_SHA);
  });

  for (const shape of ["branch", "merged"] as const) {
    test(`AC-STE-692.6 [${shape}] merge-base shape is as named`, () => {
      const { root } = simulatedRepo(shape);
      const mb = git(root, "merge-base", "HEAD", "main");
      const head = git(root, "rev-parse", "HEAD");
      if (shape === "merged") expect(mb).toBe(head);
      else expect(mb).not.toBe(head);
    });

    test(`AC-STE-692.6 [${shape}] STE-589 check: main carries exactly one stamp literal per stamp file, and nothing grew`, () => {
      const { root } = simulatedRepo(shape);
      const onMain = stampLiteralCountsAt(root, "main", FIX_SPEC);
      for (const f of STAMP_FILES) expect(onMain.get(f), `${shape}: main-side count for ${f}`).toBe(1);
      expect(onMain.get("sibling_release.ts")).toBe(1);
      expect(onMain.get("live_proof_gate.ts") ?? 0).toBe(0);
      expect(onMain.get("plan_ship_stamp.ts") ?? 0).toBe(0);
      const grown = grownStampModules(onMain, liveSources(root));
      expect(grown, grown.join("\n")).toEqual([]);
    });

    test(`AC-STE-692.6 [${shape}] STE-608 check: the pinned pre-change closure is unchanged, and the head closure reaches the new import`, () => {
      const { root, base } = simulatedRepo(shape);
      expect(base).toBe(FIXTURE_BASE_SHA);
      const roots = ["archive_fr.ts", "plan_ship_stamp.ts"];
      expect(relativeImportClosure(root, FIXTURE_BASE_SHA, FIX_DIR, roots)).toEqual(PRE_CHANGE_CLOSURE);
      const atHead = relativeImportClosure(root, "HEAD", FIX_DIR, roots);
      expect(atHead).toEqual(["active_plan_ship_ready.ts", "archive_fr.ts", "frontmatter.ts", "plan_ship_stamp.ts"]);
      const out = tempDir(`sim-${shape}-mat`);
      expect(materializeClosure(root, FIXTURE_BASE_SHA, FIX_DIR, roots, out)).toEqual(PRE_CHANGE_CLOSURE);
      expect(readdirSync(out).sort()).toEqual(PRE_CHANGE_CLOSURE);
    });
  }

  test("AC-STE-692.7 (control) in merged shape main carries ONLY the shared grammar, so an old-form-only counter sees 0", () => {
    const { root } = simulatedRepo("merged");
    const oldOnly = /\/\^v\(?\\d/;
    for (const f of STAMP_FILES) {
      const src = git(root, "show", `main:${FIX_DIR}/${f}`);
      expect(src.split("\n").filter((l) => oldOnly.test(l)).length, f).toBe(0);
      expect(stampLiteralCount(src), f).toBe(1);
    }
  });
});
