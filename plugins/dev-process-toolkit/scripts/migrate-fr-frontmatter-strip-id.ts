// STE-121 AC-STE-121.7 — one-time migration helper for active tracker-mode
// FR files that still carry `id:` after the M29 STE-110 prose flip.
//
// Dry-run only. Walks `specs/frs/*.md` (excluding `archive/` per STE-22 /
// AC-STE-18.4 archive immutability), and prints a unified diff per offender
// stripping the `id:` frontmatter line. Operator pipes the output to
// `patch -p1` to apply.
//
// Usage:
//   bun run plugins/dev-process-toolkit/scripts/migrate-fr-frontmatter-strip-id.ts <specs-dir>
//
// Pattern mirrors `migrate-task-tracking-canonical.ts` (STE-114).

import { computeStripIdMigrationDiffs } from "../adapters/_shared/src/migrate_fr_frontmatter_strip_id";

async function main(argv: string[]): Promise<number> {
  const specsDir = argv[2];
  if (!specsDir) {
    console.error("usage: migrate-fr-frontmatter-strip-id.ts <specs-dir>");
    return 1;
  }
  const diffs = await computeStripIdMigrationDiffs(specsDir);
  if (diffs.length === 0) {
    console.error("# no migration needed — every active tracker-mode FR is canonical");
    return 0;
  }
  console.log(diffs.map((d) => d.diff).join("\n"));
  return 0;
}

if (import.meta.main) {
  main(process.argv).then((code) => process.exit(code));
}
