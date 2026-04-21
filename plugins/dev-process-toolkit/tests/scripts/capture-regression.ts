#!/usr/bin/env bun
// Capture a `mode: none` baseline snapshot for Pattern 9 regression checks.
//
// Writes the snapshot to stdout. Deterministic: walks CLAUDE.md and specs/
// under the named fixture, with sha256 and byte size per file. Kept in
// TypeScript so the capture primitive is portable with the rest of the
// plugin's tracker helpers (Bun ≥ 1.2).
//
// Usage:
//   bun run capture-regression.ts                 → mode-none-baseline (default)
//   bun run capture-regression.ts <fixture-name>  → tests/fixtures/projects/<name>

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const scriptDir = new URL(".", import.meta.url).pathname;
const pluginRoot = join(scriptDir, "..", "..");

const fixtureName = process.argv[2] ?? "mode-none-baseline";
const fixtureDir = join(pluginRoot, "tests", "fixtures", "projects", fixtureName);

if (!existsSync(fixtureDir)) {
  process.stderr.write(`capture-regression: fixture not found: ${fixtureDir}\n`);
  process.exit(2);
}

function walk(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith(".")) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, acc);
    else if (st.isFile()) acc.push(full);
  }
  return acc;
}

const targets = [
  ...(existsSync(join(fixtureDir, "CLAUDE.md")) ? [join(fixtureDir, "CLAUDE.md")] : []),
  ...walk(join(fixtureDir, "specs")),
];

const rel = (p: string) => relative(fixtureDir, p);
targets.sort((a, b) => rel(a).localeCompare(rel(b)));

process.stdout.write("=== file tree ===\n");
for (const t of targets) process.stdout.write(rel(t) + "\n");
process.stdout.write("\n=== file content (path + sha256 + size + full content) ===\n");
for (const t of targets) {
  const body = readFileSync(t);
  const sha = createHash("sha256").update(body).digest("hex");
  const size = body.length;
  process.stdout.write(`--- ${rel(t)} (sha256=${sha} size=${size}) ---\n`);
  process.stdout.write(body);
  process.stdout.write("\n");
}
