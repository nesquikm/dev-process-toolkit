// M126 / STE-477 — the § 4b′ propagation-commit subject must satisfy the
// toolkit's OWN 72-char `commit-msg` hook.
//
// THE DEFECT, as arithmetic rather than as prose. `skills/implement/SKILL.md`
// § 4b′ prescribes `chore(specs): propagate <removed-path> removal to
// cross-cutting specs`. The fixed wording costs 55 characters — `chore(specs):
// propagate ` (24) plus ` removal to cross-cutting specs` (31) — so the removed
// path may be at most SEVENTEEN. `src/.placeholder.test.ts` (24) renders 79;
// `plugins/dev-process-toolkit/adapters/_shared/src/foo.ts` (55) renders 110.
// The template is unsatisfiable for nearly every realistic path, which is why
// this reads as always-broken rather than as an edge case.
//
// THIS IS STE-461's RESOLUTION SHAPE, REAPPLIED TO A SECOND SITE. There, the
// lock-claim subject scaled with the branch name; here it scales with the
// removed path. The repair is the same four moves and they are asserted as a
// set, because doing three of them is doing the instance rather than the class:
//
//   1. The subject stops scaling with the variable part — it becomes a FIXED
//      string, byte-identical for every input (AC.1, AC.2).
//   2. The variable part moves to the commit BODY, which the hook does not
//      validate, so nothing is lost (AC.1).
//   3. A PRE-WRITE length assertion converts the residual bound into an
//      enforced one, refusing in the NFR-10 canonical shape rather than
//      emitting a subject the hook will reject (AC.3).
//   4. `--no-verify` is rejected on every path — deterministic gates override
//      LLM judgment, so the commit conforms rather than the gate bending
//      (AC.3, AC.4).
//
// WHY THE ASSERTIONS ARE DERIVED AND EXECUTED RATHER THAN RESTATED. STE-461's
// measured lesson was that a test-local copy of a subject stays green under
// exactly the producer regression it exists to catch. So the subject here is
// read out of the shipped module and the prose is checked against THAT, and the
// bound is proven by committing through the REAL shipped hook rather than by
// re-deriving `72` in a second place.
//
// WHAT THIS FILE DELIBERATELY DOES NOT ASSERT — and the reason is scope, not
// oversight. `.claude/skills/smoke-test/SKILL.md` lines 998 and 1006 grep for
// the propagation subject and are repaired under STE-488 in M127. Nothing here
// requires those greps to change; there is instead a guard asserting that file
// is BYTE-UNCHANGED, so a well-meaning in-scope edit to it fails loudly rather
// than silently annexing another milestone's work.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  buildHookedFixture,
  cleanup,
  gitTry,
  PLUGIN_ROOT,
  proveHookRejects,
  REPO_ROOT,
} from "./_hooked-lock-fixture";

const IMPLEMENT_SKILL = join(PLUGIN_ROOT, "skills/implement/SKILL.md");
const IMPLEMENT_REFERENCE = join(PLUGIN_ROOT, "docs/implement-reference.md");
const COMMIT_MSG_HOOK = "plugins/dev-process-toolkit/templates/git-hooks/commit-msg.sh";
const SMOKE_SKILL_REL = ".claude/skills/smoke-test/SKILL.md";

// AC-STE-459.2's live-then-archive conditional — this suite must survive the
// FR's own archival, which happens in the same milestone that writes it.
const FR_477 = existsSync(join(REPO_ROOT, "specs/frs/STE-477.md"))
  ? join(REPO_ROOT, "specs/frs/STE-477.md")
  : join(REPO_ROOT, "specs/frs/archive/STE-477.md");

/**
 * The module this FR introduces: one place that RENDERS the propagation commit
 * message and ASSERTS its subject against the cap.
 *
 * It is a module rather than prose because AC.2 and AC.3 are otherwise
 * unfalsifiable — "the prescribed subject is ≤ 72 for every path" and "a
 * pre-write assertion refuses" are claims about behavior, and a claim about
 * behavior that only a human can evaluate is the shape this defect shipped in.
 */
const PROPAGATION_MODULE_REL = "adapters/_shared/src/propagation_commit_message.ts";
const PROPAGATION_MODULE = join(PLUGIN_ROOT, PROPAGATION_MODULE_REL);

interface ProseMention {
  file: string;
  line: number;
  snippet: string;
}

interface PropagationCommitMessage {
  subject: string;
  body: string;
  message: string;
}

interface PropagationModule {
  PROPAGATION_SUBJECT_CAP: number;
  PROPAGATION_COMMIT_SUBJECT: string;
  assertPropagationSubjectWithinCap(
    subject: string,
    context?: { mode?: string; ticket?: string },
  ): void;
  buildPropagationCommitMessage(
    removedPaths: string[],
    proseMentions?: ProseMention[],
  ): PropagationCommitMessage;
}

/**
 * Loaded lazily and per-test, so a missing module reddens only the arms that
 * are about the module.
 *
 * A top-level `import` would collapse all six ACs into one import failure, and
 * the doc-side criteria (AC.4, AC.5, AC.6) would then report nothing about
 * their own subjects — the "one failure hides five" shape.
 */
async function propagationModule(): Promise<PropagationModule> {
  return (await import(`../${PROPAGATION_MODULE_REL}`)) as unknown as PropagationModule;
}

function read(path: string): string {
  return readFileSync(path, "utf8");
}

/** `git show HEAD:<path>` from the repo root, or `null` when the path is unknown to HEAD. */
function headBytes(relPath: string): string | null {
  const r = gitTry(REPO_ROOT, "show", `HEAD:${relPath}`);
  return r.exitCode === 0 ? r.stdout : null;
}

/** The § 4b′ bullet in `skills/implement/SKILL.md`, resolved BY NAME and asserted unique. */
function phase4bPrimeBullet(): string {
  const lines = read(IMPLEMENT_SKILL)
    .split("\n")
    .filter((l) => /cross-cutting spec propagation/i.test(l) && l.trim().startsWith("**Phase 4b"));
  expect(lines).toHaveLength(1);
  return lines[0]!;
}

/**
 * The path fixture set. Short, medium, and two at or over sixty characters —
 * AC.2's floor is one ≥ 60, and the file this FR's own helper lives beside is
 * 79, so the "long path" is a real path from this repo rather than padding.
 */
const PATH_FIXTURES = [
  "a.ts",
  "src/.placeholder.test.ts",
  "plugins/dev-process-toolkit/adapters/_shared/src/foo.ts",
  "plugins/dev-process-toolkit/adapters/_shared/src/scan_cross_cutting_spec_refs.ts",
];

/** The retired template, rendered — the RED-producing input, kept in ONE place. */
function retiredSubject(removedPath: string): string {
  return `chore(specs): propagate ${removedPath} removal to cross-cutting specs`;
}

/**
 * Detects a propagation subject that still EMBEDS the path.
 *
 * Deliberately wording-agnostic on the fixed part and specific about the
 * variable one: it fires when the token between `propagate` and ` removal to
 * cross-cutting specs` carries a placeholder (`<…>`, `${…}`) or a path
 * separator. A regression that reworded the fixed half while keeping the path
 * would still be caught; the falsifiability arm below pins both directions so
 * the boundary is a stated contract rather than a silent one.
 */
const PATH_EMBEDDING_SUBJECT =
  /propagate\s+[^\s`]*(?:<[^>]*>|\$\{[^}]*\}|\/)[^\s`]*\s+removal to cross-cutting specs/;

const SHIPPED_ROOTS = [
  join(PLUGIN_ROOT, "skills"),
  join(PLUGIN_ROOT, "docs"),
  join(PLUGIN_ROOT, "adapters"),
  join(PLUGIN_ROOT, "templates"),
];

function sweepShippedSurfaces(detector: RegExp): string[] {
  const offenders: string[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) {
        walk(p);
        continue;
      }
      if (p.endsWith(".test.ts")) continue;
      if (!/\.(md|ts|js|sh|json)$/.test(p)) continue;
      for (const [i, line] of read(p).split("\n").entries()) {
        if (detector.test(line)) offenders.push(`${p.slice(REPO_ROOT.length + 1)}:${i + 1}`);
      }
    }
  };
  SHIPPED_ROOTS.forEach(walk);
  return offenders;
}

/**
 * `docs/implement-reference.md`'s § Phase 4b′ section, resolved through the
 * pointer the SKILL itself carries.
 *
 * DERIVED, NOT RESTATED. § 4b′ ends with "Full edit policy:
 * `docs/implement-reference.md` § <name>." — a pointer that has, until this FR,
 * pointed at a section that does not exist. Reading the name out of the SKILL
 * means the pointer and the heading cannot drift apart while both look right in
 * isolation.
 */
function referenceSectionName(): string {
  const m = /`docs\/implement-reference\.md`\s*§\s*([^.\n]+)\./.exec(phase4bPrimeBullet());
  expect(m).not.toBeNull();
  return m![1]!.trim();
}

/** Prime vs ASCII apostrophe is a rendering choice, not a contract. */
function normalizePrimes(s: string): string {
  return s.replace(/[′’]/g, "'");
}

function referenceSection(): string {
  const wanted = normalizePrimes(referenceSectionName());
  const lines = read(IMPLEMENT_REFERENCE).split("\n");
  const at = lines.findIndex(
    (l) => l.startsWith("#") && normalizePrimes(l.replace(/^#+\s*/, "").trim()) === wanted,
  );
  expect({ section: wanted, found: at >= 0 }).toEqual({ section: wanted, found: true });
  const level = /^#+/.exec(lines[at]!)![0]!.length;
  let end = lines.length;
  for (let i = at + 1; i < lines.length; i++) {
    const h = /^#+/.exec(lines[i]!);
    if (h && h[0]!.length <= level) {
      end = i;
      break;
    }
  }
  return lines.slice(at, end).join("\n");
}

/** The FR's `## Notes` section, sliced to its own heading. */
function frNotes(): string {
  const body = read(FR_477);
  const start = body.indexOf("\n## Notes");
  expect(start).toBeGreaterThan(-1);
  const rest = body.slice(start + 1);
  const next = rest.indexOf("\n## ", 1);
  return next < 0 ? rest : rest.slice(0, next);
}

// ═══ AC-STE-477.1 — the subject stops scaling; the path moves to the body ════

describe("AC-STE-477.1 — § 4b′ prescribes a path-independent subject", () => {
  test("the prescribed subject is the module's fixed literal, carried verbatim in § 4b′", async () => {
    // Derived from the producer, per STE-461's measured lesson: a test-local
    // copy of the subject stayed green under exactly the producer regression it
    // existed to catch.
    const { PROPAGATION_COMMIT_SUBJECT } = await propagationModule();
    expect(phase4bPrimeBullet()).toContain(`\`${PROPAGATION_COMMIT_SUBJECT}\``);
  });

  test("the prescribed subject carries no path, placeholder or interpolation", async () => {
    const { PROPAGATION_COMMIT_SUBJECT } = await propagationModule();
    expect({
      subject: PROPAGATION_COMMIT_SUBJECT,
      placeholder: /<[^>]*>/.test(PROPAGATION_COMMIT_SUBJECT),
      interpolation: PROPAGATION_COMMIT_SUBJECT.includes("${"),
      separator: PROPAGATION_COMMIT_SUBJECT.includes("/"),
    }).toEqual({
      subject: PROPAGATION_COMMIT_SUBJECT,
      placeholder: false,
      interpolation: false,
      separator: false,
    });
  });

  test("§ 4b′ states that the REMOVED PATH is recorded in the BODY", () => {
    // Removing the path from the subject without re-homing it DELETES
    // information the operator needs — which propagation this commit was. The
    // body is unconstrained by the hook, so nothing is lost by moving it there,
    // and the prose has to say so or the next editor will not know.
    //
    // MEASURED AS A CO-OCCURRENCE WITHIN ONE SENTENCE, and that is the whole
    // assertion. § 4b′ ALREADY says "body" — of the prose-mention `file:line`
    // hits — and ALREADY says `<removed-path>`, in the subject it is retiring.
    // A two-term whole-bullet check is therefore satisfied by the DEFECT, which
    // is the vacuity this suite exists to avoid: it passed before a line of
    // this FR was written.
    const sentences = phase4bPrimeBullet().split(/(?<=[.;])\s+/);
    const carriers = sentences.filter(
      (s) => /\bbody\b/i.test(s) && /removed|deleted/i.test(s),
    );
    expect({ carriers: carriers.length > 0 }).toEqual({ carriers: true });
  });

  test("no SHIPPED surface still prescribes the path-embedding form", () => {
    // Scoped to what ships. `specs/` is history — the FR and the archived
    // STE-215/STE-222 records quote the retired form verbatim and must keep
    // doing so — and `*.test.ts` files legitimately name it while asserting it
    // is gone. `.claude/skills/smoke-test/SKILL.md` is EXCLUDED BY SCOPE: its
    // greps are STE-488's job in M127, and a guard below pins it unchanged.
    expect(sweepShippedSurfaces(PATH_EMBEDDING_SUBJECT)).toEqual([]);
  });

  test("the sweep is FALSIFIABLE — the retired form is what it detects", () => {
    // Without this, an empty offender list is equally produced by a regex that
    // matches nothing.
    expect(PATH_EMBEDDING_SUBJECT.test(retiredSubject("<removed-path>"))).toBe(true);
    expect(PATH_EMBEDDING_SUBJECT.test(retiredSubject("${removedPath}"))).toBe(true);
    expect(PATH_EMBEDDING_SUBJECT.test(retiredSubject("src/.placeholder.test.ts"))).toBe(true);
    // THE BOUNDARY, PINNED IN THE OTHER DIRECTION: the fixed form is not an
    // offender, and neither is the smoke driver's regex-bearing grep — which
    // this sweep never reaches, but which would be a false positive if it did.
    expect(PATH_EMBEDDING_SUBJECT.test("chore(specs): propagate file removal to cross-cutting specs")).toBe(false);
    expect(PATH_EMBEDDING_SUBJECT.test("propagate.*removal to cross-cutting specs")).toBe(false);
  });
});

// ═══════ AC-STE-477.2 — ≤ 72 for every path, proven by the real hook ═════════

describe("AC-STE-477.2 — the rendered subject is within the cap for every path", () => {
  test("the fixture set really contains a path at or over sixty characters", () => {
    // Non-vacuity first: the AC's floor is a ≥60-char path, and a fixture set
    // of short paths would pass the bound while measuring nothing.
    expect(Math.max(...PATH_FIXTURES.map((p) => p.length))).toBeGreaterThanOrEqual(60);
  });

  test("every fixture path renders the SAME subject, byte-identically", async () => {
    const { buildPropagationCommitMessage, PROPAGATION_COMMIT_SUBJECT } = await propagationModule();
    const rendered = PATH_FIXTURES.map((p) => buildPropagationCommitMessage([p]).subject);
    expect(rendered).toEqual(PATH_FIXTURES.map(() => PROPAGATION_COMMIT_SUBJECT));
  });

  test("every rendered subject is within the cap, and the cap is the hook's own 72", async () => {
    const { buildPropagationCommitMessage, PROPAGATION_SUBJECT_CAP } = await propagationModule();
    expect(PROPAGATION_SUBJECT_CAP).toBe(72);
    expect(
      PATH_FIXTURES.map((p) => {
        const { subject } = buildPropagationCommitMessage([p]);
        return { path: p, length: subject.length, withinCap: subject.length <= 72 };
      }).map((r) => ({ path: r.path, withinCap: r.withinCap })),
    ).toEqual(PATH_FIXTURES.map((p) => ({ path: p, withinCap: true })));
  });

  test("the removed path survives — in the body, where the hook does not read", async () => {
    const { buildPropagationCommitMessage } = await propagationModule();
    for (const p of PATH_FIXTURES) {
      const m = buildPropagationCommitMessage([p]);
      expect({ path: p, inSubject: m.subject.includes(p), inBody: m.body.includes(p) }).toEqual({
        path: p,
        inSubject: false,
        inBody: true,
      });
    }
  });

  test("prose-mention hits are carried into the body as file:line + snippet", async () => {
    // § 4b′ already promises this — prose hits stay untouched and are RECORDED
    // so the operator can amend. Moving the message into a module is where that
    // promise stops being prose, so it is asserted at the same time.
    const { buildPropagationCommitMessage } = await propagationModule();
    const m = buildPropagationCommitMessage(["src/.placeholder.test.ts"], [
      { file: "specs/technical-spec.md", line: 42, snippet: "the placeholder test guards X" },
    ]);
    expect(m.body).toContain("specs/technical-spec.md:42");
    expect(m.body).toContain("the placeholder test guards X");
  });

  test("EXECUTED: the rendered message COMMITS through the real shipped hook, for every path", async () => {
    // The bound proven by the gate that actually judges it, not by a second
    // copy of `72` in this file. STE-461's harness exists precisely so a
    // producer change meets the shipped hook inside the suite rather than for
    // the first time in a downstream tree.
    const { buildPropagationCommitMessage } = await propagationModule();
    const f = buildHookedFixture({ branch: "main", commitMsgHook: "shell", label: "ste477-hook" });
    try {
      // Liveness: a non-executable or absent hook is SILENTLY ignored by git,
      // which is the most effective way to make this arm pass while proving
      // nothing at all.
      expect(proveHookRejects(f).exitCode).not.toBe(0);

      for (const p of PATH_FIXTURES) {
        const { message } = buildPropagationCommitMessage([p]);
        const r = gitTry(f.root, "commit", "--allow-empty", "--quiet", "-m", message);
        expect({ path: p, landed: r.exitCode === 0 }).toEqual({ path: p, landed: true });
      }
    } finally {
      cleanup(f);
    }
  }, 60_000);

  test("EXECUTED: the RETIRED form is refused by that same hook — the defect, measured", async () => {
    // The mutation the AC names, run rather than described. Without it, "every
    // fixture commits" is satisfied by a fixture set of trivially short paths
    // and by a hook that accepts everything.
    const f = buildHookedFixture({ branch: "main", commitMsgHook: "shell", label: "ste477-retired" });
    try {
      expect(proveHookRejects(f).exitCode).not.toBe(0);
      const rows = PATH_FIXTURES.map((p) => {
        const subject = retiredSubject(p);
        const r = gitTry(f.root, "commit", "--allow-empty", "--quiet", "-m", subject);
        if (r.exitCode === 0) gitTry(f.root, "reset", "--hard", "--quiet", "HEAD~1");
        return { path: p, length: subject.length, refused: r.exitCode !== 0 };
      });
      // Every fixture path breaches the cap under the retired template — the
      // fixed wording alone costs 55, leaving 17 for the path, and even `a.ts`
      // is only comfortable because it is four characters.
      expect(rows.filter((r) => r.length > 72).every((r) => r.refused)).toBe(true);
      // …and at least one of them DOES breach, or the arm proves nothing.
      expect(rows.some((r) => r.length > 72 && r.refused)).toBe(true);
    } finally {
      cleanup(f);
    }
  }, 60_000);
});

// ══ AC-STE-477.3 — a PRE-WRITE assertion refuses in the NFR-10 shape ═════════

describe("AC-STE-477.3 — the residual bound is enforced, not inherited", () => {
  test("an over-cap subject is REFUSED rather than emitted", async () => {
    const { assertPropagationSubjectWithinCap } = await propagationModule();
    expect(() => assertPropagationSubjectWithinCap(`chore(specs): ${"x".repeat(80)}`)).toThrow();
  });

  test("a within-cap subject is accepted — the assertion is not a blanket refusal", async () => {
    const { assertPropagationSubjectWithinCap, PROPAGATION_COMMIT_SUBJECT } =
      await propagationModule();
    expect(() => assertPropagationSubjectWithinCap(PROPAGATION_COMMIT_SUBJECT)).not.toThrow();
  });

  test("the refusal is the NFR-10 canonical shape — verdict, Remedy, Context", async () => {
    const { assertPropagationSubjectWithinCap } = await propagationModule();
    const overlong = `chore(specs): ${"x".repeat(80)}`;
    let message = "";
    try {
      assertPropagationSubjectWithinCap(overlong);
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    const lines = message.split("\n").filter((l) => l.trim().length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(lines[1]).toMatch(/^Remedy: \S/);
    expect(lines[2]).toMatch(/^Context: mode=\S+, ticket=\S+, skill=\S+/);
    // The verdict states the three facts an operator needs to recognise the
    // condition — the subject verbatim, its length, and the cap — in the same
    // shape `local_provider.ts` states them for the lock-commit site.
    expect(lines[0]).toContain(overlong);
    expect(lines[0]).toContain(String(overlong.length));
    expect(lines[0]).toContain("72");
  });

  test("the refusal names the skill it fired in", async () => {
    const { assertPropagationSubjectWithinCap } = await propagationModule();
    let message = "";
    try {
      assertPropagationSubjectWithinCap(`chore(specs): ${"x".repeat(80)}`);
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message).toMatch(/skill=[^\s,]*implement/);
  });

  test("the assertion runs BEFORE the message is returned — ordering, from the source", async () => {
    // "Pre-write" is an ORDERING claim, and an assertion that runs after the
    // caller already has the message is the same defect one step later. The
    // module is the only place the order is decidable, so it is read there
    // rather than assumed from the fact that the function exists.
    expect(existsSync(PROPAGATION_MODULE)).toBe(true);
    const src = read(PROPAGATION_MODULE);
    const fnAt = src.indexOf("export function buildPropagationCommitMessage");
    expect(fnAt).toBeGreaterThan(-1);
    const body = src.slice(fnAt);
    const assertAt = body.indexOf("assertPropagationSubjectWithinCap(");
    const returnAt = body.indexOf("return");
    expect(assertAt).toBeGreaterThan(-1);
    expect(returnAt).toBeGreaterThan(-1);
    expect(assertAt).toBeLessThan(returnAt);
  });

  test("§ 4b′ instructs the assertion before the commit is issued", () => {
    const bullet = phase4bPrimeBullet();
    expect(bullet).toContain("buildPropagationCommitMessage");
    expect(bullet).toContain(PROPAGATION_MODULE_REL);
  });

  test("`--no-verify` appears on NO path — not the module, not the prose, not the reference", () => {
    // The bypass the resolution explicitly rejects. It contradicts the
    // deterministic-gates-override principle, and it would teach every
    // downstream project that bypassing its own gate is normal.
    expect(sweepShippedSurfaces(/--no-verify/)).toEqual([]);
    // Falsifiable: the detector is a real one.
    expect(/--no-verify/.test("git commit --no-verify -m x")).toBe(true);
    // `-n` is `--no-verify`'s short form on `git commit`, and the long-form
    // sweep alone would wave it through. Scoped to a commit invocation so an
    // unrelated `-n` (a `grep -n`, a prose dash) can neither satisfy nor trip
    // it. Same detector shape as the sibling STE-461 sweep.
    const shortForm = /git commit[^`\n]*\s-n(\s|`)/;
    expect(sweepShippedSurfaces(shortForm)).toEqual([]);
    expect(shortForm.test("git commit -n -m x")).toBe(true);
    expect(shortForm.test("grep -n foo")).toBe(false);
  });
});

// ═══ AC-STE-477.4 — the 72-char rule is the authority, not the thing that bends ══

describe("AC-STE-477.4 — templates/git-hooks/commit-msg.sh is byte-unchanged", () => {
  test("the working-tree hook is byte-identical to HEAD's", () => {
    // Asserted against git rather than by re-deriving the rule. A test that
    // re-checked "the hook says 72" would stay green through a hook edited
    // down to 100 and back up to 72, and would say nothing at all about the
    // temptation this AC exists to forbid: relaxing the gate instead of
    // conforming to it.
    const head = headBytes(COMMIT_MSG_HOOK);
    expect(head).not.toBeNull();
    expect(read(join(REPO_ROOT, COMMIT_MSG_HOOK))).toBe(head!);
  });

  test("the comparison is FALSIFIABLE — HEAD really carries this path", () => {
    // A `git show` that failed would return null and an `expect(x).toBe(null)`
    // pairing would pass on a repo where the hook does not exist at all.
    expect(headBytes(COMMIT_MSG_HOOK)).toContain("72");
    expect(headBytes(`${COMMIT_MSG_HOOK}.this-path-does-not-exist`)).toBeNull();
  });
});

// ═════ AC-STE-477.5 — the reference doc states the shape AND its reason ══════

describe("AC-STE-477.5 — docs/implement-reference.md § Phase 4b′", () => {
  test("the section the SKILL points at EXISTS", () => {
    // It has not, until now: § 4b′ has carried a pointer to
    // `§ Phase 4b' Cross-Cutting Spec Propagation` while the reference doc has
    // no such heading, so the deepest-detail surface for this hook was a
    // dangling reference.
    expect(referenceSection().length).toBeGreaterThan(0);
  });

  test("it states the new subject shape, derived from the module", async () => {
    const { PROPAGATION_COMMIT_SUBJECT } = await propagationModule();
    expect(referenceSection()).toContain(PROPAGATION_COMMIT_SUBJECT);
  });

  test("it names the 72-char constraint as the REASON, not as trivia", () => {
    const section = referenceSection();
    expect(section).toContain("72");
    expect(section).toMatch(/commit-msg/);
    // The path-embedding form must not survive as the documented shape.
    expect(PATH_EMBEDDING_SUBJECT.test(section)).toBe(false);
  });

  test("it says where the removed path went", () => {
    expect(referenceSection()).toMatch(/\bbody\b/i);
  });
});

// ═══ AC-STE-477.6 — the cross-milestone coupling is WRITTEN DOWN ═════════════

describe("AC-STE-477.6 — the STE-488 / M127 coupling is recorded, not discovered", () => {
  test("the FR's Notes name the coupled surface, the lines, the FR and the milestone", () => {
    // The point of the record is that the NEXT reader of the smoke driver does
    // not have to rediscover why two of its greps look stale. All four facts
    // are required together: a note naming only the milestone tells nobody
    // which lines to repair.
    const notes = frNotes();
    expect(notes).toContain(SMOKE_SKILL_REL);
    expect(notes).toContain("998");
    expect(notes).toContain("1006");
    expect(notes).toContain("STE-488");
    expect(notes).toContain("M127");
  });

  test("the reference doc carries the coupling too, where a driver editor will meet it", () => {
    expect(read(IMPLEMENT_REFERENCE)).toContain("STE-488");
  });

  test("SCOPE GUARD: .claude/skills/smoke-test/SKILL.md is byte-unchanged", () => {
    // Repairing those greps is STE-488's job in M127. This assertion is what
    // keeps a well-meaning in-scope edit from silently annexing it — and it is
    // also what makes the AC.6 record meaningful rather than a note about work
    // that quietly already happened.
    const head = headBytes(SMOKE_SKILL_REL);
    expect(head).not.toBeNull();
    expect(read(join(REPO_ROOT, SMOKE_SKILL_REL))).toBe(head!);
  });

  test("the coupled greps are still THERE — the record describes a live condition", () => {
    // If the greps had already moved, the note would be describing nothing and
    // the guard above would be pinning a coincidence.
    const lines = read(join(REPO_ROOT, SMOKE_SKILL_REL)).split("\n");
    expect(lines[997]).toContain("removal to cross-cutting specs");
    expect(lines[1005]).toContain("removal to cross-cutting specs");
  });
});
