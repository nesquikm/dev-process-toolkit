// STE-728 (M_d1b4b7) — the gate prose and the surfaces that must not move.
//
//   AC-STE-728.9   skills/retro/SKILL.md names the propose call after the rule
//                  table, its own AskUserQuestion (leave-unchanged the
//                  default), the every-line question text, the auto-approve
//                  rail, the driven/non-interactive not-applied line, and the
//                  refused-apply sentence.
//   AC-STE-728.11  retro.ts never imports retro_proposal; the STE-719
//                  report-schema tests are unchanged and pass.
//   AC-STE-728.12  SKILL.md stays within the NFR-1 cap, and the cap is not raised.

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { runNestedBunTest } from "./_nested_bun_test";
import { PLUGIN_ROOT, SRC } from "./_m_d1b4b7_ste728_fixture";

const SKILL = join(PLUGIN_ROOT, "skills", "retro", "SKILL.md");
const REPO = join(PLUGIN_ROOT, "..", "..");
const NOT_APPLIED = "settings proposal not applied — run /dev-process-toolkit:retro to review it";
const REFUSED_NEEDLE = "A refused apply consumes the approval: fix the cause, then re-run propose and ask again.";

const skill = () => readFileSync(SKILL, "utf-8");
const paragraphs = () => skill().split(/\n\s*\n/);
const paragraphWith = (...needles: (string | RegExp)[]) =>
  paragraphs().find((p) => needles.every((n) => (typeof n === "string" ? p.includes(n) : n.test(p))));

function mergeBase(): string {
  const mb = spawnSync("git", ["merge-base", "HEAD", "main"], { cwd: REPO, encoding: "utf-8" }).stdout.trim();
  if (!/^[0-9a-f]{40}$/.test(mb)) throw new Error("no merge-base with main");
  return mb;
}

function atMergeBase(rel: string): string {
  return spawnSync("git", ["show", `${mergeBase()}:${rel}`], { cwd: REPO, encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 }).stdout;
}

// ------------------------------------------------------------------ AC.9

describe("AC-STE-728.9 the retro skill's proposal gate", () => {
  test("names the propose call after the rule table", () => {
    const s = skill();
    const table = s.indexOf("| rule | disposition |");
    const call = s.indexOf("retro_proposal.ts propose");
    expect(table).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(table);
  });

  test("asks its own AskUserQuestion with the two options, Leave settings unchanged the default", () => {
    const s = skill();
    expect(s).toContain("AskUserQuestion");
    expect(s).toContain("`Apply the shown change`");
    expect(s).toContain("`Leave settings unchanged`");
    expect(paragraphWith("Leave settings unchanged", /\bdefault\b/)).toBeDefined();
  });

  test("states the question text carries every printed line: each set, because and add .gitignore: line, then the digest= line", () => {
    const p = paragraphWith(/question/i, "`set", "`because", "`add .gitignore:", "`digest=");
    expect(p).toBeDefined();
    expect(p!).toMatch(/every line/i);
  });

  test("states the auto-approve marker never applies the change, naming the requires_explicit_approval rail", () => {
    expect(paragraphWith(/auto-approve marker/i, /\bnever\b/)).toBeDefined();
    expect(skill()).toContain("requires_explicit_approval");
  });

  test("a driven or non-interactive run prints the not-applied line and never calls apply", () => {
    const p = paragraphWith(NOT_APPLIED);
    expect(p).toBeDefined();
    expect(p!).toMatch(/driven/i);
    expect(p!).toMatch(/non-interactive|without an interactive operator/i);
    expect(p!).toMatch(/never calls `?apply`?/);
  });

  test("only an explicit approval calls apply", () => {
    expect(skill()).toContain("retro_proposal.ts apply");
    expect(paragraphWith("retro_proposal.ts apply", /explicit/i) ?? paragraphWith(/Only an explicit approval calls `?apply`?/)).toBeDefined();
  });

  test("holds the refused-apply needle verbatim", () => {
    expect(skill()).toContain(REFUSED_NEEDLE);
  });
});

// ----------------------------------------------------------------- AC.11

describe("AC-STE-728.11 retro.ts and the report schema are untouched", () => {
  test("retro.ts does not import retro_proposal", () => {
    const src = readFileSync(join(SRC, "retro.ts"), "utf-8");
    expect(src).not.toMatch(/retro_proposal/);
  });

  test("control: retro_proposal.ts exists beside it (the import scan reads a real neighbour)", () => {
    expect(readFileSync(join(SRC, "retro_proposal.ts"), "utf-8").length).toBeGreaterThan(0);
  });

  test("the STE-719 report-schema test file and retro_report.ts: no uncommitted change, and no commit naming STE-728 touches them", () => {
    for (const rel of [
      "plugins/dev-process-toolkit/tests/m_d1b4b7-ste-719-retro-report.test.ts",
      "plugins/dev-process-toolkit/adapters/_shared/src/retro_report.ts",
    ]) {
      const diff = spawnSync("git", ["diff", "HEAD", "--", rel], { cwd: REPO, encoding: "utf-8" });
      expect(diff.status).toBe(0);
      expect(diff.stdout).toBe("");
      const log = spawnSync("git", ["log", "--format=%B", `${mergeBase()}..HEAD`, "--", rel], { cwd: REPO, encoding: "utf-8" });
      expect(log.status).toBe(0);
      expect(log.stdout).not.toContain("STE-728");
    }
  });

  test("the STE-719 report-schema tests pass", () => {
    const r = runNestedBunTest(["tests/m_d1b4b7-ste-719-retro-report.test.ts"], { cwd: PLUGIN_ROOT, timeoutMs: 120_000 });
    expect(r.timedOut).toBe(false);
    expect(r.exitCode).toBe(0);
    expect(`${r.stdout}\n${r.stderr}`).toMatch(/\b0 fail\b/);
  });
});

// ----------------------------------------------------------------- AC.12

describe("AC-STE-728.12 the NFR-1 cap", () => {
  const capOf = (text: string): number => {
    const m = /const SKILL_LINE_CAP = (\d+);/.exec(text);
    if (m === null) throw new Error("no SKILL_LINE_CAP");
    return Number(m[1]);
  };

  test("SKILL_LINE_CAP is not raised over the merge-base with main", () => {
    const rel = "plugins/dev-process-toolkit/tests/skill-nfr-1-length.test.ts";
    expect(capOf(readFileSync(join(REPO, rel), "utf-8"))).toBeLessThanOrEqual(capOf(atMergeBase(rel)));
  });

  test("skills/retro/SKILL.md, with the proposal gate, stays within the cap", () => {
    const cap = capOf(readFileSync(join(PLUGIN_ROOT, "tests", "skill-nfr-1-length.test.ts"), "utf-8"));
    const s = skill();
    expect(s).toContain("retro_proposal.ts propose");
    expect(s.split("\n").length).toBeLessThanOrEqual(cap);
  });
});
