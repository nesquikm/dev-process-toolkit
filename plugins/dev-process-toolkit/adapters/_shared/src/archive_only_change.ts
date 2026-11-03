// STE-700 — archive-only change classifier.
//
// A change set is archive-only when it is non-empty and every change is one of:
//   - a rename specs/frs/<f>.md   → specs/frs/archive/<f>.md
//   - a rename specs/plan/<p>.md  → specs/plan/archive/<p>.md
//   - a modification of specs/requirements.md

import { normalizeFrontmatterSource } from "./frontmatter";

export interface ArchiveChange {
  /** git --name-status letter; a rename may carry a score ("R087"). */
  status: string;
  /** Destination path (the new path for a rename). */
  path: string;
  /** Source path, for a rename. */
  oldPath?: string;
  /** That file's unified diff, git's layout. */
  diff: string;
  /** Set by the git readers when this file's diff could not be read; never archive-only. */
  unreadable?: true;
}

// ---------------------------------------------------------------- AC-STE-700.8
//
// The spec-path rule, shared with pre-commit-tdd-orchestrator.ts (STE-295),
// whose spec-only carve-out needs every staged path to match one of these AND
// none to match that hook's own src/test patterns.
export const SPEC_PATTERNS: readonly RegExp[] = [
  /^specs\/frs\/[^/]+\.md$/, // specs/frs/*.md (excludes subdirs except archive below)
  /^specs\/frs\/archive\/[^/]+\.md$/, // specs/frs/archive/*.md
  /^specs\/plan\/M[^/]*\.md$/, // specs/plan/M*.md
  /^specs\/plan\/archive\/[^/]+\.md$/, // specs/plan/archive/*.md
  /^specs\/requirements\.md$/,
  /^specs\/technical-spec\.md$/,
  /^specs\/testing-spec\.md$/,
];

export const isSpecPath = (p: string): boolean =>
  SPEC_PATTERNS.some((re) => re.test(p));

const REQUIREMENTS = "specs/requirements.md";

const ARCHIVE_DIRS: readonly string[] = ["specs/frs", "specs/plan"];

function isArchiveRename(from: string, to: string): boolean {
  for (const dir of ARCHIVE_DIRS) {
    const src = new RegExp(`^${dir}/([^/]+\\.md)$`).exec(from);
    if (src && to === `${dir}/archive/${src[1]}`) return true;
  }
  return false;
}

// ---------------------------------------------------------------- AC-STE-700.2
//
// Inside a renamed file only these edits are allowed:
//   - the frontmatter `status` / `archived_at` values;
//   - a plan checkbox ticked `- [ ]` → `- [x]` (task text unchanged);
//   - an appended `## Implementation notes` section (a pure addition, last in
//     the file bar blank lines and the token-stats block, no `#` subheadings);
//   - any line inside the token-stats marker block, or a complete new block
//     (begin … end) appended at the end of the file, alone or after the notes.
// Positions are read from the hunk itself: a frontmatter edit counts only when
// its hunk starts at line 1 (so the opening `---` is seen); a token-stats line
// counts when the nearest marker before it in the hunk is `begin`, or, with no
// marker before it, the nearest marker after it is `end`.

type Op = { kind: " " | "-" | "+"; text: string; inFrontmatter: boolean };

const TOKEN_BEGIN = "<!-- token-stats:begin -->";
const TOKEN_END = "<!-- token-stats:end -->";
const FRONTMATTER_KEYS = new Set(["status", "archived_at"]);
const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

// Frontmatter state per diff side: "pre" (hunk starts at line 1, opening `---`
// not yet seen), "in", "out". Returns the next state and whether `text` itself
// sits inside the frontmatter.
type FmState = "pre" | "in" | "out";

function stepFrontmatter(st: FmState, text: string): [FmState, boolean] {
  if (st === "pre") return [text === "---" ? "in" : "out", false];
  if (st === "in") return text === "---" ? ["out", false] : ["in", true];
  return ["out", false];
}

function parseHunks(diff: string): Op[][] {
  const hunks: Op[][] = [];
  let cur: Op[] | null = null;
  let oldFm: FmState = "out";
  let newFm: FmState = "out";
  // A CRLF file's diff lines carry a trailing \r; normalize so the `---`
  // opener and closer still match.
  for (const line of normalizeFrontmatterSource(diff).split("\n")) {
    const h = HUNK_HEADER.exec(line);
    if (h) {
      cur = [];
      hunks.push(cur);
      oldFm = h[1] === "1" ? "pre" : "out";
      newFm = h[2] === "1" ? "pre" : "out";
      continue;
    }
    if (cur === null || line === "" || line.startsWith("\\")) continue;
    const kind = line[0];
    if (kind !== " " && kind !== "-" && kind !== "+") continue;
    const text = line.slice(1);
    let inFrontmatter = false;
    if (kind !== "+") [oldFm, inFrontmatter] = stepFrontmatter(oldFm, text);
    if (kind !== "-") {
      const [next, inNew] = stepFrontmatter(newFm, text);
      newFm = next;
      if (kind === "+") inFrontmatter = inNew;
    }
    cur.push({ kind, text, inFrontmatter });
  }
  return hunks;
}

function tokenBlockFlags(ops: Op[]): boolean[] {
  return ops.map((_, i) => {
    for (let j = i - 1; j >= 0; j--) {
      if (ops[j]!.text === TOKEN_BEGIN) return true;
      if (ops[j]!.text === TOKEN_END) return false;
    }
    for (let j = i + 1; j < ops.length; j++) {
      if (ops[j]!.text === TOKEN_END) return true;
      if (ops[j]!.text === TOKEN_BEGIN) return false;
    }
    return false;
  });
}

function frontmatterKey(op: Op): string | null {
  if (!op.inFrontmatter) return null;
  const m = /^([A-Za-z_][\w-]*):/.exec(op.text);
  return m && FRONTMATTER_KEYS.has(m[1]!) ? m[1]! : null;
}

function isAllowedPair(removed: Op, add: Op, isPlan: boolean): boolean {
  const key = frontmatterKey(removed);
  if (key !== null) return frontmatterKey(add) === key;
  // Checkbox ticks are a PLAN task rule only (AC-STE-700.2).
  if (!isPlan) return false;
  const open = /^(\s*)- \[ \] (.*)$/.exec(removed.text);
  return open !== null && add.text === `${open[1]}- [x] ${open[2]}`;
}

// Appended means last: only blank lines, the token-stats block, or the end of
// the (full-context) hunk may follow, and the section has no `#` heading of
// its own below the opener.
function isImplementationNotesBlock(block: Op[], rest: Op[], restInToken: boolean[]): boolean {
  if (block.some((o) => o.kind !== "+")) return false;
  const nonBlank = block.filter((o) => o.text.trim() !== "");
  if (nonBlank.length === 0 || nonBlank[0]!.text.trim() !== "## Implementation notes") return false;
  if (nonBlank.slice(1).some((o) => o.text.startsWith("#"))) return false;
  return rest.every(
    (o, k) =>
      o.text.trim() === "" || restInToken[k] || o.text === TOKEN_BEGIN || o.text === TOKEN_END,
  );
}

// A pure addition that ends in a COMPLETE new token-stats block (begin … end,
// then only blank lines) — what the archive flow appends to an FR that had no
// block. What precedes the block must be blank or an appended notes section.
function isAppendedTokenBlock(block: Op[], rest: Op[], restInToken: boolean[]): boolean {
  if (block.some((o) => o.kind !== "+")) return false;
  const end = block.map((o) => o.text).lastIndexOf(TOKEN_END);
  if (end < 0 || block.slice(end + 1).some((o) => o.text.trim() !== "")) return false;
  const begin = block.map((o) => o.text).lastIndexOf(TOKEN_BEGIN, end);
  if (begin < 0 || block.slice(begin + 1, end).some((o) => o.text === TOKEN_BEGIN)) return false;
  const restOk = rest.every(
    (o, k) =>
      o.text.trim() === "" || restInToken[k] || o.text === TOKEN_BEGIN || o.text === TOKEN_END,
  );
  if (!restOk) return false;
  const prefix = block.slice(0, begin);
  if (prefix.every((o) => o.text.trim() === "")) return true;
  return isImplementationNotesBlock(prefix, [], []);
}

function isAllowedBlock(block: Op[], inToken: boolean[], rest: Op[], restInToken: boolean[], isPlan: boolean): boolean {
  if (inToken.every(Boolean)) return true;
  if (isImplementationNotesBlock(block, rest, restInToken)) return true;
  if (isAppendedTokenBlock(block, rest, restInToken)) return true;
  const removed = block.filter((o) => o.kind === "-");
  const adds = block.filter((o) => o.kind === "+");
  if (removed.length !== adds.length) return false;
  return removed.every((r, i) => isAllowedPair(r, adds[i]!, isPlan));
}

function isAllowedRenameBody(diff: string, isPlan: boolean): boolean {
  for (const ops of parseHunks(diff)) {
    const inToken = tokenBlockFlags(ops);
    let i = 0;
    while (i < ops.length) {
      if (ops[i]!.kind === " ") {
        i++;
        continue;
      }
      let j = i;
      while (j < ops.length && ops[j]!.kind !== " ") j++;
      if (!isAllowedBlock(ops.slice(i, j), inToken.slice(i, j), ops.slice(j), inToken.slice(j), isPlan)) {
        return false;
      }
      i = j;
    }
  }
  return true;
}

// ---------------------------------------------------------------- AC-STE-700.3
//
// Inside specs/requirements.md only added traceability rows (`| AC-…`) are
// allowed; any removed line or other added line disqualifies the change.

function isAllowedRequirementsDiff(diff: string): boolean {
  return parseHunks(diff).every((ops) =>
    ops.every((o) => o.kind === " " || (o.kind === "+" && o.text.startsWith("| AC-"))),
  );
}

// ------------------------------------------------- AC-STE-700.2/.3 [security]
//
// Fail closed on content the hunk grader cannot see:
//   S1 — a `Binary files … differ` / `GIT binary patch` body has no hunks; a
//        rename whose score is not 100 must carry a hunk; a requirements.md
//        modification must carry a hunk.
//   S2 — only `\r\n` line endings are normalised; a lone `\r` would let the
//        normaliser split one raw line into two graded ones, so it disqualifies.

const BINARY_MARKER = /^(?:Binary files .* differ|GIT binary patch)$/m;
const HAS_HUNK = /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/m;

function hasUngradableContent(diff: string): boolean {
  return BINARY_MARKER.test(diff) || /\r(?!\n)/.test(diff);
}

function isAllowedChange(c: ArchiveChange): boolean {
  if (c.unreadable || hasUngradableContent(c.diff)) return false;
  if (c.status.startsWith("R")) {
    if (c.status !== "R100" && !HAS_HUNK.test(c.diff)) return false;
    return (
      c.oldPath !== undefined && isArchiveRename(c.oldPath, c.path) && isAllowedRenameBody(c.diff, c.path.startsWith("specs/plan/archive/"))
    );
  }
  return c.status === "M" && c.path === REQUIREMENTS && HAS_HUNK.test(c.diff) && isAllowedRequirementsDiff(c.diff);
}

export function isArchiveOnly(changes: readonly ArchiveChange[]): boolean {
  return changes.length > 0 && changes.every(isAllowedChange);
}

// ---------------------------------------------------------------- AC-STE-700.4
//
// Git reader: the STAGED change set of one checkout. Rename detection is asked
// for explicitly (`-M`), so a checkout with `diff.renames` off still reports an
// archive move as a rename (AC-STE-700.7). Any git failure reads as "no
// changes", which the classifier treats as not archive-only.

// `--literal-pathspecs` (S5): a path argument names exactly that file, so a
// glob-named file (`specs/frs/[x]*.md`) never pulls a sibling's diff in.
function gitOut(root: string, args: string[]): string | null {
  const r = Bun.spawnSync(["git", "--literal-pathspecs", "-C", root, ...args], { stdout: "pipe", stderr: "pipe" });
  return r.exitCode === 0 ? r.stdout.toString() : null;
}

// Whole-file context, so every hunk starts at line 1 and a frontmatter edit is
// seen inside its frontmatter however far down the block the line sits (git's
// default -U3, or a user's diff.context, would start the hunk below the `---`).
// No textconv / external driver may rewrite what is graded (S1). `--text` is
// deliberately NOT passed: a binary body then surfaces as git's
// `Binary files … differ` line, which the classifier rejects outright.
const DIFF_FLAGS = ["diff", "-M", "--unified=1000000", "--no-color", "--no-textconv", "--no-ext-diff"];

/** The change set `git diff <range>` reports, rename detection forced on. */
function readChanges(root: string, range: string[]): ArchiveChange[] {
  const flags = [...DIFF_FLAGS, ...range];
  const raw = gitOut(root, [...flags, "--name-status", "-z"]);
  if (raw === null) return [];
  const parts = raw.split("\0").filter((p) => p !== "");
  const changes: ArchiveChange[] = [];
  for (let i = 0; i < parts.length; ) {
    const status = parts[i++]!;
    const isPair = status.startsWith("R") || status.startsWith("C");
    const oldPath = isPair ? parts[i++] : undefined;
    const path = parts[i++]!;
    const paths = oldPath === undefined ? [path] : [oldPath, path];
    const read = gitOut(root, [...flags, "--", ...paths]);
    const diff = read ?? "";
    const change: ArchiveChange = oldPath === undefined ? { status, path, diff } : { status, path, oldPath, diff };
    if (read === null) change.unreadable = true;
    changes.push(change);
  }
  return changes;
}

export function readStagedChanges(root: string): ArchiveChange[] {
  return readChanges(root, ["--cached"]);
}

// ---------------------------------------------------------------- AC-STE-700.5
//
// Git reader: the BRANCH change set — merge-base(base, HEAD)..HEAD — so commits
// the base gained after the branch point are not counted against the branch.

export function readBranchChanges(root: string, base: string): ArchiveChange[] {
  const mergeBase = gitOut(root, ["merge-base", base, "HEAD"])?.trim();
  if (!mergeBase) return [];
  return readChanges(root, [mergeBase, "HEAD"]);
}

/**
 * The revision a pull request's base names in this checkout: the `--base`
 * branch (its remote-tracking `origin/<b>` when present, else the local
 * branch), or, with no `--base`, the remote's default branch (`origin/HEAD`).
 * Null when none resolves.
 */
export function resolvePrBaseRef(root: string, base: string | null): string | null {
  const exists = (ref: string) =>
    gitOut(root, ["rev-parse", "--verify", "-q", "--end-of-options", `${ref}^{commit}`]) !== null;
  if (base !== null && base !== "") {
    // An option-shaped base is never a ref name; refuse it outright.
    if (base.startsWith("-")) return null;
    for (const ref of [`refs/remotes/origin/${base}`, base]) if (exists(ref)) return ref;
    return null;
  }
  const head = gitOut(root, ["symbolic-ref", "-q", "refs/remotes/origin/HEAD"])?.trim();
  return head && exists(head) ? head : null;
}

/** True when the branch's change set against the PR base is non-empty and archive-only. */
export function isBranchArchiveOnly(root: string, base: string | null): boolean {
  const ref = resolvePrBaseRef(root, base);
  return ref !== null && isArchiveOnly(readBranchChanges(root, ref));
}

/** Bound on the one network call this module makes; well under any hook budget. */
const LS_REMOTE_TIMEOUT_MS = 4000;

/**
 * `git ls-remote` is the only call here that may leave the machine, so it runs
 * bounded and non-interactive: a slow or dead remote, a credential prompt or an
 * ssh host-key/password prompt reads as a failure (no pass) instead of hanging
 * the hook. A timeout or kill yields a null exit code, which reads as failure.
 */
function lsRemoteOut(root: string, remote: string, ref: string): string | null {
  const env: Record<string, string | undefined> = {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "echo",
    SSH_ASKPASS: "echo",
    GCM_INTERACTIVE: "never",
  };
  // BatchMode only when the user configured no ssh command of their own: the env
  // var outranks core.sshCommand and GIT_SSH, and overriding a custom key or
  // jump host would silently withhold the pass. The timeout still bounds those.
  if (!env.GIT_SSH_COMMAND && !env.GIT_SSH && gitOut(root, ["config", "--get", "core.sshCommand"]) === null) {
    env.GIT_SSH_COMMAND = "ssh -o BatchMode=yes";
  }
  const r = Bun.spawnSync(["git", "-C", root, "ls-remote", "--end-of-options", remote, ref], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env,
    timeout: LS_REMOTE_TIMEOUT_MS,
    killSignal: "SIGKILL",
  });
  return r.exitCode === 0 ? r.stdout.toString() : null;
}

/**
 * AC-STE-702.1/.3 — true when the branch the pull request opens holds exactly
 * the graded commit: HEAD is on a branch `<b>`, and `git ls-remote <remote>
 * refs/heads/<b>` (the remote from `branch.<b>.remote`, else `origin`) names
 * HEAD's sha. A detached HEAD, a missing remote branch, a different sha or a
 * failed ls-remote all read as false.
 */
export function isRemoteHeadEqualToHead(root: string): boolean {
  const branch = gitOut(root, ["symbolic-ref", "-q", "--short", "HEAD"])?.trim();
  if (!branch) return false;
  const head = gitOut(root, ["rev-parse", "--verify", "-q", "HEAD^{commit}"])?.trim();
  if (!head) return false;
  const remote = gitOut(root, ["config", "--get", `branch.${branch}.remote`])?.trim() || "origin";
  if (remote.startsWith("-")) return false;
  const out = lsRemoteOut(root, remote, `refs/heads/${branch}`);
  if (out === null) return false;
  const lines = out.split("\n").filter((l) => l.trim() !== "");
  if (lines.length !== 1) return false;
  const [sha, ref] = lines[0]!.split("\t");
  return sha === head && ref === `refs/heads/${branch}`;
}

/** True when the checkout's staged set is non-empty and archive-only. */
export function isStagedArchiveOnly(root: string): boolean {
  return isArchiveOnly(readStagedChanges(root));
}

/**
 * AC-STE-700.4 [hardening] — true when the checkout's tracked working tree
 * matches its index (`git diff --quiet` exits 0). The staged-set pass grades
 * the index only; with this clean, no commit form (`-a`, a pathspec) can pull
 * ungraded working-tree content into the commit. A git failure reads as dirty.
 */
export function isWorkingTreeClean(root: string): boolean {
  return gitOut(root, ["diff", "--quiet", "--no-ext-diff"]) !== null;
}
