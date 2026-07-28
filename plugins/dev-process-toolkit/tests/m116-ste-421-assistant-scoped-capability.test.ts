// M116 STE-421 — replace raw-log capability-key greps with assistant-scoped
// assertions.
//
// WHAT IS BROKEN. Nine documented fixture assertions in
// `.claude/skills/smoke-test/SKILL.md` decide "did the skill emit its capability
// row?" by running `grep -F '<key>' <capture>.log` over the RAW stream-json
// capture. That capture is not the child's output — it is the whole session.
//
// THE CARRIER, measured rather than assumed. `claude -p` injects the invoked
// skill's SKILL.md body into the transcript as a SINGLE SYNTHETIC `user` event
// (`{"type":"user","isSynthetic":true,"message":{"content":[{"type":"text",…}]}}`).
// That body enumerates the skill's own capability keys. So every key a skill
// DOCUMENTS is present in the raw log of EVERY capture of that skill,
// unconditionally — never run-dependently. On the 2026-07-27 `/spec-write`
// capture the single 83 KB synthetic-user event at stream index 8 carries all
// five keys, and it alone accounts for every raw hit in the FR's table.
//
// `extractAssistantText` (`adapters/_shared/src/smoke_child_capture.ts`) filters
// `assistant` events, which is exactly why it correctly scores those five keys 0.
//
// THE TEST STRATEGY, and why it is not a tautology. Two independent halves:
//
//  1. A META half that parses `.claude/skills/smoke-test/SKILL.md` and asserts no
//     raw-log capability grep survives and every capability key routes through
//     the runner. Every detector used there is proved non-vacuous against the
//     pre-fix bytes it is meant to reject AND against a legitimate non-capability
//     grep it must NOT reject.
//  2. A BEHAVIORAL half that scores committed captures. Its centerpiece is the
//     CONTRAST: the same fixture, same key, scored both ways — assistant-scoped
//     (ABSENT) and raw (PRESENT). Pinning only the ABSENT half would be
//     satisfiable by a scorer that returns false for everything, so the raw
//     count is pinned alongside it, and `ste222-probe-jira` + `emitted-then-refusal`
//     pin the positive direction (AC-STE-421.5).
//
// FIXTURE POLICY. The 2026-07-27 source captures (`/tmp/dpt-smoke-*.log`,
// 200 KB – 470 KB) are run artifacts and are deliberately NOT committed. What is
// committed under `tests/fixtures/capability-rows/` is a minimal DERIVED
// reproducer per capture: only events carrying a scored token survive, and every
// string body over 200 chars is reduced to ±120-char windows around the tokens,
// so per-token occurrence counts are preserved byte-exactly — including the
// synthetic-user event, which is the entire point of AC-STE-421.2.
// `describe("fixture equivalence")` pins that derivation forever: whenever a full
// capture IS present on disk, it must score identically. Those tests skip, loudly
// named, in a clean checkout.
//
// `.claude/skills/smoke-test/SKILL.md` lives OUTSIDE `plugins/dev-process-toolkit`
// and therefore carries no line cap and no STE-N token ceiling; ticket ids may be
// cited freely there and here.

import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  capabilityVerdict,
  REQUIRES_INPUT_REFUSED_MARKER,
  scoreCapabilityKey,
  type CapabilityScore,
} from "../adapters/_shared/src/capability_row_assert";
import { runCrossCuttingSpecStaleFileRefsProbe } from "../adapters/_shared/src/cross_cutting_spec_stale_file_refs";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");

// Repo-root-relative: a sweep scoped to PLUGIN_ROOT cannot see `.claude/skills/`.
const SMOKE_SKILL_PATH = join(
  REPO_ROOT,
  ".claude",
  "skills",
  "smoke-test",
  "SKILL.md",
);
const SMOKE_SKILL_BODY = readFileSync(SMOKE_SKILL_PATH, "utf-8");

const FIXTURE_DIR = join(PLUGIN_ROOT, "tests", "fixtures", "capability-rows");
const fixture = (name: string) => readFileSync(join(FIXTURE_DIR, name), "utf-8");

/**
 * Where the untracked 2026-07-27 run artifacts might still live. `/tmp` is
 * where `/smoke-test` writes them; `DPT_CAPTURE_DIR` lets an operator point the
 * equivalence checks at a preserved copy without editing this file. Neither is
 * expected to exist in a clean checkout — that is what the `skipIf` guards are
 * for.
 */
const CAPTURE_DIRS = [
  process.env.DPT_CAPTURE_DIR,
  "/tmp",
].filter((d): d is string => typeof d === "string" && d.length > 0);

function findCapture(basename: string): string | null {
  for (const dir of CAPTURE_DIRS) {
    const path = join(dir, basename);
    if (existsSync(path)) return path;
  }
  return null;
}

// ===========================================================================
// The capability-key universe.
// ===========================================================================

/**
 * Every token the smoke SKILL asserts as evidence that a skill EMITTED a
 * capability row. Deliberately includes the hyphenated stale-file-refs spelling
 * — that misspelling is the AC-STE-421.4 defect and must be swept out too.
 */
const CAPABILITY_TOKENS = [
  "spec_write_draft_default_applied",
  "spec_write_commit_default_applied",
  "branch_gate_default_applied",
  "branch_gate_skipped_already_non_main",
  "spec_research_invoked",
  "spec_research_no_matches",
  "spec_research_shape_violation",
  "implement_refused_needs_technical_review",
  "cross_cutting_spec_stale_file_refs",
  "cross-cutting-spec-stale-file-refs",
] as const;

/**
 * The keys that MUST each be reachable through the runner after the fix — the
 * union of the nine Phase 2.X raw-grep sites and the Phase 9 fixture tokens.
 * The hyphen form is excluded on purpose: AC-STE-421.4 removes it.
 */
const ROUTED_KEYS = CAPABILITY_TOKENS.filter(
  (t) => t !== "cross-cutting-spec-stale-file-refs",
);

// The FR § Requirement table, measured on both legs of the 2026-07-27 run.
const MEASURED_RAW_HITS: Record<string, number> = {
  spec_write_draft_default_applied: 3,
  spec_write_commit_default_applied: 3,
  branch_gate_default_applied: 1,
  spec_research_no_matches: 3,
  spec_research_invoked: 3,
};
const FR_TABLE_KEYS = Object.keys(MEASURED_RAW_HITS);

// ===========================================================================
// SKILL.md parsing helpers.
// ===========================================================================

/** The body of a `### <heading>` section, up to the next `##`/`###` heading. */
function section(body: string, headingPrefix: string): string {
  const lines = body.split("\n");
  const start = lines.findIndex(
    (l) => l.startsWith("### ") && l.slice(4).startsWith(headingPrefix),
  );
  if (start < 0) {
    throw new Error(
      `STE-421: no "### ${headingPrefix}…" heading in ${SMOKE_SKILL_PATH}`,
    );
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{2,3} /.test(lines[i]!)) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

/** A `.log` path token — the shape every child capture assertion reads. */
const LOG_PATH_RE = /[\w${}<>.\/-]+\.log\b/;

/**
 * Lines that decide capability-row emission by grepping a capture file. This is
 * the exact construct AC-STE-421.1 outlaws. Three conjuncts, all load-bearing:
 * a `grep` invocation, a `.log` capture operand, and a capability token. The
 * `.log` conjunct is what keeps legitimate greps over FR files (fixture group
 * 4's `needs_technical_review: true` frontmatter check) out of scope.
 */
function rawLogCapabilityGreps(body: string): string[] {
  return body.split("\n").filter((line) => {
    if (!/\bgrep\b/.test(line)) return false;
    if (!LOG_PATH_RE.test(line)) return false;
    return CAPABILITY_TOKENS.some((t) => line.includes(t));
  });
}

/** Shell variables in `body` whose assignment names the runner module. */
function runnerVarNames(body: string): string[] {
  const re =
    /^[ \t]*(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)=[^\n]*capability_row_assert[^\n]*$/gm;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) out.push(m[1]!);
  return out;
}

/**
 * Lines invoking the assistant-scoped runner — either naming the module file
 * directly or through a shell variable assigned to it elsewhere in `body`.
 */
function runnerInvocations(body: string): string[] {
  const vars = runnerVarNames(body);
  const varRe = vars.length
    ? new RegExp(`\\$\\{?(?:${vars.join("|")})\\}?`)
    : null;
  return body.split("\n").filter((line) => {
    if (!/\bbun\b/.test(line)) return false;
    if (/capability_row_assert/.test(line)) return true;
    return varRe !== null && varRe.test(line);
  });
}

// ===========================================================================
// AC-STE-421.1 — no raw-transcript substring search survives.
// ===========================================================================

describe("AC-STE-421.1 — capability evidence resolves through assistant text", () => {
  test("no raw-log capability grep survives anywhere in the smoke SKILL", () => {
    // The headline assertion. Nine such lines exist today (fixtures 1a x2,
    // 1b x2, 3c, group 4 step 2, 5a, 5b, 6).
    expect(rawLogCapabilityGreps(SMOKE_SKILL_BODY)).toEqual([]);
  });

  test("none survives inside Phase 2.X specifically", () => {
    expect(rawLogCapabilityGreps(section(SMOKE_SKILL_BODY, "Phase 2.X"))).toEqual(
      [],
    );
  });

  test("none survives inside Phase 9 specifically", () => {
    expect(rawLogCapabilityGreps(section(SMOKE_SKILL_BODY, "Phase 9"))).toEqual(
      [],
    );
  });

  test("Phase 2.X routes its capability assertions through the runner", () => {
    const phase = section(SMOKE_SKILL_BODY, "Phase 2.X");
    expect(runnerInvocations(phase).length).toBeGreaterThan(0);
  });

  test("Phase 9 routes its capability assertions through the runner", () => {
    // Phase 9's documented method is today "case-sensitive substring grep on
    // the captured `claude -p` log" — prose, not a fenced command, so the
    // grep-line detector above cannot see it. This is the pin that covers it.
    const phase = section(SMOKE_SKILL_BODY, "Phase 9");
    expect(runnerInvocations(phase).length).toBeGreaterThan(0);
  });

  test("every capability key reaches the runner by name", () => {
    const invocations = runnerInvocations(SMOKE_SKILL_BODY);
    const unrouted = ROUTED_KEYS.filter(
      (key) => !invocations.some((line) => line.includes(key)),
    );
    expect(unrouted).toEqual([]);
  });

  test("both assertion directions are exercised — absence is not dropped", () => {
    // Fixtures 1b and 5b assert a row is ABSENT; fixture 6 asserts at-least-one.
    // A "fix" that routed everything through a presence-only check would delete
    // the very direction AC-STE-421.3 is about.
    const invocations = runnerInvocations(SMOKE_SKILL_BODY).join("\n");
    expect(invocations).toMatch(/\babsent\b/);
    expect(invocations).toMatch(/\bpresent\b/);
    expect(invocations).toMatch(/any-of/);
  });

  test("the runner module the SKILL names actually exists on disk", () => {
    expect(SMOKE_SKILL_BODY).toContain("capability_row_assert");
    expect(
      existsSync(
        join(
          PLUGIN_ROOT,
          "adapters",
          "_shared",
          "src",
          "capability_row_assert.ts",
        ),
      ),
    ).toBe(true);
  });
});

describe("AC-STE-421.1 — the detectors are non-vacuous", () => {
  test("the pre-fix bytes of all nine grep sites are flagged", () => {
    // Verbatim from `.claude/skills/smoke-test/SKILL.md` before this FR. If the
    // detector stops flagging these, every assertion above is decorative.
    const PRE_FIX = [
      "- `grep -F 'spec_write_draft_default_applied' /tmp/dpt-smoke-<tracker>-spec-write.log` exit 0 (row present in stdout).",
      "- `grep -F 'spec_write_commit_default_applied' /tmp/dpt-smoke-<tracker>-spec-write.log` exit 0 (row present in stdout).",
      "- `grep -F 'spec_write_draft_default_applied' /tmp/dpt-smoke-<tracker>-spec-write-1b.log` exit 1 (row absent — gate fired interactively, no auto-apply).",
      "- `grep -F 'spec_write_commit_default_applied' /tmp/dpt-smoke-<tracker>-spec-write-1b.log` exit 1 (row absent for the same reason).",
      "- Assert: `grep -F 'cross-cutting-spec-stale-file-refs' /tmp/dpt-smoke-<tracker>-ste222-probe.log` exit 0 with ADVISORY context.",
      "- Step 2: `grep -F 'implement_refused_needs_technical_review' /tmp/dpt-smoke-linear-no-tech-step-2.log` exit 0 (capability row present)",
      "- `grep -F 'branch_gate_default_applied' /tmp/dpt-smoke-<tracker>-spec-write.log` exit 0 (gate auto-applied with the marker present).",
      "- `grep -F 'branch_gate_default_applied' /tmp/dpt-smoke-<tracker>-spec-write-5b.log` exit 1 (row absent — gate fired interactively, no auto-apply).",
      "- `grep -cE 'spec_research_invoked|spec_research_no_matches|spec_research_shape_violation' /tmp/dpt-smoke-<tracker>-spec-write.log` ≥ 1",
    ];
    expect(rawLogCapabilityGreps(PRE_FIX.join("\n"))).toHaveLength(
      PRE_FIX.length,
    );
  });

  test("a grep over an FR file is NOT flagged — scope discipline", () => {
    // Fixture group 4 steps 1 and 3 legitimately grep frontmatter out of an FR
    // file on disk. That is a file-content check, not capability-row evidence,
    // and this FR must not touch it.
    const LEGITIMATE = [
      "- Step 1: FR file exists at `../dpt-test-project-linear/specs/frs/<id>.md` with `grep -F 'needs_technical_review: true' ../dpt-test-project-linear/specs/frs/<id>.md` exit 0 (frontmatter flag set).",
      "- Step 3: `grep -F 'needs_technical_review: true' ../dpt-test-project-linear/specs/frs/<id>.md` exit 1 (flag cleared).",
      "- Assert: `grep -E 'ADVISORY.*probe.*26|probe.*26.*ADVISORY' /tmp/dpt-smoke-<tracker>-ste221-positive.log` exit 0.",
      "- ``grep -c '^```tdd-result$' /tmp/dpt-smoke-<tracker>-implement.log`` ≥ 3",
    ];
    expect(rawLogCapabilityGreps(LEGITIMATE.join("\n"))).toEqual([]);
  });

  test("the runner-invocation matcher resolves shell-variable indirection", () => {
    const FIXED =
      'CAP_ASSERT=${PLUGIN_DIR}/adapters/_shared/src/capability_row_assert.ts\n' +
      '  bun "${CAP_ASSERT}" present "${LOG}" spec_write_draft_default_applied';
    const found = runnerInvocations(FIXED);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("spec_write_draft_default_applied");
  });

  test("the runner-invocation matcher rejects an unrelated bun call", () => {
    const OTHER =
      'ASSERT_RUNNER=${PLUGIN_DIR}/adapters/_shared/src/socratic_first_turn_assert.ts\n' +
      '  bun "${ASSERT_RUNNER}" "${SKILL}" "${FIXTURE}" "${TEST_PATH}"';
    expect(runnerInvocations(OTHER)).toEqual([]);
  });
});

// ===========================================================================
// AC-STE-421.2 — the 2026-07-27 regression fixture scores all five ABSENT.
// ===========================================================================

const SPEC_WRITE_FIXTURES = [
  { leg: "linear", file: "spec-write-linear-2026-07-27.log" },
  { leg: "jira", file: "spec-write-jira-2026-07-27.log" },
] as const;

describe("AC-STE-421.2 — the 2026-07-27 /spec-write capture scores ABSENT", () => {
  for (const { leg, file } of SPEC_WRITE_FIXTURES) {
    for (const key of FR_TABLE_KEYS) {
      test(`${leg}: ${key} is absent, and the raw method would have said present`, () => {
        const score = scoreCapabilityKey(fixture(file), key);
        // The finding, in one assertion pair. Both halves are required: the
        // ABSENT verdict alone is satisfiable by a scorer that always returns
        // false, and the raw count is what proves this fixture really is the
        // capture the old method got wrong.
        expect(score.present).toBe(false);
        expect(score.assistantHits).toBe(0);
        expect(score.rawHits).toBe(MEASURED_RAW_HITS[key]);
        expect(score.rawHits).toBeGreaterThan(0);
      });
    }

    test(`${leg}: the whole five-key table is absent in one verdict`, () => {
      const verdict = capabilityVerdict(fixture(file), FR_TABLE_KEYS, "absent");
      expect(verdict.exitCode).toBe(0);
      expect(verdict.line).toContain("ok");
      for (const key of FR_TABLE_KEYS) {
        expect(verdict.scores[key]!.present).toBe(false);
      }
    });

    test(`${leg}: fixtures 1a / 5a / 6 therefore FAIL on this capture`, () => {
      // The three fixtures the FR says would each have scored PASS on a run
      // where `/spec-write` refused and emitted nothing. Under the corrected
      // method they must fail — that flip IS the fix.
      expect(
        capabilityVerdict(
          fixture(file),
          ["spec_write_draft_default_applied", "spec_write_commit_default_applied"],
          "present",
        ).exitCode,
      ).toBe(1); // fixture 1a
      expect(
        capabilityVerdict(fixture(file), ["branch_gate_default_applied"], "present")
          .exitCode,
      ).toBe(1); // fixture 5a
      expect(
        capabilityVerdict(
          fixture(file),
          [
            "spec_research_invoked",
            "spec_research_no_matches",
            "spec_research_shape_violation",
          ],
          "any-of",
        ).exitCode,
      ).toBe(1); // fixture 6
    });

    test(`${leg}: the raw hits all come from the injected SKILL body`, () => {
      // Names the carrier explicitly so a future reader does not re-derive the
      // wrong root cause (it is a synthetic `user` event, NOT a tool_result).
      const events = fixture(file)
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l) as Record<string, unknown>);
      const synthetic = events.filter(
        (e) => e.type === "user" && e.isSynthetic === true,
      );
      expect(synthetic).toHaveLength(1);
      const carrier = JSON.stringify(synthetic[0]);
      for (const key of FR_TABLE_KEYS) {
        expect(carrier).toContain(key);
      }
    });
  }
});

// ===========================================================================
// AC-STE-421.3 — emission vs. post-refusal explanatory prose.
// ===========================================================================

describe("AC-STE-421.3 — a correct refusal is not a marker-contract regression", () => {
  const KEY = "spec_write_draft_default_applied";

  test("the refusal marker constant is the literal STE-408 contract token", () => {
    expect(REQUIRES_INPUT_REFUSED_MARKER).toBe(
      "<dpt:requires-input-refused>v1</dpt:requires-input-refused>",
    );
  });

  test("a token in post-refusal prose scores ABSENT", () => {
    const score = scoreCapabilityKey(fixture("refusal-prose-only.log"), KEY);
    expect(score.assistantHits).toBe(1);
    expect(score.postRefusalHits).toBe(1);
    expect(score.present).toBe(false);
  });

  test("so the absence-asserting fixture 1b PASSES on that capture", () => {
    // The dangerous direction, end to end: fixture 1b reads presence as a
    // marker-contract regression. On a correct refusal it must report nothing.
    const verdict = capabilityVerdict(
      fixture("refusal-prose-only.log"),
      ["spec_write_draft_default_applied", "spec_write_commit_default_applied"],
      "absent",
    );
    expect(verdict.exitCode).toBe(0);
  });

  test("the MIRROR: the same token before the marker scores PRESENT", () => {
    // Identical token, identical shape, only the position differs. This is what
    // stops the discriminator from degenerating into "any capture containing a
    // refusal marker scores everything absent".
    const score = scoreCapabilityKey(fixture("emitted-then-refusal.log"), KEY);
    expect(score.assistantHits).toBe(1);
    expect(score.postRefusalHits).toBe(0);
    expect(score.present).toBe(true);
  });

  test("and fixture 1b correctly FAILS on that capture", () => {
    expect(
      capabilityVerdict(fixture("emitted-then-refusal.log"), [KEY], "absent")
        .exitCode,
    ).toBe(1);
  });

  test("both prose fixtures carry the marker — the split is positional only", () => {
    for (const f of ["refusal-prose-only.log", "emitted-then-refusal.log"]) {
      expect(fixture(f)).toContain(REQUIRES_INPUT_REFUSED_MARKER);
    }
  });

  test("a key confined to a tool_result payload scores ABSENT", () => {
    // FR § Testing's first unit case: the child READ a document that documents
    // the keys. No refusal marker anywhere, so the post-refusal rule cannot be
    // what produces the verdict — the projection alone must.
    const capture = fixture("carrier-tool-result.log");
    expect(capture).not.toContain(REQUIRES_INPUT_REFUSED_MARKER);
    for (const key of [
      "spec_write_draft_default_applied",
      "spec_write_commit_default_applied",
      "branch_gate_default_applied",
    ]) {
      const score = scoreCapabilityKey(capture, key);
      expect(score.present).toBe(false);
      expect(score.assistantHits).toBe(0);
      expect(score.postRefusalHits).toBe(0);
      expect(score.rawHits).toBeGreaterThan(0);
    }
  });
});

// ===========================================================================
// AC-STE-421.4 — assertion tokens match what the runtime emits.
// ===========================================================================

let staleFileRefsMessage: Promise<string> | null = null;

/**
 * Run the real probe against a scratch project and read its emitted message.
 * Memoized — one scratch dir per test run, not one per assertion.
 */
function emittedStaleFileRefsMessage(): Promise<string> {
  staleFileRefsMessage ??= runStaleFileRefsProbe();
  return staleFileRefsMessage;
}

async function runStaleFileRefsProbe(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "ste421-probe-"));
  mkdirSync(join(root, "specs"), { recursive: true });
  writeFileSync(
    join(root, "specs", "technical-spec.md"),
    [
      "# Technical Spec",
      "",
      "```",
      "src/",
      // Full path, not a bare basename: the probe deliberately skips
      // slash-less leaves as unresolvable (see its `token.includes("/")` guard).
      "└── src/ste421-definitely-missing.ts",
      "```",
      "",
    ].join("\n"),
  );
  const report = await runCrossCuttingSpecStaleFileRefsProbe(root);
  if (report.violations.length === 0) {
    throw new Error(
      "STE-421: the stale-file-refs probe emitted nothing for a staged missing " +
        "path — the AC-STE-421.4 runtime-form check cannot be evaluated.",
    );
  }
  return report.violations[0]!.message;
}

describe("AC-STE-421.4 — the assertion token is the token the runtime emits", () => {
  test("the runtime probe emits the UNDERSCORED form", async () => {
    // Read from a live probe run, not from source bytes: if the runtime form
    // ever changes, this fails first and names the reason.
    const message = await emittedStaleFileRefsMessage();
    expect(message).toContain("cross_cutting_spec_stale_file_refs");
    expect(message).not.toContain("cross-cutting-spec-stale-file-refs");
  });

  test("the smoke SKILL asserts exactly that token", async () => {
    const message = await emittedStaleFileRefsMessage();
    const emitted = /\b(cross[_-]cutting[_-]spec[_-]stale[_-]file[_-]refs)\b/.exec(
      message,
    )?.[1];
    expect(emitted).toBe("cross_cutting_spec_stale_file_refs");
    const invocations = runnerInvocations(SMOKE_SKILL_BODY);
    expect(invocations.some((line) => line.includes(emitted!))).toBe(true);
  });

  test("no assertion line in the smoke SKILL uses the hyphen form", () => {
    // Scoped to ASSERTION lines (grep / runner invocations) on purpose. Prose
    // that names /gate-check probe #37 by its documented hyphenated *probe id*
    // is correct and out of scope — as is
    // `skills/gate-check/SKILL.md`'s PROBE_37_SCOPE_SENTENCE, pinned
    // byte-for-byte in hyphen form by tests/m70-skill-md-content.test.ts.
    const assertionLines = [
      ...rawLogCapabilityGreps(SMOKE_SKILL_BODY),
      ...runnerInvocations(SMOKE_SKILL_BODY),
    ];
    const offenders = assertionLines.filter((l) =>
      l.includes("cross-cutting-spec-stale-file-refs"),
    );
    expect(offenders).toEqual([]);
  });

  test("the 2026-07-27 probe capture confirms which form was really emitted", () => {
    // The empirical half of AC-STE-421.4: on the real capture the verdict block
    // rendered the underscored form and the hyphen form zero times, so the
    // pre-fix fixture 3c grep could only ever have scored a correct probe as
    // broken.
    const capture = fixture("ste222-probe-jira-2026-07-27.log");
    expect(
      scoreCapabilityKey(capture, "cross_cutting_spec_stale_file_refs").rawHits,
    ).toBeGreaterThan(0);
    expect(
      scoreCapabilityKey(capture, "cross-cutting-spec-stale-file-refs").rawHits,
    ).toBe(0);
  });
});

// ===========================================================================
// AC-STE-421.5 — the positive direction still scores PASS.
// ===========================================================================

describe("AC-STE-421.5 — a genuine emission still scores PASS", () => {
  test("the 2026-07-27 probe capture emits its row in ASSISTANT text", () => {
    const score = scoreCapabilityKey(
      fixture("ste222-probe-jira-2026-07-27.log"),
      "cross_cutting_spec_stale_file_refs",
    );
    expect(score.present).toBe(true);
    expect(score.assistantHits).toBe(1);
    expect(score.postRefusalHits).toBe(0);
    // Non-vacuity in the other direction: this capture has 17 raw hits, so a
    // scorer that merely echoed rawHits would pass here by accident. The
    // assistant count is the independent signal.
    expect(score.rawHits).toBeGreaterThan(score.assistantHits);
  });

  test("fixture 3c therefore PASSES on the real capture", () => {
    const verdict = capabilityVerdict(
      fixture("ste222-probe-jira-2026-07-27.log"),
      ["cross_cutting_spec_stale_file_refs"],
      "present",
    );
    expect(verdict.exitCode).toBe(0);
    expect(verdict.line).toContain("cross_cutting_spec_stale_file_refs");
  });

  test("a genuine emission ahead of a later refusal also passes", () => {
    expect(
      capabilityVerdict(
        fixture("emitted-then-refusal.log"),
        ["spec_write_draft_default_applied"],
        "present",
      ).exitCode,
    ).toBe(0);
  });

  test("the suite cannot pass by asserting everything absent", () => {
    // The guard the FR § Testing section asks for, stated as one assertion:
    // at least one committed fixture scores PRESENT for at least one key.
    const positives = [
      ["ste222-probe-jira-2026-07-27.log", "cross_cutting_spec_stale_file_refs"],
      ["emitted-then-refusal.log", "spec_write_draft_default_applied"],
    ] as const;
    for (const [file, key] of positives) {
      expect(scoreCapabilityKey(fixture(file), key).present).toBe(true);
    }
  });
});

// ===========================================================================
// Verdict contract — exit codes and line shape the smoke driver branches on.
// ===========================================================================

describe("capabilityVerdict — the contract the SKILL branches on", () => {
  const PRESENT = fixture("emitted-then-refusal.log");
  const ABSENT = fixture("refusal-prose-only.log");
  const KEY = "spec_write_draft_default_applied";

  test("`present` is ok only when EVERY key is present", () => {
    expect(capabilityVerdict(PRESENT, [KEY], "present").exitCode).toBe(0);
    expect(
      capabilityVerdict(PRESENT, [KEY, "branch_gate_default_applied"], "present")
        .exitCode,
    ).toBe(1);
  });

  test("`absent` is ok only when NO key is present", () => {
    expect(capabilityVerdict(ABSENT, [KEY], "absent").exitCode).toBe(0);
    expect(capabilityVerdict(PRESENT, [KEY], "absent").exitCode).toBe(1);
  });

  test("`any-of` is ok when at least one key is present", () => {
    expect(
      capabilityVerdict(PRESENT, ["branch_gate_default_applied", KEY], "any-of")
        .exitCode,
    ).toBe(0);
    expect(
      capabilityVerdict(
        ABSENT,
        ["branch_gate_default_applied", "spec_research_invoked"],
        "any-of",
      ).exitCode,
    ).toBe(1);
  });

  test("the verdict is a single line naming expectation, outcome and keys", () => {
    const verdict = capabilityVerdict(PRESENT, [KEY], "present");
    expect(verdict.line).not.toContain("\n");
    expect(verdict.line.startsWith("present:")).toBe(true);
    expect(verdict.line).toContain("ok");
    expect(verdict.line).toContain(KEY);

    const failed = capabilityVerdict(ABSENT, [KEY], "present");
    expect(failed.line.startsWith("present:")).toBe(true);
    expect(failed.line).toContain("fail");
    expect(failed.line).toContain(KEY);
  });

  test("every requested key gets a full score in the verdict", () => {
    const keys = [KEY, "branch_gate_default_applied"];
    const verdict = capabilityVerdict(PRESENT, keys, "any-of");
    expect(Object.keys(verdict.scores).sort()).toEqual([...keys].sort());
    for (const key of keys) {
      const score: CapabilityScore = verdict.scores[key]!;
      expect(typeof score.present).toBe("boolean");
      expect(typeof score.assistantHits).toBe("number");
      expect(typeof score.rawHits).toBe("number");
      expect(typeof score.postRefusalHits).toBe("number");
    }
  });

  test("an empty capture scores absent rather than throwing", () => {
    const score = scoreCapabilityKey("", KEY);
    expect(score).toEqual({
      present: false,
      assistantHits: 0,
      rawHits: 0,
      postRefusalHits: 0,
    });
  });

  test("the module ships an import.meta.main CLI shim for the SKILL", () => {
    // Mirrors socratic_first_turn_assert.ts: the smoke driver invokes it from
    // bash and branches on the exit code, so the shim is part of the contract.
    const src = readFileSync(
      join(PLUGIN_ROOT, "adapters", "_shared", "src", "capability_row_assert.ts"),
      "utf-8",
    );
    expect(src).toContain("import.meta.main");
    expect(src).toMatch(/process\.exit/);
  });
});

// ===========================================================================
// Derived-fixture integrity + equivalence with the untracked captures.
// ===========================================================================

const DERIVED = [
  {
    file: "spec-write-linear-2026-07-27.log",
    capture: "dpt-smoke-linear-spec-write.log",
    keys: FR_TABLE_KEYS,
  },
  {
    file: "spec-write-jira-2026-07-27.log",
    capture: "dpt-smoke-jira-spec-write.log",
    keys: FR_TABLE_KEYS,
  },
  {
    file: "ste222-probe-jira-2026-07-27.log",
    capture: "dpt-smoke-jira-ste222-probe.log",
    keys: [
      "cross_cutting_spec_stale_file_refs",
      "cross-cutting-spec-stale-file-refs",
    ],
  },
] as const;

describe("derived fixtures stay small enough to belong in git", () => {
  for (const { file } of DERIVED) {
    test(`${file} is a reproducer, not a copy`, () => {
      const bytes = readFileSync(join(FIXTURE_DIR, file)).length;
      expect(bytes).toBeGreaterThan(0);
      // The untracked sources run 200 KB – 470 KB. Past 32 KB it has stopped
      // being derived.
      expect(bytes).toBeLessThan(32 * 1024);
    });
  }
});

describe("fixture equivalence — derived vs. the untracked full capture", () => {
  // Enforced forever, not just at authoring time: whenever a 2026-07-27 run
  // artifact is present on disk, the committed reproducer must score identically
  // for every key. The captures are deliberately never committed, so these skip
  // in a clean checkout — the test name says so out loud rather than passing
  // silently.
  for (const { file, capture, keys } of DERIVED) {
    const path = findCapture(capture);
    test.skipIf(path === null)(
      `${file}: score-equivalent to ${capture}` +
        (path === null ? " [SKIPPED — untracked capture absent]" : ""),
      () => {
        const full = readFileSync(path!, "utf-8");
        const derived = fixture(file);
        for (const key of keys) {
          const a = scoreCapabilityKey(full, key);
          const b = scoreCapabilityKey(derived, key);
          expect(b).toEqual(a);
        }
      },
    );
  }

  const linear = findCapture("dpt-smoke-linear-spec-write.log");
  test.skipIf(linear === null)(
    "the raw method really does score all five present on the full capture" +
      (linear === null ? " [SKIPPED — untracked capture absent]" : ""),
    () => {
      // The finding, restated against the un-derived bytes: this is what the
      // pre-fix `grep -F` was doing on a run that emitted nothing.
      const full = readFileSync(linear!, "utf-8");
      for (const key of FR_TABLE_KEYS) {
        const score = scoreCapabilityKey(full, key);
        expect(score.rawHits).toBe(MEASURED_RAW_HITS[key]);
        expect(score.present).toBe(false);
      }
    },
  );
});
