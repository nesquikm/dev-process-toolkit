// STE-650 (M_163656) — the commit and PR gates name a lagging transcript.
//
// The incident (M1 carry-over item 3): pre-pr-spec-review refused `gh pr
// create` twice with the `outside-window` sentence ("it was written before the
// first … Skill call in this session") although the Skill call and a receipt
// run preceded it. The receipt run's tool_result line was not yet on disk —
// the same flush class as the tracker gate's B1 — and retrying unchanged
// passed. The refusal named the wrong cause.
//
// The shape that reproduces it: an EARLIER announced receipt that genuinely
// predates the Skill call (so `announced.length > 0` and it sits before the
// first window), plus the receipt run that vouches — its tool_use recorded,
// its tool_result not flushed. HEAD reads the old announcement first and says
// `outside-window`; the vouching run is never waited for.
//
// Every leg drives the SHIPPED hook module (both gates, one table) over a real
// transcript file and a real, front-door-written receipt. The gated call's own
// tool_use line (the `git commit` / `gh pr create`) is absent in every leg:
// Claude Code writes it only after PreToolUse returns (AC-STE-650.15).
//
//   AC-STE-650.9   the receipt's tool_result lands during the wait → exit 0
//   AC-STE-650.10  it never lands → exit 2, "has not caught up", retry
//                  unchanged, never the outside-window sentence
//   AC-STE-650.11  a receipt that genuinely predates the window, result on
//                  disk → the HEAD outside-window refusal, and no wait
//
// Spawns are SERIAL (one hook at a time): timing is part of AC.11's claim.
//
// STE-655 (M_a85e46) adds the tdd commit gate as a third GATES row, so every
// leg above runs for it too (AC-STE-655.2 .. .6); see the STE-655 section below.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { appendFileSync, chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";

import { mutateInRegion } from "./_sited-mutation";

import {
  PLUGIN_ROOT,
  forgetAnnouncements,
  mintedAnnouncements,
  writeGateReceipt,
  writeManagedClaudeMd,
} from "./_gate_receipt_fixture";

const SID = "s650-gate-lag";
const HOOK_DIR = join(PLUGIN_ROOT, "templates", "hooks", "_lib", "hooks");
/** The tracker gate's bound (GATED_LINE_WAIT_MS) — the FR's Notes: "the wait reuses the tracker gate's bound". */
const WAIT_BOUND_MS = 2000;

interface Gate {
  name: string;
  module: string;
  skill: string;
  /** The front door's skill argument (`gate-check`, `spec-review`, `tdd`). */
  frontDoorSkill: string;
  command: (repo: string) => string;
  /** STE-655 — makes the checkout one this gate grades (the tdd gate needs a staged source file and its test). */
  prepare?: (repo: string) => Promise<void>;
}

/** The staged set that raises the /tdd requirement (the tdd suite's `managedTddRepo`). */
const TDD_STAGED: Record<string, string> = {
  "package.json": '{"name":"fixture","version":"0.0.0","private":true}\n',
  "specs/frs/STE-1.md": "---\ntitle: STE-1\nstatus: active\n---\n\n# STE-1\n",
  "src/x.ts": "export const x = 1;\n",
  "src/x.test.ts": "// test\n",
};

async function stageTddChange(repo: string): Promise<void> {
  for (const [rel, body] of Object.entries(TDD_STAGED)) {
    const full = join(repo, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, body);
    await Bun.spawn(["git", "-C", repo, "add", rel], { stdout: "pipe", stderr: "pipe" }).exited;
  }
}

const GATES: readonly Gate[] = [
  {
    name: "pre-commit-gate-check",
    module: join(HOOK_DIR, "pre-commit-gate-check.ts"),
    skill: "dev-process-toolkit:gate-check",
    frontDoorSkill: "gate-check",
    command: (repo) => `git -C ${repo} commit -m x`,
  },
  {
    name: "pre-pr-spec-review",
    module: join(HOOK_DIR, "pre-pr-spec-review.ts"),
    skill: "dev-process-toolkit:spec-review",
    frontDoorSkill: "spec-review",
    command: () => "gh pr create --title foo --body bar",
  },
  // STE-655 AC.6 — the tdd commit gate rides the same table: every leg below
  // runs for it, including the FO-1 and never-lands legs.
  {
    name: "pre-commit-tdd-orchestrator",
    module: join(HOOK_DIR, "pre-commit-tdd-orchestrator.ts"),
    skill: "dev-process-toolkit:tdd",
    frontDoorSkill: "tdd",
    command: (repo) => `git -C ${repo} commit -m x`,
    prepare: stageTddChange,
  },
];

/** The `outside-window` sentence (gate_receipt.ts MISS_PROSE), as the r3 suite greps it. */
const PREDATES = /written before the first/i;
/** The lag, named: the transcript has not caught up. */
const NOT_CAUGHT_UP = /has not (yet )?caught up/i;
/** …and the remedy is to retry unchanged. */
const RETRY_UNCHANGED = /retry[^.\n]*unchanged|unchanged[^.\n]*retry/i;

let scratch = "";
let seq = 0;

beforeAll(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), "ste650-gate-lag-")));
});
afterAll(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

/** A toolkit-managed `git init` checkout, with no receipts yet (and, for a gate that needs one, its staged change). */
async function managedRepo(label: string, gate?: Gate): Promise<string> {
  seq += 1;
  const dir = join(scratch, `${label}-${seq}`);
  mkdirSync(dir, { recursive: true });
  await Bun.spawn(["git", "init", "-q", dir], { stdout: "pipe", stderr: "pipe" }).exited;
  writeManagedClaudeMd(dir);
  if (gate?.prepare) await gate.prepare(dir);
  return dir;
}

/** Mint one receipt through the shipped front door; return its `dpt-receipt:` line. */
function mint(repo: string, gate: Gate): string {
  forgetAnnouncements();
  writeGateReceipt(repo, gate.frontDoorSkill, SID);
  const line = mintedAnnouncements().at(-1);
  if (!line) throw new Error("fixture: the front door announced nothing");
  return line;
}

const HOUR_AGO = () => new Date(Date.now() - 3_600_000).toISOString();
const MINT_COMMAND = (gate: Gate) =>
  `bun run "\${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/gate_receipt.ts" ${gate.frontDoorSkill} .`;

/** The Skill call that opens the vouching window (timestamped, so it opens one). */
function skillCall(gate: Gate, at: string): string {
  return JSON.stringify({
    type: "assistant",
    timestamp: at,
    message: { content: [{ type: "tool_use", id: `tu-skill-${gate.frontDoorSkill}`, name: "Skill", input: { skill: gate.skill } }] },
  });
}

/** A receipt run's Bash tool_use — the half Claude Code has flushed. */
function mintCall(gate: Gate, id: string, at: string): string {
  return JSON.stringify({
    type: "assistant",
    timestamp: at,
    message: { content: [{ type: "tool_use", id, name: "Bash", input: { command: MINT_COMMAND(gate) } }] },
  });
}

/** The receipt run's tool_result — the half that lags. */
function mintResult(id: string, announcement: string): string {
  return JSON.stringify({
    type: "user",
    timestamp: new Date().toISOString(),
    message: { content: [{ type: "tool_result", tool_use_id: id, is_error: false, content: `gate=green\n${announcement}` }] },
  });
}

interface Run {
  exitCode: number;
  stdout: string;
  stderr: string;
  ms: number;
}

/**
 * Spawn `gate`'s module over `transcript`; when `append` is given, append those
 * lines to the transcript `afterMs` after the spawn (Claude Code's flush), or
 * run its `act` instead (the transcript vanishing mid-wait).
 */
async function runGate(
  gate: Gate,
  repo: string,
  transcript: string,
  append: { lines?: string[]; act?: () => void; afterMs: number } | null = null,
  pluginRoot: string = PLUGIN_ROOT,
): Promise<Run> {
  const stdin = JSON.stringify({
    session_id: SID,
    transcript_path: transcript,
    cwd: repo,
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command: gate.command(repo) },
    tool_use_id: "toolu_650_gated_never_flushed",
  });
  const t0 = performance.now();
  const module = pluginRoot === PLUGIN_ROOT ? gate.module : join(pluginRoot, relative(PLUGIN_ROOT, gate.module));
  const proc = Bun.spawn(["bun", "run", module], {
    cwd: repo,
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginRoot, CLAUDE_CODE_SESSION_ID: SID },
    stdin: new Response(stdin).body,
    stdout: "pipe",
    stderr: "pipe",
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (append !== null) {
    timer = setTimeout(
      () => (append.act ? append.act() : appendFileSync(transcript, (append.lines ?? []).map((l) => `${l}\n`).join(""))),
      append.afterMs,
    );
  }
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const exitCode = await proc.exited;
  if (timer) clearTimeout(timer);
  return { exitCode, stdout, stderr, ms: performance.now() - t0 };
}

const show = (r: Run): string => `exit=${r.exitCode} (${Math.round(r.ms)} ms)\n--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}`;

function writeTranscript(lines: string[]): string {
  seq += 1;
  const file = join(scratch, `t-${seq}.jsonl`);
  writeFileSync(file, lines.map((l) => `${l}\n`).join(""));
  return file;
}

/**
 * The two lagging shapes, per gate:
 *   plain     Skill call, then a receipt run whose result has not landed.
 *   incident  a receipt announced BEFORE the Skill call (genuinely old), then
 *             the Skill call, then the vouching run whose result has not
 *             landed — HEAD answers this with the outside-window sentence.
 */
type Shape = "plain" | "incident";

async function laggingWorld(gate: Gate, shape: Shape): Promise<{ repo: string; transcript: string; landing: string[] }> {
  const repo = await managedRepo(`${gate.frontDoorSkill}-${shape}`, gate);
  const lines: string[] = [];
  if (shape === "incident") {
    const old = mint(repo, gate);
    const at = new Date(Date.now() - 7_200_000).toISOString();
    lines.push(mintCall(gate, "b-old", at), mintResult("b-old", old));
  }
  lines.push(skillCall(gate, HOUR_AGO()));
  const fresh = mint(repo, gate);
  lines.push(mintCall(gate, "b-lag", new Date(Date.now() - 1_000).toISOString()));
  return { repo, transcript: writeTranscript(lines), landing: [mintResult("b-lag", fresh)] };
}

for (const gate of GATES) {
  describe(`STE-650 — ${gate.name}: a receipt run whose result has not landed is named as lag`, () => {
    for (const shape of ["plain", "incident"] as const) {
      test(`AC-STE-650.9 (${shape}) — the receipt's tool_result lands 300 ms into the wait → exit 0`, async () => {
        const w = await laggingWorld(gate, shape);
        const r = await runGate(gate, w.repo, w.transcript, { lines: w.landing, afterMs: 300 });
        if (r.exitCode !== 0) throw new Error(`expected exit 0 once the result landed, got:\n${show(r)}`);
      }, 30_000);

      test(`AC-STE-650.10 / .15 (${shape}) — the result never lands (nor the gated call's own line) → exit 2 naming the lag, retry unchanged, never outside-window`, async () => {
        const w = await laggingWorld(gate, shape);
        const r = await runGate(gate, w.repo, w.transcript);
        if (r.exitCode !== 2) throw new Error(`expected exit 2, got:\n${show(r)}`);
        expect(r.stderr).toContain("Refusing:");
        expect(r.stderr, show(r)).toMatch(NOT_CAUGHT_UP);
        expect(r.stderr, show(r)).toMatch(RETRY_UNCHANGED);
        expect(r.stderr, show(r)).not.toMatch(PREDATES);
        expect(r.stderr, show(r)).not.toMatch(/outside[- ]window/i);
      }, 30_000);
    }

    test("AC-STE-650.10 (review) — a detected forgery is never renamed as lag: a tampered announcement plus a pending run keeps the tamper refusal", async () => {
      const repo = await managedRepo(`${gate.frontDoorSkill}-tamper`, gate);
      const lines: string[] = [skillCall(gate, HOUR_AGO())];
      const announced = mint(repo, gate);
      lines.push(mintCall(gate, "b-done", new Date(Date.now() - 2_000).toISOString()), mintResult("b-done", announced));
      // Rewrite the announced receipt after its announcement: it no longer hashes to the printed digest.
      const path = announced.match(/dpt-receipt: (\S+)/)![1]!;
      appendFileSync(path, " ");
      lines.push(mintCall(gate, "b-pending", new Date(Date.now() - 1_000).toISOString()));
      const r = await runGate(gate, repo, writeTranscript(lines));
      if (r.exitCode !== 2) throw new Error(`expected exit 2, got:\n${show(r)}`);
      expect(r.stderr, show(r)).toMatch(/rewritten[\s\S]*after it was announced/);
      expect(r.stderr, show(r)).not.toMatch(NOT_CAUGHT_UP);
    }, 30_000);

    test("AC-STE-650.10 / .11 (review) — a pending run of ANOTHER gate's front door neither waits nor renames a real miss as lag", async () => {
      const repo = await managedRepo(`${gate.frontDoorSkill}-other`, gate);
      const other = gate.frontDoorSkill === "gate-check" ? "spec-review" : "gate-check";
      const otherCall = JSON.stringify({
        type: "assistant",
        timestamp: new Date(Date.now() - 1_000).toISOString(),
        message: { content: [{ type: "tool_use", id: "b-other", name: "Bash", input: { command: `bun run "\${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/gate_receipt.ts" ${other} .` } }] },
      });
      const transcript = writeTranscript([skillCall(gate, HOUR_AGO()), otherCall]);
      let best: Run | null = null;
      for (let i = 0; i < 3; i++) {
        const r = await runGate(gate, repo, transcript);
        if (best === null || r.ms < best.ms) best = r;
      }
      const r = best!;
      if (r.exitCode !== 2) throw new Error(`expected exit 2, got:\n${show(r)}`);
      expect(r.stderr, show(r)).not.toMatch(NOT_CAUGHT_UP);
      expect(r.ms, `a pending run of another gate must not make this one wait (fastest ${Math.round(r.ms)} ms)`).toBeLessThan(WAIT_BOUND_MS * 0.75);
    }, 60_000);

    test("AC-STE-650.10 (review) — a tamper riding on an outside-window miss is never renamed as lag", async () => {
      const repo = await managedRepo(`${gate.frontDoorSkill}-tamper-old`, gate);
      const old = mint(repo, gate);
      const lines: string[] = [mintCall(gate, "b-old", new Date(Date.now() - 7_200_000).toISOString()), mintResult("b-old", old), skillCall(gate, HOUR_AGO())];
      const announced = mint(repo, gate);
      lines.push(mintCall(gate, "b-done", new Date(Date.now() - 2_000).toISOString()), mintResult("b-done", announced));
      appendFileSync(announced.match(/dpt-receipt: (\S+)/)![1]!, " ");
      lines.push(mintCall(gate, "b-pending", new Date(Date.now() - 1_000).toISOString()));
      const r = await runGate(gate, repo, writeTranscript(lines));
      if (r.exitCode !== 2) throw new Error(`expected exit 2, got:\n${show(r)}`);
      expect(r.stderr, show(r)).not.toMatch(NOT_CAUGHT_UP);
    }, 30_000);

    test("AC-STE-650.10 (review) — a window already claimed by another checkout (not-vouched) is never renamed as lag, even with this gate's own run pending", async () => {
      const repo = await managedRepo(`${gate.frontDoorSkill}-claimed`, gate);
      const other = await managedRepo(`${gate.frontDoorSkill}-claimant`, gate);
      mint(repo, gate); // this checkout's receipt exists; no run in the window announced it
      const claimed = mint(other, gate);
      const lines: string[] = [skillCall(gate, HOUR_AGO())];
      lines.push(mintCall(gate, "b-claim", new Date(Date.now() - 2_000).toISOString()), mintResult("b-claim", claimed));
      lines.push(mintCall(gate, "b-pending", new Date(Date.now() - 1_000).toISOString()));
      const r = await runGate(gate, repo, writeTranscript(lines));
      if (r.exitCode !== 2) throw new Error(`expected exit 2, got:\n${show(r)}`);
      expect(r.stderr, show(r)).toMatch(/already recorded/);
      expect(r.stderr, show(r)).not.toMatch(NOT_CAUGHT_UP);
    }, 30_000);

    // Review FO-1 — the wait must never re-run the fail-open leg. A transcript
    // that turns unreadable mid-wait leaves the miss already graded standing;
    // v2.91.0 refused this commit/PR, so a pass here is a regression.
    for (const how of ["rename", "chmod"] as const) {
      test(`AC-STE-650.10 (review FO-1, ${how}) — the transcript turns unreadable 600 ms into the wait → exit 2 naming the lag, never a pass`, async () => {
        const w = await laggingWorld(gate, "plain");
        const act = how === "rename" ? () => renameSync(w.transcript, `${w.transcript}.gone`) : () => chmodSync(w.transcript, 0o000);
        const r = await runGate(gate, w.repo, w.transcript, { act, afterMs: 600 });
        if (how === "chmod") chmodSync(w.transcript, 0o600);
        if (r.exitCode !== 2) throw new Error(`expected exit 2, got:\n${show(r)}`);
        expect(r.stderr, show(r)).toMatch(NOT_CAUGHT_UP);
      }, 30_000);
    }

    test("AC-STE-650.9 CONTROL — the complete transcript (result already on disk) → exit 0", async () => {
      const w = await laggingWorld(gate, "incident");
      appendFileSync(w.transcript, w.landing.map((l) => `${l}\n`).join(""));
      const r = await runGate(gate, w.repo, w.transcript);
      if (r.exitCode !== 0) throw new Error(`expected exit 0, got:\n${show(r)}`);
    }, 30_000);

    test("AC-STE-650.11 — a receipt that genuinely predates the window, its result on disk, keeps the outside-window refusal and never waits (keep-behaviour control)", async () => {
      const repo = await managedRepo(`${gate.frontDoorSkill}-old`, gate);
      const old = mint(repo, gate);
      const transcript = writeTranscript([
        mintCall(gate, "b-old", new Date(Date.now() - 7_200_000).toISOString()),
        mintResult("b-old", old),
        skillCall(gate, HOUR_AGO()),
      ]);
      // The fastest of three: machine load cannot pass for a wait, and a wait
      // cannot hide behind one slow spawn.
      let best: Run | null = null;
      for (let i = 0; i < 3; i++) {
        const r = await runGate(gate, repo, transcript);
        if (best === null || r.ms < best.ms) best = r;
      }
      const r = best!;
      if (r.exitCode !== 2) throw new Error(`expected exit 2, got:\n${show(r)}`);
      expect(r.stderr, show(r)).toMatch(PREDATES);
      expect(r.stderr, show(r)).not.toMatch(NOT_CAUGHT_UP);
      expect(r.ms, `no receipt run is pending, so the gate must not wait (fastest run ${Math.round(r.ms)} ms)`).toBeLessThan(WAIT_BOUND_MS * 0.75);
    }, 60_000);
  });
}

// ===========================================================================
// STE-655 (M_a85e46) — every command gate waits out lag alike.
//
// The table above now carries the tdd commit gate (AC-STE-655.6), so its legs
// are AC-STE-655.2 (lands → exit 0), AC-STE-655.3 (never lands → the lag
// refusal, never outside-window), AC-STE-655.4 (FO-1, all three gates) and
// AC-STE-655.5's first half (a genuinely old receipt keeps the HEAD refusal and
// never waits) for that row. The legs below are the rest: the shared-helper
// source pin (AC.1), the FO-1 break mutation (AC.4 / AC.17), the red-before
// door's no-wait permit (AC.5) and the amended STE-650 text (AC.7).
// ===========================================================================

const TDD_GATE = GATES.find((g) => g.name === "pre-commit-tdd-orchestrator");
const SESSION_TS = join(PLUGIN_ROOT, "templates", "hooks", "_lib", "session.ts");

/**
 * The span of the top-level `function <name>(` (exported or not) in `src`, up
 * to the next top-level declaration — the grader suite's `functionBody` rule.
 */
function functionSpan(src: string, name: string): { from: number; to: number } | null {
  const m = new RegExp(`\\n(?:export )?function ${name}\\(`).exec(src);
  if (!m) return null;
  const from = m.index + 1;
  const next = src.slice(from + 1).search(/\n(?:export )?(?:async )?(?:function |const |let |interface |type |class |\/\*\*|\/\/ ---)/);
  return { from, to: next < 0 ? src.length : from + 1 + next };
}
const bodyOf = (src: string, name: string): string => {
  const span = functionSpan(src, name);
  return span === null ? "" : src.slice(span.from, span.to);
};
/** Every top-level function name `src` exports. */
const exportedFunctions = (src: string): string[] => [...src.matchAll(/\nexport function (\w+)\(/g)].map((m) => m[1]!);
/** The ONE exported function of session.ts that sleeps: the bounded-wait helper. */
function waitHelpers(src: string): string[] {
  return exportedFunctions(src).filter((n) => bodyOf(src, n).includes("Bun.sleepSync"));
}

describe("STE-655 AC-STE-655.6 — the GATES table carries the tdd commit gate", () => {
  test("AC-STE-655.6 — a pre-commit-tdd-orchestrator row runs every leg of this table", () => {
    expect(GATES.map((g) => g.name)).toEqual(["pre-commit-gate-check", "pre-pr-spec-review", "pre-commit-tdd-orchestrator"]);
    expect(TDD_GATE?.skill).toBe("dev-process-toolkit:tdd");
    expect(existsSync(TDD_GATE!.module), TDD_GATE!.module).toBe(true);
  });
});

describe("STE-655 AC-STE-655.1 — one exported bounded-wait helper, called by both evidence readers", () => {
  const src = readFileSync(SESSION_TS, "utf-8");

  test("AC-STE-655.1 — session.ts exports exactly one function that waits (Bun.sleepSync), and it is neither evidence reader", () => {
    const helpers = waitHelpers(src);
    expect(helpers.length, `exported functions holding the wait: ${helpers.join(", ") || "none"}`).toBe(1);
    expect(["requireSkillToolUse", "requireTddEvidence"]).not.toContain(helpers[0]);
    // ONE wait in the file: no private copy beside the exported one.
    expect(src.split("Bun.sleepSync").length - 1).toBe(1);
  });

  test("AC-STE-655.1 — source pin: requireSkillToolUse and requireTddEvidence both call the helper, and neither carries its own wait loop", () => {
    const helper = waitHelpers(src)[0] ?? "<no helper>";
    const readers = ["requireSkillToolUse", "requireTddEvidence"] as const;
    const pin = Object.fromEntries(
      readers.map((r) => {
        const body = bodyOf(src, r);
        return [
          r,
          {
            found: body !== "",
            callsHelper: body.includes(`${helper}(`),
            sleeps: body.includes("Bun.sleepSync"),
            polls: body.includes("RECEIPT_RESULT_POLL_MS"),
            loops: /\bwhile\s*\(|\bfor\s*\(\s*;;/.test(body),
          },
        ];
      }),
    );
    const want = { found: true, callsHelper: true, sleeps: false, polls: false, loops: false };
    expect(pin).toEqual({ requireSkillToolUse: want, requireTddEvidence: want });
  });

  test("CONTROL — bodyOf reads the named function: requireTddEvidence holds the red-before door, requireSkillToolUse the STE-614 receipt leg", () => {
    expect(bodyOf(src, "requireTddEvidence")).toContain("proofCoverage(");
    expect(bodyOf(src, "requireSkillToolUse")).toContain("firstReceiptMiss(");
  });
});

describe("STE-655 AC-STE-655.5 — the tdd gate's red-before door never waits on a genuinely old receipt", () => {
  test("AC-STE-655.5 — an old receipt (result on disk) plus a red-before proof covering every staged path → exit 0, without waiting", async () => {
    const gate = TDD_GATE!;
    const repo = await managedRepo("tdd-old-proof", gate);
    const old = mint(repo, gate);
    const proof = JSON.stringify({
      type: "user",
      timestamp: new Date().toISOString(),
      message: { role: "user", content: `dpt-red-before-proof: repo=${repo} ${Object.keys(TDD_STAGED).join(" ")}` },
    });
    const transcript = writeTranscript([
      mintCall(gate, "b-old", new Date(Date.now() - 7_200_000).toISOString()),
      mintResult("b-old", old),
      skillCall(gate, HOUR_AGO()),
      proof,
    ]);
    let best: Run | null = null;
    for (let i = 0; i < 3; i++) {
      const r = await runGate(gate, repo, transcript);
      if (best === null || r.ms < best.ms) best = r;
    }
    const r = best!;
    if (r.exitCode !== 0) throw new Error(`expected exit 0 through the red-before door, got:\n${show(r)}`);
    expect(r.ms, `no receipt run is pending, so the gate must not wait (fastest ${Math.round(r.ms)} ms)`).toBeLessThan(WAIT_BOUND_MS * 0.75);
  }, 60_000);

  test("AC-STE-655.5 / .3 — a pending tdd receipt run whose result never lands, but a red-before proof covers every staged path → exit 0 (the proof is door two)", async () => {
    const gate = TDD_GATE!;
    const w = await laggingWorld(gate, "plain");
    appendFileSync(
      w.transcript,
      `${JSON.stringify({ type: "user", timestamp: new Date().toISOString(), message: { role: "user", content: `dpt-red-before-proof: repo=${w.repo} ${Object.keys(TDD_STAGED).join(" ")}` } })}\n`,
    );
    const r = await runGate(gate, w.repo, w.transcript);
    if (r.exitCode !== 0) throw new Error(`expected exit 0 through the red-before door, got:\n${show(r)}`);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// AC-STE-655.4 / .17 — the FO-1 break, mutated away, reds the FO-1 leg of all
// three gates. The plugin tree (tests/ excluded) is copied once; session.ts in
// the copy loses the wait helper's fail-open break, sited with
// `mutateInRegion` inside the helper's own body; each gate's FO-1 leg is then
// run from the copy. The mutant must PERMIT (the fail-open regression FO-1
// fixed); the unmutated copy must refuse naming the lag (the copy works).
// ---------------------------------------------------------------------------

/** Copy the plugin tree (tests/ and node_modules excluded) into `dir`; link node_modules. */
function copyPlugin(dir: string): string {
  const copy = join(dir, "plugin");
  const testsDir = join(PLUGIN_ROOT, "tests");
  cpSync(PLUGIN_ROOT, copy, {
    recursive: true,
    filter: (src) => src !== testsDir && !src.startsWith(`${testsDir}/`) && basename(src) !== "node_modules",
  });
  const nm = join(PLUGIN_ROOT, "..", "..", "node_modules");
  if (existsSync(nm)) symlinkSync(nm, join(copy, "node_modules"), "dir");
  return copy;
}

/**
 * Remove the FO-1 break from the wait helper in `doc`: the ONE line of the
 * helper's body that breaks out of the wait on a re-read that found no
 * transcript (it names `null` or `found`). Throws when the helper or that line
 * is not determined — a mutation that misses must never read as a kill.
 */
function withoutFailOpenBreak(doc: string): string {
  const helper = waitHelpers(doc)[0];
  if (helper === undefined) throw new Error("mutation: session.ts exports no wait helper (a function holding Bun.sleepSync)");
  const span = functionSpan(doc, helper)!;
  const lines = doc.slice(span.from, span.to).split("\n").filter((l) => /\bbreak\b/.test(l) && /null|found/.test(l));
  if (lines.length !== 1) throw new Error(`mutation: expected exactly one FO-1 break line in ${helper}, found ${lines.length}:\n${lines.join("\n")}`);
  const line = lines[0]!;
  return mutateInRegion(doc, span.from, span.to, line, line.replace(/\bbreak\b/, "{}"), { label: `the FO-1 break in ${helper}` });
}

describe("STE-655 AC-STE-655.4 / .17 — removing the FO-1 break reds the FO-1 leg of every gate", () => {
  let mutant = "";
  let pristine = "";
  beforeAll(() => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "ste655-fo1-")));
    pristine = copyPlugin(join(dir, "a"));
    mutant = copyPlugin(join(dir, "b"));
    const target = join(mutant, "templates", "hooks", "_lib", "session.ts");
    let mutated: string | null = null;
    try {
      mutated = withoutFailOpenBreak(readFileSync(target, "utf-8"));
    } catch (e) {
      mutant = `!${(e as Error).message}`;
    }
    if (mutated !== null) writeFileSync(target, mutated);
  });
  afterAll(() => {
    for (const root of [pristine, mutant]) if (root !== "" && !root.startsWith("!")) rmSync(join(root, ".."), { recursive: true, force: true });
  });

  test("CONTROL — the mutation is sited: exactly one FO-1 break line in the shipped helper", () => {
    const src = readFileSync(SESSION_TS, "utf-8");
    expect(withoutFailOpenBreak(src)).not.toBe(src);
  });

  for (const gate of GATES) {
    test(`AC-STE-655.4 (${gate.name}) — CONTROL on the unmutated copy: the transcript renamed mid-wait → exit 2 naming the lag`, async () => {
      const w = await laggingWorld(gate, "plain");
      const r = await runGate(gate, w.repo, w.transcript, { act: () => renameSync(w.transcript, `${w.transcript}.gone`), afterMs: 600 }, pristine);
      if (r.exitCode !== 2) throw new Error(`expected exit 2, got:\n${show(r)}`);
      expect(r.stderr, show(r)).toMatch(NOT_CAUGHT_UP);
    }, 30_000);

    test(`AC-STE-655.4 / .17 (${gate.name}) — with the FO-1 break mutated away, the same leg PERMITS (exit 0): the mutation is killed by the FO-1 leg`, async () => {
      if (mutant.startsWith("!")) throw new Error(mutant.slice(1));
      const w = await laggingWorld(gate, "plain");
      const r = await runGate(gate, w.repo, w.transcript, { act: () => renameSync(w.transcript, `${w.transcript}.gone`), afterMs: 600 }, mutant);
      if (r.exitCode !== 0) throw new Error(`expected the mutant to fail open (exit 0) — the FO-1 leg must see this mutation — got:\n${show(r)}`);
    }, 30_000);
  }
});

// ---------------------------------------------------------------------------
// AC-STE-655.17 — door two reads the transcript ONCE (STE-655 review r0).
// requireTddEvidence asks door two only after door one read a READABLE
// transcript, and it now does so with a single read whose null result is never
// a proof — so a transcript that turns unreadable can neither fail door two
// open nor slip between a check and a re-check. No timing in a test can put the
// unreadable moment between door one's read and door two's, so the property is
// pinned structurally here, and the FO-1 leg (transcript renamed mid-WAIT)
// still runs against the gate as shipped.
// ---------------------------------------------------------------------------

describe("STE-655 AC-STE-655.17 — door two grades one read, and a missing read is never a proof", () => {
  test("AC-STE-655.17 — requireTddEvidence reads the transcript exactly once for door two, never calls the fail-open findRedBeforeProof, and gates the proof on a non-null read", () => {
    const doc = readFileSync(join(PLUGIN_ROOT, "templates", "hooks", "_lib", "session.ts"), "utf-8");
    const span = functionSpan(doc, "requireTddEvidence");
    if (span === null) throw new Error("session.ts declares no requireTddEvidence");
    const body = doc.slice(span.from, span.to);
    expect((body.match(/readTranscriptLines\(payload\)/g) ?? []).length, "door two reads the transcript exactly once").toBe(1);
    expect(body, "door two must not call the fail-open findRedBeforeProof").not.toContain("findRedBeforeProof(");
    expect(body, "a null read is never a proof").toContain("lines !== null && proofCoverage(lines,");
  });

  test("AC-STE-655.17 / AC-STE-655.4 — the tdd row's FO-1 leg as shipped: the transcript renamed mid-wait → exit 2 naming the lag, never a pass", async () => {
    const w = await laggingWorld(TDD_GATE!, "plain");
    const r = await runGate(TDD_GATE!, w.repo, w.transcript, { act: () => renameSync(w.transcript, `${w.transcript}.gone`), afterMs: 600 });
    if (r.exitCode !== 2) throw new Error(`expected exit 2, got:\n${show(r)}`);
    expect(r.stderr, show(r)).toMatch(NOT_CAUGHT_UP);
  }, 30_000);
});

describe("STE-655 AC-STE-655.7 — the archived STE-650 FR names the amendment", () => {
  test("AC-STE-655.7 — AC-STE-650.9 and AC-STE-650.10 each carry a clause naming STE-655 and the tdd gate", () => {
    const fr = readFileSync(join(PLUGIN_ROOT, "..", "..", "specs", "frs", "archive", "STE-650.md"), "utf-8");
    const line = (id: string) => fr.split("\n").find((l) => l.startsWith(`- ${id}:`)) ?? "";
    const pin = (id: string) => ({ present: line(id) !== "", namesFr: /STE-655/.test(line(id)), namesTddGate: /\btdd\b/i.test(line(id)) });
    expect({ ac9: pin("AC-STE-650.9"), ac10: pin("AC-STE-650.10") }).toEqual({
      ac9: { present: true, namesFr: true, namesTddGate: true },
      ac10: { present: true, namesFr: true, namesTddGate: true },
    });
  });
});
