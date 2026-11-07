// STE-720 (M_d1b4b7) pre-merge fix 3 — AC-STE-720.4 for the branch forms the
// whole-token pass cannot see:
//   B1  a branch inside a Claude project-folder slug (`.claude/projects/-~-wt-<B>/`),
//       where `/` became `-` (feat/x -> feat-x);
//   F1  the URL-encoded (`%2F`, `%2f`) and JSON-escaped (`\/`) forms of a name.
// Every form takes the SAME alias as the plain name, so a slug and its cwd agree.
//
// All ids are synthetic (AC-STE-720.10).

import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { BRANCH, branchAlias, cleanupTemps, counts, idMod, tempDir } from "./_m_d1b4b7_ste720_fixture";
import { createAliasMap } from "../adapters/_shared/src/session_aliases";
import { scrubPayloadDir } from "../adapters/_shared/src/report_issue_payload";

afterAll(() => cleanupTemps());

const HOME = "/home/fixture-user";

async function scrub(text: string, branches: string[], home?: string) {
  const { scrubIdentifiers } = await idMod();
  return scrubIdentifiers(text, { home, branches, aliases: createAliasMap() });
}

describe("AC-STE-720.4 branch_name inside a Claude project-folder slug (B1)", () => {
  const SLASHED = "feat-fixture-branch"; // cwdToSlug(BRANCH)
  const ROWS: [string, string, string[], (a: (n: string) => string) => string][] = [
    ["home-rewritten slug, branch at the end then /", `~/.claude/projects/-~-wt-hotfix-fixture/memory/MEMORY.md`, ["hotfix-fixture"], (a) => `~/.claude/projects/-~-wt-${a("hotfix-fixture")}/memory/MEMORY.md`],
    ["slug at the end of the text", `.claude/projects/-~-wt-hotfix-fixture`, ["hotfix-fixture"], (a) => `.claude/projects/-~-wt-${a("hotfix-fixture")}`],
    ["branch between two - boundaries", `.claude/projects/-~-hotfix-fixture-repo/x.jsonl`, ["hotfix-fixture"], (a) => `.claude/projects/-~-${a("hotfix-fixture")}-repo/x.jsonl`],
    ["a slashed branch transliterated", `.claude/projects/-~-wt-${SLASHED}/x.jsonl`, [BRANCH], (a) => `.claude/projects/-~-wt-${a(BRANCH)}/x.jsonl`],
    ["a slug outside the home", `.claude/projects/-tmp-wt-${SLASHED}/x.jsonl`, [BRANCH], (a) => `.claude/projects/-tmp-wt-${a(BRANCH)}/x.jsonl`],
  ];
  for (const [label, text, branches, want] of ROWS) {
    test(`${label}: ${JSON.stringify(text)} becomes ${JSON.stringify(want(branchAlias))}, counted once`, async () => {
      const r = await scrub(text, branches);
      expect(r.scrubbed).toBe(want(branchAlias));
      expect(counts(r.matches).branch_name).toBe(1);
    });
  }

  test("an unrewritten home slug loses the home under home_path and the branch under branch_name, with the same alias as the cwd", async () => {
    const text = `{"cwd":"${HOME}/wt/hotfix-fixture","content":"${HOME}/.claude/projects/-home-fixture-user-wt-hotfix-fixture/memory/MEMORY.md"}`;
    const r = await scrub(text, ["hotfix-fixture"], HOME);
    const h = branchAlias("hotfix-fixture");
    expect(r.scrubbed).toBe(`{"cwd":"~/wt/${h}","content":"~/.claude/projects/-~-wt-${h}/memory/MEMORY.md"}`);
    expect(counts(r.matches).branch_name).toBe(2);
  });

  const CONTROLS: [string, string, string[]][] = [
    ["a slug segment that merely contains the name", `.claude/projects/-~-wt-hotfix-fixture2/x.jsonl`, ["hotfix-fixture"]],
    ["a slug segment with the name glued to a word", `.claude/projects/-~-wtxhotfix-fixture/x.jsonl`, ["hotfix-fixture"]],
    ["non-slug text with -<name>", `see pre-hotfix-fixture and wt-hotfix-fixture/a.ts`, ["hotfix-fixture"]],
    ["a transliterated name outside a slug", `/tmp/wt/${SLASHED}/a.ts and x-${SLASHED}`, [BRANCH]],
    ["a default branch in a slug", `.claude/projects/-~-wt-main/x.jsonl`, ["main"]],
  ];
  for (const [label, text, branches] of CONTROLS) {
    test(`control, ${label}: ${JSON.stringify(text)} is left alone`, async () => {
      const r = await scrub(text, branches);
      expect(r.scrubbed).toBe(text);
      expect(counts(r.matches).branch_name).toBe(0);
    });
  }

  test("the slug pass is idempotent: a second pass with the alias read back as a branch changes nothing", async () => {
    const text = ROWS.map(([, t]) => t).join("\n");
    const branches = ["hotfix-fixture", BRANCH];
    const once = await scrub(text, branches);
    const twice = await scrub(once.scrubbed, [...branches.map(branchAlias)]);
    expect(twice.scrubbed).toBe(once.scrubbed);
    expect(counts(twice.matches).branch_name).toBe(0);
  });

  test("end to end through scrubPayloadDir: the review's repro leaves no branch in the slug, and the slug and the cwd share one alias", () => {
    const dir = tempDir("b1-e2e");
    const line = JSON.stringify({
      cwd: `${HOME}/wt/hotfix-fixture`,
      gitBranch: "hotfix-fixture",
      content: `memory at ${HOME}/.claude/projects/-home-fixture-user-wt-hotfix-fixture/memory/MEMORY.md and ${HOME}/.claude/projects/-home-fixture-user-wt-${SLASHED}/x.jsonl`,
    });
    const other = JSON.stringify({ gitBranch: BRANCH });
    writeFileSync(join(dir, "session.jsonl"), `${line}\n${other}\n`);
    scrubPayloadDir(dir, { home: HOME, branches: [], aliases: createAliasMap() });
    const out = readFileSync(join(dir, "session.jsonl"), "utf-8");
    const h = branchAlias("hotfix-fixture");
    expect(out).not.toContain("hotfix-fixture");
    expect(out).not.toContain(SLASHED);
    expect(out).not.toContain("fixture-user");
    expect(out).toContain(`"cwd":"~/wt/${h}"`);
    expect(out).toContain(`"gitBranch":"${h}"`);
    expect(out).toContain(`~/.claude/projects/-~-wt-${h}/memory/MEMORY.md`);
    expect(out).toContain(`~/.claude/projects/-~-wt-${branchAlias(BRANCH)}/x.jsonl`);
    // Idempotent over the written file.
    scrubPayloadDir(dir, { home: HOME, branches: [], aliases: createAliasMap() });
    expect(readFileSync(join(dir, "session.jsonl"), "utf-8")).toBe(out);
  });
});

describe("AC-STE-720.4 branch_name in URL-encoded and JSON-escaped form (F1)", () => {
  const ROWS: [string, string, (h: string) => string][] = [
    ["URL-encoded %2F", `https://github.com/o/r/tree/feat%2Ffixture-branch`, (h) => `https://github.com/o/r/tree/${h}`],
    ["URL-encoded lowercase %2f", `https://github.com/o/r/tree/feat%2ffixture-branch`, (h) => `https://github.com/o/r/tree/${h}`],
    ["URL-encoded after an encoded prefix", `ref=refs%2Fheads%2Ffeat%2Ffixture-branch&x=1`, (h) => `ref=refs%2Fheads%2F${h}&x=1`],
    ["JSON-escaped \\/", `{"ref":"refs\\/heads\\/feat\\/fixture-branch"}`, (h) => `{"ref":"refs\\/heads\\/${h}"}`],
    ["JSON-escaped with a trailing \\/", `"wt\\/feat\\/fixture-branch\\/src"`, (h) => `"wt\\/${h}\\/src"`],
  ];
  for (const [label, text, want] of ROWS) {
    test(`${label}: ${JSON.stringify(text)} becomes ${JSON.stringify(want(branchAlias(BRANCH)))} with the plain name's alias, counted once`, async () => {
      const r = await scrub(text, [BRANCH]);
      expect(r.scrubbed).toBe(want(branchAlias(BRANCH)));
      expect(counts(r.matches).branch_name).toBe(1);
    });
  }

  const CONTROLS: string[] = [`feat%2Ffixture-branch2`, `xfeat%2Ffixture-branch`, `feat\\/fixture-branch_old`, `feat%2Ffixture-branch-old`];
  for (const text of CONTROLS) {
    test(`control: ${JSON.stringify(text)} is left alone`, async () => {
      const r = await scrub(text, [BRANCH]);
      expect(r.scrubbed).toBe(text);
      expect(counts(r.matches).branch_name).toBe(0);
    });
  }

  test("every encoded form is idempotent", async () => {
    const text = ROWS.map(([, t]) => t).join("\n");
    const once = await scrub(text, [BRANCH]);
    const twice = await scrub(once.scrubbed, [BRANCH, branchAlias(BRANCH)]);
    expect(twice.scrubbed).toBe(once.scrubbed);
    expect(counts(twice.matches).branch_name).toBe(0);
  });
});
