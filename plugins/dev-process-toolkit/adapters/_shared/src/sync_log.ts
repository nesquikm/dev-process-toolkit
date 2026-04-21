// Sync-log entry formatter (AC-39.8, Schema L bulleted append-only form).
//
// One bullet per resolution event. Pure function (Schema P). Production-
// safe time source:
//
//   1. Explicit `now` option wins — callers inject the timestamp.
//   2. DPT_TEST_FROZEN_TIME is honored ONLY when NODE_ENV === "test"
//      (AC-39.11). This prevents a misconfigured production process
//      from emitting a frozen timestamp if the env var leaks in from
//      a shell parent, CI, or container template.
//   3. Otherwise, `new Date().toISOString()`.
//
// Form: `- <ISO> — <N> AC conflicts resolved on <ticket-id>`

export function formatSyncLogEntry(options: {
  conflictCount: number;
  ticketId: string;
  now?: string;
}): string {
  const { conflictCount, ticketId, now } = options;
  const frozen =
    process.env["NODE_ENV"] === "test" ? process.env["DPT_TEST_FROZEN_TIME"] : undefined;
  const timestamp = now ?? frozen ?? new Date().toISOString();
  return `- ${timestamp} — ${conflictCount} AC conflicts resolved on ${ticketId}`;
}

if (import.meta.main) {
  const raw = await new Response(Bun.stdin.stream()).text();
  let input: { conflictCount?: number; ticketId?: string; now?: string } = {};
  try {
    input = raw.trim().length > 0 ? JSON.parse(raw) : {};
  } catch (err) {
    process.stderr.write(`sync_log: invalid JSON on stdin: ${(err as Error).message}\n`);
    process.exit(1);
  }
  if (typeof input.conflictCount !== "number" || typeof input.ticketId !== "string") {
    process.stderr.write("sync_log: missing conflictCount or ticketId\n");
    process.exit(1);
  }
  process.stdout.write(formatSyncLogEntry(input as { conflictCount: number; ticketId: string; now?: string }) + "\n");
}
