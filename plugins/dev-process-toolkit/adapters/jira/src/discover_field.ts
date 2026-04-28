// Jira per-project custom-field GID discovery (AC-30.6).
//
// Takes the full response of `GET /rest/api/3/field` on stdin, returns the
// matching Acceptance-Criteria field's GID on stdout. Pure function over text
// (Schema P): no network, no auth, deterministic match ranking.
//
// Invocation contract:
//   stdin:  { "fields": <array of field objects from /rest/api/3/field> }
//   stdout: { "ok": true, "gid": "customfield_XXXXX", "name": "..." }
//     or:   { "ok": false, "reason": "<human-readable>" }
//   exit:   0 on success (including ok=false), non-zero on invalid input
//
// Called by `/setup` when the user picks `jira`; the caller is responsible
// for invoking the Atlassian MCP, piping the response in, and writing
// `jira_ac_field: customfield_XXXXX` to CLAUDE.md.

export type JiraField = {
  id: string;
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
    return { ok: false, reason: "no fields returned from /rest/api/3/field" };
  }

  const custom = fields.filter(
    (f): f is JiraField => typeof f?.id === "string" && typeof f?.name === "string",
  );

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

if (import.meta.main) {
  const raw = await new Response(Bun.stdin.stream()).text();
  let parsed: { fields?: JiraField[] } = {};
  try {
    parsed = raw.trim().length > 0 ? JSON.parse(raw) : {};
  } catch (err) {
    process.stderr.write(`discover_field: invalid JSON on stdin: ${(err as Error).message}\n`);
    process.exit(1);
  }
  const result = discoverAcField(parsed.fields ?? []);
  process.stdout.write(JSON.stringify(result) + "\n");
}
