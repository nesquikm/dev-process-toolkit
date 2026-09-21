// STE-617 (M_2306b6) — the maintainer-only skill `.claude/skills/shared-tracker-smoke/SKILL.md`:
// where it lives, what the gate probes see of it, its pre-flight fence RUN with
// `claude` and `bun` stubbed, and the static shape of its cleanup and summary.
//
// THE PRE-FLIGHT FENCE CONTRACT (AC-STE-617.2). The document holds exactly one
// ```bash fence whose body carries the comment line
//
//     # shared-tracker-smoke: pre-flight
//
// It runs from the toolkit checkout's top level and reads its inputs from the
// environment, never from a hard-coded operator path:
//   TRACKER, JIRA_PROJECT, JIRA_REPOINT_FROM (optional), LINEAR_TEAM,
//   OLD_CLIENT (optional plugin dir), CLAUDE_CONFIG_DIR (workspace trust in
//   `$CLAUDE_CONFIG_DIR/.claude.json` under `projects["<abs path>"].hasTrustDialogAccepted`;
//   the plugin cache under `$CLAUDE_CONFIG_DIR/plugins/cache/dev-process-toolkit/dev-process-toolkit/<ver>/`),
//   PREFLIGHT_ANSWERS — a directory of the tracker answers the operator
//   session saved from its own MCP read calls before the fence runs:
//     second-server-read.json   one read call on the second server name
//                               (missing, not JSON, or a top-level "error" → refuse); measured
//                               examples: getAccessibleAtlassianResources (Jira), list_teams (Linear)
//     jira-space-<KEY>.json     the getVisibleJiraProjects(searchString: <KEY>) answer, verbatim:
//                               {"values":[{"key":"<KEY>",…}],…}   (per space: shared, and repoint-from when given)
//     jira-createmeta-<KEY>.json the getJiraProjectIssueTypesMetadata(projectIdOrKey: <KEY>) answer,
//                               verbatim: {"issueTypes":[{"name":"Task"},{"name":"Epic"},…],…}
//   Every stub below is built from a MEASURED shape in tests/fixtures/live-shapes/, never invented.
//     linear-team.json          the mcp__linear__get_team(query: <LINEAR_TEAM>) answer, verbatim:
//                               {"id":"<uuid>","name":"<display name>",…} — MEASURED, no `key`
//                               field (tests/fixtures/live-shapes/linear/get_team.json); the
//                               fence records its id as LINEAR_TEAM_ID in the pre-flight env
// The version under test is `plugins/dev-process-toolkit/.claude-plugin/plugin.json`.
// The old client defaults to the newest cached version whose hooks/hooks.json
// names no `pre-tracker-write-gate`. The behaviour digest comes from
// `bun …/shared_tracker_live_grader.ts digest <pluginRoot>`.
//
// A refusal exits non-zero with the three-line NFR-10 shape on stderr —
// `/shared-tracker-smoke: …`, `Remedy: …`, `Context: … skill=shared-tracker-smoke…` —
// having started no `claude` and run no `bun` but the read-only digest.
// The complete fixture exits 0.

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { runAutoApproveMarkerProbe } from "../adapters/_shared/src/auto_approve_marker";
import { AUTO_ANSWERS_OPEN, extractAutoAnswers, resolveInterviewAnswer } from "../adapters/_shared/src/auto_answers";
import { HARNESS_SKILL_RELATIVE_PATHS } from "../adapters/_shared/src/harness_artifact_paths";
import { runRequiresInputSentinelCoverageProbe } from "../adapters/_shared/src/requires_input_sentinel_coverage";
import { scanCandidateCheckSkills } from "../adapters/_shared/src/scan_candidate_check_skills";
import { AUDIT_REQUEST_FIELDS, parseMarker } from "../adapters/_shared/src/shared_tracker_live_grader";
import { classify as classifyLines, isSpawnFence, parseFences, type Fence } from "./_spawn_fences";
import {
  baseEnv as stubEnv,
  flagValue,
  makeSandbox as makeStubSandbox,
  readCalls as readStubCalls,
  reap as reapStubSandbox,
  rebase as rebaseIntoStub,
  runScript as runStubScript,
  type Sandbox as StubSandbox,
} from "./_ste594_harness";
import { readSpecFile } from "./_spec_tree";

const pluginRoot = join(import.meta.dir, "..");
const repoRoot = realpathSync(join(pluginRoot, "..", ".."));
const DOC_REL = ".claude/skills/shared-tracker-smoke/SKILL.md";
const DOC = join(repoRoot, DOC_REL);
const MARKER = "<dpt:auto-approve>v1</dpt:auto-approve>";
const PREFLIGHT_TAG = "# shared-tracker-smoke: pre-flight";

function docText(): string {
  expect(existsSync(DOC), `${DOC_REL} exists (STE-617 AC.1)`).toBe(true);
  return readFileSync(DOC, "utf-8");
}

function fences(): Fence[] {
  return parseFences("shared-tracker-smoke", docText());
}

function frontmatter(text: string): string {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text.replace(/\r\n/g, "\n"));
  expect(m, "the document opens with a frontmatter block").not.toBeNull();
  return m![1]!;
}

/** The region under the first heading matching `re`, through the next heading of the same or a higher level. */
function section(text: string, re: RegExp): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const i = lines.findIndex((l) => /^#{1,6}\s/.test(l) && re.test(l));
  expect(i, `a heading matching ${re}`).toBeGreaterThanOrEqual(0);
  const level = /^(#+)/.exec(lines[i]!)![1]!.length;
  let j = i + 1;
  while (j < lines.length && !(new RegExp(`^#{1,${level}}\\s`).test(lines[j]!))) j++;
  return lines.slice(i, j).join("\n");
}

// ===========================================================================
// AC.1 — the document, its discovery and the probes that scan it
// ===========================================================================

/**
 * AC.1 — what the frontmatter must say, read from the frontmatter block only:
 * the body names `disable-model-invocation: true` in prose too, so a scan of
 * the whole document could not tell a frontmatter that dropped it.
 */
function frontmatterViolations(text: string): string[] {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text.replace(/\r\n/g, "\n"));
  if (!m) return ["the document opens with no frontmatter block"];
  const fm = m[1]!;
  const v: string[] = [];
  if (!/^name:\s*shared-tracker-smoke\s*$/m.test(fm)) v.push("the frontmatter does not name shared-tracker-smoke");
  if (!/^disable-model-invocation:\s*true\s*$/m.test(fm)) v.push("the frontmatter does not carry disable-model-invocation: true");
  if (/^verify\s*:\s*['"]?(?:true|yes|on)['"]?\s*$/im.test(fm)) v.push("the frontmatter carries verify: true");
  return v;
}

/** The skill-count line of the root CLAUDE.md against the SKILL.md files the two roots hold. */
function skillCountViolations(claudeMd: string, shipped: number): string[] {
  const said = [...claudeMd.matchAll(/(\d+) skills ship across the two roots/g)].map((m) => Number(m[1]));
  if (said.length !== 1) return [`the root CLAUDE.md states the two-root skill count ${said.length} times, not once`];
  return said[0] === shipped ? [] : [`the root CLAUDE.md says ${said[0]} skills ship across the two roots; the roots hold ${shipped}`];
}

function shippedSkillCount(): number {
  const inRoot = (d: string) => (existsSync(d) ? readdirSync(d).filter((n) => existsSync(join(d, n, "SKILL.md"))).length : 0);
  return inRoot(join(repoRoot, ".claude", "skills")) + inRoot(join(pluginRoot, "skills"));
}

/** The document with one frontmatter line changed; the edit must land inside the frontmatter block. */
function withFrontmatter(text: string, edit: (fm: string) => string): string {
  const fm = frontmatter(text);
  const next = edit(fm);
  expect(next, "the frontmatter edit changes the frontmatter").not.toBe(fm);
  return text.replace(`---\n${fm}\n---\n`, `---\n${next}\n---\n`);
}

describe("AC.1 — the skill document and its frontmatter", () => {
  test("it exists with disable-model-invocation: true and no verify: true", () => {
    expect(frontmatterViolations(docText())).toEqual([]);
  });
  test("MUTATION — a copy whose frontmatter drops disable-model-invocation: true, or sets it false, is red (the body's prose mention does not satisfy it)", () => {
    const text = docText();
    const dropped = withFrontmatter(text, (fm) => fm.split("\n").filter((l) => !/^disable-model-invocation:/.test(l)).join("\n"));
    expect(dropped.includes("disable-model-invocation: true"), "control: the body still names it in prose").toBe(true);
    expect(frontmatterViolations(dropped)).toEqual(["the frontmatter does not carry disable-model-invocation: true"]);
    const flipped = withFrontmatter(text, (fm) => fm.replace(/^disable-model-invocation:\s*true\s*$/m, "disable-model-invocation: false"));
    expect(frontmatterViolations(flipped)).toEqual(["the frontmatter does not carry disable-model-invocation: true"]);
  });
  test("MUTATION — a copy whose frontmatter adds verify: true is red; PERMIT TWIN — verify: true in the body is not frontmatter", () => {
    const text = docText();
    const added = withFrontmatter(text, (fm) => `${fm}\nverify: true`);
    expect(frontmatterViolations(added)).toEqual(["the frontmatter carries verify: true"]);
    const inBody = text.replace("\n# /shared-tracker-smoke\n", "\n# /shared-tracker-smoke\n\nverify: true\n");
    expect(inBody, "control: the body edit landed").not.toBe(text);
    expect(frontmatterViolations(inBody)).toEqual([]);
  });
  test("implementation-time discovery still finds no candidate check skill", () => {
    docText();
    expect(scanCandidateCheckSkills(repoRoot)).toEqual([]);
  });
  test("runAutoApproveMarkerProbe reports zero violations naming the document", async () => {
    docText();
    const r = await runAutoApproveMarkerProbe(repoRoot);
    expect(r.violations.filter((v) => v.file.includes("shared-tracker-smoke") || v.note.includes("shared-tracker-smoke"))).toEqual([]);
  });
  test("runRequiresInputSentinelCoverageProbe reports zero violations naming the document", async () => {
    docText();
    const r = await runRequiresInputSentinelCoverageProbe(repoRoot);
    expect(r.violations.filter((v) => v.file.includes("shared-tracker-smoke") || v.note.includes("shared-tracker-smoke"))).toEqual([]);
  });

  /** Remove the marker from the first column-0 bash fence holding a heredoc `claude -p` spawn. */
  function dropOneMarker(text: string): { text: string; fenceLine: number } {
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (!/^```bash\s*$/.test(lines[i]!)) continue;
      let j = i + 1;
      while (j < lines.length && !/^```\s*$/.test(lines[j]!)) j++;
      const body = lines.slice(i + 1, j);
      const joined = body.join("\n");
      if (/\bclaude\s+-p\b/.test(joined) && /<<\s*['"]?[A-Za-z_]/.test(joined) && body.some((l) => l.trim() === MARKER)) {
        const kept = [...lines.slice(0, i + 1), ...body.filter((l) => l.trim() !== MARKER), ...lines.slice(j)];
        return { text: kept.join("\n"), fenceLine: i + 1 };
      }
      i = j;
    }
    return { text, fenceLine: -1 };
  }

  test("the document is INSIDE the auto-approve probe's scan set: a scratch copy with one heredoc spawn fence's marker removed yields exactly one violation naming it", async () => {
    const text = docText();
    const scratch = realpathSync(mkdtempSync(join(tmpdir(), "ste617-aam-")));
    try {
      const target = join(scratch, DOC_REL);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, text);
      const clean = await runAutoApproveMarkerProbe(scratch);
      expect(clean.violations, "control: the unmutated copy is clean").toEqual([]);
      const { text: mutated, fenceLine } = dropOneMarker(text);
      expect(fenceLine, "the document holds a column-0 heredoc `claude -p` spawn fence carrying the marker").toBeGreaterThan(0);
      writeFileSync(target, mutated);
      const r = await runAutoApproveMarkerProbe(scratch);
      expect(r.violations.length).toBe(1);
      expect(r.violations[0]!.file.endsWith(DOC_REL)).toBe(true);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
  test("the root CLAUDE.md skill count reads 30, derived from both roots", () => {
    docText();
    const claude = readFileSync(join(repoRoot, "CLAUDE.md"), "utf-8");
    expect(shippedSkillCount(), "the two roots hold 30 SKILL.md files").toBe(30);
    expect(skillCountViolations(claude, shippedSkillCount())).toEqual([]);
    expect(claude).not.toContain("29 skills ship across the two roots");
  });
  test("MUTATION — a CLAUDE.md copy saying 31, or 29, skills ship across the two roots is red", () => {
    const claude = readFileSync(join(repoRoot, "CLAUDE.md"), "utf-8");
    for (const n of ["31", "29"]) {
      const m = claude.replace("30 skills ship across the two roots", `${n} skills ship across the two roots`);
      expect(m, "control: the edit landed").not.toBe(claude);
      expect(skillCountViolations(m, shippedSkillCount())).toEqual([`the root CLAUDE.md says ${n} skills ship across the two roots; the roots hold 30`]);
    }
  });
});

// ===========================================================================
// AC.4 — the harness artifact registry
// ===========================================================================

describe("AC.4 — the document is a registered harness document", () => {
  test("HARNESS_SKILL_RELATIVE_PATHS names it", () => {
    expect([...HARNESS_SKILL_RELATIVE_PATHS]).toContain(DOC_REL);
  });
  test("`bun harness_artifact_paths.ts` exits 0 over all three documents", () => {
    const r = spawnSync(process.execPath, [join(pluginRoot, "adapters", "_shared", "src", "harness_artifact_paths.ts")], { cwd: repoRoot, encoding: "utf-8" });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^artifact-paths: ok scanned=\d+/m);
  });
  test("AC.16 — `bun harness_artifact_paths.ts ignore-scan` exits 0: the committed bundle is named only as a directory", () => {
    const r = spawnSync(process.execPath, [join(pluginRoot, "adapters", "_shared", "src", "harness_artifact_paths.ts"), "ignore-scan"], { cwd: repoRoot, encoding: "utf-8" });
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
  });
});

// ===========================================================================
// AC.5 — no hand-written declaration line
// ===========================================================================

/** Lines that hand-write a declaration field: after list, quote and backtick decoration, the line starts `repo_tag:` or `min_dpt_version:`. */
function handWrittenDeclarationLines(text: string): string[] {
  return text
    .split("\n")
    .filter((l) => /^(?:repo_tag|min_dpt_version):/.test(l.replace(/^[\s>*+-]*(?:\d+\.\s*)?`?/, "")));
}

describe("AC.5 — the document hand-writes no repo_tag: or min_dpt_version: line", () => {
  test("the document carries none", () => {
    expect(handWrittenDeclarationLines(docText())).toEqual([]);
  });
  test("CONTROL — a mutated copy carrying either line fails; a prose mention mid-sentence does not", () => {
    const text = docText();
    expect(handWrittenDeclarationLines(`${text}\nrepo_tag: shr-live-a\n`)).toEqual(["repo_tag: shr-live-a"]);
    expect(handWrittenDeclarationLines(`${text}\n  min_dpt_version: 2.90.0\n`)).toEqual(["  min_dpt_version: 2.90.0"]);
    expect(handWrittenDeclarationLines(`${text}\n- \`repo_tag: x\`\n`).length).toBe(1);
    expect(handWrittenDeclarationLines("The front door writes the `repo_tag:` field for you.\n")).toEqual([]);
  });
});

// ===========================================================================
// AC.2 — the pre-flight fence, run with claude and bun stubbed
// ===========================================================================

function preflightFence(): Fence {
  const hits = fences().filter((f) => f.info === "bash" && f.lines.some((l) => l.trim() === PREFLIGHT_TAG));
  expect(hits.length, `exactly one bash fence carries \`${PREFLIGHT_TAG}\``).toBe(1);
  return hits[0]!;
}

interface Sandbox {
  root: string;
  bin: string;
  calls: string;
  toolkit: string;
  config: string;
  answers: string;
  home: string;
  tmp: string;
}

const FLOOR = "2.90.0";

/** A MEASURED tracker answer (`tests/fixtures/live-shapes/<tracker>/<name>.json`, `{provenance, answer}`): never an invented shape. */
function liveShape(tracker: "jira" | "linear", name: string): any {
  return JSON.parse(readFileSync(join(pluginRoot, "tests", "fixtures", "live-shapes", tracker, `${name}.json`), "utf-8")).answer;
}

function writeJson(p: string, v: unknown): void {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(v, null, 2));
}

function cachedPlugin(dir: string, version: string, withHook: boolean): string {
  writeJson(join(dir, ".claude-plugin", "plugin.json"), { name: "dev-process-toolkit", version });
  writeJson(join(dir, "hooks", "hooks.json"), {
    hooks: {
      PreToolUse: [
        { matcher: "Bash", hooks: [{ type: "command", command: '"${CLAUDE_PLUGIN_ROOT}"/templates/hooks/process/pre-commit-gate-check.sh' }] },
        ...(withHook ? [{ matcher: "^mcp__.+__(createJiraIssue)$", hooks: [{ type: "command", command: '"${CLAUDE_PLUGIN_ROOT}"/templates/hooks/process/pre-tracker-write-gate.sh' }] }] : []),
      ],
    },
  });
  return dir;
}

function makeSandbox(tracker: "jira" | "linear"): Sandbox {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ste617-pf-")));
  const sb: Sandbox = {
    root,
    bin: join(root, "bin"),
    calls: join(root, "calls.log"),
    toolkit: join(root, "work", "dev-process-toolkit"),
    config: join(root, "config"),
    answers: join(root, "answers"),
    home: join(root, "home"),
    tmp: join(root, "tmp"),
  };
  for (const d of [sb.bin, sb.toolkit, sb.config, sb.answers, sb.home, sb.tmp]) mkdirSync(d, { recursive: true });
  writeFileSync(join(sb.bin, "claude"), `#!/bin/bash\nprintf 'claude\\t%s\\n' "$*" >> ${JSON.stringify(sb.calls)}\nexit 0\n`, { mode: 0o755 });
  writeFileSync(
    join(sb.bin, "bun"),
    [
      "#!/bin/bash",
      `printf 'bun\\t%s\\n' "$*" >> ${JSON.stringify(sb.calls)}`,
      'case "$*" in',
      "  *shared_tracker_live_grader.ts*digest*)",
      '    if [ -n "${STUB_DIGEST_FAIL:-}" ]; then',
      "      printf 'Refusing: digest-unavailable: the plugin root is not a git checkout and no tracked-file list was given.\\n' >&2",
      "      exit 1",
      "    fi",
      `    printf '{"digest":"%s","files":{}}\\n' "${"a".repeat(64)}"`,
      "    exit 0 ;;",
      "esac",
      "exit 0",
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  // The toolkit checkout: clean, with the version under test and the gate hook.
  const plugin = join(sb.toolkit, "plugins", "dev-process-toolkit");
  cachedPlugin(plugin, FLOOR, true);
  writeFileSync(join(plugin, "adapters_placeholder.txt"), "tree under test\n");
  mkdirSync(join(plugin, "adapters", "_shared", "src"), { recursive: true });
  writeFileSync(join(plugin, "adapters", "_shared", "src", "shared_tracker_live_grader.ts"), "// never executed: bun is stubbed\n");
  const genv = { ...process.env, HOME: sb.home, GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@localhost", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@localhost" };
  for (const args of [["init", "-q"], ["add", "-A"], ["-c", "commit.gpgsign=false", "commit", "-qm", "init"]]) {
    const r = spawnSync("git", ["-c", "init.defaultBranch=main", ...args], { cwd: sb.toolkit, env: genv, encoding: "utf-8" });
    if (r.status !== 0) throw new Error(`sandbox git ${args.join(" ")}: ${r.stderr}`);
  }
  // Workspace trust for both throwaway paths.
  writeJson(join(sb.config, ".claude.json"), { projects: { [throwaway(sb, tracker, "a")]: { hasTrustDialogAccepted: true }, [throwaway(sb, tracker, "b")]: { hasTrustDialogAccepted: true } } });
  // The plugin cache: 2.86.0 lacks the hook (the old client), 2.89.0 carries it.
  const cache = join(sb.config, "plugins", "cache", "dev-process-toolkit", "dev-process-toolkit");
  cachedPlugin(join(cache, "2.86.0"), "2.86.0", false);
  cachedPlugin(join(cache, "2.89.0"), "2.89.0", true);
  // The operator session's saved answers — every one a MEASURED shape (tests/fixtures/live-shapes/).
  // The second-server read: a bare array on Jira (getAccessibleAtlassianResources), a page object on Linear (list_teams).
  writeJson(join(sb.answers, "second-server-read.json"), tracker === "jira" ? liveShape("jira", "getAccessibleAtlassianResources") : liveShape("linear", "list_teams"));
  for (const key of ["DST", "DST2"]) {
    writeJson(join(sb.answers, `jira-space-${key}.json`), jiraSpaceAnswer(key));
    writeJson(join(sb.answers, `jira-createmeta-${key}.json`), liveShape("jira", "getJiraProjectIssueTypesMetadata"));
  }
  // The MEASURED get_team answer: an id and a display name, no key field.
  writeJson(join(sb.answers, "linear-team.json"), liveShape("linear", "get_team"));
  return sb;
}

/** The measured getVisibleJiraProjects answer, its `values` rows keyed to the space under test. */
function jiraSpaceAnswer(key: string): any {
  const a = liveShape("jira", "getVisibleJiraProjects");
  return { ...a, values: a.values.map((v: Record<string, unknown>) => ({ ...v, key })) };
}

/** The measured getJiraProjectIssueTypesMetadata answer with the named issue type removed. */
function createmetaWithout(name: string): any {
  const a = liveShape("jira", "getJiraProjectIssueTypesMetadata");
  const issueTypes = a.issueTypes.filter((t: { name: string }) => t.name !== name);
  expect(issueTypes.length, `control: the measured metadata offers ${name}`).toBe(a.issueTypes.length - 1);
  return { ...a, issueTypes, total: issueTypes.length };
}

function throwaway(sb: Sandbox, tracker: string, side: "a" | "b"): string {
  return join(dirname(sb.toolkit), `dpt-shared-${tracker}-${side}`);
}

function envFor(sb: Sandbox, extra: Record<string, string | undefined>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (/DPT|SMOKE|TRACKER|JIRA|LINEAR|OLD_CLIENT|PREFLIGHT|CLAUDE_CONFIG_DIR|STUB_/i.test(k)) continue;
    env[k] = v;
  }
  env.HOME = sb.home;
  env.PATH = `${sb.bin}:${process.env.PATH ?? ""}`;
  env.CLAUDE_CONFIG_DIR = sb.config;
  env.PREFLIGHT_ANSWERS = sb.answers;
  env.JIRA_PROJECT = "DST";
  env.LINEAR_TEAM = "STE";
  for (const [k, v] of Object.entries(extra)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  return env;
}

interface Run {
  code: number;
  out: string;
  err: string;
  calls: Array<{ kind: string; args: string }>;
}

function runPreflight(sb: Sandbox, env: Record<string, string>, cwd = sb.toolkit, fenceBody = preflightFence().body): Run {
  const body = fenceBody.replaceAll(repoRoot, sb.toolkit).replaceAll("/tmp/", `${sb.tmp}/`);
  const file = join(sb.root, `preflight-${Math.random().toString(36).slice(2)}.sh`);
  writeFileSync(file, body);
  const which = spawnSync("bash", ["-c", "command -v claude; command -v bun"], { env, cwd, encoding: "utf-8" });
  expect(which.stdout.trim().split("\n"), "SAFETY: the stubs must shadow the real claude and bun").toEqual([join(sb.bin, "claude"), join(sb.bin, "bun")]);
  const r = spawnSync("bash", [file], { env, cwd, encoding: "utf-8", timeout: 60_000 });
  const calls = existsSync(sb.calls)
    ? readFileSync(sb.calls, "utf-8").split("\n").filter(Boolean).map((l) => {
        const [kind = "", ...rest] = l.split("\t");
        return { kind, args: rest.join("\t") };
      })
    : [];
  return { code: r.status ?? -1, out: r.stdout ?? "", err: r.stderr ?? "", calls };
}

function expectRefusal(r: Run, sb: Sandbox, tracker: string): string[] {
  const dump = `exit=${r.code}\n--- stdout ---\n${r.out}\n--- stderr ---\n${r.err}`;
  expect(r.code, dump).not.toBe(0);
  expect(r.calls.filter((c) => c.kind === "claude"), "no child was started").toEqual([]);
  expect(r.calls.filter((c) => c.kind === "bun" && !/shared_tracker_live_grader\.ts["']?\s+digest\b/.test(c.args)), "no bun run but the read-only digest").toEqual([]);
  expect(existsSync(throwaway(sb, tracker, "a")) || existsSync(throwaway(sb, tracker, "b")), "nothing was bootstrapped").toBe(false);
  const lines = r.err.replace(/\n+$/, "").split("\n").filter((l) => l.trim() !== "");
  expect(lines.length, dump).toBe(3);
  expect(lines[0]!).toMatch(/^\/shared-tracker-smoke: /);
  expect(lines[1]!).toMatch(/^Remedy: /);
  expect(lines[2]!).toMatch(/^Context: .*skill=shared-tracker-smoke/);
  return lines;
}

function withSandbox(tracker: "jira" | "linear", f: (sb: Sandbox) => void): void {
  const sb = makeSandbox(tracker);
  try {
    f(sb);
  } finally {
    rmSync(sb.root, { recursive: true, force: true });
  }
}

describe("AC.2 — the pre-flight fence is found and sits before every spawn", () => {
  test("exactly one bash fence carries the pre-flight tag, and it opens before the first spawn fence", () => {
    const pf = preflightFence();
    const firstSpawn = fences().find(isSpawnFence);
    expect(firstSpawn, "the document holds spawn fences").toBeDefined();
    expect(pf.openLine).toBeLessThan(firstSpawn!.openLine);
    expect(pf.body).not.toMatch(/^\s*claude\s+-p\b/m);
  });
});

describe("AC.2 — complete fixtures pass the pre-flight", () => {
  const cases: Array<[string, "jira" | "linear", Record<string, string | undefined>]> = [
    ["jira with --jira-repoint-from DST2", "jira", { TRACKER: "jira", JIRA_REPOINT_FROM: "DST2" }],
    ["jira without --jira-repoint-from (S8 a named skip)", "jira", { TRACKER: "jira" }],
    ["linear", "linear", { TRACKER: "linear" }],
    ["jira with OLD_CLIENT given explicitly (a hook-less 2.86.0)", "jira", { TRACKER: "jira", OLD_CLIENT: "__CACHE__/2.86.0" }],
  ];
  for (const [name, tracker, extra] of cases) {
    test(`complete fixture — ${name} — exits 0 having started no child`, () => {
      withSandbox(tracker, (sb) => {
        const cache = join(sb.config, "plugins", "cache", "dev-process-toolkit", "dev-process-toolkit");
        const e = Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, v?.replace("__CACHE__", cache)]));
        const r = runPreflight(sb, envFor(sb, e));
        expect(r.code, `exit=${r.code}\n${r.out}\n${r.err}`).toBe(0);
        expect(r.calls.filter((c) => c.kind === "claude")).toEqual([]);
      });
    });
  }
});

describe("AC.2 — pre-flight refusals: non-zero, three-line NFR-10 shape, zero spawns, before any write", () => {
  type Case = { name: string; tracker: "jira" | "linear"; env?: Record<string, string | undefined>; arrange?: (sb: Sandbox) => void; cwd?: (sb: Sandbox) => string; names?: (sb: Sandbox) => string; check?: string };
  const cache = (sb: Sandbox) => join(sb.config, "plugins", "cache", "dev-process-toolkit", "dev-process-toolkit");
  const cases: Case[] = [
    { name: "cwd-not-toplevel — run from a subdirectory of the checkout", tracker: "jira", env: { TRACKER: "jira" }, cwd: (sb) => join(sb.toolkit, "plugins") },
    { name: "tracker-absent — --tracker not given", tracker: "jira", env: { TRACKER: undefined } },
    { name: "tracker-none — --tracker none", tracker: "jira", env: { TRACKER: "none" } },
    { name: "repoint-from-equals-project — --jira-repoint-from DST with --jira-project DST", tracker: "jira", env: { TRACKER: "jira", JIRA_REPOINT_FROM: "DST" } },
    {
      name: "trust-missing-a — the A throwaway path is untrusted (named)",
      tracker: "jira",
      env: { TRACKER: "jira" },
      arrange: (sb) => writeJson(join(sb.config, ".claude.json"), { projects: { [throwaway(sb, "jira", "b")]: { hasTrustDialogAccepted: true } } }),
      names: (sb) => throwaway(sb, "jira", "a"),
    },
    {
      name: "trust-missing-b — the B throwaway path is untrusted (named)",
      tracker: "linear",
      env: { TRACKER: "linear" },
      arrange: (sb) => writeJson(join(sb.config, ".claude.json"), { projects: { [throwaway(sb, "linear", "a")]: { hasTrustDialogAccepted: true } } }),
      names: (sb) => throwaway(sb, "linear", "b"),
    },
    { name: "tree-dirty — an untracked file in the toolkit checkout", tracker: "linear", env: { TRACKER: "linear" }, arrange: (sb) => writeFileSync(join(sb.toolkit, "stray.txt"), "wip\n") },
    { name: "old-client-none — no cached version lacks the hook", tracker: "jira", env: { TRACKER: "jira" }, arrange: (sb) => rmSync(join(cache(sb), "2.86.0"), { recursive: true, force: true }) },
    {
      name: "old-client-not-below-floor — OLD_CLIENT is at the floor",
      tracker: "jira",
      env: { TRACKER: "jira" },
      arrange: (sb) => {
        cachedPlugin(join(sb.root, "oc-floor"), FLOOR, false);
      },
    },
    {
      name: "old-client-has-hook — OLD_CLIENT carries the tracker-write hook",
      tracker: "linear",
      env: { TRACKER: "linear" },
      arrange: (sb) => {
        cachedPlugin(join(sb.root, "oc-hooked"), "2.86.0", true);
      },
    },
    { name: "digest-unavailable — the behaviour digest cannot be computed", tracker: "jira", env: { TRACKER: "jira", STUB_DIGEST_FAIL: "1" } },
    { name: "second-server-silent — no answer from the second server name", tracker: "jira", env: { TRACKER: "jira" }, arrange: (sb) => rmSync(join(sb.answers, "second-server-read.json")) },
    { name: "second-server-error — the second server name answered an error", tracker: "linear", env: { TRACKER: "linear" }, arrange: (sb) => writeJson(join(sb.answers, "second-server-read.json"), { error: "unauthenticated" }) },
    // Audit item 5 — a read that returns nothing proves nothing.
    { name: "second-server-empty-object — the second server name answered {}", tracker: "jira", env: { TRACKER: "jira" }, arrange: (sb) => writeJson(join(sb.answers, "second-server-read.json"), {}) },
    { name: "second-server-null — the second server name answered null", tracker: "linear", env: { TRACKER: "linear" }, arrange: (sb) => writeJson(join(sb.answers, "second-server-read.json"), null) },
    { name: "second-server-empty-array — the second server name answered []", tracker: "jira", env: { TRACKER: "jira" }, arrange: (sb) => writeJson(join(sb.answers, "second-server-read.json"), []) },
    { name: "jira-space-unreadable — the shared space does not answer a read", tracker: "jira", env: { TRACKER: "jira" }, arrange: (sb) => writeJson(join(sb.answers, "jira-space-DST.json"), { ...jiraSpaceAnswer("DST"), values: [], total: 0 }) },
    { name: "jira-no-epic — the shared space offers no Epic type", tracker: "jira", env: { TRACKER: "jira" }, arrange: (sb) => writeJson(join(sb.answers, "jira-createmeta-DST.json"), createmetaWithout("Epic")) },
    { name: "jira-no-task — the shared space offers no task type", tracker: "jira", env: { TRACKER: "jira" }, arrange: (sb) => writeJson(join(sb.answers, "jira-createmeta-DST.json"), createmetaWithout("Task")) },
    {
      name: "jira-repoint-space-unreadable — the repoint-from space, given, does not answer a read",
      tracker: "jira",
      env: { TRACKER: "jira", JIRA_REPOINT_FROM: "DST2" },
      arrange: (sb) => rmSync(join(sb.answers, "jira-space-DST2.json")),
    },
    { name: "linear-team-unresolved — the team lookup answered an error", tracker: "linear", env: { TRACKER: "linear" }, arrange: (sb) => writeJson(join(sb.answers, "linear-team.json"), { error: "Team not found" }) },
    // Fifth audit, the standing rule: every precondition the fixture supplies has a row that omits it.
    { name: "tracker-unknown — --tracker is neither jira nor linear", tracker: "jira", env: { TRACKER: "github" }, check: "tracker-unknown" },
    { name: "second-server-silent — PREFLIGHT_ANSWERS is not given at all", tracker: "jira", env: { TRACKER: "jira", PREFLIGHT_ANSWERS: undefined }, check: "second-server-silent" },
    { name: "trust-missing — CLAUDE_CONFIG_DIR is not given (the default config dir trusts nothing)", tracker: "jira", env: { TRACKER: "jira", CLAUDE_CONFIG_DIR: undefined }, check: "trust-missing" },
    { name: "floor-unreadable — the plugin manifest under test is gone", tracker: "jira", env: { TRACKER: "jira" }, arrange: (sb) => {
        // Committed, so the clean-tree check (5) passes and the manifest check (6) is the one that fires.
        rmSync(join(sb.toolkit, "plugins", "dev-process-toolkit", ".claude-plugin", "plugin.json"));
        sh(sb.toolkit, ["git", "-c", "commit.gpgsign=false", "commit", "-qam", "drop the manifest"], { HOME: sb.home });
      },
      check: "floor-unreadable",
    },
    { name: "jira-no-epic — the shared space's create metadata was never saved", tracker: "jira", env: { TRACKER: "jira" }, arrange: (sb) => rmSync(join(sb.answers, "jira-createmeta-DST.json")), check: "jira-no-epic" },
    { name: "jira-space-unreadable — the shared space's answer was never saved", tracker: "jira", env: { TRACKER: "jira" }, arrange: (sb) => rmSync(join(sb.answers, "jira-space-DST.json")), check: "jira-space-unreadable" },
  ];
  // The two OLD_CLIENT cases point at a plugin dir the arrange step writes.
  const oldClientDir: Record<string, string> = {
    "old-client-not-below-floor — OLD_CLIENT is at the floor": "oc-floor",
    "old-client-has-hook — OLD_CLIENT carries the tracker-write hook": "oc-hooked",
  };
  for (const c of cases) {
    test(`refusal — ${c.name}`, () => {
      withSandbox(c.tracker, (sb) => {
        c.arrange?.(sb);
        const extra = { ...(c.env ?? {}) };
        const oc = oldClientDir[c.name];
        if (oc) extra.OLD_CLIENT = join(sb.root, oc);
        const r = runPreflight(sb, envFor(sb, extra), c.cwd ? c.cwd(sb) : sb.toolkit);
        const lines = expectRefusal(r, sb, c.tracker);
        if (c.names) expect(lines.join("\n"), "the refusal names the untrusted path").toContain(c.names(sb));
        if (c.check) expect(checkOf(lines), "the refusal is the named check").toBe(c.check);
      });
    });
  }
  test("PERMIT TWIN — the same sandbox with every precondition met exits 0 (the refusals key on one variable each)", () => {
    withSandbox("jira", (sb) => {
      const r = runPreflight(sb, envFor(sb, { TRACKER: "jira", JIRA_REPOINT_FROM: "DST2" }));
      expect(r.code, `${r.out}\n${r.err}`).toBe(0);
    });
  });
  test("PERMIT TWIN (audit item 5) — a non-empty array answer from the second server name (the measured getAccessibleAtlassianResources, a bare array) is a usable read", () => {
    withSandbox("jira", (sb) => {
      const answer = liveShape("jira", "getAccessibleAtlassianResources");
      expect(Array.isArray(answer) && answer.length > 0, "control: the measured answer is a non-empty bare array").toBe(true);
      writeJson(join(sb.answers, "second-server-read.json"), answer);
      const r = runPreflight(sb, envFor(sb, { TRACKER: "jira" }));
      expect(r.code, `${r.out}\n${r.err}`).toBe(0);
    });
  });
});

// ===========================================================================
// AC.15 / AC.16 / AC.18 — the document's cleanup, bundle and summary lines
// ===========================================================================

const CLEANUP_TAG = "# shared-tracker-smoke: session cleanup";
const EXTRACT_TAG = "# shared-tracker-smoke: extract and grade";

/** The fences that name `smoke_session_cleanup.ts … --delete` on a code line (an echoed manual command included). */
function cleanupFencesIn(text: string): Fence[] {
  return parseFences("shared-tracker-smoke", text).filter((f) => f.lines.some((l) => !/^\s*#/.test(l) && /smoke_session_cleanup\.ts/.test(l) && /--delete\b/.test(l)));
}

/**
 * AC.15 — the session cleanup fence, read as structure rather than as words
 * present. Each violation is tagged with the property it breaks:
 *   gate:  the one executed `--delete` runs only in the then-branch of
 *          `if [ "${OUTCOME}" = "pass" ]`, OUTCOME read from the verdict
 *          artifact; the other branch deletes nothing and prints the command;
 *   order: the cleanup fence opens after the fence that extracts the bundle;
 *   ids:   the `--delete` is handed `"$@"`, built as one `--session` per id
 *          read from the run ledger for leg shared-<tracker>; no window flags.
 */
function cleanupViolations(text: string): string[] {
  const all = cleanupFencesIn(text);
  if (all.length !== 1) return [`count: ${all.length} fences call smoke_session_cleanup.ts --delete, not one`];
  const f = all[0]!;
  const v: string[] = [];
  const code = f.lines.map((l, i) => ({ l, i })).filter(({ l }) => !/^\s*#/.test(l));
  const runs = code.filter(({ l }) => /smoke_session_cleanup\.ts/.test(l) && /--delete\b/.test(l) && !/^\s*echo\b/.test(l));
  if (runs.length !== 1) return [...v, `gate: ${runs.length} executed --delete lines, not one`];
  const del = runs[0]!;
  // gate — the nearest unclosed `if` above the delete, with no else/elif/fi in between, compares OUTCOME to pass.
  let depth = 0;
  let opener: string | null = null;
  for (let i = del.i - 1; i >= 0; i--) {
    const l = f.lines[i]!.trim();
    if (/^fi\b/.test(l)) depth++;
    else if (/^(?:else|elif)\b/.test(l) && depth === 0) break;
    else if (/^if\b/.test(l)) {
      if (depth === 0) {
        opener = l;
        break;
      }
      depth--;
    }
  }
  if (opener === null) v.push("gate: the --delete is not inside an if branch; it runs on any outcome");
  else if (!/^if \[ "\$\{OUTCOME\}" = "?pass"? \]; then$/.test(opener)) v.push(`gate: the --delete's branch is not the pass verdict: ${opener}`);
  if (!code.some(({ l }) => /^OUTCOME=\$\(.*smoke_verdict\.ts["']?\s+outcome\b.*--artifact\b/.test(l.trim()))) v.push("gate: OUTCOME is not read from the verdict artifact");
  const elseAt = code.find(({ i, l }) => i > del.i && /^\s*else\b/.test(l));
  const fiAt = code.find(({ i, l }) => i > del.i && /^\s*fi\b/.test(l));
  if (!elseAt || !fiAt) v.push("gate: no other branch keeps the sessions and prints the manual command");
  else if (!f.lines.slice(elseAt.i + 1, fiAt.i).some((l) => /^\s*echo\b.*smoke_session_cleanup\.ts.*--delete\b/.test(l))) v.push("gate: the other branch does not print the manual cleanup command");
  // order
  const extract = parseFences("shared-tracker-smoke", text).find((x) => x.lines.some((l) => l.trim().startsWith(EXTRACT_TAG)));
  if (!extract) v.push("order: no fence extracts the evidence bundle");
  else if (f.openLine <= extract.openLine) v.push("order: session cleanup comes before the fence that extracts the evidence bundle");
  // ids
  const sids = code.find(({ l }) => /^\s*SIDS=\$\(/.test(l));
  if (!sids || !/smoke_run_ledger\.ts["']?\s+sessions\b[^\n]*--leg\s+["']?shared-\$\{TRACKER\}/.test(sids.l)) v.push("ids: SIDS is not read from the run ledger for leg shared-<tracker>");
  if (!/for SID in \$\{SIDS\}; do\s*\n\s*set -- "\$@" --session "\$\{SID\}"/.test(f.body)) v.push("ids: the ledger's ids are not turned into one --session each");
  if (!/"\$@"/.test(del.l)) v.push("ids: the --delete is not handed the ledger's --session ids");
  if (/--since\b|--until\b|--manual\b/.test(f.body)) v.push("ids: the cleanup falls back to window inference");
  return v;
}

const tagged = (vs: string[], tag: string) => vs.filter((x) => x.startsWith(`${tag}:`));

/** The document with the cleanup fence's body replaced by `edit(body)`; the edit must change it. */
function withCleanupBody(text: string, edit: (body: string) => string): string {
  const f = oneFence(text, CLEANUP_TAG);
  const next = edit(f.body);
  expect(next, "the cleanup-fence edit changes the fence").not.toBe(f.body);
  return text.replace(f.body, next);
}

describe("AC.15 — session cleanup runs on pass only, after extraction, handed the ledger's ids", () => {
  test("exactly one fence calls smoke_session_cleanup.ts --delete", () => {
    expect(cleanupFencesIn(docText()).length).toBe(1);
  });
  test("it is handed --session ids read from the run ledger for leg shared-<tracker>, never window inference", () => {
    const f = cleanupFencesIn(docText())[0]!;
    expect(f.body).toMatch(/smoke_run_ledger\.ts["']?\s+sessions\b[^\n]*--leg\s+["']?(?:shared-|\$\{?[A-Z_]+)/);
    expect(tagged(cleanupViolations(docText()), "ids")).toEqual([]);
  });
  test("it deletes only on a pass verdict", () => {
    expect(tagged(cleanupViolations(docText()), "gate")).toEqual([]);
  });
  test("it comes after the fence that extracts the evidence bundle", () => {
    expect(tagged(cleanupViolations(docText()), "order")).toEqual([]);
  });
  test("the closing summary prints the manual cleanup command and names unledgered-session", () => {
    const s = section(docText(), /closing/i);
    expect(s).toContain("smoke_session_cleanup");
    expect(s).toMatch(/--delete\b/);
    expect(s).toContain("unledgered-session");
  });
  test("PERMIT TWIN — the shipped cleanup fence has no violation at all", () => {
    expect(cleanupViolations(docText())).toEqual([]);
  });
  test("MUTATION — cleanup on any outcome (the pass test widened to any non-empty outcome) is red, though the words outcome and pass are still there", () => {
    const m = withCleanupBody(docText(), (b) => b.replace('if [ "${OUTCOME}" = "pass" ]; then', 'if [ -n "${OUTCOME}" ]; then'));
    const body = oneFence(m, CLEANUP_TAG).body;
    expect(/\boutcome\b/.test(body) && /["']?pass["']?/.test(body), "control: a presence scan still finds both words").toBe(true);
    expect(tagged(cleanupViolations(m), "gate")).toEqual(['gate: the --delete\'s branch is not the pass verdict: if [ -n "${OUTCOME}" ]; then']);
  });
  test("MUTATION — cleanup with the pass gate removed (the delete unconditional, no kept branch) is red", () => {
    const m = withCleanupBody(docText(), (b) => {
      const lines = b.split("\n");
      const i = lines.findIndex((l) => /^if \[ "\$\{OUTCOME\}" = "pass" \]; then$/.test(l));
      const j = lines.findIndex((l, k) => k > i && /^fi$/.test(l));
      expect(i >= 0 && j > i, "the pass branch is found").toBe(true);
      const del = lines.slice(i + 1, j).find((l) => /smoke_session_cleanup\.ts/.test(l) && !/^\s*echo\b/.test(l))!.trim();
      return [...lines.slice(0, i), del, ...lines.slice(j + 1)].join("\n");
    });
    expect(tagged(cleanupViolations(m), "gate")).toEqual([
      "gate: the --delete is not inside an if branch; it runs on any outcome",
      "gate: no other branch keeps the sessions and prints the manual command",
    ]);
  });
  test("MUTATION — the cleanup fence moved before the extract-and-grade fence is red", () => {
    const text = docText();
    const f = oneFence(text, CLEANUP_TAG);
    const x = oneFence(text, EXTRACT_TAG);
    const lines = text.split("\n");
    const block = lines.slice(f.openLine - 1, f.closeLine);
    const rest = [...lines.slice(0, f.openLine - 1), ...lines.slice(f.closeLine)];
    const m = [...rest.slice(0, x.openLine - 1), ...block, "", ...rest.slice(x.openLine - 1)].join("\n");
    expect(oneFence(m, CLEANUP_TAG).openLine, "control: the cleanup fence now opens first").toBeLessThan(oneFence(m, EXTRACT_TAG).openLine);
    expect(cleanupViolations(m)).toEqual(["order: session cleanup comes before the fence that extracts the evidence bundle"]);
  });
  test("MUTATION — a --delete not handed the ledger's session ids, or handed a window instead, is red", () => {
    const noIds = withCleanupBody(docText(), (b) => b.replace(/(smoke_session_cleanup\.ts"[^\n]*?) "\$@" --delete/, "$1 --delete"));
    expect(cleanupViolations(noIds)).toEqual(["ids: the --delete is not handed the ledger's --session ids"]);
    const windowed = withCleanupBody(docText(), (b) =>
      b
        .replace(/^SIDS=\$\(.*$/m, 'SIDS=""')
        .replace(/(smoke_session_cleanup\.ts"[^\n]*?) "\$@" --delete/, '$1 --since "${RUN_START_MS}" --delete'),
    );
    expect(tagged(cleanupViolations(windowed), "ids")).toEqual([
      "ids: SIDS is not read from the run ledger for leg shared-<tracker>",
      "ids: the --delete is not handed the ledger's --session ids",
      "ids: the cleanup falls back to window inference",
    ]);
    const otherLeg = withCleanupBody(docText(), (b) => b.replace('--leg "shared-${TRACKER}"', '--leg "${TRACKER}"'));
    expect(cleanupViolations(otherLeg)).toEqual(["ids: SIDS is not read from the run ledger for leg shared-<tracker>"]);
  });
});

const BUNDLE_MENTION = /tests\/fixtures\/shared-tracker-live\/[^\s`'")\]]*/g;

/** The numbered closing-accounting item whose bold label matches `label`, or null. */
function closingItem(text: string, label: RegExp): string | null {
  return section(text, /^## Phase 8\b/).split("\n").find((l) => /^\d+\.\s+\*\*/.test(l) && label.test(l)) ?? null;
}

/** AC.16 — every mention of the bundle root ends at a directory, and the closing accounting's run artifacts list the bundle directory. */
function bundleNamingViolations(text: string): string[] {
  const v: string[] = [];
  const hits = [...text.matchAll(BUNDLE_MENTION)].map((m) => m[0]);
  for (const h of hits.filter((x) => !x.endsWith("/"))) v.push(`a mention names a file inside the bundle directory: ${h}`);
  const item = closingItem(text, /\*\*Run artifacts\*\*/);
  if (item === null) v.push("the closing accounting has no Run artifacts item");
  else if (!/`[^`]*tests\/fixtures\/shared-tracker-live\/<tracker>-<date>-<nonce>\/`/.test(item)) v.push("the closing accounting's run artifacts do not list the evidence bundle directory");
  return v;
}

describe("AC.16 — the evidence bundle is named only as a directory", () => {
  test("every mention of tests/fixtures/shared-tracker-live/ ends at a directory, never a file inside it", () => {
    const hits = [...docText().matchAll(BUNDLE_MENTION)].map((m) => m[0]);
    expect(hits.length, "the document names the bundle directory").toBeGreaterThan(0);
    expect(bundleNamingViolations(docText())).toEqual([]);
  });
  test("MUTATION — a copy naming a FILE inside the bundle directory is red", () => {
    const text = docText();
    const dir = "`plugins/dev-process-toolkit/tests/fixtures/shared-tracker-live/<tracker>-<date>-<nonce>/` before any cleanup";
    expect(text.includes(dir), "Phase 6 names the bundle directory").toBe(true);
    const m = text.replace(dir, "`plugins/dev-process-toolkit/tests/fixtures/shared-tracker-live/<tracker>-<date>-<nonce>/bundle.json` before any cleanup");
    expect(bundleNamingViolations(m)).toEqual(["a mention names a file inside the bundle directory: tests/fixtures/shared-tracker-live/<tracker>-<date>-<nonce>/bundle.json"]);
  });
  test("MUTATION — a copy whose closing accounting omits the bundle is red, though the document still names the directory elsewhere", () => {
    const text = docText();
    const item = closingItem(text, /\*\*Run artifacts\*\*/)!;
    const m = text.replace(item, item.replace(/the evidence bundle directory `[^`]*`, /, ""));
    expect(m, "control: the edit landed").not.toBe(text);
    expect([...m.matchAll(BUNDLE_MENTION)].length, "control: other mentions of the directory remain").toBeGreaterThan(0);
    expect(bundleNamingViolations(m)).toEqual(["the closing accounting's run artifacts do not list the evidence bundle directory"]);
  });
});

/** AC.14 — the closing accounting's tracker-writes item lists every Linear issue the run created. */
function closingLinearIssueViolations(text: string): string[] {
  const item = closingItem(text, /\*\*Tracker writes\*\*/);
  if (item === null) return ["the closing accounting has no Tracker writes item"];
  return /\bOn Linear\b[^\n]*\bevery issue (?:the run )?created\b/.test(item) ? [] : ["the closing accounting's Tracker writes item does not list every Linear issue the run created"];
}

describe("AC.14 — the closing summary lists every Linear issue the run created", () => {
  test("the closing accounting's Tracker writes item lists every created Linear issue", () => {
    expect(closingLinearIssueViolations(docText())).toEqual([]);
  });
  test("MUTATION — a copy whose closing summary drops the created-issue listing is red, though Phase 5 still promises it", () => {
    const text = docText();
    const item = closingItem(text, /\*\*Tracker writes\*\*/)!;
    const m = text.replace(item, item.replace(", and every issue created, for archiving by hand", ""));
    expect(m, "control: the edit landed").not.toBe(text);
    expect(section(m, /^## Phase 5\b/), "control: Phase 5's promise is untouched").toMatch(/closing summary names every issue the run created/);
    expect(closingLinearIssueViolations(m)).toEqual(["the closing accounting's Tracker writes item does not list every Linear issue the run created"]);
    const gone = text.replace(`${item}\n`, "");
    expect(closingLinearIssueViolations(gone)).toEqual(["the closing accounting has no Tracker writes item"]);
  });
});

function closingBundleHashViolations(text: string): string[] {
  const item = closingItem(text, /\*\*Run artifacts\*\*/);
  if (item === null) return ["the closing accounting has no Run artifacts item"];
  return /`bundle-hash=`[^\n]*\bgrade\b/.test(item) ? [] : ["the closing accounting's Run artifacts item does not name the bundle-hash= line grade printed (the Live proof row's hash)"];
}

describe("STE-618 — the closing accounting names the hash the Live proof row records", () => {
  test("the Run artifacts item names the bundle-hash= line that grade printed", () => {
    expect(closingBundleHashViolations(docText())).toEqual([]);
  });
  test("MUTATION — a copy whose Run artifacts item drops the bundle-hash line is red", () => {
    const text = docText();
    const item = closingItem(text, /\*\*Run artifacts\*\*/)!;
    const m = text.replace(item, item.replace(/ The `bundle-hash=`[^\n]*/, ""));
    expect(m, "control: the edit landed").not.toBe(text);
    expect(closingBundleHashViolations(m)).toEqual(["the closing accounting's Run artifacts item does not name the bundle-hash= line grade printed (the Live proof row's hash)"]);
  });
});

const SKIP_LINE = "S8 skipped: repoint-space-not-given";

/**
 * AC.18 — the skip line, from the Phase 0 fence RUN and from the closing
 * accounting: a Jira run without the flag prints it; a Jira run with the flag,
 * and a Linear run, print no repoint-space-not-given at all; the closing
 * accounting's verdict item carries it.
 */
function skipLineViolations(text: string): string[] {
  const v: string[] = [];
  const without = runPhase0Full("jira", undefined, text);
  if (!without.out.split("\n").includes(SKIP_LINE)) v.push("Phase 0 on a Jira run without the flag does not print the skip line");
  const withFlag = runPhase0Full("jira", "DST2", text);
  if (/repoint-space-not-given/.test(withFlag.out)) v.push("Phase 0 on a Jira run given the flag prints repoint-space-not-given");
  if (/repoint-space-not-given/.test(runPhase0Full("linear", undefined, text).out)) v.push("Phase 0 on a Linear run prints repoint-space-not-given");
  const verdict = closingItem(text, /\*\*Verdict\*\*/);
  if (verdict === null || !verdict.includes(`\`${SKIP_LINE}\``)) v.push("the closing accounting's verdict item does not carry the skip line");
  return v;
}

describe("AC.18 — the repoint skip is printed in Phase 0 and in the closing summary", () => {
  test("Phase 0 names repoint-space-not-given", () => {
    expect(section(docText(), /phase 0\b/i)).toContain("repoint-space-not-given");
    const r = runPhase0Full("jira", undefined);
    expect(r.out.split("\n"), "the fence, run without the flag, prints the line").toContain(SKIP_LINE);
  });
  test("the closing summary names repoint-space-not-given", () => {
    expect(section(docText(), /closing/i)).toContain("repoint-space-not-given");
    expect(skipLineViolations(docText())).toEqual([]);
  });
  test("WITH-FLAG TWIN — a Jira run given --jira-repoint-from prints no repoint-space-not-given line and plans S8=run; a Linear run prints none either", () => {
    const r = runPhase0Full("jira", "DST2");
    expect(r.plan.S8).toBe("run");
    expect(r.out).not.toMatch(/repoint-space-not-given/);
    expect(r.out.split("\n")).toContain("S8 runs");
    expect(runPhase0Full("linear", undefined).out).not.toMatch(/repoint-space-not-given/);
  });
  test("MUTATION — a copy whose Phase 0 fence drops the skip line is red, though Phase 0's prose still names it", () => {
    const text = docText();
    const f = oneFence(text, "# shared-tracker-smoke: phase 0 —");
    const line = `  jira:) echo "${SKIP_LINE}" ;;`;
    expect(f.lines, "the fence prints the skip line from the case arm").toContain(line);
    const m = text.replace(f.body, f.body.replace(`${line}\n`, ""));
    expect(section(m, /phase 0\b/i), "control: the prose still names it").toContain("repoint-space-not-given");
    expect(skipLineViolations(m)).toEqual(["Phase 0 on a Jira run without the flag does not print the skip line"]);
  });
  test("MUTATION — a copy whose Phase 0 fence prints the skip line on every run is red on the with-flag twin", () => {
    const text = docText();
    const f = oneFence(text, "# shared-tracker-smoke: phase 0 —");
    const i = f.body.indexOf('case "${TRACKER}:${JIRA_REPOINT_FROM}" in');
    const j = f.body.indexOf("esac", i);
    expect(i > 0 && j > i, "the skip case is found").toBe(true);
    const m = text.replace(f.body, `${f.body.slice(0, i)}echo "${SKIP_LINE}"${f.body.slice(j + "esac".length)}`);
    expect(skipLineViolations(m)).toEqual(["Phase 0 on a Jira run given the flag prints repoint-space-not-given", "Phase 0 on a Linear run prints repoint-space-not-given"]);
  });
  test("MUTATION — a copy whose closing summary drops the skip line is red", () => {
    const text = docText();
    const item = closingItem(text, /\*\*Verdict\*\*/)!;
    const m = text.replace(item, item.replace(/ On a Jira run without `--jira-repoint-from`, the line `S8 skipped: repoint-space-not-given`\./, ""));
    expect(m, "control: the edit landed").not.toBe(text);
    expect(skipLineViolations(m)).toEqual(["the closing accounting's verdict item does not carry the skip line"]);
  });
});

// ===========================================================================
// AC.19 — the Falsifiability section is recorded
// ===========================================================================

describe("AC.19 — the FR records its falsifiability measurements", () => {
  test("STE-617.md carries a Falsifiability section naming every behavioural AC (1..18)", () => {
    const body = section(readSpecFile(repoRoot, "specs/frs", "STE-617.md").body, /^## Falsifiability\s*$/);
    const missing = Array.from({ length: 18 }, (_, i) => i + 1).filter((n) => !new RegExp(`\\bAC(?:-STE-617)?\\.${n}\\b`).test(body));
    expect(missing).toEqual([]);
  });
});

// ===========================================================================
// Adversarial audit (2026-09-21) — the document must let a live run pass its
// own grader (`shared_tracker_live_grader.ts`). Each check is a pure function
// of the document text, so every one is also run on a mutated copy that lacks
// the fix and shown to go red.
// ===========================================================================

interface StepRow {
  nums: number[];
  marker: string;
  root: string;
  client: string;
  prompt: string;
  raw: string;
}

/** The Phase 3 step table, one entry per row (a `4–5` row carries both numbers). */
function stepRows(text: string): StepRow[] {
  const rows: StepRow[] = [];
  for (const raw of section(text, /^## Phase 3\b/).split("\n")) {
    const m = /^\|\s*(\d+)(?:\s*[–-]\s*(\d+))?\s*\|/.exec(raw);
    if (!m) continue;
    const cells = raw.split("|").slice(1, -1).map((c) => c.trim());
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    rows.push({ nums: Array.from({ length: b - a + 1 }, (_, i) => a + i), marker: cells[1]!, root: cells[2]!, client: cells[3]!, prompt: cells.slice(4).join("|"), raw });
  }
  return rows;
}

function rowsOf(text: string, marker: string, root?: string): StepRow[] {
  return stepRows(text).filter((r) => r.marker === marker && (root === undefined || r.root === root));
}

/** The document with one row's prompt cell replaced — the mutation a check must catch. */
function withRowPrompt(text: string, marker: string, root: string, prompt: string): string {
  const hits = rowsOf(text, marker, root);
  expect(hits.length, `exactly one ${marker} row rooted in ${root}`).toBe(1);
  const r = hits[0]!;
  const cells = r.raw.split("|");
  const head = cells.slice(0, 5).join("|");
  return text.replace(r.raw, `${head}| ${prompt} |`);
}

function fencesTagged(text: string, tag: string): Fence[] {
  return parseFences("shared-tracker-smoke", text).filter((f) => f.info === "bash" && f.lines.some((l) => l.trim().startsWith(tag)));
}

function oneFence(text: string, tag: string): Fence {
  const hits = fencesTagged(text, tag);
  expect(hits.length, `exactly one bash fence tagged \`${tag}\``).toBe(1);
  return hits[0]!;
}

const allIndexes = (s: string, re: RegExp): number[] => [...s.matchAll(new RegExp(re.source, `${re.flags.replace("g", "")}g`))].map((m) => m.index!);

/** Every command in `cmds` appears once before the evidence and once after it. */
function refusedThenPermitted(prompt: string, cmds: RegExp[], evidence: RegExp, who: string): string[] {
  const ev = prompt.search(evidence);
  if (ev < 0) return [`${who}: the prompt never has the child create B's gate evidence (${evidence})`];
  const v: string[] = [];
  for (const c of cmds) {
    const at = allIndexes(prompt, c);
    if (!at.some((i) => i < ev)) v.push(`${who}: ${c} is not attempted before B's evidence`);
    if (!at.some((i) => i > ev)) v.push(`${who}: ${c} is not attempted again after B's evidence`);
  }
  return v;
}

const GIT_ENV = { GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@localhost", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@localhost" };

function sh(cwd: string, cmd: string[], env: Record<string, string> = {}): { code: number; out: string; err: string } {
  const r = spawnSync(cmd[0]!, cmd.slice(1), { cwd, env: { ...process.env, ...GIT_ENV, ...env }, encoding: "utf-8" });
  return { code: r.status ?? -1, out: r.stdout ?? "", err: r.stderr ?? "" };
}

function gitRepo(dir: string, files: Record<string, string>): void {
  mkdirSync(dir, { recursive: true });
  sh(dir, ["git", "-c", "init.defaultBranch=main", "init", "-q"]);
  for (const [p, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), body);
  }
  sh(dir, ["git", "add", "-A"]);
  sh(dir, ["git", "-c", "commit.gpgsign=false", "commit", "-qm", "chore: seed"]);
}

/** Run a non-spawning operator fence from a file, /tmp rebased into `tmp`, with real git and bun. */
function runOperatorFence(body: string, tmp: string, cwd: string): { code: number; out: string; err: string } {
  expect(body, "an operator fence starts no child").not.toMatch(/\bclaude\s+-p\b/);
  const file = join(tmp, `fence-${Math.random().toString(36).slice(2)}.sh`);
  writeFileSync(file, body.replaceAll("<tracker>", "jira").replaceAll("/tmp/", `${tmp}/`));
  return sh(cwd, ["bash", file], { PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ""}` });
}

function expectNfr10(err: string, tail = false): void {
  // `tail`: a failed command's own stderr may come first; the refusal is the last three lines.
  const all = err.replace(/\n+$/, "").split("\n").filter((l) => l.trim() !== "");
  const lines = tail ? all.slice(-3) : all;
  expect(lines.length, err).toBe(3);
  expect(lines[0]!).toMatch(/^\/shared-tracker-smoke: /);
  expect(lines[1]!).toMatch(/^Remedy: /);
  expect(lines[2]!).toMatch(/^Context: .*skill=shared-tracker-smoke/);
}

// --- item 1: S14 matches the grader's S14 predicate and order ---------------

function s14Violations(text: string): string[] {
  const v: string[] = [];
  const b = rowsOf(text, "S14", "B");
  const a = rowsOf(text, "S14", "A");
  const join = rowsOf(text, "S3", "B");
  const s2 = rowsOf(text, "S2");
  if (b.length !== 1 || a.length !== 1 || join.length !== 1 || s2.length !== 1) return [`expected one S14/B, one S14/A, one S3/B and one S2 row; found ${b.length}, ${a.length}, ${join.length}, ${s2.length}`];
  const pb = b[0]!.prompt;
  if (!/attach_project_milestone\.ts/.test(pb)) v.push("B's S14 step runs no attach_project_milestone.ts");
  if (/decide the join|--join-key|resolve_milestone_identity/i.test(pb)) v.push("B's S14 step decides a join itself (the join is S3's, after A's held release)");
  if (/\bcreate it\b/i.test(pb) || !/creates nothing/i.test(pb)) v.push("B's S14 step does not forbid every create after its refused attach");
  const pa = a[0]!.prompt;
  if (!/sibling_release\.ts/.test(pa)) v.push("A's S14 step runs no sibling_release.ts");
  if (!/names A back/.test(pa)) v.push("A's S14 step is not placed before B's plan names A back");
  if (!(b[0]!.nums[0]! < a[0]!.nums[0]! && a[0]!.nums[0]! < join[0]!.nums[0]!)) v.push("order: B's refused attach, then A's held release, then B's join (S3) is not kept");
  if (!(s2[0]!.nums.at(-1)! > join[0]!.nums[0]!)) v.push("S2's create in B does not follow B's join");
  if (!/S14's permit twin/.test(s2[0]!.prompt)) v.push("S2's B create is not named as S14's permit twin (S14 spends no extra issue)");
  if (!/spans_repos\.ts\b.*--declare <A>/.test(join[0]!.prompt)) v.push("B's join step never makes B's plan name A back");
  return v;
}

describe("audit item 1 — S14's steps are the grader's S14 predicate, in its order", () => {
  test("the document's S14 steps: B's attach refused with nothing created, A's release held one-sided, then S3's join, then S2's create", () => {
    expect(s14Violations(docText())).toEqual([]);
  });
  test("MUTATION — the old step 7 (decide the join and create it) is red", () => {
    const old = withRowPrompt(docText(), "S14", "B", "Plan a new FR in A's milestone container before B has decided a join, then decide the join by key and create it.");
    expect(s14Violations(old).some((x) => /decides a join/.test(x))).toBe(true);
    expect(s14Violations(old).some((x) => /forbid every create/.test(x))).toBe(true);
  });
  test("MUTATION — A's release step without the before-the-back-reference clause is red", () => {
    const m = withRowPrompt(docText(), "S14", "A", "Run `sibling_release.ts` for the span milestone.");
    expect(s14Violations(m)).toContain("A's S14 step is not placed before B's plan names A back");
  });
});

// --- item 2: S5's permit twin is set up (B's FR archived, committed) ---------

const S5_ARCHIVE_TAG = "# shared-tracker-smoke: S5 archive";

function s5Violations(text: string): string[] {
  const v: string[] = [];
  const s5 = rowsOf(text, "S5", "A");
  if (s5.length !== 2) return [`expected two S5 rows rooted in A, found ${s5.length}`];
  const [busy, twin] = s5 as [StepRow, StepRow];
  const hits = fencesTagged(text, S5_ARCHIVE_TAG);
  if (hits.length !== 1) return [...v, `expected one fence tagged ${S5_ARCHIVE_TAG}, found ${hits.length}`];
  const f = hits[0]!;
  if (!/\bROOT_B\b/.test(f.body) || !/commit\b[^\n]*archive/i.test(f.body)) v.push("the archive fence makes no archive commit in B");
  if (!new RegExp(`step ${busy.nums[0]}\\b[^\\n]*step ${twin.nums[0]}\\b`).test(f.region)) v.push(`the archive fence is not placed between step ${busy.nums[0]} and step ${twin.nums[0]}`);
  const phase4 = text.split("\n").findIndex((l) => /^## Phase 4\b/.test(l)) + 1;
  if (!(f.openLine < phase4)) v.push("the archive fence sits after Phase 3");
  if (!/archived/i.test(twin.prompt)) v.push("the S5 permit twin's step does not say B's FR is archived first");
  return v;
}

function archiveOutcome(root: string): string[] {
  const v: string[] = [];
  if (!existsSync(join(root, "specs", "frs", "archive", "fr-s2.md"))) v.push("fr-s2.md is not under specs/frs/archive/");
  else if (!/^status: archived$/m.test(readFileSync(join(root, "specs", "frs", "archive", "fr-s2.md"), "utf-8"))) v.push("the archived FR does not read status: archived");
  if (existsSync(join(root, "specs", "frs", "fr-s2.md"))) v.push("fr-s2.md is still active");
  if (!existsSync(join(root, "specs", "frs", "fr-s1.md"))) v.push("an FR bound to another milestone was moved");
  if (!/archive/i.test(sh(root, ["git", "log", "-1", "--format=%s"]).out)) v.push("B's last commit is not an archive commit (the grader requires one before the twin)");
  if (sh(root, ["git", "status", "--porcelain", "--", "specs/frs"]).out.trim() !== "") v.push("the archive is not committed");
  return v;
}

function withArchiveSandbox(f: (t: { tmp: string; b: string; body: string }) => void, body = oneFence(docText(), S5_ARCHIVE_TAG).body): void {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ste617-s5-")));
  try {
    const tmp = join(root, "tmp");
    const b = join(root, "B");
    mkdirSync(tmp, { recursive: true });
    gitRepo(b, { "CLAUDE.md": "# B\n" });
    const fr = (ms: string) => `---\ntitle: x\nmilestone: ${ms}\nstatus: active\narchived_at: null\n---\n\n# x\n`;
    mkdirSync(join(b, "specs", "frs"), { recursive: true });
    writeFileSync(join(b, "specs", "frs", "fr-s2.md"), fr("M_span01"));
    writeFileSync(join(b, "specs", "frs", "fr-s1.md"), fr("M_other9"));
    writeFileSync(join(tmp, "dpt-shared-jira-run.env"), `TRACKER=jira\nROOT_B=${b}\nPLUGIN_TREE=${pluginRoot}\n`);
    f({ tmp, b, body: body.replace(/^SPAN_TOKEN=.*$/m, 'SPAN_TOKEN="M_span01"') });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("audit item 2 — S5's permit twin is set up: B's span FR archived and committed between the two S5 steps", () => {
  test("the document places the archive fence between the busy step and the permit twin", () => {
    expect(s5Violations(docText())).toEqual([]);
  });
  test("run: the archive fence archives B's active FR bound to the span token, commits it with an archive subject, leaves other FRs", () => {
    withArchiveSandbox(({ tmp, b, body }) => {
      const r = runOperatorFence(body, tmp, b);
      expect(r.code, `${r.out}\n${r.err}`).toBe(0);
      expect(archiveOutcome(b)).toEqual([]);
    });
  });
  test("REFUSAL twin — no active FR bound to the span token: refused in NFR-10 shape, no commit made", () => {
    withArchiveSandbox(({ tmp, b, body }) => {
      rmSync(join(b, "specs", "frs", "fr-s2.md"));
      const head = sh(b, ["git", "rev-parse", "HEAD"]).out;
      const r = runOperatorFence(body, tmp, b);
      expect(r.code).not.toBe(0);
      expectNfr10(r.err);
      expect(sh(b, ["git", "rev-parse", "HEAD"]).out).toBe(head);
    });
  });
  test("MUTATION — an archive fence that never commits is red (the grader needs B's archive commit)", () => {
    const body = oneFence(docText(), S5_ARCHIVE_TAG).body.split("\n").filter((l) => !/\bcommit\b/.test(l) || /^\s*#/.test(l)).join("\n");
    withArchiveSandbox(({ tmp, b, body: mutated }) => {
      runOperatorFence(mutated, tmp, b);
      expect(archiveOutcome(b).some((x) => /archive commit|not committed/.test(x))).toBe(true);
    }, body);
  });
  test("MUTATION — a document with no archive fence is red", () => {
    const text = docText();
    const f = oneFence(text, S5_ARCHIVE_TAG);
    const lines = text.split("\n");
    const cut = [...lines.slice(0, f.openLine - 1), ...lines.slice(f.closeLine)].join("\n");
    expect(s5Violations(cut).length).toBeGreaterThan(0);
  });
});

// --- item 3: S12 and S17 create B's gate evidence inside their sessions -----

const GATE_EVIDENCE = /\/dev-process-toolkit:gate-check <B>[^|]*gate_receipt\.ts gate-check <B>/;

function s12s17Violations(text: string): string[] {
  const v: string[] = [];
  const s12 = rowsOf(text, "S12", "A");
  const s17 = rowsOf(text, "S17", "A");
  if (s12.length !== 1 || s17.length !== 1) return [`expected one S12 and one S17 row rooted in A, found ${s12.length} and ${s17.length}`];
  v.push(...refusedThenPermitted(s12[0]!.prompt, [/git -C <B> commit\b/, /cd <B> && gh pr create\b/], GATE_EVIDENCE, "S12"));
  v.push(...refusedThenPermitted(s17[0]!.prompt, [/git -C <B> merge --no-ff feature-s17\b/, /git -C <B> ci\b/], GATE_EVIDENCE, "S17"));
  if (!/\/dev-process-toolkit:spec-review <B>/.test(s12[0]!.prompt)) v.push("S12: the PR into B has no spec-review evidence to meet after B's gate evidence");
  if (!/no other git command that writes into <B>/.test(s17[0]!.prompt)) v.push("S17: the prompt does not forbid other writing git runs into B (the grader grades every one)");
  const boot = oneFence(text, "# shared-tracker-smoke: bootstrap").body;
  if (!/git -C "\$\{ROOT_B\}" config alias\.ci commit/.test(boot)) v.push("bootstrap does not configure the ci alias in B");
  if (!/git -C "\$\{ROOT_B\}" branch feature-s17/.test(boot)) v.push("bootstrap does not create B's feature-s17 branch to merge");
  return v;
}

describe("audit item 3 — S12 and S17 each create B's gate evidence between the refused and the permitted attempts", () => {
  test("the document's S12 and S17 prompts, and bootstrap's alias and topic branch", () => {
    expect(s12s17Violations(docText())).toEqual([]);
  });
  test("MUTATION — the old S12 prompt (no step creates B's evidence) is red", () => {
    const m = withRowPrompt(docText(), "S12", "A", "Commit into B and open a PR into B from this session; after B's own gate evidence exists, do both again.");
    expect(s12s17Violations(m).some((x) => /S12: the prompt never has the child create B's gate evidence/.test(x))).toBe(true);
  });
  test("MUTATION — the old S17 prompt is red, and so is a prompt whose aliased commit comes only after the evidence", () => {
    const old = withRowPrompt(docText(), "S17", "A", "Run one `git -C <B> merge --no-ff` and one aliased commit into B; after B's evidence exists, repeat both.");
    expect(s12s17Violations(old).some((x) => /^S17:/.test(x))).toBe(true);
    const late = withRowPrompt(docText(), "S17", "A", "(1) Run `git -C <B> merge --no-ff feature-s17 -m m`. (2) Run `/dev-process-toolkit:gate-check <B>` (it runs `gate_receipt.ts gate-check <B>`). (3) Run `git -C <B> merge --no-ff feature-s17 -m m` and `git -C <B> ci --allow-empty -m c`. Run no other git command that writes into <B>.");
    expect(s12s17Violations(late)).toContain("S17: /git -C <B> ci\\b/ is not attempted before B's evidence");
  });
  test("MUTATION — a bootstrap without the ci alias is red", () => {
    const text = docText();
    const m = text.replace(/^git -C "\$\{ROOT_B\}" config alias\.ci commit\n/m, "");
    expect(m).not.toBe(text);
    expect(s12s17Violations(m)).toContain("bootstrap does not configure the ci alias in B");
  });
});

// --- item 4: S11 exercises the relocated checkout and the unreadable declaration

const S11_TAG = "# shared-tracker-smoke: S11 worktree";

function s11Violations(text: string): string[] {
  const v: string[] = [];
  const rows = rowsOf(text, "S11");
  if (rows.length !== 1) return [`expected one S11 row, found ${rows.length}`];
  const r = rows[0]!;
  if (r.root !== "B-relocated") v.push(`S11's session is rooted in ${r.root}, not B's relocated worktree`);
  const p = r.prompt;
  const t = allIndexes(p, /\btransition\b/i);
  const chmod = p.search(/chmod 000 CLAUDE\.md/);
  if (chmod < 0) v.push("S11 never makes the worktree's declaration unreadable");
  if (!(t.some((i) => i < chmod) && t.some((i) => i > chmod))) v.push("S11 does not attempt a write both with the declaration readable and with it unreadable");
  if (!/with no front-door run/.test(p)) v.push("S11's writes are not unreceipted (a receipt would test something else)");
  const step = oneFence(text, "# shared-tracker-smoke: scenario step").body;
  if (!/B-relocated\) STEP_CWD="\$\{ROOT_B\}\/\.s11\/relocated"; STEP_MCP=B/.test(step)) v.push("the step fence cannot start a child in B's relocated worktree");
  const setup = fencesTagged(text, S11_TAG);
  if (setup.length !== 1) v.push(`expected one fence tagged ${S11_TAG}, found ${setup.length}`);
  else {
    if (!/worktree add/.test(setup[0]!.body)) v.push("the S11 setup fence makes no worktree");
    if (!new RegExp(`before step ${r.nums[0]}\\b`, "i").test(setup[0]!.region)) v.push(`the S11 setup fence is not placed before step ${r.nums[0]}`);
  }
  if (!/pre-declaration[^\n]*AC-STE-616\.10/.test(section(text, /^## Phase 3\b/))) v.push("the pre-declaration half is dropped silently (it must be named, with its reason)");
  return v;
}

function withS11Sandbox(f: (t: { tmp: string; b: string; body: string }) => void, body = oneFence(docText(), S11_TAG).body): void {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ste617-s11-")));
  try {
    const tmp = join(root, "tmp");
    const b = join(root, "B");
    mkdirSync(tmp, { recursive: true });
    gitRepo(b, { "CLAUDE.md": "# B\n\nproject: PRE\n" });
    // S8's repoint rewrites the declaration and leaves it uncommitted.
    writeFileSync(join(b, "CLAUDE.md"), "# B\n\nproject: SHARED\n");
    writeFileSync(join(tmp, "dpt-shared-jira-run.env"), `TRACKER=jira\nROOT_B=${b}\n`);
    f({ tmp, b, body });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function relocatedOutcome(b: string): string[] {
  const w = join(b, ".s11", "relocated");
  const v: string[] = [];
  if (!existsSync(w)) return ["no relocated worktree"];
  if (sh(w, ["git", "rev-parse", "--show-toplevel"]).out.trim() !== w) v.push("the worktree's top level is not its own path");
  const common = sh(w, ["git", "rev-parse", "--path-format=absolute", "--git-common-dir"]).out.trim();
  if (common !== join(b, ".git")) v.push(`the worktree is not a worktree of B (common dir ${common})`);
  if (readFileSync(join(w, "CLAUDE.md"), "utf-8") !== readFileSync(join(b, "CLAUDE.md"), "utf-8")) v.push("the worktree does not carry B's current declaration");
  if (sh(b, ["git", "status", "--porcelain"]).out.trim() !== "") v.push("B's own tree is not clean after the setup");
  return v;
}

describe("audit item 4 — S11 exercises the relocated checkout and the unreadable declaration, graded by writesRefused", () => {
  test("the document's S11 step, its setup fence and the step fence's relocated root", () => {
    expect(s11Violations(docText())).toEqual([]);
  });
  test("run: the setup fence makes a worktree of B at another path carrying B's CURRENT declaration, B's tree left clean", () => {
    withS11Sandbox(({ tmp, b, body }) => {
      const r = runOperatorFence(body, tmp, b);
      expect(r.code, `${r.out}\n${r.err}`).toBe(0);
      expect(relocatedOutcome(b)).toEqual([]);
    });
  });
  test("REFUSAL twin — B is not its own repository but sits INSIDE another one: refused in NFR-10 shape, no worktree, nothing committed to the enclosing repository", () => {
    withS11Sandbox(({ tmp, b, body }) => {
      // Bun 1.3.14's rmSync fails on a git-created .git (ENOENT, which `force`
      // swallows), leaving a partial repository behind; the system rm is reliable.
      spawnSync("rm", ["-rf", join(b, ".git")]);
      expect(existsSync(join(b, ".git")), "B's .git was not removed").toBe(false);
      // The enclosing directory becomes a repository: a check that only asks
      // "is there a git directory somewhere up the path" passes here, and would
      // then commit B's declaration into this foreign repository.
      const outer = dirname(b);
      sh(outer, ["git", "init", "-q"]);
      sh(outer, ["git", "-c", "user.email=f@example.invalid", "-c", "user.name=f", "-c", "commit.gpgsign=false", "commit", "-q", "--allow-empty", "-m", "outer"]);
      const before = sh(outer, ["git", "rev-list", "--count", "HEAD"]).out.trim();
      const r = runOperatorFence(body, tmp, b);
      expect(r.code).not.toBe(0);
      expectNfr10(r.err);
      expect(existsSync(join(b, ".s11", "relocated"))).toBe(false);
      expect(sh(outer, ["git", "rev-list", "--count", "HEAD"]).out.trim(), "the enclosing repository gained a commit").toBe(before);
    });
  });
  test("REFUSAL twin — B is not a git repository: refused in NFR-10 shape, no worktree", () => {
    withS11Sandbox(({ tmp, b, body }) => {
      // Bun 1.3.14's rmSync fails on a git-created .git (ENOENT, which `force`
      // swallows), leaving a partial repository behind; the system rm is reliable.
      spawnSync("rm", ["-rf", join(b, ".git")]);
      expect(existsSync(join(b, ".git")), "B's .git was not removed").toBe(false);
      const r = runOperatorFence(body, tmp, b);
      expect(r.code).not.toBe(0);
      expectNfr10(r.err);
      expect(existsSync(join(b, ".s11", "relocated"))).toBe(false);
    });
  });
  test("MUTATION — a setup fence that does not commit B's repointed declaration first is red (the worktree would read the stale one)", () => {
    const body = oneFence(docText(), S11_TAG).body.split("\n").filter((l) => !/git -C "\$\{ROOT_B\}" (?:add CLAUDE\.md|-c commit\.gpgsign=false commit)/.test(l)).join("\n");
    withS11Sandbox(({ tmp, b, body: mutated }) => {
      runOperatorFence(mutated, tmp, b);
      expect(relocatedOutcome(b).length).toBeGreaterThan(0);
    }, body);
  });
  test("MUTATION — the old S11 step (A transitions B's S2 ticket; no worktree) is red", () => {
    const m = withRowPrompt(docText(), "S11", "B-relocated", "Transition B's S2 ticket.");
    expect(s11Violations(m).some((x) => /unreadable/.test(x))).toBe(true);
  });
});

// --- item 6 + 7: the step and audit fences fail closed, and send the operator to teardown

const RUN_ID = "11111111-2222-4333-8444-555555555555";

function writeStubRunEnv(sb: StubSandbox, over: Record<string, string | undefined>): void {
  const base: Record<string, string | undefined> = {
    TRACKER: "jira",
    TOPLEVEL: sb.work,
    ROOT_A: join(sb.root, "A"),
    ROOT_B: join(sb.root, "B"),
    PLUGIN_TREE: join(sb.work, "plugins", "dev-process-toolkit"),
    PLUGIN_BELOW_FLOOR: join(sb.root, "below"),
    PLUGIN_INTRUDER: join(sb.root, "intruder"),
    OLD_CLIENT: join(sb.root, "old"),
    DPT_SMOKE_RUN_ID: RUN_ID,
    NONCE: "shr0000abcd",
    SPAWN_CEILING: "28",
    ...over,
  };
  for (const d of ["A", "B"]) mkdirSync(join(sb.root, d), { recursive: true });
  mkdirSync(join(sb.root, "B", ".s11", "relocated"), { recursive: true });
  const lines = Object.entries(base).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${v}`);
  writeFileSync(join(sb.tmp, "dpt-shared-jira-run.env"), `${lines.join("\n")}\n`);
}

type SpawnKind = "step" | "audit";

function spawnScript(sb: StubSandbox, kind: SpawnKind, text = docText()): string {
  const tag = kind === "step" ? "# shared-tracker-smoke: scenario step" : "# shared-tracker-smoke: audit";
  let body = oneFence(text, tag).body.replaceAll("<tracker>", "jira");
  body = kind === "step"
    ? body
        .replace(/^STEP_NAME=.*$/m, 'STEP_NAME="4-S1"')
        .replace(/^STEP_MARKER=.*$/m, 'STEP_MARKER="S1"')
        .replace(/^STEP_ROOT=.*$/m, 'STEP_ROOT="A"')
        .replace(/^STEP_CLIENT=.*$/m, 'STEP_CLIENT="tree"')
    : body.replace(/^AUDIT_PASS=.*$/m, 'AUDIT_PASS="1"');
  return rebaseIntoStub(body, sb);
}

function withStub(f: (sb: StubSandbox) => void): void {
  const sb = makeStubSandbox("record");
  try {
    f(sb);
  } finally {
    reapStubSandbox(sb);
  }
}

const OWED = (sb: StubSandbox) => join(sb.tmp, "dpt-shared-jira-teardown-owed");

describe("audit items 6 + 7 — the step and audit fences refuse before spawning when the ledger or the ceiling cannot be trusted", () => {
  const cases: Array<[string, Record<string, string | undefined>, RegExp]> = [
    ["ledger-unreadable — the run ledger read fails (a failed read is not zero sessions)", { TOPLEVEL: "/nonexistent-ste617-toolkit" }, /ledger/i],
    ["ceiling-unset — SPAWN_CEILING is absent from the run state", { SPAWN_CEILING: undefined }, /SPAWN_CEILING/],
    ["ceiling-not-a-number — SPAWN_CEILING is not a whole number", { SPAWN_CEILING: "twenty" }, /SPAWN_CEILING/],
    ["spawn-overrun — the ledger already holds the ceiling (CONTROL: it refused before the audit too)", { SPAWN_CEILING: "0" }, /spawn-overrun/],
  ];
  for (const kind of ["step", "audit"] as const) {
    for (const [name, over, why] of cases) {
      test(`${kind} fence refusal — ${name}: NFR-10, names Phase 5 teardown, no append, no child`, () => {
        withStub((sb) => {
          writeStubRunEnv(sb, over);
          const r = runStubScript(sb, spawnScript(sb, kind), stubEnv(sb));
          const dump = `exit=${r.exitCode}\n${r.out}\n${r.err}`;
          expect(r.exitCode, dump).not.toBe(0);
          const calls = readStubCalls(sb);
          expect(calls.filter((c) => c.kind === "claude"), dump).toEqual([]);
          expect(calls.filter((c) => c.kind === "bun" && /smoke_run_ledger\.ts["']?\s+append\b/.test(c.args)), dump).toEqual([]);
          expectNfr10(r.err, true);
          expect(r.err).toMatch(why);
          expect(r.err, "a refusal sends the operator to teardown (audit item 7)").toMatch(/Phase 5/);
          expect(existsSync(OWED(sb)), "a refused step writes no teardown-owed marker").toBe(false);
        });
      });
    }
    test(`${kind} fence PERMIT TWIN — a readable empty ledger under a numeric ceiling appends, then starts exactly one child`, () => {
      withStub((sb) => {
        writeStubRunEnv(sb, {});
        const r = runStubScript(sb, spawnScript(sb, kind), stubEnv(sb));
        expect(r.exitCode, `${r.out}\n${r.err}`).toBe(0);
        const calls = readStubCalls(sb);
        const claude = calls.filter((c) => c.kind === "claude");
        expect(claude.length).toBe(1);
        expect(claude[0]!.args).toMatch(/--session-id\s+[0-9a-f-]{36}/);
        const append = calls.find((c) => c.kind === "bun" && /smoke_run_ledger\.ts["']?\s+append\b/.test(c.args));
        expect(append && append.index < claude[0]!.index).toBe(true);
        expect(r.out).toMatch(/^launched=1 live=1$/m);
        if (kind === "step") expect(existsSync(OWED(sb)), "the step fence records that teardown is now owed").toBe(true);
      });
    });
  }
  test("MUTATION — the old ledger count (`| grep -c .`, no ceiling check) spawns on an unreadable ledger and on an unset ceiling", () => {
    const text = docText();
    const f = oneFence(text, "# shared-tracker-smoke: scenario step");
    const oldBody = [
      'LEDGERED=$(bun "${TOPLEVEL}/plugins/dev-process-toolkit/adapters/_shared/src/smoke_run_ledger.ts" sessions --project-root "${TOPLEVEL}" --run "${DPT_SMOKE_RUN_ID}" --leg "${DPT_SMOKE_LEG}" | grep -c .)',
      'if [ "${LEDGERED}" -ge "${SPAWN_CEILING}" ]; then',
      '  echo "/shared-tracker-smoke: spawn-overrun" >&2',
      "  exit 1",
      "fi",
    ].join("\n");
    const start = f.body.indexOf("# The ceiling");
    const end = f.body.indexOf("LAUNCHED=0");
    expect(start > 0 && end > start, "the step fence's ceiling block is found").toBe(true);
    // The run-state preamble also refuses an absent SPAWN_CEILING; the old fence had neither guard.
    const oldFence = `${f.body.slice(0, start)}${oldBody}\n${f.body.slice(end)}`.replace(/^(RUN_STATE_NEEDS="[^"]*)\bSPAWN_CEILING /m, "$1");
    expect(oldFence, "control: SPAWN_CEILING is dropped from the step fence's declared run state").not.toMatch(/^RUN_STATE_NEEDS="[^"]*\bSPAWN_CEILING\b/m);
    const mutated = text.replace(f.body, oldFence);
    for (const over of [{ TOPLEVEL: "/nonexistent-ste617-toolkit" }, { SPAWN_CEILING: undefined }]) {
      withStub((sb) => {
        writeStubRunEnv(sb, over);
        runStubScript(sb, spawnScript(sb, "step", mutated), stubEnv(sb));
        expect(readStubCalls(sb).filter((c) => c.kind === "claude").length, JSON.stringify(over)).toBe(1);
      });
    }
  });
});

function teardownViolations(text: string): string[] {
  const v: string[] = [];
  const p5 = section(text, /^## Phase 5\b/);
  if (/once bootstrap has made its first tracker write/.test(p5)) v.push("Phase 5 keys teardown on a bootstrap tracker write, which never happens on Jira");
  if (!/first scenario spawn/.test(p5) || !/teardown-owed/.test(p5)) v.push("Phase 5 does not key teardown on the first scenario spawn (the teardown-owed marker)");
  const step = oneFence(text, "# shared-tracker-smoke: scenario step").body;
  const owed = step.search(/teardown-owed/);
  const spawn = step.search(/^claude -p\b/m);
  if (owed < 0 || !(owed < spawn)) v.push("the step fence does not record that teardown is owed before it spawns");
  const cap = section(text, /^## Phase 3\b/).split("\n").filter((l) => /linear-free-issue-limit/.test(l));
  if (cap.length === 0 || !cap.every((l) => /Phase 5/.test(l))) v.push("the Linear free-issue-limit stop does not send the operator to teardown");
  for (const tag of ["# shared-tracker-smoke: scenario step", "# shared-tracker-smoke: audit"]) {
    const b = oneFence(text, tag).body;
    for (const l of b.split("\n").filter((x) => /spawn-overrun|spawn count mismatch/.test(x) && !/^\s*#/.test(x))) {
      if (!/Phase 5/.test(l)) v.push(`${tag}: a spawn refusal does not name Phase 5 teardown: ${l.trim()}`);
    }
  }
  return v;
}

describe("audit item 7 — teardown on every outcome, keyed on the first scenario spawn", () => {
  test("the document keys teardown on the first scenario spawn and every stop names Phase 5", () => {
    expect(teardownViolations(docText())).toEqual([]);
  });
  test("MUTATION — the old trigger sentence, and a free-issue-limit stop without teardown, are red", () => {
    const text = docText();
    const p5 = section(text, /^## Phase 5\b/);
    const m1 = text.replace(p5, `${p5}\nTeardown runs on every outcome once bootstrap has made its first tracker write, abort included.\n`);
    expect(teardownViolations(m1)).toContain("Phase 5 keys teardown on a bootstrap tracker write, which never happens on Jira");
    const capLine = section(text, /^## Phase 3\b/).split("\n").find((l) => /linear-free-issue-limit/.test(l))!;
    const m2 = text.replace(capLine, "On Linear the run never retries a create the free plan refused with a 400: the step ends there, and the grader aborts the leg as `linear-free-issue-limit`.");
    expect(teardownViolations(m2)).toContain("the Linear free-issue-limit stop does not send the operator to teardown");
  });
});

// --- item 8: Phase 0.5 checks the cwd before any rm, and never removes inside the toolkit

function phase05Script(sb: StubSandbox, cwd: string, text = docText()): string {
  const body = oneFence(text, "# shared-tracker-smoke: phase 0.5").body.replaceAll("<tracker>", "jira");
  return `cd ${JSON.stringify(cwd)} || exit 97\n${rebaseIntoStub(body, sb)}\n`;
}

function withPhase05(f: (t: { sb: StubSandbox; toolkit: string; parent: string; stale: string; plan: string }) => void): void {
  withStub((sb) => {
    const toolkit = realpathSync(sb.work);
    sh(toolkit, ["git", "-c", "init.defaultBranch=main", "init", "-q"]);
    mkdirSync(join(toolkit, "plugins", "dev-process-toolkit"), { recursive: true });
    const parent = dirname(toolkit);
    for (const s of ["a", "b"]) {
      mkdirSync(join(parent, `dpt-shared-jira-${s}`), { recursive: true });
      writeFileSync(join(parent, `dpt-shared-jira-${s}`, "keep.txt"), "old run\n");
    }
    const stale = join(sb.tmp, "dpt-shared-jira-4-S1.log");
    writeFileSync(stale, "stale\n");
    const plan = join(sb.tmp, "dpt-shared-jira-plan.env");
    writeFileSync(plan, "SPAWN_CEILING=28\n");
    f({ sb, toolkit, parent, stale, plan });
  });
}

describe("audit item 8 — Phase 0.5 refuses a wrong cwd before any rm, and never removes a path inside the toolkit", () => {
  test("refusal — run from plugins/dev-process-toolkit: NFR-10, exit non-zero, NOTHING removed, no run state", () => {
    withPhase05(({ sb, toolkit, parent, stale }) => {
      const r = runStubScript(sb, phase05Script(sb, join(toolkit, "plugins", "dev-process-toolkit")), stubEnv(sb));
      expect(r.exitCode, `${r.out}\n${r.err}`).not.toBe(0);
      expectNfr10(r.err);
      expect(existsSync(join(parent, "dpt-shared-jira-a", "keep.txt"))).toBe(true);
      expect(existsSync(join(parent, "dpt-shared-jira-b", "keep.txt"))).toBe(true);
      expect(existsSync(stale), "the stale scratch is not removed either").toBe(true);
      expect(existsSync(join(sb.tmp, "dpt-shared-jira-run.env"))).toBe(false);
      expect(readStubCalls(sb).filter((c) => c.kind === "claude")).toEqual([]);
    });
  });
  test("refusal — a throwaway path that resolves INSIDE the toolkit checkout (a link into it): refused, nothing removed", () => {
    withPhase05(({ sb, toolkit, parent }) => {
      rmSync(join(parent, "dpt-shared-jira-a"), { recursive: true, force: true });
      mkdirSync(join(toolkit, "inner"), { recursive: true });
      writeFileSync(join(toolkit, "inner", "precious.txt"), "tracked work\n");
      symlinkSync(join(toolkit, "inner"), join(parent, "dpt-shared-jira-a"));
      const r = runStubScript(sb, phase05Script(sb, toolkit), stubEnv(sb));
      expect(r.exitCode, `${r.out}\n${r.err}`).not.toBe(0);
      expectNfr10(r.err);
      expect(existsSync(join(toolkit, "inner", "precious.txt"))).toBe(true);
      expect(lstatSync(join(parent, "dpt-shared-jira-a")).isSymbolicLink()).toBe(true);
      expect(existsSync(join(parent, "dpt-shared-jira-b", "keep.txt")), "nothing at all is removed once one path refuses").toBe(true);
    });
  });
  test("PERMIT TWIN — run from the top level: both throwaways and the stale scratch go, the plan stays, the run state is written", () => {
    withPhase05(({ sb, toolkit, parent, stale, plan }) => {
      const r = runStubScript(sb, phase05Script(sb, toolkit), stubEnv(sb));
      expect(r.exitCode, `${r.out}\n${r.err}`).toBe(0);
      expect(existsSync(join(parent, "dpt-shared-jira-a"))).toBe(false);
      expect(existsSync(join(parent, "dpt-shared-jira-b"))).toBe(false);
      expect(existsSync(stale)).toBe(false);
      expect(existsSync(plan)).toBe(true);
      expect(readFileSync(join(sb.tmp, "dpt-shared-jira-run.env"), "utf-8")).toMatch(/^ROOT_A=.*dpt-shared-jira-a$/m);
    });
  });
  test("MUTATION — the old Phase 0.5 (rm first, no cwd check) removes the throwaways when run from a subdirectory", () => {
    const text = docText();
    const f = oneFence(text, "# shared-tracker-smoke: phase 0.5");
    const old = [
      "# shared-tracker-smoke: phase 0.5 — stale scratch out, run state in",
      'TRACKER="<tracker>"',
      "TOPLEVEL=$(git rev-parse --show-toplevel)",
      'PARENT=$(dirname "${TOPLEVEL}")',
      "for P in /tmp/dpt-shared-<tracker>-*; do",
      '  case "${P}" in /tmp/dpt-shared-<tracker>-plan.env) ;; *) rm -rf "${P}" ;; esac',
      "done",
      'rm -rf "${PARENT}/dpt-shared-${TRACKER}-a" "${PARENT}/dpt-shared-${TRACKER}-b"',
    ].join("\n");
    const mutated = text.replace(f.body, old);
    withPhase05(({ sb, toolkit, parent }) => {
      runStubScript(sb, phase05Script(sb, join(toolkit, "plugins", "dev-process-toolkit"), mutated), stubEnv(sb));
      expect(existsSync(join(parent, "dpt-shared-jira-a"))).toBe(false);
    });
  });
});

// --- item 9: Phase 0 prints tracker-appropriate item counts ----------------

function runPhase0(tracker: "jira" | "linear", repointFrom: string | undefined, text = docText()): Record<string, string> {
  return runPhase0Full(tracker, repointFrom, text).plan;
}

/** The Phase 0 fence run in a scratch /tmp: the plan it wrote and what it printed. */
function runPhase0Full(tracker: "jira" | "linear", repointFrom: string | undefined, text = docText()): { plan: Record<string, string>; out: string } {
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), "ste617-p0-")));
  try {
    const body = oneFence(text, "# shared-tracker-smoke: phase 0 —").body.replaceAll("<tracker>", tracker).replaceAll("/tmp/", `${tmp}/`);
    expect(body, "Phase 0 starts no child and writes no tracker").not.toMatch(/\bclaude\b/);
    const file = join(tmp, "phase0.sh");
    writeFileSync(file, body);
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !/JIRA|LINEAR|TRACKER/.test(k)) env[k] = v;
    env.PATH = `${dirname(process.execPath)}:${process.env.PATH ?? ""}`;
    if (repointFrom) env.JIRA_REPOINT_FROM = repointFrom;
    const r = spawnSync("bash", [file], { cwd: repoRoot, env, encoding: "utf-8" });
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
    const plan = readFileSync(join(tmp, `dpt-shared-${tracker}-plan.env`), "utf-8");
    return {
      plan: Object.fromEntries(plan.split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")])),
      out: r.stdout,
    };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

describe("fifth audit, the standing rule — Phase 0 and Phase 0.5 refuse when a precondition is omitted", () => {
  test("Phase 0 REFUSAL — a tracker that is neither jira nor linear writes no plan and refuses tracker-unknown in NFR-10 shape", () => {
    const tmp = realpathSync(mkdtempSync(join(tmpdir(), "ste617-p0bad-")));
    try {
      const body = oneFence(docText(), "# shared-tracker-smoke: phase 0 —").body.replaceAll("<tracker>", "github").replaceAll("/tmp/", `${tmp}/`);
      writeFileSync(join(tmp, "phase0.sh"), body);
      const r = spawnSync("bash", [join(tmp, "phase0.sh")], { cwd: repoRoot, env: { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ""}` }, encoding: "utf-8" });
      expect(r.status, `${r.stdout}\n${r.stderr}`).not.toBe(0);
      expectNfr10(r.stderr);
      expect(r.stderr).toMatch(/check=tracker-unknown/);
      expect(existsSync(join(tmp, "dpt-shared-github-plan.env")), "no plan was written").toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
  test("Phase 0 PERMIT TWIN — jira and linear each write a plan (runPhase0 asserts exit 0)", () => {
    expect(runPhase0("jira", undefined).SPAWN_CEILING).toMatch(/^\d+$/);
    expect(runPhase0("linear", undefined).SPAWN_CEILING).toMatch(/^\d+$/);
  });
  test("Phase 0.5 REFUSAL — no approved plan: plan-missing, nothing removed, no run state written", () => {
    withPhase05(({ sb, toolkit, parent, stale, plan }) => {
      rmSync(plan);
      const r = runStubScript(sb, phase05Script(sb, toolkit), stubEnv(sb));
      expect(r.exitCode, `${r.out}\n${r.err}`).not.toBe(0);
      expectNfr10(r.err);
      expect(r.err).toMatch(/check=plan-missing/);
      expect(existsSync(join(parent, "dpt-shared-jira-a", "keep.txt"))).toBe(true);
      expect(existsSync(stale)).toBe(true);
      expect(existsSync(join(sb.tmp, "dpt-shared-jira-run.env"))).toBe(false);
    });
  });
  test("Phase 0.5 REFUSAL — a plan with no whole-number SPAWN_CEILING: plan-missing", () => {
    withPhase05(({ sb, toolkit, plan }) => {
      writeFileSync(plan, "SPAWN_CEILING=NaN\n");
      const r = runStubScript(sb, phase05Script(sb, toolkit), stubEnv(sb));
      expect(r.exitCode).not.toBe(0);
      expect(r.err).toMatch(/check=plan-missing/);
    });
  });
  test("Phase 0.5 REFUSAL — <tracker> left unsubstituted: tracker-unknown, nothing removed", () => {
    withPhase05(({ sb, toolkit, parent }) => {
      const body = oneFence(docText(), "# shared-tracker-smoke: phase 0.5").body;
      const r = runStubScript(sb, `cd ${JSON.stringify(toolkit)} || exit 97\n${rebaseIntoStub(body, sb)}\n`, stubEnv(sb));
      expect(r.exitCode).not.toBe(0);
      expectNfr10(r.err);
      expect(r.err).toMatch(/check=tracker-unknown/);
      expect(existsSync(join(parent, "dpt-shared-jira-a", "keep.txt"))).toBe(true);
    });
  });
});

describe("audit item 9 — Phase 0's expected and worst-case item counts are the tracker's own", () => {
  test("jira with --jira-repoint-from: 8 expected Jira items (the S3 Epic counted), 11 at worst (+ S6, S7, S14)", () => {
    const p = runPhase0("jira", "DST2");
    expect([p.EXPECTED_ITEMS, p.WORST_CASE_ITEMS]).toEqual(["8", "11"]);
    expect(p.ITEM_UNIT).toMatch(/Jira/);
  });
  test("jira without the flag: the S8 legacy item is not created — 7 expected, 10 at worst", () => {
    const p = runPhase0("jira", undefined);
    expect([p.EXPECTED_ITEMS, p.WORST_CASE_ITEMS, p.S8]).toEqual(["7", "10", "skipped"]);
  });
  test("linear: the registry's LINEAR_ISSUE_BUDGET and linearWorstCase() — no Epic, a milestone is not an issue", async () => {
    const reg = await import("../adapters/_shared/src/shared_tracker_scenarios");
    const p = runPhase0("linear", undefined);
    expect([p.EXPECTED_ITEMS, p.WORST_CASE_ITEMS]).toEqual([String(reg.LINEAR_ISSUE_BUDGET), String(reg.linearWorstCase())]);
    expect(p.ITEM_UNIT).toMatch(/Linear/);
  });
  test("MUTATION — the old Phase 0 (Linear numbers printed on every tracker) is red on a Jira run with the repoint space", () => {
    const text = docText();
    const f = oneFence(text, "# shared-tracker-smoke: phase 0 —");
    const start = f.body.indexOf("PLAN=$(");
    const end = f.body.indexOf("printf '%s\\n' \"${PLAN}\" > ");
    expect(start > 0 && end > start, "Phase 0's PLAN block is found").toBe(true);
    const old = `PLAN=$(TRACKER="\${TRACKER}" REPOINT="\${JIRA_REPOINT_FROM}" REGISTRY="\${TOPLEVEL}/plugins/dev-process-toolkit/adapters/_shared/src/shared_tracker_scenarios.ts" bun -e '
const r = await import(process.env.REGISTRY);
console.log(\`SPAWN_CEILING=\${r.spawnCeiling(process.env.TRACKER)}\`);
console.log(\`EXPECTED_ITEMS=\${r.LINEAR_ISSUE_BUDGET}\`);
console.log(\`WORST_CASE_ITEMS=\${r.linearWorstCase()}\`);
')
`;
    const mutated = text.replace(f.body, `${f.body.slice(0, start)}${old}${f.body.slice(end)}`);
    const p = runPhase0("jira", "DST2", mutated);
    expect([p.EXPECTED_ITEMS, p.WORST_CASE_ITEMS]).not.toEqual(["8", "11"]);
  });
});

// ===========================================================================
// STE-618 follow-up — Phase 6 writes the verdict INTO the bundle directory
// (`verdict.json`, the file the live-proof gate reads), and every later reader
// of the verdict (Phase 6's echo, Phase 7's pass-only cleanup) reads that file.
// Graded from a RUN of the two fences with `bun` stubbed (record mode).
// ===========================================================================

interface VerdictPaths {
  out: string | null;
  verdict: string | null;
  phase6Read: string | null;
  phase7Read: string | null;
  dump: string;
}

/** Run Phase 6 then Phase 7 from `text` in one stub sandbox; the paths the recorded bun calls named. */
function verdictPathsFromRun(text: string): VerdictPaths {
  let res: VerdictPaths = { out: null, verdict: null, phase6Read: null, phase7Read: null, dump: "" };
  withStub((sb) => {
    // SHARED as bootstrap writes it to the run state (Phase 6 reads it from there and refuses an empty one).
    writeStubRunEnv(sb, { SHARED: "DST", DIGEST_AT_START: "a".repeat(64), RUN_START_MS: "1" });
    const env = stubEnv(sb);
    const r6 = runStubScript(sb, rebaseIntoStub(oneFence(text, EXTRACT_TAG).body.replaceAll("<tracker>", "jira"), sb), env);
    const after6 = readStubCalls(sb).length;
    const r7 = runStubScript(sb, rebaseIntoStub(oneFence(text, CLEANUP_TAG).body.replaceAll("<tracker>", "jira"), sb), env);
    const calls = readStubCalls(sb).filter((c) => c.kind === "bun");
    const grade = calls.find((c) => /shared_tracker_live_grader\.ts["']?\s+grade\b/.test(c.args));
    const extract = calls.find((c) => /shared_tracker_live_grader\.ts["']?\s+extract\b/.test(c.args));
    const reads = calls.filter((c) => /smoke_verdict\.ts["']?\s+outcome\b/.test(c.args));
    res = {
      out: extract ? flagValue(extract.args, "out") : null,
      verdict: grade ? flagValue(grade.args, "verdict") : null,
      phase6Read: reads.find((c) => c.index < after6) ? flagValue(reads.find((c) => c.index < after6)!.args, "artifact") : null,
      phase7Read: reads.find((c) => c.index >= after6) ? flagValue(reads.find((c) => c.index >= after6)!.args, "artifact") : null,
      dump: `phase6 exit=${r6.exitCode}\n${r6.out}\n${r6.err}\nphase7 exit=${r7.exitCode}\n${r7.out}\n${r7.err}\n${calls.map((c) => c.args).join("\n")}`,
    };
    res.dump += `\nsandbox work=${sb.work}`;
    if (res.out !== null) res.out = res.out.replace(sb.work, "<work>");
    if (res.verdict !== null) res.verdict = res.verdict.replace(sb.work, "<work>");
    if (res.phase6Read !== null) res.phase6Read = res.phase6Read.replace(sb.work, "<work>");
    if (res.phase7Read !== null) res.phase7Read = res.phase7Read.replace(sb.work, "<work>");
  });
  return res;
}

/** The violations: the verdict is not `<bundle dir>/verdict.json`, or a reader reads another file. */
function verdictPlacementViolations(p: VerdictPaths): string[] {
  const v: string[] = [];
  if (p.out === null) return ["the Phase 6 run made no extract call"];
  if (!/^<work>\/plugins\/dev-process-toolkit\/tests\/fixtures\/shared-tracker-live\/jira-\d{4}-\d{2}-\d{2}-shr0000abcd\/$/.test(p.out)) v.push(`the bundle directory is not under the toolkit's shared-tracker-live fixtures: ${p.out}`);
  const want = `${p.out}verdict.json`;
  if (p.verdict !== want) v.push(`grade writes the verdict to ${p.verdict}, not ${want}`);
  if (p.phase6Read !== want) v.push(`Phase 6 reads the outcome from ${p.phase6Read}, not ${want}`);
  if (p.phase7Read !== want) v.push(`Phase 7 reads the outcome from ${p.phase7Read}, not ${want}`);
  return v;
}

describe("STE-618 follow-up — Phase 6 writes verdict.json into the bundle directory", () => {
  test("RUN: grade writes <bundle dir>/verdict.json, and Phase 6's echo and Phase 7's cleanup read that same file", () => {
    const p = verdictPathsFromRun(docText());
    expect(verdictPlacementViolations(p), p.dump).toEqual([]);
  });
  test("MUTATION — a copy whose Phase 6 writes the verdict to /tmp is red", () => {
    const text = docText();
    const body = oneFence(text, EXTRACT_TAG).body;
    const m = text.replace(body, body.replaceAll('"${BUNDLE_DIR}verdict.json"', '"/tmp/dpt-smoke-verdict-shared-${TRACKER}.json"'));
    expect(m, "control: the edit landed").not.toBe(text);
    const v = verdictPlacementViolations(verdictPathsFromRun(m));
    expect(v.some((x) => /^grade writes the verdict to .*dpt-smoke-verdict-shared-jira\.json, not /.test(x)), JSON.stringify(v)).toBe(true);
  });
  test("MUTATION — a copy whose Phase 7 still reads the old /tmp artifact is red", () => {
    const text = docText();
    const body = oneFence(text, CLEANUP_TAG).body;
    const m = text.replace(body, body.replace(/--artifact "[^"]*"/, '--artifact "/tmp/dpt-smoke-verdict-shared-${TRACKER}.json"'));
    expect(m, "control: the edit landed").not.toBe(text);
    const v = verdictPlacementViolations(verdictPathsFromRun(m));
    expect(v.filter((x) => x.startsWith("Phase 7 reads"))).toHaveLength(1);
    expect(v.filter((x) => !x.startsWith("Phase 7 reads"))).toEqual([]);
  });
});

// ===========================================================================
// Live-run audit (2026-09-21, second pass) — five defects that would waste or
// invalidate a live run. Each is graded from a RUN of the document's fences
// under the STE-594 stubs (or real git for the operator fences), and each
// check is shown red on a mutated copy of the document.
// ===========================================================================

const STEP_TAG = "# shared-tracker-smoke: scenario step";
const AUDIT_TAG = "# shared-tracker-smoke: audit";
const IDLE_A_TAG = "# shared-tracker-smoke: S5 idle A";
const DRY_RUN_TAG = "# shared-tracker-smoke: privacy dry run";
const FILL = { nonce: "shr0000abcd", token: "M_span01", intruder: "DST-3", aS1: "DST-4" };

/**
 * A stub sandbox whose `claude` also saves its stdin (the child's prompt) to
 * `<envDir>/<pid>.stdin`, and whose `bun` answers the grader's `extract` as
 * `STUB_EXTRACT` says (ok | privacy | fail); every other bun call goes to the
 * STE-594 harness stub unchanged.
 */
function withCaptureStub(f: (sb: StubSandbox) => void): void {
  withStub((sb) => {
    const q = (x: string) => `'${x.replace(/'/g, `'\\''`)}'`;
    writeFileSync(
      join(sb.bin, "claude"),
      ["#!/bin/bash", `printf 'claude\\t%s\\t%s\\n' "$$" "$*" >> ${q(sb.calls)}`, `cat > ${q(sb.envDir)}/"$$".stdin`, "exec -a claude /bin/sleep 1.594", ""].join("\n"),
      { mode: 0o755 },
    );
    const harnessBun = join(sb.root, "bun-harness");
    writeFileSync(harnessBun, readFileSync(join(sb.bin, "bun"), "utf-8"), { mode: 0o755 });
    writeFileSync(
      join(sb.bin, "bun"),
      [
        "#!/bin/bash",
        'case "$*" in',
        "  *shared_tracker_live_grader.ts*extract*)",
        `    printf 'bun\\t%s\\t%s\\n' "$$" "$*" >> ${q(sb.calls)}`,
        '    case "${STUB_EXTRACT:-ok}" in',
        "      privacy) printf 'extract: refused to write the bundle — it holds personal data (1 match(es)):\\n  /Users/<name> at $.repos.A.commits[0].subject\\n' >&2; exit 1 ;;",
        "      fail) printf 'extract: the plugin manifest under the tree cannot be read: ENOENT\\n' >&2; exit 1 ;;",
        "      *) echo 'bundle: dry sessions=0'; exit 0 ;;",
        "    esac ;;",
        "esac",
        `exec ${q(harnessBun)} "$@"`,
        "",
      ].join("\n"),
      { mode: 0o755 },
    );
    f(sb);
  });
}

/** The prompt each `claude` the stub saw was handed, in order. */
function childPrompts(sb: StubSandbox): string[] {
  return readStubCalls(sb)
    .filter((c) => c.kind === "claude")
    .map((c) => {
      const p = join(sb.envDir, `${c.pid}.stdin`);
      return existsSync(p) ? readFileSync(p, "utf-8") : "";
    });
}

// --- item 1: every step prompt carries a sanctioned answers block ----------

/** `/spec-write`'s interview keys, read from their two sources, never typed here. */
function specWriteInterviewKeys(): string[] {
  const proto = readFileSync(join(pluginRoot, "docs", "auto-mode-protocol.md"), "utf-8");
  const from = proto.indexOf("- `/spec-write` —");
  const to = proto.indexOf("- `/setup` —", from);
  expect(from >= 0 && to > from, "auto-mode-protocol.md names /spec-write's and /setup's consumer bullets").toBe(true);
  const m = /interview keys a driver may supply\s+are ([\s\S]*?) —/.exec(proto.slice(from, to));
  expect(m, "the /spec-write bullet lists the interview keys a driver may supply").not.toBeNull();
  const content = [...m![1]!.matchAll(/`([a-z_]+)`/g)].map((x) => x[1]!);
  const skill = readFileSync(join(pluginRoot, "skills", "spec-write", "SKILL.md"), "utf-8");
  const literal = [...skill.matchAll(/resolveInterviewAnswer\(promptBody, "([a-z_]+)"\)/g)].map((x) => x[1]!);
  return [...new Set([...content, ...literal])];
}

interface AnswerRow {
  nums: number[];
  feature_summary: string;
  milestone: string;
  tracker_orphan_import: string;
}

function answerRows(text: string): AnswerRow[] {
  const out: AnswerRow[] = [];
  // No answers table is no answers: the steps still run, and their prompts are graded.
  if (!/^### The interview answers\b/m.test(text)) return out;
  for (const raw of section(text, /^### The interview answers\b/).split("\n")) {
    const m = /^\|\s*step (\d+)(?:\s*[–-]\s*(\d+))?\s*\|/.exec(raw);
    if (!m) continue;
    const cells = raw.split("|").slice(1, -1).map((c) => c.trim().replaceAll("`", ""));
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    out.push({ nums: Array.from({ length: b - a + 1 }, (_, i) => a + i), feature_summary: cells[1]!, milestone: cells[2]!, tracker_orphan_import: cells[3]! });
  }
  return out;
}

function fillIn(s: string, sb: StubSandbox): string {
  return s
    .replaceAll("<nonce>", FILL.nonce)
    .replaceAll("<token>", FILL.token)
    .replaceAll("<intruder key>", FILL.intruder)
    .replaceAll("<A's S1 key>", FILL.aS1)
    .replaceAll("<KEY>", "DST-9")
    .replaceAll("<container>", "DST")
    .replaceAll("<tracker>", "jira")
    .replaceAll("<A>", join(sb.root, "A"))
    .replaceAll("<B>", join(sb.root, "B"))
    .replaceAll("`", "");
}

const ANSWER_SLOT = (key: string) => new RegExp(`^${key}: <[^\\n]*>$`, "m");

/** The step fence for step `n`, every placeholder filled from the step table and the answers table. */
function stepFenceFor(text: string, n: number, sb: StubSandbox): string | string[] {
  const row = stepRows(text).find((r) => r.nums.includes(n));
  if (!row) return [`step ${n}: no step-table row`];
  const ans = answerRows(text).find((r) => r.nums.includes(n));
  const roots = row.root.split(/,\s*then\s*/);
  const root = roots[Math.min(row.nums.indexOf(n), roots.length - 1)]!;
  const client = row.client === "tree" || row.client === "below-floor" || row.client === "old-client" || row.client === "intruder" ? row.client : "tree";
  let body = oneFence(text, STEP_TAG).body.replaceAll("<tracker>", "jira")
    .replace(/^STEP_NAME=.*$/m, `STEP_NAME="${n}-${row.marker}"`)
    .replace(/^STEP_MARKER=.*$/m, `STEP_MARKER="${row.marker}"`)
    .replace(/^STEP_ROOT=.*$/m, `STEP_ROOT="${root}"`)
    .replace(/^STEP_CLIENT=.*$/m, `STEP_CLIENT="${client}"`)
    .replace(/^<the step's prompt from the table[^\n]*$/m, fillIn(row.prompt, sb));
  for (const k of ["feature_summary", "milestone", "tracker_orphan_import"] as const) {
    if (ans && ANSWER_SLOT(k).test(body)) body = body.replace(ANSWER_SLOT(k), `${k}: ${fillIn(ans[k], sb)}`);
  }
  return rebaseIntoStub(body, sb);
}

/** The /spec-write steps, from the step table: the steps whose prompt runs /spec-write. */
function specWriteSteps(text: string): number[] {
  return stepRows(text).filter((r) => /\/spec-write\b/.test(r.prompt)).flatMap((r) => r.nums);
}

/**
 * Item 1 — each step's child prompt, as the step fence hands it over: a
 * well-formed `<dpt:answers>v1` block below the marker, parsed by the real
 * `auto_answers.ts`; every `/spec-write` interview key answered, non-empty,
 * no placeholder left; a create step's `feature_summary` is the exact title
 * its prompt names; only S13 answers the import question with an
 * `Import <KEY>` label, and it names the intruder's key.
 */
function answersViolations(text: string, steps: number[]): string[] {
  const keys = specWriteInterviewKeys();
  const v: string[] = [];
  for (const n of steps) {
    withCaptureStub((sb) => {
      writeStubRunEnv(sb, {});
      const script = stepFenceFor(text, n, sb);
      if (Array.isArray(script)) {
        v.push(...script);
        return;
      }
      const r = runStubScript(sb, script, stubEnv(sb));
      const prompts = childPrompts(sb);
      if (r.exitCode !== 0 || prompts.length !== 1) {
        v.push(`step ${n}: the fence did not start exactly one child (exit ${r.exitCode}, ${prompts.length} children): ${r.err.trim()}`);
        return;
      }
      const prompt = prompts[0]!;
      const row = stepRows(text).find((x) => x.nums.includes(n))!;
      const marker = parseMarker(prompt);
      if (!marker.ok) v.push(`step ${n}: the grader cannot map the prompt to a scenario: ${marker.detail}`);
      const got = extractAutoAnswers(prompt);
      if (!got.present) {
        v.push(`step ${n}: the prompt carries no well-formed answers block`);
        return;
      }
      if (!(prompt.indexOf(MARKER) >= 0 && prompt.indexOf(MARKER) < prompt.indexOf(AUTO_ANSWERS_OPEN))) v.push(`step ${n}: the answers block is not below the marker`);
      for (const k of keys) {
        const a = got.answers[k];
        if (a === undefined || a === "") v.push(`step ${n}: the block does not answer ${k}`);
        else if (/<[^>]*>/.test(a)) v.push(`step ${n}: ${k} still carries a placeholder: ${a}`);
      }
      const title = /Create (?:one|an) FR titled `([^`]+)`/.exec(row.prompt)?.[1];
      if (title !== undefined) {
        if (got.answers.feature_summary !== fillIn(title, sb)) v.push(`step ${n}: feature_summary is "${got.answers.feature_summary}", not the title its prompt names ("${fillIn(title, sb)}")`);
        if (/^none\b/i.test(got.answers.milestone ?? "")) v.push(`step ${n}: a create step answers milestone with none`);
      }
      const milestoneTitle = /Plan a milestone titled `([^`]+)`/.exec(row.prompt)?.[1];
      if (milestoneTitle !== undefined && !(got.answers.milestone ?? "").includes(fillIn(milestoneTitle, sb))) v.push(`step ${n}: milestone does not name the milestone the step plans`);
      const imp = resolveInterviewAnswer(prompt, "tracker_orphan_import");
      if (row.marker === "S13") {
        if (imp !== `Import ${FILL.intruder}`) v.push(`step ${n}: tracker_orphan_import is ${JSON.stringify(imp)}, not the printed label "Import ${FILL.intruder}"`);
      } else if (typeof imp === "string" && (/^\s*import\b/i.test(imp) || /\b[A-Z][A-Z0-9]*-\d+\b/.test(imp))) {
        v.push(`step ${n}: tracker_orphan_import "${imp}" would consent to an import outside S13`);
      }
    });
  }
  return v;
}

const ALL_STEPS = Array.from({ length: 26 }, (_, i) => i + 1);

describe("live-run item 1 — every step prompt carries a sanctioned answers block that answers its interview", () => {
  test("the interview keys come from auto-mode-protocol.md and /spec-write (twelve content keys plus tracker_orphan_import)", () => {
    const keys = specWriteInterviewKeys();
    expect(keys.length).toBe(13);
    expect(keys).toContain("tracker_orphan_import");
    expect(keys).toContain("feature_summary");
  });
  test("the /spec-write steps are 1, 4, 5, 6, 10, 11, 16, 20 and S13's step 22", () => {
    expect(specWriteSteps(docText())).toEqual([1, 4, 5, 6, 10, 11, 16, 20, 22]);
  });
  test("RUN: each of the 26 step fences hands its child a well-formed block below the marker; /spec-write steps answer every key; only S13 imports, by the intruder's printed label", () => {
    expect(answersViolations(docText(), ALL_STEPS)).toEqual([]);
  }, 180_000);
  test("MUTATION — a step fence without the answers block is red on every step (the marker alone answers nothing)", () => {
    const text = docText();
    const f = oneFence(text, STEP_TAG);
    const m = text.replace(f.body, f.body.replace("\n<dpt:answers>v1\n${STEP_ANSWERS}\n</dpt:answers>\n", "\n"));
    expect(m, "control: the edit landed").not.toBe(text);
    expect(answersViolations(m, [4, 22])).toEqual(["step 4: the prompt carries no well-formed answers block", "step 22: the prompt carries no well-formed answers block"]);
  }, 60_000);
  test("MUTATION — an unterminated block (the close delimiter dropped) fails closed: red", () => {
    const text = docText();
    const f = oneFence(text, STEP_TAG);
    const m = text.replace(f.body, f.body.replace("${STEP_ANSWERS}\n</dpt:answers>\n", "${STEP_ANSWERS}\n"));
    expect(m).not.toBe(text);
    expect(answersViolations(m, [10])).toEqual(["step 10: the prompt carries no well-formed answers block"]);
  }, 60_000);
  test("MUTATION — the block placed above the marker is red", () => {
    const text = docText();
    const f = oneFence(text, STEP_TAG);
    const moved = f.body
      .replace("\n<dpt:answers>v1\n${STEP_ANSWERS}\n</dpt:answers>\n", "\n")
      .replace(`${MARKER}\n`, `<dpt:answers>v1\n\${STEP_ANSWERS}\n</dpt:answers>\n${MARKER}\n`);
    const m = text.replace(f.body, moved);
    expect(m).not.toBe(text);
    expect(answersViolations(m, [5])).toEqual(["step 5: the answers block is not below the marker"]);
  }, 60_000);
  test("MUTATION — a fence whose block drops one interview key (risks) is red on a /spec-write step", () => {
    const text = docText();
    const f = oneFence(text, STEP_TAG);
    const m = text.replace(f.body, f.body.replace(/^risks: .*\n/m, ""));
    expect(m).not.toBe(text);
    expect(answersViolations(m, [4])).toEqual(["step 4: the block does not answer risks"]);
  }, 60_000);
  test("MUTATION — S13's import answered Skip is red; a non-S13 step answered Import <intruder key> is red", () => {
    const text = docText();
    const s13 = answerRowLine(text, 22);
    const skip = text.replace(s13, s13.replace("`Import <intruder key>`", "Skip every orphan; import nothing"));
    expect(skip).not.toBe(text);
    expect(answersViolations(skip, [22])).toEqual([`step 22: tracker_orphan_import is "Skip every orphan; import nothing", not the printed label "Import ${FILL.intruder}"`]);
    const s1 = answerRowLine(text, 4);
    const early = text.replace(s1, s1.replace(/Skip every orphan; import nothing \|$/, "`Import <intruder key>` |"));
    expect(early).not.toBe(text);
    expect(answersViolations(early, [4])).toEqual([`step 4: tracker_orphan_import "Import ${FILL.intruder}" would consent to an import outside S13`]);
  }, 60_000);
  test("MUTATION — a create step whose feature_summary is not its title is red (the grader counts FRs by title)", () => {
    const text = docText();
    const s1 = answerRowLine(text, 4);
    const m = text.replace(s1, s1.replace("`<nonce> S1 same title`", "a same-title FR for S1"));
    expect(m).not.toBe(text);
    expect(answersViolations(m, [5])).toEqual([`step 5: feature_summary is "a same-title FR for S1", not the title its prompt names ("${FILL.nonce} S1 same title")`]);
  }, 60_000);
});

function answerRowLine(text: string, n: number): string {
  const line = section(text, /^### The interview answers\b/).split("\n").find((l) => {
    const m = /^\|\s*step (\d+)(?:\s*[–-]\s*(\d+))?\s*\|/.exec(l);
    return m !== null && Number(m[1]) <= n && n <= Number(m[2] ?? m[1]);
  });
  expect(line, `§ The interview answers has a row for step ${n}`).toBeDefined();
  return line!;
}

// --- items 2 + 3: the audit prompt names its fields; the second Linear audit reads both projects

/**
 * The audit's requested fields are the grader's own contract, imported from
 * it: the document's lists must EQUAL `AUDIT_REQUEST_FIELDS`, never a copy.
 */
const AUDIT_FIELDS_CONTRACT = AUDIT_REQUEST_FIELDS;

const PROJECTS = { SHARED: "dpt-shared-shr0000abcd", PRE: "dpt-shared-shr0000abcd-pre" };

/** The audit fence run for one tracker and pass: its exit, stderr, and the prompt its child was handed. */
function runAudit(text: string, tracker: "jira" | "linear", pass: 1 | 2, over: Record<string, string | undefined> = {}): { code: number; err: string; prompt: string | null; appends: number } {
  let res = { code: -1, err: "", prompt: null as string | null, appends: 0 };
  withCaptureStub((sb) => {
    writeStubRunEnv(sb, { TRACKER: tracker, ...PROJECTS, ...over });
    // writeStubRunEnv names the jira run state; the fence reads the tracker's own.
    const env = join(sb.tmp, "dpt-shared-jira-run.env");
    writeFileSync(join(sb.tmp, `dpt-shared-${tracker}-run.env`), readFileSync(env, "utf-8"));
    const body = oneFence(text, AUDIT_TAG).body.replaceAll("<tracker>", tracker).replace(/^AUDIT_PASS=.*$/m, `AUDIT_PASS="${pass}"`);
    const r = runStubScript(sb, rebaseIntoStub(body, sb), stubEnv(sb));
    const prompts = childPrompts(sb);
    res = {
      code: r.exitCode,
      err: r.err,
      prompt: prompts.length === 1 ? prompts[0]! : null,
      appends: readStubCalls(sb).filter((c) => c.kind === "bun" && /smoke_run_ledger\.ts["']?\s+append\b/.test(c.args)).length,
    };
  });
  return res;
}

function requestedFields(prompt: string): string[] | null {
  const m = /^Request exactly these fields[^:\n]*: (.+)$/m.exec(prompt);
  return m ? m[1]!.split(",").map((x) => x.trim()) : null;
}

function auditFieldViolations(text: string): string[] {
  const v: string[] = [];
  for (const tracker of ["jira", "linear"] as const) {
    for (const pass of [1, 2] as const) {
      const r = runAudit(text, tracker, pass);
      if (r.prompt === null) {
        v.push(`${tracker} audit ${pass}: no child was started (exit ${r.code}): ${r.err.trim()}`);
        continue;
      }
      const got = requestedFields(r.prompt);
      if (got === null) v.push(`${tracker} audit ${pass}: the prompt names no fields`);
      else if (JSON.stringify(got) !== JSON.stringify(AUDIT_FIELDS_CONTRACT[tracker].issue)) v.push(`${tracker} audit ${pass}: the prompt requests ${got.join(", ")}, not ${AUDIT_FIELDS_CONTRACT[tracker].issue.join(", ")}`);
    }
  }
  return v;
}

const GET_PROJECT_RE = /mcp__linear__get_project once for the project named (\S+) and once for the project named (\S+), by name/;

function projectReadViolations(text: string): string[] {
  const v: string[] = [];
  const l2 = runAudit(text, "linear", 2);
  const m = l2.prompt === null ? null : GET_PROJECT_RE.exec(l2.prompt);
  if (m === null) v.push("the second Linear audit does not read the two throwaway projects back with mcp__linear__get_project");
  else if (m[1] !== PROJECTS.SHARED || m[2] !== PROJECTS.PRE) v.push(`the second Linear audit reads ${m[1]} and ${m[2]}, not the shared and pre-repoint projects`);
  for (const [t, p] of [["linear", 1], ["jira", 2], ["jira", 1]] as const) {
    const r = runAudit(text, t, p);
    if (r.prompt !== null && /get_project/.test(r.prompt)) v.push(`${t} audit ${p} reads a project; only the second Linear audit does`);
  }
  const boot = oneFence(text, "# shared-tracker-smoke: bootstrap").body;
  if (!/^printf 'SHARED=%q\\nPRE=%q\\nLINEAR_TEAM=%q\\n' "\$\{SHARED\}" "\$\{PRE\}" "\$\{LINEAR_TEAM\}" >> \/tmp\/dpt-shared-<tracker>-run\.env$/m.test(boot)) v.push("bootstrap does not record SHARED and PRE in the run state the audit reads");
  return v;
}

describe("live-run item 2 — the audit prompt requests exactly the fields the grader counts by", () => {
  test("the grader's AUDIT_REQUEST_FIELDS names labels and project on both trackers (the fields an item is attributed by)", () => {
    for (const t of ["jira", "linear"] as const) expect(AUDIT_REQUEST_FIELDS[t].issue).toEqual(expect.arrayContaining(["labels", "project"]));
  });
  test("RUN: both audits, on both trackers, request exactly the contract's fields", () => {
    expect(auditFieldViolations(docText())).toEqual([]);
  }, 60_000);
  test("MUTATION — a Jira list without labels, or a Linear list without project, is red", () => {
    const text = docText();
    const f = oneFence(text, AUDIT_TAG);
    const noLabels = text.replace(f.body, f.body.replace('AUDIT_FIELDS="summary, labels, status,', 'AUDIT_FIELDS="summary, status,'));
    expect(noLabels).not.toBe(text);
    expect(auditFieldViolations(noLabels)).toEqual([
      `jira audit 1: the prompt requests summary, status, parent, issuetype, project, not ${AUDIT_FIELDS_CONTRACT.jira.issue.join(", ")}`,
      `jira audit 2: the prompt requests summary, status, parent, issuetype, project, not ${AUDIT_FIELDS_CONTRACT.jira.issue.join(", ")}`,
    ]);
    const noProject = text.replace(f.body, f.body.replace("labels, status, project, projectMilestone", "labels, status, projectMilestone"));
    expect(noProject).not.toBe(text);
    expect(auditFieldViolations(noProject).filter((x) => x.startsWith("linear"))).toHaveLength(2);
  }, 60_000);
  test("MUTATION — an audit prompt that names no fields at all is red", () => {
    const text = docText();
    const f = oneFence(text, AUDIT_TAG);
    const m = text.replace(f.body, f.body.replace(/^Request exactly these fields.*\n/m, ""));
    expect(m).not.toBe(text);
    expect(auditFieldViolations(m).filter((x) => /names no fields/.test(x))).toHaveLength(4);
  }, 60_000);
});

describe("live-run item 3 — the second Linear audit reads both throwaway projects back", () => {
  test("RUN: the second Linear audit calls get_project for the shared and the pre-repoint project by name; no other audit does", () => {
    expect(projectReadViolations(docText())).toEqual([]);
  }, 60_000);
  test("REFUSAL — the second Linear audit with no pre-repoint project in the run state refuses in NFR-10 shape, before any append or child", () => {
    const r = runAudit(docText(), "linear", 2, { PRE: undefined });
    expect(r.code).not.toBe(0);
    expect(r.prompt).toBeNull();
    expect(r.appends).toBe(0);
    expectNfr10(r.err, true);
    expect(r.err).toMatch(/check=projects-unknown/);
  });
  test("MUTATION — an audit prompt without the project reads is red", () => {
    const text = docText();
    const f = oneFence(text, AUDIT_TAG);
    const m = text.replace(f.body, f.body.replace("\n${PROJECT_READS}\nPROMPT_EOF", "\nPROMPT_EOF"));
    expect(m).not.toBe(text);
    expect(projectReadViolations(m)).toEqual(["the second Linear audit does not read the two throwaway projects back with mcp__linear__get_project"]);
  }, 60_000);
  test("MUTATION — a bootstrap that does not record the projects in the run state is red", () => {
    const text = docText();
    const m = text.replace(/^printf 'SHARED=%q\\nPRE=%q\\n.*\n/m, "");
    expect(m).not.toBe(text);
    expect(projectReadViolations(m)).toContain("bootstrap does not record SHARED and PRE in the run state the audit reads");
  }, 60_000);
});

// --- HIGH-E: the first Linear audit reads the milestones the grader grades S3 by

/** The milestone-read line of an audit prompt: the listing tool, the project, the per-key read tool. */
const MILESTONE_READ_RE = /^Then read the shared project's milestones: call mcp__linear__(\w+) once for the project named (\S+), and call mcp__linear__(\w+) once per created milestone id above \(project \S+, query the id\)\. These calls take no field list\.$/m;

function milestoneReadViolations(text: string): string[] {
  const v: string[] = [];
  for (const tracker of ["jira", "linear"] as const) {
    for (const pass of [1, 2] as const) {
      const r = runAudit(text, tracker, pass);
      if (r.prompt === null) {
        v.push(`${tracker} audit ${pass}: no child was started (exit ${r.code}): ${r.err.trim()}`);
        continue;
      }
      const m = MILESTONE_READ_RE.exec(r.prompt);
      const want = pass === 1 ? AUDIT_FIELDS_CONTRACT[tracker].milestone : null;
      if (want === null) {
        if (m !== null || /list_milestones|get_milestone/.test(r.prompt)) v.push(`${tracker} audit ${pass}: the prompt reads milestones, which the contract does not ask of it`);
      } else if (m === null) v.push(`${tracker} audit ${pass}: the prompt does not read the shared project's milestones`);
      else {
        if (JSON.stringify({ list: m[1], get: m[3] }) !== JSON.stringify(want)) v.push(`${tracker} audit ${pass}: the prompt reads milestones with ${m[1]} and ${m[3]}, not the contract's ${want.list} and ${want.get}`);
        if (m[2] !== PROJECTS.SHARED) v.push(`${tracker} audit ${pass}: the prompt lists the milestones of ${m[2]}, not the shared project ${PROJECTS.SHARED}`);
      }
    }
  }
  return v;
}

describe("HIGH-E — the audit reads the milestones the grader's S3 predicate grades, exactly as AUDIT_REQUEST_FIELDS declares", () => {
  test("CONTROL — the contract asks Linear's first audit for list_milestones and get_milestone, and Jira (whose milestone is an Epic issue) for none", () => {
    expect(AUDIT_REQUEST_FIELDS.linear.milestone).toEqual({ list: "list_milestones", get: "get_milestone" });
    expect(AUDIT_REQUEST_FIELDS.jira.milestone).toBeNull();
  });
  test("RUN: the first Linear audit's prompt reads the shared project's milestones with the contract's tools; no Jira audit and no second audit reads milestones", () => {
    expect(milestoneReadViolations(docText())).toEqual([]);
  }, 60_000);
  test("REFUSAL — the first Linear audit with no shared project in the run state refuses in NFR-10 shape, before any append or child", () => {
    const r = runAudit(docText(), "linear", 1, { SHARED: undefined });
    expect(r.code).not.toBe(0);
    expect(r.prompt).toBeNull();
    expect(r.appends).toBe(0);
    expectNfr10(r.err, true);
    expect(r.err).toMatch(/check=projects-unknown/);
  });
  test("MUTATION — an audit prompt without the milestone reads is red; one naming another listing tool is red", () => {
    const text = docText();
    const f = oneFence(text, AUDIT_TAG);
    const dropped = text.replace(f.body, f.body.replace("\n${MILESTONE_READS}\n", "\n"));
    expect(dropped).not.toBe(text);
    expect(milestoneReadViolations(dropped)).toEqual(["linear audit 1: the prompt does not read the shared project's milestones"]);
    const other = text.replace(f.body, f.body.replace("call mcp__linear__list_milestones once", "call mcp__linear__list_projects once"));
    expect(other).not.toBe(text);
    expect(milestoneReadViolations(other)).toEqual(["linear audit 1: the prompt reads milestones with list_projects and get_milestone, not the contract's list_milestones and get_milestone"]);
  }, 60_000);
});

// --- MEDIUM-G: LINEAR_TEAM lives in the run state; Phase 6 reads it, never a retyped value

/** Run Phase 6 against a Linear run state; the exit, stderr and the extract call's --linear-team (null: no extract call). */
function runPhase6Linear(text: string, over: Record<string, string | undefined>): { code: number; err: string; extracted: boolean; team: string | null } {
  let res = { code: -1, err: "", extracted: false, team: null as string | null };
  withStub((sb) => {
    writeStubRunEnv(sb, { TRACKER: "linear", ...PROJECTS, DIGEST_AT_START: "a".repeat(64), RUN_START_MS: "1", ...over });
    writeFileSync(join(sb.tmp, "dpt-shared-linear-run.env"), readFileSync(join(sb.tmp, "dpt-shared-jira-run.env"), "utf-8"));
    const r = runStubScript(sb, rebaseIntoStub(oneFence(text, EXTRACT_TAG).body.replaceAll("<tracker>", "linear"), sb), stubEnv(sb));
    const x = readStubCalls(sb).find((c) => c.kind === "bun" && /shared_tracker_live_grader\.ts["']?\s+extract\b/.test(c.args));
    res = { code: r.exitCode, err: r.err, extracted: x !== undefined, team: x ? flagValue(x.args, "linear-team") : null };
  });
  return res;
}

describe("MEDIUM-G — LINEAR_TEAM is recorded in the run state at bootstrap and read from there by Phase 6", () => {
  test("PERMIT — Phase 6 hands extract the team the run state records", () => {
    const r = runPhase6Linear(docText(), { LINEAR_TEAM: "STE" });
    expect({ extracted: r.extracted, team: r.team }, r.err).toEqual({ extracted: true, team: "STE" });
  });
  test("REFUSAL — a Linear run state with no LINEAR_TEAM refuses in NFR-10 shape before any extract, never an extract without --linear-team", () => {
    for (const team of [undefined, ""]) {
      const r = runPhase6Linear(docText(), { LINEAR_TEAM: team });
      expect({ team, code: r.code === 0 ? 0 : 1, extracted: r.extracted }).toEqual({ team, code: 1, extracted: false });
      expectNfr10(r.err, true);
      expect(r.err).toMatch(/check=linear-team-unset/);
    }
  });
  test("bootstrap records LINEAR_TEAM beside SHARED and PRE, and refuses an empty team on Linear before its first write", () => {
    const boot = oneFence(docText(), "# shared-tracker-smoke: bootstrap").body;
    expect(boot).toMatch(/^printf 'SHARED=%q\\nPRE=%q\\nLINEAR_TEAM=%q\\n' "\$\{SHARED\}" "\$\{PRE\}" "\$\{LINEAR_TEAM\}" >> \/tmp\/dpt-shared-<tracker>-run\.env$/m);
    const refusal = boot.indexOf("check=linear-team-unset");
    expect(refusal).toBeGreaterThan(-1);
    expect(refusal, "the refusal precedes the first write").toBeLessThan(boot.indexOf("mkdir -p"));
  });
  test("MUTATION — a Phase 6 that retypes LINEAR_TEAM over the run state's is red", () => {
    const text = docText();
    const f = oneFence(text, EXTRACT_TAG);
    const m = text.replace(f.body, f.body.replace(/^(# run-state preamble: end)$/m, '$1\nLINEAR_TEAM="<the --linear-team key on a Linear run; empty on Jira>"'));
    expect(m).not.toBe(text);
    expect(runPhase6Linear(m, { LINEAR_TEAM: "STE" }).team).not.toBe("STE");
  });
});

// --- MEDIUM-G, extended: SHARED and PRE are read from the run state too, never retyped

/** Run Phase 6 on a run state; the extract call's --container and --repoint-from (null: no extract, or flag absent). */
function runPhase6Spaces(text: string, tracker: "jira" | "linear", over: Record<string, string | undefined>): { code: number; err: string; extracted: boolean; container: string | null; repoint: string | null } {
  let res = { code: -1, err: "", extracted: false, container: null as string | null, repoint: null as string | null };
  withStub((sb) => {
    writeStubRunEnv(sb, { TRACKER: tracker, ...PROJECTS, LINEAR_TEAM: tracker === "linear" ? "STE" : "", DIGEST_AT_START: "a".repeat(64), RUN_START_MS: "1", ...over });
    if (tracker === "linear") writeFileSync(join(sb.tmp, "dpt-shared-linear-run.env"), readFileSync(join(sb.tmp, "dpt-shared-jira-run.env"), "utf-8"));
    const r = runStubScript(sb, rebaseIntoStub(oneFence(text, EXTRACT_TAG).body.replaceAll("<tracker>", tracker), sb), stubEnv(sb));
    const x = readStubCalls(sb).find((c) => c.kind === "bun" && /shared_tracker_live_grader\.ts["']?\s+extract\b/.test(c.args));
    res = { code: r.exitCode, err: r.err, extracted: x !== undefined, container: x ? flagValue(x.args, "container") : null, repoint: x ? flagValue(x.args, "repoint-from") : null };
  });
  return res;
}

describe("MEDIUM-G extended — Phase 6 reads SHARED and PRE from the run state bootstrap wrote, never a retyped placeholder", () => {
  test("PERMIT — Linear: extract gets the run state's shared and pre-repoint projects", () => {
    const r = runPhase6Spaces(docText(), "linear", { SHARED: "dpt-shared-n1", PRE: "dpt-shared-n1-pre" });
    expect({ extracted: r.extracted, container: r.container, repoint: r.repoint }, r.err).toEqual({ extracted: true, container: "dpt-shared-n1", repoint: "dpt-shared-n1-pre" });
  });
  test("PERMIT — Jira without the repoint flag: extract gets the shared space and no --repoint-from", () => {
    const r = runPhase6Spaces(docText(), "jira", { SHARED: "DST", PRE: "" });
    expect({ extracted: r.extracted, container: r.container, repoint: r.repoint }, r.err).toEqual({ extracted: true, container: "DST", repoint: null });
  });
  test("REFUSAL — an empty SHARED refuses in NFR-10 shape before any extract", () => {
    for (const t of ["jira", "linear"] as const) {
      const r = runPhase6Spaces(docText(), t, { SHARED: "", PRE: t === "linear" ? "p-pre" : "" });
      expect({ t, code: r.code === 0 ? 0 : 1, extracted: r.extracted }).toEqual({ t, code: 1, extracted: false });
      expectNfr10(r.err, true);
      expect(r.err).toMatch(/check=shared-unset/);
    }
  });
  test("REFUSAL — a Linear run state with no PRE refuses (the pre-repoint project always exists on Linear)", () => {
    const r = runPhase6Spaces(docText(), "linear", { SHARED: "dpt-shared-n1", PRE: "" });
    expect({ code: r.code === 0 ? 0 : 1, extracted: r.extracted }).toEqual({ code: 1, extracted: false });
    expect(r.err).toMatch(/check=pre-unset/);
  });
  test("MUTATION — a Phase 6 that retypes SHARED over the run state's is red", () => {
    const text = docText();
    const f = oneFence(text, EXTRACT_TAG);
    const m = text.replace(f.body, f.body.replace(/^(# run-state preamble: end)$/m, '$1\nSHARED="<shared space key, or the shared Linear project name>"'));
    expect(m).not.toBe(text);
    expect(runPhase6Spaces(m, "linear", { SHARED: "dpt-shared-n1", PRE: "dpt-shared-n1-pre" }).container).not.toBe("dpt-shared-n1");
  });
});

// --- MEDIUM-F: the early privacy dry run says what it cannot see

describe("MEDIUM-F — the privacy dry run is named for what it checks: bootstrap only; Phase 6's extract is the real privacy pass", () => {
  test("the dry run's prose says it sees no session and names Phase 6's extract as the privacy pass over the run", () => {
    const sec = section(docText(), /^### Privacy dry run\b/);
    expect(sec).toMatch(/checks the bootstrap state only/);
    expect(sec).toMatch(/the ledger holds no session yet/);
    expect(sec).toMatch(/Phase 6's `extract` is the real privacy pass/);
  });
});

// --- item 4: A is idle on the span milestone before the S5 busy step --------

function withIdleASandbox(f: (t: { tmp: string; a: string }) => void): void {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ste617-s5a-")));
  try {
    const tmp = join(root, "tmp");
    const a = join(root, "A");
    mkdirSync(tmp, { recursive: true });
    const fr = (ms: string) => `---\ntitle: x\nmilestone: ${ms}\nstatus: active\narchived_at: null\n---\n\n# x\n`;
    // Step 10 left A's S2 FR active in the span milestone; another FR sits elsewhere.
    gitRepo(a, { "CLAUDE.md": "# A\n", "specs/frs/fr-s2.md": fr("M_span01"), "specs/frs/fr-s1.md": fr("M_other9") });
    writeFileSync(join(tmp, "dpt-shared-jira-run.env"), `TRACKER=jira\nROOT_A=${a}\nPLUGIN_TREE=${pluginRoot}\n`);
    f({ tmp, a });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** Active FRs in `root` bound to the span token: what /ship-milestone's refusal #1 counts. */
function activeSpanFrs(root: string): string[] {
  const dir = join(root, "specs", "frs");
  return readdirSync(dir).filter((n) => n.endsWith(".md") && /^milestone: M_span01$/m.test(readFileSync(join(dir, n), "utf-8")) && /^status: active$/m.test(readFileSync(join(dir, n), "utf-8")));
}

/**
 * Item 4 — what A looks like when step 14 starts: every operator fence the
 * document places before step 14 is run over an A that step 10 left busy, and
 * A must then hold no active FR on the span token (else /ship-milestone stops
 * at refusal #1 and sibling_release.ts never runs), with the archive committed
 * and the tree clean. The document side: the fence is placed before the busy
 * step, and the grader's S5 order (B's archive before the permit twin) stays.
 */
function idleAViolations(text: string): string[] {
  const v: string[] = [];
  const s5 = rowsOf(text, "S5", "A");
  if (s5.length !== 2) return [`expected two S5 rows rooted in A, found ${s5.length}`];
  const busy = s5[0]!.nums[0]!;
  const hits = fencesTagged(text, IDLE_A_TAG);
  if (hits.length === 0) v.push(`no operator fence makes A idle on the span milestone before step ${busy}`);
  else if (hits.length > 1) return [`expected one fence tagged ${IDLE_A_TAG}, found ${hits.length}`];
  else {
    const f = hits[0]!;
    if (!new RegExp(`before step ${busy}\\b`, "i").test(f.region)) v.push(`the A-idle fence is not placed before step ${busy}`);
    const b = fencesTagged(text, S5_ARCHIVE_TAG)[0];
    if (b && !(f.openLine < b.openLine)) v.push("the A-idle fence comes after B's archive fence");
  }
  withIdleASandbox(({ tmp, a }) => {
    for (const f of hits) {
      const r = runOperatorFence(f.body.replace(/^SPAN_TOKEN=.*$/m, 'SPAN_TOKEN="M_span01"'), tmp, a);
      if (r.code !== 0) v.push(`the A-idle fence failed: ${r.err.trim()}`);
    }
    const left = activeSpanFrs(a);
    if (left.length > 0) v.push(`A still holds active span FRs at step ${busy} (${left.join(", ")}): /ship-milestone stops at refusal #1 before sibling_release.ts`);
    else {
      if (!/archive/i.test(sh(a, ["git", "log", "-1", "--format=%s"]).out)) v.push("A's archive is not committed with an archive subject");
      if (sh(a, ["git", "status", "--porcelain"]).out.trim() !== "") v.push("A's tree is not clean at the busy step (refusal #3)");
      if (!existsSync(join(a, "specs", "frs", "fr-s1.md"))) v.push("an FR bound to another milestone was moved");
    }
  });
  return v;
}

describe("live-run item 4 — A is idle on the span milestone before the S5 busy step, so it reaches the sibling gate", () => {
  test("RUN: the document's fences leave A with no active span FR, the archive committed, the tree clean, before step 14", () => {
    expect(idleAViolations(docText())).toEqual([]);
  });
  test("the grader's S5 order is kept: B's archive fence still sits between the busy step and the permit twin", () => {
    expect(s5Violations(docText())).toEqual([]);
  });
  test("REFUSAL twin — A holds no active FR bound to the span token: refused in NFR-10 shape, no commit made", () => {
    withIdleASandbox(({ tmp, a }) => {
      rmSync(join(a, "specs", "frs", "fr-s2.md"));
      sh(a, ["git", "-c", "commit.gpgsign=false", "commit", "-qam", "chore: drop"]);
      const head = sh(a, ["git", "rev-parse", "HEAD"]).out;
      const r = runOperatorFence(oneFence(docText(), IDLE_A_TAG).body.replace(/^SPAN_TOKEN=.*$/m, 'SPAN_TOKEN="M_span01"'), tmp, a);
      expect(r.code).not.toBe(0);
      expectNfr10(r.err);
      expect(sh(a, ["git", "rev-parse", "HEAD"]).out).toBe(head);
    });
  });
  test("MUTATION — a document without the A-idle fence is red: A still holds its span FR at step 14", () => {
    const text = docText();
    const f = oneFence(text, IDLE_A_TAG);
    const lines = text.split("\n");
    const cut = [...lines.slice(0, f.openLine - 1), ...lines.slice(f.closeLine)].join("\n");
    expect(idleAViolations(cut)).toEqual([
      "no operator fence makes A idle on the span milestone before step 14",
      "A still holds active span FRs at step 14 (fr-s2.md): /ship-milestone stops at refusal #1 before sibling_release.ts",
    ]);
  });
  test("MUTATION — an A-idle fence that never commits is red", () => {
    const text = docText();
    const f = oneFence(text, IDLE_A_TAG);
    const m = text.replace(f.body, f.body.split("\n").filter((l) => !/\bcommit\b/.test(l) || /^\s*#/.test(l)).join("\n"));
    expect(idleAViolations(m).some((x) => /not committed|not clean/.test(x))).toBe(true);
  });
});

// --- item 5: a privacy dry run after bootstrap, before the first spawn ------

function runDryRun(text: string, stub: "ok" | "privacy" | "fail"): { code: number; out: string; err: string; extractOut: string | null; claude: number; appends: number; sbTmp: string } {
  let res = { code: -1, out: "", err: "", extractOut: null as string | null, claude: 0, appends: 0, sbTmp: "" };
  withCaptureStub((sb) => {
    writeStubRunEnv(sb, { SHARED: "DST", PRE: "DST2", DIGEST_AT_START: "a".repeat(64), RUN_START_MS: "1" });
    const body = oneFence(text, DRY_RUN_TAG).body.replaceAll("<tracker>", "jira");
    const r = runStubScript(sb, rebaseIntoStub(body, sb), stubEnv(sb, { STUB_EXTRACT: stub }));
    const calls = readStubCalls(sb);
    const x = calls.find((c) => c.kind === "bun" && /shared_tracker_live_grader\.ts["']?\s+extract\b/.test(c.args));
    res = {
      code: r.exitCode,
      out: r.out,
      err: r.err,
      extractOut: x ? flagValue(x.args, "out") : null,
      claude: calls.filter((c) => c.kind === "claude").length,
      appends: calls.filter((c) => c.kind === "bun" && /smoke_run_ledger\.ts["']?\s+append\b/.test(c.args)).length,
      sbTmp: sb.tmp,
    };
  });
  return res;
}

function dryRunViolations(text: string): string[] {
  const v: string[] = [];
  const hits = fencesTagged(text, DRY_RUN_TAG);
  if (hits.length !== 1) return [`expected one fence tagged ${DRY_RUN_TAG}, found ${hits.length}`];
  const boot = oneFence(text, "# shared-tracker-smoke: bootstrap");
  const firstSpawn = parseFences("shared-tracker-smoke", text).find(isSpawnFence)!;
  if (!(boot.openLine < hits[0]!.openLine && hits[0]!.openLine < firstSpawn.openLine)) v.push("the dry run is not between the bootstrap and the first spawn fence");
  const leak = runDryRun(text, "privacy");
  if (leak.code === 0) v.push("a privacy refusal from the dry-run extract does not refuse the run");
  else if (!/check=privacy-leak/.test(leak.err)) v.push(`a privacy refusal is not refused as privacy-leak: ${leak.err.trim()}`);
  if (leak.claude > 0 || leak.appends > 0) v.push("the dry run started a child or appended a ledger row");
  const ok = runDryRun(text, "ok");
  if (ok.code !== 0) v.push(`a clean dry run does not pass: ${ok.err.trim()}`);
  if (ok.extractOut === null) v.push("the dry run makes no extract call");
  else if (!ok.extractOut.startsWith(`${ok.sbTmp}/`) || /tests\/fixtures/.test(ok.extractOut)) v.push(`the dry run writes its bundle outside /tmp: ${ok.extractOut}`);
  return v;
}

describe("live-run item 5 — a privacy dry run over the bootstrap state refuses before any spawn", () => {
  test("the grader's privacy refusal says `holds personal data` — the phrase the dry run keys on", () => {
    expect(readFileSync(join(pluginRoot, "adapters", "_shared", "src", "shared_tracker_live_grader.ts"), "utf-8")).toContain("it holds personal data");
  });
  test("RUN: placed after bootstrap and before the first spawn; a privacy refusal refuses, a clean extract passes, its bundle stays under /tmp", () => {
    expect(dryRunViolations(docText())).toEqual([]);
  });
  test("REFUSAL — a privacy refusal: NFR-10 on stderr, check=privacy-leak, no child, no ledger append", () => {
    const r = runDryRun(docText(), "privacy");
    expect(r.code).not.toBe(0);
    expectNfr10(r.err);
    expect(r.err).toMatch(/check=privacy-leak/);
    expect([r.claude, r.appends]).toEqual([0, 0]);
    expect(r.out, "the grader's matches are shown to the operator").toMatch(/\/Users\/<name>/);
  });
  test("REFUSAL — an extract that fails for another reason refuses as dry-run-failed", () => {
    const r = runDryRun(docText(), "fail");
    expect(r.code).not.toBe(0);
    expectNfr10(r.err);
    expect(r.err).toMatch(/check=dry-run-failed/);
  });
  test("MUTATION — a dry run that ignores extract's exit is red; a document without the dry run is red", () => {
    const text = docText();
    const f = oneFence(text, DRY_RUN_TAG);
    const ignored = text.replace(f.body, f.body.replace('2> "${DRY_ERR}"; then', '2> "${DRY_ERR}" || true; then'));
    expect(ignored).not.toBe(text);
    expect(dryRunViolations(ignored)).toEqual(["a privacy refusal from the dry-run extract does not refuse the run"]);
    const lines = text.split("\n");
    const cut = [...lines.slice(0, f.openLine - 1), ...lines.slice(f.closeLine)].join("\n");
    expect(dryRunViolations(cut)).toEqual([`expected one fence tagged ${DRY_RUN_TAG}, found 0`]);
  });
});

// ===========================================================================
// Fourth audit (2026-09-21) — the Linear run-killers. Every tracker answer
// below is a MEASURED shape from tests/fixtures/live-shapes/linear/, never an
// invented one; every behavioural check is graded from a RUN of the fence.
// ===========================================================================

const BOOT_TAG = "# shared-tracker-smoke: bootstrap";
const CONTAINERS_TAG = "# shared-tracker-smoke: linear containers";
const TAGS = { a: `shr-${FILL.nonce}-a`, b: `shr-${FILL.nonce}-b` };

/** The check name a refusal's Context line carries. */
const checkOf = (lines: string[]): string | null => /check=([a-z0-9-]+)/.exec(lines[2] ?? "")?.[1] ?? null;

// --- defect 1: the pre-flight team check reads the answer get_team really gives

describe("fourth audit, defect 1 — the Linear team pre-flight reads the MEASURED get_team answer (no key field)", () => {
  test("CONTROL — the measured get_team answer has an id and no key field", () => {
    const a = liveShape("linear", "get_team");
    expect(typeof a.id).toBe("string");
    expect(a.id.length).toBeGreaterThan(0);
    expect("key" in a).toBe(false);
  });
  test("PERMIT — the measured answer passes, and the pre-flight env records LINEAR_TEAM_ID as the answer's id", () => {
    withSandbox("linear", (sb) => {
      const r = runPreflight(sb, envFor(sb, { TRACKER: "linear" }));
      expect(r.code, `${r.out}\n${r.err}`).toBe(0);
      const env = readFileSync(join(sb.tmp, "dpt-shared-linear-preflight.env"), "utf-8");
      expect(env.split("\n")).toContain(`LINEAR_TEAM_ID=${liveShape("linear", "get_team").id}`);
    });
  });
  test("TWIN — a Jira pre-flight records an empty LINEAR_TEAM_ID, even with one inherited from the operator's environment", () => {
    withSandbox("jira", (sb) => {
      const r = runPreflight(sb, envFor(sb, { TRACKER: "jira", LINEAR_TEAM_ID: "inherited-from-a-linear-leg" }));
      expect(r.code, `${r.out}\n${r.err}`).toBe(0);
      const env = readFileSync(join(sb.tmp, "dpt-shared-jira-preflight.env"), "utf-8");
      expect(env.split("\n").filter((l) => l.startsWith("LINEAR_TEAM_ID="))).toEqual(["LINEAR_TEAM_ID=''"]);
    });
  });
  test("the pre-flight prose names the tool whose answer linear-team.json is", () => {
    expect(section(docText(), /^## Phase 1\b/)).toMatch(/`linear-team\.json`[^\n]*`mcp__linear__get_team\(query: <LINEAR_TEAM>\)`[^\n]*verbatim/);
  });
  const notKey: Array<[string, string]> = [
    ["a display name", "Example Team"],
    ["a lowercase key", "ste"],
    ["an issue key", "STE-1"],
  ];
  for (const [what, team] of notKey) {
    test(`REFUSAL — LINEAR_TEAM is ${what} (${JSON.stringify(team)}): linear-team-not-a-key, since the binding records the key`, () => {
      withSandbox("linear", (sb) => {
        const lines = expectRefusal(runPreflight(sb, envFor(sb, { TRACKER: "linear", LINEAR_TEAM: team })), sb, "linear");
        expect(checkOf(lines)).toBe("linear-team-not-a-key");
      });
    });
  }
  const unresolved: Array<[string, (sb: Sandbox) => void]> = [
    ["an error answer", (sb) => writeJson(join(sb.answers, "linear-team.json"), { error: "Team not found" })],
    ["an error answer that also carries an id", (sb) => writeJson(join(sb.answers, "linear-team.json"), { ...liveShape("linear", "get_team"), error: "partial" })],
    ["no saved answer", (sb) => rmSync(join(sb.answers, "linear-team.json"))],
    ["an answer that is not JSON", (sb) => writeFileSync(join(sb.answers, "linear-team.json"), "Team STE not found\n")],
    ["an empty object", (sb) => writeJson(join(sb.answers, "linear-team.json"), {})],
    ["an empty id", (sb) => writeJson(join(sb.answers, "linear-team.json"), { ...liveShape("linear", "get_team"), id: "" })],
    ["a non-string id", (sb) => writeJson(join(sb.answers, "linear-team.json"), { ...liveShape("linear", "get_team"), id: 7 })],
    ["an array (a team listing, not a lookup)", (sb) => writeJson(join(sb.answers, "linear-team.json"), [liveShape("linear", "get_team")])],
  ];
  for (const [what, arrange] of unresolved) {
    test(`REFUSAL — the team lookup is ${what}: linear-team-unresolved`, () => {
      withSandbox("linear", (sb) => {
        arrange(sb);
        const lines = expectRefusal(runPreflight(sb, envFor(sb, { TRACKER: "linear" })), sb, "linear");
        expect(checkOf(lines)).toBe("linear-team-unresolved");
        expect(existsSync(join(sb.tmp, "dpt-shared-linear-preflight.env")), "a refused pre-flight writes no env").toBe(false);
      });
    });
  }
});

// --- defect 2: the bootstrap writes team: on Linear -------------------------

interface BootRun {
  code: number;
  err: string;
  md: { A: string | null; B: string | null };
}

/** The bootstrap fence RUN under the stub, with the real binding writer; both CLAUDE.md files it left. */
function runBootstrap(text: string, tracker: "jira" | "linear"): BootRun {
  let res: BootRun = { code: -1, err: "", md: { A: null, B: null } };
  withStub((sb) => {
    const linear = tracker === "linear";
    const plugin = join(sb.work, "plugins", "dev-process-toolkit");
    // The toolkit checkout bootstrap copies the below-floor client from.
    gitRepo(sb.work, { "plugins/dev-process-toolkit/.claude-plugin/plugin.json": JSON.stringify({ name: "dev-process-toolkit", version: FLOOR }) });
    writeStubRunEnv(sb, { TRACKER: tracker, PLUGIN_TREE: plugin });
    if (linear) writeFileSync(join(sb.tmp, "dpt-shared-linear-run.env"), readFileSync(join(sb.tmp, "dpt-shared-jira-run.env"), "utf-8"));
    // The pre-flight records the team key it checked beside its id; the bootstrap reads both, never a retyped key.
    writeFileSync(join(sb.tmp, `dpt-shared-${tracker}-preflight.env`), `FLOOR=${FLOOR}\n${linear ? `LINEAR_TEAM=STE\nLINEAR_TEAM_ID=${liveShape("linear", "get_team").id}\n` : "LINEAR_TEAM=''\n"}`);
    if (linear) writeJson(join(sb.home, ".claude-st", "plugins", "marketplaces", "claude-plugins-official", "external_plugins", "linear", ".mcp.json"), { linear: { type: "http", url: "https://mcp.linear.invalid/mcp" } });
    // The binding writer runs for real; every other bun call goes to the harness stub.
    const harnessBun = join(sb.root, "bun-harness");
    writeFileSync(harnessBun, readFileSync(join(sb.bin, "bun"), "utf-8"), { mode: 0o755 });
    const q = (x: string) => `'${x.replace(/'/g, `'\\''`)}'`;
    writeFileSync(
      join(sb.bin, "bun"),
      [
        "#!/bin/bash",
        'case "${1:-}" in',
        "  */tracker_binding_write.ts)",
        `    printf 'bun\\t%s\\t%s\\n' "$$" "$*" >> ${q(sb.calls)}`,
        "    shift",
        `    exec ${q(process.execPath)} ${q(join(pluginRoot, "adapters", "_shared", "src", "setup", "tracker_binding_write.ts"))} "$@" ;;`,
        "esac",
        `exec ${q(harnessBun)} "$@"`,
        "",
      ].join("\n"),
      { mode: 0o755 },
    );
    const body = oneFence(text, BOOT_TAG).body.replaceAll("<tracker>", tracker)
      .replace(/^SHARED=.*$/m, `SHARED="${linear ? PROJECTS.SHARED : "DST"}"`)
      .replace(/^PRE=.*$/m, `PRE="${linear ? PROJECTS.PRE : ""}"`);
    const r = runStubScript(sb, rebaseIntoStub(body, sb), stubEnv(sb, GIT_ENV));
    const md = (side: string) => {
      const p = join(sb.root, side, "CLAUDE.md");
      return existsSync(p) ? readFileSync(p, "utf-8") : null;
    };
    res = { code: r.exitCode, err: r.err, md: { A: md("A"), B: md("B") } };
  });
  return res;
}

/** The lines of CLAUDE.md's `### Linear` sub-section, or null when it has none. */
function linearSubsection(md: string): string[] | null {
  const lines = md.split("\n");
  const i = lines.indexOf("### Linear");
  if (i < 0) return null;
  let j = i + 1;
  while (j < lines.length && !/^#/.test(lines[j]!)) j++;
  return lines.slice(i + 1, j);
}

function bootstrapTeamViolations(r: BootRun, tracker: "jira" | "linear"): string[] {
  const v: string[] = [];
  if (r.code !== 0) v.push(`the ${tracker} bootstrap exited ${r.code}`);
  for (const side of ["A", "B"] as const) {
    const md = r.md[side];
    if (md === null) {
      v.push(`${side} has no CLAUDE.md`);
      continue;
    }
    if (tracker === "linear") {
      const sub = linearSubsection(md);
      const team = (sub ?? []).filter((l) => /^team\s*:/.test(l));
      if (JSON.stringify(team) !== JSON.stringify(["team: STE"])) v.push(`${side}'s CLAUDE.md carries ${team.length ? team.join(" / ") : "no team:"} under ### Linear, not exactly team: STE`);
    } else if (/^team\s*:/m.test(md)) v.push(`${side}'s CLAUDE.md carries a team: line on Jira`);
  }
  return v;
}

/** The document with the bootstrap fence's writer call handed no --team. */
function withoutTeamFlag(text: string): string {
  const f = oneFence(text, BOOT_TAG);
  const m = f.body.replaceAll(' --team "${LINEAR_TEAM}"', "");
  expect(m, "control: the bootstrap fence passes --team").not.toBe(f.body);
  return text.replace(f.body, m);
}

describe("fourth audit, defect 2 (HIGH-1) — the bootstrap writes team: into both Linear declarations", () => {
  test("the bootstrap never retypes LINEAR_TEAM: it reads the key the pre-flight checked, and the pre-flight records it", () => {
    const text = docText();
    expect(oneFence(text, BOOT_TAG).body).not.toMatch(/^LINEAR_TEAM=/m);
    expect(text).toMatch(/printf 'LINEAR_TEAM=%q\\n'/);
  });
  test("RUN (linear): A's and B's CLAUDE.md each carry exactly team: STE under ### Linear", () => {
    const r = runBootstrap(docText(), "linear");
    expect(bootstrapTeamViolations(r, "linear"), r.err).toEqual([]);
  }, 60_000);
  test("RUN (jira) — TWIN: neither declaration carries a team: line (Jira takes no team)", () => {
    const r = runBootstrap(docText(), "jira");
    expect(bootstrapTeamViolations(r, "jira"), r.err).toEqual([]);
  }, 60_000);
  test("MUTATION / REFUSAL TWIN — a bootstrap whose writer is handed no --team refuses binding-team-missing in NFR-10 shape, and no declaration carries team:", () => {
    const r = runBootstrap(withoutTeamFlag(docText()), "linear");
    expect(r.code).not.toBe(0);
    expectNfr10(r.err, true);
    expect(r.err).toMatch(/check=binding-team-missing/);
    expect(bootstrapTeamViolations(r, "linear").length).toBeGreaterThan(0);
  }, 60_000);
});

// --- defect 3, widened (fifth audit HIGH-A / HIGH-B / LOW-G): all four Linear containers are checked before any spawn

interface ContainersRun {
  code: number;
  out: string;
  err: string;
  calls: number;
}

/**
 * The Linear containers fence RUN under the stub. The run state carries the
 * answers directory as PREFLIGHT_ANSWERS, as the pre-flight records it (the
 * fence reads its answers there, never from a hard-coded /tmp path). `over`
 * edits the run state (undefined drops a line); `runEnv: false` writes none;
 * `substitute: false` leaves `<tracker>` unfilled.
 */
function runContainersFence(
  text: string,
  tracker: "jira" | "linear",
  arrange: (answers: string) => void,
  opts: { over?: Record<string, string | undefined>; runEnv?: boolean; substitute?: boolean; answersDir?: (sb: StubSandbox) => string; extraRunEnv?: string } = {},
): ContainersRun {
  let res: ContainersRun = { code: -1, out: "", err: "", calls: 0 };
  withStub((sb) => {
    const answers = opts.answersDir ? opts.answersDir(sb) : join(sb.root, "answers");
    mkdirSync(answers, { recursive: true });
    writeStubRunEnv(sb, { TRACKER: tracker, LINEAR_TEAM: tracker === "linear" ? "STE" : "", ...PROJECTS, PREFLIGHT_ANSWERS: answers, ...(opts.over ?? {}) });
    const jiraEnv = join(sb.tmp, "dpt-shared-jira-run.env");
    const content = readFileSync(jiraEnv, "utf-8") + (opts.extraRunEnv ?? "");
    rmSync(jiraEnv);
    if (opts.runEnv !== false) writeFileSync(join(sb.tmp, `dpt-shared-${tracker}-run.env`), content);
    arrange(answers);
    let body = oneFence(text, CONTAINERS_TAG).body;
    if (opts.substitute !== false) body = body.replaceAll("<tracker>", tracker);
    const r = runStubScript(sb, rebaseIntoStub(body, sb), stubEnv(sb));
    const calls = readStubCalls(sb);
    expect(calls.filter((c) => c.kind === "claude"), "the containers check starts no child").toEqual([]);
    res = { code: r.exitCode, out: r.out, err: r.err, calls: calls.length };
  });
  return res;
}

/** The measured list_issue_labels page, holding `tag` among the team's other labels. */
function labelsHolding(tag: string): unknown {
  const page = liveShape("linear", "list_issue_labels.more");
  return { ...page, labels: [...page.labels, { ...page.labels[0], id: "00000000-0000-4000-8000-000000000001", name: tag, description: null }] };
}

/** The measured get_project answer (status {id,name,type}; teams[] rows {id,name,key}) renamed, its one team keyed `key`. */
function projectNamed(name: string, key = "STE"): any {
  const a = liveShape("linear", "get_project");
  return { ...a, name, teams: a.teams.map((t: Record<string, unknown>) => ({ ...t, key })) };
}

const bothLabels = (answers: string) => {
  writeJson(join(answers, "labels-a.json"), labelsHolding(TAGS.a));
  writeJson(join(answers, "labels-b.json"), labelsHolding(TAGS.b));
};
const bothProjects = (answers: string) => {
  writeJson(join(answers, "project-shared.json"), projectNamed(PROJECTS.SHARED));
  writeJson(join(answers, "project-pre.json"), projectNamed(PROJECTS.PRE));
};
const allContainers = (answers: string) => {
  bothLabels(answers);
  bothProjects(answers);
};

describe("fifth audit — the measured get_project answer the containers check reads", () => {
  test("CONTROL — status is {id,name,type}, and every teams[] row carries {id, name, key}", () => {
    const a = liveShape("linear", "get_project");
    expect(Object.keys(a.status).sort()).toEqual(["id", "name", "type"]);
    expect(a.teams.length).toBeGreaterThan(0);
    for (const t of a.teams) expect(Object.keys(t).sort()).toEqual(["id", "key", "name"]);
  });
});

describe("fourth audit, defect 3 (HIGH-2), widened by the fifth audit's HIGH-B — all four Linear containers exist in LINEAR_TEAM before the first spawn", () => {
  test("the containers check sits after the bootstrap and before the privacy dry run", () => {
    const text = docText();
    const f = oneFence(text, CONTAINERS_TAG);
    expect(oneFence(text, BOOT_TAG).openLine).toBeLessThan(f.openLine);
    expect(f.openLine).toBeLessThan(oneFence(text, DRY_RUN_TAG).openLine);
    expect(fencesTagged(text, "# shared-tracker-smoke: linear tag labels"), "one fence, one tag: the old label-only tag is gone").toEqual([]);
  });
  test("PERMIT — the measured project answers and label pages holding each name pass", () => {
    const r = runContainersFence(docText(), "linear", allContainers);
    expect(r.code, `${r.out}\n${r.err}`).toBe(0);
  });
  test("PERMIT — a Jira run checks nothing and passes with no answers saved (Jira's bootstrap creates no container)", () => {
    const r = runContainersFence(docText(), "jira", () => {});
    expect(r.code, `${r.out}\n${r.err}`).toBe(0);
  });
  const labelRefusals: Array<[string, (answers: string) => void]> = [
    ["A's tag is missing from the measured page (other labels only)", (a) => {
      allContainers(a);
      writeJson(join(a, "labels-a.json"), liveShape("linear", "list_issue_labels.more"));
    }],
    ["B's page holds A's tag, not B's", (a) => {
      allContainers(a);
      writeJson(join(a, "labels-b.json"), labelsHolding(TAGS.a));
    }],
    ["B's answer was never saved", (a) => {
      allContainers(a);
      rmSync(join(a, "labels-b.json"));
    }],
    ["A's answer is not JSON", (a) => {
      allContainers(a);
      writeFileSync(join(a, "labels-a.json"), "Error: team not found\n");
    }],
    ["A's answer is an error object", (a) => {
      allContainers(a);
      writeJson(join(a, "labels-a.json"), { error: "unauthenticated" });
    }],
  ];
  for (const [what, arrange] of labelRefusals) {
    test(`REFUSAL — ${what}: linear-tag-label-missing in NFR-10 shape`, () => {
      const r = runContainersFence(docText(), "linear", arrange);
      expect(r.code).not.toBe(0);
      expectNfr10(r.err);
      expect(r.err).toMatch(/check=linear-tag-label-missing/);
    });
  }
  const projectRefusals: Array<[string, (answers: string) => void]> = [
    ["the shared project's answer was never saved", (a) => {
      allContainers(a);
      rmSync(join(a, "project-shared.json"));
    }],
    ["the pre-repoint project's answer was never saved", (a) => {
      allContainers(a);
      rmSync(join(a, "project-pre.json"));
    }],
    ["the shared project's answer names another project (SHARED was mistyped)", (a) => {
      allContainers(a);
      writeJson(join(a, "project-shared.json"), projectNamed("dpt-shared-shr0000abce"));
    }],
    ["the two answers are swapped", (a) => {
      allContainers(a);
      writeJson(join(a, "project-shared.json"), projectNamed(PROJECTS.PRE));
      writeJson(join(a, "project-pre.json"), projectNamed(PROJECTS.SHARED));
    }],
    ["the pre-repoint project sits in another team (no teams[] key STE)", (a) => {
      allContainers(a);
      writeJson(join(a, "project-pre.json"), projectNamed(PROJECTS.PRE, "OTHER"));
    }],
    ["the shared project's teams[] is empty", (a) => {
      allContainers(a);
      writeJson(join(a, "project-shared.json"), { ...projectNamed(PROJECTS.SHARED), teams: [] });
    }],
    ["the shared project's answer is an error that also carries the name", (a) => {
      allContainers(a);
      writeJson(join(a, "project-shared.json"), { ...projectNamed(PROJECTS.SHARED), error: "partial" });
    }],
    ["the pre-repoint project's answer is not JSON", (a) => {
      allContainers(a);
      writeFileSync(join(a, "project-pre.json"), "Project not found\n");
    }],
  ];
  for (const [what, arrange] of projectRefusals) {
    test(`REFUSAL — ${what}: linear-project-unverified in NFR-10 shape`, () => {
      const r = runContainersFence(docText(), "linear", arrange);
      expect(r.code).not.toBe(0);
      expectNfr10(r.err);
      expect(r.err).toMatch(/check=linear-project-unverified/);
    });
  }
  test("MUTATION — a check that only asks for a non-empty label page is red: it permits the page that lacks the tag", () => {
    const text = docText();
    const f = oneFence(text, CONTAINERS_TAG);
    const loose = f.body.replace(/jq -e [^\n]*labels-\$\{SIDE\}\.json"/, 'jq -e \'(.labels | length) > 0\' "${ANSWERS}/labels-${SIDE}.json"');
    expect(loose, "control: the label check's jq line is found").not.toBe(f.body);
    const r = runContainersFence(text.replace(f.body, loose), "linear", (a) => {
      allContainers(a);
      writeJson(join(a, "labels-a.json"), liveShape("linear", "list_issue_labels.more"));
    });
    expect(r.code, "the loosened check lets a missing label through").toBe(0);
  });
  test("MUTATION — a project check that ignores the team is red: it permits a project in another team", () => {
    const text = docText();
    const f = oneFence(text, CONTAINERS_TAG);
    const loose = f.body.replace(/ and \(\[\.teams\[\]\? \| select\(type == "object" and \.key == \$k\)\] \| length > 0\)/, "");
    expect(loose, "control: the team clause is found").not.toBe(f.body);
    const r = runContainersFence(text.replace(f.body, loose), "linear", (a) => {
      allContainers(a);
      writeJson(join(a, "project-pre.json"), projectNamed(PROJECTS.PRE, "OTHER"));
    });
    expect(r.code, "the loosened check lets a project in another team through").toBe(0);
  });

  /** Phase 0's Linear writes-to line names both projects and both tag labels. */
  function approvalLabelViolations(text: string): string[] {
    const line = runPhase0Full("linear", undefined, text).out.split("\n").find((l) => l.startsWith("writes to:")) ?? "";
    const v: string[] = [];
    for (const want of ["dpt-shared-<nonce>", "dpt-shared-<nonce>-pre", "shr-<nonce>-a", "shr-<nonce>-b"]) if (!line.includes(want)) v.push(`the Linear approval text does not name ${want}`);
    return v;
  }
  test("Phase 0's Linear approval text names the two labels the run creates, beside the two projects", () => {
    expect(approvalLabelViolations(docText())).toEqual([]);
  });
  test("MUTATION — an approval text without the labels is red", () => {
    const text = docText();
    const f = oneFence(text, "# shared-tracker-smoke: phase 0 —");
    const m = f.body.replace(/, and two issue labels[^"]*"/, '"');
    expect(m, "control: the label clause is found").not.toBe(f.body);
    expect(approvalLabelViolations(text.replace(f.body, m))).toEqual(["the Linear approval text does not name shr-<nonce>-a", "the Linear approval text does not name shr-<nonce>-b"]);
  });

  /** Phase 2 creates both labels with save_issue_label (never the deprecated create_issue_label) and saves each listing. */
  function phase2LabelViolations(text: string): string[] {
    const p2 = section(text, /^## Phase 2\b/);
    const v: string[] = [];
    for (const s of ["a", "b"]) {
      if (!p2.includes(`mcp__linear__save_issue_label(name: "shr-<nonce>-${s}", teamId: <LINEAR_TEAM_ID>)`)) v.push(`Phase 2 does not create shr-<nonce>-${s} with mcp__linear__save_issue_label`);
      if (!new RegExp(`mcp__linear__list_issue_labels\\(team: <LINEAR_TEAM>, name: shr-<nonce>-${s}\\)[^\\n]*labels-${s}\\.json`).test(p2)) v.push(`Phase 2 does not save shr-<nonce>-${s}'s listing as labels-${s}.json`);
    }
    if (/mcp__linear__create_issue_label\(/.test(p2)) v.push("Phase 2 calls the deprecated mcp__linear__create_issue_label");
    return v;
  }
  test("Phase 2 creates both labels with save_issue_label and saves both listings before the first spawn", () => {
    expect(phase2LabelViolations(docText())).toEqual([]);
  });
  test("MUTATION — Phase 2 prose calling create_issue_label is red", () => {
    const text = docText();
    const p2 = section(text, /^## Phase 2\b/);
    const m = text.replace(p2, p2.replaceAll("mcp__linear__save_issue_label(", "mcp__linear__create_issue_label("));
    expect(m).not.toBe(text);
    expect(phase2LabelViolations(m)).toEqual([
      "Phase 2 does not create shr-<nonce>-a with mcp__linear__save_issue_label",
      "Phase 2 does not create shr-<nonce>-b with mcp__linear__save_issue_label",
      "Phase 2 calls the deprecated mcp__linear__create_issue_label",
    ]);
  });

  /**
   * HIGH-B — Phase 2 names the project tool and its team argument. The team
   * argument is the one mcp__linear__save_project's schema requires on a create
   * ("`name` and at least one team (via `addTeams` or `setTeams`)", each "Team
   * name or ID"), handed the id the pre-flight resolved; and both projects'
   * get_project answers are saved where the containers check reads them.
   */
  function phase2ProjectViolations(text: string): string[] {
    const p2 = section(text, /^## Phase 2\b/);
    const v: string[] = [];
    for (const name of ["dpt-shared-<nonce>", "dpt-shared-<nonce>-pre"]) {
      if (!p2.includes(`mcp__linear__save_project(name: "${name}", addTeams: ["<LINEAR_TEAM_ID>"])`)) v.push(`Phase 2 does not create ${name} with mcp__linear__save_project and its addTeams team argument`);
    }
    if (!/`addTeams` or `setTeams`/.test(p2)) v.push("Phase 2 does not cite the schema's team requirement (addTeams or setTeams)");
    if (!/mcp__linear__get_project\(query: dpt-shared-<nonce>\)`? as `project-shared\.json`/.test(p2)) v.push("Phase 2 does not save the shared project's get_project answer as project-shared.json");
    if (!/mcp__linear__get_project\(query: dpt-shared-<nonce>-pre\)`? as `project-pre\.json`/.test(p2)) v.push("Phase 2 does not save the pre-repoint project's get_project answer as project-pre.json");
    return v;
  }
  test("HIGH-B — Phase 2 creates both projects with save_project and its team argument, and saves both get_project answers", () => {
    expect(phase2ProjectViolations(docText())).toEqual([]);
  });
  test("HIGH-B MUTATION — Phase 2 prose that names no team argument for the projects is red", () => {
    const text = docText();
    const p2 = section(text, /^## Phase 2\b/);
    const m = text.replace(p2, p2.replaceAll(', addTeams: ["<LINEAR_TEAM_ID>"])', ")"));
    expect(m).not.toBe(text);
    expect(phase2ProjectViolations(m)).toEqual([
      "Phase 2 does not create dpt-shared-<nonce> with mcp__linear__save_project and its addTeams team argument",
      "Phase 2 does not create dpt-shared-<nonce>-pre with mcp__linear__save_project and its addTeams team argument",
    ]);
  });

  /** E — the teardown-owed marker is written right after the FIRST tracker write, before the second. */
  function markerOrderViolations(text: string): string[] {
    const p2 = section(text, /^## Phase 2\b/);
    const writes = allIndexes(p2, /mcp__linear__save_(?:project|issue_label)\(/);
    const marker = p2.search(/teardown-owed/);
    if (writes.length < 4) return [`Phase 2 names ${writes.length} Linear creates, not four`];
    if (marker < 0) return ["Phase 2 never writes the teardown-owed marker"];
    const v: string[] = [];
    if (!(writes[0]! < marker)) v.push("the marker is written before the first tracker write");
    if (!(marker < writes[1]!)) v.push("the marker is written after the second tracker write: a failure between the first and the second create leaves a live project unflagged");
    return v;
  }
  test("E — Phase 2 writes the teardown-owed marker right after its first create and before its second", () => {
    expect(markerOrderViolations(docText())).toEqual([]);
  });
  test("E MUTATION — the marker written after all four creates is red", () => {
    const text = docText();
    const p2 = section(text, /^## Phase 2\b/);
    const sentence = /That is the run's first tracker write, so write the marker[^.]*\.[^.]*\./.exec(p2)?.[0];
    expect(sentence, "control: the marker sentence is found").toBeDefined();
    const moved = p2.replace(sentence!, "").replace("Record every create.", `Record every create. ${sentence}`);
    expect(markerOrderViolations(text.replace(p2, moved))).toEqual(["the marker is written after the second tracker write: a failure between the first and the second create leaves a live project unflagged"]);
  });
  test("E — Phase 5 says Linear's marker comes right after Phase 2's first project create", () => {
    expect(section(docText(), /^## Phase 5\b/)).toMatch(/right after its first project create and before its second write/);
  });

  /** HIGH-B + LOW-F — Phase 5 names both projects, and retires each label by the id its saved listing carries. */
  function phase5Violations(text: string): string[] {
    const p5 = section(text, /^## Phase 5\b/);
    const v: string[] = [];
    for (const name of ["`dpt-shared-<nonce>`", "`dpt-shared-<nonce>-pre`"]) if (!p5.includes(name)) v.push(`Phase 5 does not name the project ${name}`);
    if (!/cannot be deleted/.test(p5)) v.push("Phase 5 does not say a Linear label cannot be deleted through the MCP");
    if (!/not graded/.test(p5)) v.push("Phase 5 does not say the label retirement is not graded");
    if (!p5.includes("mcp__linear__retire_issue_label(id: <label id>)")) v.push("Phase 5 does not retire the labels by id");
    if (/retire_issue_label\((?:name|query):/.test(p5)) v.push("Phase 5 retires a label by name");
    if (!/labels-a\.json/.test(p5) || !/select\(\.name == \$t\) \| \.id/.test(p5)) v.push("Phase 5 does not say the id comes from the saved listing");
    return v;
  }
  test("Phase 5 names both projects, retires both labels by id read from the saved listings, and says this is not graded", () => {
    expect(phase5Violations(docText())).toEqual([]);
  });
  test("LOW-F MUTATION — Phase 5 retiring the labels by name is red", () => {
    const text = docText();
    const p5 = section(text, /^## Phase 5\b/);
    const m = text.replace(p5, p5.replace("mcp__linear__retire_issue_label(id: <label id>)", "mcp__linear__retire_issue_label(name: shr-<nonce>-a)"));
    expect(m).not.toBe(text);
    expect(phase5Violations(m)).toEqual(["Phase 5 does not retire the labels by id", "Phase 5 retires a label by name"]);
  });
});

describe("fifth audit HIGH-A — the containers fence fails closed on the run state", () => {
  test("REFUSAL — no run state at all: run-state-missing, non-zero, NFR-10, nothing run", () => {
    const r = runContainersFence(docText(), "linear", allContainers, { runEnv: false });
    expect(r.code).not.toBe(0);
    expectNfr10(r.err);
    expect(r.err).toMatch(/check=run-state-missing/);
    expect(r.out, "never the no-check branch").not.toMatch(/nothing is checked/);
    expect(r.calls).toBe(0);
  });
  test("REFUSAL — `<tracker>` left unsubstituted: run-state-missing, never the Jira no-check branch", () => {
    const r = runContainersFence(docText(), "linear", allContainers, { substitute: false });
    expect(r.code).not.toBe(0);
    expectNfr10(r.err);
    expect(r.err).toMatch(/check=run-state-missing/);
    expect(r.out).not.toMatch(/nothing is checked/);
  });
  for (const t of ["", "none", "Linear", "jira"]) {
    test(`REFUSAL — a Linear run state whose TRACKER is ${JSON.stringify(t)}: run-state-missing, never the no-check branch`, () => {
      const r = runContainersFence(docText(), "linear", allContainers, { over: { TRACKER: t === "" ? undefined : t } });
      expect(r.code).not.toBe(0);
      expectNfr10(r.err);
      expect(r.err).toMatch(/check=run-state-missing/);
      expect(r.out).not.toMatch(/nothing is checked/);
    });
  }
});

describe("fifth audit LOW-G — the containers fence reads its answers where the pre-flight read them", () => {
  test("PERMIT — a redirected PREFLIGHT_ANSWERS passes the pre-flight, is recorded in its env, and passes the containers check", () => {
    withSandbox("linear", (psb) => {
      const pf = runPreflight(psb, envFor(psb, { TRACKER: "linear" }));
      expect(pf.code, `${pf.out}\n${pf.err}`).toBe(0);
      expect(psb.answers.startsWith(`${psb.tmp}/`), "control: the answers directory is NOT under the /tmp the fences name").toBe(false);
      const pfEnv = readFileSync(join(psb.tmp, "dpt-shared-linear-preflight.env"), "utf-8");
      expect(pfEnv.split("\n")).toContain(`PREFLIGHT_ANSWERS=${realpathSync(psb.answers)}`);
      // The bootstrap appends the pre-flight env to the run state; the check then reads the redirected directory.
      const r = runContainersFence(docText(), "linear", allContainers, { answersDir: () => psb.answers, over: { PREFLIGHT_ANSWERS: undefined }, extraRunEnv: pfEnv });
      expect(r.code, `${r.out}\n${r.err}`).toBe(0);
    });
  });
});

// --- defect 4 (MEDIUM-1): the other leg's untracked bundle trips pre-flight check 5

describe("fourth audit, defect 4 (MEDIUM-1) — Phase 1 tells the operator to commit the other leg's bundle first", () => {
  test("Phase 1 carries the sentence: commit the other tracker's evidence bundle before this pre-flight, since it refuses an untracked bundle", () => {
    expect(section(docText(), /^## Phase 1\b/)).toMatch(/other tracker's leg already ran[^\n]*commit its evidence bundle[^\n]*outside the behaviour digest[^\n]*before this pre-flight[^\n]*refuses an untracked bundle/);
  });
});

// ===========================================================================
// Fifth audit — the run-state preamble. Every fence that sources the run state
// does so through ONE preamble, enforced here as one thing: the fences are
// enumerated FROM THE DOCUMENT (every bash fence whose code sources a
// `…-run.env`), never from a list typed here, so a fence added later is caught.
//
// ENFORCEMENT (byte-identical + structural): the lines from
// `# run-state preamble: begin` to `# run-state preamble: end` are the same
// bytes in every such fence; above them sit only the tag and comment lines, an
// optional `set -e`, and exactly the two declaration lines `RUN_STATE_NEEDS=…`
// and `RUN_STATE_NEEDS_LINEAR=…` immediately before the begin marker; and the
// run state is sourced nowhere outside the preamble.
// ===========================================================================

const PREAMBLE_BEGIN = "# run-state preamble: begin";
const PREAMBLE_END = "# run-state preamble: end";
const RUN_STATE_SOURCE_RE = /^\s*(?:\.|source)\s+"?(?:[^"\s]*-run\.env|\$\{RUN_ENV\})"?\s*(?:$|[;&|])/;

function codeLinesOf(f: Fence): string[] {
  const kinds = classifyLines(f.lines);
  return f.lines.filter((_, i) => kinds[i] === "code");
}

/** Every bash fence whose CODE sources the run state, read off the document. */
function runStateFences(text: string): Fence[] {
  return parseFences("shared-tracker-smoke", text).filter((f) => f.info === "bash" && codeLinesOf(f).some((l) => RUN_STATE_SOURCE_RE.test(l)));
}

const fenceTag = (f: Fence): string => f.lines.find((l) => l.trim().startsWith("# shared-tracker-smoke:"))?.trim().replace(/ — .*$/, "") ?? `fence at line ${f.openLine}`;

function declaredNeeds(f: Fence): { all: string[]; linear: string[] } {
  const pick = (name: string) => (new RegExp(`^${name}="([^"]*)"$`, "m").exec(f.body)?.[1] ?? "").split(/\s+/).filter(Boolean);
  return { all: pick("RUN_STATE_NEEDS"), linear: pick("RUN_STATE_NEEDS_LINEAR") };
}

function preambleBlock(f: Fence): string | null {
  const b = f.lines.indexOf(PREAMBLE_BEGIN.length ? f.lines.find((l) => l.startsWith(PREAMBLE_BEGIN)) ?? "\0" : "\0");
  const e = f.lines.indexOf(PREAMBLE_END);
  return b >= 0 && e > b ? f.lines.slice(b, e + 1).join("\n") : null;
}

function preambleViolations(text: string): string[] {
  const fs = runStateFences(text);
  if (fs.length === 0) return ["no fence sources the run state"];
  const v: string[] = [];
  const blocks = fs.map(preambleBlock);
  const counts = new Map<string, number>();
  for (const b of blocks) if (b !== null) counts.set(b, (counts.get(b) ?? 0) + 1);
  const canonical = [...counts.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null;
  fs.forEach((f, k) => {
    const tag = fenceTag(f);
    const begins = f.lines.filter((l) => l.startsWith(PREAMBLE_BEGIN)).length;
    const ends = f.lines.filter((l) => l === PREAMBLE_END).length;
    if (begins !== 1 || ends !== 1 || blocks[k] === null) {
      v.push(`${tag}: sources the run state without exactly one run-state preamble`);
      return;
    }
    if (blocks[k] !== canonical) v.push(`${tag}: its run-state preamble is not byte-identical to the others`);
    const b = f.lines.findIndex((l) => l.startsWith(PREAMBLE_BEGIN));
    const e = f.lines.indexOf(PREAMBLE_END);
    if (!/^RUN_STATE_NEEDS="[^"]*"$/.test(f.lines[b - 2] ?? "") || !/^RUN_STATE_NEEDS_LINEAR="[^"]*"$/.test(f.lines[b - 1] ?? "")) v.push(`${tag}: the two declaration lines do not sit immediately above the preamble`);
    const above = f.lines.slice(0, Math.max(0, b - 2)).filter((l) => l.trim() !== "" && !/^\s*#/.test(l) && !/^set -[eu]+$/.test(l.trim()));
    if (above.length > 0) v.push(`${tag}: code runs before the run-state preamble: ${above[0]!.trim()}`);
    const kinds = classifyLines(f.lines);
    f.lines.forEach((l, i) => {
      if (kinds[i] === "code" && (i < b || i > e) && RUN_STATE_SOURCE_RE.test(l)) v.push(`${tag}: sources the run state outside the preamble: ${l.trim()}`);
    });
  });
  return v;
}

describe("fifth audit — every fence that reads the run state reads it through the one run-state preamble", () => {
  test("the fences are enumerated from the document, and every one carries the byte-identical preamble", () => {
    const fs = runStateFences(docText());
    expect(fs.length, "the document holds fences that source the run state").toBeGreaterThan(0);
    expect(preambleViolations(docText())).toEqual([]);
  });
  test("MUTATION — one fence whose preamble is replaced by a bare source line is red, and is still enumerated", () => {
    const text = docText();
    const f = oneFence(text, "# shared-tracker-smoke: S11 worktree");
    const block = preambleBlock(f)!;
    const m = text.replace(f.body, f.body.replace(block, ". /tmp/dpt-shared-<tracker>-run.env"));
    expect(runStateFences(m).length, "the stripped fence is still found by what it does").toBe(runStateFences(text).length);
    expect(preambleViolations(m)).toEqual(["# shared-tracker-smoke: S11 worktree: sources the run state without exactly one run-state preamble"]);
  });
  test("MUTATION — one byte changed in one fence's preamble is red", () => {
    const text = docText();
    const f = oneFence(text, "# shared-tracker-smoke: audit");
    const m = text.replace(f.body, f.body.replace('case "${TRACKER:-}:<tracker>" in', 'case "${TRACKER:-}:<tracker>"  in'));
    expect(m).not.toBe(text);
    expect(preambleViolations(m)).toEqual(["# shared-tracker-smoke: audit: its run-state preamble is not byte-identical to the others"]);
  });
  test("MUTATION — an eleventh fence that sources the run state bare is caught without editing this test", () => {
    const text = docText();
    const extra = "\n```bash\n# shared-tracker-smoke: a later fence\n. /tmp/dpt-shared-<tracker>-run.env\ngit -C \"${ROOT_B}\" status\n```\n";
    const m = text + extra;
    expect(runStateFences(m).length).toBe(runStateFences(text).length + 1);
    expect(preambleViolations(m)).toEqual(["# shared-tracker-smoke: a later fence: sources the run state without exactly one run-state preamble"]);
  });
  test("MUTATION — a fence that sources the run state a second time, after its preamble, is red", () => {
    const text = docText();
    const f = oneFence(text, "# shared-tracker-smoke: extract and grade");
    const m = text.replace(f.body, f.body.replace(`${PREAMBLE_END}\n`, `${PREAMBLE_END}\n. /tmp/dpt-shared-<tracker>-run.env\n`));
    expect(preambleViolations(m)).toEqual(["# shared-tracker-smoke: extract and grade: sources the run state outside the preamble: . /tmp/dpt-shared-<tracker>-run.env"]);
  });
});

// --- omit-one rows: fences × declared variables, plus a missing run state and a bad TRACKER per fence

/** A complete run state: every variable any fence declares. A declared variable missing here fails the row loudly. */
function completeRunState(sb: StubSandbox, tracker: "jira" | "linear"): Record<string, string> {
  return {
    TRACKER: tracker,
    NONCE: FILL.nonce,
    TOPLEVEL: sb.work,
    ROOT_A: join(sb.root, "A"),
    ROOT_B: join(sb.root, "B"),
    PLUGIN_TREE: join(sb.work, "plugins", "dev-process-toolkit"),
    PLUGIN_BELOW_FLOOR: join(sb.root, "below"),
    PLUGIN_INTRUDER: join(sb.root, "intruder"),
    OLD_CLIENT: join(sb.root, "old"),
    DPT_SMOKE_RUN_ID: RUN_ID,
    SPAWN_CEILING: "28",
    DIGEST_AT_START: "a".repeat(64),
    RUN_START_MS: "1",
    SHARED: tracker === "linear" ? PROJECTS.SHARED : "DST",
    PRE: tracker === "linear" ? PROJECTS.PRE : "DST2",
    LINEAR_TEAM: tracker === "linear" ? "STE" : "",
    PREFLIGHT_ANSWERS: join(sb.root, "answers"),
    VERDICT_FILE: join(sb.root, "verdict.json"),
  };
}

/** The fence's hand-filled placeholder lines, filled; `<tracker>` substituted. */
function filledFenceBody(f: Fence, tracker: string): string {
  const fills: Record<string, string> = { STEP_NAME: "4-S1", STEP_MARKER: "S1", STEP_ROOT: "A", STEP_CLIENT: "tree", AUDIT_PASS: "1", SPAN_TOKEN: FILL.token, SHARED: "DST", PRE: "" };
  return f.body.replaceAll("<tracker>", tracker).replace(/^([A-Z_]+)="<[^"\n]*>"$/gm, (_, k: string) => `${k}="${fills[k] ?? "x"}"`);
}

interface RunStateRow {
  code: number;
  out: string;
  err: string;
  calls: number;
}

function runRunStateFence(f: Fence, tracker: "jira" | "linear", edit: (vars: Record<string, string | undefined>) => void, runEnv = true): RunStateRow {
  let res: RunStateRow = { code: -1, out: "", err: "", calls: 0 };
  withStub((sb) => {
    for (const d of ["A", "B"]) mkdirSync(join(sb.root, d), { recursive: true });
    const vars: Record<string, string | undefined> = completeRunState(sb, tracker);
    edit(vars);
    if (runEnv) writeFileSync(join(sb.tmp, `dpt-shared-${tracker}-run.env`), `${Object.entries(vars).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${v}`).join("\n")}\n`);
    const r = runStubScript(sb, rebaseIntoStub(filledFenceBody(f, tracker), sb), stubEnv(sb, GIT_ENV));
    res = { code: r.exitCode, out: r.out, err: r.err, calls: readStubCalls(sb).length };
  });
  return res;
}

function expectRunStateRefusal(r: RunStateRow, names?: string): void {
  const dump = `exit=${r.code}\n--- stdout ---\n${r.out}\n--- stderr ---\n${r.err}`;
  expect(r.code, dump).not.toBe(0);
  expectNfr10(r.err);
  expect(r.err, dump).toMatch(/check=run-state-missing/);
  expect(r.calls, `no bun and no claude ran before the refusal\n${dump}`).toBe(0);
  if (names) expect(r.err, dump).toContain(names);
}

describe("fifth audit — each fence refuses run-state-missing when one declared variable is omitted, the run state is missing, or TRACKER is wrong", () => {
  const text = docText();
  for (const f of runStateFences(text)) {
    const tag = fenceTag(f);
    const needs = declaredNeeds(f);
    const trackers: Array<"jira" | "linear"> = needs.linear.length > 0 ? ["jira", "linear"] : ["jira"];
    test(`${tag}: its declared run state is covered by the complete fixture`, () => {
      withStub((sb) => {
        const have = Object.keys(completeRunState(sb, "linear"));
        expect([...needs.all, ...needs.linear].filter((n) => !have.includes(n)), "a declared variable the fixture does not supply").toEqual([]);
      });
      expect(needs.all, "TRACKER is always declared").toContain("TRACKER");
    });
    for (const tracker of trackers) {
      test(`${tag} (${tracker}) PERMIT TWIN — the complete run state gets past the preamble`, () => {
        const r = runRunStateFence(f, tracker, () => {});
        expect(r.err, `exit=${r.code}\n${r.out}\n${r.err}`).not.toMatch(/check=run-state-missing/);
      });
      const omit = tracker === "linear" ? [...needs.all, ...needs.linear] : needs.all;
      for (const name of omit) {
        test(`${tag} (${tracker}) — ${name} omitted from the run state: refused`, () => {
          expectRunStateRefusal(runRunStateFence(f, tracker, (v) => { delete v[name]; }), name);
        });
      }
      test(`${tag} (${tracker}) — no run state at all: refused`, () => {
        expectRunStateRefusal(runRunStateFence(f, tracker, () => {}, false));
      });
      const other = tracker === "jira" ? "linear" : "jira";
      for (const bad of ["none", "bogus", other]) {
        test(`${tag} (${tracker}) — the run state says TRACKER=${bad}: refused`, () => {
          expectRunStateRefusal(runRunStateFence(f, tracker, (v) => { v.TRACKER = bad; }));
        });
      }
    }
  }
});

// --- the S11 shape, swept across every fence: a variable that means "here" or "/" when empty

const ENV_GUARANTEED = new Set(["HOME"]);

interface Site {
  fence: string;
  variable: string;
  line: string;
}

/** `${X}` / `$X` references in `s` that could expand empty (a non-empty `:-`/`-`/`:=` default, or `:+`/`+`, is safe). */
function mayBeEmptyRefs(s: string): string[] {
  const out: string[] = [];
  for (const m of s.matchAll(/\$\{(!|#)?([A-Za-z_][A-Za-z0-9_]*)(\[[^\]]*\])?([^}]*)\}/g)) {
    if (m[1]) continue;
    const op = m[4] ?? "";
    if (/^:?[-=]./.test(op) || /^:?\+/.test(op)) continue;
    out.push(m[2]!);
  }
  for (const m of s.matchAll(/\$([A-Za-z_][A-Za-z0-9_]*)/g)) out.push(m[1]!);
  return out;
}

/** Every interpolation where an empty variable means "here" (git -C, cd, …) or "/" (a path prefix). */
function dangerousSites(f: Fence): Site[] {
  const tag = fenceTag(f);
  const sites: Site[] = [];
  const add = (seg: string, line: string) => { for (const v of mayBeEmptyRefs(seg)) sites.push({ fence: tag, variable: v, line: line.trim() }); };
  for (const line of codeLinesOf(f)) {
    for (const m of line.matchAll(/\bgit -C\s+("[^"]*"|\S+)/g)) add(m[1]!, line);
    for (const m of line.matchAll(/(?:^|[;&|({]\s*|\bthen\s+|\bdo\s+|\$\(\s*)(?:cd|rm|mkdir|cp|mv|chmod)\b([^;&|)`]*)/g)) add(m[1]!, line);
    for (const m of line.matchAll(/\bworktree add\b([^;&|)`]*)/g)) add(m[1]!, line);
    for (const m of line.matchAll(/--(?:plugin-dir|project-root)\s+("[^"]*"|\S+)/g)) add(m[1]!, line);
    for (const m of line.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)([%#][^}]*)?\}"?\//g)) sites.push({ fence: tag, variable: m[1]!, line: line.trim() });
    for (const m of line.matchAll(/\$([A-Za-z_][A-Za-z0-9_]*)"?\//g)) sites.push({ fence: tag, variable: m[1]!, line: line.trim() });
  }
  return sites;
}

/** The variables a local variable is built from: every assignment's right-hand side, loop list, or read (none). */
function assignments(f: Fence): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const put = (k: string, refs: string[]) => map.set(k, [...(map.get(k) ?? []), ...refs]);
  for (const line of codeLinesOf(f)) {
    for (const m of line.matchAll(/(?:^|[\s;(])(?:local\s+|export\s+)?([A-Za-z_][A-Za-z0-9_]*)\+?=(.*)$/g)) put(m[1]!, mayBeEmptyRefs(m[2]!));
    for (const m of line.matchAll(/\bfor\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+([^;]*)/g)) put(m[1]!, mayBeEmptyRefs(m[2]!));
    for (const m of line.matchAll(/\bread\s+(?:-r\s+)?([A-Za-z_][A-Za-z0-9_]*)/g)) put(m[1]!, []);
  }
  return map;
}

/** The variables a site ultimately rests on that this fence never assigns: the ones something outside must supply. */
function rootsOf(v: string, asg: Map<string, string[]>, seen = new Set<string>()): string[] {
  if (seen.has(v)) return [];
  seen.add(v);
  const rhs = asg.get(v);
  if (rhs === undefined) return [v];
  return [...new Set(rhs.flatMap((r) => rootsOf(r, asg, seen)))];
}

function guardedIn(f: Fence, v: string): boolean {
  const b = f.body;
  return b.includes(`-n "\${${v}}"`) || b.includes(`-z "\${${v}}"`) || b.includes(`case "\${${v}:-}"`) || b.includes(`case "\${${v}}"`);
}

/** Violations: a dangerous site resting on a variable the fence neither declares (run-state fences) nor guards (the others). */
function sweepViolations(text: string): { sites: Site[]; violations: string[] } {
  const sites: Site[] = [];
  const v: string[] = [];
  const rs = new Set(runStateFences(text).map((f) => f.openLine));
  for (const f of parseFences("shared-tracker-smoke", text).filter((x) => x.info === "bash")) {
    const asg = assignments(f);
    const declared = new Set([...declaredNeeds(f).all, ...declaredNeeds(f).linear]);
    for (const s of dangerousSites(f)) {
      sites.push(s);
      for (const root of rootsOf(s.variable, asg)) {
        if (ENV_GUARANTEED.has(root)) continue;
        const ok = rs.has(f.openLine) ? declared.has(root) : guardedIn(f, root);
        if (!ok) v.push(`${s.fence}: ${root} (via ${s.variable}) may be empty at: ${s.line}`);
      }
    }
  }
  return { sites, violations: [...new Set(v)] };
}

describe("fifth audit — the S11 shape swept across every fence: no path site rests on an undeclared, unguarded variable", () => {
  test("every git -C / cd / rm / mkdir / cp / mv / chmod / worktree add / --plugin-dir / --project-root / path-prefix site rests on a declared or guarded variable", () => {
    const { sites, violations } = sweepViolations(docText());
    expect(sites.length, "control: the sweep finds sites").toBeGreaterThan(20);
    expect(violations).toEqual([]);
  });
  test("CONTROL — the sweep sees S11's own git -C \"${ROOT_B}\" site, resting on its declared ROOT_B", () => {
    const { sites } = sweepViolations(docText());
    expect(sites.some((s) => s.fence === "# shared-tracker-smoke: S11 worktree" && s.variable === "ROOT_B" && /git -C "\$\{ROOT_B\}"/.test(s.line))).toBe(true);
  });
  test("MUTATION — an undeclared variable interpolated into git -C is red", () => {
    const text = docText();
    const f = oneFence(text, "# shared-tracker-smoke: S11 worktree");
    const m = text.replace(f.body, f.body.replace(`${PREAMBLE_END}\n`, `${PREAMBLE_END}\ngit -C "\${ROOT_C}" status >/dev/null\n`));
    expect(sweepViolations(m).violations).toEqual(['# shared-tracker-smoke: S11 worktree: ROOT_C (via ROOT_C) may be empty at: git -C "${ROOT_C}" status >/dev/null']);
  });
  test("MUTATION — a declared variable dropped from S11's declaration is red (W rests on ROOT_B)", () => {
    const text = docText();
    const f = oneFence(text, "# shared-tracker-smoke: S11 worktree");
    const m = text.replace(f.body, f.body.replace('RUN_STATE_NEEDS="TRACKER ROOT_B"', 'RUN_STATE_NEEDS="TRACKER"'));
    expect(m).not.toBe(text);
    expect(sweepViolations(m).violations.some((x) => /S11 worktree: ROOT_B \(via W\)/.test(x))).toBe(true);
  });
});

// --- S11, driven: ROOT_B empty, the operator standing in another git repository

describe("fifth audit — S11 with ROOT_B empty never touches the repository the operator stands in", () => {
  test("RUN — the operator's cwd is a git repository with an edited CLAUDE.md: refused run-state-missing, no commit there, no exclude line", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "ste617-s11cwd-")));
    try {
      const tmp = join(root, "tmp");
      const op = join(root, "operator");
      mkdirSync(tmp, { recursive: true });
      gitRepo(op, { "CLAUDE.md": "# operator\n" });
      writeFileSync(join(op, "CLAUDE.md"), "# operator, edited and uncommitted\n");
      writeFileSync(join(tmp, "dpt-shared-jira-run.env"), "TRACKER=jira\n");
      const head = sh(op, ["git", "rev-parse", "HEAD"]).out;
      const r = runOperatorFence(oneFence(docText(), S11_TAG).body, tmp, op);
      expect(r.code).not.toBe(0);
      expectNfr10(r.err);
      expect(r.err).toMatch(/check=run-state-missing/);
      expect(sh(op, ["git", "rev-parse", "HEAD"]).out, "no commit landed in the operator's repository").toBe(head);
      expect(sh(op, ["git", "status", "--porcelain"]).out.trim(), "the operator's edit is left as it was").toBe("M CLAUDE.md");
      expect(readFileSync(join(op, ".git", "info", "exclude"), "utf-8")).not.toContain("/.s11/");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// --- D: every refusal remedy names a path whose preconditions it does not destroy

/**
 * A remedy may not send the operator to re-run a step whose preconditions the
 * path it names destroys. Phase 0.5 deletes the pre-flight env, wipes the
 * answers, the step logs and the teardown-owed marker, and mints a new nonce;
 * the bootstrap cannot run over repositories it already made. So: a remedy
 * directing the operator to Phase 0.5 (a mention explaining what it deletes,
 * wipes, mints or keeps is not a direction) either says never, or comes after § Phase 5 — Teardown and
 * then names Phase 1 and Phase 2 (or "a new run from Phase 0.5"); no remedy
 * re-runs the bootstrap after it wrote (outside the bootstrap, or below its
 * first write); a remedy that runs Phase 2 names Phase 1 first. The Phase 0.5
 * fence's own "run Phase 0.5 again" is legal: it refuses before removing anything.
 */
function remedyViolations(text: string): string[] {
  const v: string[] = [];
  for (const f of parseFences("shared-tracker-smoke", text).filter((x) => x.info === "bash")) {
    const tag = fenceTag(f);
    if (tag === "# shared-tracker-smoke: phase 0.5") continue;
    const kinds = classifyLines(f.lines);
    const firstWrite = f.lines.findIndex((l, i) => kinds[i] === "code" && /^\s*mkdir -p\b/.test(l));
    f.lines.forEach((l, i) => {
      if (kinds[i] !== "code") return;
      for (const m of l.matchAll(/Phase 0\.5/g)) {
        const before = l.slice(0, m.index!);
        const after = l.slice(m.index! + m[0].length);
        if (/never\b[^"]{0,40}$/.test(before)) continue;
        // An explanation of what Phase 0.5 does is not a direction to run it.
        if (/^ (?:deletes|wipes|mints|keeps|mid-run)\b/.test(after)) continue;
        const teardownFirst = /§ Phase 5 — Teardown/.test(before);
        const fullPath = /Phase 1\b/.test(after) && /Phase 2\b/.test(after);
        if (!(teardownFirst && (fullPath || /a new run from $/.test(before)))) v.push(`${tag}: a remedy names Phase 0.5 without the legal path (Teardown, then Phase 0.5, Phase 1, Phase 2): ${l.trim().slice(0, 160)}`);
      }
      if (/re-run the bootstrap|(?:the|this) bootstrap again/.test(l)) {
        const inBootBeforeWrite = tag === "# shared-tracker-smoke: bootstrap" && firstWrite >= 0 && i < firstWrite && !/Phase 0\.5 and the bootstrap/.test(l);
        if (!inBootBeforeWrite) v.push(`${tag}: a remedy re-runs the bootstrap after it wrote: ${l.trim().slice(0, 160)}`);
      }
      for (const m of l.matchAll(/\b(?:run|then) Phase 2\b/g)) {
        if (!/Phase 1\b/.test(l.slice(0, m.index!))) v.push(`${tag}: a remedy runs Phase 2 without Phase 1 first: ${l.trim().slice(0, 160)}`);
      }
      if (/set LINEAR_TEAM to/.test(l)) v.push(`${tag}: a remedy has the operator set LINEAR_TEAM in the shell, which the sourced state overrides: ${l.trim().slice(0, 160)}`);
    });
  }
  return v;
}

describe("fifth audit D — every refusal remedy names a legal path out", () => {
  test("no remedy re-runs a step whose preconditions its own path destroys", () => {
    expect(remedyViolations(docText())).toEqual([]);
  });
  test("RUN — binding-team-missing's remedy names Teardown, then Phase 0.5, Phase 1 (pre-flight) and Phase 2", () => {
    const r = runBootstrap(withoutTeamFlag(docText()), "linear");
    expect(r.err).toMatch(/check=binding-team-missing/);
    const remedy = r.err.split("\n").find((l) => l.startsWith("Remedy: ")) ?? "";
    expect(remedy).toMatch(/§ Phase 5 — Teardown[^\n]*then Phase 0\.5, Phase 1 \(pre-flight\) and Phase 2/);
  }, 60_000);
  test("MUTATION — the old binding-team-missing remedy (Phase 0.5 and the bootstrap again) is red", () => {
    const text = docText();
    const f = oneFence(text, BOOT_TAG);
    const old = f.body.replace(/"fix the binding write so both declarations carry team: \$\{LINEAR_TEAM\}, then start the run again[^"]*"/, '"fix the binding write so both declarations carry team: ${LINEAR_TEAM}, then run Phase 0.5 and the bootstrap again; run § Phase 5 — Teardown first if you abandon the run, since Phase 2\'s creates made it owed."');
    expect(old, "control: the remedy is found").not.toBe(f.body);
    const v = remedyViolations(text.replace(f.body, old));
    expect(v.length).toBe(2);
    expect(v.every((x) => x.startsWith("# shared-tracker-smoke: bootstrap:"))).toBe(true);
  });
  test("MUTATION — the old ceiling-unset remedy (rebuild from Phase 0 and Phase 0.5, then teardown) is red", () => {
    const text = docText();
    const f = oneFence(text, STEP_TAG);
    const old = f.body.replace(/"restore it from Phase 0's plan[^"]*"/, '"rebuild the run state from Phase 0 and Phase 0.5 before any further step, and run § Phase 5 — Teardown now if a scenario child was already spawned."');
    expect(old, "control: the remedy is found").not.toBe(f.body);
    expect(remedyViolations(text.replace(f.body, old))).toHaveLength(1);
  });
});

describe("no skipped, todo or conditional test forms in this suite", () => {
  test("the suite's own source carries none", () => {
    const src = readFileSync(import.meta.path, "utf-8");
    for (const f of ["test" + ".skip(", "test" + ".todo(", "test" + ".if(", "describe" + ".skip(", "it" + ".skip("]) expect(src.includes(f), f).toBe(false);
  });
});

// --- the wait fence: a missing pidfile is not "exited" ----------------------
//
// The step fence removes the pidfile only on its abort path, so a missing (or
// empty) pidfile means no step launched or its launch was aborted. The wait
// fence used to read that as `exited:` and exit 0, telling the operator a step
// had finished that never ran. It now refuses; a pidfile naming a finished
// process is still reported exited (the permit twin).
describe("the wait fence — a missing pidfile refuses, a finished process is exited", () => {
  const WAIT_TAG = "# shared-tracker-smoke: wait";
  const runWait = (arrange: (tmp: string) => void) => {
    let res = { code: -1, out: "", err: "" };
    withStub((sb) => {
      arrange(sb.tmp);
      const r = runStubScript(sb, rebaseIntoStub(oneFence(docText(), WAIT_TAG).body.replaceAll("<tracker>", "jira"), sb), stubEnv(sb));
      res = { code: r.exitCode, out: r.out, err: r.err };
    });
    return res;
  };
  for (const [label, arrange] of [
    ["no pidfile", (_t: string) => {}],
    ["an empty pidfile", (t: string) => writeFileSync(join(t, "dpt-shared-jira-step.pid"), "")],
  ] as const) {
    test(`REFUSE — ${label}: non-zero, NFR-10 step-pid-missing, never "exited"`, () => {
      const r = runWait(arrange);
      expect(r.code).not.toBe(0);
      expect(r.out).not.toMatch(/exited:/);
      expect(r.err).toMatch(/check=step-pid-missing/);
    });
  }
  test("PERMIT — a pidfile naming a finished process reports exited and exits 0", () => {
    const done = Bun.spawnSync(["true"]);
    expect(done.exitCode).toBe(0);
    const r = runWait((t) => writeFileSync(join(t, "dpt-shared-jira-step.pid"), `${done.pid}\n`));
    expect(r.code, r.err).toBe(0);
    expect(r.out).toMatch(/^exited: \d+/m);
  });
});
