// STE-717 — the tool-call timeline reader (schema `tool-call-timeline/v1`).
//
// Reads a session transcript and emits one `calls[]` entry per Bash or Skill
// `tool_use`. Transcript blocks are read ONLY through
// `firstCopies(records, { topLevel: true })` (templates/hooks/_lib/session.ts,
// dynamic import — the create_idempotency_probe.ts precedent), so a call or a
// result written twice is read once (STE-695, STE-696). Every time is the
// epoch ms `firstCopies` reports.
//
// Calls are classified by tool_call_class.ts, the STE-716 capture hook's rule. Command text
// is read in memory and never written: the output carries no command, `cwd`,
// path, branch or session id.
//
// CLI: `bun run tool_call_timeline.ts <transcript> <checkout root>`.

export const TIMELINE_SCHEMA = "tool-call-timeline/v1";

export interface TimelineCall {
  tool_use_id: string;
  tool: "Bash" | "Skill";
  class: string;
  skill: string | null;
  started_at: number | null;
  ended_at: number | null;
  wall_ms: number | null;
  is_error: boolean;
  diff: { files: number; insertions: number; deletions: number } | null;
  duration_ms: number | null;
  pairing: "paired" | "orphan-pre" | "orphan-post" | "uncaptured";
}

export interface TimelineRound {
  tool_use_id: string;
  skill: string;
  status: "ok" | "failed" | "unparsed";
  /** STE-714 D5 answered no: never observable. */
  tree_changed: null;
  tree_disposition: "not-observable";
  /** STE-714 D3 answered no: never observable. */
  tokens: "not-observable";
}

export interface Timeline {
  schema: typeof TIMELINE_SCHEMA;
  calls: TimelineCall[];
  rounds: TimelineRound[];
  gate_runs: GateRun[];
  gaps: { orphan_pre: number; orphan_post: number; uncaptured: number; duplicates: number };
}

/** The child skills whose Skill call is one round. */
const ROUND_SKILLS = new Set([
  "dev-process-toolkit:tdd-write-test",
  "dev-process-toolkit:tdd-implement",
  "dev-process-toolkit:tdd-refactor",
  "dev-process-toolkit:tdd-spec-review",
  "dev-process-toolkit:spec-review-audit",
]);

const BACKGROUND_STUB = /^\s*Running in the background\b/;

/** A tool_result's content as text (a string, or the text of its text blocks). */
function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((b) => (b !== null && typeof b === "object" && (b as Record<string, unknown>).type === "text" ? String((b as Record<string, unknown>).text ?? "") : ""))
    .join("\n");
}

/** A `<task-notification>`'s tool-use id and `<result>` body, or null. */
function notificationOf(text: string): { id: string; result: string } | null {
  if (!text.includes("<task-notification>")) return null;
  const id = /<tool-use-id>([^<]*)<\/tool-use-id>/.exec(text);
  const result = /<result>([\s\S]*)<\/result>/.exec(text);
  if (id === null || result === null) return null;
  return { id: id[1]!.trim(), result: result[1]! };
}

/** A round's status from its result text, by the skill's result block. */
async function roundStatus(skill: string, text: string): Promise<TimelineRound["status"]> {
  if (skill === "dev-process-toolkit:spec-review-audit") {
    const { parseSpecReviewResultBlock } = await import("./spec_review_result");
    const p = parseSpecReviewResultBlock(text);
    if (!p.ok) return "unparsed";
    return p.block.drift_count === 0 && p.block.traceability.every((r) => r.status === "done") ? "ok" : "failed";
  }
  if (skill === "dev-process-toolkit:tdd-spec-review") {
    const { extractTddSpecReviewBlock, parseTddSpecReviewBlock } = await import("./tdd_spec_review_result");
    const ex = extractTddSpecReviewBlock(text);
    if (!ex.ok) return "unparsed";
    const p = parseTddSpecReviewBlock(ex.body);
    return p.ok ? p.block.status : "unparsed";
  }
  const { extractTddResultBlock, parseTddResultBlock } = await import("./tdd_result");
  const ex = extractTddResultBlock(text);
  if (!ex.ok) return "unparsed";
  const p = parseTddResultBlock(ex.body);
  return p.ok ? p.block.status : "unparsed";
}

function parseLine(line: string): unknown {
  if (line.trim() === "") return null;
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

interface CaptureRow {
  ts: number;
  class: unknown;
  diff: TimelineCall["diff"];
}

/**
 * Read the STE-716 capture rows (`tool-call/v1`) for one session. The first
 * row per (id, event) wins; later ones are counted as duplicates.
 */
async function readCaptureRows(
  root: string,
  sessionId: string | null,
): Promise<{ pre: Map<string, CaptureRow>; post: Map<string, CaptureRow>; duplicates: number }> {
  const pre = new Map<string, CaptureRow>();
  const post = new Map<string, CaptureRow>();
  let duplicates = 0;
  if (sessionId === null) return { pre, post, duplicates };
  const [{ toolCallLedgerPath }, { readFileSync }] = await Promise.all([import("./dpt_paths"), import("node:fs")]);
  let text: string;
  try {
    text = readFileSync(toolCallLedgerPath(root, sessionId), "utf-8");
  } catch {
    return { pre, post, duplicates };
  }
  for (const line of text.split("\n")) {
    const row = parseLine(line) as Record<string, unknown> | null;
    if (row === null || typeof row !== "object" || row.schema !== "tool-call/v1") continue;
    if (typeof row.tool_use_id !== "string") continue;
    const into = row.event === "pre" ? pre : row.event === "post" ? post : null;
    if (into === null) continue;
    if (into.has(row.tool_use_id)) {
      duplicates++;
      continue;
    }
    const ts = typeof row.ts === "string" ? Date.parse(row.ts) : NaN;
    const diff = row.diff !== null && typeof row.diff === "object" ? (row.diff as TimelineCall["diff"]) : null;
    into.set(row.tool_use_id, { ts, class: row.class, diff });
  }
  return { pre, post, duplicates };
}

export interface GateRun {
  subject: string;
  ran_at: string;
  outcome: "pass" | "fail" | "none";
  wall_ms: number | null;
  key_digest: string | null;
  key_stable: boolean | null;
}

/**
 * One entry per `kind: "gate"` receipt of the session in the checkout's
 * store. The outcome is the `gate-outcome` receipt whose `evidence.run` is the
 * run receipt's digest; wall time comes only from the two receipts' createdAt.
 */
async function readGateRuns(root: string, sessionId: string | null): Promise<GateRun[]> {
  if (sessionId === null) return [];
  const [{ receiptsDir }, { receiptDigest }, { GATE_RECEIPT_KIND, GATE_OUTCOME_KIND }, fs, { join }] = await Promise.all([
    import("./dpt_paths"),
    import("./tracker_receipts"),
    import("./gate_receipt"),
    import("node:fs"),
    import("node:path"),
  ]);
  let dir: string;
  let names: string[];
  try {
    dir = receiptsDir(root, sessionId);
    names = fs.readdirSync(dir).sort();
  } catch {
    return [];
  }
  const stored: Array<{ digest: string; record: Record<string, any> }> = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      const bytes = fs.readFileSync(join(dir, name));
      const record = JSON.parse(bytes.toString("utf-8"));
      if (record !== null && typeof record === "object" && record.v === 1 && record.sessionId === sessionId && typeof record.kind === "string") {
        stored.push({ digest: receiptDigest(bytes), record });
      }
    } catch {
      // An unreadable receipt is no run.
    }
  }
  const outcomes = new Map<string, Record<string, any>>();
  for (const s of stored) {
    const run = s.record.kind === GATE_OUTCOME_KIND ? s.record.evidence?.run : undefined;
    if (typeof run === "string" && !outcomes.has(run)) outcomes.set(run, s.record);
  }
  const runs: GateRun[] = [];
  for (const s of stored) {
    if (s.record.kind !== GATE_RECEIPT_KIND) continue;
    const ranAt = String(s.record.createdAt);
    const out = outcomes.get(s.digest);
    const verdict = out?.decision;
    const paired = out !== undefined && (verdict === "pass" || verdict === "fail");
    const from = Date.parse(ranAt);
    const to = paired ? Date.parse(String(out.createdAt)) : NaN;
    const keyDigest = s.record.evidence?.key_digest;
    const keyStable = paired ? out.evidence?.key_stable : undefined;
    runs.push({
      subject: String(s.record.subject),
      ran_at: ranAt,
      outcome: paired ? verdict : "none",
      wall_ms: Number.isFinite(from) && Number.isFinite(to) ? to - from : null,
      key_digest: typeof keyDigest === "string" ? keyDigest : null,
      key_stable: typeof keyStable === "boolean" ? keyStable : null,
    });
  }
  return runs;
}

/**
 * Build the timeline from transcript text; `root` is the checkout root and
 * `sessionId` names the capture rows to pair with (none read when null).
 */
export async function buildTimeline(transcriptText: string, root: string, sessionId: string | null = null): Promise<Timeline> {
  const [{ firstCopies }, { classifyBashCall, skillClass }] = await Promise.all([
    import("../../../templates/hooks/_lib/session"),
    import("./tool_call_class"),
  ]);
  const records = transcriptText.split("\n").map(parseLine);
  const copies = firstCopies(records, { topLevel: true });

  const results = new Map<string, { at: number | null; isError: boolean; text: string }>();
  /** Forked results, by Skill call id: the first `<task-notification>` wins. */
  const notifications = new Map<string, string>();
  for (const { block, at } of copies) {
    if (block.type === "tool_result" && typeof block.tool_use_id === "string") {
      results.set(block.tool_use_id, { at, isError: block.is_error === true, text: resultText(block.content) });
      continue;
    }
    const text =
      block.type === "queue-operation" && typeof block.content === "string"
        ? block.content
        : block.type === "text" && typeof block.text === "string"
          ? block.text
          : null;
    const n = text === null ? null : notificationOf(text);
    if (n !== null && !notifications.has(n.id)) notifications.set(n.id, n.result);
  }

  const captured = await readCaptureRows(root, sessionId);
  const gaps = { orphan_pre: 0, orphan_post: 0, uncaptured: 0, duplicates: captured.duplicates };

  const calls: TimelineCall[] = [];
  const rounds: TimelineRound[] = [];
  for (const { block, record, at } of copies) {
    if (block.type !== "tool_use") continue;
    const name = block.name;
    if (name !== "Bash" && name !== "Skill") continue;
    const id = typeof block.id === "string" ? block.id : "";
    const input = (block.input ?? {}) as Record<string, unknown>;
    let cls: string;
    let skill: string | null = null;
    if (name === "Bash") {
      const command = typeof input.command === "string" ? input.command : "";
      const cwd = typeof record.cwd === "string" ? record.cwd : root;
      cls = classifyBashCall(command, cwd).class;
    } else {
      cls = "skill";
      skill = skillClass(input.skill);
    }
    const result = results.get(id);
    const ended = result?.at ?? null;
    const pre = captured.pre.get(id);
    const post = captured.post.get(id);
    const pairing: TimelineCall["pairing"] =
      pre && post ? "paired" : pre ? "orphan-pre" : post ? "orphan-post" : "uncaptured";
    if (pairing === "orphan-pre") gaps.orphan_pre++;
    else if (pairing === "orphan-post") gaps.orphan_post++;
    else if (pairing === "uncaptured") gaps.uncaptured++;
    const duration = pre && post && Number.isFinite(pre.ts) && Number.isFinite(post.ts) ? post.ts - pre.ts : null;
    calls.push({
      tool_use_id: id,
      tool: name,
      class: cls,
      skill,
      started_at: at,
      ended_at: ended,
      wall_ms: at !== null && ended !== null ? ended - at : null,
      is_error: result?.isError === true,
      diff: pre?.class === "commit" ? pre.diff : null,
      duration_ms: duration,
      pairing,
    });
    if (skill !== null && ROUND_SKILLS.has(skill)) {
      // A forked call's tool_result is the background stub; its result is the notification's body.
      const inline = result?.text ?? "";
      const text = BACKGROUND_STUB.test(inline) ? notifications.get(id) ?? "" : inline;
      rounds.push({
        tool_use_id: id,
        skill,
        status: await roundStatus(skill, text),
        tree_changed: null,
        tree_disposition: "not-observable",
        tokens: "not-observable",
      });
    }
  }

  return {
    schema: TIMELINE_SCHEMA,
    calls,
    rounds,
    gate_runs: await readGateRuns(root, sessionId),
    gaps,
  };
}

if (import.meta.main) {
  const [transcript, root] = process.argv.slice(2);
  const { readFileSync } = await import("node:fs");
  let text: string;
  try {
    text = readFileSync(transcript ?? "", "utf-8");
  } catch {
    const { emitNFR10 } = await import("../../../templates/hooks/_lib/session");
    emitNFR10(
      "Refusing",
      "the transcript cannot be read (no readable file at the transcript argument)",
      "pass a readable session transcript and the checkout root: bun run tool_call_timeline.ts <transcript> <checkout root>",
      "tool_call_timeline",
      "tool_call_timeline",
    );
    process.exit(1);
  }
  const { basename } = await import("node:path");
  const sessionId = basename(transcript ?? "").replace(/\.jsonl$/, "");
  const { toolCallLedgerPath } = await import("./dpt_paths");
  try {
    toolCallLedgerPath(root ?? process.cwd(), sessionId);
  } catch {
    const { emitNFR10 } = await import("../../../templates/hooks/_lib/session");
    emitNFR10(
      "Refusing",
      `the transcript's session id ${JSON.stringify(sessionId)} is not path-safe (one segment of [A-Za-z0-9._-])`,
      "pass the session transcript under its own file name, <session id>.jsonl",
      "tool_call_timeline",
      "tool_call_timeline",
    );
    process.exit(1);
  }
  console.log(JSON.stringify(await buildTimeline(text, root ?? process.cwd(), sessionId), null, 2));
  process.exit(0);
}
