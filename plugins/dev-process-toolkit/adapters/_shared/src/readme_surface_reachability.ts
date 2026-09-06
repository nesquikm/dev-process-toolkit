// readme_surface_reachability — is every shipped surface reachable from the
// front door, and does the front door's own arithmetic hold?
//
// WHY THIS IS NOT A COUNT CHECK (STE-567). `public_surface_count_drift`
// already grades README and CLAUDE.md count TOKENS against the tree, and it
// was green while `/best-practices` was unreachable from the README by every
// route the README itself offers: no diagram node, no Features bullet, no
// mention in the carve-out prose that excuses the other table-only skills, and
// not one occurrence in `docs/workflow-overview.md` — the document the README
// points at "for the mechanics it omits". Every count was internally
// consistent; one skill was simply invisible. A checker that compares two
// numbers reproduces that blind spot exactly, so this one reports PER SKILL
// and PER AGENT, naming the surface that fell out.
//
// The second half is the sentence above the diagram. It read "the toolkit
// groups its 18 user-invoked skills into a four-phase lifecycle. Read
// left-to-right for the full path" over a diagram of fifteen nodes. That
// framing is what turns an omission into a misdirection: it tells the reader
// they have seen everything before they scroll far enough to learn otherwise.
// So the stated count is DERIVED from the diagram it introduces — adding a
// node without touching the sentence reds, and so does the reverse.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeFrontmatterSource } from "./frontmatter";

export interface ReachabilityViolation {
  file: string;
  /** 1-indexed line the finding anchors to, so a reader can find the subject. */
  line: number;
  /** The surface that is unreachable or miscounted. */
  subject: string;
  rule:
    | "diagram_intro_count"
    | "skill_unreachable"
    | "agent_row_missing"
    | "agent_row_orphan";
  reason: string;
}

// ---------------------------------------------------------------------------
// Reading the shipped tree
// ---------------------------------------------------------------------------

/** Every skill directory that ships a SKILL.md with YAML frontmatter. */
export function readShippedSkills(pluginRoot: string): {
  userInvocable: string[];
  dispatch: string[];
} {
  const base = join(pluginRoot, "skills");
  const userInvocable: string[] = [];
  const dispatch: string[] = [];
  if (!existsSync(base)) return { userInvocable, dispatch };
  for (const entry of readdirSync(base).sort()) {
    const skillMd = join(base, entry, "SKILL.md");
    if (!existsSync(skillMd)) continue;
    let fm: string | undefined;
    try {
      const text = normalizeFrontmatterSource(readFileSync(skillMd, "utf-8"));
      if (!text.startsWith("---")) continue;
      fm = text.split(/^---\s*$/m)[1];
    } catch {
      continue;
    }
    if (fm !== undefined && /^user-invocable:\s*false\s*$/m.test(fm)) dispatch.push(entry);
    else userInvocable.push(entry);
  }
  return { userInvocable, dispatch };
}

/** Every agent template that ships, by basename without the extension. */
export function readShippedAgents(pluginRoot: string): string[] {
  const base = join(pluginRoot, "agents");
  if (!existsSync(base)) return [];
  return readdirSync(base)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.slice(0, -3))
    .sort();
}

// ---------------------------------------------------------------------------
// Reading the README
// ---------------------------------------------------------------------------

/**
 * The skill names drawn as nodes in the README's workflow mermaid block.
 *
 * Anchored on the node DECLARATIONS (`id(["/name"])` / `id["/name"]`) rather
 * than on every `/name` occurrence in the block, so an edge label or a
 * subgraph title mentioning a skill does not read as a node.
 */
export function readDiagramNodes(readme: string): string[] {
  const block = /```mermaid\n([\s\S]*?)\n```/.exec(readme)?.[1];
  if (block === undefined) return [];
  const out: string[] = [];
  for (const m of block.matchAll(/\w+\(?\["\/([a-z][a-z-]*)"\]\)?/g)) {
    if (!out.includes(m[1]!)) out.push(m[1]!);
  }
  return out.sort();
}

/** The node count the sentence above the diagram states, or `undefined`. */
export function readDiagramIntroCount(readme: string): number | undefined {
  const m = /The diagram below maps the (\d+) skills/.exec(readme);
  return m === null ? undefined : Number.parseInt(m[1]!, 10);
}

/**
 * The prose that accounts for the skills the diagram leaves out.
 *
 * Bounded to the region between the mermaid block and the next `## ` heading:
 * a skill named anywhere else in the README (its own table row, for instance)
 * is not a carve-out, and counting it as one is what let `/best-practices`
 * look accounted for while nothing accounted for it.
 */
export function readCarveOutProse(readme: string): string {
  const after = readme.split(/```mermaid\n[\s\S]*?\n```/)[1] ?? "";
  return after.split(/\n## /)[0] ?? "";
}

/** The agent names the README's Agents table gives rows to, in order. */
export function readAgentTableRows(readme: string): string[] {
  const section = readme.split(/\n### Agents\n/)[1]?.split(/\n#{2,3} /)[0] ?? "";
  const out: string[] = [];
  for (const m of section.matchAll(/^\|\s*`([a-z][a-z-]*)`\s*\|/gm)) {
    if (!out.includes(m[1]!)) out.push(m[1]!);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Applicability
// ---------------------------------------------------------------------------

/**
 * Does this README describe THIS skills tree?
 *
 * The check compares a README against the tree it documents, so it must first
 * establish that the two are about the same subject. The test is behavioural,
 * not path-based: MORE THAN HALF the skills drawn in the workflow diagram must
 * resolve to a directory under `<pluginRoot>/skills/`.
 *
 * Both halves of that threshold are load-bearing, and each was chosen against a
 * concrete case:
 *
 *  - Not "at least one". The `public_surface_count_drift` fixtures synthesize
 *    skills named `skill-1 … skill-N` AND a real `skills/gate-check/SKILL.md`
 *    (the probe registry has to live somewhere). `gate-check` is a diagram
 *    node, so a one-node test passes on a tree that shares exactly one
 *    incidental name with the README — measured, not reasoned.
 *  - Not "all". Demanding every node resolve would make the leg go vacuous the
 *    moment a drawn skill is deleted, which is precisely the defect it exists
 *    to report.
 *
 * Callers must pair this with an anti-vacuity assertion — a guard that can
 * disarm a check is only safe while something asserts it has not.
 */
export function describesTree(readme: string, pluginRoot: string): boolean {
  const nodes = readDiagramNodes(readme);
  if (nodes.length === 0) return false;
  if (readAgentTableRows(readme).length === 0) return false;
  const resolved = nodes.filter((n) =>
    existsSync(join(pluginRoot, "skills", n, "SKILL.md")),
  ).length;
  return resolved * 2 > nodes.length;
}

// ---------------------------------------------------------------------------
// The check
// ---------------------------------------------------------------------------

/**
 * Report every front-door surface that does not describe the shipped tree.
 *
 * THROWS when the README carries no mermaid block or no Agents table — an
 * empty parse would return zero violations and read as green, which is the
 * failure mode this module exists to catch rather than reproduce.
 */
export function checkReadmeSurfaceReachability(
  readme: string,
  pluginRoot: string,
): ReachabilityViolation[] {
  const nodes = readDiagramNodes(readme);
  if (nodes.length === 0) {
    throw new Error(
      "checkReadmeSurfaceReachability: no skill nodes parsed out of the README " +
        "workflow diagram; refusing to report a clean surface from an empty parse",
    );
  }
  const rows = readAgentTableRows(readme);
  if (rows.length === 0) {
    throw new Error(
      "checkReadmeSurfaceReachability: no rows parsed out of the README Agents " +
        "table; refusing to report a clean surface from an empty parse",
    );
  }

  const out: ReachabilityViolation[] = [];

  // Anchors. A violation reported at line 0 is a violation nobody chases, so
  // each rule points at the surface a reader would edit: the introduction for
  // the diagram rules, the `### Agents` heading for the table rules.
  const lineOf = (needle: RegExp): number => {
    for (const [idx, line] of readme.split("\n").entries()) {
      if (needle.test(line)) return idx + 1;
    }
    return 1;
  };
  const introLine = lineOf(/The diagram below maps the|```mermaid/);
  const agentsLine = lineOf(/^### Agents\s*$/);

  // (1) The introduction states the diagram's own node count.
  const stated = readDiagramIntroCount(readme);
  if (stated === undefined) {
    out.push({
      file: "README.md",
      line: introLine,
      subject: "workflow diagram introduction",
      rule: "diagram_intro_count",
      reason:
        "the sentence introducing the workflow diagram states no node count; " +
        "the count must be stated so it can be graded against the diagram",
    });
  } else if (stated !== nodes.length) {
    out.push({
      file: "README.md",
      line: introLine,
      subject: "workflow diagram introduction",
      rule: "diagram_intro_count",
      reason: `the introduction states ${stated} skills; the diagram draws ${nodes.length} (${nodes.join(", ")})`,
    });
  }

  // (2) Every user-invocable skill is reachable — as a node, or named in the
  //     prose that accounts for the table-only ones.
  const carveOut = readCarveOutProse(readme);
  for (const skill of readShippedSkills(pluginRoot).userInvocable) {
    if (nodes.includes(skill)) continue;
    if (new RegExp(`/${skill}\\b`).test(carveOut)) continue;
    out.push({
      file: "README.md",
      line: introLine,
      subject: `/${skill}`,
      rule: "skill_unreachable",
      reason:
        `/${skill} is user-invocable but appears neither as a workflow-diagram ` +
        "node nor in the prose beneath the diagram that accounts for the " +
        "table-only skills — a reader following the README's own routes never meets it",
    });
  }

  // (3) The Agents table and the agents/ directory agree, both ways.
  const agents = readShippedAgents(pluginRoot);
  for (const agent of agents) {
    if (rows.includes(agent)) continue;
    out.push({
      file: "README.md",
      line: agentsLine,
      subject: agent,
      rule: "agent_row_missing",
      reason: `agents/${agent}.md ships but the README Agents table has no row for it`,
    });
  }
  for (const row of rows) {
    if (agents.includes(row)) continue;
    out.push({
      file: "README.md",
      line: agentsLine,
      subject: row,
      rule: "agent_row_orphan",
      reason: `the README Agents table has a row for \`${row}\`, but agents/${row}.md is not on disk`,
    });
  }

  return out;
}
