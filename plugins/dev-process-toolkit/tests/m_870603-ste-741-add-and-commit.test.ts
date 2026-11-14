// STE-741 (M_870603) — a spec edit committed with `git add <paths> && git commit`
// gets the spec-only pass.
//
// Every leg drives the SHIPPED `pre-commit-gate-check.sh` wrapper over a
// transcript carrying NO gate-check Skill call, against a temporary checkout
// whose spec edits sit UNSTAGED in the working tree (the add half of the
// command is what would stage them). A pass is exit 0 with no `Refusing:`; a
// refusal is exit 2 naming dev-process-toolkit:gate-check — today's rule.
//
// Each refusal twin differs from a permit world in one fact (the add form, the
// path kind, or one extra tracked change), so the permit beside it is the
// control that proves the refusal is caused by that fact.

import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { FR_ACTIVE_PATH, frText, git, makeArchiveRepo, PLAN_ACTIVE_PATH, planText, writeAt } from "./_archive_only_fixture";
import {
  bareTranscriptRecords,
  cleanupTemps,
  GATE_CHECK,
  type HookRun,
  permitProblem,
  PLUGIN_ROOT,
  refusalProblem,
  runHook,
  SELF,
  show,
  tempDir,
} from "./_m_b2fdc0_ste733_fixture";

const T = 120_000;

afterAll(() => cleanupTemps());

const NEW_FR_PATH = "specs/frs/FX-2.md";
const MSG = '"docs(specs): reword FX-1"';

interface World {
  repo: string;
  transcript: string;
}

interface WorldOpts {
  /** Also leave an unstaged edit to the tracked plan (a spec path). */
  planEdit?: boolean;
  /** Also create an untracked new FR (a spec path). */
  newFr?: boolean;
  /** Stage the plan edit before the command runs. */
  stagePlan?: boolean;
  /** Leave an unstaged edit to the tracked code file src/app.ts. */
  dirtyCode?: boolean;
  /** Stage a code edit to src/app.ts before the command runs. */
  stagedCode?: boolean;
  /** Leave an untracked code file src/new.ts. */
  untrackedCode?: boolean;
  /** Leave an untracked file under specs/ that SPEC_PATTERNS does not match. */
  specsOther?: boolean;
}

/** A committed checkout with an UNSTAGED edit to the active FR, plus the options. */
function makeWorld(o: WorldOpts = {}): World {
  const root = tempDir("741");
  const repo = makeArchiveRepo(join(root, "repo"));
  writeAt(repo, FR_ACTIVE_PATH, frText({ summary: ["The summary was rewritten while writing the spec."] }));
  if (o.planEdit || o.stagePlan) writeAt(repo, PLAN_ACTIVE_PATH, planText({ tasks: ["- [ ] task one: a reworded task"] }));
  if (o.stagePlan) git(repo, "add", PLAN_ACTIVE_PATH);
  if (o.newFr) writeAt(repo, NEW_FR_PATH, frText({ summary: ["A brand new FR, never tracked."] }).replace(/FX-1/g, "FX-2"));
  if (o.stagedCode) {
    writeAt(repo, "src/app.ts", "export const app = 5;\n");
    git(repo, "add", "src/app.ts");
  }
  if (o.dirtyCode) writeAt(repo, "src/app.ts", "export const app = 3;\n");
  if (o.untrackedCode) writeAt(repo, "src/new.ts", "export const fresh = 1;\n");
  if (o.specsOther) writeAt(repo, "specs/notes/scratch.md", "# Scratch\n");
  const transcript = join(root, "transcript.jsonl");
  writeFileSync(transcript, bareTranscriptRecords().join("\n") + "\n");
  return { repo, transcript };
}

function run(w: World, command: string): Promise<HookRun> {
  return runHook(PLUGIN_ROOT, "commit", w.repo, command, w.transcript, SELF);
}

async function expectPermit(w: World, command: string): Promise<void> {
  const r = await run(w, command);
  const p = permitProblem(r);
  expect(p === null ? null : `${p}\n${show(r)}`).toBeNull();
}

async function expectRefusal(w: World, command: string): Promise<void> {
  const r = await run(w, command);
  const p = refusalProblem(r, GATE_CHECK);
  expect(p === null ? null : `${p}\n${show(r)}`).toBeNull();
}

// ------------------------------------------------------------------- AC .1

describe("AC-STE-741.1 — `git add <spec paths> && git commit` takes the spec-only pass", () => {
  test("AC-STE-741.1 — one unstaged active FR edit, `git add <fr> && git commit -m`", async () => {
    await expectPermit(makeWorld(), `git add ${FR_ACTIVE_PATH} && git commit -m ${MSG}`);
  }, T);

  test("AC-STE-741.1 — two unstaged spec edits, both named, `git add <fr> <plan> && git commit -m`", async () => {
    await expectPermit(makeWorld({ planEdit: true }), `git add ${FR_ACTIVE_PATH} ${PLAN_ACTIVE_PATH} && git commit -m ${MSG}`);
  }, T);

  test("AC-STE-741.1 — the `-F -` heredoc commit form", async () => {
    await expectPermit(
      makeWorld(),
      `git add ${FR_ACTIVE_PATH} && git commit -F - <<'EOF'\ndocs(specs): reword FX-1\n\nRefs: FX-1\nEOF`,
    );
  }, T);

  test("AC-STE-741.1 — an UNTRACKED new spec file named by the add qualifies", async () => {
    await expectPermit(makeWorld({ newFr: true }), `git add ${FR_ACTIVE_PATH} ${NEW_FR_PATH} && git commit -m ${MSG}`);
  }, T);

  test("AC-STE-741.1 — a spec path already staged plus the added spec path is spec-only", async () => {
    await expectPermit(makeWorld({ stagePlan: true }), `git add ${FR_ACTIVE_PATH} && git commit -m ${MSG}`);
  }, T);

  test("AC-STE-741.1 — an untracked code file left out of the add does not block the pass", async () => {
    await expectPermit(makeWorld({ untrackedCode: true }), `git add ${FR_ACTIVE_PATH} && git commit -m ${MSG}`);
  }, T);

  test("AC-STE-741.1 — a named path that does not exist is not a literal existing file path", async () => {
    await expectRefusal(makeWorld(), `git add ${FR_ACTIVE_PATH} specs/frs/FX-9.md && git commit -m ${MSG}`);
  }, T);
});

// ------------------------------------------------------------------- AC .2

describe("AC-STE-741.2 — the add half never qualifies with a broad or non-spec form", () => {
  // Every world here holds ONLY spec edits, so the prospective staged set would
  // be spec-only: the refusal is caused by the add form alone.
  const forms: Array<[string, string]> = [
    ["-A", "git add -A"],
    ["--all", "git add --all"],
    ["-u", "git add -u"],
    [".", "git add ."],
    ["a directory", "git add specs/frs"],
    ["a glob", "git add 'specs/frs/*.md'"],
    ["an unquoted glob", "git add specs/frs/*.md"],
  ];
  for (const [label, add] of forms) {
    test(`AC-STE-741.2 — \`${add} && git commit\` (${label}) is graded as today`, async () => {
      await expectRefusal(makeWorld(), `${add} && git commit -m ${MSG}`);
    }, T);
  }

  test("AC-STE-741.2 — a named path that is not a spec path (specs/notes/…) is graded as today", async () => {
    await expectRefusal(makeWorld({ specsOther: true }), `git add ${FR_ACTIVE_PATH} specs/notes/scratch.md && git commit -m ${MSG}`);
  }, T);

  test("AC-STE-741.2 — a named code path is graded as today", async () => {
    await expectRefusal(makeWorld({ untrackedCode: true }), `git add ${FR_ACTIVE_PATH} src/new.ts && git commit -m ${MSG}`);
  }, T);
});

// ------------------------------------------------------------------- AC .3

describe("AC-STE-741.3 — a tracked change outside the added paths keeps the commit off the pass", () => {
  test("AC-STE-741.3 — an unstaged edit to tracked src/app.ts beside the added FR", async () => {
    await expectRefusal(makeWorld({ dirtyCode: true }), `git add ${FR_ACTIVE_PATH} && git commit -m ${MSG}`);
  }, T);

  test("AC-STE-741.3 — an unstaged edit to the tracked plan the add does not name", async () => {
    await expectRefusal(makeWorld({ planEdit: true }), `git add ${FR_ACTIVE_PATH} && git commit -m ${MSG}`);
  }, T);

  test("AC-STE-741.3 — a code edit already staged before the command runs", async () => {
    await expectRefusal(makeWorld({ stagedCode: true }), `git add ${FR_ACTIVE_PATH} && git commit -m ${MSG}`);
  }, T);
});

// ------------------------------------------------------------------- AC .4

describe("AC-STE-741.4 — docs/hooks-reference.md documents the combined form", () => {
  test("AC-STE-741.4 — the spec-only pass section names `git add <paths> && git commit`", () => {
    const doc = readFileSync(join(PLUGIN_ROOT, "docs", "hooks-reference.md"), "utf-8");
    const section = doc.split("\n").find((l) => l.startsWith("- **Spec-only pass (STE-733):**"));
    expect(section ?? "<the spec-only pass bullet is missing>").toMatch(/`git add [^`]*&& git commit[^`]*`/);
  });
});

// ------------------------------------------------------------------- review round 1
// Pass 2 review (M_870603): a backslash in an add path could wildmatch-escape in
// git's non-literal pathspec mode, so the add half never qualifies with one.
describe("AC-STE-741.2 — a backslash in an add path keeps the command off the pass", () => {
  test("AC-STE-741.2 — `git add specs\\frs\\FX-1.md && git commit` reads no add-then-commit shape", async () => {
    const { resolveCommitTarget } = await import("../adapters/_shared/src/commit_target_repo");
    const w = makeWorld();
    const plain = resolveCommitTarget(`git add ${FR_ACTIVE_PATH} && git commit -m ${MSG}`, w.repo);
    expect(plain.addThenCommit).not.toBeNull();
    const slashed = resolveCommitTarget(`git add 'specs\\frs\\FX-1.md' && git commit -m ${MSG}`, w.repo);
    expect(slashed.addThenCommit).toBeNull();
  }, T);
});
