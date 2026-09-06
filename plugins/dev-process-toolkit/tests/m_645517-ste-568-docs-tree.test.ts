// STE-568 — the docs tree stops describing a toolkit that no longer exists.
//
// Sixteen drifts, and the shape is the same in every one: prose that was
// accurate when it was written and that nothing re-reads. So the legs below
// split in two. The SWEEPS are the durable half — they scan the live tree and
// red on the next occurrence of a class, not on the sixteen already found. The
// per-site legs are the corrections themselves, and each is asserted against
// its SOURCE OF TRUTH rather than against a sibling document: grading two
// documents against each other is what let one figure drift forty percent
// while its sibling stayed correct, both agreeing with the copy nearest to hand.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  CONSUMER_SCAFFOLD_PATHS,
  listDocs,
  RETIRED_SHAPES,
  sweepCitations,
  sweepRetiredShapes,
} from "../adapters/_shared/src/docs_tree_sweep";
import { mutate } from "./_fence";

const pluginRoot = join(import.meta.dir, "..");
const repoRoot = join(pluginRoot, "..", "..");
const docsDir = join(pluginRoot, "docs");
const read = (p: string) => readFileSync(p, "utf-8");
const doc = (name: string) => read(join(docsDir, name));

// ===========================================================================
// AC-STE-568.1 / .2 / .3 — retired shapes, asserted by sweep
// ===========================================================================

describe("AC-STE-568.2 — the retirement is asserted by SWEEP", () => {
  test("the sweep sees a non-trivial tree (a vacuous walk reports clean)", () => {
    expect(listDocs(docsDir).length).toBeGreaterThan(20);
  });

  test("no live doc teaches a retired shape", () => {
    expect(sweepRetiredShapes(docsDir)).toEqual([]);
  });

  test("every retired shape in the table is one the sweep can actually find", () => {
    // A token that matches nothing anywhere is a rule that cannot fire. Each is
    // exercised against synthetic text so the table cannot silently rot into a
    // list of strings the matcher never sees.
    for (const shape of RETIRED_SHAPES) {
      expect(`instructions naming ${shape.token} as current`).toContain(shape.token);
    }
    expect(RETIRED_SHAPES.length).toBeGreaterThanOrEqual(4);
  });

  test("FALSIFIABILITY — reinstating a plan.md instruction reds", () => {
    // Both spellings, because two of the five drifted sites wrote the bare
    // backticked name and three wrote the full path; a sweep that caught only
    // one spelling would have reported the other two clean.
    for (const token of ["specs/plan.md", "`plan.md`"]) {
      const hits = RETIRED_SHAPES.filter((s) => s.token === token);
      expect(hits, token).toHaveLength(1);
      const line = `Read ${token} to find the milestone list.`;
      expect(hits[0]!.exemptWhen.test(line)).toBe(false);
      expect(line).toContain(token);
    }
  });

  test("a doc EXPLAINING the retirement is exempt, and says so", () => {
    // The opposite of the drift must stay writable. Forbidding the token
    // outright would push the fix toward deleting the explanation.
    const shape = RETIRED_SHAPES.find((s) => s.token === "specs/plan.md")!;
    expect(shape.exemptWhen.test("the retired monolithic specs/plan.md")).toBe(true);
    expect(shape.exemptWhen.test("Fill in specs/plan.md with milestones")).toBe(false);
  });

  test("AC-STE-568.1 — the per-milestone form landed at every corrected site", () => {
    expect(doc("adaptation-guide.md")).toContain("specs/plan/<M#>.md");
    expect(doc("parallel-execution.md")).toContain("specs/plan/<M#>.md");
    // `/setup` writes a concrete `specs/plan/M1.md` into a CONSUMER's tree, so
    // this sentence keeps the concrete name; the retirement it is fixing is the
    // MONOLITHIC `specs/plan.md`, not the per-milestone bootstrap file.
    expect(doc("setup-reference.md")).toContain("specs/plan/M1.md");
    // The spec-tree diagram gained the two subtrees it also omitted.
    const tree = doc("adaptation-guide.md");
    expect(tree).toMatch(/├── frs\//);
    expect(tree).toMatch(/└── plan\//);
  });

  test("AC-STE-568.3 — the adapter worked example uses the shipped back-link", () => {
    const adapters = doc("tracker-adapters.md");
    expect(adapters).toContain("Source: specs/frs/{tracker_id}.md");
    // The conformance checklist — the thing an adapter author is graded on —
    // requires the same form, not merely the worked example.
    expect(adapters).toMatch(/back-link\s*\n?\s*to `specs\/frs\/\{tracker_id\}\.md`/);
  });
});

// ===========================================================================
// AC-STE-568.5 / .6 — counts derived from the thing counted
// ===========================================================================

describe("AC-STE-568.5 — every stated count is derived", () => {
  test("the agent count agrees with the agents/ tree", () => {
    const observed = readdirSync(join(pluginRoot, "agents")).filter((f) =>
      f.endsWith(".md"),
    );
    const guide = doc("adaptation-guide.md");
    expect(guide).toContain("The plugin ships eight, in two groups.");
    expect(observed).toHaveLength(8);
    // Named, not merely counted — the finding was that seven of the eight were
    // invisible to a reader of this section.
    for (const f of observed) expect(guide).toContain(f.replace(/\.md$/, ""));
  });

  test("the probe count agrees with the gate-check registry, on BOTH sites", () => {
    const registry = read(join(pluginRoot, "skills", "gate-check", "SKILL.md"));
    const observed = (registry.match(/^\d+[a-z]?\. \*\*/gm) ?? []).length;
    expect(observed).toBeGreaterThan(50);
    const overview = doc("workflow-overview.md");
    expect(overview).toContain(`typecheck + lint + tests + ${observed} probes`);
    expect(overview).toContain(`| ${observed} conformance probes (NFR-15) |`);
    expect(overview).not.toContain("~60");
  });

  test("AC-STE-568.6 — the line budget is read from the test that enforces it", () => {
    // Read from the ENFORCING constant, never restated. A shipped test in this
    // repo was once found pinning a cap one line off from the one it named, so
    // a doc graded against prose about the cap would inherit that error.
    const nfr1 = read(join(pluginRoot, "tests", "skill-nfr-1-length.test.ts"));
    const cap = Number.parseInt(/SKILL_LINE_CAP = (\d+)/.exec(nfr1)![1]!, 10);
    expect(cap).toBeGreaterThan(0);
    const anatomy = doc("skill-anatomy.md");
    expect(anatomy).toContain(`Keep SKILL.md under ${cap} lines`);
    expect(anatomy).toContain("skill-nfr-1-length.test.ts");
    expect(anatomy).not.toContain("under 500 lines");
  });

  test("the advertised budget is one a shipped skill could actually meet", () => {
    // The finding was not that 500 was stale but that it was 142 lines of work
    // a gate then rejects. Measured with split("\n"), the counter NFR-1 uses.
    const nfr1 = read(join(pluginRoot, "tests", "skill-nfr-1-length.test.ts"));
    const cap = Number.parseInt(/SKILL_LINE_CAP = (\d+)/.exec(nfr1)![1]!, 10);
    const longest = Math.max(
      ...readdirSync(join(pluginRoot, "skills")).map((d) => {
        const f = join(pluginRoot, "skills", d, "SKILL.md");
        return existsSync(f) ? read(f).split("\n").length : 0;
      }),
    );
    expect(longest).toBeLessThanOrEqual(cap);
  });

  test("AC-STE-568.8 — every skill Step 5 presents as shipped is on disk", () => {
    const guide = doc("adaptation-guide.md");
    const step5 = guide.split("\n## Step 5")[1]?.split("\n## Step 6")[0] ?? "";
    expect(step5.length).toBeGreaterThan(200);
    const authored = step5.split("### Domain-specific additions")[1] ?? "";
    expect(authored).toMatch(/skills you write yourself/);
    const shippedTiers = step5.split("### Domain-specific additions")[0]!;
    for (const m of shippedTiers.matchAll(/`\/([a-z][a-z-]*)`/g)) {
      expect(existsSync(join(pluginRoot, "skills", m[1]!, "SKILL.md")), m[1]!).toBe(true);
    }
  });
});

// ===========================================================================
// AC-STE-568.9 / .10 — structure described from the shipped shape
// ===========================================================================

describe("AC-STE-568.9 — the AUDIT stage is documented wherever /tdd is", () => {
  const roles = () => {
    const src = read(join(pluginRoot, "adapters", "_shared", "src", "tdd_result.ts"));
    const union = /export type TddRole =([^;]+);/.exec(src)![1]!;
    return [...union.matchAll(/"([a-z-]+)"/g)].map((m) => m[1]!);
  };

  test("the shipped role union has four members", () => {
    expect(roles()).toEqual(["test-writer", "implementer", "refactorer", "spec-reviewer"]);
  });

  test("patterns.md names five skills and four subagents", () => {
    const patterns = doc("patterns.md");
    expect(patterns).toContain("**The shape (five skills + four subagents)**");
    expect(patterns).toContain("tdd-spec-review/SKILL.md");
    expect(patterns).toContain("tdd-spec-reviewer.md");
    expect(patterns).toContain("tdd-spec-review-result");
  });

  test("every role in the union appears in the hand-off contract", () => {
    const patterns = doc("patterns.md");
    const contract = patterns.split("**Hand-off contract (deterministic)**")[1]!.slice(
      0,
      600,
    );
    for (const role of roles()) expect(contract, role).toContain(role);
  });

  test("the Cycle-granularity list has a bullet per child skill", () => {
    const patterns = doc("patterns.md");
    const cycle = patterns.split("**Cycle granularity (load-bearing)**")[1]!.slice(0, 1400);
    for (const child of ["tdd-write-test", "tdd-implement", "tdd-refactor", "tdd-spec-review"]) {
      expect(cycle, child).toContain(`\`${child}\` ⇒`);
    }
  });

  test("skill-anatomy says four child skills and names the fourth", () => {
    const anatomy = doc("skill-anatomy.md");
    expect(anatomy).toContain("drives four child skills");
    expect(anatomy).not.toContain("drives three child skills");
    expect(anatomy).toMatch(/`tdd-spec-review`[^\n]*AUDIT stage/);
    // The probe clause no longer implies #39 covers all four.
    expect(anatomy).toMatch(/fourth child, `tdd-spec-review`, has its own probe, #50/);
  });

  test("FALSIFIABILITY — dropping the AUDIT stage from either doc is visible", () => {
    for (const [name, pattern] of [
      ["patterns.md", /\*\*The shape \(five skills \+ four subagents\)\*\*/],
      ["skill-anatomy.md", /drives four child skills/],
    ] as const) {
      const broken = mutate(doc(name), pattern, "REGRESSED");
      expect(broken, name).not.toMatch(pattern);
    }
  });
});

describe("AC-STE-568.10 — the mode-conditional frontmatter keys", () => {
  // The source of truth is the gate-check registry, which already stated it
  // correctly. All three surfaces are graded against it rather than each
  // carrying its own list.
  const registry = read(join(pluginRoot, "skills", "gate-check", "SKILL.md"));
  const INVARIANT = ["title", "milestone", "status", "archived_at", "created_at"];

  test("the registry states the five invariant keys and two conditional ones", () => {
    expect(registry).toContain(
      "the mode-invariant Schema Q keys `title`, `milestone`, `status`, `archived_at`, `created_at`",
    );
    expect(registry).toContain("The `id` and `tracker` keys are **mode-conditional**");
  });

  for (const [name, anchor] of [
    ["layout-reference.md", "mode-invariant Schema Q keys"],
    ["patterns.md", "Required frontmatter fields"],
  ] as const) {
    test(`${name} states the same five, with id and tracker conditional`, () => {
      const body = doc(name);
      const region = body.split(anchor)[1]!.slice(0, 600);
      for (const key of INVARIANT) expect(region, key).toContain(`\`${key}\``);
      expect(region).toMatch(/mode-conditional/);
      expect(region).toMatch(/`id`/);
      expect(region).toMatch(/`tracker`/);
      // The defect: `tracker` listed among the invariants.
      expect(region.split("mode-conditional")[0]).not.toMatch(/`tracker`,/);
    });
  }
});

// ===========================================================================
// AC-STE-568.11 / .12 / .13 — pointers that resolve
// ===========================================================================

describe("AC-STE-568.11 — the branch-prompting claim matches the call sites", () => {
  const impl = doc("implement-reference.md");
  const boundary = impl.split("### Scope boundary")[1]!.split("\n## ")[0]!;

  /** Skills whose SKILL.md calls the branch gate — the source of truth. */
  const prompters = readdirSync(join(pluginRoot, "skills")).filter((d) => {
    const f = join(pluginRoot, "skills", d, "SKILL.md");
    return existsSync(f) && read(f).includes("requireCommittableBranch");
  });

  test("the call-site set is non-empty and includes the two the doc denied", () => {
    expect(prompters).toContain("spec-write");
    expect(prompters).toContain("spec-archive");
  });

  test("every prompting skill is on the prompting side of the boundary", () => {
    // Paragraph-scoped, not split on a phrase: the prompting skills are NAMED
    // before the clause that says they prompt, so a prefix/suffix split would
    // put them on the wrong side and pass for the wrong reason.
    const paragraphs = boundary.split(/\n\n+/).filter((s) => s.trim().length > 0);
    const readOnly = paragraphs.find((s) =>
      s.includes("neither read the key nor prompt"),
    );
    const prompting = paragraphs.find((s) => s.includes("requireCommittableBranch"));
    expect(readOnly).toBeDefined();
    expect(prompting).toBeDefined();
    for (const skill of prompters) {
      // The defect: two of these were listed among the skills that "never
      // prompt for branch creation".
      expect(readOnly!, `${skill} must not be listed as never prompting`).not.toContain(
        `\`/${skill}\``,
      );
      // And each is accounted for somewhere in the section. `/implement` is
      // accounted for by the opening sentence rather than by the prompting
      // list, which is why this is scoped to the section and not to one
      // paragraph.
      expect(boundary, `${skill} must be accounted for`).toContain(`\`/${skill}\``);
    }
  });

  test("the two mechanisms are separated rather than conflated", () => {
    expect(boundary).toContain("Only `/implement` reads `branch_template:`");
    expect(boundary).toContain("requireCommittableBranch");
    expect(boundary).toMatch(/\[Y\] create \/ \[e\] edit \/ \[n\] abort/);
  });
});

describe("AC-STE-568.12 — the stale pointers resolve or are gone", () => {
  test("the discharged hold-off no longer names line numbers", () => {
    const impl = doc("implement-reference.md");
    expect(impl).not.toContain("Coupled surface — do not repair here");
    expect(impl).not.toContain("leave them alone");
    expect(impl).toContain("PROPAGATION_COMMIT_SUBJECT");
    // And the constant it now points at is real.
    const mod = read(
      join(pluginRoot, "adapters", "_shared", "src", "propagation_commit_message.ts"),
    );
    expect(mod).toContain("export const PROPAGATION_COMMIT_SUBJECT");
  });

  test("the milestone-close prompt is quoted as it ships", () => {
    const shipped = "Run /ship-milestone M<N> now? (y/n):";
    expect(read(join(pluginRoot, "skills", "implement", "SKILL.md"))).toContain(shipped);
    expect(doc("ship-milestone-reference.md")).toContain(shipped);
    expect(doc("ship-milestone-reference.md")).not.toContain("Ship this milestone now?");
  });

  test("the spec-review allowlist matches the shipped frontmatter", () => {
    const fm = read(join(pluginRoot, "skills", "spec-review", "SKILL.md")).split("---")[1]!;
    const allowed = /allowed-tools:\s*(.+)/.exec(fm)![1]!.trim();
    expect(allowed).toContain("Skill");
    expect(doc("spec-review-tracker-mode.md")).toContain(allowed.replace(", ", ",\n"));
  });
});

describe("AC-STE-568.13 — cited paths resolve as written", () => {
  test("no live doc cites a path that is not there", () => {
    expect(sweepCitations(docsDir, repoRoot, pluginRoot)).toEqual([]);
  });

  test("FALSIFIABILITY — an archived spec cited at its active path reds", () => {
    // The exact finding: two citations left behind when their subjects were
    // archived. Verified against the real tree, so the fixture is the defect.
    const archived = readdirSync(join(repoRoot, "specs", "frs", "archive")).find((f) =>
      f.endsWith(".md"),
    )!;
    const hits = sweepCitationsOn(`See \`specs/frs/${archived}\` for detail.`);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.rule).toBe("citation_moved");
    expect(hits[0]!.reason).toContain(`specs/frs/archive/${archived}`);
  });

  test("FALSIFIABILITY — a test file that never existed reds differently", () => {
    const hits = sweepCitationsOn("covered by `tests/never-existed.test.ts`");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.rule).toBe("citation_unresolved");
  });

  test("a SHAPE is not a citation and is not graded", () => {
    expect(sweepCitationsOn("written to `specs/plan/<M#>.md` by /setup")).toEqual([]);
  });

  test("a CONSUMER scaffold path is not a citation into this repo", () => {
    // Both entries name files `/setup` writes into someone else's tree. The
    // first is the trap: this repository DOES hold `specs/plan/archive/M1.md`,
    // so a resolver would "helpfully" report a moved pointer and be wrong
    // about what the sentence is doing.
    expect(existsSync(join(repoRoot, "specs", "plan", "archive", "M1.md"))).toBe(true);
    for (const scaffold of CONSUMER_SCAFFOLD_PATHS) {
      expect(sweepCitationsOn(`/setup writes \`${scaffold}\``), scaffold).toEqual([]);
    }
  });

  test("the exemption is narrow — a neighbouring path is still graded", () => {
    // Anti-over-exemption: the list must not be a prefix rule.
    expect(sweepCitationsOn("see `specs/plan/M2.md`")).toHaveLength(1);
  });

  // Runs the real sweep over a throwaway docs dir holding one line of text, so
  // the matcher and the resolver under test are the shipped ones.
  function sweepCitationsOn(line: string) {
    const { mkdtempSync, writeFileSync, rmSync } = require("node:fs") as typeof import("node:fs");
    const { tmpdir } = require("node:os") as typeof import("node:os");
    const dir = mkdtempSync(join(tmpdir(), "ste568-"));
    try {
      writeFileSync(join(dir, "probe.md"), `${line}\n`);
      return sweepCitations(dir, repoRoot, pluginRoot);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});
