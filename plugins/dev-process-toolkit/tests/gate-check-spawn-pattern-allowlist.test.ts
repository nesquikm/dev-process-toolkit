import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSpawnPatternAllowlistProbe } from "../adapters/_shared/src/spawn_pattern_allowlist";

// STE-351 AC-STE-351.2 — /gate-check probe `spawn_pattern_allowlist`.
// Severity: error.
//
// The probe fails GATE when the child-spawn pattern `Bash(claude:*)`
// is absent from EITHER of two surfaces:
//   (a) the tracked `.claude/settings.json` `permissions.allow` array
//       at the project root, or
//   (b) the /smoke-test Phase 1 step 6 scaffold snippet — the
//       `cat > .claude/settings.json <<'EOF'` heredoc inside
//       `.claude/skills/smoke-test/SKILL.md` that pre-creates the
//       child test-project's settings.
//
// Passes when the pattern is present in both. Vacuous (zero
// violations) when a surface's file is absent — toolkit-consumer
// repos ship neither.
//
// This is the fence STE-350's absence proved was missing: a non-empty
// allow-list (`length > 0`) still shipped the M94 false-green because
// the load-bearing spawn pattern was missing. Probe shape mirrors
// `conformance_loop_bypass_removed.ts` (STE-252).

const SPAWN_PATTERN = "Bash(claude:*)";

function makeFixture(opts: {
  settings?: string;
  smokeTest?: string;
}): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "spawn-pattern-allow-"));
  if (opts.settings !== undefined) {
    mkdirSync(join(root, ".claude"), { recursive: true });
    writeFileSync(join(root, ".claude", "settings.json"), opts.settings);
  }
  if (opts.smokeTest !== undefined) {
    const dir = join(root, ".claude", "skills", "smoke-test");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), opts.smokeTest);
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const SETTINGS_WITH_PATTERN = JSON.stringify(
  {
    permissions: {
      allow: [
        "Bash(bun test:*)",
        "Bash(bun:*)",
        "Bash(claude:*)",
        "Bash(git:*)",
        "Edit",
        "Read",
        "mcp__linear__*",
      ],
    },
  },
  null,
  2,
);

// The exact M94 shape: allow-list is populated (length > 0 passes)
// but the child-spawn pattern is missing.
const SETTINGS_WITHOUT_PATTERN = JSON.stringify(
  {
    permissions: {
      allow: [
        "Bash(bun test:*)",
        "Bash(bun:*)",
        "Bash(git:*)",
        "Edit",
        "Read",
        "mcp__linear__*",
      ],
    },
  },
  null,
  2,
);

const SETTINGS_MALFORMED = '{ "permissions": { "allow": [ oops';

// Scaffold snippets mirror the REAL /smoke-test Phase 1 step 6 shape:
// a ```bash fence indented 3 spaces inside a numbered list item,
// wrapping a `cat > .claude/settings.json <<'EOF'` heredoc.
const SCAFFOLD_WITH_PATTERN = [
  "6. **Pre-create the sensitive files from the parent's Bash heredoc.**",
  "",
  "   ```bash",
  "   mkdir -p .claude",
  "   cat > .claude/settings.json <<'EOF'",
  "   {",
  '     "permissions": {',
  '       "allow": [',
  '         "Bash(bun *)", "Bash(bunx *)", "Bash(git *)", "Bash(gh *)",',
  '         "Bash(mkdir *)", "Bash(ls *)", "Bash(rm *)", "Bash(mv *)", "Bash(cp *)",',
  '         "Bash(claude:*)"',
  "       ]",
  "     }",
  "   }",
  "   EOF",
  "   ```",
].join("\n");

const SCAFFOLD_WITHOUT_PATTERN = [
  "6. **Pre-create the sensitive files from the parent's Bash heredoc.**",
  "",
  "   ```bash",
  "   mkdir -p .claude",
  "   cat > .claude/settings.json <<'EOF'",
  "   {",
  '     "permissions": {',
  '       "allow": [',
  '         "Bash(bun *)", "Bash(bunx *)", "Bash(git *)", "Bash(gh *)",',
  '         "Bash(mkdir *)", "Bash(ls *)", "Bash(rm *)", "Bash(mv *)", "Bash(cp *)"',
  "       ]",
  "     }",
  "   }",
  "   EOF",
  "   ```",
].join("\n");

describe("AC-STE-351.2 — spawn_pattern_allowlist probe", () => {
  test("pattern present in both surfaces ⇒ zero violations", async () => {
    const fx = makeFixture({
      settings: SETTINGS_WITH_PATTERN,
      smokeTest: SCAFFOLD_WITH_PATTERN,
    });
    try {
      const r = await runSpawnPatternAllowlistProbe(fx.root);
      expect(r.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("tracked settings.json allow-list populated BUT lacking the spawn pattern ⇒ GATE violation (the M94 shape)", async () => {
    const fx = makeFixture({
      settings: SETTINGS_WITHOUT_PATTERN,
      smokeTest: SCAFFOLD_WITH_PATTERN,
    });
    try {
      const r = await runSpawnPatternAllowlistProbe(fx.root);
      expect(r.violations.length).toBeGreaterThan(0);
      const v = r.violations[0]!;
      expect(v.severity).toBe("error");
      expect(typeof v.line).toBe("number");
      expect(v.note).toContain(".claude/settings.json");
      expect(v.note).toContain(SPAWN_PATTERN);
    } finally {
      fx.cleanup();
    }
  });

  test("smoke-test scaffold heredoc lacking the spawn pattern ⇒ GATE violation with file:line", async () => {
    const fx = makeFixture({
      settings: SETTINGS_WITH_PATTERN,
      smokeTest: SCAFFOLD_WITHOUT_PATTERN,
    });
    try {
      const r = await runSpawnPatternAllowlistProbe(fx.root);
      expect(r.violations.length).toBeGreaterThan(0);
      const v = r.violations[0]!;
      expect(v.severity).toBe("error");
      expect(v.note).toMatch(/\.claude\/skills\/smoke-test\/SKILL\.md:\d+/);
    } finally {
      fx.cleanup();
    }
  });

  test("pattern absent from BOTH surfaces ⇒ one violation per surface (2 total)", async () => {
    const fx = makeFixture({
      settings: SETTINGS_WITHOUT_PATTERN,
      smokeTest: SCAFFOLD_WITHOUT_PATTERN,
    });
    try {
      const r = await runSpawnPatternAllowlistProbe(fx.root);
      expect(r.violations.length).toBe(2);
    } finally {
      fx.cleanup();
    }
  });

  test("vacuous when neither file exists (toolkit consumer) ⇒ zero violations", async () => {
    const fx = makeFixture({});
    try {
      const r = await runSpawnPatternAllowlistProbe(fx.root);
      expect(r.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("consumer shape: compliant settings.json present, no smoke-test SKILL.md ⇒ zero violations", async () => {
    const fx = makeFixture({ settings: SETTINGS_WITH_PATTERN });
    try {
      const r = await runSpawnPatternAllowlistProbe(fx.root);
      expect(r.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("surfaces are independent: no settings.json, scaffold lacking pattern ⇒ still flagged", async () => {
    const fx = makeFixture({ smokeTest: SCAFFOLD_WITHOUT_PATTERN });
    try {
      const r = await runSpawnPatternAllowlistProbe(fx.root);
      expect(r.violations.length).toBeGreaterThan(0);
      expect(r.violations[0]!.note).toMatch(
        /\.claude\/skills\/smoke-test\/SKILL\.md:\d+/,
      );
    } finally {
      fx.cleanup();
    }
  });

  test("malformed settings.json JSON ⇒ fail-closed violation (pattern presence cannot be verified)", async () => {
    const fx = makeFixture({
      settings: SETTINGS_MALFORMED,
      smokeTest: SCAFFOLD_WITH_PATTERN,
    });
    try {
      const r = await runSpawnPatternAllowlistProbe(fx.root);
      expect(r.violations.length).toBeGreaterThan(0);
      expect(r.violations[0]!.severity).toBe("error");
      expect(r.violations[0]!.note).toContain(".claude/settings.json");
    } finally {
      fx.cleanup();
    }
  });

  test("prose mention of the pattern OUTSIDE the scaffold heredoc does NOT satisfy the scaffold surface", async () => {
    // Guards against a whole-file `includes()` implementation: the real
    // smoke-test SKILL.md mentions `Bash(claude:*)` in prose (spawn
    // contract sections) — the probe must require the pattern INSIDE
    // the settings-writing heredoc itself.
    const decoy = [
      "Every spawn line begins with `claude` so the tracked",
      "`Bash(claude:*)` allow entry matches.",
      "",
      SCAFFOLD_WITHOUT_PATTERN,
    ].join("\n");
    const fx = makeFixture({ settings: SETTINGS_WITH_PATTERN, smokeTest: decoy });
    try {
      const r = await runSpawnPatternAllowlistProbe(fx.root);
      expect(r.violations.length).toBeGreaterThan(0);
      expect(r.violations[0]!.note).toMatch(
        /\.claude\/skills\/smoke-test\/SKILL\.md:\d+/,
      );
    } finally {
      fx.cleanup();
    }
  });

  test("violation message follows NFR-10 canonical shape (probe name + Remedy + Context)", async () => {
    const fx = makeFixture({
      settings: SETTINGS_WITHOUT_PATTERN,
      smokeTest: SCAFFOLD_WITH_PATTERN,
    });
    try {
      const r = await runSpawnPatternAllowlistProbe(fx.root);
      expect(r.violations.length).toBeGreaterThan(0);
      const v = r.violations[0]!;
      expect(v.message).toContain("spawn_pattern_allowlist");
      expect(v.message).toContain(SPAWN_PATTERN);
      expect(v.message).toMatch(/Remedy:/);
      expect(v.message).toMatch(/Context:/);
    } finally {
      fx.cleanup();
    }
  });

  test("probe is registered in the /gate-check SKILL.md probe set", () => {
    // AC-STE-351.2 requires a /gate-check probe — an unregistered
    // module is not a gate. The registry entry must name the module
    // (`spawn_pattern_allowlist`) like every other numbered probe.
    const gateCheckSkill = join(
      import.meta.dir,
      "..",
      "skills",
      "gate-check",
      "SKILL.md",
    );
    expect(existsSync(gateCheckSkill)).toBe(true);
    const body = readFileSync(gateCheckSkill, "utf8");
    expect(body).toContain("spawn_pattern_allowlist");
    expect(body).toContain("tests/gate-check-spawn-pattern-allowlist.test.ts");
  });
});
