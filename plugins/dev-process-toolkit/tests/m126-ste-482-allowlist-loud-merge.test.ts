// M126 / STE-482 — make the /setup allow-list merge LOUD, and grant the
// compound git-commit invocation forms.
//
// ═══ WHAT IS BROKEN, measured ═══════════════════════════════════════════════
//
// F13 (2026-08-16 conformance iter-1). The smoke driver's heredoc wrote 22
// `permissions.allow` entries; the `.claude/settings.json` committed after
// `/setup` carried 43. `mergeAllowList` is doing exactly what it was built to
// do — the merge is INTENDED, load-bearing, and confirmed three separate times
// (2026-07-20, 2026-07-27, 2026-08-16). What is missing is any SIGNAL: the
// list a reviewer reads in the PR diff is the opening posture, never the
// effective policy, and nothing in the run says so. That silence is why the
// same measurement gets re-filed as a defect on every leg — and why the two
// legs disposed of the identical number oppositely (linear filed it as a
// finding, jira filed it under *What worked*).
//
// F5 (same run). `git commit -F - <<'EOF' … && echo … && git log …` was DENIED
// in `/setup` on linear and in `/setup` + `/spec-write` on jira, even though
// the plain form is granted. The prefix rule is correct; the classifier does
// not credit it for heredoc or `&&`-chained forms.
//
// ═══ THE ONE THING THIS SUITE MUST NOT DO ══════════════════════════════════
//
// Not a single assertion here may push toward SUPPRESSING the merge. The
// operator's 2026-08-17 decision was keep-the-behaviour-and-add-the-signal,
// over both alternatives (suppress, or document only). So AC.2's legs are
// written as a REGRESSION FENCE around the merge: they fail if the merge stops
// merging, and they are derived from the live `templates/permissions.json`
// rather than from a frozen literal that would rot the moment AC.4 adds a
// grant to that same file.
//
// ═══ WHAT THE AC.4 FIXTURE DOES AND DOES NOT PROVE ═════════════════════════
//
// It CANNOT run Claude Code's real permission classifier — there is no such
// entry point available to `bun test`. What it does instead: decompose the two
// MEASURED invocation forms into the components a compound command is checked
// as, and assert every component is covered by some entry in the shipped
// `templates/permissions.json` under the DOCUMENTED rule semantics (`Bash(x:*)`
// is a prefix rule; `Bash(x)` is exact-match only; `Bash(x *)` is the inert
// glob shape). So it proves the GRANT IS DECLARED AND IS COVERING-SHAPED. It
// does NOT prove the live classifier admits the heredoc form — that is what
// the next conformance leg measures, and this file is deliberately unable to
// fake it. `_writes` entries are documentation-only (`/setup` does not
// pre-emit them), so a covering entry landing there proves the grant is
// declared, not that a fresh scaffold carries it.
//
// ═══ HARD BUDGETS, measured at authoring time (2026-08-17, v2.65.0) ════════
//
//   * `skills/setup/SKILL.md`      — 358 / 358 lines. ZERO headroom.
//   * `skills/spec-write/SKILL.md` — 358 / 358 lines. ZERO headroom.
//   * `skills/` tree               — 246 / 246 `STE-N` tokens. ZERO headroom.
//
// Both prose edits this FR needs (the /setup MUST-emit directive AND the § 7
// rendered-prose row) therefore have to be NET-ZERO-LINE, in-place extensions
// of an existing line. The move IS available and has a precedent one milestone
// old, in this very branch: STE-479 extended the existing
// `requires_input_refused` § 7 row's cell in place rather than adding a table
// row. The § 7 row to extend here is the `/setup`-owned `tracker_config_*`
// row; the /setup directive extends its step-6 merge bullet. The budget
// tripwires below are pinned FIRST so a line-adding fix trips them before
// anything subtler. This file lives under `tests/`, which carries neither
// budget, so it cites ticket ids freely.
//
// ═══ REGISTRY COUPLING ═════════════════════════════════════════════════════
//
// Registering a capability key moves three conscious pins in
// `tests/m84-ste-320-code-reviewer-scope-registry.test.ts`: the length pin, the
// discovered-set pin, and an `EXPECTED_SET_A` entry. Those must be BUMPED, not
// weakened — the coupling guards below read that file's source and fail if the
// numbers drift from the registry or if the exact-equality shape is relaxed.

import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  canonicalAllowList,
  mergeAllowList,
  type SettingsJson,
} from "../adapters/_shared/src/setup/merge_settings";
import {
  CANONICAL_CAPABILITY_KEYS,
  runClosingSummaryCapabilityKeysProbe,
} from "../adapters/_shared/src/closing_summary_capability_keys";
import { specWriteStep7Map } from "./_skill-md";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");

const read = (p: string): string => readFileSync(p, "utf-8");

const SETUP_SKILL = join(PLUGIN_ROOT, "skills", "setup", "SKILL.md");
const SPEC_WRITE_SKILL = join(PLUGIN_ROOT, "skills", "spec-write", "SKILL.md");
const PERMISSIONS_TEMPLATE_PATH = join(PLUGIN_ROOT, "templates", "permissions.json");
const SETTINGS_TEMPLATE_PATH = join(PLUGIN_ROOT, "templates", "settings.json");
const M84_TEST = join(PLUGIN_ROOT, "tests", "m84-ste-320-code-reviewer-scope-registry.test.ts");
const FR_482 = join(REPO_ROOT, "specs", "frs", "STE-482.md");

const SKILL_LINE_CAP = 358;
const SKILLS_STE_TOKEN_CEILING = 246;

/**
 * The capability key this FR registers. Named here ONCE — every assertion in
 * the file reads it from this constant, and the shipped module must export the
 * byte-identical string (pinned under AC.1).
 */
const ALLOWLIST_KEY = "setup_allowlist_entries_added";

// ───────────────────────────────────────────────────────────────────────────
// Lazy module access.
//
// `mergeAllowListReport` / `ALLOWLIST_MERGE_CAPABILITY_KEY` do not exist yet.
// A STATIC named import of a missing export is a link-time error in ESM that
// aborts the ENTIRE file — which would collapse five independent ACs into one
// load failure and hide the AC.2 / AC.4 / AC.5 reds behind it. Dynamic import
// keeps each AC's red its own.
// ───────────────────────────────────────────────────────────────────────────

interface AllowListMergeReport {
  /** The merged settings object — byte-identical to `mergeAllowList`'s. */
  settings: SettingsJson;
  /** How many entries the CALLER supplied (0 on the scaffold-from-nothing path). */
  callerCount: number;
  /** How many entries the merge ADDED beyond the caller's list. */
  addedCount: number;
  /** Size of the resulting entry set. */
  mergedCount: number;
  /** The literal registered capability key. */
  capabilityKey: string;
  /** The rendered capability row. ALWAYS non-empty — never a silent skip. */
  row: string;
}

interface MergeSettingsModule {
  ALLOWLIST_MERGE_CAPABILITY_KEY: string;
  mergeAllowListReport: (
    existing: SettingsJson,
    canonical: string[],
  ) => AllowListMergeReport;
}

async function mergeModule(): Promise<MergeSettingsModule> {
  return (await import(
    "../adapters/_shared/src/setup/merge_settings"
  )) as unknown as MergeSettingsModule;
}

// ───────────────────────────────────────────────────────────────────────────
// Shared fixtures, derived from what actually ships.
// ───────────────────────────────────────────────────────────────────────────

interface PermissionsTemplateFile {
  _common: string[];
  _writes?: Record<string, unknown>;
  stacks: Record<string, string[]>;
}

const template = JSON.parse(read(PERMISSIONS_TEMPLATE_PATH)) as PermissionsTemplateFile;

const STACKS = ["bun", "node", "flutter", "python", "kotlin", "generic"] as const;

/** Every allow entry declared anywhere in the shipped template. */
function allTemplateEntries(t: PermissionsTemplateFile): string[] {
  const out: string[] = [...t._common];
  for (const value of Object.values(t._writes ?? {})) {
    if (Array.isArray(value)) out.push(...(value as string[]));
  }
  for (const value of Object.values(t.stacks)) out.push(...value);
  return out;
}

/** Order-preserving dedup — the semantics both merge helpers are built on. */
function dedup(entries: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of entries) {
    if (seen.has(e)) continue;
    seen.add(e);
    out.push(e);
  }
  return out;
}

/** Slice a `### <n>. <title>` section out of a SKILL.md body. */
function skillSection(body: string, heading: string): string {
  const start = body.indexOf(`\n${heading}`);
  expect(start).toBeGreaterThan(-1);
  const rest = body.slice(start + 1);
  const next = rest.search(/\n#{2,3} \S/);
  return next < 0 ? rest : rest.slice(0, next);
}

/** The FR's `## Notes` section, sliced to its own heading. */
function frNotes(): string {
  const body = read(FR_482);
  const start = body.indexOf("\n## Notes");
  expect(start).toBeGreaterThan(-1);
  const rest = body.slice(start + 1);
  const next = rest.indexOf("\n## ", 1);
  return next < 0 ? rest : rest.slice(0, next);
}

// ═══════════════════════════════════════════════════════════════════════════
// BUDGET TRIPWIRES — pinned first, so a line-adding fix fails HERE
// ═══════════════════════════════════════════════════════════════════════════

describe("BUDGETS — the zero-headroom surfaces this FR's prose edits ride against", () => {
  test("skills/setup/SKILL.md stays at or under the 358-line cap", () => {
    expect(read(SETUP_SKILL).split("\n").length).toBeLessThanOrEqual(SKILL_LINE_CAP);
  });

  test("skills/spec-write/SKILL.md stays at or under the 358-line cap", () => {
    expect(read(SPEC_WRITE_SKILL).split("\n").length).toBeLessThanOrEqual(SKILL_LINE_CAP);
  });

  test("the skills/ tree stays at or under the 246 STE-token ceiling", () => {
    // The ceiling is AT the pin with zero headroom: the new /setup directive
    // and the new § 7 prose must cite by MECHANISM, never by `STE-N` token.
    let count = 0;
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
          walk(p);
          continue;
        }
        if (!name.endsWith(".md")) continue;
        count += (read(p).match(/\b(STE|AC-STE)-\d+(?:\.\d+)?\b/g) ?? []).length;
      }
    };
    walk(join(PLUGIN_ROOT, "skills"));
    expect(count).toBeLessThanOrEqual(SKILLS_STE_TOKEN_CEILING);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-STE-482.1 — the row: registered literal token + rendered § 7 prose
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-STE-482.1 — /setup emits a capability row naming the added-entry count", () => {
  test("the shipped module exports the capability key, byte-identical", async () => {
    const { ALLOWLIST_MERGE_CAPABILITY_KEY } = await mergeModule();
    expect(ALLOWLIST_MERGE_CAPABILITY_KEY).toBe(ALLOWLIST_KEY);
  });

  test("the key is registered in CANONICAL_CAPABILITY_KEYS", () => {
    expect(new Set<string>(CANONICAL_CAPABILITY_KEYS).has(ALLOWLIST_KEY)).toBe(true);
  });

  test("the registry still carries no duplicates after the addition", () => {
    expect(new Set<string>(CANONICAL_CAPABILITY_KEYS).size).toBe(
      CANONICAL_CAPABILITY_KEYS.length,
    );
  });

  test("the § 7 static map renders prose for the key AND carries its MUST-emit directive", () => {
    // Both halves matter and they are asserted together on purpose. The
    // registry's forward leg greps the OWNER skill body for the literal
    // directive; the map is what turns the token into something an operator
    // can read. A key with a directive but no rendered prose is a token nobody
    // can act on; prose with no directive is invisible to the probe.
    const map = specWriteStep7Map(read(SPEC_WRITE_SKILL));
    expect(map).toContain(`\`${ALLOWLIST_KEY}\``);
    expect(map).toMatch(new RegExp(`MUST emit\\s*\`${ALLOWLIST_KEY}\``));
  });

  test("the rendered prose names the MERGE, not just the token", () => {
    // Vacuity fence: a bare `key | key` row satisfies the grep above while
    // telling the operator nothing. The row has to say what the count IS.
    const map = specWriteStep7Map(read(SPEC_WRITE_SKILL));
    const row = map
      .split("\n")
      .find((l) => l.includes(`\`${ALLOWLIST_KEY}\``) && l.trimStart().startsWith("|"));
    expect(row).toBeDefined();
    expect(row!).toMatch(/allow-list|allowlist/i);
    expect(row!).toMatch(/\bmerge|added|beyond\b/i);
  });

  test("/setup's own body carries the MUST-emit directive AT the merge site", () => {
    // Scoped to step 6, not to the file. A directive parked in some unrelated
    // section is prose the LLM reading the merge bullet never sees — the same
    // "three literals scattered across a 358-line file is not a call site"
    // lesson the M116 wiring tests recorded.
    const section = skillSection(read(SETUP_SKILL), "### 6. Configure settings");
    expect(section).toContain("mergeAllowList");
    expect(section).toMatch(new RegExp(`MUST emit\\s*\`${ALLOWLIST_KEY}\``));
  });

  test("the closing-summary registry probe is clean across the repo", () => {
    // The bidirectional invariant: registering the key without the directive
    // (or writing the directive without registering) turns this red.
    return runClosingSummaryCapabilityKeysProbe(REPO_ROOT).then((report) => {
      expect(report.violations.map((v) => v.note)).toEqual([]);
    });
  });

  test("the report names the count of entries added beyond the caller's list", async () => {
    const { mergeAllowListReport } = await mergeModule();
    const canonical = canonicalAllowList(template, "bun");
    // Caller supplied the first three canonical entries plus one of their own.
    const caller = [...canonical.slice(0, 3), "Bash(rg)"];
    const report = mergeAllowListReport({ permissions: { allow: caller } }, canonical);
    expect({
      callerCount: report.callerCount,
      addedCount: report.addedCount,
      mergedCount: report.mergedCount,
      capabilityKey: report.capabilityKey,
    }).toEqual({
      callerCount: 4,
      addedCount: canonical.length - 3,
      mergedCount: 4 + (canonical.length - 3),
      capabilityKey: ALLOWLIST_KEY,
    });
  });

  test("the rendered row carries the literal token AND the decimal count", async () => {
    const { mergeAllowListReport } = await mergeModule();
    const canonical = canonicalAllowList(template, "bun");
    const caller = [...canonical.slice(0, 3), "Bash(rg)"];
    const report = mergeAllowListReport({ permissions: { allow: caller } }, canonical);
    expect(report.row).toContain(ALLOWLIST_KEY);
    expect(report.row).toMatch(new RegExp(`\\b${report.addedCount}\\b`));
  });
});

describe("AC-STE-482.1 — the m84 registry pins are BUMPED, never weakened", () => {
  const m84 = read(M84_TEST);

  test("the length pin equals the live registry length, in exact-equality shape", () => {
    const title = /CANONICAL_CAPABILITY_KEYS length is exactly (\d+)/.exec(m84);
    const assertion = /expect\(CANONICAL_CAPABILITY_KEYS\.length\)\.toBe\((\d+)\)/.exec(m84);
    expect(title).not.toBeNull();
    expect(assertion).not.toBeNull();
    expect(Number(title![1])).toBe(CANONICAL_CAPABILITY_KEYS.length);
    expect(Number(assertion![1])).toBe(CANONICAL_CAPABILITY_KEYS.length);
  });

  test("the discovered-set pin equals the live registry length, in exact-equality shape", () => {
    const discovered = /expect\(discovered\.size\)\.toBe\((\d+)\)/.exec(m84);
    expect(discovered).not.toBeNull();
    expect(Number(discovered![1])).toBe(CANONICAL_CAPABILITY_KEYS.length);
  });

  test("EXPECTED_SET_A carries the new key", () => {
    expect(m84).toContain(`"${ALLOWLIST_KEY}"`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-STE-482.2 — the merge behaviour is byte-unchanged
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-STE-482.2 — the merge still MERGES; the entry set is unchanged", () => {
  for (const stack of STACKS) {
    test(`${stack}: caller list ∪ canonical, order-preserving, nothing stripped`, () => {
      const canonical = canonicalAllowList(template, stack);
      const caller = [canonical[0]!, "Bash(rg)", "Bash(fd)"];
      const merged = mergeAllowList({ permissions: { allow: caller } }, canonical);
      // Expected computed from the LIVE template — no frozen literal to rot
      // when AC.4 adds a grant to that same file.
      expect(merged.permissions?.allow).toEqual(dedup([...caller, ...canonical]));
    });
  }

  test("caller-only entries survive at their original indices (refutes REPLACE)", () => {
    const canonical = canonicalAllowList(template, "bun");
    const caller = ["Bash(rg)", "Bash(fd)"];
    const merged = mergeAllowList({ permissions: { allow: caller } }, canonical)
      .permissions!.allow!;
    expect(merged.slice(0, 2)).toEqual(caller);
    expect(merged).not.toEqual(canonical);
    expect(merged.length).toBe(caller.length + canonical.length);
  });

  test("non-permissions keys and sibling permissions keys are preserved", () => {
    const canonical = canonicalAllowList(template, "bun");
    const existing: SettingsJson = {
      model: "opus",
      permissions: { allow: ["Bash(rg)"], deny: ["Bash(curl)"] },
    };
    const merged = mergeAllowList(existing, canonical);
    expect(merged.model).toBe("opus");
    expect(merged.permissions?.deny).toEqual(["Bash(curl)"]);
  });

  test("the reporting wrapper's settings are byte-identical to mergeAllowList's", async () => {
    // THE load-bearing AC.2 assertion. Adding the signal must not perturb the
    // artifact by one byte — same object, same key order, same array order.
    const { mergeAllowListReport } = await mergeModule();
    for (const stack of STACKS) {
      const canonical = canonicalAllowList(template, stack);
      for (const existing of [
        {} as SettingsJson,
        { permissions: {} } as SettingsJson,
        { permissions: { allow: [] } } as SettingsJson,
        { permissions: { allow: ["Bash(rg)"], deny: ["Bash(curl)"] } } as SettingsJson,
        { model: "opus", permissions: { allow: [canonical[0]!] } } as SettingsJson,
      ]) {
        const before = JSON.stringify(mergeAllowList(existing, canonical));
        const after = JSON.stringify(mergeAllowListReport(existing, canonical).settings);
        expect(after).toBe(before);
      }
    }
  });

  test("FALSIFIABILITY — the equality above CAN fail (replace-semantics is detected)", () => {
    // Without this, a byte-equality assertion is equally satisfied by two
    // helpers that are both wrong in the same way.
    const canonical = canonicalAllowList(template, "bun");
    const existing: SettingsJson = { permissions: { allow: ["Bash(rg)"] } };
    const replaced = JSON.stringify({ ...existing, permissions: { allow: canonical } });
    expect(JSON.stringify(mergeAllowList(existing, canonical))).not.toBe(replaced);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-STE-482.3 — the QUIET HALF: caller supplied nothing ⇒ still reported
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-STE-482.3 — the caller-supplied-NOTHING path reports the scaffolded count", () => {
  const NO_LIST: Array<[string, SettingsJson]> = [
    ["absent settings object", {}],
    ["settings with no permissions block", { model: "opus" }],
    ["permissions block with no allow key", { permissions: {} }],
    ["permissions.allow present but empty", { permissions: { allow: [] } }],
  ];

  for (const [label, existing] of NO_LIST) {
    test(`${label}: addedCount is the FULL scaffolded count, not 0 and not skipped`, async () => {
      const { mergeAllowListReport } = await mergeModule();
      const canonical = canonicalAllowList(template, "bun");
      const report = mergeAllowListReport(existing, canonical);
      expect({
        callerCount: report.callerCount,
        addedCount: report.addedCount,
        mergedCount: report.mergedCount,
      }).toEqual({
        callerCount: 0,
        addedCount: canonical.length,
        mergedCount: canonical.length,
      });
    });

    test(`${label}: a row is still RENDERED (silence is the defect)`, async () => {
      const { mergeAllowListReport } = await mergeModule();
      const canonical = canonicalAllowList(template, "bun");
      const report = mergeAllowListReport(existing, canonical);
      expect(report.row.length).toBeGreaterThan(0);
      expect(report.row).toContain(ALLOWLIST_KEY);
      expect(report.row).toMatch(new RegExp(`\\b${canonical.length}\\b`));
    });
  }

  test("the zero-added path is reported too — never a silent skip", async () => {
    // The other quiet half. A caller who already listed everything gets a row
    // saying so, rather than a run that says nothing and reads as "no merge
    // happened, or the reporting is broken — indistinguishable".
    const { mergeAllowListReport } = await mergeModule();
    const canonical = canonicalAllowList(template, "bun");
    const report = mergeAllowListReport({ permissions: { allow: [...canonical] } }, canonical);
    expect(report.addedCount).toBe(0);
    expect(report.row.length).toBeGreaterThan(0);
    expect(report.row).toContain(ALLOWLIST_KEY);
    expect(report.row).toMatch(/\b0\b/);
  });

  test("the § 7 prose covers the no-caller-list path explicitly", () => {
    // Prose vacuity fence for the quiet half: a row that only describes the
    // caller-supplied-a-list case leaves the fresh-scaffold run undocumented,
    // which is exactly the shape this AC exists to close.
    const map = specWriteStep7Map(read(SPEC_WRITE_SKILL));
    const row = map
      .split("\n")
      .find((l) => l.includes(`\`${ALLOWLIST_KEY}\``) && l.trimStart().startsWith("|"));
    expect(row).toBeDefined();

    // SCOPED to this key's own segment of the row. The row is shared with the
    // `tracker_config_*` keys, and a row-wide alternation was satisfied by
    // THEIR pre-existing prose ("already matches the fresh proposal") — the
    // whole quiet-half sentence could be deleted and this stayed green. A
    // perfect pin on the wrong subject is worth nothing, so the search window
    // starts at `allowlist_entries_added:` and the needles below appear
    // nowhere else in the row.
    const segment = row!.slice(row!.indexOf("allowlist_entries_added:"));
    expect(segment.length).toBeGreaterThan(80);
    expect(segment).toContain("no pre-existing list");
    expect(segment).toContain("full scaffolded count");
    expect(segment).toMatch(/\bzero\b/i);
    expect(segment).toMatch(/no skip branch/i);

    // Falsifiability: the needles are absent from the rest of the row, so a
    // pass here cannot be borrowed from a sibling key's prose again.
    const rest = row!.slice(0, row!.indexOf("allowlist_entries_added:"));
    expect(rest).not.toContain("no pre-existing list");
    expect(rest).not.toContain("full scaffolded count");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-STE-482.4 — the compound commit invocation forms are granted
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Documented rule semantics, re-implemented here because there is no shipped
 * classifier to call:
 *   `Bash(x:*)`  → prefix rule: matches `x` and anything starting `x `.
 *   `Bash(x)`    → exact match only.
 *   `Bash(x *)`  → the INERT glob shape. Covers nothing; the harness denies it.
 */
function ruleCovers(rule: string, command: string): boolean {
  const m = /^Bash\((.*)\)$/.exec(rule);
  if (!m) return false;
  const spec = m[1]!;
  if (/\s\*$/.test(spec)) return false; // inert glob — grants nothing
  if (spec.endsWith(":*")) {
    const prefix = spec.slice(0, -2);
    return command === prefix || command.startsWith(`${prefix} `);
  }
  return command === spec;
}

/**
 * Decompose a shell invocation the way a compound command is checked: strip
 * heredoc bodies, then split on the operators that separate independently
 * classified commands.
 */
function componentsOf(invocation: string): string[] {
  const head = invocation.split("\n")[0]!;
  const withoutHeredoc = head.replace(/<<-?\s*['"]?\w+['"]?/g, "").replace(/\s+/g, " ").trim();
  return withoutHeredoc
    .split(/\s*(?:&&|\|\||;|\|)\s*/)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
}

/** Components with no covering entry anywhere in the shipped template. */
function denialsFor(invocation: string): string[] {
  const entries = allTemplateEntries(template);
  return componentsOf(invocation).filter(
    (component) => !entries.some((rule) => ruleCovers(rule, component)),
  );
}

const HEREDOC_FORM = "git commit -F - <<'EOF'\nchore(x): y\n\nRefs: STE-0\nEOF";
const CHAINED_FORM = "git commit -F - && echo committed && git log -1 --oneline";

describe("AC-STE-482.4 — templates/permissions.json grants both compound commit forms", () => {
  test("PRECONDITION — templates/permissions.json is the file /setup actually reads", () => {
    // The trap this pin exists for: `templates/settings.json` also carries a
    // `permissions.allow` array and is NOT what step 6 composes from. A grant
    // added to the wrong file would ship and change nothing.
    const section = skillSection(read(SETUP_SKILL), "### 6. Configure settings");
    expect(section).toContain("templates/permissions.json");
    expect(section).not.toContain("templates/settings.json");
    expect(read(SETTINGS_TEMPLATE_PATH)).toContain("permissions");
  });

  test("the heredoc commit form records zero denials", () => {
    expect(denialsFor(HEREDOC_FORM)).toEqual([]);
  });

  test("the &&-chained commit form records zero denials", () => {
    expect(denialsFor(CHAINED_FORM)).toEqual([]);
  });

  test("the commit component is covered by a PREFIX rule, not an exact rule", () => {
    // `git commit -F -` carries arguments, so only a `:*` rule can reach it.
    // An exact `Bash(git commit)` looks like a grant and covers nothing here —
    // the same shape as the inert `Bash(git *)` trap, one level down.
    const entries = allTemplateEntries(template);
    const covering = entries.filter((r) => ruleCovers(r, "git commit -F -"));
    expect(covering.length).toBeGreaterThan(0);
    for (const rule of covering) expect(rule).toMatch(/:\*\)$/);
  });

  test("no inert glob-shaped entry was introduced anywhere in the template", () => {
    for (const rule of allTemplateEntries(template)) {
      expect(rule).not.toMatch(/ \*\)$/);
    }
  });

  test("FALSIFIABILITY — the coverage predicate rejects what it must reject", () => {
    // Without these, an empty denial list is equally produced by a predicate
    // that says yes to everything.
    expect(ruleCovers("Bash(git *)", "git commit -F -")).toBe(false); // inert glob
    expect(ruleCovers("Bash(git commit)", "git commit -F -")).toBe(false); // exact ≠ argumented
    expect(ruleCovers("Bash(git commit)", "git commit")).toBe(true);
    expect(ruleCovers("Bash(git commit:*)", "git commit -F -")).toBe(true);
    expect(ruleCovers("Bash(git commit:*)", "git push")).toBe(false);
    expect(denialsFor("definitely-not-granted --wat")).toEqual(["definitely-not-granted --wat"]);
  });

  test("FALSIFIABILITY — the decomposition really sees every component", () => {
    expect(componentsOf(CHAINED_FORM)).toEqual([
      "git commit -F -",
      "echo committed",
      "git log -1 --oneline",
    ]);
    expect(componentsOf(HEREDOC_FORM)).toEqual(["git commit -F -"]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-STE-482.5 — the Notes record that stops the re-filing
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-STE-482.5 — Notes record the merge as intended, with three confirmations", () => {
  test("the record lives in ## Notes, not only in ## Technical Design", () => {
    // Placement is the whole point. A triager who re-files this reads the FR's
    // Notes; a fact parked in Technical Design does not reach them.
    const notes = frNotes();
    expect(notes).toMatch(/intended|by design/i);
    expect(notes).toMatch(/three|3 (independent )?confirmations|third/i);
  });

  test("all three confirmation dates are named", () => {
    const notes = frNotes();
    for (const date of ["2026-07-20", "2026-07-27", "2026-08-16"]) {
      expect(notes).toContain(date);
    }
  });

  test("the record says what it is FOR — stop re-filing it as a defect", () => {
    expect(frNotes()).toMatch(/re-fil|refil|not a (defect|bug)|stop being (re-)?filed/i);
  });

  test("the record does NOT authorise suppressing the merge", () => {
    // Counter-pin. The operator's decision was keep-and-signal; a Notes edit
    // that drifted toward "revert the merge" would contradict the FR's own
    // Requirement and re-open the disposition this AC exists to close.
    expect(frNotes()).not.toMatch(/revert the merge|suppress the merge|stop merging/i);
  });
});
