// STE-705 — the docs name the archive-only pass and stop calling the
// session-blind leg the only one.
//
// Every surface that describes the commit gate or the pull request gate names
// the archive-only pass (STE-700) as a second evidence-free way through; no
// surface says the missing-session leg is the only one; the hooks reference's
// allowed-edit list matches the classifier (appended-block wording).
//
// Each AC .1 assertion is scoped to the section / paragraph / bullet the AC
// names, not to the whole file, so a mention elsewhere cannot satisfy it.

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");

const read = (p: string): string => readFileSync(p, "utf-8");

/** Collapse whitespace, line-wrap prefixes (`//`, ` * `, `#`, `│`, `>`) and markdown emphasis. */
function norm(s: string): string {
  return s.replace(/[\s*/#│>_]+/g, " ").toLowerCase();
}

/** Text from the first occurrence of `start` up to (not including) the first `end` after it. */
function between(text: string, start: string | RegExp, end: string | RegExp): string {
  const sIdx = typeof start === "string" ? text.indexOf(start) : text.search(start);
  if (sIdx < 0) return "";
  const rest = text.slice(sIdx);
  const firstLineEnd = rest.indexOf("\n") < 0 ? rest.length : rest.indexOf("\n");
  const tail = rest.slice(firstLineEnd);
  const eIdx = typeof end === "string" ? tail.indexOf(end) : tail.search(end);
  return eIdx < 0 ? rest : rest.slice(0, firstLineEnd + eIdx);
}

/** The paragraph (up to the first blank line) that begins with `start`. */
function paragraph(text: string, start: string): string {
  return between(text, start, /\n\s*\n/);
}

const ARCHIVE_ONLY = /archive[- ]only/i;
/** Restating the allowed-edit set belongs to the hooks reference alone. */
const ALLOWED_SET_RESTATEMENTS = ["## Implementation notes", "archived_at", "token-stats:begin", "- [x]"];

function expectNamesPassWithoutRestating(label: string, scope: string): void {
  expect({ label, scopeFound: scope.length > 0 }).toEqual({ label, scopeFound: true });
  expect({ label, namesArchiveOnlyPass: ARCHIVE_ONLY.test(scope) }).toEqual({
    label,
    namesArchiveOnlyPass: true,
  });
  for (const needle of ALLOWED_SET_RESTATEMENTS) {
    expect({ label, needle, restated: scope.includes(needle) }).toEqual({ label, needle, restated: false });
  }
}

// ------------------------------------------------------------ AC-STE-705.1

describe("AC-STE-705.1 — every gate-describing surface names the archive-only pass", () => {
  test("repo-root CLAUDE.md — the hooks/ bullet of the structure tree", () => {
    const md = read(join(REPO_ROOT, "CLAUDE.md"));
    const scope = between(md, "├── hooks/", "├── scripts/");
    expectNamesPassWithoutRestating("CLAUDE.md hooks/ bullet", scope);
  });

  test("README.md — the structure tree's hooks/ entry", () => {
    const md = read(join(REPO_ROOT, "README.md"));
    const scope = between(md, "├── hooks/", "├── scripts/");
    expectNamesPassWithoutRestating("README.md hooks/ entry", scope);
  });

  test("templates/CLAUDE.md.template — § Gates on these chains", () => {
    const md = read(join(PLUGIN_ROOT, "templates", "CLAUDE.md.template"));
    const scope = between(md, "**Gates on these chains.**", /\n## /);
    expectNamesPassWithoutRestating("template § Gates on these chains", scope);
  });

  test("docs/honored-contracts.md — the pre-commit-gate-check mandate", () => {
    const md = read(join(PLUGIN_ROOT, "docs", "honored-contracts.md"));
    const scope = between(md, "## pre-commit-gate-check → /gate-check", /\n## /);
    expectNamesPassWithoutRestating("honored-contracts pre-commit-gate-check", scope);
  });

  test("docs/honored-contracts.md — the pre-pr-spec-review mandate", () => {
    const md = read(join(PLUGIN_ROOT, "docs", "honored-contracts.md"));
    const scope = between(md, "## pre-pr-spec-review → /spec-review", /\n## /);
    expectNamesPassWithoutRestating("honored-contracts pre-pr-spec-review", scope);
  });

  test("docs/setup-reference.md — the gate list", () => {
    const md = read(join(PLUGIN_ROOT, "docs", "setup-reference.md"));
    const scope = between(md, "Three bundled hooks block", "> **Canonical copy.**");
    expectNamesPassWithoutRestating("setup-reference gate list", scope);
  });

  test("docs/workflow-overview.md — the commit-gate paragraph (§ 4)", () => {
    const md = read(join(PLUGIN_ROOT, "docs", "workflow-overview.md"));
    const scope = between(md, "The loop is not advisory at its exit.", "```mermaid");
    expectNamesPassWithoutRestating("workflow-overview commit gates", scope);
  });

  test("docs/workflow-overview.md — the pull request gate paragraph (§ 5)", () => {
    const md = read(join(PLUGIN_ROOT, "docs", "workflow-overview.md"));
    const scope = between(md, "The PR has a hook of its own", "Tracker writes have one too");
    expectNamesPassWithoutRestating("workflow-overview PR gate", scope);
  });

  test("skills/pr/SKILL.md — the spec-review hook paragraph", () => {
    const md = read(join(PLUGIN_ROOT, "skills", "pr", "SKILL.md"));
    const scope = between(md, "## Spec-Review Pre-Flight", /\n## /);
    expectNamesPassWithoutRestating("pr SKILL spec-review pre-flight", scope);
  });
});

// ------------------------------------------------------------ AC-STE-705.2

describe("AC-STE-705.2 — the template names both evidence-free legs", () => {
  const md = read(join(PLUGIN_ROOT, "templates", "CLAUDE.md.template"));

  test("no longer says the gates fail open ONLY when they cannot see the session", () => {
    expect(norm(md)).not.toContain(norm("fail open only when they cannot see"));
  });

  test("the paragraph naming the session-blind leg names the archive-only pass beside it", () => {
    const p = paragraph(md, "**Gates on these chains.**");
    expect(p.length).toBeGreaterThan(0);
    expect(p).toMatch(/fail open/i);
    expect(p).toMatch(ARCHIVE_ONLY);
  });
});

// ------------------------------------------------------------ AC-STE-705.3

describe("AC-STE-705.3 — the hooks reference stops calling the missing-session leg the only one", () => {
  const md = read(join(PLUGIN_ROOT, "docs", "hooks-reference.md"));

  test("no 'the ONE fail-open leg'", () => {
    expect(norm(md)).not.toContain(norm("the one fail-open leg"));
  });

  test("no 'only leg on which a guard passes without evidence'", () => {
    expect(norm(md)).not.toContain(norm("only leg on which a guard passes without evidence"));
  });

  test("the fail-open paragraph names the archive-only pass as the other evidence-free leg", () => {
    const p = paragraph(md, "**Fail-open on missing session log");
    expect(p.length).toBeGreaterThan(0);
    expect(p).toMatch(ARCHIVE_ONLY);
  });
});

// ------------------------------------------------------------ AC-STE-705.4

describe("AC-STE-705.4 — the allowed-edit list matches the classifier's appended blocks", () => {
  const md = read(join(PLUGIN_ROOT, "docs", "hooks-reference.md"));
  const list = between(md, "A change set is archive-only when", "Anything else —");

  test("the allowed-edit list is found", () => {
    expect(list).toContain("## Implementation notes");
  });

  test("an appended ## Implementation notes section may be followed only by blank lines or a token-stats block", () => {
    expect(norm(list)).toMatch(/implementation notes[^;]*followed only by blank lines or (?:by )?a token-stats block/);
  });

  test("a complete new token-stats block appended at the end of the file is allowed", () => {
    expect(norm(list)).toMatch(/a complete new token-stats block appended at the end of the file/);
  });
});

// ------------------------------------------------------------ AC-STE-705.5

const BANNED = "only leg on which a guard passes without evidence";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git") continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (st.isFile()) out.push(p);
  }
  return out;
}

describe("AC-STE-705.5 — the 'only leg' claim appears on no shipped surface", () => {
  test(`'${BANNED}' is in no file under docs/, templates/, skills/, nor README.md / CLAUDE.md`, () => {
    const files = [
      ...walk(join(PLUGIN_ROOT, "docs")),
      ...walk(join(PLUGIN_ROOT, "templates")),
      ...walk(join(PLUGIN_ROOT, "skills")),
      join(REPO_ROOT, "README.md"),
      join(REPO_ROOT, "CLAUDE.md"),
    ];
    expect(files.length).toBeGreaterThan(10);
    const needle = norm(BANNED);
    const hits = files.filter((f) => norm(read(f)).includes(needle)).map((f) => relative(REPO_ROOT, f));
    expect(hits).toEqual([]);
  });

  test("control: the normaliser catches a line-wrapped, emphasised occurrence", () => {
    const wrapped = "This is the **only leg on which\n * a guard passes** without\n// evidence.";
    expect(norm(wrapped)).toContain(norm(BANNED));
  });

  test("no hook source under templates/hooks/ still calls it 'the ONE fail-open leg'", () => {
    const needle = norm("ONE fail-open leg");
    const hits = walk(join(PLUGIN_ROOT, "templates", "hooks"))
      .filter((f) => norm(read(f)).includes(needle))
      .map((f) => relative(REPO_ROOT, f));
    expect(hits).toEqual([]);
  });
});
