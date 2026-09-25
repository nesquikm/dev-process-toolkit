// M_2306b6 / STE-616 — fixture DATA is not a test, so it does not require /tdd.
//
// The stack layout says "everything under a test directory is test material",
// which is right for the spec-only carve-out (a fixture beside a spec is not a
// spec-only commit) and wrong for the /tdd trigger. Committing an evidence bundle
// — JSON a live smoke leg captured — was refused for want of TDD evidence that
// cannot honestly exist: with the files absent the suites pass, so there is no
// red to prove. The smoke's own pre-flight requires those bundles committed, so
// the two guards deadlocked (measured 2026-09-24, leg 7's bundle).
//
// The narrowing is exactly: a path inside a `fixtures/` directory whose name is
// NOT a test (no test glob) and whose extension is NOT a source extension of the
// resolved stack. Code in a fixtures directory, and every real test file, keep
// the requirement. Two-sided on purpose: each row below reds under the opposite
// break.

import { describe, expect, test } from "bun:test";

import { classifyStagedPathsForEntry } from "../templates/hooks/_lib/hooks/pre-commit-tdd-orchestrator";
import { STACK_LAYOUTS } from "../adapters/_shared/src/stack_layout";

const entryFor = (marker: string) => {
  const entry = STACK_LAYOUTS.find((e) => e.marker === marker);
  if (!entry) throw new Error(`no stack layout entry for ${marker}`);
  return entry;
};

const TS = entryFor("package.json");
const PY = entryFor("pyproject.toml");

const BUNDLE =
  "plugins/dev-process-toolkit/tests/fixtures/shared-tracker-live/jira-2026-09-24-shrf1376b87";

describe("STE-616 — data fixtures are not tdd-required", () => {
  const exempt: ReadonlyArray<[string, string[]]> = [
    ["an evidence bundle's two JSON files", [`${BUNDLE}/bundle.json`, `${BUNDLE}/ledger.json`]],
    ["a fixture JSON under tests/", ["tests/fixtures/answer.json"]],
    ["a fixture JSON under __tests__/", ["__tests__/fixtures/data.json"]],
    ["an NDJSON transcript fixture", ["tests/fixtures/run/transcript.ndjson"]],
    ["a fixture markdown file", ["tests/fixtures/project/specs/frs/STE-1.md"]],
  ];
  for (const [label, paths] of exempt) {
    test(`${label} → no-fr`, () => {
      expect(classifyStagedPathsForEntry(paths, TS)).toBe("no-fr");
    });
  }

  test("python: a fixture JSON is exempt there too", () => {
    expect(classifyStagedPathsForEntry(["tests/fixtures/x.json"], PY)).toBe("no-fr");
  });
});

describe("STE-616 — the narrowing does not reach real tests or code", () => {
  const required: ReadonlyArray<[string, string[]]> = [
    ["a real test file", ["tests/foo.test.ts"]],
    ["a test file living inside fixtures/", ["tests/fixtures/foo.test.ts"]],
    ["code inside fixtures/ (a source extension)", ["tests/fixtures/helper.ts"]],
    ["non-fixture data in the test tree", ["tests/helper.json"]],
    ["a bundle staged beside a real test", [`${BUNDLE}/bundle.json`, "tests/foo.test.ts"]],
    ["a bundle staged beside an active FR", [`${BUNDLE}/bundle.json`, "specs/frs/STE-616.md"]],
  ];
  for (const [label, paths] of required) {
    test(`${label} → tdd-required`, () => {
      expect(classifyStagedPathsForEntry(paths, TS)).toBe("tdd-required");
    });
  }

  test("python: a conftest.py inside fixtures/ keeps the requirement", () => {
    expect(classifyStagedPathsForEntry(["tests/fixtures/conftest.py"], PY)).toBe(
      "tdd-required",
    );
  });

  test("a fixture beside a spec is still not a spec-only commit", () => {
    // The carve-out keeps reading the full layout: data in the test tree is not
    // spec material, so the set is not `spec-only` — it is merely not tdd-required.
    expect(
      classifyStagedPathsForEntry(["specs/plan/M70.md", "tests/fixtures/a.json"], TS),
    ).toBe("no-fr");
  });
});
