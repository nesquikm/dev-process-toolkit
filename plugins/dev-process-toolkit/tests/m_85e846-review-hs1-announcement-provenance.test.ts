// M_85e846 review round — HS-1 REOPENED on the shipped bytes (v2.89.0, c71a8e9).
//
// HS-1, the milestone's headline invariant, is "gate evidence counts only in
// the repository it was produced for". STE-614's review closed one forgery (a
// hand-written receipt FILE) by binding a receipt to its own `dpt-receipt:`
// announcement in the transcript. That binding is only as strong as the
// question "which Bash call printed this line", and the shipped answer to that
// question is a SUBSTRING regex:
//
//   templates/hooks/_lib/session.ts:442
//     const RECEIPT_FRONT_DOOR =
//       /(^|\s)bun\s+run\s+\S*adapters\/_shared\/src\/gate_receipt\.ts["']?(\s|$)/
//
// Measured against two toolkit-managed checkouts, session rooted in FE, commit
// aimed at BE, driving the SHIPPED wrapper `pre-commit-gate-check.sh`:
//
//   A  a Bash command that only MENTIONS the module
//      (`echo bun run <front door> gate-check <BE>`) — never runs it — whose
//      result carries BE's announcement line ................ exit 0. LEAK.
//   B  one genuine front-door run for FE whose result carries the FE line
//      FIRST and a second, replayed BE line ................. exit 2 — but only
//      because the first-announced-root rule happened to pick FE. Luck.
//   B2 the same result with the replayed BE line FIRST ...... exit 0. LEAK.
//   C  the same forged receipt on disk with NO announcement .. exit 2, correct.
//
// TWO DEFECTS, both in `session.ts`:
//
//   1. `RECEIPT_FRONT_DOOR` is a substring match, so a command that merely
//      names the module announces. The comment above it (:437-440) claims it is
//      "deliberately narrow: a command that merely mentions the module (an
//      echo, a heredoc) announces nothing, exactly as the sibling tracker-write
//      gate reads its own deciding modules". That claim is FALSE, and a false
//      comment is how the next reader gets fooled.
//   2. `announcementsIn` (:464) returns EVERY matching line in one result, so a
//      single genuine run's result can carry extra, replayed lines.
//
// THE CORRECT READING ALREADY SHIPS, in the sibling gate M_947c79 built:
// `invokedDecidingModule` (templates/hooks/_lib/hooks/pre-tracker-write-gate.ts
// :443) tokenises with the exported `simpleCommandWords` (:378) under a
// deliberately small grammar, demands ONE simple `bun [run] <absolute module
// path> <subcommand>`, and realpath-compares the path against this plugin's own
// file; its collector (:536-554) enforces `if (found.length !== 1) continue` —
// "a result carrying more than one announcement line announces none of them".
// These suites grade the gate receipt against THAT reading, command shape for
// command shape. Hardening the regex is not the fix; sharing the reader is.
//
// HOW THESE CLAUSES ARE GRADED
//
//   - Every behavioural clause drives the SHIPPED bash wrapper — the real
//     injection site. A predicate that no injection-site clause exercises is
//     green because nothing measured it (the AC-STE-615.8 failure), so no
//     forbid row here is satisfied by a pure-function assertion alone.
//   - Both orderings of a two-line result are named in the test title and
//     graded separately. The defect is ordering-dependent, and the ordering
//     that happens to exit 2 today does so by luck, not by rule: those rows
//     assert the REASON as well as the code (the refusal must not name the
//     other checkout as the run that recorded it, because under the
//     one-announcement rule no announcement counted at all).
//   - Every forbid row has a permit sibling. A fix that refused everything
//     would pass a forbid-only suite.
//   - Receipts are written by SPAWNING the front door, never hand-rolled.
//
// Every spawn is SERIAL: no Promise.all over processes.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { Project, type Diagnostic } from "ts-morph";

import { git, makeSpanFixture, type SpanFixture } from "./_span_fixture";
import {
  FRONT_DOOR,
  PLUGIN_ROOT,
  clearReceipts,
  forgetAnnouncements,
  mintedAnnouncements,
  writeGateReceipt,
  receiptsDirOf,
} from "./_gate_receipt_fixture";
import { invokedDecidingModule } from "../templates/hooks/_lib/hooks/pre-tracker-write-gate";

const WRAPPER = join(PLUGIN_ROOT, "templates", "hooks", "process", "pre-commit-gate-check.sh");
const SKILL = "dev-process-toolkit:gate-check";
const SID = "s614-review";
const T = 300_000;
const PAST = new Date(Date.now() - 3_600_000).toISOString();

const SESSION_LIB = join(PLUGIN_ROOT, "templates", "hooks", "_lib", "session.ts");
const GATE_RECEIPT = join(PLUGIN_ROOT, "adapters", "_shared", "src", "gate_receipt.ts");
const TRACKER_GATE = join(
  PLUGIN_ROOT, "templates", "hooks", "_lib", "hooks", "pre-tracker-write-gate.ts",
);
/** The sibling's own deciding module, used for the parity anchor below. */
const SIBLING_MODULE = join(
  PLUGIN_ROOT, "adapters", "_shared", "src", "create_idempotency_probe.ts",
);

let fx: SpanFixture;
let FE = "";
let BE = "";
let scratch = "";
let elsewhereFrontDoor = "";
/** The `dpt-receipt:` line the front door printed for each checkout. */
let feLine = "";
let beLine = "";

// --------------------------------------------------------------- transcripts

function skillCall(id: string, ts: string): string[] {
  return [
    JSON.stringify({
      type: "assistant",
      timestamp: ts,
      message: { content: [{ type: "tool_use", id, name: "Skill", input: { skill: SKILL } }] },
    }),
    JSON.stringify({
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: id, is_error: false }] },
    }),
  ];
}

/** A Bash `tool_use` and the non-error `tool_result` it printed `lines` into. */
function bashCall(id: string, command: string, lines: readonly string[]): string[] {
  return [
    JSON.stringify({
      type: "assistant",
      timestamp: new Date().toISOString(),
      message: { content: [{ type: "tool_use", id, name: "Bash", input: { command } }] },
    }),
    JSON.stringify({
      type: "user",
      message: {
        content: [
          { type: "tool_result", tool_use_id: id, is_error: false, content: lines.join("\n") },
        ],
      },
    }),
  ];
}

let seq = 0;
function transcript(records: readonly string[]): string {
  const file = join(scratch, `t-${seq++}.jsonl`);
  writeFileSync(file, records.join("\n") + "\n");
  return file;
}

// ------------------------------------------------------------------- driver

interface Run {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function runGate(command: string, transcriptPath: string): Promise<Run> {
  const payload = {
    transcript_path: transcriptPath,
    cwd: FE,
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command },
    session_id: SID,
  };
  const proc = Bun.spawn(["/bin/bash", WRAPPER], {
    cwd: FE,
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT },
    stdin: new Response(JSON.stringify(payload)).body,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { exitCode: await proc.exited, stdout, stderr };
}

const commit = (root: string): string => `git -C ${root} commit -m x`;

// ------------------------------------------------------------------ fixture

beforeAll(() => {
  fx = makeSpanFixture("M_85e846rev");
  FE = fx.a;
  BE = fx.b;
  scratch = mkdtempSync(join(tmpdir(), "hs1-review-"));

  for (const root of [FE, BE]) {
    writeFileSync(join(root, "package.json"), '{"name":"fixture","version":"0.0.0","private":true}\n');
    git(root, "add", "package.json");
    git(root, "commit", "-q", "-m", "fixture: stack marker");
    writeFileSync(join(root, "README.md"), `# ${root}\n`);
    git(root, "add", "README.md");
  }

  // A file with the front door's NAME at a path this plugin does not own. The
  // shipped regex matches any `\S*` prefix, so today this "runs the front door"
  // as far as the guard is concerned.
  elsewhereFrontDoor = join(scratch, "elsewhere", "adapters", "_shared", "src", "gate_receipt.ts");
  mkdirSync(dirname(elsewhereFrontDoor), { recursive: true });
  writeFileSync(elsewhereFrontDoor, "// not this plugin's front door\n");

  // ONE front-door-written receipt per checkout, and the line each printed.
  // BE's receipt is REAL and VALID on disk: what these suites grade is which
  // Bash call announced it, not whether the file parses.
  forgetAnnouncements();
  clearReceipts(FE, SID);
  clearReceipts(BE, SID);
  writeGateReceipt(FE, "gate-check", SID);
  feLine = mintedAnnouncements().at(-1)!;
  writeGateReceipt(BE, "gate-check", SID);
  beLine = mintedAnnouncements().at(-1)!;
});

afterAll(() => {
  fx?.cleanup();
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

// ===========================================================================
// §A — a command that only MENTIONS the front door announces nothing.
//
// One row per command shape, each with the sibling gate's verdict on the SAME
// shape aimed at ITS deciding module. The forbid rows are the leak measured at
// c71a8e9 (A: exit 0); the permit rows keep the fix from passing by refusing
// everything, and two of them are red today because today's regex is narrower
// than the sibling's tokeniser in the one direction that matters to honest
// callers (`bun <path>` with no `run`).
// ===========================================================================

interface Shape {
  /** Named in the test title. */
  name: string;
  /** The Bash command whose result carries BE's announcement line. */
  gate: () => string;
  /** The SAME shape aimed at the sibling gate's own deciding module. */
  sibling: () => string;
  /** Whether the line in that command's result is an announcement at all. */
  announces: boolean;
}

function shapes(): Shape[] {
  return [
    {
      name: "PERMIT — one plain `bun run <front door> gate-check <BE>`",
      gate: () => `bun run ${FRONT_DOOR} gate-check ${BE}`,
      sibling: () => `bun run ${SIBLING_MODULE} decide ${BE}`,
      announces: true,
    },
    {
      name: "PERMIT — `bun <front door>` with no `run`, as the sibling accepts it",
      gate: () => `bun ${FRONT_DOOR} gate-check ${BE}`,
      sibling: () => `bun ${SIBLING_MODULE} decide ${BE}`,
      announces: true,
    },
    {
      name: "PERMIT — the `${CLAUDE_PLUGIN_ROOT}` spelling every skill and hook doc uses",
      gate: () =>
        'bun run "${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/gate_receipt.ts" gate-check ' + BE,
      sibling: () =>
        'bun run "${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/create_idempotency_probe.ts" decide ' + BE,
      announces: true,
    },
    {
      name: "FORBID — `echo bun run <front door> …`, which runs nothing",
      gate: () => `echo bun run ${FRONT_DOOR} gate-check ${BE}`,
      sibling: () => `echo bun run ${SIBLING_MODULE} decide ${BE}`,
      announces: false,
    },
    {
      name: "FORBID — the module named in a trailing `#` comment",
      gate: () => `ls # bun run ${FRONT_DOOR} gate-check ${BE}`,
      sibling: () => `ls # bun run ${SIBLING_MODULE} decide ${BE}`,
      announces: false,
    },
    {
      name: "FORBID — chained after `cd … &&`, where a second command can print anything",
      gate: () => `cd /tmp && bun run ${FRONT_DOOR} gate-check ${BE}`,
      sibling: () => `cd /tmp && bun run ${SIBLING_MODULE} decide ${BE}`,
      announces: false,
    },
    {
      name: "FORBID — a same-named `gate_receipt.ts` at a path this plugin does not own",
      gate: () => `bun run ${elsewhereFrontDoor} gate-check ${BE}`,
      sibling: () =>
        `bun run ${join(scratch, "elsewhere", "adapters", "_shared", "src", "create_idempotency_probe.ts")} decide ${BE}`,
      announces: false,
    },
  ];
}

describe("HS-1 review §A — the receipt front door is READ, not pattern-matched", () => {
  for (const shape of shapes()) {
    test(`${shape.name} → BE commit exits ${shape.announces ? 0 : 2}`, async () => {
      const tr = transcript([
        ...skillCall("tu1", PAST),
        ...bashCall("b1", shape.gate(), [beLine]),
      ]);
      const r = await runGate(commit(BE), tr);
      expect({ shape: shape.name, code: r.exitCode }).toEqual({
        shape: shape.name,
        code: shape.announces ? 0 : 2,
      });
      if (shape.announces) {
        expect(r.stderr).toBe("");
      } else {
        expect(r.stderr).toContain("Refusing:");
        expect(r.stderr).toContain(BE);
      }
    }, T);
  }

  // ANCHOR (green today, by construction). The rows above are a PARITY claim,
  // not an opinion: the `announces` column is the sibling gate's own reading of
  // the same shape. This clause pins that — so if the sibling's reading ever
  // changes, this suite says so instead of silently grading something else.
  test("ANCHOR — every row's expectation is the sibling tracker-write gate's own verdict", () => {
    const measured = shapes().map((s) => [s.name, invokedDecidingModule(s.sibling()) !== null]);
    const declared = shapes().map((s) => [s.name, s.announces]);
    expect(measured).toEqual(declared);
  });
});

// ===========================================================================
// §B — a result carrying more than one announcement line announces NONE of them.
//
// The 3 × 2 matrix: {genuine run for FE, commit BE} × {genuine run for FE,
// commit FE} × {genuine run for BE, commit BE}, each in both line orderings.
// Under the sibling's rule every cell is exit 2, because the doubled result
// announces nothing at all — including the genuine line, which is the whole
// point: a run whose result someone appended to cannot be told from one it did
// not. Today two cells exit 0 outright, and the other four exit 2 only because
// the first-announced-root rule happened to pick the other checkout — so those
// rows also assert that the refusal does NOT name that checkout as the run the
// receipt would belong to.
// ===========================================================================

describe("HS-1 review §B — two announcement lines in ONE result announce nothing", () => {
  const genuineRun = (root: string): string => `bun run ${FRONT_DOOR} gate-check ${root}`;

  test("genuine run for FE, GENUINE LINE FIRST [FE, BE], commit aimed at BE → exit 2, and FE is not named as the run it would belong to", async () => {
    const tr = transcript([
      ...skillCall("tu1", PAST),
      ...bashCall("b1", genuineRun(FE), [feLine, beLine]),
    ]);
    const r = await runGate(commit(BE), tr);
    expect(r.exitCode).toBe(2);
    // Today: `not-vouched` names FE as the claimant — the right code for the
    // wrong reason. Under the one-announcement rule nothing was announced, so
    // no checkout can be named as having recorded it.
    expect(r.stderr).not.toContain(FE);
    expect(r.stderr).not.toContain(realpathSync(FE));
  }, T);

  test("genuine run for FE, FORGED LINE FIRST [BE, FE], commit aimed at BE → exit 2", async () => {
    const tr = transcript([
      ...skillCall("tu1", PAST),
      ...bashCall("b1", genuineRun(FE), [beLine, feLine]),
    ]);
    const r = await runGate(commit(BE), tr);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("Refusing:");
  }, T);

  test("genuine run for FE, GENUINE LINE FIRST [FE, BE], commit aimed at FE → exit 2: the doubled result voids its own genuine line too", async () => {
    const tr = transcript([
      ...skillCall("tu1", PAST),
      ...bashCall("b1", genuineRun(FE), [feLine, beLine]),
    ]);
    const r = await runGate(commit(FE), tr);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("Refusing:");
  }, T);

  test("genuine run for FE, FORGED LINE FIRST [BE, FE], commit aimed at FE → exit 2, and BE is not named as the run it would belong to", async () => {
    const tr = transcript([
      ...skillCall("tu1", PAST),
      ...bashCall("b1", genuineRun(FE), [beLine, feLine]),
    ]);
    const r = await runGate(commit(FE), tr);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).not.toContain(BE);
    expect(r.stderr).not.toContain(realpathSync(BE));
  }, T);

  test("MIRROR — genuine run for BE, GENUINE LINE FIRST [BE, FE], commit aimed at BE → exit 2", async () => {
    const tr = transcript([
      ...skillCall("tu1", PAST),
      ...bashCall("b1", genuineRun(BE), [beLine, feLine]),
    ]);
    const r = await runGate(commit(BE), tr);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("Refusing:");
  }, T);

  test("MIRROR — genuine run for BE, FORGED LINE FIRST [FE, BE], commit aimed at BE → exit 2, and FE is not named as the run it would belong to", async () => {
    const tr = transcript([
      ...skillCall("tu1", PAST),
      ...bashCall("b1", genuineRun(BE), [feLine, beLine]),
    ]);
    const r = await runGate(commit(BE), tr);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).not.toContain(FE);
    expect(r.stderr).not.toContain(realpathSync(FE));
  }, T);

  // PERMIT SIBLINGS (green today, and they must STAY green). One run, one
  // announcement, one checkout: the honest path this whole rule exists to let
  // through. A fix that voided every doubled result by voiding every result
  // would red these.
  test("PERMIT SIBLING — genuine run for FE, its OWN line alone, commit aimed at FE → exit 0, empty stderr", async () => {
    const tr = transcript([
      ...skillCall("tu1", PAST),
      ...bashCall("b1", genuineRun(FE), [feLine]),
    ]);
    expect(await runGate(commit(FE), tr)).toMatchObject({ exitCode: 0, stderr: "" });
  }, T);

  test("PERMIT SIBLING — genuine run for BE, its OWN line alone, commit aimed at BE → exit 0, empty stderr", async () => {
    const tr = transcript([
      ...skillCall("tu1", PAST),
      ...bashCall("b1", genuineRun(BE), [beLine]),
    ]);
    expect(await runGate(commit(BE), tr)).toMatchObject({ exitCode: 0, stderr: "" });
  }, T);

  // PERMIT SIBLING — the two lines split across TWO results of two genuine
  // runs is the ordinary two-gate-run session, and it still permits. Only a
  // SINGLE result carrying two lines is void.
  test("PERMIT SIBLING — the same two lines in TWO separate genuine results still vouch, commit aimed at BE → exit 0", async () => {
    const tr = transcript([
      ...skillCall("tu1", PAST),
      ...bashCall("b1", genuineRun(FE), [feLine]),
      ...skillCall("tu2", new Date().toISOString()),
      ...bashCall("b2", genuineRun(BE), [beLine]),
    ]);
    expect(await runGate(commit(BE), tr)).toMatchObject({ exitCode: 0, stderr: "" });
  }, T);
});

// ===========================================================================
// §C — CONTROL (green today). The receipt FILE on its own is still not
// evidence, with no announcement anywhere in the transcript. This is the arm
// STE-614's review already closed; it is here so a reader can tell the new
// forbid rows from the old one, and so a "fix" that stopped reading the store
// at all would be visible.
// ===========================================================================

describe("HS-1 review §C — CONTROL: a receipt with no announcement at all", () => {
  test("CONTROL — BE holds a front-door-written receipt, the transcript announces nothing → exit 2", async () => {
    const tr = transcript([...skillCall("tu1", PAST)]);
    const r = await runGate(commit(BE), tr);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("Refusing:");
  }, T);

  test("CONTROL — the BE receipt this suite forges announcements for is REAL and front-door-written", () => {
    const dir = receiptsDirOf(BE, SID);
    const names = readdirSync(dir).filter((n) => n.endsWith(".json"));
    expect(names.length).toBe(1);
    const envelope = JSON.parse(readFileSync(join(dir, names[0]!), "utf-8"));
    expect(envelope.kind).toBe("gate");
    expect(envelope.subject).toBe(SKILL);
    expect(realpathSync(envelope.root)).toBe(realpathSync(BE));
    // …and the line this suite replays is that file's own announcement.
    expect(beLine.startsWith("dpt-receipt: ")).toBe(true);
    expect(beLine).toContain(dir);
  });
});

// ===========================================================================
// §D — `session.ts` source pins.
//
// The regex is not to be hardened; it is to be REPLACED by the reading the
// sibling already ships, injected across the boundary the way `receiptLeg`
// already is. Two things are graded here: that no command-text pattern decides
// the front door inside `session.ts`, and that the comment which claims parity
// with the sibling is either true or gone.
// ===========================================================================

/** Regex literals in `source`, as the TypeScript parser sees them. */
function regexLiterals(source: string): string[] {
  const p = new Project({ useInMemoryFileSystem: true });
  const f = p.createSourceFile("x.ts", source);
  return f
    .getDescendants()
    .filter((d) => d.getKindName() === "RegularExpressionLiteral")
    .map((d) => d.getText());
}

/** Regex literals that decide something from a MODULE PATH in the command text. */
function modulePathRegexes(source: string): string[] {
  return regexLiterals(source).filter((r) => /gate_receipt|adapters/.test(r));
}

const PARITY_CLAIM = "exactly as the sibling tracker-write gate reads its own deciding modules";

/**
 * Comment prose with its line wrapping removed, so a claim is graded by what it
 * SAYS rather than by where the eighty-column rule happened to break it. The
 * claim under test spans three lines in the shipped file.
 */
function unwrapped(source: string): string {
  return source.replace(/^[ \t]*\*[ \t]?/gm, "").replace(/\s+/g, " ");
}

describe("HS-1 review §D — session.ts decides nothing from a module-path pattern", () => {
  test("no regex literal in session.ts matches on the front door's module path", () => {
    expect(modulePathRegexes(readFileSync(SESSION_LIB, "utf-8"))).toEqual([]);
  });

  test("the sibling-parity claim in session.ts is TRUE, or it is gone", () => {
    const source = readFileSync(SESSION_LIB, "utf-8");
    const claims = unwrapped(source).includes(PARITY_CLAIM);
    // The claim may stay only if nothing in this file decides the front door
    // from a pattern of its own — which is what "reads it like the sibling"
    // means, the sibling having a tokeniser and a realpath comparison.
    expect({ claims, ownPattern: modulePathRegexes(source).length > 0 }).not.toEqual({
      claims: true,
      ownPattern: true,
    });
  });

  // CONTROL — the checker fires on a source built to hold the defect and stays
  // quiet on both honest arms, so the two clauses above cannot pass by being
  // blind. (A zero-hit scan is a claim until something proves it can hit.)
  test("CONTROL — the module-path regex checker hits a planted pattern and misses both honest arms", () => {
    const planted = 'const X = /(^|\\s)bun\\s+run\\s+\\S*adapters\\/_shared\\/src\\/gate_receipt\\.ts/;';
    expect(modulePathRegexes(planted).length).toBe(1);
    expect(modulePathRegexes('const X = /^dpt-receipt:\\s+(\\/\\S+)\\s+sha256:([0-9a-f]{64})$/;')).toEqual([]);
    // A module name in PROSE is not a pattern: the clause is about what decides,
    // not about what is mentioned.
    expect(modulePathRegexes("// gate_receipt.ts and adapters/_shared are only named here\nexport const x = 1;")).toEqual([]);
  });

  // CONTROL — the claim clause must be able to SEE the claim. It is wrapped
  // across three lines in the shipped file, so a reader that matched raw bytes
  // would report "no claim" and pass while the false comment sat there.
  test("CONTROL — the claim finder sees a claim that line wrapping split, and invents none", () => {
    const wrapped = [
      "/**",
      " * Deliberately narrow: a command that merely mentions the module (an echo, a",
      " * heredoc) announces nothing, exactly as the sibling tracker-write gate reads",
      " * its own deciding modules.",
      " */",
    ].join("\n");
    expect(unwrapped(wrapped)).toContain(PARITY_CLAIM);
    // Raw bytes miss it — which is how a reader could report "no claim" and pass
    // while the false comment sat there.
    expect(wrapped).not.toContain(PARITY_CLAIM);
    expect(unwrapped("/** a comment that claims nothing of the kind */")).not.toContain(PARITY_CLAIM);
  });

  // The constraint the design must be built AROUND, graded rather than
  // remembered: `session.ts` is copied to a temp directory and imported by its
  // own suite, so a relative import would break that suite outright. The front
  // door's reading therefore has to arrive as an injected VALUE, exactly as
  // `EvidenceTarget.receiptLeg` already does.
  test("session.ts keeps its ONE import — `node:fs` — and no relative import", () => {
    const p = new Project({ useInMemoryFileSystem: true });
    const f = p.createSourceFile("s.ts", readFileSync(SESSION_LIB, "utf-8"));
    const specifiers = f.getImportDeclarations().map((d) => d.getModuleSpecifierValue());
    expect(specifiers).toEqual(["node:fs"]);
    expect(specifiers.filter((s) => s.startsWith("."))).toEqual([]);
    // Nor by `require`, nor by dynamic `import(…)`.
    expect(f.getDescendants().filter((d) => d.getKindName() === "ImportKeyword").length).toBe(1);
  });

  test("CONTROL — the single-import checker sees an added relative import", () => {
    const p = new Project({ useInMemoryFileSystem: true });
    const f = p.createSourceFile(
      "s2.ts",
      'import { readFileSync } from "node:fs";\nimport { x } from "../../../adapters/_shared/src/gate_receipt";\nexport const y = 1;\n',
    );
    expect(f.getImportDeclarations().map((d) => d.getModuleSpecifierValue())).toEqual([
      "node:fs",
      "../../../adapters/_shared/src/gate_receipt",
    ]);
  });
});

// ===========================================================================
// §E — ONE reader, two gates.
//
// Two copies of "which command ran which module" is two chances for the gates
// to disagree about the one rule, and the disagreement is exactly what HS-1
// reopened through. The tokeniser is declared ONCE and both gates reach it.
// ===========================================================================

/** Every `.ts` file the plugin ships (tests and node_modules excluded). */
function shippedTsFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        walk(full);
      } else if (entry.name.endsWith(".ts")) {
        out.push(full);
      }
    }
  };
  for (const dir of ["adapters", "templates", "hooks", "scripts"]) {
    const full = join(PLUGIN_ROOT, dir);
    if (existsSync(full)) walk(full);
  }
  return out;
}

function resolveRelative(from: string, specifier: string): string | null {
  const base = join(dirname(from), specifier);
  for (const candidate of [base, `${base}.ts`, join(base, "index.ts")]) {
    if (existsSync(candidate) && candidate.endsWith(".ts")) return realpathSync(candidate);
  }
  return null;
}

/** Every `.ts` file reachable from `entry` by relative imports, transitively. */
function reachableFrom(entry: string): Set<string> {
  const seen = new Set<string>([realpathSync(entry)]);
  const queue = [realpathSync(entry)];
  const project = new Project({ useInMemoryFileSystem: true });
  let n = 0;
  while (queue.length > 0) {
    const file = queue.shift()!;
    const f = project.createSourceFile(`m${n++}.ts`, readFileSync(file, "utf-8"));
    const specs = [
      ...f.getImportDeclarations().map((d) => d.getModuleSpecifierValue()),
      ...f.getExportDeclarations().map((d) => d.getModuleSpecifierValue() ?? ""),
    ];
    for (const spec of specs) {
      if (!spec.startsWith(".")) continue;
      const target = resolveRelative(file, spec);
      if (target === null || seen.has(target)) continue;
      seen.add(target);
      queue.push(target);
    }
  }
  return seen;
}

describe("HS-1 review §E — the command tokeniser is declared once and shared", () => {
  test("`simpleCommandWords` is declared in exactly one shipped module", () => {
    const declaring = shippedTsFiles().filter((f) =>
      /export function simpleCommandWords\b/.test(readFileSync(f, "utf-8")),
    );
    expect(declaring.length).toBe(1);
  });

  test("both the tracker-write gate and the gate-receipt front door reach that module", () => {
    const declaring = shippedTsFiles().filter((f) =>
      /export function simpleCommandWords\b/.test(readFileSync(f, "utf-8")),
    );
    expect(declaring.length).toBe(1);
    const home = realpathSync(declaring[0]!);
    const reach = (entry: string): boolean => reachableFrom(entry).has(home);
    expect({ trackerGate: reach(TRACKER_GATE), gateReceipt: reach(GATE_RECEIPT) }).toEqual({
      trackerGate: true,
      gateReceipt: true,
    });
  });

  // CONTROL — the reachability walk can answer NO, and it follows a chain more
  // than one link long. Without this, "both reach it" could be a walk that
  // returns every file it is ever asked about.
  test("CONTROL — the walk follows a two-link chain and excludes an unimported sibling", () => {
    const dir = mkdtempSync(join(tmpdir(), "reach-"));
    try {
      writeFileSync(join(dir, "entry.ts"), 'import { b } from "./middle";\nexport const a = b;\n');
      writeFileSync(join(dir, "middle.ts"), 'export { b } from "./leaf";\n');
      writeFileSync(join(dir, "leaf.ts"), "export const b = 1;\n");
      writeFileSync(join(dir, "orphan.ts"), "export const c = 2;\n");
      const reached = reachableFrom(join(dir, "entry.ts"));
      expect(reached.has(realpathSync(join(dir, "leaf.ts")))).toBe(true);
      expect(reached.has(realpathSync(join(dir, "orphan.ts")))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ===========================================================================
// §F — declarations that describe what the code actually does.
//
// Three type-level lies ship at c71a8e9, and nothing catches them because the
// repository has no tsconfig and no typecheck gate:
//
//   1. `VouchWindow` (gate_receipt.ts:291) declares `start`/`end`; the consumer
//      at :533 reads `startLine`/`endLine`.
//   2. `GateEvidenceMiss` (:543) declares `why`/`how`; `gateReceiptMiss` (:676)
//      returns `root` as well.
//   3. `GateEvidenceTarget.receiptLeg` (:734) declares two parameters; the
//      session library calls it with three (session.ts:300).
//
// HOW THIS PIN CAN FAIL — stated, because a pin whose failure modes are unknown
// is not a gate. It typechecks with `ts-morph` (already a devDependency; no
// tsconfig is added), and it IGNORES the diagnostics that come from this
// repository shipping no ambient type packages — "Cannot find name 'process'",
// "…'Bun'", `ImportMeta.main`. That filter is the pin's soft spot: a real
// defect whose message happens to match it would be skipped, so the filter is
// itself graded by a control below. It can also fail for reasons that are not
// this milestone's: a dependency of gate_receipt.ts gaining an error of its own
// does NOT red these clauses (only the two named files are graded), but a
// TypeScript upgrade that reworded a diagnostic would.
// ===========================================================================

function ambient(d: Diagnostic): boolean {
  const message = String(d.getMessageText());
  return (
    // `process`, `Bun`, `Buffer` — names that come from type packages this
    // repository deliberately does not install.
    /Do you need to install type definitions/.test(message) ||
    /does not exist on type 'ImportMeta'/.test(message) ||
    // The runtime's OWN module namespaces, and only those: a missing
    // `./shell_invocations` is a real defect and stays reported.
    /Cannot find module '(node|bun):[^']*'/.test(message)
  );
}

interface TypeProbe {
  project: Project;
  probePath: string;
}

/** A project holding the two shipped files plus a probe that USES their types. */
function typeProbe(): TypeProbe {
  const project = new Project({
    compilerOptions: {
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      target: 99,
      module: 99,
      moduleResolution: 100,
      types: [],
    },
  });
  project.addSourceFileAtPath(GATE_RECEIPT);
  project.addSourceFileAtPath(SESSION_LIB);
  // The probe uses `GateEvidenceTarget` EXACTLY as `session.ts` uses it
  // (session.ts:300 `target.receiptLeg(root, windows, announcements)`, against
  // windows carrying transcript line numbers). If the declaration cannot
  // describe that call, the declaration is wrong — the call is what ships.
  const probePath = join(PLUGIN_ROOT, "tests", "__hs1_type_probe__.ts");
  project.createSourceFile(
    probePath,
    [
      `import type { GateEvidenceTarget, VouchWindow, ReceiptAnnouncement } from "${GATE_RECEIPT.replace(/\.ts$/, "")}";`,
      "",
      "export function useLegTheWaySessionDoes(target: GateEvidenceTarget, root: string) {",
      "  const windows: VouchWindow[] = [{ start: 0, end: 1, startLine: 0, endLine: 1 }];",
      '  const announcements: ReceiptAnnouncement[] = [{ path: "/p", digest: "d", line: 0 }];',
      "  return target.receiptLeg(root, windows, announcements);",
      "}",
      "",
    ].join("\n"),
    { overwrite: true },
  );
  project.resolveSourceFileDependencies();
  return { project, probePath };
}

function realDiagnosticsIn(probe: TypeProbe, file: string): string[] {
  return probe.project
    .getPreEmitDiagnostics()
    .filter((d) => d.getSourceFile()?.getFilePath() === file && !ambient(d))
    .map((d) => `${d.getLineNumber()}: ${String(d.getMessageText())}`);
}

describe("HS-1 review §F — the declarations describe the code", () => {
  test("gate_receipt.ts typechecks: `VouchWindow` and `GateEvidenceMiss` declare what the module reads and returns", () => {
    expect(realDiagnosticsIn(typeProbe(), GATE_RECEIPT)).toEqual([]);
  }, T);

  test("`GateEvidenceTarget.receiptLeg` admits the three-argument call session.ts makes", () => {
    const probe = typeProbe();
    expect(realDiagnosticsIn(probe, probe.probePath)).toEqual([]);
  }, T);

  test("session.ts typechecks (standing pin — the fix edits this file)", () => {
    expect(realDiagnosticsIn(typeProbe(), SESSION_LIB)).toEqual([]);
  }, T);

  // CONTROL — the ambient filter is the pin's soft spot, so grade it: a planted
  // error of the same SHAPE as the three defects is reported, and an ambient
  // one is not. Without this, "no diagnostics" could mean "no diagnostics were
  // ever going to be reported".
  test("CONTROL — the ambient filter reports a planted defect and hides only the ambient noise", () => {
    const probe = typeProbe();
    const planted = probe.project.createSourceFile(
      join(PLUGIN_ROOT, "tests", "__hs1_filter_control__.ts"),
      [
        "interface W { start: number }",
        "export function read(w: W) { return (w as W & Record<never, never>).startLine; }",
        "export function arity(f: (a: string) => void) { return f('a', 'b'); }",
        "export const ambientNoise = process.env.PATH;",
        "",
      ].join("\n"),
      { overwrite: true },
    );
    const reported = probe.project
      .getPreEmitDiagnostics()
      .filter((d) => d.getSourceFile()?.getFilePath() === planted.getFilePath());
    expect(reported.filter((d) => !ambient(d)).length).toBeGreaterThanOrEqual(2);
    expect(reported.some((d) => ambient(d))).toBe(true);
  }, T);
});
