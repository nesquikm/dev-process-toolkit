// M117 STE-428 — make /report-issue renderable and reliably covered in Phase 8.
//
// ===========================================================================
// WHAT IS BROKEN (measured, 2026-07-27)
// ===========================================================================
//
// DEFECT 1 — AN UNRENDERABLE CORRECT REFUSAL. On the Linear leg `/report-issue`
// behaved exactly right: it ran the Socratic loop, gathered the payload,
// scrubbed it, evaluated the publish gate through `check_marker_runtime.ts`,
// found the auto-approve marker ABSENT under non-tty stdin, and declined —
// `gh gist create` was never invoked. It then narrated that refusal in prose.
// `skills/report-issue/SKILL.md` line 124 already routes the branch through
// `requireOrRefuse(...)`, whose `RequiresInputRefusedError` message CARRIES the
// canonical `<dpt:requires-input-refused>v1</dpt:requires-input-refused>`
// marker — but the SKILL never mandates SURFACING that message, so the marker
// never reached the stream. `parseStreamJsonTranscript` projects a `refusal`
// entry only on that marker, a `system/refusal` event, or
// `stop_reason: "refusal"` — none present — so the capture scores `vacuous`
// (exit 3). A correct refusal is byte-indistinguishable from a run that did
// nothing.
//
// `skills/setup/SKILL.md` and `skills/spec-write/SKILL.md` already carry the
// missing clause. `/report-issue` does not. This is a copy of an exemplar, not
// a new invention — the tests below assert the exemplar's own literals.
//
// DEFECT 2 — SILENT THREE-OF-FOUR COVERAGE. On the Jira leg the fourth Phase 8
// spawn was denied by the auto-mode classifier before the child started, so
// that leg produced no `report-issue` fixture at all. Phase 8 covered three of
// four in-scope skills and its aggregate verdict did not say so. A run that
// silently covers 3/4 reads as full coverage.
//
// ===========================================================================
// THE IMPLEMENTATION DECISIONS THESE TESTS ARE WRITTEN AGAINST
// ===========================================================================
//
// (a) AC.1 — SURFACE THE EXISTING ENVELOPE. The publish gate keeps routing
//     through `requireOrRefuse(...)`. It is NOT re-routed through
//     `evaluateGateMarkerRefusal` with a new `"publish"` gate site:
//     `adapters/_shared/src/gate_marker_refusal.test.ts:134` pins
//     `GATE_SITES` to exactly `["draft","branch","setup-socratic"]` and the
//     literal ripples to two more files. A guard below re-asserts that pin.
//
// (b) AC.1 enforcement — EXTEND GATE PROBE #71, do not add #74. Probe
//     `report_issue_publish_gate_marker` already byte-checks the publish-gate
//     contract against this exact SKILL. Adding the surfacing literals to
//     `PUBLISH_GATE_REQUIRED_LITERALS` costs nothing; a probe #74 ripples to
//     ~26 sites pinned on the literal 73. NOTE FOR THE IMPLEMENTER: extending
//     that array REQUIRES updating the `KNOWN_GOOD` fixture body at
//     `tests/gate-check-report-issue-publish-gate-marker.test.ts:23-34`, or its
//     per-literal loop reds.
//
// (c) AC.2 — A SIBLING FIXTURE, NEVER AN EDIT OF THE EXISTING ONE.
//     `tests/m116-ste-422-assert-runner-projectroot.test.ts:261-267` byte-pins
//     `report-issue: vacuous askIndex=-1` / exitCode 3 for
//     `regression/report-issue-2026-07-27.json`, and :486-521 re-asserts it
//     against the untracked full capture. Editing that fixture reds at least
//     three assertions. So it STAYS as the BEFORE case, and a new sibling —
//     `regression/report-issue-publish-refused-2026-07-27.json` — is the AFTER
//     case. The sibling is DERIVED, not invented: it is the BEFORE fixture's
//     bytes verbatim plus ONE appended assistant event carrying the run's own
//     recorded closing turn with the canonical refusal envelope surfaced at the
//     end. Both verdicts are asserted in one place, which is what
//     "scores `ok-refused` after the change, where it scores `vacuous` before
//     it" means.
//
// (d) THE MARKER-vs-CAPABILITY-ROW ORDERING (measured, and the reason this
//     file pins an order at all). In the recorded assistant-text projection the
//     refusal `Context:` line ends at offset 3276 while
//     `report_issue_publish_refused` sits at offset 4454.
//     `scoreCapabilityKey` (`adapters/_shared/src/capability_row_assert.ts`
//     :110-116) SUBTRACTS every occurrence after the FIRST marker. So the
//     naive fix — dropping the marker where the refusal is EXPLAINED — leaves
//     the verdict at `ok-refused` while silently flipping that capability row
//     to `present:false`. Nothing scores that row today, so nothing would have
//     caught it; the moment AC.3/AC.4 evidence assertions land it becomes a
//     false red. The contract is therefore: the closing summary's capability
//     rows are emitted FIRST, and the verbatim refusal message — marker last
//     line — is the LAST thing the turn emits. The hazard is demonstrated
//     below with a counter-arrangement built from the same bytes.
//
// (e) AC.4 — A `--dry-run` FLAG, advertised in `argument-hint`. It must be
//     visible on the spawn command line, because what the Jira leg's
//     classifier denied was the SPAWN, before the child started; an env var or
//     an ambient "smoke context" is invisible at that boundary. Under
//     `--dry-run` the skill runs everything up to the publish boundary, never
//     invokes `gh gist create`, and stops by surfacing the SAME canonical
//     refusal envelope — so the dry run is renderable as `ok-refused` by the
//     same machinery AC.1 installs, and NO new capability key is minted (a new
//     key ripples to 6+ pinned sites). NOTE FOR THE IMPLEMENTER: this changes
//     `argument-hint` and therefore reds
//     `tests/report-issue-doc-conformance.test.ts:43`, which pins it to exactly
//     `[--full]`. That test must be updated consciously; the new value is
//     asserted explicitly below so the decision is visible rather than
//     inferred.
//
// (f) AC.3 — A COVERAGE GATE INSIDE THE EXISTING PHASE 8 FENCE, in pure shell.
//     It reuses no runner and mints no capability key, because the Phase 8
//     block is minefield-adjacent:
//       * a SECOND `bun "${ASSERT_RUNNER}"` line makes `documentedInvocation()`
//         (m116-ste-422:206-215) THROW, taking that whole file down;
//       * a new fence containing `FIXTURE_DIR=` ahead of the existing one
//         breaks `phase8Fence()` (m116-ste-423:164);
//       * any `grep -F '<capability_key>' <log>` line anywhere in the file reds
//         m116-ste-421:213-218;
//       * every literal `tests/fixtures/socratic-first-turn/<name>` path must
//         carry a tracker token AND `<skill>` (m116-ste-423:258-277).
//     Guard tests at the bottom re-assert the first, second and fourth so the
//     edit cannot silently take a sibling file down.
//
// ===========================================================================
// SCOPE FENCE — concurrent siblings
// ===========================================================================
//
// STE-429 owns the Phase 8 `vacuous` → named-inconclusive rendering and the
// per-skill scratch workspace; STE-425 owns fixture-group pass/fail/not-reached
// summary rendering. NOTHING here asserts on that vocabulary. This file's
// Phase 8 claims are exactly two: the four-fixture EXISTENCE gate, and the
// `/report-issue` exercise path.
//
// ===========================================================================
// BUDGETS
// ===========================================================================
//
// * ZERO HEADROOM on the skills/ STE-token ceiling — measured exactly 246/246
//   (`tests/shipped-prose-no-internal-namespace.test.ts:47`). Any `STE-428` /
//   `AC-STE-428.x` token added under `plugins/dev-process-toolkit/skills/` fails
//   the gate instantly. A budget test below pins the report-issue SKILL's own
//   count at its current 8 so the edit cannot spend headroom that is not there.
// * `skills/report-issue/SKILL.md` is 193 lines against the 358 cap — real
//   headroom, but pinned anyway.
// * `.claude/skills/**` is OUTSIDE the plugin: no line cap, no token ceiling.
//   Ticket ids may be cited freely there and in this file.
// * PROJECT-LOCAL PATHS. The smoke driver lives at repoRoot/.claude/skills/,
//   reached via `join(import.meta.dir, "..", "..", "..")` + `readIfPresent` +
//   `describe.skip`. A pluginRoot-scoped sweep cannot see it and would pass
//   vacuously in a consumer checkout.
// * PARAGRAPH SCOPING. Prose claims are asserted against the clause that
//   carries them, never the whole file, and every negative assertion proves its
//   slice is non-empty first.

import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import {
  REQUIRES_INPUT_REFUSED_MARKER,
  scoreCapabilityKey,
} from "../adapters/_shared/src/capability_row_assert";
import { GATE_SITES } from "../adapters/_shared/src/gate_marker_refusal";
import {
  PUBLISH_GATE_REQUIRED_LITERALS,
  runReportIssuePublishGateMarkerProbe,
} from "../adapters/_shared/src/report_issue_publish_gate_marker";
import type { TranscriptEntry } from "../adapters/_shared/src/socratic_first_turn";
import {
  type AssertVerdict,
  verdictFor,
} from "../adapters/_shared/src/socratic_first_turn_assert";
import { parseStreamJsonTranscript } from "../adapters/_shared/src/socratic_first_turn_stream";
import { specWriteStep7Map } from "./_skill-md";

// ===========================================================================
// Surfaces
// ===========================================================================

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");

const REPORT_ISSUE_SKILL_PATH = join(
  PLUGIN_ROOT,
  "skills",
  "report-issue",
  "SKILL.md",
);
const SMOKE_SKILL_PATH = join(
  REPO_ROOT,
  ".claude",
  "skills",
  "smoke-test",
  "SKILL.md",
);

function readIfPresent(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

const REPORT_ISSUE = readFileSync(REPORT_ISSUE_SKILL_PATH, "utf8");
const SMOKE = readIfPresent(SMOKE_SKILL_PATH);
const describeIfSmoke = SMOKE === null ? describe.skip : describe;

const CAPTURE_DIR = join(PLUGIN_ROOT, "tests", "fixtures", "socratic-first-turn");
const REGRESSION_DIR = join(CAPTURE_DIR, "regression");

/** The BEFORE case — pinned `vacuous` by m116-ste-422; untouched here. */
const BEFORE_FIXTURE = join(REGRESSION_DIR, "report-issue-2026-07-27.json");
/** The AFTER case — this FR's sibling. */
const AFTER_FIXTURE = join(
  REGRESSION_DIR,
  "report-issue-publish-refused-2026-07-27.json",
);
/** The untracked full run artifact. Present only on the capturing machine. */
const FULL_CAPTURE = join(CAPTURE_DIR, "report-issue-2026-07-27.json");

const IN_SCOPE_SKILLS = [
  "setup",
  "brainstorm",
  "spec-write",
  "report-issue",
] as const;

// ===========================================================================
// Fixture / transcript helpers
// ===========================================================================

function ndjsonOf(path: string): string {
  return readFileSync(path, "utf8");
}

function transcriptOf(path: string): TranscriptEntry[] {
  return parseStreamJsonTranscript(ndjsonOf(path));
}

/** Non-blank NDJSON lines, in stream order. */
function ndjsonLines(raw: string): string[] {
  return raw.split("\n").filter((l) => l.trim().length > 0);
}

/**
 * The leading provenance `user` event's text — the house convention for
 * derived fixtures under `regression/`: it records what the artifact was
 * derived from and why, so a reader can tell an observed capture from a
 * reconstructed one without diffing bytes.
 */
function provenanceText(path: string): string {
  for (const line of ndjsonLines(ndjsonOf(path))) {
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    const rec = event as {
      type?: string;
      message?: { content?: { type?: string; text?: string }[] };
    };
    if (rec.type !== "user") continue;
    return (rec.message?.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");
  }
  return "";
}

/** The text of the LAST assistant text block in a capture. */
function lastAssistantText(raw: string): string {
  const texts: string[] = [];
  for (const line of ndjsonLines(raw)) {
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    const e = event as {
      type?: string;
      message?: { content?: Array<{ type?: string; text?: unknown }> };
    };
    if (e.type !== "assistant") continue;
    for (const block of e.message?.content ?? []) {
      if (block.type === "text" && typeof block.text === "string") {
        texts.push(block.text);
      }
    }
  }
  return texts[texts.length - 1] ?? "";
}

/** Re-wrap one assistant text block as a single-event NDJSON capture. */
function captureWithClosingText(prefixRaw: string, text: string): string {
  const head = ndjsonLines(prefixRaw).slice(0, -1).join("\n");
  const event = {
    type: "assistant",
    message: { role: "assistant", content: [{ type: "text", text }] },
  };
  return `${head}\n${JSON.stringify(event)}\n`;
}

/**
 * The recorded project root, derived from committed bytes rather than from
 * this machine's disk — the same technique m116-ste-422 uses. The Linear leg's
 * `/setup` transcript scaffolds `<root>/CLAUDE.md`, so the root is that
 * entry's dirname.
 */
function capturedProjectRoot(): string {
  const entry = transcriptOf(join(REGRESSION_DIR, "setup-2026-07-27.json")).find(
    (e) =>
      e.type === "tool_use" &&
      typeof e.path === "string" &&
      basename(e.path) === "CLAUDE.md",
  );
  if (!entry?.path) {
    throw new Error(
      "STE-428: cannot derive the captured project root — the committed " +
        "`regression/setup-2026-07-27.json` fixture no longer carries an " +
        "in-project `<root>/CLAUDE.md` scaffold entry.",
    );
  }
  return dirname(entry.path);
}

const CAPTURED_PROJECT_ROOT = capturedProjectRoot();

/**
 * Replay a fixture the way the Phase 8 runner is invoked post-STE-422 — three
 * arguments, the third being the run's own test project. The two-argument form
 * counts the operator's out-of-project global-instruction Write as a violation
 * and would mask every verdict this FR is about.
 */
function replay(path: string): AssertVerdict {
  return verdictFor("report-issue", transcriptOf(path), {
    projectRoot: CAPTURED_PROJECT_ROOT,
  });
}

// ===========================================================================
// Prose-slicing helpers (paragraph scope, never whole-file)
// ===========================================================================

/**
 * The `**Publish gate — marker/refusal routing.**` block, from its bold lead
 * through the start of the NOT-a-trigger anchor that follows it. This is where
 * the ABSENT + non-tty branch lives (SKILL.md:121-127) and therefore the only
 * place the surfacing mandate may claim to be enforced from.
 */
function publishGateClause(): string {
  const start = REPORT_ISSUE.indexOf("**Publish gate — marker/refusal routing.**");
  if (start === -1) return "";
  const end = REPORT_ISSUE.indexOf("**NOT-a-trigger anchor.**", start);
  return REPORT_ISSUE.slice(start, end === -1 ? undefined : end);
}

/** The `### 7. Preview gate` section, up to `### 8.`. */
function previewGateSection(): string {
  const start = REPORT_ISSUE.indexOf("### 7. Preview gate");
  if (start === -1) return "";
  const end = REPORT_ISSUE.indexOf("### 8.", start);
  return REPORT_ISSUE.slice(start, end === -1 ? undefined : end);
}

/** Fenced-code-block bodies of `body`, in document order. */
function fencedBlocks(body: string): string[] {
  const out: string[] = [];
  let inBlock = false;
  let buf: string[] = [];
  for (const line of body.split("\n")) {
    if (/^\s*```/.test(line)) {
      if (inBlock) {
        out.push(buf.join("\n"));
        buf = [];
      }
      inBlock = !inBlock;
      continue;
    }
    if (inBlock) buf.push(line);
  }
  return out;
}

/** The `### Phase 8` section of the smoke SKILL, up to the next `### `. */
function phase8Section(): string {
  const body = SMOKE ?? "";
  const lines = body.split("\n");
  const start = lines.findIndex((l) => l.startsWith("### Phase 8"));
  if (start === -1) return "";
  for (let i = start + 1; i < lines.length; i++) {
    if (/^### /.test(lines[i]!)) return lines.slice(start, i).join("\n");
  }
  return lines.slice(start).join("\n");
}

/** The Phase 8 driver-wrapper fence — the one that assigns `FIXTURE_DIR=`. */
function phase8Fence(): string {
  return fencedBlocks(SMOKE ?? "").find((b) => b.includes("FIXTURE_DIR="))
    ?? "";
}

/**
 * The refusal marker the SHIPPED publish-gate clause mandates surfacing, or
 * `null` when it mandates none.
 *
 * This is the hinge of AC-STE-428.2, and the reason its headline assertion is
 * not a tautology: the sibling fixture is only evidence about the recorded run
 * if the skill really does promise to emit what the fixture carries. Mirrors
 * `documentedProjectRoot()` in m116-ste-422 — read the contract out of the
 * shipped prose, then replay the recorded bytes under it.
 */
function mandatedRefusalMarker(): string | null {
  const clause = publishGateClause();
  if (clause.length === 0) return null;
  if (
    !/refusal MUST be surfaced verbatim|MUST surface the `RequiresInputRefusedError` message/.test(
      clause,
    )
  ) {
    return null;
  }
  if (!clause.includes(REQUIRES_INPUT_REFUSED_MARKER)) return null;
  return REQUIRES_INPUT_REFUSED_MARKER;
}

const COVERAGE_BEGIN = "# BEGIN phase-8 coverage gate";
const COVERAGE_END = "# END phase-8 coverage gate";

/**
 * The coverage-gate region of the Phase 8 fence: the lines strictly between
 * the two sentinel comments. Empty when the sentinels are absent.
 */
function coverageGateSnippet(): string {
  const fence = phase8Fence();
  const lines = fence.split("\n");
  const begin = lines.findIndex((l) => l.includes(COVERAGE_BEGIN));
  const end = lines.findIndex((l) => l.includes(COVERAGE_END));
  if (begin === -1 || end === -1 || end <= begin) return "";
  return lines.slice(begin + 1, end).join("\n");
}

/**
 * Run the documented coverage-gate snippet over a throwaway fixture directory
 * seeded with `present`. Returns its stdout, trimmed. The gate's only inputs
 * are `FIXTURE_DIR`, `TRACKER` and `DATE`, which the surrounding fence already
 * assigns — anything else it reaches for is a bug in the snippet.
 */
function runCoverageGate(present: readonly string[]): string {
  const snippet = coverageGateSnippet();
  const dir = mkdtempSync(join(tmpdir(), "ste-428-phase8-"));
  try {
    for (const skill of present) {
      writeFileSync(
        join(dir, `${skill}-linear-2026-07-27.json`),
        '{"type":"result","subtype":"success"}\n',
      );
    }
    const script = [
      `FIXTURE_DIR=${JSON.stringify(dir)}`,
      "TRACKER=linear",
      "DATE=2026-07-27",
      snippet,
    ].join("\n");
    const proc = Bun.spawnSync(["bash", "-c", script]);
    return new TextDecoder().decode(proc.stdout).trim();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ===========================================================================
// AC-STE-428.1 — a publish refusal carries the canonical refusal marker.
// ===========================================================================

describe("AC-STE-428.1 — the publish refusal surfaces the canonical marker", () => {
  test("the publish-gate clause still anchors (non-vacuity for everything below)", () => {
    const clause = publishGateClause();
    expect(clause.length).toBeGreaterThan(200);
    expect(clause).toContain("check_marker_runtime.ts");
    expect(clause).toContain("RequiresInputRefusedError");
    expect(clause).toContain("report_issue_publish_refused");
  });

  test("the clause mandates SURFACING the refusal, not narrating it", () => {
    // The whole defect in one assertion: the routing was already right; what
    // was missing is the instruction to put the error's own message on the
    // stream. Both exemplars phrase this as a MUST.
    const clause = publishGateClause();
    expect(clause).toMatch(
      /refusal MUST be surfaced verbatim|MUST surface the `RequiresInputRefusedError` message/,
    );
  });

  test("the clause names the canonical marker literal verbatim", () => {
    // Byte-identical to the module's export — a paraphrased or version-drifted
    // marker is exactly as unrenderable as no marker at all.
    expect(REQUIRES_INPUT_REFUSED_MARKER).toBe(
      "<dpt:requires-input-refused>v1</dpt:requires-input-refused>",
    );
    expect(publishGateClause()).toContain(REQUIRES_INPUT_REFUSED_MARKER);
  });

  test("the clause carries the exemplar's rationale, not a bare directive", () => {
    // `skills/setup/SKILL.md:11` and `skills/spec-write/SKILL.md:10` both spell
    // out WHY, and the reason is the thing a future editor needs in order not
    // to delete the clause as noise. Same literal, no new wording.
    expect(publishGateClause()).toContain(
      "prose-only refusal reads as `vacuous` (a non-pass)",
    );
  });

  test("the mandate lives in the publish-gate clause, not elsewhere in the file", () => {
    // Paragraph scope. A whole-file grep is satisfiable from seventy lines
    // away — e.g. from the § 0 FIRST ACTION blockquote, which is about the
    // Socratic first turn, not about the publish gate this FR is fixing.
    const clause = publishGateClause();
    expect(clause.length).toBeGreaterThan(0);
    const firstAction = REPORT_ISSUE.slice(
      0,
      REPORT_ISSUE.indexOf("## When to Use This"),
    );
    expect(firstAction.length).toBeGreaterThan(0);
    expect(clause).toContain(REQUIRES_INPUT_REFUSED_MARKER);
  });

  test("the exemplar clause this copies is really present in both exemplars", () => {
    // Non-vacuity for "mirror the exemplar": if the exemplars ever lose the
    // wording, the assertions above are pinning an invention.
    const setup = readFileSync(
      join(PLUGIN_ROOT, "skills", "setup", "SKILL.md"),
      "utf8",
    );
    const specWrite = readFileSync(
      join(PLUGIN_ROOT, "skills", "spec-write", "SKILL.md"),
      "utf8",
    );
    for (const body of [setup, specWrite]) {
      expect(body).toContain(REQUIRES_INPUT_REFUSED_MARKER);
      expect(body).toContain("prose-only refusal reads as `vacuous` (a non-pass)");
    }
  });
});

// ===========================================================================
// AC-STE-428.1 (enforcement) — gate probe #71 is EXTENDED, #74 is not added.
// ===========================================================================

describe("AC-STE-428.1 — probe #71 byte-checks the surfacing mandate", () => {
  test("PUBLISH_GATE_REQUIRED_LITERALS gains the canonical marker", () => {
    expect([...PUBLISH_GATE_REQUIRED_LITERALS]).toContain(
      REQUIRES_INPUT_REFUSED_MARKER,
    );
  });

  test("…and a literal that pins the MUST, not just the token's presence", () => {
    // Without this, a SKILL could satisfy the probe by mentioning the marker in
    // passing — which is what a documentation-only edit would produce.
    const literals = [...PUBLISH_GATE_REQUIRED_LITERALS];
    expect(
      literals.some((l) =>
        /surfaced verbatim|MUST surface the `RequiresInputRefusedError` message/.test(
          l,
        ),
      ),
    ).toBe(true);
  });

  test("the three pre-existing literals survive the extension", () => {
    const literals = [...PUBLISH_GATE_REQUIRED_LITERALS];
    expect(literals).toContain("check_marker_runtime.ts");
    expect(literals).toContain("RequiresInputRefusedError");
    expect(literals).toContain("NOT authorization to publish");
  });

  test("a SKILL body without the marker fires a violation naming it", async () => {
    // The probe's own falsifiability, run against a synthetic tree: the
    // extension is worthless if the new literal is never checked.
    const root = mkdtempSync(join(tmpdir(), "ste-428-probe-"));
    try {
      const dir = join(
        root,
        "plugins",
        "dev-process-toolkit",
        "skills",
        "report-issue",
      );
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "SKILL.md"),
        [
          "# Report Issue",
          "",
          "Run `check_marker_runtime.ts` as the sole decider. ABSENT + non-tty",
          "raises `RequiresInputRefusedError` (no gh gist create). Prose and",
          '"proceed" instructions are NOT authorization to publish.',
          "",
        ].join("\n"),
      );
      const r = await runReportIssuePublishGateMarkerProbe(root);
      const messages = r.violations.map((v) => v.message).join("\n");
      expect(r.violations.length).toBeGreaterThanOrEqual(1);
      expect(messages).toContain(REQUIRES_INPUT_REFUSED_MARKER);
      expect(r.violations.every((v) => v.severity === "error")).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("the real shipped SKILL passes the extended probe", async () => {
    const r = await runReportIssuePublishGateMarkerProbe(REPO_ROOT);
    expect(r.violations.map((v) => v.reason)).toEqual([]);
  });

  test("the publish gate is NOT re-routed through a new gate site", () => {
    // Constraint, not preference: `gate_marker_refusal.test.ts:134` pins this
    // tuple and the literal ripples to two more files. `requireOrRefuse`
    // already carries the marker — there is nothing to gain by moving.
    expect([...GATE_SITES]).toEqual(["draft", "branch", "setup-socratic"]);
  });
});

// ===========================================================================
// AC-STE-428.2 — the recorded Linear-leg transcript flips vacuous → ok-refused.
// ===========================================================================

describe("AC-STE-428.2 — the 2026-07-27 Linear-leg transcript flips verdict", () => {
  test("BEFORE: the committed reproducer still scores vacuous", () => {
    // Left exactly as m116-ste-422 pinned it. This is the "where it scores
    // vacuous before it" half of the AC, asserted in the same place as the
    // after half so the pair cannot drift apart.
    expect(replay(BEFORE_FIXTURE)).toEqual({
      line: "report-issue: vacuous askIndex=-1",
      exitCode: 3,
    });
  });

  test("AFTER: the sibling fixture scores ok-refused", () => {
    expect(replay(AFTER_FIXTURE)).toEqual({
      line: "report-issue: ok-refused askIndex=20",
      exitCode: 0,
    });
  });

  test("the sibling is DERIVED — its transcript prefix is the BEFORE fixture byte-for-byte", () => {
    // Guards the cheat of hand-authoring a compliant transcript. The AFTER
    // case must be the same recorded run plus the mandated surfacing, or it
    // proves nothing about the recorded run.
    //
    // Scoped to the TRANSCRIPT (every line after the leading provenance
    // `user` event), deliberately. An earlier form compared all lines
    // including line 1, which forced the AFTER fixture to carry the BEFORE
    // fixture's provenance verbatim — so it described itself as an STE-422
    // reproducer and claimed verdict-equivalence with the full capture, which
    // is the very equivalence it exists to break. A byte pin that mandates a
    // false self-description is worse than no pin; the provenance is metadata
    // and gets its own assertion below.
    const before = ndjsonLines(ndjsonOf(BEFORE_FIXTURE)).slice(1);
    const after = ndjsonLines(ndjsonOf(AFTER_FIXTURE)).slice(1);
    expect(before.length).toBeGreaterThan(0);
    expect(after.length).toBe(before.length + 1);
    expect(after.slice(0, before.length)).toEqual(before);
  });

  test("the AFTER fixture's provenance describes itself, not its BEFORE sibling", () => {
    // The pair's whole value is that the two score differently. A provenance
    // block copied from the sibling mislabels the artifact and asserts an
    // equivalence this fixture is built to falsify.
    const beforeProv = provenanceText(BEFORE_FIXTURE);
    const afterProv = provenanceText(AFTER_FIXTURE);
    expect(beforeProv.length).toBeGreaterThan(0);
    expect(afterProv.length).toBeGreaterThan(0);
    expect(afterProv).not.toBe(beforeProv);
    // It must disclose the one thing that makes it different: an appended
    // assistant turn carrying the surfaced refusal.
    expect(afterProv).toMatch(/append/i);
    expect(afterProv).toMatch(/ok-refused/);
    // And it must not claim the equivalence it breaks.
    expect(afterProv).not.toMatch(/Verdict-equivalence with the full capture/);
  });

  test("the appended event is one assistant text block ending with the marker", () => {
    const text = lastAssistantText(ndjsonOf(AFTER_FIXTURE));
    expect(text.length).toBeGreaterThan(0);
    expect(text.trimEnd().endsWith(REQUIRES_INPUT_REFUSED_MARKER)).toBe(true);
    // The canonical envelope, not a bare token: `renderRefusalMessage` emits
    // Verdict / Remedy / Context / marker, in that order.
    expect(text).toContain("Verdict: /report-issue step 7");
    expect(text).toContain("Remedy:");
    expect(text).toContain("Context: skill=/report-issue");
  });

  test("the marker the fixture carries is the one the SKILL mandates", () => {
    // The coupling that makes the pair non-decorative: a fixture asserting a
    // marker the shipped SKILL never promises to emit is fiction.
    const clause = publishGateClause();
    expect(clause).toContain(REQUIRES_INPUT_REFUSED_MARKER);
    expect(lastAssistantText(ndjsonOf(AFTER_FIXTURE))).toContain(
      REQUIRES_INPUT_REFUSED_MARKER,
    );
  });

  test("the SHIPPED mandate, applied to the recorded turn, is what flips the verdict", () => {
    // The AC end to end, with nothing assumed. Take the recorded closing turn
    // stripped back to the bytes the run actually emitted, append whatever the
    // shipped publish-gate clause mandates surfacing (nothing, today), and score
    // it. With no mandate there is nothing to append and the replay stays
    // `vacuous` — which is precisely the 2026-07-27 outcome.
    const raw = ndjsonOf(AFTER_FIXTURE);
    const recorded = lastAssistantText(raw)
      .split(REQUIRES_INPUT_REFUSED_MARKER)
      .join("")
      .trimEnd();
    const mandate = mandatedRefusalMarker();
    const replayed = captureWithClosingText(
      raw,
      mandate === null ? recorded : `${recorded}\n${mandate}`,
    );
    expect(
      verdictFor("report-issue", parseStreamJsonTranscript(replayed), {
        projectRoot: CAPTURED_PROJECT_ROOT,
      }),
    ).toEqual({ line: "report-issue: ok-refused askIndex=20", exitCode: 0 });
  });

  test("removing the marker returns the sibling to vacuous (non-vacuity)", () => {
    // The marker is the SOLE cause of the flip. If this ever passes with the
    // marker stripped, the ok-refused assertion above is meaningless.
    const raw = ndjsonOf(AFTER_FIXTURE);
    const stripped = captureWithClosingText(
      raw,
      lastAssistantText(raw).split(REQUIRES_INPUT_REFUSED_MARKER).join(""),
    );
    expect(
      verdictFor("report-issue", parseStreamJsonTranscript(stripped), {
        projectRoot: CAPTURED_PROJECT_ROOT,
      }),
    ).toEqual({ line: "report-issue: vacuous askIndex=-1", exitCode: 3 });
  });

  test("the sibling stays small enough to belong in git", () => {
    const bytes = readFileSync(AFTER_FIXTURE).length;
    expect(bytes).toBeGreaterThan(0);
    expect(bytes).toBeLessThan(32 * 1024);
  });

  const capturePresent = existsSync(FULL_CAPTURE);
  test.skipIf(!capturePresent)(
    "provenance: the appended turn is the run's own recorded closing text" +
      (capturePresent ? "" : " [SKIPPED — untracked capture absent]"),
    () => {
      // Enforced forever, not just at authoring time. Whenever the 2026-07-27
      // run artifact is on disk, the sibling's added turn must still open with
      // the bytes the run actually emitted — otherwise the "derived from the
      // recorded transcript" claim has quietly become false.
      const recorded = lastAssistantText(ndjsonOf(FULL_CAPTURE));
      expect(recorded.length).toBeGreaterThan(0);
      expect(recorded).not.toContain(REQUIRES_INPUT_REFUSED_MARKER);
      expect(lastAssistantText(ndjsonOf(AFTER_FIXTURE)).startsWith(recorded)).toBe(
        true,
      );
      // …and the full capture itself is still the vacuous BEFORE case.
      expect(
        verdictFor("report-issue", transcriptOf(FULL_CAPTURE), {
          projectRoot: CAPTURED_PROJECT_ROOT,
        }),
      ).toEqual({ line: "report-issue: vacuous askIndex=-1", exitCode: 3 });
    },
  );
});

// ===========================================================================
// The ordering hazard — capability rows BEFORE the marker, measured.
// ===========================================================================

describe("AC-STE-428.2 — the refusal marker lands AFTER the capability rows", () => {
  const capturePresent = existsSync(FULL_CAPTURE);

  test.skipIf(!capturePresent)(
    "measured provenance: the recorded refusal explanation precedes the row" +
      (capturePresent ? "" : " [SKIPPED — untracked capture absent]"),
    () => {
      // The reason this ordering needs pinning at all: in the run's own
      // assistant-text projection the refusal Context line ends near offset
      // 3276 and `report_issue_publish_refused` sits near 4454. Drop the marker
      // at the explanation site and the row falls downstream of it.
      const recorded = lastAssistantText(ndjsonOf(FULL_CAPTURE));
      const ctx = recorded.indexOf("Context: skill=/report-issue");
      const row = recorded.indexOf("report_issue_publish_refused");
      expect(ctx).toBeGreaterThan(-1);
      expect(row).toBeGreaterThan(ctx);
    },
  );

  test("the sibling scores the capability row PRESENT with zero post-refusal hits", () => {
    const score = scoreCapabilityKey(
      ndjsonOf(AFTER_FIXTURE),
      "report_issue_publish_refused",
    );
    expect(score.present).toBe(true);
    expect(score.assistantHits).toBeGreaterThanOrEqual(1);
    expect(score.postRefusalHits).toBe(0);
  });

  test("the naive ordering silently kills the row while the verdict stays green", () => {
    // The counter-arrangement, built from the SAME bytes: surface the canonical
    // envelope where the refusal is EXPLAINED instead of at the end.
    // `scoreCapabilityKey` subtracts every hit after the first marker, so the
    // row scores absent — and the first-turn verdict is still `ok-refused`, so
    // the verdict alone can never catch this. That is why the order is pinned.
    const raw = ndjsonOf(AFTER_FIXTURE);
    const stripped = lastAssistantText(raw)
      .split(REQUIRES_INPUT_REFUSED_MARKER)
      .join("")
      .trimEnd();
    const anchor = stripped.indexOf("Context: skill=/report-issue");
    expect(anchor).toBeGreaterThan(-1);
    const eol = stripped.indexOf("\n", anchor);
    const naiveText =
      stripped.slice(0, eol + 1) +
      REQUIRES_INPUT_REFUSED_MARKER +
      "\n" +
      stripped.slice(eol + 1);
    const naive = captureWithClosingText(raw, naiveText);

    expect(
      verdictFor("report-issue", parseStreamJsonTranscript(naive), {
        projectRoot: CAPTURED_PROJECT_ROOT,
      }),
    ).toEqual({ line: "report-issue: ok-refused askIndex=20", exitCode: 0 });

    const score = scoreCapabilityKey(naive, "report_issue_publish_refused");
    expect(score.present).toBe(false);
    expect(score.postRefusalHits).toBe(1);
  });

  test("the SKILL mandates the order the fixture demonstrates", () => {
    // Prose half of the pin. Without it the fixture merely records one lucky
    // arrangement; with it, the arrangement is the contract.
    const clause = publishGateClause();
    expect(clause.length).toBeGreaterThan(0);
    expect(clause).toMatch(
      /capability row.{0,160}before the (verbatim )?refusal message|emit `report_issue_publish_refused` (first|before)/i,
    );
    expect(clause).toMatch(
      /refusal message.{0,160}last|last thing (the turn|this skill) emits/i,
    );
  });
});

// ===========================================================================
// AC-STE-428.3 — Phase 8 asserts all four fixtures before its aggregate verdict.
// ===========================================================================

describeIfSmoke("AC-STE-428.3 — Phase 8 four-fixture coverage gate", () => {
  test("the Phase 8 section and its driver fence still anchor", () => {
    expect(phase8Section().length).toBeGreaterThan(500);
    expect(phase8Fence()).toContain("FIXTURE_DIR=");
    expect(phase8Fence()).toContain("for SKILL in");
  });

  test("Phase 8 prose documents the coverage assertion over all four skills", () => {
    const section = phase8Section();
    for (const skill of IN_SCOPE_SKILLS) expect(section).toContain(skill);
    expect(section).toMatch(
      /all four .{0,80}fixtures? (exist|are present)|four-fixture coverage/i,
    );
  });

  test("Phase 8 prose states a missing fixture is named and bars the aggregate", () => {
    // The exact 2026-07-27 Jira-leg failure: three of four covered, aggregate
    // silent about it. Naming the skill is the whole remedy.
    const section = phase8Section();
    expect(section.length).toBeGreaterThan(0);
    expect(section).toMatch(/name[sd]? the missing skill|missing skill by name/i);
    expect(section).toMatch(
      /never .{0,60}aggregate pass|bars? .{0,40}aggregate|cannot .{0,40}aggregate pass/i,
    );
  });

  test("the coverage gate lives inside the existing Phase 8 fence, sentinel-delimited", () => {
    const fence = phase8Fence();
    expect(fence).toContain(COVERAGE_BEGIN);
    expect(fence).toContain(COVERAGE_END);
    expect(coverageGateSnippet().trim().length).toBeGreaterThan(0);
    // It must run AFTER the spawn loop it is auditing — a gate that runs first
    // measures the previous run.
    expect(fence.indexOf(COVERAGE_BEGIN)).toBeGreaterThan(fence.indexOf("for SKILL in"));
  });

  test("a complete run reports 4/4", () => {
    expect(runCoverageGate(IN_SCOPE_SKILLS)).toBe(
      "PHASE8-COVERAGE: complete — 4/4 fixtures",
    );
  });

  test("a three-of-four run names the missing skill instead of passing", () => {
    // The recorded Jira-leg shape, replayed: report-issue never produced a
    // fixture because its spawn was denied before the child started.
    const out = runCoverageGate(["setup", "brainstorm", "spec-write"]);
    expect(out).toBe("PHASE8-COVERAGE: incomplete — missing report-issue");
    // Must not render the COMPLETE verdict. Anchored on the verdict token, not
    // a bare substring: "incomplete" contains "complete", so `not.toContain
    // ("complete")` is unsatisfiable against the line above.
    expect(out).not.toMatch(/COVERAGE: complete\b/);
  });

  test("an empty fixture counts as missing, not as covered", () => {
    // A denied spawn still leaves the shell redirect's 0-byte file behind, so
    // an existence-only check would score the exact failure mode as covered.
    const dir = mkdtempSync(join(tmpdir(), "ste-428-phase8-empty-"));
    try {
      for (const skill of IN_SCOPE_SKILLS) {
        writeFileSync(
          join(dir, `${skill}-linear-2026-07-27.json`),
          skill === "report-issue" ? "" : '{"type":"result"}\n',
        );
      }
      const script = [
        `FIXTURE_DIR=${JSON.stringify(dir)}`,
        "TRACKER=linear",
        "DATE=2026-07-27",
        coverageGateSnippet(),
      ].join("\n");
      const proc = Bun.spawnSync(["bash", "-c", script]);
      expect(new TextDecoder().decode(proc.stdout).trim()).toBe(
        "PHASE8-COVERAGE: incomplete — missing report-issue",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("every missing skill is named, not just the first", () => {
    const out = runCoverageGate(["setup", "brainstorm"]);
    expect(out).toBe(
      "PHASE8-COVERAGE: incomplete — missing spec-write report-issue",
    );
  });
});

// ===========================================================================
// AC-STE-428.4 — /report-issue is exercisable without an outward publish.
// ===========================================================================

describe("AC-STE-428.4 — the --dry-run path", () => {
  test("argument-hint advertises the flag (the decision, stated explicitly)", () => {
    // This value is the visible half of the decision, and it DELIBERATELY reds
    // `tests/report-issue-doc-conformance.test.ts:43`, which pins the hint to
    // exactly `[--full]`. Updating that pin is part of the change, not an
    // accident of it. The flag must be on the command line because what the
    // classifier denied on 2026-07-27 was the SPAWN, before the child started.
    const m = REPORT_ISSUE.match(/^argument-hint:\s*['"](.+?)['"]\s*$/m);
    expect(m).not.toBeNull();
    expect(m![1]).toBe("[--full] [--dry-run]");
  });

  test("the SKILL documents the dry-run path inside the preview-gate section", () => {
    const section = previewGateSection();
    expect(section.length).toBeGreaterThan(200);
    expect(section).toContain("--dry-run");
  });

  test("dry-run runs everything up to the publish boundary and stops there", () => {
    const section = previewGateSection();
    expect(section.length).toBeGreaterThan(0);
    expect(section).toMatch(/up to the publish boundary|publish boundary/i);
  });

  test("dry-run never invokes `gh gist create` — the no-outward-publish claim", () => {
    const section = previewGateSection();
    expect(section.length).toBeGreaterThan(0);
    expect(section).toMatch(
      /`--dry-run`[\s\S]{0,400}(never|NOT|not) invoke[ds]?[\s\S]{0,80}gh gist create|gh gist create[\s\S]{0,120}(never|NOT|not) invoked[\s\S]{0,120}`--dry-run`/,
    );
  });

  test("dry-run stops by surfacing the SAME canonical refusal envelope", () => {
    // This is what makes AC.4 renderable with AC.1's machinery instead of a
    // second mechanism: the dry run halts at the boundary through the marker-
    // bearing envelope, so Phase 8 scores it `ok-refused` exactly like a real
    // marker-absent refusal, and no new capability key is minted.
    const section = previewGateSection();
    expect(section.length).toBeGreaterThan(0);
    expect(section).toContain(REQUIRES_INPUT_REFUSED_MARKER);
    expect(section).toContain("report_issue_publish_refused");
  });

  test("no new capability key is minted — every key in the SKILL is registered", () => {
    // A new key ripples to 6+ pinned sites (the /spec-write § 7 map row,
    // CANONICAL_CAPABILITY_KEYS + KEY_OWNER_SKILL, EXPECTED_SET_A and two
    // `toBe(34)` counts in m84-ste-320, plus this SKILL's own row list — whose
    // "Seven capability rows" prose is ALREADY wrong, since
    // `report_issue_publish_refused` is an unlisted eighth). The dry-run path
    // reuses that existing key precisely to avoid the whole bill.
    //
    // The registry checked here is the /spec-write § 7 static map, which is what
    // this SKILL's own § "Capability rows" cites as the registration point.
    // `CANONICAL_CAPABILITY_KEYS` is the narrower gate-check MUST-emit set and
    // deliberately omits the three oldest /report-issue rows.
    const MODULE_BASENAMES = new Set([
      "report_issue_session_select",
      "report_issue_verify_evidence",
      "report_issue_publish_gate_marker",
    ]);
    const map = specWriteStep7Map(
      readFileSync(join(PLUGIN_ROOT, "skills", "spec-write", "SKILL.md"), "utf8"),
    );
    const tokens = new Set(REPORT_ISSUE.match(/\breport_issue_[a-z_]+\b/g) ?? []);
    expect(tokens.size).toBeGreaterThan(0);
    const unregistered = [...tokens].filter(
      (t) => !map.includes(`\`${t}\``) && !MODULE_BASENAMES.has(t),
    );
    expect(unregistered).toEqual([]);
    // Non-vacuity: an invented key really would be reported.
    expect(map.includes("`report_issue_dry_run_skipped`")).toBe(false);
  });
});

describeIfSmoke("AC-STE-428.4 — Phase 8 exercises /report-issue in dry-run", () => {
  test("the driver fence passes --dry-run, and only to report-issue", () => {
    const fence = phase8Fence();
    expect(fence).toContain("--dry-run");
    const bound = fence
      .split("\n")
      .filter((l) => l.includes("--dry-run") && l.includes("report-issue"));
    expect(bound.length).toBeGreaterThanOrEqual(1);
  });

  test("the heredoc's skill invocation carries the per-skill argument", () => {
    // A `--dry-run` assigned into a variable that the prompt body never expands
    // is a comment, not a flag.
    const fence = phase8Fence();
    const line = fence
      .split("\n")
      .find((l) => l.includes("/dev-process-toolkit:${SKILL}"));
    expect(line).toBeDefined();
    expect(line!).toMatch(/\/dev-process-toolkit:\$\{SKILL\}\s+\$\{?\w+\}?/);
  });

  test("Phase 8 prose says the dry run performs no outward publish", () => {
    const section = phase8Section();
    expect(section.length).toBeGreaterThan(0);
    expect(section).toContain("--dry-run");
    expect(section).toMatch(/no (outward |third-party )?publish|no gist/i);
  });
});

// ===========================================================================
// Budgets and blast-radius guards.
// ===========================================================================

describe("STE-428 — budgets", () => {
  test("skills/report-issue/SKILL.md stays within the NFR-1 line cap (358)", () => {
    expect(REPORT_ISSUE.split("\n").length).toBeLessThanOrEqual(358);
  });

  test("the SKILL's internal-namespace token count does not increase", () => {
    // ZERO HEADROOM: the skills/ ceiling is measured at exactly 246/246
    // (`shipped-prose-no-internal-namespace.test.ts:47`). Every token this file
    // adds under skills/ fails the gate instantly, so the edit must cite the
    // ticket in the FR and in THIS file — never in shipped prose.
    const tokens = REPORT_ISSUE.match(/\b(STE|AC-STE)-\d+(?:\.\d+)?\b/g) ?? [];
    expect(tokens.length).toBeLessThanOrEqual(8);
    expect(REPORT_ISSUE).not.toContain("STE-428");
  });
});

describeIfSmoke("STE-428 — the Phase 8 edit does not take a sibling file down", () => {
  test("exactly ONE `bun ${ASSERT_RUNNER}` invocation survives", () => {
    // A second one makes `documentedInvocation()` (m116-ste-422:206-215) THROW
    // at module scope, taking that entire file with it.
    const joined = (SMOKE ?? "").replace(/\\\r?\n[ \t]*/g, " ");
    const calls = joined.match(/\bbun\s+"?\$\{?ASSERT_RUNNER\}?"?/g) ?? [];
    expect(calls).toHaveLength(1);
  });

  test("exactly ONE fenced block assigns FIXTURE_DIR=", () => {
    // `phase8Fence()` in m116-ste-423:164 takes the FIRST such fence; a new one
    // ahead of the driver wrapper silently redirects every assertion in that
    // file at the wrong block.
    const fences = fencedBlocks(SMOKE ?? "").filter((b) =>
      b.includes("FIXTURE_DIR="),
    );
    expect(fences).toHaveLength(1);
  });

  test("every literal socratic-first-turn fixture path stays tracker-scoped", () => {
    // m116-ste-423:258-277. The coverage gate must reference fixtures through
    // `${FIXTURE_DIR}` / `${TRACKER}` / `${DATE}`, never as a literal path.
    const names = [
      ...(SMOKE ?? "").matchAll(
        /tests\/fixtures\/socratic-first-turn\/([^\s`)"']+)/g,
      ),
    ].map((m) => m[1]!);
    expect(names.length).toBeGreaterThan(0);
    // Same tracker-segment alternation m116-ste-423:105 uses, so this guard
    // agrees with the invariant it is protecting rather than a stricter one.
    const TRACKER_SEGMENT = String.raw`(?:<tracker>|\$\{TRACKER\}|\$TRACKER|linear|jira)`;
    expect(
      names.filter((n) => !new RegExp(TRACKER_SEGMENT).test(n)),
    ).toEqual([]);
  });
});
