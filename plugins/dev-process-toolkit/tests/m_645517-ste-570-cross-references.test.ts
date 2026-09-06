// STE-570 — skills describe each other correctly.
//
// A skill describing its OWN behaviour is graded by its own tests. A skill
// describing a SIBLING's is graded by nothing, and six such statements were
// wrong at once. So every leg here reads BOTH files: the claim from the citing
// one, the truth from the cited one. A check that only reds when the citing
// file is wrong would pass if someone "fixed" a drift by changing the cited
// file's behaviour instead — which, for the fork-capability finding, would
// mean granting `Bash` to a deliberately read-only agent.
//
// Five of these ACs add a check where none existed. Each mutation is therefore
// measured against UNMODIFIED code first: an assertion that would also pass on
// the code that motivated it proves nothing.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  CANONICAL_CAPABILITY_KEYS,
  KEY_OWNER_SKILL,
} from "../adapters/_shared/src/closing_summary_capability_keys";
import {
  checkForkCapabilityClaims,
  checkRemedyTypeability,
  extractAgentTools,
  FORK_CAPABILITY_CLAIMS,
  NOT_ON_MENU_CAVEAT,
} from "../adapters/_shared/src/skill_cross_reference";
import {
  LEGACY_MONOLITH_HINT,
  UPGRADE_STALENESS_REMEDY,
} from "../adapters/_shared/src/upgrade_staleness";
import { mutate } from "./_fence";

const pluginRoot = join(import.meta.dir, "..");
const read = (p: string) => readFileSync(p, "utf-8");
const skill = (n: string) => read(join(pluginRoot, "skills", n, "SKILL.md"));
const agent = (n: string) => read(join(pluginRoot, "agents", `${n}.md`));

/** Skill name → whether its frontmatter leaves it user-invocable. */
const userInvocable = new Map<string, boolean>(
  readdirSync(join(pluginRoot, "skills"))
    .filter((d) => existsSync(join(pluginRoot, "skills", d, "SKILL.md")))
    .map((d) => {
      const fm = skill(d).split(/^---\s*$/m)[1] ?? "";
      return [d, !/^user-invocable:\s*false\s*$/m.test(fm)] as const;
    }),
);

// ===========================================================================
// AC-STE-570.1 / .2 — the read-only fork does not run anything
// ===========================================================================

describe("AC-STE-570.2 — fork capability, graded from both sides", () => {
  const pairs: Array<[string, string, string]> = [
    ["skills/tdd/SKILL.md", "tdd", "tdd-spec-reviewer"],
    ["skills/spec-review/SKILL.md", "spec-review", "spec-reviewer"],
  ];

  test("the audit forks really are read-only (the cited side)", () => {
    for (const [, , agentName] of pairs) {
      const tools = extractAgentTools(agent(agentName));
      expect(tools, agentName).toEqual(["Read", "Grep", "Glob"]);
      expect(tools, agentName).not.toContain("Bash");
    }
  });

  test("an unreadable toolset THROWS rather than reporting agreement", () => {
    // Both defects sat two lines above the child's own contradiction. A
    // checker that passes on a toolset it could not read reproduces exactly
    // that: an answer with nothing behind it.
    expect(() =>
      checkForkCapabilityClaims({
        orchestratorBody: "so it can confirm GREEN before classifying",
        orchestratorFile: "x.md",
        agentBody: "---\nname: x\n---\n",
        agentName: "x",
      }),
    ).toThrow(/declares no `tools:` line/);
  });

  for (const [label, skillName, agentName] of pairs) {
    test(`${label} claims nothing its fork cannot do`, () => {
      expect(
        checkForkCapabilityClaims({
          orchestratorBody: skill(skillName),
          orchestratorFile: label,
          agentBody: agent(agentName),
          agentName,
        }),
      ).toEqual([]);
    });

    test(`FALSIFIABILITY — ${label}: reinstating the claim reds`, () => {
      const regressed = mutate(
        skill(skillName),
        /as reference context ONLY/,
        "so it can confirm GREEN",
      );
      const v = checkForkCapabilityClaims({
        orchestratorBody: regressed,
        orchestratorFile: label,
        agentBody: agent(agentName),
        agentName,
      });
      expect(v.length).toBeGreaterThan(0);
      expect(v[0]!.rule).toBe("fork_capability");
      expect(v[0]!.reason).toMatch(/no `Bash`/);
    });

    test(`FALSIFIABILITY — ${label}: granting Bash would silence it too`, () => {
      // The other direction. If the fix were to grant the capability instead
      // of dropping the claim, the check must stop firing — that is what makes
      // this a contract about agreement and not a ban on a phrase.
      const regressed = mutate(
        skill(skillName),
        /as reference context ONLY/,
        "so it can confirm GREEN",
      );
      const widened = mutate(agent(agentName), /^tools: .*$/m, "tools: Read, Grep, Glob, Bash");
      expect(
        checkForkCapabilityClaims({
          orchestratorBody: regressed,
          orchestratorFile: label,
          agentBody: widened,
          agentName,
        }),
      ).toEqual([]);
    });
  }

  test("the claim table is non-empty and keyed on a TOOL, not on phrasing", () => {
    expect(FORK_CAPABILITY_CLAIMS.length).toBeGreaterThan(0);
    for (const c of FORK_CAPABILITY_CLAIMS) expect(c.requires).toBe("Bash");
  });

  test("AC-STE-570.1 — the orchestrator is named as the party that verified", () => {
    expect(skill("tdd")).toMatch(/orchestrator has already verified GREEN/);
    expect(skill("spec-review")).toMatch(/read-only and cannot run it/);
  });
});

// ===========================================================================
// AC-STE-570.3 / .4 — registration claims graded against the registry
// ===========================================================================

describe("AC-STE-570.4 — a registration claim is graded, owner included", () => {
  test("the registry holds only the deps_research_* keys, owned by spec-write", () => {
    // Both halves of the finding: the `deps_*` tokens were ABSENT, and the
    // five that are present belong to a different skill. Only an owner-aware
    // check sees the second half.
    const depsKeys = CANONICAL_CAPABILITY_KEYS.filter((k) => k.startsWith("deps_"));
    expect(depsKeys.length).toBeGreaterThan(0);
    for (const k of depsKeys) {
      expect(k, k).toMatch(/^deps_research_/);
      expect(KEY_OWNER_SKILL[k], k).toBe("spec-write");
    }
  });

  test("/deps no longer claims a registration it does not have", () => {
    const deps = skill("deps");
    expect(deps).not.toMatch(/registered in[\s\S]{0,120}CANONICAL_CAPABILITY_KEYS/);
    expect(deps).toMatch(/NOT in `CANONICAL_CAPABILITY_KEYS`/);
  });

  test("AC-STE-570.3 — and no longer claims the probe greps its tokens", () => {
    const deps = skill("deps");
    // Four sites made the claim; none may survive.
    expect(deps).not.toMatch(/`closing_summary_capability_keys` probe greps/);
    // Paired with a positive: the discipline itself must still be stated, or
    // the absence check would be satisfied by deleting the contract.
    expect(deps.match(/narrative paraphrase is (?:still )?insufficient/gi)?.length).toBeGreaterThanOrEqual(3);
  });

  test("every token /deps claims IS registered actually is", () => {
    // The general rule, applied to every skill: a claim of registration is
    // graded against the registry rather than trusted.
    for (const name of readdirSync(join(pluginRoot, "skills"))) {
      const f = join(pluginRoot, "skills", name, "SKILL.md");
      if (!existsSync(f)) continue;
      const body = read(f);
      for (const m of body.matchAll(
        /`([a-z][a-z0-9_]*)`[^\n]{0,80}registered in[^\n]{0,80}CANONICAL_CAPABILITY_KEYS/g,
      )) {
        expect(CANONICAL_CAPABILITY_KEYS, `${name}: ${m[1]}`).toContain(m[1]!);
      }
    }
  });
});

// ===========================================================================
// AC-STE-570.5 / .6 — flags attributed to a sibling
// ===========================================================================

describe("AC-STE-570.6 — an attributed flag is graded against the sibling", () => {
  /**
   * Flags a skill actually accepts.
   *
   * The surface is SKILL.md PLUS its `docs/<skill>-reference.md`, because NFR-1
   * caps a skill at 358 lines and the overflow home is where the rest of the
   * contract legitimately lives. Measured: `/setup --resume-tracker-binding` is
   * a real flag documented only in the reference doc, and a SKILL.md-only
   * derivation calls a true statement in `/spec-write` a phantom.
   */
  const declaredFlags = (name: string): Set<string> => {
    const bodies = [skill(name)];
    const ref = join(pluginRoot, "docs", `${name}-reference.md`);
    if (existsSync(ref)) bodies.push(read(ref));
    const out = new Set<string>();
    for (const body of bodies) {
      const fm = body.split(/^---\s*$/m)[1] ?? "";
      for (const m of fm.matchAll(/--[a-z][a-z0-9-]*/g)) out.add(m[0]);
      for (const m of body.matchAll(/`?\/setup\s+(--[a-z][a-z0-9-]*)/g)) out.add(m[1]!);
      for (const m of body.matchAll(/`(--[a-z][a-z0-9-]*)`/g)) out.add(m[1]!);
    }
    return out;
  };

  test("/setup declares no --docs flag (the cited side)", () => {
    expect(declaredFlags("setup").has("--docs")).toBe(false);
    // The derivation is not simply empty: it finds the flags that ARE real,
    // including one documented only in the reference doc.
    expect(declaredFlags("setup").has("--resume-tracker-binding")).toBe(true);
    // Control: it DOES declare the flags it has, so the reader is not simply
    // finding nothing.
    expect(declaredFlags("setup").has("--template")).toBe(true);
    expect(declaredFlags("setup").has("--migrate")).toBe(true);
  });

  test("AC-STE-570.5 — /docs names a precondition, not a phantom flag", () => {
    const desc = /^description:\s*(.+)$/m.exec(skill("docs").split(/^---\s*$/m)[1]!)![1]!;
    expect(desc).not.toContain("/setup --docs");
    expect(desc).toContain("user_facing_mode");
    expect(desc).toContain("packages_mode");
  });

  test("no skill attributes a flag to /setup that /setup does not have", () => {
    const setupFlags = declaredFlags("setup");
    for (const name of readdirSync(join(pluginRoot, "skills"))) {
      const f = join(pluginRoot, "skills", name, "SKILL.md");
      if (!existsSync(f) || name === "setup") continue;
      for (const m of read(f).matchAll(/\/setup\s+(--[a-z][a-z0-9-]*)/g)) {
        expect(setupFlags, `${name} attributes ${m[1]} to /setup`).toContain(m[1]!);
      }
    }
  });

  test("FALSIFIABILITY — the phantom flag is caught by that derivation", () => {
    const setupFlags = declaredFlags("setup");
    const regressed = "requires `/setup --docs` first";
    const attributed = [...regressed.matchAll(/\/setup\s+(--[a-z][a-z0-9-]*)/g)].map(
      (m) => m[1]!,
    );
    expect(attributed).toEqual(["--docs"]);
    expect(setupFlags.has("--docs")).toBe(false);
  });
});

// ===========================================================================
// AC-STE-570.7 / .8 — a remedy names a command its reader can run
// ===========================================================================

describe("AC-STE-570.8 — remedy typeability, graded against frontmatter", () => {
  const literals: Array<[string, string]> = [
    ["UPGRADE_STALENESS_REMEDY", UPGRADE_STALENESS_REMEDY],
    ["LEGACY_MONOLITH_HINT", LEGACY_MONOLITH_HINT],
  ];

  test("/upgrade really is off the slash menu (the cited side)", () => {
    expect(userInvocable.get("upgrade")).toBe(false);
  });

  for (const [name, literal] of literals) {
    test(`${name} is typeable, or says why it is not`, () => {
      expect(
        checkRemedyTypeability({
          literal,
          file: "adapters/_shared/src/upgrade_staleness.ts",
          line: 1,
          userInvocable,
        }),
      ).toEqual([]);
    });
  }

  test("AC-STE-570.7 — the two siblings agree on the caveat", () => {
    for (const [name, literal] of literals) {
      expect(literal, name).toContain(NOT_ON_MENU_CAVEAT);
    }
  });

  test("the byte-pinned reproductions moved with the literal", () => {
    // The literal is pinned in the skill body and in its own test; a change to
    // one that leaves the others behind is the drift this FR is closing.
    expect(skill("upgrade")).toContain(LEGACY_MONOLITH_HINT);
    expect(read(join(pluginRoot, "tests", "gate-check-upgrade-staleness.test.ts"))).toContain(
      NOT_ON_MENU_CAVEAT,
    );
  });

  test("FALSIFIABILITY — dropping the caveat reds", () => {
    const stripped = mutate(
      LEGACY_MONOLITH_HINT,
      / \(Claude can invoke it; it is not on the slash menu\)/,
      "",
    );
    const v = checkRemedyTypeability({
      literal: stripped,
      file: "x.ts",
      line: 1,
      userInvocable,
    });
    expect(v).toHaveLength(1);
    expect(v[0]!.rule).toBe("remedy_untypeable");
    expect(v[0]!.invocation).toBe("/dev-process-toolkit:upgrade");
  });

  test("a remedy naming a USER-INVOCABLE skill needs no caveat", () => {
    // Anti-over-fire: `/setup` is on the menu, so naming it is fine bare.
    expect(userInvocable.get("setup")).toBe(true);
    expect(
      checkRemedyTypeability({
        literal: "Remedy: run /dev-process-toolkit:setup to bootstrap.",
        file: "x.ts",
        line: 1,
        userInvocable,
      }),
    ).toEqual([]);
  });

  test("an unknown skill is SKIPPED, never guessed", () => {
    expect(
      checkRemedyTypeability({
        literal: "run /dev-process-toolkit:not-a-skill",
        file: "x.ts",
        line: 1,
        userInvocable,
      }),
    ).toEqual([]);
  });
});

// ===========================================================================
// AC-STE-570.9 / .10 — citations graded against the cited STRUCTURE
// ===========================================================================

describe("AC-STE-570.9 — /tdd names the phase that invokes it", () => {
  /** The `## Phase N: …` headings of /implement, in order. */
  const phases = (): Array<{ n: number; title: string; body: string }> => {
    const body = skill("implement");
    const parts = body.split(/^## (?=Phase \d)/m).slice(1);
    return parts.map((p) => {
      const head = p.split("\n")[0]!;
      return { n: Number(/Phase (\d)/.exec(head)![1]!), title: head, body: p };
    });
  };

  test("the phase that dispatches /tdd is found by reading /implement", () => {
    const dispatching = phases().filter((p) => /\/(?:dev-process-toolkit:)?tdd\b/.test(p.body));
    expect(dispatching.length).toBeGreaterThan(0);
    const cited = /`\/implement` Phase (\d) invokes this orchestrator/.exec(skill("tdd"));
    expect(cited).not.toBeNull();
    expect(dispatching.map((p) => p.n)).toContain(Number(cited![1]!));
  });

  test("the phase it dispatches from is the Build phase, not the review one", () => {
    const cited = Number(
      /`\/implement` Phase (\d) invokes this orchestrator/.exec(skill("tdd"))![1]!,
    );
    const phase = phases().find((p) => p.n === cited)!;
    expect(phase.title).toMatch(/Build/i);
  });

  test("FALSIFIABILITY — a renumbered phase reds the citing skill", () => {
    const wrong = mutate(
      skill("tdd"),
      /`\/implement` Phase \d invokes this orchestrator/,
      "`/implement` Phase 9 invokes this orchestrator",
    );
    const cited = Number(
      /`\/implement` Phase (\d) invokes this orchestrator/.exec(wrong)![1]!,
    );
    expect(phases().map((p) => p.n)).not.toContain(cited);
  });
});

describe("AC-STE-570.10 — the spec-research citation resolves", () => {
  test("spec-research cites a step /spec-write actually labels", () => {
    const cited = /`\/dev-process-toolkit:spec-write` § 0b \(step ([\d.]+)\)/.exec(
      skill("spec-research"),
    );
    expect(cited).not.toBeNull();
    expect(skill("spec-write")).toContain(`step ${cited![1]!}.`);
  });

  test("it mirrors the deps-research label beside it", () => {
    const specWrite = skill("spec-write");
    expect(specWrite).toMatch(/Spec-research seed[^\n]*— step 2\.5\./);
    // The sibling citation was already correct, and is what the shape follows.
    expect(skill("deps-research")).toContain("step 2.5b");
    expect(specWrite).toContain("2.5b");
  });

  test("AC-STE-570.11 — every skill this FR touched is within the NFR-1 cap", () => {
    const cap = Number.parseInt(
      /SKILL_LINE_CAP = (\d+)/.exec(
        read(join(pluginRoot, "tests", "skill-nfr-1-length.test.ts")),
      )![1]!,
      10,
    );
    // Read from the ENFORCING constant, not restated: a shipped test in this
    // repo was once found pinning a number one off from the cap it named.
    for (const name of ["spec-write", "tdd", "spec-review", "deps", "docs", "upgrade"]) {
      const lines = skill(name).split("\n").length;
      expect(lines, `${name}/SKILL.md`).toBeLessThanOrEqual(cap);
    }
  });
});
