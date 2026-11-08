// STE-722 (M_d1b4b7) shared fixture helper — the close-out retro offer.
//
// Leading underscore: a helper module, never collected as a suite.
//
// Every tree is built in a temp dir outside the repo. Ids are synthetic:
// FR `SYN-900` bound to milestone `M_a1b2c3`, sessions from `sid(n)`.
//
// Literals marked "v3.0.0" were measured on 2026-11-06 by running the modules
// of the v3.0.0 merge commit 9dab5086 (plugin tree identical to 6c62b32c),
// extracted with `git archive`, on twins of these fixtures. They are pasted
// here as literals and never re-read from a ref at test time.

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { commitRows, sid, tokenRow, writeCaptureRows, writeTokenLedger } from "./_m_d1b4b7_retro_fixture";

export const PLUGIN = resolve(import.meta.dir, "..");
export const REPO_ROOT = resolve(PLUGIN, "..", "..");
export const SRC = join(PLUGIN, "adapters", "_shared", "src");
export const RETRO_OFFER = join(SRC, "retro_offer.ts");
export const GATE_CAPTURE = join(SRC, "gate_capture.ts");
export const DELIVER_DECISION = join(SRC, "deliver_decision.ts");
export const UPGRADE_OFFER = join(SRC, "upgrade_offer.ts");
export const PROJECT_SETTINGS = join(SRC, "project_settings.ts");
export const IMPLEMENT_SKILL = join(PLUGIN, "skills", "implement", "SKILL.md");
export const DELIVER_SKILL = join(PLUGIN, "skills", "deliver", "SKILL.md");
export const IMPLEMENT_REF = join(PLUGIN, "docs", "implement-reference.md");
export const DELIVER_REF = join(PLUGIN, "docs", "deliver-reference.md");

/** The v3.0.0 merge commit (M_94e6f7). */
export const V300_SHA = "9dab5086";

export const read = (p: string): string => readFileSync(p, "utf-8");

// ------------------------------------------------------------------ ids

export const FR_ID = "SYN-900";
export const OTHER_FR_ID = "SYN-901";
export const MILESTONE = "M_a1b2c3";
export const RETRO_ON = "retro: on";
export const UPGRADE_ON = "upgrade_offer: on";
export const IMPLEMENT_RETRO = "implement_retro_offer";
export const DELIVER_RETRO = "deliver_close_retro_offer";
export const IMPLEMENT_UPGRADE = "implement_upgrade_offer";
export const DELIVER_UPGRADE = "deliver_close_upgrade_offer";
export const IMPLEMENT_ANCHOR = "Run a retrospective for <scope>? [y/N]";
export const DELIVER_ANCHOR = "Run a retrospective for the delivered milestones? [y/N]";
export const UPGRADE_QUESTION = "Apply the pending toolkit upgrades now? [y/N]";
export const CLOSE_OUT_HEADING = "## Close-out — offers after the last milestone";

// ------------------------------------------------------------- v3.0.0 literals

/** gate_capture.ts stdout on the two-file green bun fixture, v3.0.0 (switch off). */
export const GATE_CAPTURE_V300 =
  "gate_capture: pass 2, fail 0, skip 0\n" + "gate_capture: 0 skip(s) named by `bun test` (bun)\n";

/** deliver_decision.ts stdout for `M_a1b2c3` on a tree rooted at `syn-deliver`, v3.0.0 (eight fields). */
export const DELIVER_DECISION_V300 = [
  "argument_kind: milestone_identity",
  "target_repo_route: invoking",
  "resume_state: ready_to_implement",
  "chain:",
  "  1. /implement M_a1b2c3 (worker)",
  "  2. /ship-milestone M_a1b2c3 (worker)",
  "  3. /pr M_a1b2c3 (worker)",
  "merge_policy: offer -> offer",
  "gate_class: content",
  "gate_relays: yes",
  "remote_control: syn-deliver-m_a1b2c3",
  "",
].join("\n");

// ------------------------------------------------------------------ temp trees

const TEMPS: string[] = [];

export function tempDir(label: string): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), `ste722-${label}-`)));
  TEMPS.push(d);
  return d;
}

export function cleanupTemps(): void {
  for (const d of TEMPS.splice(0)) rmSync(d, { recursive: true, force: true });
}

export function writeTree(root: string, files: Record<string, string>): string {
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  return root;
}

export const SETTINGS_HEAD = 'schema_version: 1\nmin_dpt_version: "3.0.0"\n';
export const ORCH_YAML = "orchestration:\n  default_effort: high\n  merge_policy: offer\n";
export const LEGACY_ORCH_CLAUDE_MD = "# Fixture\n\n## Orchestration\n\ndefault_effort: high\nmerge_policy: offer\n";

export type Tri = "absent" | "false" | "true";

export interface SettingsShape {
  /** `retro.enabled`: absent, false or true. */
  retro?: Tri;
  /** `close_out.upgrade_offer.enabled`: absent, false or true. */
  upgrade?: Tri;
  /** `tracking.token_stats.enabled`; other tracking switches stay false. Absent writes no tracking section. */
  tokenStats?: boolean;
  /** Write the orchestration section (default true). */
  orchestration?: boolean;
}

export function settingsYaml(s: SettingsShape = {}): string {
  let out = SETTINGS_HEAD;
  if (s.orchestration !== false) out += ORCH_YAML;
  if (s.tokenStats !== undefined) {
    out +=
      "tracking:\n" +
      `  token_stats:\n    enabled: ${s.tokenStats}\n` +
      "  gate_outcomes:\n    enabled: false\n" +
      "  tool_calls:\n    enabled: false\n";
  }
  if (s.upgrade !== undefined && s.upgrade !== "absent") out += `close_out:\n  upgrade_offer:\n    enabled: ${s.upgrade}\n`;
  if (s.retro !== undefined && s.retro !== "absent") out += `retro:\n  enabled: ${s.retro}\n`;
  return out;
}

const PLAN = [
  "---",
  `milestone: ${MILESTONE}`,
  "status: active",
  "shipped_in: null",
  "---",
  "",
  `# ${MILESTONE} — fixture milestone`,
  "",
  "## Tasks",
  "",
  "- [ ] Build the thing",
  "",
].join("\n");

const FR = [
  "---",
  "title: Fixture FR",
  `milestone: ${MILESTONE}`,
  "status: active",
  "archived_at: null",
  "tracker:",
  `  linear: ${FR_ID}`,
  "created_at: 2026-08-25T00:00:00Z",
  "changelog_category: Added",
  "---",
  "",
  "# Fixture FR",
  "",
  "## Acceptance Criteria",
  "",
  `- AC-${FR_ID}.1: it exists.`,
  "",
].join("\n");

export type Ledger = "none" | "tripped" | "clear";

/**
 * One tree every front door of this FR can run on: a two-file green bun
 * project (gate_capture.ts), the `M_a1b2c3` plan and its FR `SYN-900`
 * (deliver_decision.ts, retro scopes), rooted at a directory named
 * `syn-deliver`. `settings` is the specs/settings.yaml body or null.
 *
 * `ledger`:
 *   tripped — session sid(1) claimed by SYN-900: 6000 output tokens over a
 *             5-line commit, so `cost_per_changed_line` reads 1200 > 500;
 *             no timeline file, so the three timeline rules are skipped.
 *   clear   — the same with 100 output tokens (20 tokens/line, clear).
 */
export function offerTree(
  label: string,
  settings: string | null,
  o: { ledger?: Ledger; claudeMd?: string } = {},
): string {
  const root = join(tempDir(label), "syn-deliver");
  const files: Record<string, string> = {
    "package.json": `${JSON.stringify({ name: "syn-gate", private: true })}\n`,
    "tests/a.test.ts": 'import { expect, test } from "bun:test";\n\ntest("a one", () => { expect(1 + 1).toBe(2); });\n',
    "tests/b.test.ts": 'import { expect, test } from "bun:test";\n\ntest("b one", () => { expect(1 + 1).toBe(2); });\n',
    [`specs/plan/${MILESTONE}.md`]: PLAN,
    [`specs/frs/${FR_ID}.md`]: FR,
    "CLAUDE.md": o.claudeMd ?? "# Fixture\n",
  };
  if (settings !== null) files["specs/settings.yaml"] = settings;
  writeTree(root, files);
  writeLedger(root, o.ledger ?? "none");
  return root;
}

export function writeLedger(root: string, ledger: Ledger): void {
  if (ledger === "none") return;
  writeTokenLedger(root, [tokenRow(sid(1), ledger === "tripped" ? 6000 : 100, { claimed_by: FR_ID })]);
  writeCaptureRows(root, sid(1), commitRows(3, 2));
}

/** The one rule= line the tripped ledger yields. */
export const TRIPPED_RULE_LINE = "rule=cost_per_changed_line 1200 parent-visible tokens/line > 500";

// ------------------------------------------------------------------ spawning

export interface Run {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

export function spawnModule(file: string, args: readonly string[], cwd: string): Run {
  const p = spawnSync(process.execPath, ["run", file, ...args], {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      NO_COLOR: "1",
      CLAUDE_CONFIG_DIR: join(tempDir("cfg"), "empty"),
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
    },
    timeout: 120_000,
  });
  return { stdout: p.stdout ?? "", stderr: p.stderr ?? "", code: p.status ?? -1 };
}

export const describeRun = (r: Run): string => `exit ${r.code}\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`;

export const runRetroOffer = (root: string, scope: string, file = RETRO_OFFER): Run => spawnModule(file, [root, scope], root);
export const runGateCapture = (root: string, file = GATE_CAPTURE): Run => spawnModule(file, [root], root);
export const runDeliverDecision = (root: string, file = DELIVER_DECISION): Run => spawnModule(file, [MILESTONE, root], root);
export const runUpgradeOffer = (root: string, file = UPGRADE_OFFER): Run => spawnModule(file, [root], root);

/**
 * The call's trailing switch lines: the run of `retro: on` / `upgrade_offer: on`
 * lines at the end of its stdout, in printed order.
 */
export function trailingSwitchLines(stdout: string): string[] {
  const lines = stdout.replace(/\n+$/, "").split("\n");
  const out: string[] = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i] !== RETRO_ON && lines[i] !== UPGRADE_ON) break;
    out.unshift(lines[i]!);
  }
  return out;
}

/** Sentence splitter used by the mention needles (newline or sentence end). */
export function sentencesOf(text: string): string[] {
  return text.split(/\n|(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
}

/** A copy of the plugin's runnable tree (adapters, templates, manifest) under a temp dir. */
export function copyPluginTree(label: string): string {
  const dst = join(tempDir(label), "plugin");
  mkdirSync(dst, { recursive: true });
  for (const part of ["adapters", "templates", ".claude-plugin"]) {
    const p = spawnSync("cp", ["-R", join(PLUGIN, part), join(dst, part)], { encoding: "utf-8" });
    if (p.status !== 0) throw new Error(`cp ${part}: ${p.stderr}`);
  }
  return dst;
}

/** `git show <V300_SHA>:<repoRel>` — used only where an AC grades against the v3.0.0 file. */
export function atV300(repoRel: string): string {
  const p = spawnSync("git", ["show", `${V300_SHA}:${repoRel}`], { cwd: REPO_ROOT, encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 });
  if (p.status !== 0) throw new Error(`git show ${V300_SHA}:${repoRel}: ${p.stderr}`);
  return p.stdout ?? "";
}
