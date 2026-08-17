// M127 STE-484 — fixture group 7's `tdd-result` count must read forked-child
// `tool_result` content.
//
// THE DEFECT, in three measured facts (2026-08-16 conformance captures, all
// three legs; re-measured 2026-08-17 against the shipped reduced slices under
// `tests/fixtures/m127-falsifiability/`):
//
//   1. The live assertion is a LINE-ANCHORED grep — ``grep -c '^```tdd-result$'``
//      — against `/tmp/dpt-smoke-<tracker>-implement.log`. STE-352 made
//      `--output-format stream-json --verbose` mandatory, so that capture is
//      NDJSON: every newline inside the payload is the two characters `\` `n`
//      inside a JSON string. There are no line starts to anchor to, so the
//      count is 0 on EVERY run, healthy or dead. Vacuous in the failing
//      direction.
//
//   2. The documented repair is ALSO wrong, and that is the part worth pinning
//      hardest. The SKILL's capture-reading prose (§ Phase 2, the `-implement`
//      capture bullet) names `extractAssistantText` as the way to lift "forked
//      `tdd-result` fences". `extractAssistantText` keeps only `assistant`
//      events' text blocks — `user` events and `tool_result` blocks are
//      excluded BY DESIGN (STE-421) — and the /tdd orchestrator's children run
//      `context: fork`, so their hand-off blocks arrive precisely in the
//      excluded events. Routing through it scores 0 as well. AC.5 exists so a
//      third round of this same mistake is impossible.
//
//   3. The bare UNANCHORED fallback (``grep -c '```tdd-result'`` on the raw
//      NDJSON) is vacuous in the OTHER direction: `claude -p` injects the
//      invoked skill's SKILL.md body as a synthetic `user` event, that body
//      spells the fence tag, and the raw bytes additionally carry each
//      tool_result MIRRORED under the event's `tool_use_result` key. On the
//      shipped linear slice the raw count is 18 where the real fork hand-offs
//      number 8. Strip every fork event and the unanchored form STILL returns
//      a non-zero count off the injected prompt alone.
//
// WHAT THE REPAIR MUST BE. A projection that counts fences in NON-SYNTHETIC
// `user` events' `tool_result` content, and nothing else — not the synthetic
// SKILL body (AC.3), not the `tool_use_result` mirror (which would double every
// hand-off). Measured against the shipped slices that projection yields
// linear 8 / jira 6 / none 6, and the group-7 threshold of ≥ 3 clears on all
// three.
//
// ON AC.1's PARENTHETICAL "(linear 8, jira 6+1 and 5+1, none 12)". The binding
// requirement is NON-ZERO on each leg. The parenthetical's jira/none figures
// come from a differently-scoped tally in the FR author's run; the captures
// actually under test here — the shipped reduced slices, whose subject
// occurrence counts are byte-exact against the originals — produce
// linear 8 / jira 6 / none 6. Those are the numbers pinned below, alongside the
// non-zero claim that is the AC's actual requirement.
//
// THE NONE LEG IS THE TRAP. Its six fence-carrying tool_results contain ZERO
// occurrences of the `(forked execution)` banner that the linear and jira legs
// carry. An implementation keyed on that banner would score none = 0 and still
// look healthy on two legs out of three, so it is pinned explicitly.
//
// AC.4 IS STRUCTURAL, NOT INCIDENTAL. STE-483 built the falsifiability harness
// but nothing yet chains extractAssertionShell → bindCapture → runAssertion.
// This FR registers the first `M127_REPAIRS` row AND closes that chain behind
// `checkRepairEntry(entry, skillBody)`, so the no-paraphrase rule binds at the
// call site: the bytes that get executed are the SKILL's own bytes, and a
// remembered copy cannot enter through a convenience argument.
//
// THE SHAPE THE IMPLEMENTER MUST BUILD:
//
//   adapters/_shared/src/fork_tdd_result_assert.ts — new module, mirroring the
//   `capability_row_assert.ts` runner idiom (library exports + a CLI shim):
//
//     FORK_TDD_RESULT_FENCE: string            the fence tag, "```tdd-result"
//     extractForkToolResultText(ndjson): string
//         `tool_result` content from NON-SYNTHETIC `user` events, joined
//         line-anchored so fences stay greppable. Synthetic events and the
//         `tool_use_result` mirror contribute nothing.
//     countForkTddResults(ndjson): number      fence count in that projection
//     scoreForkTddResults(ndjson): { forkHits, syntheticHits, rawHits }
//         `forkHits` decides; the other two are diagnostics that let a failing
//         fixture quote the fork-vs-raw split (and are what prove the exclusion
//         actually happened rather than being assumed).
//
//     CLI: `bun fork_tdd_result_assert.ts <capture.log> <min>` prints the BARE
//     integer count on stdout — nothing else, so the harness's count parser
//     reads it — with diagnostics on stderr; exit 0 when count ≥ min, 1 when
//     below, 2 on usage error.
//
//   adapters/_shared/src/falsifiability_harness.ts — one new export:
//
//     checkRepairEntry(entry, skillBody): FalsifiabilityResult
//         extract the entry's site out of `skillBody`, bind it to that entry's
//         shipped capture, and score the present/absent pair. No `shell`
//         parameter — that would be the paraphrase the harness forbids.
//
//   .claude/skills/smoke-test/SKILL.md — group 7's live assertion becomes the
//   runner invocation, referenced through `${PLUGIN_DIR}` (the fence variable
//   the SKILL already declares) so it is executable off this repo without a
//   machine-specific absolute path baked into the span; both retired forms and
//   the reason each was wrong are recorded in the section; and the Phase 2
//   capture-reading bullet's `extractAssistantText` recommendation for
//   fork-emitted fences is corrected.
//
// `.claude/skills/smoke-test/SKILL.md` lives OUTSIDE `plugins/dev-process-toolkit`
// and therefore carries no line cap and no STE-N token ceiling; ticket ids may
// be cited freely there and here.

import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  bindCapture,
  capturePathFor,
  checkRepairEntry,
  extractAssertionShell,
  M127_REPAIRS,
  M127_REPAIR_ROSTER,
  runAssertion,
  SMOKE_SKILL_RELATIVE_PATH,
  uncoveredRepairs,
  type FalsifiabilityLeg,
  type RepairEntry,
} from "../adapters/_shared/src/falsifiability_harness";
import {
  countForkTddResults,
  extractForkToolResultText,
  FORK_TDD_RESULT_FENCE,
  scoreForkTddResults,
} from "../adapters/_shared/src/fork_tdd_result_assert";
import { extractAssistantText } from "../adapters/_shared/src/smoke_child_capture";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const SMOKE_SKILL = join(REPO_ROOT, SMOKE_SKILL_RELATIVE_PATH);
const SKILL_BODY = readFileSync(SMOKE_SKILL, "utf8");

// The SKILL's own fence declares `PLUGIN_DIR` before any runner invocation, and
// the smoke driver runs with it exported. The harness executes the extracted
// span through `bash -c` with this process's environment inherited, so the same
// variable has to be in scope here for the extract → bind → run chain to be
// runnable at all.
process.env.PLUGIN_DIR = PLUGIN_ROOT;

const LEGS: readonly FalsifiabilityLeg[] = ["linear", "jira", "none"];

/** The repaired projection's count, measured against the shipped slices. */
const FORK_COUNTS: Record<FalsifiabilityLeg, number> = { linear: 8, jira: 6, none: 6 };

/** Raw NDJSON occurrences: fork hand-offs + their `tool_use_result` mirror + the synthetic body. */
const RAW_OCCURRENCES: Record<FalsifiabilityLeg, number> = { linear: 18, jira: 14, none: 14 };

/** Occurrences inside the injected synthetic-`user` SKILL body alone. */
const SYNTHETIC_OCCURRENCES: Record<FalsifiabilityLeg, number> = { linear: 2, jira: 2, none: 2 };

/** Group 7's threshold, in the SKILL as "≥ 3" and on the registry row. */
const THRESHOLD = 3;

/**
 * A token that occurs ONLY inside the injected synthetic SKILL body on every
 * leg (measured: 2 raw occurrences per leg, 0 outside the synthetic event), so
 * its absence from the projection is direct evidence of the AC.3 exclusion.
 */
const SYNTHETIC_ONLY_TOKEN = "parseTddResultBlock";

const TMP = mkdtempSync(join(tmpdir(), "dpt-ste484-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

function rawCapture(leg: FalsifiabilityLeg): string {
  return readFileSync(capturePathFor(leg), "utf8");
}

function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

/**
 * The same capture with every fork-emitted event removed and NOTHING else
 * touched — the `init` event, the injected synthetic `user` body and the final
 * `result` event all survive. This is the absent-subject capture that separates
 * the two vacuous forms from the repaired one: the repaired projection must
 * score 0 on it, while the bare unanchored grep still scores off the injected
 * prompt.
 */
function withoutForkEvents(leg: FalsifiabilityLeg): string {
  const kept = rawCapture(leg)
    .split("\n")
    .filter((line) => line.trim() !== "")
    .filter((line) => {
      const event = JSON.parse(line) as { type?: string; isSynthetic?: boolean };
      return !(event.type === "user" && event.isSynthetic !== true);
    });
  return `${kept.join("\n")}\n`;
}

function tempCapture(name: string, body: string): string {
  const path = join(TMP, name);
  writeFileSync(path, body, "utf8");
  return path;
}

/** The group-7 section body, heading to next same-depth heading. */
function group7Section(): string {
  const start = SKILL_BODY.indexOf("#### Fixture group 7");
  expect(start).toBeGreaterThan(-1);
  const next = SKILL_BODY.indexOf("\n#### ", start + 1);
  return SKILL_BODY.slice(start, next === -1 ? SKILL_BODY.length : next);
}

/** The registry row this FR adds. */
function repairEntry(): RepairEntry {
  const entry = M127_REPAIRS.find((row) => row.id === "STE-484");
  expect(entry).toBeDefined();
  return entry as RepairEntry;
}

/** The SKILL's own bytes for group 7's live assertion. */
function liveShell(): string {
  return extractAssertionShell(SKILL_BODY, repairEntry().site).shell;
}

// ---------------------------------------------------------------------------
// AC-STE-484.1 — the count reads forked-child `tool_result` content and is
// non-zero on all three archived healthy captures.
// ---------------------------------------------------------------------------

describe("AC-STE-484.1 — non-zero on every archived healthy capture", () => {
  test("the projection counts fences on all three legs", () => {
    for (const leg of LEGS) {
      const count = countForkTddResults(rawCapture(leg));
      // The AC's binding claim: NON-ZERO on a healthy capture. The old form
      // returned 0 here, on every leg, forever.
      expect(count).toBeGreaterThan(0);
      // And it clears group 7's own threshold without needing a retry.
      expect(count).toBeGreaterThanOrEqual(THRESHOLD);
      // The exact measured figure for the capture actually under test.
      expect(count).toBe(FORK_COUNTS[leg]);
    }
  });

  test("the fence tag is the subject, and it is the tag the orchestrator emits", () => {
    expect(FORK_TDD_RESULT_FENCE).toBe("```tdd-result");
    for (const leg of LEGS) {
      expect(occurrences(rawCapture(leg), FORK_TDD_RESULT_FENCE)).toBe(RAW_OCCURRENCES[leg]);
    }
  });

  test("the counted text really is forked-child tool_result content", () => {
    const projected = extractForkToolResultText(rawCapture("linear"));
    // The linear leg's fork hand-offs arrive wrapped in the forked-skill
    // completion banner, so its presence proves the projection is reading
    // tool_result payloads rather than anything else in the transcript.
    expect(projected).toContain("(forked execution)");
    expect(projected).toContain("role: test-writer");
    expect(projected).toContain("role: refactorer");
    expect(occurrences(projected, FORK_TDD_RESULT_FENCE)).toBe(FORK_COUNTS.linear);
  });

  test("the tracker-less leg counts WITHOUT the forked-execution banner", () => {
    // The trap: `none` carries six fence-bearing tool_results and ZERO
    // `(forked execution)` banners. An implementation keyed on that banner
    // scores 0 here while still looking healthy on linear and jira.
    const raw = rawCapture("none");
    expect(raw).not.toContain("(forked execution)");
    expect(countForkTddResults(raw)).toBe(FORK_COUNTS.none);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-484.2 — both retired forms are gone from the live assertion, and the
// section records that the unanchored form was vacuous too.
// ---------------------------------------------------------------------------

describe("AC-STE-484.2 — both forms retired, both reasons recorded", () => {
  test("the live assertion is neither retired form", () => {
    const shell = liveShell();
    expect(shell).not.toContain("^```tdd-result$");
    expect(shell.trimStart().startsWith("grep")).toBe(false);

    // It routes through a real module under the plugin, reached via the
    // SKILL's own `${PLUGIN_DIR}` fence variable.
    expect(shell).toContain("${PLUGIN_DIR}");
    const module = /\$\{PLUGIN_DIR\}(\/[^\s"'`]+\.ts)/.exec(shell);
    expect(module).not.toBeNull();
    expect(existsSync(join(PLUGIN_ROOT, (module as RegExpExecArray)[1] as string))).toBe(true);
  });

  test("every surviving grep in group 7 is marked retired, never live", () => {
    const section = group7Section();
    const grepLines = section.split("\n").filter((line) => line.includes("grep -c"));
    // The retired forms must still be WRITTEN DOWN — that is the whole point
    // of AC.2 — but only ever as history.
    expect(grepLines.length).toBeGreaterThan(0);
    for (const line of grepLines) {
      expect(line).toMatch(/retired|vacuous|never|unconditionally/i);
    }
  });

  test("the section names both retired forms and why each was wrong", () => {
    const section = group7Section();
    // Form 1: line-anchored, against NDJSON.
    expect(section).toContain("^```tdd-result$");
    expect(section).toMatch(/line-anchored/i);
    expect(section).toMatch(/NDJSON|stream-json/);
    // Form 2: bare unanchored, matching the injected prompt.
    expect(section).toMatch(/unanchored/i);
    expect(section).toMatch(/synthetic/i);
    expect(section).toMatch(/SKILL(\.md)? body/i);
    expect(section).toContain("STE-484");
  });

  test("the unanchored form is measurably vacuous: it scores off the prompt alone", () => {
    for (const leg of LEGS) {
      const stripped = tempCapture(`no-forks-${leg}.ndjson`, withoutForkEvents(leg));
      const raw = readFileSync(stripped, "utf8");

      // Every fork hand-off is gone …
      expect(countForkTddResults(raw)).toBe(0);
      // … yet the bare unanchored grep still finds the tag, off the injected
      // synthetic SKILL body. That is what "also vacuous" means, measured.
      const unanchored = runAssertion(
        bindCapture("grep -c '```tdd-result' /tmp/dpt-smoke-<tracker>-implement.log", stripped),
      );
      expect(unanchored.count).toBeGreaterThan(0);
    }
  });

  test("the line-anchored form is measurably vacuous: 0 on a HEALTHY capture", () => {
    for (const leg of LEGS) {
      const anchored = runAssertion(
        bindCapture(
          "grep -c '^```tdd-result$' /tmp/dpt-smoke-<tracker>-implement.log",
          capturePathFor(leg),
        ),
      );
      expect(anchored.count).toBe(0);
      // While the repaired projection reads the same healthy capture as ≥ 3.
      expect(countForkTddResults(rawCapture(leg))).toBeGreaterThanOrEqual(THRESHOLD);
    }
  });
});

// ---------------------------------------------------------------------------
// AC-STE-484.3 — the injected synthetic-`user` SKILL body is excluded, so the
// number reflects the run and not the prompt.
// ---------------------------------------------------------------------------

describe("AC-STE-484.3 — the prompt does not contribute to the count", () => {
  test("a capture that is ONLY the injected prompt counts zero", () => {
    const body = [
      "role: test-writer",
      FORK_TDD_RESULT_FENCE,
      FORK_TDD_RESULT_FENCE,
      FORK_TDD_RESULT_FENCE,
      FORK_TDD_RESULT_FENCE,
      FORK_TDD_RESULT_FENCE,
    ].join("\n");
    const ndjson = [
      JSON.stringify({ type: "system", subtype: "init" }),
      JSON.stringify({
        type: "user",
        isSynthetic: true,
        message: { content: [{ type: "text", text: body }] },
      }),
      JSON.stringify({ type: "result", subtype: "success" }),
    ].join("\n");

    // Five occurrences in the raw bytes, zero in the run.
    expect(occurrences(ndjson, FORK_TDD_RESULT_FENCE)).toBe(5);
    expect(countForkTddResults(ndjson)).toBe(0);
    expect(extractForkToolResultText(ndjson)).not.toContain(FORK_TDD_RESULT_FENCE);
  });

  test("the projection drops a synthetic-only token that the raw bytes carry", () => {
    for (const leg of LEGS) {
      const raw = rawCapture(leg);
      expect(occurrences(raw, SYNTHETIC_ONLY_TOKEN)).toBeGreaterThan(0);
      expect(occurrences(extractForkToolResultText(raw), SYNTHETIC_ONLY_TOKEN)).toBe(0);
    }
  });

  test("the fork/synthetic/raw split is reported as COUNTS, not presence", () => {
    for (const leg of LEGS) {
      const score = scoreForkTddResults(rawCapture(leg));
      expect(score.forkHits).toBe(FORK_COUNTS[leg]);
      expect(score.syntheticHits).toBe(SYNTHETIC_OCCURRENCES[leg]);
      expect(score.rawHits).toBe(RAW_OCCURRENCES[leg]);

      // The two exclusions, each visible as a gap in the arithmetic: the
      // synthetic body (AC.3) and the `tool_use_result` mirror that would
      // otherwise double every hand-off.
      expect(score.forkHits).toBeLessThan(score.rawHits);
      expect(score.forkHits + score.syntheticHits).toBeLessThan(score.rawHits);
      expect(score.rawHits).toBe(score.forkHits * 2 + score.syntheticHits);
    }
  });

  test("a tool_result nested inside a synthetic event still does not count", () => {
    const ndjson = [
      JSON.stringify({
        type: "user",
        isSynthetic: true,
        message: {
          content: [{ type: "tool_result", content: `x\n${FORK_TDD_RESULT_FENCE}\nrole: implementer` }],
        },
      }),
    ].join("\n");
    expect(countForkTddResults(ndjson)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-484.4 — STE-483's harness proves the assertion fails when the blocks
// are absent, running the SKILL's own bytes end to end.
// ---------------------------------------------------------------------------

describe("AC-STE-484.4 — falsifiability through the harness, no paraphrase", () => {
  test("STE-484 is registered and its row names a SITE, never a shell", () => {
    expect(uncoveredRepairs(M127_REPAIRS, M127_REPAIR_ROSTER)).not.toContain("STE-484");
    const entry = repairEntry();
    expect(Object.keys(entry)).not.toContain("shell");
    expect(Object.keys(entry)).not.toContain("command");
    expect(entry.site.section).toContain("Fixture group 7");
    expect(entry.subject).toBe(FORK_TDD_RESULT_FENCE);
    expect(entry.threshold).toBe(THRESHOLD);
    expect(LEGS).toContain(entry.leg);
  });

  test("the extracted bytes are VERBATIM the SKILL's own", () => {
    const shell = liveShell();
    expect(SKILL_BODY).toContain(shell);
    expect(shell).toContain("/tmp/dpt-smoke-<tracker>-implement.log");
  });

  test("extract → bind → run: the SKILL's bytes score the shipped captures", () => {
    const shell = liveShell();
    for (const leg of LEGS) {
      const run = runAssertion(bindCapture(shell, capturePathFor(leg)));
      // Bare integer on stdout — anything else and the harness's count parser
      // silently degrades to counting output LINES.
      expect(run.stdout.trim()).toMatch(/^\d+$/);
      expect(run.count).toBe(FORK_COUNTS[leg]);
      // Threshold met ⇒ exit 0, so the smoke driver can branch on the code.
      expect(run.exitCode).toBe(0);
    }
  });

  test("the same bytes go RED when the fork blocks are absent", () => {
    const shell = liveShell();
    for (const leg of LEGS) {
      const stripped = tempCapture(`run-no-forks-${leg}.ndjson`, withoutForkEvents(leg));
      const run = runAssertion(bindCapture(shell, stripped));
      expect(run.count).toBe(0);
      expect(run.exitCode).not.toBe(0);
    }
  });

  test("checkRepairEntry scores the registered repair FALSIFIABLE on every leg", () => {
    const entry = repairEntry();
    for (const leg of LEGS) {
      const result = checkRepairEntry({ ...entry, leg }, SKILL_BODY);
      expect(result.id).toBe("STE-484");
      expect(result.presentCount).toBe(FORK_COUNTS[leg]);
      expect(result.absentCount).toBeLessThan(THRESHOLD);
      expect(result.removed).toBe(RAW_OCCURRENCES[leg]);
      expect(result.verdict).toBe("falsifiable");
    }
  });

  test("checkRepairEntry executes the SKILL's bytes, not a remembered copy", () => {
    const entry = repairEntry();
    const result = checkRepairEntry(entry, SKILL_BODY);
    // The command it ran is exactly the extracted span bound to the shipped
    // capture — the no-paraphrase rule, pinned at the call site.
    expect(result.command).toBe(bindCapture(liveShell(), capturePathFor(entry.leg)).command);
    expect(result.command).toContain(capturePathFor(entry.leg));

    // And there is no way to hand it a shell: a drifted SKILL must THROW, never
    // fall back to a private form that keeps reporting green.
    const drifted = SKILL_BODY.split(entry.site.select).join("no-such-token");
    expect(() => checkRepairEntry(entry, drifted)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// AC-STE-484.5 — the SKILL prose naming `extractAssistantText` as the repair
// for fork-emitted blocks is corrected.
// ---------------------------------------------------------------------------

describe("AC-STE-484.5 — the wrong-projection recommendation is retired", () => {
  test("no prose still offers extractAssistantText as the reader for tdd-result fences", () => {
    const lines = SKILL_BODY.split("\n").filter(
      (line) => line.includes("extractAssistantText") && line.includes("tdd-result"),
    );
    // The correction has to live somewhere — silently deleting the sentence
    // leaves the next reader free to make the same mistake a third time.
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).toContain("tool_result");
      expect(line).toMatch(/wrong|never|not the/i);
    }
    expect(lines.some((line) => /wrong projection/i.test(line))).toBe(true);
    expect(lines.some((line) => line.includes("STE-484"))).toBe(true);
  });

  test("the correction points at the projection that DOES work", () => {
    const lines = SKILL_BODY.split("\n").filter(
      (line) => line.includes("extractAssistantText") && line.includes("tdd-result"),
    );
    expect(lines.some((line) => line.includes("fork_tdd_result_assert"))).toBe(true);
  });

  test("the wrong-projection claim is measured, not merely asserted", () => {
    for (const leg of LEGS) {
      const raw = rawCapture(leg);
      // `extractAssistantText` excludes `user`/`tool_result` events by design,
      // and every fork hand-off lands in exactly those events.
      expect(occurrences(extractAssistantText(raw), FORK_TDD_RESULT_FENCE)).toBe(0);
      // The correct projection, same bytes, same moment.
      expect(countForkTddResults(raw)).toBe(FORK_COUNTS[leg]);
    }
  });
});
