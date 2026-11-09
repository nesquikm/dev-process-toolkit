// STE-715 (M_7bc805) AC.15 — modelled tool calls of /gate-check, /tdd and
// /spec-review, read from each SKILL.md; plus the AC.19 and AC.20 archive rows.
//
// The model issues every `bun run` command a skill names. A command is GUARDED
// only when its target is a row of GUARDED_TARGETS and its sentence names that
// row's condition, a backticked switch line matching `[a-z_]+: on`. A guarded
// command is issued only when that exact line is in the stdout of the receipt
// call. Every other command is issued unconditionally, so a sentence that
// merely mentions a switch line cannot hide a call whose target is not in the
// table (review 8, m8-2).
//
// LIMIT: the guard reads only the receipt call's stdout, so it cannot see a
// switch line another call prints (for example `upgrade_offer: on` from
// `gate_capture.ts`). It must not be reused for /implement or /deliver as it
// stands.

import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";

import {
  PLUGIN_ROOT,
  REPO_ROOT,
  atV300,
  cleanupTemps,
  makeTree,
  mentionRuleViolations,
  mintRun,
  sentences,
} from "./_m_7bc805_gate_outcome_fixture";

type AnyMod = Record<string, any>;
const T = 120_000;

afterAll(cleanupTemps);

// ---------------------------------------------------------------------------
// The modeller — one table, read by every modeller test below.
// ---------------------------------------------------------------------------

interface GuardedTarget {
  module: string;
  verb: string;
  condition: string;
}

/**
 * The closed table of guarded targets. A later switch line needs its own row,
 * added with an `Amended by` comment by the FR that adds it.
 */
const GUARDED_TARGETS: readonly GuardedTarget[] = [
  { module: "gate_receipt.ts", verb: "outcome", condition: "outcome: on" },
  // Amended by AC-STE-724.22 (M_fd9a03): the reuse front door is guarded by reuse: on.
  { module: "gate_reuse.ts", verb: "run", condition: "reuse: on" },
];

const SWITCH_LINE_RE = /`([a-z_]+: on)`/g;
const BUN_RUN_RE = /bun run\s+"?([^\s"`]+?\.ts)"?(?:[ \t]+([a-z][a-z0-9-]*)(?=[\s"`]|$))?/gm;
const GATE_SKILLS = ["gate-check", "tdd", "spec-review"];

interface Call {
  key: string;
  module: string;
  verb?: string;
  command: string;
}

function namedCalls(text: string): Array<{ sentence: string; call: Call }> {
  const out: Array<{ sentence: string; call: Call }> = [];
  for (const s of sentences(text)) {
    for (const m of s.matchAll(BUN_RUN_RE)) {
      const module = basename(m[1]!);
      const command = s.slice(m.index!).split("`")[0]!.trim();
      out.push({ sentence: s, call: { module, verb: m[2], key: m[2] ? `${module} ${m[2]}` : module, command } });
    }
  }
  return out;
}

const isReceiptCall = (c: Call): boolean => c.module === "gate_receipt.ts" && c.verb !== undefined && GATE_SKILLS.includes(c.verb);

/** The modelled run: every named call in order, guarded ones only when the receipt call printed their line. */
function modelRun(text: string, receiptStdout: string, table: readonly GuardedTarget[] = GUARDED_TARGETS): Call[] {
  const printed = new Set(receiptStdout.split("\n"));
  const issued: Call[] = [];
  for (const { sentence, call } of namedCalls(text)) {
    const row = table.find((r) => r.module === call.module && r.verb === call.verb);
    const named = [...sentence.matchAll(SWITCH_LINE_RE)].map((m) => m[1]!);
    const guarded = row !== undefined && named.includes(row.condition);
    if (guarded && !printed.has(row!.condition)) continue;
    issued.push(call);
  }
  return issued;
}

/** The command as a Bash call would carry it: the plugin root expanded, placeholders filled. */
function materialise(command: string): string {
  return command.replaceAll("${CLAUDE_PLUGIN_ROOT}", PLUGIN_ROOT).replace(/<[^<>]*>/g, "x");
}

/** Each modelled run's tool-call list at the v3.0.0 merge commit (6c62b32c), switch off. */
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

const skillText = (skill: string): string => readFileSync(join(PLUGIN_ROOT, "skills", skill, "SKILL.md"), "utf-8");

async function runsGateOutcome(): Promise<(c: string) => boolean> {
  const m = (await import("../adapters/_shared/src/gate_receipt")) as AnyMod;
  expect(typeof m.runsGateOutcome).toBe("function");
  return m.runsGateOutcome;
}

/** Real receipt-call stdout, from the shipped CLI, for a switch-off and a switch-on tree. */
function receiptStdout(state: "absent" | "on", skill: string): string {
  return mintRun(makeTree(`model-${state}-${skill}`, state), skill).run.stdout;
}

describe("AC-STE-715.15 modelled tool calls", () => {
  test("CONTROL: the modeller reproduces each v3.0.0 list from the v3.0.0 bytes", () => {
    for (const skill of GATE_SKILLS) {
      const text = atV300(`plugins/dev-process-toolkit/skills/${skill}/SKILL.md`);
      expect({ skill, calls: modelRun(text, "").map((c) => c.key) }).toEqual({ skill, calls: [...V300_CALLS[skill]!] });
    }
  });

  for (const skill of GATE_SKILLS) {
    test(`${skill}: switch off, the modelled list equals the v3.0.0 list (no outcome call, no mode call, nothing extra)`, async () => {
      const accepts = await runsGateOutcome();
      const stdout = receiptStdout("absent", skill);
      expect(stdout).not.toContain("outcome: on");
      const calls = modelRun(skillText(skill), stdout);
      expect(calls.map((c) => c.key)).toEqual([...V300_CALLS[skill]!]);
      expect(calls.filter((c) => c.key === "project_settings.ts mode")).toEqual([]);
      expect(calls.filter((c) => accepts(materialise(c.command)))).toEqual([]);
    }, T);

    test(`${skill}: switch on, the modelled list adds exactly one outcome call`, async () => {
      const accepts = await runsGateOutcome();
      const stdout = receiptStdout("on", skill);
      expect(stdout.split("\n")).toContain("outcome: on");
      const calls = modelRun(skillText(skill), stdout);
      const outcomes = calls.filter((c) => accepts(materialise(c.command)));
      expect(outcomes.length).toBe(1);
      expect(outcomes[0]!.key).toBe("gate_receipt.ts outcome");
      expect(calls.filter((c) => c !== outcomes[0]).map((c) => c.key)).toEqual([...V300_CALLS[skill]!]);
      // The outcome call follows the receipt call.
      expect(calls.indexOf(outcomes[0]!)).toBeGreaterThan(calls.findIndex(isReceiptCall));
    }, T);
  }

  const PROBE_SENTENCE =
    'When the run printed `probe_x: on`, run `bun run "${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/probe_x.ts" check "<that checkout root>"`.';
  const planted = (): string => `${skillText("spec-review")}\n${PROBE_SENTENCE}\n`;
  const probeIssued = (calls: Call[]): number => calls.filter((c) => c.key === "probe_x.ts check").length;

  test("CONTROL: a command whose sentence names `probe_x: on`, its target not in the table, is issued anyway", () => {
    expect(probeIssued(modelRun(planted(), "dpt-receipt: /x sha256:0"))).toBe(1);
  });

  test("CONTROL: with a temp table row for that target and `probe_x`, it is not issued", () => {
    const table = [...GUARDED_TARGETS, { module: "probe_x.ts", verb: "check", condition: "probe_x: on" }];
    expect(probeIssued(modelRun(planted(), "dpt-receipt: /x sha256:0", table))).toBe(0);
  });

  test("CONTROL: with the receipt stdout stubbed to print `probe_x: on`, it is issued once", () => {
    const table = [...GUARDED_TARGETS, { module: "probe_x.ts", verb: "check", condition: "probe_x: on" }];
    expect(probeIssued(modelRun(planted(), "dpt-receipt: /x sha256:0\nprobe_x: on\n", table))).toBe(1);
  });

  test("GUARDED_TARGETS is the closed one-row table this milestone ships", () => {
    // Amended by AC-STE-724.22 (M_fd9a03): the reuse front door is guarded by reuse: on.
    expect(GUARDED_TARGETS).toEqual([
      { module: "gate_receipt.ts", verb: "outcome", condition: "outcome: on" },
      { module: "gate_reuse.ts", verb: "run", condition: "reuse: on" },
    ]);
  });

  for (const skill of GATE_SKILLS) {
    test(`mention rule (${skill}): every sentence naming the outcome verb names \`outcome: on\``, () => {
      const text = skillText(skill);
      expect(namedCalls(text).some(({ call }) => call.key === "gate_receipt.ts outcome")).toBe(true);
      expect(mentionRuleViolations(text)).toEqual([]);
    });

    test(`mention rule CONTROL (${skill}): a planted second mention without \`outcome: on\` turns the row red`, () => {
      const copy = `${skillText(skill)}\nAlso run \`bun run "\${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/gate_receipt.ts" outcome ${skill} "<that checkout root>" pass\`.\n`;
      expect(mentionRuleViolations(copy).length).toBe(1);
    });
  }
});

// ===========================================================================
// AC-STE-715.19 + AC-STE-715.20 — the archived ACs, byte for byte vs v3.0.0
// ===========================================================================

const CLAUSE_708 =
  "*(Amended by AC-STE-715.19 (v3.1.0): `gate_receipt.ts outcome` is a further conditional target, admitted only in a sentence that names `outcome: on`.)*";
const CLAUSE_614 =
  "*(Amended by AC-STE-715.20 (v3.1.0): the one line ordering the receipt with the skill's own name stays exactly one; any further line naming that front door orders only the `outcome` verb and names `outcome: on`.)*";

/** The later clauses that may follow the AC-STE-715.19 clause, in order (M_d1b4b7, M_fd9a03). */
const LATER_708 = [/^\*\(Amended by AC-STE-722\.16 \(v[0-9.]+\): [^\n]*?\)\*/, /^\*\(Amended by AC-STE-724\.21 \(v[0-9.]+\): [^\n]*?\)\*/];

function archiveDrift708(then: string, now: string): string[] {
  const a = then.split("\n");
  const b = now.split("\n");
  if (a.length !== b.length) return [`line count ${a.length} → ${b.length}`];
  const out: string[] = [];
  for (let i = 0; i < a.length; i++) {
    if (i === 59) {
      const head = `${a[i]} ${CLAUSE_708}`;
      if (!b[i]!.startsWith(head)) {
        out.push("line 60: not the v3.0.0 bytes followed by the AC-STE-715.19 clause");
        continue;
      }
      let rest = b[i]!.slice(head.length);
      for (const re of LATER_708) {
        if (!rest.startsWith(" ")) break;
        const m = re.exec(rest.slice(1));
        if (!m) break;
        rest = rest.slice(1 + m[0].length);
      }
      if (rest !== "") out.push("line 60: trailing bytes after the permitted clauses");
    } else if (a[i] !== b[i]) out.push(`line ${i + 1}`);
  }
  return out;
}

function archiveDrift614(then: string, now: string): string[] {
  const a = then.split("\n");
  const b = now.split("\n");
  if (a.length !== b.length) return [`line count ${a.length} → ${b.length}`];
  const out: string[] = [];
  for (let i = 0; i < a.length; i++) {
    const expected = i === 70 ? `${a[i]} ${CLAUSE_614}` : a[i];
    if (b[i] !== expected) out.push(`line ${i + 1}`);
  }
  return out;
}

const archived = (id: string): string => readFileSync(join(REPO_ROOT, "specs", "frs", "archive", `${id}.md`), "utf-8");

describe("AC-STE-715.19 specs/frs/archive/STE-708.md vs v3.0.0", () => {
  test("CONTROL: line 60 at v3.0.0 is the AC-STE-708.13 line", () => {
    expect(atV300("specs/frs/archive/STE-708.md").split("\n")[59]!.startsWith("- AC-STE-708.13:")).toBe(true);
  });

  test("differs only on the AC-STE-708.13 line, by the appended AC-STE-715.19 clause", () => {
    expect(archiveDrift708(atV300("specs/frs/archive/STE-708.md"), archived("STE-708"))).toEqual([]);
  });

  test("CONTROL: a one-byte edit elsewhere in the archived file turns it red", () => {
    const lines = atV300("specs/frs/archive/STE-708.md").split("\n");
    lines[59] = `${lines[59]} ${CLAUSE_708}`;
    expect(archiveDrift708(atV300("specs/frs/archive/STE-708.md"), lines.join("\n"))).toEqual([]);
    lines[10] = `${lines[10]}x`;
    expect(archiveDrift708(atV300("specs/frs/archive/STE-708.md"), lines.join("\n"))).toEqual(["line 11"]);
  });
});

describe("AC-STE-715.20 specs/frs/archive/STE-614.md vs v3.0.0", () => {
  test("CONTROL: line 71 at v3.0.0 is the AC-STE-614.11 line", () => {
    expect(atV300("specs/frs/archive/STE-614.md").split("\n")[70]!.startsWith("- AC-STE-614.11:")).toBe(true);
  });

  test("differs only by the AC-STE-715.20 clause appended to the AC-STE-614.11 line", () => {
    expect(archiveDrift614(atV300("specs/frs/archive/STE-614.md"), archived("STE-614"))).toEqual([]);
  });

  test("CONTROL: a one-byte edit elsewhere in the archived file turns it red", () => {
    const then = atV300("specs/frs/archive/STE-614.md").split("\n");
    then[70] = `${then[70]} ${CLAUSE_614}`;
    then[5] = `${then[5]}x`;
    expect(archiveDrift614(atV300("specs/frs/archive/STE-614.md"), then.join("\n"))).toEqual(["line 6"]);
  });
});
