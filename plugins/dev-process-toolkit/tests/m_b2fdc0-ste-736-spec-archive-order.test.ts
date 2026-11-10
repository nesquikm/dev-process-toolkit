// STE-736 (M_b2fdc0) — AC-STE-736.1: /spec-archive milestone archival must move
// the plan into specs/plan/archive/ BEFORE it rewrites the FR links, or the
// rewrite computes each link from the plan's OLD folder and the archived plan
// ends up with links that do not resolve.
//
// Two legs:
//   1. a prose-order pin over skills/spec-archive/SKILL.md's milestone-group
//      procedure: the plan's `git mv` into specs/plan/archive/ comes before the
//      first `rewriteArchiveLinks` mention;
//   2. a behavioural leg that READS that order out of the skill, runs it against
//      a temporary spec tree through the shipped helper, and asserts every FR
//      link in the archived plan resolves. A control leg pins that the order is
//      load-bearing: rewrite-then-move leaves the archived plan broken.
//
// Does not touch the STE-731 pins (AC-STE-731.5: branch gate < single atomic
// commit < releaseLock; "Universal pre-commit branch gate") — this file reads
// only the plan move and the link rewrite.
//
// All ids are fake (STE-90xx, M_feed0x): this is a public repo.

import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { PLUGIN_ROOT, brokenFrLinks, cleanupTemps, frLinkTargets, tree } from "./_m_b2fdc0_ste736_fixture";

afterAll(() => cleanupTemps());

const SKILL = join(PLUGIN_ROOT, "skills", "spec-archive", "SKILL.md");

function milestoneSection(doc: string): string {
  const start = "**Milestone-group archival**";
  const end = "**Plan-only archival**";
  const a = doc.indexOf(start);
  const b = doc.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw new Error(`section ${start} .. ${end} not found in spec-archive SKILL.md`);
  return doc.slice(a, b);
}

/** Offsets, inside the milestone-group procedure, of the plan move and the first link rewrite. */
function planMoveAndRewrite(section: string): { planMove: number; rewrite: number } {
  return {
    planMove: section.search(/git mv specs\/plan\/M<N>\.md specs\/plan\/archive\/M<N>\.md/),
    rewrite: section.search(/rewriteArchiveLinks/),
  };
}

type RewriteFn = (repoRoot: string, frId: string) => { filesChanged: string[] };
async function rewriteFn(): Promise<RewriteFn> {
  const mod = await import(join(PLUGIN_ROOT, "adapters/_shared/src/spec_archive/rewrite_links.ts"));
  return mod.rewriteArchiveLinks as RewriteFn;
}

function mv(repo: string, from: string, to: string): void {
  mkdirSync(dirname(join(repo, to)), { recursive: true });
  renameSync(join(repo, from), join(repo, to));
}

const FR_BODY = "---\nstatus: active\n---\n\n# Fake FR\n";
const FRS = ["STE-9041", "STE-9042"];
const PLAN = "specs/plan/M_feed09.md";
const ARCHIVED_PLAN = "specs/plan/archive/M_feed09.md";

/** A live tree before milestone archival: two active FRs and an active plan linking them. */
function liveTree(label: string): string {
  return tree(label, {
    "specs/frs/STE-9041.md": FR_BODY,
    "specs/frs/STE-9042.md": FR_BODY,
    [PLAN]: "# Plan\n\n- [STE-9041](../frs/STE-9041.md) first\n- [STE-9042](./../frs/STE-9042.md) second\n",
    "specs/requirements.md": "| STE-9041 | x | [link](frs/STE-9041.md) |\n| STE-9042 | x | [link](frs/STE-9042.md) |\n",
  });
}

/** Run milestone archival in the given order through the shipped helper. */
async function archive(repo: string, order: "plan-first" | "rewrite-first"): Promise<void> {
  const rewrite = await rewriteFn();
  if (order === "plan-first") mv(repo, PLAN, ARCHIVED_PLAN);
  for (const id of FRS) {
    mv(repo, `specs/frs/${id}.md`, `specs/frs/archive/${id}.md`);
    rewrite(repo, id);
  }
  if (order === "rewrite-first") mv(repo, PLAN, ARCHIVED_PLAN);
}

describe("AC-STE-736.1 — /spec-archive milestone archival moves the plan before rewriting links", () => {
  const section = milestoneSection(readFileSync(SKILL, "utf-8"));

  test("prose order: the plan's git mv into specs/plan/archive/ comes before any rewriteArchiveLinks call", () => {
    const o = planMoveAndRewrite(section);
    expect(o.planMove).toBeGreaterThanOrEqual(0);
    expect(o.rewrite).toBeGreaterThanOrEqual(0);
    expect({ planMoveBeforeRewrite: o.planMove < o.rewrite }).toEqual({ planMoveBeforeRewrite: true });
  });

  test("behaviour: the documented order leaves every archived-plan FR link resolving", async () => {
    const o = planMoveAndRewrite(section);
    const documented = o.planMove >= 0 && o.planMove < o.rewrite ? "plan-first" : "rewrite-first";
    const repo = liveTree("order-documented");
    await archive(repo, documented);
    const plan = readFileSync(join(repo, ARCHIVED_PLAN), "utf-8");
    expect(frLinkTargets(plan).length).toBe(2);
    expect({ order: documented, broken: brokenFrLinks(repo, ARCHIVED_PLAN) }).toEqual({
      order: documented,
      broken: [],
    });
    // requirements.md keeps today's form.
    expect(readFileSync(join(repo, "specs/requirements.md"), "utf-8")).toBe(
      "| STE-9041 | x | [link](frs/archive/STE-9041.md) |\n| STE-9042 | x | [link](frs/archive/STE-9042.md) |\n",
    );
  });

  test("control: rewriting before the plan moves leaves the archived plan's FR links broken", async () => {
    const repo = liveTree("order-control");
    await archive(repo, "rewrite-first");
    expect(brokenFrLinks(repo, ARCHIVED_PLAN).length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Plan-only archival (STE-200: zero active FRs). The plan moves into
// specs/plan/archive/ but no FR is archived in the run, so rewriteArchiveLinks
// never fires. A plan whose FRs were archived EARLIER carries links of the form
// `../frs/archive/<id>.md`, which resolve from specs/plan/ and break on the move.
// The procedure must repair the moved plan's links after its git mv, through
// `repairArchivedPlanLinks(repoRoot, planPath)` from rewrite_links.ts
// (planPath relative to repoRoot).

function planOnlySection(doc: string): string {
  const start = "**Plan-only archival**";
  const end = "`--plan-only` flag";
  const a = doc.indexOf(start);
  const b = doc.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw new Error(`section ${start} .. ${end} not found in spec-archive SKILL.md`);
  return doc.slice(a, b);
}

type RepairFn = (repoRoot: string, planPath: string) => unknown;
async function repairFn(): Promise<RepairFn | undefined> {
  const mod = await import(join(PLUGIN_ROOT, "adapters/_shared/src/spec_archive/rewrite_links.ts"));
  return mod.repairArchivedPlanLinks as RepairFn | undefined;
}

const PO_PLAN = "specs/plan/M_feed10.md";
const PO_ARCHIVED_PLAN = "specs/plan/archive/M_feed10.md";
const RESOLVING_LINK = "[STE-9053](../../frs/archive/STE-9053.md)";

describe("AC-STE-736.1 — /spec-archive plan-only archival repairs the moved plan's FR links", () => {
  const section = planOnlySection(readFileSync(SKILL, "utf-8"));

  test("prose order: the plan-only procedure calls repairArchivedPlanLinks after the plan's git mv", () => {
    const planMove = section.search(/git mv specs\/plan\/M<N>\.md specs\/plan\/archive\/M<N>\.md/);
    const repair = section.search(/repairArchivedPlanLinks/);
    expect({ planMove: planMove >= 0, repair: repair >= 0, repairAfterMove: planMove >= 0 && repair > planMove }).toEqual({
      planMove: true,
      repair: true,
      repairAfterMove: true,
    });
  });

  test("behaviour: after the plan-only move, repairArchivedPlanLinks leaves every FR link resolving", async () => {
    // FRs archived by an earlier run while the plan was active: the plan already
    // links them as ../frs/archive/<id>.md (resolves from specs/plan/).
    const repo = tree("plan-only", {
      "specs/frs/archive/STE-9051.md": FR_BODY,
      "specs/frs/archive/STE-9052.md": FR_BODY,
      "specs/frs/archive/STE-9053.md": FR_BODY,
      [PO_PLAN]:
        "# Plan\n\n- [STE-9051](../frs/archive/STE-9051.md) first\n- [STE-9052](./../frs/archive/STE-9052.md) second\n",
    });
    expect(brokenFrLinks(repo, PO_PLAN)).toEqual([]);
    mv(repo, PO_PLAN, PO_ARCHIVED_PLAN);
    // A link that already resolves from the archived plan's folder.
    writeFileSync(
      join(repo, PO_ARCHIVED_PLAN),
      readFileSync(join(repo, PO_ARCHIVED_PLAN), "utf-8") + `- ${RESOLVING_LINK} third\n`,
    );
    expect(brokenFrLinks(repo, PO_ARCHIVED_PLAN).length).toBe(2);

    const repair = await repairFn();
    expect(typeof repair).toBe("function");
    repair!(repo, PO_ARCHIVED_PLAN);

    const plan = readFileSync(join(repo, PO_ARCHIVED_PLAN), "utf-8");
    expect(frLinkTargets(plan).length).toBe(3);
    expect(brokenFrLinks(repo, PO_ARCHIVED_PLAN)).toEqual([]);
    expect(plan).toContain(`- ${RESOLVING_LINK} third\n`);
    expect(plan.startsWith("# Plan\n\n- [STE-9051](")).toBe(true);
  });

  test("behaviour: on a plan whose links all resolve, repairArchivedPlanLinks changes nothing", async () => {
    const body = `# Plan\n\n- ${RESOLVING_LINK}\n- [STE-9054](../../frs/STE-9054.md)\n`;
    const repo = tree("plan-only-keep", {
      "specs/frs/archive/STE-9053.md": FR_BODY,
      "specs/frs/STE-9054.md": FR_BODY,
      [PO_ARCHIVED_PLAN]: body,
    });
    const repair = await repairFn();
    expect(typeof repair).toBe("function");
    repair!(repo, PO_ARCHIVED_PLAN);
    expect(readFileSync(join(repo, PO_ARCHIVED_PLAN), "utf-8")).toBe(body);
  });
});

// ---------------------------------------------------------------------------
// Fragment / query links (Phase 3 review finding). A link target such as
// `../frs/STE-1.md#ac-1` or `../frs/STE-1.md?plain=1` names an FR file just as
// `../frs/STE-1.md` does. After archival its PATH part must resolve from the
// archived plan's folder, and its `#fragment` / `?query` suffix must survive
// byte-for-byte. A fragment link whose path already resolves is left alone.

/** Every relative FR link target carrying a `?query` or `#fragment`, split into path and suffix. */
function suffixedFrLinks(text: string): { target: string; path: string; suffix: string }[] {
  const out: { target: string; path: string; suffix: string }[] = [];
  for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = m[1]!;
    if (/^[a-z]+:/i.test(target) || target.startsWith("/")) continue;
    const cut = target.search(/[?#]/);
    if (cut < 0) continue;
    const path = target.slice(0, cut);
    if (/(^|\/)frs\/(archive\/)?[^/]+\.md$/.test(path)) out.push({ target, path, suffix: target.slice(cut) });
  }
  return out;
}

/** The suffixed FR links in `relFile` whose path part does not resolve, plus every suffix seen. */
function suffixedReport(repo: string, relFile: string): { broken: string[]; suffixes: string[] } {
  const abs = join(repo, relFile);
  const links = suffixedFrLinks(readFileSync(abs, "utf-8"));
  return {
    broken: links.filter((l) => !existsSync(resolve(dirname(abs), l.path))).map((l) => l.target),
    suffixes: links.map((l) => l.suffix),
  };
}

describe("AC-STE-736.1 — fragment and query FR links survive milestone archival (plan moved first)", () => {
  test("rewriteArchiveLinks: each fragment/query link's path resolves and its suffix is kept byte-for-byte", async () => {
    const repo = tree("frag-milestone", {
      "specs/frs/STE-9061.md": FR_BODY,
      "specs/frs/STE-9062.md": FR_BODY,
      "specs/plan/M_feed11.md":
        "# Plan\n\n- [STE-9061](../frs/STE-9061.md#ac-ste-90611) first\n- [STE-9062](./../frs/STE-9062.md?plain=1#L3) second\n",
    });
    expect(suffixedReport(repo, "specs/plan/M_feed11.md").broken).toEqual([]);
    const rewrite = await rewriteFn();
    mv(repo, "specs/plan/M_feed11.md", "specs/plan/archive/M_feed11.md");
    for (const id of ["STE-9061", "STE-9062"]) {
      mv(repo, `specs/frs/${id}.md`, `specs/frs/archive/${id}.md`);
      rewrite(repo, id);
    }
    expect(suffixedReport(repo, "specs/plan/archive/M_feed11.md")).toEqual({
      broken: [],
      suffixes: ["#ac-ste-90611", "?plain=1#L3"],
    });
  });

  test("rewriteArchiveLinks: an already-broken fragment link to ANOTHER FR (v3.3.0 shape) is repaired, suffix kept", async () => {
    const repo = tree("frag-other-fr", {
      "specs/frs/STE-9063.md": FR_BODY,
      "specs/frs/archive/STE-9064.md": FR_BODY,
      "specs/plan/archive/M_feed12.md":
        "# Plan\n\n- [STE-9063](../../frs/STE-9063.md) first\n- [STE-9064](../frs/archive/STE-9064.md#notes) second\n",
    });
    expect(suffixedReport(repo, "specs/plan/archive/M_feed12.md").broken).toEqual(["../frs/archive/STE-9064.md#notes"]);
    const rewrite = await rewriteFn();
    mv(repo, "specs/frs/STE-9063.md", "specs/frs/archive/STE-9063.md");
    rewrite(repo, "STE-9063");
    expect(suffixedReport(repo, "specs/plan/archive/M_feed12.md")).toEqual({ broken: [], suffixes: ["#notes"] });
    expect(brokenFrLinks(repo, "specs/plan/archive/M_feed12.md")).toEqual([]);
  });

  test("rewriteArchiveLinks: a fragment link that already resolves is not changed", async () => {
    const keep = "[STE-9066](../../frs/archive/STE-9066.md#ac-1)";
    const repo = tree("frag-keep-rewrite", {
      "specs/frs/STE-9065.md": FR_BODY,
      "specs/frs/archive/STE-9066.md": FR_BODY,
      "specs/plan/archive/M_feed13.md": `# Plan\n\n- [STE-9065](../../frs/STE-9065.md#ac-2) first\n- ${keep} second\n`,
    });
    const rewrite = await rewriteFn();
    mv(repo, "specs/frs/STE-9065.md", "specs/frs/archive/STE-9065.md");
    rewrite(repo, "STE-9065");
    const plan = readFileSync(join(repo, "specs/plan/archive/M_feed13.md"), "utf-8");
    expect(plan).toContain(`- ${keep} second\n`);
    expect(suffixedReport(repo, "specs/plan/archive/M_feed13.md")).toEqual({ broken: [], suffixes: ["#ac-2", "#ac-1"] });
  });
});

describe("AC-STE-736.1 / .2 — repairArchivedPlanLinks handles fragment and query FR links", () => {
  test("a broken fragment/query link is repaired with its suffix byte-for-byte; a resolving one is untouched", async () => {
    const keep = "[STE-9073](../../frs/archive/STE-9073.md#ac-ste-90731)";
    const repo = tree("frag-plan-only", {
      "specs/frs/archive/STE-9071.md": FR_BODY,
      "specs/frs/archive/STE-9072.md": FR_BODY,
      "specs/frs/archive/STE-9073.md": FR_BODY,
      [PO_PLAN]:
        `# Plan\n\n- [STE-9071](../frs/archive/STE-9071.md#ac-ste-90711) first\n- [STE-9072](../frs/archive/STE-9072.md?x=1) second\n`,
    });
    mv(repo, PO_PLAN, PO_ARCHIVED_PLAN);
    writeFileSync(join(repo, PO_ARCHIVED_PLAN), readFileSync(join(repo, PO_ARCHIVED_PLAN), "utf-8") + `- ${keep} third\n`);
    expect(suffixedReport(repo, PO_ARCHIVED_PLAN).broken.length).toBe(2);

    const repair = await repairFn();
    repair!(repo, PO_ARCHIVED_PLAN);

    const plan = readFileSync(join(repo, PO_ARCHIVED_PLAN), "utf-8");
    expect(suffixedReport(repo, PO_ARCHIVED_PLAN)).toEqual({
      broken: [],
      suffixes: ["#ac-ste-90711", "?x=1", "#ac-ste-90731"],
    });
    expect(plan).toContain(`- ${keep} third\n`);
  });

  test("on a plan whose fragment links all resolve, repairArchivedPlanLinks changes nothing", async () => {
    const body = "# Plan\n\n- [STE-9074](../../frs/archive/STE-9074.md#ac-1)\n- [STE-9075](../../frs/STE-9075.md?plain=1#L2)\n";
    const repo = tree("frag-plan-only-keep", {
      "specs/frs/archive/STE-9074.md": FR_BODY,
      "specs/frs/STE-9075.md": FR_BODY,
      [PO_ARCHIVED_PLAN]: body,
    });
    const repair = await repairFn();
    repair!(repo, PO_ARCHIVED_PLAN);
    expect(readFileSync(join(repo, PO_ARCHIVED_PLAN), "utf-8")).toBe(body);
  });
});
