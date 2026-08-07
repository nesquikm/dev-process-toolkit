// M116 / STE-420 — "make driver abort verdicts machine-checkable when the exit
// code cannot carry them".
//
// THE DEFECT, verified on disk before this file was written:
//
//   `/conformance-loop` Phase A's documented gate reads each leg's rc-file and
//   aborts on non-zero (`.claude/skills/conformance-loop/SKILL.md` § "RC
//   collection"). The driver is an LLM inside `claude -p` and CANNOT set the
//   process exit status — `claude -p` returns 0 for any session that finishes
//   without a harness error. On 2026-07-27 the Jira leg's final message led
//   with `SMOKE-ABORT: incomplete grandchild chain` and its own summary read
//   `VERDICT: FAIL (rc=1)` while its rc-file contained `0`; the Linear leg
//   declared `SMOKE-TEST FAIL` and also wrote `0`. The gate did not fire. It
//   is dead code.
//
// THE FIX SHAPE these tests pin: a machine-readable verdict artifact at a
// per-tracker path, plus an rc reconciliation applied by the Phase A spawn
// wrapper so every EXISTING rc-file consumer becomes truthful without the
// documented gate changing shape.
//
// A CORRECTION TO THE FR, also verified on disk: the FR's Technical Design
// claims the `/smoke-test` final-message self-check "already computes both
// abort triggers". It does not — the fenced snippet under that clause computes
// ONLY the live-pidfile trigger. The incomplete-chain trigger is prose-only and
// its deterministic source is Phase 2.Y's `assertChainIntegrity` findings. The
// emitter must therefore consume BOTH inputs; § AC-STE-420.1 pins that
// directly, driving `buildSmokeVerdict` from real `assertChainIntegrity`
// output with an EMPTY live-pidfile list (a pidfile-only emitter fails it).
//
// AC-STE-420.5 HAZARD — READ BEFORE EDITING THE SKILLS.
//   Six meta-tests in `tests/m112-ste-414-nontty-hard-gate.test.ts` and
//   `tests/harness-driver-abort-reap-parity.test.ts` pin the existing
//   "MUST exit non-zero" prose byte-for-byte, and m112's `instructionOffset`
//   returns -1 (⇒ FAIL) when MORE THAN ONE sentence in a clause matches an
//   anchor role. So AC.5 is satisfied by making the claim TRUE via the spawn
//   wrapper's reconciliation plus an ADDITIVE sentence naming the artifact as
//   authoritative — never by rewriting the pinned sentences. § "survival
//   tripwires" below fires first if anyone tries, and the single-anchor
//   tripwire fires if the additive sentence reads as a second reap/teardown
//   instruction.
//
// SIBLING-FR OVERLAP: STE-423 is concurrently tracker-scoping the pidfile
// globs in the same clauses. Every glob-shaped predicate here is written
// tolerant of both `/tmp/dpt-smoke-*.pid` and `/tmp/dpt-smoke-<tracker>-*.pid`
// so the two FRs do not fight over the same bytes.

import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { assertChainIntegrity } from "../adapters/_shared/src/smoke_child_capture";
// STE-446: the registered leg set is the sole authority for how many brace
// groups the Phase A spawn fence must carry and which tracker token each owns.
import { SMOKE_LEGS } from "../adapters/_shared/src/smoke_fixture_groups";
import {
  buildSmokeVerdict,
  formatSmokeVerdict,
  parseSmokeVerdict,
  readSmokeVerdict,
  reconcileLegRc,
  smokeVerdictPath,
  type SmokeVerdictRead,
} from "../adapters/_shared/src/smoke_verdict";

// ---------------------------------------------------------------------------
// Fixtures / helpers
// ---------------------------------------------------------------------------

const repoRoot = join(import.meta.dir, "..", "..", "..");
const smokePath = join(repoRoot, ".claude", "skills", "smoke-test", "SKILL.md");
const loopPath = join(
  repoRoot,
  ".claude",
  "skills",
  "conformance-loop",
  "SKILL.md",
);

function readIfPresent(path: string): string | null {
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8");
}

// Dogfood-only surface: a plugin-only checkout has neither harness SKILL, so
// those suites skip cleanly instead of failing. Same idiom as m112.
const smoke = readIfPresent(smokePath);
const loop = readIfPresent(loopPath);
const describeIfSmoke = smoke === null ? describe.skip : describe;
const describeIfLoop = loop === null ? describe.skip : describe;
const describeIfBoth = smoke === null || loop === null ? describe.skip : describe;

function withTmpDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "ste-420-verdict-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A minimal stream-json capture carrying a top-level `result` event. */
const HEALTHY_CAPTURE = `${JSON.stringify({
  type: "assistant",
  message: { content: [{ type: "text", text: "done" }] },
})}\n${JSON.stringify({ type: "result", subtype: "success" })}\n`;

// ---------------------------------------------------------------------------
// SKILL slicing helpers (kept local — importing a bun:test file would
// re-register the other suites' assertions inside this run).
// ---------------------------------------------------------------------------

/** Every ```bash fence body inside a slice. */
function bashFences(section: string): string[] {
  const fences: string[] = [];
  const re = /```bash\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(section)) !== null) fences.push(match[1]!);
  return fences;
}

/** Drop fenced blocks (keeping paragraph boundaries). */
function proseOnly(section: string): string {
  return section.replace(/```[a-z]*\n[\s\S]*?```/g, "\n\n");
}

function flatProse(clause: string): string {
  return proseOnly(clause).replace(/\n+/g, " ");
}

function proseSentences(clause: string): string[] {
  return flatProse(clause).split(/(?<=[.!?])\s+/);
}

/**
 * A bold-lead clause (`**Final-message self-check …**`) and everything under it
 * up to the NEXT bold-lead line or heading. Fence-aware, so the clause's own
 * ```bash block is carried along with it. Mirrors m112's `boldClause`.
 */
function boldClause(body: string, leadIn: string): string {
  const lines = body.split("\n");
  const start = lines.findIndex((line) => line.startsWith(leadIn));
  if (start === -1) return "";
  let inFence = false;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i]!.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (/^#{2,6} /.test(lines[i]!)) return lines.slice(start, i).join("\n");
    if (/^\*\*[^*\n]+\*\*/.test(lines[i]!) && !lines[i]!.startsWith(leadIn)) {
      return lines.slice(start, i).join("\n");
    }
  }
  return lines.slice(start).join("\n");
}

/**
 * Split a whole SKILL body into bold-lead clauses / heading-delimited chunks,
 * fence-aware. Used by the AC.5 completeness sweep so no clause asserting an
 * unsatisfiable exit-code guarantee can hide between the two we know about.
 */
function boldClauses(body: string): string[] {
  const lines = body.split("\n");
  const chunks: string[] = [];
  let current: string[] = [];
  let inFence = false;
  for (const line of lines) {
    if (line.startsWith("```")) {
      inFence = !inFence;
      current.push(line);
      continue;
    }
    const isBoundary =
      !inFence && (/^#{2,6} /.test(line) || /^\*\*[^*\n]+\*\*/.test(line));
    if (isBoundary) {
      if (current.length > 0) chunks.push(current.join("\n"));
      current = [line];
      continue;
    }
    current.push(line);
  }
  if (current.length > 0) chunks.push(current.join("\n"));
  return chunks;
}

// --- anchor predicates (tolerant of STE-423's tracker-scoped globs) ---------

/** The reap: a real (non-`kill -0`) kill plus `rm -f <some>.pid`. */
function carriesReapAnchor(sentence: string): boolean {
  return (
    /\bkill\b(?!\s*-\s*0\b)/i.test(sentence) &&
    /\brm -f \S*\.pid\b/.test(sentence)
  );
}

/** The destructive teardown: `rm -rf` AND archive/close. */
function carriesTeardownAnchor(sentence: string): boolean {
  return /\brm -rf\b/.test(sentence) && /archive\/close/i.test(sentence);
}

/** The identity check: a `ps`-based confirmation the PID is a `claude` process. */
function carriesIdentityAnchor(sentence: string): boolean {
  return /\bps -p\b/.test(sentence);
}

function countSentencesCarrying(
  clause: string,
  carries: (sentence: string) => boolean,
): number {
  return proseSentences(clause).filter(carries).length;
}

/** The additive AC.5 sentence: names the verdict artifact as authoritative. */
function namesArtifactAsAuthoritative(clause: string): boolean {
  return proseSentences(clause).some(
    (sentence) =>
      /verdict artifact|dpt-smoke-verdict/i.test(sentence) &&
      /\bauthoritative\b/i.test(sentence),
  );
}

/**
 * The clause admits the runtime limit the FR names: the process exit status
 * cannot carry the driver's verdict. Without this the clause still reads as an
 * unsatisfiable guarantee even with an artifact bolted on beside it.
 */
function admitsExitCodeCannotCarryTheVerdict(clause: string): boolean {
  return proseSentences(clause).some(
    (sentence) =>
      /\b(cannot|can't|is unable to|no way to)\b/i.test(sentence) &&
      /\bexit (?:code|status)\b|\brc\b/i.test(sentence),
  );
}

/** The verdict-artifact path template, in either concrete or placeholder form. */
const VERDICT_PATH_RE =
  /\/tmp\/dpt-smoke-verdict-(?:<tracker>|\$\{TRACKER\}|linear|jira)\.json/;

// ===========================================================================
// AC-STE-420.1 — an aborting leg writes a machine-readable verdict artifact at
// a documented per-tracker path recording outcome + abort trigger.
// ===========================================================================

describe("AC-STE-420.1 — verdict artifact: per-tracker path", () => {
  test("the path is tracker-scoped and documented as /tmp/dpt-smoke-verdict-<tracker>.json", () => {
    expect(smokeVerdictPath("linear")).toBe(
      "/tmp/dpt-smoke-verdict-linear.json",
    );
    expect(smokeVerdictPath("jira")).toBe("/tmp/dpt-smoke-verdict-jira.json");
  });

  test("no two trackers can be handed the same artifact path", () => {
    expect(smokeVerdictPath("linear")).not.toBe(smokeVerdictPath("jira"));
  });

  test("a tracker segment that would escape the scope is rejected (STE-423 isolation)", () => {
    expect(() => smokeVerdictPath("../jira")).toThrow();
    expect(() => smokeVerdictPath("")).toThrow();
  });
});

describe("AC-STE-420.1 — verdict artifact: outcome + trigger are recorded", () => {
  test("an abort verdict serializes both the outcome and the trigger, and round-trips", () => {
    const verdict = buildSmokeVerdict({
      livePidfiles: ["/tmp/dpt-smoke-jira-implement.pid"],
      chainFindings: [],
    });
    expect(verdict.outcome).toBe("abort");
    expect(typeof verdict.trigger).toBe("string");

    const serialized = formatSmokeVerdict(verdict);
    const parsed = JSON.parse(serialized) as Record<string, unknown>;
    expect(parsed.outcome).toBe("abort");
    expect(String(parsed.trigger)).toBe(verdict.trigger!);

    const reparsed = parseSmokeVerdict(serialized);
    expect(reparsed).toEqual(verdict);
  });

  test("a pass verdict carries the pass outcome and no abort trigger", () => {
    const verdict = buildSmokeVerdict({ livePidfiles: [], chainFindings: [] });
    expect(verdict.outcome).toBe("pass");
    expect(verdict.trigger ?? "").toBe("");
  });
});

describe("AC-STE-420.1 — the emitter consumes BOTH abort triggers", () => {
  // *** The FR-correction pin. *** The `/smoke-test` self-check fence computes
  // ONLY the live-pidfile trigger today; the incomplete-chain trigger's
  // deterministic source is Phase 2.Y's `assertChainIntegrity`. An emitter
  // wired to the pidfile scan alone returns `pass` here.
  test("trigger 1 — incomplete chain: real assertChainIntegrity findings with ZERO live pidfiles still abort", () => {
    withTmpDir((dir) => {
      const findings = assertChainIntegrity([
        { child: "implement", path: join(dir, "dpt-smoke-jira-implement.log") },
        {
          child: "spec-review",
          path: join(dir, "dpt-smoke-jira-spec-review.log"),
        },
      ]);
      expect(findings.length).toBe(2); // sanity: the source really produced findings

      const verdict = buildSmokeVerdict({
        livePidfiles: [],
        chainFindings: findings,
      });
      expect(verdict.outcome).toBe("abort");
      expect(verdict.trigger ?? "").toMatch(/incomplete/i);
      expect(verdict.trigger ?? "").toMatch(/chain/i);
    });
  });

  test("trigger 2 — live pidfile: a live pidfile with a chain-clean run still aborts", () => {
    withTmpDir((dir) => {
      const logPath = join(dir, "dpt-smoke-linear-setup.log");
      writeFileSync(logPath, HEALTHY_CAPTURE, "utf8");
      const findings = assertChainIntegrity([{ child: "setup", path: logPath }]);
      expect(findings).toEqual([]); // sanity: chain leg is genuinely clean

      const verdict = buildSmokeVerdict({
        livePidfiles: ["/tmp/dpt-smoke-linear-setup.pid"],
        chainFindings: findings,
      });
      expect(verdict.outcome).toBe("abort");
      expect(verdict.trigger ?? "").toMatch(/live/i);
      expect(verdict.trigger ?? "").toMatch(/pidfile/i);
    });
  });

  test("both triggers armed: the recorded trigger names both, not just the first", () => {
    withTmpDir((dir) => {
      const findings = assertChainIntegrity([
        { child: "implement", path: join(dir, "missing-implement.log") },
      ]);
      const verdict = buildSmokeVerdict({
        livePidfiles: ["/tmp/dpt-smoke-jira-implement.pid"],
        chainFindings: findings,
      });
      expect(verdict.outcome).toBe("abort");
      expect(verdict.trigger ?? "").toMatch(/chain/i);
      expect(verdict.trigger ?? "").toMatch(/pidfile/i);
    });
  });

  test("neither trigger armed: a clean chain with no live pidfile is a pass", () => {
    withTmpDir((dir) => {
      const logPath = join(dir, "dpt-smoke-linear-simplify.log");
      writeFileSync(logPath, HEALTHY_CAPTURE, "utf8");
      const verdict = buildSmokeVerdict({
        livePidfiles: [],
        chainFindings: assertChainIntegrity([
          { child: "simplify", path: logPath },
        ]),
      });
      expect(verdict.outcome).toBe("pass");
    });
  });
});

describe("AC-STE-420.1 — parseSmokeVerdict is a real parse, not a shape guess", () => {
  test("each of the three outcomes parses back to itself", () => {
    for (const outcome of ["pass", "fail", "abort"] as const) {
      const parsed = parseSmokeVerdict(JSON.stringify({ outcome }));
      expect(parsed).toEqual({ outcome });
    }
  });

  test("the trigger survives the parse verbatim", () => {
    const parsed = parseSmokeVerdict(
      JSON.stringify({
        outcome: "abort",
        trigger: "incomplete grandchild chain (/implement + /spec-review never ran)",
      }),
    );
    expect(parsed).toEqual({
      outcome: "abort",
      trigger:
        "incomplete grandchild chain (/implement + /spec-review never ran)",
    });
  });

  test("non-JSON, a non-object, and an unknown outcome are all malformed", () => {
    expect(parseSmokeVerdict("SMOKE-ABORT: incomplete chain")).toEqual({
      malformed: true,
    });
    expect(parseSmokeVerdict("")).toEqual({ malformed: true });
    expect(parseSmokeVerdict("[]")).toEqual({ malformed: true });
    expect(parseSmokeVerdict(JSON.stringify({ outcome: "green" }))).toEqual({
      malformed: true,
    });
    expect(parseSmokeVerdict(JSON.stringify({ trigger: "x" }))).toEqual({
      malformed: true,
    });
  });
});

// ===========================================================================
// AC-STE-420.4 — reader: missing / malformed / stale are all failures.
// (Placed ahead of AC.2/AC.3 because those gate fixtures build on the reader.)
// ===========================================================================

describe("AC-STE-420.4 — readSmokeVerdict: absent, malformed, stale", () => {
  test("a present, fresh, well-formed artifact reads ok with its outcome", () => {
    withTmpDir((dir) => {
      const path = join(dir, "dpt-smoke-verdict-linear.json");
      writeFileSync(
        path,
        formatSmokeVerdict({ outcome: "abort", trigger: "incomplete chain" }),
        "utf8",
      );
      const read = readSmokeVerdict(path);
      expect(read.status).toBe("ok");
      expect(read.status === "ok" && read.verdict.outcome).toBe("abort");
      expect(read.status === "ok" && read.verdict.trigger).toBe(
        "incomplete chain",
      );
    });
  });

  test("an absent artifact reads `missing` — never a pass", () => {
    withTmpDir((dir) => {
      const read = readSmokeVerdict(join(dir, "nope.json"));
      expect(read.status).toBe("missing");
      expect(read.status).not.toBe("ok");
    });
  });

  test("a malformed artifact reads `malformed` — never a pass", () => {
    withTmpDir((dir) => {
      const path = join(dir, "dpt-smoke-verdict-jira.json");
      writeFileSync(path, "SMOKE-ABORT: incomplete grandchild chain\n", "utf8");
      expect(readSmokeVerdict(path).status).toBe("malformed");
    });
  });

  test("a stale artifact (mtime before runStart) reads `stale`, not its recorded outcome", () => {
    withTmpDir((dir) => {
      const path = join(dir, "dpt-smoke-verdict-linear.json");
      writeFileSync(path, formatSmokeVerdict({ outcome: "pass" }), "utf8");
      const runStart = Date.now();
      const stale = new Date(runStart - 60_000);
      utimesSync(path, stale, stale);

      const read = readSmokeVerdict(path, { runStart });
      expect(read.status).toBe("stale");
      // the freshness gate runs BEFORE the content check — mirrors
      // assertChainIntegrity's `capture stale (pre-run)` ordering.
      expect(read.status === "ok").toBe(false);
    });
  });

  test("the freshness gate is strictly `mtime < runStart` — mtime at runStart is fresh", () => {
    withTmpDir((dir) => {
      const path = join(dir, "dpt-smoke-verdict-linear.json");
      writeFileSync(path, formatSmokeVerdict({ outcome: "pass" }), "utf8");
      const runStart = Date.now() - 5_000;
      const at = new Date(runStart);
      utimesSync(path, at, at);

      const read = readSmokeVerdict(path, { runStart });
      expect(read.status).toBe("ok");
      expect(read.status === "ok" && read.verdict.outcome).toBe("pass");
    });
  });

  test("with no runStart the freshness gate is off (unchanged reader contract)", () => {
    withTmpDir((dir) => {
      const path = join(dir, "dpt-smoke-verdict-jira.json");
      writeFileSync(path, formatSmokeVerdict({ outcome: "pass" }), "utf8");
      const old = new Date(Date.now() - 86_400_000);
      utimesSync(path, old, old);
      expect(readSmokeVerdict(path).status).toBe("ok");
    });
  });
});

describe("AC-STE-420.4 — a leg that dies before writing an artifact cannot read green", () => {
  test("rc=0 + no artifact at all ⇒ reconciled rc is non-zero", () => {
    withTmpDir((dir) => {
      const read = readSmokeVerdict(join(dir, "dpt-smoke-verdict-linear.json"));
      const rc = reconcileLegRc("0\n", read);
      expect(rc).not.toBe(0);
      expect(rc).toBeGreaterThan(0);
      expect(rc).toBeLessThanOrEqual(255);
    });
  });

  test("rc=0 + malformed artifact ⇒ reconciled rc is non-zero", () => {
    withTmpDir((dir) => {
      const path = join(dir, "dpt-smoke-verdict-linear.json");
      writeFileSync(path, "{ not json", "utf8");
      expect(reconcileLegRc("0\n", readSmokeVerdict(path))).not.toBe(0);
    });
  });

  test("rc=0 + a STALE pass artifact from a previous run ⇒ reconciled rc is non-zero", () => {
    withTmpDir((dir) => {
      const path = join(dir, "dpt-smoke-verdict-jira.json");
      writeFileSync(path, formatSmokeVerdict({ outcome: "pass" }), "utf8");
      const old = new Date(Date.now() - 3_600_000);
      utimesSync(path, old, old);
      const read = readSmokeVerdict(path, { runStart: Date.now() });
      expect(reconcileLegRc("0\n", read)).not.toBe(0);
    });
  });

  test("a missing rc-file is still a failure even beside a pass artifact", () => {
    withTmpDir((dir) => {
      const path = join(dir, "dpt-smoke-verdict-linear.json");
      writeFileSync(path, formatSmokeVerdict({ outcome: "pass" }), "utf8");
      const read = readSmokeVerdict(path);
      expect(reconcileLegRc(undefined, read)).not.toBe(0);
      expect(reconcileLegRc(null, read)).not.toBe(0);
      expect(reconcileLegRc("", read)).not.toBe(0);
      expect(reconcileLegRc("not-a-number", read)).not.toBe(0);
    });
  });
});

// ===========================================================================
// AC-STE-420.2 / AC-STE-420.3 — the Phase A gate, non-vacuous in BOTH
// directions, independently of the collected exit code.
// ===========================================================================

/**
 * The Phase A gate exactly as the SKILL documents it, once reconciliation is
 * in place: read the rc-file, reconcile it against the verdict artifact, abort
 * the iteration on any non-zero.
 */
function phaseAIterationAborts(
  rcFileValue: string | undefined,
  read: SmokeVerdictRead,
): boolean {
  return reconcileLegRc(rcFileValue, read) !== 0;
}

/** Materialize one leg's post-exit on-disk state: rc-file + optional artifact. */
function stageLeg(
  dir: string,
  tracker: string,
  rcFileContent: string | undefined,
  artifactContent: string | undefined,
): { rc: string | undefined; read: SmokeVerdictRead } {
  const rcPath = join(dir, `iter-1-${tracker}.rc`);
  if (rcFileContent !== undefined) writeFileSync(rcPath, rcFileContent, "utf8");
  const artifactPath = join(dir, `dpt-smoke-verdict-${tracker}.json`);
  if (artifactContent !== undefined) {
    writeFileSync(artifactPath, artifactContent, "utf8");
  }
  return {
    rc: existsSync(rcPath) ? readFileSync(rcPath, "utf8") : undefined,
    read: readSmokeVerdict(artifactPath),
  };
}

describe("AC-STE-420.2 — Phase A fails a leg on a non-pass artifact, whatever the exit code says", () => {
  // *** THE 2026-07-27 REGRESSION FIXTURE. ***
  // Jira leg: final message led with `SMOKE-ABORT: incomplete grandchild chain
  // (/implement + /spec-review never ran)`, self-reported `VERDICT: FAIL
  // (rc=1)`, and its rc-file contained `0`. Before this FR the documented gate
  // read `0` and let the iteration continue.
  test("REGRESSION 2026-07-27 jira leg: rc-file `0` + abort artifact ⇒ the iteration aborts", () => {
    withTmpDir((dir) => {
      const { rc, read } = stageLeg(
        dir,
        "jira",
        "0\n",
        formatSmokeVerdict({
          outcome: "abort",
          trigger:
            "incomplete grandchild chain (/implement + /spec-review never ran)",
        }),
      );
      expect(rc).toBe("0\n"); // the exact false-green byte the run produced
      expect(read.status === "ok" && read.verdict.outcome).toBe("abort");
      expect(phaseAIterationAborts(rc, read)).toBe(true);
    });
  });

  // Linear leg of the same run: declared `SMOKE-TEST FAIL` with 4 high
  // findings, rc-file `0`.
  test("REGRESSION 2026-07-27 linear leg: rc-file `0` + fail artifact ⇒ the iteration aborts", () => {
    withTmpDir((dir) => {
      const { rc, read } = stageLeg(
        dir,
        "linear",
        "0\n",
        formatSmokeVerdict({ outcome: "fail", trigger: "4 high findings" }),
      );
      expect(rc).toBe("0\n");
      expect(phaseAIterationAborts(rc, read)).toBe(true);
    });
  });

  test("the verdict is independent of the exit code in the other direction too: rc=1 + pass artifact still fails", () => {
    withTmpDir((dir) => {
      const { rc, read } = stageLeg(
        dir,
        "linear",
        "1\n",
        formatSmokeVerdict({ outcome: "pass" }),
      );
      expect(read.status === "ok" && read.verdict.outcome).toBe("pass");
      expect(phaseAIterationAborts(rc, read)).toBe(true);
    });
  });
});

describe("AC-STE-420.3 — the same gate lets a clean leg through (non-vacuity)", () => {
  test("rc-file `0` + pass artifact ⇒ the iteration continues", () => {
    withTmpDir((dir) => {
      const { rc, read } = stageLeg(
        dir,
        "linear",
        "0\n",
        formatSmokeVerdict(
          buildSmokeVerdict({ livePidfiles: [], chainFindings: [] }),
        ),
      );
      expect(read.status === "ok" && read.verdict.outcome).toBe("pass");
      expect(phaseAIterationAborts(rc, read)).toBe(false);
      expect(reconcileLegRc(rc, read)).toBe(0);
    });
  });

  test("BOTH DIRECTIONS on one fixture pair: identical rc bytes, opposite gate results", () => {
    withTmpDir((dir) => {
      const clean = stageLeg(
        dir,
        "linear",
        "0\n",
        formatSmokeVerdict({ outcome: "pass" }),
      );
      const aborted = stageLeg(
        dir,
        "jira",
        "0\n",
        formatSmokeVerdict({ outcome: "abort", trigger: "live pidfile" }),
      );
      expect(clean.rc).toBe(aborted.rc); // the exit code discriminates nothing
      expect(phaseAIterationAborts(clean.rc, clean.read)).toBe(false);
      expect(phaseAIterationAborts(aborted.rc, aborted.read)).toBe(true);
    });
  });

  test("a clean leg's chain-integrity output really is what produces the pass", () => {
    withTmpDir((dir) => {
      const children = ["setup", "spec-write", "implement", "gate-check",
        "spec-review", "simplify"];
      const expected = children.map((child) => {
        const path = join(dir, `dpt-smoke-linear-${child}.log`);
        writeFileSync(path, HEALTHY_CAPTURE, "utf8");
        return { child, path };
      });
      const verdict = buildSmokeVerdict({
        livePidfiles: [],
        chainFindings: assertChainIntegrity(expected, Date.now() - 60_000),
      });
      expect(verdict.outcome).toBe("pass");

      const artifactPath = join(dir, "dpt-smoke-verdict-linear.json");
      writeFileSync(artifactPath, formatSmokeVerdict(verdict), "utf8");
      expect(reconcileLegRc("0\n", readSmokeVerdict(artifactPath))).toBe(0);
    });
  });
});

describe("AC-STE-420.2 — reconcileLegRc never downgrades a real failure", () => {
  test("a non-zero process rc survives reconciliation against every artifact state", () => {
    withTmpDir((dir) => {
      const passPath = join(dir, "dpt-smoke-verdict-linear.json");
      writeFileSync(passPath, formatSmokeVerdict({ outcome: "pass" }), "utf8");
      expect(reconcileLegRc("2\n", readSmokeVerdict(passPath))).not.toBe(0);
      expect(
        reconcileLegRc("1", readSmokeVerdict(join(dir, "absent.json"))),
      ).not.toBe(0);
    });
  });

  test("`echo $?` output shape (trailing newline, whitespace) parses as the exit code", () => {
    withTmpDir((dir) => {
      const path = join(dir, "dpt-smoke-verdict-linear.json");
      writeFileSync(path, formatSmokeVerdict({ outcome: "pass" }), "utf8");
      const read = readSmokeVerdict(path);
      expect(reconcileLegRc("0\n", read)).toBe(0);
      expect(reconcileLegRc(" 0 \n", read)).toBe(0);
      expect(reconcileLegRc(0, read)).toBe(0);
    });
  });
});

// ===========================================================================
// AC-STE-420.5 — SKILL prose.
//
// TRIPWIRES FIRST: the pinned sentences must SURVIVE verbatim. Six meta-tests
// elsewhere depend on these exact bytes; these assertions are green today and
// exist to localize the blast radius if a fix rewrites instead of adds.
// ===========================================================================

const SMOKE_NONZERO_MANDATE =
  "The abort MUST exit non-zero — a loud banner is not sufficient, because rc is one of several corroborating signals the parent reads — the per-skill log set is another — and a false green must never be reported in the exit code.";

const LOOP_NONZERO_MANDATE =
  "The abort MUST exit non-zero — a loud `LOOP-ABORT:` banner is not sufficient, because rc is one of several corroborating signals the operator reads — the per-skill log set the leg-completeness check verifies is another — and a false green must never be reported in the exit code.";

const UNQUALIFIED_NEVER_RC_ZERO =
  "Stated unqualified, with no adverb left to argue over: the driver must never exit rc=0 on the abort branch, under either trigger, loud or not.";

const BRANCH_2_EXIT_NON_ZERO =
  "then exit non-zero. Abort-with-teardown is the ONLY sanctioned no-marker resolution";

const FENCE_ECHO_NON_ZERO = "and exit non-zero; never exit rc=0";

describeIfSmoke("AC-STE-420.5 tripwire — /smoke-test pinned prose survives verbatim", () => {
  const body = () => smoke!;
  const clause = () => boldClause(smoke!, "**Final-message self-check");

  test("slice sanity: the final-message self-check clause is non-empty and carries its fence", () => {
    expect(clause().length).toBeGreaterThan(1000);
    expect(bashFences(clause()).length).toBe(1);
  });

  test("the non-zero mandate sentence is byte-unchanged AND still inside the self-check clause", () => {
    expect(body()).toContain(SMOKE_NONZERO_MANDATE);
    expect(clause()).toContain(SMOKE_NONZERO_MANDATE);
  });

  test("the unqualified never-rc=0 sentence is byte-unchanged", () => {
    expect(clause()).toContain(UNQUALIFIED_NEVER_RC_ZERO);
  });

  test("the Branch 2 exit-non-zero sentence and the fence echo are byte-unchanged", () => {
    expect(body()).toContain(BRANCH_2_EXIT_NON_ZERO);
    expect(body()).toContain(FENCE_ECHO_NON_ZERO);
  });

  test("single-anchor tripwire: exactly one reap / teardown / identity sentence in the clause", () => {
    // m112's `instructionOffset` returns -1 (⇒ FAIL) when more than one
    // sentence carries an anchor role. An additive AC.5 sentence that repeats
    // `kill` + `rm -f <pidglob>` or `rm -rf` + archive/close breaks five
    // currently-green assertions in that file. Fail HERE first, with a name.
    expect(countSentencesCarrying(clause(), carriesReapAnchor)).toBe(1);
    expect(countSentencesCarrying(clause(), carriesTeardownAnchor)).toBe(1);
    expect(countSentencesCarrying(clause(), carriesIdentityAnchor)).toBe(1);
  });

  test("drift guard: the no-third-branch invariant is made true, not deleted", () => {
    expect(clause()).toMatch(/no third branch/i);
    expect(clause()).toMatch(/kill -0/);
  });
});

describeIfLoop("AC-STE-420.5 tripwire — /conformance-loop pinned prose survives verbatim", () => {
  const body = () => loop!;
  const clause = () => boldClause(loop!, "**Final-message self-check");

  test("slice sanity: the Phase A final-message self-check clause is non-empty and carries its fence", () => {
    expect(clause().length).toBeGreaterThan(1000);
    expect(bashFences(clause()).length).toBe(1);
  });

  test("the non-zero mandate sentence is byte-unchanged AND still inside the self-check clause", () => {
    expect(body()).toContain(LOOP_NONZERO_MANDATE);
    expect(clause()).toContain(LOOP_NONZERO_MANDATE);
  });

  test("the unqualified never-rc=0 sentence is byte-unchanged", () => {
    expect(clause()).toContain(UNQUALIFIED_NEVER_RC_ZERO);
  });

  test("the Branch 2 exit-non-zero sentence and the fence echo are byte-unchanged", () => {
    expect(body()).toContain(BRANCH_2_EXIT_NON_ZERO);
    expect(body()).toContain(FENCE_ECHO_NON_ZERO);
  });

  test("single-anchor tripwire: exactly one reap / teardown / identity sentence in the clause", () => {
    expect(countSentencesCarrying(clause(), carriesReapAnchor)).toBe(1);
    expect(countSentencesCarrying(clause(), carriesTeardownAnchor)).toBe(1);
    expect(countSentencesCarrying(clause(), carriesIdentityAnchor)).toBe(1);
  });

  test("drift guard: the RC-collection gate keeps its documented shape", () => {
    const rcClause = boldClause(loop!, "**RC collection");
    expect(rcClause.length).toBeGreaterThan(200);
    expect(rcClause).toContain(
      "A missing rc-file after exit is treated as a failure",
    );
  });
});

// --- the RED half of AC.5: the artifact is named as authoritative -----------

describeIfSmoke("AC-STE-420.5 — /smoke-test names the verdict artifact as the authoritative signal", () => {
  const clause = () => boldClause(smoke!, "**Final-message self-check");

  test("the clause carries the concrete per-tracker artifact path", () => {
    expect(clause()).toMatch(VERDICT_PATH_RE);
  });

  test("an additive sentence names the verdict artifact as authoritative", () => {
    expect(namesArtifactAsAuthoritative(clause())).toBe(true);
  });

  test("the clause admits the process exit status cannot carry the verdict", () => {
    expect(admitsExitCodeCannotCarryTheVerdict(clause())).toBe(true);
  });

  test("this clause is the EMIT site: its fence writes the verdict artifact", () => {
    const fences = bashFences(clause());
    expect(fences.some((fence) => VERDICT_PATH_RE.test(fence))).toBe(true);
  });

  test("the emit consumes the incomplete-chain trigger's deterministic source, not just the pidfile scan", () => {
    // FR-correction pin (prose half): the fence today computes ONLY the live
    // pidfile trigger. The chain trigger's source is Phase 2.Y's
    // assertChainIntegrity, so the clause must name it as an input.
    expect(clause()).toMatch(/assertChainIntegrity|Phase 2\.Y/);
    expect(clause()).toMatch(/smoke_verdict/);
  });
});

describeIfLoop("AC-STE-420.5 — /conformance-loop names the verdict artifact as the authoritative signal", () => {
  const clause = () => boldClause(loop!, "**Final-message self-check");

  test("the clause carries the concrete per-tracker artifact path", () => {
    expect(clause()).toMatch(VERDICT_PATH_RE);
  });

  test("an additive sentence names the verdict artifact as authoritative", () => {
    expect(namesArtifactAsAuthoritative(clause())).toBe(true);
  });

  test("the clause admits the process exit status cannot carry the verdict", () => {
    expect(admitsExitCodeCannotCarryTheVerdict(clause())).toBe(true);
  });
});

// --- AC.5 completeness sweep: NO clause is left asserting the unsatisfiable --

describeIfBoth("AC-STE-420.5 — completeness sweep over both driver SKILLs", () => {
  /**
   * Bold-lead abort clauses that assert the process exits non-zero.
   *
   * Bold-lead only, deliberately: the `## Pre-flight refusals` section also
   * says "exits non-zero", but those refusals are real bash pre-flights that
   * genuinely control the process exit status — the guarantee is satisfiable
   * there, so it is out of AC.5's scope. The unsatisfiable ones are the
   * DRIVER's abort clauses, and every one of those is a `**bold-lead**` clause.
   */
  function abortExitClauses(body: string): string[] {
    return boldClauses(body).filter(
      (chunk) =>
        chunk.startsWith("**") &&
        /\babort/i.test(chunk) &&
        /\bexits?\s+non-?zero\b|\bexit rc=0\b/i.test(chunk),
    );
  }

  /**
   * A clause is satisfied when it names the verdict artifact itself, or when
   * it delegates to the `Final-message self-check` clause that does. The
   * self-check clause cannot delegate to itself.
   */
  function clauseIsSatisfied(chunk: string): boolean {
    if (/verdict artifact|dpt-smoke-verdict/i.test(chunk)) return true;
    if (chunk.startsWith("**Final-message self-check")) return false;
    return /Final-message self-check/.test(chunk);
  }

  test("DISCRIMINATOR: the sweep finds the known clauses in both drivers", () => {
    // If this shrinks to zero the sweep below becomes vacuous.
    expect(abortExitClauses(smoke!).length).toBeGreaterThanOrEqual(2);
    expect(abortExitClauses(loop!).length).toBeGreaterThanOrEqual(2);
  });

  test("DISCRIMINATOR: the delegating Branch 2 clauses already satisfy the predicate today", () => {
    // Proves the predicate is satisfiable by prose that exists — the two RED
    // assertions below are not graded against an unmatchable regex.
    for (const body of [smoke!, loop!]) {
      const branch2 = boldClauses(body).find((chunk) =>
        chunk.startsWith("**Branch 2 — marker absent"),
      );
      expect(branch2).toBeDefined();
      expect(clauseIsSatisfied(branch2!)).toBe(true);
    }
  });

  test("/smoke-test: every abort clause asserting a non-zero exit resolves to the artifact", () => {
    const unresolved = abortExitClauses(smoke!)
      .filter((chunk) => !clauseIsSatisfied(chunk))
      .map((chunk) => chunk.split("\n")[0]!.slice(0, 80));
    expect(unresolved).toEqual([]);
  });

  test("/conformance-loop: every abort clause asserting a non-zero exit resolves to the artifact", () => {
    const unresolved = abortExitClauses(loop!)
      .filter((chunk) => !clauseIsSatisfied(chunk))
      .map((chunk) => chunk.split("\n")[0]!.slice(0, 80));
    expect(unresolved).toEqual([]);
  });
});

// ===========================================================================
// AC-STE-420.2 (prose half) — the Phase A spawn wrapper documents the
// reconciliation inside BOTH brace groups, so the rc-file every existing
// consumer reads carries the verdict.
// ===========================================================================

describeIfLoop("AC-STE-420.2 — Phase A spawn wrapper reconciles each leg's rc-file", () => {
  function spawnFence(): string {
    return (
      bashFences(loop!).find((fence) => fence.includes("RC_FILE_LINEAR=")) ?? ""
    );
  }

  function braceGroups(fence: string): string[] {
    const groups: string[] = [];
    const re = /^\{\n([\s\S]*?)^\} &/gm;
    let match: RegExpExecArray | null;
    while ((match = re.exec(fence)) !== null) groups.push(match[1]!);
    return groups;
  }

  /**
   * Every leg named by a `dpt-smoke-verdict-<leg>.json` path inside one group,
   * deduped. This is the STE-423 scoping property read off the group itself
   * rather than assumed: a group whose artifact path names another leg reports
   * that other leg here, and the per-leg assertion below goes RED in BOTH
   * directions (the group missing its own artifact, and the group carrying a
   * foreign one).
   */
  function verdictLegs(group: string): string[] {
    const re = /dpt-smoke-verdict-([A-Za-z][A-Za-z0-9_-]*)\.json/g;
    return [...new Set([...group.matchAll(re)].map((m) => m[1]!))];
  }

  test("slice sanity: the Phase A spawn fence has one brace group per registered leg", () => {
    const fence = spawnFence();
    expect(fence.length).toBeGreaterThan(200);
    // STE-446: the count is DERIVED from the leg enum, never restated as a
    // literal. `SMOKE_LEGS` is the sole leg-set authority and the fence is an
    // independently hand-maintained document, so the two sides do not trace to
    // the same source and this comparison can really fail — a registered leg
    // with no brace group lands here as RED rather than as a silent gap.
    expect(braceGroups(fence).length).toBe(SMOKE_LEGS.length);
  });

  for (const tracker of SMOKE_LEGS) {
    const rcVar = `RC_FILE_${tracker.toUpperCase()}`;
    test(`${tracker} brace group: reconciles its own verdict into ${rcVar} after the leg exits`, () => {
      // Exactly one group owns this leg's `--tracker` token — not "at least
      // one", so a duplicated or copy-pasted group is RED too.
      const owned = braceGroups(spawnFence()).filter((g) =>
        g.includes(`--tracker ${tracker}`),
      );
      expect({ tracker, groups: owned.length }).toEqual({ tracker, groups: 1 });
      const g = owned[0]!;

      // The rc-file write survives — every documented consumer keeps working.
      expect(g).toContain(rcVar);
      // The reconciliation is wired in, keyed on this leg's own artifact and
      // on NO other leg's — STE-423 leg scoping, stated for N legs.
      expect({ tracker, verdicts: verdictLegs(g) }).toEqual({
        tracker,
        verdicts: [tracker],
      });
      expect(g).toMatch(/smoke_verdict/);

      // Ordering: reconcile AFTER the leg exits, and the LAST rc-file write is
      // the reconciled value — not the bare `echo $?`.
      const spawnAt = g.indexOf("claude -p");
      const reconcileAt = g.indexOf("smoke_verdict");
      const lastRcWriteAt = g.lastIndexOf(rcVar);
      expect(spawnAt).toBeGreaterThanOrEqual(0);
      expect(reconcileAt).toBeGreaterThan(spawnAt);
      expect(lastRcWriteAt).toBeGreaterThan(reconcileAt);
    });
  }

  test("the RC-collection clause documents that the rc value is verdict-reconciled", () => {
    const rcClause = boldClause(loop!, "**RC collection");
    expect(rcClause).toMatch(/verdict artifact|dpt-smoke-verdict/i);
    expect(rcClause).toMatch(/missing|absent/i);
    expect(rcClause).toMatch(/stale|fresh/i);
  });
});
