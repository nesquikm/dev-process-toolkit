// ticket_ownership — STE-606 (M_947c79) § 1 "The ownership decision".
//
// Decides whether ONE fetched ticket (Jira `getJiraIssue`, Linear `get_issue`)
// is this repository's before /implement imports or claims it. Classification
// reuses STE-605's `normalizeContainerPage` + `classifyTicket`; the FR
// bindings counted are only those TRACKED in the git index (an import writes
// its FR file before it syncs, so a file merely on disk proves nothing).
//
// Verdicts:
//   - `container`       — refused in every mode;
//   - `owned`           — a tracked FR file binds the key (whatever the project),
//                         or shared and the ticket carries this repo's tag, or
//                         undeclared and the project matches;
//   - `foreign-project` — not tracked-bound, project/team differs: refused;
//   - `foreign-repo`    — shared, not tracked-bound, classified `sibling`: refused;
//   - `unowned`         — shared, not tracked-bound, classified `unowned`:
//                         allowed only after an explicit adopt question.

import { join, resolve } from "node:path";
import { adapterOf, classifyTicket, normalizeContainerPage, readJsonFile } from "./container_ownership";
import { trackerIdsOf } from "./reconcile_tracker_local";
import { announceReceipt, writeReceipt } from "./tracker_receipts";
import { readWorkspaceBinding, type WorkspaceAdapterKey, type WorkspaceBinding } from "./workspace_binding";

export type OwnershipVerdict = "owned" | "foreign-project" | "container" | "foreign-repo" | "unowned";

export interface OwnershipDecision {
  verdict: OwnershipVerdict;
  key: string;
  /** Number of FR bindings read from tracked files under specs/frs/ and specs/frs/archive/. */
  tracked: number;
  reason: string;
  /** Present only for `unowned`: the adopt question's option labels. */
  options?: string[];
  /** Present when the tracked-binding read could not consult git. */
  git?: string;
}

export const REFUSED_VERDICTS: ReadonlySet<OwnershipVerdict> = new Set<OwnershipVerdict>([
  "foreign-project",
  "container",
  "foreign-repo",
]);

export interface TrackedBindings {
  ids: Set<string>;
  count: number;
  gitError?: string;
}

/** FR bindings from files `git ls-files` lists under specs/frs/ and specs/frs/archive/. */
export function readTrackedBindings(projectRoot: string): TrackedBindings {
  const proc = Bun.spawnSync(["git", "-C", projectRoot, "ls-files", "-z", "--", "specs/frs"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) {
    const err = proc.stderr.toString().trim();
    return { ids: new Set(), count: 0, gitError: /not a git repository/i.test(err) ? "not a git repository" : err || "git ls-files failed" };
  }
  // The COMMITTED bytes (the index blob `:<path>`), never the working tree: a
  // tracked FR file edited on disk to bind a new key must not vouch for it,
  // exactly as a new untracked import file must not.
  const listed = proc.stdout
    .toString()
    .split("\0")
    // No control characters: a name carrying LF would desync the LF-framed
    // `--batch` requests below (and no FR file is named that way).
    .filter((p) => /^specs\/frs\/(archive\/)?[^/\x00-\x1f]+\.md$/.test(p));
  const ids = new Set<string>();
  let count = 0;
  if (listed.length === 0) return { ids, count };
  // ONE `git cat-file --batch` for every blob, not one `git show` per file: an
  // archive holds hundreds of FRs and the decision runs on every decide and
  // every confirm. Its framing is `<sha> blob <size>\n<bytes>\n` per request,
  // or `<request> missing\n` — sizes are BYTES, so the buffer is sliced, not
  // the decoded string.
  const batch = Bun.spawnSync(["git", "-C", projectRoot, "cat-file", "--batch"], {
    stdin: new TextEncoder().encode(listed.map((p) => `:${p}\n`).join("")),
    stdout: "pipe",
    stderr: "pipe",
  });
  if (batch.exitCode !== 0) {
    return { ids, count: 0, gitError: batch.stderr.toString().trim() || "git cat-file failed" };
  }
  const out = batch.stdout;
  const decoder = new TextDecoder();
  const unread: string[] = [];
  let at = 0;
  for (const path of listed) {
    const eol = out.indexOf(10, at);
    if (eol < 0) {
      unread.push(path);
      continue;
    }
    const header = decoder.decode(out.subarray(at, eol));
    at = eol + 1;
    // A full object id (SHA-1 or SHA-256), so a misaligned read can never
    // parse a partial id as a header and quietly re-synchronise.
    const m = /^(?:[0-9a-f]{40}|[0-9a-f]{64}) blob (\d+)$/.exec(header);
    if (!m) {
      unread.push(path);
      continue;
    }
    const size = Number(m[1]);
    const trackerIds = trackerIdsOf(decoder.decode(out.subarray(at, at + size)));
    at += size + 1;
    if (trackerIds.length > 0) count += 1;
    for (const id of trackerIds) ids.add(id);
  }
  // Fail-safe (a blob that could not be read never vouches) and NAMED: a
  // missing binding is diagnosable instead of reading as someone else's ticket.
  return unread.length > 0 ? { ids, count, gitError: `could not read committed ${unread.join(", ")}` } : { ids, count };
}

function nameOf(v: unknown): string | null {
  if (typeof v === "string" && v.length > 0) return v;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    for (const k of ["key", "name", "displayName"]) {
      if (typeof o[k] === "string" && (o[k] as string).length > 0) return o[k] as string;
    }
  }
  return null;
}

/** Why the ticket's project (or Linear team) differs from the binding, or null when it matches. */
function projectMismatch(
  adapter: WorkspaceAdapterKey,
  project: string | null,
  rawTicket: Record<string, unknown>,
  binding: WorkspaceBinding,
): string | null {
  if (binding.project !== undefined && project !== binding.project) {
    return `ticket project ${project ?? "<none>"} differs from this repository's ${binding.project}`;
  }
  if (adapter === "linear" && binding.team !== undefined) {
    const team = nameOf(rawTicket["team"]);
    // An absent team cannot be compared, so it cannot be proven this team's.
    if (team === null) return `ticket carries no team to compare with this repository's ${binding.team}`;
    if (team !== binding.team) return `ticket team ${team} differs from this repository's ${binding.team}`;
  }
  return null;
}

/** Decide ownership of one fetched ticket. Throws on unreadable input. */
export function decideTicketOwnership(input: {
  projectRoot: string;
  ticket: unknown;
  binding?: WorkspaceBinding;
}): OwnershipDecision {
  const projectRoot = resolve(input.projectRoot);
  const adapter = adapterOf(projectRoot);
  const binding = input.binding ?? readWorkspaceBinding(join(projectRoot, "CLAUDE.md"), adapter);
  if (!input.ticket || typeof input.ticket !== "object") throw new Error("ticket_ownership: ticket is not a JSON object");
  const raw = input.ticket as Record<string, unknown>;
  const [ticket] = normalizeContainerPage({ issues: [raw] }, adapter, binding.shared);
  if (ticket === undefined) throw new Error("ticket_ownership: no ticket read");
  if (ticket.project === null) throw new Error(`ticket_ownership: required field \`project\` is missing on ticket ${ticket.key}`);
  const cls = classifyTicket(ticket, binding);
  // A container is refused whatever binds it, so it never pays the git read.
  if (cls === "container") {
    return { key: ticket.key, tracked: 0, verdict: "container", reason: `${ticket.key} is a container (Epic); refused` };
  }
  const tracked = readTrackedBindings(projectRoot);
  const base = { key: ticket.key, tracked: tracked.count, ...(tracked.gitError ? { git: tracked.gitError } : {}) };

  if (tracked.ids.has(ticket.key)) {
    return { ...base, verdict: "owned", reason: `a tracked FR file in this repository binds ${ticket.key}` };
  }
  const mismatch = projectMismatch(adapter, ticket.project, raw, binding);
  if (mismatch !== null) return { ...base, verdict: "foreign-project", reason: `${mismatch}; refused` };
  if (cls === "ours") return { ...base, verdict: "owned", reason: `${ticket.key} carries this repository's tag ${binding.repoTag}` };
  if (cls === "sibling") {
    return {
      ...base,
      verdict: "foreign-repo",
      reason: `${ticket.key} belongs to a sibling repository (labels: ${ticket.labels.join(", ")}); refused — run from the owning repository, or have a person relabel the ticket in the tracker`,
    };
  }
  if (cls === "unowned") {
    return {
      ...base,
      verdict: "unowned",
      reason: `${ticket.key} carries no repository tag; adopt only after an explicit question`,
      options: [`Adopt ${ticket.key}`, `Skip ${ticket.key}`],
    };
  }
  return { ...base, verdict: "owned", reason: "undeclared repository and the project matches" };
}

function readTicket(path: string): unknown {
  return readJsonFile(path, "ticket_ownership");
}

function runDecide(projectRoot: string, ticketPath: string): number {
  const decision = decideTicketOwnership({ projectRoot, ticket: readTicket(ticketPath) });
  console.log(JSON.stringify(decision));
  return 0;
}

function runConfirm(projectRoot: string, key: string, ticketPath: string, adopt: boolean): number {
  const root = resolve(projectRoot);
  const adapter = adapterOf(root);
  const binding = readWorkspaceBinding(join(root, "CLAUDE.md"), adapter);
  const decision = decideTicketOwnership({ projectRoot: root, ticket: readTicket(ticketPath), binding });
  if (decision.key !== key) {
    console.error(`confirm: ticket file is ${decision.key}, not ${key}; refusing`);
    return 1;
  }
  if (REFUSED_VERDICTS.has(decision.verdict)) {
    console.error(`confirm: ${key} is ${decision.verdict}: ${decision.reason}`);
    return 1;
  }
  if (decision.verdict === "unowned" && !adopt) {
    console.error(`confirm: ${key} is unowned; confirm requires --adopt after the adopt question`);
    return 1;
  }
  if (!binding.shared) return 0;
  const path = writeReceipt(root, {
    kind: "binding",
    adapter,
    container: binding.project ?? binding.team ?? "",
    subject: key,
    decision: decision.verdict === "unowned" ? "adopt" : "owned",
    evidence: { verdict: decision.verdict, tracked: decision.tracked },
  });
  console.log(announceReceipt(path));
  return 0;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const adopt = argv.includes("--adopt");
  const [cmd, ...args] = argv.filter((a) => a !== "--adopt");
  try {
    if (cmd === "decide" && args.length === 2) process.exit(runDecide(args[0]!, args[1]!));
    if (cmd === "confirm" && args.length === 3) process.exit(runConfirm(args[0]!, args[1]!, args[2]!, adopt));
    console.error(
      "usage: ticket_ownership.ts decide <projectRoot> <ticket.json>\n       ticket_ownership.ts confirm <projectRoot> <key> <ticket.json> [--adopt]",
    );
    process.exit(2);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}
