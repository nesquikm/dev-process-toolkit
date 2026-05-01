// setup_bootstrap_commit_subject — /gate-check probe (STE-183 AC-STE-183.4).
//
// Scans the most recent `chore: bootstrap dev-process-toolkit*` commit on the
// current branch and asserts:
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
// Vacuous when the project is not a git repository, or no
// `chore: bootstrap dev-process-toolkit*` commit exists in the log.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

// FR ship date. Commits authored strictly before this instant get the
// legacy carve-out; commits at or after must match the new shape.
const SHIP_DATE_CUTOFF = "2026-05-01T00:00:00Z";

const SUBJECT_GREP = "^chore: bootstrap dev-process-toolkit";
const SUBJECT_EXACT = "chore: bootstrap dev-process-toolkit";
const TOOLKIT_LINE_RE =
  /^Toolkit: dev-process-toolkit v\d+\.\d+\.\d+$/;
// NUL separator written via the explicit escape sequence so editors and
// formatters that strip literal NUL bytes from text files can't silently
// degrade the split to whitespace and misparse every commit.
const NUL = "\x00";

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

function gitLog(projectRoot: string): string | null {
  try {
    // %H = SHA, %x00 = NUL separator, %aI = ISO 8601 strict author date,
    // %s = subject, %b = body. Limit to the most recent matching commit.
    const out = execFileSync(
      "git",
      [
        "log",
        "-n",
        "1",
        `--grep=${SUBJECT_GREP}`,
        "--format=%H%x00%aI%x00%s%x00%b",
      ],
      { cwd: projectRoot, encoding: "utf-8" },
    );
    return out.trim().length === 0 ? null : out;
  } catch {
    return null;
  }
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

  const raw = gitLog(projectRoot);
  if (raw === null) return { violations: [] };

  // Split on the NUL delimiter that `git log --format=%H%x00...` emits.
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
