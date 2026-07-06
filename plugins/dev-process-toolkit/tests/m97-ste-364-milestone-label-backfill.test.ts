// Meta-tests for STE-364 — one-shot milestone-label backfill (M97).
//
// Prose contracts asserted against skills/spec-archive/SKILL.md:
//   - AC-STE-364.1: a dedicated `--backfill-milestone-labels` invocation form
//     (own heading — the inline remedy mention in the archival procedure does
//     NOT satisfy this) citing the shared helper `backfillMilestoneLabels`
//     (adapters/_shared/src/backfill_milestone_labels.ts).
//   - AC-STE-364.2: dry-run-by-default + `--dry-run` / `--apply` contract,
//     the `ticket → milestone` preview rows, and the clean-sweep re-run
//     no-op statement.
//   - AC-STE-364.3: aggregate report shape — `backfilled` / `already-correct`
//     / `failed` counts plus the failed ticket ids and the plan file each
//     maps to.
//   - AC-STE-364.4: FR-backed-only scope (never enumerates the tracker
//     board) and vacuity (`mode: none` / `project_milestone: false` → zero
//     candidates, no tracker call) stated INSIDE the backfill block.
//
// IMPORTANT: assertions here are phrase/token literals only — they never
// require STE-/AC-namespace tokens in skills/** prose (the shipped-prose
// ceiling test caps those counts).

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const pluginRoot = join(import.meta.dir, "..");

const specArchiveBody = readFileSync(
  join(pluginRoot, "skills", "spec-archive", "SKILL.md"),
  "utf8",
);

const FLAG = "--backfill-milestone-labels";
const HELPER = "backfillMilestoneLabels";
const HELPER_PATH = "adapters/_shared/src/backfill_milestone_labels.ts";

// The invocation form must be its own heading (H2–H4) naming the flag — an
// inline mention (e.g. inside the STE-363 refusal remedy) is not a form.
const HEADING_RE = /^#{2,4} .*--backfill-milestone-labels.*$/m;

/** The backfill invocation-form block: its heading through the next heading. */
function backfillBlock(): string {
  const m = specArchiveBody.match(HEADING_RE);
  expect(m).not.toBeNull();
  const start = specArchiveBody.indexOf(m![0]);
  const afterHeading = start + m![0].length;
  const rest = specArchiveBody.slice(afterHeading);
  const next = rest.search(/^#{2,4} /m);
  return specArchiveBody.slice(start, next === -1 ? undefined : afterHeading + next);
}

describe("AC-STE-364.1 — backfill invocation form wired into /spec-archive", () => {
  test(`SKILL.md carries a dedicated ${FLAG} heading (invocation form, not just the remedy mention)`, () => {
    expect(specArchiveBody).toMatch(HEADING_RE);
  });

  test("the form cites the shared helper by name", () => {
    expect(backfillBlock()).toContain(HELPER);
  });

  test("the form cites the shared helper module path", () => {
    expect(backfillBlock()).toContain(HELPER_PATH);
  });

  test("the form covers BOTH active and archived FR trees", () => {
    const block = backfillBlock();
    expect(block).toContain("specs/frs/");
    expect(block).toContain("specs/frs/archive/");
  });
});

describe("AC-STE-364.2 — dry-run default + --apply contract in prose", () => {
  test("the form states the sweep is dry-run by default", () => {
    expect(backfillBlock()).toMatch(/dry-run by default/i);
  });

  test("the form documents both the --dry-run and --apply flags", () => {
    const block = backfillBlock();
    expect(block).toContain("--dry-run");
    expect(block).toContain("--apply");
  });

  test("the form states a dry-run writes nothing", () => {
    expect(backfillBlock()).toMatch(/writes nothing/i);
  });

  test("the form renders the preview rows as `ticket → milestone`", () => {
    expect(backfillBlock()).toContain("ticket → milestone");
  });

  test("the form states re-running --apply after a clean sweep is a no-op", () => {
    expect(backfillBlock()).toMatch(/no-op/i);
  });
});

describe("AC-STE-364.3 — aggregate report shape in prose", () => {
  test("the form names the three aggregate count buckets as literals", () => {
    const block = backfillBlock();
    expect(block).toContain("`backfilled`");
    expect(block).toContain("`already-correct`");
    expect(block).toContain("`failed`");
  });

  test("the form states the report lists failed ticket ids and the plan file each maps to", () => {
    const block = backfillBlock();
    expect(block).toMatch(/failed ticket/i);
    expect(block).toMatch(/plan file/i);
  });

  test("the form states the sweep is best-effort per ticket (one failure never aborts the rest)", () => {
    expect(backfillBlock()).toMatch(/best-effort/i);
  });
});

describe("AC-STE-364.4 — FR-backed scope + vacuity in prose", () => {
  test("the form states the FR-backed-only scope", () => {
    expect(backfillBlock()).toContain("FR-backed");
  });

  test("the form states the sweep never enumerates the tracker board", () => {
    expect(backfillBlock()).toMatch(/never enumerat\w* the tracker board/i);
  });

  test("the form states vacuity on mode: none and project_milestone: false", () => {
    const block = backfillBlock();
    expect(block).toContain("mode: none");
    expect(block).toContain("project_milestone: false");
  });

  test("the vacuous run reports zero candidates and makes no tracker call", () => {
    const block = backfillBlock();
    expect(block).toMatch(/zero candidates/i);
    expect(block).toMatch(/no tracker call/i);
  });
});
