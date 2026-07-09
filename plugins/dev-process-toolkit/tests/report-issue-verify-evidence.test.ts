// Unit tests for verifyIncidentEvidence — STE-374 AC-STE-374.3 (+ AC-STE-374.7).
//
// `verifyIncidentEvidence(transcriptPath, markers)` greps the transcript file
// for the incident markers and returns `{ searched, found, markers }`:
//   - `found` = true iff >= 1 marker appears in the transcript (multi-marker is
//     a UNION — any match wins);
//   - `searched` reflects whether the search actually ran (true when the path is
//     readable; false when the path is null / unreadable);
//   - `markers` echoes the searched marker list.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyIncidentEvidence } from "../adapters/_shared/src/report_issue_verify_evidence";

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length > 0) {
    rmSync(dirs.pop()!, { recursive: true, force: true });
  }
});

function writeTranscript(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "verify-evidence-"));
  dirs.push(dir);
  const path = join(dir, "transcript.jsonl");
  writeFileSync(path, content);
  return path;
}

const bodyWith = (marker: string) =>
  `{"type":"tool_use","name":"Skill","input":{"skill":"${marker}"}}\n` +
  `{"type":"tool_result","content":"ran ${marker} fork"}\n`;

describe("verifyIncidentEvidence — marker present / absent", () => {
  test("markers present in the transcript → searched=true, found=true", () => {
    const path = writeTranscript(bodyWith("deps-research"));
    const result = verifyIncidentEvidence(path, ["deps-research"]);
    expect(result.searched).toBe(true);
    expect(result.found).toBe(true);
  });

  test("markers absent from the transcript → searched=true, found=false", () => {
    const path = writeTranscript(bodyWith("spec-write"));
    const result = verifyIncidentEvidence(path, ["deps-research"]);
    expect(result.searched).toBe(true);
    expect(result.found).toBe(false);
  });
});

describe("verifyIncidentEvidence — multi-marker UNION", () => {
  test("any one marker matching yields found=true", () => {
    const path = writeTranscript(bodyWith("deps-research"));
    const result = verifyIncidentEvidence(path, [
      "never-appears-marker",
      "deps-research",
    ]);
    expect(result.found).toBe(true);
  });

  test("no marker matching yields found=false", () => {
    const path = writeTranscript(bodyWith("gate-check"));
    const result = verifyIncidentEvidence(path, ["deps-research", "spec-write"]);
    expect(result.found).toBe(false);
  });
});

describe("verifyIncidentEvidence — echoes the searched marker list", () => {
  test("markers field returns the input list verbatim", () => {
    const path = writeTranscript(bodyWith("deps-research"));
    const markers = ["deps-research", "spec-write"];
    const result = verifyIncidentEvidence(path, markers);
    expect(result.markers).toEqual(markers);
  });
});

describe("verifyIncidentEvidence — unreadable / null path", () => {
  test("null transcript path → searched=false, found=false, markers echoed", () => {
    const markers = ["deps-research"];
    const result = verifyIncidentEvidence(null, markers);
    expect(result.searched).toBe(false);
    expect(result.found).toBe(false);
    expect(result.markers).toEqual(markers);
  });

  test("nonexistent transcript path → searched=false, found=false", () => {
    const dir = mkdtempSync(join(tmpdir(), "verify-evidence-missing-"));
    dirs.push(dir);
    const missing = join(dir, "no-such-transcript.jsonl");
    const result = verifyIncidentEvidence(missing, ["deps-research"]);
    expect(result.searched).toBe(false);
    expect(result.found).toBe(false);
  });
});
