// audit_fix_loop_pattern_invariants (STE-307) — /gate-check probe.
// Severity: error.
//
// Generalises probes #39 / #50 / #51 to a single allowlist-driven scan.
// Asserts byte-checkable invariants on every canonical audit-fix loop
// declared in `AUDIT_FIX_LOOP_CANONICAL_LOOPS`.
//
// For each allowlist entry, the probe asserts:
//   (a) paired child skill file exists at the declared path with
//       `context: fork`, `user-invocable: false`, and `agent:` that
//       resolves to an existing `plugins/dev-process-toolkit/agents/<name>.md`.
//   (b) the subagent declares `tools: Read, Grep, Glob` only
//       (Write/Edit/Bash/Agent excluded).
//   (c) the child's `allowed-tools:` (when present) excludes `Agent`.
//
// Vacuous on repos with neither
// `plugins/dev-process-toolkit/skills/` nor
// `plugins/dev-process-toolkit/agents/`.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  lineNumberOfKey,
  parseFrontmatterFields,
  pushViolation as pushViolationShared,
  splitToolsList,
  type IntegrityViolation,
  type Severity,
} from "./tdd_probe_helpers";

export type { Severity };

export interface AuditFixLoopEntry {
  orchestrator: string;
  child: string;
  subagent: string;
}

export interface AuditFixLoopViolation {
  file: string;
  line: number;
  severity: Severity;
  note: string;
  message: string;
}

export interface AuditFixLoopReport {
  violations: AuditFixLoopViolation[];
  vacuous: boolean;
}

// Canonical audit-fix loop allowlist. Ships with the /tdd audit-fork pair
// at FR ship; STE-308 appends the /spec-review audit-fork entry.
//
// Only audit-fork pairs (whose subagent is read-only) belong here — the
// /tdd RED/GREEN/REFACTOR forks are the action half of /tdd's loop and
// need Write/Edit/Bash; their orchestrator-level invariants are already
// enforced by probe #39 `tdd_orchestrator_integrity`.
export const AUDIT_FIX_LOOP_CANONICAL_LOOPS: ReadonlyArray<AuditFixLoopEntry> = [
  { orchestrator: "tdd", child: "tdd-spec-review", subagent: "tdd-spec-reviewer" },
  { orchestrator: "spec-review", child: "spec-review-audit", subagent: "spec-reviewer" },
];

const REQUIRED_TOOLS: ReadonlyArray<string> = ["Read", "Grep", "Glob"];
const FORBIDDEN_TOOLS: ReadonlyArray<string> = ["Write", "Edit", "Bash", "Agent"];

function buildMessage(noteBody: string, file: string): string {
  return [
    `audit_fix_loop_pattern_invariants: ${noteBody}`,
    "Remedy: restore the canonical audit-fix loop invariants. Each " +
      "allowlist entry must (a) have a child skill at " +
      "`skills/<child>/SKILL.md` with `context: fork`, `user-invocable: " +
      "false`, and an `agent:` that resolves to a real " +
      "`agents/<subagent>.md`; (b) the subagent must declare " +
      "`tools: Read, Grep, Glob` only (Write/Edit/Bash/Agent excluded); " +
      "(c) the child's `allowed-tools:` (when present) must exclude " +
      "`Agent`. Re-add the missing shape or remove the offending entry " +
      "from `AUDIT_FIX_LOOP_CANONICAL_LOOPS`.",
    `Context: file=${file}, probe=audit_fix_loop_pattern_invariants, severity=error`,
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

export async function runAuditFixLoopPatternInvariantsProbe(
  projectRoot: string,
): Promise<AuditFixLoopReport> {
  const skillsBase = join(projectRoot, "plugins", "dev-process-toolkit", "skills");
  const agentsBase = join(projectRoot, "plugins", "dev-process-toolkit", "agents");

  // Vacuous only when NEITHER tree exists (matches probes #39 / #50 / #51).
  if (!existsSync(skillsBase) && !existsSync(agentsBase)) {
    return { violations: [], vacuous: true };
  }

  const violations: IntegrityViolation[] = [];

  for (const entry of AUDIT_FIX_LOOP_CANONICAL_LOOPS) {
    // ── (a) child skill file invariants ──
    const childPath = join(skillsBase, entry.child, "SKILL.md");
    let childBody = "";
    if (!existsSync(childPath)) {
      pushViolation(
        violations,
        projectRoot,
        childPath,
        1,
        `missing child skill at skills/${entry.child}/SKILL.md`,
      );
    } else {
      try {
        childBody = readFileSync(childPath, "utf-8");
      } catch (err) {
        pushViolation(
          violations,
          projectRoot,
          childPath,
          1,
          `child skill SKILL.md is not readable: ${(err as Error).message}`,
        );
        childBody = "";
      }
    }

    if (childBody.length > 0) {
      const fm = parseFrontmatterFields(childBody);

      // context: fork
      if (fm.context !== "fork") {
        pushViolation(
          violations,
          projectRoot,
          childPath,
          lineNumberOfKey(childBody, "context"),
          `child skill is missing \`context: fork\` ` +
            `(got \`${fm.context ?? "<absent>"}\`) at skills/${entry.child}/SKILL.md`,
        );
      }

      // user-invocable: false
      if (fm["user-invocable"] !== "false") {
        pushViolation(
          violations,
          projectRoot,
          childPath,
          lineNumberOfKey(childBody, "user-invocable"),
          `child skill is missing \`user-invocable: false\` ` +
            `(got \`${fm["user-invocable"] ?? "<absent>"}\`) at skills/${entry.child}/SKILL.md`,
        );
      }

      // agent: resolves to existing agents/<name>.md
      const agentName = fm.agent ?? "";
      if (agentName.length === 0) {
        pushViolation(
          violations,
          projectRoot,
          childPath,
          lineNumberOfKey(childBody, "agent"),
          `child skill is missing \`agent:\` field at skills/${entry.child}/SKILL.md`,
        );
      } else {
        const agentPath = join(agentsBase, `${agentName}.md`);
        if (!existsSync(agentPath)) {
          pushViolation(
            violations,
            projectRoot,
            childPath,
            lineNumberOfKey(childBody, "agent"),
            `child skill \`agent: ${agentName}\` does not resolve to ` +
              `agents/${agentName}.md at skills/${entry.child}/SKILL.md`,
          );
        }
      }

      // (c) allowed-tools (if present) excludes Agent.
      if (fm["allowed-tools"] !== undefined) {
        const allowed = splitToolsList(fm["allowed-tools"]);
        if (allowed.includes("Agent")) {
          pushViolation(
            violations,
            projectRoot,
            childPath,
            lineNumberOfKey(childBody, "allowed-tools"),
            `child skill \`allowed-tools\` includes \`Agent\` — audit-fix ` +
              `loop forks must not nest-spawn (Agent must be excluded) at ` +
              `skills/${entry.child}/SKILL.md`,
          );
        }
      }
    }

    // ── (b) subagent file invariants ──
    const subagentPath = join(agentsBase, `${entry.subagent}.md`);
    let subagentBody = "";
    if (!existsSync(subagentPath)) {
      pushViolation(
        violations,
        projectRoot,
        subagentPath,
        1,
        `missing subagent file at agents/${entry.subagent}.md`,
      );
    } else {
      try {
        subagentBody = readFileSync(subagentPath, "utf-8");
      } catch (err) {
        pushViolation(
          violations,
          projectRoot,
          subagentPath,
          1,
          `subagent file is not readable: ${(err as Error).message} at agents/${entry.subagent}.md`,
        );
        subagentBody = "";
      }
    }

    if (subagentBody.length > 0) {
      const fm = parseFrontmatterFields(subagentBody);
      const toolsRaw = fm.tools ?? "";
      const tools = splitToolsList(toolsRaw);
      const missingRequired = REQUIRED_TOOLS.filter((t) => !tools.includes(t));
      if (missingRequired.length > 0) {
        pushViolation(
          violations,
          projectRoot,
          subagentPath,
          lineNumberOfKey(subagentBody, "tools"),
          `subagent \`tools\` is missing required read-only tools ` +
            `${missingRequired.join(", ")} (need Read, Grep, Glob; got ` +
            `\`${toolsRaw}\`) at agents/${entry.subagent}.md`,
        );
      }
      const includesForbidden = FORBIDDEN_TOOLS.filter((t) => tools.includes(t));
      if (includesForbidden.length > 0) {
        pushViolation(
          violations,
          projectRoot,
          subagentPath,
          lineNumberOfKey(subagentBody, "tools"),
          `subagent \`tools\` includes forbidden ` +
            `${includesForbidden.join(", ")} — audit-fix loop subagents ` +
            `must be read-only (Write, Edit, Bash, Agent must be excluded) ` +
            `at agents/${entry.subagent}.md`,
        );
      }
    }
  }

  // Map IntegrityViolation → AuditFixLoopViolation (drop `reason` field).
  return {
    violations: violations.map((v) => ({
      file: v.file,
      line: v.line,
      severity: v.severity,
      note: v.note,
      message: v.message,
    })),
    vacuous: false,
  };
}
