// STE-734 — a bug found after ship and before merge has a named route.
//
// AC-STE-734.1: docs/layout-reference.md gains a section naming the route
//   (new milestone via `/spec-write --bug` on the same branch, shipped as the
//   next patch release; archived FRs and plans stay frozen; writing into
//   `specs/frs/archive/` skips every check on active FRs).
// AC-STE-734.2: probe #27's collision remedy names that route first, ahead of
//   its two existing options, and never suggests writing into the archive.
// AC-STE-734.3: the pins below fail when either text is removed — proved by
//   running the same predicates over a mutated copy of the real text.
// AC-STE-734.4: probe #27 verdicts are unchanged on every fixture shape.

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runFrontmatterMilestoneNotArchivedProbe } from "../adapters/_shared/src/frontmatter_milestone_not_archived";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const LAYOUT_DOC = join(PLUGIN_ROOT, "docs", "layout-reference.md");

// ---------- fixture ----------

interface Fixture {
  root: string;
  cleanup: () => void;
}

function frBody(milestone: string, status: "active" | "archived"): string {
  return `---\ntitle: t\nmilestone: ${milestone}\nstatus: ${status}\narchived_at: ${status === "archived" ? "2026-01-01T00:00:00Z" : "null"}\ntracker: {}\ncreated_at: 2026-01-01T00:00:00Z\n---\n\nbody\n`;
}

function makeFixture(opts: {
  active?: { id: string; milestone: string }[];
  archivedFrs?: { id: string; milestone: string }[];
  activeInlineArchived?: { id: string; milestone: string }[];
  malformed?: { id: string; body: string }[];
  activePlans?: string[];
  archivedPlans?: string[];
}): Fixture {
  const root = mkdtempSync(join(tmpdir(), "ste734-"));
  const specs = join(root, "specs");
  mkdirSync(join(specs, "frs", "archive"), { recursive: true });
  mkdirSync(join(specs, "plan", "archive"), { recursive: true });
  for (const fr of opts.active ?? []) writeFileSync(join(specs, "frs", `${fr.id}.md`), frBody(fr.milestone, "active"));
  for (const fr of opts.activeInlineArchived ?? [])
    writeFileSync(join(specs, "frs", `${fr.id}.md`), frBody(fr.milestone, "archived"));
  for (const fr of opts.archivedFrs ?? [])
    writeFileSync(join(specs, "frs", "archive", `${fr.id}.md`), frBody(fr.milestone, "archived"));
  for (const fr of opts.malformed ?? []) writeFileSync(join(specs, "frs", `${fr.id}.md`), fr.body);
  for (const m of opts.activePlans ?? []) writeFileSync(join(specs, "plan", `${m}.md`), `---\nmilestone: ${m}\nstatus: active\n---\n`);
  for (const m of opts.archivedPlans ?? [])
    writeFileSync(join(specs, "plan", "archive", `${m}.md`), `---\nmilestone: ${m}\nstatus: archived\n---\n`);
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

async function collisionMessage(): Promise<string> {
  const fx = makeFixture({ active: [{ id: "FR-1", milestone: "M_aaaaaa" }], archivedPlans: ["M_aaaaaa"] });
  try {
    const r = await runFrontmatterMilestoneNotArchivedProbe(fx.root);
    expect(r.violations.length).toBe(1);
    return r.violations[0]!.message;
  } finally {
    fx.cleanup();
  }
}

function remedyOf(message: string): string {
  const line = message.split("\n").find((l) => l.startsWith("Remedy: "));
  if (!line) throw new Error(`no Remedy line in:\n${message}`);
  return line.slice("Remedy: ".length);
}

// ---------- predicates (shared by the pins and their mutation proofs) ----------

const ROUTE_RE = /\/spec-write\s+--bug/;
const SAME_BRANCH_RE = /same branch/i;
const PATCH_RE = /patch( release)?/i;
const NEGATION_RE = /\b(never|not|don't|do not|no)\b/i;

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/);
}

/** Every sentence that mentions specs/frs/archive must be a prohibition. */
function archiveOnlyProhibited(text: string): string[] {
  return sentences(text).filter((s) => /specs\/frs\/archive/.test(s) && !NEGATION_RE.test(s));
}

/** Returns a list of failures; an empty list means the remedy passes the AC-STE-734.2 pin. */
function remedyFailures(remedy: string): string[] {
  const fails: string[] = [];
  const route = remedy.search(ROUTE_RE);
  if (route < 0) fails.push("remedy does not name `/spec-write --bug`");
  if (!SAME_BRANCH_RE.test(remedy)) fails.push("remedy does not say `same branch`");
  if (!PATCH_RE.test(remedy)) fails.push("remedy does not name the patch release");
  // The two existing options must survive, after the route.
  const editOpt = remedy.search(/frontmatter `milestone:`/);
  const unarchiveOpt = remedy.search(/unarchive/i);
  if (editOpt < 0) fails.push("existing option (edit the FR's `milestone:`) is gone");
  if (unarchiveOpt < 0) fails.push("existing option (unarchive the plan) is gone");
  if (route >= 0 && editOpt >= 0 && route > editOpt) fails.push("route is not ahead of the edit-milestone option");
  if (route >= 0 && unarchiveOpt >= 0 && route > unarchiveOpt) fails.push("route is not ahead of the unarchive option");
  const stale = remedy.search(/stale milestone number/i);
  if (route >= 0 && stale >= 0 && route > stale) fails.push("route is not ahead of the stale-number option");
  for (const s of archiveOnlyProhibited(remedy)) fails.push(`remedy suggests writing into the archive: ${s}`);
  return fails;
}

interface Section {
  heading: string;
  body: string;
}

function h2Sections(md: string): Section[] {
  const out: Section[] = [];
  const parts = md.split(/^(?=## )/m);
  for (const p of parts) {
    if (!p.startsWith("## ")) continue;
    const nl = p.indexOf("\n");
    out.push({ heading: p.slice(3, nl < 0 ? undefined : nl).trim(), body: nl < 0 ? "" : p.slice(nl + 1) });
  }
  return out;
}

function findRouteSection(md: string): Section | undefined {
  return h2Sections(md).find((s) => /ship/i.test(s.heading) && /merge/i.test(s.heading));
}

/** Returns a list of failures; empty means the layout doc passes the AC-STE-734.1 pin. */
function layoutFailures(md: string): string[] {
  const sec = findRouteSection(md);
  if (!sec) return ["no `## ` section whose heading names both ship and merge"];
  const b = sec.body;
  const fails: string[] = [];
  if (!ROUTE_RE.test(b)) fails.push("section does not name `/spec-write --bug`");
  if (!/new milestone/i.test(b)) fails.push("section does not say to open a new milestone");
  if (!SAME_BRANCH_RE.test(b)) fails.push("section does not say `same branch`");
  if (!/implement/i.test(b)) fails.push("section does not say to implement it");
  if (!/next patch release/i.test(b)) fails.push("section does not say `next patch release`");
  if (!/frozen/i.test(b)) fails.push("section does not say archived FRs and plans stay frozen");
  if (!/archived FRs/i.test(b) || !/plans?/i.test(b)) fails.push("section does not name both archived FRs and plans");
  if (!/specs\/frs\/archive\//.test(b)) fails.push("section does not name `specs/frs/archive/`");
  if (!/skips every check on active FRs/i.test(b)) fails.push("section does not say writing there skips every check on active FRs");
  return fails;
}

// ---------- AC-STE-734.1 ----------

describe("AC-STE-734.1 — layout-reference names the after-ship, before-merge route", () => {
  test("docs/layout-reference.md carries the section with every required clause", () => {
    const md = readFileSync(LAYOUT_DOC, "utf-8");
    expect(layoutFailures(md)).toEqual([]);
  });
});

// ---------- AC-STE-734.2 ----------

describe("AC-STE-734.2 — probe #27 collision remedy names the route first", () => {
  test("collision remedy names /spec-write --bug on the same branch as the next patch, ahead of the two old options", async () => {
    const remedy = remedyOf(await collisionMessage());
    expect(remedyFailures(remedy)).toEqual([]);
  });

  test("collision remedy never suggests writing into specs/frs/archive/", async () => {
    const remedy = remedyOf(await collisionMessage());
    expect(archiveOnlyProhibited(remedy)).toEqual([]);
  });
});

// ---------- AC-STE-734.3 ----------

describe("AC-STE-734.3 — removing the remedy route or the layout section turns the pins red", () => {
  // Positive controls: synthetic texts that satisfy the pins, so the
  // mutation proofs below can't pass vacuously on an already-failing input.
  const GOOD_REMEDY =
    "Active FR points at an archived M<N>.md. If the milestone shipped and a bug turned up before merge, open a new milestone with /spec-write --bug on the same branch and ship it as the next patch release; never write into specs/frs/archive/. Otherwise the FR was drafted with a stale milestone number. Resolve by editing the FR's frontmatter `milestone:` to a live number, or unarchive the plan file.";
  const GOOD_DOC = [
    "# Doc",
    "",
    "## A bug found after ship and before merge",
    "",
    "Open a new milestone with `/spec-write --bug` on the same branch, implement it, and ship it as the next patch release.",
    "Archived FRs and plans stay frozen. Writing into `specs/frs/archive/` skips every check on active FRs.",
    "",
    "## Test fixtures",
    "",
    "x",
    "",
  ].join("\n");

  test("positive controls pass the pins", () => {
    expect(remedyFailures(GOOD_REMEDY)).toEqual([]);
    expect(layoutFailures(GOOD_DOC)).toEqual([]);
  });

  test("control: removing the route from a passing remedy turns the remedy pin red", () => {
    const mutated = GOOD_REMEDY.replace(/\/spec-write --bug/g, "a new FR");
    expect(remedyFailures(mutated).length).toBeGreaterThan(0);
  });

  test("control: a remedy that tells you to write into the archive turns the pin red", () => {
    const mutated = GOOD_REMEDY.replace("never write into specs/frs/archive/.", "Or write the fix into specs/frs/archive/.");
    expect(remedyFailures(mutated).length).toBeGreaterThan(0);
  });

  test("control: removing the layout section from a passing doc turns the layout pin red", () => {
    const mutated = GOOD_DOC.replace(/## A bug found after ship and before merge[\s\S]*?(?=## Test fixtures)/, "");
    expect(layoutFailures(mutated).length).toBeGreaterThan(0);
  });

  test("real remedy: stripping the route clause from the shipped remedy turns the pin red", async () => {
    const remedy = remedyOf(await collisionMessage());
    // The real remedy must pass first, otherwise this proof is vacuous.
    expect(remedyFailures(remedy)).toEqual([]);
    const mutated = remedy.replace(/[^.]*\/spec-write\s+--bug[^.]*\./g, "");
    expect(remedyFailures(mutated).length).toBeGreaterThan(0);
  });

  test("real doc: deleting the route section from layout-reference.md turns the pin red", () => {
    const md = readFileSync(LAYOUT_DOC, "utf-8");
    expect(layoutFailures(md)).toEqual([]);
    const sec = findRouteSection(md)!;
    const mutated = md.replace(`## ${sec.heading}\n${sec.body}`, "");
    expect(mutated).not.toBe(md);
    expect(layoutFailures(mutated).length).toBeGreaterThan(0);
  });
});

// ---------- AC-STE-734.4 ----------

describe("AC-STE-734.4 — probe #27 verdicts unchanged on every fixture shape", () => {
  function kindOf(note: string): string {
    if (/collision/.test(note)) return "collision";
    if (/orphan/.test(note)) return "orphan";
    if (/malformed/.test(note)) return "malformed";
    return "unknown";
  }

  test("pass / collision / orphan / malformed / vacuous-archived each keep their verdict", async () => {
    const fx = makeFixture({
      active: [
        { id: "FR-PASS", milestone: "M_live01" },
        { id: "FR-COLL", milestone: "M_gone01" },
        { id: "FR-ORPH", milestone: "M_none01" },
      ],
      archivedFrs: [{ id: "FR-ARCH", milestone: "M_gone01" }],
      activeInlineArchived: [{ id: "FR-INLINE", milestone: "M_gone01" }],
      malformed: [{ id: "FR-MAL", body: "---\ntitle: t\nstatus: active\n---\n\nbody\n" }],
      activePlans: ["M_live01"],
      archivedPlans: ["M_gone01"],
    });
    try {
      const r = await runFrontmatterMilestoneNotArchivedProbe(fx.root);
      const byFile = Object.fromEntries(
        r.violations.map((v) => [v.file.split("/").pop()!, kindOf(v.note)]),
      );
      expect(byFile).toEqual({
        "FR-COLL.md": "collision",
        "FR-ORPH.md": "orphan",
        "FR-MAL.md": "malformed",
      });
      for (const v of r.violations) {
        expect(v.message.split("\n")[0]).toBe(`frontmatter_milestone_not_archived: ${v.reason}`);
        expect(v.message).toMatch(/^Remedy: /m);
        expect(v.message).toMatch(/^Context: file=specs\/frs\/FR-[A-Z]+\.md, probe=frontmatter_milestone_not_archived$/m);
      }
    } finally {
      fx.cleanup();
    }
  });

  test("an empty tree and a tree with no specs/frs both stay clean", async () => {
    const empty = makeFixture({});
    const bare = mkdtempSync(join(tmpdir(), "ste734-bare-"));
    try {
      expect((await runFrontmatterMilestoneNotArchivedProbe(empty.root)).violations).toEqual([]);
      expect((await runFrontmatterMilestoneNotArchivedProbe(bare)).violations).toEqual([]);
    } finally {
      empty.cleanup();
      rmSync(bare, { recursive: true, force: true });
    }
  });

  test("orphan and malformed remedies carry no after-ship route (only the collision remedy changes)", async () => {
    const fx = makeFixture({
      active: [{ id: "FR-ORPH", milestone: "M_none01" }],
      malformed: [{ id: "FR-MAL", body: "---\ntitle: t\nstatus: active\n---\n" }],
    });
    try {
      const r = await runFrontmatterMilestoneNotArchivedProbe(fx.root);
      expect(r.violations.length).toBe(2);
      for (const v of r.violations) expect(remedyOf(v.message)).not.toMatch(ROUTE_RE);
    } finally {
      fx.cleanup();
    }
  });
});
