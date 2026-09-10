// STE-581 — the repoint has a real instrument and written preconditions.
//
// THE SUBJECT. Five shipped surfaces tell an operator to re-point a tracker
// binding with `/setup --resume-tracker-binding`. The setup skill has no
// dispatch branch for it, and the alternative two of those surfaces offer —
// `--migrate` — provably cannot do the job: it REFUSES a same-mode no-op
// (jira -> jira is exactly the repoint case) and it SKIPS steps 1-8, which is
// where the tracker-config write at step 7f lives. Anyone following the
// instructions arrives nowhere.
//
// WHY EVERY SITE IS ASSERTED SEPARATELY. There are five sites, not three. A
// fix landing on three of five is the failure this FR exists to prevent, so a
// roll-up ("no surface still says X") is banned here: it goes green the moment
// the loudest site is fixed. Each site gets its own `test`, named by path and
// line, so the report says WHICH one is unfixed.
//
// THE EASILY-MISSED HALF — AC.7. Step 7f fetches statuses from the ACTIVE
// binding, which after a repoint is the NEW container alone. Under the
// no-migration constraint the repo still holds archived FRs bound to the OLD
// container's tickets, and the archive-side ticket-state probe reads their
// statuses through that same `specs/tracker-config.yaml`. So a 7f run that
// writes the new container's vocabulary alone can STRAND every legacy binding
// as an unknown status, and can CLOBBER a union an operator hand-wrote before
// the flip. Whether the two containers' status names actually collide is
// EMPIRICAL per repo pair — so the docs must order a CHECK, never assert an
// answer. Each of those clauses is a separate assertion below.
//
// MEASURED AT HEAD (2026-09-09, f61d2d4), so the RED here is about the subject
// and not about a mis-measured constant:
//
//   docs/setup-reference.md:119                        1 occurrence
//   adapters/_shared/src/tracker_config_proposal.ts:211 1 occurrence
//   skills/setup/SKILL.md:176                           1 occurrence
//   skills/spec-write/SKILL.md:302, :327                2 occurrences
//   -> the enumerating grep (plugin dir, tests excluded) returns exactly 5
//
//   skills/setup/SKILL.md      358 split-lines, 17 STE tokens
//   skills/spec-write/SKILL.md 358 split-lines, 54 STE tokens
//   skills/**                  245 STE tokens (four sibling suites pin .toBe(245))
//   ORDERED_UNREACHABLE_PIN    129, live count 129
//
// A NOTE ON AC.1 vs AC.2, recorded rather than silently resolved. AC.1 orders
// `grep -c` on skills/setup/SKILL.md from 1 to AT LEAST 2 (the § 0 routing
// rewrite). AC.2 says the tree-wide enumeration "still returns exactly 5".
// Those cannot both hold: one more matching line in setup/SKILL.md is one more
// matching line in the tree. AC.1 is the numerically unambiguous half and is
// asserted as written; AC.2's PURPOSE — no site left behind, no unenumerated
// surface sprouting — is asserted as (a) each known site separately, (b) the
// enumeration's file set is closed, and (c) the total grows by exactly the
// lines AC.1 mandates inside setup/SKILL.md and by nothing else. The pair as
// literally written is unsatisfiable and belongs in the plan.

import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { GATE_SITES } from "../adapters/_shared/src/gate_marker_refusal";
import {
  classifyReferenceLine,
  ORDERED_UNREACHABLE_PIN,
  buildModuleGraph,
  runModuleReachabilityProbe,
  scanSurfaceForModuleReferences,
} from "../adapters/_shared/src/module_reachability";

const PROJECT_ROOT = join(import.meta.dir, "..", "..", "..");
const PLUGIN_ROOT = join(import.meta.dir, "..");
const read = (rel: string) => readFileSync(join(PLUGIN_ROOT, rel), "utf-8");

const FLAG = "--resume-tracker-binding";

/**
 * Step 7f's five shipped outcome tokens. Hoisted because two arms below assert
 * DIFFERENT things about the same closed set — that the spec-write capability
 * row still names all five, and that the repoint prose names at least one of
 * them — and a list that drifted between the two would make the pair vacuous.
 */
const TRACKER_CONFIG_OUTCOMES = [
  "tracker_config_write_succeeded",
  "tracker_config_write_cancelled",
  "tracker_config_unchanged",
  "tracker_config_write_skipped_adapter_limit",
  "tracker_config_write_mcp_unavailable",
] as const;

/** `STE-<n>` / `AC-STE-<n>.<m>` tokens — the measure four sibling suites pin. */
const STE_TOKEN_RE = /\b(?:STE|AC-STE)-\d+(?:\.\d+)?\b/g;

const SETUP_SKILL = "skills/setup/SKILL.md";
const SPEC_WRITE_SKILL = "skills/spec-write/SKILL.md";
const SETUP_REFERENCE = "docs/setup-reference.md";
const PROPOSAL_MODULE = "adapters/_shared/src/tracker_config_proposal.ts";

/** Split-lines, the NFR-1 measure: `body.split("\n").length` = `wc -l` + 1. */
const splitLines = (rel: string) => read(rel).split("\n").length;

/** Every line of `rel`, 1-based lookup via `lines(rel)[n - 1]`. */
const lines = (rel: string) => read(rel).split("\n");

/** Every line of `rel` that carries `needle` — what `grep -F` prints. */
const linesWith = (rel: string, needle: string) =>
  lines(rel).filter((l) => l.includes(needle));

/** The one line of `rel` that carries `needle`, or "" — for a single-site pin. */
const soleLineWith = (rel: string, needle: string): string => {
  const hits = linesWith(rel, needle);
  return hits.length === 1 ? hits[0]! : "";
};

/**
 * The enumerating grep, as the FR defines it: scoped to the plugin directory,
 * tests excluded. Run through git-grep so it reads the working tree the same
 * way the FR's own measurement did.
 */
const enumerateSites = (): Array<{ file: string; line: number; text: string }> => {
  let out = "";
  try {
    out = execFileSync(
      "git",
      // `-e` is load-bearing: the pattern itself starts with `--`, and
      // without it git reads the flag name as one of its own options.
      ["grep", "-n", "--no-color", "-F", "-e", FLAG, "--", ".", ":(exclude)tests"],
      { cwd: PLUGIN_ROOT, encoding: "utf-8" },
    );
  } catch (err: unknown) {
    // git grep exits 1 on zero hits; anything else is a broken measurement and
    // must not read as "no sites".
    const e = err as { status?: number; stdout?: string };
    if (e.status !== 1) throw err;
    out = e.stdout ?? "";
  }
  return out
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => {
      const m = /^([^:]+):(\d+):([\s\S]*)$/.exec(l)!;
      return { file: m[1]!, line: Number(m[2]!), text: m[3]! };
    });
};

/** Occurrences of `needle` on distinct LINES of `rel` — what `grep -c` counts. */
const grepCount = (rel: string, needle: string) => linesWith(rel, needle).length;

/**
 * The module graph, built at most once. Three arms below need it, each build
 * walks the whole plugin tree, and the graph is read-only — so the memo changes
 * cost and nothing else. NOT a memo of the reachability REPORT: that one is
 * awaited per call, deliberately, so its fields are proven real each time.
 */
let graphMemo: ReturnType<typeof buildModuleGraph> | null = null;
const moduleGraph = () => (graphMemo ??= buildModuleGraph(PROJECT_ROOT));

/** Every module reference the reference doc makes, with its `refClass`. */
const referenceDocRefs = () =>
  scanSurfaceForModuleReferences(
    join(PLUGIN_ROOT, SETUP_REFERENCE),
    PROJECT_ROOT,
    moduleGraph(),
  );

// ---------------------------------------------------------------------------
// The repoint section of the reference doc — located once, read by many arms.
// ---------------------------------------------------------------------------

/**
 * The `## …` section of `docs/setup-reference.md` whose heading matches `re`,
 * as `{ start, end, body }` with 1-based line bounds.
 *
 * Returns `null` when the heading is absent, so an arm can say "the section
 * does not exist yet" rather than passing over an empty string.
 */
const section = (
  rel: string,
  re: RegExp,
): { start: number; end: number; body: string } | null => {
  const ls = lines(rel);
  const start = ls.findIndex((l) => /^#{2,4} /.test(l) && re.test(l));
  if (start === -1) return null;
  let end = ls.length;
  for (let i = start + 1; i < ls.length; i++) {
    if (/^#{2,4} /.test(ls[i]!)) {
      end = i;
      break;
    }
  }
  return { start: start + 1, end, body: ls.slice(start, end).join("\n") };
};

/** The "Repoint preconditions" section, wherever the implementer lands it. */
const preconditions = () => section(SETUP_REFERENCE, /Repoint preconditions/i);

/**
 * The prose that states the repoint contract. The flag's own paragraph is the
 * anchor: it is the line the enumerating grep finds in the reference doc.
 */
const repointProse = (): string => {
  const ls = lines(SETUP_REFERENCE);
  const idx = ls.findIndex((l) => l.includes(FLAG));
  if (idx === -1) return "";
  // The paragraph the flag sits in, plus everything up to the next `## `
  // heading — the contract legitimately spans a few paragraphs and a table.
  let end = ls.length;
  for (let i = idx + 1; i < ls.length; i++) {
    if (/^## /.test(ls[i]!)) {
      end = i;
      break;
    }
  }
  const pre = preconditions();
  return ls.slice(idx, end).join("\n") + (pre ? `\n${pre.body}` : "");
};

// ===========================================================================
// AC-STE-581.1 — the flag routes to a real contract, in place
// ===========================================================================

describe("AC-STE-581.1 — /setup dispatches the flag", () => {
  test("skills/setup/SKILL.md names the flag on at least TWO lines", () => {
    // 1 at HEAD (the step-7b deferral note at :176). The § 0 routing rewrite
    // is the second. A skill that mentions a flag only as an aside a reader
    // reaches AFTER routing has no dispatch branch for it.
    expect(grepCount(SETUP_SKILL, FLAG)).toBeGreaterThanOrEqual(2);
  });

  test("the routing that gained it is § 0, and it is an IN-PLACE rewrite", () => {
    const sec = section(SETUP_SKILL, /Tracker mode probe/i);
    expect(sec, "§ 0 Tracker mode probe").not.toBeNull();
    expect(sec!.body).toContain(FLAG);
  });

  test("the § 0 route does not depend on `## Task Tracking` presence", () => {
    // The measured defect: § 0 sends an EXISTING tracker-mode project (the
    // only kind that can be repointed) to `--migrate` and never mentions the
    // flag. The repoint case is exactly the case § 0 hands away.
    const sec = section(SETUP_SKILL, /Tracker mode probe/i)!;
    const flagSentences = sec.body
      .split(/(?<=\.)\s+/)
      .filter((s) => s.includes(FLAG));
    expect(flagSentences.length).toBeGreaterThan(0);
    expect(flagSentences.join(" ")).toMatch(/regardless of/i);
    expect(flagSentences.join(" ")).toMatch(/`?## Task Tracking`?/);
  });

  test("§ 0 stops offering `--migrate` for the repoint job", () => {
    // Narrow on purpose: § 0 legitimately routes a MODE CHANGE to `--migrate`.
    // What must stop is offering it in the same breath as the repoint flag.
    const sec = section(SETUP_SKILL, /Tracker mode probe/i)!;
    for (const s of sec.body.split(/(?<=\.)\s+/)) {
      if (!s.includes(FLAG)) continue;
      expect(s, "a § 0 sentence offers both the flag and --migrate").not.toContain(
        "--migrate",
      );
    }
  });

  test("NFR-1: skills/setup/SKILL.md still measures exactly 358 split-lines", () => {
    // Zero headroom. The § 0 change is a one-line rewrite, not a new section
    // and not a new line; the § 0c BODY belongs in the uncapped reference doc
    // behind a one-line pointer, which is the established split.
    expect(splitLines(SETUP_SKILL)).toBe(358);
  });
});

// ===========================================================================
// AC-STE-581.2 — five sites, each graded on its own
// ===========================================================================

describe("AC-STE-581.2 — every site describes the same instrument", () => {
  test("the enumeration's FILE SET is closed — no new surface sprouted", () => {
    const files = new Set(enumerateSites().map((s) => s.file));
    expect([...files].sort()).toEqual(
      [PROPOSAL_MODULE, SETUP_REFERENCE, SETUP_SKILL, SPEC_WRITE_SKILL].sort(),
    );
  });

  test("the enumeration grows by exactly the § 0 line AC.1 orders, and nothing else", () => {
    // 5 at HEAD. AC.1 mandates >= 1 further line inside setup/SKILL.md; every
    // OTHER file's count is frozen, which is what "still returns 5" is for.
    const sites = enumerateSites();
    const per = (f: string) => sites.filter((s) => s.file === f).length;
    expect(per(SETUP_REFERENCE), SETUP_REFERENCE).toBe(1);
    expect(per(PROPOSAL_MODULE), PROPOSAL_MODULE).toBe(1);
    expect(per(SPEC_WRITE_SKILL), SPEC_WRITE_SKILL).toBe(2);
    expect(sites.length).toBe(5 + (per(SETUP_SKILL) - 1));
    expect(per(SETUP_SKILL)).toBeGreaterThanOrEqual(2);
  });

  // --- site 1 of 5 -------------------------------------------------------
  test("site 1/5 — docs/setup-reference.md: the flag's own paragraph", () => {
    const line = soleLineWith(SETUP_REFERENCE, FLAG);
    expect(line, "expected exactly one flag line in the reference doc").not.toBe("");
    expect(line).not.toContain("Materially equivalent");
    expect(line).not.toContain("--migrate");
  });

  // --- site 2 of 5 -------------------------------------------------------
  test("site 2/5 — tracker_config_proposal.ts: the MCP-unavailable remedy", () => {
    const line = soleLineWith(PROPOSAL_MODULE, FLAG);
    expect(line, "expected exactly one flag line in the proposal module").not.toBe("");
    // The remedy fires from a FAILED step 7f. Offering `--migrate` beside it
    // is the false equivalence in its most damaging place: `--migrate` skips
    // steps 1-8, so it cannot re-run the very step that just failed.
    expect(line).not.toContain("--migrate");
    // MUST-INHERIT: tests/setup-tracker-config-write.test.ts asserts the shape
    // and only the shape. The literal prefix survives the edit.
    expect(line).toContain("Remedy:");
  });

  // --- site 3 of 5 -------------------------------------------------------
  test("site 3/5 — skills/setup/SKILL.md: the step-7b deferral note", () => {
    const hits = linesWith(SETUP_SKILL, FLAG);
    const deferral = hits.filter((l) => l.includes("workspace_binding_deferred"));
    expect(deferral).toHaveLength(1);
    expect(deferral[0]!).not.toContain("--migrate");
  });

  // --- sites 4 and 5 of 5 ------------------------------------------------
  test("site 4/5 — skills/spec-write/SKILL.md: the deferred-binding capability row", () => {
    const hits = linesWith(SPEC_WRITE_SKILL, FLAG);
    const row = hits.filter((l) => l.includes("`workspace_binding_deferred`"));
    expect(row).toHaveLength(1);
    expect(row[0]!).not.toContain("--migrate");
  });

  test("site 5/5 — skills/spec-write/SKILL.md: the 7f mcp_unavailable row", () => {
    const hits = linesWith(SPEC_WRITE_SKILL, FLAG);
    const row = hits.filter((l) => l.includes("tracker_config_write_mcp_unavailable"));
    expect(row).toHaveLength(1);
    expect(row[0]!).not.toContain("--migrate");
  });

  test("no site anywhere offers `--migrate` on the same line as the flag", () => {
    // The roll-up is kept as a BACKSTOP behind the five named arms, never as a
    // substitute for them: it reports "something is wrong", they report which.
    for (const s of enumerateSites()) {
      expect(s.text, `${s.file}:${s.line}`).not.toContain("--migrate");
    }
  });
});

// ===========================================================================
// AC-STE-581.3 — the full contract + written preconditions
// ===========================================================================

describe("AC-STE-581.3 — the reference doc carries the contract", () => {
  test("the contract names probe, write, and skip-every-other-step", () => {
    const prose = repointProse();
    expect(prose, "no flag paragraph found in the reference doc").not.toBe("");
    expect(prose).toMatch(/probe/i);
    expect(prose).toMatch(/write/i);
    expect(prose).toMatch(/skip every other/i);
  });

  test("it refuses rather than partially writing when the tracker MCP is unreachable", () => {
    const prose = repointProse();
    expect(prose).toMatch(/refus/i);
    expect(prose).toMatch(/no partial write|rather than partially|never partially/i);
    expect(prose).toMatch(/MCP/);
  });

  test("a `Repoint preconditions` section exists", () => {
    expect(preconditions(), "## Repoint preconditions").not.toBeNull();
  });

  test("it carries at least SEVEN numbered rows", () => {
    const pre = preconditions();
    expect(pre).not.toBeNull();
    const numbered = pre!.body.split("\n").filter((l) => /^\s*\d+\.\s+\S/.test(l));
    expect(numbered.length).toBeGreaterThanOrEqual(7);
  });

  // Seven rows of the WRONG content pass a count, so every named row is its
  // own arm. AC.3 lists five by name; each gets one.
  const namedRows: Array<[string, RegExp]> = [
    ["no active FRs mid-flight", /active FRs?[\s\S]{0,80}(mid-?flight|in flight)|mid-?flight[\s\S]{0,80}FR/i],
    ["one reconciled tracker site and MCP server", /reconcil[\s\S]{0,120}(site|MCP)/i],
    ["the repo tag declared in every participating repo", /repo tag[\s\S]{0,160}particip/i],
    ["the repo tag present in the forwarded default labels", /forward[\s\S]{0,80}default label|default label[\s\S]{0,80}forward/i],
    ["a surveyed milestone-label collision", /milestone[- ]label[\s\S]{0,80}collision|collision[\s\S]{0,80}milestone[- ]label/i],
  ];

  for (const [label, re] of namedRows) {
    test(`a precondition row names: ${label}`, () => {
      const pre = preconditions();
      expect(pre, "## Repoint preconditions").not.toBeNull();
      expect(pre!.body).toMatch(re);
    });
  }

  test("a precondition row orders the union vocabulary BEFORE the flip", () => {
    const pre = preconditions();
    expect(pre).not.toBeNull();
    expect(pre!.body).toMatch(/union/i);
    expect(pre!.body).toMatch(/hand-?writ|hand-?merg/i);
    expect(pre!.body).toMatch(/before the flip/i);
  });

  test("and a re-check AFTER the flip, because 7f rewrites that file", () => {
    const pre = preconditions();
    expect(pre).not.toBeNull();
    expect(pre!.body).toMatch(/re-?check/i);
    expect(pre!.body).toMatch(/after the flip/i);
    expect(pre!.body).toMatch(/7f/);
  });
});

// ===========================================================================
// AC-STE-581.4 — the flag's NAME survives (the naive "fix" is deletion)
// ===========================================================================

describe("AC-STE-581.4 — the cross-reference contract is unbroken", () => {
  /**
   * The flag derivation used by tests/m_645517-ste-570-cross-references.test.ts,
   * reproduced here so this suite reds on the same subject rather than trusting
   * that the sibling suite was run. Surface is SKILL.md PLUS the reference doc,
   * because NFR-1 caps the skill and the overflow home is where the rest of the
   * contract legitimately lives.
   */
  const declaredFlags = (name: string): Set<string> => {
    const bodies = [read(join("skills", name, "SKILL.md"))];
    const ref = join(PLUGIN_ROOT, "docs", `${name}-reference.md`);
    if (existsSync(ref)) bodies.push(readFileSync(ref, "utf-8"));
    const out = new Set<string>();
    for (const body of bodies) {
      const fm = body.split(/^---\s*$/m)[1] ?? "";
      for (const m of fm.matchAll(/--[a-z][a-z0-9-]*/g)) out.add(m[0]);
      for (const m of body.matchAll(/`?\/setup\s+(--[a-z][a-z0-9-]*)/g)) out.add(m[1]!);
      for (const m of body.matchAll(/`(--[a-z][a-z0-9-]*)`/g)) out.add(m[1]!);
    }
    return out;
  };

  test("the flag is named in BOTH skills/setup/SKILL.md and docs/setup-reference.md", () => {
    // Deleting the flag is the naive way to "fix a contradiction"; it turns
    // the STE-570 suite red. This FR makes the flag REAL, never removes it.
    expect(read(SETUP_SKILL)).toContain(FLAG);
    expect(read(SETUP_REFERENCE)).toContain(FLAG);
    expect(declaredFlags("setup").has(FLAG)).toBe(true);
  });

  test("the SKILL points a reader at the reference section that holds the contract", () => {
    // The STE-570 derivation UNIONS SKILL.md with the reference doc, so a flag
    // documented only in the overflow home reads as declared even when the
    // skill never sends anyone there. NFR-1 forces the § 0c body into the
    // uncapped doc; a one-line pointer is what makes that split a split rather
    // than a disappearance. At HEAD the only pointer from a flag line goes to
    // "§ Step 7b", which is the deferral table, not the repoint contract.
    const body = read(SETUP_SKILL);
    const pointing = body
      .split("\n")
      .filter((l) => l.includes(FLAG) && l.includes("docs/setup-reference.md"));
    expect(pointing.length).toBeGreaterThan(0);
    expect(pointing.join("\n")).toMatch(/Repoint|§ 0c/i);
  });

  test("the sibling assertions hold: --docs absent, --template + --migrate present", () => {
    const flags = declaredFlags("setup");
    expect(flags.has("--docs")).toBe(false);
    expect(flags.has("--template")).toBe(true);
    expect(flags.has("--migrate")).toBe(true);
  });

  test("`--migrate`'s own contract is untouched — this FR stops POINTING at it", () => {
    // Its refusal shape, transition set, atomic FR-rename commit and
    // branch-template re-seed all stay exactly as they are.
    const body = read(SETUP_SKILL);
    expect(body).toContain(
      "Detected current mode: <current>. Supported targets: <others>. Mode switch must change mode.",
    );
    expect(body).toContain(
      "Supported transitions: `none → <tracker>` / `<tracker> → none` / `<tracker> → <other>`",
    );
    expect(body).toContain("skip steps 1–8");
    expect(body).toMatch(/`git mv` each file to its new name/);
    expect(body).toContain(
      "reseedBranchTemplate(claudeMdPath, { date })",
    );
  });
});

// ===========================================================================
// AC-STE-581.5 — which steps run, and the false equivalence corrected
// ===========================================================================

describe("AC-STE-581.5 — the false equivalence is gone and replaced", () => {
  test("`Materially equivalent` no longer appears in the reference doc", () => {
    expect(grepCount(SETUP_REFERENCE, "Materially equivalent")).toBe(0);
  });

  test("paired with a PRESENCE assertion — `step 7f` is named at least once", () => {
    // An absence check alone is satisfied by deleting the paragraph.
    expect(read(SETUP_REFERENCE).match(/step 7f/gi)?.length ?? 0).toBeGreaterThanOrEqual(1);
  });

  test("the docs say which steps the flag RUNS", () => {
    const prose = repointProse();
    expect(prose).toMatch(/7b/);
    expect(prose).toMatch(/7f/);
  });

  test("and which it does NOT — every other step skipped", () => {
    expect(repointProse()).toMatch(/every other[\s\S]{0,40}skip|skip every other/i);
  });

  test("the docs state that --migrate REFUSES when the mode does not change", () => {
    const prose = repointProse();
    expect(prose).toContain("--migrate");
    expect(prose).toMatch(/refus[\s\S]{0,120}(mode does not change|same mode|no-?op)/i);
  });

  test("and that --migrate SKIPS steps 1-8, which is where 7f lives", () => {
    const prose = repointProse();
    expect(prose).toMatch(/skips? steps 1[-–—]8/i);
    expect(prose).toMatch(/7f/);
  });

  test("the module's remedy keeps its literal `Remedy:` prefix", () => {
    // tests/setup-tracker-config-write.test.ts:536 is the ONLY assertion on
    // this string and it is shape-only. The literal must survive the edit.
    const src = read(PROPOSAL_MODULE);
    expect(src).toContain("Remedy:");
    expect(src).toContain("Refusing: tracker-config write");
  });
});

// ===========================================================================
// AC-STE-581.6 — the non-tty first-action rule, and the closed gate-site set
// ===========================================================================

describe("AC-STE-581.6 — first action, arbiter, and the 7f token contract", () => {
  test("the gate-site set is CLOSED — no fourth site was introduced", () => {
    expect([...GATE_SITES]).toEqual(["draft", "branch", "setup-socratic"]);
  });

  test("the repoint path routes through the existing setup-socratic arbiter", () => {
    const body = read(SETUP_SKILL);
    expect(body).toContain("evaluateGateMarkerRefusal");
    expect(body).toContain('gateSite: "setup-socratic"');
    // Every gateSite literal the setup skill names is one of the three.
    for (const m of body.matchAll(/gateSite:\s*\\?"([a-z-]+)\\?"/g)) {
      expect([...GATE_SITES], `gateSite "${m[1]}"`).toContain(m[1]!);
    }
  });

  test("the repoint contract states the first-action rule under non-tty stdin", () => {
    const prose = repointProse();
    expect(prose).toMatch(/non-?interactive|non-?tty|isTTY/i);
    expect(prose).toMatch(/first tool call|first action/i);
    expect(prose).toMatch(/ask|AskUserQuestion/i);
    expect(prose).toMatch(/refus/i);
  });

  test("step 7f's five-outcome capability contract is unchanged", () => {
    const row = lines(SPEC_WRITE_SKILL).find((l) =>
      l.includes("tracker_config_write_mcp_unavailable"),
    )!;
    for (const token of TRACKER_CONFIG_OUTCOMES) {
      expect(row, token).toContain(token);
    }
    expect(row).toContain("MUST emit exactly one literal token");
  });

  test("the repoint path emits exactly one of those literal tokens", () => {
    const prose = repointProse();
    const named = TRACKER_CONFIG_OUTCOMES.filter((t) => prose.includes(t));
    expect(named.length).toBeGreaterThan(0);
    expect(prose).toMatch(/exactly one/i);
  });
});

// ===========================================================================
// AC-STE-581.7 — the clobber hazard, stated in four separate clauses
// ===========================================================================

describe("AC-STE-581.7 — 7f re-runs, reads the new container, can clobber", () => {
  test("clause 1 — the docs say the flag DOES re-run step 7f", () => {
    expect(repointProse()).toMatch(/re-?runs?[\s\S]{0,60}7f|7f[\s\S]{0,60}is re-?run/i);
  });

  test("clause 2 — the docs say 7f reads the ACTIVE binding, the new container alone", () => {
    const prose = repointProse();
    expect(prose).toMatch(/active binding/i);
    expect(prose).toMatch(/new container[\s\S]{0,40}alone|only the new container/i);
  });

  test("clause 3 — the docs say running it can CLOBBER a hand-written union", () => {
    const prose = repointProse();
    expect(prose).toMatch(/clobber/i);
    expect(prose).toMatch(/hand-?writ/i);
    expect(prose).toMatch(/union/i);
  });

  test("clause 4 — the docs ORDER a re-check AFTER the flip", () => {
    const prose = repointProse();
    expect(prose).toMatch(/re-?check/i);
    expect(prose).toMatch(/after the flip/i);
    expect(prose).toMatch(/hand-?merg/i);
  });

  test("clause 5 — the REASON is named: archived FRs stay bound to the old container", () => {
    const prose = repointProse();
    expect(prose).toMatch(/archiv/i);
    expect(prose).toMatch(/old container|legacy (?:container|binding)/i);
    expect(prose).toMatch(/ticket-?state probe|archive-side/i);
    expect(prose).toMatch(/unknown status|strand/i);
  });

  test("clause 6 — a CHECK is ordered; the collision is NOT asserted as an answer", () => {
    // Whether the two containers' status names collide is EMPIRICAL per repo
    // pair. Docs that assert an answer are wrong for every pair but one.
    const prose = repointProse();
    expect(prose).toMatch(/empirical|per repo pair|cannot be known in advance/i);
    // And the check itself is an imperative, not a remark.
    expect(prose).toMatch(/must re-?check|re-?check[\s\S]{0,40}after the flip/i);
  });
});

// ===========================================================================
// Non-negotiable constraints, all measured at HEAD
// ===========================================================================

describe("STE-581 constraints — caps, tokens, and the reachability pin", () => {
  test("NFR-1: skills/spec-write/SKILL.md still measures exactly 358 split-lines", () => {
    expect(splitLines(SPEC_WRITE_SKILL)).toBe(358);
  });

  test("spec-write's absolute position pin is unmoved — milestone attachment at line 111", () => {
    // An added line ABOVE it shifts it; index 110 is the 1-based line 111.
    expect(lines(SPEC_WRITE_SKILL)[110]!).toContain("**Milestone attachment");
  });

  test("STE tokens: setup 17, spec-write 54 — this FR adds ZERO", () => {
    expect(read(SETUP_SKILL).match(STE_TOKEN_RE)?.length ?? 0).toBe(17);
    expect(read(SPEC_WRITE_SKILL).match(STE_TOKEN_RE)?.length ?? 0).toBe(54);
  });

  test("STE tokens across skills/** stay at 245 — four sibling suites pin .toBe(245)", () => {
    const count = (dir: string): number => {
      let total = 0;
      for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        if (statSync(p).isDirectory()) total += count(p);
        else if (entry.endsWith(".md"))
          total += (readFileSync(p, "utf-8").match(STE_TOKEN_RE) ?? []).length;
      }
      return total;
    };
    expect(count(join(PLUGIN_ROOT, "skills"))).toBe(245);
  });

  test("the module-reachability probe: live ordered-unreachable equals the SHIPPED pin", () => {
    // Deliberately NOT `expect(ORDERED_UNREACHABLE_PIN).toBe(129)` — that is
    // true for exactly one commit and reds the next reachability IMPROVEMENT,
    // which module_reachability.ts:624 names as the anti-pattern. The pin is
    // READ; only its direction is constrained.
    expect(ORDERED_UNREACHABLE_PIN).toBeLessThanOrEqual(129);
  });

  test("...and the probe is AWAITED, so the fields are real", async () => {
    const report = await runModuleReachabilityProbe(PROJECT_ROOT);
    // Unawaited, every field reads undefined and every assertion below passes
    // vacuously. Grade the type first.
    expect(typeof report.orderedUnreachable).toBe("number");
    expect(report.records.length).toBeGreaterThan(0);
    expect(report.orderedUnreachable).toBe(ORDERED_UNREACHABLE_PIN);
  });

  test("tracker_config_proposal.ts is still unreachable — so docs must not ORDER it", () => {
    // The precondition prose lives in docs/**, which IS a scanned surface.
    // Naming this module's PATH in an ordering sentence there is a +1 on a
    // down-only pin.
    expect(moduleGraph().reachable(PROPOSAL_MODULE)).toBe(false);
  });

  test("the precondition section names no `.ts` path in an ORDERING line", async () => {
    const pre = preconditions();
    expect(pre, "## Repoint preconditions").not.toBeNull();
    const inside = referenceDocRefs().filter(
      (r) => r.line >= pre!.start && r.line <= pre!.end,
    );
    for (const r of inside) {
      expect(r.refClass, `${SETUP_REFERENCE}:${r.line} names ${r.module}`).not.toBe(
        "ordered",
      );
    }
  });

  test("FALSIFIABILITY — an ordering sentence naming the module WOULD be caught", () => {
    // Proves the arm above can fail: the classifier really does call this
    // shape "ordered", so a passing run is evidence and not silence.
    expect(
      classifyReferenceLine(
        "1. Call `runTrackerConfigWrite(...)` from `adapters/_shared/src/tracker_config_proposal.ts`.",
      ),
    ).toBe("ordered");
  });

  test("no ordering line ANYWHERE in the reference doc names the proposal module", () => {
    for (const r of referenceDocRefs()) {
      if (r.module !== PROPOSAL_MODULE) continue;
      expect(r.refClass, `${SETUP_REFERENCE}:${r.line}`).not.toBe("ordered");
    }
  });
});
