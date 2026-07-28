import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { permissionShapes } from "../adapters/_shared/src/migrations/entries/permission_shapes";
import { runSetupPermissionsShapeProbe } from "../adapters/_shared/src/setup_permissions_shape";
import { runSpawnPatternAllowlistProbe } from "../adapters/_shared/src/spawn_pattern_allowlist";
import { canonicalBranchTemplate } from "../adapters/_shared/src/branch_proposal";

// M117 STE-426 — "Refresh the driver scaffold snippet and stale documented
// defaults".
//
// The /smoke-test driver's Phase 1 step 6 scaffold heredoc
// (`cat > .claude/settings.json <<'EOF'`) is the allow-list every
// `claude -p` grandchild runs under. It drifted from the tracked
// `.claude/settings.json` in three independent ways:
//
//   1. it carries only Bash command patterns — no file-tool surface
//      (Edit/Write/Read/Grep/Glob) and neither MCP family — even though the
//      skill's own threat model rail 1 and the Allowlist matrix state that
//      union as the enforcement contract (AC-STE-426.1);
//   2. NINE of its ten entries are glob-shaped (`Bash(rm *)`), which the
//      harness denies outright and which two gate probes flag on every run —
//      #35 `setup_permissions_shape` as a shape advisory, #69
//      `upgrade_staleness` via the `permission-shapes` migration entry. The
//      tenth, `Bash(claude:*)`, was always prefix-shaped and always granted
//      (AC-STE-426.2);
//   3. the documented `## Task Tracking` block in the same step still shows
//      the pre-M106 ticket-keyed branch template (AC-STE-426.3).
//
// AC-STE-426.4 is the guard against re-drift: the snippet's tool-surface
// union is pinned to the TRACKED `.claude/settings.json`, not to a second
// hand-written constant in a test file.
//
// Deliberately NOT asserted (per the FR's own Technical Design): that the
// `permission-shapes` migration should be APPLIED to the snippet. Applying it
// drops `Bash(rm *)` / `Bash(mv *)` / `Bash(cp *)` and narrows git/gh to
// read-only subcommands, which would break Phase 5 teardown and /implement's
// commits. The clearance is a SHAPE change; the effective grant must survive,
// and § "effective permissions survive the shape change" pins exactly that.

const repoRoot = join(import.meta.dir, "..", "..", "..");
const smokeSkillPath = join(repoRoot, ".claude", "skills", "smoke-test", "SKILL.md");
const trackedSettingsPath = join(repoRoot, ".claude", "settings.json");

function readIfPresent(path: string): string | null {
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8");
}

const skill = readIfPresent(smokeSkillPath);
const trackedRaw = readIfPresent(trackedSettingsPath);

// Project-local surfaces: consumer repos ship neither file, so every suite
// here is skipped rather than failed when they are absent.
const describeSkill = skill === null ? describe.skip : describe;
const describeBoth = skill === null || trackedRaw === null ? describe.skip : describe;

// ---------------------------------------------------------------------------
// Prose-scoping helpers (shape borrowed from
// tests/smoke-driver-m96-verified-wipe-freshness.test.ts) — assertions are
// scoped to a section or a paragraph so two unrelated sentences elsewhere in a
// 1400-line SKILL.md cannot satisfy them.
// ---------------------------------------------------------------------------

function sectionSlice(body: string, startMarker: string, endMarker: string): string {
  const start = body.indexOf(startMarker);
  if (start === -1) return "";
  const end = body.indexOf(endMarker, start);
  return end === -1 ? body.slice(start) : body.slice(start, end);
}

function someParagraphMatches(body: string, patterns: RegExp[]): boolean {
  return body
    .split(/\n\n+/)
    .some((paragraph) => patterns.every((re) => re.test(paragraph)));
}

/** Phase 1 step 6 — the sensitive-file pre-creation step, up to step 6b. */
function step6Slice(body: string): string {
  return sectionSlice(
    body,
    "6. **Pre-create the sensitive files",
    "6b. **Workspace trust",
  );
}

/** § Threat model rail 1 — the allow-list enforcement-union paragraph. */
function threatModelRail1(body: string): string {
  const threatModel = sectionSlice(
    body,
    "## Threat model",
    "What this does NOT protect against",
  );
  // The rails are a numbered list with no blank lines between items, so split
  // on the list markers rather than on paragraph breaks — otherwise rail 6's
  // Jira prose (`DST`, `Done`) leaks into rail 1's token set.
  return (
    threatModel
      .split(/\n(?=\d+\.\s+\*\*)/)
      .find((rail) => /^1\.\s+\*\*Tracked/.test(rail.trim())) ?? ""
  );
}

/** § Allowlist matrix — the informational per-skill tool table. */
function allowlistMatrixSlice(body: string): string {
  return sectionSlice(body, "## Allowlist matrix (informational)", "## Output");
}

// ---------------------------------------------------------------------------
// Scaffold-heredoc extraction. Uses probe #62's own opener regex so this test
// and `spawn_pattern_allowlist` can never disagree about what "the scaffold
// heredoc" is.
// ---------------------------------------------------------------------------

const HEREDOC_OPENER_RE = /\bcat\s*>\s*\.claude\/settings\.json\s*<<\s*'?EOF'?/;

interface Heredoc {
  openerLine: number; // 1-based
  body: string;
  linesBeforeTerminator: string[];
}

function extractSettingsHeredocs(content: string): Heredoc[] {
  const lines = content.split("\n");
  const out: Heredoc[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!HEREDOC_OPENER_RE.test(lines[i]!)) continue;
    const body: string[] = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      if (lines[j]!.trim() === "EOF") break;
      body.push(lines[j]!);
    }
    out.push({
      openerLine: i + 1,
      body: body.join("\n"),
      linesBeforeTerminator: [...body],
    });
    i = j;
  }
  return out;
}

/** The one scaffold heredoc, or a hard failure naming what was found instead. */
function theScaffoldHeredoc(): Heredoc {
  const heredocs = extractSettingsHeredocs(skill!);
  expect(heredocs.map((h) => h.openerLine)).toHaveLength(1);
  return heredocs[0]!;
}

function scaffoldAllow(): string[] {
  const parsed = JSON.parse(theScaffoldHeredoc().body) as {
    permissions?: { allow?: unknown };
  };
  const allow = parsed.permissions?.allow;
  expect(Array.isArray(allow)).toBe(true);
  return (allow as string[]).map((entry) => entry.trim());
}

function trackedAllow(): string[] {
  const parsed = JSON.parse(trackedRaw!) as { permissions?: { allow?: unknown } };
  const allow = parsed.permissions?.allow;
  expect(Array.isArray(allow)).toBe(true);
  return (allow as string[]).map((entry) => entry.trim());
}

/** Entries that are NOT Bash command patterns — the file tools + MCP families. */
function nonBashSurface(allow: string[]): string[] {
  return [...new Set(allow.filter((entry) => !entry.startsWith("Bash(")))].sort();
}

// ---------------------------------------------------------------------------
// Permission-rule matcher. Mirrors Claude Code's Bash rule semantics closely
// enough for these fixtures:
//   • `Bash(<prefix>:*)` matches `<prefix>` and anything starting `<prefix> `;
//   • `Bash(<exact>)`    matches only that exact command;
//   • `Bash(<cmd> *)`    is the RETIRED glob shape — the harness denies it, so
//     it grants nothing. This is why the shape change is not cosmetic: the NINE
//     glob entries the pre-STE-426 snippet carried authorized zero commands.
//     Not all ten — `Bash(claude:*)` was prefix-shaped, which is the only
//     reason probe #62's spawn fence was ever live.
// ---------------------------------------------------------------------------

/** The retired glob shape: whitespace-then-asterisk (probe #35's grammar). */
const GLOB_SHAPED_RE = /^Bash\([^)]*\s\*\)$/;

function bashPatternMatches(pattern: string, command: string): boolean {
  if (GLOB_SHAPED_RE.test(pattern)) return false;
  const m = pattern.match(/^Bash\((.*)\)$/);
  if (!m) return false;
  const inner = m[1]!;
  if (inner.endsWith(":*")) {
    const prefix = inner.slice(0, -2);
    return command === prefix || command.startsWith(`${prefix} `);
  }
  return command === inner;
}

function grants(allow: string[], command: string): boolean {
  return allow.some((entry) => bashPatternMatches(entry, command));
}

function deniedCommands(allow: string[], commands: string[]): string[] {
  return commands.filter((command) => !grants(allow, command));
}

// ---------------------------------------------------------------------------
// Matcher self-check — keeps the fixtures above honest.
// ---------------------------------------------------------------------------

describe("matcher self-check — colon rules grant, glob rules do not", () => {
  test("Bash(rm:*) grants `rm -rf x` while the retired Bash(rm *) grants nothing", () => {
    expect(bashPatternMatches("Bash(rm:*)", "rm -rf x")).toBe(true);
    expect(bashPatternMatches("Bash(rm *)", "rm -rf x")).toBe(false);
    expect(bashPatternMatches("Bash(claude:*)", 'claude -p "/setup"')).toBe(true);
    expect(bashPatternMatches("Bash(kill)", "kill")).toBe(true);
    expect(bashPatternMatches("Bash(kill)", "kill -9 1")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-426.1 — the snippet covers the tool-surface union the threat model
// and the Allowlist matrix require.
// ---------------------------------------------------------------------------

describeSkill("AC-STE-426.1 — scaffold snippet covers the documented tool-surface union", () => {
  /**
   * The non-Bash surfaces threat-model rail 1 enumerates as the enforcement
   * union: the file tools and the MCP families, read out of the paragraph
   * rather than hard-coded here.
   */
  function railOneToolSurface(): string[] {
    const rail = threatModelRail1(skill!);
    const tokens = [...rail.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);
    return [
      ...new Set(
        tokens.filter((t) => /^(?:[A-Z][A-Za-z]+|mcp__[a-z]+__\*)$/.test(t)),
      ),
    ].sort();
  }

  /**
   * Bash commands the Allowlist matrix says the chain needs, read out of the
   * table's "Bash patterns" column (`\`git *\`` → `git`).
   */
  function matrixBashCommands(): string[] {
    const matrix = allowlistMatrixSlice(skill!);
    const tokens = [...matrix.matchAll(/`([a-z][a-z0-9-]*)\s\*`/g)].map((m) => m[1]!);
    return [...new Set(tokens)].sort();
  }

  test("threat-model rail 1 still states the union this AC is measured against", () => {
    const rail = threatModelRail1(skill!);
    expect(rail).not.toBe("");
    expect(
      someParagraphMatches(rail, [
        /file-tool surface/,
        /`Edit`/,
        /`Glob`/,
        /mcp__linear__\*/,
        /mcp__atlassian__\*/,
      ]),
    ).toBe(true);
    // Floor: five file tools + two MCP families.
    expect(railOneToolSurface().length).toBeGreaterThanOrEqual(7);
  });

  test("the snippet grants every non-Bash surface rail 1 enumerates", () => {
    const allow = scaffoldAllow();
    const required = railOneToolSurface();
    expect(required.length).toBeGreaterThanOrEqual(7);
    expect(required.filter((surface) => !allow.includes(surface))).toEqual([]);
  });

  test("the snippet grants every Bash command the Allowlist matrix lists", () => {
    const allow = scaffoldAllow();
    const commands = matrixBashCommands();
    // Floor guards a broken table parse passing vacuously.
    expect(commands.length).toBeGreaterThanOrEqual(10);
    expect(deniedCommands(allow, commands.map((c) => `${c} x`))).toEqual([]);
  });

  test("the snippet still grants the child-spawn command probe #62 fences", () => {
    expect(grants(scaffoldAllow(), 'claude -p "/dev-process-toolkit:setup"')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-426.2 — a freshly scaffolded test project trips neither probe #35
// nor the `permission-shapes` entry probe #69 reports on.
// ---------------------------------------------------------------------------

describeSkill("AC-STE-426.2 — scaffolded project trips neither shape probe", () => {
  const scaffolded: string[] = [];

  /** A throwaway project root carrying ONLY the snippet's settings.json. */
  function scaffoldProject(): string {
    const root = mkdtempSync(join(tmpdir(), "ste-426-scaffold-"));
    scaffolded.push(root);
    mkdirSync(join(root, ".claude"), { recursive: true });
    // Written verbatim — this is what the driver's heredoc actually emits.
    writeFileSync(join(root, ".claude", "settings.json"), `${theScaffoldHeredoc().body}\n`);
    return root;
  }

  afterAll(() => {
    for (const root of scaffolded) rmSync(root, { recursive: true, force: true });
  });

  test("probe #35 setup_permissions_shape reports zero violations", async () => {
    const report = await runSetupPermissionsShapeProbe(scaffoldProject());
    expect(report.violations.map((v) => v.rule)).toEqual([]);
  });

  test("probe #69's `permission-shapes` entry does not apply to the scaffold", () => {
    // Scoped to this one registry entry by id — probe #69 walks five entries
    // and the other four are out of this FR's scope.
    expect(permissionShapes.id).toBe("permission-shapes");
    const detected = permissionShapes.detect(scaffoldProject());
    expect(detected.evidence).toEqual([]);
    expect(detected.applies).toBe(false);
  });

  test("no snippet entry uses the retired glob shape", () => {
    expect(scaffoldAllow().filter((entry) => GLOB_SHAPED_RE.test(entry))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Effective permissions survive the shape change (FR Technical Design:
// "should not alter what the children are actually permitted to do").
// ---------------------------------------------------------------------------

describeSkill("AC-STE-426.2 — effective permissions survive the shape change", () => {
  test("teardown + commit commands stay permitted (rm/mv/cp, full git, full gh)", () => {
    const allow = scaffoldAllow();
    expect(
      deniedCommands(allow, [
        "rm -rf ../dpt-test-project-linear",
        "mv specs/frs/X.md specs/frs/archive/X.md",
        "cp a b",
        "git commit -m chore",
        "git push -u origin HEAD",
        "gh pr create --title x",
        "bun test",
        "bunx tsc --noEmit",
        "mkdir -p .claude",
        "ls -la",
      ]),
    ).toEqual([]);
  });

  test("the shape change does not widen the grant to a bare wildcard", () => {
    const allow = scaffoldAllow();
    expect(allow.filter((entry) => /^Bash\(\*?:?\*?\)$/.test(entry))).toEqual([]);
    expect(grants(allow, "curl https://example.invalid")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-426.3 — the documented task-tracking block shows the current
// branch-template default (pinned against `canonicalBranchTemplate`, the
// authority, rather than a literal).
// ---------------------------------------------------------------------------

describeSkill("AC-STE-426.3 — documented task-tracking block shows the current default", () => {
  /** The ```markdown fence in step 6 that documents the `## Task Tracking` shape. */
  function documentedTaskTrackingBlock(): string {
    const step6 = step6Slice(skill!);
    const fences = [...step6.matchAll(/```markdown\n([\s\S]*?)```/g)].map((m) => m[1]!);
    return fences.find((fence) => fence.includes("## Task Tracking")) ?? "";
  }

  const milestoneKeyed = canonicalBranchTemplate({ milestone: "117" });
  const ticketKeyed = canonicalBranchTemplate({});

  test("the two branch-template forms are distinct (fixture sanity)", () => {
    expect(milestoneKeyed).not.toBe(ticketKeyed);
  });

  test("the documented block is locatable inside Phase 1 step 6", () => {
    const block = documentedTaskTrackingBlock();
    expect(block).not.toBe("");
    expect(block).toContain("mode: jira");
    expect(block).toContain("branch_template:");
  });

  test("branch_template shows the milestone-keyed canonical form", () => {
    const block = documentedTaskTrackingBlock();
    const line = block
      .split("\n")
      .find((l) => l.trim().startsWith("branch_template:"));
    expect(line?.trim()).toBe(`branch_template: ${milestoneKeyed}`);
  });

  test("the stale ticket-keyed form is gone from the documented block", () => {
    expect(documentedTaskTrackingBlock()).not.toContain(ticketKeyed);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-426.4 — the meta-test pin: the snippet's tool-surface union is
// DERIVED from the tracked settings file, not from a second hand-written copy.
// ---------------------------------------------------------------------------

describeBoth("AC-STE-426.4 — snippet tool surface is pinned to the tracked settings file", () => {
  test("non-Bash surfaces are set-equal to the tracked .claude/settings.json", () => {
    const tracked = nonBashSurface(trackedAllow());
    // Floor: five file tools + two MCP families. Guards a tracked file that
    // lost its non-Bash entries from making this pin vacuously satisfiable.
    expect(tracked.length).toBeGreaterThanOrEqual(7);
    expect(nonBashSurface(scaffoldAllow())).toEqual(tracked);
  });

  test("both files agree on rule shape — no glob-shaped rule on either side", () => {
    expect(trackedAllow().filter((e) => GLOB_SHAPED_RE.test(e))).toEqual([]);
    expect(scaffoldAllow().filter((e) => GLOB_SHAPED_RE.test(e))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Invariants the refresh must not break (pre-existing contracts).
// ---------------------------------------------------------------------------

describeSkill("STE-426 regression rails — pre-existing scaffold contracts hold", () => {
  test("exactly one settings-writing heredoc, shared by both tracker paths", () => {
    expect(extractSettingsHeredocs(skill!)).toHaveLength(1);
    expect(step6Slice(skill!)).toContain("identical in both tracker paths");
  });

  test("probe #62's opener regex still matches and Bash(claude:*) precedes EOF", () => {
    const heredoc = theScaffoldHeredoc();
    const opener = skill!.split("\n")[heredoc.openerLine - 1]!;
    expect(HEREDOC_OPENER_RE.test(opener)).toBe(true);
    expect(
      heredoc.linesBeforeTerminator.some((l) => l.includes("Bash(claude:*)")),
    ).toBe(true);
  });

  test("probe #62 spawn_pattern_allowlist stays green on the repo itself", async () => {
    const report = await runSpawnPatternAllowlistProbe(repoRoot);
    expect(report.violations.map((v) => v.note)).toEqual([]);
  });

  test("the heredoc body is still parseable JSON with a permissions.allow array", () => {
    expect(scaffoldAllow().length).toBeGreaterThanOrEqual(10);
  });
});
