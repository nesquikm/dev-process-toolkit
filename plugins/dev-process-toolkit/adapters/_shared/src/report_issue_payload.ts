// report_issue_payload — STE-720 (M_d1b4b7).
//
// Front door of the identifier pass: runs `scrubIdentifiers` over every file of
// a /report-issue working directory with one alias map for the whole run.
// git is called through PATH.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { IDENTIFIER_PATTERNS, type ScrubMatch, createAliasMap, scrubIdentifiers } from "./scrub_identifiers";
import { type AliasMap, type SessionAlias, seedAliasMap } from "./session_aliases";

export interface PayloadContext {
  home?: string;
  /** Branches from the repository's refs; field values are added per run. */
  branches: readonly string[];
  aliases: AliasMap;
}

function forEachRef(projectRoot: string, ns: string): string[] {
  const p = spawnSync("git", ["for-each-ref", "--format=%(refname:lstrip=2)", ns], { cwd: projectRoot, encoding: "utf-8", env: process.env });
  if (p.status !== 0) return [];
  return (p.stdout ?? "").split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
}

/** Every local and remote-tracking branch, the remote name stripped. */
export function repoBranches(projectRoot: string): string[] {
  const local = forEachRef(projectRoot, "refs/heads");
  const remote = forEachRef(projectRoot, "refs/remotes")
    .map((r) => r.slice(r.indexOf("/") + 1))
    .filter((r, i, all) => r.length > 0 && all.indexOf(r) === i);
  return [...new Set([...local, ...remote])];
}

const FIELD_RE = /"(?:gitBranch|git_branch)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;

/** Every `gitBranch` / `git_branch` value in `text`. */
export function fieldBranches(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(FIELD_RE)) {
    try {
      out.push(JSON.parse(`"${m[1]}"`));
    } catch {
      out.push(m[1]!);
    }
  }
  return out;
}

export function scrubPayloadDir(dir: string, ctx: PayloadContext): void {
  const files = readdirSync(dir)
    .sort()
    .filter((f) => statSync(join(dir, f)).isFile());
  const texts = new Map(files.map((f) => [f, readFileSync(join(dir, f), "utf-8")]));
  const branches = new Set(ctx.branches);
  for (const t of texts.values()) for (const b of fieldBranches(t)) branches.add(b);
  const scrubCtx = { home: ctx.home, branches: [...branches], aliases: ctx.aliases };
  const totals: ScrubMatch[] = IDENTIFIER_PATTERNS.map((p) => ({ pattern: p.key, count: 0 }));
  const scrubbedTexts = new Map<string, string>();
  for (const [f, t] of texts) {
    const r = scrubIdentifiers(t, scrubCtx);
    r.matches.forEach((m, i) => (totals[i]!.count += m.count));
    scrubbedTexts.set(f, r.scrubbed);
  }
  const meta = scrubbedTexts.get("metadata.json");
  if (meta !== undefined) scrubbedTexts.set("metadata.json", appendIdentifierRows(meta, totals));
  for (const [f, t] of scrubbedTexts) if (t !== texts.get(f)) writeFileSync(join(dir, f), t);
}

/** The identifier rows go after the seven secret rows of `redaction_summary`. */
function appendIdentifierRows(metadataText: string, rows: readonly ScrubMatch[]): string {
  const meta = JSON.parse(metadataText);
  const summary = Array.isArray(meta.redaction_summary) ? meta.redaction_summary : [];
  meta.redaction_summary = [...summary, ...rows];
  return `${JSON.stringify(meta, null, 2)}\n`;
}

/** The `sessions` list of the working directory's `retro.json`; none when it is absent. */
export function retroSessions(dir: string): SessionAlias[] {
  const p = join(dir, "retro.json");
  if (!existsSync(p)) return [];
  const sessions = JSON.parse(readFileSync(p, "utf-8")).sessions;
  return Array.isArray(sessions) ? sessions : [];
}

if (import.meta.main) {
  const [workdir, projectRoot, ...flags] = process.argv.slice(2);
  const flagged = flags.includes("--redact-identifiers") || flags.includes("--from-retro");
  if (!workdir || !projectRoot || !flagged) {
    process.stderr.write(
      [
        "report_issue_payload: no mode flag given; nothing was scrubbed.",
        "Remedy: pass --redact-identifiers or --from-retro.",
        "Context: usage: bun run report_issue_payload.ts <workdir> <projectRoot> (--redact-identifiers | --from-retro)",
        "",
      ].join("\n"),
    );
    process.exit(1);
  }
  const aliases = createAliasMap();
  if (flags.includes("--from-retro")) seedAliasMap(aliases, retroSessions(workdir));
  scrubPayloadDir(workdir, { home: homedir(), branches: repoBranches(projectRoot), aliases });
}
