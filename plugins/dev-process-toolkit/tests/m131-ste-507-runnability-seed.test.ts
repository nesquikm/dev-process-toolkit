// M131 STE-507 — `/setup` and `/upgrade` seed the runnability contract.
//
// Two surfaces, five ACs:
//
//   AC.1/AC.2 — `/setup` prose (`skills/setup/SKILL.md` § 8c, and the full
//               procedure it defers to in `docs/setup-reference.md` § Step 8c).
//   AC.3/AC.4/AC.5 — the `/upgrade` migration-registry entry
//               `verification-run-keys`.
//
// THE HAZARD THIS FILE EXISTS TO CATCH.
//
//   `renderVerificationSection` (adapters/_shared/src/verification_config.ts)
//   UNCONDITIONALLY emits a `verify_mode:` line, defaulting to `advisory`. A
//   migration that healed the block by round-tripping it through that renderer
//   would silently stamp `verify_mode: advisory` onto every existing project
//   whose block omitted the key — permanently defeating the run_cmd-keyed
//   `blocking` default STE-505 ships, on exactly the projects this migration
//   touches. So the entry MUST SPLICE, never re-render, and the legs below
//   assert the absence of a `verify_mode:` line plus the downstream behaviour
//   that absence buys (`resolveVerifyMode` promoting to `blocking` once the
//   operator fills a real command in).
//
// TEST STRATEGY.
//
//   * POLARITY BOTH WAYS, per the registry contract's authoring checklist.
//     The entry must fire on a not-runnable block missing `run_cmd`, and stay
//     quiet on: a runnable project (detection fired — probe #80 owns it, and a
//     migration must not invent a command it cannot verify), a block already
//     carrying `run_cmd` (any value, `none` included), and a CLAUDE.md with no
//     `## Verification` section at all.
//   * BYTES, NOT PREDICATES. The no-op legs assert the file is BYTE-IDENTICAL,
//     not merely that `applies` is false. The fire leg asserts the result is
//     the original file with EXACTLY ONE line inserted — which is the only
//     formulation that proves the operator's comments, blank lines, key order
//     and surrounding prose survived.
//   * DETECT MUTATES NOTHING. A full recursive snapshot of the fixture is
//     compared before and after `detect`, because `/upgrade` step 3 runs the
//     detector walk BEFORE any approval has been asked for.
//   * REACHABLE THROUGH THE REGISTRY. The behavioural legs resolve the entry
//     out of `MIGRATIONS` by id and drive it through a walk that mirrors
//     `/upgrade` step 3, rather than importing the module directly — an entry
//     that works but is not registered is not shipped.
//
// House constraints honoured: no assertion demands an `STE-\d+` / `AC-STE-\d+`
// token in `skills/**` (that ceiling is at 246/246, zero headroom), and every
// `skills/setup/SKILL.md` pin below is satisfiable by extending existing lines
// in place — that file sits at 357 of its hard 358-line cap.

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { MIGRATIONS, validateRegistry, type DetectResult, type MigrationEntry } from "../adapters/_shared/src/migrations/index";
import { readVerificationConfig, resolveVerifyMode } from "../adapters/_shared/src/verification_config";

const ENTRY_ID = "verification-run-keys";
const INTRODUCED_IN = "2.70.0";
const PREDECESSOR_ID = "mode-none-sequential-milestone";

const pluginRoot = join(import.meta.dir, "..");
const repoRoot = join(pluginRoot, "..", "..");

const readPlugin = (...parts: string[]): string => readFileSync(join(pluginRoot, ...parts), "utf8");

/** The live entry, resolved out of the registry — never by direct import. */
function liveEntry(): MigrationEntry {
  const entry = MIGRATIONS.find((e) => e.id === ENTRY_ID);
  if (entry === undefined) {
    throw new Error(
      `MIGRATIONS carries no entry with id "${ENTRY_ID}" — the migration is unreachable from /upgrade, which walks this list and owns no list of its own`,
    );
  }
  return entry;
}

/**
 * `/upgrade` step 3's detector walk, in miniature: every registry entry's
 * `detect` against one tree, keeping the ones that fired. This is the surface
 * the operator's preview table is rendered from, so an entry that only works
 * when imported by hand has not shipped.
 */
function previewDetectedSet(projectRoot: string): Array<{ id: string; evidence: string[] }> {
  const rows: Array<{ id: string; evidence: string[] }> = [];
  for (const entry of MIGRATIONS) {
    const result: DetectResult = entry.detect(projectRoot);
    if (result.applies) rows.push({ id: entry.id, evidence: result.evidence });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const roots: string[] = [];
const mkRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), "m131-ste-507-"));
  roots.push(root);
  return root;
};
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/**
 * A CLAUDE.md whose `## Verification` block carries the operator's own bytes:
 * an HTML comment, a blank line, one declared key, and prose AFTER the keys
 * but still inside the section. Every one of those is a thing a re-render
 * would eat.
 *
 * NO heading in this document is one of `detect_runnability`'s closed run
 * phrases (`Running` / `Getting Started` / `Development`) — the fixture must be
 * genuinely not-runnable for the fire legs to mean anything.
 */
const NOT_RUNNABLE_CLAUDE_MD = [
  "# Demo Project",
  "",
  "## Overview",
  "",
  "A small library. It is not an application.",
  "",
  "## Verification",
  "",
  "<!-- operator note: keep this block hand-maintained -->",
  "verify_skill: demo-drive",
  "",
  "The drive skill above is inert until its TODOs are filled in.",
  "",
  "## Notes",
  "",
  "Nothing else to say.",
  "",
].join("\n");

/** Write `body` as the project's CLAUDE.md and return its absolute path. */
function writeClaudeMd(root: string, body: string): string {
  const path = join(root, "CLAUDE.md");
  writeFileSync(path, body, "utf-8");
  return path;
}

/** A not-runnable project whose block exists but declares no `run_cmd`. */
function notRunnableFixture(body: string = NOT_RUNNABLE_CLAUDE_MD): { root: string; claudeMd: string } {
  const root = mkRoot();
  return { root, claudeMd: writeClaudeMd(root, body) };
}

/**
 * A runnable project — `package.json` declares an exact `dev` script, one of
 * `detect_runnability`'s four closed sources — whose block declares no
 * `run_cmd`. Probe #80 fails this tree by design; the migration must not.
 */
function runnableFixture(): { root: string; claudeMd: string } {
  const root = mkRoot();
  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify({ name: "demo", scripts: { dev: "bun run server.ts" } }, null, 2)}\n`,
    "utf-8",
  );
  return { root, claudeMd: writeClaudeMd(root, NOT_RUNNABLE_CLAUDE_MD) };
}

/** Every file under `root`, relpath → bytes. The mutation-freedom yardstick. */
function snapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile()) out[relative(root, abs)] = readFileSync(abs, "utf-8");
    }
  };
  walk(root);
  return out;
}

/** The lines `after` gained relative to `before`, given nothing was removed. */
function addedLines(before: string, after: string, eol = "\n"): string[] {
  const beforeLines = before.split(eol);
  const afterLines = after.split(eol);
  const remaining = [...afterLines];
  for (const line of beforeLines) {
    const at = remaining.indexOf(line);
    if (at === -1) {
      throw new Error(`line disappeared from the migrated file: ${JSON.stringify(line)}`);
    }
    remaining.splice(at, 1);
  }
  return remaining;
}

// ===========================================================================
// AC-STE-507.3 — the registry carries the entry
// ===========================================================================

describe("AC-STE-507.3 — /upgrade carries a migration-registry entry", () => {
  test(`MIGRATIONS carries an entry with id "${ENTRY_ID}"`, () => {
    expect(MIGRATIONS.map((e) => e.id)).toContain(ENTRY_ID);
  });

  test(`introduced_in is the SHIPPING release ${INTRODUCED_IN} — what probe #68 and assertMigrationDeclared both require`, () => {
    expect(liveEntry().introduced_in).toBe(INTRODUCED_IN);
  });

  test("it is APPENDED — last in the version-ordered list, after the 2.59.0 entry", () => {
    const ids = MIGRATIONS.map((e) => e.id);
    expect(ids[ids.length - 1]).toBe(ENTRY_ID);
    expect(ids.indexOf(ENTRY_ID)).toBeGreaterThan(ids.indexOf(PREDECESSOR_ID));
  });

  test("kind is `script`, and `apply` is present exactly BECAUSE of that", () => {
    const entry = liveEntry();
    expect(entry.kind).toBe("script");
    expect(typeof entry.apply).toBe("function");
  });

  test("the whole registry still satisfies validateRegistry (unique ids, ascending versions)", () => {
    expect(() => validateRegistry(MIGRATIONS)).not.toThrow();
    for (const entry of MIGRATIONS) {
      expect(typeof entry.apply === "function").toBe(entry.kind === "script");
    }
  });

  test("the ascending-version invariant is REAL — the entry inserted before its 2.59.0 predecessor throws", () => {
    const entry = liveEntry();
    const predecessor = MIGRATIONS.find((e) => e.id === PREDECESSOR_ID)!;
    expect(() => validateRegistry([entry, predecessor])).toThrow(/ascending/i);
  });

  test("the M131 plan's `migration:` declaration binds to this exact id", () => {
    const candidates = [
      join(repoRoot, "specs", "plan", "M131.md"),
      join(repoRoot, "specs", "plan", "archive", "M131.md"),
    ];
    const planPath = candidates.find((p) => existsSync(p));
    expect(planPath).toBeDefined();
    const declared = /^migration:\s*(\S+)\s*$/m.exec(readFileSync(planPath!, "utf8"));
    expect(declared?.[1]).toBe(ENTRY_ID);
  });
});

// ===========================================================================
// AC-STE-507.3 — the entry adds the key to an existing block, BY SPLICING
// ===========================================================================

describe("AC-STE-507.3 — a not-runnable project's existing block gains `run_cmd: none`", () => {
  test("detect fires, and apply reports CLAUDE.md as the one changed path", () => {
    const { root } = notRunnableFixture();
    const entry = liveEntry();

    expect(entry.detect(root).applies).toBe(true);

    const result = entry.apply!(root);
    expect(result.changed).toEqual(["CLAUDE.md"]);
    expect(result.summary.length).toBeGreaterThan(0);
  });

  test("the block gains `run_cmd: none` — a knowable answer, written without a follow-up edit", () => {
    const { root, claudeMd } = notRunnableFixture();
    liveEntry().apply!(root);

    const after = readFileSync(claudeMd, "utf8");
    expect(after).toMatch(/^run_cmd: none$/m);
    expect(readVerificationConfig(claudeMd).runCmd).toBe("none");
    expect(readVerificationConfig(claudeMd).verifySkill).toBe("demo-drive");
  });

  // THE KEYSTONE. `renderVerificationSection` always emits `verify_mode:`; a
  // re-render would stamp `advisory` onto a block that never declared it.
  test("NO `verify_mode:` line is introduced — the entry splices, it does not re-render", () => {
    const { root, claudeMd } = notRunnableFixture();
    expect(readFileSync(claudeMd, "utf8")).not.toMatch(/^verify_mode:/m);

    liveEntry().apply!(root);

    expect(readFileSync(claudeMd, "utf8")).not.toMatch(/^verify_mode:/m);
  });

  // The behavioural consequence of the keystone, asserted downstream: with no
  // stamped `verify_mode`, an operator who later fills a real command in gets
  // the run_cmd-keyed `blocking` default. A stamped `advisory` would pin them
  // to advisory forever, silently.
  test("a migrated project that LATER declares a real run command resolves to `blocking`", () => {
    const { root, claudeMd } = notRunnableFixture();
    liveEntry().apply!(root);

    const migrated = readFileSync(claudeMd, "utf8");
    writeFileSync(claudeMd, migrated.replace(/^run_cmd: none$/m, "run_cmd: bun run dev"), "utf-8");

    expect(resolveVerifyMode(claudeMd)).toBe("blocking");
  });

  test("no `e2e_cmd` line is added — nothing detects an end-to-end command, so `none` would be a guess", () => {
    const { root, claudeMd } = notRunnableFixture();
    liveEntry().apply!(root);

    expect(readFileSync(claudeMd, "utf8")).not.toMatch(/^e2e_cmd:/m);
    expect(readVerificationConfig(claudeMd).e2eCmd).toBeNull();
  });

  test("the operator's own bytes survive — exactly ONE line is added and nothing else moves", () => {
    const { root, claudeMd } = notRunnableFixture();
    const before = readFileSync(claudeMd, "utf8");

    liveEntry().apply!(root);
    const after = readFileSync(claudeMd, "utf8");

    // Every original line still present, in order, plus exactly one new one.
    expect(addedLines(before, after)).toEqual(["run_cmd: none"]);
    expect(after.split("\n").filter((l) => l !== "run_cmd: none").join("\n")).toBe(before);
    // Named explicitly, because these are the things a re-render eats.
    expect(after).toContain("<!-- operator note: keep this block hand-maintained -->");
    expect(after).toContain("The drive skill above is inert until its TODOs are filled in.");
    expect(after).toContain("## Notes");
  });

  test("the spliced line lands INSIDE the section, in canonical key order after `verify_skill`", () => {
    const { root, claudeMd } = notRunnableFixture();
    liveEntry().apply!(root);

    const lines = readFileSync(claudeMd, "utf8").split("\n");
    const heading = lines.indexOf("## Verification");
    const verifySkill = lines.indexOf("verify_skill: demo-drive");
    const runCmd = lines.indexOf("run_cmd: none");
    const nextHeading = lines.findIndex((l, i) => i > heading && /^#{1,4} /.test(l));

    expect(runCmd).toBeGreaterThan(verifySkill);
    expect(runCmd).toBeLessThan(nextHeading);
  });

  test("a CRLF-authored CLAUDE.md keeps its CRLF line endings", () => {
    const crlf = NOT_RUNNABLE_CLAUDE_MD.replace(/\n/g, "\r\n");
    const { root, claudeMd } = notRunnableFixture(crlf);

    liveEntry().apply!(root);
    const after = readFileSync(claudeMd, "utf8");

    expect(after).toContain("run_cmd: none");
    // No lone LF crept in — every newline is part of a CRLF pair.
    expect(after.replace(/\r\n/g, "")).not.toContain("\n");
    expect(addedLines(crlf, after, "\r\n")).toEqual(["run_cmd: none"]);
  });
});

// ===========================================================================
// AC-STE-507.3 — polarity: the entry stays quiet where it cannot know
// ===========================================================================

describe("AC-STE-507.3 — the entry declines the projects it cannot answer for", () => {
  test("a RUNNABLE project is left alone — a migration must not invent a run command", () => {
    const { root, claudeMd } = runnableFixture();
    const entry = liveEntry();
    const before = readFileSync(claudeMd, "utf8");

    expect(entry.detect(root).applies).toBe(false);

    entry.apply!(root);
    expect(readFileSync(claudeMd, "utf8")).toBe(before);
  });

  // The quiet half must be DELIBERATE, not a miss: the entry says in its own
  // module which surface owns the case it declines, and why writing there
  // would be a guess.
  test("the module documents WHY it defers on a runnable project, naming the probe that owns it", () => {
    const path = join(pluginRoot, "adapters", "_shared", "src", "migrations", "entries", "verification_run_keys.ts");
    expect(existsSync(path)).toBe(true);
    const source = readFileSync(path, "utf8");
    expect(source).toContain("runnability_declared");
    expect(source).toMatch(/never invent|not invent|cannot verify|would be a guess|guessing/i);
  });

  test("a CLAUDE.md with NO `## Verification` section is not a target — the entry adds no block", () => {
    const root = mkRoot();
    const claudeMd = writeClaudeMd(root, "# Demo Project\n\n## Overview\n\nNo verification block here.\n");
    const before = readFileSync(claudeMd, "utf8");
    const entry = liveEntry();

    expect(entry.detect(root).applies).toBe(false);
    entry.apply!(root);
    expect(readFileSync(claudeMd, "utf8")).toBe(before);
  });

  test("a project with no CLAUDE.md at all is not a target, and never a throw", () => {
    const root = mkRoot();
    const entry = liveEntry();
    expect(() => entry.detect(root)).not.toThrow();
    expect(entry.detect(root).applies).toBe(false);
  });
});

// ===========================================================================
// AC-STE-507.4 — preview every change, apply nothing without approval
// ===========================================================================

describe("AC-STE-507.4 — the migration previews every change and applies nothing without approval", () => {
  test("detect MUTATES NOTHING — the tree is byte-identical after the detector walk", () => {
    const { root } = notRunnableFixture();
    const before = snapshot(root);

    liveEntry().detect(root);
    previewDetectedSet(root);

    expect(snapshot(root)).toEqual(before);
  });

  test("detect is deterministic — two calls over the same tree agree exactly", () => {
    const { root } = notRunnableFixture();
    const entry = liveEntry();
    expect(entry.detect(root)).toEqual(entry.detect(root));
  });

  test("one evidence row per change, naming the file AND the exact line to be spliced", () => {
    const { root } = notRunnableFixture();
    const entry = liveEntry();

    const { evidence } = entry.detect(root);
    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toContain("CLAUDE.md");
    expect(evidence[0]).toContain("run_cmd: none");
  });

  // detect and apply share one helper computing what would change, so "did
  // this fire?" and "what gets spliced?" cannot disagree. Asserted where it is
  // observable: the previewed line is the line that lands.
  test("the previewed line is the line that lands", () => {
    const { root, claudeMd } = notRunnableFixture();
    const entry = liveEntry();

    const before = readFileSync(claudeMd, "utf8");
    const previewed = entry.detect(root).evidence.join("\n");

    entry.apply!(root);
    const added = addedLines(before, readFileSync(claudeMd, "utf8"));

    expect(added.length).toBeGreaterThan(0);
    for (const line of added) expect(previewed).toContain(line.trim());
  });

  test("the entry is reachable through the registry's own preview walk, not only by direct import", () => {
    const { root } = notRunnableFixture();

    const rows = previewDetectedSet(root);
    const row = rows.find((r) => r.id === ENTRY_ID);
    expect(row).toBeDefined();
    expect(row!.evidence).toEqual(liveEntry().detect(root).evidence);
  });
});

// ===========================================================================
// AC-STE-507.5 — a project already carrying the keys is a no-op
// ===========================================================================

describe("AC-STE-507.5 — a project already carrying the keys is a no-op", () => {
  const withRunCmd = (value: string): string =>
    NOT_RUNNABLE_CLAUDE_MD.replace("verify_skill: demo-drive", `verify_skill: demo-drive\nrun_cmd: ${value}`);

  for (const value of ["none", "bun run dev"]) {
    test(`a block already declaring \`run_cmd: ${value}\` does not apply, and its bytes are IDENTICAL`, () => {
      const { root, claudeMd } = notRunnableFixture(withRunCmd(value));
      const before = readFileSync(claudeMd, "utf8");
      const entry = liveEntry();

      expect(entry.detect(root).applies).toBe(false);

      entry.apply!(root);
      expect(readFileSync(claudeMd, "utf8")).toBe(before);
    });
  }

  test("re-applying is a no-op — detect-after-apply is false and the second apply changes nothing", () => {
    const { root, claudeMd } = notRunnableFixture();
    const entry = liveEntry();

    entry.apply!(root);
    const afterFirst = readFileSync(claudeMd, "utf8");

    // The registry's idempotency invariant, and /upgrade step 6's check: an
    // entry that still detects after applying is a bug in the entry.
    expect(entry.detect(root).applies).toBe(false);
    expect(previewDetectedSet(root).map((r) => r.id)).not.toContain(ENTRY_ID);

    const second = entry.apply!(root);
    expect(second.changed).toEqual([]);
    expect(readFileSync(claudeMd, "utf8")).toBe(afterFirst);
  });
});

// ===========================================================================
// AC-STE-507.1 / AC-STE-507.2 — the `/setup` prose
// ===========================================================================

/**
 * Split a region into the smallest units a claim can honestly live in: table
 * rows, list items (bullet + continuation), and prose sentences. A claim
 * assembled from two unrelated statements is not a claim.
 *
 * Same idiom as tests/m131-ste-503-key-set-prose.test.ts, deliberately.
 */
function statements(region: string): string[] {
  const out: string[] = [];
  let prose: string[] = [];
  let bullet: string[] | null = null;

  const flushBullet = () => {
    if (!bullet) return;
    const text = bullet.join(" ").replace(/\s+/g, " ").trim();
    if (text) out.push(text);
    bullet = null;
  };
  const flushProse = () => {
    const text = prose.join(" ").replace(/\s+/g, " ").trim();
    prose = [];
    if (!text) return;
    for (const sentence of text.split(/(?<=[.!?])\s+/)) {
      const trimmed = sentence.trim();
      if (trimmed) out.push(trimmed);
    }
  };

  for (const raw of region.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("|")) {
      flushBullet();
      flushProse();
      out.push(line);
      continue;
    }
    if (/^([-*]|\d+\.)\s/.test(line)) {
      flushProse();
      flushBullet();
      bullet = [line];
      continue;
    }
    if (bullet) {
      if (line === "") flushBullet();
      else bullet.push(line);
      continue;
    }
    if (line === "") flushProse();
    else prose.push(line);
  }
  flushBullet();
  flushProse();
  return out;
}

/** Slice a markdown section by a predicate on its heading, to the next heading of the same-or-higher level. */
function section(body: string, headingRe: RegExp, level: RegExp): string {
  const lines = body.split("\n");
  const start = lines.findIndex((l) => headingRe.test(l));
  if (start === -1) return "";
  const end = lines.findIndex((l, i) => i > start && level.test(l));
  return (end === -1 ? lines.slice(start) : lines.slice(start, end)).join("\n");
}

const setupSkill = readPlugin("skills", "setup", "SKILL.md");
const setupReference = readPlugin("docs", "setup-reference.md");
const setup8c = section(setupSkill, /^### 8c\./, /^#{1,3} /);
const reference8c = section(setupReference, /^## Step 8c\b/, /^## /);

/** `run_cmd` mentioned as a key, backticked or bare. */
const RUN_CMD = /\brun_cmd\b/;
/** The `none` ANSWER, spelled as the value it is written as. */
const RUN_CMD_NONE = /`?\brun_cmd:\s*none\b`?/;
/** The not-runnable condition, however the prose phrases it. */
const NOT_RUNNABLE = /not runnable|cannot be run|can(?:'|’)t be run|no run instructions|detection does not fire|not detected|nothing fires/i;
/** The "no path leaves the key absent" claim. */
const NEITHER_PATH = /neither path|both paths|either way|never absent|no path leaves|always writes/i;

describe("AC-STE-507.1 — /setup offers `run_cmd` on the scaffold/adopt step, seeded from the detected stack", () => {
  test("the 8c section exists and names `run_cmd`", () => {
    expect(setup8c.length).toBeGreaterThan(0);
    expect(setup8c).toMatch(RUN_CMD);
  });

  test("ONE statement says the offer rides the existing scaffold/adopt step and is stack-seeded", () => {
    const hits = statements(setup8c).filter(
      (s) => RUN_CMD.test(s) && /scaffold|adopt/i.test(s) && /stack/i.test(s),
    );
    expect(hits.length).toBeGreaterThan(0);
  });

  test("skills/setup/SKILL.md stays within the NFR-1 line cap (358)", () => {
    expect(setupSkill.split("\n").length).toBeLessThanOrEqual(358);
  });

  test("no `STE-`/`AC-STE-` token was introduced into the 8c section (ceiling is at 246/246)", () => {
    expect(setup8c).not.toMatch(/\bAC-STE-\d+|\bSTE-\d+/);
  });
});

describe("AC-STE-507.2 — the quiet half: the not-runnable path writes `run_cmd: none`", () => {
  // The clause STE-507's own Notes names as the one most likely to be dropped.
  // A test that only checks `run_cmd` is MENTIONED passes on a version that
  // silently skips this path, which reads identically to a correct run.
  test("ONE statement pairs the not-runnable condition with writing `run_cmd: none`", () => {
    const hits = statements(setup8c).filter((s) => RUN_CMD_NONE.test(s) && NOT_RUNNABLE.test(s));
    expect(hits.length).toBeGreaterThan(0);
  });

  test("ONE statement makes the NEITHER-PATH-LEAVES-IT-ABSENT claim explicitly", () => {
    const hits = statements(setup8c).filter((s) => RUN_CMD.test(s) && NEITHER_PATH.test(s));
    expect(hits.length).toBeGreaterThan(0);
  });
});

describe("AC-STE-507.1/.2 — the full procedure the skill defers to says the same thing", () => {
  test("docs/setup-reference.md § Step 8c names `run_cmd` and the `none` path", () => {
    expect(reference8c.length).toBeGreaterThan(0);
    expect(reference8c).toMatch(RUN_CMD);
    expect(statements(reference8c).filter((s) => RUN_CMD_NONE.test(s) && NOT_RUNNABLE.test(s)).length).toBeGreaterThan(0);
  });

  test("it no longer claims `verify_skill` is the ONLY write the accept path makes to CLAUDE.md", () => {
    expect(reference8c.replace(/\s+/g, " ")).not.toContain("This is the only write the accept path makes to CLAUDE.md");
  });
});

// ===========================================================================
// SECOND RED PASS (spec-review audit follow-up)
//
// Five legs, all of them closing gaps the first pass left:
//
//   1. The two NARROWINGS live only in the module header and in test names.
//      That is the M129 shape verbatim — a real design decision recorded on a
//      surface nobody reading the spec will open — so the FR body must record
//      both, WITH their reasons.
//   2. The operator-facing seam. A pre-M131 tree where detection FIRES and
//      `run_cmd` is absent gets `Nothing to do.` from `/upgrade` while probe
//      #80 is about to fail it at severity `error`. `skills/upgrade/SKILL.md`
//      currently says nothing about `run_cmd` at all, so "nothing to do" is
//      the last word to an operator whose gate is red.
//   3. The FR's own named fixture — "an existing TWO-KEY block" — was never
//      built. Every fixture above declares `verify_skill` ALONE, so the
//      insert-after-`verify_mode` branch of `splicePosition` is uncovered.
//   4. `requires_explicit_approval` is unpinned on this entry alone; all four
//      siblings pin theirs. NOT setting it is correct (this rewrites a
//      documentation config block, not security config), which is exactly why
//      the falsy value needs a pin — otherwise a later hand moves the entry
//      out of the batch approval and no test notices.
//   5. Mixed-EOL idempotency hazard: `splitLines` picks `\r\n` whenever the
//      file contains one, so an LF-terminated `run_cmd` line hides inside a
//      CRLF chunk that `SECTION_KEY_RE` (unanchored, no `m` flag) cannot see.
// ===========================================================================

const upgradeSkill = readPlugin("skills", "upgrade", "SKILL.md");

/** STE-507's body, wherever archival has left it. Same fallback idiom as the M131 plan lookup above. */
function frBody(): string {
  const candidates = [
    join(repoRoot, "specs", "frs", "STE-507.md"),
    join(repoRoot, "specs", "frs", "archive", "STE-507.md"),
  ];
  const path = candidates.find((p) => existsSync(p));
  if (path === undefined) {
    throw new Error(`STE-507.md is at neither specs/frs/ nor specs/frs/archive/: ${candidates.join(", ")}`);
  }
  return readFileSync(path, "utf8");
}

// ---------------------------------------------------------------------------
// Leg 1 — the two narrowings are RECORDED IN THE FR, reasons included
// ---------------------------------------------------------------------------

/** The `e2e_cmd` key, named as a key. */
const E2E_KEY = /\be2e_cmd\b/;
/** "…is never written" however the prose phrases the refusal. */
const NEVER_WRITTEN =
  /\bnever\b|\bdoes not write\b|\bis not written\b|\bno e2e_cmd\b|\bonly\b/i;
/** WHY: nothing in the closed source set asks the question, so `none` would be a guess. */
const E2E_REASON =
  /would be a guess|guess about|never (?:asks|asked)|nothing (?:in|about) .*(?:source|suite|end-to-end|e2e)|closed source set|no (?:source|detector|signal) .*(?:end-to-end|e2e)/i;

/** The runnable half of the population. */
const RUNNABLE_HALF = /\brunnable\b|detection fires|detection fired|a source fired|run instructions are discoverable/i;
/** …is declined / left alone / not a target. */
const DECLINED = /\bdeclines?\b|\bdeclined\b|left alone|leaves? (?:it|them|that project) alone|does not (?:apply|fire|touch)|stays (?:quiet|silent)|is not a target|no-op/i;
/** WHY #1: a migration must not invent a command it cannot verify. */
const INVENT_REASON = /\binvent\b|cannot verify|can(?:'|’)t verify|would be a guess|\bguess\b/i;
/** WHY #2: a wrong `run_cmd` under the sibling FR's blocking default gates commits on a broken command. */
const BLOCKING_HARM = /\bblocking\b/i;
const BROKEN_COMMAND = /does not work|doesn(?:'|’)t work|\bwrong\b|\bbroken\b|\bincorrect\b/i;
const GATES_COMMITS = /\bgate\b|\bgates\b|\bgating\b|\bcommit/i;

describe("audit leg 1 — STE-507 records BOTH narrowings, with their reasons", () => {
  test("the FR is readable at its active OR archived path", () => {
    expect(frBody().length).toBeGreaterThan(0);
  });

  // A fact-only note ("the entry writes run_cmd") would satisfy a mention-pin
  // while hiding the decision. The reason clause is the decision.
  test("ONE statement records that `e2e_cmd` is NEVER written, AND why", () => {
    const hits = statements(frBody()).filter(
      (s) => E2E_KEY.test(s) && NEVER_WRITTEN.test(s) && E2E_REASON.test(s),
    );
    expect(hits.length).toBeGreaterThan(0);
  });

  test("ONE statement records that the RUNNABLE half is declined, AND that a migration must not invent a command it cannot verify", () => {
    const hits = statements(frBody()).filter(
      (s) => RUNNABLE_HALF.test(s) && DECLINED.test(s) && INVENT_REASON.test(s),
    );
    expect(hits.length).toBeGreaterThan(0);
  });

  test("ONE statement records the second reason: a wrong `run_cmd` under the blocking default gates commits on a command that does not work", () => {
    const hits = statements(frBody()).filter(
      (s) => RUN_CMD.test(s) && BLOCKING_HARM.test(s) && BROKEN_COMMAND.test(s) && GATES_COMMITS.test(s),
    );
    expect(hits.length).toBeGreaterThan(0);
  });

  // Falsifiability guard for the three pins above: the narrowings must be in
  // the FR, not merely somewhere in the repo. The module header already
  // carries them, so a pin that read the module would pass vacuously.
  test("the pins read the FR, not the module — the module alone does not satisfy them", () => {
    const moduleSource = readPlugin("adapters", "_shared", "src", "migrations", "entries", "verification_run_keys.ts");
    expect(moduleSource).toMatch(E2E_KEY);
    expect(frBody()).not.toBe(moduleSource);
  });
});

// ---------------------------------------------------------------------------
// Leg 2 — the operator-facing seam: `Nothing to do.` is not the last word
// ---------------------------------------------------------------------------

/** The gate surface that owns the case `/upgrade` declines. */
const GATE_PROBE = /probe #80|runnability_declared|\/gate-check|gate-check/i;

describe("audit leg 2 — /upgrade points a still-red operator at the gate probe", () => {
  test("skills/upgrade/SKILL.md names `run_cmd` at all", () => {
    expect(upgradeSkill).toMatch(RUN_CMD);
  });

  test("ONE statement pairs `run_cmd` with the gate probe that owns the runnable case", () => {
    const hits = statements(upgradeSkill).filter(
      (s) => RUN_CMD.test(s) && GATE_PROBE.test(s) && RUNNABLE_HALF.test(s),
    );
    expect(hits.length).toBeGreaterThan(0);
  });

  test("skills/upgrade/SKILL.md stays within the NFR-1 line cap (358)", () => {
    expect(upgradeSkill.split("\n").length).toBeLessThanOrEqual(358);
  });

  // The STE-token ceiling is at 246/246 — zero headroom. This file carries
  // exactly one today (the STE-228 branch-gate anchor on line 13); the seam
  // must not add a second.
  test("no NEW `STE-`/`AC-STE-` token is introduced into skills/upgrade/SKILL.md", () => {
    expect((upgradeSkill.match(/\bAC-STE-\d+|\bSTE-\d+/g) ?? []).length).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Leg 3 — the FR's own named fixture: an existing TWO-KEY block
// ---------------------------------------------------------------------------

/**
 * The fixture STE-507's Testing section and the M131 plan's task 13 both name
 * and nothing above builds: a block that already declares TWO keys. This is
 * the only shape that exercises `splicePosition`'s insert-AFTER-`verify_mode`
 * branch, and the only one where "no verify_mode line was added" is a weaker
 * claim than "the operator's declared verify_mode was not ALTERED".
 *
 * `manual` deliberately, not `advisory`: `advisory` is what a re-render would
 * stamp, so a re-render bug would be indistinguishable from a correct splice.
 */
const TWO_KEY_CLAUDE_MD = [
  "# Demo Project",
  "",
  "## Overview",
  "",
  "A small library. It is not an application.",
  "",
  "## Verification",
  "",
  "verify_skill: demo-drive",
  "verify_mode: manual",
  "",
  "## Notes",
  "",
  "Nothing else to say.",
  "",
].join("\n");

describe("audit leg 3 — an existing TWO-KEY block (`verify_skill` + `verify_mode`)", () => {
  test("the entry fires on it and splices exactly one line", () => {
    const { root, claudeMd } = notRunnableFixture(TWO_KEY_CLAUDE_MD);
    const entry = liveEntry();

    expect(entry.detect(root).applies).toBe(true);

    const before = readFileSync(claudeMd, "utf8");
    expect(entry.apply!(root).changed).toEqual(["CLAUDE.md"]);
    const after = readFileSync(claudeMd, "utf8");

    expect(addedLines(before, after)).toEqual(["run_cmd: none"]);
  });

  test("the line lands AFTER `verify_mode` — canonical key order in a two-key block", () => {
    const { root, claudeMd } = notRunnableFixture(TWO_KEY_CLAUDE_MD);
    liveEntry().apply!(root);

    const lines = readFileSync(claudeMd, "utf8").split("\n");
    const heading = lines.indexOf("## Verification");
    const verifySkill = lines.indexOf("verify_skill: demo-drive");
    const verifyMode = lines.indexOf("verify_mode: manual");
    const runCmd = lines.indexOf("run_cmd: none");
    const nextHeading = lines.findIndex((l, i) => i > heading && /^#{1,4} /.test(l));

    expect(verifySkill).toBeGreaterThan(heading);
    expect(verifyMode).toBeGreaterThan(verifySkill);
    expect(runCmd).toBe(verifyMode + 1);
    expect(runCmd).toBeLessThan(nextHeading);
  });

  test("no `verify_mode:` line is ADDED and the declared one is not ALTERED", () => {
    const { root, claudeMd } = notRunnableFixture(TWO_KEY_CLAUDE_MD);
    liveEntry().apply!(root);

    const after = readFileSync(claudeMd, "utf8");
    expect(after.split("\n").filter((l) => /^verify_mode:/.test(l))).toEqual(["verify_mode: manual"]);
    expect(readVerificationConfig(claudeMd).verifyMode).toBe("manual");
    // The operator's declared mode still wins over the run_cmd-keyed default.
    expect(resolveVerifyMode(claudeMd)).toBe("manual");
  });

  test("the two-key block is idempotent too — re-running is a byte-level no-op", () => {
    const { root, claudeMd } = notRunnableFixture(TWO_KEY_CLAUDE_MD);
    const entry = liveEntry();

    entry.apply!(root);
    const afterFirst = readFileSync(claudeMd, "utf8");

    expect(entry.detect(root).applies).toBe(false);
    expect(entry.apply!(root).changed).toEqual([]);
    expect(readFileSync(claudeMd, "utf8")).toBe(afterFirst);
  });
});

// ---------------------------------------------------------------------------
// Leg 4 — `requires_explicit_approval` is pinned FALSY, deliberately
// ---------------------------------------------------------------------------

describe("audit leg 4 — the entry rides the ONE batch approval, and that is pinned", () => {
  // docs/upgrade-reference.md § "the never-auto-apply rail": the flag is for
  // an entry that rewrites SECURITY configuration or anything an operator
  // would want to approve on its own terms. This entry splices one line into
  // a documentation config block, so the batch approval is right — and the
  // falsy value is a decision, which is why it needs a pin rather than an
  // absence.
  test("requires_explicit_approval is falsy — the entry is in the batch, not on its own prompt", () => {
    expect(liveEntry().requires_explicit_approval).toBeFalsy();
  });

  // Contrast, so the pin above cannot pass vacuously on a registry where the
  // field has stopped being read at all.
  test("the field is REAL — permission-shapes, which rewrites security config, carries it as `true`", () => {
    const permissionShapes = MIGRATIONS.find((e) => e.id === "permission-shapes");
    expect(permissionShapes).toBeDefined();
    expect(permissionShapes!.requires_explicit_approval).toBe(true);
    expect(MIGRATIONS.filter((e) => e.requires_explicit_approval === true).map((e) => e.id)).not.toContain(ENTRY_ID);
  });
});

// ---------------------------------------------------------------------------
// Leg 5 — mixed-EOL idempotency hazard
// ---------------------------------------------------------------------------

/**
 * A CLAUDE.md that mixes line endings — a real thing operators produce by
 * hand-editing a CRLF file on a POSIX box, or by a merge.
 *
 * `splitLines` picks `\r\n` as THE separator the moment the file contains one,
 * so `verify_skill: demo-drive\nrun_cmd: none` arrives as ONE chunk. The
 * key-matching regex is unanchored-per-line (no `m` flag), so it cannot see the
 * `run_cmd:` hiding after the embedded LF — and the entry splices a SECOND
 * `run_cmd: none` into a block that already declares one.
 *
 * The block DOES already declare `run_cmd`, on its own visual line, which is
 * exactly the population AC-STE-507.5 promises is a no-op.
 */
const MIXED_EOL_CLAUDE_MD =
  "# Demo Project\r\n" +
  "\r\n" +
  "## Overview\r\n" +
  "\r\n" +
  "A small library. It is not an application.\r\n" +
  "\r\n" +
  "## Verification\r\n" +
  "verify_skill: demo-drive\n" +
  "run_cmd: none\r\n" +
  "\r\n" +
  "## Notes\r\n" +
  "\r\n";

describe("audit leg 5 — AC-STE-507.5 holds on a mixed-EOL file", () => {
  test("the fixture really does declare `run_cmd` on its own line, before anything runs", () => {
    expect(MIXED_EOL_CLAUDE_MD.split(/\r\n|\n/).filter((l) => l === "run_cmd: none")).toEqual(["run_cmd: none"]);
  });

  test("detect does NOT fire — the key is already answered, whatever the line endings", () => {
    const { root } = notRunnableFixture(MIXED_EOL_CLAUDE_MD);
    expect(liveEntry().detect(root).applies).toBe(false);
  });

  test("apply is a byte-level no-op, and no SECOND `run_cmd` is spliced", () => {
    const { root, claudeMd } = notRunnableFixture(MIXED_EOL_CLAUDE_MD);
    const before = readFileSync(claudeMd, "utf8");

    liveEntry().apply!(root);
    const after = readFileSync(claudeMd, "utf8");

    expect(after.split(/\r\n|\n/).filter((l) => l === "run_cmd: none")).toHaveLength(1);
    expect(after).toBe(before);
  });
});
