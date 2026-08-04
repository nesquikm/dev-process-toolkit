// M119 STE-442 — `/upgrade` repair migration for mis-named `mode: none`
// milestone plans.
//
// Contract pinned by this file (specs/frs/STE-442.md):
//
//   adapters/_shared/src/migrations/entries/mode_none_sequential_milestone.ts
//     exports `modeNoneSequentialMilestone: MigrationEntry`, appended LAST to
//     MIGRATIONS (2.59.0 sorts after m104LegacyState's 2.46.0):
//
//       id:                        "mode-none-sequential-milestone"
//       introduced_in:             "2.59.0"      ← the SHIPPING version
//       kind:                      "script"
//       requires_explicit_approval: true
//       detect(projectRoot):       pure, sync, filesystem-only; one `evidence`
//                                  row per repairable plan
//       apply(projectRoot):        mint → rewrite bindings → rename, per plan;
//                                  shipped plans reported, never touched;
//                                  idempotent; all-or-nothing per plan
//
// THE VERSION TRAP (AC-STE-442.2). `index.ts`'s own prose defines
// `introduced_in` as "the release that made the legacy state legacy" — which
// here would be 2.56.0, the release that shipped minting. `coverage.ts`
// enforces something else entirely: `assertMigrationDeclared` refuses the
// release unless the declared entry's `introduced_in` EQUALS the version being
// shipped, and `runMigrationCoverageProbe` requires it to equal the archived
// plan's `shipped_in`. Every prior entry satisfies both readings because its
// migration shipped in the same release that created the legacy state; this is
// the first entry where they diverge. A value of 2.56.0 would pass every unit
// test in this file's AC-1 block and then refuse the release at ship time, so
// the value is pinned byte-for-byte AND driven through the enforcing surface.
//
// Fixture discipline (FR § Testing): real temporary project trees via
// mkdtempSync, never mocks — the repair spans filenames, frontmatter, and
// cross-file bindings, and a mock cannot prove those three moved together.

import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
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
import { dirname, join, relative } from "node:path";
import { assertMigrationDeclared } from "../adapters/_shared/src/migrations/coverage";
import { MIGRATIONS, validateRegistry, type MigrationEntry } from "../adapters/_shared/src/migrations/index";
import { milestoneIdFromUlid } from "../adapters/_shared/src/milestone_token";
import { ULID_REGEX } from "../adapters/_shared/src/ulid";

const ENTRY_ID = "mode-none-sequential-milestone";
const SHIPS_IN = "2.59.0";

const repoRoot = join(import.meta.dir, "..", "..", "..");
const entryModulePath = join(
  repoRoot,
  "plugins",
  "dev-process-toolkit",
  "adapters",
  "_shared",
  "src",
  "migrations",
  "entries",
  "mode_none_sequential_milestone.ts",
);
const upgradeSkill = join(repoRoot, "plugins", "dev-process-toolkit", "skills", "upgrade", "SKILL.md");
const m119Plan = join(repoRoot, "specs", "plan", "M119.md");

/** `M_` + a 6-char Crockford tail — the exact output range of `milestoneIdFromUlid`. */
const MINTED_PLAN_NAME_RE = /^M_[0-9A-HJKMNP-TV-Z]{6}\.md$/;

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const tmpRoots: string[] = [];

afterEach(() => {
  while (tmpRoots.length > 0) {
    const dir = tmpRoots.pop();
    if (dir === undefined || !existsSync(dir)) continue;
    // A partial-write fixture may have left `specs/plan` read-only; rmSync
    // cannot unlink through that, and a leaked chmod would strand the tree.
    const planDir = join(dir, "specs", "plan");
    if (existsSync(planDir)) chmodSync(planDir, 0o755);
    rmSync(dir, { recursive: true, force: true });
  }
});

/** An mkdtemp tree seeded from a `relpath → content` map. */
function makeTree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "ste-442-mode-none-"));
  tmpRoots.push(root);
  for (const [rel, body] of Object.entries(files)) {
    const full = join(root, ...rel.split("/"));
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body, "utf-8");
  }
  return root;
}

/** The canonical tracker-less declaration `/setup` emits (Schema L, `mode: none`). */
const MODE_NONE_CLAUDE_MD = "# Project\n\n## Task Tracking\n\nmode: none\n";
/** A tracker-mode declaration — the polarity that must never be repaired. */
const MODE_LINEAR_CLAUDE_MD = "# Project\n\n## Task Tracking\n\nmode: linear\nmcp_server: linear\n";

/**
 * A sequential milestone plan, shaped like the real `specs/plan/M<N>.md`:
 * no `id:` key (that is the defect), no `kind:` exemption.
 */
function plan(token: string, extraFrontmatter: string[] = []): string {
  return [
    "---",
    `milestone: ${token}`,
    "status: active",
    "archived_at: null",
    "kickoff_branch: null",
    "frozen_at: null",
    "migration: none",
    ...extraFrontmatter,
    "---",
    "",
    "# Implementation Plan",
    "",
    `## ${token} — Legacy Thing {#${token}}`,
    "",
    "**Goal:** something.",
    "",
  ].join("\n");
}

/** 20 fixed chars + a 6-char tail = a well-formed 26-char minted id body. */
const ulidWithTail = (tail: string): string => `fr_01HZ7XJFKP0000000000${tail}`;

/** A `mode: none` FR file bound to `token` via its `milestone:` frontmatter key. */
function fr(tail: string, token: string): string {
  return [
    "---",
    `id: ${ulidWithTail(tail)}`,
    `milestone: ${token}`,
    "status: active",
    "archived_at: null",
    "---",
    "",
    `# FR ${tail}`,
    "",
  ].join("\n");
}

/** Read a scalar frontmatter value, or null when the key is absent. */
function fmValue(content: string, key: string): string | null {
  if (!content.startsWith("---\n")) return null;
  const close = content.indexOf("\n---", 4);
  if (close < 0) return null;
  for (const line of content.slice(4, close).split("\n")) {
    const m = new RegExp(`^${key}\\s*:\\s*(.*)$`).exec(line);
    if (m) return (m[1] ?? "").trim();
  }
  return null;
}

const readFm = (root: string, rel: string, key: string): string | null =>
  fmValue(readFileSync(join(root, ...rel.split("/")), "utf-8"), key);

/** Recursive `relpath → content|<dir>` snapshot — the AC-6 / AC-7 evidence. */
function snapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const abs = join(dir, name);
      const rel = relative(root, abs);
      if (statSync(abs).isDirectory()) {
        out[rel] = "<dir>";
        walk(abs);
      } else {
        out[rel] = readFileSync(abs, "utf-8");
      }
    }
  };
  walk(root);
  return out;
}

/** The live registry entry under test — never a locally constructed stand-in. */
function liveEntry(): MigrationEntry {
  const entry = MIGRATIONS.find((e) => e.id === ENTRY_ID);
  if (entry === undefined) {
    throw new Error(`MIGRATIONS carries no entry "${ENTRY_ID}" — the registry entry is not registered`);
  }
  return entry;
}

/** The entry's `apply`, or a hard failure — `kind: "script"` guarantees it exists. */
function liveApply(root: string): { changed: string[]; summary: string } {
  const entry = liveEntry();
  if (typeof entry.apply !== "function") {
    throw new Error(`entry "${ENTRY_ID}" is kind "${entry.kind}" but carries no apply()`);
  }
  return entry.apply(root);
}

/**
 * The core fixture (FR § Testing): one UNSHIPPED mis-named plan, two active FRs
 * and one ARCHIVED FR bound to it, plus a control FR bound to a different
 * milestone that nothing may touch.
 */
function makeCoreFixture(): string {
  return makeTree({
    "CLAUDE.md": MODE_NONE_CLAUDE_MD,
    "specs/plan/M5.md": plan("M5"),
    "specs/frs/VDTAF4.md": fr("VDTAF4", "M5"),
    "specs/frs/BCDEF2.md": fr("BCDEF2", "M5"),
    "specs/frs/archive/GHJKM3.md": fr("GHJKM3", "M5"),
    "specs/frs/NPQRS4.md": fr("NPQRS4", "M7"),
  });
}

/** The sole plan file left under `specs/plan/` (non-recursive). */
function solePlanFile(root: string): string {
  const names = readdirSync(join(root, "specs", "plan")).filter((n) => n.endsWith(".md"));
  expect(names.length).toBe(1);
  return names[0]!;
}

// ---------------------------------------------------------------------------
// AC-STE-442.1 — registry registration
// ---------------------------------------------------------------------------

describe("AC-STE-442.1 — the registry gains the mode-none sequential-milestone entry", () => {
  test(`MIGRATIONS carries an entry with id "${ENTRY_ID}"`, () => {
    expect(MIGRATIONS.map((e) => e.id)).toContain(ENTRY_ID);
  });

  test("it is APPENDED — the last entry in the version-ordered list", () => {
    expect(MIGRATIONS[MIGRATIONS.length - 1]!.id).toBe(ENTRY_ID);
  });

  test("kind is `script` and it carries an apply (scripted repair, not operator prose)", () => {
    const entry = liveEntry();
    expect(entry.kind).toBe("script");
    expect(typeof entry.apply).toBe("function");
  });

  test("requires_explicit_approval is true — never swept into the batch approval", () => {
    expect(liveEntry().requires_explicit_approval).toBe(true);
  });

  test("it carries a non-empty title", () => {
    const entry = liveEntry();
    expect(typeof entry.title).toBe("string");
    expect(entry.title.length).toBeGreaterThan(0);
  });

  test("validateRegistry accepts the resulting list (dup-id + ascending order)", () => {
    expect(() => validateRegistry(MIGRATIONS)).not.toThrow();
  });

  test("the entry module exports the very object the registry carries", async () => {
    const mod = (await import(
      "../adapters/_shared/src/migrations/entries/mode_none_sequential_milestone"
    )) as { modeNoneSequentialMilestone?: MigrationEntry };
    expect(mod.modeNoneSequentialMilestone).toBeDefined();
    expect(MIGRATIONS.find((e) => e.id === ENTRY_ID)).toBe(mod.modeNoneSequentialMilestone!);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-442.2 — the version trap
// ---------------------------------------------------------------------------

describe("AC-STE-442.2 — introduced_in is the SHIPPING version, not the legacy-making one", () => {
  test(`introduced_in is exactly "${SHIPS_IN}"`, () => {
    expect(liveEntry().introduced_in.replace(/^v/, "")).toBe(SHIPS_IN);
  });

  test("introduced_in is NOT 2.56.0 — the value the registry's own prose would suggest", () => {
    // 2.56.0 "Mint" is the release that made a sequential mode-none plan legacy,
    // which is what index.ts documents `introduced_in` to mean. It is the wrong
    // value here: it passes every shape test above and then refuses the release
    // in `assertMigrationDeclared`. This assertion exists so that trap cannot
    // silently re-open on a later edit.
    expect(liveEntry().introduced_in.replace(/^v/, "")).not.toBe("2.56.0");
  });

  test("the ENFORCED rule agrees: the ship pre-flight resolves at the shipping version", async () => {
    // The real surface, not a restatement of the constant. M119 declares this
    // entry, so shipping 2.59.0 must resolve without throwing.
    await assertMigrationDeclared(m119Plan, MIGRATIONS, SHIPS_IN);
  });

  test("the ship pre-flight REFUSES at any other version — the equality rule is real", async () => {
    await expect(assertMigrationDeclared(m119Plan, MIGRATIONS, "2.56.0")).rejects.toThrow(
      /introduced_in|match/i,
    );
  });
});

// ---------------------------------------------------------------------------
// AC-STE-442.3 — the detector
// ---------------------------------------------------------------------------

describe("AC-STE-442.3 — detect is pure, synchronous, filesystem-only", () => {
  test("detect returns synchronously (no Promise) and never mutates the tree", () => {
    const root = makeCoreFixture();
    const before = snapshot(root);
    const res = liveEntry().detect(root);
    expect(typeof (res as unknown as { then?: unknown }).then).not.toBe("function");
    expect(snapshot(root)).toEqual(before);
  });

  test("detect is deterministic — two runs over the same tree agree exactly", () => {
    const root = makeCoreFixture();
    const entry = liveEntry();
    expect(entry.detect(root)).toEqual(entry.detect(root));
  });

  test("detect reads no git: it fires identically inside and outside a repository", () => {
    // The registry contract forbids git. The gate probe classifies the SAME
    // plan by git provenance; this detector cannot, which is the over-detection
    // AC-STE-442.9 requires the module header to own.
    const plain = makeCoreFixture();
    const gitted = makeCoreFixture();
    mkdirSync(join(gitted, ".git"), { recursive: true });
    writeFileSync(join(gitted, ".git", "HEAD"), "ref: refs/heads/main\n", "utf-8");
    expect(liveEntry().detect(gitted).applies).toBe(liveEntry().detect(plain).applies);
  });

  test("an empty tree does not apply", () => {
    const root = makeTree({});
    const res = liveEntry().detect(root);
    expect(res.applies).toBe(false);
    expect(res.evidence).toEqual([]);
  });
});

describe("AC-STE-442.3 — detect fires on mode: none + a bare sequential plan", () => {
  test("mode: none + sequential plan with no id: and no exempt kind ⇒ applies", () => {
    const root = makeCoreFixture();
    const res = liveEntry().detect(root);
    expect(res.applies).toBe(true);
    expect(res.evidence.length).toBe(1);
    expect(res.evidence[0]).toContain(join("specs", "plan", "M5.md"));
  });

  test("EACH repairable plan gets its OWN evidence entry, never one merged row", () => {
    const root = makeTree({
      "CLAUDE.md": MODE_NONE_CLAUDE_MD,
      "specs/plan/M5.md": plan("M5"),
      "specs/plan/M6.md": plan("M6"),
      "specs/plan/M7.md": plan("M7"),
    });
    const res = liveEntry().detect(root);
    expect(res.applies).toBe(true);
    expect(res.evidence.length).toBe(3);
    for (const token of ["M5", "M6", "M7"]) {
      expect(res.evidence.some((e) => e.includes(join("specs", "plan", `${token}.md`)))).toBe(true);
    }
  });

  test("a CLAUDE.md with no `## Task Tracking` section is the canonical mode-none form", () => {
    // resolver_config.ts: an absent file OR an absent section both mean
    // `mode: none` (AC-29.5), and probe #73's `resolveMode` reads it that way.
    // A detector that disagreed would leave the very plans the probe fails
    // unrepairable.
    const root = makeTree({
      "CLAUDE.md": "# Project\n\nHand-written notes.\n",
      "specs/plan/M5.md": plan("M5"),
    });
    expect(liveEntry().detect(root).applies).toBe(true);
  });
});

describe("AC-STE-442.3 — detect stays silent on every non-repairable shape", () => {
  test("tracker mode (`mode: linear`) never applies, however mis-named the plan", () => {
    const root = makeTree({
      "CLAUDE.md": MODE_LINEAR_CLAUDE_MD,
      "specs/plan/M5.md": plan("M5"),
      "specs/frs/VDTAF4.md": fr("VDTAF4", "M5"),
    });
    const res = liveEntry().detect(root);
    expect(res.applies).toBe(false);
    expect(res.evidence).toEqual([]);
  });

  test("a plan already carrying an `id:` key is repaired-or-legitimate, never re-repaired", () => {
    const root = makeTree({
      "CLAUDE.md": MODE_NONE_CLAUDE_MD,
      "specs/plan/M5.md": plan("M5", [`id: ${ulidWithTail("VDTAF4")}`]),
    });
    expect(liveEntry().detect(root).applies).toBe(false);
  });

  test("`kind: scaffolding` exempts the plan", () => {
    const root = makeTree({
      "CLAUDE.md": MODE_NONE_CLAUDE_MD,
      "specs/plan/M5.md": plan("M5", ["kind: scaffolding"]),
    });
    expect(liveEntry().detect(root).applies).toBe(false);
  });

  test("`kind: legacy` exempts the plan — the operator's permanent opt-out", () => {
    const root = makeTree({
      "CLAUDE.md": MODE_NONE_CLAUDE_MD,
      "specs/plan/M5.md": plan("M5", ["kind: legacy"]),
    });
    expect(liveEntry().detect(root).applies).toBe(false);
  });

  test("a MINTED plan (`M_<tail>.md`) is not sequential and is never reported", () => {
    const minted = ulidWithTail("VDTAF4");
    const root = makeTree({
      "CLAUDE.md": MODE_NONE_CLAUDE_MD,
      [`specs/plan/${milestoneIdFromUlid(minted)}.md`]: plan(milestoneIdFromUlid(minted), [
        `id: ${minted}`,
      ]),
    });
    expect(liveEntry().detect(root).applies).toBe(false);
  });

  test("an Epic-keyed plan (`M_PROJ_500.md`) is not sequential and is never reported", () => {
    const root = makeTree({
      "CLAUDE.md": MODE_NONE_CLAUDE_MD,
      "specs/plan/M_PROJ_500.md": plan("M_PROJ_500"),
    });
    expect(liveEntry().detect(root).applies).toBe(false);
  });

  test("an ARCHIVED sequential plan is never evidence — renaming it is what #63 forbids", () => {
    const root = makeTree({
      "CLAUDE.md": MODE_NONE_CLAUDE_MD,
      "specs/plan/archive/M5.md": plan("M5", ["shipped_in: v2.40.0"]),
    });
    const res = liveEntry().detect(root);
    expect(res.applies).toBe(false);
    expect(res.evidence).toEqual([]);
  });

  test("a non-plan file living beside the plans is ignored", () => {
    const root = makeTree({
      "CLAUDE.md": MODE_NONE_CLAUDE_MD,
      "specs/plan/README.md": "# notes\n",
      "specs/plan/notes.txt": "M5\n",
    });
    expect(liveEntry().detect(root).applies).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-442.4 — apply: mint, rename, record, rebind
// ---------------------------------------------------------------------------

describe("AC-STE-442.4 — apply repairs an unshipped plan and every binding it owns", () => {
  test("the plan is renamed to the M_<tail>.md its minted id derives", () => {
    const root = makeCoreFixture();
    liveApply(root);
    expect(existsSync(join(root, "specs", "plan", "M5.md"))).toBe(false);
    const name = solePlanFile(root);
    expect(name).toMatch(MINTED_PLAN_NAME_RE);
  });

  test("the minted identity is written VERBATIM as the plan's id: key and derives its filename", () => {
    const root = makeCoreFixture();
    liveApply(root);
    const name = solePlanFile(root);
    const id = fmValue(readFileSync(join(root, "specs", "plan", name), "utf-8"), "id");
    expect(id).not.toBeNull();
    expect(id!).toMatch(ULID_REGEX);
    // The filename is the 6-char tail of the recorded id — the exact invariant
    // probe #73 checks, so a repaired plan passes the probe that flagged it.
    expect(`${milestoneIdFromUlid(id!)}.md`).toBe(name);
  });

  test("the plan's own `milestone:` key moves with the rename", () => {
    // The FR's Summary: the token is the key archive lookup, ship stamping, and
    // milestone resolution all read, so a rename that leaves a stale binding
    // behind leaves the project worse off than before. The plan's own
    // frontmatter is one of those bindings.
    const root = makeCoreFixture();
    liveApply(root);
    const name = solePlanFile(root);
    expect(readFm(root, `specs/plan/${name}`, "milestone")).toBe(name.replace(/\.md$/, ""));
  });

  test("EVERY FR bound to the old token is rebound — active AND archived", () => {
    const root = makeCoreFixture();
    liveApply(root);
    const token = solePlanFile(root).replace(/\.md$/, "");
    expect(readFm(root, "specs/frs/VDTAF4.md", "milestone")).toBe(token);
    expect(readFm(root, "specs/frs/BCDEF2.md", "milestone")).toBe(token);
    expect(readFm(root, "specs/frs/archive/GHJKM3.md", "milestone")).toBe(token);
  });

  test("an FR bound to a DIFFERENT milestone is left byte-identical", () => {
    const root = makeCoreFixture();
    const before = readFileSync(join(root, "specs", "frs", "NPQRS4.md"), "utf-8");
    liveApply(root);
    expect(readFileSync(join(root, "specs", "frs", "NPQRS4.md"), "utf-8")).toBe(before);
  });

  test("`changed` names the new plan path and every rewritten FR path", () => {
    const root = makeCoreFixture();
    const result = liveApply(root);
    const name = solePlanFile(root);
    expect(result.changed).toContain(join("specs", "plan", name));
    expect(result.changed).toContain(join("specs", "frs", "VDTAF4.md"));
    expect(result.changed).toContain(join("specs", "frs", "BCDEF2.md"));
    expect(result.changed).toContain(join("specs", "frs", "archive", "GHJKM3.md"));
    expect(result.changed).not.toContain(join("specs", "frs", "NPQRS4.md"));
  });

  test("two mis-named plans are minted to DISTINCT identities in one run", () => {
    const root = makeTree({
      "CLAUDE.md": MODE_NONE_CLAUDE_MD,
      "specs/plan/M5.md": plan("M5"),
      "specs/plan/M6.md": plan("M6"),
      "specs/frs/VDTAF4.md": fr("VDTAF4", "M5"),
      "specs/frs/BCDEF2.md": fr("BCDEF2", "M6"),
    });
    liveApply(root);
    const names = readdirSync(join(root, "specs", "plan")).filter((n) => n.endsWith(".md")).sort();
    expect(names.length).toBe(2);
    for (const n of names) expect(n).toMatch(MINTED_PLAN_NAME_RE);
    expect(new Set(names).size).toBe(2);
    // Each FR followed its OWN plan, not whichever was minted last.
    const a = readFm(root, "specs/frs/VDTAF4.md", "milestone");
    const b = readFm(root, "specs/frs/BCDEF2.md", "milestone");
    expect(a).not.toBe(b);
    expect(names).toContain(`${a}.md`);
    expect(names).toContain(`${b}.md`);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-442.5 — shipped plans are reported, never renamed
// ---------------------------------------------------------------------------

describe("AC-STE-442.5 — a plan carrying shipped_in is never renamed", () => {
  test("a shipped mis-named plan is left byte-identical on disk", () => {
    const root = makeTree({
      "CLAUDE.md": MODE_NONE_CLAUDE_MD,
      "specs/plan/M5.md": plan("M5", ["shipped_in: v2.58.0"]),
      "specs/frs/VDTAF4.md": fr("VDTAF4", "M5"),
    });
    const before = snapshot(root);
    const result = liveApply(root);
    expect(snapshot(root)).toEqual(before);
    expect(result.changed).toEqual([]);
  });

  test("the summary reports it, naming the plan and the ship-coherence probe", () => {
    const root = makeTree({
      "CLAUDE.md": MODE_NONE_CLAUDE_MD,
      "specs/plan/M5.md": plan("M5", ["shipped_in: v2.58.0"]),
    });
    const { summary } = liveApply(root);
    expect(summary).toContain("M5.md");
    expect(summary).toContain("plan_ship_coherence");
  });

  test("mixed run: the unshipped plan is repaired while the shipped one is untouched", () => {
    const shippedBody = plan("M5", ["shipped_in: v2.58.0"]);
    const root = makeTree({
      "CLAUDE.md": MODE_NONE_CLAUDE_MD,
      "specs/plan/M5.md": shippedBody,
      "specs/plan/M6.md": plan("M6"),
      "specs/frs/VDTAF4.md": fr("VDTAF4", "M5"),
      "specs/frs/BCDEF2.md": fr("BCDEF2", "M6"),
    });
    const { summary } = liveApply(root);

    // Shipped: file and every binding it owns survive byte-for-byte.
    expect(readFileSync(join(root, "specs", "plan", "M5.md"), "utf-8")).toBe(shippedBody);
    expect(readFm(root, "specs/frs/VDTAF4.md", "milestone")).toBe("M5");

    // Unshipped: repaired in the same run.
    expect(existsSync(join(root, "specs", "plan", "M6.md"))).toBe(false);
    const repaired = readdirSync(join(root, "specs", "plan")).filter(
      (n) => n.endsWith(".md") && n !== "M5.md",
    );
    expect(repaired.length).toBe(1);
    expect(repaired[0]!).toMatch(MINTED_PLAN_NAME_RE);
    expect(readFm(root, "specs/frs/BCDEF2.md", "milestone")).toBe(repaired[0]!.replace(/\.md$/, ""));
    expect(summary).toContain("plan_ship_coherence");
  });
});

// ---------------------------------------------------------------------------
// AC-STE-442.6 — idempotency
// ---------------------------------------------------------------------------

describe("AC-STE-442.6 — apply is idempotent", () => {
  test("a second run detects nothing and changes no file (full-tree snapshot)", () => {
    const root = makeCoreFixture();
    liveApply(root);
    const afterFirst = snapshot(root);

    expect(liveEntry().detect(root).applies).toBe(false);

    const second = liveApply(root);
    expect(snapshot(root)).toEqual(afterFirst);
    expect(second.changed).toEqual([]);
  });

  test("apply on a tree that never applied is a no-op, not a scaffold", () => {
    const root = makeTree({ "CLAUDE.md": MODE_LINEAR_CLAUDE_MD });
    const before = snapshot(root);
    const result = liveApply(root);
    expect(snapshot(root)).toEqual(before);
    expect(result.changed).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-442.7 — all-or-nothing per plan
// ---------------------------------------------------------------------------

describe("AC-STE-442.7 — a failed repair leaves no partial write", () => {
  test("a rename that cannot land rolls back every binding it had already rewritten", () => {
    const root = makeCoreFixture();
    const before = snapshot(root);
    const planDir = join(root, "specs", "plan");

    // Inject the failure AT THE RENAME STEP: a read-only directory still lets
    // an existing file inside it be written (POSIX write permission on a file
    // is the file's own), but forbids creating, removing, or renaming entries.
    // So the FR sweep and the id: write succeed and only the rename fails —
    // exactly the window in which a partial repair would be observable.
    chmodSync(planDir, 0o555);
    let result: { changed: string[]; summary: string };
    try {
      // Reported through the result, never thrown: a throw here aborts the whole
      // registry walk and takes every other entry's repair down with it.
      result = liveApply(root);
    } finally {
      chmodSync(planDir, 0o755);
    }

    // The whole tree is exactly as it was — plan path, plan bytes, FR bindings.
    expect(snapshot(root)).toEqual(before);
    expect(existsSync(join(root, "specs", "plan", "M5.md"))).toBe(true);
    expect(readFm(root, "specs/plan/M5.md", "id")).toBeNull();
    expect(readFm(root, "specs/frs/VDTAF4.md", "milestone")).toBe("M5");
    expect(readFm(root, "specs/frs/BCDEF2.md", "milestone")).toBe("M5");
    expect(readFm(root, "specs/frs/archive/GHJKM3.md", "milestone")).toBe("M5");

    // Nothing changed, and the failure is not swallowed.
    expect(result.changed).toEqual([]);
    expect(result.summary).toContain("M5.md");
    expect(result.summary).toMatch(/fail|could not|unable|error|refus/i);
  });

  test("one plan's failure does not strand a sibling plan's completed repair", () => {
    // Both plans live in the same read-only directory, so BOTH fail. The
    // property under test is that neither leaves half a repair behind.
    const root = makeTree({
      "CLAUDE.md": MODE_NONE_CLAUDE_MD,
      "specs/plan/M5.md": plan("M5"),
      "specs/plan/M6.md": plan("M6"),
      "specs/frs/VDTAF4.md": fr("VDTAF4", "M5"),
      "specs/frs/BCDEF2.md": fr("BCDEF2", "M6"),
    });
    const before = snapshot(root);
    const planDir = join(root, "specs", "plan");
    chmodSync(planDir, 0o555);
    try {
      liveApply(root);
    } finally {
      chmodSync(planDir, 0o755);
    }
    expect(snapshot(root)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-442.8 — M119 declares the migration
// ---------------------------------------------------------------------------

describe("AC-STE-442.8 — specs/plan/M119.md declares this migration", () => {
  test("the plan's `migration:` frontmatter key is the entry id", () => {
    expect(fmValue(readFileSync(m119Plan, "utf-8"), "migration")).toBe(ENTRY_ID);
  });

  test("the declared id RESOLVES against the live registry", () => {
    const declared = fmValue(readFileSync(m119Plan, "utf-8"), "migration");
    expect(MIGRATIONS.find((e) => e.id === declared)).toBeDefined();
  });

  test("the plan's Release target and the entry's introduced_in agree", () => {
    const body = readFileSync(m119Plan, "utf-8");
    const target = /\*\*Release target:\*\*\s*v?(\d+\.\d+\.\d+)/.exec(body);
    expect(target).not.toBeNull();
    expect(target![1]!).toBe(SHIPS_IN);
    expect(liveEntry().introduced_in.replace(/^v/, "")).toBe(target![1]!);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-442.9 — the over-detection is documented, and previewed per plan
// ---------------------------------------------------------------------------

describe("AC-STE-442.9 — over-detection is owned in the module header", () => {
  test("the entry module exists at the registry's entries path", () => {
    expect(existsSync(entryModulePath)).toBe(true);
  });

  test("its leading header comment states the detector OVER-DETECTS", () => {
    const header = leadingComment(readFileSync(entryModulePath, "utf-8"));
    expect(header).toMatch(/over-detect/i);
  });

  test("the header names git and the gate probe it over-detects relative to", () => {
    const header = leadingComment(readFileSync(entryModulePath, "utf-8"));
    expect(header).toMatch(/git/i);
    expect(header).toMatch(/plan_identity_mode_conditional|#73/);
  });

  test("the preview surface renders per-entry evidence, so each plan is listed", () => {
    // `/upgrade` Step 3 prints the detected set with each entry's `evidence`
    // before asking for anything. One evidence row per plan (AC-STE-442.3) is
    // therefore what puts every affected plan in front of the operator.
    const body = readFileSync(upgradeSkill, "utf-8");
    expect(body).toContain("| id | introduced_in | kind | title | evidence |");
    expect(body).toContain("<evidence[0]>");
    // The template used to render `<evidence[0]>` followed by an ellipsis, and
    // this test pinned that literal — pinning the very truncation the AC exists
    // to forbid. EVERY affected plan has to reach the operator, or per-plan
    // approval of an explicit-approval entry is approval of an unseen scope.
    expect(body).not.toContain("<evidence[0]>` …");
    expect(body).toMatch(/one row per evidence entry/i);
    expect(body).toMatch(/never truncate/i);
  });

  test("the operator can decline: the entry never auto-applies under the marker", () => {
    expect(liveEntry().requires_explicit_approval).toBe(true);
  });
});

/** The file's leading `//` comment block — the module header, nothing below it. */
function leadingComment(src: string): string {
  const out: string[] = [];
  for (const line of src.split("\n")) {
    if (line.startsWith("//")) {
      out.push(line);
      continue;
    }
    if (line.trim().length === 0 && out.length === 0) continue;
    break;
  }
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// AC-STE-442.10 — deterministic proxies for "the gate stays green"
// ---------------------------------------------------------------------------

describe("AC-STE-442.10 — the registry's invariants survive the new entry", () => {
  test("ids stay unique", () => {
    const ids = MIGRATIONS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("introduced_in stays ascending across the whole list", () => {
    const tuple = (v: string): number[] => v.replace(/^v/, "").split(".").map(Number);
    for (let i = 1; i < MIGRATIONS.length; i++) {
      const a = tuple(MIGRATIONS[i - 1]!.introduced_in);
      const b = tuple(MIGRATIONS[i]!.introduced_in);
      expect(
        a[0]! < b[0]! || (a[0] === b[0] && (a[1]! < b[1]! || (a[1] === b[1] && a[2]! <= b[2]!))),
      ).toBe(true);
    }
  });

  test("`apply` is present iff kind is `script`", () => {
    for (const e of MIGRATIONS) {
      if (e.kind === "script") expect(typeof e.apply).toBe("function");
      else expect(e.apply).toBeUndefined();
    }
  });

  test("dogfood: the new detector stays silent on the toolkit's own tracker-mode repo", () => {
    // This repo declares `mode: linear` and carries sequential plans; a
    // detector that fired here would redden the toolkit's own gate.
    expect(liveEntry().detect(repoRoot).applies).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-442.7 regression — a frontmatter-less plan must not be renamed blind
//
// Surfaced by the end-of-FR refactor pass, which found the two readers
// disagreeing by construction: the repairable-plan walk parses leniently, so a
// plan with no `---` block answers `{}` — no `id:`, no `kind:` exemption, and
// therefore repairable — while the identity writer has no frontmatter block to
// write into and returns null. `apply` used to skip the `id:` write and rename
// anyway, producing an `M_<tail>.md` carrying no `id:`.
//
// That is strictly worse than the state being repaired. The original name was
// only ever dispositioned by git provenance (probe #73 grandfathers a legacy
// sequential plan); the produced name is in the minter's output range and
// carries no identity, which probe #73 fails outright. A repair that hard-fails
// the gate it exists to satisfy has to roll back, not proceed.
// ---------------------------------------------------------------------------

describe("AC-STE-442.7 — a plan with no frontmatter block rolls back, never renames", () => {
  test("the plan keeps its name and its bytes, and the failure is reported", () => {
    const root = makeTree({
      "CLAUDE.md": MODE_NONE_CLAUDE_MD,
      // No `---` block at all — the shape the lenient walk admits and the
      // identity writer cannot serve.
      "specs/plan/M5.md": "# Implementation Plan\n\n## M5 — No frontmatter {#M5}\n",
      "specs/frs/VDTAF4.md": fr("VDTAF4", "M5"),
    });
    const before = snapshot(root);

    const result = liveApply(root);

    // Nothing renamed, nothing rewritten — byte-for-byte, whole tree.
    expect(snapshot(root)).toEqual(before);
    expect(result.changed).toEqual([]);
    // ...and it is REPORTED, not swallowed: a silent skip would leave the
    // operator believing the plan was repaired.
    expect(result.summary).toContain("M5.md");
  });

  test("a sibling repairable plan in the same run still succeeds", () => {
    // Per-plan atomicity: one plan's failure must not abandon the others.
    const root = makeTree({
      "CLAUDE.md": MODE_NONE_CLAUDE_MD,
      "specs/plan/M5.md": "# Implementation Plan\n\n## M5 — No frontmatter {#M5}\n",
      "specs/plan/M6.md": plan("M6"),
      "specs/frs/VDTAF4.md": fr("VDTAF4", "M6"),
    });

    liveApply(root);

    const names = readdirSync(join(root, "specs", "plan")).filter((n) => n.endsWith(".md")).sort();
    // M5 untouched, M6 repaired to a minted name.
    expect(names.length).toBe(2);
    expect(names).toContain("M5.md");
    const minted = names.find((n) => n !== "M5.md")!;
    expect(minted).toMatch(/^M_[0-9A-HJKMNP-TV-Z]{6}\.md$/);
    // ...and M6's binding moved with it.
    expect(fmValue(readFileSync(join(root, "specs", "frs", "VDTAF4.md"), "utf-8"), "milestone")).toBe(
      minted.replace(/\.md$/, ""),
    );
  });
});
