import { afterAll, describe, expect, test } from "bun:test";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// M116 / STE-423 — "Tracker-scope every smoke artifact path and pidfile glob".
//
// The smoke SKILL promises that a two-terminal tandem run (one leg per
// tracker) is safe *by construction* because every per-run artifact is keyed
// on the resolved `<tracker>`. Two surfaces broke that promise, and both were
// live during the 2026-07-27 conformance run:
//
//   1. Phase 8 wrote its transcript fixtures to a path keyed only on the DATE,
//      and reasoned explicitly that the date is what prevents concurrent
//      collision. A date cannot disambiguate two same-day legs, and two
//      same-day legs is precisely the sanctioned mode. The Jira leg noticed
//      and deviated, writing `<skill>-jira-<DATE>.json` instead.
//
//   2. Worse: the pre-final-message liveness fence walks the UNSCOPED pattern
//      `/tmp/dpt-smoke-*.pid`, and its abort branch instructs the driver to
//      `kill` every PID it finds there and then `rm -f` the matching files.
//      The `ps -p <pid> -o comm=` identity check does NOT protect the victim —
//      the partner leg's grandchild is a genuine `claude` process and sails
//      through the guard. The documented abort would have SIGTERMed the other
//      leg's children and deleted its pidfiles.
//
// COUNTING NOTE (the FR is off by one, deliberately pinned here). The FR text
// says "all four occurrences" of `/tmp/dpt-smoke-*.pid`. There are four SITES
// but FIVE literals — SKILL.md:339, :383, :445 (TWO on that single line) and
// :453. The two on :445 sit inside the very clause that performs the
// destructive reap. Every predicate below therefore asserts on the LITERAL
// COUNT, never on a site count, so the fix cannot be half-landed.
//
// AC-STE-423.1 — Phase 8 fixture path carries the tracker segment; the
//   "the date prevents concurrent collision" rationale is gone and not
//   replaced by an equivalent claim.
// AC-STE-423.2 — every pidfile glob used for liveness detection or reaping
//   carries the tracker segment: zero unscoped literals survive, and each of
//   the three abort clauses plus the fenced snippet carries the scoped form.
//   Plus the null-glob guard the two prose clauses omit (the operator's shell
//   is zsh, where an unmatched glob is an ERROR, not an empty expansion).
// AC-STE-423.3 — tandem non-vacuity: real files, real processes, real shell
//   glob expansion. A simulated abort on the linear leg leaves the concurrently
//   live jira leg's pidfiles AND processes untouched — and the unscoped
//   pattern is shown to WOULD-have matched them, proving the scoping is the
//   thing that saves the partner.
// AC-STE-423.4 — the durable meta-test: every `dpt-smoke-` literal in the
//   skill carries `linear` / `jira` / `<tracker>`, modulo a small explicit
//   allow-list of genuinely global audit-trail artifacts.
// AC-STE-423.5 — the operator-driven-parallelism section's safety claim is
//   re-derived from the corrected paths and names the mechanism it actually
//   rests on.
//
// ─── RED-ON-LANDING: two existing files hard-pin the OLD unscoped literal ───
// These are legitimate pins of the pre-STE-423 contract and MUST be updated in
// the same commit that scopes the glob. They are NOT touched by this file:
//   * tests/m112-ste-414-nontty-hard-gate.test.ts — lines 823, 848, 860, 869,
//     903 (several feed `escapeRegExp(pidGlob)` into `\brm -f <glob>` matchers)
//   * tests/harness-driver-abort-reap-parity.test.ts:360 —
//     `const PID_GLOB = "/tmp/dpt-smoke-*.pid";`, consumed by a hard drift
//     guard at ~:421 `expect(selfCheck()).toContain("rm -f " + PID_GLOB)`
// The self-check-clause predicates below exist precisely so the implementer
// cannot satisfy those old pins by reverting the fix.
//
// OUT OF SCOPE: `.claude/skills/conformance-loop/SKILL.md` uses its own
// `/tmp/dpt-conformance-loop-*.pid` glob. Only one conformance-loop driver
// runs at a time (it is the thing that spawns the two smoke legs), so it has
// no tandem partner to clobber. STE-423 names the smoke SKILL only.

const repoRoot = join(import.meta.dir, "..", "..", "..");
const skillPath = join(repoRoot, ".claude", "skills", "smoke-test", "SKILL.md");

function readIfPresent(path: string): string | null {
  try {
    return existsSync(path) ? readFileSync(path, "utf8") : null;
  } catch {
    return null;
  }
}

const skill = readIfPresent(skillPath);
const SKILL_TEXT = skill ?? "";
const D = skill === null ? describe.skip : describe;

// ─────────────────────────── shared vocabulary ───────────────────────────

/** The literal the FR exists to eradicate. Five occurrences on four lines. */
const UNSCOPED_PID_GLOB = "/tmp/dpt-smoke-*.pid";

/**
 * A tracker segment, in any of the forms the SKILL's house style already
 * uses. `<tracker>` is the dominant one — the skill writes it even inside
 * bash fences (see the Phase 2 `--mcp-config /tmp/dpt-smoke-<tracker>-…`
 * snippets) — but a real `${TRACKER}` shell variable is equally correct, as
 * are the two resolved values.
 */
const TRACKER_SEGMENT = String.raw`(?:<tracker>|\$\{TRACKER\}|\$TRACKER|linear|jira)`;

/** Source-of-truth builder — every scoped-glob predicate uses this one shape. */
function scopedPidGlobRe(flags = ""): RegExp {
  return new RegExp(
    String.raw`/tmp/dpt-smoke-${TRACKER_SEGMENT}-\*\.pid`,
    flags,
  );
}

function countLiteral(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

function countMatches(haystack: string, re: RegExp): number {
  return haystack.match(re)?.length ?? 0;
}

// ───────────────────────── section / clause anchors ──────────────────────

/** The `\n\n`-delimited block whose first non-space chars are `anchor`. */
function paragraphStartingWith(anchor: string): string {
  const block = SKILL_TEXT.split(/\n{2,}/).find((b) =>
    b.trimStart().startsWith(anchor),
  );
  return block ?? "";
}

/** Markdown section from the first heading line matching `pred` to the next heading of equal-or-shallower depth. */
function sectionByHeading(pred: (line: string) => boolean): string {
  const lines = SKILL_TEXT.split("\n");
  const start = lines.findIndex((l) => /^#{1,6} /.test(l) && pred(l));
  if (start < 0) return "";
  const depth = lines[start].match(/^#+/)![0].length;
  const stop = new RegExp(`^#{1,${depth}} `);
  for (let i = start + 1; i < lines.length; i++) {
    if (stop.test(lines[i])) return lines.slice(start, i).join("\n");
  }
  return lines.slice(start).join("\n");
}

function fencedBlocksContaining(needle: string): string[] {
  const out: string[] = [];
  const re = /```[a-zA-Z-]*\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(SKILL_TEXT)) !== null) {
    if (m[1].includes(needle)) out.push(m[1]);
  }
  return out;
}

const headlessAbortClause = () =>
  paragraphStartingWith("**Headless-gate violation ⇒ abort with full teardown.**");
const markerAbsentAbortClause = () =>
  paragraphStartingWith("**Branch 2 — marker absent ⇒ abort with full teardown.**");
const selfCheckClause = () => paragraphStartingWith("**Final-message self-check");
const selfCheckFence = () => fencedBlocksContaining("for PIDFILE in")[0] ?? "";
const phase8Section = () =>
  sectionByHeading((l) => l.startsWith("### Phase 8"));
const phase8Fence = () => fencedBlocksContaining("FIXTURE_DIR=")[0] ?? "";
const parallelismSection = () =>
  sectionByHeading((l) => /^##+ Operator-driven parallelism/.test(l));

/**
 * zsh — the operator's shell — treats an unmatched glob as an ERROR and does
 * not run the command at all, so a bare `rm -f /tmp/dpt-smoke-<tracker>-*.pid`
 * in an abort clause aborts the abort. The fenced self-check already guards
 * with `setopt local_options null_glob …`; Phase 0.5 guards by wrapping in
 * `bash -c '…'`. Either shape counts.
 */
function isNullGlobSafe(clause: string): boolean {
  return /bash -c/.test(clause) || /null_?glob/i.test(clause);
}

// ══════════════════════════════════════════════════════════════════════════

D("STE-423 — the smoke driver SKILL is readable", () => {
  test("the project-local smoke SKILL.md resolves from the plugin test dir", () => {
    expect(skill).not.toBeNull();
    expect(SKILL_TEXT.length).toBeGreaterThan(1000);
  });
});

// ─────────────────────── AC-STE-423.2 — pidfile globs ────────────────────

D("AC-STE-423.2 — every pidfile glob carries the tracker segment", () => {
  test("ZERO unscoped `/tmp/dpt-smoke-*.pid` literals survive anywhere in the skill", () => {
    // Literal count, not site count: :445 carries TWO on one line and it is
    // the clause that performs the destructive reap. A four-replacement fix
    // leaves the worst one live.
    expect(countLiteral(SKILL_TEXT, UNSCOPED_PID_GLOB)).toBe(0);
  });

  test("the scoped form replaces all five — 5 fix sites plus the 2 pre-existing Phase 0.5 globs", () => {
    // Phase 0.5's verified-wipe pair (`rm -f …` + the `ls …` verification)
    // already carries `/tmp/dpt-smoke-<tracker>-*.pid`, so the post-fix floor
    // is 5 + 2 = 7. Asserting >= 5 would go green on a 3-of-5 partial fix.
    expect(countMatches(SKILL_TEXT, scopedPidGlobRe("g"))).toBeGreaterThanOrEqual(7);
  });

  test("the headless-gate-violation abort clause reaps through the tracker-scoped glob", () => {
    const clause = headlessAbortClause();
    expect(clause.length).toBeGreaterThan(0); // anchor still resolves
    expect(clause).toMatch(scopedPidGlobRe());
    expect(clause).not.toContain(UNSCOPED_PID_GLOB);
  });

  test("the marker-absent abort clause reaps through the tracker-scoped glob", () => {
    const clause = markerAbsentAbortClause();
    expect(clause.length).toBeGreaterThan(0);
    expect(clause).toMatch(scopedPidGlobRe());
    expect(clause).not.toContain(UNSCOPED_PID_GLOB);
  });

  test("the Final-message self-check clause carries the scoped glob at BOTH of its sites", () => {
    // This clause is the documented trap: the liveness-fence mention and the
    // `rm -f` reap are two separate literals on the same line, and the reap
    // is the destructive one.
    const clause = selfCheckClause();
    expect(clause.length).toBeGreaterThan(0);
    expect(countLiteral(clause, UNSCOPED_PID_GLOB)).toBe(0);
    expect(countMatches(clause, scopedPidGlobRe("g"))).toBeGreaterThanOrEqual(2);
  });

  test("the self-check clause's `rm -f` reap names the scoped glob, not a bare one", () => {
    // Guards against satisfying `harness-driver-abort-reap-parity.test.ts`'s
    // `toContain("rm -f " + PID_GLOB)` drift guard by reverting the fix.
    const clause = selfCheckClause();
    const rmRe = new RegExp(
      String.raw`rm -f /tmp/dpt-smoke-${TRACKER_SEGMENT}-\*\.pid`,
    );
    expect(clause).toMatch(rmRe);
  });

  test("the fenced self-check snippet iterates the tracker-scoped glob", () => {
    const fence = selfCheckFence();
    expect(fence.length).toBeGreaterThan(0);
    const forLine = fence.match(/for PIDFILE in (.+?); do/);
    expect(forLine).not.toBeNull();
    expect(forLine![1]).toMatch(scopedPidGlobRe());
  });

  test("the headless-gate-violation abort clause's `rm -f` is null-glob safe under zsh", () => {
    expect(isNullGlobSafe(headlessAbortClause())).toBe(true);
  });

  test("the marker-absent abort clause's `rm -f` is null-glob safe under zsh", () => {
    expect(isNullGlobSafe(markerAbsentAbortClause())).toBe(true);
  });
});

// ─────────────────── AC-STE-423.1 — Phase 8 fixture path ─────────────────

D("AC-STE-423.1 — the Phase 8 fixture path carries the tracker segment", () => {
  const FIXTURE_PATH_RE = /tests\/fixtures\/socratic-first-turn\/([^\s`)"']+)/g;

  test("every filename-bearing socratic-first-turn fixture path in the skill is tracker-scoped", () => {
    const names = [...SKILL_TEXT.matchAll(FIXTURE_PATH_RE)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(0); // non-vacuity: the path still exists
    const unscoped = names.filter((n) => !new RegExp(TRACKER_SEGMENT).test(n));
    expect(unscoped).toEqual([]);
  });

  test("the Phase 8 prose still documents the fixture path, and it is scoped", () => {
    const section = phase8Section();
    expect(section.length).toBeGreaterThan(0);
    const names = [...section.matchAll(FIXTURE_PATH_RE)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(0);
    for (const n of names) {
      expect(n).toMatch(new RegExp(TRACKER_SEGMENT));
      expect(n).toContain("<skill>"); // still the per-skill fixture, not collapsed
    }
  });

  test("the Phase 8 driver fence writes FIXTURE to a tracker-scoped path", () => {
    const fence = phase8Fence();
    expect(fence.length).toBeGreaterThan(0);
    const line = fence.split("\n").find((l) => /^\s*FIXTURE=/.test(l));
    expect(line).toBeDefined();

    const usesVar = /\$\{?TRACKER\}?/.test(line!);
    const usesPlaceholder = /<tracker>/.test(line!);
    expect(usesVar || usesPlaceholder).toBe(true);

    // A `${TRACKER}` that is never assigned collapses the filename right back
    // to the unscoped shape (`setup--2026-07-27.json`) at runtime.
    if (usesVar) expect(fence).toMatch(/^\s*TRACKER=/m);
  });

  test("the defective rationale — a DATE preventing concurrent collision — is gone verbatim", () => {
    expect(SKILL_TEXT).not.toContain(
      "The fixture filename includes the date so concurrent runs don't collide",
    );
    expect(SKILL_TEXT).not.toContain("per-tracker scoping is unnecessary");
  });

  test("no replacement rationale re-asserts that a date-keyed filename prevents concurrent collision", () => {
    // Catches a reworded restatement of the same false claim.
    expect(SKILL_TEXT).not.toMatch(
      /date[^.\n]{0,120}concurrent[^.\n]{0,60}collid/i,
    );
    expect(SKILL_TEXT).not.toMatch(
      /concurrent[^.\n]{0,60}collid[^.\n]{0,120}\bdate\b/i,
    );
  });
});

// ───────────── AC-STE-423.3 — tandem non-vacuity (real processes) ─────────

D("AC-STE-423.3 — a simulated abort on one leg leaves the partner leg untouched", () => {
  const children: ChildProcess[] = [];
  const dirs: string[] = [];

  afterAll(() => {
    for (const c of children) {
      try {
        if (c.exitCode === null && c.signalCode === null && c.pid) {
          process.kill(c.pid, "SIGKILL");
        }
      } catch {
        /* already gone */
      }
    }
    for (const d of dirs) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    }
  });

  /** Real shell glob expansion — never a hand-rolled string match. */
  function expandGlob(pattern: string): string[] {
    const out = execFileSync(
      "bash",
      ["-c", `shopt -s nullglob; for f in ${pattern}; do printf '%s\\n' "$f"; done`],
      { encoding: "utf8" },
    );
    return out.split("\n").filter(Boolean);
  }

  function alive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  function waitExit(c: ChildProcess, ms: number): Promise<boolean> {
    if (c.exitCode !== null || c.signalCode !== null) return Promise.resolve(true);
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve(false), ms);
      c.once("exit", () => {
        clearTimeout(t);
        resolve(true);
      });
    });
  }

  /** Rewrite a documented `/tmp/…` glob onto a sandbox root, resolving `<tracker>`. */
  function legGlob(documented: string, tracker: string, root: string): string {
    return documented
      .replace(/<tracker>|\$\{TRACKER\}|\$TRACKER/g, tracker)
      .replace(/^\/tmp/, root);
  }

  const hasSleep = existsSync("/bin/sleep");

  test.skipIf(!hasSleep)(
    "a linear-scoped reap kills only linear grandchildren and deletes only linear pidfiles",
    async () => {
      // The glob under test is lifted from the SKILL's own reap fence — not
      // hard-coded here — so this test cannot pass while the fence is still
      // unscoped.
      const forLine = selfCheckFence().match(/for PIDFILE in (.+?); do/);
      expect(forLine).not.toBeNull();
      const documented = forLine![1].trim();
      expect(documented).toMatch(scopedPidGlobRe());

      const dir = mkdtempSync(join(tmpdir(), "ste423-tandem-"));
      dirs.push(dir);
      expect(dir).not.toMatch(/[\s'"*?]/); // keep the unquoted glob honest

      // `ps -p <pid> -o comm=` reports the invoked path; a symlink named
      // `claude` therefore satisfies the fence's identity check exactly the
      // way a real grandchild does — which is the whole point: the partner's
      // process is a GENUINE claude, so the identity guard does not save it.
      const fakeClaude = join(dir, "claude");
      symlinkSync("/bin/sleep", fakeClaude);

      function spawnLeg(): ChildProcess {
        const c = spawn(fakeClaude, ["300"], { stdio: "ignore" });
        children.push(c);
        return c;
      }

      const linearSetup = spawnLeg();
      const linearSpecWrite = spawnLeg();
      const jiraSetup = spawnLeg();
      const jiraSpecWrite = spawnLeg();

      const pidfile = (name: string) => join(dir, `dpt-smoke-${name}.pid`);
      const sets: Array<[string, ChildProcess]> = [
        ["linear-setup", linearSetup],
        ["linear-spec-write", linearSpecWrite],
        ["jira-setup", jiraSetup],
        ["jira-spec-write", jiraSpecWrite],
      ];
      for (const [name, child] of sets) {
        expect(child.pid).toBeDefined();
        writeFileSync(pidfile(name), `${child.pid}\n`, "utf8");
      }

      const linearPattern = legGlob(documented, "linear", dir);
      const unscopedPattern = legGlob(UNSCOPED_PID_GLOB, "linear", dir);

      // ── Non-vacuity: the UNSCOPED pattern would have taken the partner. ──
      const wouldHaveMatched = expandGlob(unscopedPattern);
      expect(wouldHaveMatched).toContain(pidfile("jira-setup"));
      expect(wouldHaveMatched).toContain(pidfile("jira-spec-write"));
      expect(wouldHaveMatched.length).toBe(4);

      // ── The scoped pattern sees only its own leg. ──
      const scopedMatched = expandGlob(linearPattern).sort();
      expect(scopedMatched).toEqual(
        [pidfile("linear-setup"), pidfile("linear-spec-write")].sort(),
      );

      // ── Run the SKILL's documented abort reap, verbatim in shape. ──
      execFileSync(
        "bash",
        [
          "-c",
          [
            "shopt -s nullglob",
            `for PIDFILE in ${linearPattern}; do`,
            '  [ -e "${PIDFILE}" ] || continue',
            '  PID=$(cat "${PIDFILE}")',
            '  COMM=$(ps -p "${PID}" -o comm= 2>/dev/null || true)',
            '  case "$(basename "${COMM:-none}")" in claude) kill "${PID}" ;; esac',
            "done",
            `rm -f ${linearPattern}`,
          ].join("\n"),
        ],
        { encoding: "utf8" },
      );

      // The reap really reaped its own leg.
      expect(await waitExit(linearSetup, 5000)).toBe(true);
      expect(await waitExit(linearSpecWrite, 5000)).toBe(true);
      expect(alive(linearSetup.pid!)).toBe(false);
      expect(alive(linearSpecWrite.pid!)).toBe(false);
      expect(existsSync(pidfile("linear-setup"))).toBe(false);
      expect(existsSync(pidfile("linear-spec-write"))).toBe(false);

      // The partner leg is untouched — processes AND pidfiles.
      expect(jiraSetup.exitCode).toBeNull();
      expect(jiraSetup.signalCode).toBeNull();
      expect(jiraSpecWrite.exitCode).toBeNull();
      expect(jiraSpecWrite.signalCode).toBeNull();
      expect(alive(jiraSetup.pid!)).toBe(true);
      expect(alive(jiraSpecWrite.pid!)).toBe(true);
      expect(existsSync(pidfile("jira-setup"))).toBe(true);
      expect(existsSync(pidfile("jira-spec-write"))).toBe(true);
      expect(readFileSync(pidfile("jira-setup"), "utf8").trim()).toBe(
        String(jiraSetup.pid),
      );
      expect(readFileSync(pidfile("jira-spec-write"), "utf8").trim()).toBe(
        String(jiraSpecWrite.pid),
      );
    },
    30000,
  );
});

// ──────────────── AC-STE-423.4 — the durable grep-shape probe ─────────────

D("AC-STE-423.4 — no smoke artifact literal in the skill lacks the tracker segment", () => {
  /**
   * Genuinely-global `dpt-smoke-` literals, each justified. Keep this list
   * SMALL — every entry is a hole in the invariant.
   *
   *  * `dpt-smoke-prompt-*.txt` — Phase 0.5's legacy scratch glob. Post-STE-185
   *    the driver writes no prompt scratch files at all, so the glob is a
   *    documented no-op kept as defense-in-depth against a legacy driver
   *    checked out elsewhere (SKILL.md § Phase 0.5, "Defense-in-depth
   *    annotation"). Nothing a tandem partner owns can land at that path.
   *  * `dpt-smoke-findings-*.md` — appears ONLY inside the "audit-trail
   *    invariant — do NOT delete" sentence. It is a PRESERVE directive, never
   *    a write or a remove target; the real findings path
   *    (`/tmp/dpt-smoke-findings-<date>-<tracker>.md`) is already scoped.
   *  * `dpt-smoke-findings.md` — a historical reference to the canonical
   *    2026-04-25 run's file, cited as a formatting exemplar. Not a path this
   *    driver writes.
   */
  const ALLOWED_UNSCOPED = new Set([
    "dpt-smoke-prompt-*.txt",
    "dpt-smoke-findings-*.md",
    "dpt-smoke-findings.md",
  ]);

  // Trailing char class deliberately excludes `.` and `,` so sentence
  // punctuation is not swallowed into the literal.
  const SMOKE_LITERAL_RE = /dpt-smoke-[A-Za-z0-9_.*{}<>$,-]*[A-Za-z0-9_*}>]/g;

  function literals(): string[] {
    return [...new Set(SKILL_TEXT.match(SMOKE_LITERAL_RE) ?? [])];
  }

  test("the scan finds a substantial literal population (non-vacuity)", () => {
    expect(literals().length).toBeGreaterThan(20);
  });

  test("every `dpt-smoke-` literal carries linear / jira / <tracker>, modulo the allow-list", () => {
    const tracker = new RegExp(TRACKER_SEGMENT);
    const offenders = literals().filter(
      (lit) => !tracker.test(lit) && !ALLOWED_UNSCOPED.has(lit),
    );
    expect(offenders).toEqual([]);
  });

  test("the allow-list stays small and every entry is still live in the skill", () => {
    // A stale allow-list entry is a permanently-open hole. Both halves matter:
    // the size cap keeps the exemption surface honest, the liveness check
    // stops a removed path from silently licensing a future unscoped one.
    expect(ALLOWED_UNSCOPED.size).toBeLessThanOrEqual(4);
    for (const entry of ALLOWED_UNSCOPED) {
      expect(SKILL_TEXT).toContain(entry);
    }
  });
});

// ───────────── AC-STE-423.5 — the parallelism-safety claim ────────────────

D("AC-STE-423.5 — the parallelism-safety claim is re-derived from the corrected paths", () => {
  test("the operator-driven-parallelism section still exists", () => {
    expect(parallelismSection().length).toBeGreaterThan(200);
  });

  test("the section names the tracker segment as the mechanism the claim rests on", () => {
    // The phrase appears nowhere in the skill today — the current text asserts
    // isolation, it does not derive it.
    expect(parallelismSection()).toMatch(/tracker segment/i);
  });

  test("the section's isolation claim covers pidfile globs, not just artifact filenames", () => {
    // The section enumerates directories, findings files, logs, json and txt —
    // and says nothing at all about pidfiles, which is exactly the surface
    // that could SIGTERM the partner.
    expect(parallelismSection()).toMatch(/pidfile/i);
  });

  test("the unqualified three-never claim is re-derived, not left standing as a bare assertion", () => {
    expect(SKILL_TEXT).not.toContain(
      "The two runs never touch the same path, never read the same MCP config, and never write the same findings file.",
    );
  });
});
