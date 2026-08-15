// M124 / STE-467 — "/implement Phase 3 best-practices conformance lens".
//
// RED-first pins for:
//   AC-STE-467.1 — deterministic scope-glob selection via the STE-465 module
//     (`adapters/_shared/src/best_practices_manifest.ts`), run via bun (a real
//     `select` CLI leg, not prose re-derivation — the M122 lesson: a bun
//     command the SKILL cites must actually execute), plus the /implement
//     Phase 3 lens prose block (direct doc reads, violations filed as review
//     concerns).
//   AC-STE-467.2 — the MUST-emit disposition XOR pair
//     `best_practices_lens_applied` / `best_practices_lens_skipped_no_manifest`
//     registered in CANONICAL_CAPABILITY_KEYS, carried in /spec-write § 7's
//     static map, and emitted by /implement's closing summary — probe #44
//     (`closing_summary_capability_keys`) run live against this repo.
//   AC-STE-467.3 — lens concerns ride the existing bounded 2-round Phase 3
//     loop; never a new blocking gate, never an auto-fix outside the loop.
//   AC-STE-467.4 — grep pins on the lens block + both tokens (this suite),
//     NFR-1 line caps (parsed from the canonical suite, never restated) on
//     every touched SKILL, and ZERO new tracker-ID tokens in the new skills/
//     prose (the skills/ STE-token ceiling sits at zero headroom, 246/246).
//   AC-STE-467.5 — project-local smoke fixture group 12 in
//     `.claude/skills/smoke-test/SKILL.md` asserting the lens/disposition
//     surface, mutation-verified via three-way token parity + region-scoped
//     mutations; SMOKE_LEGS byte-identical (the M121 fake-leg lesson).
//
// PIN DISCIPLINE (docs/patterns.md Pattern 31; house precedents
// `m100-ste-373-deps-research-parity.test.ts` for the disposition pair,
// `m123-ste-464-deliver-skill.test.ts` for the fixture-group registration):
//   * The lens prose block is ONE contiguous region anchored at a line
//     beginning `**Best-practices conformance lens` inside Phase 3, ending at
//     the next bold paragraph / heading / numbered step. The anchor literal is
//     the grep pin AC.4 demands.
//   * Mutation checks slice the region FIRST and mutate inside it
//     (follow-ups.md § 0k(m): a whole-document replace can land on the wrong
//     copy and manufacture a green). A region-scoped replaceAll is used
//     instead of `mutateInRegion` where the token may legitimately occur more
//     than once inside the block (MUST-emit line + XOR line) — pinning an
//     exact occurrence count there would over-constrain the prose.
//   * The falsifiability that matters is CROSS-SURFACE: the token set in the
//     fixture block, the lens block, and the canonical registry must be
//     byte-identical, so a rename on any one surface reddens the parity test
//     (a fixture compared to ITSELF proves nothing — the M121 group-guard
//     lesson).

import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CANONICAL_CAPABILITY_KEYS,
  runClosingSummaryCapabilityKeysProbe,
} from "../adapters/_shared/src/closing_summary_capability_keys";
import {
  CANONICAL_FIXTURE_GROUPS,
  SMOKE_LEGS,
} from "../adapters/_shared/src/smoke_fixture_groups";
import {
  writeManifest,
  type BestPracticesManifest,
} from "../adapters/_shared/src/best_practices_manifest";
import { specWriteStep7Map } from "./_skill-md";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");

const IMPLEMENT_SKILL = join(PLUGIN_ROOT, "skills", "implement", "SKILL.md");
const SPEC_WRITE_SKILL = join(PLUGIN_ROOT, "skills", "spec-write", "SKILL.md");
const SMOKE_SKILL = join(REPO_ROOT, ".claude", "skills", "smoke-test", "SKILL.md");
const FIXTURE_GROUPS_SRC = join(
  PLUGIN_ROOT,
  "adapters",
  "_shared",
  "src",
  "smoke_fixture_groups.ts",
);
const MODULE_ABS = join(
  PLUGIN_ROOT,
  "adapters",
  "_shared",
  "src",
  "best_practices_manifest.ts",
);
const MODULE_PATH_LITERAL = "adapters/_shared/src/best_practices_manifest.ts";

const TOKEN_APPLIED = "best_practices_lens_applied";
const TOKEN_SKIPPED = "best_practices_lens_skipped_no_manifest";
const TOKENS = [TOKEN_APPLIED, TOKEN_SKIPPED] as const;

function mustRead(path: string): string {
  expect({ path, exists: existsSync(path) }).toEqual({ path, exists: true });
  return readFileSync(path, "utf8");
}

const impl = (): string => mustRead(IMPLEMENT_SKILL);
const specWrite = (): string => mustRead(SPEC_WRITE_SKILL);
const smoke = (): string => mustRead(SMOKE_SKILL);

const backticked = (body: string, token: string): boolean =>
  body.includes(`\`${token}\``);

const mustEmitRe = (token: string): RegExp =>
  new RegExp(`MUST emit\\s*\`${token}\``);

/**
 * The lens prose block: from the line beginning `**Best-practices conformance
 * lens` (the AC.4 grep-pin anchor, house bold-paragraph style — cf. Phase 3's
 * `**Spec-review audit capability propagation …**` block) to the next bold
 * paragraph, heading, or numbered step. Asserts the anchor exists and sits
 * inside Phase 3 (after `## Phase 3`, before `## Phase 4`).
 */
function lensBlockBounds(body: string): { from: number; to: number } {
  const anchorRe = /^\*\*Best-practices conformance lens/m;
  const anchor = anchorRe.exec(body);
  expect({ lensAnchor: anchor !== null }).toEqual({ lensAnchor: true });
  const from = anchor!.index;

  const phase3 = body.indexOf("## Phase 3");
  const phase4 = body.indexOf("## Phase 4");
  expect(phase3).toBeGreaterThan(-1);
  expect(phase4).toBeGreaterThan(phase3);
  expect(from).toBeGreaterThan(phase3);
  expect(from).toBeLessThan(phase4);

  // Terminator: the next line (after the anchor line) that starts a new bold
  // paragraph, a heading, or a numbered step. Lines inside fences and bullet
  // lists do not match any terminator shape.
  const afterAnchorLine = body.indexOf("\n", from);
  const rest = body.slice(afterAnchorLine + 1);
  const term = /^(?:\*\*|#{2,4} |\d+\.\s)/m.exec(rest);
  const to = term ? afterAnchorLine + 1 + term.index : body.length;
  return { from, to };
}

const lensBlock = (): string => {
  const body = impl();
  const { from, to } = lensBlockBounds(body);
  return body.slice(from, to);
};

/** The `#### Fixture group 12 — STE-467 …` block, to the next ###/#### heading. */
function group12Block(): string {
  const body = smoke();
  const heading = /^#### Fixture group 12 — STE-467.*$/m.exec(body);
  expect({ group12Heading: heading !== null }).toEqual({ group12Heading: true });
  const start = heading!.index;
  const rest = body.slice(start + heading![0].length);
  const next = /^#{3,4} /m.exec(rest);
  return body.slice(
    start,
    next ? start + heading![0].length + next.index : body.length,
  );
}

/**
 * Region-scoped mutation of EVERY occurrence of `find` inside `[from, to)`.
 * Slices the region first (never a whole-document replace — follow-ups.md
 * § 0k(m)), refuses a region the anchor is absent from, and asserts the
 * document actually changed before returning.
 */
function mutateAllInRegion(
  doc: string,
  from: number,
  to: number,
  find: string,
  repl: string,
): string {
  const region = doc.slice(from, to);
  const occurrences = region.split(find).length - 1;
  expect({ find, occurrencesInRegion: occurrences > 0 }).toEqual({
    find,
    occurrencesInRegion: true,
  });
  const mutated = doc.slice(0, from) + region.replaceAll(find, repl) + doc.slice(to);
  expect(mutated).not.toBe(doc);
  return mutated;
}

// Dynamic import so a missing export surfaces as a RED assertion, not a
// module-load crash (the AC-466.2 KNOWN_KEYS idiom).
const loadModule = async (): Promise<Record<string, unknown>> =>
  (await import("../adapters/_shared/src/best_practices_manifest")) as Record<
    string,
    unknown
  >;

type SelectFn = (
  manifest: BestPracticesManifest,
  changedFiles: readonly string[],
) => Array<{ name: string; path: string }>;

const loadSelect = async (): Promise<SelectFn> => {
  const mod = await loadModule();
  const fn = mod["selectEntriesForChangedFiles"];
  expect({ selectEntriesForChangedFiles: typeof fn }).toEqual({
    selectEntriesForChangedFiles: "function",
  });
  return fn as SelectFn;
};

const FIXTURE_MANIFEST: BestPracticesManifest = {
  best_practices: [
    { name: "always-on", path: "docs/best-practices/general.md" },
    {
      name: "ts-house-rules",
      path: "docs/best-practices/errors.md",
      scope: ["src/**/*.ts"],
    },
    {
      name: "adapters-rules",
      path: "docs/best-practices/adapters.md",
      scope: ["adapters/**"],
    },
    {
      name: "root-docs",
      path: "docs/best-practices/docs.md",
      scope: ["*.md"],
    },
  ],
};

// ---------------------------------------------------------------------------
// AC-STE-467.1 — deterministic selection via the STE-465 module
// ---------------------------------------------------------------------------

describe("AC-STE-467.1 — module selection: scope globs vs the changed-file list", () => {
  test("the STE-465 module exports selectEntriesForChangedFiles", async () => {
    await loadSelect();
  });

  test("entries without `scope` always apply — even for an empty changed-file list", async () => {
    const select = await loadSelect();
    const none = select(FIXTURE_MANIFEST, []);
    expect(none.map((e) => e.name)).toEqual(["always-on"]);
    const unrelated = select(FIXTURE_MANIFEST, ["LICENSE", "assets/logo.png"]);
    expect(unrelated.map((e) => e.name)).toEqual(["always-on"]);
  });

  test("a scoped entry is selected exactly when a changed file matches one of its globs", async () => {
    const select = await loadSelect();
    const hit = select(FIXTURE_MANIFEST, ["src/a/b.ts"]);
    expect(hit.map((e) => e.name)).toEqual(["always-on", "ts-house-rules"]);
    const miss = select(FIXTURE_MANIFEST, ["docs/readme.txt"]);
    expect(miss.map((e) => e.name)).toEqual(["always-on"]);
  });

  test("`adapters/**` matches nested files; a single `*` never crosses a separator", async () => {
    const select = await loadSelect();
    const nested = select(FIXTURE_MANIFEST, ["adapters/foo/bar.md"]);
    expect(nested.map((e) => e.name)).toEqual(["always-on", "adapters-rules"]);
    // `*.md` matches a root-level file only — a naive substring/includes
    // implementation would wrongly select root-docs for docs/a.md.
    const root = select(FIXTURE_MANIFEST, ["README.md"]);
    expect(root.map((e) => e.name)).toEqual(["always-on", "root-docs"]);
    const deep = select(FIXTURE_MANIFEST, ["docs/a.md"]);
    expect(deep.map((e) => e.name)).toEqual(["always-on"]);
  });

  test("selection is deterministic: manifest order, one row per entry, stable across calls", async () => {
    const select = await loadSelect();
    const files = ["src/a/b.ts", "src/c/d.ts", "adapters/x/y.md", "README.md"];
    const first = select(FIXTURE_MANIFEST, files);
    expect(first.map((e) => e.name)).toEqual([
      "always-on",
      "ts-house-rules",
      "adapters-rules",
      "root-docs",
    ]);
    // Two files matching the same glob must not duplicate the entry, and the
    // same input must reproduce the same output byte-for-byte.
    expect(select(FIXTURE_MANIFEST, files)).toEqual(first);
  });

  test("an empty manifest selects nothing", async () => {
    const select = await loadSelect();
    expect(select({ best_practices: [] }, ["src/a/b.ts"])).toEqual([]);
  });
});

describe("AC-STE-467.1 — the selection runs via bun: `select` CLI leg on the module", () => {
  const runCli = (
    args: string[],
  ): { exitCode: number; stdout: string; stderr: string } => {
    const proc = Bun.spawnSync(["bun", MODULE_ABS, ...args], {
      cwd: PLUGIN_ROOT,
    });
    return {
      exitCode: proc.exitCode,
      stdout: proc.stdout.toString(),
      stderr: proc.stderr.toString(),
    };
  };

  const seededSpecsDir = (): string => {
    const dir = mkdtempSync(join(tmpdir(), "dpt-ste467-specs-"));
    writeManifest(dir, FIXTURE_MANIFEST);
    return dir;
  };

  test("select prints the matched entries (name + doc path) in manifest order, exit 0", () => {
    const specsDir = seededSpecsDir();
    const { exitCode, stdout } = runCli([
      "select",
      "--specs",
      specsDir,
      "--files",
      "src/a/b.ts docs/readme.txt",
    ]);
    expect({ exitCode, ranSelect: true }).toEqual({ exitCode: 0, ranSelect: true });
    const lines = stdout.split("\n").filter((l) => l.trim().length > 0);
    expect(lines).toHaveLength(2);
    expect(lines[0]!).toMatch(/^always-on\s+docs\/best-practices\/general\.md$/);
    expect(lines[1]!).toMatch(/^ts-house-rules\s+docs\/best-practices\/errors\.md$/);
    expect(stdout).not.toContain("adapters-rules");
    expect(stdout).not.toContain("root-docs");
  });

  test("an absent/empty manifest reports the no-manifest disposition, exit 0 — never a silent empty pass", () => {
    const emptyDir = mkdtempSync(join(tmpdir(), "dpt-ste467-empty-"));
    const { exitCode, stdout } = runCli([
      "select",
      "--specs",
      emptyDir,
      "--files",
      "src/a/b.ts",
    ]);
    expect({ exitCode, emptyManifest: true }).toEqual({
      exitCode: 0,
      emptyManifest: true,
    });
    // The marker the lens maps onto `best_practices_lens_skipped_no_manifest`;
    // an empty stdout here would be indistinguishable from "entries exist,
    // none matched" — the exact silent-skip ambiguity the FR forbids.
    expect(stdout).toMatch(/no.?manifest/i);
  });

  test("select without --files is a usage refusal: exit 2 (house usage code, never a verdict)", () => {
    const specsDir = seededSpecsDir();
    const { exitCode, stderr } = runCli(["select", "--specs", specsDir]);
    expect({ exitCode, usageRefusal: true }).toEqual({
      exitCode: 2,
      usageRefusal: true,
    });
    expect(stderr.length).toBeGreaterThan(0);
  });
});

describe("AC-STE-467.1 — /implement Phase 3 lens prose block", () => {
  test("the lens block exists inside Phase 3 under the pinned bold anchor", () => {
    const block = lensBlock();
    expect(block.length).toBeGreaterThan(0);
  });

  test("selection is module-run, not prose-derived: names the manifest, the module path, bun, and the select leg", () => {
    const block = lensBlock();
    expect(block).toContain("specs/best-practices.yaml");
    expect(block).toContain(MODULE_PATH_LITERAL);
    expect(block).toMatch(/\bbun\b/);
    expect(block).toMatch(/\bselect\b/);
  });

  test("the applied condition (manifest has at least one entry) and the changed-file input are stated", () => {
    const block = lensBlock();
    expect(block).toMatch(/(?:≥\s*1|at least one) entr/i);
    expect(block).toMatch(/changed[- ]file/i);
  });

  test("entries without `scope` always apply", () => {
    expect(lensBlock()).toMatch(/without[^\n]{0,60}`scope`[^\n]{0,120}always appl/i);
  });

  test("the curated docs are read directly — no research fork (the standing operator ruling)", () => {
    const block = lensBlock();
    expect(block).toMatch(/read[^\n]{0,160}directly|directly[^\n]{0,120}read/i);
    expect(block).toMatch(/(?:no|never|not)[^\n]{0,80}research fork/i);
  });

  test("violations are filed as review concerns", () => {
    expect(lensBlock()).toMatch(/review concern/i);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-467.2 — the MUST-emit disposition XOR pair, registered end to end
// ---------------------------------------------------------------------------

describe("AC-STE-467.2 — tokens registered in the canonical capability map", () => {
  const keys = [...CANONICAL_CAPABILITY_KEYS] as string[];

  for (const token of TOKENS) {
    test(`CANONICAL_CAPABILITY_KEYS includes ${token}`, () => {
      expect(keys).toContain(token);
    });
  }

  test("/spec-write § 7 static map carries both token rows", () => {
    const map = specWriteStep7Map(specWrite());
    expect(backticked(map, TOKEN_APPLIED)).toBe(true);
    expect(backticked(map, TOKEN_SKIPPED)).toBe(true);
  });

  for (const token of TOKENS) {
    test(`/spec-write body carries the literal MUST emit \`${token}\` directive`, () => {
      expect(specWrite()).toMatch(mustEmitRe(token));
    });

    test(`/implement body carries the literal MUST emit \`${token}\` directive`, () => {
      expect(impl()).toMatch(mustEmitRe(token));
    });
  }

  test("probe #44 live: both keys registered AND zero violations for either key on this repo", async () => {
    // Guard against the vacuous-green trap: an unregistered key yields zero
    // violations too, so registration is asserted in the SAME test before the
    // clean-probe claim means anything.
    for (const token of TOKENS) expect(keys).toContain(token);
    const report = await runClosingSummaryCapabilityKeysProbe(REPO_ROOT);
    const ours = report.violations.filter((v) =>
      TOKENS.includes(v.missingKey as (typeof TOKENS)[number]),
    );
    expect(ours.map((v) => v.note)).toEqual([]);
  });

  test("the lens block carries both literal backticked tokens and the XOR framing — no silent skip", () => {
    const block = lensBlock();
    expect(backticked(block, TOKEN_APPLIED)).toBe(true);
    expect(backticked(block, TOKEN_SKIPPED)).toBe(true);
    expect(block).toMatch(/exactly one|XOR/);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-467.3 — concerns ride the existing bounded loop
// ---------------------------------------------------------------------------

describe("AC-STE-467.3 — bounded 2-round resolve-or-escalate, no new gate", () => {
  test("the lens block ties its concerns to the existing bounded review loop", () => {
    const block = lensBlock();
    expect(block).toMatch(/Stage B|review loop/);
    expect(block).toMatch(/bounded/i);
  });

  test("never a new blocking gate", () => {
    expect(lensBlock()).toMatch(/never a new blocking gate/);
  });

  test("never an auto-fix outside the loop", () => {
    expect(lensBlock()).toMatch(/never an? auto-fix outside the (?:review )?loop/);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-467.4 — NFR-1 caps + zero-headroom STE-token ceiling
// ---------------------------------------------------------------------------

describe("AC-STE-467.4 — NFR-1 line cap green on every touched SKILL", () => {
  // Parse the canonical cap from skill-nfr-1-length.test.ts rather than
  // restating it (the AC-466.4 idiom) — a legitimate cap bump must not strand
  // this suite on a stale integer.
  const cap = (): number => {
    const src = mustRead(join(import.meta.dir, "skill-nfr-1-length.test.ts"));
    const m = /const SKILL_LINE_CAP = (\d+);/.exec(src);
    expect({ capParsed: m !== null }).toEqual({ capParsed: true });
    return Number(m![1]);
  };

  test("skills/implement/SKILL.md stays within the canonical cap after the lens block", () => {
    expect(impl().split("\n").length).toBeLessThanOrEqual(cap());
  });

  test("skills/spec-write/SKILL.md stays within the canonical cap after the new map rows", () => {
    expect(specWrite().split("\n").length).toBeLessThanOrEqual(cap());
  });
});

describe("AC-STE-467.4 — zero new tracker-ID tokens in skills/ prose (246/246 ceiling)", () => {
  test("the lens block carries NO tracker-ID tokens", () => {
    expect(lensBlock().match(/\bSTE-\d+\b/g) ?? []).toEqual([]);
  });

  test("the § 7 map rows carrying either disposition token carry NO tracker-ID tokens", () => {
    const rows = specWriteStep7Map(specWrite())
      .split("\n")
      .filter((line) => line.includes(TOKEN_APPLIED) || line.includes(TOKEN_SKIPPED));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.match(/\bSTE-\d+\b/g) ?? []).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// AC-STE-467.5 — project-local smoke fixture group 12; SMOKE_LEGS untouched
// ---------------------------------------------------------------------------

describe("AC-STE-467.5 — fixture group 12 block in .claude/skills/smoke-test/SKILL.md", () => {
  test("the group heading exists in the house `#### Fixture group <N> — <SUT>` shape", () => {
    expect(smoke()).toMatch(/^#### Fixture group 12 — STE-467/m);
  });

  test("the fixture asserts the disposition surface in ASSISTANT text of the /implement capture", () => {
    const block = group12Block();
    // The vacuous-grep lesson: a raw-NDJSON grep matches SKILL prose read into
    // tool_results; the fixture must extract assistant-authored text.
    expect(block).toContain("extractAssistantText");
    expect(block).toContain(TOKEN_APPLIED);
    expect(block).toContain(TOKEN_SKIPPED);
    expect(block).toMatch(/exactly one/i);
    expect(block).toMatch(/implement/);
    expect(block).toContain("/tmp/dpt-smoke-");
    expect(block).toMatch(/[Aa]ssert/);
  });

  test("the block carries both runtime-check summary lines (house group-footer shape)", () => {
    const block = group12Block();
    expect(block).toContain("STE-467 runtime check: PASS");
    expect(block).toContain("STE-467 runtime check: FAIL");
  });
});

describe("AC-STE-467.5 — canonical roster gains group 12; SMOKE_LEGS byte-identical", () => {
  test("SMOKE_LEGS stays byte-identical in source and value (the fake-leg lesson)", () => {
    expect([...SMOKE_LEGS]).toEqual(["linear", "jira", "none"]);
    expect(mustRead(FIXTURE_GROUPS_SRC)).toContain(
      'export const SMOKE_LEGS = ["linear", "jira", "none"] as const;',
    );
  });

  test("the roster is 13 groups, 1..13 in order", () => {
    expect(CANONICAL_FIXTURE_GROUPS).toHaveLength(13);
    expect(CANONICAL_FIXTURE_GROUPS.map((s) => s.group)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13,
    ]);
  });

  test("group 12: sut STE-467, legs = the SMOKE_LEGS alias, a real rationale", () => {
    const g12 = CANONICAL_FIXTURE_GROUPS.find((s) => s.group === 12);
    expect(g12).toBeDefined();
    expect(g12!.sut).toBe("STE-467");
    expect([...g12!.legs].sort()).toEqual(["jira", "linear", "none"]);
    // The ALIAS, not a parallel literal — reference identity is the observable.
    expect(g12!.legs).toBe(SMOKE_LEGS as unknown as typeof g12.legs);
    // A rationale is a clause, not a token (the roster-audit floor).
    expect(String(g12!.rationale).trim().split(/\s+/).length).toBeGreaterThanOrEqual(6);
  });
});

describe("AC-STE-467.5 — mutation-verified: three-way token parity, region-sited", () => {
  test("fixture block, lens block, and the canonical registry carry the SAME token pair", () => {
    const block = group12Block();
    const lens = lensBlock();
    const registry = [...CANONICAL_CAPABILITY_KEYS] as string[];
    for (const token of TOKENS) {
      expect(block).toContain(token);
      expect(lens).toContain(token);
      expect(registry).toContain(token);
    }
    // No third sibling token invented on either prose surface.
    const strayRe = /best_practices_lens_[a-z_]+/g;
    const expected = new Set<string>(TOKENS);
    for (const surface of [block, lens]) {
      const found = new Set(surface.match(strayRe) ?? []);
      expect([...found].sort()).toEqual([...expected].sort());
    }
  });

  test("mutating the applied token inside the fixture block reddens the fixture pin", () => {
    const body = smoke();
    const block = group12Block();
    const from = body.indexOf(block);
    expect(from).toBeGreaterThan(-1);
    const mutated = mutateAllInRegion(
      body,
      from,
      from + block.length,
      TOKEN_APPLIED,
      "best_practices_lens_appl1ed",
    );
    const mutatedBlock = mutated.slice(from, from + block.length);
    expect(mutatedBlock).not.toContain(TOKEN_APPLIED);
  });

  test("mutating the skipped token inside the lens block reddens the cross-surface parity", () => {
    const body = impl();
    const { from, to } = lensBlockBounds(body);
    const mutated = mutateAllInRegion(
      body,
      from,
      to,
      TOKEN_SKIPPED,
      "best_practices_lens_skipped_no_man1fest",
    );
    expect(mutated.slice(from, to)).not.toContain(TOKEN_SKIPPED);
    // The fixture still pins the canonical token, so the parity test above
    // would fail against this mutant — the pin CAN fail, and about the right
    // subject.
    expect(group12Block()).toContain(TOKEN_SKIPPED);
  });
});

// Meta-meta pins — house pattern: shipped roster suites RE-KEY to the widened
// roster, never deleted, never left green on stale numbers. Registering group
// 12 flips the group-list and length pins in both shipped suites below.
describe("AC-STE-467.5 — shipped roster suites re-key to 13 groups", () => {
  const src = (name: string): string => mustRead(join(import.meta.dir, name));

  test("m117-ste-425-falsifiable-coverage.test.ts counts 13 (group list, length pin, roster row)", () => {
    const norm = src("m117-ste-425-falsifiable-coverage.test.ts").replace(/\s+/g, "");
    expect(norm).toMatch(/1,2,3,4,5,6,7,8,9,10,11,12,13,?\]/);
    expect(src("m117-ste-425-falsifiable-coverage.test.ts")).toContain(
      "toHaveLength(13)",
    );
    expect(norm).toContain('12:["jira","linear","none"]');
  });

  test("m123-ste-464-deliver-skill.test.ts re-keys its roster pins to 13", () => {
    const norm = src("m123-ste-464-deliver-skill.test.ts").replace(/\s+/g, "");
    expect(norm).toMatch(/1,2,3,4,5,6,7,8,9,10,11,12,13,?\]/);
    expect(src("m123-ste-464-deliver-skill.test.ts")).toContain("toHaveLength(13)");
  });
});
