// STE-715 (M_7bc805) AC.7, AC.8, AC.10 — an outcome record permits nothing.
//
// The three blocking hooks keep taking evidence only from the transcript Skill
// call plus an announced `kind: "gate"` receipt (STE-614, STE-641). A
// `gate-outcome` receipt is a second record in the same store, with its own
// kind and its own announcement prefix, so no evidence reader may count it.
//
// AC.11 mutation anchor in this file:
//   - letting the evidence reader accept `kind: "gate-outcome"` ->
//     "gateReceiptEvidence ignores a gate-outcome receipt" and the
//     "<hook>: ... only an outcome receipt FORGED as a dpt-receipt announcement is refused" rows.

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  FRONT_DOOR,
  HOOKS,
  PLUGIN_ROOT,
  SHORT_OF,
  SID,
  SKILL_OF,
  bashCall,
  cleanupTemps,
  makeTree,
  mintRun,
  outcomeCommand,
  parseAnnouncement,
  readJson,
  receiptCommand,
  receiptDirOf,
  receiptFiles,
  runCli,
  runHook,
  skillCall,
  stageCodeAndTest,
  tempDir,
  writeTranscript,
  type Hook,
} from "./_m_7bc805_gate_outcome_fixture";

type AnyMod = Record<string, any>;
const T = 120_000;

afterAll(cleanupTemps);

async function receiptModule(): Promise<AnyMod> {
  return (await import("../adapters/_shared/src/gate_receipt")) as AnyMod;
}

const ABS = FRONT_DOOR;

// ===========================================================================
// AC-STE-715.7 — classifiers
// ===========================================================================

describe("AC-STE-715.7 announcesGateReceipt / runsGateOutcome", () => {
  const OUTCOME_FORMS = [
    `bun run ${ABS} outcome gate-check /tmp/x pass`,
    `bun ${ABS} outcome gate-check /tmp/x pass`,
    `bun run "${ABS}" outcome tdd "/tmp/x" fail --step lint=pass`,
    `bun run ${ABS} outcome spec-review /tmp/x pass --step tests=fail --step lint=pass`,
    `bun run ${ABS} outcome`,
  ];

  test("announcesGateReceipt returns false for every outcome command form", async () => {
    const m = await receiptModule();
    for (const c of OUTCOME_FORMS) expect({ c, v: m.announcesGateReceipt(c) }).toEqual({ c, v: false });
    // CONTROL: the receipt command itself still announces.
    expect(m.announcesGateReceipt(`bun run ${ABS} gate-check /tmp/x`)).toBe(true);
  });

  test("runsGateOutcome is true for a plain outcome run", async () => {
    const m = await receiptModule();
    expect(typeof m.runsGateOutcome).toBe("function");
    expect(m.runsGateOutcome(`bun run ${ABS} outcome gate-check /tmp/x pass`)).toBe(true);
    expect(m.runsGateOutcome(`bun ${ABS} outcome tdd /tmp/x fail --step lint=pass`)).toBe(true);
  });

  test("runsGateOutcome is false for echo, a cd chain, a same-named file outside the plugin and the receipt verb", async () => {
    const m = await receiptModule();
    const outside = join(tempDir("same-name"), "gate_receipt.ts");
    writeFileSync(outside, "// not the front door\n");
    for (const c of [
      `echo bun run ${ABS} outcome gate-check /tmp/x pass`,
      `cd /tmp && bun run ${ABS} outcome gate-check /tmp/x pass`,
      `bun run ${outside} outcome gate-check /tmp/x pass`,
      `bun run ${ABS} gate-check /tmp/x`,
    ]) {
      expect({ c, v: m.runsGateOutcome(c) }).toEqual({ c, v: false });
    }
  });
});

// ===========================================================================
// AC-STE-715.7 — the evidence reader
// ===========================================================================

describe("AC-STE-715.7 gateReceiptEvidence ignores a gate-outcome receipt", () => {
  test("a store holding only a gate-outcome receipt is not evidence; with the run receipt it is", async () => {
    const m = await receiptModule();
    const root = makeTree("evidence-reader", "on");
    const run = mintRun(root);
    const o = runCli(["outcome", "gate-check", root, "pass"]);
    expect(o.exitCode).toBe(0);
    const withBoth = m.gateReceiptEvidence(SKILL_OF.gate, root, SID);
    expect(withBoth.ok).toBe(true);
    rmSync(run.path);
    const names = receiptFiles(root);
    expect(names.length).toBe(1);
    expect(readJson(join(receiptDirOf(root), names[0]!)).kind).toBe("gate-outcome");
    const onlyOutcome = m.gateReceiptEvidence(SKILL_OF.gate, root, SID);
    expect(onlyOutcome.ok).toBe(false);
    expect(onlyOutcome.reason).not.toBe("receipt-found");
  }, T);
});

// ===========================================================================
// AC-STE-715.7 — the three blocking hooks, through their wrappers
// ===========================================================================

describe("AC-STE-715.7 the blocking hooks refuse an outcome-only session", () => {
  /** A switch-on tree with a run receipt, its outcome, and both announcement lines. */
  function minted(hook: Hook) {
    const root = makeTree(`hooks-${hook}`, "on");
    stageCodeAndTest(root);
    const skill = SHORT_OF[hook];
    const run = mintRun(root, skill);
    const o = runCli(["outcome", skill, root, "pass", "--step", "lint=pass"]);
    expect(o.exitCode).toBe(0);
    const ann = parseAnnouncement(o.stdout.split("\n")[0]!, "dpt-gate-outcome: ");
    expect(ann).not.toBeNull();
    return { root, skill, run, outcomeStdout: o.stdout, outcomePath: ann!.path, outcomeDigest: ann!.digest };
  }

  for (const hook of HOOKS) {
    test(`${hook}: Skill call plus only an announced outcome receipt is refused`, async () => {
      const f = minted(hook);
      rmSync(f.run.path);
      const tr = writeTranscript(tempDir("tr"), [
        ...skillCall(hook),
        ...bashCall("b1", outcomeCommand(f.skill, f.root, "pass", ["lint=pass"]), f.outcomeStdout),
      ]);
      const r = await runHook(hook, f.root, tr);
      expect(r.exitCode).toBe(2);
    }, T);

    test(`${hook}: Skill call plus only an outcome receipt FORGED as a dpt-receipt announcement is refused`, async () => {
      const f = minted(hook);
      rmSync(f.run.path);
      const forged = `dpt-receipt: ${f.outcomePath} sha256:${f.outcomeDigest}\n`;
      const tr = writeTranscript(tempDir("tr"), [...skillCall(hook), ...bashCall("b1", receiptCommand(f.skill, f.root), forged)]);
      const r = await runHook(hook, f.root, tr);
      expect(r.exitCode).toBe(2);
    }, T);

    test(`${hook}: PERMIT — the same session with the run receipt also announced permits exactly as before`, async () => {
      const f = minted(hook);
      const tr = writeTranscript(tempDir("tr"), [
        ...skillCall(hook),
        ...bashCall("b0", receiptCommand(f.skill, f.root), f.run.run.stdout),
        ...bashCall("b1", outcomeCommand(f.skill, f.root, "pass", ["lint=pass"]), f.outcomeStdout),
      ]);
      const r = await runHook(hook, f.root, tr);
      expect({ code: r.exitCode, err: r.stderr }).toEqual({ code: 0, err: "" });
      // Exactly as before: the run receipt alone gives the same verdict.
      const alone = writeTranscript(tempDir("tr"), [...skillCall(hook), ...bashCall("b0", receiptCommand(f.skill, f.root), f.run.run.stdout)]);
      const r2 = await runHook(hook, f.root, alone);
      expect({ code: r2.exitCode, err: r2.stderr }).toEqual({ code: r.exitCode, err: r.stderr });
    }, T);
  }
});

// ===========================================================================
// AC-STE-715.8 — the hook library never reads outcomes
// ===========================================================================

function hookLibViolations(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else {
        const body = readFileSync(p, "utf-8");
        if (body.includes("gate_reuse_key")) out.push(`${p}: gate_reuse_key`);
        if (body.includes("gate-outcome")) out.push(`${p}: gate-outcome`);
      }
    }
  };
  walk(dir);
  return out;
}

describe("AC-STE-715.8 templates/hooks/_lib/ neither imports gate_reuse_key nor names gate-outcome", () => {
  const LIB = join(PLUGIN_ROOT, "templates", "hooks", "_lib");

  test("the scan of every file under templates/hooks/_lib/ is clean", () => {
    expect(hookLibViolations(LIB)).toEqual([]);
  });

  test("CONTROL: a planted import or string in a temp copy is found", () => {
    const d = join(tempDir("hooklib"), "_lib");
    mkdirSync(join(d, "hooks"), { recursive: true });
    writeFileSync(join(d, "hooks", "a.ts"), 'import { gateReuseKey } from "../../../../adapters/_shared/src/gate_reuse_key";\n');
    writeFileSync(join(d, "b.ts"), 'const k = "gate-outcome";\n');
    expect(hookLibViolations(d).length).toBe(2);
  });
});

// ===========================================================================
// AC-STE-715.10 — the hooks reference says so
// ===========================================================================

describe("AC-STE-715.10 docs/hooks-reference.md: a gate-outcome record is never evidence", () => {
  test("the bold \"What counts as evidence\" paragraph of § How the harness loads these hooks says so", () => {
    const doc = readFileSync(join(PLUGIN_ROOT, "docs", "hooks-reference.md"), "utf-8");
    const start = doc.indexOf("## How the harness loads these hooks");
    expect(start).toBeGreaterThanOrEqual(0);
    const end = doc.indexOf("\n## ", start + 1);
    const section = doc.slice(start, end < 0 ? undefined : end);
    const para = section.split(/\n\s*\n/).find((p) => p.startsWith("**What counts as evidence"));
    expect(para).toBeDefined();
    expect(para!).toContain("`gate-outcome`");
    expect(para!).toMatch(/never evidence/);
  });
});
