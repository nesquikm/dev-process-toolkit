// STE-712 — /implement and /deliver offer the pending upgrade at close-out,
// behind the opt-in switch `close_out.upgrade_offer` (off by default).
//
// Module under test: adapters/_shared/src/upgrade_offer.ts (new), plus the
// registry in continuation_offer.ts, the two front doors that announce the
// switch (gate_capture.ts, deliver_decision.ts) and the skill/doc surfaces.
//
// API this file assumes of upgrade_offer.ts (shaped like video_offer.ts):
//   * `UPGRADE_OFFER_QUESTION` — "Apply the pending toolkit upgrades now? [y/N]".
//   * `upgradeOfferLines(projectRoot, deps?)` — async; `[]` when the switch is
//     off (checked FIRST, before any probe), else the probe's `rows` followed
//     by the question, `[]` when rows are empty or the tree is unmanaged.
//     `deps` is an optional injection seam, `{ probe?, isManaged? }`, defaulting
//     to `runUpgradeStalenessProbe` and `isToolkitManaged`. The spy rows of
//     AC-.13 and the guard rows of AC-.10 go through it.
//   * `carriedUpgradeNotes(report, offerMade)` — the Phase 4 carried-forward
//     NOTES lines for probe #69: `report.notes` unchanged (v2.101.5 render,
//     remedy line included) when no offer was made, `report.rows` (remedy line
//     dropped) when it was.
//   * CLI: `bun run upgrade_offer.ts <projectRoot>` prints the lines or nothing
//     and exits 0.
//
// AC-STE-712.10 (mutation controls) — each guard in `upgradeOfferLines`, and
// the named test that reds when it is removed:
//   - switch check      -> "AC-.13 switch absent on a stale managed tree: [] and the probe is never called"
//                          "AC-.10 switch check: switch off with an injected stale probe returns []"
//   - empty-rows guard  -> "AC-.10 empty-rows guard: switch on, managed, probe reports no rows returns []"
//   - managed-tree guard-> "AC-.10 managed guard: switch on, probe rows, unmanaged returns []"
//   Each guard row has a positive companion ("AC-.10 seam honoured: ...") so a
//   module that ignores the injected deps cannot pass a guard row vacuously.
//
// AC-STE-712.11 is the full-suite gate (`bun test` from plugins/dev-process-toolkit
// reports 0 failures, skip identities equal to trunk by name). It is graded by
// the gate run, not by a test in this file.
//
// AC-STE-712.4's count pins live in tests/m143-ste-551-continuation-offers.test.ts
// (not edited here); this file grades the entries, probe #85 and the clause.
//
// All ids, teams, projects and tags are synthetic.

import { afterAll, describe, expect, mock, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { DRIVEN_MARKER } from "../adapters/_shared/src/driven_run_signal";
import {
  CONTINUATION_OFFERS,
  DRIVEN_OMISSION_CLAUSE,
  continuationOffer,
  drivenOmissionOccurrences,
  modelRun,
  offersForSkill,
  runContinuationOfferAdoptionProbe,
  stepExecutionCounts,
} from "../adapters/_shared/src/continuation_offer";
import { NEW_KEYS, SettingsShapeError, loadProjectSection } from "../adapters/_shared/src/project_settings";
import { UPGRADE_STALENESS_REMEDY, runUpgradeStalenessProbe } from "../adapters/_shared/src/upgrade_staleness";

const PLUGIN = resolve(import.meta.dir, "..");
const REPO_ROOT = resolve(PLUGIN, "..", "..");
const SRC = join(PLUGIN, "adapters", "_shared", "src");
const MOD_PATH = join(SRC, "upgrade_offer.ts");
const GATE_CAPTURE = join(SRC, "gate_capture.ts");
const DELIVER_DECISION = join(SRC, "deliver_decision.ts");
const IMPLEMENT_SKILL = join(PLUGIN, "skills", "implement", "SKILL.md");
const DELIVER_SKILL = join(PLUGIN, "skills", "deliver", "SKILL.md");
const IMPLEMENT_REF = join(PLUGIN, "docs", "implement-reference.md");
const SKILL_ANATOMY = join(PLUGIN, "docs", "skill-anatomy.md");
const SETTINGS_REF = join(PLUGIN, "docs", "settings-reference.md");
const NFR1_TEST = join(PLUGIN, "tests", "skill-nfr-1-length.test.ts");
const LOADER_TEST = join(PLUGIN, "tests", "m_94e6f7-ste-706-settings-loader.test.ts");

const read = (p: string): string => readFileSync(p, "utf-8");

// ---------------------------------------------------------------------------
// Module loading — dynamic, so each test reds on its own while the module is
// absent instead of the whole file failing to load.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMod = any;
let loaded: AnyMod = null;
let loadError: unknown = null;
try {
  loaded = await import(MOD_PATH);
} catch (e) {
  loadError = e;
}
function M(): AnyMod {
  if (!loaded) {
    throw new Error(`upgrade_offer.ts is not loadable: ${loadError instanceof Error ? loadError.message : String(loadError)}`);
  }
  return loaded;
}

// ---------------------------------------------------------------------------
// Literals — measured on this tree (v2.101.5) before the implementation.
// ---------------------------------------------------------------------------

const QUESTION = "Apply the pending toolkit upgrades now? [y/N]";
const ON_LINE = "upgrade_offer: on";
const IMPLEMENT_OFFER = "implement_upgrade_offer";
const DELIVER_OFFER = "deliver_close_upgrade_offer";

/** Probe #69's row for the monolith fixture below, as v2.101.5 renders it. */
const MONOLITH_ROW =
  "monolith-split (1.16.0): specs/requirements.md carries 2 live FR-heading section(s) (FR-1, FR-2) — the monolithic layout retired in v1.16.0; specs/frs/ is absent — no FR has been split out into a per-FR file yet; no flat specs/plan.md — the sections' AC bullets carry no plan-side checkbox state to reconcile";

/** The v2.101.5 remedy line, byte-for-byte (also imported; the two must agree). */
const REMEDY_LITERAL =
  "Remedy: run /dev-process-toolkit:upgrade to apply these migrations (Claude can invoke it; it is not on the slash menu).";

/** gate_capture.ts stdout on the two-file green bun fixture, v2.101.5. */
const GATE_CAPTURE_V2_101_5 =
  "gate_capture: pass 2, fail 0, skip 0\n" + "gate_capture: 0 skip(s) named by `bun test` (bun)\n";

/** deliver_decision.ts stdout on the M900 fixture rooted at `syn-deliver`, v2.101.5 (eight fields). */
const DELIVER_DECISION_V2_101_5 = [
  "argument_kind: milestone_identity",
  "target_repo_route: invoking",
  "resume_state: ready_to_implement",
  "chain:",
  "  1. /implement M900 (worker)",
  "  2. /ship-milestone M900 (worker)",
  "  3. /pr M900 (worker)",
  "merge_policy: offer -> offer",
  "gate_class: content",
  "gate_relays: yes",
  "remote_control: syn-deliver-m900",
  "",
].join("\n");

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SCRATCH: string[] = [];
afterAll(() => {
  for (const dir of SCRATCH.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(label: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `ste712-${label}-`)));
  SCRATCH.push(dir);
  return dir;
}

function writeTree(root: string, files: Record<string, string>): string {
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  return root;
}

function tree(label: string, files: Record<string, string>): string {
  return writeTree(tempDir(label), files);
}

const SETTINGS_HEAD = 'schema_version: 1\nmin_dpt_version: "2.0.0"\n';
const SWITCH_ON = "close_out:\n  upgrade_offer:\n    enabled: true\n";
const SWITCH_OFF = "close_out:\n  upgrade_offer:\n    enabled: false\n";
const SETUP_MARKER_MD = "<!-- generated by /dev-process-toolkit:setup -->\n# Synthetic\n";
// Amended by AC-STE-775.3 (M_4daa6e): a current 3.6.0 settings file declares retro.priority, so the
// "current"/"stale" trees below carry it and probe #69 reports only what each fixture plants.
const CURRENT_RETRO = "retro:\n  priority: [waste, tokens, time]\n";

const MONOLITH = [
  "# Requirements",
  "",
  "### FR-1: First thing",
  "",
  "- AC-1.1: it works",
  "",
  "### FR-2: Second thing",
  "",
  "- AC-2.1: it also works",
  "",
].join("\n");

/** A managed tree (settings file) with the switch ON; `stale` plants a monolith. */
function switchOnTree(label: string, stale: boolean): string {
  return tree(label, {
    "CLAUDE.md": SETUP_MARKER_MD,
    "specs/settings.yaml": SETTINGS_HEAD + SWITCH_ON + CURRENT_RETRO, // Amended by AC-STE-775.3 (M_4daa6e): current retro.priority
    ...(stale ? { "specs/requirements.md": MONOLITH } : {}),
  });
}

/** A stale managed tree with NO switch (settings file without close_out). */
function staleSwitchAbsentTree(label: string): string {
  return tree(label, {
    "CLAUDE.md": SETUP_MARKER_MD,
    "specs/settings.yaml": SETTINGS_HEAD + CURRENT_RETRO, // Amended by AC-STE-775.3 (M_4daa6e): current retro.priority
    "specs/requirements.md": MONOLITH,
  });
}

interface Run {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

function spawn(file: string, args: readonly string[], cwd: string): Run {
  const proc = Bun.spawnSync([process.execPath, "run", file, ...args], {
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, NO_COLOR: "1" },
    timeout: 120_000,
  });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), code: proc.exitCode ?? -1 };
}

const runOfferCli = (root: string): Run => spawn(MOD_PATH, [root], root);
const describeRun = (r: Run): string => `exit ${r.code}\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`;

/** The skill rule under test: the offer CLI runs only after an `upgrade_offer: on` LAST line. */
function callsOfferCli(priorStdout: string): boolean {
  const lines = priorStdout.replace(/\n+$/, "").split("\n");
  return lines[lines.length - 1] === ON_LINE;
}

const PLAIN_BODY = "/dev-process-toolkit:implement SYN-900\n\nBuild the FR on this branch, then stop.";
const DRIVEN_BODY = `${DRIVEN_MARKER}\n${PLAIN_BODY}`;

// ===========================================================================
// AC-STE-712.1 — upgradeOfferLines with the switch on
// ===========================================================================

describe("AC-STE-712.1 upgradeOfferLines with the switch on", () => {
  test("AC-.1 a current managed tree (probe #69 reports no rows) returns []", async () => {
    const root = switchOnTree("cur", false);
    expect((await runUpgradeStalenessProbe(root)).rows).toEqual([]);
    expect(await M().upgradeOfferLines(root)).toEqual([]);
  });

  test("AC-.1 a stale managed tree returns the probe rows followed by the question", async () => {
    const root = switchOnTree("stale", true);
    expect((await runUpgradeStalenessProbe(root)).rows).toEqual([MONOLITH_ROW]);
    expect(await M().upgradeOfferLines(root)).toEqual([MONOLITH_ROW, QUESTION]);
  });

  test("AC-.1 UPGRADE_OFFER_QUESTION is the pinned literal", () => {
    expect(M().UPGRADE_OFFER_QUESTION).toBe(QUESTION);
  });
});

// ===========================================================================
// AC-STE-712.2 — the CLI
// ===========================================================================

describe("AC-STE-712.2 the offer CLI", () => {
  test("AC-.2 switch on, current tree: prints nothing, exits 0", () => {
    const r = runOfferCli(switchOnTree("cli-cur", false));
    expect(r.code, describeRun(r)).toBe(0);
    expect(r.stdout).toBe("");
  });

  test("AC-.2 switch on, stale tree: prints the rows and the question, exits 0", () => {
    const r = runOfferCli(switchOnTree("cli-stale", true));
    expect(r.code, describeRun(r)).toBe(0);
    expect(r.stdout).toBe(`${MONOLITH_ROW}\n${QUESTION}\n`);
  });

  test("AC-.2 control: unmanaged tree with a monolithic requirements.md prints nothing although probe #69 prints a row", async () => {
    const root = tree("cli-unmanaged", { "CLAUDE.md": "# Hand-written\n", "specs/requirements.md": MONOLITH });
    // The control is live: probe #69 does report a row on this tree.
    expect((await runUpgradeStalenessProbe(root)).rows).toEqual([MONOLITH_ROW]);
    const probeCli = spawn(join(SRC, "upgrade_staleness.ts"), [root], root);
    expect(probeCli.stdout.length).toBeGreaterThan(0);
    const r = runOfferCli(root);
    expect(r.code, describeRun(r)).toBe(0);
    expect(r.stdout).toBe("");
  });
});

// ===========================================================================
// AC-STE-712.3 — source scan
// ===========================================================================

describe("AC-STE-712.3 upgrade_offer.ts source scan", () => {
  const source = (): string => read(MOD_PATH);
  const importLines = (): string[] => {
    const src = source();
    return [...src.matchAll(/import\s[\s\S]*?from\s+["'][^"']+["'];?/g)].map((m) => m[0]);
  };

  test("AC-.3 imports runUpgradeStalenessProbe and UPGRADE_STALENESS_REMEDY from ./upgrade_staleness", () => {
    const fromStaleness = importLines().filter((l) => /from\s+["']\.\/upgrade_staleness(\.ts)?["']/.test(l));
    expect(fromStaleness.length).toBeGreaterThan(0);
    const joined = fromStaleness.join("\n");
    expect(joined).toContain("runUpgradeStalenessProbe");
    expect(joined).toContain("UPGRADE_STALENESS_REMEDY");
  });

  test("AC-.3 no import of MIGRATIONS or the migration registry", () => {
    for (const line of importLines()) {
      expect(line).not.toMatch(/\bMIGRATIONS\b/);
      expect(line).not.toMatch(/["']\.\/migrations(\/|["'])/);
    }
  });

  test("AC-.3 no copy of the remedy text", () => {
    const src = source();
    expect(REMEDY_LITERAL).toBe(UPGRADE_STALENESS_REMEDY);
    expect(src.includes(UPGRADE_STALENESS_REMEDY)).toBe(false);
    expect(src.includes("to apply these migrations")).toBe(false);
  });
});

// ===========================================================================
// AC-STE-712.4 — registry entries and probe #85
// ===========================================================================

const IMPLEMENT_FILE = "plugins/dev-process-toolkit/skills/implement/SKILL.md";
const DELIVER_FILE = "plugins/dev-process-toolkit/skills/deliver/SKILL.md";

describe("AC-STE-712.4 registry entries", () => {
  for (const [id, skill, file] of [
    [IMPLEMENT_OFFER, "implement", IMPLEMENT_FILE],
    [DELIVER_OFFER, "deliver", DELIVER_FILE],
  ] as const) {
    test(`AC-.4 ${id} is registered with every ContinuationOffer field`, () => {
      const offer = continuationOffer(id);
      expect(offer).not.toBeNull();
      expect(offer!.id).toBe(id);
      expect(offer!.skill).toBe(skill);
      expect(offer!.file).toBe(file);
      expect(offer!.anchor).toBe(QUESTION);
      expect([...offer!.runsWhenAccepted]).toEqual(["/upgrade"]);
      expect([...offer!.runsWhenDriven]).toEqual([]);
      expect(typeof offer!.asks).toBe("string");
      expect(offer!.asks.trim().length).toBeGreaterThan(0);
      // The anchor occurs exactly once in the file the entry names.
      const body = read(join(REPO_ROOT, file));
      expect(body.split(QUESTION).length - 1, `${id} anchor occurrences`).toBe(1);
    });
  }

  test("AC-.4 the registry holds the two new entries beside the eight shipped ones; distinct skills now include deliver", () => {
    const ids = CONTINUATION_OFFERS.map((o) => o.id);
    expect(ids).toContain(IMPLEMENT_OFFER);
    expect(ids).toContain(DELIVER_OFFER);
    expect(offersForSkill("deliver").map((o) => o.id)).toEqual([DELIVER_OFFER, "deliver_close_retro_offer"]); // Amended by AC-STE-722.9 (M_d1b4b7)
    expect(offersForSkill("implement").map((o) => o.id)).toContain(IMPLEMENT_OFFER);
  });

  test("AC-.4 each skill carries one omission clause per offer it owns (implement 4, deliver 2)", () => { // Amended by AC-STE-722.9 (M_d1b4b7)
    expect(drivenOmissionOccurrences(read(IMPLEMENT_SKILL))).toBe(offersForSkill("implement").length);
    expect(offersForSkill("implement").length).toBe(4); // Amended by AC-STE-722.9 (M_d1b4b7)
    expect(drivenOmissionOccurrences(read(DELIVER_SKILL))).toBe(2); // Amended by AC-STE-722.9 (M_d1b4b7)
  });

  test("AC-.4 probe #85 reports zero violations on the tree", () => {
    const report = runContinuationOfferAdoptionProbe(REPO_ROOT);
    expect(report.vacuous).toBe(false);
    expect(report.violations).toEqual([]);
    // And it grades the new entries, not a registry without them.
    expect(continuationOffer(IMPLEMENT_OFFER)).not.toBeNull();
    expect(continuationOffer(DELIVER_OFFER)).not.toBeNull();
  });

  /** A temp copy of every registered skill surface plus /deliver's. */
  function copySkills(): string {
    const root = tempDir("probe85");
    const skills = new Set([...CONTINUATION_OFFERS.map((o) => o.skill), "deliver"]);
    for (const skill of skills) {
      const dst = join(root, "plugins", "dev-process-toolkit", "skills", skill, "SKILL.md");
      mkdirSync(dirname(dst), { recursive: true });
      cpSync(join(PLUGIN, "skills", skill, "SKILL.md"), dst);
    }
    return root;
  }

  for (const [id, file] of [
    [IMPLEMENT_OFFER, IMPLEMENT_FILE],
    [DELIVER_OFFER, DELIVER_FILE],
  ] as const) {
    test(`AC-.4 MUTATION — deleting the omission clause from the ${id} span makes probe #85 report one`, () => {
      const offer = continuationOffer(id);
      expect(offer).not.toBeNull();
      const root = copySkills();
      expect(runContinuationOfferAdoptionProbe(root).violations).toEqual([]);

      const target = join(root, file);
      const before = read(target);
      const anchorAt = before.indexOf(offer!.anchor);
      expect(anchorAt).toBeGreaterThanOrEqual(0);
      const clauseAt = before.indexOf(DRIVEN_OMISSION_CLAUSE, anchorAt);
      expect(clauseAt).toBeGreaterThan(anchorAt);
      writeFileSync(target, before.slice(0, clauseAt) + before.slice(clauseAt + DRIVEN_OMISSION_CLAUSE.length));
      expect(read(target).length).toBeLessThan(before.length);

      const violations = runContinuationOfferAdoptionProbe(root).violations;
      expect(violations.length).toBe(1);
      expect(violations[0]!.file).toBe(file);
      expect(violations[0]!.message).toContain(`offer=${id}`);
    });
  }
});

// ===========================================================================
// AC-STE-712.5 — modelRun with the switch on
// ===========================================================================

describe("AC-STE-712.5 modelled runs with the switch on", () => {
  test("AC-.5 standalone /implement reaching the offer: one operator turn, /upgrade once on acceptance", () => {
    const run = modelRun({
      chain: [{ skill: "/implement", target: "SYN-900" }],
      promptBody: PLAIN_BODY,
      reachedOffers: [IMPLEMENT_OFFER],
    });
    expect(run.operatorTurns).toEqual([IMPLEMENT_OFFER]);
    expect(stepExecutionCounts(run)["/upgrade"]).toBe(1);
  });

  test("AC-.5 standalone /deliver reaching the close-out offer: one operator turn, /upgrade once", () => {
    const run = modelRun({
      chain: [{ skill: "/deliver", target: "M900" }],
      promptBody: PLAIN_BODY,
      reachedOffers: [DELIVER_OFFER],
    });
    expect(run.operatorTurns).toEqual([DELIVER_OFFER]);
    expect(stepExecutionCounts(run)["/upgrade"]).toBe(1);
  });

  test("AC-.5 driven runs record zero turns and run nothing", () => {
    for (const [skill, offer] of [
      ["/implement", IMPLEMENT_OFFER],
      ["/deliver", DELIVER_OFFER],
    ] as const) {
      const run = modelRun({ chain: [{ skill, target: "SYN-900" }], promptBody: DRIVEN_BODY, reachedOffers: [offer] });
      expect(run.operatorTurns).toEqual([]);
      expect(run.executed).toEqual([skill]);
    }
    // Positive companion: the same entries fire standalone, so the zero above is the driven branch.
    expect(continuationOffer(IMPLEMENT_OFFER)).not.toBeNull();
    expect(continuationOffer(DELIVER_OFFER)).not.toBeNull();
  });

  test("AC-.5 a /deliver run whose /implement stage is driven never records the implement offer", () => {
    const outer = modelRun({
      chain: [{ skill: "/deliver", target: "M900" }],
      promptBody: PLAIN_BODY,
      reachedOffers: [DELIVER_OFFER, IMPLEMENT_OFFER],
    });
    const stage = modelRun({
      chain: [{ skill: "/implement", target: "M900" }],
      promptBody: DRIVEN_BODY,
      reachedOffers: [IMPLEMENT_OFFER],
    });
    const turns = [...outer.operatorTurns, ...stage.operatorTurns];
    expect(turns).not.toContain(IMPLEMENT_OFFER);
    expect(turns).toEqual([DELIVER_OFFER]);
  });
});

// ===========================================================================
// AC-STE-712.6 — /implement placement
// ===========================================================================

const SHIP_READY_ANCHOR = "is ship-ready — run the close ceremony now? [y/N]";
const PHASE5_ANCHOR = "Run /ship-milestone M<N> now? (y/n):";
const CLOSE_B = "**(b) Release**";
const CLOSE_C = "**(c) Post-release verification**";

function sentencesOf(text: string): string[] {
  return text.split(/\n|(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
}

describe("AC-STE-712.6 /implement places the offer", () => {
  test("AC-.6 the offer sits after Close (b) and (c) and before the ship-ready offer and the Phase 5 prompt", () => {
    const body = read(IMPLEMENT_SKILL);
    const b = body.indexOf(CLOSE_B);
    const c = body.indexOf(CLOSE_C);
    const q = body.indexOf(QUESTION);
    const shipReady = body.indexOf(SHIP_READY_ANCHOR);
    const phase5 = body.indexOf(PHASE5_ANCHOR);
    expect(b).toBeGreaterThanOrEqual(0);
    expect(c).toBeGreaterThan(b);
    expect(q).toBeGreaterThan(c);
    expect(shipReady).toBeGreaterThan(q);
    expect(phase5).toBeGreaterThan(q);
  });

  test("AC-.6 the span states the remedy line is dropped only when the offer is made", () => {
    const body = read(IMPLEMENT_SKILL);
    const c = body.indexOf(CLOSE_C);
    const shipReady = body.indexOf(SHIP_READY_ANCHOR);
    expect(c).toBeGreaterThanOrEqual(0);
    expect(shipReady).toBeGreaterThan(c);
    const span = body.slice(c, shipReady);
    const hit = sentencesOf(span).find(
      (s) => /remedy line/i.test(s) && /dropped|drops/i.test(s) && /only when the offer is made/i.test(s),
    );
    expect(hit, "a sentence naming the remedy line, dropped only when the offer is made").toBeDefined();
  });

  test("AC-.6 the prose lives in docs/implement-reference.md § Upgrade offer behind a pointer", () => {
    expect(read(IMPLEMENT_SKILL)).toContain("`docs/implement-reference.md` § Upgrade offer");
    expect(read(IMPLEMENT_REF)).toMatch(/^## Upgrade offer\s*$/m);
  });
});

// ===========================================================================
// AC-STE-712.7 — /deliver close-out section
// ===========================================================================

const CLOSE_OUT_HEADING = "## Close-out — offers after the last milestone";
const POST_PR_HEADING = "## Post-PR — merge-policy routing";

function closeOutSection(body: string): string | null {
  const start = body.indexOf(CLOSE_OUT_HEADING);
  if (start < 0) return null;
  const rest = body.slice(start + CLOSE_OUT_HEADING.length);
  const next = rest.search(/^## /m);
  return CLOSE_OUT_HEADING + (next < 0 ? rest : rest.slice(0, next));
}

describe("AC-STE-712.7 /deliver close-out section", () => {
  test("AC-.7 the section exists once, after the post-PR section", () => {
    const body = read(DELIVER_SKILL);
    expect(body.split(CLOSE_OUT_HEADING).length - 1).toBe(1);
    expect(body.indexOf(CLOSE_OUT_HEADING)).toBeGreaterThan(body.indexOf(POST_PR_HEADING));
    expect(body.indexOf(POST_PR_HEADING)).toBeGreaterThanOrEqual(0);
  });

  test("AC-.7 the section names the CLI, once per run, every merge policy, prints nothing, later offers register", () => {
    const section = closeOutSection(read(DELIVER_SKILL));
    expect(section).not.toBeNull();
    expect(section!).toContain("upgrade_offer.ts");
    expect(section!).toContain(QUESTION);
    expect(section!).toMatch(/once per run/i);
    expect(section!).toMatch(/(every|any|each) merge policy/i);
    expect(section!).toMatch(/prints nothing/i);
    expect(section!).toMatch(/later[^.\n]*offers?[^.\n]*register|register[^.\n]*later[^.\n]*offer/i);
  });
});

// ===========================================================================
// AC-STE-712.8 — skill anatomy no longer says probe #69 alone
// ===========================================================================

describe("AC-STE-712.8 docs/skill-anatomy.md discovery of /upgrade", () => {
  const paragraph = (): string => {
    const body = read(SKILL_ANATOMY);
    const line = body.split("\n").find((l) => l.startsWith("`/upgrade` is the worked example of case 3"));
    expect(line, "the /upgrade worked-example paragraph").toBeDefined();
    return line!;
  };

  test("AC-.8 the sole-source sentence is gone", () => {
    expect(read(SKILL_ANATOMY)).not.toContain(
      "Discovery moves to `/gate-check` probe #69 (`upgrade_staleness`), which detects the stale bootstrap",
    );
  });

  test("AC-.8 the paragraph names probe #69, the /setup upgrade_available row and both opt-in close-out offers", () => {
    const p = paragraph();
    expect(p).toContain("probe #69");
    expect(p).toContain("`upgrade_available`");
    expect(p).toMatch(/close-out/i);
    expect(p).toContain("/implement");
    expect(p).toContain("/deliver");
    expect(p).toMatch(/opt-in|close_out\.upgrade_offer/);
  });
});

// ===========================================================================
// AC-STE-712.9 — NFR-1 cap (tests/skill-nfr-1-length.test.ts, SKILL_LINE_CAP)
// ===========================================================================

describe("AC-STE-712.9 NFR-1 cap holds with the offer in place", () => {
  const CAP = 358;
  const lineCount = (text: string): number => text.split("\n").length;

  test("AC-.9 SKILL_LINE_CAP is not raised", () => {
    expect(read(NFR1_TEST)).toContain(`const SKILL_LINE_CAP = ${CAP};`);
  });

  test("AC-.9 skills/implement/SKILL.md carries the offer and stays ≤ 358 lines", () => {
    const body = read(IMPLEMENT_SKILL);
    expect(body).toContain(QUESTION);
    expect(lineCount(body)).toBeLessThanOrEqual(CAP);
  });

  test("AC-.9 skills/deliver/SKILL.md carries the close-out section and stays ≤ 358 lines", () => {
    const body = read(DELIVER_SKILL);
    expect(body).toContain(CLOSE_OUT_HEADING);
    expect(lineCount(body)).toBeLessThanOrEqual(CAP);
  });
});

// ===========================================================================
// AC-STE-712.10 — guard mutation controls (behavioural, via the deps seam)
// ===========================================================================

describe("AC-STE-712.10 guards in upgradeOfferLines", () => {
  const probeWith = (rows: string[]) =>
    mock(async (_root: string) => ({
      rows,
      notes: rows.length > 0 ? [...rows, UPGRADE_STALENESS_REMEDY] : [],
      violations: [],
    }));

  test("AC-.10 seam honoured: switch on, injected rows, managed returns rows + question", async () => {
    const root = switchOnTree("seam", false); // really clean: only the injected probe can produce a row
    const probe = probeWith(["syn-entry (9.9.9): synthetic evidence"]);
    const lines = await M().upgradeOfferLines(root, { probe, isManaged: () => true });
    expect(lines).toEqual(["syn-entry (9.9.9): synthetic evidence", QUESTION]);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  test("AC-.10 switch check: switch off with an injected stale probe returns []", async () => {
    const root = tree("guard-switch", { "CLAUDE.md": SETUP_MARKER_MD, "specs/settings.yaml": SETTINGS_HEAD + SWITCH_OFF });
    const probe = probeWith(["syn-entry (9.9.9): synthetic evidence"]);
    expect(await M().upgradeOfferLines(root, { probe, isManaged: () => true })).toEqual([]);
    expect(probe).not.toHaveBeenCalled();
  });

  test("AC-.10 empty-rows guard: switch on, managed, probe reports no rows returns []", async () => {
    const root = switchOnTree("guard-rows", true); // really stale: a module ignoring the seam would print the row
    const probe = probeWith([]);
    expect(await M().upgradeOfferLines(root, { probe, isManaged: () => true })).toEqual([]);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  test("AC-.10 managed guard: switch on, probe rows, unmanaged returns []", async () => {
    const root = switchOnTree("guard-managed", false);
    const probe = probeWith(["syn-entry (9.9.9): synthetic evidence"]);
    expect(await M().upgradeOfferLines(root, { probe, isManaged: () => false })).toEqual([]);
  });
});

// ===========================================================================
// AC-STE-712.12 — the switch
// ===========================================================================

describe("AC-STE-712.12 the switch", () => {
  const OFF = { upgrade_offer: { enabled: false } };

  test("AC-.12 absent section reads off", () => {
    const root = tree("sw-nosection", { "specs/settings.yaml": SETTINGS_HEAD });
    expect(loadProjectSection(root, "close_out")).toEqual(OFF);
  });

  test("AC-.12 absent key (close_out: {}) reads off", () => {
    const root = tree("sw-nokey", { "specs/settings.yaml": `${SETTINGS_HEAD}close_out: {}\n` });
    expect(loadProjectSection(root, "close_out")).toEqual(OFF);
  });

  test("AC-.12 absent enabled (upgrade_offer: {}) reads off", () => {
    const root = tree("sw-noenabled", { "specs/settings.yaml": `${SETTINGS_HEAD}close_out:\n  upgrade_offer: {}\n` });
    expect(loadProjectSection(root, "close_out")).toEqual(OFF);
  });

  test("AC-.12 a legacy tree reads off", () => {
    const root = tree("sw-legacy", { "CLAUDE.md": "# Synthetic\n\n## Task Tracking\n\nmode: none\n" });
    expect(loadProjectSection(root, "close_out")).toEqual(OFF);
  });

  test("AC-.12 a tree with no settings file reads off", () => {
    const root = tree("sw-empty", { "README.md": "synthetic\n" });
    expect(loadProjectSection(root, "close_out")).toEqual(OFF);
  });

  test("AC-.12 upgrade_offer: { enabled: true } reads on", () => {
    const root = tree("sw-on", { "specs/settings.yaml": SETTINGS_HEAD + SWITCH_ON });
    expect(loadProjectSection(root, "close_out")).toEqual({ upgrade_offer: { enabled: true } });
  });

  test("AC-.12 a bare upgrade_offer: true throws SettingsShapeError", () => {
    const root = tree("sw-bare", { "specs/settings.yaml": `${SETTINGS_HEAD}close_out:\n  upgrade_offer: true\n` });
    expect(() => loadProjectSection(root, "close_out")).toThrow(SettingsShapeError);
  });

  test("AC-.12 an unknown key under close_out throws SettingsShapeError", () => {
    const root = tree("sw-unknown", { "specs/settings.yaml": `${SETTINGS_HEAD}close_out:\n  syn_bogus_offer: true\n` });
    expect(() => loadProjectSection(root, "close_out")).toThrow(SettingsShapeError);
  });

  test("AC-.12 docs/settings-reference.md names the key with its default", () => {
    const row = read(SETTINGS_REF)
      .split("\n")
      .find((l) => l.includes("`close_out.upgrade_offer`"));
    expect(row).toBeDefined();
    expect(row!).toContain("`{ enabled: false }`");
  });

  test("AC-.12 the AC-STE-706.12 table holds the new row and NEW_KEYS lists it", () => {
    expect([...NEW_KEYS]).toContain("close_out.upgrade_offer");
    expect(read(LOADER_TEST)).toMatch(/"close_out\.upgrade_offer":\s*\{\s*kind:\s*"new",\s*fr:\s*"STE-712"/);
  });

  test("AC-.12 on a both-homes tree the CLI prints nothing and exits 0", () => {
    const root = tree("sw-both", {
      "CLAUDE.md": "# Synthetic\n\n## Orchestration\n\ndefault_effort: high\nmerge_policy: offer\n",
      "specs/settings.yaml": SETTINGS_HEAD + SWITCH_ON,
      "specs/requirements.md": MONOLITH,
    });
    // The control is live: the loader refuses this tree as both homes.
    expect(() => loadProjectSection(root, "close_out")).toThrow(SettingsShapeError);
    const r = runOfferCli(root);
    expect(r.code, describeRun(r)).toBe(0);
    expect(r.stdout).toBe("");
  });
});

// ===========================================================================
// AC-STE-712.13 — default byte identity
// ===========================================================================

describe("AC-STE-712.13 default byte identity", () => {
  test("AC-.13 switch absent on a stale managed tree: [] and the probe is never called", async () => {
    const root = staleSwitchAbsentTree("def-spy");
    // The tree really is stale: probe #69 reports the row.
    expect((await runUpgradeStalenessProbe(root)).rows).toEqual([MONOLITH_ROW]);
    const probe = mock(runUpgradeStalenessProbe);
    expect(await M().upgradeOfferLines(root, { probe })).toEqual([]);
    expect(probe).not.toHaveBeenCalled();
  });

  test("AC-.13 switch absent on a stale managed tree: the CLI prints nothing and exits 0", () => {
    const r = runOfferCli(staleSwitchAbsentTree("def-cli"));
    expect(r.code, describeRun(r)).toBe(0);
    expect(r.stdout).toBe("");
  });

  test("AC-.13 modelled standalone /implement records zero operator turns for the offer (switch absent), one with it on", async () => {
    const reached = async (root: string): Promise<string[]> =>
      (await M().upgradeOfferLines(root)).length > 0 ? [IMPLEMENT_OFFER] : [];
    const off = modelRun({
      chain: [{ skill: "/implement", target: "SYN-900" }],
      promptBody: PLAIN_BODY,
      reachedOffers: await reached(staleSwitchAbsentTree("def-model-off")),
    });
    expect(off.operatorTurns).not.toContain(IMPLEMENT_OFFER);
    const on = modelRun({
      chain: [{ skill: "/implement", target: "SYN-900" }],
      promptBody: PLAIN_BODY,
      reachedOffers: await reached(switchOnTree("def-model-on", true)),
    });
    expect(on.operatorTurns).toEqual([IMPLEMENT_OFFER]);
  });

  test("AC-.13 the Phase 4 GATE PASSED WITH NOTES block equals the v2.101.5 render, remedy line included, when no offer is made", async () => {
    const root = staleSwitchAbsentTree("def-phase4");
    const report = await runUpgradeStalenessProbe(root);
    const v2_101_5 = [MONOLITH_ROW, REMEDY_LITERAL];
    expect(report.notes).toEqual(v2_101_5);
    expect(M().carriedUpgradeNotes(report, false)).toEqual(v2_101_5);
  });

  test("AC-.13 when the offer is made the Phase 4 block keeps the rows and drops the remedy line", async () => {
    const report = await runUpgradeStalenessProbe(switchOnTree("def-phase4-on", true));
    expect(M().carriedUpgradeNotes(report, true)).toEqual([MONOLITH_ROW]);
  });

  test("AC-.13 the /deliver close-out prints nothing: its decision record carries no on-line and the CLI prints nothing", () => {
    const root = deliverFixture("legacy");
    const decision = spawn(DELIVER_DECISION, ["M900", root], root);
    expect(callsOfferCli(decision.stdout)).toBe(false);
    const offer = runOfferCli(root);
    expect(offer.code, describeRun(offer)).toBe(0);
    expect(offer.stdout).toBe("");
  });
});

// ===========================================================================
// AC-STE-712.14 — keyed on an existing call
// ===========================================================================

/** A two-file green bun project; `settings` is the specs/settings.yaml body or null. */
function gateFixture(label: string, settings: string | null): string {
  const files: Record<string, string> = {
    "package.json": `${JSON.stringify({ name: "syn-gate", private: true })}\n`,
    "tests/a.test.ts": 'import { expect, test } from "bun:test";\n\ntest("a one", () => { expect(1 + 1).toBe(2); });\n',
    "tests/b.test.ts": 'import { expect, test } from "bun:test";\n\ntest("b one", () => { expect(1 + 1).toBe(2); });\n',
  };
  if (settings !== null) files["specs/settings.yaml"] = settings;
  return tree(`gate-${label}`, files);
}

const PLAN_M900 = [
  "---",
  "milestone: M900",
  "status: active",
  "shipped_in: null",
  "---",
  "",
  "# M900 — fixture milestone",
  "",
  "## Tasks",
  "",
  "- [ ] Build the thing",
  "",
].join("\n");

const FR_SYN_900 = [
  "---",
  "title: Fixture FR",
  "milestone: M900",
  "status: active",
  "archived_at: null",
  "tracker:",
  "  linear: SYN-900",
  "created_at: 2026-08-25T00:00:00Z",
  "changelog_category: Added",
  "---",
  "",
  "# Fixture FR",
  "",
  "## Acceptance Criteria",
  "",
  "- AC-SYN-900.1: it exists.",
  "",
].join("\n");

const ORCH_YAML = "orchestration:\n  default_effort: high\n  merge_policy: offer\n";

/** The M900 decision fixture rooted at a directory named `syn-deliver`. */
function deliverFixture(kind: "legacy" | "absent" | "off" | "on"): string {
  const root = join(tempDir(`deliver-${kind}`), "syn-deliver");
  const files: Record<string, string> = {
    "specs/plan/M900.md": PLAN_M900,
    "specs/frs/SYN-900.md": FR_SYN_900,
  };
  if (kind === "legacy") {
    files["CLAUDE.md"] = "# Fixture\n\n## Orchestration\n\ndefault_effort: high\nmerge_policy: offer\n";
  } else {
    files["CLAUDE.md"] = "# Fixture\n";
    files["specs/settings.yaml"] =
      SETTINGS_HEAD + ORCH_YAML + (kind === "off" ? SWITCH_OFF : kind === "on" ? SWITCH_ON : "");
  }
  return writeTree(root, files);
}

describe("AC-STE-712.14 gate_capture.ts announces the switch on its own output", () => {
  for (const [label, settings] of [
    ["no settings file", null],
    ["switch absent", SETTINGS_HEAD],
    ["switch off", SETTINGS_HEAD + SWITCH_OFF],
    ["loader refusal (bare upgrade_offer: true)", `${SETTINGS_HEAD}close_out:\n  upgrade_offer: true\n`],
  ] as const) {
    test(`AC-.14 gate_capture.ts with ${label} prints exactly its v2.101.5 lines`, () => {
      const root = gateFixture(label.replace(/\W+/g, "-"), settings);
      const r = spawn(GATE_CAPTURE, [root], root);
      expect(r.stdout, describeRun(r)).toBe(GATE_CAPTURE_V2_101_5);
      expect(callsOfferCli(r.stdout)).toBe(false);
    }, 120_000);
  }

  test("AC-.14 gate_capture.ts with upgrade_offer: { enabled: true } ends in `upgrade_offer: on`", () => {
    const root = gateFixture("on", SETTINGS_HEAD + SWITCH_ON);
    const r = spawn(GATE_CAPTURE, [root], root);
    expect(r.stdout, describeRun(r)).toBe(`${GATE_CAPTURE_V2_101_5}${ON_LINE}\n`);
    expect(callsOfferCli(r.stdout)).toBe(true);
  }, 120_000);
});

describe("AC-STE-712.14 deliver_decision.ts announces the switch after its eight fields", () => {
  for (const kind of ["legacy", "absent", "off"] as const) {
    test(`AC-.14 deliver_decision.ts (${kind}) prints exactly its eight fields`, () => {
      const root = deliverFixture(kind);
      const r = spawn(DELIVER_DECISION, ["M900", root], root);
      expect(r.code, describeRun(r)).toBe(0);
      expect(r.stdout).toBe(DELIVER_DECISION_V2_101_5);
      expect(callsOfferCli(r.stdout)).toBe(false);
    });
  }

  test("AC-.14 deliver_decision.ts with upgrade_offer: { enabled: true } ends in `upgrade_offer: on`", () => {
    const root = deliverFixture("on");
    const r = spawn(DELIVER_DECISION, ["M900", root], root);
    expect(r.code, describeRun(r)).toBe(0);
    expect(r.stdout).toBe(`${DELIVER_DECISION_V2_101_5}${ON_LINE}\n`);
    expect(callsOfferCli(r.stdout)).toBe(true);
  });
});

/** Every sentence mentioning upgrade_offer.ts that does NOT also name `upgrade_offer: on`. */
function unkeyedMentions(body: string): string[] {
  return sentencesOf(body).filter((s) => s.includes("upgrade_offer.ts") && !s.includes(ON_LINE));
}
const mentionCount = (body: string): number => body.split("upgrade_offer.ts").length - 1;

describe("AC-STE-712.14 needle: every upgrade_offer.ts mention is keyed on `upgrade_offer: on`", () => {
  for (const [label, path] of [
    ["skills/implement/SKILL.md", IMPLEMENT_SKILL],
    ["skills/deliver/SKILL.md", DELIVER_SKILL],
    ["docs/implement-reference.md", IMPLEMENT_REF],
  ] as const) {
    test(`AC-.14 needle: ${label}`, () => {
      const body = read(path);
      expect(mentionCount(body), `${label} names the offer CLI`).toBeGreaterThan(0);
      expect(unkeyedMentions(body)).toEqual([]);
    });
  }

  test("AC-.14 needle control: a planted unconditional mention in a temporary copy turns it red", () => {
    const dir = tempDir("needle");
    const copy = join(dir, "SKILL.md");
    const planted =
      "# Synthetic\n\nAt close-out run `bun run \"${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/upgrade_offer.ts\" <projectRoot>` and ask its question.\n";
    writeFileSync(copy, planted);
    expect(unkeyedMentions(read(copy)).length).toBe(1);
    // Positive control: the keyed form passes the same needle.
    const keyed =
      "# Synthetic\n\nWhen step 14 printed `upgrade_offer: on` as its last line, run `bun run \"${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/upgrade_offer.ts\" <projectRoot>`.\n";
    writeFileSync(copy, keyed);
    expect(unkeyedMentions(read(copy))).toEqual([]);
    // And on a real surface: appending the unconditional mention to a copy reds it.
    if (existsSync(IMPLEMENT_SKILL)) {
      writeFileSync(copy, `${read(IMPLEMENT_SKILL)}\n${planted}`);
      expect(unkeyedMentions(read(copy)).length).toBeGreaterThan(0);
    }
  });

  test("AC-.14 modelled standalone /implement and /deliver with the switch off record no upgrade_offer.ts call", () => {
    const gate = spawn(GATE_CAPTURE, [gateFixture("model-off", SETTINGS_HEAD + SWITCH_OFF)], tmpdir());
    const decision = (() => {
      const root = deliverFixture("off");
      return spawn(DELIVER_DECISION, ["M900", root], root);
    })();
    const calls = [gate.stdout, decision.stdout].filter(callsOfferCli);
    expect(calls).toEqual([]);
    // Positive companion: with the switch on both runs would call it.
    const gateOn = spawn(GATE_CAPTURE, [gateFixture("model-on", SETTINGS_HEAD + SWITCH_ON)], tmpdir());
    const rootOn = deliverFixture("on");
    const decisionOn = spawn(DELIVER_DECISION, ["M900", rootOn], rootOn);
    expect([gateOn.stdout, decisionOn.stdout].filter(callsOfferCli).length).toBe(2);
  }, 240_000);
});
