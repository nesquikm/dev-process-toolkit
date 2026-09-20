// STE-614 shared fixture helper — the gate-receipt front door, spawned.
//
// Leading underscore: a helper module, never collected as a suite.
//
// Every receipt a STE-614 suite puts into a fixture is written by SPAWNING the
// shipped front door (`adapters/_shared/src/gate_receipt.ts`), never by a
// hand-rolled JSON write: AC-STE-614.13 calls that a "front-door-written
// receipt", and a suite that composed its own envelope would keep passing after
// the front door broke.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { receiptsDir } from "../adapters/_shared/src/dpt_paths";

export const PLUGIN_ROOT = join(import.meta.dir, "..");

/** The front door under test. */
export const FRONT_DOOR = join(
  PLUGIN_ROOT,
  "adapters",
  "_shared",
  "src",
  "gate_receipt.ts",
);

export interface FrontDoorRun {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Spawn the front door. `sessionId === null` leaves CLAUDE_CODE_SESSION_ID
 * unset (the "absent" refusal); any string is exported verbatim, including the
 * empty string and path-unsafe spellings.
 */
export function runFrontDoor(
  skill: string,
  path: string,
  sessionId: string | null,
  extraEnv: Record<string, string> = {},
): FrontDoorRun {
  const env: Record<string, string> = { ...process.env, ...extraEnv } as Record<string, string>;
  if (sessionId === null) delete env.CLAUDE_CODE_SESSION_ID;
  else env.CLAUDE_CODE_SESSION_ID = sessionId;
  const proc = spawnSync("bun", ["run", FRONT_DOOR, skill, path], {
    env,
    encoding: "utf-8",
  });
  return {
    exitCode: proc.status ?? -1,
    stdout: proc.stdout ?? "",
    stderr: proc.stderr ?? "",
  };
}

/** Write a gate receipt through the front door, or throw with its stderr. */
export function writeGateReceipt(
  root: string,
  skill: string,
  sessionId: string,
): string {
  const r = runFrontDoor(skill, root, sessionId);
  if (r.exitCode !== 0) {
    throw new Error(
      `front door failed for ${skill} in ${root} (exit ${r.exitCode}): ${r.stderr}`,
    );
  }
  const line = r.stdout.split("\n").find((l) => l.startsWith("dpt-receipt: "));
  if (!line) throw new Error(`front door printed no dpt-receipt line: ${r.stdout}`);
  MINTED.push(line.trim());
  return line.slice("dpt-receipt: ".length).trim().split(/\s+/)[0]!;
}

/**
 * Every announcement the front door has printed in this test file, in mint
 * order — the lines a real session's transcript carries, because the skill runs
 * the front door through Bash and its stdout lands in the tool_result.
 *
 * A receipt counts only when its announcement is in the transcript (STE-614
 * review): the file alone is writable by any Bash call, and a hand-written one
 * with an earlier `createdAt` took the window before this rule landed.
 */
const MINTED: string[] = [];

/** The announcements minted since the last `forgetAnnouncements()`, in order. */
export function mintedAnnouncements(): string[] {
  return [...MINTED];
}

export function forgetAnnouncements(): void {
  MINTED.length = 0;
}

/**
 * A transcript record pair announcing `lines`: the Bash call that ran the front
 * door, and its non-error result. This is the shape the guard reads.
 */
export function announcementRecords(lines: readonly string[], id = "bash-mint"): string[] {
  if (lines.length === 0) return [];
  return [
    JSON.stringify({
      type: "assistant",
      timestamp: new Date().toISOString(),
      message: {
        content: [
          {
            type: "tool_use",
            id,
            name: "Bash",
            input: { command: 'bun run "${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/gate_receipt.ts" gate-check .' },
          },
        ],
      },
    }),
    JSON.stringify({
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: id, is_error: false, content: lines.join("\n") }] },
    }),
  ];
}

/**
 * `<root>/.dpt/ledger/receipts/<sessionId>`, composed by the STORE'S OWN rule.
 *
 * It used to spell the path out here under a comment claiming otherwise, which
 * is a second composer: it would keep answering the old path on the day
 * `dpt_paths.ts` moved the store, and the suite would go green against a
 * directory nothing writes to.
 */
export function receiptsDirOf(root: string, sessionId: string): string {
  return receiptsDir(root, sessionId);
}

/** Remove every receipt this session holds in `root`. */
export function clearReceipts(root: string, sessionId: string): void {
  rmSync(receiptsDirOf(root, sessionId), { recursive: true, force: true });
}

/**
 * Make `dir` a toolkit-managed checkout: a `## Task Tracking` CLAUDE.md, which
 * is what `isToolkitManaged` answers from. Does not initialise git.
 */
export function writeManagedClaudeMd(dir: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "CLAUDE.md"),
    [
      "# Fixture Project",
      "",
      "## Task Tracking",
      "",
      "mode: none",
      "",
      "## Verification",
      "",
      "run_cmd: none",
      "",
    ].join("\n"),
  );
}

/** True when `root` holds at least one receipt file for `sessionId`. */
export function hasReceipts(root: string, sessionId: string): boolean {
  return existsSync(receiptsDirOf(root, sessionId));
}
