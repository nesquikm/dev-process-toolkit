// STE-304 AC-STE-304.9 — `/spec-write` § 7 static capability map gains the 5
// new rows from AC.7 with their documented plain-language renderings.
//
// Byte-checks `plugins/dev-process-toolkit/skills/spec-write/SKILL.md` § 7
// "Static plain-language map (capability key ⇒ rendered prose)" carries one
// row per key:
//
//   - `tracker_status_forced`
//   - `tracker_status_skipped`
//   - `tracker_status_cancelled`
//   - `tracker_status_unknown_encountered`
//   - `tracker_tolerance_refused_non_tty`
//
// Each row's prose mentions the verdict-side hint documented in AC.9.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SKILL_MD_PATH = join(
  import.meta.dir,
  "..",
  "skills",
  "spec-write",
  "SKILL.md",
);

const skillBody = readFileSync(SKILL_MD_PATH, "utf-8");

// Locate the "Static plain-language map" block — every assertion below must
// match a row inside it, not arbitrary prose elsewhere in the document.
function captureCapabilityMapBlock(body: string): string {
  const start = body.search(
    /Static plain-language map \(capability key ⇒ rendered prose\):/,
  );
  expect(start).toBeGreaterThan(-1);
  // Capture from the heading through the next non-table heading (`## ` or
  // `### ` or end-of-file). The map itself is bounded by the next "##" or "###"
  // section header.
  const after = body.slice(start);
  const endMatch = /\n\s*(##\s|###\s|## Rules)/.exec(after.slice(20));
  return endMatch ? after.slice(0, 20 + endMatch.index) : after;
}

const capabilityMapBlock = captureCapabilityMapBlock(skillBody);

interface RowExpectation {
  key: string;
  proseHints: RegExp[];
}

const EXPECTED_ROWS: RowExpectation[] = [
  {
    key: "tracker_status_forced",
    // "operator chose force on non-key status — calling skill proceeded as if
    //  the observed status matched the expected role"
    proseHints: [/operator chose force/i, /expected role/i],
  },
  {
    key: "tracker_status_skipped",
    // "operator chose skip — calling skill continued with remaining work,
    //  the affected task was left untouched"
    proseHints: [/operator chose skip/i, /remaining work|untouched|left/i],
  },
  {
    key: "tracker_status_cancelled",
    // "operator chose cancel — calling skill halted with no state mutation"
    proseHints: [/operator chose cancel/i, /halt(ed)?/i, /no state mutation|state mutation/i],
  },
  {
    key: "tracker_status_unknown_encountered",
    // "observed status not in project's known list — operator should re-run
    //  /setup to resync"
    proseHints: [/observed status/i, /re-run \/setup/i, /resync/i],
  },
  {
    key: "tracker_tolerance_refused_non_tty",
    // "non-key status encountered under non-tty stdin without operator on
    //  the line — re-invoke interactively to resolve"
    proseHints: [/non-tty/i, /re-invoke interactively/i],
  },
];

describe("AC-STE-304.9 — /spec-write § 7 static capability map gains the 5 new rows", () => {
  for (const row of EXPECTED_ROWS) {
    test(`row for \`${row.key}\` exists in the capability map`, () => {
      // Backtick-quoted literal token in a markdown table cell.
      const literalPattern = new RegExp(`\\\`${row.key}\\\``);
      expect(capabilityMapBlock).toMatch(literalPattern);
    });

    test(`row for \`${row.key}\` carries the documented plain-language prose`, () => {
      // Capture the row line (capability map rows are `| \`key\` | prose |`).
      const rowLineRegex = new RegExp(
        `\\|\\s*\`${row.key}\`[^\\n]+`,
        "m",
      );
      const rowMatch = rowLineRegex.exec(capabilityMapBlock);
      expect(rowMatch).not.toBeNull();
      const rowLine = rowMatch![0];
      for (const hint of row.proseHints) {
        expect(rowLine).toMatch(hint);
      }
    });
  }

  test("all 5 keys are byte-present somewhere in spec-write SKILL.md", () => {
    // Sanity floor: the full skill body must carry every token at least once.
    for (const row of EXPECTED_ROWS) {
      expect(skillBody).toContain(row.key);
    }
  });
});
