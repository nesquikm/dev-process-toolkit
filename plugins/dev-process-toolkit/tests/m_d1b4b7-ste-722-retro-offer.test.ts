// STE-722 (M_d1b4b7) — close-out offers a retrospective only when a rule tripped.
//
// Module under test: adapters/_shared/src/retro_offer.ts (new), front door
//
//   bun run retro_offer.ts <projectRoot> <scope>
//
// API this file assumes of retro_offer.ts (shaped like video_offer.ts):
//   * `retroOfferLines(projectRoot, scope, deps?)` — sync or async; `[]` when
//     `retro.enabled` is off (read FIRST, through `retroSwitchOn`, before any
//     scope or ledger read), when the scope resolves to no session, or when no
//     rule trips; otherwise `scope=<scope>` followed by one
//     `rule=<id> <value> <unit> > <threshold>` line per tripped result, where
//     `<id>`, `<value>`, `<unit>` and `<threshold>` are the `RetroRuleResult`
//     fields `evaluateRetroRules` returned (so `<unit>` is the result's `unit`).
//     `deps` is an optional injection seam `{ resolveScope?, evaluate? }`,
//     defaulting to `resolveRetroScope` and `evaluateRetroRules`; the spy rows
//     of AC-STE-722.13 go through it.
//   * CLI: prints the lines or nothing, always exits 0, writes no file.
//
// AC-STE-722.10 (mutation controls) — each named mutation and the named test
// that reds on it:
//   - retro_offer.ts prints a line when no rule tripped
//       -> "AC-.1 every rule clear or skipped: empty stdout, exit 0"
//   - the retro.enabled check is removed
//       -> "AC-.1 retro off (false) on a tripped ledger: empty stdout, exit 0"
//          "AC-.13 switch off: neither resolveRetroScope nor evaluateRetroRules is called"
//          and the live control "AC-.10 MUTANT — retro_offer.ts with the switch check stubbed true prints on a retro-off tree"
//   - the check is moved after the scope read
//       -> "AC-.13 switch off: neither resolveRetroScope nor evaluateRetroRules is called"
//   - `retro: on` printed with the switch off
//       -> tests/m_d1b4b7-ste-722-switch-line.test.ts "AC-.14 gate_capture.ts retro false, upgrade off ..."
//          and its live control "AC-.10 MUTANT — deliver_decision.ts printing retro: on unconditionally ..."
//   - `retro: on` printed after `upgrade_offer: on`
//       -> tests/m_d1b4b7-ste-722-switch-line.test.ts "AC-.14 ... both switches on ends retro: on then upgrade_offer: on"
//          and its live control "AC-.10 MUTANT — deliver_decision.ts with the two switch lines swapped ..."
//   - upgrade_offer.ts reads the retro key
//       -> tests/m_d1b4b7-ste-722-switch-line.test.ts "AC-.14 upgrade_offer.ts source carries no retro read"
//          and its control "AC-.10 MUTANT — a retro import planted in upgrade_offer.ts is found by the scan"
//
// AC-STE-722.11 is the full-suite gate (graded by the gate run, not here).
//
// All ids are synthetic.

import { afterAll, describe, expect, mock, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  CONTINUATION_OFFERS,
  DRIVEN_OMISSION_CLAUSE,
  continuationOffer,
  drivenClauseParagraph,
  performanceDirectiveIn,
} from "../adapters/_shared/src/continuation_offer";
import { SettingsShapeError, loadProjectSection } from "../adapters/_shared/src/project_settings";
import { gatherRetroInputs } from "../adapters/_shared/src/retro";
import { RETRO_RULES, evaluateRetroRules } from "../adapters/_shared/src/retro_rules";
import { resolveRetroScope } from "../adapters/_shared/src/retro_scope";
import { dptSnapshot, gitStatus, makeRetroTree, retroDir } from "./_m_d1b4b7_retro_fixture";
import {
  DELIVER_RETRO,
  DELIVER_SKILL,
  DELIVER_UPGRADE,
  FR_ID,
  IMPLEMENT_RETRO,
  IMPLEMENT_SKILL,
  IMPLEMENT_UPGRADE,
  LEGACY_ORCH_CLAUDE_MD,
  MILESTONE,
  OTHER_FR_ID,
  RETRO_OFFER,
  TRIPPED_RULE_LINE,
  atV300,
  cleanupTemps,
  copyPluginTree,
  describeRun,
  offerTree,
  read,
  runRetroOffer,
  settingsYaml,
  writeLedger,
} from "./_m_d1b4b7_ste722_fixture";

afterAll(cleanupTemps);

const T = 120_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMod = any;
let loaded: AnyMod = null;
let loadError: unknown = null;
try {
  loaded = await import(RETRO_OFFER);
} catch (e) {
  loadError = e;
}
function M(): AnyMod {
  if (!loaded) {
    throw new Error(`retro_offer.ts is not loadable: ${loadError instanceof Error ? loadError.message : String(loadError)}`);
  }
  return loaded;
}

const ON = settingsYaml({ retro: "true", tokenStats: true });

// ===========================================================================
// AC-STE-722.1 — the front door's silent cases and its one printing case
// ===========================================================================

describe("AC-STE-722.1 retro_offer.ts as a subprocess", () => {
  test("AC-.1 the module exists with an import.meta.main guard", () => {
    expect(existsSync(RETRO_OFFER)).toBe(true);
    expect(read(RETRO_OFFER)).toContain("import.meta.main");
  });

  for (const retro of ["absent", "false"] as const) {
    test(`AC-.1 retro off (${retro}) on a tripped ledger: empty stdout, exit 0`, () => {
      const root = offerTree(`off-${retro}`, settingsYaml({ retro, tokenStats: true }), { ledger: "tripped" });
      for (const scope of [FR_ID, MILESTONE]) {
        const r = runRetroOffer(root, scope);
        expect(r.code, describeRun(r)).toBe(0);
        expect(r.stdout, describeRun(r)).toBe("");
      }
    }, T);
  }

  test("AC-.1 a tree with no settings file: empty stdout, exit 0", () => {
    const root = offerTree("off-nosettings", null, { ledger: "tripped" });
    const r = runRetroOffer(root, FR_ID);
    expect(r.code, describeRun(r)).toBe(0);
    expect(r.stdout).toBe("");
  }, T);

  test("AC-.1 a both-homes tree whose settings read refuses: empty stdout, exit 0", () => {
    const root = offerTree("both-homes", ON, { ledger: "tripped", claudeMd: LEGACY_ORCH_CLAUDE_MD });
    // The control is live: the loader refuses this tree.
    expect(() => loadProjectSection(root, "retro" as never)).toThrow(SettingsShapeError);
    const r = runRetroOffer(root, FR_ID);
    expect(r.code, describeRun(r)).toBe(0);
    expect(r.stdout).toBe("");
  }, T);

  test("AC-.1 scope with no session: empty stdout, exit 0", () => {
    const root = offerTree("nosession", ON, { ledger: "tripped" });
    // Control: the scope really resolves to no session, while FR_ID's does not.
    expect(resolveRetroScope(root, OTHER_FR_ID).sessions).toEqual([]);
    expect(resolveRetroScope(root, FR_ID).sessions.length).toBe(1);
    const r = runRetroOffer(root, OTHER_FR_ID);
    expect(r.code, describeRun(r)).toBe(0);
    expect(r.stdout).toBe("");
  }, T);

  test("AC-.1 FR scope with tracking.token_stats off: empty stdout, exit 0", () => {
    const root = offerTree("tokenstats-off", settingsYaml({ retro: "true", tokenStats: false }), { ledger: "tripped" });
    expect(resolveRetroScope(root, FR_ID).sessions).toEqual([]);
    const r = runRetroOffer(root, FR_ID);
    expect(r.code, describeRun(r)).toBe(0);
    expect(r.stdout).toBe("");
  }, T);

  test("AC-.1 every rule clear or skipped: empty stdout, exit 0", () => {
    const root = offerTree("clear", ON, { ledger: "clear" });
    // Control: the engine on this tree reports no trip and at least one clear.
    const results = evaluateRetroRules(gatherRetroInputs(root, resolveRetroScope(root, FR_ID)));
    expect(results.filter((x) => x.disposition === "tripped")).toEqual([]);
    expect(results.some((x) => x.disposition === "clear")).toBe(true);
    const r = runRetroOffer(root, FR_ID);
    expect(r.code, describeRun(r)).toBe(0);
    expect(r.stdout, describeRun(r)).toBe("");
  }, T);

  test("AC-.1 one tripped rule (FR scope): exactly scope=<scope> and one rule= line", () => {
    const root = offerTree("tripped-fr", ON, { ledger: "tripped" });
    const results = evaluateRetroRules(gatherRetroInputs(root, resolveRetroScope(root, FR_ID)));
    const tripped = results.filter((x) => x.disposition === "tripped");
    expect(tripped.map((x) => x.id)).toEqual(["cost_per_changed_line"]);
    const t = tripped[0]!;
    // The documented shape, built from the engine's own result.
    expect(`rule=${t.id} ${t.value} ${t.unit} > ${t.threshold}`).toBe(TRIPPED_RULE_LINE);
    const r = runRetroOffer(root, FR_ID);
    expect(r.code, describeRun(r)).toBe(0);
    expect(r.stdout, describeRun(r)).toBe(`scope=${FR_ID}\n${TRIPPED_RULE_LINE}\n`);
    expect(r.stdout.split("\n").filter((l) => l.startsWith("rule=")).length).toBe(1);
    expect(r.stdout).toMatch(/^scope=\S+\nrule=[a-z_]+ \d+(?:\.\d+)? \S.* > \d+(?:\.\d+)?\n$/);
  }, T);

  test("AC-.1 one tripped rule (milestone scope): scope=<milestone> and the same rule= line", () => {
    const root = offerTree("tripped-ms", ON, { ledger: "tripped" });
    const r = runRetroOffer(root, MILESTONE);
    expect(r.code, describeRun(r)).toBe(0);
    expect(r.stdout, describeRun(r)).toBe(`scope=${MILESTONE}\n${TRIPPED_RULE_LINE}\n`);
  }, T);
});

// ===========================================================================
// AC-STE-722.2 — read-only
// ===========================================================================

describe("AC-STE-722.2 retro_offer.ts writes nothing", () => {
  test("AC-.2 a printing run leaves .dpt/ledger/retro/, the .dpt tree and git status unchanged", () => {
    const root = makeRetroTree("readonly", { retro: "true", tracking: { token_stats: true, tool_calls: false, gate_outcomes: false } });
    writeLedger(root, "tripped");
    const statusBefore = gitStatus(root);
    const dptBefore = dptSnapshot(root);
    expect(existsSync(retroDir(root))).toBe(false);
    const r = runRetroOffer(root, FR_ID);
    expect(r.code, describeRun(r)).toBe(0);
    // Positive companion: this is a printing run, not a silent one.
    expect(r.stdout, describeRun(r)).toBe(`scope=${FR_ID}\n${TRIPPED_RULE_LINE}\n`);
    expect(existsSync(retroDir(root))).toBe(false);
    expect(dptSnapshot(root)).toEqual(dptBefore);
    expect(gitStatus(root)).toBe(statusBefore);
  }, T);
});

// ===========================================================================
// AC-STE-722.3 — one derivation
// ===========================================================================

describe("AC-STE-722.3 retro_offer.ts source scan", () => {
  const src = (): string => read(RETRO_OFFER);
  const importLines = (): string[] => src().split("\n").filter((l) => /^\s*import\b/.test(l) || /^\s*\}\s*from\b/.test(l));

  test("AC-.3 imports evaluateRetroRules from ./retro_rules and resolveRetroScope from ./retro_scope", () => {
    const body = src();
    expect(body).toMatch(/import\s*\{[^}]*\bevaluateRetroRules\b[^}]*\}\s*from\s*["']\.\/retro_rules(?:\.ts)?["']/);
    expect(body).toMatch(/import\s*\{[^}]*\bresolveRetroScope\b[^}]*\}\s*from\s*["']\.\/retro_scope(?:\.ts)?["']/);
    expect(importLines().length).toBeGreaterThan(0);
  });

  test("AC-.3 defines no rule id or threshold of its own", () => {
    const body = src();
    for (const rule of RETRO_RULES) {
      expect({ id: rule.id, named: body.includes(rule.id) }).toEqual({ id: rule.id, named: false });
      const values = typeof rule.threshold.value === "number" ? [rule.threshold.value] : Object.values(rule.threshold.value);
      for (const v of values) {
        expect({ id: rule.id, v, named: new RegExp(`\\b${v}\\b`).test(body) }).toEqual({ id: rule.id, v, named: false });
      }
    }
    expect(body).not.toContain("tokens/line");
    expect(body).not.toMatch(/\bRetroRule\s*\[\]|:\s*RetroRule\b/);
  });
});

// ===========================================================================
// AC-STE-722.13 — the switch is read before any scope or engine call
// ===========================================================================

describe("AC-STE-722.13 the switch guards the derivation", () => {
  for (const retro of ["absent", "false"] as const) {
    test(`AC-.13 switch off (${retro}): neither resolveRetroScope nor evaluateRetroRules is called`, async () => {
      const root = offerTree(`spy-${retro}`, settingsYaml({ retro, tokenStats: true }), { ledger: "tripped" });
      const resolveScope = mock(resolveRetroScope);
      const evaluate = mock(evaluateRetroRules);
      expect(await M().retroOfferLines(root, FR_ID, { resolveScope, evaluate })).toEqual([]);
      expect(resolveScope).not.toHaveBeenCalled();
      expect(evaluate).not.toHaveBeenCalled();
    }, T);
  }

  test("AC-.13 seam honoured: switch on, the injected deps are called and their result is rendered", async () => {
    const root = offerTree("spy-on", ON, { ledger: "tripped" });
    const resolveScope = mock(resolveRetroScope);
    const evaluate = mock(() => [
      { id: "syn_rule", source: ["timeline"], threshold: 3, unit: "widgets", value: 7, disposition: "tripped", reason: null },
      { id: "syn_clear", source: ["timeline"], threshold: 3, unit: "widgets", value: 1, disposition: "clear", reason: null },
    ]);
    expect(await M().retroOfferLines(root, FR_ID, { resolveScope, evaluate })).toEqual([`scope=${FR_ID}`, "rule=syn_rule 7 widgets > 3"]);
    expect(resolveScope).toHaveBeenCalledTimes(1);
    expect(evaluate).toHaveBeenCalledTimes(1);
  }, T);

  test("AC-.13 switch on, real deps: the module returns the CLI's lines", async () => {
    const root = offerTree("spy-real", ON, { ledger: "tripped" });
    expect(await M().retroOfferLines(root, FR_ID)).toEqual([`scope=${FR_ID}`, TRIPPED_RULE_LINE]);
  }, T);
});

// ===========================================================================
// AC-STE-722.10 — live mutation controls on a temp copy
// ===========================================================================

describe("AC-STE-722.10 live mutants of retro_offer.ts", () => {
  test("AC-.10 MUTANT — retro_offer.ts with the switch check stubbed true prints on a retro-off tree", async () => {
    const body = read(RETRO_OFFER);
    expect(body).toMatch(/\bretroSwitchOn\(/);
    const plugin = copyPluginTree("mut-switch");
    const copy = join(plugin, "adapters", "_shared", "src", "retro_offer.ts");
    writeFileSync(copy, body.replace(/\bretroSwitchOn\(/g, "((..._a: unknown[]) => true)("));
    const root = offerTree("mut-switch-tree", settingsYaml({ retro: "false", tokenStats: true }), { ledger: "tripped" });
    // The real module stays silent on this tree ...
    expect(runRetroOffer(root, FR_ID).stdout).toBe("");
    // ... and the mutant prints, so the AC-.1 retro-off row reds on it.
    const r = runRetroOffer(root, FR_ID, copy);
    expect(r.stdout, describeRun(r)).not.toBe("");
    // The spy row reds on it too.
    const mutant = await import(copy);
    const resolveScope = mock(resolveRetroScope);
    await mutant.retroOfferLines(root, FR_ID, { resolveScope, evaluate: mock(evaluateRetroRules) });
    expect(resolveScope).toHaveBeenCalled();
  }, T);
});

// ===========================================================================
// AC-STE-722.8 — no driven paragraph carries a performance directive
// ===========================================================================

const IMPLEMENT_ACCEPT = "Accept: `/dev-process-toolkit:retro <scope>`.";
const DELIVER_ACCEPT = "Accept: `/dev-process-toolkit:retro <milestone>` for each such milestone.";

describe("AC-STE-722.8 driven paragraphs order no step", () => {
  const cases = [
    [IMPLEMENT_UPGRADE, IMPLEMENT_SKILL],
    [IMPLEMENT_RETRO, IMPLEMENT_SKILL],
    [DELIVER_UPGRADE, DELIVER_SKILL],
    [DELIVER_RETRO, DELIVER_SKILL],
  ] as const;
  for (const [id, file] of cases) {
    test(`AC-.8 performanceDirectiveIn(drivenClauseParagraph(body, ${id})) is null`, () => {
      const offer = continuationOffer(id);
      expect(offer, `${id} is registered`).not.toBeNull();
      const paragraph = drivenClauseParagraph(read(file), offer!);
      expect(paragraph, `${id} documents its driven branch`).not.toBeNull();
      expect(performanceDirectiveIn(paragraph!)).toBeNull();
    });
  }

  test("AC-.8 the implement upgrade offer's paragraph carries the appended retro sentences", () => {
    const body = read(IMPLEMENT_SKILL);
    const paragraph = drivenClauseParagraph(body, continuationOffer(IMPLEMENT_UPGRADE)!);
    expect(paragraph).not.toBeNull();
    expect(paragraph!).toContain(IMPLEMENT_ACCEPT);
    expect(paragraph!).toContain("Run a retrospective for <scope>? [y/N]");
  });

  test("AC-.8 control: the house phrasing `On \\`y\\` run ...` in place of the accept sentence makes the upgrade offer's row hit", () => {
    const body = read(IMPLEMENT_SKILL);
    expect(body.split(IMPLEMENT_ACCEPT).length - 1).toBe(1);
    const mutated = body.replace(IMPLEMENT_ACCEPT, "On `y` run `/dev-process-toolkit:retro <scope>`.");
    const paragraph = drivenClauseParagraph(mutated, continuationOffer(IMPLEMENT_UPGRADE)!);
    expect(paragraph).not.toBeNull();
    expect(performanceDirectiveIn(paragraph!)).not.toBeNull();
  });

  test("AC-.8 the deliver retro offer's driven paragraph holds DRIVEN_OMISSION_CLAUSE alone", () => {
    const paragraph = drivenClauseParagraph(read(DELIVER_SKILL), continuationOffer(DELIVER_RETRO)!);
    expect(paragraph).toBe(DRIVEN_OMISSION_CLAUSE);
  });

  // Amended by operator ruling 2026-11-07: the control sentence is "On `y` run `/dev-process-toolkit:retro <milestone>`.",
  // which hits; "Accept runs `/retro` per such milestone." matches no PERFORMANCE_PATTERNS arm. Probe #85 patterns unchanged.
  test("AC-.8 control: \"On `y` run `/dev-process-toolkit:retro <milestone>`.\" after the deliver retro clause makes its row return a hit", () => {
    const body = read(DELIVER_SKILL);
    const offer = continuationOffer(DELIVER_RETRO)!;
    const at = body.indexOf(offer.anchor);
    expect(at).toBeGreaterThanOrEqual(0);
    const clauseAt = body.indexOf(DRIVEN_OMISSION_CLAUSE, at);
    expect(clauseAt).toBeGreaterThan(at);
    const after = clauseAt + DRIVEN_OMISSION_CLAUSE.length;
    const plant = (s: string): string => body.slice(0, after) + " " + s + body.slice(after);
    // The shipped paragraph is clean; the AC's control sentence, placed after the clause, is reported.
    expect(performanceDirectiveIn(drivenClauseParagraph(body, offer)!)).toBeNull();
    const moved = drivenClauseParagraph(plant("On `y` run `/dev-process-toolkit:retro <milestone>`."), offer);
    expect(moved).not.toBe(DRIVEN_OMISSION_CLAUSE);
    expect(performanceDirectiveIn(moved!)).not.toBeNull();
  });

  test("AC-.8 the deliver accept sentence is the colon form, and the registry holds both retro offers", () => {
    expect(read(DELIVER_SKILL)).toContain(DELIVER_ACCEPT);
    const ids = CONTINUATION_OFFERS.map((o) => o.id);
    expect(ids).toContain(IMPLEMENT_RETRO);
    expect(ids).toContain(DELIVER_RETRO);
  });
});

// ===========================================================================
// AC-STE-722.15 / AC-STE-722.16 — archived markers, graded against v3.0.0
// ===========================================================================

const C_712_14 =
  "*(Amended by AC-STE-722.14 (v3.2.0): with `retro.enabled` on, each call also prints `retro: on`, placed before `upgrade_offer: on` so that line stays last; with the retro switch off, the byte-equality above holds as written.)*";
const C_715_19 =
  "*(Amended by AC-STE-715.19 (v3.1.0): `gate_receipt.ts outcome` is a further conditional target, admitted only in a sentence that names `outcome: on`.)*";
const C_722_16 =
  "*(Amended by AC-STE-722.16 (v3.2.0): `retro_offer.ts` is a further conditional target, admitted only in a sentence that names `retro: on`.)*";
const C_724_21_TAIL = /^ \*\(Amended by AC-STE-724\.21 [^\n]*\)\*$/;

/**
 * Null when `now` is `v300` with only the line starting `prefix` changed, and
 * that line reads its v3.0.0 bytes, then ` <clause>` for each clause in order,
 * then (optionally) a tail `optionalTail` matches; else the reason.
 */
function amendedOnly(v300: string, now: string, prefix: string, clauses: readonly string[], optionalTail?: RegExp): string | null {
  const a = v300.split("\n");
  const b = now.split("\n");
  if (a.length !== b.length) return `line count ${b.length} != ${a.length}`;
  const idx = a.findIndex((l) => l.startsWith(prefix));
  if (idx < 0) return `no ${prefix} line at v3.0.0`;
  for (let i = 0; i < a.length; i++) {
    if (i === idx) continue;
    if (a[i] !== b[i]) return `line ${i + 1} differs`;
  }
  const want = a[idx] + clauses.map((c) => ` ${c}`).join("");
  if (b[idx] === want) return null;
  if (optionalTail && b[idx]!.startsWith(want) && optionalTail.test(b[idx]!.slice(want.length))) return null;
  return `the ${prefix} line is not its v3.0.0 bytes plus the clauses`;
}

const STE_712_ARCHIVE = "specs/frs/archive/STE-712.md";
const STE_708_ARCHIVE = "specs/frs/archive/STE-708.md";
const fromRepo = (rel: string): string => readFileSync(join(import.meta.dir, "..", "..", "..", rel), "utf-8");

function flipOneByteOutside(text: string, protectedPrefix: string): string {
  const lines = text.split("\n");
  const i = lines.findIndex((l) => l.length > 0 && !l.startsWith(protectedPrefix));
  const l = lines[i]!;
  lines[i] = (l[0] === "x" ? "y" : "x") + l.slice(1);
  return lines.join("\n");
}

describe("AC-STE-722.15 archived AC-STE-712.14 carries only its appended clause", () => {
  test("AC-.15 STE-712.md differs from v3.0.0 only by the clause appended to the AC-STE-712.14 line", () => {
    expect(amendedOnly(atV300(STE_712_ARCHIVE), fromRepo(STE_712_ARCHIVE), "- AC-STE-712.14:", [C_712_14])).toBeNull();
  });

  test("AC-.15 control: a one-byte edit elsewhere in the archived file turns it red", () => {
    const now = fromRepo(STE_712_ARCHIVE);
    expect(amendedOnly(atV300(STE_712_ARCHIVE), flipOneByteOutside(now, "- AC-STE-712.14:"), "- AC-STE-712.14:", [C_712_14])).not.toBeNull();
  });
});

describe("AC-STE-722.16 archived AC-STE-708.13 carries the 715.19 clause then the 722.16 clause", () => {
  test("AC-.16 STE-708.md differs from v3.0.0 only on the AC-STE-708.13 line: v3.0.0 bytes, the AC-STE-715.19 clause, the AC-STE-722.16 clause", () => {
    expect(
      amendedOnly(atV300(STE_708_ARCHIVE), fromRepo(STE_708_ARCHIVE), "- AC-STE-708.13:", [C_715_19, C_722_16], C_724_21_TAIL),
    ).toBeNull();
  });

  test("AC-.16 control: a one-byte edit elsewhere turns it red, and the 715.19-only line is not accepted", () => {
    const v300 = atV300(STE_708_ARCHIVE);
    const lines = v300.split("\n");
    const idx = lines.findIndex((l) => l.startsWith("- AC-STE-708.13:"));
    lines[idx] = `${lines[idx]} ${C_715_19} ${C_722_16}`;
    const expected = lines.join("\n");
    expect(amendedOnly(v300, expected, "- AC-STE-708.13:", [C_715_19, C_722_16], C_724_21_TAIL)).toBeNull();
    expect(amendedOnly(v300, flipOneByteOutside(expected, "- AC-STE-708.13:"), "- AC-STE-708.13:", [C_715_19, C_722_16], C_724_21_TAIL)).not.toBeNull();
    lines[idx] = `${v300.split("\n")[idx]} ${C_715_19}`;
    expect(amendedOnly(v300, lines.join("\n"), "- AC-STE-708.13:", [C_715_19, C_722_16], C_724_21_TAIL)).not.toBeNull();
  });
});
