// STE-720 (M_d1b4b7) — shared fixture for the identifier-redaction suites.
//
// Every id here is synthetic: the user name is `fixture-user` (plus the two
// spellings AC-STE-720.2 names, `fixture.user` and `fixtureuser`), every UUID
// is `00000000-0000-4000-8000-00000000000N`, and every branch is a
// `feat/...-fixture` name. Temp trees live under the OS temp dir, never in the
// repo.
//
// The modules under test (`scrub_identifiers.ts`, `report_issue_payload.ts`)
// are loaded through dynamic imports so a missing module reds each test on its
// own instead of failing the whole file at load.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const PLUGIN_ROOT = resolve(import.meta.dir, "..");
export const REPO_ROOT = resolve(PLUGIN_ROOT, "..", "..");
export const SRC = join(PLUGIN_ROOT, "adapters", "_shared", "src");
export const SCRUB_IDENTIFIERS = join(SRC, "scrub_identifiers.ts");
export const FRONT_DOOR = join(SRC, "report_issue_payload.ts");
export const SKILL_REL = "skills/report-issue/SKILL.md";
export const SKILL_PATH = join(PLUGIN_ROOT, SKILL_REL);

/** Trunk before this FR (the merge of PR #131). */
export const TRUNK_SHA = "effc0981";
/** The v3.0.0 merge commit. */
export const V300_SHA = "9dab5086";

export const USER = "fixture-user";
export const BRANCH = "feat/fixture-branch";
export const OTHER_BRANCH = "feat/other-fixture";
export const REMOTE_ONLY_BRANCH = "feat/remote-fixture";
export const DEFAULT_BRANCHES = ["main", "master", "develop", "trunk", "HEAD"] as const;
export const IDENTIFIER_KEYS = ["home_path", "session_id", "branch_name"] as const;
export const FLAGS = ["--redact-identifiers", "--from-retro"] as const;
export const UUID_RE = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;

export type AnyMod = Record<string, any>;

export async function idMod(): Promise<AnyMod> {
  return (await import("../adapters/_shared/src/scrub_identifiers")) as AnyMod;
}
export async function payloadMod(): Promise<AnyMod> {
  return (await import("../adapters/_shared/src/report_issue_payload")) as AnyMod;
}
export async function aliasMod(): Promise<AnyMod> {
  return (await import("../adapters/_shared/src/session_aliases")) as AnyMod;
}
export async function secretsMod(): Promise<AnyMod> {
  return (await import("../adapters/_shared/src/scrub_secrets")) as AnyMod;
}

/** The synthetic UUID number `n` (AC-STE-720.10 form for n = 1..9). */
export function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

/** `branch-<first 8 hex of sha256(name)>`. */
export function branchAlias(name: string): string {
  return `branch-${createHash("sha256").update(name).digest("hex").slice(0, 8)}`;
}

/** The counts of a ScrubResult as a key -> count record. */
export function counts(matches: { pattern: string; count: number }[]): Record<string, number> {
  return Object.fromEntries(matches.map((m) => [m.pattern, m.count]));
}

// ---------------------------------------------------------------- temp trees

const TEMPS: string[] = [];

export function tempDir(label: string): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), `md1b4b7-720-${label}-`)));
  TEMPS.push(d);
  return d;
}

export function cleanupTemps(): void {
  for (const d of TEMPS.splice(0)) rmSync(d, { recursive: true, force: true });
}

export const GIT_ENV: Record<string, string> = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_AUTHOR_NAME: "F",
  GIT_AUTHOR_EMAIL: "f@example.invalid",
  GIT_COMMITTER_NAME: "F",
  GIT_COMMITTER_EMAIL: "f@example.invalid",
};

export function git(cwd: string, ...args: string[]): string {
  const p = spawnSync("git", args, { cwd, encoding: "utf-8", env: { ...process.env, ...GIT_ENV } });
  if (p.status !== 0) throw new Error(`git ${args.join(" ")}: ${p.stderr}`);
  return p.stdout ?? "";
}

export interface RepoOpts {
  /** Local branches created with `git branch` (never checked out). */
  branches?: string[];
  /** Remote-tracking refs created under refs/remotes/origin/. */
  remoteBranches?: string[];
}

/** A temp git repo on `main` with one commit, plus the named refs. */
export function makeRepo(label: string, opts: RepoOpts = {}): string {
  const root = tempDir(label);
  git(root, "init", "-q", "-b", "main");
  writeFileSync(join(root, "README.md"), "# fixture\n");
  git(root, "add", "README.md");
  git(root, "commit", "-q", "-m", "init");
  for (const b of opts.branches ?? []) git(root, "branch", b);
  for (const b of opts.remoteBranches ?? []) git(root, "update-ref", `refs/remotes/origin/${b}`, "HEAD");
  return root;
}

// ---------------------------------------------------------------- payload seed

/** The seven secret rows a v3.0.0 run writes, with seeded counts. */
export const SEEDED_SECRET_COUNTS = [0, 0, 1, 0, 2, 0, 0];

export function sevenSecretRows(keys: readonly string[]): { pattern: string; count: number }[] {
  return keys.map((k, i) => ({ pattern: k, count: SEEDED_SECRET_COUNTS[i] ?? 0 }));
}

export const SECRET_KEYS = [
  "anthropic_api_key",
  "openai_api_key",
  "github_pat",
  "aws_access_key",
  "generic_key_value",
  "jwt",
  "aws_secret_key",
] as const;

/**
 * A working directory as /report-issue leaves it after the secret scrub:
 * `report.md` (git log + status text), `metadata.json` (seven secret rows) and
 * `transcript.jsonl`. `expected` holds the seeded identifier occurrences.
 */
export function seedWorkdir(label: string): { dir: string; expected: Record<string, number> } {
  const dir = tempDir(label);
  const report = [
    "## Narrative",
    "",
    `The run failed in /Users/${USER}/repo/src/a.ts while on ${BRANCH}.`,
    "",
    "## Curated Context",
    "",
    "git log -10 --oneline:",
    `abc1234 (HEAD -> ${BRANCH}, origin/${BRANCH}, origin/main, main) fix: the thing`,
    `def5678 Merge branch '${OTHER_BRANCH}'`,
    "",
    "git status --porcelain:",
    ` M /home/${USER}/repo/b.ts`,
    "",
    `Session ${uuid(1)} wrote ~/.claude/projects/-Users-${USER}-repo/${uuid(1)}.jsonl`,
    "",
    "## Redaction Summary",
    "",
    "redaction: 3 match(es) across 7 pattern(s)",
    "",
  ].join("\n");
  // report.md: home 3 (/Users/, /home/, slug), session 2, branch 4 (3 x BRANCH + OTHER_BRANCH)
  const metadata = {
    timestamp: "2026-11-06T10:00:00.000Z",
    plugin_version: "3.1.0",
    git_head: "0123456789abcdef0123456789abcdef01234567",
    severity: "low",
    verified: false,
    verification: { searched: true, found: false, markers: [`/Users/${USER}/repo`, uuid(2)] },
    redaction_summary: sevenSecretRows(SECRET_KEYS),
    full_transcript_included: true,
  };
  // metadata.json: home 1, session 1
  const transcript = [
    JSON.stringify({ type: "user", sessionId: uuid(1), cwd: `/Users/${USER}/repo`, gitBranch: BRANCH, message: "hi" }),
    JSON.stringify({
      type: "assistant",
      sessionId: uuid(2),
      cwd: `/home/${USER}/repo`,
      git_branch: BRANCH,
      message: `run git push origin ${BRANCH}`,
    }),
    "",
  ].join("\n");
  // transcript.jsonl: home 2, session 2, branch 3
  writeFileSync(join(dir, "report.md"), report);
  writeFileSync(join(dir, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`);
  writeFileSync(join(dir, "transcript.jsonl"), transcript);
  return { dir, expected: { home_path: 6, session_id: 5, branch_name: 7 } };
}

/**
 * STE-720 pre-merge fix (M2): a work directory whose report.md carries the
 * branch after a `/` or `.` boundary, in every ref, URL and path form a git
 * report shows. `expected.branch_name` is the number of seeded forms.
 */
export const BOUNDARY_LINES: readonly string[] = [
  `refs/heads/${BRANCH}`,
  `refs/remotes/origin/${BRANCH}`,
  `https://github.com/o/r/tree/${BRANCH}`,
  `https://github.com/o/r/pull/new/${BRANCH}`,
  `https://github.com/o/r/compare/main...${BRANCH}`,
  `/tmp/wt/${BRANCH}`,
  `origin/${BRANCH}`,
  `/tmp/wt/${BRANCH}/src/a.ts`,
  `refs/heads/${BRANCH}/sub/path`,
];

export function seedBoundaryWorkdir(label: string): { dir: string; expected: { branch_name: number } } {
  const dir = tempDir(label);
  writeFileSync(join(dir, "report.md"), ["## Curated Context", "", ...BOUNDARY_LINES, ""].join("\n"));
  writeFileSync(join(dir, "metadata.json"), `${JSON.stringify({ redaction_summary: sevenSecretRows(SECRET_KEYS) }, null, 2)}\n`);
  writeFileSync(join(dir, "transcript.jsonl"), `${JSON.stringify({ type: "user", message: `pushed to refs/heads/${BRANCH}` })}\n`);
  return { dir, expected: { branch_name: BOUNDARY_LINES.length + 1 } };
}

/** Every file of `dir`, name -> bytes. */
export function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of readdirSync(dir).sort()) out[name] = readFileSync(join(dir, name), "latin1");
  return out;
}

/** Identifier leaks a scrubbed payload must not carry (AC-STE-720.6). */
export function leaks(text: string, branches: readonly string[] = [BRANCH, OTHER_BRANCH]): string[] {
  const found: string[] = [];
  for (const needle of ["/Users/", "/home/", "-Users-fixture", "-home-fixture"]) if (text.includes(needle)) found.push(needle);
  const uuids = text.match(UUID_RE);
  if (uuids) found.push(...uuids.map((u) => `uuid:${u}`));
  for (const b of branches) if (text.includes(b)) found.push(`branch:${b}`);
  return found;
}

// ---------------------------------------------------------------- front door

export interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export interface RunOpts {
  env?: Record<string, string>;
  preload?: string;
  door?: string;
}

export function runFrontDoor(workdir: string, projectRoot: string, flags: string[], opts: RunOpts = {}): RunResult {
  const args = ["run", ...(opts.preload ? [`--preload=${opts.preload}`] : []), opts.door ?? FRONT_DOOR, workdir, projectRoot, ...flags];
  const p = spawnSync(process.execPath, args, {
    cwd: projectRoot,
    encoding: "utf-8",
    env: { ...process.env, ...GIT_ENV, ...(opts.env ?? {}) },
    timeout: 60_000,
  });
  return { status: p.status, stdout: p.stdout ?? "", stderr: p.stderr ?? "" };
}

/**
 * A PATH dir holding a `git` shim that logs every call to `log` and runs the
 * real git. With `blankForEachRef`, a `for-each-ref` call prints nothing and
 * exits 0 (the for-each-ref branch source removed).
 */
export function gitShim(label: string, opts: { blankForEachRef?: boolean } = {}): { pathDir: string; log: string; env: Record<string, string> } {
  const dir = tempDir(label);
  const log = join(dir, "git-calls.log");
  writeFileSync(log, "");
  const realGit = Bun.which("git");
  if (!realGit) throw new Error("git not on PATH");
  const blank = opts.blankForEachRef ? 'for a in "$@"; do [ "$a" = for-each-ref ] && exit 0; done\n' : "";
  const bin = join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "git"), `#!/bin/sh\nprintf '%s\\n' "$*" >> "${log}"\n${blank}exec "${realGit}" "$@"\n`, { mode: 0o755 });
  return { pathDir: bin, log, env: { PATH: `${bin}:${process.env.PATH ?? ""}` } };
}

/**
 * A bun preload that rewrites `scrub_identifiers.ts` on load so its exported
 * `scrubIdentifiers` binding is wrapped: every call appends a line to `log`.
 * With `freshAliasPerCall`, each call gets a new alias map instead of the
 * shared `ctx.aliases` (the shared alias map removed).
 */
export function scrubSpyPreload(label: string, opts: { freshAliasPerCall?: boolean; maskUuid?: boolean } = {}): { preload: string; log: string } {
  const dir = tempDir(label);
  const log = join(dir, "scrub-calls.log");
  writeFileSync(log, "");
  const ctxExpr = opts.freshAliasPerCall ? "{ ...(a[1] ?? {}), aliases: { byDigest: new Map(), last: 0 } }" : "a[1]";
  const wrapper = [
    "",
    ";const __spyOrigScrub = scrubIdentifiers;",
    "scrubIdentifiers = function (...a: any[]) {",
    `  require("node:fs").appendFileSync(${JSON.stringify(log)}, "scrubIdentifiers\\n");`,
    `  return (__spyOrigScrub as any)(a[0], ${ctxExpr});`,
    "} as any;",
    "",
  ].join("\n");
  const preload = join(dir, "spy-preload.ts");
  writeFileSync(
    preload,
    [
      'import { plugin } from "bun";',
      'import { readFileSync } from "node:fs";',
      "plugin({",
      '  name: "ste720-scrub-spy",',
      "  setup(build) {",
      "    build.onLoad({ filter: /scrub_identifiers\\.ts$/ }, (args) => {",
      '      const src = readFileSync(args.path, "utf-8").replace(/export const scrubIdentifiers\\b/, "export let scrubIdentifiers");',
      `      return { contents: src + ${JSON.stringify(wrapper)}, loader: "ts" };`,
      "    });",
      "  },",
      "});",
      "",
    ].join("\n"),
  );
  return { preload, log };
}

export function logLines(log: string): string[] {
  return readFileSync(log, "utf-8").split("\n").filter((l) => l.length > 0);
}

// ---------------------------------------------------------------- skill text

/** Collapse line breaks so a sentence split across lines reads as one. */
export function flat(text: string): string {
  return text.replace(/\n[ \t]*(?:\/\/|\*|#)?[ \t]*/g, " ");
}

/** The sentences of `text` that contain `needle`. */
export function sentencesNaming(text: string, needle: string): string[] {
  return flat(text)
    .split(/(?<=[.;!?])\s+(?=[A-Z`(*\[])/)
    .filter((s) => s.includes(needle));
}

/** Sentences naming the front door that name neither flag (AC-STE-720.9 / .13 needle row). */
export function unflaggedFrontDoorMentions(text: string): string[] {
  return sentencesNaming(text, "report_issue_payload.ts").filter((s) => !FLAGS.some((f) => s.includes(f)));
}

export function atRev(rev: string, repoRel: string): string {
  const p = spawnSync("git", ["-C", REPO_ROOT, "show", `${rev}:${repoRel}`], { encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 });
  if (p.status !== 0) throw new Error(`git show ${rev}:${repoRel}: ${p.stderr}`);
  return p.stdout;
}

export const STE_TOKEN_RE = /\b(?:STE|AC-STE)-\d+(?:\.\d+)?\b/g;
export const steTokens = (text: string): number => (text.match(STE_TOKEN_RE) ?? []).length;

// ---------------------------------------------------------------- named predicates
//
// Each named predicate is the assertion of one AC test, factored out so the
// AC.11 mutation suite can apply it to a mutant `scrubIdentifiers` and prove it
// goes red. A predicate returns true when the behaviour is present.

export type ScrubFn = (text: string, ctx: any) => { scrubbed: string; matches: { pattern: string; count: number }[] };

export function predUsersPrefix(scrub: ScrubFn, freshAliases: () => any): boolean {
  const r = scrub(`/Users/${USER}/repo/a.ts`, { branches: [], aliases: freshAliases() });
  return r.scrubbed === "~/repo/a.ts" && counts(r.matches).home_path === 1;
}

export function predSlug(scrub: ScrubFn, freshAliases: () => any): boolean {
  const withHome = scrub("~/.claude/projects/-Users-fixture-user-repo/x.jsonl", {
    home: "/Users/fixture.user",
    branches: [],
    aliases: freshAliases(),
  });
  const noHome = scrub("-home-fixtureuser-repo/", { branches: [], aliases: freshAliases() });
  return (
    withHome.scrubbed === "~/.claude/projects/-~-repo/x.jsonl" &&
    counts(withHome.matches).home_path === 1 &&
    noHome.scrubbed === "-~-repo/" &&
    counts(noHome.matches).home_path === 1
  );
}

export function predUuid(scrub: ScrubFn, freshAliases: () => any): boolean {
  const r = scrub(`id ${uuid(1)} and ${uuid(2)} and ${uuid(1)}`, { branches: [], aliases: freshAliases() });
  return r.scrubbed === "id s1 and s2 and s1" && counts(r.matches).session_id === 3;
}

export const DECORATION = `abc1234 (HEAD -> ${BRANCH}, origin/${BRANCH}, origin/main, main) fix: thing`;

export function predRemotePrefix(scrub: ScrubFn, freshAliases: () => any): boolean {
  const h = branchAlias(BRANCH);
  const r = scrub(DECORATION, { branches: [BRANCH], aliases: freshAliases() });
  return r.scrubbed === `abc1234 (HEAD -> ${h}, origin/${h}, origin/main, main) fix: thing` && counts(r.matches).branch_name === 2;
}

export function predSharedMap(scrub: ScrubFn, freshAliases: () => any): boolean {
  const aliases = freshAliases();
  const a = scrub(`a ${uuid(1)} b ${uuid(2)}`, { branches: [], aliases });
  const b = scrub(`${uuid(2)} then ${uuid(1)}`, { branches: [], aliases });
  return a.scrubbed === "a s1 b s2" && b.scrubbed === "s2 then s1";
}

/** Run `fn` with every occurrence of `from` masked to `to` in the input and restored in the output. */
export function masked(scrub: ScrubFn, from: RegExp, mask: (m: string) => string, unmask: (s: string) => string): ScrubFn {
  return (text, ctx) => {
    const r = scrub(text.replace(from, mask), ctx);
    return { ...r, scrubbed: unmask(r.scrubbed) };
  };
}

/** The no-flag refusal predicate (AC-STE-720.13): exit 1, empty stdout, NFR-10 stderr, files untouched. */
export function predNoFlagRefusal(r: RunResult, before: Record<string, string>, after: Record<string, string>): boolean {
  return (
    r.status === 1 &&
    r.stdout === "" &&
    /Remedy: /.test(r.stderr) &&
    /Context: /.test(r.stderr) &&
    JSON.stringify(before) === JSON.stringify(after)
  );
}

/**
 * Front-door shared-map predicate on a seeded working directory after a
 * flagged run: uuid(1) and uuid(2) get distinct aliases, and the uuid(2)
 * marker in metadata.json carries the same alias as transcript line 2.
 */
export function predFrontDoorSharedMap(dir: string): boolean {
  const lines = readFileSync(join(dir, "transcript.jsonl"), "utf-8").split("\n").filter((l) => l.length > 0);
  const a1 = JSON.parse(lines[0]!).sessionId;
  const a2 = JSON.parse(lines[1]!).sessionId;
  const meta = JSON.parse(readFileSync(join(dir, "metadata.json"), "utf-8"));
  const marker = meta.verification?.markers?.[1];
  return /^s[1-9]\d*$/.test(a1) && /^s[1-9]\d*$/.test(a2) && a1 !== a2 && marker === a2;
}
