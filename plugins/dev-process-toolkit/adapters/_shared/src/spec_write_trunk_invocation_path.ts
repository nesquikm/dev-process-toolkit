// spec_write_trunk_invocation_path — M126 / STE-478.
//
// THE ORDERING /spec-write's § 7a prose could not carry on its own.
//
// The 2026-08-16 jira conformance leg invoked `/spec-write` from `master` with
// the auto-approve marker present. The § 7a branch gate took the `created`
// outcome, `git checkout -b` ran, the tracker Epic + Task were created — and
// the run never came back to the § 7a commit. It ended with the FR still
// STAGED, `git log master..HEAD` = 0, and another skill's report as the closing
// output.
//
// § 7a said two independently-true things — outcome `created` ⇒ `git checkout
// -b`, and separately the commit gate commits — and stated no ordering between
// them. A control path shaped like that is satisfiable by doing half of it. So
// the ordering moves out of prose and into this module: the steps are
// enumerated with a dense strictly-increasing order, exactly one of them is
// terminal, and the three terminal states (one committed, two SANCTIONED
// staged-but-uncommitted exits) are named. The skill quotes this module rather
// than restating it, so the two sides cannot drift apart silently — the
// producer/consumer asymmetry this repo has now hit five times.
//
// Every git fact a caller feeds the classifier is MEASURED off a real repo
// through `observeTrunkGitState`, never asserted about text.

// ---------------------------------------------------------------------------
// The ordered control path.
// ---------------------------------------------------------------------------

export type TrunkStepId =
  | "branch_gate"
  | "write_spec_files"
  | "stage_spec_files"
  | "commit_gate"
  | "closing_summary";

export interface TrunkInvocationStep {
  id: TrunkStepId;
  /** Dense, 1-based, strictly increasing. A gap or a tie cannot express "prelude". */
  order: number;
  description: string;
  /**
   * Literal capability tokens this step owes the closing summary. Every entry
   * is ALREADY registered in `closing_summary_capability_keys.ts` — this module
   * registers nothing new.
   */
  requiredTokens: readonly string[];
  /** Only the closing summary ends the path. Branch creation never does. */
  terminal: boolean;
}

export const TRUNK_INVOCATION_STEPS: readonly TrunkInvocationStep[] = [
  {
    id: "branch_gate",
    order: 1,
    description:
      "§ 7a universal pre-commit branch gate — off-trunk before anything is committed. " +
      "A PRELUDE to the commit below, never a substitute for it.",
    requiredTokens: ["branch_gate_default_applied"],
    terminal: false,
  },
  {
    id: "write_spec_files",
    order: 2,
    description: "Write the FR file and the plan file the run authored.",
    requiredTokens: [],
    terminal: false,
  },
  {
    id: "stage_spec_files",
    order: 3,
    description:
      "Stage the explicit path list under `specs/` (never `git add -A`).",
    requiredTokens: [],
    terminal: false,
  },
  {
    id: "commit_gate",
    order: 4,
    description:
      "§ 7a commit gate — marker present ⇒ default-apply `y` and COMMIT the staged specs.",
    requiredTokens: ["spec_write_commit_default_applied"],
    terminal: false,
  },
  {
    id: "closing_summary",
    order: 5,
    description:
      "§ 7 report — /spec-write's OWN summary block is the closing output of the run.",
    requiredTokens: [],
    terminal: true,
  },
];

/** Required tokens in step order, de-duplicated. */
function requiredTokensInOrder(): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const step of TRUNK_INVOCATION_STEPS) {
    for (const token of step.requiredTokens) {
      if (seen.has(token)) continue;
      seen.add(token);
      out.push(token);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The terminal states.
// ---------------------------------------------------------------------------

export type TrunkTerminalStateId =
  | "committed"
  | "staged_marker_absent_non_tty_refusal"
  | "staged_interactive_decline";

export interface TrunkTerminalState {
  id: TrunkTerminalStateId;
  /** Whether this exit legitimately leaves spec files staged-but-uncommitted. */
  stagedUncommitted: boolean;
  /**
   * Tracker items are created in Steps 2–3, well before § 7a — so EVERY
   * terminal below is reachable with live tracker state already sitting in a
   * real tracker. True on all three; the question is never "could there be
   * state", only "is the operator told about it".
   */
  trackerStateMayExist: boolean;
  /**
   * Whether this exit owes the operator an explicit closing disclosure of what
   * it created. True on exactly the staged-but-uncommitted exits: a committed
   * run's tracker binding rides in the commit it just landed, a staged one's
   * rides nowhere and is findable only by accident.
   */
  trackerDisclosureRequired: boolean;
  /** The literal token this documented path emits — a literal already in § 7a. */
  token: string;
  sanctioned: true;
  description: string;
}

export const TRUNK_TERMINAL_STATES: readonly TrunkTerminalState[] = [
  {
    id: "committed",
    stagedUncommitted: false,
    trackerStateMayExist: true,
    trackerDisclosureRequired: false,
    token: "spec_write_commit_default_applied",
    sanctioned: true,
    description:
      "The commit gate default-applied (marker present) and the spec commit landed on the created branch.",
  },
  {
    id: "staged_marker_absent_non_tty_refusal",
    stagedUncommitted: true,
    trackerStateMayExist: true,
    trackerDisclosureRequired: true,
    token: "RequiresInputRefusedError",
    sanctioned: true,
    description:
      "Marker absent under non-tty stdin — the commit gate refused (NFR-10 canonical shape, gate site `commit`) " +
      "and exited non-zero with the specs staged so the operator loses no work.",
  },
  {
    id: "staged_interactive_decline",
    stagedUncommitted: true,
    trackerStateMayExist: true,
    trackerDisclosureRequired: true,
    token: "spec_write_commit_declined",
    sanctioned: true,
    description:
      "Interactive `n` at the commit gate — files remain staged and the operator commits manually.",
  },
];

/**
 * The fourth shape — the MEASURED DEFECT. Staged, uncommitted, and matching
 * neither sanctioned exit. Deliberately NOT a member of TRUNK_TERMINAL_STATES:
 * it is the state the enumeration exists to exclude.
 */
export const UNSANCTIONED_STAGED_UNCOMMITTED = "unsanctioned_staged_uncommitted";

export const TRUNK_VIOLATIONS = {
  commitSkipped: "trunk_commit_skipped",
  foreignClosingSummary: "trunk_foreign_closing_summary",
  missingCapabilityTokens: "trunk_missing_capability_tokens",
  unsanctionedStaged: "trunk_unsanctioned_staged_uncommitted",
  undisclosedTrackerState: "trunk_undisclosed_tracker_state",
} as const;

// ---------------------------------------------------------------------------
// Tracker disclosure — the OTHER half of the measured failure.
// ---------------------------------------------------------------------------

/**
 * The literal closing-output shape that constitutes "saying so": this string
 * followed on the SAME LINE by the comma-separated created ids. It is a literal
 * substring of the shipped § 7a disclosure clause below, the same
 * producer/consumer pinning idiom SPEC_WRITE_SUMMARY_SIGNALS uses against the
 * § 7 fence.
 */
export const TRACKER_DISCLOSURE_SIGNAL = "Tracker state created but not committed:";

/**
 * True iff nothing was created, or every created id appears on some line
 * carrying TRACKER_DISCLOSURE_SIGNAL (a union across signal lines is fine).
 *
 * SCOPED ON PURPOSE. `DST-75` occurs 14 times and `DST-74` 5 times in the
 * DEFECTIVE run's own assistant text — mid-run narration while the tickets were
 * being created. A "does the id appear anywhere?" check scores the measured
 * defect as DISCLOSED, which is exactly the pin-that-cannot-fail this module
 * exists to avoid. Disclosure lives on the closing signal line or nowhere.
 */
export function trackerStateDisclosed(
  assistantText: string,
  createdIds: readonly string[],
): boolean {
  return undisclosedTrackerIds(assistantText, createdIds).length === 0;
}

/**
 * Does a run that landed on `terminalState` owe the operator a closing tracker
 * disclosure?
 *
 * SINGLE-SOURCED FROM THE TABLE. The obligation is declared once, on
 * `TrunkTerminalState.trackerDisclosureRequired`, and read back here — the
 * classifier does not re-derive it from `staged` and so cannot drift from the
 * documented terminals the way a second hand-kept list would. The unsanctioned
 * shape is deliberately absent from the table (it is what the enumeration
 * excludes), and it owes disclosure on exactly the fact that defines it: it
 * left work staged.
 */
function disclosureRequiredFor(
  terminalState: TrunkRunVerdict["terminalState"],
  staged: boolean,
): boolean {
  const documented = TRUNK_TERMINAL_STATES.find((s) => s.id === terminalState);
  // The unsanctioned shape owes disclosure UNCONDITIONALLY, not only when it
  // left work staged. A run that created tracker items and landed nothing at
  // all — nothing staged, nothing committed — is the worst case of the set,
  // and gating on `staged` would be the one shape that exempts it.
  return documented ? documented.trackerDisclosureRequired : true;
}

/** The created ids NOT named on any disclosure line, in the order given. */
function undisclosedTrackerIds(
  assistantText: string,
  createdIds: readonly string[],
): string[] {
  const ids = Array.isArray(createdIds) ? createdIds : [];
  if (ids.length === 0) return [];
  const text = typeof assistantText === "string" ? assistantText : "";
  const signalLines = text
    .split("\n")
    .filter((line) => line.includes(TRACKER_DISCLOSURE_SIGNAL));
  if (signalLines.length === 0) return [...ids];
  return ids.filter((id) => !signalLines.some((line) => line.includes(id)));
}

// ---------------------------------------------------------------------------
// Measured git state.
// ---------------------------------------------------------------------------

export interface TrunkGitState {
  currentBranch: string;
  /** `git rev-list --count <trunk>..HEAD`. */
  commitsAhead: number;
  /** `git diff --cached --name-only`, filtered to `specs/`, sorted. */
  stagedSpecPaths: string[];
}

/**
 * Trimmed stdout on exit 0; `""` otherwise. Any git failure is data, not a
 * throw — the git-plumbing house style shared with `branch_milestone_scan.ts`
 * and `local_provider.ts`, so a non-repo root degrades instead of exploding.
 */
function safeGit(repoRoot: string, ...args: string[]): string {
  try {
    const proc = Bun.spawnSync({ cmd: ["git", ...args], cwd: repoRoot });
    if (proc.exitCode !== 0) return "";
    return new TextDecoder().decode(proc.stdout).trim();
  } catch {
    return "";
  }
}

export function observeTrunkGitState(
  repoRoot: string,
  trunk: string,
): TrunkGitState {
  const currentBranch = safeGit(repoRoot, "rev-parse", "--abbrev-ref", "HEAD");

  // A failed count and an unparseable count are the same fact: nothing measured
  // ahead of trunk. Both land on 0 rather than leaking NaN into the classifier.
  const parsed = Number.parseInt(
    safeGit(repoRoot, "rev-list", "--count", `${trunk}..HEAD`),
    10,
  );
  const commitsAhead = Number.isFinite(parsed) ? parsed : 0;

  const stagedSpecPaths = safeGit(repoRoot, "diff", "--cached", "--name-only")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => line.startsWith("specs/"))
    .sort();

  return { currentBranch, commitsAhead, stagedSpecPaths };
}

// ---------------------------------------------------------------------------
// The closing summary — /spec-write's OWN, never another skill's report.
// ---------------------------------------------------------------------------

/**
 * Signals that identify /spec-write's own closing summary. EVERY entry is a
 * literal substring of the shipped § 7 reference-shape fence, so the module and
 * the skill cannot drift: change the fence and this list has to follow.
 */
export const SPEC_WRITE_SUMMARY_SIGNALS: readonly string[] = [
  "## /spec-write summary",
  // The two table header rows. AC-478.2 names the FR table and the spec-file
  // table as constituents of the summary, so a block that carries the heading
  // and the open-questions line but drops BOTH tables must not classify as
  // spec-write's own. Both are literal substrings of the § 7 reference fence.
  "| FR id      | FR file path                | Milestone |",
  "| Spec file              | Change          |",
  "Open questions / risks / inconsistencies (if any):",
  "Next: Run `/dev-process-toolkit:implement",
];

/**
 * Closing-output signatures belonging to OTHER skills. `Gate Check Report` is
 * the one the measured jira capture actually carries.
 */
export const FOREIGN_CLOSING_REPORT_SIGNATURES: readonly string[] = [
  "Gate Check Report",
];

/** True only when every § 7 signal is present — a partial match is not the shape. */
export function closingSummaryIsSpecWriteOwn(assistantText: string): boolean {
  const text = typeof assistantText === "string" ? assistantText : "";
  return SPEC_WRITE_SUMMARY_SIGNALS.every((signal) => text.includes(signal));
}

// ---------------------------------------------------------------------------
// Classification.
// ---------------------------------------------------------------------------

export interface TrunkRunObservation {
  markerPresent: boolean;
  isTty: boolean;
  declinedAtCommitGate?: boolean;
  startedOnTrunk: boolean;
  git: TrunkGitState;
  /**
   * The ASSISTANT-TEXT projection of the run, never the raw NDJSON — both
   * tokens appear in the injected SKILL.md body of every /spec-write capture,
   * so a raw-log grep scores a silent run as a pass (STE-421's lesson).
   */
  assistantText: string;
  /**
   * Tracker facts of the run. OPTIONAL — an observation that carries none is
   * the same fact as one carrying an empty list: nothing was created, nothing
   * is owed. Under `mode: "none"` there is no tracker to create anything in, so
   * `createdIds` are ignored entirely — the mode decides, not the payload.
   */
  tracker?: {
    mode: "linear" | "jira" | "none";
    createdIds: string[];
  };
}

export interface TrunkRunVerdict {
  ok: boolean;
  terminalState: TrunkTerminalStateId | typeof UNSANCTIONED_STAGED_UNCOMMITTED;
  violations: string[];
  missingTokens: string[];
  closingSummaryIsOwn: boolean;
  /**
   * Which created tracker items the closing output failed to name. ALWAYS an
   * array — `[]` when nothing is owed — so the failure names what an operator
   * would otherwise have to hunt down by hand.
   */
  undisclosedTrackerIds: string[];
}

/** A token counts as emitted only in its BACKTICKED literal form. */
function tokenEmitted(assistantText: string, token: string): boolean {
  return assistantText.includes("`" + token + "`");
}

export function classifyTrunkInvocationRun(
  o: TrunkRunObservation,
): TrunkRunVerdict {
  const assistantText = typeof o.assistantText === "string" ? o.assistantText : "";
  const staged = o.git.stagedSpecPaths.length > 0;
  const committed = !staged && o.git.commitsAhead >= 1;

  const violations: string[] = [];

  let terminalState: TrunkRunVerdict["terminalState"];
  if (committed) {
    terminalState = "committed";
  } else if (staged && !o.markerPresent && !o.isTty) {
    // Sanctioned: the marker-absent non-tty refusal exits with work preserved.
    terminalState = "staged_marker_absent_non_tty_refusal";
  } else if (staged && o.isTty && o.declinedAtCommitGate === true) {
    // Sanctioned: the operator declined `Apply commit?` on the line.
    terminalState = "staged_interactive_decline";
  } else {
    // Everything else — including the measured defect (marker present, non-tty,
    // staged, zero commits ahead) — is the unsanctioned shape.
    terminalState = UNSANCTIONED_STAGED_UNCOMMITTED;
    if (staged) violations.push(TRUNK_VIOLATIONS.unsanctionedStaged);
    violations.push(TRUNK_VIOLATIONS.commitSkipped);
  }

  // Staged-but-uncommitted — ANY of the three staged shapes, the two sanctioned
  // exits included — owes the operator the names of what it created. A run that
  // committed does not: the commit it just landed is the record. Under
  // `mode: "none"` there is no tracker to have created anything in, so the
  // payload is ignored; `undisclosedTrackerIds` normalizes the list itself.
  const createdIds =
    o.tracker && o.tracker.mode !== "none" ? o.tracker.createdIds : [];
  const undisclosed = disclosureRequiredFor(terminalState, staged)
    ? undisclosedTrackerIds(assistantText, createdIds)
    : [];
  if (undisclosed.length > 0) {
    violations.push(TRUNK_VIOLATIONS.undisclosedTrackerState);
  }

  const closingSummaryIsOwn = closingSummaryIsSpecWriteOwn(assistantText);
  if (!closingSummaryIsOwn) violations.push(TRUNK_VIOLATIONS.foreignClosingSummary);

  const missingTokens = requiredTokensInOrder().filter(
    (token) => !tokenEmitted(assistantText, token),
  );
  if (missingTokens.length > 0) {
    violations.push(TRUNK_VIOLATIONS.missingCapabilityTokens);
  }

  return {
    ok: violations.length === 0,
    terminalState,
    violations,
    missingTokens,
    closingSummaryIsOwn,
    undisclosedTrackerIds: undisclosed,
  };
}

// ---------------------------------------------------------------------------
// The shipped prose this module is quoted by.
// ---------------------------------------------------------------------------

/**
 * The § 7a clause stating the ordering. Byte-identical to the sentence in
 * `skills/spec-write/SKILL.md` — the pin that keeps producer and consumer
 * from drifting.
 */
export const TRUNK_PRELUDE_CLAUSE =
  "**Branch creation is a PRELUDE to this commit, never a substitute for it** — the branch gate's `created` / `edited` / `default_applied` outcomes hand control straight back to this commit gate, and a run that creates the branch and then stops with spec files staged has NOT completed the trunk-invocation path; before Step 7 emits, call `classifyTrunkInvocationRun({...})` from `adapters/_shared/src/spec_write_trunk_invocation_path.ts` over `observeTrunkGitState(repoRoot, trunk)` and treat any `terminalState` other than `committed` or one of the two sanctioned staged-but-uncommitted terminals as a hard stop.";

/**
 * The § 7a clause stating the tracker-disclosure obligation. Byte-identical to
 * the sentence in `skills/spec-write/SKILL.md`, and it CARRIES
 * `TRACKER_DISCLOSURE_SIGNAL` as a literal substring — the pin that keeps the
 * shape the classifier greps for and the shape the skill promises identical.
 */
export const TRACKER_DISCLOSURE_CLAUSE =
  "**Neither staged exit may leave tracker state unsaid** — tracker items are created back in Steps 2–3, so both staged-but-uncommitted terminals can exit with live Epic / Task / issue ids that no commit records; such a run MUST close with the literal line `Tracker state created but not committed: <comma-separated ids>`, which is exactly what `trackerStateDisclosed(assistantText, createdIds)` from the same module scores — mid-run narration naming the ids does NOT count, only the closing line does, and a run that committed owes nothing extra because its commit is the record.";

/**
 * The § 7 clause stating who owns the closing output. Byte-identical to the
 * sentence in `skills/spec-write/SKILL.md`.
 */
export const CLOSING_SUMMARY_OWNERSHIP_CLAUSE =
  "**The closing output of a `/spec-write` run is `/spec-write`'s OWN summary block, never another skill's report** — a run that ends with a gate-check report, a review report, or any other skill's closing block has not emitted this summary, however complete that other block looks.";
