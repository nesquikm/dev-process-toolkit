// harness_artifact_paths — the per-run artifact-path invariant for the two
// harness SKILLs, made ENFORCEABLE.
//
// WHY THIS MODULE EXISTS (STE-487). The 2026-08-16 conformance run fired all
// three legs concurrently and preserved an A/B control inside one run:
//
//   tests/fixtures/nested-spawn/     ← path carries <tracker>
//       8a-none-2026-08-16.log     20:26
//       8a-jira-2026-08-16.log     20:38
//       8a-linear-2026-08-16.log   21:37     ⇒ all three legs survived
//
//   tests/fixtures/capability-rows/  ← Phase 9, path carried NO <tracker>
//       {draft-commit,branch-on-main,branch-off-trunk,
//        research-seeded,research-fresh}-2026-08-16.log   ALL stamped 22:21
//                                          ⇒ ONE leg's set. Two legs' evidence
//                                            was overwritten and destroyed.
//
// The only difference between the surviving three and the destroyed two is the
// `<tracker>` segment.
//
// STE-423 already CLAIMED "every path a leg writes, globs, or reaps carries the
// segment", but its scan keyed on the literal `dpt-smoke-` prefix and Phase 9's
// persist path (`tests/fixtures/capability-rows/<fixture-name>-<date>.log`)
// carries no such prefix, so the scan never looked at it. A claim that cannot
// see the offending path class is a restatement, not an enforcement. This
// module is the enforcement: it enumerates per-run artifact path literals out
// of BOTH harness SKILL bodies — `/tmp` scratch AND in-repo fixture classes —
// and reports every one that carries no tracker/leg segment.
//
// It ships with a CLI so the same decision is available to a shell gate:
//
//     bun adapters/_shared/src/harness_artifact_paths.ts            # both SKILLs
//     bun adapters/_shared/src/harness_artifact_paths.ts FILE...    # exactly those
//     bun adapters/_shared/src/harness_artifact_paths.ts ignore-scan  # STE-565
//
// One verdict line on stdout, and the VERDICT IS THE EXIT CODE:
//     artifact-paths: ok scanned=<N> unscoped=0        → exit 0
//     artifact-paths: FAIL scanned=<N> unscoped=<M>    → exit 1
// The line is one line either way, which is precisely why any falsifiability
// clause bound to this check must score `exit-code` and never a stdout count
// (the STE-485 lesson).

import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { SMOKE_LEGS } from "./smoke_fixture_groups";

/** Repo root, derived from this file's own location (…/plugins/dev-process-toolkit/adapters/_shared/src). */
const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..", "..");

/**
 * The two harness SKILLs, repo-root-relative. Both are project-local skills at
 * the REPO ROOT — outside the plugin — and both write per-run artifacts, so the
 * invariant has to cover the pair or it covers neither.
 */
export const HARNESS_SKILL_RELATIVE_PATHS: readonly string[] = [
  ".claude/skills/smoke-test/SKILL.md",
  ".claude/skills/conformance-loop/SKILL.md",
];

/** The five Phase 9 lenient-assertion fixtures, in § Phase 9's own order. */
export const PHASE9_FIXTURE_NAMES: readonly string[] = [
  "draft-commit",
  "branch-on-main",
  "branch-off-trunk",
  "research-seeded",
  "research-fresh",
];

/**
 * The scratch ROOT Phase 9 captures land under, OUTSIDE the toolkit repo. Each
 * leg gets its own `dpt-smoke-<tracker>-phase9/` directory beneath it.
 *
 * Outside the repo, not ignored-inside, on purpose. An ignore rule would have
 * to be narrow enough to spare the six committed capability-row fixtures
 * sitting in the same directory (the STE-425 lesson: a `*` that crosses a `/`
 * takes the committed evidence with it), and it would still leave ~2 MB of run
 * evidence accumulating in the tree. A `/tmp` root has neither problem and is
 * where every other per-run scratch class in this harness already lives.
 */
export const PHASE9_ARTIFACT_DIR = "/tmp";

/**
 * Resolve one Phase 9 capture path.
 *
 * `/tmp/dpt-smoke-<tracker>-phase9/<fixture>-<YYYY-MM-DD>.log`.
 *
 * The leg is a DIRECTORY segment rather than a filename segment, and that is
 * the one shape that answers both scans at once: STE-423's `dpt-smoke-`
 * prefix scan reads a literal up to the next `/`, so it sees
 * `dpt-smoke-<tracker>-phase9` and finds the tracker there, while this module's
 * enumerator reads the whole literal. A per-leg directory separates the legs
 * exactly as strongly as a per-leg filename would — nothing one leg writes can
 * name a path another leg writes.
 *
 * The calendar day alone separates successive runs of the SAME leg; it cannot
 * separate two legs that ran on the same day, which is the sanctioned tandem
 * mode and exactly the collision measured on 2026-08-16.
 */
export function phase9ArtifactPath(
  fixture: string,
  tracker: string,
  date: string,
): string {
  return join(
    PHASE9_ARTIFACT_DIR,
    `dpt-smoke-${tracker}-phase9`,
    `${fixture}-${date}.log`,
  );
}

/** One per-run artifact path literal found in a harness SKILL body. */
export interface ArtifactPathRef {
  /** The literal, exactly as it appears on its line. */
  readonly path: string;
  /** 1-based line number within the scanned body. */
  readonly line: number;
  /** Whether the literal carries a tracker/leg segment. */
  readonly scoped: boolean;
}

/**
 * Genuinely-global artifact literals: paths a SINGLETON driver writes once per
 * invocation, not once per leg, plus the audit-trail records the teardown is
 * forbidden to reap.
 *
 * EVERY ENTRY IS A PERMANENTLY-OPEN HOLE in the invariant, so the list is
 * capped and each entry must still be live in one of the two SKILLs — a removed
 * path left behind here would silently license a future unscoped one that
 * happens to spell the same thing.
 *
 * Entries are verbatim literals from the SKILLs (that is what keeps the
 * liveness check meaningful); matching is done on the placeholder-normalized
 * form, so one entry covers `<date>` / `<DATE>` / `${DATE}` spellings of the
 * same path without three near-duplicate rows.
 */
export const GLOBAL_ARTIFACT_ALLOWLIST: readonly string[] = [
  // The canonical 2026-04-25 findings file, cited as a shape reference.
  "/tmp/dpt-smoke-findings.md",
  // The loop driver's operator-consent record: one per invocation, never per leg.
  "/tmp/dpt-conformance-loop-<date>-approval.txt",
  // The loop driver's per-iteration AGGREGATE report — it spans every leg, so a
  // leg segment would be a category error rather than an improvement.
  "/tmp/dpt-conformance-loop-<date>-iter-<N>.md",
  "/tmp/dpt-conformance-loop-<date>-iter-1.md",
  "/tmp/dpt-conformance-loop-<date>-iter-2.md",
  "/tmp/dpt-conformance-loop-<date>-iter-3.md",
  // `--auto-fix` dispatches run against the TOOLKIT repo once per finding, from
  // the singleton driver — there is no leg for them to be keyed by.
  "/tmp/dpt-conformance-loop-${DATE}-iter-${ITER}-fix-${IDX}-implement.log",
  "/tmp/dpt-conformance-loop-${DATE}-iter-${ITER}-fix-${IDX}-spec-write.log",
];

/**
 * Bare leg names, matched only as delimited segments.
 *
 * Derived from `SMOKE_LEGS` — the declared authority on the leg set — rather
 * than restated here. A second copy would let the registry widen while this
 * scan kept reading the old three, and a path scoped to the new leg would be
 * reported as unscoped: the enforcement would fail precisely on the leg it had
 * never heard of.
 */
const LEG_NAMES: readonly string[] = SMOKE_LEGS;

/** Placeholder spellings that stand for the resolved leg at write time. */
const LEG_PLACEHOLDERS = [
  "<tracker>",
  "${TRACKER}",
  "<leg>",
  "${LEG}",
  "${SEL}",
  "<spawned leg>",
] as const;

/**
 * Extensions that mark a path literal as a run ARTIFACT rather than a source
 * file. Deliberately narrow: `.ts` / `.sh` / `.yaml` are code, and a check that
 * enumerated them would spend its whole budget on false offenders.
 */
const ARTIFACT_EXTENSIONS = [
  "log",
  "json",
  "jsonl",
  "ndjson",
  "md",
  "txt",
  "rc",
  "pid",
  "start",
];

const ARTIFACT_EXTENSION_RE = new RegExp(`\\.(${ARTIFACT_EXTENSIONS.join("|")})$`);

/**
 * Roots under which a path literal is a per-run artifact.
 *
 * This is the pair that closes STE-423's blind spot: `/tmp/` alone was never
 * the problem — `tests/fixtures/` is where Phase 9 destroyed evidence.
 */
function underArtifactRoot(path: string): boolean {
  return path.startsWith("/tmp/") || path.includes("tests/fixtures/");
}

/** Collapse `<foo>` / `${FOO}` placeholders so spelling variants compare equal. */
function normalizePlaceholders(path: string): string {
  return path
    .replace(/\$\{[^}]*\}/g, "<>")
    .replace(/<[^<>]*>/g, "<>")
    .toLowerCase();
}

const NORMALIZED_ALLOWLIST = new Set(
  GLOBAL_ARTIFACT_ALLOWLIST.map(normalizePlaceholders),
);

/**
 * `leg` present in `path` as its own delimited segment — never as an incidental
 * substring of a longer word.
 */
function carriesLegSegment(path: string, leg: string): boolean {
  // Built by concatenation rather than as a template literal: the opening
  // delimiter class has to contain a literal `${`, and a template literal would
  // read that as an interpolation even under `String.raw`.
  const before = "(^|[/\\-._<$\\{])";
  const after = "([/\\-._\\}>]|$)";
  return new RegExp(before + leg + after).test(path);
}

/** Whether a literal carries the resolved leg, in any of its spellings. */
function isScoped(path: string): boolean {
  const lower = path.toLowerCase();
  for (const placeholder of LEG_PLACEHOLDERS) {
    if (lower.includes(placeholder.toLowerCase())) return true;
  }
  return LEG_NAMES.some((leg) => carriesLegSegment(lower, leg));
}

/** Characters that can never appear inside a path literal in this prose. */
const TOKEN_RE = /[^\s`'"()\[\],;|&]+/g;

/** Strip markdown/prose punctuation that clings to a literal in running text. */
function trimToken(raw: string): string {
  let token = raw;
  // Leading: markdown emphasis, list bullets, redirection.
  token = token.replace(/^[^A-Za-z0-9_./$~<]+/, "");
  // A shell ASSIGNMENT carries its path on the right of the `=`, and the whole
  // token is what `underArtifactRoot` tests — so `P9=/tmp/dpt-smoke-…` failed
  // `startsWith("/tmp/")` and fell out of the scan before the segment rule ever
  // ran. That silently exempted every `VAR=<path>` site in both harness SKILLs
  // from AC-STE-487.3's "every per-run artifact path", including the ones this
  // very FR added for Phase 9. Strip the assignment prefix so the value is
  // scanned as the path it is. Deliberately anchored and single-`=`: a token
  // whose path itself contains `=` (a query string, a `--flag=value`) keeps
  // everything after the FIRST `=`, which is the path in every shipped form.
  token = token.replace(/^[A-Za-z_][A-Za-z0-9_]*=/, "");
  // Trailing sentence punctuation.
  token = token.replace(/[.,;:!?]+$/, "");
  // Trailing `>` left over from an inline `<…>` wrapper, only while unbalanced.
  while (
    token.endsWith(">") &&
    (token.match(/>/g) ?? []).length > (token.match(/</g) ?? []).length
  ) {
    token = token.slice(0, -1);
  }
  return token;
}

/**
 * A brace-expansion shorthand (`…-{setup,spec-write}.log`) is a WRITING
 * convenience, not a path literal — the expanded members are what get written,
 * and each of them is spelled out elsewhere. `${VAR}` is not brace expansion,
 * hence the `$`-lookbehind.
 */
function isBraceExpansion(token: string): boolean {
  return /(^|[^$])\{/.test(token);
}

/** A glob/pathspec (`…-*.log`) reaps a family; it is not one run's artifact. */
function isGlob(token: string): boolean {
  return token.includes("*") || token.includes("?");
}

/**
 * Every per-run ARTIFACT FILE path literal in a harness SKILL body.
 *
 * A bare directory pathspec (trailing `/`, or no artifact extension at all) is
 * NOT a per-run artifact path and is not enumerated — the tracker segment lives
 * on the file, and a directory pathspec in the closing artifact accounting is
 * supposed to name a whole class.
 */
export function enumeratePerRunArtifactPaths(
  skillBody: string,
): readonly ArtifactPathRef[] {
  const refs: ArtifactPathRef[] = [];
  const lines = skillBody.split("\n");

  lines.forEach((line, index) => {
    for (const match of line.matchAll(TOKEN_RE)) {
      const token = trimToken(match[0]);
      if (token.length === 0) continue;
      if (!token.includes("/")) continue;
      if (token.endsWith("/")) continue; // bare directory pathspec
      if (isBraceExpansion(token) || isGlob(token)) continue;
      if (!underArtifactRoot(token)) continue;
      if (!ARTIFACT_EXTENSION_RE.test(basename(token))) continue;
      // Defensive: `line.includes(token)` is what the line-number contract
      // promises, and trimming can only ever shorten the matched slice.
      if (!line.includes(token)) continue;
      refs.push({ path: token, line: index + 1, scoped: isScoped(token) });
    }
  });

  return refs;
}

/**
 * The offenders: enumerated per-run artifact paths carrying no tracker/leg
 * segment, minus {@link GLOBAL_ARTIFACT_ALLOWLIST}.
 */
export function unscopedArtifactPaths(
  skillBody: string,
): readonly ArtifactPathRef[] {
  return enumeratePerRunArtifactPaths(skillBody).filter(
    (ref) =>
      !ref.scoped && !NORMALIZED_ALLOWLIST.has(normalizePlaceholders(ref.path)),
  );
}

// ─────────────────────────────── CLI ────────────────────────────────────────

/**
 * Scan `files`, returning the verdict line, the exit code that carries it, and
 * the offender detail lines.
 *
 * The offenders come back with the verdict rather than being recomputed by the
 * caller: one read and one scan per file, and one spelling of the
 * `<file>:<line>: <path>` detail form. A caller that re-derived them would be
 * free to drift out of agreement with the very count it prints.
 */
export function scanArtifactPaths(files: readonly string[]): {
  line: string;
  code: number;
  offenders: readonly string[];
} {
  let scanned = 0;
  const unscoped: string[] = [];

  for (const file of files) {
    const body = readFileSync(file, "utf8");
    scanned += enumeratePerRunArtifactPaths(body).length;
    for (const ref of unscopedArtifactPaths(body)) {
      unscoped.push(`${file}:${ref.line}: ${ref.path}`);
    }
  }

  const ok = unscoped.length === 0;
  return {
    line: ok
      ? `artifact-paths: ok scanned=${scanned} unscoped=0`
      : `artifact-paths: FAIL scanned=${scanned} unscoped=${unscoped.length}`,
    code: ok ? 0 : 1,
    offenders: unscoped,
  };
}

/**
 * STE-565 — the in-repo half: a per-run artifact path that lands INSIDE the
 * repository must be ignored by git, or a completed run dirties the tree and
 * the NEXT run's pre-flight #4 refuses to start on it.
 *
 * MEASURED on 2026-09-05: sub-fixture 8a persists to
 * `tests/fixtures/nested-spawn/8a-<tracker>-<date>.log`, untracked AND
 * un-ignored, so a run that finished cleanly sabotaged its successor. The
 * sibling class — Phase 8's transcript captures — was already ignored, so the
 * tree-clean promise existed and this path sat outside it.
 *
 * DERIVED from `enumeratePerRunArtifactPaths`, never from a list of the known
 * offenders: the next persist path added to a harness SKILL is covered without
 * anyone remembering this FR. An enumerated list is the shape that let this
 * one sit outside a promise its sibling was already inside.
 */
export interface RepoArtifactIgnoreRef {
  /** The enumerated path literal, repo-root-relative as written in the SKILL. */
  path: string;
  /** 1-based line in the SKILL body. */
  line: number;
  /** A concrete path the class would write, with placeholders resolved. */
  sample: string;
  /** Whether git ignores `sample`. */
  ignored: boolean;
}

/**
 * Resolve a path literal's placeholders to a concrete filename.
 *
 * The literals carry `<tracker>` / `${DATE}` style placeholders that never
 * appear on disk. `git check-ignore` decides on a real path, so the sample has
 * to be one — and it must keep the extension, because that is what most
 * ignore rules key on.
 */
export function sampleArtifactPath(path: string): string {
  return path.replace(/\$\{[^}]*\}/g, "sample").replace(/<[^<>]*>/g, "sample");
}

/**
 * The plugin root, repo-root-relative — derived from this module's own
 * location, never typed.
 *
 * The harness SKILLs write `tests/fixtures/...`, which is PLUGIN-root
 * relative; the files land at `plugins/dev-process-toolkit/tests/fixtures/...`
 * and that is the path git has to be asked about. Asking about the unprefixed
 * form reports every already-ignored class as un-ignored — measured, and it is
 * why this prefix is applied rather than assumed away.
 */
export const PLUGIN_ROOT_RELATIVE = join(
  import.meta.dir,
  "..",
  "..",
  "..",
).slice(REPO_ROOT.length + 1);

/** Where a SKILL-written literal actually lands, repo-root-relative. */
export function repoRelativeArtifactPath(path: string): string {
  const sample = sampleArtifactPath(path);
  if (sample.startsWith(`${PLUGIN_ROOT_RELATIVE}/`)) return sample;
  return join(PLUGIN_ROOT_RELATIVE, sample);
}

/** The in-repo subset of the enumerated per-run artifact paths. */
export function inRepoArtifactPaths(
  skillBody: string,
): readonly ArtifactPathRef[] {
  return enumeratePerRunArtifactPaths(skillBody).filter(
    (ref) => !ref.path.startsWith("/tmp/") && ref.path.includes("tests/fixtures/"),
  );
}

/**
 * Every in-repo per-run artifact path, with git's own verdict on whether it is
 * ignored.
 *
 * The verdict comes from `git check-ignore`, never from grepping `.gitignore`
 * for a string: negations, directory rules and precedence are git's semantics,
 * and a pattern present in the file that does not match the path is exactly
 * the failure a grep cannot see.
 */
export function scanUnignoredRepoArtifacts(
  repoRoot: string,
  skillRelativePaths: readonly string[] = HARNESS_SKILL_RELATIVE_PATHS,
): readonly RepoArtifactIgnoreRef[] {
  const out: RepoArtifactIgnoreRef[] = [];
  for (const rel of skillRelativePaths) {
    const abs = join(repoRoot, rel);
    let body: string;
    try {
      body = readFileSync(abs, "utf8");
    } catch {
      continue; // an absent harness SKILL is the consumer case, not a violation
    }
    for (const ref of inRepoArtifactPaths(body)) {
      const sample = repoRelativeArtifactPath(ref.path);
      out.push({ path: ref.path, line: ref.line, sample, ignored: gitIgnores(repoRoot, sample) });
    }
  }
  return out.filter((ref) => !ref.ignored);
}

/** Ask git — `check-ignore` exits 0 when the path is ignored, 1 when it is not. */
function gitIgnores(repoRoot: string, path: string): boolean {
  const proc = Bun.spawnSync(["git", "check-ignore", "-q", "--no-index", path], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  return proc.exitCode === 0;
}

if (import.meta.main) {
  const args = process.argv.slice(2);

  // STE-565 — a SUBCOMMAND, not an extra field on the scoping verdict.
  // `artifact-paths: ok scanned=<N> unscoped=0` is a pinned contract quoted in
  // shipped prose, and leg-scoping and tree-cleanliness are two subjects: one
  // line carrying both would make a caller read a verdict it did not ask for.
  if (args[0] === "ignore-scan") {
    const unignored = scanUnignoredRepoArtifacts(REPO_ROOT);
    for (const ref of unignored) {
      process.stderr.write(
        `un-ignored ${ref.path} (line ${ref.line}, would land at ${ref.sample})\n`,
      );
    }
    process.stdout.write(
      unignored.length === 0
        ? "artifact-ignore: ok un-ignored=0\n"
        : `artifact-ignore: FAIL un-ignored=${unignored.length}\n`,
    );
    process.exit(unignored.length === 0 ? 0 : 1);
  }

  const files =
    args.length > 0
      ? args
      : HARNESS_SKILL_RELATIVE_PATHS.map((rel) => join(REPO_ROOT, rel));
  const { line, code, offenders } = scanArtifactPaths(files);
  // The offender detail goes to stderr; stdout stays exactly one verdict line
  // so a caller that greps it reads one row on both branches — and therefore
  // has to read the exit code to learn the verdict.
  for (const detail of offenders) {
    process.stderr.write(`unscoped ${detail}\n`);
  }
  process.stdout.write(`${line}\n`);
  process.exit(code);
}
