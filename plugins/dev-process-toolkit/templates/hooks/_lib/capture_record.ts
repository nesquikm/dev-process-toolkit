// STE-716 — the capture hook's record-entry check.
//
// Kept apart from session.ts so that module keeps its one file read. Node
// built-ins only: the capture hook imports it statically, and
// `adapters/_shared/src/capture_registration.ts` imports it so `status` grades
// the same check the hook does.

import { readFileSync, realpathSync } from "node:fs";

function realOrNull(p: string): string | null {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
}

/**
 * True only when the installed-plugins record at `recordPath` pins `pluginRoot`
 * for `root`: its `dev-process-toolkit@` entry whose `projectPath` is the
 * checkout's real path (else the `scope: "user"` entry) has an `installPath`
 * whose real path equals `pluginRoot`'s. Every read error fails closed.
 */
export function recordPinsPluginRoot(recordPath: unknown, root: string, pluginRoot: string): boolean {
  if (typeof recordPath !== "string" || recordPath === "") return false;
  let record: unknown;
  try {
    record = JSON.parse(readFileSync(recordPath, "utf-8"));
  } catch {
    return false;
  }
  const plugins = (record as { plugins?: unknown } | null)?.plugins;
  if (!plugins || typeof plugins !== "object") return false;
  const key = Object.keys(plugins).find((k) => k.startsWith("dev-process-toolkit@"));
  if (key === undefined) return false;
  const entries = (plugins as Record<string, unknown>)[key];
  if (!Array.isArray(entries)) return false;
  const rootReal = realOrNull(root);
  if (rootReal === null) return false;
  const isObj = (e: unknown): e is Record<string, unknown> => !!e && typeof e === "object";
  const entry =
    entries.find((e) => isObj(e) && typeof e.projectPath === "string" && realOrNull(e.projectPath) === rootReal) ??
    entries.find((e) => isObj(e) && e.scope === "user");
  if (!isObj(entry) || typeof entry.installPath !== "string") return false;
  const installReal = realOrNull(entry.installPath);
  const selfReal = realOrNull(pluginRoot);
  return installReal !== null && selfReal !== null && installReal === selfReal;
}
