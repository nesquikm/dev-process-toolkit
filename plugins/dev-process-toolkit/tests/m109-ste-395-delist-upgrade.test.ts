// M109 STE-395 — de-list `/upgrade` from the user-invocable surface.
//
// `/upgrade` keeps working and Claude keeps invoking it; it just stops
// occupying a slot on the slash menu. Probe #69 (`upgrade_staleness`, shipped
// by STE-394) is the discovery path that replaces the menu entry.
//
// AC map:
//   AC-STE-395.1 — `user-invocable: false` lands in skills/upgrade/SKILL.md
//                  frontmatter; NO `context: fork`, NO `agent:`, NO
//                  `disable-model-invocation: true`.
//   AC-STE-395.2 — count tokens re-key 17 → 16 user-invocable / 7 → 8
//                  non-user-invocable (total stays 24) at five surfaces. The
//                  README repo-tree row carries TWO token forms on one line;
//                  both move, because probe #57 reads them positionally and a
//                  half-done edit ships green.
//   AC-STE-395.3 — taxonomy: `Seven additional skills … they run only as
//                  `context: fork` children` is universally quantified and
//                  becomes false. Literal → `Eight additional skills`, prose
//                  split, and docs/skill-anatomy.md gains the missing case (a
//                  `user-invocable: false` skill that is neither a fork child
//                  nor background knowledge).
//   AC-STE-395.4 — silent-disable guard: CLAUDE.md:15 must keep a literal the
//                  probe's `splitMatch` regex can read. Reword off it and
//                  `claudeUserInvocable` goes undefined, the README-vs-CLAUDE
//                  leg is skipped, and the probe reports ZERO violations while
//                  looking green. Failing-first non-vacuity proof below.
//   AC-STE-395.5 — EXACTLY ONE remedy string is re-keyed (skills/setup/SKILL.md's
//                  discovery hint → `/gate-check`). The 9 mid-run recovery
//                  remedies and 3 past-tense provenance strings stay byte-exact:
//                  re-pointing a mid-run recovery at read-only `/gate-check`,
//                  which cannot resume a half-applied migration, would ship a
//                  broken instruction.
//   AC-STE-395.6 — README command-table row + mermaid node + its dangling edge
//                  are deleted; the Setup subgraph still renders.
//   AC-STE-395.7 — `/upgrade` stays in COMMIT_PRODUCING_SKILLS and is NOT added
//                  to probes #39 / #50 / #51 / #54, which all require
//                  `context: fork` + a resolving read-only `agent:`.
//   AC-STE-395.8 — full `bun test` green. Its failing-first coverage lives in
//                  the three pinned test files whose assertions this FR INVERTS
//                  (they currently assert the pre-de-listing state); the pins
//                  below assert the inversions actually landed.
//
// NOTE ON LINE NUMBERS: AC-STE-395.6's deletions shift every README line below
// them. Every assertion here anchors BY CONTENT.

import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AUDIT_FIX_LOOP_CANONICAL_LOOPS } from "../adapters/_shared/src/audit_fix_loop_pattern";
import {
  COMMIT_PRODUCING_SKILLS,
  NON_COMMIT_PRODUCING_SKILLS,
} from "../adapters/_shared/src/commit_producing_skill_branch_gate";
import { DISABLE_MODEL_INVOCATION_ALLOWLIST } from "../adapters/_shared/src/disable_model_invocation_allowlist";
import { runPublicSurfaceCountDriftProbe } from "../adapters/_shared/src/public_surface_count_drift";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const SKILLS_DIR = join(PLUGIN_ROOT, "skills");
const SRC_DIR = join(PLUGIN_ROOT, "adapters", "_shared", "src");

const upgradeSkillPath = join(SKILLS_DIR, "upgrade", "SKILL.md");
const setupSkillPath = join(SKILLS_DIR, "setup", "SKILL.md");
const readmePath = join(REPO_ROOT, "README.md");
const claudeMdPath = join(REPO_ROOT, "CLAUDE.md");
const technicalSpecPath = join(REPO_ROOT, "specs", "technical-spec.md");
const skillAnatomyPath = join(PLUGIN_ROOT, "docs", "skill-anatomy.md");
const probeModulePath = join(SRC_DIR, "public_surface_count_drift.ts");
const monolithSplitPath = join(SRC_DIR, "migrations", "monolith_split.ts");
const upgradeStalenessPath = join(SRC_DIR, "upgrade_staleness.ts");

const read = (path: string): string => readFileSync(path, "utf-8");

/** The single line of `body` matching `anchor` — uniqueness is the point. */
function onlyLine(body: string, anchor: RegExp): string {
  const hits = body.split("\n").filter((line) => anchor.test(line));
  if (hits.length !== 1) {
    throw new Error(
      `expected exactly 1 line matching ${anchor}, found ${hits.length}` +
        (hits.length > 1 ? `:\n${hits.map((h) => `  ${h.slice(0, 90)}`).join("\n")}` : ""),
    );
  }
  return hits[0]!;
}

/** The blank-line-delimited paragraph of `body` that contains `needle`. */
function paragraphWith(body: string, needle: string | RegExp): string {
  const test_ = (p: string): boolean =>
    typeof needle === "string" ? p.includes(needle) : needle.test(p);
  const hits = body.split(/\n\s*\n/).filter(test_);
  if (hits.length === 0) throw new Error(`no paragraph contains ${String(needle)}`);
  return hits[0]!;
}

const frontmatterOf = (body: string): string =>
  /^---\r?\n([\s\S]*?)\r?\n---/.exec(body)?.[1] ?? "";

const occurrences = (haystack: string, needle: string): number =>
  haystack.split(needle).length - 1;

// ---------------------------------------------------------------------------
// AC-STE-395.1 — the frontmatter flip, and the two flags NOT used
// ---------------------------------------------------------------------------

describe("AC-STE-395.1 — skills/upgrade/SKILL.md declares `user-invocable: false`", () => {
  const fm = (): string => frontmatterOf(read(upgradeSkillPath));

  test("the frontmatter carries `user-invocable: false`", () => {
    expect(fm()).toMatch(/^user-invocable:[ \t]*false[ \t]*$/m);
  });

  test("the skill keeps its identity — `name: upgrade` + a description", () => {
    expect(fm()).toMatch(/^name:\s*upgrade\s*$/m);
    expect(fm()).toMatch(/^description:\s*\S/m);
  });

  test("NO `context: fork` — /upgrade is not a dispatch child", () => {
    expect(fm()).not.toMatch(/^context:\s*fork\s*$/m);
  });

  test("NO `agent:` — there is no paired subagent to resolve to", () => {
    expect(fm()).not.toMatch(/^agent:\s*\S/m);
  });

  test("NO `disable-model-invocation: true` — it would break the model path the probe's remedy relies on", () => {
    expect(fm()).not.toMatch(/^disable-model-invocation:\s*true\s*$/m);
    // Probe #59's allowlist is `["setup"]` only; adding /upgrade would trip it.
    expect(DISABLE_MODEL_INVOCATION_ALLOWLIST).toEqual(["setup"]);
  });
});

describe("AC-STE-395.1 — on-disk ground truth: 24 skills, 16 user-invocable", () => {
  const skillDirs = (): string[] =>
    readdirSync(SKILLS_DIR).filter((n) => statSync(join(SKILLS_DIR, n)).isDirectory());

  const declaresNonUserInvocable = (body: string): boolean =>
    /^user-invocable:[ \t]*false[ \t]*$/m.test(frontmatterOf(body));

  test("the on-disk total is unchanged at 24 — nothing was deleted", () => {
    const dirs = skillDirs();
    expect(dirs.length).toBe(24);
    expect(dirs).toContain("upgrade");
  });

  test("exactly 16 skills are user-invocable, and `upgrade` is NOT among them", () => {
    const userInvocable = skillDirs().filter(
      (d) => !declaresNonUserInvocable(read(join(SKILLS_DIR, d, "SKILL.md"))),
    );
    expect(userInvocable.length).toBe(16);
    expect(userInvocable).not.toContain("upgrade");
  });

  test("exactly 8 skills are non-user-invocable, and `upgrade` IS among them", () => {
    const nonUserInvocable = skillDirs().filter((d) =>
      declaresNonUserInvocable(read(join(SKILLS_DIR, d, "SKILL.md"))),
    );
    expect(nonUserInvocable.length).toBe(8);
    expect(nonUserInvocable).toContain("upgrade");
  });

  test("/upgrade is the FIRST non-user-invocable skill that is not a fork child", () => {
    const forkless = skillDirs().filter((d) => {
      const fm = frontmatterOf(read(join(SKILLS_DIR, d, "SKILL.md")));
      return /^user-invocable:[ \t]*false[ \t]*$/m.test(fm) && !/^context:\s*fork\s*$/m.test(fm);
    });
    expect(forkless).toEqual(["upgrade"]);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-395.2 — count tokens re-key 17 → 16 / 7 → 8 at five surfaces
// ---------------------------------------------------------------------------

describe("AC-STE-395.2 — README count tokens", () => {
  const readme = (): string => read(readmePath);

  test("the pitch under the H1 counts 16 commands (agents unchanged at 8)", () => {
    expect(onlyLine(readme(), /^A Claude Code plugin that adds/)).toMatch(
      /16 commands?,\s+8 agents?/,
    );
  });

  test("the lifecycle prose counts 16 user-invoked skills", () => {
    expect(onlyLine(readme(), /^The toolkit groups its/)).toMatch(/\b16 user-invoked skills\b/);
  });

  test("the repo-tree skills/ row re-keys BOTH token forms on the one line", () => {
    // A half-done edit ships green: probe #57 reads these positionally and
    // never looks at the second form. Both are pinned here on purpose.
    const row = onlyLine(readme(), /^│\s+├── skills\//);
    expect(row).toMatch(/24\s*\(16\s*\+\s*8\)/);
    expect(row).toMatch(/\(16 user-invocable \+ 8 internal forks\)/);
  });

  test("no stale 17-user-invocable token survives on any pinned README line", () => {
    const body = readme();
    expect(onlyLine(body, /^A Claude Code plugin that adds/)).not.toMatch(/17 commands?/);
    expect(onlyLine(body, /^The toolkit groups its/)).not.toMatch(/\b17\b/);
    const row = onlyLine(body, /^│\s+├── skills\//);
    expect(row).not.toMatch(/\b17\b/);
    expect(row).not.toMatch(/\+\s*7\b/);
  });
});

describe("AC-STE-395.2 — CLAUDE.md + specs/technical-spec.md count tokens", () => {
  test("CLAUDE.md's skills row counts 24 slash commands (16 user-invocable + 8 dispatch)", () => {
    expect(onlyLine(read(claudeMdPath), /^├── skills\//)).toMatch(
      /24\s+slash commands\s+\(16\s+user-invocable\s+\+\s+8\s+dispatch/,
    );
  });

  test("no stale `17 user-invocable` / `+ 7 dispatch` token survives in CLAUDE.md", () => {
    const row = onlyLine(read(claudeMdPath), /^├── skills\//);
    expect(row).not.toMatch(/17\s+user-invocable/);
    expect(row).not.toMatch(/\+\s*7\s+dispatch/);
  });

  test("specs/technical-spec.md's skills row counts 16 user-invocable SKILL.md files", () => {
    const row = onlyLine(read(technicalSpecPath), /├── skills\/.*user-invocable SKILL\.md/);
    expect(row).toMatch(/16 user-invocable SKILL\.md files/);
    expect(row).not.toMatch(/17 user-invocable/);
  });
});

describe("AC-STE-395.2 — probe #57 holds no count literals, so its source does not change", () => {
  test("public_surface_count_drift.ts hard-codes neither side of the split", () => {
    const src = read(probeModulePath);
    for (const literal of [
      "16 user-invocable",
      "17 user-invocable",
      "7 dispatch",
      "8 dispatch",
    ]) {
      expect(src).not.toContain(literal);
    }
  });

  test("the split is parsed with a generic `(\\d+)` regex at a positional index", () => {
    expect(read(probeModulePath)).toContain(
      String.raw`/\((\d+)\s+user-invocable\s*\+\s*(\d+)\s+dispatch/`,
    );
  });
});

// ---------------------------------------------------------------------------
// AC-STE-395.3 — taxonomy: the universally-quantified fork claim is split
// ---------------------------------------------------------------------------

describe("AC-STE-395.3 — README's `additional skills` paragraph", () => {
  const para = (): string => paragraphWith(read(readmePath), /additional skills \(`spec-research`/);

  test("the count literal is byte-strict `Eight additional skills`", () => {
    expect(onlyLine(read(readmePath), /additional skills \(`spec-research`/)).toMatch(
      /Eight additional skills/,
    );
  });

  test("no `Seven additional skills` literal survives", () => {
    expect(read(readmePath)).not.toContain("Seven additional skills");
  });

  test("the paragraph enumerates all EIGHT members, `upgrade` among them", () => {
    const body = para();
    for (const name of [
      "spec-research",
      "spec-review-audit",
      "tdd-write-test",
      "tdd-implement",
      "tdd-refactor",
      "tdd-spec-review",
      "deps-research",
      "upgrade",
    ]) {
      expect(body).toContain(name);
    }
  });

  test("the `context: fork` claim is no longer universally quantified over the eight", () => {
    // The old sentence — "Eight additional skills (…) are not user-invocable —
    // they run only as `context: fork` children" — is FALSE the moment /upgrade
    // joins the set with no fork pairing.
    expect(para()).not.toMatch(
      /Eight additional skills[^.]*they run only as `context: fork` children/,
    );
  });

  test("the fork claim survives for the seven that really are fork children", () => {
    expect(para()).toContain("context: fork");
  });

  test("`/upgrade` is named as the non-fork member, not silently folded in", () => {
    const sentences = para()
      .split(/(?<=\.)\s+/)
      .filter((s) => /upgrade/.test(s));
    expect(sentences.length).toBeGreaterThanOrEqual(1);
    // Whichever sentence introduces it must mark it as the exception.
    const marked = sentences.filter((s) =>
      /\b(not|no|non-fork|never|neither|unlike|except|without)\b/i.test(s),
    );
    expect(marked.length).toBeGreaterThanOrEqual(1);
  });
});

describe("AC-STE-395.3 — docs/skill-anatomy.md gains the missing taxonomy case", () => {
  const doc = (): string => read(skillAnatomyPath);

  test("the doc mentions upgrade at all — today it contains ZERO occurrences", () => {
    expect(doc()).toContain("upgrade");
  });

  test("the frontmatter comment no longer limits `user-invocable: false` to background knowledge", () => {
    const line = onlyLine(doc(), /^user-invocable: false\s+#/);
    expect(line).not.toMatch(/Use for background knowledge\.$/);
  });

  test("a passage documents the neither-fork-child-nor-background-knowledge case", () => {
    const body = doc();
    const para = paragraphWith(body, /upgrade/);
    expect(para).toMatch(/user-invocable: false/);
    expect(para).toMatch(/\b(not a fork|non-fork|neither|without a `?context: fork|no fork)\b/i);
  });

  test("`/upgrade` is the worked example", () => {
    expect(doc()).toMatch(/\/upgrade\b/);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-395.4 — the silent-disable guard (FAILING-FIRST, non-vacuous)
// ---------------------------------------------------------------------------

interface Fixture {
  root: string;
  cleanup: () => void;
}

/** Synthetic tree mirroring the layout probe #57 walks. */
function makeFixture(opts: {
  skillsCount: number;
  agentsCount: number;
  maxProbeNumber: number;
  readmeContent: string;
  claudeMdContent: string;
}): Fixture {
  const root = mkdtempSync(join(tmpdir(), "ste-395-guard-"));
  const pluginBase = join(root, "plugins", "dev-process-toolkit");
  const skillsDir = join(pluginBase, "skills");
  mkdirSync(skillsDir, { recursive: true });
  for (let i = 1; i <= opts.skillsCount; i++) {
    const d = join(skillsDir, `skill-${i}`);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "SKILL.md"), `---\nname: skill-${i}\ndescription: stub\n---\n`);
  }
  const agentsDir = join(pluginBase, "agents");
  mkdirSync(agentsDir, { recursive: true });
  for (let i = 1; i <= opts.agentsCount; i++) {
    writeFileSync(join(agentsDir, `agent-${i}.md`), `# agent-${i}\n`);
  }
  const gateCheckDir = join(skillsDir, "gate-check");
  mkdirSync(gateCheckDir, { recursive: true });
  const lines = ["# Gate Check", "", "## Probes", ""];
  for (let i = 1; i <= opts.maxProbeNumber; i++) lines.push(`${i}. **probe-${i}** — stub`);
  writeFileSync(join(gateCheckDir, "SKILL.md"), `${lines.join("\n")}\n`);
  writeFileSync(join(root, "README.md"), opts.readmeContent);
  writeFileSync(join(root, "CLAUDE.md"), opts.claudeMdContent);
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const PROBE_MAX = 69;

/** README with an L3 commands token deliberately disagreeing with CLAUDE.md. */
function readmeClaiming(commands: number): string {
  return [
    "# Dev Process Toolkit",
    "",
    `A Claude Code plugin. Includes ${commands} commands, 8 agents, spec templates, and documentation.`,
    "",
    "## Features",
    "",
    `- **Deterministic quality gates** — ${PROBE_MAX} numbered \`/gate-check\` probes`,
    "",
  ].join("\n");
}

describe("AC-STE-395.4 — CLAUDE.md:15 keeps a literal the probe's splitMatch can read", () => {
  const SPLIT_RE = /\((\d+)\s+user-invocable\s*\+\s*(\d+)\s+dispatch/;

  test("line 15 matches the probe's splitMatch regex verbatim", () => {
    const line15 = read(claudeMdPath).split("\n")[14];
    expect(line15).toBeDefined();
    expect(SPLIT_RE.test(line15!)).toBe(true);
  });

  test("the parsed split is (16 user-invocable, 8 dispatch)", () => {
    const m = SPLIT_RE.exec(read(claudeMdPath).split("\n")[14]!);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(16);
    expect(Number(m![2])).toBe(8);
  });

  test("REAL CLAUDE.md bytes + a disagreeing README split ⇒ the guard FIRES", async () => {
    // Non-vacuity proof. Reword CLAUDE.md:15 off `splitMatch` and
    // `claudeUserInvocable` goes `undefined`; the comparison at
    // public_surface_count_drift.ts:323-327 is then skipped and the probe
    // reports ZERO violations while looking perfectly green. This test is the
    // tripwire on that silent disable — and it also pins WHICH number the
    // surviving literal declares, which is why it is RED against today's code
    // (today it names 17).
    const fx = makeFixture({
      skillsCount: 24,
      agentsCount: 8,
      maxProbeNumber: PROBE_MAX,
      readmeContent: readmeClaiming(99),
      claudeMdContent: read(claudeMdPath),
    });
    try {
      const r = await runPublicSurfaceCountDriftProbe(fx.root);
      const hit = r.violations.find(
        (v) => v.file === "README.md" && /commands count/i.test(v.reason),
      );
      expect(hit).toBeDefined();
      expect(hit!.reason).toContain("user-invocable count (16)");
      expect(hit!.message).toContain("Refusing:");
    } finally {
      fx.cleanup();
    }
  });

  test("agreeing README + REAL CLAUDE.md ⇒ no commands-count violation", async () => {
    const fx = makeFixture({
      skillsCount: 24,
      agentsCount: 8,
      maxProbeNumber: PROBE_MAX,
      readmeContent: readmeClaiming(16),
      claudeMdContent: read(claudeMdPath),
    });
    try {
      const r = await runPublicSurfaceCountDriftProbe(fx.root);
      expect(
        r.violations.filter((v) => v.file === "README.md" && /commands count/i.test(v.reason)),
      ).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// AC-STE-395.5 — exactly ONE remedy re-keyed; 9 recovery + 3 provenance frozen
// ---------------------------------------------------------------------------

describe("AC-STE-395.5 — the ONE re-key: /setup's discovery-surface hint", () => {
  test("retired-literal ABSENT tripwire — no `/dev-process-toolkit:upgrade` in skills/setup/SKILL.md", () => {
    // Vacuous-pass when the file is absent: the tripwire guards a file, it does
    // not demand one (AC-STE-380.4 shape — consumer projects are unaffected).
    if (!existsSync(setupSkillPath)) return;
    expect(read(setupSkillPath)).not.toContain("/dev-process-toolkit:upgrade");
  });

  test("the co-pinned `upgrade_available` capability literal is PRESERVED", () => {
    if (!existsSync(setupSkillPath)) return;
    expect(read(setupSkillPath)).toContain("upgrade_available");
  });

  test("the hint now points a legacy tree at /gate-check", () => {
    if (!existsSync(setupSkillPath)) return;
    const para = paragraphWith(read(setupSkillPath), "upgrade_available");
    expect(para).toMatch(/gate-check/);
  });
});

describe("AC-STE-395.5 — the 9 mid-run recovery remedies stay byte-unchanged", () => {
  // Addressed to a flow ALREADY executing /upgrade, where re-running is the
  // correct instruction. Read-only /gate-check cannot resume a half-applied
  // migration, so re-pointing these would ship a broken instruction.

  test("skills/upgrade/SKILL.md keeps exactly its two recovery remedies", () => {
    const body = read(upgradeSkillPath);
    expect(body).toContain(
      "Remedy: commit or stash the offenders below, then re-run `/dev-process-toolkit:upgrade`",
    );
    expect(body).toContain(
      "Remedy: fix the unreadable path (permissions, broken symlink), then re-run `/dev-process-toolkit:upgrade`",
    );
    expect(occurrences(body, "/dev-process-toolkit:upgrade")).toBe(3); // STE-411 added the Step-0 hint occurrence (LEGACY_MONOLITH_HINT).
  });

  test("monolith_split.ts keeps all seven of its recovery remedies", () => {
    const src = read(monolithSplitPath);
    for (const remedy of [
      "fix the project root's permissions, then re-run `/dev-process-toolkit:upgrade`",
      "remove or move the stale backup directories, then re-run `/dev-process-toolkit:upgrade`",
      "re-run `/dev-process-toolkit:upgrade` from the project root",
      "fix the unreadable path (permissions, broken symlink), then re-run `/dev-process-toolkit:upgrade`",
      "free space or fix the destination's permissions, then re-run `/dev-process-toolkit:upgrade`",
      "restore the specs/ tree from the backup this flow took, then re-run `/dev-process-toolkit:upgrade`",
    ]) {
      expect(src).toContain(remedy);
    }
    // The "restore the specs/ tree …" remedy ships twice (two failure paths).
    expect(
      occurrences(
        src,
        "restore the specs/ tree from the backup this flow took, then re-run `/dev-process-toolkit:upgrade`",
      ),
    ).toBe(2);
  });

  test("probe #69's own remedy literal (STE-394) is untouched", () => {
    expect(read(upgradeStalenessPath)).toContain(
      "Remedy: run /dev-process-toolkit:upgrade to apply these migrations (Claude can invoke it; it is not on the slash menu).",
    );
  });
});

describe("AC-STE-395.5 — the 3 past-tense provenance strings stay byte-unchanged", () => {
  test("monolith_split.ts keeps its three provenance stamps", () => {
    const src = read(monolithSplitPath);
    expect(src).toContain(String.raw`\`/dev-process-toolkit:upgrade\`; ACs re-keyed to the`);
    expect(src).toContain(
      String.raw`Carried through the monolithic-specs split by \`/dev-process-toolkit:upgrade\``,
    );
    expect(src).toContain(String.raw`by \`/dev-process-toolkit:upgrade\`. `);
  });

  test("monolith_split.ts carries exactly ten occurrences — 7 recovery + 3 provenance", () => {
    expect(occurrences(read(monolithSplitPath), "/dev-process-toolkit:upgrade")).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-395.6 — the command-table row and the mermaid node are deleted
// ---------------------------------------------------------------------------

describe("AC-STE-395.6 — README command table + mermaid", () => {
  const readme = (): string => read(readmePath);

  const mermaid = (): string => {
    const m = /```mermaid\n([\s\S]*?)```/.exec(readme());
    if (m === null) throw new Error("README carries no mermaid block");
    return m[1]!;
  };

  test("the `/upgrade` command-table row is gone", () => {
    expect(readme()).not.toMatch(/^\|\s*`\/upgrade`/m);
  });

  test("the mermaid `upgrade` node is gone", () => {
    expect(readme()).not.toContain('upgrade["/upgrade"]');
  });

  test("the dangling `setup ~~~ upgrade` edge is gone", () => {
    expect(readme()).not.toContain("setup ~~~ upgrade");
  });

  test("no `upgrade` identifier survives anywhere in the mermaid block", () => {
    expect(mermaid()).not.toMatch(/\bupgrade\b/);
  });

  test("the Setup subgraph still renders — /setup survives with its subgraph fences", () => {
    const block = mermaid();
    const start = block.indexOf("subgraph Setup");
    expect(start).toBeGreaterThanOrEqual(0);
    const body = block.slice(start, block.indexOf("\n    end", start));
    expect(body).toContain('setup(["/setup"]):::spine');
    expect(body).toContain("direction TB");
    expect(block).toContain("Setup --> Plan");
  });

  test("the other command-table rows are untouched — only /upgrade left", () => {
    const rows = readme()
      .split("\n")
      .filter((l) => /^\|\s*`\//.test(l));
    expect(rows.length).toBe(16);
    expect(rows.some((r) => /`\/setup`/.test(r))).toBe(true);
    expect(rows.some((r) => /`\/upgrade`/.test(r))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-395.7 — /upgrade stays commit-producing, joins no fork allowlist
// ---------------------------------------------------------------------------

describe("AC-STE-395.7 — commit-producing registration is unchanged", () => {
  test("`upgrade` is still on the canonical commit-producing list", () => {
    expect(COMMIT_PRODUCING_SKILLS).toContain("upgrade");
  });

  test("`upgrade` is not double-registered as non-commit-producing", () => {
    expect(NON_COMMIT_PRODUCING_SKILLS).not.toContain("upgrade");
  });
});

describe("AC-STE-395.7 — /upgrade is added to NO fork-pairing probe allowlist", () => {
  // Probes #39 / #50 / #51 / #54 all require `context: fork` PLUS an `agent:`
  // resolving to a read-only subagent. /upgrade has neither and is
  // commit-producing — enrolling it would be a guaranteed red.

  test("probe #54's AUDIT_FIX_LOOP_CANONICAL_LOOPS names no upgrade leg", () => {
    const flat = AUDIT_FIX_LOOP_CANONICAL_LOOPS.flatMap((e) => [
      e.orchestrator,
      e.child,
      e.subagent,
    ]);
    expect(flat).not.toContain("upgrade");
    expect(AUDIT_FIX_LOOP_CANONICAL_LOOPS.length).toBe(2);
  });

  test("probes #39 / #50 / #51 / #54 source modules never mention upgrade", () => {
    for (const mod of [
      "tdd_orchestrator_integrity.ts",
      "tdd_spec_reviewer_invariants.ts",
      "deps_researcher_invariants.ts",
      "audit_fix_loop_pattern.ts",
    ]) {
      expect(read(join(SRC_DIR, mod))).not.toMatch(/\bupgrade\b/);
    }
  });
});

// ---------------------------------------------------------------------------
// AC-STE-395.8 — the three pinned test files carry the inverted assertions
// ---------------------------------------------------------------------------

describe("AC-STE-395.8 — pre-de-listing assertions are inverted, not deleted", () => {
  const testSrc = (name: string): string => read(join(PLUGIN_ROOT, "tests", name));

  test("m108-ste-391-upgrade-skill.test.ts now asserts `user-invocable: false` is PRESENT", () => {
    const src = testSrc("m108-ste-391-upgrade-skill.test.ts");
    expect(src).not.toContain("not.toMatch(/user-invocable:\\s*false/)");
    expect(src).toContain("toMatch(/user-invocable:\\s*false/)");
  });

  test("m108-ste-391-upgrade-skill.test.ts still pins `upgrade_available` and COMMIT_PRODUCING_SKILLS", () => {
    const src = testSrc("m108-ste-391-upgrade-skill.test.ts");
    expect(src).toContain("upgrade_available");
    expect(src).toContain('expect(COMMIT_PRODUCING_SKILLS).toContain("upgrade")');
  });

  test("m108-ste-391-docs-pins.test.ts re-keys to the 16 / 24 (16 + 8) forms", () => {
    const src = testSrc("m108-ste-391-docs-pins.test.ts");
    // The two `not.toMatch(/16 user-invo/)`-shaped assertions inverted: 16 is
    // now the required token and 17 the forbidden one.
    expect(src).toContain("toMatch(/16 user-invo/)");
    expect(src).toContain("not.toMatch(/17 user-invo/)");
    expect(src).toContain("/24\\s*\\(16\\s*\\+\\s*8\\)/");
    expect(src).toContain("expect(userInvocable.length).toBe(16)");
    // The predicate rename — the old name asserted fork-dispatch, which
    // `/upgrade` is not. (The retired identifier may still be NAMED in a
    // traceability comment; what must be gone is the call site.)
    expect(src).toContain("declaresNonUserInvocable(");
    expect(src).not.toContain("declaresDispatchOnly(");
  });

  test("gate-check-public-surface-count-drift.test.ts re-keys its four live-tree pins", () => {
    const src = testSrc("gate-check-public-surface-count-drift.test.ts");
    expect(src).toContain("/16 commands?,\\s+8 agents?/");
    expect(src).toContain("/Eight additional skills/");
    expect(src).toContain("/24\\s+\\(16\\s*\\+\\s*8\\)/");
    expect(src).toContain(
      "/24\\s+slash commands\\s+\\(16\\s+user-invocable\\s+\\+\\s+8\\s+dispatch/",
    );
  });

  test("the on-disk-total pins are UNCHANGED — the total never moved off 24 / 23", () => {
    const src = testSrc("gate-check-public-surface-count-drift.test.ts");
    expect(src).toContain("/the other 23 skills/");
    expect(src).toContain("/all 24 skills/");
    // Synthetic-fixture cases keep their own calibration.
    expect(src).toContain("skillsCount: 23");
  });

  test("the live-tree probe run is still green — the end-to-end AC.8 proxy", async () => {
    const r = await runPublicSurfaceCountDriftProbe(REPO_ROOT);
    if (r.violations.length > 0) {
      throw new Error(
        `expected zero public-surface count-drift violations, got ${r.violations.length}:\n` +
          r.violations.map((v) => v.message).join("\n---\n"),
      );
    }
    expect(r.violations).toEqual([]);
  });
});
