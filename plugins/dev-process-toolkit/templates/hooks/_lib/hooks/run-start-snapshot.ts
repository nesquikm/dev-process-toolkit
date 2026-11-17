// STE-810 — run-start snapshot hook (per-hook entrypoint).
//
// Fired on PreToolUse (matcher `Skill`) and on UserPromptSubmit. Records one
// `dpt-run-start/1` row when the invoked skill is `dev-process-toolkit:<name>`:
// the Skill tool's `tool_input.skill`, or a prompt whose first token is
// `/dev-process-toolkit:<name>`. `fr` is the first argument token equal to the
// stem of a file in `specs/frs/` or `specs/frs/archive/`, else null. Any other
// skill or prompt records nothing. Fail-open: exits 0, prints nothing.

import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { findCheckoutRoot, parseHookPayload } from "../session.ts";

const SRC = resolve(import.meta.dir, "..", "..", "..", "..", "adapters", "_shared", "src");
const PREFIX = "dev-process-toolkit:";

/** The invoked toolkit skill and its argument tokens, or null when this is not a toolkit start. */
function invocation(payload: Record<string, unknown>): { skill: string; args: string[] } | null {
  const tokens = (s: unknown): string[] => (typeof s === "string" ? s.split(/\s+/).filter((t) => t !== "") : []);
  const isToolkitSkill = (s: unknown): s is string =>
    typeof s === "string" && s.startsWith(PREFIX) && s.length > PREFIX.length;
  if (payload.hook_event_name === "UserPromptSubmit") {
    const [first, ...rest] = tokens(payload.prompt);
    const skill = first?.startsWith("/") ? first.slice(1) : undefined;
    return isToolkitSkill(skill) ? { skill, args: rest } : null;
  }
  if (payload.tool_name !== "Skill") return null;
  const input = (payload.tool_input ?? {}) as Record<string, unknown>;
  return isToolkitSkill(input.skill) ? { skill: input.skill, args: tokens(input.args) } : null;
}

/** Stems of the files in `specs/frs/` and `specs/frs/archive/`. */
function frStems(root: string): Set<string> {
  const stems = new Set<string>();
  for (const dir of [join(root, "specs", "frs"), join(root, "specs", "frs", "archive")]) {
    try {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.isFile()) stems.add(e.name.replace(/\.[^.]*$/, ""));
      }
    } catch {
      // absent directory — no stems from it
    }
  }
  return stems;
}

/**
 * Node-built-ins-only fast path: some line of the top-level `tracking` section
 * of `specs/settings.yaml` (block or flow style, any depth) names
 * `enabled: true`. It only filters:
 * the real parser (`anyTrackingSwitchOn`) decides, so a shape this scan cannot
 * read must answer true and defer, never false and skip.
 */
function trackingLineOn(root: string): boolean {
  let text: string;
  try {
    text = readFileSync(join(root, "specs", "settings.yaml"), "utf-8");
  } catch {
    return false;
  }
  // This is a "maybe on" test, never an "off" verdict: it may defer to the real parser
  // for a file that turns out off, but must never skip one the parser reads as on. So any
  // line inside the top-level `tracking` section — block or flow, at any depth — that holds
  // a `true` in any case (True, TRUE, a quoted key, `!!bool true`) or a YAML alias (`*x`,
  // whose anchor may be a true anywhere) defers. `yes` and `on` stay strings in Bun.YAML.
  let inTracking = false;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\s+#.*$/, "").replace(/^\s*#.*$/, "").trimEnd();
    if (line.trim() === "") continue;
    if (line.length - line.trimStart().length === 0) inTracking = /^["']?tracking["']?\s*:/.test(line);
    if (inTracking && (/\btrue\b/i.test(line) || /(^|[\s:,[{])\*[^\s,\]}]/.test(line))) return true;
  }
  return false;
}

try {
  const payload = parseHookPayload(await Bun.stdin.text()) as Record<string, unknown> | null;
  const call = payload === null ? null : invocation(payload);
  const root = call === null ? null : findCheckoutRoot(payload!.cwd);
  // A row with no session joins to no run, so an empty or missing session id writes nothing.
  const session = typeof payload?.session_id === "string" ? payload.session_id : "";
  if (call !== null && root !== null && session !== "" && trackingLineOn(root)) {
    const stems = frStems(root);
    const fr = call.args.find((t) => stems.has(t)) ?? null;
    type RunStart = typeof import("../../../../adapters/_shared/src/run_start.ts");
    const { anyTrackingSwitchOn, recordRunStart } = (await import(join(SRC, "run_start.ts"))) as RunStart;
    if (anyTrackingSwitchOn(root)) {
      recordRunStart(root, { session, skill: call.skill, fr, at: new Date().toISOString() });
    }
  }
} catch {
  // fail-open by design — a run-start snapshot never blocks a skill or a prompt.
}
process.exit(0);
