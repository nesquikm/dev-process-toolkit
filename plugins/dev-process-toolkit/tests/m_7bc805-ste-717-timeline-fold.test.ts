// STE-717 (M_7bc805) — the session-stop fold, driven through the shipped
// `templates/hooks/process/session-token-ledger.sh` wrapper.
//
// AC-STE-717.8 (fold rows, loader rows, the fast path), AC-STE-717.9 (20,000
// lines in at most 3000 ms, measured twice before failing), AC-STE-717.11 (the
// fold half of the mutation controls: the registration check and the
// fast-path import order, each mutated in a temp plugin copy).
//
// The v3.0.0 runs execute the v3.0.0 merge commit's own wrapper and modules
// (`git archive 6c62b32c`), on a twin of the same fixture.
//
// tests/token-ledger-hook.test.ts and tests/token-ledger-noninterference.test.ts
// are NOT edited by this FR; their existing tests passing unchanged is part of
// AC-STE-717.8 and is graded by running them in the same gate.
//
// Note on the fast-path markers. The token ledger itself loads
// project_settings.ts statically (token_stats_config.ts imports it) on every
// tree, and did so in v3.0.0, so a load marker on that module cannot tell the
// fold's load from the ledger's. Its marker is therefore on `toolCallsSwitchOn`,
// the one export the fold loads it for. capture_registration.ts and
// tool_call_timeline.ts carry load markers.

import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { renderSettingsPointer } from "../adapters/_shared/src/project_settings";
import {
  CAPTURE_MODULE_REL,
  PLUGIN_ROOT,
  RUNNING_VERSION,
  SETTINGS_HEAD,
  cleanupTemps,
  git,
  makeCheckout,
  payload as capturePayload,
  pluginCopy,
  recordFor,
  runCapture,
  tempDir,
} from "./_m_7bc805_capture_fixture";
import {
  LEDGER_ENTRY_REL,
  MARKER_ENV,
  T0,
  TIMELINE_REL,
  bashUse,
  copyTree,
  ledgerPayload,
  loadMarker,
  registeredCheckout,
  runLedgerHook,
  skillUse,
  snapshot,
  staleRegistration,
  timelineFile,
  toolResult,
  usageRecord,
  v300Plugin,
  writeSessionTranscript,
} from "./_m_7bc805_timeline_fixture";

const T = 120_000;
const SID = "00000000-0000-4000-8000-000000000716";

afterAll(cleanupTemps);

function transcriptFor(root: string, n = 2): string {
  const records: string[] = [];
  for (let i = 0; i < n; i++) {
    records.push(bashUse(`toolu_F${i}`, "ls", T0 + i * 100, { cwd: root }), toolResult(`toolu_F${i}`, T0 + i * 100 + 20, { isError: false }));
  }
  records.push(usageRecord(T0 + n * 100, "dev-process-toolkit:tdd"));
  return writeSessionTranscript(tempDir("fold-tr"), SID, records);
}

function readTimeline(root: string): Record<string, any> {
  return JSON.parse(readFileSync(timelineFile(root, SID), "utf-8")) as Record<string, any>;
}

function toolCallsDir(root: string): string[] {
  const d = join(root, ".dpt", "ledger", "tool-calls");
  return existsSync(d) ? readdirSync(d).sort() : [];
}

function setSettings(root: string, body: string): void {
  mkdirSync(join(root, "specs"), { recursive: true });
  writeFileSync(join(root, "specs", "settings.yaml"), body);
}

const ON_WITH_TOKENS_OFF = `${SETTINGS_HEAD}tracking:\n  token_stats:\n    enabled: false\n  tool_calls:\n    enabled: true\n`;
const ON_WITH_TOKENS_ON = `${SETTINGS_HEAD}tracking:\n  token_stats:\n    enabled: true\n  tool_calls:\n    enabled: true\n`;
const BOTH_OFF = `${SETTINGS_HEAD}tracking:\n  token_stats:\n    enabled: false\n`;

/** Normalise a run's text for a cross-tree comparison: each root becomes `<root>`. */
function norm(text: string, roots: string[]): string {
  let out = text;
  for (const r of roots) out = out.split(r).join("<root>");
  return out;
}

// ===========================================================================
// AC-STE-717.8 — the fold
// ===========================================================================

describe("AC-STE-717.8 the fold", () => {
  test("capture on (registered): the hook writes the timeline at toolCallTimelinePath, and a re-fire replaces it", async () => {
    const { root, cfg } = registeredCheckout("fold-on");
    const transcript = transcriptFor(root, 2);
    const r1 = runLedgerHook(ledgerPayload(SID, transcript, root), { cfg });
    expect({ code: r1.exitCode, out: r1.stdout, err: r1.stderr }).toEqual({ code: 0, out: "", err: "" });
    const { toolCallTimelinePath } = (await import("../adapters/_shared/src/dpt_paths")) as Record<string, any>;
    expect(timelineFile(root, SID)).toBe(toolCallTimelinePath(root, SID));
    expect(existsSync(timelineFile(root, SID))).toBe(true);
    const first = readTimeline(root);
    expect(first.schema).toBe("tool-call-timeline/v1");
    expect(first.calls.map((c: Record<string, unknown>) => c.tool_use_id)).toEqual(["toolu_F0", "toolu_F1"]);
    // Re-fire on a longer transcript (Stop, then SessionEnd): replaced, not appended.
    const longer = transcriptFor(root, 3);
    const r2 = runLedgerHook(ledgerPayload(SID, longer, root, "Stop"), { cfg });
    expect(r2.exitCode).toBe(0);
    const second = readTimeline(root);
    expect(second.calls.map((c: Record<string, unknown>) => c.tool_use_id)).toEqual(["toolu_F0", "toolu_F1", "toolu_F2"]);
    expect(toolCallsDir(root)).toEqual([`${SID}.timeline.json`]);
  }, T);

  test("capture off: a registered checkout whose switch is now false writes no timeline", () => {
    const { root, cfg } = registeredCheckout("fold-off");
    setSettings(root, `${SETTINGS_HEAD}tracking:\n  tool_calls:\n    enabled: false\n`);
    const r = runLedgerHook(ledgerPayload(SID, transcriptFor(root), root), { cfg });
    expect(r.exitCode).toBe(0);
    expect(existsSync(timelineFile(root, SID))).toBe(false);
  }, T);

  test("capture on with token stats off still writes it; with token stats on it writes it and the token ledger too", () => {
    const off = registeredCheckout("fold-tokens-off");
    setSettings(off.root, ON_WITH_TOKENS_OFF);
    const r1 = runLedgerHook(ledgerPayload(SID, transcriptFor(off.root), off.root), { cfg: off.cfg });
    expect(r1.exitCode).toBe(0);
    expect(existsSync(timelineFile(off.root, SID))).toBe(true);
    const on = registeredCheckout("fold-tokens-on");
    setSettings(on.root, ON_WITH_TOKENS_ON);
    const r2 = runLedgerHook(ledgerPayload(SID, transcriptFor(on.root), on.root), { cfg: on.cfg });
    expect(r2.exitCode).toBe(0);
    expect(existsSync(timelineFile(on.root, SID))).toBe(true);
    const ledgerFiles = Object.keys(snapshot(on.root)).filter((p) => p.startsWith(".dpt/ledger/") && !p.startsWith(".dpt/ledger/tool-calls/"));
    expect(ledgerFiles.length).toBeGreaterThan(0);
  }, T);

  test("both off: exit code, stdout, stderr and file list equal the v3.0.0 run on the same fixture", () => {
    const now = makeCheckout("both-off-now", "absent");
    setSettings(now, BOTH_OFF);
    const then = join(tempDir("both-off-then"), "repo");
    copyTree(now, then);
    git(then, "init", "-q", "-b", "main");
    const tNow = transcriptFor(now);
    const tThen = transcriptFor(then);
    const a = runLedgerHook(ledgerPayload(SID, tNow, now), {});
    const b = runLedgerHook(ledgerPayload(SID, tThen, then), { pluginRoot: v300Plugin() });
    expect({ code: a.exitCode, out: a.stdout, err: norm(a.stderr, [now]) }).toEqual({ code: b.exitCode, out: b.stdout, err: norm(b.stderr, [then]) });
    expect(Object.keys(snapshot(now)).sort()).toEqual(Object.keys(snapshot(then)).sort());
  }, T);

  test("teammate row: capture on with no registration in .claude/settings.local.json writes no timeline file", () => {
    const root = makeCheckout("fold-mate", "on");
    const { cfg } = recordFor("fold-mate-rec", root);
    const r = runLedgerHook(ledgerPayload(SID, transcriptFor(root), root), { cfg });
    expect({ code: r.exitCode, out: r.stdout, err: r.stderr }).toEqual({ code: 0, out: "", err: "" });
    expect(existsSync(timelineFile(root, SID))).toBe(false);
    expect(existsSync(join(root, ".dpt", "ledger", "tool-calls"))).toBe(false);
    expect(existsSync(join(root, ".claude", "settings.local.json"))).toBe(false);
  }, T);

  test("stale registration: a capture entry naming another version writes no timeline", () => {
    const { root, cfg } = registeredCheckout("fold-stale");
    staleRegistration(root, RUNNING_VERSION);
    const r = runLedgerHook(ledgerPayload(SID, transcriptFor(root), root), { cfg });
    expect(r.exitCode).toBe(0);
    expect(existsSync(timelineFile(root, SID))).toBe(false);
  }, T);

  test("subdirectory row: payload.cwd two levels below the root — the flag is read at the root and the timeline lands under the root's ledger, over the capture hook's rows", () => {
    const { root, cfg, record } = registeredCheckout("fold-sub");
    const sub = join(root, "pkg", "inner");
    mkdirSync(sub, { recursive: true });
    for (const event of ["pre", "post"] as const) {
      const r = runCapture(capturePayload({ event, tool: "Bash", cwd: sub, command: "ls", toolUseId: "toolu_SUB1", sid: SID }), {
        record,
        env: { CLAUDE_CONFIG_DIR: cfg },
        projectDir: root,
      });
      expect(r.exitCode).toBe(0);
    }
    expect(toolCallsDir(root)).toEqual([`${SID}.jsonl`]);
    const transcript = writeSessionTranscript(tempDir("fold-sub-tr"), SID, [
      bashUse("toolu_SUB1", "ls", T0, { cwd: sub }),
      toolResult("toolu_SUB1", T0 + 50, { isError: false }),
    ]);
    const r = runLedgerHook(ledgerPayload(SID, transcript, sub), { cfg, cwd: sub });
    expect(r.exitCode).toBe(0);
    expect(toolCallsDir(root)).toEqual([`${SID}.jsonl`, `${SID}.timeline.json`]);
    const t = readTimeline(root);
    expect(t.calls.map((c: Record<string, unknown>) => [c.tool_use_id, c.pairing])).toEqual([["toolu_SUB1", "paired"]]);
    expect(Object.keys(snapshot(join(root, "pkg")))).toEqual([]);
  }, T);
});

describe("AC-STE-717.8 loader rows (each registered while the switch was on)", () => {
  test("a foreign settings file (non-migrated tree, no min_dpt_version) holding tool_calls: { enabled: true } writes no timeline", () => {
    const { root, cfg } = registeredCheckout("loader-foreign");
    setSettings(root, "schema_version: 1\ntracking:\n  tool_calls:\n    enabled: true\n");
    const r = runLedgerHook(ledgerPayload(SID, transcriptFor(root), root), { cfg });
    expect(r.exitCode).toBe(0);
    expect(existsSync(timelineFile(root, SID))).toBe(false);
  }, T);

  test("a migrated tree whose settings file lost min_dpt_version writes none, and exit code, stdout and stderr equal that tree's v3.0.0 run", () => {
    const { root, cfg } = registeredCheckout("loader-migrated");
    writeFileSync(join(root, "CLAUDE.md"), `<!-- generated by /dev-process-toolkit:setup -->\n# Fixture\n\n## Project Settings\n\n${renderSettingsPointer("3.0.0")}`);
    setSettings(root, "schema_version: 1\ntracking:\n  tool_calls:\n    enabled: true\n");
    const then = join(tempDir("loader-migrated-then"), "repo");
    copyTree(root, then);
    git(then, "init", "-q", "-b", "main");
    const a = runLedgerHook(ledgerPayload(SID, transcriptFor(root), root), { cfg });
    const b = runLedgerHook(ledgerPayload(SID, transcriptFor(then), then), { cfg, pluginRoot: v300Plugin() });
    expect(existsSync(timelineFile(root, SID))).toBe(false);
    expect({ code: a.exitCode, out: a.stdout, err: norm(a.stderr, [root]) }).toEqual({ code: b.exitCode, out: b.stdout, err: norm(b.stderr, [then]) });
  }, T);

  test("a malformed tracking.token_stats beside tool_calls: { enabled: true } writes none", () => {
    const { root, cfg } = registeredCheckout("loader-malformed");
    setSettings(root, `${SETTINGS_HEAD}tracking:\n  token_stats: yes\n  tool_calls:\n    enabled: true\n`);
    const r = runLedgerHook(ledgerPayload(SID, transcriptFor(root), root), { cfg });
    expect(r.exitCode).toBe(0);
    expect(existsSync(timelineFile(root, SID))).toBe(false);
  }, T);
});

// ---------------------------------------------------------------------------
// The fast path — marker copies
// ---------------------------------------------------------------------------

/**
 * A temp plugin copy whose capture_registration.ts and tool_call_timeline.ts
 * write `loaded <name>` to $MARKER_ENV when loaded, and whose
 * project_settings.ts writes `called toolCallsSwitchOn` when the fold asks it.
 * `mutate` edits the copy afterwards.
 */
function markerCopy(label: string, mutate?: (copy: string) => void): string {
  const copy = pluginCopy(label);
  for (const rel of [CAPTURE_MODULE_REL, TIMELINE_REL]) {
    const file = join(copy, rel);
    writeFileSync(file, loadMarker(rel.split("/").pop()!) + readFileSync(file, "utf-8"));
  }
  const ps = join(copy, "adapters", "_shared", "src", "project_settings.ts");
  const head = "export function toolCallsSwitchOn(projectRoot: string): boolean {";
  const src = readFileSync(ps, "utf-8");
  if (!src.includes(head)) throw new Error("project_settings.ts no longer declares toolCallsSwitchOn as expected");
  writeFileSync(
    ps,
    `import { appendFileSync as __m717 } from "node:fs";\n` +
      src.replace(head, `${head}\n  if (process.env.${MARKER_ENV}) __m717(process.env.${MARKER_ENV}, "called toolCallsSwitchOn\\n");`),
  );
  mutate?.(copy);
  return copy;
}

function markers(file: string): string[] {
  return existsSync(file) ? readFileSync(file, "utf-8").trim().split("\n").filter((l) => l !== "").sort() : [];
}

/** The fast-path assertion, as mismatches (reused by the mutation control). */
function fastPathFailures(copy: string, label: string): string[] {
  const root = makeCheckout(label, "none");
  const marker = join(tempDir(`${label}-mk`), "markers.log");
  const r = runLedgerHook(ledgerPayload(SID, transcriptFor(root), root), { pluginRoot: copy, env: { [MARKER_ENV]: marker } });
  const out: string[] = [];
  if (r.exitCode !== 0) out.push(`exit ${r.exitCode}`);
  for (const m of markers(marker)) out.push(m);
  if (existsSync(timelineFile(root, SID))) out.push("timeline written");
  return out;
}

describe("AC-STE-717.8 fast path", () => {
  test("CONTROL: on a registered, switched-on tree the same marker copies DO mark, and the copy's fold writes the timeline", () => {
    const copy = markerCopy("fast-control");
    const { root, cfg } = registeredCheckout("fast-control-tree", { pluginRoot: copy, module: join(copy, CAPTURE_MODULE_REL) });
    const marker = join(tempDir("fast-control-mk"), "markers.log");
    const r = runLedgerHook(ledgerPayload(SID, transcriptFor(root), root), { pluginRoot: copy, cfg, env: { [MARKER_ENV]: marker } });
    expect(r.exitCode).toBe(0);
    expect(markers(marker)).toEqual(["called toolCallsSwitchOn", "loaded capture_registration.ts", "loaded tool_call_timeline.ts"]);
    expect(existsSync(timelineFile(root, SID))).toBe(true);
  }, T);

  test("fast path: with no settings file, no marker appears (no fold module is loaded and the switch is never read)", () => {
    expect(fastPathFailures(markerCopy("fast-none"), "fast-none-tree")).toEqual([]);
  }, T);

  test("fast path: a settings file with tool_calls but no .claude/settings.local.json loads nothing either", () => {
    const copy = markerCopy("fast-nolocal");
    const root = makeCheckout("fast-nolocal-tree", "on");
    const marker = join(tempDir("fast-nolocal-mk"), "markers.log");
    const r = runLedgerHook(ledgerPayload(SID, transcriptFor(root), root), { pluginRoot: copy, env: { [MARKER_ENV]: marker } });
    expect(r.exitCode).toBe(0);
    expect(markers(marker)).toEqual([]);
  }, T);
});

// ===========================================================================
// AC-STE-717.9 — 20,000 lines in at most 3000 ms
// ===========================================================================

describe("AC-STE-717.9 fold latency", () => {
  test("the fold over a synthetic 20,000-line transcript completes in at most 3000 ms (a miss is measured once more; both must miss to fail)", () => {
    const { root, cfg } = registeredCheckout("fold-perf");
    const records: string[] = [];
    for (let i = 0; i < 10_000; i++) {
      const id = `toolu_PERF${i}`;
      records.push(
        i % 50 === 0 ? skillUse(id, "dev-process-toolkit:tdd-implement", T0 + i * 10, { cwd: root }) : bashUse(id, "ls", T0 + i * 10, { cwd: root }),
        toolResult(id, T0 + i * 10 + 5, { isError: i % 7 === 0 }),
      );
    }
    expect(records.length).toBe(20_000);
    const transcript = writeSessionTranscript(tempDir("fold-perf-tr"), SID, records);
    const rounds: number[] = [];
    const first = runLedgerHook(ledgerPayload(SID, transcript, root), { cfg });
    expect(first.exitCode).toBe(0);
    rounds.push(Math.round(first.ms));
    if (first.ms > 3000) {
      const second = runLedgerHook(ledgerPayload(SID, transcript, root), { cfg });
      rounds.push(Math.round(second.ms));
    }
    console.log(`AC-STE-717.9 fold over 20,000 lines: ${rounds.map((ms, i) => `round ${i + 1} ${ms} ms`).join(", ")}`);
    expect(existsSync(timelineFile(root, SID))).toBe(true);
    expect(readTimeline(root).calls.length).toBe(10_000);
    expect(rounds.some((ms) => ms <= 3000)).toBe(true);
  }, T);
});

// ===========================================================================
// AC-STE-717.11 — mutation controls (fold half)
// ===========================================================================

describe("AC-STE-717.11 mutation controls (fold)", () => {
  // The fixture must pass the entry's fast-path byte check (its
  // .claude/settings.local.json names tool-call-capture.sh) and still hold no
  // CURRENT registration: a capture entry naming another version. A tree with
  // no settings.local.json returns before the registration check is reached,
  // so the mutated copy would write nothing there either.
  test("MUTATION: dropping the registration check (captureStatus forced to `current`, in a copy) turns the stale-registration row red", () => {
    const head = 'registration: !any ? "none" : current ? "current" : "stale",';
    const copy = pluginCopy("m-registration");
    const file = join(copy, CAPTURE_MODULE_REL);
    const src = readFileSync(file, "utf-8");
    expect(src).toContain(head);
    writeFileSync(file, src.replace(head, 'registration: "current" as const,'));
    const staleRow = (pluginRoot?: string): boolean => {
      const { root, cfg } = registeredCheckout(`m-reg-${pluginRoot ? "mut" : "ok"}`, { pluginRoot });
      staleRegistration(root, RUNNING_VERSION);
      const local = readFileSync(join(root, ".claude", "settings.local.json"), "utf-8");
      expect(local).toContain("tool-call-capture.sh");
      expect(local).not.toContain(`"version": "${RUNNING_VERSION}"`);
      const r = runLedgerHook(ledgerPayload(SID, transcriptFor(root), root), { cfg, pluginRoot });
      expect(r.exitCode).toBe(0);
      return existsSync(timelineFile(root, SID));
    };
    expect(staleRow()).toBe(false);
    expect(staleRow(copy)).toBe(true);
  }, T);

  test("MUTATION: moving a fold import before the fast path (a static import atop the entry, in a copy) turns the fast-path row red", () => {
    expect(fastPathFailures(markerCopy("m-order-ok"), "m-order-ok-tree")).toEqual([]);
    const mutated = markerCopy("m-order", (copy) => {
      const entry = join(copy, LEDGER_ENTRY_REL);
      writeFileSync(entry, `import "../../../../${TIMELINE_REL}";\n${readFileSync(entry, "utf-8")}`);
    });
    expect(fastPathFailures(mutated, "m-order-tree")).toContain("loaded tool_call_timeline.ts");
  }, T);
});

// The fold writes nothing outside `.dpt/ledger/tool-calls/` and never reads CLAUDE.md.
describe("AC-STE-717.8 scope of the fold's writes", () => {
  test("a fold run on a registered tree changes only `.dpt/ledger/tool-calls/<sid>.timeline.json`", () => {
    const { root, cfg } = registeredCheckout("fold-scope");
    const before = snapshot(root);
    runLedgerHook(ledgerPayload(SID, transcriptFor(root), root), { cfg });
    const after = snapshot(root);
    const changed = Object.keys(after).filter((k) => after[k] !== before[k]);
    const removed = Object.keys(before).filter((k) => !(k in after));
    expect({ changed, removed }).toEqual({ changed: [`.dpt/ledger/tool-calls/${SID}.timeline.json`], removed: [] });
  }, T);

  test("the entry module resolves the checkout with findCheckoutRoot and prefilters on the tool-call-capture.sh bytes", () => {
    const src = readFileSync(join(PLUGIN_ROOT, LEDGER_ENTRY_REL), "utf-8");
    expect(src).toContain("findCheckoutRoot");
    expect(src).toMatch(/tool-call-capture\.sh/);
  });
});
