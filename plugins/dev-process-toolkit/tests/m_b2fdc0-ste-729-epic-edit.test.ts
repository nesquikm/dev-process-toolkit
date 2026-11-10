// STE-729 (M_b2fdc0) — the planning repository can edit its Epic's text with
// consent.
//
// The module under test is adapters/_shared/src/epic_edit.ts:
//
//   bun run epic_edit.ts <projectRoot> <EPIC-KEY>
//
// It writes and announces ONE `epic-edit` receipt naming the key, and prints
// `default=forbidden` and `options=["Edit <KEY>","Skip <KEY>"]`, only when:
//   (a) the git index tracks specs/plan/<M>.md or specs/plan/archive/<M>.md,
//       <M> = milestoneIdFromEpicKey(<KEY>);
//   (b) that plan, read from the index, carries `milestone: <M>`;
//   (c) the plan's index and working-tree frontmatter agree;
//   (d) the binding is Jira mode;
//   (e) the index-tracked plan's frontmatter carries `container_origin: minted`
//       (AC-STE-729.12 — only the minting repository may edit; a joiner is refused).
//
// The tracker-write gate then permits an `editJiraIssue` on the key carrying
// only cloudId / issueIdOrKey / fields / contentFormat / responseContentFormat,
// `fields` holding description and/or summary only, after an AskUserQuestion
// answer exactly `Edit <KEY>` recorded after the announcement (AC-STE-729.3),
// and nothing else (AC-STE-729.4). Every gate leg runs the SHIPPED `.sh`
// wrapper on a recorded payload; each condition has a twin differing from the
// permit leg in that condition only (AC-STE-729.9). The legs live in
// tests/_m_b2fdc0_ste729_fixture.ts so the mutation battery
// (tests/m_b2fdc0-ste-729-mutation.test.ts) drives the very same legs.
//
// Synthetic keys only (PROJ-*); every repository is a temporary git repo.

import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  EDIT_LABEL,
  EPIC,
  EPIC_EDIT,
  MILESTONE,
  OTHER_EPIC,
  PLUGIN_ROOT,
  SKIP_LABEL,
  cleanupTemps,
  epicEditLegs,
  epicEditPermitProblem,
  epicEditRefusalProblem,
  graderEpicEditLegs,
  graderEpicEditWrongAnnouncer,
  loadGrader,
  makeWorld,
  moduleRel,
  hookModuleRel,
  permitProblem,
  refusalProblem,
  runEpicEdit,
  runModule,
  show,
} from "./_m_b2fdc0_ste729_fixture";
import { milestoneIdFromEpicKey } from "../adapters/_shared/src/milestone_token";

// Spawned children (git, bun) under load exceed bun's 5 s default.
setDefaultTimeout(120_000);
afterAll(cleanupTemps);

const EPIC_EDIT_PATH = join(PLUGIN_ROOT, moduleRel(EPIC_EDIT));

/** AC-STE-729.12 — check (e)'s refusal: the verdict names container_origin; the remedy names a person adding `container_origin: minted` in a reviewed commit. */
function checkEProblem(r: { stderr: string }): string | null {
  const lines = r.stderr.split("\n").filter((l) => l.trim() !== "");
  const verdict = lines.find((l) => !l.startsWith("Remedy: ") && !l.startsWith("Context: ")) ?? "";
  const remedy = lines.find((l) => l.startsWith("Remedy: ")) ?? "";
  if (!/container_origin/.test(verdict)) return `the verdict does not name container_origin: ${verdict}`;
  if (!remedy.includes("container_origin: minted")) return `the remedy does not name \`container_origin: minted\`: ${remedy}`;
  if (!/review/i.test(remedy)) return `the remedy does not say "reviewed commit": ${remedy}`;
  if (!/commit/i.test(remedy)) return `the remedy does not say "commit": ${remedy}`;
  if (!/\b(person|human|operator|maintainer)\b/i.test(remedy)) return `the remedy does not say a person adds it: ${remedy}`;
  if (!/mint/i.test(remedy.replace("container_origin: minted", ""))) return `the remedy does not limit the fix to a plan this repository minted: ${remedy}`;
  return null;
}

interface HookModule {
  RECEIPT_WRITING_SUBCOMMANDS: Readonly<Record<string, string | null>>;
  RECEIPT_ANNOUNCING_MODULES: readonly string[];
  invokedDecidingModule: (command: string) => string | null;
}
const hookModule = async (): Promise<HookModule> => (await import(join(PLUGIN_ROOT, hookModuleRel))) as HookModule;

// ===========================================================================
// AC-STE-729.1 — the module, its CLI, and its place in the announcing list
// ===========================================================================

describe("AC-STE-729.1 — epic_edit.ts ships and is a subcommand-less receipt-writing module taking exactly two arguments", () => {
  test("adapters/_shared/src/epic_edit.ts exists", () => {
    expect(existsSync(EPIC_EDIT_PATH)).toBe(true);
  });

  test("RECEIPT_WRITING_SUBCOMMANDS lists epic_edit.ts with NO subcommand (null), so RECEIPT_ANNOUNCING_MODULES carries it", async () => {
    const m = await hookModule();
    expect(Object.prototype.hasOwnProperty.call(m.RECEIPT_WRITING_SUBCOMMANDS, EPIC_EDIT), "listed").toBe(true);
    expect(m.RECEIPT_WRITING_SUBCOMMANDS[EPIC_EDIT]).toBeNull();
    expect(m.RECEIPT_ANNOUNCING_MODULES).toContain(EPIC_EDIT);
  });

  test("the hook accepts exactly `<projectRoot> <EPIC-KEY>` after the module; any other argv announces nothing", async () => {
    const { invokedDecidingModule } = await hookModule();
    const cmd = (args: string) => `bun run "${EPIC_EDIT_PATH}" ${args}`;
    expect(invokedDecidingModule(cmd("/r/be PROJ-500"))).toBe(EPIC_EDIT);
    const rejected: Array<[string, string]> = [
      ["no arguments", ""],
      ["only the root", "/r/be"],
      ["an extra trailing argument", "/r/be PROJ-500 --force"],
      ["a third positional", "/r/be PROJ-500 PROJ-501"],
      ["a subcommand before the root", "edit /r/be PROJ-500"],
      ["epic_close's --children shape", "/r/be PROJ-500 --children /r/x.json"],
    ];
    for (const [name, args] of rejected) {
      expect({ name, module: invokedDecidingModule(cmd(args)) }).toEqual({ name, module: null });
    }
  });

  test("CONTROL — epic_close.ts keeps its own argv check (two arguments are not its shape)", async () => {
    const { invokedDecidingModule } = await hookModule();
    const close = join(PLUGIN_ROOT, moduleRel("epic_close.ts"));
    expect(invokedDecidingModule(`bun run "${close}" /r/be PROJ-500 --children /r/x.json`)).toBe("epic_close.ts");
    expect(invokedDecidingModule(`bun run "${close}" /r/be PROJ-500`)).toBeNull();
  });

  test("the module itself refuses an argv other than two arguments, in the NFR-10 shape, writing no receipt", () => {
    const w = makeWorld();
    for (const args of [[w.root], [w.root, EPIC, "--force"], []]) {
      const r = runModule(PLUGIN_ROOT, EPIC_EDIT, args);
      const problem = epicEditRefusalProblem(r, w, []);
      expect({ args: args.join(" "), problem }, show(r)).toEqual({ args: args.join(" "), problem: null });
    }
  });
});

// ===========================================================================
// AC-STE-729.2 — the four checks, each with its twin
// ===========================================================================

describe("AC-STE-729.2 / AC-STE-729.12 — all five checks (a)-(e) hold → default=forbidden, the Edit/Skip options and one announced `epic-edit` receipt", () => {
  test("PERMIT — tracked live plan carrying milestone M_PROJ_500, index = working tree, Jira binding → exit 0, one receipt (kind epic-edit, subject PROJ-500)", () => {
    const w = makeWorld();
    const r = runEpicEdit(PLUGIN_ROOT, w);
    expect(epicEditPermitProblem(r, w), show(r)).toBeNull();
  });

  test("PERMIT — the plan tracked at specs/plan/archive/<M>.md", () => {
    const w = makeWorld({ archived: true });
    const r = runEpicEdit(PLUGIN_ROOT, w);
    expect(epicEditPermitProblem(r, w), show(r)).toBeNull();
  });

  test("the printed options are exactly [\"Edit PROJ-500\",\"Skip PROJ-500\"]", () => {
    const w = makeWorld();
    const r = runEpicEdit(PLUGIN_ROOT, w);
    const line = r.stdout.split("\n").find((l) => l.startsWith("options="));
    expect(line).toBe(`options=${JSON.stringify([EDIT_LABEL(EPIC), SKIP_LABEL(EPIC)])}`);
  });

  test("the receipt names the key and the milestone it was checked against", () => {
    const w = makeWorld();
    const r = runEpicEdit(PLUGIN_ROOT, w);
    expect(epicEditPermitProblem(r, w), show(r)).toBeNull();
    const path = r.stdout.split("\n").find((l) => l.startsWith("dpt-receipt: "))!.slice("dpt-receipt: ".length).split(/\s+/)[0]!;
    const rc = JSON.parse(readFileSync(path, "utf-8")) as { subject: string; evidence: Record<string, unknown> };
    expect(rc.subject).toBe(EPIC);
    expect(JSON.stringify(rc.evidence)).toContain(MILESTONE);
  });
});

describe("AC-STE-729.2 / AC-STE-729.12 — each failing check refuses in the NFR-10 shape, names the check, exits non-zero, writes no receipt", () => {
  test("(a) TWIN — the plan is on disk but not tracked by the git index → refused, naming the plan and the index", () => {
    const w = makeWorld({ untrackedPlan: true });
    const r = runEpicEdit(PLUGIN_ROOT, w);
    expect(epicEditRefusalProblem(r, w, [new RegExp(MILESTONE), /track|index/i]), show(r)).toBeNull();
  });

  test("(a) TWIN — no plan at all → refused, naming the milestone", () => {
    const w = makeWorld({ noPlan: true });
    const r = runEpicEdit(PLUGIN_ROOT, w);
    expect(epicEditRefusalProblem(r, w, [new RegExp(MILESTONE)]), show(r)).toBeNull();
  });

  test("(a) KEY — an Epic key whose milestone this repository never planned (PROJ-501 → M_PROJ_501) → refused, naming M_PROJ_501", () => {
    const w = makeWorld();
    const r = runEpicEdit(PLUGIN_ROOT, w, OTHER_EPIC);
    expect(epicEditRefusalProblem(r, w, [new RegExp(milestoneIdFromEpicKey(OTHER_EPIC))]), show(r)).toBeNull();
  });

  test("(b) TWIN — the tracked plan (index and working tree alike) carries `milestone: M_PROJ_999` → refused, naming the milestone field", () => {
    const w = makeWorld({ planMilestone: "M_PROJ_999" });
    const r = runEpicEdit(PLUGIN_ROOT, w);
    expect(epicEditRefusalProblem(r, w, [/milestone/, /M_PROJ_999/]), show(r)).toBeNull();
  });

  test("(c) TWIN — the working-tree plan's frontmatter differs from the indexed one → refused, naming the working tree", () => {
    const w = makeWorld({ driftWorkingTree: true });
    const r = runEpicEdit(PLUGIN_ROOT, w);
    expect(epicEditRefusalProblem(r, w, [/working.tree/i, /index/i]), show(r)).toBeNull();
  });

  test("(d) TWIN — the repository's binding is Linear → refused, naming Jira", () => {
    const w = makeWorld({ linear: true });
    const r = runEpicEdit(PLUGIN_ROOT, w);
    expect(epicEditRefusalProblem(r, w, [/jira/i]), show(r)).toBeNull();
  });

  test("(e) TWIN — the tracked plan carries no `container_origin` → refused, naming container_origin, remedy: a person adds `container_origin: minted` in a reviewed commit", () => {
    const w = makeWorld({ containerOrigin: null });
    const r = runEpicEdit(PLUGIN_ROOT, w);
    expect(epicEditRefusalProblem(r, w, [/container_origin/]), show(r)).toBeNull();
    expect(checkEProblem(r), show(r)).toBeNull();
  });

  test("(e) TWIN — the tracked plan carries `container_origin: joined` (a joining repository) → refused, naming container_origin", () => {
    const w = makeWorld({ containerOrigin: "joined" });
    const r = runEpicEdit(PLUGIN_ROOT, w);
    expect(epicEditRefusalProblem(r, w, [/container_origin/]), show(r)).toBeNull();
    expect(checkEProblem(r), show(r)).toBeNull();
  });

  test("(e) TWIN — the tracked plan carries `container_origin: maybe` (any other value) → refused, naming container_origin", () => {
    const w = makeWorld({ containerOrigin: "maybe" });
    const r = runEpicEdit(PLUGIN_ROOT, w);
    expect(epicEditRefusalProblem(r, w, [/container_origin/]), show(r)).toBeNull();
    expect(checkEProblem(r), show(r)).toBeNull();
  });

  test("(e) CONTROL — the permit world's plan is a minted one (index AND working tree carry `container_origin: minted`)", () => {
    const w = makeWorld();
    expect(readFileSync(w.planFile, "utf-8")).toMatch(/^container_origin: minted$/m);
    const p = Bun.spawnSync(["git", "-C", w.root, "show", `:${w.planRel}`], { stdout: "pipe", stderr: "pipe" });
    expect(p.stdout.toString()).toMatch(/^container_origin: minted$/m);
  });

  test("KEY — a key milestoneIdFromEpicKey cannot sanitize (\"\", \"-\", \"__\") → refused in the NFR-10 shape, non-zero, no receipt", () => {
    for (const key of ["", "-", "__"]) {
      expect(() => milestoneIdFromEpicKey(key), `fixture: ${JSON.stringify(key)} must be unsanitizable`).toThrow();
      const w = makeWorld();
      const r = runModule(PLUGIN_ROOT, EPIC_EDIT, [w.root, key]);
      expect({ key, problem: epicEditRefusalProblem(r, w, []) }, show(r)).toEqual({ key, problem: null });
      // Exactly the three NFR-10 lines: verdict, Remedy:, Context: — never a bare thrown message.
      const lines = r.stderr.split("\n").filter((l) => l.trim() !== "");
      expect({ key, shape: lines.map((l) => (l.startsWith("Remedy: ") ? "Remedy" : l.startsWith("Context: ") ? "Context" : "verdict")) }, show(r)).toEqual({ key, shape: ["verdict", "Remedy", "Context"] });
    }
  });

  test("KEY — a non-canonical Jira key (proj-500, PROJ.500, PROJ-500x, PROJ_500) is refused in the NFR-10 shape, non-zero, no receipt — even with a tracked, minted plan at the path it sanitizes to", () => {
    const CANONICAL = /^[A-Z][A-Z0-9]*-\d+$/;
    for (const key of ["proj-500", "PROJ.500", "PROJ-500x", "PROJ_500"]) {
      expect(CANONICAL.test(key), `fixture: ${key} must be non-canonical`).toBe(false);
      const milestone = milestoneIdFromEpicKey(key); // sanitizable — the refusal cannot come from the sanitizer
      // A permit-shaped world whose ONLY plan sits at specs/plan/<milestone>.md and carries that milestone,
      // so checks (a)-(e) all hold for this key: a refusal is the key check, not a missing or foreign plan.
      const w = makeWorld({ noPlan: true });
      const planRel = `specs/plan/${milestone}.md`;
      writeFileSync(
        join(w.root, planRel),
        ["---", `milestone: ${milestone}`, "status: active", "archived_at: null", "shipped_in: null", "container_origin: minted", "---", "", `# ${milestone}`, ""].join("\n"),
      );
      const g = (...args: string[]) => {
        const p = Bun.spawnSync(["git", "-C", w.root, "-c", "user.name=Fake Person", "-c", "user.email=fake@example.invalid", ...args], { stdout: "pipe", stderr: "pipe" });
        if (p.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${p.stderr.toString()}`);
        return p.stdout.toString();
      };
      g("add", "--", planRel);
      g("commit", "-q", "-m", "fixture: plan for a non-canonical key");
      expect(g("ls-files", "--", planRel).trim(), `fixture: ${planRel} must be tracked`).toBe(planRel);
      expect(g("show", `:${planRel}`), `fixture: the tracked plan carries milestone ${milestone}`).toMatch(new RegExp(`^milestone: ${milestone}$`, "m"));

      const r = runModule(PLUGIN_ROOT, EPIC_EDIT, [w.root, key]);
      expect({ key, problem: epicEditRefusalProblem(r, w, [/key/i]) }, show(r)).toEqual({ key, problem: null });
      expect({ key, namesKey: r.stderr.includes(key) }, show(r)).toEqual({ key, namesKey: true });
      const lines = r.stderr.split("\n").filter((l) => l.trim() !== "");
      expect({ key, shape: lines.map((l) => (l.startsWith("Remedy: ") ? "Remedy" : l.startsWith("Context: ") ? "Context" : "verdict")) }, show(r)).toEqual({ key, shape: ["verdict", "Remedy", "Context"] });
    }
  });

  test("CONTROL — each twin differs from the permit world in its one fact (the permit world passes every check)", () => {
    const w = makeWorld();
    expect(epicEditPermitProblem(runEpicEdit(PLUGIN_ROOT, w), w)).toBeNull();
  });
});

// ===========================================================================
// AC-STE-729.2 (a)-(c) / AC-STE-729.12 — the plan is read from HEAD, and the
// index and working tree must both equal HEAD for that path (v3.4.0 fix
// round 1, M1): a `git add` alone never makes a repository the Epic's owner.
// ===========================================================================

/** `git -C <root> <args>` → stdout, or "" when git fails (a fixture probe, never an assertion on its own). */
function gitOut(root: string, ...args: string[]): string {
  const p = Bun.spawnSync(["git", "-C", root, ...args], { stdout: "pipe", stderr: "pipe" });
  return p.exitCode === 0 ? p.stdout.toString() : "";
}

describe("AC-STE-729.2 / AC-STE-729.12 [M1] — a plan that is only staged, or differs from HEAD, is refused", () => {
  test("[M1] TWIN (1) — plan committed `container_origin: joined`, then edited to `minted` and only `git add`-ed (HEAD still joined) → refused, NFR-10, non-zero, no receipt", () => {
    const w = makeWorld({ containerOrigin: "joined", stagedOrigin: "minted" });
    expect(gitOut(w.root, "show", `HEAD:${w.planRel}`), "fixture: HEAD carries joined").toMatch(/^container_origin: joined$/m);
    expect(gitOut(w.root, "show", `:${w.planRel}`), "fixture: the index carries minted").toMatch(/^container_origin: minted$/m);
    expect(readFileSync(w.planFile, "utf-8"), "fixture: the working tree carries minted").toMatch(/^container_origin: minted$/m);
    const r = runEpicEdit(PLUGIN_ROOT, w);
    expect(epicEditRefusalProblem(r, w, [new RegExp(MILESTONE)]), show(r)).toBeNull();
  });

  test("[M1] TWIN (2) — no plan in any commit; a new specs/plan/M_PROJ_500.md with milestone + `container_origin: minted` is staged → refused, NFR-10, non-zero, no receipt", () => {
    const w = makeWorld({ stagedOnlyPlan: true });
    expect(gitOut(w.root, "ls-tree", "--name-only", "HEAD", "--", w.planRel).trim(), "fixture: HEAD has no plan").toBe("");
    expect(gitOut(w.root, "ls-files", "--", w.planRel).trim(), "fixture: the index tracks the staged plan").toBe(w.planRel);
    expect(gitOut(w.root, "show", `:${w.planRel}`), "fixture: the staged plan is minted").toMatch(/^container_origin: minted$/m);
    const r = runEpicEdit(PLUGIN_ROOT, w);
    expect(epicEditRefusalProblem(r, w, [new RegExp(MILESTONE)]), show(r)).toBeNull();
  });

  test("[M1] TWIN (3) — plan committed minted, the working tree differs from HEAD for that path (body only, frontmatter unchanged) → refused, NFR-10, non-zero, no receipt", () => {
    const w = makeWorld({ bodyDrift: "worktree" });
    expect(gitOut(w.root, "show", `HEAD:${w.planRel}`), "fixture: HEAD is minted").toMatch(/^container_origin: minted$/m);
    expect(gitOut(w.root, "diff", "--name-only", "HEAD", "--", w.planRel).trim(), "fixture: the path differs from HEAD").toBe(w.planRel);
    expect(gitOut(w.root, "diff", "--name-only", "--cached", "--", w.planRel).trim(), "fixture: the index still equals HEAD").toBe("");
    const r = runEpicEdit(PLUGIN_ROOT, w);
    expect(epicEditRefusalProblem(r, w, [new RegExp(MILESTONE), /HEAD|commit/i]), show(r)).toBeNull();
  });

  test("[M1] TWIN (3) — plan committed minted, the index differs from HEAD for that path (a staged body edit; index = working tree) → refused, NFR-10, non-zero, no receipt", () => {
    const w = makeWorld({ bodyDrift: "index" });
    expect(gitOut(w.root, "diff", "--name-only", "--cached", "--", w.planRel).trim(), "fixture: the index differs from HEAD").toBe(w.planRel);
    expect(gitOut(w.root, "diff", "--name-only", "--", w.planRel).trim(), "fixture: the working tree equals the index").toBe("");
    const r = runEpicEdit(PLUGIN_ROOT, w);
    expect(epicEditRefusalProblem(r, w, [new RegExp(MILESTONE), /HEAD|commit/i]), show(r)).toBeNull();
  });

  test("[M1] PERMIT (4) — the committed, clean, minted plan still passes (HEAD = index = working tree)", () => {
    const w = makeWorld();
    expect(gitOut(w.root, "status", "--porcelain", "--", w.planRel).trim(), "fixture: the plan is clean against HEAD").toBe("");
    expect(gitOut(w.root, "show", `HEAD:${w.planRel}`), "fixture: HEAD is minted").toMatch(/^container_origin: minted$/m);
    const r = runEpicEdit(PLUGIN_ROOT, w);
    expect(epicEditPermitProblem(r, w), show(r)).toBeNull();
  });

  test("[M1] PERMIT (4) — the committed, clean, minted plan at specs/plan/archive/<M>.md still passes", () => {
    const w = makeWorld({ archived: true });
    const r = runEpicEdit(PLUGIN_ROOT, w);
    expect(epicEditPermitProblem(r, w), show(r)).toBeNull();
  });
});

// ===========================================================================
// AC-STE-729.3 / .4 / .9 — the gate, through the shipped .sh wrapper
// ===========================================================================

describe("AC-STE-729.3 / .4 / .9 — the gate permits the consented description/summary edit, and every twin differing in one condition is refused", () => {
  for (const leg of epicEditLegs()) {
    test(`${leg.expect === "permit" ? "AC-STE-729.3" : "AC-STE-729.4"} — ${leg.name}`, async () => {
      const r = await leg.run(PLUGIN_ROOT);
      const problem = leg.expect === "permit" ? permitProblem(r) : refusalProblem(r);
      if (problem !== null) throw new Error(`${leg.name}: expected ${leg.expect} (${problem}):\n${show(r)}`);
    });
  }
});

// ===========================================================================
// AC-STE-729.8 — the live grader mirrors AC.3 and AC.4
// ===========================================================================

describe("AC-STE-729.8 — shared_tracker_live_grader.ts mirrors the epic-edit rule", () => {
  test("RECEIPT_WRITERS maps the `epic-edit` kind to epic_edit.ts with no subcommand", async () => {
    expect((await loadGrader(PLUGIN_ROOT)).RECEIPT_WRITERS["epic-edit"]).toEqual({ module: EPIC_EDIT, subcommand: null });
  });

  for (const leg of graderEpicEditLegs()) {
    test(`${leg.name} → ${leg.expect === "gated" ? "no ungated-write" : "ungated-write"}`, async () => {
      const r = await leg.run(PLUGIN_ROOT);
      expect(r.ungated).toBe(leg.expect === "ungated");
    });
  }

  test("FORBID — the epic-edit receipt announced by epic_close.ts, not its writer → ungated-write and unannounced-receipt", async () => {
    expect(await graderEpicEditWrongAnnouncer(PLUGIN_ROOT)).toEqual({ ungated: true, unannounced: true });
  });
});
