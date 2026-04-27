// STE-122 — `scanGuessedTrackerIdLiterals(files)` post-write scanner.
//
// AC-STE-122.3 / AC-STE-122.4 / AC-STE-122.5 / AC-STE-122.6: catches literal
// `AC-<digit>.<N>` placeholders surviving substitution; exempts fenced /
// indented / inline-backtick code; does not flag tracker-mode (`AC-STE-1.1`)
// or mode-none (`AC-VDTAF4.1`) shapes.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanGuessedTrackerIdLiterals } from "./guessed_tracker_id_scan";

function tmpFile(content: string): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "guessed-ac-"));
  const path = join(dir, "file.md");
  writeFileSync(path, content);
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe("scanGuessedTrackerIdLiterals — happy path", () => {
  test("empty file → no violations", () => {
    const ctx = tmpFile("");
    try {
      expect(scanGuessedTrackerIdLiterals([ctx.path])).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });

  test("single AC-1.1 literal yields one violation with line/column", () => {
    const ctx = tmpFile("Some prose.\n- AC-1.1: Validate input.\nMore prose.\n");
    try {
      const v = scanGuessedTrackerIdLiterals([ctx.path]);
      expect(v.length).toBe(1);
      expect(v[0]!.match).toBe("AC-1.1");
      expect(v[0]!.line).toBe(2);
      expect(v[0]!.column).toBe(3); // "- AC-1.1" → AC-1.1 starts at col 3
    } finally {
      ctx.cleanup();
    }
  });

  test("multiple literals on one line yield multiple violations", () => {
    const ctx = tmpFile("Reference AC-1.1 and AC-2.3 here.\n");
    try {
      const v = scanGuessedTrackerIdLiterals([ctx.path]);
      expect(v.length).toBe(2);
      expect(v.map((x) => x.match)).toEqual(["AC-1.1", "AC-2.3"]);
    } finally {
      ctx.cleanup();
    }
  });

  test("multi-line scan reports correct line numbers", () => {
    const ctx = tmpFile(["", "AC-1.1 here", "", "AC-2.2 also"].join("\n"));
    try {
      const v = scanGuessedTrackerIdLiterals([ctx.path]);
      expect(v.length).toBe(2);
      expect(v[0]!.line).toBe(2);
      expect(v[1]!.line).toBe(4);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("scanGuessedTrackerIdLiterals — fenced/indented exemptions (AC-STE-122.4)", () => {
  test("triple-backtick fenced block exempts AC-1.1", () => {
    const ctx = tmpFile(["Prose.", "```", "AC-1.1: example", "```", "After."].join("\n"));
    try {
      expect(scanGuessedTrackerIdLiterals([ctx.path])).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });

  test("language-tagged fenced block exempts AC-1.1", () => {
    const ctx = tmpFile(["```yaml", "AC-1.1: example", "```"].join("\n"));
    try {
      expect(scanGuessedTrackerIdLiterals([ctx.path])).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });

  test("4-space-indented block exempts AC-1.1", () => {
    const ctx = tmpFile("Prose.\n\n    AC-1.1: example\n");
    try {
      expect(scanGuessedTrackerIdLiterals([ctx.path])).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });

  test("inline-backtick `AC-1.1` is exempt", () => {
    const ctx = tmpFile("See `AC-1.1` for example.\n");
    try {
      expect(scanGuessedTrackerIdLiterals([ctx.path])).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });

  test("inline-backtick + bare on same line — only the bare instance flagged", () => {
    const ctx = tmpFile("`AC-1.1` is shown but AC-2.2 is bare.\n");
    try {
      const v = scanGuessedTrackerIdLiterals([ctx.path]);
      expect(v.length).toBe(1);
      expect(v[0]!.match).toBe("AC-2.2");
    } finally {
      ctx.cleanup();
    }
  });
});

describe("scanGuessedTrackerIdLiterals — canonical shapes pass (AC-STE-122.5, AC-STE-122.6)", () => {
  test("tracker-mode shape AC-STE-122.1 → no violation", () => {
    const ctx = tmpFile("- AC-STE-122.1: System validates input.\n");
    try {
      expect(scanGuessedTrackerIdLiterals([ctx.path])).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });

  test("mode-none shape AC-VDTAF4.1 → no violation", () => {
    const ctx = tmpFile("- AC-VDTAF4.1: System validates input.\n");
    try {
      expect(scanGuessedTrackerIdLiterals([ctx.path])).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });

  test("multi-letter prefix like AC-PROJ-99.1 → no violation", () => {
    const ctx = tmpFile("- AC-PROJ-99.1: Jira-style.\n");
    try {
      expect(scanGuessedTrackerIdLiterals([ctx.path])).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });

  test("em-dash AC body does not false-positive", () => {
    const ctx = tmpFile("- AC-STE-122.1: Title — with em-dash.\n");
    try {
      expect(scanGuessedTrackerIdLiterals([ctx.path])).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("scanGuessedTrackerIdLiterals — multi-file batch", () => {
  test("scans every file in the input list", () => {
    const a = tmpFile("- AC-1.1: bad\n");
    const b = tmpFile("- AC-STE-1.1: good\n");
    try {
      const v = scanGuessedTrackerIdLiterals([a.path, b.path]);
      expect(v.length).toBe(1);
      expect(v[0]!.file).toBe(a.path);
    } finally {
      a.cleanup();
      b.cleanup();
    }
  });
});

describe("scanGuessedTrackerIdLiterals — message shape", () => {
  test("violation message is NFR-10 canonical (verdict + remedy + context)", () => {
    const ctx = tmpFile("- AC-1.1: x\n");
    try {
      const v = scanGuessedTrackerIdLiterals([ctx.path]);
      expect(v.length).toBe(1);
      const msg = v[0]!.message;
      expect(msg).toMatch(/guessed_tracker_id/);
      expect(msg).toMatch(/AC-1\.1/);
      expect(msg).toMatch(/acPrefix/);
    } finally {
      ctx.cleanup();
    }
  });
});
