// M_4df444 / STE-594 — /implement Phase 3 (Stage A cross-module coverage): the two
// CLI verbs the Termination cleanup fence calls, tested directly.
//
// Until now `smoke_verdict.ts outcome` and `smoke_run_ledger.ts sessions` were
// exercised only through the stubbed fence runs. They are the fence's whole view
// of the world — the leg's recorded sessions and whether its verdict artifact
// reads `pass` — so each gets its own test here, run through its real front door.

import { afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { smokeRunLedgerPath } from "./dpt_paths";
import { appendRunLedgerRow } from "./smoke_run_ledger";

const VERDICT_CLI = join(import.meta.dir, "smoke_verdict.ts");
const LEDGER_CLI = join(import.meta.dir, "smoke_run_ledger.ts");

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function tempRoot(): string {
  const r = mkdtempSync(join(tmpdir(), "ste594-cli-"));
  roots.push(r);
  return r;
}

function run(cli: string, args: string[]): { code: number; out: string; err: string } {
  const r = Bun.spawnSync([process.execPath, cli, ...args]);
  return { code: r.exitCode ?? -1, out: r.stdout.toString(), err: r.stderr.toString() };
}

describe("AC-STE-594.4 — Phase 3 coverage: `smoke_verdict.ts outcome` reads the ARTIFACT, never an rc", () => {
  const cases: Array<[string, (p: string) => void, string]> = [
    ["pass", (p) => writeFileSync(p, `${JSON.stringify({ outcome: "pass" })}\n`), "pass"],
    ["fail", (p) => writeFileSync(p, `${JSON.stringify({ outcome: "fail", trigger: "cli test" })}\n`), "fail"],
    ["abort", (p) => writeFileSync(p, `${JSON.stringify({ outcome: "abort", trigger: "cli test" })}\n`), "abort"],
    ["missing", () => {}, "missing"],
    ["malformed", (p) => writeFileSync(p, "{ this is not a verdict\n"), "malformed"],
    ["unreadable", (p) => mkdirSync(p), "unreadable"],
  ];
  for (const [name, plant, want] of cases) {
    test(`${name} artifact → prints \`${want}\`, exit 0`, () => {
      const p = join(tempRoot(), "verdict.json");
      plant(p);
      const r = run(VERDICT_CLI, ["outcome", "--artifact", p]);
      expect(r.out.trim(), r.err).toBe(want);
      expect(r.code).toBe(0);
    });
  }

  test("a `pass` artifact older than the run start reads `stale`, never `pass`", () => {
    const p = join(tempRoot(), "verdict.json");
    writeFileSync(p, `${JSON.stringify({ outcome: "pass" })}\n`);
    const hourAgo = Date.now() / 1000 - 3600;
    utimesSync(p, hourAgo, hourAgo);
    const r = run(VERDICT_CLI, ["outcome", "--artifact", p, "--run-start", String(Date.now() - 60_000)]);
    expect(r.out.trim(), r.err).toBe("stale");
  });

  test("a fresh `pass` artifact with a run start before it still reads `pass` (polarity for the stale case)", () => {
    const p = join(tempRoot(), "verdict.json");
    writeFileSync(p, `${JSON.stringify({ outcome: "pass" })}\n`);
    const r = run(VERDICT_CLI, ["outcome", "--artifact", p, "--run-start", String(Date.now() - 3_600_000)]);
    expect(r.out.trim(), r.err).toBe("pass");
  });

  test("no --artifact → usage on stderr, exit 2, nothing on stdout", () => {
    const r = run(VERDICT_CLI, ["outcome"]);
    expect(r.code).toBe(2);
    expect(r.out.trim()).toBe("");
    expect(r.err).toContain("outcome --artifact");
  });
});

describe("AC-STE-594.4 — Phase 3 coverage: `smoke_run_ledger.ts sessions` prints exactly one leg's recorded ids", () => {
  function plantLedger(root: string): { run: string; linear: string[]; jira: string[] } {
    const run = randomUUID();
    const other = randomUUID();
    const linear = [randomUUID(), randomUUID()];
    const jira = [randomUUID()];
    const file = smokeRunLedgerPath(root, run);
    for (const sid of linear) appendRunLedgerRow(file, { run, leg: "linear", session_id: sid });
    for (const sid of jira) appendRunLedgerRow(file, { run, leg: "jira", session_id: sid });
    // A different run's row for the same leg, in its own ledger: never in this run's answer.
    appendRunLedgerRow(smokeRunLedgerPath(root, other), { run: other, leg: "linear", session_id: randomUUID() });
    return { run, linear, jira };
  }

  test("one id per line, only the named run and leg", () => {
    const root = tempRoot();
    const l = plantLedger(root);
    const r = run(LEDGER_CLI, ["sessions", "--run", l.run, "--leg", "linear", "--project-root", root]);
    expect(r.code, r.err).toBe(0);
    expect(r.out.trim().split("\n").sort()).toEqual([...l.linear].sort());
  });

  test("another leg of the same run gets only its own ids", () => {
    const root = tempRoot();
    const l = plantLedger(root);
    const r = run(LEDGER_CLI, ["sessions", "--run", l.run, "--leg", "jira", "--project-root", root]);
    expect(r.out.trim().split("\n")).toEqual(l.jira);
  });

  test("a run with no ledger file prints nothing and exits 0", () => {
    const r = run(LEDGER_CLI, ["sessions", "--run", randomUUID(), "--leg", "linear", "--project-root", tempRoot()]);
    expect(r.code).toBe(0);
    expect(r.out.trim()).toBe("");
  });

  test("a --run that is not a plain token is refused before any read: a `../` path never escapes .dpt/ledger/", () => {
    // /implement Phase 3 Stage B Pass 2: `append` validated the run before any I/O, `sessions` did not, so a
    // traversal-shaped --run read a .jsonl outside the ledger directory. Plant one there with a known id.
    const root = tempRoot();
    const escaped = join(root, "outside.jsonl");
    const leaked = randomUUID();
    writeFileSync(escaped, `${JSON.stringify({ run: "x", leg: "linear", session_id: leaked })}\n`);
    for (const bad of ["../../outside", "../x", "a/b", ""]) {
      const r = run(LEDGER_CLI, ["sessions", "--run", bad, "--leg", "linear", "--project-root", root]);
      expect({ bad, code: r.code === 0 }).toEqual({ bad, code: false });
      expect(r.out).not.toContain(leaked);
      expect(r.out.trim()).toBe("");
    }
  });

  test("a --leg that is not a plain token is refused too", () => {
    const r = run(LEDGER_CLI, ["sessions", "--run", randomUUID(), "--leg", "../linear", "--project-root", tempRoot()]);
    expect(r.code).not.toBe(0);
    expect(r.out.trim()).toBe("");
  });

  test("a missing --leg → usage on stderr, exit 2", () => {
    const r = run(LEDGER_CLI, ["sessions", "--run", randomUUID(), "--project-root", tempRoot()]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("sessions --run");
  });
});
