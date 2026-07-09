// Unit tests for selectIncidentSession — STE-374 AC-STE-374.1 (+ AC-STE-374.7).
//
// `selectIncidentSession(cwdSlugDir, markers, opts?)` lists the K most-recent
// `*.jsonl` files (by mtime, descending) in the slug directory, greps each
// candidate's content for any of the incident `markers`, and returns
// `{ path, matched }`:
//   - the FIRST (most-recent) candidate whose content contains a marker →
//     `{ path: <that file>, matched: true }`;
//   - if NO candidate within the K-window matches → the most-recent-mtime
//     file with `matched: false` (the explicit mtime fallback);
//   - empty/absent directory → the sentinel `{ path: null, matched: false }`.
// When more than K candidates exist and the scan window truncates, the
// truncation is surfaced observably (`truncated: true`).
//
// Fixture pattern mirrors tests/find_current_session — mkdtempSync slug dir +
// utimesSync-controlled mtimes so the ordering is deterministic.

import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { selectIncidentSession } from "../adapters/_shared/src/report_issue_session_select";

const MARKER = "deps-research";

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length > 0) {
    rmSync(dirs.pop()!, { recursive: true, force: true });
  }
});

function makeSlugDir(): string {
  const d = mkdtempSync(join(tmpdir(), "incident-select-"));
  dirs.push(d);
  return d;
}

/** Plant a JSONL (or arbitrary-extension) file with a controlled mtime. */
function plant(
  dir: string,
  name: string,
  content: string,
  ageSecondsAgo: number,
): string {
  const path = join(dir, name);
  writeFileSync(path, content);
  const t = Date.now() / 1000 - ageSecondsAgo;
  utimesSync(path, t, t);
  return path;
}

const withMarker = `{"type":"tool_use","name":"Skill","input":{"skill":"${MARKER}"}}\n`;
const noMarker = `{"type":"tool_use","name":"Skill","input":{"skill":"spec-write"}}\n`;

describe("selectIncidentSession — empty / absent directory sentinel", () => {
  test("returns { path: null, matched: false } when the slug directory is absent", () => {
    const missing = join(makeSlugDir(), "does-not-exist");
    const result = selectIncidentSession(missing, [MARKER]);
    expect(result.path).toBeNull();
    expect(result.matched).toBe(false);
  });

  test("returns { path: null, matched: false } when the directory has no JSONL", () => {
    const dir = makeSlugDir();
    // Only non-JSONL noise present.
    plant(dir, "ignore.txt", withMarker, 5);
    const result = selectIncidentSession(dir, [MARKER]);
    expect(result.path).toBeNull();
    expect(result.matched).toBe(false);
  });
});

describe("selectIncidentSession — marker-matched selection over recent candidates", () => {
  test("newest session lacks the incident, an older one contains it → older selected, matched=true", () => {
    const dir = makeSlugDir();
    const newest = plant(dir, "newest.jsonl", noMarker, 5);
    const older = plant(dir, "older.jsonl", withMarker, 600);
    const result = selectIncidentSession(dir, [MARKER]);
    expect(result.path).toBe(older);
    expect(result.path).not.toBe(newest);
    expect(result.matched).toBe(true);
    expect(result.truncated).toBeFalsy();
  });

  test("the most-recent matching candidate wins when several contain a marker", () => {
    const dir = makeSlugDir();
    const recentMatch = plant(dir, "recent.jsonl", withMarker, 5);
    plant(dir, "older-match.jsonl", withMarker, 60);
    plant(dir, "no-match.jsonl", noMarker, 120);
    const result = selectIncidentSession(dir, [MARKER]);
    expect(result.path).toBe(recentMatch);
    expect(result.matched).toBe(true);
  });

  test("multi-marker is a UNION — a candidate matching any marker is selected", () => {
    const dir = makeSlugDir();
    const hit = plant(dir, "session.jsonl", withMarker, 5);
    const result = selectIncidentSession(dir, ["absent-marker-xyz", MARKER]);
    expect(result.path).toBe(hit);
    expect(result.matched).toBe(true);
  });

  test("non-JSONL files are ignored even when newer and marker-bearing", () => {
    const dir = makeSlugDir();
    const session = plant(dir, "session.jsonl", withMarker, 600);
    // Newer noise that also contains the marker — must be ignored.
    plant(dir, "noise.log", withMarker, 5);
    const result = selectIncidentSession(dir, [MARKER]);
    expect(result.path).toBe(session);
    expect(result.matched).toBe(true);
  });
});

describe("selectIncidentSession — mtime fallback when nothing matches", () => {
  test("no candidate matches → most-recent-mtime file, matched=false", () => {
    const dir = makeSlugDir();
    const newest = plant(dir, "newest.jsonl", noMarker, 5);
    plant(dir, "middle.jsonl", noMarker, 60);
    plant(dir, "oldest.jsonl", noMarker, 120);
    const result = selectIncidentSession(dir, [MARKER]);
    expect(result.path).toBe(newest);
    expect(result.matched).toBe(false);
  });
});

describe("selectIncidentSession — bounded K-window + observable truncation", () => {
  test("marker outside the default K=5 window → mtime fallback + truncated=true", () => {
    const dir = makeSlugDir();
    const newest = plant(dir, "s0.jsonl", noMarker, 5);
    plant(dir, "s1.jsonl", noMarker, 10);
    plant(dir, "s2.jsonl", noMarker, 15);
    plant(dir, "s3.jsonl", noMarker, 20);
    plant(dir, "s4.jsonl", noMarker, 25);
    plant(dir, "s5.jsonl", noMarker, 30);
    // Incident lives in the oldest file — outside the 5 most-recent window.
    plant(dir, "s6.jsonl", withMarker, 35);
    const result = selectIncidentSession(dir, [MARKER]);
    expect(result.path).toBe(newest);
    expect(result.matched).toBe(false);
    // The window truncated (7 candidates, K=5) — surfaced observably.
    expect(result.truncated).toBe(true);
  });

  test("honors the opts.k override — a match outside a narrowed window is not found", () => {
    const dir = makeSlugDir();
    const newest = plant(dir, "a.jsonl", noMarker, 5);
    plant(dir, "b.jsonl", noMarker, 60);
    const marked = plant(dir, "c.jsonl", withMarker, 120);

    // Default K (>= 3) reaches the oldest file → matched.
    const wide = selectIncidentSession(dir, [MARKER]);
    expect(wide.path).toBe(marked);
    expect(wide.matched).toBe(true);

    // Narrowed K=2 excludes the marked oldest file → fallback + truncated.
    const narrow = selectIncidentSession(dir, [MARKER], { k: 2 });
    expect(narrow.path).toBe(newest);
    expect(narrow.matched).toBe(false);
    expect(narrow.truncated).toBe(true);
  });
});
