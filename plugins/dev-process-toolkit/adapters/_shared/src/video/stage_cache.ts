// STE-665 — the render pipeline's stage cache.
//
// Each stage's key is a SHA-256 over its named inputs and a per-stage version,
// built the way `bundleHash` builds a bundle's hash: one `<sha256(value)>  <name>\n`
// line per named input in sorted order, then a SHA-256 over the lines. A
// manifest in the work dir records each stage's key and outputs; a stage is
// skipped only when its key matches AND every output exists.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const STAGE_MANIFEST_FILE = "stages.json";

export interface StageManifest {
  stages: Record<string, { key: string; outputs: string[] }>;
}

export interface CachedStage {
  name: string;
  version: number;
  inputs: Record<string, unknown>;
  outputs: string[];
  run: () => Promise<void> | void;
}

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

/** JSON with object keys sorted, so equal values always serialise to equal bytes. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.keys(value as object)
      .sort()
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function stageKey(name: string, version: number, inputs: Record<string, unknown>): string {
  const named: Record<string, unknown> = { ...inputs, "@stage": name, "@version": version };
  const lines = Object.keys(named)
    .sort()
    .map((k) => `${sha256(canonicalJson(named[k]))}  ${k}\n`);
  return sha256(lines.join(""));
}

export function readStageManifest(workDir: string): StageManifest {
  try {
    const parsed = JSON.parse(readFileSync(join(workDir, STAGE_MANIFEST_FILE), "utf8"));
    if (parsed && typeof parsed === "object" && parsed.stages && typeof parsed.stages === "object") {
      return { stages: parsed.stages };
    }
  } catch {
    // absent or unreadable -> empty manifest
  }
  return { stages: {} };
}

function writeStageManifest(workDir: string, manifest: StageManifest): void {
  mkdirSync(workDir, { recursive: true });
  writeFileSync(join(workDir, STAGE_MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
}

export async function runCachedStage(workDir: string, stage: CachedStage): Promise<"ran" | "skipped"> {
  const key = stageKey(stage.name, stage.version, stage.inputs);
  const recorded = readStageManifest(workDir).stages[stage.name];
  if (recorded?.key === key && stage.outputs.every((o) => existsSync(join(workDir, o)))) return "skipped";
  await stage.run();
  const manifest = readStageManifest(workDir);
  manifest.stages[stage.name] = { key, outputs: [...stage.outputs] };
  writeStageManifest(workDir, manifest);
  return "ran";
}
