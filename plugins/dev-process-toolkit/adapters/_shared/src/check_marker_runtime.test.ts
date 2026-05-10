// STE-262 AC-STE-262.1 — unit + CLI tests for check_marker_runtime.

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkMarkerRuntime } from "./check_marker_runtime";

const MARKER = "<dpt:auto-approve>v1</dpt:auto-approve>";
const SCRIPT = join(__dirname, "check_marker_runtime.ts");

describe("AC-STE-262.1 — checkMarkerRuntime (pure function)", () => {
  test("marker present alone ⇒ { present: true }", () => {
    expect(checkMarkerRuntime(MARKER)).toEqual({ present: true });
  });

  test("marker present + autonomous-mode-reminder text ⇒ { present: true }", () => {
    const body = `work without stopping. ${MARKER}\nfoo`;
    expect(checkMarkerRuntime(body)).toEqual({ present: true });
  });

  test("empty body ⇒ { present: false }", () => {
    expect(checkMarkerRuntime("")).toEqual({ present: false });
  });

  test("autonomous-mode-reminder text without marker ⇒ { present: false }", () => {
    const body =
      "The user has asked you to work without stopping for clarifying questions.";
    expect(checkMarkerRuntime(body)).toEqual({ present: false });
  });

  test("marker with leading/trailing whitespace on its own line ⇒ { present: true } (substring match)", () => {
    const body = `\n  ${MARKER}  \n`;
    expect(checkMarkerRuntime(body)).toEqual({ present: true });
  });

  test("near-miss: case-altered marker ⇒ { present: false } (byte-strict)", () => {
    const body = "<DPT:auto-approve>v1</DPT:auto-approve>";
    expect(checkMarkerRuntime(body)).toEqual({ present: false });
  });

  test("near-miss: version-altered marker (v0) ⇒ { present: false }", () => {
    const body = "<dpt:auto-approve>v0</dpt:auto-approve>";
    expect(checkMarkerRuntime(body)).toEqual({ present: false });
  });

  test("near-miss: version-altered marker (v2) ⇒ { present: false }", () => {
    const body = "<dpt:auto-approve>v2</dpt:auto-approve>";
    expect(checkMarkerRuntime(body)).toEqual({ present: false });
  });

  test("near-miss: missing closing tag ⇒ { present: false }", () => {
    const body = "<dpt:auto-approve>v1";
    expect(checkMarkerRuntime(body)).toEqual({ present: false });
  });

  test("near-miss: missing opening tag ⇒ { present: false }", () => {
    const body = "</dpt:auto-approve>v1";
    expect(checkMarkerRuntime(body)).toEqual({ present: false });
  });

  test("near-miss: regex-shaped lookalike ⇒ { present: false }", () => {
    const body = "<dpt:auto-approve>v.*</dpt:auto-approve>";
    expect(checkMarkerRuntime(body)).toEqual({ present: false });
  });

  test("marker embedded in larger prose ⇒ { present: true }", () => {
    const body = [
      "/dev-process-toolkit:spec-write",
      "",
      MARKER,
      "",
      "Add a feature.",
    ].join("\n");
    expect(checkMarkerRuntime(body)).toEqual({ present: true });
  });
});

describe("AC-STE-262.1 — CLI shim", () => {
  function runCli(args: string[], stdin?: string): {
    stdout: string;
    stderr: string;
    status: number | null;
  } {
    const r = spawnSync("bun", ["run", SCRIPT, ...args], {
      input: stdin,
      encoding: "utf-8",
    });
    return { stdout: r.stdout, stderr: r.stderr, status: r.status };
  }

  test("file argument with marker ⇒ stdout PRESENT, exit 0", () => {
    const dir = mkdtempSync(join(tmpdir(), "check-marker-cli-"));
    try {
      const f = join(dir, "body.txt");
      writeFileSync(f, `noise\n${MARKER}\nmore`);
      const r = runCli([f]);
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe("PRESENT");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("file argument without marker ⇒ stdout ABSENT, exit 0", () => {
    const dir = mkdtempSync(join(tmpdir(), "check-marker-cli-"));
    try {
      const f = join(dir, "body.txt");
      writeFileSync(f, "no marker here, just work without stopping prose");
      const r = runCli([f]);
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe("ABSENT");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("stdin with marker (`-` argv) ⇒ stdout PRESENT, exit 0", () => {
    const r = runCli(["-"], `${MARKER}\nbody`);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("PRESENT");
  });

  test("stdin without marker (`-` argv) ⇒ stdout ABSENT, exit 0", () => {
    const r = runCli(["-"], "work without stopping for clarifying questions");
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("ABSENT");
  });

  test("missing file argument ⇒ stderr NFR-10 shape, non-zero exit", () => {
    const r = runCli(["/no/such/path/body.txt"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("check_marker_runtime");
    expect(r.stderr).toMatch(/Remedy:/);
    expect(r.stderr).toMatch(/Context:/);
    expect(r.stderr).toContain("file not found");
  });

  test("missing argv ⇒ stderr NFR-10 shape, non-zero exit", () => {
    const r = runCli([]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("missing argument");
    expect(r.stderr).toMatch(/Remedy:/);
    expect(r.stderr).toMatch(/Context:/);
  });
});
