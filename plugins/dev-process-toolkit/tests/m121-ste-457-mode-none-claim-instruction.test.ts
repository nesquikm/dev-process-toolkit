// M121 / STE-457 — "Give the tracker-less claim step an instruction shaped like
// its siblings, and verify the artifact".
//
// THE DEFECT IS AN ASYMMETRY, NOT MISSING CODE. `LocalProvider.claimLock` is
// implemented, unit-tested and reachable; prose-directive-as-wire is this
// toolkit's normal architecture. What step 0.c's tracker-less half lacked was a
// followable instruction: its siblings 0.b′ and 0.b″ each name a module path AND
// a call form, its own tracker half points at a runbook, and its tracker-less
// half named NEITHER — it stated a fact about a class. On the 2026-08-08
// conformance run the tracker leg claimed correctly and the tracker-less leg
// never claimed at all.
//
// WHAT THIS FILE CAN AND CANNOT PROVE. It proves the shipped prose now carries
// the instruction, the verification arm and the corrected release proof, and
// that a future edit undoing any of those goes RED. It CANNOT prove a
// `claude -p` child FOLLOWS the improved prose — only the next conformance run
// shows that, which is why the detection FR shipped first.
//
// PIN DISCIPLINE (docs/patterns.md Pattern 31 + follow-ups § 0m(c)(d), § 0i):
//
//   * § 0.c is resolved BY NAME (`**0.c Claim**`) and asserted UNIQUE, never by
//     position — two bullets of this skill mention `claimLock` and `mode: none`.
//   * every 0.c assertion is scoped to the tracker-less HALF of the bullet, not
//     the whole bullet and not the whole document. Step 0.b′ and 0.b″ already
//     spell `… from \`adapters/_shared/src/…\``, so a document-wide or
//     bullet-wide module-path pin would be satisfied by a sibling and would say
//     nothing about the subject (follow-ups § 0k(m), § 0h(d)).
//   * the retired phrasings are pinned to ZERO document-wide, not merely absent
//     from the slice, so they cannot return somewhere the slice does not look
//     (follow-ups § 0m(d)).
//   * pins are POSITIVE where possible — a ban is also satisfied by deleting the
//     subject (Pattern 31 rider 1).

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { proseSurfaceCount, tableSurfaceRows } from "./_m121-blast-radius";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");

const IMPLEMENT_SKILL = join(PLUGIN_ROOT, "skills/implement/SKILL.md");
const IMPLEMENT_REFERENCE = join(PLUGIN_ROOT, "docs/implement-reference.md");
const LOCAL_PROVIDER = join(PLUGIN_ROOT, "adapters/_shared/src/local_provider.ts");
const DETECTOR_SUITE = join(import.meta.dir, "m121-ste-456-two-sided-lock-evidence.test.ts");

// AC-STE-459.2 — live-then-archive, the house conditional already shipped at
// `m108-ste-393-docs-pins.test.ts:99` and `m114-ste-416-…:203`. Seven of this
// suite's assertions went red on archival before STE-459.
const FR_457_ACTIVE = join(REPO_ROOT, "specs/frs/STE-457.md");
const FR_457_ARCHIVED = join(REPO_ROOT, "specs/frs/archive/STE-457.md");
const FR_457 = existsSync(FR_457_ACTIVE) ? FR_457_ACTIVE : FR_457_ARCHIVED;
const PLAN_ACTIVE = join(REPO_ROOT, "specs/plan/M121.md");
const PLAN_ARCHIVED = join(REPO_ROOT, "specs/plan/archive/M121.md");
const PLAN_M121 = existsSync(PLAN_ACTIVE) ? PLAN_ACTIVE : PLAN_ARCHIVED;
const FOLLOW_UPS = join(REPO_ROOT, "specs/notes/follow-ups.md");

function read(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

/**
 * The `0.c Claim` bullet, resolved by its bold label and asserted unique.
 * Position-based selection is the defect this branch's `6fd67ca` corrected and
 * the detector suite then reproduced one FR later.
 */
function claimBullet(): string {
  const body = read(IMPLEMENT_SKILL);
  expect(body).not.toBeNull();
  const matches = body!.split("\n").filter((l) => l.includes("**0.c Claim**"));
  expect(matches).toHaveLength(1);
  return matches[0]!;
}

/** The tracker-less HALF of the 0.c bullet — everything from its `mode: none` lead-in on. */
function claimBulletModeNoneHalf(): string {
  const bullet = claimBullet();
  const at = bullet.indexOf("`mode: none`:");
  expect(at).toBeGreaterThan(-1);
  const half = bullet.slice(at);
  // Non-vacuity: the slice must actually be the tracker-less half, not a stub
  // left behind by a relocation (follow-ups § 0i).
  expect(half.length).toBeGreaterThan(120);
  return half;
}

/** The tracker HALF of the 0.c bullet — everything before the `mode: none` lead-in. */
function claimBulletTrackerHalf(): string {
  const bullet = claimBullet();
  const at = bullet.indexOf("`mode: none`:");
  expect(at).toBeGreaterThan(-1);
  return bullet.slice(0, at);
}

/** The `0.d Claim verification` bullet, resolved by name and asserted unique. */
function verifyBullet(): string {
  const body = read(IMPLEMENT_SKILL);
  expect(body).not.toBeNull();
  const matches = body!.split("\n").filter((l) => l.includes("**0.d Claim verification"));
  expect(matches).toHaveLength(1);
  return matches[0]!;
}

/** `docs/implement-reference.md` § Phase 4 Close step (c), sliced between its siblings. */
function phase4CloseStepC(): string {
  const body = read(IMPLEMENT_REFERENCE);
  expect(body).not.toBeNull();
  const start = body!.indexOf("**(c) Post-release verification**");
  expect(start).toBeGreaterThan(-1);
  const end = body!.indexOf("**Abort boundary", start);
  expect(end).toBeGreaterThan(start);
  const slice = body!.slice(start, end);
  // Non-vacuity: the slice must still carry the tracker-side assertion it guards.
  expect(slice).toContain("status_mapping.done");
  return slice;
}

const NAMESPACE_TOKEN = /\b(STE|AC-STE)-\d+(?:\.\d+)?\b/g;

function countNamespaceTokens(dir: string): number {
  let total = 0;
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) total += countNamespaceTokens(p);
    else if (entry.endsWith(".md")) total += (readFileSync(p, "utf8").match(NAMESPACE_TOKEN) ?? []).length;
  }
  return total;
}

// ---------------------------------------------------------------------------

describe("AC-STE-457.1 — § 0.c's tracker-less half names a module path AND a call form", () => {
  test("the tracker-less half names the module the claim lives in", () => {
    // Scoped to the half, deliberately: 0.b′ and 0.b″ already spell
    // `adapters/_shared/src/…`, so a document-wide pin would be green on a
    // completely unfixed 0.c.
    expect(claimBulletModeNoneHalf()).toContain("adapters/_shared/src/local_provider.ts");
  });

  test("the tracker-less half names a call form with arguments, not a fact about a class", () => {
    const half = claimBulletModeNoneHalf();
    // The sibling shape is `call <fn>(<args>)` — an invocation a reader can
    // execute, not a sentence describing what a class does.
    expect(half).toMatch(/claimLock\(<id>,\s*<currentBranch>\)/);
    expect(half).toMatch(/LocalProvider\(\{\s*repoRoot\s*\}\)/);
  });

  test("routing is THREE-way and `already-released` is NOT copied across", () => {
    const half = claimBulletModeNoneHalf();
    // PINNED POSITIVELY AS ONE CLOSED LITERAL, plus a COUNT. The first draft
    // asserted the three names individually, `/no\s+`already-released`/i`, and a
    // negative on the tracker half's exact slash-separated punctuation.
    // Measured: rewriting the clause to "Four-way routing (`claimed`,
    // `already-ours`, `taken-elsewhere`, `already-released`); there is no
    // `already-released`-specific handling documented separately on the local
    // claim side." was GREEN — commas evaded the punctuation-exact ban, and the
    // positive arm was satisfied by "no `already-released`-specific handling",
    // a phrase that asserts the OPPOSITE of the requirement. The arity word,
    // which is the test's own stated subject, was pinned nowhere.
    expect(half).toContain("Three-way routing (`claimed` / `already-ours` / `taken-elsewhere`)");
    expect(half).toContain("there is no `already-released` on the local claim side");
    // …and exactly one occurrence, so a second mention cannot reintroduce the
    // fourth outcome as a route while the two literals above stay satisfied.
    expect((half.match(/`already-released`/g) ?? []).length).toBe(1);
  });

  test("the half names the artifact AND the durable witness the claim produces", () => {
    const half = claimBulletModeNoneHalf();
    expect(half).toContain(".dpt/locks/<id>");
    // RE-POINTED BY STE-461, at full strength. The subject lost its
    // ` on <branch>` tail, so a pin on the retired string would fail for the
    // right reason once and then be deleted for the wrong one. What the retired
    // literal asserted was that the half names BOTH halves of what the claim
    // writes — the subject and the branch — so both are still pinned, on the
    // two artifacts that now carry them.
    expect(half).toContain("chore(locks): claim lock for <id>");
    expect(half).toContain("branch: <branch>` body line");
  });

  test("the half closes with a documentation pointer, like its siblings", () => {
    expect(claimBulletModeNoneHalf()).toContain("docs/implement-reference.md");
  });

  test("the TRACKER half is untouched — its runbook pointer and four-way routing survive", () => {
    const tracker = claimBulletTrackerHalf();
    expect(tracker).toContain("docs/implement-tracker-mode.md` § Claim runbook");
    expect(tracker).toContain(
      "Four-way routing (`claimed` / `already-ours` / `taken-elsewhere` / `already-released`)",
    );
  });

  test("the fix lands on § 0.c and NOT on § 0.b — the two bullets that both mention claimLock", () => {
    // The detector suite's first draft selected `mode: none` + `claimLock` by
    // `.find`, which returns § 0.b Provider resolution. This asserts the
    // module path is on 0.c and is absent from 0.b, so a fix applied to the
    // wrong bullet is RED rather than silently accepted.
    const body = read(IMPLEMENT_SKILL);
    expect(body).not.toBeNull();
    const provider = body!.split("\n").filter((l) => l.includes("**0.b Provider resolution**"));
    expect(provider).toHaveLength(1);
    expect(provider[0]!).not.toContain("adapters/_shared/src/local_provider");
  });
});

describe("AC-STE-457.2 — § 0.d gains a tracker-less arm; the tracker arm is byte-unchanged", () => {
  // The tracker arm, verbatim as it shipped before this FR. Kept as one literal
  // so a one-character edit anywhere in it turns this RED.
  const TRACKER_ARM =
    "Before entering Phase 2, re-fetch the ticket via `mcp__<tracker>__get_issue(<id>)` and assert (1) " +
    "`status == status_mapping[in_progress]` AND (2) `assignee == currentUser`. Mismatch ⇒ NFR-10 canonical " +
    "refusal naming the ticket + observed status/assignee; hard-refuse to enter Phase 2.";

  test("the tracker arm survives BYTE-UNCHANGED", () => {
    expect(verifyBullet()).toContain(TRACKER_ARM);
  });

  test("the retired exemption is gone from the whole document, not just the bullet", () => {
    const body = read(IMPLEMENT_SKILL);
    expect(body).not.toBeNull();
    // Pinned document-wide: a carve-out that returns anywhere still exempts the
    // path this FR exists to stop exempting (follow-ups § 0m(d)).
    expect(body!).not.toContain("`mode: none` skips this step.");
    // …and the step no longer advertises itself as tracker-only.
    expect(verifyBullet()).not.toContain("tracker mode only");
    // CLASS-LEVEL, not byte-exact. A byte-exact ban only sees the one phrasing
    // the author happened to retire: measured, appending "In practice
    // `mode: none` may skip this step when no lock was expected." to § 0.d —
    // a document that both mandates the arm and licenses skipping it — was
    // GREEN. Scoped to the 0.d line so the prose elsewhere explaining the
    // retirement does not collide with it (Pattern 31).
    expect(verifyBullet()).not.toMatch(/mode:\s*none`?[^.]*\bskip/i);
  });

  test("the tracker-less arm asserts BOTH the lock file and its claim commit", () => {
    const bullet = verifyBullet();
    expect(bullet).toContain(".dpt/locks/<id>");
    // Conjunction, not either-or: absence alone is the vacuous green this
    // milestone exists to remove.
    expect(bullet).toMatch(/exists[^.]*\bAND\b/);
  });

  test("the witness check is subject-only, fixed-string, whole-line AND branch-pinned", () => {
    // ONE FORM CLOSES FOUR FOLLOWABILITY DEFECTS, each measured on a real repo
    // before this form replaced the first draft's
    // `git log --basic-regexp --grep "^chore(locks): claim lock for <id> "`:
    //
    //   * `--grep` applies its pattern with REG_NEWLINE, so `^` matches at ANY
    //     line of a commit message — a body that merely QUOTES the subject
    //     certified a claim that never fired (executed: a `docs(notes):` commit
    //     whose body pasted the subject matched).
    //   * `git log --grep` exits 0 whether or not it matches, so "names a
    //     commit" had no decidable predicate; `grep -Fxq` exits non-zero.
    //   * the flavour hazard disappears entirely with a fixed string — no
    //     `--basic-regexp` needed, because `(locks)` is never a capture group.
    //   * the first draft truncated before ` on <branch>`, so a lock claimed by
    //     ANOTHER branch satisfied both conjuncts. The tracker arm it mirrors
    //     asserts state AND ownership (`assignee == currentUser`); this one
    //     asserted existence twice.
    //
    // OWNERSHIP WAS RE-HOMED, NOT DROPPED (STE-461). The branch-bearing subject
    // this line used to pin is uncommittable past the hook's 72-character cap,
    // so the subject is branch-free and ownership moved to the lock file's own
    // `branch:` line. The title's fourth property is therefore still asserted —
    // by the SECOND expectation below, on the artifact that now carries it.
    // Re-pointing the witness pin without it would have deleted the property
    // while leaving the title claiming it.
    const bullet = verifyBullet();
    expect(bullet).toContain('git log --format=%s | grep -Fxq "chore(locks): claim lock for <id>"');
    expect(bullet).toContain('grep -Fxq "branch: <currentBranch>" .dpt/locks/<id>');
    expect(bullet).toMatch(/subject-only/i);
    expect(bullet).toMatch(/anchors\s+`\^`\s+at every line/i);
    expect(bullet).toMatch(/taken-elsewhere/);
  });

  test("the refusal distinguishes 'never claimed' from 'claimed but could not commit'", () => {
    // MEASURED, and it is the reason this arm has two shapes. `claimLock`'s
    // commit subject is 97 characters; the toolkit's own commit-msg hook caps
    // subjects at 72. In any project carrying that hook the claim WRITES and
    // STAGES the lock, then throws when the commit is rejected — so the lock
    // exists and the witness does not. A single refusal prescribing "go back
    // and run 0.c" would loop forever on that state, because re-running repeats
    // the same rejection. See specs/notes/follow-ups.md § 0p.
    const bullet = verifyBullet();
    expect(bullet).toContain("Lock present but no matching commit");
    expect(bullet).toMatch(/do NOT prescribe re-running 0\.c/);
  });

  test("the tracker-less arm refuses in NFR-10 canonical shape with a go-back-and-claim remedy", () => {
    const bullet = verifyBullet();
    const at = bullet.indexOf("**`mode: none`:**");
    expect(at).toBeGreaterThan(-1);
    const arm = bullet.slice(at);
    expect(arm).toContain("NFR-10");
    expect(arm).toMatch(/observed[^.]*expected/i);
    expect(arm).toMatch(/go back and run 0\.c/i);
    expect(arm).toMatch(/hard-refuse to enter Phase 2/);
  });

  test("the tracker-less arm is on 0.d itself, not donated by a neighbouring bullet", () => {
    // THIS IS THE SIBLING THE PREDECESSOR PIN CANNOT BE.
    // `implement-tracker-claim-runbook.test.ts`'s AC-STE-101.5 assertion slices
    // `indexOf("0.d Claim verification")` → `"\n1. **Check for specs**"`, which
    // spans 0.d, 0.e AND 0.f. Measured: deleting this whole tracker-less arm
    // leaves that suite at 4 pass / 0 fail, because 0.e's "Vacuous on archived
    // FRs, `mode: none`, …" satisfies its regex. That regex is BYTE-UNCHANGED
    // and stays so — a shipped predecessor's guard is not widened to flatter a
    // successor. This is the sibling assertion that actually holds the property
    // its corrected title describes.
    //
    // The first draft of this test also asserted `toContain("0.d Claim
    // verification")`, which is a TAUTOLOGY — `verifyBullet()` selects lines on
    // a superstring of it, so every value it can return satisfies it.
    const bullet = verifyBullet();
    expect(bullet).toContain("**`mode: none`:**");
    // …and the arm is NOT reachable from the neighbouring bullets, which is
    // the property the title actually names.
    const body = read(IMPLEMENT_SKILL);
    expect(body).not.toBeNull();
    const neighbours = body!.split("\n").filter((l) => /\*\*0\.(c|e|f) /.test(l));
    expect(neighbours.length).toBeGreaterThan(0);
    expect(neighbours.some((l) => l.includes("**`mode: none`:**"))).toBe(false);
  });

  test("the cross-reference table agrees — no surface still says mode:none skips 0.d", () => {
    const overview = read(join(PLUGIN_ROOT, "docs/workflow-overview.md"));
    expect(overview).not.toBeNull();
    // PINNED ON THE OPERATIVE CELLS. The first draft was a byte-exact ban on
    // "mode:none skips" plus a positive pin on the row's LABEL — but the label
    // predates this FR and is unchanged by it, so the ban was the only
    // discriminating assertion. Measured: restoring the entire pre-STE-457 row
    // with ONE space added inside the parenthetical ("(mode: none skips)") was
    // GREEN, while the byte-identical old row was RED. A 15-character literal
    // that any paraphrase escapes was carrying the whole test.
    expect(overview!).toContain("| Claim verification 0.d | /implement (both modes) |");
    expect(overview!).toContain("mode:none: lock file AND claim commit");
    expect(overview!).toMatch(/go back and run 0\.c/);
    // The byte-exact ban is kept as a rider, not as the mechanism.
    expect(overview!).not.toMatch(/mode:\s*none skips/);
  });
});

describe("AC-STE-457.3 — proof-of-release is the durable witness PLUS the absence", () => {
  test("step (c) requires the claim witness AND the absence", () => {
    const stepC = phase4CloseStepC();
    // PINNED AS THE OPERATIVE CLAUSE, not as three tokens plus an order regex.
    // The first draft asserted `toContain("durable claim witness")` +
    // `toContain(".dpt/locks/<id>")` + a `[\s\S]*`-spanning witness/plus/absence
    // regex. Measured, twice and independently: an idiomatic ONE-SIDED rewrite
    // — "…is the absence of `.dpt/locks/<id>` after step (b), **plus** nothing
    // else. The durable claim witness … is optional context…" — kept the FULL
    // GATE at 7046 pass / 15 skip / 0 fail. The pin was a token-order test; the
    // requirement it names is two-sidedness, which it could not see invert.
    expect(stepC).toContain("is two-sided: the durable claim witness");
    expect(stepC).toContain("**plus** the absence of `.dpt/locks/<id>`");
  });

  test("step (c) says WHY absence alone is not proof", () => {
    // The consequence is the mechanism (follow-ups § 0m(c)) — the row must
    // carry the reason a reader would act on, not only the requirement.
    //
    // The rationale literal ALONE survives its own negation: the same sentence
    // prefixed "Absence alone IS proof, even though …" still matched. So the
    // negated claim is pinned too, as the sentence a reader acts on.
    const stepC = phase4CloseStepC();
    expect(stepC).toContain("Absence alone is not proof");
    expect(stepC).toMatch(/a claim that never fired leaves exactly the disk a completed release leaves/i);
  });

  test("the retired half-only phrasing is at ZERO document-wide", () => {
    const body = read(IMPLEMENT_REFERENCE);
    expect(body).not.toBeNull();
    expect(body!).not.toContain(
      "the deterministic `.dpt/locks/<id>` deletion in step (b) is the proof-of-release for `mode: none`",
    );
  });

  test("`LocalProvider.releaseLock` keeps its signature, idempotence and subject", () => {
    // AC-STE-65.3's implementation stays satisfied by construction. Asserted
    // against the module source, not against prose about the module.
    //
    // RE-AIMED BY STE-461, AND THE TITLE CORRECTED — it read "is UNCHANGED in
    // code", which was true of STE-457 (a prose-only FR) and became FALSE the
    // moment STE-461 AC.8 gave `releaseLock` a pre-write cap assertion and a
    // rollback. The test nevertheless stayed GREEN through that change, because
    // its four assertions only ever required four substrings to survive — so
    // the TITLE claimed an invariant the assertions did not enforce, and a
    // reader scanning names would have been told the opposite of the truth.
    //
    // What it actually guards, and still should: the signature, the
    // already-released idempotence, the release subject, and that the removal
    // still goes through `git rm`. Those are the properties AC-STE-65.3 needs;
    // "no line of this method ever changes" was never one of them.
    const src = read(LOCAL_PROVIDER);
    expect(src).not.toBeNull();
    expect(src!).toContain('async releaseLock(id: string): Promise<"transitioned" | "already-released">');

    // SCOPED TO THE METHOD, because the whole-file form had a DONOR. Measured:
    // changing `git rm` to `git reset` INSIDE releaseLock left the old
    // `toContain("git rm -q ${lockPath}")` green — `cleanupStaleLocks` carries a
    // byte-identical invocation, so the pin was satisfied by a different method
    // than the one it names. That donor predates this FR; it is repaired here
    // because it was found here.
    const start = src!.indexOf("  async releaseLock(id: string)");
    expect(start).toBeGreaterThan(-1);
    const end = src!.indexOf("\n  /**", start);
    expect(end).toBeGreaterThan(start);
    const method = src!.slice(start, end);

    expect(method).toContain('if (!existsSync(lockPath)) return "already-released";');
    // The `--` end-of-options separator is part of the invocation now; pinning
    // the flags-and-path shape rather than one spelling of it.
    expect(method).toMatch(/git rm -q (?:-- )?\$\{lockPath\}/);
    expect(method).toContain("chore(locks): release lock for ${id}");
  });

  test("`LocalProvider.claimLock`'s shipped commit subject is what § 0.c and § 0.d name", () => {
    // The two prose surfaces and the code must agree about the witness; pinning
    // both and asserting they agree is follow-ups § 0m(c)'s prescription.
    //
    // RE-POINTED BY STE-461, AND DERIVED RATHER THAN RE-HARDCODED. Three private
    // copies of one string is the producer/consumer asymmetry this milestone has
    // now hit five times; the third copy is the one that goes stale. The
    // producer's subject is read OUT OF THE ASSIGNMENT — not out of the file,
    // because a bare `toContain` on the source is equally satisfied by the
    // module's own rationale comment, which cites the retired form four lines
    // above the live one — and the doc form is computed from it.
    const src = read(LOCAL_PROVIDER);
    expect(src).not.toBeNull();
    const m = /const subject = `(chore\(locks\): claim lock for \$\{id\})`/.exec(src!);
    expect(m).not.toBeNull();
    const docForm = m![1]!.replace("${id}", "<id>");
    expect(docForm).toBe("chore(locks): claim lock for <id>");
    expect(claimBulletModeNoneHalf()).toContain(docForm);
    // Quote-terminated, which is what the retired pin's TRAILING SPACE was
    // doing: proving nothing follows the id in the documented fence. The space
    // used to be the ` on <branch>` separator; the closing quote is now the
    // end of the subject, so the discrimination survives the rename.
    expect(verifyBullet()).toContain(`grep -Fxq "${docForm}"`);
  });
});

describe("AC-STE-457.4 — both caps hold, each on its OWN measurement", () => {
  test("skills/implement/SKILL.md stays inside the 358-line cap", () => {
    const body = read(IMPLEMENT_SKILL);
    expect(body).not.toBeNull();
    // Counted the way the enforcing cap counts it — `split("\n").length`, which
    // is `wc -l` + 1 on a trailing-newline file. Measuring it any other way
    // reports a number the gate does not use.
    const lines = body!.split("\n").length;
    expect(lines).toBeLessThanOrEqual(358);
    // NOT `toBe(342)`. The first draft pinned the whole file's line count
    // exactly, which is stricter than the AC (≤ 358, with 16 lines of
    // authorized headroom) and would red THIS test — whose message names
    // STE-457's rewrite — for any future unrelated line added to the most-run
    // skill the toolkit ships. The cheapest way out of that red looks like
    // "bump the number", which is how a cap stops meaning anything.
    //
    // What the FR actually claims is that the rewrite was IN PLACE, and that is
    // a property of the two bullets, not of the file: both subjects are single
    // physical lines, so rewriting them cost zero lines regardless of what else
    // the file gains later. Measured at 342 before and after.
    const at0c = body!.split("\n").findIndex((l) => l.includes("**0.c Claim**"));
    const at0d = body!.split("\n").findIndex((l) => l.includes("**0.d Claim verification"));
    expect(at0d).toBe(at0c + 1); // still adjacent single-line bullets
  });

  test("the change adds ZERO internal-namespace tokens under skills/", () => {
    // The ceiling is 246 and `skills/` sits AT it — there is no headroom, so
    // "≤ ceiling" and "added zero" are the same assertion only if the total is
    // pinned exactly.
    expect(countNamespaceTokens(join(PLUGIN_ROOT, "skills"))).toBe(246);
  });

  test("the two rewritten bullets themselves carry no namespace token", () => {
    // Scoped to the edit, so a future editor who adds a token to 0.c/0.d is RED
    // here even if they buy headroom by deleting one somewhere else.
    expect(claimBullet().match(NAMESPACE_TOKEN)).toBeNull();
    expect(verifyBullet().match(NAMESPACE_TOKEN)).toBeNull();
  });
});

describe("AC-STE-457.5 — the halt-outcome token is recorded exactly once", () => {
  test("`## Implementation notes` carries exactly one of the two literal tokens", () => {
    const body = read(FR_457);
    expect(body).not.toBeNull();
    // Anchored to the HEADING at line start, never `indexOf` on the bare
    // string: the AC's own text names that heading inline, and a plain
    // `indexOf` resolves to the AC and slices in both tokens — measured on a
    // predecessor, where it reported 2 for every possible outcome.
    const at = body!.search(/^## Implementation notes$/m);
    expect(at).toBeGreaterThan(-1);
    const notes = body!.slice(at);
    const fits = (notes.match(/zero_c_fits_inline/g) ?? []).length;
    const reopened = (notes.match(/zero_c_site_reopened/g) ?? []).length;
    expect(fits + reopened).toBeGreaterThan(0);
    expect(Math.min(fits, 1) + Math.min(reopened, 1)).toBe(1);
    // ANCHORED TO THE SHAPE OF A RECORD, not to a bare mention. The AC says the
    // notes must *record* an outcome; counting a token asserts only that the
    // string occurs. Measured: replacing the whole outcome section with
    // "### Budget notes — the budgets were not formally classified against
    // `zero_c_fits_inline`; nobody reached a verdict." kept all three tests
    // green. The negation of an outcome contains its token just as well as the
    // outcome does.
    expect(notes).toMatch(/^### The halt outcome — `(zero_c_fits_inline|zero_c_site_reopened)`$/m);
  });

  test("the halt token, if recorded, means the site question returned to the operator", () => {
    // Forcing function: `zero_c_site_reopened` and a shipped rewrite of § 0.c
    // are mutually exclusive. If the halt token is present the instruction must
    // NOT have been trimmed into place.
    //
    // SCOPED TO THE NOTES SECTION, and the first draft was not — it tested the
    // whole FR body, which carries BOTH tokens inside AC-STE-457.5's own text.
    // That draft read `halted === true` on a run that had not halted and would
    // have read it on every possible outcome, passing or failing for the same
    // wrong reason. Caught by execution, not by reading; it is STE-452's
    // `## Implementation notes` correction arriving in the FR that inherited it.
    const body = read(FR_457);
    expect(body).not.toBeNull();
    const notesAt = body!.search(/^## Implementation notes$/m);
    expect(notesAt).toBeGreaterThan(-1);
    const halted = /zero_c_site_reopened/.test(body!.slice(notesAt));
    if (halted) {
      expect(claimBulletModeNoneHalf()).not.toContain("adapters/_shared/src/local_provider.ts");
    } else {
      expect(claimBulletModeNoneHalf()).toContain("adapters/_shared/src/local_provider.ts");
    }
  });

  test("the plan's halt-condition section still offers both tokens", () => {
    const plan = read(PLAN_M121);
    expect(plan).not.toBeNull();
    expect(plan!).toContain("`zero_c_fits_inline`");
    expect(plan!).toContain("`zero_c_site_reopened`");
  });
});

describe("AC-STE-457.6 / .7 — the supersession is recorded and the migration verdict re-argued", () => {
  test("a § Recorded supersession entry names the exemption's origin criterion", () => {
    const plan = read(PLAN_M121);
    expect(plan).not.toBeNull();
    const at = plan!.indexOf("### Recorded supersession — AC-STE-101.5");
    expect(at).toBeGreaterThan(-1);
    const section = plan!.slice(at, plan!.indexOf("\n### ", at + 4));
    // THE DISCRIMINATOR IS THE RECORD, and this pin has to see it flip.
    //
    // The first draft asserted the section merely MENTIONED `vacuous`,
    // `local-no-tracker`, a lock artifact and the word `weaken`. Measured:
    // inverting the entry's whole point — rewriting "**False of the lock
    // artifact.**" to "**Also of the lock file.**", which turns the record into
    // an agreement with the exemption it supersedes — reddened NOTHING. Every
    // mention survived the inversion because mentions are not the mechanism
    // (docs/patterns.md Pattern 31; `specs/plan/M121.md` § Milestone finding).
    // Both halves of the discrimination are now pinned as the bolded claims a
    // reader acts on, and the true/false asymmetry is asserted directly.
    expect(section).toContain("- **True of the tracker assertion.**");
    expect(section).toContain("- **False of the lock artifact.**");
    // …and the reason each way, so the labels cannot be swapped onto the wrong
    // subject while the two literals above stay satisfied.
    const trueArm = section.slice(
      section.indexOf("- **True of the tracker assertion.**"),
      section.indexOf("- **False of the lock artifact.**"),
    );
    const falseArm = section.slice(section.indexOf("- **False of the lock artifact.**"));
    expect(trueArm).toMatch(/local-no-tracker/);
    expect(trueArm).toMatch(/vacuous/i);
    expect(falseArm).toMatch(/\.dpt\/locks\/<id>/);
    expect(falseArm).toMatch(/Neither is a sentinel/i);
    // NOT `/nothing is weakened|weaken/i`. The second alternative is a
    // SUBSTRING of the first, so the alternation silently collapses to
    // `/weaken/i` — measured: inverting the headline to "AC-STE-101.5's guard
    // is weakened and its criterion is amended" was GREEN. The pin guarding
    // Pattern 31 could not see a recorded weakening.
    expect(section).toContain("Nothing is weakened and no criterion is amended");
  });

  test("the blast-radius table covers EVERY shipped surface this FR touched", () => {
    // NOT a bare `rows.length === 5`. That pin certified the number the author
    // wrote, never whether the list covered the change — and it passed while
    // the table omitted `docs/implement-reference.md`, the direct subject of
    // AC-STE-457.3. The table's own stated purpose is to be audited against
    // rather than taken on faith, so the pin now names the set.
    const plan = read(PLAN_M121);
    expect(plan).not.toBeNull();
    // ONE reader of the table, not two. This test used to slice the table
    // inline — same header literal, same `\n|---|` separator, same row filter —
    // and then call `tableSurfaceRows` four lines further down for the count
    // comparison. Two implementations of "the rows of this table" inside one
    // test function is STE-451's correction #40 in miniature: editing one
    // leaves the other green, so the coverage pin below could go on reading a
    // table the count pin had stopped agreeing with.
    //
    // The inline copy's own guard is not lost, it is strengthened. It asserted
    // `start > -1` — the table exists. `tableSurfaceRows` THROWS with the
    // header it looked for when the table is absent, when the separator row is
    // missing, and it falls back to end-of-document rather than the `-1` an
    // unfound `\n\n` would have silently fed to `slice`.
    const rows = tableSurfaceRows(plan!);
    // Every shipped (consumer-facing) file STE-457 modified must appear.
    for (const surface of [
      "skills/implement/SKILL.md",
      "docs/implement-reference.md",
      "docs/workflow-overview.md",
    ]) {
      expect(rows.some((r) => r.includes(surface) && r.includes("STE-457"))).toBe(true);
    }
    // …and the prose count must agree with the table rather than lag it.
    //
    // DERIVED, NOT RESTATED (AC-STE-460.10). This was a pair of hardcoded
    // constants — the count sentence spelled out as a string literal, beside
    // the same number written again as a row-count — which went stale four
    // times, once per milestone growth. Correcting them a fifth time would
    // reproduce the mechanism; deriving retires it. Both sides are now read
    // from the plan itself, from DIFFERENT expressions that are
    // blind to each other: `proseSurfaceCount` parses only the sentence,
    // `tableSurfaceRows` parses only the table. That blindness is measured in
    // tests/m121-ste-460-blast-radius.test.ts; collapsing the two readers into
    // one would make this line incapable of failing.
    expect(proseSurfaceCount(plan!)).toBe(tableSurfaceRows(plan!).length);
  });

  test("`migration: none` is RE-ARGUED against the widened set, not inherited", () => {
    const plan = read(PLAN_M121);
    expect(plan).not.toBeNull();
    expect(plan!).toMatch(/^migration: none$/m);
    // The re-argument must name what the fifth surface changes and why it still
    // needs no `/upgrade` — an inherited verdict says nothing about the surface
    // that was added after it was reached.
    expect(plan!).toMatch(/re-argued|RE-ARGUED/);
    const at = plan!.search(/re-argued|RE-ARGUED/);
    const window = plan!.slice(at, at + 1600);
    expect(window).toMatch(/skills\/implement\/SKILL\.md/);
    // BOTH specifics required. The first draft's third alternative,
    // `/convention/i`, was satisfied by the FOLLOWING paragraph ("but it is not
    // a *convention* change") rather than by the re-argument — measured by
    // gutting the clause the first two arms target and staying GREEN.
    expect(window).toMatch(/no file layout moves/);
    expect(window).toMatch(/no frontmatter key is added or renamed/);
  });
});

describe("AC-STE-457.8 — the doc-level asymmetry is filed as a PREFERENCE, not a deferred fix", () => {
  test("follow-ups carries an entry naming probe #37 and the unmeasured cost", () => {
    const notes = read(FOLLOW_UPS);
    expect(notes).not.toBeNull();
    expect(notes!).toMatch(/probe #37/);
    expect(notes!).toMatch(/nothing broken, only uneven/i);
  });

  test("the entry declares its own class so a later reader cannot mistake it for a gap", () => {
    const notes = read(FOLLOW_UPS);
    expect(notes).not.toBeNull();
    const at = notes!.indexOf("nothing broken, only uneven");
    expect(at).toBeGreaterThan(-1);
    const window = notes!.slice(Math.max(0, at - 1200), at + 1200);
    expect(window).toMatch(/preference/i);
    expect(window).toMatch(/not a deferred fix|is not filed as a deferred fix/i);
    expect(window).toMatch(/unmeasured/i);
  });

  test("§ 0j — the entry this FR closes — is marked CLOSED in the same change", () => {
    const notes = read(FOLLOW_UPS);
    expect(notes).not.toBeNull();
    const at = notes!.indexOf("### 0j.");
    expect(at).toBeGreaterThan(-1);
    const section = notes!.slice(at, notes!.indexOf("\n### ", at + 4));
    expect(section).toMatch(/CLOSED/);
  });
});

describe("AC-STE-457.9 — the honest boundary is carried in the FR's own words", () => {
  test("`## Notes` states that no offline test proves a child FOLLOWS the prose", () => {
    const body = read(FR_457);
    expect(body).not.toBeNull();
    // SCOPED TO `## Notes`, which is what the AC names. The first draft asserted
    // this document-wide and went VACUOUS the moment this same FR restated the
    // boundary in `## Implementation notes` — measured: deleting the sentence
    // from `## Notes` reddened nothing, because the restatement satisfied the
    // pin. `follow-ups.md` § 0i's once-occurring-token class, created here by
    // the FR's own prose rather than inherited.
    const start = body!.search(/^## Notes$/m);
    expect(start).toBeGreaterThan(-1);
    const end = body!.search(/^## Implementation notes$/m);
    expect(end).toBeGreaterThan(start);
    const notes = body!.slice(start, end);
    expect(notes).toContain(
      "no offline test can prove a `claude -p` child FOLLOWS the improved prose; only the next conformance run shows that, which is why the detection ships first",
    );
  });
});

describe("the detector transition — the predecessor's live-defect input has expired", () => {
  test("the ordering-arrow assertion is RETIRED, not left asserting a defect that is fixed", () => {
    // The detector suite shipped an assertion whose documented job was to
    // announce this FR's landing by going RED, with its own instruction: retire
    // it and record that every subsequent proof is against a reconstruction.
    // The title pin is the retirement RECORD; the behaviour is asserted below.
    const suite = read(DETECTOR_SUITE);
    expect(suite).not.toBeNull();
    expect(suite!).toContain("the ordering arrow has TURNED");
  });

  test("the retired assertion's replacement asserts the NEW state, not nothing", () => {
    // ASSERTS THE BEHAVIOUR, NOT THE OTHER FILE'S SOURCE TEXT.
    //
    // The first draft grepped the detector suite's source for the literal
    // `expect(bullet).toContain("adapters/_shared/src/local_provider.ts")`.
    // Measured: COMMENTING OUT that line and replacing it with
    // `expect(true).toBe(true)` kept both suites GREEN — a raw substring search
    // over a test file cannot tell "the assertion exists as characters" from
    // "the assertion runs", so a neutered detector reads exactly like a live
    // one. Rider 1's shape, one level up: the pin was on text, not on effect.
    //
    // The two facts the retirement is supposed to guarantee are asserted here
    // directly, against the skill itself.
    const body = read(IMPLEMENT_SKILL);
    expect(body).not.toBeNull();
    const lines = body!.split("\n");
    const claim = lines.filter((l) => l.includes("**0.c Claim**"));
    const provider = lines.filter((l) => l.includes("**0.b Provider resolution**"));
    expect(claim).toHaveLength(1);
    expect(provider).toHaveLength(1);
    expect(claim[0]!).toContain("adapters/_shared/src/local_provider.ts");
    expect(provider[0]!).not.toContain("adapters/_shared/src/local_provider");
  });
});
