import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// STE-285 AC-STE-285.1 — `/setup` hooks-menu prompt step.
//
// `/setup` adds a new step (after stack detection, before the final summary
// report) that fires a single `AskUserQuestion` with multi-select options.
// Each option is a named toolkit-contract enforcement hook. All options
// default to off. User picks zero or more.
//
// This is doc-conformance: the SKILL.md prose must document the new step
// with (a) an `AskUserQuestion` directive, (b) the multi-select shape,
// (c) ≥ 4 named hook options, (d) all-off default.

const SKILL_PATH = join(
  import.meta.dir,
  "..",
  "SKILL.md",
);

const SEEDED_HOOKS = [
  "pre-commit-gate-check",
  "pre-pr-spec-review",
  "pre-spec-write-brainstorm-reminder",
  "pre-commit-tdd-orchestrator",
];

function read(): string {
  return readFileSync(SKILL_PATH, "utf-8");
}

/**
 * Locate the hooks-menu step. The AC says it lands "after stack detection,
 * before the final summary report" — that puts it after step 7-series and
 * before step 11 (Report). We anchor on a heading whose body names the
 * `AskUserQuestion` directive AND at least one seeded hook name.
 */
function hooksStepRegion(body: string): string {
  // Search for the "hooks" step anchor. Accept any of these heading shapes:
  //   "### 7f. Hooks menu" / "### 7f. Toolkit-contract enforcement hooks"
  //   "### 8c. Hooks menu" — orchestrator may pick any free sub-step slot.
  // The required predicates are (1) `AskUserQuestion` text and (2) ≥ 1
  // seeded hook name appearing in the same region.
  const lines = body.split("\n");
  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (/^###\s/.test(line) && /hook/i.test(line)) {
      startIdx = i;
      break;
    }
  }
  if (startIdx === -1) {
    return "";
  }
  // Region extends to the next `### ` or `## ` heading.
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (/^###?\s/.test(line)) {
      endIdx = i;
      break;
    }
  }
  return lines.slice(startIdx, endIdx).join("\n");
}

describe("AC-STE-285.1 — hooks-menu step is documented in /setup SKILL.md", () => {
  test("SKILL.md carries a hooks step heading", () => {
    const region = hooksStepRegion(read());
    expect(region.length).toBeGreaterThan(0);
  });

  test("hooks step body directs `AskUserQuestion` as the prompt mechanism", () => {
    const region = hooksStepRegion(read());
    expect(region).toContain("AskUserQuestion");
  });

  test("hooks step body declares multi-select shape", () => {
    const region = hooksStepRegion(read());
    expect(region).toMatch(/multi-select|multi select|multiselect/i);
  });

  test("hooks step body documents the all-off default", () => {
    const region = hooksStepRegion(read());
    // Accept any of: "all options default to off", "default: off",
    // "all defaulted off", "defaulted off".
    expect(region).toMatch(/default(ed| to|s|:)?\s*(to\s*)?off|all\s+off|all\s+defaulted\s+off|all\s+default(ed)?\s+(to\s+)?off/i);
  });

  test("hooks step body names ≥ 4 seeded hooks as options", () => {
    const region = hooksStepRegion(read());
    const named = SEEDED_HOOKS.filter((h) => region.includes(h));
    expect(named.length).toBeGreaterThanOrEqual(4);
  });

  test("hooks step is placed after stack detection and before the final Report step", () => {
    const body = read();
    const stackDetectIdx = body.indexOf("### 1. Detect the project");
    expect(stackDetectIdx).toBeGreaterThan(-1);
    const reportIdx = body.indexOf("### 11. Report");
    expect(reportIdx).toBeGreaterThan(-1);
    // Find the hooks step header by name.
    const lines = body.split("\n");
    let hooksHeadingOffset = -1;
    let runningOffset = 0;
    for (const line of lines) {
      if (/^###\s/.test(line) && /hook/i.test(line)) {
        hooksHeadingOffset = runningOffset;
        break;
      }
      runningOffset += line.length + 1;
    }
    expect(hooksHeadingOffset).toBeGreaterThan(stackDetectIdx);
    expect(hooksHeadingOffset).toBeLessThan(reportIdx);
  });
});
