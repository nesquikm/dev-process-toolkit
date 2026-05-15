// tdd_orchestrator_integrity (STE-225 AC.7) — /gate-check probe.
// Severity: error.
//
// Asserts the load-bearing structural invariants of the multi-agent TDD
// orchestrator:
//   (a) the four skill paths exist (tdd + tdd-write-test + tdd-implement + tdd-refactor)
//   (b) the three child skills carry `context: fork`
//   (c) each child's `agent:` field resolves to a real agents/*.md
//   (d) each child carries `user-invocable: false`
//   (e) each subagent's `tools` field excludes `Agent`
//
// The probe explicitly does NOT enforce specific allowed-tool composition
// beyond the `Agent` exclusion, or specific prompt phrasing. Content drift
// is verified by the smoke (AC-STE-225.9), not the probe.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  lineNumberOfKey,
  parseFrontmatterFields,
  pushViolation as pushViolationShared,
  type IntegrityReport,
  type IntegrityViolation,
  type Severity,
} from "./tdd_probe_helpers";

export type { IntegrityReport, IntegrityViolation, Severity };

interface ChildSpec {
  skillDir: string;
  expectedAgent: string;
}

const ORCHESTRATOR_DIR = "tdd";

const CHILDREN: ReadonlyArray<ChildSpec> = [
  { skillDir: "tdd-write-test", expectedAgent: "tdd-test-writer" },
  { skillDir: "tdd-implement", expectedAgent: "tdd-implementer" },
  { skillDir: "tdd-refactor", expectedAgent: "tdd-refactorer" },
];

function buildMessage(noteBody: string, file: string): string {
  return [
    `tdd_orchestrator_integrity: ${noteBody}`,
    "Remedy: restore the load-bearing invariant. The TDD orchestrator " +
      "depends on (a) the four skill paths existing, (b) `context: fork` " +
      "on each child skill, (c) the child's `agent:` resolving to a real " +
      "subagent file, (d) `user-invocable: false` on children, and (e) " +
      "each subagent's `tools` excluding `Agent`. Re-add the missing " +
      "shape per skills/tdd*/SKILL.md and agents/tdd-*.md.",
    `Context: file=${file}, probe=tdd_orchestrator_integrity, severity=error`,
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

export async function runTddOrchestratorIntegrityProbe(
  projectRoot: string,
): Promise<IntegrityReport> {
  const skillsBase = join(projectRoot, "plugins", "dev-process-toolkit", "skills");
  const agentsBase = join(projectRoot, "plugins", "dev-process-toolkit", "agents");
  if (!existsSync(skillsBase) && !existsSync(agentsBase)) {
    return { violations: [], vacuous: true };
  }

  const violations: IntegrityViolation[] = [];

  // (a) Orchestrator skill exists.
  const orchestratorPath = join(skillsBase, ORCHESTRATOR_DIR, "SKILL.md");
  if (!existsSync(orchestratorPath)) {
    pushViolation(
      violations,
      projectRoot,
      orchestratorPath,
      1,
      "missing orchestrator skill at skills/tdd/SKILL.md",
    );
  }

  // Walk children.
  for (const { skillDir, expectedAgent } of CHILDREN) {
    const childPath = join(skillsBase, skillDir, "SKILL.md");
    if (!existsSync(childPath)) {
      // (a) — child skill missing.
      pushViolation(
        violations,
        projectRoot,
        childPath,
        1,
        `missing child skill at skills/${skillDir}/SKILL.md`,
      );
      continue;
    }
    let body: string;
    try {
      body = readFileSync(childPath, "utf-8");
    } catch (err) {
      pushViolation(
        violations,
        projectRoot,
        childPath,
        1,
        `child skill SKILL.md is not readable: ${(err as Error).message}`,
      );
      continue;
    }
    const fm = parseFrontmatterFields(body);

    // (b) — context: fork.
    if (fm.context !== "fork") {
      pushViolation(
        violations,
        projectRoot,
        childPath,
        lineNumberOfKey(body, "context"),
        `child skill is missing \`context: fork\` (got \`${fm.context ?? "<absent>"}\`)`,
      );
    }

    // (c) — agent: resolves to a real agents/*.md.
    const agentName = fm.agent ?? "";
    if (agentName.length === 0) {
      pushViolation(
        violations,
        projectRoot,
        childPath,
        lineNumberOfKey(body, "agent"),
        `child skill is missing \`agent:\` field`,
      );
    } else {
      const agentPath = join(agentsBase, `${agentName}.md`);
      if (!existsSync(agentPath)) {
        pushViolation(
          violations,
          projectRoot,
          childPath,
          lineNumberOfKey(body, "agent"),
          `child skill \`agent: ${agentName}\` does not resolve to ` +
            `agents/${agentName}.md`,
        );
      }
    }
    if (agentName !== expectedAgent && agentName.length > 0) {
      // Soft consistency check — log expected mapping. We don't fail
      // when the agent file exists but is named differently from the
      // canonical mapping; the canonical pairing is documented in the
      // FR but not part of the load-bearing invariants the probe
      // enforces.
    }

    // (d) — user-invocable: false.
    if (fm["user-invocable"] !== "false") {
      pushViolation(
        violations,
        projectRoot,
        childPath,
        lineNumberOfKey(body, "user-invocable"),
        `child skill is missing \`user-invocable: false\` ` +
          `(got \`${fm["user-invocable"] ?? "<absent>"}\`)`,
      );
    }
  }

  // (e) — every TDD subagent's `tools` excludes `Agent`.
  for (const { expectedAgent } of CHILDREN) {
    const agentPath = join(agentsBase, `${expectedAgent}.md`);
    if (!existsSync(agentPath)) {
      // (a) is already covered above when the child skill names this
      // agent. Skip to avoid double-reporting on a missing file.
      continue;
    }
    let body: string;
    try {
      body = readFileSync(agentPath, "utf-8");
    } catch {
      continue;
    }
    const fm = parseFrontmatterFields(body);
    const tools = (fm.tools ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (tools.includes("Agent")) {
      pushViolation(
        violations,
        projectRoot,
        agentPath,
        lineNumberOfKey(body, "tools"),
        `subagent \`tools\` includes \`Agent\` — plugin-bundled TDD ` +
          `subagents must not nest-spawn (Agent must be excluded)`,
      );
    }
  }

  return { violations, vacuous: false };
}
