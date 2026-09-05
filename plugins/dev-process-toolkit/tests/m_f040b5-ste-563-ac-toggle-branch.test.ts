// STE-563 — the AC toggle survives a milestone-keyed branch.
//
// The measured defect: on a Linear project using the DEFAULT branch template,
// `push_ac_toggle` is unreachable non-interactively, because `{N}` renders
// `M_<6-hex>` under tracker-first minting and no `STE-<N>` reaches the branch.
// A green gate, a Done ticket, four checkboxes that never toggled.
//
// The template and the resolver disagree BY CONSTRUCTION, so this file asserts
// their agreement FROM BOTH SIDES: every milestone-id PRODUCER renders a branch
// the resolver accepts (AC.6), and every branch the resolver accepts is one the
// renderer can produce (AC.7). Either leg alone is satisfiable by a resolver
// bound to the wrong subject.

import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  MILESTONE_BRANCH_TEMPLATE,
  buildBranchProposal,
  canonicalBranchTemplate,
} from "../adapters/_shared/src/branch_proposal";
import {
  milestoneBranchInput,
  milestoneBranchSegment,
  milestoneBranchSegmentFor,
  milestoneMatchesBranch,
  readFrCandidate,
  resolveTicketForBranch,
} from "../adapters/_shared/src/branch_ticket_resolution";
import {
  milestoneIdFromEpicKey,
  milestoneIdFromLinearMilestone,
  milestoneIdFromUlid,
} from "../adapters/_shared/src/milestone_token";

const pluginRoot = join(import.meta.dir, "..");
const repoRoot = join(pluginRoot, "..", "..");
const MODULE = join(pluginRoot, "adapters", "_shared", "src", "branch_ticket_resolution.ts");

/** A throwaway project tree with the FRs this leg needs. */
function withProject(
  frs: readonly { name: string; body: string; archived?: boolean }[],
  run: (root: string) => void,
): void {
  const root = mkdtempSync(join(tmpdir(), "ste563-"));
  try {
    mkdirSync(join(root, "specs", "frs", "archive"), { recursive: true });
    for (const fr of frs) {
      const dir = fr.archived
        ? join(root, "specs", "frs", "archive")
        : join(root, "specs", "frs");
      writeFileSync(join(dir, fr.name), fr.body);
    }
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function frBody(opts: { milestone: string; ticket?: string | null; title?: string }): string {
  const tracker = opts.ticket === null ? "" : `tracker:\n  linear: ${opts.ticket ?? "STE-1"}\n`;
  return (
    `---\n` +
    `title: ${opts.title ?? "fixture"}\n` +
    `milestone: ${opts.milestone}\n` +
    `status: active\n` +
    `archived_at: null\n` +
    tracker +
    `created_at: 2026-09-05T00:00:00.000Z\n` +
    `---\n\n# fixture\n`
  );
}

// ===========================================================================
// AC.1 — the milestone segment, word-bounded on both sides.
// ===========================================================================

describe("AC-STE-563.1 — milestoneBranchSegment", () => {
  test("reads the segment a milestone-keyed branch carries", () => {
    expect(milestoneBranchSegment("feat/m19-some-slug")).toBe("m19");
    expect(milestoneBranchSegment("fix/m_f040b5-what-conformance-found")).toBe("m_f040b5");
    expect(milestoneBranchSegment("chore/m_proj_500-a-slug")).toBe("m_proj_500");
  });

  test("is null on a branch carrying no milestone segment", () => {
    expect(milestoneBranchSegment("feat/ste-559-greet-helper")).toBeNull();
    expect(milestoneBranchSegment("main")).toBeNull();
    // A leading `m` word that is not the segment shape.
    expect(milestoneBranchSegment("feat/my-feature")).toBeNull();
  });

  test("does not find m19 inside m191, nor m_proj_500 inside m_proj_5001", () => {
    // The hazard `matchesMilestone` handles with `\b`: here the whole segment
    // is delimited, so the longer branch yields the LONGER segment and never
    // the shorter one.
    expect(milestoneBranchSegment("feat/m191-slug")).toBe("m191");
    expect(milestoneBranchSegment("feat/m191-slug")).not.toBe("m19");
    expect(milestoneBranchSegment("feat/m_proj_5001-slug")).toBe("m_proj_5001");
    expect(milestoneMatchesBranch("M19", "feat/m191-slug")).toBe(false);
    expect(milestoneMatchesBranch("M_proj_500", "feat/m_proj_5001-slug")).toBe(false);
  });

  test("is pure — the same input twice yields the same answer, no I/O", () => {
    expect(milestoneBranchSegment("feat/m19-x")).toBe(milestoneBranchSegment("feat/m19-x"));
  });
});

// ===========================================================================
// AC.2 — the comparison happens in the RENDERING domain.
// ===========================================================================

describe("AC-STE-563.2 — rendering-domain comparison", () => {
  // `epicBranchKey` lowercases and rewrites `-` as `_`, so all three of these
  // render the SAME segment and the branch cannot say which it came from.
  const COLLIDING = ["M_PROJ-500", "M_PROJ_500", "M_proj_500"] as const;

  test("case-and-separator variants all render one segment", () => {
    const rendered = COLLIDING.map((id) => milestoneBranchSegmentFor(id));
    expect(rendered).toEqual(["m_proj_500", "m_proj_500", "m_proj_500"]);
  });

  test("every variant matches the branch built from any of them", () => {
    const branch = buildBranchProposal({
      template: MILESTONE_BRANCH_TEMPLATE,
      type: "feat",
      slug: "a-slug",
      milestone: "M_PROJ-500",
    });
    for (const id of COLLIDING) {
      expect(milestoneMatchesBranch(id, branch)).toBe(true);
    }
  });

  test("MUTANT: a reconstructing comparison gets two of the three wrong", () => {
    // The mutation this AC exists to forbid: recover a milestone id FROM the
    // branch and compare ids. Reconstruction has to pick one spelling, so it
    // is right for that one and wrong for the rest.
    const reconstructing = (id: string, branch: string): boolean => {
      const seg = milestoneBranchSegment(branch);
      if (seg === null) return false;
      return `M${seg.slice(1)}` === id; // `m_proj_500` → `M_proj_500`
    };
    const branch = "feat/m_proj_500-a-slug";
    const mutantVerdicts = COLLIDING.map((id) => reconstructing(id, branch));
    const realVerdicts = COLLIDING.map((id) => milestoneMatchesBranch(id, branch));

    expect(realVerdicts).toEqual([true, true, true]);
    expect(mutantVerdicts).toEqual([false, false, true]);
    // The mutation applied: the two implementations genuinely disagree.
    expect(mutantVerdicts).not.toEqual(realVerdicts);
  });

  test("the {N} input asymmetry is honoured, not papered over", () => {
    // Numeric arrives BARE; epic arrives as the FULL token. Passing `M19`
    // through the renderer's own input would produce `mM19`.
    expect(milestoneBranchInput("M19")).toBe("19");
    expect(milestoneBranchInput("M_f040b5")).toBe("M_f040b5");
    expect(milestoneBranchInput("not-a-token")).toBeNull();
    expect(milestoneBranchSegmentFor("M19")).toBe("m19");
  });
});

// ===========================================================================
// AC.3 / AC.4 — the resolution tiers, and the refusal to choose.
// ===========================================================================

describe("AC-STE-563.3 — resolveTicketForBranch tiers", () => {
  test("Tier 1 still wins first on a ticket-keyed branch", () => {
    withProject([{ name: "STE-559.md", body: frBody({ milestone: "M_b11423", ticket: "STE-559" }) }], (root) => {
      const r = resolveTicketForBranch(root, "feat/ste-559-greet-helper");
      expect(r.tier).toBe("branch-id");
      expect(r.tier === "branch-id" && r.ticketId).toBe("STE-559");
    });
  });

  test("Tier 1b resolves a milestone-keyed branch from the one bound FR", () => {
    withProject([{ name: "STE-559.md", body: frBody({ milestone: "M_b11423", ticket: "STE-559" }) }], (root) => {
      const r = resolveTicketForBranch(root, "feat/m_b11423-greet-helper");
      expect(r.tier).toBe("milestone-fr");
      if (r.tier !== "milestone-fr") throw new Error("unreachable");
      expect(r.ticketId).toBe("STE-559");
      expect(r.milestone).toBe("M_b11423");
      expect(r.frPath).toContain("STE-559.md");
    });
  });

  test("archived FRs are searched, after the live ones", () => {
    withProject(
      [{ name: "STE-559.md", body: frBody({ milestone: "M_b11423", ticket: "STE-559" }), archived: true }],
      (root) => {
        const r = resolveTicketForBranch(root, "feat/m_b11423-greet-helper");
        expect(r.tier).toBe("milestone-fr");
      },
    );
  });

  test("no milestone segment and no ticket id ⇒ interactive, with a reason", () => {
    withProject([], (root) => {
      const r = resolveTicketForBranch(root, "feat/some-freeform-branch");
      expect(r.tier).toBe("interactive");
      expect(r.tier === "interactive" && r.reason).toContain("neither a ticket id nor a milestone segment");
    });
  });

  test("a milestone nothing binds ⇒ interactive, naming the segment", () => {
    withProject([{ name: "STE-1.md", body: frBody({ milestone: "M_other", ticket: "STE-1" }) }], (root) => {
      const r = resolveTicketForBranch(root, "feat/m_b11423-greet-helper");
      expect(r.tier).toBe("interactive");
      expect(r.tier === "interactive" && r.reason).toContain("m_b11423");
    });
  });

  test("an FR bound to the milestone but carrying no tracker id is not a candidate", () => {
    withProject([{ name: "fr.md", body: frBody({ milestone: "M_b11423", ticket: null }) }], (root) => {
      const r = resolveTicketForBranch(root, "feat/m_b11423-greet-helper");
      expect(r.tier).toBe("interactive");
    });
  });

  test("a protected trunk never resolves", () => {
    withProject([{ name: "STE-559.md", body: frBody({ milestone: "M_b11423", ticket: "STE-559" }) }], (root) => {
      expect(resolveTicketForBranch(root, "main").tier).toBe("interactive");
      expect(resolveTicketForBranch(root, "master").tier).toBe("interactive");
    });
  });

  test("a CRLF + BOM FR is read rather than silently skipped", () => {
    const body = "﻿" + frBody({ milestone: "M_b11423", ticket: "STE-559" }).replace(/\n/g, "\r\n");
    withProject([{ name: "STE-559.md", body }], (root) => {
      const r = resolveTicketForBranch(root, "feat/m_b11423-greet-helper");
      expect(r.tier).toBe("milestone-fr");
      expect(r.tier === "milestone-fr" && r.ticketId).toBe("STE-559");
    });
  });
});

describe("AC-STE-563.4 — more than one candidate NEVER resolves", () => {
  const THREE = [
    { name: "STE-563.md", body: frBody({ milestone: "M_f040b5", ticket: "STE-563" }) },
    { name: "STE-564.md", body: frBody({ milestone: "M_f040b5", ticket: "STE-564" }) },
    { name: "STE-565.md", body: frBody({ milestone: "M_f040b5", ticket: "STE-565" }) },
  ];

  test("three FRs on one milestone ⇒ interactive naming all three", () => {
    withProject(THREE, (root) => {
      const r = resolveTicketForBranch(root, "fix/m_f040b5-what-conformance-found");
      expect(r.tier).toBe("interactive");
      if (r.tier !== "interactive") throw new Error("unreachable");
      for (const id of ["STE-563", "STE-564", "STE-565"]) expect(r.reason).toContain(id);
      expect(r.reason).toContain("refusing to choose");
    });
  });

  test("MUTANT: returning the first candidate would resolve — and must not", () => {
    withProject(THREE, (root) => {
      // The mutation: `matches.length >= 1` instead of `=== 1`. Reproduced
      // here so the refusal is asserted against the thing it forbids rather
      // than against nothing.
      const firstWins = (root2: string, branch: string): string | null => {
        const seg = milestoneBranchSegment(branch);
        if (seg === null) return null;
        for (const name of ["STE-563.md", "STE-564.md", "STE-565.md"]) {
          const fr = readFrCandidate(root2, join(root2, "specs", "frs", name));
          if (fr && fr.ticketId && milestoneBranchSegmentFor(fr.milestone) === seg) return fr.ticketId;
        }
        return null;
      };
      expect(firstWins(root, "fix/m_f040b5-what-conformance-found")).toBe("STE-563");
      expect(resolveTicketForBranch(root, "fix/m_f040b5-what-conformance-found").tier).toBe(
        "interactive",
      );
    });
  });
});

// ===========================================================================
// AC.5 — the tier is documented where the withheld toggle lives.
// ===========================================================================

describe("AC-STE-563.5 — documentation", () => {
  const binding = join(pluginRoot, "docs", "ticket-binding.md");
  const trackerMode = join(pluginRoot, "docs", "gate-check-tracker-mode.md");

  test("docs/ticket-binding.md documents Tier 1b between the two existing tiers", () => {
    const body = readFileSync(binding, "utf-8");
    expect(body).toContain("Tier 1b");
    expect(body).toContain("branch_ticket_resolution.ts");
    // Ordering: the new tier sits after the branch regex and before the prompt.
    const t1 = body.indexOf("### Tier 1 — Branch-name regex");
    const t1b = body.indexOf("### Tier 1b");
    const t2 = body.indexOf("### Tier 2 — Interactive prompt");
    expect(t1).toBeGreaterThan(-1);
    expect(t1b).toBeGreaterThan(t1);
    expect(t2).toBeGreaterThan(t1b);
  });

  test("the doc states the four properties the tier is only safe because of", () => {
    const body = readFileSync(binding, "utf-8");
    const span = body.slice(body.indexOf("### Tier 1b"), body.indexOf("### Tier 2 —"));
    expect(span).toContain("exactly one"); // refuses on ambiguity
    expect(span).toContain("confirmation"); // resolution is not consent
    expect(span.toLowerCase()).toContain("deterministic");
    expect(span).toContain("specs/frs/"); // reads local files only
  });

  test("docs/gate-check-tracker-mode.md names the tier in its pre-flight", () => {
    const body = readFileSync(trackerMode, "utf-8");
    expect(body).toContain("Tier 1b");
  });
});

// ===========================================================================
// AC.6 — TEMPLATE ⇒ RESOLVER, driven from the producers.
// ===========================================================================

/**
 * Every producer of a milestone id in the union grammar, each yielding an id
 * from its OWN input shape. Driven from the producers rather than from example
 * branches: a new producer that renders unresolvably reds this leg.
 */
const PRODUCERS: readonly { name: string; id: string }[] = [
  { name: "milestoneIdFromEpicKey", id: milestoneIdFromEpicKey("PROJ-500") },
  { name: "milestoneIdFromUlid", id: milestoneIdFromUlid("fr_01JQ0K0K0K0K0K0K0K0K0K0K0K") },
  {
    name: "milestoneIdFromLinearMilestone",
    id: milestoneIdFromLinearMilestone("f040b589-4f08-473e-a7bb-6858f16955fb"),
  },
  { name: "sequential M<N>", id: "M143" },
];

describe("AC-STE-563.6 — every producer renders a branch the resolver accepts", () => {
  test("the producer roster is non-empty and covers all three minters", () => {
    // A roster that silently emptied would make every leg below vacuous.
    expect(PRODUCERS.length).toBe(4);
    expect(PRODUCERS.map((p) => p.name)).toContain("milestoneIdFromLinearMilestone");
  });

  for (const producer of PRODUCERS) {
    test(`${producer.name} (${producer.id}) round-trips through the default template`, () => {
      const input = milestoneBranchInput(producer.id);
      expect(input).not.toBeNull();
      const template = canonicalBranchTemplate({ milestone: input! });
      expect(template).toBe(MILESTONE_BRANCH_TEMPLATE);

      const branch = buildBranchProposal({
        template,
        type: "fix",
        slug: "a-representative-slug",
        milestone: input!,
      });
      expect(milestoneBranchSegment(branch)).not.toBeNull();
      expect(milestoneMatchesBranch(producer.id, branch)).toBe(true);
    });

    test(`${producer.name} resolves its FR's ticket off that branch`, () => {
      const input = milestoneBranchInput(producer.id)!;
      const branch = buildBranchProposal({
        template: MILESTONE_BRANCH_TEMPLATE,
        type: "fix",
        slug: "a-representative-slug",
        milestone: input,
      });
      withProject(
        [{ name: "STE-900.md", body: frBody({ milestone: producer.id, ticket: "STE-900" }) }],
        (root) => {
          const r = resolveTicketForBranch(root, branch);
          expect(r.tier).toBe("milestone-fr");
          expect(r.tier === "milestone-fr" && r.ticketId).toBe("STE-900");
        },
      );
    });
  }

  test("MUTANT: dropping a producer's arm reds this leg", () => {
    // The mutation is on the SEGMENT reader: restricting it to bare digits is
    // the pre-STE-376 shape, and it leaves the three opaque-key producers
    // unresolvable while the sequential one still passes.
    const digitsOnly = (branch: string): string | null => {
      const m = /(?:^|\/)(m\d+)(?=-|$)/.exec(branch.toLowerCase());
      return m === null ? null : m[1]!;
    };
    const verdicts = PRODUCERS.map((p) => {
      const branch = buildBranchProposal({
        template: MILESTONE_BRANCH_TEMPLATE,
        type: "fix",
        slug: "s",
        milestone: milestoneBranchInput(p.id)!,
      });
      return { real: milestoneBranchSegment(branch) !== null, mutant: digitsOnly(branch) !== null };
    });
    expect(verdicts.every((v) => v.real)).toBe(true);
    expect(verdicts.filter((v) => !v.mutant).length).toBe(3);
  });
});

// ===========================================================================
// AC.7 — RESOLVER ⇒ TEMPLATE, the other direction.
// ===========================================================================

describe("AC-STE-563.7 — every accepted branch is one the template can render", () => {
  /**
   * Segments spanning the accepted grammar. Each must be reproducible by
   * `buildBranchProposal`: a resolver accepting shapes the renderer never
   * emits would pass AC.6 while binding tickets on branches nobody produces.
   */
  const ACCEPTED = ["m19", "m143", "m_f040b5", "m_proj_500", "m_0k0k0k", "m_a"] as const;

  for (const segment of ACCEPTED) {
    test(`the renderer reproduces "${segment}"`, () => {
      const branch = `feat/${segment}-a-slug`;
      expect(milestoneBranchSegment(branch)).toBe(segment);

      // The canonical id whose rendering IS this segment.
      const id = segment.startsWith("m_") ? `M_${segment.slice(2)}` : `M${segment.slice(1)}`;
      const rendered = buildBranchProposal({
        template: MILESTONE_BRANCH_TEMPLATE,
        type: "feat",
        slug: "a-slug",
        milestone: milestoneBranchInput(id)!,
      });
      expect(rendered).toBe(branch);
      expect(milestoneMatchesBranch(id, rendered)).toBe(true);
    });
  }

  test("shapes the renderer cannot emit are NOT accepted", () => {
    // `epicBranchKey` emits `[a-z0-9_]` with an alphanumeric head, so none of
    // these can come out of the renderer and none may go in.
    for (const branch of [
      "feat/m_-slug", // empty key
      "feat/m__x-slug", // underscore head
      "feat/m_PROJ-slug", // uppercase key: the renderer lowercases
      "feat/m-slug", // no token at all
    ]) {
      expect(milestoneBranchSegment(branch)).not.toBe(branch.split("/")[1]!.split("-")[0]);
    }
  });

  test("MUTANT: widening the grammar admits a branch the renderer cannot produce", () => {
    const widened = (branch: string): string | null => {
      const m = /(?:^|\/)(m\w*)(?=-|$)/.exec(branch.toLowerCase());
      return m === null ? null : m[1]!;
    };
    // The widened reader accepts an underscore-headed key; the shipped one
    // does not, and the renderer cannot produce one.
    expect(widened("feat/m__x-slug")).toBe("m__x");
    expect(milestoneBranchSegment("feat/m__x-slug")).toBeNull();
  });
});

// ===========================================================================
// AC.8 — the measured case, end to end.
// ===========================================================================

describe("AC-STE-563.8 — the 2026-09-05 case is closed", () => {
  test("feat/m_b11423-greet-helper resolves STE-559 with no prompt", () => {
    withProject(
      [
        {
          name: "STE-559.md",
          body: frBody({ milestone: "M_b11423", ticket: "STE-559", title: "greet helper" }),
        },
      ],
      (root) => {
        const r = resolveTicketForBranch(root, "feat/m_b11423-greet-helper");
        expect(r.tier).toBe("milestone-fr");
        expect(r.tier === "milestone-fr" && r.ticketId).toBe("STE-559");
      },
    );
  });

  test("the ticket-keyed branch is unchanged — asserted, not assumed", () => {
    withProject(
      [{ name: "STE-559.md", body: frBody({ milestone: "M_b11423", ticket: "STE-559" }) }],
      (root) => {
        const r = resolveTicketForBranch(root, "feat/ste-559-greet-helper");
        expect(r.tier).toBe("branch-id");
        expect(r.tier === "branch-id" && r.ticketId).toBe("STE-559");
      },
    );
  });

  test("BEFORE the fix, the milestone-keyed branch resolved nothing", () => {
    // Tier 1 alone, which is what shipped: the defect reproduced as a test.
    const tier1Only = (branch: string): string | null => {
      const m = /[A-Z]+-\d+/.exec(branch.toUpperCase());
      return m === null ? null : m[0];
    };
    expect(tier1Only("feat/ste-559-greet-helper")).toBe("STE-559");
    expect(tier1Only("feat/m_b11423-greet-helper")).toBeNull();
  });
});

// ===========================================================================
// AC.9 — the front door is EXECUTED, not grepped for.
// ===========================================================================

describe("AC-STE-563.9 — import.meta.main front door", () => {
  test("exits 0 and names the tier on a resolvable branch", () => {
    withProject(
      [{ name: "STE-559.md", body: frBody({ milestone: "M_b11423", ticket: "STE-559" }) }],
      (root) => {
        const p = Bun.spawnSync(["bun", "run", MODULE, root, "feat/m_b11423-greet-helper"]);
        const out = new TextDecoder().decode(p.stdout);
        expect(p.exitCode).toBe(0);
        expect(out).toContain("milestone-fr STE-559");
      },
    );
  });

  test("exits 1 with a reason when resolution needs a human", () => {
    withProject([], (root) => {
      const p = Bun.spawnSync(["bun", "run", MODULE, root, "feat/m_b11423-x"]);
      const out = new TextDecoder().decode(p.stdout);
      expect(p.exitCode).toBe(1);
      expect(out).toContain("interactive");
    });
  });

  test("exits 2 on a usage error", () => {
    const p = Bun.spawnSync(["bun", "run", MODULE]);
    expect(p.exitCode).toBe(2);
  });
});

// ===========================================================================
// The repo's own state — a live witness, not a fixture.
// ===========================================================================

describe("AC-STE-563.8 — the resolver over this repository", () => {
  test("this milestone's own branch refuses, because three FRs bind it", () => {
    if (!existsSync(join(repoRoot, "specs", "frs"))) return;
    const r = resolveTicketForBranch(repoRoot, "fix/m_f040b5-what-conformance-found");
    // Three FRs on one milestone is the ordinary case, and the ordinary case
    // is a refusal. That is the design, not a shortfall.
    expect(r.tier).toBe("interactive");
  });
});
