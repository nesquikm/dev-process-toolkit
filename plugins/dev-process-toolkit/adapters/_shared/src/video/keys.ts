// STE-663 — video key reader.
//
// AC-STE-663.6: `readVideoKeys` parses `<projectRoot>/.dpt/.env` — `KEY=VALUE`
// lines, `#` comments, single- or double-quoted values, blank lines — into a
// plain map. It never writes `process.env`; an absent file yields `{}`.

import { existsSync, readFileSync } from "node:fs";
import { dptEnvPath } from "../dpt_paths";

export function readVideoKeys(projectRoot: string): Record<string, string> {
  const path = dptEnvPath(projectRoot);
  if (!existsSync(path)) return {};
  const keys: Record<string, string> = {};
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      value.length >= 2 &&
      (value[0] === '"' || value[0] === "'") &&
      value[value.length - 1] === value[0]
    ) {
      value = value.slice(1, -1);
    }
    keys[key] = value;
  }
  return keys;
}
