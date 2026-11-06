// M_7bc805 — defaults unchanged (owned by STE-717, the milestone's last FR).
//
// AC-STE-717.13. Operator rule, 2026-11-04: this milestone changes no toolkit
// behaviour by default. The baseline is v3.0.0, the M_94e6f7 merge commit
// (6c62b32c); every literal below is pinned from that commit's bytes, and each
// is ALSO re-derived by running that commit's own modules (`git archive`) on a
// twin of the same fixture, so a literal cannot drift from the code it pins.
//
// Three fixtures:
//   none      — no settings file
//   m94e6f7   — a settings file holding only M_94e6f7 keys
//               (`tracking: { token_stats: { enabled: false } }`)
//   teammate  — the AC-STE-716.21 tree: a committed `tracking.tool_calls`
//               switch and no registration
//
// On each: the receipt calls of /gate-check, /tdd and /spec-review and the
// shipped session-token-ledger.sh. Each output and each written file equals
// its v3.0.0 literal. The outcome CLI is new (STE-715) and has no v3.0.0
// literal; AC-STE-715.13 grades its silence instead, so it is not in the set.
//
// NAMED ALLOWED DIFFERENCES (and nothing else):
//   1. The teammate fixture's probe #69 warn-only `capture-registration` row,
//      and the GATE PASSED WITH NOTES verdict line it causes (AC-STE-716.21).
//   2. The documented `project_settings.ts get tracking` CLI, which no skill
//      calls by default (so it costs no tool call): the `token_stats` closing
//      `  }` becomes `  },` and exactly six lines follow it, the
//      `gate_outcomes` and `tool_calls` blocks. Pinned line for line on a tree
//      with no settings file, a legacy tree, and the m94e6f7 fixture. A
//      `tracking: {}` section is not used for this pin: the merge passes
//      `token_stats` through as written (AC-STE-715.21), so it would print no
//      `token_stats` block (review 8, m8-4).

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import { runUpgradeStalenessProbe } from "../adapters/_shared/src/upgrade_staleness";
import { makeCheckout, recordFor } from "./_m_7bc805_capture_fixture";
import {
  GIT_ENV,
  PLUGIN_REL,
  PLUGIN_ROOT,
  SETTINGS_HEAD,
  atV300,
  cleanupTemps,
  makeTree,
  sentences,
  tempDir,
} from "./_m_7bc805_gate_outcome_fixture";
import { T0, bashUse, runLedgerHook, ledgerPayload, snapshot, toolResult, usageRecord, v300Plugin, writeSessionTranscript } from "./_m_7bc805_timeline_fixture";

const T = 120_000;
const SID = "00000000-0000-4000-8000-000000000713";
const SKILLS = ["gate-check", "tdd", "spec-review"] as const;

afterAll(cleanupTemps);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

type Fixture = "none" | "m94e6f7" | "teammate";
const FIXTURES: readonly Fixture[] = ["none", "m94e6f7", "teammate"];

const M94E6F7_SETTINGS = `${SETTINGS_HEAD}tracking:\n  token_stats:\n    enabled: false\n`;
const TEAMMATE_SETTINGS = `${SETTINGS_HEAD}tracking:\n  tool_calls:\n    enabled: true\n`;

function fixtureTree(label: string, f: Fixture): string {
  const root = makeTree(label, f === "none" ? "none" : "absent");
  if (f !== "none") {
    mkdirSync(join(root, "specs"), { recursive: true });
    writeFileSync(join(root, "specs", "settings.yaml"), f === "m94e6f7" ? M94E6F7_SETTINGS : TEAMMATE_SETTINGS);
    spawnSync("git", ["commit", "-qam", "settings"], { cwd: root, env: { ...process.env, ...GIT_ENV } });
  }
  return root;
}

// ---------------------------------------------------------------------------
// Pinned v3.0.0 literals (normalised: <root>, <sid>, <receipt>, <digest>, <head>, <at>)
// ---------------------------------------------------------------------------

const RECEIPT_STDOUT_V300 = "dpt-receipt: <root>/.dpt/ledger/receipts/<sid>/<receipt> sha256:<digest>\n";
const RECEIPT_JSON_V300 = (skill: string): string =>
  `{"v":1,"kind":"gate","sessionId":"<sid>","root":"<root>","adapter":null,"container":null,"subject":"dev-process-toolkit:${skill}","decision":"ran","evidence":{"head":"<head>"},"createdAt":"<at>"}\n`;
const RECEIPT_FILES_V300 = [".dpt/.gitignore", ".dpt/ledger/receipts/<sid>/<receipt>"];

const GET_TRACKING_V300 = ["{", '  "token_stats": {', '    "enabled": false', "  }", "}", ""].join("\n");
const GET_TRACKING_NOW = [
  "{",
  '  "token_stats": {',
  '    "enabled": false',
  "  },",
  '  "gate_outcomes": {',
  '    "enabled": false',
  "  },",
  '  "tool_calls": {',
  '    "enabled": false',
  "  }",
  "}",
  "",
].join("\n");

/** The named difference 2, as a transformation of the v3.0.0 literal. */
function namedGetTrackingDifference(v300: string): string {
  const lines = v300.split("\n");
  // lines[3] is the closing `  }` of token_stats.
  if (lines[3] !== "  }") throw new Error("v3.0.0 literal changed shape");
  const added = ['  "gate_outcomes": {', '    "enabled": false', "  },", '  "tool_calls": {', '    "enabled": false', "  }"];
  return [...lines.slice(0, 3), "  },", ...added, ...lines.slice(4)].join("\n");
}

function normalise(text: string, root: string, sid: string): string {
  return text
    .split(root)
    .join("<root>")
    .split(sid)
    .join("<sid>")
    .replace(/\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z-[0-9a-f]{8}\.json/g, "<receipt>")
    .replace(/sha256:[0-9a-f]{64}/g, "sha256:<digest>")
    .replace(/"head":"[0-9a-f]{40}"/g, '"head":"<head>"')
    .replace(/"createdAt":"[^"]+"/g, '"createdAt":"<at>"');
}

interface ReceiptRun {
  exitCode: number;
  stdout: string;
  stderr: string;
  files: Record<string, string>;
}

/** Run one receipt call from `pluginRoot` and return its normalised output and the files under `.dpt/`. */
function receiptRun(pluginRoot: string, root: string, skill: string): ReceiptRun {
  const p = spawnSync("bun", ["run", join(pluginRoot, "adapters", "_shared", "src", "gate_receipt.ts"), skill, root], {
    cwd: root,
    encoding: "utf-8",
    env: { ...(process.env as Record<string, string>), ...GIT_ENV, CLAUDE_CODE_SESSION_ID: SID },
  });
  const snap = snapshot(root);
  const files: Record<string, string> = {};
  for (const [k, v] of Object.entries(snap)) {
    if (k.startsWith(".dpt/") || k.startsWith(".claude/")) files[normalise(k, root, SID)] = normalise(v, root, SID);
  }
  return { exitCode: p.status ?? -1, stdout: normalise(p.stdout ?? "", root, SID), stderr: normalise(p.stderr ?? "", root, SID), files };
}

// ---------------------------------------------------------------------------
// Receipt calls
// ---------------------------------------------------------------------------

describe("AC-STE-717.13 receipt calls equal v3.0.0 on every fixture", () => {
  for (const f of FIXTURES) {
    for (const skill of SKILLS) {
      test(`${f}: the /${skill} receipt call's exit code, stdout, stderr and written files equal the v3.0.0 literal and the v3.0.0 run`, () => {
        const now = fixtureTree(`d-${f}-${skill}-now`, f);
        const then = fixtureTree(`d-${f}-${skill}-then`, f);
        const a = receiptRun(PLUGIN_ROOT, now, skill);
        const b = receiptRun(v300Plugin(), then, skill);
        // Pinned literal.
        expect({ code: a.exitCode, out: a.stdout, err: a.stderr }).toEqual({ code: 0, out: RECEIPT_STDOUT_V300, err: "" });
        expect(Object.keys(a.files).sort()).toEqual(RECEIPT_FILES_V300);
        expect(a.files[".dpt/ledger/receipts/<sid>/<receipt>"]).toBe(RECEIPT_JSON_V300(skill));
        // The v3.0.0 run on the twin.
        expect(a).toEqual(b);
        expect(existsSync(join(now, ".claude", "settings.local.json"))).toBe(false);
      }, T);
    }
  }

  test("the pinned receipt literals are the v3.0.0 merge commit's own output (CONTROL against the extracted tree)", () => {
    const then = fixtureTree("d-control", "none");
    const b = receiptRun(v300Plugin(), then, "gate-check");
    expect(b.stdout).toBe(RECEIPT_STDOUT_V300);
    expect(b.files[".dpt/ledger/receipts/<sid>/<receipt>"]).toBe(RECEIPT_JSON_V300("gate-check"));
  }, T);
});

// ---------------------------------------------------------------------------
// session-token-ledger.sh
// ---------------------------------------------------------------------------

describe("AC-STE-717.13 session-token-ledger.sh equals v3.0.0 on every fixture", () => {
  for (const f of FIXTURES) {
    // v3.0.0 refuses `tracking.tool_calls` as an unknown key, so the teammate's
    // baseline is AC-STE-716.21's: the same tree with the setting off, run today
    // (that off tree's own v3.0.0 equality is the m94e6f7 row).
    const baseline = f === "teammate" ? "the same tree with the setting off" : "the v3.0.0 run";
    test(`${f}: exit code, stdout, stderr and every written file equal ${baseline}; no timeline file`, () => {
      const now = fixtureTree(`l-${f}-now`, f);
      const then = fixtureTree(`l-${f}-then`, f === "teammate" ? "m94e6f7" : f);
      if (f === "teammate") writeFileSync(join(then, "specs", "settings.yaml"), SETTINGS_HEAD);
      const records = (root: string): string[] => [
        bashUse("toolu_L1", "ls", T0, { cwd: root }),
        toolResult("toolu_L1", T0 + 10, { isError: false }),
        usageRecord(T0 + 20, "dev-process-toolkit:tdd"),
      ];
      const cfg = recordFor(`l-${f}-rec`, now).cfg;
      const a = runLedgerHook(ledgerPayload(SID, writeSessionTranscript(tempDir("l-tr"), SID, records(now)), now), { cfg });
      const b = runLedgerHook(ledgerPayload(SID, writeSessionTranscript(tempDir("l-tr"), SID, records(then)), then), {
        cfg,
        pluginRoot: f === "teammate" ? PLUGIN_ROOT : v300Plugin(),
      });
      expect({ code: a.exitCode, out: a.stdout, err: normalise(a.stderr, now, SID) }).toEqual({
        code: b.exitCode,
        out: b.stdout,
        err: normalise(b.stderr, then, SID),
      });
      expect({ code: a.exitCode, out: a.stdout, err: a.stderr }).toEqual({ code: 0, out: "", err: "" });
      const sa = snapshot(now);
      const sb = snapshot(then);
      expect(Object.keys(sa).sort()).toEqual(Object.keys(sb).sort());
      for (const k of Object.keys(sa)) if (!(f === "teammate" && k === "specs/settings.yaml")) expect({ k, same: normalise(sa[k]!, now, SID) === normalise(sb[k]!, then, SID) }).toEqual({ k, same: true });
      expect(existsSync(join(now, ".dpt", "ledger", "tool-calls"))).toBe(false);
      expect(Object.keys(sa).some((k) => k.endsWith(".timeline.json"))).toBe(false);
      expect(existsSync(join(now, ".claude", "settings.local.json"))).toBe(false);
    }, T);
  }
});

// ---------------------------------------------------------------------------
// Named difference 2 — `project_settings.ts get tracking`
// ---------------------------------------------------------------------------

function getTracking(pluginRoot: string, root: string): { exitCode: number; stdout: string; stderr: string } {
  const p = spawnSync("bun", ["run", join(pluginRoot, "adapters", "_shared", "src", "project_settings.ts"), "get", "tracking", root], {
    cwd: root,
    encoding: "utf-8",
  });
  return { exitCode: p.status ?? -1, stdout: p.stdout ?? "", stderr: p.stderr ?? "" };
}

describe("AC-STE-717.13 named difference: project_settings.ts get tracking", () => {
  const trees: Record<string, () => string> = {
    "no settings file": () => makeTree("g-none", "none"),
    legacy: () => makeTree("g-legacy", "legacy"),
    "token_stats: { enabled: false }, no new key": () => fixtureTree("g-m94", "m94e6f7"),
  };
  for (const [name, make] of Object.entries(trees)) {
    test(`${name}: v3.0.0 prints its literal; today prints the literal with the named difference, line for line`, () => {
      const root = make();
      const then = getTracking(v300Plugin(), root);
      const now = getTracking(PLUGIN_ROOT, root);
      expect({ code: then.exitCode, out: then.stdout, err: then.stderr }).toEqual({ code: 0, out: GET_TRACKING_V300, err: "" });
      expect({ code: now.exitCode, out: now.stdout, err: now.stderr }).toEqual({ code: 0, out: GET_TRACKING_NOW, err: "" });
      expect(namedGetTrackingDifference(then.stdout)).toBe(now.stdout);
      // Exactly: one changed line, six added lines.
      const a = then.stdout.split("\n");
      const b = now.stdout.split("\n");
      expect(b.length - a.length).toBe(6);
      expect([a[3], b[3]]).toEqual(["  }", "  },"]);
    }, T);
  }

  test("no skill calls `project_settings.ts get` by default (the difference costs no tool call)", () => {
    for (const skill of SKILLS) {
      const text = readFileSync(join(PLUGIN_ROOT, "skills", skill, "SKILL.md"), "utf-8");
      expect({ skill, calls: /project_settings\.ts"?\s+get\b/.test(text) }).toEqual({ skill, calls: false });
    }
  });
});

// ---------------------------------------------------------------------------
// Named difference 1 — the teammate probe #69 row
// ---------------------------------------------------------------------------

function verdict(r: { notes: string[]; violations: unknown[] }): string {
  if (r.violations.length > 0) return "GATE FAILED";
  return r.notes.length > 0 ? "GATE PASSED WITH NOTES" : "GATE PASSED";
}

describe("AC-STE-717.13 named difference: the teammate's capture-registration row", () => {
  const saved = process.env.CLAUDE_CONFIG_DIR;
  afterEach(() => {
    if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = saved;
  });

  test("teammate: probe #69 adds exactly one warn-only `capture-registration` row and the GATE PASSED WITH NOTES verdict line; every other row equals the off fixture", async () => {
    const teammate = makeCheckout("dn-mate", "on");
    const off = makeCheckout("dn-off", "absent");
    process.env.CLAUDE_CONFIG_DIR = recordFor("dn-mate-rec", teammate).cfg;
    const on = await runUpgradeStalenessProbe(teammate);
    const base = await runUpgradeStalenessProbe(off);
    expect(on.rows.filter((r) => r.startsWith("capture-registration (")).length).toBe(1);
    expect(on.rows.filter((r) => !r.startsWith("capture-registration ("))).toEqual(base.rows);
    expect(on.violations).toEqual([]);
    expect(verdict(on)).toBe("GATE PASSED WITH NOTES");
    expect(verdict(base)).toBe("GATE PASSED");
    expect(existsSync(join(teammate, ".claude", "settings.local.json"))).toBe(false);
  }, T);
});

// ---------------------------------------------------------------------------
// hooks.json, and the modelled tool-call rows of AC-STE-715.15
// ---------------------------------------------------------------------------

describe("AC-STE-717.13 hooks.json and modelled tool calls", () => {
  test("hooks/hooks.json is byte-identical to v3.0.0", () => {
    expect(readFileSync(join(PLUGIN_ROOT, "hooks", "hooks.json"), "utf-8")).toBe(atV300(`${PLUGIN_REL}/hooks/hooks.json`));
  });

  // The AC-STE-715.15 modeller, re-run on the finished milestone.
  const GUARDED = [{ module: "gate_receipt.ts", verb: "outcome", condition: "outcome: on" }];
  const SWITCH_LINE_RE = /`([a-z_]+: on)`/g;
  const BUN_RUN_RE = /bun run\s+"?([^\s"`]+?\.ts)"?(?:[ \t]+([a-z][a-z0-9-]*)(?=[\s"`]|$))?/gm;
  const V300_CALLS: Record<string, readonly string[]> = {
    "gate-check": [
      "gate_receipt.ts gate-check",
      "capture_skip_baseline.ts",
      "task_tracking_workspace_binding_present.ts",
      "tracker_local_reconciliation_drift.ts",
      "check_marker_runtime.ts",
      "video_commit_nudge.ts",
    ],
    tdd: ["gate_receipt.ts tdd"],
    "spec-review": ["gate_receipt.ts spec-review"],
  };
  function modelRun(text: string, receiptStdout: string): string[] {
    const printed = new Set(receiptStdout.split("\n"));
    const issued: string[] = [];
    for (const s of sentences(text)) {
      for (const m of s.matchAll(BUN_RUN_RE)) {
        const module = basename(m[1]!);
        const verb = m[2];
        const row = GUARDED.find((r) => r.module === module && r.verb === verb);
        const named = [...s.matchAll(SWITCH_LINE_RE)].map((x) => x[1]!);
        if (row !== undefined && named.includes(row.condition) && !printed.has(row.condition)) continue;
        issued.push(verb ? `${module} ${verb}` : module);
      }
    }
    return issued;
  }

  test("CONTROL: the modeller reproduces each v3.0.0 list from the v3.0.0 SKILL.md bytes", () => {
    for (const skill of SKILLS) {
      expect({ skill, calls: modelRun(atV300(`${PLUGIN_REL}/skills/${skill}/SKILL.md`), "") }).toEqual({ skill, calls: [...V300_CALLS[skill]!] });
    }
  });

  for (const f of FIXTURES) {
    test(`${f}: every switch off, /gate-check, /tdd and /spec-review issue exactly their v3.0.0 tool calls`, () => {
      for (const skill of SKILLS) {
        const root = fixtureTree(`m-${f}-${skill}`, f);
        const stdout = spawnSync("bun", ["run", join(PLUGIN_ROOT, "adapters", "_shared", "src", "gate_receipt.ts"), skill, root], {
          cwd: root,
          encoding: "utf-8",
          env: { ...(process.env as Record<string, string>), ...GIT_ENV, CLAUDE_CODE_SESSION_ID: SID },
        }).stdout;
        const text = readFileSync(join(PLUGIN_ROOT, "skills", skill, "SKILL.md"), "utf-8");
        expect({ skill, calls: modelRun(text, stdout ?? "") }).toEqual({ skill, calls: [...V300_CALLS[skill]!] });
      }
    }, T);
  }
});

// ---------------------------------------------------------------------------
// One byte of a pinned literal
// ---------------------------------------------------------------------------

describe("AC-STE-717.13 every pinned literal is load-bearing", () => {
  test("editing one pinned literal by one byte turns the comparison red", () => {
    const root = fixtureTree("byte", "none");
    const a = receiptRun(PLUGIN_ROOT, root, "gate-check");
    const getNow = getTracking(PLUGIN_ROOT, makeTree("byte-get", "none")).stdout;
    const pins: Array<[string, string]> = [
      [RECEIPT_STDOUT_V300, a.stdout],
      [RECEIPT_JSON_V300("gate-check"), a.files[".dpt/ledger/receipts/<sid>/<receipt>"] ?? ""],
      [GET_TRACKING_NOW, getNow],
      [GET_TRACKING_V300, getTracking(v300Plugin(), makeTree("byte-get-v300", "none")).stdout],
    ];
    for (const [literal, actual] of pins) {
      expect(actual).toBe(literal);
      const i = Math.floor(literal.length / 2);
      const flipped = literal.slice(0, i) + (literal[i] === "x" ? "y" : "x") + literal.slice(i + 1);
      expect(flipped.length).toBe(literal.length);
      expect(actual === flipped).toBe(false);
    }
  }, T);
});
