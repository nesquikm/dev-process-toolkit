// evidence_required_sections — WHICH evidence sections a project owes,
// DERIVED from what that project declared about itself.
//
// THE DEFECT. `renderStageEvidence` defaults `required` to all three sections,
// and that default is right where it lives: `/deliver` grades a fence it did
// not author, so a stage that captured nothing must refuse rather than report a
// confident nothing. But `/implement`'s step-14 block runs INSIDE the project,
// and there vacuity is DECLARATION-based. A project whose `## Verification`
// section says `run_cmd: none` and names no `e2e_cmd` has legitimately stated
// that those commands do not exist. Demanding captures of them rendered
// `ok: false` with drive and e2e refusals for commands the project told us it
// does not have — a guard false-REDding a healthy run, on THIS repo, which
// declares exactly that.
//
// THE RULE.
//   - `gate` is UNCONDITIONAL. No declaration narrows it away: every project
//     has a gate, and a required set a project could shrink to nothing is not a
//     guard.
//   - `drive` iff `run_cmd` is ANSWERED and is not the `none` sentinel.
//   - `e2e` iff `e2e_cmd` is ANSWERED and is not the `none` sentinel.
//
// WHY IT ASKS RATHER THAN COMPARES. The two questions above already have one
// home apiece in `verification_config`: `isRunCmdAnswered` separates a real
// declaration from a bare `run_cmd:` (an omission wearing an answer's hat), and
// `isRunCmdNone` recognises the sentinel case-insensitively. A third reader
// that hand-inlined an equality against the sentinel literal would agree with
// them right up until the sentinel's rules moved — which is precisely the drift
// `isRunCmdNone`'s own docstring says it exists to make impossible. So this
// module compares nothing; it asks.
//
// SCOPE, deliberately narrow. Only the declaration-reading caller narrows.
// `renderStageEvidence`'s own all-three default is UNCHANGED, so /deliver stays
// fail-closed: leaking this narrowing into the fence renderer would silently
// un-arm every reduced chain the orchestrator grades.

import { join } from "node:path";

import {
  isRunCmdAnswered,
  isRunCmdNone,
  readVerificationConfig,
} from "./verification_config";

import type { EvidenceSection } from "./deliver_stage_evidence";

/**
 * Does this declared value name a command that EXISTS?
 *
 * Answered-and-not-the-sentinel, both halves asked through the shipped
 * predicates. An absent key, a bare key and the `none` answer all land on
 * `false` — they differ in what they say about the AUTHOR, not about whether
 * there is a command to capture output from.
 */
function declaresCommand(value: string | null | undefined): boolean {
  return isRunCmdAnswered(value) && !isRunCmdNone(value);
}

/**
 * The evidence sections the project at `claudeMdPath` must evidence, in the
 * fixed render order.
 *
 * Never throws: an absent, unreadable or malformed CLAUDE.md declares nothing,
 * and nothing declared means the unconditional `gate` alone. A refusal to read
 * the declaration must not become a refusal to certify the run — that would
 * trade the false red this function closes for a differently-caused one.
 */
export function requiredEvidenceSections(
  claudeMdPath: string,
): readonly EvidenceSection[] {
  const sections: EvidenceSection[] = ["gate"];
  let runCmd: string | null = null;
  let e2eCmd: string | null = null;
  try {
    ({ runCmd, e2eCmd } = readVerificationConfig(claudeMdPath));
  } catch {
    return sections;
  }
  if (declaresCommand(runCmd)) sections.push("drive");
  if (declaresCommand(e2eCmd)) sections.push("e2e");
  return sections;
}

/**
 * The same answer, addressed by PROJECT ROOT.
 *
 * The declaration lives at `<projectRoot>/CLAUDE.md`, and composing that path
 * belongs HERE, beside the reader, rather than in every caller that holds a
 * root: a second module joining the filename is a second place the layout is
 * known. Callers that already hold the document's path use the function above.
 */
export function requiredEvidenceSectionsForProject(
  projectRoot: string,
): readonly EvidenceSection[] {
  return requiredEvidenceSections(join(projectRoot, "CLAUDE.md"));
}
