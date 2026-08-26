// STE-522 — Minting a milestone Epic is a real step with a computable name.
//
// The adapter documentation tells whoever is minting a milestone to create the
// Epic with `summary=<canonical name>`. That canonical name begins with the
// milestone id, and the milestone id is derived from the key the tracker
// assigns to that very Epic — so the instruction names a value that does not
// exist at the moment it is ordered. What IS computable at creation time is the
// human title. Create with the title, read the allocated key back, derive
// `M_<key>` from it, and only then write the plan file.
//
// This file pins that order in three places: the helper that performs it
// (`adapters/_shared/src/mint_milestone_epic.ts`, created by the implementer),
// the adapter surface that documents it (`adapters/jira.md`), and the skill
// surface that orders it (`skills/spec-write/SKILL.md`).
//
// ─────────────────────────────────────────────────────────────────────────
// CONTRACT THE IMPLEMENTER IS BEING HELD TO (read this before implementing)
// ─────────────────────────────────────────────────────────────────────────
//
// 1. Module `adapters/_shared/src/mint_milestone_epic.ts` exports
//    `mintMilestoneEpic(provider, project, title)` returning a Promise of
//    `{ epicKey: string; milestoneId: string }`.
//    - `epicKey`     — verbatim, as the tracker allocated it (`GF-78`).
//    - `milestoneId` — `milestoneIdFromEpicKey(epicKey)` (`M_GF_78`).
//    It calls the provider's EXISTING `createEpic(project, { name })` op — the
//    same op declared on `MilestoneOps` — with `name` set to the human title
//    ALONE (`name` is what `adapters/jira.md` maps onto Jira's `summary`).
//
// 2. `attachProjectMilestone` must no longer reach `createEpic` (AC.8): after
//    this FR the op has exactly ONE production call site and it lives in the
//    new helper. Import `MilestoneOps` rather than declaring a fresh interface
//    with a `createEpic(...)` METHOD signature — a method-shorthand declaration
//    reads as a call site to the AC.8 scan. The property-arrow style
//    `createEpic?: (project: string, ...) => ...` that `MilestoneOps` already
//    uses does not.
//
// 3. `adapters/jira.md`, inside the `### Epic path (primary …)` section:
//    - the literal `summary=<canonical name>` must be GONE, and
//    - these four literals must appear, in this order:
//        "summary=<human title>", "read the key back", "derive the id",
//        "write the plan file".
//    Both directions are mutation-verified (AC.6), so the old reading may not
//    be left standing alongside the new one.
//
// 4. `skills/spec-write/SKILL.md`, inside the `**Jira Epic-first branch …`
//    passage, must name the literal module path
//    `adapters/_shared/src/mint_milestone_epic.ts`.

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  milestoneBindingPresent,
  TRANSIENT_RETRY_SCHEDULE_MS,
} from "../adapters/_shared/src/attach_project_milestone";
import { milestoneIdFromEpicKey } from "../adapters/_shared/src/milestone_token";
import { mutateInRegion } from "./_sited-mutation";

const pluginRoot = join(import.meta.dir, "..");

// ───────────────────────────────────────────────────────────────────────
// Fixture constants — a real Jira-shaped mint.
// ───────────────────────────────────────────────────────────────────────

/** The project the milestone Epic is minted into. */
const PROJECT = "GF";
/** The human title, the ONLY value that exists before the create call. */
const TITLE = "Waiting States II";
/** The key the tracker allocates in response to the create. */
const EPIC_KEY = "GF-78";
/** `milestoneIdFromEpicKey("GF-78")` — knowable only AFTER the create. */
const MILESTONE_ID = "M_GF_78";

// ───────────────────────────────────────────────────────────────────────
// Provider double — records every creation argument verbatim.
//
// AC.2 is asserted against THIS record, never against the helper's source
// text: a helper that composed the canonical name into a variable and sent it
// anyway would pass a source grep and fail here.
// ───────────────────────────────────────────────────────────────────────

interface MintDouble {
  createEpicCalls: number;
  /** Every `(project, opts)` pair handed to `createEpic`, in order. */
  createArgs: { project: string; opts: { name: string } }[];
  provider: Record<string, unknown>;
}

function makeMintDouble(nextEpicKey: string = EPIC_KEY): MintDouble {
  const d: MintDouble = { createEpicCalls: 0, createArgs: [], provider: {} };
  d.provider = {
    milestoneBinding: "epic" as const,
    // Arrow-function property (not a prototype method): production code
    // destructures the op off the provider and calls it unbound.
    createEpic: async (project: string, opts: { name: string }): Promise<{ key: string }> => {
      d.createEpicCalls += 1;
      d.createArgs.push({ project, opts: { ...opts } });
      return { key: nextEpicKey };
    },
  };
  return d;
}

/** The contract AC.1–AC.4 hold the helper to. */
type MintFn = (
  provider: unknown,
  project: string,
  title: string,
) => Promise<{ epicKey: string; milestoneId: string }>;

/**
 * Loaded lazily and per test, so a missing module fails ONLY the four
 * behavioural ACs. A top-level import would take the whole file down with it,
 * and the five documentation/census ACs below would then report a
 * module-resolution error instead of the state of the surfaces they measure —
 * a red that says nothing about its own subject.
 */
async function loadMintMilestoneEpic(): Promise<MintFn> {
  const mod = (await import("../adapters/_shared/src/mint_milestone_epic")) as {
    mintMilestoneEpic?: MintFn;
  };
  if (typeof mod.mintMilestoneEpic !== "function") {
    throw new Error(
      "adapters/_shared/src/mint_milestone_epic.ts does not export a `mintMilestoneEpic` function",
    );
  }
  return mod.mintMilestoneEpic;
}

// ═══════════════════════════════════════════════════════════════════════
// AC-STE-522.1 — the helper mints with the title and returns key + id.
// ═══════════════════════════════════════════════════════════════════════

describe("AC-STE-522.1 — mintMilestoneEpic creates with the title and returns key + derived id", () => {
  test("exactly one create, carrying the human title alone, returning both values", async () => {
    const mintMilestoneEpic = await loadMintMilestoneEpic();
    const d = makeMintDouble();

    const result = await mintMilestoneEpic(d.provider, PROJECT, TITLE);

    // The creation happened, once, against the named project.
    expect(d.createEpicCalls).toBe(1);
    expect(d.createArgs[0]!.project).toBe(PROJECT);

    // The summary is the human title ALONE — not decorated, not prefixed.
    expect(d.createArgs[0]!.opts.name).toBe(TITLE);

    // Both halves of the pair come back: the key verbatim, and the id derived
    // from it through the shared derivation (not re-implemented here).
    expect(result.epicKey).toBe(EPIC_KEY);
    expect(result.milestoneId).toBe(MILESTONE_ID);
    expect(result.milestoneId).toBe(milestoneIdFromEpicKey(result.epicKey));
  });
});

// ═══════════════════════════════════════════════════════════════════════
// AC-STE-522.2 — no canonical name ever reaches the creation call.
// ═══════════════════════════════════════════════════════════════════════

describe("AC-STE-522.2 — the canonical `M_<key> — <Title>` name never reaches createEpic", () => {
  test("the recorded create argument is not the canonical name, in any shape", async () => {
    const mintMilestoneEpic = await loadMintMilestoneEpic();
    const d = makeMintDouble();

    const result = await mintMilestoneEpic(d.provider, PROJECT, TITLE);
    const canonical = `${result.milestoneId} — ${TITLE}`;

    // Read the RECORDING, not the source. Nothing that was actually sent may
    // be the canonical name, nor carry a milestone token at all.
    expect(d.createArgs.length).toBeGreaterThan(0);
    for (const call of d.createArgs) {
      expect(call.opts.name).not.toBe(canonical);
      expect(call.opts.name).not.toContain(result.milestoneId);
      // A canonical name is `<token> — <title>`; nothing sent may be in that
      // shape, whichever token someone might have guessed at.
      expect(call.opts.name).not.toMatch(/^M(?:\d+|_[A-Za-z0-9][A-Za-z0-9_-]*)\s+—\s+/);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// AC-STE-522.3 — the returned pair satisfies the binding predicate.
// ═══════════════════════════════════════════════════════════════════════

describe("AC-STE-522.3 — the returned (id, key) pair satisfies milestoneBindingPresent by construction", () => {
  test("the real return values, through the real predicate, are TRUE", async () => {
    const mintMilestoneEpic = await loadMintMilestoneEpic();
    const d = makeMintDouble();

    const result = await mintMilestoneEpic(d.provider, PROJECT, TITLE);
    const canonical = `${result.milestoneId} — ${TITLE}`;

    // The archival gate's own expression, called with the helper's own output
    // against a ticket view built from the key the helper returned. The
    // comparison is NOT re-implemented here.
    expect(milestoneBindingPresent({ parent: result.epicKey }, canonical, "epic")).toBe(true);
  });

  test("non-circular: the same predicate is FALSE for a second, different Epic", async () => {
    const mintMilestoneEpic = await loadMintMilestoneEpic();
    const d = makeMintDouble();
    const result = await mintMilestoneEpic(d.provider, PROJECT, TITLE);
    const canonical = `${result.milestoneId} — ${TITLE}`;

    // A freshly minted SECOND Epic under a different key is exactly the state
    // this milestone exists to prevent. If the predicate accepted it too, the
    // assertion above would be worth nothing.
    expect(milestoneBindingPresent({ parent: "GF-900" }, canonical, "epic")).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// AC-STE-522.4 — an unsanitizable key surfaces the underlying refusal.
// ═══════════════════════════════════════════════════════════════════════

describe("AC-STE-522.4 — a key that will not sanitize surfaces the refusal, never a malformed id", () => {
  // Both keys are rejected by `milestoneIdFromEpicKey`'s existing contract:
  // `""` sanitizes to the bare `M_`, and `"---"` to `M____`, whose key head is
  // `_` — neither is well-formed under the union grammar.
  for (const badKey of ["", "---"]) {
    test(`tracker key ${JSON.stringify(badKey)} rejects rather than returning an id`, async () => {
      const mintMilestoneEpic = await loadMintMilestoneEpic();
      const d = makeMintDouble(badKey);

      let returned: unknown;
      let caught: unknown = null;
      try {
        returned = await mintMilestoneEpic(d.provider, PROJECT, TITLE);
      } catch (err) {
        caught = err;
      }

      // Nothing came back — in particular, no `{ milestoneId: "M_" }`.
      expect(returned).toBeUndefined();
      expect(caught).toBeInstanceOf(Error);

      // The UNDERLYING refusal, propagated — not swallowed and re-worded into
      // a local guard that could drift from the derivation it protects.
      expect((caught as Error).message).toContain("milestoneIdFromEpicKey");
      expect((caught as Error).message).toContain(badKey === "" ? "M_<epic-key>" : "---");

      // The refusal is the DERIVE step failing, so the create had already run.
      expect(d.createEpicCalls).toBe(1);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// AC-STE-522.5 / AC-STE-522.6 — the adapter surface states the real order.
// ═══════════════════════════════════════════════════════════════════════

const JIRA_MD = join(pluginRoot, "adapters", "jira.md");

/** Opens the section this FR rewrites. */
const EPIC_PATH_HEADING = "### Epic path (primary — `milestone_binding: epic`)";
/** Opens the next section — the region's exclusive end. */
const LABEL_PATH_HEADING = "### Label path (fallback";

/** The instruction that cannot be followed. It must be GONE. */
const CANONICAL_NAME_INSTRUCTION = "summary=<canonical name>";

/**
 * The four literals the Epic-path section must carry, IN THIS ORDER: the
 * computable creation summary, then the three steps that follow it.
 */
const ORDER_MARKERS = [
  "summary=<human title>",
  "read the key back",
  "derive the id",
  "write the plan file",
] as const;

/** Bounds of the Epic-path section, computed from the shipped anchors. */
function epicPathRegion(doc: string): { from: number; to: number } {
  const from = doc.indexOf(EPIC_PATH_HEADING);
  if (from < 0) {
    throw new Error(
      `epicPathRegion: ${JSON.stringify(EPIC_PATH_HEADING)} is absent from adapters/jira.md — ` +
        `the section this FR rewrites was renamed, so every assertion below would be scanning ` +
        `the wrong text.`,
    );
  }
  const to = doc.indexOf(LABEL_PATH_HEADING, from);
  if (to < 0) {
    throw new Error(
      `epicPathRegion: ${JSON.stringify(LABEL_PATH_HEADING)} does not follow the Epic-path ` +
        `heading in adapters/jira.md — the region has no determined end.`,
    );
  }
  return { from, to };
}

/**
 * The AC.5 predicate, as a pure function of the document, so AC.6's mutants
 * run through the SAME code the clean assertion runs through. Returns the list
 * of reasons the surface fails; empty means it states the real order.
 */
function epicPathViolations(doc: string): string[] {
  const { from, to } = epicPathRegion(doc);
  const region = doc.slice(from, to);
  const reasons: string[] = [];

  if (region.includes(CANONICAL_NAME_INSTRUCTION)) {
    reasons.push(
      `the impossible instruction ${JSON.stringify(CANONICAL_NAME_INSTRUCTION)} is still in the ` +
        `Epic-path section (it must be REMOVED, not supplemented)`,
    );
  }

  let cursor = 0;
  for (const marker of ORDER_MARKERS) {
    const at = region.indexOf(marker, cursor);
    if (at < 0) {
      reasons.push(
        `the Epic-path section does not state ${JSON.stringify(marker)} after the markers ` +
          `preceding it — the create/read-back/derive/write order is not stated`,
      );
      break;
    }
    cursor = at + marker.length;
  }

  return reasons;
}

describe("AC-STE-522.5 — adapters/jira.md states the title-only summary and the derive-then-write order", () => {
  test("the Epic-path section is clean of the impossible instruction and states all four steps in order", () => {
    const doc = readFileSync(JIRA_MD, "utf-8");
    expect(epicPathViolations(doc)).toEqual([]);
  });
});

describe("AC-STE-522.6 — the AC.5 pin is mutation-verified in BOTH directions", () => {
  test("direction A — restoring the canonical-name instruction ALONGSIDE the new one fails the pin", () => {
    const doc = readFileSync(JIRA_MD, "utf-8");
    const { from, to } = epicPathRegion(doc);

    // Leave the title-only instruction standing and add the old reading back.
    // "Supplemented, not removed" is precisely the state AC.5 forbids, and a
    // one-directional pin would stay green on it.
    const mutant = mutateInRegion(
      doc,
      from,
      to,
      ORDER_MARKERS[0],
      `${ORDER_MARKERS[0]} (older guidance said ${CANONICAL_NAME_INSTRUCTION})`,
      { label: "the adapters/jira.md Epic-path section" },
    );
    expect(mutant).not.toBe(doc);

    const reasons = epicPathViolations(mutant);
    expect(reasons.length).toBeGreaterThan(0);
    expect(reasons.join(" | ")).toContain(CANONICAL_NAME_INSTRUCTION);
  });

  test("direction B — deleting the title-only instruction fails the pin", () => {
    const doc = readFileSync(JIRA_MD, "utf-8");
    const { from, to } = epicPathRegion(doc);

    // Replace the computable summary with a non-committal paraphrase: the old
    // literal is not restored, so direction A's reason cannot be what fires.
    const mutant = mutateInRegion(
      doc,
      from,
      to,
      ORDER_MARKERS[0],
      "summary=<the Epic's name>",
      { label: "the adapters/jira.md Epic-path section" },
    );
    expect(mutant).not.toBe(doc);

    const reasons = epicPathViolations(mutant);
    expect(reasons.length).toBeGreaterThan(0);
    expect(reasons.join(" | ")).toContain(ORDER_MARKERS[0]);
    // Isolation: this mutant fails for the DELETION, not for a restored
    // canonical-name instruction.
    expect(reasons.join(" | ")).not.toContain("must be REMOVED, not supplemented");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// AC-STE-522.7 — the skill surface names the helper by module path.
// ═══════════════════════════════════════════════════════════════════════

const SPEC_WRITE_SKILL = join(pluginRoot, "skills", "spec-write", "SKILL.md");
const EPIC_FIRST_ANCHOR = "**Jira Epic-first branch";
const NEXT_BRANCH_ANCHOR = "**Tracker-less minted branch";
const MINT_MODULE_PATH = "adapters/_shared/src/mint_milestone_epic.ts";

describe("AC-STE-522.7 — the Jira Epic-first branch names adapters/_shared/src/mint_milestone_epic.ts", () => {
  test("the module path appears INSIDE the Epic-first passage, not merely somewhere in the file", () => {
    const doc = readFileSync(SPEC_WRITE_SKILL, "utf-8");

    const from = doc.indexOf(EPIC_FIRST_ANCHOR);
    expect(
      from < 0 ? `${JSON.stringify(EPIC_FIRST_ANCHOR)} is absent from ${SPEC_WRITE_SKILL}` : "found",
    ).toBe("found");

    const to = doc.indexOf(NEXT_BRANCH_ANCHOR, from);
    expect(
      to < 0
        ? `${JSON.stringify(NEXT_BRANCH_ANCHOR)} does not follow the Epic-first anchor in ${SPEC_WRITE_SKILL}`
        : "found",
    ).toBe("found");

    const region = doc.slice(from, to);

    // The region is a real slice of the document, not the whole thing — a
    // whole-document match would make the scoping vacuous.
    expect(region.length).toBeGreaterThan(0);
    expect(region.length).toBeLessThan(doc.length);

    expect(region).toContain(MINT_MODULE_PATH);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// AC-STE-522.8 / AC-STE-522.9 — one production call site, proven measured.
// ═══════════════════════════════════════════════════════════════════════

/**
 * The trees a production call site could live in. NOTE: `adapters/` and
 * `skills/` live under `plugins/dev-process-toolkit/`, NOT the repository
 * root — a scan pointed one level too high reports zero exactly like a clean
 * tree does, which is why AC.9 exists and why these roots are named in every
 * assertion below.
 */
const SEARCH_ROOTS = ["adapters", "skills"] as const;
const ROOTS_DESC = SEARCH_ROOTS.map((r) => join(pluginRoot, r)).join(" + ");

/** Surfaces that can carry an executable step: modules and skill/adapter prose. */
const SCANNED_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".md", ".sh"]);

function collectScannedFiles(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      // Test trees are not production code.
      if (entry.name === "tests" || entry.name === "node_modules") continue;
      collectScannedFiles(p, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (entry.name.endsWith(".test.ts")) continue; // nor are test files
    const dot = entry.name.lastIndexOf(".");
    if (dot < 0 || !SCANNED_EXTENSIONS.has(entry.name.slice(dot))) continue;
    out.push(p);
  }
}

/**
 * Every INVOCATION of `token` in production code under the named roots —
 * `token(`, with a word boundary in front. Deliberately not a bare grep for
 * the identifier: the `MilestoneOps` interface declaration
 * (`createEpic?: (project…`), the destructuring (`{ …, createEpic, … }`), and
 * every prose mention would all match one of those, and none of them is a
 * call site.
 */
function scanProductionCallSites(token: string): { file: string; line: number }[] {
  const files: string[] = [];
  for (const root of SEARCH_ROOTS) collectScannedFiles(join(pluginRoot, root), files);
  files.sort();

  const re = new RegExp(String.raw`(?<![A-Za-z0-9_$])${token}\s*\(`, "g");
  const sites: { file: string; line: number }[] = [];
  for (const file of files) {
    const src = readFileSync(file, "utf-8");
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      sites.push({ file: relative(pluginRoot, file), line: src.slice(0, m.index).split("\n").length });
    }
  }
  return sites;
}

describe("AC-STE-522.8 — createEpic has exactly ONE production call site, and it is the mint helper", () => {
  test("the call-site census over the named roots reports the helper and nothing else", () => {
    const sites = scanProductionCallSites("createEpic");

    // Composed so the searched roots travel WITH the failure: a regression
    // here is either a second home for the op or a moved directory, and the
    // message has to let a reader tell those apart.
    const verdict =
      `${sites.length} createEpic call site(s) under [${ROOTS_DESC}] ` +
      `(excluding *.test.ts and tests/): ${sites.map((s) => s.file).join(", ") || "(none)"}`;

    expect(verdict).toBe(
      `1 createEpic call site(s) under [${ROOTS_DESC}] ` +
        `(excluding *.test.ts and tests/): ${MINT_MODULE_PATH}`,
    );
  });
});

describe("AC-STE-522.9 — the AC.8 count is measured over a scan proven to be looking at something", () => {
  test("a positive control through the SAME scan and the SAME roots returns a non-zero count", () => {
    // `attachProjectMilestone` is invoked in production code under BOTH roots
    // today. If this scan is pointed at the wrong directory, or its file walk
    // silently collects nothing, this control goes to zero and says so.
    const control = scanProductionCallSites("attachProjectMilestone");

    const controlVerdict =
      control.length > 0
        ? "non-zero"
        : `ZERO control hits — the scan of [${ROOTS_DESC}] is looking at nothing, so the ` +
          `AC.8 count below is a claim about the search, not about the tree`;
    expect(controlVerdict).toBe("non-zero");

    // Both roots are live, not just the first one.
    const rootsHit = new Set(control.map((s) => s.file.split("/")[0]));
    expect([...rootsHit].sort().join(",")).toBe([...SEARCH_ROOTS].sort().join(","));

    // Same scan, same roots, in the SAME test — the count AC.8 asserts.
    const sites = scanProductionCallSites("createEpic");
    expect(
      `${sites.length} createEpic site(s) under [${ROOTS_DESC}] alongside ` +
        `${control.length} control site(s): ${sites.map((s) => s.file).join(", ") || "(none)"}`,
    ).toBe(
      `1 createEpic site(s) under [${ROOTS_DESC}] alongside ` +
        `${control.length} control site(s): ${MINT_MODULE_PATH}`,
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════
// AC-STE-522.10 — the retry, and the find-before-create it carries, come
// WITH the create when the create moves.
// ═══════════════════════════════════════════════════════════════════════
//
// This protection is not new. It shipped inside `attachProjectMilestone`,
// whose epic branch ran find-before-create INSIDE `retryTransient` precisely
// so that a `createEpic` which lands server-side and then times out is FOUND
// by the retry's find leg and reused. STE-522 moved the create out of that
// loop and into `mintMilestoneEpic`; the move must carry the protection with
// it. A blind re-create on a timeout mints a duplicate Epic — the exact defect
// this milestone exists to close, reintroduced by the fix for it.
//
// ─────────────────────────────────────────────────────────────────────────
// CONTRACT (extends the four points at the top of this file)
// ─────────────────────────────────────────────────────────────────────────
//
// 5. `mintMilestoneEpic` takes an OPTIONAL fourth argument
//    `{ sleep?: (ms: number) => Promise<void> }` — the same injected-wait seam
//    `AttachProjectMilestoneOptions` already uses. Absent ⇒ a real timer.
//    Optional, because the existing 3-argument call sites (AC.1–AC.4 above and
//    the module's own `import.meta.main` front door) must keep working.
//
// 6. The create is retried on transient failure using the canonical
//    `TRANSIENT_RETRY_SCHEDULE_MS` exported from `attach_project_milestone.ts`
//    — imported, never re-declared: two copies of a schedule is two schedules.
//    The success path waits ZERO times (sleep fires only after a caught
//    error), so a mint that works costs no latency.
//
// 7. Before EACH create attempt, when the provider carries the optional
//    `listEpics(project)` op, the helper first enumerates and reuses an Epic
//    whose `name` byte-equals the human `title` — the by-NAME arm, because at
//    mint time no key exists to match on. This is the leg that finds a create
//    that landed and then timed out. `listEpics` stays OPTIONAL for the same
//    reason as point 5; absent ⇒ no find leg, and the AC.1–AC.4 doubles below
//    exercise that shape.
//
// 8. WATCH THE AC.8 CENSUS: it counts syntactic `createEpic(` invocations in
//    production code and pins the total at ONE. The retry must therefore call
//    the single destructured `createEpic` from exactly ONE place in the source
//    — a loop, not a copy-pasted second attempt.

/** A double that can fail, land-then-fail, and be enumerated. */
interface RetryMintDouble {
  /** The tracker's Epic store. Its LENGTH is the duplicate-Epic assertion. */
  epics: { key: string; name: string }[];
  createEpicCalls: number;
  listEpicsCalls: number;
  createArgs: { project: string; opts: { name: string } }[];
  provider: Record<string, unknown>;
}

function makeRetryMintDouble(
  opts: {
    /** The key the tracker allocates for the Epic this mint creates. */
    nextEpicKey?: string;
    /** Thrown by `createEpic`, one per call, FIFO, then it succeeds. */
    createEpicErrors?: Error[];
    /** The create REGISTERS the Epic server-side and then throws. */
    createLandsBeforeThrow?: boolean;
    /** Omit the enumeration op entirely (the degraded, find-less shape). */
    withoutListEpics?: boolean;
  } = {},
): RetryMintDouble {
  const nextEpicKey = opts.nextEpicKey ?? EPIC_KEY;
  const errors = [...(opts.createEpicErrors ?? [])];
  const d: RetryMintDouble = {
    epics: [],
    createEpicCalls: 0,
    listEpicsCalls: 0,
    createArgs: [],
    provider: {},
  };
  const provider: Record<string, unknown> = {
    milestoneBinding: "epic" as const,
    createEpic: async (project: string, o: { name: string }): Promise<{ key: string }> => {
      d.createEpicCalls += 1;
      d.createArgs.push({ project, opts: { ...o } });
      const err = errors.shift();
      if (err) {
        // A create that reaches the server, registers, and THEN times out.
        if (opts.createLandsBeforeThrow) d.epics.push({ key: nextEpicKey, name: o.name });
        throw err;
      }
      d.epics.push({ key: nextEpicKey, name: o.name });
      return { key: nextEpicKey };
    },
  };
  if (!opts.withoutListEpics) {
    provider.listEpics = async (_project: string): Promise<{ key: string; name: string }[]> => {
      d.listEpicsCalls += 1;
      return d.epics.map((e) => ({ ...e }));
    };
  }
  d.provider = provider;
  return d;
}

/** The AC.10 surface: the AC.1 contract plus the injected-wait seam. */
type MintWithOptsFn = (
  provider: unknown,
  project: string,
  title: string,
  opts?: { sleep?: (ms: number) => Promise<void> },
) => Promise<{ epicKey: string; milestoneId: string }>;

async function loadMintWithOpts(): Promise<MintWithOptsFn> {
  return (await loadMintMilestoneEpic()) as unknown as MintWithOptsFn;
}

/** Records every wait instead of taking it — the tests must not cost 7s. */
function sleepRecorder(): { sleeps: number[]; sleep: (ms: number) => Promise<void> } {
  const sleeps: number[] = [];
  return {
    sleeps,
    sleep: async (ms: number) => {
      sleeps.push(ms);
    },
  };
}

describe("AC-STE-522.10 — a transient create retries on the canonical schedule and never duplicates the Epic", () => {
  test("leg 1 — a plain transient failure retries and yields exactly ONE Epic", async () => {
    const mintMilestoneEpic = await loadMintWithOpts();
    // The create fails before reaching the server, so nothing landed and the
    // retry genuinely has to create.
    const d = makeRetryMintDouble({ createEpicErrors: [new Error("read ECONNRESET")] });
    const rec = sleepRecorder();

    const result = await mintMilestoneEpic(d.provider, PROJECT, TITLE, { sleep: rec.sleep });

    // The canonical schedule's FIRST step, taken from the exported constant —
    // not a literal that could drift away from the schedule it names.
    expect(rec.sleeps).toEqual([TRANSIENT_RETRY_SCHEDULE_MS[0]!]);
    expect(rec.sleeps).toEqual([1000]);

    // It really did retry, and the retry really did create.
    expect(d.createEpicCalls).toBe(2);

    // And the tracker holds ONE Epic, not two.
    expect(d.epics.length).toBe(1);
    expect(d.epics[0]!.key).toBe(EPIC_KEY);

    // The mint still yields the pair, derived from the key that came back.
    expect(result.epicKey).toBe(EPIC_KEY);
    expect(result.milestoneId).toBe(milestoneIdFromEpicKey(EPIC_KEY));

    // The retry re-sends the SAME computable summary — a second attempt that
    // re-composed a name would be AC.2's defect wearing a retry.
    expect(d.createArgs.length).toBe(2);
    for (const call of d.createArgs) {
      expect(call.opts.name).toBe(TITLE);
    }
  });

  test("leg 2 — a landed-but-timed-out create is FOUND and reused, never re-created", async () => {
    const mintMilestoneEpic = await loadMintWithOpts();
    // The create registers the Epic server-side, THEN times out. A blind
    // re-create on the retry mints the duplicate this milestone exists to
    // prevent; the find leg has to see the landed Epic first.
    const d = makeRetryMintDouble({
      nextEpicKey: "GF-505",
      createEpicErrors: [new Error("504 Gateway Timeout")],
      createLandsBeforeThrow: true,
    });
    const rec = sleepRecorder();

    const result = await mintMilestoneEpic(d.provider, PROJECT, TITLE, { sleep: rec.sleep });

    expect(rec.sleeps).toEqual([TRANSIENT_RETRY_SCHEDULE_MS[0]!]);

    // The single decisive count: the create ran ONCE. The retry found the
    // landed Epic instead of making a second one.
    expect(d.createEpicCalls).toBe(1);
    expect(d.epics.length).toBe(1);

    // Reuse is asserted on the VALUE, not only on the counts: the key that
    // comes back is the landed Epic's, and the id is derived from it.
    expect(result.epicKey).toBe("GF-505");
    expect(result.milestoneId).toBe(milestoneIdFromEpicKey("GF-505"));
    expect(result.milestoneId).toBe("M_GF_505");

    // The find leg is what ran during the retry — it was consulted at least
    // once, and the enumeration op is the only way the landed Epic could have
    // been seen at all.
    expect(d.listEpicsCalls).toBeGreaterThanOrEqual(1);
  });

  test("leg 3 — the SUCCESS path waits zero times, with or without the find op", async () => {
    const mintMilestoneEpic = await loadMintWithOpts();

    // A retry wrapper that slept BEFORE the first attempt would satisfy both
    // legs above while charging every healthy mint a second of latency.
    const withFind = makeRetryMintDouble();
    const recA = sleepRecorder();
    const a = await mintMilestoneEpic(withFind.provider, PROJECT, TITLE, { sleep: recA.sleep });
    expect(recA.sleeps).toEqual([]);
    expect(withFind.createEpicCalls).toBe(1);
    expect(withFind.epics.length).toBe(1);
    expect(a.epicKey).toBe(EPIC_KEY);

    // `listEpics` is optional: a provider without it still mints, still waits
    // zero times, and still creates exactly once — the shape the module's own
    // `import.meta.main` front door and the AC.1–AC.4 doubles rely on.
    const withoutFind = makeRetryMintDouble({ withoutListEpics: true });
    expect(withoutFind.provider.listEpics).toBeUndefined();
    const recB = sleepRecorder();
    const b = await mintMilestoneEpic(withoutFind.provider, PROJECT, TITLE, { sleep: recB.sleep });
    expect(recB.sleeps).toEqual([]);
    expect(withoutFind.createEpicCalls).toBe(1);
    expect(withoutFind.epics.length).toBe(1);
    expect(b.milestoneId).toBe(MILESTONE_ID);
  });

  test("leg 4 — a persistent transient failure exhausts 1s+2s+4s, then surfaces the error", async () => {
    const mintMilestoneEpic = await loadMintWithOpts();
    // One more failure than the schedule has steps: the wrapper must stop
    // after the third backoff rather than looping forever.
    const d = makeRetryMintDouble({
      createEpicErrors: [
        new Error("504 Gateway Timeout"),
        new Error("504 Gateway Timeout"),
        new Error("504 Gateway Timeout"),
        new Error("504 Gateway Timeout"),
      ],
    });
    const rec = sleepRecorder();

    let returned: unknown;
    let caught: unknown = null;
    try {
      returned = await mintMilestoneEpic(d.provider, PROJECT, TITLE, { sleep: rec.sleep });
    } catch (err) {
      caught = err;
    }

    expect(returned).toBeUndefined();
    expect(caught).toBeInstanceOf(Error);
    // The ORIGINAL failure surfaces, not a locally re-worded one.
    expect((caught as Error).message).toMatch(/504|Gateway/i);

    // The whole canonical schedule, in order, and nothing beyond it.
    expect(rec.sleeps).toEqual([...TRANSIENT_RETRY_SCHEDULE_MS]);
    expect(rec.sleeps).toEqual([1000, 2000, 4000]);

    // One fast-path attempt plus three retries; nothing ever landed.
    expect(d.createEpicCalls).toBe(4);
    expect(d.epics.length).toBe(0);
  });
});

// ───────────────────────────────────────────────────────────────────────
// AC-STE-522.10 — the find leg runs before the FIRST attempt, not only on
// retries, which makes minting idempotent.
//
// Surfaced by this FR's audit as undocumented and unpinned. It is desirable
// behaviour and squarely on this milestone's subject: re-running a mint —
// after a crash, a resumed session, an operator repeating a step — must not
// produce a second Epic. Left unpinned, a later "optimization" moving the
// find inside the catch would silently restore duplicate minting on exactly
// the re-run path an operator is most likely to take.
// ───────────────────────────────────────────────────────────────────────
describe("AC-STE-522.10 — minting is idempotent: a re-run reuses, never duplicates", () => {
  test("a second mint of the same title returns the same key and creates nothing", async () => {
    const mintMilestoneEpic = await loadMintMilestoneEpic();
    const d = makeRetryMintDouble({});
    const rec = sleepRecorder();

    const first = await mintMilestoneEpic(d.provider as never, "GF", "Waiting States II", {
      sleep: rec.sleep,
    });
    const createsAfterFirst = d.createEpicCalls;

    const second = await mintMilestoneEpic(d.provider as never, "GF", "Waiting States II", {
      sleep: rec.sleep,
    });

    // Same identity both times — a second Epic would have a different key and
    // therefore a different milestone id, which is the duplicate-Epic defect.
    expect(second.epicKey).toBe(first.epicKey);
    expect(second.milestoneId).toBe(first.milestoneId);

    // And it is a genuine reuse, not a same-key coincidence from the double:
    // the create op was not called a second time, and one Epic exists.
    expect(createsAfterFirst).toBe(1);
    expect(d.createEpicCalls).toBe(1);
    expect(d.epics.length).toBe(1);

    // The reuse path costs no backoff — it is a find, not a recovery.
    expect(rec.sleeps).toEqual([]);
  });
});
