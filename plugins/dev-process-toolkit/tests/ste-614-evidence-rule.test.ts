// STE-614 — the evidence rule, graded end to end through the SHIPPED wrappers.
//
// AC.1, AC.2, AC.5–AC.10, AC.16 and AC.17 live here. Two toolkit-managed
// `makeSpanFixture` checkouts, FE (the session's own) and BE (the foreign one),
// driven the way the harness drives the hooks: `bash <wrapper>`,
// CLAUDE_PLUGIN_ROOT set, the PreToolUse JSON on stdin, cwd = FE.
//
// Every receipt a fixture holds is written by SPAWNING the front door, never by
// a hand-rolled JSON write — a suite that minted its own envelope would keep
// passing after the front door broke.
//
// Every spawn is SERIAL: no Promise.all over processes.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { git, makeSpanFixture, type SpanFixture } from "./_span_fixture";
import {
  PLUGIN_ROOT,
  announcementRecords,
  clearReceipts,
  forgetAnnouncements,
  mintedAnnouncements,
  receiptsDirOf,
  writeGateReceipt,
  writeManagedClaudeMd,
} from "./_gate_receipt_fixture";

const WRAPPER = {
  gate: join(PLUGIN_ROOT, "templates", "hooks", "process", "pre-commit-gate-check.sh"),
  tdd: join(PLUGIN_ROOT, "templates", "hooks", "process", "pre-commit-tdd-orchestrator.sh"),
  pr: join(PLUGIN_ROOT, "templates", "hooks", "process", "pre-pr-spec-review.sh"),
} as const;
type Hook = keyof typeof WRAPPER;

const SKILL_OF: Record<Hook, string> = {
  gate: "dev-process-toolkit:gate-check",
  tdd: "dev-process-toolkit:tdd",
  pr: "dev-process-toolkit:spec-review",
};
const SHORT_OF: Record<Hook, string> = {
  gate: "gate-check",
  tdd: "tdd",
  pr: "spec-review",
};

const SID = "s614";
const T = 300_000;
const PAST = new Date(Date.now() - 3_600_000).toISOString();
const FUTURE = new Date(Date.now() + 3_600_000).toISOString();

let fx: SpanFixture;
let FE = "";
let BE = "";
let UN = ""; // a git checkout that is NOT toolkit-managed
let scratch = "";

// --------------------------------------------------------------- transcripts

function skillUse(id: string, skill: string, ts: string | null): string {
  const message = { content: [{ type: "tool_use", id, name: "Skill", input: { skill } }] };
  return JSON.stringify(
    ts === null
      ? { type: "assistant", message }
      : { type: "assistant", timestamp: ts, message },
  );
}

function toolResult(id: string, isError: boolean | null): string {
  const block: Record<string, unknown> = { type: "tool_result", tool_use_id: id };
  if (isError !== null) block.is_error = isError;
  return JSON.stringify({ type: "user", message: { content: [block] } });
}

function assistantText(text: string): string {
  return JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text }] } });
}

const BASH_LINE = JSON.stringify({
  type: "assistant",
  message: { content: [{ type: "tool_use", id: "b1", name: "Bash", input: { command: "ls" } }] },
});

let transcriptSeq = 0;
/**
 * Write a transcript. The receipts minted so far are ANNOUNCED at the end,
 * because that is where a real session's announcements land: the skill runs the
 * front door through Bash after its own Skill call. Pass `announce: false` to
 * place them by hand, which the multi-window vouching cases need.
 */
function transcript(lines: string[], opts: { announce?: boolean } = {}): string {
  const file = join(scratch, `t-${transcriptSeq++}.jsonl`);
  const body = opts.announce === false ? lines : [...lines, ...announcementRecords(mintedAnnouncements())];
  writeFileSync(file, body.join("\n") + "\n");
  return file;
}

/** One non-error Skill call for `hook`'s skill, timestamped in the past. */
function okCall(hook: Hook, ts: string = PAST, id = "tu1"): string[] {
  return [skillUse(id, SKILL_OF[hook], ts), toolResult(id, false)];
}

function okTranscript(hook: Hook): string {
  return transcript([BASH_LINE, ...okCall(hook)]);
}

function noEvidence(): string {
  return transcript([BASH_LINE]);
}

// ------------------------------------------------------------------- driver

interface Run {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface RunOpts {
  cwd?: string;
  sessionId?: string | null;
  transcriptPath?: string;
  stdin?: string;
}

async function run(
  hook: Hook,
  command: string,
  tr: string,
  opts: RunOpts = {},
): Promise<Run> {
  const cwd = opts.cwd ?? FE;
  const payload: Record<string, unknown> = {
    transcript_path: opts.transcriptPath ?? tr,
    cwd,
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command },
  };
  if (opts.sessionId !== null) payload.session_id = opts.sessionId ?? SID;
  const stdin = opts.stdin ?? JSON.stringify(payload);
  const proc = Bun.spawn(["/bin/bash", WRAPPER[hook]], {
    cwd,
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT },
    stdin: new Response(stdin).body,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { exitCode: await proc.exited, stdout, stderr };
}

// ------------------------------------------------------------------ commands

const commit = (root: string): string => `git -C ${root} commit -m x`;
const prCreate = "gh pr create --fill";

function beShapes(): string[] {
  return [
    `git -C ${BE} commit -m x`,
    `cd ${BE} && git commit -m x`,
    `(cd ${BE}; git commit -m x)`,
    `cd ${BE} && git commit -F - <<'MSG'\nwip\nMSG`,
  ];
}

// ------------------------------------------------------------------- fixture

function stage(root: string, files: Record<string, string>): void {
  for (const [rel, body] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(full.split("/").slice(0, -1).join("/"), { recursive: true });
    writeFileSync(full, body);
    git(root, "add", rel);
  }
}

/** Clear both stores, then write the named receipts through the front door. */
function setReceipts(spec: { fe?: string[]; be?: string[] }): void {
  forgetAnnouncements();
  clearReceipts(FE, SID);
  clearReceipts(BE, SID);
  for (const skill of spec.fe ?? []) writeGateReceipt(FE, skill, SID);
  for (const skill of spec.be ?? []) writeGateReceipt(BE, skill, SID);
}

/**
 * Mint a receipt through the front door and return its announcement line, so a
 * test can place the announcement where a real session would have printed it:
 * inside the window whose gate run produced it.
 */
function mintAnnounced(root: string, skill: string): string {
  const before = mintedAnnouncements().length;
  writeGateReceipt(root, skill, SID);
  return mintedAnnouncements().slice(before)[0]!;
}

function onlyReceiptFile(root: string): string {
  const dir = receiptsDirOf(root, SID);
  const names = readdirSync(dir).filter((n) => n.endsWith(".json"));
  expect(names.length).toBe(1);
  return join(dir, names[0]!);
}

beforeAll(() => {
  fx = makeSpanFixture("M_ste614");
  FE = fx.a;
  BE = fx.b;
  scratch = mkdtempSync(join(tmpdir(), "ste614-hooks-"));

  for (const root of [FE, BE]) {
    writeFileSync(join(root, "package.json"), '{"name":"fixture","version":"0.0.0","private":true}\n');
    git(root, "add", "package.json");
    git(root, "commit", "-q", "-m", "fixture: stack marker");
  }
  fx.activeFr(BE, "STE-1", "M_ste614");
  git(BE, "add", "specs/frs/STE-1.md");
  stage(BE, { "src/x.ts": "export const x = 1;\n", "src/x.test.ts": "// test\n" });
  stage(FE, { "README.md": "# fe\n" });

  UN = mkdtempSync(join(tmpdir(), "ste614-unmanaged-"));
  git(UN, "init", "-q", "-b", "main");
  writeFileSync(join(UN, "package.json"), '{"name":"u","version":"0.0.0","private":true}\n');
  stage(UN, { "src/x.ts": "export const x = 1;\n", "src/x.test.ts": "// t\n" });
});

afterAll(() => {
  fx?.cleanup();
  for (const d of [UN, scratch]) if (d) rmSync(d, { recursive: true, force: true });
});

// ===========================================================================
// AC-STE-614.1 — the transcript leg: a denied or failed call is not evidence.
// ===========================================================================

describe("AC-STE-614.1 — an `is_error: true` result is not evidence, for all three hooks", () => {
  for (const hook of ["gate", "tdd", "pr"] as const) {
    // BE is assigned in `beforeAll`, and a describe body runs at COLLECTION
    // time — building the command here would send the hooks `git -C  commit`,
    // an empty `-C` that resolves to no checkout at all.
    const target = (): string => (hook === "pr" ? prCreate : commit(BE));

    // ONE receipt, in the checkout THIS row's target names: the commit rows aim
    // at BE, and a bare `gh pr create` opens a request from FE, the session's
    // own checkout. STE-614 left the PR gate reading the transcript leg alone
    // because it could not yet name a repository; STE-615 gave it one, so it
    // grades a receipt per checkout exactly as the commit gates do, and FE's
    // receipt is what its target now needs.
    //
    // ONE and not both, deliberately: minting the other checkout's as well would
    // put two checkouts in a single vouching window, where only the first counts
    // (AC.16). That is the rule under test two describes down, not a fact about
    // `is_error`, so the fixture keeps the one receipt the target actually needs.
    //
    // Front-door-written, via `setReceipts` → `writeGateReceipt`: a hand-rolled
    // envelope here would keep these rows green after the front door broke.
    const stageReceipt = (): void =>
      setReceipts(hook === "pr" ? { fe: [SHORT_OF[hook]] } : { be: [SHORT_OF[hook]] });

    test(`${hook}: the only Skill call ended in an error → exit 2 saying so`, async () => {
      stageReceipt();
      const tr = transcript([
        BASH_LINE,
        skillUse("tu1", SKILL_OF[hook], PAST),
        toolResult("tu1", true),
      ]);
      const r = await run(hook, target(), tr);
      expect({ hook, code: r.exitCode }).toEqual({ hook, code: 2 });
      expect(r.stderr).toContain("Refusing:");
      expect(/error|denied|denial/i.test(r.stderr)).toBe(true);
    }, T);

    test(`${hook}: PERMIT SIBLING — the same transcript with is_error FALSE is evidence`, async () => {
      stageReceipt();
      const tr = transcript([BASH_LINE, ...okCall(hook)]);
      const r = await run(hook, target(), tr);
      expect({ hook, code: r.exitCode }).toEqual({ hook, code: 0 });
    }, T);

    test(`${hook}: PERMIT SIBLING — the same transcript with is_error ABSENT is evidence`, async () => {
      stageReceipt();
      const tr = transcript([BASH_LINE, skillUse("tu1", SKILL_OF[hook], PAST), toolResult("tu1", null)]);
      expect((await run(hook, target(), tr)).exitCode).toBe(0);
    }, T);

    test(`${hook}: PERMIT SIBLING — a tool_use with NO paired result is evidence`, async () => {
      stageReceipt();
      const tr = transcript([BASH_LINE, skillUse("tu1", SKILL_OF[hook], PAST)]);
      expect((await run(hook, target(), tr)).exitCode).toBe(0);
    }, T);

    test(`${hook}: PERMIT SIBLING — one denied call PLUS one successful call is evidence`, async () => {
      stageReceipt();
      const tr = transcript([
        skillUse("tu1", SKILL_OF[hook], PAST),
        toolResult("tu1", true),
        skillUse("tu2", SKILL_OF[hook], PAST),
        toolResult("tu2", false),
      ]);
      expect((await run(hook, target(), tr)).exitCode).toBe(0);
    }, T);
  }

  test("an UNPARSEABLE line is skipped, never thrown on: the other lines decide", async () => {
    setReceipts({ be: ["gate-check"] });
    const tr = transcript([BASH_LINE, "{not json at all", ...okCall("gate")]);
    const r = await run("gate", commit(BE), tr);
    expect({ code: r.exitCode, err: r.stderr }).toEqual({ code: 0, err: "" });

    const trMiss = transcript([BASH_LINE, "{not json at all"]);
    expect((await run("gate", commit(BE), trMiss)).exitCode).toBe(2);
  }, T);

  test("a JSON-escaped TEXT mention of the needles is not evidence", async () => {
    setReceipts({ be: ["gate-check"] });
    const tr = transcript([
      BASH_LINE,
      assistantText('I will use "name":"Skill" with "skill":"dev-process-toolkit:gate-check" shortly.'),
    ]);
    expect((await run("gate", commit(BE), tr)).exitCode).toBe(2);
  }, T);

  test("the plain-miss refusal text is byte-identical to HEAD", async () => {
    const r = await run("gate", commit(UN), noEvidence());
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain(
      "required dev-process-toolkit:gate-check Skill tool_use not found in current session.",
    );
  }, T);
});

// ===========================================================================
// AC-STE-614.2 — the harness-absent case stays fail-open, by decision.
// ===========================================================================

describe("AC-STE-614.2 — the ONE fail-open leg", () => {
  for (const hook of ["gate", "tdd", "pr"] as const) {
    // Built INSIDE each test: a describe body runs at collection time, when BE
    // is still "". The AC's distinguishing words are "on a toolkit-managed
    // target with no receipt", so the command has to name one.
    const target = (): string => (hook === "pr" ? prCreate : commit(BE));

    test(`${hook}: EMPTY stdin → exit 0, even on a managed target with no receipt`, async () => {
      setReceipts({});
      const r = await run(hook, target(), noEvidence(), { stdin: "" });
      expect({ hook, code: r.exitCode }).toEqual({ hook, code: 0 });
    }, T);

    test(`${hook}: UNPARSEABLE stdin → exit 0`, async () => {
      setReceipts({});
      const r = await run(hook, target(), noEvidence(), { stdin: "{oh no" });
      expect({ hook, code: r.exitCode }).toEqual({ hook, code: 0 });
    }, T);

    test(`${hook}: a transcript_path naming a file that does not exist → exit 0`, async () => {
      setReceipts({});
      const r = await run(hook, target(), noEvidence(), {
        transcriptPath: join(scratch, "no-such-transcript.jsonl"),
      });
      expect({ hook, code: r.exitCode }).toEqual({ hook, code: 0 });
    }, T);
  }
});

// ===========================================================================
// AC-STE-614.5 / .6 — the cross-repo leak, and the commit that must still pass.
// ===========================================================================

describe("AC-STE-614.5 — FE evidence does not let a BE commit through", () => {
  test("every recognised shape aimed at BE exits 2, naming BE and its exact remedy", async () => {
    setReceipts({ fe: ["gate-check"] });
    const tr = okTranscript("gate");
    for (const cmd of beShapes()) {
      const r = await run("gate", cmd, tr);
      expect({ cmd, code: r.exitCode }).toEqual({ cmd, code: 2 });
      expect({ cmd, names: r.stderr.includes(realpathSync(BE)) || r.stderr.includes(BE) })
        .toEqual({ cmd, names: true });
      expect({ cmd, remedy: r.stderr.includes("/dev-process-toolkit:gate-check") })
        .toEqual({ cmd, remedy: true });
      // The remedy never hands the agent the minting command.
      expect({ cmd, leak: r.stderr.includes("gate_receipt.ts") }).toEqual({ cmd, leak: false });
    }
  }, T);

  test("the /tdd hook refuses the same shapes with FE-only /tdd evidence", async () => {
    setReceipts({ fe: ["tdd"] });
    const tr = okTranscript("tdd");
    for (const cmd of beShapes()) {
      const r = await run("tdd", cmd, tr);
      expect({ cmd, code: r.exitCode }).toEqual({ cmd, code: 2 });
      expect({ cmd, leak: r.stderr.includes("gate_receipt.ts") }).toEqual({ cmd, leak: false });
    }
  }, T);
});

describe("AC-STE-614.6 — the right commit is permitted, and the reverse leak is closed", () => {
  test("with a BE receipt written in its own vouching window, every BE shape exits 0 silently", async () => {
    clearReceipts(FE, SID);
    clearReceipts(BE, SID);
    forgetAnnouncements();
    const feLine = mintAnnounced(FE, "gate-check");
    const mid = new Date().toISOString();
    const beLine = mintAnnounced(BE, "gate-check");
    const tr = transcript(
      [
        BASH_LINE,
        ...okCall("gate", PAST, "tu1"),
        ...announcementRecords([feLine], "mint-fe"),
        ...okCall("gate", mid, "tu2"),
        ...announcementRecords([beLine], "mint-be"),
      ],
      { announce: false },
    );
    for (const cmd of beShapes()) {
      const r = await run("gate", cmd, tr);
      expect({ cmd, code: r.exitCode, err: r.stderr }).toEqual({ cmd, code: 0, err: "" });
    }
  }, T);

  test("an FE commit with an FE receipt exits 0 with empty stderr", async () => {
    setReceipts({ fe: ["gate-check"] });
    const r = await run("gate", commit(FE), okTranscript("gate"));
    expect({ code: r.exitCode, err: r.stderr }).toEqual({ code: 0, err: "" });
  }, T);

  test("a session holding ONLY a BE receipt is refused on an FE commit, naming FE", async () => {
    setReceipts({ be: ["gate-check"] });
    const r = await run("gate", commit(FE), okTranscript("gate"));
    expect(r.exitCode).toBe(2);
    expect(r.stderr.includes(realpathSync(FE)) || r.stderr.includes(FE)).toBe(true);
  }, T);
});

// ===========================================================================
// AC-STE-614.7 — receipt defects refuse by name, each with a permit sibling.
// ===========================================================================

describe("AC-STE-614.7 — each receipt defect refuses by name", () => {
  async function beCommit(tr?: string): Promise<Run> {
    return run("gate", commit(BE), tr ?? okTranscript("gate"));
  }

  test("PERMIT BASELINE — an intact BE gate-check receipt permits the commit", async () => {
    setReceipts({ be: ["gate-check"] });
    const r = await beCommit();
    expect({ code: r.exitCode, err: r.stderr }).toEqual({ code: 0, err: "" });
  }, T);

  test("NO gate receipt for the skill at all", async () => {
    setReceipts({});
    const r = await beCommit();
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain(receiptsDirOf(BE, SID));
  }, T);

  test("an UNREADABLE receipt file (mode 000) is named, with the skipped count", async () => {
    setReceipts({ be: ["gate-check"] });
    const file = onlyReceiptFile(BE);
    chmodSync(file, 0o000);
    try {
      const r = await beCommit();
      expect(r.exitCode).toBe(2);
      expect(r.stderr).toContain(receiptsDirOf(BE, SID));
      expect(/skip/i.test(r.stderr)).toBe(true);
      expect(r.stderr).toContain("1");
    } finally {
      chmodSync(file, 0o600);
    }
  }, T);

  test("a MALFORMED receipt file", async () => {
    setReceipts({});
    mkdirSync(receiptsDirOf(BE, SID), { recursive: true });
    writeFileSync(join(receiptsDirOf(BE, SID), "bad.json"), "{ not json\n");
    const r = await beCommit();
    expect(r.exitCode).toBe(2);
    expect(/skip/i.test(r.stderr)).toBe(true);
  }, T);

  test("a receipt whose envelope version is `v: 2`", async () => {
    setReceipts({ be: ["gate-check"] });
    const file = onlyReceiptFile(BE);
    const body = JSON.parse(readFileSync(file, "utf-8"));
    body.v = 2;
    writeFileSync(file, JSON.stringify(body) + "\n");
    const r = await beCommit();
    expect(r.exitCode).toBe(2);
  }, T);

  test("a gate receipt whose `subject` names ANOTHER skill", async () => {
    setReceipts({ be: ["tdd"] });
    const r = await beCommit();
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain(receiptsDirOf(BE, SID));
  }, T);

  test("a receipt written under ANOTHER session's directory", async () => {
    setReceipts({});
    writeGateReceipt(BE, "gate-check", "othersession");
    const r = await beCommit();
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain(receiptsDirOf(BE, SID));
  }, T);

  test("a FOREIGN receipt: FE's file COPIED into BE's store (the relocated case)", async () => {
    setReceipts({ fe: ["gate-check"] });
    const src = onlyReceiptFile(FE);
    mkdirSync(receiptsDirOf(BE, SID), { recursive: true });
    copyFileSync(src, join(receiptsDirOf(BE, SID), "copied.json"));
    const r = await beCommit();
    expect(r.exitCode).toBe(2);
    expect(r.stderr.includes(realpathSync(BE)) || r.stderr.includes(BE)).toBe(true);
  }, T);

  test("PERMIT — a checkout reached through a SYMLINK is the same checkout (realpaths equal)", async () => {
    setReceipts({ be: ["gate-check"] });
    const link = join(scratch, "be-link");
    if (!existsSync(link)) symlinkSync(BE, link);
    const r = await run("gate", `git -C ${link} commit -m x`, okTranscript("gate"));
    expect({ code: r.exitCode, err: r.stderr }).toEqual({ code: 0, err: "" });
  }, T);

  test("a payload WITHOUT `session_id` is refused by name on a managed target", async () => {
    setReceipts({ be: ["gate-check"] });
    const r = await run("gate", commit(BE), okTranscript("gate"), { sessionId: null });
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("session_id");
  }, T);
});

// ===========================================================================
// AC-STE-614.8 — an unmanaged target is decided by the transcript leg alone.
// ===========================================================================

describe("AC-STE-614.8 — unmanaged targets keep today's rule, minus NF-3", () => {
  test("evidence present → exit 0 with empty stderr, with NO receipt anywhere", async () => {
    setReceipts({});
    const r = await run("gate", commit(UN), okTranscript("gate"));
    expect({ code: r.exitCode, err: r.stderr }).toEqual({ code: 0, err: "" });
    expect(existsSync(join(UN, ".dpt"))).toBe(false);
  }, T);

  test("evidence absent → exit 2", async () => {
    setReceipts({});
    expect((await run("gate", commit(UN), noEvidence())).exitCode).toBe(2);
  }, T);

  test("the managed predicate has ONE implementation: no literal re-declared here", () => {
    const frontDoor = readFileSync(
      join(PLUGIN_ROOT, "adapters", "_shared", "src", "gate_receipt.ts"),
      "utf-8",
    );
    expect(frontDoor).toContain("isToolkitManaged");
    expect(frontDoor).toContain("toolkit_managed");
    const sessionLib = readFileSync(
      join(PLUGIN_ROOT, "templates", "hooks", "_lib", "session.ts"),
      "utf-8",
    );
    for (const body of [frontDoor, sessionLib]) {
      expect(body).not.toContain("## Task Tracking");
      expect(body).not.toContain("generated by /dev-process-toolkit:setup");
    }
  });
});

// ===========================================================================
// AC-STE-614.9 — several checkouts, and unresolved targets.
// ===========================================================================

describe("AC-STE-614.9 — several checkouts in one command", () => {
  const both = () => `git -C ${FE} commit -m x && git -C ${BE} commit -m x`;

  test("only FE's receipt → exit 2, naming BE", async () => {
    setReceipts({ fe: ["gate-check"] });
    const r = await run("gate", both(), okTranscript("gate"));
    expect(r.exitCode).toBe(2);
    expect(r.stderr.includes(realpathSync(BE)) || r.stderr.includes(BE)).toBe(true);
  }, T);

  test("both receipts → exit 0", async () => {
    clearReceipts(FE, SID);
    clearReceipts(BE, SID);
    forgetAnnouncements();
    const feLine = mintAnnounced(FE, "gate-check");
    const mid = new Date().toISOString();
    const beLine = mintAnnounced(BE, "gate-check");
    const tr = transcript(
      [
        ...okCall("gate", PAST, "tu1"),
        ...announcementRecords([feLine], "mint-fe"),
        ...okCall("gate", mid, "tu2"),
        ...announcementRecords([beLine], "mint-be"),
      ],
      { announce: false },
    );
    const r = await run("gate", both(), tr);
    expect({ code: r.exitCode, err: r.stderr }).toEqual({ code: 0, err: "" });
  }, T);
});

describe("AC-STE-614.9 — an unresolved target exits 1 with a Reminder, never a silent allow", () => {
  const UNRESOLVED = 'R=$(mktemp -d); git -C "$R" commit -m x';

  test("with evidence for the session's own checkout → exit 1 and a Reminder naming $R", async () => {
    setReceipts({ fe: ["gate-check"] });
    const r = await run("gate", UNRESOLVED, okTranscript("gate"));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("Reminder:");
    expect(r.stderr).toContain("$R");
  }, T);

  test("the same command WITHOUT that evidence → exit 2", async () => {
    setReceipts({});
    expect((await run("gate", UNRESOLVED, noEvidence())).exitCode).toBe(2);
  }, T);

  test("the candidate leg, both directions: FE-only evidence refuses, a BE receipt reminds", async () => {
    const wrapped = [
      [`sudo git -C ${BE} commit -m x`, "sudo"],
      [`cd ${BE} && xargs git commit -m x`, "xargs"],
    ] as const;

    setReceipts({ fe: ["gate-check"] });
    for (const [cmd] of wrapped) {
      const r = await run("gate", cmd, okTranscript("gate"));
      expect({ cmd, code: r.exitCode }).toEqual({ cmd, code: 2 });
      expect({ cmd, names: r.stderr.includes(realpathSync(BE)) || r.stderr.includes(BE) })
        .toEqual({ cmd, names: true });
    }

    clearReceipts(FE, SID);
    clearReceipts(BE, SID);
    forgetAnnouncements();
    const feLine = mintAnnounced(FE, "gate-check");
    const mid = new Date().toISOString();
    const beLine = mintAnnounced(BE, "gate-check");
    const tr = transcript(
      [
        ...okCall("gate", PAST, "tu1"),
        ...announcementRecords([feLine], "mint-fe"),
        ...okCall("gate", mid, "tu2"),
        ...announcementRecords([beLine], "mint-be"),
      ],
      { announce: false },
    );
    for (const [cmd, wrapper] of wrapped) {
      const r = await run("gate", cmd, tr);
      expect({ cmd, code: r.exitCode }).toEqual({ cmd, code: 1 });
      expect({ cmd, names: r.stderr.includes("Reminder:") && r.stderr.includes(wrapper) })
        .toEqual({ cmd, names: true });
    }
  }, T);

  test("a session whose OWN directory lies in no checkout still prints the Reminder", async () => {
    setReceipts({});
    const loose = mkdtempSync(join(tmpdir(), "ste614-loose-"));
    try {
      const r = await run("gate", UNRESOLVED, okTranscript("gate"), { cwd: loose });
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toContain("Reminder:");
    } finally {
      rmSync(loose, { recursive: true, force: true });
    }
  }, T);
});

// ===========================================================================
// AC-STE-614.10 — the red-before proof names its repository (NF-2).
// ===========================================================================

describe("AC-STE-614.10 — `repo=` scopes the red-before proof", () => {
  const PATHS = "specs/frs/STE-1.md src/x.ts src/x.test.ts";
  const proof = (repo: string | null, paths = PATHS): string =>
    transcript([
      BASH_LINE,
      assistantText(
        `dpt-red-before-proof:${repo === null ? "" : ` repo=${repo}`} ${paths}`,
      ),
    ]);

  test("a proof naming BE satisfies a BE commit", async () => {
    setReceipts({});
    const r = await run("tdd", commit(BE), proof(BE));
    expect({ code: r.exitCode, err: r.stderr }).toEqual({ code: 0, err: "" });
  }, T);

  test("the SAME proof naming FE does NOT satisfy the BE commit", async () => {
    setReceipts({});
    const r = await run("tdd", commit(BE), proof(FE));
    expect(r.exitCode).toBe(2);
  }, T);

  test("a proof with no `repo=` satisfies an FE commit and not a BE commit", async () => {
    setReceipts({});
    stage(FE, { "src/y.ts": "export const y = 1;\n", "src/y.test.ts": "// t\n" });
    try {
      const fe = await run("tdd", commit(FE), proof(null, "src/y.ts src/y.test.ts"));
      expect({ code: fe.exitCode, err: fe.stderr }).toEqual({ code: 0, err: "" });
      const be = await run("tdd", commit(BE), proof(null));
      expect(be.exitCode).toBe(2);
    } finally {
      git(FE, "reset", "-q", "--", "src/y.ts", "src/y.test.ts");
    }
  }, T);

  test("a relative, unexpanded, or checkout-less `repo=` covers nothing", async () => {
    setReceipts({});
    const loose = mkdtempSync(join(tmpdir(), "ste614-norepo-"));
    try {
      for (const repo of ["./b", "$X", loose]) {
        const r = await run("tdd", commit(BE), proof(repo));
        expect({ repo, code: r.exitCode }).toEqual({ repo, code: 2 });
      }
    } finally {
      rmSync(loose, { recursive: true, force: true });
    }
  }, T);

  test("a `repo=` reaching BE through a SYMLINK covers BE", async () => {
    setReceipts({});
    const link = join(scratch, "be-proof-link");
    if (!existsSync(link)) symlinkSync(BE, link);
    const r = await run("tdd", commit(BE), proof(link));
    expect({ code: r.exitCode, err: r.stderr }).toEqual({ code: 0, err: "" });
  }, T);

  test("the BE refusal prints the exact form with BE's root, and its own record never satisfies it", async () => {
    setReceipts({});
    const r = await run("tdd", commit(BE), noEvidence());
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("dpt-red-before-proof: repo=");
    expect(r.stderr.includes(realpathSync(BE)) || r.stderr.includes(BE)).toBe(true);
    expect(r.stderr).toContain("<paths>");

    // The harness records hook stderr TWICE ON ONE LINE (see `denialRecord` in
    // tests/hook-session-lib.test.ts) — which is the shape the bounded-claim
    // rule exists for, since a claim unbounded from the first marker would
    // swallow the second copy. Two SEPARATE lines would not exercise it, so
    // the one-line double copy is recorded first, then the two-line form.
    const record = transcript([
      BASH_LINE,
      assistantText(`${r.stderr}\n${r.stderr}`),
      assistantText(r.stderr),
    ]);
    expect((await run("tdd", commit(BE), record)).exitCode).toBe(2);
  }, T);
});

// ===========================================================================
// AC-STE-614.16 — vouching: one skill run vouches for one checkout.
// ===========================================================================

describe("AC-STE-614.16 — a receipt counts only when a Skill call vouches for it", () => {
  test("one call, FE minted first: the FE commit passes and the BE commit is refused as not vouched", async () => {
    clearReceipts(FE, SID);
    clearReceipts(BE, SID);
    writeGateReceipt(FE, "gate-check", SID);
    writeGateReceipt(BE, "gate-check", SID); // by hand, inside the SAME window
    const tr = transcript([BASH_LINE, ...okCall("gate", PAST, "tu1")]);

    const fe = await run("gate", commit(FE), tr);
    expect({ code: fe.exitCode, err: fe.stderr }).toEqual({ code: 0, err: "" });

    const be = await run("gate", commit(BE), tr);
    expect(be.exitCode).toBe(2);
    expect(be.stderr.includes(realpathSync(BE)) || be.stderr.includes(BE)).toBe(true);
  }, T);

  test("PERMIT SIBLING — a SECOND Skill call opens a window the BE receipt falls in", async () => {
    clearReceipts(FE, SID);
    clearReceipts(BE, SID);
    forgetAnnouncements();
    const feLine = mintAnnounced(FE, "gate-check");
    const mid = new Date().toISOString();
    const beLine = mintAnnounced(BE, "gate-check");
    const tr = transcript(
      [
        BASH_LINE,
        ...okCall("gate", PAST, "tu1"),
        ...announcementRecords([feLine], "mint-fe"),
        ...okCall("gate", mid, "tu2"),
        ...announcementRecords([beLine], "mint-be"),
      ],
      { announce: false },
    );
    const r = await run("gate", commit(BE), tr);
    expect({ code: r.exitCode, err: r.stderr }).toEqual({ code: 0, err: "" });
  }, T);

  // A receipt minted BEFORE any gate run belongs to no window. The ordering key
  // is the announcement's place in the transcript, not the `createdAt` inside
  // the file: that field is written by whoever writes the file, and a forged
  // receipt stamped one millisecond early took the window before this landed.
  test("a receipt announced BEFORE every Skill call is not vouched for", async () => {
    forgetAnnouncements();
    clearReceipts(FE, SID);
    clearReceipts(BE, SID);
    const beLine = mintAnnounced(BE, "gate-check");
    const tr = transcript(
      [BASH_LINE, ...announcementRecords([beLine], "mint-early"), ...okCall("gate", FUTURE, "tu1")],
      { announce: false },
    );
    expect((await run("gate", commit(BE), tr)).exitCode).toBe(2);
  }, T);

  // The forgery this rule closes, measured on the shipped bytes before the fix:
  // a hand-written receipt naming an ungated checkout, never announced, was
  // permitted. A file is not evidence; the gate run that announced it is.
  test("a hand-written receipt with no announcement is not evidence, however it is stamped", async () => {
    forgetAnnouncements();
    clearReceipts(FE, SID);
    clearReceipts(BE, SID);
    const feLine = mintAnnounced(FE, "gate-check");
    mkdirSync(receiptsDirOf(BE, SID), { recursive: true });
    writeFileSync(
      join(receiptsDirOf(BE, SID), "forged.json"),
      JSON.stringify({
        v: 1,
        kind: "gate",
        sessionId: SID,
        root: realpathSync(BE),
        adapter: null,
        container: null,
        subject: "dev-process-toolkit:gate-check",
        decision: "ran",
        evidence: { head: null },
        // Stamped EARLIER than the genuine one, which is what used to win.
        createdAt: new Date(Date.now() - 60_000).toISOString(),
      }) + "\n",
    );
    const tr = transcript(
      [BASH_LINE, ...okCall("gate", PAST, "tu1"), ...announcementRecords([feLine], "mint-fe")],
      { announce: false },
    );
    const forged = await run("gate", commit(BE), tr);
    expect(forged.exitCode).toBe(2);
    // PERMIT SIBLING — the same session, the same window, the announced FE receipt.
    expect((await run("gate", commit(FE), tr)).exitCode).toBe(0);
  }, T);

  test("a Skill line with NO parseable timestamp vouches for nothing and never throws", async () => {
    setReceipts({ be: ["gate-check"] });
    const noTs = transcript([BASH_LINE, skillUse("tu1", SKILL_OF.gate, null), toolResult("tu1", false)]);
    const a = await run("gate", commit(BE), noTs);
    expect(a.exitCode).toBe(2);
    expect(a.stderr).not.toContain("Error:");

    const badTs = transcript([
      BASH_LINE,
      skillUse("tu1", SKILL_OF.gate, "not-a-timestamp"),
      toolResult("tu1", false),
    ]);
    const b = await run("gate", commit(BE), badTs);
    expect(b.exitCode).toBe(2);
    expect(b.stderr).not.toContain("Error:");
  }, T);
});

// ===========================================================================
// AC-STE-614.17 — a linked worktree is its own checkout.
// ===========================================================================

describe("AC-STE-614.17 — relocated checkouts", () => {
  let wt = "";

  beforeAll(() => {
    wt = join(scratch, "fe-worktree");
    git(FE, "worktree", "add", "-q", "-b", "wt614", wt);
    writeManagedClaudeMd(wt);
  });

  test("an FE-main receipt does NOT satisfy a commit in the linked worktree", async () => {
    setReceipts({ fe: ["gate-check"] });
    const r = await run("gate", `git -C ${wt} commit -m x`, okTranscript("gate"));
    expect(r.exitCode).toBe(2);
    expect(r.stderr.includes(realpathSync(wt)) || r.stderr.includes(wt)).toBe(true);
  }, T);

  test("PERMIT SIBLING — a receipt written FOR the worktree does", async () => {
    clearReceipts(FE, SID);
    clearReceipts(BE, SID);
    clearReceipts(wt, SID);
    writeGateReceipt(wt, "gate-check", SID);
    const r = await run("gate", `git -C ${wt} commit -m x`, okTranscript("gate"));
    expect({ code: r.exitCode, err: r.stderr }).toEqual({ code: 0, err: "" });
  }, T);

  test("the reverse direction holds: a worktree receipt does not satisfy an FE-main commit", async () => {
    clearReceipts(FE, SID);
    clearReceipts(wt, SID);
    writeGateReceipt(wt, "gate-check", SID);
    const r = await run("gate", commit(FE), okTranscript("gate"));
    expect(r.exitCode).toBe(2);
  }, T);

  test("removing the worktree takes its receipts with it and changes nothing under FE-main", async () => {
    clearReceipts(FE, SID);
    writeGateReceipt(FE, "gate-check", SID);
    writeGateReceipt(wt, "gate-check", SID);
    const feBefore = readdirSync(receiptsDirOf(FE, SID)).sort();
    git(FE, "worktree", "remove", "--force", wt);
    expect(existsSync(receiptsDirOf(wt, SID))).toBe(false);
    expect(readdirSync(receiptsDirOf(FE, SID)).sort()).toEqual(feBefore);
  }, T);
});

// ---------------------------------------------------------------------------
// AC-STE-614.7, review round: "refuses BY NAME" is a claim about the prose, so
// grade the prose. Before this, every state but `session-id-missing` could have
// collapsed onto one sentence and every AC.7 clause would still have passed —
// they asserted exit 2 plus a path that the generic sentence also carries.
// ---------------------------------------------------------------------------
describe("AC-STE-614.7 review — each receipt state refuses with its OWN sentence", () => {
  const WORDS = {
    subject: "dev-process-toolkit:gate-check",
    root: "/s/be",
    where: "/s/be/.dpt/ledger/receipts/sess-1",
    skipped: "",
    claimant: "/s/fe",
    named: "dev-process-toolkit:tdd",
  };
  const STATES = ["session-id-missing", "store-unreadable", "no-receipt", "wrong-subject", "foreign-root", "not-vouched"] as const;

  test("the six states render six DISTINCT sentences", async () => {
    const { MISS_PROSE_FOR_TEST } = (await import("../adapters/_shared/src/gate_receipt")) as unknown as {
      MISS_PROSE_FOR_TEST: () => Record<string, (w: typeof WORDS) => string>;
    };
    const prose = MISS_PROSE_FOR_TEST();
    const rendered = STATES.map((s) => prose[s]!(WORDS));
    expect(new Set(rendered).size).toBe(STATES.length);
    for (const [i, text] of rendered.entries()) expect({ state: STATES[i], empty: text.trim() === "" }).toEqual({ state: STATES[i], empty: false });
  });

  test("each sentence NAMES its own defect, not merely 'no receipt'", async () => {
    const { MISS_PROSE_FOR_TEST } = (await import("../adapters/_shared/src/gate_receipt")) as unknown as {
      MISS_PROSE_FOR_TEST: () => Record<string, (w: typeof WORDS) => string>;
    };
    const prose = MISS_PROSE_FOR_TEST();
    // `named` carries a DIFFERENT fact per state — the other skill for
    // wrong-subject, the other checkout for foreign-root — so each state is
    // rendered with the words it is actually handed at run time.
    const wordsFor = (state: (typeof STATES)[number]): typeof WORDS =>
      state === "foreign-root" ? { ...WORDS, named: "/s/fe" } : WORDS;
    // Each state's sentence must carry a word that belongs to THAT defect.
    const needles: Record<(typeof STATES)[number], RegExp> = {
      "session-id-missing": /session_id/i,
      "store-unreadable": /unreadable|could not be read/i,
      "no-receipt": /no .*receipt|holds no/i,
      "wrong-subject": /another skill|dev-process-toolkit:tdd/i,
      "foreign-root": /written for \/s\/fe, not for/i,
      "not-vouched": /vouch/i,
    };
    for (const state of STATES) {
      const text = prose[state]!(wordsFor(state));
      expect({ state, names: needles[state].test(text) }).toEqual({ state, names: true });
    }
  });
});

// ---------------------------------------------------------------------------
// M_85e846 review round: the FIXTURE'S OWN SHAPE is load-bearing.
//
// `announcementRecords` is how this file and five sibling suites tell the guard
// "the front door announced these receipts". The front door prints EXACTLY ONE
// `dpt-receipt:` line per run — `gate_receipt.ts` announces from a single
// `console.log` — so a transcript result carrying two announcements is a shape
// no real session can produce, and the one-announcement-per-result rule that
// closes the replay leak refuses it, correctly.
//
// The helper once crammed every line into ONE result via `lines.join("\n")`.
// Under that unfaithful shape thirteen PERMIT clauses went red against correct
// code, and the obvious-but-wrong reading was "the new rule is too strict".
// Without this clause an edit restoring the crammed shape re-defuses the rule
// in silence: the PERMIT clauses red again and the next reader files the guard
// as the defect instead of the fixture.
// ---------------------------------------------------------------------------
describe("M_85e846 review — the announcement fixture emits ONE pair per line", () => {
  test("N lines → N tool_use/tool_result `${id}-${n}` pairs, and no result carries two announcements", () => {
    const LINES = [
      "dpt-receipt: /a/.dpt/ledger/receipts/s/one.json a1",
      "dpt-receipt: /b/.dpt/ledger/receipts/s/two.json b2",
      "dpt-receipt: /c/.dpt/ledger/receipts/s/three.json c3",
    ];
    interface Rec { message: { content: Array<Record<string, unknown>> } }
    const parsed = (n: number): Rec[] =>
      announcementRecords(LINES.slice(0, n), "pin").map((l) => JSON.parse(l) as Rec);

    // Nothing announced announces nothing.
    expect(announcementRecords([], "pin")).toEqual([]);

    for (const n of [1, 2, 3]) {
      const recs = parsed(n);
      // One PAIR per line — not one call with an n-line result.
      expect({ n, records: recs.length }).toEqual({ n, records: n * 2 });

      const results = recs.map((r) => r.message.content[0]!).filter((c) => c.type === "tool_result");
      expect({ n, results: results.length }).toEqual({ n, results: n });

      for (const [i, line] of LINES.slice(0, n).entries()) {
        const use = recs[i * 2]!.message.content[0]!;
        const res = recs[i * 2 + 1]!.message.content[0]!;
        expect({
          useType: use.type, name: use.name, useId: use.id,
          resType: res.type, resId: res.tool_use_id, isError: res.is_error, content: res.content,
        }).toEqual({
          useType: "tool_use", name: "Bash", useId: `pin-${i}`,
          resType: "tool_result", resId: `pin-${i}`, isError: false, content: line,
        });
      }

      // The cramming check, stated as its own fact: every result holds exactly
      // ONE `dpt-receipt:` line. `lines.join("\n")` fails this at n >= 2.
      for (const res of results) {
        const carried = String(res.content).split("\n").filter((l) => l.startsWith("dpt-receipt: "));
        expect({ n, announcementsInOneResult: carried.length }).toEqual({ n, announcementsInOneResult: 1 });
      }
    }
  });
});
