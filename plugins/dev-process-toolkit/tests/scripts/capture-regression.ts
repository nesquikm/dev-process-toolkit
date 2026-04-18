#!/usr/bin/env bun
// Capture the mode: none baseline snapshot for Pattern 9 regression checks.
//
// Writes the snapshot to stdout. Deterministic: `find`-equivalent walk over
// CLAUDE.md and specs/ under the mode-none-baseline fixture, with sha256 and
// byte size per file. Kept in TypeScript so the capture primitive is
// portable with the rest of the plugin's tracker helpers (Bun ≥ 1.2).

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const scriptDir = new URL(".", import.meta.url).pathname;
const pluginRoot = join(scriptDir, "..", "..");
const fixtureDir = join(pluginRoot, "tests", "fixtures", "projects", "mode-none-baseline");

function walk(dir: string, acc: string[] = []): string[] {
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
  join(fixtureDir, "CLAUDE.md"),
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
