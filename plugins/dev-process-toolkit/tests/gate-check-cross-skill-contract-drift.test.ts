// STE-318 — /gate-check probe `cross_skill_contract_drift` (#58).
//
// Closes two active cross-skill contract drifts where shipped FRs changed
// runtime canon but the documentation surfaces never caught up:
//   A2  — /tdd 4-stage architecture (STE-296, M77): 8 surfaces still describe
//          /tdd as RED → GREEN → REFACTOR via "three forked subagents".
//   A6  — 2-tier ticket-binding resolver (v1.21.0): 5 SKILL.md surfaces still
//          cite "3-tier ticket-binding resolver".
//   A14 — [retired in M100/STE-373] the `deps_research_result_shape`
//          phantom-probe guard was removed once STE-373 shipped the real
//          probe (#64); the reference is now canonical, not drift.
//
// RED-state until the implementation lands at:
//   plugins/dev-process-toolkit/adapters/_shared/src/cross_skill_contract_drift.ts
//
// AC coverage:
//   AC-STE-318.1 — active-surface scan: forbidden /tdd 4-stage paraphrase
//                  regex returns zero matches.
//   AC-STE-318.2 — active-surface scan: forbidden "3-tier resolver" regex
//                  returns zero matches in five named SKILL.md + doc files.
//   AC-STE-318.3 — [superseded by M100/STE-373] the deps-researcher.md
//                  probe reference is now canonical; STE-373's m100 meta-test
//                  owns the agent-file content assertions.
//   AC-STE-318.4 — new probe module + PROBE_ID + severity + #58 registration
//                  in skills/gate-check/SKILL.md.
//   AC-STE-318.5 — synthetic fixture coverage: (a) PASS clean fixture,
//                  (b) FAIL re-introduced "three forked subagents",
//                  (c) FAIL re-introduced "3-tier resolver".

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
  runCrossSkillContractDriftProbe,
} from "../adapters/_shared/src/cross_skill_contract_drift";

const repoRoot = join(import.meta.dir, "..", "..", "..");
const probeModulePath = join(
  repoRoot,
  "plugins",
  "dev-process-toolkit",
  "adapters",
  "_shared",
  "src",
  "cross_skill_contract_drift.ts",
);
const gateCheckSkillMdPath = join(
  repoRoot,
  "plugins",
  "dev-process-toolkit",
  "skills",
  "gate-check",
  "SKILL.md",
);
const depsResearcherAgentMdPath = join(
  repoRoot,
  "plugins",
  "dev-process-toolkit",
  "agents",
  "deps-researcher.md",
);

// ---------------------------------------------------------------------------
// AC-STE-318.1 — /tdd 4-stage paraphrase: zero matches on active surfaces
// ---------------------------------------------------------------------------

// Forbidden paraphrase regex per spec body. Active-surface scope:
//   plugins/dev-process-toolkit/{skills,docs,agents,README.md}
// Archive is excluded (`skills/.archive`, `docs/archive`, etc. are not under
// the active surface roots the regex walks).
const FORBIDDEN_TDD_4STAGE_REGEX =
  /three forked( TDD)? subagents|three forked-subagent stages|forks three subagents|RED → GREEN → REFACTOR for one FR via three|RED → GREEN → VERIFY/;

const ACTIVE_SURFACE_ROOTS: readonly string[] = [
  join(repoRoot, "plugins", "dev-process-toolkit", "skills"),
  join(repoRoot, "plugins", "dev-process-toolkit", "docs"),
  join(repoRoot, "plugins", "dev-process-toolkit", "agents"),
];

const READMEMD_PATH = join(repoRoot, "README.md");

// Walk a directory tree returning the absolute paths of every regular file.
// Filters out `node_modules` and any `archive` / `.archive` directory by name
// so the scan stays inside the active-surface scope. Inert (returns []) if
// the root does not exist — keeps the probe vacuous on non-toolkit repos.
function walkActiveFiles(root: string): string[] {
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    let entries: string[];
    try {
      entries = require("node:fs").readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries as Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>) {
      const name = ent.name;
      if (name === "node_modules" || name === "archive" || name === ".archive") continue;
      const abs = join(cur, name);
      if (ent.isDirectory()) {
        stack.push(abs);
      } else if (ent.isFile()) {
        out.push(abs);
      }
    }
  }
  return out;
}

describe("AC-STE-318.1 — active-surface scan: /tdd 4-stage paraphrase", () => {
  test("forbidden regex returns zero matches across plugins/.../{skills,docs,agents,README.md}", () => {
    const offenders: Array<{ file: string; line: number; text: string }> = [];

    const filesToScan: string[] = [];
    for (const root of ACTIVE_SURFACE_ROOTS) {
      if (existsSync(root)) filesToScan.push(...walkActiveFiles(root));
    }
    if (existsSync(READMEMD_PATH)) filesToScan.push(READMEMD_PATH);

    for (const abs of filesToScan) {
      // Only scan text-shaped surfaces (markdown + plain prose). Binary
      // assets, lockfiles, and JSON aren't part of the documentation
      // contract drift surface.
      if (!/\.(md|txt)$/.test(abs)) continue;
      let text: string;
      try {
        text = readFileSync(abs, "utf-8");
      } catch {
        continue;
      }
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (FORBIDDEN_TDD_4STAGE_REGEX.test(line)) {
          offenders.push({ file: abs, line: i + 1, text: line });
        }
      }
    }

    if (offenders.length > 0) {
      const noted = offenders
        .map((o) => `${o.file}:${o.line} — ${o.text.trim()}`)
        .join("\n");
      throw new Error(
        `Expected zero /tdd 4-stage drift hits, got ${offenders.length}:\n${noted}`,
      );
    }
    expect(offenders).toEqual([]);
  });

  test("canonical replacement vocabulary is present on the canonical /tdd surfaces", () => {
    // After the rewrite, the canonical phrases land verbatim on the
    // primary surfaces. README L137's Agents table already names
    // `tdd-spec-reviewer` (proving the AUDIT vocabulary is canonical);
    // the rest of the prose must catch up.
    const tddSkillMd = readFileSync(
      join(
        repoRoot,
        "plugins",
        "dev-process-toolkit",
        "skills",
        "tdd",
        "SKILL.md",
      ),
      "utf-8",
    );
    expect(tddSkillMd).toMatch(/four forked subagents/);

    const skillAnatomy = readFileSync(
      join(
        repoRoot,
        "plugins",
        "dev-process-toolkit",
        "docs",
        "skill-anatomy.md",
      ),
      "utf-8",
    );
    expect(skillAnatomy).toMatch(/RED → GREEN → REFACTOR → AUDIT/);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-318.2 — "3-tier resolver" paraphrase: zero matches on five files
// ---------------------------------------------------------------------------

const FORBIDDEN_3TIER_REGEX = /3-tier (ticket-binding|resolver)/;

const TICKET_BINDING_SURFACE_FILES: readonly string[] = [
  join(
    repoRoot,
    "plugins",
    "dev-process-toolkit",
    "skills",
    "implement",
    "SKILL.md",
  ),
  join(
    repoRoot,
    "plugins",
    "dev-process-toolkit",
    "skills",
    "spec-write",
    "SKILL.md",
  ),
  join(
    repoRoot,
    "plugins",
    "dev-process-toolkit",
    "skills",
    "gate-check",
    "SKILL.md",
  ),
  join(
    repoRoot,
    "plugins",
    "dev-process-toolkit",
    "skills",
    "pr",
    "SKILL.md",
  ),
  join(
    repoRoot,
    "plugins",
    "dev-process-toolkit",
    "docs",
    "gate-check-tracker-mode.md",
  ),
];

describe("AC-STE-318.2 — active-surface scan: 3-tier resolver paraphrase", () => {
  test("forbidden regex returns zero matches across the five named ticket-binding surfaces", () => {
    const offenders: Array<{ file: string; line: number; text: string }> = [];

    for (const abs of TICKET_BINDING_SURFACE_FILES) {
      if (!existsSync(abs)) continue;
      const text = readFileSync(abs, "utf-8");
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (FORBIDDEN_3TIER_REGEX.test(line)) {
          offenders.push({ file: abs, line: i + 1, text: line });
        }
      }
    }

    if (offenders.length > 0) {
      const noted = offenders
        .map((o) => `${o.file}:${o.line} — ${o.text.trim()}`)
        .join("\n");
      throw new Error(
        `Expected zero 3-tier resolver drift hits, got ${offenders.length}:\n${noted}`,
      );
    }
    expect(offenders).toEqual([]);
  });

  test("forbidden regex also returns zero matches across the broader skills + docs scope", () => {
    // Per AC.2: `git grep -nE "3-tier (ticket-binding|resolver)"
    // plugins/dev-process-toolkit/{skills,docs}` returns zero matches.
    const offenders: Array<{ file: string; line: number; text: string }> = [];

    const scope: string[] = [];
    const skillsRoot = join(repoRoot, "plugins", "dev-process-toolkit", "skills");
    const docsRoot = join(repoRoot, "plugins", "dev-process-toolkit", "docs");
    if (existsSync(skillsRoot)) scope.push(...walkActiveFiles(skillsRoot));
    if (existsSync(docsRoot)) scope.push(...walkActiveFiles(docsRoot));

    for (const abs of scope) {
      if (!/\.(md|txt)$/.test(abs)) continue;
      let text: string;
      try {
        text = readFileSync(abs, "utf-8");
      } catch {
        continue;
      }
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (FORBIDDEN_3TIER_REGEX.test(line)) {
          offenders.push({ file: abs, line: i + 1, text: line });
        }
      }
    }

    if (offenders.length > 0) {
      const noted = offenders
        .map((o) => `${o.file}:${o.line} — ${o.text.trim()}`)
        .join("\n");
      throw new Error(
        `Expected zero 3-tier resolver hits in skills+docs, got ${offenders.length}:\n${noted}`,
      );
    }
    expect(offenders).toEqual([]);
  });

  test("the five surface files carry the canonical '2-tier ticket-binding resolver' replacement", () => {
    // Each of the five surfaces must read "2-tier" verbatim (matching
    // `docs/ticket-binding.md:11` and `specs/technical-spec.md:233`).
    for (const abs of TICKET_BINDING_SURFACE_FILES) {
      if (!existsSync(abs)) continue;
      const text = readFileSync(abs, "utf-8");
      expect(text).toMatch(/2-tier (ticket-binding|resolver)/);
    }
  });
});

// ---------------------------------------------------------------------------
// AC-STE-318.3 — agents/deps-researcher.md drops the phantom probe reference
// ---------------------------------------------------------------------------

describe("agents/deps-researcher.md now references the real probe (M100/STE-373 reversed the STE-318 A14 phantom guard)", () => {
  test("the file references the now-real `deps_research_result_shape` probe (#64)", () => {
    expect(existsSync(depsResearcherAgentMdPath)).toBe(true);
    const text = readFileSync(depsResearcherAgentMdPath, "utf-8");
    expect(text.includes("deps_research_result_shape")).toBe(true);
    // The retired phantom-guard vocabulary must be gone (STE-373 AC-STE-373.3).
    expect(text).not.toMatch(/operator-judgment, not runtime-enforced/);
  });

  test("the architectural twin spec-researcher.md still correctly cites probe #41", () => {
    // Sanity check: the twin asymmetry is intentional only if the
    // counterpart `spec-researcher.md` does carry the canonical probe
    // reference (`spec_research_result_shape` — probe #41). If a future
    // edit accidentally dropped that, the asymmetry rationale collapses.
    const twin = readFileSync(
      join(
        repoRoot,
        "plugins",
        "dev-process-toolkit",
        "agents",
        "spec-researcher.md",
      ),
      "utf-8",
    );
    expect(twin).toMatch(/spec_research_result_shape/);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-318.4 — probe module + PROBE_ID + severity + #58 registration
// ---------------------------------------------------------------------------

describe("AC-STE-318.4 — probe module + PROBE_ID + #58 SKILL.md registration", () => {
  test("probe module exists at the canonical path", () => {
    expect(existsSync(probeModulePath)).toBe(true);
  });

  test("PROBE_ID is the literal string 'cross_skill_contract_drift'", () => {
    expect(PROBE_ID).toBe("cross_skill_contract_drift");
  });

  test("probe is registered as the 58th numbered probe in gate-check SKILL.md", () => {
    const skillMd = readFileSync(gateCheckSkillMdPath, "utf-8");
    // Line shape mirrors sibling #57: `58. **<id>** — …`
    expect(skillMd).toMatch(
      /^58\.\s+\*\*`?cross_skill_contract_drift`?\*\*/m,
    );
  });

  test("probe entry in SKILL.md declares severity: error", () => {
    const skillMd = readFileSync(gateCheckSkillMdPath, "utf-8");
    // The probe entry block (between `^58\.` and `^59\.` / `^## `)
    // must mention `Severity: error`.
    const match = skillMd.match(
      /^58\.\s+\*\*`?cross_skill_contract_drift`?\*\*[\s\S]*?(?=^\d+\.\s|\n## |$)/m,
    );
    expect(match).not.toBeNull();
    expect(match![0]).toMatch(/Severity:\s*error/i);
  });

  test("probe returns zero violations on the real repo (post-STE-373: deps_research_result_shape is canonical, not forbidden)", async () => {
    // Sanity: against the real repo root (post-rewrite), the probe
    // returns zero violations — i.e., the documented active surfaces are
    // clean. Re-introduction is covered by the synthetic FAIL cases.
    const r = await runCrossSkillContractDriftProbe(repoRoot);
    if (r.violations.length > 0) {
      const noted = r.violations.map((v) => v.message).join("\n---\n");
      throw new Error(
        `Expected zero cross-skill contract-drift violations on main, got ${r.violations.length}:\n${noted}`,
      );
    }
    expect(r.violations).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-318.5 — synthetic fixture coverage: PASS + two FAIL cases
// ---------------------------------------------------------------------------

interface Fixture {
  root: string;
  cleanup: () => void;
}

// Build a synthetic project tree the probe walks. The probe scans the
// active-surface glob (`plugins/.../{skills,docs,agents,README.md}`); the
// fixture seeds clean prose into each scope and lets each test override
// one surface with a drift-introducing string.
function makeFixture(overrides: {
  // Optional drift seeds — when present, the named surface file is
  // written with the drift string baked in.
  tddSkillBody?: string;
  implementSkillBody?: string;
  depsResearcherBody?: string;
  readmeBody?: string;
} = {}): Fixture {
  const root = mkdtempSync(join(tmpdir(), "cscd-probe-"));
  const pluginBase = join(root, "plugins", "dev-process-toolkit");
  mkdirSync(pluginBase, { recursive: true });

  // Default clean bodies — every surface uses the canonical post-rewrite
  // vocabulary so a clean fixture passes the probe.
  const cleanTdd = [
    "---",
    "name: tdd",
    "description: Multi-agent TDD orchestrator. Runs RED → GREEN → REFACTOR → AUDIT for one FR via four forked subagents (test-writer / implementer / refactorer / spec-reviewer).",
    "---",
    "",
    "# /tdd",
    "",
    "Four forked subagents (test-writer / implementer / refactorer / spec-reviewer).",
    "",
  ].join("\n");

  const cleanImplement = [
    "---",
    "name: implement",
    "description: implement",
    "---",
    "",
    "# /implement",
    "",
    "Ticket-binding pre-flight — 2-tier resolver + confirmation prompt per docs/ticket-binding.md.",
    "",
  ].join("\n");

  const cleanDepsResearcher = [
    "---",
    "name: deps-researcher",
    "---",
    "",
    "# deps-researcher",
    "",
    "Line cap (hard). ≤ 25 lines. The gate-probe `deps_research_result_shape` (#64) refuses any recorded block over the cap.",
    "",
  ].join("\n");

  const cleanReadme = [
    "# Dev Process Toolkit",
    "",
    "A Claude Code plugin marketplace.",
    "",
    "Four forked subagents drive the /tdd orchestrator.",
    "",
  ].join("\n");

  // Skills
  const tddSkillDir = join(pluginBase, "skills", "tdd");
  mkdirSync(tddSkillDir, { recursive: true });
  writeFileSync(join(tddSkillDir, "SKILL.md"), overrides.tddSkillBody ?? cleanTdd);

  const implementSkillDir = join(pluginBase, "skills", "implement");
  mkdirSync(implementSkillDir, { recursive: true });
  writeFileSync(
    join(implementSkillDir, "SKILL.md"),
    overrides.implementSkillBody ?? cleanImplement,
  );

  // Agents
  const agentsDir = join(pluginBase, "agents");
  mkdirSync(agentsDir, { recursive: true });
  writeFileSync(
    join(agentsDir, "deps-researcher.md"),
    overrides.depsResearcherBody ?? cleanDepsResearcher,
  );

  // README + a stub docs/ so the probe's glob has something to walk.
  writeFileSync(join(pluginBase, "README.md"), overrides.readmeBody ?? cleanReadme);
  const docsDir = join(pluginBase, "docs");
  mkdirSync(docsDir, { recursive: true });
  writeFileSync(
    join(docsDir, "stub.md"),
    "# stub doc\n\nNo drift here.\n",
  );

  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

// Assert a violation message matches the NFR-10 canonical shape:
//   <file>:<line>:<column> — <reason>
//   Refusing: …
//   Remedy: …
//   Context: …
function expectNfr10Shape(message: string): void {
  expect(message).toMatch(/^[^\s:][^:]*:\d+:\d+ — /m);
  expect(message).toMatch(/Refusing:/);
  expect(message).toMatch(/Remedy:/);
  expect(message).toMatch(/Context:/);
}

describe("AC-STE-318.5 — synthetic fixture coverage", () => {
  test("(a) PASS — byte-clean fixture → zero violations", async () => {
    const fx = makeFixture();
    try {
      const r = await runCrossSkillContractDriftProbe(fx.root);
      expect(r.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("(b) FAIL — re-introduced 'three forked subagents' string → NFR-10 violation", async () => {
    const driftedTdd = [
      "---",
      "name: tdd",
      "description: Multi-agent TDD orchestrator. Runs RED → GREEN → REFACTOR for one FR via three forked subagents (test-writer / implementer / refactorer).",
      "---",
      "",
      "# /tdd",
      "",
    ].join("\n");
    const fx = makeFixture({ tddSkillBody: driftedTdd });
    try {
      const r = await runCrossSkillContractDriftProbe(fx.root);
      expect(r.violations.length).toBeGreaterThan(0);
      const hit = r.violations.find((v) =>
        /three forked subagents/.test(v.message),
      );
      expect(hit).toBeDefined();
      expectNfr10Shape(hit!.message);
      // The hit points at the tdd SKILL.md surface.
      expect(hit!.message).toMatch(/skills\/tdd\/SKILL\.md/);
    } finally {
      fx.cleanup();
    }
  });

  test("(c) FAIL — re-introduced '3-tier resolver' string → NFR-10 violation", async () => {
    const driftedImplement = [
      "---",
      "name: implement",
      "description: implement",
      "---",
      "",
      "# /implement",
      "",
      "Ticket-binding pre-flight — 3-tier resolver + confirmation prompt per docs/ticket-binding.md.",
      "",
    ].join("\n");
    const fx = makeFixture({ implementSkillBody: driftedImplement });
    try {
      const r = await runCrossSkillContractDriftProbe(fx.root);
      expect(r.violations.length).toBeGreaterThan(0);
      const hit = r.violations.find((v) => /3-tier resolver/.test(v.message));
      expect(hit).toBeDefined();
      expectNfr10Shape(hit!.message);
      expect(hit!.message).toMatch(/skills\/implement\/SKILL\.md/);
    } finally {
      fx.cleanup();
    }
  });
});
