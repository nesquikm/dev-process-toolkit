// M_4df444 / STE-594 — every spawned session carries a recorded id (AC.1, the
// enumerating meta-test), and the Termination cleanup fence's static shape
// (AC.4, AC.5, AC.6).
//
// THE SPAWN SET IS DERIVED on every run by `tests/_spawn_fences.ts`, never
// hand-counted. It holds every fenced `claude -p` COMMAND line in
// `.claude/skills/conformance-loop/SKILL.md` and
// `.claude/skills/smoke-test/SKILL.md`. Echo text, Remedy prose and heredoc
// bodies are never spawns.
//
// THE CONTRACT each spawn must meet, per logical command line (backslash
// continuations joined):
//   1. `--session-id "${VAR}"`: the id is a shell variable, never a literal,
//      and `-p` stays the first flag so the shared parser keeps finding the
//      line;
//   2. before it, in the same fence, a ledger append for the SAME variable,
//      one append per spawn:
//        bun <…>/smoke_run_ledger.ts append --run <id> --leg <leg> --session "${VAR}" …
//   3. before that append, an assignment that MINTS `VAR` in the spawning shell
//      (`VAR=$(uuidgen …)`, or the ledger module's `mint`).
// The behaviour itself (a recorded append precedes each stub `claude`, and
// carries the same id) is proven by RUNNING the fences, in
// tests/m_4df444-ste-594-spawn-ledger-run.test.ts.

import { describe, expect, test } from "bun:test";

import { SMOKE_LEGS } from "../adapters/_shared/src/smoke_fixture_groups";
import {
  cleanupDeleteLine,
  cleanupFencesAnywhere,
  CLOSING_SUMMARY_HEADING_LINE,
  GREEN_FENCE,
  LOOP_TEXT,
  logicalCodeLines,
  REGISTERED_LEGS,
  terminationCleanupFence,
  TERMINATION_HEADING_LINE,
  type Logical,
} from "./_ste594_harness";
import {
  allFences,
  classify,
  isSpawnFence,
  KILL0_RE,
  label,
  parseFences,
  phaseAFence,
  readDoc,
  SPAWN_LINE_RE,
  spawnLineIndices,
  type DocId,
  type Fence,
} from "./_spawn_fences";

// ===========================================================================
// The pairing contract.
// ===========================================================================

const VAR = "([A-Za-z_][A-Za-z0-9_]*)";
const SESSION_ID_RE = new RegExp(`--session-id(?:=|\\s+)["']?\\$\\{?${VAR}`);
const APPEND_RE = /smoke_run_ledger\.ts["']?\s+append\b/;
const APPEND_SESSION_RE = new RegExp(`--session(?:-id)?(?:=|\\s+)["']?\\$\\{?${VAR}`);
const MINT_RE = /uuidgen|randomUUID|\bmint\b/;

interface Pairing {
  spawn: Logical;
  sessionVar: string | null;
  append: Logical | null;
  mint: Logical | null;
}

function appendVar(text: string): string | null {
  if (!APPEND_RE.test(text)) return null;
  return APPEND_SESSION_RE.exec(text)?.[1] ?? null;
}

function assigns(text: string, v: string): boolean {
  return new RegExp(`(?:^|[\\s;&|(])(?:export\\s+|local\\s+|readonly\\s+)?${v}=`).test(text);
}

function pairSpawns(f: Fence): Pairing[] {
  const logical = logicalCodeLines(f);
  const spawnStarts = new Set(spawnLineIndices(f));
  const used = new Set<number>();
  const out: Pairing[] = [];
  logical.forEach((l, li) => {
    if (!spawnStarts.has(l.start)) return;
    const v = SESSION_ID_RE.exec(l.text)?.[1] ?? null;
    let append: Logical | null = null;
    let mint: Logical | null = null;
    if (v !== null) {
      for (let j = li - 1; j >= 0; j--) {
        const cand = logical[j]!;
        if (appendVar(cand.text) !== v) continue;
        if (!used.has(cand.start)) {
          append = cand;
          used.add(cand.start);
        }
        break; // the NEAREST append for this id is the only one that can pair
      }
      if (append !== null) {
        for (let j = logical.indexOf(append) - 1; j >= 0; j--) {
          if (assigns(logical[j]!.text, v)) {
            mint = logical[j]!;
            break;
          }
        }
      }
    }
    out.push({ spawn: l, sessionVar: v, append, mint });
  });
  return out;
}

function synthetic(lines: string[]): Fence {
  return { doc: "smoke-test", openLine: 1, closeLine: lines.length + 2, info: "bash", lines, body: lines.join("\n"), region: "" };
}

const MINT = 'SID=$(uuidgen | tr "[:upper:]" "[:lower:]")';
const APPEND = 'bun "${P}/adapters/_shared/src/smoke_run_ledger.ts" append --run "${RUN}" --leg linear --session "${SID}"';
const SPAWN = ['claude -p /x \\', '  --session-id "${SID}" \\', "  < /dev/null > /tmp/l 2>&1 &"];

describe("the pairing contract — CONTROLS (the matcher discriminates)", () => {
  test("a minted, recorded spawn pairs", () => {
    const [p] = pairSpawns(synthetic([MINT, APPEND, ...SPAWN]));
    expect(p!.sessionVar).toBe("SID");
    expect(p!.append).not.toBeNull();
    expect(p!.mint?.text).toMatch(MINT_RE);
  });

  test("continuations are joined: --session-id on a later physical line of the spawn counts", () => {
    const [p] = pairSpawns(synthetic([MINT, APPEND, ...SPAWN]));
    expect(p!.spawn.end).toBeGreaterThan(p!.spawn.start);
  });

  test("a spawn with no --session-id is flagged", () => {
    const [p] = pairSpawns(synthetic([MINT, APPEND, "claude -p /x < /dev/null > /tmp/l 2>&1 &"]));
    expect(p!.sessionVar).toBeNull();
  });

  test("a spawn whose id is a literal, not a minted variable, is flagged", () => {
    const [p] = pairSpawns(synthetic(["claude -p /x --session-id 0b7e3c1a-5d2f-4a8e-9c61-2f4d8e7a9b10 &"]));
    expect(p!.sessionVar).toBeNull();
  });

  test("--session-id with no append before it is flagged", () => {
    const [p] = pairSpawns(synthetic([MINT, ...SPAWN]));
    expect(p!.append).toBeNull();
  });

  test("an append for a DIFFERENT id is flagged", () => {
    const [p] = pairSpawns(synthetic([MINT, APPEND.replace('"${SID}"', '"${OTHER}"'), ...SPAWN]));
    expect(p!.append).toBeNull();
  });

  test("an append placed AFTER the spawn is flagged", () => {
    const [p] = pairSpawns(synthetic([MINT, ...SPAWN, APPEND]));
    expect(p!.append).toBeNull();
  });

  test("two spawns sharing ONE append are flagged: the second has none of its own", () => {
    const ps = pairSpawns(synthetic([MINT, APPEND, ...SPAWN, ...SPAWN]));
    expect(ps.map((p) => p.append !== null)).toEqual([true, false]);
  });

  test("an append naming smoke_run_ledger.ts only in an echo is not an append", () => {
    const [p] = pairSpawns(synthetic([MINT, 'echo "not run" # smoke_run_ledger.ts', ...SPAWN]));
    expect(p!.append).toBeNull();
  });

  test("an id assigned from a constant is not minted", () => {
    const [p] = pairSpawns(synthetic(['SID="fixed"', APPEND, ...SPAWN]));
    expect(p!.mint === null || !MINT_RE.test(p!.mint.text)).toBe(true);
  });

  test("heredoc body text naming claude -p is never a spawn", () => {
    const f = synthetic(["cat <<'EOF'", "claude -p /x --session-id \"${SID}\" &", "EOF"]);
    expect(pairSpawns(f)).toEqual([]);
  });
});

// ===========================================================================
// AC-STE-594.1 — the site set, derived and anchored.
// ===========================================================================

const SPAWN_FENCES = allFences().filter(isSpawnFence);
const LOOP = parseFences("conformance-loop", readDoc("conformance-loop"));
const SMOKE = parseFences("smoke-test", readDoc("smoke-test"));

function spawnTexts(fs: readonly Fence[]): string[] {
  return fs.flatMap((f) => {
    const starts = new Set(spawnLineIndices(f));
    return logicalCodeLines(f).filter((l) => starts.has(l.start)).map((l) => l.text);
  });
}

describe("AC-STE-594.1 — the spawn set is parsed, never hand-counted", () => {
  test("every fenced `claude … -p` command line is in the parsed set: no flag order can hide a spawn from it", () => {
    const hidden: string[] = [];
    for (const f of allFences()) {
      for (const l of logicalCodeLines(f)) {
        if (!/^\s*(?:\{\s*)?claude\b/.test(l.text) || !/\s-p\b/.test(l.text)) continue;
        if (!SPAWN_LINE_RE.test(f.lines[l.start]!)) hidden.push(`${label(f)} body L${l.start + 1}: ${l.text.trim()}`);
      }
    }
    expect(hidden, "keep `-p` first: `claude -p … --session-id \"${ID}\"`").toEqual([]);
  });

  test("every spawn family is present in the parsed set (anchors, not counts)", () => {
    const a = phaseAFence(LOOP);
    expect(a, "the Phase A fence").toBeDefined();
    expect(spawnLineIndices(a!).length, "one Phase A spawn per registered leg").toBe(REGISTERED_LEGS.length);
    const loopTexts = spawnTexts(LOOP.filter(isSpawnFence));
    const phaseB = LOOP.find((f) => isSpawnFence(f) && f.body.includes("LOG_SW") && f.body.includes("LOG_IMPL"));
    expect(phaseB, "the Phase B --auto-fix fence").toBeDefined();
    expect(spawnLineIndices(phaseB!).length, "Phase B spawns /spec-write and /implement").toBeGreaterThanOrEqual(2);
    expect(loopTexts.some((t) => t.includes("/dev-process-toolkit:implement"))).toBe(true);

    const smokeTexts = spawnTexts(SMOKE.filter(isSpawnFence));
    for (const anchor of ["/dev-process-toolkit:gate-check", "/dev-process-toolkit:spec-review", "/dev-process-toolkit:simplify"]) {
      expect(smokeTexts.some((t) => t.includes(anchor)), anchor).toBe(true);
    }
    for (const log of ["-setup.log", "-spec-write.log", "-implement.log", "setup.attempt1.log", "setup.attempt2.log"]) {
      expect(smokeTexts.some((t) => t.includes(log)), `the spawn writing ${log}`).toBe(true);
    }
    expect(
      SMOKE.some((f) => isSpawnFence(f) && f.body.includes("ASSERT_RUNNER")),
      "the Phase 8 foreground spawn",
    ).toBe(true);
  });
});

// ===========================================================================
// AC-STE-594.1 — the enumerating meta-test.
// ===========================================================================

const ALL_PAIRINGS = SPAWN_FENCES.map((f) => ({ f, pairings: pairSpawns(f) }));

describe("AC-STE-594.1 — spawn literals and paired appends, counted per document", () => {
  for (const doc of ["conformance-loop", "smoke-test"] as DocId[]) {
    test(`${doc}: every claude -p spawn literal has its own paired ledger append`, () => {
      const rows = ALL_PAIRINGS.filter((x) => x.f.doc === doc).flatMap((x) =>
        x.pairings.map((p) => ({ where: `${label(x.f)} body L${p.spawn.start + 1}`, p })),
      );
      expect(rows.length, `${doc}: the parsed spawn set is empty`).toBeGreaterThan(0);
      const withId = rows.filter((r) => r.p.sessionVar !== null).length;
      const paired = rows.filter((r) => r.p.append !== null).length;
      const unpaired = rows.filter((r) => r.p.append === null).map((r) => r.where);
      expect(
        { spawns: rows.length, withSessionId: withId, pairedAppends: paired, unpaired },
        `${doc}: spawns without a --session-id and a paired append`,
      ).toEqual({ spawns: rows.length, withSessionId: rows.length, pairedAppends: rows.length, unpaired: [] });
    });
  }
});

for (const { f, pairings } of ALL_PAIRINGS) {
  for (const p of pairings) {
    const where = `${label(f)} body L${p.spawn.start + 1}`;
    describe(`AC-STE-594.1 — ${where}`, () => {
      test("the spawn carries --session-id \"${VAR}\"", () => {
        expect(p.sessionVar, `no --session-id "\${VAR}" on ${JSON.stringify(p.spawn.text.trim().slice(0, 160))}`).not.toBeNull();
      });

      test("a ledger append for the same id precedes it, one append per spawn", () => {
        expect(p.append, `no \`smoke_run_ledger.ts append … --session "\${${p.sessionVar ?? "VAR"}}"\` before the spawn at ${where}`).not.toBeNull();
      });

      test("the id is minted in the spawning shell before its append", () => {
        expect(p.mint?.text ?? "", `no \`${p.sessionVar ?? "VAR"}=$(uuidgen …)\` before the append`).toMatch(MINT_RE);
      });

      test("the append records the run and the leg", () => {
        const text = p.append?.text ?? "";
        expect(text).toMatch(/(?:^|\s)--run(?:=|\s+)\S/);
        expect(text).toMatch(/(?:^|\s)--leg(?:=|\s+)\S/);
      });
    });
  }
}

// ===========================================================================
// AC-STE-594.4 / .5 / .6 — the Termination cleanup fence, statically.
// ===========================================================================

const TERM = terminationCleanupFence();

function requireTerm(): Fence {
  expect(
    TERM,
    "no single fence inside § Termination, after the green probe and before § Closing summary, calls " +
      "`bun …/smoke_session_cleanup.ts … --delete` on a code line",
  ).toBeDefined();
  return TERM!;
}

function codeLines(f: Fence): string[] {
  const kinds = classify(f.lines);
  return f.lines.filter((_, i) => kinds[i] === "code");
}

describe("AC-STE-594.4 — Termination gains exactly one cleanup fence, after the green probe", () => {
  test("CONTROL: § Termination, § Closing summary and the green probe fence are all found", () => {
    expect(TERMINATION_HEADING_LINE).toBeGreaterThan(0);
    expect(CLOSING_SUMMARY_HEADING_LINE).toBeGreaterThan(TERMINATION_HEADING_LINE);
    expect(GREEN_FENCE).toBeDefined();
  });

  test("the loop calls the cleanup in delete mode from exactly one fence, and that fence sits in § Termination after the green probe", () => {
    expect(cleanupFencesAnywhere().map(label)).toEqual([label(requireTerm())]);
  });

  test("it reads each leg's verdict ARTIFACT through smoke_verdict.ts, and never an rc-file or an rc-folding verb", () => {
    const f = requireTerm();
    expect(f.body).toContain("smoke_verdict.ts");
    expect(f.body).toContain("dpt-smoke-verdict-");
    const code = codeLines(f);
    expect(code.filter((l) => /\.rc\b/.test(l)), "an rc-file read").toEqual([]);
    expect(code.filter((l) => /smoke_verdict\.ts["']?\s+(?:classify|reconcile)\b/.test(l)), "classify/reconcile fold the rc in").toEqual([]);
  });

  test("it iterates the SELECTED legs", () => {
    expect(codeLines(requireTerm()).join("\n")).toMatch(/\$\{?SELECTED_LEGS\b/);
  });

  test("the closing summary carries the manual cleanup command for a kept leg", () => {
    const lines = LOOP_TEXT.replace(/\r\n/g, "\n").split("\n");
    const from = CLOSING_SUMMARY_HEADING_LINE;
    const to = lines.findIndex((l, i) => i >= from && /^##\s/.test(l));
    const region = lines.slice(from, to < 0 ? undefined : to).join("\n");
    expect(region).toContain("smoke_session_cleanup");
    expect(region).toMatch(/--delete\b/);
  });

  test("CONTROL: SMOKE_LEGS and the Phase A groups name the same legs", () => {
    expect([...REGISTERED_LEGS].sort()).toEqual([...SMOKE_LEGS].sort());
  });
});

describe("AC-STE-594.5 — cleanup waits on kill -0, after orphan adoption", () => {
  test("the cleanup fence comes after the Orphan adoption block", () => {
    const orphanLine = LOOP_TEXT.replace(/\r\n/g, "\n").split("\n").findIndex((l) => /^\*\*Orphan adoption\b/.test(l)) + 1;
    expect(orphanLine, "control: the Orphan adoption paragraph").toBeGreaterThan(0);
    expect(requireTerm().openLine).toBeGreaterThan(orphanLine);
  });

  test("a `kill -0` liveness wait precedes the delete call in the fence", () => {
    const f = requireTerm();
    const del = cleanupDeleteLine(f);
    expect(del).not.toBeNull();
    const kinds = classify(f.lines);
    const firstKill0 = f.lines.findIndex((l, i) => kinds[i] === "code" && KILL0_RE.test(l));
    expect(firstKill0, "no kill -0 probe in the fence").toBeGreaterThanOrEqual(0);
    expect(firstKill0).toBeLessThan(del!.start);
  });
});

describe("AC-STE-594.6 — findings and approval are never cleanup targets", () => {
  test("no code line in the cleanup fence removes a findings file or the approval record", () => {
    const bad = codeLines(requireTerm()).filter(
      (l) => /\brm\b/.test(l) && /dpt-smoke-findings|approval/.test(l),
    );
    expect(bad).toEqual([]);
  });
});
