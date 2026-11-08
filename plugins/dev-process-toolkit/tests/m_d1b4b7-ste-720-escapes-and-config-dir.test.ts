// STE-720 (M_d1b4b7) pre-merge fix 4 — AC-STE-720.4 for two common branch forms
// the delta review reproduced through `report_issue_payload.ts --redact-identifiers`:
//   B1  a branch at the start of a line inside a JSON string, where the newline
//       is the two characters `\n` (likewise `\t`, `\r`), or right after an ANSI
//       SGR sequence (raw ESC or the JSON `\u001b` form);
//   B2  a branch inside a project-folder slug under ANY config dir (CLAUDE_CONFIG_DIR
//       is honoured), and a bare slug on its own line as `ls <config>/projects` prints it.
// Branch redaction stays best-effort (operator ruling 2026-11-07); these are the
// common forms. All ids are synthetic (AC-STE-720.10).

import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { BRANCH, FRONT_DOOR, branchAlias, cleanupTemps, counts, idMod, makeRepo, tempDir } from "./_m_d1b4b7_ste720_fixture";
import { createAliasMap } from "../adapters/_shared/src/session_aliases";

afterAll(() => cleanupTemps());

const HOME = "/home/fixture-user";
const SLASHED = "feat-fixture-branch"; // cwdToSlug(BRANCH)
const B2N = "hotfix-fixture";

async function scrub(text: string, branches: string[], opts: { home?: string; configDir?: string } = {}) {
  const { scrubIdentifiers } = await idMod();
  return scrubIdentifiers(text, { home: opts.home, configDir: opts.configDir, branches, aliases: createAliasMap() });
}

describe("AC-STE-720.4 branch_name after a JSON escape or an ANSI SGR sequence (B1)", () => {
  const ROWS: [string, string, (h: string) => string][] = [
    ["after a JSON \\n", `{"stdout":"main\\n${BRANCH}\\n"}`, (h) => `{"stdout":"main\\n${h}\\n"}`],
    ["after a JSON \\t", `"abc123\\t${BRANCH}"`, (h) => `"abc123\\t${h}"`],
    ["after a JSON \\r", `"x\\r${BRANCH}\\r\\n"`, (h) => `"x\\r${h}\\r\\n"`],
    ["after a raw ANSI SGR", `\x1b[32m${BRANCH}\x1b[0m`, (h) => `\x1b[32m${h}\x1b[0m`],
    ["after a JSON-escaped ANSI SGR", `"\\u001b[1;32m${BRANCH}\\u001b[0m"`, (h) => `"\\u001b[1;32m${h}\\u001b[0m"`],
    ["after a bare-reset ANSI SGR", `\x1b[m${BRANCH}`, (h) => `\x1b[m${h}`],
  ];
  for (const [label, text, want] of ROWS) {
    test(`${label}: ${JSON.stringify(text)} becomes ${JSON.stringify(want(branchAlias(BRANCH)))}, counted once`, async () => {
      const r = await scrub(text, [BRANCH]);
      expect(r.scrubbed).toBe(want(branchAlias(BRANCH)));
      expect(counts(r.matches).branch_name).toBe(1);
    });
  }

  const CONTROLS: string[] = [`xn${BRANCH}`, `xt${BRANCH}`, `r${BRANCH}`, `[32m${BRANCH}`, `\\n${BRANCH}2`, `\x1b[32mx${BRANCH}`];
  for (const text of CONTROLS) {
    test(`control: ${JSON.stringify(text)} is left alone`, async () => {
      const r = await scrub(text, [BRANCH]);
      expect(r.scrubbed).toBe(text);
      expect(counts(r.matches).branch_name).toBe(0);
    });
  }

  test("the escape and ANSI forms are idempotent", async () => {
    const text = ROWS.map(([, t]) => t).join("\n");
    const once = await scrub(text, [BRANCH]);
    const twice = await scrub(once.scrubbed, [BRANCH, branchAlias(BRANCH)]);
    expect(twice.scrubbed).toBe(once.scrubbed);
    expect(counts(twice.matches).branch_name).toBe(0);
  });
});

describe("AC-STE-720.4 branch_name in a slug under any config dir, and a bare slug line (B2)", () => {
  const ROWS: [string, string, string[], { home?: string; configDir?: string }, (a: (n: string) => string) => string][] = [
    ["a .claude-st config dir", `/tmp/h/.claude-st/projects/-tmp-wt-${SLASHED}/a.jsonl`, [BRANCH], {}, (a) => `/tmp/h/.claude-st/projects/-tmp-wt-${a(BRANCH)}/a.jsonl`],
    ["a .config/claude config dir", `~/.config/claude/projects/-~-wt-${B2N}/a.jsonl`, [B2N], {}, (a) => `~/.config/claude/projects/-~-wt-${a(B2N)}/a.jsonl`],
    ["a JSON-escaped .config/claude", `"~\\/.config\\/claude\\/projects\\/-~-wt-${B2N}\\/a.jsonl"`, [B2N], {}, (a) => `"~\\/.config\\/claude\\/projects\\/-~-wt-${a(B2N)}\\/a.jsonl"`],
    ["the resolved config root", `/srv/cfgroot/projects/-tmp-wt-${B2N}/a.jsonl`, [B2N], { configDir: "/srv/cfgroot" }, (a) => `/srv/cfgroot/projects/-tmp-wt-${a(B2N)}/a.jsonl`],
    ["a config root under the home", `${HOME}/cfg/projects/-tmp-${B2N}-repo/a.jsonl`, [B2N], { home: HOME, configDir: `${HOME}/cfg` }, (a) => `~/cfg/projects/-tmp-${a(B2N)}-repo/a.jsonl`],
    ["a bare slug on its own line", `x\n-tmp-wt-${SLASHED}\n-tmp-other\n`, [BRANCH], {}, (a) => `x\n-tmp-wt-${a(BRANCH)}\n-tmp-other\n`],
    ["a bare slug line inside a JSON string", `{"stdout":"-tmp-a\\n-tmp-wt-${B2N}\\n"}`, [B2N], {}, (a) => `{"stdout":"-tmp-a\\n-tmp-wt-${a(B2N)}\\n"}`],
  ];
  for (const [label, text, branches, opts, want] of ROWS) {
    test(`${label}: ${JSON.stringify(text)} becomes ${JSON.stringify(want(branchAlias))}, counted once`, async () => {
      const r = await scrub(text, branches, opts);
      expect(r.scrubbed).toBe(want(branchAlias));
      expect(counts(r.matches).branch_name).toBe(1);
    });
  }

  const CONTROLS: [string, string][] = [
    ["a longer name in a .claude-st slug", `/tmp/h/.claude-st/projects/-tmp-wt-${B2N}2/a.jsonl`],
    ["a longer name on a bare slug line", `-tmp-wt-${B2N}2\n`],
    ["a non-config projects/ parent", `/srv/projects/-tmp-wt-${B2N}/a.ts`],
    ["a line not led by -", `pre-${B2N}\n`],
    ["a bare slug line with the name glued to a word", `-tmp-wtx${B2N}\n`],
  ];
  for (const [label, text] of CONTROLS) {
    test(`control, ${label}: ${JSON.stringify(text)} is left alone`, async () => {
      const r = await scrub(text, [B2N]);
      expect(r.scrubbed).toBe(text);
      expect(counts(r.matches).branch_name).toBe(0);
    });
  }

  test("the config-dir and bare-line forms are idempotent", async () => {
    const text = ROWS.filter(([, , , o]) => !o.configDir).map(([, t]) => t).join("\n");
    const branches = [B2N, BRANCH];
    const once = await scrub(text, branches);
    const twice = await scrub(once.scrubbed, branches.map(branchAlias));
    expect(twice.scrubbed).toBe(once.scrubbed);
    expect(counts(twice.matches).branch_name).toBe(0);
  });
});

describe("AC-STE-720.4 the delta review's repros through report_issue_payload.ts --redact-identifiers", () => {
  test("B1 + B2 end to end: no copy of the branch survives, and CLAUDE_CONFIG_DIR is the config root", () => {
    const repo = makeRepo("fix4-repo", { branches: [BRANCH] });
    const dir = tempDir("fix4-e2e");
    const cfg = join(tempDir("fix4-cfg"), "cfgroot");
    const lines = [
      JSON.stringify({ gitBranch: BRANCH, toolUseResult: { stdout: `main\n${BRANCH}\n` } }),
      JSON.stringify({ toolUseResult: { stdout: `abc123\t${BRANCH}\n\x1b[32m${BRANCH}\x1b[0m` } }),
      JSON.stringify({ content: `${cfg}/projects/-tmp-wt-${SLASHED}/a.jsonl and /tmp/h/.claude-st/projects/-tmp-wt-${SLASHED}/b.jsonl` }),
      JSON.stringify({ toolUseResult: { stdout: `-tmp-other\n-tmp-wt-${SLASHED}\n` } }),
    ];
    writeFileSync(join(dir, "transcript.jsonl"), `${lines.join("\n")}\n`);
    const p = spawnSync("bun", ["run", FRONT_DOOR, dir, repo, "--redact-identifiers"], {
      encoding: "utf-8",
      env: { ...process.env, CLAUDE_CONFIG_DIR: cfg },
    });
    expect(p.status).toBe(0);
    const out = readFileSync(join(dir, "transcript.jsonl"), "utf-8");
    expect(out).not.toContain(BRANCH);
    expect(out).not.toContain("feat\\/fixture-branch");
    expect(out).not.toContain(SLASHED);
    const h = branchAlias(BRANCH);
    expect(out).toContain(`main\\n${h}\\n`);
    expect(out).toContain(`abc123\\t${h}`);
    expect(out).toContain(`\\u001b[32m${h}`);
    expect(out).toContain(`/projects/-tmp-wt-${h}/a.jsonl`);
    expect(out).toContain(`.claude-st/projects/-tmp-wt-${h}/b.jsonl`);
    expect(out).toContain(`-tmp-other\\n-tmp-wt-${h}\\n`);
  });
});
