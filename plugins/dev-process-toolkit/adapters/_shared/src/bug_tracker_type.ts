/**
 * STE-679 AC-STE-679.7 — pure availability check for the `--bug` tracker
 * type, run over a SAVED listing before any tracker write or FR file.
 *
 * - Jira: the configured issue type (`jira_bug_issue_type`) must exist in the
 *   project's issue-type listing and be able to take the milestone Epic as
 *   parent (a standard, non-subtask type at hierarchy level 0). No label
 *   fallback.
 * - Linear: the configured label (`linear_bug_label`) must exist and be live
 *   (not archived, not retired).
 *
 * Returns the resolved name on success; throws an NFR-10 three-line message
 * (verdict, `Remedy:`, `Context:`) on refusal.
 */

import { readCompleteList, readTrackerPage } from "./tracker_answer";

export type BugTrackerTypeInput =
  | { mode: "jira"; issueType: string; epicKey?: string; listing: unknown }
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

function checkJira(issueType: string, epicKey: string, listing: unknown): string {
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
      `set jira_bug_issue_type in CLAUDE.md to one of: ${types.map((t) => String(t.name)).join(", ") || "(none listed)"}`,
      `mode=jira, jira_bug_issue_type=${issueType}, epic=${epic}, skill=/spec-write`,
    );
  }
  const level = typeof hit.hierarchyLevel === "number" ? hit.hierarchyLevel : 0;
  if (hit.subtask === true || level !== 0) {
    refuse(
      `bug type refused: Jira issue type "${String(hit.name)}" cannot take ${parent} as parent`,
      `set jira_bug_issue_type in CLAUDE.md to a standard issue type that sits under an Epic`,
      `mode=jira, jira_bug_issue_type=${issueType}, epic=${epic}, hierarchyLevel=${level}, subtask=${hit.subtask === true}, skill=/spec-write`,
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
      `create the label in Linear, or set linear_bug_label in CLAUDE.md to an existing label`,
      `mode=linear, linear_bug_label=${label}, skill=/spec-write`,
    );
  }
  if (hit.retiredAt || hit.archivedAt) {
    refuse(
      `bug label refused: Linear label "${label}" is retired`,
      `restore the label in Linear, or set linear_bug_label in CLAUDE.md to a live label`,
      `mode=linear, linear_bug_label=${label}, retiredAt=${String(hit.retiredAt ?? hit.archivedAt)}, skill=/spec-write`,
    );
  }
  return String(hit.name);
}

export function checkBugTrackerType(input: Record<string, unknown>): string {
  if (input.mode === "jira") {
    return checkJira(String(input.issueType ?? ""), String(input.epicKey ?? ""), input.listing);
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
//   bun bug_tracker_type.ts jira <listing.json> <issueType> [<epicKey>]
//   bun bug_tracker_type.ts linear <listing.json> <label>
// Prints the resolved name; exits 2 with the NFR-10 message on refusal.
if (import.meta.main) {
  const [mode, file, name, epicKey] = process.argv.slice(2);
  if (!mode || !file || !name) {
    console.error(
      "usage: bug_tracker_type.ts jira <listing.json> <issueType> [<epicKey>] | linear <listing.json> <label>",
    );
    process.exit(2);
  }
  try {
    const listing = JSON.parse(await Bun.file(file).text());
    const out =
      mode === "jira"
        ? checkBugTrackerType({ mode, issueType: name, epicKey, listing })
        : checkBugTrackerType({ mode, label: name, listing });
    console.log(out);
    process.exit(0);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(2);
  }
}
