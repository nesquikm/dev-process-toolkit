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
// Amended in the v3.5.0 fix round 2 (supervisor spec review): `entry: implement` is
// passed on EVERY run, not only a resume, so a first run's halt names /implement.
export const STEP_8_APPEND =
  " Step 8 always passes `entry: implement` to the orchestrator, so even a first run's halt report names `/dev-process-toolkit:implement` for the resume; when `--resume-at <point>` follows the FR, it also passes that on, as `/dev-process-toolkit:tdd <FR-id> --resume-at <point>`: `docs/implement-reference.md` § Defect checks, resuming a halt and parked tests.";

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

// Amended by AC-STE-788.1 (M_870603): line 102 (index 101), Phase 2 step 11, invokes
// /dev-process-toolkit:gate-check with the driven-run marker in place of "Run the gate commands".
// Amended by AC-STE-788.2 (M_870603): the same line states the gate-check report never ends the turn.
// Admitted only as this one exact line; undoing it gives back the frozen bytes, so any other edit fails.
export const STEP_11_INDEX = 101;
export const STEP_11_OLD =
  "11. **Gate check** — Run the gate commands from step 3. This is the **deterministic kill switch**: if it fails, fix before proceeding. Use `/dev-process-toolkit:debug` for unclear failures.";
export const STEP_11_NEW =
  "11. **Gate check** — Invoke `/dev-process-toolkit:gate-check` with the driven-run marker `<dpt:driven>v1</dpt:driven>` in its arguments; it runs the gate commands from step 3. This is the **deterministic kill switch**: if it fails, fix before proceeding. The gate-check report never ends this skill's turn: on a pass, continue to Phase 3, then Phase 4, in the same turn. Use `/dev-process-toolkit:debug` for unclear failures.";

/** The lines with the AC-STE-788.1/.2 step-11 line reversed, or the reason it is not carried exactly. */
export function undoSte788(lines: readonly string[]): { lines: string[] } | { error: string } {
  const out = [...lines];
  if (out[STEP_11_INDEX] !== STEP_11_NEW) {
    return { error: "line 102 is not exactly its AC-STE-788.1/.2 gate-check step" };
  }
  out[STEP_11_INDEX] = STEP_11_OLD;
  return { lines: out };
}
