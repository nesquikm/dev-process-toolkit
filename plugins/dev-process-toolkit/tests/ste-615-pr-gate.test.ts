// STE-615 AC.3 + AC.4 — the HS-2 table, graded through the SHIPPED bash wrapper.
//
// Every row here runs `bash templates/hooks/process/pre-pr-spec-review.sh` the
// way the harness does: CLAUDE_PLUGIN_ROOT set, the PreToolUse JSON on stdin,
// cwd = FE. Calling the resolver directly would grade a module; this grades the
// gate, which is what the two live bypasses walked through.
//
// EVERY FORBID ROW HAS A PERMIT SIBLING. A suite that only proved refusals
// would pass a hook that refused everything, which is the other way to break a
// gate.
//
// THE "AT HEAD" CLAUSES ARE MEASURED, NOT ASSERTED. AC-STE-615.3 says P01-P07
// "each exited 0 at HEAD" and that `gh pr create --help` "exited 2 at HEAD".
// Those are claims about bytes, so this suite extracts the pre-change plugin
// tree with `git archive` (read-only) and runs the SAME wrapper out of it. A
// falsifiability claim nobody ran is a claim.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  announcementRecords,
  forgetAnnouncements,
  mintedAnnouncements,
  writeGateReceipt,
} from "./_gate_receipt_fixture";
import { git, makeSpanFixture, type SpanFixture } from "./_span_fixture";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const WRAPPER_SUBPATH = ["templates", "hooks", "process", "pre-pr-spec-review.sh"];

/**
 * STE-615's pre-change bytes — the commit this FR's falsifiability is measured
 * against. A FIXED sha, never the moving `HEAD` ref: once this FR ships, `HEAD`
 * is the POST-change tree and every "at HEAD it exited 0" control below would
 * quietly grade the new bytes against themselves.
 */
const BASE = "fd10d40fc3ad125e4523f9d30c2eeed24d6f6033";

const SID = "s1";
const T = 300_000;
/** An hour back: every receipt the fixture writes is newer than this. */
const EARLY = new Date(Date.now() - 3_600_000).toISOString();

const SUBJECT = "dev-process-toolkit:spec-review";

let fx: SpanFixture;
let FE = "";
let BE = "";
let scratch = "";
/** The pre-change plugin root, extracted from `BASE`. */
let BASE_ROOT = "";

let NO_EVIDENCE = "";
let FE_ONLY = "";
let FE_AND_BE = "";

interface Run {
  exitCode: number;
  stderr: string;
}

function payloadFor(command: string, transcript: string): string {
  return JSON.stringify({
    session_id: SID,
    transcript_path: transcript,
    cwd: FE,
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command },
  });
}

/** Drive the shipped wrapper out of `pluginRoot` (default: this working tree). */
async function runIn(pluginRoot: string, command: string, transcript: string): Promise<Run> {
  const proc = Bun.spawn(["/bin/bash", join(pluginRoot, ...WRAPPER_SUBPATH)], {
    cwd: FE,
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginRoot },
    stdin: new Response(payloadFor(command, transcript)).body,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { exitCode: await proc.exited, stderr };
}

/** The gate as it ships in this working tree. */
const run = (command: string, transcript: string): Promise<Run> =>
  runIn(PLUGIN_ROOT, command, transcript);

/** The same gate, as it stood at STE-615's pre-change base. */
const runAtBase = (command: string, transcript: string): Promise<Run> =>
  runIn(BASE_ROOT, command, transcript);

/** A transcript: one spec-review Skill call per stamp, each followed by its announcements. */
function transcript(name: string, stamps: string[] = [], announced: string[][] = []): string {
  const file = join(scratch, `${name}.jsonl`);
  const lines: string[] = [
    JSON.stringify({ type: "tool_use", name: "Bash", input: { command: "ls" } }),
  ];
  stamps.forEach((stamp, i) => {
    lines.push(
      JSON.stringify({ type: "tool_use", timestamp: stamp, name: "Skill", input: { skill: SUBJECT } }),
    );
    lines.push(...announcementRecords(announced[i] ?? [], `mint-${name}-${i}`));
  });
  writeFileSync(file, lines.join("\n") + "\n");
  return file;
}

/** Extract the pre-change plugin tree at `BASE` into `dir`; returns the plugin root. */
function extractBase(dir: string): string {
  const archive = spawnSync(
    "git",
    [
      "-C",
      REPO_ROOT,
      "archive",
      "--format=tar",
      BASE,
      "plugins/dev-process-toolkit/templates",
      "plugins/dev-process-toolkit/adapters",
      "plugins/dev-process-toolkit/.claude-plugin",
    ],
    { maxBuffer: 256 * 1024 * 1024 },
  );
  if (archive.status !== 0) {
    throw new Error(`git archive ${BASE} failed: ${archive.stderr?.toString() ?? ""}`);
  }
  mkdirSync(dir, { recursive: true });
  const untar = spawnSync("tar", ["-x", "-C", dir], { input: archive.stdout });
  if (untar.status !== 0) throw new Error(`tar -x failed: ${untar.stderr?.toString() ?? ""}`);
  return join(dir, "plugins", "dev-process-toolkit");
}

beforeAll(() => {
  fx = makeSpanFixture("M_ste615_gate");
  FE = fx.a;
  BE = fx.b;
  git(FE, "remote", "add", "origin", "git@github.com:org/fe.git");
  git(BE, "remote", "add", "origin", "https://github.com/org/be");

  scratch = mkdtempSync(join(tmpdir(), "ste615-gate-"));
  BASE_ROOT = extractBase(join(scratch, "base"));

  NO_EVIDENCE = transcript("none");

  // One gate run vouches for ONE checkout, so two checkouts take two windows.
  // FE's receipt is minted inside the EARLY window; BE's inside a later one.
  forgetAnnouncements();
  writeGateReceipt(FE, "spec-review", SID);
  const ANNOUNCED_FE = mintedAnnouncements();
  const MID = new Date().toISOString();
  const beforeBe = mintedAnnouncements().length;
  writeGateReceipt(BE, "spec-review", SID);
  const ANNOUNCED_BE = mintedAnnouncements().slice(beforeBe);

  // BE's receipt FILE exists in both states. What separates them is whether the
  // session ANNOUNCED it — the STE-614 rule that a receipt nobody announced is
  // a file any Bash call could have written.
  FE_ONLY = transcript("fe-only", [EARLY], [ANNOUNCED_FE]);
  FE_AND_BE = transcript("fe-and-be", [EARLY, MID], [ANNOUNCED_FE, ANNOUNCED_BE]);
});

afterAll(() => {
  fx?.cleanup();
  rmSync(scratch, { recursive: true, force: true });
});

/** The HS-2 rows, by the names the FR's repro gave them. */
const ROWS = () =>
  ({
    P00: "gh pr create",
    P01: `cd ${BE} && gh pr create`,
    P02: `(cd ${BE}; gh pr create)`,
    P03: "gh -R org/be pr create",
    P04: "GH_REPO=org/be gh pr create",
    P05: "git push -u origin b && gh pr create",
    P07: "git push -u origin b\ngh pr create",
  }) as const;

/** The rows that resolve to BE. */
const TO_BE = ["P01", "P02"] as const;
/** The rows that resolve to FE. */
const TO_FE = ["P00", "P05", "P07"] as const;
/** The rows whose slug names a repository FE has no remote for. */
const FOREIGN = ["P03", "P04"] as const;

describe("AC-STE-615.3 — the pre-change base, measured rather than asserted", () => {
  test("at the base, P01-P05 and P07 all exit 0 — the bypass this FR closes", async () => {
    const got: string[] = [];
    const rows = ROWS();
    for (const key of ["P01", "P02", "P03", "P04", "P05", "P07"] as const) {
      const r = await runAtBase(rows[key], NO_EVIDENCE);
      if (r.exitCode !== 0) got.push(`${key} exited ${r.exitCode} at the base`);
    }
    expect(got).toEqual([]);
  }, T);

  test("at the base, P00 exits 2 and `gh pr new` exits 0 and `gh pr create --help` exits 2", async () => {
    expect((await runAtBase(ROWS().P00, NO_EVIDENCE)).exitCode).toBe(2);
    expect((await runAtBase("gh pr new", NO_EVIDENCE)).exitCode).toBe(0);
    expect((await runAtBase("gh pr create --help", NO_EVIDENCE)).exitCode).toBe(2);
  }, T);
});

describe("AC-STE-615.3 — with NO evidence, every HS-2 row is refused", () => {
  for (const key of ["P01", "P02", "P03", "P04", "P05", "P07"] as const) {
    test(`${key} exits 2 (it exited 0 at the base)`, async () => {
      const r = await run(ROWS()[key], NO_EVIDENCE);
      expect({ key, code: r.exitCode }).toEqual({ key, code: 2 });
    }, T);
  }

  test("P00 still exits 2 with the byte-identical plain-miss refusal", async () => {
    const now = await run(ROWS().P00, NO_EVIDENCE);
    const base = await runAtBase(ROWS().P00, NO_EVIDENCE);
    expect(now.exitCode).toBe(2);
    expect(now.stderr).toBe(base.stderr);
    // Non-vacuity: the compared text is the real refusal, not two empty strings.
    expect(now.stderr).toContain("Refusing:");
  }, T);
});

describe("AC-STE-615.3 — with evidence for FE only", () => {
  for (const key of TO_FE) {
    test(`${key} resolves to FE and exits 0 with empty stderr`, async () => {
      const r = await run(ROWS()[key], FE_ONLY);
      expect({ key, code: r.exitCode, err: r.stderr }).toEqual({ key, code: 0, err: "" });
    }, T);
  }

  for (const key of TO_BE) {
    test(`${key} exits 2, naming BE and the remedy run in BE's checkout`, async () => {
      const r = await run(ROWS()[key], FE_ONLY);
      expect({ key, code: r.exitCode }).toEqual({ key, code: 2 });
      expect(r.stderr).toContain(BE);
      expect(r.stderr).toContain(`run /${SUBJECT} in ${BE}`);
      // Never the front-door command line: the remedy is the SKILL to run, not
      // the receipt-minting order, which an operator could run without ever
      // reviewing anything.
      expect(r.stderr).not.toContain("gate_receipt.ts");
    }, T);
  }

  for (const key of FOREIGN) {
    test(`${key} exits 2, naming the slug \`org/be\``, async () => {
      const r = await run(ROWS()[key], FE_ONLY);
      expect({ key, code: r.exitCode }).toEqual({ key, code: 2 });
      expect(r.stderr).toContain("org/be");
    }, T);
  }
});

describe("AC-STE-615.3 — with a BE receipt added in the same session", () => {
  for (const key of TO_BE) {
    test(`${key} exits 0 with empty stderr — the permitted request is graded too`, async () => {
      const r = await run(ROWS()[key], FE_AND_BE);
      expect({ key, code: r.exitCode, err: r.stderr }).toEqual({ key, code: 0, err: "" });
    }, T);
  }

  for (const cmd of ["gh -R org/be pr create", "GH_REPO=org/be gh pr create"]) {
    test(`\`cd <BE> && ${cmd}\` exits 0: the slug matches BE's own remote`, async () => {
      const r = await run(`cd ${BE} && ${cmd}`, FE_AND_BE);
      expect({ cmd, code: r.exitCode, err: r.stderr }).toEqual({ cmd, code: 0, err: "" });
    }, T);
  }

  for (const key of FOREIGN) {
    test(`${key} still exits 2 — evidence cannot vouch for a known-foreign target`, async () => {
      const r = await run(ROWS()[key], FE_AND_BE);
      expect({ key, code: r.exitCode }).toEqual({ key, code: 2 });
      expect(r.stderr).toContain("org/be");
    }, T);
  }
});

describe("AC-STE-615.3 — the two rows the base gets wrong in opposite directions", () => {
  test("`gh pr new` with no evidence exits 2, where it exited 0 at the base", async () => {
    expect((await run("gh pr new", NO_EVIDENCE)).exitCode).toBe(2);
  }, T);

  test("`gh pr create --help` with no evidence exits 0 and is silent, where it exited 2 at the base", async () => {
    const r = await run("gh pr create --help", NO_EVIDENCE);
    expect({ code: r.exitCode, err: r.stderr }).toEqual({ code: 0, err: "" });
  }, T);

  test("PERMIT SIBLINGS — the out-of-scope rows pass in silence with no evidence", async () => {
    const got: string[] = [];
    for (const cmd of [
      "gh pr list",
      "gh pr view 1",
      "gh pr merge 1",
      "gh api repos/org/be/pulls -X POST",
      "hub pull-request",
      "git push -o merge_request.create",
      "bash make_pr.sh",
      'bash -c "$X"',
      "gh pr create -h",
      "git push -u origin b",
    ]) {
      const r = await run(cmd, NO_EVIDENCE);
      if (r.exitCode !== 0 || r.stderr !== "") got.push(`exit ${r.exitCode}: ${cmd}\n${r.stderr}`);
    }
    expect(got).toEqual([]);
  }, T);
});

describe("AC-STE-615.4 — the unresolved leg", () => {
  const UNRESOLVED = 'gh pr create --repo "$R"';

  test("with evidence for the session's own checkout, it exits 1 with a Reminder naming `$R`", async () => {
    const r = await run(UNRESOLVED, FE_ONLY);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("Reminder:");
    expect(r.stderr).toContain("$R");
    expect(r.stderr).not.toContain("Refusing:");
  }, T);

  test("SIBLING — the same command without that evidence exits 2", async () => {
    expect((await run(UNRESOLVED, NO_EVIDENCE)).exitCode).toBe(2);
  }, T);
});

describe("AC-STE-615.5 — the derivation still sees this gate", () => {
  test("the PR gate is derived with its skill and hook names, from unedited `tests/_blocking_gates.ts`", async () => {
    const { deriveBlockingGates } = await import("./_blocking_gates");
    const gates = deriveBlockingGates(PLUGIN_ROOT);
    const pr = gates.find((g) => g.hook === "pre-pr-spec-review");
    expect(pr).toBeDefined();
    expect({ skill: pr!.skill, entryPoint: pr!.entryPoint })
      .toEqual({ skill: SUBJECT, entryPoint: "pre-pr-spec-review.ts" });
  });

  test("the retired anchored regex is GONE from the entry point — not kept as a fast path", async () => {
    const source = await Bun.file(
      join(PLUGIN_ROOT, "templates", "hooks", "_lib", "hooks", "pre-pr-spec-review.ts"),
    ).text();
    expect(source).not.toContain("/^gh pr create");
    // CONTROL — the base DID carry it, so the absence above is a change.
    const baseSource = await Bun.file(
      join(BASE_ROOT, "templates", "hooks", "_lib", "hooks", "pre-pr-spec-review.ts"),
    ).text();
    expect(baseSource).toContain("/^gh pr create");
  });

  test("the entry point demands evidence with a resolved target", async () => {
    const source = await Bun.file(
      join(PLUGIN_ROOT, "templates", "hooks", "_lib", "hooks", "pre-pr-spec-review.ts"),
    ).text();
    const dense = source.replace(/\s+/g, "");
    expect(dense).toContain("resolvePrTargetFromPayload(");
    expect(dense).toContain("gateEvidenceTarget(");
  });
});
