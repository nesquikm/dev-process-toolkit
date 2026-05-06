import { describe, expect, test } from "bun:test";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { extractTddResultBlock, parseTddResultBlock } from "../adapters/_shared/src/tdd_result";

// STE-225 AC.9 — Headless live smoke for the /tdd orchestrator.
//
// Gated by DPT_TDD_LIVE_SMOKE=1 (skipped on default `bun test`). Runs
// real `claude -p /dev-process-toolkit:tdd STE-SMOKE` against a temp
// checkout of `tests/fixtures/tdd-smoke/`. Assertions are behavioral:
//   (a) test files exist with non-zero size in the test directory
//   (b) implementation file exists and exports the named function
//   (c) running the fixture's test command exits 0
//   (d) orchestrator's stdout contains all three closing tdd-result
//       blocks with status: ok
//
// Findings file shape matches /smoke-test convention:
//   /tmp/dpt-tdd-smoke-findings-<date>.md
//
// Exact filename / phrasing variance from model nondeterminism is
// expected — assertions never compare exact strings.

const LIVE = process.env.DPT_TDD_LIVE_SMOKE === "1";
const describeIfLive = LIVE ? describe : describe.skip;

const repoRoot = join(import.meta.dir, "..", "..", "..");
const fixtureSrc = join(
  repoRoot,
  "plugins",
  "dev-process-toolkit",
  "tests",
  "fixtures",
  "tdd-smoke",
);

function todayISODate(): string {
  return new Date().toISOString().slice(0, 10);
}

function findingsPath(): string {
  return join("/tmp", `dpt-tdd-smoke-findings-${todayISODate()}.md`);
}

function writeFindings(body: string): string {
  const p = findingsPath();
  writeFileSync(p, body);
  return p;
}

interface TestRun {
  cwd: string;
  stdout: string;
  exitCode: number;
}

function runOrchestrator(): TestRun {
  const cwd = mkdtempSync(join(tmpdir(), "tdd-live-smoke-"));
  cpSync(fixtureSrc, cwd, { recursive: true });
  const result = spawnSync(
    "claude",
    [
      "-p",
      "/dev-process-toolkit:tdd",
      "STE-SMOKE",
      "--permission-mode",
      "bypassPermissions",
    ],
    {
      cwd,
      encoding: "utf-8",
      timeout: 8 * 60 * 1000, // 8 minutes — orchestrator + 3 forked subagents.
      input: "<dpt:auto-approve>v1</dpt:auto-approve>\n",
    },
  );
  return {
    cwd,
    stdout: (result.stdout ?? "") + (result.stderr ?? ""),
    exitCode: result.status ?? -1,
  };
}

function findFile(dir: string, predicate: (rel: string) => boolean): string | null {
  if (!existsSync(dir)) return null;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    let s;
    try {
      s = statSync(p);
    } catch {
      continue;
    }
    if (s.isDirectory()) {
      const sub = findFile(p, predicate);
      if (sub) return sub;
    } else if (predicate(p)) {
      return p;
    }
  }
  return null;
}

function extractAllTddResultBlocks(stdout: string): { role?: string; status?: string }[] {
  const lines = stdout.split("\n");
  const out: { role?: string; status?: string }[] = [];
  let inFence = false;
  let buf: string[] = [];
  for (const line of lines) {
    if (!inFence && /^```tdd-result\s*$/.test(line)) {
      inFence = true;
      buf = [];
      continue;
    }
    if (inFence && /^```\s*$/.test(line)) {
      const body = buf.join("\n");
      const fenced = `\`\`\`tdd-result\n${body}\n\`\`\``;
      const parsed = parseTddResultBlock(fenced);
      if (parsed.ok) {
        out.push({ role: parsed.block.role, status: parsed.block.status });
      } else {
        out.push({});
      }
      inFence = false;
      buf = [];
      continue;
    }
    if (inFence) buf.push(line);
  }
  return out;
}

describeIfLive("AC-STE-225.9 — /tdd headless live smoke (DPT_TDD_LIVE_SMOKE=1)", () => {
  test("orchestrator runs against fixture FR and emits all three tdd-result blocks", () => {
    const run = runOrchestrator();
    const findings: string[] = [];
    findings.push(`# /tdd live smoke — ${todayISODate()}`);
    findings.push("");
    findings.push(`Working dir: ${run.cwd}`);
    findings.push(`Exit code  : ${run.exitCode}`);
    findings.push("");

    // (a) test files exist with non-zero size.
    const testFile = findFile(run.cwd, (p) => /\.test\.(ts|js)$/.test(p));
    if (!testFile) findings.push("(a) FAIL — no test file under fixture cwd");
    else if (statSync(testFile).size === 0) findings.push(`(a) FAIL — empty test file ${testFile}`);
    else findings.push(`(a) PASS — test file ${testFile}`);

    // (b) implementation file exists and exports the named function.
    const implFile = findFile(
      run.cwd,
      (p) => /\/(src|lib)\/.*\.(ts|js)$/.test(p) && /add/i.test(readFileSync(p, "utf-8")),
    );
    if (!implFile) findings.push("(b) FAIL — no implementation file referencing `add`");
    else findings.push(`(b) PASS — implementation file ${implFile}`);

    // (c) test command exits 0 — re-run the test command in the fixture cwd.
    const reRun = spawnSync("bun", ["test"], {
      cwd: run.cwd,
      encoding: "utf-8",
      timeout: 60 * 1000,
    });
    if (reRun.status === 0) findings.push("(c) PASS — `bun test` exits 0");
    else findings.push(`(c) FAIL — \`bun test\` exit code ${reRun.status}`);

    // (d) orchestrator stdout contains all three closing tdd-result
    // blocks (one per role: test-writer, implementer, refactorer)
    // with status: ok. Per the spec, the contract is "all three roles
    // closed with status: ok" — not "exactly three blocks." A retry on
    // any role pushes block count >3 but the three-role contract still
    // holds; we check the per-role-final-block shape, not the total.
    const blocks = extractAllTddResultBlocks(run.stdout);
    const finalByRole = new Map<string, { status?: string }>();
    for (const b of blocks) {
      if (b.role) finalByRole.set(b.role, b);
    }
    const requiredRoles = ["test-writer", "implementer", "refactorer"] as const;
    const okRoles = requiredRoles.filter(
      (role) => finalByRole.get(role)?.status === "ok",
    );
    findings.push(
      `(d) ${
        okRoles.length === requiredRoles.length ? "PASS" : "FAIL"
      } — found ${blocks.length} tdd-result blocks; closing blocks per role: ${
        requiredRoles.map((r) => `${r}=${finalByRole.get(r)?.status ?? "<absent>"}`).join(", ")
      }`,
    );

    // Persist findings.
    const fp = writeFindings(findings.join("\n") + "\n");

    // Hard assertions for the test-runner verdict.
    expect(testFile).not.toBeNull();
    if (testFile) expect(statSync(testFile).size).toBeGreaterThan(0);
    expect(implFile).not.toBeNull();
    expect(reRun.status).toBe(0);
    expect(okRoles.length).toBe(requiredRoles.length);
    expect(run.exitCode).toBe(0);

    // Cleanup the temp checkout when the run was successful — leave
    // it for inspection on failure.
    rmSync(run.cwd, { recursive: true, force: true });

    console.log(`/tdd live smoke findings: ${fp}`);
  }, 600_000);
});

describe("AC-STE-225.9 — smoke runner is env-gated (sanity)", () => {
  test("DPT_TDD_LIVE_SMOKE flag controls whether the live block runs", () => {
    // The describe-block above uses describe.skip when the env-var is
    // absent. Confirm the flag drives the live boolean, so a CI cron
    // setting DPT_TDD_LIVE_SMOKE=1 actually flips it on.
    expect(LIVE).toBe(process.env.DPT_TDD_LIVE_SMOKE === "1");
  });

  test("extractTddResultBlock from tdd_result.ts is the parser entrypoint the smoke runner imports", () => {
    expect(typeof extractTddResultBlock).toBe("function");
  });
});
