import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// STE-224 AC-STE-224.5 + AC-STE-224.10 — Phase A parallel spawn + cross-tracker
// dedup heuristic doc-conformance.

const repoRoot = join(import.meta.dir, "..", "..", "..");
const skillPath = join(repoRoot, ".claude", "skills", "conformance-loop", "SKILL.md");

function readSkillIfPresent(): string | null {
  if (!existsSync(skillPath)) return null;
  return readFileSync(skillPath, "utf8");
}

const skill = readSkillIfPresent();
const describeIfPresent = skill === null ? describe.skip : describe;

describeIfPresent("STE-224 AC-STE-224.5 — Phase A parallel /smoke-test fan-out", () => {
  test("Phase A documents the parallel two-tracker subprocess spawn", () => {
    const body = skill!;
    // Both /smoke-test invocations must appear (one per tracker), each
    // wrapped as a single quoted positional per STE-325 (the bare-arg
    // form was rejected by the `claude` CLI as
    // `error: unknown option '--tracker'`).
    expect(body).toMatch(/claude -p\s+"\/smoke-test\s+--tracker\s+linear/);
    expect(body).toMatch(/claude -p\s+"\/smoke-test\s+--tracker\s+jira/);
  });

  test("Phase A backgrounds the children with & and waits via wait <PID>", () => {
    const body = skill!;
    // Bash heredoc with `&` and `wait` — the canonical parallelism mechanism.
    expect(body).toMatch(/&\s*\nPID_LINEAR=/);
    expect(body).toMatch(/&\s*\nPID_JIRA=/);
    expect(body).toMatch(/wait\s+"\$\{PID_LINEAR\}"/);
    expect(body).toMatch(/wait\s+"\$\{PID_JIRA\}"/);
  });

  test("Phase A fails fast if either subprocess returns non-zero", () => {
    const body = skill!;
    expect(body).toMatch(/Fail-fast/i);
    expect(body).toMatch(/RC_LINEAR/);
    expect(body).toMatch(/RC_JIRA/);
    // Must explicitly check both return codes and exit non-zero on either failure.
    expect(body).toMatch(/RC_LINEAR.*-ne\s*0[\s\S]{0,80}RC_JIRA.*-ne\s*0/);
  });

  test("aggregator reads the canonical per-tracker findings paths", () => {
    const body = skill!;
    expect(body).toMatch(/\/tmp\/dpt-smoke-findings-\$\{?DATE\}?-linear\.md/);
    expect(body).toMatch(/\/tmp\/dpt-smoke-findings-\$\{?DATE\}?-jira\.md/);
  });

  test("aggregator emits per-iteration unified report at the canonical path", () => {
    const body = skill!;
    expect(body).toMatch(/\/tmp\/dpt-conformance-loop-\$\{?DATE\}?-iter-\$\{?ITER\}?\.md/);
  });

  test("Phase A documents NO /smoke-test changes (existing canonical paths)", () => {
    const body = skill!;
    expect(body).toMatch(/no\s+`?\/smoke-test`?\s+changes/i);
  });

  test("parallelism mechanism is Bash subprocess, NOT agent-team", () => {
    const body = skill!;
    expect(body).toMatch(/Bash subprocess parallelism/i);
    expect(body).toMatch(/NOT the agent-team primitive/i);
  });
});

describeIfPresent("STE-224 AC-STE-224.10 — cross-tracker dedup heuristic", () => {
  test("dedup section names both passes (exact-match + fuzzy overlap)", () => {
    const body = skill!;
    const dedupAt = body.search(/Cross-tracker dedup/i);
    expect(dedupAt).toBeGreaterThan(-1);
    const tail = body.slice(dedupAt);
    expect(tail).toMatch(/Exact-match pass/i);
    expect(tail).toMatch(/Fuzzy-overlap pass/i);
  });

  test("exact-match pass uses the STE-<N> runtime regression diagnostic line", () => {
    const body = skill!;
    expect(body).toMatch(/STE-<N> runtime regression: <fixture>/);
  });

  test("fuzzy-overlap pass uses ≥80% normalized-body substring overlap", () => {
    const body = skill!;
    expect(body).toMatch(/(>=|≥)\s*80%/);
    expect(body).toMatch(/normalized?[\s-]?body/i);
    expect(body).toMatch(/substring overlap/i);
  });

  test("dedup hits carry tracker-coverage: [linear, jira] metadata", () => {
    const body = skill!;
    expect(body).toMatch(/tracker-coverage:\s*\[linear,\s*jira\]/);
  });

  test("fuzzy-overlap hits carry the ~probable-dup flag for operator review", () => {
    const body = skill!;
    expect(body).toContain("~probable-dup");
    expect(body).toMatch(/operator review/i);
  });

  test("single-tracker findings carry tracker-coverage: [linear] or [jira]", () => {
    const body = skill!;
    expect(body).toMatch(/tracker-coverage:\s*\[linear\]/);
    expect(body).toMatch(/tracker-coverage:\s*\[jira\]/);
  });

  test("aggregated entry is never duplicated — exactly one entry per unique regression", () => {
    const body = skill!;
    expect(body).toMatch(/never duplicated|exactly one entry/i);
  });
});
