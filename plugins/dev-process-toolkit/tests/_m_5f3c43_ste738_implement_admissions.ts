// STE-738 (M_5f3c43) AC-STE-738.13 — the three skills/implement/SKILL.md lines
// admitted through the AC-STE-722.8 and AC-STE-738.4 freezes, so that /implement
// parses the `--resume-at` its halt reports name and passes it on to /tdd.
//
// Each admission is one exact edit to one line. `undoAdmissions` reverses all
// three; a file that does not carry each of them exactly once, or carries any
// other change on those lines, does not reverse to the frozen bytes.

/** Line 4 (index 3), the argument-hint: an exact substitution. */
export const HINT_INDEX = 3;
export const HINT_OLD = "[--code-only]'";
export const HINT_NEW = "[--code-only] [--resume-at <AC-id>|refactor|audit]'";

/** Line 92 (index 91), Phase 2 step 8's orchestrator call: an exact append. */
export const STEP_8_INDEX = 91;
export const STEP_8_APPEND =
  " When `--resume-at <point>` follows the FR, pass it and `entry: implement` on to `/dev-process-toolkit:tdd <FR-id> --resume-at <point>`: `docs/implement-reference.md` § Defect checks, resuming a halt and parked tests.";

/** Line 280 (index 279), Phase 4 step 14's report: an exact append. */
export const STEP_14_INDEX = 279;
export const STEP_14_APPEND =
  " Each of the end-to-end outcome's `advisories` is stated as one `follow_ups` row: `docs/implement-reference.md` § Phase 4 End-to-End Authoring Hook.";

export const ADMITTED_INDEXES = [HINT_INDEX, STEP_8_INDEX, STEP_14_INDEX] as const;

/** The lines with the three admissions reversed, or a reason one is not carried exactly. */
export function undoAdmissions(lines: readonly string[]): { lines: string[] } | { error: string } {
  const out = [...lines];
  const hint = out[HINT_INDEX] ?? "";
  if (!hint.endsWith(HINT_NEW) || hint.split("--resume-at").length !== 2) {
    return { error: "line 4 does not carry the --resume-at argument-hint exactly once" };
  }
  out[HINT_INDEX] = hint.slice(0, -HINT_NEW.length) + HINT_OLD;
  for (const [i, suffix, name] of [
    [STEP_8_INDEX, STEP_8_APPEND, "line 92"],
    [STEP_14_INDEX, STEP_14_APPEND, "line 280"],
  ] as const) {
    const line = out[i] ?? "";
    if (!line.endsWith(suffix) || line.split(suffix).length !== 2) {
      return { error: `${name} does not end with its AC-STE-738.13 pointer exactly once` };
    }
    out[i] = line.slice(0, -suffix.length);
  }
  return { lines: out };
}
