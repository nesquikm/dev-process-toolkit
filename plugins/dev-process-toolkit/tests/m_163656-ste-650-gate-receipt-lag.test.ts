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

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
  /** The front door's skill argument (`gate-check`, `spec-review`). */
  frontDoorSkill: string;
  command: (repo: string) => string;
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

/** A toolkit-managed `git init` checkout, with no receipts yet. */
async function managedRepo(label: string): Promise<string> {
  seq += 1;
  const dir = join(scratch, `${label}-${seq}`);
  mkdirSync(dir, { recursive: true });
  await Bun.spawn(["git", "init", "-q", dir], { stdout: "pipe", stderr: "pipe" }).exited;
  writeManagedClaudeMd(dir);
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
  const proc = Bun.spawn(["bun", "run", gate.module], {
    cwd: repo,
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, CLAUDE_CODE_SESSION_ID: SID },
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
  const repo = await managedRepo(`${gate.frontDoorSkill}-${shape}`);
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
      const repo = await managedRepo(`${gate.frontDoorSkill}-tamper`);
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
      const repo = await managedRepo(`${gate.frontDoorSkill}-other`);
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
      const repo = await managedRepo(`${gate.frontDoorSkill}-tamper-old`);
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
      const repo = await managedRepo(`${gate.frontDoorSkill}-claimed`);
      const other = await managedRepo(`${gate.frontDoorSkill}-claimant`);
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
      const repo = await managedRepo(`${gate.frontDoorSkill}-old`);
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
