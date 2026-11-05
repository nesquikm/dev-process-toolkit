// STE-713 — docs and test pins follow settings to their new home.
//
// AC map:
//   AC-.4 "AC-.4 config-home scan ..." + "AC-.4 control: ..."
//         No line in docs/*.md, skills/*/SKILL.md, adapters/*.md or agents/*.md names CLAUDE.md
//         together with a moved heading as where a setting lives, unless the same line says
//         legacy or names the settings file. The scan is line-scoped with a legacy escape
//         (Technical Design). The only other exemption is the tracker-mode probe step of the
//         mode-aware skills, which AC-STE-708.1 pins byte-identical to trunk dbdb9572 by operator
//         ruling 2026-11-04; those lines are listed here as literals, never as a pattern.
//   AC-.5 "AC-.5 sweep ..." + "AC-.5 control: ..."
//   AC-.7 "AC-.7 hook count pins ..."
//   AC-.8 "AC-.8 ..."
//
// Literals were read with `git show dbdb9572:<path>` while this test was written.
// All ids are synthetic.

import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

const PLUGIN = resolve(import.meta.dir, "..");
const TESTS = join(PLUGIN, "tests");

const tmpRoots: string[] = [];
function tmp(label: string): string {
  const d = mkdtempSync(join(tmpdir(), `ste713-${label}-`));
  tmpRoots.push(d);
  return d;
}
afterAll(() => {
  for (const d of tmpRoots) rmSync(d, { recursive: true, force: true });
});

/** The CLAUDE.md headings whose sections moved into `specs/settings.yaml` (STE-706). */
const MOVED_HEADINGS = ["## Task Tracking", "## Verification", "## Docs", "## Orchestration", "## Token Stats", "## Release Files"] as const;

// ---------------------------------------------------------------------------
// AC-STE-713.4 — config-home scan
// ---------------------------------------------------------------------------

/** Words that may follow a heading and still name THE heading (`## Docs section`), not another one (`## Verification evidence`). */
const HEADING_NOUNS = new Set(["section", "sections", "heading", "headings", "block", "blocks", "sub-section", "subsection", "span", "key", "keys"]);

/** True when `line` names one of the moved headings (exactly, not a longer heading that starts with it). */
function namesMovedHeading(line: string): boolean {
  for (const h of MOVED_HEADINGS) {
    let i = line.indexOf(h);
    while (i >= 0) {
      const rest = line.slice(i + h.length);
      if (!/^[A-Za-z0-9_]/.test(rest)) {
        const word = /^ ([a-z][a-z-]*)/.exec(rest);
        if (!word || HEADING_NOUNS.has(word[1]!)) return true;
      }
      i = line.indexOf(h, i + 1);
    }
  }
  return false;
}

/** The legacy escape: the same line says legacy or names the settings file. */
function escapes(line: string): boolean {
  return /legacy/i.test(line) || line.includes("specs/settings.yaml") || /settings file/i.test(line);
}

/**
 * The tracker-mode probe steps pinned byte-identical to dbdb9572 by AC-STE-708.1 (operator
 * ruling 2026-11-04: through 3.x the skills keep the prose read; on a settings-file tree the
 * heading it reads is the generated binding stub). Exact lines, not a pattern.
 */
const PINNED_PROBE_STEPS: readonly string[] = [
  "Before any detection or setup, run the Schema L probe (see `docs/patterns.md` § Tracker Mode Probe). When `$ARGUMENTS` contains `--resume-tracker-binding`, route to the workspace-binding resume/repoint contract in `docs/setup-reference.md` § 0c — `bun run ${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/repoint_tracker_binding.ts`, then step 7f, then that command's `--verify` — whose preconditions follow it — regardless of `## Task Tracking` presence and regardless of the mode the probe reports; that flag re-points an existing binding at a new tracker container, and it is a different instrument from the mode-switch flags of § 0b, which change tracker MODE, refuse a same-mode no-op, and skip steps 1–8. If `CLAUDE.md` already exists and contains a `## Task Tracking` section, this is an existing tracker-mode project — § 0b is the entry point for changing MODE, and the repoint flag above is the entry point for changing CONTAINER. If `CLAUDE.md` is absent, empty of `## Task Tracking`, or `$ARGUMENTS` contains `new` — and `$ARGUMENTS` contains neither mode-switch flag named in the § 0b heading — run the normal fresh-setup flow below. When either § 0b mode-switch flag is present, section 0b overrides this routing regardless of `## Task Tracking` presence. When `$ARGUMENTS` contains `--template <path>`, dispatch to the `setup-template` child skill at `skills/setup-template/SKILL.md` (template-source reuse flow) before the normal fresh-setup steps.",
  "- **Tracker-mode probe** — Run the Schema L probe (see `docs/patterns.md` § Tracker Mode Probe). If `CLAUDE.md` has no `## Task Tracking` section, mode is `none`. If a tracker mode is active:",
  "   - **0.f Tracker-mode probe** — Run the Schema L probe (see `docs/patterns.md` § Tracker Mode Probe). If `CLAUDE.md` has no `## Task Tracking` section, mode is `none` and tracker hooks below skip. If a tracker mode is active:",
  "Before creating the PR, run the Schema L probe (see `docs/patterns.md` § Tracker Mode Probe). If `CLAUDE.md` has no `## Task Tracking` section, mode is `none` and the rest of this skill runs unchanged. If a tracker mode is active:",
  "   - Run the Schema L probe (see `docs/patterns.md` § Tracker Mode Probe). If `CLAUDE.md` has no `## Task Tracking` section, mode is `none` and ACs are read from `specs/frs/*.md`. If a tracker mode is active, AC traversal pulls the canonical AC list from the active adapter's `pull_acs(ticket_id)` instead of parsing local specs; local `specs/` still provides FR titles, descriptions, and traceability context (Path B). See `docs/spec-review-tracker-mode.md` for the full tracker-mode flow.",
  "- **Tracker-mode probe** — Run the Schema L probe (see `docs/patterns.md` § Tracker Mode Probe). If `CLAUDE.md` has no `## Task Tracking` section, mode is `none`. Tracker-mode `/spec-archive` still operates only on local `specs/` content — archival of completed **tracker tickets** is the tracker's own concern.",
  "- **Tracker Mode Probe** — Before running any commands, run the Schema L probe (see `docs/patterns.md` § Tracker Mode Probe). If `CLAUDE.md` has no `## Task Tracking` section, mode is `none` and tracker-mode hooks skip. If a tracker mode is active:",
];

/** The scanned files under `root` (a plugin root or a copy of one), relative to it. */
function scannedFiles(root: string): string[] {
  const out: string[] = [];
  for (const d of ["docs", "adapters", "agents"]) {
    const dir = join(root, d);
    if (!existsSync(dir)) continue;
    for (const n of readdirSync(dir)) if (n.endsWith(".md") && statSync(join(dir, n)).isFile()) out.push(join(d, n));
  }
  const skills = join(root, "skills");
  for (const s of readdirSync(skills)) if (existsSync(join(skills, s, "SKILL.md"))) out.push(join("skills", s, "SKILL.md"));
  return out.sort();
}

// Orchestrator ruling (2026-11-05): skills/ship-milestone/SKILL.md is frozen by AC-STE-618.8
// (only its pinned lines may change against the freeze base), and the operator's pre-granted
// re-base covers the gate-check edit alone. Its three legacy-home lines stay as written and are
// exempt here by exact literal; the drift is reported to the operator as a follow-up.
const FROZEN_SHIP_MILESTONE_LINES: readonly string[] = [
  "Ship one completed milestone as a single, reviewed release commit. Dogfoods the Release Checklist in `CLAUDE.md`: every file listed in the host's `## Release Files` block is rewritten by this ceremony, so a partial update is a missing entry in that block rather than a step somebody forgot. A release surface absent from the block \u2014 `specs/requirements.md`'s `Latest shipped release:` line was one until it was added to the block \u2014 is maintained by hand and goes stale.",
  "It reads the host project's `## Release Files` block from `CLAUDE.md` via `parseReleaseFiles(content)`, computes each listed path's new content, and prints one line per path it would rewrite. Every refusal \u2014 block absent, version missing, a `changelog` entry with no `--test-count` \u2014 writes the NFR-10 canonical shape to stderr, exits non-zero, and leaves the tree untouched; the preview refuses whatever the real run refuses, with the same verdict, so an approved diff is never one the write step then rejects. The counts are FORWARDED on `--test-count`, never re-measured at the write step: detection answers differently per directory, and the pre-flight test-gate run (refusal #3) already measured them against the root the gate ran in. The block declares every path that gets rewritten on this release; no path is hard-coded in this skill body. Schema reference + per-kind worked examples live in `docs/ship-milestone-reference.md` \u00a7 Release Files block schema.",
  "Refusals: `MissingReleaseFilesBlockError` (block absent or empty) and `MalformedReleaseFilesError` (entry violates schema, e.g. regex without `(?<version>)` named group) both abort the run with the canonical NFR-10 shape on stderr and exit non-zero. Verdict line first \u2014 `Refusing: to rewrite the release files \u2014 <what failed>.` \u2014 then Remedy: fix the `## Release Files` block in CLAUDE.md (or the offending file) and re-run; nothing was written. \u2014 then Context: root=`<projectRoot>`, version=`<X.Y.Z>`, skill=ship-milestone. The remedy names the block to fix and reports what reached disk; it does not send the operator to `/setup`.",
];

function configHomeViolations(root: string): string[] {
  const out: string[] = [];
  for (const rel of scannedFiles(root)) {
    readFileSync(join(root, rel), "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (!line.includes("CLAUDE.md") || !namesMovedHeading(line)) return;
        if (escapes(line) || PINNED_PROBE_STEPS.includes(line) || FROZEN_SHIP_MILESTONE_LINES.includes(line)) return;
        out.push(`${rel}:${i + 1}`);
      });
  }
  return out;
}

describe("AC-STE-713.4 config-home scan", () => {
  test("AC-.4 config-home scan: no doc, skill, adapter or agent line names CLAUDE.md with a moved heading as a settings home without legacy or the settings file", () => {
    expect(configHomeViolations(PLUGIN)).toEqual([]);
  });

  test("AC-.4 the frozen ship-milestone exemptions are still that skill's own lines (the exemption cannot outlive the freeze)", () => {
    const sm = readFileSync(join(PLUGIN, "skills/ship-milestone/SKILL.md"), "utf8").split("\n");
    for (const l of FROZEN_SHIP_MILESTONE_LINES) expect(sm).toContain(l);
  });

  test("AC-.4 the pinned probe-step exemptions are still the skills' own lines (the exemption cannot outlive its pin)", () => {
    const all = ["setup", "spec-write", "implement", "pr", "spec-review", "spec-archive", "gate-check"].flatMap((s) =>
      readFileSync(join(PLUGIN, "skills", s, "SKILL.md"), "utf8").split("\n"),
    );
    for (const l of PINNED_PROBE_STEPS) expect(all).toContain(l);
  });

  test("AC-.4 heading matcher: names the moved heading, not a longer heading that starts with it", () => {
    expect(namesMovedHeading("the `## Docs` section of CLAUDE.md")).toBe(true);
    expect(namesMovedHeading("CLAUDE.md `## Documentation`")).toBe(false);
    expect(namesMovedHeading("CLAUDE.md ## Verification evidence block")).toBe(false);
    expect(namesMovedHeading("CLAUDE.md ## Verification section")).toBe(true);
  });

  test("AC-.4 control: a planted line in a temporary copy turns the scan red; the legacy escape keeps a fallback line green", () => {
    const root = tmp("config-home");
    for (const d of ["docs", "adapters", "agents"]) {
      mkdirSync(join(root, d), { recursive: true });
      for (const n of readdirSync(join(PLUGIN, d))) if (n.endsWith(".md") && statSync(join(PLUGIN, d, n)).isFile()) cpSync(join(PLUGIN, d, n), join(root, d, n));
    }
    for (const s of readdirSync(join(PLUGIN, "skills"))) {
      const p = join(PLUGIN, "skills", s, "SKILL.md");
      if (!existsSync(p)) continue;
      mkdirSync(join(root, "skills", s), { recursive: true });
      cpSync(p, join(root, "skills", s, "SKILL.md"));
    }
    const before = configHomeViolations(root);
    const target = join(root, "docs", "patterns.md");
    writeFileSync(target, `${readFileSync(target, "utf8")}\nSet \`verify_skill\` under \`## Verification\` in CLAUDE.md.\n`);
    const planted = configHomeViolations(root);
    expect(planted.length).toBe(before.length + 1);
    expect(planted.some((v) => v.startsWith("docs/patterns.md:"))).toBe(true);
    writeFileSync(target, `${readFileSync(target, "utf8")}On a legacy tree, \`verify_skill\` sits under \`## Verification\` in CLAUDE.md.\n`);
    expect(configHomeViolations(root).length).toBe(planted.length);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-713.5 — test pin sweep
// ---------------------------------------------------------------------------

/** Keys that live under a moved heading, as `key:` lines. */
const MOVED_KEYS = [
  "mode",
  "mcp_server",
  "jira_ac_field",
  "branch_template",
  "milestone_scan_fetch",
  "verify_skill",
  "verify_mode",
  "run_cmd",
  "e2e_cmd",
  "user_facing_mode",
  "packages_mode",
  "changelog_ci_owned",
  "changelog_unversioned",
  "default_effort",
  "merge_policy",
  "enabled",
  "team",
  "project",
];
const SWEEP_HEADINGS = [...MOVED_HEADINGS, "### Linear", "### Jira"];

const TEMPLATE_SOURCE = /CLAUDE\.md\.template/;
const REPO_CLAUDE_SOURCE = /(?:REPO_ROOT|repoRoot|\bREPO\b)\s*,\s*"CLAUDE\.md"|"\.\.\/\.\.\/CLAUDE\.md"/;

function esc(s: string): string {
  return s.replace(/[$]/g, "\\$");
}

function namesHeadingOrKey(text: string, keys: boolean): boolean {
  const flat = text.replace(/\\s[+*]?|\\ /g, " ");
  if (SWEEP_HEADINGS.some((h) => new RegExp(`${esc(h)}(?![A-Za-z])`).test(flat))) return true;
  return keys && MOVED_KEYS.some((k) => new RegExp(`(?<![\\w])${k}:`).test(text));
}

/**
 * Lines of one test file that assert a moved heading (or, for the repository's own CLAUDE.md,
 * a moved heading or key line) on text read from `source`. A value is tainted when its
 * initializer names the source, reads a tainted path, or is a string derived from a tainted
 * value (`x.slice(...)`, `x.split(...)`). A positive `expect(<tainted>).toContain|toMatch(<needle>)`,
 * or a `.exec(<tainted>)` whose pattern names a needle, is a hit; `.not.` assertions are not.
 */
function sweepHits(text: string, source: RegExp, keys: boolean): string[] {
  const lines = text.split("\n");
  const tainted = new Set<string>();
  const ref = (id: string) => new RegExp(`(?<![\\w$.])${esc(id)}(?![\\w$])`);
  const mentions = (s: string) => source.test(s) || [...tainted].some((t) => ref(t).test(s));
  const derives = (init: string) =>
    source.test(init) ||
    [...tainted].some(
      (t) =>
        new RegExp(`^(?:await\\s+)?${esc(t)}\\b(?!\\s*\\()`).test(init.trim()) ||
        new RegExp(`\\b(?:readFileSync|read|readText)\\(\\s*${esc(t)}\\b`).test(init),
    );
  let grew = true;
  while (grew) {
    grew = false;
    for (const l of lines) {
      const m = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(.*)$/.exec(l);
      if (!m || tainted.has(m[1]!)) continue;
      if (derives(m[2]!)) {
        tainted.add(m[1]!);
        grew = true;
      }
    }
  }
  const out: string[] = [];
  lines.forEach((l, i) => {
    const e = /expect\((.*?)\)\s*\.(toContain|toMatch)\((.*)$/.exec(l);
    if (e && !/\.not\./.test(l) && mentions(e[1]!) && namesHeadingOrKey(e[3]!, keys)) out.push(`${i + 1}: ${l.trim()}`);
    const x = /\.exec\(([^)]*)\)/.exec(l);
    if (keys && x && mentions(x[1]!) && namesHeadingOrKey(l.slice(0, l.indexOf(".exec(")), keys)) out.push(`${i + 1}: ${l.trim()}`);
  });
  return out;
}

function testFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) {
        if (n !== "fixtures") walk(p);
      } else if (n.endsWith(".test.ts")) out.push(p);
    }
  };
  walk(dir);
  return out.sort();
}

function pinSweep(dir: string): { template: string[]; repoClaudeMd: string[] } {
  const self = new Set([
    join(TESTS, "m_94e6f7-ste-713-config-home.test.ts"),
    join(TESTS, "m_94e6f7-defaults-unchanged.test.ts"),
  ]);
  const template: string[] = [];
  const repoClaudeMd: string[] = [];
  for (const f of testFiles(dir)) {
    if (self.has(f)) continue;
    const text = readFileSync(f, "utf8");
    const rel = relative(dir, f);
    for (const h of sweepHits(text, TEMPLATE_SOURCE, false)) template.push(`${rel}:${h}`);
    for (const h of sweepHits(text, REPO_CLAUDE_SOURCE, true)) repoClaudeMd.push(`${rel}:${h}`);
  }
  return { template, repoClaudeMd };
}

describe("AC-STE-713.5 test pin sweep", () => {
  const sweep = pinSweep(TESTS);

  test("AC-.5 sweep: no test reads templates/CLAUDE.md.template and asserts a moved heading is present in it", () => {
    expect(sweep.template).toEqual([]);
  });

  test("AC-.5 sweep: no test reads this repository's own CLAUDE.md and asserts a moved heading or key there", () => {
    expect(sweep.repoClaudeMd).toEqual([]);
  });

  test("AC-.5 control: a planted template pin and a planted repo CLAUDE.md pin are both found; .not. pins are not", () => {
    const dir = tmp("sweep");
    writeFileSync(
      join(dir, "planted-template.test.ts"),
      [
        'const TEMPLATE = join(PLUGIN, "templates", "CLAUDE.md.template");',
        "const tpl = readFileSync(TEMPLATE, \"utf8\");",
        'expect(tpl).toContain("## Task Tracking");',
        'expect(tpl).not.toContain("## Docs");',
      ].join("\n"),
    );
    writeFileSync(
      join(dir, "planted-repo.test.ts"),
      [
        'const md = readFileSync(join(REPO_ROOT, "CLAUDE.md"), "utf8");',
        "const block = md.slice(md.indexOf(\"x\"));",
        "expect(block).toMatch(/^## Release Files$/m);",
        "const skill = /^verify_skill:\\s*(\\S+)$/m.exec(md)?.[1];",
        'expect(md).not.toMatch(/^## Docs$/m);',
      ].join("\n"),
    );
    const s = pinSweep(dir);
    expect(s.template).toEqual(['planted-template.test.ts:3: expect(tpl).toContain("## Task Tracking");']);
    expect(s.repoClaudeMd).toEqual([
      "planted-repo.test.ts:3: expect(block).toMatch(/^## Release Files$/m);",
      "planted-repo.test.ts:4: const skill = /^verify_skill:\\s*(\\S+)$/m.exec(md)?.[1];",
    ]);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-713.7 — hook count pins unchanged (M1 adds no hook)
// ---------------------------------------------------------------------------

/** The count pins of tests/bundled-hooks-shape.test.ts at dbdb9572. */
const BUNDLED_HOOK_COUNT_PINS: readonly string[] = [
  "    expect(pre.length + ups.length).toBe(5);",
  "    expect(pre.length).toBe(4);",
  "    expect(bash.length).toBe(3);",
  "    expect(other.length).toBe(1);",
  "    expect(ups.length).toBe(1);",
];
/** The hook-count sentences of docs/hooks-reference.md at dbdb9572. */
const HOOKS_REFERENCE_COUNT_PINS: readonly string[] = [
  "The 6 hooks fire across every project where the `dev-process-toolkit` plugin is enabled at user scope.",
  "to stop all 6 hooks from firing.",
];
const HOOKS_JSON_COMMANDS_AT_TRUNK = 7;

describe("AC-STE-713.7 hook count pins", () => {
  test("AC-.7 hook count pins in tests/bundled-hooks-shape.test.ts are unchanged", () => {
    const lines = readFileSync(join(TESTS, "bundled-hooks-shape.test.ts"), "utf8").split("\n");
    for (const pin of BUNDLED_HOOK_COUNT_PINS) expect(lines).toContain(pin);
  });

  test("AC-.7 hook count sentences in docs/hooks-reference.md are unchanged", () => {
    const doc = readFileSync(join(PLUGIN, "docs", "hooks-reference.md"), "utf8");
    for (const pin of HOOKS_REFERENCE_COUNT_PINS) expect(doc).toContain(pin);
  });

  test("AC-.7 hooks/hooks.json registers the same number of hook commands as trunk", () => {
    const hooks = JSON.parse(readFileSync(join(PLUGIN, "hooks", "hooks.json"), "utf8")).hooks as Record<string, { hooks: unknown[] }[]>;
    const n = Object.values(hooks).flatMap((entries) => entries.flatMap((e) => e.hooks)).length;
    expect(n).toBe(HOOKS_JSON_COMMANDS_AT_TRUNK);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-713.8 — NFR-1 cap
// ---------------------------------------------------------------------------

const SKILL_LINE_CAP_AT_TRUNK = 358;

describe("AC-STE-713.8 NFR-1 cap", () => {
  test("AC-.8 SKILL_LINE_CAP in tests/skill-nfr-1-length.test.ts is not raised", () => {
    const m = /const SKILL_LINE_CAP = (\d+);/.exec(readFileSync(join(TESTS, "skill-nfr-1-length.test.ts"), "utf8"));
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(SKILL_LINE_CAP_AT_TRUNK);
  });

  test("AC-.8 every SKILL.md the config-home rewrite touches stays within the cap", () => {
    for (const s of ["deliver", "docs", "gate-check", "implement", "pr", "setup", "ship-milestone", "spec-archive", "spec-review", "spec-write", "upgrade", "visual-check"]) {
      const n = readFileSync(join(PLUGIN, "skills", s, "SKILL.md"), "utf8").split("\n").length;
      expect({ s, withinCap: n <= SKILL_LINE_CAP_AT_TRUNK }).toEqual({ s, withinCap: true });
    }
  });
});
