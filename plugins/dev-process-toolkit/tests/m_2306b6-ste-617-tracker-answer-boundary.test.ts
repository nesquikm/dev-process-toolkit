// M_2306b6 — the tracker-answer boundary pin.
//
// Every production module reads tracker answers through ONE module,
// adapters/_shared/src/tracker_answer.ts. This suite keeps it that way: no
// production `.ts` outside that module may carry the paging and wrapper tokens
// a tracker-answer reader needs (`isLast`, `hasNextPage`, `nextPageToken`,
// `endCursor`, `pageInfo`, a `nodes` read, an `identifier` read), except the
// files in EXEMPT, each with its exact count and a written reason. A new
// reader written next year therefore fails here unless it goes through the
// shared reader or earns a reasoned exemption.
//
// Limits, stated so a green pin is not read as more than it is:
//   - It is heuristic about TOKENS, not semantics. It catches a new reader that
//     mentions paging; it does not catch one that reads a shape by some other
//     spelling (a bare `.key` on an unwrapped answer, a `values` array).
//   - The semantic half is the enumeration recorded in STE-617 (every file
//     that references a tracker answer field was read and classified). That is
//     a point-in-time measurement; this pin is what stops it rotting.
//   - Comments are stripped before counting; string literals are not, because
//     a real read can be spelled `o["isLast"]`. Refusal text naming a field is
//     therefore counted and must be exempted with that reason.

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const READER = "adapters/_shared/src/tracker_answer.ts";
const TOKEN = /\bisLast\b|\bhasNextPage\b|\bnextPageToken\b|\bendCursor\b|\bpageInfo\b|\.nodes\b|["'`]nodes["'`]|\.identifier\b|["'`]identifier["'`]/g;

/** Source without block and line comments (a `//` after `:` — a URL — is kept). */
const stripComments = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
const tokenCount = (src: string): number => [...stripComments(src).matchAll(TOKEN)].length;

/** Every production `.ts` the boundary covers: shipped adapters, templates, hooks and scripts, tests excluded. */
function productionFiles(): string[] {
  const r = spawnSync("git", ["ls-files", "-co", "--exclude-standard", "--", "adapters", "templates", "hooks", "scripts"], { cwd: ROOT, encoding: "utf-8" });
  if (r.status !== 0) throw new Error(`git ls-files failed: ${r.stderr}`);
  return r.stdout.split("\n").filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
}

/** Files outside the reader that may carry the tokens, each with its exact count and why it is not a tracker-answer read. */
const EXEMPT: Readonly<Record<string, { count: number; reason: string }>> = {
  "adapters/_shared/src/attach_project_milestone.ts": {
    count: 2,
    reason: "`identifier` is the milestone identifier field of the module's own error class and of a resolution round, never a read of a tracker answer",
  },
  "adapters/_shared/src/repoint_tracker_binding.ts": {
    count: 3,
    reason: "the Jira statuses and labels inputs have no MCP tool that lists them; the session assembles them and claims completeness with `isLast: true`, which the command checks and marks as asserted, not proven (plus refusal text naming the fields)",
  },
  "adapters/_shared/src/sibling_release.ts": {
    count: 4,
    reason: "refusal and remedy text telling the operator which paging field proves the last page; the pages themselves are read through tracker_answer.ts",
  },
};

/** The boundary check over (path, source) pairs: every violation named. */
function boundaryViolations(files: ReadonlyArray<{ path: string; src: string }>, exempt = EXEMPT): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const { path, src } of files) {
    if (path === READER) continue;
    const n = tokenCount(src);
    const e = exempt[path];
    if (e) seen.add(path);
    if (n === 0 && !e) continue;
    if (!e) out.push(`${path}: ${n} tracker-answer token(s) outside ${READER}, with no exemption — read the answer through the shared reader`);
    else if (n !== e.count) out.push(`${path}: ${n} token(s), but its exemption records ${e.count} — a new read, or a stale exemption`);
  }
  for (const p of Object.keys(exempt)) if (!seen.has(p)) out.push(`${p}: exempted but not a production file any more — remove the stale exemption`);
  return out;
}

const FILES = productionFiles().map((path) => ({ path, src: readFileSync(join(ROOT, path), "utf-8") }));

describe("the tracker-answer boundary", () => {
  test("no production module outside tracker_answer.ts carries a tracker-answer token, save the reasoned exemptions", () => {
    expect(boundaryViolations(FILES)).toEqual([]);
  });

  test("every exemption carries a written reason", () => {
    for (const [p, e] of Object.entries(EXEMPT)) expect(e.reason.length, p).toBeGreaterThan(40);
  });

  test("CONTROL — the scan is not vacuous: the reader itself carries the tokens, and the covered set includes every module the enumeration named", () => {
    expect(tokenCount(readFileSync(join(ROOT, READER), "utf-8"))).toBeGreaterThan(5);
    const paths = new Set(FILES.map((f) => f.path));
    for (const p of [
      "adapters/_shared/src/create_idempotency_probe.ts",
      "adapters/_shared/src/container_ownership.ts",
      "adapters/_shared/src/tracker_local_reconciliation_drift.ts",
      "adapters/_shared/src/sibling_release.ts",
      "adapters/_shared/src/resolve_milestone_identity.ts",
      "adapters/_shared/src/ticket_ownership.ts",
      "adapters/_shared/src/import.ts",
      "adapters/_shared/src/attach_project_milestone.ts",
      "adapters/_shared/src/repoint_tracker_binding.ts",
      "adapters/_shared/src/shared_tracker_live_grader.ts",
      "adapters/_shared/src/next_free_milestone_number.ts",
      "adapters/jira/src/list_milestones.ts",
      "templates/hooks/_lib/hooks/pre-tracker-write-gate.ts",
    ]) expect(paths.has(p), p).toBe(true);
  });

  test("MUTATION — an `isLast` read added to a module outside the reader turns the pin red, naming that module", () => {
    const target = "adapters/_shared/src/create_idempotency_probe.ts";
    const mutated = FILES.map((f) => (f.path === target ? { ...f, src: `${f.src}\nexport const _probe = (page: { isLast: boolean }) => page.isLast;\n` } : f));
    const v = boundaryViolations(mutated);
    expect(v.length).toBe(1);
    expect(v[0]).toContain(target);
  });

  test("MUTATION — a wrapped-shape read (`.nodes`) added to the hook turns it red", () => {
    const target = "templates/hooks/_lib/hooks/pre-tracker-write-gate.ts";
    const mutated = FILES.map((f) => (f.path === target ? { ...f, src: `${f.src}\nconst _n = (a: { issues: { nodes: unknown[] } }) => a.issues.nodes;\n` } : f));
    expect(boundaryViolations(mutated).some((x) => x.startsWith(target))).toBe(true);
  });

  test("MUTATION — one more token in an EXEMPT file is a count mismatch, never absorbed by the exemption", () => {
    const target = "adapters/_shared/src/sibling_release.ts";
    const mutated = FILES.map((f) => (f.path === target ? { ...f, src: `${f.src}\nconst _h = (p: { hasNextPage: boolean }) => p.hasNextPage;\n` } : f));
    expect(boundaryViolations(mutated)).toEqual([expect.stringContaining(`${target}: 6 token(s), but its exemption records 4`)]);
  });

  test("MUTATION — a token inside a comment is not counted (the pin is about code, not prose)", () => {
    const target = "adapters/_shared/src/create_idempotency_probe.ts";
    const mutated = FILES.map((f) => (f.path === target ? { ...f, src: `${f.src}\n// pageInfo is never read here\n/* isLast, hasNextPage */\n` } : f));
    expect(boundaryViolations(mutated)).toEqual([]);
  });

  test("a stale exemption (a file that no longer exists) is named", () => {
    expect(boundaryViolations(FILES, { ...EXEMPT, "adapters/_shared/src/gone.ts": { count: 1, reason: "x".repeat(50) } })).toEqual([expect.stringContaining("gone.ts: exempted but not a production file")]);
  });
});
