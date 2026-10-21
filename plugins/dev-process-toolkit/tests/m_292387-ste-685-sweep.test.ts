// STE-685 — AC-STE-685.3: no nested `bun test` spawn bypasses the shared runner.
//
// The sweep reads every .ts/.js/.mjs/.cjs file under `tests/` and `adapters/`
// (comments blanked) and reports each `spawn(` / `spawnSync(` / `Bun.spawn(` /
// `Bun.spawnSync(` call whose argv STARTS with `bun test` or
// `process.execPath, "test"` — in any of the shipped spellings:
//
//   Bun.spawnSync(["bun", "test", …])            single- or multi-line
//   Bun.spawnSync([process.execPath, "test", …])
//   spawnSync("bun", ["test", …])                node:child_process form
//   spawn(["bun", "test", …])                     a local helper named spawn
//   Bun.spawnSync(cond ? ["bun", "test", a] : …)  a ternary first argument
//
// Text INSIDE a string literal (a pinned copy of a block, e.g. the BLOCK array in
// m_862e04-ste-600) is skipped: a `spawnSync(` whose `(` is directly followed by
// a closing quote is fixture text, not a call.
//
// The only file allowed to spawn `bun test` itself is `tests/_nested_bun_test.ts`.
//
// SCOPE DECISION (product gate runners). `adapters/_shared/src/gate_identity_run.ts`
// and its siblings spawn the TOP-LEVEL gate from a caller-supplied argv
// (`[...command]`), not a literal `bun test` argv, so they are not "nested
// `bun test` spawns" in the AC's sense and this sweep does not match them. A data
// literal such as `command: ["bun", "test"]` (stack_layout.ts) is not a spawn
// call either.
//
// Planted-control text in this file is assembled from pieces so this file's own
// source never contains a call the sweep would report.

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

import { stripComments } from "./_m292387_source";

const PLUGIN_ROOT = resolve(import.meta.dir, "..");
const RUNNER_REL = "tests/_nested_bun_test.ts";

const SPAWN_CALL = /\b(?:Bun\.)?spawn(?:Sync)?\s*\(/g;
const BUN_OR_EXEC = String.raw`(?:"bun"|'bun'|\x60bun\x60|process\.execPath)`;
const TEST_WORD = String.raw`(?:"test"|'test'|\x60test\x60)`;
// argv array starting `bun|execPath, test` anywhere in the call's leading window
const ARRAY_FORM = new RegExp(String.raw`\[\s*${BUN_OR_EXEC}\s*,\s*${TEST_WORD}`);
// node form: spawnSync("bun", ["test", …])
const NODE_FORM = new RegExp(String.raw`^\(\s*${BUN_OR_EXEC}\s*,\s*\[\s*${TEST_WORD}`);

// a "call" whose `(` is immediately followed by a closing quote lives inside a string literal
const STRING_TEXT = /^\(\s*["'\x60]\s*[,+)\]]/;

/** The call's leading window: from `(` up to the options object, a `;`, or 400 chars. */
function leadingWindow(src: string, openParen: number): string {
  const rest = src.slice(openParen, openParen + 400);
  const stops = [rest.indexOf("{"), rest.indexOf(";")].filter((i) => i > 0);
  return stops.length === 0 ? rest : rest.slice(0, Math.min(...stops));
}

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git") continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(?:ts|js|mjs|cjs|tsx)$/.test(name)) out.push(p);
  }
}

interface SweepResult {
  scanned: number;
  hits: string[];
}

function sweepDirectNestedSpawns(root: string, subdirs: readonly string[]): SweepResult {
  const files: string[] = [];
  for (const sub of subdirs) {
    try {
      walk(join(root, sub), files);
    } catch {
      // a missing subdir scans nothing
    }
  }
  const hits: string[] = [];
  for (const file of files) {
    const rel = relative(root, file).split("\\").join("/");
    if (rel === RUNNER_REL) continue;
    const src = stripComments(readFileSync(file, "utf8"));
    for (const m of src.matchAll(SPAWN_CALL)) {
      const open = (m.index ?? 0) + m[0].length - 1;
      const win = leadingWindow(src, open);
      // `Bun.spawnSync(",` — the call text ends a string literal: fixture TEXT, not a call.
      if (STRING_TEXT.test(win)) continue;
      if (ARRAY_FORM.test(win) || NODE_FORM.test(win)) {
        const line = src.slice(0, m.index).split("\n").length;
        hits.push(`${rel}:${line}`);
      }
    }
  }
  return { scanned: files.length, hits };
}

// ── planted text, assembled so this file never spells a reportable call ──
const BUN_SPAWN_SYNC = ["Bun", "spawnSync"].join(".");
const BUN_SPAWN = ["Bun", "spawn"].join(".");
const SPAWN_SYNC = ["spawn", "Sync"].join("");
const SPAWN = ["spa", "wn"].join("");
const Q = (s: string) => JSON.stringify(s);

const scratch: string[] = [];
afterAll(() => {
  for (const d of scratch) rmSync(d, { recursive: true, force: true });
});

function plantTree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "ste685-sweep-"));
  scratch.push(root);
  for (const [rel, body] of Object.entries(files)) {
    const p = join(root, rel);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, body);
  }
  return root;
}

describe("AC-STE-685.3 — sweep for direct nested `bun test` spawns", () => {
  test("POSITIVE CONTROL: every planted spelling is found at its line", () => {
    const root = plantTree({
      "tests/multi-line.test.ts": [
        "const a = 1;",
        `const p = ${BUN_SPAWN_SYNC}(`,
        "  [",
        `    ${Q("bun")},`,
        `    ${Q("test")},`,
        "    file,",
        "  ],",
        "  { cwd: root },",
        ");",
      ].join("\n"),
      "tests/exec-path.test.ts": `const p = ${BUN_SPAWN_SYNC}([process.execPath, ${Q("test")}, f, "-t", n], { cwd });\n`,
      "tests/node-form.test.ts": `import { ${SPAWN_SYNC} } from "node:child_process";\nconst p = ${SPAWN_SYNC}(${Q("bun")}, [${Q("test")}, suite], { cwd });\n`,
      "tests/helper.test.ts": `async function x() {\n  const r = await ${SPAWN}([${Q("bun")}, ${Q("test")}, testFile], { A: "1" });\n}\n`,
      "tests/ternary.test.ts": `const p = ${BUN_SPAWN_SYNC}(\n  f === null ? [${Q("bun")}, ${Q("test")}, rel] : [${Q("bun")}, ${Q("test")}, rel, "-t", f],\n  { cwd },\n);\n`,
      "adapters/_shared/src/async.ts": `const p = ${BUN_SPAWN}([${Q("bun")}, ${Q("test")}], { cwd });\n`,
    });
    const { hits } = sweepDirectNestedSpawns(root, ["tests", "adapters"]);
    expect(hits.sort()).toEqual(
      [
        "adapters/_shared/src/async.ts:1",
        "tests/exec-path.test.ts:1",
        "tests/helper.test.ts:2",
        "tests/multi-line.test.ts:2",
        "tests/node-form.test.ts:2",
        "tests/ternary.test.ts:1",
      ].sort(),
    );
  });

  test("NEGATIVE CONTROL: runner calls, other bun commands, comments, data literals and the runner itself are not reported", () => {
    const root = plantTree({
      "tests/clean.test.ts": [
        'import { runNestedBunTest } from "./_nested_bun_test";',
        "const r = runNestedBunTest([file], { cwd });",
        `const s = ${SPAWN_SYNC}(${Q("bun")}, ["run", FRONT_DOOR], { cwd });`,
        `const t = ${BUN_SPAWN_SYNC}([${Q("bun")}, "run", script], { cwd });`,
        `// ${BUN_SPAWN_SYNC}([${Q("bun")}, ${Q("test")}, file]);`,
        `/* ${SPAWN_SYNC}(${Q("bun")}, [${Q("test")}]) */`,
        `const gate = { stack: "bun", command: [${Q("bun")}, ${Q("test")}] };`,
        "const BLOCK = [",
        `  "      const proc = ${BUN_SPAWN_SYNC}(",`,
        `  '        [${Q("bun")}, ${Q("test")}, "tests/x.test.ts"],',`,
        "];",
      ].join("\n"),
      // the runner is the one file allowed to spawn bun test directly
      [RUNNER_REL]: `export function runNestedBunTest() { return ${BUN_SPAWN_SYNC}([process.execPath, ${Q("test")}], { timeout: 1 }); }\n`,
    });
    const { scanned, hits } = sweepDirectNestedSpawns(root, ["tests", "adapters"]);
    expect(scanned).toBe(2);
    expect(hits).toEqual([]);
  });

  test("the real tree: zero direct nested `bun test` spawns under tests/ and adapters/ outside the runner", () => {
    const { scanned, hits } = sweepDirectNestedSpawns(PLUGIN_ROOT, ["tests", "adapters"]);
    // zero-hit guard: the sweep really read the tree
    expect(scanned).toBeGreaterThan(200);
    expect(hits).toEqual([]);
  });
});
