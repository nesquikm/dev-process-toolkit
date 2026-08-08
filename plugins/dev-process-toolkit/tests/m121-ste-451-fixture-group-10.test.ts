// m121-ste-451-fixture-group-10 — fixture group 10, the tracker-less lock
// lifecycle.
//
// TWO LABELS, and the distinction is the honest part of this file.
//
//   EXECUTED — the thing under test is actually run. The clean fixture builds a
//     real git repository, calls the REAL `LocalProvider.claimLock`, and reads
//     the disk and the commit graph it produced. Nothing here is a grep over
//     prose describing what claimLock would do.
//   PROSE — the `#### Fixture group 10` block is an instruction to a model at
//     smoke-run time. A unit test cannot run a smoke run, so for those the only
//     honest assertions are existence, agreement with the roster, and scoped
//     bans on the shapes a regression would actually take.
//
// WHAT THIS FILE CANNOT CLAIM. It does not prove that a real `/implement` run
// under `mode: none` writes the lock. `claimLock` has no production caller —
// the only thing that causes it to run during `/implement` § 0.c is a one-line
// prose directive in `skills/implement/SKILL.md`. That gap is precisely what
// fixture group 10 exists to detect at runtime, and it is why the group is a
// test rather than a restatement: the code works, and whether the skill reaches
// it is an empirical question only a smoke run can answer. Recorded at
// `specs/notes/follow-ups.md` § 0j.
//
// PIN DISCIPLINE (docs/patterns.md § Pattern 31). Every ban below is scoped to
// the artifact that would carry the regression and matches an operative SHAPE,
// never an identifier — this block's own prose discusses group 9, the lock, and
// the phrase "already-ours" in order to explain them, so an identifier ban
// would fire on the explanation. Every ban is paired with a positive assertion,
// because "the bad string is gone" is also satisfied by deleting the rule.

import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CANONICAL_FIXTURE_GROUPS,
  SMOKE_LEGS,
  groupsCoveringLeg,
  reconcileFixtureGroups,
} from "../adapters/_shared/src/smoke_fixture_groups";
import { LocalProvider } from "../adapters/_shared/src/local_provider";
import { locksDir } from "../adapters/_shared/src/dpt_paths";
import { mintId } from "../adapters/_shared/src/ulid";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const SMOKE_SKILL = join(REPO_ROOT, ".claude/skills/smoke-test/SKILL.md");
const IMPLEMENT_SKILL = join(PLUGIN_ROOT, "skills/implement/SKILL.md");

function read(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

const smokeDoc = read(SMOKE_SKILL);
const implementDoc = read(IMPLEMENT_SKILL);
const describeIfSkills =
  smokeDoc === null || implementDoc === null ? describe.skip : describe;

// THE ANCHOR AGAINST THIS FILE SILENTLY VANISHING — deliberately NOT inside
// `describeIfSkills`. A wrong path turns every test below into `describe.skip`,
// which bun reports at rc 0, indistinguishable from a green run to anything
// reading the exit code. Same shape as STE-450's anchor, and for the same
// reason: this repository has got these paths wrong before.
describe("STE-451 — the documents under test were actually found", () => {
  test("both SKILL paths resolve, so the suite below is not silently skipped", () => {
    expect({ smoke: smokeDoc !== null, implement: implementDoc !== null }).toEqual({
      smoke: true,
      implement: true,
    });
  });
});

const GROUP = 10;
const TRACKERLESS_LEG = "none";
/** `fr_` + 26 Crockford base32 — the whole minted identity, 29 characters. */
const ID_RE = /^fr_[0-9A-HJKMNP-TV-Z]{26}$/;

/** The `#### Fixture group 10 — …` block, sliced the way STE-425's pin does. */
function group10Slice(): string {
  const re = /#### Fixture group 10 — [\s\S]*?(?=\n#### |\n### |$)/;
  return re.exec(smokeDoc ?? "")?.[0] ?? "";
}

// ═══════════════════════════ the executed harness ═══════════════════════════

interface Group10Fixture {
  root: string;
  /** The id the claim was made under. */
  frId: string;
  /** `frId.slice(23, 29)` — the FR's FILENAME stem, six of twenty-nine chars. */
  tail: string;
  branch: string;
}

function git(cwd: string, ...args: string[]): string {
  const p = Bun.spawnSync({ cmd: ["git", ...args], cwd });
  if (p.exitCode !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed in ${cwd}: ${new TextDecoder().decode(p.stderr)}`,
    );
  }
  return new TextDecoder().decode(p.stdout).trim();
}

/** git that is allowed to fail — used where absence is a legitimate answer. */
function gitSoft(cwd: string, ...args: string[]): string | null {
  const p = Bun.spawnSync({ cmd: ["git", ...args], cwd });
  if (p.exitCode !== 0) return null;
  return new TextDecoder().decode(p.stdout).trim();
}

/**
 * A real `mode: none` project: a git repo carrying one FR whose filename is the
 * short tail of a freshly minted id, with that id recorded in its frontmatter.
 * The claim is NOT made here — each test decides whether and how it happens, so
 * the suppression inputs are staged states rather than special-cased flags.
 */
function buildFixture(): Group10Fixture {
  const root = mkdtempSync(join(tmpdir(), "ste451-lock-"));
  const branch = "feat/m121-ste-451-fixture";
  git(root, "init", "--quiet");
  git(root, "symbolic-ref", "HEAD", `refs/heads/${branch}`);
  git(root, "config", "user.email", "ste451@example.invalid");
  git(root, "config", "user.name", "STE-451 Fixture");

  const frId = mintId();
  const tail = frId.slice(23, 29);
  mkdirSync(join(root, "specs", "frs"), { recursive: true });
  writeFileSync(
    join(root, "specs", "frs", `${tail}.md`),
    [
      "---",
      'title: "Group 10 fixture FR"',
      `id: ${frId}`,
      "milestone: M_FIXTURE",
      "status: active",
      "archived_at: null",
      "created_at: 2026-08-08T00:00:00Z",
      "---",
      "",
      "# Group 10 fixture FR",
      "",
      "## Requirement",
      "",
      "A tracker-less FR whose identity is minted rather than fetched.",
      "",
    ].join("\n"),
  );
  git(root, "add", "-A");
  git(root, "commit", "--quiet", "-m", "chore: seed the tracker-less fixture");
  return { root, frId, tail, branch };
}

function cleanup(f: Group10Fixture): void {
  rmSync(f.root, { recursive: true, force: true });
}

async function claim(f: Group10Fixture): Promise<void> {
  const provider = new LocalProvider({ repoRoot: f.root, skipFetch: true });
  await provider.claimLock(f.frId, f.branch);
}

/**
 * Resolve the identity the way sub-fixture 10c requires: by READING the FR's
 * recorded `id:`, never by deriving it from the file's name. The directory is
 * scanned rather than indexed by stem, because indexing by stem would smuggle
 * the filename back in as the source of truth.
 */
function recordedIdOf(root: string): string | null {
  const dir = join(root, "specs", "frs");
  if (!existsSync(dir)) return null;
  const ids = new Set<string>();
  // Top level only, mirroring the fence's `--exclude-dir=archive`: an archived
  // FR still carries its `id:`, so recursing would make every post-archival
  // tree look ambiguous.
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".md")) continue;
    const line = readFileSync(join(dir, name), "utf8")
      .split("\n")
      .find((l) => l.startsWith("id: "));
    if (line) ids.add(line.slice("id: ".length).trim());
  }
  // REFUSE AMBIGUITY, exactly as the shipped fence does. This used to take the
  // first hit in sorted order, which is a different function from the one the
  // driver runs — and the end-of-FR audit caught the divergence. Two
  // implementations of "the FR under construction" that disagree is the defect,
  // whichever of them is right.
  return ids.size === 1 ? [...ids][0]! : null;
}

/**
 * The three sub-fixtures' predicates, computed from real disk and real git.
 *
 * They are deliberately INDEPENDENT of one another: `c` does not ask whether
 * the lock is currently present, so a released lock reddens `a` alone rather
 * than cascading. That independence is measured by the matrix at the bottom of
 * this file, not asserted as a design intention.
 */
async function evaluate(f: Group10Fixture): Promise<{
  a: boolean;
  b: boolean;
  c: boolean;
}> {
  const recorded = recordedIdOf(f.root);
  if (recorded === null) return { a: false, b: false, c: false };

  const locks = locksDir(f.root);

  // 10a — the in-flight existence read, keyed on the recorded identity.
  const a = existsSync(join(locks, recorded));

  // 10b — the durable claim-commit witness. `claimLock` git-adds and commits
  // the lock, so the mid-run state outlives the release that deletes the file.
  let b = false;
  const sha = gitSoft(
    f.root,
    "log",
    "--format=%H",
    "-1",
    `--grep=^chore(locks): claim lock for ${recorded} `,
  );
  if (sha) {
    const blob = gitSoft(f.root, "show", `${sha}:.dpt/locks/${recorded}`);
    b =
      blob !== null &&
      blob.split("\n").includes(`ulid: ${recorded}`) &&
      /^branch: \S/m.test(blob);
  }

  // 10c — the identity is resolved from the recorded id, never the stem.
  //
  // TWO CONJUNCTS, AND IT USED TO HAVE FOUR. The adversarial pass proved the
  // other two could not fail: `ID_RE` is anchored at both ends over `fr_` plus
  // exactly 26 characters, so `recorded.length === 29` is IMPLIED by it, and
  // `recorded !== stem` compares a 29-character string with its own 6-character
  // slice — unequal for every string the regex admits. Both were verified
  // unfalsifiable by brute force. That is STE-450 #25's shape (a guard
  // comparing a string with itself) shipped inside the FR whose thesis is that
  // such guards are the defect, so they are deleted rather than commented.
  //
  // What survives is two properties that CAN fail and are exercised below:
  //   (i)  the recorded identity is a whole minted id — staged false by a
  //        truncated `id:` in the FR's frontmatter;
  //   (ii) nothing under the stem-derived path is accepted as evidence —
  //        staged false by the decoy row of the independence matrix.
  const stem = recorded.slice(23, 29);
  const c = ID_RE.test(recorded) && !existsSync(join(locks, stem));

  return { a, b, c };
}

// ══════════════════════════════ AC-STE-451.1 ═══════════════════════════════

describeIfSkills("AC-STE-451.1 — group 10 is registered, and the SKILL agrees", () => {
  test("the roster carries group 10 scoped to the tracker-less leg alone", () => {
    const spec = CANONICAL_FIXTURE_GROUPS.find((s) => s.group === GROUP);
    expect(spec).toBeDefined();
    expect([...spec!.legs]).toEqual([TRACKERLESS_LEG]);
  });

  test("group 10 is a SEPARATE roster row from group 9, with its own sut token", () => {
    // AC.1's "as a group separate from group 9" is not decoration. Two groups
    // sharing a `sut` would render the SAME runtime-check line, so one's FAIL
    // and the other's PASS would be indistinguishable in the summary block —
    // which is the masking AC.4 forbids, arriving through the renderer instead
    // of through the reconciler.
    const nine = CANONICAL_FIXTURE_GROUPS.find((s) => s.group === 9);
    const ten = CANONICAL_FIXTURE_GROUPS.find((s) => s.group === GROUP);
    expect(nine).toBeDefined();
    expect(ten).toBeDefined();
    expect(ten!.sut).not.toBe(nine!.sut);
    // Stronger than pairwise: no two groups anywhere share a sut.
    const suts = CANONICAL_FIXTURE_GROUPS.map((s) => s.sut);
    expect(new Set(suts).size).toBe(suts.length);
  });

  test("EXECUTED: the tracker-less leg's coverage set gains group 10", () => {
    expect([...groupsCoveringLeg(TRACKERLESS_LEG)]).toContain(GROUP);
    for (const leg of SMOKE_LEGS) {
      if (leg === TRACKERLESS_LEG) continue;
      expect([...groupsCoveringLeg(leg)]).not.toContain(GROUP);
    }
  });

  test("EXECUTED: group 10 reconciles n/a on every tracker leg, never not-reached", () => {
    for (const leg of SMOKE_LEGS) {
      const record = reconcileFixtureGroups([], leg).find((r) => r.group === GROUP);
      expect(record).toBeDefined();
      expect({ leg, outcome: record!.outcome }).toEqual({
        leg,
        outcome: leg === TRACKERLESS_LEG ? "not-reached" : "not-applicable",
      });
    }
  });

  test("PROSE: the SKILL carries a `#### Fixture group 10` block in Phase 2.X", () => {
    const slice = group10Slice();
    expect(slice.length).toBeGreaterThan(500);
    const phase2x = smokeDoc!.indexOf("### Phase 2.X");
    const phase2y = smokeDoc!.indexOf("### Phase 2.Y");
    const at = smokeDoc!.indexOf("#### Fixture group 10 —");
    expect(phase2x).toBeGreaterThan(-1);
    expect(at).toBeGreaterThan(phase2x);
    expect(at).toBeLessThan(phase2y);
  });

  test("PROSE: the block spells all four outcome branches from the roster's sut", () => {
    const spec = CANONICAL_FIXTURE_GROUPS.find((s) => s.group === GROUP)!;
    const slice = group10Slice();
    for (const outcome of ["PASS", "FAIL", "N/A", "NOT-REACHED"]) {
      expect(slice).toContain(`${spec.sut} runtime check: ${outcome}`);
    }
  });
});

// ══════════════════════════════ AC-STE-451.2 ═══════════════════════════════

describeIfSkills("AC-STE-451.2 — the lock is observed after the claim step", () => {
  test("EXECUTED: a real claimLock leaves all three sub-fixtures green", async () => {
    const f = buildFixture();
    try {
      await claim(f);
      expect(await evaluate(f)).toEqual({ a: true, b: true, c: true });
    } finally {
      cleanup(f);
    }
  });

  test("EXECUTED: the lock is keyed on the WHOLE minted id, not the filename stem", async () => {
    // The load-bearing half of 10c, stated as a measurement rather than a
    // belief: the FR's filename is six characters and the lock's name is
    // twenty-nine, so an implementation that reasoned from the stem would look
    // for a path nothing ever writes.
    const f = buildFixture();
    try {
      await claim(f);
      const recorded = recordedIdOf(f.root)!;
      expect(recorded).toBe(f.frId);
      expect(existsSync(join(locksDir(f.root), recorded))).toBe(true);
      expect(existsSync(join(locksDir(f.root), f.tail))).toBe(false);
      // `recorded.length === 29` and `f.tail.length === 6` were here and are
      // deleted: the first is implied by ID_RE's anchors, the second by
      // `slice(23, 29)`. Neither could fail. What replaces them is the contrast
      // that CAN — the FR file really is named by the stem, so the two paths
      // asserted above are genuinely different names for the same record.
      expect(existsSync(join(f.root, "specs", "frs", `${f.tail}.md`))).toBe(true);
      expect(ID_RE.test(recorded)).toBe(true);
    } finally {
      cleanup(f);
    }
  });

  test("EXECUTED: the claim commit carries the lock body, so the state outlives the release", async () => {
    // This is what makes 10b race-proof and it is the whole reason the fixture
    // does not simply list the directory at Phase 2.X: by then the release has
    // run. Simulate the release and confirm 10b still answers.
    const f = buildFixture();
    try {
      await claim(f);
      const provider = new LocalProvider({ repoRoot: f.root, skipFetch: true });
      expect(await provider.releaseLock(f.frId)).toBe("transitioned");
      expect(existsSync(join(locksDir(f.root), f.frId))).toBe(false);
      const after = await evaluate(f);
      expect({ a: after.a, b: after.b }).toEqual({ a: false, b: true });
    } finally {
      cleanup(f);
    }
  });

  test("PROSE: the block records that the release happens inside step 3, not at archive", () => {
    // The correction this FR measured. A future editor who believes the lock
    // survives to Phase 2.X will write a directory listing there and it will be
    // RED on every healthy run. Scoped to the block, and paired with a positive
    // so deleting the warning cannot satisfy it.
    const slice = group10Slice();
    expect(slice).toMatch(/Phase 4 Close/);
    expect(slice).toMatch(/does \*\*not\*\* survive to this phase/i);
    expect(slice).toMatch(/RED on every healthy run/i);
  });

  test("PROSE: the implement skill still states the mode-none claim writes the lock", () => {
    // The contract group 10 observes. If this sentence is ever removed the
    // fixture is asserting a behaviour nothing promises, and the FIRST thing to
    // re-derive is whether the group should still ship.
    const bullet = implementDoc!
      .split("\n")
      .find((l) => l.includes("0.c Claim"));
    expect(bullet).toBeDefined();
    expect(bullet!).toContain("claimLock");
    expect(bullet!).toContain(".dpt/locks/<id>");
  });
});

// ══════════════════════════════ AC-STE-451.3 ═══════════════════════════════

describeIfSkills("AC-STE-451.3 — suppressing the claim-time lock write turns group 10 RED", () => {
  test("EXECUTED: the named input — the claim step silently no-ops", async () => {
    // THE AC.3 INPUT. A claim that returns without writing leaves exactly the
    // disk a completed release leaves, which is the ambiguity the absence-only
    // assertion could not resolve. Here it reddens two of three sub-fixtures.
    const f = buildFixture();
    try {
      const suppressed = await evaluate(f); // claim() deliberately not called
      expect({ a: suppressed.a, b: suppressed.b }).toEqual({ a: false, b: false });
      // …and the clean run is the control, so the red above is attributable to
      // the suppression and not to a fixture that never worked.
      const g = buildFixture();
      try {
        await claim(g);
        const clean = await evaluate(g);
        expect({ a: clean.a, b: clean.b }).toEqual({ a: true, b: true });
      } finally {
        cleanup(g);
      }
    } finally {
      cleanup(f);
    }
  });

  test("EXECUTED: a lock written under the filename stem does NOT satisfy the group", async () => {
    // The suppression's subtler sibling: the claim ran, a file appeared under
    // `.dpt/locks/`, and the group must still be RED because the identity is
    // wrong. A predicate that merely asked "is the locks directory non-empty"
    // would score this green.
    const f = buildFixture();
    try {
      mkdirSync(locksDir(f.root), { recursive: true });
      writeFileSync(
        join(locksDir(f.root), f.tail),
        `ulid: ${f.frId}\nbranch: ${f.branch}\n`,
      );
      // Assert the mutation applied before concluding anything from it
      // (follow-ups § 0b).
      expect(existsSync(join(locksDir(f.root), f.tail))).toBe(true);
      const r = await evaluate(f);
      expect({ a: r.a, c: r.c }).toEqual({ a: false, c: false });
    } finally {
      cleanup(f);
    }
  });

  test("EXECUTED: a lock written but never committed reddens the witness alone", async () => {
    const f = buildFixture();
    try {
      mkdirSync(locksDir(f.root), { recursive: true });
      writeFileSync(
        join(locksDir(f.root), f.frId),
        `ulid: ${f.frId}\nbranch: ${f.branch}\nclaimed_at: x\nclaimer: y\n`,
      );
      expect(existsSync(join(locksDir(f.root), f.frId))).toBe(true);
      expect(await evaluate(f)).toEqual({ a: true, b: false, c: true });
    } finally {
      cleanup(f);
    }
  });

  test("EXECUTED: a committed lock with an empty body reddens the witness", async () => {
    // `git add` + commit of a content-free lock is a claim that recorded
    // nothing — the `already-ours` resume path reads `branch:` out of this
    // body, so an empty one is a silent claim failure rather than a cosmetic
    // one. 10b's body assertion is what separates the two.
    const f = buildFixture();
    try {
      mkdirSync(locksDir(f.root), { recursive: true });
      writeFileSync(join(locksDir(f.root), f.frId), "");
      git(f.root, "add", "-A");
      git(
        f.root,
        "commit",
        "--quiet",
        "-m",
        `chore(locks): claim lock for ${f.frId} on ${f.branch}`,
      );
      const r = await evaluate(f);
      expect({ a: r.a, b: r.b }).toEqual({ a: true, b: false });
    } finally {
      cleanup(f);
    }
  });

  const RUNTIME_OVERCLAIM = /\b(?:measured|verified|proven|confirmed)\b[^\n]{0,60}\bat runtime\b/i;

  test("PROSE: the block does not claim the runtime observation was executed here", () => {
    // The honesty pin. This file runs claimLock; it does NOT run a smoke run,
    // and a reader must not take a green suite as evidence that `/implement`
    // reaches the claim at runtime. Operative shape, not the identifier.
    const slice = group10Slice();
    expect(RUNTIME_OVERCLAIM.test(slice)).toBe(false);
    // Paired positive: the block names the sampler as the thing that must run.
    // Without this, "the overclaim is absent" is satisfied by deleting the
    // whole sub-fixture.
    expect(slice).toMatch(/run the sampler below \*\*once per step-3 poll call\*\*/i);
  });

  test("the overclaim matcher is not blind — it catches the sentences it was built for", () => {
    // Pattern 31's rider: narrowing an assertion and blinding it are the same
    // edit. A ban with no anchor is a ban nobody has ever seen fire.
    for (const drift of [
      "This behaviour is measured at runtime by the assertions below.",
      "The lock write is verified at runtime by this fixture.",
      "Group 10's observation has been proven at runtime.",
    ]) {
      expect({ drift, caught: RUNTIME_OVERCLAIM.test(drift) }).toEqual({
        drift,
        caught: true,
      });
    }
    // …and does not fire on the block's own legitimate measured claims, which
    // are about the RELEASE TIMING rather than about the runtime observation.
    for (const ok of [
      "MEASURED, and it corrects the attachment point this fixture was designed around.",
      "the lock is released when step 3's own commit lands",
    ]) {
      expect({ ok, caught: RUNTIME_OVERCLAIM.test(ok) }).toEqual({
        ok,
        caught: false,
      });
    }
  });
});

// ══════ the SKILL's own fences, EXTRACTED AND EXECUTED — not paraphrased ═════
//
// WHY THIS EXISTS. Everything above tests `evaluate()`, a TypeScript analogue of
// what the SKILL block instructs the driver to run. An analogue is not the
// thing: the end-of-FR audit found that `recordedIdOf` sorts the directory and
// does not recurse, while the fence used unordered `grep -r` that descended into
// `specs/frs/archive/`. They already disagreed, and nothing could see it —
// exactly the shape v2.57.1 recorded as "a prose grep passes against prose
// describing a guard the snippet doesn't implement". So the shipped fence is
// lifted out of the document and run under bash.

/** Every ```bash fence inside the group 10 block, in document order. */
function group10Fences(): string[] {
  const slice = group10Slice();
  return [...slice.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1]!);
}

/**
 * Substitute the fence's hard-coded test-project path for a real one, and
 * ASSERT the substitution landed. follow-ups § 0b: a substitution that silently
 * misses puts every artifact where no assertion looks, and the whole run then
 * reads as "the code under test does nothing" rather than "the harness is
 * misconfigured".
 */
function aimFenceAt(fence: string, root: string): string {
  const aimed = fence.replace("TP=../dpt-test-project-none", `TP=${root}`);
  if (aimed === fence) {
    throw new Error(
      "aimFenceAt: the TP= substitution did not apply — the fence's path line changed shape",
    );
  }
  return aimed;
}

function runBash(script: string): { code: number; out: string; err: string } {
  const p = Bun.spawnSync({ cmd: ["bash", "-c", script] });
  return {
    code: p.exitCode ?? -1,
    out: new TextDecoder().decode(p.stdout),
    err: new TextDecoder().decode(p.stderr),
  };
}

describeIfSkills("AC-STE-451.2 — the SKILL's resolver fence, executed under bash", () => {
  test("the extraction is not vacuous — the block really carries executable fences", () => {
    // The slice-sanity anchor. Without it, a block that lost every fence would
    // leave the tests below passing over an empty script.
    const fences = group10Fences();
    expect(fences.length).toBeGreaterThanOrEqual(3);
    expect(fences[0]).toContain("FR_IDS=");
    expect(fences[0]).toContain("TP=../dpt-test-project-none");
  });

  test("EXECUTED: the resolver resolves the FR under construction from its recorded id", () => {
    const f = buildFixture();
    try {
      const script = `${aimFenceAt(group10Fences()[0]!, f.root)}\necho "RESOLVED=\${FR_ID:-}"`;
      const r = runBash(script);
      expect(r.out).toContain(`RESOLVED=${f.frId}`);
      expect(r.err).toBe("");
    } finally {
      cleanup(f);
    }
  });

  test("EXECUTED: a group 9 decoy FR makes the resolver REFUSE, not guess", () => {
    // THE CROSS-GROUP COUPLING, staged. Fixture group 9's sub-fixture 9a writes
    // an extra FR carrying a freshly minted `id:` into this same tree and
    // removes it in a cleanup step a 9a failure may never reach. A resolver
    // that took the first hit would then read group 9's decoy, find no claim
    // commit for it, and redden group 10 for group 9's reason.
    const f = buildFixture();
    try {
      const decoy = mintId();
      expect(decoy).not.toBe(f.frId);
      writeFileSync(
        join(f.root, "specs", "frs", `${decoy.slice(23, 29)}.md`),
        `---\ntitle: "group 9 decoy"\nid: ${decoy}\n---\n`,
      );
      const script = `${aimFenceAt(group10Fences()[0]!, f.root)}\necho "RESOLVED=\${FR_ID:-<unset>}"`;
      const r = runBash(script);
      // Refuses by naming the ambiguity, and leaves FR_ID unset rather than
      // picking a winner.
      expect(r.err).toContain("10-identity-ambiguous");
      expect(r.err).toContain("found 2 minted FR ids");
      expect(r.out).toContain("RESOLVED=<unset>");
    } finally {
      cleanup(f);
    }
  });

  test("EXECUTED: an archived FR does not create phantom ambiguity", () => {
    // `--exclude-dir=archive` is load-bearing: an archived FR still carries its
    // `id:`, so recursing into archive/ would make every post-archival run
    // ambiguous and refuse forever.
    const f = buildFixture();
    try {
      const archived = mintId();
      mkdirSync(join(f.root, "specs", "frs", "archive"), { recursive: true });
      writeFileSync(
        join(f.root, "specs", "frs", "archive", `${archived.slice(23, 29)}.md`),
        `---\ntitle: "archived"\nid: ${archived}\n---\n`,
      );
      const script = `${aimFenceAt(group10Fences()[0]!, f.root)}\necho "RESOLVED=\${FR_ID:-<unset>}"`;
      const r = runBash(script);
      expect(r.out).toContain(`RESOLVED=${f.frId}`);
      expect(r.err).toBe("");
    } finally {
      cleanup(f);
    }
  });

  test("EXECUTED: a CRLF frontmatter does not smuggle a trailing \\r into the id", () => {
    // This repository closed CRLF blindness across sixteen frontmatter readers
    // (gate-red cleanup 2026-07-26) and the first draft of this fence reopened
    // it: `sed 's/^id: *//'` strips the PREFIX only, so a CRLF file yielded a
    // 30-character id. The ambiguity guard still passed (one id), then every
    // path built from it missed forever — which the block's own outcome rule
    // renders as a FAIL on a healthy run. Measured before the fix; pinned now.
    const f = buildFixture();
    try {
      const fr = join(f.root, "specs", "frs", `${f.tail}.md`);
      writeFileSync(fr, readFileSync(fr, "utf8").replace(/\n/g, "\r\n"));
      expect(readFileSync(fr, "utf8")).toContain("\r\n"); // the mutation applied
      const script = `${aimFenceAt(group10Fences()[0]!, f.root)}\necho "LEN=\${#FR_ID} RESOLVED=[\${FR_ID:-}]"`;
      const r = runBash(script);
      expect(r.out).toContain(`RESOLVED=[${f.frId}]`);
      expect(r.out).toContain("LEN=29");
    } finally {
      cleanup(f);
    }
  });

  test("EXECUTED: the resolver refuses an empty tree rather than resolving nothing", () => {
    const f = buildFixture();
    try {
      rmSync(join(f.root, "specs", "frs"), { recursive: true, force: true });
      const script = `${aimFenceAt(group10Fences()[0]!, f.root)}\necho "RESOLVED=\${FR_ID:-<unset>}"`;
      const r = runBash(script);
      expect(r.err).toContain("10-identity-ambiguous");
      expect(r.out).toContain("RESOLVED=<unset>");
    } finally {
      cleanup(f);
    }
  });

  test("EXECUTED: the 10b witness fence retrieves the committed lock body", async () => {
    // The fence, not a paraphrase of it — including its `git log --grep`, whose
    // `^chore(locks):` pattern is a BASIC regex where `(` is literal. That is
    // the kind of detail an analogue silently gets right and a fence silently
    // gets wrong.
    const f = buildFixture();
    try {
      await claim(f);
      const fences = group10Fences();
      const script = `${aimFenceAt(fences[0]!, f.root)}\n${fences[2]!}`;
      const r = runBash(script);
      expect(r.out).toContain(`ulid: ${f.frId}`);
      expect(r.out).toMatch(/^branch: \S/m);
    } finally {
      cleanup(f);
    }
  });

  test("EXECUTED: the 10b fence returns nothing when no claim was ever committed", () => {
    // The paired negative. Without it, "the fence printed the lock body" is
    // also satisfied by a fence that prints unconditionally.
    const f = buildFixture();
    try {
      const fences = group10Fences();
      const script = `${aimFenceAt(fences[0]!, f.root)}\n${fences[2]!}`;
      const r = runBash(script);
      expect(r.out).not.toContain(`ulid: ${f.frId}`);
    } finally {
      cleanup(f);
    }
  });

  test("EXECUTED: the 10a sampler latches a hit and stays silent on a miss", () => {
    const f = buildFixture();
    const log = join(f.root, "samples.log");
    try {
      const fences = group10Fences();
      const sampler = fences[1]!.replace(
        "/tmp/dpt-smoke-<tracker>-ste451-lock-samples.log",
        log,
      );
      expect(sampler).not.toBe(fences[1]!); // the substitution applied
      const script = (s: string) => `${aimFenceAt(fences[0]!, f.root)}\n${s}`;

      // No lock yet — the sampler must write nothing at all.
      runBash(script(sampler));
      expect(existsSync(log)).toBe(false);

      // Lock present — one latched line naming the resolved id.
      mkdirSync(locksDir(f.root), { recursive: true });
      writeFileSync(join(locksDir(f.root), f.frId), `ulid: ${f.frId}\n`);
      runBash(script(sampler));
      expect(readFileSync(log, "utf8").trim()).toBe(`lock-present ${f.frId}`);
    } finally {
      cleanup(f);
    }
  });
});

// ══════════ the three sub-fixtures fail INDEPENDENTLY — measured ═══════════
//
// The SKILL block claims 10a/10b/10c fail independently. That is a claim about
// behaviour, so it is MEASURED as a matrix rather than asserted as a design
// intention. Each row stages a state and flips exactly its own predicate; the
// all-false row proves no predicate masks another, and the clean row proves the
// evaluator is not stuck-false the way the last row alone would allow.

describeIfSkills("AC-STE-451.4 — the three sub-fixture predicates are independent", () => {
  test("EXECUTED: the five-row independence matrix", async () => {
    const rows: Array<Record<string, unknown>> = [];

    // Row 1 — clean.
    {
      const f = buildFixture();
      try {
        await claim(f);
        rows.push({ input: "clean", ...(await evaluate(f)) });
      } finally {
        cleanup(f);
      }
    }

    // Row 2 — the lock was claimed and then RELEASED. This is the real state
    // at Phase 2.X on a healthy run, and it must redden 10a ALONE: the commit
    // witness is exactly what survives the deletion.
    {
      const f = buildFixture();
      try {
        await claim(f);
        await new LocalProvider({ repoRoot: f.root, skipFetch: true }).releaseLock(f.frId);
        expect(existsSync(join(locksDir(f.root), f.frId))).toBe(false);
        rows.push({ input: "released", ...(await evaluate(f)) });
      } finally {
        cleanup(f);
      }
    }

    // Row 3 — written, never committed. Reddens 10b alone.
    {
      const f = buildFixture();
      try {
        mkdirSync(locksDir(f.root), { recursive: true });
        writeFileSync(join(locksDir(f.root), f.frId), `ulid: ${f.frId}\nbranch: ${f.branch}\n`);
        expect(existsSync(join(locksDir(f.root), f.frId))).toBe(true);
        rows.push({ input: "uncommitted", ...(await evaluate(f)) });
      } finally {
        cleanup(f);
      }
    }

    // Row 4 — a correct claim PLUS a stray stem-keyed lock. Reddens 10c alone,
    // and it is the row that proves 10c is not merely a restatement of 10a.
    {
      const f = buildFixture();
      try {
        await claim(f);
        writeFileSync(join(locksDir(f.root), f.tail), "decoy\n");
        expect(existsSync(join(locksDir(f.root), f.tail))).toBe(true);
        rows.push({ input: "stem-decoy", ...(await evaluate(f)) });
      } finally {
        cleanup(f);
      }
    }

    // Row 5 — no claim at all, plus the decoy. All three red at once: a
    // predicate that short-circuited on the first failure would satisfy every
    // single-flip row above and fail only here.
    {
      const f = buildFixture();
      try {
        mkdirSync(locksDir(f.root), { recursive: true });
        writeFileSync(join(locksDir(f.root), f.tail), "decoy\n");
        rows.push({ input: "no-claim+decoy", ...(await evaluate(f)) });
      } finally {
        cleanup(f);
      }
    }

    expect(rows).toEqual([
      { input: "clean", a: true, b: true, c: true },
      { input: "released", a: false, b: true, c: true },
      { input: "uncommitted", a: true, b: false, c: true },
      { input: "stem-decoy", a: true, b: true, c: false },
      { input: "no-claim+decoy", a: false, b: false, c: false },
    ]);
  });

  test("EXECUTED: a truncated recorded id reddens 10c — the conjunct that survived pruning", async () => {
    // The isolating input for `c`'s first conjunct. Without it, `ID_RE.test`
    // was true on every row in the file (the fixture always writes back what
    // `mintId()` produced), so the conjunct was never observed false and could
    // have been deleted with no test noticing.
    const f = buildFixture();
    try {
      await claim(f);
      expect((await evaluate(f)).c).toBe(true);
      // Truncate the FR's recorded identity to its own stem — the exact shape
      // a filename-derived `id:` would take.
      const fr = join(f.root, "specs", "frs", `${f.tail}.md`);
      writeFileSync(
        fr,
        readFileSync(fr, "utf8").replace(`id: ${f.frId}`, `id: ${f.tail}`),
      );
      expect(recordedIdOf(f.root)).toBe(f.tail); // the mutation applied
      expect((await evaluate(f)).c).toBe(false);
    } finally {
      cleanup(f);
    }
  });

  test("EXECUTED: a decoy FR makes the analogue refuse too, matching the fence", async () => {
    // The alignment assertion. `evaluate()` and the shipped fence must answer
    // "the FR under construction" the SAME way; two implementations that
    // disagree is the defect regardless of which one is right.
    const f = buildFixture();
    try {
      await claim(f);
      expect(await evaluate(f)).toEqual({ a: true, b: true, c: true });
      const decoy = mintId();
      writeFileSync(
        join(f.root, "specs", "frs", `${decoy.slice(23, 29)}.md`),
        `---\nid: ${decoy}\n---\n`,
      );
      expect(recordedIdOf(f.root)).toBeNull();
      expect(await evaluate(f)).toEqual({ a: false, b: false, c: false });
    } finally {
      cleanup(f);
    }
  });

  test("EXECUTED: an archived FR does NOT make the analogue refuse", async () => {
    // The paired positive for the exclusion — otherwise "refuses on two ids" is
    // satisfied by an implementation that refuses on everything.
    const f = buildFixture();
    try {
      await claim(f);
      const archived = mintId();
      mkdirSync(join(f.root, "specs", "frs", "archive"), { recursive: true });
      writeFileSync(
        join(f.root, "specs", "frs", "archive", `${archived.slice(23, 29)}.md`),
        `---\nid: ${archived}\n---\n`,
      );
      expect(recordedIdOf(f.root)).toBe(f.frId);
      expect(await evaluate(f)).toEqual({ a: true, b: true, c: true });
    } finally {
      cleanup(f);
    }
  });

  test("EXECUTED: the evaluator reports false when the FR itself is unreadable", async () => {
    // The anchor against the matrix's own vacuity. If `evaluate` ever swallowed
    // an error and returned all-true, every row above would still pass. A tree
    // with no readable FR must make every predicate false.
    const f = buildFixture();
    try {
      await claim(f);
      rmSync(join(f.root, "specs", "frs"), { recursive: true, force: true });
      expect(recordedIdOf(f.root)).toBeNull();
      expect(await evaluate(f)).toEqual({ a: false, b: false, c: false });
    } finally {
      cleanup(f);
    }
  });
});

// ══════════════════════════════ AC-STE-451.4 ═══════════════════════════════

// ONE array, not two. The adversarial pass caught the ban and its own
// not-blind anchor holding INDEPENDENT copies of these patterns: editing one
// leaves the other green, so the anchor would stop protecting the ban exactly
// when it mattered. Shared, the way RUNTIME_OVERCLAIM already was.
const CONDITIONALS: readonly RegExp[] = [
  /\bif group 9\b/i,
  /\bonly (?:if|when)\b[^\n]{0,40}\bgroup 9\b/i,
  /\bgroup 9\b[^\n]{0,40}\b(?:passes|passed|fails|failed)\b[^\n]{0,20}\b(?:then|before)\b/i,
  /\bskip(?:ped)?\b[^\n]{0,40}\bgroup 9\b/i,
  /\bafter group 9 (?:passes|has passed)\b/i,
];

describeIfSkills("AC-STE-451.4 — groups 9 and 10 produce independent outcomes", () => {
  // The 2x2, computed rather than reasoned about. Every combination of the two
  // groups' observed outcomes must reconcile to exactly that pair — no
  // masking, no short-circuit, no ordering effect.
  const OUTCOMES = ["passed", "failed"] as const;

  test("EXECUTED: every combination of group 9 and 10 outcomes survives reconciliation", () => {
    const rows: Array<Record<string, string>> = [];
    for (const nine of OUTCOMES) {
      for (const ten of OUTCOMES) {
        const records = reconcileFixtureGroups(
          [
            { group: 9, outcome: nine },
            { group: GROUP, outcome: ten },
          ],
          TRACKERLESS_LEG,
        );
        rows.push({
          input: `${nine}/${ten}`,
          nine: records.find((r) => r.group === 9)!.outcome,
          ten: records.find((r) => r.group === GROUP)!.outcome,
        });
      }
    }
    // Every expected value is a LITERAL. An expectation containing an
    // expression is how STE-450's correction #21 happened: `false === false`
    // read as an assertion and was a computation that happened to agree.
    expect(rows).toEqual([
      { input: "passed/passed", nine: "passed", ten: "passed" },
      { input: "passed/failed", nine: "passed", ten: "failed" },
      { input: "failed/passed", nine: "failed", ten: "passed" },
      { input: "failed/failed", nine: "failed", ten: "failed" },
    ]);
  });

  test("EXECUTED: one group failing does not remove the other's record", () => {
    // The masking AC.4 names, tested at the denominator rather than the value:
    // a reconciler that dropped a record on failure would shrink the roster and
    // the aggregate would stop being able to see the survivor at all.
    for (const failing of [9, GROUP]) {
      const records = reconcileFixtureGroups(
        [{ group: failing, outcome: "failed" }],
        TRACKERLESS_LEG,
      );
      // Hand-restated, NOT `CANONICAL_FIXTURE_GROUPS.length` — deriving the
      // expected count from the roster this assertion is checking compares the
      // roster with itself, which is the shape three sibling test files
      // explicitly forbid.
      expect(records).toHaveLength(10);
      const other = failing === 9 ? GROUP : 9;
      expect(records.find((r) => r.group === other)).toBeDefined();
      expect(records.find((r) => r.group === failing)!.outcome).toBe("failed");
      // The other group is not-reached, not swallowed into the failure.
      expect(records.find((r) => r.group === other)!.outcome).toBe("not-reached");
    }
  });

  test("EXECUTED: the two groups render distinguishable lines", () => {
    // If the two lines were identical, a summary reader could not tell which
    // surface broke — the reconciler could be perfectly independent and the
    // operator would still see one signal.
    const records = reconcileFixtureGroups(
      [
        { group: 9, outcome: "failed" },
        { group: GROUP, outcome: "passed" },
      ],
      TRACKERLESS_LEG,
    );
    const nine = records.find((r) => r.group === 9)!;
    const ten = records.find((r) => r.group === GROUP)!;
    // One assertion, not two. A second line appending the same constant suffix
    // to two strings already known unequal was here and could not fail — the
    // pruning pass that deleted `c`'s dead conjuncts missed it.
    expect(nine.sut).not.toBe(ten.sut);
  });

  test("PROSE: group 10's block does not make its execution conditional on the other group", () => {
    // OPERATIVE SHAPE, NOT THE IDENTIFIER. This block discusses group 9 by name
    // in order to explain why the two exist separately, so a bare ban on
    // "group 9" would fire on the paragraph doing the explaining — the Pattern
    // 31 collision. What must not appear is a CONDITIONAL dependency.
    const slice = group10Slice();
    expect(CONDITIONALS.filter((re) => re.test(slice))).toEqual([]);
    // Paired positive: the block states its own outcome branches
    // unconditionally, so "no conditional" cannot be satisfied by a block that
    // says nothing about when it runs.
    expect(slice).toMatch(/If all three pass, append/);
  });

  test("the conditional matcher is not blind — it catches the shapes it was built for", () => {
    // Narrowing an assertion and blinding it are the same edit, and only
    // running the mutation tells them apart (Pattern 31's rider).
    for (const drift of [
      "Run this only if group 9 reported PASS.",
      "If group 9 is red, skip this group.",
      "Skipped when group 9 is not applicable on this leg.",
      "After group 9 passes, sample the lock directory.",
      "Once group 9 failed, then this group is not evaluated.",
    ]) {
      expect({ drift, caught: CONDITIONALS.some((re) => re.test(drift)) }).toEqual({
        drift,
        caught: true,
      });
    }
    // …and does not fire on the block's own legitimate explanatory prose.
    for (const ok of [
      "It is tracker-less-only for a reason distinct from group 9's.",
      "Group 9's probes invert under a tracker; this group's artifact does not exist there.",
    ]) {
      expect({ ok, caught: CONDITIONALS.some((re) => re.test(ok)) }).toEqual({
        ok,
        caught: false,
      });
    }
  });
});
