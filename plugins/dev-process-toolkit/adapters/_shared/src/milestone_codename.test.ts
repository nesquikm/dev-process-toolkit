// STE-657 — plans carry a validated codename composed at spec time.
//
// AC-STE-657.1: validateCodename — CHANGELOG-derived accept set + six rejects.
// AC-STE-657.2: readPlanCodename — value / absent / literal null / invalid.
// AC-STE-657.3: the command front door — one stdout line, or the NFR-10
//               envelope on stderr with exit 1.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CODENAME_MAX, readPlanCodename, validateCodename } from "./milestone_codename";

const MODULE_PATH = resolve(import.meta.dir, "milestone_codename.ts");
const PLUGIN_ROOT = resolve(import.meta.dir, "..", "..", "..");
const REPO_ROOT = resolve(PLUGIN_ROOT, "..", "..");
const CHANGELOG = join(REPO_ROOT, "CHANGELOG.md");

/** Read every codename from the `## [X.Y.Z] — date — "Codename"` headers, at test time. */
function changelogCodenames(): string[] {
  const header = /^## \[(\d+\.\d+\.\d+)\] — (\S+) — "([^"]+)"\s*$/;
  const out: string[] = [];
  for (const line of readFileSync(CHANGELOG, "utf8").split("\n")) {
    const m = header.exec(line);
    if (m) out.push(m[3]!);
  }
  return out;
}

function reasonOf(value: string): string {
  const r = validateCodename(value) as { ok: boolean; reason?: string };
  expect(r.ok).toBe(false);
  expect(typeof r.reason).toBe("string");
  return r.reason as string;
}

describe("AC-STE-657.1 validateCodename", () => {
  test("CODENAME_MAX is 32", () => {
    expect(CODENAME_MAX).toBe(32);
  });

  test("accepts every codename in this repo's CHANGELOG headers (set read at test time, non-empty)", () => {
    const names = changelogCodenames();
    // Control against a zero-hit read: a broken regex or path would make the loop vacuous.
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      const r = validateCodename(name) as { ok: boolean; value?: string; reason?: string };
      expect({ name, ok: r.ok, reason: r.reason }).toEqual({ name, ok: true, reason: undefined });
      expect(r.value).toBe(name);
    }
  });

  test("accepts exactly 32 characters and returns the trimmed value", () => {
    const thirtyTwo = "A".repeat(32);
    expect(validateCodename(thirtyTwo)).toEqual({ ok: true, value: thirtyTwo });
    expect(validateCodename("  Own Side Only  ")).toEqual({ ok: true, value: "Own Side Only" });
  });

  test('rejects "" naming the empty rule', () => {
    expect(reasonOf("")).toMatch(/empty/i);
  });

  test("rejects a whitespace-only value naming the empty rule", () => {
    expect(reasonOf("   \t ")).toMatch(/empty/i);
  });

  test("rejects a 33-character value naming the 32-character limit", () => {
    const reason = reasonOf("B".repeat(33));
    expect(reason).toMatch(/32/);
    expect(reason).not.toMatch(/backtick|line break|empty/i);
  });

  test("rejects a value containing a backtick naming the backtick rule", () => {
    const reason = reasonOf("Bad `tick` Name");
    expect(reason).toMatch(/backtick/i);
    expect(reason).not.toMatch(/line break|empty/i);
  });

  test("rejects a value containing \\n naming the line-break rule", () => {
    const reason = reasonOf("Two\nLines");
    expect(reason).toMatch(/line break/i);
    expect(reason).not.toMatch(/backtick|empty/i);
  });

  test("rejects a value containing \\r naming the line-break rule", () => {
    const reason = reasonOf("Two\rLines");
    expect(reason).toMatch(/line break/i);
    expect(reason).not.toMatch(/backtick|empty/i);
  });
});

let dir: string;

function plan(name: string, frontmatterExtra: string | null): string {
  const lines = [
    "---",
    "milestone: M_abc123",
    "status: active",
    "archived_at: null",
    "kickoff_branch: null",
    "frozen_at: null",
    "migration: none",
  ];
  if (frontmatterExtra !== null) lines.push(frontmatterExtra);
  lines.push("---", "", "## M_abc123 — Test Plan {#M_abc123}", "");
  const p = join(dir, name);
  writeFileSync(p, lines.join("\n"));
  return p;
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "ste-657-codename-"));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("AC-STE-657.2 readPlanCodename", () => {
  test("returns the codename: value", () => {
    const p = plan("value.md", "codename: Own Side Only");
    expect(readPlanCodename(p)).toBe("Own Side Only");
  });

  test("returns null when the key is absent", () => {
    const p = plan("absent.md", null);
    expect(readPlanCodename(p)).toBeNull();
  });

  test("returns null when the value is the literal null", () => {
    const p = plan("null.md", "codename: null");
    expect(readPlanCodename(p)).toBeNull();
  });

  test("throws an NFR-10 error naming the plan path and the broken rule on a too-long value", () => {
    const p = plan("long.md", `codename: ${"C".repeat(33)}`);
    let message = "";
    try {
      readPlanCodename(p);
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message).not.toBe("");
    expect(message).toContain(p);
    // Strip the path first: a random temp-dir suffix may itself contain "32".
    expect(message.split(p).join("<plan>")).toMatch(/32/);
    expect(message).toMatch(/^Remedy: /m);
    expect(message).toMatch(/^Context: /m);
  });

  test("throws an NFR-10 error naming the plan path and the backtick rule", () => {
    const p = plan("tick.md", "codename: Bad `tick`");
    let message = "";
    try {
      readPlanCodename(p);
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message).toContain(p);
    expect(message).toMatch(/backtick/i);
    expect(message).toMatch(/^Remedy: /m);
    expect(message).toMatch(/^Context: /m);
  });
});

function frontDoor(planPath: string) {
  const r = Bun.spawnSync([process.execPath, "run", MODULE_PATH, planPath], {
    cwd: PLUGIN_ROOT,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 60_000,
  });
  return {
    exitCode: r.exitCode,
    stdout: r.stdout.toString(),
    stderr: r.stderr.toString(),
  };
}

describe("AC-STE-657.3 front door", () => {
  test(
    "prints exactly codename=<value> and exits 0",
    () => {
      const p = plan("door-value.md", "codename: Checked Routes");
      const r = frontDoor(p);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toBe("codename=Checked Routes\n");
    },
    90_000,
  );

  test(
    "prints exactly codename=absent when the key is absent, and exits 0",
    () => {
      const p = plan("door-absent.md", null);
      const r = frontDoor(p);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toBe("codename=absent\n");
    },
    90_000,
  );

  test(
    "prints exactly codename=absent on the literal null, and exits 0",
    () => {
      const p = plan("door-null.md", "codename: null");
      const r = frontDoor(p);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toBe("codename=absent\n");
    },
    90_000,
  );

  test(
    "on an invalid value: NFR-10 envelope on stderr, nothing on stdout, exit 1",
    () => {
      const p = plan("door-invalid.md", "codename: Bad `tick`");
      const r = frontDoor(p);
      expect(r.exitCode).toBe(1);
      expect(r.stdout).toBe("");
      expect(r.stderr).toContain(p);
      expect(r.stderr).toMatch(/backtick/i);
      expect(r.stderr).toMatch(/^Remedy: /m);
      expect(r.stderr).toMatch(/^Context: /m);
    },
    90_000,
  );
});

// ---------------------------------------------------------------------------
// M_6c25dd Phase 3 hardening (review findings on AC-STE-657.1/.2/.3/.5).
// ---------------------------------------------------------------------------

describe("hardening — a line break anywhere is refused, trailing ones included", () => {
  test("a trailing \\n or \\r is refused, not trimmed away", () => {
    expect(reasonOf("Foo\n")).toMatch(/line break/i);
    expect(reasonOf("Foo\r")).toMatch(/line break/i);
    expect(reasonOf("\nFoo")).toMatch(/line break/i);
  });

  test("control: surrounding spaces are still trimmed", () => {
    expect(validateCodename("  Foo  ")).toEqual({ ok: true, value: "Foo" });
  });
});

describe("hardening — a YAML inline comment is not part of the value", () => {
  test("`codename: Foo  # note` reads as Foo", () => {
    expect(readPlanCodename(plan("comment-value.md", "codename: Foo  # note"))).toBe("Foo");
  });

  test("`codename: null  # note` reads as absent", () => {
    expect(readPlanCodename(plan("comment-null.md", "codename: null  # replace"))).toBeNull();
  });

  test("a quoted value followed by a comment reads as the value inside the quotes", () => {
    expect(readPlanCodename(plan("quoted-comment-dq.md", 'codename: "Foo" # c'))).toBe("Foo");
    expect(readPlanCodename(plan("quoted-comment-sq.md", "codename: 'It''s' # c"))).toBe("It's");
  });

  test("a quoted value keeps a ` #` that is inside the quotes", () => {
    expect(readPlanCodename(plan("comment-quoted.md", 'codename: "A #B"'))).toBe("A #B");
  });

  test("the shipped plan template's codename line reads as absent, never as a codename", () => {
    const template = readFileSync(join(PLUGIN_ROOT, "templates", "spec-templates", "plan.md.template"), "utf8");
    const line = template.split("\n").find((l) => /^codename\s*:/.test(l));
    expect(line, "the template carries a codename: line").toBeDefined();
    expect(readPlanCodename(plan("from-template.md", line!))).toBeNull();
  });
});

function checkDoor(value: string) {
  const r = Bun.spawnSync([process.execPath, "run", MODULE_PATH, "--check", value], {
    cwd: PLUGIN_ROOT,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 60_000,
  });
  return { exitCode: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
}

describe("hardening — `--check <value>` validates a codename before any plan is written", () => {
  test(
    "a valid value prints codename=<trimmed value> and exits 0",
    () => {
      const r = checkDoor("  Lantern Hall ");
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toBe("codename=Lantern Hall\n");
    },
    90_000,
  );

  test(
    "an invalid value prints the NFR-10 envelope on stderr, nothing on stdout, exit 1",
    () => {
      const r = checkDoor("x".repeat(33));
      expect(r.exitCode).toBe(1);
      expect(r.stdout).toBe("");
      expect(r.stderr).toMatch(/32/);
      expect(r.stderr).toMatch(/^Remedy: /m);
      expect(r.stderr).toMatch(/^Context: /m);
    },
    90_000,
  );
});
