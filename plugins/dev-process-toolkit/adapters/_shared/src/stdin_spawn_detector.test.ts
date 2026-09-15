// M_4df444 / STE-595 — the pure stdin-spawn detector (unit).
//
// CONTRACT — the module this suite drives, `stdin_spawn_detector.ts` beside it:
//
//   export function detectStdinSpawn(command: string): StdinSpawnVerdict;
//   export type StdinSpawnVerdict =
//     | { refuse: false }
//     | { refuse: true;
//         consumer: "bash" | "sh" | "zsh";   // the shell that reads a script from stdin
//         feed: "heredoc" | "herestring" | "pipe" | "redirect";
//         why: string };                    // one line, fed to the NFR-10 `Refusing:` line
//
// THE RULE (FR STE-595 § Requirement): refuse when `bash`, `sh` or `zsh` reads
// a script from stdin — heredoc, here-string, pipe or `<` redirect — AND that
// script backgrounds a process (`&` other than `&&`, `&>` and `>&`, or
// `nohup`, `setsid`, `disown`), OR its text is not in the command itself (a `<`
// redirect, or a pipe from a file or another command). A body it cannot see
// counts as unsafe.
//
// WHAT IT MUST NOT KEY ON: "a heredoc plus an ampersand". The sanctioned
// `claude -p … <<'PROMPT_EOF' … &` spawn feeds its prompt through a heredoc and
// backgrounds it; it is allowed because no SHELL is the stdin consumer. The
// strongest control below is the golden fixture itself with its
// `bash <<'OUTER'` wrapper removed: the same three spawns, allowed.
//
// FIXTURES: tests/fixtures/stdin-spawn/*.sh, copied byte-for-byte from the kept
// transcript 9c766729 (never edited). Their hashes are pinned in
// tests/m_4df444-ste-595-stdin-spawn-hook.test.ts.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

type Verdict = { refuse: boolean; consumer?: string; feed?: string; why?: string };
type Detect = (command: string) => Verdict;

const MODULE_PATH = join(import.meta.dir, "stdin_spawn_detector.ts");
const FIXTURES = join(import.meta.dir, "..", "..", "..", "tests", "fixtures", "stdin-spawn");
const fixture = (name: string): string => readFileSync(join(FIXTURES, name), "utf-8");

let loaded: Detect | null = null;
let loadError = "";
try {
  const mod = (await import("./stdin_spawn_detector")) as { detectStdinSpawn?: unknown };
  if (typeof mod.detectStdinSpawn === "function") loaded = mod.detectStdinSpawn as Detect;
  else loadError = "adapters/_shared/src/stdin_spawn_detector.ts does not export `detectStdinSpawn`";
} catch (e) {
  loadError = `cannot load adapters/_shared/src/stdin_spawn_detector.ts: ${(e as Error).message}`;
}

function detect(command: string): Verdict {
  if (loaded === null) throw new Error(loadError);
  return loaded(command);
}

type Consumer = "bash" | "sh" | "zsh";
type Feed = "heredoc" | "herestring" | "pipe" | "redirect";
interface RefusedRow {
  name: string;
  command: string;
  consumer: Consumer;
  feed: Feed;
}

function expectRefused(row: RefusedRow): void {
  const v = detect(row.command);
  expect(v.refuse, `expected REFUSE for ${JSON.stringify(row.command)}; got ${JSON.stringify(v)}`).toBe(true);
  expect(v.consumer, "the shell reading the script from stdin").toBe(row.consumer);
  expect(v.feed, "how the script reaches that shell's stdin").toBe(row.feed);
  expect(typeof v.why === "string" && v.why.trim().length > 0, "a refusal says why").toBe(true);
}

function expectAllowed(command: string): void {
  const v = detect(command);
  expect(v.refuse, `expected ALLOW for ${JSON.stringify(command)}; got ${JSON.stringify(v)}`).toBe(false);
}

/** The golden fixture with its `bash <<'OUTER'` wrapper removed: the body as a direct command. */
function unwrapOuter(text: string): string {
  const lines = text.split("\n");
  expect(lines[0], "the golden opens with the wrapper line").toBe("bash <<'OUTER'");
  expect(lines[lines.length - 1], "the golden closes with the wrapper terminator").toBe("OUTER");
  return lines.slice(1, -1).join("\n");
}

const GOLDEN = fixture("golden-phase-a-2026-09-11.sh");
const PREFLIGHT_1 = fixture("control-preflight-1.sh");
const PREFLIGHT_2 = fixture("control-preflight-2.sh");

// ===========================================================================
// AC-STE-595.1 — the 2026-09-11 Phase A command.
// ===========================================================================

describe("AC-STE-595.1 — the golden 2026-09-11 Phase A command is refused", () => {
  test("the verbatim `bash <<'OUTER'` call is refused: consumer bash, fed by heredoc", () => {
    expectRefused({ name: "golden", command: GOLDEN, consumer: "bash", feed: "heredoc" });
  });

  test("CONTROL: the same body without the wrapper is allowed — the refusal keys on the consumer", () => {
    const body = unwrapOuter(GOLDEN);
    expect(body, "the unwrapped body still holds the backgrounded groups").toMatch(/^\} <\/dev\/null >\/dev\/null 2>&1 &$/m);
    expect(body).toContain("<<'PROMPT_EOF'");
    expectAllowed(body);
  });

  test("CONTROL: the two pre-flight `bash <<'EOF'` calls from the same transcript are allowed", () => {
    expect(PREFLIGHT_1.startsWith("bash <<'EOF'\n"), "control 1 is a heredoc into bash").toBe(true);
    expect(PREFLIGHT_2.startsWith("bash <<'EOF'\n"), "control 2 is a heredoc into bash").toBe(true);
    expectAllowed(PREFLIGHT_1);
    expectAllowed(PREFLIGHT_2);
  });
});

// ===========================================================================
// AC-STE-595.2 — the AC's own refused and allowed shapes.
// ===========================================================================

const AC2_REFUSED: RefusedRow[] = [
  { name: "bash <<EOF with a backgrounding body", command: "bash <<EOF\nsleep 30 &\nEOF", consumer: "bash", feed: "heredoc" },
  {
    name: "bash <<'EOF' with a backgrounded claude spawn",
    command: "bash <<'EOF'\nclaude -p x > /tmp/ste595.log 2>&1 &\necho $! > /tmp/ste595.pid\nEOF",
    consumer: "bash",
    feed: "heredoc",
  },
  { name: "bash <<-EOF (tab-stripped) with a backgrounding body", command: "bash <<-EOF\n\tsleep 30 &\n\tEOF", consumer: "bash", feed: "heredoc" },
  { name: "sh -s <<EOF", command: "sh -s <<EOF\nsleep 30 &\nEOF", consumer: "sh", feed: "heredoc" },
  { name: "zsh <<EOF", command: "zsh <<EOF\nsleep 30 &\nEOF", consumer: "zsh", feed: "heredoc" },
  { name: "… | bash with a backgrounding body", command: "printf '%s\\n' 'sleep 30 &' | bash", consumer: "bash", feed: "pipe" },
  { name: "… | sh with a backgrounding body", command: "echo 'sleep 30 &' | sh", consumer: "sh", feed: "pipe" },
  { name: "bash < fence.sh (the body is not in the command)", command: "bash < fence.sh", consumer: "bash", feed: "redirect" },
  { name: "cat fence.sh | bash (the body is not in the command)", command: "cat fence.sh | bash", consumer: "bash", feed: "pipe" },
  { name: 'bash <<< "cmd &"', command: 'bash <<< "sleep 30 &"', consumer: "bash", feed: "herestring" },
];

const SANCTIONED_SPAWN = [
  "claude -p \\",
  "  --output-format stream-json --verbose \\",
  "  > /tmp/dpt-smoke-ste595-setup.log 2>&1 <<'PROMPT_EOF' &",
  "<dpt:auto-approve>v1</dpt:auto-approve>",
  "/dev-process-toolkit:setup",
  "PROMPT_EOF",
  "echo $! > /tmp/dpt-smoke-ste595-setup.pid",
].join("\n");

const SANCTIONED_BRACE_SPAWN = [
  "{",
  '  claude -p "/smoke-test --tracker none" \\',
  '    --plugin-dir "${PLUGIN_DIR}" \\',
  "    > \"${LOG_NONE}\" 2>&1 <<'PROMPT_EOF'",
  "<dpt:auto-approve>v1</dpt:auto-approve>",
  "PROMPT_EOF",
  "} &",
  'PID_NONE=$!; echo $! > "${PID_FILE_NONE}"',
].join("\n");

const AC2_ALLOWED: [string, string][] = [
  ["claude -p … <<'PROMPT_EOF' … & (the sanctioned spawn)", SANCTIONED_SPAWN],
  ["{ claude -p … <<'PROMPT_EOF' … } & (the sanctioned brace-group spawn)", SANCTIONED_BRACE_SPAWN],
  ["bash /path/fence.sh", "bash /tmp/ste595/fence.sh"],
  ["bash -c 'a && b'", "bash -c 'true && echo ok'"],
  ["heredoc into bash with no backgrounding — pre-flight 1", PREFLIGHT_1],
  ["heredoc into bash with no backgrounding — pre-flight 2", PREFLIGHT_2],
  ["cmd1 && cmd2", "true && echo ok"],
];

describe("AC-STE-595.2 — the refused shapes", () => {
  for (const row of AC2_REFUSED) {
    test(`refused: ${row.name}`, () => expectRefused(row));
  }
});

describe("AC-STE-595.2 — the allowed shapes", () => {
  for (const [name, command] of AC2_ALLOWED) {
    test(`allowed: ${name}`, () => expectAllowed(command));
  }
});

// ===========================================================================
// AC-STE-595.2 — the Requirement's own terms, beyond the AC's list.
// ===========================================================================

const REQUIREMENT_REFUSED: RefusedRow[] = [
  { name: "nohup in the body", command: "bash <<'EOF'\nnohup claude -p x > /tmp/ste595.log 2>&1\nEOF", consumer: "bash", feed: "heredoc" },
  { name: "setsid in the body", command: "bash <<'EOF'\nsetsid claude -p x > /tmp/ste595.log 2>&1\nEOF", consumer: "bash", feed: "heredoc" },
  { name: "disown in the body", command: "bash <<'EOF'\njobs\ndisown -a\nEOF", consumer: "bash", feed: "heredoc" },
  { name: "a mid-line & in the body", command: "bash <<'EOF'\nsleep 30 & echo started\nEOF", consumer: "bash", feed: "heredoc" },
  { name: "the shell after a `cd … &&` prefix", command: "cd /tmp && bash <<'EOF'\nsleep 30 &\nEOF", consumer: "bash", feed: "heredoc" },
  { name: "a path-qualified shell", command: "/bin/bash <<'EOF'\nsleep 30 &\nEOF", consumer: "bash", feed: "heredoc" },
  { name: "a heredoc into cat, piped into bash", command: "cat <<'EOF' | bash\nsleep 30 &\nEOF", consumer: "bash", feed: "pipe" },
];

const REQUIREMENT_ALLOWED: [string, string][] = [
  [
    "a heredoc into bash using only the excluded ampersand forms (&&, &>, >&, 2>&1)",
    "bash <<'EOF'\nls 2>&1 | head\nls &> /dev/null\necho hi >&2\ntrue && echo ok\nEOF",
  ],
  ["bash reading its script from a FILE while stdin is redirected", "bash /tmp/ste595/fence.sh < /dev/null"],
  ["bash running a file, itself backgrounded", "bash /tmp/ste595/fence.sh > /tmp/ste595/fence.out 2>&1 &"],
  [
    "writing the fence to a file through a heredoc into cat, then running it from the file",
    "cat > /tmp/ste595/fence.sh <<'EOF'\n{\n  sleep 30\n} &\nEOF\nbash /tmp/ste595/fence.sh",
  ],
  ["a commit message heredoc into cat that contains an ampersand", "git commit -m \"$(cat <<'EOF'\nfeat(hooks): refuse a & b\nEOF\n)\""],
  // This milestone's own commit messages will name the refused shape in text.
  ["a quoted mention of `bash <<EOF` in a commit message", 'git commit -m "fix(hooks): refuse bash <<EOF spawn fences"'],
];

describe("AC-STE-595.2 — the Requirement's terms: refused", () => {
  for (const row of REQUIREMENT_REFUSED) {
    test(`refused: ${row.name}`, () => expectRefused(row));
  }
});

describe("AC-STE-595.2 — the Requirement's terms: allowed", () => {
  for (const [name, command] of REQUIREMENT_ALLOWED) {
    test(`allowed: ${name}`, () => expectAllowed(command));
  }
});

// ===========================================================================
// AC-STE-595.3 (detector half) — the detector is pure.
// ===========================================================================

describe("AC-STE-595.3 — the detector is pure: text in, verdict out", () => {
  test("the module source touches no file, process, network or environment", () => {
    expect(existsSync(MODULE_PATH), "adapters/_shared/src/stdin_spawn_detector.ts must exist").toBe(true);
    const src = readFileSync(MODULE_PATH, "utf-8");
    expect(src).not.toMatch(/from\s+["']node:(?:fs|fs\/promises|child_process|net|http|https|os)["']/);
    expect(src).not.toMatch(/\bBun\.(?:file|spawn|spawnSync|write|stdin)\b/);
    expect(src).not.toMatch(/\bfetch\s*\(|\bprocess\.env\b|\brequire\s*\(/);
  });

  test("the same command gets the same verdict twice", () => {
    expect(detect(GOLDEN)).toEqual(detect(GOLDEN));
    expect(detect(PREFLIGHT_1)).toEqual(detect(PREFLIGHT_1));
  });
});
