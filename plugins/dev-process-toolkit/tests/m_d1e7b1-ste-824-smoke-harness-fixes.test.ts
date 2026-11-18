// STE-824 — the smoke harness reaches what each fixture names and stays out of
// the operator's stores.
//
// Contract tests over the repo-local `.claude/skills/smoke-test/SKILL.md`
// (fixtures 1b, 5b, group 2's template, 3a/3b, 13a, group 14, Phase 0.5,
// Phase 4 and the child-spawn sections) plus CLI tests for
// `capability_row_assert.ts`'s missing-capture branch and the fixture-group
// renderer's group-14 line. Each AC pins a structural element — a code span, a
// command line, a template field, a spawn's prompt — never loose wording alone.
//
// AC-STE-824.10 (full suite, skip identities vs baseline) is graded by the
// orchestrator and deliberately has no test here.

import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classify, parseFences, pluginRoot, readDoc, spawnLineIndices } from "./_spawn_fences";
import { EXPECTATIONS, PROBE_VERDICTS } from "../adapters/_shared/src/capability_row_assert";

const SKILL = readDoc("smoke-test").replace(/\r\n/g, "\n");
const SKILL_LINES = SKILL.split("\n");

const CAP_ASSERT = join(pluginRoot, "adapters", "_shared", "src", "capability_row_assert.ts");
const FIXTURE_GROUPS = join(pluginRoot, "adapters", "_shared", "src", "smoke_fixture_groups.ts");

/**
 * The text of the section opened by the first heading line that starts with
 * `prefix`, up to (not including) the next heading of the same or a higher
 * level. Throws when the heading is absent, so a renamed section is a loud red.
 */
function section(prefix: string): string {
  const start = SKILL_LINES.findIndex((l) => l.startsWith(prefix));
  if (start < 0) throw new Error(`heading not found: ${prefix}`);
  const level = /^(#+)/.exec(SKILL_LINES[start]!)![1]!.length;
  let inFence = false;
  let end = SKILL_LINES.length;
  for (let i = start + 1; i < SKILL_LINES.length; i++) {
    const line = SKILL_LINES[i]!;
    if (/^\s*`{3,}/.test(line)) inFence = !inFence;
    if (inFence) continue;
    const m = /^(#+)\s/.exec(line);
    if (m && m[1]!.length <= level) {
      end = i;
      break;
    }
  }
  return SKILL_LINES.slice(start, end).join("\n");
}

/** Every inline code span's content in `text`. */
function codeSpans(text: string): string[] {
  return [...text.matchAll(/(`+)([^`]+?)\1/g)].map((m) => m[2]!);
}

/** Markdown bullets in `text`, each joined with its wrapped continuation lines. */
function bullets(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    if (/^\s*- /.test(line)) out.push(line);
    else if (out.length > 0 && /^\s{2,}\S/.test(line)) out[out.length - 1] += ` ${line.trim()}`;
    else if (line.trim() === "") out.push("");
  }
  return out.filter((b) => b !== "");
}

// The chain's own /spec-write feature — the one FR every leg's chain writes.
const CHAIN_FEATURE_FILES = ["src/greet.ts", "src/greet.test.ts"];

/** `src/…` paths a section names: the files its stub's feature lives in. */
function srcPaths(text: string): string[] {
  return [...text.matchAll(/\bsrc\/[A-Za-z0-9_./-]+\.[A-Za-z]+/g)].map((m) => m[0]!.replace(/[.,;:]+$/, ""));
}

// ---------------------------------------------------------------------------
// AC-STE-824.1 — fixtures 1b and 5b use a stub no chain FR has written.
// ---------------------------------------------------------------------------

describe("AC-STE-824.1 — fixtures 1b and 5b stub a feature the chain never wrote", () => {
  for (const [name, heading] of [
    ["1b", "##### Sub-fixture 1b"],
    ["5b", "##### Sub-fixture 5b"],
  ] as const) {
    test(`sub-fixture ${name} names its own stub's files, and none is the chain feature's`, () => {
      const text = section(heading);
      const paths = srcPaths(text);
      // The canonical chain stub names its files (`File src/greet.ts; test
      // src/greet.test.ts`); a fixture stub that names none is indistinguishable
      // from one that silently reuses the chain's and stops at "already exists".
      expect(paths.length).toBeGreaterThan(0);
      expect(paths.filter((p) => CHAIN_FEATURE_FILES.includes(p))).toEqual([]);
    });

    test(`sub-fixture ${name} carries its stub verbatim in a code span or fence, not the chain's greet()`, () => {
      const text = section(heading);
      const fenced = parseFences("smoke-test", text).map((f) => f.body);
      const literals = [...codeSpans(text), ...fenced].filter((s) => /\bsrc\//.test(s));
      expect(literals.length).toBeGreaterThan(0);
      expect(literals.filter((s) => /\bgreet\b/.test(s))).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------
// AC-STE-824.2 — a missing capture exits 2 with one error line, every expectation.
// ---------------------------------------------------------------------------

function runCli(args: string[]): { code: number; stdout: string; stderr: string } {
  const r = Bun.spawnSync(["bun", CAP_ASSERT, ...args], { stdout: "pipe", stderr: "pipe" });
  return { code: r.exitCode ?? -1, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
}

function nonEmptyLines(s: string): string[] {
  return s.split("\n").filter((l) => l.trim() !== "");
}

describe("AC-STE-824.2 — capability_row_assert refuses a missing capture", () => {
  const dir = mkdtempSync(join(tmpdir(), "ste824-cap-"));
  const missing = join(dir, "no-such-capture.log");

  test("the fixture capture path really is absent", () => {
    expect(existsSync(missing)).toBe(false);
  });

  // Enumerated from the module, so an expectation added later is covered too.
  const expectations = [...EXPECTATIONS];

  test("the module exports the expectation vocabulary, absent included", () => {
    expect(expectations).toContain("absent");
    expect(expectations.length).toBeGreaterThan(1);
  });

  for (const expectation of expectations) {
    test(`${expectation}: exit 2`, () => {
      expect(runCli([expectation, missing, "some_capability_key"]).code).toBe(2);
    });

    test(`${expectation}: exactly one error line on stderr, nothing on stdout`, () => {
      const r = runCli([expectation, missing, "some_capability_key"]);
      expect(nonEmptyLines(r.stderr).length).toBe(1);
      expect(nonEmptyLines(r.stdout)).toEqual([]);
    });
  }

  // The `probe-row` subcommand scores a missing capture the same way today, so
  // it is the same defect through a second door.
  for (const verdict of [...PROBE_VERDICTS]) {
    test(`probe-row ${verdict}: exit 2 with exactly one error line`, () => {
      const r = runCli(["probe-row", missing, "26", verdict]);
      expect(r.code).toBe(2);
      expect(nonEmptyLines(r.stderr).length).toBe(1);
      expect(nonEmptyLines(r.stdout)).toEqual([]);
    });
  }

  test("an existing empty capture still scores (no usage error): absent exits 0", () => {
    const empty = join(dir, "empty.log");
    writeFileSync(empty, "");
    expect(runCli(["absent", empty, "some_capability_key"]).code).toBe(0);
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));
});

// ---------------------------------------------------------------------------
// AC-STE-824.3 (amended) — group 2 stages its own fixture ticket per run and
// binds the template to it; its probe-row expectations discriminate.
// ---------------------------------------------------------------------------

/**
 * Prose units of `text` outside fenced blocks: every blank-line paragraph that
 * is not a bullet list, plus every bullet joined with its continuation lines.
 */
function proseUnits(text: string): string[] {
  const unfenced: string[] = [];
  let inFence = false;
  for (const line of text.split("\n")) {
    if (/^\s*`{3,}/.test(line)) {
      inFence = !inFence;
      unfenced.push("");
      continue;
    }
    if (!inFence) unfenced.push(line);
  }
  const body = unfenced.join("\n");
  const paras = body.split(/\n\s*\n/).filter((p) => p.trim() !== "" && !/^\s*- /.test(p));
  return [...paras, ...bullets(body)];
}

describe("AC-STE-824.3 — fixture group 2 binds the fixture ticket its stage step created", () => {
  const group2 = section("#### Fixture group 2");
  const template = parseFences("smoke-test", group2).find((f) => f.info === "markdown" && /^tracker:/m.test(f.body));
  const units = proseUnits(group2);
  const PLACEHOLDER = "<FIXTURE_TICKET>";

  /** The group's stage step for the fixture ticket: the unit that labels it `dpt-smoke` and creates it. */
  function stageUnit(): string {
    const hits = units.filter(
      (u) => codeSpans(u).includes("dpt-smoke") && /\bfixture ticket\b/i.test(u) && /\bcreat/i.test(u),
    );
    // An absent stage step reads as empty text, so each property test goes
    // red at its own assertion rather than in this lookup.
    return hits[0] ?? "";
  }

  test("group 2 carries its canonical FR template fence", () => {
    expect(template?.body ?? "").toMatch(/^tracker:/m);
  });

  test("the template binds the `<FIXTURE_TICKET>` placeholder", () => {
    const binding = /^\s+linear:\s*(\S+)/m.exec(template?.body ?? "")?.[1] ?? null;
    expect(binding).toBe(PLACEHOLDER);
  });

  test("no staging, cleanup or sub-fixture step in group 2 names the made-up FIX-A ticket", () => {
    expect(group2.match(/FIX-A/g) ?? []).toEqual([]);
  });

  test("group 2 no longer binds the chain's ticket placeholder", () => {
    expect(group2.match(/<CHAIN_TICKET>/g) ?? []).toEqual([]);
  });

  test("the prose defines `<FIXTURE_TICKET>` as the ticket the stage step created", () => {
    const defining = units.filter(
      (u) => u.includes(PLACEHOLDER) && /\bstage step\b/i.test(u) && /\bcreated\b/i.test(u) && /\bticket\b/i.test(u),
    );
    expect(defining.length).toBeGreaterThan(0);
  });

  test("the stage step creates exactly one fixture ticket per run", () => {
    expect(stageUnit()).toMatch(/\b(?:exactly )?one fixture ticket per run\b/i);
  });

  test("the stage step labels the ticket `dpt-smoke` (code span)", () => {
    expect(codeSpans(stageUnit())).toContain("dpt-smoke");
  });

  test("on Linear the stage step creates it in team STE, inside the run's smoke project", () => {
    const u = stageUnit();
    expect(u).toMatch(/\bLinear\b[^.;]*\bteam STE\b/);
    expect(u).toMatch(/DPT Smoke Test \(<date>\)|run's (?:smoke )?project/);
  });

  test("on Jira the stage step creates it in the `--jira-project` Space (e.g. DST)", () => {
    const u = stageUnit();
    expect(codeSpans(u)).toContain("--jira-project");
    expect(u).toMatch(/\bDST\b/);
  });

  test("the fixture ticket is bound to no milestone and no Epic", () => {
    const u = stageUnit();
    expect(u).toMatch(/\bno milestone\b/i);
    expect(u).toMatch(/\bEpic\b/);
  });

  test("the tracker-less leg keeps group 2 n/a", () => {
    const hits = units.filter((u) => /\btracker-less\b/i.test(u) && /\bn\/a\b/i.test(u));
    expect(hits.length).toBeGreaterThan(0);
  });

  test("a failed create aborts group 2 with `fixture ticket not created`", () => {
    const hits = units.filter((u) => codeSpans(u).includes("fixture ticket not created") && /\babort/i.test(u));
    expect(hits.length).toBeGreaterThan(0);
  });

  test("the failed-create step forbids falling back to a made-up id", () => {
    const hits = units.filter(
      (u) => codeSpans(u).includes("fixture ticket not created") && /\b(?:never|not|no)\b[^.]*\bmade-up\b/i.test(u),
    );
    expect(hits.length).toBeGreaterThan(0);
  });

  test("teardown closes the fixture ticket through 3a/3b's per-leg teardown, no second sweep", () => {
    const hits = units.filter(
      (u) =>
        /\bfixture ticket\b/i.test(u) &&
        /\bPhase 5\b/.test(u) &&
        /\bclose/i.test(u) &&
        /\b3a\b/.test(u) &&
        /\b3b\b/.test(u) &&
        /\bno second sweep\b/i.test(u),
    );
    expect(hits.length).toBeGreaterThan(0);
  });

  test("the recipe states one ticket per run, created and closed in the same run", () => {
    const hits = units.filter(
      (u) => /\bone (?:fixture )?ticket per run\b/i.test(u) && /\bcreated and closed in the same run\b/i.test(u),
    );
    expect(hits.length).toBeGreaterThan(0);
  });

  // The probe-row expectation each sub-fixture's bullets carry, parsed from
  // the exact CAP_ASSERT code span — never from loose prose.
  const PROBE_ROW = /^bun "\$\{CAP_ASSERT\}" probe-row (\S+) 26 (\S+)$/;
  const SUBS = [
    ["2a", "##### Sub-fixture 2a", "ste221-positive", "notes"],
    ["2b", "##### Sub-fixture 2b", "ste221-control", "fail"],
    ["2c", "##### Sub-fixture 2c", "ste221-alias", "notes"],
  ] as const;

  function probeRowVerdicts(heading: string, capture: string): string[] {
    return bullets(section(heading))
      .flatMap((b) => codeSpans(b))
      .map((s) => PROBE_ROW.exec(s.trim()))
      .filter((m): m is RegExpExecArray => m !== null && m[1]!.includes(capture))
      .map((m) => m[2]!);
  }

  for (const [name, heading, capture, verdict] of SUBS) {
    test(`sub-fixture ${name} asserts \`probe-row … 26 ${verdict}\` on its own capture`, () => {
      expect(probeRowVerdicts(heading, capture)).toEqual([verdict]);
    });
  }

  test("every parsed probe-row verdict is one the CLI accepts", () => {
    const all = SUBS.flatMap(([, heading, capture]) => probeRowVerdicts(heading, capture));
    expect(all.filter((v) => !PROBE_VERDICTS.has(v))).toEqual([]);
  });

  test("the three sub-fixtures' probe-row expectations hold at least two different verdicts", () => {
    const perSub = SUBS.map(([, heading, capture]) => probeRowVerdicts(heading, capture));
    expect(perSub.map((v) => v.length)).toEqual([1, 1, 1]);
    expect(new Set(perSub.flat()).size).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-824.4 — Phase 4's docs row reads settings.yaml's docs: on a 3.x tree.
// ---------------------------------------------------------------------------

describe("AC-STE-824.4 — the Phase 4 docs row is settings-file aware", () => {
  const phase4 = section("### Phase 4");
  const rows = bullets(phase4);

  test("a Phase 4 row reads the `docs:` block of `specs/settings.yaml`", () => {
    const hits = rows.filter((r) => {
      const spans = codeSpans(r);
      return spans.some((s) => s.includes("specs/settings.yaml")) && spans.some((s) => /^docs:?$/.test(s.trim()));
    });
    expect(hits.length).toBeGreaterThan(0);
  });

  test("every Phase 4 row that asserts `## Docs` scopes it to a legacy tree", () => {
    const docsRows = rows.filter((r) => codeSpans(r).some((s) => s.trim() === "## Docs"));
    expect(docsRows.length).toBeGreaterThan(0);
    expect(docsRows.filter((r) => !/\blegacy\b/i.test(r))).toEqual([]);
  });

  test("every Phase 4 row that asserts `## Docs` also names the settings-file branch", () => {
    const docsRows = rows.filter((r) => codeSpans(r).some((s) => s.trim() === "## Docs"));
    expect(docsRows.filter((r) => !r.includes("specs/settings.yaml"))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-824.5 — 3a/3b say how a tracker leg creates its tickets and closes them.
// ---------------------------------------------------------------------------

describe("AC-STE-824.5 — 3a and 3b recipes create and close their tickets", () => {
  for (const [name, heading] of [
    ["3a", "##### Sub-fixture 3a"],
    ["3b", "##### Sub-fixture 3b"],
  ] as const) {
    test(`${name}'s stage step says how a tracker leg creates the FR's ticket`, () => {
      const stage = bullets(section(heading)).filter((b) => /^\s*- Stage:/.test(b));
      expect(stage.length).toBe(1);
      expect(stage[0]).toMatch(/\bticket/i);
      expect(stage[0]).toMatch(/\btracker leg/i);
    });

    test(`${name} says how teardown closes those tickets`, () => {
      const text = section(heading);
      const closing = bullets(text).filter((b) => /\bticket/i.test(b) && /(Phase 5|teardown)/i.test(b));
      expect(closing.length).toBeGreaterThan(0);
    });
  }

  test("3a's created tickets carry the `dpt-smoke` label the Jira teardown sweep closes by", () => {
    // Phase 5's Jira path transitions only `labels = "dpt-smoke"` run-window items,
    // so a ticket created without that label survives teardown.
    expect(codeSpans(section("##### Sub-fixture 3a"))).toContain("dpt-smoke");
  });

  /** Phase 5's `#### Linear path` subsection, scoped inside `### Phase 5 — Teardown`. */
  function phase5Linear(): string {
    const phase5 = section("### Phase 5 — Teardown");
    const lines = phase5.split("\n");
    const start = lines.findIndex((l) => l.startsWith("#### Linear path"));
    if (start < 0) throw new Error("Phase 5 has no `#### Linear path`");
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      if (/^#{1,4}\s/.test(lines[i]!)) {
        end = i;
        break;
      }
    }
    return lines.slice(start, end).join("\n");
  }

  test("Phase 5's Linear path closes every `dpt-smoke`-labelled issue in the run's project via `mcp__linear__save_issue`", () => {
    const units = bullets(phase5Linear()).concat(phase5Linear().split(/\n\s*\n/));
    const hits = units.filter(
      (u) =>
        u.includes("mcp__linear__save_issue") &&
        codeSpans(u).includes("dpt-smoke") &&
        /\bproject\b/i.test(u) &&
        /\bstate\b[^.]*\b(?:Done|Canceled|Cancelled|canceled|cancelled|closed|completed)\b/.test(u),
    );
    expect(hits.length).toBeGreaterThan(0);
  });

  test("Phase 5's Linear path closes the issues BEFORE the project is completed", () => {
    const text = phase5Linear();
    const issueAt = text.indexOf("mcp__linear__save_issue");
    const projectAt = text.indexOf("mcp__linear__save_project");
    expect(projectAt).toBeGreaterThanOrEqual(0);
    expect(issueAt).toBeGreaterThanOrEqual(0);
    expect(issueAt).toBeLessThan(projectAt);
  });

  for (const [name, heading] of [
    ["3a", "##### Sub-fixture 3a"],
    ["3b", "##### Sub-fixture 3b"],
  ] as const) {
    test(`${name}'s "Ticket teardown" bullet says the Linear ticket is closed, not archived with the project`, () => {
      const td = bullets(section(heading)).filter((b) => /^\s*- Ticket teardown:/.test(b));
      expect(td.length).toBe(1);
      expect(td[0]).not.toMatch(/archived with the run's project|Linear project archive/i);
      expect(td[0]).toMatch(/\bLinear\b:?[^.;]*\bclose[sd]?\b/);
    });
  }

  test("no line claims the project completion keeps the free-issue cap from growing", () => {
    const claims = SKILL_LINES.filter(
      (l) => /free-issue cap/i.test(l) && /\bkeeps?\b/i.test(l) && /\b(?:archiv\w*|complet\w*)\b/i.test(l),
    );
    expect(claims).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-824.6 — 13a passes /setup's first-turn gate; the refusal is setup-template's.
// ---------------------------------------------------------------------------

describe("AC-STE-824.6 — fixture 13a reaches setup-template's own refusal", () => {
  const text = section("##### Sub-fixture 13a");
  const MARKER = "<dpt:auto-approve>v1</dpt:auto-approve>";

  test("the 13a spawn's prompt carries the auto-approve marker that satisfies /setup's first-turn gate", () => {
    expect(codeSpans(text)).toContain(MARKER);
    const paras = text.split(/\n\s*\n/).filter((p) => p.includes(MARKER) && /first-turn/i.test(p));
    expect(paras.length).toBeGreaterThan(0);
  });

  test("an assertion distinguishes setup-template's refusal from /setup's own", () => {
    const assertions = text.split("**Assertions:**")[1]?.split("**Diagnostic")[0] ?? "";
    const STANDALONE_SETUP = /(?:`\/setup`|\/dev-process-toolkit:setup(?![\w-])|(?<![\w/-])\/setup(?![\w-]))/;
    const distinguishing = bullets(assertions).filter(
      (b) => /setup-template/.test(b) && STANDALONE_SETUP.test(b),
    );
    expect(distinguishing.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-824.7 — group 14 is N/A (headless) on a headless leg, counted as n/a.
// ---------------------------------------------------------------------------

describe("AC-STE-824.7 — group 14 renders N/A (headless)", () => {
  const LINE = "STE-492 runtime check: N/A (headless)";

  test("group 14's footer names the headless line", () => {
    expect(codeSpans(section("#### Fixture group 14"))).toContain(LINE);
  });

  /**
   * The SKILL's own documented render invocation, with --leg / --passed /
   * --failed stripped: whatever extra flag the driver passes to mark a leg
   * headless is taken from the document, not guessed here.
   */
  function documentedExtraFlags(): string[] {
    const fence = parseFences("smoke-test", section("#### Phase 2.X summary line")).find((f) =>
      f.body.includes("smoke_fixture_groups.ts"),
    );
    if (fence === undefined) throw new Error("Phase 2.X summary line render fence not found");
    const cmd = fence.lines
      .filter((l) => !/^\s*#/.test(l))
      .join("\n")
      .replace(/\\\n/g, " ");
    const renderAt = cmd.indexOf(" render");
    const tokens = cmd.slice(renderAt + " render".length).match(/"[^"]*"|\S+/g) ?? [];
    const out: string[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i]!;
      if (t === "--leg" || t === "--passed" || t === "--failed") {
        // Skip the value, including a multi-word `<placeholder>`.
        i++;
        if (tokens[i]?.startsWith("<")) while (i < tokens.length && !tokens[i]!.endsWith(">")) i++;
        continue;
      }
      out.push(t.replace(/^"|"$/g, ""));
    }
    return out;
  }

  function render(leg: string, passed: number[]) {
    const r = Bun.spawnSync(
      ["bun", FIXTURE_GROUPS, "render", "--leg", leg, "--passed", passed.join(" "), ...documentedExtraFlags()],
      { stdout: "pipe", stderr: "pipe" },
    );
    return { code: r.exitCode ?? -1, stdout: r.stdout.toString() };
  }

  // Every group the linear leg rosters except 14 (and 13, the control below).
  const LINEAR_GROUPS_BUT_14 = [1, 2, 3, 4, 5, 6, 7, 8, 11, 12, 13, 15];

  test("a headless leg that ran every other group renders group 14 as N/A (headless)", () => {
    expect(render("linear", LINEAR_GROUPS_BUT_14).stdout.split("\n")).toContain(LINE);
  });

  test("the roster counts group 14 as n/a, not not-reached", () => {
    const head = render("linear", LINEAR_GROUPS_BUT_14).stdout.split("\n")[0] ?? "";
    // linear's by-design n/a groups are 9 and 10; group 14 makes three.
    expect(head).toContain("0 not-reached");
    expect(head).toContain("3 n/a");
  });

  // Fix round 1 (verify survivor 824-a): the exemption is headless-only. The same render without
  // the documented headless flag keeps an unreported group 14 NOT-REACHED.
  test("a non-headless leg that never reached group 14 still renders it NOT-REACHED", () => {
    const r = Bun.spawnSync(
      ["bun", FIXTURE_GROUPS, "render", "--leg", "linear", "--passed", LINEAR_GROUPS_BUT_14.join(" ")],
      { stdout: "pipe", stderr: "pipe" },
    );
    const lines = r.stdout.toString().split("\n");
    expect(documentedExtraFlags().length).toBeGreaterThan(0);
    expect(lines).toContain("STE-492 runtime check: NOT-REACHED");
    expect(lines).not.toContain(LINE);
  });

  test("an unreported group other than 14 still renders NOT-REACHED", () => {
    const out = render("linear", LINEAR_GROUPS_BUT_14.filter((g) => g !== 13)).stdout;
    expect(out.split("\n")).toContain("STE-469 runtime check: NOT-REACHED");
  });
});

// ---------------------------------------------------------------------------
// AC-STE-824.8 — Phase 0.5 deletes the test project's auto-memory; every child
// prompt carries the stay-in-the-test-project preamble.
// ---------------------------------------------------------------------------

const PREAMBLE = /outside (?:of )?the test project/i;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * True when some spawn-referenced variable has an exact assignment in `doc` —
 * `NAME=` at a line start (after indentation) or after `export `, the name
 * bounded on the left — whose value carries the preamble sentence. A longer
 * name that merely ends in NAME, or a mention of NAME elsewhere, does not count.
 */
function preambleViaVariable(text: string, doc: string = SKILL): boolean {
  const names = new Set([...text.matchAll(/\$\{?([A-Z_][A-Z0-9_]*)\b/g)].map((m) => m[1]!));
  return [...names].some((name) => {
    const assign = new RegExp(`^[ \\t]*(?:export[ \\t]+)?${escapeRe(name)}=("[^"\\n]*"|'[^'\\n]*'|\\S*)`, "gm");
    return [...doc.matchAll(assign)].some((m) => PREAMBLE.test(m[1]!));
  });
}

/** Phase 0.5's auto-memory rm line and its verify line (code lines naming `/memory`). */
function memoryLines(codeLines: string[]): { rm?: string; verify?: string } {
  const mem = codeLines.filter((l) => /\/memory\b/.test(l) && !/^\s*#/.test(l));
  return {
    rm: mem.find((l) => /\brm\s+-[a-z]*r/.test(l)),
    verify: mem.find((l) => !/\brm\s+-/.test(l)),
  };
}

describe("AC-STE-824.8 — children stay out of the operator's stores", () => {
  const phase05 = section("### Phase 0.5");
  const codeLines = parseFences("smoke-test", phase05).flatMap((f) => {
    const kinds = classify(f.lines);
    return f.lines.filter((_, i) => kinds[i] === "code");
  });
  // The memory wipe's derivation, guards and fail-on-presence verify are pinned
  // (statically and by running the lines) in "Stage B review round 1" below.
  test("Phase 0.5 has an auto-memory rm and a separate auto-memory verify", () => {
    expect(memoryLines(codeLines).rm).toBeDefined();
    expect(memoryLines(codeLines).verify).toBeDefined();
  });

  /** A spawn's command text: continuation lines plus any heredoc body. */
  function spawnTexts(): { at: string; text: string }[] {
    const out: { at: string; text: string }[] = [];
    for (const f of parseFences("smoke-test", SKILL)) {
      const kinds = classify(f.lines);
      for (const idx of spawnLineIndices(f)) {
        const parts: string[] = [];
        let i = idx;
        while (i < f.lines.length) {
          parts.push(f.lines[i]!);
          if (!/\\\s*$/.test(f.lines[i]!)) break;
          i++;
        }
        for (let j = i + 1; j < f.lines.length && kinds[j] === "heredoc"; j++) parts.push(f.lines[j]!);
        out.push({ at: `L${f.openLine + idx + 1}`, text: parts.join("\n") });
      }
    }
    return out;
  }

  test("the SKILL documents at least one fenced child spawn", () => {
    expect(spawnTexts().length).toBeGreaterThan(0);
  });

  test("every fenced child spawn's prompt carries the writes-nothing-outside-the-test-project preamble", () => {
    const sites = spawnTexts().filter((s) => !/^\s*claude -p \.\.\./.test(s.text)); // elided retry shorthands
    const missing = sites.filter((s) => !PREAMBLE.test(s.text) && !preambleViaVariable(s.text)).map((s) => s.at);
    expect(missing).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-824.9 — `claude … &` inside a shell function needs its stdin on the line.
// ---------------------------------------------------------------------------

describe("AC-STE-824.9 — the child-spawn section covers the shell-function stdin trap", () => {
  const spawnSection = [
    section("#### Phase 2 child-spawn discipline"),
    section("#### Heredoc-on-stdin for prompt-bearing children"),
  ].join("\n\n");

  test("a paragraph states that a backgrounded claude inside a shell function needs its heredoc or stdin redirect on the same line", () => {
    const paras = spawnSection.split(/\n\s*\n/).filter((p) => {
      const spans = codeSpans(p);
      return (
        /shell function/i.test(p) &&
        /same line/i.test(p) &&
        spans.some((s) => /\bclaude\b.*&\s*$/.test(s.trim())) &&
        spans.some((s) => s.includes("< /dev/null") || s.includes("<<"))
      );
    });
    expect(paras.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Stage B review round 1 — the memory wipe derives its path, every spawn carries
// the preamble, 13a's discriminator, group 14's Source line, and a tighter
// preamble-by-variable check.
// ---------------------------------------------------------------------------

describe("Stage B review round 1", () => {
  const phase05Code = parseFences("smoke-test", section("### Phase 0.5")).flatMap((f) => {
    const kinds = classify(f.lines);
    return f.lines.filter((_, i) => kinds[i] === "code");
  });
  const { rm, verify } = memoryLines(phase05Code);
  const CONFIG_PROJECTS = "${CLAUDE_CONFIG_DIR:-$HOME/.claude-st}/projects";
  const DERIVE = /\$\(cd \.\. && pwd -P\)[\s\S]*\benc=\$\(printf %s "\$top\/dpt-test-project-<tracker>" \| sed "s#\[\^A-Za-z0-9\]#-#g"\)/;
  const ENC_GUARD = /\[ -n "\$enc" \] \|\| \{[^}]*\bexit 1; \}/;

  test("AC-STE-824.8: no Phase 0.5 line hardcodes an encoded project directory", () => {
    expect(phase05Code.filter((l) => /projects\/-/.test(l) || /-Users-/.test(l))).toEqual([]);
  });

  for (const [name, line] of [["rm", rm], ["verify", verify]] as const) {
    test(`AC-STE-824.8: the memory ${name} line sits under the config-dir variable's projects/`, () => {
      expect(line).toBeDefined();
      expect(line!).toContain(`P="${CONFIG_PROJECTS}"`);
      expect(line!).toContain('"$P/$enc/memory"');
    });

    test(`AC-STE-824.8: the memory ${name} line derives the name with pwd -P and Claude Code's encoding`, () => {
      expect(line!).toMatch(DERIVE);
    });

    test(`AC-STE-824.8: the memory ${name} line refuses on an empty name before touching any path`, () => {
      const guard = line!.match(ENC_GUARD);
      expect(guard).not.toBeNull();
      const touch = name === "rm" ? line!.indexOf("rm -rf") : line!.indexOf("for d in");
      expect(guard!.index!).toBeLessThan(touch);
    });
  }

  test("AC-STE-824.8: the verify line exits non-zero when the directory still exists", () => {
    expect(verify!).toMatch(/if \[ -e "\$d" \]; then [^;]*>&2; exit 1; fi/);
  });

  // Run the two lines against a sandbox config dir (HOME too, so no fallback
  // can reach the operator's own store).
  function sandbox() {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "ste824-mem-")));
    // A `.` and a `_` in the path: Claude Code turns every non-alphanumeric character into `-`.
    const ws = join(root, ".wt", "ws_x");
    const toolkit = join(ws, "dev-process-toolkit");
    const cfg = join(root, "cfg");
    mkdirSync(toolkit, { recursive: true });
    mkdirSync(join(root, "home"), { recursive: true });
    const enc = (leg: string) => join(ws, `dpt-test-project-${leg}`).replace(/[^A-Za-z0-9]/g, "-");
    const mem = (dir: string) => {
      const p = join(cfg, "projects", dir, "memory");
      mkdirSync(p, { recursive: true });
      writeFileSync(join(p, "MEMORY.md"), "stale\n");
      return p;
    };
    const run = (line: string | undefined, extraPath?: string) => {
      if (line === undefined || !line.includes("${CLAUDE_CONFIG_DIR:-")) {
        throw new Error("refusing to run a memory line that ignores CLAUDE_CONFIG_DIR");
      }
      const r = Bun.spawnSync(["bash", "-c", line.replaceAll("<tracker>", "linear")], {
        cwd: toolkit,
        env: {
          ...process.env,
          CLAUDE_CONFIG_DIR: cfg,
          HOME: join(root, "home"),
          PATH: extraPath ? `${extraPath}:${process.env.PATH}` : process.env.PATH,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      return { code: r.exitCode ?? -1, stderr: r.stderr.toString() };
    };
    return { root, cfg, enc, mem, run };
  }
  const roots: string[] = [];
  afterAll(() => {
    for (const r of roots) rmSync(r, { recursive: true, force: true });
  });

  test("AC-STE-824.8: run, the rm deletes this leg's memory and its Phase 8 workspaces', and no other leg's", () => {
    const s = sandbox();
    roots.push(s.root);
    const own = s.mem(s.enc("linear"));
    const phase8 = s.mem(`${s.enc("linear")}--phase8-setup`);
    const tandem = s.mem(s.enc("jira"));
    expect(s.run(rm).code).toBe(0);
    expect(existsSync(own)).toBe(false);
    expect(existsSync(phase8)).toBe(false);
    expect(existsSync(tandem)).toBe(true);
  });

  test("AC-STE-824.8: run, the verify passes on a clean store and fails naming the survivor", () => {
    const s = sandbox();
    roots.push(s.root);
    expect(s.run(verify).code).toBe(0);
    const own = s.mem(s.enc("linear"));
    const r = s.run(verify);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain(own);
  });

  test("AC-STE-824.8: run with an empty encoded name, both lines refuse and nothing is removed", () => {
    const s = sandbox();
    roots.push(s.root);
    const bin = join(s.root, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "sed"), "#!/bin/sh\ncat >/dev/null\nexit 0\n");
    chmodSync(join(bin, "sed"), 0o755);
    const bare = join(s.cfg, "projects", "memory");
    mkdirSync(bare, { recursive: true });
    const dashed = s.mem("--phase8-setup");
    const r = s.run(rm, bin);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/empty encoded project name/);
    expect(existsSync(bare)).toBe(true);
    expect(existsSync(dashed)).toBe(true);
    expect(s.run(verify, bin).code).not.toBe(0);
  });

  test("AC-STE-824.8: the child-spawn section says every spawn, fenced or in prose, passes the preamble flag", () => {
    const spawnSection = section("#### Phase 2 child-spawn discipline");
    const paras = spawnSection.split(/\n\s*\n/).filter(
      (p) =>
        /\bevery child spawn, fenced or described in prose\b/i.test(p) &&
        codeSpans(p).includes('--append-system-prompt "${DPT_SMOKE_PREAMBLE}"') &&
        ["1b", "5b", "13a"].every((id) => new RegExp(`\\b${id}\\b`).test(p)) &&
        /\bdefined\b/.test(p),
    );
    expect(paras.length).toBe(1);
    // The definition it points at is in the same section, as an exact assignment.
    expect(preambleViaVariable("${DPT_SMOKE_PREAMBLE}", spawnSection)).toBe(true);
  });

  test("AC-STE-824.8: preambleViaVariable rejects a spawn that references an undefined variable", () => {
    // SMOKE_PREAMBLE is a suffix of DPT_SMOKE_PREAMBLE, defined nowhere itself.
    expect(preambleViaVariable('claude -p --append-system-prompt "${SMOKE_PREAMBLE}"')).toBe(false);
    expect(preambleViaVariable('claude -p --append-system-prompt "${DPT_SMOKE_PREAMBLE}"')).toBe(true);
    // A mid-line mention is not an assignment, and a value without the sentence does not count.
    expect(preambleViaVariable("${X_P}", 'say X_P="outside the test project"\n')).toBe(false);
    expect(preambleViaVariable("${X_P}", 'X_P="stay home"\n# outside the test project\n')).toBe(false);
    expect(preambleViaVariable("${X_P}", 'export X_P="outside the test project"\n')).toBe(true);
  });

  test("AC-STE-824.6: 13a's discriminator is the absent gate_site= token; marker=present only supports it", () => {
    const assertions = section("##### Sub-fixture 13a").split("**Assertions:**")[1]?.split("**Diagnostic")[0] ?? "";
    const b = bullets(assertions).filter((x) => /setup-template/.test(x) && /`Context:`/.test(x));
    expect(b.length).toBe(1);
    expect(codeSpans(b[0]!)).toContain("gate_site=");
    expect(b[0]!).toMatch(/\bno `gate_site=` token\b/);
    expect(b[0]!).toMatch(/\bload-bearing discriminator\b/);
    expect(b[0]!).toMatch(/`marker=present`[^.]*\bsupporting evidence only\b/);
    expect(b[0]!).not.toMatch(/reads `marker=present` and/);
  });

  test("AC-STE-824.7: group 14's Source line carves the headless leg out of its NOT-REACHED rule", () => {
    const src = section("#### Fixture group 14")
      .split("\n")
      .filter((l) => l.startsWith("**Source:**"));
    expect(src.length).toBe(1);
    const sentence = src[0]!.split(/(?<=\.)\s+/).find((x) => /no stage report at all/.test(x)) ?? "";
    expect(sentence).toMatch(/NOT-REACHED/);
    expect(sentence).toMatch(/\bheadless leg\b/);
    expect(codeSpans(sentence)).toContain("STE-492 runtime check: N/A (headless)");
  });
});
