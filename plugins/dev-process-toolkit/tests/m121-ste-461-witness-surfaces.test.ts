// M121 / STE-461 — the SURFACE half. AC.9–AC.14.
//
// The claim subject is a wire between four kinds of surface: the producer
// (`local_provider.ts`), the prose a model executes (`skills/implement/SKILL.md`
// § 0.c/0.d and `docs/implement-reference.md` § Phase 4 Close), the smoke
// driver's executed fences, and the suites that pin all of them. Renaming the
// subject on one side and not the others is the producer/consumer asymmetry
// this milestone has now hit four times, and each time the suite stayed green
// because both sides had their own private literal.
//
// SO THE PINS HERE ARE DERIVED WHERE THEY CAN BE, AND EXECUTED WHERE THEY
// MATTER. The witness fence and the ownership predicate are lifted out of the
// shipped prose and RUN against a repo a real `LocalProvider.claimLock` wrote —
// so "the documented check passes" is measured rather than asserted about text.
//
// WHAT AC-STE-461.13 DELIBERATELY DOES NOT CLAIM, restated here because the
// temptation to claim it is exactly how a reviewer stops trusting the rest: two
// existing pins (`m121-ste-457`'s `for <id> ` containment and
// `m121-ste-451`'s `--grep` literal, which truncates before ` on `) were
// MEASURED and neither is a reliable detector of this change. No assertion in
// this file claims they redden, and none claims they do not — they are simply
// not this FR's evidence.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { bashFences } from "./_fence";
import { CLAIM_FENCE_NEGATIVES } from "./_claim-fence-negatives";
import {
  AC9_WINDOW_HEADROOM,
  ac9BudgetFailures,
  assertAnchorUnique,
} from "./_ac9-row-guard";
import {
  attempt,
  buildHookedFixture,
  CLAIM_SUBJECT_PREFIX,
  cleanup,
  git,
  gitTry,
  lastSubject,
  porcelain,
  PLUGIN_ROOT,
  provider,
  REPO_ROOT,
} from "./_hooked-lock-fixture";

const IMPLEMENT_SKILL = join(PLUGIN_ROOT, "skills/implement/SKILL.md");
const IMPLEMENT_REFERENCE = join(PLUGIN_ROOT, "docs/implement-reference.md");
const LOCAL_PROVIDER = join(PLUGIN_ROOT, "adapters/_shared/src/local_provider.ts");
const SMOKE_SKILL = join(REPO_ROOT, ".claude/skills/smoke-test/SKILL.md");

// AC-STE-459.2's live-then-archive conditional — the house shape at
// `m108-ste-393-docs-pins.test.ts:99`. Seven assertions in the sibling suite
// went red on archival before STE-459; this file is written to survive it.
const FR_461 = existsSync(join(REPO_ROOT, "specs/frs/STE-461.md"))
  ? join(REPO_ROOT, "specs/frs/STE-461.md")
  : join(REPO_ROOT, "specs/frs/archive/STE-461.md");

function read(path: string): string {
  return readFileSync(path, "utf8");
}

/** The `0.d Claim verification` bullet, resolved BY NAME and asserted unique. */
function verifyBullet(): string {
  const lines = read(IMPLEMENT_SKILL).split("\n").filter((l) => l.includes("**0.d Claim verification"));
  expect(lines).toHaveLength(1);
  return lines[0]!;
}

/** The `0.c Claim` bullet, resolved BY NAME and asserted unique. */
function claimBullet(): string {
  const lines = read(IMPLEMENT_SKILL).split("\n").filter((l) => l.includes("**0.c Claim**"));
  expect(lines).toHaveLength(1);
  return lines[0]!;
}

/** The tracker-less HALF of 0.c. Scoped, because 0.b′/0.b″ already carry module paths. */
function claimBulletModeNoneHalf(): string {
  const bullet = claimBullet();
  const at = bullet.indexOf("`mode: none`:");
  expect(at).toBeGreaterThan(-1);
  const half = bullet.slice(at);
  expect(half.length).toBeGreaterThan(120);
  return half;
}

/** `docs/implement-reference.md` § Phase 4 Close step (c), sliced between its siblings. */
function phase4CloseStepC(): string {
  const body = read(IMPLEMENT_REFERENCE);
  const start = body.indexOf("**(c) Post-release verification**");
  expect(start).toBeGreaterThan(-1);
  const end = body.indexOf("**Abort boundary", start);
  expect(end).toBeGreaterThan(start);
  const slice = body.slice(start, end);
  // Non-vacuity: the slice must still carry the tracker-side assertion it guards.
  expect(slice).toContain("status_mapping.done");
  return slice;
}

const GROUP10_RE = /#### Fixture group 10 — [\s\S]*?(?=\n#### |\n### |$)/;

function group10Section(): string {
  const m = GROUP10_RE.exec(read(SMOKE_SKILL));
  expect(m).not.toBeNull();
  return m![0];
}

/** Every fence in group 10 that carries the claim-subject grep. */
function claimFences(): string[] {
  return bashFences(group10Section()).filter((f) => /--grep="[^"]*claim lock for/.test(f));
}

/** The `--grep="…"` pattern a fence carries. */
function grepPattern(fence: string): string {
  const m = /--grep="([^"]*)"/.exec(fence);
  expect(m).not.toBeNull();
  return m![1]!;
}

const NAMESPACE_TOKEN = /\b(STE|AC-STE)-\d+(?:\.\d+)?\b/g;

function countNamespaceTokens(dir: string): number {
  let total = 0;
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) total += countNamespaceTokens(p);
    else if (entry.endsWith(".md")) total += (read(p).match(NAMESPACE_TOKEN) ?? []).length;
  }
  return total;
}

/**
 * The retired branch-bearing SUBJECT — one definition, read by the sweep and by
 * the falsifiability arm that proves the sweep can fail.
 *
 * It was two private copies, one per test, which is STE-451's correction #40
 * and the defect this milestone has now retired five times: editing the sweep's
 * copy would have left the falsifiability copy green, certifying a detector
 * nothing had checked.
 */
// The id slot accepts ANY spelling, not just the two this FR happened to write.
// MEASURED GAP this closes: the alternation was `(?:<id>|\$\{id\})`, which is
// blind to the smoke driver's own `${FR_ID:-__unresolved__}` — and `.claude/skills`
// IS a sweep root — as well as to a literal `fr_01HZ…`, `<ulid>` and `<FR-id>`.
// The sweep's claim is "no SHIPPED surface still carries the branch-bearing
// form"; an alternation enumerating two spellings cannot support it, and an
// enumeration is what this FR has already been wrong about twice.
// The `chore(locks): ` prefix is retained deliberately and is pinned in both
// directions below — it is what keeps the sweep off the producer's own
// ellipsized rationale comment, which records the defect rather than repeating it.
const RETIRED_SUBJECT = /chore\(locks\): claim lock for \S{1,60} on /;

const ID = "fr_01HZ7XJFKP0000000000000W1A";
const BRANCH = "feat/m121-mode-none-conformance-leg";
const OTHER_BRANCH = "feat/m121-someone-elses-branch";

/**
 * Substitute the doc's placeholders into a runnable command, LOUDLY.
 *
 * A substitution that silently misses turns an executed pin into a command
 * about `<id>` — which matches nothing, so the negative arm passes and the
 * positive arm fails for a reason that has nothing to do with the subject.
 */
function fill(command: string, subs: Record<string, string>): string {
  let out = command;
  for (const [from, to] of Object.entries(subs)) {
    if (!out.includes(from)) {
      throw new Error(`fill: the placeholder ${from} is absent from ${JSON.stringify(command)}`);
    }
    out = out.split(from).join(to);
  }
  return out;
}

function sh(cwd: string, command: string): { exitCode: number; stdout: string } {
  const p = Bun.spawnSync({ cmd: ["sh", "-c", command], cwd });
  return { exitCode: p.exitCode, stdout: new TextDecoder().decode(p.stdout).trim() };
}

// ══════════ AC-STE-461.9 — the witness conjunct drops the branch ═════════════

describe("AC-STE-461.9 — § 0.d's witness conjunct is subject-only, with no branch component", () => {
  test("the documented fence is the fixed-string, whole-line, branch-free form", () => {
    const bullet = verifyBullet();
    expect(bullet).toContain(
      'git log --format=%s | grep -Fxq "chore(locks): claim lock for <id>"',
    );
    // The retired form is pinned to ZERO document-wide, not merely absent from
    // the bullet — a branch-pinned witness that returns anywhere in this
    // document is a witness that fails on every branch over ten characters.
    expect(read(IMPLEMENT_SKILL)).not.toContain("claim lock for <id> on <currentBranch>");
    expect(read(IMPLEMENT_SKILL)).not.toContain("claim lock for <id> on <branch>");
  });

  test("the four properties the form closes are still stated, so a future edit knows the cost", () => {
    const bullet = verifyBullet();
    expect(bullet).toMatch(/subject-only/i);
    expect(bullet).toMatch(/fixed-string/i);
    expect(bullet).toMatch(/whole-line/i);
    // `--grep` anchors `^` at every line, which is why this is not a `--grep`.
    expect(bullet).toMatch(/anchors\s+`\^`\s+at every line/i);
  });

  test("EXECUTED: the documented fence finds a real claimLock witness, and nothing else", async () => {
    const f = buildHookedFixture({ branch: BRANCH, commitMsgHook: "shell", label: "ste461-witness" });
    try {
      const claimed = await attempt(() => provider(f).claimLock(ID, BRANCH));
      expect({ threw: claimed.threw, message: claimed.message }).toEqual({
        threw: false,
        message: null,
      });
      const bullet = verifyBullet();
      const m = /git log --format=%s \| grep -Fxq "[^"]*"/.exec(bullet);
      expect(m).not.toBeNull();
      const command = fill(m![0]!, { "<id>": ID });

      // Positive: the real witness is found.
      expect(sh(f.root, command).exitCode).toBe(0);

      // Negative, and it has to be a DISCRIMINATING one. `grep -Fxq` is
      // whole-line, so a commit whose BODY quotes the subject must not
      // certify a claim — that is the defect `--grep` had.
      const g = buildHookedFixture({ branch: BRANCH, commitMsgHook: "shell", label: "ste461-quote" });
      try {
        git(
          g.root,
          "commit",
          "--allow-empty",
          "--quiet",
          "-m",
          `docs(notes): record the witness\n\n${CLAIM_SUBJECT_PREFIX}${ID}\n`,
        );
        expect(sh(g.root, command).exitCode).not.toBe(0);
      } finally {
        cleanup(g);
      }
    } finally {
      cleanup(f);
    }
  }, 60_000);
});

// ═══════ AC-STE-461.10 — ownership re-homed to the lock's own branch line ════

describe("AC-STE-461.10 — the ownership conjunct is the producer's own predicate", () => {
  test("§ 0.d carries the ownership conjunct, byte-identically to local_provider.ts's predicate", () => {
    // DERIVED, not restated. The producer decides `already-ours` with
    // `existing.includes(\`branch: ${branch}\`)`; the literal is lifted out of
    // the source and translated into the doc's placeholder, so a rename on
    // either side turns this red instead of leaving two independently-worded
    // restatements of one rule.
    const src = read(LOCAL_PROVIDER);
    const m = /includes\(`([^`]*\$\{branch\})`\)/.exec(src);
    expect(m).not.toBeNull();
    const producerLiteral = m![1]!;
    expect(producerLiteral).toBe("branch: ${branch}");
    const docForm = producerLiteral.replace("${branch}", "<currentBranch>");
    expect(verifyBullet()).toContain(`grep -Fxq "${docForm}" .dpt/locks/<id>`);
  });

  test("the two conjuncts are REQUIRED TOGETHER — a conjunction, never alternatives", () => {
    const bullet = verifyBullet();
    const witnessAt = bullet.indexOf('grep -Fxq "chore(locks): claim lock for <id>"');
    const ownershipAt = bullet.indexOf('grep -Fxq "branch: <currentBranch>" .dpt/locks/<id>');
    expect(witnessAt).toBeGreaterThan(-1);
    expect(ownershipAt).toBeGreaterThan(-1);
    const between = bullet.slice(
      Math.min(witnessAt, ownershipAt),
      Math.max(witnessAt, ownershipAt),
    );
    expect(between).toContain("AND");
    expect(between).not.toMatch(/\bOR\b|\beither\b/);
  });

  test("EXECUTED: both documented conjuncts pass on a real claim, and ownership discriminates", async () => {
    const f = buildHookedFixture({ branch: BRANCH, commitMsgHook: "shell", label: "ste461-own" });
    try {
      expect((await attempt(() => provider(f).claimLock(ID, BRANCH))).threw).toBe(false);
      const bullet = verifyBullet();
      const ownership = /grep -Fxq "branch: <currentBranch>" \.dpt\/locks\/<id>/.exec(bullet);
      expect(ownership).not.toBeNull();
      const mine = fill(ownership![0]!, { "<currentBranch>": BRANCH, "<id>": ID });
      const theirs = fill(ownership![0]!, { "<currentBranch>": OTHER_BRANCH, "<id>": ID });
      expect(sh(f.root, mine).exitCode).toBe(0);
      // Falsifiable: the conjunct really reads the branch, it is not a
      // presence check on the file wearing a branch-shaped argument.
      expect(sh(f.root, theirs).exitCode).not.toBe(0);
    } finally {
      cleanup(f);
    }
  }, 30_000);

  test("EXECUTED: the invariant the dedup DROPS — witness and lock agree AT WRITE TIME", async () => {
    // NAMED, NOT ASSUMED AWAY. The retired 0.d form asserted the branch in the
    // WITNESS COMMIT and the branch in the LOCK FILE were the same string,
    // because both were read out of one subject. The new pair checks each
    // separately and never cross-checks them.
    //
    // What is still true, and is asserted here rather than hoped for:
    // agreement holds BY CONSTRUCTION at write time — both come from the single
    // `branch` argument of a single `claimLock` call.
    //
    // THE RESIDUAL, stated plainly: post-hoc editing of a committed lock is
    // outside the documented threat model (`specs/requirements.md` — tracker-less
    // locking detects cross-tree collision, it does not prevent it), so nothing
    // here or in § 0.d re-checks agreement after the fact. This is STE-460
    // AC.3's measured lesson applied forward: replacing a by-construction
    // guarantee with a lookup silently drops the guarantee unless it is
    // re-asserted, so it is re-asserted at the only point where it is decidable.
    const f = buildHookedFixture({ branch: BRANCH, commitMsgHook: "shell", label: "ste461-agree" });
    try {
      expect((await attempt(() => provider(f).claimLock(ID, BRANCH))).threw).toBe(false);
      expect(lastSubject(f)).toBe(`${CLAIM_SUBJECT_PREFIX}${ID}`);
      const lock = read(join(f.root, ".dpt", "locks", ID));
      expect(lock).toContain(`ulid: ${ID}`);
      expect(lock.split("\n").filter((l) => l.startsWith("branch: "))).toEqual([
        `branch: ${BRANCH}`,
      ]);
      // …and the witness commit is the one that CREATED that lock, so the two
      // observations are about the same event rather than about two states that
      // happen to coexist.
      const touched = gitTry(
        f.root,
        "log",
        "--format=%s",
        "-1",
        "--",
        `.dpt/locks/${ID}`,
      ).stdout.trim();
      expect(touched).toBe(`${CLAIM_SUBJECT_PREFIX}${ID}`);
      expect(porcelain(f)).toBe("");
    } finally {
      cleanup(f);
    }
  }, 30_000);

  test("the FR records the residual rather than papering over it", () => {
    const fr = read(FR_461);
    expect(fr).toMatch(/residual is narrow and named/i);
  });
});

// ═══════ AC-STE-461.11 — three states, three messages, one of them (c) ═══════

describe("AC-STE-461.11 — § 0.d names WHICH conjunct failed", () => {
  test("state (a) — neither conjunct: no claim ever fired, remedy is to run 0.c", () => {
    const bullet = verifyBullet();
    expect(bullet).toMatch(/neither/i);
    expect(bullet).toMatch(/run 0\.c/);
  });

  test("state (b) — witness present, ownership false: that is taken-elsewhere, not yours", () => {
    const bullet = verifyBullet();
    expect(bullet).toMatch(/taken-elsewhere/);
    // The remedy has to name where the other holder is recorded, because the
    // whole point of re-homing ownership is that the lock file answers it.
    expect(bullet).toMatch(/`branch:`/);
  });

  test("state (c) — lock present, witness absent: the rollback did not complete", () => {
    const bullet = verifyBullet();
    expect(bullet).toContain("Lock present but no matching commit");
    expect(bullet).toContain(".dpt/locks/<id>");
    // …and it must NOT prescribe re-running 0.c, which repeats the failure.
    expect(bullet).toMatch(/do NOT prescribe re-running 0\.c/);
  });

  test("the three are DISTINCT — a single undifferentiated refusal fails at least two", () => {
    // Collapsing the three into one refusal is the RED-producing input the AC
    // names. Counting the three state markers is what makes that collapse
    // visible; a shared remedy sentence is not enough to satisfy all three.
    const bullet = verifyBullet();
    const markers = [/neither/i, /taken-elsewhere/, /Lock present but no matching commit/];
    expect(markers.map((re) => re.test(bullet))).toEqual([true, true, true]);
    // State (c) must be the one that withholds the 0.c remedy, so the three
    // cannot be satisfied by one message that mentions everything.
    expect(bullet).toMatch(/do NOT prescribe re-running 0\.c/);
  });
});

// ═════════ AC-STE-461.12 — both executed fences anchor, and still work ═══════

describe("AC-STE-461.12 — the smoke driver's claim fences follow the subject", () => {
  test("group 10 carries claim fences at all, so nothing below is vacuous", () => {
    expect(claimFences().length).toBeGreaterThanOrEqual(2);
  });

  test("every claim fence anchors with `$`, drops the trailing space, and KEEPS --basic-regexp", () => {
    const rows = claimFences().map((fence, i) => {
      const pattern = grepPattern(fence);
      return {
        fence: i,
        pattern,
        anchoredStart: pattern.startsWith("^"),
        anchoredEnd: pattern.endsWith("$"),
        // The trailing space the `$` replaces. Measured on the pattern with the
        // anchor stripped, because ` $` would satisfy a naive `endsWith("$")`
        // while still requiring the retired ` on <branch>` tail to follow.
        trailingSpace: pattern.replace(/\$$/, "").endsWith(" "),
        basicRegexp: fence.includes("--basic-regexp"),
      };
    });
    for (const row of rows) {
      expect(row).toEqual({
        fence: row.fence,
        pattern: row.pattern,
        anchoredStart: true,
        anchoredEnd: true,
        trailingSpace: false,
        basicRegexp: true,
      });
    }
  });

  test("the comment explaining why --basic-regexp is load-bearing survives the edit", () => {
    // It is the one thing in group 10 that a reader would delete as noise, and
    // deleting it is how the flag comes off in the next cleanup — after which a
    // healthy run reports `claim-commit none` under `grep.patternType=extended`.
    const section = group10Section();
    expect(section).toMatch(/--basic-regexp is LOAD-BEARING/);
    expect(section).toMatch(/capture group/i);
  });

  test("EXECUTED: each shipped fence finds a real claimLock witness; a one-byte rewording does not", async () => {
    const f = buildHookedFixture({ branch: BRANCH, commitMsgHook: "shell", label: "ste461-fence" });
    try {
      expect((await attempt(() => provider(f).claimLock(ID, BRANCH))).threw).toBe(false);
      const fences = claimFences();
      for (const [i, fence] of fences.entries()) {
        const pattern = grepPattern(fence)
          .replace("${FR_ID:-__unresolved__}", ID)
          .replace("${FR_ID}", ID);
        // A substitution that silently missed would leave `${FR_ID}` in the
        // pattern, which matches nothing — the positive arm would fail and the
        // negative arm would pass, both for the wrong reason.
        expect({ fence: i, substituted: !pattern.includes("${FR_ID") }).toEqual({
          fence: i,
          substituted: true,
        });
        const found = sh(
          f.root,
          `git log --format=%H -1 --basic-regexp --grep=${JSON.stringify(pattern)}`,
        );
        expect({ fence: i, found: found.stdout.length > 0 }).toEqual({ fence: i, found: true });
      }

      // A one-byte rewording of the SUBJECT returns nothing, for every fence.
      git(
        f.root,
        "commit",
        "--quiet",
        "--amend",
        "-m",
        `${CLAIM_SUBJECT_PREFIX}${ID}`.replace("claim lock", "claim Lock"),
      );
      for (const [i, fence] of fences.entries()) {
        const pattern = grepPattern(fence)
          .replace("${FR_ID:-__unresolved__}", ID)
          .replace("${FR_ID}", ID);
        const found = sh(
          f.root,
          `git log --format=%H -1 --basic-regexp --grep=${JSON.stringify(pattern)}`,
        );
        expect({ fence: i, found: found.stdout.length > 0 }).toEqual({ fence: i, found: false });
      }
    } finally {
      cleanup(f);
    }
  }, 60_000);

  test("EXECUTED: no negative in the shared table collides with the NEW healthy subject", async () => {
    // STE-460's negative table was built when the healthy subject still carried
    // ` on <branch>`, and one of its arms — `trailing-space-drop` — uses the
    // branch-free subject AS ITS NEGATIVE. That arm becomes the healthy subject
    // the moment this FR lands, which would turn AC-STE-460.3's "no negative
    // collides with the healthy one" into an assertion that a HEALTHY run is
    // unwitnessed: a false RED wearing a green label. Asserted here against the
    // real subject so the table moves in the same commit as the producer.
    const f = buildHookedFixture({ branch: BRANCH, commitMsgHook: "shell", label: "ste461-negs" });
    try {
      expect((await attempt(() => provider(f).claimLock(ID, BRANCH))).threw).toBe(false);
      const healthy = lastSubject(f);
      expect(
        CLAIM_FENCE_NEGATIVES.map((n) => ({
          label: n.label,
          collides: n.subject(ID, BRANCH) === healthy,
        })),
      ).toEqual(CLAIM_FENCE_NEGATIVES.map((n) => ({ label: n.label, collides: false })));
    } finally {
      cleanup(f);
    }
  }, 30_000);
});

// ═══════════ AC-STE-461.13 — every pinning site moves in one commit ══════════

describe("AC-STE-461.13 — the subject is renamed everywhere it is carried", () => {
  test("docs/implement-reference.md § Phase 4 Close (c) carries the NEW subject — the site that was pinned by nothing", () => {
    // THIS ASSERTION IS THE PIN THE AC REQUIRES. Before it, the reference doc
    // carried the claim subject verbatim while no test read it, so a rename
    // could leave it stale under a fully green gate — the same producer/consumer
    // asymmetry one surface further out.
    const stepC = phase4CloseStepC();
    expect(stepC).toContain("`chore(locks): claim lock for <id>` commit");
    expect(stepC).not.toContain("claim lock for <id> on <branch>");
  });

  test("§ 0.c's tracker-less half names the subject it now produces", () => {
    expect(claimBulletModeNoneHalf()).toContain("chore(locks): claim lock for <id>");
    expect(claimBulletModeNoneHalf()).not.toContain("claim lock for <id> on <branch>");
  });

  test("no SHIPPED surface still carries the branch-bearing form", () => {
    // The sweep, scoped to what ships. `specs/` is history (follow-ups and
    // archived FRs record the defect verbatim and must keep doing so), and
    // `*.test.ts` files legitimately quote the retired form while asserting it
    // is gone.
    //
    // THE DETECTOR IS THE RETIRED *SUBJECT*, PREFIX AND ALL — and the prefix is
    // load-bearing rather than decorative. Without `chore(locks): ` the sweep
    // also fires on `local_provider.ts`'s own rationale comment, which cites the
    // retired form ELLIPSIZED (`… claim lock for <id> on <branch>`) in order to
    // explain why the subject stopped scaling with the branch. That citation is
    // the same category as the `specs/` and `*.test.ts` exclusions above: a
    // record of the defect, not an instruction to reproduce it, and it cannot be
    // copy-pasted as a subject because it carries no subject prefix.
    //
    // NOTHING IS LOST BY THE CARVE-OUT, and that is measured rather than
    // asserted: the producer module's LIVE template literal is pinned twice
    // independently — positively below ("the producer and both prose surfaces
    // agree", which reads it out of the source) and negatively at
    // `m121-ste-461-lock-commit-conformance.test.ts:308`
    // (`not.toContain("claim lock for ${id} on ${branch}")`). A regression that
    // restored the branch to the producer is RED at both, with or without this
    // sweep. What the sweep uniquely covers is the PROSE surfaces, and every
    // retired form they can carry is a full subject.
    //
    // The falsifiability arm below pins both directions of that boundary, so the
    // narrowing is a stated contract rather than a silent one.
    const roots = [
      join(PLUGIN_ROOT, "skills"),
      join(PLUGIN_ROOT, "docs"),
      join(PLUGIN_ROOT, "adapters"),
      join(PLUGIN_ROOT, "templates"),
      join(REPO_ROOT, ".claude/skills"),
    ];
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
          if (RETIRED_SUBJECT.test(line)) {
            offenders.push(`${p.slice(REPO_ROOT.length + 1)}:${i + 1}`);
          }
        }
      }
    };
    roots.forEach(walk);
    expect(offenders).toEqual([]);
  });

  test("the sweep is FALSIFIABLE — the retired form is what it detects", () => {
    // Without this the empty offender list above is equally produced by a regex
    // that matches nothing, which is the vacuity this milestone keeps finding.
    // Same expression the sweep runs — not a second copy of it.
    expect(RETIRED_SUBJECT.test("chore(locks): claim lock for <id> on <branch>")).toBe(true);
    expect(RETIRED_SUBJECT.test("chore(locks): claim lock for ${id} on ${branch}")).toBe(true);
    expect(RETIRED_SUBJECT.test("chore(locks): claim lock for <id> on <currentBranch>")).toBe(true);
    // The `[^\n]{0,4}` tolerance, exercised rather than assumed: a surface may
    // close a code span after the id and still be carrying the retired subject.
    expect(RETIRED_SUBJECT.test("chore(locks): claim lock for <id>`, on <branch>")).toBe(true);
    expect(RETIRED_SUBJECT.test("chore(locks): claim lock for <id>")).toBe(false);
    // THE BOUNDARY, PINNED IN BOTH DIRECTIONS. The ellipsized citation carries
    // no subject prefix and is deliberately OUT of scope — that is the sweep's
    // one carve-out, and it is stated here as an assertion rather than left to
    // be rediscovered by whoever next sees the sweep skip a line. Change this
    // row only together with the argument above for why nothing is lost.
    expect(RETIRED_SUBJECT.test("… claim lock for <id> on <branch>")).toBe(false);
  });

  test("the producer and both prose surfaces agree, derived from the producer", () => {
    // One reading, three consumers. The expected doc form is COMPUTED from the
    // module's own template literal, so a rename that updates the code and
    // forgets a document is red here rather than green on both private copies.
    const src = read(LOCAL_PROVIDER);
    const m = /`(chore\(locks\): claim lock for \$\{id\})`/.exec(src);
    expect(m).not.toBeNull();
    const docForm = m![1]!.replace("${id}", "<id>");
    expect(docForm).toBe("chore(locks): claim lock for <id>");
    expect(claimBulletModeNoneHalf()).toContain(docForm);
    expect(verifyBullet()).toContain(docForm);
    expect(phase4CloseStepC()).toContain(docForm);
  });
});

// ═══════════════════ AC-STE-461.14 — both budgets re-measured ════════════════

describe("AC-STE-461.14 — the driver edit stays inside every recorded budget", () => {
  test("the AC-STE-448.9 guarded windows still hold every pin, at the RECORDED headroom", () => {
    const driver = read(SMOKE_SKILL);
    expect(ac9BudgetFailures(driver)).toEqual([]);
    // The recorded figure is a NUMBER, compared as a number — the STE-460
    // correction. `headroom > 0` is satisfied by 1 exactly as well as by the
    // true figure, so positivity let the number every editor reads rot to
    // nothing while the assertion beside it stayed green.
    expect(typeof AC9_WINDOW_HEADROOM).toBe("number");
    expect(AC9_WINDOW_HEADROOM).toBeGreaterThan(0);
  });

  test("assertAnchorUnique still passes — the row guard's window has not relocated", () => {
    expect(() => assertAnchorUnique(read(SMOKE_SKILL))).not.toThrow();
  });

  test("skills/implement/SKILL.md stays within the 358-line cap, with its headroom recorded", () => {
    const body = read(IMPLEMENT_SKILL);
    // Counted the way the enforcing gate counts it — `split("\n").length`.
    const lines = body.split("\n").length;
    expect(lines).toBeLessThanOrEqual(358);
    // NOT `toBe(341)`. The AC is a cap plus recorded headroom, and pinning the
    // whole file exactly would red this test — whose message names STE-461 —
    // for any future unrelated line. What IS this FR's property is that the
    // rewrite cost zero lines: 0.c and 0.d are single physical bullets and
    // stayed adjacent.
    const at0c = body.split("\n").findIndex((l) => l.includes("**0.c Claim**"));
    const at0d = body.split("\n").findIndex((l) => l.includes("**0.d Claim verification"));
    expect(at0d).toBe(at0c + 1);
  });

  test("the run adds ZERO tracker tokens under skills/ — the ceiling is AT 246", () => {
    // There is no headroom, so "≤ ceiling" and "added zero" are only the same
    // assertion if the total is pinned exactly.
    expect(countNamespaceTokens(join(PLUGIN_ROOT, "skills"))).toBe(246);
  });

  test("the two rewritten bullets themselves carry no tracker token", () => {
    // Scoped to the edit, so an editor who adds a token to 0.c/0.d is red here
    // even if they buy headroom by deleting one elsewhere.
    expect(claimBullet().match(NAMESPACE_TOKEN)).toBeNull();
    expect(verifyBullet().match(NAMESPACE_TOKEN)).toBeNull();
  });
});
