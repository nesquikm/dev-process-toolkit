// STE-677 — session lookup finds transcripts under dotted and long paths.
//
// Claude Code names a project folder by replacing EVERY character outside
// `[A-Za-z0-9]` with `-` (not only `/`), and cuts a slug longer than 200
// characters to its first 200 plus a `-<hash>` suffix computed over the
// ORIGINAL cwd. Because that rule is lossy, two different cwds (`/w/a.b` and
// `/w/a-b`) share one folder, so a candidate transcript only counts when its
// first recorded `cwd` equals the requested one.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cwdToSlug, findCurrentSession, firstRecordedCwd } from "../adapters/_shared/src/find_current_session";
import { selectIncidentSession } from "../adapters/_shared/src/report_issue_session_select";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const read = (rel: string) => readFileSync(join(PLUGIN_ROOT, rel), "utf-8");

// -----------------------------------------------------------------------------
// AC-STE-677.1 — the character rule.
// -----------------------------------------------------------------------------

describe("AC-STE-677.1 — cwdToSlug replaces every non-alphanumeric character", () => {
  test("dotted-path rule: `/a.b` → `-a-b` (the slash-only rule yields `-a.b`)", () => {
    expect(cwdToSlug("/a.b")).toBe("-a-b");
  });

  test("underscore: `/x/app_platform` → `-x-app-platform`", () => {
    expect(cwdToSlug("/x/app_platform")).toBe("-x-app-platform");
  });

  test("space: `/a b` → `-a-b`", () => {
    expect(cwdToSlug("/a b")).toBe("-a-b");
  });

  test("dot-directory: `/w/b/.s11/r` → `-w-b--s11-r`", () => {
    expect(cwdToSlug("/w/b/.s11/r")).toBe("-w-b--s11-r");
  });

  test("non-ASCII and mixed punctuation each become `-`", () => {
    expect(cwdToSlug("/a/ü x")).toBe("-a---x");
    expect(cwdToSlug("/p/q~r+s@t")).toBe("-p-q-r-s-t");
  });

  test("the existing examples still hold", () => {
    expect(cwdToSlug("/Users/foo/bar")).toBe("-Users-foo-bar");
    expect(cwdToSlug("/")).toBe("-");
    expect(cwdToSlug("/Users/ns/workspace/dev-process-toolkit")).toBe(
      "-Users-ns-workspace-dev-process-toolkit",
    );
  });
});

// -----------------------------------------------------------------------------
// AC-STE-677.2 — the 200-character cap with Claude Code's hash suffix.
// -----------------------------------------------------------------------------

describe("AC-STE-677.2 — slugs over 200 characters are cut and hash-suffixed", () => {
  // 237 characters. Value observed by executing the project-dir rule extracted
  // verbatim (via `strings`) from the installed Claude Code 2.1.301 binary —
  // provenance recorded in specs/frs/STE-677.md Notes. Pinned literally; NOT
  // recomputed with a copy of the algorithm.
  const LONG_CWD = "/Users/someone/workspace/" + "very-long-directory-name.with_dots".repeat(6) + "/project";
  const LONG_SLUG =
    "-Users-someone-workspace-very-long-directory-name-with-dotsvery-long-directory-name-with-dotsvery-long-directory-name-with-dotsvery-long-directory-name-with-dotsvery-long-directory-name-with-dotsvery--cr4qct";

  test("fixture cwd is over 200 characters", () => {
    expect(LONG_CWD.length).toBe(237);
  });

  test("long cwd maps to the value Claude Code 2.1.301 writes", () => {
    expect(cwdToSlug(LONG_CWD)).toBe(LONG_SLUG);
  });

  test("the suffix hashes the ORIGINAL cwd: a dash-only twin shares the 200-char prefix but not the suffix", () => {
    const twin = LONG_CWD.replace(/[._]/g, "-");
    const a = cwdToSlug(LONG_CWD);
    const b = cwdToSlug(twin);
    expect(a.slice(0, 201)).toBe(b.slice(0, 201));
    expect(a).not.toBe(b);
  });

  test("a slug of exactly 200 characters is not cut", () => {
    const cwd = "/" + "a".repeat(199);
    expect(cwdToSlug(cwd)).toBe("-" + "a".repeat(199));
    expect(cwdToSlug(cwd).length).toBe(200);
  });
});

// -----------------------------------------------------------------------------
// AC-STE-677.3 — collision fixture: two cwds, one folder.
// -----------------------------------------------------------------------------

function plant(
  configDir: string,
  folder: string,
  name: string,
  lines: unknown[],
  ageSecondsAgo: number,
): string {
  const dir = join(configDir, "projects", folder);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  const t = Date.now() / 1000 - ageSecondsAgo;
  utimesSync(path, t, t);
  return path;
}

describe("AC-STE-677.3 — collision fixture: candidates must record the requested cwd", () => {
  let configDir: string;
  const FOLDER = "-w-a-b"; // shared by `/w/a.b` and `/w/a-b`
  let dotted: string;
  let dashed: string;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), "ste677-config-"));
    // The dotted session is NEWER, so an mtime-only pick returns it for both cwds.
    dotted = plant(
      configDir,
      FOLDER,
      "dotted.jsonl",
      [
        { type: "summary", summary: "no cwd on this line" },
        { type: "user", cwd: "/w/a.b", message: "INCIDENT-MARKER dotted" },
      ],
      10,
    );
    dashed = plant(
      configDir,
      FOLDER,
      "dashed.jsonl",
      [
        { type: "user", cwd: "/w/a-b", message: "INCIDENT-MARKER dashed" },
        { type: "assistant", cwd: "/w/a.b" },
      ],
      100,
    );
  });

  afterEach(() => rmSync(configDir, { recursive: true, force: true }));

  test("both cwds resolve to the same folder (the precondition of the collision)", () => {
    expect(cwdToSlug("/w/a.b")).toBe(FOLDER);
    expect(cwdToSlug("/w/a-b")).toBe(FOLDER);
  });

  test("findCurrentSession returns the session that records the requested cwd (collision fixture)", () => {
    expect(findCurrentSession("/w/a-b", configDir)).toBe(dashed);
    expect(findCurrentSession("/w/a.b", configDir)).toBe(dotted);
  });

  test("findCurrentSession judges by the FIRST recorded cwd, not a later one", () => {
    // dashed.jsonl's second line carries `/w/a.b`, but its first recorded cwd
    // is `/w/a-b`; make it newest so only the first-cwd rule rejects it.
    const t = Date.now() / 1000;
    utimesSync(dashed, t, t);
    expect(findCurrentSession("/w/a.b", configDir)).toBe(dotted);
  });

  test("findCurrentSession returns null when no candidate records the requested cwd", () => {
    rmSync(dashed);
    expect(findCurrentSession("/w/a-b", configDir)).toBeNull();
  });

  test("selectIncidentSession({ cwd }) skips a marker-matching transcript from the other cwd (collision fixture)", () => {
    const dir = join(configDir, "projects", FOLDER);
    const sel = selectIncidentSession(dir, ["INCIDENT-MARKER"], { cwd: "/w/a-b" });
    expect(sel.path).toBe(dashed);
    expect(sel.matched).toBe(true);
  });

  test("selectIncidentSession({ cwd }) mtime fallback also skips the other cwd", () => {
    const dir = join(configDir, "projects", FOLDER);
    const sel = selectIncidentSession(dir, ["NO-SUCH-MARKER"], { cwd: "/w/a-b" });
    expect(sel.path).toBe(dashed);
    expect(sel.matched).toBe(false);
  });

  test("selectIncidentSession({ cwd }) returns null when none remains", () => {
    rmSync(dashed);
    const dir = join(configDir, "projects", FOLDER);
    const sel = selectIncidentSession(dir, ["INCIDENT-MARKER"], { cwd: "/w/a-b" });
    expect(sel.path).toBeNull();
    expect(sel.matched).toBe(false);
  });

  test("selectIncidentSession without `cwd` keeps its old behaviour (backward compatible)", () => {
    const dir = join(configDir, "projects", FOLDER);
    const sel = selectIncidentSession(dir, ["INCIDENT-MARKER"]);
    expect(sel.path).toBe(dotted);
    expect(sel.matched).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// AC-STE-677.4 — docs and comments state the new rule.
// -----------------------------------------------------------------------------

describe("AC-STE-677.4 — the skill text and helper comments state the new rule", () => {
  test("report-issue SKILL.md no longer states the slash-only rule", () => {
    const body = read("skills/report-issue/SKILL.md");
    expect(body).not.toMatch(/every\s+`?\/`?\s+replac\w+\s+(by|with)\s+`?-`?/i);
  });

  test("report-issue SKILL.md states the new rule or names cwdToSlug as its source", () => {
    const body = read("skills/report-issue/SKILL.md");
    expect(body).toMatch(/`cwdToSlug`|every character (that is )?(not a letter or digit|outside `?\[A-Za-z0-9\]`?)/i);
  });

  test("find_current_session.ts comments no longer describe the slash-only rule", () => {
    const src = read("adapters/_shared/src/find_current_session.ts");
    expect(src).not.toContain("(`/` → `-`)");
    expect(src).not.toMatch(/Every `\/` is replaced with `-`/);
  });
});

// -----------------------------------------------------------------------------
// AC-STE-677.5 — one rule: the copies call the shared helper.
// -----------------------------------------------------------------------------

describe("AC-STE-677.5 — slug helpers call the shared cwdToSlug", () => {
  const PRIVATE_SLUG = /\.replace\(\s*\/\[\^(A-Za-z0-9|a-zA-Z0-9)\]\/g/;

  for (const rel of ["tests/_live_bundle_fixtures.ts", "adapters/_shared/src/shared_tracker_live_grader.ts"]) {
    test(`${rel} imports and calls cwdToSlug`, () => {
      const src = read(rel);
      expect(src).toMatch(/import\s*\{[^}]*\bcwdToSlug\b[^}]*\}\s*from\s*["'][^"']*find_current_session(\.ts)?["']/);
      expect(src).toMatch(/\bcwdToSlug\s*\(/);
    });

    test(`${rel} carries no private [^A-Za-z0-9] slug replacement`, () => {
      expect(read(rel)).not.toMatch(PRIVATE_SLUG);
    });
  }
});

// ---------------------------------------------------------------------------
// Phase 3 review — the cwd is read from a bounded prefix, not the whole file.
// Transcripts run to hundreds of MB, and every candidate in the folder is
// checked, so the reader must stop at the first record carrying a cwd.
// ---------------------------------------------------------------------------

describe("firstRecordedCwd reads a bounded prefix", () => {
  test("a cwd line after a first line longer than one read chunk is still found", () => {
    const dir = mkdtempSync(join(tmpdir(), "ste-677-prefix-"));
    try {
      const p = join(dir, "s.jsonl");
      const big = JSON.stringify({ type: "summary", text: "x".repeat(300_000) });
      writeFileSync(p, `${big}\n${JSON.stringify({ type: "user", cwd: "/w/a.b" })}\n`);
      expect(firstRecordedCwd(p)).toBe("/w/a.b");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a cwd that first appears past the read cap is not looked for (kept as unrecorded)", () => {
    const dir = mkdtempSync(join(tmpdir(), "ste-677-prefix-"));
    try {
      const p = join(dir, "s.jsonl");
      const filler = JSON.stringify({ type: "summary", text: "y".repeat(1_000_000) }) + "\n";
      writeFileSync(p, filler.repeat(9) + JSON.stringify({ type: "user", cwd: "/w/late" }) + "\n");
      expect(firstRecordedCwd(p)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
