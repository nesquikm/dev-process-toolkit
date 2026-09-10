// STE-584, pre-PR milestone review (HIGH): the FR-scoped resume chain must wait
// for a busy sibling too.
//
// THE DEFECT. STE-584 demoted a spanning milestone at MILESTONE scope: while a
// declared sibling repo still holds active FRs, `classifyResume(root, M)` carries
// `awaitingSiblings` and `resumeChain` orders nothing. The FR-scoped chain decided
// its ship tail from `lastActiveFr` alone — a count of THIS repo's active FRs — so
// `/deliver <last-local-FR>` on a spanning milestone still ordered `/spec-archive`
// then `/ship-milestone` while the sibling was busy: the exact early release the
// FR exists to stop, reached through a second path. The `/implement` close offer
// that STE-584 quieted is omitted on driven runs, so nothing else stopped it.
//
// ONE PREDICATE. The fix must not re-derive "sibling busy" in the classifier:
// both scopes read the helper `classifyActivePlans` itself is built on, so the
// FR-scope entry is byte-identical to the milestone-scope entry for the same
// sibling state, and `resume_classifier.ts` never calls `resolveSpansRepos`.

import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { readFileSync, renameSync } from "node:fs";
import { join } from "node:path";

import * as ship from "../adapters/_shared/src/active_plan_ship_ready";
import {
  classifyResume,
  renderResumePlan,
  resumeChain,
  type FrResumeClassification,
} from "../adapters/_shared/src/resume_classifier";
import { SpansReposError } from "../adapters/_shared/src/spans_repos";
import { makeSpanFixture, type SpanFixture } from "./_span_fixture";

const M = "M_GF_78";
const LOCAL_FR = "GF-1";
const SIBLING_FR = "GB-1";
const pluginRoot = join(import.meta.dir, "..");
const repoRoot = join(pluginRoot, "..", "..");
const CLASSIFIER = join(pluginRoot, "adapters", "_shared", "src", "resume_classifier.ts");
const DELIVER_SKILL = join(pluginRoot, "skills", "deliver", "SKILL.md");
const DELIVER_REF = join(pluginRoot, "docs", "deliver-reference.md");
const IMPLEMENT_SKILL = join(pluginRoot, "skills", "implement", "SKILL.md");

const ENTRY_RE = /^M_GF_78 \(glacy-app-be: 1 active FRs?\)$/;

/** Root A holds the last local active FR; root B's state is set per test. */
function lastLocalFr(f: SpanFixture, spans: "declared" | "undeclared" | "unlocatable"): void {
  if (spans === "declared") f.planA({ "glacy-app-fe": ".", "glacy-app-be": f.b });
  else if (spans === "unlocatable")
    f.planA({ "glacy-app-fe": ".", "glacy-app-be": join(f.b, "no-such-repo") });
  else f.planA({});
  f.activeFr(f.a, LOCAL_FR, M);
}

async function frClassify(f: SpanFixture): Promise<FrResumeClassification> {
  return classifyResume(f.a, { scope: "fr", fr: LOCAL_FR, milestone: M });
}

function skills(c: FrResumeClassification): string[] {
  return resumeChain(c).map((s) => s.skill);
}

async function withFixture(body: (f: SpanFixture) => Promise<void>): Promise<void> {
  const f = makeSpanFixture(M);
  try {
    await body(f);
  } finally {
    f.cleanup();
  }
}

describe("FR scope: the last local FR does not ship a milestone whose sibling is busy", () => {
  test("the classification carries the busy sibling", async () => {
    await withFixture(async (f) => {
      lastLocalFr(f, "declared");
      f.activeFr(f.b, SIBLING_FR, M);
      const c = await frClassify(f);
      expect(c.lastActiveFr, "fixture premise: this is the last LOCAL active FR").toBe(true);
      expect(c.awaitingSiblings ?? []).toHaveLength(1);
      expect((c.awaitingSiblings ?? [])[0]).toMatch(ENTRY_RE);
    });
  });

  test("the chain builds and PRs the FR, and orders neither /spec-archive nor /ship-milestone", async () => {
    await withFixture(async (f) => {
      lastLocalFr(f, "declared");
      f.activeFr(f.b, SIBLING_FR, M);
      const got = skills(await frClassify(f));
      expect(got).toEqual(["/implement", "/pr"]);
    });
  });

  test("the rendered plan names the sibling and does not promise the ship tail", async () => {
    await withFixture(async (f) => {
      lastLocalFr(f, "declared");
      f.activeFr(f.b, SIBLING_FR, M);
      const { rendered } = renderResumePlan(await frClassify(f));
      expect(rendered).toContain("glacy-app-be");
      expect(rendered).not.toContain("extends through /spec-archive");
      expect(rendered).not.toMatch(/\/ship-milestone M_GF_78/);
    });
  });
});

describe("controls: the ship tail survives every state that is not a busy sibling", () => {
  test("sibling clear: the chain extends through /spec-archive and /ship-milestone", async () => {
    await withFixture(async (f) => {
      lastLocalFr(f, "declared");
      f.archivedFr(f.b, SIBLING_FR, M);
      const c = await frClassify(f);
      expect(c.awaitingSiblings ?? []).toEqual([]);
      expect(skills(c)).toEqual(["/implement", "/spec-archive", "/ship-milestone", "/pr"]);
    });
  });

  test("undeclared: a busy sibling the plan never names changes nothing", async () => {
    await withFixture(async (f) => {
      lastLocalFr(f, "undeclared");
      f.activeFr(f.b, SIBLING_FR, M);
      const c = await frClassify(f);
      expect(c.awaitingSiblings ?? []).toEqual([]);
      expect(skills(c)).toEqual(["/implement", "/spec-archive", "/ship-milestone", "/pr"]);
    });
  });

  test("unlocatable: a sibling that cannot be found does not block the local verdict", async () => {
    await withFixture(async (f) => {
      lastLocalFr(f, "unlocatable");
      const c = await frClassify(f);
      expect(c.awaitingSiblings ?? []).toEqual([]);
      expect(skills(c)).toContain("/ship-milestone");
    });
  });

  test("not the last local FR: the declaration is never read, so a malformed one cannot throw", async () => {
    await withFixture(async (f) => {
      f.planA({}, { spans_repos: "[a, b]" });
      f.activeFr(f.a, LOCAL_FR, M);
      f.activeFr(f.a, "GF-2", M);
      const c = await frClassify(f);
      expect(c.lastActiveFr).toBe(false);
      expect(skills(c)).toEqual(["/implement", "/pr"]);
    });
  });

  test("the last local FR with a malformed declaration refuses, as the milestone scope does", async () => {
    await withFixture(async (f) => {
      f.planA({}, { spans_repos: "[a, b]" });
      f.activeFr(f.a, LOCAL_FR, M);
      await expect(frClassify(f)).rejects.toBeInstanceOf(SpansReposError);
    });
  });
});

describe("one predicate: the FR scope reads what the milestone scope reads", () => {
  test("the FR-scope entry is byte-identical to classifyActivePlans' entry for the same sibling", async () => {
    await withFixture(async (f) => {
      lastLocalFr(f, "declared");
      f.activeFr(f.b, SIBLING_FR, M);
      const frEntry = (await frClassify(f)).awaitingSiblings ?? [];
      // Same tree, one step later: the local FR archived, so the MILESTONE is
      // otherwise ship-ready and classifyActivePlans renders its own entry.
      renameSync(join(f.a, "specs", "frs", `${LOCAL_FR}.md`), join(f.a, "specs", "frs", "archive", `${LOCAL_FR}.md`));
      const milestoneEntry = (await ship.classifyActivePlans(f.a)).awaitingSiblings;
      expect(milestoneEntry).toHaveLength(1);
      expect(frEntry).toEqual(milestoneEntry);
    });
  });

  test("the sibling-state helper is exported, and the classifier never re-derives it", () => {
    expect(typeof (ship as Record<string, unknown>).spanningSiblingState).toBe("function");
    const src = readFileSync(CLASSIFIER, "utf8");
    expect(src).toMatch(/\bspanningSiblingState\b/);
    expect(src).not.toMatch(/\bresolveSpansRepos\b/);
    expect(src).not.toMatch(/from "\.\/spans_repos"/);
  });
});

describe("the executing prose says it, in place", () => {
  const headLines = (rel: string): number =>
    execFileSync("git", ["show", `HEAD:${rel}`], { cwd: repoRoot, encoding: "utf8" }).split("\n").length;
  const rel = (abs: string): string => abs.slice(repoRoot.length + 1);

  test("the /deliver last-active-FR bullet and its reference row name the spanning exception", () => {
    const skillLine = readFileSync(DELIVER_SKILL, "utf8")
      .split("\n")
      .find((l) => l.startsWith("- **This FR is the last active FR bound to its milestone**"));
    expect(skillLine, "the last-active-FR bullet exists").toBeDefined();
    expect(skillLine!).toContain("spans_repos");
    const refRow = readFileSync(DELIVER_REF, "utf8")
      .split("\n")
      .find((l) => l.startsWith("| `true` — this FR is the last active FR bound to its milestone"));
    expect(refRow, "the reference row exists").toBeDefined();
    expect(refRow!).toContain("spans_repos");
  });

  test("the /deliver waiting sentence no longer claims the milestone scope alone", () => {
    const line = readFileSync(DELIVER_SKILL, "utf8")
      .split("\n")
      .find((l) => l.includes("A milestone awaiting a sibling repo"));
    expect(line).toBeDefined();
    expect(line!).toMatch(/FR scope/);
  });

  test("the /implement close-offer line reads the refusal, and names both places the reason shows", () => {
    const line = readFileSync(IMPLEMENT_SKILL, "utf8")
      .split("\n")
      .find((l) => l.includes("active_plan_ship_ready.ts <projectRoot>"));
    expect(line).toBeDefined();
    expect(line!).not.toContain("the reason shows only at");
    expect(line!).toMatch(/exits 1/);
    expect(line!).toContain("spans_repos");
  });

  test("zero new lines in any edited file", () => {
    for (const file of [DELIVER_SKILL, DELIVER_REF, IMPLEMENT_SKILL]) {
      expect(readFileSync(file, "utf8").split("\n").length, rel(file)).toBe(headLines(rel(file)));
    }
  });
});
