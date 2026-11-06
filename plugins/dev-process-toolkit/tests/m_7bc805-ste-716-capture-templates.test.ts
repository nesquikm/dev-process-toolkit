// STE-716 (M_7bc805) AC.23 — a template never registers capture in the target.
//
// setup-template's copy step (adapters/_shared/src/setup/template_copy.ts,
// `planTemplateCopy`) runs `dropCaptureEntries` (capture_registration.ts) over
// any `.claude/settings.json` or `.claude/settings.local.json` it lands, in both
// modes, and names each dropped entry in the preview and report.
//
// All names, paths and values are synthetic.

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { CR, PLUGIN_ROOT } from "./_m_7bc805_capture_fixture";

const ROOTS: string[] = [];
afterAll(() => {
  for (const r of ROOTS) rmSync(r, { recursive: true, force: true });
});

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "ste716-tpl-"));
  ROOTS.push(root);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  return root;
}

const NEEDLE = "templates/hooks/process/tool-call-capture.sh";
const CAPTURE_CMD = `exec '/opt/synthetic/plugin/${NEEDLE}' '/opt/synthetic/config/plugins/installed_plugins.json'; exit 0`;
const UNRELATED = { matcher: "Edit", hooks: [{ type: "command", command: "echo synthetic-unrelated-hook" }] };
const CAPTURE_GROUP = { matcher: "Bash|Skill", hooks: [{ type: "command", command: CAPTURE_CMD, timeout: 2 }] };
const WITH_CAPTURE = { env: { SYNTHETIC: "1" }, hooks: { PreToolUse: [UNRELATED, CAPTURE_GROUP], PostToolUse: [CAPTURE_GROUP] } };

const json = (o: unknown): string => `${JSON.stringify(o, null, 2)}\n`;

async function planner(): Promise<(tpl: string, target: string, opts: unknown) => { files: Record<string, string>; dropped: string[]; report: string }> {
  const m = (await import("../adapters/_shared/src/setup/template_copy")) as Record<string, any>;
  return m.planTemplateCopy;
}

function hasCapture(text: string): boolean {
  return text.includes(NEEDLE);
}

describe("AC-STE-716.23 templates drop capture entries", () => {
  test("dropCaptureEntries removes every capture entry and the groups that leaves empty, nothing else", async () => {
    const m = await CR();
    const out = m.dropCaptureEntries(structuredClone(WITH_CAPTURE));
    const parsed = typeof out === "string" ? JSON.parse(out) : out;
    expect(parsed.env).toEqual({ SYNTHETIC: "1" });
    expect(parsed.hooks.PreToolUse).toEqual([UNRELATED]);
    expect(parsed.hooks.PostToolUse === undefined || (Array.isArray(parsed.hooks.PostToolUse) && parsed.hooks.PostToolUse.length === 0)).toBe(true);
  });

  test("whole-project: a template's .claude/settings.local.json lands with the unrelated hook and no capture entry; preview and report name the drop", async () => {
    const tpl = tree({
      "CLAUDE.md": "# Template\n",
      "src/index.ts": "export const x = 1;\n",
      ".claude/settings.local.json": json(WITH_CAPTURE),
    });
    const target = tree({ "README.md": "# Target\n" });
    const plan = (await planner())(tpl, target, { mode: "whole-project" });
    const landed = plan.files[".claude/settings.local.json"];
    expect(landed).toBeDefined();
    expect(hasCapture(landed!)).toBe(false);
    const parsed = JSON.parse(landed!);
    expect(parsed.hooks.PreToolUse).toEqual([UNRELATED]);
    expect(parsed.env).toEqual({ SYNTHETIC: "1" });
    expect(plan.report).toContain(".claude/settings.local.json");
    expect(plan.report).toContain("tool-call-capture");
    expect(plan.dropped.some((d) => d.includes(".claude/settings.local.json"))).toBe(true);
  });

  test("per-category: a selected .claude/settings.json holding a capture entry drops it the same way", async () => {
    const tpl = tree({
      "CLAUDE.md": "# Template\n",
      ".claude/settings.json": json({ permissions: { allow: ["Bash(bun *)"] }, hooks: { PreToolUse: [CAPTURE_GROUP] } }),
    });
    const target = tree({});
    const plan = (await planner())(tpl, target, { mode: "per-category", selection: [".claude/settings.json"] });
    const landed = plan.files[".claude/settings.json"];
    expect(landed).toBeDefined();
    expect(hasCapture(landed!)).toBe(false);
    expect(JSON.parse(landed!).permissions).toEqual({ allow: ["Bash(bun *)"] });
    expect(plan.report).toContain(".claude/settings.json");
    expect(plan.report).toContain("tool-call-capture");
  });

  test("CONTROL: a settings file with no capture entry lands byte-identical", async () => {
    const body = json({ hooks: { PreToolUse: [UNRELATED] } });
    const tpl = tree({ "CLAUDE.md": "# Template\n", ".claude/settings.json": body });
    const plan = (await planner())(tpl, tree({}), { mode: "per-category", selection: [".claude/settings.json"] });
    expect(plan.files[".claude/settings.json"]).toBe(body);
  });

  test("skills/setup-template/SKILL.md names dropCaptureEntries at its copy step", () => {
    const body = readFileSync(join(PLUGIN_ROOT, "skills", "setup-template", "SKILL.md"), "utf-8");
    const paras = body.split(/\n\s*\n/);
    expect(paras.some((p) => p.includes("dropCaptureEntries") && p.includes(".claude/settings"))).toBe(true);
  });
});
