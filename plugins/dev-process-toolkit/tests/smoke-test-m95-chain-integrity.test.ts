import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// M95 "smoke-driver chain integrity" — prose-conformance meta-tests for the
// project-local /smoke-test SKILL.md. This file carries the M95 family;
// each FR gets its own describe blocks.
//
// STE-354 — Scope Phase 0.5 mcp-config cleanup to the resolved tracker.
//
// AC-STE-354.1: Phase 0.5 removes only `dpt-smoke-mcp-config-<tracker>.json`
//   (the resolved tracker's own file); no cross-tracker `mcp-config-*` glob
//   remains in the cleanup block.
//
// AC-STE-354.2: the STE-186 stale-cleanup intent is preserved and documented
//   as compatible — each leg cleans its own stale config, so staleness
//   coverage is unchanged; § Operator-driven parallelism prose and the
//   Phase 0.5 cleanup line agree.
//
// STE-355 — Grandchild spawn lifecycle: deterministic completion +
//   truncation assertion (2026-07-02 findings F2 + F3 — both legs truncated
//   silently: the /implement grandchild was SIGTERM'd at the harness's
//   10-minute foreground Bash ceiling, and both children fired background
//   spawns then exited RC 0 "waiting for its completion notification").
//
// AC-STE-355.1: every canonical-chain grandchild spawn in § Phase 2 uses a
//   detached-spawn + bounded-poll-until-exit wrapper (PID captured to
//   /tmp/dpt-smoke-<tracker>-<skill>.pid, then `kill -0` + `sleep 30` poll
//   calls until exit); no bare foreground `claude -p` canonical-chain spawn
//   remains; ending the session with a live pidfile is forbidden.
//
// AC-STE-355.2: a chain-integrity assertion step sits between Phase 2.X and
//   Phase 3, wired to assertChainIntegrity (smoke_child_capture): every
//   expected per-skill capture must exist, be non-empty, and carry a
//   stream-json `result` event; any miss is a high-severity
//   `STE-355 regression: chain truncated — <child> (...)` finding and bars
//   the run from a green summary.
//
// AC-STE-355.3: /conformance-loop Phase A mirrors the check — each leg's
//   expected grandchild log set must be complete and result-bearing before
//   aggregation; an incomplete leg (or a fire-and-exit final message) is a
//   failed leg regardless of RC 0, aborting via the same fail-fast path as
//   a non-zero RC.

const repoRoot = join(import.meta.dir, "..", "..", "..");
const skillPath = join(repoRoot, ".claude", "skills", "smoke-test", "SKILL.md");
const conformanceLoopPath = join(
  repoRoot,
  ".claude",
  "skills",
  "conformance-loop",
  "SKILL.md",
);

function readSkillIfPresent(): string | null {
  if (!existsSync(skillPath)) return null;
  return readFileSync(skillPath, "utf8");
}

function readConformanceLoopIfPresent(): string | null {
  if (!existsSync(conformanceLoopPath)) return null;
  return readFileSync(conformanceLoopPath, "utf8");
}

const skill = readSkillIfPresent();
const describeIfPresent = skill === null ? describe.skip : describe;

const conformanceLoop = readConformanceLoopIfPresent();
const describeIfConformanceLoopPresent =
  conformanceLoop === null ? describe.skip : describe;

function sectionSlice(
  body: string,
  startMarker: string,
  endMarker: string,
): string {
  const start = body.indexOf(startMarker);
  if (start === -1) return "";
  const end = body.indexOf(endMarker, start);
  return end === -1 ? body.slice(start) : body.slice(start, end);
}

// § Phase 0.5 — the stale-scratch cleanup block (heading through the next
// phase heading). Carries the rm fence plus its justification prose.
function phase05Slice(body: string): string {
  return sectionSlice(
    body,
    "### Phase 0.5 — Clear stale per-run scratch",
    "### Phase 1 — Setup",
  );
}

// § Operator-driven parallelism — the tandem-run isolation contract.
function parallelismSlice(body: string): string {
  return sectionSlice(
    body,
    "## Operator-driven parallelism",
    "## Argument parsing",
  );
}

// The single bash fence inside a section (Phase 0.5's fence is the rm line).
function firstBashFence(section: string): string {
  const match = section.match(/```bash\n([\s\S]*?)```/);
  return match ? match[1] : "";
}

// A literal `*` immediately after the mcp-config prefix = cross-tracker glob.
const CROSS_TRACKER_GLOB = /dpt-smoke-mcp-config-\*/;
const SCOPED_LITERAL = "/tmp/dpt-smoke-mcp-config-<tracker>.json";

describeIfPresent("AC-STE-354.1 — Phase 0.5 mcp-config cleanup is tracker-scoped", () => {
  test("the cleanup line removes only the resolved tracker's own mcp-config file", () => {
    const phase05 = phase05Slice(skill!);
    expect(phase05.length).toBeGreaterThan(0);
    const fence = firstBashFence(phase05);
    expect(fence.length).toBeGreaterThan(0);
    expect(fence).toContain(SCOPED_LITERAL);
  });

  test("no cross-tracker mcp-config-* glob remains anywhere in the Phase 0.5 cleanup block", () => {
    const phase05 = phase05Slice(skill!);
    expect(phase05.length).toBeGreaterThan(0);
    expect(phase05).not.toMatch(CROSS_TRACKER_GLOB);
  });

  test("no rm line anywhere in the skill wipes mcp-config cross-tracker", () => {
    const rmLines = skill!
      .split("\n")
      .filter((line) => /\brm -f\b/.test(line));
    expect(rmLines.length).toBeGreaterThan(0);
    for (const line of rmLines) {
      expect(line).not.toMatch(CROSS_TRACKER_GLOB);
    }
  });
});

describeIfPresent("AC-STE-354.2 — STE-186 staleness intent preserved; prose and cleanup line agree", () => {
  test("staleness coverage is unchanged: all three scratch prefixes still wiped, each leg cleans its own stale config", () => {
    const phase05 = phase05Slice(skill!);
    const fence = firstBashFence(phase05);
    // The other two prefixes survive the scoping change verbatim.
    expect(fence).toContain("/tmp/dpt-smoke-prompt-*.txt");
    expect(fence).toContain("/tmp/dpt-smoke-<tracker>-*.log");
    // The prose documents per-tracker scoping as staleness-compatible.
    expect(phase05).toMatch(
      /each (leg|tracker|invocation|run)[^\n]*its own stale/i,
    );
  });

  test("the old both-variants justification is rewritten to the tandem-race rationale", () => {
    const phase05 = phase05Slice(skill!);
    // The prose that documented the cross-tracker glob as a feature is gone.
    expect(phase05).not.toMatch(
      /matches both the `linear` and `jira` variants/,
    );
    // In its place: why the cross-tracker form is forbidden — it races the
    // concurrent tandem leg's Phase 1 step 5 write (2026-07-02 F1).
    expect(phase05).toMatch(/race/i);
    expect(phase05).toMatch(/tandem|concurrent/i);
    expect(phase05).toContain("Phase 1 step 5");
  });

  test("§ Operator-driven parallelism notes Phase 0.5 cleanup is per-tracker-scoped", () => {
    const parallelism = parallelismSlice(skill!);
    expect(parallelism.length).toBeGreaterThan(0);
    const phase05Mentions = parallelism
      .split("\n")
      .filter((line) => line.includes("Phase 0.5"));
    expect(phase05Mentions.length).toBeGreaterThan(0);
    expect(
      phase05Mentions.some((line) =>
        /per-tracker|tracker[- ]scoped|its own/i.test(line),
      ),
    ).toBe(true);
  });

  test("prose and cleanup line agree: both express the tracker-scoped form", () => {
    const fence = firstBashFence(phase05Slice(skill!));
    const parallelism = parallelismSlice(skill!);
    // Cleanup line implements the scoping...
    expect(fence).toContain(SCOPED_LITERAL);
    expect(fence).not.toMatch(CROSS_TRACKER_GLOB);
    // ...and the parallelism contract documents it (no contradiction).
    expect(parallelism).toContain("Phase 0.5");
    expect(parallelism).not.toMatch(CROSS_TRACKER_GLOB);
  });
});

// ---------------------------------------------------------------------------
// STE-355 helpers
// ---------------------------------------------------------------------------

const CANONICAL_SKILLS = [
  "setup",
  "spec-write",
  "implement",
  "gate-check",
  "spec-review",
  "simplify",
] as const;

// § Phase 2 — the canonical-chain spawn surface (heading through Phase 2.X).
function phase2Slice(body: string): string {
  return sectionSlice(
    body,
    "### Phase 2 — Run the canonical chain",
    "### Phase 2.X",
  );
}

// Every ```bash fence body inside a section.
function bashFences(section: string): string[] {
  const fences: string[] = [];
  const re = /```bash\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(section)) !== null) fences.push(match[1]);
  return fences;
}

// A fence that spawns a canonical-chain grandchild: a `claude -p` call
// captured to one of the six per-skill logs. (Phase 2.X fixture logs like
// `-spec-write-1b.log` deliberately do not match the anchored `.log`.)
const CANONICAL_LOG_RE =
  /\/tmp\/dpt-smoke-<tracker>-(setup|spec-write|implement|gate-check|spec-review|simplify)\.log/;

function canonicalSpawnFences(section: string): string[] {
  return bashFences(section).filter(
    (fence) => /claude -p/.test(fence) && CANONICAL_LOG_RE.test(fence),
  );
}

// The chain-integrity assertion step (AC-STE-355.2): its own heading between
// Phase 2.X and Phase 3. Returns "" when no such heading exists yet.
const CHAIN_INTEGRITY_HEADING_RE = /(^|\n)#{3,4} [^\n]*chain[- ]integrity/i;

function chainIntegrityStepSlice(body: string): string {
  const headingMatch = CHAIN_INTEGRITY_HEADING_RE.exec(body);
  if (!headingMatch) return "";
  const start = headingMatch.index;
  const end = body.indexOf("### Phase 3 — Capture", start);
  return end === -1 ? body.slice(start) : body.slice(start, end);
}

// § Phase A of /conformance-loop — fan-out + aggregation contract.
function phaseASlice(body: string): string {
  return sectionSlice(
    body,
    "### Phase A — Parallel /smoke-test fan-out + aggregation",
    "### Phase B",
  );
}

// Paragraph-proximity: some blank-line-delimited paragraph satisfies all
// the given patterns (avoids trivially matching two unrelated sentences).
function someParagraphMatches(body: string, patterns: RegExp[]): boolean {
  return body
    .split(/\n\n+/)
    .some((paragraph) => patterns.every((re) => re.test(paragraph)));
}

// ---------------------------------------------------------------------------
// AC-STE-355.1 — detached-spawn + bounded-poll wrapper pins
// ---------------------------------------------------------------------------

describeIfPresent("AC-STE-355.1 — Phase 2 grandchild spawns are detached + poll-until-exit", () => {
  test("every canonical per-skill spawn captures its PID to /tmp/dpt-smoke-<tracker>-<skill>.pid", () => {
    const phase2 = phase2Slice(skill!);
    expect(phase2.length).toBeGreaterThan(0);
    for (const name of CANONICAL_SKILLS) {
      expect(phase2).toContain(`/tmp/dpt-smoke-<tracker>-${name}.pid`);
    }
  });

  test("no bare foreground canonical-chain spawn remains — every spawn fence backgrounds with PID capture", () => {
    const fences = canonicalSpawnFences(phase2Slice(skill!));
    // Sanity: the spawn surface exists (non-prompt-bearing snippets,
    // heredoc-on-stdin snippets, and the STE-195 retry worked example).
    expect(fences.length).toBeGreaterThan(0);
    for (const fence of fences) {
      // Detached spawn: `claude -p … > log 2>&1 &` with the PID captured
      // (`echo $! > …pid`) — a fence lacking either is a foreground call
      // capped at the harness's 10-minute Bash ceiling.
      expect(fence).toContain("echo $!");
      expect(fence).toContain(".pid");
    }
  });

  test("Phase 2 carries the bounded poll loop: `kill -0` on the pidfile plus a short `sleep 30` per poll call", () => {
    const phase2 = phase2Slice(skill!);
    expect(phase2).toContain("kill -0");
    expect(phase2).toContain("sleep 30");
  });

  test("Phase 2 documents why: a single foreground Bash call caps the grandchild at the harness 10-minute ceiling", () => {
    expect(phase2Slice(skill!)).toMatch(/10-minute|600 ?s|ten-minute/i);
  });

  test("hard rule: ending the session with a live pidfile is forbidden — the poll loop is the only sanctioned wait", () => {
    // Same paragraph must tie the pidfile to the prohibition (a stray
    // "forbidden" elsewhere in the skill must not satisfy the rule).
    expect(someParagraphMatches(skill!, [/pidfile/i, /forbidden/i])).toBe(
      true,
    );
    expect(skill!).toMatch(/only sanctioned wait/i);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-355.2 — chain-integrity assertion step between Phase 2.X and Phase 3
// ---------------------------------------------------------------------------

describeIfPresent("AC-STE-355.2 — chain-integrity assertion step wired between Phase 2.X and Phase 3", () => {
  test("a chain-integrity step heading exists, positioned after Phase 2.X and before Phase 3", () => {
    const headingMatch = CHAIN_INTEGRITY_HEADING_RE.exec(skill!);
    expect(headingMatch).not.toBeNull();
    const headingIdx = headingMatch!.index;
    const phase2XIdx = skill!.indexOf("### Phase 2.X");
    const phase3Idx = skill!.indexOf("### Phase 3 — Capture");
    expect(phase2XIdx).toBeGreaterThan(-1);
    expect(phase3Idx).toBeGreaterThan(-1);
    expect(headingIdx).toBeGreaterThan(phase2XIdx);
    expect(headingIdx).toBeLessThan(phase3Idx);
  });

  test("the step reuses assertChainIntegrity from smoke_child_capture", () => {
    const step = chainIntegrityStepSlice(skill!);
    expect(step.length).toBeGreaterThan(0);
    expect(step).toContain("assertChainIntegrity");
    expect(step).toContain("smoke_child_capture");
  });

  test("the step asserts every expected per-skill capture — all six canonical skills named", () => {
    const step = chainIntegrityStepSlice(skill!);
    expect(step.length).toBeGreaterThan(0);
    for (const name of CANONICAL_SKILLS) {
      expect(step).toContain(name);
    }
  });

  test("the step requires each capture to exist, be non-empty, and carry a stream-json result event", () => {
    const step = chainIntegrityStepSlice(skill!);
    expect(step).toMatch(/non-empty/i);
    expect(step).toMatch(/result/);
  });

  test("any miss is the canonical high-severity truncation finding naming the child", () => {
    const step = chainIntegrityStepSlice(skill!);
    expect(step).toContain("STE-355 regression: chain truncated — ");
    expect(step).toMatch(/high/i);
  });

  test("a chain-integrity finding bars the run from a green summary", () => {
    const step = chainIntegrityStepSlice(skill!);
    expect(step).toMatch(
      /(never|barred|cannot)[^\n]*green|green[^\n]*(never|barred|cannot)|forces? the run summary to FAIL/i,
    );
  });
});

// ---------------------------------------------------------------------------
// AC-STE-355.3 — /conformance-loop Phase A leg-completeness mirror
// ---------------------------------------------------------------------------

describeIfConformanceLoopPresent("AC-STE-355.3 — conformance-loop Phase A verifies each leg's grandchild log set", () => {
  test("Phase A names the expected grandchild log set for each leg", () => {
    const phaseA = phaseASlice(conformanceLoop!);
    expect(phaseA.length).toBeGreaterThan(0);
    expect(phaseA).toContain(
      "/tmp/dpt-smoke-<tracker>-{setup,spec-write,implement,gate-check,spec-review,simplify}.log",
    );
  });

  test("each leg's log set must be complete and result-bearing before aggregation", () => {
    const phaseA = phaseASlice(conformanceLoop!);
    expect(phaseA).toMatch(/result-bearing/i);
    expect(phaseA).toMatch(/before aggregation/i);
  });

  test("an incomplete leg is a failed leg regardless of RC 0", () => {
    const phaseA = phaseASlice(conformanceLoop!);
    expect(phaseA).toMatch(/regardless of RC ?0/i);
    // The incompleteness condition and the failure verdict must live in the
    // same paragraph — not be stitched from unrelated sentences.
    expect(
      someParagraphMatches(phaseA, [/incomplete/i, /fail/i]),
    ).toBe(true);
  });

  test("a fire-and-exit final message also fails the leg", () => {
    expect(phaseASlice(conformanceLoop!)).toMatch(/fire-and-exit/i);
  });

  test("an incomplete leg aborts the iteration via the same fail-fast path as a non-zero RC", () => {
    expect(phaseASlice(conformanceLoop!)).toMatch(/same fail-fast path/i);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-355.backfill — conformance-loop Phase A detached spawn + poll
//
// Backfilled Phase A spawn mechanics (STE-355 § Technical Design): the
// leg-completeness mirror alone is insufficient — once the STE-355 poll
// wrapper makes each /smoke-test child genuinely await its grandchildren
// (~10+ min per leg), a spawn fence that foreground-`wait`s both PIDs in
// the SAME Bash call caps at the same 600s harness ceiling F2 identified.
// Phase A must use the smoke driver's Phase 2 discipline: both children
// spawn detached in one Bash call with PID capture to
// /tmp/dpt-conformance-loop-<date>-iter-<N>-{linear,jira}.pid, then
// repeated short poll calls (`kill -0` + sleep) until both exit; ending
// the session with a live pidfile is forbidden.
// ---------------------------------------------------------------------------

// A Phase A fence that spawns the /smoke-test children.
function phaseASpawnFences(section: string): string[] {
  return bashFences(section).filter((fence) => /claude -p/.test(fence));
}

describeIfConformanceLoopPresent("AC-STE-355.backfill — conformance-loop Phase A detached spawn + poll", () => {
  test("both children's PIDs are captured to per-iteration conformance-loop pidfiles", () => {
    const phaseA = phaseASlice(conformanceLoop!);
    expect(phaseA.length).toBeGreaterThan(0);
    // Rendered paths may interpolate ${DATE}/${ITER}, so pin the distinctive
    // namespace prefix + per-leg basename fragments rather than a full literal.
    expect(phaseA).toMatch(/dpt-conformance-loop-[^\n]*\.pid/);
    expect(phaseA).toMatch(/(-linear\.pid|\{linear,\s?jira\}\.pid)/);
    expect(phaseA).toMatch(/(-jira\.pid|\{linear,\s?jira\}\.pid)/);
  });

  test("one Bash call spawns both children detached, capturing each PID to a pidfile", () => {
    const fences = phaseASpawnFences(phaseASlice(conformanceLoop!));
    expect(fences.length).toBeGreaterThan(0);
    // Both legs spawn in the same call...
    const dual = fences.find(
      (fence) =>
        fence.includes("--tracker linear") && fence.includes("--tracker jira"),
    );
    expect(dual).toBeDefined();
    // ...each detached with its PID written to a pidfile (`echo $! > …pid`).
    const pidCaptures = dual!.match(/echo "?\$!"?/g) ?? [];
    expect(pidCaptures.length).toBeGreaterThanOrEqual(2);
    expect(dual!).toContain(".pid");
  });

  test("no foreground `wait` in the spawn call — the same-call wait is the 600s-ceiling defect", () => {
    const phaseA = phaseASlice(conformanceLoop!);
    const fences = phaseASpawnFences(phaseA);
    expect(fences.length).toBeGreaterThan(0);
    for (const fence of fences) {
      // A command-position `wait` inside the spawn fence caps both legs at
      // the harness's per-call ceiling while each leg takes ~10+ minutes.
      expect(fence).not.toMatch(/^\s*wait\b/m);
    }
    // The intro prose no longer sells the same-call wait design either.
    expect(phaseA).not.toMatch(/`wait`s on both/);
  });

  test("Phase A carries the bounded poll: `kill -0` on the pidfiles plus a short sleep per poll call", () => {
    const phaseA = phaseASlice(conformanceLoop!);
    expect(phaseA).toContain("kill -0");
    expect(phaseA).toMatch(/sleep \d+/);
  });

  test("Phase A documents why: each poll call stays well under the 600s harness ceiling", () => {
    expect(phaseASlice(conformanceLoop!)).toMatch(/600 ?s|10-minute|ten-minute/i);
  });

  test("hard rule: ending the session with a live pidfile is forbidden", () => {
    // Same paragraph must tie the pidfile to the prohibition (a stray
    // "forbidden" elsewhere in Phase A must not satisfy the rule).
    expect(
      someParagraphMatches(phaseASlice(conformanceLoop!), [
        /pidfile/i,
        /forbidden/i,
      ]),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// STE-356 — Pre-seed workspace trust so the scaffolded allow-list is
// enforcement-effective.
//
// 2026-07-02 conformance finding F4 (high): grandchildren spawned in fresh
// test-project cwds ignored the scaffolded `.claude/settings.json`
// allow-list — captured logs opened with "Ignoring 10 permissions.allow
// entries from .claude/settings.json: this workspace has not been trusted".
// The STE-252 policy artifact was inert at the grandchild layer; the
// canonical chain ran on auto-mode classifier goodwill. Mechanism confirmed
// on-disk: workspace trust lives at $CLAUDE_CONFIG_DIR/.claude.json →
// projects["<abs-path>"].hasTrustDialogAccepted.
//
// AC-STE-356.1: Phase 1 gains step 6b — back up the live config to
//   /tmp/dpt-smoke-<tracker>-claude-json.bak, then jq read-merge-write
//   `.projects["<abs>"] = ((.projects["<abs>"] // {}) +
//   {hasTrustDialogAccepted: true})` into a temp file and atomically mv over
//   the original; merge-only (every unrelated key passes through); the abs
//   path comes from pre-flight #6's realpath resolution; before any spawn.
//
// AC-STE-356.2: a spawn-time jq -e assertion verifies the trust entry
//   before the first Phase 2 spawn; miss ⇒ NFR-10 canonical refusal
//   (inert verdict / step-6b remedy / Context: skill=smoke-test,
//   pre-flight=workspace_trust_check); hit ⇒ the byte-checkable capability
//   token `workspace_trust_seeded` in the approval file (same shape
//   convention as `spawn_pattern_allow_present`).
//
// AC-STE-356.3: the checkAllowlistInert runtime detector is wired into the
//   STE-352 post-return assertion family, and the threat-model prose in
//   BOTH project-local SKILL.mds names workspace trust as an enforcement
//   precondition of the tracked allow-list (Phase 1 step 6b is the seeding
//   step; the 2026-07-02 F4 capture is the counterexample).
//
// AC-STE-356.4: Phase 5 teardown removes the seeded projects["<path>"]
//   entry via jq del(...) with the same read-merge-write discipline, in
//   BOTH tracker paths (Linear + Jira) — config hygiene, no dead project
//   entries accumulate.
// ---------------------------------------------------------------------------

// Everything from a marker to end-of-body (for trailing sections like
// `## Threat model`, which no later `## ` heading closes).
function tailFrom(body: string, marker: string): string {
  const idx = body.indexOf(marker);
  return idx === -1 ? "" : body.slice(idx);
}

// § Phase 1 — setup steps 1–7 (and the new step 6b).
function phase1Slice(body: string): string {
  return sectionSlice(
    body,
    "### Phase 1 — Setup",
    "### Phase 2 — Run the canonical chain",
  );
}

// § Phase 1 step 6b — from its first "6b" mention to step 7's print line.
function step6bSlice(phase1: string): string {
  const start = phase1.indexOf("6b");
  if (start === -1) return "";
  const end = phase1.indexOf("\n7. ", start);
  return end === -1 ? phase1.slice(start) : phase1.slice(start, end);
}

// § Post-return capture assertion — the STE-352 detector family the
// allowlist-inert check must join.
function postReturnSlice(body: string): string {
  return sectionSlice(
    body,
    "#### Post-return capture assertion — non-empty / non-denied (STE-352)",
    "#### Comment-path probe",
  );
}

// § Phase 5 — Teardown, plus its two per-tracker path subsections.
function phase5Slice(body: string): string {
  return sectionSlice(body, "### Phase 5 — Teardown", "### Phase 8");
}

function linearTeardownSlice(phase5: string): string {
  return sectionSlice(phase5, "#### Linear path", "#### Jira path");
}

function jiraTeardownSlice(phase5: string): string {
  return tailFrom(phase5, "#### Jira path");
}

// The jq read-merge-write shape: existing project entry merged (`// {}`),
// hasTrustDialogAccepted forced true, unrelated keys untouched. Tolerant of
// the path placeholder/binding form and optional key quoting.
const TRUST_MERGE_RE =
  /\.projects\[[^\]\n]+\]\s*=\s*\(\(\.projects\[[^\]\n]+\]\s*\/\/\s*\{\}\)\s*\+\s*\{\s*"?hasTrustDialogAccepted"?\s*:\s*true\s*\}\)/;

const TRUST_PROBE = "hasTrustDialogAccepted == true";
const TRUST_BACKUP_LITERAL = "/tmp/dpt-smoke-<tracker>-claude-json.bak";
const TRUST_TOKEN = "workspace_trust_seeded";
const INERT_DIAG_PREFIX = "STE-356 regression: allow-list inert — ";
const TRUST_DEL_RE = /del\(\s*\.projects\[/;

describeIfPresent("AC-STE-356.1 — Phase 1 step 6b pre-seeds workspace trust", () => {
  test("Phase 1 carries a step 6b targeting $CLAUDE_CONFIG_DIR/.claude.json", () => {
    const step6b = step6bSlice(phase1Slice(skill!));
    expect(step6b.length).toBeGreaterThan(0);
    expect(step6b).toContain("CLAUDE_CONFIG_DIR");
    expect(step6b).toContain(".claude.json");
  });

  test("the seed is a jq read-merge-write: existing project entry merged, hasTrustDialogAccepted forced true", () => {
    const step6b = step6bSlice(phase1Slice(skill!));
    expect(step6b).toContain("jq");
    expect(step6b).toMatch(TRUST_MERGE_RE);
  });

  test("merge-only discipline is documented — every unrelated key passes through untouched", () => {
    const step6b = step6bSlice(phase1Slice(skill!));
    expect(step6b).toMatch(/merge-only|merge only/i);
    expect(step6b).toMatch(/unrelated/i);
  });

  test("the live config is backed up to /tmp/dpt-smoke-<tracker>-claude-json.bak before the write", () => {
    const step6b = step6bSlice(phase1Slice(skill!));
    expect(step6b).toContain(TRUST_BACKUP_LITERAL);
  });

  test("the write is atomic: jq into a temp file, then mv over the original", () => {
    const step6b = step6bSlice(phase1Slice(skill!));
    expect(step6b).toMatch(/\bmv\b/);
    expect(step6b).toMatch(/atomic/i);
    expect(step6b).toMatch(/temp/i);
  });

  test("the absolute test-project path comes from pre-flight #6's realpath resolution", () => {
    const step6b = step6bSlice(phase1Slice(skill!));
    expect(step6b).toContain("pre-flight #6");
    expect(step6b).toMatch(/realpath/);
  });

  test("seeding precedes any child spawn: step 6b sits after step 6's sensitive-file pre-creation, inside Phase 1", () => {
    const phase1 = phase1Slice(skill!);
    const step6Idx = phase1.indexOf("cat > .claude/settings.json");
    const step6bIdx = phase1.indexOf("6b");
    expect(step6Idx).toBeGreaterThan(-1);
    expect(step6bIdx).toBeGreaterThan(step6Idx);
  });
});

describeIfPresent("AC-STE-356.2 — spawn-time trust assertion + workspace_trust_seeded token", () => {
  test("a jq -e probe asserts the trust entry exists, positioned before the first Phase 2 spawn fence", () => {
    const probeIdx = skill!.indexOf(TRUST_PROBE);
    expect(probeIdx).toBeGreaterThan(-1);
    expect(skill!).toMatch(/jq -e[\s\S]{0,300}hasTrustDialogAccepted == true/);
    const phase1Idx = skill!.indexOf("### Phase 1 — Setup");
    const disciplineIdx = skill!.indexOf(
      "#### Phase 2 child-spawn discipline",
    );
    expect(phase1Idx).toBeGreaterThan(-1);
    expect(disciplineIdx).toBeGreaterThan(-1);
    // After Phase 1 opens (the entry cannot exist before step 6b seeds it)
    // and before the first spawn-bearing fence family.
    expect(probeIdx).toBeGreaterThan(phase1Idx);
    expect(probeIdx).toBeLessThan(disciplineIdx);
  });

  test("the probe reads the trust entry from the live .claude.json", () => {
    expect(skill!).toMatch(
      /hasTrustDialogAccepted == true[\s\S]{0,300}\.claude\.json|\.claude\.json[\s\S]{0,300}hasTrustDialogAccepted == true/,
    );
  });

  test("miss ⇒ NFR-10 canonical refusal: inert verdict with the step-6b remedy", () => {
    expect(skill!).toMatch(/inert[\s\S]{0,400}Remedy:[^\n]*6b/);
  });

  test("refusal Context line carries skill=smoke-test and pre-flight=workspace_trust_check", () => {
    const contextLines = skill!
      .split("\n")
      .filter((line) => line.includes("workspace_trust_check"));
    expect(contextLines.length).toBeGreaterThan(0);
    expect(
      contextLines.some(
        (line) =>
          line.includes("Context:") &&
          line.includes("skill=smoke-test") &&
          line.includes("pre-flight=workspace_trust_check"),
      ),
    ).toBe(true);
  });

  test("hit ⇒ the literal workspace_trust_seeded token is logged to the approval file", () => {
    expect(skill!).toContain(TRUST_TOKEN);
    expect(skill!).toMatch(
      /workspace_trust_seeded[\s\S]{0,600}approval|approval[\s\S]{0,600}workspace_trust_seeded/,
    );
  });

  test("the token documents the spawn_pattern_allow_present shape convention", () => {
    expect(skill!).toMatch(
      /workspace_trust_seeded[\s\S]{0,700}spawn_pattern_allow_present|spawn_pattern_allow_present[\s\S]{0,700}workspace_trust_seeded/,
    );
  });
});

describeIfPresent("AC-STE-356.3 — allowlist-inert detector wired into the STE-352 post-return family", () => {
  test("the post-return assertion section names checkAllowlistInert alongside checkChildSpawnCapture", () => {
    const section = postReturnSlice(skill!);
    expect(section.length).toBeGreaterThan(0);
    expect(section).toContain("checkAllowlistInert");
    expect(section).toContain("checkChildSpawnCapture");
  });

  test("the section pins the inert-warning trigger text", () => {
    const section = postReturnSlice(skill!);
    expect(section).toMatch(/Ignoring[^\n]*permissions\.allow/);
    expect(section).toContain("has not been trusted");
  });

  test("an inert capture is the canonical high-severity STE-356 finding naming the child", () => {
    const section = postReturnSlice(skill!);
    expect(section).toContain(INERT_DIAG_PREFIX);
    expect(section).toMatch(
      /STE-356 regression: allow-list inert[\s\S]{0,500}high|high[\s\S]{0,500}STE-356 regression: allow-list inert/i,
    );
  });
});

describeIfPresent("AC-STE-356.3 — /smoke-test threat model names workspace trust as an enforcement precondition", () => {
  test("the tracked allow-list is enforcement-effective ONLY when the spawn cwd's workspace is trusted", () => {
    const threat = tailFrom(skill!, "## Threat model");
    expect(threat.length).toBeGreaterThan(0);
    expect(threat).toMatch(/enforcement[- ]effective/i);
    expect(threat).toMatch(/only when[^\n]*trusted/i);
  });

  test("Phase 1 step 6b is named as the seeding step", () => {
    const threat = tailFrom(skill!, "## Threat model");
    expect(threat).toContain("6b");
    expect(threat).toMatch(/seed/i);
  });

  test("the 2026-07-02 F4 capture is cited as the counterexample", () => {
    const threat = tailFrom(skill!, "## Threat model");
    expect(threat).toContain("2026-07-02");
    expect(threat).toMatch(/\bF4\b/);
  });
});

describeIfConformanceLoopPresent("AC-STE-356.3 — /conformance-loop threat model mirrors the trust precondition", () => {
  test("the tracked allow-list is enforcement-effective ONLY when the spawn cwd's workspace is trusted", () => {
    const threat = tailFrom(conformanceLoop!, "## Threat model");
    expect(threat.length).toBeGreaterThan(0);
    expect(threat).toMatch(/enforcement[- ]effective/i);
    expect(threat).toMatch(/only when[^\n]*trusted/i);
  });

  test("/smoke-test Phase 1 step 6b is named as the seeding step", () => {
    const threat = tailFrom(conformanceLoop!, "## Threat model");
    expect(threat).toContain("6b");
    expect(threat).toMatch(/seed/i);
  });

  test("the 2026-07-02 F4 capture is cited as the counterexample", () => {
    const threat = tailFrom(conformanceLoop!, "## Threat model");
    expect(threat).toContain("2026-07-02");
    expect(threat).toMatch(/\bF4\b/);
  });
});

describeIfPresent("AC-STE-356.4 — Phase 5 teardown removes the seeded trust entry", () => {
  test("Phase 5 removes the projects entry via jq del(.projects[...]) against the live .claude.json", () => {
    const phase5 = phase5Slice(skill!);
    expect(phase5.length).toBeGreaterThan(0);
    expect(phase5).toMatch(TRUST_DEL_RE);
    expect(phase5).toContain(".claude.json");
  });

  test("the removal keeps the same read-merge-write discipline as the step-6b seed", () => {
    const phase5 = phase5Slice(skill!);
    expect(phase5).toMatch(/read-merge-write/i);
  });

  test("the Linear tracker path carries the trust-entry removal", () => {
    const linear = linearTeardownSlice(phase5Slice(skill!));
    expect(linear.length).toBeGreaterThan(0);
    expect(linear).toMatch(TRUST_DEL_RE);
  });

  test("the Jira tracker path carries the trust-entry removal", () => {
    const jira = jiraTeardownSlice(phase5Slice(skill!));
    expect(jira.length).toBeGreaterThan(0);
    expect(jira).toMatch(TRUST_DEL_RE);
  });

  test("config-hygiene rationale is documented — no dead project entries accumulate", () => {
    const phase5 = phase5Slice(skill!);
    expect(phase5).toMatch(/hygiene/i);
    expect(phase5).toMatch(/accumulat/i);
  });
});
