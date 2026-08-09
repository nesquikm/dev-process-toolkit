// M121 STE-458 — bind the capture-equivalence guard to its own run.
//
// WHAT IS BROKEN. `tests/m116-ste-421-assistant-scoped-capability.test.ts`
// checks each committed derived fixture against "the full capture it was
// derived from", and finds that capture by BASENAME ALONE (`findCapture`,
// walking `[$DPT_CAPTURE_DIR, "/tmp"]`). The basename is run-agnostic — every
// conformance run writes the same path — so any later run's capture is accepted
// as the 2026-07-27 artifact.
//
// The RED face was observed live on 2026-08-09 (three assertions failing
// against a different run's measurements). The DANGEROUS face is GREEN: a
// mismatched artifact whose scores happen to agree satisfies every assertion
// while comparing against something the fixture was never derived from. Its
// canonical instance is the SELF-COMPARE — the derived fixture's own bytes
// copied to the capture path — because a file always scores identically to
// itself. That input needs no coincidence and is reachable by ordinary
// accident.
//
// THE REPAIR under test. Identification moves out of the test file into
// `adapters/_shared/src/capture_artifact_identity.ts` — a pure function over
// explicit inputs, so it is exercisable at unit granularity (`CAPTURE_DIRS` and
// the `findCapture` calls in the subject file are evaluated at MODULE LOAD, and
// therefore cannot be steered by mutating env at runtime). Three run-bound
// properties must all hold before the comparison runs: a SIZE FLOOR that is the
// same constant as the derived-fixture ceiling, a SELF-COMPARE REFUSAL on
// bytes, and a DECLARED RUN matching the run the fixture records.
//
// HOW THIS FILE PROVES IT, in two layers:
//
//  1. UNIT — `qualifyCaptureArtifact` against planted inputs: every refusal
//     reason, the floor boundary, check order, and the qualifying case.
//  2. END-TO-END — the subject suite is RE-RUN as a subprocess with
//     `DPT_CAPTURE_DIR` pointed at a temp dir we have planted, and its junit
//     report is read back. That is the only way to observe the module-load
//     guard actually deciding, and it is what makes AC-STE-458.6 non-vacuous:
//     one scenario proves a qualifying artifact still RUNS the comparison, and
//     a sibling scenario proves that comparison can still FAIL.
//
// BOTH DIRECTIONS (house rider). Every agreeing/differing input is measured
// twice: once through `preChangeFindCapture` + the comparison the block runs,
// which is the form being replaced and reports GREEN on the self-compare; and
// once through the shipped guard, which refuses it. Without the first half a
// mutation cannot tell the two implementations apart.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { scoreCapabilityKey } from "../adapters/_shared/src/capability_row_assert";
import {
  DERIVED_FIXTURE_BYTE_CEILING,
  qualifyCaptureArtifact,
  runRecordedByFixture,
  selectUniqueByCapture,
  type CaptureQualificationInput,
  type CaptureQualificationReason,
} from "../adapters/_shared/src/capture_artifact_identity";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const FIXTURE_DIR = join(PLUGIN_ROOT, "tests", "fixtures", "capability-rows");

const SUBJECT_TEST_REL = "tests/m116-ste-421-assistant-scoped-capability.test.ts";
const SUBJECT_TEST_PATH = join(PLUGIN_ROOT, SUBJECT_TEST_REL);
const MODULE_PATH = join(
  PLUGIN_ROOT,
  "adapters",
  "_shared",
  "src",
  "capture_artifact_identity.ts",
);
const MODULE_REL = "adapters/_shared/src/capture_artifact_identity.ts";

// Repo-relative, for the git-order assertions.
const FR_REPO_REL = "specs/frs/STE-458.md";
const MODULE_REPO_REL = `plugins/dev-process-toolkit/${MODULE_REL}`;
const THIS_TEST_REPO_REL =
  "plugins/dev-process-toolkit/tests/m121-ste-458-capture-artifact-identity.test.ts";

/** The run every committed fixture in this family records, in its own name. */
const FIXTURE_RUN = "2026-07-27";
/** A real, different run: the captures that reddened the gate on 2026-08-09. */
const OTHER_RUN = "2026-08-08";

/**
 * The subject suite's `DERIVED` table, mirrored: derived fixture, the capture
 * basename it was derived from, and the keys the equivalence block scores.
 */
const DERIVED = [
  {
    file: "spec-write-linear-2026-07-27.log",
    capture: "dpt-smoke-linear-spec-write.log",
    keys: [
      "spec_write_draft_default_applied",
      "spec_write_commit_default_applied",
      "branch_gate_default_applied",
      "spec_research_no_matches",
      "spec_research_invoked",
    ],
  },
  {
    file: "spec-write-jira-2026-07-27.log",
    capture: "dpt-smoke-jira-spec-write.log",
    keys: [
      "spec_write_draft_default_applied",
      "spec_write_commit_default_applied",
      "branch_gate_default_applied",
      "spec_research_no_matches",
      "spec_research_invoked",
    ],
  },
  {
    file: "ste222-probe-jira-2026-07-27.log",
    capture: "dpt-smoke-jira-ste222-probe.log",
    keys: [
      "cross_cutting_spec_stale_file_refs",
      "cross-cutting-spec-stale-file-refs",
    ],
  },
] as const;

const LINEAR = DERIVED[0];

function fixtureBytes(file: string): Buffer {
  return readFileSync(join(FIXTURE_DIR, file));
}

function fixtureText(file: string): string {
  return readFileSync(join(FIXTURE_DIR, file), "utf-8");
}

/**
 * Padding that is inert to `scoreCapabilityKey`: non-assistant NDJSON events
 * carrying no scored token, so per-key scores are preserved byte-for-byte
 * while the file grows past the floor. ~55 KB — always enough to clear
 * DERIVED_FIXTURE_BYTE_CEILING on top of any fixture in this family.
 */
function inertPadding(seed: string): string {
  const lines: string[] = [];
  for (let i = 0; i < 500; i += 1) {
    lines.push(
      JSON.stringify({
        type: "system",
        subtype: "synthetic-padding",
        seed,
        seq: i,
        filler: "x".repeat(80),
      }),
    );
  }
  return `\n${lines.join("\n")}\n`;
}

/**
 * A synthetic artifact that AGREES with `file` on every key (padding is inert)
 * but is byte-different from it and clears the size floor. This is the
 * NON-degenerate agreeing case: the self-compare needs no coincidence, this one
 * is contrived, and only the declared-run property can refuse it.
 */
function agreeingArtifact(file: string): string {
  return fixtureText(file) + inertPadding(`agree-${file}`);
}

/**
 * A synthetic artifact from "another run": clears the floor, byte-different,
 * and scores DIFFERENTLY — one extra assistant emission of a scored key. This
 * is the 2026-08-09 shape, the one that surfaced as a fixture failure.
 */
function differingArtifact(file: string, key: string): string {
  const emission = JSON.stringify({
    type: "assistant",
    message: {
      content: [
        { type: "text", text: `${key}: emitted (synthetic other-run artifact)` },
      ],
    },
  });
  return `${fixtureText(file)}\n${emission}${inertPadding(`differ-${file}`)}`;
}

/** Score `a` and `b` on every key and report whether they agree throughout. */
function scoresAgree(a: string, b: string, keys: readonly string[]): boolean {
  return keys.every(
    (key) =>
      JSON.stringify(scoreCapabilityKey(a, key)) ===
      JSON.stringify(scoreCapabilityKey(b, key)),
  );
}

/**
 * THE FORM BEING REPLACED, kept executable so both directions stay measurable
 * after the repair lands: locate the capture by basename alone, exactly as
 * `findCapture` did — the first searched directory holding that name wins,
 * whatever run wrote it.
 */
function preChangeFindCapture(
  dirs: readonly string[],
  basename: string,
): string | null {
  for (const dir of dirs) {
    const path = join(dir, basename);
    if (existsSync(path)) return path;
  }
  return null;
}

function tempDir(tag: string): string {
  return mkdtempSync(join(tmpdir(), `dpt-ste458-${tag}-`));
}

/** Defaults describe the QUALIFYING case; each test overrides one property. */
function qualify(
  overrides: Partial<CaptureQualificationInput> = {},
): ReturnType<typeof qualifyCaptureArtifact> {
  const bytes = Buffer.from(agreeingArtifact(LINEAR.file));
  const input: CaptureQualificationInput = {
    candidate: { path: `/tmp/${LINEAR.capture}`, bytes },
    derivedBytes: fixtureBytes(LINEAR.file),
    declaredRun: FIXTURE_RUN,
    expectedRun: FIXTURE_RUN,
    ...overrides,
  };
  return qualifyCaptureArtifact(input);
}

// ===========================================================================
// AC-STE-458.1 — authorization order, asserted from git rather than asserted
// by assertion-shaped prose.
// ===========================================================================

function git(args: string[]): { ok: boolean; out: string } {
  const proc = spawnSync("git", args, { cwd: REPO_ROOT, encoding: "utf-8" });
  return { ok: proc.status === 0, out: (proc.stdout ?? "").trim() };
}

/** Commits that ADDED or MODIFIED `path`, newest first. `%s` is the subject. */
function commitsTouching(path: string): { sha: string; subject: string }[] {
  const log = git([
    "log",
    "--format=%H%x1f%s",
    "--diff-filter=AM",
    "--",
    path,
  ]);
  if (!log.ok || log.out.length === 0) return [];
  return log.out.split("\n").map((line) => {
    const [sha, subject] = line.split("\x1f");
    return { sha: sha ?? "", subject: subject ?? "" };
  });
}

/** True when `earlier` is an ancestor of `later` (strictly or equal). */
function isAncestor(earlier: string, later: string): boolean {
  return git(["merge-base", "--is-ancestor", earlier, later]).ok;
}

const FR_COMMITS = commitsTouching(FR_REPO_REL);
// A shallow clone, a non-git checkout, or an FR that has since been archived
// out of specs/frs/ leaves nothing to order — say so in the name rather than
// passing silently.
const AUTHORIZATION_UNCHECKABLE =
  !existsSync(join(REPO_ROOT, FR_REPO_REL)) || FR_COMMITS.length === 0;

describe("AC-STE-458.1 — the correction is authorized by its own docs(specs) commit", () => {
  test.skipIf(AUTHORIZATION_UNCHECKABLE)(
    `every commit that wrote ${FR_REPO_REL} BEFORE the code is a docs(specs) commit` +
      (AUTHORIZATION_UNCHECKABLE ? " [SKIPPED — FR absent from specs/frs/ or history unreachable]" : ""),
    () => {
      // NARROWED, and the narrowing is a correction rather than a relaxation.
      //
      // The first form required EVERY commit touching the FR to be
      // docs(specs)-typed. That is a proxy, and it over-constrains its own AC:
      // the property AC.1 states is ORDERING — "authorized by its own
      // docs(specs) commit landing BEFORE the code edit" — not "this file may
      // only ever be touched by a docs commit". The proxy also forbids the
      // house practice of carrying an FR's `## Implementation notes` in the
      // implementation commit, which is documentation of work already
      // authorized, not a second authorization.
      //
      // It caught the difference the hard way: the implementation commit
      // carried this FR's notes, the suite was green when that commit was
      // proposed, and it went red the moment it landed — because this test's
      // subject IS git history, so the commit under test changes the test's own
      // input. A gate run before such a commit cannot speak for the tree after
      // it.
      //
      // What is asserted now: every FR commit that PRECEDES the first code
      // commit must be docs(specs). What is deliberately no longer asserted: a
      // commit that touches BOTH the FR and the implementation may carry any
      // type. The ordering half below is what keeps that from being a hole.
      expect(FR_COMMITS.length).toBeGreaterThan(0);

      const codeShas = [MODULE_REPO_REL, THIS_TEST_REPO_REL]
        .map((path) => commitsTouching(path).map((c) => c.sha))
        .flat();
      const authorizing = FR_COMMITS.filter(
        ({ sha }) =>
          !codeShas.includes(sha) &&
          codeShas.some((code) => isAncestor(sha, code)),
      );

      // Non-vacuity: there must BE an authorizing commit to check. A filter
      // that silently emptied would satisfy a for-loop over nothing, which is
      // the shape this file exists to remove.
      expect(authorizing.length).toBeGreaterThan(0);
      for (const { sha, subject } of authorizing) {
        expect(`${sha.slice(0, 7)} ${subject}`).toMatch(
          /^[0-9a-f]{7} docs\(specs\)!?: /,
        );
      }
    },
  );

  test.skipIf(AUTHORIZATION_UNCHECKABLE)(
    "the authorizing docs commit is an ancestor of every STE-458 code commit" +
      (AUTHORIZATION_UNCHECKABLE ? " [SKIPPED — FR absent from specs/frs/ or history unreachable]" : ""),
    () => {
      // Oldest FR commit — the one that authorized the work. Deliberately not
      // the newest: a later amendment must not retroactively invalidate a code
      // commit that was already authorized when it landed.
      const authorizing = FR_COMMITS[FR_COMMITS.length - 1]!.sha;
      const codeCommits = [MODULE_REPO_REL, THIS_TEST_REPO_REL]
        .map((path) => commitsTouching(path))
        .flat();

      // Before the implementation commit lands there is nothing to order and
      // this half is inert; it becomes load-bearing the moment the code is
      // committed, and reddens if a rebase ever puts the code first.
      for (const { sha, subject } of codeCommits) {
        const ancestor = git([
          "merge-base",
          "--is-ancestor",
          authorizing,
          sha,
        ]);
        expect(`${subject} :: docs-first=${ancestor.ok}`).toContain(
          "docs-first=true",
        );
      }
    },
  );
});

// ===========================================================================
// AC-STE-458.2 — identification by run-bound intrinsic properties.
// ===========================================================================

describe("AC-STE-458.2 — three run-bound properties, all of them required", () => {
  test("the size floor IS the derived-fixture ceiling — one constant, not two", () => {
    expect(DERIVED_FIXTURE_BYTE_CEILING).toBe(32 * 1024);
    // The bound the sibling assertion enforces on the committed fixtures is the
    // same bound that excludes them as candidates: a derived fixture can never
    // clear a floor equal to its own ceiling.
    for (const { file } of DERIVED) {
      const bytes = fixtureBytes(file).length;
      expect(bytes).toBeGreaterThan(0);
      expect(bytes).toBeLessThan(DERIVED_FIXTURE_BYTE_CEILING);
    }
  });

  test("the floor defaults to that constant — the boundary is exact", () => {
    const under = qualify({
      candidate: {
        path: "/tmp/short.log",
        bytes: Buffer.alloc(DERIVED_FIXTURE_BYTE_CEILING - 1, 0x61),
      },
    });
    expect(under.reason).toBe("below-size-floor");

    const at = qualify({
      candidate: {
        path: "/tmp/exact.log",
        bytes: Buffer.alloc(DERIVED_FIXTURE_BYTE_CEILING, 0x61),
      },
    });
    expect(at.reason).toBe("qualified");
  });

  test("AC.8 — selection is by basename and BOTH refusal branches are reachable", () => {
    // These two assertions exist because the AC claimed them before they were
    // written. AC-STE-458.8 said the guard was "pinned in both directions" on
    // the strength of one-off mutations run during the refactor — real
    // measurements, but ephemeral ones, asserted as if they were shipped
    // coverage. An AC that describes a pin nobody can run is the same defect
    // this FR removes, so the pins are shipped rather than the claim softened.
    const table = [
      { capture: "a.log", tag: "A" },
      { capture: "b.log", tag: "B" },
      { capture: "c.log", tag: "C" },
    ];

    // Branch 1 — zero matches.
    expect(() => selectUniqueByCapture(table, "nope.log")).toThrow(
      /expected exactly one entry for capture nope\.log, found 0/,
    );
    // Branch 2 — SEVERAL matches. Untested before this: a duplicate basename
    // makes "the subject" ambiguous, and silently taking the first is exactly
    // the guess the guard exists to refuse.
    const dupes = [...table, { capture: "b.log", tag: "B-DUPLICATE" }];
    expect(() => selectUniqueByCapture(dupes, "b.log")).toThrow(
      /expected exactly one entry for capture b\.log, found 2/,
    );
  });

  test("AC.8 — resolution is ORDER-INDEPENDENT, measured rather than assumed", () => {
    // The claim "reversing the table leaves the shipped form green" was in the
    // AC before any test reversed a table. Order-independence is true by
    // construction here — a filter, not an index — but "true by construction"
    // is how an untested claim gets to sound proven.
    const table = [
      { capture: "a.log", tag: "A" },
      { capture: "b.log", tag: "B" },
      { capture: "c.log", tag: "C" },
    ];
    for (const capture of ["a.log", "b.log", "c.log"]) {
      const forward = selectUniqueByCapture(table, capture);
      const reversed = selectUniqueByCapture([...table].reverse(), capture);
      expect(reversed).toEqual(forward);
    }
    // The discriminator: a POSITIONAL lookup gives a different answer under the
    // same reversal, which is what makes the assertion above non-vacuous.
    expect(table[0]!.tag).not.toBe([...table].reverse()[0]!.tag);
  });

  test("there is NO caller-supplied floor override", () => {
    // An earlier draft exposed a `sizeFloor` input. It was removed, and this
    // pins the removal rather than trusting it: the floor is the derived-fixture
    // ceiling BECAUSE a fixture can then never clear it, and a caller able to
    // pass an arbitrary floor voids that argument entirely. The guarantee is
    // structural or it is nothing.
    const src = readFileSync(MODULE_PATH, "utf-8");
    expect(src).not.toMatch(/sizeFloor\s*\??\s*:/);
    expect(src).not.toMatch(/input\.sizeFloor/);
    // And the floor really is the shared constant, with no second literal.
    expect(src).toContain("const floor = DERIVED_FIXTURE_BYTE_CEILING;");
    expect(src.match(/32\s*\*\s*1024/g) ?? []).toHaveLength(1);
  });

  test("no committed derived fixture can ever qualify as its own source", () => {
    for (const { file, capture } of DERIVED) {
      const bytes = fixtureBytes(file);
      const verdict = qualify({
        candidate: { path: `/tmp/${capture}`, bytes },
        derivedBytes: bytes,
      });
      expect(verdict.qualified).toBe(false);
      expect(verdict.reason).toBe("identical-to-derived-fixture");
    }
  });

  test("self-compare is refused on IDENTITY, not on size and not on score", () => {
    // Large enough to clear the floor, and the declared run matches: the ONLY
    // property left to refuse it is byte identity. Refusing it on score would
    // be the same mistake one level down — its score is correct.
    const bytes = Buffer.from(agreeingArtifact(LINEAR.file));
    const verdict = qualify({
      candidate: { path: `/tmp/${LINEAR.capture}`, bytes },
      derivedBytes: bytes,
    });
    expect(bytes.length).toBeGreaterThan(DERIVED_FIXTURE_BYTE_CEILING);
    expect(verdict.reason).toBe("identical-to-derived-fixture");
    expect(verdict.qualified).toBe(false);
  });

  test("an undeclared run cannot qualify — presence alone never suffices", () => {
    for (const declaredRun of [undefined, null, "", "   "]) {
      const verdict = qualify({ declaredRun });
      expect(verdict.reason).toBe("run-not-declared");
      expect(verdict.qualified).toBe(false);
    }
  });

  test("a declared run must MATCH the run the fixture records", () => {
    expect(qualify({ declaredRun: OTHER_RUN }).reason).toBe(
      "declared-run-mismatch",
    );
    expect(qualify({ declaredRun: `  ${FIXTURE_RUN}  ` }).reason).toBe(
      "qualified",
    );
  });

  test("the intrinsic properties are checked before the declared one", () => {
    // "The first two are intrinsic and need no cooperation. The third is
    // additive — it can qualify an artifact the other two admit, never
    // override them." A matching declaration cannot rescue either refusal.
    const derived = fixtureBytes(LINEAR.file);
    expect(
      qualify({
        candidate: { path: "/tmp/x.log", bytes: derived },
        derivedBytes: derived,
        declaredRun: FIXTURE_RUN,
      }).reason,
    ).toBe("identical-to-derived-fixture");
    expect(
      qualify({
        candidate: { path: "/tmp/x.log", bytes: Buffer.alloc(100, 0x62) },
        declaredRun: FIXTURE_RUN,
      }).reason,
    ).toBe("below-size-floor");
    // Identity leads the floor: the canonical agreeing case keeps its own
    // reason instead of being reported as merely "too small".
    expect(
      qualify({
        candidate: { path: "/tmp/x.log", bytes: derived },
        derivedBytes: derived,
        declaredRun: undefined,
      }).reason,
    ).toBe("identical-to-derived-fixture");
    // FLOOR leads the DECLARED RUN, and this is the ONLY input that can tell
    // those two apart. Every other below-floor case in this file supplies a
    // matching declaration, so swapping checks 2 and 3 is invisible to all of
    // them — measured: 18 of 18 inputs produce byte-identical verdicts under
    // the swap. Below-floor AND undeclared is the sole discriminator, so
    // without this assertion the half of AC.2 that orders the intrinsic floor
    // ahead of the caller-supplied declaration is unpinned.
    expect(
      qualify({
        candidate: { path: "/tmp/x.log", bytes: Buffer.alloc(100, 0x62) },
        declaredRun: undefined,
      }).reason,
    ).toBe("below-size-floor");
  });

  test("the expected run is READ OFF the fixture that records it", () => {
    for (const { file } of DERIVED) {
      expect(runRecordedByFixture(file)).toBe(FIXTURE_RUN);
    }
    expect(runRecordedByFixture("carrier-tool-result.log")).toBeNull();
    expect(runRecordedByFixture("dpt-smoke-linear-spec-write.log")).toBeNull();
    // Both negatives above contain NO DIGITS AT ALL, so they cannot exercise
    // the digit-boundary guards in the extractor's pattern — deleting those
    // guards left every assertion here green. These two carry a date-shaped
    // run embedded in a longer digit run, which is what the boundaries exist
    // to reject.
    expect(runRecordedByFixture("spec-write-12026-07-27.log")).toBeNull();
    expect(runRecordedByFixture("spec-write-2026-07-270.log")).toBeNull();
  });

  test("the subject suite GATES on the module, not merely imports it", () => {
    // Renamed and strengthened. The previous form asserted four `toContain`
    // tokens that the IMPORT STATEMENT ALONE satisfies — delete every call site,
    // keep the import, and it stayed green. It also mis-stated what shipped:
    // `findCapture` is still present and still LOCATES the candidate; what the
    // module does is QUALIFY what it finds. Presence of a name proves nothing
    // about whether the value is used.
    const src = readFileSync(SUBJECT_TEST_PATH, "utf-8");
    expect(src).toContain("capture_artifact_identity");
    expect(src).toContain("DPT_CAPTURE_RUN");
    // The load-bearing half: the verdict must actually gate the two skipIf
    // guards. A call site that computes a verdict and ignores it is the same
    // defect one level down.
    expect(src).toMatch(/qualifyCaptureArtifact\(\{/);
    const skipIfGuards = src.match(/test\.skipIf\(([^)]*)\)/g) ?? [];
    expect(skipIfGuards.length).toBeGreaterThanOrEqual(2);
    for (const guard of skipIfGuards) {
      expect(guard).toMatch(/qualified/);
    }
    // AC.2(a): ONE shared constant. A second `32 * 1024` literal in the subject
    // file is the drift this forbids.
    expect(src).not.toMatch(/32\s*\*\s*1024/);
    expect(src).toContain("DERIVED_FIXTURE_BYTE_CEILING");
  });

  test("the corrected capture-size provenance replaces the wrong one", () => {
    // Measured across the eighteen captures of the 2026-08-08 run: 46,057 B to
    // 1,252,763 B. The file's old "200 KB – 470 KB" claim is wrong in both
    // directions and a floor taken from it would reject four real captures.
    const src = readFileSync(SUBJECT_TEST_PATH, "utf-8");
    expect(src).not.toContain("200 KB – 470 KB");
    expect(src).toContain("46,057");
  });
});

// ===========================================================================
// AC-STE-458.3 + AC-STE-458.7 — three legible states, distinct reasons.
// ===========================================================================

const NON_QUALIFYING_REASONS: CaptureQualificationReason[] = [
  "artifact-absent",
  "identical-to-derived-fixture",
  "below-size-floor",
  "run-not-declared",
  "declared-run-mismatch",
];

describe("AC-STE-458.3 / AC-STE-458.7 — absent, present-but-not-qualifying, checked", () => {
  test("an absent artifact is its own state, with a null path", () => {
    const verdict = qualify({ candidate: null });
    expect(verdict.state).toBe("absent");
    expect(verdict.reason).toBe("artifact-absent");
    expect(verdict.qualified).toBe(false);
    expect(verdict.path).toBeNull();
  });

  test("a present-but-not-qualifying artifact is NOT collapsed into absent", () => {
    const present = [
      qualify({ declaredRun: OTHER_RUN }),
      qualify({ declaredRun: undefined }),
      qualify({
        candidate: { path: "/tmp/x.log", bytes: Buffer.alloc(10, 0x61) },
      }),
      qualify({
        candidate: {
          path: "/tmp/x.log",
          bytes: fixtureBytes(LINEAR.file),
        },
        derivedBytes: fixtureBytes(LINEAR.file),
      }),
    ];
    for (const verdict of present) {
      expect(verdict.state).toBe("not-qualifying");
      expect(verdict.reason).not.toBe("artifact-absent");
      expect(verdict.qualified).toBe(false);
      // The path survives the refusal, so a skip can name the file it refused
      // — absent is the only state with nothing to point at.
      expect(typeof verdict.path).toBe("string");
      expect(verdict.path).toContain("/tmp/");
    }
  });

  test("a qualifying artifact is the third state and carries no skip label", () => {
    const verdict = qualify();
    expect(verdict.state).toBe("checked");
    expect(verdict.reason).toBe("qualified");
    expect(verdict.qualified).toBe(true);
    expect(verdict.skipLabel).toBe("");
  });

  test("every refusal carries a distinct, self-describing skip label", () => {
    const labels = new Map<CaptureQualificationReason, string>();
    const derived = fixtureBytes(LINEAR.file);
    const cases: [CaptureQualificationReason, Partial<CaptureQualificationInput>][] = [
      ["artifact-absent", { candidate: null }],
      [
        "identical-to-derived-fixture",
        {
          candidate: { path: "/tmp/x.log", bytes: derived },
          derivedBytes: derived,
        },
      ],
      [
        "below-size-floor",
        { candidate: { path: "/tmp/x.log", bytes: Buffer.alloc(10, 0x61) } },
      ],
      ["run-not-declared", { declaredRun: undefined }],
      ["declared-run-mismatch", { declaredRun: OTHER_RUN }],
    ];
    for (const [reason, overrides] of cases) {
      const verdict = qualify(overrides);
      expect(verdict.reason).toBe(reason);
      expect(verdict.skipLabel).toContain("SKIPPED");
      // Machine-readable reason inside the human label: the skip is legible in
      // a test name without a lookup table.
      expect(verdict.skipLabel).toContain(reason);
      labels.set(reason, verdict.skipLabel);
    }
    expect(labels.size).toBe(NON_QUALIFYING_REASONS.length);
    expect(new Set(labels.values()).size).toBe(NON_QUALIFYING_REASONS.length);
  });
});

// ===========================================================================
// AC-STE-458.4 — the dangerous direction, measured in both.
// ===========================================================================

// AC-STE-458.4. The heading says exactly what is proven and no more.
//
// The self-compare — the canonical agreeing case — is refused on an INTRINSIC
// property, and that half is unconditional. The non-degenerate agreeing case is
// refused on the DECLARED RUN, which is caller-supplied, so its refusal is
// conditional on the caller not asserting a falsehood.
//
// An earlier heading read "an AGREEING artifact from another run is refused".
// That overclaimed. NOTHING INTRINSIC DISTINGUISHES RUNS and nothing can: the
// 2026-07-27 full capture was never committed and no copy survives, so there is
// no byte-level property of "belonging to that run" left to test against. The
// residual is asserted below rather than described, so a reader cannot mistake
// the guard for something stronger than it is.
describe("AC-STE-458.4 — the agreeing case: intrinsic refusal, plus the declared-run residual", () => {
  test("LEAD INPUT — the self-compare is GREEN pre-change and refused after", () => {
    const dir = tempDir("selfcompare");
    const planted = join(dir, LINEAR.capture);
    writeFileSync(planted, fixtureBytes(LINEAR.file));

    // DIRECTION 1 — the form being replaced. Basename alone finds it, and the
    // comparison the block then runs passes for every key: a file compared with
    // itself agrees by construction, establishing nothing whatsoever.
    const found = preChangeFindCapture([dir], LINEAR.capture);
    expect(found).toBe(planted);
    const full = readFileSync(found!, "utf-8");
    const derivedText = fixtureText(LINEAR.file);
    expect(scoresAgree(full, derivedText, LINEAR.keys)).toBe(true);

    // DIRECTION 2 — the shipped form refuses it, and names identity as why.
    const verdict = qualifyCaptureArtifact({
      candidate: { path: planted, bytes: readFileSync(planted) },
      derivedBytes: fixtureBytes(LINEAR.file),
      declaredRun: FIXTURE_RUN,
      expectedRun: runRecordedByFixture(LINEAR.file)!,
    });
    expect(verdict.qualified).toBe(false);
    expect(verdict.reason).toBe("identical-to-derived-fixture");
  });

  test("THE RESIDUAL, asserted: a matching declaration ADMITS the agreeing artifact", () => {
    // The limit of this repair, pinned as a fact rather than left in prose.
    // These are the same bytes the next test proves are refused when the run is
    // undeclared or misdeclared — and they QUALIFY the moment the declaration
    // matches. So the declared run is genuinely load-bearing, and an operator
    // who declares a wrong-run artifact as the expected run reopens the
    // dangerous GREEN this FR otherwise closes.
    //
    // This is within the amended spec (§ Technical Design: the fingerprint is
    // unrecoverable, so run identity CANNOT be intrinsic), and it is exactly
    // why the declaration is additive-only — it can admit what the intrinsic
    // checks already allowed, never override a refusal they made. If a future
    // change makes a misdeclaration harmless, this assertion goes RED and the
    // FR's honesty note needs rewriting to match.
    const artifact = agreeingArtifact(LINEAR.file);
    const dir = tempDir("residual");
    const planted = join(dir, LINEAR.capture);
    writeFileSync(planted, artifact);

    const admitted = qualifyCaptureArtifact({
      candidate: { path: planted, bytes: readFileSync(planted) },
      derivedBytes: fixtureBytes(LINEAR.file),
      declaredRun: FIXTURE_RUN,
      expectedRun: FIXTURE_RUN,
    });
    expect(admitted.qualified).toBe(true);
    expect(admitted.reason).toBe("qualified");
    // And it agrees on every key, which is what makes the admission dangerous
    // rather than merely permissive.
    expect(
      scoresAgree(artifact, fixtureText(LINEAR.file), LINEAR.keys),
    ).toBe(true);
  });

  test("SECOND agreeing input — refused when UNDECLARED or MISDECLARED, not because it is from another run", () => {
    // A distinct artifact that scores identically on every key: the repair must
    // not be proven only against the self-compare it most obviously catches.
    const artifact = agreeingArtifact(LINEAR.file);
    const derivedText = fixtureText(LINEAR.file);
    expect(artifact).not.toBe(derivedText);
    expect(scoresAgree(artifact, derivedText, LINEAR.keys)).toBe(true);
    expect(Buffer.byteLength(artifact)).toBeGreaterThan(
      DERIVED_FIXTURE_BYTE_CEILING,
    );

    const dir = tempDir("agreeing");
    const planted = join(dir, LINEAR.capture);
    writeFileSync(planted, artifact);

    // DIRECTION 1 — pre-change: found by name, compared, GREEN.
    const found = preChangeFindCapture([dir], LINEAR.capture);
    expect(found).toBe(planted);
    expect(scoresAgree(readFileSync(found!, "utf-8"), derivedText, LINEAR.keys)).toBe(
      true,
    );

    // DIRECTION 2 — shipped: it clears the floor and differs from the fixture,
    // so the declared run is the property that has to refuse it.
    const undeclared = qualifyCaptureArtifact({
      candidate: { path: planted, bytes: readFileSync(planted) },
      derivedBytes: fixtureBytes(LINEAR.file),
      declaredRun: undefined,
      expectedRun: FIXTURE_RUN,
    });
    expect(undeclared.qualified).toBe(false);
    expect(undeclared.reason).toBe("run-not-declared");

    const wrongRun = qualifyCaptureArtifact({
      candidate: { path: planted, bytes: readFileSync(planted) },
      derivedBytes: fixtureBytes(LINEAR.file),
      declaredRun: OTHER_RUN,
      expectedRun: FIXTURE_RUN,
    });
    expect(wrongRun.qualified).toBe(false);
    expect(wrongRun.reason).toBe("declared-run-mismatch");
  });
});

// ===========================================================================
// AC-STE-458.5 — the differing artifact: refused, not reported as a fixture
// failure. This is the 2026-08-09 symptom.
// ===========================================================================

describe("AC-STE-458.5 — a DIFFERING other-run artifact is refused, not failed", () => {
  test("pre-change it fails the fixture; shipped, it never reaches the comparison", () => {
    const artifact = differingArtifact(
      DERIVED[2].file,
      "cross_cutting_spec_stale_file_refs",
    );
    const derivedText = fixtureText(DERIVED[2].file);
    expect(Buffer.byteLength(artifact)).toBeGreaterThan(
      DERIVED_FIXTURE_BYTE_CEILING,
    );

    // DIRECTION 1 — the form being replaced compares them and disagrees, which
    // is reported as a defect in the committed fixture rather than as a
    // misidentified artifact.
    expect(scoresAgree(artifact, derivedText, DERIVED[2].keys)).toBe(false);

    // DIRECTION 2 — shipped: refused on the run, before any score is compared.
    const dir = tempDir("differing");
    const planted = join(dir, DERIVED[2].capture);
    writeFileSync(planted, artifact);
    const verdict = qualifyCaptureArtifact({
      candidate: { path: planted, bytes: readFileSync(planted) },
      derivedBytes: fixtureBytes(DERIVED[2].file),
      declaredRun: OTHER_RUN,
      expectedRun: runRecordedByFixture(DERIVED[2].file)!,
    });
    expect(verdict.qualified).toBe(false);
    expect(verdict.reason).toBe("declared-run-mismatch");
    expect(verdict.state).toBe("not-qualifying");
  });
});

// ===========================================================================
// END-TO-END — the subject suite re-run against planted capture directories.
//
// `CAPTURE_DIRS` and the `findCapture` calls are module-load evaluated, so the
// only way to observe the real guard deciding is to run the suite as a
// subprocess with the environment set up front and read its junit report back.
// ===========================================================================

interface SubjectCase {
  name: string;
  classname: string;
  skipped: boolean;
  failed: boolean;
}

interface SubjectRun {
  tests: number;
  failures: number;
  skipped: number;
  equivalence: SubjectCase[];
  output: string;
}

/**
 * Scan `<testcase>` elements out of a junit report.
 *
 * Deliberately NOT one regex: a passing case is self-closing (`<testcase … />`)
 * and a greedy attribute class hands the `/` back only under backtracking that
 * never happens, so `…/>` matches the OPEN-tag alternative and swallows every
 * case up to the next `</testcase>`. Measured: three of four cases silently
 * disappeared, which would have made the scenarios below assert over an empty
 * set. Attribute values here never contain `>`.
 */
function parseTestcases(xml: string): SubjectCase[] {
  const CLOSE = "</testcase>";
  const cases: SubjectCase[] = [];
  let at = xml.indexOf("<testcase");
  while (at !== -1) {
    const gt = xml.indexOf(">", at);
    if (gt === -1) break;
    const head = xml.slice(at, gt);
    const selfClosing = head.trimEnd().endsWith("/");
    const attrs = selfClosing ? head.trimEnd().slice(0, -1) : head;
    let body = "";
    let next = gt + 1;
    if (!selfClosing) {
      const close = xml.indexOf(CLOSE, gt);
      if (close !== -1) {
        body = xml.slice(gt + 1, close);
        next = close + CLOSE.length;
      }
    }
    cases.push({
      name: attrs.match(/\bname="([^"]*)"/)?.[1] ?? "",
      classname: attrs.match(/\bclassname="([^"]*)"/)?.[1] ?? "",
      skipped: body.includes("<skipped"),
      failed: body.includes("<failure"),
    });
    at = xml.indexOf("<testcase", next);
  }
  return cases;
}

function runSubjectSuite(opts: {
  captureDir: string;
  declaredRun?: string;
}): SubjectRun {
  const outfile = join(tempDir("junit"), "junit.xml");
  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  env.DPT_CAPTURE_DIR = opts.captureDir;
  if (opts.declaredRun === undefined) delete env.DPT_CAPTURE_RUN;
  else env.DPT_CAPTURE_RUN = opts.declaredRun;

  const proc = spawnSync(
    "bun",
    [
      "test",
      SUBJECT_TEST_REL,
      // Scoped to the describe under observation. Unscoped, each of these six
      // spawns re-ran the WHOLE subject file — including an unrelated
      // stale-file-refs probe that mkdtemps its own scratch project per run, so
      // this file was leaking six scratch dirs it has no interest in on every
      // gate. The `equivalence` filter below already discards those testcases;
      // this stops paying to produce them.
      "-t",
      "fixture equivalence",
      "--reporter=junit",
      `--reporter-outfile=${outfile}`,
    ],
    { cwd: PLUGIN_ROOT, env, encoding: "utf-8" },
  );
  const output = `${proc.stdout ?? ""}${proc.stderr ?? ""}`;
  if (!existsSync(outfile)) {
    throw new Error(`subject suite produced no junit report:\n${output}`);
  }
  const xml = readFileSync(outfile, "utf-8");

  const root = xml.match(/<testsuites\b[^>]*>/)?.[0] ?? "";
  const attr = (name: string): number =>
    Number(root.match(new RegExp(`\\b${name}="(\\d+)"`))?.[1] ?? "-1");

  const equivalence: SubjectCase[] = parseTestcases(xml).filter((testcase) =>
    testcase.classname.includes("fixture equivalence"),
  );

  return {
    tests: attr("tests"),
    failures: attr("failures"),
    skipped: attr("skipped"),
    equivalence,
    output,
  };
}

/** Plant one file per derived fixture, named as the capture it maps to. */
function plantCaptures(
  tag: string,
  content: (entry: (typeof DERIVED)[number]) => string | null,
): string {
  const dir = tempDir(tag);
  for (const entry of DERIVED) {
    const body = content(entry);
    if (body === null) continue;
    writeFileSync(join(dir, entry.capture), body);
  }
  return dir;
}

/**
 * The equivalence block's own test count: one per derived fixture plus the
 * raw-method assertion on the linear capture. Pinned so a scenario cannot go
 * quietly vacuous by matching zero cases.
 */
const EQUIVALENCE_CASE_COUNT = DERIVED.length + 1;

// The subject suite also searches `/tmp`, which we cannot shadow when the point
// of the scenario is that NOTHING is planted. Say so out loud instead of
// pretending the machine is clean.
const TMP_CAPTURES_PRESENT = DERIVED.some((entry) =>
  existsSync(join("/tmp", entry.capture)),
);

describe("AC-STE-458.3 / AC-STE-458.6 / AC-STE-458.7 — the guard, observed in the real suite", () => {
  test.skipIf(TMP_CAPTURES_PRESENT)(
    "ARTIFACT ABSENT — the block skips, and says absent" +
      (TMP_CAPTURES_PRESENT ? " [SKIPPED — a real capture is sitting in /tmp]" : ""),
    () => {
      const run = runSubjectSuite({ captureDir: tempDir("empty") });
      expect(run.failures).toBe(0);
      expect(run.equivalence.length).toBe(EQUIVALENCE_CASE_COUNT);
      for (const testcase of run.equivalence) {
        expect(testcase.skipped).toBe(true);
        expect(testcase.name).toContain("artifact-absent");
      }
    },
    60_000,
  );

  test(
    "SELF-COMPARE PLANTED — skipped with a reason distinct from absent",
    () => {
      // The whole defect in one scenario: copy each derived fixture to the path
      // its capture would occupy. Pre-change this reported GREEN.
      const dir = plantCaptures("selfcompare-suite", (entry) =>
        fixtureText(entry.file),
      );
      const run = runSubjectSuite({ captureDir: dir, declaredRun: FIXTURE_RUN });
      expect(run.failures).toBe(0);
      expect(run.equivalence.length).toBe(EQUIVALENCE_CASE_COUNT);
      for (const testcase of run.equivalence) {
        expect(testcase.skipped).toBe(true);
        expect(testcase.name).toContain("identical-to-derived-fixture");
        expect(testcase.name).not.toContain("artifact-absent");
      }
    },
    60_000,
  );

  test(
    "OTHER RUN PLANTED — differing artifacts skip instead of reddening the gate",
    () => {
      // The 2026-08-09 shape: another run's captures at the same paths. Three
      // assertions failed then; they must skip now.
      const dir = plantCaptures("otherrun-suite", (entry) =>
        differingArtifact(entry.file, entry.keys[0]),
      );

      const undeclared = runSubjectSuite({ captureDir: dir });
      expect(undeclared.failures).toBe(0);
      expect(undeclared.equivalence.length).toBe(EQUIVALENCE_CASE_COUNT);
      for (const testcase of undeclared.equivalence) {
        expect(testcase.skipped).toBe(true);
        expect(testcase.name).toContain("run-not-declared");
      }

      const misdeclared = runSubjectSuite({
        captureDir: dir,
        declaredRun: OTHER_RUN,
      });
      expect(misdeclared.failures).toBe(0);
      for (const testcase of misdeclared.equivalence) {
        expect(testcase.skipped).toBe(true);
        expect(testcase.name).toContain("declared-run-mismatch");
      }
    },
    60_000,
  );

  test(
    "QUALIFYING ARTIFACT — the block RUNS the full equivalence assertion",
    () => {
      // Proof by construction that safety was not bought with permanent
      // unreachability: synthetic captures that clear the floor, differ from
      // the fixtures, and declare the matching run.
      const dir = plantCaptures("qualifying-suite", (entry) =>
        agreeingArtifact(entry.file),
      );
      const run = runSubjectSuite({ captureDir: dir, declaredRun: FIXTURE_RUN });
      expect(run.failures).toBe(0);
      expect(run.equivalence.length).toBe(EQUIVALENCE_CASE_COUNT);
      for (const testcase of run.equivalence) {
        expect(testcase.skipped).toBe(false);
        expect(testcase.name).not.toContain("SKIPPED");
      }
    },
    60_000,
  );

  test(
    "QUALIFYING AND WRONG — the comparison it runs can still FAIL",
    () => {
      // The other half of non-vacuity: a qualifying artifact whose scores are
      // wrong must redden. A block that can only ever skip or pass is not a
      // guard.
      const dir = plantCaptures("qualifying-wrong-suite", (entry) =>
        entry.file === DERIVED[2].file
          ? differingArtifact(entry.file, entry.keys[0])
          : agreeingArtifact(entry.file),
      );
      const run = runSubjectSuite({ captureDir: dir, declaredRun: FIXTURE_RUN });
      const failed = run.equivalence.filter((testcase) => testcase.failed);
      expect(failed.length).toBe(1);
      expect(failed[0]!.name).toContain(DERIVED[2].file);
      expect(run.failures).toBe(1);
    },
    60_000,
  );
});
