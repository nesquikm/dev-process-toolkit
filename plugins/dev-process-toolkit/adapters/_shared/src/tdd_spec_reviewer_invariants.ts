// tdd_spec_reviewer_subagent_invariants (STE-296 AC.8) — /gate-check probe.
// Severity: error.
//
// Asserts byte-checkable invariants on the spec-reviewer (AUDIT) stage files
// introduced by STE-296, mirroring the STE-225 AC.7 tdd_orchestrator_integrity
// probe shape for the other three TDD subagents/skills:
//   (a) agents/tdd-spec-reviewer.md exists with frontmatter
//         tools: Read, Grep, Glob   (no Write/Edit/Bash/Agent)
//         maxTurns: 8
//         model: sonnet
//   (b) skills/tdd-spec-review/SKILL.md exists with frontmatter
//         context: fork
//         agent: tdd-spec-reviewer
//         user-invocable: false
//         allowed-tools (if present) excludes Agent
//
// The probe does NOT enforce prompt phrasing or non-load-bearing fields;
// content drift is verified by the FR's smoke AC, not the probe.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  lineNumberOfKey,
  parseFrontmatterFields,
  pushViolation as pushViolationShared,
  splitToolsList,
  type IntegrityReport,
  type IntegrityViolation,
  type Severity,
} from "./tdd_probe_helpers";

export type { IntegrityReport, IntegrityViolation, Severity };

const AGENT_FILE = "tdd-spec-reviewer.md";
const SKILL_DIR = "tdd-spec-review";
const EXPECTED_AGENT = "tdd-spec-reviewer";

const REQUIRED_TOOLS: ReadonlyArray<string> = ["Read", "Grep", "Glob"];
const FORBIDDEN_TOOLS: ReadonlyArray<string> = ["Write", "Edit", "Bash", "Agent"];

function buildMessage(noteBody: string, file: string): string {
  return [
    `tdd_spec_reviewer_subagent_invariants: ${noteBody}`,
    "Remedy: restore the load-bearing invariant. The TDD spec-reviewer " +
      "(AUDIT) stage depends on (a) agents/tdd-spec-reviewer.md carrying " +
      "`tools: Read, Grep, Glob` (no Write/Edit/Bash/Agent), `maxTurns: 8`, " +
      "and `model: sonnet`, and (b) skills/tdd-spec-review/SKILL.md carrying " +
      "`context: fork`, `agent: tdd-spec-reviewer`, `user-invocable: false`, " +
      "and (if present) an `allowed-tools` that excludes `Agent`. Re-add " +
      "the missing shape per skills/tdd-spec-review/SKILL.md and " +
      "agents/tdd-spec-reviewer.md.",
    `Context: file=${file}, probe=tdd_spec_reviewer_subagent_invariants, severity=error`,
  ].join("\n");
}

function pushViolation(
  out: IntegrityViolation[],
  projectRoot: string,
  absFile: string,
  line: number,
  reason: string,
): void {
  pushViolationShared(out, projectRoot, absFile, line, reason, buildMessage);
}

export async function runTddSpecReviewerInvariantsProbe(
  projectRoot: string,
): Promise<IntegrityReport> {
  const skillsBase = join(projectRoot, "plugins", "dev-process-toolkit", "skills");
  const agentsBase = join(projectRoot, "plugins", "dev-process-toolkit", "agents");
  if (!existsSync(skillsBase) && !existsSync(agentsBase)) {
    return { violations: [], vacuous: true };
  }

  const violations: IntegrityViolation[] = [];

  // (a) Subagent file invariants.
  const agentPath = join(agentsBase, AGENT_FILE);
  if (!existsSync(agentPath)) {
    pushViolation(
      violations,
      projectRoot,
      agentPath,
      1,
      `missing subagent file at agents/${AGENT_FILE}`,
    );
  } else {
    let body: string;
    try {
      body = readFileSync(agentPath, "utf-8");
    } catch (err) {
      pushViolation(
        violations,
        projectRoot,
        agentPath,
        1,
        `subagent file is not readable: ${(err as Error).message}`,
      );
      body = "";
    }
    if (body.length > 0) {
      const fm = parseFrontmatterFields(body);

      // tools: must contain Read, Grep, Glob; must not contain Write, Edit, Bash, Agent.
      const toolsRaw = fm.tools ?? "";
      const tools = splitToolsList(toolsRaw);
      const missingRequired = REQUIRED_TOOLS.filter((t) => !tools.includes(t));
      if (missingRequired.length > 0) {
        pushViolation(
          violations,
          projectRoot,
          agentPath,
          lineNumberOfKey(body, "tools"),
          `subagent \`tools\` is missing required read-only tools ` +
            `${missingRequired.join(", ")} (need Read, Grep, Glob; got ` +
            `\`${toolsRaw}\`)`,
        );
      }
      const includesForbidden = FORBIDDEN_TOOLS.filter((t) => tools.includes(t));
      if (includesForbidden.length > 0) {
        pushViolation(
          violations,
          projectRoot,
          agentPath,
          lineNumberOfKey(body, "tools"),
          `subagent \`tools\` includes forbidden ` +
            `${includesForbidden.join(", ")} — AUDIT stage is read-only ` +
            `(Write, Edit, Bash, Agent must be excluded)`,
        );
      }

      // maxTurns: 8 exact.
      if (fm.maxTurns !== "8") {
        pushViolation(
          violations,
          projectRoot,
          agentPath,
          lineNumberOfKey(body, "maxTurns"),
          `subagent is missing \`maxTurns: 8\` ` +
            `(got \`${fm.maxTurns ?? "<absent>"}\`)`,
        );
      }

      // model: sonnet exact.
      if (fm.model !== "sonnet") {
        pushViolation(
          violations,
          projectRoot,
          agentPath,
          lineNumberOfKey(body, "model"),
          `subagent is missing \`model: sonnet\` ` +
            `(got \`${fm.model ?? "<absent>"}\`)`,
        );
      }
    }
  }

  // (b) Child skill file invariants.
  const skillPath = join(skillsBase, SKILL_DIR, "SKILL.md");
  if (!existsSync(skillPath)) {
    pushViolation(
      violations,
      projectRoot,
      skillPath,
      1,
      `missing child skill at skills/${SKILL_DIR}/SKILL.md`,
    );
  } else {
    let body: string;
    try {
      body = readFileSync(skillPath, "utf-8");
    } catch (err) {
      pushViolation(
        violations,
        projectRoot,
        skillPath,
        1,
        `child skill SKILL.md is not readable: ${(err as Error).message}`,
      );
      body = "";
    }
    if (body.length > 0) {
      const fm = parseFrontmatterFields(body);

      // context: fork exact.
      if (fm.context !== "fork") {
        pushViolation(
          violations,
          projectRoot,
          skillPath,
          lineNumberOfKey(body, "context"),
          `child skill is missing \`context: fork\` ` +
            `(got \`${fm.context ?? "<absent>"}\`)`,
        );
      }

      // agent: tdd-spec-reviewer exact.
      const agentName = fm.agent ?? "";
      if (agentName !== EXPECTED_AGENT) {
        pushViolation(
          violations,
          projectRoot,
          skillPath,
          lineNumberOfKey(body, "agent"),
          `child skill \`agent:\` must be \`${EXPECTED_AGENT}\` ` +
            `(got \`${agentName.length > 0 ? agentName : "<absent>"}\`)`,
        );
      }

      // user-invocable: false exact.
      if (fm["user-invocable"] !== "false") {
        pushViolation(
          violations,
          projectRoot,
          skillPath,
          lineNumberOfKey(body, "user-invocable"),
          `child skill is missing \`user-invocable: false\` ` +
            `(got \`${fm["user-invocable"] ?? "<absent>"}\`)`,
        );
      }

      // allowed-tools (if present) must not include Agent.
      if (fm["allowed-tools"] !== undefined) {
        const allowed = splitToolsList(fm["allowed-tools"]);
        if (allowed.includes("Agent")) {
          pushViolation(
            violations,
            projectRoot,
            skillPath,
            lineNumberOfKey(body, "allowed-tools"),
            `child skill \`allowed-tools\` includes \`Agent\` — the ` +
              `AUDIT fork must not nest-spawn (Agent must be excluded)`,
          );
        }
      }
    }
  }

  return { violations, vacuous: false };
}
