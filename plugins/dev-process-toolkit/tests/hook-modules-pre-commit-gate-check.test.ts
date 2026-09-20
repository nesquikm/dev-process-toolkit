// STE-290 AC.2 — `_lib/hooks/pre-commit-gate-check.ts` per-hook TS module.
//
// Reads stdin, parses via `parseHookPayload`, recognises a commit-bearing
// command via `resolveCommitTarget` (STE-597: the bare, `cd`-prefixed and `-C`
// forms alike), then delegates to `requireSkillToolUse` for the
// `dev-process-toolkit:gate-check` skill. Module is invoked via `bun run`.
//
// It reads `repoRoot` for NOTHING: this hook performs no staged-path
// classification and must not grow one (AC-STE-597.3).

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const PLUGIN_ROOT = join(REPO_ROOT, "plugins", "dev-process-toolkit");
const MODULE_PATH = join(
  PLUGIN_ROOT,
  "templates",
  "hooks",
  "_lib",
  "hooks",
  "pre-commit-gate-check.ts",
);

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "ste-290-mod-gc-"));
});

afterEach(() => {
  if (tmpRoot && existsSync(tmpRoot)) {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

function writeTranscript(entries: unknown[]): string {
  const file = join(tmpRoot, "transcript.jsonl");
  writeFileSync(
    file,
    entries.map((e) => JSON.stringify(e)).join("\n") + "\n",
  );
  return file;
}

/**
 * STE-597 — `procCwd` is the HOOK PROCESS's working directory. It is varied
 * independently of `payload.cwd` below so a hook that reads one while claiming
 * to read the other cannot pass.
 */
async function runModule(
  stdinPayload: string,
  procCwd?: string,
): Promise<RunResult> {
  const proc = Bun.spawn(["bun", "run", MODULE_PATH], {
    ...(procCwd ? { cwd: procCwd } : {}),
    stdin: new Response(stdinPayload).body,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { exitCode, stdout, stderr };
}

describe("AC-STE-290.2 — pre-commit-gate-check module: file exists", () => {
  test("module exists at the documented path", () => {
    expect(existsSync(MODULE_PATH)).toBe(true);
  });
});

describe("AC-STE-290.2 — pre-commit-gate-check: command-pattern guard early-exits non-`git commit`", () => {
  test("`ls` command → exit 0, no enforcement", async () => {
    const transcript = writeTranscript([
      { type: "tool_use", name: "Bash", input: { command: "ls" } },
    ]);
    const stdin = JSON.stringify({
      session_id: "s1",
      transcript_path: transcript,
      cwd: "/tmp",
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "ls -la" },
    });
    const r = await runModule(stdin);
    expect(r.exitCode).toBe(0);
  });

  test("`git status` command → exit 0, no enforcement", async () => {
    const transcript = writeTranscript([
      { type: "tool_use", name: "Bash", input: { command: "ls" } },
    ]);
    const stdin = JSON.stringify({
      session_id: "s1",
      transcript_path: transcript,
      cwd: "/tmp",
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "git status" },
    });
    const r = await runModule(stdin);
    expect(r.exitCode).toBe(0);
  });
});

describe("AC-STE-290.2 — pre-commit-gate-check: empty / unparseable stdin fails open", () => {
  test("empty stdin → exit 0", async () => {
    const r = await runModule("");
    expect(r.exitCode).toBe(0);
  });

  test("malformed JSON stdin → exit 0", async () => {
    const r = await runModule("{not-json");
    expect(r.exitCode).toBe(0);
  });
});

describe("AC-STE-290.2 — pre-commit-gate-check: end-to-end skill detection on `git commit*`", () => {
  test("git commit + Skill tool_use present → exit 0", async () => {
    const transcript = writeTranscript([
      {
        type: "tool_use",
        name: "Skill",
        input: { skill: "dev-process-toolkit:gate-check" },
      },
    ]);
    const stdin = JSON.stringify({
      session_id: "s1",
      transcript_path: transcript,
      cwd: "/tmp",
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "git commit -m wip" },
    });
    const r = await runModule(stdin);
    expect(r.exitCode).toBe(0);
  });

  test("git commit + Skill tool_use missing → exit non-zero + NFR-10 stderr", async () => {
    const transcript = writeTranscript([
      { type: "tool_use", name: "Bash", input: { command: "ls" } },
    ]);
    const stdin = JSON.stringify({
      session_id: "s1",
      transcript_path: transcript,
      cwd: "/tmp",
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "git commit -m wip" },
    });
    const r = await runModule(stdin);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("Refusing:");
    expect(r.stderr).toContain("Remedy:");
    expect(r.stderr).toContain("Context:");
    expect(r.stderr).toMatch(/gate-check/);
  });
});

// ---------------------------------------------------------------------------
// STE-597 — the sibling gate-check hook recognises the SAME three command
// shapes, closing the same bypass, and gains NO staged-path classification.
//
// AC-STE-597.3. This hook asks one question — "was /gate-check run in this
// session?" — and that question has no repository in it. So the pins here are:
//   (a) all three commit shapes are recognised (the bypass is closed), and
//   (b) the verdict is INDIFFERENT to what is staged, anywhere, because this
//       hook classifies no paths today and must not grow the ability.
// ---------------------------------------------------------------------------

let gcRepo: string;

/** A real checkout, so the `cd` / `-C` targets below name something that exists. */
async function initGcRepo(
  name: string,
  files: Record<string, string>,
): Promise<string> {
  const dir = join(tmpRoot, name);
  mkdirSync(dir, { recursive: true });
  await Bun.spawn(["git", "init", "-q", dir], {
    stdout: "pipe",
    stderr: "pipe",
  }).exited;
  writeFileSync(
    join(dir, "package.json"),
    '{"name":"fixture","version":"0.0.0","private":true}\n',
  );
  for (const [rel, body] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(full.split("/").slice(0, -1).join("/"), { recursive: true });
    writeFileSync(full, body);
    await Bun.spawn(["git", "-C", dir, "add", rel], {
      stdout: "pipe",
      stderr: "pipe",
    }).exited;
  }
  return dir;
}

function gcPayload(command: string, sessionCwd: string, transcript: string): string {
  return JSON.stringify({
    session_id: "s1",
    transcript_path: transcript,
    cwd: sessionCwd,
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command },
  });
}

function gcTranscriptWithout(): string {
  return writeTranscript([
    { type: "tool_use", name: "Bash", input: { command: "ls" } },
  ]);
}

function gcTranscriptWith(): string {
  return writeTranscript([
    {
      type: "tool_use",
      name: "Skill",
      input: { skill: "dev-process-toolkit:gate-check" },
    },
  ]);
}

describe("AC-STE-597.3 — pre-commit-gate-check recognises all three commit shapes", () => {
  test("`cd <repo> && git commit` → exit 2 + NFR-10 refusal (the retired matcher saw no commit)", async () => {
    gcRepo = await initGcRepo("gc-a", {});
    const r = await runModule(
      gcPayload(`cd ${gcRepo} && git commit -m wip`, gcRepo, gcTranscriptWithout()),
      gcRepo,
    );
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("Refusing:");
    expect(r.stderr).toContain("Remedy:");
    expect(r.stderr).toContain("Context:");
    expect(r.stderr).toMatch(/gate-check/);
  });

  test("`git -C <repo> commit` → exit 2, with the session rooted somewhere else entirely", async () => {
    gcRepo = await initGcRepo("gc-b", {});
    const elsewhere = await initGcRepo("gc-elsewhere", {});
    const r = await runModule(
      gcPayload(`git -C ${gcRepo} commit -m wip`, elsewhere, gcTranscriptWithout()),
      elsewhere,
    );
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("Refusing:");
  });

  test("bare `git commit` still refuses — no existing behaviour weakened", async () => {
    gcRepo = await initGcRepo("gc-c", {});
    const r = await runModule(
      gcPayload("git commit -m wip", gcRepo, gcTranscriptWithout()),
      gcRepo,
    );
    expect(r.exitCode).toBe(2);
  });

  test("CONTROL — all three shapes exit 0 when the /gate-check Skill tool_use IS present", async () => {
    gcRepo = await initGcRepo("gc-d", {});
    const t = gcTranscriptWith();
    const bare = await runModule(gcPayload("git commit -m wip", gcRepo, t), gcRepo);
    const cd = await runModule(
      gcPayload(`cd ${gcRepo} && git commit -m wip`, gcRepo, t),
      gcRepo,
    );
    const dashC = await runModule(
      gcPayload(`git -C ${gcRepo} commit -m wip`, gcRepo, t),
      gcRepo,
    );
    expect([bare.exitCode, cd.exitCode, dashC.exitCode]).toEqual([0, 0, 0]);
  });

  test("`git status` → exit 0 and SILENT, with the same fixture the refusals above used", async () => {
    gcRepo = await initGcRepo("gc-e", {});
    const r = await runModule(
      gcPayload("git status", gcRepo, gcTranscriptWithout()),
      gcRepo,
    );
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBe("");
  });

  test("`git log --grep='git commit'` → exit 0 and SILENT: mentioning a commit is not making one", async () => {
    gcRepo = await initGcRepo("gc-f", {});
    const r = await runModule(
      gcPayload("git log --grep='git commit'", gcRepo, gcTranscriptWithout()),
      gcRepo,
    );
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBe("");
  });
});

describe("AC-STE-597.3 — gate-check gains NO staged-path classification", () => {
  test("the verdict is identical whether NOTHING is staged or a test file is staged", async () => {
    const empty = await initGcRepo("gc-empty", {});
    const staged = await initGcRepo("gc-staged", { "src/foo.test.ts": "// test\n" });
    const t = gcTranscriptWithout();

    // The staged set is the only difference between these two runs.
    const withNothing = await runModule(
      gcPayload(`git -C ${empty} commit -m wip`, empty, t),
      empty,
    );
    const withTest = await runModule(
      gcPayload(`git -C ${staged} commit -m wip`, staged, t),
      staged,
    );

    expect(withNothing.exitCode).toBe(withTest.exitCode);
    // And it refuses on BOTH — a hook that had grown a staged-path carve-out
    // would wave the empty one through.
    expect(withNothing.exitCode).toBe(2);
    expect(withTest.exitCode).toBe(2);
  });

  test("CONTROL — that same empty-staged repo exits 0 once the /gate-check evidence is present", async () => {
    const empty = await initGcRepo("gc-empty-2", {});
    const r = await runModule(
      gcPayload(`git -C ${empty} commit -m wip`, empty, gcTranscriptWith()),
      empty,
    );
    expect(r.exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-597.3/4 (AUDIT) — gate-check's UNRESOLVABLE leg, graded in BOTH
// directions.
//
// The sibling /tdd hook turns an unresolvable target into an advisory because
// it has a staged set it can no longer classify. This hook classifies nothing
// and asks one repository-free question — "was /gate-check run in this
// session?" — so the same advisory here would be a commit bypass wearing a
// reminder. Nothing pinned that today, in either direction: porting the /tdd
// hook's advisory leg across would reopen the bypass with the whole suite
// green.
// ---------------------------------------------------------------------------

/** The unresolvable shape: a `cd` whose argument is an unexpanded shell word. */
const UNRESOLVABLE_COMMIT = 'cd "$REPO" && git commit -m x';
const UNRESOLVABLE_NON_COMMIT = 'cd "$REPO" && git status';

describe("AC-STE-597.4 — an unresolvable target does NOT excuse gate-check evidence", () => {
  test("an unresolvable commit with NO gate-check evidence → exit 2 + Refusing", async () => {
    gcRepo = await initGcRepo("gc-unresolvable", {});
    const r = await runModule(
      gcPayload(UNRESOLVABLE_COMMIT, gcRepo, gcTranscriptWithout()),
      gcRepo,
    );
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("Refusing:");
    expect(r.stderr).toContain("Remedy:");
    expect(r.stderr).toContain("Context:");
    // An advisory here would BE the bypass: this hook has no staged set whose
    // classification an unresolved repository could have spoiled.
    expect(r.stderr).not.toContain("Reminder:");
  });

  test("CONTROL — the SAME unresolvable command exits 0 when the /gate-check Skill tool_use IS present", async () => {
    // Without this, the refusal above would also hold for a hook that refused
    // every command it could not place — a different bug with the same exit
    // code.
    gcRepo = await initGcRepo("gc-unresolvable-2", {});
    const r = await runModule(
      gcPayload(UNRESOLVABLE_COMMIT, gcRepo, gcTranscriptWith()),
      gcRepo,
    );
    // STE-614 AC.9 — an exit-0 Reminder would be a silent allow: a PreToolUse
    // exit 0 surfaces no stderr at all, so the unresolved leg exits 1 instead.
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("Reminder:");
    expect(r.stderr).toContain("$REPO");
  });

  test("CONTROL — an unresolvable NON-commit is still not a commit: exit 0 and silent", async () => {
    gcRepo = await initGcRepo("gc-unresolvable-3", {});
    const r = await runModule(
      gcPayload(UNRESOLVABLE_NON_COMMIT, gcRepo, gcTranscriptWithout()),
      gcRepo,
    );
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBe("");
  });
});

// ---------------------------------------------------------------------------
// STE-597 FINAL ROUND — FINDING B, end to end: authoring a file must not be
// refused.
//
// This hook refuses on `isCommit` ALONE — `repoRoot` and `unresolved` are read
// for nothing here — so the resolver saying `true` for a heredoc body IS the
// operator-visible harm. It bit this milestone's own build twice: two agents
// had a `cat <<EOF` blocked while writing test fixtures that merely MENTION a
// commit, with no `/gate-check` evidence in the session and no commit anywhere
// in the command.
//
// The transcript used below carries NO `/gate-check` Skill tool_use — so an
// exit 0 here can only mean "this hook saw no commit", which is the thing under
// test. The control directly underneath fires the refusal from the same
// fixture, so the exit 0 is never a silent no-op.
// ---------------------------------------------------------------------------

/** A file-authoring command whose heredoc body merely MENTIONS a commit. */
const AUTHORING_HEREDOC = [
  "cat > fixture.md <<EOF",
  "run: cd /some/repo && git commit -m x",
  "EOF",
].join("\n");

describe("AC-STE-597.3 — gate-check does NOT refuse a file-authoring heredoc", () => {
  test("`cat > f <<EOF` with a commit-MENTIONING body → exit 0 and SILENT, with no gate-check evidence present", async () => {
    gcRepo = await initGcRepo("gc-heredoc", {});
    const r = await runModule(
      gcPayload(AUTHORING_HEREDOC, gcRepo, gcTranscriptWithout()),
      gcRepo,
    );
    // The harm, stated as an exit code: the shipped hook answers 2 here and
    // blocks a command that commits nothing.
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBe("");
  });

  test("the `<<-` and quoted-delimiter spellings are not refused either", async () => {
    gcRepo = await initGcRepo("gc-heredoc-2", {});
    const t = gcTranscriptWithout();
    const dash = await runModule(
      gcPayload(AUTHORING_HEREDOC.replace("<<EOF", "<<-EOF"), gcRepo, t),
      gcRepo,
    );
    const quoted = await runModule(
      gcPayload(AUTHORING_HEREDOC.replace("<<EOF", "<<'EOF'"), gcRepo, t),
      gcRepo,
    );
    expect([dash.exitCode, quoted.exitCode]).toEqual([0, 0]);
    expect(dash.stderr).toBe("");
    expect(quoted.stderr).toBe("");
  });

  test("CONTROL — the SAME fixture and SAME transcript refuse a real commit: the exit 0 above is not a dead hook", async () => {
    // Without this, every clause above would also pass against a hook that had
    // stopped enforcing altogether — which is the one outcome worse than the
    // over-refusal being fixed.
    gcRepo = await initGcRepo("gc-heredoc-3", {});
    const r = await runModule(
      gcPayload("cd /some/repo && git commit -m x", gcRepo, gcTranscriptWithout()),
      gcRepo,
    );
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("Refusing:");
  });

  test("CONTROL — a REAL commit after the heredoc terminator is still refused (the bypass stays shut)", async () => {
    // The end-to-end half of the resolver's most important control. A fix that
    // amnestied everything after a `<<` would hand anyone a one-line bypass of
    // this hook, and the whole suite would stay green without this clause.
    gcRepo = await initGcRepo("gc-heredoc-4", {});
    const r = await runModule(
      gcPayload(
        ["cat > fixture.md <<EOF", "hello", "EOF", "git commit -m x"].join("\n"),
        gcRepo,
        gcTranscriptWithout(),
      ),
      gcRepo,
    );
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("Refusing:");
  });

  test("CONTROL — a real commit after a terminator whose body ALSO mentions one is refused", async () => {
    gcRepo = await initGcRepo("gc-heredoc-5", {});
    const r = await runModule(
      gcPayload(
        [
          "cat > fixture.md <<EOF",
          "run: git commit -m fixture",
          "EOF",
          "git -C " + gcRepo + " commit -m x",
        ].join("\n"),
        gcRepo,
        gcTranscriptWithout(),
      ),
      gcRepo,
    );
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("Refusing:");
  });
});

// ---------------------------------------------------------------------------
// STE-597 Pass 2 ROUND 2 — the operator-visible harm, on this hook.
//
// This gate refuses on `isCommit` ALONE. So when the resolver failed to see a
// commit at all — which is what `git -C $(pwd) commit` produced, because the
// splitter read the substitution's `(` as a subshell opener and tore `git -C $`
// away from `commit` — this hook exited 0 in SILENCE with no `/gate-check`
// evidence anywhere in the session. A full bypass of a blocking gate, reachable
// by typing an idiom people type every day.
//
// `git -C $(git rev-parse --show-toplevel) commit` is the same bypass in the
// spelling most likely to be typed by accident.
//
// Unlike its /tdd sibling this hook has no staged set whose classification an
// unresolvable repository could have spoiled: its one question — "was
// /gate-check run in this session?" — has no repository in it. So the answer
// here is the refusal, not an advisory, exactly as the existing
// `cd "$REPO"` leg above already establishes.
// ---------------------------------------------------------------------------

describe("AC-STE-597.3 — a `$(...)` in the command does not hide the commit (RED: today this exits 0, silent)", () => {
  test("`git -C $(pwd) commit` with no /gate-check evidence → exit 2 + NFR-10 refusal", async () => {
    gcRepo = await initGcRepo("gc-subst-a", {});
    const r = await runModule(
      gcPayload("git -C $(pwd) commit -m wip", gcRepo, gcTranscriptWithout()),
      gcRepo,
    );
    // The harm as an exit code: the shipped hook answers 0 and says nothing.
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("Refusing:");
    expect(r.stderr).toContain("Remedy:");
    expect(r.stderr).toContain("Context:");
    expect(r.stderr).toMatch(/gate-check/);
    // An advisory here would BE the bypass, just quieter.
    expect(r.stderr).not.toContain("Reminder:");
  });

  test("`git -C $(git rev-parse --show-toplevel) commit` — the everyday idiom — is refused too", async () => {
    gcRepo = await initGcRepo("gc-subst-b", {});
    const r = await runModule(
      gcPayload(
        "git -C $(git rev-parse --show-toplevel) commit -m wip",
        gcRepo,
        gcTranscriptWithout(),
      ),
      gcRepo,
    );
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("Refusing:");
  });

  test("`git -c user.name=$(whoami) commit` and `git --git-dir=$(pwd)/.git commit` are refused as well", async () => {
    gcRepo = await initGcRepo("gc-subst-c", {});
    const t = gcTranscriptWithout();
    const dashC = await runModule(
      gcPayload("git -c user.name=$(whoami) commit -m wip", gcRepo, t),
      gcRepo,
    );
    const gitDir = await runModule(
      gcPayload("git --git-dir=$(pwd)/.git commit -m wip", gcRepo, t),
      gcRepo,
    );
    expect([dashC.exitCode, gitDir.exitCode]).toEqual([2, 2]);
    expect(dashC.stderr).toContain("Refusing:");
    expect(gitDir.stderr).toContain("Refusing:");
  });

  test("CONTROL — the same `$(pwd)` command exits 0 and SILENT when the /gate-check evidence IS present", async () => {
    // Without this, every refusal above would also hold for a hook that had
    // started refusing everything it could not parse — a different bug wearing
    // the same exit code. Meaningful only as the pair of the clauses above,
    // which is how it is written.
    gcRepo = await initGcRepo("gc-subst-d", {});
    const r = await runModule(
      gcPayload("git -C $(pwd) commit -m wip", gcRepo, gcTranscriptWith()),
      gcRepo,
    );
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBe("");
  });

  test("CONTROL — `git -C $(pwd) status` is not a commit: exit 0 and SILENT with no evidence", async () => {
    // The fix must recognise the COMMIT inside the substitution-bearing word,
    // not simply refuse every command containing a `$(`.
    gcRepo = await initGcRepo("gc-subst-e", {});
    const r = await runModule(
      gcPayload("git -C $(pwd) status", gcRepo, gcTranscriptWithout()),
      gcRepo,
    );
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBe("");
  });

  test("CONTROL — a heredoc body that MENTIONS a `$(...)` commit is still not refused", async () => {
    // The over-refusal mirror, carried forward from the previous round: the
    // substitution reader runs inside the same splitter the heredoc reader
    // does, so a change to one can break the other.
    gcRepo = await initGcRepo("gc-subst-f", {});
    const r = await runModule(
      gcPayload(
        ["cat > fixture.md <<EOF", "run: git -C $(pwd) commit -m x", "EOF"].join("\n"),
        gcRepo,
        gcTranscriptWithout(),
      ),
      gcRepo,
    );
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBe("");
  });
});

// ---------------------------------------------------------------- STE-614.13
//
// The receipt is load-bearing IN THE SUITE THAT OWNS THE CASE: an
// "evidence present, proceeds" case on a toolkit-managed checkout now carries a
// front-door-written receipt, and its sibling with that receipt removed exits 2.

import {
  clearReceipts as clearReceipts614,
  writeGateReceipt as writeGateReceipt614,
  writeManagedClaudeMd as writeManagedClaudeMd614,
  announcementRecords as announcementRecords614,
  mintedAnnouncements as mintedAnnouncements614
} from "./_gate_receipt_fixture";

const SID_614 = "s1"; // the session id `gcPayload` puts in every payload

async function managedGcRepo(name: string): Promise<string> {
  const dir = join(tmpRoot, name);
  mkdirSync(dir, { recursive: true });
  await Bun.spawn(["git", "init", "-q", dir], { stdout: "pipe", stderr: "pipe" }).exited;
  writeFileSync(join(dir, "package.json"), '{"name":"fixture","version":"0.0.0","private":true}\n');
  writeManagedClaudeMd614(dir);
  return dir;
}

/** A gate-check Skill tool_use with a timestamp, so it can vouch for a receipt. */
function gcTranscriptWithVouching(): string {
  return writeTranscript([
    {
      type: "assistant",
      timestamp: new Date(Date.now() - 3_600_000).toISOString(),
      message: {
        content: [
          {
            type: "tool_use",
            id: "tu1",
            name: "Skill",
            input: { skill: "dev-process-toolkit:gate-check" },
          },
        ],
      },
    },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tu1", is_error: false }] } },
    ...announcementRecords614(mintedAnnouncements614()).map((l) => JSON.parse(l) as unknown),
  ]);
}

describe("AC-STE-614.13 — the receipt is load-bearing in this suite's proceeds case", () => {
  test("evidence present AND a front-door-written receipt → exit 0, silent", async () => {
    const repo = await managedGcRepo("gc-614-permit");
    writeGateReceipt614(repo, "gate-check", SID_614);
    const r = await runModule(
      gcPayload(`git -C ${repo} commit -m x`, repo, gcTranscriptWithVouching()),
      repo,
    );
    expect({ code: r.exitCode, err: r.stderr }).toEqual({ code: 0, err: "" });
  });

  test("SIBLING — the SAME case with the receipt REMOVED exits 2", async () => {
    const repo = await managedGcRepo("gc-614-forbid");
    writeGateReceipt614(repo, "gate-check", SID_614);
    clearReceipts614(repo, SID_614);
    const r = await runModule(
      gcPayload(`git -C ${repo} commit -m x`, repo, gcTranscriptWithVouching()),
      repo,
    );
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("Refusing:");
  });
});
