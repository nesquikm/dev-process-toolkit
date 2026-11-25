/**
 * STE-679 AC-STE-679.7 — pure availability check for the `--bug` tracker
 * type, run over a SAVED listing before any tracker write or FR file.
 *
 * - Jira: the configured issue type (`jira_bug_issue_type`) must exist in the
 *   project's issue-type listing and be able to take the milestone Epic as
 *   parent (a standard, non-subtask type at hierarchy level 0). A v2 row
 *   carries no hierarchy level (AC-STE-872.6): it passes only as Bug, Task or
 *   Story, or when the Jira binding declares `jira_bug_type_standard: true`;
 *   a row named Epic is level 1. No label fallback.
 * - Linear: the configured label (`linear_bug_label`) must exist and be live
 *   (not archived, not retired).
 *
 * Returns the resolved name on success; throws an NFR-10 three-line message
 * (verdict, `Remedy:`, `Context:`) on refusal.
 */

import { join } from "node:path";
import { readCompleteList, readTrackerPage } from "./tracker_answer";
import { readWorkspaceBinding } from "./workspace_binding";

export type BugTrackerTypeInput =
  | { mode: "jira"; issueType: string; epicKey?: string; listing: unknown; declaredStandard?: boolean }
  | { mode: "linear"; label: string; listing: unknown };

function refuse(verdict: string, remedy: string, context: string): never {
  throw new Error(`${verdict}\nRemedy: ${remedy}\nContext: ${context}`);
}

/** Refuse a listing the shared reader cannot read, or one that does not prove it is whole. */
function unreadable(tracker: string, key: string, name: string, why: string): never {
  return refuse(
    `bug type refused: the saved ${tracker} listing is incomplete or unreadable — ${why}`,
    `re-fetch the whole listing (Linear: list_issue_labels filtered by name; Jira: the project's issue types) and re-run the check`,
    `mode=${tracker.toLowerCase()}, ${key}=${name}, skill=/spec-write`,
  );
}

// Exact match: import (AC-STE-680.1) recognises a bug only by an equal name, so a
// name that passed here only by case would file bugs that never import as bugs.
const eq = (a: unknown, b: string) => a === b;

/** Where a bug key lives, in both homes: the settings file, or the legacy CLAUDE.md block before the move. */
const JIRA_HOME = "under task_tracking.jira in specs/settings.yaml (under ### Jira in CLAUDE.md before the settings move)";
const LINEAR_HOME = "under task_tracking.linear in specs/settings.yaml (under ### Linear in CLAUDE.md before the settings move)";

function checkJira(issueType: string, epicKey: string, listing: unknown, declaredStandard?: unknown): string {
  // No key yet (the milestone Epic is created after this check): name it as new.
  const epic = epicKey || "(new)";
  const parent = epicKey ? `the milestone Epic ${epicKey}` : "the new milestone Epic";
  const read = readCompleteList("jira:getJiraProjectIssueTypesMetadata", listing);
  if (!read.ok) unreadable("Jira", "jira_bug_issue_type", issueType, read.reason);
  const types = read.items;
  // `name` only: an issue's own `fields.issuetype` carries `name`, which is all import reads.
  const hit = types.find((t) => eq(t.name, issueType));
  if (!hit && !read.complete) unreadable("Jira", "jira_bug_issue_type", issueType, "it does not prove it holds every issue type");
  if (!hit) {
    refuse(
      `bug type refused: Jira issue type "${issueType}" is not available in this project`,
      `set jira_bug_issue_type ${JIRA_HOME} to one of: ${types.map((t) => String(t.name)).join(", ") || "(none listed)"}`,
      `mode=jira, jira_bug_issue_type=${issueType}, epic=${epic}, skill=/spec-write`,
    );
  }
  // A v2 row carries no hierarchyLevel (AC-STE-872.6): the Epic type is then known
  // by its name, and a standard type by a known name or the binding's declaration.
  const name = String(hit.name);
  const numeric = Number.isFinite(hit.hierarchyLevel);
  const isEpic = name.trim().toLowerCase() === "epic"; // AC-STE-872.8 mutation: epic
  const knownName = ["Bug", "Task", "Story"].includes(name); // AC-STE-872.8 mutation: known-name
  const declared = declaredStandard === true; // AC-STE-872.8 mutation: setting
  const level = numeric ? (hit.hierarchyLevel as number) : isEpic ? 1 : 0;
  if (hit.subtask === true || level !== 0) {
    refuse(
      `bug type refused: Jira issue type "${name}" cannot take ${parent} as parent`,
      `set jira_bug_issue_type ${JIRA_HOME} to a standard issue type that sits under an Epic`,
      `mode=jira, jira_bug_issue_type=${issueType}, epic=${epic}, hierarchyLevel=${numeric ? level : "none"}, subtask=${hit.subtask === true}, skill=/spec-write`,
    );
  }
  if (!numeric && !knownName && !declared) {
    refuse(
      `bug type refused: Jira issue type "${name}" has no hierarchy level in the listing, so it is not known to sit under ${parent}`,
      `set jira_bug_type_standard: true ${JIRA_HOME} if "${name}" is a standard issue type, or set jira_bug_issue_type to Bug, Task or Story`,
      `mode=jira, jira_bug_issue_type=${issueType}, epic=${epic}, hierarchyLevel=none, jira_bug_type_standard=${String(declaredStandard ?? "unset")}, skill=/spec-write`,
    );
  }
  return String(hit.name);
}

function checkLinear(label: string, listing: unknown): string {
  const read = readTrackerPage("linear", listing, "labels");
  if (!read.ok) unreadable("Linear", "linear_bug_label", label, read.reason);
  const hit = read.page.items.find((l) => eq(l.name, label));
  // A page that is not proven last says nothing about the labels after it.
  if (!hit && !read.page.last) unreadable("Linear", "linear_bug_label", label, `its first page has no "${label}" and more pages follow`);
  if (!hit) {
    refuse(
      `bug label refused: Linear label "${label}" does not exist`,
      `create the label in Linear, or set linear_bug_label ${LINEAR_HOME} to an existing label`,
      `mode=linear, linear_bug_label=${label}, skill=/spec-write`,
    );
  }
  if (hit.retiredAt || hit.archivedAt) {
    refuse(
      `bug label refused: Linear label "${label}" is retired`,
      `restore the label in Linear, or set linear_bug_label ${LINEAR_HOME} to a live label`,
      `mode=linear, linear_bug_label=${label}, retiredAt=${String(hit.retiredAt ?? hit.archivedAt)}, skill=/spec-write`,
    );
  }
  return String(hit.name);
}

export function checkBugTrackerType(input: Record<string, unknown>): string {
  if (input.mode === "jira") {
    return checkJira(String(input.issueType ?? ""), String(input.epicKey ?? ""), input.listing, input.declaredStandard);
  }
  if (input.mode === "linear") {
    return checkLinear(String(input.label ?? ""), input.listing);
  }
  return refuse(
    `bug type refused: unsupported tracker mode "${String(input.mode)}"`,
    `--bug needs mode: jira or mode: linear`,
    `mode=${String(input.mode)}, skill=/spec-write`,
  );
}

// Front door:
//   bun bug_tracker_type.ts jira <listing.json> <issueType> [<epicKey>] [--root <dir>]
//   (--root: the project whose Jira binding may declare jira_bug_type_standard)
//   bun bug_tracker_type.ts linear <listing.json> <label>
// Prints the resolved name; exits 2 with the NFR-10 message on refusal.
if (import.meta.main) {
  const argv = process.argv.slice(2);
  const rootAt = argv.indexOf("--root");
  const root = rootAt >= 0 ? argv[rootAt + 1] : undefined;
  if (rootAt >= 0 && (root === undefined || root === "" || root.startsWith("--"))) {
    console.error("usage: --root needs a project directory: bug_tracker_type.ts jira <listing.json> <issueType> [<epicKey>] --root <projectRoot>");
    process.exit(2);
  }
  if (rootAt >= 0) argv.splice(rootAt, 2);
  const [mode, file, name, epicKey] = argv;
  if (!mode || !file || !name) {
    console.error(
      "usage: bug_tracker_type.ts jira <listing.json> <issueType> [<epicKey>] [--root <projectRoot>] | linear <listing.json> <label>",
    );
    process.exit(2);
  }
  try {
    const listing = JSON.parse(await Bun.file(file).text());
    const declaredStandard =
      mode === "jira" && root ? readWorkspaceBinding(join(root, "CLAUDE.md"), "jira").jiraBugTypeStandard : undefined;
    const out =
      mode === "jira"
        ? checkBugTrackerType({ mode, issueType: name, epicKey, listing, declaredStandard })
        : checkBugTrackerType({ mode, label: name, listing });
    console.log(out);
    process.exit(0);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(2);
  }
}
