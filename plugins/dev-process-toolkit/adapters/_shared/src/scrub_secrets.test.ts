// Tests for scrub_secrets — STE-229 AC-STE-229.6.
//
// Pure unit tests against `SECRET_PATTERNS` and `scrubSecrets(text)`. The
// module is pure (no I/O) so the tests are fast and deterministic.

import { describe, expect, test } from "bun:test";
import { SECRET_PATTERNS, scrubSecrets, type ScrubMatch } from "./scrub_secrets";

const REDACTED = "***REDACTED***";

// 7 planted secrets — one per `SECRET_PATTERNS` entry, in the FR's
// documented order. Each fixture is a real-shape literal so the regexes
// fire on the same input the wild would emit. AWS-shaped fixtures are
// concatenated at runtime so the source bytes never carry the full
// literal pattern (otherwise GitHub's secret-scanner blocks the push,
// even though the values are obviously fake).
const AWS_AKIA_BODY = "ABCDEFGH" + "IJKLMNOP";
const AWS_SECRET_VALUE =
  "AbCdEfGhIj" + "KlMnOpQrSt" + "UvWxYz01" + "23456789" + "AbCd";
const PLANTED = {
  anthropic: "sk-ant-abcdefghijklmnopqrst",                                // 20 chars after `sk-ant-`
  openai: "sk-abcdefghijklmnopqrstuv",                                     // 22 chars after `sk-`
  githubPat: "ghp_abcdefghijklmnopqrst",                                   // 20 chars after `ghp_`
  awsAccessKey: "AKIA" + AWS_AKIA_BODY,                                    // 16 alnum-upper chars after AKIA
  genericKeyValue: "api_key=topsecret123",                                 // 12 chars value
  jwt: "eyJabcdef.eyJghijkl.signaturepart",
  awsSecret: `aws_secret_access_key=${AWS_SECRET_VALUE}`,                  // 40 base64-ish chars
};

describe("SECRET_PATTERNS shape", () => {
  test("exposes exactly seven entries", () => {
    expect(SECRET_PATTERNS.length).toBe(7);
  });

  test("each entry has key + pattern fields", () => {
    for (const entry of SECRET_PATTERNS) {
      expect(typeof entry.key).toBe("string");
      expect(entry.key.length).toBeGreaterThan(0);
      expect(entry.pattern).toBeInstanceOf(RegExp);
    }
  });

  test("key set covers the seven canonical pattern names", () => {
    const keys = SECRET_PATTERNS.map((e: { key: string }) => e.key).sort();
    expect(keys).toEqual(
      [
        "anthropic_api_key",
        "aws_access_key",
        "aws_secret_key",
        "generic_key_value",
        "github_pat",
        "jwt",
        "openai_api_key",
      ].sort(),
    );
  });
});

describe("scrubSecrets — per-pattern redaction", () => {
  test("Anthropic API key is redacted", () => {
    const { scrubbed, matches } = scrubSecrets(PLANTED.anthropic);
    expect(scrubbed).toBe(REDACTED);
    expect(scrubbed).not.toContain("sk-ant-");
    const ant = matches.find((m: ScrubMatch) => m.pattern === "anthropic_api_key");
    expect(ant?.count).toBe(1);
  });

  test("OpenAI API key is redacted", () => {
    const { scrubbed, matches } = scrubSecrets(PLANTED.openai);
    expect(scrubbed).toBe(REDACTED);
    expect(scrubbed).not.toContain("sk-");
    const oa = matches.find((m: ScrubMatch) => m.pattern === "openai_api_key");
    expect(oa?.count).toBe(1);
  });

  test("OpenAI v2 project key (sk-proj-…) is redacted", () => {
    // v2 project keys carry hyphens after the `sk-proj-` prefix; the
    // legacy alphanumeric-only char class would have truncated the
    // match at 4 chars and slipped the key through unredacted.
    const v2 = "sk-proj-AbCd-EfGh_IjKl-MnOp1234567890_AbCdEfGh";
    const { scrubbed, matches } = scrubSecrets(v2);
    expect(scrubbed).toBe(REDACTED);
    expect(scrubbed).not.toContain("AbCd-EfGh");
    const oa = matches.find((m: ScrubMatch) => m.pattern === "openai_api_key");
    expect(oa?.count).toBe(1);
  });

  test("GitHub PAT (ghp_) is redacted", () => {
    const { scrubbed } = scrubSecrets(PLANTED.githubPat);
    expect(scrubbed).toBe(REDACTED);
  });

  test("GitHub PAT covers gho_, ghu_, ghs_ prefixes too", () => {
    for (const prefix of ["gho_", "ghu_", "ghs_"]) {
      const planted = `${prefix}abcdefghijklmnopqrst`;
      const { scrubbed, matches } = scrubSecrets(planted);
      expect(scrubbed).toBe(REDACTED);
      const gh = matches.find((m: ScrubMatch) => m.pattern === "github_pat");
      expect(gh?.count).toBe(1);
    }
  });

  test("AWS access key (AKIA…) is redacted", () => {
    const { scrubbed, matches } = scrubSecrets(PLANTED.awsAccessKey);
    expect(scrubbed).toBe(REDACTED);
    const aws = matches.find((m: ScrubMatch) => m.pattern === "aws_access_key");
    expect(aws?.count).toBe(1);
  });

  test("Generic key=value preserves the key name", () => {
    const { scrubbed, matches } = scrubSecrets(PLANTED.genericKeyValue);
    expect(scrubbed).toBe("api_key=***REDACTED***");
    expect(scrubbed).not.toContain("topsecret");
    const gen = matches.find((m: ScrubMatch) => m.pattern === "generic_key_value");
    expect(gen?.count).toBe(1);
  });

  test("Generic key=value supports hyphenated and quoted forms", () => {
    const r1 = scrubSecrets("api-key=topsecret123");
    expect(r1.scrubbed).toBe("api-key=***REDACTED***");
    const r2 = scrubSecrets(`token: "abcdefgh1"`);
    expect(r2.scrubbed.toLowerCase()).toContain("token");
    expect(r2.scrubbed).toContain("***REDACTED***");
    expect(r2.scrubbed).not.toContain("abcdefgh1");
    const r3 = scrubSecrets(`PASSWORD = 'mysecret123'`);
    expect(r3.scrubbed.toLowerCase()).toContain("password");
    expect(r3.scrubbed).toContain("***REDACTED***");
    expect(r3.scrubbed).not.toContain("mysecret123");
  });

  test("Generic key=value normalizes separator to `=` per the FR replacement template", () => {
    // The FR's AC-STE-229.6 replacement is literally `<key>=***REDACTED***`
    // — the `=` in the replacement is the spec contract, not the
    // original input separator. So `token: abcdefgh1` → `token=***REDACTED***`,
    // collapsing whitespace and the `:` separator into a single `=`.
    // This is intentional canonicalization for triage readability.
    const colonForm = scrubSecrets("token: abcdefgh1");
    expect(colonForm.scrubbed).toBe("token=***REDACTED***");
    const equalsForm = scrubSecrets("token=abcdefgh1");
    expect(equalsForm.scrubbed).toBe("token=***REDACTED***");
    const wideSpaceForm = scrubSecrets("PASSWORD   =   abcdefgh1");
    expect(wideSpaceForm.scrubbed).toBe("PASSWORD=***REDACTED***");
  });

  test("Generic key=value preserves an unmatched trailing closing quote (cosmetic — the secret value is still gone)", () => {
    // The regex matches the value chars but not the closing quote, so
    // the dangling `"` survives. This is non-load-bearing — the secret
    // content is redacted; the trailing quote is just literal cruft.
    // Tests assert the contract so future readers don't think the
    // dangling quote is a redaction leak.
    const r = scrubSecrets(`token: "abcdefgh1"`);
    expect(r.scrubbed).toBe(`token=***REDACTED***"`);
    expect(r.scrubbed).not.toContain("abcdefgh1");
  });

  test("JWT token is redacted", () => {
    const { scrubbed } = scrubSecrets(PLANTED.jwt);
    expect(scrubbed).toBe(REDACTED);
  });

  test("AWS secret access key (40-char heuristic) is redacted", () => {
    const { scrubbed } = scrubSecrets(PLANTED.awsSecret);
    expect(scrubbed).not.toContain(AWS_SECRET_VALUE);
    expect(scrubbed).toContain("***REDACTED***");
  });
});

describe("scrubSecrets — longest-prefix-first ordering (Anthropic vs OpenAI)", () => {
  test("Anthropic key is attributed to anthropic_api_key, not openai_api_key", () => {
    const { matches } = scrubSecrets(PLANTED.anthropic);
    const anthropic = matches.find((m: ScrubMatch) => m.pattern === "anthropic_api_key");
    const openai = matches.find((m: ScrubMatch) => m.pattern === "openai_api_key");
    expect(anthropic?.count).toBe(1);
    expect(openai?.count ?? 0).toBe(0);
  });

  test("Anthropic and OpenAI keys in the same string both attribute correctly", () => {
    const text = `${PLANTED.anthropic} and also ${PLANTED.openai}`;
    const { scrubbed, matches } = scrubSecrets(text);
    expect(scrubbed).not.toContain("sk-ant-");
    expect(scrubbed).not.toContain("abcdefghijklmnopqrstuv");
    const anthropic = matches.find((m: ScrubMatch) => m.pattern === "anthropic_api_key");
    const openai = matches.find((m: ScrubMatch) => m.pattern === "openai_api_key");
    expect(anthropic?.count).toBe(1);
    expect(openai?.count).toBe(1);
  });
});

describe("scrubSecrets — multi-pattern fixture (planted-secret coverage)", () => {
  test("a fixture with one planted secret per pattern leaks none verbatim", () => {
    const fixture = [
      `Anthropic: ${PLANTED.anthropic}`,
      `OpenAI: ${PLANTED.openai}`,
      `GitHub: ${PLANTED.githubPat}`,
      `AWS access: ${PLANTED.awsAccessKey}`,
      `Generic: ${PLANTED.genericKeyValue}`,
      `JWT: ${PLANTED.jwt}`,
      `${PLANTED.awsSecret}`,
    ].join("\n");
    const { scrubbed, matches } = scrubSecrets(fixture);
    // Every planted-secret literal must be absent from the output.
    expect(scrubbed).not.toContain(PLANTED.anthropic);
    expect(scrubbed).not.toContain("abcdefghijklmnopqrstuv"); // openai value
    expect(scrubbed).not.toContain(PLANTED.githubPat);
    expect(scrubbed).not.toContain(PLANTED.awsAccessKey);
    expect(scrubbed).not.toContain("topsecret123");
    expect(scrubbed).not.toContain(PLANTED.jwt);
    expect(scrubbed).not.toContain(AWS_SECRET_VALUE);
    // Every pattern fired at least once.
    for (const key of [
      "anthropic_api_key",
      "openai_api_key",
      "github_pat",
      "aws_access_key",
      "generic_key_value",
      "jwt",
      "aws_secret_key",
    ]) {
      const m = matches.find((entry: ScrubMatch) => entry.pattern === key);
      expect(m).toBeDefined();
      expect(m!.count).toBeGreaterThan(0);
    }
  });
});

describe("scrubSecrets — false-positive avoidance", () => {
  test("plain prose without secrets is unchanged", () => {
    const text = "the build failed during gate-check; see logs for details";
    const { scrubbed, matches } = scrubSecrets(text);
    expect(scrubbed).toBe(text);
    for (const m of matches) {
      expect(m.count).toBe(0);
    }
  });

  test("the literal phrase 'api key' (no equals) is not redacted", () => {
    const text = "Set the api key in your shell profile";
    const { scrubbed } = scrubSecrets(text);
    expect(scrubbed).toBe(text);
  });
});

describe("scrubSecrets — return-shape contract", () => {
  test("result is { scrubbed: string, matches: { pattern, count }[] }", () => {
    const r = scrubSecrets("nothing to redact here");
    expect(typeof r.scrubbed).toBe("string");
    expect(Array.isArray(r.matches)).toBe(true);
    for (const m of r.matches) {
      expect(typeof m.pattern).toBe("string");
      expect(typeof m.count).toBe("number");
    }
  });

  test("matches array covers every SECRET_PATTERNS key (zero counts allowed)", () => {
    const r = scrubSecrets("nothing to redact here");
    const keys = new Set(r.matches.map((m: ScrubMatch) => m.pattern));
    for (const entry of SECRET_PATTERNS) {
      expect(keys.has(entry.key)).toBe(true);
    }
  });

  test("repeated invocation is idempotent on already-scrubbed text", () => {
    const once = scrubSecrets(PLANTED.anthropic).scrubbed;
    const twice = scrubSecrets(once).scrubbed;
    expect(twice).toBe(once);
  });
});
