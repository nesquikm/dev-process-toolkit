// STE-721 (M_d1b4b7) AC.2 and AC.3 — `adapters/_shared/src/report_issue_retro.ts`.
//
// AC.2: `retroPromptDefaults(report)` returns the four suggested answers, one
// per canonical prompt, in canonical order:
//   1. `<N> retro rule(s) tripped: <id> (<value> <unit>, threshold <threshold>)`,
//      one clause per tripped rule, in the report's rule order;
//   2. `Every retro rule within its threshold.`;
//   3. the report's `suggested_severity`;
//   4. `Run /dev-process-toolkit:retro <scope id>.`
//
// AC.3: the `--from-retro` input check `checkRetroInput(file, projectRoot)`
// refuses, each in NFR-10 shape, a path outside `<projectRoot>/.dpt/ledger/retro/`
// after symlinks, a file `parseRetroReport` rejects, and a report with
// `tripped_count` 0 — and writes nothing. One test drives all three.

import { afterAll, describe, expect, test } from "bun:test";
import { realpathSync } from "node:fs";

import { resolveRetroScope } from "../adapters/_shared/src/retro_scope";

import { cleanupTemps } from "./_m_d1b4b7_ste720_fixture";
import {
  EXPECTED_DEFAULT,
  ONE_TRIPPED,
  ONE_TRIPPED_CLAUSES,
  TWO_TRIPPED,
  TWO_TRIPPED_CLAUSES,
  buildReport,
  isNfr10,
  predPathRule,
  projectRoot,
  refusalInputs,
  retroMod,
  treeSnapshot,
} from "./_m_d1b4b7_ste721_fixture";

afterAll(cleanupTemps);

/** `<N> retro rule(s) tripped: ` then the clauses, joined by `; ` or `, `. */
function whatHappenedMatches(actual: unknown, n: number, clauses: string[]): boolean {
  if (typeof actual !== "string") return false;
  const head = `${n} retro rule(s) tripped: `;
  if (!actual.startsWith(head)) return false;
  const rest = actual.slice(head.length);
  return ["; ", ", "].some((sep) => rest === clauses.join(sep));
}

describe("AC-STE-721.2 retroPromptDefaults", () => {
  test("two tripped rules: four strings in canonical order, one clause per tripped rule, severity medium", async () => {
    const { retroPromptDefaults } = await retroMod();
    const report = await buildReport(TWO_TRIPPED);
    expect(report.tripped_count).toBe(2);
    expect(report.suggested_severity).toBe("medium");
    const d = retroPromptDefaults(report);
    expect(Array.isArray(d)).toBe(true);
    expect(d.length).toBe(4);
    expect({ whatHappened: d[0], ok: whatHappenedMatches(d[0], 2, TWO_TRIPPED_CLAUSES) }).toEqual({ whatHappened: d[0], ok: true });
    expect(d[1]).toBe(EXPECTED_DEFAULT);
    expect(d[2]).toBe("medium");
    expect(d[3]).toBe("Run /dev-process-toolkit:retro M_abc123.");
  });

  test("the clear and skipped rules are not named in the what-happened answer", async () => {
    const { retroPromptDefaults } = await retroMod();
    const d = retroPromptDefaults(await buildReport(TWO_TRIPPED));
    expect(d[0]).not.toContain("gate_rerun_unchanged_key");
    expect(d[0]).not.toContain("cost_per_changed_line");
  });

  test("one tripped rule: severity low, one clause", async () => {
    const { retroPromptDefaults } = await retroMod();
    const report = await buildReport(ONE_TRIPPED);
    expect(report.suggested_severity).toBe("low");
    const d = retroPromptDefaults(report);
    expect(d).toEqual([
      `1 retro rule(s) tripped: ${ONE_TRIPPED_CLAUSES[0]}`,
      EXPECTED_DEFAULT,
      "low",
      "Run /dev-process-toolkit:retro M_abc123.",
    ]);
  });

  test("the reproducible answer names the report's scope id", async () => {
    const { retroPromptDefaults } = await retroMod();
    const d = retroPromptDefaults(await buildReport(ONE_TRIPPED, undefined, { kind: "fr", id: "fixture-fr" }));
    expect(d[3]).toBe("Run /dev-process-toolkit:retro fixture-fr.");
  });
});

// STE-721 pre-merge fix (L1): the suggested reproduction is a command the
// /retro front door accepts, for every scope kind. A session-scope report has
// no scope id, and `/retro session` is refused as free text.
describe("AC-STE-721.2 the reproducible answer is a /retro command the front door accepts", () => {
  const SCOPES: { kind: string; id: string | null; want: string }[] = [
    { kind: "session", id: null, want: "Run /dev-process-toolkit:retro." },
    { kind: "fr", id: "STE-123", want: "Run /dev-process-toolkit:retro STE-123." },
    { kind: "milestone", id: "M_abc123", want: "Run /dev-process-toolkit:retro M_abc123." },
  ];
  test("control: the old session suggestion's argument, `session`, is refused as free text", () => {
    const { root } = projectRoot("l1-control");
    expect(() => resolveRetroScope(root, "session")).toThrow(/not free text/);
  });

  for (const { kind, id, want } of SCOPES) {
    test(`${kind} scope: suggests ${JSON.stringify(want)}, and resolveRetroScope takes its argument without refusing, as the same scope`, async () => {
      const { retroPromptDefaults } = await retroMod();
      const d = retroPromptDefaults(await buildReport(ONE_TRIPPED, undefined, { kind, id }));
      expect(d[3]).toBe(want);
      const m = /^Run \/dev-process-toolkit:retro(?: (\S+))?\.$/.exec(d[3]);
      expect(m, "the answer is one /retro command").not.toBeNull();
      const { root } = projectRoot(`l1-${kind}`);
      const resolved = resolveRetroScope(root, m![1]);
      expect({ kind: resolved.kind, id: resolved.id }).toEqual({ kind, id });
    });
  }
});

describe("AC-STE-721.3 the --from-retro input check", () => {
  test("refuses, in NFR-10 shape and without writing, a path outside the ledger (a symlink out and a .. path included), a file parseRetroReport rejects, and a tripped_count 0 report; admits a valid one", async () => {
    const { checkRetroInput } = await retroMod();
    expect(typeof checkRetroInput).toBe("function");
    const t = await refusalInputs("check");
    const before = treeSnapshot(t.root);

    // Control: the admitted input.
    const ok = checkRetroInput(t.valid, t.root);
    expect(ok.ok).toBe(true);
    expect(ok.report.tripped_count).toBe(1);
    expect(ok.path).toBe(realpathSync(t.valid));

    // 1. outside the ledger, after symlinks.
    for (const f of [t.outside, t.symlinkOut, t.dotdot]) {
      const r = checkRetroInput(f, t.root);
      expect({ f, ok: r.ok }).toEqual({ f, ok: false });
      expect({ f, nfr10: isNfr10(r.refusal) }).toEqual({ f, nfr10: true });
      expect(r.refusal).toContain(".dpt/ledger/retro/");
    }

    // 2. a file parseRetroReport rejects.
    const bad = checkRetroInput(t.invalid, t.root);
    expect(bad.ok).toBe(false);
    expect(isNfr10(bad.refusal)).toBe(true);
    expect(bad.refusal).toContain("parseRetroReport");

    // 3. nothing tripped.
    const zero = checkRetroInput(t.zero, t.root);
    expect(zero.ok).toBe(false);
    expect(isNfr10(zero.refusal)).toBe(true);
    expect(zero.refusal).toContain("tripped_count");

    // The three refusals are distinct, and the check wrote nothing.
    expect(new Set([checkRetroInput(t.outside, t.root).refusal, bad.refusal, zero.refusal]).size).toBe(3);
    expect(treeSnapshot(t.root)).toEqual(before);
  });

  test("named predicate predPathRule holds on the real check", async () => {
    const { checkRetroInput } = await retroMod();
    expect(await predPathRule(checkRetroInput, "pred-path")).toBe(true);
  });
});
