// M108 STE-391 — line-surgery EOL preservation in the migrations helper.
//
// AC-STE-391.4 promises that anything the entries do not target is "preserved
// byte-for-byte", and `rewriteLinesIfChanged` is the shared primitive both the
// .gitignore strip (AC.3) and the sync-log splice (AC.4) route through. A file
// with MIXED line endings is the input class where that promise is easiest to
// break: joining every kept line with one dominant EOL rewrites the endings of
// lines the transform never touched.
//
// Surfaced by the STE-391 AUDIT pass, which found the helper had no direct test
// coverage at all and no CRLF fixture existed anywhere in the FR.

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readLines, rewriteLinesIfChanged } from "../adapters/_shared/src/migrations/consumer_files";

const roots: string[] = [];

const fixture = (contents: string): string => {
  const root = mkdtempSync(join(tmpdir(), "dpt-eol-"));
  roots.push(root);
  const path = join(root, ".gitignore");
  writeFileSync(path, contents);
  return path;
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

// A real-world shape: a checkout where some lines arrived CRLF and others LF.
const MIXED = "node_modules/\r\n.dev-process/\ndist/\r\n.env\n";

describe("rewriteLinesIfChanged — a no-op transform never writes", () => {
  test("mixed-ending file is left byte-identical when nothing changes", () => {
    const path = fixture(MIXED);
    const before = readFileSync(path);

    expect(rewriteLinesIfChanged(path, (lines) => lines)).toBe(false);
    expect(readFileSync(path).equals(before)).toBe(true);
  });

  test("an absent file is not a write and not an error", () => {
    const path = join(mkdtempSync(join(tmpdir(), "dpt-eol-")), "nope.gitignore");
    expect(rewriteLinesIfChanged(path, (lines) => lines)).toBe(false);
    expect(existsSync(path)).toBe(false);
  });
});

describe("rewriteLinesIfChanged — kept lines survive byte-for-byte", () => {
  test("removing one LF line from a mixed-ending file preserves every other line's own ending", () => {
    const path = fixture(MIXED);

    const changed = rewriteLinesIfChanged(path, (lines) =>
      lines.filter((line) => line.trim() !== ".dev-process/"),
    );

    expect(changed).toBe(true);
    // Each surviving line keeps the exact terminator it arrived with — the
    // CRLF lines stay CRLF and the LF line stays LF.
    expect(readFileSync(path, "utf-8")).toBe("node_modules/\r\ndist/\r\n.env\n");
  });

  test("removing a CRLF line does not drag the LF lines to CRLF", () => {
    const path = fixture(MIXED);

    const changed = rewriteLinesIfChanged(path, (lines) =>
      lines.filter((line) => line.trim() !== "dist/"),
    );

    expect(changed).toBe(true);
    expect(readFileSync(path, "utf-8")).toBe("node_modules/\r\n.dev-process/\n.env\n");
  });

  test("a uniformly-CRLF file stays CRLF", () => {
    const path = fixture("a/\r\nb/\r\nc/\r\n");

    expect(rewriteLinesIfChanged(path, (lines) => lines.filter((l) => l.trim() !== "b/"))).toBe(
      true,
    );
    expect(readFileSync(path, "utf-8")).toBe("a/\r\nc/\r\n");
  });

  test("a uniformly-LF file stays LF", () => {
    const path = fixture("a/\nb/\nc/\n");

    expect(rewriteLinesIfChanged(path, (lines) => lines.filter((l) => l.trim() !== "b/"))).toBe(
      true,
    );
    expect(readFileSync(path, "utf-8")).toBe("a/\nc/\n");
  });

  test("a file with no trailing newline does not grow one", () => {
    const path = fixture("a/\nb/\nc/");

    expect(rewriteLinesIfChanged(path, (lines) => lines.filter((l) => l.trim() !== "b/"))).toBe(
      true,
    );
    expect(readFileSync(path, "utf-8")).toBe("a/\nc/");
  });
});

describe("readLines", () => {
  test("splits on either ending and returns null for an absent file", () => {
    expect(readLines(fixture(MIXED))).toEqual(["node_modules/", ".dev-process/", "dist/", ".env", ""]);
    expect(readLines(join(mkdtempSync(join(tmpdir(), "dpt-eol-")), "absent"))).toBeNull();
  });
});
