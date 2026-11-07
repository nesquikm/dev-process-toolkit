// STE-708 — skills keep reading the tracker mode from CLAUDE.md, which the
// generated binding stub now carries; code reads it through the loader's
// `mode` front door.
//
// Operator ruling 2026-11-04 (review 4, R4-1): through 3.x the seven
// mode-aware skills keep the prose Schema L read and make ZERO extra tool
// calls. Measurement recorded in the FR's Requirement: over 405 recorded runs
// of six of the seven skills (`/setup` had none), the first 12 tool calls
// after entry never Read CLAUDE.md and no Bash call ran the Schema L grep, so
// a front-door call at entry would ADD one call per run rather than replace
// one. That is why AC-.13 pins every SKILL.md's `bun run` target list.
//
// Trunk for every literal pin below is dbdb9572. The bytes were read with
// `git show dbdb9572:<path>` while this test was written and embedded here;
// the test never shells out to git.
//
// AC map:
//   AC-.1  "AC-.1 <skill>: probe step is byte-identical to trunk" + "AC-.1 no file under skills/ names project_settings.ts mode"
//          The gate-check row "AC-.1 gate-check: ..." was added by STE-713's single gate-check edit commit.
//   AC-.2  "AC-.2 stub read: <case>"
//   AC-.3  "AC-.3 patterns.md ..." + "AC-.3 migrate helper ..." + "AC-.3 gate-check probe #21 ..." (row added by STE-713)
//   AC-.4  "AC-.4 adapters/*.md ..."
//   AC-.5  "AC-.5 front door on a settings tree ..."
//   AC-.6  "AC-.6 refusal: <kind> ..."
//   AC-.7  "AC-.7 front door p95 ..."
//   AC-.8  graded by tests/skill-nfr-1-length.test.ts; "AC-.8 SKILL_LINE_CAP is not raised" pins the cap here.
//   AC-.9  graded by tests/m_2306b6-ste-618-live-proof-gate.test.ts (KICKOFF / PERMITTED_LINES unchanged);
//          skills/gate-check/SKILL.md must be byte-identical to trunk on this FR's commit. Not re-pinned here,
//          because STE-713 edits that file later in the milestone.
//   AC-.10 mutation controls:
//            - stub heading removed from renderTrackingStub -> "AC-.2 stub read: Linear ..." (count 1 fails)
//                                                              + "AC-.10 control: a stub without its heading ..."
//            - stub mode line removed                       -> "AC-.2 stub read: ..." (mode line fails)
//                                                              + "AC-.10 control: a stub without its mode line ..."
//            - planted `project_settings.ts mode` in a SKILL.md copy -> "AC-.10 control: a planted front-door call ..."
//   AC-.11 full-suite gate (`bun test` from plugins/dev-process-toolkit, 0 failures, skip identities equal to
//          trunk by name) — graded by the gate run, not by a test in this file.
//   AC-.12 "AC-.12 unmoved tree: <fixture>"
//   AC-.13 "AC-.13 <skill>: bun run targets equal the trunk pin" + "AC-.13 control: ..."
//          The gate-check row "AC-.13 gate-check: ..." was added by STE-713's gate-check edit commit.
//
// All ids, teams, projects and tags are synthetic.

import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

import { renderTrackingStub } from "../adapters/_shared/src/project_settings_legacy";
import { readWorkspaceBinding } from "../adapters/_shared/src/workspace_binding";
import { computeMigrationDiff } from "../scripts/migrate-task-tracking-canonical";

const PLUGIN = resolve(import.meta.dir, "..");
const SKILLS_DIR = join(PLUGIN, "skills");
const ADAPTERS_DIR = join(PLUGIN, "adapters");
const PATTERNS_MD = join(PLUGIN, "docs", "patterns.md");
const MIGRATE_HELPER = join(PLUGIN, "scripts", "migrate-task-tracking-canonical.ts");
const FRONT_DOOR = join(PLUGIN, "adapters", "_shared", "src", "project_settings.ts");
const NFR1_TEST = join(PLUGIN, "tests", "skill-nfr-1-length.test.ts");

const tmpRoots: string[] = [];
function tmp(label: string): string {
  const d = mkdtempSync(join(tmpdir(), `ste708-${label}-`));
  tmpRoots.push(d);
  return d;
}
afterAll(() => {
  for (const d of tmpRoots) rmSync(d, { recursive: true, force: true });
});

function skillPath(skill: string): string {
  return join(SKILLS_DIR, skill, "SKILL.md");
}

// ---------------------------------------------------------------------------
// Trunk pins (dbdb9572), embedded as literals.
// ---------------------------------------------------------------------------

const TRUNK_PROBE_STEP: Readonly<Record<string, string>> = {
  "setup":
    "Before any detection or setup, run the Schema L probe (see `docs/patterns.md` \u00a7 Tracker Mode Probe). When `$ARGUMENTS` contains `--resume-tracker-binding`, route to the workspace-binding resume/repoint contract in `docs/setup-reference.md` \u00a7 0c \u2014 `bun run ${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/repoint_tracker_binding.ts`, then step 7f, then that command's `--verify` \u2014 whose preconditions follow it \u2014 regardless of `## Task Tracking` presence and regardless of the mode the probe reports; that flag re-points an existing binding at a new tracker container, and it is a different instrument from the mode-switch flags of \u00a7 0b, which change tracker MODE, refuse a same-mode no-op, and skip steps 1\u20138. If `CLAUDE.md` already exists and contains a `## Task Tracking` section, this is an existing tracker-mode project \u2014 \u00a7 0b is the entry point for changing MODE, and the repoint flag above is the entry point for changing CONTAINER. If `CLAUDE.md` is absent, empty of `## Task Tracking`, or `$ARGUMENTS` contains `new` \u2014 and `$ARGUMENTS` contains neither mode-switch flag named in the \u00a7 0b heading \u2014 run the normal fresh-setup flow below. When either \u00a7 0b mode-switch flag is present, section 0b overrides this routing regardless of `## Task Tracking` presence. When `$ARGUMENTS` contains `--template <path>`, dispatch to the `setup-template` child skill at `skills/setup-template/SKILL.md` (template-source reuse flow) before the normal fresh-setup steps.",
  "spec-write":
    "- **Tracker-mode probe** \u2014 Run the Schema L probe (see `docs/patterns.md` \u00a7 Tracker Mode Probe). If `CLAUDE.md` has no `## Task Tracking` section, mode is `none`. If a tracker mode is active:",
  "implement":
    "   - **0.f Tracker-mode probe** \u2014 Run the Schema L probe (see `docs/patterns.md` \u00a7 Tracker Mode Probe). If `CLAUDE.md` has no `## Task Tracking` section, mode is `none` and tracker hooks below skip. If a tracker mode is active:",
  "pr":
    "Before creating the PR, run the Schema L probe (see `docs/patterns.md` \u00a7 Tracker Mode Probe). If `CLAUDE.md` has no `## Task Tracking` section, mode is `none` and the rest of this skill runs unchanged. If a tracker mode is active:",
  "spec-review":
    "   - Run the Schema L probe (see `docs/patterns.md` \u00a7 Tracker Mode Probe). If `CLAUDE.md` has no `## Task Tracking` section, mode is `none` and ACs are read from `specs/frs/*.md`. If a tracker mode is active, AC traversal pulls the canonical AC list from the active adapter's `pull_acs(ticket_id)` instead of parsing local specs; local `specs/` still provides FR titles, descriptions, and traceability context (Path B). See `docs/spec-review-tracker-mode.md` for the full tracker-mode flow.",
  "spec-archive":
    "- **Tracker-mode probe** \u2014 Run the Schema L probe (see `docs/patterns.md` \u00a7 Tracker Mode Probe). If `CLAUDE.md` has no `## Task Tracking` section, mode is `none`. Tracker-mode `/spec-archive` still operates only on local `specs/` content \u2014 archival of completed **tracker tickets** is the tracker's own concern.",
};

const TRUNK_CALL_TARGETS: Readonly<Record<string, readonly string[]>> = {
  "setup": ["repoint_tracker_binding.ts"],
  "spec-write": ["attach_project_milestone.ts", "bug_tracker_type.ts", "check_marker_runtime.ts", "milestone_codename.ts", "mint_milestone_epic.ts", "mint_milestone_linear.ts", "next_free_milestone_number.ts", "resolve_milestone_identity.ts"],
  "implement": ["active_plan_ship_ready.ts", "best_practices_manifest.ts select", "capture_skip_baseline.ts", "design_reference_block.ts", "gate_capture.ts", "sibling_release.ts", "ticket_ownership.ts decide"],
  "pr": ["sibling_release.ts"],
  "spec-review": ["gate_receipt.ts spec-review"],
  "spec-archive": ["sibling_release.ts"],
  "deliver": ["deliver_decision.ts", "deliver_worker_name.ts", "driven_run_signal.ts", "gate_capture.ts", "resume_gate_render.ts", "spawn_receipt.ts"],
};
const SKILL_LINE_CAP_AT_TRUNK = 358;

// The gate-check rows (AC-STE-713.11): the same trunk pins, for the file STE-713 edits.
const TRUNK_GATE_CHECK_PROBE_STEP =
  "- **Tracker Mode Probe** \u2014 Before running any commands, run the Schema L probe (see `docs/patterns.md` \u00a7 Tracker Mode Probe). If `CLAUDE.md` has no `## Task Tracking` section, mode is `none` and tracker-mode hooks skip. If a tracker mode is active:";
const TRUNK_GATE_CHECK_CALL_TARGETS: readonly string[] = [
  "capture_skip_baseline.ts",
  "check_marker_runtime.ts",
  "gate_receipt.ts gate-check",
  "task_tracking_workspace_binding_present.ts",
  "tracker_local_reconciliation_drift.ts",
  "video_commit_nudge.ts",
];

// ---------------------------------------------------------------------------
// The Schema L prose procedure of docs/patterns.md § Tracker Mode Probe,
// as the model runs it against CLAUDE.md text.
// ---------------------------------------------------------------------------

function schemaLHeadingCount(claudeMd: string): number {
  return claudeMd.split("\n").filter((l) => l === "## Task Tracking").length;
}

/** Step 3: the `mode:` value between `## Task Tracking` and the next `##`/`###` heading (or EOF). */
function schemaLModeLine(claudeMd: string): string | undefined {
  const lines = claudeMd.split("\n");
  const start = lines.indexOf("## Task Tracking");
  if (start < 0) return undefined;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{2,3}\s/.test(lines[i]!)) break;
    const m = /^mode:\s*(.*)$/.exec(lines[i]!);
    if (m) return m[1]!.trim();
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// AC-STE-708.1 — prose read unchanged
// ---------------------------------------------------------------------------

/** Every file under `dir` (recursive) whose text names the front-door `mode` verb. */
function filesNamingFrontDoorMode(dir: string): string[] {
  const hits: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/project_settings\.ts"?\s+mode\b/.test(readFileSync(p, "utf8"))) hits.push(p);
    }
  };
  walk(dir);
  return hits;
}

describe("AC-STE-708.1 prose read unchanged", () => {
  for (const [skill, line] of Object.entries(TRUNK_PROBE_STEP)) {
    test(`AC-.1 ${skill}: probe step is byte-identical to trunk`, () => {
      const lines = readFileSync(skillPath(skill), "utf8").split("\n");
      expect(lines).toContain(line);
    });
  }

  // AC-.1 gate-check row — added by STE-713's gate-check edit commit (AC-STE-713.11). The
  // operator ruling of 2026-11-04 keeps the gate-check probe step byte-identical too.
  test("AC-.1 gate-check: probe step is byte-identical to trunk", () => {
    const lines = readFileSync(skillPath("gate-check"), "utf8").split("\n");
    expect(lines).toContain(TRUNK_GATE_CHECK_PROBE_STEP);
  });

  test("AC-.1 no file under skills/ names project_settings.ts mode", () => {
    expect(filesNamingFrontDoorMode(SKILLS_DIR)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-708.2 — the prose read answers from the stub
// ---------------------------------------------------------------------------

type TT = Record<string, unknown> & { mode: string };

const STUB_CASES: { name: string; tt: TT; adapter?: "linear" | "jira"; binding?: Record<string, unknown> }[] = [
  {
    name: "Linear",
    tt: {
      mode: "linear",
      mcp_server: "linear",
      linear: { team: "SYN", project: "Synthetic — Project", default_labels: ["alpha", "beta"] },
    },
    adapter: "linear",
    binding: { team: "SYN", project: "Synthetic — Project", defaultLabels: ["alpha", "beta"], shared: false },
  },
  {
    name: "shared Jira",
    tt: {
      mode: "jira",
      mcp_server: "atlassian",
      jira: { project: "SYNJ", default_labels: ["syn-repo", "gamma"], repo_tag: "syn-repo", min_dpt_version: "2.90.0" },
    },
    adapter: "jira",
    binding: {
      project: "SYNJ",
      defaultLabels: ["syn-repo", "gamma"],
      repoTag: "syn-repo",
      minDptVersion: "2.90.0",
      shared: true,
    },
  },
  { name: "custom adapter", tt: { mode: "synthtrack", mcp_server: "synthtrack" } },
];

function claudeMdAround(stub: string): string {
  return `# Synthetic Project\n\n## Tech Stack\n\n- TS\n\n${stub}\n## Key Commands\n\n- bun test\n`;
}

describe("AC-STE-708.2 the prose read answers from the stub", () => {
  for (const c of STUB_CASES) {
    test(`AC-.2 stub read: ${c.name} gives heading count 1 and the settings mode`, () => {
      const md = claudeMdAround(renderTrackingStub({ task_tracking: c.tt }));
      expect(schemaLHeadingCount(md)).toBe(1);
      expect(schemaLModeLine(md)).toBe(c.tt.mode);
    });

    if (c.adapter) {
      test(`AC-.2 stub read: ${c.name} binding keys read back by readWorkspaceBinding equal task_tracking.${c.adapter}`, () => {
        const root = tmp("stub");
        const md = join(root, "CLAUDE.md");
        writeFileSync(md, claudeMdAround(renderTrackingStub({ task_tracking: c.tt })));
        expect(readWorkspaceBinding(md, c.adapter!)).toEqual(c.binding as never);
      });
    }
  }

  test("AC-.2 stub read: mode none renders empty and the heading count is 0", () => {
    const stub = renderTrackingStub({ task_tracking: { mode: "none" } });
    expect(stub).toBe("");
    expect(schemaLHeadingCount(claudeMdAround(stub))).toBe(0);
  });
});

describe("AC-STE-708.10 stub mutation controls", () => {
  test("AC-.10 control: a stub without its heading gives count 0 (the AC-.2 row would red)", () => {
    const stub = renderTrackingStub({ task_tracking: STUB_CASES[0]!.tt })
      .split("\n")
      .filter((l) => l !== "## Task Tracking")
      .join("\n");
    expect(schemaLHeadingCount(claudeMdAround(stub))).toBe(0);
  });

  test("AC-.10 control: a stub without its mode line gives no mode (the AC-.2 row would red)", () => {
    const stub = renderTrackingStub({ task_tracking: STUB_CASES[0]!.tt })
      .split("\n")
      .filter((l) => !l.startsWith("mode:"))
      .join("\n");
    expect(schemaLModeLine(claudeMdAround(stub))).toBeUndefined();
  });

  test("AC-.10 control: a planted front-door call in a SKILL.md copy is found", () => {
    const dir = tmp("plant-mode");
    const skill = "spec-archive";
    mkdirSync(join(dir, skill), { recursive: true });
    const text = readFileSync(skillPath(skill), "utf8");
    writeFileSync(
      join(dir, skill, "SKILL.md"),
      `${text}\nRun \`bun run "\${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/project_settings.ts" mode "<projectRoot>"\` first.\n`,
    );
    expect(filesNamingFrontDoorMode(dir)).toEqual([join(dir, skill, "SKILL.md")]);
    // The same plant also reds the AC-.13 call-list pin.
    expect(callListViolations(readFileSync(join(dir, skill, "SKILL.md"), "utf8"), TRUNK_CALL_TARGETS[skill]!)).not.toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-708.3 — patterns.md § Tracker Mode Probe + the probe #21 helper
// ---------------------------------------------------------------------------

function trackerModeProbeSection(): string {
  const text = readFileSync(PATTERNS_MD, "utf8");
  const start = text.indexOf("### Pattern: Tracker Mode Probe");
  expect(start).toBeGreaterThanOrEqual(0);
  const next = text.indexOf("\n### Pattern:", start + 1);
  return text.slice(start, next < 0 ? undefined : next);
}

function paragraphs(text: string): string[] {
  return text.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p.length > 0);
}

/** The first prose paragraph after the canonical-keys table (the "key-table paragraph"). */
function keyTableParagraph(section: string): string {
  const paras = paragraphs(section);
  const tableIdx = paras.findIndex((p) => p.includes("| `branch_template` |"));
  expect(tableIdx).toBeGreaterThanOrEqual(0);
  return paras[tableIdx + 1]!;
}

describe("AC-STE-708.3 patterns.md § Tracker Mode Probe", () => {
  test("AC-.3 patterns.md: on a settings-file tree the heading the probe reads is the generated stub", () => {
    const hit = paragraphs(trackerModeProbeSection()).some(
      (p) => /generated (binding )?stub/i.test(p) && p.includes("specs/settings.yaml") && p.includes("## Task Tracking"),
    );
    expect(hit).toBe(true);
  });

  test("AC-.3 patterns.md: a tracker-mode settings tree always carries the stub and probe #25 grades it", () => {
    const hit = paragraphs(trackerModeProbeSection()).some((p) => /stub/i.test(p) && /#25\b/.test(p));
    expect(hit).toBe(true);
  });

  test("AC-.3 patterns.md: names project_settings.ts mode as the code-side read and the 4.0 skill path", () => {
    const hit = paragraphs(trackerModeProbeSection()).some(
      (p) => p.includes("project_settings.ts") && /\bmode\b/.test(p) && p.includes("4.0") && /\bcode\b/i.test(p),
    );
    expect(hit).toBe(true);
  });

  test("AC-.3 patterns.md: the key-table paragraph sends extra metadata to a prose section outside ## Task Tracking", () => {
    const p = keyTableParagraph(trackerModeProbeSection());
    expect(p).not.toContain("workspace URLs");
    expect(p).not.toContain("belong in a sub-section");
    expect(p).toMatch(/prose section/i);
    expect(p).toContain("outside `## Task Tracking`");
    expect(p).toMatch(/binding keys/i);
    // The "additional top-level keys" sentence names the legacy home as legacy.
    expect(p).toMatch(/legacy/i);
  });

  // AC-.3 gate-check probe #21 row — added by STE-713's gate-check edit commit (AC-STE-713.11).
  test("AC-.3 gate-check probe #21: metadata beyond the closed key set goes to a prose section outside ## Task Tracking", () => {
    const entry = readFileSync(skillPath("gate-check"), "utf8")
      .split("\n")
      .find((l) => l.startsWith("21. **`task-tracking-canonical-keys`**"));
    expect(entry).toBeDefined();
    expect(entry).toMatch(/prose section/i);
    expect(entry).toContain("outside `## Task Tracking`");
    expect(entry).not.toContain("belongs under sub-headings");
  });
});

// --- probe #21 helper ------------------------------------------------------

const DRIFTED_LINEAR = [
  "# Synthetic Project",
  "",
  "## Task Tracking",
  "",
  "mode: linear",
  "mcp_server: linear",
  "linear_team_id: syn-team-1",
  "linear_workspace_url: https://example.invalid/syn",
  "branch_template: feat/{ticket-id}",
  "",
  "### Linear",
  "",
  "team: SYN",
  "project: Synthetic Project",
  "",
  "## Key Commands",
  "",
  "- bun test",
  "",
].join("\n");

/** The post-image of the helper's single whole-file hunk (context + added lines). */
function applyWholeFileDiff(diff: string): string {
  const lines = diff.split("\n");
  const hunk = lines.findIndex((l) => l.startsWith("@@"));
  expect(hunk).toBeGreaterThanOrEqual(0);
  return lines
    .slice(hunk + 1)
    .filter((l) => l.startsWith(" ") || l.startsWith("+"))
    .map((l) => l.slice(1))
    .join("\n");
}

function headerComment(src: string): string {
  const out: string[] = [];
  for (const l of src.split("\n")) {
    if (!l.startsWith("//")) break;
    out.push(l);
  }
  return out.join("\n");
}

describe("AC-STE-708.3 migrate-task-tracking-canonical.ts sends stray keys to ## Tracker Notes", () => {
  test("AC-.3 migrate helper: header comment names ## Tracker Notes and not ### <Tracker>", () => {
    const header = headerComment(readFileSync(MIGRATE_HELPER, "utf8"));
    expect(header.length).toBeGreaterThan(0);
    expect(header).toContain("## Tracker Notes");
    expect(header).not.toContain("### <Tracker>");
  });

  test("AC-.3 migrate helper: on a drifted Linear fixture the diff adds +## Tracker Notes and no +### Linear", () => {
    const diff = computeMigrationDiff(DRIFTED_LINEAR, "/proj/CLAUDE.md");
    expect(diff).toMatch(/^\+## Tracker Notes$/m);
    expect(diff).not.toMatch(/^\+### Linear/m);
  });

  test("AC-.3 migrate helper: stray keys move verbatim, each prefixed '- ', into ## Tracker Notes right after the span", () => {
    const after = applyWholeFileDiff(computeMigrationDiff(DRIFTED_LINEAR, "/proj/CLAUDE.md")).split("\n");
    const tt = after.indexOf("## Task Tracking");
    expect(tt).toBeGreaterThanOrEqual(0);
    // The next H1/H2 heading after `## Task Tracking` is `## Tracker Notes`.
    const nextH2 = after.findIndex((l, i) => i > tt && /^#{1,2}\s/.test(l));
    expect(after[nextH2]).toBe("## Tracker Notes");
    const notes = after.slice(nextH2 + 1, after.findIndex((l, i) => i > nextH2 && /^#{1,2}\s/.test(l)));
    expect(notes).toContain("- linear_team_id: syn-team-1");
    expect(notes).toContain("- linear_workspace_url: https://example.invalid/syn");
    // The span keeps only canonical top-level keys plus its binding sub-section.
    const span = after.slice(tt + 1, nextH2);
    expect(span).not.toContain("linear_team_id: syn-team-1");
    expect(span).not.toContain("linear_workspace_url: https://example.invalid/syn");
    expect(span).toContain("mode: linear");
    expect(span).toContain("### Linear");
    expect(span).toContain("team: SYN");
    // Everything after the notes is untouched.
    expect(after).toContain("## Key Commands");
  });

  test("AC-.3 migrate helper: an existing ## Tracker Notes is appended to, never duplicated", () => {
    const withNotes = [
      "# Synthetic Project",
      "",
      "## Task Tracking",
      "",
      "mode: linear",
      "linear_extra: syn-extra",
      "",
      "## Tracker Notes",
      "",
      "- an older note",
      "",
      "## Key Commands",
      "",
    ].join("\n");
    const diff = computeMigrationDiff(withNotes, "/proj/CLAUDE.md");
    expect(diff).not.toMatch(/^\+## Tracker Notes$/m);
    const after = applyWholeFileDiff(diff).split("\n");
    expect(after.filter((l) => l === "## Tracker Notes").length).toBe(1);
    const notesAt = after.indexOf("## Tracker Notes");
    const keyCmds = after.indexOf("## Key Commands");
    const notes = after.slice(notesAt + 1, keyCmds);
    expect(notes).toContain("- an older note");
    expect(notes).toContain("- linear_extra: syn-extra");
  });

  test("AC-.3 migrate helper: a clean tree still yields an empty diff (dry-run, idempotent)", () => {
    const clean = "# P\n\n## Task Tracking\n\nmode: linear\nmcp_server: linear\n\n### Linear\n\nteam: SYN\n";
    expect(computeMigrationDiff(clean, "/proj/CLAUDE.md")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// AC-STE-708.4 — adapter docs name the stub beside every `### Linear|Jira` read
// ---------------------------------------------------------------------------

function adapterDocViolations(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).filter((n) => n.endsWith(".md"))) {
    readFileSync(join(dir, name), "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (!line.includes("CLAUDE.md") || !/### (Linear|Jira)\b/.test(line)) return;
        if (/generated stub/i.test(line) || line.includes("specs/settings.yaml")) return;
        out.push(`${name}:${i + 1}`);
      });
  }
  return out;
}

describe("AC-STE-708.4 adapters/*.md", () => {
  test("AC-.4 adapters/*.md: every line naming CLAUDE.md with ### Linear/### Jira names the generated stub or specs/settings.yaml", () => {
    expect(adapterDocViolations(ADAPTERS_DIR)).toEqual([]);
  });

  test("AC-.4 control: a planted line naming neither turns the scan red", () => {
    const dir = tmp("adapters");
    for (const n of readdirSync(ADAPTERS_DIR).filter((x) => x.endsWith(".md"))) cpSync(join(ADAPTERS_DIR, n), join(dir, n));
    const before = adapterDocViolations(dir);
    writeFileSync(join(dir, "linear.md"), `${readFileSync(join(dir, "linear.md"), "utf8")}\nRead \`team\` from \`### Linear\` in CLAUDE.md.\n`);
    const after = adapterDocViolations(dir);
    expect(after.length).toBe(before.length + 1);
    expect(after.some((v) => v.startsWith("linear.md:"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The front door: `project_settings.ts mode <projectRoot>`
// ---------------------------------------------------------------------------

function frontDoorMode(root: string): { code: number | null; stdout: string; stderr: string } {
  const r = Bun.spawnSync([process.execPath, "run", FRONT_DOOR, "mode", root], { cwd: PLUGIN, env: { ...process.env } });
  return { code: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
}

function tree(label: string, files: Record<string, string>): string {
  const root = tmp(label);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  return root;
}

const SETTINGS_JIRA = [
  "schema_version: 1",
  'min_dpt_version: "2.0.0"',
  "task_tracking:",
  "  mode: jira",
  "  mcp_server: atlassian",
  "  jira:",
  "    project: SYNJ",
  "",
].join("\n");

describe("AC-STE-708.5 front door on a settings tree", () => {
  test("AC-.5 front door on a settings tree: mode jira, source settings, exit 0", () => {
    const root = tree("settings-jira", {
      "specs/settings.yaml": SETTINGS_JIRA,
      "CLAUDE.md": "# Synthetic Project\n\n## Key Commands\n\n- bun test\n",
    });
    const r = frontDoorMode(root);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("mode: jira\nsource: settings\n");
  });
});

describe("AC-STE-708.6 refusals exit non-zero with an empty stdout", () => {
  const rows: { kind: string; files: Record<string, string> }[] = [
    {
      kind: "malformed settings file",
      files: { "specs/settings.yaml": "schema_version: 1\nmin_dpt_version: \"2.0.0\"\ntask_tracking: [mode: jira\n" },
    },
    {
      kind: "unknown key in the settings file",
      files: { "specs/settings.yaml": `${SETTINGS_JIRA}synthetic_unknown_key: 1\n` },
    },
    {
      kind: "both homes",
      files: {
        "specs/settings.yaml": SETTINGS_JIRA,
        "CLAUDE.md": "# Synthetic Project\n\n## Verification\n\nverify_mode: manual\n",
      },
    },
    {
      kind: "floor above the running version",
      files: { "specs/settings.yaml": SETTINGS_JIRA.replace('"2.0.0"', '"99.0.0"') },
    },
  ];
  for (const row of rows) {
    test(`AC-.6 refusal: ${row.kind} exits non-zero with empty stdout`, () => {
      const r = frontDoorMode(tree("refuse", row.files));
      expect(r.code).not.toBe(0);
      expect(r.stdout).toBe("");
      expect(r.stderr).toContain("Refusing:");
    });
  }
});

describe("AC-STE-708.7 front door runtime", () => {
  test("AC-.7 front door p95 over 20 spawns is under 1 second", () => {
    const root = tree("timing", { "specs/settings.yaml": SETTINGS_JIRA });
    const ms: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now();
      const r = frontDoorMode(root);
      ms.push(performance.now() - t0);
      expect(r.code).toBe(0);
    }
    ms.sort((a, b) => a - b);
    const p95 = ms[Math.ceil(0.95 * ms.length) - 1]!;
    expect(p95).toBeLessThan(1000);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// AC-STE-708.12 — same answer on unmoved trees (v2.101.4 grep procedure)
// ---------------------------------------------------------------------------

const LINEAR_MD = [
  "# Synthetic Project",
  "",
  "## Task Tracking",
  "",
  "mode: linear",
  "mcp_server: linear",
  "",
  "### Linear",
  "",
  "team: SYN",
  "project: Synthetic Project",
  "",
].join("\n");

const UNMOVED_ROWS: { fixture: string; files: Record<string, string>; stdout: string }[] = [
  { fixture: "no CLAUDE.md", files: { "README.md": "synthetic\n" }, stdout: "mode: none\nsource: none\n" },
  {
    fixture: "CLAUDE.md with no ## Task Tracking heading",
    files: { "CLAUDE.md": "# Synthetic Project\n\n## Key Commands\n\n- bun test\n" },
    stdout: "mode: none\nsource: none\n",
  },
  { fixture: "a Linear heading", files: { "CLAUDE.md": LINEAR_MD }, stdout: "mode: linear\nsource: legacy\n" },
  {
    fixture: "Linear tree whose ## Verification holds an unknown key",
    files: { "CLAUDE.md": `${LINEAR_MD}\n## Verification\n\nverify_mode: manual\nsynthetic_unknown: yes\n` },
    stdout: "mode: linear\nsource: legacy\n",
  },
  {
    fixture: "Linear tree with a malformed specs/tracker-config.yaml",
    files: { "CLAUDE.md": LINEAR_MD, "specs/tracker-config.yaml": "tracker_key: [unterminated\n  statuses: {\n" },
    stdout: "mode: linear\nsource: legacy\n",
  },
  {
    fixture: "Linear tree whose ### Linear sub-section readWorkspaceBinding refuses",
    files: { "CLAUDE.md": LINEAR_MD.replace("project: Synthetic Project", "project: Synthetic Project\nrepo_tag: Not_Kebab\nmin_dpt_version: 2.90.0") },
    stdout: "mode: linear\nsource: legacy\n",
  },
  {
    fixture: "Linear heading and mode line only inside an HTML comment",
    files: { "CLAUDE.md": `# Synthetic Project\n\n<!--\n## Task Tracking\n\nmode: linear\n-->\n\n## Key Commands\n\n- bun test\n` },
    stdout: "mode: linear\nsource: legacy\n",
  },
];

describe("AC-STE-708.12 same answer on unmoved trees", () => {
  for (const row of UNMOVED_ROWS) {
    test(`AC-.12 unmoved tree: ${row.fixture}`, () => {
      const root = tree("unmoved", row.files);
      // The pinned mode is the v2.101.4 grep procedure's answer on this fixture.
      const md = join(root, "CLAUDE.md");
      const procedureMode = existsSync(md) ? (schemaLModeLine(readFileSync(md, "utf8")) ?? "none") : "none";
      expect(row.stdout.startsWith(`mode: ${procedureMode}\n`)).toBe(true);
      const r = frontDoorMode(root);
      expect(r.code).toBe(0);
      expect(r.stdout).toBe(row.stdout);
    });
  }

  test("AC-.12 control: the refused ### Linear fixture really is refused by readWorkspaceBinding", () => {
    const root = tree("unmoved-refused", { "CLAUDE.md": UNMOVED_ROWS[5]!.files["CLAUDE.md"]! });
    expect(() => readWorkspaceBinding(join(root, "CLAUDE.md"), "linear")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// AC-STE-708.8 — NFR-1 cap not raised (the cap itself is graded by skill-nfr-1-length.test.ts)
// ---------------------------------------------------------------------------

describe("AC-STE-708.8 NFR-1 cap", () => {
  test("AC-.8 SKILL_LINE_CAP is not raised", () => {
    const m = /const SKILL_LINE_CAP = (\d+);/.exec(readFileSync(NFR1_TEST, "utf8"));
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(SKILL_LINE_CAP_AT_TRUNK);
  });

  test("AC-.8 the seven mode-aware SKILL.md files stay within the cap", () => {
    for (const skill of [...Object.keys(TRUNK_PROBE_STEP), "gate-check"]) {
      const n = readFileSync(skillPath(skill), "utf8").split("\n").length;
      expect({ skill, withinCap: n <= SKILL_LINE_CAP_AT_TRUNK }).toEqual({ skill, withinCap: true });
    }
  });
});

// ---------------------------------------------------------------------------
// AC-STE-708.13 — zero extra tool calls: `bun run` target pins
// ---------------------------------------------------------------------------

const BUN_RUN_RE = /bun run\s+"?([^\s"`]+?\.ts)"?(?:[ \t]+([a-z][a-z0-9-]*)(?=[\s"`]|$))?/gm;

/** Targets this milestone may add, each only in a sentence that names its condition. */
const CONDITIONAL_TARGETS: { module: string; verb?: string; condition: string }[] = [
  { module: "project_settings.ts", verb: "set", condition: "## Project Settings" }, // STE-710
  { module: "upgrade_offer.ts", condition: "upgrade_offer: on" }, // STE-712
  // Amended by AC-STE-715.19 (M_7bc805)
  { module: "gate_receipt.ts", verb: "outcome", condition: "outcome: on" },
  // Amended by AC-STE-722.16 (M_d1b4b7)
  { module: "retro_offer.ts", condition: "retro: on" },
];

function sentences(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .flatMap((para) => para.replace(/\n/g, " ").split(/(?<=[.!?])\s+/));
}

function targetOf(m: RegExpMatchArray): { module: string; verb?: string; key: string } {
  const module = basename(m[1]!);
  return { module, verb: m[2], key: m[2] ? `${module} ${m[2]}` : module };
}

function callListViolations(text: string, trunk: readonly string[]): string[] {
  const out: string[] = [];
  const found = new Set<string>();
  for (const s of sentences(text)) {
    for (const m of s.matchAll(BUN_RUN_RE)) {
      const t = targetOf(m);
      found.add(t.key);
      if (trunk.includes(t.key)) continue;
      const cond = CONDITIONAL_TARGETS.find((c) => c.module === t.module && (c.verb === undefined || c.verb === t.verb));
      if (!cond) out.push(`added unconditionally: ${t.key}`);
      else if (!s.includes(cond.condition)) out.push(`added without its condition (${cond.condition}): ${t.key}`);
    }
  }
  for (const t of trunk) if (!found.has(t)) out.push(`removed: ${t}`);
  return out;
}

describe("AC-STE-708.13 zero extra tool calls", () => {
  for (const [skill, trunk] of Object.entries(TRUNK_CALL_TARGETS)) {
    test(`AC-.13 ${skill}: bun run targets equal the trunk pin (conditional additions only)`, () => {
      expect(callListViolations(readFileSync(skillPath(skill), "utf8"), trunk)).toEqual([]);
    });
  }

  // AC-.13 gate-check row — added by STE-713's gate-check edit commit (AC-STE-713.11).
  test("AC-.13 gate-check: bun run targets equal the trunk pin (conditional additions only)", () => {
    expect(callListViolations(readFileSync(skillPath("gate-check"), "utf8"), TRUNK_GATE_CHECK_CALL_TARGETS)).toEqual([]);
  });

  const PLANT_SKILL = "pr";
  const base = (): string => readFileSync(skillPath(PLANT_SKILL), "utf8");
  const plant = (sentence: string): string[] => {
    const dir = tmp("plant-call");
    const p = join(dir, "SKILL.md");
    writeFileSync(p, `${base()}\n${sentence}\n`);
    return callListViolations(readFileSync(p, "utf8"), TRUNK_CALL_TARGETS[PLANT_SKILL]!);
  };

  test("AC-.13 control: a planted unconditional bun run of a new module turns the pin red", () => {
    expect(plant("Run `bun run ${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/synthetic_new_module.ts <projectRoot>` at entry.")).toEqual([
      "added unconditionally: synthetic_new_module.ts",
    ]);
  });

  test("AC-.13 control: project_settings.ts set passes beside ## Project Settings and fails without it", () => {
    expect(
      plant("When CLAUDE.md carries `## Project Settings`, run `bun run ${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/project_settings.ts set <key> <value> <projectRoot>`."),
    ).toEqual([]);
    expect(plant("Run `bun run ${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/project_settings.ts set <key> <value> <projectRoot>`.")).not.toEqual([]);
  });

  test("AC-.13 control: upgrade_offer.ts passes beside upgrade_offer: on and fails without it", () => {
    expect(plant("When settings carry `upgrade_offer: on`, run `bun run ${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/upgrade_offer.ts <projectRoot>`.")).toEqual([]);
    expect(plant("Run `bun run ${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/upgrade_offer.ts <projectRoot>`.")).not.toEqual([]);
  });

  // Amended by AC-STE-715.19 (M_7bc805): the outcome order is admitted only beside `outcome: on`.
  test("AC-.13 control: a planted gate_receipt.ts outcome order naming outcome: on passes", () => {
    expect(
      plant('Only if that call also printed `outcome: on`, run `bun run "${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/gate_receipt.ts" outcome spec-review . pass`.'),
    ).toEqual([]);
  });

  // Amended by AC-STE-715.19 (M_7bc805)
  test("AC-.13 control: the same gate_receipt.ts outcome order without outcome: on is reported", () => {
    expect(plant('Run `bun run "${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/gate_receipt.ts" outcome spec-review . pass`.')).toEqual([
      "added without its condition (outcome: on): gate_receipt.ts outcome",
    ]);
  });

  // Amended by AC-STE-722.16 (M_d1b4b7): retro_offer.ts is admitted only beside `retro: on`.
  test("AC-.13 control: a planted retro_offer.ts run without retro: on is reported, and admitted with it", () => {
    expect(plant('Run `bun run "${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/retro_offer.ts" .`.')).toEqual([
      "added without its condition (retro: on): retro_offer.ts",
    ]);
    expect(plant('Only if that call also printed `retro: on`, run `bun run "${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/retro_offer.ts" .`.')).toEqual([]);
  });

  test("AC-.13 control: a removed trunk target turns the pin red", () => {
    const stripped = base().replace(/bun run [^\n`]*sibling_release\.ts[^\n`]*/g, "");
    expect(callListViolations(stripped, TRUNK_CALL_TARGETS[PLANT_SKILL]!)).toEqual(["removed: sibling_release.ts"]);
  });
});
