// STE-614 AC.3 + AC.4 — the gate-receipt front door, spawned as a subprocess.
//
// `adapters/_shared/src/gate_receipt.ts` is the ONE place a gate receipt is
// minted. It is graded here the way a skill runs it: `bun run <path> <skill>
// <path-inside-the-checkout>`, with CLAUDE_CODE_SESSION_ID in the environment.
// Every refusal is graded on all three of its observable effects — exit 1, an
// NFR-10 block on stderr, and NOTHING on stdout and nothing on disk — because a
// front door that printed its announcement and then failed would leave the
// caller announcing a receipt that does not exist.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  FRONT_DOOR,
  PLUGIN_ROOT,
  clearReceipts,
  receiptsDirOf,
  runFrontDoor,
  writeManagedClaudeMd,
} from "./_gate_receipt_fixture";

const SID = "ste614gr";
const GATE = "gate-check";
const T = 60_000;

let scratch = "";
let repo = "";

function git(cwd: string, ...args: string[]): string {
  const p = spawnSync("git", args, {
    cwd,
    encoding: "utf-8",
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
      GIT_AUTHOR_NAME: "F",
      GIT_AUTHOR_EMAIL: "f@example.invalid",
      GIT_COMMITTER_NAME: "F",
      GIT_COMMITTER_EMAIL: "f@example.invalid",
    },
  });
  if (p.status !== 0) throw new Error(`git ${args.join(" ")}: ${p.stderr}`);
  return p.stdout ?? "";
}

function makeCheckout(name: string, withCommit = true): string {
  const dir = join(scratch, name);
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  writeManagedClaudeMd(dir);
  if (withCommit) {
    git(dir, "add", "CLAUDE.md");
    git(dir, "commit", "-q", "-m", "fixture");
  }
  return dir;
}

function receiptFiles(root: string, sessionId: string): string[] {
  const dir = receiptsDirOf(root, sessionId);
  return existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith(".json")) : [];
}

function readOnlyReceipt(root: string, sessionId: string): Record<string, unknown> {
  const files = receiptFiles(root, sessionId);
  expect(files.length).toBe(1);
  return JSON.parse(
    readFileSync(join(receiptsDirOf(root, sessionId), files[0]!), "utf-8"),
  ) as Record<string, unknown>;
}

/** Every refusal shares this shape; the caller adds the clause-specific words. */
function expectRefusal(r: { exitCode: number; stdout: string; stderr: string }): void {
  expect(r.exitCode).toBe(1);
  expect(r.stdout).toBe("");
  expect(r.stderr).toContain("Refusing:");
  expect(r.stderr).toContain("Remedy:");
  expect(r.stderr).toContain("Context:");
}

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), "ste614-frontdoor-"));
  repo = makeCheckout("repo");
});

afterAll(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

describe("AC-STE-614.3 — the front door writes the gate receipt", () => {
  test("exit 0, a `dpt-receipt:` line, and a store envelope naming the skill and the checkout", () => {
    clearReceipts(repo, SID);
    const r = runFrontDoor(GATE, join(repo, "CLAUDE.md"), SID);
    expect({ code: r.exitCode, err: r.stderr }).toEqual({ code: 0, err: "" });
    const line = r.stdout.split("\n").find((l) => l.startsWith("dpt-receipt: "));
    expect(line).toBeDefined();
    const path = line!.slice("dpt-receipt: ".length).trim().split(/\s+/)[0]!;
    expect(path.startsWith("/")).toBe(true);
    expect(existsSync(path)).toBe(true);
    expect(path.includes(join(".dpt", "ledger", "receipts", SID))).toBe(true);

    const receipt = readOnlyReceipt(repo, SID);
    expect(receipt.kind).toBe("gate");
    expect(receipt.subject).toBe("dev-process-toolkit:gate-check");
    expect(receipt.decision).toBe("ran");
    expect(receipt.sessionId).toBe(SID);
    expect(receipt.root).toBe(realpathSync(repo));
    expect(receipt.adapter).toBeNull();
    expect(receipt.container).toBeNull();
    const head = git(repo, "rev-parse", "HEAD").trim();
    expect((receipt.evidence as Record<string, unknown>).head).toBe(head);
  }, T);

  test("each of the three skill names is accepted and written as its full name", () => {
    for (const skill of ["gate-check", "tdd", "spec-review"]) {
      const target = makeCheckout(`skill-${skill}`);
      const r = runFrontDoor(skill, target, SID);
      expect({ skill, code: r.exitCode, err: r.stderr }).toEqual({ skill, code: 0, err: "" });
      expect(readOnlyReceipt(target, SID).subject).toBe(`dev-process-toolkit:${skill}`);
    }
  }, T);

  test("a path reaching the checkout through a SYMLINK records the checkout's realpath", () => {
    const target = makeCheckout("symlinked");
    const link = join(scratch, "link-to-symlinked");
    symlinkSync(target, link);
    const r = runFrontDoor(GATE, join(link, "CLAUDE.md"), SID);
    expect({ code: r.exitCode, err: r.stderr }).toEqual({ code: 0, err: "" });
    expect(readOnlyReceipt(target, SID).root).toBe(realpathSync(target));
  }, T);

  test("an UNBORN branch records `evidence.head` as null rather than refusing", () => {
    const target = makeCheckout("unborn", false);
    const r = runFrontDoor(GATE, target, SID);
    expect({ code: r.exitCode, err: r.stderr }).toEqual({ code: 0, err: "" });
    expect((readOnlyReceipt(target, SID).evidence as Record<string, unknown>).head).toBeNull();
  }, T);

  test("a re-run in the same session writes a FRESH receipt beside the first", () => {
    const target = makeCheckout("rerun");
    runFrontDoor(GATE, target, SID);
    runFrontDoor(GATE, target, SID);
    expect(receiptFiles(target, SID).length).toBe(2);
  }, T);
});

describe("AC-STE-614.3 — the front door's refusals: exit 1, NFR-10, empty stdout, NO file", () => {
  test("an UNKNOWN skill name", () => {
    const target = makeCheckout("unknown-skill");
    const r = runFrontDoor("implement", target, SID);
    expectRefusal(r);
    expect(receiptFiles(target, SID)).toEqual([]);
  }, T);

  test("PERMIT SIBLING — the SAME path with a KNOWN skill name writes the receipt", () => {
    const target = makeCheckout("known-skill");
    const r = runFrontDoor(GATE, target, SID);
    expect(r.exitCode).toBe(0);
    expect(receiptFiles(target, SID).length).toBe(1);
  }, T);

  test("a path inside NO checkout", () => {
    const loose = mkdtempSync(join(tmpdir(), "ste614-nogit-"));
    try {
      const r = runFrontDoor(GATE, loose, SID);
      expectRefusal(r);
      expect(existsSync(join(loose, ".dpt"))).toBe(false);
    } finally {
      rmSync(loose, { recursive: true, force: true });
    }
  }, T);

  test("CLAUDE_CODE_SESSION_ID ABSENT → the named class `session-id-unavailable`", () => {
    const target = makeCheckout("sid-absent");
    const r = runFrontDoor(GATE, target, null);
    expectRefusal(r);
    expect(r.stderr).toContain("session-id-unavailable");
    expect(r.stderr).toContain("CLAUDE_CODE_SESSION_ID");
    const verdict = r.stderr.split("\n").find((l) => l.startsWith("Refusing:"))!;
    expect(verdict).toContain("CLAUDE_CODE_SESSION_ID");
    expect(verdict.toLowerCase()).toContain("gate evidence");
    const remedy = r.stderr.split("\n").find((l) => l.startsWith("Remedy:"))!;
    expect(remedy).toContain("Claude Code session");
    expect(existsSync(join(target, ".dpt", "ledger", "receipts"))).toBe(false);
  }, T);

  test("CLAUDE_CODE_SESSION_ID EMPTY → the same named class", () => {
    const target = makeCheckout("sid-empty");
    const r = runFrontDoor(GATE, target, "");
    expectRefusal(r);
    expect(r.stderr).toContain("session-id-unavailable");
    expect(r.stderr).toContain("CLAUDE_CODE_SESSION_ID");
    expect(existsSync(join(target, ".dpt", "ledger", "receipts"))).toBe(false);
  }, T);

  test("PERMIT TWIN — the SAME call with the variable SET writes under .dpt/ledger/receipts/<id>/", () => {
    const target = makeCheckout("sid-set");
    const r = runFrontDoor(GATE, target, SID);
    expect(r.exitCode).toBe(0);
    expect(receiptFiles(target, SID).length).toBe(1);
    expect(existsSync(join(target, ".dpt", "ledger", "receipts", SID))).toBe(true);
  }, T);

  test("a path-UNSAFE session id (`../x` and `a/b`) is refused, and escapes nothing", () => {
    for (const bad of ["../x", "a/b"]) {
      const target = makeCheckout(`sid-${bad.replace(/[^a-z]/g, "")}`);
      const r = runFrontDoor(GATE, target, bad);
      expectRefusal(r);
      expect(existsSync(join(target, ".dpt", "ledger", "receipts", bad))).toBe(false);
      expect(existsSync(join(scratch, "x"))).toBe(false);
    }
  }, T);

  test("an UNWRITABLE store refuses rather than throwing an unhandled error", () => {
    const target = makeCheckout("unwritable");
    const dir = join(target, ".dpt", "ledger", "receipts");
    mkdirSync(dir, { recursive: true });
    chmodSync(dir, 0o500);
    try {
      const r = runFrontDoor(GATE, target, SID);
      expectRefusal(r);
      expect(receiptFiles(target, SID)).toEqual([]);
    } finally {
      chmodSync(dir, 0o700);
    }
  }, T);
});

describe("AC-STE-614.3 — the front door declares no store of its own", () => {
  test("it calls the M_947c79 store instead of composing a path, writing a file or minting an envelope", () => {
    const source = readFileSync(FRONT_DOOR, "utf-8");
    expect(source).toContain("tracker_receipts");
    expect(source).toContain("writeReceipt");
    // No second composer, writer or envelope (AC-STE-614.3, AC-STE-614.4).
    expect(source).not.toContain("writeFileSync");
    expect(source).not.toContain("ledger/receipts");
    expect(source).not.toMatch(/\bv:\s*1\b/);
  });
});

describe("AC-STE-614.4 — the store is reused, and a gate receipt is never tracker evidence", () => {
  test("with the canonical `.dpt/.gitignore` committed, a receipt leaves `git status --porcelain` empty", () => {
    const target = makeCheckout("ignored");
    runFrontDoor(GATE, target, SID); // creates .dpt/.gitignore through the store
    git(target, "add", "-f", join(".dpt", ".gitignore"));
    git(target, "commit", "-q", "-m", "dpt gitignore");
    runFrontDoor(GATE, target, SID);
    expect(git(target, "status", "--porcelain")).toBe("");
  }, T);

  test("in a fresh checkout with no `.dpt/`, `-uall` lists the .gitignore alone and never a receipt", () => {
    const target = makeCheckout("fresh");
    expect(existsSync(join(target, ".dpt"))).toBe(false);
    runFrontDoor(GATE, target, SID);
    const lines = git(target, "status", "--porcelain", "-uall")
      .split("\n")
      .filter((l) => l.trim() !== "");
    expect(lines).toEqual(["?? .dpt/.gitignore"]);
  }, T);

  test("`gate_receipt.ts` is absent from the tracker-write hook's RECEIPT_ANNOUNCING_MODULES", () => {
    const libRoot = join(PLUGIN_ROOT, "templates", "hooks", "_lib");
    const found: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, name.name);
        if (name.isDirectory()) walk(full);
        else if (name.name.endsWith(".ts")) {
          const body = readFileSync(full, "utf-8");
          if (body.includes("RECEIPT_ANNOUNCING_MODULES")) found.push(full);
        }
      }
    };
    walk(libRoot);
    // CONTROL — a zero-hit scan would pass vacuously.
    expect(found.length).toBeGreaterThan(0);
    for (const file of found) {
      const body = readFileSync(file, "utf-8");
      const block = body.slice(body.indexOf("RECEIPT_ANNOUNCING_MODULES"));
      const list = block.slice(0, block.indexOf("]") + 1);
      expect({ file, hit: list.includes("gate_receipt") }).toEqual({ file, hit: false });
    }
  });
});

// ---------------------------------------------------------------------------
// AC-STE-614.4, review round: the AC says the tracker-write hook, "given a
// directory holding only gate receipts, authorises no tracker write". Only the
// RECEIPT_ANNOUNCING_MODULES absence scan shipped; the directory was never
// driven. This drives it through that hook's own exported readers.
// ---------------------------------------------------------------------------
describe("AC-STE-614.4 review — a directory of gate receipts authorises no tracker write", () => {
  test("the front door is not a deciding module, and its announcement buys no tracker receipt", async () => {
    const hook = (await import("../templates/hooks/_lib/hooks/pre-tracker-write-gate")) as unknown as {
      invokedDecidingModule: (command: string) => string | null;
      announcedReceipts: (lines: string[], sessionId: string) => unknown[];
      RECEIPT_ANNOUNCING_MODULES: readonly string[];
    };
    const root = mkdtempSync(join(tmpdir(), "gate-only-store-"));
    try {
      writeManagedClaudeMd(root);
      git(root, "init", "-q", "-b", "main");
      const out = runFrontDoor("gate-check", root, "sess-tw");
      expect(out.exitCode).toBe(0);
      const announcement = out.stdout.trim();
      expect(announcement.startsWith("dpt-receipt: ")).toBe(true);

      // A gate receipt's announcement names gate_receipt.ts, which is NOT a
      // deciding module, so the tracker-write hook reads no receipt from it.
      expect(hook.RECEIPT_ANNOUNCING_MODULES).not.toContain("gate_receipt.ts");
      const command = `bun run \${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/gate_receipt.ts gate-check ${root}`;
      expect(hook.invokedDecidingModule(command)).toBe(null);
      expect(hook.announcedReceipts([announcement], "sess-tw")).toEqual([]);

      // CONTROL — the same reader DOES see a real deciding module's line, so
      // the empty list above is a verdict and not a reader that finds nothing.
      const decider = `bun run \${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/ticket_ownership.ts confirm ${root} STE-1 t.json`;
      expect(hook.invokedDecidingModule(decider)).not.toBe(null);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);
});
