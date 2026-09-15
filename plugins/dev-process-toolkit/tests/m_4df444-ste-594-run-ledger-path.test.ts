// M_4df444 / STE-594 AC.2 — the run ledger's path.
//
//   * composed only in `adapters/_shared/src/dpt_paths.ts`, as
//     `smokeRunLedgerPath(projectRoot, runId)`;
//   * under `.dpt/ledger/`, the durable machine-local subtree the CLOSED
//     `.dpt/.gitignore` rule set already ignores (no fourth rule — STE-383);
//   * inside the project root, so it survives a `/tmp` wipe;
//   * no other module and no skill fence composes a `.dpt/ledger` path of its
//     own (the ledger writer imports the composer).
// The `.dpt` path-drift gates (tests/dpt-path-drift.test.ts,
// tests/m104-ste-384-dpt-path-drift.test.ts) and the closed-rule-set pin
// (tests/m104-ste-383-dpt-gitignore.test.ts) are the other half of AC.2 and
// stay green unchanged.

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";

import * as dptPaths from "../adapters/_shared/src/dpt_paths";
import { DPT_GITIGNORE_BODY } from "../adapters/_shared/src/setup/dpt_gitignore";
import { allFences, classify, label } from "./_spawn_fences";

const pluginRoot = join(import.meta.dir, "..");
const repoRoot = join(pluginRoot, "..", "..");
const LEDGER_MODULE = join(pluginRoot, "adapters", "_shared", "src", "smoke_run_ledger.ts");

type Compose = (projectRoot: string, runId: string) => string;
const compose = (dptPaths as unknown as Record<string, unknown>).smokeRunLedgerPath as Compose | undefined;

function requireCompose(): Compose {
  expect(typeof compose, "dpt_paths.ts exports smokeRunLedgerPath(projectRoot, runId)").toBe("function");
  return compose!;
}

const RUN_A = "0b7e3c1a-5d2f-4a8e-9c61-2f4d8e7a9b10";
const RUN_B = "7d1f0e22-93ab-4c5e-8f10-1a2b3c4d5e6f";

describe("AC-STE-594.2 — dpt_paths.ts composes the run ledger's path", () => {
  test("dpt_paths.ts exports smokeRunLedgerPath", () => {
    requireCompose();
  });

  test("the path sits under <root>/.dpt/ledger/, names its run, and is a .jsonl file", () => {
    const p = requireCompose()("/work/proj", RUN_A);
    expect(p.startsWith(join(dptPaths.dptRoot("/work/proj"), "ledger") + sep), p).toBe(true);
    expect(p).toContain(RUN_A);
    expect(p.endsWith(".jsonl")).toBe(true);
  });

  test("each run gets its own ledger, and none of them is the token ledger", () => {
    const c = requireCompose();
    expect(c("/work/proj", RUN_A)).not.toBe(c("/work/proj", RUN_B));
    expect(c("/work/proj", RUN_A)).not.toBe(dptPaths.ledgerPath("/work/proj"));
  });

  test("pure composition: composing a path creates nothing on disk", () => {
    const root = join(tmpdir(), `ste594-never-created-${process.pid}-${Date.now()}`);
    requireCompose()(root, RUN_A);
    expect(existsSync(root)).toBe(false);
  });
});

describe("AC-STE-594.2 — the ledger is git-ignored by the CLOSED .dpt/.gitignore, with no new rule", () => {
  test("CONTROL: the canonical rule set is still exactly ledger/, scratch/, skip-baseline.json", () => {
    const rules = DPT_GITIGNORE_BODY.split("\n").map((l) => l.trim()).filter((l) => l !== "" && !l.startsWith("#"));
    expect(rules).toEqual(["ledger/", "scratch/", "skip-baseline.json"]);
  });

  test("`git check-ignore` ignores the run ledger under the canonical body, and does not ignore a .dpt/ sibling outside ledger/", () => {
    const c = requireCompose();
    const dir = mkdtempSync(join(tmpdir(), "ste594-gitignore-"));
    try {
      const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", HOME: dir };
      expect(spawnSync("git", ["init", "-q"], { cwd: dir, env }).status).toBe(0);
      mkdirSync(join(dir, ".dpt"), { recursive: true });
      writeFileSync(join(dir, ".dpt", ".gitignore"), DPT_GITIGNORE_BODY);

      const ledger = c(dir, RUN_A);
      mkdirSync(dirname(ledger), { recursive: true });
      writeFileSync(ledger, "{}\n");
      const rel = relative(dir, ledger);
      expect(spawnSync("git", ["check-ignore", "-q", "--", rel], { cwd: dir, env }).status, rel).toBe(0);

      const control = join(dir, ".dpt", "ste594-control.jsonl");
      writeFileSync(control, "{}\n");
      expect(spawnSync("git", ["check-ignore", "-q", "--", relative(dir, control)], { cwd: dir, env }).status).toBe(1);

      const status = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: dir, env, encoding: "utf8" });
      expect(status.stdout).not.toContain(rel);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("AC-STE-594.2 — the ledger survives a /tmp wipe", () => {
  test("for a project root outside the temp tree, the ledger path is inside the project root and outside every temp root", () => {
    const p = requireCompose()(repoRoot, RUN_A);
    expect(relative(repoRoot, p).startsWith(".."), p).toBe(false);
    const tmps = new Set(["/tmp", "/private/tmp", tmpdir()]);
    try {
      tmps.add(realpathSync(tmpdir()));
    } catch {
      // no realpath: the literal forms still apply
    }
    for (const t of tmps) expect(p.startsWith(t + sep), `${p} is under ${t}`).toBe(false);
  });
});

describe("AC-STE-594.2 — the path is composed ONLY in dpt_paths.ts", () => {
  test("the ledger writer carries no `.dpt` literal of its own and imports ./dpt_paths", () => {
    expect(existsSync(LEDGER_MODULE), "adapters/_shared/src/smoke_run_ledger.ts exists").toBe(true);
    const src = readFileSync(LEDGER_MODULE, "utf-8");
    expect(src).not.toMatch(/["'`][^"'`\n]*\.dpt\b/);
    expect(src).toMatch(/from\s+["']\.\/dpt_paths["']/);
  });

  test("no fence in either skill composes a .dpt/ledger path in shell", () => {
    const hits: string[] = [];
    for (const f of allFences()) {
      const kinds = classify(f.lines);
      f.lines.forEach((l, i) => {
        if (kinds[i] === "code" && /\.dpt\/ledger/.test(l)) hits.push(`${label(f)} body L${i + 1}: ${l.trim()}`);
      });
    }
    expect(hits).toEqual([]);
  });
});
