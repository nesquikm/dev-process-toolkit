// M104 STE-383 — `/setup` writes a self-contained `.dpt/.gitignore`; the root
// `.dev-process/` append is retired.
//
// AC coverage:
//   AC-STE-383.1 — idempotent toolkit-owned write (`writeDptGitignore`).
//   AC-STE-383.2 — `/setup` invokes it, best-effort, logged to `## /setup audit`.
//   AC-STE-383.3 — root-`.gitignore` append retired from `skills/setup/SKILL.md`.
//   AC-STE-383.4 — this repo's root `.gitignore`: no `.dev-process/`, no `.dpt/`.
//   AC-STE-383.5 — `git check-ignore` polarity, positive + negative + hazard.
//   AC-STE-383.6 — docs describe the tree + the accepted hole; docs sweep clean.
//   AC-STE-383.7 — the calibration snapshots this FR's edits ride against.
//
// The imports below drive the RED state — `setup/dpt_gitignore.ts` does not
// exist yet.
//
// ON THE LEGACY `.dev-process/` DIRECTORY (FR § Notes, `/implement` Phase 1):
// this FR deletes the legacy folder from the working tree, but that end state
// is deliberately NOT asserted here. The same § Notes ("Installed-plugin
// transition window") record that the version-pinned capture hook keeps
// writing `<root>/.dev-process/token-ledger.jsonl` until the v2.46.0 cache
// refresh, so the folder may transiently reappear — by design, as the loud
// half of the FR's polarity trade-off. An `existsSync(...) === false`
// assertion would therefore go red on a working tree the FR calls correct.
// The durable half of the end state — no rule ignores it, nothing tracks it —
// IS asserted, under AC-STE-383.4.

import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { dptRoot, ledgerPath, locksDir, scratchDir } from "../adapters/_shared/src/dpt_paths";
import {
  DPT_GITIGNORE_BODY,
  dptGitignorePath,
  writeDptGitignore,
} from "../adapters/_shared/src/setup/dpt_gitignore";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const ROOT_GITIGNORE = join(REPO_ROOT, ".gitignore");
const SETUP_SKILL_MD = join(PLUGIN_ROOT, "skills", "setup", "SKILL.md");
const DOCS_DIR = join(PLUGIN_ROOT, "docs");
const HELPER_SRC = join(PLUGIN_ROOT, "adapters", "_shared", "src", "setup", "dpt_gitignore.ts");

const ULID = "01HZZZQK5T0000000000000001";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const readDoc = (name: string): string => readFileSync(join(DOCS_DIR, name), "utf-8");
const readSkill = (): string => readFileSync(SETUP_SKILL_MD, "utf-8");

function git(cwd: string, args: string[]): { exitCode: number; stdout: string } {
  const proc = Bun.spawnSync(
    ["git", "-c", "user.email=t@t.test", "-c", "user.name=t", ...args],
    { cwd, stdout: "pipe", stderr: "pipe" },
  );
  return { exitCode: proc.exitCode, stdout: proc.stdout.toString() };
}

/** `git check-ignore -q <path>` → exit 0 means IGNORED, exit 1 means TRACKED. */
function isIgnored(repo: string, relPath: string): boolean {
  return git(repo, ["check-ignore", "-q", relPath]).exitCode === 0;
}

const tmpRoots: string[] = [];

function makeTmpRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  tmpRoots.push(root);
  return root;
}

function cleanupTmpRoots(): void {
  while (tmpRoots.length > 0) {
    const dir = tmpRoots.pop()!;
    if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * A git repo whose `.dpt/` tree carries the SHIPPED nested ignore file (written
 * by the helper itself — the file `/setup` really produces) plus one file in
 * each of the three subtrees. `rootIgnore` is the consumer's root `.gitignore`;
 * the FR's whole claim is that the empty string is sufficient.
 */
function makeCheckIgnoreRepo(rootIgnore: string, projectSubdir = ""): { repo: string; project: string } {
  const repo = makeTmpRoot("ste-383-ci-");
  git(repo, ["init", "-q"]);
  writeFileSync(join(repo, ".gitignore"), rootIgnore);

  const project = projectSubdir === "" ? repo : join(repo, projectSubdir);
  if (project !== repo) mkdirSync(project, { recursive: true });

  writeDptGitignore(project);

  mkdirSync(locksDir(project), { recursive: true });
  writeFileSync(join(locksDir(project), "01HLOCK"), "branch: feat/x\n");
  mkdirSync(dirname(ledgerPath(project)), { recursive: true });
  writeFileSync(ledgerPath(project), '{"schema":"token-ledger/v1"}\n');
  mkdirSync(scratchDir(project, ULID), { recursive: true });
  writeFileSync(join(scratchDir(project, ULID), "spec-research-result.txt"), "related: none\n");

  return { repo, project };
}

/** Every `.md` file under `docs/`, recursively. */
function docFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".md")) out.push(full);
    }
  };
  walk(DOCS_DIR);
  return out.sort();
}

/** Blank-line-delimited paragraphs. */
const paragraphs = (body: string): string[] => body.split(/\n\s*\n/);

// ---------------------------------------------------------------------------
// AC-STE-383.1 — idempotent toolkit-owned write
// ---------------------------------------------------------------------------

describe("AC-STE-383.1 — the canonical `.dpt/.gitignore` body", () => {
  test("the body is exactly `ledger/` + `scratch/`", () => {
    const rules = DPT_GITIGNORE_BODY.split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("#"));
    expect(rules).toEqual(["ledger/", "scratch/"]);
  });

  test("the body is deliberately RELATIVE, not rooted — it names no `.dpt` prefix and no leading `/`", () => {
    // FR § Technical Design: nested `.gitignore` patterns resolve against their
    // own directory, so the file is position-independent. A rooted `/.dpt/...`
    // or a `.dpt/`-prefixed rule would break that (and, for `.dpt/`, would
    // re-create the blanket-exclusion trap one level down).
    for (const line of DPT_GITIGNORE_BODY.split("\n")) {
      const t = line.trim();
      if (t.length === 0 || t.startsWith("#")) continue;
      expect(t.startsWith("/")).toBe(false);
      expect(t).not.toContain(".dpt");
    }
  });

  test("the body carries NO negation rule — the polarity is tracked-by-default", () => {
    // FR § Requirement: `!`-re-inclusion is the losing polarity. Its presence
    // would mean someone re-introduced the ignore-and-negate shape.
    expect(DPT_GITIGNORE_BODY).not.toContain("!");
  });

  test("the body ends with a trailing newline (git reads the last rule either way; the file is ours to keep clean)", () => {
    expect(DPT_GITIGNORE_BODY.endsWith("\n")).toBe(true);
  });
});

describe("AC-STE-383.1 — `dptGitignorePath` derives from dpt_paths, composing no `.dpt` literal of its own", () => {
  test("dptGitignorePath(root) → <root>/.dpt/.gitignore", () => {
    const root = join(sep, "tmp", "example-project");
    expect(dptGitignorePath(root)).toBe(join(dptRoot(root), ".gitignore"));
  });

  test("the helper module composes no `.dpt` string literal (STE-382 single-source contract)", () => {
    const src = readFileSync(HELPER_SRC, "utf-8");
    const codeOnly = src
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join("\n");
    expect(codeOnly).not.toMatch(/"\.dpt|'\.dpt|`\.dpt/);
    expect(src).toMatch(/from\s+"\.\.\/dpt_paths"/);
  });
});

describe("AC-STE-383.1 — first run: writes the file, creating `.dpt/` when absent", () => {
  test("a project with no `.dpt/` at all gets the directory + the canonical file", () => {
    const root = makeTmpRoot("ste-383-first-");
    expect(existsSync(dptRoot(root))).toBe(false);

    const r = writeDptGitignore(root);

    expect(r.outcome).toBe("written");
    expect(r.path).toBe(dptGitignorePath(root));
    expect(existsSync(dptRoot(root))).toBe(true);
    expect(readFileSync(dptGitignorePath(root), "utf-8")).toBe(DPT_GITIGNORE_BODY);
    cleanupTmpRoots();
  });

  test("`.dpt/` already present but empty ⇒ still written", () => {
    const root = makeTmpRoot("ste-383-emptydir-");
    mkdirSync(dptRoot(root), { recursive: true });

    const r = writeDptGitignore(root);

    expect(r.outcome).toBe("written");
    expect(readFileSync(dptGitignorePath(root), "utf-8")).toBe(DPT_GITIGNORE_BODY);
    cleanupTmpRoots();
  });
});

describe("AC-STE-383.1 — idempotent by byte-compare: identical baseline ⇒ NO write", () => {
  test("re-running over a matching baseline reports `unchanged` and does not touch the file", () => {
    const root = makeTmpRoot("ste-383-idem-");
    expect(writeDptGitignore(root).outcome).toBe("written");

    // Backdate the mtime to a fixed instant. A no-op re-run must leave it
    // alone — this is the byte-level proof that "no write" means no write,
    // not "wrote the same bytes again".
    const path = dptGitignorePath(root);
    const stamp = new Date("2020-01-02T03:04:05Z");
    utimesSync(path, stamp, stamp);
    const beforeMtime = statSync(path).mtimeMs;

    const second = writeDptGitignore(root);

    expect(second.outcome).toBe("unchanged");
    expect(statSync(path).mtimeMs).toBe(beforeMtime);
    expect(readFileSync(path, "utf-8")).toBe(DPT_GITIGNORE_BODY);
    cleanupTmpRoots();
  });

  test("safe to re-run: three consecutive calls leave byte-identical content and one `written`", () => {
    const root = makeTmpRoot("ste-383-rerun-");
    const outcomes = [
      writeDptGitignore(root).outcome,
      writeDptGitignore(root).outcome,
      writeDptGitignore(root).outcome,
    ];
    expect(outcomes).toEqual(["written", "unchanged", "unchanged"]);
    expect(readFileSync(dptGitignorePath(root), "utf-8")).toBe(DPT_GITIGNORE_BODY);
    cleanupTmpRoots();
  });
});

describe("AC-STE-383.1 — a drifted baseline is restored: this is a file we own", () => {
  test("hand-edited content is rewritten to canonical and reported `written`", () => {
    // FR § Requirement: /setup's duty collapses to "write one file we own",
    // which is what makes it "impossible to partially apply". A drifted
    // baseline (e.g. someone deleted `scratch/`) must not survive a re-run,
    // or the ledger/scratch leak the rule exists to prevent comes back.
    const root = makeTmpRoot("ste-383-drift-");
    mkdirSync(dptRoot(root), { recursive: true });
    writeFileSync(dptGitignorePath(root), "ledger/\n");

    const r = writeDptGitignore(root);

    expect(r.outcome).toBe("written");
    expect(readFileSync(dptGitignorePath(root), "utf-8")).toBe(DPT_GITIGNORE_BODY);
    cleanupTmpRoots();
  });
});

describe("AC-STE-383.1 — no prompt: the write is unattended by construction", () => {
  test("the helper takes only a project root — there is no operator-question seam", () => {
    // STE-303 prompts because it writes a file the operator authors. This
    // file is toolkit-owned, so the prompt branch does not exist: no
    // AskUserQuestion dep is injectable, and none is referenced.
    expect(writeDptGitignore.length).toBe(1);
    expect(readFileSync(HELPER_SRC, "utf-8")).not.toMatch(/askUserQuestion|AskUserQuestion/);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-383.2 — `/setup` invokes it, best-effort, logged
// ---------------------------------------------------------------------------

/**
 * The `/setup` step that owns the ignore rule: the single paragraph naming
 * `.dpt/.gitignore`. Pinned as a paragraph (not a line number) so the
 * assertions survive re-flow.
 */
function ignoreStepParagraphs(): string[] {
  const found = paragraphs(readSkill()).filter((p) => p.includes(".dpt/.gitignore"));
  expect(found.length).toBeGreaterThan(0);
  return found;
}

describe("AC-STE-383.2 — /setup names the `.dpt/.gitignore` step and its helper", () => {
  test("skills/setup/SKILL.md documents writing `.dpt/.gitignore`", () => {
    expect(readSkill()).toContain(".dpt/.gitignore");
  });

  test("the step names the canonical helper module so the prose cannot drift from the code", () => {
    const step = ignoreStepParagraphs().join("\n\n");
    expect(step).toMatch(/dpt_gitignore/);
    expect(step).toMatch(/writeDptGitignore/);
  });

  test("the step declares the run-every-time, no-op-on-match contract", () => {
    const step = ignoreStepParagraphs().join("\n\n");
    expect(step).toMatch(/idempotent|no-?op|unchanged/i);
  });
});

describe("AC-STE-383.2 — the write is best-effort and audited, never a /setup failure", () => {
  test("the step routes the outcome to the `## /setup audit` surface", () => {
    const step = ignoreStepParagraphs().join("\n\n");
    expect(step).toMatch(/\/setup audit/);
    expect(step).toMatch(/appendAuditRow/);
  });

  test("the step states the failure is best-effort — it never fails the run", () => {
    const step = ignoreStepParagraphs().join("\n\n");
    expect(step).toMatch(/best-effort/i);
    expect(step).toMatch(/never fail|not fail|rather than failing|without failing/i);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-383.3 — root append retired
// ---------------------------------------------------------------------------

describe("AC-STE-383.3 — the retired `.dev-process/` root append is gone from /setup", () => {
  test("skills/setup/SKILL.md carries no `.dev-process` literal anywhere", () => {
    expect(readSkill()).not.toContain(".dev-process");
  });

  test("/setup no longer writes the consumer's root `.gitignore` for toolkit state", () => {
    // Every surviving `.gitignore` mention in the skill must be either the
    // stack-scaffold bullet (`.gitignore` — Stack-appropriate ignores: the
    // consumer's own file, consumer's own rules) or the nested toolkit-owned
    // file. Anything else is a re-introduced root append.
    const offenders = paragraphs(readSkill())
      .filter((p) => p.includes(".gitignore"))
      .filter((p) => !p.includes(".dpt/.gitignore"))
      .filter((p) => !p.includes("Stack-appropriate ignores"));
    expect(offenders).toEqual([]);
  });

  test("no step describes appending an entry to the project's `.gitignore`", () => {
    const body = readSkill();
    expect(body).not.toMatch(/entry to the project's `?\.gitignore/i);
    expect(body).not.toMatch(/append[^.\n]{0,60}to the (project|consumer)'s `?\.gitignore/i);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-383.4 — the toolkit's own root `.gitignore`
// ---------------------------------------------------------------------------

describe("AC-STE-383.4 — this repo's root `.gitignore` cedes `.dpt/` to the nested file", () => {
  const rootLines = (): string[] =>
    readFileSync(ROOT_GITIGNORE, "utf-8").split("\n").map((l) => l.trim());

  test("the `.dev-process/` line is gone", () => {
    expect(existsSync(ROOT_GITIGNORE)).toBe(true);
    expect(rootLines()).not.toContain(".dev-process/");
    expect(readFileSync(ROOT_GITIGNORE, "utf-8")).not.toContain(".dev-process");
  });

  test("NO `.dpt` rule is added — a root entry would defeat the nested file", () => {
    // git never descends into an excluded directory, so ANY root rule matching
    // `.dpt/` (blanket, glob, or negated) silently unversions the tracked
    // lock namespace. The absence of the line is the feature.
    for (const line of rootLines()) {
      if (line.length === 0 || line.startsWith("#")) continue;
      expect(line).not.toContain(".dpt");
    }
  });

  test("the legacy `.dev-process/` path is neither tracked nor ignored — nothing references it", () => {
    // The durable half of the § Notes deletion decision: no rule ignores it
    // and no blob tracks it. (The working-tree folder itself may transiently
    // reappear from the version-pinned hook — see this file's header.)
    const tracked = git(REPO_ROOT, ["ls-files", "--", ".dev-process"]);
    expect(tracked.stdout.trim()).toBe("");
  });
});

describe("AC-STE-383.4 — the nested file that governs instead is shipped and canonical", () => {
  test("this repo carries a committed `.dpt/.gitignore` byte-identical to the canonical body", () => {
    // Without this file the toolkit's OWN ledger goes untracked-and-visible
    // in `git status` the moment AC.4 drops the root line.
    const shipped = dptGitignorePath(REPO_ROOT);
    expect(existsSync(shipped)).toBe(true);
    expect(readFileSync(shipped, "utf-8")).toBe(DPT_GITIGNORE_BODY);
  });

  test("the shipped file is tracked by git, not merely present on disk", () => {
    const tracked = git(REPO_ROOT, ["ls-files", "--", relative(REPO_ROOT, dptGitignorePath(REPO_ROOT))]);
    expect(tracked.stdout.trim().length).toBeGreaterThan(0);
  });

  test("this repo's own ledger + scratch resolve as ignored, locks as tracked", () => {
    // Dogfood: the same three-way split, asserted against the real repo.
    expect(isIgnored(REPO_ROOT, relative(REPO_ROOT, ledgerPath(REPO_ROOT)))).toBe(true);
    expect(isIgnored(REPO_ROOT, relative(REPO_ROOT, scratchDir(REPO_ROOT, ULID)))).toBe(true);
    expect(isIgnored(REPO_ROOT, relative(REPO_ROOT, join(locksDir(REPO_ROOT), "01HLOCK")))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-383.5 — `git check-ignore` assertions
// ---------------------------------------------------------------------------

describe("AC-STE-383.5 — POSITIVE: the shipped nested file yields the three-way split with an EMPTY root ignore", () => {
  test("locks TRACKED, ledger IGNORED, scratch IGNORED, `.dpt/.gitignore` itself TRACKED", () => {
    const { repo } = makeCheckIgnoreRepo("");

    expect(isIgnored(repo, join(".dpt", "locks", "01HLOCK"))).toBe(false);
    expect(isIgnored(repo, join(".dpt", "ledger", "token-ledger.jsonl"))).toBe(true);
    expect(isIgnored(repo, join(".dpt", "scratch", ULID, "spec-research-result.txt"))).toBe(true);
    expect(isIgnored(repo, join(".dpt", ".gitignore"))).toBe(false);

    cleanupTmpRoots();
  });

  test("`git add -A` stages exactly the lock + the ignore file — nothing leaks, nothing is lost", () => {
    // The end-to-end consequence of the split, stated as git sees it.
    const { repo } = makeCheckIgnoreRepo("");
    git(repo, ["add", "-A"]);
    const staged = git(repo, ["diff", "--cached", "--name-only"]).stdout
      .split("\n")
      .filter((l) => l.length > 0)
      .sort();

    expect(staged).toEqual([".dpt/.gitignore", ".dpt/locks/01HLOCK", ".gitignore"].sort());
    cleanupTmpRoots();
  });

  test("position-independent: the same file works when the project is NOT the repo root", () => {
    // The rules are relative, so a `.dpt/` nested inside a subdirectory of the
    // repo resolves identically. This is why the body is not rooted.
    const { repo } = makeCheckIgnoreRepo("", join("packages", "app"));
    const base = join("packages", "app", ".dpt");

    expect(isIgnored(repo, join(base, "locks", "01HLOCK"))).toBe(false);
    expect(isIgnored(repo, join(base, "ledger", "token-ledger.jsonl"))).toBe(true);
    expect(isIgnored(repo, join(base, "scratch", ULID, "spec-research-result.txt"))).toBe(true);

    cleanupTmpRoots();
  });
});

describe("AC-STE-383.5 — NEGATIVE: the naive `.dpt/` + `!.dpt/locks/` form silently kills locking", () => {
  test("under ignore-and-negate, `.dpt/locks/<id>` is IGNORED — git never descends to see the negation", () => {
    // This asserts a form the toolkit does NOT ship. It is kept deliberately
    // (FR § Testing): it is the reason the polarity is tracked-by-default.
    // A forgotten rule under our polarity leaks scratch into a commit — loud,
    // visible, harmless. A forgotten rule under this one unversions a
    // coordination signal — silent, invisible, correctness-breaking.
    const repo = makeTmpRoot("ste-383-negation-");
    git(repo, ["init", "-q"]);
    writeFileSync(join(repo, ".gitignore"), ".dpt/\n!.dpt/locks/\n");
    mkdirSync(join(repo, ".dpt", "locks"), { recursive: true });
    writeFileSync(join(repo, ".dpt", "locks", "01HLOCK"), "branch: feat/x\n");

    expect(isIgnored(repo, join(".dpt", "locks", "01HLOCK"))).toBe(true);

    // …and the loss is total: `git add -A` stages nothing under `.dpt/`.
    git(repo, ["add", "-A"]);
    const staged = git(repo, ["diff", "--cached", "--name-only"]).stdout;
    expect(staged).not.toContain(".dpt/locks/01HLOCK");

    cleanupTmpRoots();
  });

  test("only the `.dpt/*` glob form re-includes locks — one careless tidy-up from the trap", () => {
    // The near-miss that makes the negation form seductive: `.dpt/*` works,
    // `.dpt/` does not, and the two differ by one character.
    const repo = makeTmpRoot("ste-383-glob-");
    git(repo, ["init", "-q"]);
    writeFileSync(join(repo, ".gitignore"), ".dpt/*\n!.dpt/locks/\n");
    mkdirSync(join(repo, ".dpt", "locks"), { recursive: true });
    mkdirSync(join(repo, ".dpt", "ledger"), { recursive: true });
    writeFileSync(join(repo, ".dpt", "locks", "01HLOCK"), "branch: feat/x\n");
    writeFileSync(join(repo, ".dpt", "ledger", "token-ledger.jsonl"), "{}\n");

    expect(isIgnored(repo, join(".dpt", "locks", "01HLOCK"))).toBe(false);
    expect(isIgnored(repo, join(".dpt", "ledger", "token-ledger.jsonl"))).toBe(true);

    cleanupTmpRoots();
  });
});

describe("AC-STE-383.5 / AC-STE-383.6 — HAZARD: a blanket root `.dpt/` defeats the nested file entirely", () => {
  test("a consumer's root `.dpt/` rule ignores locks AND the nested ignore file itself", () => {
    // The accepted hole AC.6 documents rather than defends: git never descends
    // into an excluded directory, so the nested file is never even read.
    const { repo } = makeCheckIgnoreRepo(".dpt/\n");

    expect(isIgnored(repo, join(".dpt", "locks", "01HLOCK"))).toBe(true);
    expect(isIgnored(repo, join(".dpt", ".gitignore"))).toBe(true);

    cleanupTmpRoots();
  });
});

// ---------------------------------------------------------------------------
// AC-STE-383.6 — docs describe the tree + the accepted hazard
// ---------------------------------------------------------------------------

describe("AC-STE-383.6 — docs/layout-reference.md describes the `.dpt/` tree and the tracked/ignored split", () => {
  test("the three subtrees are named", () => {
    const body = readDoc("layout-reference.md");
    expect(body).toContain(".dpt/locks");
    expect(body).toContain(".dpt/ledger");
    expect(body).toContain(".dpt/scratch");
  });

  test("the nested ignore file is named as the mechanism", () => {
    expect(readDoc("layout-reference.md")).toContain(".dpt/.gitignore");
  });

  test("the split is stated as tracked-vs-ignored, not merely listed", () => {
    const body = readDoc("layout-reference.md");
    const para = paragraphs(body).find(
      (p) => p.includes(".dpt/.gitignore") && /tracked/i.test(p) && /ignored/i.test(p),
    );
    expect(para).toBeDefined();
    // Locks are the tracked side — that is the whole point of the polarity.
    expect(/locks/i.test(para!)).toBe(true);
  });
});

describe("AC-STE-383.6 — the blanket-root hole is documented as an ACCEPTED risk", () => {
  test("a passage names the root-`.gitignore` hazard, its mechanism, and its accepted status", () => {
    const body = readDoc("layout-reference.md");
    const para = paragraphs(body).find(
      (p) => /accepted/i.test(p) && /\.gitignore/.test(p) && /\.dpt/.test(p),
    );
    expect(para).toBeDefined();
    // The mechanism must be stated, not just the outcome — the reason no
    // design defeats it is that git never descends into an excluded directory.
    expect(para!).toMatch(/never descends|excluded director|does not descend/i);
    expect(para!).toMatch(/root/i);
  });
});

describe("AC-STE-383.6 — docs/hooks-reference.md re-points the ledger", () => {
  test("the session-token-ledger entry names `.dpt/ledger/token-ledger.jsonl`", () => {
    const body = readDoc("hooks-reference.md");
    const start = body.indexOf("### session-token-ledger");
    expect(start).toBeGreaterThan(-1);
    const rest = body.slice(start + 1);
    const end = rest.search(/\n### |\n## /);
    const section = end === -1 ? rest : rest.slice(0, end);

    expect(section).toContain(".dpt/ledger/token-ledger.jsonl");
    expect(section).not.toContain(".dev-process");
  });

  test("the entry still states WHY the path is safe — the ignore rule that makes it so", () => {
    const body = readDoc("hooks-reference.md");
    expect(body).toMatch(/git-ignored|ignored/i);
  });
});

describe("AC-STE-383.6 — the docs sweep: zero retired literals survive under docs/", () => {
  // STE-384 greps all of `docs/` with only CHANGELOG + specs-archive
  // allow-listed. Every survivor here makes STE-384 red on arrival, so this
  // FR closes them: sdd-methodology.md, tracker-adapters.md,
  // implement-reference.md, workflow-overview.md, layout-reference.md,
  // hooks-reference.md.
  const RETIRED = [".dpt-locks", ".dev-process"];

  test("no `.dpt-locks` / `.dev-process` literal remains in any docs/*.md, named file:line", () => {
    const survivors: string[] = [];
    for (const file of docFiles()) {
      const lines = readFileSync(file, "utf-8").split("\n");
      lines.forEach((line, i) => {
        for (const literal of RETIRED) {
          if (line.includes(literal)) {
            survivors.push(`${relative(PLUGIN_ROOT, file)}:${i + 1}: ${literal}`);
          }
        }
      });
    }
    expect(survivors).toEqual([]);
  });

  test("the four unowned-drift files now name the live lock path", () => {
    // Re-pointed, not merely deleted — the prose still has to say something
    // true about where locks live.
    for (const name of [
      "sdd-methodology.md",
      "tracker-adapters.md",
      "implement-reference.md",
      "workflow-overview.md",
    ]) {
      expect(readDoc(name)).toContain(".dpt/locks");
    }
  });
});

describe("AC-STE-383.6 — the invalid git command is corrected while sweeping", () => {
  test("`git branch -r --contains <path>` is gone from layout-reference.md", () => {
    // `--contains` takes a commit, not a path; LocalProvider's own docstring
    // says so and walks remote tips with `ls-tree` instead.
    expect(readDoc("layout-reference.md")).not.toMatch(/branch\s+-r\s+--contains/);
  });

  test("the tracker-less row names the mechanism that is actually implemented", () => {
    const body = readDoc("layout-reference.md");
    const row = body.split("\n").find((l) => /Tracker-less/.test(l) && /DPT_SKIP_FETCH/.test(l));
    expect(row).toBeDefined();
    expect(row!).toContain("ls-tree");
  });
});

// ---------------------------------------------------------------------------
// AC-STE-383.7 — the calibration snapshots this FR's edits ride against
// ---------------------------------------------------------------------------

describe("AC-STE-383.7 — no meta-test regresses on the surfaces this FR edits", () => {
  test("skills/setup/SKILL.md stays within the NFR-1 line cap (354)", () => {
    // The FR removes one step's prose and adds another's; the file sat at 353
    // of 354 before it. Net growth of two lines breaches the cap.
    const lines = readSkill().split("\n").length;
    expect(lines).toBeLessThanOrEqual(354);
  });

  test("the skills/ STE-token ceiling (246) is not breached by the new /setup prose", () => {
    // The ceiling is AT the pin, with zero headroom. The new step 6c prose
    // must cite its precedents by mechanism, not by `STE-N` token.
    let count = 0;
    const walk = (d: string) => {
      for (const name of readdirSync(d)) {
        const p = join(d, name);
        if (statSync(p).isDirectory()) {
          walk(p);
          continue;
        }
        if (!name.endsWith(".md")) continue;
        count += (readFileSync(p, "utf-8").match(/\b(STE|AC-STE)-\d+(?:\.\d+)?\b/g) ?? []).length;
      }
    };
    walk(join(PLUGIN_ROOT, "skills"));
    expect(count).toBeLessThanOrEqual(246);
  });
});
