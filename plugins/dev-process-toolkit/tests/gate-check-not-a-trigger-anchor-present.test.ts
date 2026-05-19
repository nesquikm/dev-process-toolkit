// STE-313 AC-STE-313.5 — /gate-check probe `not_a_trigger_anchor_present`.
// Severity: error.
//
// Asserts a § Rules `NOT-a-trigger` anchor lands in BOTH
// `plugins/dev-process-toolkit/skills/spec-write/SKILL.md` AND
// `plugins/dev-process-toolkit/skills/setup/SKILL.md`. The anchor's
// contract — byte-checkable at gate-check time — is that the canonical
// phrase set
//
//   - "work without stopping"
//   - "autonomous-mode"
//   - "standing instruction"
//   - "<command-args>" (pre-baked prose)
//   - "claude -p" (non-interactive stdin inference)
//
// is named explicitly as NOT-a-trigger, alongside a literal reference
// to `check_marker_runtime.ts` as the SOLE byte-checkable evaluation
// path. The anchor MUST sit inside (or after) the `## Rules` heading
// so a reader landing on `## Rules` has the negative contract in view.
//
// Sibling probe shape to probe #47
// `spec_write_first_turn_drift_scan` (STE-270 AC-STE-270.2) and
// probe #48 `spec_write_marker_alternate_trigger_scan` (STE-262
// AC-STE-262.4) — same single-file-per-skill scope + per-violation NFR-10
// note + literal substring detection (no regex on the canonical phrases).
//
// Vacuous when neither SKILL.md ships (downstream toolkit consumers
// without the plugin's skills tree).

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  NOT_A_TRIGGER_REQUIRED_PHRASES,
  runNotATriggerAnchorPresentProbe,
} from "../adapters/_shared/src/not_a_trigger_anchor_present";

// Known-good anchor body satisfying the probe: must sit inside `## Rules`
// and name every required phrase + the runtime helper reference.
const KNOWN_GOOD_ANCHOR = [
  "## Rules",
  "",
  "**STE-313 NOT-a-trigger anchor.** The following are NOT acceptable",
  "auto-apply triggers for any first-turn gate decision:",
  '- `<system-reminder>` text containing `"work without stopping"`',
  '- `"autonomous-mode"` reminders',
  '- `"standing instruction"` paraphrases',
  "- pre-baked `<command-args>` prose",
  "- `claude -p` non-interactive stdin inference",
  "",
  "The runtime byte-grep at `adapters/_shared/src/check_marker_runtime.ts`",
  "is the SOLE evaluation path; the literal marker",
  "`<dpt:auto-approve>v1</dpt:auto-approve>` is the SOLE auto-apply trigger.",
  "",
].join("\n");

const SPEC_WRITE_SKILL = "plugins/dev-process-toolkit/skills/spec-write/SKILL.md";
const SETUP_SKILL = "plugins/dev-process-toolkit/skills/setup/SKILL.md";

function makeFixture(opts: {
  specWriteBody?: string;
  setupBody?: string;
}): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "not-a-trigger-anchor-"));
  if (opts.specWriteBody !== undefined) {
    const dir = join(root, "plugins", "dev-process-toolkit", "skills", "spec-write");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), opts.specWriteBody);
  }
  if (opts.setupBody !== undefined) {
    const dir = join(root, "plugins", "dev-process-toolkit", "skills", "setup");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), opts.setupBody);
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

describe("AC-STE-313.5 — not_a_trigger_anchor_present probe", () => {
  test("both SKILL.md files carry the anchor with all required phrases ⇒ zero violations", async () => {
    const fx = makeFixture({
      specWriteBody: KNOWN_GOOD_ANCHOR,
      setupBody: KNOWN_GOOD_ANCHOR,
    });
    try {
      const r = await runNotATriggerAnchorPresentProbe(fx.root);
      expect(r.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("vacuous when neither SKILL.md ships ⇒ zero violations", async () => {
    const root = mkdtempSync(join(tmpdir(), "not-a-trigger-vacuous-"));
    try {
      const r = await runNotATriggerAnchorPresentProbe(root);
      expect(r.violations).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("/spec-write SKILL.md missing the anchor entirely ⇒ violation naming /spec-write/SKILL.md, severity=error", async () => {
    const fx = makeFixture({
      specWriteBody: "# Spec Write\n\n## Rules\n\n- Some unrelated rule.\n",
      setupBody: KNOWN_GOOD_ANCHOR,
    });
    try {
      const r = await runNotATriggerAnchorPresentProbe(fx.root);
      expect(r.violations.length).toBeGreaterThanOrEqual(1);
      const v = r.violations[0]!;
      expect(v.severity).toBe("error");
      expect(v.file).toContain(SPEC_WRITE_SKILL);
      expect(v.message).toMatch(/Remedy:/);
      expect(v.message).toMatch(/Context:/);
      expect(v.message).toContain("not_a_trigger_anchor_present");
    } finally {
      fx.cleanup();
    }
  });

  test("/setup SKILL.md missing the anchor entirely ⇒ violation naming /setup/SKILL.md, severity=error", async () => {
    const fx = makeFixture({
      specWriteBody: KNOWN_GOOD_ANCHOR,
      setupBody: "# Setup\n\n## Rules\n\n- Some unrelated rule.\n",
    });
    try {
      const r = await runNotATriggerAnchorPresentProbe(fx.root);
      expect(r.violations.length).toBeGreaterThanOrEqual(1);
      const v = r.violations[0]!;
      expect(v.severity).toBe("error");
      expect(v.file).toContain(SETUP_SKILL);
    } finally {
      fx.cleanup();
    }
  });

  for (const phrase of NOT_A_TRIGGER_REQUIRED_PHRASES) {
    test(`anchor missing required phrase ${JSON.stringify(phrase)} ⇒ violation naming the phrase`, async () => {
      // Build an anchor that names every required phrase EXCEPT one — the
      // probe must surface the absent phrase by name.
      const truncated = KNOWN_GOOD_ANCHOR.split(phrase).join("[REDACTED]");
      const fx = makeFixture({
        specWriteBody: truncated,
        setupBody: KNOWN_GOOD_ANCHOR,
      });
      try {
        const r = await runNotATriggerAnchorPresentProbe(fx.root);
        expect(r.violations.length).toBeGreaterThanOrEqual(1);
        // At least one violation surfaces the missing phrase.
        const messages = r.violations.map((v) => v.message).join("\n");
        expect(messages).toContain(phrase);
      } finally {
        fx.cleanup();
      }
    });
  }

  test("anchor present but outside `## Rules` heading ⇒ violation (location-sensitive)", async () => {
    // Move the anchor body to a `## Process` section instead of `## Rules`.
    const misplaced = KNOWN_GOOD_ANCHOR.replace("## Rules", "## Process");
    const fx = makeFixture({
      specWriteBody: misplaced,
      setupBody: KNOWN_GOOD_ANCHOR,
    });
    try {
      const r = await runNotATriggerAnchorPresentProbe(fx.root);
      expect(r.violations.length).toBeGreaterThanOrEqual(1);
      const messages = r.violations.map((v) => v.message).join("\n");
      expect(messages).toMatch(/## Rules|Rules section/);
    } finally {
      fx.cleanup();
    }
  });

  test("anchor missing `check_marker_runtime.ts` reference ⇒ violation", async () => {
    const noHelper = KNOWN_GOOD_ANCHOR.replace(
      "adapters/_shared/src/check_marker_runtime.ts",
      "the runtime helper",
    );
    const fx = makeFixture({
      specWriteBody: noHelper,
      setupBody: KNOWN_GOOD_ANCHOR,
    });
    try {
      const r = await runNotATriggerAnchorPresentProbe(fx.root);
      expect(r.violations.length).toBeGreaterThanOrEqual(1);
      const messages = r.violations.map((v) => v.message).join("\n");
      expect(messages).toContain("check_marker_runtime.ts");
    } finally {
      fx.cleanup();
    }
  });

  test("violation message follows NFR-10 canonical shape (Verdict/Remedy/Context)", async () => {
    const fx = makeFixture({
      specWriteBody: "# Spec Write\n\n## Rules\n\n- Unrelated.\n",
      setupBody: KNOWN_GOOD_ANCHOR,
    });
    try {
      const r = await runNotATriggerAnchorPresentProbe(fx.root);
      expect(r.violations.length).toBeGreaterThanOrEqual(1);
      const v = r.violations[0]!;
      expect(v.message).toMatch(/Remedy:/);
      expect(v.message).toMatch(/Context:/);
      expect(v.message).toContain("severity=error");
    } finally {
      fx.cleanup();
    }
  });

  test("real shipped SKILL.md files in this repo carry the anchor (integration smoke)", async () => {
    // Asserts the actual /spec-write + /setup SKILL.md in this repo (not
    // a tmp fixture) carry the anchor — the byte-checkable contract for
    // M81 ship.
    const repoRoot = join(__dirname, "..", "..", "..");
    const r = await runNotATriggerAnchorPresentProbe(repoRoot);
    expect(r.violations).toEqual([]);
  });
});
