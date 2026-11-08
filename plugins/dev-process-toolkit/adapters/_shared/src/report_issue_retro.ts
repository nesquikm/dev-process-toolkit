// STE-721 (M_d1b4b7) — `/report-issue --from-retro`.
//
// `retroPromptDefaults` turns a `dpt-retro/1` report into the four suggested
// answers, one per canonical `/report-issue` prompt, in canonical order:
// what happened, expected, severity, reproducible. The operator's answer
// always wins; these are only the `(from retro)` first options.

import { readFileSync, realpathSync } from "node:fs";
import { sep } from "node:path";

import { retroReportsDir } from "./dpt_paths";
import { parseRetroReport, type RetroReport } from "./retro_report";
import { formatRetroThreshold } from "./retro_rules";

export const RETRO_EXPECTED_DEFAULT = "Every retro rule within its threshold.";

export function retroPromptDefaults(report: RetroReport): [string, string, string, string] {
  const tripped = report.rules.filter((r) => r.disposition === "tripped");
  const clauses = tripped.map((r) => `${r.id} (${r.value} ${r.unit}, threshold ${formatRetroThreshold(r)})`);
  const whatHappened = `${tripped.length} retro rule(s) tripped: ${clauses.join("; ")}`;
  const severity = report.suggested_severity ?? "";
  // /retro takes no word for "this session": a session-scope report suggests the bare command, even when
  // its scope carries an alias id (`s1`), which the front door refuses as free text.
  const reproducible = report.scope.kind !== "session" && report.scope.id ?`Run /dev-process-toolkit:retro ${report.scope.id}.` : "Run /dev-process-toolkit:retro.";
  return [whatHappened, RETRO_EXPECTED_DEFAULT, severity, reproducible];
}

export type RetroInputCheck = { ok: true; report: RetroReport; path: string } | { ok: false; refusal: string };

function refusal(first: string, remedy: string, context: string): { ok: false; refusal: string } {
  return { ok: false, refusal: `${first}\nRemedy: ${remedy}\nContext: ${context}` };
}

/**
 * The `--from-retro <file>` input check (AC-STE-721.3). Read-only: it writes
 * nothing and creates no temp directory. The file must resolve, after
 * symlinks, inside `<projectRoot>/.dpt/ledger/retro/`, pass
 * `parseRetroReport`, and carry `tripped_count` > 0.
 */
export function checkRetroInput(file: string, projectRoot: string): RetroInputCheck {
  let real: string;
  let ledger: string;
  try {
    real = realpathSync(file);
    ledger = realpathSync(retroReportsDir(projectRoot));
  } catch (e) {
    return refusal(
      `Refusing: --from-retro ${file} does not resolve inside .dpt/ledger/retro/.`,
      "pass a report written by /dev-process-toolkit:retro under .dpt/ledger/retro/.",
      `path=${file}; error=${(e as Error).message}`,
    );
  }
  if (!real.startsWith(ledger + sep)) {
    return refusal(
      `Refusing: --from-retro ${file} resolves outside .dpt/ledger/retro/.`,
      "pass a report written by /dev-process-toolkit:retro under .dpt/ledger/retro/, not a copy or a symlink to one elsewhere.",
      `path=${file}; resolved=${real}`,
    );
  }
  let report: RetroReport;
  try {
    report = parseRetroReport(readFileSync(real, "utf-8"));
  } catch (e) {
    return refusal(
      `Refusing: --from-retro ${file} is not a valid dpt-retro/1 report.`,
      "re-run /dev-process-toolkit:retro to write a fresh report, then pass that file.",
      `parseRetroReport: ${(e as Error).message}`,
    );
  }
  if (report.tripped_count === 0) {
    return refusal(
      `Refusing: --from-retro ${file} has nothing to file.`,
      "file an issue only from a report where at least one retro rule tripped.",
      "tripped_count=0",
    );
  }
  return { ok: true, report, path: real };
}
