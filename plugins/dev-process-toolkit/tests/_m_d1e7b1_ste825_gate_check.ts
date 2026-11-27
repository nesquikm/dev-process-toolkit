/**
 * STE-825 (M_d1e7b1) — the one probe #14 edit to skills/gate-check/SKILL.md, as exact bytes.
 *
 * AC-STE-825.3 adds the not-started row to probe #14's truth table (one new line, so every line
 * from old line 62 on moves down by one) and rewrites three of the probe's own lines in place.
 * Freeze and byte-identity guards over this file admit exactly this edit through undoSte825():
 * it reverts the three lines and drops the row only where each sits byte-for-byte, so any other
 * change to the file, or this edit drifting, still fails the guard that applies it.
 *
 * Amended by AC-STE-825.3 (M_d1e7b1)
 */

/** 1-based line of the inserted truth-table row in the current file. */
export const STE_825_ROW_LINE = 62;
export const STE_825_ROW = "    | active    | initial       | any          | no checked task names the FR; no lock; no started evidence | any | **pass** (not started carve-out) |";

/** The in-place rewrites: current 1-based line, bytes before, bytes after. */
export const STE_825_EDITS: ReadonlyArray<{ line: number; before: string; after: string }> = [
  { line: 52, before: "14. **Ticket-state drift — active side** — mirrors probe #8 symmetrically with two carve-outs. For every FR file under `specs/frs/*.md` (excluding `archive/**`) whose frontmatter has `status: active` AND a non-null `tracker.<key>` binding, resolve `Provider` once (same rule as `/implement` / probe #8) and call `Provider.getTicketStatus(<tracker-ref>)`. Then read the FR's milestone plan state via `readPlanTaskState(specsDir, milestone)` from `adapters/_shared/src/plan_task_state.ts` and decide via `activeTicketDriftPasses(summary, planTaskState, statusMapping, currentUser)` from `adapters/_shared/src/active_ticket_drift_predicate.ts`. The composed predicate passes if (a) the ticket is in the `status_mapping.in_progress` lane AND `assignee == currentUser`, OR (b) the **single-FR-clean (STE-151)** exemption applies — ticket=done, plan=active, plan has at least one `[ ]` task remaining, OR (c) the **fully-checked-single-FR (STE-180)** exemption applies — ticket=done, plan=active, plan has zero `[ ]` tasks AND at least one task total. Both exemptions recognise the canonical mid-canonical-chain state where `/implement <FR-id>` Phase 4 Close transitioned the ticket to **Done** but the FR file intentionally stays `status: active` per the milestone-bulk-archive design (`skills/implement/SKILL.md` § Invocation forms). Truth table:", after: "14. **Ticket-state drift — active side** — mirrors probe #8 symmetrically with three carve-outs. For every FR file under `specs/frs/*.md` (excluding `archive/**`) whose frontmatter has `status: active` AND a non-null `tracker.<key>` binding, resolve `Provider` once (same rule as `/implement` / probe #8) and call `Provider.getTicketStatus(<tracker-ref>)`. Then read the FR's milestone plan state via `readPlanTaskState(specsDir, milestone)` from `adapters/_shared/src/plan_task_state.ts` and decide via `activeTicketDriftPasses(summary, planTaskState, statusMapping, currentUser, frRef?)` from `adapters/_shared/src/active_ticket_drift_predicate.ts`. The composed predicate passes if (a) the ticket is in the `status_mapping.in_progress` lane AND `assignee == currentUser`, OR (b) the **single-FR-clean (STE-151)** exemption applies — ticket=done, plan=active, plan has at least one `[ ]` task remaining, OR (c) the **fully-checked-single-FR (STE-180)** exemption applies — ticket=done, plan=active, plan has zero `[ ]` tasks AND at least one task total, OR (d) the **not-started** exemption applies — ticket in the `status_mapping.initial` lane, no checked plan task (`[x]` or `[X]`) names the FR's tracker id, no `.dpt/locks/` entry names it, and nothing shows the work began (`frRef` carries that id, the FR's own `id:` when it has one, `readLockIds(projectRoot)` from `lock.ts`, and `startedBy` from `workStartedEvidence(projectRoot, trackerId, frId)` in `fr_work_started.ts`: a run-start ledger row of `/implement` or `/tdd` naming the FR, or a commit on HEAD or a local branch naming the tracker id, in any letter case, that touches a path outside `specs/`, and a history git cannot read, or a directory git does not know, counts as begun; a lock filed under either id names the FR; without `frRef` or its `startedBy` list (d) never fires). Exemptions (b) and (c) recognise the canonical mid-canonical-chain state where `/implement <FR-id>` Phase 4 Close transitioned the ticket to **Done** but the FR file intentionally stays `status: active` per the milestone-bulk-archive design (`skills/implement/SKILL.md` § Invocation forms). Truth table:" },
  { line: 66, before: "    **Advisory (STE-180 carve-out only).** When the fully-checked branch fires, render exactly this advisory line in the gate-check report (severity = note, NOT GATE FAILED): `M<N> plan fully checked but not archived — run /spec-archive M<N> or /implement M<N> to close`. The probe returns `{ ok: true, advisory: { kind: \"milestone_ready_to_close\", milestone: \"M<N>\" } }` and the renderer formats it; carve-out provenance is logged via `carve_out: fully_checked_milestone` (vs. STE-151's `carve_out: partial_milestone`). One advisory per affected milestone, deduplicated — if FRs A and B both target M5 and both fire the carve-out, render once mentioning M5.", after: "    **Advisory (STE-180 carve-out only).** When the fully-checked branch fires, render exactly this advisory line in the gate-check report (severity = note, NOT GATE FAILED): `M<N> plan fully checked but not archived — run /spec-archive M<N> or /implement M<N> to close`. The probe returns `{ ok: true, advisory: { kind: \"milestone_ready_to_close\", milestone: \"M<N>\" } }` and the renderer formats it; carve-out provenance is logged via `carve_out: fully_checked_milestone` (vs. STE-151's `carve_out: partial_milestone`; a pass through the not-started row is logged as `carve_out: not_started`). One advisory per affected milestone, deduplicated — if FRs A and B both target M5 and both fire the carve-out, render once mentioning M5." },
  { line: 68, before: "    Every drifted ticket → **GATE FAILED** reporting a row with the FR's **ULID** + **tracker ID** + **observed** status vs. **expected** `in_progress` + **observed** assignee vs. **expected** `currentUser` so the operator can manually transition, reassign, or rerun `/implement` Phase 1 step 0.c. The failure-row shape is unchanged across the strict and relaxed branches — callers see the same row format. **Skipped for `mode: none`** — `LocalProvider.getTicketStatus` returns the `local-no-tracker` sentinel and there's nothing to compare. The probe is over observed tracker state, not over call-history: the `already-ours` claim shape (`in_progress` + `currentUser`) passes regardless of whether this session or a prior one called `claimLock`. Catches the regression where `/implement` Phase 1 step 0.c is skipped entirely (an early dogfood case had a ticket sitting at Backlog while implementation proceeded) and symmetrically completes the archive-side ticket-state probe. Both carve-outs strictly weaken the predicate — every prior failing case where the drift was real still fails (Phase 1 step 0.c skipped, wrong assignee, missing plan, archived plan vacuous to probe #27).", after: "    Every drifted ticket → **GATE FAILED** reporting a row with the FR's **ULID** + **tracker ID** + **observed** status vs. **expected** `in_progress` + **observed** assignee vs. **expected** `currentUser` so the operator can manually transition, reassign, or rerun `/implement` Phase 1 step 0.c. The failure-row shape is unchanged across the strict and relaxed branches — callers see the same row format. **Skipped for `mode: none`** — `LocalProvider.getTicketStatus` returns the `local-no-tracker` sentinel and there's nothing to compare. The probe is over observed tracker state, not over call-history: the `already-ours` claim shape (`in_progress` + `currentUser`) passes regardless of whether this session or a prior one called `claimLock`. Catches the regression where `/implement` Phase 1 step 0.c is skipped entirely (an early dogfood case had a ticket sitting at Backlog while implementation proceeded) and symmetrically completes the archive-side ticket-state probe. Carve-outs (b) and (c) strictly weaken the predicate — every prior failing case where the drift was real still fails (Phase 1 step 0.c skipped, wrong assignee, missing plan, archived plan vacuous to probe #27). Carve-out (d) admits an unclaimed ticket only while nothing shows its work began, so a skipped 0.c fails once a run-start row or a commit names the FR. Residual: the run-start ledger is opt-in, so with tracking off a skipped 0.c still passes (d) until the FR's first commit." }
];

/** The file with the STE-825 edit taken out, or the input unchanged if any part is not at its place. */
export function undoSte825(text: string): string {
  const lines = text.split("\n");
  if (lines[STE_825_ROW_LINE - 1] !== STE_825_ROW) return text;
  for (const e of STE_825_EDITS) if (lines[e.line - 1] !== e.after) return text;
  for (const e of STE_825_EDITS) lines[e.line - 1] = e.before;
  lines.splice(STE_825_ROW_LINE - 1, 1);
  return lines.join("\n");
}

/** Where a pre-STE-825 1-based line of gate-check/SKILL.md sits now. */
export function currentGateCheckLine(oldLine: number): number {
  return oldLine >= STE_825_ROW_LINE ? oldLine + 1 : oldLine;
}

/**
 * STE-756 (M_d1e7b1) — the probe-runner paragraphs AC-STE-756.6 inserts after the
 * "Full details" line: four lines (two paragraphs, each followed by a blank line).
 * Amended by AC-STE-756.6 (M_d1e7b1)
 */
export const STE_756_BLOCK_LINE = 182;
export const STE_756_BLOCK: readonly string[] = ["Run `bun \"${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/gate_probe_runner.ts\" \"<projectRoot>\"` as its own Bash call, with nothing before or after it, and quote its rows verbatim. Never retype or reword a row. Each row has one shape: `probe #<N> <probe-id>: <verdict> (<count>)`. The verdict is one of `pass`, `notes`, `fail` or `vacuous`.", "", "The runner does not call every probe. The tracker and MCP probes, such as #8, #14 and #26, and the prose-defined probes are run by the model. The model renders each of their rows in the same grammar.", ""];

/** The file with the STE-756 block taken out, or the input unchanged if it is not byte-for-byte in place. */
export function undoSte756(text: string): string {
  const lines = text.split("\n");
  const at = STE_756_BLOCK_LINE - 1;
  if (STE_756_BLOCK.some((l, i) => lines[at + i] !== l)) return text;
  lines.splice(at, STE_756_BLOCK.length);
  return lines.join("\n");
}

/**
 * STE-869 (M_b054b1) — probe #26's one in-place insertion: the v2 name of the
 * parent write, on the probe's own line. Amended by AC-STE-869.3 (M_b054b1)
 */
export const STE_869_LINE = 82;
export const STE_869_BEFORE = "`mcp__atlassian__editJiraIssue additional_fields.parent` write that binds it";
export const STE_869_AFTER = "`mcp__atlassian__editJiraIssue additional_fields.parent` (v2: `fields.parent`) write that binds it";

/** The file with the STE-869 insertion taken out, or the input unchanged if it is not byte-for-byte in place. */
export function undoSte869(text: string): string {
  const lines = text.split("\n");
  const line = lines[STE_869_LINE - 1];
  if (line === undefined || !line.startsWith("26. ") || line.split(STE_869_AFTER).length !== 2) return text;
  lines[STE_869_LINE - 1] = line.replace(STE_869_AFTER, STE_869_BEFORE);
  return lines.join("\n");
}

/**
 * STE-879 (M_43bc84) — probe #91's registration, net zero: row 91 directly after row 90, paid for
 * by joining the two probe-authoring-contract lines that open "Every new `/gate-check` probe ships
 * with a corresponding", and the next-probe sentence moved #91 -> #92. All three as exact bytes, at
 * their place in the shipped file. Amended by AC-STE-879.4 (M_43bc84)
 */
export const STE_879_ROW_LINE = 179;
export const STE_879_ROW = "91. **`best_practices_digest_match`** — call `runBestPracticesDigestMatchProbe(projectRoot)` from `adapters/_shared/src/best_practices_digest_match.ts`. **Severity: error.** Every `specs/best-practices.yaml` entry that declares `sha256` must match the digest of its document's bytes, computed by the same `documentSha256` helper the manifest's `select` leg uses; each mismatch is one **GATE FAILED** violation naming the entry, the path, the declared and the actual digest. Violation shape follows probe #16/#63: `note` is `<repo-relative-file>:<line> — <reason>`, `message` is the NFR-10 canonical shape with `Remedy:` and `Context:` sub-lines. Vacuous when the manifest is absent or empty, and for every entry without the key; a malformed manifest or a dangling `path` is probe #76's to report. The module carries the `if (import.meta.main)` front door probe #81 requires, so this registration is ordered AND reachable. Test coverage: `tests/m_43bc84-ste-879-cli-sha256-probe.test.ts`. (M_43bc84)";
/** The joined line in the shipped file, and the two lines it was. */
export const STE_879_JOIN_LINE = 207;
export const STE_879_JOIN_BEFORE: readonly [string, string] = ["Every new `/gate-check` probe ships with a corresponding", "`tests/gate-check-<slug>.test.ts` test file. Self-review refuses a probe"];
export const STE_879_NEXT_LINE = 253;
export const STE_879_NEXT_BEFORE = "registering probe #91 will turn probe #81 red";
export const STE_879_NEXT_AFTER = "registering probe #92 will turn probe #81 red";

/** The file with the STE-879 edit taken out, or the input unchanged if any part is not byte-for-byte in place. Amended by AC-STE-879.4 (M_43bc84) */
export function undoSte879(text: string): string {
  const lines = text.split("\n");
  if (lines[STE_879_ROW_LINE - 1] !== STE_879_ROW) return text;
  if (!lines[STE_879_ROW_LINE - 2]?.startsWith("90. ")) return text;
  if (lines[STE_879_JOIN_LINE - 1] !== STE_879_JOIN_BEFORE.join(" ")) return text;
  const next = lines[STE_879_NEXT_LINE - 1];
  if (next === undefined || !next.startsWith("**Registering a probe now costs one line probe #81 counts.**") || next.split(STE_879_NEXT_AFTER).length !== 2 || next.includes(STE_879_NEXT_BEFORE)) return text;
  lines[STE_879_NEXT_LINE - 1] = next.replace(STE_879_NEXT_AFTER, STE_879_NEXT_BEFORE);
  lines.splice(STE_879_JOIN_LINE - 1, 1, ...STE_879_JOIN_BEFORE);
  lines.splice(STE_879_ROW_LINE - 1, 1);
  return lines.join("\n");
}

/** Every admission to gate-check/SKILL.md undone, later edits first. Amended by AC-STE-756.6 (M_d1e7b1); Amended by AC-STE-869.3 (M_b054b1); Amended by AC-STE-879.4 (M_43bc84) */
export function undoGateCheckM_d1e7b1(text: string): string {
  return undoSte825(undoSte756(undoSte869(undoSte879(text))));
}

/** Where a pre-M_d1e7b1 1-based line of gate-check/SKILL.md sits now (both insertions). */
export function currentGateCheckLineM_d1e7b1(oldLine: number): number {
  const after825 = currentGateCheckLine(oldLine);
  return after825 >= STE_756_BLOCK_LINE ? after825 + STE_756_BLOCK.length : after825;
}
