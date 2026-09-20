// STE-615 AC.6 + AC.7 + AC.8 — the announcing surfaces, the real-traffic
// replay, and the falsifiability record.
//
// AC.6 reads EXACTLY FOUR markdown files. Each scan is paired with a control
// read from the FR's pre-change base: a surface assertion that cannot fail on
// the old bytes grades nothing, and the four files it grades all carried the
// overstated sentence before this FR.
//
// The base is a FIXED sha, not the moving `HEAD` ref. Once this FR ships, `HEAD`
// is the post-change tree and every control below would compare the new bytes
// with themselves — a control that can never go red.

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readSpecFile } from "./_spec_tree";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const BASE = "fd10d40fc3ad125e4523f9d30c2eeed24d6f6033";

/** The four, and only the four, markdown surfaces AC-STE-615.6 names. */
const SURFACES = [
  "skills/pr/SKILL.md",
  "docs/honored-contracts.md",
  "docs/hooks-reference.md",
  "docs/workflow-overview.md",
] as const;

function read(rel: string): string {
  return readFileSync(join(PLUGIN_ROOT, rel), "utf-8");
}

/** The bytes of `rel` (plugin-relative) at the fixed base. */
function readAtBase(rel: string): string {
  const p = spawnSync("git", ["show", `${BASE}:plugins/dev-process-toolkit/${rel}`], {
    cwd: REPO_ROOT,
    encoding: "utf-8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (p.status !== 0) throw new Error(`git show ${rel} at ${BASE}: ${p.stderr}`);
  return p.stdout ?? "";
}

/**
 * THE OVERSTATED SENTENCE — the shape every one of the four surfaces carried at
 * the base: a claim that the gate acts on "the `gh pr create` Bash call", or an
 * admission that it does not yet resolve the target. Measured: at least one
 * such line in each of the four files at `BASE`, zero after this FR.
 */
const OVERSTATED =
  /(refuses|blocks|Before) (the|a) `gh pr create` Bash call|command-pattern guard for `gh pr create|does not yet do is resolve|lands under STE-615|is STE-615's/;

/** Lines of `body` that overstate what the gate does. */
function overstatedLines(body: string): string[] {
  return body.split("\n").filter((l) => OVERSTATED.test(l));
}

/**
 * Does this surface say WHICH SHAPES are recognised? A line that speaks of
 * recognition in the same breath as pull-request creation. Measured: zero such
 * lines in all four files at the base.
 */
function statesRecognition(body: string): boolean {
  return body
    .split("\n")
    .some((l) => /recognis/i.test(l) && /(gh pr|pull[- ]request|\bPR\b)/.test(l));
}

/**
 * Does this surface say WHERE the evidence is read from? The new phrase, chosen
 * because the base already says "raised from" in three of the four files while
 * deferring the behaviour to this FR — so "raised from" grades nothing, and
 * "is opened from" is measured absent in all four at the base.
 */
function statesOpenedFrom(body: string): boolean {
  return /\bis opened from\b/.test(body);
}

describe("AC-STE-615.6 — the four announcing surfaces state what the gate now does", () => {
  for (const rel of SURFACES) {
    test(`${rel} no longer overstates the matcher`, () => {
      expect({ rel, lines: overstatedLines(read(rel)) }).toEqual({ rel, lines: [] });
    });

    test(`CONTROL — ${rel} DOES carry the overstated sentence at the base`, () => {
      const base = readAtBase(rel);
      expect(base.length).toBeGreaterThan(0);
      expect({ rel, some: overstatedLines(base).length > 0 }).toEqual({ rel, some: true });
    });

    test(`${rel} states which shapes are recognised`, () => {
      expect({ rel, states: statesRecognition(read(rel)) }).toEqual({ rel, states: true });
    });

    test(`CONTROL — ${rel} states no such thing at the base`, () => {
      expect({ rel, states: statesRecognition(readAtBase(rel)) }).toEqual({ rel, states: false });
    });

    test(`${rel} states that the evidence is read from the checkout the request is opened from`, () => {
      expect({ rel, states: statesOpenedFrom(read(rel)) }).toEqual({ rel, states: true });
    });

    test(`CONTROL — ${rel} carries no such phrase at the base`, () => {
      expect({ rel, states: statesOpenedFrom(readAtBase(rel)) }).toEqual({ rel, states: false });
    });
  }
});

describe("AC-STE-615.6 — the hooks manual's own pre-pr-spec-review lines", () => {
  const section = (body: string): string => {
    const start = body.indexOf("### pre-pr-spec-review");
    expect(start).toBeGreaterThan(0);
    const end = body.indexOf("\n### ", start + 1);
    return body.slice(start, end === -1 ? undefined : end);
  };

  test("the Matcher line no longer names the retired anchored prefix", () => {
    const matcher = section(read("docs/hooks-reference.md"))
      .split("\n")
      .find((l) => l.includes("**Matcher:**"));
    expect(matcher).toBeDefined();
    expect(matcher!).not.toContain("gh pr create*");
  });

  test("CONTROL — the Matcher line DID name it at the base", () => {
    const matcher = section(readAtBase("docs/hooks-reference.md"))
      .split("\n")
      .find((l) => l.includes("**Matcher:**"));
    expect(matcher!).toContain("gh pr create*");
  });

  test("the Requirement line states the target checkout and the known-foreign refusal", () => {
    const req = section(read("docs/hooks-reference.md"))
      .split("\n")
      .find((l) => l.includes("**Requirement:**"));
    expect(req).toBeDefined();
    expect(req!.toLowerCase()).toMatch(/foreign|another repository|a repository it has no remote for/);
    expect(req!).not.toMatch(/does not yet|STE-615/);
  });
});

describe("AC-STE-615.6 — budgets on skills/pr/SKILL.md", () => {
  const frontMatter = (body: string): string => body.slice(0, body.indexOf("\n---", 4) + 4);

  test("its frontmatter is byte-identical to the base", () => {
    expect(frontMatter(read("skills/pr/SKILL.md")))
      .toEqual(frontMatter(readAtBase("skills/pr/SKILL.md")));
  });

  test("its body gains no `STE-<N>` token", () => {
    const count = (b: string): number => (b.match(/STE-\d+/g) ?? []).length;
    expect(count(read("skills/pr/SKILL.md")))
      .toBeLessThanOrEqual(count(readAtBase("skills/pr/SKILL.md")));
    // CONTROL — the matcher itself works, so a zero above is not blindness.
    expect(count("STE-1 and STE-22")).toBe(2);
  });

  test("it stays within the skill line cap the NFR-1 suite owns", () => {
    const nfr1 = readFileSync(join(PLUGIN_ROOT, "tests", "skill-nfr-1-length.test.ts"), "utf-8");
    const cap = Number.parseInt(/SKILL_LINE_CAP = (\d+)/.exec(nfr1)![1]!, 10);
    expect(cap).toBeGreaterThan(0);
    expect(read("skills/pr/SKILL.md").split("\n").length).toBeLessThanOrEqual(cap);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-615.7 — the real-traffic replay, through the STE-601 helper.
//
// The helper gains a `--pr-only` mode: the PR legs alone, with no base-resolver
// archive and no commit classification, so the pass over a multi-gigabyte corpus
// is one read rather than two classifications per command.
//
// THE SECTION IT MUST PRINT (the counts AC.7 names, one per line):
//
//   ## AC-STE-615.7 (PR creation over the corpus)
//   anchored regex PR-creating: <n>
//   resolver PR-creating: <n>
//   newly recognised as PR creation: <n>
//   no longer recognised as PR creation: <n>
//   known-foreign targets: <n>
//   unresolved targets: <n>
//
// followed by the two difference lists, so every command in the difference can
// be hand-classified as real creation or a mention.
// ---------------------------------------------------------------------------

const HELPER = join(PLUGIN_ROOT, "tests", "_command_traffic_replay.ts");

function runReplay(configDir: string, extra: string[] = []): string {
  const p = spawnSync(process.execPath, ["run", HELPER, "--pr-only", ...extra], {
    env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
    encoding: "utf8",
    timeout: 240_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  return (p.stdout ?? "") + (p.stderr ?? "");
}

function corpus(commands: string[]): string {
  const cfg = mkdtempSync(join(tmpdir(), "ste615-replay-"));
  mkdirSync(join(cfg, "projects", "p"), { recursive: true });
  const lines = commands.map((command) =>
    JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "tool_use", name: "Bash", input: { command } }] },
    }),
  );
  writeFileSync(join(cfg, "projects", "p", "s.jsonl"), lines.join("\n") + "\n");
  return cfg;
}

describe("AC-STE-615.7 — the replay helper counts PR creation over the corpus", () => {
  test("it prints every count the AC names, and both difference lists", () => {
    const cfg = corpus([
      "gh pr create --title x --body y",
      "cd /tmp/be && gh pr create",
      "gh pr create --help",
      "gh pr list",
      "echo 'gh pr create' >> notes.md",
      "gh -R org/be pr create",
    ]);
    try {
      const out = runReplay(cfg);
      // The two commands that START with the retired anchored prefix.
      expect(out).toContain("anchored regex PR-creating: 2");
      expect(out).toMatch(/resolver PR-creating: [1-9]\d*/);
      expect(out).toMatch(/known-foreign targets: \d+/);
      expect(out).toMatch(/unresolved targets: \d+/);
      // The difference, in both directions, listed rather than merely counted.
      expect(out).toContain("cd /tmp/be && gh pr create");
      expect(out).toMatch(/no longer recognised as PR creation \(\d+\)/);
      expect(out).toContain("gh pr create --help");
    } finally {
      rmSync(cfg, { recursive: true, force: true });
    }
  }, 300_000);

  test("an empty corpus is reported as \"corpus empty, not measured\", never as a measured zero", () => {
    // WHAT THIS ASSERTS, AND WHY IT IS NOT A `false positives: 0` PIN. The
    // helper prints no false-positive verdict in any mode, and cannot: a false
    // positive is a HAND-classification of the difference list, which AC.7
    // records in the FR. An `expect(out).not.toMatch(/false positives: 0/)`
    // here therefore held for every corpus in both trees — a clause with no
    // way to go red. What the helper CAN get wrong is the thing the AC names:
    // answering a corpus it never read with zeroes, which reads as a clean run
    // and is indistinguishable from a measured one.
    //
    // So the subject is AC.7's six counts. On an empty corpus not one of them
    // may be printed — the early return is the whole behaviour — and the
    // POSITIVE CONTROL below runs the same matcher against a real run whose
    // counts are genuinely zero, so the miss is absence and not blindness.
    const ZEROED =
      /^(anchored regex PR-creating|resolver PR-creating|newly recognised as PR creation|no longer recognised as PR creation|known-foreign targets|unresolved targets): 0$/m;

    const cfg = mkdtempSync(join(tmpdir(), "ste615-replay-empty-"));
    try {
      mkdirSync(join(cfg, "projects"), { recursive: true });
      const out = runReplay(cfg);
      expect(out).toContain("corpus empty, not measured");
      expect(out).not.toMatch(ZEROED);
    } finally {
      rmSync(cfg, { recursive: true, force: true });
    }

    // POSITIVE CONTROL — a NON-empty corpus holding no PR creation at all.
    // Every count is legitimately zero here, and the helper prints them, so
    // ZEROED fires. Without this, a future rename of the count lines would
    // make the clause above pass by matching nothing.
    const real = corpus(["gh pr list", "echo hi"]);
    try {
      const out = runReplay(real);
      expect(out).toContain("distinct commands: 2");
      expect(out).toMatch(ZEROED);
      expect(out).not.toContain("corpus empty, not measured");
    } finally {
      rmSync(real, { recursive: true, force: true });
    }
  }, 300_000);
});

describe("AC-STE-615.7 — the FR records the numbers the replay measured", () => {
  /**
   * The FR is reached through the SHARED active-then-archive resolver, never by
   * a rooted `specs/frs/STE-615.md` path. This milestone archives its own FR at
   * the ship commit, and a hardcoded active-tree path goes ENOENT exactly there
   * — the one transition no gate run precedes, and the class
   * `tests/m137-archive-blind-spot-class.test.ts` exists to close.
   */
  const frBody = (): string => readSpecFile(REPO_ROOT, "specs/frs", "STE-615.md").body;

  /**
   * The record is read from the FR rather than re-measured here on purpose. The
   * real corpus is a multi-gigabyte store outside this repository; a collected
   * test that walked it would add minutes to every `bun test` and would still
   * measure a different corpus on every machine. What is falsifiable — and what
   * AC.7 actually asks for — is that the numbers were taken and written down,
   * and that an empty corpus is recorded as NOT MEASURED rather than as a clean
   * run. Re-measure with:
   *
   *   bun run plugins/dev-process-toolkit/tests/_command_traffic_replay.ts --pr-only
   */
  const KEYS = [
    "anchored regex PR-creating",
    "resolver PR-creating",
    "newly recognised as PR creation",
    "no longer recognised as PR creation",
    "known-foreign targets",
    "unresolved targets",
  ];

  test("every count AC.7 names is recorded, as a number or as `not measured`", () => {
    const body = frBody();
    const missing = KEYS.filter(
      (k) => !new RegExp(`${k}:\\s*(\\d[\\d,]*|not measured)`).test(body),
    );
    expect(missing).toEqual([]);
  });

  test("the false-positive verdict is recorded", () => {
    const body = frBody();
    expect(body).toMatch(/false positives:\s*(0|not measured|[1-9])/);
  });
});

// ─── AC-STE-615.8 — the falsifiability RECORD ────────────────────────────────
//
// AC.8 claims a direction for every clause asserting new behaviour. Until this
// block, NOTHING graded it: `grep -rn 'AC-STE-615.8' tests/` returned zero hits
// while the suite stood at 15,484 pass / 0 fail, so the AC was green by being
// unmeasured. That is the exact failure mode AC.8 exists to prevent, reproduced
// on AC.8 itself.
//
// This grades the RECORD, the way the AC.7 block above grades the replay's. The
// measurement AC.8 asks for is a throwaway worktree detached at the pre-change
// base with the suite files copied in and every source left at base bytes — a
// run no collected test can afford to repeat on every `bun test`. What IS
// falsifiable here is that the run happened and was written down: per clause,
// against a FIXED sha, with the exemption stated. A section holding a heading
// and a promise must go red, and the negative control below proves it does.
//
// THE SHAPE IS STE-614's, deliberately. `specs/frs/STE-614.md` § Falsifiability
// is this repository's settled record idiom, and the positive control at the
// end runs every shape predicate against it. A bar that no shipped record
// clears is a bar this suite invented rather than one it enforces.

/** The body of the `## <name>` section, up to the next `## ` heading. */
function sectionOf(body: string, name: string): string {
  const lines = body.split("\n");
  const heading = new RegExp(`^##\\s+${name}\\s*$`);
  const start = lines.findIndex((l) => heading.test(l));
  if (start === -1) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^##\s/.test(l));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

interface DirectionRow {
  label: string;
  cells: string[];
}

interface DirectionTable {
  columns: string[];
  rows: DirectionRow[];
}

function cellsOf(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

function isSeparatorRow(line: string): boolean {
  return /^\s*\|(\s*:?-{2,}:?\s*\|)+\s*$/.test(line);
}

/**
 * The first markdown table in the section that carries a FALSIFY column.
 *
 * A falsifiability section may hold several tables — STE-614's holds the
 * direction table and the replay table — so the column header, not the
 * position, is what selects the subject.
 */
function directionTable(section: string): DirectionTable | null {
  const lines = section.split("\n");
  for (let i = 0; i + 1 < lines.length; i++) {
    if (!lines[i].trim().startsWith("|") || !isSeparatorRow(lines[i + 1])) continue;
    const columns = cellsOf(lines[i]);
    if (!columns.some((c) => /falsif/i.test(c))) continue;
    const rows: DirectionRow[] = [];
    for (let j = i + 2; j < lines.length && lines[j].trim().startsWith("|"); j++) {
      const cells = cellsOf(lines[j]);
      rows.push({ label: cells[0] ?? "", cells });
    }
    return { columns, rows };
  }
  return null;
}

function columnIndex(table: DirectionTable, re: RegExp): number {
  return table.columns.findIndex((c) => re.test(c));
}

/** The row for `AC.<n>` / `AC-STE-615.<n>`, whatever decoration it carries. */
function rowFor(table: DirectionTable, n: number): DirectionRow | undefined {
  const re = new RegExp(`\\bAC[.\\-](?:STE-615\\.)?${n}\\b`);
  return table.rows.find((r) => re.test(r.label.replace(/[*`_]/g, "")));
}

/** The first integer in a cell, ignoring markdown decoration and `(+1)` tails. */
function numberIn(cell: string | undefined): number | null {
  if (cell === undefined) return null;
  const m = cell.replace(/[*`_]/g, "").replace(/,/g, "").match(/\d+/);
  return m ? Number(m[0]) : null;
}

/** How many of that AC's clauses are recorded as red-on-base → green-post. */
function falsifyCount(table: DirectionTable, n: number): number | null {
  const row = rowFor(table, n);
  if (!row) return null;
  const idx = columnIndex(table, /falsif/i);
  if (idx < 0) return null;
  return numberIn(row.cells[idx]);
}

/** Hex strings long enough to be a commit — the fixed-base candidates. */
function shasIn(section: string): string[] {
  return [...section.matchAll(/\b([0-9a-f]{7,40})\b/g)].map((m) => m[1]);
}

/** Does the section state the exemption AC.8's last sentence carves out? */
function statesExemption(section: string): boolean {
  return (
    /\bcontrols?\b/i.test(section) &&
    /byte[-\s]identi/i.test(section) &&
    /\bexempt/i.test(section)
  );
}

/** The base sha the HS-2 gate suite pins, read from its source. */
function pinnedBase(): string {
  const src = readFileSync(join(import.meta.dir, "ste-615-pr-gate.test.ts"), "utf-8");
  const m = src.match(/const BASE = "([0-9a-f]{7,40})"/);
  if (!m) throw new Error("tests/ste-615-pr-gate.test.ts no longer pins a BASE sha");
  return m[1];
}

/**
 * A section that is a heading and a PROMISE — AC.8's own sentence, restated.
 * Every clause in this block must be unsatisfied by it, which is what makes the
 * clauses grade a measurement rather than an intention.
 */
const PROMISE_ONLY = [
  "# The pull-request gate finds the repository a request is opened from",
  "",
  "## Falsifiability",
  "",
  "Every clause asserting new behaviour fails on the pre-change bytes and passes",
  "on the post-change bytes. Controls and byte-identity pins are exempt by",
  "construction.",
  "",
  "## Notes",
  "",
  "- Nothing to see here.",
].join("\n");

describe("AC-STE-615.8 — the FR records the direction of every new-behaviour clause", () => {
  const frBody = (): string => readSpecFile(REPO_ROOT, "specs/frs", "STE-615.md").body;
  const section = (): string => sectionOf(frBody(), "Falsifiability");

  test("the FR carries a `## Falsifiability` section with a body", () => {
    const s = section();
    expect(s.trim()).not.toBe("");
    expect(s.split("\n").filter((l) => l.trim() !== "").length).toBeGreaterThan(1);
  });

  test("it names the pre-change base as a FIXED sha, the same one the gate suite pins", () => {
    // The join: two records of one base. If the gate suite ever re-pins, this
    // goes red rather than letting the FR's prose drift away from what ran.
    expect(pinnedBase()).toBe(BASE);
    const named = shasIn(section()).filter((s) => BASE.startsWith(s));
    expect(named.length).toBeGreaterThan(0);
  });

  test("the named base is a real commit in this repository's history", () => {
    const named = shasIn(section()).filter((s) => BASE.startsWith(s));
    expect(named.length).toBeGreaterThan(0);
    const p = spawnSync("git", ["merge-base", "--is-ancestor", named[0], "HEAD"], {
      cwd: REPO_ROOT,
      encoding: "utf-8",
    });
    expect({ sha: named[0], status: p.status }).toEqual({ sha: named[0], status: 0 });
  });

  test("the direction is recorded in a table with a clause count and a falsify column", () => {
    const table = directionTable(section());
    expect(table).not.toBeNull();
    const t = table as DirectionTable;
    expect(columnIndex(t, /falsif/i)).toBeGreaterThanOrEqual(0);
    expect(columnIndex(t, /clause/i)).toBeGreaterThanOrEqual(0);
    expect(t.rows.length).toBeGreaterThan(0);
  });

  // AC.8 names AC.1 to AC.4 one by one, so they are graded one by one. A single
  // blanket row covering "AC.1-AC.4" would leave three ACs unaccounted for, and
  // an AC nobody accounted for is how AC.8 itself went unmeasured.
  for (const n of [1, 2, 3, 4]) {
    test(`AC.${n}'s clauses carry a recorded direction, with at least one red on the base`, () => {
      const table = directionTable(section());
      expect(table).not.toBeNull();
      const t = table as DirectionTable;
      expect(rowFor(t, n)?.label ?? "(no row)").toMatch(/AC/);
      const falsify = falsifyCount(t, n);
      expect({ ac: n, falsify }).toEqual({ ac: n, falsify: expect.any(Number) });
      expect(falsify as number).toBeGreaterThan(0);
    });
  }

  test("AC.5's receipt siblings are recorded by name, not folded into its unedited cases", () => {
    // AC.5 is mostly a PRESERVATION AC — `gh pr list`, `git push`, empty and
    // malformed stdin, all unedited and green in both trees. Only the receipt
    // siblings assert new behaviour, and only they are in AC.8's list, so the
    // record has to distinguish them.
    const s = section();
    const table = directionTable(s);
    expect(table).not.toBeNull();
    const t = table as DirectionTable;
    const row = rowFor(t, 5);
    expect(row?.label ?? "(no AC.5 row)").toMatch(/AC/);
    const falsify = falsifyCount(t, 5);
    expect(falsify as number).toBeGreaterThan(0);
    expect(`${row?.label ?? ""}\n${s}`).toMatch(/receipt sibling|sibling.*receipt|receipt.*sibling/i);
  });

  test("the exemption for controls and byte-identity pins is stated", () => {
    expect(statesExemption(section())).toBe(true);
  });
});

describe("AC-STE-615.8 — CONTROL: a heading plus a promise is not a record", () => {
  // Without these, every clause above could be satisfied by pasting AC.8's own
  // sentence under a heading — which is the shape this block exists to refuse.
  const s = sectionOf(PROMISE_ONLY, "Falsifiability");

  test("the extractor DOES find the promise section — the refusal is about content", () => {
    expect(s).toMatch(/Every clause asserting new behaviour/);
  });

  test("the promise carries no per-clause direction table", () => {
    expect(directionTable(s)).toBeNull();
  });

  test("the promise names no fixed base", () => {
    expect(shasIn(s).filter((x) => BASE.startsWith(x))).toEqual([]);
  });

  test("the exemption sentence ALONE passes its own clause — so it cannot be the load-bearing one", () => {
    // Stated plainly rather than hidden: the exemption clause is satisfiable by
    // a promise. The direction table is what separates a record from a wish.
    expect(statesExemption(s)).toBe(true);
  });
});

describe("AC-STE-615.8 — CONTROL: STE-614's shipped record clears this bar", () => {
  // The positive control. STE-614 § Falsifiability was measured and written
  // before this suite existed; if it failed these predicates, the predicates
  // would be describing a record shape nobody uses.
  const s = (): string =>
    sectionOf(readSpecFile(REPO_ROOT, "specs/frs", "STE-614.md").body, "Falsifiability");

  test("it has a direction table, a named base sha and the exemption", () => {
    const section = s();
    expect(section.trim()).not.toBe("");
    expect(directionTable(section)).not.toBeNull();
    expect(shasIn(section).length).toBeGreaterThan(0);
    expect(statesExemption(section)).toBe(true);
  });

  test("its AC.1 to AC.4 rows each record a falsify count", () => {
    const table = directionTable(s());
    expect(table).not.toBeNull();
    const t = table as DirectionTable;
    const counts = [1, 2, 3, 4].map((n) => falsifyCount(t, n));
    expect(counts.every((c) => typeof c === "number" && c > 0)).toBe(true);
  });
});
