// Jira per-project custom-field GID discovery (AC-30.6).
//
// Takes a project's field list on stdin, returns the
// matching Acceptance-Criteria field's GID on stdout. Pure function over text
// (Schema P): no network, no auth, deterministic match ranking.
//
// Invocation contract:
//   stdin:  { "fields": <the answer> }, the answer being the field rows, a
//           getJiraIssueTypeMetaWithFields answer (v1 or v2), or the JSON array
//           of its pages. A row is named by `id` or, in create metadata, `fieldId`.
//           An error answer, an unread shape or a partial listing exits 1: it
//           proves no field absent.
//   stdout: { "ok": true, "gid": "customfield_XXXXX", "name": "..." }
//     or:   { "ok": false, "reason": "<human-readable>" }
//   exit:   0 on success (including ok=false), non-zero on invalid input
//
// `{ ok: false }` is a first-class supported signal, NOT an error. It fires
// on team-managed Kanban templates that ship without an AC custom field
// (the most common starting Jira template). `/setup` interprets the
// signal as a branch point: prompt the operator to either create the
// field and re-run (records `jira_ac_field: customfield_XXXXX`) or accept
// the description-body sentinel (records `jira_ac_field: description`).
// Both outcomes are explicit; there is no silent fallback.
//
// Called by `/setup` when the user picks `jira`; the caller is responsible
// for invoking the Atlassian MCP, piping the response in, and writing the
// resolved `jira_ac_field:` value to CLAUDE.md.

import { readJiraAnswer } from "../../_shared/src/tracker_answer";

export type JiraField = {
  id?: string;
  fieldId?: string;
  name: string;
  custom?: boolean;
  schema?: unknown;
};

export type DiscoveryResult =
  | { ok: true; gid: string; name: string }
  | { ok: false; reason: string };

function numericSuffix(id: string): number {
  const m = id.match(/(\d+)$/);
  return m ? Number(m[1]) : Number.POSITIVE_INFINITY;
}

export function discoverAcField(fields: JiraField[]): DiscoveryResult {
  if (!Array.isArray(fields) || fields.length === 0) {
    return { ok: false, reason: "no fields returned" };
  }

  const custom = fields
    .map((f) => ({ id: f?.id ?? f?.fieldId, name: f?.name }))
    .filter((f): f is { id: string; name: string } => typeof f.id === "string" && typeof f.name === "string");

  // Tier 1: exact name "Acceptance Criteria" (case-insensitive).
  const exact = custom.filter((f) => f.name.trim().toLowerCase() === "acceptance criteria");
  if (exact.length > 0) {
    exact.sort((a, b) => numericSuffix(a.id) - numericSuffix(b.id));
    return { ok: true, gid: exact[0]!.id, name: exact[0]!.name };
  }

  // Tier 2: partial name containing "acceptance criteria".
  const partial = custom.filter((f) => f.name.trim().toLowerCase().includes("acceptance criteria"));
  if (partial.length > 0) {
    partial.sort((a, b) => numericSuffix(a.id) - numericSuffix(b.id));
    return { ok: true, gid: partial[0]!.id, name: partial[0]!.name };
  }

  // Tier 3: name with "AC" as a whole word (e.g., "AC list", "Team AC notes").
  const acWord = custom.filter((f) => /\bac\b/i.test(f.name));
  if (acWord.length > 0) {
    acWord.sort((a, b) => numericSuffix(a.id) - numericSuffix(b.id));
    return { ok: true, gid: acWord[0]!.id, name: acWord[0]!.name };
  }

  return {
    ok: false,
    reason: "no field named 'Acceptance Criteria' (or close variants) found",
  };
}

/**
 * The field rows of one answer: a row array, or the pages of a create-metadata
 * answer in order, each starting where the one before ended and agreeing on
 * `total`. Throws on anything else: it proves no field absent.
 */
export function fieldRows(answer: unknown): JiraField[] {
  const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
  const isRow = (v: unknown): v is JiraField => isObj(v) && typeof v.name === "string" && (typeof v.id === "string" || typeof v.fieldId === "string");
  if (Array.isArray(answer) && answer.every(isRow)) return answer;
  const rows: JiraField[] = [];
  let total: unknown;
  for (const page of Array.isArray(answer) ? answer : [answer]) {
    if (!isObj(page)) throw new Error("the answer is not a field list");
    const read = readJiraAnswer(page);
    if (!read.ok) throw new Error(read.reason);
    const { fields, startAt, total: said } = read.answer;
    if ("error" in read.answer || !Array.isArray(fields) || !fields.every(isRow)) throw new Error("the answer carries no readable `fields` list");
    if (startAt !== rows.length || typeof said !== "number" || (total !== undefined && said !== total)) throw new Error("the pages are not one listing in order (`startAt`, `total`)");
    rows.push(...fields);
    total = said;
  }
  if (rows.length !== total) throw new Error(`the listing holds ${rows.length} of ${total} fields; fetch the rest (startAt)`);
  return rows;
}

if (import.meta.main) {
  const raw = await new Response(Bun.stdin.stream()).text();
  let parsed: { fields?: unknown } = {};
  try {
    parsed = raw.trim().length > 0 ? JSON.parse(raw) : {};
  } catch (err) {
    process.stderr.write(`discover_field: invalid JSON on stdin: ${(err as Error).message}\n`);
    process.exit(1);
  }
  let fields: JiraField[];
  try {
    fields = fieldRows(parsed.fields);
  } catch (err) {
    process.stderr.write(`discover_field: ${(err as Error).message}\n`);
    process.exit(1);
  }
  const result = discoverAcField(fields);
  process.stdout.write(JSON.stringify(result) + "\n");
}
