// Bun-mocked smoke for /report-issue — STE-229 AC-STE-229.12.
//
// `/report-issue` is a markdown-driven skill (the LLM follows
// SKILL.md). The "smoke" therefore takes two complementary forms:
//
//   1. A **runtime** assertion against the redaction module — case 4
//      runs `scrubSecrets` on a fixture containing one planted secret
//      per pattern and asserts no literal secret survives.
//
//   2. **Doc-conformance** assertions over `SKILL.md` for the other
//      six cases — the prose IS the implementation contract that the
//      LLM consumes; if the prose mis-documents the gh-auth-fail flow,
//      the LLM will mis-execute it.
//
// The two-form smoke matches AC-STE-229.12's intent (mock the gh
// boundary) without inventing a runtime layer that the rest of the
// toolkit's skills don't have.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { scrubSecrets } from "../adapters/_shared/src/scrub_secrets";

const SKILL_PATH = join(
  import.meta.dir,
  "..",
  "skills",
  "report-issue",
  "SKILL.md",
);

function readSkill(): string {
  if (!existsSync(SKILL_PATH)) {
    throw new Error(`SKILL.md not found at ${SKILL_PATH}`);
  }
  return readFileSync(SKILL_PATH, "utf-8");
}

// -----------------------------------------------------------------------------
// Case 1 — gh-auth-fail refusal path (AC-STE-229.2 / AC-STE-229.12 #1).
// -----------------------------------------------------------------------------

describe("AC-STE-229.12 #1 — gh-auth-fail refusal path is documented", () => {
  test("SKILL.md probes `gh auth status` before any data collection", () => {
    const body = readSkill();
    expect(body).toMatch(/gh auth status/);
    // The probe must run BEFORE narrative collection — assert document
    // order: the gh-auth-status reference appears before the four
    // canonical Socratic prompts.
    const probeIdx = body.indexOf("gh auth status");
    const firstPromptIdx = body.indexOf("What happened?");
    expect(probeIdx).toBeGreaterThan(-1);
    expect(firstPromptIdx).toBeGreaterThan(-1);
    expect(probeIdx).toBeLessThan(firstPromptIdx);
  });

  test("SKILL.md documents NFR-10-shape refusal + remedy `gh auth login` + non-zero exit + zero side effects", () => {
    const body = readSkill();
    expect(body).toContain("gh auth login");
    expect(body).toMatch(/refus/i);
    expect(body).toMatch(/non-zero/i);
    // "writes nothing" or "no temp directory" — the zero-side-effects guarantee.
    expect(body).toMatch(/write[s]?\s+nothing|no temp/i);
  });
});

// -----------------------------------------------------------------------------
// Case 2 — default-mode payload shape (AC-STE-229.3 / AC-STE-229.7).
// -----------------------------------------------------------------------------

describe("AC-STE-229.12 #2 — default-mode payload shape", () => {
  test("SKILL.md lists report.md and metadata.json as default-mode artifacts", () => {
    const body = readSkill();
    expect(body).toContain("report.md");
    expect(body).toContain("metadata.json");
  });

  test("SKILL.md scopes transcript.jsonl to full mode only", () => {
    const body = readSkill();
    expect(body).toContain("transcript.jsonl");
    // The transcript must be opt-in; assert prose mentions `--full` or
    // the `[y/N]` prompt as the gate before bundling.
    expect(body).toMatch(/--full/);
    expect(body).toMatch(/\[y\/N\]|y\/N/);
  });
});

// -----------------------------------------------------------------------------
// Case 3 — full-mode payload shape (AC-STE-229.4 / AC-STE-229.7).
// -----------------------------------------------------------------------------

describe("AC-STE-229.12 #3 — full-mode payload shape", () => {
  test("SKILL.md documents the JSONL session location + slug derivation + env-var resolution", () => {
    const body = readSkill();
    // The path is rooted at `<config-dir>/projects/<cwd-slug>` where
    // `<config-dir>` honors `CLAUDE_CONFIG_DIR` and falls back to
    // `~/.claude`. Both tokens must appear so operators on a
    // non-default config root see the correct resolution rule.
    expect(body).toContain("<config-dir>/projects/");
    expect(body).toContain("CLAUDE_CONFIG_DIR");
    expect(body).toContain("~/.claude");
    expect(body).toContain("<cwd-slug>");
    // The slug derivation: every `/` is replaced by `-`. Assert both
    // tokens appear together in a single paragraph.
    expect(body).toMatch(/every\s+`?\/`?\s+replac\w+\s+(by|with)\s+`?-`?/i);
  });

  test("SKILL.md cites findCurrentSession and the mtime heuristic", () => {
    const body = readSkill();
    expect(body).toContain("findCurrentSession");
    expect(body).toMatch(/mtime/i);
  });

  test("SKILL.md handles the null-resolved-path case gracefully (does not fail the skill)", () => {
    const body = readSkill();
    // Either "transcript unavailable" or an equivalent graceful note —
    // the contract is that null does not throw; the skill continues
    // without the transcript.
    expect(body).toMatch(/transcript unavailable|transcript[^.]*not found|continue without/i);
  });
});

// -----------------------------------------------------------------------------
// Case 4 — redaction fixture (AC-STE-229.6 + AC-STE-229.12 #4).
//
// Runtime case: build a fixture string containing one planted secret
// per `SECRET_PATTERNS` entry, run it through `scrubSecrets`, and
// assert no literal secret survives in the captured payload.
// -----------------------------------------------------------------------------

describe("AC-STE-229.12 #4 — redaction (planted secrets absent from payload)", () => {
  test("seven planted secrets are scrubbed from a fixture settings-style string", () => {
    // AWS-shaped values are concatenated at runtime so the source bytes
    // never carry the full literal — see the same note in
    // scrub_secrets.test.ts.
    const awsAkia = "AKIA" + "ABCDEFGH" + "IJKLMNOP";
    const awsSecret =
      "AbCdEfGhIj" + "KlMnOpQrSt" + "UvWxYz01" + "23456789" + "AbCd";
    const fixture = [
      "ANTHROPIC=sk-ant-abcdefghijklmnopqrst",
      "OPENAI=sk-zyxwvutsrqponmlkjihg1",
      "GH=ghp_abcdefghijklmnopqrst",
      `AWS_ID=${awsAkia}`,
      `api_key="topsecret123"`,
      "JWT=eyJabcdef.eyJghijkl.signaturepart",
      `aws_secret_access_key=${awsSecret}`,
    ].join("\n");
    const { scrubbed, matches } = scrubSecrets(fixture);
    // Every planted-secret literal must be absent from the output.
    expect(scrubbed).not.toContain("sk-ant-abcdefghijklmnopqrst");
    expect(scrubbed).not.toContain("zyxwvutsrqponmlkjihg1");
    expect(scrubbed).not.toContain("ghp_abcdefghijklmnopqrst");
    expect(scrubbed).not.toContain(awsAkia);
    expect(scrubbed).not.toContain("topsecret123");
    expect(scrubbed).not.toContain("eyJabcdef.eyJghijkl.signaturepart");
    expect(scrubbed).not.toContain(awsSecret);
    // At least seven matches across the seven pattern keys.
    const totalCount = matches.reduce(
      (acc: number, m: { count: number }) => acc + m.count,
      0,
    );
    expect(totalCount).toBeGreaterThanOrEqual(7);
  });
});

// -----------------------------------------------------------------------------
// Case 5 — preview-gate `n`-decline path (AC-STE-229.8 / AC-STE-229.12 #5).
// -----------------------------------------------------------------------------

describe("AC-STE-229.12 #5 — preview-gate `n`-decline path", () => {
  test("SKILL.md documents the n-decline → emit row → delete tmp → non-zero exit chain", () => {
    const body = readSkill();
    expect(body).toContain("report_issue_declined");
    expect(body).toMatch(/decline|`n`/i);
    expect(body).toMatch(/rm -rf|delete[s]?[^.]*temp|temp[^.]*delete/i);
    expect(body).toMatch(/non-zero|exit non-zero/i);
    // The decline path must NOT call `gh gist create`.
    expect(body).toMatch(/(do not|never|not).{0,80}(gh gist create|publish)/i);
  });
});

// -----------------------------------------------------------------------------
// Case 6 — closing-summary byte floor (AC-STE-229.9 / AC-STE-229.12 #6).
// -----------------------------------------------------------------------------

describe("AC-STE-229.12 #6 — closing-summary byte floor (>=100)", () => {
  test("SKILL.md documents the >=100-byte floor for the closing summary", () => {
    const body = readSkill();
    // The byte floor must be cited verbatim or as a clear regression
    // signal phrase.
    expect(body).toMatch(/100\s*byte|>=\s*100|>=100/);
  });

  test("SKILL.md documents both `Next:` paths verbatim", () => {
    const body = readSkill();
    expect(body).toContain(
      "Share this URL with the plugin maintainer for triage.",
    );
    expect(body).toContain(
      "Or run /dev-process-toolkit:brainstorm <gist-url> to self-debug",
    );
  });
});

// -----------------------------------------------------------------------------
// Case 7 — marker-present auto-push (AC-STE-229.8 / AC-STE-229.12 #7).
// -----------------------------------------------------------------------------

describe("AC-STE-229.12 #7 — marker-present auto-push", () => {
  test("SKILL.md cites the literal auto-approve marker (byte-grep, no inference)", () => {
    const body = readSkill();
    expect(body).toContain("<dpt:auto-approve>v1</dpt:auto-approve>");
  });

  test("SKILL.md emits `report_issue_default_applied` when the marker drives auto-push", () => {
    const body = readSkill();
    expect(body).toContain("report_issue_default_applied");
  });

  test("SKILL.md cites the canonical `gh gist create -s -d` argument shape", () => {
    const body = readSkill();
    expect(body).toContain("gh gist create -s -d");
  });
});
