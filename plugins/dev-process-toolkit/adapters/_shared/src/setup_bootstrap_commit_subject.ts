// setup_bootstrap_commit_subject — /gate-check probe (STE-183 AC-STE-183.4).
//
// Selects the most recent non-merge commit on the current branch whose
// SUBJECT starts with `chore: bootstrap dev-process-toolkit` and asserts:
//   (a) subject is exactly `chore: bootstrap dev-process-toolkit` (no
//       parenthesized version suffix), AND
//   (b) body either has no `Toolkit:` line at all (best-effort footer per
//       AC-STE-183.3 — missing plugin.json yields no footer), OR carries
//       exactly one line matching `^Toolkit: dev-process-toolkit v\d+\.\d+\.\d+$`.
//
// Backwards-compat carve-out: commits authored before SHIP_DATE_CUTOFF are
// treated as legacy and pass vacuously (covers downstream repos whose
// bootstrap commit predates this FR).
//
// Selection reads the subject only (STE-873). A merge commit is never
// selected, and neither is a commit that merely quotes the prefix in its
// body — `git log --grep` matches the whole message, so it only narrows the
// candidates and the subject is re-checked here.
//
// Vacuous when the project is not a git repository, or no non-merge commit
// with a `chore: bootstrap dev-process-toolkit*` subject exists in the log.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

// FR ship date. Commits authored strictly before this instant get the
// legacy carve-out; commits at or after must match the new shape.
const SHIP_DATE_CUTOFF = "2026-05-01T00:00:00Z";

// The canonical subject. It is also the prefix a commit's subject must start
// with to be selected as the bootstrap commit.
const SUBJECT_EXACT = "chore: bootstrap dev-process-toolkit";
const TOOLKIT_LINE_RE =
  /^Toolkit: dev-process-toolkit v\d+\.\d+\.\d+$/;
// NUL separator written via the explicit escape sequence so editors and
// formatters that strip literal NUL bytes from text files can't silently
// degrade the split to whitespace and misparse every commit.
const NUL = "\x00";
// Record separator (ASCII RS) opening every commit record, written as an
// escape for the same reason. Fields inside a record stay NUL-separated, so
// one commit's body cannot run into the next commit's SHA.
const RS = "\x1e";

export interface SetupBootstrapCommitSubjectViolation {
  file: string;
  line: number;
  reason: string;
  note: string;
  message: string;
}

export interface SetupBootstrapCommitSubjectReport {
  violations: SetupBootstrapCommitSubjectViolation[];
}

function isGitRepo(projectRoot: string): boolean {
  return existsSync(join(projectRoot, ".git"));
}

// Candidate commit records, newest first, or null when git fails.
function gitLogCandidates(projectRoot: string): string[] | null {
  try {
    // %x1e = record separator, %H = SHA, %x00 = NUL field separator,
    // %aI = ISO 8601 strict author date, %s = subject, %b = body.
    // `--no-merges` keeps merge commits out. `--grep` matches anywhere in the
    // message (a body line included), so it is a pre-filter only: every
    // candidate is returned and the subject is re-checked by the caller.
    // `--fixed-strings` keeps that pre-filter a plain substring match whatever
    // `grep.patternType` the user has configured. Any git failure (no git, a
    // refused repository, an overflowing buffer) is deliberately vacuous, as
    // the header says, and git's stderr is kept out of the gate's output.
    const out = execFileSync(
      "git",
      [
        "log",
        "--no-merges",
        "--fixed-strings",
        `--grep=${SUBJECT_EXACT}`,
        "--format=%x1e%H%x00%aI%x00%s%x00%b",
      ],
      {
        cwd: projectRoot,
        encoding: "utf-8",
        maxBuffer: 64 * 1024 * 1024,
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    return out.split(RS);
  } catch {
    return null;
  }
}

// The first (newest) record whose subject starts with the canonical subject,
// or null when no candidate qualifies.
function selectBootstrapRecord(records: string[]): string | null {
  for (const record of records) {
    const subject = record.split(NUL)[2];
    if (subject !== undefined && subject.startsWith(SUBJECT_EXACT)) {
      return record;
    }
  }
  return null;
}

function findMalformedToolkitLine(body: string): string | null {
  const lines = body.split("\n");
  for (const line of lines) {
    if (line.startsWith("Toolkit:") && !TOOLKIT_LINE_RE.test(line)) {
      return line;
    }
  }
  return null;
}

function countToolkitLines(body: string): number {
  let n = 0;
  for (const line of body.split("\n")) {
    if (TOOLKIT_LINE_RE.test(line)) n += 1;
  }
  return n;
}

export async function runSetupBootstrapCommitSubjectProbe(
  projectRoot: string,
): Promise<SetupBootstrapCommitSubjectReport> {
  if (!isGitRepo(projectRoot)) return { violations: [] };

  const records = gitLogCandidates(projectRoot);
  if (records === null) return { violations: [] };

  const raw = selectBootstrapRecord(records);
  if (raw === null) return { violations: [] };

  // `raw` is the one selected record. Split it on the NUL delimiter that
  // `git log --format=%x1e%H%x00...` puts between its fields.
  // Re-join body parts with the same delimiter so a body containing a NUL
  // round-trips faithfully (rare, but `%b` is the raw commit body).
  const [sha, authorDateIso, subject, ...bodyParts] = raw.split(NUL);
  if (sha === undefined || authorDateIso === undefined || subject === undefined) {
    return { violations: [] };
  }
  const body = bodyParts.join(NUL);

  // Backwards-compat carve-out: legacy commits authored before SHIP_DATE_CUTOFF
  // pass vacuously, regardless of subject or footer shape.
  if (Date.parse(authorDateIso.trim()) < Date.parse(SHIP_DATE_CUTOFF)) {
    return { violations: [] };
  }

  const violations: SetupBootstrapCommitSubjectViolation[] = [];

  // (a) Subject MUST be the exact literal — no parenthesized suffix.
  if (subject.trim() !== SUBJECT_EXACT) {
    const reason = `bootstrap commit subject must be exactly \`${SUBJECT_EXACT}\` (no parenthesized suffix), found \`${subject.trim()}\``;
    const note = `${sha}:1 — ${reason}`;
    const message = [
      `setup_bootstrap_commit_subject: ${reason}`,
      `Remedy: re-issue the bootstrap commit using the canonical subject \`chore: bootstrap dev-process-toolkit\`. The toolkit version belongs in the \`Toolkit: dev-process-toolkit v<plugin-version>\` body footer (per skills/setup/SKILL.md § Step 8b).`,
      `Context: sha=${sha.slice(0, 7)}, observed=\`${subject.trim()}\`, expected=\`${SUBJECT_EXACT}\`, probe=setup_bootstrap_commit_subject`,
    ].join("\n");
    violations.push({ file: sha, line: 1, reason, note, message });
  }

  // (b) Body must NOT contain a malformed `Toolkit:` line. Absence of a
  // `Toolkit:` line is permitted (best-effort footer; missing plugin.json
  // path).
  const malformed = findMalformedToolkitLine(body);
  if (malformed !== null) {
    const reason = `Toolkit: footer line is malformed: \`${malformed}\` does not match \`^Toolkit: dev-process-toolkit v<X>.<Y>.<Z>$\``;
    const note = `${sha}:body — ${reason}`;
    const message = [
      `setup_bootstrap_commit_subject: ${reason}`,
      `Remedy: amend the bootstrap commit body to either (a) drop the malformed Toolkit: line entirely or (b) replace with a valid \`Toolkit: dev-process-toolkit vX.Y.Z\` line read from \`plugins/dev-process-toolkit/.claude-plugin/plugin.json\` \`version\` field.`,
      `Context: sha=${sha.slice(0, 7)}, malformed_line=\`${malformed}\`, expected_pattern=\`^Toolkit: dev-process-toolkit v\\d+\\.\\d+\\.\\d+$\`, probe=setup_bootstrap_commit_subject`,
    ].join("\n");
    violations.push({ file: sha, line: 2, reason, note, message });
  } else if (countToolkitLines(body) > 1) {
    // Multiple valid Toolkit: lines — should be exactly one.
    const reason = `bootstrap commit body must contain at most one Toolkit: footer line; found ${countToolkitLines(body)}`;
    const note = `${sha}:body — ${reason}`;
    const message = [
      `setup_bootstrap_commit_subject: ${reason}`,
      `Remedy: amend the bootstrap commit body to retain a single \`Toolkit: dev-process-toolkit vX.Y.Z\` footer.`,
      `Context: sha=${sha.slice(0, 7)}, count=${countToolkitLines(body)}, expected=1, probe=setup_bootstrap_commit_subject`,
    ].join("\n");
    violations.push({ file: sha, line: 2, reason, note, message });
  }

  return { violations };
}
