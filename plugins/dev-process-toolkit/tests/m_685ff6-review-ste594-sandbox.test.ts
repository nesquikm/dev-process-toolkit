// M_685ff6 pre-PR review — the STE-594 harness writes run ledgers only into
// its own sandbox. Its `bun` stub delegated any `smoke_run_ledger.ts` call
// whose arguments did not spell the real repository, so an append naming any
// other directory outside the sandbox (or no --project-root from an outside
// cwd) was written there. It now refuses (exit 97) and records the refusal.
// The two outside legs were red on 07655a75; the sandbox leg is the control.

import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeSandbox } from "./_ste594_harness";

const RUN = "00000000-0000-4000-8000-000000000594";
const SID = "11111111-1111-4111-8111-111111111594";

function append(sbBin: string, cwd: string, projectRoot: string | null): number {
  const args = ["append", "--run", RUN, "--leg", "linear", "--session", SID, ...(projectRoot ? ["--project-root", projectRoot] : [])];
  const p = Bun.spawnSync([join(sbBin, "bun"), "/x/adapters/_shared/src/smoke_run_ledger.ts", ...args], {
    cwd,
    env: { ...process.env, PATH: `${sbBin}:${process.env.PATH ?? ""}` },
  });
  return p.exitCode ?? -1;
}

const ledgerFiles = (root: string): string[] => {
  const d = join(root, ".dpt", "ledger");
  return existsSync(d) ? readdirSync(d) : [];
};

describe("M_685ff6 review — the STE-594 bun stub writes run ledgers only inside its sandbox", () => {
  test("an append whose --project-root is outside the sandbox is refused and writes nothing there", () => {
    const sb = makeSandbox("delegate");
    const outside = mkdtempSync(join(tmpdir(), "ste594-outside-"));
    try {
      expect(append(sb.bin, sb.work, outside)).toBe(97);
      expect(ledgerFiles(outside)).toEqual([]);
      expect(readFileSync(sb.calls, "utf-8")).toMatch(/^refused\t/m);
    } finally {
      rmSync(outside, { recursive: true, force: true });
      rmSync(sb.root, { recursive: true, force: true });
    }
  });

  test("an append with no --project-root from a cwd outside the sandbox is refused and writes nothing there", () => {
    const sb = makeSandbox("delegate");
    const outside = mkdtempSync(join(tmpdir(), "ste594-outside-"));
    try {
      expect(append(sb.bin, outside, null)).toBe(97);
      expect(ledgerFiles(outside)).toEqual([]);
    } finally {
      rmSync(outside, { recursive: true, force: true });
      rmSync(sb.root, { recursive: true, force: true });
    }
  });

  test("(control) an append into the sandbox's own work dir is delegated and written there", () => {
    const sb = makeSandbox("delegate");
    try {
      expect(append(sb.bin, sb.work, sb.work)).toBe(0);
      expect(ledgerFiles(sb.work)).toEqual([`smoke-run-${RUN}.jsonl`]);
    } finally {
      rmSync(sb.root, { recursive: true, force: true });
    }
  });
});
