// container_ownership — STE-605 (M_947c79) § 1 "One classifier".
//
// Reads saved tracker pages (Jira `searchJiraIssuesUsingJql`, Linear
// `list_issues`) into tickets and classifies each one against this
// repository's workspace binding (STE-602):
//   - `container` — a Jira Epic, or a Jira hierarchy level above the FR level;
//   - `ours`      — carries this repository's `repoTag`;
//   - `sibling`   — lacks it and carries a label that is neither a
//                   `milestone-` label nor one of this repository's default labels;
//   - `unowned`   — neither (hand-filed, or a client too old to tag).
// The back-link line `Source: specs/frs/<key>.md` is NOT ownership evidence —
// every toolkit version writes it — so it is only reported as a column.

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { readLocalFRBindings } from "./reconcile_tracker_local";
import { readTaskTrackingSection } from "./resolver_config";
import { announceReceipt, printable, writeReceipt } from "./tracker_receipts";
import { readWorkspaceBinding, type WorkspaceAdapterKey, type WorkspaceBinding } from "./workspace_binding";

export interface ContainerTicket {
  key: string;
  title: string;
  labels: string[];
  isContainer: boolean;
  project: string | null;
  creator: string | null;
  hasBackLink: boolean;
}

export type TicketClass = "ours" | "sibling" | "unowned" | "container" | "candidate";

const BACK_LINK_RE = /^Source: specs\/frs\/[^\s]+\.md\s*$/m;

function refuseField(field: string, key: string | undefined): never {
  throw new Error(`container page: required field \`${field}\` is missing on ticket ${key ?? "<unknown>"}`);
}

function requireShared(obj: Record<string, unknown>, fields: string[], key: string): void {
  for (const f of fields) if (obj[f] === undefined || obj[f] === null) refuseField(f, key);
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function labelsOf(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((l) => (typeof l === "string" ? l : str((l as { name?: unknown } | null)?.name)))
    .filter((l): l is string => typeof l === "string");
}

function nameOf(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return str(o["displayName"]) ?? str(o["name"]) ?? null;
  }
  return null;
}

/**
 * Read one saved page into tickets. When `shared`, ownership rests on
 * `labels`, `description` and the creator, so each is required on every ticket.
 */
export function normalizeContainerPage(json: unknown, adapter: WorkspaceAdapterKey, shared = false): ContainerTicket[] {
  const issues = (json as { issues?: unknown } | null)?.issues;
  if (!Array.isArray(issues)) throw new Error(`container page: no \`issues\` array (adapter=${adapter})`);
  return issues.map((raw) => {
    const row = raw as Record<string, unknown>;
    if (adapter === "jira") {
      const key = str(row["key"]);
      const fields = (row["fields"] ?? {}) as Record<string, unknown>;
      if (key === undefined) refuseField("key", undefined);
      const title = str(fields["summary"]);
      if (title === undefined) refuseField("summary", key);
      const type = fields["issuetype"] as { name?: unknown; hierarchyLevel?: unknown } | undefined;
      if (!type || str(type.name) === undefined) refuseField("issuetype", key);
      if (shared) requireShared(fields, ["labels", "description", "creator"], key);
      const level = typeof type.hierarchyLevel === "number" ? type.hierarchyLevel : 0;
      const description = typeof fields["description"] === "string" ? (fields["description"] as string) : "";
      return {
        key,
        title,
        labels: labelsOf(fields["labels"]),
        isContainer: type.name === "Epic" || level > 0,
        project: str((fields["project"] as { key?: unknown } | undefined)?.key) ?? null,
        creator: nameOf(fields["creator"]),
        hasBackLink: BACK_LINK_RE.test(description),
      };
    }
    const key = str(row["identifier"]) ?? str(row["id"]);
    if (key === undefined) refuseField("identifier", undefined);
    const title = str(row["title"]);
    if (title === undefined) refuseField("title", key);
    if (shared) requireShared(row, ["labels", "description", "createdBy"], key);
    const description = typeof row["description"] === "string" ? (row["description"] as string) : "";
    return {
      key,
      title,
      labels: labelsOf(row["labels"]),
      // Linear milestones are not issues: nothing on a Linear page is a container.
      isContainer: false,
      project: nameOf(row["project"]),
      creator: nameOf(row["createdBy"]),
      hasBackLink: BACK_LINK_RE.test(description),
    };
  });
}

/** Classify one ticket against this repository's binding. */
export function classifyTicket(ticket: ContainerTicket, binding: WorkspaceBinding): TicketClass {
  if (ticket.isContainer) return "container";
  if (!binding.shared || binding.repoTag === undefined) return "candidate";
  if (ticket.labels.includes(binding.repoTag)) return "ours";
  return foreignLabels(ticket, binding).length > 0 ? "sibling" : "unowned";
}

/** The labels that are neither `milestone-` labels nor this repository's default labels. */
export function foreignLabels(ticket: ContainerTicket, binding: WorkspaceBinding): string[] {
  const own = new Set(binding.defaultLabels ?? []);
  return ticket.labels.filter((l) => !l.startsWith("milestone-") && !own.has(l));
}

/** The tracker adapter of `projectRoot`'s CLAUDE.md; throws unless it is jira or linear. */
export function adapterOf(projectRoot: string): WorkspaceAdapterKey {
  const mode = readTaskTrackingSection(join(projectRoot, "CLAUDE.md"))["mode"];
  if (mode === "jira" || mode === "linear") return mode;
  throw new Error(`container_ownership: tracker mode "${mode ?? ""}" has no container pages (need jira or linear)`);
}

function cell(s: string): string {
  return printable(s).replace(/\|/g, "\\|");
}

export interface OrphanTicket extends ContainerTicket {
  cls: TicketClass;
  owner: string;
  offerable: boolean;
}

export interface OrphanListing {
  orphans: OrphanTicket[];
  counts: { read: number; ours: number; sibling: number; unowned: number; containers: number; bound: number; candidate: number };
  complete: boolean;
  summary: string;
}

const OFFERABLE: ReadonlySet<TicketClass> = new Set<TicketClass>(["ours", "unowned", "candidate"]);

/** The tickets no local FR binds, each classified, plus the summary line. `pages` are parsed page JSON. */
export function listOrphans(projectRoot: string, pages: unknown[]): OrphanListing {
  const adapter = adapterOf(projectRoot);
  const binding = readWorkspaceBinding(join(projectRoot, "CLAUDE.md"), adapter);
  const tickets = pages.flatMap((p) => normalizeContainerPage(p, adapter, binding.shared));
  const bound = new Set(readLocalFRBindings(join(projectRoot, "specs")).flatMap((b) => b.trackerIds));
  const counts = { read: 0, ours: 0, sibling: 0, unowned: 0, containers: 0, bound: 0, candidate: 0 };
  const orphans: OrphanTicket[] = [];
  for (const t of tickets) {
    counts.read += 1;
    if (bound.has(t.key)) {
      counts.bound += 1;
      continue;
    }
    const cls = classifyTicket(t, binding);
    if (cls === "container") counts.containers += 1;
    else counts[cls] += 1;
    orphans.push({ ...t, cls, owner: t.creator ?? "unknown", offerable: OFFERABLE.has(cls) });
  }
  const complete = pages.every((p) => {
    const j = (p ?? {}) as Record<string, unknown>;
    if (adapter === "jira") return j["isLast"] !== false;
    return (j["pageInfo"] as { hasNextPage?: unknown } | undefined)?.hasNextPage !== true;
  });
  const summary = `summary: read=${counts.read} ours=${counts.ours} sibling=${counts.sibling} (excluded) unowned=${counts.unowned} containers=${counts.containers} (excluded) bound=${counts.bound} complete=${complete}`;
  return { orphans, counts, complete, summary };
}

/** Read and parse one saved JSON file; a failure is prefixed with `label` and names the file. */
export function readJsonFile(path: string, label: string): unknown {
  let text: string;
  try {
    text = readFileSync(path, "utf-8");
  } catch (e) {
    throw new Error(`${label}: cannot read ${path}: ${(e as Error).message}`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (e) {
    throw new Error(`${label}: ${path} is not JSON: ${(e as Error).message}`);
  }
}

/** Read and parse every page before anything is listed; a failure names the file. */
export function readPages(pagePaths: string[]): unknown[] {
  return pagePaths.map((p) => readJsonFile(p, "container page"));
}

function runList(projectRoot: string, pagePaths: string[]): number {
  const pages = readPages(pagePaths);
  const listing = listOrphans(projectRoot, pages);
  const rows: string[] = ["| Key | Class | Owner | Toolkit-written | Title |", "|---|---|---|---|---|"];
  for (const t of listing.orphans) {
    rows.push(`| ${cell(t.key)} | ${t.cls} | ${cell(t.owner)} | ${t.hasBackLink ? "yes" : "no"} | ${cell(t.title)} |`);
  }
  console.log(rows.join("\n"));
  console.log(listing.summary);
  for (const t of listing.orphans) {
    if (t.offerable) console.log(printable(`options: Import ${t.key} | Skip ${t.key}`));
  }
  return 0;
}

/**
 * STE-605 — consent to import one listed key. Re-classifies the same pages; a
 * shared repository records an `import` receipt for `ours`/`unowned` only, an
 * undeclared one writes nothing. Any other key is refused with nothing written.
 */
function runConsent(projectRoot: string, key: string, pagePaths: string[]): number {
  const pages = readPages(pagePaths);
  const adapter = adapterOf(projectRoot);
  const binding = readWorkspaceBinding(join(projectRoot, "CLAUDE.md"), adapter);
  const ticket = pages.flatMap((p) => normalizeContainerPage(p, adapter, binding.shared)).find((t) => t.key === key);
  if (ticket === undefined) {
    console.error(printable(`consent: ${key} is not on the pages read; refusing`));
    return 1;
  }
  const cls = classifyTicket(ticket, binding);
  if (!OFFERABLE.has(cls)) {
    console.error(printable(`consent: ${key} is a ${cls} ticket; refusing`));
    return 1;
  }
  if (!binding.shared) return 0;
  const path = writeReceipt(resolve(projectRoot), {
    kind: "import",
    adapter,
    container: binding.project ?? binding.team ?? "",
    subject: key,
    decision: "import",
    evidence: { class: cls, labels: ticket.labels, hasBackLink: ticket.hasBackLink },
  });
  console.log(announceReceipt(path));
  return 0;
}

if (import.meta.main) {
  const [cmd, projectRoot, ...rest] = process.argv.slice(2);
  try {
    if (cmd === "list" && projectRoot !== undefined && rest.length > 0) process.exit(runList(projectRoot, rest));
    if (cmd === "consent" && projectRoot !== undefined && rest.length > 1) {
      const [key, ...pagePaths] = rest;
      process.exit(runConsent(projectRoot, key!, pagePaths));
    }
    console.error(
      "usage: container_ownership.ts list <projectRoot> <page.json>...\n       container_ownership.ts consent <projectRoot> <key> <page.json>...",
    );
    process.exit(2);
  } catch (e) {
    console.error(printable((e as Error).message));
    process.exit(1);
  }
}
