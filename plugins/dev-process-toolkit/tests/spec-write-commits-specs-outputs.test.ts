import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { specWriteStep7Map } from "./_skill-md";

// STE-179 AC-STE-179.7 — /spec-write Step 7a: stage spec changes and prompt
// for commit before returning.
//
// Cases per AC:
//   (a) New-FR run produces one `chore(specs): write FR <tracker-id>` commit
//       with all spec files staged.
//   (b) Cross-cutting-only run (no new FR) produces one
//       `docs(specs): edit cross-cutting specs` commit.
//   (c) `-p` non-interactive mode auto-applies `y` and emits the new
//       `spec_write_commit_default_applied` map row.
//   (d) `n` declines, leaves files staged but uncommitted, emits a Step 7
//       advisory.
//
// `/spec-write` is an LLM-driven skill (no executable runner); the SKILL.md
// prose is the contract. These tests assert the SKILL.md carries the right
// instructions so the LLM produces the four cases on the four paths.

const pluginRoot = join(import.meta.dir, "..");
const specWriteSkill = join(pluginRoot, "skills", "spec-write", "SKILL.md");

function read(): string {
  return readFileSync(specWriteSkill, "utf8");
}

describe("AC-STE-179.1 — Step 7a: stage spec changes and prompt for commit", () => {
  test("SKILL.md carries the Step 7a heading", () => {
    const body = read();
    // Pin the canonical heading shape so /spec-write knows where to insert
    // the staging + commit step.
    expect(body).toMatch(/^### 7a\.?\s/m);
  });

  test("Step 7a names the new-FR commit subject `chore(specs): write FR`", () => {
    const body = read();
    expect(body).toMatch(/chore\(specs\): write FR/);
  });

  test("Step 7a names the cross-cutting-only commit subject `docs(specs): edit cross-cutting specs`", () => {
    const body = read();
    expect(body).toMatch(/docs\(specs\): edit cross-cutting specs/);
  });

  test("Step 7a clarifies one commit per /spec-write invocation", () => {
    const body = read();
    expect(body).toMatch(/one commit per (?:\/spec-write |run)|single commit|per invocation/i);
  });
});

describe("AC-STE-179.2 — y / n / edit prompt + Auto/-p default-apply", () => {
  test("Step 7a documents the y / n / edit prompt", () => {
    const body = read();
    expect(body).toMatch(/y\s*\/\s*n\s*\/\s*edit/i);
  });

  test("Step 7a documents the -p / Auto-mode default-apply behavior", () => {
    const body = read();
    expect(body).toMatch(/Auto mode|-p|non-interactive/);
    expect(body).toMatch(/default[-\s]?appl(?:y|ies|ied)/i);
  });
});

describe("AC-STE-179.6 — `spec_write_commit_default_applied` row in the static map", () => {
  test("the canonical key is present in the static map", () => {
    const map = specWriteStep7Map(read());
    expect(map).toMatch(/\| `spec_write_commit_default_applied` \|/);
  });

  test("the rendered prose mentions auto-approval and the diff-via-git-show check", () => {
    const map = specWriteStep7Map(read());
    expect(map).toMatch(/auto[- ]approved/i);
    expect(map).toMatch(/git show|verify.*diff/i);
  });

  test("the row is documented as emit-on-auto-apply only (not on interactive y)", () => {
    const body = read();
    expect(body).toMatch(/spec_write_commit_default_applied/);
    // Pin the conditional emit rule so the LLM doesn't render it on
    // interactive `y` paths.
    expect(body).toMatch(/auto-apply|auto[-\s]?applied|quiet[-\s]?mode|fires only when|only when (?:auto|the)/i);
  });
});

describe("AC-STE-179.7(d) — `n` decline path emits a Step 7 advisory", () => {
  test("Step 7a documents the n decline path leaving files staged-but-not-committed", () => {
    const body = read();
    // Pin the decline-path semantics: files remain staged so the operator
    // can finish manually.
    expect(body).toMatch(/declin(?:e|ed)|`n`|n\s*decline/);
    expect(body).toMatch(/staged|left staged|stage(?:d)? but uncommitted/i);
  });

  test("the static plain-language map carries a decline-advisory row", () => {
    const body = read();
    // The advisory is the operator-visible signal that /spec-write left
    // work for them. Capability key shape: spec_write_commit_declined or
    // similar; pin at least the term `commit_declined` or the prose anchor.
    expect(body).toMatch(/spec_write_commit_declined|commit declined|declined.*commit/i);
  });
});

describe("AC-STE-179.4 — gate-check SKILL.md no longer references the old probe name", () => {
  test("gate-check SKILL.md does NOT reference `setup-bootstrap-committed`", () => {
    const body = readFileSync(
      join(pluginRoot, "skills", "gate-check", "SKILL.md"),
      "utf-8",
    );
    expect(body).not.toMatch(/setup-bootstrap-committed/);
  });

  test("gate-check SKILL.md DOES reference `toolkit-bootstrap-committed`", () => {
    const body = readFileSync(
      join(pluginRoot, "skills", "gate-check", "SKILL.md"),
      "utf-8",
    );
    expect(body).toMatch(/toolkit-bootstrap-committed/);
  });
});
