// declared_test_commands — STE-730: the test commands a project DECLARES in
// `verification.test_commands`, run in place of the `stack_layout.ts` table.
//
// Shared by both front doors (`gate_capture.ts`, `capture_skip_baseline.ts`)
// so they run the same list the same way. The list is read ONLY through the
// settings loader, never from argv: a front door that can be handed a command
// can be handed the wrong one.
//
// Each entry runs, in list order, from the project root, through the bounded
// supervisor in `runGateNamingSkips`, count-only (its argv exactly as
// declared). Each output is parsed by its own entry's stack and the counts are
// summed. An entry with no readable count, or killed on its bound, refuses the
// whole run: a partial sum never stands.

import { deriveRunCounts } from "./deliver_stage_evidence";
import { runGateNamingSkips } from "./gate_identity_run";
import { loadProjectSection, SettingsShapeError, settingsKeyPathLine, settingsSectionValue } from "./project_settings";
import type { Stack } from "./test_count_parser";

/** One `verification.test_commands` entry, as the loader validated it. */
export interface DeclaredTestCommand {
  readonly stack: Stack;
  readonly command: readonly string[];
}

/**
 * The declared list, or `null` when the key is absent — and then the caller
 * takes the table path exactly as before. A loader refusal about some OTHER
 * key also reads as absent, so a tree that never declared a list prints what
 * it printed before. A refusal naming `verification.test_commands` is thrown
 * (NFR-10 shape): a malformed declared list never falls back to the table.
 * So is a refusal over another key when the raw section still carries a
 * `test_commands` key: a declared list never silently yields to the table.
 */
export function declaredTestCommands(projectRoot: string): readonly DeclaredTestCommand[] | null {
  let verification: Record<string, unknown> | undefined;
  try {
    verification = loadProjectSection(projectRoot, "verification");
  } catch (error) {
    if (error instanceof SettingsShapeError && error.reason.includes("verification.test_commands")) throw error;
    if (error instanceof SettingsShapeError && sectionDeclaresTestCommands(projectRoot)) throw error;
    return null;
  }
  const list = verification?.test_commands;
  if (!Array.isArray(list) || list.length === 0) return null;
  return list as DeclaredTestCommand[];
}

/**
 * True when the raw `verification` section carries a `test_commands` key, whatever the loader said.
 * When the file is not valid YAML at all, the raw text is read by indentation instead.
 */
function sectionDeclaresTestCommands(projectRoot: string): boolean {
  const section = settingsSectionValue(projectRoot, "verification");
  if (section === null) return settingsKeyPathLine(projectRoot, "verification.test_commands") !== null;
  const raw = section.value;
  return typeof raw === "object" && raw !== null && !Array.isArray(raw) && "test_commands" in raw;
}

/** The summed observation of every declared entry. */
export interface DeclaredRun {
  readonly pass: number;
  readonly fail: number;
  readonly skip: number;
  /** Every entry's command, joined, in list order. */
  readonly commands: readonly string[];
}

/**
 * Run every declared entry and sum the counts. Throws an NFR-10-shaped error
 * naming the entry when one prints no readable count or is killed on its bound.
 */
export function runDeclaredTestCommands(
  projectRoot: string,
  entries: readonly DeclaredTestCommand[],
): DeclaredRun {
  let pass = 0;
  let fail = 0;
  let skip = 0;
  const commands: string[] = [];
  entries.forEach((entry, i) => {
    const joined = entry.command.join(" ");
    const run = runGateNamingSkips(projectRoot, entry.stack, entry.command, undefined, { countOnly: true });
    if (run.killedOnBoundMs !== undefined) {
      throw declaredRefusal(i, joined, `was killed on its ${run.killedOnBoundMs} ms bound (DPT_GATE_TIMEOUT_MS)`);
    }
    const counts = deriveRunCounts({ output: run.output, stack: entry.stack });
    if (!counts.ok) {
      throw declaredRefusal(i, joined, `printed no readable ${entry.stack} count — ${counts.reason}`);
    }
    pass += counts.pass;
    fail += counts.fail;
    skip += counts.skip;
    commands.push(joined);
  });
  return { pass, fail, skip, commands };
}

/** The run's commands as one backticked, comma-joined phrase — the name both front doors print. */
export function namedDeclaredCommands(run: DeclaredRun): string {
  return run.commands.map((c) => `\`${c}\``).join(", ");
}

function declaredRefusal(index: number, joined: string, what: string): Error {
  return new Error(
    `declared test command \`${joined}\` (verification.test_commands[${index}]) ${what}; no partial sum stands.\n` +
      `Remedy: make \`${joined}\` finish within its bound and print its runner's summary line, or fix the entry in specs/settings.yaml.\n` +
      `Context: verification.test_commands[${index}] = ${JSON.stringify(joined)}`,
  );
}
