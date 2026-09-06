// STE-567 — the front door describes what is actually behind it.
//
// Two rules run through every leg here. First, a number is DERIVED from the
// thing it counts, never restated: the README's own diagram introduction is
// graded against the diagram, and the agents table against the agents
// directory. Second, every new check is measured against UNMODIFIED code
// before it is trusted — five of these ACs add a check where none existed,
// and an assertion that would also pass on the old code proves nothing.

import { describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPublicSurfaceCountDriftProbe } from "../adapters/_shared/src/public_surface_count_drift";
import {
  checkReadmeSurfaceReachability,
  readAgentTableRows,
  readCarveOutProse,
  readDiagramIntroCount,
  readDiagramNodes,
  readShippedAgents,
  readShippedSkills,
} from "../adapters/_shared/src/readme_surface_reachability";
import { mutate } from "./_fence";

const pluginRoot = join(import.meta.dir, "..");
const repoRoot = join(pluginRoot, "..", "..");
const read = (p: string) => readFileSync(p, "utf-8");

const README = read(join(repoRoot, "README.md"));
const CLAUDE_MD = read(join(repoRoot, "CLAUDE.md"));

// ===========================================================================
// AC-STE-567.1 / .2 — the introduction matches the diagram, by derivation
// ===========================================================================

describe("AC-STE-567.1 — the diagram's introduction matches the diagram", () => {
  test("the stated count equals the drawn node count", () => {
    expect(readDiagramIntroCount(README)).toBe(readDiagramNodes(README).length);
  });

  test("the 'full path' completeness framing is gone", () => {
    // That clause is what converted an omission into a misdirection: it told
    // the reader they had seen everything before they scrolled far enough to
    // learn otherwise.
    expect(README).not.toContain("Read left-to-right for the full path");
    expect(README).toMatch(/deliberately not on it/);
  });
});

describe("AC-STE-567.2 — the agreement is derived, not restated", () => {
  test("adding a node without touching the sentence reds", () => {
    const withExtraNode = mutate(
      README,
      /(\n\s+)pr\["\/pr"\]:::secondary/,
      '$1pr["/pr"]:::secondary$1invented["/invented"]:::secondary',
    );
    expect(readDiagramNodes(withExtraNode).length).toBe(
      readDiagramNodes(README).length + 1,
    );
    const v = checkReadmeSurfaceReachability(withExtraNode, pluginRoot);
    expect(v.map((x) => x.rule)).toContain("diagram_intro_count");
  });

  test("editing the sentence without touching the diagram reds", () => {
    const stated = readDiagramIntroCount(README)!;
    const wrongSentence = mutate(
      README,
      new RegExp(`The diagram below maps the ${stated} skills`),
      `The diagram below maps the ${stated + 3} skills`,
    );
    const v = checkReadmeSurfaceReachability(wrongSentence, pluginRoot);
    expect(v).toHaveLength(1);
    expect(v[0]!.rule).toBe("diagram_intro_count");
    expect(v[0]!.reason).toMatch(new RegExp(`states ${stated + 3} skills`));
  });

  test("neither number is written into the checker", () => {
    const src = read(
      join(pluginRoot, "adapters", "_shared", "src", "readme_surface_reachability.ts"),
    );
    // The module may DISCUSS the historical 18-vs-15 in its header comment; it
    // must not compare against a literal in code.
    const code = src.split("\nimport ")[1] ?? src;
    expect(code).not.toMatch(/===\s*15\b/);
    expect(code).not.toMatch(/===\s*18\b/);
  });

  test("an empty parse throws rather than reporting a clean surface", () => {
    expect(() => checkReadmeSurfaceReachability("# no diagram here\n", pluginRoot)).toThrow(
      /refusing to report a clean surface/,
    );
    const noTable = README.replace(/\n### Agents\n/, "\n### Helpers\n");
    expect(() => checkReadmeSurfaceReachability(noTable, pluginRoot)).toThrow(
      /Agents\s*table/,
    );
  });
});

// ===========================================================================
// AC-STE-567.3 / .4 — every user-invocable skill is reachable, per skill
// ===========================================================================

describe("AC-STE-567.3 — reachability is asserted per skill", () => {
  const { userInvocable } = readShippedSkills(pluginRoot);
  const nodes = readDiagramNodes(README);
  const carveOut = readCarveOutProse(README);

  test("the shipped set is non-empty (a vacuous loop proves nothing)", () => {
    expect(userInvocable.length).toBeGreaterThan(10);
  });

  for (const skill of userInvocable) {
    test(`/${skill} is a diagram node or named in the carve-out prose`, () => {
      const reachable =
        nodes.includes(skill) || new RegExp(`/${skill}\\b`).test(carveOut);
      expect(reachable).toBe(true);
    });
  }

  test("the shipped README reports zero reachability violations", () => {
    expect(checkReadmeSurfaceReachability(README, pluginRoot)).toEqual([]);
  });

  test("FALSIFIABILITY — a skill reachable ONLY as a node reds when the node goes", () => {
    // The subject is CHOSEN by measurement, not named: a skill that is also
    // mentioned in the surrounding prose stays reachable when its node is
    // removed (correctly — the prose is the second route), so pinning a
    // hand-picked name would silently stop testing anything the day that name
    // gains a prose mention.
    const nodeOnly = nodes.filter((n) => !new RegExp(`/${n}\\b`).test(carveOut));
    expect(nodeOnly.length).toBeGreaterThan(0);
    const victim = nodeOnly[0]!;
    const noNode = mutate(
      README,
      new RegExp(`\\n\\s+\\w+\\(?\\["/${victim}"\\]\\)?:::\\w+`),
      "",
    );
    expect(readDiagramNodes(noNode)).not.toContain(victim);
    const v = checkReadmeSurfaceReachability(noNode, pluginRoot);
    expect(v.filter((x) => x.subject === `/${victim}`)).toHaveLength(1);
  });

  test("FALSIFIABILITY — a skill named ONLY in the prose stays reachable", () => {
    // This is the carve-out route, and it must work on its own — otherwise the
    // check would demand a diagram node for every skill, which is the framing
    // this FR is removing.
    expect(carveOut).toMatch(/\/best-practices\b/);
    expect(nodes).not.toContain("best-practices");
    expect(
      checkReadmeSurfaceReachability(README, pluginRoot).filter(
        (v) => v.subject === "/best-practices",
      ),
    ).toEqual([]);
  });
});

describe("AC-STE-567.4 — the three table-only skills are all accounted for", () => {
  const carveOut = readCarveOutProse(README);

  for (const skill of ["deliver", "deps", "best-practices"]) {
    test(`/${skill} is named in the prose beneath the diagram`, () => {
      expect(carveOut).toMatch(new RegExp(`/${skill}\\b`));
    });
  }

  test("/best-practices has a Features bullet, mirroring /deps", () => {
    const features = README.split("\n## Features\n")[1]?.split("\n## ")[0] ?? "";
    expect(features).toMatch(/`\/best-practices`/);
    expect(features).toMatch(/`\/deps`/);
  });

  test("the doc the README points at for its omissions now names it", () => {
    // The README says to read workflow-overview.md "for the mechanics it
    // omits". Before this FR that document did not contain the string at all,
    // so the pointer resolved to nothing — which is what made the omission a
    // misdirection rather than a gap.
    const overview = read(join(pluginRoot, "docs", "workflow-overview.md"));
    expect(overview).toContain("/best-practices");
    expect(overview).toContain("specs/best-practices.yaml");
  });
});

// ===========================================================================
// AC-STE-567.5 / .6 — the agents table, graded by derivation
// ===========================================================================

describe("AC-STE-567.5 — the agents table lists every shipped agent", () => {
  test("spec-reviewer has a row", () => {
    expect(readAgentTableRows(README)).toContain("spec-reviewer");
  });

  test("the row describes what the agent actually does", () => {
    const section = README.split("\n### Agents\n")[1]?.split("\n## ")[0] ?? "";
    const row = section.split("\n").find((l) => l.includes("`spec-reviewer`"))!;
    expect(row).toMatch(/spec-review-result/);
    expect(row).toMatch(/spec-review-audit/);
  });
});

describe("AC-STE-567.6 — the row count is derived from the directory", () => {
  test("rows and agent files are the same set", () => {
    expect(readAgentTableRows(README).sort()).toEqual(readShippedAgents(pluginRoot));
  });

  test("FALSIFIABILITY — a missing row names the AGENT, not a count", () => {
    const dropped = mutate(README, /\n\| `spec-reviewer` +\|[^\n]*\|/, "");
    const v = checkReadmeSurfaceReachability(dropped, pluginRoot);
    expect(v).toHaveLength(1);
    expect(v[0]!.rule).toBe("agent_row_missing");
    expect(v[0]!.subject).toBe("spec-reviewer");
  });

  test("FALSIFIABILITY — a row with no file on disk reds the other way", () => {
    const orphan = mutate(
      README,
      /\n\| `code-reviewer` /,
      "\n| `ghost-reviewer`    | invented row, no file on disk |\n| `code-reviewer` ",
    );
    const v = checkReadmeSurfaceReachability(orphan, pluginRoot);
    expect(v.map((x) => x.rule)).toContain("agent_row_orphan");
  });
});

// ===========================================================================
// AC-STE-567.7 / .8 — both halves of the CLAUDE.md split are graded
// ===========================================================================

describe("AC-STE-567.7 — the user-invocable / dispatch split is graded", () => {
  test("the shipped repo reports zero probe violations", async () => {
    const report = await runPublicSurfaceCountDriftProbe(repoRoot);
    expect(report.violations).toEqual([]);
  });

  test("claudeDispatch is read, not merely assigned", () => {
    const src = read(
      join(pluginRoot, "adapters", "_shared", "src", "public_surface_count_drift.ts"),
    );
    // Two reads beyond the assignment: the dispatch comparison and the sum.
    expect(src.split("parsed.claudeDispatch").length - 1).toBeGreaterThanOrEqual(4);
    expect(src).toContain("dispatchSkills");
  });

  test("the observed dispatch count is read off the frontmatter", () => {
    const { dispatch, userInvocable } = readShippedSkills(pluginRoot);
    const m = /\((\d+)\s+user-invocable\s*\+\s*(\d+)\s+dispatch/.exec(CLAUDE_MD)!;
    expect(Number.parseInt(m[2]!, 10)).toBe(dispatch.length);
    expect(Number.parseInt(m[1]!, 10)).toBe(userInvocable.length);
  });
});

describe("AC-STE-567.8 — falsifiability, measured against unmodified code", () => {
  // The probe reads the two documents from the fixture root and the two TREES
  // from `plugins/dev-process-toolkit/` beneath it. The trees are symlinked to
  // the real ones rather than stubbed, because the whole finding is that the
  // documents were never compared to the shipped tree — a stubbed tree would
  // let the mutation pass or fail for a reason that has nothing to do with it.
  const runOn = async (readme: string, claudeMd: string) => {
    const root = mkdtempSync(join(tmpdir(), "ste567-"));
    try {
      mkdirSync(join(root, "plugins"), { recursive: true });
      symlinkSync(pluginRoot, join(root, "plugins", "dev-process-toolkit"), "dir");
      writeFileSync(join(root, "README.md"), readme);
      writeFileSync(join(root, "CLAUDE.md"), claudeMd);
      return (await runPublicSurfaceCountDriftProbe(root)).violations;
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  };

  test("BASELINE — the unmodified pair is clean in the fixture too", async () => {
    expect(await runOn(README, CLAUDE_MD)).toEqual([]);
  });

  test("an arithmetically impossible split reds", async () => {
    // MEASURED before this FR: this exact mutation returned zero violations.
    const broken = mutate(
      CLAUDE_MD,
      /\(\d+ user-invocable \+ \d+ dispatch/,
      "(18 user-invocable + 3 dispatch",
    );
    const v = await runOn(README, broken);
    const reasons = v.map((x) => x.reason).join("\n");
    expect(reasons).toMatch(/does not add up/);
    expect(reasons).toMatch(/dispatch count \(3\)/);
  });

  test("a split that agrees with itself but not with the tree reds", async () => {
    // The second half of the finding: the two documents could agree with each
    // other while neither had ever been compared to the frontmatter.
    const shifted = mutate(
      CLAUDE_MD,
      /(\d+) slash commands \((\d+) user-invocable \+ (\d+) dispatch/,
      "27 slash commands (19 user-invocable + 8 dispatch",
    );
    const v = await runOn(README, shifted);
    expect(v.map((x) => x.reason).join("\n")).toMatch(/documented dispatch count \(8\)/);
  });

  test("the line-index de-anchoring keeps the leg live when rows move", async () => {
    // Both CLAUDE.md tokens were read off hard-coded `lines[14]` / `lines[15]`.
    // This FR added four rows to the structure block above them; under the old
    // parse both tokens would have gone permanently `undefined` and BOTH
    // comparisons would have been skipped with zero violations.
    const pushedDown = CLAUDE_MD.replace(
      "## Structure\n",
      "## Structure\n\n<!-- a row somebody added -->\n<!-- and another -->\n",
    );
    const broken = mutate(
      pushedDown,
      /\(\d+ user-invocable \+ \d+ dispatch/,
      "(18 user-invocable + 3 dispatch",
    );
    expect(await runOn(README, broken)).not.toEqual([]);
  });
});

// ===========================================================================
// AC-STE-567.9 / .10 / .11 — the remaining measured drifts
// ===========================================================================

describe("AC-STE-567.9 — the remaining README drifts are corrected", () => {
  test("the /docs row states the precondition instead of contradicting it", () => {
    const row = README.split("\n").find((l) => l.startsWith("| `/docs`"))!;
    expect(row).toMatch(/user_facing_mode/);
    expect(row).toMatch(/packages_mode/);
  });

  test("/visual-check credits the MCP it actually depends on", () => {
    const bullet = README.split("\n").find((l) => l.includes("Browser-based UI"))!;
    expect(bullet).toMatch(/rubber[- ]duck/i);
    expect(bullet).not.toMatch(/`\/visual-check` via Chrome DevTools MCP/);
    // Cross-checked against the skill's own stated hard dependency.
    const vc = read(join(pluginRoot, "skills", "visual-check", "SKILL.md"));
    expect(vc).toMatch(/rubber[- ]duck/i);
  });

  test("the Examples bullets name what those directories hold", () => {
    const { readdirSync } = require("node:fs") as typeof import("node:fs");
    for (const stack of ["python", "kotlin"]) {
      const held = readdirSync(join(pluginRoot, "examples", stack));
      const bullet = README.split("\n").find(
        (l) => l.includes(`examples/${stack}/`) && l.startsWith("- **"),
      )!;
      expect(bullet, stack).toBeDefined();
      // The claim that was false: a CLAUDE.md template in either directory.
      expect(held).not.toContain("CLAUDE.md");
      expect(bullet, stack).not.toMatch(/CLAUDE\.md template under/);
      for (const f of held.filter((h) => h.endsWith(".md") || h.endsWith(".yml"))) {
        expect(bullet, `${stack}/${f}`).toContain(f);
      }
    }
  });

  test("the pattern count agrees with patterns.md", () => {
    const patterns = read(join(pluginRoot, "docs", "patterns.md"));
    const observed = (patterns.match(/^## Pattern \d+/gm) ?? []).length;
    expect(observed).toBeGreaterThan(0);
    expect(README).toContain(`— ${observed} proven patterns + anti-patterns`);
  });

  test("the What's Inside tree lists the directories that ship", () => {
    const tree = README.split("\n## What's Inside\n")[1]?.split("\n## ")[0] ?? "";
    for (const dir of ["hooks/", "scripts/", "tests/", "adapters/"]) {
      expect(tree, dir).toContain(dir);
    }
    for (const root of [".claude/", "specs/", "CHANGELOG.md"]) {
      expect(tree, root).toContain(root);
    }
  });
});

describe("AC-STE-567.10 / .11 — the CLAUDE.md structure block", () => {
  const structure = CLAUDE_MD.split("\n## Structure\n")[1]?.split("\n## ")[0] ?? "";

  test("every real plugin subdirectory appears", () => {
    const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
    const dirs = readdirSync(pluginRoot).filter((e) => {
      if (e.startsWith(".")) return false;
      try {
        return statSync(join(pluginRoot, e)).isDirectory();
      } catch {
        return false;
      }
    });
    expect(dirs.length).toBeGreaterThan(6);
    for (const d of dirs) expect(structure, d).toContain(`${d}/`);
  });

  test("the gate root is identified as the gate root", () => {
    expect(structure).toMatch(/tests\/[^\n]*gate root/i);
  });

  test("the templates line names what /setup actually reads", () => {
    // `/setup` reads templates/permissions.json; the line named settings.json,
    // which is not the file it opens.
    expect(structure).toContain("permissions.json");
    const { existsSync } = require("node:fs") as typeof import("node:fs");
    expect(existsSync(join(pluginRoot, "templates", "permissions.json"))).toBe(true);
  });

  test("both skill roots are accounted for", () => {
    const { readdirSync, existsSync } = require("node:fs") as typeof import("node:fs");
    const rootSkills = existsSync(join(repoRoot, ".claude", "skills"))
      ? readdirSync(join(repoRoot, ".claude", "skills")).length
      : 0;
    const plugin = readShippedSkills(pluginRoot);
    const total = plugin.userInvocable.length + plugin.dispatch.length + rootSkills;
    expect(structure).toContain(".claude/skills/");
    expect(structure).toContain(`${total} skills`);
  });

  test("the declared verify_skill lives in the root that is now named", () => {
    const verify = /^verify_skill:\s*(\S+)\s*$/m.exec(CLAUDE_MD)?.[1];
    expect(verify).toBeDefined();
    const { existsSync } = require("node:fs") as typeof import("node:fs");
    expect(existsSync(join(repoRoot, ".claude", "skills", verify!, "SKILL.md"))).toBe(
      true,
    );
    expect(structure).toMatch(/verify_skill/);
  });

  test("the examples line enumerates every shipped example", () => {
    const { readdirSync } = require("node:fs") as typeof import("node:fs");
    const line = structure.split("\n").find((l) => l.includes("examples/"))!;
    for (const e of readdirSync(join(pluginRoot, "examples"))) {
      expect(line, e).toContain(e.replace(/\.md$/, ""));
    }
  });

  test("the single-source-of-truth claim is qualified for CI-owned changelogs", () => {
    const block = CLAUDE_MD.split("\n## Release Checklist\n")[1]?.split("\n## ")[0] ?? "";
    expect(block).toContain("changelog_ci_owned");
    expect(block).toMatch(/necessary[\s\S]{0,80}sufficient/);
  });
});
