// M116 STE-418 — the WIRING half of headless `/spec-write` drivability.
//
// WHY THIS FILE EXISTS (separate from `m116-ste-418-headless-spec-write.test.ts`).
// The prior round shipped `adapters/_shared/src/auto_answers.ts` and its unit
// suite went green — but the module is referenced by NOTHING outside its own
// test. `/spec-write` is an LLM-runtime skill driven by SKILL.md prose, so a
// green unit test over an unreferenced module does not make a runtime behavior
// true. Worse, three shipped prose surfaces affirmatively contradict its
// premise. This file pins the WIRING: the consumer (`/spec-write` SKILL.md),
// the contract doc (`docs/auto-mode-protocol.md`), and the producer
// (`.claude/skills/smoke-test/SKILL.md`).
//
// ===========================================================================
// THE CONTRACT FRAMING — load-bearing; every assertion below depends on it.
// ===========================================================================
//
// We are NOT weakening the Socratic Loop Contract, and the marker does NOT
// relax loop entry. `requireOrRefuse` (`adapters/_shared/src/requires_input.ts`)
// has always had four outcomes with precedence
//
//     user-supplied → pre-baked → default-applied → refused
//
// The sanctioned path uses the **pre-baked** slot, which is a legitimate answer
// SOURCE, not a gate relaxation. Consequences, all pinned here:
//
//   * `docs/auto-mode-protocol.md`'s "The marker relaxes approval gates; it
//     does not relax loop entry" stays LITERALLY TRUE and must survive. It
//     gains an ADDITIVE clause: an operator-authored, byte-fenced answer block
//     admitted only under the marker supplies pre-baked answers — the
//     interview is ANSWERED, not skipped.
//   * `skills/spec-write/SKILL.md`'s "the Socratic loop entry is unconditional"
//     and its "regardless of ... the auto-approve marker" mandate stay TRUE for
//     callers with no answer block.
//   * The distinction the prose must draw, and which the tests below pin: the
//     marker ALONE still never answers a clarifying question; only an explicit
//     answer block does, and only when the marker is also present.
//
// A test that would pass if someone wrote "the marker lets you skip the
// interview" is a BAD test here. The tripwire describes below exist to make
// that shape fail.
//
// AC coverage: AC-STE-418.1 (the wiring half — the sanctioned path must be
// REACHABLE from the prose the runtime actually reads, and the driver must
// actually emit a block the shipped parser accepts).
//
// HARD BUDGET CONSTRAINTS this FR's edits ride against, re-pinned at the
// bottom of this file:
//   * `skills/spec-write/SKILL.md` sits at EXACTLY the 358-line cap ⇒ the
//     wiring must extend EXISTING lines in place, NET-ZERO LINES.
//   * the `skills/` tree sits at 246/246 STE-N tokens ⇒ new prose cites by
//     mechanism, never by ticket id (`M<N>` tokens are safe — not matched).
//   * `.claude/skills/smoke-test/SKILL.md` has NO line cap and NO token
//     ceiling; the producer-side edit is unconstrained.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  AUTO_ANSWERS_CLOSE,
  AUTO_ANSWERS_OPEN,
  extractAutoAnswers,
} from "../adapters/_shared/src/auto_answers";
import { runAutoApproveMarkerProbe } from "../adapters/_shared/src/auto_approve_marker";
import { findRequiresInputDeclarationLine } from "../adapters/_shared/src/requires_input_sentinel_coverage";
import {
  FORBIDDEN_PHRASES,
  runSpecWriteAlternateTriggerScanProbe,
} from "../adapters/_shared/src/spec_write_alternate_trigger_scan";
import {
  FORBIDDEN_FIRST_TURN_DRIFT_PHRASES,
  runSpecWriteFirstTurnDriftScanProbe,
} from "../adapters/_shared/src/spec_write_first_turn_drift_scan";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");

const specWriteSkillPath = join(PLUGIN_ROOT, "skills", "spec-write", "SKILL.md");
const protocolPath = join(PLUGIN_ROOT, "docs", "auto-mode-protocol.md");
// Repo-root-relative: a sweep scoped to PLUGIN_ROOT cannot see `.claude/skills/`.
const smokeSkillPath = join(
  REPO_ROOT,
  ".claude",
  "skills",
  "smoke-test",
  "SKILL.md",
);

/** The sanctioned answer-source module, as a runtime-actionable path literal. */
const AUTO_ANSWERS_MODULE = "adapters/_shared/src/auto_answers.ts";
/** The one byte-string that unlocks the block. Never re-typed by the SKILL. */
const AUTO_APPROVE_MARKER = "<dpt:auto-approve>v1</dpt:auto-approve>";

const read = (path: string): string => readFileSync(path, "utf-8");
/** Collapse hard wraps so a pinned sentence survives a cosmetic re-flow. */
const norm = (s: string): string => s.replace(/\s+/g, " ").trim();

/** Blank-line-delimited paragraphs of `body` that mention `needle`. */
function paragraphsWith(body: string, needle: string): string[] {
  return body.split(/\n\s*\n/).filter((p) => p.includes(needle));
}

// ---------------------------------------------------------------------------
// AC-STE-418.1 (wiring) — `/spec-write` SKILL.md reaches the answer source
// ---------------------------------------------------------------------------
//
// Shape precedent: `check_marker_runtime.ts` is wired into this same SKILL at
// § 0b step 4 (and § 7a) as a literal invocation plus a branch table. The
// answer-source wiring must be equally runtime-actionable — a module path the
// LLM can open, a delimiter it can byte-match, and both branch directions.

describe("AC-STE-418.1 — /spec-write SKILL.md names the sanctioned answer source", () => {
  const skill = (): string => read(specWriteSkillPath);

  test("the SKILL names the answer-source module by path", () => {
    // Without a path the module is unreachable prose — exactly the defect the
    // spec-review audit found: shipped, green, and referenced by nothing.
    expect(skill()).toContain(AUTO_ANSWERS_MODULE);
  });

  test("the SKILL names the resolver a gate site actually calls", () => {
    expect(skill()).toContain("resolveInterviewAnswer");
  });

  test("the SKILL byte-pins the block's opening delimiter", () => {
    expect(skill()).toContain(AUTO_ANSWERS_OPEN);
  });

  test("the SKILL names the `requireOrRefuse` slot the answer lands in", () => {
    const body = skill();
    expect(body).toContain("requireOrRefuse");
    expect(body).toContain("preBakedValue");
  });

  test("module path, resolver and delimiter are co-located on ONE line", () => {
    // Three literals scattered across a 358-line file is not a call site. The
    // net-zero-lines constraint forces the wiring onto an existing long line
    // anyway, so co-location costs nothing.
    const hits = skill()
      .split("\n")
      .filter(
        (l) =>
          l.includes(AUTO_ANSWERS_MODULE) &&
          l.includes("resolveInterviewAnswer") &&
          l.includes(AUTO_ANSWERS_OPEN),
      );
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });
});

describe("AC-STE-418.1 — the wiring prose states BOTH branch directions", () => {
  /** Every paragraph mentioning the module, joined — the wiring region. */
  const wiring = (): string => {
    const paras = paragraphsWith(read(specWriteSkillPath), AUTO_ANSWERS_MODULE);
    expect(paras.length).toBeGreaterThanOrEqual(1);
    return paras.join("\n\n");
  };

  test("HIT branch: a resolved answer routes through the pre-baked outcome", () => {
    const p = wiring();
    expect(p).toContain("preBakedValue");
    expect(p).toContain("pre-baked");
  });

  test("MISS branch: an unresolved key returns `undefined` and the refusal stands", () => {
    // The dangerous drift is prose that only documents the happy path — the
    // LLM then invents a fallback instead of letting the refusal fire.
    const p = wiring();
    expect(p).toContain("undefined");
    expect(p).toMatch(/refus/i);
  });

  test("the marker is stated as a hard PRECONDITION, and an unmarked block is inert", () => {
    const p = wiring();
    expect(p).toMatch(/\binert\b/i);
    expect(p).toContain("marker");
  });

  test("the wiring adds no STE-N token (the skills/ ceiling has zero headroom)", () => {
    const p = wiring();
    expect(p).not.toMatch(/\bAC-STE-\d+/);
    expect(p).not.toMatch(/\bSTE-\d+/);
  });
});

describe("AC-STE-418.1 — the marker ALONE never answers a clarifying question", () => {
  test("the SKILL draws the marker-alone / answer-block distinction explicitly", () => {
    // This is the sentence that keeps the fix from reading as "the marker now
    // unlocks the interview". Marker alone ⇒ still refused; marker + explicit
    // operator-authored block ⇒ answered.
    const sentences = read(specWriteSkillPath)
      .split(/(?<=[.!?])\s+/)
      .filter((s) => /marker alone/i.test(s));
    expect(sentences.length).toBeGreaterThanOrEqual(1);
    const qualifying = sentences.filter(
      (s) =>
        /clarifying question/i.test(s) &&
        /never answers|does not answer|is not an answer|no answer/i.test(s),
    );
    expect(qualifying.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// NEGATIVE / NON-VACUITY — the Socratic Loop Contract is NOT weakened
// ---------------------------------------------------------------------------

describe("AC-STE-418.1 — the unconditional-loop-entry contract survives verbatim", () => {
  const skill = (): string => read(specWriteSkillPath);

  test("the `Socratic loop entry is unconditional` clause survives", () => {
    const body = norm(skill());
    expect(body).toContain(
      "clarifying questions have no safe default, so the Socratic loop entry is unconditional",
    );
  });

  test("the `regardless of ... the auto-approve marker` mandate survives", () => {
    expect(norm(skill())).toContain(
      "regardless of the autonomous-mode reminder, the auto-approve marker, or pre-baked",
    );
  });

  test("the first-turn contract (AskUserQuestion OR RequiresInputRefusedError) survives", () => {
    const body = norm(skill());
    expect(body).toContain(
      "the first tool call this skill emits MUST be `AskUserQuestion` `tool_use` OR `RequiresInputRefusedError` raise",
    );
    expect(body).toContain(
      "The first tool call under non-tty MUST be `AskUserQuestion` or `RequiresInputRefusedError`; everything else is forbidden — there is no carve-out",
    );
  });

  test("TRIPWIRE: no positive claim that the marker relaxes loop entry or skips the interview", () => {
    // A test that passes when someone writes "the marker lets you skip the
    // interview" is a bad test. These are the shapes that must stay absent.
    const body = skill();
    expect(body).not.toMatch(/the marker relaxes loop entry/i);
    expect(body).not.toMatch(/the marker relaxes the Socratic loop/i);
    expect(body).not.toMatch(/skip the Socratic interview/i);
    expect(body).not.toMatch(/the Socratic loop is optional/i);
    expect(body).not.toMatch(/the interview may be skipped/i);
    expect(body).not.toMatch(/marker[^.\n]{0,60}licenses skipping/i);
  });

  test("m115 invariant holds: exactly ONE paragraph carries the milestone-allocation guard", () => {
    // `tests/m115-ste-417-docs-pins.test.ts` asserts this too. Re-pinned here
    // because the net-zero-lines edit lands in this same file and a paragraph
    // split is the cheapest accidental way to break it.
    const hits = paragraphsWith(
      read(specWriteSkillPath),
      "**Milestone-number allocation guard.**",
    );
    expect(hits.length).toBe(1);
  });
});

describe("AC-STE-418.1 — probe #47 (first-turn drift) stays clean on the real repo", () => {
  test("none of the six forbidden first-turn-drift phrases appear in the SKILL", () => {
    const body = read(specWriteSkillPath);
    for (const phrase of FORBIDDEN_FIRST_TURN_DRIFT_PHRASES) {
      expect(body).not.toContain(phrase);
    }
  });

  test("the probe list is non-empty (a shrunk list would make the pin vacuous)", () => {
    expect(FORBIDDEN_FIRST_TURN_DRIFT_PHRASES.length).toBe(6);
  });

  test("the probe returns ZERO violations over the real repo", async () => {
    const report = await runSpecWriteFirstTurnDriftScanProbe(REPO_ROOT);
    expect(report.violations).toEqual([]);
  });
});

describe("AC-STE-418.1 — probe #48 (marker alternate-trigger) stays clean on the real repo", () => {
  test("the probe list is non-empty (a shrunk list would make the pin vacuous)", () => {
    expect(FORBIDDEN_PHRASES.length).toBe(8);
  });

  test("NON-VACUITY: forbidden phrases DO appear in the SKILL, inside negation carve-outs", () => {
    // The zero-violation assertion below is only meaningful if the scanner is
    // reading real content whose carve-outs are load-bearing. These three raw
    // substrings are present today; the probe stays quiet solely because each
    // occurrence sits on a line carrying a negation signature. Drift into
    // POSITIVE alternate-trigger prose therefore still fires.
    const body = read(specWriteSkillPath);
    expect(body).toContain("autonomous-mode reminder");
    expect(body).toContain("standing instruction");
    expect(body).toContain("work without stopping");
  });

  test("the probe returns ZERO violations over the real repo", async () => {
    const report = await runSpecWriteAlternateTriggerScanProbe(REPO_ROOT);
    expect(report.violations).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-418.1 (wiring) — docs/auto-mode-protocol.md documents the block
// ---------------------------------------------------------------------------

describe("AC-STE-418.1 — the protocol doc's safety clause SURVIVES", () => {
  const doc = (): string => read(protocolPath);

  test("`The marker relaxes approval gates; it does not relax loop entry.` survives", () => {
    // THE guard against someone "fixing" the apparent contradiction by
    // deleting the safety clause. Pinned whitespace-normalized so a cosmetic
    // re-wrap of the hard-wrapped bullet does not fail the test, and raw so a
    // partial rewrite of the second half is still caught.
    expect(norm(doc())).toContain(
      "The marker relaxes approval gates; it does not relax loop entry.",
    );
    expect(doc()).toContain("it does not relax loop entry.");
  });

  test("§ (a)'s `does not relax the Socratic loop` clause survives", () => {
    expect(norm(doc())).toContain(
      "The marker only relaxes gates that have a documented safe default; it does not relax the Socratic loop, because clarifying questions have no \"safe default\"",
    );
  });

  test("the `Marker presence is informational` disclaimer survives", () => {
    expect(doc()).toContain(
      "**Marker presence is informational for `requires-input:` steps.**",
    );
    expect(norm(doc())).toContain(
      "`requires-input:` steps have no safe default and cannot be default-applied.",
    );
  });

  test("no FOURTH answer source is invented — the block files under pre-baked", () => {
    // The three-source list is the contract. An answers block is a new
    // TRANSPORT for source #2, not a fourth source.
    expect(doc()).toContain(
      "Three (and only three) sources count as a real answer for a gated step:",
    );
    expect(norm(doc())).toContain("**Pre-baked** — supplied via a documented");
  });

  test("TRIPWIRE: no positive claim that the marker relaxes loop entry", () => {
    const body = doc();
    expect(body).not.toMatch(/the marker relaxes loop entry/i);
    expect(body).not.toMatch(/the marker relaxes the Socratic loop/i);
    expect(body).not.toMatch(/the marker now relaxes/i);
    expect(body).not.toMatch(/the Socratic loop is optional/i);
  });
});

describe("AC-STE-418.1 — the protocol doc documents the sanctioned answers block", () => {
  const doc = (): string => read(protocolPath);
  /** Every paragraph mentioning the open delimiter, joined. */
  const prose = (): string => {
    const paras = paragraphsWith(doc(), AUTO_ANSWERS_OPEN);
    expect(paras.length).toBeGreaterThanOrEqual(1);
    return paras.join("\n\n");
  };

  test("both delimiters are byte-pinned in the doc", () => {
    const body = doc();
    expect(body).toContain(AUTO_ANSWERS_OPEN);
    expect(body).toContain(AUTO_ANSWERS_CLOSE);
  });

  test("the doc names the module that implements the block", () => {
    expect(doc()).toContain(AUTO_ANSWERS_MODULE);
  });

  test("the marker is documented as a hard PRECONDITION of the block", () => {
    const p = prose();
    expect(p).toMatch(/precondition/i);
    expect(p).toContain(AUTO_APPROVE_MARKER);
  });

  test("malformed blocks are documented as failing CLOSED", () => {
    const p = prose();
    expect(p).toMatch(/malformed/i);
    expect(p).toMatch(/fails? closed|fail-closed/i);
  });

  test("unmarked prose is documented as NEVER an answer source", () => {
    // The STE-404 fence, restated: the block is not a loophole for the
    // pre-baked `<command-args>` prose that the fence already rejects.
    expect(prose()).toMatch(/never an answer source/i);
  });

  test("the block is filed under the pre-baked slot, not default-applied", () => {
    const p = prose();
    expect(p).toContain("pre-baked");
    expect(p).toContain("requireOrRefuse");
  });

  test("the block prose does not smuggle in a `requires-input:` gate DECLARATION", () => {
    // The doc carries an explicit HTML-comment warning: a line-leading
    // `requires-input:` occurrence, or an inline-code span carrying the token
    // plus a reason, DECLARES a gate under the recognizer this very document
    // describes — which would scope any skill that copies the prose. New
    // paragraphs must keep every mention mid-sentence and reason-free.
    expect(findRequiresInputDeclarationLine(doc())).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC-STE-418.1 (wiring) — the PRODUCER side: the smoke driver emits a block
// ---------------------------------------------------------------------------

const smokeSkill = existsSync(smokeSkillPath) ? read(smokeSkillPath) : null;
const describeIfSmokePresent = smokeSkill === null ? describe.skip : describe;

/**
 * The heredoc body of the `claude -p` spawn whose stdout redirects to
 * `logToken`. Returns the text strictly between the `<<'PROMPT_EOF'` line and
 * the closing `PROMPT_EOF` line, so the first line is the child's first
 * prompt-body line.
 */
function heredocBody(logToken: string): string {
  const body = smokeSkill!;
  const at = body.indexOf(logToken);
  expect(at).toBeGreaterThanOrEqual(0);
  const open = body.indexOf("<<'PROMPT_EOF'", at);
  expect(open).toBeGreaterThanOrEqual(0);
  const start = body.indexOf("\n", open) + 1;
  const close = body.indexOf("\nPROMPT_EOF", start);
  expect(close).toBeGreaterThan(start);
  return body.slice(start, close);
}

describeIfSmokePresent(
  "AC-STE-418.1 — the /spec-write child heredoc emits a sanctioned answers block",
  () => {
    const specWriteHeredoc = (): string =>
      heredocBody("/tmp/dpt-smoke-<tracker>-spec-write.log");

    test("the marker is still the FIRST body line (STE-226 spawn contract)", () => {
      const lines = specWriteHeredoc().split("\n");
      expect(lines[0]).toBe(AUTO_APPROVE_MARKER);
    });

    test("the slash command is still the line after the marker", () => {
      const lines = specWriteHeredoc().split("\n");
      expect(lines[1]).toBe("/dev-process-toolkit:spec-write");
    });

    test("the feature stub the chain depends on is unchanged", () => {
      expect(specWriteHeredoc()).toContain("greet(name?: string)");
      expect(specWriteHeredoc()).toContain("src/greet.ts");
    });

    test("the heredoc carries a delimited answers block", () => {
      const h = specWriteHeredoc();
      expect(h).toContain(AUTO_ANSWERS_OPEN);
      expect(h).toContain(AUTO_ANSWERS_CLOSE);
    });

    test("the block opens AFTER the marker and closes after it opens", () => {
      const h = specWriteHeredoc();
      const marker = h.indexOf(AUTO_APPROVE_MARKER);
      const open = h.indexOf(AUTO_ANSWERS_OPEN);
      const close = h.indexOf(AUTO_ANSWERS_CLOSE, open + AUTO_ANSWERS_OPEN.length);
      expect(marker).toBeGreaterThanOrEqual(0);
      expect(open).toBeGreaterThan(marker);
      expect(close).toBeGreaterThan(open);
    });

    test("END-TO-END: the SHIPPED parser accepts the SHIPPED driver text", () => {
      // The strongest available pin — it runs the real consumer over the real
      // producer. A block the driver emits but the parser rejects would leave
      // the chain truncated exactly where the 2026-07-27 run left it.
      const result = extractAutoAnswers(specWriteHeredoc());
      expect(result.present).toBe(true);
      expect(Object.keys(result.answers).length).toBeGreaterThan(0);
    });

    test("every answer the driver bakes in has a non-empty value", () => {
      // A `key:` with a blank value parses `present` but answers nothing —
      // the interview would resolve to empty strings and the FR would ship
      // hollow. Pin real content, not merely a well-formed shape.
      const { answers } = extractAutoAnswers(specWriteHeredoc());
      // Re-asserted so the per-entry loop below can never pass vacuously on an
      // empty answer set.
      const entries = Object.entries(answers);
      expect(entries.length).toBeGreaterThan(0);
      for (const [key, value] of entries) {
        expect(typeof value).toBe("string");
        expect(value.trim().length, `answer for ${key} is empty`).toBeGreaterThan(0);
      }
    });

    test("the driver documents the block, not just emits it", () => {
      // One occurrence is the heredoc; a second is the contract paragraph or
      // the spawn comment explaining why the block is there and what unlocks
      // it. An undocumented magic block is the next operator's trap.
      const occurrences =
        smokeSkill!.split(AUTO_ANSWERS_OPEN).length - 1;
      expect(occurrences).toBeGreaterThanOrEqual(2);
    });
  },
);

describeIfSmokePresent(
  "AC-STE-418.1 — the other canonical spawns are NOT regressed",
  () => {
    test("the /setup heredoc still leads with the marker", () => {
      const lines = heredocBody("/tmp/dpt-smoke-<tracker>-setup.log").split("\n");
      expect(lines[0]).toBe(AUTO_APPROVE_MARKER);
    });

    test("the /implement heredoc still leads with the marker", () => {
      const lines = heredocBody("/tmp/dpt-smoke-<tracker>-implement.log").split(
        "\n",
      );
      expect(lines[0]).toBe(AUTO_APPROVE_MARKER);
    });

    test("probe `auto_approve_marker_in_canonical_spawns` stays clean over the repo", async () => {
      const report = await runAutoApproveMarkerProbe(REPO_ROOT);
      expect(report.violations).toEqual([]);
    });
  },
);

// ---------------------------------------------------------------------------
// ROUND-1 REVIEW FIX — the FR-CONTENT interview has no wired consumer
// ---------------------------------------------------------------------------
//
// THE GAP. Everything above pins the block at exactly ONE gate: `/spec-write`'s
// milestone-allocation gate (§ 0b / § 7a). But AC-STE-418.1 asks for more than
// an allocated milestone — a marked non-tty `/spec-write` must "complete the
// new-FR creation flow and return an allocated tracker id", and between the
// milestone gate and a written FR stand the § 1–§ 6 Socratic prompts that
// gather Summary, Requirement, Acceptance Criteria, Technical Design, Testing,
// cross-cutting scope, out-of-scope and NFRs. Those have NO wired consumer.
//
// The smoke driver already bakes TWELVE answer keys into its `/spec-write`
// heredoc; exactly one — `milestone` — reaches a documented, wired consumer.
// The other eleven rest on the model JUDGING that a sufficiently verbose prompt
// needs no further asks. Under `claude -p` with `AskUserQuestion` unregistered,
// one unanswered content question is still a refusal and the chain still
// truncates exactly where the 2026-07-27 run left it. `/setup` shows the shape
// that works: its Consumers entry names all eight `requires-input:` keys, and
// `tests/m116-ste-419-setup-first-turn.test.ts` exercises all eight.
//
// THE DEFECT CLASS IS PRODUCER/CONSUMER DRIFT, so the pin below is DERIVED, not
// transcribed: the key list is parsed out of the shipped driver heredoc at test
// time (through the shipped parser) and every parsed key must have a named
// consumer in the doc. Transcribing twelve literals here would let the two
// drift apart again the moment the driver grows a thirteenth.
//
// FRAMING, UNCHANGED. The block supplies a PRE-BAKED ANSWER via
// `requireOrRefuse`'s `preBakedValue` slot. The question is ANSWERED, never
// SKIPPED. `skills/spec-write/SKILL.md`'s "the Socratic loop entry is
// unconditional" and its § Rules "regardless of ... the auto-approve marker"
// mandate must both survive verbatim — the tripwires above assert exactly that
// and stay green. Broadening the answer SOURCE to § 1–§ 6 does not touch the
// prohibition on bare-prose asks or on skipping the loop.

/** `§ 1–§ 6` tolerant of dash flavour and a dropped second `§`. */
const SECTION_SPAN_RE = /§\s*1\s*[–—-]\s*(?:§\s*)?6/;

/**
 * The `- \`/<skill>\`` bullet under `## Sanctioned Answers Block`'s
 * `**Consumers.**` intro, sliced to the next top-level bullet or heading.
 * Scoping matters: the doc names `§ 1–§ 6` elsewhere (the § (c) scope table),
 * so an unscoped substring search would pass without the entry changing at all.
 */
function consumerEntry(doc: string, skill: string): string {
  const at = doc.indexOf("**Consumers.**");
  expect(at, "the doc lost its `**Consumers.**` intro").toBeGreaterThanOrEqual(
    0,
  );
  const region = doc.slice(at);
  const start = region.indexOf(`- \`${skill}\``);
  expect(
    start,
    `the Consumers list lost its \`${skill}\` entry`,
  ).toBeGreaterThanOrEqual(0);
  const rest = region.slice(start + 2); // step past the leading "- "
  const stop = rest.search(/\n(?:- |## )/);
  return rest.slice(0, stop === -1 ? rest.length : stop);
}

describe("AC-STE-418.1 — the SKILL scopes the answer source to the § 1–§ 6 content interview", () => {
  /** Every paragraph mentioning the module, joined — the wiring region. */
  const wiring = (): string => {
    const paras = paragraphsWith(read(specWriteSkillPath), AUTO_ANSWERS_MODULE);
    expect(paras.length).toBeGreaterThanOrEqual(1);
    return paras.join("\n\n");
  };

  test("the wiring region names the § 1–§ 6 interview, not only the milestone gate", () => {
    // § Rules already names `§ 1–§ 6` — but in a paragraph that never mentions
    // the module, so the AskUserQuestion mandate and the answer SOURCE are
    // documented on opposite ends of the file with nothing joining them. This
    // assertion is scoped to the wiring region precisely so that pre-existing
    // mention cannot satisfy it.
    expect(wiring()).toMatch(SECTION_SPAN_RE);
  });

  test("the § 1–§ 6 mention sits WITH the answer-source machinery, not adrift", () => {
    // A bare section reference dropped anywhere in the long § 0b paragraph
    // would satisfy the regex while wiring nothing. Require the resolver, the
    // delimiter, or the slot within reading distance of the reference.
    const p = wiring();
    const m = SECTION_SPAN_RE.exec(p);
    expect(m).not.toBeNull();
    const i = m!.index;
    const window = p.slice(Math.max(0, i - 400), i + 400);
    const named =
      window.includes("resolveInterviewAnswer") ||
      window.includes(AUTO_ANSWERS_OPEN) ||
      window.includes("preBakedValue");
    expect(
      named,
      "`§ 1–§ 6` appears but not near the resolver / delimiter / pre-baked slot",
    ).toBe(true);
  });

  test("the milestone-allocation wiring is BROADENED, not replaced", () => {
    // The regression to fear is a "fix" that re-points the one wired consumer
    // at the content interview and leaves the milestone gate unwired.
    const p = wiring();
    expect(p).toContain("requireOrRefuse");
    expect(p).toContain("preBakedValue");
    expect(p).toMatch(/milestone/i);
  });

  test("the broadening adds no STE-N token (the skills/ ceiling has zero headroom)", () => {
    const p = wiring();
    expect(p).not.toMatch(/\bAC-STE-\d+/);
    expect(p).not.toMatch(/\bSTE-\d+/);
  });

  test("TRIPWIRE: broadening the SOURCE does not become a licence to skip the ask", () => {
    // The bad fix writes "under the marker, § 1–§ 6 need not be asked". The
    // correct one writes "§ 1–§ 6 questions are ASKED and answered from the
    // block". These shapes must stay absent from the wiring region.
    const p = wiring();
    expect(p).not.toMatch(/need not be asked/i);
    expect(p).not.toMatch(/without asking/i);
    expect(p).not.toMatch(/no need to ask/i);
    expect(p).not.toMatch(/(?:may|can|lets you|licenses)\s+(?:be\s+)?skip/i);
    // …and the positive framing must be present, not merely the negatives.
    expect(p).toMatch(/answered/i);
  });
});

describe("AC-STE-418.1 — the doc's /spec-write Consumers entry enumerates its interview keys", () => {
  const entry = (): string => consumerEntry(read(protocolPath), "/spec-write");

  test("the extractor is non-vacuous — it returns one entry, not the whole doc", () => {
    // If this slice silently returned the document, every assertion below
    // would pass for the wrong reason.
    const e = entry();
    expect(e.length).toBeGreaterThan(40);
    expect(e).not.toContain("- `/setup`");
    expect(e).not.toContain("## Socratic Loop Contract");
  });

  test("the entry still names the milestone-allocation gate (nothing is lost)", () => {
    expect(entry()).toContain("milestone-allocation");
  });

  test("the entry names the § 1–§ 6 content interview as a consumption site", () => {
    expect(entry()).toMatch(SECTION_SPAN_RE);
  });

  test("the entry names the same call shape the /setup entry already uses", () => {
    const e = entry();
    expect(e).toContain("resolveInterviewAnswer(promptBody, key)");
    expect(e).toContain("preBakedValue");
    expect(e).toContain(AUTO_ANSWERS_MODULE);
  });

  test("the entry states the MISS branch — an omitted key refuses, it is not invented", () => {
    expect(entry()).toMatch(/refus/i);
  });

  test("TRIPWIRE: the entry does not license skipping the interview", () => {
    const e = entry();
    expect(e).not.toMatch(/(?:may|can|lets you|licenses)\s+(?:be\s+)?skip/i);
    expect(e).not.toMatch(/the interview is optional/i);
    expect(e).not.toMatch(/need not be asked/i);
  });

  test("the new prose smuggles in no `requires-input:` gate DECLARATION", () => {
    // Re-pinned here because the enumeration lands in this very file and a
    // hard wrap is enough to turn a mention into a declaration.
    expect(findRequiresInputDeclarationLine(read(protocolPath))).toBeNull();
  });
});

describeIfSmokePresent(
  "AC-STE-418.1 — every key the driver bakes in has a named consumer in the doc",
  () => {
    /** Parsed from the SHIPPED driver text through the SHIPPED parser. */
    const heredocKeys = (): string[] =>
      Object.keys(
        extractAutoAnswers(
          heredocBody("/tmp/dpt-smoke-<tracker>-spec-write.log"),
        ).answers,
      );

    test("the driver's key set parses, and carries the FR-content keys", () => {
      // Floor guard: if the heredoc parse ever regressed to a handful of keys,
      // the drift pin below would pass while checking almost nothing.
      const keys = heredocKeys();
      expect(keys.length).toBeGreaterThanOrEqual(10);
      for (const k of [
        "feature_summary",
        "acceptance_criteria",
        "technical_design",
        "testing",
        "risks",
      ]) {
        expect(keys, `the driver dropped the \`${k}\` answer`).toContain(k);
      }
    });

    test("DRIFT PIN: every parsed driver key is named in the /spec-write entry", () => {
      // Derived, not transcribed — add a key to the heredoc without documenting
      // a consumer and this fails, which is the actual defect class here.
      // Backticked match, matching the /setup entry's house style, so a key
      // cannot pass by being a substring of ordinary prose (`milestone` inside
      // "milestone-allocation", `testing` inside "testing spec", …).
      const e = consumerEntry(read(protocolPath), "/spec-write");
      for (const key of heredocKeys()) {
        expect(
          e,
          `the driver bakes \`${key}\` but the doc names no consumer for it`,
        ).toContain(`\`${key}\``);
      }
    });

    test("NON-VACUITY: keys the driver does NOT bake in are ABSENT from the entry", () => {
      // Guards against the lazy fix — pasting every conceivable key into the
      // entry so the drift pin above goes green. The decoys are deliberately
      // REAL interview keys of the sibling consumer, so they are exactly what a
      // copy-paste would drag in.
      const doc = read(protocolPath);
      const e = consumerEntry(doc, "/spec-write");
      const setup = consumerEntry(doc, "/setup");
      const baked = new Set(heredocKeys());
      const decoys = [
        "stack",
        "tracker_mode",
        "branch_template",
        "packages_mode",
        "token_stats_enabled",
        "create_specs",
      ];
      for (const d of decoys) {
        expect(
          baked.has(d),
          `\`${d}\` is no longer a decoy — the driver now bakes it in`,
        ).toBe(false);
        expect(
          setup,
          `\`${d}\` should be a documented /setup interview key`,
        ).toContain(`\`${d}\``);
        expect(
          e,
          `the /spec-write entry claims \`${d}\`, which /spec-write never asks`,
        ).not.toContain(`\`${d}\``);
      }
    });
  },
);

// ---------------------------------------------------------------------------
// BUDGET PINS — the two zero-headroom caps this edit must not breach
// ---------------------------------------------------------------------------

describe("AC-STE-418.1 — the wiring edit is net-zero-lines and token-free", () => {
  const SKILL_LINE_CAP = 358;
  const SKILLS_STE_TOKEN_CEILING = 246;

  test(`skills/spec-write/SKILL.md stays within the NFR-1 line cap (${SKILL_LINE_CAP})`, () => {
    // The file sits AT the cap with zero headroom. The wiring must extend
    // existing long lines in place — a single added line breaches this.
    const lines = read(specWriteSkillPath).split("\n").length;
    expect(lines).toBeLessThanOrEqual(SKILL_LINE_CAP);
  });

  test(`the skills/ STE-token ceiling (${SKILLS_STE_TOKEN_CEILING}) is not breached`, () => {
    // The ceiling is AT the pin, with zero headroom. New SKILL prose must cite
    // its mechanism (`auto_answers.ts`, `<dpt:answers>v1`), never a ticket id.
    // `M<N>` tokens are safe — the regex does not match them.
    let count = 0;
    const walk = (d: string): void => {
      for (const name of readdirSync(d)) {
        const p = join(d, name);
        if (statSync(p).isDirectory()) {
          walk(p);
          continue;
        }
        if (!name.endsWith(".md")) continue;
        count += (
          readFileSync(p, "utf-8").match(/\b(STE|AC-STE)-\d+(?:\.\d+)?\b/g) ?? []
        ).length;
      }
    };
    walk(join(PLUGIN_ROOT, "skills"));
    expect(count).toBeLessThanOrEqual(SKILLS_STE_TOKEN_CEILING);
  });
});
