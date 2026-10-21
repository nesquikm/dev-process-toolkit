// M_0cac80 / STE-681 — "Probe 88 grades each bug section where it belongs".
//
// WHAT THE IMPLEMENTER WRITES.
//
//   adapters/_shared/src/bug_fr_shape.ts (probe #88)
//     * looks `### Steps to reproduce` / `### Expected` / `### Actual` up under
//       `## Requirement` and `### Root cause` under `## Technical Design`; one
//       found under any other `##` section is a violation naming the section it
//       was found under, reported as misplaced (never as missing);
//     * an AC whose body is `Regression:` followed by nothing or only a TODO
//       marker no longer satisfies the regression piece.
//   adapters/_shared/src/import.ts
//     * `importFromTracker` moves a ticket-supplied `### Root cause` (heading
//       and body, up to the next heading) out of the description and under
//       `## Technical Design`.
//   docs/resolver-entry.md § Bug FR body, skills/spec-write/SKILL.md,
//   specs/technical-spec.md Schema Q — the prose half (AC-STE-681.5).
//
// Filter by AC with `bun test -t "AC-STE-681.N"`.

import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { importFromTracker, ticketImportOwnership } from "../adapters/_shared/src/import";
import type { FRMetadata, FRSpec, LockResult, Provider, SyncResult } from "../adapters/_shared/src/provider";

// ---------------------------------------------------------------------------
// Paths + helpers
// ---------------------------------------------------------------------------

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const MODULE_REL = "adapters/_shared/src/bug_fr_shape.ts";
const MODULE_ABS = join(PLUGIN_ROOT, ...MODULE_REL.split("/"));
const RESOLVER_ENTRY = join(PLUGIN_ROOT, "docs", "resolver-entry.md");
const SPEC_WRITE_SKILL = join(PLUGIN_ROOT, "skills", "spec-write", "SKILL.md");
const TECH_SPEC = join(REPO_ROOT, "specs", "technical-spec.md");

const NTR_PLACEHOLDER = "[needs technical review — run /spec-write STE-901 to complete]";

const read = (p: string): string => readFileSync(p, "utf-8");

const roots: string[] = [];
function tempRoot(slug: string): string {
  const r = mkdtempSync(join(tmpdir(), `ste681-${slug}-`));
  roots.push(r);
  return r;
}
afterAll(() => {
  // Plain fixture dirs only — none of them is a git repository.
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

function writeRel(root: string, rel: string, body: string): void {
  const abs = join(root, ...rel.split("/"));
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body);
}

// ---------------------------------------------------------------------------
// Probe access
// ---------------------------------------------------------------------------

interface Violation {
  readonly file: string;
  readonly line: number;
  readonly reason: string;
  readonly note: string;
  readonly message: string;
  readonly severity: string;
}
interface Report {
  readonly violations: readonly Violation[];
  readonly notes: readonly string[];
  readonly vacuous: boolean;
}
type ProbeFn = (projectRoot: string) => Report | Promise<Report>;

async function runOn(root: string): Promise<Report> {
  if (!existsSync(MODULE_ABS)) throw new Error(`${MODULE_REL} does not exist`);
  const mod = (await import(MODULE_ABS)) as Record<string, unknown>;
  const fn = mod["runBugFrShapeProbe"];
  if (typeof fn !== "function") throw new Error(`${MODULE_REL} does not export \`runBugFrShapeProbe\``);
  return await (fn as ProbeFn)(root);
}

/** Violations whose reason names `piece` (case-insensitive). */
const naming = (r: Report, piece: string): Violation[] =>
  r.violations.filter((v) => v.reason.toLowerCase().includes(piece.toLowerCase()));

// ---------------------------------------------------------------------------
// Bug FR fixtures — every `##` section is given as raw lines, so a subsection
// can be placed under any parent.
// ---------------------------------------------------------------------------

const sub = (title: string, body: string): string[] => [`### ${title}`, "", body, ""];

const STEPS = sub("Steps to reproduce", "1. Open the login page.\n2. Click Sign in with SSO.");
const EXPECTED = sub("Expected", "The dashboard opens.");
const ACTUAL = sub("Actual", "A 500 error: `TypeError: token is undefined`.");
const ROOT = sub("Root cause", "`src/auth.ts:42` assumes the SSO token is always present.");
const FILLED_REGRESSION = "Regression: `tests/auth.test.ts › sso token` fails before the fix and passes after it.";
const GOOD_ACS = [FILLED_REGRESSION, "The SSO login lands on the dashboard."];

const PIECE_LINES: Record<string, string[]> = {
  "Steps to reproduce": STEPS,
  Expected: EXPECTED,
  Actual: ACTUAL,
  "Root cause": ROOT,
};

interface FrOpts {
  ntr?: boolean;
  summary?: string[];
  requirement?: string[];
  acs?: string[];
  tech?: string[];
  testing?: string[];
  notes?: string[];
}

function bugFr(o: FrOpts = {}): string {
  const fm = [
    "---",
    "title: Bug STE-901",
    "milestone: M_0cac80",
    "status: active",
    "archived_at: null",
    "tracker:",
    "  linear: STE-901",
    ...(o.ntr ? ["needs_technical_review: true"] : []),
    "created_at: 2026-10-21T00:00:00Z",
    "changelog_category: Fixed",
    "kind: bug",
    "---",
    "",
  ];
  const acs = o.acs ?? GOOD_ACS;
  return [
    ...fm,
    "# Bug STE-901",
    "",
    "## Summary",
    "",
    "A login bug.",
    "",
    ...(o.summary ?? []),
    "## Requirement",
    "",
    ...(o.requirement ?? [...STEPS, ...EXPECTED, ...ACTUAL]),
    "## Acceptance Criteria",
    "",
    ...acs.map((a, i) => `- AC-STE-901.${i + 1}: ${a}`),
    "",
    "## Technical Design",
    "",
    "Guard the token.",
    "",
    ...(o.tech ?? ROOT),
    "## Testing",
    "",
    "Unit test.",
    "",
    ...(o.testing ?? []),
    "## Notes",
    "",
    "None.",
    "",
    ...(o.notes ?? []),
  ].join("\n");
}

/** The fixture with `piece` moved out of its home section and under `## <found>` instead. */
function misplaced(piece: string, found: string): FrOpts {
  const requirement = ["Steps to reproduce", "Expected", "Actual"]
    .filter((p) => p !== piece)
    .flatMap((p) => PIECE_LINES[p]!);
  const o: FrOpts = { requirement };
  o.tech = piece === "Root cause" ? [] : ROOT;
  const lines = PIECE_LINES[piece]!;
  switch (found) {
    case "Summary":
      o.summary = lines;
      break;
    case "Requirement":
      o.requirement = [...requirement, ...lines];
      break;
    case "Technical Design":
      o.tech = [...(o.tech ?? []), ...lines];
      break;
    case "Testing":
      o.testing = lines;
      break;
    case "Notes":
      o.notes = lines;
      break;
    default:
      throw new Error(`unknown section ${found}`);
  }
  return o;
}

/** 1-based line of the `### <piece>` heading that follows the `## <parent>` heading. */
function headingLineUnder(body: string, parent: string, piece: string): number {
  const lines = body.split("\n");
  const p = lines.indexOf(`## ${parent}`);
  if (p < 0) throw new Error(`fixture has no ## ${parent}`);
  const i = lines.indexOf(`### ${piece}`, p + 1);
  if (i < 0) throw new Error(`fixture has no ### ${piece} after ## ${parent}`);
  return i + 1;
}

const FR_REL = "specs/frs/STE-901.md";

function project(body: string): string {
  const root = tempRoot("probe");
  mkdirSync(join(root, "specs", "frs", "archive"), { recursive: true });
  writeRel(root, FR_REL, body);
  return root;
}

/** Assert exactly one violation, reported as misplaced (not missing), naming the piece and the section found. */
function expectMisplaced(r: Report, piece: string, found: string, body: string): void {
  expect(r.violations.map((v) => v.reason)).toHaveLength(1);
  const v = r.violations[0]!;
  expect(v.reason).toContain(piece);
  expect(v.reason).toContain(found);
  expect(v.reason).toMatch(/misplaced/i);
  expect(v.reason).not.toMatch(/\bhas no\b|\bmissing\b/i);
  expect(v.file).toBe(FR_REL);
  expect(v.line).toBe(headingLineUnder(body, found, piece));
  expect(v.note).toBe(`${FR_REL}:${v.line} — ${v.reason}`);
  expect(v.severity).toBe("error");
  expect(v.message.startsWith("bug_fr_shape: ")).toBe(true);
}

// ===========================================================================
// AC-STE-681.1 — the named regression test
// ===========================================================================

describe("AC-STE-681.1 — regression", () => {
  test("a Steps to reproduce subsection under Technical Design is reported", async () => {
    const body = bugFr(misplaced("Steps to reproduce", "Technical Design"));
    const root = project(body);
    const r = await runOn(root);
    expectMisplaced(r, "Steps to reproduce", "Technical Design", body);

    // The CLI front door (the FR's step 2) exits non-zero on it.
    const cli = Bun.spawnSync(["bun", "run", MODULE_ABS, root], { cwd: PLUGIN_ROOT });
    expect(cli.exitCode).toBe(1);
    expect(cli.stdout.toString()).toContain("Steps to reproduce");
  });
});

// ===========================================================================
// AC-STE-681.2 — every subsection is graded under its own parent
// ===========================================================================

describe("AC-STE-681.2 — a bug subsection under the wrong `##` section is reported as misplaced", () => {
  test("control: a well-placed bug FR is clean", async () => {
    const r = await runOn(project(bugFr()));
    expect(r.violations).toEqual([]);
  });

  const RECORD_ELSEWHERE = ["Summary", "Technical Design", "Testing", "Notes"];
  for (const piece of ["Steps to reproduce", "Expected", "Actual"]) {
    for (const found of RECORD_ELSEWHERE) {
      test(`\`### ${piece}\` only under ## ${found} → one misplaced violation naming ## ${found}`, async () => {
        const body = bugFr(misplaced(piece, found));
        expectMisplaced(await runOn(project(body)), piece, found, body);
      });
    }
  }

  for (const found of ["Summary", "Requirement", "Testing", "Notes"]) {
    test(`\`### Root cause\` only under ## ${found} → one misplaced violation naming ## ${found}`, async () => {
      const body = bugFr(misplaced("Root cause", found));
      expectMisplaced(await runOn(project(body)), "Root cause", found, body);
    });
  }

  test("a stray copy under the wrong section is reported even when the home copy is filled", async () => {
    const body = bugFr({ notes: EXPECTED });
    expectMisplaced(await runOn(project(body)), "Expected", "Notes", body);
  });

  test("a stray `### Root cause` under ## Requirement is reported beside a filled home copy", async () => {
    const body = bugFr({ requirement: [...STEPS, ...EXPECTED, ...ACTUAL, ...ROOT] });
    expectMisplaced(await runOn(project(body)), "Root cause", "Requirement", body);
  });

  test("a misplaced `### Root cause` is reported even on a flagged FR whose placeholder satisfies the piece", async () => {
    const body = bugFr({ ntr: true, tech: [NTR_PLACEHOLDER, ""], testing: ROOT });
    expectMisplaced(await runOn(project(body)), "Root cause", "Testing", body);
  });

  test("a filled subsection found only in the wrong place does not satisfy the piece's own fill check", async () => {
    // Before the fix the whole-file lookup let the stray copy satisfy the piece: zero violations.
    const r = await runOn(project(bugFr(misplaced("Actual", "Notes"))));
    expect(naming(r, "Actual")).toHaveLength(1);
  });
});

// ===========================================================================
// AC-STE-681.3 — an empty or TODO-only Regression: AC does not count
// ===========================================================================

describe("AC-STE-681.3 — a `Regression:` AC with no body or only a TODO marker does not satisfy the piece", () => {
  const HOLLOW: readonly string[] = [
    "Regression:",
    "Regression:   ",
    "Regression: TODO",
    "Regression: TODO — name the test that reproduces the reported failure; it fails before the fix and passes after it.",
    "Regression: TODO: name the test.",
    "Regression: todo",
  ];
  for (const ac of HOLLOW) {
    test(`\`${ac}\` → exactly one violation naming the regression criterion`, async () => {
      const r = await runOn(project(bugFr({ acs: [ac, "The SSO login lands on the dashboard."] })));
      expect(r.violations.map((v) => v.reason)).toHaveLength(1);
      expect(naming(r, "Regression")).toHaveLength(1);
    });
  }

  test("control: a filled `Regression:` AC beside a TODO one satisfies the piece", async () => {
    const r = await runOn(project(bugFr({ acs: ["Regression: TODO", FILLED_REGRESSION] })));
    expect(r.violations).toEqual([]);
  });

  test("a freshly imported bug FR with no supplied regression stays red on the regression piece", async () => {
    const root = await importInto("jira", "GK-681", jiraTicket("GK-681", "Bug"), {
      description: "Filed from the board.",
      acs: ["Thing works."],
    });
    const body = read(join(root, "specs", "frs", "GK-681.md"));
    expect(body).toMatch(/- AC-GK-681\.\d+: Regression: TODO/);
    const r = await runOn(root);
    expect(naming(r, "Regression")).toHaveLength(1);
  });
});

// ===========================================================================
// Import fixtures (AC-STE-681.3 / .4)
// ===========================================================================

type Mode = "jira" | "linear";

function writeClaudeMd(root: string, mode: Mode): void {
  const lines = [
    "# Fixture Project",
    "",
    "## Task Tracking",
    "",
    `mode: ${mode}`,
    `mcp_server: ${mode === "jira" ? "atlassian" : "linear"}`,
    "",
    mode === "jira" ? "### Jira" : "### Linear",
    "",
    ...(mode === "linear" ? ["team: STE"] : []),
    mode === "jira" ? "project: GK" : "project: DPT",
    "",
    "## Verification",
    "",
    "run_cmd: none",
    "",
  ];
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "CLAUDE.md"), lines.join("\n"));
}

function jiraTicket(key: string, type: string): Record<string, unknown> {
  return {
    key,
    fields: {
      summary: `Ticket ${key}`,
      labels: [],
      issuetype: { name: type, hierarchyLevel: 0 },
      status: { name: "To Do" },
      project: { key: "GK" },
      creator: { displayName: "Someone" },
      description: "Filed from the board.",
    },
  };
}

function linearTicket(key: string, labels: string[]): Record<string, unknown> {
  return {
    id: key,
    title: `Issue ${key}`,
    labels: [...labels],
    description: "Filed from the board.",
    createdBy: "Someone",
    project: "DPT",
    team: "Example Team Display Name",
    status: "Backlog",
  };
}

class StubProvider implements Provider {
  readonly mode = "tracker" as const;
  constructor(private readonly meta: { title: string; description: string; acs: string[] }) {}
  async listMilestones(): Promise<{ name: string }[]> {
    return [];
  }
  async listActiveFRs(): Promise<string[]> {
    return [];
  }
  async getMetadata(id: string): Promise<FRMetadata> {
    const m = {
      id,
      title: this.meta.title,
      milestone: "",
      status: "active",
      tracker: {},
      inFlightBranch: null,
      assignee: null,
    } as FRMetadata;
    (m as unknown as Record<string, unknown>)["description"] = this.meta.description;
    (m as unknown as Record<string, unknown>)["acs"] = this.meta.acs;
    return m;
  }
  async sync(_spec: FRSpec): Promise<SyncResult> {
    return { kind: "ok", updated: [], conflicts: [], message: "ok" };
  }
  getUrl(): string | null {
    return null;
  }
  async claimLock(): Promise<LockResult> {
    return { kind: "claimed", branch: null, message: "" };
  }
  async releaseLock(): Promise<"transitioned" | "already-released"> {
    return "already-released";
  }
  async getTicketStatus(): Promise<{ status: string }> {
    return { status: "local-no-tracker" };
  }
  filenameFor(spec: FRSpec): string {
    const tracker = spec.frontmatter["tracker"] as Record<string, string>;
    return `${Object.values(tracker)[0]}.md`;
  }
}

/** Import one ticket into a fresh project root; return the root. */
async function importInto(
  mode: Mode,
  key: string,
  ticket: Record<string, unknown>,
  meta: { description: string; acs: string[] },
): Promise<string> {
  const root = tempRoot(`imp-${mode}`);
  writeClaudeMd(root, mode);
  mkdirSync(join(root, "specs", "frs"), { recursive: true });
  await importFromTracker(
    mode,
    key,
    new StubProvider({ title: `Ticket ${key}`, description: meta.description, acs: meta.acs }),
    join(root, "specs"),
    async () => "M_0cac80",
    ticketImportOwnership(root, ticket),
  );
  return root;
}

/** The `## <name>` section a `### <heading>` sits under (first occurrence). */
function parentSection(body: string, heading: string): string | null {
  const lines = body.split("\n");
  const i = lines.findIndex((l) => l.trim() === `### ${heading}`);
  if (i < 0) return null;
  for (let j = i - 1; j >= 0; j--) {
    const m = /^## (.+)$/.exec(lines[j]!);
    if (m) return m[1]!.trim();
  }
  return null;
}

/** Body of `### <heading>` up to the next heading, trimmed. */
function subsectionBody(body: string, heading: string): string | null {
  const lines = body.split("\n");
  const i = lines.findIndex((l) => l.trim() === `### ${heading}`);
  if (i < 0) return null;
  const out: string[] = [];
  for (const l of lines.slice(i + 1)) {
    if (/^#{1,6} /.test(l)) break;
    out.push(l);
  }
  return out.join("\n").trim();
}

/** Text of the `## <name>` section, through its subsections, up to the next `#`/`##`. */
function topSection(body: string, name: string): string {
  const lines = body.split("\n");
  const i = lines.indexOf(`## ${name}`);
  if (i < 0) return "";
  const out: string[] = [];
  for (const l of lines.slice(i + 1)) {
    if (/^#{1,2} /.test(l)) break;
    out.push(l);
  }
  return out.join("\n");
}

const SUPPLIED_ROOT_BODY = "`src/auth.ts:42` assumes the SSO token is always present.\nIt was never checked.";
const FULL_DESCRIPTION = [
  "### Steps to reproduce",
  "",
  "1. Open login.",
  "2. Click SSO.",
  "",
  "### Expected",
  "",
  "The dashboard opens.",
  "",
  "### Actual",
  "",
  "A 500 error.",
  "",
  "### Root cause",
  "",
  SUPPLIED_ROOT_BODY,
].join("\n");

// ===========================================================================
// AC-STE-681.4 — import moves a supplied Root cause under Technical Design
// ===========================================================================

describe("AC-STE-681.4 — import moves a ticket-supplied `### Root cause` under `## Technical Design`", () => {
  for (const mode of ["jira", "linear"] as const) {
    test(`${mode}: the supplied Root cause (heading + body) lands under ## Technical Design, once`, async () => {
      const key = mode === "jira" ? "GK-682" : "STE-982";
      const ticket = mode === "jira" ? jiraTicket(key, "Bug") : linearTicket(key, ["Bug"]);
      const root = await importInto(mode, key, ticket, { description: FULL_DESCRIPTION, acs: [FILLED_REGRESSION] });
      const body = read(join(root, "specs", "frs", `${key}.md`));
      expect(body.split("\n").filter((l) => l.trim() === "### Root cause")).toHaveLength(1);
      expect(parentSection(body, "Root cause")).toBe("Technical Design");
      expect(subsectionBody(body, "Root cause")).toBe(SUPPLIED_ROOT_BODY);
      expect(topSection(body, "Requirement")).not.toContain("Root cause");
      expect(topSection(body, "Requirement")).not.toContain("never checked");
      for (const h of ["Steps to reproduce", "Expected", "Actual"]) {
        expect({ h, parent: parentSection(body, h) }).toEqual({ h, parent: "Requirement" });
      }
    });
  }

  test("a Root cause in the middle of the description takes its body only — the next heading stays in Requirement", async () => {
    const description = [
      "### Steps to reproduce",
      "",
      "1. Open login.",
      "",
      "### Root cause",
      "",
      "The token is unchecked.",
      "",
      "### Expected",
      "",
      "The dashboard opens.",
      "",
      "### Actual",
      "",
      "A 500 error.",
    ].join("\n");
    const root = await importInto("jira", "GK-683", jiraTicket("GK-683", "Bug"), {
      description,
      acs: [FILLED_REGRESSION],
    });
    const body = read(join(root, "specs", "frs", "GK-683.md"));
    expect(parentSection(body, "Root cause")).toBe("Technical Design");
    expect(subsectionBody(body, "Root cause")).toBe("The token is unchecked.");
    expect(parentSection(body, "Expected")).toBe("Requirement");
    expect(subsectionBody(body, "Expected")).toBe("The dashboard opens.");
    expect(topSection(body, "Requirement")).not.toContain("The token is unchecked.");
  });

  test("an imported Jira Bug supplying all four subsections and a filled Regression: AC passes probe #88", async () => {
    const root = await importInto("jira", "GK-684", jiraTicket("GK-684", "Bug"), {
      description: FULL_DESCRIPTION,
      acs: [FILLED_REGRESSION, "Thing works."],
    });
    const r = await runOn(root);
    expect(r.violations.map((v) => v.note)).toEqual([]);
    expect(r.vacuous).toBe(false);
  });
});

// ===========================================================================
// AC-STE-681.5 — the prose half
// ===========================================================================

/** Paragraphs (blank-line separated) of `text`. */
const paragraphs = (text: string): string[] => text.split(/\n\s*\n/);

/** The `## <heading>` section of a markdown doc, up to the next `## `. */
function docSection(text: string, headingPrefix: string): string {
  const lines = text.split("\n");
  const i = lines.findIndex((l) => l.startsWith(headingPrefix));
  if (i < 0) return "";
  const level = /^#+/.exec(headingPrefix)![0].length;
  const out: string[] = [];
  for (const l of lines.slice(i + 1)) {
    const m = /^(#+) /.exec(l);
    if (m && m[1]!.length <= level) break;
    out.push(l);
  }
  return out.join("\n");
}

const SUPPLIED_ROOT_RE = /supplied (?:`?###\s*)?Root cause/i;

function expectRootCauseProse(text: string, where: string): void {
  const ps = paragraphs(text);
  const placed = ps.filter((p) => SUPPLIED_ROOT_RE.test(p) && p.includes("## Technical Design"));
  expect({ where, placed: placed.length > 0 }).toEqual({ where, placed: true });
  const noTech = ps.filter(
    (p) => SUPPLIED_ROOT_RE.test(p) && p.includes("## Technical Design") && p.includes("--no-tech") && /placeholder/i.test(p),
  );
  expect({ where, noTech: noTech.length > 0 }).toEqual({ where, noTech: true });
}

describe("AC-STE-681.5 — docs say where a supplied Root cause is written; Schema Q lists `kind`", () => {
  test("docs/resolver-entry.md § Bug FR body: a supplied Root cause goes under ## Technical Design, also under --no-tech", () => {
    const section = docSection(read(RESOLVER_ENTRY), "## Bug FR body");
    expect(section.length).toBeGreaterThan(0);
    expectRootCauseProse(section, "resolver-entry.md § Bug FR body");
  });

  test("skills/spec-write/SKILL.md: a supplied Root cause goes under ## Technical Design, also under --no-tech", () => {
    expectRootCauseProse(read(SPEC_WRITE_SKILL), "spec-write SKILL.md");
  });

  test("specs/technical-spec.md Schema Q lists `kind` as an optional key whose only value is `bug`", () => {
    const schemaQ = docSection(read(TECH_SPEC), "### Schema Q");
    expect(schemaQ.length).toBeGreaterThan(0);
    const kindLines = schemaQ
      .split("\n")
      .filter((l) => /`kind`|\bkind:/.test(l) && /optional/i.test(l) && /`bug`|kind: bug/.test(l) && /\bonly\b/i.test(l));
    expect(kindLines.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// Phase 3 hardening — fenced code is not structure (review round 1)
// ===========================================================================

describe("STE-681 hardening — a fenced code block is never read as a heading or an AC", () => {
  const FENCED_STEPS = [
    "### Steps to reproduce",
    "",
    "1. Run:",
    "",
    "```bash",
    "# from a clean clone",
    "bun test",
    "```",
    "",
  ];

  test("a `# comment` inside a fenced block under ## Requirement does not unseat the next subsections", async () => {
    const r = await runOn(project(bugFr({ requirement: [...FENCED_STEPS, ...EXPECTED, ...ACTUAL] })));
    expect(r.violations.map((v) => v.reason)).toEqual([]);
  });

  test("a `### Expected` quoted in a fenced block under ## Technical Design is not a misplaced subsection", async () => {
    const tech = [...ROOT, "The emitter writes this block:", "", "```markdown", "### Expected", "", "<what>", "```", ""];
    const r = await runOn(project(bugFr({ tech })));
    expect(r.violations.map((v) => v.reason)).toEqual([]);
  });

  test("a fenced `# comment` inside a subsection body does not cut the body short", async () => {
    const steps = ["### Steps to reproduce", "", "```bash", "# setup", "```", "", "1. Open login.", ""];
    const r = await runOn(project(bugFr({ requirement: [...steps, ...EXPECTED, ...ACTUAL] })));
    expect(r.violations.map((v) => v.reason)).toEqual([]);
  });

  test("a filled `Regression:` AC quoted in a fenced block does not satisfy a TODO-only regression piece", async () => {
    const tech = [...ROOT, "```markdown", `- AC-STE-901.9: ${FILLED_REGRESSION}`, "```", ""];
    const r = await runOn(project(bugFr({ acs: ["Regression: TODO — name the test.", "Thing works."], tech })));
    expect(naming(r, "Regression")).toHaveLength(1);
  });

  test("a filled `Regression:` AC line outside ## Acceptance Criteria does not satisfy the piece", async () => {
    const notes = [`- AC-STE-901.9: ${FILLED_REGRESSION}`, ""];
    const r = await runOn(project(bugFr({ acs: ["Thing works."], notes })));
    expect(naming(r, "Regression")).toHaveLength(1);
  });
});

describe("STE-681 hardening — import splits a supplied Root cause whole", () => {
  test("a fenced `# comment` in the supplied Root cause moves with it, fence intact", async () => {
    const rootBody = ["The token is unchecked:", "", "```ts", "# not a heading", "const t = token!;", "```"].join("\n");
    const description = [...FULL_DESCRIPTION.split("\n").slice(0, 12), "", "### Root cause", "", rootBody].join("\n");
    const root = await importInto("jira", "GK-690", jiraTicket("GK-690", "Bug"), { description, acs: [FILLED_REGRESSION] });
    const body = read(join(root, "specs", "frs", "GK-690.md"));
    expect(topSection(body, "Requirement")).not.toContain("```");
    // topSection is not fence-aware, so place the moved block by position instead.
    const at = body.indexOf(`### Root cause\n\n${rootBody}`);
    expect(at).toBeGreaterThan(body.indexOf("## Technical Design"));
    expect(body.indexOf("## Testing")).toBeGreaterThan(at);
    expect((await runOn(root)).violations.map((v) => v.reason)).toEqual([]);
  });

  test("a supplied `### Root Cause` (any case) is moved and gets no second TODO Root cause", async () => {
    const description = FULL_DESCRIPTION.replace("### Root cause", "### Root Cause");
    const root = await importInto("jira", "GK-691", jiraTicket("GK-691", "Bug"), { description, acs: [FILLED_REGRESSION] });
    const body = read(join(root, "specs", "frs", "GK-691.md"));
    expect(body.split("\n").filter((l) => /^### root cause\s*$/i.test(l))).toHaveLength(1);
    expect(topSection(body, "Requirement")).not.toMatch(/root cause/i);
    expect(topSection(body, "Technical Design")).toContain(SUPPLIED_ROOT_BODY);
  });
});
