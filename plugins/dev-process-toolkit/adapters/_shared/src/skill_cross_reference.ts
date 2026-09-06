// skill_cross_reference — readers that grade what one skill says about another.
//
// WHY THIS MODULE EXISTS (M_645517). A skill describing its OWN behaviour is
// graded by its own tests. A skill describing a SIBLING's behaviour is graded
// by nothing, and a documentation audit of v2.80.3 found seven such statements
// wrong at once — one of them a shipped bug: `/ship-milestone` step 5 invoked
// `/docs --commit --full`, a flag pair `/docs` refuses as mutually exclusive
// and whose non-zero exit `/ship-milestone` treats as a hard abort. This repo
// never noticed because both of its docs modes are `false`, so the step is
// skipped; every consumer with a docs mode on hit it on every release.
//
// THE METHOD, and the reason a corrected sentence would not have been enough:
// every reader here takes the CLAIM from the citing file and the TRUTH from
// the cited one. Neither side can be edited into agreement with a stale
// private copy, and a change on the cited side reds just as loudly as a
// change on the citing side. A checker holding its own list of flags would be
// a spelling check; a checker deriving the list from `/docs` is an agreement
// check, and only the second one survives `/docs` growing a fourth flag.

/** One statement a caller makes about a sibling that the sibling contradicts. */
export interface CrossReferenceViolation {
  /** Repo-root-relative path of the CITING file, POSIX separators. */
  file: string;
  /** 1-indexed line of the offending statement. */
  line: number;
  /** The invocation form exactly as the citing file states it. */
  invocation: string;
  /** Which rule fired. */
  rule:
    | "mutually_exclusive_flags"
    | "fork_capability"
    | "remedy_untypeable";
  /** Human-readable statement of the disagreement. */
  reason: string;
}

// ---------------------------------------------------------------------------
// Deriving the exclusive flag set from the cited skill's own body
// ---------------------------------------------------------------------------

/**
 * The flags a skill documents as mutually exclusive, read out of its own body.
 *
 * Anchored on the NFR-10 refusal the skill emits rather than on its prose
 * bullets: the refusal is the sentence the skill is CONTRACTUALLY committed to
 * (a test pins it), while the prose above it is free to be reworded. Shape:
 *
 *   flags --quick, --commit, and --full are mutually exclusive; got <list>.
 *
 * Returns the flags in the order stated, deduplicated. An empty array means
 * the skill documents no exclusivity — callers MUST treat that as "no rule to
 * enforce" rather than as "nothing is excluded", which is why
 * `checkMutuallyExclusiveFlagUse` refuses to grade against an empty set.
 */
export function extractExclusiveFlags(citedSkillBody: string): string[] {
  const out: string[] = [];
  for (const line of citedSkillBody.split("\n")) {
    // `\*{0,2}` tolerates the bolded prose form (`are **mutually exclusive**`)
    // alongside the plain refusal form, so a reworded emphasis does not
    // silently empty the set and disarm the whole check.
    const m = /flags\s+(.+?)\s+are\s+\*{0,2}mutually exclusive/i.exec(line);
    if (m === null) continue;
    for (const flag of m[1]!.matchAll(/--[a-z][a-z0-9-]*/g)) {
      if (!out.includes(flag[0])) out.push(flag[0]);
    }
    if (out.length > 0) break; // first stated rule wins
  }
  return out;
}

// ---------------------------------------------------------------------------
// Extracting the invocation forms a citing file states
// ---------------------------------------------------------------------------

/** One `/<skill> <flags…>` form as some file states it. */
export interface StatedInvocation {
  line: number;
  /** The matched text, e.g. `/docs --commit --full`. */
  raw: string;
  flags: string[];
}

/**
 * Every `/<skillName> --flag [--flag…]` form a body states.
 *
 * Matches inside backticks, headings and fenced blocks alike — a heading that
 * names a refused invocation misdirects a reader exactly as much as a run
 * instruction does, and the shipped defect stated its form in seven places of
 * which only one was an instruction.
 *
 * Flagless mentions (`/docs`) are not returned: this reader grades FLAG USE,
 * and a bare mention makes no claim about flags.
 */
export function extractStatedInvocations(
  body: string,
  skillName: string,
): StatedInvocation[] {
  const out: StatedInvocation[] = [];
  // The skill name is interpolated into a pattern, so anything that is not a
  // plain identifier is refused rather than compiled — a caller passing user
  // text must not be able to widen the match.
  if (!/^[a-z][a-z0-9-]*$/.test(skillName)) {
    throw new Error(`extractStatedInvocations: unusable skill name ${skillName}`);
  }
  const re = new RegExp(`/${skillName}((?:\\s+--[a-z][a-z0-9-]*)+)`, "g");
  for (const [idx, line] of body.split("\n").entries()) {
    for (const m of line.matchAll(re)) {
      out.push({
        line: idx + 1,
        raw: m[0]!,
        flags: [...m[1]!.matchAll(/--[a-z][a-z0-9-]*/g)].map((f) => f[0]),
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The agreement check
// ---------------------------------------------------------------------------

export interface MutuallyExclusiveFlagCheck {
  /** Body of the skill being CITED (the one that owns the exclusivity rule). */
  citedSkillBody: string;
  /** Bare name of the cited skill, e.g. `docs`. */
  citedSkillName: string;
  /** Body of the skill doing the CITING. */
  citingBody: string;
  /** Repo-root-relative path of the citing file, for the violation row. */
  citingFile: string;
}

/**
 * Report every invocation the citing file states that the cited skill refuses.
 *
 * THROWS when the cited body documents no exclusivity rule. A silently empty
 * rule set is the failure mode this whole module exists to prevent: it would
 * return zero violations, read as green, and mean nothing. If `/docs` ever
 * stops documenting the rule, this must be a loud error demanding a decision,
 * not a check that quietly stops checking.
 */
export function checkMutuallyExclusiveFlagUse(
  input: MutuallyExclusiveFlagCheck,
): CrossReferenceViolation[] {
  const exclusive = extractExclusiveFlags(input.citedSkillBody);
  if (exclusive.length < 2) {
    throw new Error(
      `checkMutuallyExclusiveFlagUse: /${input.citedSkillName} documents no ` +
        `mutually-exclusive flag rule (found ${exclusive.length}); refusing to ` +
        "grade against an empty rule set",
    );
  }
  const out: CrossReferenceViolation[] = [];
  for (const inv of extractStatedInvocations(input.citingBody, input.citedSkillName)) {
    const hit = inv.flags.filter((f) => exclusive.includes(f));
    if (hit.length < 2) continue;
    out.push({
      file: input.citingFile,
      line: inv.line,
      invocation: inv.raw,
      rule: "mutually_exclusive_flags",
      reason:
        `states \`${inv.raw}\`, but /${input.citedSkillName} refuses ` +
        `${hit.join(" + ")} as mutually exclusive and exits non-zero`,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Fork capability — what an orchestrator claims its child can do
// ---------------------------------------------------------------------------

/**
 * The tool names an agent's frontmatter grants, e.g. `["Read","Grep","Glob"]`.
 *
 * Returns `null` — never `[]` — when no `tools:` line is present. An empty
 * array and an absent declaration mean opposite things (deny-all versus
 * inherit), and collapsing them would let a checker report "cannot run Bash"
 * about an agent whose toolset it simply failed to read.
 */
export function extractAgentTools(agentBody: string): string[] | null {
  const m = /^tools:[ \t]*(.+)$/m.exec(agentBody.split(/^---\s*$/m)[1] ?? "");
  if (m === null) return null;
  return m[1]!
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** One capability an orchestrator's prose implies its fork has. */
export interface ClaimedForkCapability {
  /** Regex over the orchestrator body that spots the claim. */
  claim: RegExp;
  /** The tool the claim requires the fork to hold. */
  requires: string;
  /** What the claim reads as, for the violation row. */
  description: string;
}

/**
 * Claims that only a fork holding a particular tool could satisfy.
 *
 * Kept to what a TOOL makes possible, never to phrasing. "Confirms GREEN
 * before classifying" is a claim about running the test command, and running
 * anything needs `Bash`; how the sentence is worded is not the checker's
 * business.
 */
export const FORK_CAPABILITY_CLAIMS: readonly ClaimedForkCapability[] = [
  {
    claim: /so (?:it|the fork) can confirm (?:the FR is still )?GREEN/i,
    requires: "Bash",
    description: "claims the fork runs the test command to confirm GREEN",
  },
  {
    claim: /the fork (?:runs|executes) [^\n.]*\b(?:test|gate|command)\b/i,
    requires: "Bash",
    description: "claims the fork runs a command",
  },
];

export interface ForkCapabilityCheck {
  /** Body of the ORCHESTRATOR making the claim. */
  orchestratorBody: string;
  /** Repo-relative path of the orchestrator, for the violation row. */
  orchestratorFile: string;
  /** Body of the agent definition the fork is paired with. */
  agentBody: string;
  /** The agent's name, for the violation row. */
  agentName: string;
}

/**
 * Report every capability an orchestrator claims that its fork's toolset denies.
 *
 * THROWS when the agent declares no toolset. This check exists because two
 * orchestrators claimed a capability their child contradicted two lines below
 * the claim in its own file; a checker that silently passes on an unreadable
 * toolset reproduces exactly that — an answer with nothing behind it.
 *
 * The check reads BOTH directions by construction: granting the fork `Bash`
 * would make the claim true and silence this just as surely as removing the
 * claim would, which is what makes it a contract rather than a spell-check.
 */
export function checkForkCapabilityClaims(
  input: ForkCapabilityCheck,
): CrossReferenceViolation[] {
  const tools = extractAgentTools(input.agentBody);
  if (tools === null) {
    throw new Error(
      `checkForkCapabilityClaims: agent ${input.agentName} declares no \`tools:\` ` +
        "line; refusing to grade a claim against a toolset it could not read",
    );
  }
  const out: CrossReferenceViolation[] = [];
  const lines = input.orchestratorBody.split("\n");
  for (const spec of FORK_CAPABILITY_CLAIMS) {
    for (const [idx, line] of lines.entries()) {
      if (!spec.claim.test(line)) continue;
      if (tools.includes(spec.requires)) continue;
      out.push({
        file: input.orchestratorFile,
        line: idx + 1,
        invocation: line.trim(),
        rule: "fork_capability",
        reason:
          `${spec.description}, but \`${input.agentName}\` grants only ` +
          `${tools.join(", ")} — no \`${spec.requires}\`, so the fork cannot run anything`,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Remedy typeability — can whoever reads this actually type it?
// ---------------------------------------------------------------------------

/** A `/dev-process-toolkit:<name>` reference inside a remedy or hint literal. */
const SKILL_REFERENCE_RE = /\/dev-process-toolkit:([a-z][a-z0-9-]*)/g;

/**
 * The caveat a remedy must carry when it names a skill the operator cannot type.
 *
 * One literal, shared, so the two constants that need it cannot each carry
 * their own wording and drift apart — which is the state STE-570 found them in.
 */
export const NOT_ON_MENU_CAVEAT = "it is not on the slash menu";

export interface RemedyTypeabilityCheck {
  /** The remedy or hint literal, exactly as it ships. */
  literal: string;
  /** Where it lives, for the violation row. */
  file: string;
  line: number;
  /** Skill name → is it user-invocable? Read from frontmatter by the caller. */
  userInvocable: ReadonlyMap<string, boolean>;
}

/**
 * Report every remedy that tells an operator to run a skill they cannot type.
 *
 * `/upgrade` is real, useful and deliberately off the slash menu — Claude
 * invokes it, and probe #69 is its discovery path. The defect is not that the
 * remedy names it; it is that one sibling literal says so and the other does
 * not, so an operator following the second one hunts for a menu entry that was
 * never there.
 *
 * A skill the map does not know is SKIPPED rather than reported: an unknown
 * name means the caller could not read its frontmatter, and inventing a
 * verdict from that is the failure mode this module is built against.
 */
export function checkRemedyTypeability(
  input: RemedyTypeabilityCheck,
): CrossReferenceViolation[] {
  const out: CrossReferenceViolation[] = [];
  for (const m of input.literal.matchAll(SKILL_REFERENCE_RE)) {
    const name = m[1]!;
    const invocable = input.userInvocable.get(name);
    if (invocable !== false) continue;
    if (input.literal.includes(NOT_ON_MENU_CAVEAT)) continue;
    out.push({
      file: input.file,
      line: input.line,
      invocation: m[0],
      rule: "remedy_untypeable",
      reason:
        `names /dev-process-toolkit:${name}, which carries \`user-invocable: false\`, ` +
        `without the caveat "${NOT_ON_MENU_CAVEAT}" — the operator cannot type it`,
    });
  }
  return out;
}
