// M104 STE-384 — the retired `.dpt-locks` / `.dev-process` literals cannot
// reappear in the live tree.
//
// WHAT THIS FILE IS, vs. WHAT IT COVERS
// -------------------------------------
// This FR's *deliverable is itself a test*: `tests/dpt-path-drift.test.ts`, a
// grep meta-test on the STE-49 shape. So this file is not that test — it is the
// coverage proving that test is real and fires. The split:
//
//   tests/dpt-path-drift.test.ts  — the live gate. Scans the real tree, must be
//                                   GREEN at all times (AC-STE-384.5).
//   tests/_dpt-path-drift.ts      — the scan primitive both files share.
//   this file                     — drives the primitive over FIXTURE trees, so
//                                   the tripwire's failure polarity is proven
//                                   (AC-STE-384.4) instead of assumed.
//
// WHY THE PRIMITIVE IS FACTORED OUT AT ALL. STE-49's `archive-path-drift.test.ts`
// inlines its whole scan in one `test()` body. That shape cannot satisfy AC.4:
// a gate that only ever runs against a clean tree is indistinguishable from a
// gate that greps for a typo and can never fire. Parameterising the target list
// is the minimum change that makes "it actually fires" checkable, and it is
// forced by AC.4 — not a stylistic preference. Everything else about STE-49's
// shape (base + `optionalTargets.filter(existsSync)`, `grep -rn`, throw naming
// `file:line`) is preserved.
//
// The primitive lives in a `_`-prefixed NON-test module (the `tests/_skill-md.ts`
// precedent) rather than being exported from `dpt-path-drift.test.ts` directly:
// bun resolves an imported `.test.ts` through the module cache, so importing one
// test file from another registers the imported file's tests into the importer's
// run whenever the importer is run alone (`bun test tests/m104-ste-384-…`).
// Verified 2026-07-15 on bun 1.3.14: "Ran 2 tests across 1 file". A `_` module
// has no such hazard.
//
// AC coverage:
//   AC-STE-384.1 — the literals, the file:line naming, the AC.1 scan scope.
//   AC-STE-384.2 — the history allow-list + the `*.test.ts` decoy carve-out.
//   AC-STE-384.3 — `.filter(existsSync)` tolerance + STE-49's stale comment.
//   AC-STE-384.4 — the tripwire, both polarities, over real fixture trees.
//   AC-STE-384.5 — the live gate is green and non-vacuous.

import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  RETIRED_LITERAL_PATTERNS,
  assertNoRetiredLiterals,
  dptPathDriftScanTargets,
  findRetiredLiterals,
} from "./_dpt-path-drift";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");

const DRIFT_TEST = join(PLUGIN_ROOT, "tests", "dpt-path-drift.test.ts");
const DRIFT_HELPER = join(PLUGIN_ROOT, "tests", "_dpt-path-drift.ts");
const STE49_TEST = join(PLUGIN_ROOT, "tests", "archive-path-drift.test.ts");

const ULID = "01HZZZQK5T0000000000000001";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const tmpRoots: string[] = [];

/** A throwaway tree; `files` keys are `/`-separated relative paths. */
function makeFixtureTree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "ste-384-"));
  tmpRoots.push(root);
  for (const [rel, body] of Object.entries(files)) {
    const full = join(root, ...rel.split("/"));
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body);
  }
  return root;
}

function cleanupTmpRoots(): void {
  while (tmpRoots.length > 0) {
    const dir = tmpRoots.pop()!;
    if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
}

function git(cwd: string, args: string[]): { exitCode: number; stdout: string } {
  const proc = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  return { exitCode: proc.exitCode, stdout: proc.stdout.toString() };
}

/** The base scan targets AC.1 names as mandatory, as absolute paths. */
const AC1_MANDATORY_TARGETS = [
  join(PLUGIN_ROOT, "docs"),
  join(PLUGIN_ROOT, "skills"),
  join(PLUGIN_ROOT, "adapters"),
  join(PLUGIN_ROOT, "templates"),
  join(REPO_ROOT, "README.md"),
];

// ---------------------------------------------------------------------------
// AC-STE-384.1 — the literals, dot-anchored
// ---------------------------------------------------------------------------

describe("AC-STE-384.1 — both retired literals are covered", () => {
  test("a `.dpt-locks` path in a scanned file is a survivor", () => {
    const root = makeFixtureTree({
      "docs/stale.md": `Research scratch lands in \`.dpt-locks/${ULID}/spec-research-result.txt\`.\n`,
    });
    const survivors = findRetiredLiterals([root]);
    expect(survivors.length).toBe(1);
    expect(survivors[0]!.file).toBe(join(root, "docs", "stale.md"));
    expect(survivors[0]!.line).toBe(1);
    cleanupTmpRoots();
  });

  test("a `.dev-process` path in a scanned file is a survivor", () => {
    const root = makeFixtureTree({
      "docs/stale.md": "Header\n\nThe ledger is at `.dev-process/token-ledger.jsonl`.\n",
    });
    const survivors = findRetiredLiterals([root]);
    expect(survivors.length).toBe(1);
    expect(survivors[0]!.file).toBe(join(root, "docs", "stale.md"));
    expect(survivors[0]!.line).toBe(3);
    cleanupTmpRoots();
  });

  test("the live `.dpt/` paths that REPLACED them are not flagged", () => {
    // The gate must be a drift detector, not a `.dpt` detector — STE-382's
    // whole output is prose naming `.dpt/locks` etc. Flagging it would make
    // the correct end state unreachable.
    const root = makeFixtureTree({
      "docs/live.md": [
        "Locks: `.dpt/locks/<ulid>`.",
        "Ledger: `.dpt/ledger/token-ledger.jsonl`.",
        "Scratch: `.dpt/scratch/<ulid>/spec-research-result.txt`.",
        "",
      ].join("\n"),
    });
    expect(findRetiredLiterals([root])).toEqual([]);
    cleanupTmpRoots();
  });
});

describe("AC-STE-384.1 — every survivor is named by `file:line`", () => {
  test("multiple survivors across multiple files are each reported with their own line", () => {
    const root = makeFixtureTree({
      "docs/a.md": `one\n.dpt-locks/${ULID}\nthree\n`,
      "skills/b/SKILL.md": "x\ny\n`.dev-process/token-ledger.jsonl`\n",
    });
    const seen = findRetiredLiterals([root])
      .map((s) => `${s.file}:${s.line}`)
      .sort();
    expect(seen).toEqual(
      [
        `${join(root, "docs", "a.md")}:2`,
        `${join(root, "skills", "b", "SKILL.md")}:3`,
      ].sort(),
    );
    cleanupTmpRoots();
  });

  test("two survivors on DIFFERENT lines of one file are reported separately", () => {
    const root = makeFixtureTree({
      "docs/a.md": `.dpt-locks/${ULID}\nclean line\n.dev-process/token-ledger.jsonl\n`,
    });
    expect(findRetiredLiterals([root]).map((s) => s.line).sort()).toEqual([1, 3]);
    cleanupTmpRoots();
  });

  test("the survivor carries the offending source text, so the failure is actionable", () => {
    const root = makeFixtureTree({
      "docs/a.md": `Locks live at \`.dpt-locks/${ULID}\` today.\n`,
    });
    const [survivor] = findRetiredLiterals([root]);
    expect(survivor!.text).toContain(".dpt-locks");
    expect(survivor!.text.trim()).toBe(`Locks live at \`.dpt-locks/${ULID}\` today.`);
    cleanupTmpRoots();
  });
});

// The load-bearing constraint. A maintainer who "simplifies" the pattern to a
// bare `dev-process` drowns the gate in ~295 hits across 84 files (measured
// 2026-07-15) — every one of them this plugin's own name. These two tests are
// the thing standing between that edit and a merged PR.
describe("AC-STE-384.1 — the `.dev-process` pattern is DOT-ANCHORED", () => {
  test("every declared pattern is anchored on a literal dot", () => {
    expect(RETIRED_LITERAL_PATTERNS.length).toBeGreaterThan(0);
    for (const pattern of RETIRED_LITERAL_PATTERNS) {
      expect(pattern.startsWith("\\.")).toBe(true);
    }
  });

  test("the plugin's OWN name never trips the gate, in any of the forms it really appears in", () => {
    const root = makeFixtureTree({
      "docs/plugin-name.md": [
        "Install from `plugins/dev-process-toolkit/`.",
        "Run `/dev-process-toolkit:implement` to build.",
        "The dev-process-toolkit plugin encodes a dev-process for agents.",
        "See https://example.test/dev-process-toolkit/docs.",
        "",
      ].join("\n"),
    });
    expect(findRetiredLiterals([root])).toEqual([]);
    cleanupTmpRoots();
  });

  test("the anchor discriminates: `.dev-process` fires where `dev-process-toolkit` does not, in the SAME file", () => {
    const root = makeFixtureTree({
      "docs/mixed.md": [
        "The plugins/dev-process-toolkit/ tree is fine.",
        "But `.dev-process/token-ledger.jsonl` is retired.",
        "",
      ].join("\n"),
    });
    const survivors = findRetiredLiterals([root]);
    expect(survivors.length).toBe(1);
    expect(survivors[0]!.line).toBe(2);
    cleanupTmpRoots();
  });
});

// ---------------------------------------------------------------------------
// AC-STE-384.1 — the scan scope
// ---------------------------------------------------------------------------

describe("AC-STE-384.1 — the declared scope is actually scanned", () => {
  test("scan targets cover docs, skills, adapters, templates, and README.md", () => {
    // Superset, not equality: AC.3 permits optional cross-cutting-spec targets
    // on top of this floor. What AC.1 fixes is that these five are never absent.
    const targets = dptPathDriftScanTargets(PLUGIN_ROOT, REPO_ROOT);
    for (const mandatory of AC1_MANDATORY_TARGETS) {
      expect(targets).toContain(mandatory);
    }
  });

  test("`adapters/` is in scope — this FR widens past STE-49's precedent", () => {
    // Called out on its own because it is the widening that forced the AC.2
    // decoy carve-out. If a future edit drops `adapters/` to make the gate
    // quiet, that is the bug the carve-out exists to avoid needing.
    expect(dptPathDriftScanTargets(PLUGIN_ROOT, REPO_ROOT)).toContain(
      join(PLUGIN_ROOT, "adapters"),
    );
  });

  test("the scan recurses — a literal nested deep under a target directory is found", () => {
    const root = makeFixtureTree({
      "skills/deep/nested/further/SKILL.md": `See \`.dpt-locks/${ULID}\`.\n`,
    });
    expect(findRetiredLiterals([root]).map((s) => s.line)).toEqual([1]);
    cleanupTmpRoots();
  });
});

// ---------------------------------------------------------------------------
// AC-STE-384.2 — the allow-list
// ---------------------------------------------------------------------------

describe("AC-STE-384.2 — the `*.test.ts` decoy carve-out", () => {
  test("a `.test.ts` file constructing the retired literal is exempt", () => {
    // STE-382's regression guards assert the legacy literal is NOT scanned and
    // NOT fallen back to. There the literal is the subject under test; deleting
    // it deletes the proof. See FR § Notes, "Decoy carve-out".
    const root = makeFixtureTree({
      "adapters/_shared/src/local_provider.test.ts": [
        `test("claimLock does not write the legacy .dpt-locks/", () => {`,
        `  mkdirSync(join(work, ".dpt-locks"), { recursive: true });`,
        `  expect(existsSync(join(work, ".dpt-locks"))).toBe(false);`,
        "});",
        "",
      ].join("\n"),
    });
    expect(findRetiredLiterals([root])).toEqual([]);
    cleanupTmpRoots();
  });

  test("the carve-out is scoped to `*.test.ts` — a NON-test sibling in the same dir still fires", () => {
    // The carve-out's accepted residual risk (FR § Notes) is bounded to test
    // files. If it leaked to production sources next door, the FR would be
    // guarding nothing where it matters most.
    const root = makeFixtureTree({
      "adapters/_shared/src/local_provider.test.ts": `const legacy = ".dpt-locks";\n`,
      "adapters/_shared/src/local_provider.ts": `const dir = ".dpt-locks";\n`,
    });
    const survivors = findRetiredLiterals([root]);
    expect(survivors.length).toBe(1);
    expect(survivors[0]!.file).toBe(join(root, "adapters", "_shared", "src", "local_provider.ts"));
    cleanupTmpRoots();
  });

  test("a `.test.ts` file is exempt wherever it sits under the scanned tree", () => {
    const root = makeFixtureTree({
      "docs/example.test.ts": `const legacy = ".dev-process";\n`,
      "templates/hooks/sample.test.ts": `const legacy = ".dpt-locks";\n`,
    });
    expect(findRetiredLiterals([root])).toEqual([]);
    cleanupTmpRoots();
  });

  test("the carve-out is a suffix rule, not a substring one — `my.test.ts.md` is NOT exempt", () => {
    // A prose file that merely mentions a test filename must not buy immunity.
    const root = makeFixtureTree({
      "docs/my.test.ts.md": `Locks used to live at \`.dpt-locks/${ULID}\`.\n`,
    });
    expect(findRetiredLiterals([root]).map((s) => s.line)).toEqual([1]);
    cleanupTmpRoots();
  });
});

describe("AC-STE-384.2 — the live decoys this carve-out exists for are real and still exempt", () => {
  test("every `adapters/` retired literal sits in a decoy test or the SoT, and the live scan clears them", () => {
    // Ground truth measured 2026-07-15: local_provider.test.ts (9 hits) +
    // dpt_paths.test.ts (1) — all `*.test.ts` decoys. If a future edit moves a
    // decoy into a non-test file, this goes red and the carve-out gets
    // revisited deliberately.
    //
    // REVISITED DELIBERATELY — M108 STE-391 (AC-STE-391.8). The migration
    // registry added the first legitimate NON-test home for these literals:
    // `migrations/legacy_paths.ts`, the retired-path single source of truth
    // that `/upgrade`'s detectors import from. That file is the second allowed
    // shape here, and it is named EXACTLY — not `migrations/**`, which would
    // let an entry re-spell a literal inline and slip past. Its sibling
    // `migrations/index.test.ts` rides the pre-existing `.test.ts` decoy rule.
    const LEGACY_PATHS_SOT = join(
      PLUGIN_ROOT,
      "adapters",
      "_shared",
      "src",
      "migrations",
      "legacy_paths.ts",
    );
    const raw = Bun.spawnSync(
      ["grep", "-rnE", "\\.dpt-locks|\\.dev-process", join(PLUGIN_ROOT, "adapters")],
      { stdout: "pipe", stderr: "pipe" },
    );
    const hits = raw.stdout.toString().trim().split("\n").filter((l) => l.length > 0);
    expect(hits.length).toBeGreaterThan(0);

    const files = new Set(hits.map((hit) => hit.split(":")[0]!));
    for (const file of files) {
      if (file === LEGACY_PATHS_SOT) continue;
      expect(file).toMatch(/\.test\.ts$/);
    }
    // Non-vacuous both ways: the SoT really does carry the literals (so the
    // carve-out is load-bearing, not decorative), and the scan still clears
    // the whole tree.
    expect(files).toContain(LEGACY_PATHS_SOT);
    expect(findRetiredLiterals([join(PLUGIN_ROOT, "adapters")])).toEqual([]);
  });
});

describe("AC-STE-384.2 — history surfaces are exempt: they record what the old layout WAS", () => {
  test("CHANGELOG.md is not scanned, and it really does carry retired literals", () => {
    // Both halves matter. The second is what makes the exemption load-bearing
    // rather than decorative — without it the gate is red on a correct tree.
    const changelog = join(REPO_ROOT, "CHANGELOG.md");
    expect(readFileSync(changelog, "utf-8")).toMatch(/\.dpt-locks|\.dev-process/);
    expect(dptPathDriftScanTargets(PLUGIN_ROOT, REPO_ROOT)).not.toContain(changelog);
  });

  test("`specs/frs/archive/**` and `specs/plan/archive/**` are not scanned", () => {
    const targets = dptPathDriftScanTargets(PLUGIN_ROOT, REPO_ROOT);
    for (const archive of [
      join(REPO_ROOT, "specs", "frs", "archive"),
      join(REPO_ROOT, "specs", "plan", "archive"),
    ]) {
      expect(targets).not.toContain(archive);
      for (const target of targets) {
        expect(archive.startsWith(target)).toBe(false);
      }
    }
  });

  test("the archives really do carry retired literals — the exemption is load-bearing", () => {
    for (const archive of [
      join(REPO_ROOT, "specs", "frs", "archive"),
      join(REPO_ROOT, "specs", "plan", "archive"),
    ]) {
      const proc = Bun.spawnSync(["grep", "-rlE", "\\.dpt-locks|\\.dev-process", archive], {
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(proc.stdout.toString().trim().length).toBeGreaterThan(0);
    }
  });
});

describe("AC-STE-384.2 — every exemption states WHY, in a comment", () => {
  // "An unexplained exemption is a bug" — AC.2. An allow-list entry with no
  // rationale is indistinguishable from one added to silence a real failure,
  // which is precisely the drift this FR exists to prevent.
  const helperSrc = (): string => readFileSync(DRIFT_HELPER, "utf-8");

  test("the helper carries comment prose naming the `*.test.ts` carve-out AND its reason", () => {
    const src = helperSrc();
    const comments = src
      .split("\n")
      .filter((l) => /^\s*(\/\/|\*|\/\*)/.test(l))
      .join("\n");
    expect(comments).toMatch(/\.test\.ts/);
    expect(comments).toMatch(/decoy|negative[- ]case|subject under test|deliberate/i);
  });

  test("the helper explains why the history surfaces are out of scope", () => {
    const comments = helperSrc()
      .split("\n")
      .filter((l) => /^\s*(\/\/|\*|\/\*)/.test(l))
      .join("\n");
    expect(comments).toMatch(/CHANGELOG/);
    expect(comments).toMatch(/archive/i);
    expect(comments).toMatch(/histor|record|what the old layout|must not be rewritten/i);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-384.3 — optional-target tolerance
// ---------------------------------------------------------------------------

describe("AC-STE-384.3 — absent optional targets are tolerated, not fatal", () => {
  test("every returned scan target exists — nothing absent is ever handed to grep", () => {
    for (const target of dptPathDriftScanTargets(PLUGIN_ROOT, REPO_ROOT)) {
      expect(existsSync(target)).toBe(true);
    }
  });

  test("a consumer tree carrying no cross-cutting specs still resolves a usable target list", () => {
    // The AC.3 scenario verbatim: a downstream project running this plugin's
    // `/gate-check` may not carry every cross-cutting spec file.
    const root = makeFixtureTree({
      "plugins/dev-process-toolkit/docs/x.md": "clean\n",
      "plugins/dev-process-toolkit/skills/s/SKILL.md": "clean\n",
      "plugins/dev-process-toolkit/adapters/a.ts": "export const a = 1;\n",
      "plugins/dev-process-toolkit/templates/t.template": "clean\n",
      "README.md": "clean\n",
    });
    const pluginRoot = join(root, "plugins", "dev-process-toolkit");
    expect(existsSync(join(root, "specs"))).toBe(false);

    const targets = dptPathDriftScanTargets(pluginRoot, root);

    for (const target of targets) {
      expect(existsSync(target)).toBe(true);
    }
    expect(targets).toContain(join(pluginRoot, "docs"));
    expect(targets).toContain(join(root, "README.md"));
    // …and the scan over that list is clean, i.e. the absence produced no
    // grep error masquerading as a pass.
    expect(findRetiredLiterals(targets)).toEqual([]);
    cleanupTmpRoots();
  });

  test("an absent optional target does not suppress a REAL survivor elsewhere", () => {
    // The tolerance must not become a swallow-everything catch. grep exits >=2
    // on a missing operand; a naive `status !== 0` read would call that clean.
    const root = makeFixtureTree({
      "plugins/dev-process-toolkit/docs/x.md": `bad: \`.dpt-locks/${ULID}\`\n`,
      "plugins/dev-process-toolkit/skills/s/SKILL.md": "clean\n",
      "plugins/dev-process-toolkit/adapters/a.ts": "export const a = 1;\n",
      "plugins/dev-process-toolkit/templates/t.template": "clean\n",
      "README.md": "clean\n",
    });
    const pluginRoot = join(root, "plugins", "dev-process-toolkit");
    const targets = dptPathDriftScanTargets(pluginRoot, root);
    const survivors = findRetiredLiterals(targets);
    expect(survivors.length).toBe(1);
    expect(survivors[0]!.file).toBe(join(pluginRoot, "docs", "x.md"));
    cleanupTmpRoots();
  });
});

// ---------------------------------------------------------------------------
// AC-STE-384.3 — STE-49's stale comment
// ---------------------------------------------------------------------------

describe("AC-STE-384.3 — the FALSE `specs/`-is-gitignored claim is corrected at the source", () => {
  test("GROUND TRUTH: `specs/` is not ignored and is heavily tracked", () => {
    // This is the fact that falsifies the comment. Pinned here so the claim
    // cannot be re-introduced by the next copy-paste and quietly survive: if
    // someone ever really does gitignore `specs/`, this goes red and the
    // rewrite becomes a decision instead of an accident.
    expect(git(REPO_ROOT, ["check-ignore", "-q", "specs/"]).exitCode).not.toBe(0);
    const tracked = git(REPO_ROOT, ["ls-files", "specs/"]).stdout.trim().split("\n");
    expect(tracked.length).toBeGreaterThan(400);
  });

  test("the stale claim is gone from tests/archive-path-drift.test.ts", () => {
    const src = readFileSync(STE49_TEST, "utf-8");
    expect(src).not.toMatch(/gitignored/i);
    expect(src).not.toMatch(/dogfood workspace/i);
  });

  test("the filter is RETAINED — the comment was the drift, not the mechanism", () => {
    const src = readFileSync(STE49_TEST, "utf-8");
    expect(src).toContain(".filter(existsSync)");
  });

  test("the replacement comment states the REAL reason: optional-target tolerance", () => {
    const src = readFileSync(STE49_TEST, "utf-8");
    const comments = src
      .split("\n")
      .filter((l) => /^\s*(\/\/|\*|\/\*)/.test(l))
      .join("\n");
    expect(comments).toMatch(/optional|may not carry|downstream|consumer/i);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-384.4 — the tripwire, proven
// ---------------------------------------------------------------------------

describe("AC-STE-384.4 — TRIPWIRE FIRES: a reintroduced literal in a scanned path fails", () => {
  test("the FR's named fixture — `.dpt-locks/<ulid>/spec-research-result.txt` — throws naming file:line", () => {
    const root = makeFixtureTree({
      "docs/regressed.md": [
        "# Research scratch",
        "",
        `The fork writes \`.dpt-locks/${ULID}/spec-research-result.txt\`.`,
        "",
      ].join("\n"),
    });
    const offender = join(root, "docs", "regressed.md");

    let message = "";
    try {
      assertNoRetiredLiterals([root]);
      throw new Error("TRIPWIRE DID NOT FIRE: assertNoRetiredLiterals passed on a regressed tree");
    } catch (err) {
      message = (err as Error).message;
    }

    // The failure must name the offender precisely enough to act on: the file,
    // the line, and the literal. `file:line` is the contract (AC.1, AC.4).
    expect(message).toContain(`${offender}:3`);
    expect(message).toContain(".dpt-locks");
    expect(message).not.toContain("TRIPWIRE DID NOT FIRE");
    cleanupTmpRoots();
  });

  test("a reintroduced `.dev-process` ledger path also fires, naming its own line", () => {
    const root = makeFixtureTree({
      "skills/setup/SKILL.md": [
        "## Step 6c",
        "",
        "Append `.dev-process/` to the project's `.gitignore`.",
        "",
      ].join("\n"),
    });
    expect(() => assertNoRetiredLiterals([root])).toThrow(
      new RegExp(`${join(root, "skills", "setup", "SKILL.md").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:3`),
    );
    cleanupTmpRoots();
  });

  test("the thrown failure enumerates EVERY survivor, not just the first", () => {
    // A gate that reports one hit at a time turns a sweep into N commits.
    const root = makeFixtureTree({
      "docs/a.md": `\`.dpt-locks/${ULID}\`\n`,
      "docs/b.md": "`.dev-process/token-ledger.jsonl`\n",
      "templates/c.template": `\`.dpt-locks/${ULID}\`\n`,
    });
    let message = "";
    try {
      assertNoRetiredLiterals([root]);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain(`${join(root, "docs", "a.md")}:1`);
    expect(message).toContain(`${join(root, "docs", "b.md")}:1`);
    expect(message).toContain(`${join(root, "templates", "c.template")}:1`);
    cleanupTmpRoots();
  });
});

describe("AC-STE-384.4 — TRIPWIRE HOLDS FIRE: allow-listed mentions pass", () => {
  test("a tree whose only retired literals sit in `*.test.ts` decoys passes", () => {
    const root = makeFixtureTree({
      "adapters/_shared/src/dpt_paths.test.ts": [
        "// Pre-M104 the research scratch lived at `.dpt-locks/<ulid>/...`, making",
        "// this the decoy that proves no fallback leg survives.",
        `expect(existsSync(join(work, ".dpt-locks"))).toBe(false);`,
        "",
      ].join("\n"),
      "docs/live.md": "Locks live at `.dpt/locks/<ulid>`.\n",
    });

    // Value check first (a bare `.not.toThrow()` would assert nothing about
    // WHY it passed), then the assertion path itself.
    expect(findRetiredLiterals([root])).toEqual([]);
    expect(() => assertNoRetiredLiterals([root])).not.toThrow();
    cleanupTmpRoots();
  });

  test("the two fixtures differ ONLY by the offending file's extension — the carve-out is the variable", () => {
    // Same bytes, same directory, same literal. `.md` fires, `.test.ts` does
    // not. This isolates the carve-out as the single cause, so neither result
    // can be an accident of some unrelated filter.
    const body = `const legacy = ".dpt-locks/${ULID}/spec-research-result.txt";\n`;
    const fires = makeFixtureTree({ "adapters/probe.md": body });
    const holds = makeFixtureTree({ "adapters/probe.test.ts": body });

    expect(findRetiredLiterals([fires]).map((s) => s.line)).toEqual([1]);
    expect(findRetiredLiterals([holds])).toEqual([]);
    cleanupTmpRoots();
  });

  test("a clean tree passes — the gate is not stuck-on-red", () => {
    const root = makeFixtureTree({
      "docs/a.md": "Locks: `.dpt/locks/<ulid>`. Ledger: `.dpt/ledger/token-ledger.jsonl`.\n",
      "skills/s/SKILL.md": "Run `/dev-process-toolkit:implement`.\n",
    });
    expect(findRetiredLiterals([root])).toEqual([]);
    expect(() => assertNoRetiredLiterals([root])).not.toThrow();
    cleanupTmpRoots();
  });
});

// ---------------------------------------------------------------------------
// AC-STE-384.5 — the live gate is green, and non-vacuous
// ---------------------------------------------------------------------------

describe("AC-STE-384.5 — the live tree is clean under the AC.1 mandatory scope", () => {
  test("zero surviving literals across docs, skills, adapters, templates, README.md", () => {
    const survivors = findRetiredLiterals(AC1_MANDATORY_TARGETS).map(
      (s) => `${s.file}:${s.line}: ${s.text.trim()}`,
    );
    expect(survivors).toEqual([]);
  });

  test("zero survivors across the full resolved target list", () => {
    const survivors = findRetiredLiterals(dptPathDriftScanTargets(PLUGIN_ROOT, REPO_ROOT)).map(
      (s) => `${s.file}:${s.line}: ${s.text.trim()}`,
    );
    expect(survivors).toEqual([]);
  });
});

describe("AC-STE-384.5 — the shipped gate file exists and is wired to the live tree", () => {
  test("tests/dpt-path-drift.test.ts exists", () => {
    expect(existsSync(DRIFT_TEST)).toBe(true);
  });

  test("it scans the LIVE tree through the shared primitive — not a private re-implementation", () => {
    // Guards the vacuity failure mode: a gate that resolves its own targets, or
    // greps its own patterns, is a gate this file's fixtures never exercised.
    const src = readFileSync(DRIFT_TEST, "utf-8");
    expect(src).toMatch(/from\s+"\.\/_dpt-path-drift"/);
    expect(src).toContain("dptPathDriftScanTargets");
    expect(src).toMatch(/assertNoRetiredLiterals|findRetiredLiterals/);
  });

  test("it is a real bun test file and passes on its own", () => {
    // The end-to-end proof of AC.5's "full gate green": the deliverable is
    // executed as the gate really executes it, not merely imported.
    const proc = Bun.spawnSync(["bun", "test", "tests/dpt-path-drift.test.ts"], {
      cwd: PLUGIN_ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = proc.stdout.toString() + proc.stderr.toString();

    expect(proc.exitCode).toBe(0);
    expect(out).toMatch(/0 fail/);
    // Non-vacuous: a file with zero registered tests also exits 0.
    const pass = out.match(/(\d+) pass/);
    expect(pass).not.toBeNull();
    expect(Number(pass![1])).toBeGreaterThanOrEqual(1);
  }, 30_000);
});
