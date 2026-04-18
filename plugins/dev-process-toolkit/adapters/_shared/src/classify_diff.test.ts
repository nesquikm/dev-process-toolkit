import { describe, expect, test } from "bun:test";
import { classifyDiff, formatSchemaK, hasConflicts, type AC } from "./classify_diff";

const l = (id: string, text: string, completed = false): AC => ({ id, text, completed });

describe("classifyDiff", () => {
  test("all identical", () => {
    const rows = classifyDiff(
      [l("AC-1.1", "a"), l("AC-1.2", "b", true)],
      [l("AC-1.1", "a"), l("AC-1.2", "b", true)],
    );
    expect(rows.map((r) => r.classification)).toEqual(["identical", "identical"]);
    expect(hasConflicts(rows)).toBe(false);
  });

  test("local-only AC", () => {
    const rows = classifyDiff([l("AC-1.1", "x")], []);
    expect(rows[0]!.classification).toBe("local-only");
    expect(rows[0]!.tracker).toBe(null);
    expect(hasConflicts(rows)).toBe(true);
  });

  test("tracker-only AC", () => {
    const rows = classifyDiff([], [l("AC-1.1", "x")]);
    expect(rows[0]!.classification).toBe("tracker-only");
    expect(rows[0]!.local).toBe(null);
  });

  test("edited-both: text differs", () => {
    const rows = classifyDiff(
      [l("AC-1.1", "local wording")],
      [l("AC-1.1", "tracker wording")],
    );
    expect(rows[0]!.classification).toBe("edited-both");
  });

  test("edited-both: completed state differs", () => {
    const rows = classifyDiff(
      [l("AC-1.1", "x", false)],
      [l("AC-1.1", "x", true)],
    );
    expect(rows[0]!.classification).toBe("edited-both");
  });

  test("whitespace-only text diffs are collapsed (AC-39.6 normalization)", () => {
    const rows = classifyDiff(
      [l("AC-1.1", "hello   world")],
      [l("AC-1.1", "hello world")],
    );
    expect(rows[0]!.classification).toBe("identical");
  });

  test("rows sorted by AC id", () => {
    const rows = classifyDiff(
      [l("AC-2.1", "b"), l("AC-1.1", "a")],
      [l("AC-2.1", "b"), l("AC-1.1", "a")],
    );
    expect(rows.map((r) => r.id)).toEqual(["AC-1.1", "AC-2.1"]);
  });

  test("formatSchemaK emits canonical Schema K lines", () => {
    const rows = classifyDiff(
      [l("AC-1.1", "x")],
      [l("AC-1.2", "y")],
    );
    const out = formatSchemaK(rows);
    expect(out).toContain('AC-1.1: local-only | local: "x" | tracker: "<absent>"');
    expect(out).toContain('AC-1.2: tracker-only | local: "<absent>" | tracker: "y"');
  });

  test("mixed classifications render in stable order", () => {
    const rows = classifyDiff(
      [l("AC-1.1", "a"), l("AC-1.2", "b_old")],
      [l("AC-1.1", "a"), l("AC-1.2", "b_new"), l("AC-1.3", "c")],
    );
    const classes = rows.map((r) => `${r.id}=${r.classification}`);
    expect(classes).toEqual(["AC-1.1=identical", "AC-1.2=edited-both", "AC-1.3=tracker-only"]);
  });

  test("clean run has no conflicts → skill skips per-AC prompt fast path", () => {
    const rows = classifyDiff(
      [l("AC-7.1", "Export entries as CSV")],
      [l("AC-7.1", "Export entries as CSV")],
    );
    expect(hasConflicts(rows)).toBe(false);
  });
});
