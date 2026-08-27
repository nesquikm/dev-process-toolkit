// M136 STE-531 — the skip-baseline order is proven to FIRE, not merely reachable.
//
// THE GAP THIS FILE EXISTS OVER. `runModuleReachabilityProbe` classifies both
// skip-baseline ordering surfaces as `ordered` and `reachable: true`, and it is
// RIGHT: the module it names can be run. What that certificate does not say is
// whether the order naming it will ever be GIVEN. At 9b420ec both orders were
// unable to fire in this project at all — one stood inside a paragraph
// conditioned on a key this repository does not set, the other after a branch
// creation an already-acceptable branch never performs — and the reachability
// row was green throughout. The certificate was true and the conclusion drawn
// from it was false.
//
// WHAT EACH BLOCK PINS, and why it is shaped the way it is.
//
//   AC.1  THE MEASURED GAP, AS HISTORY. The numbers are stated OF COMMIT
//         9b420ec and are asserted there — a `git archive` copy of that tree,
//         graded by THAT tree's own probe, because the pin has since moved and
//         today's probe would grade the old tree against a number that did not
//         exist yet. The block also asserts the numbers are NOT true of the
//         working tree, so a later "fix" that re-points them at HEAD reds
//         instead of quietly turning a historical record into a live claim.
//
//   AC.2  FIRES-HERE, BY EXECUTION. The verdict comes from running the surface's
//         own ordered command in a throwaway project carrying a CLAUDE.md and
//         reading the record back OFF DISK. BEHAVIOUR, NOT VOCABULARY is proven
//         two ways: the deciding functions' own source is asserted to contain no
//         `branch_template`, no phrase list and no proximity window; and every
//         carrier phrase is STRIPPED out of the surface's prose, leaving the
//         fence byte-identical, after which the verdict must be unchanged. A
//         detector built from an enumeration inherits the enumeration's blind
//         spot — the same blind spot that hides `implement_report_evidence.ts`
//         from probe #81 today (AC.5).
//
//   AC.3  FALSIFIABLE IN BOTH DIRECTIONS, ONCE PER SURFACE. The conditional is
//         restored to a COPY of each shipped surface — never to the shipped file
//         — in its EXECUTABLE form, a `branch_template:` guard on the ordered
//         command, and the verdict must flip to NOT-FIRES for that surface
//         alone. The restoration goes through `mutateInRegion`, which aborts
//         loudly when its anchor is absent, so a mutation that never applied
//         cannot score as a pass. A key-setting fixture and a key-omitting one
//         BOTH fire against the shipped surfaces, so the check is not merely
//         detecting the key's absence; against the guarded copy only the
//         key-setting one fires, which is what proves the check reads the thing
//         it claims to read.
//
//         NAMED RESIDUAL, recorded rather than papered over: execution can only
//         see a conditional that is itself executable. A conditional restored as
//         PROSE around a still-runnable fence is invisible here, and is held by
//         STE-528's scope predicates instead (`AC-STE-528.1` / `.2`). The two
//         halves are complementary; neither is the other's substitute. This is
//         the same class of limit AC.5 orders written down for reachability.
//
//   AC.4  THE PIN, RE-MEASURED. `ORDERED_UNREACHABLE_PIN` moved 142 → 139 under
//         STE-527, when `skip_baseline.ts` gained a `./branch_proposal` import
//         and three previously-unreachable ordered refs became reachable. That
//         was NOT work done in this FR and is recorded as already-landed. What
//         this FR owes is a RE-MEASUREMENT after its own surface edits: the
//         count is asserted equal to the pin rather than assumed, so an AC.5
//         note that lands in a scanned markdown tree and adds an ordered
//         reference reds here. The pin is also asserted never to have been
//         RAISED, and every shipped surface that states the pinned count in
//         prose must state the CURRENT one — measured today at
//         `skills/gate-check/SKILL.md` § "Registering a probe", which still
//         says 142.
//
//   AC.5  THE LIMIT, WRITTEN DOWN. Both halves, on a surface that documents the
//         reachability rule:
//           (a) `reachable` answers whether the module CAN BE RUN, and does not
//               answer whether the order naming it will ever be given;
//           (b) `descriptive` can HIDE an unreachable module the reader is
//               nonetheless expected to use.
//         Half (b) is not decorative. Measured this milestone:
//         `adapters/_shared/src/implement_report_evidence.ts` — the renderer of
//         every `/implement` report's `## Verification evidence` section — has
//         NO entry point and NO non-test importer, so it is unreachable by the
//         shipped rule; and probe #81 never flags it, because both references to
//         it (`skills/implement/SKILL.md:284`, `docs/implement-reference.md:229`)
//         score `descriptive`: "render … through … from" carries none of the
//         ORDER_PHRASES. The instance is pinned here alongside the note.
//
//   AC.6  NON-VACUOUS. Every positive verdict is the record read back off disk.
//         The grader is proven to REJECT a command that exits 0 and writes
//         nothing, to report nothing once the store is deleted from a successful
//         run, and not to mistake an empty store file for a record — and to
//         ignore the exit code in both directions, since the guarded fence in
//         AC.3 exits non-zero precisely when it correctly declines.
//
//   AC.7  NO SILENT PASS ON A BROKEN FIXTURE. The check refuses, BY NAME, on a
//         project with no git repository, no protected trunk ref, or no
//         configuration file — asserted by omitting each of the three in turn.
//         This file also asserts of ITSELF that it carries no `.skip` and no
//         absent-fixture early return: twelve tests in this repository already
//         skip on a missing fixture and read as green, and this must not become
//         the thirteenth.
//
// STATE ON ARRIVAL, measured rather than assumed, so no leg's colour is a
// surprise and no green one is mistaken for work this FR did.
//   RED (2 legs, the work this FR owes):
//     * AC.4 — `skills/gate-check/SKILL.md` § "Registering a probe" still says
//       "one of the 142 records it pins" where the pin is 139. A SAME-LINE edit;
//       it costs no line and disturbs neither the 354 cap nor the positional pin.
//     * AC.5 — no surface carries the limit. Closest is `module_reachability.ts`,
//       which supplies only the word `descriptive` of the five requirements.
//   GREEN ON ARRIVAL, and recorded as such rather than claimed:
//     * AC.1's measurement reproduces exactly at 9b420ec — 142 / 343 / two
//       ordered-and-reachable skip-baseline refs — which is what makes it a
//       fact worth recording rather than a target.
//     * AC.2 / .3 / .6 / .7. The ordering surfaces became executable under
//       STE-528 and the entry point under STE-530, EARLIER IN THIS MILESTONE.
//       These legs are the check STE-531 exists to add, and they are not
//       vacuous for arriving green: AC.3's per-surface mutation proves each one
//       can go red, and AC.6 proves the grader rejects a writer that succeeds
//       and writes nothing. A green leg that cannot fail would be the defect;
//       every leg here is shown to fail on its own negative case.
//
// LINE BUDGETS, so a later run does not rediscover them. `skills/implement/SKILL.md`
// is at the NFR-1 cap with ZERO headroom and `skills/gate-check/SKILL.md` carries
// a POSITIONAL pin on probe #26's row. Neither needs an added line for anything
// this file asserts: AC.4's stale count is a SAME-LINE edit, and AC.5's note
// belongs on `module_reachability.ts` (a `.ts`, therefore outside both scanned
// markdown trees — a note placed in `docs/` instead is legal but is graded by
// AC.4's re-measurement, which is where a new ordered reference would surface).

import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";

import { skipBaselinePath } from "../adapters/_shared/src/dpt_paths";
import {
  ORDER_PHRASES,
  ORDERED_UNREACHABLE_PIN,
  buildModuleGraph,
  classifyReferenceLine,
  runModuleReachabilityProbe,
} from "../adapters/_shared/src/module_reachability";
import { resolveTrunkSha } from "../adapters/_shared/src/skip_baseline";
import { mutateInRegion } from "./_sited-mutation";

// ===========================================================================
// Paths and small readers.
// ===========================================================================

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const SKILLS_DIR = join(PLUGIN_ROOT, "skills");
const DOCS_DIR = join(PLUGIN_ROOT, "docs");
const SHARED_SRC = join(PLUGIN_ROOT, "adapters", "_shared", "src");

const REPO_CLAUDE_MD = join(REPO_ROOT, "CLAUDE.md");
/**
 * The FR, at whichever of its two homes it currently occupies.
 *
 * ARCHIVE FALLBACK, and it is not optional. `/implement`'s Phase 4 archival
 * `git mv`s the FR from `specs/frs/` to `specs/frs/archive/` in the same run
 * that lands this test, so an active-only path reds the milestone's own gate at
 * the one transition no gate run precedes — measured here, this leg failed with
 * ENOENT the moment M136 archived itself. The resolution is asserted rather
 * than assumed: a path that resolves to NEITHER home throws by name, so this
 * cannot degrade into reading an empty string and passing.
 */
const FR_FILE = ((): string => {
  const active = join(REPO_ROOT, "specs", "frs", "STE-531.md");
  const archived = join(REPO_ROOT, "specs", "frs", "archive", "STE-531.md");
  if (existsSync(active)) return active;
  if (existsSync(archived)) return archived;
  throw new Error(
    `STE-531's FR is at neither ${active} nor ${archived} — the measurement legs ` +
      "below cannot read the FR they grade, and must fail rather than skip",
  );
})();
const REACHABILITY_MODULE = join(SHARED_SRC, "module_reachability.ts");
const GATE_CHECK_SKILL = join(SKILLS_DIR, "gate-check", "SKILL.md");
const EVIDENCE_KEY = "adapters/_shared/src/implement_report_evidence.ts";

const read = (p: string): string => readFileSync(p, "utf-8");
const rel = (p: string): string => relative(PLUGIN_ROOT, p);

function markdownFilesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.endsWith(".md")) out.push(full);
    }
  };
  walk(dir);
  return out;
}

/** Both shipped markdown trees — the same pair probe #81 walks. */
function shippedMarkdown(): string[] {
  return [...markdownFilesUnder(SKILLS_DIR), ...markdownFilesUnder(DOCS_DIR)];
}

// ===========================================================================
// THE CHECK.
//
// Everything between here and the AC blocks decides ONE question: does the
// skip-baseline order, as one surface gives it, FIRE in a given project? The
// answer is produced by RUNNING the order and reading the store, never by
// reading the order. Nothing below consults `branch_template`, a carrier-phrase
// list, or a window of characters around anything — asserted of these very
// functions in the AC.2 block, because a rule stated only in a comment is a
// rule nothing enforces.
// ===========================================================================

/** A fenced block of a markdown body, with absolute offsets into that body. */
interface Fence {
  readonly command: string;
  /** Offsets of the fence's CONTENT within the body, for sited mutation. */
  readonly start: number;
  readonly end: number;
}

function fences(body: string): Fence[] {
  const out: Fence[] = [];
  const lines = body.split("\n");
  let offset = 0;
  let inside = false;
  let contentStart = 0;
  let contentEnd = 0;
  let buffer: string[] = [];

  for (const row of lines) {
    const next = offset + row.length + 1;
    if (row.trim().startsWith("```")) {
      if (inside) {
        const command = buffer.join("\n").trim();
        if (command.length > 0) out.push({ command, start: contentStart, end: contentEnd });
        buffer = [];
      } else {
        contentStart = next;
      }
      inside = !inside;
      offset = next;
      continue;
    }
    if (inside) {
      buffer.push(row.trim());
      contentEnd = next;
    }
    offset = next;
  }
  return out;
}

/** The module whose order this file is about. Its NAME, not any phrasing of it. */
const ORDERED_MODULE = "capture_skip_baseline";

/**
 * The one runnable capture command a surface body orders.
 *
 * Throws, naming the surface, when there is none or more than one. "No command
 * found" is not an acceptable degradation of either state: a surface that
 * orders the capture only in prose and a surface that orders it twice have
 * different causes and different remedies.
 */
function orderedCaptureFence(body: string, label: string): Fence {
  const matches = fences(body).filter((f) => f.command.includes(ORDERED_MODULE));
  if (matches.length === 0) {
    throw new Error(`${label} carries NO runnable ${ORDERED_MODULE} command (AC-STE-531.2)`);
  }
  if (matches.length > 1) {
    throw new Error(
      `${label} carries ${matches.length} ${ORDERED_MODULE} commands; exactly one is the order: ` +
        JSON.stringify(matches.map((f) => f.command)),
    );
  }
  return matches[0] as Fence;
}

/** Every shipped surface that orders the capture as a runnable command. */
function orderingSurfaces(): string[] {
  return shippedMarkdown().filter((file) =>
    fences(read(file)).some((f) => f.command.includes(ORDERED_MODULE)),
  );
}

/**
 * A CLOSED substitution table. A shipped fence cannot carry an absolute path,
 * and anything left unresolved is a loud failure rather than a silently-run
 * mangled command.
 */
const SUBSTITUTIONS: ReadonlyArray<readonly [RegExp, "plugin" | "root"]> = [
  [/\$\{CLAUDE_PLUGIN_ROOT\}/g, "plugin"],
  [/\$CLAUDE_PLUGIN_ROOT\b/g, "plugin"],
  [/<projectRoot>/g, "root"],
  [/<project-root>/g, "root"],
  [/<repoRoot>/g, "root"],
  [/<repo-root>/g, "root"],
];

function resolvePlaceholders(command: string, projectRoot: string): string {
  let resolved = command;
  for (const [pattern, kind] of SUBSTITUTIONS) {
    resolved = resolved.replace(pattern, kind === "plugin" ? PLUGIN_ROOT : projectRoot);
  }
  const unresolved = resolved.match(/\$\{[^}]*\}|<[a-zA-Z][a-zA-Z-]*>/g);
  if (unresolved !== null) {
    throw new Error(
      `the ordered command carries placeholders outside the closed substitution table ` +
        `(${unresolved.join(", ")}): ${JSON.stringify(resolved)}`,
    );
  }
  return resolved;
}

interface BaselineRecord {
  readonly sha: string;
  readonly skipped: number;
}

/**
 * The record standing in `projectRoot`, READ BACK OFF DISK — or `null`.
 *
 * AC-STE-531.6 lives here. Nothing in this file grades a run by an exit status
 * or a return value: a writer that succeeds and writes nothing is the precise
 * shape this milestone exists to close, and it must not be able to satisfy its
 * own test.
 */
function recordOnDisk(projectRoot: string): BaselineRecord | null {
  const store = skipBaselinePath(projectRoot);
  if (!existsSync(store)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(read(store));
  } catch {
    return null;
  }
  const baselines = (parsed as { baselines?: Record<string, unknown> } | null)?.baselines;
  if (baselines === undefined || baselines === null) return null;
  for (const value of Object.values(baselines)) {
    const candidate = value as BaselineRecord | null;
    if (
      candidate !== null &&
      typeof candidate === "object" &&
      typeof candidate.skipped === "number"
    ) {
      return candidate;
    }
  }
  return null;
}

/**
 * AC-STE-531.7 — refuse, BY NAME, on a fixture that was not set up.
 *
 * Three distinct absences, three distinct messages. A single "fixture unusable"
 * would be as useless as the skip it replaces.
 */
function assertFixtureUsable(projectRoot: string): void {
  if (!existsSync(join(projectRoot, ".git"))) {
    throw new Error(
      `fixture ${projectRoot} has NO git repository (.git absent) — the ordering path ` +
        `resolves a merge base, so this fixture cannot exercise the production branch`,
    );
  }
  if (resolveTrunkSha(projectRoot) === null) {
    throw new Error(
      `fixture ${projectRoot} has NO protected trunk ref — resolveTrunkSha returned null, ` +
        `so there is no commit the baseline could be keyed by`,
    );
  }
  if (!existsSync(join(projectRoot, "CLAUDE.md"))) {
    throw new Error(
      `fixture ${projectRoot} has NO CLAUDE.md — the order is decided against the ` +
        `project's own configuration file and there is none here`,
    );
  }
}

interface FireVerdict {
  /** The ONLY verdict: a record was read back off disk after the run. */
  readonly fires: boolean;
  readonly record: BaselineRecord | null;
  readonly command: string;
  readonly exitCode: number;
  readonly output: string;
}

/**
 * Does the order this surface body gives FIRE in `projectRoot`?
 *
 * Decided by executing the surface's own ordered command with the project as
 * cwd and reading the store back. The exit status is reported for diagnosis and
 * is deliberately not part of the verdict.
 */
function orderFires(body: string, label: string, projectRoot: string): FireVerdict {
  assertFixtureUsable(projectRoot);
  const command = resolvePlaceholders(orderedCaptureFence(body, label).command, projectRoot);
  const proc = Bun.spawnSync(["/bin/sh", "-c", command], {
    cwd: projectRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  const record = recordOnDisk(projectRoot);
  return {
    fires: record !== null,
    record,
    command,
    exitCode: proc.exitCode,
    output: `${proc.stdout.toString()}\n${proc.stderr.toString()}`.trim(),
  };
}

// ===========================================================================
// Fixture projects.
// ===========================================================================

const TEMP_DIRS: string[] = [];
const FIXTURE_SKIPS = 2;
let fixtureSerial = 0;

function tempDir(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `ste531-${label}-`));
  TEMP_DIRS.push(dir);
  return dir;
}

function gitIn(cwd: string, args: string[]): void {
  Bun.spawnSync(["git", "-c", "user.email=t@t.test", "-c", "user.name=t", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
}

interface FixtureOptions {
  /** CLAUDE.md bytes; defaults to this repository's own file. */
  readonly claudeMd?: string;
  /** Skip `git init` entirely (AC.7). */
  readonly noGit?: boolean;
  /** Initialise git but leave no protected trunk ref (AC.7). */
  readonly noTrunk?: boolean;
  /** Write no CLAUDE.md (AC.7). */
  readonly noConfig?: boolean;
}

/**
 * A throwaway PROJECT the order can be driven against: a real git repository on
 * a protected trunk, a runnable suite with a KNOWN skip count, and `.dpt/`
 * git-ignored exactly as a `/setup`-bootstrapped tree ignores it — the capture
 * writes into `.dpt/`, so a fixture that tracks it is dirty from its own first
 * capture onward and every later run refuses on the earlier one's artifact.
 *
 * A serial number goes INTO the committed tree: git derives a commit id from
 * its tree, message, author and timestamp at one-second resolution, so two
 * byte-identical fixtures built in the same second would be the SAME commit,
 * and a write-once store would serve one fixture's record to another.
 */
function makeFixture(label: string, options: FixtureOptions = {}): string {
  const serial = ++fixtureSerial;
  const root = tempDir(label);

  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify({ name: `ste531-${label}-${serial}`, private: true }, null, 2)}\n`,
  );
  writeFileSync(join(root, ".gitignore"), ".dpt/\nnode_modules/\n");
  writeFileSync(join(root, "SERIAL"), `${serial}\n`);
  mkdirSync(join(root, "tests"), { recursive: true });
  writeFileSync(
    join(root, "tests", "fixture.test.ts"),
    [
      'import { expect, test } from "bun:test";',
      "",
      'test("the fixture suite carries one real assertion", () => {',
      "  expect(1 + 1).toBe(2);",
      "});",
      ...Array.from({ length: FIXTURE_SKIPS }, (_unused, index) =>
        [
          "",
          `test.skip("deliberately skipped fixture case ${index + 1}", () => {`,
          "  expect(1).toBe(1);",
          "});",
        ].join("\n"),
      ),
      "",
    ].join("\n"),
  );
  if (options.noConfig !== true) {
    writeFileSync(join(root, "CLAUDE.md"), options.claudeMd ?? read(REPO_CLAUDE_MD));
  }

  if (options.noGit === true) return root;

  gitIn(root, ["init", "-q", "-b", options.noTrunk === true ? "feat/no-trunk" : "main"]);
  gitIn(root, ["add", "-A"]);
  gitIn(root, ["commit", "-q", "-m", "chore: fixture"]);
  return root;
}

/** This repository's own CLAUDE.md, with a `branch_template:` key added. */
function claudeMdWithBranchTemplate(): string {
  const body = read(REPO_CLAUDE_MD);
  const anchor = "mode: linear";
  const at = body.indexOf(anchor);
  if (at < 0) {
    throw new Error(`${rel(REPO_CLAUDE_MD)} no longer carries ${JSON.stringify(anchor)}`);
  }
  const withKey = mutateInRegion(
    body,
    at,
    at + anchor.length,
    anchor,
    `${anchor}\nbranch_template: {type}/m{N}-{slug}`,
    { label: "the fixture's Task Tracking block" },
  );
  if (!withKey.includes("branch_template:")) {
    throw new Error("the key-setting fixture does not actually set `branch_template:`");
  }
  return withKey;
}

// ===========================================================================
// AC-STE-531.1 — the measured gap, recorded as history and asserted there.
// ===========================================================================

const HISTORICAL_SHA = "9b420ec";
const HISTORICAL_ORDERED_UNREACHABLE = 142;
const HISTORICAL_RECORDS = 343;
const HISTORICAL_SKIP_REFS = [
  { surface: "plugins/dev-process-toolkit/skills/implement/SKILL.md", line: 45 },
  { surface: "plugins/dev-process-toolkit/docs/implement-reference.md", line: 77 },
] as const;

/**
 * A worktree-free copy of `9b420ec`. Failure is NAMED and thrown — a shallow
 * clone that cannot reach the commit must red, never quietly pass (AC.7's rule,
 * applied to AC.1's fixture).
 */
let archivedRoot: string | null = null;
function archiveAtHistoricalSha(): string {
  if (archivedRoot !== null) return archivedRoot;
  const dir = tempDir("archive");
  // `set -o pipefail` is load-bearing, not tidiness. A pipeline reports its LAST
  // stage's status, so without it `git archive <bad-sha> | tar -x` exits 0 —
  // tar succeeded at extracting nothing — and the guard below then reported
  // "`git archive` exited 0" while quoting git's own fatal from stderr. A status
  // reading healthy while nothing happened is the exact defect class this
  // milestone exists to close, and it had reproduced inside the test that
  // measures it.
  const proc = Bun.spawnSync(
    [
      "/bin/sh",
      "-c",
      `set -o pipefail; git -C ${JSON.stringify(REPO_ROOT)} archive ${HISTORICAL_SHA} ` +
        `| tar -x -C ${JSON.stringify(dir)}`,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (proc.exitCode !== 0 || !existsSync(join(dir, "plugins", "dev-process-toolkit"))) {
    throw new Error(
      `cannot materialise commit ${HISTORICAL_SHA} — the archive pipeline exited ` +
        `${proc.exitCode}: ${proc.stderr.toString().trim()}. The AC-STE-531.1 measurement ` +
        `is stated OF that commit and cannot be verified without it; this is a failure, ` +
        `not a skip.`,
    );
  }
  archivedRoot = dir;
  return dir;
}

interface HistoricalProbe {
  readonly mod: { readonly ORDERED_UNREACHABLE_PIN: number };
  readonly report: {
    readonly ok: boolean;
    readonly orderedUnreachable: number;
    readonly records: ReadonlyArray<Record<string, unknown>>;
  };
}

let historicalProbe: HistoricalProbe | null = null;

/** The probe AS IT STOOD at that commit, run against that commit's own tree. */
async function probeAtHistoricalSha(): Promise<HistoricalProbe> {
  if (historicalProbe !== null) return historicalProbe;
  const root = archiveAtHistoricalSha();
  const modulePath = join(
    root,
    "plugins/dev-process-toolkit/adapters/_shared/src/module_reachability.ts",
  );
  const mod = (await import(modulePath)) as {
    ORDERED_UNREACHABLE_PIN: number;
    runModuleReachabilityProbe: (root: string) => Promise<HistoricalProbe["report"]>;
  };
  historicalProbe = { mod, report: await mod.runModuleReachabilityProbe(root) };
  return historicalProbe;
}

describe("AC-STE-531.1 — the measured gap is recorded as a fact with its measurement", () => {
  test(`the probe at ${HISTORICAL_SHA} reports ok with ${HISTORICAL_ORDERED_UNREACHABLE} at its own pin`, async () => {
    const { mod, report } = await probeAtHistoricalSha();
    expect(mod.ORDERED_UNREACHABLE_PIN).toBe(HISTORICAL_ORDERED_UNREACHABLE);
    expect(report.ok).toBe(true);
    expect(report.orderedUnreachable).toBe(HISTORICAL_ORDERED_UNREACHABLE);
  }, 60_000);

  test(`it emits ${HISTORICAL_RECORDS} records at that commit`, async () => {
    const { report } = await probeAtHistoricalSha();
    expect(report.records.length).toBe(HISTORICAL_RECORDS);
  }, 60_000);

  test("exactly two of them name the skip-baseline module, both ordered and reachable", async () => {
    const { report } = await probeAtHistoricalSha();
    const refs = (report.records as Array<Record<string, unknown>>).filter((r) =>
      String(r.module).includes("skip_baseline"),
    );
    expect(refs.map((r) => `${r.surface}:${r.line}`)).toEqual(
      HISTORICAL_SKIP_REFS.map((r) => `${r.surface}:${r.line}`),
    );
    for (const ref of refs) {
      expect(ref.refClass).toBe("ordered");
      expect(ref.reachable).toBe(true);
    }
  }, 60_000);

  test("the numbers are HISTORY, not a claim about the working tree", async () => {
    const today = await runModuleReachabilityProbe(REPO_ROOT);
    // If either of these ever coincided again it would be a coincidence, not a
    // reason to re-point the measurement at HEAD. Asserting the difference is
    // what stops the historical record from silently becoming a live pin.
    expect([today.orderedUnreachable, today.records.length]).not.toEqual([
      HISTORICAL_ORDERED_UNREACHABLE,
      HISTORICAL_RECORDS,
    ]);
  }, 60_000);

  test("the FR states each measured number and labels it measured", () => {
    const fr = read(FR_FILE);
    expect(fr).toContain(HISTORICAL_SHA);
    expect(fr).toContain(String(HISTORICAL_ORDERED_UNREACHABLE));
    expect(fr).toContain(`${HISTORICAL_RECORDS} records`);
    for (const ref of HISTORICAL_SKIP_REFS) {
      expect(fr).toContain(`${ref.surface.replace("plugins/dev-process-toolkit/", "")}:${ref.line}`);
    }
    expect(fr).toMatch(/states these numbers as measured, not as a target/);
  });
});

// ===========================================================================
// AC-STE-531.2 — the check decides by EXECUTING the ordering path.
// ===========================================================================

const FR_NAMED_SURFACES = [
  join(SKILLS_DIR, "implement", "SKILL.md"),
  join(DOCS_DIR, "implement-reference.md"),
] as const;

/**
 * Every line of `body` that is NOT inside a fence.
 *
 * One function, used both to STRIP the carrier phrases and to assert they are
 * gone. Two spellings of "which lines are prose" could be edited apart, and the
 * assertion would then be reading a different set of lines than the mutation
 * wrote — which is how a mutation scores a pass it never earned.
 */
function proseLines(body: string): string[] {
  const out: string[] = [];
  let inside = false;
  for (const row of body.split("\n")) {
    if (row.trim().startsWith("```")) {
      inside = !inside;
      continue;
    }
    if (!inside) out.push(row);
  }
  return out;
}

/** Replace every carrier phrase in the PROSE with an inert token. */
function stripCarrierPhrasesFromProse(body: string): string {
  let inside = false;
  return body
    .split("\n")
    .map((row) => {
      if (row.trim().startsWith("```")) {
        inside = !inside;
        return row;
      }
      if (inside) return row;
      let text = row;
      for (const phrase of ORDER_PHRASES) text = text.split(phrase).join("«inert»");
      return text;
    })
    .join("\n");
}

describe("AC-STE-531.2 — the order is decided by execution against the project's own CLAUDE.md", () => {
  test("the ordering surfaces are DISCOVERED, and include both surfaces the FR names", () => {
    const found = orderingSurfaces();
    expect(found.length).toBeGreaterThanOrEqual(2);
    for (const named of FR_NAMED_SURFACES) {
      expect(found, `${rel(named)} must order the capture as a runnable command`).toContain(named);
    }
  });

  for (const surface of orderingSurfaces()) {
    test(`${rel(surface)} — the order FIRES here, read back off disk`, () => {
      const project = makeFixture("fires");
      const verdict = orderFires(read(surface), rel(surface), project);
      expect(verdict.fires, `no record on disk after: ${verdict.command}\n${verdict.output}`).toBe(
        true,
      );
      // The number is DERIVED from the fixture's own suite, not constant.
      expect(verdict.record?.skipped).toBe(FIXTURE_SKIPS);
    }, 120_000);
  }

  test("BEHAVIOUR, NOT VOCABULARY — the deciding functions consult no phrase list", () => {
    const decider = [orderFires, orderedCaptureFence, recordOnDisk, fences, orderingSurfaces]
      .map((fn) => fn.toString())
      .join("\n");
    // Non-vacuity first: an unreadable source would satisfy every `not.toMatch`
    // below while proving nothing at all.
    expect(decider, "the deciding functions' source could not be read").toContain(
      "Bun.spawnSync",
    );
    expect(decider).not.toMatch(/branch_template/);
    expect(decider).not.toMatch(/ORDER_PHRASES|CONDITIONAL_OPENER|OPENER_WINDOW/);
    expect(decider).not.toMatch(/\bproximity\b/i);
  });

  test("stripping EVERY carrier phrase from the prose does not move the verdict", () => {
    const surface = FR_NAMED_SURFACES[0];
    const body = read(surface);
    const reworded = stripCarrierPhrasesFromProse(body);

    // The mutation must actually have applied, and must have left the ORDER
    // itself byte-identical — otherwise this proves nothing about vocabulary.
    expect(reworded, "no carrier phrase was present to strip").not.toBe(body);
    expect(orderedCaptureFence(reworded, "reworded").command).toBe(
      orderedCaptureFence(body, rel(surface)).command,
    );
    const prose = proseLines(reworded).join("\n");
    for (const phrase of ORDER_PHRASES) {
      expect(prose, `carrier phrase ${JSON.stringify(phrase)} survived the strip`).not.toContain(
        phrase,
      );
    }

    const verdict = orderFires(reworded, "reworded copy", makeFixture("reworded"));
    expect(verdict.fires, `${verdict.command}\n${verdict.output}`).toBe(true);
  }, 120_000);
});

// ===========================================================================
// AC-STE-531.3 — falsifiable in both directions, once per surface.
// ===========================================================================

/**
 * Restore the `branch_template:` conditional to a COPY, in the form execution
 * can see: a guard on the ordered command itself.
 *
 * Sited, so the anchor cannot be found in some other fence of the document, and
 * loud when absent — a mutation that never applied would manufacture evidence
 * of falsifiability for an assertion that was never exercised.
 */
function restoreBranchTemplateConditional(body: string, label: string): string {
  const fence = orderedCaptureFence(body, label);
  return mutateInRegion(
    body,
    fence.start,
    fence.end,
    fence.command,
    `grep -q 'branch_template:' CLAUDE.md && ${fence.command}`,
    { label: `${label}'s ordered capture fence` },
  );
}

describe("AC-STE-531.3 — restoring the conditional reddens, per surface", () => {
  for (const surface of orderingSurfaces()) {
    const label = rel(surface);

    test(`${label} — CONTROL: the unmutated copy fires`, () => {
      const copy = read(surface);
      const verdict = orderFires(copy, `${label} (copy)`, makeFixture("control"));
      expect(verdict.fires, `${verdict.command}\n${verdict.output}`).toBe(true);
    }, 120_000);

    test(`${label} — MUTATION: the restored conditional stops it firing`, () => {
      const mutated = restoreBranchTemplateConditional(read(surface), label);
      expect(mutated).toContain("branch_template:");
      const project = makeFixture("mutated");
      const verdict = orderFires(mutated, `${label} (conditional restored)`, project);
      expect(verdict.fires, `a record landed despite the restored conditional`).toBe(false);
      expect(recordOnDisk(project)).toBeNull();
    }, 120_000);
  }

  for (const surface of FR_NAMED_SURFACES) {
    const label = rel(surface);

    test(`${label} — a key-OMITTING configuration fires`, () => {
      const claudeMd = read(REPO_CLAUDE_MD);
      expect(claudeMd, "this repository must not set the key").not.toContain("branch_template:");
      const verdict = orderFires(read(surface), label, makeFixture("nokey", { claudeMd }));
      expect(verdict.fires, `${verdict.command}\n${verdict.output}`).toBe(true);
    }, 120_000);

    test(`${label} — a key-SETTING configuration fires too, so absence is not what is detected`, () => {
      const claudeMd = claudeMdWithBranchTemplate();
      const verdict = orderFires(read(surface), label, makeFixture("withkey", { claudeMd }));
      expect(verdict.fires, `${verdict.command}\n${verdict.output}`).toBe(true);
    }, 120_000);
  }

  test("the discriminator: against the GUARDED copy only the key-setting fixture fires", () => {
    const surface = FR_NAMED_SURFACES[0];
    const mutated = restoreBranchTemplateConditional(read(surface), rel(surface));
    const without = orderFires(mutated, "guarded / no key", makeFixture("guarded-nokey"));
    const with_ = orderFires(
      mutated,
      "guarded / key set",
      makeFixture("guarded-withkey", { claudeMd: claudeMdWithBranchTemplate() }),
    );
    expect(without.fires).toBe(false);
    expect(with_.fires, `${with_.command}\n${with_.output}`).toBe(true);
  }, 120_000);
});

// ===========================================================================
// AC-STE-531.4 — the pin, re-measured after this milestone's surface edits.
// ===========================================================================

describe("AC-STE-531.4 — ORDERED_UNREACHABLE_PIN is re-measured, not assumed", () => {
  test("the measured count equals the pin AFTER this milestone's edits", async () => {
    const report = await runModuleReachabilityProbe(REPO_ROOT);
    expect(
      report.orderedUnreachable,
      `measured ${report.orderedUnreachable} against pin ${ORDERED_UNREACHABLE_PIN} — ` +
        `if a surface edit added an ordered reference, lower/raise per the probe's own remedy`,
    ).toBe(ORDERED_UNREACHABLE_PIN);
    expect(report.ok).toBe(true);
  }, 60_000);

  test("ALREADY LANDED (STE-527) — the 142 → 139 move was not work done in this FR", async () => {
    const { mod } = await probeAtHistoricalSha();
    expect(mod.ORDERED_UNREACHABLE_PIN).toBe(HISTORICAL_ORDERED_UNREACHABLE);
    expect(ORDERED_UNREACHABLE_PIN).toBeLessThan(mod.ORDERED_UNREACHABLE_PIN);

    // The recorded CAUSE: `skip_baseline.ts` gained a `./branch_proposal`
    // import, which made three previously-unreachable ordered refs reachable.
    const archived = read(
      join(
        archiveAtHistoricalSha(),
        "plugins/dev-process-toolkit/adapters/_shared/src/skip_baseline.ts",
      ),
    );
    expect(archived).not.toContain("./branch_proposal");
    expect(read(join(SHARED_SRC, "skip_baseline.ts"))).toContain("./branch_proposal");
  }, 60_000);

  test("the pin was never RAISED to admit a new unrunnable order", async () => {
    const { mod } = await probeAtHistoricalSha();
    expect(ORDERED_UNREACHABLE_PIN).toBeLessThanOrEqual(mod.ORDERED_UNREACHABLE_PIN);
  }, 60_000);

  test("every shipped surface stating the pinned count states the CURRENT one", () => {
    const stated: Array<{ surface: string; value: number }> = [];
    for (const file of shippedMarkdown()) {
      for (const m of read(file).matchAll(/(\d{2,4}) records it pins/g)) {
        stated.push({ surface: rel(file), value: Number(m[1]) });
      }
    }
    expect(stated.length, "no shipped surface states the pinned count — the pin is non-vacuous")
      .toBeGreaterThan(0);
    for (const entry of stated) {
      expect(
        entry.value,
        `${entry.surface} states ${entry.value} where the pin is ${ORDERED_UNREACHABLE_PIN}`,
      ).toBe(ORDERED_UNREACHABLE_PIN);
    }
  });
});

// ===========================================================================
// AC-STE-531.5 — the limit of the reachability certificate, written down.
// ===========================================================================

/** Surfaces that DOCUMENT the reachability rule, and may therefore carry the note. */
function reachabilityDocSurfaces(): string[] {
  const docs = shippedMarkdown().filter((file) => {
    const body = read(file);
    return body.includes("runModuleReachabilityProbe") || body.includes("module_reachability");
  });
  return [REACHABILITY_MODULE, ...docs];
}

const NOTE_REQUIREMENTS: ReadonlyArray<{ readonly name: string; readonly pattern: RegExp }> = [
  { name: "half (a): reachable means the module CAN BE RUN", pattern: /can be run|is runnable/i },
  {
    name: "half (a): it does NOT answer whether the order will ever be given",
    pattern: /(will|would) ever (be given|fire|be issued)|does not (say|mean|answer)[^.\n]{0,120}\border\b/i,
  },
  { name: "half (b): the `descriptive` class", pattern: /\bdescriptive\b/ },
  {
    name: "half (b): a descriptive reference HIDES an unreachable module",
    pattern: /hide[sn]?|hidden|invisible|never flag|does not flag|goes unflagged/i,
  },
  { name: "the measured instance", pattern: /implement_report_evidence\.ts/ },
];

const NOTE_WINDOW = 40;

/** The surfaces carrying a window that satisfies EVERY requirement, and why not. */
function noteSearch(): { hits: string[]; missesBySurface: Record<string, string[]> } {
  const hits: string[] = [];
  const missesBySurface: Record<string, string[]> = {};
  for (const surface of reachabilityDocSurfaces()) {
    const lines = read(surface).split("\n");
    let best: string[] = NOTE_REQUIREMENTS.map((r) => r.name);
    for (let i = 0; i < Math.max(1, lines.length - NOTE_WINDOW + 1); i++) {
      const window = lines.slice(i, i + NOTE_WINDOW).join("\n");
      const missing = NOTE_REQUIREMENTS.filter((r) => !r.pattern.test(window)).map((r) => r.name);
      if (missing.length < best.length) best = missing;
      if (missing.length === 0) break;
    }
    if (best.length === 0) hits.push(rel(surface));
    else missesBySurface[rel(surface)] = best;
  }
  return { hits, missesBySurface };
}

describe("AC-STE-531.5 — what a green reachability row does and does not certify", () => {
  test("the note stands on a surface that documents the reachability rule", () => {
    const { hits, missesBySurface } = noteSearch();
    const best = Object.entries(missesBySurface).sort((a, b) => a[1].length - b[1].length)[0];
    expect(
      hits,
      `no surface carries the whole note within ${NOTE_WINDOW} lines. Closest: ` +
        `${best?.[0] ?? "(none)"} still missing: ${JSON.stringify(best?.[1] ?? [])}. ` +
        `Candidates: ${reachabilityDocSurfaces().map(rel).join(", ")}`,
    ).not.toEqual([]);
  });

  test("MEASURED — the renderer of every /implement report is UNREACHABLE by the shipped rule", () => {
    const graph = buildModuleGraph(REPO_ROOT);
    expect(graph.modules).toContain(EVIDENCE_KEY);
    expect(graph.hasEntryPoint(EVIDENCE_KEY)).toBe(false);
    expect(graph.nonTestImporters(EVIDENCE_KEY)).toEqual([]);
    expect(graph.reachable(EVIDENCE_KEY)).toBe(false);
  });

  test("MEASURED — both of its references score `descriptive`, so probe #81 never flags it", async () => {
    const report = await runModuleReachabilityProbe(REPO_ROOT);
    const refs = report.records.filter((r) => r.module === EVIDENCE_KEY);
    expect(refs.length).toBe(2);
    for (const ref of refs) {
      expect(ref.refClass).toBe("descriptive");
      expect(ref.reachable).toBe(false);
    }
    // The class is what hides it: none of the ORDER_PHRASES appear on either
    // line, so nothing counts it and nothing warns about it.
    for (const ref of refs) {
      const line = read(join(PLUGIN_ROOT, ref.surface.replace("plugins/dev-process-toolkit/", "")))
        .split("\n")[ref.line - 1] as string;
      expect(classifyReferenceLine(line)).toBe("descriptive");
    }
    for (const violation of report.violations) {
      expect(violation.message).not.toContain(EVIDENCE_KEY);
    }
  }, 60_000);

  test("the note's surface does not itself introduce an ordered reference", async () => {
    // A note landed in `docs/` or `skills/` is scanned; one landed in the module
    // is not. Either is legal, but only a re-measurement can say which happened.
    const report = await runModuleReachabilityProbe(REPO_ROOT);
    expect(report.orderedUnreachable).toBe(ORDERED_UNREACHABLE_PIN);
  }, 60_000);

  test("the requirement set DISCRIMINATES — isolation is only half a test", () => {
    // A surface that documents the rule thoroughly and states neither half of
    // the limit must FAIL the set; the same surface with the limit added must
    // pass it. Without the negative case, a set that matched anything at all
    // would read as a clean pass on the day the note was never written.
    const rulesOnly = [
      "Reachability is mechanical and transitive: a module is reachable when it",
      "carries the `if (import.meta.main)` guard, or when something carrying one",
      "imports it, directly or transitively. A test-file importer never rescues.",
      "Classification is exactly three values: ordered, descriptive, harness.",
    ].join("\n");
    expect(NOTE_REQUIREMENTS.filter((r) => !r.pattern.test(rulesOnly)).length).toBeGreaterThan(0);

    const withLimit = [
      rulesOnly,
      "It answers only whether the module can be run. It does not answer whether",
      "the order naming it will ever be given — see STE-531. And a `descriptive`",
      "reference hides an unreachable module the reader is expected to use:",
      "`adapters/_shared/src/implement_report_evidence.ts` is unflagged today.",
    ].join("\n");
    expect(NOTE_REQUIREMENTS.filter((r) => !r.pattern.test(withLimit))).toEqual([]);
  });

  test("probe #81's registration documents the rule, so it is a candidate surface", () => {
    expect(read(GATE_CHECK_SKILL)).toContain("runModuleReachabilityProbe");
    expect(reachabilityDocSurfaces()).toContain(GATE_CHECK_SKILL);
    expect(reachabilityDocSurfaces()).toContain(REACHABILITY_MODULE);
  });
});

// ===========================================================================
// AC-STE-531.6 — a positive result is the record, off disk.
// ===========================================================================

describe("AC-STE-531.6 — non-vacuous: the verdict is the record, never the exit status", () => {
  test("a writer that exits 0 and writes NOTHING is rejected", () => {
    const project = makeFixture("silent");
    const body = ["```bash", "true # capture_skip_baseline: succeeds, writes nothing", "```", ""].join(
      "\n",
    );
    const verdict = orderFires(body, "silent writer", project);
    expect(verdict.exitCode).toBe(0);
    expect(verdict.fires).toBe(false);
  }, 60_000);

  test("deleting the store from a SUCCESSFUL run turns the same verdict negative", () => {
    const project = makeFixture("deleted");
    const surface = read(FR_NAMED_SURFACES[0]);
    expect(orderFires(surface, "control", project).fires).toBe(true);
    rmSync(skipBaselinePath(project), { force: true });
    expect(recordOnDisk(project)).toBeNull();
  }, 120_000);

  test("an empty store file is not mistaken for a record", () => {
    const project = makeFixture("empty");
    const store = skipBaselinePath(project);
    mkdirSync(dirname(store), { recursive: true });
    writeFileSync(store, "");
    expect(recordOnDisk(project)).toBeNull();
    writeFileSync(store, JSON.stringify({ version: 2, baselines: {} }));
    expect(recordOnDisk(project)).toBeNull();
  });

  test("a NON-zero exit that wrote a record still counts as fired", () => {
    // The guarded fence of AC.3 exits non-zero precisely when it correctly
    // declines; the converse must also hold, or the exit code is smuggling
    // itself back into the verdict.
    const project = makeFixture("nonzero");
    const command = orderedCaptureFence(read(FR_NAMED_SURFACES[0]), "control").command;
    const body = ["```bash", `${command}; exit 3`, "```", ""].join("\n");
    const verdict = orderFires(body, "non-zero exit", project);
    expect(verdict.exitCode).toBe(3);
    expect(verdict.fires, verdict.output).toBe(true);
  }, 120_000);
});

// ===========================================================================
// AC-STE-531.7 — a fixture that was not set up FAILS BY NAME.
// ===========================================================================

describe("AC-STE-531.7 — no silent pass on a fixture that was not set up", () => {
  const surface = (): string => read(FR_NAMED_SURFACES[0]);

  test("the positive control passes the same guard the three below trip", () => {
    expect(() => assertFixtureUsable(makeFixture("usable"))).not.toThrow();
  });

  test("NO GIT REPOSITORY — refuses, naming git", () => {
    const project = makeFixture("nogit", { noGit: true });
    expect(() => orderFires(surface(), "no git", project)).toThrow(/NO git repository/);
    expect(recordOnDisk(project)).toBeNull();
  });

  test("NO TRUNK REF — refuses, naming the trunk", () => {
    const project = makeFixture("notrunk", { noTrunk: true });
    expect(() => orderFires(surface(), "no trunk", project)).toThrow(/NO protected trunk ref/);
    expect(recordOnDisk(project)).toBeNull();
  });

  test("NO CONFIGURATION FILE — refuses, naming CLAUDE.md", () => {
    const project = makeFixture("noconfig", { noConfig: true });
    expect(() => orderFires(surface(), "no config", project)).toThrow(/NO CLAUDE\.md/);
    expect(recordOnDisk(project)).toBeNull();
  });

  test("a surface that orders the capture only in PROSE refuses, naming the surface", () => {
    const project = makeFixture("prose");
    const body = "Call `captureSkipBaseline(projectRoot, sha, skipped)` when the branch is cut.\n";
    expect(() => orderFires(body, "prose-only surface", project)).toThrow(
      /carries NO runnable capture_skip_baseline command/,
    );
  });

  test("THIS FILE carries no skip and no absent-fixture early return", () => {
    const self = read(join(import.meta.dir, "m136-ste-531-order-fires.test.ts"));
    // Comments are excluded, and so is the fixture template that deliberately
    // writes skipped cases into the THROWAWAY project's suite — the skip count
    // is what the capture measures there. The tokens are ASSEMBLED rather than
    // written out, so this leg does not trip over its own spelling of them.
    const body = self
      .split("\n")
      .filter((row) => !row.trimStart().startsWith("//") && !row.includes("deliberately skipped"));
    const forbidden = ["test", "describe", "it"]
      .map((keyword) => `${keyword}.${"skip"}(`)
      .concat([`.${"skip"}If(`, `.${"todo"}(`]);
    for (const token of forbidden) {
      expect(
        body.filter((row) => row.includes(token)),
        `this file must not use ${token} — twelve tests in this repository already skip ` +
          `on an absent fixture and read as green; this must not become the thirteenth`,
      ).toEqual([]);
    }
    // The setup guard REFUSES; it never returns a verdict. Three absences,
    // three throws, and no early return that would let a caller carry on.
    const guard = assertFixtureUsable.toString();
    expect(guard, "the guard's source could not be read").toContain("CLAUDE.md");
    expect(guard.match(/throw (?:new )?Error\(/g)?.length).toBe(3);
    expect(guard).not.toMatch(/\breturn\b/);
  });
});

// ===========================================================================
// Teardown.
// ===========================================================================

describe("fixture teardown", () => {
  test("every throwaway project is removed", () => {
    for (const dir of TEMP_DIRS) rmSync(dir, { recursive: true, force: true });
    for (const dir of TEMP_DIRS) expect(existsSync(dir)).toBe(false);
  });
});
