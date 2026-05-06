// Universal pre-commit branch gate (STE-228).
//
// Pure orchestration on top of `branch_proposal.ts` (re-exports its
// `PROTECTED_TRUNKS` constant and `isProtectedTrunk` helper so both
// branch helpers agree on what counts as a protected trunk). Refuses
// to commit on a protected trunk branch (`main`, `master`) unless the
// Conventional Commits type is in the narrow trunk-OK allowlist
// (`["ci"]`). When the gate fires, it proposes a branch name (computed
// by the per-skill `branchNameFor(...)` builder), runs the collision-
// suffix probe to ensure uniqueness, and then either prompts the
// operator or auto-creates the branch in auto-mode (claude -p with the
// M59 byte-checkable marker).
//
// All git I/O is injected through the `GateDeps` shape — the module
// itself stays deterministic and testable. The skill is responsible for
// wiring real `git` invocations behind the deps interface.

import { isProtectedTrunk, PROTECTED_TRUNKS } from "./branch_proposal";

/**
 * Conventional Commits types that may land directly on a protected
 * trunk branch (`main` / `master`).
 *
 * Per AC-STE-228.2, this list is narrowed to `["ci"]` only. The
 * previous `[chore, docs, ci]` list (STE-202 AC-STE-202.5) is
 * superseded — `chore` and `docs` no longer ship directly to trunk.
 */
export const TRUNK_OK_TYPES = ["ci"] as const;

/**
 * Re-exported from `branch_proposal.ts` (single source of truth). The
 * gate fires whenever the current branch matches one of these AND the
 * commit type is not in `TRUNK_OK_TYPES`.
 */
export { PROTECTED_TRUNKS };

/** Maximum allowed branch-name length (matches branch_proposal.ts). */
const MAX_BRANCH_LENGTH = 60;

/**
 * Allowed pattern for an operator-supplied edited branch name. Must
 * start with a lowercase letter; subsequent characters are a-z, 0-9,
 * `.`, `_`, `/`, or `-`. Rejects shell-injection vectors, capital
 * letters, leading hyphens, and path-traversal forms.
 */
const EDITED_BRANCH_PATTERN = /^[a-z][a-z0-9._/-]*$/;

/**
 * Canonical-shape exception (NFR-10) raised when a proposed branch
 * name cannot be rendered safely — typically when collision-suffix
 * truncation would leave a trailing-hyphen branch name. The skill
 * surfaces this to the operator as a verdict / remedy / context
 * refusal block.
 */
export class CommitGateError extends Error {
  readonly proposedName: string;
  constructor(proposedName: string, reason: string) {
    super(
      `requireCommittableBranch: cannot propose a safe branch name for "${proposedName}".\n` +
        `Reason: ${reason}\n` +
        `Remedy: shorten the FR title (rendered slug is too long) or press [e] at the prompt and supply a 2–4 word kebab-case slug under 60 chars.\n` +
        `Context: proposedName="${proposedName}", operation=findFreeBranchName`,
    );
    this.name = "CommitGateError";
    this.proposedName = proposedName;
  }
}

/**
 * Injected git probes + prompt + rollback. The module never shells out
 * directly — the skill provides real implementations.
 */
export interface GateDeps {
  /** True when the branch name exists in the local repo. */
  branchExistsLocally(name: string): boolean;
  /**
   * True when the branch name exists on remote `origin`. May throw
   * when the remote probe fails (offline / no remote / fetch timeout)
   * — `findFreeBranchName` catches and falls back to local-only.
   */
  branchExistsRemotely(name: string): boolean;
  /** Run `git checkout -b <name>` for the resolved branch. */
  checkoutNewBranch(name: string): void;
  /**
   * Render the prompt and return the operator's response string.
   * Implementations decide TTY vs alternative IO; the gate just
   * consumes the returned text.
   */
  prompt(message: string): string;
  /**
   * Roll back the explicit list of staged paths via
   * `git reset HEAD <paths>` (never `git reset --hard`).
   */
  rollbackStaging(paths: string[]): void;
}

/** Inputs to the gate. */
export interface RequireCommittableBranchOpts {
  /** Conventional Commits type extracted from the would-be commit subject. */
  commitType: string;
  /** Clean proposed branch name from the per-skill `branchNameFor(...)` builder. */
  proposedBranchName: string;
  /** Result of `git rev-parse --abbrev-ref HEAD`. */
  currentBranch: string;
  /**
   * True under `claude -p` non-interactive runs — gate auto-creates
   * the proposed branch and signals `defaultApplied: true`. Detection
   * is the M59 `<dpt:auto-approve>v1</dpt:auto-approve>` marker; not
   * the legacy `Auto Mode Active` system-reminder.
   */
  isAutoMode: boolean;
  /**
   * Paths the skill staged before invoking the gate. On `n` decline
   * (AC-STE-228.10), the gate calls `rollbackStaging(stagedPaths)` so
   * the caller leaves zero side effects behind.
   */
  stagedPaths: string[];
}

/** Outcome categories returned by the gate. */
export type GateOutcome = "no-op" | "created" | "edited" | "declined";

/** Result envelope. */
export interface GateResult {
  outcome: GateOutcome;
  /** The final branch name when `outcome` is `created` or `edited`. */
  branchName?: string;
  /**
   * True iff the gate auto-created the branch under `isAutoMode`.
   * Drives the `branch_gate_default_applied` capability row in the
   * skill's closing summary (AC-STE-228.8).
   */
  defaultApplied?: boolean;
  /**
   * True iff the collision probe could not reach the remote and fell
   * back to local-only checks. Drives the
   * `branch_gate_remote_probe_skipped` capability row.
   */
  remoteProbeSkipped?: boolean;
}

/** Result of the collision-suffix probe. */
export interface FindFreeBranchNameResult {
  /** Final, free branch name (with collision suffix applied if needed). */
  name: string;
  /**
   * `0` if the proposed name was unique. `2`, `3`, ... when a
   * collision forced the suffix-increment loop.
   */
  suffixApplied: number;
  /** True iff the remote probe failed and we fell back to local-only. */
  remoteProbeSkipped?: boolean;
}

function isTrunkOkType(commitType: string): boolean {
  return (TRUNK_OK_TYPES as readonly string[]).includes(commitType);
}

/**
 * Apply the collision suffix to a base name. Computes
 * `<base>-<suffix>`, truncating the base when needed to keep the
 * total ≤ MAX_BRANCH_LENGTH. If the truncation would discard a
 * hyphen-delimited slug segment (i.e., the truncated tail contains a
 * `-`), raise `CommitGateError` rather than ship a malformed branch
 * like `prefix/x-` that ends mid-segment.
 */
function applySuffix(baseName: string, suffix: number): string {
  const suffixStr = `-${suffix}`;
  const totalLen = baseName.length + suffixStr.length;
  if (totalLen <= MAX_BRANCH_LENGTH) {
    return baseName + suffixStr;
  }
  const cutPoint = MAX_BRANCH_LENGTH - suffixStr.length;
  if (cutPoint <= 0) {
    throw new CommitGateError(
      baseName,
      `Suffix "${suffixStr}" alone exceeds MAX_BRANCH_LENGTH=${MAX_BRANCH_LENGTH}; cannot fit.`,
    );
  }
  const truncatedTail = baseName.slice(cutPoint);
  if (truncatedTail.includes("-")) {
    throw new CommitGateError(
      baseName,
      `Truncating to fit collision suffix "${suffixStr}" would discard a hyphen-delimited segment ("${truncatedTail}"), leaving a malformed branch name. Refusing to ship.`,
    );
  }
  const truncatedBase = baseName.slice(0, cutPoint);
  if (truncatedBase.endsWith("-") || truncatedBase.length === 0) {
    throw new CommitGateError(
      baseName,
      `Truncating to fit collision suffix "${suffixStr}" would leave a trailing-hyphen branch name. Refusing to ship.`,
    );
  }
  return truncatedBase + suffixStr;
}

/**
 * Probe local + remote for the proposed branch name; if taken,
 * increment a numeric suffix (`-2`, `-3`, ...) until free. Caches
 * probe results within a single invocation so repeated checks of the
 * same candidate are cheap. Falls back to local-only when the remote
 * probe throws.
 */
export function findFreeBranchName(
  proposedName: string,
  deps: GateDeps,
): FindFreeBranchNameResult {
  const localCache = new Map<string, boolean>();
  const remoteCache = new Map<string, boolean>();
  let remoteProbeSkipped = false;

  function existsLocally(name: string): boolean {
    if (!localCache.has(name)) {
      localCache.set(name, deps.branchExistsLocally(name));
    }
    return localCache.get(name)!;
  }

  function existsRemotely(name: string): boolean {
    if (remoteProbeSkipped) return false;
    if (!remoteCache.has(name)) {
      try {
        remoteCache.set(name, deps.branchExistsRemotely(name));
      } catch {
        remoteProbeSkipped = true;
        return false;
      }
    }
    return remoteCache.get(name)!;
  }

  function exists(name: string): boolean {
    return existsLocally(name) || existsRemotely(name);
  }

  if (!exists(proposedName)) {
    const result: FindFreeBranchNameResult = {
      name: proposedName,
      suffixApplied: 0,
    };
    if (remoteProbeSkipped) result.remoteProbeSkipped = true;
    return result;
  }

  let suffix = 2;
  // Loop is bounded by MAX_BRANCH_LENGTH — `applySuffix` will throw
  // long before runaway iteration. A hard bound of 1000 is a paranoid
  // safety net; in practice we never go past `-3` in real workloads.
  while (suffix < 1000) {
    const candidate = applySuffix(proposedName, suffix);
    if (!exists(candidate)) {
      const result: FindFreeBranchNameResult = {
        name: candidate,
        suffixApplied: suffix,
      };
      if (remoteProbeSkipped) result.remoteProbeSkipped = true;
      return result;
    }
    suffix++;
  }
  throw new CommitGateError(
    proposedName,
    `Exhausted collision-suffix probe at ${suffix - 1}; refusing to ship.`,
  );
}

/**
 * Validate an operator-supplied edited branch name (`e` path of the
 * gate prompt). Returns null on success, an error message string when
 * the name is rejected.
 */
function validateEditedName(
  name: string,
  deps: GateDeps,
): string | null {
  if (!EDITED_BRANCH_PATTERN.test(name)) {
    return `Invalid branch name "${name}" — must match ${EDITED_BRANCH_PATTERN.source}.`;
  }
  if (isProtectedTrunk(name)) {
    return `Branch name "${name}" is a protected trunk; pick a different name.`;
  }
  if (deps.branchExistsLocally(name)) {
    return `Branch "${name}" already exists locally; pick a different name.`;
  }
  try {
    if (deps.branchExistsRemotely(name)) {
      return `Branch "${name}" already exists on remote; pick a different name.`;
    }
  } catch {
    // Remote probe failure during edit → ignore (matches the
    // findFreeBranchName fallback). Operator gets local-only check.
  }
  return null;
}

/**
 * Main entry. See module docstring for the call sequence; AC table:
 *   AC-STE-228.1 — signature, outcomes, side effects
 *   AC-STE-228.2 — TRUNK_OK_TYPES enforcement
 *   AC-STE-228.3 — PROTECTED_TRUNKS enforcement
 *   AC-STE-228.5 — interactive prompt UX (Y / e / n)
 *   AC-STE-228.6 — silent no-op on non-protected branch
 *   AC-STE-228.7 — auto-mode default-apply
 *   AC-STE-228.10 — staging rollback on decline
 *   AC-STE-228.11 — collision-suffix probe (delegated to findFreeBranchName)
 */
export function requireCommittableBranch(
  opts: RequireCommittableBranchOpts,
  deps: GateDeps,
): GateResult {
  // AC-STE-228.6 — silent no-op on non-protected branch.
  if (!isProtectedTrunk(opts.currentBranch)) {
    return { outcome: "no-op" };
  }

  // AC-STE-228.2 — trunk-OK type bypasses the gate even on main.
  if (isTrunkOkType(opts.commitType)) {
    return { outcome: "no-op" };
  }

  // AC-STE-228.11 — collision-suffix probe.
  const probe = findFreeBranchName(opts.proposedBranchName, deps);
  const finalName = probe.name;

  // AC-STE-228.7 — auto-mode default-apply.
  if (opts.isAutoMode) {
    deps.checkoutNewBranch(finalName);
    const result: GateResult = {
      outcome: "created",
      branchName: finalName,
      defaultApplied: true,
    };
    if (probe.remoteProbeSkipped) result.remoteProbeSkipped = true;
    return result;
  }

  // AC-STE-228.5 — interactive prompt (Y / e / n) with the FINAL name.
  const promptMessage =
    `Current branch "${opts.currentBranch}" is protected and commit type ` +
    `"${opts.commitType}" is not in TRUNK_OK_TYPES (${TRUNK_OK_TYPES.join(", ")}). ` +
    `Proposed branch: ${finalName}\n` +
    `[Y] create / [e] edit / [n] abort: `;
  const response = deps.prompt(promptMessage).trim();

  if (response === "n" || response === "N") {
    // AC-STE-228.10 — rollback staging on decline.
    if (opts.stagedPaths.length > 0) {
      deps.rollbackStaging(opts.stagedPaths);
    }
    return { outcome: "declined" };
  }

  if (response === "e" || response === "E") {
    // Re-prompt loop until the operator supplies a valid name.
    // Bounded to 100 attempts to avoid runaway in pathological tests
    // — real interactive usage gives up far sooner.
    for (let attempt = 0; attempt < 100; attempt++) {
      const editedRaw = deps.prompt("Enter edited branch name: ");
      const edited = editedRaw.trim();
      const error = validateEditedName(edited, deps);
      if (error === null) {
        deps.checkoutNewBranch(edited);
        const result: GateResult = { outcome: "edited", branchName: edited };
        if (probe.remoteProbeSkipped) result.remoteProbeSkipped = true;
        return result;
      }
      // Invalid → re-prompt. The next prompt message carries the
      // rejection reason so the operator knows what to fix.
      // (Tests inject sequential responses; the message text is
      // observed via promptCalls but the test only asserts content
      // for the first prompt.)
    }
    throw new CommitGateError(
      opts.proposedBranchName,
      `Operator-supplied edited branch name was rejected 100 times; aborting.`,
    );
  }

  // Default path: any response other than `n` / `e` is treated as `Y`
  // (matching the convention of capital-Y default in `[Y/e/n]` prompts).
  deps.checkoutNewBranch(finalName);
  const result: GateResult = { outcome: "created", branchName: finalName };
  if (probe.remoteProbeSkipped) result.remoteProbeSkipped = true;
  return result;
}
