// milestone_name_unasked (STE-659) — a milestone's title and codename are
// composed, never asked.
//
// STE-657 moved the codename into the plan at spec time and STE-658 retired the
// `/ship-milestone` prompt that asked for it. A rule that lives only in prose
// regrows the day someone writes a new prompt, so this probe grades it:
//
//   * PROSE arm — every `plugins/dev-process-toolkit/skills/**/SKILL.md` under
//     the project root, matched line by line against a CLOSED set of prompt
//     shapes that ask the operator for a milestone name / title / codename. A
//     line that states the name is NEVER asked is not a match — the rule that
//     forbids the prompt must not red the gate that enforces it.
//   * PLAN arm — every active `specs/plan/*.md` (never `specs/plan/archive/`),
//     read through `readPlanCodename`. A thrown refusal is a violation naming
//     the plan path and validateCodename's broken rule; an absent key passes.
//
// Read-only: no git, no network, no child processes.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { parseFrontmatter } from "./frontmatter";
import { readPlanCodename } from "./milestone_codename";

/** The probe id, as registered in `skills/gate-check/SKILL.md`. */
export const PROBE_ID = "milestone_name_unasked";

const SKILLS_SEGMENTS = ["plugins", "dev-process-toolkit", "skills"] as const;
const PLAN_SEGMENTS = ["specs", "plan"] as const;

export interface MilestoneNameUnaskedViolation {
  readonly file: string;
  readonly line: number;
  readonly reason: string;
  /** `<file>:<line> — <reason>`. */
  readonly note: string;
  /** NFR-10 shape: verdict line, `Remedy:`, `Context:`. */
  readonly message: string;
  readonly severity: "error";
}

export interface MilestoneNameUnaskedReport {
  readonly violations: MilestoneNameUnaskedViolation[];
  readonly notes: string[];
  /** MEASURED: neither a skills tree nor an active plan existed to grade. */
  readonly vacuous: boolean;
}

export interface MilestoneNameUnaskedOptions {
  readonly arms?: { readonly prose?: boolean; readonly plan?: boolean };
}

/** One arm's outcome: whether it found anything to grade, and what it found. */
interface ArmResult {
  readonly graded: boolean;
  readonly violations: MilestoneNameUnaskedViolation[];
}

const SKIPPED: ArmResult = { graded: false, violations: [] };

/** Read a file as UTF-8, or `undefined` when it is unreadable. */
function readText(abs: string): string | undefined {
  try {
    return readFileSync(abs, "utf-8");
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// The prose arm
// ---------------------------------------------------------------------------

const SUBJECT = String.raw`milestone(?:'s)?\s+(?:codename|title|name)`;

/** The closed set of prompt shapes. Each entry names what it caught. */
const PROMPT_SHAPES: readonly { readonly re: RegExp; readonly what: string }[] = [
  {
    re: new RegExp(String.raw`\benter\s+(?:the\s+|a\s+)?${SUBJECT}\b`, "i"),
    what: "an `Enter milestone …` prompt",
  },
  {
    re: new RegExp(
      String.raw`\bask(?:s|ing)?\s+(?:the\s+)?(?:user|operator|human)\s+(?:for|to\s+(?:enter|supply|provide|name|choose|pick))\s+(?:the\s+|a\s+)?${SUBJECT}\b`,
      "i",
    ),
    what: "an instruction asking the operator for the milestone name",
  },
  {
    re: new RegExp(
      String.raw`\bprompt(?:s|ing)?\s+(?:the\s+(?:user|operator|human)\s+)?for\s+(?:the\s+|a\s+)?${SUBJECT}\b`,
      "i",
    ),
    what: "an instruction prompting for the milestone name",
  },
  {
    re: new RegExp(String.raw`\bAskUserQuestion\b[^.;!?]*?\b${SUBJECT}\b`, "i"),
    what: "an `AskUserQuestion` instruction asking for the milestone name",
  },
];

/**
 * A negation clears only the ask it governs: it must sit in the same clause,
 * within the few words before the prompt shape ("never ask the user for …",
 * "do not prompt for …"). A `no` elsewhere on the line — "(no backticks)" —
 * leaves the prompt a prompt.
 */
const NEGATION = /\b(?:never|not|no|neither|nor|don't|do\s+not|must\s+not)\b/i;
const NEGATION_WINDOW_WORDS = 4;

function isNegated(text: string, matchStart: number): boolean {
  const clause = text.slice(0, matchStart).split(/[.;:!?]/).pop() ?? "";
  const window = clause.trim().split(/\s+/).slice(-NEGATION_WINDOW_WORDS).join(" ");
  return NEGATION.test(window);
}

/** The first prompt shape asking on this line that no negation governs. */
function ungovernedShape(text: string): (typeof PROMPT_SHAPES)[number] | undefined {
  for (const shape of PROMPT_SHAPES) {
    const re = new RegExp(shape.re.source, "gi");
    for (const m of text.matchAll(re)) {
      if (!isNegated(text, m.index ?? 0)) return shape;
    }
  }
  return undefined;
}

function walkSkillFiles(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir).sort();
  } catch {
    return;
  }
  for (const name of entries) {
    const abs = join(dir, name);
    let isDir = false;
    try {
      isDir = statSync(abs).isDirectory();
    } catch {
      continue;
    }
    if (isDir) walkSkillFiles(abs, out);
    else if (name === "SKILL.md") out.push(abs);
  }
}

function toRel(projectRoot: string, abs: string): string {
  return abs
    .slice(projectRoot.length)
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
}

function violation(
  file: string,
  line: number,
  reason: string,
  remedy: string,
): MilestoneNameUnaskedViolation {
  const note = `${file}:${line} — ${reason}`;
  return {
    file,
    line,
    reason,
    note,
    severity: "error",
    message: [
      `${PROBE_ID}: ${note}`,
      `Remedy: ${remedy}`,
      `Context: file=${file}, line=${line}, probe=${PROBE_ID}, severity=error`,
    ].join("\n"),
  };
}

const PROSE_REMEDY =
  "delete the prompt — compose the milestone title and codename from the approved " +
  "design instead (the plan's `codename:` key, validated by validateCodename in " +
  "adapters/_shared/src/milestone_codename.ts)";

function proseArm(projectRoot: string): ArmResult {
  const skillsDir = join(projectRoot, ...SKILLS_SEGMENTS);
  const files: string[] = [];
  if (existsSync(skillsDir)) walkSkillFiles(skillsDir, files);
  const violations: MilestoneNameUnaskedViolation[] = [];
  for (const abs of files) {
    const body = readText(abs);
    if (body === undefined) continue;
    const rel = toRel(projectRoot, abs);
    body.split("\n").forEach((text, i) => {
      const shape = ungovernedShape(text);
      if (shape === undefined) return;
      violations.push(
        violation(
          rel,
          i + 1,
          `${shape.what}: a milestone's title and codename are composed, never asked`,
          PROSE_REMEDY,
        ),
      );
    });
  }
  return { graded: files.length > 0, violations };
}

// ---------------------------------------------------------------------------
// The plan arm
// ---------------------------------------------------------------------------

function planArm(projectRoot: string): ArmResult {
  const planDir = join(projectRoot, ...PLAN_SEGMENTS);
  let names: string[];
  try {
    names = readdirSync(planDir).filter((n) => n.endsWith(".md")).sort();
  } catch {
    return SKIPPED;
  }
  const violations: MilestoneNameUnaskedViolation[] = [];
  let graded = 0;
  for (const name of names) {
    const abs = join(planDir, name);
    let isFile = false;
    try {
      isFile = statSync(abs).isFile();
    } catch {
      continue;
    }
    const body = isFile ? readText(abs) : undefined;
    if (body === undefined) continue;
    let status: unknown;
    try {
      status = parseFrontmatter(body).status;
    } catch {
      continue;
    }
    if (status !== "active") continue;
    graded++;
    const rel = [...PLAN_SEGMENTS, name].join("/");
    try {
      readPlanCodename(abs);
    } catch (e) {
      const first = (e instanceof Error ? e.message : String(e)).split("\n")[0] ?? "";
      const at = first.indexOf(" — ");
      const rule = at >= 0 ? first.slice(at + 3) : first;
      const idx = body.split("\n").findIndex((l) => /^codename\s*:/.test(l));
      violations.push(
        violation(
          rel,
          idx >= 0 ? idx + 1 : 1,
          `the active plan carries an invalid codename — ${rule}`,
          `edit the codename: line in ${rel} to a value validateCodename accepts, or set it to null`,
        ),
      );
    }
  }
  return { graded: graded > 0, violations };
}

// ---------------------------------------------------------------------------
// The probe
// ---------------------------------------------------------------------------

export function runMilestoneNameUnaskedProbe(
  projectRoot: string,
  options: MilestoneNameUnaskedOptions = {},
): MilestoneNameUnaskedReport {
  const prose = options.arms?.prose !== false ? proseArm(projectRoot) : SKIPPED;
  const plan = options.arms?.plan !== false ? planArm(projectRoot) : SKIPPED;
  const violations = [...prose.violations, ...plan.violations];
  return {
    violations,
    notes: violations.map((v) => v.note),
    vacuous: !prose.graded && !plan.graded,
  };
}

// Read-only CLI front door; inert on import.
if (import.meta.main) {
  const projectRoot = process.argv[2] || process.cwd();
  const report = runMilestoneNameUnaskedProbe(projectRoot);
  if (report.violations.length > 0) {
    console.log(report.violations.map((v) => v.message).join("\n\n"));
    process.exit(1);
  }
}
