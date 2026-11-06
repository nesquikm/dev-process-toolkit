// STE-721 (M_d1b4b7) — shared fixture for the `--from-retro` suites.
//
// Leading underscore: a helper module, never collected as a suite.
//
// Every id is synthetic: user `fixture-user`, UUIDs
// `00000000-0000-4000-8000-00000000000N`, branches `feat/...-fixture`. Temp
// trees live under the OS temp dir (via the STE-720 fixture), never in the repo.
//
// The module under test, `adapters/_shared/src/report_issue_retro.ts`, is
// loaded through a dynamic import so its absence reds each test on its own.
// Its contract, as these suites read the FR:
//
//   retroPromptDefaults(report) -> [whatHappened, expected, severity, reproducible]
//   checkRetroInput(file, projectRoot)
//     -> { ok: true, report, path }            path = the resolved real path
//      | { ok: false, refusal }                refusal = NFR-10 text: a first
//                                              line, then `Remedy: ` and
//                                              `Context: ` lines
//
// The named predicates below are the assertions of AC tests, shared with the
// AC.10 mutation suite so a mutant that falsifies one here reds the AC test.

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { BRANCH, OTHER_BRANCH, leaks, runFrontDoor, seedWorkdir, tempDir, uuid, type RunResult } from "./_m_d1b4b7_ste720_fixture";

export type AnyMod = Record<string, any>;

export async function retroMod(): Promise<AnyMod> {
  return (await import("../adapters/_shared/src/report_issue_retro")) as AnyMod;
}
export async function reportMod(): Promise<AnyMod> {
  return (await import("../adapters/_shared/src/retro_report")) as AnyMod;
}
export async function aliasMod(): Promise<AnyMod> {
  return (await import("../adapters/_shared/src/session_aliases")) as AnyMod;
}

export const LEDGER_REL = join(".dpt", "ledger", "retro");
export const SCOPE = { kind: "milestone", id: "M_abc123" } as const;

export const EXPECTED_DEFAULT = "Every retro rule within its threshold.";

/** One rule result as the engine emits it. */
export function rule(id: string, disposition: "tripped" | "clear" | "skipped: input not observable", value: number | null, unit: string, threshold: number, extra: { source?: string[]; reason?: string | null } = {}) {
  return {
    id,
    source: extra.source ?? ["tool-calls"],
    threshold,
    unit,
    value,
    disposition,
    reason: extra.reason ?? (disposition === "tripped" || disposition === "clear" ? null : "input not observable"),
  };
}

/** Two tripped rules (severity medium), one clear, one skipped. */
export const TWO_TRIPPED = [
  rule("slow_gate_run", "tripped", 412, "s", 300),
  rule("gate_rerun_unchanged_key", "clear", 0, "reruns", 1),
  rule("zero_yield_round", "tripped", 3, "rounds", 2),
  rule("cost_per_changed_line", "skipped: input not observable", null, "tokens/line", 2000),
];
export const TWO_TRIPPED_CLAUSES = ["slow_gate_run (412 s, threshold 300)", "zero_yield_round (3 rounds, threshold 2)"];

/** One tripped rule (severity low). */
export const ONE_TRIPPED = [rule("slow_gate_run", "clear", 12, "s", 300), rule("cost_per_changed_line", "tripped", 5000, "tokens/line", 2000)];
export const ONE_TRIPPED_CLAUSES = ["cost_per_changed_line (5000 tokens/line, threshold 2000)"];

/** Nothing tripped. */
export const NONE_TRIPPED = [rule("slow_gate_run", "clear", 12, "s", 300)];

export async function buildReport(results: unknown[], sessionIds: string[] = [uuid(1)], scope: { kind: string; id: string | null } = SCOPE): Promise<any> {
  const { buildRetroReport } = await reportMod();
  return buildRetroReport({ scope, sessionIds, results, pluginVersion: "9.9.9", generatedAt: "2026-11-06T12:00:00.000Z" });
}

export const reportText = (report: unknown): string => `${JSON.stringify(report, null, 2)}\n`;

// ---------------------------------------------------------------- project trees

/** A temp project root with an empty `.dpt/ledger/retro/`. */
export function projectRoot(label: string): { root: string; ledger: string } {
  const root = tempDir(`721-${label}`);
  const ledger = join(root, LEDGER_REL);
  mkdirSync(ledger, { recursive: true });
  return { root, ledger };
}

/** Every file under `dir` (recursive), path -> bytes; symlinks recorded as such. */
export function treeSnapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string, rel: string): void => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      const r = rel ? `${rel}/${name}` : name;
      if (existsSync(p) && statSync(p).isDirectory()) walk(p, r);
      else out[r] = existsSync(p) ? readFileSync(p, "latin1") : "<dangling>";
    }
  };
  walk(dir, "");
  return out;
}

export function isNfr10(refusal: unknown): boolean {
  if (typeof refusal !== "string") return false;
  const lines = refusal.split("\n");
  return (
    lines.length >= 3 &&
    lines[0]!.trim().length > 0 &&
    !/^(Remedy|Context): /.test(lines[0]!) &&
    lines.some((l) => /^Remedy: \S/.test(l)) &&
    lines.some((l) => /^Context: \S/.test(l))
  );
}

export type CheckFn = (file: string, projectRoot: string) => { ok: boolean; refusal?: string; report?: any; path?: string };

/**
 * The three refusal inputs of AC-STE-721.3 in one project root: a valid
 * one-rule report OUTSIDE the ledger, a symlink inside the ledger pointing to
 * it, a `..` path that leaves the ledger, an invalid file inside the ledger,
 * and a valid zero-tripped report inside the ledger. Plus one valid input.
 */
export async function refusalInputs(label: string): Promise<{
  root: string;
  valid: string;
  outside: string;
  symlinkOut: string;
  dotdot: string;
  invalid: string;
  zero: string;
}> {
  const { root, ledger } = projectRoot(label);
  const one = reportText(await buildReport(ONE_TRIPPED));
  const valid = join(ledger, "M_abc123-20261106T120000Z.json");
  writeFileSync(valid, one);
  mkdirSync(join(root, "elsewhere"));
  const outside = join(root, "elsewhere", "M_abc123-20261106T120000Z.json");
  writeFileSync(outside, one);
  const symlinkOut = join(ledger, "linked-out.json");
  symlinkSync(outside, symlinkOut);
  writeFileSync(join(root, ".dpt", "ledger", "escaped.json"), one);
  const dotdot = join(ledger, "..", "escaped.json");
  const invalid = join(ledger, "invalid.json");
  writeFileSync(invalid, `${JSON.stringify({ schema: "dpt-retro/1", rules: [] })}\n`);
  const zero = join(ledger, "zero.json");
  writeFileSync(zero, reportText(await buildReport(NONE_TRIPPED)));
  return { root, valid, outside, symlinkOut, dotdot, invalid, zero };
}

/** AC-STE-721.3 path rule: the outside file, the symlink out and the `..` path are each refused in NFR-10 shape. */
export async function predPathRule(check: CheckFn, label: string): Promise<boolean> {
  const t = await refusalInputs(label);
  return [t.outside, t.symlinkOut, t.dotdot].every((f) => {
    const r = check(f, t.root);
    return r.ok === false && isNfr10(r.refusal) && String(r.refusal).includes(".dpt/ledger/retro/");
  });
}

// ---------------------------------------------------------------- payload trees

/**
 * The STE-720 seeded working directory plus a `retro.json` copied from a valid
 * report whose rule `source` and `reason` carry a home path and the fixture
 * branch (parseRetroReport admits those; it refuses only UUID-shaped tokens),
 * so the identifier pass has something to scrub in it.
 */
export async function seedRetroWorkdir(label: string): Promise<{ dir: string; retroBefore: string }> {
  const { dir } = seedWorkdir(`721-${label}`);
  const report = await buildReport(
    [
      rule("slow_gate_run", "tripped", 412, "s", 300, {
        source: [`/Users/fixture-user/repo/.dpt/ledger/tool-calls/a.timeline.json`, `/home/fixture-user/repo/.dpt/ledger/token-ledger.jsonl`],
        reason: null,
      }),
      rule("zero_yield_round", "tripped", 3, "rounds", 2, { reason: null }),
      rule("cost_per_changed_line", "skipped: input not observable", null, "tokens/line", 2000, {
        reason: `input not observable on ${BRANCH} (merged from ${OTHER_BRANCH})`,
      }),
    ],
    [uuid(1)],
  );
  const retroBefore = reportText(report);
  writeFileSync(join(dir, "retro.json"), retroBefore);
  return { dir, retroBefore };
}

export const PAYLOAD_FILES = ["report.md", "metadata.json", "transcript.jsonl", "retro.json"];

export type Runner = (dir: string, root: string, flags: string[]) => RunResult;
export const realRunner: Runner = (dir, root, flags) => runFrontDoor(dir, root, flags);

/** AC-STE-721.7 privacy: every payload file of a `--from-retro`-only run is leak-free. */
export function predFromRetroPrivacy(dir: string): boolean {
  return PAYLOAD_FILES.every((f) => existsSync(join(dir, f)) && leaks(readFileSync(join(dir, f), "utf-8")).length === 0);
}

/** AC-STE-721.7 privacy, retro.json alone: it was scrubbed too. */
export function predRetroScrubbed(dir: string): boolean {
  const p = join(dir, "retro.json");
  return existsSync(p) && leaks(readFileSync(p, "utf-8")).length === 0;
}

/**
 * The alias working directory of AC-STE-721.7: `retro.json` lists `s1` with
 * the digest of uuid(1) (A); `transcript.jsonl` holds uuid(2) (B) FIRST, then
 * A, so an unseeded map would number B `s1`. No other file holds a UUID.
 */
export async function seedAliasWorkdir(label: string): Promise<string> {
  const dir = tempDir(`721-${label}`);
  const report = await buildReport([rule("slow_gate_run", "tripped", 412, "s", 300)], [uuid(1)]);
  if (report.sessions?.[0]?.alias !== "s1") throw new Error("fixture: the retro report did not alias uuid(1) as s1");
  writeFileSync(join(dir, "retro.json"), reportText(report));
  writeFileSync(join(dir, "report.md"), "## Narrative\n\nA retro rule tripped.\n");
  writeFileSync(
    join(dir, "transcript.jsonl"),
    [JSON.stringify({ type: "user", sessionId: uuid(2), message: "b" }), JSON.stringify({ type: "user", sessionId: uuid(1), message: "a" }), ""].join("\n"),
  );
  return dir;
}

/** AC-STE-721.7 aliases: transcript reads `s2` for B (line 1) and `s1` for A (line 2). */
export function predSeededAliases(dir: string): boolean {
  const lines = readFileSync(join(dir, "transcript.jsonl"), "utf-8").split("\n").filter((l) => l.length > 0);
  if (lines.length !== 2) return false;
  const ids = lines.map((l) => JSON.parse(l).sessionId);
  return ids[0] === "s2" && ids[1] === "s1";
}

/**
 * A bun preload that turns `seedAliasMap` in `session_aliases.ts` into a no-op
 * (the alias seed step skipped), logging each call to `log`.
 */
export function noSeedPreload(label: string): { preload: string; log: string } {
  const dir = tempDir(`721-${label}`);
  const log = join(dir, "seed-calls.log");
  writeFileSync(log, "");
  const stub = `export function seedAliasMap(map: any, _s: any): any { require("node:fs").appendFileSync(${JSON.stringify(log)}, "seedAliasMap\\n"); return map; }\nfunction __origSeedAliasMap(`;
  const preload = join(dir, "no-seed-preload.ts");
  writeFileSync(
    preload,
    [
      'import { plugin } from "bun";',
      'import { readFileSync } from "node:fs";',
      "plugin({",
      '  name: "ste721-no-seed",',
      "  setup(build) {",
      "    build.onLoad({ filter: /session_aliases\\.ts$/ }, (args) => {",
      `      const src = readFileSync(args.path, "utf-8").replace("export function seedAliasMap(", ${JSON.stringify(stub)});`,
      '      return { contents: src, loader: "ts" };',
      "    });",
      "  },",
      "});",
      "",
    ].join("\n"),
  );
  return { preload, log };
}
