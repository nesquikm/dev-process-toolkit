// STE-716 — opt-in tool-call capture hook (per-hook entrypoint).
//
// Not bundled: hooks/hooks.json never names it. Only an approved settings
// change registers it, in `<root>/.claude/settings.local.json`, with the
// installed-plugins record path as the first argument.
//
// Fast path, in order, each step exiting 0 silently when it fails:
//   1. parse the payload; find the checkout root (no child process);
//   2. the checkout holds `specs/settings.yaml`;
//   3. the record-entry check: the record's `dev-process-toolkit@` entry for
//      this checkout (else the user-scope entry) installs THIS plugin root;
//   4. dynamic import of project_settings.ts; the flag reads true;
//   5. only then the heavy modules, and one `tool-call/v1` row appended.
//
// Every run exits 0 with empty stdout and stderr. Static imports: Node
// built-ins, ../session.ts and ../capture_record.ts only.

import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { recordPinsPluginRoot } from "../capture_record.ts";
import { findCheckoutRoot, parseHookPayload } from "../session.ts";

const PLUGIN_ROOT = resolve(import.meta.dir, "..", "..", "..", "..");
const SRC = join(PLUGIN_ROOT, "adapters", "_shared", "src");

function stagedDiff(repoRoot: string | null): { files: number; insertions: number; deletions: number } | null {
  if (repoRoot === null) return null;
  const p = spawnSync("git", ["diff", "--cached", "--numstat"], { cwd: repoRoot, encoding: "utf-8", env: process.env });
  if (p.status !== 0 || typeof p.stdout !== "string") return null;
  let files = 0;
  let insertions = 0;
  let deletions = 0;
  for (const line of p.stdout.split("\n")) {
    if (line === "") continue;
    const [ins, del] = line.split("\t");
    files++;
    if (ins !== undefined && /^\d+$/.test(ins)) insertions += Number(ins);
    if (del !== undefined && /^\d+$/.test(del)) deletions += Number(del);
  }
  return { files, insertions, deletions };
}

async function main(): Promise<void> {
  const payload = parseHookPayload(await Bun.stdin.text());
  if (!payload) return;
  const root = findCheckoutRoot(payload.cwd);
  if (root === null) return;
  if (!existsSync(join(root, "specs", "settings.yaml"))) return;
  if (!recordPinsPluginRoot(process.argv[2], root, PLUGIN_ROOT)) return;

  const { toolCallsSwitchOn } = (await import(join(SRC, "project_settings.ts"))) as {
    toolCallsSwitchOn: (r: string) => boolean;
  };
  if (!toolCallsSwitchOn(root)) return;

  const event =
    payload.hook_event_name === "PreToolUse" ? "pre" : payload.hook_event_name === "PostToolUse" ? "post" : null;
  const tool = payload.tool_name;
  if (event === null || (tool !== "Bash" && tool !== "Skill")) return;
  const sessionId = typeof payload.session_id === "string" ? payload.session_id : "";

  const [{ toolCallLedgerPath }, commit, pr, receipt, { worktreeDigest }] = await Promise.all([
    import(join(SRC, "dpt_paths.ts")),
    import(join(SRC, "commit_target_repo.ts")),
    import(join(SRC, "pr_target_repo.ts")),
    import(join(SRC, "gate_receipt.ts")),
    import(join(SRC, "worktree_digest.ts")),
  ]);
  const ledger: string = toolCallLedgerPath(root, sessionId);

  let cls: string;
  let skill: string | null = null;
  let tree: string | null = null;
  let diff: { files: number; insertions: number; deletions: number } | null = null;
  if (tool === "Bash") {
    const command = typeof payload.tool_input?.command === "string" ? payload.tool_input.command : "";
    const target = commit.resolveCommitTargetFromPayload(payload);
    if (target.isCommit) {
      cls = "commit";
      if (event === "pre") {
        tree = worktreeDigest(root);
        diff = stagedDiff(target.repoRoot);
      }
    } else if (pr.resolvePrTargetFromPayload(payload).isPr) {
      cls = "pr-create";
    } else if (receipt.announcesGateReceipt(command) || receipt.runsGateOutcome(command)) {
      cls = "gate-receipt";
    } else {
      cls = "other";
    }
  } else {
    cls = "skill";
    const name = payload.tool_input?.skill;
    skill = typeof name === "string" && name.startsWith("dev-process-toolkit:") ? name : "other";
    tree = worktreeDigest(root);
  }

  const raw = payload as unknown as Record<string, unknown>;
  const row = {
    schema: "tool-call/v1",
    event,
    tool_use_id: typeof payload.tool_use_id === "string" ? payload.tool_use_id : null,
    tool,
    class: cls,
    skill,
    ts: new Date().toISOString(),
    tree,
    diff,
    scope: typeof raw.agent_id === "string" && raw.agent_id !== "" ? "fork" : "main",
  };
  mkdirSync(dirname(ledger), { recursive: true });
  appendFileSync(ledger, `${JSON.stringify(row)}\n`);
}

try {
  await main();
} catch {
  // silent by design: every failure writes nothing and says nothing.
}
process.exit(0);
