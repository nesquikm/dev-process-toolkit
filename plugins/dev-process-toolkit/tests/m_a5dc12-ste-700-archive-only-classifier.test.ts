// STE-700 — the archive-only classifier, its git reader, the shared spec-path
// rule, and the docs that name the pass.
//
// The module under test is `adapters/_shared/src/archive_only_change.ts`. Its
// contract, as these tests read it:
//
//   interface ArchiveChange {
//     status: string;   // git --name-status letter, a rename score allowed ("R087")
//     path: string;     // the destination path (the new path for a rename)
//     oldPath?: string; // the source path, for a rename
//     diff: string;     // that file's unified diff, git's layout
//   }
//   isArchiveOnly(changes: readonly ArchiveChange[]): boolean
//   readStagedChanges(repoRoot: string): ArchiveChange[]          // index vs HEAD
//   readBranchChanges(repoRoot: string, base: string): ArchiveChange[]
//                                                   // merge-base(base, HEAD)..HEAD
//   SPEC_PATTERNS: readonly RegExp[]; isSpecPath(p: string): boolean  // AC.8
//
// The module is imported dynamically per test so one missing export reds the
// rows that need it, not the whole file.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  added,
  applyArchiveMove,
  deleted,
  FR_ACTIVE_PATH,
  FR_ARCHIVE_PATH,
  frArchivedText,
  frText,
  git,
  makeArchiveRepo,
  modified,
  PLAN_ACTIVE_PATH,
  PLAN_ARCHIVE_PATH,
  PLAN_TASKS_OPEN,
  PLAN_TASKS_TICKED,
  planArchivedText,
  planText,
  renamed,
  REQ_ROW_NEW,
  REQ_ROWS_BASE,
  REQUIREMENTS_PATH,
  requirementsText,
  TOKEN_ROWS_FILLED,
  writeAt,
  type FixtureChange,
} from "./_archive_only_fixture";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const MODULE_PATH = join(PLUGIN_ROOT, "adapters", "_shared", "src", "archive_only_change.ts");
const HOOKS_DIR = join(PLUGIN_ROOT, "templates", "hooks", "_lib", "hooks");
const TDD_HOOK = join(HOOKS_DIR, "pre-commit-tdd-orchestrator.ts");
const DOCS = join(PLUGIN_ROOT, "docs", "hooks-reference.md");

interface ClassifierModule {
  isArchiveOnly: (changes: readonly FixtureChange[]) => boolean;
  readStagedChanges: (root: string) => FixtureChange[];
  readBranchChanges: (root: string, base: string) => FixtureChange[];
  SPEC_PATTERNS: readonly RegExp[];
  isSpecPath: (p: string) => boolean;
}

async function mod(): Promise<ClassifierModule> {
  return (await import(MODULE_PATH)) as ClassifierModule;
}

async function classify(changes: FixtureChange[]): Promise<boolean> {
  const m = await mod();
  expect(typeof m.isArchiveOnly).toBe("function");
  return m.isArchiveOnly(changes);
}

let tmpRoot: string;
beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "m-a5dc12-700-cls-"));
});
afterEach(() => {
  if (tmpRoot && existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
});

// ------------------------------------------------------------------ fixtures

const FR_BEFORE = frText();
const PLAN_BEFORE = planText();
const REQ_BEFORE = requirementsText();
const REQ_AFTER = requirementsText([...REQ_ROWS_BASE, REQ_ROW_NEW]);

const frMove = (after: string, status?: string) =>
  renamed(FR_ACTIVE_PATH, FR_ARCHIVE_PATH, FR_BEFORE, after, status);
const planMove = (after: string) => renamed(PLAN_ACTIVE_PATH, PLAN_ARCHIVE_PATH, PLAN_BEFORE, after);

// ------------------------------------------------------------ AC-STE-700.1

describe("AC-STE-700.1 — archive-only only for archive renames and a requirements.md modification", () => {
  test("module exists at adapters/_shared/src/archive_only_change.ts", () => {
    expect(existsSync(MODULE_PATH)).toBe(true);
  });

  test("PERMIT — a bare FR rename into specs/frs/archive/ (rename-only rule)", async () => {
    expect(await classify([frMove(FR_BEFORE)])).toBe(true);
  });

  test("PERMIT — a bare plan rename into specs/plan/archive/ (rename-only rule)", async () => {
    expect(await classify([planMove(PLAN_BEFORE)])).toBe(true);
  });

  test("PERMIT — the full archive set: FR + plan moved and stamped, a traceability row appended", async () => {
    expect(
      await classify([
        frMove(frArchivedText()),
        planMove(planArchivedText()),
        modified(REQUIREMENTS_PATH, REQ_BEFORE, REQ_AFTER),
      ]),
    ).toBe(true);
  });

  test("FORBID — an empty change set is not archive-only", async () => {
    expect(await classify([])).toBe(false);
  });

  test("FORBID — an archive rename beside a path outside specs/", async () => {
    expect(
      await classify([
        frMove(FR_BEFORE),
        modified("src/app.ts", "export const app = 1;\n", "export const app = 2;\n"),
      ]),
    ).toBe(false);
  });

  test("FORBID — an edit to an ACTIVE FR (modified in place, no rename)", async () => {
    expect(await classify([modified(FR_ACTIVE_PATH, FR_BEFORE, frArchivedText())])).toBe(false);
  });

  test("FORBID — a file added under an archive folder with no matching delete", async () => {
    expect(await classify([added(FR_ARCHIVE_PATH, frArchivedText())])).toBe(false);
  });

  test("FORBID — a deletion of an FR", async () => {
    expect(await classify([deleted(FR_ACTIVE_PATH, FR_BEFORE)])).toBe(false);
  });

  test("FORBID — a rename that changes the basename", async () => {
    expect(
      await classify([renamed(FR_ACTIVE_PATH, "specs/frs/archive/FX-2.md", FR_BEFORE, FR_BEFORE)]),
    ).toBe(false);
  });

  test("FORBID — a rename OUT of the archive (archive → active)", async () => {
    expect(
      await classify([renamed(FR_ARCHIVE_PATH, FR_ACTIVE_PATH, FR_BEFORE, FR_BEFORE)]),
    ).toBe(false);
  });

  test("FORBID — a plan renamed into the FR archive folder", async () => {
    expect(
      await classify([
        renamed(PLAN_ACTIVE_PATH, "specs/frs/archive/M_fx0001.md", PLAN_BEFORE, PLAN_BEFORE),
      ]),
    ).toBe(false);
  });

  test("FORBID — a rename into a nested folder under the archive", async () => {
    expect(
      await classify([renamed(FR_ACTIVE_PATH, "specs/frs/archive/sub/FX-1.md", FR_BEFORE, FR_BEFORE)]),
    ).toBe(false);
  });

  test("FORBID — a modification of a spec file other than specs/requirements.md", async () => {
    expect(
      await classify([
        modified("specs/technical-spec.md", "# Technical spec\n", "# Technical spec\n\nA new line.\n"),
      ]),
    ).toBe(false);
  });
});

// ------------------------------------------------------------ AC-STE-700.2

describe("AC-STE-700.2 — the allowed-edit set inside a renamed file", () => {
  // Rule: frontmatter status + archived_at values.
  test("PERMIT — frontmatter status + archived_at flipped (rename score R087)", async () => {
    const after = frText({ status: "archived", archivedAt: "2026-11-02T10:11:12Z" });
    expect(await classify([frMove(after, "R087")])).toBe(true);
  });

  test("FORBID — another frontmatter key changed (milestone)", async () => {
    const after = frText({ status: "archived", archivedAt: "2026-11-02T10:11:12Z", milestone: "M_fx0002" });
    expect(await classify([frMove(after)])).toBe(false);
  });

  test("FORBID — a `status:` line OUTSIDE the frontmatter changed", async () => {
    const before = frText({ summary: ["Body text.", "status: active", "More body text."] });
    const after = frText({ summary: ["Body text.", "status: archived", "More body text."] });
    expect(await classify([renamed(FR_ACTIVE_PATH, FR_ARCHIVE_PATH, before, after)])).toBe(false);
  });

  // Rule: plan checkboxes ticked.
  test("PERMIT — plan task checkboxes ticked from `- [ ]` to `- [x]`", async () => {
    expect(await classify([planMove(planText({ tasks: PLAN_TASKS_TICKED }))])).toBe(true);
  });

  test("FORBID [round-2 review] — a checkbox ticked inside a renamed FR (the tick rule is for PLAN tasks only)", async () => {
    const before = frText({ summary: ["Body text.", "- [ ] an FR body checklist item", "More body text."] });
    const after = frText({ summary: ["Body text.", "- [x] an FR body checklist item", "More body text."] });
    expect(await classify([renamed(FR_ACTIVE_PATH, FR_ARCHIVE_PATH, before, after)])).toBe(false);
  });

  test("FORBID — a checkbox ticked AND its task text changed", async () => {
    const tasks = [...PLAN_TASKS_TICKED];
    tasks[0] = "- [x] task one: write a different thing";
    expect(await classify([planMove(planText({ tasks }))])).toBe(false);
  });

  test("FORBID — a checkbox UN-ticked (`- [x]` back to `- [ ]`)", async () => {
    const before = planText({ tasks: PLAN_TASKS_TICKED });
    const after = planText({ tasks: PLAN_TASKS_OPEN });
    expect(
      await classify([renamed(PLAN_ACTIVE_PATH, PLAN_ARCHIVE_PATH, before, after)]),
    ).toBe(false);
  });

  test("FORBID — a new unticked task line added", async () => {
    const after = planText({ tasks: [...PLAN_TASKS_OPEN, "- [ ] task four: a new task"] });
    expect(await classify([planMove(after)])).toBe(false);
  });

  // Rule: an appended `## Implementation notes` section.
  test("PERMIT — a `## Implementation notes` section appended after `## Notes`", async () => {
    expect(await classify([frMove(frText({ implementationNotes: true }))])).toBe(true);
  });

  test("FORBID — a section with any OTHER heading added in the same place", async () => {
    const after = FR_BEFORE.replace(
      "<!-- token-stats:begin -->",
      "## Extra section\n\nNo advisory notes.\n\n<!-- token-stats:begin -->",
    );
    expect(after).not.toBe(FR_BEFORE);
    expect(await classify([frMove(after)])).toBe(false);
  });

  // Rule: the token-stats marker block.
  test("PERMIT — rows inside the token-stats marker block refreshed", async () => {
    expect(await classify([frMove(frText({ tokenRows: TOKEN_ROWS_FILLED }))])).toBe(true);
  });

  test("FORBID — a token-stats-shaped row added OUTSIDE the marker block", async () => {
    const after = FR_BEFORE.replace("## Notes\n", `## Notes\n\n${TOKEN_ROWS_FILLED[0]}\n`);
    expect(after).not.toBe(FR_BEFORE);
    expect(await classify([frMove(after)])).toBe(false);
  });

  // Anything else.
  test("FORBID — a body prose line changed", async () => {
    const summary = frText().split("\n").slice(14, 22);
    summary[2] = "This line was edited during the archive.";
    expect(await classify([frMove(frText({ summary }))])).toBe(false);
  });

  test("FORBID — a body line removed", async () => {
    const after = FR_BEFORE.replace("- AC-FX-1.2: the second criterion holds.\n", "");
    expect(after).not.toBe(FR_BEFORE);
    expect(await classify([frMove(after)])).toBe(false);
  });

  test("FORBID — a plain prose line added to the body", async () => {
    const after = FR_BEFORE.replace("## Notes\n", "## Notes\n\nAn extra sentence.\n");
    expect(await classify([frMove(after)])).toBe(false);
  });
});

// ------------------------------------------------------------ AC-STE-700.3

describe("AC-STE-700.3 — specs/requirements.md takes only added `| AC-` rows", () => {
  test("PERMIT — one traceability row appended", async () => {
    expect(await classify([modified(REQUIREMENTS_PATH, REQ_BEFORE, REQ_AFTER)])).toBe(true);
  });

  test("FORBID — a line removed", async () => {
    const after = requirementsText([]);
    expect(await classify([modified(REQUIREMENTS_PATH, REQ_BEFORE, after)])).toBe(false);
  });

  test("FORBID — an existing `| AC-` row rewritten (a removal plus an addition)", async () => {
    const after = requirementsText(["| AC-FX-0.1..3 | src/archive/zero.ts | tests/zero.test.ts |"]);
    expect(await classify([modified(REQUIREMENTS_PATH, REQ_BEFORE, after)])).toBe(false);
  });

  test("FORBID — an added line that is not a `| AC-` row", async () => {
    const after = requirementsText([...REQ_ROWS_BASE, "| FX-1 | not an AC row | - |"]);
    expect(await classify([modified(REQUIREMENTS_PATH, REQ_BEFORE, after)])).toBe(false);
  });

  test("FORBID — an added prose line", async () => {
    const after = REQ_AFTER.replace("Fixture requirements.\n", "Fixture requirements.\nA new sentence.\n");
    expect(await classify([modified(REQUIREMENTS_PATH, REQ_BEFORE, after)])).toBe(false);
  });
});

// ------------------------------------------------------------ AC-STE-700.7

describe("AC-STE-700.7 — the reader turns rename detection on; delete + add is not a move", () => {
  test("FORBID (pure) — a delete plus an add of the same basename is not archive-only", async () => {
    expect(
      await classify([deleted(FR_ACTIVE_PATH, FR_BEFORE), added(FR_ARCHIVE_PATH, frArchivedText())]),
    ).toBe(false);
  });

  test("readStagedChanges reports a staged archive move as ONE rename, even with diff.renames=false", async () => {
    const m = await mod();
    const repo = makeArchiveRepo(join(tmpRoot, "staged-rename"));
    applyArchiveMove(repo);
    const changes = m.readStagedChanges(repo);
    const fr = changes.filter((c) => c.path === FR_ARCHIVE_PATH || c.path === FR_ACTIVE_PATH || c.oldPath === FR_ACTIVE_PATH);
    expect(fr.length).toBe(1);
    expect(fr[0]!.status.startsWith("R")).toBe(true);
    expect(fr[0]!.oldPath).toBe(FR_ACTIVE_PATH);
    expect(fr[0]!.path).toBe(FR_ARCHIVE_PATH);
    expect(changes.map((c) => c.path).sort()).toEqual(
      [FR_ARCHIVE_PATH, PLAN_ARCHIVE_PATH, REQUIREMENTS_PATH].sort(),
    );
    expect(m.isArchiveOnly(changes)).toBe(true);
  });

  test("a move git reports as a delete plus an add (content rewritten) is NOT archive-only", async () => {
    const m = await mod();
    const repo = makeArchiveRepo(join(tmpRoot, "staged-rewrite"));
    git(repo, "rm", "-q", FR_ACTIVE_PATH);
    writeAt(
      repo,
      FR_ARCHIVE_PATH,
      Array.from({ length: 30 }, (_, i) => `entirely different line ${i}`).join("\n") + "\n",
    );
    git(repo, "add", "-A");
    const changes = m.readStagedChanges(repo);
    const statuses = changes.map((c) => c.status[0]).sort();
    expect(statuses).toEqual(["A", "D"]);
    expect(m.isArchiveOnly(changes)).toBe(false);
  });

  test("readBranchChanges diffs from the MERGE-BASE, not the base tip", async () => {
    const m = await mod();
    const repo = makeArchiveRepo(join(tmpRoot, "branch"));
    git(repo, "checkout", "-q", "-b", "feature");
    applyArchiveMove(repo);
    git(repo, "commit", "-q", "-m", "chore: archive");
    // main moves on with a non-spec change AFTER the branch point.
    git(repo, "checkout", "-q", "main");
    writeAt(repo, "src/app.ts", "export const app = 2;\n");
    git(repo, "commit", "-q", "-am", "feat: main moves on");
    git(repo, "checkout", "-q", "feature");
    const changes = m.readBranchChanges(repo, "main");
    expect(changes.map((c) => c.path).sort()).toEqual(
      [FR_ARCHIVE_PATH, PLAN_ARCHIVE_PATH, REQUIREMENTS_PATH].sort(),
    );
    expect(changes.find((c) => c.path === FR_ARCHIVE_PATH)?.status.startsWith("R")).toBe(true);
    expect(m.isArchiveOnly(changes)).toBe(true);
  });

  test("readBranchChanges sees a non-spec commit on the branch", async () => {
    const m = await mod();
    const repo = makeArchiveRepo(join(tmpRoot, "branch-src"));
    git(repo, "checkout", "-q", "-b", "feature");
    applyArchiveMove(repo);
    git(repo, "commit", "-q", "-m", "chore: archive");
    writeAt(repo, "src/app.ts", "export const app = 3;\n");
    git(repo, "commit", "-q", "-am", "feat: sneak in");
    const changes = m.readBranchChanges(repo, "main");
    expect(changes.map((c) => c.path)).toContain("src/app.ts");
    expect(m.isArchiveOnly(changes)).toBe(false);
  });
});

// ------------------------------------------------------------ AC-STE-700.2 [hardening]
//
// "An appended `## Implementation notes` section" means APPENDED: only blank
// lines, the token-stats marker block, or EOF may follow it, and the section
// carries no subsection of its own.

describe("AC-STE-700.2 [hardening] — the Implementation notes section must be appended", () => {
  const NOTES_BLOCK = "## Implementation notes\n\nNo advisory notes.\n\n";

  test("AC-STE-700.2 [hardening] FORBID — the section inserted in the MIDDLE (before an unchanged `## Notes`)", async () => {
    const after = FR_BEFORE.replace("## Notes\n", `${NOTES_BLOCK}## Notes\n`);
    expect(after).not.toBe(FR_BEFORE);
    // Unchanged non-blank body lines follow the inserted block.
    const tail = after.slice(after.indexOf("## Implementation notes") + NOTES_BLOCK.length);
    expect(tail.startsWith("## Notes\n\nOrigin: a synthetic fixture.")).toBe(true);
    expect(await classify([frMove(after)])).toBe(false);
  });

  test("AC-STE-700.2 [hardening] FORBID — the appended section carrying a `### ` subsection", async () => {
    const after = FR_BEFORE.replace(
      "<!-- token-stats:begin -->",
      "## Implementation notes\n\nNo advisory notes.\n\n### Details\n\nMore detail.\n\n<!-- token-stats:begin -->",
    );
    expect(after).not.toBe(FR_BEFORE);
    expect(await classify([frMove(after)])).toBe(false);
  });

  test("AC-STE-700.2 [hardening] PERMIT — the section appended after `## Notes`, before the token-stats block", async () => {
    const after = FR_BEFORE.replace("<!-- token-stats:begin -->", `${NOTES_BLOCK}<!-- token-stats:begin -->`);
    expect(after).toBe(frText({ implementationNotes: true }));
    expect(await classify([frMove(after)])).toBe(true);
  });
});

// ------------------------------------------------------------ AC-STE-700.2 [hardening: real archive shape]
//
// An FR that carried NO token-stats block before archiving gets, in ONE
// contiguous pure addition at EOF: a blank line, `## Implementation notes`, a
// blank line, the note body, a blank line, then a COMPLETE new token-stats
// block. That is what the archive flow writes, so "the token-stats marker
// block" covers adding the whole block, not only editing one that existed.

describe("AC-STE-700.2 [hardening: real archive shape] — an FR with no prior token-stats block", () => {
  const TS_BEGIN = "<!-- token-stats:begin -->";
  const TS_END = "<!-- token-stats:end -->";
  // The FR as it stood before archiving: everything up to the token-stats block.
  const NO_BLOCK_BEFORE = (() => {
    const t = frText();
    const cut = t.indexOf(TS_BEGIN);
    return t.slice(0, cut).replace(/\n+$/, "\n");
  })();
  const NEW_TOKEN_BLOCK = [
    TS_BEGIN,
    "",
    "## Token Stats",
    "",
    "| skill | model | input | output | cache-read | cache-creation |",
    "| --- | --- | ---: | ---: | ---: | ---: |",
    "| subtotal |  | 0 | 0 | 0 | 0 |",
    "",
    TS_END,
  ].join("\n") + "\n";
  const NOTES_BULLETS = "\n## Implementation notes\n\n- the fixture took one pass.\n- nothing else to report.\n\n";
  const NOTES_PLAIN = "\n## Implementation notes\n\nNo advisory notes.\n\n";

  const flip = (t: string) =>
    t
      .replace("status: active\n", "status: archived\n")
      .replace("archived_at: null\n", "archived_at: 2026-11-02T10:11:12Z\n");
  const move = (after: string) => renamed(FR_ACTIVE_PATH, FR_ARCHIVE_PATH, NO_BLOCK_BEFORE, after, "R078");

  test("AC-STE-700.2 [hardening: real archive shape] fixture — the before-text carries no token-stats block", () => {
    expect(NO_BLOCK_BEFORE).not.toContain(TS_BEGIN);
    expect(NO_BLOCK_BEFORE.endsWith("Origin: a synthetic fixture.\n")).toBe(true);
  });

  test("AC-STE-700.2 [hardening: real archive shape] PERMIT — frontmatter flip + bullet notes + a complete new token-stats block appended at EOF", async () => {
    const after = flip(NO_BLOCK_BEFORE) + NOTES_BULLETS + NEW_TOKEN_BLOCK;
    expect(await classify([move(after)])).toBe(true);
  });

  test("AC-STE-700.2 [hardening: real archive shape] PERMIT — same with the body `No advisory notes.`", async () => {
    const after = flip(NO_BLOCK_BEFORE) + NOTES_PLAIN + NEW_TOKEN_BLOCK;
    expect(await classify([move(after)])).toBe(true);
  });

  test("AC-STE-700.2 [hardening: real archive shape] PERMIT — no notes section, only a complete new token-stats block appended at EOF", async () => {
    const after = flip(NO_BLOCK_BEFORE) + "\n" + NEW_TOKEN_BLOCK;
    expect(await classify([move(after)])).toBe(true);
  });

  test("AC-STE-700.2 [hardening: real archive shape] FORBID — an appended token-stats block never closed by the end marker", async () => {
    const unclosed = NEW_TOKEN_BLOCK.replace(`${TS_END}\n`, "");
    expect(unclosed).toContain(TS_BEGIN);
    expect(unclosed).not.toContain(TS_END);
    const after = flip(NO_BLOCK_BEFORE) + NOTES_PLAIN + unclosed;
    expect(await classify([move(after)])).toBe(false);
  });

  test("AC-STE-700.2 [hardening: real archive shape] FORBID — a further non-blank line added after the appended block closes", async () => {
    const after = flip(NO_BLOCK_BEFORE) + NOTES_PLAIN + NEW_TOKEN_BLOCK + "\nextra prose\n";
    expect(await classify([move(after)])).toBe(false);
  });

  test("AC-STE-700.2 [hardening: real archive shape] FORBID — the added notes block carries a `### ` subsection before the begin marker", async () => {
    const notes = "\n## Implementation notes\n\nNo advisory notes.\n\n### Details\n\nMore detail.\n\n";
    const after = flip(NO_BLOCK_BEFORE) + notes + NEW_TOKEN_BLOCK;
    expect(await classify([move(after)])).toBe(false);
  });

  test("AC-STE-700.2 [hardening: real archive shape] readStagedChanges — git mv + the real archive edit (diff.renames=false) → archive-only", async () => {
    const m = await mod();
    const repo = makeArchiveRepo(join(tmpRoot, "real-archive-shape"));
    git(repo, "config", "diff.renames", "false");
    writeAt(repo, FR_ACTIVE_PATH, NO_BLOCK_BEFORE);
    git(repo, "commit", "-q", "-am", "chore: FR without a token-stats block");
    applyArchiveMove(repo, flip(NO_BLOCK_BEFORE) + NOTES_BULLETS + NEW_TOKEN_BLOCK);
    const changes = m.readStagedChanges(repo);
    const fr = changes.find((c) => c.path === FR_ARCHIVE_PATH);
    expect(fr?.status.startsWith("R")).toBe(true);
    expect(fr?.oldPath).toBe(FR_ACTIVE_PATH);
    expect(changes.map((c) => c.path).sort()).toEqual(
      [FR_ARCHIVE_PATH, PLAN_ARCHIVE_PATH, REQUIREMENTS_PATH].sort(),
    );
    expect(m.isArchiveOnly(changes)).toBe(true);
  });
});

// ------------------------------------------------------------ AC-STE-700.7 [hardening]

describe("AC-STE-700.7 [hardening] — the reader's full-context diff sees a deep frontmatter flip", () => {
  test("AC-STE-700.7 [hardening] readStagedChanges with diff.context=3: `status:` at line 10+ flipped + archived_at stamped → archive-only", async () => {
    const m = await mod();
    const repo = makeArchiveRepo(join(tmpRoot, "deep-frontmatter"));
    git(repo, "config", "diff.context", "3");
    git(repo, "config", "diff.renames", "false");
    const extraKeys = Array.from({ length: 8 }, (_, i) => `key_${i + 1}: value ${i + 1}`).join("\n");
    const deep = (t: string) =>
      t.replace("title: Fixture requirement one\n", `title: Fixture requirement one\n${extraKeys}\n`);
    const before = deep(frText());
    const statusLine = before.split("\n").indexOf("status: active") + 1;
    expect(statusLine).toBeGreaterThanOrEqual(10);
    writeAt(repo, FR_ACTIVE_PATH, before);
    git(repo, "commit", "-q", "-am", "chore: deep frontmatter");
    // The move as an index delete + add of the stamped text (writeAt creates
    // the archive folder); rename detection must pair them back up.
    git(repo, "rm", "-q", FR_ACTIVE_PATH);
    writeAt(repo, FR_ARCHIVE_PATH, deep(frText({ status: "archived", archivedAt: "2026-11-02T10:11:12Z" })));
    git(repo, "add", "-A");
    const changes = m.readStagedChanges(repo);
    expect(changes.map((c) => [c.status[0], c.oldPath ?? null, c.path])).toEqual([["R", FR_ACTIVE_PATH, FR_ARCHIVE_PATH]]);
    expect(m.isArchiveOnly(changes)).toBe(true);
  });
});

// ------------------------------------------------------------ AC-STE-700.8

// The seven regex literals the tdd hook kept privately before STE-700.
const PRIVATE_SPEC_REGEX_SOURCES = [
  String.raw`/^specs\/frs\/[^/]+\.md$/`,
  String.raw`/^specs\/frs\/archive\/[^/]+\.md$/`,
  String.raw`/^specs\/plan\/M[^/]*\.md$/`,
  String.raw`/^specs\/plan\/archive\/[^/]+\.md$/`,
  String.raw`/^specs\/requirements\.md$/`,
  String.raw`/^specs\/technical-spec\.md$/`,
  String.raw`/^specs\/testing-spec\.md$/`,
];

describe("AC-STE-700.8 — the spec-path rule lives in the shared module, imported by the tdd hook", () => {
  test("the shared module exports SPEC_PATTERNS and isSpecPath with the shipped rule", async () => {
    const m = await mod();
    expect(Array.isArray(m.SPEC_PATTERNS)).toBe(true);
    expect(m.SPEC_PATTERNS.length).toBe(7);
    const yes = [
      "specs/frs/STE-1.md",
      "specs/frs/archive/STE-1.md",
      "specs/plan/M_fx0001.md",
      "specs/plan/archive/M_fx0001.md",
      "specs/requirements.md",
      "specs/technical-spec.md",
      "specs/testing-spec.md",
    ];
    const no = [
      "specs/frs/archive/sub/STE-1.md",
      "specs/plan/notes.md",
      "specs/other.md",
      "src/specs/requirements.md",
      "specs/frs/STE-1.txt",
    ];
    expect(yes.map(m.isSpecPath)).toEqual(yes.map(() => true));
    expect(no.map(m.isSpecPath)).toEqual(no.map(() => false));
  });

  test("pre-commit-tdd-orchestrator.ts imports the rule from archive_only_change.ts", () => {
    const src = readFileSync(TDD_HOOK, "utf-8");
    expect(src).toMatch(
      /import\s*\{[^}]*\bisSpecPath\b[^}]*\}\s*from\s*["'][^"']*adapters\/_shared\/src\/archive_only_change\.ts["']/,
    );
    expect(src).not.toMatch(/const\s+SPEC_PATTERNS\b/);
    expect(src).not.toMatch(/const\s+isSpecPath\b/);
    expect(src).not.toMatch(/function\s+isSpecPath\b/);
  });

  test("no hook source keeps a private copy of the spec-path regexes", () => {
    const offenders: string[] = [];
    for (const f of readdirSync(HOOKS_DIR).filter((n) => n.endsWith(".ts"))) {
      const src = readFileSync(join(HOOKS_DIR, f), "utf-8");
      for (const re of PRIVATE_SPEC_REGEX_SOURCES) {
        if (src.includes(re)) offenders.push(`${f}: ${re}`);
      }
    }
    // Control: the shared module DOES carry them, so the needle is a real one.
    const shared = existsSync(MODULE_PATH) ? readFileSync(MODULE_PATH, "utf-8") : "";
    expect(PRIVATE_SPEC_REGEX_SOURCES.filter((re) => shared.includes(re)).length).toBe(7);
    expect(offenders).toEqual([]);
  });
});

// ------------------------------------------------------------ AC-STE-700.9

function section(md: string, heading: string): string {
  const start = md.indexOf(`\n### ${heading}\n`);
  if (start < 0) return "";
  const rest = md.slice(start + 1);
  const next = rest.slice(4).search(/\n#{2,3} /);
  return next < 0 ? rest : rest.slice(0, next + 4);
}

describe("AC-STE-700.9 — docs/hooks-reference.md documents the archive-only pass", () => {
  const md = readFileSync(DOCS, "utf-8");

  test("the pre-commit-gate-check section documents the archive-only pass", () => {
    const s = section(md, "pre-commit-gate-check");
    expect(s.length).toBeGreaterThan(0);
    expect(s).toMatch(/archive-only/i);
  });

  test("the pre-pr-spec-review section documents the archive-only pass", () => {
    const s = section(md, "pre-pr-spec-review");
    expect(s.length).toBeGreaterThan(0);
    expect(s).toMatch(/archive-only/i);
  });

  test("the doc names the whole allowed-edit set and the shared module", () => {
    for (const needle of [
      "archive_only_change",
      "specs/frs/archive/",
      "specs/plan/archive/",
      "`status`",
      "`archived_at`",
      "- [x]",
      "## Implementation notes",
      "token-stats",
      "| AC-",
    ]) {
      expect({ needle, found: md.includes(needle) }).toEqual({ needle, found: true });
    }
  });

  // AC-STE-705.6 — the appended-block wording of AC-STE-705.4.
  test("the doc names the appended blocks the classifier accepts (AC-STE-705.6)", () => {
    const flat = md.replace(/\s+/g, " ");
    for (const needle of [
      "followed only by blank lines or a token-stats block",
      "a complete new token-stats block appended at the end of the file",
    ]) {
      expect({ needle, found: flat.includes(needle) }).toEqual({ needle, found: true });
    }
  });
});

// ===========================================================================
// [security] — Phase 3, Pass 2: bypasses the archive-only pass must refuse
// ===========================================================================

/** The FR summary with its second sentence rewritten — an edit outside the allowed set. */
function rewrittenSummary(line: string): string[] {
  const summary = frText().split("\n").slice(14, 22);
  summary[1] = line;
  return summary;
}

describe("AC-STE-700.7 / .2 [security] S1 — a binary diff has no hunks to grade, so it is never archive-only", () => {
  test("AC-STE-700.7/.2 [security] S1 FORBID (git) — archived FR whose new body holds a NUL byte + a body edit → readStagedChanges + isArchiveOnly false", async () => {
    const m = await mod();
    const repo = makeArchiveRepo(join(tmpRoot, "s1-nul"));
    applyArchiveMove(repo, frArchivedText({ summary: rewrittenSummary("This sentence was rewritten\0 during the archive.") }));
    const changes = m.readStagedChanges(repo);
    const fr = changes.find((c) => c.path === FR_ARCHIVE_PATH);
    expect(fr?.status.startsWith("R")).toBe(true);
    expect(fr?.diff).toContain("Binary files");
    expect(m.isArchiveOnly(changes)).toBe(false);
  });

  test("AC-STE-700.7/.2 [security] S1 FORBID (git) — archive path marked `-diff` in .git/info/attributes + a body edit → readStagedChanges + isArchiveOnly false", async () => {
    const m = await mod();
    const repo = makeArchiveRepo(join(tmpRoot, "s1-attr"));
    writeAt(repo, ".git/info/attributes", "specs/frs/archive/*.md -diff\n");
    applyArchiveMove(repo, frArchivedText({ summary: rewrittenSummary("This sentence was rewritten during the archive.") }));
    const changes = m.readStagedChanges(repo);
    expect(changes.some((c) => c.path === FR_ARCHIVE_PATH && c.status.startsWith("R"))).toBe(true);
    expect(m.isArchiveOnly(changes)).toBe(false);
  });

  test("AC-STE-700.7/.2 [security] S1 FORBID (pure) — a renamed FR whose diff is a `Binary files … differ` line with no hunks → false", async () => {
    const change: FixtureChange = {
      status: "R090",
      path: FR_ARCHIVE_PATH,
      oldPath: FR_ACTIVE_PATH,
      diff: [
        `diff --git a/${FR_ACTIVE_PATH} b/${FR_ARCHIVE_PATH}`,
        "similarity index 90%",
        `rename from ${FR_ACTIVE_PATH}`,
        `rename to ${FR_ARCHIVE_PATH}`,
        "index 1111111..2222222 100644",
        `Binary files a/${FR_ACTIVE_PATH} and b/${FR_ARCHIVE_PATH} differ`,
      ].join("\n") + "\n",
    };
    expect(await classify([change])).toBe(false);
  });

  test("AC-STE-700.7/.3 [security] S1 FORBID (pure) — a specs/requirements.md modification whose diff carries no hunk → false", async () => {
    const change: FixtureChange = {
      status: "M",
      path: REQUIREMENTS_PATH,
      diff: [
        `diff --git a/${REQUIREMENTS_PATH} b/${REQUIREMENTS_PATH}`,
        "index 1111111..2222222 100644",
        `Binary files a/${REQUIREMENTS_PATH} and b/${REQUIREMENTS_PATH} differ`,
      ].join("\n") + "\n",
    };
    expect(await classify([change])).toBe(false);
  });

  test("AC-STE-700.1 [security] S1 PERMIT CONTROL — a bare R100 FR rename (no hunks, no binary marker) stays archive-only", async () => {
    expect(await classify([frMove(FR_BEFORE)])).toBe(true);
  });
});

describe("AC-STE-700.3 / .2 [security] S2 — a lone carriage return cannot smuggle text onto a graded line", () => {
  test("AC-STE-700.3 [security] S2 FORBID — requirements.md added line `| AC-FX-9.1 | x |` + lone \\r + prose → false", async () => {
    const after = requirementsText([...REQ_ROWS_BASE, "| AC-FX-9.1 | x |\rmalicious prose"]);
    expect(await classify([modified(REQUIREMENTS_PATH, REQ_BEFORE, after)])).toBe(false);
  });

  test("AC-STE-700.3 [security] S2 CONTROL — the same row without the \\r is archive-only", async () => {
    const after = requirementsText([...REQ_ROWS_BASE, "| AC-FX-9.1 | x |"]);
    expect(await classify([modified(REQUIREMENTS_PATH, REQ_BEFORE, after)])).toBe(true);
  });

  test("AC-STE-700.2 [security] S2 FORBID — a renamed FR's frontmatter `status:` flip carrying a lone \\r + a smuggled key → false", async () => {
    const after = frArchivedText().replace("status: archived\n", "status: archived\rmilestone: M_fx9999\n");
    expect(after).toContain("\rmilestone: M_fx9999");
    expect(await classify([frMove(after)])).toBe(false);
  });

  test("AC-STE-700.2 [security] S2 FORBID — a renamed FR's Implementation notes line carrying a lone \\r + a `#` heading → false", async () => {
    const after = frArchivedText().replace("No advisory notes.\n", "No advisory notes.\r### Smuggled subsection\n");
    expect(after).toContain("\r### Smuggled subsection");
    expect(await classify([frMove(after)])).toBe(false);
  });
});

describe("AC-STE-700.7 [security] S5 — the reader diffs each file by its LITERAL path, not a glob", () => {
  const GLOB_ACTIVE = "specs/frs/[x]*.md";
  const GLOB_ARCHIVE = "specs/frs/archive/[x]*.md";
  const SIB_ACTIVE = "specs/frs/xsib.md";
  const SIB_ARCHIVE = "specs/frs/archive/xsib.md";

  /** Base holds the glob-named FR and a sibling the glob also matches; both get archived, the sibling with a disallowed edit. */
  function globRepo(name: string): string {
    const repo = makeArchiveRepo(join(tmpRoot, name));
    writeAt(repo, GLOB_ACTIVE, frText());
    writeAt(repo, SIB_ACTIVE, frText());
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "chore: glob-named fixtures");
    rmSync(join(repo, GLOB_ACTIVE));
    rmSync(join(repo, SIB_ACTIVE));
    writeAt(repo, GLOB_ARCHIVE, frArchivedText());
    writeAt(repo, SIB_ARCHIVE, frArchivedText({ summary: rewrittenSummary("This sentence was rewritten during the archive.") }));
    git(repo, "add", "-A");
    return repo;
  }

  test("AC-STE-700.7 [security] S5 — the glob-named file's change carries ONLY its own diff, not the sibling the glob would match", async () => {
    const m = await mod();
    const repo = globRepo("s5-exact");
    const changes = m.readStagedChanges(repo);
    const own = changes.find((c) => c.path === GLOB_ARCHIVE);
    expect(own?.status.startsWith("R")).toBe(true);
    expect(own?.oldPath).toBe(GLOB_ACTIVE);
    const headers = (own?.diff ?? "").split("\n").filter((l) => l.startsWith("diff --git "));
    expect(headers).toEqual([`diff --git a/${GLOB_ACTIVE} b/${GLOB_ARCHIVE}`]);
  });

  test("AC-STE-700.7 [security] S5 FORBID — the disallowed sibling still makes the set not archive-only", async () => {
    const m = await mod();
    const repo = globRepo("s5-set");
    expect(m.isArchiveOnly(m.readStagedChanges(repo))).toBe(false);
  });
});
