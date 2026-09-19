// STE-603 — setup declares a shared container and leaves a stop paragraph
// older clients obey.
//
// Suite for the tracker sub-section writer
// (`adapters/_shared/src/setup/tracker_binding_write.ts`): its front door,
// preservation, refusals, unshare and the stop-paragraph render; the setup
// reference wiring scan; the old-client leg; the budget and reachability pins;
// and the product contract line in `specs/requirements.md`.
//
// Probe #25's new legs are graded in
// `tests/gate-check-task-tracking-workspace-binding-present.test.ts`.
//
// The writer module is loaded with `await import(...)` INSIDE each test so
// every AC reds (and later greens) on its own rather than the file failing to
// link. The writer's behaviour is graded through its spawned front door; the
// running toolkit version is chosen by pointing `CLAUDE_PLUGIN_ROOT` at a
// fixture manifest. Every fixture is removed in `finally`.

import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeMd, makeSpanFixture, pluginManifest } from "./_span_fixture";
import { readWorkspaceBinding } from "../adapters/_shared/src/workspace_binding";
import { FIRST_GATED_DPT_VERSION } from "../adapters/_shared/src/dpt_version";
import { runTaskTrackingCanonicalKeysProbe } from "../adapters/_shared/src/task_tracking_canonical_keys";
import { runTaskTrackingWorkspaceBindingPresentProbe } from "../adapters/_shared/src/task_tracking_workspace_binding_present";
import {
  buildModuleGraph,
  ORDERED_UNREACHABLE_PIN_LEDGER,
  runModuleReachabilityProbe,
} from "../adapters/_shared/src/module_reachability";
import { runRootHygiene } from "../adapters/_shared/src/root_hygiene";

const pluginRoot = join(import.meta.dir, "..");
const repoRoot = join(pluginRoot, "..", "..");
const sharedSrc = join(pluginRoot, "adapters", "_shared", "src");
const writerPath = join(sharedSrc, "setup", "tracker_binding_write.ts");
const probe25Path = join(sharedSrc, "task_tracking_workspace_binding_present.ts");
const PRE_CHANGE = "ac1f3cb";
const TAG = "glacy-be";
const MARKER = "> **Shared tracker container — stop before any tracker write.**";

/** A strict version one minor above `v`. */
function above(v: string): string {
  const [a, b] = v.split(".").map(Number) as [number, number, number];
  return `${a}.${b + 1}.0`;
}

const FLOOR = FIRST_GATED_DPT_VERSION;
const HIGHER = above(FIRST_GATED_DPT_VERSION);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyModule = any;

async function loadWriter(): Promise<AnyModule> {
  expect(existsSync(writerPath), `the writer module must exist at ${writerPath}`).toBe(true);
  return await import(writerPath);
}

interface RenderInput {
  adapter: "jira" | "linear";
  project: string;
  repoTag: string;
  minDptVersion: string;
}

async function render(input: RenderInput): Promise<string> {
  const mod = await loadWriter();
  expect(typeof mod.renderSharedTrackerSentinel).toBe("function");
  const out = mod.renderSharedTrackerSentinel(input);
  expect(typeof out).toBe("string");
  return out as string;
}

// ------------------------------------------------------------------ fixtures

async function withRoots<T>(body: (f: { a: string; b: string }) => Promise<T>): Promise<T> {
  const f = makeSpanFixture("M_947c79", { repositories: false });
  try {
    return await body(f);
  } finally {
    f.cleanup();
  }
}

/** A manifest dir holding `.claude-plugin/plugin.json` at `version`. */
function manifestDir(parent: string, version: string): string {
  const dir = join(parent, `manifest-${version}`);
  pluginManifest(dir, version);
  return dir;
}

async function withRunning<T>(parent: string, version: string, fn: () => Promise<T>): Promise<T> {
  const dir = manifestDir(parent, version);
  const prev = process.env.CLAUDE_PLUGIN_ROOT;
  process.env.CLAUDE_PLUGIN_ROOT = dir;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_PLUGIN_ROOT;
    else process.env.CLAUDE_PLUGIN_ROOT = prev;
  }
}

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function spawn(cmd: string[], env: Record<string, string>): Promise<RunResult> {
  const proc = Bun.spawn(cmd, {
    cwd: pluginRoot,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

/** Run the writer's front door with the running version set to `version`. */
async function runWriter(
  root: string,
  args: string[],
  scratch: string,
  version: string,
): Promise<RunResult> {
  const dir = manifestDir(scratch, version);
  return await spawn(["bun", "run", writerPath, root, ...args], { CLAUDE_PLUGIN_ROOT: dir });
}

/**
 * The preservation fixture: a Jira sub-section carrying `jira_issue_type`, two
 * unrelated labels, an unknown free-form key and an interior blank line.
 */
function preservationClaudeMd(project = "GF"): string {
  return [
    "# Fixture Project",
    "",
    "Intro prose the writer never touches.",
    "",
    "## Task Tracking",
    "",
    "mode: jira",
    "mcp_server: atlassian",
    "",
    "### Jira",
    "",
    `project: ${project}`,
    "jira_issue_type: Story",
    "default_labels: [backend, urgent]",
    "owner_note: keep-me-verbatim",
    "",
    "board_url: https://example.test/board",
    "",
    "## Verification",
    "",
    "run_cmd: none",
    "",
  ].join("\n");
}

const OWNED_KEY_RE = /^(project|team|repo_tag|min_dpt_version|default_labels)\s*:/;

/** The lines of the active sub-section (between `### Jira|Linear` and the next heading). */
function subsection(content: string, title = "### Jira"): string[] {
  const lines = content.split("\n");
  const start = lines.indexOf(title);
  expect(start, `no ${title} heading`).toBeGreaterThanOrEqual(0);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{1,3}\s/.test(lines[i]!)) {
      end = i;
      break;
    }
  }
  return lines.slice(start + 1, end);
}

/** Foreign lines of the sub-section, in order: owned keys and paragraph lines removed. */
function foreign(content: string): string[] {
  const out = subsection(content).filter((l) => !OWNED_KEY_RE.test(l) && !l.startsWith(">"));
  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out;
}

/** Everything outside the sub-section: the prefix up to its heading and the suffix from the next heading. */
function outside(content: string): { prefix: string; suffix: string } {
  const head = content.indexOf("### Jira\n");
  const tail = content.indexOf("\n## Verification");
  return { prefix: content.slice(0, head), suffix: content.slice(tail) };
}

function expectThreeLine(text: string): string[] {
  const lines = text.trimEnd().split("\n");
  expect(lines.length, `refusal is not exactly three lines:\n${text}`).toBe(3);
  expect(lines[0]!.trim().length).toBeGreaterThan(0);
  expect(lines[1]!.startsWith("Remedy:"), text).toBe(true);
  expect(lines[2]!.startsWith("Context:"), text).toBe(true);
  return lines;
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

// ============================================================ AC-STE-603.1

describe("AC-STE-603.1 — declaring yields a shared binding with one tag entry and the running floor", () => {
  test("front door: Jira declare → shared:true, tag once in default_labels, floor = manifest version", async () => {
    await withRoots(async ({ a, b }) => {
      claudeMd(a, { mode: "jira", project: "GF" });
      const r = await runWriter(a, ["jira", "--project", "GF", "--shared", TAG], b, HIGHER);
      expect(r.code, r.stderr).toBe(0);
      expect(r.stdout, "the front door prints a unified diff of what it wrote").toContain(
        `+repo_tag: ${TAG}`,
      );
      const got = readWorkspaceBinding(join(a, "CLAUDE.md"), "jira");
      expect(got.shared).toBe(true);
      expect(got.repoTag).toBe(TAG);
      expect(got.project).toBe("GF");
      expect(got.minDptVersion).toBe(HIGHER);
      expect((got.defaultLabels ?? []).filter((l) => l === TAG).length).toBe(1);
    });
  }, 30_000);

  test("front door: an existing tag entry in default_labels is never duplicated", async () => {
    await withRoots(async ({ a, b }) => {
      claudeMd(a, { mode: "jira", project: "GF", defaultLabels: ["backend", TAG] });
      const r = await runWriter(a, ["jira", "--project", "GF", "--shared", TAG], b, FLOOR);
      expect(r.code, r.stderr).toBe(0);
      const got = readWorkspaceBinding(join(a, "CLAUDE.md"), "jira");
      expect(got.defaultLabels).toEqual(["backend", TAG]);
      expect(got.minDptVersion).toBe(FLOOR);
    });
  }, 30_000);

  test("front door: Linear declare with --team writes team + project + declaration", async () => {
    await withRoots(async ({ a, b }) => {
      claudeMd(a, { mode: "linear", team: "STE", project: "DPT" });
      const r = await runWriter(
        a,
        ["linear", "--project", "DPT", "--team", "STE", "--shared", TAG],
        b,
        FLOOR,
      );
      expect(r.code, r.stderr).toBe(0);
      const got = readWorkspaceBinding(join(a, "CLAUDE.md"), "linear");
      expect(got).toEqual({
        team: "STE",
        project: "DPT",
        defaultLabels: [TAG],
        repoTag: TAG,
        minDptVersion: FLOOR,
        shared: true,
      });
    });
  }, 30_000);

  test("in-process: writeTrackerSubsection declares with the running version as the floor", async () => {
    const mod = await loadWriter();
    expect(typeof mod.writeTrackerSubsection).toBe("function");
    await withRoots(async ({ a, b }) => {
      claudeMd(a, { mode: "jira", project: "GF" });
      const path = join(a, "CLAUDE.md");
      await withRunning(b, HIGHER, async () => {
        await mod.writeTrackerSubsection(path, "jira", { project: "GF", shared: { repoTag: TAG } });
      });
      const got = readWorkspaceBinding(path, "jira");
      expect(got.shared).toBe(true);
      expect(got.repoTag).toBe(TAG);
      expect(got.minDptVersion).toBe(HIGHER);
      expect(count(readFileSync(path, "utf-8"), MARKER)).toBe(1);
    });
  }, 30_000);
});

// ============================================================ AC-STE-603.2

describe("AC-STE-603.2 — the writer preserves every line it does not own", () => {
  test("declare: foreign lines byte-identical and in order; outside the sub-section untouched; paragraph last", async () => {
    await withRoots(async ({ a, b }) => {
      const path = join(a, "CLAUDE.md");
      const original = preservationClaudeMd();
      writeFileSync(path, original);
      const r = await runWriter(a, ["jira", "--project", "GF", "--shared", TAG], b, FLOOR);
      expect(r.code, r.stderr).toBe(0);
      const after = readFileSync(path, "utf-8");

      expect(foreign(after)).toEqual(foreign(original));
      expect(outside(after)).toEqual(outside(original));
      expect(readWorkspaceBinding(path, "jira").defaultLabels).toEqual(["backend", "urgent", TAG]);

      const para = await render({ adapter: "jira", project: "GF", repoTag: TAG, minDptVersion: FLOOR });
      expect(count(after, para)).toBe(1);
      const sub = subsection(after);
      while (sub.length > 0 && sub[sub.length - 1] === "") sub.pop();
      const paraLines = para.trimEnd().split("\n");
      expect(sub.slice(-paraLines.length), "the paragraph is the last block of the sub-section").toEqual(
        paraLines,
      );
    });
  }, 30_000);

  test("re-run at the same running version is a byte-identical no-op", async () => {
    await withRoots(async ({ a, b }) => {
      const path = join(a, "CLAUDE.md");
      writeFileSync(path, preservationClaudeMd());
      const args = ["jira", "--project", "GF", "--shared", TAG];
      const first = await runWriter(a, args, b, FLOOR);
      expect(first.code, first.stderr).toBe(0);
      const once = readFileSync(path, "utf-8");
      const second = await runWriter(a, args, b, FLOOR);
      expect(second.code, second.stderr).toBe(0);
      expect(readFileSync(path, "utf-8")).toBe(once);
    });
  }, 30_000);

  test("re-run from a higher running version raises the floor and re-renders the paragraph, nothing else", async () => {
    await withRoots(async ({ a, b }) => {
      const path = join(a, "CLAUDE.md");
      writeFileSync(path, preservationClaudeMd());
      const args = ["jira", "--project", "GF", "--shared", TAG];
      expect((await runWriter(a, args, b, FLOOR)).code).toBe(0);
      const before = readFileSync(path, "utf-8");
      const r = await runWriter(a, args, b, HIGHER);
      expect(r.code, r.stderr).toBe(0);
      const oldPara = await render({ adapter: "jira", project: "GF", repoTag: TAG, minDptVersion: FLOOR });
      const newPara = await render({ adapter: "jira", project: "GF", repoTag: TAG, minDptVersion: HIGHER });
      expect(oldPara).not.toBe(newPara);
      const expected = before
        .replace(`min_dpt_version: ${FLOOR}`, `min_dpt_version: ${HIGHER}`)
        .replace(oldPara, newPara);
      expect(readFileSync(path, "utf-8")).toBe(expected);
    });
  }, 30_000);

  test("repoint re-renders the paragraph for the new project: the byte diff is the project line plus the paragraph", async () => {
    await withRoots(async ({ a, b }) => {
      const path = join(a, "CLAUDE.md");
      writeFileSync(path, preservationClaudeMd());
      expect((await runWriter(a, ["jira", "--project", "GF", "--shared", TAG], b, FLOOR)).code).toBe(0);
      const before = readFileSync(path, "utf-8");
      const r = await runWriter(a, ["jira", "--project", "GX"], b, FLOOR);
      expect(r.code, r.stderr).toBe(0);
      const oldPara = await render({ adapter: "jira", project: "GF", repoTag: TAG, minDptVersion: FLOOR });
      const newPara = await render({ adapter: "jira", project: "GX", repoTag: TAG, minDptVersion: FLOOR });
      const expected = before.replace("\nproject: GF\n", "\nproject: GX\n").replace(oldPara, newPara);
      const after = readFileSync(path, "utf-8");
      expect(after).toBe(expected);
      const got = readWorkspaceBinding(path, "jira");
      expect(got.shared, "a repoint keeps the declaration").toBe(true);
      expect(got.repoTag).toBe(TAG);

      // Probe #25 on the written tree: zero violations.
      await withRunning(b, FLOOR, async () => {
        const report = await runTaskTrackingWorkspaceBindingPresentProbe(a);
        expect(report.violations).toEqual([]);
      });

      // Control: the same repoint with the paragraph kept as it was → the paragraph violation.
      writeFileSync(path, after.replace(newPara, oldPara));
      await withRunning(b, FLOOR, async () => {
        const report = await runTaskTrackingWorkspaceBindingPresentProbe(a);
        expect(report.violations.length).toBe(1);
        expect(report.violations[0]!.note).toMatch(/paragraph/i);
      });
    });
  }, 30_000);

  test("a repoint made by a lower running version keeps the higher floor", async () => {
    await withRoots(async ({ a, b }) => {
      const path = join(a, "CLAUDE.md");
      writeFileSync(path, preservationClaudeMd());
      expect((await runWriter(a, ["jira", "--project", "GF", "--shared", TAG], b, HIGHER)).code).toBe(0);
      const before = readFileSync(path, "utf-8");
      const r = await runWriter(a, ["jira", "--project", "GX"], b, FLOOR);
      expect(r.code, r.stderr).toBe(0);
      const oldPara = await render({ adapter: "jira", project: "GF", repoTag: TAG, minDptVersion: HIGHER });
      const newPara = await render({ adapter: "jira", project: "GX", repoTag: TAG, minDptVersion: HIGHER });
      const expected = before.replace("\nproject: GF\n", "\nproject: GX\n").replace(oldPara, newPara);
      expect(readFileSync(path, "utf-8")).toBe(expected);
      expect(readWorkspaceBinding(path, "jira").minDptVersion).toBe(HIGHER);
    });
  }, 30_000);

  test("declare, repoint and re-run each leave the foreign lines byte-identical and in order", async () => {
    await withRoots(async ({ a, b }) => {
      const path = join(a, "CLAUDE.md");
      const original = preservationClaudeMd();
      writeFileSync(path, original);
      const steps: string[][] = [
        ["jira", "--project", "GF", "--shared", TAG],
        ["jira", "--project", "GX"],
        ["jira", "--project", "GX"],
      ];
      for (const args of steps) {
        const r = await runWriter(a, args, b, FLOOR);
        expect(r.code, `${args.join(" ")}\n${r.stderr}`).toBe(0);
        const now = readFileSync(path, "utf-8");
        expect(foreign(now)).toEqual(foreign(original));
        expect(outside(now)).toEqual(outside(original));
      }
    });
  }, 60_000);
});

// ============================================================ AC-STE-603.3

describe("AC-STE-603.3 — refusals leave the file byte-identical", () => {
  async function expectRefusal(
    root: string,
    scratch: string,
    args: string[],
    version: string,
    expectInStderr?: string,
  ): Promise<void> {
    const path = join(root, "CLAUDE.md");
    const before = readFileSync(path);
    const r = await runWriter(root, args, scratch, version);
    expect(r.code, `expected exit 1, got ${r.code}\nstdout:${r.stdout}\nstderr:${r.stderr}`).toBe(1);
    expect(r.stdout).toBe("");
    expectThreeLine(r.stderr);
    if (expectInStderr !== undefined) expect(r.stderr).toContain(expectInStderr);
    expect(readFileSync(path).equals(before), "the refused file must stay byte-identical").toBe(true);
  }

  test("no ## Task Tracking section", async () => {
    await withRoots(async ({ a, b }) => {
      writeFileSync(join(a, "CLAUDE.md"), "# Project\n\nNo tracker here.\n");
      await expectRefusal(a, b, ["jira", "--project", "GF", "--shared", TAG], FLOOR);
    });
  }, 30_000);

  test("mode: none", async () => {
    await withRoots(async ({ a, b }) => {
      writeFileSync(join(a, "CLAUDE.md"), "# Project\n\n## Task Tracking\n\nmode: none\n");
      await expectRefusal(a, b, ["jira", "--project", "GF", "--shared", TAG], FLOOR);
    });
  }, 30_000);

  test("an unreadable file", async () => {
    await withRoots(async ({ a, b }) => {
      claudeMd(a, { mode: "jira", project: "GF" });
      const path = join(a, "CLAUDE.md");
      const before = readFileSync(path);
      chmodSync(path, 0o000);
      try {
        const r = await runWriter(a, ["jira", "--project", "GF", "--shared", TAG], b, FLOOR);
        expect(r.code, r.stderr).toBe(1);
        expect(r.stdout).toBe("");
        expectThreeLine(r.stderr);
      } finally {
        chmodSync(path, 0o644);
      }
      expect(readFileSync(path).equals(before)).toBe(true);
    });
  }, 30_000);

  test("an invalid tag", async () => {
    await withRoots(async ({ a, b }) => {
      claudeMd(a, { mode: "jira", project: "GF" });
      await expectRefusal(a, b, ["jira", "--project", "GF", "--shared", "Bad_Tag"], FLOOR, "Bad_Tag");
    });
  }, 30_000);

  test("sequencing trap: a running manifest below FIRST_GATED_DPT_VERSION refuses with the floor class", async () => {
    await withRoots(async ({ a, b }) => {
      claudeMd(a, { mode: "jira", project: "GF" });
      await expectRefusal(
        a,
        b,
        ["jira", "--project", "GF", "--shared", TAG],
        "2.86.0",
        "below FIRST_GATED_DPT_VERSION",
      );
    });
  }, 30_000);

  test("an injected read-back refusal restores the original bytes and refuses with the reader's text", async () => {
    const scratch = mkdtempSync(join(tmpdir(), "ste603-readback-"));
    try {
      const manifest = manifestDir(scratch, FLOOR);
      const fixtureRoot = join(scratch, "project");
      claudeMd(fixtureRoot, { mode: "jira", project: "GF" });
      const bindingPath = join(sharedSrc, "workspace_binding.ts");
      const injected = [
        `import { expect, mock, test } from "bun:test";`,
        `import { readFileSync } from "node:fs";`,
        `const real = await import(${JSON.stringify(bindingPath)});`,
        `const target = ${JSON.stringify(join(fixtureRoot, "CLAUDE.md"))};`,
        `const original = readFileSync(target, "utf-8");`,
        `mock.module(${JSON.stringify(bindingPath)}, () => ({`,
        `  ...real,`,
        `  readWorkspaceBinding: (p: string, k: "jira" | "linear") => {`,
        `    if (readFileSync(p, "utf-8") !== original) {`,
        `      throw new real.WorkspaceBindingError(`,
        `        "WorkspaceBindingError: INJECTED-READBACK-REFUSAL",`,
        `        "injected remedy",`,
        `        "injected context",`,
        `      );`,
        `    }`,
        `    return real.readWorkspaceBinding(p, k);`,
        `  },`,
        `}));`,
        `test("read-back refusal", async () => {`,
        `  const w = await import(${JSON.stringify(writerPath)});`,
        `  let caught: unknown = null;`,
        `  try {`,
        `    await w.writeTrackerSubsection(target, "jira", { project: "GF", shared: { repoTag: "${TAG}" } });`,
        `  } catch (e) {`,
        `    caught = e;`,
        `  }`,
        `  expect(caught).toBeInstanceOf(Error);`,
        `  const msg = (caught as Error).message;`,
        `  expect(msg).toContain("INJECTED-READBACK-REFUSAL");`,
        `  const lines = msg.split("\\n");`,
        `  expect(lines.length).toBe(3);`,
        `  expect(lines[1]!.startsWith("Remedy:")).toBe(true);`,
        `  expect(lines[2]!.startsWith("Context:")).toBe(true);`,
        `  expect(readFileSync(target, "utf-8")).toBe(original);`,
        `  console.log("READBACK-LEG-OK");`,
        `});`,
        ``,
      ].join("\n");
      const testFile = join(scratch, "readback.test.ts");
      writeFileSync(testFile, injected);
      const r = await spawn(["bun", "test", testFile], { CLAUDE_PLUGIN_ROOT: manifest });
      const out = r.stdout + r.stderr;
      expect(r.code, out).toBe(0);
      expect(out).toContain("READBACK-LEG-OK");
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }, 60_000);
});

// ============================================================ AC-STE-603.4

describe("AC-STE-603.4 — --unshare removes exactly the tag key, the floor and the paragraph", () => {
  test("reader answers shared:false, default_labels unchanged, stdout says so", async () => {
    await withRoots(async ({ a, b }) => {
      const path = join(a, "CLAUDE.md");
      writeFileSync(path, preservationClaudeMd());
      expect((await runWriter(a, ["jira", "--project", "GF", "--shared", TAG], b, FLOOR)).code).toBe(0);
      const declared = readFileSync(path, "utf-8");
      const labelsLine = declared.split("\n").find((l) => l.startsWith("default_labels:"))!;

      const r = await runWriter(a, ["jira", "--project", "GF", "--unshare"], b, FLOOR);
      expect(r.code, r.stderr).toBe(0);
      expect(r.stdout).toContain("default_labels");
      const after = readFileSync(path, "utf-8");

      expect(after).not.toMatch(/^repo_tag:/m);
      expect(after).not.toMatch(/^min_dpt_version:/m);
      expect(after).not.toContain(MARKER);
      expect(after.split("\n").some((l) => l.startsWith(">"))).toBe(false);
      expect(after.split("\n").find((l) => l.startsWith("default_labels:"))).toBe(labelsLine);

      const normalize = (s: string): string =>
        s
          .split("\n")
          .filter((l) => !/^(repo_tag|min_dpt_version)\s*:/.test(l) && !l.startsWith(">"))
          .join("\n")
          .replace(/\n{3,}/g, "\n\n");
      expect(normalize(after)).toBe(normalize(declared));

      const got = readWorkspaceBinding(path, "jira");
      expect(got.shared).toBe(false);
      expect(got.repoTag).toBeUndefined();
      expect(got.minDptVersion).toBeUndefined();
      expect(got.defaultLabels).toEqual(["backend", "urgent", TAG]);
    });
  }, 30_000);
});

// ============================================================ AC-STE-603.5

describe("AC-STE-603.5 — the stop paragraph", () => {
  const input: RenderInput = { adapter: "jira", project: "GF", repoTag: TAG, minDptVersion: FLOOR };

  test("the render is deterministic and opens with the fixed marker", async () => {
    const one = await render(input);
    const two = await render({ ...input });
    expect(one).toBe(two);
    expect(one.split("\n")[0]).toBe(MARKER);
  });

  test("names the project, tag, floor, container kind, plugin and every forbidden verb", async () => {
    const text = await render(input);
    expect(text).toContain("GF");
    expect(text).toContain(TAG);
    expect(text).toContain(FLOOR);
    expect(text).toMatch(/Jira/);
    expect(text).toContain("dev-process-toolkit");
    for (const verb of ["create", "edit", "transition", "comment", "link", "import"]) {
      expect(text.toLowerCase(), `verb "${verb}" missing`).toContain(verb);
    }
    expect(text).toMatch(/upgrade/i);
    expect(text).toMatch(/by hand/i);
    expect(text).toMatch(/every other repositor/i);
    expect(text).toMatch(/in code/i);
    const linear = await render({ ...input, adapter: "linear", project: "DPT" });
    expect(linear).toMatch(/Linear/);
    expect(linear).toContain("DPT");
  });

  test("every line is a blockquote line, so none matches the reader's key pattern", async () => {
    const lines = (await render(input)).trimEnd().split("\n");
    for (const l of lines) {
      expect(l.startsWith(">"), `non-blockquote line: ${l}`).toBe(true);
      expect(/^([a-z_][a-z0-9_]*)\s*:/.test(l)).toBe(false);
    }
  });

  test("inserting it changes neither the reader's answer nor probe #21's", async () => {
    const para = await render(input);
    await withRoots(async ({ a, b }) => {
      const opts = { mode: "jira" as const, project: "GF", defaultLabels: [TAG], repoTag: TAG, minDptVersion: FLOOR };
      claudeMd(a, opts);
      claudeMd(b, { ...opts, paragraph: para });
      expect(readWorkspaceBinding(join(b, "CLAUDE.md"), "jira")).toEqual(
        readWorkspaceBinding(join(a, "CLAUDE.md"), "jira"),
      );
      expect((await runTaskTrackingCanonicalKeysProbe(b)).violations).toEqual([]);
    });
  });

  test("control: prefixes stripped plus a `min_dpt_version: 1.0.0` line → the duplicated-key refusal", async () => {
    const para = await render(input);
    const stripped = para
      .trimEnd()
      .split("\n")
      .map((l) => l.replace(/^> ?/, ""))
      .concat("min_dpt_version: 1.0.0")
      .join("\n");
    await withRoots(async ({ a }) => {
      claudeMd(a, {
        mode: "jira",
        project: "GF",
        defaultLabels: [TAG],
        repoTag: TAG,
        minDptVersion: FLOOR,
        paragraph: stripped,
      });
      let caught: unknown = null;
      try {
        readWorkspaceBinding(join(a, "CLAUDE.md"), "jira");
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).toMatch(/`min_dpt_version` is written \d+ times/);
    });
  });
});

// ============================================================ AC-STE-603.7

describe("AC-STE-603.7 — the probe and the writer read only the tree they are given", () => {
  test("two roots, one declared and one not, are graded independently", async () => {
    await withRoots(async ({ a, b }) => {
      claudeMd(a, { mode: "jira", project: "GF" });
      claudeMd(b, { mode: "jira", project: "GF" });
      const bBefore = readFileSync(join(b, "CLAUDE.md"));
      const scratch = mkdtempSync(join(tmpdir(), "ste603-relocated-"));
      try {
        const r = await runWriter(a, ["jira", "--project", "GF", "--shared", TAG], scratch, FLOOR);
        expect(r.code, r.stderr).toBe(0);
        expect(readFileSync(join(b, "CLAUDE.md")).equals(bBefore)).toBe(true);
        expect(readWorkspaceBinding(join(a, "CLAUDE.md"), "jira").shared).toBe(true);
        expect(readWorkspaceBinding(join(b, "CLAUDE.md"), "jira").shared).toBe(false);
        await withRunning(scratch, FLOOR, async () => {
          expect((await runTaskTrackingWorkspaceBindingPresentProbe(a)).violations).toEqual([]);
          expect((await runTaskTrackingWorkspaceBindingPresentProbe(b)).violations).toEqual([]);
        });
      } finally {
        rmSync(scratch, { recursive: true, force: true });
      }
    });
  }, 30_000);

  test("a declaration committed on one branch is invisible to a checkout of another branch", async () => {
    await withRoots(async ({ a, b }) => {
      const git = (...args: string[]): string =>
        execFileSync("git", ["-C", a, ...args], {
          encoding: "utf-8",
          env: {
            ...process.env,
            GIT_AUTHOR_NAME: "t",
            GIT_AUTHOR_EMAIL: "t@example.test",
            GIT_COMMITTER_NAME: "t",
            GIT_COMMITTER_EMAIL: "t@example.test",
          },
        });
      claudeMd(a, { mode: "jira", project: "GF" });
      git("init", "-q", "-b", "main");
      git("add", "CLAUDE.md");
      git("commit", "-q", "-m", "undeclared");
      git("checkout", "-q", "-b", "declared");
      const r = await runWriter(a, ["jira", "--project", "GF", "--shared", TAG], b, FLOOR);
      expect(r.code, r.stderr).toBe(0);
      git("commit", "-q", "-am", "declared");
      expect(readWorkspaceBinding(join(a, "CLAUDE.md"), "jira").shared).toBe(true);

      git("checkout", "-q", "main");
      const content = readFileSync(join(a, "CLAUDE.md"), "utf-8");
      expect(content).not.toContain(MARKER);
      expect(readWorkspaceBinding(join(a, "CLAUDE.md"), "jira").shared).toBe(false);
      await withRunning(b, FLOOR, async () => {
        expect((await runTaskTrackingWorkspaceBindingPresentProbe(a)).violations).toEqual([]);
      });
    });
  }, 30_000);
});

// ============================================================ AC-STE-603.8

describe("AC-STE-603.8 — the setup wiring in docs/setup-reference.md", () => {
  const doc = readFileSync(join(pluginRoot, "docs", "setup-reference.md"), "utf-8");

  function region(startNeedle: string, endNeedle: string): string {
    const start = doc.indexOf(startNeedle);
    expect(start, `no "${startNeedle}" in setup-reference.md`).toBeGreaterThanOrEqual(0);
    const end = doc.indexOf(endNeedle, start + startNeedle.length);
    expect(end, `no "${endNeedle}" after "${startNeedle}"`).toBeGreaterThan(start);
    return doc.slice(start, end);
  }

  test("step 7b.6 orders the writer through bun run and asks the shared question", () => {
    const step = region("6. **Workspace binding.**", "\n### ");
    expect(step).toMatch(/bun run [^\n`]*adapters\/_shared\/src\/setup\/tracker_binding_write\.ts/);
    expect(step).toContain("Does any other repository create tickets in this same project?");
    expect(step).toContain("AskUserQuestion");
    expect(step).toMatch(/basename/i);
    expect(step).toContain("--shared-tracker=");
    expect(step).toMatch(/non-tty|isTTY/i);
    expect(step).toContain('step:7b (shared_tracker) value:"none" reason:"default applied"');
  });

  test("the shared question names both readiness preconditions", () => {
    const step = region("6. **Workspace binding.**", "\n### ");
    expect(step).toContain("repo_tag");
    expect(step).toContain("probe #25");
    expect(step).toContain("min_dpt_version");
    expect(step).toMatch(/every participating repositor/i);
    expect(step).toMatch(/release/i);
  });

  test("§ 0c names the writer, probe #25 and the repoint command's resume and declare bypass", () => {
    const zeroC = region("### § 0c", "### Repoint preconditions");
    expect(zeroC).toContain("tracker_binding_write.ts");
    expect(zeroC).toContain("probe #25");
    expect(zeroC).toMatch(/repoint command/i);
    expect(zeroC).toMatch(/bypass/i);
    expect(zeroC).toMatch(/resume/i);
    expect(zeroC).toMatch(/declar/i);
    expect(zeroC).toMatch(/shared question/i);
  });

  test("repoint precondition #2 is probe #25 green in every participating repository", () => {
    const pre = region("### Repoint preconditions", "\n## ");
    const two = pre.split("\n").find((l) => l.startsWith("2. "));
    expect(two, "no precondition 2").toBeDefined();
    expect(two!).toContain("probe #25");
    expect(two!).toMatch(/every participating repositor/i);
  });
});

// ============================================================ AC-STE-603.9

describe("AC-STE-603.9 — old clients stay green on a declared file carrying the paragraph", () => {
  test("pre-change probes #21 and #25 report zero violations", async () => {
    const para = await render({ adapter: "jira", project: "GF", repoTag: TAG, minDptVersion: FLOOR });
    const scratch = mkdtempSync(join(tmpdir(), "ste603-oldclient-"));
    try {
      for (const file of [
        "workspace_binding.ts",
        "task_tracking_canonical_keys.ts",
        "task_tracking_workspace_binding_present.ts",
      ]) {
        const src = execFileSync(
          "git",
          ["-C", repoRoot, "show", `${PRE_CHANGE}:plugins/dev-process-toolkit/adapters/_shared/src/${file}`],
          { encoding: "utf-8" },
        );
        writeFileSync(join(scratch, file), src);
      }
      const old21 = await import(join(scratch, "task_tracking_canonical_keys.ts"));
      const old25 = await import(join(scratch, "task_tracking_workspace_binding_present.ts"));
      await withRoots(async ({ a }) => {
        claudeMd(a, {
          mode: "jira",
          project: "GF",
          defaultLabels: [TAG],
          repoTag: TAG,
          minDptVersion: FLOOR,
          paragraph: para,
        });
        expect((await old21.runTaskTrackingCanonicalKeysProbe(a)).violations).toEqual([]);
        expect((await old25.runTaskTrackingWorkspaceBindingPresentProbe(a)).violations).toEqual([]);
      });
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});

// ============================================================ AC-STE-603.10

describe("AC-STE-603.10 — budgets and the reachability pin", () => {
  const skills = join(pluginRoot, "skills");
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const abs = join(dir, n);
      return statSync(abs).isDirectory() ? walk(abs) : n.endsWith(".md") ? [abs] : [];
    });
  const steTokens = (s: string): number => (s.match(/STE-\d+/g) ?? []).length;

  test("gate-check SKILL.md: 356 split-lines, 87 STE tokens, row 25 on line 80 running the front door", () => {
    const text = readFileSync(join(skills, "gate-check", "SKILL.md"), "utf-8");
    const lines = text.split("\n");
    expect(lines.length).toBe(356);
    expect(steTokens(text)).toBe(87);
    const row = lines[79]!;
    expect(row.startsWith("25. **`task-tracking-workspace-binding-present`**"), row.slice(0, 80)).toBe(true);
    expect(row).toMatch(/bun run [^\n`]*task_tracking_workspace_binding_present\.ts/);
    expect(row).toMatch(/paragraph/i);
    expect(row).toMatch(/min_dpt_version|floor/);
  });

  test("setup SKILL.md: 358 split-lines, 17 STE tokens", () => {
    const text = readFileSync(join(skills, "setup", "SKILL.md"), "utf-8");
    expect(text.split("\n").length).toBe(358);
    expect(steTokens(text)).toBe(17);
  });

  test("skills/**/*.md total 245 STE tokens and no skill file carries this FR's token", () => {
    const files = walk(skills);
    const total = files.reduce((n, f) => n + steTokens(readFileSync(f, "utf-8")), 0);
    expect(total).toBe(245);
    expect(files.filter((f) => readFileSync(f, "utf-8").includes("STE-603"))).toEqual([]);
  });

  test("probe #25's module carries an entry point and is reachable", () => {
    const graph = buildModuleGraph(repoRoot);
    const rel = "adapters/_shared/src/task_tracking_workspace_binding_present.ts";
    expect(graph.hasEntryPoint(rel)).toBe(true);
    expect(graph.reachable(rel)).toBe(true);
  });

  // PIN MOVE (M_947c79/STE-605): later FRs prepend their own moves, so this
  // FR's entry is FOUND by its rationale; it must still sit directly on the
  // STE-602 entry at 125, and the head must equal the awaited measurement.
  test("the ledger records one STE-603 lowering from 125, and the head equals the awaited measurement", async () => {
    const mine = ORDERED_UNREACHABLE_PIN_LEDGER.filter((m) => m.rationale.includes("M_947c79/STE-603"));
    expect(mine.length, "exactly one ledger entry is STE-603's").toBe(1);
    const at = ORDERED_UNREACHABLE_PIN_LEDGER.indexOf(mine[0]!);
    expect(mine[0]!.value, "the pin may only fall — a raise is forbidden").toBeLessThan(125);
    const previous = ORDERED_UNREACHABLE_PIN_LEDGER[at + 1]!;
    expect(previous.value).toBe(125);
    expect(previous.rationale).toContain("STE-602");
    const head = ORDERED_UNREACHABLE_PIN_LEDGER[0]!;
    const report = await runModuleReachabilityProbe(repoRoot);
    expect(
      report.orderedUnreachable,
      `measured ${report.orderedUnreachable} against ledger head ${head.value}`,
    ).toBe(head.value);
    expect(report.ok).toBe(true);
  }, 120_000);

  test("probe #25's front door answers when spawned: green exits 0, a violation exits non-zero naming it", async () => {
    await withRoots(async ({ a, b }) => {
      const env = { CLAUDE_PLUGIN_ROOT: manifestDir(b, FLOOR) };
      claudeMd(a, { mode: "jira", project: "GF" });
      const green = await spawn(["bun", "run", probe25Path, a], env);
      expect(green.code, green.stdout + green.stderr).toBe(0);

      writeFileSync(join(a, "CLAUDE.md"), "# P\n\n## Task Tracking\n\nmode: jira\n");
      const red = await spawn(["bun", "run", probe25Path, a], env);
      expect(red.code, red.stdout + red.stderr).not.toBe(0);
      expect(red.stdout + red.stderr).toContain("### Jira");
    });
  }, 30_000);
});

// ============================================================ AC-STE-603.11

describe("AC-STE-603.11 — the product contract", () => {
  test("requirements.md no longer lists shared tracker binding as out of scope", () => {
    const req = readFileSync(join(repoRoot, "specs", "requirements.md"), "utf-8");
    expect(req).not.toContain("one repo, one tracker project, one mode; out for this release");
    expect(req).toMatch(/shared tracker container/i);
    expect(req).toContain("Multi-repo spec federation — `specs/` is per-repo");
  });

  test("probe #9's root hygiene stays green", () => {
    const report = runRootHygiene(
      join(repoRoot, "specs"),
      join(pluginRoot, ".claude-plugin", "plugin.json"),
      join(repoRoot, "CHANGELOG.md"),
    );
    expect(report.leakage).toEqual([]);
    expect(report.freshness).toEqual([]);
  });
});

// ============================================================ Stage C hardening
// Found by the /tdd AUDIT of STE-603 and fixed in its hardening pass.

describe("STE-603 hardening — the writer heals, and never guesses a floor", () => {
  test("a hand-duplicated stop paragraph is healed by a re-run: exactly one copy remains and probe #25 is green", async () => {
    await withRoots(async ({ a, b }) => {
      const path = join(a, "CLAUDE.md");
      writeFileSync(path, preservationClaudeMd());
      expect((await runWriter(a, ["jira", "--project", "GF", "--shared", TAG], b, FLOOR)).code).toBe(0);
      const declared = readFileSync(path, "utf-8");
      const para = await render({ adapter: "jira", project: "GF", repoTag: TAG, minDptVersion: FLOOR });
      // A hand edit pastes the paragraph a second time, adjacent to the first.
      writeFileSync(path, declared.replace(para, `${para}\n${para}`));
      expect(readFileSync(path, "utf-8").split(MARKER).length - 1).toBe(2);

      const r = await runWriter(a, ["jira", "--project", "GF", "--shared", TAG], b, FLOOR);
      expect(r.code, r.stderr).toBe(0);
      expect(readFileSync(path, "utf-8").split(MARKER).length - 1).toBe(1);
      expect(readFileSync(path, "utf-8")).toBe(declared);
      await withRunning(b, FLOOR, async () => {
        expect((await runTaskTrackingWorkspaceBindingPresentProbe(a)).violations).toEqual([]);
      });
    });
  });

  test("an existing floor that is not strict X.Y.Z refuses rather than being replaced (the file is byte-identical)", async () => {
    await withRoots(async ({ a, b }) => {
      const path = join(a, "CLAUDE.md");
      writeFileSync(path, preservationClaudeMd());
      expect((await runWriter(a, ["jira", "--project", "GF", "--shared", TAG], b, FLOOR)).code).toBe(0);
      const bad = readFileSync(path, "utf-8").replace(`min_dpt_version: ${FLOOR}`, "min_dpt_version: v9.9");
      writeFileSync(path, bad);

      const r = await runWriter(a, ["jira", "--project", "GF", "--shared", TAG], b, HIGHER);
      expect(r.code).toBe(1);
      expect(r.stdout).toBe("");
      expect(r.stderr).toContain('min_dpt_version "v9.9"');
      expect(r.stderr).toMatch(/\nRemedy: /);
      expect(r.stderr).toMatch(/\nContext: /);
      expect(readFileSync(path, "utf-8")).toBe(bad);
    });
  });
});

describe("STE-603 hardening — boundary refusals from the Pass 2 review", () => {
  for (const [name, encode] of [
    ["CRLF", (t: string): string => t.replace(/\n/g, "\r\n")],
    ["BOM", (t: string): string => `﻿${t}`],
  ] as const) {
    test(`a ${name} CLAUDE.md refuses by name and is left byte-identical`, async () => {
      await withRoots(async ({ a, b }) => {
        const path = join(a, "CLAUDE.md");
        const bytes = encode(preservationClaudeMd());
        writeFileSync(path, bytes);
        const r = await runWriter(a, ["jira", "--project", "GF", "--shared", TAG], b, FLOOR);
        expect(r.code).toBe(1);
        expect(r.stdout).toBe("");
        expectThreeLine(r.stderr);
        expect(r.stderr).toMatch(/byte-order mark or CRLF/);
        expect(readFileSync(path, "utf-8")).toBe(bytes);
      });
    });
  }

  test("an empty --team refuses and leaves the file byte-identical (control: a real team writes)", async () => {
    await withRoots(async ({ a, b }) => {
      const path = join(a, "CLAUDE.md");
      writeFileSync(path, preservationClaudeMd());
      const before = readFileSync(path, "utf-8");
      const r = await runWriter(a, ["jira", "--project", "GF", "--team", ""], b, FLOOR);
      expect(r.code).toBe(1);
      expect(r.stdout).toBe("");
      expectThreeLine(r.stderr);
      expect(r.stderr).toContain("--team was given an empty value");
      expect(readFileSync(path, "utf-8")).toBe(before);
      const ok = await runWriter(a, ["jira", "--project", "GF", "--team", "STE"], b, FLOOR);
      expect(ok.code, ok.stderr).toBe(0);
      expect(readFileSync(path, "utf-8")).toMatch(/^team: STE$/m);
    });
  });
});
