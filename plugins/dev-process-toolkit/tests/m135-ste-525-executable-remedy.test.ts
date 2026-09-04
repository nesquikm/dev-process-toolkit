// M135 / STE-525 — "The mismatch remedy names an operation that exists".
//
// Three surfaces order `/spec-write --rename-milestone M<N>`, a flag that has
// never existed on that skill, and the same sentence names Linear while being
// rendered for Jira bindings. These tests pin the replacement:
//
//   AC.1  no surface under skills/ or adapters/ ORDERS the flag
//   AC.2  ...proven by a positive control through the SAME scan + SAME roots
//   AC.3  the replacement remedy is binding-aware (object / label / epic)
//   AC.4  every operation a remedy names exists (path on disk, call in adapter docs,
//         skill + flag in that skill's SKILL.md)
//   AC.5  the sibling half-pin is strengthened to FAIL on the flag (both directions)
//   AC.6  all three surfaces updated, parity asserted, each individually falsifiable
//   AC.7  the "tracker side is correct → edit the plan heading" half is preserved
//   AC.8  the epic remedy reflects Epic-by-key resolution, not a rename
//
// Scan scoping (AC.1) is deliberate: the flag string also lives in `tests/` as a
// RECORDED PRE-CHANGE CONSTANT (tests/m120-ste-444-jira-binding-prose.test.ts) and
// inside the half-pin's own matcher. Those are evidence and machinery, not orders.
// A repo-wide scan could never reach zero and would have to be weakened until it
// proved nothing.

import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, relative } from "node:path";
import { MilestoneAttachmentError } from "../adapters/_shared/src/attach_project_milestone";
import { runTrackerProjectMilestoneAttachedProbe } from "../adapters/_shared/src/tracker_project_milestone_attached";

const PLUGIN_ROOT = join(import.meta.dir, "..");

/** The flag this FR removes. Recorded once, referenced everywhere. */
const FLAG = "--rename-milestone";

/**
 * The pre-change remedy string, recorded verbatim from
 * `adapters/_shared/src/tracker_project_milestone_attached.ts:178` at `deaf32d`.
 * This is the MUTANT for AC.5: the strengthened assertion must reject it.
 * It lives in tests/ (outside the AC.1 scan roots) as evidence, not as an order.
 */
const PRE_CHANGE_REMEDY =
  "If the local plan-file heading is correct, run /spec-write --rename-milestone M<N> " +
  "to rename the Linear milestone to match. If the tracker side is correct, " +
  "edit specs/plan/M<N>.md heading to match.";

// ---------------------------------------------------------------------------
// The scan (AC.1 + AC.2) — ONE function, ONE root list, used by both.
// ---------------------------------------------------------------------------

/** Roots that ORDER operations to operators. Named in every assertion message. */
const SCAN_ROOT_NAMES = ["skills", "adapters"] as const;

const TEXT_EXTS = new Set([
  ".md",
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".sh",
  ".yaml",
  ".yml",
  ".txt",
]);

interface ScanHit {
  file: string;
  line: number;
  root: string;
}

interface ScanResult {
  token: string;
  /** Plugin-relative root paths, in scan order — echoed into every assertion. */
  roots: string[];
  filesScanned: number;
  hits: ScanHit[];
  /** Human-readable provenance line; asserted on so the roots land in the diff. */
  summary: string;
}

function listTextFiles(dir: string, acc: string[]): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) listTextFiles(p, acc);
    else if (entry.isFile() && TEXT_EXTS.has(extname(entry.name))) acc.push(p);
  }
  return acc;
}

/**
 * Scan the ORDERING surfaces for `token`.
 *
 * Throws when a root does not resolve. A scan rooted one level too high (at the
 * repository root rather than the plugin directory) returns zero exactly like a
 * clean tree does — this repo has been bitten by that. Absence must be loud.
 */
function scanOrderingSurfaces(token: string): ScanResult {
  const roots: string[] = [];
  const hits: ScanHit[] = [];
  let filesScanned = 0;
  for (const name of SCAN_ROOT_NAMES) {
    const abs = join(PLUGIN_ROOT, name);
    if (!existsSync(abs)) {
      throw new Error(
        `scanOrderingSurfaces: root "${name}" does not resolve at ${abs} — ` +
          `the scan would report a vacuous zero. PLUGIN_ROOT=${PLUGIN_ROOT}`,
      );
    }
    roots.push(name);
    for (const file of listTextFiles(abs, [])) {
      filesScanned++;
      const lines = readFileSync(file, "utf-8").split("\n");
      lines.forEach((text, i) => {
        if (text.includes(token)) {
          hits.push({ file: relative(PLUGIN_ROOT, file), line: i + 1, root: name });
        }
      });
    }
  }
  return {
    token,
    roots,
    filesScanned,
    hits,
    summary: `scanned roots [${roots.join(", ")}] under ${relative(process.cwd(), PLUGIN_ROOT) || "."} — ${filesScanned} files — for "${token}"`,
  };
}

const hitLabels = (r: ScanResult): string[] => r.hits.map((h) => `${h.file}:${h.line}`);

describe("AC-STE-525.1 — no ordering surface names the flag", () => {
  test(`no file under skills/ or adapters/ orders ${FLAG}`, () => {
    const scan = scanOrderingSurfaces(FLAG);
    // The summary carries the searched roots INTO the asserted value, so a
    // failure diff always states what was scoped.
    expect([scan.summary, ...hitLabels(scan)]).toEqual([scan.summary]);
  });
});

describe("AC-STE-525.2 — the scan is proven to be looking at something", () => {
  test("same function, same roots, a token known present → non-zero", () => {
    const control = scanOrderingSurfaces("runTrackerProjectMilestoneAttachedProbe");
    expect({
      summary: control.summary,
      nonZero: control.hits.length > 0,
      rootsCovered: [...new Set(control.hits.map((h) => h.root))].sort(),
    }).toEqual({
      summary: control.summary,
      nonZero: true,
      // Both roots must produce a hit — a one-entry root list is the other way
      // a scoped scan quietly stops looking at half its subject.
      rootsCovered: ["adapters", "skills"],
    });
  });

  test("the two scans share their root list byte-for-byte", () => {
    expect(scanOrderingSurfaces(FLAG).roots).toEqual(
      scanOrderingSurfaces("runTrackerProjectMilestoneAttachedProbe").roots,
    );
  });
});

// ---------------------------------------------------------------------------
// Driving the probe for a real violation message, per binding.
// ---------------------------------------------------------------------------

// STE-540 adds `milestone-id`: the binding an identifier-bound Linear
// milestone verifies on. Enumerated HERE, alongside the probe bindings, so
// the new remedy is subject to AC.4's "every operation a remedy names
// exists" audit instead of escaping it.
type Binding = "object" | "label" | "epic" | "milestone-id";

interface BindingCase {
  binding: Binding;
  /** Full rendered violation message (reason + Remedy + Context). */
  message: string;
  /** The `Remedy: …` line, minus its label. */
  remedy: string;
  /** Fixture root — used to resolve file paths the remedy names. */
  root: string;
  /** The fixture's milestone token, substituted for `M<N>` placeholders. */
  milestone: string;
  cleanup: () => void;
}

const CASE_SPEC: Record<Binding, { milestone: string; title: string; trackerKey: string; ticket: string }> = {
  object: { milestone: "M31", title: "Tracker Workflow Hardening", trackerKey: "linear", ticket: "STE-117" },
  label: { milestone: "M31", title: "Tracker Workflow Hardening", trackerKey: "jira", ticket: "DST-42" },
  epic: { milestone: "M_DST_42", title: "Epic Keyed Milestone", trackerKey: "jira", ticket: "DST-9" },
  "milestone-id": { milestone: "M_3fa85f", title: "Waiting States II", trackerKey: "linear", ticket: "STE-540" },
};

function makeFixture(binding: Binding): { root: string; milestone: string } {
  const spec = CASE_SPEC[binding];
  const root = mkdtempSync(join(tmpdir(), "ste525-"));
  mkdirSync(join(root, "specs", "frs", "archive"), { recursive: true });
  mkdirSync(join(root, "specs", "plan"), { recursive: true });
  writeFileSync(
    join(root, "CLAUDE.md"),
    `# Fixture\n\n## Task Tracking\n\nmode: ${spec.trackerKey}\n`,
    "utf-8",
  );
  writeFileSync(
    join(root, "specs", "frs", `${spec.ticket}.md`),
    [
      "---",
      "title: Fixture FR",
      `milestone: ${spec.milestone}`,
      "status: active",
      "tracker:",
      `  ${spec.trackerKey}: ${spec.ticket}`,
      "---",
      "",
      "# Fixture FR",
      "",
      "## Notes",
      "",
      "No capability tokens declared.",
      "",
    ].join("\n"),
    "utf-8",
  );
  writeFileSync(
    join(root, "specs", "plan", `${spec.milestone}.md`),
    `## ${spec.milestone} — ${spec.title}\n`,
    "utf-8",
  );
  return { root, milestone: spec.milestone };
}

/**
 * Produce the ONE violation the probe renders for a binding failure under
 * `binding`. Object → a name mismatch. Label → the expected label absent.
 * Epic → no parent Epic sanitizing to the expected token.
 */
async function bindingCase(binding: Binding): Promise<BindingCase> {
  const { root, milestone } = makeFixture(binding);
  const cleanup = () => rmSync(root, { recursive: true, force: true });
  // STE-540 — the `milestone-id` remedy is not a probe verdict. It is the
  // `MilestoneAttachmentError` an identifier-bound Linear milestone raises
  // when the read-back identifier derives to a different token, so it is
  // driven from the error itself rather than through the probe fixture.
  if (binding === "milestone-id") {
    try {
      const err = new (MilestoneAttachmentError as unknown as new (
        expected: string,
        actual: string | null,
        binding: string,
        identifier?: string,
      ) => MilestoneAttachmentError)(
        milestone,
        "M_a1b2c3",
        "milestone-id",
        "3fa85f64-5717-4562-b3fc-2c963f66afa6",
      );
      const line = err.message.split("\n").find((l) => l.startsWith("Remedy: "));
      if (line === undefined) {
        throw new Error(`bindingCase(milestone-id): message has no \`Remedy: \` line:\n${err.message}`);
      }
      return {
        binding,
        message: err.message,
        remedy: line.slice("Remedy: ".length),
        root,
        milestone,
        cleanup,
      };
    } catch (e) {
      cleanup();
      throw e;
    }
  }
  try {
    const issue =
      binding === "object"
        ? { projectMilestone: { name: `${milestone} — A Stale Name` } }
        : binding === "label"
          ? { labels: ["some-other-label"] }
          : { parent: null };
    const report = await runTrackerProjectMilestoneAttachedProbe(root, {
      getIssue: async () => issue,
      ...(binding === "object" ? {} : { milestoneBinding: binding }),
    });
    if (report.violations.length !== 1) {
      cleanup();
      throw new Error(
        `bindingCase(${binding}): expected exactly 1 violation, got ${report.violations.length} ` +
          `(advisories: ${report.advisories.length}) — the fixture no longer reaches the remedy under test`,
      );
    }
    const message = report.violations[0]!.message;
    const remedyLine = message.split("\n").find((l) => l.startsWith("Remedy: "));
    if (remedyLine === undefined) {
      cleanup();
      throw new Error(`bindingCase(${binding}): message has no \`Remedy: \` line:\n${message}`);
    }
    return { binding, message, remedy: remedyLine.slice("Remedy: ".length), root, milestone, cleanup };
  } catch (e) {
    cleanup();
    throw e;
  }
}

describe("AC-STE-525.3 — the replacement remedy is binding-aware", () => {
  test("object binding: remedy names no non-existent flag", async () => {
    const c = await bindingCase("object");
    try {
      expect(c.remedy).not.toContain(FLAG);
      expect(c.remedy.length).toBeGreaterThan(0);
    } finally {
      c.cleanup();
    }
  });

  // COVERAGE NOTE, recorded rather than left for a reader to discover: the two
  // cases below drive the MISSING remedy, not the mismatch one. `kind:
  // "mismatch"` has a single call site, inside the object branch's
  // `attached !== heading`, and `attached` is only ever set from
  // `projectMilestone.name` — so the epic and label mismatch arms are
  // unreachable today and no test covers them. What these cases do pin is real
  // and is the defect this FR closed: the remedy an epic/label operator
  // actually receives names a Jira surface and never says Linear.
  test("label binding: names a Jira surface, never says Linear", async () => {
    const c = await bindingCase("label");
    try {
      expect(c.remedy).toMatch(/mcp__atlassian__/);
      expect(c.remedy).not.toMatch(/\bLinear\b/i);
      expect(c.remedy).not.toContain(FLAG);
    } finally {
      c.cleanup();
    }
  });

  test("epic binding: names a Jira surface, never says Linear", async () => {
    const c = await bindingCase("epic");
    try {
      expect(c.remedy).toMatch(/mcp__atlassian__/);
      expect(c.remedy).not.toMatch(/\bLinear\b/i);
      expect(c.remedy).not.toContain(FLAG);
    } finally {
      c.cleanup();
    }
  });

  test("the four remedies are pairwise distinct (binding-aware, not one fixed string)", async () => {
    const cases = await Promise.all([
      bindingCase("object"),
      bindingCase("label"),
      bindingCase("epic"),
      bindingCase("milestone-id"),
    ]);
    try {
      expect(new Set(cases.map((c) => c.remedy)).size).toBe(4);
    } finally {
      cases.forEach((c) => c.cleanup());
    }
  });
});

// ---------------------------------------------------------------------------
// AC.4 — every named operation exists.
// ---------------------------------------------------------------------------

const SLASH_CMD_RE = /(?<=^|[\s(])\/([a-z][a-z0-9-]*)((?:[ \t]+--[a-z0-9-]+)*)/g;
const MCP_CALL_RE = /mcp__([a-z]+)__([A-Za-z_]+)/g;
const SPECS_PATH_RE = /\bspecs\/[A-Za-z0-9_<>\/.-]+\.md\b/g;

const ADAPTER_DOC_BY_NS: Record<string, string> = {
  linear: "adapters/linear.md",
  atlassian: "adapters/jira.md",
};

describe("AC-STE-525.4 — every operation a remedy names exists", () => {
  test("named skills, flags, tracker calls and file paths all resolve", async () => {
    const cases = await Promise.all([
      bindingCase("object"),
      bindingCase("label"),
      bindingCase("epic"),
      bindingCase("milestone-id"),
    ]);
    try {
      const skills: { skill: string; flags: string[]; from: Binding }[] = [];
      const mcpCalls: { ns: string; call: string; from: Binding }[] = [];
      const paths: { path: string; resolved: string; from: Binding }[] = [];

      for (const c of cases) {
        for (const m of c.remedy.matchAll(SLASH_CMD_RE)) {
          skills.push({
            skill: m[1]!,
            flags: (m[2] ?? "").split(/\s+/).filter((f) => f.startsWith("--")),
            from: c.binding,
          });
        }
        for (const m of c.remedy.matchAll(MCP_CALL_RE)) {
          mcpCalls.push({ ns: m[1]!, call: m[0]!, from: c.binding });
        }
        for (const m of c.remedy.matchAll(SPECS_PATH_RE)) {
          // A path carrying a PLACEHOLDER is bound to the fixture's milestone
          // before resolving — but only when the placeholder is the RIGHT SHAPE
          // for this binding. The first version of this substitution rewrote
          // any `M<N>` to the fixture's real token unconditionally, which
          // substituted the defect away: the epic remedy pointed at the numeric
          // `specs/plan/M<N>.md` while an Epic-keyed milestone lives at
          // `specs/plan/M_<epic-key>.md`, and the test resolved a path the
          // operator is never given. Now the epic binding accepts only the
          // Epic-keyed placeholder, so pointing it at the numeric form fails
          // here instead of passing.
          const literal = m[0]!;
          const epicKeyed = literal.includes("M_<epic-key>");
          const numeric = /M<N>/.test(literal);
          const shapeOk = c.binding === "epic" ? epicKeyed : numeric || epicKeyed;
          const bound = literal.replace(/M_<epic-key>/g, c.milestone).replace(/M<N>/g, c.milestone);
          paths.push({
            path: shapeOk ? literal : `${literal} (wrong placeholder shape for the ${c.binding} binding)`,
            resolved: shapeOk ? join(c.root, bound) : join(c.root, "__wrong-placeholder-shape__"),
            from: c.binding,
          });
        }
      }

      // Vacuity guard: an existence check over an empty set proves nothing.
      expect({
        skills: skills.length > 0,
        mcpCalls: mcpCalls.length > 0,
        paths: paths.length > 0,
      }).toEqual({ skills: true, mcpCalls: true, paths: true });

      // Every named skill exists on disk.
      expect(
        skills
          .filter((s) => !existsSync(join(PLUGIN_ROOT, "skills", s.skill, "SKILL.md")))
          .map((s) => `${s.from}: /${s.skill} → skills/${s.skill}/SKILL.md missing`),
      ).toEqual([]);

      // Every flag named on a skill appears in that skill's own SKILL.md.
      const badFlags: string[] = [];
      for (const s of skills) {
        const skillPath = join(PLUGIN_ROOT, "skills", s.skill, "SKILL.md");
        if (!existsSync(skillPath)) continue;
        const src = readFileSync(skillPath, "utf-8");
        for (const flag of s.flags) {
          if (!src.includes(flag)) badFlags.push(`${s.from}: /${s.skill} ${flag} → absent from skills/${s.skill}/SKILL.md`);
        }
      }
      expect(badFlags).toEqual([]);

      // VACUITY DISCLOSURE for the flag half. Today no remedy names any flag,
      // so the loop above checks nothing — `badFlags` is empty because there
      // was nothing to test, not because something passed. That is the correct
      // end state (the whole FR is about removing a flag that never existed),
      // but an empty result that reads like a pass is the exact shape this
      // milestone keeps finding, so it is disclosed rather than left implied.
      // The control proves the EXTRACTOR still works: run it on the verbatim
      // pre-change remedy and it must find the flag it was built to catch. If
      // the extractor silently stopped matching, the loop would go quiet in a
      // way indistinguishable from the clean tree above.
      const controlFlags = [...PRE_CHANGE_REMEDY.matchAll(SLASH_CMD_RE)].flatMap((m) =>
        (m[2] ?? "").trim().split(/\s+/).filter(Boolean),
      );
      const allFlags = skills.flatMap((s) => s.flags);
      expect({ liveFlagsChecked: allFlags.length, controlExtracted: controlFlags }).toEqual({
        liveFlagsChecked: 0,
        controlExtracted: ["--rename-milestone"],
      });

      // Every tracker call appears in that adapter's documented op list.
      const badCalls: string[] = [];
      for (const c of mcpCalls) {
        const doc = ADAPTER_DOC_BY_NS[c.ns];
        if (doc === undefined) {
          badCalls.push(`${c.from}: ${c.call} → no adapter doc known for namespace "${c.ns}"`);
          continue;
        }
        const docPath = join(PLUGIN_ROOT, doc);
        if (!existsSync(docPath)) {
          badCalls.push(`${c.from}: ${c.call} → adapter doc ${doc} missing`);
          continue;
        }
        if (!readFileSync(docPath, "utf-8").includes(c.call)) {
          badCalls.push(`${c.from}: ${c.call} → not in ${doc}`);
        }
      }
      expect(badCalls).toEqual([]);

      // Every named file path resolves on disk (placeholders bound to the fixture).
      expect(
        paths.filter((p) => !existsSync(p.resolved)).map((p) => `${p.from}: ${p.path} → ${p.resolved} missing`),
      ).toEqual([]);
    } finally {
      cases.forEach((c) => c.cleanup());
    }
  });
});

// ---------------------------------------------------------------------------
// AC.5 — the sibling half-pin is strengthened, mutation-verified both ways.
// ---------------------------------------------------------------------------

const SIBLING_TEST = join(PLUGIN_ROOT, "tests", "gate-check-tracker-project-milestone-attached.test.ts");
const MISMATCH_DESCRIBE = 'describe("hard fail: name mismatch"';
const MESSAGE_ASSERT_RE =
  /expect\(v\.message\)(\.not)?\.toMatch\(\s*\/((?:\\.|\[[^\]]*\]|[^/\\\n])+)\/([a-z]*)\s*\)/g;

interface MessageAssertion {
  source: string;
  negated: boolean;
  re: RegExp;
  /** True when this assertion, as written, is satisfied by `text`. */
  accepts: (text: string) => boolean;
}

function mismatchBlockAssertions(): MessageAssertion[] {
  const src = readFileSync(SIBLING_TEST, "utf-8");
  const start = src.indexOf(MISMATCH_DESCRIBE);
  if (start < 0) {
    throw new Error(
      `AC.5: could not locate ${MISMATCH_DESCRIBE} in ${relative(PLUGIN_ROOT, SIBLING_TEST)} — ` +
        "the block this AC strengthens was renamed or removed; re-point the test, do not delete it",
    );
  }
  const rest = src.slice(start + MISMATCH_DESCRIBE.length);
  const nextTop = rest.search(/\ndescribe\(/);
  const block = nextTop < 0 ? rest : rest.slice(0, nextTop);
  return [...block.matchAll(MESSAGE_ASSERT_RE)].map((m) => {
    const negated = m[1] === ".not";
    const re = new RegExp(m[2]!, m[3] ?? "");
    return {
      source: `${negated ? ".not" : ""}.toMatch(/${m[2]}/${m[3] ?? ""})`,
      negated,
      re,
      accepts: (text: string) => (negated ? !re.test(text) : re.test(text)),
    };
  });
}

describe("AC-STE-525.5 — the half-pin now FAILS on the flag", () => {
  test("the mismatch block still carries at least one v.message assertion", () => {
    expect(mismatchBlockAssertions().length).toBeGreaterThan(0);
  });

  test("every assertion in the block accepts the live replacement message", async () => {
    const c = await bindingCase("object");
    try {
      const asserts = mismatchBlockAssertions();
      expect(asserts.filter((a) => !a.accepts(c.message)).map((a) => a.source)).toEqual([]);
    } finally {
      c.cleanup();
    }
  });

  test("at least one assertion REJECTS the restored pre-change remedy", () => {
    const asserts = mismatchBlockAssertions();
    const mutant = [
      "tracker_project_milestone_attached: specs/frs/STE-117.md (linear:STE-117) projectMilestone mismatch",
      `Remedy: ${PRE_CHANGE_REMEDY}`,
      "Context: file=specs/frs/STE-117.md, probe=tracker_project_milestone_attached",
    ].join("\n");
    const discriminating = asserts.filter((a) => !a.accepts(mutant)).map((a) => a.source);
    expect({
      inspected: asserts.map((a) => a.source),
      discriminating: discriminating.length > 0,
    }).toEqual({ inspected: asserts.map((a) => a.source), discriminating: true });
  });
});

// ---------------------------------------------------------------------------
// AC.6 — three surfaces, each individually falsifiable, then parity.
// ---------------------------------------------------------------------------

const PROBE_MODULE = join(PLUGIN_ROOT, "adapters", "_shared", "src", "tracker_project_milestone_attached.ts");
const GATE_CHECK_SKILL = join(PLUGIN_ROOT, "skills", "gate-check", "SKILL.md");
/** The operator-actionable path all three surfaces must name (the AC.7 direction). */
const PLAN_PATH_TOKEN = "specs/plan/M<N>.md";

function probeRowRegion(): string {
  const lines = readFileSync(GATE_CHECK_SKILL, "utf-8").split("\n");
  const start = lines.findIndex((l) => /^26\. \*\*`tracker-project-milestone-attached`\*\*/.test(l));
  if (start < 0) throw new Error("AC.6: probe #26 row not found in skills/gate-check/SKILL.md");
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\d+\. \*\*`/.test(lines[i]!)) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

function moduleHeaderRegion(): string {
  const src = readFileSync(PROBE_MODULE, "utf-8");
  const firstImport = src.indexOf("\nimport ");
  if (firstImport <= 0) throw new Error("AC.6: no import statement found — cannot delimit the module header");
  return src.slice(0, firstImport);
}

function remedyBuilderRegion(): string {
  const src = readFileSync(PROBE_MODULE, "utf-8");
  const start = src.indexOf("function buildMessage(");
  if (start < 0) throw new Error("AC.6: buildMessage() not found in the probe module");
  const end = src.indexOf("\n}\n", start);
  if (end < 0) throw new Error("AC.6: could not find the end of buildMessage()");
  return src.slice(start, end + 3);
}

const SURFACES: { name: string; region: () => string }[] = [
  { name: "skills/gate-check/SKILL.md probe #26 row", region: probeRowRegion },
  { name: "tracker_project_milestone_attached.ts module header", region: moduleHeaderRegion },
  { name: "tracker_project_milestone_attached.ts buildMessage()", region: remedyBuilderRegion },
];

describe("AC-STE-525.6 — all three surfaces updated, parity asserted", () => {
  for (const s of SURFACES) {
    test(`${s.name}: does not order ${FLAG}`, () => {
      expect(s.region()).not.toContain(FLAG);
    });

    test(`${s.name}: names the executable remedy path ${PLAN_PATH_TOKEN}`, () => {
      expect(s.region()).toContain(PLAN_PATH_TOKEN);
    });
  }

  test("parity: all three agree — deleting the change from any ONE reddens this", () => {
    const flagged = SURFACES.map((s) => s.region().includes(FLAG));
    const planPathed = SURFACES.map((s) => s.region().includes(PLAN_PATH_TOKEN));
    expect({ names: SURFACES.map((s) => s.name), flagged, planPathed }).toEqual({
      names: SURFACES.map((s) => s.name),
      flagged: [false, false, false],
      planPathed: [true, true, true],
    });
  });

  // Two literals are not parity. This milestone's NINTH now-false statement hid
  // in exactly that gap: the gate-check probe row still called the epic
  // binding's mismatch remedy a rename — which STE-521 made false — while the
  // module header correctly carved `epic` out. Both surfaces lacked the flag
  // and both named the plan path, so the check above was green on two prose
  // surfaces that contradicted each other. What parity has to mean here is that
  // no surface still describes the epic binding as a NAME reconciliation.
  test("parity is about AGREEMENT: every surface states the epic carve-out", () => {
    // Proximity and sentence-scoping both fail here, and trying them was
    // instructive: the probe row legitimately names `epic` (as a failure
    // condition) in the same sentence as a rename clause correctly scoped to
    // the object and label bindings. So the property to pin is not the ABSENCE
    // of a word pairing — it is that each surface positively states the
    // carve-out. A surface that quietly drops it is one that has gone back to
    // describing epic mismatches as renames, which is how the ninth false
    // statement survived a green parity check.
    // The first version of this matched any incidental `epic` + `key`
    // co-occurrence, and BOTH prose surfaces already had one predating this FR
    // — so it killed 1 mutant of 3 while reading as a parity check. What is
    // specific to the carve-out is the NEGATIVE half: the Epic is resolved by
    // its key and NOT by its summary/name. That sentence exists only because
    // of this change, so dropping it is what the pin must catch.
    const statesCarveOut = SURFACES.map((s) =>
      /(?:never|not)\s+(?:by\s+)?(?:its\s+)?(?:summary|name)|summary\s+equality\s+is\s+not/i.test(
        s.region(),
      ),
    );
    expect({ names: SURFACES.map((s) => s.name), statesCarveOut }).toEqual({
      names: SURFACES.map((s) => s.name),
      statesCarveOut: [true, true, true],
    });
  });
});

// ---------------------------------------------------------------------------
// AC.7 — the accurate half survives.
// ---------------------------------------------------------------------------

describe("AC-STE-525.7 — the other direction is preserved", () => {
  test("object mismatch remedy still says: tracker side correct → edit the plan heading", async () => {
    const c = await bindingCase("object");
    try {
      expect(c.remedy).toMatch(/if the tracker side is correct/i);
      expect(c.remedy).toContain(PLAN_PATH_TOKEN);
      expect(c.remedy).toMatch(/heading/i);
    } finally {
      c.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// AC.8 — the epic remedy reflects Epic-by-key resolution.
// ---------------------------------------------------------------------------

/** Phrases that tell the operator names are NOT what binds under the epic binding. */
const NAME_NOT_CONSULTED_RE =
  /(not a binding failure|not by name|resolved by (its )?key|by key, not|name mismatch(es)? (no longer|do(es)? not|is not|are not)|summary is not consulted)/i;

describe("AC-STE-525.8 — epic binding: missing Epic key, not a rename", () => {
  test("remedy states the Epic is resolved by key, so a name mismatch does not bind", async () => {
    const c = await bindingCase("epic");
    try {
      expect(c.remedy).toMatch(NAME_NOT_CONSULTED_RE);
    } finally {
      c.cleanup();
    }
  });

  test("remedy points at the absent Epic key — naming the expected token", async () => {
    const c = await bindingCase("epic");
    try {
      expect(c.milestone).toBe("M_DST_42"); // fixture sanity: the token under test
      expect(c.remedy).toContain(c.milestone);
      expect(c.remedy).toMatch(/epic(['’]s)? key|parent epic/i);
    } finally {
      c.cleanup();
    }
  });

  test("remedy orders no rename of anything", async () => {
    const c = await bindingCase("epic");
    try {
      expect(c.remedy).not.toMatch(/\brename\b/i);
      expect(c.remedy).not.toContain(FLAG);
    } finally {
      c.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// The unreachability claim, pinned rather than asserted in prose.
//
// Both the module comment and this file's AC.3 coverage note state that
// `kind: "mismatch"` has exactly ONE call site, inside the object branch — the
// fact that makes the epic and label mismatch arms dead and makes AC.3's
// label/epic cases exercise the MISSING remedy instead. That claim is true
// today (verified), but it was prose on a surface this FR rewrote, which is
// precisely the class of statement that went false nine times in this
// milestone. The moment a future caller routes epic or label through
// `mismatch`, both notes become wrong silently and AC.3's stated coverage
// becomes a misdescription of what these tests check.
// ---------------------------------------------------------------------------
describe("STE-525 — the unreachability the coverage notes rely on is pinned", () => {
  test('`mismatch` has exactly one call site, and it is the object branch', () => {
    const src = readFileSync(
      join(PLUGIN_ROOT, "adapters", "_shared", "src", "tracker_project_milestone_attached.ts"),
      "utf-8",
    );
    // Comments are blanked so a note *about* mismatch cannot inflate the count.
    const code = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    // `(?<!function )` excludes the DECLARATION, whose signature carries the
    // `kind: "missing" | "mismatch"` type literal and would otherwise count as
    // a call site — a false 2 that would have made this pin fail for the wrong
    // reason and invited weakening it.
    const callSites = [...code.matchAll(/(?<!function )buildMessage\([^)]*"mismatch"/g)];
    expect(callSites.length).toBe(1);

    // …and it sits under the object-only mismatch condition. `attached` is
    // assigned solely from `projectMilestone.name`, so no other binding reaches
    // it. Asserting the guard rather than a line number keeps this readable
    // after a reflow.
    const idx = code.indexOf(callSites[0]![0]);
    const before = code.slice(Math.max(0, idx - 500), idx);
    expect(before).toMatch(/attached\s*!==\s*heading/);

    // Non-vacuity: the same scan finds the OTHER kind in more than one place,
    // so a scan that silently matched nothing could not read as clean here.
    expect(
      [...code.matchAll(/(?<!function )buildMessage\([^)]*"missing"/g)].length,
    ).toBeGreaterThan(1);
  });
});
