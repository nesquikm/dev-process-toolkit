// M120 STE-444 — correct the contradictory Jira milestone-binding prose.
//
// In this toolkit the prose IS the program: a model reading a SKILL.md executes
// what it says. Two shipped lines say things the code does not do.
//
//   1. `skills/spec-write/SKILL.md`, the `**Milestone attachment (...)**`
//      paragraph, ends the attach instruction with an UNCONDITIONAL two-way
//      split: "Linear binds the native project milestone, Jira read-merge-writes
//      the `milestone-<M-token>` label". The same file's § Milestone-number
//      allocation guard describes a Jira Epic-FIRST path. A run meets the
//      unconditional sentence at the moment it acts, so the label claim wins.
//
//   2. `skills/gate-check/SKILL.md`, probe #26's row, carries two independent
//      false statements inside one sentence:
//        (a) it claims `deps.milestoneBinding` is "wired in production from the
//            active adapter's `milestone_binding:` Schema M frontmatter".
//            VERIFIED GROUND TRUTH: no TypeScript anywhere parses
//            `milestone_binding`. The only production occurrence of that key is
//            `adapters/jira.md`'s OWN frontmatter (`milestone_binding: epic`),
//            which nothing reads. The value reaches the probe as a field on the
//            caller-supplied deps object
//            (`tracker_project_milestone_attached.ts`, `milestoneBinding?:`).
//        (b) it enumerates TWO binding kinds — `object` and `label`. The code
//            handles THREE: `"object" | "label" | "epic"`, in both
//            `tracker_project_milestone_attached.ts` and
//            `assert_milestone_binding_at_archive.ts`. The omitted `epic` arm is
//            the very arm Jira takes.
//
// AC map (RED = fails against the pre-change files; GUARD = passes on both
// sides by design, pinning what must NOT move):
//   AC-STE-444.1 — spec-write's attach paragraph stops asserting the label
//                  binding unconditionally and defers to the binding kind. RED.
//   AC-STE-444.2 — probe #26's row stops claiming frontmatter wiring. RED.
//   AC-STE-444.3 — that row enumerates all three kinds the code handles,
//                  pinned against the union type itself, not a hardcoded list.
//                  RED.
//   AC-STE-444.4 — the falsifiability proof: the SAME predicates, run against
//                  the genuine PRE-CHANGE bytes, must report the defect. Without
//                  this an absence-pin that never could have failed looks
//                  identical to one that did.
//   AC-STE-444.5 — budget: both files' line caps, the skills/ STE-token ceiling,
//                  and per-file STE-token counts. GUARD (fires only if the
//                  implementer spends bytes it does not have).
//   AC-STE-444.6 — the surrounding suite stays green. Scoped to the test files
//                  that actually READ the edited prose — for an edit confined to
//                  two lines of two .md files that set is the complete
//                  regression surface. GUARD.
//
// SCOPING DISCIPLINE (this repo has been burned by it before): every assertion
// below is scoped to the single located line it pins — spec-write's paragraph by
// its `**Milestone attachment (` anchor, gate-check's row by its own leading
// `26. ` list marker. A whole-file substring search would be satisfied (or
// tripped) by unrelated prose: `docs/tracker-adapters.md` and `adapters/jira.md`
// legitimately describe the read-merge-write label path, and four captured
// NDJSON fixtures under `tests/fixtures/socratic-first-turn/` contain the
// pre-change sentence verbatim as a recording. None of those may be edited, and
// none of them may satisfy a pin meant for a SKILL line.
//
// OUT OF SCOPE, noted not pinned: the JSDoc above `milestoneBinding?:` in
// `adapters/_shared/src/tracker_project_milestone_attached.ts` repeats defect
// 2(a) ("In production the gate wires this from the active adapter's
// `milestone_binding:` frontmatter"). This FR's ACs name only the two SKILL
// files, so no assertion here requires that comment to change.

import { describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const TESTS_DIR = import.meta.dir;
const SELF = basename(import.meta.path);

const SKILLS_DIR = join(PLUGIN_ROOT, "skills");
const SPEC_WRITE_SKILL = join(SKILLS_DIR, "spec-write", "SKILL.md");
const GATE_CHECK_SKILL = join(SKILLS_DIR, "gate-check", "SKILL.md");
const PROBE_SRC = join(
  PLUGIN_ROOT,
  "adapters",
  "_shared",
  "src",
  "tracker_project_milestone_attached.ts",
);
const ARCHIVE_ASSERT_SRC = join(
  PLUGIN_ROOT,
  "adapters",
  "_shared",
  "src",
  "assert_milestone_binding_at_archive.ts",
);

const read = (path: string): string => readFileSync(path, "utf-8");

// ───────────────────────────────────────────────────────────────────────────
// Recorded PRE-CHANGE bytes (AC-STE-444.4)
//
// Two sources, in preference order:
//   * the pinned commit's blob, read through `git show` — the genuine bytes,
//     immune to transcription error;
//   * the RECORDED_* constants below — verbatim copies, machine-generated from
//     the working tree at that same commit, used when the blob is unreachable
//     (shallow clone, exported tarball, non-repo checkout).
//
// `fidelity` below asserts the two agree whenever both are available, so a
// constant that drifts from what actually shipped is caught rather than
// silently becoming the only witness.
// ───────────────────────────────────────────────────────────────────────────

/** `chore(specs): write FRs STE-443/444 (M120)` — the commit this FR edits. */
const PINNED_PRE_CHANGE_COMMIT = "0822bb47152d3ffbb7eb064f686f12dfb63b5976";

const RECORDED_PRE_CHANGE_SPEC_WRITE_PARAGRAPH =
  "   **Milestone attachment (any adapter with `project_milestone: true` — Linear + Jira).** After `Provider.sync(spec)` returns the freshly-allocated tracker ID, read the FR's `milestone:` frontmatter and call `planFileHeadingToMilestoneName(specs/plan/<milestone>.md)` from `adapters/_shared/src/attach_project_milestone.ts` to derive the canonical milestone name (anchor stripped). **The created name is em-dash canonical.** The name passed to the milestone create/attach call MUST be the em-dash-normalized form `M<N> — <Title>`; the colon form `M<N>: <Title>` is **forbidden at milestone-create time** — never hand-format the name by eyeballing the plan-file heading, and MUST NOT emit a colon separator even when the plan file's own heading still carries one (legacy plans do; the parser canonicalizes them). `parsePlanHeading` (`adapters/_shared/src/plan_heading.ts`) is the **single source of truth** for the canonical shape — the create side above and `/gate-check` probe #26 both byte-compare against its output, so a colon-separated created name lands one character off and turns probe #26 red on an otherwise-clean chain. Then call `attachProjectMilestone(provider, project, canonicalName, ticketId)` to bind the ticket — Linear binds the native project milestone, Jira read-merge-writes the `milestone-<M-token>` label. Transient/network failures retry on the canonical `1s + 2s + 4s` backoff inside the helper; a **permanent** failure (retries exhausted, or a non-transient binding mismatch) surfaces as `MilestoneAttachmentError` (NFR-10 canonical shape) and the Step 7 closing summary MUST emit `milestone_attach_failed` as a **loud** warning-severity capability row (never a plain informational line) — the FR file is not rolled back since the spec is the source of truth. **Capability outcome routing (STE-198):** `attachProjectMilestone` returns `{ capability, createdName? }`. Branch on `result.capability` — `null` ⇒ no row; `\"milestone_create_required\"` ⇒ helper auto-created via `mcp__linear__save_milestone` (same auth scope as the prior `save_issue`, no extra prompt) — surface the row naming `result.createdName`; `\"milestone_attach_skipped_adapter_limit\"` ⇒ adapter Schema M `project_milestone: false` short-circuited the call. Vacuous on `mode: none`.";

const RECORDED_PRE_CHANGE_PROBE_26_ROW =
  "26. **`tracker-project-milestone-attached`** — call `runTrackerProjectMilestoneAttachedProbe(projectRoot, deps)` from `adapters/_shared/src/tracker_project_milestone_attached.ts`. For each `status: active` FR with a tracker block, fetch the issue via `deps.getIssue(<ticket-id>)` and verify the milestone landed on the ticket. The verification surface is **adapter-aware**, selected by `deps.milestoneBinding` (wired in production from the active adapter's `milestone_binding:` Schema M frontmatter; defaults to `object` when absent): the **`object` binding** (Linear; `mcp__linear__get_issue`) asserts the issue's `projectMilestone.name` byte-equals the canonical local heading (parsed from `specs/plan/M<N>.md`'s H1, anchor stripped); the **`label` binding** (Jira; `mcp__atlassian__getJiraIssue`) asserts the issue's `labels` array contains `milestone-<M-token>` (the leading milestone token of that same canonical heading — numeric `M<N>` or Epic-keyed `M_<epic-key>` per the union grammar) — labels are Jira's create-on-write milestone surface, since the atlassian MCP exposes no milestone object. Vacuous when `mode: none`, the FR is archived, the FR has no tracker block, or the plan file is missing (probe #27 owns that diagnostic). Missing or mismatched binding (object: name mismatch; label: the expected `milestone-<M-token>` absent) → **GATE FAILED** rendering the offending names/labels byte-by-byte (em-dash drift visible) plus NFR-10 remedy pointing at `/spec-write --rename-milestone M<N>` for the rename-on-mismatch escape hatch.";

// ───────────────────────────────────────────────────────────────────────────
// Scoped locators — one line each, never a whole-file search
// ───────────────────────────────────────────────────────────────────────────

/** Stable anchor for spec-write's milestone-attachment paragraph. */
const MILESTONE_ATTACH_ANCHOR = "**Milestone attachment (";

/** probe #26's own ordered-list marker in gate-check's probe table. */
const PROBE_26_MARKER = /^26\. /;

function soleLine(body: string, match: (line: string) => boolean, what: string): string {
  const hits = body.split("\n").filter(match);
  expect(hits.length, `expected exactly one ${what}; found ${hits.length}`).toBe(1);
  return hits[0]!;
}

function milestoneAttachmentParagraph(): string {
  return soleLine(
    read(SPEC_WRITE_SKILL),
    (l) => l.includes(MILESTONE_ATTACH_ANCHOR),
    `line carrying the \`${MILESTONE_ATTACH_ANCHOR}\` anchor in skills/spec-write/SKILL.md`,
  );
}

function probe26Row(): string {
  return soleLine(
    read(GATE_CHECK_SKILL),
    (l) => PROBE_26_MARKER.test(l),
    "probe #26 row (a line starting `26. `) in skills/gate-check/SKILL.md",
  );
}

function preChangeBlob(repoRelPath: string): string | null {
  try {
    return execFileSync("git", ["show", `${PINNED_PRE_CHANGE_COMMIT}:${repoRelPath}`], {
      cwd: REPO_ROOT,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

function preChangeMilestoneAttachmentParagraph(): string {
  const blob = preChangeBlob("plugins/dev-process-toolkit/skills/spec-write/SKILL.md");
  if (blob === null) return RECORDED_PRE_CHANGE_SPEC_WRITE_PARAGRAPH;
  return soleLine(
    blob,
    (l) => l.includes(MILESTONE_ATTACH_ANCHOR),
    "pre-change milestone-attachment paragraph",
  );
}

function preChangeProbe26Row(): string {
  const blob = preChangeBlob("plugins/dev-process-toolkit/skills/gate-check/SKILL.md");
  if (blob === null) return RECORDED_PRE_CHANGE_PROBE_26_ROW;
  return soleLine(blob, (l) => PROBE_26_MARKER.test(l), "pre-change probe #26 row");
}

// ───────────────────────────────────────────────────────────────────────────
// Predicates — deliberately shared between the LIVE text and the PRE-CHANGE
// text. One implementation, two inputs, opposite expected verdicts. That is the
// whole falsifiability argument: a predicate that cannot report `true` on the
// pre-change bytes is not pinning anything.
// ───────────────────────────────────────────────────────────────────────────

/** Does the text defer the binding decision to the binding kind at all? */
function defersToBindingKind(text: string): boolean {
  return (
    /\bbinding kind\b/i.test(text) ||
    /milestone_binding/.test(text) ||
    /\bepic\b/i.test(text)
  );
}

/**
 * Does the text assert the Jira→label binding with no binding-kind qualifier?
 *
 * Two clauses, both required. A rewrite that keeps the label path but qualifies
 * it ("...when the binding is `label`...") is correct and must NOT trip this;
 * a rewrite that merely deletes the clause is caught by the separate
 * `defersToBindingKind` assertion, not by this one.
 */
function statesLabelBindingUnconditionally(text: string): boolean {
  const claimsLabelBinding =
    /read-merge-write/i.test(text) || /`milestone-<M-token>` label/.test(text);
  return claimsLabelBinding && !defersToBindingKind(text);
}

/** Does the text claim the binding value is sourced from adapter frontmatter? */
function claimsFrontmatterSourcedBinding(text: string): boolean {
  return (
    /\bwired in production\b/i.test(text) ||
    /\b(wired|read|sourced|derived|supplied|comes|taken)\b[^.]*\bfrontmatter\b/i.test(text)
  );
}

/** The binding kinds a piece of prose names, as `` `kind` binding `` phrases. */
function bindingKindsNamed(text: string): string[] {
  const kinds = [...text.matchAll(/`([a-z]+)` binding/g)].map((m) => m[1]!);
  return [...new Set(kinds)].sort();
}

/** Every `STE-<N>` / `AC-STE-<N>` token in a piece of text, in order. */
function steTokens(text: string): string[] {
  return text.match(/\b(?:AC-)?STE-\d+(?:\.\d+)?\b/g) ?? [];
}

/** The binding-kind union as declared by the code, extracted per declaration. */
function unionsIn(source: string): string[][] {
  const unions = [...source.matchAll(/"(?:object|label|epic)"(?:\s*\|\s*"[a-z]+")+/g)];
  return unions.map((u) => [...new Set([...u[0]!.matchAll(/"([a-z]+)"/g)].map((m) => m[1]!))].sort());
}

function codeBindingKinds(): string[] {
  const decl = read(PROBE_SRC).match(/milestoneBinding\?\s*:\s*([^;]+);/);
  expect(
    decl,
    "expected a `milestoneBinding?: ...` declaration on the probe's deps interface",
  ).not.toBeNull();
  const kinds = [...new Set([...decl![1]!.matchAll(/"([a-z]+)"/g)].map((m) => m[1]!))].sort();
  expect(kinds.length, "expected the deps union to name at least one binding kind").toBeGreaterThan(
    0,
  );
  return kinds;
}

// ───────────────────────────────────────────────────────────────────────────
// Anchors resolve uniquely — the precondition every pin below rests on
// ───────────────────────────────────────────────────────────────────────────

describe("scoping — each pin addresses exactly one located line", () => {
  test("GUARD — the spec-write anchor resolves to a single line", () => {
    const p = milestoneAttachmentParagraph();
    expect(p).toContain(MILESTONE_ATTACH_ANCHOR);
    expect(p).toContain("project_milestone: true");
  });

  test("GUARD — probe #26's `26. ` marker resolves to a single row", () => {
    const r = probe26Row();
    expect(r).toContain("`tracker-project-milestone-attached`");
    expect(r).toContain("runTrackerProjectMilestoneAttachedProbe(projectRoot, deps)");
  });

  test("GUARD — the pins are line-scoped, so the untouchable surfaces cannot satisfy them", () => {
    // `docs/tracker-adapters.md` and `adapters/jira.md` describe the label path
    // on purpose and are pinned there by `ste-329-skill-and-docs-conformance`.
    // A whole-file or whole-repo grep for the label sentence would collide with
    // them; these two assertions prove the located lines are the only inputs.
    expect(milestoneAttachmentParagraph()).not.toContain("editJiraIssue read-merge-write");
    expect(probe26Row()).not.toContain("| Jira    |");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// AC-STE-444.1 — spec-write no longer asserts the label binding unconditionally
// ───────────────────────────────────────────────────────────────────────────

describe("AC-STE-444.1 — the attach instruction defers to the binding kind", () => {
  test("RED — the unconditional Linear/Jira split is gone verbatim", () => {
    expect(milestoneAttachmentParagraph()).not.toContain(
      "Linear binds the native project milestone, Jira read-merge-writes the `milestone-<M-token>` label",
    );
  });

  test("RED — no unqualified Jira→label claim survives, in any wording", () => {
    expect(
      statesLabelBindingUnconditionally(milestoneAttachmentParagraph()),
      "the attach paragraph still claims the label binding without deferring to the binding kind",
    ).toBe(false);
  });

  test("RED — the paragraph names the binding kind rather than deleting the clause", () => {
    // Without this, `statesLabelBindingUnconditionally` could be satisfied by
    // simply deleting the sentence, which loses the instruction instead of
    // correcting it.
    expect(
      defersToBindingKind(milestoneAttachmentParagraph()),
      "the attach paragraph names no binding kind at all — deletion is not deference",
    ).toBe(true);
  });

  test("GUARD — the attach call itself is still instructed", () => {
    expect(milestoneAttachmentParagraph()).toContain(
      "attachProjectMilestone(provider, project, canonicalName, ticketId)",
    );
  });

  test("GUARD — the Epic-first path this line contradicted is still described", () => {
    // The contradiction must be resolved by fixing the attach line, never by
    // deleting the allocation guard's Jira Epic-first branch.
    const body = read(SPEC_WRITE_SKILL);
    expect(body).toContain("**Jira Epic-first branch");
    expect(body).toContain("milestoneIdFromEpicKey");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// AC-STE-444.2 — probe #26's row no longer claims frontmatter wiring
// ───────────────────────────────────────────────────────────────────────────

describe("AC-STE-444.2 — the false wiring claim is gone from probe #26's row", () => {
  test("RED — the row no longer says the binding is `wired in production`", () => {
    expect(probe26Row()).not.toMatch(/\bwired in production\b/i);
  });

  test("RED — the row no longer sources the binding from adapter frontmatter", () => {
    expect(
      claimsFrontmatterSourcedBinding(probe26Row()),
      "probe #26's row still attributes the binding value to frontmatter no parser reads",
    ).toBe(false);
  });

  test("RED — the frontmatter-key notation `milestone_binding:` is gone from the row", () => {
    // The snake-cased, colon-suffixed form is the frontmatter KEY. The field the
    // probe actually reads is camelCase on the deps object; only the key form
    // implies a parser that does not exist.
    expect(probe26Row()).not.toContain("`milestone_binding:`");
    expect(probe26Row()).not.toContain("Schema M frontmatter");
  });

  test("GUARD — the real source, the deps object field, is still named", () => {
    expect(probe26Row()).toContain("deps.milestoneBinding");
  });

  test("GUARD — no TypeScript parses `milestone_binding`, which is why the claim was false", () => {
    // The ground truth the AC rests on, asserted rather than assumed.
    //
    // Two false-positive traps this had to be written around, both real in this
    // tree: (1) `assert_milestone_binding_at_archive.ts` carries the key as a
    // substring of its own MODULE NAME, so a bare `milestone_binding` search
    // flags a file that never reads it; (2) the probe module's JSDoc repeats the
    // false claim in prose. Neither is a parser. What a parser looks like is the
    // KEY form — `milestone_binding:` — or the quoted identifier, in code.
    const KEY_READ = /milestone_binding\s*:|["'`]milestone_binding["'`]/;
    const stripComments = (src: string): string =>
      src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

    const tsFiles: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        if (name === "node_modules") continue;
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
          walk(p);
          continue;
        }
        if (name.endsWith(".ts")) tsFiles.push(p);
      }
    };
    walk(join(PLUGIN_ROOT, "adapters"));
    expect(tsFiles.length, "expected TypeScript sources under adapters/").toBeGreaterThan(50);

    for (const f of tsFiles) {
      expect(
        KEY_READ.test(stripComments(read(f))),
        `${f} appears to read the \`milestone_binding\` key — the gate-check row's wiring claim would then be TRUE and this FR's premise wrong`,
      ).toBe(false);
    }

    // The one place the key genuinely lives: an adapter's own frontmatter, read
    // by nothing.
    expect(read(join(PLUGIN_ROOT, "adapters", "jira.md"))).toMatch(
      /^milestone_binding:\s*epic\s*$/m,
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────
// AC-STE-444.3 — the row enumerates all three kinds the code handles
// ───────────────────────────────────────────────────────────────────────────

describe("AC-STE-444.3 — probe #26's row enumerates object, label AND epic", () => {
  test("GUARD — the code's ground-truth union is exactly these three kinds", () => {
    expect(codeBindingKinds()).toEqual(["epic", "label", "object"]);
  });

  test("GUARD — the archival assertion helper declares the same three kinds", () => {
    // Cross-checks that "three kinds" is the module-wide contract, not a stray
    // union in one file.
    const unions = unionsIn(read(ARCHIVE_ASSERT_SRC));
    expect(unions.length, "expected at least one binding union in the archive helper").toBeGreaterThan(
      0,
    );
    for (const u of unions) expect(u).toEqual(["epic", "label", "object"]);
  });

  test("RED — the row names the `epic` binding", () => {
    expect(probe26Row()).toContain("`epic` binding");
  });

  test("RED — the row's enumeration matches the code's union exactly", () => {
    // Pinned against the union type rather than a hardcoded list, so a fourth
    // binding kind added to the code turns this red instead of passing quietly.
    expect(bindingKindsNamed(probe26Row())).toEqual(codeBindingKinds());
  });

  test("GUARD — the two kinds already documented are not lost in the rewrite", () => {
    const r = probe26Row();
    expect(r).toContain("`object` binding");
    expect(r).toContain("`label` binding");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// AC-STE-444.4 — falsifiability: the same predicates, the pre-change bytes
// ───────────────────────────────────────────────────────────────────────────

describe("AC-STE-444.4 — every correction above is pinned by a falsifiable assertion", () => {
  test("fidelity — the recorded constants match the pinned commit's blobs", () => {
    const swBlob = preChangeBlob("plugins/dev-process-toolkit/skills/spec-write/SKILL.md");
    const gcBlob = preChangeBlob("plugins/dev-process-toolkit/skills/gate-check/SKILL.md");
    if (swBlob === null || gcBlob === null) {
      // Shallow clone / exported tree: the constants are the only witness, so
      // assert they are at least non-degenerate rather than silently trusting.
      expect(RECORDED_PRE_CHANGE_SPEC_WRITE_PARAGRAPH.length).toBeGreaterThan(500);
      expect(RECORDED_PRE_CHANGE_PROBE_26_ROW.length).toBeGreaterThan(500);
      return;
    }
    expect(
      soleLine(swBlob, (l) => l.includes(MILESTONE_ATTACH_ANCHOR), "pre-change attach paragraph"),
    ).toBe(RECORDED_PRE_CHANGE_SPEC_WRITE_PARAGRAPH);
    expect(soleLine(gcBlob, (l) => PROBE_26_MARKER.test(l), "pre-change probe #26 row")).toBe(
      RECORDED_PRE_CHANGE_PROBE_26_ROW,
    );
  });

  test("pin 1 would have failed: the pre-change paragraph DOES state the label binding unconditionally", () => {
    const pre = preChangeMilestoneAttachmentParagraph();
    expect(pre).toContain(
      "Linear binds the native project milestone, Jira read-merge-writes the `milestone-<M-token>` label",
    );
    expect(statesLabelBindingUnconditionally(pre)).toBe(true);
    expect(defersToBindingKind(pre)).toBe(false);
  });

  test("pin 2 would have failed: the pre-change row DOES claim frontmatter wiring", () => {
    const pre = preChangeProbe26Row();
    expect(pre).toMatch(/\bwired in production\b/i);
    expect(pre).toContain("`milestone_binding:`");
    expect(pre).toContain("Schema M frontmatter");
    expect(claimsFrontmatterSourcedBinding(pre)).toBe(true);
  });

  test("pin 3 would have failed: the pre-change row names only two of the three kinds", () => {
    const pre = preChangeProbe26Row();
    expect(bindingKindsNamed(pre)).toEqual(["label", "object"]);
    expect(pre).not.toContain("`epic` binding");
    expect(bindingKindsNamed(pre)).not.toEqual(codeBindingKinds());
  });

  test("RED — the pre-change and post-change texts are genuinely different at each pin", () => {
    // Closes the degenerate case where the blob lookup and the live read return
    // the same bytes — which would make every assertion above vacuously
    // self-consistent.
    expect(milestoneAttachmentParagraph()).not.toBe(preChangeMilestoneAttachmentParagraph());
    expect(probe26Row()).not.toBe(preChangeProbe26Row());
  });
});

// ───────────────────────────────────────────────────────────────────────────
// AC-STE-444.5 — budget: zero line headroom, zero token headroom
// ───────────────────────────────────────────────────────────────────────────

describe("AC-STE-444.5 — the correction is a byte-trade, not an expansion", () => {
  const SPEC_WRITE_LINE_CAP = 358;
  // NFR-1 is 358; this pin read 354 (a superseded value) until
  // M_8f8e25/STE-558 repointed it at the one contract.
  const GATE_CHECK_LINE_CAP = 358;
  const SKILLS_STE_TOKEN_CEILING = 246;
  // Per-file counts recorded at the pinned pre-change commit.
  const SPEC_WRITE_STE_TOKENS_BEFORE = 55;
  const GATE_CHECK_STE_TOKENS_BEFORE = 87;

  test(`skills/spec-write/SKILL.md stays within its ${SPEC_WRITE_LINE_CAP}-line cap`, () => {
    // Sits AT the cap with zero headroom; a single added line breaches it.
    expect(read(SPEC_WRITE_SKILL).split("\n").length).toBeLessThanOrEqual(SPEC_WRITE_LINE_CAP);
  });

  test(`skills/gate-check/SKILL.md stays within its ${GATE_CHECK_LINE_CAP}-line cap`, () => {
    expect(read(GATE_CHECK_SKILL).split("\n").length).toBeLessThanOrEqual(GATE_CHECK_LINE_CAP);
  });

  test("neither edited line moves — the sharpest form of `no new lines`", () => {
    const swIdx = read(SPEC_WRITE_SKILL)
      .split("\n")
      .findIndex((l) => l.includes(MILESTONE_ATTACH_ANCHOR));
    const gcIdx = read(GATE_CHECK_SKILL)
      .split("\n")
      .findIndex((l) => PROBE_26_MARKER.test(l));
    expect(swIdx + 1, "the milestone-attachment paragraph moved off line 111").toBe(111);
    expect(gcIdx + 1, "probe #26's row moved off line 81").toBe(81);
  });

  test(`the skills/ STE-token ceiling (${SKILLS_STE_TOKEN_CEILING}) is not breached`, () => {
    let count = 0;
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
          walk(p);
          continue;
        }
        if (!name.endsWith(".md")) continue;
        count += steTokens(read(p)).length;
      }
    };
    walk(SKILLS_DIR);
    expect(count).toBeLessThanOrEqual(SKILLS_STE_TOKEN_CEILING);
  });

  test("neither edited file gains an STE-N token", () => {
    expect(steTokens(read(SPEC_WRITE_SKILL)).length).toBeLessThanOrEqual(
      SPEC_WRITE_STE_TOKENS_BEFORE,
    );
    expect(steTokens(read(GATE_CHECK_SKILL)).length).toBeLessThanOrEqual(
      GATE_CHECK_STE_TOKENS_BEFORE,
    );
  });

  test("neither edited LINE gains an STE-N token", () => {
    // The attach paragraph already carries exactly one (`STE-198`); probe #26's
    // row carries none. Both must stay put.
    expect(steTokens(milestoneAttachmentParagraph())).toEqual(["STE-198"]);
    expect(steTokens(probe26Row())).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// AC-STE-444.6 — the suite around the edit stays green
// ───────────────────────────────────────────────────────────────────────────

describe("AC-STE-444.6 — the prose edit breaks no test that reads the edited prose", () => {
  // For an edit confined to two lines of two .md files, a test can only observe
  // the change if it reads one of those files' milestone-attach prose. These
  // markers select exactly that surface; running it as a real subprocess is the
  // in-suite half of the whole-repo `bun test` the AC names (the whole-repo run
  // itself is the orchestrator's gate, not something a test can run on itself).
  const MARKERS = [
    "attachProjectMilestone",
    "Milestone attachment",
    "milestone_attach_failed",
    "milestone_create_required",
    "milestone_attach_skipped_adapter_limit",
    "tracker-project-milestone-attached",
    "milestoneBinding",
    "milestone-<M-token>",
    "read-merge-write",
    "milestone_binding",
  ];

  function atRiskTestFiles(): string[] {
    return readdirSync(TESTS_DIR)
      .filter((n) => n.endsWith(".test.ts") && n !== SELF)
      .filter((n) => {
        const body = read(join(TESTS_DIR, n));
        return MARKERS.some((m) => body.includes(m));
      })
      .sort();
  }

  test("the at-risk set is non-empty and contains the probe's own suites", () => {
    // A marker list that silently selected nothing would make the run below
    // vacuous — this is the guard against that.
    const files = atRiskTestFiles();
    expect(files.length).toBeGreaterThanOrEqual(8);
    expect(files).toContain("gate-check-tracker-project-milestone-attached.test.ts");
    expect(files).toContain("m101-ste-375-epic-milestone-binding.test.ts");
    expect(files).toContain("gate-check-probe-26-notes-scanner.test.ts");
    expect(files).not.toContain(SELF);
  });

  test(
    "every at-risk suite passes with zero failures after the edit",
    () => {
      const files = atRiskTestFiles().map((n) => join("tests", n));
      const run = spawnSync("bun", ["test", ...files], {
        cwd: PLUGIN_ROOT,
        encoding: "utf-8",
        maxBuffer: 16 * 1024 * 1024,
      });
      const combined = `${run.stdout ?? ""}${run.stderr ?? ""}`;
      expect(run.status, `at-risk subset went red:\n${combined.slice(-4000)}`).toBe(0);
      expect(combined, "bun test reported failures").toMatch(/\n\s*0 fail\b/);
      const ran = combined.match(/Ran (\d+) tests across (\d+) files/);
      expect(ran, `could not parse the runner summary:\n${combined.slice(-2000)}`).not.toBeNull();
      expect(Number(ran![1]), "the subset run executed suspiciously few tests").toBeGreaterThan(50);
      expect(Number(ran![2])).toBe(files.length);
    },
    60_000,
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// Requirement-scope pins — the surfaces beyond the AC-named two.
//
// STE-444's § Requirement is broader than its AC list: "No surface may
// describe Jira milestone binding as label-only where the epic path applies,
// and no surface may assert a wiring that does not exist." The ACs name two
// lines; the spec-review audit found the same two defects alive on five more
// surfaces. Those corrections landed with no pin, and an unpinned correction
// is exactly what this FR's own AC-4 rationale rejects — "a pin that passes
// both before and after is not a pin" generalises to "no pin at all".
//
// Each assertion below fails against the pre-change bytes of its own file.
// ═══════════════════════════════════════════════════════════════════════════

describe("Requirement scope — no surface asserts a wiring that does not exist", () => {
  const IMPLEMENT_SKILL = join(SKILLS_DIR, "implement", "SKILL.md");
  const SPEC_ARCHIVE_SKILL = join(SKILLS_DIR, "spec-archive", "SKILL.md");
  const TRACKER_ADAPTERS_DOC = join(PLUGIN_ROOT, "docs", "tracker-adapters.md");
  const PROBE_SRC = join(
    PLUGIN_ROOT,
    "adapters",
    "_shared",
    "src",
    "tracker_project_milestone_attached.ts",
  );

  test("no skill still states the unconditional Jira read-merge-writes-the-label claim", () => {
    // The byte-identical sentence lived in BOTH spec-write and implement; the
    // AC named only the first, so fixing it made /implement contradict
    // /spec-write on the same `attachProjectMilestone` call.
    for (const p of [SPEC_WRITE_SKILL, IMPLEMENT_SKILL]) {
      expect(read(p)).not.toContain(
        "Linear binds the native project milestone, Jira read-merge-writes the `milestone-<M-token>` label",
      );
    }
  });

  test("the probe's own JSDoc no longer sources the binding from adapter frontmatter", () => {
    // The SKILL row's false wiring claim had a twin in the source it documents.
    const src = read(PROBE_SRC);
    expect(src).not.toMatch(/wires\s+(?:this|it)\s+from\s+the\s+active\s+adapter/i);
    expect(src).toMatch(/supplied by the CALLER on this deps object/);
  });

  test("every milestone-binding enumeration names all three kinds the code handles", () => {
    // Same two-of-three defect AC-3 fixed on the gate-check row, surviving on
    // three more prose surfaces that describe the SAME helper.
    const enumerating = [
      { path: IMPLEMENT_SKILL, anchor: "assertMilestoneBindingAtArchive" },
      { path: SPEC_ARCHIVE_SKILL, anchor: "assertMilestoneBindingAtArchive" },
    ];
    for (const { path, anchor } of enumerating) {
      const line = read(path)
        .split("\n")
        .find((l) => l.includes(anchor) && l.includes("`object`"));
      expect(line, `no binding enumeration found in ${path}`).toBeDefined();
      for (const kind of ["object", "epic", "label"]) {
        expect(line!, `${path} omits the \`${kind}\` binding`).toContain(`\`${kind}\``);
      }
    }
  });

  test("the adapter reference doc describes the Epic path, not label-only", () => {
    // The doc carried zero occurrences of "Epic" while adapters/jira.md
    // declared `milestone_binding: epic` as the primary path.
    const doc = read(TRACKER_ADAPTERS_DOC);
    expect(doc).toMatch(/\bEpic\b/);
    const jiraRow = doc.split("\n").find((l) => /^\|\s*Jira\s*\|/.test(l));
    expect(jiraRow, "no Jira row in the Project Milestone table").toBeDefined();
    expect(jiraRow!).toMatch(/\bEpic\b/);
    // The legacy label surface must SURVIVE as the documented fallback — the
    // correction is "epic primary, label fallback", not "label deleted".
    expect(jiraRow!).toMatch(/label/i);
    expect(jiraRow!).toMatch(/read-merge-write/i);
  });
});
