#!/usr/bin/env bun
// Phase H Task 1 gate. Recaptures the mode-none-baseline fixture snapshot and
// byte-diffs it against the committed baseline. Exit 0 = clean (no drift);
// exit 1 = Pattern 9 regression (stop-ship).

import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const scriptDir = new URL(".", import.meta.url).pathname;
const pluginRoot = join(scriptDir, "..", "..");
const snapshot = join(pluginRoot, "tests", "fixtures", "baselines", "m1-m11-regression.snapshot");

if (!existsSync(snapshot)) {
  console.error(`verify-regression: baseline snapshot not found at ${snapshot}`);
  process.exit(2);
}

const captureTs = join(scriptDir, "capture-regression.ts");
const result = spawnSync("bun", ["run", captureTs], { encoding: "utf8" });

if (result.status !== 0) {
  console.error("verify-regression: capture script failed");
  if (result.stderr) console.error(result.stderr);
  process.exit(2);
}

const actual = result.stdout;
const expected = readFileSync(snapshot, "utf8");

if (actual === expected) {
  console.log("Regression clean: mode: none output byte-identical to baseline.");
  process.exit(0);
}

console.error("REGRESSION DETECTED: mode: none behavior diverges from baseline.");
console.error("This is a Pattern 9 violation. Stop-ship.");

// Emit a minimal line-level diff so the operator can see what moved.
const a = expected.split("\n");
const b = actual.split("\n");
const max = Math.max(a.length, b.length);
let printed = 0;
for (let i = 0; i < max && printed < 50; i++) {
  if (a[i] !== b[i]) {
    if (a[i] !== undefined) console.error(`- ${a[i]}`);
    if (b[i] !== undefined) console.error(`+ ${b[i]}`);
    printed++;
  }
}
process.exit(1);
