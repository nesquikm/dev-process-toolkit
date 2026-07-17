// M108 STE-391 — seed entry: retired permission shapes (AC-STE-391.6).
//
// Detects glob-shaped `Bash(<cmd> *)` rules in `permissions.allow` and
// `{"transport": ...}`-shaped `.mcp.json` server entries — both retired in
// v2.7.0 (STE-209). This entry rewrites the user's security configuration, so
// it NEVER auto-applies: `requires_explicit_approval` gates it on per-entry
// operator approval even when the auto-approve marker is present. The retired
// shapes come exclusively from `../legacy_paths` (AC-STE-391.1).
//
// PROJECTED, NOT INVENTED: the replacement rules are read out of the shipped
// `templates/permissions.json` — the same source `/setup` writes from — so a
// migrated tree lands on exactly the allowlist a fresh bootstrap would produce.
// A glob the template knows nothing about has no projection; see `applyGlobs`.

import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { PermissionsTemplate } from "../../setup/merge_settings";
import { readJsonObject, settingsPath, writeJsonIfChanged } from "../consumer_files";
import type { ApplyResult, DetectResult, MigrationEntry } from "../index";
import {
  LEGACY_MCP_TRANSPORT_KEY,
  isLegacyGlobBashRule,
  legacyGlobBashCommand,
} from "../legacy_paths";

/** The canonical remote-server shape v2.7.0 moved to: `{"type": "http"}`. */
const CANONICAL_TYPE_KEY = "type";
const CANONICAL_REMOTE_TYPE = "http";

interface Settings {
  permissions?: { allow?: unknown; [key: string]: unknown };
  [key: string]: unknown;
}

function mcpPath(projectRoot: string): string {
  return join(projectRoot, ".mcp.json");
}

/** The `permissions.allow` list, or null when there is nothing shaped like one. */
function allowRules(settings: Settings | null): string[] | null {
  const allow = settings?.permissions?.allow;
  return Array.isArray(allow) ? (allow as string[]) : null;
}

/** The `mcpServers` map, or null when there is nothing shaped like one. */
function mcpServers(mcp: Record<string, unknown> | null): Record<string, unknown> | null {
  const servers = mcp?.mcpServers;
  if (typeof servers !== "object" || servers === null || Array.isArray(servers)) return null;
  return servers as Record<string, unknown>;
}

/** Does this server entry carry the retired `transport` key? */
function isLegacyServer(server: unknown): server is Record<string, unknown> {
  return (
    typeof server === "object" &&
    server !== null &&
    !Array.isArray(server) &&
    LEGACY_MCP_TRANSPORT_KEY in server
  );
}

/**
 * Shared by the entry's `detect` and its `apply` guard, so "did this fire?" and
 * "is there anything left to do?" can never answer differently. Module-level
 * rather than a method, so `apply` never depends on a `this` binding.
 */
function detectPermissionShapes(projectRoot: string): DetectResult {
  const evidence: string[] = [];

  const settingsRel = relative(projectRoot, settingsPath(projectRoot));
  for (const rule of allowRules(readJsonObject(settingsPath(projectRoot))) ?? []) {
    // Quote the rule as READ, never as composed: the evidence has to name the
    // operator's actual rule for them to recognize it in an approval preview.
    if (typeof rule === "string" && isLegacyGlobBashRule(rule)) {
      evidence.push(
        `${settingsRel} → permissions.allow carries the glob rule "${rule}" (retired in v2.7.0; the harness denies glob-shaped Bash rules)`,
      );
    }
  }

  const mcpRel = relative(projectRoot, mcpPath(projectRoot));
  for (const [name, server] of Object.entries(mcpServers(readJsonObject(mcpPath(projectRoot))) ?? {})) {
    if (isLegacyServer(server)) {
      evidence.push(
        `${mcpRel} → server "${name}" uses the retired "${LEGACY_MCP_TRANSPORT_KEY}" entry shape (retired in v2.7.0; /doctor rejects it against the MCP schema)`,
      );
    }
  }

  return { applies: evidence.length > 0, evidence };
}

/**
 * The shipped permissions template — `/setup`'s own projection source. Resolved
 * relative to THIS module's location, not the caller's projectRoot: the tree
 * being migrated is the consumer's and carries no templates of its own.
 * `adapters/_shared/src/migrations/entries/` sits five levels below the plugin
 * root, where `templates/` lives.
 */
function readPermissionsTemplate(): PermissionsTemplate {
  const path = join(import.meta.dir, "..", "..", "..", "..", "..", "templates", "permissions.json");
  return JSON.parse(readFileSync(path, "utf-8")) as PermissionsTemplate;
}

/**
 * The explicit-subcommand rules that replace one retired glob, in template
 * order and deduped.
 *
 * Two projection routes, narrowest first:
 *  1. the template's own stack group for that command (`Bash(bun *)` → every
 *     rule under `stacks.bun`, `Bash(bunx)` included — the glob asked for that
 *     toolchain and the template is what declares its shape);
 *  2. otherwise, every rule the template declares FOR that command across
 *     `_common` and the stack groups (`Bash(git *)` → the read-only git rules).
 *
 * `_writes` is deliberately excluded from route 2: the template documents it as
 * a set `/setup` does NOT pre-emit, because destructive ops stay grantable
 * per-skill at first use. A migration silently re-granting `Bash(git push)` off
 * the back of a glob would widen the operator's security config, and this entry
 * only ever narrows it.
 */
function projectGlobRule(template: PermissionsTemplate, rule: string): string[] {
  const command = legacyGlobBashCommand(rule);
  if (command === null) return [];

  // `command` is the consumer's own (untrusted) rule text. A prototype-named
  // command like `__proto__` / `constructor` would resolve through the chain to
  // a non-array and crash `new Set(...)`, so only own array-valued groups count.
  const ownGroup = Object.hasOwn(template.stacks, command) ? template.stacks[command] : undefined;
  const stackGroup = Array.isArray(ownGroup) ? ownGroup : undefined;
  const candidates =
    stackGroup ??
    [...template._common, ...Object.values(template.stacks).flat()].filter(
      (candidate) => candidate.startsWith(`Bash(${command} `) || candidate === `Bash(${command})`,
    );

  return [...new Set(candidates)];
}

/**
 * Rewrite the glob rules in `.claude/settings.json`. Each glob is replaced, in
 * its own position, by its projection; every other rule — and every other key,
 * `deny` included — is handed back untouched.
 */
function applyGlobs(projectRoot: string, changed: string[], notes: string[]): void {
  const path = settingsPath(projectRoot);
  const settings = readJsonObject(path) as Settings | null;
  const rules = allowRules(settings);
  if (settings === null || rules === null) return;

  const template = readPermissionsTemplate();
  const seen = new Set<string>();
  const rewritten: string[] = [];
  let replaced = 0;

  for (const rule of rules) {
    if (typeof rule !== "string" || !isLegacyGlobBashRule(rule)) {
      // Not ours: a non-glob rule (or a non-string the operator hand-wrote)
      // passes through exactly as read.
      if (!seen.has(rule as string)) {
        seen.add(rule as string);
        rewritten.push(rule);
      }
      continue;
    }

    replaced++;
    const projection = projectGlobRule(template, rule);
    // A glob the template cannot project still goes: the harness denies the
    // shape outright, so leaving it would leave a rule that grants nothing and
    // re-fires this detector forever. It is named in the summary rather than
    // swapped for an invented rule — the projection source is the template.
    if (projection.length === 0) {
      notes.push(`"${rule}" had no projection in templates/permissions.json and was dropped`);
      continue;
    }
    for (const projected of projection) {
      if (seen.has(projected)) continue;
      seen.add(projected);
      rewritten.push(projected);
    }
  }

  if (replaced === 0) return;

  // Assigning the existing keys in place preserves their position.
  settings.permissions = { ...settings.permissions, allow: rewritten };
  if (writeJsonIfChanged(path, settings)) changed.push(relative(projectRoot, path));
}

/**
 * Rewrite the transport-shaped servers in `.mcp.json`. The stdio schema branch
 * (`command`/`args`) carries no `transport` key, so it never matches and
 * survives byte-for-byte.
 */
function applyMcpShapes(projectRoot: string, changed: string[]): void {
  const path = mcpPath(projectRoot);
  const mcp = readJsonObject(path);
  const servers = mcpServers(mcp);
  if (mcp === null || servers === null) return;

  let rewrote = 0;
  for (const [name, server] of Object.entries(servers)) {
    if (!isLegacyServer(server)) continue;
    rewrote++;

    // Drop the retired key and mint the canonical one in its slot, so the
    // entry's remaining keys keep their order. A server that somehow already
    // declares `type` keeps the operator's value — only `transport` goes.
    const declaresType = CANONICAL_TYPE_KEY in server;
    const canonical: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(server)) {
      if (key !== LEGACY_MCP_TRANSPORT_KEY) canonical[key] = value;
      else if (!declaresType) canonical[CANONICAL_TYPE_KEY] = CANONICAL_REMOTE_TYPE;
    }
    servers[name] = canonical;
  }

  if (rewrote === 0) return;
  if (writeJsonIfChanged(path, mcp)) changed.push(relative(projectRoot, path));
}

export const permissionShapes: MigrationEntry = {
  id: "permission-shapes",
  introduced_in: "2.7.0",
  title: "Rewrite retired glob-shaped Bash allow rules and transport-shaped .mcp.json entries",
  kind: "script",
  requires_explicit_approval: true,
  detect: detectPermissionShapes,
  apply(projectRoot): ApplyResult {
    // Re-apply is a no-op by construction: with nothing left to detect there is
    // nothing to heal, so we never touch either file — not even to reformat it.
    if (!detectPermissionShapes(projectRoot).applies) {
      return { changed: [], summary: "No retired permission shapes found — nothing to do." };
    }

    const changed: string[] = [];
    const notes: string[] = [];
    applyGlobs(projectRoot, changed, notes);
    applyMcpShapes(projectRoot, changed);

    const summary = [
      `Rewrote retired v2.7.0 permission shapes (${changed.join(", ")}): glob-shaped Bash rules become the explicit-subcommand allowlist projected from templates/permissions.json, and transport-shaped .mcp.json servers become the canonical {"type": "${CANONICAL_REMOTE_TYPE}"} shape. Every other setting is preserved.`,
      ...notes,
    ].join(" ");

    return { changed, summary };
  },
};
