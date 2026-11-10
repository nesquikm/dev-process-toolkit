// STE-733 (M_b2fdc0) — AC-STE-733.7: the mutation battery.
//
// Removing the spec-path rule, the HEAD equality, the digest check, the
// front-door rule, the Skill-call rule or the projects-root confinement must
// turn at least one NAMED leg red.
//
// Each row copies the plugin's adapters/ and templates/ (real files) plus its
// manifest to a temporary directory, applies ONE sited mutation with
// `mutateInRegion` (the anchor must occur exactly once in the file), and drives
// the row's named legs — the very legs the main suites run, from
// tests/_m_b2fdc0_ste733_fixture.ts — against the copy. A row is KILLED only
// when:
//   - every leg it names PASSES on the unmutated copy and FAILS on the mutant;
//   - at least one named leg is a twin of the guard's own category;
//   - every permit leg of the row's family still PASSES on the mutant, so a
//     mutation that breaks loading (every leg refusing) is never read as a kill.
//
// SITING THE ROWS (the implementer's half of this contract): `file`, `find`
// and `replace` are null until the shipped code exists. Site each row against
// the shipped code with ONE exact anchor and a replacement that removes only
// that rule. A null row FAILS, naming itself — the battery never passes
// vacuously. The guard ids, families and kill categories below are fixed by
// AC-STE-733.7 and must not be edited to make a row pass.
//
// The real tree is never mutated: `git status --porcelain` over the plugin is
// compared before and after.

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { mutateInRegion } from "./_sited-mutation";
import { cleanupTemps, commitLegs, PLUGIN_ROOT, relayLegs, tempDir, type Leg } from "./_m_b2fdc0_ste733_fixture";

setDefaultTimeout(900_000);

const ALL_LEGS = new Map<string, Leg>([...commitLegs(), ...relayLegs()].map((l) => [l.name, l]));

interface Row {
  id: "spec-path" | "head" | "digest" | "front-door" | "skill-call" | "projects-root";
  guard: string;
  family: "commit" | "pr";
  /** Relative to the plugin root; null until sited. */
  file: string | null;
  /** The exact anchor (occurs exactly once in `file`); null until sited. */
  find: string | null;
  replace: string | null;
  /** Full leg names (as in ALL_LEGS) the row turns red. */
  kills: string[];
}

/** The kill category each guard's row must hit (fixed by AC-STE-733.7). */
const CATEGORY: Readonly<Record<Row["id"], RegExp>> = {
  "spec-path": /^commit TWIN \(path\)/,
  head: /^pr TWIN \(head\)/,
  digest: /^pr TWIN \(digest\)/,
  "front-door": /^pr TWIN \(front door\)/,
  "skill-call": /^pr TWIN \(skill call\)/,
  "projects-root": /^pr TWIN \(projects root\)/,
};

/**
 * IMPLEMENTER: site `file` / `find` / `replace` for every row (and, if you
 * like, add kill legs of the same family). Do not change `id` or `family`, and
 * do not remove a row.
 */
const ROWS: Row[] = [
  {
    id: "spec-path",
    guard: "pre-commit-gate-check: every staged path satisfies isSpecPath",
    family: "commit",
    file: "adapters/_shared/src/archive_only_change.ts",
    find: "paths.length > 0 && paths.every(isSpecPath)",
    replace: "paths.length > 0",
    kills: [
      "commit TWIN (path) — a source file staged beside the spec edit",
      "commit TWIN (path) — a file under specs/ that SPEC_PATTERNS does not match",
    ],
  },
  {
    id: "head",
    guard: "relay: R.evidence.head equals HEAD, which equals the remote branch head",
    family: "pr",
    file: "templates/hooks/_lib/hooks/pre-pr-spec-review.ts",
    find: // One span: both halves of the equality (R.evidence.head = HEAD, HEAD = the remote head), everything between kept byte-for-byte.
    `    if (head === null) return false;
    const realRoot = real(root);
    const selfReal = real(selfTranscript);
    if (realRoot === null || selfReal === null) return false;
    const projects = dirname(dirname(selfReal));
    const store = receiptsRoot(realRoot);
    if (!existsSync(store)) return false;
    const target = {
      roots: [] as string[],
      receiptLeg: () => null,
      announcesReceipts: (command: string) => announcesGateReceiptFor(command, subject),
    };
    for (const session of readdirSync(store).sort()) {
      if (session === selfSession) continue;
      let receipts: ReturnType<typeof sessionReceiptFiles>;
      try {
        receipts = sessionReceiptFiles(realRoot, session);
      } catch {
        continue; // a path-unsafe store name keys no session
      }
      const candidates = receipts.filter(
        (r) =>
          r.record.kind === GATE_RECEIPT_KIND &&
          r.record.subject === subject &&
          typeof r.record.root === "string" &&
          real(r.record.root) === realRoot &&
          r.record.evidence?.head === head,
      );
      if (candidates.length === 0) continue;
      // The one network call, asked only once a local candidate exists: a store
      // holding no other session's receipt for HEAD never contacts the remote.
      if (!isRemoteHeadEqualToHead(root)) return false;`,
    replace: `    if (head === null) return false;
    const realRoot = real(root);
    const selfReal = real(selfTranscript);
    if (realRoot === null || selfReal === null) return false;
    const projects = dirname(dirname(selfReal));
    const store = receiptsRoot(realRoot);
    if (!existsSync(store)) return false;
    const target = {
      roots: [] as string[],
      receiptLeg: () => null,
      announcesReceipts: (command: string) => announcesGateReceiptFor(command, subject),
    };
    for (const session of readdirSync(store).sort()) {
      if (session === selfSession) continue;
      let receipts: ReturnType<typeof sessionReceiptFiles>;
      try {
        receipts = sessionReceiptFiles(realRoot, session);
      } catch {
        continue; // a path-unsafe store name keys no session
      }
      const candidates = receipts.filter(
        (r) =>
          r.record.kind === GATE_RECEIPT_KIND &&
          r.record.subject === subject &&
          typeof r.record.root === "string" &&
          real(r.record.root) === realRoot &&
          true,
      );
      if (candidates.length === 0) continue;`,
    kills: [
      "pr TWIN (head) — R.evidence.head is behind HEAD (HEAD equals the remote)",
      "pr TWIN (head) — the remote branch head is behind HEAD (R.evidence.head equals HEAD)",
    ],
  },
  {
    id: "digest",
    guard: "relay: the announced digest equals R's current bytes",
    family: "pr",
    file: "templates/hooks/_lib/hooks/pre-pr-spec-review.ts",
    find: "real(a.path) === path && a.digest === digest",
    replace: "real(a.path) === path",
    kills: [
      "pr TWIN (digest) — the announced digest is not R's",
      "pr TWIN (digest) — R was rewritten after it was announced",
    ],
  },
  {
    id: "front-door",
    guard: "relay: only a gate_receipt.ts front-door run's result announces R",
    family: "pr",
    file: "templates/hooks/_lib/session.ts",
    find: "return scan.announcements.filter((a) => a.line > firstCall);",
    replace: // Any `dpt-receipt:` line on any transcript record announces — echo output, a Read result, typed text — still after the first Skill call.
    "return (readTranscriptLines({ transcript_path: transcriptPath } as HookPayload) ?? []).flatMap((text, line) => [...text.matchAll(/dpt-receipt: (\\/[^\\s\"\\\\]+) sha256:([0-9a-f]{64})/g)].map((m) => ({ path: m[1]!, digest: m[2]!, line }))).filter((a) => a.line > firstCall);",
    kills: [
      "pr TWIN (front door) — the announcement is an echo's output",
      "pr TWIN (front door) — the announcement is a Read result",
      "pr TWIN (front door) — the announcement is a typed line",
    ],
  },
  {
    id: "skill-call",
    guard: "relay: a spec-review Skill tool_use precedes the announcement",
    family: "pr",
    file: "templates/hooks/_lib/session.ts",
    find: "return scan.announcements.filter((a) => a.line > firstCall);",
    replace: "return scan.announcements;",
    kills: [
      "pr TWIN (skill call) — no Skill call at all before the announcement",
      "pr TWIN (skill call) — the spec-review Skill call comes after the announcement",
    ],
  },
  {
    id: "projects-root",
    guard: "relay: S's transcript stays inside the projects root",
    family: "pr",
    file: "templates/hooks/_lib/hooks/pre-pr-spec-review.ts",
    find: "if (real(transcript) !== transcript || dirname(dirname(transcript)) !== projects) continue;",
    replace: "if (dirname(dirname(transcript)) !== projects) continue;",
    kills: [
      "pr TWIN (projects root) — S's slug directory is a symlink out of the projects root",
      "pr TWIN (projects root) — S's transcript file is a symlink out of the projects root",
    ],
  },
];

// ------------------------------------------------------------------ copies

function porcelain(): string {
  const p = Bun.spawnSync(["git", "-C", PLUGIN_ROOT, "status", "--porcelain", "--", "."], { stdout: "pipe", stderr: "pipe" });
  return p.stdout.toString();
}

/** A copy of the plugin's runtime tree (adapters/, templates/, manifest) as real files. */
function copyPlugin(label: string): string {
  const copy = join(tempDir(`mut-${label}`), "plugin");
  mkdirSync(copy, { recursive: true });
  for (const d of ["adapters", "templates", ".claude-plugin"]) cpSync(join(PLUGIN_ROOT, d), join(copy, d), { recursive: true, dereference: true });
  return copy;
}

let statusBefore = "";
let pristine = "";
beforeAll(() => {
  statusBefore = porcelain();
  pristine = copyPlugin("pristine");
});
afterAll(() => cleanupTemps());

// ------------------------------------------------------------------ tests

describe("AC-STE-733.7 — the battery's shape", () => {
  test("every guard has one row, naming known refusal legs of its own family and category", () => {
    expect(ROWS.map((r) => r.id).sort()).toEqual(Object.keys(CATEGORY).sort());
    for (const r of ROWS) {
      for (const k of r.kills) {
        const leg = ALL_LEGS.get(k);
        expect({ row: r.id, leg: k, known: leg !== undefined, family: leg?.family, expect: leg?.expect }).toEqual({
          row: r.id,
          leg: k,
          known: true,
          family: r.family,
          expect: "refuse",
        });
      }
      expect({ row: r.id, inCategory: r.kills.some((k) => CATEGORY[r.id].test(k)) }).toEqual({ row: r.id, inCategory: true });
    }
  });

  test("CONTROL — the unmutated copy passes every leg the battery uses", async () => {
    const used = new Set(ROWS.flatMap((r) => r.kills));
    for (const l of ALL_LEGS.values()) if (l.expect === "permit") used.add(l.name);
    const failures: string[] = [];
    for (const name of used) {
      const p = await ALL_LEGS.get(name)!.check(pristine);
      if (p !== null) failures.push(`${name}: ${p}`);
    }
    expect(failures).toEqual([]);
  });
});

describe("AC-STE-733.7 — removing one rule turns a named leg red", () => {
  for (const row of ROWS) {
    test(`${row.id} — ${row.guard}`, async () => {
      if (row.file === null || row.find === null || row.replace === null) {
        throw new Error(`row ${row.id} is not sited: set file/find/replace against the shipped code (one exact anchor, removing only this rule)`);
      }
      const mutant = copyPlugin(row.id);
      const target = join(mutant, row.file);
      if (!existsSync(target)) throw new Error(`row ${row.id}: ${row.file} does not exist`);
      const doc = readFileSync(target, "utf-8");
      writeFileSync(target, mutateInRegion(doc, 0, doc.length, row.find, row.replace, { label: `${row.id} in ${row.file}` }));

      // Not a load error: the family's permit legs still hold on the mutant.
      for (const l of ALL_LEGS.values()) {
        if (l.family !== row.family || l.expect !== "permit") continue;
        const p = await l.check(mutant);
        if (p !== null) throw new Error(`row ${row.id}: the mutant broke the permit leg "${l.name}" (a load error or an over-wide mutation, not a kill):\n${p}`);
      }
      // Killed: every named leg holds on the pristine copy and fails on the mutant.
      for (const k of row.kills) {
        const leg = ALL_LEGS.get(k)!;
        const before = await leg.check(pristine);
        if (before !== null) throw new Error(`row ${row.id}: "${k}" fails on the UNMUTATED copy:\n${before}`);
        const after = await leg.check(mutant);
        if (after === null) throw new Error(`row ${row.id} NOT KILLED: "${k}" still holds on the mutant`);
      }
    });
  }

  test("the real plugin tree was not mutated (git status unchanged)", () => {
    expect(porcelain()).toBe(statusBefore);
  });
});
