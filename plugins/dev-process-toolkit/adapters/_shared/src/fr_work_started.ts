// fr_work_started — STE-825: what shows an FR's work began.
//
// Reads two things and nothing else:
//   (a) the run-start ledger (`readRunStarts`): every /implement or /tdd row whose
//       `fr` names the tracker id or the FR id;
//   (b) the history of HEAD (when it exists) and every local branch (`refs/heads/*`;
//       remote refs are not read), in one `git log` call that asks git only for the
//       commits whose message contains the tracker id (`--grep`, fixed string, any
//       letter case), so a real-sized history never fills the output buffer. `--grep`
//       is a substring match, so the id boundary (non-alphanumerics on both sides; ASCII
//       case folding only, no Unicode lookalikes) is re-checked here. A commit counts
//       when it also touches at least one path outside `specs/`. Paths are read relative to `projectRoot` (`--relative`), so a project
//       in a repo subdirectory reads its own `specs/`, and a change outside the project
//       directory is not seen.
// One evidence line per signal. Git runs with `--no-replace-objects`, a 5 s timeout,
// a 64 MB output buffer, and `process.env` minus every `GIT_*` variable, so an inherited GIT_DIR cannot point
// it at another repository.
//
// Fails closed: a history that cannot be read counts as evidence that the work began.
// Git missing, a spawn error, an overflowed buffer (ENOBUFS), a signal, a null or
// non-zero exit, a timeout or unparseable output each yields one evidence line naming
// the failure. A readable history with no commit naming the id reads as not started,
// as does a repository with no commits yet (no HEAD and no local branches); an unborn
// HEAD beside local branches reads the branches only. This never throws.
//
// Residual: the run-start ledger is opt-in. With tracking off, nothing marks the
// work as started before its first commit, so an FR whose code sits uncommitted
// and whose ticket was never claimed still reads as not started.

import { spawnSync, type SpawnSyncReturns } from "node:child_process";

import { namesTrackerIdRe } from "./active_ticket_drift_predicate";
import { readRunStarts } from "./run_start_ledger";

const WORK_SKILLS = new Set(["dev-process-toolkit:implement", "dev-process-toolkit:tdd"]);

const REC = "\x1e";
const SEP = "\x1f";
const GIT_TIMEOUT_MS = 5_000;
const GIT_MAX_BUFFER = 64 * 1024 * 1024;

function gitEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !k.startsWith("GIT_")) env[k] = v;
  }
  return env;
}

function runGit(projectRoot: string, args: string[]): SpawnSyncReturns<string> {
  return spawnSync("git", ["--no-replace-objects", "-C", projectRoot, ...args], {
    encoding: "utf-8",
    // Passed, not left to default: under Bun an omitted `env` resolves `git` against the
    // PATH the process started with (HS-1).
    env: gitEnv(),
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
  });
}

/** Null when git ran and exited 0 with string output; otherwise the failure, named. */
function gitFailure(what: string, p: SpawnSyncReturns<string>, okStatuses: number[] = [0]): string | null {
  if (p.error) {
    const code = (p.error as NodeJS.ErrnoException).code;
    if (code === "ETIMEDOUT") return `git-unreadable: ${what} timed out after ${GIT_TIMEOUT_MS}ms`;
    return `git-unreadable: ${what} could not run (${code ?? p.error.message})`;
  }
  if (p.signal) return `git-unreadable: ${what} killed by ${p.signal}`;
  if (p.status === null || !okStatuses.includes(p.status)) return `git-unreadable: ${what} exited ${p.status}`;
  if (typeof p.stdout !== "string") return `git-unreadable: ${what} gave no output`;
  return null;
}

export function workStartedEvidence(projectRoot: string, trackerId: string, frId?: string): string[] {
  const evidence: string[] = [];

  for (const row of readRunStarts(projectRoot)) {
    if (!WORK_SKILLS.has(row.skill) || row.fr == null) continue;
    if (row.fr === trackerId || (frId !== undefined && row.fr === frId)) {
      evidence.push(`run-start: ${row.skill} ${row.fr} at ${row.started_at}`);
    }
  }

  // An empty repository — HEAD unborn (exit 1) and no local branch — is the one
  // history that reads as "not started".
  const head = runGit(projectRoot, ["rev-parse", "--verify", "-q", "HEAD"]);
  const headFail = gitFailure("git rev-parse HEAD", head, [0, 1]);
  if (headFail !== null) return [...evidence, headFail];
  const branches = runGit(projectRoot, ["for-each-ref", "--format=%(refname)", "refs/heads/"]);
  const branchFail = gitFailure("git for-each-ref refs/heads", branches);
  if (branchFail !== null) return [...evidence, branchFail];
  if (head.status === 1 && branches.stdout.trim() === "") return evidence;

  const revs = head.status === 0 ? ["HEAD", "--branches"] : ["--branches"];
  const p = runGit(projectRoot, [
    "log",
    "--fixed-strings",
    "--regexp-ignore-case",
    `--grep=${trackerId}`,
    `--format=${REC}%H${SEP}%B${SEP}`,
    "--name-only",
    "--relative",
    ...revs,
  ]);
  const logFail = gitFailure("git log", p);
  if (logFail !== null) return [...evidence, logFail];

  const records = p.stdout.split(REC).filter((r) => r.trim() !== "");

  const named = new RegExp(namesTrackerIdRe(trackerId).source, "i");
  for (const record of records) {
    const parts = record.split(SEP);
    if (parts.length < 3) return [...evidence, "git-unreadable: git log output did not parse"];
    const [sha, body, names] = parts as [string, string, string];
    if (!named.test(body)) continue;
    const paths = names.split("\n").map((l) => l.trim()).filter((l) => l !== "");
    if (paths.some((path) => !path.startsWith("specs/"))) {
      evidence.push(`commit: ${sha.trim()} names ${trackerId}`);
    }
  }
  return evidence;
}
