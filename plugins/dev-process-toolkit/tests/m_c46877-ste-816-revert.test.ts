// STE-816 (M_c46877) — a settings change is reverted only against its receipt.
//
//   AC-STE-816.1  `propose-revert <root> <key>` reads the newest `retro-change`
//                 receipt in the tree, across every session, with a change for
//                 the key; when the key still holds that change's `to` it prints
//                 `revert <key>: <to> -> <from>` and a final `digest=` line.
//   AC-STE-816.2  no such receipt, or a current value that differs from `to`
//                 (a hand edit): an NFR-10 refusal and no digest line.
//   AC-STE-816.3  `apply` of an approved revert digest sets the key back to
//                 `from`; `from: "absent"` removes the key and each parent the
//                 removal empties (`writeProjectSettings(…, { remove })`), and
//                 never writes a default. One approval admits one apply.
//   AC-STE-816.4  the revert writes its own `retro-change` receipt with
//                 `changes: [{ key, from: <to>, to: <from> }]` and
//                 `revert_of: <applied_at of the reverted receipt>`, no
//                 `trial_id`, and changes nothing else.
//   AC-STE-816.5  reverting `tracking.tool_calls.enabled` leaves
//                 `.claude/settings.local.json` byte-identical, and the capture
//                 then reads its switch as off.
//   AC-STE-816.6  docs/retro-reference.md.
//   AC-STE-816.7  is the full-suite gate the orchestrator runs; no test here.
//
// Shape assumed (the AC names no apply arguments for a revert): the revert is
// applied with `bun run retro_proposal.ts apply-revert <projectRoot> <key>
// <digest>`, recomputing `propose-revert <projectRoot> <key>`; the transcript
// approval is a real `propose-revert` call whose result printed the lines,
// followed by an AskUserQuestion repeating every printed line answered
// `Apply the shown change` — the STE-728 gate with the revert verb. A refusal
// of `propose-revert` is graded on stdout+stderr together.
//
// Fixtures are temp git checkouts outside the repo (the STE-728 helpers); every
// session id and record uuid is synthetic.

import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import {
  APPLY_LABEL,
  IGNORE_LOCAL,
  LOCAL_SETTINGS,
  MODULE,
  NFR10_RE,
  PLUGIN_ROOT,
  SETTINGS_HEAD,
  GATE_OUTCOMES_OFF,
  TOKEN_STATS_OFF,
  TOOL_CALLS_OFF,
  rules,
  type RuleRow,
  Transcript,
  applyApproved,
  approve,
  captureStatus,
  cleanupTemps,
  digestOf,
  makeTree,
  printedLines,
  receiptFiles,
  retroApplyReceipts,
  runProposal,
  settingsPath,
  sid,
  snapshot,
  tempDir,
  questionFor,
  without,
  writeReport,
  type RunResult,
} from "./_m_d1b4b7_ste728_fixture";

afterAll(cleanupTemps);

const LONG = 120_000;
const TOKEN_KEY = "tracking.token_stats.enabled";
const TOOL_KEY = "tracking.tool_calls.enabled";
const RETRO_REFERENCE = join(PLUGIN_ROOT, "docs", "retro-reference.md");
const DIGEST_LINE = /^digest=sha256:[0-9a-f]{64}$/;

// ------------------------------------------------------------------ helpers

function proposeRevert(root: string, key: string): RunResult {
  return runProposal(["propose-revert", root, key], { cwd: root });
}

function settingsObj(root: string): any {
  return Bun.YAML.parse(readFileSync(settingsPath(root), "utf-8"));
}

function receiptsOf(root: string, session: string): any[] {
  return receiptFiles(root, session).map((rel) => JSON.parse(readFileSync(join(root, rel), "utf-8")));
}

function changeReceipts(root: string, session: string): any[] {
  return receiptsOf(root, session).filter((r) => r.kind === "retro-change");
}

function hasDigestLine(text: string): boolean {
  return text.split("\n").some((l) => l.startsWith("digest="));
}

interface RevertApproval {
  root: string;
  key: string;
  stdout: string;
  lines: string[];
  digest: string;
  configDir: string;
  session: string;
  answerUuid: string;
}

/**
 * Run the real `propose-revert`, then write a transcript holding its call and
 * result and an AskUserQuestion repeating every printed line answered
 * `Apply the shown change`.
 */
function approveRevert(label: string, root: string, key: string, session: string): RevertApproval {
  const configDir = tempDir(`${label}-config`);
  const p = proposeRevert(root, key);
  if (p.status !== 0 || !hasDigestLine(p.stdout)) {
    throw new Error(`propose-revert printed no digest (status ${p.status}):\nstdout:\n${p.stdout}\nstderr:\n${p.stderr}`);
  }
  const lines = printedLines(p.stdout);
  const digest = digestOf(p.stdout);
  const t = new Transcript(session, root);
  t.bash(`bun run ${MODULE} propose-revert ${root} ${key}`, p.stdout.trimEnd());
  const answerUuid = t.ask(questionFor(lines), APPLY_LABEL);
  t.writeTo(configDir, root);
  return { root, key, stdout: p.stdout, lines, digest, configDir, session, answerUuid };
}

function applyRevert(a: RevertApproval): RunResult {
  return runProposal(["apply-revert", a.root, a.key, a.digest], { cwd: a.root, configDir: a.configDir, session: a.session });
}

/** A forward STE-728 apply in session sid(28); returns its retro-change receipt. */
async function forward(label: string, root: string, which: "token" | "tool"): Promise<any> {
  const report = await writeReport(`${label}-fwd`, which === "token" ? TOKEN_STATS_OFF() : TOOL_CALLS_OFF());
  const a = approve(`${label}-fwd`, root, report, { session: sid(28) });
  const r = applyApproved(a);
  if (r.status !== 0) throw new Error(`forward apply failed (status ${r.status}):\n${r.stderr}`);
  const changes = changeReceipts(root, sid(28));
  if (changes.length !== 1) throw new Error(`forward apply wrote ${changes.length} retro-change receipts`);
  return changes[0];
}

/** Write one synthetic `retro-change` receipt file into `session`'s directory. */
function plantChangeReceipt(
  root: string,
  session: string,
  appliedAt: string,
  change: { key: string; from: unknown; to: unknown },
): string {
  const dir = join(root, ".dpt", "ledger", "receipts", session);
  mkdirSync(dir, { recursive: true });
  const receipt = {
    v: 1,
    kind: "retro-change",
    sessionId: session,
    root,
    adapter: null,
    container: null,
    subject: "dev-process-toolkit:retro",
    decision: "apply",
    evidence: { digest: `sha256:${"0".repeat(64)}`, applied_at: appliedAt, changes: [change] },
    createdAt: appliedAt,
  };
  const path = join(dir, `${appliedAt.replace(/[:.]/g, "-")}-0000abcd.json`);
  writeFileSync(path, `${JSON.stringify(receipt)}\n`);
  return path;
}

const TOKEN_ON = `${SETTINGS_HEAD}tracking:\n  token_stats:\n    enabled: true\n  gate_outcomes:\n    enabled: false\n  tool_calls:\n    enabled: false\n`;
const NO_TOKEN = `${SETTINGS_HEAD}tracking:\n  gate_outcomes:\n    enabled: false\n  tool_calls:\n    enabled: false\n`;

// ------------------------------------------------------------------ AC.1

describe("AC-STE-816.1 propose-revert prints the revert of the newest change receipt", () => {
  test(
    "after a false -> true apply: exactly `revert <key>: true -> false` and a final digest line",
    async () => {
      const root = makeTree("816-ac1-print");
      await forward("816-ac1-print", root, "token");
      const p = proposeRevert(root, TOKEN_KEY);
      expect(p.status).toBe(0);
      const lines = printedLines(p.stdout);
      expect(lines).toHaveLength(2);
      expect(lines[0]).toBe(`revert ${TOKEN_KEY}: true -> false`);
      expect(lines[1]).toMatch(DIGEST_LINE);
    },
    LONG,
  );

  test(
    "after an absent -> true apply: the recorded from is printed as `absent`",
    async () => {
      const root = makeTree("816-ac1-absent", { settings: NO_TOKEN });
      await forward("816-ac1-absent", root, "token");
      const lines = printedLines(proposeRevert(root, TOKEN_KEY).stdout);
      expect(lines[0]).toBe(`revert ${TOKEN_KEY}: true -> absent`);
      expect(lines[lines.length - 1]).toMatch(DIGEST_LINE);
    },
    LONG,
  );

  test("the newest receipt by applied_at wins across sessions, whatever the session directory order", () => {
    const root = makeTree("816-ac1-newest", { settings: TOKEN_ON });
    // Older change in a session that sorts LAST; newer change in one that sorts first.
    plantChangeReceipt(root, sid(99), "2026-11-01T10:00:00.000Z", { key: TOKEN_KEY, from: true, to: false });
    plantChangeReceipt(root, sid(11), "2026-11-10T10:00:00.000Z", { key: TOKEN_KEY, from: "absent", to: true });
    const p = proposeRevert(root, TOKEN_KEY);
    expect(p.status).toBe(0);
    const lines = printedLines(p.stdout);
    expect(lines[0]).toBe(`revert ${TOKEN_KEY}: true -> absent`);
    expect(lines[lines.length - 1]).toMatch(DIGEST_LINE);
  });

  test("a receipt holding a change for another key only does not count; one for the key in the same receipt does", () => {
    const root = makeTree("816-ac1-multi", { settings: TOKEN_ON });
    const dir = join(root, ".dpt", "ledger", "receipts", sid(12));
    mkdirSync(dir, { recursive: true });
    const at = "2026-11-12T10:00:00.000Z";
    writeFileSync(
      join(dir, "2026-11-12T10-00-00-000Z-0000beef.json"),
      `${JSON.stringify({
        v: 1,
        kind: "retro-change",
        sessionId: sid(12),
        root,
        adapter: null,
        container: null,
        subject: "dev-process-toolkit:retro",
        decision: "apply",
        evidence: {
          digest: `sha256:${"1".repeat(64)}`,
          applied_at: at,
          changes: [
            { key: TOOL_KEY, from: false, to: true },
            { key: TOKEN_KEY, from: false, to: true },
          ],
        },
        createdAt: at,
      })}\n`,
    );
    const lines = printedLines(proposeRevert(root, TOKEN_KEY).stdout);
    expect(lines[0]).toBe(`revert ${TOKEN_KEY}: true -> false`);
    expect(lines).toHaveLength(2);
  });
});

// ------------------------------------------------------------------ AC.2

describe("AC-STE-816.2 propose-revert refuses without a receipt or over a hand edit", () => {
  test("no retro-change receipt in the tree: NFR-10 refusal naming the key, no digest line", () => {
    const root = makeTree("816-ac2-none", { settings: TOKEN_ON });
    const p = proposeRevert(root, TOKEN_KEY);
    const out = `${p.stdout}\n${p.stderr}`;
    expect(out).toMatch(NFR10_RE);
    expect(out).toContain(TOKEN_KEY);
    expect(hasDigestLine(out)).toBe(false);
  });

  test("receipts exist but none changes the key: NFR-10 refusal, no digest line", () => {
    const root = makeTree("816-ac2-otherkey", { settings: TOKEN_ON });
    plantChangeReceipt(root, sid(13), "2026-11-13T10:00:00.000Z", { key: TOOL_KEY, from: false, to: true });
    const p = proposeRevert(root, TOKEN_KEY);
    const out = `${p.stdout}\n${p.stderr}`;
    expect(out).toMatch(NFR10_RE);
    expect(out).toContain(TOKEN_KEY);
    expect(hasDigestLine(out)).toBe(false);
  });

  test(
    "the key hand-edited since the change: NFR-10 refusal naming the key, the receipt and both values, no digest line",
    async () => {
      const root = makeTree("816-ac2-hand");
      const fwd = await forward("816-ac2-hand", root, "token");
      const receiptName = basename(receiptFiles(root, sid(28)).find((rel) => JSON.parse(readFileSync(join(root, rel), "utf-8")).kind === "retro-change")!);
      // The operator turns token_stats back off by hand (the receipt says it was set to true).
      const text = readFileSync(settingsPath(root), "utf-8");
      const edited = text.replace(/(token_stats:\n\s+enabled:) true/, "$1 false");
      expect(edited).not.toBe(text);
      writeFileSync(settingsPath(root), edited);

      const p = proposeRevert(root, TOKEN_KEY);
      const out = `${p.stdout}\n${p.stderr}`;
      expect(out).toMatch(NFR10_RE);
      expect(out).toContain(TOKEN_KEY);
      expect(out.includes(receiptName) || out.includes(fwd.evidence.applied_at)).toBe(true);
      const refusal = out.slice(out.indexOf("Refusing:"));
      expect(refusal).toContain("true");
      expect(refusal).toContain("false");
      expect(hasDigestLine(out)).toBe(false);
    },
    LONG,
  );
});

// ------------------------------------------------------------------ AC.3

describe("AC-STE-816.3 an approved revert sets the key back, absent as absent", () => {
  test(
    "a change then a revert: the key is back to false and every other setting is as before",
    async () => {
      const root = makeTree("816-ac3-back");
      const before = settingsObj(root);
      await forward("816-ac3-back", root, "token");
      expect(settingsObj(root).tracking.token_stats.enabled).toBe(true);
      const a = approveRevert("816-ac3-back", root, TOKEN_KEY, sid(29));
      const r = applyRevert(a);
      expect(r.status).toBe(0);
      expect(settingsObj(root)).toEqual(before);
    },
    LONG,
  );

  test(
    "an absent-from revert removes the key and the parent mapping it empties, writing no default",
    async () => {
      const root = makeTree("816-ac3-absent", { settings: NO_TOKEN });
      const before = settingsObj(root);
      await forward("816-ac3-absent", root, "token");
      expect(settingsObj(root).tracking.token_stats).toEqual({ enabled: true });
      const r = applyRevert(approveRevert("816-ac3-absent", root, TOKEN_KEY, sid(29)));
      expect(r.status).toBe(0);
      const after = settingsObj(root);
      expect(after).toEqual(before);
      expect(Object.keys(after.tracking).sort()).toEqual(["gate_outcomes", "tool_calls"]);
      expect(readFileSync(settingsPath(root), "utf-8")).not.toContain("token_stats");
    },
    LONG,
  );

  test(
    "one approval admits one apply: a revert refused after consuming its approval refuses again as consumed",
    async () => {
      const root = makeTree("816-ac3-consumed");
      await forward("816-ac3-consumed", root, "token");
      const a = approveRevert("816-ac3-consumed", root, TOKEN_KEY, sid(29));
      // A fresh foreign lock makes the write step refuse after the approval is consumed.
      const lock = join(root, "specs", "settings.yaml.lock");
      writeFileSync(lock, "held by another writer\n");
      const first = applyRevert(a);
      expect(first.status).toBe(1);
      expect(first.stderr).toMatch(NFR10_RE);
      rmSync(lock, { force: true });
      expect(settingsObj(root).tracking.token_stats.enabled).toBe(true);

      const second = applyRevert(a);
      expect(second.status).toBe(1);
      expect(second.stderr).toMatch(NFR10_RE);
      expect(second.stderr).toMatch(/consumed/);
      expect(settingsObj(root).tracking.token_stats.enabled).toBe(true);
      expect(changeReceipts(root, sid(29))).toEqual([]);
      expect(retroApplyReceipts(root, sid(29))).toHaveLength(1);
      expect(retroApplyReceipts(root, sid(29))[0].evidence).toEqual({ answer: a.answerUuid, digest: a.digest });
    },
    LONG,
  );

  test(
    "a revert digest with no approving answer in the transcript refuses and writes nothing",
    async () => {
      const root = makeTree("816-ac3-unapproved");
      await forward("816-ac3-unapproved", root, "token");
      const p = proposeRevert(root, TOKEN_KEY);
      const digest = digestOf(p.stdout);
      const configDir = tempDir("816-ac3-unapproved-config");
      const t = new Transcript(sid(29), root);
      t.bash(`bun run ${MODULE} propose-revert ${root} ${TOKEN_KEY}`, p.stdout.trimEnd());
      t.ask(questionFor(printedLines(p.stdout)), "Leave settings unchanged");
      t.writeTo(configDir, root);
      const r = runProposal(["apply-revert", root, TOKEN_KEY, digest], { cwd: root, configDir, session: sid(29) });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(NFR10_RE);
      expect(settingsObj(root).tracking.token_stats.enabled).toBe(true);
      expect(receiptFiles(root, sid(29))).toEqual([]);
    },
    LONG,
  );

  test("writeProjectSettings opts.remove drops the leaf and every parent it leaves empty", async () => {
    const root = makeTree("816-ac3-remove-all", { settings: `${SETTINGS_HEAD}tracking:\n  token_stats:\n    enabled: true\n` });
    const { writeProjectSettings } = (await import("../adapters/_shared/src/project_settings_writer")) as Record<string, any>;
    writeProjectSettings(root, {}, { remove: [TOKEN_KEY] });
    const after = settingsObj(root);
    expect(after).toEqual({ schema_version: 1, min_dpt_version: "3.0.0" });
    expect(readFileSync(settingsPath(root), "utf-8")).not.toContain("tracking");
  });

  test("writeProjectSettings opts.remove keeps a parent that still holds a sibling", async () => {
    const root = makeTree("816-ac3-remove-one", { settings: TOKEN_ON });
    const { writeProjectSettings } = (await import("../adapters/_shared/src/project_settings_writer")) as Record<string, any>;
    writeProjectSettings(root, {}, { remove: [TOKEN_KEY] });
    expect(settingsObj(root).tracking).toEqual({ gate_outcomes: { enabled: false }, tool_calls: { enabled: false } });
  });
});

// ------------------------------------------------- Stage B review fixes

describe("STE-816 review: the revert proposal binds what it will do", () => {
  test("a receipt whose applied_at is not a date never wins over a real one", () => {
    const root = makeTree("816-rv-badtime", { settings: TOKEN_ON });
    plantChangeReceipt(root, sid(41), "2026-11-10T10:00:00.000Z", { key: TOKEN_KEY, from: false, to: true });
    plantChangeReceipt(root, sid(42), "zzz", { key: TOKEN_KEY, from: "absent", to: true });
    const p = proposeRevert(root, TOKEN_KEY);
    expect(p.status).toBe(0);
    expect(printedLines(p.stdout)[0]).toBe(`revert ${TOKEN_KEY}: true -> false`);
  });

  test("the printed line keeps a value's type: a recorded string from prints quoted", () => {
    const root = makeTree("816-rv-type", { settings: TOKEN_ON });
    plantChangeReceipt(root, sid(43), "2026-11-10T10:00:00.000Z", { key: TOKEN_KEY, from: "false", to: true });
    const p = proposeRevert(root, TOKEN_KEY);
    expect(p.status).toBe(0);
    expect(printedLines(p.stdout)[0]).toBe(`revert ${TOKEN_KEY}: true -> "false"`);
  });

  test(
    "a newer receipt for the key landing after the approval makes apply-revert refuse: the digest names the receipt",
    () => {
      const root = makeTree("816-rv-newer", { settings: TOKEN_ON });
      plantChangeReceipt(root, sid(44), "2026-11-10T10:00:00.000Z", { key: TOKEN_KEY, from: false, to: true });
      const a = approveRevert("816-rv-newer", root, TOKEN_KEY, sid(45));
      plantChangeReceipt(root, sid(46), "2026-11-11T10:00:00.000Z", { key: TOKEN_KEY, from: false, to: true });
      const r = applyRevert(a);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(NFR10_RE);
      expect(settingsObj(root).tracking.token_stats).toEqual({ enabled: true });
    },
    LONG,
  );

  test("a key outside the proposable table refuses in the NFR-10 shape, naming the key", () => {
    const root = makeTree("816-rv-key", { settings: TOKEN_ON });
    const p = proposeRevert(root, "tracking.token_stats.enabled.extra");
    expect(p.status).not.toBe(0);
    const out = `${p.stdout}\n${p.stderr}`;
    expect(out).toMatch(NFR10_RE);
    expect(out).toContain("tracking.token_stats.enabled.extra");
    expect(hasDigestLine(p.stdout)).toBe(false);
  });

  test("writeProjectSettings opts.remove of a missing leaf leaves an existing empty mapping alone", async () => {
    const root = makeTree("816-rv-empty", { settings: `${SETTINGS_HEAD}optimizations: {}\n` });
    const before = readFileSync(settingsPath(root), "utf-8");
    const { writeProjectSettings } = (await import("../adapters/_shared/src/project_settings_writer")) as Record<string, any>;
    writeProjectSettings(root, {}, { remove: ["optimizations.gate_commands"] });
    expect(readFileSync(settingsPath(root), "utf-8")).toBe(before);
  });
});

// ------------------------------------------- PR #142 review: unset stays unset

// The loader fills in defaults, so reading a key through it called an unset key `false`.
// A forward apply then recorded that default as `from`, and the revert wrote it. Each case
// starts with the key unset, applies the forward change, reverts it, and asserts the key is
// unset again: the receipt says "absent" and the file holds no trace of the key.
const tripped = (id: string): RuleRow => ({ id, disposition: "tripped", reason: null });
const keyIn = (obj: any, key: string): boolean => {
  let v = obj;
  for (const part of key.split(".")) {
    if (v === null || typeof v !== "object" || !(part in v)) return false;
    v = v[part];
  }
  return true;
};

async function absentRoundTrip(label: string, settings: string, report: () => RuleRow[], key: string): Promise<string> {
  const root = makeTree(label, { settings, gitignore: IGNORE_LOCAL });
  expect(keyIn(settingsObj(root) ?? {}, key)).toBe(false);
  const fwdRun = applyApproved(approve(`${label}-fwd`, root, await writeReport(`${label}-fwd`, report()), { session: sid(28) }));
  expect(fwdRun.status).toBe(0);
  const fwd = changeReceipts(root, sid(28))
    .flatMap((c: any) => c.evidence.changes)
    .find((c: any) => c.key === key);
  expect(fwd?.from).toBe("absent");
  const a = approveRevert(`${label}-rev`, root, key, sid(29));
  expect(a.lines[0]).toBe(`revert ${key}: ${JSON.stringify(fwd.to)} -> absent`);
  const rev = applyRevert(a);
  expect(rev.status).toBe(0);
  expect(keyIn(settingsObj(root) ?? {}, key)).toBe(false);
  return root;
}

describe("PR #142 review: an unset key is recorded as absent and reverted to absent, never to a default", () => {
  test(
    "tracking.tool_calls unset inside an existing tracking map",
    async () => {
      await absentRoundTrip(
        "816-rv-abs-tool",
        `${SETTINGS_HEAD}tracking:\n  token_stats:\n    enabled: false\n  gate_outcomes:\n    enabled: false\n`,
        TOOL_CALLS_OFF,
        TOOL_KEY,
      );
    },
    LONG,
  );

  test(
    "tracking.gate_outcomes unset inside an existing tracking map",
    () =>
      absentRoundTrip(
        "816-rv-abs-gate",
        `${SETTINGS_HEAD}tracking:\n  token_stats:\n    enabled: false\n  tool_calls:\n    enabled: false\n`,
        GATE_OUTCOMES_OFF,
        "tracking.gate_outcomes.enabled",
      ),
    LONG,
  );

  test(
    "optimizations.gate_commands unset with no optimizations section",
    () =>
      absentRoundTrip(
        "816-rv-abs-opt",
        `${SETTINGS_HEAD}tracking:\n  token_stats:\n    enabled: false\n  gate_outcomes:\n    enabled: true\n  tool_calls:\n    enabled: false\n`,
        () => rules([tripped("gate_rerun_unchanged_key")]),
        "optimizations.gate_commands",
      ),
    LONG,
  );

  test(
    "a revert of that revert sees the unset key as holding the receipt's absent, and proposes the way back",
    async () => {
      const label = "816-rv-abs-rerev";
      const root = await absentRoundTrip(label, `${SETTINGS_HEAD}tracking:\n  token_stats:\n    enabled: false\n  gate_outcomes:\n    enabled: false\n`, TOOL_CALLS_OFF, TOOL_KEY);
      const p = proposeRevert(root, TOOL_KEY);
      expect(p.status).toBe(0);
      expect(printedLines(p.stdout)[0]).toBe(`revert ${TOOL_KEY}: absent -> true`);
    },
    LONG,
  );

  test(
    "tracking.token_stats on a tree with no tracking section at all",
    () => absentRoundTrip("816-rv-abs-notracking", SETTINGS_HEAD, TOKEN_STATS_OFF, TOKEN_KEY),
    LONG,
  );
});

// ------------------------------------------------------------------ AC.4

describe("AC-STE-816.4 a revert writes its own retro-change receipt", () => {
  test(
    "the revert receipt: changes [{ key, from: true, to: false }], revert_of the forward applied_at, its own digest",
    async () => {
      const root = makeTree("816-ac4-receipt");
      const fwd = await forward("816-ac4-receipt", root, "token");
      const a = approveRevert("816-ac4-receipt", root, TOKEN_KEY, sid(29));
      expect(applyRevert(a).status).toBe(0);
      const changes = changeReceipts(root, sid(29));
      expect(changes).toHaveLength(1);
      expect(changes[0]).toMatchObject({ kind: "retro-change", subject: "dev-process-toolkit:retro", adapter: null, container: null });
      const ev = changes[0].evidence;
      expect(ev.changes).toEqual([{ key: TOKEN_KEY, from: true, to: false }]);
      expect(ev.revert_of).toBe(fwd.evidence.applied_at);
      expect(ev.digest).toBe(a.digest);
      expect(ev.applied_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
    },
    LONG,
  );

  test(
    "an absent-from revert records to: \"absent\"",
    async () => {
      const root = makeTree("816-ac4-absent", { settings: NO_TOKEN });
      await forward("816-ac4-absent", root, "token");
      expect(applyRevert(approveRevert("816-ac4-absent", root, TOKEN_KEY, sid(29))).status).toBe(0);
      expect(changeReceipts(root, sid(29))[0].evidence.changes).toEqual([{ key: TOKEN_KEY, from: true, to: "absent" }]);
    },
    LONG,
  );

  test(
    "the revert session holds exactly a retro-apply and a retro-change, and no receipt file names trial_id",
    async () => {
      const root = makeTree("816-ac4-trial");
      await forward("816-ac4-trial", root, "token");
      expect(applyRevert(approveRevert("816-ac4-trial", root, TOKEN_KEY, sid(29))).status).toBe(0);
      expect(receiptsOf(root, sid(29)).map((r) => r.kind).sort()).toEqual(["retro-apply", "retro-change"]);
      for (const rel of receiptFiles(root, sid(29))) {
        expect(readFileSync(join(root, rel), "utf-8")).not.toContain("trial_id");
      }
    },
    LONG,
  );

  test(
    "the revert changes the settings file and adds its two receipts, and nothing else in the tree",
    async () => {
      const root = makeTree("816-ac4-nothing-else");
      await forward("816-ac4-nothing-else", root, "token");
      const pre = snapshot(root);
      expect(applyRevert(approveRevert("816-ac4-nothing-else", root, TOKEN_KEY, sid(29))).status).toBe(0);
      const post = snapshot(root);
      const added = receiptFiles(root, sid(29));
      expect(added).toHaveLength(2);
      expect(post["specs/settings.yaml"]).not.toBe(pre["specs/settings.yaml"]);
      expect(without(post, ["specs/settings.yaml", ...added])).toEqual(without(pre, ["specs/settings.yaml"]));
    },
    LONG,
  );

  test(
    "settings bytes changed after the approval: the revert refuses, the key keeps its value, no retro-change",
    async () => {
      const root = makeTree("816-ac4-stale");
      await forward("816-ac4-stale", root, "token");
      const a = approveRevert("816-ac4-stale", root, TOKEN_KEY, sid(29));
      writeFileSync(settingsPath(root), `${readFileSync(settingsPath(root), "utf-8")}# edited by another writer\n`);
      const r = applyRevert(a);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(NFR10_RE);
      expect(settingsObj(root).tracking.token_stats.enabled).toBe(true);
      expect(changeReceipts(root, sid(29))).toEqual([]);
    },
    LONG,
  );

  test(
    "a revert of a revert: propose prints false -> true, apply sets true, revert_of names the first revert",
    async () => {
      const root = makeTree("816-ac4-twice");
      await forward("816-ac4-twice", root, "token");
      expect(applyRevert(approveRevert("816-ac4-twice-1", root, TOKEN_KEY, sid(29))).status).toBe(0);
      const firstRevert = changeReceipts(root, sid(29))[0];
      expect(settingsObj(root).tracking.token_stats.enabled).toBe(false);

      const a = approveRevert("816-ac4-twice-2", root, TOKEN_KEY, sid(30));
      expect(a.lines[0]).toBe(`revert ${TOKEN_KEY}: false -> true`);
      expect(applyRevert(a).status).toBe(0);
      expect(settingsObj(root).tracking.token_stats.enabled).toBe(true);
      const second = changeReceipts(root, sid(30));
      expect(second).toHaveLength(1);
      expect(second[0].evidence.changes).toEqual([{ key: TOKEN_KEY, from: false, to: true }]);
      expect(second[0].evidence.revert_of).toBe(firstRevert.evidence.applied_at);
    },
    LONG,
  );

  test(
    "after an absent-from revert, the revert of it proposes absent -> true",
    async () => {
      const root = makeTree("816-ac4-twice-absent", { settings: NO_TOKEN });
      await forward("816-ac4-twice-absent", root, "token");
      expect(applyRevert(approveRevert("816-ac4-twice-absent", root, TOKEN_KEY, sid(29))).status).toBe(0);
      const lines = printedLines(proposeRevert(root, TOKEN_KEY).stdout);
      expect(lines[0]).toBe(`revert ${TOKEN_KEY}: absent -> true`);
      expect(lines[lines.length - 1]).toMatch(DIGEST_LINE);
    },
    LONG,
  );
});

// ------------------------------------------------------------------ AC.5

describe("AC-STE-816.5 reverting tool_calls leaves the capture registration as it is", () => {
  test(
    "settings.local.json is byte-identical after the revert",
    async () => {
      const root = makeTree("816-ac5-local", { gitignore: IGNORE_LOCAL });
      await forward("816-ac5-local", root, "tool");
      const local = join(root, LOCAL_SETTINGS);
      expect(existsSync(local)).toBe(true);
      const prior = readFileSync(local);
      const a = approveRevert("816-ac5-local", root, TOOL_KEY, sid(29));
      expect(a.lines[0]).toBe(`revert ${TOOL_KEY}: true -> false`);
      expect(applyRevert(a).status).toBe(0);
      expect(settingsObj(root).tracking.tool_calls.enabled).toBe(false);
      expect(readFileSync(local).equals(prior)).toBe(true);
    },
    LONG,
  );

  test(
    "the capture reads its switch as off after the revert (it read on before)",
    async () => {
      const root = makeTree("816-ac5-switch", { gitignore: IGNORE_LOCAL });
      await forward("816-ac5-switch", root, "tool");
      expect(captureStatus(root)).toContain("setting: on");
      expect(applyRevert(approveRevert("816-ac5-switch", root, TOOL_KEY, sid(29))).status).toBe(0);
      expect(captureStatus(root)).toContain("setting: off");
    },
    LONG,
  );
});

// ------------------------------------------------------------------ AC.6

describe("AC-STE-816.6 docs/retro-reference.md describes the revert", () => {
  const doc = readFileSync(RETRO_REFERENCE, "utf-8");
  const at = doc.indexOf("propose-revert");
  const section = at < 0 ? "" : doc.slice(at, at + 4000);

  test("names the propose-revert verb", () => {
    expect(at).toBeGreaterThanOrEqual(0);
  });

  test("describes the no-receipt refusal", () => {
    expect(section).toMatch(/no [^.\n]{0,60}receipt/i);
  });

  test("describes the hand-edit refusal", () => {
    expect(section).toMatch(/by hand|hand[- ]edit/i);
  });

  test("states the absent rule: an absent key comes back absent, never as a default", () => {
    expect(section).toContain("absent");
    expect(section).toMatch(/never [^.\n]{0,40}default/i);
  });
});
