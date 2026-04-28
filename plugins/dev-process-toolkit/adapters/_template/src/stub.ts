#!/usr/bin/env bun
// Template stub helper. Replaces input with a deterministic `{ok: true, echo}`
// response so adapter authors can confirm the `bun run` pipe works before
// writing real logic. Replace this file with your tracker-specific helper(s).
//
// Invocation contract (Schema P):
//   JSON on stdin -> JSON on stdout
//   Errors on stderr + non-zero exit
//   No network calls; pure function over text

async function main(): Promise<void> {
  const raw = await new Response(Bun.stdin.stream()).text();
  let input: unknown = null;
  try {
    input = raw.trim().length > 0 ? JSON.parse(raw) : null;
  } catch (err) {
    process.stderr.write(`stub: invalid JSON on stdin: ${(err as Error).message}\n`);
    process.exit(1);
  }
  const response = { ok: true, echo: input };
  process.stdout.write(JSON.stringify(response) + "\n");
}

await main();
