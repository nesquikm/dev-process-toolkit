// STE-716 (M_7bc805) AC.2-.9, .11, .12, .14 — the opt-in tool-call capture hook.
//
// Every run drives the shipped wrapper (`templates/hooks/process/tool-call-capture.sh
// <record>`) with a payload on stdin, the way the registered command does, over
// temp git checkouts. The record (Claude Code's installed-plugins file) is a temp
// file whose entry for the checkout names the plugin root under test, so the
// hook's record-entry check passes unless a row says otherwise.
//
// Payload shapes follow the scrubbed captures in tests/fixtures/hook-payloads/
// (STE-714): calls inside a fork carry `agent_id` (D1), no payload carries an exit
// code (D2), one matcher group per event (D4). All names, paths and ids are synthetic.

import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { DPT_GITIGNORE_BODY } from "../adapters/_shared/src/setup/dpt_gitignore";
import { worktreeDigest } from "../adapters/_shared/src/gate_reuse_key";
import {
  ENTRY_REL,
  PLUGIN_REAL,
  PLUGIN_REL,
  PLUGIN_ROOT,
  REAL_GIT,
  ROW_KEYS,
  SID,
  WRAPPER_REL,
  atV300,
  cleanupTemps,
  git,
  ledgerBytes,
  ledgerDir,
  ledgerEntries,
  ledgerRows,
  makeCheckout,
  payload,
  pluginCopy,
  recordFor,
  runCapture,
  shimDir,
  tempDir,
  withPath,
} from "./_m_7bc805_capture_fixture";

const T = 120_000;
afterAll(cleanupTemps);

const isRoot = typeof process.getuid === "function" && process.getuid() === 0;

/** Assert a run was silent and successful. */
function silent(r: { exitCode: number; stdout: string; stderr: string }, label: string): void {
  expect({ label, exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr }).toEqual({ label, exitCode: 0, stdout: "", stderr: "" });
}

const receiptRun = (root: string): string => `bun run "${PLUGIN_REAL}/adapters/_shared/src/gate_receipt.ts" gate-check "${root}"`;
const outcomeRun = (root: string): string => `bun run "${PLUGIN_REAL}/adapters/_shared/src/gate_receipt.ts" outcome gate-check "${root}" pass`;

// ===========================================================================
// AC-STE-716.2 — nothing bundled
// ===========================================================================

describe("AC-STE-716.2 hooks/hooks.json is unchanged", () => {
  test("hooks/hooks.json is byte-identical to the milestone base", () => {
    expect(readFileSync(join(PLUGIN_ROOT, "hooks", "hooks.json"), "utf-8")).toBe(atV300(`${PLUGIN_REL}/hooks/hooks.json`));
  });

  test("the two bundled-hook shape suites are byte-identical to the milestone base (pass with no edit)", () => {
    for (const rel of ["tests/bundled-hooks-shape.test.ts", "tests/hooks-reference-install-shapes.test.ts"]) {
      expect({ rel, same: readFileSync(join(PLUGIN_ROOT, rel), "utf-8") === atV300(`${PLUGIN_REL}/${rel}`) }).toEqual({ rel, same: true });
    }
  });

  test("no file under hooks/ names tool-call-capture", () => {
    const hits = readdirSync(join(PLUGIN_ROOT, "hooks")).filter((n) =>
      readFileSync(join(PLUGIN_ROOT, "hooks", n), "utf-8").includes("tool-call-capture"),
    );
    expect(hits).toEqual([]);
  });

  test("the wrapper and the entry module ship (CONTROL: the absence above is not an absence of the hook)", () => {
    expect(existsSync(join(PLUGIN_ROOT, WRAPPER_REL))).toBe(true);
    expect(existsSync(join(PLUGIN_ROOT, ENTRY_REL))).toBe(true);
    const wrapper = readFileSync(join(PLUGIN_ROOT, WRAPPER_REL), "utf-8");
    expect(wrapper).toContain('exec bun run "${CLAUDE_PLUGIN_ROOT}/templates/hooks/_lib/hooks/tool-call-capture.ts" "$@"');
  });
});

// ===========================================================================
// AC-STE-716.3 — off writes nothing
// ===========================================================================

describe("AC-STE-716.3 off writes nothing", () => {
  test("off writes nothing: flag absent, false, unreadable settings, foreign settings, cwd outside any checkout", () => {
    const rows: Array<{ label: string; root: string; cwd: string; prep?: () => void; after?: () => void }> = [];
    const absent = makeCheckout("off-absent", "absent");
    rows.push({ label: "flag absent", root: absent, cwd: absent });
    const off = makeCheckout("off-false", "false");
    rows.push({ label: "flag false", root: off, cwd: off });
    const unreadable = makeCheckout("off-unreadable", "on");
    rows.push({
      label: "unreadable settings file",
      root: unreadable,
      cwd: unreadable,
      prep: () => chmodSync(join(unreadable, "specs", "settings.yaml"), 0o000),
      after: () => chmodSync(join(unreadable, "specs", "settings.yaml"), 0o644),
    });
    const foreign = makeCheckout("off-foreign", "foreign");
    rows.push({ label: "foreign settings file holding tool_calls on", root: foreign, cwd: foreign });
    const outside = realpathSync(tempDir("off-outside"));
    rows.push({ label: "cwd outside any checkout", root: outside, cwd: outside });

    for (const row of rows) {
      if (row.label === "unreadable settings file" && isRoot) continue;
      const { record } = recordFor(`off-rec-${row.label.length}`, row.root);
      row.prep?.();
      try {
        for (const p of [
          payload({ event: "pre", tool: "Bash", cwd: row.cwd, command: "git commit -m x" }),
          payload({ event: "post", tool: "Skill", cwd: row.cwd, skill: "dev-process-toolkit:gate-check" }),
        ]) {
          silent(runCapture(p, { record }), row.label);
        }
      } finally {
        row.after?.();
      }
      expect({ label: row.label, ledger: existsSync(ledgerDir(row.root)) }).toEqual({ label: row.label, ledger: false });
    }

    // CONTROL: the same driver with the flag on DOES write, so the silence above is the flag's.
    const on = makeCheckout("off-control", "on");
    const { record } = recordFor("off-control-rec", on);
    silent(runCapture(payload({ event: "pre", tool: "Bash", cwd: on, command: "ls" }), { record }), "control");
    expect(ledgerRows(on).length).toBe(1);
  }, T);
});

// ===========================================================================
// AC-STE-716.4 — heavy modules load only when on
// ===========================================================================

const markerPrelude = (marker: string): string =>
  `import { writeFileSync as __m7bc805Marker } from "node:fs";\n__m7bc805Marker(${JSON.stringify(marker)}, "loaded\\n");\n`;

function markedCopy(label: string): { copy: string; settingsMarker: string; commitMarker: string } {
  const copy = realpathSync(pluginCopy(label));
  const out = tempDir(`${label}-out`);
  const settingsMarker = join(out, "settings.loaded");
  const commitMarker = join(out, "commit.loaded");
  for (const [rel, marker] of [
    ["adapters/_shared/src/project_settings.ts", settingsMarker],
    ["adapters/_shared/src/commit_target_repo.ts", commitMarker],
  ] as const) {
    const file = join(copy, rel);
    writeFileSync(file, markerPrelude(marker) + readFileSync(file, "utf-8"));
  }
  return { copy, settingsMarker, commitMarker };
}

describe("AC-STE-716.4 heavy modules load only when on", () => {
  test("heavy modules load only when on: no settings file → no marker; flag off → settings only; flag on commit → both", () => {
    const { copy, settingsMarker, commitMarker } = markedCopy("heavy");
    // CONTROL: loading each stubbed module writes its marker, so an absence below means something.
    for (const [rel, marker] of [
      ["adapters/_shared/src/project_settings.ts", settingsMarker],
      ["adapters/_shared/src/commit_target_repo.ts", commitMarker],
    ] as const) {
      spawnSync("rm", ["-f", settingsMarker, commitMarker]);
      spawnSync("bun", ["-e", `await import(${JSON.stringify(join(copy, rel))})`]);
      expect({ rel, loaded: existsSync(marker) }).toEqual({ rel, loaded: true });
    }
    spawnSync("rm", ["-f", settingsMarker, commitMarker]);

    const commit = (root: string) => payload({ event: "pre", tool: "Bash", cwd: root, command: "git commit -m x" });

    const none = makeCheckout("heavy-none", "none");
    silent(runCapture(commit(none), { record: recordFor("heavy-none-rec", none, copy).record, pluginRoot: copy }), "no settings file");
    expect({ settings: existsSync(settingsMarker), commit: existsSync(commitMarker) }).toEqual({ settings: false, commit: false });

    const off = makeCheckout("heavy-off", "false");
    silent(runCapture(commit(off), { record: recordFor("heavy-off-rec", off, copy).record, pluginRoot: copy }), "flag off");
    expect({ settings: existsSync(settingsMarker), commit: existsSync(commitMarker) }).toEqual({ settings: true, commit: false });
    spawnSync("rm", ["-f", settingsMarker, commitMarker]);

    const on = makeCheckout("heavy-on", "on");
    silent(runCapture(commit(on), { record: recordFor("heavy-on-rec", on, copy).record, pluginRoot: copy }), "flag on");
    expect({ settings: existsSync(settingsMarker), commit: existsSync(commitMarker) }).toEqual({ settings: true, commit: true });
    expect(ledgerRows(on).length).toBe(1);
  }, T);

  test("a flag-off run under a PATH whose git writes a marker leaves no git marker", () => {
    const marker = join(tempDir("git-marker-out"), "git.ran");
    const shims = shimDir("git-shim", "git", marker, { exec: REAL_GIT });
    // CONTROL: the shim is on PATH and writes its marker when called.
    spawnSync("git", ["--version"], { env: { ...process.env, ...withPath(shims) } });
    expect(existsSync(marker)).toBe(true);
    spawnSync("rm", ["-f", marker]);

    const off = makeCheckout("git-off", "false");
    const { record } = recordFor("git-off-rec", off);
    for (const p of [
      payload({ event: "pre", tool: "Bash", cwd: off, command: "git commit -m x" }),
      payload({ event: "pre", tool: "Skill", cwd: off, skill: "dev-process-toolkit:tdd" }),
    ]) {
      silent(runCapture(p, { record, env: withPath(shims) }), "flag off");
    }
    expect(existsSync(marker)).toBe(false);
  }, T);

  test("[AC-.14 control] moving the settings loader to a static import marks the no-settings-file run", () => {
    const { copy, settingsMarker } = markedCopy("heavy-static");
    const entry = join(copy, ENTRY_REL);
    writeFileSync(entry, `import "../../../../adapters/_shared/src/project_settings.ts";\n${readFileSync(entry, "utf-8")}`);
    const none = makeCheckout("heavy-static-none", "none");
    runCapture(payload({ event: "pre", tool: "Bash", cwd: none, command: "ls" }), {
      record: recordFor("heavy-static-rec", none, copy).record,
      pluginRoot: copy,
    });
    expect(existsSync(settingsMarker)).toBe(true);
  }, T);
});

// ===========================================================================
// AC-STE-716.5 — rows
// ===========================================================================

describe("AC-STE-716.5 rows", () => {
  test("rows: one line per event at toolCallLedgerPath, each with the closed key set and no exit_code", async () => {
    const root = makeCheckout("rows", "on");
    const { record } = recordFor("rows-rec", root);
    const events = [
      payload({ event: "pre", tool: "Bash", cwd: root, command: "ls", toolUseId: "toolu_A" }),
      payload({ event: "post", tool: "Bash", cwd: root, command: "ls", toolUseId: "toolu_A" }),
      payload({ event: "pre", tool: "Skill", cwd: root, skill: "dev-process-toolkit:gate-check", toolUseId: "toolu_B" }),
      payload({ event: "post", tool: "Skill", cwd: root, skill: "dev-process-toolkit:gate-check", toolUseId: "toolu_B" }),
    ];
    for (const p of events) silent(runCapture(p, { record }), "on");

    const { toolCallLedgerPath } = (await import("../adapters/_shared/src/dpt_paths")) as Record<string, any>;
    const file = toolCallLedgerPath(root, SID);
    expect(file).toBe(join(root, ".dpt", "ledger", "tool-calls", `${SID}.jsonl`));
    expect(existsSync(file)).toBe(true);
    const lines = readFileSync(file, "utf-8").split("\n").filter((l) => l.length > 0);
    expect(lines.length).toBe(4);
    const rows = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    for (const r of rows) {
      expect(Object.keys(r).sort()).toEqual(ROW_KEYS);
      expect(r.schema).toBe("tool-call/v1");
      expect("exit_code" in r).toBe(false);
      expect(typeof r.ts).toBe("string");
      expect(new Date(r.ts as string).toISOString()).toBe(r.ts as string);
      expect(r.scope).toBe("main");
    }
    expect(rows.map((r) => [r.event, r.tool, r.tool_use_id])).toEqual([
      ["pre", "Bash", "toolu_A"],
      ["post", "Bash", "toolu_A"],
      ["pre", "Skill", "toolu_B"],
      ["post", "Skill", "toolu_B"],
    ]);
  }, T);

  test("a call inside a fork (payload carries agent_id) is scope fork; a payload without tool_use_id writes null", () => {
    const root = makeCheckout("rows-fork", "on");
    const { record } = recordFor("rows-fork-rec", root);
    silent(runCapture(payload({ event: "pre", tool: "Bash", cwd: root, command: "ls", agentId: "agent_SYNTH_01" }), { record }), "fork");
    const bare = payload({ event: "pre", tool: "Bash", cwd: root, command: "ls" });
    delete bare.tool_use_id;
    silent(runCapture(bare, { record }), "no tool_use_id");
    const rows = ledgerRows(root);
    expect(rows.map((r) => r.scope)).toEqual(["fork", "main"]);
    expect(rows[1]!.tool_use_id).toBeNull();
  }, T);

  test("nothing is written for a session id containing /", () => {
    const root = makeCheckout("rows-unsafe", "on");
    const { record } = recordFor("rows-unsafe-rec", root);
    silent(runCapture(payload({ event: "pre", tool: "Bash", cwd: root, command: "ls", sid: "a/b" }), { record }), "unsafe sid");
    silent(runCapture(payload({ event: "pre", tool: "Bash", cwd: root, command: "ls", sid: "../x" }), { record }), "unsafe sid ..");
    expect(ledgerEntries(root)).toEqual([]);
    expect(existsSync(join(root, ".dpt", "ledger", "a"))).toBe(false);
  }, T);
});

// ===========================================================================
// AC-STE-716.6 — class
// ===========================================================================

describe("AC-STE-716.6 class", () => {
  test("class: each payload maps to the Requirement's class and skill values", () => {
    const root = makeCheckout("class", "on");
    const elsewhere = realpathSync(tempDir("class-elsewhere"));
    const { record } = recordFor("class-rec", root);
    const table: Array<[string, Record<string, unknown>, string, string | null]> = [
      ["bare commit", payload({ event: "pre", tool: "Bash", cwd: root, command: "git commit -m x" }), "commit", null],
      ["cd <dir> && git commit", payload({ event: "pre", tool: "Bash", cwd: root, command: `cd ${root} && git commit -m x` }), "commit", null],
      ["git -C <dir> commit", payload({ event: "pre", tool: "Bash", cwd: root, command: `git -C ${root} commit -m x` }), "commit", null],
      ["gh pr create", payload({ event: "pre", tool: "Bash", cwd: root, command: "gh pr create --fill" }), "pr-create", null],
      ["gate-receipt run", payload({ event: "pre", tool: "Bash", cwd: root, command: receiptRun(root) }), "gate-receipt", null],
      ["outcome run", payload({ event: "pre", tool: "Bash", cwd: root, command: outcomeRun(root) }), "gate-receipt", null],
      ["ls", payload({ event: "pre", tool: "Bash", cwd: root, command: "ls" }), "other", null],
      ["toolkit Skill", payload({ event: "pre", tool: "Skill", cwd: root, skill: "dev-process-toolkit:spec-review" }), "skill", "dev-process-toolkit:spec-review"],
      ["non-toolkit Skill", payload({ event: "pre", tool: "Skill", cwd: root, skill: "synthetic-plugin:frontend" }), "skill", "other"],
    ];
    expect(elsewhere).not.toBe(root);
    for (const [label, p] of table) silent(runCapture(p, { record }), label);
    const rows = ledgerRows(root);
    expect(rows.length).toBe(table.length);
    expect(rows.map((r, i) => [table[i]![0], r.class, r.skill])).toEqual(table.map(([label, , cls, skill]) => [label, cls, skill]));
  }, T);
});

// ===========================================================================
// AC-STE-716.7 — tree and diff only where named
// ===========================================================================

describe("AC-STE-716.7 tree and diff only where named", () => {
  test("tree and diff only where named: commit pre and both Skill events carry the digest; diff only on commit pre", () => {
    const root = makeCheckout("tree", "on");
    writeFileSync(join(root, "a.txt"), "one\nTWO\nthree\n");
    writeFileSync(join(root, "b.txt"), "new 1\nnew 2\n");
    git(root, "add", "a.txt", "b.txt");
    const numstat = git(root, "diff", "--cached", "--numstat")
      .split("\n")
      .filter((l) => l.length > 0)
      .map((l) => l.split("\t"));
    const expectedDiff = {
      files: numstat.length,
      insertions: numstat.reduce((s, c) => s + Number(c[0]), 0),
      deletions: numstat.reduce((s, c) => s + Number(c[1]), 0),
    };
    expect(expectedDiff).toEqual({ files: 2, insertions: 3, deletions: 1 }); // CONTROL: a non-trivial staged diff
    const digest = worktreeDigest(root);
    expect(digest).toMatch(/^sha256:[0-9a-f]{64}$/);

    const { record } = recordFor("tree-rec", root);
    const calls = [
      payload({ event: "pre", tool: "Bash", cwd: root, command: "git commit -m x" }),
      payload({ event: "post", tool: "Bash", cwd: root, command: "git commit -m x" }),
      payload({ event: "pre", tool: "Skill", cwd: root, skill: "dev-process-toolkit:tdd" }),
      payload({ event: "post", tool: "Skill", cwd: root, skill: "dev-process-toolkit:tdd" }),
      payload({ event: "pre", tool: "Bash", cwd: root, command: "ls" }),
      payload({ event: "post", tool: "Bash", cwd: root, command: "ls" }),
      payload({ event: "pre", tool: "Bash", cwd: root, command: "gh pr create --fill" }),
    ];
    for (const p of calls) silent(runCapture(p, { record }), "on");
    const rows = ledgerRows(root);
    expect(rows.map((r) => [r.event, r.class, r.tree, r.diff])).toEqual([
      ["pre", "commit", digest, expectedDiff],
      ["post", "commit", null, null],
      ["pre", "skill", digest, null],
      ["post", "skill", digest, null],
      ["pre", "other", null, null],
      ["post", "other", null, null],
      ["pre", "pr-create", null, null],
    ]);
  }, T);
});

// ===========================================================================
// AC-STE-716.8 — privacy
// ===========================================================================

describe("AC-STE-716.8 privacy", () => {
  const PLANTED = ["/Users/synthetic-user/x", "/home/synthetic/y", "feature/synthetic-secret", "00000000-0000-4000-8000-000000000042"];

  test("privacy: no row byte carries a planted command, description, cwd, Skill arg or branch string", () => {
    const root = makeCheckout("privacy", "on", { branch: "feature/synthetic-secret" });
    const cwd = join(root, "Users", "synthetic-user", "x");
    mkdirSync(cwd, { recursive: true });
    const sid = "00000000-0000-4000-8000-000000000042";
    const text = PLANTED.join(" ");
    const { record } = recordFor("privacy-rec", root);
    const calls = [
      payload({ event: "pre", tool: "Bash", cwd, sid, command: `cat /Users/synthetic-user/x/f && ls /home/synthetic/y # ${text}`, description: text }),
      payload({ event: "post", tool: "Bash", cwd, sid, command: `cat /Users/synthetic-user/x/f && ls /home/synthetic/y # ${text}`, description: text }),
      payload({ event: "pre", tool: "Bash", cwd, sid, command: `git commit -m "${text}"`, description: text }),
      payload({ event: "pre", tool: "Skill", cwd, sid, skill: "dev-process-toolkit:implement", args: text }),
      payload({ event: "post", tool: "Skill", cwd, sid, skill: "synthetic:feature/synthetic-secret", args: text }),
    ];
    for (const p of calls) silent(runCapture(p, { record }), "privacy");
    const bytes = ledgerBytes(root);
    expect(bytes.split("\n").filter((l) => l.length > 0).length).toBe(calls.length); // CONTROL: rows were written
    for (const needle of [...PLANTED, "/Users/", "/home/", root]) {
      expect({ needle, found: bytes.includes(needle) }).toEqual({ needle, found: false });
    }
  }, T);
});

// ===========================================================================
// AC-STE-716.9 — never blocks
// ===========================================================================

describe("AC-STE-716.9 never blocks", () => {
  test("never blocks: malformed stdin exits 0 silent", () => {
    const root = makeCheckout("nb-stdin", "on");
    const { record } = recordFor("nb-stdin-rec", root);
    for (const stdin of ["{not json", "", "[]", "null"]) silent(runCapture(stdin, { record, cwd: root, projectDir: root }), `stdin ${JSON.stringify(stdin)}`);
    expect(ledgerEntries(root)).toEqual([]);
  }, T);

  test("never blocks: a failing git exits 0 silent", () => {
    const root = makeCheckout("nb-git", "on");
    const { record } = recordFor("nb-git-rec", root);
    const shims = shimDir("nb-git-shim", "git", join(tempDir("nb-git-out"), "git.ran"), { exit: 1 });
    for (const p of [
      payload({ event: "pre", tool: "Bash", cwd: root, command: "git commit -m x" }),
      payload({ event: "pre", tool: "Skill", cwd: root, skill: "dev-process-toolkit:tdd" }),
    ]) {
      silent(runCapture(p, { record, env: withPath(shims) }), "failing git");
    }
  }, T);

  test("never blocks: a read-only ledger directory exits 0 silent", () => {
    if (isRoot) return;
    const root = makeCheckout("nb-ro", "on");
    const { record } = recordFor("nb-ro-rec", root);
    mkdirSync(ledgerDir(root), { recursive: true });
    chmodSync(ledgerDir(root), 0o555);
    try {
      silent(runCapture(payload({ event: "pre", tool: "Bash", cwd: root, command: "ls" }), { record }), "read-only ledger");
    } finally {
      chmodSync(ledgerDir(root), 0o755);
    }
  }, T);
});

// ===========================================================================
// AC-STE-716.11 — scope of the ledger, docs, STE-641
// ===========================================================================

/** The text `inserted` such that `after` = `before` with `inserted` spliced in at one point; null otherwise. */
function pureInsertion(before: string, after: string): string | null {
  let p = 0;
  while (p < before.length && p < after.length && before[p] === after[p]) p++;
  let s = 0;
  while (s < before.length - p && s < after.length - p && before[before.length - 1 - s] === after[after.length - 1 - s]) s++;
  if (p + s !== before.length) return null;
  return after.slice(p, after.length - s);
}

function section(doc: string, heading: RegExp): string | null {
  const lines = doc.split("\n");
  const start = lines.findIndex((l) => heading.test(l));
  if (start < 0) return null;
  const level = /^#+/.exec(lines[start]!)![0].length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = /^(#+) /.exec(lines[i]!);
    if (m && m[1]!.length <= level) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

describe("AC-STE-716.11 the ledger's readers, the hooks reference and STE-641", () => {
  test("no hook module other than tool-call-capture.ts and session-token-ledger.ts references toolCallLedgerPath or tool-calls", () => {
    const dir = join(PLUGIN_ROOT, "templates", "hooks", "_lib", "hooks");
    const names = readdirSync(dir).filter((n) => n.endsWith(".ts"));
    expect(names).toContain("tool-call-capture.ts"); // CONTROL: the writer exists and is excluded by name
    const hits = names
      .filter((n) => n !== "tool-call-capture.ts" && n !== "session-token-ledger.ts")
      .filter((n) => /toolCallLedgerPath|tool-calls/.test(readFileSync(join(dir, n), "utf-8")));
    expect(hits).toEqual([]);
  });

  test("docs/hooks-reference.md § tool-call-capture: not bundled, no gate reads the rows, the version pin, the next session start", () => {
    const doc = readFileSync(join(PLUGIN_ROOT, "docs", "hooks-reference.md"), "utf-8");
    const body = section(doc, /^#+ .*tool-call-capture/);
    expect(body).not.toBeNull();
    expect(body!).toMatch(/not bundled/i);
    expect(body!).toMatch(/no gate reads/i);
    expect(body!).toMatch(/version/i);
    expect(body!).toContain("installed_plugins.json");
    expect(body!).toMatch(/next session start/i);
    expect(body!).toContain(".claude/settings.local.json");
    expect(body!).toContain("tracking.tool_calls");
  });

  test("specs/frs/archive/STE-641.md gains exactly one appended clause about capture rows and no other byte changes", () => {
    const before = atV300("specs/frs/archive/STE-641.md");
    const after = readFileSync(join(PLUGIN_ROOT, "..", "..", "specs", "frs", "archive", "STE-641.md"), "utf-8");
    const inserted = pureInsertion(before, after);
    expect(inserted).not.toBeNull();
    expect(inserted!.length).toBeGreaterThan(0);
    expect(inserted!).toMatch(/capture/i);
    expect(inserted!).toMatch(/gate/i);
    expect(inserted!.includes("\n\n")).toBe(false); // one clause, not a new section
  });
});

// ===========================================================================
// AC-STE-716.12 — the ledger is ignored
// ===========================================================================

describe("AC-STE-716.12 the ledger is ignored", () => {
  test("git check-ignore reports .dpt/ledger/tool-calls/x.jsonl ignored under the unchanged DPT_GITIGNORE_BODY", () => {
    // The body is unchanged from the milestone base (no new rule for tool-calls/).
    expect(atV300(`${PLUGIN_REL}/adapters/_shared/src/setup/dpt_gitignore.ts`)).toContain(JSON.stringify(DPT_GITIGNORE_BODY));
    const root = join(tempDir("ignore"), "repo");
    mkdirSync(join(root, ".dpt", "ledger", "tool-calls"), { recursive: true });
    git(root, "init", "-q");
    writeFileSync(join(root, ".dpt", ".gitignore"), DPT_GITIGNORE_BODY);
    writeFileSync(join(root, ".dpt", "ledger", "tool-calls", "x.jsonl"), "{}\n");
    const p = spawnSync("git", ["check-ignore", "-q", ".dpt/ledger/tool-calls/x.jsonl"], { cwd: root });
    expect(p.status).toBe(0);
    // CONTROL: without the nested ignore file the path is not ignored.
    spawnSync("rm", ["-f", join(root, ".dpt", ".gitignore")]);
    expect(spawnSync("git", ["check-ignore", "-q", ".dpt/ledger/tool-calls/x.jsonl"], { cwd: root }).status).toBe(1);
  });
});

// ===========================================================================
// AC-STE-716.14 — mutation controls
// ===========================================================================
//
// Each named mutation is observable by at least one named test. The table names
// the test; this suite asserts the named test exists in the named file, so a
// rename that orphans a mutation reds here. The static-import mutation is also
// applied for real above ("[AC-.14 control] ...").

describe("AC-STE-716.14 mutation controls", () => {
  const TABLE: Array<[string, string, string]> = [
    ["removing the flag check", "m_7bc805-ste-716-capture-hook.test.ts", "off writes nothing: flag absent, false, unreadable settings, foreign settings, cwd outside any checkout"],
    ["moving the settings loader to a static import", "m_7bc805-ste-716-capture-hook.test.ts", "[AC-.14 control] moving the settings loader to a static import marks the no-settings-file run"],
    ["writing tool_input.command into a row", "m_7bc805-ste-716-capture-hook.test.ts", "privacy: no row byte carries a planted command, description, cwd, Skill arg or branch string"],
    ["computing tree on an other Bash call", "m_7bc805-ste-716-capture-hook.test.ts", "tree and diff only where named: commit pre and both Skill events carry the digest; diff only on commit pre"],
    ["dropping the shell guard or its version pin from renderCaptureHookCommand", "m_7bc805-ste-716-capture-registration.test.ts", "renderCaptureHookCommand over a synthetic root, version and record path is byte-equal to the pinned string"],
    ["dropping the hook's record-entry check", "m_7bc805-ste-716-capture-registration.test.ts", "the record lists the old root for another projectPath and a newer root for this checkout: guard passes, hook writes nothing, status guard: fail"],
    ["dropping the guard evaluation from status", "m_7bc805-ste-716-capture-registration.test.ts", "the record lists the old root for another projectPath and a newer root for this checkout: guard passes, hook writes nothing, status guard: fail"],
    ["dropping the tracked-file refusal of register", "m_7bc805-ste-716-capture-registration.test.ts", "register refuses: the local settings file tracked by git"],
    ["reading the setting from HEAD instead of the working tree in detect", "m_7bc805-ste-716-capture-registration.test.ts", "detect applies on (key committed on but removed in the working tree, entry present); apply unregisters and leaves specs/settings.yaml byte-identical"],
  ];

  for (const [mutation, file, name] of TABLE) {
    test(`AC-.14 "${mutation}" is observed by a named test`, () => {
      const src = readFileSync(join(PLUGIN_ROOT, "tests", file), "utf-8");
      expect({ mutation, named: src.includes(JSON.stringify(name)) || src.includes(`"${name}"`) || src.includes(`\`${name}\``) }).toEqual({ mutation, named: true });
    });
  }
});
