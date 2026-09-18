// STE-602 AC-STE-602.7 — the receipt store.
//
// One JSON file per tracker-write decision, under the session's receipts
// directory (composed by `receiptsDir` alone). The session id comes from
// `CLAUDE_CODE_SESSION_ID` only: absent, empty or path-unsafe refuses with
// nothing written — there is no fallback to transcript discovery.
//
// A missing `.dpt/.gitignore` is created through `writeDptGitignore`; an
// existing one (canonical or hand-edited) is never rewritten.

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { receiptsDir } from "./dpt_paths";
import { dptGitignorePath, writeDptGitignore } from "./setup/dpt_gitignore";

/** The line prefix a receipt write is announced with. */
export const RECEIPT_ANNOUNCEMENT_PREFIX = "dpt-receipt: ";

export interface ReceiptInput {
  kind: string;
  adapter: string;
  container: string;
  subject: string;
  decision: string;
  evidence: unknown;
}

export interface Receipt extends ReceiptInput {
  v: 1;
  sessionId: string;
  root: string;
  createdAt: string;
}

export interface SessionReceipts {
  receipts: Receipt[];
  /** Files present in the session directory that did not parse as a receipt. */
  skipped: number;
}

/** Resolve the session id from the environment, or throw (nothing written). */
function sessionIdFromEnv(): string {
  const id = process.env.CLAUDE_CODE_SESSION_ID;
  if (id === undefined || id === "") {
    throw new Error("writeReceipt: CLAUDE_CODE_SESSION_ID is unset or empty; refusing to write");
  }
  return id;
}

/** Write one receipt for the current session; returns the receipt file's path. */
export function writeReceipt(projectRoot: string, input: ReceiptInput): string {
  const sessionId = sessionIdFromEnv();
  const dir = receiptsDir(projectRoot, sessionId); // throws on a path-unsafe id
  if (!existsSync(dptGitignorePath(projectRoot))) writeDptGitignore(projectRoot);
  mkdirSync(dir, { recursive: true });
  const createdAt = new Date().toISOString();
  const receipt: Receipt = {
    v: 1,
    kind: input.kind,
    sessionId,
    root: projectRoot,
    adapter: input.adapter,
    container: input.container,
    subject: input.subject,
    decision: input.decision,
    evidence: input.evidence,
    createdAt,
  };
  const name = `${createdAt.replace(/[:.]/g, "-")}-${randomBytes(4).toString("hex")}.json`;
  const path = join(dir, name);
  writeFileSync(path, `${JSON.stringify(receipt)}\n`, { flag: "wx" });
  return path;
}

function isReceipt(value: unknown, sessionId: string): value is Receipt {
  if (value === null || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  return r.v === 1 && r.sessionId === sessionId && typeof r.kind === "string";
}

/** Read every receipt of one session; malformed files are skipped and counted. */
export function readSessionReceipts(projectRoot: string, sessionId: string): SessionReceipts {
  const dir = receiptsDir(projectRoot, sessionId);
  const out: SessionReceipts = { receipts: [], skipped: 0 };
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith(".json")) continue;
    try {
      const parsed = JSON.parse(readFileSync(join(dir, name), "utf-8"));
      if (isReceipt(parsed, sessionId)) out.receipts.push(parsed);
      else out.skipped += 1;
    } catch {
      out.skipped += 1;
    }
  }
  return out;
}
