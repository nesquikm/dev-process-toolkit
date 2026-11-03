// STE-704 (M_9261c7) — a ticket create is decided from the searches the
// session actually ran.
//
// `create_idempotency_probe.ts decide` used to grade only saved page FILES,
// and nothing tied a file to the search `query` printed: a page from a
// narrower search (an extra `query` title filter, a changed label) read as a
// complete miss and authorised a duplicate create. The fix adds
//
//   decide <root> --from-transcript <transcript_path> <tool_use_id>... --title <t> --attempt <a>
//
// which reads each named search call AND its tool result out of the session
// transcript, and accepts a call only when its input equals the printed query
// exactly (+ the page cursor after the first page, + `cloudId` on Jira).
//
// Every behavioural case runs the SPAWNED command over a synthetic transcript
// written to a temp dir. The expected input objects are never hand-written:
// each test first runs `query <root>` and builds its calls from that line.
//
// MUTATION CONTROLS (AC-STE-704.7) — which named test reds for which mutation:
//
//   - drop the exact-input comparison (accept any list_issues /
//     searchJiraIssuesUsingJql input):
//       › a page from a narrowed search never authorises a create
//       › AC-STE-704.3 › Linear: an extra key refuses with page-violates-query
//       › AC-STE-704.3 › Linear: a changed value refuses with page-violates-query
//       › AC-STE-704.3 › Jira: a changed jql or an extra key refuses with page-violates-query
//       › AC-STE-704.5 › an extra `query` argument with an empty result refuses
//       › AC-STE-704.5 › a changed label with an empty result refuses
//
//   - let page files ride beside the flag (read them into the chain, or ignore
//     them and decide from the transcript alone):
//       › AC-STE-704.2 › page files passed with the flag are refused, and no file page is read
//
// Synthetic identities only: team ZZT, project FAKEPROJ / ZZ, tags fake-fe /
// fake-be, an all-a's cloudId, invented toolu_ ids.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeMd, makeSpanFixture, pluginManifest } from "./_span_fixture";

const pluginRoot = join(import.meta.dir, "..");
const MODULE = join(pluginRoot, "adapters", "_shared", "src", "create_idempotency_probe.ts");
const JIRA_ADAPTER = join(pluginRoot, "adapters", "jira.md");
const LINEAR_ADAPTER = join(pluginRoot, "adapters", "linear.md");
const SPEC_WRITE_SKILL = join(pluginRoot, "skills", "spec-write", "SKILL.md");
const UNCERTAIN = "tracker_idempotency_uncertain";

const TITLE = "The fake widget, repainted";
const TAG = "fake-fe";
const FOREIGN_TAG = "fake-be";
const CLOUD_ID = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001";

const LINEAR_TOOL = "mcp__linear__list_issues";
const LINEAR_TOOL_ALT = "mcp__claude_ai_Linear__list_issues";
const JIRA_TOOL = "mcp__atlassian__searchJiraIssuesUsingJql";

let manifestDir = "";
let scratch = "";
const SESSION = `ste704-${process.pid}`;

beforeAll(() => {
  manifestDir = mkdtempSync(join(tmpdir(), "dpt-ste704-manifest-"));
  pluginManifest(manifestDir, "2.87.0");
  scratch = mkdtempSync(join(tmpdir(), "dpt-ste704-scratch-"));
});

afterAll(() => {
  rmSync(manifestDir, { recursive: true, force: true });
  rmSync(scratch, { recursive: true, force: true });
});

// ---------------------------------------------------------------- harness

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

function runModule(args: string[]): Run {
  const proc = Bun.spawnSync(["bun", "run", MODULE, ...args], {
    env: {
      ...process.env,
      CLAUDE_PLUGIN_ROOT: manifestDir,
      CLAUDE_CODE_SESSION_ID: SESSION,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const signal = proc.signalCode ?? null;
  const stderr = proc.stderr.toString();
  return {
    code: proc.exitCode ?? -1,
    stdout: proc.stdout.toString(),
    stderr: signal === null ? stderr : `${stderr}\n[child killed by ${signal} — harness failure, not a verdict]`,
  };
}

function jsonLines(run: Run): Record<string, any>[] {
  return run.stdout
    .split("\n")
    .filter((l) => l.trim().startsWith("{"))
    .map((l) => JSON.parse(l));
}

/** The ONE JSON line a subcommand prints. */
function jsonLine(run: Run): Record<string, any> {
  const lines = jsonLines(run);
  expect(
    lines.length,
    `expected exactly one JSON line on stdout; code=${run.code}\nstdout=${run.stdout}\nstderr=${run.stderr}`,
  ).toBe(1);
  return lines[0]!;
}

/** A decide refusal: one JSON line, outcome refused, the uncertain capability. */
function expectRefusal(run: Run, reason?: string): Record<string, any> {
  const d = jsonLine(run);
  expect(d.outcome, `stdout=${run.stdout}\nstderr=${run.stderr}`).toBe("refused");
  expect(d.capability).toBe(UNCERTAIN);
  if (reason !== undefined) expect(d.reason).toBe(reason);
  return d;
}

function expectProvenAbsentCreate(run: Run): Record<string, any> {
  const d = jsonLine(run);
  expect(d.outcome, `stdout=${run.stdout}\nstderr=${run.stderr}`).toBe("create");
  expect(d.reason).toBe("proven-absent");
  return d;
}

function withRoot<T>(body: (root: string) => T): T {
  const fx = makeSpanFixture("M_ZZ_1", { repositories: false });
  try {
    return body(fx.b);
  } finally {
    fx.cleanup();
  }
}

function declareLinear(root: string): void {
  claudeMd(root, {
    mode: "linear",
    team: "ZZT",
    project: "FAKEPROJ",
    defaultLabels: [TAG],
    repoTag: TAG,
    minDptVersion: "2.87.0",
  });
}

function declareJira(root: string): void {
  claudeMd(root, {
    mode: "jira",
    project: "ZZ",
    defaultLabels: [TAG],
    repoTag: TAG,
    minDptVersion: "2.87.0",
  });
}

/** The exact search object `query <root>` prints. */
function printedQuery(root: string): Record<string, unknown> {
  const run = runModule(["query", root, "--title", TITLE]);
  expect(run.code, `query failed: ${run.stderr}`).toBe(0);
  const q = jsonLine(run);
  expect(Object.keys(q).length).toBeGreaterThan(0);
  return q;
}

// ------------------------------------------------------------ transcripts

interface Call {
  id: string;
  name: string;
  input: Record<string, unknown>;
  /** The answer; `undefined` = no tool_result record at all. */
  answer?: unknown;
  isError?: boolean;
  /** How the tool_result `content` is carried. */
  form?: "string" | "array";
}

let tSeq = 0;

/** Write a Claude Code JSONL transcript holding `calls` (each tool_use, then its tool_result). */
function writeTranscript(calls: Call[]): string {
  tSeq += 1;
  const lines: string[] = [
    JSON.stringify({ type: "summary", summary: "synthetic session" }),
    JSON.stringify({
      type: "user",
      message: { role: "user", content: "write the FR for the fake widget" },
    }),
  ];
  for (const c of calls) {
    lines.push(
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "Searching for an existing ticket." },
            { type: "tool_use", id: c.id, name: c.name, input: c.input },
          ],
        },
      }),
    );
    if (c.answer === undefined && !c.isError) continue;
    const text = c.isError ? "Error: upstream 504 Gateway Timeout" : JSON.stringify(c.answer);
    const content = (c.form ?? "array") === "string" ? text : [{ type: "text", text }];
    lines.push(
      JSON.stringify({
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: c.id,
              content,
              ...(c.isError ? { is_error: true } : {}),
            },
          ],
        },
      }),
    );
  }
  const p = join(scratch, `transcript-${tSeq}.jsonl`);
  writeFileSync(p, lines.join("\n") + "\n");
  return p;
}

function decideFromTranscript(
  root: string,
  transcriptPath: string,
  ids: string[],
  attempt: "fast" | "retry-1" | "retry-2" | "retry-3" = "fast",
  pagesBefore: string[] = [],
): Run {
  return runModule([
    "decide",
    root,
    ...pagesBefore,
    "--from-transcript",
    transcriptPath,
    ...ids,
    "--title",
    TITLE,
    "--attempt",
    attempt,
  ]);
}

/** A Linear page in the measured shape. */
const lpage = (issues: unknown[], cursor: string | null = null) => ({
  issues,
  hasNextPage: cursor !== null,
  ...(cursor === null ? {} : { cursor }),
});
const EMPTY_LINEAR = lpage([]);
const EMPTY_JIRA = { issues: [], isLast: true };

// ===========================================================================
// AC-STE-704.1 — the regression.
// ===========================================================================

describe("AC-STE-704.1 — regression", () => {
  test("a page from a narrowed search never authorises a create", () => {
    withRoot((root) => {
      declareLinear(root);
      const q = printedQuery(root);
      // Narrowed by a full-text title filter: empty, complete — and NOT the printed search.
      const narrowed = writeTranscript([
        { id: "toolu_704narrow01", name: LINEAR_TOOL, input: { ...q, query: TITLE }, answer: EMPTY_LINEAR },
      ]);
      const d = jsonLine(decideFromTranscript(root, narrowed, ["toolu_704narrow01"]));
      expect(d.outcome).not.toBe("create");
      expect(d.outcome).toBe("refused");
      expect(d.reason).toBe("page-violates-query");

      // Control: the printed search itself, same empty complete answer, creates.
      const exact = writeTranscript([
        { id: "toolu_704exact01", name: LINEAR_TOOL, input: { ...q }, answer: EMPTY_LINEAR },
      ]);
      expectProvenAbsentCreate(decideFromTranscript(root, exact, ["toolu_704exact01"]));
    });
  });
});

// ===========================================================================
// AC-STE-704.2 — the flag, the order, and no files beside it.
// ===========================================================================

describe("AC-STE-704.2 — decide --from-transcript", () => {
  test("a named call and its result are read from the transcript (Linear, array content)", () => {
    withRoot((root) => {
      declareLinear(root);
      const q = printedQuery(root);
      const tp = writeTranscript([
        { id: "toolu_704read01", name: LINEAR_TOOL, input: { ...q }, answer: EMPTY_LINEAR, form: "array" },
      ]);
      const d = expectProvenAbsentCreate(decideFromTranscript(root, tp, ["toolu_704read01"]));
      expect(d.createPayload).toBeDefined();
      expect(d.createPayload.title).toBe(TITLE);
    });
  });

  test("a prefixed claude_ai Linear name and string content are accepted; a match in the result is reused", () => {
    withRoot((root) => {
      declareLinear(root);
      const q = printedQuery(root);
      const hit = { id: "ZZT-7", title: TITLE, labels: [TAG], project: "FAKEPROJ", team: "Fake Team" };
      const tp = writeTranscript([
        { id: "toolu_704read02", name: LINEAR_TOOL_ALT, input: { ...q }, answer: lpage([hit]), form: "string" },
      ]);
      const d = jsonLine(decideFromTranscript(root, tp, ["toolu_704read02"]));
      expect(d.outcome).toBe("reused");
      expect(d.key).toBe("ZZT-7");
    });
  });

  test("several ids are read in the order given, as one page chain", () => {
    withRoot((root) => {
      declareLinear(root);
      const q = printedQuery(root);
      const other = { id: "ZZT-3", title: "Some other widget", labels: [TAG], project: "FAKEPROJ", team: "Fake Team" };
      const hit = { id: "ZZT-9", title: TITLE, labels: [TAG], project: "FAKEPROJ", team: "Fake Team" };
      const tp = writeTranscript([
        { id: "toolu_704chain01", name: LINEAR_TOOL, input: { ...q }, answer: lpage([other], "cur-1") },
        { id: "toolu_704chain02", name: LINEAR_TOOL, input: { ...q, cursor: "cur-1" }, answer: lpage([hit]) },
      ]);
      const inOrder = jsonLine(decideFromTranscript(root, tp, ["toolu_704chain01", "toolu_704chain02"]));
      expect(inOrder.outcome).toBe("reused");
      expect(inOrder.key).toBe("ZZT-9");

      // Reversed, the second page comes first: its input carries a cursor no
      // first page may, and the chain no longer links — never a create.
      const reversed = jsonLine(decideFromTranscript(root, tp, ["toolu_704chain02", "toolu_704chain01"]));
      expect(reversed.outcome).toBe("refused");
    });
  });

  test("page files passed with the flag are refused, and no file page is read", () => {
    withRoot((root) => {
      declareLinear(root);
      const q = printedQuery(root);
      const tp = writeTranscript([
        { id: "toolu_704mix01", name: LINEAR_TOOL, input: { ...q }, answer: EMPTY_LINEAR },
      ]);
      // Control: the transcript alone authorises the create.
      expectProvenAbsentCreate(decideFromTranscript(root, tp, ["toolu_704mix01"]));

      // A valid, empty, complete page file beside the flag: ignoring it would
      // create; reading it would create. Neither is allowed.
      const validPage = join(scratch, "mix-valid-page.json");
      writeFileSync(validPage, JSON.stringify(EMPTY_LINEAR));
      const withValid = decideFromTranscript(root, tp, ["toolu_704mix01"], "fast", [validPage]);
      const validOut = `${withValid.stdout}\n${withValid.stderr}`;
      expect(jsonLines(withValid).some((l) => l.outcome === "create"), validOut).toBe(false);
      expect(validOut).not.toContain('"outcome":"create"');
      expect(validOut).toContain("--from-transcript");

      // A page path that does not exist: the refusal is about the mix, never
      // about reading that file.
      const missingPage = join(scratch, "mix-page-that-was-never-written-7f3a.json");
      const withMissing = decideFromTranscript(root, tp, ["toolu_704mix01"], "fast", [missingPage]);
      const missingOut = `${withMissing.stdout}\n${withMissing.stderr}`;
      expect(jsonLines(withMissing).some((l) => l.outcome === "create"), missingOut).toBe(false);
      expect(missingOut).not.toContain("page-unreadable");
      expect(missingOut).not.toContain("mix-page-that-was-never-written-7f3a");
      expect(missingOut).not.toContain("ENOENT");
      expect(missingOut).toContain("--from-transcript");
    });
  });
});

// ===========================================================================
// AC-STE-704.3 — the input must equal the printed query exactly.
// ===========================================================================

describe("AC-STE-704.3 — exact input", () => {
  test("Linear: an extra key refuses with page-violates-query", () => {
    withRoot((root) => {
      declareLinear(root);
      const q = printedQuery(root);
      const tp = writeTranscript([
        { id: "toolu_704xkey01", name: LINEAR_TOOL, input: { ...q, includeArchived: true }, answer: EMPTY_LINEAR },
        // A cursor on the FIRST page is an extra key too.
        { id: "toolu_704xkey02", name: LINEAR_TOOL, input: { ...q, cursor: "cur-0" }, answer: EMPTY_LINEAR },
      ]);
      expectRefusal(decideFromTranscript(root, tp, ["toolu_704xkey01"]), "page-violates-query");
      expectRefusal(decideFromTranscript(root, tp, ["toolu_704xkey02"]), "page-violates-query");
    });
  });

  test("Linear: a changed value refuses with page-violates-query", () => {
    withRoot((root) => {
      declareLinear(root);
      const q = printedQuery(root);
      expect(q.label).toBe(TAG);
      const { label: _drop, ...noLabel } = q;
      const tp = writeTranscript([
        { id: "toolu_704chg01", name: LINEAR_TOOL, input: { ...q, limit: 5 }, answer: EMPTY_LINEAR },
        { id: "toolu_704chg02", name: LINEAR_TOOL, input: { ...q, project: "OTHERPROJ" }, answer: EMPTY_LINEAR },
        { id: "toolu_704chg03", name: LINEAR_TOOL, input: noLabel, answer: EMPTY_LINEAR },
      ]);
      expectRefusal(decideFromTranscript(root, tp, ["toolu_704chg01"]), "page-violates-query");
      expectRefusal(decideFromTranscript(root, tp, ["toolu_704chg02"]), "page-violates-query");
      expectRefusal(decideFromTranscript(root, tp, ["toolu_704chg03"]), "page-violates-query");
    });
  });

  test("Jira: the printed jql + fields + cloudId is accepted", () => {
    withRoot((root) => {
      declareJira(root);
      const q = printedQuery(root);
      expect(typeof q.jql).toBe("string");
      const tp = writeTranscript([
        { id: "toolu_704jira01", name: JIRA_TOOL, input: { cloudId: CLOUD_ID, ...q }, answer: EMPTY_JIRA },
      ]);
      expectProvenAbsentCreate(decideFromTranscript(root, tp, ["toolu_704jira01"]));
    });
  });

  test("Jira: a changed jql or an extra key refuses with page-violates-query", () => {
    withRoot((root) => {
      declareJira(root);
      const q = printedQuery(root);
      const tp = writeTranscript([
        {
          id: "toolu_704jira02",
          name: JIRA_TOOL,
          input: { cloudId: CLOUD_ID, ...q, jql: `${String(q.jql)} AND key = ZZ-1` },
          answer: EMPTY_JIRA,
        },
        {
          id: "toolu_704jira03",
          name: JIRA_TOOL,
          input: { cloudId: CLOUD_ID, ...q, maxResults: 1 },
          answer: EMPTY_JIRA,
        },
      ]);
      expectRefusal(decideFromTranscript(root, tp, ["toolu_704jira02"]), "page-violates-query");
      expectRefusal(decideFromTranscript(root, tp, ["toolu_704jira03"]), "page-violates-query");
    });
  });

  test("a call to another tool never yields create", () => {
    withRoot((root) => {
      declareLinear(root);
      const q = printedQuery(root);
      const tp = writeTranscript([
        { id: "toolu_704tool01", name: "mcp__linear__list_projects", input: { ...q }, answer: EMPTY_LINEAR },
      ]);
      expectRefusal(decideFromTranscript(root, tp, ["toolu_704tool01"]));
    });
  });
});

// ===========================================================================
// AC-STE-704.4 — missing calls, missing results, errors; chain and cap rules.
// ===========================================================================

describe("AC-STE-704.4 — the transcript must hold the call and its answer", () => {
  test("an id with no call in the transcript refuses", () => {
    withRoot((root) => {
      declareLinear(root);
      const q = printedQuery(root);
      const tp = writeTranscript([
        { id: "toolu_704known01", name: LINEAR_TOOL, input: { ...q }, answer: EMPTY_LINEAR },
      ]);
      expectRefusal(decideFromTranscript(root, tp, ["toolu_704nosuchcall"]));
    });
  });

  test("a call with no tool result refuses", () => {
    withRoot((root) => {
      declareLinear(root);
      const q = printedQuery(root);
      const tp = writeTranscript([{ id: "toolu_704noresult01", name: LINEAR_TOOL, input: { ...q } }]);
      expectRefusal(decideFromTranscript(root, tp, ["toolu_704noresult01"]));
    });
  });

  test("an error result refuses", () => {
    withRoot((root) => {
      declareLinear(root);
      const q = printedQuery(root);
      const tp = writeTranscript([
        { id: "toolu_704err01", name: LINEAR_TOOL, input: { ...q }, isError: true },
      ]);
      expectRefusal(decideFromTranscript(root, tp, ["toolu_704err01"]));
    });
  });

  test("the cap rule: a lone page that says more follow refuses with page-cap", () => {
    withRoot((root) => {
      declareLinear(root);
      const q = printedQuery(root);
      const tp = writeTranscript([
        { id: "toolu_704cap01", name: LINEAR_TOOL, input: { ...q }, answer: lpage([], "cur-1") },
      ]);
      expectRefusal(decideFromTranscript(root, tp, ["toolu_704cap01"]), "page-cap");
    });
  });

  test("the chain rule: a second page fetched with another cursor never yields create", () => {
    withRoot((root) => {
      declareLinear(root);
      const q = printedQuery(root);
      const tp = writeTranscript([
        { id: "toolu_704link01", name: LINEAR_TOOL, input: { ...q }, answer: lpage([], "cur-1") },
        { id: "toolu_704link02", name: LINEAR_TOOL, input: { ...q, cursor: "cur-9" }, answer: EMPTY_LINEAR },
        { id: "toolu_704link03", name: LINEAR_TOOL, input: { ...q, cursor: "cur-1" }, answer: EMPTY_LINEAR },
      ]);
      expectRefusal(decideFromTranscript(root, tp, ["toolu_704link01", "toolu_704link02"]));
      // Control: the correctly linked second page completes the chain.
      expectProvenAbsentCreate(decideFromTranscript(root, tp, ["toolu_704link01", "toolu_704link03"]));
    });
  });
});

// ===========================================================================
// AC-STE-704.5 — the pinning cases.
// ===========================================================================

describe("AC-STE-704.5 — pinning cases through the spawned command", () => {
  test("an extra `query` argument with an empty result refuses", () => {
    withRoot((root) => {
      declareLinear(root);
      const q = printedQuery(root);
      const tp = writeTranscript([
        { id: "toolu_704pin01", name: LINEAR_TOOL, input: { ...q, query: "fake widget" }, answer: EMPTY_LINEAR },
      ]);
      expectRefusal(decideFromTranscript(root, tp, ["toolu_704pin01"]), "page-violates-query");
    });
  });

  test("a changed label with an empty result refuses", () => {
    withRoot((root) => {
      declareLinear(root);
      const q = printedQuery(root);
      const tp = writeTranscript([
        { id: "toolu_704pin02", name: LINEAR_TOOL, input: { ...q, label: FOREIGN_TAG }, answer: EMPTY_LINEAR },
      ]);
      expectRefusal(decideFromTranscript(root, tp, ["toolu_704pin02"]), "page-violates-query");
    });
  });

  test("exact arguments with an empty, complete listing print create with reason proven-absent", () => {
    withRoot((root) => {
      declareLinear(root);
      const q = printedQuery(root);
      const tp = writeTranscript([
        { id: "toolu_704pin03", name: LINEAR_TOOL, input: { ...q }, answer: EMPTY_LINEAR },
      ]);
      expectProvenAbsentCreate(decideFromTranscript(root, tp, ["toolu_704pin03"]));
    });
  });

  test("a shared-mode page carrying another repository's tag refuses with page-violates-query", () => {
    withRoot((root) => {
      declareLinear(root);
      const q = printedQuery(root);
      const foreign = { id: "ZZT-41", title: "A sibling's widget", labels: [FOREIGN_TAG], project: "FAKEPROJ", team: "Fake Team" };
      const tp = writeTranscript([
        { id: "toolu_704pin04", name: LINEAR_TOOL, input: { ...q }, answer: lpage([foreign]) },
      ]);
      expectRefusal(decideFromTranscript(root, tp, ["toolu_704pin04"]), "page-violates-query");
    });
  });
});

// ===========================================================================
// AC-STE-704.6 — the docs order the transcript form.
// ===========================================================================

/** `### \`upsert_ticket_metadata…` up to the next `### ` heading. */
function upsertSection(body: string): string {
  const start = body.indexOf("### `upsert_ticket_metadata");
  expect(start).toBeGreaterThan(-1);
  const rest = body.slice(start + 4);
  const end = rest.search(/\n### /);
  return end === -1 ? body.slice(start) : body.slice(start, start + 4 + end);
}

/** `/spec-write` § 0b, up to § 1. */
function specWrite0b(body: string): string {
  const start = body.indexOf("### 0b. FR creation path");
  expect(start).toBeGreaterThan(-1);
  const end = body.indexOf("\n### 1.", start);
  expect(end).toBeGreaterThan(start);
  return body.slice(start, end);
}

function expectTranscriptFormOrdered(label: string, section: string): void {
  const decideLines = section
    .split("\n")
    .filter((l) => /create_idempotency_probe\.ts decide\b/.test(l) && l.includes("--from-transcript"));
  expect(decideLines.length, `${label}: a decide invocation must use --from-transcript`).toBeGreaterThan(0);
  expect(section, `${label}: must name the hook payload's transcript_path`).toContain("transcript_path");
  expect(section, `${label}: must name the search calls' tool_use ids`).toMatch(/tool_use[ _]id/);
}

describe("AC-STE-704.6 — the docs order the transcript form", () => {
  test("adapters/linear.md § upsert_ticket_metadata orders decide --from-transcript", () => {
    expectTranscriptFormOrdered("linear.md", upsertSection(readFileSync(LINEAR_ADAPTER, "utf-8")));
  });

  test("adapters/jira.md § upsert_ticket_metadata orders decide --from-transcript", () => {
    expectTranscriptFormOrdered("jira.md", upsertSection(readFileSync(JIRA_ADAPTER, "utf-8")));
  });

  test("/spec-write § 0b orders decide --from-transcript", () => {
    expectTranscriptFormOrdered("spec-write § 0b", specWrite0b(readFileSync(SPEC_WRITE_SKILL, "utf-8")));
  });
});
