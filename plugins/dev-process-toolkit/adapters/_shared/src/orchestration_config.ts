// readOrchestrationConfig — STE-463 helper that reads the `## Orchestration`
// section from a project's CLAUDE.md and returns a typed record.
//
// Schema (Schema L-style, alongside `## Task Tracking` / `## Docs`):
//
//     ## Orchestration
//
//     default_effort: <low|medium|high|xhigh|max|ultracode>
//     merge_policy: <offer|auto|never>
//
// Absent file, absent heading, or absent keys ⇒ defaults
// `{ defaultEffort: "ultracode", mergePolicy: "offer" }` — parallels the
// readDocsConfig convention where absence is not a hard failure. Unlike
// readDocsConfig, the argument is the PROJECT ROOT, not a file path;
// CLAUDE.md is resolved inside it.
//
// Values are matched literally against the closed sets — no case
// coercion, no quote stripping, no inference (`auto` is never inferred).
// Any value outside the set, and any unknown top-level key inside the
// block, refuses with `MalformedOrchestrationConfigError` whose message
// carries the NFR-10 canonical shape: a `CLAUDE.md:<line>` anchor plus
// Refusing: / Remedy: / Context: sub-lines.
//
// Pure file reads only — no git, no network, no child processes.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Closed set of legal `default_effort` values (shared authority for STE-464). */
export const EFFORT_LEVELS = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultracode",
] as const;

/** Closed set of legal `merge_policy` values (shared authority for STE-464). */
export const MERGE_POLICIES = ["offer", "auto", "never"] as const;

export type EffortLevel = (typeof EFFORT_LEVELS)[number];
export type MergePolicy = (typeof MERGE_POLICIES)[number];

export interface OrchestrationConfig {
  defaultEffort: EffortLevel;
  mergePolicy: MergePolicy;
}

const DEFAULTS: OrchestrationConfig = {
  defaultEffort: "ultracode",
  mergePolicy: "offer",
};

/**
 * Thrown when the `## Orchestration` block carries a value outside its
 * closed set or an unknown top-level key. The message follows the NFR-10
 * canonical refusal shape (`CLAUDE.md:<line>` anchor plus Refusing: /
 * Remedy: / Context: lines) so callers can render it verbatim.
 */
export class MalformedOrchestrationConfigError extends Error {
  readonly line: number;
  constructor(line: number, reason: string, remedy: string) {
    super(
      [
        `CLAUDE.md:${line} — malformed \`## Orchestration\` block`,
        `Refusing: ${reason}`,
        `Remedy: ${remedy}`,
        `Context: mode=orchestration-config, file=CLAUDE.md, line=${line}`,
      ].join("\n"),
    );
    this.name = "MalformedOrchestrationConfigError";
    this.line = line;
  }
}

/** Strip a leading UTF-8 BOM and normalize CRLF → LF (line count unchanged). */
function normalize(raw: string): string {
  return raw.replace(/^﻿/, "").replace(/\r\n/g, "\n");
}

/**
 * Validate `value` against a closed set; refuse in NFR-10 shape otherwise.
 * Mirrors the docs_config `parseBool` idiom — one throwing parse helper
 * shared by every recognized key.
 */
function requireMember<T extends string>(
  set: readonly T[],
  value: string,
  lineNo: number,
  key: string,
  noun: string,
): T {
  if (!(set as readonly string[]).includes(value)) {
    throw new MalformedOrchestrationConfigError(
      lineNo,
      `\`${key}: ${value}\` is not a legal ${noun}.`,
      `set ${key} to one of ${set.join(" | ")} ` +
        `(exact lowercase literal, unquoted).`,
    );
  }
  return value as T;
}

/**
 * Parse the `## Orchestration` section of `<projectRoot>/CLAUDE.md`.
 *
 * Section terminates at the next heading line (`# ` … `#### `) — the
 * same termination rule as readDocsConfig; Schema L requires flat
 * `key: value` pairs only.
 *
 * @throws MalformedOrchestrationConfigError on a value outside the
 * closed set or an unknown top-level key inside the block.
 */
export function readOrchestrationConfig(
  projectRoot: string,
): OrchestrationConfig {
  const claudeMdPath = join(projectRoot, "CLAUDE.md");
  if (!existsSync(claudeMdPath)) return { ...DEFAULTS };
  const md = normalize(readFileSync(claudeMdPath, "utf8"));
  const lines = md.split("\n");
  const startIdx = lines.findIndex((l) => l === "## Orchestration");
  if (startIdx < 0) return { ...DEFAULTS };

  const result: OrchestrationConfig = { ...DEFAULTS };
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^#{1,4} /.test(line)) break;
    const m = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    const [, key, rawValue] = m;
    const value = (rawValue ?? "").trim();
    const lineNo = i + 1;
    switch (key) {
      case "default_effort":
        result.defaultEffort = requireMember(
          EFFORT_LEVELS,
          value,
          lineNo,
          key,
          "effort level",
        );
        break;
      case "merge_policy":
        result.mergePolicy = requireMember(
          MERGE_POLICIES,
          value,
          lineNo,
          key,
          "merge policy",
        );
        break;
      default:
        throw new MalformedOrchestrationConfigError(
          lineNo,
          `unknown key \`${key}\` in the \`## Orchestration\` block ` +
            `(closed schema: default_effort, merge_policy).`,
          `remove \`${key}\` or rename it to a recognized key.`,
        );
    }
  }
  return result;
}
