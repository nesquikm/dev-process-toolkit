// STE-786 (M_870603) — the tracker listing query front door.
//
// Probe #49's Jira listing used `statusCategory != Done`, so a ticket an
// active local FR binds dropped off the page the moment it closed. This
// builder adds every bound key back into the JQL so the closed ticket still
// reaches the reconcile.
//
// Usage: bun run tracker_listing_query.ts jira <projectRoot> <projectKey>

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "./frontmatter";

const JIRA_KEY_RE = /^[A-Z][A-Z0-9_]*-\d+$/;
const JIRA_PROJECT_RE = /^[A-Z][A-Z0-9_]*$/;

export class TrackerListingQueryError extends Error {
  constructor(
    message: string,
    readonly remedy: string,
    readonly context: string,
  ) {
    super(message);
    this.name = "TrackerListingQueryError";
  }
}

/** The Jira listing JQL for `projectKey`, widened by every bound key. Throws on a malformed key. */
export function buildJiraListingJql(projectKey: string, boundKeys: readonly string[]): string {
  if (!JIRA_PROJECT_RE.test(projectKey)) {
    throw new TrackerListingQueryError(
      `project key ${JSON.stringify(projectKey)} is not a Jira project key`,
      "pass a project key matching ^[A-Z][A-Z0-9_]*$",
      `projectKey=${JSON.stringify(projectKey)}`,
    );
  }
  for (const key of boundKeys) {
    if (!JIRA_KEY_RE.test(key)) {
      throw new TrackerListingQueryError(
        `bound key ${JSON.stringify(key)} is not a Jira issue key`,
        "fix the FR's `tracker.jira` binding to a key matching ^[A-Z][A-Z0-9_]*-\\d+$",
        `key=${JSON.stringify(key)}`,
      );
    }
  }
  const base = `project = ${projectKey} AND statusCategory != Done`;
  if (boundKeys.length === 0) return base;
  const sorted = [...new Set(boundKeys)].sort();
  return `project = ${projectKey} AND (statusCategory != Done OR key in (${sorted.join(", ")}))`;
}

/** The `tracker.jira` values of active FRs under `<projectRoot>/specs/frs/*.md` (archive excluded). */
export function activeBoundJiraKeys(projectRoot: string): string[] {
  const dir = join(projectRoot, "specs", "frs");
  if (!existsSync(dir)) return [];
  const keys: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const fm = parseFrontmatter(readFileSync(join(dir, entry.name), "utf8"), { lenient: true });
    const tracker = fm["tracker"];
    if (tracker === null || typeof tracker !== "object") continue;
    const jira = (tracker as Record<string, unknown>)["jira"];
    if (jira === null || jira === undefined || jira === "") continue;
    keys.push(String(jira));
  }
  return keys;
}

function refuse(message: string, remedy: string, context: string): never {
  console.error(`Refusing: ${message}`);
  console.error(`Remedy: ${remedy}`);
  console.error(`Context: ${context}`);
  process.exit(1);
}

if (import.meta.main) {
  const [tracker, projectRoot, projectKey] = process.argv.slice(2);
  if (tracker !== "jira" || projectRoot === undefined || projectKey === undefined) {
    refuse(
      "unsupported or missing arguments",
      "run `tracker_listing_query.ts jira <projectRoot> <projectKey>`",
      `argv=${JSON.stringify(process.argv.slice(2))}`,
    );
  }
  try {
    console.log(buildJiraListingJql(projectKey, activeBoundJiraKeys(projectRoot)));
  } catch (e) {
    if (e instanceof TrackerListingQueryError) refuse(e.message, e.remedy, `${e.context} projectRoot=${projectRoot}`);
    // An unreadable FR file or a frontmatter that will not parse is refused, never a stack trace.
    refuse(
      `the active FR files under specs/frs could not be read (${e instanceof Error ? e.message.split("\n")[0] : String(e)})`,
      "fix or remove the unreadable FR file, then re-run",
      `projectRoot=${projectRoot}`,
    );
  }
}
