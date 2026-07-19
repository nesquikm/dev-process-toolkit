// STE-315 — /gate-check probe `public_surface_count_drift` (#57).
//
// Asserts the documented skill / agent / probe count tokens in README.md
// and CLAUDE.md match the actual on-disk counts. RED-state until the
// implementation lands at:
//   plugins/dev-process-toolkit/adapters/_shared/src/public_surface_count_drift.ts
//
// AC coverage:
//   AC-STE-315.1 — module path, PROBE_ID, severity, #57 registration in SKILL.md.
//   AC-STE-315.2 — observed values are computed from disk; documented values
//                  are parsed from README.md + CLAUDE.md.
//   AC-STE-315.3 — violations emit NFR-10 canonical refusal shape with
//                  file:line:column + Refusing/Remedy/Context sub-lines.
//   AC-STE-315.4 — repo-on-main, post-backfill, gate PASSes (byte-exact).
//   AC-STE-315.5 — four synthetic fixture cases: (a) PASS, (b) FAIL stale
//                  skill-count at README.md:3, (c) FAIL stale probe-count
//                  at README.md:10, (d) FAIL stale agent-count at CLAUDE.md:16.

import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Module not yet present — these imports drive the RED state.
import {
  PROBE_ID,
  runPublicSurfaceCountDriftProbe,
} from "../adapters/_shared/src/public_surface_count_drift";

const repoRoot = join(import.meta.dir, "..", "..", "..");

/**
 * The single line of `body` matching `anchor`.
 *
 * The count assertions below are content-anchored rather than line-indexed: the
 * docs they read carry prose, diagrams, and images that shift on any cosmetic
 * edit, and a shifted line is not a count regression. Uniqueness is asserted
 * rather than taking the first hit, so this keeps what the line indices were
 * really buying — that the token lives on one specific, identifiable line, not
 * merely somewhere in the file.
 */
function onlyLine(body: string, anchor: RegExp): string {
  const hits = body.split("\n").filter((line) => anchor.test(line));
  if (hits.length !== 1) {
    throw new Error(
      `expected exactly 1 line matching ${anchor}, found ${hits.length}` +
        (hits.length > 1 ? `:\n${hits.map((h) => `  ${h.slice(0, 80)}`).join("\n")}` : ""),
    );
  }
  return hits[0];
}
const probeModulePath = join(
  repoRoot,
  "plugins",
  "dev-process-toolkit",
  "adapters",
  "_shared",
  "src",
  "public_surface_count_drift.ts",
);
const skillMdPath = join(
  repoRoot,
  "plugins",
  "dev-process-toolkit",
  "skills",
  "gate-check",
  "SKILL.md",
);

interface Fixture {
  root: string;
  cleanup: () => void;
}

// Build a synthetic project tree that mirrors the toolkit layout the
// probe walks. `skillsCount` directories under plugins/.../skills/* and
// `agentsCount` *.md files under plugins/.../agents/. The numbered
// probes in SKILL.md are populated up to `maxProbeNumber`. The probe
// module itself does not need to exist inside the fixture — the probe
// only reads README.md, CLAUDE.md, and skills/gate-check/SKILL.md.
function makeFixture(opts: {
  skillsCount: number;
  agentsCount: number;
  maxProbeNumber: number;
  readmeContent: string;
  claudeMdContent: string;
}): Fixture {
  const root = mkdtempSync(join(tmpdir(), "pscd-probe-"));
  const pluginBase = join(root, "plugins", "dev-process-toolkit");
  mkdirSync(pluginBase, { recursive: true });

  // Synthesize N skill directories with a stub SKILL.md inside each so
  // a non-directory entry (if any) is filtered out by the probe.
  const skillsDir = join(pluginBase, "skills");
  mkdirSync(skillsDir, { recursive: true });
  for (let i = 1; i <= opts.skillsCount; i++) {
    const slug = `skill-${i}`;
    const d = join(skillsDir, slug);
    mkdirSync(d, { recursive: true });
    writeFileSync(
      join(d, "SKILL.md"),
      `---\nname: ${slug}\ndescription: stub\n---\n\n# ${slug}\n`,
    );
  }

  // Synthesize N agent *.md files.
  const agentsDir = join(pluginBase, "agents");
  mkdirSync(agentsDir, { recursive: true });
  for (let i = 1; i <= opts.agentsCount; i++) {
    writeFileSync(join(agentsDir, `agent-${i}.md`), `# agent-${i}\n`);
  }

  // Synthesize the gate-check SKILL.md so the highest `^N\\. ` prefix
  // equals maxProbeNumber. The first line uses `1. ` and the last uses
  // `<max>. ` so the regex anchor matches at the start of a line.
  const gateCheckSkillDir = join(skillsDir, "gate-check");
  mkdirSync(gateCheckSkillDir, { recursive: true });
  const probeLines: string[] = ["# Gate Check", "", "## Probes", ""];
  for (let i = 1; i <= opts.maxProbeNumber; i++) {
    probeLines.push(`${i}. **probe-${i}** — stub`);
  }
  writeFileSync(join(gateCheckSkillDir, "SKILL.md"), `${probeLines.join("\n")}\n`);

  // Top-level README.md + CLAUDE.md (probe scans both).
  writeFileSync(join(root, "README.md"), opts.readmeContent);
  writeFileSync(join(root, "CLAUDE.md"), opts.claudeMdContent);

  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

// Build a README that mirrors the canonical surfaces the probe pins
// down (L3 skills/agents tokens; L10 numbered-probe count).
function readmeWith(opts: {
  skillsToken: string; // L3 — "16 commands, 8 agents"
  probeCount: string; // L10 — number prefix before "numbered"
}): string {
  return [
    "# Dev Process Toolkit",
    "",
    `A Claude Code plugin. Includes ${opts.skillsToken}, spec templates, and documentation.`,
    "",
    "## Features",
    "",
    "- a",
    "- b",
    "- c",
    `- **Deterministic quality gates** — ${opts.probeCount} numbered \`/gate-check\` probes`,
    "- d",
    "",
  ].join("\n");
}

// Build a CLAUDE.md that mirrors the canonical surfaces (L15 skills,
// L16 agents). The probe reads L15/L16 of CLAUDE.md.
function claudeMdWith(opts: {
  skillsLine: string; // L15 — "23 slash commands (16 user-invocable + 7 dispatch …)"
  agentsLine: string; // L16 — "8 subagent templates"
}): string {
  // 14 leading lines so the skills-token lands on L15 and the agents-
  // token on L16. Matches the canonical toolkit layout shape.
  const head = [
    "# Dev Process Toolkit",
    "",
    "## What This Is",
    "",
    "This repo is a Claude Code plugin marketplace.",
    "",
    "## Structure",
    "",
    "```",
    ".claude-plugin/marketplace.json          → catalog",
    "plugins/dev-process-toolkit/             → plugin",
    "├── .claude-plugin/plugin.json           → manifest",
    "├── skills/                              → " /* incomplete on purpose */,
  ];
  // head currently has 13 entries → next push lands on L14; we need
  // skills-token on L15 and agents-token on L16. Pad with one filler.
  head.push("");
  head.push(opts.skillsLine);
  head.push(opts.agentsLine);
  head.push("");
  return `${head.join("\n")}\n`;
}

describe("AC-STE-315.1 — probe module + PROBE_ID + #57 registration", () => {
  test("probe module exists at the canonical path", () => {
    expect(existsSync(probeModulePath)).toBe(true);
  });

  test("PROBE_ID is the literal string 'public_surface_count_drift'", () => {
    expect(PROBE_ID).toBe("public_surface_count_drift");
  });

  test("probe is registered as the 57th numbered probe in gate-check SKILL.md", () => {
    const skillMd = readFileSync(skillMdPath, "utf-8");
    // Line shape mirrors siblings #55/#56: `57. **<id>** — …`
    expect(skillMd).toMatch(
      /^57\.\s+\*\*`?public_surface_count_drift`?\*\*/m,
    );
  });

  test("probe entry in SKILL.md declares severity: error", () => {
    const skillMd = readFileSync(skillMdPath, "utf-8");
    // The probe entry block (between `^57\.` and `^58\.` / `^## `)
    // must mention `Severity: error`.
    const match = skillMd.match(
      /^57\.\s+\*\*`?public_surface_count_drift`?\*\*[\s\S]*?(?=^\d+\.\s|\n## |$)/m,
    );
    expect(match).not.toBeNull();
    expect(match![0]).toMatch(/Severity:\s*error/i);
  });
});

describe("AC-STE-315.2 — observed values computed from disk; documented values parsed", () => {
  test("PASS path: 23 skills / 8 agents / max-probe 57 with matching documented values → zero violations", async () => {
    // Documented tokens match observed disk reality. The probe should
    // emit zero violations.
    const fx = makeFixture({
      skillsCount: 23,
      agentsCount: 8,
      maxProbeNumber: 57,
      readmeContent: readmeWith({
        skillsToken: "16 commands, 8 agents",
        probeCount: "57",
      }),
      claudeMdContent: claudeMdWith({
        skillsLine:
          "├── skills/                              → 23 slash commands (16 user-invocable + 7 dispatch — internal forks)",
        agentsLine:
          "├── agents/                              → 8 subagent templates (code-reviewer + spec-researcher + deps-researcher + tdd-{test-writer,implementer,refactorer,spec-reviewer})",
      }),
    });
    try {
      const r = await runPublicSurfaceCountDriftProbe(fx.root);
      expect(r.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("observed skills count comes from skills/*/ globIterate (excludes non-directory siblings)", async () => {
    const fx = makeFixture({
      skillsCount: 5, // 5 real skill dirs on disk
      agentsCount: 3,
      maxProbeNumber: 10,
      readmeContent: readmeWith({
        skillsToken: "5 commands, 3 agents",
        probeCount: "10",
      }),
      claudeMdContent: claudeMdWith({
        skillsLine: "→ 5 slash commands",
        agentsLine: "→ 3 subagent templates",
      }),
    });
    // Drop a stray file under skills/ to verify it is NOT counted.
    writeFileSync(
      join(fx.root, "plugins", "dev-process-toolkit", "skills", "README.md"),
      "# skills readme — not a skill directory\n",
    );
    try {
      const r = await runPublicSurfaceCountDriftProbe(fx.root);
      // Documented values still 5/3 (matching the 5 real dirs); no
      // violations should surface — i.e., the probe did not count the
      // stray README.md as a skill.
      expect(r.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("max probe number is the largest decimal prefix matched by /^(\\d+)\\.\\s/ in SKILL.md", async () => {
    const fx = makeFixture({
      skillsCount: 5,
      agentsCount: 3,
      maxProbeNumber: 42,
      readmeContent: readmeWith({
        skillsToken: "5 commands, 3 agents",
        probeCount: "42",
      }),
      claudeMdContent: claudeMdWith({
        skillsLine: "→ 5 slash commands",
        agentsLine: "→ 3 subagent templates",
      }),
    });
    try {
      const r = await runPublicSurfaceCountDriftProbe(fx.root);
      expect(r.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });
});

describe("AC-STE-315.3 — violations emit NFR-10 canonical refusal shape", () => {
  test("each violation note has file:line:column shape with Refusing/Remedy/Context", async () => {
    const fx = makeFixture({
      skillsCount: 23,
      agentsCount: 8,
      maxProbeNumber: 57,
      // Documented 15 commands → mismatches the 23 on-disk skills.
      readmeContent: readmeWith({
        skillsToken: "15 commands, 5 agents",
        probeCount: "57",
      }),
      claudeMdContent: claudeMdWith({
        skillsLine:
          "├── skills/                              → 23 slash commands (16 user-invocable + 7 dispatch)",
        agentsLine: "├── agents/                              → 8 subagent templates",
      }),
    });
    try {
      const r = await runPublicSurfaceCountDriftProbe(fx.root);
      expect(r.violations.length).toBeGreaterThan(0);
      const v = r.violations[0]!;
      // file:line:column anchor
      expect(v.message).toMatch(/^README\.md:\d+:\d+ — /m);
      // NFR-10 sub-lines (canonical refusal shape)
      expect(v.message).toMatch(/Refusing:/);
      expect(v.message).toMatch(/Remedy:/);
      expect(v.message).toMatch(/Context:/);
      // Documented vs observed values surfaced in the message
      expect(v.message).toMatch(/15/);
      expect(v.message).toMatch(/23/);
    } finally {
      fx.cleanup();
    }
  });

  test("zero violations → empty violations array (standard GATE PASSED row)", async () => {
    const fx = makeFixture({
      skillsCount: 23,
      agentsCount: 8,
      maxProbeNumber: 57,
      readmeContent: readmeWith({
        skillsToken: "16 commands, 8 agents",
        probeCount: "57",
      }),
      claudeMdContent: claudeMdWith({
        skillsLine:
          "├── skills/                              → 23 slash commands (16 user-invocable + 7 dispatch)",
        agentsLine: "├── agents/                              → 8 subagent templates",
      }),
    });
    try {
      const r = await runPublicSurfaceCountDriftProbe(fx.root);
      expect(r.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });
});

describe("AC-STE-315.4 — post-backfill, /gate-check PASSes on the real toolkit repo", () => {
  test("running the probe against the real repo root returns zero violations", async () => {
    // Once the backfill in AC-STE-315.4 lands, the probe must PASS on
    // main. This drives the end-to-end shape: probe-against-real-tree.
    const r = await runPublicSurfaceCountDriftProbe(repoRoot);
    if (r.violations.length > 0) {
      // Surface every drift so the failing test names the offending
      // surfaces — much more useful than a bare `expect(0)`.
      const noted = r.violations.map((v) => v.message).join("\n---\n");
      throw new Error(
        `Expected zero public-surface count-drift violations, got ${r.violations.length}:\n${noted}`,
      );
    }
    expect(r.violations).toEqual([]);
  });

  test("README.md carries the byte-exact post-backfill tokens", () => {
    const readme = readFileSync(join(repoRoot, "README.md"), "utf-8");
    // M108/STE-391 recalibration: `/upgrade` shipped as the 17th user-invocable
    // skill, moving 16 → 17 / 23 → 24. M109/STE-395 then de-listed it
    // (`user-invocable: false`), so the user-invocable half went BACK to 16 and
    // the non-user-invocable half to 8. The on-disk TOTAL never moved off 24.
    // Probe counts are untouched by both.
    //
    // Each token is located by a content anchor rather than a line index. These
    // assertions used to pin absolute line numbers, which made every cosmetic
    // edit a false red: a banner image added above the fold shifted six pinned
    // lines by +4 and failed a suite that only cares about which NUMBERS the
    // README claims, not which row they land on. The anchor is the thing that
    // makes a line that line; `onlyLine` still asserts uniqueness, so the
    // "this exact line" precision survives.

    // "16 commands, 8 agents" — the one-paragraph pitch under the H1.
    expect(onlyLine(readme, /^A Claude Code plugin that adds/)).toMatch(
      /16 commands?,\s+8 agents?/,
    );
    // 69 numbered probes (M109/STE-394 added #69 upgrade_staleness on top of
    // M108/STE-393's #68 migration_coverage) — the Features bullet.
    expect(onlyLine(readme, /numbered `\/gate-check` probes/)).toMatch(/\b69\b.*numbered/);
    // "69 probes" — the /implement-invokes-/tdd paragraph's aside.
    expect(onlyLine(readme, /which layers \d+ probes on top/)).toMatch(/\b69\b\s+probes/);
    // "Eight additional skills" — M109/STE-395: `/upgrade` joined the
    // non-user-invocable set, so the byte-strict literal moved seven → eight.
    // It is NOT a fork child, which is why the paragraph's `context: fork`
    // claim had to be split rather than merely re-counted.
    expect(onlyLine(readme, /additional skills \(`spec-research`/)).toMatch(
      /Eight additional skills/,
    );
    // "24 (16 + 8)" — the skills/ row of the repo-tree block.
    expect(onlyLine(readme, /^│\s+├── skills\//)).toMatch(/24\s+\(16\s*\+\s*8\)/);
    // "8 specialist agents" with spec-reviewer enumerated — the agents/ row.
    // M108 ships no new agent — the registry is a library, not a subagent.
    const agentsRow = onlyLine(readme, /^│\s+├── agents\//);
    expect(agentsRow).toMatch(/\b8 specialist agents\b/);
    expect(agentsRow).toMatch(/spec-reviewer/);
  });

  test("CLAUDE.md carries the byte-exact post-backfill tokens", () => {
    const claudeMd = readFileSync(join(repoRoot, "CLAUDE.md"), "utf-8");
    // "24 slash commands (16 user-invocable + 8 dispatch …)" (M109/STE-395:
    // `/upgrade` left the menu, so the split moved 17+7 → 16+8; the total holds
    // at 24). This literal is load-bearing beyond its numbers — the probe's
    // `splitMatch` regex reads it, and rewording off the regex silently
    // disables the whole README-versus-CLAUDE leg (AC-STE-395.4).
    expect(onlyLine(claudeMd, /^├── skills\//)).toMatch(
      /24\s+slash commands\s+\(16\s+user-invocable\s+\+\s+8\s+dispatch/,
    );
    // "8 subagent templates"
    const agentsRow = onlyLine(claudeMd, /^├── agents\//);
    expect(agentsRow).toMatch(/\b8\s+subagent templates\b/);
    expect(agentsRow).toMatch(/spec-reviewer/);
  });

  test("docs/skill-anatomy.md says 'the other 23 skills'", () => {
    // M108/STE-391: 22 → 23. This counts TOTAL skills minus the one canonical
    // `allowed-tools:` carrier (spec-review), so it tracks the 23 → 24 on-disk
    // total, not the 16 → 17 user-invocable split. `skills/upgrade/SKILL.md`
    // omits the field, so it joins the "other" side.
    const doc = readFileSync(
      join(repoRoot, "plugins", "dev-process-toolkit", "docs", "skill-anatomy.md"),
      "utf-8",
    );
    expect(onlyLine(doc, /canonical read-only example/)).toMatch(/the other 23 skills/);
  });

  test("skills/gate-check/SKILL.md carries a 'probe N+' next-probe anchor near the probe-authoring contract", () => {
    const skillMd = readFileSync(skillMdPath, "utf-8");
    // STE-324 added probe #59, so the next-probe anchor reads "probe 60+";
    // anchor by content (not line number) because each new probe shifts lines.
    expect(skillMd).toMatch(/probe 60\+/);
  });

  test("specs/testing-spec.md says 'all 24 skills'", () => {
    // M108/STE-391: 23 → 24. Like the skill-anatomy anchor above, this row
    // counts the on-disk skill total, not the 16 → 17 user-invocable split.
    const doc = readFileSync(join(repoRoot, "specs", "testing-spec.md"), "utf-8");
    expect(onlyLine(doc, /v2-minimal regression/)).toMatch(/all 24 skills/);
  });
});

describe("AC-STE-315.5 — synthetic fixture coverage: PASS + 3 FAIL cases", () => {
  test("(a) PASS — byte-exact counts → zero violations", async () => {
    const fx = makeFixture({
      skillsCount: 23,
      agentsCount: 8,
      maxProbeNumber: 57,
      readmeContent: readmeWith({
        skillsToken: "16 commands, 8 agents",
        probeCount: "57",
      }),
      claudeMdContent: claudeMdWith({
        skillsLine:
          "├── skills/                              → 23 slash commands (16 user-invocable + 7 dispatch)",
        agentsLine: "├── agents/                              → 8 subagent templates",
      }),
    });
    try {
      const r = await runPublicSurfaceCountDriftProbe(fx.root);
      expect(r.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("(b) FAIL — stale skill-count token at README.md:3 → NFR-10 violation", async () => {
    const fx = makeFixture({
      skillsCount: 23,
      agentsCount: 8,
      maxProbeNumber: 57,
      // Stale: "15 commands" vs observed 16 user-callable.
      readmeContent: readmeWith({
        skillsToken: "15 commands, 8 agents",
        probeCount: "57",
      }),
      claudeMdContent: claudeMdWith({
        skillsLine:
          "├── skills/                              → 23 slash commands (16 user-invocable + 7 dispatch)",
        agentsLine: "├── agents/                              → 8 subagent templates",
      }),
    });
    try {
      const r = await runPublicSurfaceCountDriftProbe(fx.root);
      expect(r.violations.length).toBeGreaterThan(0);
      const hit = r.violations.find(
        (v) =>
          /README\.md:3:\d+/.test(v.message) ||
          (v.file?.endsWith("README.md") === true && v.line === 3),
      );
      expect(hit).toBeDefined();
      const msg = hit!.message;
      // NFR-10 canonical shape: <file>:<line>:<column> — <reason>
      expect(msg).toMatch(/^README\.md:3:\d+ — /m);
      expect(msg).toMatch(/Refusing:/);
      expect(msg).toMatch(/Remedy:/);
      expect(msg).toMatch(/Context:/);
      // Documented + observed values surfaced.
      expect(msg).toMatch(/15/);
      expect(msg).toMatch(/16/);
    } finally {
      fx.cleanup();
    }
  });

  test("(c) FAIL — stale probe-count token at README.md:10 → NFR-10 violation", async () => {
    const fx = makeFixture({
      skillsCount: 23,
      agentsCount: 8,
      maxProbeNumber: 57,
      // Stale: "51 numbered" vs observed max-probe 57.
      readmeContent: readmeWith({
        skillsToken: "16 commands, 8 agents",
        probeCount: "51",
      }),
      claudeMdContent: claudeMdWith({
        skillsLine:
          "├── skills/                              → 23 slash commands (16 user-invocable + 7 dispatch)",
        agentsLine: "├── agents/                              → 8 subagent templates",
      }),
    });
    try {
      const r = await runPublicSurfaceCountDriftProbe(fx.root);
      expect(r.violations.length).toBeGreaterThan(0);
      const hit = r.violations.find(
        (v) =>
          /README\.md:10:\d+/.test(v.message) ||
          (v.file?.endsWith("README.md") === true && v.line === 10),
      );
      expect(hit).toBeDefined();
      const msg = hit!.message;
      expect(msg).toMatch(/^README\.md:10:\d+ — /m);
      expect(msg).toMatch(/Refusing:/);
      expect(msg).toMatch(/Remedy:/);
      expect(msg).toMatch(/Context:/);
      expect(msg).toMatch(/51/);
      expect(msg).toMatch(/57/);
    } finally {
      fx.cleanup();
    }
  });

  test("(d) FAIL — stale agent-count token at CLAUDE.md:16 → NFR-10 violation", async () => {
    const fx = makeFixture({
      skillsCount: 23,
      agentsCount: 8,
      maxProbeNumber: 57,
      readmeContent: readmeWith({
        skillsToken: "16 commands, 8 agents",
        probeCount: "57",
      }),
      claudeMdContent: claudeMdWith({
        skillsLine:
          "├── skills/                              → 23 slash commands (16 user-invocable + 7 dispatch)",
        // Stale: "6 subagent templates" vs observed 8 on disk.
        agentsLine: "├── agents/                              → 6 subagent templates",
      }),
    });
    try {
      const r = await runPublicSurfaceCountDriftProbe(fx.root);
      expect(r.violations.length).toBeGreaterThan(0);
      const hit = r.violations.find(
        (v) =>
          /CLAUDE\.md:16:\d+/.test(v.message) ||
          (v.file?.endsWith("CLAUDE.md") === true && v.line === 16),
      );
      expect(hit).toBeDefined();
      const msg = hit!.message;
      expect(msg).toMatch(/^CLAUDE\.md:16:\d+ — /m);
      expect(msg).toMatch(/Refusing:/);
      expect(msg).toMatch(/Remedy:/);
      expect(msg).toMatch(/Context:/);
      expect(msg).toMatch(/\b6\b/);
      expect(msg).toMatch(/\b8\b/);
    } finally {
      fx.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// M109 STE-394 AC-STE-394.8 — repair the DEAD probe-count leg.
//
// `parseReadmeTokens` read the probe token off a FIXED index (`lines[9]`, i.e.
// README line 10). The token has not lived on line 10 for a long time — README
// line 10 is the `## Features` heading and the `N numbered` token sits at line
// 14 — so the regex never matched, `readmeProbes` stayed permanently
// `undefined`, and the probe-count comparison was skipped with zero violations.
// Case (c) above passes only because its synthetic README puts the token on
// line 10 by construction: the fixture was shaped around the bug.
//
// The repair anchors the parse BY CONTENT (scan for the `N numbered` token),
// and the assertions below are the non-vacuity proof the leg actually fires:
// a README whose probe count disagrees with disk MUST produce a violation.
// These are RED against today's code — that is the point.
// ---------------------------------------------------------------------------

describe("AC-STE-394.8 — the probe-count leg is live, not silently skipped", () => {
  const realReadme = (): string => readFileSync(join(repoRoot, "README.md"), "utf-8");

  /** The probe count the real README documents, whatever the current calibration. */
  function documentedProbeCount(readme: string): number {
    const m = readme.match(/(\d+) numbered `\/gate-check` probes/);
    if (m === null) throw new Error("README carries no `N numbered /gate-check probes` token");
    return Number(m[1]);
  }

  /** The 1-based README line the probe token actually lives on. */
  function tokenLine(readme: string): number {
    const idx = readme
      .split("\n")
      .findIndex((l) => /\d+ numbered `\/gate-check` probes/.test(l));
    if (idx < 0) throw new Error("README carries no probe-count token line");
    return idx + 1;
  }

  // Must agree with the REAL README bytes these fixtures pair it with. STE-395
  // re-keyed that README to `16 commands`, so a 17/7 split here would silently
  // fire the cross-doc commands leg — invisible to the probe-count-filtered
  // assertions below, and it would make the "no over-fire" case a false green.
  const matchingClaudeMd = claudeMdWith({
    skillsLine:
      "├── skills/                              → 24 slash commands (16 user-invocable + 8 dispatch)",
    agentsLine: "├── agents/                              → 8 subagent templates",
  });

  test("the parse is anchored by content, not by a fixed line index", () => {
    const src = readFileSync(probeModulePath, "utf-8");
    // The dead fixed-index read is gone. `lines[9]` is the whole bug.
    expect(src).not.toContain("lines[9]");
    expect(src).not.toMatch(/const\s+line10\b/);
  });

  test("REAL README bytes + a disagreeing disk count ⇒ a probe-count violation", async () => {
    const readme = realReadme();
    const documented = documentedProbeCount(readme);
    const fx = makeFixture({
      skillsCount: 24,
      agentsCount: 8,
      // Deliberately one higher than what the README documents.
      maxProbeNumber: documented + 1,
      readmeContent: readme,
      claudeMdContent: matchingClaudeMd,
    });
    try {
      const r = await runPublicSurfaceCountDriftProbe(fx.root);
      const hit = r.violations.find(
        (v) => v.file === "README.md" && /probe count/i.test(v.reason),
      );
      expect(hit).toBeDefined();
      expect(hit!.message).toContain(String(documented));
      expect(hit!.message).toContain(String(documented + 1));
    } finally {
      fx.cleanup();
    }
  });

  test("the violation anchors at the line the token really occupies — not line 10", async () => {
    const readme = realReadme();
    const documented = documentedProbeCount(readme);
    const line = tokenLine(readme);
    // The premise of the repair: the token has moved off the hard-coded index.
    expect(line).not.toBe(10);
    const fx = makeFixture({
      skillsCount: 24,
      agentsCount: 8,
      maxProbeNumber: documented + 1,
      readmeContent: readme,
      claudeMdContent: matchingClaudeMd,
    });
    try {
      const r = await runPublicSurfaceCountDriftProbe(fx.root);
      const hit = r.violations.find(
        (v) => v.file === "README.md" && /probe count/i.test(v.reason),
      );
      expect(hit).toBeDefined();
      expect(hit!.line).toBe(line);
      expect(hit!.message).toMatch(new RegExp(`^README\\.md:${line}:\\d+ — `, "m"));
    } finally {
      fx.cleanup();
    }
  });

  test("a synthetic README with the token well past line 10 still parses", async () => {
    // 20 lines of preamble, token on line 21 — nowhere near any fixed index.
    const readmeContent = [
      "# Dev Process Toolkit",
      "",
      "A Claude Code plugin. Includes 17 commands, 8 agents, spec templates, and documentation.",
      "",
      "<p align=\"center\">",
      "  <img src=\"assets/banner.jpg\" alt=\"banner\" width=\"600\">",
      "</p>",
      "",
      "## Features",
      "",
      "- a",
      "- b",
      "- c",
      "- d",
      "- e",
      "- f",
      "- g",
      "- h",
      "- i",
      "- j",
      "- **Deterministic quality gates** — 42 numbered `/gate-check` probes override LLM judgment",
      "",
    ].join("\n");
    const fx = makeFixture({
      skillsCount: 24,
      agentsCount: 8,
      maxProbeNumber: 69, // disagrees with the documented 42
      readmeContent,
      claudeMdContent: matchingClaudeMd,
    });
    try {
      const r = await runPublicSurfaceCountDriftProbe(fx.root);
      const hit = r.violations.find(
        (v) => v.file === "README.md" && /probe count/i.test(v.reason),
      );
      expect(hit).toBeDefined();
      expect(hit!.line).toBe(21);
      expect(hit!.message).toMatch(/42/);
      expect(hit!.message).toMatch(/69/);
    } finally {
      fx.cleanup();
    }
  });

  test("no over-fire: REAL README bytes + an AGREEING disk count ⇒ no probe-count violation", async () => {
    const readme = realReadme();
    const documented = documentedProbeCount(readme);
    const fx = makeFixture({
      skillsCount: 24,
      agentsCount: 8,
      maxProbeNumber: documented,
      readmeContent: readme,
      claudeMdContent: matchingClaudeMd,
    });
    try {
      const r = await runPublicSurfaceCountDriftProbe(fx.root);
      const hit = r.violations.find(
        (v) => v.file === "README.md" && /probe count/i.test(v.reason),
      );
      expect(hit).toBeUndefined();
      // Assert what the test name claims: a fully-agreeing tree fires NOTHING.
      // Filtering to /probe count/i alone would let a stray cross-doc commands
      // violation pass unseen — which is exactly what a stale 17/7 CLAUDE.md
      // fixture used to do here.
      expect(r.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("a README carrying no probe token at all stays vacuous (no violation)", async () => {
    const fx = makeFixture({
      skillsCount: 24,
      agentsCount: 8,
      maxProbeNumber: 69,
      readmeContent: "# Some Project\n\nNo counts documented here at all.\n",
      claudeMdContent: matchingClaudeMd,
    });
    try {
      const r = await runPublicSurfaceCountDriftProbe(fx.root);
      const hit = r.violations.find(
        (v) => v.file === "README.md" && /probe count/i.test(v.reason),
      );
      expect(hit).toBeUndefined();
    } finally {
      fx.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// CONSUMER-SAFETY REGRESSION GUARD for AC-STE-394.8.
//
// Repairing the dead probe-count leg (above) turned a never-firing comparison
// into a live one, and the scan that revives it is loose: any line anywhere in
// the README matching `N numbered` claims the probe token. In the TOOLKIT repo
// that is harmless — the only such line is the real one. In a CONSUMER project
// it is a gate-breaking false positive:
//
//   * `computeObservedCounts` returns maxProbeNumber 0 whenever
//     `plugins/dev-process-toolkit/skills/gate-check/SKILL.md` is absent, which
//     is EVERY consumer project.
//   * The diskChecks loop has no toolkit-tree guard and no zero-guard.
//
// So a consumer README carrying ordinary prose — "follow the 3 numbered steps"
// — trips a severity:error GATE FAILED whose remedy instructs the user to
// rewrite their own README to document "0 numbered probes". The probe must stay
// silent on incidental prose.
//
// These assertions pin the BEHAVIOUR (zero violations on a consumer-shaped
// tree), not the shape of the fix: narrowing the scan to the full
// ``N numbered `/gate-check` probes`` token, gating on the toolkit tree, or
// skipping a zero observed count all satisfy them equally. The AC-STE-394.8
// block above independently proves the leg still fires on the real token, so
// "delete the leg again" is not an escape hatch.
// ---------------------------------------------------------------------------

describe("AC-STE-394.8 consumer-safety guard — the probe-count scan must not over-fire on incidental prose", () => {
  // A consumer project: NO `plugins/dev-process-toolkit/` tree at all. This is
  // the shape of every project that installs the toolkit as a plugin rather
  // than being the toolkit. `makeFixture` cannot express it — it always
  // synthesizes the plugin tree — so the consumer tree is built here.
  function makeConsumerFixture(opts: {
    readmeContent: string;
    claudeMdContent?: string;
  }): Fixture {
    const root = mkdtempSync(join(tmpdir(), "pscd-consumer-"));
    // A believable consumer layout — source + specs, and pointedly no
    // `plugins/dev-process-toolkit/`.
    mkdirSync(join(root, "src"), { recursive: true });
    mkdirSync(join(root, "specs", "frs"), { recursive: true });
    writeFileSync(join(root, "src", "index.ts"), "export const answer = 42;\n");
    writeFileSync(join(root, "README.md"), opts.readmeContent);
    writeFileSync(
      join(root, "CLAUDE.md"),
      opts.claudeMdContent ??
        [
          "# Acme Widget Service",
          "",
          "## What This Is",
          "",
          "A small HTTP service for widgets.",
          "",
          "## Key Commands",
          "",
          "- `bun test` — full gate",
          "- `bun run build` — compile",
          "",
          "## Gating rule",
          "",
          "`bun test` must pass before any commit.",
          "",
        ].join("\n"),
    );
    return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
  }

  // Guard the fixture's own premise: if this tree ever grows a toolkit
  // directory the cases below would stop testing consumer behaviour.
  test("the consumer fixture genuinely has no toolkit tree", () => {
    const fx = makeConsumerFixture({
      readmeContent: "# Acme\n\nFollow the 3 numbered steps below to get started.\n",
    });
    try {
      expect(existsSync(join(fx.root, "plugins", "dev-process-toolkit"))).toBe(false);
      expect(
        existsSync(
          join(fx.root, "plugins", "dev-process-toolkit", "skills", "gate-check", "SKILL.md"),
        ),
      ).toBe(false);
    } finally {
      fx.cleanup();
    }
  });

  // Each phrasing is ordinary English that happens to put a digit before the
  // word "numbered". None of them documents a /gate-check probe count.
  const incidentalPhrasings: Array<{ label: string; line: string }> = [
    {
      label: "\"the 3 numbered steps\" (the reproduced case)",
      line: "Follow the 3 numbered steps below to get started.",
    },
    {
      label: "\"12 numbered migrations\"",
      line: "The changelog lists 12 numbered migrations applied since v1.",
    },
    {
      label: "\"7 numbered sections\"",
      line: "Our RFC template has 7 numbered sections you must fill in.",
    },
  ];

  for (const phrasing of incidentalPhrasings) {
    test(`consumer README with ${phrasing.label} ⇒ ZERO violations`, async () => {
      const fx = makeConsumerFixture({
        readmeContent: [
          "# Acme Widget Service",
          "",
          "A small HTTP service for widgets. Not the toolkit.",
          "",
          "## Getting Started",
          "",
          phrasing.line,
          "",
          "1. Install dependencies",
          "2. Configure the environment",
          "3. Run the server",
          "",
        ].join("\n"),
      });
      try {
        const r = await runPublicSurfaceCountDriftProbe(fx.root);
        // The whole report must be clean: a single violation here is a
        // severity:error GATE FAILED in someone else's repo.
        if (r.violations.length > 0) {
          const noted = r.violations.map((v) => v.message).join("\n---\n");
          throw new Error(
            `Probe over-fired on a consumer project (${r.violations.length} violation(s)):\n${noted}`,
          );
        }
        expect(r.violations).toEqual([]);
      } finally {
        fx.cleanup();
      }
    });
  }

  test("the over-fire never emits the nonsensical 'reflect 0 numbered probes' remedy", async () => {
    // The most user-hostile symptom: telling a consumer to rewrite their own
    // README to claim zero probes, sourced from a toolkit path they do not have.
    const fx = makeConsumerFixture({
      readmeContent: [
        "# Acme Widget Service",
        "",
        "Setup takes about five minutes.",
        "",
        "Follow the 3 numbered steps below to get started.",
        "",
      ].join("\n"),
    });
    try {
      const r = await runPublicSurfaceCountDriftProbe(fx.root);
      const bad = r.violations.filter((v) => /probe/i.test(v.message));
      expect(bad).toEqual([]);
      for (const v of r.violations) {
        expect(v.message).not.toMatch(/reflect 0 numbered probes/);
        expect(v.message).not.toMatch(/plugins\/dev-process-toolkit/);
      }
    } finally {
      fx.cleanup();
    }
  });

  test("a consumer whose README documents counts for its OWN surfaces stays clean", async () => {
    // Realistic drift-prone consumer prose: several incidental count tokens in
    // one file, none of them the toolkit's probe token.
    const fx = makeConsumerFixture({
      readmeContent: [
        "# Acme Widget Service",
        "",
        "Ships 4 numbered API versions and 9 numbered error codes.",
        "",
        "## Setup",
        "",
        "Follow the 3 numbered steps below to get started.",
        "",
        "## Runbook",
        "",
        "There are 22 numbered runbook entries in `docs/runbook.md`.",
        "",
      ].join("\n"),
    });
    try {
      const r = await runPublicSurfaceCountDriftProbe(fx.root);
      expect(r.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });
});
