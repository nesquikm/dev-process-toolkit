import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// STE-175 — /smoke-test driver hardening (project-local skill at
// .claude/skills/smoke-test/SKILL.md). Doc-conformance: Phase 0.5 scratch
// reset + pre-flight #5 team-by-key + --reset flag.
// Extended STE-226 — auto-approve marker injected into every prompt-bearing
// `claude -p` spawn snippet in `.claude/skills/{smoke-test,conformance-loop}/SKILL.md`.

const repoRoot = join(import.meta.dir, "..", "..", "..");
const skillPath = join(repoRoot, ".claude", "skills", "smoke-test", "SKILL.md");
const conformanceLoopPath = join(
  repoRoot,
  ".claude",
  "skills",
  "conformance-loop",
  "SKILL.md",
);

const MARKER = "<dpt:auto-approve>v1</dpt:auto-approve>";

function readSkillIfPresent(): string | null {
  if (!existsSync(skillPath)) return null;
  return readFileSync(skillPath, "utf8");
}

function readConformanceLoopIfPresent(): string | null {
  if (!existsSync(conformanceLoopPath)) return null;
  return readFileSync(conformanceLoopPath, "utf8");
}

// The smoke-test skill is project-local and may not exist in every checkout
// (e.g., a downstream user's clone of just the plugin). Skip the suite when
// missing — STE-175 only governs the dogfood-side surface.
const skill = readSkillIfPresent();
const describeIfPresent = skill === null ? describe.skip : describe;

const conformanceLoop = readConformanceLoopIfPresent();
const describeIfConformanceLoopPresent =
  conformanceLoop === null ? describe.skip : describe;

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length;
  }
  return count;
}

/**
 * Extract every fenced ```bash block whose body contains `claude -p ` AND a
 * heredoc-on-stdin shape (`<<'PROMPT_EOF'`, `<<PROMPT_EOF`, `<<${EOF_TAG}`,
 * `<<'<some-tag>'`). Returns the inner block text (between the fence
 * markers, exclusive of the fence lines). Used to scope the marker
 * assertion to canonical prompt-bearing spawn snippets — non-prompt-bearing
 * `< /dev/null` snippets are not in this scope.
 */
// Mirrors the production probe's heredoc detection regex
// (`adapters/_shared/src/auto_approve_marker.ts` HEREDOC_RE). Kept in
// shape-sync with the probe so the test surface and the runtime probe
// flag the same fence set; divergence would silently leave a heredoc
// shape covered by one but not the other.
const HEREDOC_RE_TEST =
  /<<\s*(?:['"]?[A-Za-z_][\w]*['"]?|\$\{[A-Za-z_][\w]*\})/;

function extractPromptBearingSpawnFences(body: string): string[] {
  const fences: string[] = [];
  const lines = body.split("\n");
  let inFence = false;
  let buf: string[] = [];
  for (const line of lines) {
    if (/^```bash\s*$/.test(line)) {
      inFence = true;
      buf = [];
      continue;
    }
    if (inFence && /^```\s*$/.test(line)) {
      const block = buf.join("\n");
      // Only collect blocks with a `claude -p` invocation AND a
      // heredoc-on-stdin shape — these are the prompt-bearing canonical
      // spawns.
      if (/\bclaude\s+-p\b/.test(block) && HEREDOC_RE_TEST.test(block)) {
        fences.push(block);
      }
      inFence = false;
      buf = [];
      continue;
    }
    if (inFence) buf.push(line);
  }
  return fences;
}

describeIfPresent("STE-175 AC-STE-175.1 — Phase 0.5 scratch-reset block", () => {
  test("Phase 0.5 heading exists between Phase 0 and Phase 1", () => {
    const body = skill!;
    const phase0 = body.indexOf("Phase 0 — Pre-approval");
    const phase05 = body.search(/Phase 0\.5\b/);
    const phase1 = body.indexOf("Phase 1 — Setup");
    expect(phase0).toBeGreaterThan(-1);
    expect(phase05).toBeGreaterThan(phase0);
    expect(phase1).toBeGreaterThan(phase05);
  });

  test("Phase 0.5 clears /tmp/dpt-smoke-prompt-*.txt and per-tracker logs", () => {
    const body = skill!;
    expect(body).toMatch(/rm -f\s+\/tmp\/dpt-smoke-prompt-\*\.txt/);
    expect(body).toMatch(/\/tmp\/dpt-smoke-<tracker>-\*\.log/);
  });

  test("Phase 0.5 explicitly preserves findings files + approval files", () => {
    const body = skill!;
    // The prose must call out the audit-trail artifacts so a future edit
    // doesn't widen the rm to include them.
    expect(body).toMatch(/findings/i);
    expect(body).toMatch(/approval/i);
    expect(body).toMatch(/(do NOT|do not|preserve|retain|never delete)/i);
  });
});

describeIfPresent("STE-175 AC-STE-175.2 — pre-flight #5 probes Linear team by key", () => {
  test("pre-flight #5 names a key-first probe (get_team or list_teams + key filter)", () => {
    const body = skill!;
    // Either `mcp__linear__get_team` (direct lookup) or a list_teams call
    // with a `team.key ==` filter.
    expect(body).toMatch(/mcp__linear__get_team|team\.key\s*==/);
  });

  test("pre-flight #5 keeps name-prefix `query=` only as fallback", () => {
    const body = skill!;
    // The prose must commit to "key first, name-prefix fallback" ordering.
    expect(body).toMatch(/fallback|fall back/i);
    expect(body).toMatch(/query=/);
  });
});

describeIfPresent("STE-175 AC-STE-175.3 — --reset flag", () => {
  test("argument-parsing section names --reset", () => {
    const body = skill!;
    // Argument-parsing block must declare the new flag.
    const argSection = body.indexOf("## Argument parsing");
    expect(argSection).toBeGreaterThan(-1);
    const tail = body.slice(argSection);
    expect(tail).toMatch(/--reset\b/);
  });

  test("--reset triggers `rm -rf ../dpt-test-project-<tracker>` from pre-flight #2", () => {
    const body = skill!;
    // Pre-flight #2 must explain the flag's effect.
    expect(body).toMatch(/--reset.*rm -rf|rm -rf.*--reset/i);
  });

  test("Phase 0 contract surfaces the RESET line when the flag is present", () => {
    const body = skill!;
    expect(body).toContain(
      "RESET: existing ../dpt-test-project-<tracker> will be deleted before run.",
    );
  });

  test("default behavior unchanged — without --reset, pre-flight #2 still refuses", () => {
    const body = skill!;
    // Negative phrasing must stay so the operator-explicit deletion path
    // is preserved.
    expect(body).toMatch(/default behavior unchanged|without --reset/i);
  });
});

describeIfPresent("AC-STE-226.4 — marker injected into every prompt-bearing `claude -p` spawn snippet (smoke-test)", () => {
  test("every prompt-bearing spawn fence carries the canonical marker line on its own line", () => {
    const fences = extractPromptBearingSpawnFences(skill!);
    // The smoke-test SKILL.md must surface multiple prompt-bearing
    // spawn snippets; an empty result implies the regex shape drifted.
    expect(fences.length).toBeGreaterThan(0);
    for (const fence of fences) {
      expect(fence).toContain(MARKER);
      // The marker MUST appear on its own line (per the byte-checkable
      // detection contract). Reject embedded matches that aren't
      // line-anchored.
      expect(fence).toMatch(new RegExp(`^${MARKER}$`, "m"));
    }
  });

  test("global marker count meets the per-fence floor", () => {
    const body = skill!;
    const fences = extractPromptBearingSpawnFences(body);
    const markerCount = countOccurrences(body, MARKER);
    // The global count must be ≥ the number of canonical prompt-bearing
    // spawn fences (one marker per fence, per AC-STE-226.4).
    expect(markerCount).toBeGreaterThanOrEqual(fences.length);
  });

  test("Phase 2.X group 1 fixture documents both 1a (marker present) and 1b (marker absent) sub-fixtures", () => {
    const body = skill!;
    // Per AC-STE-226.1 / AC-STE-226.2, the smoke-test fixture must
    // exercise both runtime paths: marker present ⇒ audit rows;
    // marker absent ⇒ stdout halts at gate.
    expect(body).toMatch(/Sub-fixture 1a\b/);
    expect(body).toMatch(/Sub-fixture 1b\b/);
    // 1b's diagnostic shape — the inverse failure mode (marker absent
    // but auto-applied anyway) — must be named so the regression
    // catches LLM drift toward inferring auto-apply without the marker.
    expect(body).toMatch(/marker[-\s]absent[-\s]but[-\s]auto[-\s]applied/i);
  });
});

describeIfConformanceLoopPresent(
  "AC-STE-226.4 — marker injected into every prompt-bearing `claude -p` spawn snippet (conformance-loop)",
  () => {
    test("every prompt-bearing spawn fence in conformance-loop carries the marker line on its own line", () => {
      const fences = extractPromptBearingSpawnFences(conformanceLoop!);
      // Phase B fan-out spawns /spec-write + /implement; Phase A spawns
      // /smoke-test (which itself runs `claude -p` children inside).
      // The conformance-loop SKILL.md ships at least the Phase B
      // /spec-write spawn as a heredoc reference snippet.
      expect(fences.length).toBeGreaterThan(0);
      for (const fence of fences) {
        expect(fence).toContain(MARKER);
        expect(fence).toMatch(new RegExp(`^${MARKER}$`, "m"));
      }
    });

    test("conformance-loop carries the marker at least 4 times (Phase A linear + jira + Phase B spec-write + implement)", () => {
      const body = conformanceLoop!;
      // Per FR plan task #4 verify line: ≥ 4 marker occurrences.
      expect(countOccurrences(body, MARKER)).toBeGreaterThanOrEqual(4);
    });
  },
);
