// Extract an Asana task gid from a pasted URL (AC-32.5).
//
// Pure function over text (Schema P). No network.
// Regex: https?://app\.asana\.com/0/\d+/(\d+)
//
// Matching URLs: https://app.asana.com/0/<project-gid>/<task-gid>
// Non-matching: any other host, missing path, trailing garbage after task gid.

export function extractGid(input: string): string | null {
  if (typeof input !== "string") return null;
  const m = input.trim().match(/^https?:\/\/app\.asana\.com\/0\/\d+\/(\d+)(?:[/?#].*)?$/);
  return m ? m[1]! : null;
}

if (import.meta.main) {
  const raw = await new Response(Bun.stdin.stream()).text();
  const gid = extractGid(raw);
  if (gid === null) {
    process.stderr.write("extract_gid: no gid in input\n");
    process.exit(1);
  }
  process.stdout.write(gid + "\n");
}
