// STE-713 — recorded decisions follow settings to their new home.
//
// AC map:
//   AC-.1  "AC-.1 <AC id>: carries the M_94e6f7 supersession note naming <successor> and v3.0.0"
//          (reads the archived FR files; the original AC text stays a byte-for-byte prefix,
//          pinned as the sha-256 of its dbdb9572 line).
//   AC-.2  "AC-.2 NFR-2 ..." (five clauses, the stub clause naming 4.0, earlier bullets as written).
//   AC-.3  "AC-.3 patterns.md ..." (the heading-anchor rationale gains the 3.x / stub / 4.0 note).
//   AC-.6  "AC-.6 Implementation notes ..." (reads the FR's `## Implementation notes`).
//   AC-.9  "AC-.9 ..." — reads the milestone branch's commits (git): exactly one commit changes
//          skills/gate-check/SKILL.md, it is STE-713's, and it carries the both-arm entries of
//          STE-709's table, the #25 stub leg and the rewritten #21 metadata sentence.
//          RED until that commit exists.
//   AC-.10 "AC-.10 ..." — reads the re-base commit (git): the next commit touching the freeze
//          test changes only KICKOFF, PERMITTED_LINES and their comments; its RE-BASED comment
//          names the 2026-11-04 pre-granted ruling and lists the changed gate-check lines; on
//          it the freeze guard is green and neighbour lines still fail driftBeyond.
//          RED until that commit exists.
//   AC-.12 "AC-.12 control: ..." — removing any one note, the NFR-2 amendment, or the rewritten
//          probe #21 sentence turns the named checks red (in-memory mutations).
//   AC-.13 full-suite gate on the re-base commit (`bun test` from plugins/dev-process-toolkit,
//          0 failures, skip identities equal to the trunk baseline by name) — graded by the gate
//          run, not by a test in this file.
//   AC-.4 .5 .7 .8 live in tests/m_94e6f7-ste-713-config-home.test.ts; AC-.11 in
//   tests/m_94e6f7-ste-708-mode-front-door.test.ts; AC-.14 in tests/m_94e6f7-defaults-unchanged.test.ts.
//
// Literals were read with `git show dbdb9572:<path>` while this test was written.
// All ids are synthetic except the toolkit's own FR and AC identifiers.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";

const PLUGIN = realpathSync(resolve(import.meta.dir, ".."));
const REPO = realpathSync(join(PLUGIN, "..", ".."));
const ARCHIVE = join(REPO, "specs", "frs", "archive");
const REQUIREMENTS = join(REPO, "specs", "requirements.md");
const PATTERNS_MD = join(PLUGIN, "docs", "patterns.md");
const GATE_CHECK_REL = "plugins/dev-process-toolkit/skills/gate-check/SKILL.md";
const FREEZE_REL = "plugins/dev-process-toolkit/tests/m_2306b6-ste-618-live-proof-gate.test.ts";
const TRUNK = "dbdb9572";

function sha256(s: string): string {
  return new Bun.CryptoHasher("sha256").update(s).digest("hex");
}

// ---------------------------------------------------------------------------
// AC-STE-713.1 — supersession notes
// ---------------------------------------------------------------------------

/** The FR's table: AC line, successor token, and the sha-256 of the AC line at dbdb9572. */
const SUPERSESSIONS: readonly { ac: string; successor: string; trunkSha: string }[] = [
  { ac: "AC-STE-302.2", successor: "STE-711", trunkSha: "757b8d9b9681ebcbfe8c4e5bcd6a6b409b9d7683ee710e8af686f6fbcc8512db" },
  { ac: "AC-STE-612.5", successor: "STE-710", trunkSha: "1e8cf88c857cfc0f5107e0571a3489a874613a8a7a14f9f3ed97046d96c86c11" },
  { ac: "AC-STE-612.6", successor: "STE-710", trunkSha: "85b2018c2968e8a66757614acd1e23d1ebc1ea3873afae372f5f821026ffe4f8" },
  { ac: "AC-STE-663.1", successor: "STE-707", trunkSha: "d3fb59a8cd05d280538a8ab2194fe9027d02aa21011ca65512ec2cd17a759e32" },
  { ac: "AC-STE-663.7", successor: "STE-707", trunkSha: "8f226630f9fc428b2473c4f75264847d4b52707304416c9e1698c048a9208096" },
  { ac: "AC-STE-669.2", successor: "STE-710", trunkSha: "e99a441408636a7145af3e76631cd74390a4656b9801f39cbf0ee524124f0c7c" },
  { ac: "AC-STE-673.1", successor: "STE-709", trunkSha: "ac55539acbb27cca57d5cf001c12eb526426bbcc65ee4a91f87df4011513583c" },
  { ac: "AC-STE-673.6", successor: "STE-709", trunkSha: "c00585b7cee50764479ff5b9f15f9b9305b47c11d2102b1bc7edd2c04a8f68c6" },
  { ac: "AC-STE-167.1", successor: "STE-707", trunkSha: "e6cf2f8f39e5990c1f6f2e2af36801d109f0fa14af2c36ad6a31da30639c6dda" },
  { ac: "AC-STE-167.4", successor: "STE-707", trunkSha: "c484bfab651b0924a05f3b342bdd218de71828ba4a1b71d452f7c6c74320224e" },
  { ac: "AC-STE-378.1", successor: "STE-707", trunkSha: "45e3ebc016eff989b1196bb211055b437bcfa97e7d228440c9041a7d25f5fe4c" },
  { ac: "AC-STE-378.2", successor: "STE-707", trunkSha: "7e86d66e6ae8fe700c97be956565afe8c687481616a1fadfd3c40d25528835bc" },
];

const NOTE_OPEN = " **[Superseded by M_94e6f7 ";

function archivedFr(ac: string): string {
  const id = /^AC-(STE-\d+)\./.exec(ac)![1]!;
  return join(ARCHIVE, `${id}.md`);
}

/** Why `text` (an FR file) fails the AC-.1 row for `row`; empty when it passes. */
function supersessionViolations(text: string, row: (typeof SUPERSESSIONS)[number]): string[] {
  const lines = text.split("\n").filter((l) => l.startsWith(`- ${row.ac}:`));
  if (lines.length !== 1) return [`${row.ac}: ${lines.length} AC lines`];
  const line = lines[0]!;
  const at = line.indexOf(NOTE_OPEN);
  if (at < 0) return [`${row.ac}: no M_94e6f7 supersession note`];
  const out: string[] = [];
  if (sha256(line.slice(0, at)) !== row.trunkSha) out.push(`${row.ac}: the original AC text is not kept byte-for-byte before the note`);
  const note = line.slice(at + 1);
  const shape = /^\*\*\[Superseded by M_94e6f7 (STE-\d+) \(v3\.0\.0\): (.+)\.\]\*\*$/.exec(note);
  if (!shape) out.push(`${row.ac}: note is not in the house shape: ${note}`);
  else {
    if (shape[1] !== row.successor) out.push(`${row.ac}: successor ${shape[1]}, want ${row.successor}`);
    if (shape[2]!.trim().length < 10) out.push(`${row.ac}: the note does not say what now holds`);
  }
  return out;
}

describe("AC-STE-713.1 supersession notes", () => {
  for (const row of SUPERSESSIONS) {
    test(`AC-.1 ${row.ac}: carries the M_94e6f7 supersession note naming ${row.successor} and v3.0.0`, () => {
      const p = archivedFr(row.ac);
      expect(existsSync(p)).toBe(true);
      expect(supersessionViolations(readFileSync(p, "utf8"), row)).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------
// AC-STE-713.2 — NFR-2 amendment
// ---------------------------------------------------------------------------

const NFR2_TRUNK_BULLETS: readonly string[] = [
  "- All changes are additive — existing section headings must not be renamed or removed within a major version; deprecations require a major-version bump",
  "- `<!-- ADAPT -->` markers in template files (`templates/**`) must remain functional; markers in skill/agent files are removed per FR-15",
  "- A CLAUDE.md generated by `/setup` continues to work with newer skills until the plugin's next major version bump (forward-compat invariant within a major)",
  "- New structured output (FR-3) is optional guidance, not mandatory format change",
  "- The `## Task Tracking` Schema L block is opt-in — its absence is canonical for `mode: none` (AC-STE-8.5); skills must treat absence and `mode: none` identically",
];

function nfr2Section(text: string): string {
  const start = text.indexOf("### NFR-2:");
  if (start < 0) return "";
  const next = text.indexOf("\n### ", start + 1);
  return text.slice(start, next < 0 ? undefined : next);
}

function sentencesOf(text: string): string[] {
  return text
    .split("\n")
    .flatMap((l) => l.replace(/^\s*[-*]\s+/, "").split(/(?<=\.)\s+/))
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const NFR2_CLAUSES: readonly { name: string; holds: (s: string) => boolean }[] = [
  { name: "from v3.0.0 settings live in specs/settings.yaml", holds: (s) => s.includes("v3.0.0") && s.includes("`specs/settings.yaml`") },
  { name: "the CLAUDE.md headings are a read-only legacy home through 3.x", holds: (s) => /read-only/i.test(s) && /legacy/i.test(s) && s.includes("3.x") },
  { name: "the legacy read is removed in 4.0", holds: (s) => /legacy read/i.test(s) && s.includes("4.0") },
  {
    name: "absence of task_tracking (settings) or ## Task Tracking (legacy) is canonical mode: none",
    holds: (s) => s.includes("`task_tracking`") && s.includes("`## Task Tracking`") && /legacy/i.test(s) && s.includes("`mode: none`"),
  },
  {
    name: "a tracker-mode settings tree always carries the stub; a missing stub is drift probe #25 reds",
    holds: (s) => /stub/i.test(s) && /#25\b/.test(s),
  },
  {
    name: "the binding stub serves pre-3.0 hooks, 3.x never reads it, removal scheduled for 4.0",
    holds: (s) => /stub/i.test(s) && /pre-3\.0/.test(s) && s.includes("4.0"),
  },
];

/** Why `requirementsMd` fails AC-.2; empty when it passes. */
function nfr2Violations(requirementsMd: string): string[] {
  const section = nfr2Section(requirementsMd);
  if (section === "") return ["no NFR-2 section"];
  const out: string[] = [];
  const lines = section.split("\n");
  // The earlier bullets stay as written, in order, as the section's first bullets.
  const bullets = lines.filter((l) => l.startsWith("- "));
  for (let i = 0; i < NFR2_TRUNK_BULLETS.length; i++) {
    if (bullets[i] !== NFR2_TRUNK_BULLETS[i]) out.push(`earlier bullet ${i + 1} not as written`);
  }
  const amendment = lines.filter((l) => !NFR2_TRUNK_BULLETS.includes(l)).join("\n");
  const sentences = sentencesOf(amendment);
  for (const c of NFR2_CLAUSES) if (!sentences.some(c.holds)) out.push(`clause missing: ${c.name}`);
  return out;
}

describe("AC-STE-713.2 NFR-2 amendment", () => {
  test("AC-.2 NFR-2 carries the five-clause amendment, the stub clause names 4.0, earlier bullets as written", () => {
    expect(nfr2Violations(readFileSync(REQUIREMENTS, "utf8"))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-713.3 — patterns.md heading-anchor rationale
// ---------------------------------------------------------------------------

const ANCHOR_TRUNK_LINE =
  "**Why the section heading is the single probe anchor:** a literal heading check is cheaper than YAML frontmatter parsing, deterministic across markdown renderers, and survives CLAUDE.md edits that preserve structure. Keys inside the section are parsed only after the heading is confirmed present, so malformed key lines never break the `none` path.";

/** The paragraph opening with the anchor rationale (up to the next blank line). */
function anchorParagraph(patternsMd: string): string {
  const lines = patternsMd.split("\n");
  const i = lines.findIndex((l) => l.startsWith("**Why the section heading is the single probe anchor:**"));
  if (i < 0) return "";
  const out: string[] = [];
  for (let j = i; j < lines.length && lines[j]!.trim() !== ""; j++) out.push(lines[j]!);
  return out.join("\n");
}

function anchorNoteViolations(patternsMd: string): string[] {
  const p = anchorParagraph(patternsMd);
  if (p === "") return ["no heading-anchor rationale paragraph"];
  const out: string[] = [];
  if (!p.startsWith(ANCHOR_TRUNK_LINE)) out.push("the original rationale is not kept as written");
  const note = p.slice(ANCHOR_TRUNK_LINE.length);
  if (!note.includes("3.x")) out.push("note does not say through 3.x");
  if (!/generated binding stub|binding stub/i.test(note)) out.push("note does not name the generated binding stub");
  if (!/settings-file tree/i.test(note)) out.push("note does not name the settings-file tree");
  if (!note.includes("4.0")) out.push("note does not name 4.0");
  if (!/front door|project_settings\.ts mode/.test(note)) out.push("note does not name the STE-708 front door");
  if (!/anchor/i.test(note)) out.push("note does not say what the anchor becomes");
  return out;
}

describe("AC-STE-713.3 patterns.md heading-anchor note", () => {
  test("AC-.3 patterns.md: the heading-anchor rationale keeps its text and gains the 3.x stub / 4.0 front-door note", () => {
    expect(anchorNoteViolations(readFileSync(PATTERNS_MD, "utf8"))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The rewritten probe #21 metadata sentence (AC-.9, AC-.12; review 4, R4-4)
// ---------------------------------------------------------------------------

function probeEntry(gateCheck: string, n: number): string {
  return gateCheck.split("\n").find((l) => l.startsWith(`${n}. **`)) ?? "";
}

function probe21SentenceViolations(gateCheck: string): string[] {
  const e = probeEntry(gateCheck, 21);
  if (e === "") return ["no probe #21 entry"];
  const out: string[] = [];
  if (e.includes("belongs under sub-headings")) out.push('probe #21 still says "belongs under sub-headings"');
  if (!/prose section/i.test(e)) out.push("probe #21 does not send metadata to a prose section");
  if (!e.includes("outside `## Task Tracking`")) out.push("probe #21 does not say outside `## Task Tracking`");
  if (!e.includes("## Tracker Notes")) out.push("probe #21 does not name the helper's ## Tracker Notes destination");
  if (!e.includes("scripts/migrate-task-tracking-canonical.ts")) out.push("probe #21 no longer names its migration helper");
  return out;
}

describe("AC-STE-713.12 the rewritten probe #21 sentence", () => {
  test("AC-.12 gate-check probe #21: metadata goes to a prose section outside ## Task Tracking, helper named with ## Tracker Notes", () => {
    expect(probe21SentenceViolations(readFileSync(join(REPO, GATE_CHECK_REL), "utf8"))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-713.6 — Implementation notes list each edited pre-existing test
// ---------------------------------------------------------------------------

function frFile(): string {
  for (const p of [join(REPO, "specs", "frs", "STE-713.md"), join(ARCHIVE, "STE-713.md")]) if (existsSync(p)) return p;
  return "";
}

function implementationNotes(fr: string): string {
  const start = fr.indexOf("\n## Implementation notes");
  if (start < 0) return "";
  const next = fr.indexOf("\n## ", start + 1);
  return fr.slice(start, next < 0 ? undefined : next);
}

describe("AC-STE-713.6 Implementation notes", () => {
  test("AC-.6 Implementation notes: the FR has the section, and it lists the sanctioned STE-708 gate-check rows edit with its reason", () => {
    const p = frFile();
    expect(p).not.toBe("");
    const notes = implementationNotes(readFileSync(p, "utf8"));
    expect(notes).not.toBe("");
    const line = notes.split("\n").find((l) => l.includes("m_94e6f7-ste-708-mode-front-door.test.ts"));
    expect(line).toBeDefined();
    expect(line!.replace(/`?tests\/m_94e6f7-ste-708-mode-front-door\.test\.ts`?/, "").replace(/[\s\-*:—]/g, "").length).toBeGreaterThan(10);
  });

  test("AC-.6 Implementation notes: every test file it lists exists and carries a reason on its line", () => {
    const notes = implementationNotes(readFileSync(frFile(), "utf8"));
    const listed = [...notes.matchAll(/tests\/[\w./-]+\.test\.ts/g)].map((m) => m[0]);
    expect(listed.length).toBeGreaterThan(0);
    for (const rel of listed) {
      expect({ rel, exists: existsSync(join(PLUGIN, rel)) }).toEqual({ rel, exists: true });
      const line = notes.split("\n").find((l) => l.includes(rel))!;
      expect({ rel, reasoned: line.replace(rel, "").replace(/[\s`\-*:—]/g, "").length > 10 }).toEqual({ rel, reasoned: true });
    }
  });
});

// ---------------------------------------------------------------------------
// git helpers (AC-.9, AC-.10 read the branch's history by design)
// ---------------------------------------------------------------------------

function git(...args: string[]): string {
  const r = Bun.spawnSync(["git", "-C", REPO, ...args], { stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`);
  return r.stdout.toString();
}

/** The milestone branch's commits since trunk, oldest first, stopping at the v3.0.0 release commit when one exists. */
function milestoneCommits(): string[] {
  const all = git("rev-list", "--reverse", `${TRUNK}..HEAD`).split("\n").filter(Boolean);
  const out: string[] = [];
  for (const sha of all) {
    out.push(sha);
    if (/^Release: v3\.0\.0\b/m.test(git("show", "-s", "--format=%B", sha))) break;
  }
  return out;
}

function touches(sha: string, rel: string): boolean {
  return git("show", "--format=", "--name-only", sha).split("\n").includes(rel);
}

function refsSte713(sha: string): boolean {
  return /^Refs:.*\bSTE-713\b/m.test(git("show", "-s", "--format=%B", sha));
}

/** STE-709's table, plus what each probe's settings arm names. */
const BOTH_ARM_PROBES: readonly { n: number; settingsArm: RegExp; legacyArm: RegExp }[] = [
  { n: 18, settingsArm: /specs\/settings\.yaml/, legacyArm: /legacy/i },
  { n: 19, settingsArm: /specs\/settings\.yaml/, legacyArm: /legacy/i },
  { n: 21, settingsArm: /specs\/settings\.yaml/, legacyArm: /legacy/i },
  { n: 22, settingsArm: /specs\/settings\.yaml/, legacyArm: /legacy/i },
  { n: 25, settingsArm: /specs\/settings\.yaml/, legacyArm: /legacy/i },
  { n: 52, settingsArm: /status_vocabulary/, legacyArm: /specs\/tracker-config\.yaml/ },
  { n: 69, settingsArm: /specs\/settings\.yaml|settings_file|settings-file/, legacyArm: /legacy/i },
  { n: 74, settingsArm: /specs\/settings\.yaml/, legacyArm: /legacy/i },
  { n: 80, settingsArm: /specs\/settings\.yaml|verification\.run_cmd/, legacyArm: /legacy/i },
  { n: 87, settingsArm: /specs\/settings\.yaml|`video`/, legacyArm: /legacy/i },
];

function bothArmViolations(gateCheck: string): string[] {
  const out: string[] = [];
  for (const p of BOTH_ARM_PROBES) {
    const e = probeEntry(gateCheck, p.n);
    if (e === "") {
      out.push(`#${p.n}: no entry`);
      continue;
    }
    if (!p.settingsArm.test(e)) out.push(`#${p.n}: no settings-file arm`);
    if (!p.legacyArm.test(e)) out.push(`#${p.n}: no legacy arm`);
  }
  // #52 grades the settings key on a settings tree and the tracker config file on a legacy tree.
  if (!probeEntry(gateCheck, 52).includes("specs/settings.yaml")) out.push("#52: settings arm does not name specs/settings.yaml");
  // The #25 stub leg: byte-equal to renderTrackingStub, remedy names /dev-process-toolkit:upgrade.
  const e25 = probeEntry(gateCheck, 25);
  if (!e25.includes("renderTrackingStub")) out.push("#25: no stub leg naming renderTrackingStub");
  if (!/stub/i.test(e25) || !e25.includes("/dev-process-toolkit:upgrade")) out.push("#25: the stub leg's remedy does not name /dev-process-toolkit:upgrade");
  out.push(...probe21SentenceViolations(gateCheck));
  return out;
}

// ---------------------------------------------------------------------------
// AC-STE-713.9 — one gate-check edit commit
// ---------------------------------------------------------------------------

function gateCheckEditCommits(): string[] {
  return milestoneCommits().filter((sha) => touches(sha, GATE_CHECK_REL));
}

describe("AC-STE-713.9 one gate-check edit commit (reads the branch's commits)", () => {
  test("AC-.9 exactly one commit on the milestone branch changes skills/gate-check/SKILL.md, and it refs STE-713", () => {
    const shas = gateCheckEditCommits();
    expect(shas.length).toBe(1);
    expect(refsSte713(shas[0]!)).toBe(true);
  });

  test("AC-.9 that commit carries the both-arm entries of STE-709's table, the #25 stub leg and the rewritten #21 sentence", () => {
    const shas = gateCheckEditCommits();
    expect(shas.length).toBe(1);
    expect(bothArmViolations(git("show", `${shas[0]}:${GATE_CHECK_REL}`))).toEqual([]);
  });

  test("AC-.9 that commit keeps the gate-check tracker-mode probe step byte-identical to trunk (operator ruling 2026-11-04)", () => {
    const shas = gateCheckEditCommits();
    expect(shas.length).toBe(1);
    expect(git("show", `${shas[0]}:${GATE_CHECK_REL}`).split("\n")).toContain(GATE_CHECK_PROBE_STEP_AT_TRUNK);
  });
});

const GATE_CHECK_PROBE_STEP_AT_TRUNK =
  "- **Tracker Mode Probe** — Before running any commands, run the Schema L probe (see `docs/patterns.md` § Tracker Mode Probe). If `CLAUDE.md` has no `## Task Tracking` section, mode is `none` and tracker-mode hooks skip. If a tracker mode is active:";

// ---------------------------------------------------------------------------
// AC-STE-713.10 — the re-base commit
// ---------------------------------------------------------------------------

/** The freeze test's guard, as written there. */
function driftBeyond(before: string, after: string, permitted: readonly number[]): string[] {
  const a = before.split("\n");
  const b = after.split("\n");
  if (a.length !== b.length) return [`line count ${a.length} → ${b.length}`];
  const out: string[] = [];
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && !permitted.includes(i + 1)) out.push(`line ${i + 1}`);
  return out;
}

function rebaseCommit(): { edit: string; rebase: string } | null {
  const shas = gateCheckEditCommits();
  if (shas.length !== 1) return null;
  const edit = shas[0]!;
  const after = milestoneCommits();
  const from = after.indexOf(edit);
  const rebase = after.slice(from + 1).find((sha) => touches(sha, FREEZE_REL));
  return rebase ? { edit, rebase } : null;
}

/** The new-side line numbers the edit commit changed in gate-check. */
function changedGateCheckLines(edit: string): number[] {
  const diff = git("diff", "-U0", `${edit}^`, edit, "--", GATE_CHECK_REL);
  const out: number[] = [];
  for (const m of diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
    const start = Number(m[1]);
    const count = m[2] === undefined ? 1 : Number(m[2]);
    for (let i = 0; i < count; i++) out.push(start + i);
  }
  return out;
}

/** Every line number a comment block names, singly or as an `a-b` / `a–b` range. */
function numbersNamed(comment: string): Set<number> {
  const out = new Set<number>();
  for (const m of comment.matchAll(/\b(\d+)\s*[-–]\s*(\d+)\b|\b(\d+)\b/g)) {
    if (m[3] !== undefined) out.add(Number(m[3]));
    else for (let i = Number(m[1]); i <= Number(m[2]); i++) out.add(i);
  }
  return out;
}

describe("AC-STE-713.10 the re-base commit (reads the re-base commit)", () => {
  test("AC-.10 a commit after the gate-check edit commit touches the freeze test", () => {
    expect(rebaseCommit()).not.toBeNull();
  });

  test("AC-.10 the re-base commit changes only the freeze test, and in it only KICKOFF, PERMITTED_LINES and their comments", () => {
    const r = rebaseCommit();
    expect(r).not.toBeNull();
    expect(git("show", "--format=", "--name-only", r!.rebase).split("\n").filter(Boolean)).toEqual([FREEZE_REL]);
    const changed = git("diff", "-U0", `${r!.rebase}^`, r!.rebase, "--", FREEZE_REL)
      .split("\n")
      .filter((l) => (l.startsWith("+") || l.startsWith("-")) && !l.startsWith("+++") && !l.startsWith("---"))
      .map((l) => l.slice(1));
    expect(changed.length).toBeGreaterThan(0);
    const stray = changed.filter((l) => !(l.trim() === "" || l.trim().startsWith("//") || /\bKICKOFF\b/.test(l) || /\bPERMITTED_LINES\b/.test(l)));
    expect(stray).toEqual([]);
  });

  test("AC-.10 KICKOFF on the re-base commit is the gate-check edit commit", () => {
    const r = rebaseCommit();
    expect(r).not.toBeNull();
    const kickoff = /^const KICKOFF = "([0-9a-f]+)";$/m.exec(git("show", `${r!.rebase}:${FREEZE_REL}`))?.[1];
    expect(kickoff).toBeDefined();
    expect(git("rev-parse", `${kickoff}^{commit}`).trim()).toBe(git("rev-parse", r!.edit).trim());
  });

  test("AC-.10 its RE-BASED comment names the 2026-11-04 pre-granted ruling and lists every changed gate-check line", () => {
    const r = rebaseCommit();
    expect(r).not.toBeNull();
    const added = git("diff", "-U0", `${r!.rebase}^`, r!.rebase, "--", FREEZE_REL)
      .split("\n")
      .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
      .map((l) => l.slice(1))
      .filter((l) => l.trim().startsWith("//"))
      .join("\n");
    expect(added).toContain("RE-BASED");
    expect(added).toContain("2026-11-04");
    expect(added).toMatch(/pre-granted/i);
    const named = numbersNamed(added);
    const missing = changedGateCheckLines(r!.edit).filter((n) => !named.has(n));
    expect(missing).toEqual([]);
  });

  test("AC-.10 on the re-base commit the freeze guard is green and the neighbour-line controls still fail driftBeyond", () => {
    const r = rebaseCommit();
    expect(r).not.toBeNull();
    const freeze = git("show", `${r!.rebase}:${FREEZE_REL}`);
    const kickoff = /^const KICKOFF = "([0-9a-f]+)";$/m.exec(freeze)![1]!;
    const permitted = JSON.parse(/const PERMITTED_LINES: readonly number\[\] = (\[[\d,\s]*\]);/.exec(freeze)![1]!) as number[];
    const then = git("show", `${kickoff}:${GATE_CHECK_REL}`);
    const now = git("show", `${r!.rebase}:${GATE_CHECK_REL}`);
    expect(driftBeyond(then, now, permitted)).toEqual([]);
    const lines = now.split("\n");
    for (const p of permitted) {
      const neighbour = p + 1;
      if (permitted.includes(neighbour) || neighbour > lines.length) continue;
      const edited = [...lines];
      edited[neighbour - 1] = `${edited[neighbour - 1]} (edited)`;
      expect(driftBeyond(then, edited.join("\n"), permitted)).toEqual([`line ${neighbour}`]);
    }
  });
});

// ---------------------------------------------------------------------------
// AC-STE-713.12 — mutation controls (in memory)
// ---------------------------------------------------------------------------

describe("AC-STE-713.12 controls", () => {
  test("AC-.12 control: removing any one supersession note turns its AC-.1 row red", () => {
    for (const row of SUPERSESSIONS) {
      const text = readFileSync(archivedFr(row.ac), "utf8");
      const stripped = text
        .split("\n")
        .map((l) => (l.startsWith(`- ${row.ac}:`) && l.includes(NOTE_OPEN) ? l.slice(0, l.indexOf(NOTE_OPEN)) : l))
        .join("\n");
      expect({ ac: row.ac, red: supersessionViolations(stripped, row).length > 0 }).toEqual({ ac: row.ac, red: true });
    }
  });

  test("AC-.12 control: a note naming the wrong successor or version is red", () => {
    const row = SUPERSESSIONS[0]!;
    const line = `- ${row.ac}: synthetic`;
    const fake = (note: string) => supersessionViolations(`${line}${note}\n`, row);
    expect(fake(" **[Superseded by M_94e6f7 STE-799 (v3.0.0): synthetic now holds.]**")).not.toEqual([]);
    expect(fake(` **[Superseded by M_94e6f7 ${row.successor} (v2.0.0): synthetic now holds.]**`)).not.toEqual([]);
  });

  test("AC-.12 control: removing the NFR-2 amendment turns AC-.2 red", () => {
    const text = readFileSync(REQUIREMENTS, "utf8");
    const section = nfr2Section(text);
    const trunkOnly = ["### NFR-2: CLAUDE.md Schema Stability", "", ...NFR2_TRUNK_BULLETS, ""].join("\n");
    expect(nfr2Violations(text.replace(section, trunkOnly)).length).toBeGreaterThan(0);
  });

  test("AC-.12 control: an amendment without its stub-removal clause turns AC-.2 red", () => {
    const text = readFileSync(REQUIREMENTS, "utf8");
    const section = nfr2Section(text);
    const noStub = section
      .split("\n")
      .map((l) => (NFR2_TRUNK_BULLETS.includes(l) ? l : l.split(/(?<=\.)\s+/).filter((s) => !/pre-3\.0/.test(s)).join(" ")))
      .join("\n");
    expect(nfr2Violations(text.replace(section, noStub))).toContain(`clause missing: ${NFR2_CLAUSES[5]!.name}`);
  });

  test("AC-.12 control: restoring the trunk probe #21 sentence turns the #21 check red", () => {
    const trunkEntry =
      "21. **`task-tracking-canonical-keys`** — call `runTaskTrackingCanonicalKeysProbe(projectRoot)` from `adapters/_shared/src/task_tracking_canonical_keys.ts`. Parses `## Task Tracking` line-by-line; fails if any **top-level** key is outside the closed set `{mode, mcp_server, jira_ac_field, branch_template}`. Empty/whitespace lines and `### <Subsection>` content (e.g. `### Linear`) are scoped out — tracker-specific metadata (project IDs, team names) belongs under sub-headings, not as Schema L keys. Vacuous when the section is absent (`mode: none` canonical form). Catches the smoke-test drift where `/setup` emitted non-canonical `linear_*` keys at the top level. Migration helper: `scripts/migrate-task-tracking-canonical.ts` (dry-run only, prints unified diff to stdout). Test coverage: `tests/gate-check-task-tracking-canonical-keys.test.ts`.";
    const now = readFileSync(join(REPO, GATE_CHECK_REL), "utf8");
    const reverted = now
      .split("\n")
      .map((l) => (l.startsWith("21. **") ? trunkEntry : l))
      .join("\n");
    expect(probe21SentenceViolations(reverted)).toContain('probe #21 still says "belongs under sub-headings"');
  });

  test("AC-.12 control: removing the heading-anchor note turns AC-.3 red", () => {
    const text = readFileSync(PATTERNS_MD, "utf8");
    const para = anchorParagraph(text);
    expect(para).not.toBe("");
    expect(anchorNoteViolations(text.replace(para, ANCHOR_TRUNK_LINE)).length).toBeGreaterThan(0);
  });

  test("AC-.9 control: the trunk gate-check fails the both-arm check", () => {
    // dbdb9572's probe entries carry no settings arm; the check must say so.
    const trunkLike = readFileSync(join(REPO, GATE_CHECK_REL), "utf8")
      .split("\n")
      .map((l) => l.replace(/specs\/settings\.yaml/g, "CLAUDE.md"))
      .join("\n");
    expect(bothArmViolations(trunkLike).length).toBeGreaterThan(0);
  });
});
