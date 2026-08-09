// LocalProvider — tracker-less Provider implementation (FR-43, FR-46).
//
// Behavior:
//   - mintId(): delegates to ulid module (AC-43.5 — always local, offline-safe),
//       guarded by a synchronous active+archive tail-collision probe (STE-424)
//   - sync(): no-op returning skipped (AC-43.2)
//   - getUrl(): always null
//   - getMetadata(id): reads specs/frs/<id>.md or specs/frs/archive/<id>.md
//   - claimLock(id, branch): writes .dpt/locks/<id> and commits; returns
//       claimed | already-ours. The remote-scan (git fetch + cross-branch
//       contains) that returns taken-elsewhere lives in Phase F; this base
//       implementation handles the local case.
//   - releaseLock(id): deletes and commits; idempotent on missing file.

import { $ } from "bun";
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { locksDir as dptLocksDir } from "./dpt_paths";
import { parseFrontmatter } from "./frontmatter";
import type { FRMetadata, FRSpec, IdentityMinter, LockResult, Provider, SyncResult } from "./provider";
import { mintUniqueId } from "./ulid";

export interface LocalProviderOptions {
  repoRoot: string;
  specsDir?: string;
  locksDir?: string;
  now?: () => string;
  gitUserEmail?: string;
  /**
   * Skip `git fetch --all` before remote-branch lock scan. Mirrors the
   * DPT_SKIP_FETCH=1 env var (AC-46.7, NFR-16). When true, only local
   * refs are considered; a lock claimed on a remote that hasn't been
   * fetched yet will be missed.
   */
  skipFetch?: boolean;
}

/**
 * The two filenames a minted id can legitimately name, in lookup order:
 * active first, then archived. M18 STE-61: the FR filename in `mode: none` is
 * `<spec.id.slice(23, 29)>.md` (the short-ULID tail); the legacy `<fr_ULID>.md`
 * shape is retired.
 *
 * STE-424 AC-STE-424.3 — the read path (`getFrPath`) and the mint-time
 * collision probe (`mintId`) MUST agree on this pair. If minting probed a
 * narrower set than reading resolves, a tail already owned by a record the
 * reader can find would be minted again and the next write would land on an
 * occupied name.
 */
function frPathCandidates(specsDir: string, id: string): string[] {
  const shortTail = id.slice(23, 29);
  return [
    join(specsDir, "frs", `${shortTail}.md`),
    join(specsDir, "frs", "archive", `${shortTail}.md`),
  ];
}

/**
 * The commit-subject cap every lock commit is measured against — ONE definition
 * for the whole module (STE-460 spent an AC retiring the two-copy shape).
 *
 * It is not this module's invention: it is the cap the shipped `commit-msg`
 * hook enforces (`templates/git-hooks/commit-msg.sh`, `-gt 72`) and that the
 * shipped `commitlint.config.js` restates as `header-max-length`. `/setup`
 * installs that hook into every project it bootstraps, so this is the gate the
 * provider's own commits are actually judged by.
 */
const LOCK_COMMIT_SUBJECT_CAP = 72;

/**
 * The three facts a lock-subject diagnostic must state: the subject VERBATIM,
 * its length, and the cap.
 *
 * One formatter rather than two independently-worded restatements — the
 * pre-write refusal (AC-STE-461.3) and the commit-rejection diagnostic
 * (AC-STE-461.6) report the same three facts about the same string, and an
 * operator reading either should not have to learn two shapes to recognise the
 * same condition.
 *
 * The wording is deliberately NEUTRAL — it measures, it does not judge. The two
 * callers reach it from opposite verdicts: AC-STE-461.3 fires only when the
 * subject is OVER the cap, while AC-STE-461.6 fires on a rejection that has
 * nothing to do with length and whose subject is comfortably UNDER it (58 of
 * 72). A formatter that asserted "over the cap" would be reused into a
 * falsehood on the second path, so the verdict belongs to each caller and only
 * the measurement is shared.
 */
function describeLockSubject(subject: string): string {
  return `subject "${subject}" (${subject.length} characters; the commit-msg subject cap is ${LOCK_COMMIT_SUBJECT_CAP})`;
}

/**
 * The diagnostic thrown when git or a hook REFUSES a lock commit (AC-STE-461.6).
 *
 * Bun's `$` throws a `ShellError` whose `message` is only "Failed with exit
 * code 1" — a rethrow of it tells the operator that something failed and
 * nothing about what. The four facts this composes are the subject verbatim,
 * its length, the cap (all three via `describeLockSubject`, so this path states
 * them in the SAME shape as the pre-write refusal) and the child's own stderr,
 * which is where the hook's reason lives — `commit-msg: subject-too-long` for
 * the shipped cap, whatever a downstream project's own hook prints otherwise.
 *
 * The underlying text is CARRIED, not summarised: the reason a downstream tree
 * refused is not something this module can paraphrase without losing it. It is
 * read off the error object rather than by re-running the command, because a
 * second run can fail differently from the one that actually happened.
 *
 * AC-STE-461.7 — a FAILED cleanup is APPENDED, never SUBSTITUTED. The rejection
 * above is the diagnosis; a rollback that could not finish is a caveat about the
 * tree's state, and an error that reported only the caveat would leave the
 * operator debugging the tidy-up instead of the refusal that caused it. So the
 * original text is still present verbatim on this path, and the cleanup clause
 * is a separate trailing sentence that NAMES the path that may remain — a user
 * whose lock is in an unknown state needs to know what to inspect, and "cleanup
 * failed" without the path tells them nothing they can act on.
 */
function describeLockCommitRejection(
  subject: string,
  cause: unknown,
  cleanup: LockCleanupOutcome = { lockPath: null, failures: [] },
): string {
  const cleanupFailed = cleanup.failures.length > 0;
  return (
    `local_provider: the lock commit was refused by git — ${describeLockSubject(subject)}. ` +
    (cleanupFailed
      ? `Nothing was committed.\n`
      : `${lockMutationKind(cleanup) === "write" ? "The lock write" : "The lock removal"}` +
        ` was rolled back; nothing was committed.\n`) +
    `Underlying git/hook failure: ${commandFailureText(cause)}` +
    (cleanupFailed ? `\n${describeLockCleanupFailure(cleanup)}` : "")
  );
}

/**
 * WHICH mutation a rollback was undoing — and therefore what a FAILED rollback
 * leaves behind, which is not the same fact in the two directions.
 *
 * AC-STE-461.8. A failed write-rollback leaves a lock that exists and should
 * not; a failed removal-rollback leaves a lock DELETED with its deletion
 * staged, which reads as released while it is still held. Those are opposite
 * states needing opposite remedies, so the discriminant is carried rather than
 * the write wording being reused into a falsehood on the removal path — the
 * same reason `describeLockSubject` states no verdict.
 */
export type LockMutationKind = "write" | "removal";

/** A rollback attempt's outcome: the path it was undoing, and what would not undo. */
export interface LockCleanupOutcome {
  /** What was being undone. Defaults to `"write"` — `claimLock`'s direction. */
  kind?: LockMutationKind;
  /**
   * The lock file(s) the rollback was for — named in the clause so they can be
   * inspected. `cleanupStaleLocks` removes several in one commit and names all
   * of them, because a clause naming only one would send the operator to
   * inspect a fraction of the damage.
   */
  lockPath: string | null;
  /** One clause per step that failed. Empty ⇒ the rollback finished. */
  failures: readonly string[];
}

/**
 * Which direction an outcome describes, defaulting to `claimLock`'s.
 *
 * ONE statement of the default, read by both formatters below. Only the
 * DEFAULT is shared — each caller still branches on the result and keeps its
 * own wording, because the two directions need OPPOSITE text (`describeLock-
 * CleanupFailure` in particular hands out opposite remedies) and folding those
 * would reuse one direction's remedy into a falsehood on the other. The
 * discriminant is a measurement and shares cleanly; what it discriminates
 * between does not.
 */
function lockMutationKind(cleanup: LockCleanupOutcome): LockMutationKind {
  return cleanup.kind ?? "write";
}

/**
 * The trailing cleanup-failure clause, distinct from whatever it is appended to.
 *
 * Stated separately from the rejection text because the two facts have different
 * owners: the rejection is git's, the cleanup failure is this module's, and the
 * second must not be able to overwrite the first (AC-STE-461.7).
 */
export function describeLockCleanupFailure(cleanup: LockCleanupOutcome): string {
  const path = cleanup.lockPath ?? "the lock file";
  const residue =
    lockMutationKind(cleanup) === "write"
      ? `${path} may remain on disk and staged. Inspect and remove it by hand before the next claim.`
      : `${path} may remain DELETED with the deletion staged — which READS as released while the ` +
        `lock is still held. Restore it by hand (git checkout HEAD -- <path>) before the next claim.`;
  return (
    `WARNING — the rollback ITSELF failed, so cleanup is incomplete: ${residue} ` +
    `Cleanup failures: ${cleanup.failures.join("; ")}`
  );
}

/**
 * Refuse an over-long lock-commit subject BEFORE anything is written or staged.
 *
 * Ordering is the whole content of this guard. A provider that wrote, staged
 * and only then discovered the length would leave the split state this FR
 * exists to remove; a provider that refuses here leaves the tree untouched, so
 * there is no rollback to get right and no rollback to get wrong.
 */
function assertLockSubjectWithinCap(subject: string): void {
  if (subject.length <= LOCK_COMMIT_SUBJECT_CAP) return;
  throw new Error(
    `local_provider: refusing to commit — ${describeLockSubject(subject)} exceeds it. ` +
      "Nothing was written, staged or committed.",
  );
}

function getFrPath(specsDir: string, id: string): string {
  for (const candidate of frPathCandidates(specsDir, id)) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`local_provider: FR ${id} not found under ${specsDir}/frs/ or /archive/`);
}

export class LocalProvider implements Provider, IdentityMinter {
  readonly mode = "none" as const;
  private readonly repoRoot: string;
  private readonly specsDir: string;
  private readonly locksDir: string;
  private readonly now: () => string;
  private readonly gitUserEmail: string;
  private readonly skipFetch: boolean;

  constructor(options: LocalProviderOptions) {
    this.repoRoot = options.repoRoot;
    this.specsDir = options.specsDir ?? join(options.repoRoot, "specs");
    // AC-STE-382.3 — the default derives from `dpt_paths` (`.dpt/locks`), the
    // sole composer of `.dpt` path literals. The injected override still wins:
    // every lock path below is built from `this.locksDir`, never a literal.
    this.locksDir = options.locksDir ?? dptLocksDir(options.repoRoot);
    this.now = options.now ?? (() => new Date().toISOString());
    this.gitUserEmail = options.gitUserEmail ?? "";
    this.skipFetch = options.skipFetch ?? process.env["DPT_SKIP_FETCH"] === "1";
  }

  /**
   * Mint a feature-record id whose derived 6-char tail does not already name a
   * record under `<specsDir>/frs/` or `<specsDir>/frs/archive/`.
   *
   * STE-424 AC-STE-424.3 — this used to return the raw mint with no predicate
   * at all. Only 6 of the minted id's 26 characters survive into the filename
   * (a 2^30 keyspace), so distinct ULIDs CAN land on the same tail; without a
   * probe the collision was silently accepted and the next write clobbered an
   * existing record. Archived records still OWN their tail, so the archive is
   * probed alongside the active tree — same pair `getFrPath` resolves against.
   *
   * Synchronous by design: `mintUniqueId`'s `exists` predicate must be
   * synchronous (an async predicate returns a truthy Promise, so every attempt
   * reads as a collision and the retry is defeated), hence `existsSync`. An
   * absent `frs/` or `frs/archive/` tree is not a collision — nothing is taken
   * yet. Three consecutive collisions throw rather than return a clobbering id.
   *
   * Minting is PURE: it names a record file, it never creates one.
   */
  mintId(): string {
    return mintUniqueId({
      exists: (candidate) => frPathCandidates(this.specsDir, candidate).some((p) => existsSync(p)),
    });
  }

  async getMetadata(id: string): Promise<FRMetadata> {
    const path = getFrPath(this.specsDir, id);
    const text = readFileSync(path, "utf-8");
    const fm = parseFrontmatter(text);
    const tracker = (typeof fm["tracker"] === "object" && fm["tracker"] !== null ? fm["tracker"] : {}) as Record<string, string | null>;
    return {
      id: String(fm["id"] ?? id),
      title: String(fm["title"] ?? ""),
      milestone: String(fm["milestone"] ?? ""),
      status: (String(fm["status"] ?? "active") as FRMetadata["status"]),
      tracker,
      inFlightBranch: null,
      assignee: null,
    };
  }

  async sync(_spec: FRSpec): Promise<SyncResult> {
    return { kind: "skipped", updated: [], conflicts: [], message: "No tracker configured" };
  }

  async listMilestones(): Promise<{ name: string }[]> {
    // STE-284 AC-STE-284.7 — mode-none has no tracker; vacuously empty.
    return [];
  }

  async listActiveFRs(): Promise<string[]> {
    // STE-284 AC-STE-284.7 — mode-none has no tracker FR IDs; vacuously empty.
    return [];
  }

  getUrl(_id: string, _trackerKey?: string): string | null {
    return null;
  }

  async claimLock(id: string, branch: string): Promise<LockResult> {
    const lockPath = join(this.locksDir, id);

    // Remote-scan pre-check (AC-46.2, FR-46).
    // Skipped when DPT_SKIP_FETCH=1 (AC-46.7, NFR-16 escape hatch).
    if (!this.skipFetch) {
      try {
        await $`git fetch --all --quiet`.cwd(this.repoRoot).quiet();
      } catch {
        // If fetch fails (offline, no remotes), fall through to local-only check
        // per the best-effort-by-design contract (AC-46.6).
      }
    }
    const remoteBranch = await this.findRemoteBranchWithLock(id);
    if (remoteBranch !== null && remoteBranch !== branch && !remoteBranch.endsWith(`/${branch}`)) {
      return {
        kind: "taken-elsewhere",
        branch: remoteBranch,
        message: `Lock present on remote branch ${remoteBranch}`,
      };
    }

    if (existsSync(lockPath)) {
      const existing = readFileSync(lockPath, "utf-8");
      if (existing.includes(`branch: ${branch}`)) {
        return { kind: "already-ours", branch, message: `Lock already held on ${branch}` };
      }
      return {
        kind: "taken-elsewhere",
        branch: extractBranch(existing),
        message: `Lock held on ${extractBranch(existing) ?? "<unknown>"}`,
      };
    }
    // AC-STE-461.1 — the subject must NOT scale with the branch name. The
    // `commit-msg` hook this toolkit installs into every project it bootstraps
    // caps the subject at 72 characters, and the retired form
    // (`… claim lock for <id> on <branch>`) cost 29 + 29 + 4 + len(branch), so a
    // branch over ten characters made the claim uncommittable — while the
    // toolkit's own `{type}/m{N}-{slug}` convention routinely produces 35.
    // The subject is now CONSTANT at 58; the branch moves to a body line, which
    // the hook does not validate (it reads only the first non-blank
    // non-comment line), so the branch may be arbitrarily long.
    const subject = `chore(locks): claim lock for ${id}`;
    // AC-STE-461.3 — asserted BEFORE anything is written or staged. Removing
    // the branch leaves ONE residual dimension, `len(id)`, bounded at 29 by the
    // minting contract and at 7 by a tracker id — i.e. bounded by assumption,
    // which is exactly the shape of the defect being repaired. This turns that
    // inherited assumption into an enforced, named bound; on this path nothing
    // is written, staged or committed, so there is nothing to roll back.
    assertLockSubjectWithinCap(subject);
    mkdirSync(this.locksDir, { recursive: true });
    const claimer = this.gitUserEmail || (await this.readGitUserEmail());
    const content = `ulid: ${id}\nbranch: ${branch}\nclaimed_at: ${this.now()}\nclaimer: ${claimer}\n`;
    writeFileSync(lockPath, content);
    // AC-STE-461.4 — the write, the stage and the commit are ONE unit. Any
    // rejection of the commit (a downstream `pre-commit` hook, a stricter
    // `commit-msg` cap, a signing failure, a full disk) used to leave the lock
    // on disk and staged with no witness commit — the split state in which
    // `/implement` reads the id as claimed forever and refuses at Phase 1.
    //
    // The rollback puts the tree back and RETHROWS. It must not do the second
    // half without the first: a claim that rolls back and returns normally
    // makes a project where every claim silently fails indistinguishable from
    // one where claims succeed, which is the same defect with a tidier tree.
    // The throw is the signal; the rollback only stops the wreckage.
    try {
      await $`git add -- ${lockPath}`.cwd(this.repoRoot).quiet();
      await $`git commit -q -m ${subject} -m ${`branch: ${branch}`}`.cwd(this.repoRoot).quiet();
    } catch (err) {
      // AC-STE-461.7 — the rollback REPORTS rather than throws, and what it
      // reports is appended to the rejection instead of replacing it. A cleanup
      // that threw here would surface the incidental reason the tidy-up could
      // not finish in place of the refusal the operator has to read.
      const failures = await this.rollbackLockWrite(lockPath);
      // AC-STE-461.6 — a bare `throw err` rethrows Bun's ShellError, whose
      // entire message is "Failed with exit code 1". That is a loud failure
      // carrying no diagnosis: the operator learns the claim failed and not
      // that a hook refused it, nor which hook, nor why. The original is kept
      // as `cause` so nothing is lost by the rewrap.
      throw new Error(describeLockCommitRejection(subject, err, { lockPath, failures }), {
        cause: err,
      });
    }
    return { kind: "claimed", branch, message: `Lock claimed on ${branch}` };
  }

  /**
   * Undo a lock write that never became a commit: unstage it, then remove it.
   *
   * `git rm --cached` rather than `git reset` or `git restore --staged`,
   * because both of those resolve HEAD and a repository whose first commit has
   * not landed yet has none — `git restore --staged` reports
   * `fatal: could not resolve 'HEAD'` there. `git rm --cached` touches only the
   * index, so it works whether or not HEAD exists. `--force` is required
   * because a freshly-added path differs from HEAD by construction.
   *
   * Each step is attempted independently and its failure COLLECTED rather than
   * thrown: a cleanup that throws replaces the rejection the operator needs to
   * read with the incidental reason the tidy-up could not finish. The returned
   * clauses are what a caller reports ALONGSIDE the original.
   */
  private async rollbackLockWrite(lockPath: string): Promise<string[]> {
    const failures: string[] = [];
    // ONLY REPORT AN UNSTAGE FAILURE FOR A PATH THAT WAS ACTUALLY STAGED.
    //
    // Measured: with a stale `.git/index.lock`, `git add` fails, this rollback
    // still runs, `git rm --cached` fails on a path the index never held, and
    // the operator is told the cleanup was incomplete and to remove a file by
    // hand — while the lock is in fact gone and the tree is clean. A SUCCESSFUL
    // fail-safe reported as a failed one, with a remedy pointing at nothing.
    //
    // That is the same wrong-remedy shape the removal branch of
    // `describeLockCleanupFailure` exists to prevent, one direction over: a
    // diagnostic that is confidently incorrect is worse than none, because the
    // operator acts on it. A stale index.lock is not exotic — any concurrent
    // git process produces one.
    const staged = await this.isPathStaged(lockPath);
    if (staged) {
      try {
        await $`git rm --cached --force --quiet -- ${lockPath}`.cwd(this.repoRoot).quiet();
      } catch (err) {
        failures.push(`could not unstage ${lockPath}: ${errText(err)}`);
      }
    }
    try {
      if (existsSync(lockPath)) unlinkSync(lockPath);
    } catch (err) {
      failures.push(`could not remove ${lockPath}: ${errText(err)}`);
    }
    return failures;
  }

  /**
   * Whether the index holds an entry for `lockPath`.
   *
   * Deliberately fails CLOSED: if the probe itself cannot run, report `true` so
   * the unstage is attempted and any real failure is still surfaced. Reporting
   * `false` on a broken probe would silence a genuine incomplete cleanup, which
   * is the trade this repository refuses — a loud false alarm is recoverable, a
   * silent residue is not.
   */
  private async isPathStaged(lockPath: string): Promise<boolean> {
    try {
      const out = await $`git diff --cached --name-only -- ${lockPath}`
        .cwd(this.repoRoot)
        .quiet()
        .text();
      return out.trim().length > 0;
    } catch {
      return true;
    }
  }

  /**
   * Undo a lock REMOVAL that never became a commit: put every removed lock back,
   * in the index and on disk (AC-STE-461.8).
   *
   * (See `isPathStaged` below, used by the write-side rollback so an unstage is
   * only attempted — and only reported as failed — for a path the index held.)
   *
   * The mirror of `rollbackLockWrite` rather than a second copy of it, because
   * the two undo opposite mutations: that one unstages an addition and unlinks;
   * this one restores a deletion. `git checkout HEAD -- <path>` does both halves
   * in one step — a `git reset` would clear the staged deletion while leaving
   * the file missing from the worktree, i.e. it would fix the half nobody looks
   * at and leave the half that reads as "released".
   *
   * EVERY path, not just the last: `cleanupStaleLocks` removes several locks in
   * one commit, so a rollback that restored one would leave the rest deleted and
   * staged — the released-looking-but-held state, multiplied. Paths are restored
   * independently and per-path failures COLLECTED, for the same reason
   * `rollbackLockWrite` collects: a cleanup that throws replaces the rejection
   * the operator has to read. Restoring a path the `git rm` never reached is a
   * harmless no-op — it already matches HEAD.
   */
  private async rollbackLockRemoval(lockPaths: readonly string[]): Promise<string[]> {
    const failures: string[] = [];
    for (const lockPath of lockPaths) {
      try {
        await $`git checkout HEAD -- ${lockPath}`.cwd(this.repoRoot).quiet();
      } catch (err) {
        failures.push(`could not restore ${lockPath}: ${errText(err)}`);
      }
    }
    return failures;
  }

  /**
   * Returns the first remote branch (e.g., "origin/feat/other") that
   * contains the lock for <ulid>, or null if none do.
   * Implementation: `git ls-tree -r <branch> -- <locksDir>/<ulid>` per remote
   * branch. `git branch -r --contains <path>` is not a valid git command
   * (contains takes a commit, not a path), so we walk tips instead.
   *
   * AC-STE-382.2 — the pathspec is derived from `this.locksDir`, never a
   * literal: the write path (`claimLock`) and release path both honor an
   * injected `locksDir`, so a hard-coded scan path would look where nothing
   * was ever written and silently report the id unclaimed (double-claim).
   * `ls-tree` resolves pathspecs against the tree root, so the absolute
   * `this.locksDir` is made repo-root-relative here.
   *
   * INVARIANT: `locksDir` must resolve UNDER `repoRoot`. The default does by
   * construction (`dptLocksDir(repoRoot)`), and the `locksDir` option exists as
   * a test seam, so nothing enforces this at runtime. If it is ever violated,
   * `relative()` yields a `..`-prefixed pathspec that git rejects as outside the
   * repository, `safeGit` swallows the failure into `""`, and every branch reads
   * as unclaimed — reintroducing the exact silent double-claim this method was
   * fixed to prevent. A lock store outside the repo cannot be committed or
   * `ls-tree`d at all, so the constraint is inherent to tracked-lock semantics
   * rather than incidental to this line.
   */
  private async findRemoteBranchWithLock(id: string): Promise<string | null> {
    const refs = await this.safeGit("for-each-ref", "--format=%(refname:short)", "refs/remotes/");
    if (refs.length === 0) return null;
    const pathspec = join(relative(this.repoRoot, this.locksDir), id);
    for (const branch of refs.split("\n").map((s) => s.trim()).filter(Boolean)) {
      if (branch.endsWith("/HEAD")) continue;
      const out = await this.safeGit("ls-tree", "-r", "--name-only", branch, "--", pathspec);
      if (out.length > 0) return branch;
    }
    return null;
  }

  async releaseLock(id: string): Promise<"transitioned" | "already-released"> {
    const lockPath = join(this.locksDir, id);
    // STE-84 AC-STE-84.3: missing lock → silently idempotent.
    if (!existsSync(lockPath)) return "already-released";
    const subject = `chore(locks): release lock for ${id}`;
    // AC-STE-461.8 — the same two guards `claimLock` carries, because the same
    // `commit-msg` hook judges this commit. The cap is asserted BEFORE `git rm`
    // touches the index: the release subject is 31 + len(id), so it scales with
    // exactly the residual dimension the claim subject does, and a refusal
    // discovered after the removal is the split state below.
    assertLockSubjectWithinCap(subject);
    // …and the removal, the stage and the commit are ONE unit. A rejected
    // release is WORSE than a rejected claim: it leaves `D .dpt/locks/<id>`
    // staged and the file gone, which the absence half of the proof-of-release
    // predicate reads as a successful release while the lock is still held. The
    // rollback puts the lock back and RETHROWS — it stops the wreckage, it does
    // not convert the loud failure into a silent one.
    try {
      await $`git rm -q -- ${lockPath}`.cwd(this.repoRoot).quiet();
      await $`git commit -q -m ${subject}`.cwd(this.repoRoot).quiet();
    } catch (err) {
      const failures = await this.rollbackLockRemoval([lockPath]);
      throw new Error(
        describeLockCommitRejection(subject, err, { kind: "removal", lockPath, failures }),
        { cause: err },
      );
    }
    return "transitioned";
  }

  async getTicketStatus(_ticketId: string): Promise<{ status: string }> {
    return { status: "local-no-tracker" };
  }

  filenameFor(spec: FRSpec): string {
    const id = spec.frontmatter["id"];
    if (typeof id !== "string") {
      throw new TypeError(`LocalProvider.filenameFor: spec.frontmatter.id must be a string, got ${typeof id}`);
    }
    return `${id.slice(23, 29)}.md`;
  }

  private async readGitUserEmail(): Promise<string> {
    try {
      const out = await $`git config user.email`.cwd(this.repoRoot).quiet().text();
      return out.trim();
    } catch {
      return "";
    }
  }

  /**
   * Find .dpt/locks/<ulid> files on local branches whose branch is merged
   * into main OR deleted. Returns one entry per stale lock; caller applies
   * the cleanup action. (AC-46.5)
   */
  async findStaleLocks(options: { mainBranch?: string } = {}): Promise<Array<{ id: string; branch: string; reason: "merged" | "deleted" }>> {
    const mainBranch = options.mainBranch ?? "main";
    if (!existsSync(this.locksDir)) return [];
    const stale: Array<{ id: string; branch: string; reason: "merged" | "deleted" }> = [];
    const entries = readdirSync(this.locksDir).filter((f: string) => !f.startsWith("."));
    const mergedBranchesOutput = await this.safeGit("branch", "--merged", mainBranch);
    const mergedBranches = mergedBranchesOutput
      .split("\n")
      .map((s) => s.replace(/^\*?\s+/, "").trim())
      .filter(Boolean);
    const allBranchesOutput = await this.safeGit("branch", "--list");
    const allBranches = allBranchesOutput
      .split("\n")
      .map((s) => s.replace(/^\*?\s+/, "").trim())
      .filter(Boolean);
    for (const id of entries) {
      const content = readFileSync(join(this.locksDir, id), "utf-8");
      const branch = extractBranch(content);
      if (branch === null) continue;
      if (!allBranches.includes(branch)) {
        stale.push({ id, branch, reason: "deleted" });
        continue;
      }
      if (branch !== mainBranch && mergedBranches.includes(branch)) {
        stale.push({ id, branch, reason: "merged" });
      }
    }
    return stale;
  }

  /**
   * Delete all stale locks in a single git commit. Reports the count.
   */
  async cleanupStaleLocks(options: { mainBranch?: string } = {}): Promise<{ count: number; ids: string[] }> {
    const stale = await this.findStaleLocks(options);
    if (stale.length === 0) return { count: 0, ids: [] };
    const lockPaths = stale.map(({ id }) => join(this.locksDir, id));
    // The subject is UNCHANGED — `adapters/_shared/src/local_provider.test.ts`
    // pins it with `toMatch(/clean up 2 stale locks/)`, and that pin is the
    // third lock subject: it contains neither `chore(locks)` nor `claim lock`,
    // so a same-line two-term grep for the other two cannot see it. Lifted into
    // a named binding only so the guard and the commit measure ONE string.
    const subject = `chore(locks): clean up ${stale.length} stale lock${stale.length === 1 ? "" : "s"}`;
    // AC-STE-461.8. STATED LIMIT: this subject is 36 characters plus the digits
    // of N, so it cannot breach 72 for any reachable N and the assertion here is
    // satisfied by construction. It is present because the guard belongs to
    // every lock-commit path rather than to the two that happen to scale today —
    // a future subject carrying an id or a branch would otherwise ship unguarded.
    assertLockSubjectWithinCap(subject);
    // The rollback arm is the load-bearing half here, and it must restore EVERY
    // lock the loop removed, not just the last: a rejected cleanup otherwise
    // leaves N-1 locks deleted with their deletions staged, each reading as
    // released while still held.
    try {
      for (const lockPath of lockPaths) {
        await $`git rm -q -- ${lockPath}`.cwd(this.repoRoot).quiet();
      }
      await $`git commit -q -m ${subject}`.cwd(this.repoRoot).quiet();
    } catch (err) {
      const failures = await this.rollbackLockRemoval(lockPaths);
      throw new Error(
        describeLockCommitRejection(subject, err, {
          kind: "removal",
          lockPath: lockPaths.join(", "),
          failures,
        }),
        { cause: err },
      );
    }
    return { count: stale.length, ids: stale.map((s) => s.id) };
  }

  private async safeGit(...args: string[]): Promise<string> {
    try {
      const proc = Bun.spawnSync({ cmd: ["git", ...args], cwd: this.repoRoot });
      if (proc.exitCode !== 0) return "";
      return new TextDecoder().decode(proc.stdout).trim();
    } catch {
      return "";
    }
  }
}

/** A thrown value's readable text, without assuming it is an `Error`. */
function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Everything a failed `$` command has to say: its summary AND its captured
 * output.
 *
 * `.quiet()` sends the child's streams to the `ShellError` instead of the
 * terminal, so `err.stderr` is a Buffer holding exactly what the hook printed
 * — the only place the reason exists. Both streams are read because a hook is
 * free to explain itself on stdout, and a diagnostic that looked at only one of
 * them would report an empty reason for such a hook while looking correct
 * against the fixtures here.
 */
function commandFailureText(err: unknown): string {
  const streams = err as { stderr?: unknown; stdout?: unknown } | null | undefined;
  const captured = [decodeStream(streams?.stderr), decodeStream(streams?.stdout)]
    .filter((text) => text.length > 0)
    .join("\n");
  const summary = errText(err);
  return captured.length > 0 ? `${summary}\n${captured}` : summary;
}

function decodeStream(value: unknown): string {
  if (typeof value === "string") return value.trim();
  // `Buffer` is a `Uint8Array` subclass, so this covers both.
  if (value instanceof Uint8Array) return new TextDecoder().decode(value).trim();
  return "";
}

function extractBranch(lockContent: string): string | null {
  const m = /^branch:\s*(.+)$/m.exec(lockContent);
  return m ? m[1]!.trim() : null;
}
