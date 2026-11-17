// STE-728 (M_d1b4b7) — a retrospective can propose a settings change the
// operator must approve.
//
//   bun run retro_proposal.ts propose <projectRoot> <report-file>
//   bun run retro_proposal.ts apply   <projectRoot> <report-file> <digest>
//
// `PROPOSABLE_SETTINGS` is the closed table of proposable rows. A row either
// turns a recording on (its key is `tracking.<name>.enabled` and its value is
// `true`) or, per STE-723, turns an optimization knob to reuse (its key is
// `optimizations.<knob>` for a knob in `OPTIMIZATION_KNOBS` and its value is
// `reuse`). A row outside that shape is refused when the module loads, before
// any proposal is computed.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { firstCopies, type FirstCopy } from "../../../templates/hooks/_lib/session";
import { receiptsRoot } from "./dpt_paths";
import { checkRegisterPreconditions, registerCapture } from "./capture_registration";
import { sessionTranscriptPath } from "./find_current_session";
import { perQuestionConsent } from "./join_consent_ownership";
import { loadProjectSection, SETTINGS_FILE, SettingsShapeError, settingsWriteSource } from "./project_settings";
import { writeProjectSettings } from "./project_settings_writer";
import { OPTIMIZATION_KNOBS } from "./optimizations_config";
import { parseRetroReport, type RetroReport } from "./retro_report";
import { EMPTY_SCOPE_REASON } from "./retro_scope";
import { bunInvocation, realpathOr } from "./shell_invocations";
import { readSessionReceipts, writeReceipt, type Receipt } from "./tracker_receipts";

export interface ProposalTrigger {
  /** The rule ids whose skip can justify the row. */
  rules: readonly string[];
  /** The text the skip reason must name. */
  names: string;
  /** Also fires when the scope resolved to no session with a reason naming `names`. */
  emptyScope: boolean;
  /** STE-723: fires when one of `rules` tripped (not on a skip), and only while the key `requires` is true. */
  tripped?: { requires: string };
}

export interface ProposableSetting {
  key: string;
  value: true | "reuse";
  trigger: ProposalTrigger;
}

export const PROPOSABLE_SETTINGS: readonly ProposableSetting[] = Object.freeze([
  {
    key: "tracking.token_stats.enabled",
    value: true,
    trigger: { rules: ["cost_per_changed_line"], names: "tracking.token_stats off", emptyScope: true },
  },
  {
    key: "tracking.tool_calls.enabled",
    value: true,
    trigger: { rules: ["slow_gate_run", "gate_rerun_unchanged_key", "zero_yield_round"], names: "tracking.tool_calls off", emptyScope: false },
  },
  {
    key: "tracking.gate_outcomes.enabled",
    value: true,
    trigger: { rules: ["slow_gate_run", "gate_rerun_unchanged_key"], names: "tracking.gate_outcomes off", emptyScope: false },
  },
  {
    key: "optimizations.gate_commands",
    value: "reuse",
    trigger: {
      rules: ["gate_rerun_unchanged_key"],
      names: "tracking.gate_outcomes on",
      emptyScope: false,
      tripped: { requires: "tracking.gate_outcomes.enabled" },
    },
  },
] as ProposableSetting[]);

const ROW_KEY_RE = /^tracking\.[a-z][a-z0-9_]*\.enabled$/;

const OPTIMIZATION_PREFIX = "optimizations.";

/** True for `optimizations.<knob>` with the knob in `OPTIMIZATION_KNOBS` (STE-723). */
function isOptimizationKey(key: string): boolean {
  return key.startsWith(OPTIMIZATION_PREFIX) && (OPTIMIZATION_KNOBS as readonly string[]).includes(key.slice(OPTIMIZATION_PREFIX.length));
}

/**
 * Refuse any row outside the closed shape: a `tracking.<name>.enabled` key with
 * the value `true`, or (STE-723) an `optimizations.<knob>` key, the knob in
 * `OPTIMIZATION_KNOBS`, with the value `reuse`.
 */
function assertClosedShape(rows: readonly unknown[]): void {
  for (const row of rows) {
    const r = row as Partial<ProposableSetting> | null;
    const key = typeof r?.key === "string" ? r.key : JSON.stringify(r?.key);
    const optimization = r !== null && typeof r === "object" && typeof r.key === "string" && isOptimizationKey(r.key);
    if (r === null || typeof r !== "object" || typeof r.key !== "string" || (!ROW_KEY_RE.test(r.key) && !optimization)) {
      throw new Error(`PROPOSABLE_SETTINGS: row ${key} is outside the closed shape (a tracking.<name>.enabled key or an optimizations.<knob> key)`);
    }
    if (optimization && r.value !== "reuse") {
      throw new Error(`PROPOSABLE_SETTINGS: row ${key} proposes ${JSON.stringify(r.value)}; only reuse is proposable for an optimizations knob`);
    }
    if (!optimization && r.value !== true) {
      throw new Error(`PROPOSABLE_SETTINGS: row ${key} proposes ${JSON.stringify(r.value)}; only true is proposable`);
    }
    if (r.trigger === null || r.trigger === undefined) {
      throw new Error(`PROPOSABLE_SETTINGS: row ${key} carries no trigger`);
    }
  }
}

assertClosedShape(PROPOSABLE_SETTINGS);

export interface ProposalMatch {
  row: ProposableSetting;
  rule: string;
  disposition: string;
  reason: string;
}

/** The rows the report's skips justify, each with the first rule result that triggered it. */
export function matchProposals(report: RetroReport): ProposalMatch[] {
  const out: ProposalMatch[] = [];
  for (const row of PROPOSABLE_SETTINGS) {
    if (row.trigger.tripped !== undefined) {
      const trip = report.rules.find((r) => r.disposition === "tripped" && row.trigger.rules.includes(r.id));
      if (trip !== undefined) out.push({ row, rule: trip.id, disposition: "tripped", reason: typeof trip.reason === "string" ? trip.reason : row.trigger.names });
      continue;
    }
    const hit = report.rules.find(
      (r) =>
        r.disposition !== "tripped" &&
        r.disposition !== "clear" &&
        typeof r.reason === "string" &&
        r.reason.includes(row.trigger.names) &&
        (row.trigger.rules.includes(r.id) || (row.trigger.emptyScope && r.reason.includes(EMPTY_SCOPE_REASON))),
    );
    if (hit !== undefined) out.push({ row, rule: hit.id, disposition: String(hit.disposition), reason: hit.reason as string });
  }
  return out;
}

export const LOCAL_SETTINGS_PATH = ".claude/settings.local.json";
const TOOL_CALLS_KEY = "tracking.tool_calls.enabled";
export const GITIGNORE_LINE = `add .gitignore: ${LOCAL_SETTINGS_PATH}`;

/** The row's current value, read through its own section: `tracking.<name>.enabled` or `optimizations.<knob>`. */
function currentValue(projectRoot: string, key: string): unknown {
  const [section, name, leaf] = key.split(".");
  if (section === "optimizations" && leaf === undefined) {
    return (loadProjectSection(projectRoot, "optimizations") as Record<string, unknown> | undefined)?.[name!];
  }
  if (section !== "tracking") throw new Error(`no section read for ${key}`);
  const tracking = loadProjectSection(projectRoot, "tracking") as Record<string, Record<string, unknown> | undefined>;
  return tracking?.[name!]?.[leaf!];
}

/**
 * True when `git check-ignore` reports the local settings file ignored by the
 * repository's own rules. The operator's personal excludes file is switched off
 * (`core.excludesFile=/dev/null`): a rule only one machine carries does not keep
 * the file out of a teammate's commit.
 */
export function localSettingsIgnored(projectRoot: string): boolean {
  const p = spawnSync("git", ["-C", projectRoot, "-c", "core.excludesFile=/dev/null", "check-ignore", "-q", LOCAL_SETTINGS_PATH], {
    encoding: "utf-8",
    env: process.env,
  });
  return p.status === 0;
}

function bytesOrNull(path: string): Buffer | null {
  return existsSync(path) ? readFileSync(path) : null;
}

/**
 * `sha256:<hex>` over realpath(projectRoot), the settings file bytes, the
 * `.gitignore` bytes and the printed lines (every line but the digest). Each
 * part is framed with a tag and its byte length, so no two inputs collide; an
 * absent file is framed apart from an empty one. `apply` recomputes this.
 */
export function proposalDigest(projectRoot: string, lines: readonly string[]): string {
  const h = createHash("sha256");
  const part = (tag: string, bytes: Buffer | null) => {
    if (bytes === null) h.update(`${tag}:absent\n`);
    else {
      h.update(`${tag}:${bytes.length}\n`);
      h.update(bytes);
      h.update("\n");
    }
  };
  part("root", Buffer.from(realpathSync(projectRoot), "utf-8"));
  part("settings", bytesOrNull(join(projectRoot, SETTINGS_FILE)));
  part("gitignore", bytesOrNull(join(projectRoot, ".gitignore")));
  part("lines", Buffer.from(lines.join("\n"), "utf-8"));
  return `sha256:${h.digest("hex")}`;
}

/**
 * The lines `propose` prints, digest last; `[]` when it stays silent (no row
 * applies, every applicable key is on, the home is not the settings file, or a
 * needed section read refuses). Reads only; writes nothing.
 */
export function proposeLines(projectRoot: string, reportText: string): string[] {
  const report = parseRetroReport(reportText);
  if (settingsWriteSource(projectRoot) !== "settings") return [];
  const matches = matchProposals(report).filter(
    (m) =>
      (m.row.trigger.tripped === undefined || currentValue(projectRoot, m.row.trigger.tripped.requires) === true) &&
      currentValue(projectRoot, m.row.key) !== m.row.value,
  );
  if (matches.length === 0) return [];
  const lines = [
    ...matches.map((m) => `set ${m.row.key}: ${m.row.value}`),
    ...matches.map((m) => `because ${m.rule} ${m.disposition.split(":")[0]}: ${m.reason}`),
  ];
  if (matches.some((m) => m.row.key === TOOL_CALLS_KEY) && !localSettingsIgnored(projectRoot)) {
    lines.push(GITIGNORE_LINE);
  }
  return [...lines, `digest=${proposalDigest(projectRoot, lines)}`];
}

// -------------------------------------------------------------------- revert

interface RecordedChange {
  key: string;
  from: unknown;
  to: unknown;
}

/** Every `retro-change` receipt in the tree, across every session directory. */
function changeReceipts(projectRoot: string): Receipt[] {
  const dir = receiptsRoot(projectRoot);
  if (!existsSync(dir)) return [];
  const out: Receipt[] = [];
  for (const session of readdirSync(dir)) {
    let receipts: Receipt[];
    try {
      receipts = readSessionReceipts(projectRoot, session).receipts;
    } catch {
      continue; // a directory name that is not a path-safe session id holds no receipts
    }
    out.push(...receipts.filter((r) => r.kind === "retro-change"));
  }
  return out;
}

/** The change for `key` in the newest `retro-change` receipt (by `applied_at`) that has one, with that `applied_at`. */
function newestChangeFor(projectRoot: string, key: string): { change: RecordedChange; appliedAt: string } | null {
  let best: { change: RecordedChange; appliedAt: string } | null = null;
  let bestAt = Number.NEGATIVE_INFINITY;
  let bestSession = "";
  for (const receipt of changeReceipts(projectRoot)) {
    const ev = receipt.evidence as { applied_at?: unknown; changes?: unknown } | null;
    // An applied_at that is not a date never wins: it would sort above every real one.
    if (typeof ev?.applied_at !== "string" || !Number.isFinite(Date.parse(ev.applied_at)) || !Array.isArray(ev.changes)) continue;
    const change = (ev.changes as RecordedChange[]).find((c) => c !== null && typeof c === "object" && c.key === key);
    if (change === undefined) continue;
    const at = Date.parse(ev.applied_at);
    // Equal times fall to the larger session id, so the pick never depends on directory order.
    const tie = best !== null && at === bestAt && receipt.sessionId > bestSession;
    if (best === null || at > bestAt || tie) {
      best = { change, appliedAt: ev.applied_at };
      bestAt = at;
      bestSession = receipt.sessionId;
    }
  }
  return best;
}

/**
 * The lines `propose-revert` prints, digest last: `revert <key>: <to> -> <from>`
 * from the newest `retro-change` receipt with a change for `key`, when the key
 * still holds that change's `to`. Throws a `RetroApplyRefusal` (NFR-10)
 * otherwise. Reads only; writes nothing.
 */
export function proposeRevertLines(projectRoot: string, key: string): string[] {
  const ctx = `root=${projectRoot}, verb=propose-revert, key=${key}`;
  // Only a proposable key, on a settings-file tree, is revertable: the same table and home a forward change uses.
  if (!PROPOSABLE_SETTINGS.some((r) => r.key === key)) {
    throw RetroApplyRefusal.of(
      `${key} is not a proposable setting, so no retro change can have set it.`,
      `revert one of: ${PROPOSABLE_SETTINGS.map((r) => r.key).join(", ")}.`,
      ctx,
    );
  }
  if (settingsWriteSource(projectRoot) !== "settings") {
    throw RetroApplyRefusal.of(
      `this tree keeps its settings outside ${SETTINGS_FILE}, so a retro revert has nothing to write.`,
      "run /dev-process-toolkit:upgrade to move the settings into the settings file, then re-run.",
      ctx,
    );
  }
  const found = newestChangeFor(projectRoot, key);
  if (found === null) {
    throw RetroApplyRefusal.of(
      `no retro-change receipt in this tree records a change for ${key}, so there is nothing to revert.`,
      "revert only a change a retro apply recorded; change the setting by hand otherwise.",
      ctx,
    );
  }
  const cur = currentValue(projectRoot, key);
  const current = cur === undefined ? "absent" : cur;
  // "absent" in a receipt is the unset sentinel: it matches only a key the file does not hold.
  const holds = found.change.to === "absent" ? cur === undefined : cur !== undefined && Bun.deepEquals(cur, found.change.to);
  if (!holds) {
    throw RetroApplyRefusal.of(
      `${key} is ${JSON.stringify(current)}, not the ${JSON.stringify(found.change.to)} the newest retro-change receipt (applied_at=${found.appliedAt}) set (edited since).`,
      "leave the hand edit, or set the key back by hand.",
      ctx,
    );
  }
  // Values print as JSON so a boolean and its string spelling never read alike; "absent" prints bare.
  const show = (v: unknown) => (v === "absent" ? "absent" : JSON.stringify(v));
  const lines = [`revert ${key}: ${show(found.change.to)} -> ${show(found.change.from)}`];
  // The digest also binds the receipt reverted, so a newer change landing after the approval is refused.
  return [...lines, `digest=${proposalDigest(projectRoot, [...lines, `receipt=${found.appliedAt}`])}`];
}

// --------------------------------------------------------------------- apply

/** The option label an approving answer selects, exactly. */
export const APPLY_LABEL = "Apply the shown change";
/** The fixed line `apply` prints right after it writes its consumption receipt. */
export const CONSUMED_PREFIX = "retro-apply: consumed digest=";

/** This module's own file, as the filesystem sees it. */
const OWN_MODULE = realpathOr(import.meta.path);

/** An NFR-10 refusal of `apply` (`Refusing:` / `Remedy:` / `Context:`). */
export class RetroApplyRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetroApplyRefusal";
  }
  static of(why: string, remedy: string, context: string): RetroApplyRefusal {
    const one = (t: string) => t.replace(/\s*\n\s*/g, " ");
    return new RetroApplyRefusal(`Refusing: ${one(why)}\nRemedy: ${one(remedy)}\nContext: ${one(context)}`);
  }
}

/**
 * Whether a Bash command RAN this module's `verb`: one plain
 * `bun [run] <absolute path> <verb> …` whose path realpaths to this file, read
 * by the `bunInvocation` grammar `announcesGateReceipt` uses. An `echo`, a
 * `cd … &&` chain, a relative path or a same-named file elsewhere runs nothing.
 */
export function runsRetroProposal(command: string, verb: "propose" | "apply" | "propose-revert" | "apply-revert"): boolean {
  const run = bunInvocation(command);
  return run !== null && run.module === OWN_MODULE && run.args[0] === verb;
}

/** The text a `tool_result` carries, whether it is a string or content blocks. */
function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((c) => (c !== null && typeof c === "object" && typeof (c as { text?: unknown }).text === "string" ? (c as { text: string }).text : ""))
    .join("\n");
}

/**
 * The answer the harness recorded to ONE question of an `AskUserQuestion`
 * tool_result: the record's `toolUseResult.answers[question]`, else the
 * harness sentence `"<question>"="<answer>"` in the result text. Null when the
 * result records no answer to that question.
 * Twin: `answerTo` in templates/hooks/_lib/hooks/pre-tracker-write-gate.ts
 */
export function askAnswerTo(record: unknown, block: unknown, question: string): string | null {
  const tur = (record as { toolUseResult?: { answers?: unknown } } | null)?.toolUseResult;
  if (tur && tur.answers && typeof tur.answers === "object") {
    const v = (tur.answers as Record<string, unknown>)[question];
    return typeof v === "string" ? v : null;
  }
  const text = resultText((block as { content?: unknown } | null)?.content);
  const at = text.indexOf(`"${question}"="`);
  if (at < 0) return null;
  const m = /^([^"]*)"(?=[.,]\s|[.,]?$)/.exec(text.slice(at + question.length + 4));
  return m ? m[1]! : null;
}

function textLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.replace(/\r$/, ""))
    .filter((l) => l !== "");
}

interface Approval {
  /** The approving answer record's `uuid`. */
  answer: string;
  /** Its position in the first-copy list. */
  at: number;
}

/** Read the session transcript's records (one parsed value per line; null for a line that does not parse). */
function readRecords(path: string): unknown[] {
  return readFileSync(path, "utf-8")
    .split("\n")
    .map((l) => {
      if (l.trim() === "") return null;
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    });
}

type Block = FirstCopy["block"];

/** Every `tool_use` block by its id, first copy wins. */
function toolUses(copies: readonly FirstCopy[]): Map<string, Block> {
  const uses = new Map<string, Block>();
  for (const c of copies) {
    if (c.block.type === "tool_use" && typeof c.block.id === "string" && !uses.has(c.block.id)) uses.set(c.block.id, c.block);
  }
  return uses;
}

/** The command string of a Bash `tool_use`, else undefined. */
function bashCommand(use: Block | undefined): string | undefined {
  if (use?.name !== "Bash") return undefined;
  const command = (use.input as { command?: unknown } | undefined)?.command;
  return typeof command === "string" ? command : undefined;
}

/**
 * Steps 1 and 2 of the gate: every answer, in transcript order, that approves
 * `digest` after a real propose whose result printed `lines` (digest last).
 */
function approvals(
  copies: FirstCopy[],
  uses: ReadonlyMap<string, Block>,
  lines: readonly string[],
  digest: string,
  verb: "propose" | "propose-revert" = "propose",
): Approval[] {
  const useOf = (c: FirstCopy) =>
    c.block.type === "tool_result" && c.block.tool_use_id !== "" ? uses.get(c.block.tool_use_id as string) : undefined;
  const digestLine = `digest=${digest}`;
  const out: Approval[] = [];
  const seen = new Set<number>();
  copies.forEach((c, p) => {
    const use = useOf(c);
    if (c.block.is_error === true) return;
    const command = bashCommand(use);
    if (command === undefined || !runsRetroProposal(command, verb)) return;
    const printed = textLines(resultText(c.block.content));
    if (!printed.includes(digestLine)) return;
    // The question is graded against the lines this result printed, never recomputed;
    // apply also checks its recomputed proposal prints the same lines.
    if (printed.length !== lines.length || printed.some((l, i) => l !== lines[i])) return;
    const names = (question: string) => {
      const own = new Set(textLines(question));
      return printed.every((l) => own.has(l));
    };
    for (let i = p + 1; i < copies.length; i++) {
      const a = copies[i]!;
      const ask = useOf(a);
      if (ask === undefined || ask.name !== "AskUserQuestion" || a.block.is_error === true || seen.has(i)) continue;
      const questions = (ask.input as { questions?: unknown } | undefined)?.questions;
      const verdict = perQuestionConsent(questions, APPLY_LABEL, names, (q) => askAnswerTo(a.record, a.block, q));
      if (verdict !== true || typeof a.record.uuid !== "string") continue;
      seen.add(i);
      out.push({ answer: a.record.uuid, at: i });
    }
  });
  return out.sort((x, y) => x.at - y.at);
}

/** Step 3: whether an approval is already used — by its receipt, a recorded call, or a consumption line. */
function consumed(
  copies: FirstCopy[],
  uses: ReadonlyMap<string, Block>,
  approval: Approval,
  digest: string,
  receiptAnswers: ReadonlySet<string>,
): boolean {
  if (receiptAnswers.has(approval.answer)) return true;
  const hex = digest.replace(/^sha256:/, "");
  const consumedLine = `${CONSUMED_PREFIX}${digest}`;
  for (let i = approval.at + 1; i < copies.length; i++) {
    const c = copies[i]!;
    if (c.block.type !== "tool_result") continue;
    if (textLines(resultText(c.block.content)).includes(consumedLine)) return true;
    const command = bashCommand(uses.get(c.block.tool_use_id as string));
    if (command !== undefined && command.includes("retro_proposal") && command.includes(hex)) return true;
  }
  return false;
}

function asRefusal(e: unknown, why: string, remedy: string, context: string): RetroApplyRefusal {
  if (e instanceof RetroApplyRefusal) return e;
  const msg = e instanceof Error ? e.message : String(e);
  if (/^Refusing: .+\nRemedy: .+\nContext: .+/.test(msg)) return new RetroApplyRefusal(msg);
  return RetroApplyRefusal.of(`${why}: ${msg}`, remedy, context);
}

/** The nested settings update that sets each `section.name.leaf` key to its value. */
function settingsUpdate(rows: readonly ProposableSetting[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const row of rows) {
    const parts = row.key.split(".");
    const leaf = parts.pop()!;
    let node = out;
    for (const part of parts) node = (node[part] ??= {}) as Record<string, unknown>;
    node[leaf] = row.value;
  }
  return out;
}

/**
 * The approval gate `apply` and `apply-revert` share: find this session's
 * approval of `digest` after a real `verb` call printing `lines`, refuse when
 * none is left unconsumed, then consume it (receipt, then the fixed line).
 */
function consumeApproval(
  session: string,
  root: string,
  lines: readonly string[],
  digest: string,
  verb: "propose" | "propose-revert",
  ctx: string,
  reask: string,
): void {
  const transcript = sessionTranscriptPath(session, process.cwd());
  if (transcript === null) {
    throw RetroApplyRefusal.of("this session's transcript was not found, so no approval can be verified.", "run apply from the Claude Code session that asked the question.", `${ctx}, session=${session}`);
  }
  let copies: FirstCopy[];
  try {
    copies = firstCopies(readRecords(transcript));
  } catch (e) {
    throw asRefusal(e, "the session transcript could not be read", reask, ctx);
  }
  const uses = toolUses(copies);
  const found = approvals(copies, uses, lines, digest, verb);
  if (found.length === 0) {
    throw RetroApplyRefusal.of(
      `the transcript holds no real propose printing digest=${digest} followed by a question repeating every printed line answered "${APPLY_LABEL}".`,
      reask,
      `${ctx}, transcript=${transcript}`,
    );
  }
  let receiptAnswers: Set<string>;
  try {
    receiptAnswers = new Set(
      readSessionReceipts(root, session)
        .receipts.filter((r) => r.kind === "retro-apply")
        .map((r) => (r.evidence as { answer?: unknown } | null)?.answer)
        .filter((a): a is string => typeof a === "string"),
    );
  } catch (e) {
    throw asRefusal(e, "this session's receipt store could not be read", reask, ctx);
  }
  const approval = found.find((a) => !consumed(copies, uses, a, digest, receiptAnswers));
  if (approval === undefined) {
    throw RetroApplyRefusal.of(
      "the approval for this digest is already consumed: an earlier apply used it (one approval admits one apply, whatever its outcome).",
      "fix the cause, then re-run propose and ask again.",
      `${ctx}, transcript=${transcript}`,
    );
  }

  // Consume the approval first; the receipt is never rolled back.
  try {
    writeReceipt(root, {
      kind: "retro-apply",
      adapter: null,
      container: null,
      subject: "dev-process-toolkit:retro",
      decision: "apply",
      evidence: { answer: approval.answer, digest },
    });
  } catch (e) {
    throw asRefusal(e, "the retro-apply receipt could not be written", "fix this session's receipt store (tracker_receipts.ts names its directory), then re-run propose and ask again.", ctx);
  }
  process.stdout.write(`${CONSUMED_PREFIX}${digest}\n`);
}

/** Write options pinning the settings bytes as read now; the write refuses if they change before it lands. */
function settingsSnapshot(projectRoot: string): { expectSha256?: string } {
  const readBytes = bytesOrNull(join(projectRoot, SETTINGS_FILE));
  return readBytes === null ? {} : { expectSha256: createHash("sha256").update(readBytes).digest("hex") };
}

/** The session id an apply runs under; refuses when it is unset. */
function requireSession(ctx: string): string {
  const session = process.env.CLAUDE_CODE_SESSION_ID;
  if (session === undefined || session === "") {
    throw RetroApplyRefusal.of("CLAUDE_CODE_SESSION_ID is unset, so no session transcript can show an approval.", "run apply from the Claude Code session that asked the question.", ctx);
  }
  return session;
}

/**
 * `apply-revert <projectRoot> <key> <digest>`: recompute `propose-revert`,
 * verify and consume this session's approval as `apply` does, then set `key`
 * back to the recorded `from` — removing it (and each parent it empties) when
 * `from` is "absent". Never writes a default. Throws a `RetroApplyRefusal`.
 */
export function applyRevert(projectRoot: string, key: string, digest: string): void {
  const ctx = `root=${projectRoot}, verb=apply-revert, key=${key}, digest=${digest}`;
  const reask = "re-run propose-revert so it prints a fresh digest, and approve that one.";
  const session = requireSession(ctx);
  let root: string;
  let lines: string[];
  let writeOpts: { expectSha256?: string };
  try {
    root = realpathSync(projectRoot);
    writeOpts = settingsSnapshot(projectRoot);
    lines = proposeRevertLines(projectRoot, key);
  } catch (e) {
    throw asRefusal(e, "the revert proposal could not be recomputed", reask, ctx);
  }
  if (lines[lines.length - 1] !== `digest=${digest}`) {
    throw RetroApplyRefusal.of("the digest no longer matches the revert proposal for this tree (stale, or printed for another root).", reask, ctx);
  }
  const found = newestChangeFor(projectRoot, key)!;
  const from = found.change.from;
  consumeApproval(session, root, lines, digest, "propose-revert", ctx, reask);
  try {
    if (from === "absent") writeProjectSettings(projectRoot, {}, { ...writeOpts, remove: [key] });
    else writeProjectSettings(projectRoot, settingsUpdate([{ key, value: from } as ProposableSetting]), writeOpts);
  } catch (e) {
    throw asRefusal(e, "the revert could not be applied", reask, ctx);
  }
  // The revert landed: record it as its own change, pointing at the receipt it reverted.
  const changes = [{ key, from: found.change.to, to: from }];
  try {
    writeReceipt(root, {
      kind: "retro-change",
      adapter: null,
      container: null,
      subject: "dev-process-toolkit:retro",
      decision: "apply",
      evidence: { digest, applied_at: new Date().toISOString(), changes, revert_of: found.appliedAt },
    });
  } catch (e) {
    throw asRefusal(
      e,
      "the revert is applied, but its retro-change receipt could not be written",
      `no retry is needed; record the change by hand: changes=${JSON.stringify(changes)}`,
      ctx,
    );
  }
}

/**
 * `apply <projectRoot> <report-file> <digest>`: recompute the proposal, verify
 * this session's transcript approval, consume it (receipt, then the fixed
 * consumption line), then check, write, append and register. Returns the keys
 * written; throws a `RetroApplyRefusal` (NFR-10) otherwise. Never exits.
 */
export function apply(projectRoot: string, reportPath: string, digest: string): { keys: string[] } {
  const ctx = `root=${projectRoot}, verb=apply, digest=${digest}`;
  const reask = "re-run /dev-process-toolkit:retro so propose prints a fresh digest, and approve that one.";
  const session = requireSession(ctx);
  let root: string;
  let lines: string[];
  // The settings bytes the proposal is recomputed from; the write refuses if they change before it lands.
  let writeOpts: { expectSha256?: string };
  try {
    root = realpathSync(projectRoot);
    writeOpts = settingsSnapshot(projectRoot);
    lines = proposeLines(projectRoot, readFileSync(reportPath, "utf-8"));
  } catch (e) {
    throw asRefusal(e, "the proposal could not be recomputed", reask, ctx);
  }
  if (lines.length === 0 || lines[lines.length - 1] !== `digest=${digest}`) {
    throw RetroApplyRefusal.of("the digest no longer matches the proposal for this tree (stale, or printed for another root).", reask, ctx);
  }
  consumeApproval(session, root, lines, digest, "propose", ctx, reask);

  const rows = PROPOSABLE_SETTINGS.filter((r) => lines.includes(`set ${r.key}: ${r.value}`));
  const keys = rows.map((r) => r.key);
  const toolCalls = keys.includes(TOOL_CALLS_KEY);
  const addIgnore = lines.includes(GITIGNORE_LINE);

  // 1. Check.
  if (toolCalls) {
    const refusals = checkRegisterPreconditions(projectRoot, { settingOn: true }).filter(
      (r) => !(addIgnore && r.includes(`${LOCAL_SETTINGS_PATH} is not ignored by git`)),
    );
    if (refusals.length > 0) throw asRefusal(new Error(refusals[0]!), "the capture precondition check refused", reask, ctx);
  }

  const paths = [join(projectRoot, SETTINGS_FILE), join(projectRoot, ".gitignore"), join(projectRoot, LOCAL_SETTINGS_PATH)];
  const prior = paths.map((p) => bytesOrNull(p));
  const changes = rows.map((r) => {
    const from = currentValue(projectRoot, r.key);
    return { key: r.key, from: from === undefined ? "absent" : from, to: r.value };
  });
  // Only a step that ran is rolled back, so a rollback never writes over a file this apply did
  // not change: a settings write the writer refused (another writer's lock, changed bytes) left
  // the file as that other writer has it, and every such refusal is a SettingsShapeError.
  const touched = paths.map(() => false);
  const restore = () => {
    paths.forEach((p, i) => {
      if (!touched[i]) return;
      const b = prior[i]!;
      if (b === null) rmSync(p, { force: true });
      else writeFileSync(p, b);
    });
  };
  try {
    // 2. Write each row's key.
    try {
      writeProjectSettings(projectRoot, settingsUpdate(rows), writeOpts);
      touched[0] = true;
    } catch (e) {
      touched[0] = !(e instanceof SettingsShapeError);
      throw e;
    }
    // 3. Append the printed .gitignore line.
    if (addIgnore) {
      const gi = paths[1]!;
      touched[1] = true;
      const text = existsSync(gi) ? readFileSync(gi, "utf-8") : "";
      writeFileSync(gi, `${text}${text === "" || text.endsWith("\n") ? "" : "\n"}${LOCAL_SETTINGS_PATH}\n`);
    }
    // 4. Register the capture hook.
    if (toolCalls) {
      touched[2] = true;
      const refusals = registerCapture(projectRoot);
      if (refusals.length > 0) throw new RetroApplyRefusal(refusals[0]!);
    }
  } catch (e) {
    try {
      restore();
    } catch (r) {
      // Keep the original cause, and say the rollback did not complete.
      // Built directly: asRefusal passes an already-shaped refusal through unchanged,
      // which would drop the rollback failure on exactly the register-refusal path.
      const why = r instanceof Error ? r.message : String(r);
      const cause = (e instanceof Error ? e.message : String(e)).replace(/^Refusing: /, "").split("\n")[0]!;
      throw RetroApplyRefusal.of(
        `the settings change could not be applied (${cause}), and restoring the prior bytes failed (${why}).`,
        "restore the settings file, .gitignore and .claude/settings.local.json by hand, then re-run propose and ask again.",
        ctx,
      );
    }
    throw asRefusal(e, "the settings change could not be applied", reask, ctx);
  }
  // 5. Every step succeeded: record what changed.
  try {
    writeReceipt(root, {
      kind: "retro-change",
      adapter: null,
      container: null,
      subject: "dev-process-toolkit:retro",
      decision: "apply",
      evidence: { digest, applied_at: new Date().toISOString(), changes },
    });
  } catch (e) {
    // The change is applied and the approval is spent, so a retry would find nothing to change.
    throw asRefusal(
      e,
      "the settings change is applied, but its retro-change receipt could not be written",
      `no retry is needed; record the change by hand if a later revert must check it: changes=${JSON.stringify(changes)}`,
      ctx,
    );
  }
  return { keys };
}

if (import.meta.main) {
  const [, , verb, rootArg, reportArg, digestArg] = process.argv;
  if (verb === "apply") {
    let code = 0;
    try {
      if (rootArg === undefined || reportArg === undefined || digestArg === undefined) {
        throw RetroApplyRefusal.of("apply needs <projectRoot> <report-file> <digest>.", "run: bun run retro_proposal.ts apply <projectRoot> <report-file> <digest>", "verb=apply");
      }
      apply(rootArg, reportArg, digestArg);
    } catch (e) {
      process.stderr.write(`${asRefusal(e, "apply failed", "re-run propose and ask again.", "verb=apply").message}\n`);
      code = 1;
    }
    process.exit(code);
  }
  if (verb === "apply-revert") {
    let code = 0;
    try {
      const keyArg = reportArg; // apply-revert's second argument is the key, not a report file
      if (rootArg === undefined || keyArg === undefined || digestArg === undefined) {
        throw RetroApplyRefusal.of("apply-revert needs <projectRoot> <key> <digest>.", "run: bun run retro_proposal.ts apply-revert <projectRoot> <key> <digest>", "verb=apply-revert");
      }
      applyRevert(rootArg, keyArg, digestArg);
    } catch (e) {
      process.stderr.write(`${asRefusal(e, "apply-revert failed", "re-run propose-revert and ask again.", "verb=apply-revert").message}\n`);
      code = 1;
    }
    process.exit(code);
  }
  if (verb === "propose-revert") {
    let code = 0;
    try {
      if (rootArg === undefined || reportArg === undefined) {
        throw RetroApplyRefusal.of("propose-revert needs <projectRoot> <key>.", "run: bun run retro_proposal.ts propose-revert <projectRoot> <key>", "verb=propose-revert");
      }
      console.log(proposeRevertLines(rootArg, reportArg).join("\n"));
    } catch (e) {
      process.stderr.write(`${asRefusal(e, "propose-revert failed", "fix the cause, then re-run propose-revert.", "verb=propose-revert").message}\n`);
      code = 1;
    }
    process.exit(code);
  }
  try {
    if (verb === "propose" && rootArg !== undefined && reportArg !== undefined) {
      const lines = proposeLines(rootArg, readFileSync(reportArg, "utf-8"));
      if (lines.length > 0) console.log(lines.join("\n"));
    }
  } catch {
    // propose stays silent on any failure
  }
  process.exit(0);
}
