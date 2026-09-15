// M_4df444 / STE-595 — refuse a spawn script fed to a shell through stdin.
//
// Repo-level PreToolUse hook (matcher `Bash`), registered in the tracked
// `.claude/settings.json` only, never in the plugin's `hooks/hooks.json`, so
// consumer projects are unaffected. It decides on its stdin payload alone;
// empty or unparseable stdin fails open (exit 0). A refusal exits 2 with the
// byte-stable NFR-10 lines.

import { detectStdinSpawn } from "../../plugins/dev-process-toolkit/adapters/_shared/src/stdin_spawn_detector.ts";
import { emitNFR10, parseHookPayload } from "../../plugins/dev-process-toolkit/templates/hooks/_lib/session.ts";

const payload = parseHookPayload(await Bun.stdin.text());
const command = payload?.tool_input?.command;
if (typeof command !== "string") process.exit(0);

const verdict = detectStdinSpawn(command);
if (!verdict.refuse) process.exit(0);

emitNFR10(
  "Refusing",
  verdict.why,
  "write the script to a file and run `bash <file>`; never feed a spawn script to bash, sh or zsh through stdin",
  // The hook guards every Bash call in this repo, not one skill's, so the
  // Context line names the tool it guards rather than a caller it cannot know.
  "bash",
  "pre-bash-stdin-spawn",
);
process.exit(2);
