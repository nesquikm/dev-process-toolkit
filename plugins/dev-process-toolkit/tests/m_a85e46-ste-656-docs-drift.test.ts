// STE-656 (M_a85e46) — docs and archived specs say what the shipped code does.
//
// Each AC leg reds at the pre-change base for the reason its AC states; the
// legs labelled CONTROL hold on both sides (AC-STE-656.8 is all control).
//
// Pins are by pattern, never by line number. The archived-spec legs (AC.5)
// diff against the pre-change base commit `BASE_SHA`, not HEAD, so they stay
// meaningful once this change is committed.

import { describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTaskTrackingWorkspaceBindingPresentProbe } from "../adapters/_shared/src/task_tracking_workspace_binding_present";
import { ORDERED_UNREACHABLE_PIN, runModuleReachabilityProbe } from "../adapters/_shared/src/module_reachability";
import { jiraClaudeMdText, writeFr, writePlan } from "./_repoint_fixture";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
/** The pre-change base of STE-656: v2.92.0 on main (cb6145c1). Every file read here is byte-identical there and at the pre-STE-656 branch tip, and a main commit cannot be orphaned by a rebase or squash of this branch. */
const BASE_SHA = "cb6145c1";
const STE_TOKEN_RE = /\b(?:STE|AC-STE)-\d+(?:\.\d+)?\b/g;
const MODULE = "commit_producing_skill_branch_gate";

const read = (rel: string): string => readFileSync(join(PLUGIN_ROOT, rel), "utf-8");
const readRepo = (rel: string): string => readFileSync(join(REPO_ROOT, rel), "utf-8");
const atBase = (repoRel: string): string =>
  execFileSync("git", ["-C", REPO_ROOT, "show", `${BASE_SHA}:${repoRel}`], { encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 });
const steTokens = (text: string): number => (text.match(STE_TOKEN_RE) ?? []).length;

/** Collapse line breaks (and a comment leader on the next line) so a phrase split across lines reads as one. */
function flat(text: string): string {
  return text.replace(/\n[ \t]*(?:\/\/|\*|#)?[ \t]*/g, " ");
}

/** The sentences of `text` (flattened) that contain `needle`. */
function sentencesNaming(text: string, needle: string): string[] {
  return flat(text)
    .split(/(?<=[.;!?])\s+(?=[A-Z`(*\[])/)
    .filter((s) => s.includes(needle));
}

// ===========================================================================
// AC-STE-656.1 — three skill pages stop calling the branch-gate module a probe
// ===========================================================================

const SKILL_PAGES = ["skills/spec-research/SKILL.md", "skills/deps-research/SKILL.md", "skills/report-issue/SKILL.md"];

describe("AC-STE-656.1 — no skill page calls commit_producing_skill_branch_gate a probe", () => {
  for (const rel of SKILL_PAGES) {
    test(`AC-STE-656.1: ${rel} has no sentence naming ${MODULE} that calls it a probe`, () => {
      const hits = sentencesNaming(read(rel), MODULE);
      expect(hits.length, `${rel} still names the module`).toBeGreaterThan(0);
      const offending = hits.filter((s) => /\bprobes?\b/i.test(s));
      expect(offending, `sentences calling ${MODULE} a probe in ${rel}`).toEqual([]);
    });

    test(`AC-STE-656.1: ${rel} still names the module and the NON_COMMIT_PRODUCING_SKILLS allowlist`, () => {
      const text = read(rel);
      expect(text).toContain(`${MODULE}.ts`);
      expect(text).toContain("NON_COMMIT_PRODUCING_SKILLS");
      expect(text).toContain("STE-228");
    });

    test(`AC-STE-656.1: ${rel} keeps its pinned counts — split-line count and STE-token count equal the base`, () => {
      const now = read(rel);
      const base = atBase(`plugins/dev-process-toolkit/${rel}`);
      expect(steTokens(now)).toBe(steTokens(base));
      expect(now.split("\n").length).toBe(base.split("\n").length);
    });
  }

  test("CONTROL: the base text did call the module a probe in each of the three pages (the leg can fail)", () => {
    for (const rel of SKILL_PAGES) {
      const base = atBase(`plugins/dev-process-toolkit/${rel}`);
      expect(sentencesNaming(base, MODULE).some((s) => /\bprobe\b/.test(s)), rel).toBe(true);
    }
  });
});

// ===========================================================================
// AC-STE-656.2 — the source comment drops "probe #33"
// ===========================================================================

describe("AC-STE-656.2 — first_turn_refusal_marker.ts no longer numbers the branch-gate module a probe", () => {
  const REL = "adapters/_shared/src/first_turn_refusal_marker.ts";

  test("AC-STE-656.2: the file does not cite 'probe #33'", () => {
    expect(flat(read(REL))).not.toMatch(/probe\s*#\s*33\b/);
  });

  test(`AC-STE-656.2: no 'probe #<n>' sits directly before ${MODULE} in the file`, () => {
    expect(flat(read(REL))).not.toMatch(new RegExp(`probe\\s*#\\s*\\d+\\s*\`?${MODULE}`));
  });

  test("CONTROL: the base file cited probe #33 for the module across a line break (the flattening sees it)", () => {
    expect(flat(atBase(`plugins/dev-process-toolkit/${REL}`))).toMatch(new RegExp(`probe #33 \`${MODULE}\``));
  });
});

// ===========================================================================
// AC-STE-656.3 — the hooks reference states the D-5/D-6/D-7 refusals
// ===========================================================================

const HOOK_SRC = "templates/hooks/_lib/hooks/pre-tracker-write-gate.ts";

/** The body of a `### <heading>` sub-section, up to the next `##`/`###` heading. */
function subsection(text: string, heading: string): string {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.trim() === `### ${heading}`);
  if (start < 0) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^#{2,3} /.test(l));
  return (end < 0 ? rest : rest.slice(0, end)).join("\n");
}

const gateSection = (): string => subsection(read("docs/hooks-reference.md"), "pre-tracker-write-gate");

/** The shipped refusal fragments, each with the hook-source literal it must match. */
const SHIPPED = [
  { name: "D-5 receipt location", fragments: ["this session's receipts were announced in", "checkouts of one repository", "different repositories"] },
  { name: "D-6 unreadable receipt directory", fragments: ["announced receipt file(s) could not be read", "and were ignored"] },
  { name: "D-7 other-session receipt", fragments: ["belong to another session", "authorise nothing in this one"] },
];

describe("AC-STE-656.3 — the tracker-write gate section names the three receipt refusals in their shipped wording", () => {
  test("CONTROL: the section is found and every fragment is shipped by the hook source", () => {
    expect(gateSection().length).toBeGreaterThan(2000);
    const src = read(HOOK_SRC);
    for (const r of SHIPPED) for (const f of r.fragments) expect(src, `${r.name}: ${f}`).toContain(f);
  });

  for (const r of SHIPPED) {
    test(`AC-STE-656.3: the section states the ${r.name} refusal in its shipped wording`, () => {
      const s = flat(gateSection());
      for (const f of r.fragments) expect(s, `${r.name}: "${f}"`).toContain(f);
    });
  }

  test("AC-STE-656.3: the unreadable-directory refusal is said to name the errno code", () => {
    const s = flat(gateSection());
    const hits = sentencesNaming(s, "could not be read").filter((x) => /errno|EACCES/.test(x));
    expect(hits.length).toBeGreaterThan(0);
  });

  test("AC-STE-656.3: the other-session refusal is said to name that session's id", () => {
    const s = flat(gateSection());
    const hits = sentencesNaming(s, "another session").filter((x) => /session(?:'s)? id|session id/i.test(x));
    expect(hits.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// AC-STE-656.4 — the CLAUDE.md template names both install shapes
// ===========================================================================

describe("AC-STE-656.4 — templates/CLAUDE.md.template names the cache path under $CLAUDE_CONFIG_DIR and the in-place directory-source install", () => {
  /** The paragraph that points the reader at docs/hooks-reference.md. */
  const manualParagraph = (): string => {
    const paras = read("templates/CLAUDE.md.template").split(/\n\s*\n/);
    return paras.filter((p) => p.includes("docs/hooks-reference.md")).join("\n\n");
  };

  test("CONTROL: the template has a paragraph naming docs/hooks-reference.md", () => {
    expect(manualParagraph().length).toBeGreaterThan(0);
  });

  test("AC-STE-656.4: the copied cache path is spelled under $CLAUDE_CONFIG_DIR", () => {
    expect(manualParagraph()).toMatch(/\$\{?CLAUDE_CONFIG_DIR\}?\/plugins\/cache\/dev-process-toolkit\/dev-process-toolkit\/<version>\/docs\/hooks-reference\.md/);
  });

  test("AC-STE-656.4: the in-place directory-source install is named", () => {
    const p = flat(manualParagraph());
    const hits = sentencesNaming(p, "director").filter((s) => /in[- ]place/i.test(s));
    expect(hits.length, "a sentence naming a directory-source install loaded in place").toBeGreaterThan(0);
  });
});

// ===========================================================================
// AC-STE-656.5 — the two archived specs gain exactly one amendment clause each
// ===========================================================================

/** Index just past the `)` closing the `(` at `open`, or -1. */
function closeParen(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

interface Inserted {
  clause: string;
  at: number;
}

/** The ONE `*(Amended by …)*` clause whose removal turns `now` back into `base`, or null. */
function soleInsertedClause(now: string, base: string): Inserted | null {
  const re = /\*\(Amended by /g;
  for (let m = re.exec(now); m !== null; m = re.exec(now)) {
    const end = closeParen(now, m.index + 1);
    if (end < 0 || now[end] !== "*") continue;
    const clause = now.slice(m.index, end + 1);
    for (const start of [m.index - 1, m.index]) {
      if (start < m.index && now[start] !== " ") continue;
      if (now.slice(0, start) + now.slice(end + 1) === base) return { clause, at: m.index };
    }
  }
  return null;
}

const AMENDED = [
  {
    rel: "specs/frs/archive/STE-603.md",
    amendingFr: "STE-647",
    where: "the AC-STE-603.2 line",
    inRegion: (text: string, at: number): boolean => {
      const lineStart = text.lastIndexOf("\n", at) + 1;
      return text.slice(lineStart).startsWith("- AC-STE-603.2:");
    },
  },
  {
    rel: "specs/frs/archive/STE-607.md",
    amendingFr: "STE-649",
    where: "§1 Wiring or §2 Classification",
    inRegion: (text: string, at: number): boolean => {
      const s1 = text.indexOf("\n### 1. Wiring");
      const s3 = text.indexOf("\n### 3. Target resolution");
      return s1 >= 0 && s3 > s1 && at > s1 && at < s3;
    },
  },
];

describe("AC-STE-656.5 — STE-603 and STE-607 each carry one amendment clause, and nothing else changes", () => {
  for (const a of AMENDED) {
    test(`AC-STE-656.5: ${a.rel} differs from the base by exactly one inserted amendment clause`, () => {
      const now = readRepo(a.rel);
      const base = atBase(a.rel);
      expect(now, `${a.rel} is unchanged from the base`).not.toBe(base);
      const ins = soleInsertedClause(now, base);
      expect(ins, `no single *(Amended by …)* clause accounts for the whole diff of ${a.rel}`).not.toBeNull();
    });

    test(`AC-STE-656.5: the clause in ${a.rel} names ${a.amendingFr} and its version, and sits in ${a.where}`, () => {
      const now = readRepo(a.rel);
      const ins = soleInsertedClause(now, atBase(a.rel));
      expect(ins).not.toBeNull();
      expect(ins!.clause).toMatch(new RegExp(`^\\*\\(Amended by \`${a.amendingFr}\` \\(v2\\.92\\.0\\)`));
      expect(ins!.clause).not.toContain("\n");
      expect(a.inRegion(now, ins!.at), `clause position in ${a.rel}`).toBe(true);
    });
  }

  test("CONTROL: the clause finder accepts an R4 insertion and rejects a second edit (synthetic)", () => {
    const base = "- AC-X.2: the floor rises. tail\n";
    const good = "- AC-X.2: the floor rises. *(Amended by `STE-1` (v1.0.0): it stays (unless `--floor`).)* tail\n";
    expect(soleInsertedClause(good, base)?.clause).toBe("*(Amended by `STE-1` (v1.0.0): it stays (unless `--floor`).)*");
    expect(soleInsertedClause(good.replace("tail", "TAIL"), base)).toBeNull();
    expect(soleInsertedClause(base, base)).toBeNull();
  });
});

// ===========================================================================
// AC-STE-656.6 — probe #25's two remedies name a command that writes the fix
// ===========================================================================

/** The `Remedy:` line of a probe message. */
const remedyOf = (message: string): string => message.split("\n").find((l) => l.startsWith("Remedy:")) ?? "";

/** The backticked commands of a remedy that write something, in the order the remedy names them. */
function writeCommands(remedy: string): string[] {
  return [...remedy.matchAll(/`([^`]+)`/g)]
    .map((m) => m[1]!)
    .filter((s) => /^(?:bun|git|mv|mkdir)\s/.test(s))
    .filter((s) => !/^git\s+(?:status|diff|log|show)\b/.test(s));
}

const shq = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

/**
 * Run the first write command the remedy names, verbatim but for the two
 * placeholders the probe cannot know (`<projectRoot>`, `<project>`), from the
 * fixture root with CLAUDE_PLUGIN_ROOT set. Fails on any other placeholder.
 */
function runRemedy(remedy: string, root: string, project: string): { command: string; status: number | null; output: string } {
  const cmds = writeCommands(remedy);
  expect(cmds.length, `the remedy names no write command: ${remedy}`).toBeGreaterThan(0);
  const command = cmds[0]!.replaceAll("<projectRoot>", shq(root)).replaceAll("<project>", shq(project));
  const left = command.match(/<[A-Za-z][\w.-]*>/g) ?? [];
  expect(left, `placeholders a verbatim run cannot fill in: ${command}`).toEqual([]);
  const r = spawnSync("bash", ["-c", command], {
    cwd: root,
    encoding: "utf-8",
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT },
    timeout: 60_000,
  });
  return { command, status: r.status, output: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function scratch(prefix: string): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), prefix));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function gitCommitAll(root: string): void {
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", root, "-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", ...args], { encoding: "utf-8" });
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-q", "-m", "fixture");
}

describe("AC-STE-656.6 — probe #25's missing-project remedy names a command that writes the fix", () => {
  const CASES = [
    { name: "Jira", body: ["## Task Tracking", "", "mode: jira", "", "### Jira", ""].join("\n"), project: "ENG" },
    { name: "Linear", body: ["## Task Tracking", "", "mode: linear", "", "### Linear", "team: STE"].join("\n"), project: "DPT" },
  ];

  for (const c of CASES) {
    test(`AC-STE-656.6: ${c.name} missing project — the remedy's command, run verbatim, writes project: and the probe turns green`, async () => {
      const t = scratch("dpt-ste656-p25-missing-");
      try {
        writeFileSync(join(t.root, "CLAUDE.md"), c.body);
        const before = await runTaskTrackingWorkspaceBindingPresentProbe(t.root);
        expect(before.violations.length).toBe(1);
        expect(before.violations[0]!.note).toMatch(/project/);
        const run = runRemedy(remedyOf(before.violations[0]!.message), t.root, c.project);
        expect(run.status, `${run.command}\n${run.output}`).toBe(0);
        expect(readFileSync(join(t.root, "CLAUDE.md"), "utf-8")).toContain(`project: ${c.project}`);
        const after = await runTaskTrackingWorkspaceBindingPresentProbe(t.root);
        expect(after.violations).toEqual([]);
      } finally {
        t.cleanup();
      }
    }, 90_000);
  }

  test("AC-STE-656.6: the missing-project remedy no longer routes to the print-only migration helper", async () => {
    const t = scratch("dpt-ste656-p25-helper-");
    try {
      writeFileSync(join(t.root, "CLAUDE.md"), CASES[0]!.body);
      const r = await runTaskTrackingWorkspaceBindingPresentProbe(t.root);
      expect(remedyOf(r.violations[0]!.message)).not.toMatch(/migrate-task-tracking-add-workspace\.ts to generate a diff/);
    } finally {
      t.cleanup();
    }
  });
});

describe("AC-STE-656.6 — probe #25's key-prefix remedy names a command that writes the fix", () => {
  test("AC-STE-656.6: a tracked GB-101 FR under `project: GF` — the remedy's first write command, run verbatim, turns the probe green", async () => {
    const t = scratch("dpt-ste656-p25-keyprefix-");
    try {
      mkdirSync(join(t.root, "specs", "frs", "archive"), { recursive: true });
      mkdirSync(join(t.root, "specs", "plan", "archive"), { recursive: true });
      writeFileSync(join(t.root, "CLAUDE.md"), jiraClaudeMdText({ project: "GF" }));
      writePlan(t.root, "M_GF_80", "active");
      const fr = writeFr(t.root, "GB-101", "M_GF_80", "active");
      gitCommitAll(t.root);
      const before = await runTaskTrackingWorkspaceBindingPresentProbe(t.root);
      const hits = before.violations.filter((v) => v.note.startsWith("specs/frs/GB-101.md:"));
      expect(hits.length).toBe(1);
      expect(before.violations.length).toBe(1);
      const run = runRemedy(remedyOf(hits[0]!.message), t.root, "GF");
      expect(run.status, `${run.command}\n${run.output}`).toBe(0);
      const after = await runTaskTrackingWorkspaceBindingPresentProbe(t.root);
      expect(after.violations, `after running: ${run.command}`).toEqual([]);
      // The command wrote the fix: the active FR at its original path is gone or no longer active.
      const stillActive = existsSync(fr) && /^status: active$/m.test(readFileSync(fr, "utf-8"));
      expect(stillActive).toBe(false);
    } finally {
      t.cleanup();
    }
  }, 90_000);

  test("CONTROL: the key-prefix remedy still names the repoint command (the STE-612 pin)", async () => {
    const t = scratch("dpt-ste656-p25-repoint-");
    try {
      writeFileSync(join(t.root, "CLAUDE.md"), jiraClaudeMdText({ project: "GF" }));
      writeFr(t.root, "GB-101", "M_GF_80", "active");
      const r = await runTaskTrackingWorkspaceBindingPresentProbe(t.root);
      expect(r.violations[0]!.message).toMatch(/^Remedy: .*repoint_tracker_binding\.ts/m);
    } finally {
      t.cleanup();
    }
  });
});

// ===========================================================================
// AC-STE-656.7 — the Import/Adopt consent docs say the key must be in the question text
// ===========================================================================

const CONSENT_DOCS = ["docs/resolver-entry.md", "docs/ticket-binding.md", "docs/implement-tracker-mode.md", "docs/spec-write-tracker-mode.md"];
const LABEL_RE = /(?:Import|Adopt) `?<KEY>`?/;

/** Lines within `radius` of every consent-label occurrence, flattened. */
function aroundLabels(text: string, radius: number): string[] {
  const lines = text.split("\n");
  const out: string[] = [];
  lines.forEach((l, i) => {
    if (LABEL_RE.test(l)) out.push(flat(lines.slice(Math.max(0, i - radius), i + radius + 1).join("\n")));
  });
  return out;
}

/** A sentence that says the ask's question text must name the key. */
const KEY_IN_QUESTION = (s: string): boolean =>
  /question/i.test(s) && /\btext\b/i.test(s) && /(?:<KEY>|\bkey\b)/i.test(s);

describe("AC-STE-656.7 — the Import/Adopt consent docs state the key must appear in the question text", () => {
  test("CONTROL: the hook's consentedBefore reads only a question that names the key (namesKey on the question)", () => {
    const src = read(HOOK_SRC);
    const body = src.slice(src.indexOf("function consentedBefore("), src.indexOf("interface OwnershipContext"));
    expect(body).toMatch(/consentVerdict\(.*\(q\) => namesKey\(q, key\)\)/);
    expect(read("adapters/_shared/src/join_consent_ownership.ts")).toMatch(/!names\(question\)\) return false/);
  });

  for (const rel of CONSENT_DOCS) {
    test(`AC-STE-656.7: ${rel} says, beside its Import/Adopt label, that the key must appear in the question text`, () => {
      const windows = aroundLabels(read(rel), 10);
      expect(windows.length, `${rel} names an Import/Adopt label`).toBeGreaterThan(0);
      const ok = windows.some((w) =>
        w.split(/(?<=[.;])\s+/).some(KEY_IN_QUESTION),
      );
      expect(ok, `${rel}: no sentence near the label says the key must be in the question text`).toBe(true);
    });
  }

  test("AC-STE-656.7: docs/hooks-reference.md's tracker-write gate section says an Import/Adopt question's own text must name the key", () => {
    const sentences = flat(gateSection()).split(/(?<=[.;])\s+/);
    const hits = sentences.filter((s) => /\b(?:Import|Adopt)\b/.test(s) && KEY_IN_QUESTION(s));
    expect(hits.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// AC-STE-656.8 — pinned counts and the doc-conformance suites stay green (CONTROL)
// ===========================================================================

describe("AC-STE-656.8 — pinned counts and doc-conformance suites stay green (control)", () => {
  test("AC-STE-656.8: gate-check SKILL.md measures 356 split-lines and 87 STE tokens", () => {
    const skill = read("skills/gate-check/SKILL.md");
    expect(skill.split("\n").length).toBe(356);
    expect(steTokens(skill)).toBe(87);
  });

  test("AC-STE-656.8: reachability probe #81's ordered-unreachable count stays within ORDERED_UNREACHABLE_PIN", async () => {
    const report = await runModuleReachabilityProbe(REPO_ROOT);
    expect(typeof report.orderedUnreachable).toBe("number");
    expect(report.orderedUnreachable).toBeLessThanOrEqual(ORDERED_UNREACHABLE_PIN);
  }, 120_000);

  test("AC-STE-656.8: every doc-conformance suite and the hooks-reference install-shapes suite pass (their pre-existing legs)", () => {
    const suites = [
      "tests/report-issue-doc-conformance.test.ts",
      "tests/spec-research-doc-conformance.test.ts",
      "tests/branch-gate-doc-conformance.test.ts",
      "tests/brainstorm-doc-conformance.test.ts",
      "tests/branch-type-derivation-doc-conformance.test.ts",
      "tests/implement-doc-conformance.test.ts",
      "tests/spec-write-doc-conformance.test.ts",
      "tests/hooks-reference-install-shapes.test.ts",
    ];
    // The AC-STE-656.1 legs added to two of these suites are graded by AC.1;
    // this control runs everything else in them.
    const r = spawnSync("bun", ["test", "-t", "^(?!.*AC-STE-656)", ...suites], { cwd: PLUGIN_ROOT, encoding: "utf-8", timeout: 240_000 });
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    expect(r.status, out.split("\n").filter((l) => /\(fail\)|error/i.test(l)).slice(0, 20).join("\n")).toBe(0);
    expect(out).toMatch(/\b0 fail\b/);
  }, 300_000);
});
