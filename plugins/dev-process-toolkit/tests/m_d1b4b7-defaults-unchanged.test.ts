// M_d1b4b7 — defaults unchanged (owned by STE-722, AC-STE-722.12).
//
// Operator rule, 2026-11-04: this milestone changes no toolkit behaviour by
// default. The baseline is v3.0.0, the M_94e6f7 merge commit 9dab5086 (its
// plugin tree is byte-identical to 6c62b32c). Every literal below was measured
// on 2026-11-06 by running that commit's own modules (`git archive`) on twins
// of these fixtures, and is pasted here; nothing is re-read from a ref at test
// time.
//
// Three fixtures, each carrying a ledger on which one retro rule WOULD trip,
// so a silent retro offer is the switch's doing and not an empty ledger's:
//   none      — no settings file
//   keys      — a settings file holding only M_94e6f7 and M_7bc805 keys
//               (orchestration, tracking.{token_stats,gate_outcomes,tool_calls}
//               all false, close_out.upgrade_offer false)
//   upgrade   — close_out.upgrade_offer on, the retro switch absent
//
// On each: gate_capture.ts, deliver_decision.ts, upgrade_offer.ts and
// retro_offer.ts. Each stdout equals its v3.0.0 literal (retro_offer.ts, being
// new, prints nothing) and no file is written. The modelled /implement and
// /deliver close-outs take their reached offers from those real outputs and
// record no operator turn and no retro_offer.ts call.
//
// NAMED ACCEPTED DIFFERENCE (and nothing else): the documented
// `project_settings.ts get` CLI, which no skill calls by default —
//   1. `get tracking` prints the gate_outcomes and tool_calls blocks as
//      STE-717 pins it (M_7bc805);
//   2. `get retro` exits 0 and prints `{`, `  "enabled": false`, `}` where
//      v3.0.0 refused it with exit 1;
//   3. the `get` refusal's `Remedy:` section list gains `retro` after `close_out`.
// Every other `get` output equals v3.0.0.
//
// /report-issue without a flag issues no new call (STE-720), so it has no
// named difference here. `retro_proposal.ts apply` (STE-728) is asserted never
// reached by default: no default close-out issues a `retro_proposal.ts` call.

import { afterAll, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";

import { modelRun, stepExecutionCounts } from "../adapters/_shared/src/continuation_offer";
import {
  DELIVER_DECISION_V300,
  DELIVER_RETRO,
  DELIVER_SKILL,
  DELIVER_UPGRADE,
  FR_ID,
  GATE_CAPTURE_V300,
  IMPLEMENT_RETRO,
  IMPLEMENT_SKILL,
  IMPLEMENT_UPGRADE,
  MILESTONE,
  PROJECT_SETTINGS,
  RETRO_ON,
  UPGRADE_ON,
  cleanupTemps,
  describeRun,
  offerTree,
  read,
  runDeliverDecision,
  runGateCapture,
  runRetroOffer,
  runUpgradeOffer,
  sentencesOf,
  settingsYaml,
  spawnModule,
  trailingSwitchLines,
} from "./_m_d1b4b7_ste722_fixture";

afterAll(cleanupTemps);

const T = 240_000;

type Fixture = "none" | "keys" | "upgrade";
const FIXTURES: readonly Fixture[] = ["none", "keys", "upgrade"];

function fixtureTree(label: string, f: Fixture): string {
  const settings =
    f === "none" ? null : f === "keys" ? settingsYaml({ tokenStats: false, upgrade: "false" }) : settingsYaml({ upgrade: "true" });
  return offerTree(label, settings, { ledger: "tripped" });
}

// ---------------------------------------------------------------------------
// Pinned v3.0.0 literals
// ---------------------------------------------------------------------------

const V300_STDOUT: Record<Fixture, { gate: string; deliver: string; upgrade: string }> = {
  none: { gate: GATE_CAPTURE_V300, deliver: DELIVER_DECISION_V300, upgrade: "" },
  keys: { gate: GATE_CAPTURE_V300, deliver: DELIVER_DECISION_V300, upgrade: "" },
  upgrade: { gate: `${GATE_CAPTURE_V300}${UPGRADE_ON}\n`, deliver: `${DELIVER_DECISION_V300}${UPGRADE_ON}\n`, upgrade: "" },
};

interface Out {
  code: number;
  out: string;
  err: string;
}
const ok = (out: string): Out => ({ code: 0, out, err: "" });
const json = (lines: string[]): string => `${lines.join("\n")}\n`;

const V300_SECTIONS = "task_tracking, verification, docs, orchestration, tracking, close_out, release, video";
const NOW_SECTIONS = "task_tracking, verification, docs, orchestration, tracking, close_out, retro, release, video";
const notASection = (section: string, list: string): Out => ({
  code: 1,
  out: "",
  err: `Refusing: \`${section}\` is not a settings section\nRemedy: get one of: ${list}.\nContext: verb=get, section=${section}\n`,
});

const TRACKING_V300 = ok(json(["{", '  "token_stats": {', '    "enabled": false', "  }", "}"]));
const TRACKING_NOW = ok(
  json(["{", '  "token_stats": {', '    "enabled": false', "  },", '  "gate_outcomes": {', '    "enabled": false', "  },", '  "tool_calls": {', '    "enabled": false', "  }", "}"]),
);
const close = (on: boolean): Out => ok(json(["{", '  "upgrade_offer": {', `    "enabled": ${on}`, "  }", "}"]));
const orchestration = (effort: string): Out => ok(json(["{", `  "default_effort": "${effort}",`, '  "merge_policy": "offer"', "}"]));
const RELEASE = ok(json(["{", '  "files": []', "}"]));
const VIDEO = ok(json(["{", '  "config": null,', '  "style": null', "}"]));
const SETTINGS_FILE_SPARSE = { task_tracking: ok(json(["{", '  "mode": "none"', "}"])), verification: ok("{}\n"), docs: ok("{}\n") };

/** `project_settings.ts get <section>` on each fixture, at v3.0.0. */
const V300_GET: Record<Fixture, Record<string, Out>> = {
  none: {
    task_tracking: ok(json(["{", '  "mode": "none",', '  "milestone_scan_fetch": false,', '  "status_vocabulary": null', "}"])),
    verification: ok(json(["{", '  "verify_skill": null,', '  "verify_mode": "advisory",', '  "run_cmd": null,', '  "e2e_cmd": null', "}"])),
    docs: ok(json(["{", '  "user_facing_mode": false,', '  "packages_mode": false,', '  "changelog_ci_owned": false,', '  "changelog_unversioned": false', "}"])),
    orchestration: orchestration("ultracode"),
    tracking: TRACKING_V300,
    close_out: close(false),
    release: RELEASE,
    video: VIDEO,
    retro: notASection("retro", V300_SECTIONS),
    nosuch: notASection("nosuch", V300_SECTIONS),
  },
  keys: {
    ...SETTINGS_FILE_SPARSE,
    orchestration: orchestration("high"),
    tracking: {
      code: 1,
      out: "",
      err:
        "Refusing: specs/settings.yaml: `tracking.gate_outcomes` is not a recognised key; `tracking` is closed to {token_stats}\n" +
        "Remedy: fix specs/settings.yaml to conform to the documented schema and re-run.\n" +
        "Context: file=specs/settings.yaml, key=tracking.gate_outcomes\n",
    },
    close_out: close(false),
    release: RELEASE,
    video: VIDEO,
    retro: notASection("retro", V300_SECTIONS),
    nosuch: notASection("nosuch", V300_SECTIONS),
  },
  upgrade: {
    ...SETTINGS_FILE_SPARSE,
    orchestration: orchestration("high"),
    tracking: TRACKING_V300,
    close_out: close(true),
    release: RELEASE,
    video: VIDEO,
    retro: notASection("retro", V300_SECTIONS),
    nosuch: notASection("nosuch", V300_SECTIONS),
  },
};

/** The named differences, applied to the v3.0.0 table. Nothing else moves. */
const NAMED_DIFFERENCES: Record<string, { why: string; now: Out }> = {
  tracking: { why: "get tracking prints the M_7bc805 blocks as STE-717 pins it", now: TRACKING_NOW },
  retro: { why: "get retro exits 0 and prints the retro section", now: ok(json(["{", '  "enabled": false', "}"])) },
  nosuch: { why: "the Remedy: section list gains retro after close_out", now: notASection("nosuch", NOW_SECTIONS) },
};

const nowGet = (f: Fixture, section: string): Out => NAMED_DIFFERENCES[section]?.now ?? V300_GET[f][section]!;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fileList(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string): void => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else out[p.slice(root.length + 1)] = readFileSync(p, "utf-8");
    }
  };
  walk(root);
  return out;
}

const getRun = (root: string, section: string): Out => {
  const r = spawnModule(PROJECT_SETTINGS, ["get", section, root], root);
  return { code: r.code, out: r.stdout, err: r.stderr };
};

// ---------------------------------------------------------------------------
// The four front doors
// ---------------------------------------------------------------------------

describe("AC-STE-722.12 the four front doors equal v3.0.0 on every fixture", () => {
  for (const f of FIXTURES) {
    test(`${f}: gate_capture.ts, deliver_decision.ts and upgrade_offer.ts print their v3.0.0 bytes; retro_offer.ts prints nothing; no file is written`, () => {
      const root = fixtureTree(`d-${f}`, f);
      const before = fileList(root);
      const gate = runGateCapture(root);
      const deliver = runDeliverDecision(root);
      const upgrade = runUpgradeOffer(root);
      expect(gate.stdout, describeRun(gate)).toBe(V300_STDOUT[f].gate);
      expect(deliver.stdout, describeRun(deliver)).toBe(V300_STDOUT[f].deliver);
      expect(deliver.code).toBe(0);
      expect(upgrade.stdout, describeRun(upgrade)).toBe(V300_STDOUT[f].upgrade);
      expect(upgrade.code).toBe(0);
      for (const scope of [FR_ID, MILESTONE]) {
        const retro = runRetroOffer(root, scope);
        expect({ scope, code: retro.code, out: retro.stdout }, describeRun(retro)).toEqual({ scope, code: 0, out: "" });
      }
      expect(fileList(root)).toEqual(before);
    }, T);
  }

  test("upgrade: the gate_capture.ts and deliver_decision.ts outputs end in the one upgrade_offer: on line", () => {
    const root = fixtureTree("d-upgrade-tail", "upgrade");
    expect(trailingSwitchLines(runGateCapture(root).stdout)).toEqual([UPGRADE_ON]);
    expect(trailingSwitchLines(runDeliverDecision(root).stdout)).toEqual([UPGRADE_ON]);
  }, T);
});

// ---------------------------------------------------------------------------
// The modelled close-outs
// ---------------------------------------------------------------------------

const BUN_RUN_RE = /bun run\s+"?([^\s"`]+?\.ts)"?(?:[ \t]+([a-z][a-z0-9-]*)(?=[\s"`]|$))?/gm;
const SWITCH_LINE_RE = /`([a-z_]+: on)`/g;

/** The `bun run` targets a skill issues given the switch lines its prior call printed. */
function issuedCalls(skillText: string, printed: readonly string[]): string[] {
  const issued: string[] = [];
  for (const s of sentencesOf(skillText)) {
    for (const m of s.matchAll(BUN_RUN_RE)) {
      const named = [...s.matchAll(SWITCH_LINE_RE)].map((x) => x[1]!);
      if (named.some((n) => n === RETRO_ON || n === UPGRADE_ON) && !named.some((n) => printed.includes(n))) continue;
      issued.push(basename(m[1]!));
    }
  }
  return issued;
}

/** Reached offers from the real outputs: the switch lines gate each offer CLI. */
function reachedFrom(root: string, call: "gate" | "deliver"): { reached: string[]; calls: string[]; printed: string[] } {
  const stdout = call === "gate" ? runGateCapture(root).stdout : runDeliverDecision(root).stdout;
  const printed = trailingSwitchLines(stdout);
  const reached: string[] = [];
  const calls: string[] = [];
  if (printed.includes(RETRO_ON)) {
    calls.push("retro_offer.ts");
    if (runRetroOffer(root, call === "gate" ? FR_ID : MILESTONE).stdout !== "") reached.push(call === "gate" ? IMPLEMENT_RETRO : DELIVER_RETRO);
  }
  if (printed.includes(UPGRADE_ON)) {
    calls.push("upgrade_offer.ts");
    if (runUpgradeOffer(root).stdout !== "") reached.push(call === "gate" ? IMPLEMENT_UPGRADE : DELIVER_UPGRADE);
  }
  return { reached, calls, printed };
}

describe("AC-STE-722.12 modelled /implement and /deliver close-outs", () => {
  for (const f of FIXTURES) {
    test(`${f}: no operator turn, no retro_offer.ts call, no /retro step, no retro_proposal.ts call`, () => {
      const root = fixtureTree(`m-${f}`, f);
      const impl = reachedFrom(root, "gate");
      const del = reachedFrom(root, "deliver");
      const a = modelRun({ chain: [{ skill: "/implement", target: FR_ID }], promptBody: `/dev-process-toolkit:implement ${FR_ID}`, reachedOffers: impl.reached });
      const b = modelRun({ chain: [{ skill: "/deliver", target: MILESTONE }], promptBody: `/dev-process-toolkit:deliver ${MILESTONE}`, reachedOffers: del.reached });
      expect([...a.operatorTurns, ...b.operatorTurns]).toEqual([]);
      expect([...impl.calls, ...del.calls]).not.toContain("retro_offer.ts");
      expect(stepExecutionCounts(a)["/retro"] ?? 0).toBe(0);
      expect(stepExecutionCounts(b)["/retro"] ?? 0).toBe(0);
      const skillCalls = [...issuedCalls(read(IMPLEMENT_SKILL), impl.printed), ...issuedCalls(read(DELIVER_SKILL), del.printed)];
      expect(skillCalls).not.toContain("retro_offer.ts");
      expect(skillCalls).not.toContain("retro_proposal.ts");
    }, T);
  }

  test("CONTROL: the modeller issues retro_offer.ts from both skills once `retro: on` is printed", () => {
    const withLine = [...issuedCalls(read(IMPLEMENT_SKILL), [RETRO_ON]), ...issuedCalls(read(DELIVER_SKILL), [RETRO_ON])];
    expect(withLine.filter((c) => c === "retro_offer.ts").length).toBeGreaterThanOrEqual(1);
    expect(issuedCalls(read(DELIVER_SKILL), [RETRO_ON])).toContain("retro_offer.ts");
  });
});

// ---------------------------------------------------------------------------
// The named difference — `project_settings.ts get`
// ---------------------------------------------------------------------------

describe("AC-STE-722.12 named difference: project_settings.ts get", () => {
  for (const f of FIXTURES) {
    test(`${f}: every get section equals v3.0.0 except the named differences (get tracking, get retro, the Remedy: list)`, () => {
      const root = fixtureTree(`g-${f}`, f);
      for (const section of Object.keys(V300_GET[f])) {
        expect({ section, ...getRun(root, section) }).toEqual({ section, ...nowGet(f, section) });
      }
    }, T);
  }

  test("the named differences are exactly three, each a real change from v3.0.0, and the Remedy: list gains only retro after close_out", () => {
    expect(Object.keys(NAMED_DIFFERENCES).sort()).toEqual(["nosuch", "retro", "tracking"]);
    for (const f of FIXTURES) for (const s of Object.keys(NAMED_DIFFERENCES)) expect(NAMED_DIFFERENCES[s]!.now).not.toEqual(V300_GET[f][s]);
    expect(NOW_SECTIONS.split(", ").filter((s) => s !== "retro")).toEqual(V300_SECTIONS.split(", "));
    expect(NOW_SECTIONS.split(", ").indexOf("retro")).toBe(NOW_SECTIONS.split(", ").indexOf("close_out") + 1);
    expect(NAMED_DIFFERENCES.retro!.now.out.split("\n")).toEqual(["{", '  "enabled": false', "}", ""]);
  });

  test("no default /implement or /deliver call runs project_settings.ts get", () => {
    for (const p of [IMPLEMENT_SKILL, DELIVER_SKILL]) expect(/project_settings\.ts"?\s+get\b/.test(read(p))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// One byte of a pinned literal
// ---------------------------------------------------------------------------

describe("AC-STE-722.12 every pinned literal is load-bearing", () => {
  test("editing one pinned literal by one byte turns the comparison red", () => {
    const root = fixtureTree("byte", "upgrade");
    const pins: Array<[string, string]> = [
      [V300_STDOUT.upgrade.gate, runGateCapture(root).stdout],
      [V300_STDOUT.upgrade.deliver, runDeliverDecision(root).stdout],
      [nowGet("upgrade", "retro").out, getRun(root, "retro").out],
      [nowGet("upgrade", "nosuch").err, getRun(root, "nosuch").err],
      [nowGet("upgrade", "tracking").out, getRun(root, "tracking").out],
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
