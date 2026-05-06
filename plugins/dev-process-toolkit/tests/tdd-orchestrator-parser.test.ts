import { describe, expect, test } from "bun:test";
import {
  extractTddResultBlock,
  parseTddResultBlock,
  type TddRole,
} from "../adapters/_shared/src/tdd_result";

// STE-225 AC.4 + AC.8(a) — `tdd-result` fenced-block parser.
//
// Each child subagent ends its turn with exactly one fenced block:
//
//     ```tdd-result
//     role: test-writer
//     status: ok
//     files:
//       - tests/add.test.ts
//     command: bun test tests/add.test.ts
//     output_excerpt: |
//       Error: expected add to be a function
//     notes: optional
//     ```
//
// Required fields per role:
//   role: test-writer  ⇒ status, files, command, output_excerpt (notes optional)
//   role: implementer  ⇒ status, files, command, output_excerpt (notes optional)
//   role: refactorer   ⇒ status, files (may be empty), command, output_excerpt (notes optional)
//
// Format violations (per AC.4, AC.8a): missing block, missing role, missing
// required field, wrong role for invocation, more than one fenced block.

function fence(body: string): string {
  return ["```tdd-result", body, "```"].join("\n");
}

const WELL_FORMED_TEST_WRITER = fence(
  [
    "role: test-writer",
    "status: ok",
    "files:",
    "  - tests/add.test.ts",
    "command: bun test tests/add.test.ts",
    "output_excerpt: |",
    "  FAIL  tests/add.test.ts",
    "  add is not a function",
  ].join("\n"),
);

const WELL_FORMED_IMPLEMENTER = fence(
  [
    "role: implementer",
    "status: ok",
    "files:",
    "  - src/add.ts",
    "command: bun test tests/add.test.ts",
    "output_excerpt: |",
    "  PASS  tests/add.test.ts",
  ].join("\n"),
);

const WELL_FORMED_REFACTORER = fence(
  [
    "role: refactorer",
    "status: ok",
    "files: []",
    "command: bun test",
    "output_excerpt: |",
    "  PASS — 1 of 1",
    "notes: no refactor needed",
  ].join("\n"),
);

describe("AC-STE-225.4 — tdd-result fenced-block parser", () => {
  test("well-formed test-writer block parses with all fields", () => {
    const r = parseTddResultBlock(WELL_FORMED_TEST_WRITER);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.block.role).toBe("test-writer");
    expect(r.block.status).toBe("ok");
    expect(r.block.files).toEqual(["tests/add.test.ts"]);
    expect(r.block.command).toBe("bun test tests/add.test.ts");
    expect(r.block.output_excerpt).toContain("FAIL");
  });

  test("well-formed implementer block parses", () => {
    const r = parseTddResultBlock(WELL_FORMED_IMPLEMENTER);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.block.role).toBe("implementer");
    expect(r.block.files).toEqual(["src/add.ts"]);
  });

  test("well-formed refactorer block parses with empty files []", () => {
    const r = parseTddResultBlock(WELL_FORMED_REFACTORER);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.block.role).toBe("refactorer");
    expect(r.block.files).toEqual([]);
    expect(r.block.notes).toBe("no refactor needed");
  });

  test("status: failed is accepted (semantic-failure path)", () => {
    const body = fence(
      [
        "role: test-writer",
        "status: failed",
        "files:",
        "  - tests/foo.test.ts",
        "command: bun test",
        "output_excerpt: |",
        "  no failure observed",
      ].join("\n"),
    );
    const r = parseTddResultBlock(body);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.block.status).toBe("failed");
  });

  test("missing role ⇒ format violation naming the field", () => {
    const body = fence(
      ["status: ok", "files: []", "command: bun test", "output_excerpt: |", "  x"].join("\n"),
    );
    const r = parseTddResultBlock(body);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/role/);
  });

  test("missing required field ⇒ format violation naming the field", () => {
    for (const missing of ["status", "files", "command", "output_excerpt"]) {
      const all: Record<string, string> = {
        status: "status: ok",
        files: "files: []",
        command: "command: bun test",
        output_excerpt: "output_excerpt: |\n  PASS",
      };
      delete all[missing]!;
      const body = fence(["role: implementer", ...Object.values(all)].join("\n"));
      const r = parseTddResultBlock(body);
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(r.reason).toContain(missing);
    }
  });

  test("invalid role value ⇒ format violation", () => {
    const body = fence(
      [
        "role: nobody",
        "status: ok",
        "files: []",
        "command: bun test",
        "output_excerpt: |",
        "  x",
      ].join("\n"),
    );
    const r = parseTddResultBlock(body);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/role/i);
  });

  test("invalid status value ⇒ format violation", () => {
    const body = fence(
      [
        "role: implementer",
        "status: maybe",
        "files: []",
        "command: bun test",
        "output_excerpt: |",
        "  x",
      ].join("\n"),
    );
    const r = parseTddResultBlock(body);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/status/i);
  });

  test("expectedRole option rejects mismatched role with role-specific reason", () => {
    const r = parseTddResultBlock(WELL_FORMED_TEST_WRITER, {
      expectedRole: "implementer" as TddRole,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/expected.*implementer/);
    expect(r.reason).toMatch(/test-writer/);
  });

  test("notes is optional and survives when present", () => {
    const r = parseTddResultBlock(WELL_FORMED_REFACTORER);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.block.notes).toBe("no refactor needed");
  });

  test("notes absence is fine", () => {
    const r = parseTddResultBlock(WELL_FORMED_TEST_WRITER);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.block.notes).toBeUndefined();
  });

  test("extractTddResultBlock locates the fence inside larger output", () => {
    const stdout = [
      "Some preamble",
      "running test...",
      WELL_FORMED_IMPLEMENTER,
      "trailing chatter",
    ].join("\n\n");
    const fenced = extractTddResultBlock(stdout);
    expect(fenced.ok).toBe(true);
    if (!fenced.ok) return;
    expect(fenced.body).toContain("role: implementer");
  });

  test("extractTddResultBlock returns format violation when no fence present", () => {
    const stdout = "stdout with no fence here";
    const fenced = extractTddResultBlock(stdout);
    expect(fenced.ok).toBe(false);
    if (fenced.ok) return;
    expect(fenced.reason).toMatch(/no.*fenced/i);
  });

  test("more than one tdd-result fence ⇒ format violation", () => {
    const stdout = [WELL_FORMED_TEST_WRITER, WELL_FORMED_IMPLEMENTER].join("\n\n");
    const fenced = extractTddResultBlock(stdout);
    expect(fenced.ok).toBe(false);
    if (fenced.ok) return;
    expect(fenced.reason).toMatch(/multiple|more than one|exactly one/i);
  });

  test("parser surfaces files as list when multi-element", () => {
    const body = fence(
      [
        "role: implementer",
        "status: ok",
        "files:",
        "  - src/a.ts",
        "  - src/b.ts",
        "command: bun test",
        "output_excerpt: |",
        "  PASS",
      ].join("\n"),
    );
    const r = parseTddResultBlock(body);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.block.files).toEqual(["src/a.ts", "src/b.ts"]);
  });

  test("parser preserves multi-line output_excerpt body verbatim", () => {
    const body = fence(
      [
        "role: implementer",
        "status: ok",
        "files: []",
        "command: bun test",
        "output_excerpt: |",
        "  line one",
        "  line two",
        "  line three",
      ].join("\n"),
    );
    const r = parseTddResultBlock(body);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const lines = r.block.output_excerpt.split("\n");
    expect(lines).toContain("line one");
    expect(lines).toContain("line two");
    expect(lines).toContain("line three");
  });
});
