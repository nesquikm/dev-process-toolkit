/**
 * The ONE place the `/implement` § 4b′ cross-cutting-spec propagation commit
 * message is rendered, and the one place its subject is measured (STE-477).
 *
 * WHY A MODULE RATHER THAN PROSE. § 4b′ used to prescribe a subject with the
 * removed path interpolated into it, between the `chore(specs): propagate`
 * prefix and a `removal to cross-cutting specs` tail. That fixed wording alone
 * costs 55 characters, so the removed path could be at most
 * seventeen — `src/.placeholder.test.ts` renders 79 and
 * `plugins/dev-process-toolkit/adapters/_shared/src/foo.ts` renders 110, both
 * past the 72-character cap the shipped `commit-msg` hook enforces. A subject
 * that scales with a variable part is not an edge case; it is a template that
 * is unsatisfiable for nearly every realistic input, and the reason it survived
 * is that "the prescribed subject fits" was a claim only a human could check.
 *
 * This is STE-461's resolution shape reapplied to a second site: the subject
 * stops scaling, the variable part moves to the body, and the residual bound is
 * asserted before anything is written rather than inherited from the hook.
 */

/**
 * The commit-subject cap this module measures against — ONE definition.
 *
 * Not this module's invention: it is the cap the shipped `commit-msg` hook
 * enforces (`templates/git-hooks/commit-msg.sh`, `-gt 72`) and that the shipped
 * `commitlint.config.js` restates as `header-max-length`. `/setup` installs that
 * hook into every project it bootstraps, so this is the gate the propagation
 * commit is actually judged by.
 */
export const PROPAGATION_SUBJECT_CAP = 72;

/**
 * The propagation commit subject — a FIXED literal, byte-identical for every
 * removed path.
 *
 * It carries no placeholder, no interpolation and no path separator by design:
 * those are exactly the constructs through which a caller's input reaches the
 * subject, and a subject no input can reach is a subject whose length no input
 * can change. Which propagation this commit was is not lost — it is recorded in
 * the body, which the hook does not read.
 */
export const PROPAGATION_COMMIT_SUBJECT =
  "chore(specs): propagate file removal to cross-cutting specs";

/** A prose-mention hit § 4b′ leaves untouched and records for a follow-up amend. */
export interface ProseMention {
  /** Spec file the hit is in, repo-root-relative. */
  file: string;
  /** 1-based line number within that file. */
  line: number;
  /** The line's text, carried verbatim so the operator can recognise it. */
  snippet: string;
}

/** A rendered propagation commit message, split into the parts the hook judges separately. */
export interface PropagationCommitMessage {
  /** The fixed subject — what `commit-msg` measures. */
  subject: string;
  /** Everything the hook does not read: the removed paths and the prose hits. */
  body: string;
  /** `subject`, a blank line, then `body` — what `git commit -m` receives. */
  message: string;
}

/**
 * The three facts a subject diagnostic must state: the subject VERBATIM, its
 * length, and the cap.
 *
 * The wording is neutral — it measures, it does not judge — for the same reason
 * `local_provider.ts`'s `describeLockSubject` is: a formatter that asserted
 * "over the cap" would be reused into a falsehood the first time a caller
 * reached it from the other verdict.
 */
function describePropagationSubject(subject: string): string {
  return `subject "${subject}" (${subject.length} characters; the commit-msg subject cap is ${PROPAGATION_SUBJECT_CAP})`;
}

/** Where a refusal fired, for the `Context:` line. Both parts default rather than throw. */
export interface PropagationSubjectContext {
  /** Tracker mode in force (`linear` / `jira` / `none`). */
  mode?: string;
  /** The ticket the propagation belongs to. */
  ticket?: string;
}

/**
 * Refuse an over-long propagation subject BEFORE the message is handed back.
 *
 * Ordering is the whole content of this guard. A caller that received the
 * message and only then discovered the length would meet the cap for the first
 * time at the hook — which is precisely the failure mode this FR removes — so
 * the refusal happens here, with nothing written, staged or committed.
 *
 * The shape is NFR-10's canonical one: verdict, `Remedy:`, `Context:`.
 */
export function assertPropagationSubjectWithinCap(
  subject: string,
  context: PropagationSubjectContext = {},
): void {
  if (subject.length <= PROPAGATION_SUBJECT_CAP) return;
  const mode = context.mode ?? "unknown";
  const ticket = context.ticket ?? "unknown";
  throw new Error(
    `propagation_commit_message: refusing to commit — ${describePropagationSubject(subject)} exceeds it.\n` +
      `Remedy: keep the subject fixed (PROPAGATION_COMMIT_SUBJECT) and move every variable part — ` +
      `removed paths, prose-mention hits — into the commit body, which the hook does not read.\n` +
      `Context: mode=${mode}, ticket=${ticket}, skill=/implement`,
  );
}

/** One `- <path>` line per removed path, or an explicit marker when there are none. */
function renderRemovedPaths(removedPaths: readonly string[]): string[] {
  if (removedPaths.length === 0) return ["Removed paths: (none recorded)"];
  return ["Removed paths:", ...removedPaths.map((p) => `- ${p}`)];
}

/**
 * Prose-mention hits as `file:line` + snippet.
 *
 * § 4b′ promises these are RECORDED rather than edited, so the operator can
 * amend the surrounding sentence in a follow-up. `file:line` is the addressable
 * half and the snippet is the recognisable one; neither alone is enough to find
 * the sentence again after the tree has moved on.
 */
function renderProseMentions(proseMentions: readonly ProseMention[]): string[] {
  if (proseMentions.length === 0) return [];
  return [
    "",
    "Prose mentions left untouched (amend in a follow-up if the sentence needs restructuring):",
    ...proseMentions.map((m) => `- ${m.file}:${m.line} — ${m.snippet}`),
  ];
}

/**
 * Render the propagation commit message for one or more removed paths.
 *
 * The subject is the fixed literal; the paths and prose hits go to the body.
 * The cap assertion runs BEFORE the return, so an over-long subject can never
 * leave this function — see `assertPropagationSubjectWithinCap`.
 *
 * `context` is forwarded to that assertion so a refusal names the run it fired
 * in. Omitting it is allowed and renders `mode=unknown, ticket=unknown` — a
 * diagnostic that is vaguer, never one that is wrong.
 */
export function buildPropagationCommitMessage(
  removedPaths: readonly string[],
  proseMentions: readonly ProseMention[] = [],
  context: PropagationSubjectContext = {},
): PropagationCommitMessage {
  const subject = PROPAGATION_COMMIT_SUBJECT;
  assertPropagationSubjectWithinCap(subject, context);
  const body = [...renderRemovedPaths(removedPaths), ...renderProseMentions(proseMentions)].join(
    "\n",
  );
  return { subject, body, message: `${subject}\n\n${body}\n` };
}
