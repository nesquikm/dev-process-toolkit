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

  test("README.md L3 / L10 / L104 / L139 / L163 / L164 carry the byte-exact post-backfill tokens", () => {
    const readme = readFileSync(join(repoRoot, "README.md"), "utf-8");
    const lines = readme.split("\n");
    // L3 — "16 commands, 8 agents"
    expect(lines[2]).toMatch(/16 commands?,\s+8 agents?/);
    // L10 — 60 numbered (matches "60 numbered ... probes" — STE-336 added #60)
    expect(lines[9]).toMatch(/\b60\b.*numbered/);
    // L104 — "60 probes" (on-disk max-probe is 60 after STE-336; STE-337 added
    // the `## Prerequisites` section, shifting this token +11 lines from L93)
    expect(lines[103]).toMatch(/\b60\b\s+probes/);
    // L139 — "Seven additional skills" (the workflow-overview pointer added
    // under the `## Workflow` diagram shifted this token +2 lines from L137)
    expect(lines[138]).toMatch(/Seven additional skills/);
    // L163 — "23 (16 + 7)"
    expect(lines[162]).toMatch(/23\s+\(16\s*\+\s*7\)/);
    // L164 — "8 specialist agents" with spec-reviewer enumerated
    expect(lines[163]).toMatch(/\b8 specialist agents\b/);
    expect(lines[163]).toMatch(/spec-reviewer/);
  });

  test("CLAUDE.md L15 / L16 carry the byte-exact post-backfill tokens", () => {
    const claudeMd = readFileSync(join(repoRoot, "CLAUDE.md"), "utf-8");
    const lines = claudeMd.split("\n");
    // L15 — "23 slash commands (16 user-invocable + 7 dispatch …)"
    expect(lines[14]).toMatch(
      /23\s+slash commands\s+\(16\s+user-invocable\s+\+\s+7\s+dispatch/,
    );
    // L16 — "8 subagent templates"
    expect(lines[15]).toMatch(/\b8\s+subagent templates\b/);
    expect(lines[15]).toMatch(/spec-reviewer/);
  });

  test("docs/skill-anatomy.md L54 says 'the other 22 skills'", () => {
    const doc = readFileSync(
      join(repoRoot, "plugins", "dev-process-toolkit", "docs", "skill-anatomy.md"),
      "utf-8",
    );
    const lines = doc.split("\n");
    expect(lines[53]).toMatch(/the other 22 skills/);
  });

  test("skills/gate-check/SKILL.md carries a 'probe N+' next-probe anchor near the probe-authoring contract", () => {
    const skillMd = readFileSync(skillMdPath, "utf-8");
    // STE-324 added probe #59, so the next-probe anchor reads "probe 60+";
    // anchor by content (not line number) because each new probe shifts lines.
    expect(skillMd).toMatch(/probe 60\+/);
  });

  test("specs/testing-spec.md L58 says 'all 23 skills'", () => {
    const doc = readFileSync(join(repoRoot, "specs", "testing-spec.md"), "utf-8");
    const lines = doc.split("\n");
    expect(lines[57]).toMatch(/all 23 skills/);
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
