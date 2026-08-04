// M116 STE-424 — detect mode-none short-ULID collisions across the archive
// boundary.
//
// AC map:
//   AC-STE-424.1 — the plan walk probe #73 already performs gains a cross-file
//                  duplicate-basename check spanning `specs/plan/` and
//                  `specs/plan/archive/` TOGETHER.
//   AC-STE-424.2 — the equivalent cross-file duplicate-tail check on probe #13
//                  spanning `specs/frs/` and `specs/frs/archive/` together.
//   AC-STE-424.3 — feature-record minting (`LocalProvider.mintId()`) routes
//                  through `mintUniqueId({ exists })` with a SYNCHRONOUS
//                  existence predicate over the active AND archived FR trees.
//   AC-STE-424.4 — `adapters/_shared/src/ac_prefix.test.ts` is inverted in
//                  place to assert the archive IS scanned (see that file).
//   AC-STE-424.5 — the two "by construction" prose over-claims are restated as
//                  detection within one working tree.
//   AC-STE-424.6 — a fixture reproduces the worst silent path (an active plan
//                  and an archived plan deriving the same token) and asserts
//                  the gate now FAILS on it.
//
// BOUNDARIES this file deliberately pins, because the natural implementation
// of each AC would otherwise break something already green:
//
//   * Probe #13's BIMODAL invariant (`id:` present/absent + `tracker:`
//     populated/absent) must stay ACTIVE-ONLY. This repo runs `mode: linear`
//     and its `specs/frs/archive/` holds 31 legacy mode-none records that each
//     carry BOTH `id:` and `tracker: {}`; widening the bimodal loop to the
//     archive turns the repo's own dogfood assertion red. The new duplicate
//     pass is a SEPARATE archive-spanning walk that reports duplicates only.
//   * The duplicate accumulator must read FRONTMATTER, never the whole file.
//     `specs/frs/archive/STE-110.md` carries a line-anchored `id:` in its BODY
//     inside a fenced YAML block; a naive `^id:` scan would mint phantom
//     entries in the duplicate map.
//   * Probe #13 keeps its scope-isolation boundary: no `ulid.ts` import, and
//     no `"plan"` literal in `identity_mode_conditional.ts`
//     (`tests/gate-check-plan-identity-mode-conditional.test.ts` asserts both).
//     The tail must therefore be derived without importing the minter.
//   * M116 spends NO probe number of its own. Both checks land in the EXISTING
//     probes #13 and #73, so this milestone left the count at 73 and moved
//     none of the ~26 pinned count sites. That is a fact about M116, not a
//     freeze: M118 later added #74 on its own budget, and the count assertion
//     at the foot of this file tracks the LIVE total, whatever it is today.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runIdentityModeConditionalProbe } from "../adapters/_shared/src/identity_mode_conditional";
import { LocalProvider } from "../adapters/_shared/src/local_provider";
import { milestoneIdFromUlid } from "../adapters/_shared/src/milestone_token";
import { runPlanIdentityModeConditionalProbe } from "../adapters/_shared/src/plan_identity_mode_conditional";
import { mintId, ULID_REGEX } from "../adapters/_shared/src/ulid";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");

// ───────────────────────────────────────────────────────────────────────────
// ULID fixtures — `fr_` + 26 Crockford base32 chars (no I/L/O/U).
// The operative key is the 6-char TAIL, `slice(23, 29)`.
// ───────────────────────────────────────────────────────────────────────────

/** `fr_<20-char head><6-char tail>` — a well-formed minted id with a chosen tail. */
function ulidWithTail(head20: string, tail6: string): string {
  const id = `fr_${head20}${tail6}`;
  if (!ULID_REGEX.test(id)) {
    throw new Error(`test fixture bug: "${id}" is not a well-formed minted id`);
  }
  return id;
}

const HEAD_A = "01K9ZQ8XJ4AAAAAAAAAA";
const HEAD_B = "01K9ZQ8XJ4BBBBBBBBBB";
const HEAD_C = "01K9ZQ8XJ4CCCCCCCCCC";

const TAIL_DUP = "F4VDTA";
const TAIL_OTHER = "ZZZZZZ";
const TAIL_THIRD = "9MKQR7";

/** Two DISTINCT minted ids that derive the SAME 6-char tail. 2^30 keyspace. */
const ULID_DUP_A = ulidWithTail(HEAD_A, TAIL_DUP);
const ULID_DUP_B = ulidWithTail(HEAD_B, TAIL_DUP);
const ULID_OTHER = ulidWithTail(HEAD_B, TAIL_OTHER);
const ULID_THIRD = ulidWithTail(HEAD_C, TAIL_THIRD);

const tailOf = (id: string): string => id.slice(23, 29);

interface Project {
  root: string;
  cleanup: () => void;
}

function claudeMd(mode: "none" | "linear" | "jira"): string {
  return mode === "none"
    ? "# Mode-none fixture\n\nNo `## Task Tracking` section → mode: none per Schema L canonical form.\n"
    : `# Tracker-mode fixture\n\n## Task Tracking\n\nmode: ${mode}\nmcp_server: ${mode}\n`;
}

/** Every violation's file + note + message, fused — the assertion surface. */
function blobOf(violations: Array<{ file: string; note: string; message: string }>): string {
  return violations.map((v) => `${v.file}\n${v.note}\n${v.message}`).join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════
// AC-STE-424.1 + AC-STE-424.6 — plan side, probe #73
// ═══════════════════════════════════════════════════════════════════════════

interface PlanFixture {
  name: string;
  id?: string;
  archived?: boolean;
}

function makePlanProject(opts: { mode: "none" | "linear"; plans: PlanFixture[] }): Project {
  const root = mkdtempSync(join(tmpdir(), "ste424-plan-"));
  const planDir = join(root, "specs", "plan");
  mkdirSync(join(planDir, "archive"), { recursive: true });
  writeFileSync(join(root, "CLAUDE.md"), claudeMd(opts.mode));

  for (const plan of opts.plans) {
    const dir = plan.archived === true ? join(planDir, "archive") : planDir;
    const stem = plan.name.replace(/\.md$/, "");
    writeFileSync(
      join(dir, plan.name),
      [
        "---",
        ...(plan.id === undefined ? [] : [`id: ${plan.id}`]),
        `milestone: ${stem}`,
        "status: active",
        "archived_at: null",
        "---",
        "",
        `# ${stem} — Fixture`,
        "",
      ].join("\n"),
    );
  }

  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

describe("AC-STE-424.6 — the worst silent path: an active plan and an archived plan deriving the same token", () => {
  test("two plans deriving M_F4VDTA (one active, one archived) FAIL the gate", async () => {
    // Both files are individually self-consistent — each carries a well-formed
    // minted id that derives its OWN basename — so the per-file check at
    // plan_identity_mode_conditional.ts:280 passes for both and the pair sat
    // green side by side. This is the collision the FR calls silent end to end.
    expect(milestoneIdFromUlid(ULID_DUP_A)).toBe("M_F4VDTA");
    expect(milestoneIdFromUlid(ULID_DUP_B)).toBe("M_F4VDTA");
    expect(ULID_DUP_A).not.toBe(ULID_DUP_B);

    const p = makePlanProject({
      mode: "none",
      plans: [
        { name: "M_F4VDTA.md", id: ULID_DUP_A },
        { name: "M_F4VDTA.md", id: ULID_DUP_B, archived: true },
      ],
    });
    try {
      const report = await runPlanIdentityModeConditionalProbe(p.root);
      expect(report.violations.length).toBeGreaterThanOrEqual(1);
      // Severity error ⇒ GATE FAILED, not GATE PASSED WITH NOTES.
      expect(report.severity).toBe("error");
    } finally {
      p.cleanup();
    }
  });

  test("the violation names BOTH colliding plan files, across the archive boundary", async () => {
    const p = makePlanProject({
      mode: "none",
      plans: [
        { name: "M_F4VDTA.md", id: ULID_DUP_A },
        { name: "M_F4VDTA.md", id: ULID_DUP_B, archived: true },
      ],
    });
    try {
      const report = await runPlanIdentityModeConditionalProbe(p.root);
      const blob = blobOf(report.violations);
      // The active leg...
      expect(blob).toContain(join("specs", "plan", "M_F4VDTA.md"));
      // ...and the archived leg. A report naming only one is unactionable:
      // the operator cannot tell which file to rename.
      expect(blob).toContain(join("specs", "plan", "archive", "M_F4VDTA.md"));
    } finally {
      p.cleanup();
    }
  });

  test("both minted ids are surfaced so the operator can tell the two apart", async () => {
    const p = makePlanProject({
      mode: "none",
      plans: [
        { name: "M_F4VDTA.md", id: ULID_DUP_A },
        { name: "M_F4VDTA.md", id: ULID_DUP_B, archived: true },
      ],
    });
    try {
      const blob = blobOf((await runPlanIdentityModeConditionalProbe(p.root)).violations);
      expect(blob).toContain(ULID_DUP_A);
      expect(blob).toContain(ULID_DUP_B);
    } finally {
      p.cleanup();
    }
  });

  test("the duplicate violation renders NFR-10 canonical shape", async () => {
    const p = makePlanProject({
      mode: "none",
      plans: [
        { name: "M_F4VDTA.md", id: ULID_DUP_A },
        { name: "M_F4VDTA.md", id: ULID_DUP_B, archived: true },
      ],
    });
    try {
      const report = await runPlanIdentityModeConditionalProbe(p.root);
      const dup = report.violations.find((v) => /duplicat|collid|collision/i.test(v.message));
      expect(dup).toBeDefined();
      expect(dup!.message).toContain("plan_identity_mode_conditional:");
      expect(dup!.message).toMatch(/Remedy:/);
      expect(dup!.message).toMatch(/Context:/);
      expect(dup!.note).toMatch(/specs\/plan\/.*\.md:\d+ — /);
    } finally {
      p.cleanup();
    }
  });
});

describe("AC-STE-424.1 — the plan duplicate check spans the archive boundary without new false positives", () => {
  test("a clean minted plan sharing the tree is NOT collateral damage", async () => {
    // Only the colliding token may be reported. A duplicate check that fires
    // per-walk rather than per-token would drag the innocent plan in with it.
    const p = makePlanProject({
      mode: "none",
      plans: [
        { name: "M_F4VDTA.md", id: ULID_DUP_A },
        { name: "M_9MKQR7.md", id: ULID_THIRD },
        { name: "M_F4VDTA.md", id: ULID_DUP_B, archived: true },
      ],
    });
    try {
      const report = await runPlanIdentityModeConditionalProbe(p.root);
      expect(report.violations.length).toBeGreaterThanOrEqual(1);
      const blob = blobOf(report.violations);
      expect(blob).toContain("M_F4VDTA");
      expect(blob).not.toContain("M_9MKQR7");
      expect(blob).not.toContain(ULID_THIRD);
    } finally {
      p.cleanup();
    }
  });

  test("positive control — two minted plans with DIFFERENT tails pass clean", async () => {
    const p = makePlanProject({
      mode: "none",
      plans: [
        { name: "M_F4VDTA.md", id: ULID_DUP_A },
        { name: "M_ZZZZZZ.md", id: ULID_OTHER, archived: true },
      ],
    });
    try {
      const report = await runPlanIdentityModeConditionalProbe(p.root);
      expect(report.violations).toEqual([]);
    } finally {
      p.cleanup();
    }
  });

  test("positive control — sequential plans across the boundary raise no DUPLICATE", async () => {
    // `M1.md` active + `M20.md` archived carry no `id:` at all. The duplicate
    // pass must not invent violations for plans it never minted.
    //
    // STE-441 note: this fixture is a bare `mkdtemp` tree with no `.git`, so
    // the sequential plans are silent under probe #73's provenance carve-out by
    // NON-GIT VACUITY — not because their filename shape grandfathers them, as
    // it did before that change. The assertion below pins that reason, so this
    // green test cannot be misread as evidence the shape rule survives. In a
    // git repository these two untracked plans classify `fresh` and both fail
    // (`tests/m119-ste-441-plan-provenance.test.ts`), while the duplicate pass
    // — which is what THIS test is controlling for — stays silent either way,
    // since `M1` and `M20` are distinct tokens.
    const p = makePlanProject({
      mode: "none",
      plans: [
        { name: "M1.md" },
        { name: "M20.md", archived: true },
      ],
    });
    try {
      expect(existsSync(join(p.root, ".git"))).toBe(false);
      expect((await runPlanIdentityModeConditionalProbe(p.root)).violations).toEqual([]);
    } finally {
      p.cleanup();
    }
  });

  test("dogfood — this repo (mode: linear) still returns zero probe #73 violations", async () => {
    const report = await runPlanIdentityModeConditionalProbe(REPO_ROOT);
    expect(report.mode).toBe("linear");
    expect(report.violations).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-STE-424.2 — feature-record side, probe #13
// ═══════════════════════════════════════════════════════════════════════════

interface FrFixture {
  name: string;
  id?: string;
  tracker?: string | "empty";
  body?: string;
  archived?: boolean;
}

function makeFrProject(opts: { mode: "none" | "linear"; frs: FrFixture[] }): Project {
  const root = mkdtempSync(join(tmpdir(), "ste424-fr-"));
  const frsDir = join(root, "specs", "frs");
  mkdirSync(join(frsDir, "archive"), { recursive: true });
  writeFileSync(join(root, "CLAUDE.md"), claudeMd(opts.mode));

  for (const fr of opts.frs) {
    const dir = fr.archived === true ? join(frsDir, "archive") : frsDir;
    const trackerLines =
      fr.tracker === undefined
        ? []
        : fr.tracker === "empty"
          ? ["tracker: {}"]
          : ["tracker:", `  ${opts.mode}: ${fr.tracker}`];
    writeFileSync(
      join(dir, fr.name),
      [
        "---",
        `title: ${fr.name.replace(/\.md$/, "")} fixture`,
        "milestone: M1",
        "status: active",
        "archived_at: null",
        ...(fr.id === undefined ? [] : [`id: ${fr.id}`]),
        ...trackerLines,
        "created_at: 2026-07-27T00:00:00.000Z",
        "---",
        "",
        fr.body ?? "## Requirement\n\nBody.\n",
      ].join("\n"),
    );
  }

  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

describe("AC-STE-424.2 — duplicate short-ULID tails across specs/frs/ and specs/frs/archive/", () => {
  test("an active FR and an archived FR sharing a tail FAIL the gate", async () => {
    const p = makeFrProject({
      mode: "none",
      frs: [
        { name: `${TAIL_DUP}.md`, id: ULID_DUP_A },
        { name: `${TAIL_DUP}.md`, id: ULID_DUP_B, archived: true },
      ],
    });
    try {
      const report = await runIdentityModeConditionalProbe(p.root);
      expect(report.mode).toBe("none");
      expect(report.violations.length).toBeGreaterThanOrEqual(1);
      expect(report.severity).toBe("error");
    } finally {
      p.cleanup();
    }
  });

  test("the violation names BOTH records and BOTH minted ids", async () => {
    const p = makeFrProject({
      mode: "none",
      frs: [
        { name: `${TAIL_DUP}.md`, id: ULID_DUP_A },
        { name: `${TAIL_DUP}.md`, id: ULID_DUP_B, archived: true },
      ],
    });
    try {
      const blob = blobOf((await runIdentityModeConditionalProbe(p.root)).violations);
      expect(blob).toContain(join("specs", "frs", `${TAIL_DUP}.md`));
      expect(blob).toContain(join("specs", "frs", "archive", `${TAIL_DUP}.md`));
      expect(blob).toContain(ULID_DUP_A);
      expect(blob).toContain(ULID_DUP_B);
    } finally {
      p.cleanup();
    }
  });

  test("the duplicate violation renders NFR-10 canonical shape", async () => {
    const p = makeFrProject({
      mode: "none",
      frs: [
        { name: `${TAIL_DUP}.md`, id: ULID_DUP_A },
        { name: `${TAIL_DUP}.md`, id: ULID_DUP_B, archived: true },
      ],
    });
    try {
      const report = await runIdentityModeConditionalProbe(p.root);
      const dup = report.violations.find((v) => /duplicat|collid|collision/i.test(v.message));
      expect(dup).toBeDefined();
      expect(dup!.message).toContain("identity_mode_conditional:");
      expect(dup!.message).toMatch(/Remedy:/);
      expect(dup!.message).toMatch(/Context:/);
      expect(dup!.note).toMatch(/specs\/frs\/.*\.md:\d+ — /);
    } finally {
      p.cleanup();
    }
  });

  test("the key is the derived TAIL, not the filename — a renamed archived record still collides", async () => {
    // The tail is what `acPrefix`, the filename stem, the AC prefix and the
    // milestone token all key on, so the duplicate map must be built from the
    // frontmatter `id:` rather than from the file's name. An archived record
    // whose filename drifted off its own tail is exactly the case a
    // filename-only check misses.
    const p = makeFrProject({
      mode: "none",
      frs: [
        { name: `${TAIL_DUP}.md`, id: ULID_DUP_A },
        { name: `${TAIL_THIRD}.md`, id: ULID_DUP_B, archived: true },
      ],
    });
    try {
      const report = await runIdentityModeConditionalProbe(p.root);
      expect(report.violations.length).toBeGreaterThanOrEqual(1);
      const blob = blobOf(report.violations);
      expect(blob).toContain(ULID_DUP_A);
      expect(blob).toContain(ULID_DUP_B);
    } finally {
      p.cleanup();
    }
  });

  test("positive control — distinct tails across the boundary pass clean", async () => {
    const p = makeFrProject({
      mode: "none",
      frs: [
        { name: `${TAIL_DUP}.md`, id: ULID_DUP_A },
        { name: `${TAIL_OTHER}.md`, id: ULID_OTHER, archived: true },
        { name: `${TAIL_THIRD}.md`, id: ULID_THIRD, archived: true },
      ],
    });
    try {
      expect((await runIdentityModeConditionalProbe(p.root)).violations).toEqual([]);
    } finally {
      p.cleanup();
    }
  });

  test("a fenced `id:` line in an FR BODY never enters the duplicate map", async () => {
    // `specs/frs/archive/STE-110.md:18` carries a line-anchored `id:` inside a
    // ```yaml block quoting a broken record. A whole-file `^id:` scan reads it
    // as a second identity for that file and manufactures a phantom duplicate.
    // The accumulator must route through the module's frontmatter splitter.
    const p = makeFrProject({
      mode: "none",
      frs: [
        { name: `${TAIL_DUP}.md`, id: ULID_DUP_A },
        {
          name: `${TAIL_OTHER}.md`,
          id: ULID_OTHER,
          archived: true,
          body: [
            "## Requirement",
            "",
            "The smoke run generated frontmatter:",
            "",
            "```yaml",
            "---",
            `id: ${ULID_DUP_B}`,
            "title: Quoted broken record",
            "---",
            "```",
            "",
          ].join("\n"),
        },
      ],
    });
    try {
      expect((await runIdentityModeConditionalProbe(p.root)).violations).toEqual([]);
    } finally {
      p.cleanup();
    }
  });

  test("a missing specs/frs/archive/ directory is not an error (consumer trees lack it)", async () => {
    const root = mkdtempSync(join(tmpdir(), "ste424-noarchive-"));
    try {
      mkdirSync(join(root, "specs", "frs"), { recursive: true });
      writeFileSync(join(root, "CLAUDE.md"), claudeMd("none"));
      writeFileSync(
        join(root, "specs", "frs", `${TAIL_DUP}.md`),
        `---\ntitle: x\nmilestone: M1\nstatus: active\narchived_at: null\nid: ${ULID_DUP_A}\ncreated_at: 2026-07-27\n---\n\n# x\n`,
      );
      expect((await runIdentityModeConditionalProbe(root)).violations).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("AC-STE-424.2 — the bimodal invariant stays ACTIVE-ONLY (archive-widening tripwire)", () => {
  test("a tracker-mode project's archived legacy record (id: + tracker: {}) fires nothing", async () => {
    // This repo's `specs/frs/archive/` holds 31 records in exactly this shape.
    // If the duplicate pass is implemented by widening the bimodal loop to the
    // archive instead of as its own pass, each of them yields two violations
    // and the repo's own gate goes red.
    const p = makeFrProject({
      mode: "linear",
      frs: [
        { name: "STE-1.md", tracker: "STE-1" },
        { name: "HG95TH.md", id: ULID_OTHER, tracker: "empty", archived: true },
      ],
    });
    try {
      const report = await runIdentityModeConditionalProbe(p.root);
      expect(report.mode).toBe("linear");
      expect(report.violations).toEqual([]);
    } finally {
      p.cleanup();
    }
  });

  test("dogfood — this repo (mode: linear) still returns zero probe #13 violations", async () => {
    const report = await runIdentityModeConditionalProbe(REPO_ROOT);
    expect(report.mode).toBe("linear");
    expect(report.violations).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-STE-424.3 — feature-record minting gains the collision guard
// ═══════════════════════════════════════════════════════════════════════════

const COUNTER_KEY = "__dpt_ulid_test_counter";
const SEED = "M116FR"; // valid Crockford, ≤ 10 chars

function resetCounter(): void {
  delete (globalThis as Record<string, unknown>)[COUNTER_KEY];
}

/** The exact ids the NEXT `mintId()` calls will return, counter rewound. */
function peekNextMintedIds(count: number): string[] {
  resetCounter();
  const ids: string[] = [];
  for (let i = 0; i < count; i++) ids.push(mintId());
  resetCounter();
  return ids;
}

interface MintFixture {
  root: string;
  frsDir: string;
  archiveDir: string;
  cleanup: () => void;
}

function makeMintFixture(opts: { withArchive?: boolean } = {}): MintFixture {
  const root = mkdtempSync(join(tmpdir(), "ste424-mint-"));
  const frsDir = join(root, "specs", "frs");
  const archiveDir = join(frsDir, "archive");
  if (opts.withArchive === false) mkdirSync(frsDir, { recursive: true });
  else mkdirSync(archiveDir, { recursive: true });
  return {
    root,
    frsDir,
    archiveDir,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

/** A pre-existing record that legitimately OWNS `tail` — never to be clobbered. */
function ownedBy(tail: string): string {
  return [
    "---",
    `id: ${ulidWithTail("01K9ZQ8XJ4DDDDDDDDDD", tail)}`,
    "title: pre-existing FR — DO NOT OVERWRITE",
    "milestone: M1",
    "status: active",
    "archived_at: null",
    "created_at: 2026-07-27T00:00:00.000Z",
    "---",
    "",
    "# pre-existing FR — DO NOT OVERWRITE",
    "",
  ].join("\n");
}

let stashedNodeEnv: string | undefined;
let stashedSeed: string | undefined;

beforeEach(() => {
  stashedNodeEnv = process.env["NODE_ENV"];
  stashedSeed = process.env["DPT_TEST_ULID_SEED"];
  process.env["NODE_ENV"] = "test";
  process.env["DPT_TEST_ULID_SEED"] = SEED;
  resetCounter();
});

afterEach(() => {
  if (stashedNodeEnv === undefined) delete process.env["NODE_ENV"];
  else process.env["NODE_ENV"] = stashedNodeEnv;
  if (stashedSeed === undefined) delete process.env["DPT_TEST_ULID_SEED"];
  else process.env["DPT_TEST_ULID_SEED"] = stashedSeed;
  resetCounter();
});

describe("AC-STE-424.3 — LocalProvider.mintId() routes through the collision-guarded minter", () => {
  test("clean tree: the first mint is used verbatim", () => {
    const fx = makeMintFixture();
    try {
      const [expected] = peekNextMintedIds(1);
      const id = new LocalProvider({ repoRoot: fx.root }).mintId();
      expect(id).toBe(expected!);
      expect(ULID_REGEX.test(id)).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  test("ACTIVE record collision re-mints — the existing record is byte-unchanged", () => {
    const fx = makeMintFixture();
    try {
      const [first, second] = peekNextMintedIds(2);
      const takenPath = join(fx.frsDir, `${tailOf(first!)}.md`);
      const taken = ownedBy(tailOf(first!));
      writeFileSync(takenPath, taken);

      const id = new LocalProvider({ repoRoot: fx.root }).mintId();

      expect(id).not.toBe(first!);
      expect(id).toBe(second!);
      expect(readFileSync(takenPath, "utf-8")).toBe(taken);
    } finally {
      fx.cleanup();
    }
  });

  test("ARCHIVED record collision re-mints too — archive/ is probed alongside active", () => {
    // The headline of AC-STE-424.3. `local_provider.ts:72-74` returned the raw
    // mint with no predicate at all, so a tail already owned by an ARCHIVED
    // record was silently reused and the next write landed on an occupied name.
    const fx = makeMintFixture();
    try {
      const [first, second] = peekNextMintedIds(2);
      const takenPath = join(fx.archiveDir, `${tailOf(first!)}.md`);
      const taken = ownedBy(tailOf(first!));
      writeFileSync(takenPath, taken);

      const id = new LocalProvider({ repoRoot: fx.root }).mintId();

      expect(id).toBe(second!);
      expect(tailOf(id)).not.toBe(tailOf(first!));
      expect(readFileSync(takenPath, "utf-8")).toBe(taken);
    } finally {
      fx.cleanup();
    }
  });

  test("the existence predicate is SYNCHRONOUS — an async one would defeat the retry", () => {
    // `mintUniqueId` evaluates `!options.exists(id)`. An async predicate returns
    // a Promise, which is always truthy, so EVERY attempt reads as a collision
    // and the call throws after 3 rounds instead of returning the second mint.
    // A single seeded collision therefore discriminates sync from async: this
    // must RESOLVE to the second id, and `mintId()` must stay a plain string.
    const fx = makeMintFixture();
    try {
      const [first, second] = peekNextMintedIds(2);
      writeFileSync(join(fx.archiveDir, `${tailOf(first!)}.md`), ownedBy(tailOf(first!)));

      const id = new LocalProvider({ repoRoot: fx.root }).mintId();

      expect(typeof id).toBe("string");
      expect(id).not.toBeInstanceOf(Promise);
      expect(id).toBe(second!);
    } finally {
      fx.cleanup();
    }
  });

  test("three consecutive collisions exhaust the 3-attempt budget and throw", () => {
    const fx = makeMintFixture();
    try {
      const taken = peekNextMintedIds(3);
      const bodies = new Map<string, string>();
      for (const id of taken) {
        const path = join(fx.frsDir, `${tailOf(id)}.md`);
        const body = ownedBy(tailOf(id));
        bodies.set(path, body);
        writeFileSync(path, body);
      }
      expect(() => new LocalProvider({ repoRoot: fx.root }).mintId()).toThrow(/collision/i);
      // Nothing was clobbered on the way out.
      for (const [path, body] of bodies) {
        expect(readFileSync(path, "utf-8")).toBe(body);
      }
    } finally {
      fx.cleanup();
    }
  });

  test("the predicate derives the TAIL — a file named after the RAW minted id is not a collision", () => {
    // Mirrors the milestone minter's own pin: only `<tail>.md` is a real
    // feature-record filename, so probing for whatever string was handed over
    // would produce a spurious re-mint.
    const fx = makeMintFixture();
    try {
      const [first] = peekNextMintedIds(1);
      writeFileSync(join(fx.frsDir, `${first!}.md`), ownedBy(TAIL_THIRD));

      expect(new LocalProvider({ repoRoot: fx.root }).mintId()).toBe(first!);
    } finally {
      fx.cleanup();
    }
  });

  test("an absent specs/frs tree is not a collision — the first mint still wins", () => {
    const root = mkdtempSync(join(tmpdir(), "ste424-nofrs-"));
    try {
      const [expected] = peekNextMintedIds(1);
      expect(new LocalProvider({ repoRoot: root }).mintId()).toBe(expected!);
      expect(existsSync(join(root, "specs", "frs"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("an absent specs/frs/archive/ directory is tolerated", () => {
    const fx = makeMintFixture({ withArchive: false });
    try {
      const [first, second] = peekNextMintedIds(2);
      writeFileSync(join(fx.frsDir, `${tailOf(first!)}.md`), ownedBy(tailOf(first!)));
      expect(existsSync(fx.archiveDir)).toBe(false);
      expect(new LocalProvider({ repoRoot: fx.root }).mintId()).toBe(second!);
    } finally {
      fx.cleanup();
    }
  });

  test("an injected specsDir is honoured — the probe never hard-codes <repoRoot>/specs", () => {
    const fx = makeMintFixture();
    try {
      const altSpecs = join(fx.root, "elsewhere");
      mkdirSync(join(altSpecs, "frs", "archive"), { recursive: true });
      const [first, second] = peekNextMintedIds(2);
      writeFileSync(join(altSpecs, "frs", "archive", `${tailOf(first!)}.md`), ownedBy(tailOf(first!)));

      const id = new LocalProvider({ repoRoot: fx.root, specsDir: altSpecs }).mintId();
      expect(id).toBe(second!);
    } finally {
      fx.cleanup();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-STE-424.4 — the inverted archive-scan test
//
// The inversion itself lives in `adapters/_shared/src/ac_prefix.test.ts` (the
// test formerly named "scan ignores archive/ subdirectory"). What this block
// pins is the SELF-SKIP semantics that inversion exposes: once the archive is
// scanned, a post-write re-scan must not collide a record with itself, and the
// existing `entry === \`${newId}.md\`` guard cannot do that job because real
// files are named `<tail>.md`, never `<full-id>.md`.
// ═══════════════════════════════════════════════════════════════════════════

async function importAcPrefix() {
  return await import("../adapters/_shared/src/ac_prefix");
}

function makeScanDir(opts: { withArchive?: boolean } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "ste424-scan-"));
  if (opts.withArchive === false) mkdirSync(join(dir, "frs"), { recursive: true });
  else mkdirSync(join(dir, "frs", "archive"), { recursive: true });
  return dir;
}

function writeRecord(dir: string, name: string, id: string): void {
  writeFileSync(
    join(dir, name),
    [
      "---",
      `id: ${id}`,
      "title: Existing FR",
      "milestone: M1",
      "status: active",
      "archived_at: null",
      "tracker:",
      "  {}",
      "created_at: 2026-07-27T00:00:00.000Z",
      "---",
      "",
    ].join("\n"),
  );
}

describe("AC-STE-424.4 — the archive is scanned, and self-skip is keyed on identity", () => {
  test("an ARCHIVED record owning the tail blocks the write", async () => {
    const { ShortUlidCollisionError, scanShortUlidCollision } = await importAcPrefix();
    const specsDir = makeScanDir();
    try {
      writeRecord(join(specsDir, "frs", "archive"), `${TAIL_DUP}.md`, ULID_DUP_A);
      const newSpec = { frontmatter: { id: ULID_DUP_B, tracker: {} }, body: "" };
      await expect(scanShortUlidCollision(specsDir, newSpec)).rejects.toBeInstanceOf(
        ShortUlidCollisionError,
      );
    } finally {
      rmSync(specsDir, { recursive: true, force: true });
    }
  });

  test("the error names the ARCHIVED record's id, not the filename stem", async () => {
    const { ShortUlidCollisionError, scanShortUlidCollision } = await importAcPrefix();
    const specsDir = makeScanDir();
    try {
      writeRecord(join(specsDir, "frs", "archive"), `${TAIL_DUP}.md`, ULID_DUP_A);
      const newSpec = { frontmatter: { id: ULID_DUP_B, tracker: {} }, body: "" };
      let caught: unknown;
      try {
        await scanShortUlidCollision(specsDir, newSpec);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(ShortUlidCollisionError);
      const err = caught as InstanceType<typeof ShortUlidCollisionError>;
      expect(err.existingId).toBe(ULID_DUP_A);
      expect(err.newId).toBe(ULID_DUP_B);
      expect(err.prefix).toBe(TAIL_DUP);
    } finally {
      rmSync(specsDir, { recursive: true, force: true });
    }
  });

  test("self-skip is by IDENTITY — re-scanning a record already on disk under its own tail passes", async () => {
    // `ac_prefix.ts:100` skips `entry === \`${newId}.md\``, i.e. a file named
    // after the FULL 29-char id. Real records are named `<tail>.md`, so that
    // guard has never matched a real tree. Adding the archive pass makes the
    // gap reachable: /spec-write re-running its pre-write scan after the file
    // exists would report the record colliding with itself.
    const { scanShortUlidCollision } = await importAcPrefix();
    const specsDir = makeScanDir();
    try {
      writeRecord(join(specsDir, "frs"), `${TAIL_DUP}.md`, ULID_DUP_A);
      const sameSpec = { frontmatter: { id: ULID_DUP_A, tracker: {} }, body: "" };
      await expect(scanShortUlidCollision(specsDir, sameSpec)).resolves.toBeUndefined();
    } finally {
      rmSync(specsDir, { recursive: true, force: true });
    }
  });

  test("self-skip applies in archive/ too — an ARCHIVED copy of the same record is not a collision", async () => {
    const { scanShortUlidCollision } = await importAcPrefix();
    const specsDir = makeScanDir();
    try {
      writeRecord(join(specsDir, "frs", "archive"), `${TAIL_DUP}.md`, ULID_DUP_A);
      const sameSpec = { frontmatter: { id: ULID_DUP_A, tracker: {} }, body: "" };
      await expect(scanShortUlidCollision(specsDir, sameSpec)).resolves.toBeUndefined();
    } finally {
      rmSync(specsDir, { recursive: true, force: true });
    }
  });

  test("a missing frs/archive/ directory is tolerated, not a crash", async () => {
    const { scanShortUlidCollision } = await importAcPrefix();
    const specsDir = makeScanDir({ withArchive: false });
    try {
      writeRecord(join(specsDir, "frs"), `${TAIL_OTHER}.md`, ULID_OTHER);
      const newSpec = { frontmatter: { id: ULID_DUP_A, tracker: {} }, body: "" };
      await expect(scanShortUlidCollision(specsDir, newSpec)).resolves.toBeUndefined();
      expect(existsSync(join(specsDir, "frs", "archive"))).toBe(false);
    } finally {
      rmSync(specsDir, { recursive: true, force: true });
    }
  });

  test("tracker-mode specs still bypass the scan even against an archived tail", async () => {
    const { scanShortUlidCollision } = await importAcPrefix();
    const specsDir = makeScanDir();
    try {
      writeRecord(join(specsDir, "frs", "archive"), `${TAIL_DUP}.md`, ULID_DUP_A);
      const newSpec = { frontmatter: { id: ULID_DUP_B, tracker: { linear: "STE-999" } }, body: "" };
      await expect(scanShortUlidCollision(specsDir, newSpec)).resolves.toBeUndefined();
    } finally {
      rmSync(specsDir, { recursive: true, force: true });
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-STE-424.4 (Phase-3 review) — the pre-write scan must not FAIL OPEN on a
// record it cannot parse.
//
// `scanShortUlidCollision`'s per-record loop wraps BOTH `parseFrontmatter` and
// `acPrefix` in `catch { continue; }`. So a record whose frontmatter is
// malformed — or which carries neither a usable `id:` nor a populated
// `tracker:` — is skipped outright, i.e. read as "not a collision candidate".
//
// For a `mode: none` record that reading is wrong: the FILENAME STEM *is* the
// ground-truth short-ULID tail. `<tail>.md` is the canonical feature-record
// name, and the loop already computes exactly that fallback two lines earlier
// (`entry.replace(/\.md$/, "")`) for its identity self-skip. Waving the record
// through lets the colliding write LAND; the cross-file duplicate probe added
// by AC-STE-424.2 then reports it only AFTER the damage — which is the exact
// fail-open class this FR exists to close. The archive matters most here: it is
// the older, wider corpus, so that is where malformed records actually live.
//
// The controls below fence the fix so it cannot become "any unparseable file is
// a collision": only a stem that IS the contested tail may refuse the write.
// ═══════════════════════════════════════════════════════════════════════════

/** A record whose write was interrupted before the closing `---` was emitted. */
const TRUNCATED_FRONTMATTER = [
  "---",
  `id: ${ULID_DUP_A}`,
  "title: Interrupted write — no closing delimiter",
].join("\n");

/** A record with no frontmatter block at all — `parseFrontmatter` throws. */
const NO_FRONTMATTER = [
  "# Half-written record",
  "",
  "The frontmatter block was never emitted.",
  "",
].join("\n");

/** Well-formed frontmatter, but neither a usable `id:` nor a populated `tracker:`. */
const NO_USABLE_IDENTITY = [
  "---",
  "title: Record with no usable identity",
  "milestone: M1",
  "status: active",
  "archived_at: null",
  "tracker: {}",
  "created_at: 2026-07-27T00:00:00.000Z",
  "---",
  "",
  "## Requirement",
  "",
].join("\n");

/** The three shapes whose `acPrefix`/`parseFrontmatter` call currently throws. */
const UNREADABLE_SHAPES: Array<{ label: string; content: string }> = [
  { label: "truncated frontmatter (no closing ---)", content: TRUNCATED_FRONTMATTER },
  { label: "no frontmatter block at all", content: NO_FRONTMATTER },
  { label: "well-formed frontmatter with no usable identity", content: NO_USABLE_IDENTITY },
];

/** A new `mode: none` spec whose derived tail is `TAIL_DUP`. */
const NEW_MODE_NONE_SPEC = { frontmatter: { id: ULID_DUP_B, tracker: {} }, body: "" };

describe("AC-STE-424.4 — an unreadable record still OWNS the tail its filename spells", () => {
  for (const shape of UNREADABLE_SHAPES) {
    test(`ACTIVE record — ${shape.label} — named <tail>.md refuses the write`, async () => {
      const { ShortUlidCollisionError, scanShortUlidCollision } = await importAcPrefix();
      const specsDir = makeScanDir();
      try {
        writeFileSync(join(specsDir, "frs", `${TAIL_DUP}.md`), shape.content);
        await expect(
          scanShortUlidCollision(specsDir, NEW_MODE_NONE_SPEC),
        ).rejects.toBeInstanceOf(ShortUlidCollisionError);
      } finally {
        rmSync(specsDir, { recursive: true, force: true });
      }
    });

    test(`ARCHIVED record — ${shape.label} — named <tail>.md refuses the write`, async () => {
      // The archive is the older, wider corpus. A record that predates the
      // current frontmatter schema, or that a half-finished `git mv` left
      // truncated, lives HERE — and an archived record still owns its tail.
      const { ShortUlidCollisionError, scanShortUlidCollision } = await importAcPrefix();
      const specsDir = makeScanDir();
      try {
        writeFileSync(join(specsDir, "frs", "archive", `${TAIL_DUP}.md`), shape.content);
        await expect(
          scanShortUlidCollision(specsDir, NEW_MODE_NONE_SPEC),
        ).rejects.toBeInstanceOf(ShortUlidCollisionError);
      } finally {
        rmSync(specsDir, { recursive: true, force: true });
      }
    });
  }

  test("the refusal is actionable — it names the contested tail and the new id", async () => {
    const { ShortUlidCollisionError, scanShortUlidCollision } = await importAcPrefix();
    const specsDir = makeScanDir();
    try {
      writeFileSync(join(specsDir, "frs", "archive", `${TAIL_DUP}.md`), NO_FRONTMATTER);
      let caught: unknown;
      try {
        await scanShortUlidCollision(specsDir, NEW_MODE_NONE_SPEC);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(ShortUlidCollisionError);
      const err = caught as InstanceType<typeof ShortUlidCollisionError>;
      expect(err.prefix).toBe(TAIL_DUP);
      expect(err.newId).toBe(ULID_DUP_B);
      // The record has no readable `id:`, so the only identity available is the
      // filename — which must still reach the operator, or the message names a
      // file they cannot locate.
      expect(err.existingId).toContain(TAIL_DUP);
      expect(err.message).toContain(TAIL_DUP);
    } finally {
      rmSync(specsDir, { recursive: true, force: true });
    }
  });

  test("NON-VACUITY — an unreadable record whose stem is a DIFFERENT tail resolves clean", async () => {
    // Fences the fix against becoming "any unparseable file is a collision".
    const { scanShortUlidCollision } = await importAcPrefix();
    const specsDir = makeScanDir();
    try {
      writeFileSync(join(specsDir, "frs", `${TAIL_OTHER}.md`), TRUNCATED_FRONTMATTER);
      writeFileSync(join(specsDir, "frs", "archive", `${TAIL_THIRD}.md`), NO_FRONTMATTER);
      await expect(
        scanShortUlidCollision(specsDir, NEW_MODE_NONE_SPEC),
      ).resolves.toBeUndefined();
    } finally {
      rmSync(specsDir, { recursive: true, force: true });
    }
  });

  test("NON-VACUITY — non-record `.md` files in the tree are never collision candidates", async () => {
    // `README.md` / `notes.md` / `index.md` are not feature records. A scan
    // that throws on every file it fails to parse would refuse every mint in a
    // tree that happens to carry one.
    const { scanShortUlidCollision } = await importAcPrefix();
    const specsDir = makeScanDir();
    try {
      for (const name of ["README.md", "notes.md", "index.md"]) {
        writeFileSync(join(specsDir, "frs", name), NO_FRONTMATTER);
        writeFileSync(join(specsDir, "frs", "archive", name), TRUNCATED_FRONTMATTER);
      }
      await expect(
        scanShortUlidCollision(specsDir, NEW_MODE_NONE_SPEC),
      ).resolves.toBeUndefined();
    } finally {
      rmSync(specsDir, { recursive: true, force: true });
    }
  });

  test("NON-VACUITY — a tracker-mode new spec still bypasses the scan entirely", async () => {
    const { scanShortUlidCollision } = await importAcPrefix();
    const specsDir = makeScanDir();
    try {
      writeFileSync(join(specsDir, "frs", "archive", `${TAIL_DUP}.md`), NO_FRONTMATTER);
      const trackerSpec = {
        frontmatter: { id: ULID_DUP_B, tracker: { linear: "STE-999" } },
        body: "",
      };
      await expect(
        scanShortUlidCollision(specsDir, trackerSpec),
      ).resolves.toBeUndefined();
    } finally {
      rmSync(specsDir, { recursive: true, force: true });
    }
  });

  test("REGRESSION FENCE — self-skip by identity survives: a readable record re-scans clean", async () => {
    // The filename fallback must apply ONLY where the record has no readable
    // identity. A well-formed record re-scanned after it is on disk still
    // matches on `id:` and must not be reported as colliding with itself.
    const { scanShortUlidCollision } = await importAcPrefix();
    const specsDir = makeScanDir();
    try {
      writeRecord(join(specsDir, "frs"), `${TAIL_DUP}.md`, ULID_DUP_A);
      const sameSpec = { frontmatter: { id: ULID_DUP_A, tracker: {} }, body: "" };
      await expect(scanShortUlidCollision(specsDir, sameSpec)).resolves.toBeUndefined();

      // ...and the same record archived, under the same tail.
      writeRecord(join(specsDir, "frs", "archive"), `${TAIL_OTHER}.md`, ULID_OTHER);
      const archivedSelf = { frontmatter: { id: ULID_OTHER, tracker: {} }, body: "" };
      await expect(scanShortUlidCollision(specsDir, archivedSelf)).resolves.toBeUndefined();
    } finally {
      rmSync(specsDir, { recursive: true, force: true });
    }
  });

  test("REGRESSION FENCE — a readable record still collides on its ID-derived tail", async () => {
    // The fallback must not displace the primary path: a record whose filename
    // drifted off its own tail is still keyed on the frontmatter `id:`.
    const { ShortUlidCollisionError, scanShortUlidCollision } = await importAcPrefix();
    const specsDir = makeScanDir();
    try {
      writeRecord(join(specsDir, "frs", "archive"), `${TAIL_THIRD}.md`, ULID_DUP_A);
      await expect(
        scanShortUlidCollision(specsDir, NEW_MODE_NONE_SPEC),
      ).rejects.toBeInstanceOf(ShortUlidCollisionError);
    } finally {
      rmSync(specsDir, { recursive: true, force: true });
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-STE-424.5 — the two prose over-claims
// ═══════════════════════════════════════════════════════════════════════════

const specWriteSkillPath = join(PLUGIN_ROOT, "skills", "spec-write", "SKILL.md");
const gateCheckSkillPath = join(PLUGIN_ROOT, "skills", "gate-check", "SKILL.md");
const ste417Path = join(REPO_ROOT, "specs", "frs", "archive", "STE-417.md");

const read = (path: string): string => readFileSync(path, "utf-8");

/** The single blank-line-delimited paragraph carrying `marker`. */
function paragraphWith(body: string, marker: string): string {
  const hits = body.split(/\n\s*\n/).filter((p) => p.includes(marker));
  expect(hits.length).toBe(1);
  return hits[0]!;
}

describe("AC-STE-424.5 — /spec-write no longer claims the minted id is collision-proof by construction", () => {
  const guard = (): string =>
    paragraphWith(read(specWriteSkillPath), "**Milestone-number allocation guard.**");

  test("the retired over-claim is GONE (tripwire)", () => {
    // Two existence checks over one checkout detect a collision; they cannot
    // prevent one, and across two unpushed branches they see nothing at all.
    expect(read(specWriteSkillPath)).not.toContain("collision-guarded by construction");
  });

  test("the replacement scopes the guarantee to one working tree and calls it detection", () => {
    const p = guard();
    expect(p).toContain("within one working tree");
    expect(p).toMatch(/detect/i);
  });

  test("the surrounding bypass clause survives byte-unchanged", () => {
    expect(guard()).toContain("no scan, no fetch, no five-source collision refusal");
  });

  test("the Jira Epic-first claim is NOT collateral damage — it is key-derived and stays", () => {
    // A tracker-allocated key really is unique by construction; only the
    // 6-char-tail claim was false. Over-correcting here would be a regression.
    expect(guard()).toContain("collision-free by construction (no scan, no lock, no retry)");
  });

  test("the guard is still ONE paragraph and the file is still within the line cap", () => {
    // `tests/m115-ste-417-docs-pins.test.ts` reads this paragraph through the
    // same single-hit split, and `tests/skill-nfr-1-length.test.ts` caps the
    // file at 358 lines — which it already occupies exactly. The correction
    // must be made IN PLACE.
    guard(); // paragraphWith asserts exactly one hit
    expect(read(specWriteSkillPath).split("\n").length).toBeLessThanOrEqual(358);
  });

  test("the correction adds no tracker-ID token (the skills/ ceiling has zero headroom)", () => {
    const p = guard();
    expect(p).not.toMatch(/\bAC-STE-\d+/);
    expect(p).not.toMatch(/\bSTE-\d+/);
  });
});

describe("AC-STE-424.5 — the archived milestone FR no longer claims mints cannot collide", () => {
  test("the retired over-claim is GONE (tripwire)", () => {
    expect(read(ste417Path)).not.toContain("cannot collide by construction");
  });

  test("the replacement scopes the guarantee to one working tree and calls it detection", () => {
    const summary = paragraphWith(read(ste417Path), "This milestone stops allocating that number");
    expect(summary).toContain("within one working tree");
    expect(summary).toMatch(/detect/i);
  });

  test("the rest of that paragraph's claims survive", () => {
    const summary = paragraphWith(read(ste417Path), "This milestone stops allocating that number");
    expect(summary).toContain("no migration, no rewriting of shipped release history");
  });
});

describe("AC-STE-424.2 — gate-check SKILL.md stops claiming probe #13 excludes the archive", () => {
  test("the probe #13 row no longer says `archive excluded`", () => {
    const row = read(gateCheckSkillPath)
      .split("\n")
      .find((l) => /^13\.\s/.test(l));
    expect(row).toBeDefined();
    expect(row!).not.toContain("archive excluded");
  });

  test("the probe #13 row names the archive-spanning duplicate pass", () => {
    const row = read(gateCheckSkillPath)
      .split("\n")
      .find((l) => /^13\.\s/.test(l));
    expect(row!).toMatch(/archive/);
    expect(row!).toMatch(/duplicat/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// M116 added no probe of its own — both checks land in the EXISTING probes
// ═══════════════════════════════════════════════════════════════════════════

describe("STE-424 — the probe count tracks the live total", () => {
  test("gate-check SKILL.md enumerates exactly 74 probes, contiguous", () => {
    // STE-424 deliberately spent no probe number: a new probe ripples to ~26
    // pinned count sites across README.md, skills/gate-check/SKILL.md and five
    // test files, and both of this FR's checks belong to probes #13 and #73,
    // which already walk the trees they need.
    //
    // The number below is therefore NOT an M116 freeze — it is the live total,
    // which M118 moved 73 → 74 when it added #74 `claudemd_probe_managed_guard`.
    // A later milestone that spends a probe number bumps this literal along
    // with the other pinned sites; that is the intended cost, not a regression.
    const numbers = [...read(gateCheckSkillPath).matchAll(/^(\d+)\. \*\*/gm)].map((m) =>
      Number(m[1]),
    );
    expect(numbers.length).toBe(74);
    expect(Math.max(...numbers)).toBe(74);
  });
});
