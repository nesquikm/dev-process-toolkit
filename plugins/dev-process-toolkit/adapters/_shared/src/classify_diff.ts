// FR-39 diff classifier — adapter-agnostic.
//
// Takes normalized Schema N AC lists from local specs and the tracker,
// returns a classification per AC position. Pure function over text
// (Schema P). Shared across adapters so every tracker uses the same
// classifier semantics.
//
// Classes (AC-39.2, Schema K):
//   identical     — same id, same text, same completed
//   local-only    — id present locally, absent on tracker
//   tracker-only  — id present on tracker, absent locally
//   edited-both   — id present on both sides with different text or state

export type AC = { id: string; text: string; completed: boolean };

export type Classification = "identical" | "local-only" | "tracker-only" | "edited-both";

export type DiffRow = {
  id: string;
  classification: Classification;
  local: AC | null;
  tracker: AC | null;
};

function canonical(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function classifyDiff(local: AC[], tracker: AC[]): DiffRow[] {
  const localById = new Map(local.map((a) => [a.id, a]));
  const trackerById = new Map(tracker.map((a) => [a.id, a]));
  const allIds = new Set<string>();
  for (const a of local) allIds.add(a.id);
  for (const a of tracker) allIds.add(a.id);

  const rows: DiffRow[] = [];
  for (const id of [...allIds].sort()) {
    const l = localById.get(id) ?? null;
    const t = trackerById.get(id) ?? null;
    let classification: Classification;
    if (l && !t) classification = "local-only";
    else if (!l && t) classification = "tracker-only";
    else if (l && t && canonical(l.text) === canonical(t.text) && l.completed === t.completed) classification = "identical";
    else classification = "edited-both";
    rows.push({ id, classification, local: l, tracker: t });
  }
  return rows;
}

export function formatSchemaK(rows: DiffRow[]): string {
  const esc = (ac: AC | null) => (ac === null ? '"<absent>"' : `"${ac.text.replace(/"/g, '\\"')}"`);
  return rows
    .map((r) => `${r.id}: ${r.classification} | local: ${esc(r.local)} | tracker: ${esc(r.tracker)}`)
    .join("\n");
}

export function hasConflicts(rows: DiffRow[]): boolean {
  return rows.some((r) => r.classification !== "identical");
}

if (import.meta.main) {
  const raw = await new Response(Bun.stdin.stream()).text();
  let input: { local?: AC[]; tracker?: AC[] } = {};
  try {
    input = raw.trim().length > 0 ? JSON.parse(raw) : {};
  } catch (err) {
    process.stderr.write(`classify_diff: invalid JSON on stdin: ${(err as Error).message}\n`);
    process.exit(1);
  }
  const rows = classifyDiff(input.local ?? [], input.tracker ?? []);
  process.stdout.write(JSON.stringify({ rows, schemaK: formatSchemaK(rows), hasConflicts: hasConflicts(rows) }) + "\n");
}
