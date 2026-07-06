// STE-320 — Code-reviewer scope + capability-key registry expansion (M84).
//
// Closes two related self-contradictions in the toolkit's own canon:
//
//   A7  — agents/code-reviewer.md L10 disclaimer self-contradicts L63's
//         Pass-1 (Spec Compliance). Echoed in docs/adaptation-guide.md:113.
//         (docs/skill-anatomy.md:152 is OUT OF SCOPE — meta-doc of Pass-2
//          prompt scoping, not a global disclaimer.)
//   A10 — adapters/_shared/src/closing_summary_capability_keys.ts under-
//         covers 8 of 20 directive-backed tokens. Final registry = Set A
//         (every key with a literal `MUST emit `<key>`` directive in
//         /spec-write SKILL.md) — 20 keys at M84; 21 since the M97
//         STE-362 `milestone_attach_failed` expansion; 23 since the M97
//         STE-363 archival-assertion pair.
//
// Tests assert the FINAL desired state — they all FAIL until the
// implementer lands the edits.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CANONICAL_CAPABILITY_KEYS,
  runClosingSummaryCapabilityKeysProbe,
} from "../adapters/_shared/src/closing_summary_capability_keys";

const pluginRoot = join(import.meta.dir, "..");
const repoRoot = join(pluginRoot, "..", "..");

const codeReviewerPath = join(pluginRoot, "agents", "code-reviewer.md");
const adaptationGuidePath = join(pluginRoot, "docs", "adaptation-guide.md");
const skillAnatomyPath = join(pluginRoot, "docs", "skill-anatomy.md");
const specWriteSkillPath = join(
  pluginRoot,
  "skills",
  "spec-write",
  "SKILL.md",
);

function readFile(path: string): string {
  return readFileSync(path, "utf8");
}

// The 20 keys that carry a literal `MUST emit \`<key>\`` directive in
// /spec-write SKILL.md (verified by M84 audit triple-pass). Source of
// truth: the regex `MUST emit\s*\`[a-z_]+\`` applied to spec-write
// SKILL.md. Tests pin this list to catch any drift in either direction.
const EXPECTED_SET_A: ReadonlySet<string> = new Set([
  // Existing 12 (already in the const before this FR):
  "spec_write_draft_default_applied",
  "spec_write_commit_default_applied",
  "branch_gate_default_applied",
  "branch_gate_skipped_already_non_main",
  "spec_research_invoked",
  "spec_research_no_matches",
  "spec_research_shape_violation",
  "deps_research_invoked",
  "deps_research_no_matches",
  "deps_research_shape_violation",
  "tracker_status_advisory_non_tty",
  "tracker_status_genuine_drift",
  // 8 additions from this FR:
  "spec_write_draft_declined",
  "spec_write_commit_declined",
  "branch_gate_created",
  "branch_gate_edited",
  "branch_gate_declined",
  "branch_gate_remote_probe_skipped",
  "tracker_local_orphan_local",
  "tracker_local_reconciled",
  // Post-M84 expansion (M97 STE-362): loud permanent-failure surface for
  // the project-milestone attach. The pin moves consciously — the key
  // carries a literal `MUST emit \`milestone_attach_failed\`` directive
  // in /spec-write SKILL.md, keeping Set A = discovered directives.
  "milestone_attach_failed",
  // Post-M84 expansion (M97 STE-363): archival-time milestone-binding
  // assertion outcomes. The pin moves consciously 21 → 23 — both keys carry
  // literal `MUST emit \`<key>\`` directives in /spec-write SKILL.md's § 7
  // static map row (and in /spec-archive + /implement, pinned by the
  // STE-363 meta-tests), keeping Set A = discovered directives.
  "milestone_label_asserted_at_archive",
  "milestone_label_archive_refused",
]);

// Keys explicitly excluded from registration — they appear only as table-
// header column labels at L330, NOT as `MUST emit \`<key>\`` directives.
// Adding them would orphan-fail the bidirectional probe (AC-4).
const EXPLICITLY_EXCLUDED: readonly string[] = [
  "tracker_status_forced",
  "tracker_status_skipped",
  "tracker_status_cancelled",
  "tracker_status_unknown_encountered",
  "tracker_tolerance_refused_non_tty",
];

// ---------------------------------------------------------------------------
// AC-STE-320.1 — code-reviewer.md L10 disclaimer removed + replaced
// ---------------------------------------------------------------------------

describe("AC-STE-320.1 — code-reviewer.md L10 disclaimer removed", () => {
  test("L10 no longer carries 'Spec compliance is **not** your job'", () => {
    const body = readFile(codeReviewerPath);
    // The exact legacy phrase that L10 carried before this FR.
    expect(body).not.toMatch(/Spec compliance is \*\*not\*\* your job/);
  });

  test("L10 no longer claims /spec-review 'owns AC→code traceability' as the global rule", () => {
    const body = readFile(codeReviewerPath);
    // Reject the legacy phrasing pattern. The new wording uses parallel-
    // not-subordinate framing referencing `/implement` Phase 3 Stage B.
    expect(body).not.toMatch(
      /Spec compliance is \*\*not\*\* your job — \/spec-review owns AC→code traceability/,
    );
  });

  test("replacement wording cites the parallel-not-subordinate split", () => {
    const body = readFile(codeReviewerPath);
    // The new L10 prose ties /spec-review (deep-traceability audit) to
    // code-reviewer Pass-1 (inline per-PR check inside /implement Phase 3
    // Stage B). Both must be mentioned, and the parallel framing must be
    // explicit ("both own spec-compliance in different contexts").
    expect(body).toMatch(/\/spec-review/);
    expect(body).toMatch(/Pass-1/);
    expect(body).toMatch(/Phase 3 Stage B/);
    expect(body).toMatch(/both own spec-compliance in different contexts/i);
  });

  test("L63 Pass-1 (Spec Compliance) section is preserved", () => {
    const body = readFile(codeReviewerPath);
    // Sanity: the canonical Pass-1 contract per HG95TM AC-23.6 must remain.
    expect(body).toMatch(/Pass 1 — Spec Compliance/);
    // The return-shape example must still document per-AC one-line format.
    expect(body).toMatch(/AC-\d+\.\d+ — OK/);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-320.2 — adaptation-guide.md:113 echo rewritten; skill-anatomy.md:152
//                left intact
// ---------------------------------------------------------------------------

describe("AC-STE-320.2 — adaptation-guide echo rewritten, skill-anatomy preserved", () => {
  test("docs/adaptation-guide.md no longer carries the literal disclaimer phrase", () => {
    const body = readFile(adaptationGuidePath);
    expect(body).not.toMatch(/Spec-compliance checks are \*\*not\*\* code-reviewer/);
  });

  test("docs/adaptation-guide.md replacement uses parallel-not-subordinate framing", () => {
    const body = readFile(adaptationGuidePath);
    // Replacement must reference both surfaces (the deep-traceability
    // audit and the inline per-PR check) and the dual ownership.
    expect(body).toMatch(/\/spec-review/);
    expect(body).toMatch(/Pass-1|inline per-PR/i);
    expect(body).toMatch(/both own spec-compliance in different contexts/i);
  });

  test("zero matches for the disclaimer phrase across docs/ + agents/", () => {
    // Mirror the AC's verification:
    //   git grep -nE "Spec-compliance checks are \\*\\*not\\*\\* code-reviewer" \
    //     plugins/dev-process-toolkit/{docs,agents}
    // ⇒ 0 matches.
    const docsBody = readFile(adaptationGuidePath);
    const reviewerBody = readFile(codeReviewerPath);
    const anatomyBody = readFile(skillAnatomyPath);
    const corpus = `${docsBody}\n${reviewerBody}\n${anatomyBody}`;
    expect(corpus).not.toMatch(/Spec-compliance checks are \*\*not\*\* code-reviewer/);
  });

  test("docs/skill-anatomy.md:152 Pass-2 meta-doc is preserved (OUT OF SCOPE)", () => {
    const body = readFile(skillAnatomyPath);
    // L152 documents the Pass-2 prompt scoping — keep it intact. The
    // exact legacy quote inside the meta-doc paragraph must remain.
    expect(body).toMatch(
      /Do NOT check spec compliance — \/spec-review owns that/,
    );
    // The surrounding "real Stage B template" framing stays too.
    expect(body).toMatch(/real Stage B template/);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-320.3 — Registry expansion: 12 → 20 keys = Set A byte-for-byte
// ---------------------------------------------------------------------------

describe("AC-STE-320.3 — closing_summary_capability_keys.ts pins Set A byte-for-byte (count grows only via conscious bumps below)", () => {
  test("CANONICAL_CAPABILITY_KEYS length is exactly 23", () => {
    expect(CANONICAL_CAPABILITY_KEYS.length).toBe(23);
  });

  test("CANONICAL_CAPABILITY_KEYS contains every key in Set A", () => {
    const actual = new Set<string>(CANONICAL_CAPABILITY_KEYS);
    for (const key of EXPECTED_SET_A) {
      expect(actual.has(key)).toBe(true);
    }
  });

  test("CANONICAL_CAPABILITY_KEYS does not contain any out-of-Set-A keys", () => {
    const actual = new Set<string>(CANONICAL_CAPABILITY_KEYS);
    for (const key of actual) {
      expect(EXPECTED_SET_A.has(key)).toBe(true);
    }
  });

  test("explicit exclusions are NOT in the registry (would orphan-fail probe)", () => {
    const actual = new Set<string>(CANONICAL_CAPABILITY_KEYS);
    for (const excluded of EXPLICITLY_EXCLUDED) {
      expect(actual.has(excluded)).toBe(false);
    }
  });

  test("no duplicate keys in the registry", () => {
    const actual = CANONICAL_CAPABILITY_KEYS;
    const dedup = new Set(actual);
    expect(dedup.size).toBe(actual.length);
  });

  test("registry mirrors Set A discoverable in /spec-write SKILL.md by regex", () => {
    // Re-run the AC-3 audit at test time: scrape the SKILL.md body for
    // `MUST emit \`<key>\`` and assert the captured Set equals Set A.
    const body = readFile(specWriteSkillPath);
    const re = /MUST emit\s*`([a-z_]+)`/g;
    const discovered = new Set<string>();
    let match: RegExpExecArray | null;
    while ((match = re.exec(body)) !== null) {
      discovered.add(match[1]!);
    }
    expect(discovered.size).toBe(23);
    for (const key of EXPECTED_SET_A) {
      expect(discovered.has(key)).toBe(true);
    }
    // And the const equals what we discovered (byte-for-byte parity).
    const constSet = new Set<string>(CANONICAL_CAPABILITY_KEYS);
    expect(constSet).toEqual(discovered);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-320.4 — Probe #44 validates bidirectional invariant
// ---------------------------------------------------------------------------

function newProject(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "ste-320-probe-"));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function writeSpecWriteSkill(root: string, body: string): void {
  const dir = join(root, "plugins", "dev-process-toolkit", "skills", "spec-write");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), body);
}

function buildAllDirectives(): string {
  return CANONICAL_CAPABILITY_KEYS
    .map((k) => `- MUST emit \`${k}\` at the documented site.`)
    .join("\n");
}

describe("AC-STE-320.4 — bidirectional invariant: const ⇔ SKILL.md directives", () => {
  test("forward leg: missing const key → probe fires (every directive needs a const entry)", async () => {
    const ctx = newProject();
    try {
      // SKILL.md carries directives for every canonical key PLUS one extra
      // unknown directive — the reverse-walk leg of the probe must flag
      // that the extra directive lacks a const entry.
      const extraKey = "fake_unregistered_directive";
      const body = `# spec-write\n\n${buildAllDirectives()}\n- MUST emit \`${extraKey}\` at some site.\n`;
      writeSpecWriteSkill(ctx.root, body);
      const report = await runClosingSummaryCapabilityKeysProbe(ctx.root);
      // The bidirectional check must surface a violation for the orphan
      // directive (key in SKILL.md but not in the const).
      const orphans = report.violations.filter(
        (v) => v.missingKey === extraKey || v.reason.includes(extraKey),
      );
      expect(orphans.length).toBeGreaterThanOrEqual(1);
    } finally {
      ctx.cleanup();
    }
  });

  test("reverse leg: const entry without SKILL.md directive → probe fires", async () => {
    const ctx = newProject();
    try {
      // Drop ONE canonical key's directive — the existing forward leg of
      // the probe catches this; assert the violation surfaces with the
      // missing key called out.
      const skipKey = CANONICAL_CAPABILITY_KEYS[0]!;
      const body = `# spec-write\n\n${CANONICAL_CAPABILITY_KEYS
        .filter((k) => k !== skipKey)
        .map((k) => `- MUST emit \`${k}\` at the documented site.`)
        .join("\n")}\n`;
      writeSpecWriteSkill(ctx.root, body);
      const report = await runClosingSummaryCapabilityKeysProbe(ctx.root);
      const hit = report.violations.find((v) => v.missingKey === skipKey);
      expect(hit).toBeDefined();
      expect(hit!.severity).toBe("error");
    } finally {
      ctx.cleanup();
    }
  });

  test("happy path: full Set A directives + full Set A const → zero violations", async () => {
    const ctx = newProject();
    try {
      writeSpecWriteSkill(ctx.root, `# spec-write\n\n${buildAllDirectives()}\n`);
      const report = await runClosingSummaryCapabilityKeysProbe(ctx.root);
      expect(report.violations).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });

  test("end-to-end: probe passes against the real /spec-write SKILL.md + repo const", async () => {
    // No fixture — point the probe at the actual repo root and assert
    // the expanded registry round-trips against the real SKILL.md.
    const report = await runClosingSummaryCapabilityKeysProbe(repoRoot);
    expect(report.violations).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-320.5 — Pass-1 return-contract shape preserved at L63+
// ---------------------------------------------------------------------------

describe("AC-STE-320.5 — Pass-1 return-contract example unchanged in shape", () => {
  test("Pass-1 keeps 'one line per AC' format with [passed|failed]-equivalent shape", () => {
    const body = readFile(codeReviewerPath);
    // Extract Pass-1 section.
    const pass1Match = body.match(/Pass 1 — Spec Compliance[\s\S]*?(?=Pass 2 —|$)/);
    expect(pass1Match).not.toBeNull();
    const pass1 = pass1Match![0];
    // The canonical example: per-AC `AC-X.Y — OK` or `AC-X.Y — CONCERN: file:line — <reason>`.
    expect(pass1).toMatch(/AC-\d+\.\d+ — OK/);
    expect(pass1).toMatch(/AC-\d+\.\d+ — CONCERN: [^\n]+/);
    // Catch-all line for un-spec'd diff code.
    expect(pass1).toMatch(/Undocumented behavior/);
    // OVERALL footer is preserved.
    expect(pass1).toMatch(/OVERALL: (OK|CONCERNS \(\d+\))/);
  });

  test("Pass-1 references AC IDs from specs/requirements.md and changed-files list", () => {
    const body = readFile(codeReviewerPath);
    const pass1Match = body.match(/Pass 1 — Spec Compliance[\s\S]*?(?=Pass 2 —|$)/);
    const pass1 = pass1Match![0];
    expect(pass1).toMatch(/specs\/requirements\.md/);
    expect(pass1).toMatch(/changed-files/);
  });

  test("no prose drift: Pass-1 still cites HG95TM-style 'one line per AC' contract", () => {
    const body = readFile(codeReviewerPath);
    // The canonical line: "Report one line per AC".
    expect(body).toMatch(/Report one line per AC/);
  });
});
