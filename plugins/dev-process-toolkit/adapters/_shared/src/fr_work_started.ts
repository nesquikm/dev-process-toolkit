// fr_work_started — STE-825: what shows an FR's work began.
//
// Reads two things and nothing else:
//   (a) the run-start ledger (`readRunStarts`): every /implement or /tdd row whose
//       `fr` names the tracker id or the FR id;
//   (b) HEAD's history, in one `git log` call: every commit whose message names the
//       tracker id (bounded by non-alphanumerics on both sides) and that touches at
//       least one path outside `specs/`. Paths are read relative to `projectRoot`
//       (`--relative`), so a project in a repo subdirectory reads its own `specs/`,
//       and a change outside the project directory is not seen.
// One evidence line per signal. A non-git directory or an empty repo yields no
// commit evidence; this never throws.
//
// Residual: the run-start ledger is opt-in. With tracking off, nothing marks the
// work as started before its first commit, so an FR whose code sits uncommitted
// and whose ticket was never claimed still reads as not started.

import { spawnSync } from "node:child_process";

import { namesTrackerIdRe } from "./active_ticket_drift_predicate";
import { readRunStarts } from "./run_start_ledger";

const WORK_SKILLS = new Set(["dev-process-toolkit:implement", "dev-process-toolkit:tdd"]);

const REC = "\x1e";
const SEP = "\x1f";

export function workStartedEvidence(projectRoot: string, trackerId: string, frId?: string): string[] {
  const evidence: string[] = [];

  for (const row of readRunStarts(projectRoot)) {
    if (!WORK_SKILLS.has(row.skill) || row.fr == null) continue;
    if (row.fr === trackerId || (frId !== undefined && row.fr === frId)) {
      evidence.push(`run-start: ${row.skill} ${row.fr} at ${row.started_at}`);
    }
  }

  const p = spawnSync("git", ["-C", projectRoot, "log", `--format=${REC}%H${SEP}%B${SEP}`, "--name-only", "--relative", "HEAD"], {
    encoding: "utf-8",
  });
  if (p.status !== 0 || typeof p.stdout !== "string") return evidence;

  const named = namesTrackerIdRe(trackerId);
  for (const record of p.stdout.split(REC)) {
    const parts = record.split(SEP);
    if (parts.length < 3) continue;
    const [sha, body, names] = parts as [string, string, string];
    if (!named.test(body)) continue;
    const paths = names.split("\n").map((l) => l.trim()).filter((l) => l !== "");
    if (paths.some((path) => !path.startsWith("specs/"))) {
      evidence.push(`commit: ${sha.trim()} names ${trackerId}`);
    }
  }
  return evidence;
}
