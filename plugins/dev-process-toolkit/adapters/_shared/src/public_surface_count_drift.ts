// public_surface_count_drift (STE-315 AC-STE-315.1) — /gate-check probe
// `public_surface_count_drift`. Severity: error.
//
// Asserts the documented skill / agent / probe count tokens in `README.md`
// and `CLAUDE.md` match the actual on-disk counts. Walks three input files
// (`README.md`, `CLAUDE.md`, `skills/gate-check/SKILL.md`) and the on-disk
// `plugins/dev-process-toolkit/skills/*/` + `agents/*.md` trees to compute
// the observed counts; any documented value that disagrees with the
// corresponding observed value surfaces as an NFR-10 canonical refusal.
//
// AC-STE-315.2 adds the runtime body: observed counts via Bun.Glob.scan
// (canonical to AC-STE-315.2's "globIterate" wording) and documented-value
// parsing of count-bearing lines in README.md + CLAUDE.md.

import { Glob } from "bun";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { normalizeFrontmatterSource } from "./frontmatter";
import {
  checkReadmeSurfaceReachability,
  describesTree,
} from "./readme_surface_reachability";

export const PROBE_ID = "public_surface_count_drift";

export type Severity = "error" | "warning";

export interface PublicSurfaceCountDriftViolation {
  file: string;
  line: number;
  column: number;
  reason: string;
  note: string;
  message: string;
  severity: Severity;
}

export interface PublicSurfaceCountDriftReport {
  violations: PublicSurfaceCountDriftViolation[];
}

// ---------------------------------------------------------------------------
// Observed-count computation
// ---------------------------------------------------------------------------

interface ObservedCounts {
  // Skills directories that carry a SKILL.md with YAML frontmatter (a `---`
  // opener). Filters out scaffolded dirs that lack the canonical skill
  // header — matches the on-disk reality where every shipped skill carries
  // the standard frontmatter envelope.
  skills: number;
  /**
   * Skills whose frontmatter carries `user-invocable: false` — the dispatch
   * half of CLAUDE.md's documented split (STE-567 AC-STE-567.7).
   *
   * Before this existed the split was graded on ONE side: `claudeDispatch` was
   * parsed and never read, no check asserted the halves summed to the total,
   * and neither number was ever compared to the frontmatter. A skill flipped
   * to or from dispatch-only left both documents green as long as they agreed
   * with each other — measured: editing the split to an arithmetically
   * impossible pair returned zero violations.
   */
  dispatchSkills: number;
  agents: number;
  maxProbeNumber: number;
}

async function computeObservedCounts(
  projectRoot: string,
): Promise<ObservedCounts> {
  const skillsBase = join(projectRoot, "plugins", "dev-process-toolkit", "skills");
  const agentsBase = join(projectRoot, "plugins", "dev-process-toolkit", "agents");

  // Skills count: `plugins/dev-process-toolkit/skills/*/` — exclude non-
  // directory entries via Bun.Glob's onlyFiles:false + an explicit isDirectory
  // check, then require a SKILL.md that opens with the canonical `---`
  // YAML frontmatter line.
  let skills = 0;
  let dispatchSkills = 0;
  if (existsSync(skillsBase)) {
    for (const entry of readdirSync(skillsBase)) {
      const abs = join(skillsBase, entry);
      let isDir = false;
      try {
        isDir = statSync(abs).isDirectory();
      } catch {
        continue;
      }
      if (!isDir) continue;
      const skillMd = join(abs, "SKILL.md");
      if (!existsSync(skillMd)) continue;
      try {
        const text = readFileSync(skillMd, "utf-8");
        // Strip a BOM first: a BOM-prefixed SKILL.md would otherwise be
        // skipped, silently undercounting the documented public surface.
        if (!normalizeFrontmatterSource(text).startsWith("---")) continue;
      } catch {
        continue;
      }
      skills += 1;
      // The frontmatter is re-read off the same normalized source used for the
      // `---` check above, so a BOM-prefixed skill counts consistently in both
      // halves rather than inflating one of them.
      try {
        const fm = normalizeFrontmatterSource(readFileSync(skillMd, "utf-8"))
          .split(/^---\s*$/m)[1];
        if (fm !== undefined && /^user-invocable:\s*false\s*$/m.test(fm)) {
          dispatchSkills += 1;
        }
      } catch {
        // Unreadable frontmatter: already counted as a skill above, and a
        // read that failed is not evidence of dispatch-only.
      }
    }
  }

  // Agents count: `plugins/dev-process-toolkit/agents/*.md`.
  let agents = 0;
  if (existsSync(agentsBase)) {
    const agentsGlob = new Glob("*.md");
    for await (const entry of agentsGlob.scan({ cwd: agentsBase })) {
      void entry;
      agents += 1;
    }
  }

  // Max probe number: largest decimal prefix matched by /^(\d+)\.\s/ in
  // skills/gate-check/SKILL.md.
  const gateCheckSkillMd = join(skillsBase, "gate-check", "SKILL.md");
  let maxProbeNumber = 0;
  if (existsSync(gateCheckSkillMd)) {
    const text = readFileSync(gateCheckSkillMd, "utf-8");
    for (const line of text.split("\n")) {
      const m = /^(\d+)\.\s/.exec(line);
      if (m !== null) {
        const n = Number.parseInt(m[1]!, 10);
        if (Number.isFinite(n) && n > maxProbeNumber) maxProbeNumber = n;
      }
    }
  }

  return { skills, dispatchSkills, agents, maxProbeNumber };
}

// ---------------------------------------------------------------------------
// Documented-value parsing
// ---------------------------------------------------------------------------

type DocumentedTokenKind =
  | "readme-commands"
  | "readme-agents"
  | "readme-probes"
  | "claude-total-skills"
  | "claude-agents";

interface DocumentedToken {
  kind: DocumentedTokenKind;
  file: string;
  line: number;
  column: number;
  documented: number;
  raw: string;
}

interface ParsedDocs {
  readmeCommands?: DocumentedToken;
  readmeAgents?: DocumentedToken;
  readmeProbes?: DocumentedToken;
  claudeTotalSkills?: DocumentedToken;
  claudeUserInvocable?: number; // from "(M user-invocable + K dispatch)"
  claudeDispatch?: number;
  claudeAgents?: DocumentedToken;
  /** Where the split token sits, for anchoring its own violations. */
  claudeSplitLine?: number;
  claudeSplitColumn?: number;
  claudeSplitRaw?: string;
}

function parseReadmeTokens(text: string): {
  readmeCommands?: DocumentedToken;
  readmeAgents?: DocumentedToken;
  readmeProbes?: DocumentedToken;
} {
  const out: ReturnType<typeof parseReadmeTokens> = {};
  const lines = text.split("\n");

  // L3 — skills + agents tokens. Pattern: `N commands, M agents`.
  //
  // The `d` flag is load-bearing, not decoration: it yields each capture's real
  // offset via `m.indices`. Locating the agents token by searching for its VALUE
  // (`m[0].indexOf(m[2])`) silently mis-anchors whenever the agents digit also
  // occurs inside the commands digits — "18 commands, 8 agents" finds the `8` in
  // `18` and points ~12 columns early, into the wrong number.
  const line3 = lines[2];
  if (line3 !== undefined) {
    const m = /(\d+)\s+commands?,\s+(\d+)\s+agents?/d.exec(line3);
    if (m !== null) {
      const skillsCol = m.index + 1;
      // `indices` is present because the pattern carries `d`; fall back to the
      // match start rather than risk an undefined read if that ever changes.
      const agentsTokIdx = m.indices?.[2]?.[0] ?? m.index;
      out.readmeCommands = {
        kind: "readme-commands",
        file: "README.md",
        line: 3,
        column: skillsCol,
        documented: Number.parseInt(m[1]!, 10),
        raw: m[0],
      };
      out.readmeAgents = {
        kind: "readme-agents",
        file: "README.md",
        line: 3,
        column: agentsTokIdx + 1,
        documented: Number.parseInt(m[2]!, 10),
        raw: m[0],
      };
    }
  }

  // Probe count. Pattern: the FULL toolkit token —
  // ``N numbered `/gate-check` probes`` — not the bare `N numbered` prefix.
  //
  // Anchored BY CONTENT, not by a fixed line index (STE-394 AC-STE-394.8).
  // The token used to be read off a hard-coded index, which silently rotted
  // the instant the README grew a line above the fold: the index landed on
  // the `## Features` heading, the regex never matched, `readmeProbes` stayed
  // permanently `undefined`, and the probe-count comparison was skipped with
  // zero violations — a dead leg that looked green. Scanning for the first
  // line that carries the token keeps the leg live across cosmetic edits, and
  // the reported line is the token's TRUE 1-based line number so the
  // violation anchors where a reader can actually find it.
  //
  // The token must be matched in full because reviving the leg armed it in
  // CONSUMER projects too, where no `plugins/dev-process-toolkit/` tree exists
  // and `maxProbeNumber` is therefore 0. Under a loose `N numbered` match any
  // ordinary README prose — "follow the 3 numbered steps" — would parse as a
  // documented probe count and emit a severity:error violation telling the
  // author to rewrite their own README to claim zero probes. Requiring the
  // literal `/gate-check` reference keeps the leg silent on incidental prose
  // while still firing on the real token, which every fixture and the shipped
  // README already spell out in full.
  for (const [idx, line] of lines.entries()) {
    const m = /(\d+) numbered `\/gate-check` probes/.exec(line);
    if (m === null) continue;
    out.readmeProbes = {
      kind: "readme-probes",
      file: "README.md",
      line: idx + 1,
      column: m.index + 1,
      documented: Number.parseInt(m[1]!, 10),
      raw: m[0],
    };
    break; // first match wins — one line owns the count
  }

  return out;
}

function parseClaudeMdTokens(text: string): {
  claudeTotalSkills?: DocumentedToken;
  claudeUserInvocable?: number;
  claudeDispatch?: number;
  claudeAgents?: DocumentedToken;
  /** Where the split token sits, for anchoring its own violations. */
  claudeSplitLine?: number;
  claudeSplitColumn?: number;
  claudeSplitRaw?: string;
} {
  const out: ReturnType<typeof parseClaudeMdTokens> = {};
  const lines = text.split("\n");

  // ANCHORED BY CONTENT, not by a fixed line index (STE-567 AC-STE-567.7,
  // applying the fix STE-394 already made on the README side). These two
  // tokens were read off `lines[14]` / `lines[15]`; adding a single row to the
  // structure block above them slid both off their index, at which point the
  // regexes matched nothing, the tokens stayed permanently `undefined`, and
  // both comparisons were skipped with zero violations — a dead leg that reads
  // green. The reported line is the token's TRUE 1-based line number, so the
  // violation anchors where a reader can actually find it.
  for (const [idx, line] of lines.entries()) {
    if (out.claudeTotalSkills === undefined) {
      const totalMatch = /(\d+)\s+slash commands?/.exec(line);
      if (totalMatch !== null) {
        out.claudeTotalSkills = {
          kind: "claude-total-skills",
          file: "CLAUDE.md",
          line: idx + 1,
          column: totalMatch.index + 1,
          documented: Number.parseInt(totalMatch[1]!, 10),
          raw: totalMatch[0],
        };
        // The parenthesized "(M user-invocable + K dispatch …)" split lives on
        // the same line as the total it decomposes; reading it anywhere else
        // would let the two drift onto different lines unnoticed.
        const splitMatch = /\((\d+)\s+user-invocable\s*\+\s*(\d+)\s+dispatch/.exec(
          line,
        );
        if (splitMatch !== null) {
          out.claudeUserInvocable = Number.parseInt(splitMatch[1]!, 10);
          out.claudeDispatch = Number.parseInt(splitMatch[2]!, 10);
          out.claudeSplitLine = idx + 1;
          out.claudeSplitColumn = splitMatch.index + 1;
          out.claudeSplitRaw = splitMatch[0];
        }
      }
    }
    if (out.claudeAgents === undefined) {
      const m = /(\d+)\s+subagent templates?/.exec(line);
      if (m !== null) {
        out.claudeAgents = {
          kind: "claude-agents",
          file: "CLAUDE.md",
          line: idx + 1,
          column: m.index + 1,
          documented: Number.parseInt(m[1]!, 10),
          raw: m[0],
        };
      }
    }
    if (out.claudeTotalSkills !== undefined && out.claudeAgents !== undefined) break;
  }

  return out;
}

// ---------------------------------------------------------------------------
// Violation rendering — NFR-10 canonical refusal shape
// ---------------------------------------------------------------------------

function makeViolation(opts: {
  file: string;
  line: number;
  column: number;
  reason: string;
  refusing: string;
  remedy: string;
  context: string;
}): PublicSurfaceCountDriftViolation {
  const header = `${opts.file}:${opts.line}:${opts.column} — ${opts.reason}`;
  const message = [
    header,
    `Refusing: ${opts.refusing}`,
    `Remedy: ${opts.remedy}`,
    `Context: ${opts.context}`,
  ].join("\n");
  return {
    file: opts.file,
    line: opts.line,
    column: opts.column,
    reason: opts.reason,
    note: header,
    message,
    severity: "error",
  };
}

// ---------------------------------------------------------------------------
// Public entrypoint
// ---------------------------------------------------------------------------

export async function runPublicSurfaceCountDriftProbe(
  projectRoot: string,
): Promise<PublicSurfaceCountDriftReport> {
  const observed = await computeObservedCounts(projectRoot);

  const readmePath = join(projectRoot, "README.md");
  const claudeMdPath = join(projectRoot, "CLAUDE.md");

  const parsed: ParsedDocs = {};
  if (existsSync(readmePath)) {
    Object.assign(parsed, parseReadmeTokens(readFileSync(readmePath, "utf-8")));
  }
  if (existsSync(claudeMdPath)) {
    Object.assign(parsed, parseClaudeMdTokens(readFileSync(claudeMdPath, "utf-8")));
  }

  const violations: PublicSurfaceCountDriftViolation[] = [];

  // README L3 commands → cross-doc comparison against CLAUDE.md L15's
  // parsed user-invocable count. README's "commands" column documents the
  // user-callable surface (matches STE-314's user-callable framing);
  // CLAUDE.md L15's parenthesized "(M user-invocable + K dispatch)" carries
  // the canonical user-invocable split. Both documents must agree.
  if (
    parsed.readmeCommands !== undefined &&
    parsed.claudeUserInvocable !== undefined &&
    parsed.readmeCommands.documented !== parsed.claudeUserInvocable
  ) {
    const tok = parsed.readmeCommands;
    const expected = parsed.claudeUserInvocable;
    const obsTotal = observed.skills;
    violations.push(
      makeViolation({
        file: tok.file,
        line: tok.line,
        column: tok.column,
        reason: `documented commands count (${tok.documented}) disagrees with user-invocable count (${expected}) from CLAUDE.md L15 (on-disk total: ${obsTotal} skills)`,
        refusing: `README L3 documents "${tok.raw}" but the canonical user-invocable count is ${expected}`,
        remedy: `update README.md:3 to "${expected} commands, …" to match the on-disk + CLAUDE.md L15 user-invocable count.`,
        context: `source of truth: ls -d plugins/dev-process-toolkit/skills/*/ (observed ${obsTotal} total skills; CLAUDE.md L15 documents ${expected} user-invocable)`,
      }),
    );
  }

  // ── STE-567 AC-STE-567.7: BOTH halves of the split are graded ──────────
  //
  // `claudeDispatch` used to be assigned and never read. These two checks are
  // what make the split a claim about the tree rather than a claim about
  // itself: the first compares the dispatch half to the on-disk
  // `user-invocable: false` frontmatter count, and the second asserts the
  // halves add up to the total the same line documents. Neither is implied by
  // the other — a pair that sums correctly can still both be wrong, and a
  // correct dispatch half can sit beside an arithmetically impossible total.
  if (
    parsed.claudeDispatch !== undefined &&
    parsed.claudeSplitLine !== undefined &&
    parsed.claudeDispatch !== observed.dispatchSkills
  ) {
    violations.push(
      makeViolation({
        file: "CLAUDE.md",
        line: parsed.claudeSplitLine,
        column: parsed.claudeSplitColumn ?? 1,
        reason: `documented dispatch count (${parsed.claudeDispatch}) disagrees with on-disk observed count (${observed.dispatchSkills})`,
        refusing: `CLAUDE.md L${parsed.claudeSplitLine} documents "${parsed.claudeSplitRaw}" but ${observed.dispatchSkills} skills carry \`user-invocable: false\``,
        remedy: `update the split to "${observed.skills - observed.dispatchSkills} user-invocable + ${observed.dispatchSkills} dispatch" to match the on-disk frontmatter.`,
        context:
          "source of truth: grep -l '^user-invocable: false' plugins/dev-process-toolkit/skills/*/SKILL.md",
      }),
    );
  }

  if (
    parsed.claudeUserInvocable !== undefined &&
    parsed.claudeDispatch !== undefined &&
    parsed.claudeSplitLine !== undefined &&
    parsed.claudeTotalSkills !== undefined &&
    parsed.claudeUserInvocable + parsed.claudeDispatch !==
      parsed.claudeTotalSkills.documented
  ) {
    const sum = parsed.claudeUserInvocable + parsed.claudeDispatch;
    violations.push(
      makeViolation({
        file: "CLAUDE.md",
        line: parsed.claudeSplitLine,
        column: parsed.claudeSplitColumn ?? 1,
        reason: `the documented split does not add up: ${parsed.claudeUserInvocable} + ${parsed.claudeDispatch} = ${sum}, but the same line documents ${parsed.claudeTotalSkills.documented} slash commands`,
        refusing: `CLAUDE.md L${parsed.claudeSplitLine} documents "${parsed.claudeSplitRaw}" against a stated total of ${parsed.claudeTotalSkills.documented}`,
        remedy: `make the two halves sum to the total — on disk that is "${observed.skills - observed.dispatchSkills} user-invocable + ${observed.dispatchSkills} dispatch" of ${observed.skills}.`,
        context: `observed: ${observed.skills} skills, ${observed.dispatchSkills} of them dispatch-only`,
      }),
    );
  }

  // Each remaining check compares one DocumentedToken against an observed
  // disk count and emits a uniform NFR-10 violation on mismatch.
  const diskChecks: Array<{
    token: DocumentedToken | undefined;
    observed: number;
    label: string; // singular noun for the "reflect N <label>" remedy
    reason: (doc: number, obs: number) => string;
    refusingTail: string; // appended after `<file> L<line> documents "<raw>" but the on-disk `
    sourceOfTruth: string;
  }> = [
    {
      token: parsed.readmeAgents,
      observed: observed.agents,
      label: "agents",
      reason: (d, o) =>
        `documented agents count (${d}) disagrees with on-disk observed count (${o})`,
      refusingTail: "agents count is",
      sourceOfTruth: "ls plugins/dev-process-toolkit/agents/*.md",
    },
    {
      token: parsed.readmeProbes,
      observed: observed.maxProbeNumber,
      label: "numbered probes",
      reason: (d, o) =>
        `documented probe count (${d}) disagrees with on-disk observed count (${o})`,
      refusingTail: "max numbered probe is",
      sourceOfTruth:
        'grep -nE "^[0-9]+\\. " plugins/dev-process-toolkit/skills/gate-check/SKILL.md',
    },
    {
      token: parsed.claudeTotalSkills,
      observed: observed.skills,
      label: "slash commands",
      reason: (d, o) =>
        `documented total slash commands (${d}) disagrees with on-disk observed count (${o})`,
      refusingTail: "total skills count is",
      sourceOfTruth: "ls -d plugins/dev-process-toolkit/skills/*/",
    },
    {
      token: parsed.claudeAgents,
      observed: observed.agents,
      label: "subagent templates",
      reason: (d, o) =>
        `documented subagent templates count (${d}) disagrees with on-disk observed count (${o})`,
      refusingTail: "agents count is",
      sourceOfTruth: "ls plugins/dev-process-toolkit/agents/*.md",
    },
  ];

  for (const check of diskChecks) {
    const tok = check.token;
    if (tok === undefined) continue;
    const obs = check.observed;
    if (tok.documented === obs) continue;
    violations.push(
      makeViolation({
        file: tok.file,
        line: tok.line,
        column: tok.column,
        reason: check.reason(tok.documented, obs),
        refusing: `${tok.file} L${tok.line} documents "${tok.raw}" but the on-disk ${check.refusingTail} ${obs}`,
        remedy: `update ${tok.file}:${tok.line} to reflect ${obs} ${check.label} (currently documents ${tok.documented}).`,
        context: `source of truth: ${check.sourceOfTruth}`,
      }),
    );
  }

  // ── STE-567 AC-STE-567.2 / .3 / .6: reachability, not just arithmetic ──
  //
  // Graded HERE rather than as a new probe number: this module already has
  // README.md and both trees open, and registering a probe costs roughly two
  // dozen pinned sites across the suite for nothing this check needs. It is
  // existence-guarded on the plugin tree so consumer projects — which ship no
  // `plugins/dev-process-toolkit/skills/` — stay silent rather than being told
  // to rewrite their own README.
  const pluginRoot = join(projectRoot, "plugins", "dev-process-toolkit");
  const readmeForReach = existsSync(readmePath) ? readFileSync(readmePath, "utf-8") : "";
  if (describesTree(readmeForReach, pluginRoot)) {
    for (const r of checkReadmeSurfaceReachability(readmeForReach, pluginRoot)) {
      violations.push(
        makeViolation({
          file: r.file,
          line: r.line,
          column: 1,
          reason: r.reason,
          refusing: `${r.file} does not describe the shipped surface \`${r.subject}\``,
          remedy:
            r.rule === "skill_unreachable"
              ? `add ${r.subject} to the workflow diagram, or name it in the prose beneath the diagram that accounts for the table-only skills.`
              : r.rule === "diagram_intro_count"
                ? "state the diagram's own node count in the sentence that introduces it."
                : `bring the README Agents table and plugins/dev-process-toolkit/agents/ into agreement on \`${r.subject}\`.`,
          context: `rule=${r.rule}, subject=${r.subject}`,
        }),
      );
    }
  }

  return { violations };
}
