// M_fd9a03 — defaults unchanged (owned by STE-725, the milestone's last FR).
//
// AC-STE-725.11 and AC-STE-725.13. Operator rule, 2026-11-04: this milestone
// changes no toolkit behaviour by default. The baseline is v3.0.0, the
// M_94e6f7 merge commit: 6c62b32c, whose plugin tree is byte-identical to the
// PR #128 merge 9dab5086 the M_d1b4b7 suite names. Every literal below is pinned
// from that commit's bytes, and each one that a v3.0.0 module can print is ALSO
// re-derived by running that commit's own modules (`git archive`, through
// v300Plugin) on a twin of the same fixture, so a literal cannot drift from the
// code it pins.
//
// Two fixtures, both toolkit-managed git checkouts:
//   none   — no settings file
//   keys   — a migrated settings file holding only keys of the three earlier
//            milestones: M_94e6f7 (orchestration, tracking.token_stats,
//            close_out.upgrade_offer), M_7bc805 (tracking.gate_outcomes,
//            tracking.tool_calls) and M_d1b4b7 (retro.enabled), all off; the
//            M_d1b4b7 suite's settingsYaml shape plus its retro key.
//
// On each: the knob verb prints `run`, probe #90 returns zero violations and
// zero notes, the `verdict` verb prints `rerun`, the `gate-check` receipt call
// prints its v3.0.0 stdout (one announcement line) and the receipt store then
// holds the v3.0.0 file list and no `gate-step` receipt; the gate-check and
// simplify SKILL.md files name gate_reuse.ts only in sentences naming
// `reuse: on`; and the AC-STE-715.15 /gate-check modeller, re-run on the
// finished milestone with every switch off, yields its v3.0.0 list with no
// gate_reuse.ts call. For /simplify the test grades the shipped pieces that
// skill runs: the verdict verb and the SKILL.md sentences that name it.
//
// NAMED ACCEPTED DIFFERENCES (and nothing else):
//   1. The conformance-probes summary line (STE-723, operator ruling at the
//      v3.0.0 rebase): `<N+1>/<N+1> [<active> active, <vacuous+1> vacuous]`
//      where v3.0.0 printed `<N>/<N> [<active> active, <vacuous> vacuous]`; the
//      one added probe is row 90, `optimizations_reuse_only`, vacuous on both
//      fixtures.
//   2. The documented `project_settings.ts get` CLI, which no skill calls by
//      default: on top of the M_7bc805 and M_d1b4b7 lines (STE-717, STE-722),
//      `get optimizations` exits 0 and prints `{`, `  "gate_commands": "run"`,
//      `}` where v3.0.0 refused it, and the `get` refusal's `Remedy:` section
//      list gains `optimizations` as its last entry.

import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import { runOptimizationsReuseOnlyProbe } from "../adapters/_shared/src/optimizations_config";
import { GATE_STEP_KIND } from "../adapters/_shared/src/gate_reuse";
import { GIT_ENV, PLUGIN_REL, PLUGIN_ROOT, REPO_ROOT, atV300, cleanupTemps, makeTree, sentences } from "./_m_7bc805_gate_outcome_fixture";
import { snapshot, v300Plugin } from "./_m_7bc805_timeline_fixture";
import { settingsYaml } from "./_m_d1b4b7_ste722_fixture";
import { readSpecFile } from "./_spec_tree";

afterAll(cleanupTemps);

const T = 240_000;
const SID = "00000000-0000-4000-8000-000000000725";
const SRC_REL = join("adapters", "_shared", "src");

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

type Fixture = "none" | "keys";
const FIXTURES: readonly Fixture[] = ["none", "keys"];

/** The M_94e6f7, M_7bc805 and M_d1b4b7 keys, all off (the M_d1b4b7 suite's `keys` shape plus `retro`). */
const KEYS_SETTINGS = settingsYaml({ tokenStats: false, upgrade: "false", retro: "false" });
/**
 * v3.0.0 refuses the whole file once it holds the M_d1b4b7 `retro` key, so its
 * `get` twin is the M_d1b4b7 suite's own `keys` file: the same file without
 * `retro` (the AC-STE-716.21 precedent: a key v3.0.0 refuses is removed from
 * the baseline twin, never from the fixture graded today).
 */
const KEYS_SETTINGS_V300_TWIN = settingsYaml({ tokenStats: false, upgrade: "false" });

function treeWith(label: string, settings: string | null): string {
  const root = makeTree(label, "none");
  if (settings !== null) {
    mkdirSync(join(root, "specs"), { recursive: true });
    writeFileSync(join(root, "specs", "settings.yaml"), settings);
    spawnSync("git", ["add", "-A"], { cwd: root, env: { ...process.env, ...GIT_ENV } });
    spawnSync("git", ["commit", "-qm", "settings"], { cwd: root, env: { ...process.env, ...GIT_ENV } });
  }
  return root;
}

const fixtureTree = (label: string, f: Fixture): string => treeWith(label, f === "none" ? null : KEYS_SETTINGS);
const v300GetTwin = (label: string, f: Fixture): string => treeWith(label, f === "none" ? null : KEYS_SETTINGS_V300_TWIN);

interface Out {
  code: number;
  out: string;
  err: string;
}

function spawnSrc(pluginRoot: string, module: string, args: string[], root: string): Out {
  const p = spawnSync("bun", ["run", join(pluginRoot, SRC_REL, module), ...args], {
    cwd: root,
    encoding: "utf-8",
    env: { ...(process.env as Record<string, string>), ...GIT_ENV, CLAUDE_CODE_SESSION_ID: SID },
  });
  return { code: p.status ?? -1, out: p.stdout ?? "", err: p.stderr ?? "" };
}

function normalise(text: string, root: string): string {
  return text
    .split(root)
    .join("<root>")
    .split(SID)
    .join("<sid>")
    .replace(/\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z-[0-9a-f]{8}\.json/g, "<receipt>")
    .replace(/sha256:[0-9a-f]{64}/g, "sha256:<digest>")
    .replace(/"head":"[0-9a-f]{40}"/g, '"head":"<head>"')
    .replace(/"createdAt":"[^"]+"/g, '"createdAt":"<at>"');
}

interface ReceiptRun extends Out {
  files: Record<string, string>;
  kinds: string[];
}

/** The `gate-check` receipt call from `pluginRoot`: normalised output, the files under `.dpt/`, and each receipt's kind. */
function receiptRun(pluginRoot: string, root: string): ReceiptRun {
  const r = spawnSrc(pluginRoot, "gate_receipt.ts", ["gate-check", root], root);
  const files: Record<string, string> = {};
  const kinds: string[] = [];
  for (const [k, v] of Object.entries(snapshot(root))) {
    if (!k.startsWith(".dpt/") && !k.startsWith(".claude/")) continue;
    files[normalise(k, root)] = normalise(v, root);
    if (k.startsWith(".dpt/ledger/receipts/") && k.endsWith(".json")) kinds.push(String((JSON.parse(v) as { kind?: unknown }).kind));
  }
  return { code: r.code, out: normalise(r.out, root), err: normalise(r.err, root), files, kinds };
}

// ---------------------------------------------------------------------------
// Pinned v3.0.0 literals — the receipt call (as the M_7bc805 suite pins them)
// ---------------------------------------------------------------------------

const RECEIPT_STDOUT_V300 = "dpt-receipt: <root>/.dpt/ledger/receipts/<sid>/<receipt> sha256:<digest>\n";
const RECEIPT_JSON_V300 =
  '{"v":1,"kind":"gate","sessionId":"<sid>","root":"<root>","adapter":null,"container":null,"subject":"dev-process-toolkit:gate-check","decision":"ran","evidence":{"head":"<head>"},"createdAt":"<at>"}\n';
const RECEIPT_FILES_V300 = [".dpt/.gitignore", ".dpt/ledger/receipts/<sid>/<receipt>"];

// ---------------------------------------------------------------------------
// AC-STE-725.11 — knob, probe, verdict, receipt call
// ---------------------------------------------------------------------------

describe("AC-STE-725.11 the knob verb, probe #90, the verdict verb and the gate-check receipt call on every fixture", () => {
  for (const f of FIXTURES) {
    test(`${f}: knob prints run, the probe returns zero violations and zero notes, verdict prints rerun; none of them writes a file`, () => {
      const root = fixtureTree(`k-${f}`, f);
      const before = snapshot(root);
      const knob = spawnSrc(PLUGIN_ROOT, "optimizations_config.ts", ["knob", root, "gate_commands"], root);
      expect(knob).toEqual({ code: 0, out: "run\n", err: "" });
      expect(runOptimizationsReuseOnlyProbe(root)).toEqual({ violations: [], notes: [] });
      expect(spawnSrc(PLUGIN_ROOT, "gate_reuse.ts", ["verdict", root], root)).toEqual({ code: 0, out: "rerun\n", err: "" });
      expect(snapshot(root)).toEqual(before);
    }, T);

    test(`${f}: after the gate-check receipt call of this session, verdict still prints rerun`, () => {
      const root = fixtureTree(`kv-${f}`, f);
      expect(receiptRun(PLUGIN_ROOT, root).code).toBe(0);
      expect(spawnSrc(PLUGIN_ROOT, "gate_reuse.ts", ["verdict", root], root)).toEqual({ code: 0, out: "rerun\n", err: "" });
    }, T);

    test(`${f}: the gate-check receipt call prints its v3.0.0 stdout; the store holds the v3.0.0 file list and no gate-step receipt`, () => {
      const now = fixtureTree(`r-${f}-now`, f);
      const then = fixtureTree(`r-${f}-then`, f);
      const a = receiptRun(PLUGIN_ROOT, now);
      const b = receiptRun(v300Plugin(), then);
      // Pinned literal: one announcement line, no `outcome: on`, no `reuse: on`.
      expect({ code: a.code, out: a.out, err: a.err }).toEqual({ code: 0, out: RECEIPT_STDOUT_V300, err: "" });
      expect(a.out.split("\n").filter(Boolean).length).toBe(1);
      expect(Object.keys(a.files).sort()).toEqual(RECEIPT_FILES_V300);
      expect(a.files[".dpt/ledger/receipts/<sid>/<receipt>"]).toBe(RECEIPT_JSON_V300);
      expect(a.kinds).toEqual(["gate"]);
      expect(a.kinds).not.toContain(GATE_STEP_KIND);
      // The v3.0.0 run on the twin.
      expect({ code: b.code, out: b.out, err: b.err }).toEqual({ code: 0, out: RECEIPT_STDOUT_V300, err: "" });
      expect(Object.keys(a.files).sort()).toEqual(Object.keys(b.files).sort());
      expect(a).toEqual(b);
    }, T);
  }

  test("CONTROL: the no-gate-step check sees a gate-step kind when one is present", () => {
    expect(GATE_STEP_KIND).toBe("gate-step");
    expect(["gate", GATE_STEP_KIND]).toContain(GATE_STEP_KIND);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-725.11 — the two SKILL.md files name gate_reuse.ts only beside `reuse: on`
// ---------------------------------------------------------------------------

const REUSE_ON = "reuse: on";
const skillText = (skill: string): string => readFileSync(join(PLUGIN_ROOT, "skills", skill, "SKILL.md"), "utf-8");

/** Every sentence naming `gate_reuse.ts` without the backticked `reuse: on` line. */
function unkeyedReuseMentions(text: string): string[] {
  return sentences(text).filter((x) => x.includes("gate_reuse.ts") && !x.includes(`\`${REUSE_ON}\``));
}

describe("AC-STE-725.11 gate-check and simplify name gate_reuse.ts only in sentences naming `reuse: on`", () => {
  for (const skill of ["gate-check", "simplify"]) {
    test(`${skill}: at least one sentence names gate_reuse.ts, and every one names \`reuse: on\``, () => {
      const text = skillText(skill);
      expect(sentences(text).filter((x) => x.includes("gate_reuse.ts")).length).toBeGreaterThan(0);
      expect(unkeyedReuseMentions(text)).toEqual([]);
    });

    test(`${skill}: v3.0.0 named no gate_reuse.ts at all`, () => {
      expect(atV300(`${PLUGIN_REL}/skills/${skill}/SKILL.md`)).not.toContain("gate_reuse.ts");
    });

    test(`CONTROL (${skill}): a planted unconditional gate_reuse.ts sentence is reported`, () => {
      const planted = 'Then run `bun run "${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/gate_reuse.ts" verdict "<root>"`.';
      expect(unkeyedReuseMentions(`${skillText(skill)}\n\n${planted}\n`)).toEqual([planted]);
    });
  }
});

// ---------------------------------------------------------------------------
// AC-STE-725.13 — the AC-STE-715.15 /gate-check modeller, every switch off
// ---------------------------------------------------------------------------
//
// MIRROR, not a fork, the way tests/m_fd9a03-ste-724-gate-reuse-prose.test.ts
// mirrors it: namedCalls and modelRun below are the text of
// tests/m_7bc805-ste-715-modelled-calls.test.ts, and the CONTROL row compares
// both function bodies and both regexes byte for byte. GUARDED_TARGETS is not
// copied: it is parsed out of that suite's literal.

const MODELLER_SUITE = join(PLUGIN_ROOT, "tests", "m_7bc805-ste-715-modelled-calls.test.ts");

interface GuardedTarget {
  module: string;
  verb: string;
  condition: string;
}

const SWITCH_LINE_RE = /`([a-z_]+: on)`/g;
const BUN_RUN_RE = /bun run\s+"?([^\s"`]+?\.ts)"?(?:[ \t]+([a-z][a-z0-9-]*)(?=[\s"`]|$))?/gm;

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

/** The GUARDED_TARGETS rows of the M_7bc805 suite, read from its literal. */
function guardedTargetsOf(suiteText: string): GuardedTarget[] {
  const open = suiteText.indexOf("const GUARDED_TARGETS: readonly GuardedTarget[] = [");
  if (open < 0) return [];
  const close = suiteText.indexOf("\n];", open);
  const block = suiteText.slice(open, close);
  return [...block.matchAll(/\{ module: "([^"]+)", verb: "([^"]+)", condition: "([^"]+)" \}/g)].map((m) => ({
    module: m[1]!,
    verb: m[2]!,
    condition: m[3]!,
  }));
}

const GUARDED_TARGETS: readonly GuardedTarget[] = guardedTargetsOf(readFileSync(MODELLER_SUITE, "utf-8"));

/** The source text of `function <name>` up to its closing brace at column 0. */
function functionText(src: string, name: string): string {
  const start = src.indexOf(`\nfunction ${name}(`);
  if (start < 0) return "";
  return src.slice(start, src.indexOf("\n}\n", start) + 3);
}
const constLine = (src: string, name: string): string => src.split("\n").find((l) => l.startsWith(`const ${name} = `)) ?? "";

/** The modelled /gate-check tool-call list at v3.0.0 (6c62b32c), switch off — pinned from its SKILL.md bytes. */
const V300_GATE_CHECK_CALLS: readonly string[] = [
  "gate_receipt.ts gate-check",
  "capture_skip_baseline.ts",
  "task_tracking_workspace_binding_present.ts",
  "tracker_local_reconciliation_drift.ts",
  "check_marker_runtime.ts",
  "video_commit_nudge.ts",
];

const GATE_CHECK_V300_TEXT = (): string => atV300(`${PLUGIN_REL}/skills/gate-check/SKILL.md`);

describe("AC-STE-725.13 the AC-STE-715.15 /gate-check modeller, re-run on the finished milestone", () => {
  test("CONTROL: the mirrored modeller is byte-identical to the M_7bc805 suite's, and its table holds the reuse row", () => {
    const theirs = readFileSync(MODELLER_SUITE, "utf-8");
    const ours = readFileSync(import.meta.path, "utf-8");
    for (const fn of ["namedCalls", "modelRun"]) {
      expect(functionText(theirs, fn).length).toBeGreaterThan(0);
      expect({ fn, text: functionText(ours, fn) }).toEqual({ fn, text: functionText(theirs, fn) });
    }
    for (const c of ["SWITCH_LINE_RE", "BUN_RUN_RE"]) {
      expect(constLine(theirs, c).length).toBeGreaterThan(0);
      expect(constLine(ours, c)).toBe(constLine(theirs, c));
    }
    expect(GUARDED_TARGETS).toContainEqual({ module: "gate_reuse.ts", verb: "run", condition: REUSE_ON });
  });

  test("CONTROL: the modeller reproduces the pinned v3.0.0 list from the v3.0.0 gate-check SKILL.md bytes", () => {
    expect(modelRun(GATE_CHECK_V300_TEXT(), "").map((c) => c.key)).toEqual([...V300_GATE_CHECK_CALLS]);
  });

  for (const f of FIXTURES) {
    test(`${f}: every switch off, the modelled /gate-check list equals its v3.0.0 list and holds no gate_reuse.ts call`, () => {
      const root = fixtureTree(`m-${f}`, f);
      const stdout = spawnSrc(PLUGIN_ROOT, "gate_receipt.ts", ["gate-check", root], root).out;
      expect(stdout.split("\n")).not.toContain(REUSE_ON);
      const calls = modelRun(skillText("gate-check"), stdout);
      expect(calls.map((c) => c.key)).toEqual([...V300_GATE_CHECK_CALLS]);
      expect(calls.filter((c) => c.module === "gate_reuse.ts")).toEqual([]);
      // The same receipt stdout on the v3.0.0 bytes yields the same list.
      expect(modelRun(GATE_CHECK_V300_TEXT(), stdout).map((c) => c.key)).toEqual(calls.map((c) => c.key));
    }, T);
  }

  test("CONTROL: with `reuse: on` stubbed into the receipt stdout the list departs from v3.0.0 and holds gate_reuse.ts run", () => {
    const calls = modelRun(skillText("gate-check"), `${RECEIPT_STDOUT_V300}outcome: on\n${REUSE_ON}`);
    expect(calls.some((c) => c.key === "gate_reuse.ts run")).toBe(true);
    expect(calls.map((c) => c.key)).not.toEqual([...V300_GATE_CHECK_CALLS]);
  });

  test("AC-STE-725.13 no sentence of STE-725.md or of this file denies that the /gate-check modeller exists", () => {
    // Built from parts, so this row's own pattern is no such sentence.
    const deny = [
      new RegExp(["\\bno\\b", "/gate-check", "modell?er", "\\bexists?\\b"].join("[^.]*"), "i"),
      new RegExp(["\\bno\\b", "modell?er", "\\bexists?\\b", "/gate-check"].join("[^.]*"), "i"),
    ];
    const fr = readSpecFile(REPO_ROOT, "specs/frs", "STE-725.md").body; // active, or its archived twin once M_fd9a03 is archived
    // The AC's own rule sentence quotes the ban it states: it is exempt by its exact bytes, read from the
    // AC-STE-725.13 line itself, and is the only sentence of that line that names the test file.
    const acLine = fr.split("\n").find((l) => l.startsWith("- AC-STE-725.13:")) ?? "";
    const rule = sentences(acLine).filter((s) => s.includes("`tests/m_fd9a03-defaults-unchanged.test.ts` says that"));
    expect(rule.length).toBe(1);
    const denies = (text: string): string[] => sentences(text).filter((s) => s !== rule[0] && deny.some((re) => re.test(s)));
    expect(denies(fr)).toEqual([]);
    expect(denies(readFileSync(import.meta.path, "utf-8"))).toEqual([]);
    // CONTROL: the pattern catches the sentence it bans.
    expect(denies(["N" + "o", "`/gate-check`", "modeller", "exists."].join(" ")).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Named difference 1 — the conformance-probes summary line
// ---------------------------------------------------------------------------
//
// No shipped function renders this line: /gate-check composes it from the
// probe results, per its SKILL.md template. So the counts the line is made of
// are pinned instead: N from the v3.0.0 registry, the one added row and its
// vacuity on both fixtures, and the template's own bytes.

const SUMMARY_TEMPLATE_V300 = "conformance-probes pass: <N>/<N> [<active> active, <vacuous> vacuous]";
const SUMMARY_HEADING = "### Conformance-probes summary line";
const V300_PROBE_COUNT = 89;
const ADDED_PROBE = { row: 90, id: "optimizations_reuse_only", fn: "runOptimizationsReuseOnlyProbe" };

interface RegistryRow {
  n: number;
  id: string;
  line: string;
}

/** The numbered rows of `## Conformance Probes (NFR-15)`, up to the summary-line heading. */
function registryRows(skill: string): RegistryRow[] {
  const start = skill.indexOf("\n## Conformance Probes (NFR-15)\n");
  const end = skill.indexOf(`\n${SUMMARY_HEADING}\n`);
  if (start < 0 || end < start) return [];
  return skill
    .slice(start, end)
    .split("\n")
    .flatMap((line) => {
      const m = /^(\d+)\. \*\*`?([^*`]+)`?\*\*/.exec(line);
      return m ? [{ n: Number(m[1]), id: m[2]!, line }] : [];
    });
}

/** The summary section, heading to the next `## ` heading. */
function summarySection(skill: string): string {
  const start = skill.indexOf(`\n${SUMMARY_HEADING}\n`);
  return start < 0 ? "" : skill.slice(start, skill.indexOf("\n## ", start + 1));
}

const renderSummary = (template: string, n: number, active: number, vacuous: number): string =>
  template.replaceAll("<N>", String(n)).replace("<active>", String(active)).replace("<vacuous>", String(vacuous));

describe("AC-STE-725.11 named difference 1: the conformance-probes summary line counts one more vacuous probe", () => {
  test("the v3.0.0 registry holds rows 1..89; today's holds 1..90, rows 1..89 keep their ids, and row 90 is optimizations_reuse_only", () => {
    const then = registryRows(GATE_CHECK_V300_TEXT());
    const now = registryRows(skillText("gate-check"));
    expect(then.map((r) => r.n)).toEqual(Array.from({ length: V300_PROBE_COUNT }, (_, i) => i + 1));
    expect(now.map((r) => r.n)).toEqual(Array.from({ length: V300_PROBE_COUNT + 1 }, (_, i) => i + 1));
    expect(now.slice(0, V300_PROBE_COUNT).map((r) => r.id)).toEqual(then.map((r) => r.id));
    const added = now[ADDED_PROBE.row - 1]!;
    expect(added.id).toBe(ADDED_PROBE.id);
    expect(added.line).toContain(`\`${ADDED_PROBE.fn}(projectRoot)\``);
  });

  test("the summary-line section, template included, is byte-identical to v3.0.0", () => {
    const then = summarySection(GATE_CHECK_V300_TEXT());
    expect(then).toContain(`\n${SUMMARY_TEMPLATE_V300}\n`);
    expect(summarySection(skillText("gate-check"))).toBe(then);
  });

  for (const f of FIXTURES) {
    test(`${f}: the added probe is vacuous, so the line moves only by <N>+1 and <vacuous>+1, <active> unchanged`, () => {
      const root = fixtureTree(`s-${f}`, f);
      const report = runOptimizationsReuseOnlyProbe(root);
      expect(report).toEqual({ violations: [], notes: [] });
      const n = registryRows(GATE_CHECK_V300_TEXT()).length;
      const nowN = registryRows(skillText("gate-check")).length;
      expect(nowN).toBe(n + 1);
      const vacuousAdded = report.violations.length === 0 && report.notes.length === 0 ? 1 : 0;
      // For any active/vacuous split of the 89 v3.0.0 probes on this tree:
      for (const [active, vacuous] of [
        [0, n],
        [n, 0],
        [40, n - 40],
      ] as const) {
        const then = renderSummary(SUMMARY_TEMPLATE_V300, n, active, vacuous);
        const now = renderSummary(SUMMARY_TEMPLATE_V300, nowN, active, vacuous + vacuousAdded);
        expect(now).toBe(`conformance-probes pass: ${n + 1}/${n + 1} [${active} active, ${vacuous + 1} vacuous]`);
        expect(then).toBe(`conformance-probes pass: ${n}/${n} [${active} active, ${vacuous} vacuous]`);
      }
    }, T);
  }
});

// ---------------------------------------------------------------------------
// Named difference 2 — `project_settings.ts get` (the M_d1b4b7 suite's get-pins, extended)
// ---------------------------------------------------------------------------

const ok = (out: string): Out => ({ code: 0, out, err: "" });
const json = (lines: string[]): string => `${lines.join("\n")}\n`;

const V300_SECTIONS = "task_tracking, verification, docs, orchestration, tracking, close_out, release, video";
const NOW_SECTIONS = "task_tracking, verification, docs, orchestration, tracking, close_out, retro, release, video, optimizations";
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

/** `project_settings.ts get <section>` on each fixture's v3.0.0 twin, at v3.0.0 (the M_d1b4b7 suite's pins). */
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
    optimizations: notASection("optimizations", V300_SECTIONS),
    nosuch: notASection("nosuch", V300_SECTIONS),
  },
  keys: {
    task_tracking: ok(json(["{", '  "mode": "none"', "}"])),
    verification: ok("{}\n"),
    docs: ok("{}\n"),
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
    optimizations: notASection("optimizations", V300_SECTIONS),
    nosuch: notASection("nosuch", V300_SECTIONS),
  },
};

/** The named differences, applied to the v3.0.0 table. Nothing else moves. */
const NAMED_DIFFERENCES: Record<string, { why: string; now: Out }> = {
  tracking: { why: "get tracking prints the M_7bc805 blocks as STE-717 pins it", now: TRACKING_NOW },
  retro: { why: "get retro exits 0 and prints the retro section (STE-722)", now: ok(json(["{", '  "enabled": false', "}"])) },
  optimizations: { why: "get optimizations exits 0 and prints its gate_commands: run default (STE-723)", now: ok(json(["{", '  "gate_commands": "run"', "}"])) },
  nosuch: { why: "the Remedy: section list gains retro after close_out and optimizations last", now: notASection("nosuch", NOW_SECTIONS) },
};

const nowGet = (f: Fixture, section: string): Out => NAMED_DIFFERENCES[section]?.now ?? V300_GET[f][section]!;
const getRun = (pluginRoot: string, root: string, section: string): Out => spawnSrc(pluginRoot, "project_settings.ts", ["get", section, root], root);

describe("AC-STE-725.11 named difference 2: project_settings.ts get", () => {
  for (const f of FIXTURES) {
    test(`${f}: every get section equals v3.0.0 except the named lines (get tracking, get retro, get optimizations, the Remedy: list)`, () => {
      const root = fixtureTree(`g-${f}`, f);
      for (const section of Object.keys(V300_GET[f])) {
        expect({ section, ...getRun(PLUGIN_ROOT, root, section) }).toEqual({ section, ...nowGet(f, section) });
      }
    }, T);

    test(`${f}: the pinned v3.0.0 get table is the v3.0.0 merge commit's own output on the twin`, () => {
      const twin = v300GetTwin(`gv-${f}`, f);
      for (const section of Object.keys(V300_GET[f])) {
        expect({ section, ...getRun(v300Plugin(), twin, section) }).toEqual({ section, ...V300_GET[f][section]! });
      }
    }, T);
  }

  test("the named differences are exactly four, each a real change from v3.0.0", () => {
    expect(Object.keys(NAMED_DIFFERENCES).sort()).toEqual(["nosuch", "optimizations", "retro", "tracking"]);
    for (const f of FIXTURES) for (const s of Object.keys(NAMED_DIFFERENCES)) expect(NAMED_DIFFERENCES[s]!.now).not.toEqual(V300_GET[f][s]);
  });

  test("get optimizations prints exactly `{`, `  \"gate_commands\": \"run\"`, `}` with exit 0", () => {
    const o = NAMED_DIFFERENCES.optimizations!.now;
    expect(o.code).toBe(0);
    expect(o.out.split("\n")).toEqual(["{", '  "gate_commands": "run"', "}", ""]);
  });

  test("the Remedy: list gains only retro after close_out (M_d1b4b7) and optimizations last (M_fd9a03)", () => {
    const now = NOW_SECTIONS.split(", ");
    expect(now.filter((s) => s !== "retro" && s !== "optimizations")).toEqual(V300_SECTIONS.split(", "));
    expect(now.indexOf("retro")).toBe(now.indexOf("close_out") + 1);
    expect(now[now.length - 1]).toBe("optimizations");
  });

  test("no default gate-check or simplify call runs project_settings.ts get", () => {
    for (const skill of ["gate-check", "simplify"]) expect({ skill, calls: /project_settings\.ts"?\s+get\b/.test(skillText(skill)) }).toEqual({ skill, calls: false });
  });
});

// ---------------------------------------------------------------------------
// One byte of a pinned literal
// ---------------------------------------------------------------------------

describe("AC-STE-725.11 every pinned literal is load-bearing", () => {
  test("editing one pinned literal by one byte turns the comparison red", () => {
    const root = fixtureTree("byte", "keys");
    const receipt = receiptRun(PLUGIN_ROOT, root);
    const pins: Array<[string, string]> = [
      ["run\n", spawnSrc(PLUGIN_ROOT, "optimizations_config.ts", ["knob", root, "gate_commands"], root).out],
      ["rerun\n", spawnSrc(PLUGIN_ROOT, "gate_reuse.ts", ["verdict", root], root).out],
      [RECEIPT_STDOUT_V300, receipt.out],
      [RECEIPT_JSON_V300, receipt.files[".dpt/ledger/receipts/<sid>/<receipt>"] ?? ""],
      [V300_GATE_CHECK_CALLS.join("\n"), modelRun(skillText("gate-check"), receipt.out).map((c) => c.key).join("\n")],
      [SUMMARY_TEMPLATE_V300, summarySection(skillText("gate-check")).split("\n").find((l) => l.startsWith("conformance-probes pass:")) ?? ""],
      [nowGet("keys", "optimizations").out, getRun(PLUGIN_ROOT, root, "optimizations").out],
      [nowGet("keys", "nosuch").err, getRun(PLUGIN_ROOT, root, "nosuch").err],
      [nowGet("keys", "tracking").out, getRun(PLUGIN_ROOT, root, "tracking").out],
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
