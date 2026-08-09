// M121 / STE-448 — "Add the mode:none leg end-to-end to /smoke-test and
// /conformance-loop".
//
// `mode: none` is the DEFAULT configuration for every project this toolkit
// bootstraps: `/setup` never writes a `mode: none` line, because ABSENCE of a
// `## Task Tracking` section IS none. So the toolkit's most common downstream
// shape had never once been driven end to end by its own conformance loop.
// This FR adds it as a real third leg in both project-local driver skills.
//
// WHAT THIS FILE IS FOR, given the milestone's thesis. M121 exists to remove
// assertions that cannot fail, so every block below names the input that turns
// it RED and — where the assertion is over data rather than prose — EXECUTES
// that input as a standing test rather than describing it. Two kinds of
// assertion live here and they are labelled as such:
//
//   * EXECUTED — the thing under test is run (a regex extracted from the SKILL
//     is applied to real minted ids; a derivation is computed from the enum;
//     a section is sliced and scanned).
//   * PROSE — the driver contract is instructional text an LLM executes at run
//     time, so the only mechanical check available is that the row exists and
//     names the right artifact. Prose checks are marked, never dressed up.
//
// AC-STE-448.1 — `--tracker none` is admitted by DERIVATION from `SMOKE_LEGS`,
//   not by a third literal. Every `--tracker` alternation in the smoke driver
//   is bound to the enum, per SITE and not merely in union.
// AC-STE-448.2 — every per-run artifact class is keyed on the leg, for every
//   registered leg.
// AC-STE-448.3 — pre-flight #6's basename allow-list admits the tracker-less
//   test project, derived.
// AC-STE-448.4 — the tracker-less leg reaches no MCP pre-flight and builds no
//   MCP config.
// AC-STE-448.5 — the pre-baked answers elect `none`, and the resulting
//   CLAUDE.md carries NO `## Task Tracking` section.
// AC-STE-448.6 — Phase 5 on that leg removes a directory and calls no tracker.
// AC-STE-448.7/.8/.9 — the three Phase 4 verify-on-disk rows only a
//   tracker-less run can make.

import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SMOKE_LEGS } from "../adapters/_shared/src/smoke_fixture_groups";
import {
  LEG_PROSE_SURFACES,
  smokeTrackerAlternationSites,
  smokeTrackerFlagLegs,
} from "../adapters/_shared/src/leg_prose_surfaces";
import { milestoneIdFromUlid } from "../adapters/_shared/src/milestone_token";
import { mintId } from "../adapters/_shared/src/ulid";
import { PRESENCE_CLAIM_TRIPWIRE } from "./_ac9-row-guard";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const LOOP_SKILL = join(REPO_ROOT, ".claude/skills/conformance-loop/SKILL.md");
const SMOKE_SKILL = join(REPO_ROOT, ".claude/skills/smoke-test/SKILL.md");

function read(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

// Dogfood-only surfaces: a plugin-only checkout carries neither driver skill,
// so those suites skip cleanly instead of failing. Same idiom as m112/m116/m121.
const loopDoc = read(LOOP_SKILL);
const smokeDoc = read(SMOKE_SKILL);
const describeIfSkills =
  loopDoc === null || smokeDoc === null ? describe.skip : describe;

/** The leg this FR adds. Named once; every other reference derives. */
const TRACKERLESS_LEG = "none";

const sorted = (legs: readonly string[]): string[] => [...legs].sort();
const EXPECTED = sorted(SMOKE_LEGS);

/**
 * The body of a `####` subsection, from its heading to the next heading of the
 * same or higher level. Used by the AC.6 scan, which has to be able to say
 * "no MCP token appears in THIS section" without the answer depending on a
 * neighbouring section's content.
 */
function subsection(doc: string, heading: string): string {
  const start = doc.indexOf(heading);
  if (start < 0) return "";
  const rest = doc.slice(start + heading.length);
  const next = rest.search(/\n#{1,4} /);
  return next < 0 ? rest : rest.slice(0, next);
}

// ═══════════════════════════ AC-STE-448.1 ══════════════════════════════════
//
// The rule this AC encodes is the milestone's, not this FR's: a leg is
// admitted by widening the authority, never by typing a third value beside the
// other two. `SMOKE_LEGS` is the authority; the smoke driver's `--tracker`
// alternations are the prose being checked; the direction is one-way.

describeIfSkills("AC-STE-448.1 — --tracker is derived from SMOKE_LEGS, per site", () => {
  test("slice sanity: the extractor finds every alternation site it is supposed to", () => {
    // NON-VACUITY, and it is the load-bearing half of this AC's falsifiability.
    // Every assertion below is a `forEach` over the sites; an extractor that
    // returned NOTHING would satisfy all of them vacuously — the exact shape
    // M121 exists to remove. The floor is 4 because the smoke driver states its
    // supported set in four places: the frontmatter `argument-hint`, the
    // argument-parsing bullet, and the two shell guards' `must resolve to`
    // diagnostics (pre-flight #6 and Phase 8).
    const sites = smokeTrackerAlternationSites(smokeDoc!);
    expect(sites.length).toBeGreaterThanOrEqual(4);
  });

  test("EXECUTED: every site enumerates exactly the registered leg set", () => {
    // PER SITE, deliberately — not the union. A union cannot see a site that
    // has gone stale as a strict SUBSET of another: frontmatter left at two
    // legs while the bullet names three unions to three and passes.
    const offenders = smokeTrackerAlternationSites(smokeDoc!)
      .map((site, i) => ({ site: i, legs: sorted(site) }))
      .filter((row) => row.legs.join(",") !== EXPECTED.join(","));
    expect(offenders).toEqual([]);
  });

  test("EXECUTED: the union helper agrees with the enum", () => {
    expect(sorted(smokeTrackerFlagLegs(smokeDoc!))).toEqual(EXPECTED);
  });

  test("the tracker-less leg is admitted BY the enum, not beside it", () => {
    // The AC's actual claim. `none` is in the prose because it is in the
    // authority — so the prose check above is what admits it, and there is no
    // separate literal to keep in step.
    expect(SMOKE_LEGS as readonly string[]).toContain(TRACKERLESS_LEG);
    expect(smokeTrackerFlagLegs(smokeDoc!)).toContain(TRACKERLESS_LEG);
  });

  // --- falsifiability, applied IN MEMORY to synthetic documents -------------
  //
  // Synthetic text rather than a mutated file on disk, following STE-446's
  // precedent: it needs no backup/restore and cannot leave the tree dirty if an
  // assertion throws mid-test.

  test("WITNESS: a site short a registered leg is reported, not absorbed", () => {
    // The widened-enum drift direction — prose that has not caught up.
    const short = SMOKE_LEGS.filter((l) => l !== TRACKERLESS_LEG).join("|");
    const doc = `argument-hint: '[--tracker ${short}]'\n`;
    const sites = smokeTrackerAlternationSites(doc);
    expect(sites).toHaveLength(1);
    expect(sorted(sites[0]!)).not.toEqual(EXPECTED);
  });

  test("WITNESS: a site naming a leg the enum does not register is reported", () => {
    // The removal drift direction — a stale leg left behind.
    const doc = `- \`--tracker ${SMOKE_LEGS.join("|")}|zzphantom\` — pick the leg.\n`;
    const sites = smokeTrackerAlternationSites(doc);
    expect(sites).toHaveLength(1);
    expect(sites[0]).toContain("zzphantom");
    expect(sorted(sites[0]!)).not.toEqual(EXPECTED);
  });

  test("WITNESS: the --tracker context anchor is load-bearing, not decoration", () => {
    // MEASURED while building the extractor. An unanchored "any lowercase
    // alternation" scan matches ordinary prose — `<user-supplied|default
    // applied>` yields the pair `supplied|default` — so the surface would
    // report phantom legs and set-equality would fail for a reason that has
    // nothing to do with the leg set. This pins that the anchor still holds.
    const decoy =
      'reason:"<user-supplied|default applied>" and a `--leg linear|jira` flag\n';
    expect(smokeTrackerAlternationSites(decoy)).toEqual([]);
  });

  test("the surface is NOT registered in LEG_PROSE_SURFACES", () => {
    // AC-STE-446.2 pins that registry at exactly five entries, "one per
    // Requirement bullet" OF STE-446. A sixth is not one of those bullets, and
    // relaxing a shipped predecessor's count to make room for a successor is
    // the move this milestone forbids. This test is the durable record of that
    // decision: it fails if a later change quietly registers the surface and
    // pushes the repair onto STE-446's test instead.
    expect(LEG_PROSE_SURFACES.map((s) => s.id)).not.toContain(
      "smoke-tracker-flag-alternations",
    );
    expect(LEG_PROSE_SURFACES).toHaveLength(5);
  });
});

// ═══════════════════════════ AC-STE-448.2 ══════════════════════════════════

describeIfSkills("AC-STE-448.2 — every per-run artifact class is keyed on the leg", () => {
  test("EXECUTED: the loop driver carries a log, pidfile, rc-file and findings file per registered leg", () => {
    // Derived from the enum, so registering a leg turns this RED until the
    // loop driver's per-leg enumerations catch up. Templates deliberately not
    // accepted here: this is the one driver where STE-423 permits — and
    // STE-446 requires — the per-leg enumeration to be spelled out.
    const missing: string[] = [];
    for (const leg of SMOKE_LEGS) {
      for (const suffix of ["log", "pid", "rc"]) {
        const path = `/tmp/dpt-conformance-loop-\${DATE}-iter-\${ITER}-${leg}.${suffix}`;
        if (!loopDoc!.includes(path)) missing.push(path);
      }
      const findings = `/tmp/dpt-smoke-findings-\${DATE}-${leg}.md`;
      if (!loopDoc!.includes(findings)) missing.push(findings);
      const verdict = `/tmp/dpt-smoke-verdict-${leg}.json`;
      if (!loopDoc!.includes(verdict)) missing.push(verdict);
    }
    expect(missing).toEqual([]);
  });

  test("the loop driver no longer names a two-leg pair where it means every leg", () => {
    // The three surfaces STE-447 measured and left behind (§ 0c(b)) plus the
    // two per-skill-artifact clauses. Each said `linear` / `jira` where the
    // truth is now "one per registered leg", and each is an OPERATIVE
    // instruction rather than narration — a driver reading them would skip the
    // third leg's artifacts entirely.
    const banned = [
      "with `<tracker>` = `linear` / `jira` per leg",
      "`linear` and `jira`, written by that leg's",
    ];
    expect(banned.filter((b) => loopDoc!.includes(b))).toEqual([]);
  });

  test("the superseded two-leg teardown expansion survives ONLY where it is labelled superseded", () => {
    // NARROWED, not deleted, and the narrowing is the milestone's settled
    // resolution rather than a convenience. The first draft banned the literal
    // `rm -rf ../dpt-test-project-{linear,jira}` document-wide and went RED —
    // on the paragraph explaining that this WAS the previous, wrong form. That
    // is the seventh-plus recurrence of the whole-file-pin-versus-explanatory-
    // prose collision recorded across this milestone, and the resolution each
    // time is identical: pin the HAZARD (an operative instruction), never an
    // identifier everywhere, because the broad form taxes documentation
    // accuracy and the prose is what loses.
    //
    // So the form may appear, and only on a line that marks it historical.
    const EXPANSION = "rm -rf ../dpt-test-project-{linear,jira}";
    const carriers = loopDoc!
      .split(/\r?\n/)
      .filter((line) => line.includes(EXPANSION));
    const unlabelled = carriers.filter((line) => !/before M121/.test(line));
    expect(unlabelled).toEqual([]);

    // Strictly stronger than the ban it replaces: the ban only said the old
    // form is gone, which an abort clause that removes NOTHING also satisfies.
    // This says each of the three abort clauses issues a per-leg removal.
    const perLeg = loopDoc!.split("rm -rf ../dpt-test-project-<spawned leg>");
    expect(perLeg.length - 1).toBe(3);
  });

  test("PROSE: the smoke driver's tracker-less bullet names its own test project", () => {
    // Only the test-project path is asserted here, and that is a deliberate
    // limit rather than a thin check. STE-423's meta-test forbids a spelled-out
    // `dpt-smoke-<leg>` scratch literal in THIS document for any leg outside
    // its own closed alternation, so the per-leg scratch paths are stated by
    // `<tracker>` template and the enumeration lives in the loop driver
    // (asserted above). `dpt-test-project-` is not in STE-423's scan.
    expect(smokeDoc!).toContain(`../dpt-test-project-${TRACKERLESS_LEG}`);
    expect(smokeDoc!).toContain(`\`--tracker ${TRACKERLESS_LEG}\` writes to`);

    // The bullet's CONTENT, not just its anchors. AC.2 names the artifact
    // classes, so pinning only the two anchors let any of them be dropped from
    // the sentence with the suite still green — measured by the audit. The
    // classes are named in the bullet's own paragraph, which is what a reader
    // substituting `none` into the template actually consults.
    const bulletStart = smokeDoc!.indexOf(
      `\`--tracker ${TRACKERLESS_LEG}\` writes to`,
    );
    const bullet = smokeDoc!.slice(bulletStart, bulletStart + 700);
    for (const cls of [
      "scratch",
      "findings file",
      "verdict artifact",
      "approval record",
      "Phase 8 fixtures",
    ]) {
      expect(bullet).toContain(cls);
    }
  });
});

// ═══════════════════════════ AC-STE-448.3 ══════════════════════════════════

describeIfSkills("AC-STE-448.3 — pre-flight #6 admits the tracker-less project, derived", () => {
  test("EXECUTED: the shipped case arm's leg set equals the enum", () => {
    // Re-derived through the SAME surface STE-446 built rather than by a fresh
    // grep, so this AC cannot pass against an allow-list the authority does not
    // actually agree with.
    const surface = LEG_PROSE_SURFACES.find(
      (s) => s.id === "preflight-6-basename-allowlist",
    );
    expect(surface).toBeDefined();
    const legs = surface!.proseLegs({
      "conformance-loop": loopDoc!,
      "smoke-test": smokeDoc!,
    });
    expect(sorted(legs)).toEqual(EXPECTED);
    expect(legs).toContain(TRACKERLESS_LEG);
  });

  test("the arm is a closed list, not a wildcard that would admit anything", () => {
    // Deriving the allow-list must not be confused with opening it.
    const arm = /^[ \t]*(dpt-test-project-[A-Za-z0-9_|-]*)\)[ \t]*;;/m.exec(
      smokeDoc!,
    );
    expect(arm).not.toBeNull();
    const alternatives = arm![1]!.split("|");
    expect(sorted(alternatives)).toEqual(
      sorted(SMOKE_LEGS.map((l) => `dpt-test-project-${l}`)),
    );

    // THE CATCH-ALL'S BODY, which is what actually keeps the list closed. The
    // comment here used to claim this test closed that hole and it did not:
    // MEASURED, changing `*) exit 1 ;;` to `*) ;;` in pre-flight #6 left all 41
    // tests GREEN while the guard admitted arbitrary basenames. Matching the
    // permitted alternatives says nothing about what happens to everything
    // else, and the refusal is the half that does the work.
    const preflight6 = smokeDoc!.slice(
      smokeDoc!.indexOf('TOOLKIT_REPO="$(pwd)"'),
    );
    expect(preflight6.slice(0, 900)).toMatch(/^\s*\*\)\s*exit 1\s*;;/m);
  });
});

// ═══════════════════════════ AC-STE-448.4 ══════════════════════════════════

describeIfSkills("AC-STE-448.4 — the tracker-less leg reaches no MCP surface", () => {
  test("EXECUTED: every MCP-bearing pre-flight is scoped to a named tracker", () => {
    // This is the assertion that actually carries the AC. The leg does not
    // reach an MCP pre-flight because every probe that calls one is scoped —
    // so the property to pin is the SCOPING, not a sentence saying the leg
    // skips them. Slice the pre-flight list, take each numbered item, and
    // require any item mentioning an `mcp__` tool to declare its tracker.
    const start = smokeDoc!.indexOf("## Pre-flight refusals");
    const end = smokeDoc!.indexOf("\n## Flow");
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const section = smokeDoc!.slice(start, end);

    // Split on the numbered pre-flight openers (`1. **…`, `10. **…`).
    const items = section.split(/\n(?=\d{1,2}\. \*\*)/).slice(1);
    expect(items.length).toBeGreaterThanOrEqual(10); // non-vacuity: all ten found

    const unscoped = items
      .filter((item) => /mcp__[a-z]+__/.test(item))
      .filter((item) => !/\((?:Linear|Jira)-only\)/.test(item))
      .map((item) => item.slice(0, item.indexOf("**") + 2));
    expect(unscoped).toEqual([]);
  });

  test("EXECUTED: the tracker-scoped pre-flights are exactly the MCP-bearing ones", () => {
    // The complement, and it is what stops the check above from being
    // satisfiable by labelling everything `(Linear-only)`. If a probe declares
    // a tracker scope it must be because it touches that tracker.
    const start = smokeDoc!.indexOf("## Pre-flight refusals");
    const end = smokeDoc!.indexOf("\n## Flow");
    const items = smokeDoc!.slice(start, end).split(/\n(?=\d{1,2}\. \*\*)/).slice(1);
    const scoped = items.filter((i) => /\((?:Linear|Jira)-only\)/.test(i));
    expect(scoped.length).toBeGreaterThanOrEqual(5); // #3 #5 #7 #8 #9
    // Narrowed after the audit: the alternation used to accept the bare word
    // `MCP`, so a probe labelled `(Jira-only)` that merely MENTIONED MCP
    // without calling one satisfied it. A real tool name is the evidence.
    // Tightening costs nothing today — all five scoped probes carry one.
    expect(scoped.filter((i) => !/mcp__[a-z]+__/.test(i))).toEqual([]);
  });

  test("PROSE: Phase 1 step 5 constructs no MCP config on the tracker-less leg", () => {
    expect(smokeDoc!).toMatch(/NO MCP CONFIG IS CONSTRUCTED/);
  });

  test("PROSE: the spawn omits the flag rather than passing an empty config", () => {
    // The distinction is the point of the row, so it is what gets pinned. An
    // empty `{"mcpServers":{}}` would behave identically today and claim
    // something false.
    expect(smokeDoc!).toMatch(/the flag is OMITTED, not emptied/);
  });

  test("PROSE: no `.mcp.json` is written on the tracker-less leg", () => {
    expect(smokeDoc!).toMatch(/no `\.mcp\.json` is written at all/);
  });
});

// ═══════════════════════════ AC-STE-448.5 ══════════════════════════════════

describeIfSkills("AC-STE-448.5 — the answers elect none; CLAUDE.md carries no tracking section", () => {
  test("the pre-baked answers block keys tracker mode on the resolved leg", () => {
    // Templated, so electing `none` is the same key with a different value
    // rather than a second answers dialect.
    expect(smokeDoc!).toContain("tracker_mode: <tracker>");
  });

  test("PROSE: Phase 2 step 1 has a tracker-less bullet that forbids the section", () => {
    expect(smokeDoc!).toMatch(
      /NO `## Task Tracking` section in the emitted CLAUDE\.md/,
    );
  });

  test("EXECUTED: the Phase 4 absence row asserts a ZERO COUNT, not a skip", () => {
    // The distinction this AC turns on. Absence is the canonical form, so the
    // row has to make a positive assertion about it; a skipped row and an
    // absent section produce the same file and different evidence.
    //
    // THE PREDICATE IS EXTRACTED FROM THE SKILL, not restated here. The first
    // draft defined `countHeadings` inline and ran it over two inline string
    // literals — three assertions that were a self-test of a five-line test
    // helper and could not fail for any state of the driver. The audit caught
    // it and it was labelled `EXECUTED`, which made it worse than an honest
    // prose grep: it claimed coverage it did not have, in the milestone that
    // exists to remove exactly that. Now the grep pattern the row publishes is
    // lifted out of the document and run, so a row publishing the WRONG
    // pattern — `## Tracking`, an unanchored `## Task Tracking` — fails here.
    const row = /`grep -c '(\^## Task Tracking)' <file>` is `0`/.exec(smokeDoc!);
    expect(row).not.toBeNull();
    const published = new RegExp(row![1]!); // e.g. /^## Task Tracking/

    const countHeadings = (claudeMd: string): number =>
      claudeMd.split(/\r?\n/).filter((l) => published.test(l)).length;

    // Conforming: mode: none emits no section at all.
    expect(countHeadings("# P\n\n## Docs\n\nuser_facing_mode: false\n")).toBe(0);
    // Non-conforming, and it is the SUBTLE failure this row exists to catch —
    // a driver that "helpfully" writes the section declaring `mode: none`.
    expect(countHeadings("# P\n\n## Task Tracking\n\nmode: none\n")).toBe(1);
  });
});

// ═══════════════════════════ AC-STE-448.6 ══════════════════════════════════

describeIfSkills("AC-STE-448.6 — Phase 5 on the tracker-less leg calls no tracker", () => {
  const HEADING = "#### Tracker-less path (`--tracker none`)";

  test("slice sanity: the tracker-less teardown section resolves", () => {
    // Non-vacuity for the scan below: an empty slice contains no `mcp__` token
    // and would score a missing section as a clean one.
    const body = subsection(smokeDoc!, HEADING);
    expect(body.length).toBeGreaterThan(400);
  });

  test("EXECUTED: zero MCP tool references inside that section", () => {
    // The trailing `*` in the character class is not tidiness — it is a
    // measured near-miss. The first draft matched `mcp__[a-z]+__[A-Za-z_]+`,
    // which requires a letter after the second `__`, so the wildcard family
    // form `mcp__linear__*` did NOT match. My own draft of this section
    // contained exactly that form and the assertion passed anyway: a test that
    // scored a real MCP mention as clean. It is the milestone's own failure
    // mode, reached inside a test written to hunt it.
    const body = subsection(smokeDoc!, HEADING);
    const calls = [...body.matchAll(/mcp__[a-z]+__[A-Za-z_*]*/g)].map((m) => m[0]);
    expect(calls).toEqual([]);
  });

  test("the widened MCP matcher still catches the wildcard family form", () => {
    // Non-vacuity for the assertion above, and the reason it can be trusted.
    // Without this, the widening is an unverified claim about a regex.
    const re = /mcp__[a-z]+__[A-Za-z_*]*/g;
    expect("call mcp__linear__*".match(re)).toEqual(["mcp__linear__*"]);
    expect("call mcp__atlassian__transitionJiraIssue".match(re)).toEqual([
      "mcp__atlassian__transitionJiraIssue",
    ]);
    expect("no tracker call at all".match(re)).toBeNull();
  });

  test("EXECUTED: zero tracker-sweep machinery inside that section", () => {
    // The Jira teardown's operative shapes, which is what a copy-paste of the
    // neighbouring section would drag in: the `JQL:` instruction LINE, and the
    // two tool names. Deliberately NOT the bare word "JQL" — a paragraph
    // explaining that no JQL runs would trip that, which is the same
    // pin-versus-prose collision this milestone keeps re-learning.
    // `rm -rf` is required here; the tracker half is not.
    const body = subsection(smokeDoc!, HEADING);
    expect(body).toMatch(/rm -rf \.\.\/dpt-test-project-none/);
    expect(body).not.toMatch(/^\s*JQL:/m);
    expect(body).not.toMatch(/transitionJiraIssue|save_project/);
  });

  test("PROSE: the section states zero tracker calls, and why", () => {
    const body = subsection(smokeDoc!, HEADING);
    expect(body).toMatch(/ZERO tracker calls/);
  });

  test("the sibling tracker sections are NOT emptied by this change", () => {
    // A cheap way to satisfy every assertion above would be to strip the
    // tracker halves everywhere. This is the guard against that reading.
    expect(subsection(smokeDoc!, "#### Jira path (`--tracker jira`)")).toMatch(
      /transitionJiraIssue/,
    );
    expect(
      subsection(smokeDoc!, "#### Linear path (`--tracker linear`, default)"),
    ).toMatch(/save_project/);
  });
});

// ════════════ Beyond the ACs — the spawn fence's own reduced-run abort ══════
//
// NOT one of this FR's nine ACs. It is a defect found while adding the third
// leg, measured, fixed, and covered here because the alternative is shipping an
// unprotected fix — and an unprotected fix in THIS milestone would be the
// thesis failing on its own work.
//
// THE DEFECT. The spawn fence's last line summarised the detach as
// `linear=${PID_LINEAR} jira=${PID_JIRA} none=${PID_NONE}`: one variable per
// REGISTERED leg. An unselected leg's brace group never runs, so it never
// assigns its PID variable, and under `set -u` that line aborts the shell — at
// the END of the spawn fence, after the selected legs have been detached and
// before anything can wait on them. Measured: `PID_JIRA: unbound variable`,
// rc 1, groups orphaned. It is a fifth reduced-run surface beyond the four in
// `specs/notes/follow-ups.md` § 0a, and the only one inside Phase A's own fence.
//
// WHY IT MATTERED IN PRACTICE, not just in principle. It is why the STE-447
// spawn-fence harness leaked `.rc` files on every run (measured: 3 per run,
// deterministically) — `wait` was never reached, so the orphaned groups wrote
// their rc-files after the harness had already cleaned up. Those leftovers sit
// at a `process.pid`-keyed path, so a recycled PID makes a later run observe a
// previous run's artifacts. That is the mechanism behind the one flaky failure
// seen during this FR's gate runs.
//
// AND IT WAS INVISIBLE. MEASURED: reverting the fix to the pre-STE-448 form and
// running the whole suite returned 6764 pass / 0 fail — byte-identical to the
// clean gate. Nothing in the repository could tell the two apart. This block is
// what changes that, so the assertion below is the point of the section rather
// than a decoration on it.

describeIfSkills("beyond the ACs — the spawn fence survives a reduced selection", () => {
  /** The Phase A spawn fence, located by the token it prints, never by a leg. */
  function spawnFence(): string {
    const fences = [...loopDoc!.matchAll(/^```bash\n([\s\S]*?)^```/gm)].map(
      (m) => m[1]!,
    );
    return fences.find((f) => f.includes("detached:")) ?? "";
  }

  test("slice sanity: the fence resolves and carries a group per registered leg", () => {
    // Non-vacuity. An empty fence runs clean under `set -u` and would score the
    // defect as fixed — the harness failing open on exactly the input it exists
    // to grade.
    const fence = spawnFence();
    expect(fence.length).toBeGreaterThan(500);
    for (const leg of SMOKE_LEGS) expect(fence).toContain(`--tracker ${leg}`);
  });

  test("EXECUTED: a single-leg selection reaches the end of the fence under `set -u`", () => {
    const fence = spawnFence();
    // Both substitutions are asserted to have applied, per § 0b: the fence sets
    // its OWN `ITER=<N>` and `DATE=$(date …)`, and `ITER=<N>` is a stdin
    // redirect rather than an assignment. A silently-no-opping substitution
    // would land every artifact on a real-date path and read as "the fence does
    // nothing" instead of "the harness is misconfigured".
    const token = `ste448setu-${process.pid}-${Date.now()}`;
    let script = fence.replace(/^ITER=<N>$/m, "ITER=1");
    expect(script).not.toBe(fence);
    const beforeDate = script;
    script = script.replace(/^DATE=\$\(date [^)]*\)$/m, `DATE=${token}`);
    expect(script).not.toBe(beforeDate);

    const bin = mkdtempSync(join(tmpdir(), "ste448-bin-"));
    try {
      for (const cmd of ["claude", "bun"]) {
        writeFileSync(join(bin, cmd), "#!/bin/sh\ncat >/dev/null 2>&1 || true\nexit 0\n", {
          mode: 0o755,
        });
      }
      const selected = SMOKE_LEGS[0]!; // a PROPER subset — that is the input
      const full = [
        "set -u",
        `export PATH=${JSON.stringify(bin)}:$PATH`,
        "LINEAR_TEAM=STE",
        "JIRA_PROJECT=DST",
        `SELECTED_LEGS=${JSON.stringify(selected)}`,
        script,
        "wait",
        "echo FENCE-COMPLETED",
      ].join("\n");
      const r = Bun.spawnSync(["bash", "-c", full], { cwd: REPO_ROOT });
      const out = r.stdout.toString() + r.stderr.toString();

      // The assertion. With the pre-STE-448 form this line never prints, the
      // shell exits 1 on `PID_JIRA: unbound variable`, and `wait` is skipped.
      expect(out).toContain("FENCE-COMPLETED");
      expect(out).not.toMatch(/unbound variable/);
      expect(r.exitCode).toBe(0);

      // Non-vacuity on the run itself: the fence must actually have detached
      // the selected leg. Without this, a fence that did nothing at all would
      // print the sentinel and pass.
      expect(
        existsSync(`/tmp/dpt-conformance-loop-${token}-iter-1-${selected}.pid`),
      ).toBe(true);
      // …and only that leg, so the sentinel is not being reached by a run that
      // ignored the selection.
      for (const leg of SMOKE_LEGS.filter((l) => l !== selected)) {
        expect(
          existsSync(`/tmp/dpt-conformance-loop-${token}-iter-1-${leg}.pid`),
        ).toBe(false);
      }
    } finally {
      for (const leg of SMOKE_LEGS) {
        for (const ext of ["log", "pid", "rc"]) {
          rmSync(`/tmp/dpt-conformance-loop-${token}-iter-1-${leg}.${ext}`, {
            force: true,
          });
        }
      }
      rmSync(bin, { recursive: true, force: true });
    }
  });

  test("the fence names no per-leg PID variable in its summary line", () => {
    // The shape-level pin behind the behavioural test above, so the defect
    // cannot return in a form that happens to survive one particular selection
    // (the FULL selection assigns every variable and passes regardless).
    const fence = spawnFence();
    const summary = fence
      .split(/\r?\n/)
      .filter((l) => l.includes("detached:") && l.trimStart().startsWith("echo"));
    expect(summary).toHaveLength(1);
    for (const leg of SMOKE_LEGS) {
      expect(summary[0]!).not.toContain(`PID_${leg.toUpperCase()}`);
    }
  });
});

// ═══════════════════════ AC-STE-448.7 / .8 / .9 ════════════════════════════
//
// The three Phase 4 rows. They are prose contracts the driver executes at run
// time, so their coverage here is twofold: the row exists and names the right
// artifact (PROSE), and the RULE the row states is executed against real data
// (EXECUTED). The second half is what stops a row from stating a rule that
// does not hold — the failure mode where a verify step is green because its
// stated predicate was never run against anything.

describeIfSkills("AC-STE-448.7 — the FR's minted identity, with no tracker block", () => {
  test("PROSE: the row names the FR path and the id shape", () => {
    expect(smokeDoc!).toMatch(/specs\/frs\/<TAIL>\.md/);
    expect(smokeDoc!).toMatch(/exactly 26 ULID characters/);
  });

  test("EXECUTED: the ULID regex the row states accepts real minted ids", () => {
    // The row publishes `^id: fr_[0-9A-HJKMNP-TV-Z]{26}$`. Extract it FROM THE
    // SKILL and run it, so the row cannot publish a regex that would reject
    // every id the toolkit actually mints. Reading it would not have caught a
    // wrong character class.
    const m = /\^id: fr_\[([0-9A-HJKMNP\-TV-Z]+)\]\{26\}\$/.exec(smokeDoc!);
    expect(m).not.toBeNull();
    const re = new RegExp(`^id: fr_[${m![1]!}]{26}$`);

    for (let i = 0; i < 25; i++) {
      const id = mintId();
      expect(re.test(`id: ${id}`)).toBe(true);
    }
    // Negatives, so the regex is not merely permissive.
    expect(re.test("id: fr_TOOSHORT")).toBe(false);
    expect(re.test("id: STE-448")).toBe(false);
    // Crockford excludes I, L, O and U — a regex that accepted them would be
    // matching a different alphabet than the minter emits.
    expect(re.test(`id: fr_${"I".repeat(26)}`)).toBe(false);
  });

  test("PROSE: the row asserts the tracker block's ABSENCE positively", () => {
    // And says why inference from the id's presence is not equivalent: a file
    // carrying both would pass the weaker form.
    expect(smokeDoc!).toMatch(/`tracker:` block is ABSENT/);
    expect(smokeDoc!).toMatch(/grep -c '\^tracker:' <file>` is `0`/);
  });
});

describeIfSkills("AC-STE-448.8 — the plan's minted identity and self-derived filename", () => {
  test("PROSE: the row names the plan path and the self-derivation rule", () => {
    // ANCHOR HISTORY, kept because each move was forced by a measurement.
    //
    // (1) The original pin was `toMatch(/verbatim/)` — a bare DOCUMENT-WIDE
    //     word match, and `verbatim` occurs nine times in this driver, the
    //     first ~1240 lines above the AC.8 row (`skip every Jira-only step
    //     verbatim`). MEASURED by the end-of-FR audit: deleting the id-equality
    //     clause from the row left all 41 tests GREEN. It was vacuous, in the
    //     FR whose own report calls that class out.
    // (2) It was then narrowed onto the equality clause, which was unique to
    //     this row — a correctly anchored, mutation-verified pin guarding a
    //     requirement no healthy run could meet. STE-455 established the clause
    //     is unsatisfiable in general (one plan id cannot equal the ids of two
    //     FRs in the same milestone) and removed it from the row, so that
    //     anchor now names a string the driver can never contain.
    // (3) RE-ANCHORED, not deleted, onto the SURVIVING half of the row: the
    //     self-derivation sentence. Occurrence-count form is retained on
    //     purpose — a containment check cannot see a second satisfier landing
    //     elsewhere in the document, which is failure mode (1) exactly. The
    //     phrase was measured to occur once, and only in this row; the sibling
    //     suite for STE-455 re-measures both facts against the live document
    //     and proves the narrowing bit via a mutation that reddens this pin
    //     while leaving the old one green.
    expect(smokeDoc!).toMatch(/specs\/plan\/M_<TAIL>\.md/);
    const selfDerivation =
      smokeDoc!.split("its own filename stem equals `M_` + `id.slice(23, 29)`").length - 1;
    expect(selfDerivation).toBe(1);
  });

  test("EXECUTED: the derivation rule the row states is the toolkit's real one", () => {
    // The row says the plan's filename stem is `M_` + `id.slice(23, 29)`. That
    // is a claim about `milestoneIdFromUlid`, and it is checked by running
    // both sides over real mints rather than by trusting the sentence.
    for (let i = 0; i < 25; i++) {
      const id = mintId();
      expect(milestoneIdFromUlid(id)).toBe(`M_${id.slice(23, 29)}`);
    }
  });

  test("EXECUTED: the tail is 6 chars, which is WHY the row is not a duplicate", () => {
    // The row argues that an id-only check is insufficient because the tail
    // keeps 6 of the id's 26 characters, so a plan can carry a correct `id:`
    // under a filename derived from something else. That premise is measured
    // here: two distinct ids can share a tail, so tail equality does not imply
    // id equality and the filename has to be recomputed from the id.
    const id = mintId();
    const tail = id.slice(23, 29);
    // 20 filler + 6 tail = the 26 ULID chars after the `fr_` prefix. The
    // offsets 23..29 index the WHOLE 29-char id, so the tail is the id's last
    // six characters — a detail worth getting from arithmetic that runs rather
    // than from the sentence describing it (the first draft used 23 filler
    // chars, built a 32-char id, and `milestoneIdFromUlid` rejected it).
    const impostor = `fr_${"0".repeat(20)}${tail}`;
    expect(impostor).toHaveLength(id.length);
    expect(impostor).not.toBe(id);
    expect(milestoneIdFromUlid(impostor)).toBe(milestoneIdFromUlid(id));
  });

  test("PROSE: the row says recompute-from-id, not read-stem-and-substring", () => {
    expect(smokeDoc!).toMatch(
      /Recompute the stem from the id read out of the file/,
    );
  });
});

// TITLE CORRECTED TWICE OVER, and both corrections are the same class.
//
// It read "the lock file is absent after the archive commit". There is no
// archive commit on this leg — the smoke chain's single-FR form never archives,
// and the driver row itself has said so in bold since STE-451 measured it. The
// title went on stating the retired reason while its own subject contradicted
// it, which is `specs/notes/follow-ups.md` § 0i's family: a guard that keeps
// running and stops describing what it holds.
//
// STE-456 then changed the row's CONTRACT: it now requires the durable claim
// witness AND the absence, because absence alone is satisfied by a claim that
// never fired — which is exactly what the 2026-08-08 tracker-less leg produced.
// The authorizing amendment to `specs/frs/STE-448.md` lands ahead of this file.
describeIfSkills("AC-STE-448.9 — the release proof: the durable claim witness AND the absence", () => {
  test("PROSE: the row names the lock path and keys it on the FULL id", () => {
    expect(smokeDoc!).toMatch(/`\.\.\/dpt-test-project-none\/\.dpt\/locks\/<id>` is \*\*ABSENT\*\*/);
    expect(smokeDoc!).toMatch(/never the 6-char tail/);
  });

  test("the row DISCLAIMS covering the lock's existence — this is half an assertion", () => {
    // The load-bearing test of this AC, and the reason it is worth writing.
    // An end-state absence check is satisfied VACUOUSLY by a lock that was
    // never created: a claim step that silently no-opped leaves exactly the
    // disk a working release leaves. Without the disclaimer a later reader
    // takes the green row as evidence the release path works, which is the
    // vacuous-pass class this milestone exists to close — reintroduced one
    // layer up, inside the FR hunting it.
    //
    // SCOPED TO THE ROW BY STE-451, WHICH DISARMED THE THIRD ARM. These were
    // three document-wide `toMatch`es. The first two carry phrases unique to
    // the row, so they were genuine pins by luck. `/STE-451/` was a pin for a
    // different reason — the token had exactly ONE satisfier in the whole
    // document, the row's own "it is STE-451's fixture group 10". STE-451 then
    // wrote that literal a second time, in a Phase 2 step-3 paragraph, and the
    // arm stopped being able to see its subject: MEASURED, stripping the token
    // from the row alone left this test 42/0 green.
    //
    // This is § 0i's class through a different mechanism — not a slice anchor
    // relocating, but a whole-document token acquiring a second satisfier — so
    // § 0i's remedy would not have caught it. The repair is the same one the
    // house rule always prescribes: scope the pin, never weaken it. All three
    // now read the row, and the slice asserts it holds its subject first.
    const start = smokeDoc!.indexOf("AC-STE-448.9");
    expect(start).toBeGreaterThan(0);
    const row = smokeDoc!.slice(start, start + 2400);
    expect(row).toContain("the release proof");
    expect(row).toMatch(/deliberately only HALF of the lock assertion/);
    expect(row).toMatch(/satisfied \*vacuously\* by a lock that was never created/);
    expect(row).toMatch(/STE-451/);
  });

  test("a named-phrasing tripwire for the row growing a presence claim", () => {
    // HONEST SCOPE, corrected after the audit. This was titled "the row does
    // not silently grow a presence claim" and banned ONE English phrase —
    // `assert the lock exists`. MEASURED: injecting `also verify the lock file
    // was created mid-run` left all 41 tests GREEN. It was blind in exactly the
    // sense § 5 of this FR's report defines: matching a shape the drift would
    // never take. Every plausible strengthening walked past it.
    //
    // A textual ban over unbounded English cannot be made exhaustive, so this
    // no longer claims to be. It is a tripwire over the phrasings actually
    // reached for, widened to the verb set rather than one sentence, and the
    // REAL guard is the three disclaimer pins above: a presence claim that
    // kept the disclaimer would be self-contradicting on its face, and one that
    // removed it turns those three RED.
    const start = smokeDoc!.indexOf("AC-STE-448.9");
    expect(start).toBeGreaterThan(0);
    const row = smokeDoc!.slice(start, start + 2400);
    // NON-VACUITY ON THE ANCHOR ITSELF (added by STE-451, which tripped it).
    // `indexOf` takes the FIRST occurrence, and the token is not unique — any
    // prose above § Phase 4 that names it silently moves this window off the
    // row and onto unrelated text. MEASURED: one cross-reference in a Phase 2.X
    // block moved the anchor from line 1429 to 1316, the window stopped
    // containing the row entirely, and all 42 tests here stayed GREEN. A guard
    // that has been relocated looks exactly like a guard that is satisfied, so
    // the slice must prove it still holds its subject before banning anything.
    expect(row).toContain("the release proof");
    // NARROWED BY STE-456, AND HOISTED TO ONE DEFINITION. This test and the
    // not-blind anchor below held INDEPENDENT copies of the same literal —
    // STE-451's correction #40 exactly: editing one leaves the other green, so
    // the anchor stops protecting the ban at the moment it would matter. Both
    // now read `tests/_ac9-row-guard.ts`.
    //
    // The narrowing itself is measured in both directions (widened for verb
    // inflections, narrowed to permit a git-history witness) in
    // `m121-ste-456-two-sided-lock-evidence.test.ts` § AC-STE-456.5, against a
    // labelled corpus and against the form being replaced.
    expect(row).not.toMatch(PRESENCE_CLAIM_TRIPWIRE);
  });

  test("the tripwire is not blind — it catches the strengthenings actually reached for", () => {
    // Non-vacuity, and the lesson from § 5 applied: every absence assertion
    // gets a paired POSITIVE input at the moment of writing. Without this, the
    // widened regex is just a second unexamined claim replacing the first.
    const re = PRESENCE_CLAIM_TRIPWIRE;
    for (const drift of [
      "assert the lock exists before the archive commit",
      "also verify the lock file was created mid-run",
      "check that .dpt/locks/<id> is present after the claim step",
      "confirm the lock existed at claim time",
      "pin that the lock file is present mid-run",
    ]) {
      expect(re.test(drift)).toBe(true);
    }
    // …and does not fire on the row's own correct wording.
    expect(re.test("`.dpt/locks/<id>` is ABSENT after the archive commit")).toBe(
      false,
    );
  });
});
