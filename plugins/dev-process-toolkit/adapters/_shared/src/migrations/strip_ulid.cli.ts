#!/usr/bin/env bun
// strip_ulid CLI — thin wrapper around stripUlidFromArchive (STE-86).
//
//   bun run adapters/_shared/src/migrations/strip_ulid.cli.ts --dry-run
//   bun run adapters/_shared/src/migrations/strip_ulid.cli.ts --apply
//
// Target directory defaults to `specs/frs/archive` relative to the current
// working directory; pass a second positional arg to override.

import { resolve } from "node:path";
import { formatStripUlidSummary, stripUlidFromArchive } from "./strip_ulid";

function parseArgs(argv: string[]): { dryRun: boolean; dir: string } {
  const args = argv.slice(2);
  let mode: "dry-run" | "apply" | null = null;
  let dir = "specs/frs/archive";
  for (const arg of args) {
    if (arg === "--dry-run") mode = "dry-run";
    else if (arg === "--apply") mode = "apply";
    else if (!arg.startsWith("--")) dir = arg;
  }
  if (mode === null) {
    throw new Error("usage: strip_ulid.cli.ts --dry-run|--apply [dir]");
  }
  return { dryRun: mode === "dry-run", dir };
}

async function main(): Promise<number> {
  const { dryRun, dir } = parseArgs(process.argv);
  // Resolve to an absolute path and echo it before any writes — this
  // makes the effective target visible so a `--apply ..` mistake is
  // caught by the operator reading the preamble, not discovered after
  // the rewrite has landed.
  const absDir = resolve(process.cwd(), dir);
  console.log(`strip_ulid: ${dryRun ? "dry-run" : "apply"} target: ${absDir}`);
  const summary = await stripUlidFromArchive(absDir, { dryRun });
  console.log(formatStripUlidSummary(summary, process.cwd()));
  return summary.errors.length > 0 ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(String(err));
    process.exit(2);
  });
