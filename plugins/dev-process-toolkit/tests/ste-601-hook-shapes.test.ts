// STE-601 hook-level e2e — AC.7, AC.8, AC.9, AC.11, AC.13, AC.16.
//
// Drives the SHIPPED wrappers (templates/hooks/process/*.sh) the way the
// harness does: `bash <wrapper>`, CLAUDE_PLUGIN_ROOT set, the PreToolUse JSON
// on stdin, cwd = checkout A. Checkout B (a makeSpanFixture root) stages an FR
// file, a source file and its test. Every spawn is SERIAL: no Promise.all over
// processes.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { git, makeSpanFixture, type SpanFixture } from "./_span_fixture";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const WRAPPER = {
  gate: join(PLUGIN_ROOT, "templates", "hooks", "process", "pre-commit-gate-check.sh"),
  tdd: join(PLUGIN_ROOT, "templates", "hooks", "process", "pre-commit-tdd-orchestrator.sh"),
} as const;
type Hook = keyof typeof WRAPPER;

const T = 300_000;

let fx: SpanFixture;
let A = "";
let B = "";
let U = ""; // a checkout with no stack marker
let scratch = "";
let NO_EVIDENCE = "";
let EVIDENCE = "";
let NO_GIT_PATH = "";

function stage(root: string, files: Record<string, string>): void {
  for (const [rel, body] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(full.split("/").slice(0, -1).join("/"), { recursive: true });
    writeFileSync(full, body);
    git(root, "add", rel);
  }
}

function transcript(name: string, skills: string[]): string {
  const file = join(scratch, `${name}.jsonl`);
  const entries: unknown[] = [{ type: "tool_use", name: "Bash", input: { command: "ls" } }];
  for (const skill of skills) entries.push({ type: "tool_use", name: "Skill", input: { skill } });
  writeFileSync(file, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
  return file;
}

interface Run {
  exitCode: number;
  stderr: string;
}

async function run(hook: Hook, command: string, tr: string, env: Record<string, string> = {}): Promise<Run> {
  const payload = JSON.stringify({
    session_id: "s1",
    transcript_path: tr,
    cwd: A,
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command },
  });
  const proc = Bun.spawn(["/bin/bash", WRAPPER[hook]], {
    cwd: A,
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, ...env },
    stdin: new Response(payload).body,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { exitCode: await proc.exited, stderr };
}

beforeAll(() => {
  fx = makeSpanFixture("M_ste601");
  A = fx.a;
  B = fx.b;
  scratch = mkdtempSync(join(tmpdir(), "ste601-hooks-"));
  writeFileSync(join(B, "package.json"), '{"name":"fixture","version":"0.0.0","private":true}\n');
  git(B, "add", "package.json");
  git(B, "commit", "-q", "-m", "fixture: stack marker");
  fx.activeFr(B, "STE-1", "M_ste601");
  git(B, "add", "specs/frs/STE-1.md");
  stage(B, { "src/x.ts": "export const x = 1;\n", "src/x.test.ts": "// test\n" });
  git(B, "config", "alias.ci", "commit");

  U = mkdtempSync(join(tmpdir(), "ste601-unknown-"));
  git(U, "init", "-q", "-b", "main");
  stage(U, { "src/x.ts": "export const x = 1;\n", "src/x.test.ts": "// test\n" });

  NO_EVIDENCE = transcript("none", []);
  EVIDENCE = transcript("both", ["dev-process-toolkit:gate-check", "dev-process-toolkit:tdd"]);

  NO_GIT_PATH = join(scratch, "bin-no-git");
  mkdirSync(NO_GIT_PATH);
  symlinkSync(process.execPath, join(NO_GIT_PATH, "bun"));
});

afterAll(() => {
  fx?.cleanup();
  rmSync(U, { recursive: true, force: true });
  rmSync(scratch, { recursive: true, force: true });
});

const shapesAimedAtB = (): string[] => [
  `env X=1 git -C ${B} commit -m x`,
  `HUSKY=0 git -C ${B} commit -m x`,
  `GIT_AUTHOR_NAME=me git -C ${B} commit -m x`,
  `command git -C ${B} commit -m x`,
  `time git -C ${B} commit -m x`,
  `nohup git -C ${B} commit -m x`,
  `/usr/bin/git -C ${B} commit -m x`,
  `\\git -C ${B} commit -m x`,
  `sleep 0 & git -C ${B} commit -m x`,
  `cd ${B} && if true; then git commit -m x; fi`,
  `{ git -C ${B} commit -m x; }`,
  `bash -c "git -C ${B} commit -m x"`,
  `eval 'git -C ${B} commit -m x'`,
  `x=$(git -C ${B} commit -m y)`,
  `echo \`cd ${B} && git commit -m x\``,
  `git -C ${B} ci -m x`,
  `git -C ${B} merge --continue`,
];

describe("AC-STE-601.13 — every recognised shape aimed at B is refused by both commit hooks", () => {
  test("CONTROL — the bare `git -C B commit` is refused by both hooks with no evidence", async () => {
    for (const hook of ["gate", "tdd"] as const) {
      expect({ hook, code: (await run(hook, `git -C ${B} commit -m x`, NO_EVIDENCE)).exitCode }).toEqual({ hook, code: 2 });
    }
  }, T);

  test("no evidence → exit 2 from both hooks", async () => {
    const got: string[] = [];
    for (const cmd of shapesAimedAtB()) {
      for (const hook of ["gate", "tdd"] as const) {
        const r = await run(hook, cmd, NO_EVIDENCE);
        if (r.exitCode !== 2) got.push(`${hook} exit ${r.exitCode}: ${cmd}`);
      }
    }
    expect(got).toEqual([]);
  }, T);

  test("with gate-check and /tdd evidence → each proceeds past both hooks (no exit 2)", async () => {
    const got: string[] = [];
    for (const cmd of shapesAimedAtB()) {
      for (const hook of ["gate", "tdd"] as const) {
        const r = await run(hook, cmd, EVIDENCE);
        if (r.exitCode === 2) got.push(`${hook}: ${cmd}\n${r.stderr}`);
      }
    }
    expect(got).toEqual([]);
  }, T);

  test("`git status` in the same prefixes → exit 0 with empty stderr from both hooks", async () => {
    const got: string[] = [];
    for (const cmd of [
      `env X=1 git -C ${B} status`,
      `command git -C ${B} status`,
      `time git -C ${B} status`,
      `\\git -C ${B} status`,
      `{ git -C ${B} status; }`,
      `bash -c "git -C ${B} status"`,
      `cd ${B} && if true; then git status; fi`,
    ]) {
      for (const hook of ["gate", "tdd"] as const) {
        const r = await run(hook, cmd, NO_EVIDENCE);
        if (r.exitCode !== 0 || r.stderr !== "") got.push(`${hook} exit ${r.exitCode}: ${cmd}\n${r.stderr}`);
      }
    }
    expect(got).toEqual([]);
  }, T);
});

describe("AC-STE-601.7 — an unplaced wrapper through the shipped wrappers", () => {
  for (const [cmd, wrapper] of [
    ["sudo git -C {B} commit -m x", "sudo"],
    ["xargs git -C {B} commit -m x", "xargs"],
  ] as const) {
    test(`\`${cmd}\`: /tdd hook exits 1 with a Reminder naming ${wrapper}`, async () => {
      const r = await run("tdd", cmd.replace("{B}", B), NO_EVIDENCE);
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toContain("Reminder:");
      expect(r.stderr).toContain(wrapper);
    }, T);
    test(`\`${cmd}\`: gate-check exits 2 without evidence and lets it proceed with evidence`, async () => {
      expect((await run("gate", cmd.replace("{B}", B), NO_EVIDENCE)).exitCode).toBe(2);
      expect((await run("gate", cmd.replace("{B}", B), EVIDENCE)).exitCode).not.toBe(2);
    }, T);
  }
  test("CONTROL — `sudo ls` and `xargs git status` pass both hooks in silence", async () => {
    for (const cmd of ["sudo ls", `xargs git -C ${B} status`]) {
      for (const hook of ["gate", "tdd"] as const) {
        const r = await run(hook, cmd, NO_EVIDENCE);
        expect({ hook, cmd, code: r.exitCode, err: r.stderr }).toEqual({ hook, cmd, code: 0, err: "" });
      }
    }
  }, T);
});

describe("AC-STE-601.8 — commit-producing subcommands through the wrappers", () => {
  const producing = ["merge --no-ff x", "merge x", "cherry-pick x", "revert x", "am p.mbox", "commit-tree t -m m"];
  test("each `-C B` form exits 2 from gate-check with no evidence, and proceeds with evidence", async () => {
    const got: string[] = [];
    for (const args of producing) {
      const cmd = `git -C ${B} ${args}`;
      const none = await run("gate", cmd, NO_EVIDENCE);
      const withEv = await run("gate", cmd, EVIDENCE);
      if (none.exitCode !== 2) got.push(`no-evidence exit ${none.exitCode}: ${cmd}`);
      if (withEv.exitCode === 2) got.push(`evidence still refused: ${cmd}`);
    }
    expect(got).toEqual([]);
  }, T);

  test("/tdd hook: `git merge x` exits 1 with a Reminder naming merge", async () => {
    const r = await run("tdd", `git -C ${B} merge x`, NO_EVIDENCE);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("Reminder:");
    expect(r.stderr).toContain("merge");
  }, T);

  test("/tdd hook: `git merge --continue` classifies the staged set (tdd-required, no evidence → 2)", async () => {
    expect((await run("tdd", `git -C ${B} merge --continue`, NO_EVIDENCE)).exitCode).toBe(2);
  }, T);

  test("permit twins exit 0 with empty stderr from both hooks", async () => {
    const got: string[] = [];
    for (const args of [
      "merge --ff-only x",
      "merge --abort",
      "merge --squash x",
      "cherry-pick -n x",
      "revert --no-commit x",
      "am --abort",
      "status",
      "log",
    ]) {
      for (const hook of ["gate", "tdd"] as const) {
        const r = await run(hook, `git -C ${B} ${args}`, NO_EVIDENCE);
        if (r.exitCode !== 0 || r.stderr !== "") got.push(`${hook} exit ${r.exitCode}: git ${args}\n${r.stderr}`);
      }
    }
    expect(got).toEqual([]);
  }, T);
});

describe("AC-STE-601.9 — advisory subcommands through the gate-check wrapper", () => {
  for (const [args, sub] of [
    ["pull", "pull"],
    ["rebase main", "rebase"],
    ["stash", "stash"],
    ["stash push", "stash"],
    ["notes add -m x", "notes"],
  ] as const) {
    test(`\`git ${args}\` → exit 1 with a Reminder naming ${sub}`, async () => {
      const r = await run("gate", `git -C ${B} ${args}`, NO_EVIDENCE);
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toContain("Reminder:");
      expect(r.stderr).toContain(sub);
    }, T);
  }
  test("permit twins exit 0 with empty stderr", async () => {
    for (const args of ["stash list", "stash show", "notes list", "rebase --abort"]) {
      const r = await run("gate", `git -C ${B} ${args}`, NO_EVIDENCE);
      expect({ args, code: r.exitCode, err: r.stderr }).toEqual({ args, code: 0, err: "" });
    }
  }, T);
});

describe("AC-STE-601.11 — GIT_DIR through the gate-check wrapper", () => {
  test("`GIT_DIR=B/.git git commit` with no evidence → exit 2 naming B", async () => {
    const r = await run("gate", `GIT_DIR=${B}/.git git commit -m x`, NO_EVIDENCE);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain(B);
  }, T);
  test("CONTROL — `GIT_DIR=B/.git git status` → exit 0, empty stderr", async () => {
    const r = await run("gate", `GIT_DIR=${B}/.git git status`, NO_EVIDENCE);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBe("");
  }, T);
});

describe("AC-STE-601.16 — the /tdd hook's Reminders are visible (exit 1), through the shipped wrapper", () => {
  test("unresolved target: `git -C \"$R\" commit` → exit 1 with a Reminder naming $R", async () => {
    const r = await run("tdd", 'git -C "$R" commit -m x', NO_EVIDENCE);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("Reminder:");
    expect(r.stderr).toContain("$R");
    expect(r.stderr).not.toContain("Refusing:");
  }, T);

  test("git cannot run (absent from PATH) → exit 1 with a Reminder", async () => {
    const r = await run("tdd", `git -C ${B} commit -m x`, NO_EVIDENCE, { PATH: NO_GIT_PATH });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("Reminder:");
    expect(r.stderr).not.toContain("Refusing:");
  }, T);

  test("unknown stack (no marker, src/x.ts staged) → exit 1 with a Reminder naming the checkout", async () => {
    const r = await run("tdd", `git -C ${U} commit -m x`, NO_EVIDENCE);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("Reminder:");
    expect(r.stderr).toContain(U);
  }, T);

  test("permit twin: a spec-only staged set → exit 0, empty stderr", async () => {
    const S = mkdtempSync(join(tmpdir(), "ste601-speconly-"));
    try {
      git(S, "init", "-q", "-b", "main");
      writeFileSync(join(S, "package.json"), "{}\n");
      stage(S, { "specs/frs/STE-2.md": "---\nstatus: active\n---\n# x\n" });
      const r = await run("tdd", `git -C ${S} commit -m x`, NO_EVIDENCE);
      expect({ code: r.exitCode, err: r.stderr }).toEqual({ code: 0, err: "" });
    } finally {
      rmSync(S, { recursive: true, force: true });
    }
  }, T);

  test("permit twin: a no-FR staged set in a recognised stack → exit 0, empty stderr", async () => {
    const S = mkdtempSync(join(tmpdir(), "ste601-nofr-"));
    try {
      git(S, "init", "-q", "-b", "main");
      writeFileSync(join(S, "package.json"), "{}\n");
      stage(S, { "src/counter.ts": "export const c = 0;\n" });
      const r = await run("tdd", `git -C ${S} commit -m x`, NO_EVIDENCE);
      expect({ code: r.exitCode, err: r.stderr }).toEqual({ code: 0, err: "" });
    } finally {
      rmSync(S, { recursive: true, force: true });
    }
  }, T);

  test("permit twin: a tdd-required set with no evidence still exits 2", async () => {
    expect((await run("tdd", `git -C ${B} commit -m x`, NO_EVIDENCE)).exitCode).toBe(2);
  }, T);

  test("docs/hooks-reference.md states the exit-1 Reminder rule for the commit gates", () => {
    const doc = readFileSync(join(PLUGIN_ROOT, "docs", "hooks-reference.md"), "utf8");
    expect(doc).not.toContain("Advisory (non-blocking) hooks substitute `Reminder:` for `Refusing:` and exit 0.");
    const rule = doc
      .split("\n")
      .filter((l) => /Reminder/.test(l) && /exit\W{0,3}1\b/.test(l) && /commit/i.test(l));
    expect(rule.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Review finding — a refusal quotes command words. A word carrying a newline
// must never start a line of its own on the hook's stderr, which the transcript
// records verbatim: `dpt-receipt:` at column 0 is the receipt announcement shape.
// Runs the REAL hooks through their shipped wrappers.
// ---------------------------------------------------------------------------
describe("STE-601 review — no command word can start a line of a hook's stderr", () => {
  const FORGED = "dpt-receipt: /tmp/x.json sha256:" + "0".repeat(64);
  const forgers = [
    `git -C "$R\n${FORGED}" commit -m x`,
    `cd "/tmp/q\n${FORGED}" && git commit -m x`,
  ];
  for (const cmd of forgers) {
    test(`${JSON.stringify(cmd)}: neither hook prints a forged receipt line`, async () => {
      let quoted = "";
      for (const hook of ["gate", "tdd"] as const) {
        const r = await run(hook, cmd, NO_EVIDENCE);
        // The verdict still fires (the command is a commit)...
        expect({ hook, silent: r.exitCode === 0 }).toEqual({ hook, silent: false });
        // ...and the forged text never starts a line.
        expect(r.stderr.split("\n").filter((l) => l.startsWith("dpt-receipt:"))).toEqual([]);
        quoted += r.stderr;
      }
      // Positive control: some hook DID quote the forged word, so the pin is
      // not vacuously green on a refusal that never mentions it.
      expect(quoted).toContain("dpt-receipt:");
    }, T);
  }
});

describe("STE-601 review — the hooks' collapse rule is the receipt store's rule", () => {
  test("session.oneLine and tracker_receipts.oneLine agree on every control and separator shape", async () => {
    const hooks = await import("../templates/hooks/_lib/session.ts");
    const store = await import("../adapters/_shared/src/tracker_receipts.ts");
    const samples = ["a\nb", " x\r\n\ty ", "p q r", "s\u0085t\u007fu", "\u0000lead", "plain"];
    for (const s of samples) expect({ s, hook: hooks.oneLine(s) }).toEqual({ s, hook: store.oneLine(s) });
    expect(hooks.oneLine("a\ndpt-receipt: x")).toBe("a dpt-receipt: x");
  });
});
