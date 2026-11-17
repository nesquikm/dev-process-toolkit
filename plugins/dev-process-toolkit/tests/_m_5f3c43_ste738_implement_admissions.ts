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


// Amended by AC-STE-835.1 (M_d1e7b1): two more edits ride the same freezes.
// (a) Phase 3 gains one paragraph, the spec-conflict escalation (AC-STE-835.1/.2),
//     inserted with the blank line above it; (b) the reference-only Architecture
//     Note moved to docs/implement-reference.md under NFR-1's overflow rule,
//     leaving one pointer line in its place. `undoSte835` reverses both by exact
//     bytes and position, and must run FIRST: every other admission indexes the
//     pre-STE-835 layout.
export const STE_835_PARAGRAPH =
  "   **Spec conflict.** A review finding that conflicts with the FR's Acceptance Criteria, Technical Design or Testing section never edits the FR file \u2014 not to fix the finding, not to make the spec agree with the code. The round ends there as an escalation to the operator that names the FR section and the finding. On that path /implement **MUST emit `implement_spec_conflict_escalated`** as a literal backticked token.";
export const STE_835_POINTER =
  "Architecture note (why this skill runs in-process, not forked): `docs/implement-reference.md` \u00a7 Architecture Note.";
export const STE_835_ARCH_NOTE_BODY =
  "This skill runs in-process in the main session \u2014 deliberately **not** `context: fork`. Phase 3 Stage B spawns the `code-reviewer` subagent via the `Agent` tool, and Claude Code forbids nested subagent spawns. The review-fix loop additionally requires findings to flow back to the same implementer that wrote the code. Full rationale: `docs/patterns.md` \u00a7 Pattern: `/implement` Runs In-Process.";

/** Current index of the STE-835 paragraph: right after step i (index 212) and its new blank (213). */
export const STE_835_PARAGRAPH_INDEX = 214;

/** The lines with both STE-835 edits undone, or the reason they are not carried exactly once in place. */
export function undoSte835(lines: readonly string[]): { lines: string[] } | { error: string } {
  const out = [...lines];
  const at = out.indexOf(STE_835_PARAGRAPH);
  if (at < 1 || out.lastIndexOf(STE_835_PARAGRAPH) !== at || out[at - 1] !== "") {
    return { error: "the STE-835 Phase 3 paragraph is not carried exactly once, after one blank line" };
  }
  if (at !== STE_835_PARAGRAPH_INDEX) {
    return { error: `the STE-835 Phase 3 paragraph sits at index ${at}, not ${STE_835_PARAGRAPH_INDEX} (after step i)` };
  }
  out.splice(at - 1, 2);
  const p = out.indexOf(STE_835_POINTER);
  if (p < 0 || out.lastIndexOf(STE_835_POINTER) !== p) {
    return { error: "the STE-835 Architecture Note pointer is not carried exactly once" };
  }
  // The pointer replaced the note in place: it is the file's last non-empty line.
  const lastText = out.map((l, i) => (l.trim() === "" ? -1 : i)).reduce((a, b) => Math.max(a, b), -1);
  if (p !== lastText) {
    return { error: "the STE-835 Architecture Note pointer is not the file's last line" };
  }
  out.splice(p, 1, "## Architecture Note", "", STE_835_ARCH_NOTE_BODY);
  return { lines: out };
}

/** Where a pre-STE-835 line index sits in the current file: the paragraph and its blank land at indexes 213-214. */
export function currentIndex(preSte835Index: number): number {
  // Derived from the paragraph's position: its blank line takes the first moved index.
  const firstMoved = STE_835_PARAGRAPH_INDEX - 1;
  return preSte835Index >= firstMoved ? preSte835Index + 2 : preSte835Index;
}

// Amended by AC-STE-745.1 (M_d1e7b1): step 14 gains the lead-in budget and its
// literal template, appended to the end of its own line. `undoSte745` strips
// exactly that text and must run before every other undo step.
export const STE_745_STEP_14_APPEND =
  " **The lead-in budget:** at most three sentences, each at most 20 words (`PLAIN_SENTENCE_WORD_CAP`), counted inside the stage's whole-report line cap; write it from the template at the end of this step, filling each `<...>` placeholder (`docs/implement-reference.md` \u00a7 Step 14 Lead-in). Lead-in template: `<fr-id> is built and the gate is green. The status block below lists every AC, file and check. Reply yes to commit, or name what to change.`";

/** The lines with the STE-745 step-14 append undone, or the reason it is not carried exactly once. */
export function undoSte745(lines: readonly string[]): { lines: string[] } | { error: string } {
  const out = [...lines];
  const at = out.findIndex((l) => l.startsWith("14. **Report**"));
  const line = at < 0 ? "" : out[at]!;
  if (at < 0 || !line.endsWith(STE_745_STEP_14_APPEND) || line.split(STE_745_STEP_14_APPEND).length !== 2) {
    return { error: "step 14 does not end with its STE-745 lead-in append exactly once" };
  }
  out[at] = line.slice(0, -STE_745_STEP_14_APPEND.length);
  return { lines: out };
}
