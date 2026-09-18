// STE-290 AC.1, AC.4, AC.6 — `templates/hooks/_lib/session.ts` library contract.
//
// The byte-checkable enforcement layer (STE-285, M71) was inert because
// `_lib/session.sh` read `$CLAUDE_SESSION_FILE` — an env var the Claude Code
// harness never sets. STE-290 ports the helper to a Bun TS library that
// reads `transcript_path` from the stdin JSON payload instead.
//
// This file covers:
//   AC.1 — parseHookPayload + requireSkillToolUse + emitNFR10 contracts.
//   AC.4 — `_lib/session.sh` deletion + no `$CLAUDE_SESSION_FILE` /
//          `session.sh` references anywhere under templates/hooks/.
//   AC.6 — NFR-10 stderr byte-stability per STE-286 §104.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { readSpecFile } from "./_spec_tree";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const PLUGIN_ROOT = join(REPO_ROOT, "plugins", "dev-process-toolkit");
const HOOKS_DIR = join(PLUGIN_ROOT, "templates", "hooks");
const LIB_TS = join(HOOKS_DIR, "_lib", "session.ts");
const LIB_SH = join(HOOKS_DIR, "_lib", "session.sh");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "ste-290-lib-"));
});

afterEach(() => {
  if (tmpRoot && existsSync(tmpRoot)) {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

function writeTranscript(entries: unknown[]): string {
  const file = join(tmpRoot, "transcript.jsonl");
  writeFileSync(
    file,
    entries.map((e) => JSON.stringify(e)).join("\n") + "\n",
  );
  return file;
}

/**
 * Walk every file under templates/hooks/ and return a list of paths whose
 * content matches the given pattern. Excludes the `_lib/session.ts`
 * library itself (callers may legitimately reference the legacy name in
 * a deletion-conformance test, though we don't currently).
 */
function grepUnder(
  root: string,
  pattern: RegExp,
  exclude: Set<string> = new Set(),
): string[] {
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        walk(full);
      } else if (st.isFile()) {
        const rel = relative(root, full);
        if (exclude.has(rel)) continue;
        const body = readFileSync(full, "utf-8");
        if (pattern.test(body)) {
          hits.push(rel);
        }
      }
    }
  };
  walk(root);
  return hits;
}

// ---------------------------------------------------------------------------
// AC.1 — parseHookPayload
// ---------------------------------------------------------------------------

describe("AC-STE-290.1 — parseHookPayload: happy path", () => {
  test("parses a complete hook payload and surfaces transcript_path", async () => {
    const mod = await import(LIB_TS);
    const transcript = writeTranscript([]);
    const stdin = JSON.stringify({
      session_id: "sess-123",
      transcript_path: transcript,
      cwd: "/tmp",
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "git commit -m wip" },
      tool_use_id: "use-1",
    });
    const payload = mod.parseHookPayload(stdin);
    expect(payload).not.toBeNull();
    expect(payload.transcript_path).toBe(transcript);
    expect(payload.session_id).toBe("sess-123");
    expect(payload.tool_input?.command).toBe("git commit -m wip");
  });
});

describe("AC-STE-290.1 — parseHookPayload: fail-open variants return null", () => {
  test("empty stdin returns null", async () => {
    const mod = await import(LIB_TS);
    expect(mod.parseHookPayload("")).toBeNull();
  });

  test("whitespace-only stdin returns null", async () => {
    const mod = await import(LIB_TS);
    expect(mod.parseHookPayload("   \n\t  ")).toBeNull();
  });

  test("malformed JSON stdin returns null", async () => {
    const mod = await import(LIB_TS);
    expect(mod.parseHookPayload("{not-json")).toBeNull();
  });

  test("JSON missing transcript_path returns null", async () => {
    const mod = await import(LIB_TS);
    const stdin = JSON.stringify({ session_id: "x", cwd: "/tmp" });
    expect(mod.parseHookPayload(stdin)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC.1 — requireSkillToolUse
// ---------------------------------------------------------------------------

describe("AC-STE-290.1 — requireSkillToolUse: hit", () => {
  test("Skill tool_use for the named skill on a single JSONL line → found=true", async () => {
    const mod = await import(LIB_TS);
    const transcript = writeTranscript([
      {
        type: "tool_use",
        name: "Skill",
        input: { skill: "dev-process-toolkit:gate-check" },
      },
    ]);
    const result = mod.requireSkillToolUse(
      "dev-process-toolkit:gate-check",
      "pre-commit-gate-check",
      { transcript_path: transcript } as never,
    );
    expect(result.found).toBe(true);
  });
});

describe("AC-STE-290.1 — requireSkillToolUse: miss", () => {
  test("no Skill tool_use anywhere → found=false + NFR-10 stderr", async () => {
    const mod = await import(LIB_TS);
    const transcript = writeTranscript([
      { type: "tool_use", name: "Bash", input: { command: "ls" } },
    ]);

    // Capture stderr writes during the call.
    const captured: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: unknown) => {
      captured.push(typeof chunk === "string" ? chunk : String(chunk));
      return true;
    }) as typeof process.stderr.write;
    try {
      const result = mod.requireSkillToolUse(
        "dev-process-toolkit:gate-check",
        "pre-commit-gate-check",
        { transcript_path: transcript } as never,
      );
      expect(result.found).toBe(false);
    } finally {
      process.stderr.write = origWrite;
    }
    const joined = captured.join("");
    expect(joined).toContain("Refusing:");
    expect(joined).toContain("Remedy:");
    expect(joined).toContain("Context:");
    expect(joined).toContain("dev-process-toolkit:gate-check");
    expect(joined).toContain("pre-commit-gate-check");
  });

  test("Skill tool_use exists for a DIFFERENT skill → found=false (atomic-line invariant)", async () => {
    // STE-285's atomic-line invariant: "name":"Skill" and "skill":"<name>"
    // must appear on the same JSONL line. A Skill tool_use for skill A
    // must not satisfy a require for skill B.
    const mod = await import(LIB_TS);
    const transcript = writeTranscript([
      {
        type: "tool_use",
        name: "Skill",
        input: { skill: "dev-process-toolkit:brainstorm" },
      },
    ]);
    // Suppress stderr noise for this case.
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (() => true) as typeof process.stderr.write;
    try {
      const result = mod.requireSkillToolUse(
        "dev-process-toolkit:gate-check",
        "pre-commit-gate-check",
        { transcript_path: transcript } as never,
      );
      expect(result.found).toBe(false);
    } finally {
      process.stderr.write = origWrite;
    }
  });

  test("name and skill split across two JSONL lines → found=false (atomic-line invariant)", async () => {
    const mod = await import(LIB_TS);
    // Same-line invariant: name and skill on different lines must not match.
    const file = join(tmpRoot, "split.jsonl");
    writeFileSync(
      file,
      JSON.stringify({ type: "tool_use", name: "Skill", input: {} }) +
        "\n" +
        JSON.stringify({ skill: "dev-process-toolkit:gate-check" }) +
        "\n",
    );
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (() => true) as typeof process.stderr.write;
    try {
      const result = mod.requireSkillToolUse(
        "dev-process-toolkit:gate-check",
        "pre-commit-gate-check",
        { transcript_path: file } as never,
      );
      expect(result.found).toBe(false);
    } finally {
      process.stderr.write = origWrite;
    }
  });
});

// ---------------------------------------------------------------------------
// AC.1 — findSkillToolUse (no-emit variant used by the advisory brainstorm-
//        reminder hook; the helper Refusing hooks delegate to via
//        requireSkillToolUse)
// ---------------------------------------------------------------------------

describe("AC-STE-290.1 — findSkillToolUse: no-emit pure boolean check", () => {
  function captureStderr(fn: () => Promise<unknown>): Promise<{ result: unknown; stderr: string }> {
    const captured: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: unknown) => {
      captured.push(typeof chunk === "string" ? chunk : String(chunk));
      return true;
    }) as typeof process.stderr.write;
    return Promise.resolve(fn())
      .then((result) => ({ result, stderr: captured.join("") }))
      .finally(() => {
        process.stderr.write = origWrite;
      });
  }

  test("hit: Skill tool_use present → { found: true } and stderr stays empty", async () => {
    const transcript = writeTranscript([
      { type: "tool_use", name: "Skill", input: { skill: "dev-process-toolkit:brainstorm" } },
    ]);
    const mod = await import(LIB_TS);
    const { result, stderr } = await captureStderr(() =>
      Promise.resolve(
        mod.findSkillToolUse("dev-process-toolkit:brainstorm", {
          session_id: "s1",
          transcript_path: transcript,
          cwd: "/tmp",
          hook_event_name: "UserPromptSubmit",
        }),
      ),
    );
    expect(result).toEqual({ found: true });
    expect(stderr).toBe("");
  });

  test("miss: no matching Skill tool_use → { found: false } and stderr stays empty (no Refusing emit)", async () => {
    const transcript = writeTranscript([
      { type: "tool_use", name: "Bash", input: { command: "ls" } },
    ]);
    const mod = await import(LIB_TS);
    const { result, stderr } = await captureStderr(() =>
      Promise.resolve(
        mod.findSkillToolUse("dev-process-toolkit:brainstorm", {
          session_id: "s1",
          transcript_path: transcript,
          cwd: "/tmp",
          hook_event_name: "UserPromptSubmit",
        }),
      ),
    );
    expect(result).toEqual({ found: false });
    expect(stderr).toBe("");
  });

  test("fail-open: transcript_path missing on disk → { found: true } (advisory hook does not block)", async () => {
    const mod = await import(LIB_TS);
    const { result, stderr } = await captureStderr(() =>
      Promise.resolve(
        mod.findSkillToolUse("dev-process-toolkit:brainstorm", {
          session_id: "s1",
          transcript_path: join(tmpRoot, "does-not-exist.jsonl"),
          cwd: "/tmp",
          hook_event_name: "UserPromptSubmit",
        }),
      ),
    );
    expect(result).toEqual({ found: true });
    expect(stderr).toBe("");
  });
});

// ---------------------------------------------------------------------------
// AC.1 + AC.6 — emitNFR10 byte-stability
// ---------------------------------------------------------------------------

describe("AC-STE-290.1 / AC-STE-290.6 — emitNFR10 byte-stable stderr template", () => {
  function captureStderr(fn: () => void): string {
    const captured: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: unknown) => {
      captured.push(typeof chunk === "string" ? chunk : String(chunk));
      return true;
    }) as typeof process.stderr.write;
    try {
      fn();
    } finally {
      process.stderr.write = origWrite;
    }
    return captured.join("");
  }

  test("Refusing verdict writes the canonical refusal template", async () => {
    const mod = await import(LIB_TS);
    const out = captureStderr(() => {
      mod.emitNFR10(
        "Refusing",
        "required dev-process-toolkit:gate-check Skill tool_use not found in current session.",
        "run /dev-process-toolkit:gate-check before retrying this action.",
        "dev-process-toolkit:gate-check",
        "pre-commit-gate-check",
      );
    });
    // AC.6: literal byte-stable substring.
    expect(out).toContain(
      "Refusing: required dev-process-toolkit:gate-check Skill tool_use not found in current session.",
    );
    expect(out).toContain(
      "Context: mode=hook, ticket=unbound, skill=dev-process-toolkit:gate-check, hook=pre-commit-gate-check",
    );
  });

  test("Reminder verdict writes the advisory shape used by brainstorm-reminder", async () => {
    const mod = await import(LIB_TS);
    const out = captureStderr(() => {
      mod.emitNFR10(
        "Reminder",
        "consider running /dev-process-toolkit:brainstorm before /spec-write for greenfield FRs.",
        "run /dev-process-toolkit:brainstorm to explore approach + tradeoffs, then re-invoke /spec-write.",
        "dev-process-toolkit:spec-write",
        "pre-spec-write-brainstorm-reminder",
      );
    });
    expect(out).toContain("Reminder:");
    expect(out).toContain(
      "Context: mode=hook, ticket=unbound, skill=dev-process-toolkit:spec-write, hook=pre-spec-write-brainstorm-reminder",
    );
  });
});

// ---------------------------------------------------------------------------
// AC.4 — legacy artifacts removed under templates/hooks/
// ---------------------------------------------------------------------------

describe("AC-STE-290.4 — legacy session.sh + $CLAUDE_SESSION_FILE removed", () => {
  test("`templates/hooks/_lib/session.sh` does NOT exist", () => {
    expect(existsSync(LIB_SH)).toBe(false);
  });

  test("no file under templates/hooks/ references CLAUDE_SESSION_FILE", () => {
    const hits = grepUnder(HOOKS_DIR, /CLAUDE_SESSION_FILE/);
    expect(hits).toEqual([]);
  });

  test("no file under templates/hooks/ references session.sh", () => {
    const hits = grepUnder(HOOKS_DIR, /session\.sh/);
    expect(hits).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// STE-598 — a fix with no feature request can still prove its tests were red.
//
// The pre-commit TDD guard accepts exactly one proof today: a
// `dev-process-toolkit:tdd` Skill tool_use. That orchestrator only runs with an
// FR in play, so an audit-driven fix cannot satisfy it honestly. This block
// pins the SECOND door — a recorded red-before proof — and, just as hard, the
// clauses a permissive implementation would quietly drop.
//
//   AC-STE-598.1 — the disjunction, in all four combinations.
//   AC-STE-598.2 — the proof names the staged paths it covers.
//   AC-STE-598.3 — ONE transcript reader for the whole guard family.
//   AC-STE-598.4 — the refusal names BOTH doors.
//   AC-STE-598.5 — the rejected content-keyed alternative is recorded in the FR.
//
// METHOD: every clause below has a sibling CONTROL that proves the assertion
// can go red. Three prior milestones shipped a test that passed for a reason
// unrelated to what it claimed to check.
// ---------------------------------------------------------------------------

/**
 * STE-598's own FR, resolved ACTIVE-OR-ARCHIVED through the shared spec-tree
 * reader rather than pinned at the active path. A test that reaches the active
 * tree by a hand-built path goes ENOENT on the day the FR is archived — the
 * M137 archive blind spot — and that day is this milestone's own archive commit.
 */
const readFr598 = (): string =>
  readSpecFile(REPO_ROOT, "specs/frs", "STE-598.md").body;

/** Raw JSONL writer — the transcript lines are the subject here, not a shape. */
function writeRawTranscript(name: string, lines: string[]): string {
  const file = join(tmpRoot, name);
  writeFileSync(file, lines.join("\n") + "\n");
  return file;
}

function stePayload(transcript: string): never {
  return {
    session_id: "s1",
    transcript_path: transcript,
    cwd: "/tmp",
    hook_event_name: "PreToolUse",
  } as never;
}

/** A `dev-process-toolkit:tdd` Skill tool_use line — the FIRST door. */
function orchestratorLine(): string {
  return JSON.stringify({
    type: "tool_use",
    name: "Skill",
    input: { skill: "dev-process-toolkit:tdd" },
  });
}

/** A marker line covering `paths` — the SECOND door. */
function proofLine(marker: string, paths: string[]): string {
  return JSON.stringify({
    type: "user",
    message: { role: "user", content: `${marker} ${paths.join(" ")}` },
  });
}

function captureStderrSync(fn: () => unknown): { result: unknown; stderr: string } {
  const captured: string[] = [];
  const origWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: unknown) => {
    captured.push(typeof chunk === "string" ? chunk : String(chunk));
    return true;
  }) as typeof process.stderr.write;
  let result: unknown;
  try {
    result = fn();
  } finally {
    process.stderr.write = origWrite;
  }
  return { result, stderr: captured.join("") };
}

// ---------------------------------------------------------------------------
// The marker itself — a byte-stable contract an operator has to be able to type.
// ---------------------------------------------------------------------------

describe("AC-STE-598.1 — RED_BEFORE_PROOF_MARKER is an exported, byte-stable constant", () => {
  test("the module exports the canonical marker", async () => {
    const mod = await import(LIB_TS);
    expect(mod.RED_BEFORE_PROOF_MARKER).toBe("dpt-red-before-proof:");
  });
});

// ---------------------------------------------------------------------------
// AC-STE-598.2 — findRedBeforeProof: path scoping + the atomic-line invariant.
// ---------------------------------------------------------------------------

describe("AC-STE-598.2 — findRedBeforeProof: the proof must name the paths it covers", () => {
  test("a proof naming the required path covers it", async () => {
    const mod = await import(LIB_TS);
    const t = writeRawTranscript("covered.jsonl", [
      proofLine(mod.RED_BEFORE_PROOF_MARKER, ["tests/foo.test.ts"]),
    ]);
    expect(
      mod.findRedBeforeProof(stePayload(t), ["tests/foo.test.ts"]),
    ).toEqual({ found: true, uncovered: [] });
  });

  test("a proof naming ONLY an unrelated test file does NOT satisfy", async () => {
    // The clause a permissive implementation drops: "a marker is present" is
    // not the same claim as "these bytes were red".
    const mod = await import(LIB_TS);
    const t = writeRawTranscript("unrelated.jsonl", [
      proofLine(mod.RED_BEFORE_PROOF_MARKER, ["tests/somethingelse.test.ts"]),
    ]);
    const r = mod.findRedBeforeProof(stePayload(t), ["tests/foo.test.ts"]);
    expect(r.found).toBe(false);
    expect(r.uncovered).toEqual(["tests/foo.test.ts"]);
  });

  test("a proof naming SOME but not all required paths does NOT satisfy, and names the rest", async () => {
    const mod = await import(LIB_TS);
    const t = writeRawTranscript("partial.jsonl", [
      proofLine(mod.RED_BEFORE_PROOF_MARKER, ["tests/a.test.ts"]),
    ]);
    const r = mod.findRedBeforeProof(stePayload(t), [
      "tests/a.test.ts",
      "tests/b.test.ts",
    ]);
    expect(r.found).toBe(false);
    expect(r.uncovered).toEqual(["tests/b.test.ts"]);
  });

  test("CONTROL — the SAME two required paths go green once the second is named, so the partial case fails on coverage and not on the pair", async () => {
    const mod = await import(LIB_TS);
    const t = writeRawTranscript("partial-control.jsonl", [
      proofLine(mod.RED_BEFORE_PROOF_MARKER, [
        "tests/a.test.ts",
        "tests/b.test.ts",
      ]),
    ]);
    expect(
      mod.findRedBeforeProof(stePayload(t), [
        "tests/a.test.ts",
        "tests/b.test.ts",
      ]),
    ).toEqual({ found: true, uncovered: [] });
  });

  test("coverage assembled across TWO marker lines satisfies (union across claims)", async () => {
    const mod = await import(LIB_TS);
    const t = writeRawTranscript("union.jsonl", [
      proofLine(mod.RED_BEFORE_PROOF_MARKER, ["tests/a.test.ts"]),
      JSON.stringify({ type: "tool_use", name: "Bash", input: { command: "ls" } }),
      proofLine(mod.RED_BEFORE_PROOF_MARKER, ["tests/b.test.ts"]),
    ]);
    expect(
      mod.findRedBeforeProof(stePayload(t), [
        "tests/a.test.ts",
        "tests/b.test.ts",
      ]),
    ).toEqual({ found: true, uncovered: [] });
  });

  test("EMPTY requiredPaths ⇒ found false — a proof covering nothing proves nothing", async () => {
    // `[].every(...)` is `true`. A previous milestone shipped exactly that bug.
    const mod = await import(LIB_TS);
    const t = writeRawTranscript("empty-required.jsonl", [
      proofLine(mod.RED_BEFORE_PROOF_MARKER, ["tests/a.test.ts"]),
    ]);
    const r = mod.findRedBeforeProof(stePayload(t), []);
    expect(r.found).toBe(false);
    expect(r.uncovered).toEqual([]);
  });

  test("no marker anywhere ⇒ found false, every required path uncovered", async () => {
    const mod = await import(LIB_TS);
    const t = writeRawTranscript("no-marker.jsonl", [
      JSON.stringify({ type: "tool_use", name: "Bash", input: { command: "bun test" } }),
    ]);
    const r = mod.findRedBeforeProof(stePayload(t), ["tests/foo.test.ts"]);
    expect(r.found).toBe(false);
    expect(r.uncovered).toEqual(["tests/foo.test.ts"]);
  });

  test("missing transcript file ⇒ fail-open true, matching the existing door", async () => {
    const mod = await import(LIB_TS);
    const r = mod.findRedBeforeProof(
      stePayload(join(tmpRoot, "does-not-exist.jsonl")),
      ["tests/foo.test.ts"],
    );
    expect(r.found).toBe(true);
  });
});

describe("AC-STE-598.2 — findRedBeforeProof: atomic-line invariant (STE-285, re-applied)", () => {
  test("marker on one line and the path on a DIFFERENT line does NOT satisfy", async () => {
    const mod = await import(LIB_TS);
    const t = writeRawTranscript("split.jsonl", [
      JSON.stringify({ type: "user", message: { content: `${mod.RED_BEFORE_PROOF_MARKER} (paths below)` } }),
      JSON.stringify({ type: "user", message: { content: "tests/foo.test.ts" } }),
    ]);
    const r = mod.findRedBeforeProof(stePayload(t), ["tests/foo.test.ts"]);
    expect(r.found).toBe(false);
    expect(r.uncovered).toEqual(["tests/foo.test.ts"]);
  });

  test("CONTROL — the SAME marker and the SAME path on ONE line DO satisfy", async () => {
    const mod = await import(LIB_TS);
    const t = writeRawTranscript("split-control.jsonl", [
      JSON.stringify({
        type: "user",
        message: { content: `${mod.RED_BEFORE_PROOF_MARKER} (paths below) tests/foo.test.ts` },
      }),
    ]);
    expect(
      mod.findRedBeforeProof(stePayload(t), ["tests/foo.test.ts"]).found,
    ).toBe(true);
  });

  test("a path appearing BEFORE the marker on the same line does NOT satisfy", async () => {
    const mod = await import(LIB_TS);
    const t = writeRawTranscript("before.jsonl", [
      JSON.stringify({
        type: "user",
        message: {
          content:
            `I edited tests/foo.test.ts a while ago. ` +
            `${mod.RED_BEFORE_PROOF_MARKER} tests/other.test.ts`,
        },
      }),
    ]);
    const r = mod.findRedBeforeProof(stePayload(t), ["tests/foo.test.ts"]);
    expect(r.found).toBe(false);
    expect(r.uncovered).toEqual(["tests/foo.test.ts"]);
  });

  test("CONTROL — swap the order on that SAME line and it satisfies, so the refusal is about position", async () => {
    const mod = await import(LIB_TS);
    const t = writeRawTranscript("before-control.jsonl", [
      JSON.stringify({
        type: "user",
        message: {
          content:
            `I edited tests/other.test.ts a while ago. ` +
            `${mod.RED_BEFORE_PROOF_MARKER} tests/foo.test.ts`,
        },
      }),
    ]);
    expect(
      mod.findRedBeforeProof(stePayload(t), ["tests/foo.test.ts"]).found,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-598.1 — requireTddEvidence: the disjunction, all four combinations.
// ---------------------------------------------------------------------------

describe("AC-STE-598.1 — requireTddEvidence: either door satisfies, neither refuses", () => {
  const REQUIRED = ["tests/foo.test.ts"];

  test("orchestrator evidence ONLY ⇒ found true, stderr silent", async () => {
    const mod = await import(LIB_TS);
    const t = writeRawTranscript("orch-only.jsonl", [orchestratorLine()]);
    const { result, stderr } = captureStderrSync(() =>
      mod.requireTddEvidence("dev-process-toolkit:tdd", "pre-commit-tdd-orchestrator", stePayload(t), REQUIRED),
    );
    expect(result).toEqual({ found: true });
    expect(stderr).toBe("");
  });

  test("red-before proof ONLY ⇒ found true, stderr silent", async () => {
    // Silence matters: an implementation that asks the old door first would
    // emit its refusal here and then return true, which reads as a bug report
    // on a clean commit.
    const mod = await import(LIB_TS);
    const t = writeRawTranscript("proof-only.jsonl", [
      proofLine(mod.RED_BEFORE_PROOF_MARKER, REQUIRED),
    ]);
    const { result, stderr } = captureStderrSync(() =>
      mod.requireTddEvidence("dev-process-toolkit:tdd", "pre-commit-tdd-orchestrator", stePayload(t), REQUIRED),
    );
    expect(result).toEqual({ found: true });
    expect(stderr).toBe("");
  });

  test("BOTH doors ⇒ found true, stderr silent", async () => {
    const mod = await import(LIB_TS);
    const t = writeRawTranscript("both.jsonl", [
      orchestratorLine(),
      proofLine(mod.RED_BEFORE_PROOF_MARKER, REQUIRED),
    ]);
    const { result, stderr } = captureStderrSync(() =>
      mod.requireTddEvidence("dev-process-toolkit:tdd", "pre-commit-tdd-orchestrator", stePayload(t), REQUIRED),
    );
    expect(result).toEqual({ found: true });
    expect(stderr).toBe("");
  });

  test("NEITHER door ⇒ found false + an NFR-10 Refusing block", async () => {
    const mod = await import(LIB_TS);
    const t = writeRawTranscript("neither.jsonl", [
      JSON.stringify({ type: "tool_use", name: "Bash", input: { command: "ls" } }),
    ]);
    const { result, stderr } = captureStderrSync(() =>
      mod.requireTddEvidence("dev-process-toolkit:tdd", "pre-commit-tdd-orchestrator", stePayload(t), REQUIRED),
    );
    expect(result).toEqual({ found: false });
    expect(stderr).toContain("Refusing:");
    expect(stderr).toContain("Remedy:");
    expect(stderr).toContain("Context:");
    expect(stderr).toContain("hook=pre-commit-tdd-orchestrator");
  });

  test("a proof naming an UNRELATED file, with no orchestrator evidence ⇒ found false", async () => {
    const mod = await import(LIB_TS);
    const t = writeRawTranscript("unrelated-proof.jsonl", [
      proofLine(mod.RED_BEFORE_PROOF_MARKER, ["tests/somethingelse.test.ts"]),
    ]);
    const { result } = captureStderrSync(() =>
      mod.requireTddEvidence("dev-process-toolkit:tdd", "pre-commit-tdd-orchestrator", stePayload(t), REQUIRED),
    );
    expect(result).toEqual({ found: false });
  });

  test("EMPTY requiredPaths with a proof present ⇒ still refused", async () => {
    const mod = await import(LIB_TS);
    const t = writeRawTranscript("empty-required-require.jsonl", [
      proofLine(mod.RED_BEFORE_PROOF_MARKER, ["tests/foo.test.ts"]),
    ]);
    const { result } = captureStderrSync(() =>
      mod.requireTddEvidence("dev-process-toolkit:tdd", "pre-commit-tdd-orchestrator", stePayload(t), []),
    );
    expect(result).toEqual({ found: false });
  });

  test("missing transcript ⇒ fail-open true, stderr silent", async () => {
    const mod = await import(LIB_TS);
    const { result, stderr } = captureStderrSync(() =>
      mod.requireTddEvidence(
        "dev-process-toolkit:tdd",
        "pre-commit-tdd-orchestrator",
        stePayload(join(tmpRoot, "gone.jsonl")),
        REQUIRED,
      ),
    );
    expect(result).toEqual({ found: true });
    expect(stderr).toBe("");
  });
});

// ---------------------------------------------------------------------------
// AC-STE-598.4 — the refusal names BOTH doors.
// ---------------------------------------------------------------------------

describe("AC-STE-598.4 — the refusal teaches the second door instead of hiding it", () => {
  test("the Refusing block names the orchestrator AND the red-before proof, including the literal marker", async () => {
    const mod = await import(LIB_TS);
    const t = writeRawTranscript("refusal.jsonl", [
      JSON.stringify({ type: "tool_use", name: "Bash", input: { command: "ls" } }),
    ]);
    const { stderr } = captureStderrSync(() =>
      mod.requireTddEvidence("dev-process-toolkit:tdd", "pre-commit-tdd-orchestrator", stePayload(t), [
        "tests/foo.test.ts",
      ]),
    );
    // Door one, by name.
    expect(stderr).toContain("dev-process-toolkit:tdd");
    // Door two, by name AND by the literal bytes the operator has to type.
    expect(stderr).toMatch(/red-before/i);
    expect(stderr).toContain(mod.RED_BEFORE_PROOF_MARKER);
  });

  test("CONTROL — the sibling requireSkillToolUse refusal does NOT carry the marker, so the assertion above can go red", async () => {
    // Same module, same NFR-10 template, one door. If the marker assertion
    // passed here too it would be matching the template, not the new text.
    const mod = await import(LIB_TS);
    const t = writeRawTranscript("refusal-control.jsonl", [
      JSON.stringify({ type: "tool_use", name: "Bash", input: { command: "ls" } }),
    ]);
    const { result, stderr } = captureStderrSync(() =>
      mod.requireSkillToolUse(
        "dev-process-toolkit:tdd",
        "pre-commit-tdd-orchestrator",
        stePayload(t),
      ),
    );
    expect(result).toEqual({ found: false });
    expect(stderr).toContain("Refusing:");
    expect(stderr).not.toContain(mod.RED_BEFORE_PROOF_MARKER);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-598.4 (with AC-STE-598.2) — the refusal names WHICH staged paths
// raised the requirement.
//
// The remedy tells the operator to record a proof "naming every staged test
// path it covers", and then does not say which those are. The guard is holding
// that list — it computed it to decide the refusal. Withholding it makes the
// operator re-derive it by hand, and that friction points straight back at the
// workaround this FR exists to replace.
// ---------------------------------------------------------------------------

/** A transcript carrying neither door — the only state that reaches a refusal. */
const NO_EVIDENCE_LINES = [
  JSON.stringify({ type: "tool_use", name: "Bash", input: { command: "ls" } }),
];

describe("AC-STE-598.4 — the refusal names every staged path in the required set", () => {
  test("TWO required paths ⇒ BOTH are named in the Refusing block", async () => {
    const mod = await import(LIB_TS);
    const t = writeRawTranscript("refusal-two-paths.jsonl", NO_EVIDENCE_LINES);
    const { result, stderr } = captureStderrSync(() =>
      mod.requireTddEvidence("dev-process-toolkit:tdd", "pre-commit-tdd-orchestrator", stePayload(t), [
        "tests/alpha.test.ts",
        "tests/beta.test.ts",
      ]),
    );
    expect(result).toEqual({ found: false });
    expect(stderr).toContain("Refusing:");
    expect(stderr).toContain("tests/alpha.test.ts");
    expect(stderr).toContain("tests/beta.test.ts");
  });

  test("CONTROL — a required set of ONE path names that one path, with no artefact of an emptied list", async () => {
    const mod = await import(LIB_TS);
    const t = writeRawTranscript("refusal-one-path.jsonl", NO_EVIDENCE_LINES);
    const { stderr } = captureStderrSync(() =>
      mod.requireTddEvidence("dev-process-toolkit:tdd", "pre-commit-tdd-orchestrator", stePayload(t), [
        "tests/alpha.test.ts",
      ]),
    );
    expect(stderr).toContain("tests/alpha.test.ts");
    // A list rendered for the plural case and not re-read for the singular one
    // leaves these behind. None of them is derived from the subject: they are
    // the shapes a naive join produces.
    expect(stderr).not.toContain("undefined");
    expect(stderr).not.toContain(", ,");
    expect(stderr).not.toContain("[]");
  });

  test("CONTROL — a path that never entered the required set is NOT named, so the assertions above are about the set and not about the template", async () => {
    const mod = await import(LIB_TS);
    const t = writeRawTranscript("refusal-one-named.jsonl", NO_EVIDENCE_LINES);
    const { stderr } = captureStderrSync(() =>
      mod.requireTddEvidence("dev-process-toolkit:tdd", "pre-commit-tdd-orchestrator", stePayload(t), [
        "tests/alpha.test.ts",
      ]),
    );
    expect(stderr).toContain("tests/alpha.test.ts");
    expect(stderr).not.toContain("tests/beta.test.ts");
  });
});

// ---------------------------------------------------------------------------
// AC-STE-598.3 — ONE discovery mechanism for the whole guard family.
// ---------------------------------------------------------------------------

/** Count `readFileSync(` CALL SITES in a module source (the import is not one). */
function countReadFileSyncCallSites(source: string): number {
  return (source.match(/readFileSync\(/g) ?? []).length;
}

/**
 * Slice a top-level `function <name>(` … `\n}` block out of a module source.
 * Returns "" when the declaration is absent.
 */
function topLevelFunctionBody(source: string, name: string): string {
  const declRe = new RegExp(`(?:export )?function ${name}\\(`);
  const m = declRe.exec(source);
  if (!m) return "";
  const from = m.index;
  const end = source.indexOf("\n}", from);
  return end === -1 ? source.slice(from) : source.slice(from, end + 2);
}

describe("AC-STE-598.3 — the proof is found through the SAME transcript reader", () => {
  test("session.ts declares a single shared reader, `readTranscriptLines`", () => {
    const source = readFileSync(LIB_TS, "utf-8");
    expect(topLevelFunctionBody(source, "readTranscriptLines")).not.toBe("");
  });

  test("the shared reader is the one that touches the filesystem", () => {
    const source = readFileSync(LIB_TS, "utf-8");
    const body = topLevelFunctionBody(source, "readTranscriptLines");
    expect(body).toContain("readFileSync(");
  });

  test("session.ts performs EXACTLY ONE readFileSync of the transcript — no second mechanism ships", () => {
    const source = readFileSync(LIB_TS, "utf-8");
    expect(countReadFileSyncCallSites(source)).toBe(1);
  });

  // CONTROL — graded on SYNTHETIC sources with a hard-coded number of call
  // sites, never on the live one. The previous version of this control derived
  // its expectation from `session.ts` itself (`source + 1 extra` ⇒ 2), which
  // couples a control to the very fact it controls for: the day the module
  // legitimately gains a reader, the control reds too and cannot tell "the
  // counter is broken" from "the source moved". A control has to be able to
  // stay green while its subject goes red.
  test("CONTROL — the counter returns exactly 0, 1 and 3 on fixtures built to hold that many call sites", () => {
    const zero = [
      'import { readFileSync } from "node:fs";',
      "export function passthrough(p: string): string {",
      "  return p;",
      "}",
      "",
    ].join("\n");
    const one = [
      'import { readFileSync } from "node:fs";',
      "export function readOnce(p: string): string {",
      '  return readFileSync(p, "utf-8");',
      "}",
      "",
    ].join("\n");
    const three = [
      'import { readFileSync } from "node:fs";',
      "export function readThrice(p: string): string {",
      '  const a = readFileSync(p, "utf-8");',
      '  const b = readFileSync(p + ".bak", "utf-8");',
      '  const c = readFileSync(p + ".old", "utf-8");',
      "  return a + b + c;",
      "}",
      "",
    ].join("\n");
    // The import BINDING is not a call site. `zero` carries one and still
    // counts zero — that distinction is what the clause above rests on.
    expect(countReadFileSyncCallSites(zero)).toBe(0);
    expect(countReadFileSyncCallSites(one)).toBe(1);
    expect(countReadFileSyncCallSites(three)).toBe(3);
  });

  test("CONTROL — the block extractor really extracts a block, and reports an absent one as empty", () => {
    const synthetic = [
      "function readTranscriptLines(p) {",
      "  return readFileSync(p).split();",
      "}",
      "",
      "function other() {",
      "  return 1;",
      "}",
      "",
    ].join("\n");
    const body = topLevelFunctionBody(synthetic, "readTranscriptLines");
    expect(body).toContain("readFileSync(");
    expect(body).not.toContain("function other");
    expect(topLevelFunctionBody(synthetic, "notDeclaredAnywhere")).toBe("");
    // A reader that does NOT touch the filesystem is detectable as such.
    expect(topLevelFunctionBody(synthetic, "other")).not.toContain("readFileSync(");
  });
});

// ---------------------------------------------------------------------------
// AC-STE-598.3, WIDENED (M_f1f569) — closing the PARTIAL left by the count-only
// pin above.
//
// `countReadFileSyncCallSites(session.ts) === 1` is narrower than the claim it
// is asked to carry. It is blind in three directions:
//
//   (a) a transcript reader added in any OTHER file;
//   (b) a SECOND reader inside session.ts spelled some other way — `Bun.file`,
//       `readFile`, `createReadStream`, `openSync` — which keeps the
//       `readFileSync` count at 1 and passes every clause above;
//   (c) the invariant AC.3 actually means: that `findSkillToolUse` and
//       `findRedBeforeProof` BOTH ACTUALLY CALL `readTranscriptLines`. Nothing
//       above asserts either finder goes through the shared reader at all.
//
// (c) is the load-bearing one and is graded BEHAVIOURALLY below: the reader is
// swapped for a stub and both finders are required to observe the swap. A
// finder that read the transcript itself would keep seeing the real bytes and
// go red.
//
// (a) is recorded honestly rather than over-claimed: the pin is FILE-SCOPED to
// session.ts by design. A real second transcript reader already exists in this
// tree at adapters/_shared/src/token_usage.ts — a token-capture hook, not a
// guard — so what is pinned here is the GUARD FAMILY: the hook entry points
// under templates/hooks/_lib/hooks/ carry no transcript read of their own.
// ---------------------------------------------------------------------------

const HOOK_ENTRY_DIR = join(HOOKS_DIR, "_lib", "hooks");
const TOKEN_USAGE_TS = join(
  PLUGIN_ROOT, "adapters", "_shared", "src", "token_usage.ts",
);

/**
 * The guard family: the hooks that REFUSE or REMIND on missing evidence.
 * `session-token-ledger.ts` is deliberately not in this list — it is a capture
 * hook, not a guard, and it is the one entry point that legitimately reaches a
 * second transcript reader (via `parseTranscriptTokenUsage`). Naming it as an
 * exception here is the honest version of clause (a); silently letting the
 * scan cover it would claim more than AC.3 can deliver.
 */
const GUARD_HOOK_FILES = [
  "pre-commit-gate-check.ts",
  "pre-commit-tdd-orchestrator.ts",
  "pre-pr-spec-review.ts",
  "pre-spec-write-brainstorm-reminder.ts",
];

/**
 * Every filesystem-read API spelling a second reader could plausibly use.
 * Call-site shaped on purpose: a name in prose is not a reader.
 */
const FS_READ_SPELLINGS: Array<{ name: string; re: RegExp }> = [
  { name: "readFileSync", re: /\breadFileSync\s*\(/ },
  { name: "readFile", re: /\breadFile\s*\(/ },
  { name: "Bun.file", re: /\bBun\s*\.\s*file\s*\(/ },
  { name: "createReadStream", re: /\bcreateReadStream\s*\(/ },
  { name: "openSync", re: /\bopenSync\s*\(/ },
  { name: "readSync", re: /\breadSync\s*\(/ },
];

/** Which filesystem-read spellings `source` actually calls, in declared order. */
function fsReadSpellings(source: string): string[] {
  return FS_READ_SPELLINGS.filter((s) => s.re.test(source)).map((s) => s.name);
}

/** Of `names` in `dir`, the ones carrying a filesystem read of their own. */
function filesWithOwnRead(dir: string, names: string[]): string[] {
  return names.filter(
    (n) => fsReadSpellings(readFileSync(join(dir, n), "utf-8")).length > 0,
  );
}

/**
 * `source` with the body of `readTranscriptLines` replaced by a stub returning
 * `stubbed`, and NOTHING else touched. The finders are copied verbatim, so any
 * change in what they observe is attributable to the reader alone.
 */
function withSwappedReader(source: string, stubbed: string[] | null): string {
  const block = topLevelFunctionBody(source, "readTranscriptLines");
  if (block === "") {
    throw new Error("readTranscriptLines not found in session.ts");
  }
  const stub = [
    "export function readTranscriptLines(_payload: HookPayload): string[] | null {",
    `  return ${JSON.stringify(stubbed)};`,
    "}",
  ].join("\n");
  return source.replace(block, stub);
}

/** Write a module source into the temp dir and import it. */
async function importSource(name: string, source: string): Promise<never> {
  const file = join(tmpRoot, name);
  writeFileSync(file, source);
  return (await import(file)) as never;
}

/** A transcript that satisfies NEITHER door. */
function noEvidenceTranscript(name: string): string {
  return writeRawTranscript(name, [
    JSON.stringify({
      type: "user",
      message: { role: "user", content: "no evidence of anything here" },
    }),
  ]);
}

describe("AC-STE-598.3 (widened) — BOTH finders actually go through the shared reader", () => {
  test("BEHAVIOURAL — swapping `readTranscriptLines` for a stub changes what BOTH finders see", async () => {
    const real = await import(LIB_TS);
    const source = readFileSync(LIB_TS, "utf-8");
    // The transcript ON DISK carries no evidence. The stub carries both doors.
    const transcript = noEvidenceTranscript("swap-planted.jsonl");
    const planted = [
      orchestratorLine(),
      proofLine(real.RED_BEFORE_PROOF_MARKER, ["tests/swapped.test.ts"]),
    ];
    const mod = await importSource(
      "session_swapped_planted.ts",
      withSwappedReader(source, planted),
    );

    // Evidence exists ONLY behind the reader. A finder that reads the file
    // itself sees the empty transcript and reds both of these.
    expect(
      mod.findSkillToolUse("dev-process-toolkit:tdd", stePayload(transcript)).found,
    ).toBe(true);
    expect(
      mod.findRedBeforeProof(stePayload(transcript), ["tests/swapped.test.ts"]).found,
    ).toBe(true);
  });

  test("BEHAVIOURAL — a reader stubbed to `null` fails BOTH finders open, though the real file says otherwise", async () => {
    const source = readFileSync(LIB_TS, "utf-8");
    // On disk: a transcript that satisfies neither door. Through the reader:
    // `null`, the missing-transcript signal, whose contract is fail-open.
    const transcript = noEvidenceTranscript("swap-null.jsonl");
    const mod = await importSource(
      "session_swapped_null.ts",
      withSwappedReader(source, null),
    );
    expect(
      mod.findSkillToolUse("dev-process-toolkit:tdd", stePayload(transcript)).found,
    ).toBe(true);
    expect(
      mod.findRedBeforeProof(stePayload(transcript), ["tests/swapped.test.ts"]).found,
    ).toBe(true);
  });

  // CONTROL — the harness (copy module source into tmp, import it, ask the two
  // finders) must NOT be green on its own. With the reader UNCHANGED the same
  // empty transcript reds both finders, so the two greens above are caused by
  // the swap and by nothing else.
  test("CONTROL — the same harness with the reader UNCHANGED reds both finders on the same transcript", async () => {
    const source = readFileSync(LIB_TS, "utf-8");
    const transcript = noEvidenceTranscript("swap-control.jsonl");
    const mod = await importSource("session_verbatim.ts", source);
    expect(
      mod.findSkillToolUse("dev-process-toolkit:tdd", stePayload(transcript)).found,
    ).toBe(false);
    expect(
      mod.findRedBeforeProof(stePayload(transcript), ["tests/swapped.test.ts"]).found,
    ).toBe(false);
  });

  // CONTROL — the swapper edits the reader and only the reader. Both finder
  // declarations survive byte-for-byte, so "the finders changed behaviour"
  // cannot be an artifact of the rewrite mangling them.
  test("CONTROL — the swap replaces the reader alone; both finder declarations survive verbatim", () => {
    const source = readFileSync(LIB_TS, "utf-8");
    const swapped = withSwappedReader(source, ["x"]);
    expect(swapped).not.toBe(source);
    expect(swapped).toContain("export function findSkillToolUse(");
    expect(swapped).toContain("export function findRedBeforeProof(");
    expect(swapped).toContain(topLevelFunctionBody(source, "findRedBeforeProof"));
    expect(swapped).toContain(topLevelFunctionBody(source, "findSkillToolUse"));
    // And: with the reader's body gone, NO filesystem read is left anywhere in
    // the module — an independent proof that the one read lives in the reader.
    expect(fsReadSpellings(swapped)).toEqual([]);
  });
});

describe("AC-STE-598.3 (widened) — no ALTERNATE reader spelling ships in session.ts", () => {
  test("session.ts calls exactly one filesystem-read API, and it is readFileSync", () => {
    const source = readFileSync(LIB_TS, "utf-8");
    expect(fsReadSpellings(source)).toEqual(["readFileSync"]);
  });

  // CONTROL — every alternate the clause enumerates is provably detectable,
  // one synthetic fixture per spelling. A checker that can only ever hit
  // `readFileSync` would pass the clause above for the wrong reason.
  test("CONTROL — the checker detects each enumerated spelling on a fixture built to hold it", () => {
    const fixtures: Array<[string, string]> = [
      ["readFileSync", 'const body = readFileSync(p, "utf-8");'],
      ["readFile", 'const body = await readFile(p, "utf-8");'],
      ["Bun.file", "const body = await Bun.file(p).text();"],
      ["createReadStream", "const stream = createReadStream(p);"],
      ["openSync", 'const fd = openSync(p, "r");'],
      ["readSync", "readSync(fd, buf, 0, 64, 0);"],
    ];
    for (const [name, snippet] of fixtures) {
      expect(fsReadSpellings(snippet)).toContain(name);
    }
    expect(fixtures.map(([name]) => name).sort()).toEqual(
      FS_READ_SPELLINGS.map((s) => s.name).sort(),
    );
    // A name in PROSE is not a call site: the clause is about readers, not words.
    expect(
      fsReadSpellings("// readFileSync and Bun.file are only named here\nexport const x = 1;"),
    ).toEqual([]);
  });

  // CONTROL — the exact regression the count-only pin is blind to. A second
  // reader spelled `Bun.file` inside session.ts leaves
  // `countReadFileSyncCallSites` at 1 — the old clause stays GREEN — while the
  // widened clause goes red. This is the mutation that proves the widening
  // bought something.
  test("CONTROL — a Bun.file second reader keeps the readFileSync count at 1 yet is caught by the widened clause", () => {
    const source = readFileSync(LIB_TS, "utf-8");
    const regressed = source.replace(
      "export function findRedBeforeProof(",
      [
        "async function readTranscriptLinesViaBun(p: string): Promise<string[]> {",
        '  return (await Bun.file(p).text()).split("\\n");',
        "}",
        "",
        "export function findRedBeforeProof(",
      ].join("\n"),
    );
    expect(regressed).not.toBe(source);
    // The old pin: still green. This is the blindness, measured.
    expect(countReadFileSyncCallSites(regressed)).toBe(1);
    // The widened pin: red.
    expect(fsReadSpellings(regressed)).toContain("Bun.file");
    expect(fsReadSpellings(regressed)).not.toEqual(["readFileSync"]);
  });
});

describe("AC-STE-598.3 (widened) — the GUARD FAMILY stays on one mechanism", () => {
  test("no guard hook entry point carries a transcript read of its own", () => {
    const present = readdirSync(HOOK_ENTRY_DIR).filter((f) => f.endsWith(".ts"));
    // Zero-hit guard: the scan must have a subject before its emptiness means
    // anything.
    expect(present.length).toBeGreaterThan(0);
    for (const guard of GUARD_HOOK_FILES) {
      expect(present).toContain(guard);
    }
    expect(filesWithOwnRead(HOOK_ENTRY_DIR, GUARD_HOOK_FILES)).toEqual([]);
  });

  // CONTROL — the same scan, pointed at a planted offender, hits. Proves the
  // empty result above is a property of the guard family and not of a scan
  // that can never return anything.
  test("CONTROL — the scan detects a planted transcript read and leaves a clean sibling alone", () => {
    writeFileSync(
      join(tmpRoot, "clean-hook.ts"),
      'import { requireTddEvidence } from "../session";\nrequireTddEvidence("s", "h", payload, []);\n',
    );
    writeFileSync(
      join(tmpRoot, "dirty-hook.ts"),
      'const lines = readFileSync(payload.transcript_path, "utf-8").split("\\n");\n',
    );
    expect(
      filesWithOwnRead(tmpRoot, ["clean-hook.ts", "dirty-hook.ts"]),
    ).toEqual(["dirty-hook.ts"]);
  });

  // CONTROL — and the honest record of what this pin does NOT cover. A second
  // transcript reader really does exist in this tree, outside the guard
  // family: the token-capture path. The same checker hits it. So the clause
  // above is file-scoped BY DESIGN, not green because nothing else in the repo
  // reads a transcript.
  test("CONTROL — the known second reader outside the guard family is detected by the same checker", () => {
    expect(existsSync(TOKEN_USAGE_TS)).toBe(true);
    const source = readFileSync(TOKEN_USAGE_TS, "utf-8");
    expect(fsReadSpellings(source)).toContain("readFileSync");
    // It is a TRANSCRIPT read, not some unrelated file read.
    expect(source).toContain("transcriptPath");
    // And it is reached from a hook entry point that is NOT a guard.
    const ledger = readFileSync(
      join(HOOK_ENTRY_DIR, "session-token-ledger.ts"), "utf-8",
    );
    expect(ledger).toContain("transcript_path");
    expect(GUARD_HOOK_FILES).not.toContain("session-token-ledger.ts");
  });
});

// ---------------------------------------------------------------------------
// AC-STE-598.5 — the rejected alternative is recorded in the FR.
// ---------------------------------------------------------------------------

/** The body of the first `## <heading matching re>` section, up to the next `## `. */
function markdownSection(md: string, headingRe: RegExp): string {
  const lines = md.split("\n");
  const start = lines.findIndex((l) => /^##\s/.test(l) && headingRe.test(l));
  if (start === -1) return "";
  const rest = lines.slice(start + 1);
  const endRel = rest.findIndex((l) => /^##\s/.test(l));
  return (endRel === -1 ? rest : rest.slice(0, endRel)).join("\n");
}

/**
 * The exact one-line stub that a KEYWORD grader cannot tell from a recorded
 * decision. It recites every term the previous version of this clause searched
 * for and records no reasoning whatever. It is the negative fixture below, and
 * it is written out here rather than derived from the FR so that the FR moving
 * cannot quietly move the thing that is supposed to fail.
 */
const REJECTED_ALTERNATIVES_STUB =
  "content-keyed artifact keyed to staged blob hashes; threat model says no.";

/**
 * Grade a Rejected-Alternatives section on the THREE facets AC-STE-598.5 asks
 * for, reported as named booleans so a red says WHICH facet is missing:
 *
 *   mechanism — WHAT was rejected, concretely enough to recognise.
 *   reasoning — WHY the threat model rejected it, not merely that one was named.
 *   givenUp   — WHAT capability the chosen door trades away, including the
 *               honest-staleness case: a marker recorded truthfully, then
 *               further edits staged on top, which a blob-hash key would have
 *               caught with no adversary anywhere in the picture.
 *
 * Keyword presence alone is deliberately not enough on the last two. The stub
 * above passes a keyword grader on all of them and records nothing; the
 * NEGATIVE FIXTURE test pins that it does not pass this one.
 */
function gradeRejectedAlternatives(section: string): {
  mechanism: boolean;
  reasoning: boolean;
  givenUp: boolean;
} {
  const has = (re: RegExp): boolean => re.test(section);
  return {
    mechanism: has(/content-keyed/i) && has(/blob[- ]hash/i),
    reasoning:
      has(/threat model/i) &&
      has(/self-discipline|not an adversary/i) &&
      has(/lifecycle|invalidat/i),
    givenUp:
      has(/given up|gives up|traded away|trades away/i) &&
      has(/stale/i) &&
      has(/further edits|staged on top/i) &&
      has(/adversary/i),
  };
}

describe("AC-STE-598.5 — the content-keyed artifact is recorded as rejected, with its reasoning", () => {
  test("the FR carries a Rejected Alternatives section", () => {
    const md = readFr598();
    expect(markdownSection(md, /rejected alternative/i)).not.toBe("");
  });

  test("the REAL section records all three facets: the mechanism, the reasoning that rejected it, and what is given up", () => {
    const md = readFr598();
    const section = markdownSection(md, /rejected alternative/i);
    expect(gradeRejectedAlternatives(section)).toEqual({
      mechanism: true,
      reasoning: true,
      givenUp: true,
    });
  });

  test("the third facet is stated plainly: an honestly-recorded marker can go stale when further edits are staged on top, and a blob-hash key would have caught that with no adversary present", () => {
    // The facet the previous clause asserted with nothing at all. The trade is
    // not "someone could lie" — it is that a truthful claim decays, which is
    // the concrete detection the rejected design would have bought.
    const md = readFr598();
    const section = markdownSection(md, /rejected alternative/i);
    expect(section).toMatch(/stale/i);
    expect(section).toMatch(/further edits|staged on top/i);
    expect(section).toMatch(/adversary/i);
    expect(section).toMatch(/blob[- ]hash/i);
  });

  test("NEGATIVE FIXTURE — the one-line keyword stub does NOT satisfy the clause", () => {
    const graded = gradeRejectedAlternatives(REJECTED_ALTERNATIVES_STUB);
    // It DOES recite the mechanism — that is precisely why a keyword grader
    // waved it through, and why this assertion is here rather than a blanket
    // "the stub fails".
    expect(graded.mechanism).toBe(true);
    // And it records neither the reasoning nor the trade. Those two are the
    // clause; everything above is the recital.
    expect(graded.reasoning).toBe(false);
    expect(graded.givenUp).toBe(false);
  });

  test("CONTROL — the grader is not stuck at false: independently written prose carrying all three facets passes, and removing only the trade paragraph reds only that facet", () => {
    // Authored here, not copied from the FR, so this control is not derived
    // from the subject it controls.
    const reasoningOnly = [
      "- A content-keyed artifact, keyed to the staged blob hash of each covered",
      "  file and recomputed by the guard.",
      "- Why not. The threat model is self-discipline rather than an attacker, so",
      "  the key buys tamper-resistance nobody needs and charges a lifecycle to",
      "  invalidate, re-key and get wrong.",
    ].join("\n");
    const withTrade = [
      reasoningOnly,
      "- What is given up. A truthful claim can go stale: the run really was red,",
      "  then further edits landed staged on top of it, and no adversary is",
      "  required for that to happen.",
    ].join("\n");
    expect(gradeRejectedAlternatives(withTrade)).toEqual({
      mechanism: true,
      reasoning: true,
      givenUp: true,
    });
    expect(gradeRejectedAlternatives(reasoningOnly)).toEqual({
      mechanism: true,
      reasoning: true,
      givenUp: false,
    });
  });

  test("CONTROL — the same search misses a phrase that is absent, so the hits above are hits", () => {
    const md = readFr598();
    const section = markdownSection(md, /rejected alternative/i);
    expect(section).not.toMatch(/merkle/i);
    expect(markdownSection(md, /no such heading in this document/i)).toBe("");
  });

  test("CONTROL — the section extractor stops at the next heading", () => {
    const synthetic = [
      "# Title",
      "",
      "## Rejected Alternatives",
      "",
      "content-keyed artifact keyed to staged blob hashes; threat model says no.",
      "",
      "## Notes",
      "",
      "unrelated tail",
      "",
    ].join("\n");
    const section = markdownSection(synthetic, /rejected alternative/i);
    expect(section).toMatch(/content-keyed/i);
    expect(section).not.toMatch(/unrelated tail/);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-598.1 / AC-STE-598.2 — the guard's OWN refusal is not a proof.
//
// Measured on 2026-09-16 against Claude Code 2.1.245. A PreToolUse denial is
// recorded as ONE JSONL line that carries the hook's stderr TWICE — once as the
// tool_result under `message.content[]`, again under `toolUseResult`. That
// stderr quotes the marker in its own `Remedy:` line (followed by the literal
// placeholder `<paths>`), and the SECOND copy's `Refusing:` line names the real
// staged paths. `findRedBeforeProof` takes the FIRST `indexOf` of the marker and
// slices to end of line, so copy #1's placeholder claim swallows copy #2's path
// list: the refusal satisfies the very requirement it just refused, and the
// second attempt at an identical commit is waved through with nothing run.
//
// The existing door cannot do this: its needle is JSON-structural
// (`"name":"Skill"`), so a refusal that merely NAMES the skill does not satisfy
// it. The new door's needle is PROSE THE REFUSAL PRINTS. That asymmetry is the
// bug, and it is why these fixtures are built from the shipped guard's real
// output rather than hand-written.
// ---------------------------------------------------------------------------

/** Count non-overlapping occurrences of `needle` in `haystack`. */
function occurrencesOf(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/**
 * The REAL refusal bytes, produced by CALLING the shipped guard rather than
 * transcribed. A hand-written approximation of this stderr is exactly what let
 * the defect survive a green suite: the swallow depends on the byte order of
 * the `Refusing:` / `Remedy:` / `Context:` block, and on the placeholder that
 * follows the marker, neither of which a synthetic line reproduces by accident.
 */
function shippedRefusalBytes(mod: never, requiredPaths: string[]): string {
  const m = mod as unknown as {
    requireTddEvidence: (
      s: string,
      h: string,
      p: unknown,
      r: string[],
    ) => { found: boolean };
  };
  const barren = writeRawTranscript(
    `barren-${Math.random().toString(36).slice(2)}.jsonl`,
    NO_EVIDENCE_LINES,
  );
  const { result, stderr } = captureStderrSync(() =>
    m.requireTddEvidence(
      "dev-process-toolkit:tdd",
      "pre-commit-tdd-orchestrator",
      stePayload(barren),
      requiredPaths,
    ),
  );
  // The bytes are only the real refusal if the guard actually refused.
  expect(result).toEqual({ found: false });
  expect(stderr).toContain("Refusing:");
  return stderr;
}

/**
 * A Claude Code 2.1.245 PreToolUse DENIAL record: one JSONL line carrying
 * `stderr` twice, under `message.content[].content` and under `toolUseResult`.
 */
function denialRecord(stderr: string): string {
  return JSON.stringify({
    parentUuid: "11111111-1111-1111-1111-111111111111",
    isSidechain: false,
    userType: "external",
    cwd: "/tmp",
    sessionId: "s1",
    version: "2.1.245",
    type: "user",
    message: {
      role: "user",
      content: [
        {
          tool_use_id: "toolu_01AAAAAAAAAAAAAAAAAAAAAA",
          type: "tool_result",
          content: stderr,
          is_error: true,
        },
      ],
    },
    uuid: "22222222-2222-2222-2222-222222222222",
    timestamp: "2026-09-16T14:40:56.000Z",
    toolUseResult: stderr,
  });
}

describe("AC-STE-598.2 — the guard's own denial record does not satisfy the door it refused", () => {
  const PATH = "tests/foo.test.ts";

  test("FIXTURE — the denial record really is the shape the defect needs: one line, the stderr twice, the staged path present", async () => {
    // Graded FIRST and separately. If clause below passed against a record that
    // simply did not contain the path, or that spanned two lines, it would be
    // grading nothing. Every number here is a property of the real bytes.
    const mod = await import(LIB_TS);
    const refusal = shippedRefusalBytes(mod as never, [PATH]);
    const record = denialRecord(refusal);

    // One JSONL line — the newlines inside the stderr are JSON-escaped.
    expect(record.split("\n").length).toBe(1);
    // The hook's stderr, carried twice, under both documented fields.
    const parsed = JSON.parse(record) as {
      message: { content: { content: string }[] };
      toolUseResult: string;
    };
    expect(parsed.message.content[0]!.content).toBe(refusal);
    expect(parsed.toolUseResult).toBe(refusal);
    // The marker appears twice — once per copy, in each copy's `Remedy:` line.
    expect(occurrencesOf(record, mod.RED_BEFORE_PROOF_MARKER)).toBe(2);
    // ...each time followed by the literal placeholder, NOT by a path.
    expect(refusal).toContain(`${mod.RED_BEFORE_PROOF_MARKER} <paths>`);
    // And the staged path IS in the line — in the `Refusing:` prose, which is
    // what copy #1's unbounded slice swallows. Without this the clause below
    // would pass for the trivial reason.
    expect(record).toContain(PATH);
  });

  test("a transcript whose ONLY content is the hook's own denial record does NOT satisfy the proof", async () => {
    const mod = await import(LIB_TS);
    const refusal = shippedRefusalBytes(mod as never, [PATH]);
    const t = writeRawTranscript("denial-only.jsonl", [denialRecord(refusal)]);
    const r = mod.findRedBeforeProof(stePayload(t), [PATH]);
    expect(r.found).toBe(false);
    expect(r.uncovered).toEqual([PATH]);
  });

  test("CONTROL — a genuine operator proof naming the SAME path still satisfies, so the fix does not close the door it opened on purpose", async () => {
    const mod = await import(LIB_TS);
    const t = writeRawTranscript("denial-control.jsonl", [
      proofLine(mod.RED_BEFORE_PROOF_MARKER, [PATH]),
    ]);
    expect(mod.findRedBeforeProof(stePayload(t), [PATH])).toEqual({
      found: true,
      uncovered: [],
    });
  });

  test("CONTROL — a denial record followed by a genuine proof DOES satisfy, so the refusal above is the record's doing and not the transcript's length", async () => {
    // The real second-attempt shape once the operator has actually done the
    // work: the refusal is still in the transcript, and the honest proof after
    // it opens the door.
    const mod = await import(LIB_TS);
    const refusal = shippedRefusalBytes(mod as never, [PATH]);
    const t = writeRawTranscript("denial-then-proof.jsonl", [
      denialRecord(refusal),
      proofLine(mod.RED_BEFORE_PROOF_MARKER, [PATH]),
    ]);
    expect(mod.findRedBeforeProof(stePayload(t), [PATH])).toEqual({
      found: true,
      uncovered: [],
    });
  });

  test("the existing door is NOT fooled by the same record — the asymmetry that makes this a new-door bug", async () => {
    // Door one's needle is JSON-structural, so a refusal that names the skill
    // in prose does not satisfy it. Pinned so a future "just match the skill
    // name" simplification cannot quietly give door one the same defect.
    const mod = await import(LIB_TS);
    const refusal = shippedRefusalBytes(mod as never, [PATH]);
    expect(refusal).toContain("dev-process-toolkit:tdd");
    const t = writeRawTranscript("denial-door-one.jsonl", [
      denialRecord(refusal),
    ]);
    expect(
      mod.findSkillToolUse("dev-process-toolkit:tdd", stePayload(t)).found,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-598.2 — the GENERAL form: a claim is bounded, and every marker
// occurrence on a line is its own claim.
//
// The denial record is one instance of a wider shape: the marker appears,
// covers the paths it names, and then the line goes on to other business. An
// assistant quoting the remedy and then mentioning a file does it too. A fix
// that only moves the index (last occurrence instead of first) closes the
// record case and leaves this one open; a fix that only bounds the first
// occurrence breaks the union. Both are pinned here.
// ---------------------------------------------------------------------------

/** One `user` message line whose content is `content` verbatim. */
function userLine(content: string): string {
  return JSON.stringify({ type: "user", message: { role: "user", content } });
}

describe("AC-STE-598.2 — a claim is bounded at the end of its own line", () => {
  test("marker + an UNRELATED path, then the required path later on the same line in unrelated text ⇒ NOT satisfied", async () => {
    const mod = await import(LIB_TS);
    const t = writeRawTranscript("bounded.jsonl", [
      userLine(
        `${mod.RED_BEFORE_PROOF_MARKER} tests/other.test.ts\n` +
          `Separately: I also edited tests/foo.test.ts this morning.`,
      ),
    ]);
    const r = mod.findRedBeforeProof(stePayload(t), ["tests/foo.test.ts"]);
    expect(r.found).toBe(false);
    expect(r.uncovered).toEqual(["tests/foo.test.ts"]);
  });

  test("CONTROL — the SAME record with the required path INSIDE the claim satisfies, so the refusal above is about the bound and not about the sentence", async () => {
    const mod = await import(LIB_TS);
    const t = writeRawTranscript("bounded-control.jsonl", [
      userLine(
        `${mod.RED_BEFORE_PROOF_MARKER} tests/other.test.ts tests/foo.test.ts\n` +
          `Separately: I also edited tests/foo.test.ts this morning.`,
      ),
    ]);
    expect(
      mod.findRedBeforeProof(stePayload(t), ["tests/foo.test.ts"]).found,
    ).toBe(true);
  });

  test("EVERY marker occurrence on a line is scanned — two claims on one line cover both paths", async () => {
    // The clause that forbids "just take the LAST occurrence" as the fix.
    const mod = await import(LIB_TS);
    const t = writeRawTranscript("two-claims.jsonl", [
      userLine(
        `${mod.RED_BEFORE_PROOF_MARKER} tests/a.test.ts\n` +
          `and then\n` +
          `${mod.RED_BEFORE_PROOF_MARKER} tests/b.test.ts`,
      ),
    ]);
    expect(
      mod.findRedBeforeProof(stePayload(t), [
        "tests/a.test.ts",
        "tests/b.test.ts",
      ]),
    ).toEqual({ found: true, uncovered: [] });
  });

  test("CONTROL — with the second claim naming something else, the second path stays uncovered", async () => {
    const mod = await import(LIB_TS);
    const t = writeRawTranscript("two-claims-control.jsonl", [
      userLine(
        `${mod.RED_BEFORE_PROOF_MARKER} tests/a.test.ts\n` +
          `and then\n` +
          `${mod.RED_BEFORE_PROOF_MARKER} tests/unrelated.test.ts`,
      ),
    ]);
    const r = mod.findRedBeforeProof(stePayload(t), [
      "tests/a.test.ts",
      "tests/b.test.ts",
    ]);
    expect(r.found).toBe(false);
    expect(r.uncovered).toEqual(["tests/b.test.ts"]);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-598.2 — the guard must not refuse the honest operator (second audit,
// MEDIUM).
//
// `claimsOnLine` bounds a claim at the earliest of a backtick, an escaped
// quote, or an escaped newline. The backtick is a mistake: it is ALSO the
// character an operator naturally types AROUND a path when writing the proof in
// prose. So
//
//     dpt-red-before-proof: `tests/a.test.ts` `tests/b.test.ts`
//
// bounds at the FIRST backtick, yields the claim `" "`, and covers nothing —
// the operator who did the work honestly is refused, and the remedy hands back
// the very form it just rejected. STE-597's own Summary calls refusing the
// careful path "the worst shape a guard can have".
//
// Removing the backtick from the terminator set is safe, and the safety is
// MEASURED rather than assumed: within any one copy of the refusal `emitNFR10`
// puts the paths BEFORE the marker (`Refusing:` first, `Remedy:` second), so
// between copy #1's marker and copy #2's paths there are three independent
// terminators — the closing backtick, the escaped newline ending the Remedy
// line, and the escaped quote ending the JSON string. Drop the backtick and the
// denial record is still bounded by the escaped newline alone. The clause that
// pins that ordering on the REAL bytes is the first one below; the
// self-satisfaction clauses that the previous retry round bought are re-asserted
// after it, and they must stay green through the relaxation.
// ---------------------------------------------------------------------------

/** `marker` followed by each path in its OWN inline-code span — the natural form. */
function inlineCodeProofLine(marker: string, paths: string[]): string {
  return userLine(`${marker} ${paths.map((p) => `\`${p}\``).join(" ")}`);
}

describe("AC-STE-598.2 — the escaped newline alone bounds the denial record (the measurement the relaxation rests on)", () => {
  const PATH = "tests/foo.test.ts";

  test("FIXTURE — in the REAL denial bytes, the first escaped newline after the first marker comes BEFORE any occurrence of the staged path", async () => {
    // This is the whole safety argument, asserted on the shipped bytes rather
    // than reasoned about in a comment. If `emitNFR10` is ever reordered to put
    // the `Remedy:` line first, or the marker moved above the paths, this goes
    // red and the backtick relaxation stops being safe — which is exactly when
    // someone needs to be told.
    const mod = await import(LIB_TS);
    const refusal = shippedRefusalBytes(mod as never, [PATH]);
    const record = denialRecord(refusal);

    const marker = record.indexOf(mod.RED_BEFORE_PROOF_MARKER);
    expect(marker).toBeGreaterThan(-1);
    const afterMarker = marker + mod.RED_BEFORE_PROOF_MARKER.length;

    const escapedNewline = record.indexOf("\\n", afterMarker);
    const pathAfterMarker = record.indexOf(PATH, afterMarker);

    // Both must actually occur, or the comparison below is vacuous.
    expect(escapedNewline).toBeGreaterThan(-1);
    expect(pathAfterMarker).toBeGreaterThan(-1);
    expect(escapedNewline).toBeLessThan(pathAfterMarker);
  });

  test("FIXTURE CONTROL — the escaped newline is the ONLY terminator that survives removing the backtick, and it is enough on its own", async () => {
    // MEASURED, and it corrects the design note this milestone was handed.
    // That note claimed THREE terminators sit between copy #1's marker and
    // copy #2's paths: the closing backtick, the escaped newline, and "the
    // escaped quote ending the JSON string". The third does not exist. A JSON
    // string's closing quote is a BARE `"`; the terminator the guard looks for
    // is the two-character `\"`, which only appears when the message text
    // itself contains a quote, and this refusal contains none.
    //
    // So the safety margin is ONE terminator wide, not two. It still holds —
    // the escaped newline lands well before the path — but a future edit that
    // puts a path on the marker's own prose line, or that drops the escaped
    // newline, removes the last thing standing. Asserted rather than assumed,
    // so nobody re-derives the comfortable version of this from the comment.
    const mod = await import(LIB_TS);
    const refusal = shippedRefusalBytes(mod as never, [PATH]);
    const record = denialRecord(refusal);
    const afterMarker =
      record.indexOf(mod.RED_BEFORE_PROOF_MARKER) +
      mod.RED_BEFORE_PROOF_MARKER.length;
    const pathAfterMarker = record.indexOf(PATH, afterMarker);
    expect(pathAfterMarker).toBeGreaterThan(-1);

    // The backtick is real, and it is what bounds the claim TODAY.
    const backtick = record.indexOf("`", afterMarker);
    expect(backtick).toBeGreaterThan(-1);
    expect(backtick).toBeLessThan(pathAfterMarker);

    // The escaped quote is NOT in these bytes at all.
    expect(record.indexOf('\\"', afterMarker)).toBe(-1);

    // Which leaves the escaped newline carrying the bound by itself.
    const escapedNewline = record.indexOf("\\n", afterMarker);
    expect(escapedNewline).toBeGreaterThan(backtick);
    expect(escapedNewline).toBeLessThan(pathAfterMarker);
  });
});

describe("AC-STE-598.2 — a backtick around a path does not void the proof", () => {
  test("each path in its OWN inline-code span covers BOTH paths", async () => {
    const mod = await import(LIB_TS);
    const t = writeRawTranscript("inline-code-two.jsonl", [
      inlineCodeProofLine(mod.RED_BEFORE_PROOF_MARKER, [
        "tests/a.test.ts",
        "tests/b.test.ts",
      ]),
    ]);
    expect(
      mod.findRedBeforeProof(stePayload(t), [
        "tests/a.test.ts",
        "tests/b.test.ts",
      ]),
    ).toEqual({ found: true, uncovered: [] });
  });

  test("a SINGLE path in an inline-code span covers it", async () => {
    const mod = await import(LIB_TS);
    const t = writeRawTranscript("inline-code-one.jsonl", [
      inlineCodeProofLine(mod.RED_BEFORE_PROOF_MARKER, ["tests/a.test.ts"]),
    ]);
    expect(
      mod.findRedBeforeProof(stePayload(t), ["tests/a.test.ts"]),
    ).toEqual({ found: true, uncovered: [] });
  });

  test("CONTROL — the same inline-code form naming an UNRELATED path still does not satisfy, so the relaxation did not turn the claim into the whole line", async () => {
    const mod = await import(LIB_TS);
    const t = writeRawTranscript("inline-code-unrelated.jsonl", [
      inlineCodeProofLine(mod.RED_BEFORE_PROOF_MARKER, [
        "tests/somethingelse.test.ts",
      ]),
    ]);
    const r = mod.findRedBeforeProof(stePayload(t), ["tests/a.test.ts"]);
    expect(r.found).toBe(false);
    expect(r.uncovered).toEqual(["tests/a.test.ts"]);
  });

  test("CONTROL — an inline-code span opened AFTER the escaped newline is still outside the claim", async () => {
    // The widened claim must stop at the end of the marker's own prose line.
    // Without this, "drop the backtick" could be implemented as "drop every
    // bound", and the two clauses above would not notice.
    const mod = await import(LIB_TS);
    const t = writeRawTranscript("inline-code-next-line.jsonl", [
      userLine(
        `${mod.RED_BEFORE_PROOF_MARKER} \`tests/other.test.ts\`\n` +
          `Separately: I also edited \`tests/a.test.ts\` this morning.`,
      ),
    ]);
    const r = mod.findRedBeforeProof(stePayload(t), ["tests/a.test.ts"]);
    expect(r.found).toBe(false);
    expect(r.uncovered).toEqual(["tests/a.test.ts"]);
  });
});

describe("AC-STE-598.2 — the whole-line inline-code form the remedy demonstrates keeps working", () => {
  test("`<marker> <paths>` wrapped as one code span satisfies", async () => {
    // This is the shape the refusal text literally shows the operator. It
    // passes today because the CLOSING backtick bounds it; after the
    // relaxation it must pass because the escaped quote does.
    const mod = await import(LIB_TS);
    const t = writeRawTranscript("whole-line-code.jsonl", [
      userLine(`\`${mod.RED_BEFORE_PROOF_MARKER} tests/a.test.ts\``),
    ]);
    expect(
      mod.findRedBeforeProof(stePayload(t), ["tests/a.test.ts"]),
    ).toEqual({ found: true, uncovered: [] });
  });

  test("CONTROL — the same whole-line span naming another file does not satisfy", async () => {
    const mod = await import(LIB_TS);
    const t = writeRawTranscript("whole-line-code-control.jsonl", [
      userLine(`\`${mod.RED_BEFORE_PROOF_MARKER} tests/other.test.ts\``),
    ]);
    expect(
      mod.findRedBeforeProof(stePayload(t), ["tests/a.test.ts"]).found,
    ).toBe(false);
  });
});

describe("AC-STE-598.2 — RE-ASSERTED through the relaxation: the guard's own denial record is still not a proof", () => {
  const PATH = "tests/foo.test.ts";

  test("with the backtick no longer terminating, a transcript whose ONLY content is the denial record STILL does not satisfy", async () => {
    // Deliberately a duplicate of the clause the previous retry round bought.
    // It is restated here, under this section's name, because the relaxation
    // widens every claim and this is the clause it could plausibly break. A
    // reader deleting it as redundant should have to read that sentence first.
    const mod = await import(LIB_TS);
    const refusal = shippedRefusalBytes(mod as never, [PATH]);
    const t = writeRawTranscript("denial-only-relaxed.jsonl", [
      denialRecord(refusal),
    ]);
    const r = mod.findRedBeforeProof(stePayload(t), [PATH]);
    expect(r.found).toBe(false);
    expect(r.uncovered).toEqual([PATH]);
  });

  test("and neither does the denial record for a commit staging TWO paths", async () => {
    // Two paths makes copy #2's `Refusing:` line longer and moves more prose
    // onto the line. The bound must hold on the plural refusal too.
    const mod = await import(LIB_TS);
    const paths = ["tests/alpha.test.ts", "tests/beta.test.ts"];
    const refusal = shippedRefusalBytes(mod as never, paths);
    const t = writeRawTranscript("denial-only-two-relaxed.jsonl", [
      denialRecord(refusal),
    ]);
    const r = mod.findRedBeforeProof(stePayload(t), paths);
    expect(r.found).toBe(false);
    expect(r.uncovered).toEqual(paths);
  });

  test("CONTROL — an honest proof after that same two-path denial record opens the door for both", async () => {
    const mod = await import(LIB_TS);
    const paths = ["tests/alpha.test.ts", "tests/beta.test.ts"];
    const refusal = shippedRefusalBytes(mod as never, paths);
    const t = writeRawTranscript("denial-two-then-proof.jsonl", [
      denialRecord(refusal),
      inlineCodeProofLine(mod.RED_BEFORE_PROOF_MARKER, paths),
    ]);
    expect(mod.findRedBeforeProof(stePayload(t), paths)).toEqual({
      found: true,
      uncovered: [],
    });
  });
});
