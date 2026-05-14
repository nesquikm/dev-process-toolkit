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
