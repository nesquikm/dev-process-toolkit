// M138 STE-538 — `/spec-write` ADOPTS the identity `/setup` already minted for
// the bootstrap plan instead of minting a second one.
//
// THE DEFECT (measured against this tree, after STE-537 shipped). `/setup` step
// 8 under `mode: none` now mints a milestone identity and writes the bootstrap
// plan at `specs/plan/M_<tail>.md`, recording the full `fr_`-prefixed value as
// `id:`. `/spec-write`'s tracker-less branch then minted AGAIN, and
// `consumeScaffoldPlan` renamed that plan from one opaque name to another and
// overwrote the recorded id with the second one. Two mints, one milestone.
//
// WHY THE GUARD IS A CALL COUNT AND NOT AN INSPECTION. Both mints produce a
// well-formed `M_<6-char Crockford>` filename carrying a well-formed `id:` the
// filename derives from, so the survivor is self-consistent either way and probe
// #73 reports clean on both. The second mint leaves NO trace in the outcome. The
// only falsifiable form of "it minted once" is a counter on an injected double,
// and every zero on that counter in this file is paired with a non-zero on the
// same double and the same harness.
//
// THE TRAP THIS FR HAD TO DISARM. An adopted identity makes `to`
// (`consume_scaffold_plan.ts`) the scaffold ITSELF, which walks straight into
// the "target already exists" refusal — the guard that exists to protect a plan
// would refuse the very file it is protecting. Adoption therefore branches on
// `from === to` and rewrites in place. An off-canonical scaffold still takes the
// rename leg, because its name is not the name the adopted id derives.
//
// AC map:
//   AC-STE-538.1 — module-level, in `adapters/_shared/src/adopt_or_mint_milestone_id.test.ts`
//   AC-STE-538.2 — no rename, body byte-identical, the clobber guard not tripped
//   AC-STE-538.3 — `kind:` dropped, `milestone:` rewritten, `id:` untouched
//   AC-STE-538.4 — tracker mode never adopts; a scaffold with no `id:` mints
//   AC-STE-538.5 — one active plan, ONE mint, across setup → spec-write
//   AC-STE-538.6 — STE-481's two recorded-but-untested refusals
//   AC-STE-538.7 — the `findScaffoldPlan` / probe #73 filename asymmetry

import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";
import {
  consumeScaffoldPlan,
  findScaffoldPlan,
} from "../adapters/_shared/src/consume_scaffold_plan";
import { splitFrontmatter } from "../adapters/_shared/src/frontmatter";
import {
  PLAN_FILENAME_RE,
  milestoneIdFromLinearMilestone,
  milestoneIdFromUlid,
} from "../adapters/_shared/src/milestone_token";
import { mintMilestoneId } from "../adapters/_shared/src/mint_milestone_id";
import { runPlanIdentityModeConditionalProbe } from "../adapters/_shared/src/plan_identity_mode_conditional";
import {
  resolveMilestoneIdentity,
  type MilestoneIdentity,
  type ResolveMilestoneIdentityInput,
} from "../adapters/_shared/src/resolve_milestone_identity";
import { ULID_REGEX } from "../adapters/_shared/src/ulid";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const SHARED_SRC = join(PLUGIN_ROOT, "adapters", "_shared", "src");
const ADOPT_SRC = join(SHARED_SRC, "adopt_or_mint_milestone_id.ts");
const CONSUME_SRC = join(SHARED_SRC, "consume_scaffold_plan.ts");
const SPEC_WRITE_SKILL = join(PLUGIN_ROOT, "skills", "spec-write", "SKILL.md");

const read = (path: string): string => readFileSync(path, "utf-8");

// ───────────────────────────────────────────────────────────────────────────
// The new module, loaded dynamically so a missing file reports the CONTRACT.
// ───────────────────────────────────────────────────────────────────────────

interface MintedMilestoneId {
  id: string;
  milestoneId: string;
}

type MilestoneMinter = (specsDir: string) => MintedMilestoneId;

interface AdoptModule {
  adoptOrMintMilestoneId(specsDir: string, mint?: MilestoneMinter): MintedMilestoneId;
}

async function loadAdoptModule(): Promise<AdoptModule> {
  if (!existsSync(ADOPT_SRC)) {
    throw new Error(
      `${relative(REPO_ROOT, ADOPT_SRC)} does not exist — /spec-write's tracker-less branch has ` +
        `nothing to adopt WITH, so it mints a second identity over the one /setup already ` +
        `recorded on the bootstrap plan.`,
    );
  }
  const mod = (await import(ADOPT_SRC)) as Partial<AdoptModule>;
  if (typeof mod.adoptOrMintMilestoneId !== "function") {
    throw new Error(`${relative(REPO_ROOT, ADOPT_SRC)} does not export adoptOrMintMilestoneId()`);
  }
  return mod as AdoptModule;
}

/**
 * `resolveMilestoneIdentity`'s input with the minter seam STE-538 adds beside
 * the existing `provider` / `branchScanner` seams. Typed as an intersection so
 * this file compiles both before and after the key lands on the shipped
 * interface — the RED it produces must come from BEHAVIOUR, not from a type.
 */
type ResolveInput = ResolveMilestoneIdentityInput & { minter?: MilestoneMinter };

const resolve = (input: ResolveInput): Promise<MilestoneIdentity> =>
  resolveMilestoneIdentity(input as ResolveMilestoneIdentityInput);

// ───────────────────────────────────────────────────────────────────────────
// Fixtures — real temporary projects, exactly as the STE-481 fixtures build them
// ───────────────────────────────────────────────────────────────────────────

/** A well-formed minted id and the `M_<tail>` token it derives. */
const FIXTURE_ID = "fr_01K9ZQ8XJ4VDTAF4VDTAF4VDTA";
const FIXTURE_TOKEN = "M_F4VDTA";

/** The `M_<6-char Crockford tail>` shape `milestoneIdFromUlid` derives. */
const MINTED_PLAN_RE = /^M_[0-9A-HJKMNP-TV-Z]{6}\.md$/;

/** Two lines only `/setup` step 8 could have written into the scaffold body. */
const SEEDED_MARKER = "verify: bun test src/barrel.test.ts";
const BOOTSTRAP_ROW =
  "| <scaffolding> | Bootstrap (barrel + primary feature shipped pre-toolkit) | n/a |";

interface Project {
  root: string;
  specsDir: string;
  planDir: string;
  cleanup: () => void;
}

function makeProject(mode: "none" | "linear" | "jira" = "none"): Project {
  const root = mkdtempSync(join(tmpdir(), "ste538-adopt-"));
  const specsDir = join(root, "specs");
  const planDir = join(specsDir, "plan");
  mkdirSync(join(planDir, "archive"), { recursive: true });
  writeFileSync(join(root, "CLAUDE.md"), `# Fixture project\n\n## Task Tracking\n\nmode: ${mode}\n`);
  return { root, specsDir, planDir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/**
 * The bytes STE-537's `/setup` step 8 leaves behind. `frontmatter` is taken
 * verbatim so the AC.3 fixture can control key ORDER and spacing, which are
 * exactly what its assertions are about.
 */
function scaffoldSource(frontmatter: string[]): string {
  return [
    "---",
    ...frontmatter,
    "---",
    "",
    "# Implementation Plan",
    "",
    "## Foundation / Scaffolding",
    "",
    "**Goal:** bootstrap the detected stack.",
    "",
    "| FR | Title | Tracker |",
    "|----|-------|---------|",
    BOOTSTRAP_ROW,
    "",
    "**Tasks:**",
    "- [ ] Land the barrel",
    `  ${SEEDED_MARKER}`,
    "",
    "**Gate:** `bun test`",
    "",
  ].join("\n");
}

/** The default STE-537 scaffold frontmatter for a given token + id. */
function scaffoldFrontmatter(milestoneId: string, id?: string): string[] {
  const fm = [`milestone: ${milestoneId}`, "status: active", "archived_at: null"];
  if (id !== undefined) fm.push(`id: ${id}`);
  fm.push("kind: scaffolding");
  return fm;
}

function mintedPlanSource(identity: MilestoneIdentity): string {
  return [
    "---",
    `milestone: ${identity.milestoneId}`,
    "status: active",
    "archived_at: null",
    `id: ${identity.id}`,
    "---",
    "",
    `# ${identity.milestoneId} — Fresh milestone`,
    "",
  ].join("\n");
}

/**
 * Every ACTIVE plan file. `archive/` is a DIRECTORY entry in the same listing,
 * so it is filtered by extension rather than by name — a name filter would also
 * drop a stray directory that mattered.
 */
function activePlanFiles(specsDir: string): string[] {
  return readdirSync(join(specsDir, "plan"))
    .filter((n) => n.endsWith(".md"))
    .sort();
}

interface CountingMinter extends MilestoneMinter {
  calls: number;
}

/**
 * A REAL minter wrapping `mintMilestoneId`, carrying a call counter. Not a stub
 * returning a canned value: a stub decouples the returned id from the collision
 * guard the real minter owns, and would let a "mints fresh" leg pass on code
 * that never consulted `specsDir`.
 */
function countingMinter(): CountingMinter {
  const fn = ((specsDir: string) => {
    fn.calls += 1;
    return mintMilestoneId(specsDir);
  }) as CountingMinter;
  fn.calls = 0;
  return fn;
}

function fmLines(raw: string): string[] {
  const split = splitFrontmatter(raw);
  if (split === null) throw new Error("fixture has no well-formed frontmatter block");
  return split.lines;
}

// ═══════════════════════════════════════════════════════════════════════════
// AC-STE-538.2 — the adoption path renames nothing and preserves the body
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-STE-538.2 — adoption rewrites in place: no rename, body byte-identical", () => {
  test("the canonical STE-537 scaffold is consumed IN PLACE — `from === to`, one filename before and after", async () => {
    const project = makeProject("none");
    try {
      const name = `${FIXTURE_TOKEN}.md`;
      const path = join(project.planDir, name);
      const raw = scaffoldSource(scaffoldFrontmatter(FIXTURE_TOKEN, FIXTURE_ID));
      writeFileSync(path, raw);

      // PRE-STATE, asserted so the post-state listing is a COMPARISON and not a
      // lone snapshot that would read the same on a delete-and-recreate.
      expect(activePlanFiles(project.specsDir)).toEqual([name]);

      const identity = await resolve({ specsDir: project.specsDir, mode: "none" });
      // The identity is the scaffold's own — that is what makes `to` the
      // scaffold and puts the clobber guard in the way.
      expect(identity.id).toBe(FIXTURE_ID);
      expect(identity.milestoneId).toBe(FIXTURE_TOKEN);

      const outcome = consumeScaffoldPlan(project.specsDir, identity);

      expect(outcome.consumed).toBe(true);
      expect(outcome.from).toBe(outcome.to);
      expect(outcome.to).toBe(path);
      expect(activePlanFiles(project.specsDir)).toEqual([name]);

      // Byte comparison of the WHOLE remainder. A `toContain` on the seeded
      // marker passes on a delete-and-rewrite that happens to reproduce it.
      const after = read(path);
      expect(splitFrontmatter(after)!.rest).toBe(splitFrontmatter(raw)!.rest);
      // Non-vacuity: the remainder is not the empty string.
      expect(splitFrontmatter(raw)!.rest).toContain(SEEDED_MARKER);
      expect(splitFrontmatter(raw)!.rest).toContain(BOOTSTRAP_ROW);
    } finally {
      project.cleanup();
    }
  });

  test("FALSIFICATION CONTROL — the same body pin passes on the M1.md fixture, which DOES rename", async () => {
    // The body assertion above must not be an artefact of the no-rename branch:
    // preservation is promised on both legs. What separates the two legs is
    // `from === to`, which is red here — so the no-rename pin carries its own
    // weight rather than riding on the body pin.
    const project = makeProject("none");
    try {
      const from = join(project.planDir, "M1.md");
      const raw = scaffoldSource(scaffoldFrontmatter("M1", FIXTURE_ID));
      writeFileSync(from, raw);

      const identity = await resolve({ specsDir: project.specsDir, mode: "none" });
      expect(identity.id).toBe(FIXTURE_ID);

      const outcome = consumeScaffoldPlan(project.specsDir, identity);

      expect(outcome.consumed).toBe(true);
      expect(outcome.from).not.toBe(outcome.to);
      expect(basename(outcome.to)).toBe(`${FIXTURE_TOKEN}.md`);
      expect(existsSync(from)).toBe(false);
      // The body pin — identical assertion, other leg.
      expect(splitFrontmatter(read(outcome.to))!.rest).toBe(splitFrontmatter(raw)!.rest);
    } finally {
      project.cleanup();
    }
  });

  test("adoption resolves BEFORE the destination guard — the guard never refuses the file it protects", async () => {
    // Today's `consumeScaffoldPlan` throws when `to` already exists. With the
    // scaffold already carrying its final name, an adopted identity makes `to`
    // that very file. This leg is the direct statement of the trap: the call
    // must not throw, and it must not leave the scaffold half-rewritten.
    const project = makeProject("none");
    try {
      const path = join(project.planDir, `${FIXTURE_TOKEN}.md`);
      writeFileSync(path, scaffoldSource(scaffoldFrontmatter(FIXTURE_TOKEN, FIXTURE_ID)));

      const identity = await resolve({ specsDir: project.specsDir, mode: "none" });
      expect(() => consumeScaffoldPlan(project.specsDir, identity)).not.toThrow();
      expect(existsSync(path)).toBe(true);
    } finally {
      project.cleanup();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-STE-538.3 — `kind:` dropped, `milestone:` rewritten, `id:` untouched
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The AC.3 fixture. Three deliberate deformations, each load-bearing:
 *   - `milestone: M_STALE1` is STALE, so the `milestone:` half is falsifiable —
 *     `to` derives from the adopted `id:`, never from this line, and a fixture
 *     already reading `M_F4VDTA` would satisfy the assertion whether or not the
 *     rewrite ran.
 *   - `id:` is LAST in the block, and
 *   - it is written with TWO spaces after the colon.
 * The last two together make "untouched" mutation-sensitive: today's
 * `rewriteConsumedFrontmatter` drops the line and re-inserts a normalised
 * `id: <id>` immediately after `milestone:`, which both moves it off the end and
 * eats the second space.
 */
const AC3_ID_LINE = `id:  ${FIXTURE_ID}`;
const AC3_FRONTMATTER = [
  "milestone: M_STALE1",
  "status: active",
  "archived_at: null",
  "kind: scaffolding",
  AC3_ID_LINE,
];

describe("AC-STE-538.3 — the in-place rewrite drops `kind:`, rewrites `milestone:`, leaves `id:` alone", () => {
  test("post-call frontmatter: no kind:, milestone: retargeted, id: byte-identical and still last", async () => {
    const project = makeProject("none");
    try {
      const path = join(project.planDir, `${FIXTURE_TOKEN}.md`);
      const raw = scaffoldSource(AC3_FRONTMATTER);
      writeFileSync(path, raw);

      // PRE-CALL CONTROLS. Without the first, the absence assertion below is
      // vacuous; without the second, "still last" is a claim about nothing.
      const before = fmLines(raw);
      expect(before.some((l) => /^kind:/.test(l))).toBe(true);
      expect(before.at(-1)).toBe(AC3_ID_LINE);
      expect(before.some((l) => l === "milestone: M_STALE1")).toBe(true);

      const identity = await resolve({ specsDir: project.specsDir, mode: "none" });
      expect(identity.milestoneId).toBe(FIXTURE_TOKEN);
      const outcome = consumeScaffoldPlan(project.specsDir, identity);
      expect(outcome.from).toBe(outcome.to);

      const after = fmLines(read(outcome.to));
      expect(after.some((l) => /^kind:/.test(l))).toBe(false);
      expect(after.find((l) => /^milestone:/.test(l))).toBe(`milestone: ${FIXTURE_TOKEN}`);
      // NOT an absolute index: dropping `kind:` shifts every later line up one,
      // so an index pin could never pass. Last position + byte equality is the
      // form that survives the shift and still catches the normalising rewrite.
      expect(after.at(-1)).toBe(AC3_ID_LINE);
    } finally {
      project.cleanup();
    }
  });

  test("MUTATION CONTROL — routed through the RENAME leg, that exact assertion goes red", async () => {
    // The same frontmatter, on a file named `M1.md` so the adopted id does not
    // name it and the rename leg runs `rewriteConsumedFrontmatter`. This is the
    // pre-STE-538 code path, executed for real: it proves the pin above
    // distinguishes the in-place branch from the normalising rewrite, rather
    // than passing on both.
    const project = makeProject("none");
    try {
      const from = join(project.planDir, "M1.md");
      writeFileSync(from, scaffoldSource(AC3_FRONTMATTER));

      const identity = await resolve({ specsDir: project.specsDir, mode: "none" });
      const outcome = consumeScaffoldPlan(project.specsDir, identity);
      expect(outcome.from).not.toBe(outcome.to);

      const after = fmLines(read(outcome.to));
      // The rewrite normalises the spacing and moves the key off the end.
      expect(after.at(-1)).not.toBe(AC3_ID_LINE);
      expect(after).toContain(`id: ${FIXTURE_ID}`);
      expect(after).not.toContain(AC3_ID_LINE);
      // Both legs agree on the other two edits — the difference is `id:` alone.
      expect(after.some((l) => /^kind:/.test(l))).toBe(false);
      expect(after.find((l) => /^milestone:/.test(l))).toBe(`milestone: ${FIXTURE_TOKEN}`);
    } finally {
      project.cleanup();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-STE-538.4 — tracker mode never adopts; a scaffold with no id: mints fresh
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-STE-538.4 — the adoption path is `mode: none` only, and needs a recorded id:", () => {
  test("linear and jira never adopt (calls === 0), and the SAME double records 1 on the mode:none control", async () => {
    const double = countingMinter();

    // ── Leg 1: mode: linear. ───────────────────────────────────────────────
    //
    // RETARGETED (M139/STE-541, AC-STE-541.6). This leg resolved a linear
    // identity with no provider and asserted a sequential `/^M\d+$/` token.
    // THE BEHAVIOURAL CHANGE: `mode: linear` no longer resolves an identity
    // OFFLINE — the sequential scan needed no tracker, whereas
    // `mintMilestoneLinear` requires a provider carrying the milestone-create
    // op, because an identity derived from a tracker object cannot be computed
    // without the tracker. The leg is retargeted onto the NEW contract (a
    // create-carrying provider, and the tracker's own derivation) rather than
    // deleted: the CLAIM it exists for — the tracker branches never adopt, and
    // never carry an `id` key — is unchanged and still needs guarding.
    const linear = makeProject("linear");
    try {
      writeFileSync(
        join(linear.planDir, "M1.md"),
        scaffoldSource(scaffoldFrontmatter("M1", FIXTURE_ID)),
      );
      const before = read(join(linear.planDir, "M1.md"));

      const linearUuid = "550e8400-e29b-41d4-a716-446655440000";
      const identity = await resolve({
        specsDir: linear.specsDir,
        mode: "linear",
        project: "DPT",
        title: "Tracker-First Linear Milestones",
        provider: {
          createMilestone: async (_project: string, _opts: { name: string }) => ({
            id: linearUuid,
          }),
        },
        minter: double,
      });

      // The KEY must be absent, not merely undefined: probe #73 fails a
      // tracker-mode plan carrying an `id:` line, and `consumeScaffoldPlan`'s
      // structural rail is keyed on the key's presence.
      expect("id" in identity).toBe(false);
      // REPLACES the sequential-token pin: the id is the tracker's answer,
      // derived by the mint, and is NOT the sequential shape it used to be.
      expect(identity.milestoneId).toBe(milestoneIdFromLinearMilestone(linearUuid));
      expect(identity.milestoneId).not.toMatch(/^M\d+$/);

      const outcome = consumeScaffoldPlan(linear.specsDir, identity);
      expect(outcome.consumed).toBe(false);
      expect(outcome.from).toBeNull();
      expect(read(join(linear.planDir, "M1.md"))).toBe(before);
      expect(double.calls).toBe(0);
    } finally {
      linear.cleanup();
    }

    // ── Leg 2: mode: jira. `epicKey` is mandatory — the branch routes through
    // `milestoneIdFromEpicKey(input.epicKey ?? "")`, which REFUSES an empty key
    // and would throw instead of resolving. ────────────────────────────────
    const jira = makeProject("jira");
    try {
      writeFileSync(
        join(jira.planDir, "M1.md"),
        scaffoldSource(scaffoldFrontmatter("M1", FIXTURE_ID)),
      );
      const before = read(join(jira.planDir, "M1.md"));

      const identity = await resolve({
        specsDir: jira.specsDir,
        mode: "jira",
        epicKey: "DST-49",
        minter: double,
      });

      expect("id" in identity).toBe(false);
      expect(identity.milestoneId).toBe("M_DST_49");

      const outcome = consumeScaffoldPlan(jira.specsDir, identity);
      expect(outcome.consumed).toBe(false);
      expect(outcome.from).toBeNull();
      expect(read(join(jira.planDir, "M1.md"))).toBe(before);
      expect(double.calls).toBe(0);
    } finally {
      jira.cleanup();
    }

    // ── Leg 3: the POSITIVE CONTROL for both zeros. Same double, same fixture
    // shape, `mode: none`, scaffold stripped of its `id:` so adoption cannot
    // fire. Without this leg a zero proves only that nothing ran. ───────────
    const none = makeProject("none");
    try {
      writeFileSync(
        join(none.planDir, "M1.md"),
        scaffoldSource(scaffoldFrontmatter("M1", undefined)),
      );

      const identity = await resolve({ specsDir: none.specsDir, mode: "none", minter: double });

      expect(identity.id).toMatch(ULID_REGEX);
      expect(double.calls).toBe(1);
    } finally {
      none.cleanup();
    }
  });

  test("a `kind: scaffolding` plan carrying NO id: mints fresh, and the minted id matches nothing on disk", async () => {
    const mod = await loadAdoptModule();
    const double = countingMinter();
    const project = makeProject("none");
    try {
      const path = join(project.planDir, `${FIXTURE_TOKEN}.md`);
      const raw = scaffoldSource(scaffoldFrontmatter(FIXTURE_TOKEN, undefined));
      writeFileSync(path, raw);
      // Non-vacuity: the scaffold IS eligible on every axis except the id:.
      expect(raw).toContain("kind: scaffolding");
      expect(raw).not.toContain("id:");
      expect(findScaffoldPlan(project.specsDir)).toBe(path);

      const result = mod.adoptOrMintMilestoneId(project.specsDir, double);

      expect(double.calls).toBe(1);
      expect(result.id).toMatch(ULID_REGEX);
      expect(result.milestoneId).toBe(milestoneIdFromUlid(result.id));
      // It equals no id recorded anywhere under specs/plan/**.
      const recorded = readdirSync(project.planDir)
        .filter((n) => n.endsWith(".md"))
        .flatMap((n) => read(join(project.planDir, n)).split("\n"))
        .flatMap((line) => {
          const m = /^id:\s*(\S+)/.exec(line);
          return m === null ? [] : [m[1]!];
        });
      expect(recorded).not.toContain(result.id);
    } finally {
      project.cleanup();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-STE-538.5 — setup → spec-write: one active plan, exactly ONE mint
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-STE-538.5 — `/setup` then `/spec-write` under `mode: none` mints exactly once", () => {
  test("one active minted plan survives, the double records ONE call, and probe #73 is clean", async () => {
    const double = countingMinter();
    const project = makeProject("none");
    try {
      // ── SETUP LEG — STE-537 step 8: mint, then write the scaffold at the
      // name that mint derives, recording the id verbatim. ─────────────────
      const setupIdentity = double(project.specsDir);
      const scaffoldName = `${setupIdentity.milestoneId}.md`;
      const setupRaw = scaffoldSource(
        scaffoldFrontmatter(setupIdentity.milestoneId, setupIdentity.id),
      );
      writeFileSync(join(project.planDir, scaffoldName), setupRaw);
      expect(double.calls).toBe(1);
      // CONTROL for the `kind:` absence asserted after: it is here to begin with.
      expect(fmLines(setupRaw).some((l) => /^kind:/.test(l))).toBe(true);

      // ── SPEC-WRITE LEG — the real allocation gate, threaded with the SAME
      // double so a second mint is countable. ──────────────────────────────
      const identity = await resolve({
        specsDir: project.specsDir,
        mode: "none",
        minter: double,
      });
      // What these two assertions DO witness: the spec-write leg returned the
      // SCAFFOLD'S OWN identity, so it adopted rather than minted. That is what
      // gives `calls === 1` below its meaning.
      //
      // What they do NOT witness, stated plainly because an earlier version of
      // this comment claimed it and the claim was measured false: they are not
      // the non-vacuity guard for the `minter` seam. Adoption never reaches the
      // minter on either side of that seam, so deleting `minter: double` from
      // the call above leaves BOTH of these assertions — and `calls === 1` —
      // green. Verified by mutation: unthreading the seam keeps this whole
      // describe at 2 pass / 0 fail. The seam's own wiring is proven where a
      // mint actually happens, by AC-STE-538.4's third leg, which threads the
      // same double through `resolveMilestoneIdentity` with the scaffold's
      // `id:` removed and records `calls === 1` on that mint.
      expect(identity.id).toBe(setupIdentity.id);
      expect(identity.milestoneId).toBe(setupIdentity.milestoneId);

      const outcome = consumeScaffoldPlan(project.specsDir, identity);
      if (!outcome.consumed) writeFileSync(outcome.to, mintedPlanSource(identity));

      const plans = activePlanFiles(project.specsDir);
      expect(plans).toHaveLength(1);
      expect(plans[0]!).toMatch(MINTED_PLAN_RE);
      // The survivor is the file /setup wrote, under the name /setup gave it.
      expect(plans[0]!).toBe(scaffoldName);
      expect(outcome.from).toBe(outcome.to);
      expect(double.calls).toBe(1);

      // Asserted DIRECTLY, never inferred from the probe's silence. Since
      // STE-537 the accumulator tests `kind:` FIRST, so a survivor still
      // declaring `kind: scaffolding` lands in `activeScaffolds` and leaves
      // `activeMintedPlans` EMPTY — and the unconsumed-scaffold pass is gated
      // on `activeMintedPlans.length > 0`, so it still would not fire. The
      // conclusion is unchanged either way (a zero here cannot certify that
      // `kind:` is gone); only which of the two lists ends up empty differs.
      const survivor = read(join(project.planDir, plans[0]!));
      expect(fmLines(survivor).some((l) => /^kind:/.test(l))).toBe(false);

      // The probe stands only for what it CAN prove: the survivor is a
      // well-formed minted plan whose filename derives from its recorded id.
      const report = await runPlanIdentityModeConditionalProbe(project.root);
      expect(report.mode).toBe("none");
      expect(report.violations.map((v) => v.note)).toEqual([]);
    } finally {
      project.cleanup();
    }
  });

  test("POSITIVE CONTROL — the pre-STE-538 double-mint records 2 calls and leaves 2 active plans", async () => {
    // The identical harness with the spec-write leg minting through the double
    // directly and writing beside the scaffold — the shape this FR removes.
    // Both of AC.5's count assertions are therefore proven able to fail on this
    // exact fixture, rather than merely observed passing on it.
    const double = countingMinter();
    const project = makeProject("none");
    try {
      const setupIdentity = double(project.specsDir);
      writeFileSync(
        join(project.planDir, `${setupIdentity.milestoneId}.md`),
        scaffoldSource(scaffoldFrontmatter(setupIdentity.milestoneId, setupIdentity.id)),
      );

      const second = double(project.specsDir);
      writeFileSync(join(project.planDir, `${second.milestoneId}.md`), mintedPlanSource(second));

      const plans = activePlanFiles(project.specsDir);
      expect(double.calls).toBe(2);
      expect(plans).toHaveLength(2);
      // And the state is exactly the one probe #73's unconsumed-scaffold pass
      // was built for — evidence the control models the real defect.
      const report = await runPlanIdentityModeConditionalProbe(project.root);
      expect(report.violations.map((v) => v.note).join("\n")).toMatch(/scaffolding/);
    } finally {
      project.cleanup();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-STE-538.6 — STE-481's two recorded-but-untested refusals
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-STE-538.6 — the multi-scaffold refusal, asserted on its own message", () => {
  test("two active `kind: scaffolding` plans refuse through all three entry points, and neither file is touched", async () => {
    const mod = await loadAdoptModule();
    const project = makeProject("none");
    try {
      const first = join(project.planDir, "M1.md");
      const second = join(project.planDir, "M2.md");
      const firstRaw = scaffoldSource(scaffoldFrontmatter("M1", FIXTURE_ID));
      const secondRaw = scaffoldSource(scaffoldFrontmatter("M2", undefined));
      writeFileSync(first, firstRaw);
      writeFileSync(second, secondRaw);

      const refusal = /2 active plans declare kind: scaffolding/;
      expect(() => findScaffoldPlan(project.specsDir)).toThrow(refusal);
      expect(() =>
        consumeScaffoldPlan(project.specsDir, {
          milestoneId: FIXTURE_TOKEN,
          id: FIXTURE_ID,
        }),
      ).toThrow(refusal);
      // The new caller INHERITS the refusal — it needs its own leg, because a
      // module that swallowed the throw and minted instead would leave both
      // scaffolds behind and look successful.
      expect(() => mod.adoptOrMintMilestoneId(project.specsDir, countingMinter())).toThrow(refusal);

      // A refusal that half-consumed would still satisfy a bare `.toThrow()`.
      expect(read(first)).toBe(firstRaw);
      expect(read(second)).toBe(secondRaw);
      expect(activePlanFiles(project.specsDir)).toEqual(["M1.md", "M2.md"]);
    } finally {
      project.cleanup();
    }
  });

  test("a scaffold with NO frontmatter block refuses on its own message and is left byte-unchanged", async () => {
    // This refusal is reachable ONLY because of a regex asymmetry, and the
    // fixture has to be built from it: `parseFrontmatter` matches through
    // `FRONTMATTER_RE`, which carries `/m` and so finds a block opening on ANY
    // line, while `splitFrontmatter`'s `FM_SPLIT_RE` is anchored at offset 0. A
    // plan whose frontmatter is preceded by one blank line therefore HAS a
    // readable `kind:` and NO writable block.
    const project = makeProject("none");
    try {
      const path = join(project.planDir, "M1.md");
      const raw = `\n${scaffoldSource(scaffoldFrontmatter("M1", FIXTURE_ID))}`;
      writeFileSync(path, raw);
      // The asymmetry itself, asserted rather than assumed.
      expect(splitFrontmatter(raw)).toBeNull();

      // Without this the throw test would pass vacuously on a file that was
      // never a consumption candidate at all.
      expect(findScaffoldPlan(project.specsDir)).toBe(path);

      expect(() =>
        consumeScaffoldPlan(project.specsDir, { milestoneId: FIXTURE_TOKEN, id: FIXTURE_ID }),
      ).toThrow(/has no YAML frontmatter block to record the minted id/);

      expect(read(path)).toBe(raw);
      expect(activePlanFiles(project.specsDir)).toEqual(["M1.md"]);
    } finally {
      project.cleanup();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-STE-538.7 — the `findScaffoldPlan` / probe #73 filename asymmetry
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-STE-538.7 — an off-canonical scaffold is renamed onto the canonical name probe #73 walks", () => {
  test("bootstrap-plan.md is found, adopted, RENAMED, and the survivor is then visible to probe #73", async () => {
    const mod = await loadAdoptModule();
    const project = makeProject("none");
    try {
      const oldPath = join(project.planDir, "bootstrap-plan.md");
      writeFileSync(oldPath, scaffoldSource(scaffoldFrontmatter("M_STALE1", FIXTURE_ID)));

      // The name really is one probe #73's walk rejects — this is what makes
      // the file invisible to it, and the whole reason the asymmetry exists.
      expect(PLAN_FILENAME_RE.test("bootstrap-plan.md")).toBe(false);
      expect(existsSync(oldPath)).toBe(true);
      // And it is exactly the line that proves the broad `*.md` filter in
      // `findScaffoldPlan` is load-bearing: narrowing it to `PLAN_FILENAME_RE`
      // reddens here and nowhere else.
      expect(findScaffoldPlan(project.specsDir)).toBe(oldPath);

      const adopted = mod.adoptOrMintMilestoneId(project.specsDir, countingMinter());
      expect(adopted.id).toBe(FIXTURE_ID);

      const identity = await resolve({ specsDir: project.specsDir, mode: "none" });
      const outcome = consumeScaffoldPlan(project.specsDir, identity);

      // The off-canonical name is NOT the name the adopted id derives, so this
      // leg renames — the `from === to` branch must not swallow it.
      expect(outcome.consumed).toBe(true);
      expect(outcome.from).not.toBe(outcome.to);
      expect(basename(outcome.to)).toBe(`${FIXTURE_TOKEN}.md`);
      expect(existsSync(oldPath)).toBe(false);
      expect(activePlanFiles(project.specsDir)).toEqual([`${FIXTURE_TOKEN}.md`]);

      // A zero-violation report is consistent with the probe never having
      // looked. The MUTATION is the assertion that it now does: malform the
      // survivor's id: and the probe must name that file.
      const survivor = outcome.to;
      writeFileSync(survivor, read(survivor).replace(/^id: .*$/m, "id: not-a-minted-id"));
      const report = await runPlanIdentityModeConditionalProbe(project.root);
      const notes = report.violations.map((v) => v.note);
      expect(notes.join("\n")).toContain(`${FIXTURE_TOKEN}.md`);
      expect(notes.length).toBeGreaterThan(0);
    } finally {
      project.cleanup();
    }
  });

  test("RESIDUAL — a LONE off-canonical scaffold stays invisible to probe #73; the same bytes under the canonical name are seen", async () => {
    // Invisibility, not cleanliness. Same fixture, same bytes, one rename apart:
    // the only variable is the filename, so the silence below is about the walk
    // filter and nothing else. This is the shape AC.7 records as remaining
    // unguarded — nothing consumes a scaffold that /spec-write never reaches.
    const project = makeProject("none");
    try {
      const oldPath = join(project.planDir, "bootstrap-plan.md");
      const raw = scaffoldSource([
        "milestone: M_STALE1",
        "status: active",
        "archived_at: null",
        "id: not-a-minted-id",
        "kind: scaffolding",
      ]);
      writeFileSync(oldPath, raw);

      const invisible = await runPlanIdentityModeConditionalProbe(project.root);
      expect(invisible.mode).toBe("none");
      expect(invisible.violations.map((v) => v.note)).toEqual([]);

      // Exactly those bytes, canonically named.
      const newPath = join(project.planDir, `${FIXTURE_TOKEN}.md`);
      renameSync(oldPath, newPath);
      expect(read(newPath)).toBe(raw);

      const seen = await runPlanIdentityModeConditionalProbe(project.root);
      expect(seen.violations.map((v) => v.note).join("\n")).toContain(`${FIXTURE_TOKEN}.md`);
    } finally {
      project.cleanup();
    }
  });

  test("the residual is RECORDED in `findScaffoldPlan`'s doc comment, cited by this grep so it cannot be deleted silently", () => {
    const src = read(CONSUME_SRC);
    const start = src.indexOf("/**\n * The ACTIVE plan under");
    const end = src.indexOf("export function findScaffoldPlan");
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const doc = src.slice(start, end);

    // Non-vacuity control: the half that already argues the broad filter is
    // there today, so the assertion below is about the NEW half alone.
    expect(doc).toContain("PLAN_FILENAME_RE");
    // The recorded residual: this walk is broader than probe #73's, so a lone
    // off-canonical scaffold is invisible to the probe.
    expect(doc).toContain("#73");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Shipped prose — `skills/spec-write/SKILL.md`'s allocation guard
// ═══════════════════════════════════════════════════════════════════════════

/** The single line that carries the whole milestone-allocation guard. */
function allocationGuard(): string {
  const line = read(SPEC_WRITE_SKILL)
    .split("\n")
    .find((l) => l.startsWith("**Milestone-number allocation guard.**"));
  if (line === undefined) throw new Error("the allocation guard paragraph is gone from SKILL.md");
  return line;
}

describe("STE-538 shipped prose — the guard describes adoption, and the three standing pins still hold", () => {
  test("the guard names the new module and its function", () => {
    const p = allocationGuard();
    expect(p).toContain("adoptOrMintMilestoneId");
    expect(p).toContain("adapters/_shared/src/adopt_or_mint_milestone_id.ts");
  });

  test("the two now-false claims are GONE", () => {
    // Both were true before STE-537/STE-538 and are false after: the route no
    // longer mints unconditionally, and on the adoption path it renames nothing.
    const p = allocationGuard();
    expect(p).not.toContain("mints the identity locally");
    expect(p).not.toContain("renames that scaffold in place");
  });

  test("REGRESSION — the m119 literal tripwires survive the edit", () => {
    // `adoptOrMintMilestoneId` clears the first of these on CASE alone
    // (`MintMilestoneId` ≠ `mintMilestoneId`) — a one-character margin, so
    // neither literal may enter this paragraph.
    const p = allocationGuard();
    expect(p).not.toContain("mintMilestoneId");
    expect(p).not.toContain("milestoneIdFromUlid");
    expect((p.match(/resolveMilestoneIdentity\(/g) ?? []).length).toBe(1);
  });

  test("REGRESSION — the m126 scaffold row survives the edit", () => {
    const p = allocationGuard();
    expect(p).toContain("consumeScaffoldPlan");
    expect(p).toContain("adapters/_shared/src/consume_scaffold_plan.ts");
    expect(p).toMatch(/scaffold/i);
  });

  test("REGRESSION — the edit adds no lines: the guard is still ONE line, and the file is under the NFR-1 cap", () => {
    const lines = read(SPEC_WRITE_SKILL).split("\n");
    expect(lines.filter((l) => l.startsWith("**Milestone-number allocation guard.**"))).toHaveLength(
      1,
    );
    expect(lines.length).toBeLessThanOrEqual(358);
  });
});
