// Shared fixture for STE-733 (M_b2fdc0) — the spec-only commit carve-out of
// `pre-commit-gate-check`, and the spec-review relay of `pre-pr-spec-review`.
//
// Leading underscore: a helper module, never collected as a suite. Consumers:
//   tests/m_b2fdc0-ste-733-spec-only-commit.test.ts
//   tests/m_b2fdc0-ste-733-pr-relay.test.ts
//   tests/m_b2fdc0-ste-733-v330-refusals.test.ts
//   tests/m_b2fdc0-ste-733-mutation.test.ts
//
// Every leg takes a `pluginRoot`, so the mutation battery (AC-STE-733.7) and
// the v3.3.0 measurement (AC-STE-733.8) drive the very same legs against a
// mutated copy, or the pre-change tree, of the plugin. Every leg runs the
// SHIPPED `.sh` wrapper (AC-STE-733.6) with a PreToolUse payload on stdin over
// synthetic transcripts, receipts and git checkouts with a local bare remote.
//
// Interfaces under test (from the FR, not from an implementation):
//   commit carve-out (AC .1): a plain `git commit`, placed in exactly one
//     checkout, tracked working tree == index, every staged path `isSpecPath`
//     → exit 0 with no gate-check evidence.
//   relay (AC .3): the opening session S0 has no spec-review evidence; a
//     receipt R in the target checkout sits in ANOTHER session S's store, R
//     parses, R.evidence.head == HEAD == the remote branch head; S's transcript
//     is `<S>.jsonl` one directory level below the projects root holding S0's
//     transcript; it holds a `Skill` tool_use of dev-process-toolkit:spec-review
//     followed by the result of a `gate_receipt.ts` front-door run announcing
//     R's path with a digest equal to R's current bytes; the tracked tree is
//     clean → exit 0.
//
// Synthetic identities only: session ids s-733-*, FR FX-1, milestone M_fx0001,
// an example.invalid committer.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import {
  applyArchiveMove,
  FR_ACTIVE_PATH,
  FR_ARCHIVE_PATH,
  frArchivedText,
  frText,
  git,
  makeArchiveRepo,
  PLAN_ACTIVE_PATH,
  planText,
  writeAt,
} from "./_archive_only_fixture";

export const PLUGIN_ROOT = join(import.meta.dir, "..");
export const SELF = "s-733-self";
export const OWNER = "s-733-owner";
export const THIRD = "s-733-third";
export const SPEC_REVIEW = "dev-process-toolkit:spec-review";
export const GATE_CHECK = "dev-process-toolkit:gate-check";
const COMMIT_SH = join("templates", "hooks", "process", "pre-commit-gate-check.sh");
const PR_SH = join("templates", "hooks", "process", "pre-pr-spec-review.sh");
/** The current tree's front door: receipts are minted here, whatever tree the hook runs from. */
const FRONT_DOOR = join(PLUGIN_ROOT, "adapters", "_shared", "src", "gate_receipt.ts");
/** How a real session spells the front-door run (the gate skills' own line). */
const FRONT_DOOR_CMD = (skill: string): string =>
  `bun run "\${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/gate_receipt.ts" ${skill} .`;

// ------------------------------------------------------------------ cleanup

const tempDirs: string[] = [];
export function tempDir(label: string): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), `dpt-733-${label}-`)));
  tempDirs.push(d);
  return d;
}
export function cleanupTemps(): void {
  for (const d of tempDirs.splice(0)) {
    // An unreadable-transcript leg leaves a 000 file behind.
    spawnSync("chmod", ["-R", "u+rwx", d]);
    rmSync(d, { recursive: true, force: true });
  }
}

// ------------------------------------------------------------------ runner

export interface HookRun {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export function show(r: HookRun): string {
  return `exit=${r.exitCode}\n--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}`;
}

function hookEnv(pluginRoot: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  delete env.CLAUDE_PROJECT_DIR;
  delete env.CLAUDE_CODE_SESSION_ID;
  env.CLAUDE_PLUGIN_ROOT = pluginRoot;
  return env;
}

/** Drive one shipped wrapper the way the harness does. */
export async function runHook(
  pluginRoot: string,
  which: "commit" | "pr",
  cwd: string,
  command: string,
  transcriptPath: string,
  sessionId = SELF,
): Promise<HookRun> {
  const payload = JSON.stringify({
    session_id: sessionId,
    transcript_path: transcriptPath,
    cwd,
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command },
  });
  const proc = Bun.spawn(["/bin/bash", join(pluginRoot, which === "commit" ? COMMIT_SH : PR_SH)], {
    cwd,
    env: hookEnv(pluginRoot),
    stdin: new Response(payload).body,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { exitCode: await proc.exited, stdout, stderr };
}

/** null when `r` is a permit (exit 0, no refusal), else why not. */
export function permitProblem(r: HookRun): string | null {
  if (r.exitCode === 0 && !r.stderr.includes("Refusing:")) return null;
  return `expected a permit (exit 0, no Refusing:), got exit ${r.exitCode}`;
}

/** null when `r` refuses naming `skill` (exit 2, NFR-10 Refusing:), else why not. */
export function refusalProblem(r: HookRun, skill: string): string | null {
  if (r.exitCode === 2 && r.stderr.includes("Refusing:") && r.stderr.includes(skill)) return null;
  return `expected a refusal (exit 2, Refusing:, naming ${skill}), got exit ${r.exitCode}`;
}

// --------------------------------------------------------------- transcripts

let stamp = Date.now() - 3_600_000;
/** Monotonic ISO stamps, an hour back, so record order and time order agree. */
function nextStamp(): string {
  stamp += 1_000;
  return new Date(stamp).toISOString();
}

/** A session transcript carrying no Skill call at all — no evidence of any kind. */
export function bareTranscriptRecords(): string[] {
  return [
    JSON.stringify({
      type: "assistant",
      timestamp: nextStamp(),
      message: { content: [{ type: "tool_use", id: "toolu_ls", name: "Bash", input: { command: "ls" } }] },
    }),
    JSON.stringify({
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "toolu_ls", is_error: false, content: "README.md" }] },
    }),
  ];
}

function skillCallRecord(skill: string, id: string): string {
  return JSON.stringify({
    type: "assistant",
    timestamp: nextStamp(),
    message: { content: [{ type: "tool_use", id, name: "Skill", input: { skill } }] },
  });
}

/** How the announcement line reaches the owner's transcript. */
export type Carrier = "front-door" | "echo" | "read" | "typed" | "none";

function announcementRecordsVia(carrier: Carrier, line: string, skill: string): string[] {
  // "none": nothing in the transcript announces R — no gate_receipt.ts result names it.
  if (carrier === "none") return [];
  const id = `toolu_mint_${carrier}`;
  if (carrier === "typed") {
    return [
      JSON.stringify({
        type: "assistant",
        timestamp: nextStamp(),
        message: { content: [{ type: "text", text: `The review is done.\n${line}` }] },
      }),
    ];
  }
  const use =
    carrier === "front-door"
      ? { type: "tool_use", id, name: "Bash", input: { command: FRONT_DOOR_CMD(skill) } }
      : carrier === "echo"
        ? { type: "tool_use", id, name: "Bash", input: { command: `echo '${line}'` } }
        : { type: "tool_use", id, name: "Read", input: { file_path: "/fixture/notes.txt" } };
  return [
    JSON.stringify({ type: "assistant", timestamp: nextStamp(), message: { content: [use] } }),
    JSON.stringify({
      type: "user",
      timestamp: nextStamp(),
      message: { content: [{ type: "tool_result", tool_use_id: id, is_error: false, content: line }] },
    }),
  ];
}

// ------------------------------------------------------------------- remotes

function makeBare(path: string): string {
  mkdirSync(path, { recursive: true });
  git(path, "init", "-q", "--bare", "-b", "main");
  return path;
}

/** A real `file://` origin whose default branch is main, fetched and set as origin/HEAD. */
function addOrigin(repo: string): string {
  const bare = makeBare(`${repo}.remote.git`);
  git(repo, "remote", "add", "origin", `file://${bare}`);
  git(repo, "push", "-q", "origin", "main");
  git(repo, "fetch", "-q", "origin");
  git(repo, "remote", "set-head", "origin", "main");
  return bare;
}

let codeEdits = 0;
function commitCode(repo: string, message: string): void {
  codeEdits += 1;
  writeAt(repo, "src/app.ts", `export const app = ${100 + codeEdits};\n`);
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", message);
}

// ------------------------------------------------------------------- minting

export interface Mint {
  path: string;
  digest: string;
  line: string;
}

/** Mint a gate receipt through the SHIPPED front door, as `session`. */
export function mintReceipt(repo: string, skill: "spec-review" | "gate-check", session: string): Mint {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  delete env.CLAUDE_PROJECT_DIR;
  env.CLAUDE_CODE_SESSION_ID = session;
  const p = spawnSync("bun", ["run", FRONT_DOOR, skill, repo], { env, encoding: "utf-8" });
  if (p.status !== 0) throw new Error(`front door failed (exit ${p.status}): ${p.stderr}`);
  const line = (p.stdout ?? "").split("\n").find((l) => l.startsWith("dpt-receipt: "));
  if (!line) throw new Error(`front door printed no dpt-receipt line:\n${p.stdout}`);
  const m = /^dpt-receipt:\s+(\/\S+)\s+sha256:([0-9a-f]{64})\s*$/.exec(line.trim());
  if (!m) throw new Error(`unreadable announcement: ${line}`);
  return { path: m[1]!, digest: m[2]!, line: line.trim() };
}

export const sha256 = (bytes: string | Buffer): string => createHash("sha256").update(bytes).digest("hex");
const announce = (path: string, digest: string): string => `dpt-receipt: ${path} sha256:${digest}`;

// --------------------------------------------------------------- relay world

/**
 * The ONE fact a relay twin changes. The permit world (`{}`) changes none:
 * every condition of AC-STE-733.3 holds.
 */
export interface RelayOpts {
  /** Which Skill call the owner transcript holds before the announcement (default spec-review). */
  ownerSkill?: "spec-review" | "gate-check" | "none" | "after";
  /** Which gate the receipt R records (default spec-review). */
  receiptSkill?: "spec-review" | "gate-check";
  /** What carries the announcement line (default the front-door run). */
  carrier?: Carrier;
  /** The digest rule (default: the announced digest equals R's current bytes). */
  digest?: "match" | "announced-wrong" | "rewritten";
  /** R's bytes do not parse (announced with the digest of those bytes). */
  unparseable?: boolean;
  /** HEAD equalities (default all equal). */
  head?: "equal" | "evidence-behind" | "remote-behind";
  /** Where S's transcript is (default `<projects>/<slug>/<S>.jsonl`). */
  transcript?: "present" | "missing" | "unreadable" | "escape-dir" | "escape-file" | "two-deep";
  /** Where R is stored (default the owner's store in the target checkout). */
  store?: "owner" | "third" | "outside-store" | "other-checkout";
  /** An unstaged edit to a tracked file. */
  dirty?: boolean;
  /** A STAGED (not committed) edit to a tracked file: the working tree matches the index, the index does not match HEAD. */
  staged?: boolean;
}

export interface RelayWorld {
  repo: string;
  projects: string;
  selfTranscript: string;
  ownerTranscript: string;
  receipt: string;
}

export function makeRelayWorld(o: RelayOpts = {}): RelayWorld {
  const root = tempDir("relay");
  const repo = makeArchiveRepo(join(root, "repo"));
  addOrigin(repo);
  git(repo, "checkout", "-q", "-b", "feature/x");
  // A code commit, so the archive-only pass never applies: only the relay can permit.
  commitCode(repo, "feat: the reviewed change");
  git(repo, "push", "-q", "-u", "origin", "feature/x");
  if (o.head === "remote-behind") commitCode(repo, "feat: a commit the remote never saw");

  // --- R
  const receiptSkill = o.receiptSkill ?? "spec-review";
  let mint: Mint;
  if (o.store === "other-checkout") {
    const other = makeArchiveRepo(join(root, "other"));
    mint = mintReceipt(other, receiptSkill, OWNER);
  } else {
    mint = mintReceipt(repo, receiptSkill, o.store === "third" ? THIRD : OWNER);
  }
  let receipt = mint.path;
  if (o.store === "outside-store") {
    // Same checkout, same bytes, but in no session's receipt store.
    const moved = join(repo, ".dpt", "ledger", "stray", basename(receipt));
    mkdirSync(dirname(moved), { recursive: true });
    renameSync(receipt, moved);
    receipt = moved;
  }
  if (o.unparseable) writeFileSync(receipt, "{ this receipt does not parse");
  let digest = sha256(readFileSync(receipt));
  if (o.digest === "announced-wrong") digest = sha256("bytes the front door never wrote");
  const line = announce(receipt, digest);
  if (o.digest === "rewritten") writeFileSync(receipt, readFileSync(receipt, "utf-8") + "\n");

  if (o.head === "evidence-behind") {
    commitCode(repo, "feat: a commit the review never saw");
    git(repo, "push", "-q", "origin", "feature/x");
  }
  if (o.dirty) writeAt(repo, "src/app.ts", "export const app = -1;\n");
  if (o.staged) {
    writeAt(repo, "src/app.ts", "export const app = -2;\n");
    git(repo, "add", "src/app.ts");
  }

  // --- transcripts
  const projects = join(root, "projects");
  const selfTranscript = join(projects, "-fx-self-slug", `${SELF}.jsonl`);
  writeAt(projects, join("-fx-self-slug", `${SELF}.jsonl`), bareTranscriptRecords().join("\n") + "\n");

  const ownerSkill = o.ownerSkill ?? "spec-review";
  const records: string[] = [...bareTranscriptRecords()];
  if (ownerSkill === "spec-review") records.push(skillCallRecord(SPEC_REVIEW, "toolu_skill_review"));
  if (ownerSkill === "gate-check") records.push(skillCallRecord(GATE_CHECK, "toolu_skill_gate"));
  records.push(...announcementRecordsVia(o.carrier ?? "front-door", line, receiptSkill));
  if (ownerSkill === "after") records.push(skillCallRecord(SPEC_REVIEW, "toolu_skill_review_late"));
  const ownerText = records.join("\n") + "\n";

  // The transcript is always the OWNER's, whichever store R sits in.
  const ownerSession = OWNER;
  const slug = "-fx-owner-slug";
  let ownerTranscript = join(projects, slug, `${ownerSession}.jsonl`);
  switch (o.transcript ?? "present") {
    case "present":
      writeAt(projects, join(slug, `${ownerSession}.jsonl`), ownerText);
      break;
    case "missing":
      mkdirSync(join(projects, slug), { recursive: true });
      break;
    case "unreadable":
      writeAt(projects, join(slug, `${ownerSession}.jsonl`), ownerText);
      chmodSync(ownerTranscript, 0o000);
      break;
    case "escape-dir": {
      // The slug directory is a symlink to a directory outside the projects root.
      const outside = join(root, "outside", slug);
      writeAt(outside, `${ownerSession}.jsonl`, ownerText);
      symlinkSync(outside, join(projects, slug));
      break;
    }
    case "escape-file": {
      // The transcript file itself is a symlink to a file outside the projects root.
      const outside = join(root, "outside", `${ownerSession}.jsonl`);
      writeAt(root, join("outside", `${ownerSession}.jsonl`), ownerText);
      mkdirSync(join(projects, slug), { recursive: true });
      symlinkSync(outside, ownerTranscript);
      break;
    }
    case "two-deep":
      ownerTranscript = join(projects, slug, "nested", `${ownerSession}.jsonl`);
      writeAt(projects, join(slug, "nested", `${ownerSession}.jsonl`), ownerText);
      break;
  }
  if (!existsSync(selfTranscript)) throw new Error("fixture: the self transcript must exist");
  return { repo, projects, selfTranscript, ownerTranscript, receipt };
}

export const PR_CMD = "gh pr create --title t --body b";

export function runRelay(pluginRoot: string, w: RelayWorld, command = PR_CMD): Promise<HookRun> {
  return runHook(pluginRoot, "pr", w.repo, command, w.selfTranscript, SELF);
}

// --------------------------------------------------------------- commit world

/** The ONE fact a spec-only commit twin changes; `{}` is the permit world. */
export interface CommitOpts {
  /** Also stage a path outside SPEC_PATTERNS: `src` (code) or `specs-other` (under specs/ but unmatched). */
  extraPath?: "src" | "specs-other";
  /** An unstaged edit to a tracked file. */
  dirty?: boolean;
  /** Nothing staged at all. */
  empty?: boolean;
}

export interface CommitWorld {
  repo: string;
  transcript: string;
}

/** A checkout with an edit to an ACTIVE FR (not an archive move) staged alone. */
export function makeSpecOnlyWorld(o: CommitOpts = {}, dir?: string): CommitWorld {
  const root = dir ?? tempDir("commit");
  const repo = makeArchiveRepo(join(root, "repo"));
  if (!o.empty) {
    writeAt(repo, FR_ACTIVE_PATH, frText({ summary: ["The summary was rewritten while writing the spec."] }));
    writeAt(repo, PLAN_ACTIVE_PATH, planText({ tasks: ["- [ ] task one: a reworded task"] }));
  }
  if (o.extraPath === "src") writeAt(repo, "src/app.ts", "export const app = 2;\n");
  if (o.extraPath === "specs-other") writeAt(repo, "specs/notes/scratch.md", "# Scratch\n");
  git(repo, "add", "-A");
  if (o.dirty) writeAt(repo, "src/app.ts", "export const app = 3;\n");
  const transcript = join(root, "transcript.jsonl");
  writeFileSync(transcript, bareTranscriptRecords().join("\n") + "\n");
  return { repo, transcript };
}

/** AC-STE-733.2 — an archived FR's Notes edited, staged alone. */
export function makeArchivedNotesWorld(): CommitWorld {
  const root = tempDir("archived-notes");
  const repo = makeArchiveRepo(join(root, "repo"));
  applyArchiveMove(repo);
  git(repo, "commit", "-q", "-m", "chore(specs): archive FX-1");
  const archived = frArchivedText();
  const edited = archived.replace("Origin: a synthetic fixture.", "Origin: a synthetic fixture.\n\nA follow-up note added after the archive.");
  if (edited === archived) throw new Error("fixture: the Notes anchor moved");
  writeAt(repo, FR_ARCHIVE_PATH, edited);
  git(repo, "add", "-A");
  const transcript = join(root, "transcript.jsonl");
  writeFileSync(transcript, bareTranscriptRecords().join("\n") + "\n");
  return { repo, transcript };
}

/** Leave an UNTRACKED code file in the checkout: the staged set and the tracked tree are unchanged. */
function withUntrackedSource(w: CommitWorld): CommitWorld {
  writeAt(w.repo, "src/new.ts", "export const fresh = 1;\n");
  return w;
}

/**
 * Build an alternate index beside the checkout (outside it) holding HEAD plus a
 * staged code path. The default index and the working tree are untouched, so
 * the world itself is the spec-only permit world. Returns the absolute path.
 */
function altIndexWithCode(w: CommitWorld): string {
  const alt = join(dirname(w.repo), "alt.index");
  const env = { ...process.env, GIT_INDEX_FILE: alt };
  const blob = spawnSync("git", ["hash-object", "-w", "--stdin"], { cwd: w.repo, env, input: "export const hidden = 1;\n", encoding: "utf-8" });
  if (blob.status !== 0) throw new Error(`fixture: hash-object failed: ${blob.stderr}`);
  for (const args of [
    ["read-tree", "HEAD"],
    ["update-index", "--add", "--cacheinfo", `100644,${blob.stdout.trim()},src/hidden.ts`],
  ]) {
    const r = spawnSync("git", args, { cwd: w.repo, env, encoding: "utf-8" });
    if (r.status !== 0) throw new Error(`fixture: git ${args.join(" ")} failed: ${r.stderr}`);
  }
  return alt;
}

export const COMMIT_CMD = 'git commit -m "docs(specs): reword FX-1"';

export function runCommit(pluginRoot: string, w: CommitWorld, command = COMMIT_CMD): Promise<HookRun> {
  return runHook(pluginRoot, "commit", w.repo, command, w.transcript, SELF);
}

// ---------------------------------------------------------------------- legs

export interface Leg {
  /** `<family> PERMIT — …` or `<family> TWIN (<condition>) — …`. */
  name: string;
  family: "commit" | "pr";
  expect: "permit" | "refuse";
  /** null when the leg holds on `pluginRoot`, else why it does not. */
  check(pluginRoot: string): Promise<string | null>;
}

function leg(
  name: string,
  family: "commit" | "pr",
  expectation: "permit" | "refuse",
  run: (pluginRoot: string) => Promise<HookRun>,
): Leg {
  const skill = family === "commit" ? GATE_CHECK : SPEC_REVIEW;
  return {
    name,
    family,
    expect: expectation,
    check: async (pluginRoot) => {
      const r = await run(pluginRoot);
      const p = expectation === "permit" ? permitProblem(r) : refusalProblem(r, skill);
      return p === null ? null : `${p}\n${show(r)}`;
    },
  };
}

/** AC-STE-733.1 / .2 / .6 — the commit carve-out: the permit, and one twin per condition. */
export function commitLegs(): Leg[] {
  const c = (name: string, expectation: "permit" | "refuse", world: () => CommitWorld, command?: string | ((w: CommitWorld) => string)) =>
    leg(name, "commit", expectation, (root) => {
      const w = world();
      return runCommit(root, w, typeof command === "function" ? command(w) : command);
    });
  return [
    c("commit PERMIT — an active FR and plan edit staged alone, plain `git commit`", "permit", () => makeSpecOnlyWorld()),
    c("commit PERMIT — the same staged set, `git -C <checkout> commit`", "permit", () => makeSpecOnlyWorld(), (w) => `git -C ${w.repo} commit -m "docs(specs): reword"`),
    c("commit PERMIT — an archived FR's Notes edited, staged alone (AC-STE-733.2)", "permit", () => makeArchivedNotesWorld()),
    c("commit TWIN (path) — a source file staged beside the spec edit", "refuse", () => makeSpecOnlyWorld({ extraPath: "src" })),
    c("commit TWIN (path) — a file under specs/ that SPEC_PATTERNS does not match", "refuse", () => makeSpecOnlyWorld({ extraPath: "specs-other" })),
    c("commit TWIN (nothing staged) — an empty staged set", "refuse", () => makeSpecOnlyWorld({ empty: true })),
    c("commit TWIN (clean tree) — an unstaged edit to a tracked file", "refuse", () => makeSpecOnlyWorld({ dirty: true })),
    c("commit TWIN (-a) — `git commit -a` over the same clean tree", "refuse", () => makeSpecOnlyWorld(), 'git commit -a -m "docs(specs): reword"'),
    c("commit TWIN (pathspec) — `git commit -m x <spec path>`", "refuse", () => makeSpecOnlyWorld(), `git commit -m "docs(specs): reword" ${FR_ACTIVE_PATH}`),
    c("commit TWIN (--amend) — `git commit --amend`", "refuse", () => makeSpecOnlyWorld(), 'git commit --amend -m "docs(specs): reword"'),
    c("commit TWIN (unplaced) — `git --git-dir=.git commit`", "refuse", () => makeSpecOnlyWorld(), 'git --git-dir=.git commit -m "docs(specs): reword"'),
    // AC-STE-733.1 "a plain `git commit`": the hook grades the staged set as it
    // stands BEFORE the command runs, so a command that stages, writes, or
    // points git at another index in the same breath is not plain. Each twin
    // below runs over a world the plain command permits (the PERMIT beside it
    // is the control), and differs from it only in the command.
    c("commit PERMIT — an untracked src/new.ts sits beside the staged spec edit, plain `git commit`", "permit", () => withUntrackedSource(makeSpecOnlyWorld())),
    c("commit TWIN (plain) — `git add src/new.ts && git commit` stages a code file in the same command", "refuse", () => withUntrackedSource(makeSpecOnlyWorld()), 'git add src/new.ts && git commit -m "docs(specs): reword"'),
    c("commit TWIN (plain) — the command writes a code file, stages it, then commits", "refuse", () => makeSpecOnlyWorld(), `echo 'export const late = 1;' > src/new.ts && git add -A && git commit -m "docs(specs): reword"`),
    c("commit TWIN (plain) — the command rewrites a tracked code file, `git add -u`, then commits", "refuse", () => makeSpecOnlyWorld(), `echo 'export const app = 7;' > src/app.ts && git add -u && git commit -m "docs(specs): reword"`),
    c("commit TWIN (plain) — `GIT_INDEX_FILE=<alt> git commit` over an index holding a code path", "refuse", () => makeSpecOnlyWorld(), (w) => `GIT_INDEX_FILE=${altIndexWithCode(w)} git commit -m "docs(specs): reword"`),
    // Review L2: a global `-c` / `--config-env` lets the commit command itself
    // repoint git (a hooks directory whose pre-commit restages code after the
    // pass read the index, another work tree), so it is never plain.
    c("commit TWIN (plain) — `git -c core.hooksPath=<dir> commit` points the commit at another hooks directory", "refuse", () => makeSpecOnlyWorld(), (w) => `git -c core.hooksPath=${join(dirname(w.repo), "hooks")} commit -m "docs(specs): reword"`),
    c("commit TWIN (plain) — `git -c core.worktree=<dir> commit` points the commit at another work tree", "refuse", () => makeSpecOnlyWorld(), (w) => `git -c core.worktree=${dirname(w.repo)} commit -m "docs(specs): reword"`),
    c("commit TWIN (plain) — `git --config-env=core.hooksPath=VAR commit` sets a config key from the environment", "refuse", () => makeSpecOnlyWorld(), 'git --config-env=core.hooksPath=DPT_FX_HOOKS commit -m "docs(specs): reword"'),
    leg("commit TWIN (one checkout) — the same spec-only commit in two checkouts at once", "commit", "refuse", (root) => {
      const parent = tempDir("two");
      const a = makeSpecOnlyWorld({}, join(parent, "a"));
      const b = makeSpecOnlyWorld({}, join(parent, "b"));
      return runCommit(root, a, `git -C ${a.repo} commit -m "x" && git -C ${b.repo} commit -m "y"`);
    }),
  ];
}

/** AC-STE-733.3 / .4 / .6 — the relay: the permit, and one twin per condition. */
export function relayLegs(): Leg[] {
  const r = (name: string, expectation: "permit" | "refuse", opts: RelayOpts, command?: string) =>
    leg(name, "pr", expectation, (root) => runRelay(root, makeRelayWorld(opts), command));
  return [
    r("pr PERMIT — the owner's announced spec-review receipt vouches for HEAD", "permit", {}),
    // R is a spec-review gate receipt stored under another session S's store, in the target checkout.
    r("pr TWIN (store) — R is a gate-check receipt, not spec-review", "refuse", { receiptSkill: "gate-check" }),
    r("pr TWIN (store) — R sits in a third session's store, announced only by S", "refuse", { store: "third" }),
    r("pr TWIN (store) — R sits outside every receipt store", "refuse", { store: "outside-store" }),
    r("pr TWIN (store) — R sits in another checkout", "refuse", { store: "other-checkout" }),
    // R parses.
    r("pr TWIN (parse) — R does not parse", "refuse", { unparseable: true }),
    // evidence.head == HEAD == remote head.
    r("pr TWIN (head) — R.evidence.head is behind HEAD (HEAD equals the remote)", "refuse", { head: "evidence-behind" }),
    r("pr TWIN (head) — the remote branch head is behind HEAD (R.evidence.head equals HEAD)", "refuse", { head: "remote-behind" }),
    // S's transcript is <S>.jsonl one level below the projects root.
    r("pr TWIN (transcript) — S's transcript is missing", "refuse", { transcript: "missing" }),
    r("pr TWIN (transcript) — S's transcript is unreadable", "refuse", { transcript: "unreadable" }),
    r("pr TWIN (transcript) — S's transcript sits two levels below the projects root", "refuse", { transcript: "two-deep" }),
    r("pr TWIN (projects root) — S's slug directory is a symlink out of the projects root", "refuse", { transcript: "escape-dir" }),
    r("pr TWIN (projects root) — S's transcript file is a symlink out of the projects root", "refuse", { transcript: "escape-file" }),
    // A Skill tool_use of spec-review, followed by the front-door result.
    r("pr TWIN (skill call) — no Skill call at all before the announcement", "refuse", { ownerSkill: "none" }),
    r("pr TWIN (skill call) — the spec-review Skill call comes after the announcement", "refuse", { ownerSkill: "after" }),
    r("pr TWIN (skill call) — the Skill call before it is gate-check", "refuse", { ownerSkill: "gate-check" }),
    // The announcement is a front-door run's result.
    r("pr TWIN (front door) — the announcement is an echo's output", "refuse", { carrier: "echo" }),
    r("pr TWIN (front door) — the announcement is a Read result", "refuse", { carrier: "read" }),
    r("pr TWIN (front door) — the announcement is a typed line", "refuse", { carrier: "typed" }),
    r("pr TWIN (front door) — the spec-review Skill call is there but nothing announces R", "refuse", { carrier: "none" }),
    // The digest equals R's current bytes.
    r("pr TWIN (digest) — the announced digest is not R's", "refuse", { digest: "announced-wrong" }),
    r("pr TWIN (digest) — R was rewritten after it was announced", "refuse", { digest: "rewritten" }),
    // The tracked working tree is clean.
    r("pr TWIN (clean tree) — an unstaged edit to a tracked file", "refuse", { dirty: true }),
    r("pr TWIN (clean tree) — a staged, uncommitted change to a tracked file", "refuse", { staged: true }),
  ];
}

/** AC-STE-733.8 — refusals outside both carve-outs that v3.3.0 made and HEAD must keep making. */
export function unchangedRefusalLegs(): Leg[] {
  return [
    leg("commit KEPT — a code-only commit with no evidence", "commit", "refuse", (root) => {
      const w = makeSpecOnlyWorld({ empty: true });
      writeAt(w.repo, "src/app.ts", "export const app = 9;\n");
      git(w.repo, "add", "-A");
      return runCommit(root, w, 'git commit -m "feat: code"');
    }),
    leg("commit KEPT — `git merge` in a spec-only checkout", "commit", "refuse", (root) => {
      const w = makeSpecOnlyWorld();
      return runCommit(root, w, "git merge --no-ff -m m main");
    }),
    leg("pr KEPT — a code branch, no evidence and no owner transcript", "pr", "refuse", (root) => {
      const w = makeRelayWorld({ transcript: "missing", store: "outside-store" });
      return runRelay(root, w);
    }),
    leg("pr KEPT — the relay world, but the request names a foreign repository", "pr", "refuse", (root) => {
      const w = makeRelayWorld();
      return runRelay(root, w, "gh -R org/elsewhere pr create --title t --body b");
    }),
  ];
}
