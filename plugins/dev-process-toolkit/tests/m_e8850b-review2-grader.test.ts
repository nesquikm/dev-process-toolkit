// M_e8850b review 2 — the live grader (STE-871).
//
// F2: the grader decides a call's subject from the raw call, as the hook does.
//     A getJiraIssue by `https://u@<host>/browse/K` names no key to the hook
//     (the authority has userinfo), so it neither proves K nor hides an older
//     owned answer. Redaction used to turn `u@<host>` into `<email>`, after which
//     grade time read K from the URL. Each grader leg runs through extractBundle
//     and has a hook twin on the same three calls.
// F3: a declared cloud_id gets a token (`<cloud-A>` / `<cloud-B>`) in the bundle,
//     the call inputs carry the same token, and extraction refuses a bundle that
//     still spells a declared cloud_id.
//
// Invented hosts and UUIDs only.

import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { PLUGIN_ROOT, TAG, Transcript, cleanupTemps, gate, graderRel, jiraTicket, makeWorld, permitProblem, show, tempDir } from "./_m_b2fdc0_ste729_fixture";
import { buildPassingBundle, clone, materialize, serverPrefix, type BundleSession, type LiveBundle, type ToolCall, type TrackerItem } from "./_live_bundle_fixtures";
import { commitAll } from "./_span_fixture";

setDefaultTimeout(180_000);
afterAll(cleanupTemps);

type Obj = Record<string, unknown>;
const HOST = "tracker.example.invalid";
const CLOUD = "5c0ffee0-1234-4abc-8def-0123456789ab";
const CLOUD_B = "5c0ffee0-1234-4abc-8def-0123456789cd";
const OTHER_CLOUD = "5c0ffee0-1234-4abc-8def-0123456789ef";

interface Grader {
  extractBundle: (o: Obj) => { ok: true; bundle: LiveBundle } | { ok: false; verdict: { outcome: string; findings: Array<{ code: string; detail?: string }> } };
  gradeBundle: (b: LiveBundle, o: { behaviourDigestNow: string }) => { findings: Array<{ code: string; detail?: string }> };
  privacyViolations: (b: unknown) => unknown[];
}
const grader = async (): Promise<Grader> => (await import(join(PLUGIN_ROOT, graderRel))) as unknown as Grader;

let seq = 0;
function push(s: BundleSession, op: string, input: Obj, items: TrackerItem[]): ToolCall {
  const c: ToolCall = {
    ref: `${s.sessionId}:toolu_rv2_${++seq}`,
    at: new Date(Date.parse(s.calls.at(-1)!.at) + 1000).toISOString(),
    name: serverPrefix("jira", s.root) + op,
    input,
    result: { isError: false, text: "", exitCode: null, items, lastPage: null },
    sidechain: false,
  };
  s.calls.push(c);
  return c;
}

/** The passing Jira bundle with calls added to S13 by `add`, written to disk with both CLAUDE.md files declaring `lines`, then extracted. */
async function extracted(lines: string[], sent: string, add: (s: BundleSession, b: LiveBundle) => void, edit?: (m: ReturnType<typeof materialize>) => void) {
  const b = clone(buildPassingBundle("jira"));
  for (const s of b.sessions) for (const c of s.calls) if (c.name.startsWith("mcp__")) c.input.cloudId = sent;
  add(b.sessions.find((x) => x.marker === "S13")!, b);
  const m = materialize(b, tempDir("records"));
  for (const r of ["A", "B"] as const) {
    const tag = b.roots[r].tag;
    // A line starting `#B ` is B's own; when there is one, B takes only those.
    const bOnly = lines.filter((l) => l.startsWith("#B ")).map((l) => l.slice(3));
    const own = r === "B" && bOnly.length > 0 ? bOnly : lines.filter((l) => !l.startsWith("#B "));
    writeFileSync(join(m.roots[r], "CLAUDE.md"), ["# Fixture", "", "## Task Tracking", "", "mode: jira", "", "### Jira", "", `project: ${b.run.container}`, `default_labels: [${tag}]`, `repo_tag: ${tag}`, "min_dpt_version: 2.87.0", ...own, ""].join("\n"));
  }
  edit?.(m);
  return (await grader()).extractBundle({ configDirs: [m.configDir], ledgerSessionIds: m.ledger, roots: { A: { path: m.roots.A, tag: b.roots.A.tag }, B: { path: m.roots.B, tag: b.roots.B.tag } }, run: m.run, synthetic: true });
}
async function flaggedIn(bundle: LiveBundle, ref: string): Promise<boolean> {
  const v = (await grader()).gradeBundle(clone(bundle), { behaviourDigestNow: bundle.run.behaviourDigest.digest });
  return v.findings.some((f) => f.code === "ungated-write" && (f.detail ?? "").startsWith(`${ref}:`));
}
const itemOf = (b: LiveBundle, s: BundleSession, key: string, labels = [b.roots[s.root].tag]): TrackerItem => ({ key, summary: `Ticket ${key}`, labels, status: "To Do", parent: null, milestone: null, issueType: "Task", kind: "issue", container: b.run.container });

// ---------------------------------------------------------------- F2

/** How the second fetch names the ticket. */
type Second = "userinfo-url" | "plain-key";
const subjectOf = (second: Second, key: string): string => (second === "userinfo-url" ? `https://u@${HOST}/browse/${key}` : key);

/** Grader: owned fetch, then a second fetch answering a foreign label, then an edit. True when the edit is flagged. */
async function graderLeg(site: boolean, second: Second): Promise<boolean> {
  let ref = "";
  const e = await extracted(site ? [`site: ${HOST}`] : [], HOST, (s, b) => {
    const key = `${b.run.container}-960`;
    push(s, "getJiraIssue", { cloudId: HOST, issueIdOrKey: key }, [itemOf(b, s, key)]);
    push(s, "getJiraIssue", { cloudId: HOST, issueIdOrKey: subjectOf(second, key) }, [itemOf(b, s, key, ["someone-else"])]);
    ref = push(s, "editJiraIssue", { cloudId: HOST, issueIdOrKey: key, fields: { summary: "Retitled" } }, [itemOf(b, s, key)]).ref;
  });
  if (!e.ok) throw new Error(`fixture: not extracted: ${JSON.stringify(e.verdict)}`);
  return flaggedIn(e.bundle, ref);
}

/** Hook: the same three calls in a world that binds the ticket's tag. True when the edit is refused. */
async function hookLeg(site: boolean, second: Second): Promise<boolean> {
  const key = "PROJ-510";
  const w = makeWorld({ boundFr: "PROJ-520" });
  if (site) {
    const p = join(w.root, "CLAUDE.md");
    writeFileSync(p, readFileSync(p, "utf-8").replace("### Jira\n\n", `### Jira\n\nsite: ${HOST}\n`));
    commitAll(w.root, "fixture: site");
  }
  const t = new Transcript();
  t.tool("mcp__atlassian__getJiraIssue", { cloudId: HOST, issueIdOrKey: key }, jiraTicket(key, { labels: [TAG] }), false);
  t.tool("mcp__atlassian__getJiraIssue", { cloudId: HOST, issueIdOrKey: subjectOf(second, key) }, jiraTicket(key, { labels: ["someone-else"] }), false);
  const r = await gate(PLUGIN_ROOT, "mcp__atlassian__editJiraIssue", { cloudId: HOST, issueIdOrKey: key, fields: { summary: "Retitled" } }, t, w.root);
  const problem = permitProblem(r);
  if (problem !== null && r.exitCode !== 2) throw new Error(`hook: neither a permit nor a refusal: ${show(r)}`);
  return problem !== null;
}

describe("F2 — a fetch by a userinfo browse URL names no key, in the hook and the grader", () => {
  for (const site of [true, false]) {
    const where = site ? "site declared" : "no site declared";
    test(`PERMIT — hook — ${where}: the userinfo-URL fetch hides no older owned answer`, async () => expect(await hookLeg(site, "userinfo-url")).toBe(false));
    test(`PERMIT — grader via extractBundle — ${where}: the same calls`, async () => expect(await graderLeg(site, "userinfo-url")).toBe(false));
    // Twins: the second fetch by plain key does count, in both, so the legs above
    // pass because the URL names no key, not because the second fetch is ignored.
    test(`REFUSE TWIN — hook — ${where}: a second fetch by key answering another tag`, async () => expect(await hookLeg(site, "plain-key")).toBe(true));
    test(`REFUSE TWIN — grader via extractBundle — ${where}: the same calls`, async () => expect(await graderLeg(site, "plain-key")).toBe(true));
  }
  test("the recorded URL keeps an `@` in its authority and spells no address or host", async () => {
    const e = await extracted([`site: ${HOST}`], HOST, (s, b) => {
      push(s, "getJiraIssue", { cloudId: HOST, issueIdOrKey: `https://u@${HOST}/browse/${b.run.container}-960` }, [itemOf(b, s, `${b.run.container}-960`)]);
    });
    if (!e.ok) throw new Error("fixture: not extracted");
    const urls = e.bundle.sessions.flatMap((s) => s.calls).map((c) => c.input.issueIdOrKey).filter((v): v is string => typeof v === "string" && v.includes("/browse/"));
    expect(urls.length).toBe(1);
    expect(urls[0]).toMatch(/^https:\/\/[^/]*@[^/]*\/browse\//);
    expect(urls[0]).not.toContain(HOST);
    expect(urls[0]).not.toContain("u@");
    expect((await grader()).privacyViolations(e.bundle)).toEqual([]);
  });
});

// ---------------------------------------------------------------- F3

describe("F3 — a declared cloud_id is a token in the bundle", () => {
  test("one id declared by both roots: both roots carry <cloud-A>, any case of the id passes, another id fails, and the id is gone", async () => {
    const refs: string[] = [];
    const e = await extracted([`cloud_id: ${CLOUD}`], CLOUD, (s, b) => {
      const key = `${b.run.container}-890`;
      b.repos[s.root].frBindings.push({ path: "specs/frs/fr-890.md", title: "Own", key, milestone: null });
      for (const id of [CLOUD, CLOUD.toUpperCase(), OTHER_CLOUD]) refs.push(push(s, "editJiraIssue", { cloudId: id, issueIdOrKey: key, fields: { summary: "Retitled" } }, [itemOf(b, s, key)]).ref);
    });
    if (!e.ok) throw new Error(`fixture: not extracted: ${JSON.stringify(e.verdict)}`);
    expect(e.bundle.roots.A.cloudId).toBe("<cloud-A>");
    expect(e.bundle.roots.B.cloudId).toBe("<cloud-A>");
    expect(JSON.stringify(e.bundle).toLowerCase()).not.toContain(CLOUD);
    expect(await Promise.all(refs.map((r) => flaggedIn(e.bundle, r)))).toEqual([false, false, true]);
  });

  test("two ids: A gets <cloud-A>, B gets <cloud-B>, and B's session passes only at B's id", async () => {
    const refs: string[] = [];
    let root = "";
    const e = await extracted([`cloud_id: ${CLOUD}`, `#B cloud_id: ${CLOUD_B}`], CLOUD, (s, b) => {
      root = s.root;
      const key = `${b.run.container}-890`;
      b.repos[s.root].frBindings.push({ path: "specs/frs/fr-890.md", title: "Own", key, milestone: null });
      for (const id of [CLOUD, CLOUD_B]) refs.push(push(s, "editJiraIssue", { cloudId: id, issueIdOrKey: key, fields: { summary: "Retitled" } }, [itemOf(b, s, key)]).ref);
    });
    if (!e.ok) throw new Error(`fixture: not extracted: ${JSON.stringify(e.verdict)}`);
    expect(root).toBe("B");
    expect(e.bundle.roots.A.cloudId).toBe("<cloud-A>");
    expect(e.bundle.roots.B.cloudId).toBe("<cloud-B>");
    const text = JSON.stringify(e.bundle).toLowerCase();
    expect(text).not.toContain(CLOUD);
    expect(text).not.toContain(CLOUD_B);
    expect(await Promise.all(refs.map((r) => flaggedIn(e.bundle, r)))).toEqual([true, false]);
  });

  test("a call that already spells the token is not taken for the declared id", async () => {
    let ref = "";
    const e = await extracted([`cloud_id: ${CLOUD}`], CLOUD, (s, b) => {
      const key = `${b.run.container}-890`;
      b.repos[s.root].frBindings.push({ path: "specs/frs/fr-890.md", title: "Own", key, milestone: null });
      ref = push(s, "editJiraIssue", { cloudId: "<CLOUD-A>", issueIdOrKey: key, fields: { summary: "Retitled" } }, [itemOf(b, s, key)]).ref;
    });
    if (!e.ok) throw new Error(`fixture: not extracted: ${JSON.stringify(e.verdict)}`);
    expect(await flaggedIn(e.bundle, ref)).toBe(true);
  });

  test("backstop: a declared cloud_id in a field no rewrite reaches aborts the extraction, without naming the id", async () => {
    const e = await extracted([`cloud_id: ${CLOUD}`], CLOUD, () => {}, (m) => {
      m.run.auditQuery = `${m.run.auditQuery} cloud ${CLOUD.toUpperCase()}`;
    });
    expect(e.ok).toBe(false);
    if (e.ok) return;
    expect(e.verdict.outcome).toBe("abort");
    expect(e.verdict.findings.map((f) => f.code)).toContain("cloud-id-in-bundle");
    expect(JSON.stringify(e.verdict).toLowerCase()).not.toContain(CLOUD);
  });

  test("CONTROL — the same run meta without the id extracts", async () => {
    const e = await extracted([`cloud_id: ${CLOUD}`], CLOUD, () => {}, (m) => {
      m.run.auditQuery = `${m.run.auditQuery} cloud none`;
    });
    expect(e.ok).toBe(true);
  });
});

// ---------------------------------------------------------------- F1

// F1, grader twin of tests/m_e8850b-review2-decide.test.ts: B declares no site,
// A declares one and is in scope, so B is given A's site (`sitesOf`, as the
// hook's `inheritSites`). A `reuse` or `create` receipt B's decide recorded with
// `searchSite` holds only when that site is B's given one (`decidedAtSite`).
// Every leg runs through extractBundle, so the receipt's searchSite carries the
// same tokens as the roots' declarations.

/** A's own announcement, copied into `s` so A is in scope of its later writes. */
function putAInScope(b: LiveBundle, s: BundleSession, at: number): void {
  const a = b.sessions.filter((x) => x.root === "A").flatMap((x) => x.calls).find((c) => c.name === "Bash" && !c.result.isError && /^dpt-receipt: <A>\//m.test(c.result.text));
  if (!a) throw new Error("fixture: no announcement by A");
  s.calls.splice(at, 0, { ...clone(a), ref: `${s.sessionId}:toolu_rv2_ann_${++seq}`, at: s.calls[Math.max(0, at - 1)]!.at, sidechain: false });
}

/** Both roots' CLAUDE.md declared by `extracted`, then B's site keys removed. */
const bDeclaresNoSite = (m: ReturnType<typeof materialize>): void => {
  const p = join(m.roots.B, "CLAUDE.md");
  writeFileSync(p, readFileSync(p, "utf-8").split("\n").filter((l) => !/^(site|cloud_id):/.test(l)).join("\n"));
};
const INHERIT = [`site: ${HOST}`, `cloud_id: ${CLOUD}`];

/** S13 (root B): A in scope, a reuse receipt by B's decide searched at `searchSite`, then an edit at A's id. True when flagged. */
async function reuseLeg(searchSite: string): Promise<boolean> {
  let ref = "";
  const e = await extracted(INHERIT, CLOUD, (s, b) => {
    expect(s.root).toBe("B");
    putAInScope(b, s, s.calls.length);
    const key = `${b.run.container}-961`;
    const path = `<B>/.dpt/ledger/receipts/${s.sessionId}/reuse-rv2-${++seq}.json`;
    const sha256 = createHash("sha256").update(path).digest("hex");
    const set = b.repos.B.receipts;
    if (!set.readable) throw new Error("fixture: B's receipts unreadable");
    set.records.push({ path, sessionId: s.sessionId, sha256, kind: "reuse", adapter: "jira", container: b.run.container, subject: "Payout export", decision: "reuse", evidence: { key, searchSite } });
    const decide = b.sessions.flatMap((x) => x.calls).find((c) => c.name === "Bash" && String(c.input.command).includes("create_idempotency_probe.ts") && String(c.input.command).includes("<B>"));
    if (!decide) throw new Error("fixture: no decide call in B");
    s.calls.push({ ...clone(decide), ref: `${s.sessionId}:toolu_rv2_${++seq}`, at: new Date(Date.parse(s.calls.at(-1)!.at) + 1000).toISOString(), result: { isError: false, text: `decision=reuse\ndpt-receipt: ${path} sha256:${sha256}`, exitCode: 0, items: null, lastPage: null }, sidechain: false });
    ref = push(s, "editJiraIssue", { cloudId: CLOUD, issueIdOrKey: key, fields: { summary: "Retitled" } }, [itemOf(b, s, key)]).ref;
  }, bDeclaresNoSite);
  if (!e.ok) throw new Error(`fixture: not extracted: ${JSON.stringify(e.verdict)}`);
  expect(e.bundle.roots.B.cloudId).toBeUndefined();
  return flaggedIn(e.bundle, ref);
}

/** S1 (root B): A in scope, B's own create receipt given `searchSite`, then its create at A's id. True when flagged. */
async function createLeg(searchSite: string): Promise<boolean> {
  let ref = "";
  const e = await extracted(INHERIT, CLOUD, (_s, b) => {
    const s = b.sessions.find((x) => x.marker === "S1" && x.root === "B")!;
    const create = s.calls.find((c) => c.name.endsWith("__createJiraIssue"))!;
    ref = create.ref;
    const set = b.repos.B.receipts;
    if (!set.readable) throw new Error("fixture: B's receipts unreadable");
    const receipt = set.records.find((r) => r.kind === "create" && r.sessionId === s.sessionId);
    if (!receipt) throw new Error("fixture: no create receipt in S1/B");
    receipt.evidence.searchSite = searchSite;
    putAInScope(b, s, 0);
  }, bDeclaresNoSite);
  if (!e.ok) throw new Error(`fixture: not extracted: ${JSON.stringify(e.verdict)}`);
  return flaggedIn(e.bundle, ref);
}

describe("F1 — the grader holds a decide receipt to the site the root is given", () => {
  test("REFUSE — grader via extractBundle — a reuse decided from another site's page owns nothing at the inherited site", async () => expect(await reuseLeg(OTHER_CLOUD)).toBe(true));
  test("PERMIT TWIN — grader via extractBundle — a reuse decided from the inherited site's page owns the key", async () => expect(await reuseLeg(CLOUD)).toBe(false));
  test("PERMIT TWIN — grader via extractBundle — the inherited site named by its host counts as that site", async () => expect(await reuseLeg(`https://${HOST}`)).toBe(false));
  test("REFUSE — grader via extractBundle — a create decided from another site's page authorises no create at the inherited site", async () => expect(await createLeg(OTHER_CLOUD)).toBe(true));
  test("PERMIT TWIN — grader via extractBundle — a create decided from the inherited site's page authorises the create", async () => expect(await createLeg(CLOUD)).toBe(false));
  test("PERMIT TWIN — grader via extractBundle — the inherited site named by its host", async () => expect(await createLeg(`https://${HOST}`)).toBe(false));
});

// ------------------------------------------------- two cloudIds, one token

// Redaction makes two different cloudId values one: two undeclared
// `*.atlassian.net` hosts both become `<site>`, and two spellings of a declared
// host or id that differ in case both become its token. The hook compares the
// raw values and refuses an execute call whose outer cloudId is not its
// inputs.cloudId; the grader reads that verdict from the raw call too. Each
// refuse leg has a twin naming one value twice, in the hook and the grader.

const ALPHA = "alpha-rv2.atlassian.net";
const BETA = "beta-rv2.atlassian.net";
const TWO_IDS: Array<[string, string[], string, string]> = [
  ["two undeclared atlassian.net hosts, no site declared", [], ALPHA, BETA],
  ["two undeclared atlassian.net hosts, a site declared", [`site: ${HOST}`], ALPHA, BETA],
  ["the declared host in two cases", [`site: ${HOST}`], HOST.toUpperCase(), HOST],
  ["the declared cloud_id in two cases", [`cloud_id: ${CLOUD}`], CLOUD.toUpperCase(), CLOUD],
];
const wrapped = (key: string, outer: string, inner: string): Obj => ({ name: "editJiraIssue", inputs: { issueIdOrKey: key, fields: { summary: "Retitled" }, cloudId: inner }, cloudId: outer });

/** Grader: an executeWrite edit of S13's own FR key, cloudId `outer` beside inputs and `inner` inside. True when flagged. */
async function graderTwoIds(lines: string[], outer: string, inner: string): Promise<boolean> {
  let ref = "";
  const e = await extracted(lines, inner, (s, b) => {
    const key = `${b.run.container}-890`;
    b.repos[s.root].frBindings.push({ path: "specs/frs/fr-890.md", title: "Own", key, milestone: null });
    ref = push(s, "executeWrite", wrapped(key, outer, inner), [itemOf(b, s, key)]).ref;
  });
  if (!e.ok) throw new Error(`fixture: not extracted: ${JSON.stringify(e.verdict)}`);
  expect((await grader()).privacyViolations(e.bundle)).toEqual([]);
  return flaggedIn(e.bundle, ref);
}

/** Hook: the same call on the world's bound ticket. True when refused. */
async function hookTwoIds(lines: string[], outer: string, inner: string): Promise<boolean> {
  const w = makeWorld({ boundFr: "PROJ-520" });
  if (lines.length > 0) {
    const p = join(w.root, "CLAUDE.md");
    writeFileSync(p, readFileSync(p, "utf-8").replace("### Jira\n\n", `### Jira\n\n${lines.map((l) => `${l}\n`).join("")}`));
    commitAll(w.root, "fixture: site");
  }
  const r = await gate(PLUGIN_ROOT, "mcp__atlassian__executeWrite", wrapped("PROJ-520", outer, inner), new Transcript(), w.root);
  const problem = permitProblem(r);
  if (problem !== null && r.exitCode !== 2) throw new Error(`hook: neither a permit nor a refusal: ${show(r)}`);
  return problem !== null;
}

describe("two cloudId values that redact to one token — the hook and the grader agree", () => {
  for (const [what, lines, outer, inner] of TWO_IDS) {
    test(`REFUSE — hook — ${what}`, async () => expect(await hookTwoIds(lines, outer, inner)).toBe(true));
    test(`REFUSE — grader via extractBundle — ${what}`, async () => expect(await graderTwoIds(lines, outer, inner)).toBe(true));
    // Twins: the same value twice. Where the inner value is not the declared
    // site (the undeclared hosts with a site declared), both refuse on the site.
    const atSite = !(lines.length > 0 && inner === BETA);
    test(`TWIN — hook — ${what}, one value twice`, async () => expect(await hookTwoIds(lines, inner, inner)).toBe(!atSite));
    test(`TWIN — grader via extractBundle — ${what}, one value twice`, async () => expect(await graderTwoIds(lines, inner, inner)).toBe(!atSite));
  }
});
