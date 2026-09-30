// tracker_binding_write — STE-603.
//
// The one writer of the `### Jira` / `### Linear` tracker sub-section under
// `## Task Tracking`. It owns exactly `project`, `team`, `repo_tag`,
// `min_dpt_version`, the tag's entry in `default_labels`, and the shared
// container stop paragraph; every other line of the sub-section is preserved
// byte-for-byte and in order.
//
// The written file is read back through `readWorkspaceBinding`; a read-back
// refusal restores the original bytes and refuses with the reader's text.
//
// It never re-points (STE-645). Without `repoint: true` — which only the
// repoint rows route in `repoint_tracker_binding.ts` passes — it refuses,
// file unchanged: a bound, non-deferred `project:` different from the one
// passed; several `project:` lines when the value differs from any of them;
// a sub-section with a shared-container declaration but no `project:` value;
// and a key-shaped Linear `team:` different from `--team`. An empty
// `project` refuses on every route. `project: <deferred>`, a display-name
// team and a missing sub-section are still written.

import { readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { nfr10Message, runningDptVersion } from "../dpt_version";
import { compareSemver } from "../migrations/coverage";
import { readWorkspaceBinding, type WorkspaceAdapterKey } from "../workspace_binding";

export const SHARED_TRACKER_MARKER = "> **Shared tracker container — stop before any tracker write.**";

const REPO_TAG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SECTION_HEADING = "## Task Tracking";

/** STE-603 — a refused write. NFR-10 three-line message; the file is unchanged. */
export class TrackerBindingWriteError extends Error {
  constructor(verdict: string, remedy: string, context: string) {
    super(nfr10Message(`TrackerBindingWriteError: ${verdict}`, remedy, context));
    this.name = "TrackerBindingWriteError";
  }
}

export interface SharedTrackerSentinelInput {
  adapter: WorkspaceAdapterKey;
  project: string;
  repoTag: string;
  minDptVersion: string;
}

/** The stop paragraph: a blockquote every client reads, whatever its version. */
export function renderSharedTrackerSentinel(input: SharedTrackerSentinelInput): string {
  const kind = input.adapter === "jira" ? "Jira project" : "Linear project";
  return [
    SHARED_TRACKER_MARKER,
    `> The ${kind} \`${input.project}\` is shared with other repositories. This repository's tag is \`${input.repoTag}\`; the toolkit floor is \`${input.minDptVersion}\`.`,
    `> If your dev-process-toolkit plugin is older than ${input.minDptVersion}, or you cannot tell its version, do not create, edit, transition, comment on, link or import any ticket in this container — ask the operator to upgrade the plugin instead.`,
    `> People who file tickets by hand: add the label \`${input.repoTag}\` to tickets that belong to this repository. Every other repository writing into this container must declare its own tag — an untagged writer is not refused, only reported.`,
    `> Newer clients enforce the same rule in code.`,
  ].join("\n");
}

export interface TrackerSubsectionOptions {
  project: string;
  team?: string;
  /**
   * `jira_issue_type` — Jira only. Given, the writer owns the line; omitted, it
   * preserves whatever is there, like every other key it is not handed.
   */
  issueType?: string;
  shared?: { repoTag: string } | "unshare";
  /**
   * STE-645 — waives the bound-project check. Only the repoint rows route
   * (`repoint_tracker_binding.ts`) passes it; every other caller refuses to
   * move a bound, non-deferred `project:` to a different one.
   */
  repoint?: true;
}

const DEFERRED_PROJECT = "<deferred>";
// Defined locally: importing it from linear_team_key.ts would close the
// import cycle recorded there.
const LINEAR_TEAM_KEY = /^[A-Z][A-Z0-9]*$/;

export interface TrackerSubsectionResult {
  changed: boolean;
  before: string;
  after: string;
  diff: string;
}

function keyLineRe(key: string): RegExp {
  return new RegExp(`^${key}\\s*:`);
}

function findKey(lines: string[], key: string): number {
  const re = keyLineRe(key);
  return lines.findIndex((l) => re.test(l));
}

/**
 * The shared-container declaration a tracker sub-section body carries: any of
 * `repo_tag`, `min_dpt_version` or the stop paragraph. The writer's and the
 * repoint's "no `project:`" refusals both read this one definition (STE-645).
 */
export function sharedDeclarationParts(body: string[]): string[] {
  return [
    findKey(body, "repo_tag") >= 0 ? "repo_tag" : null,
    findKey(body, "min_dpt_version") >= 0 ? "min_dpt_version" : null,
    body.includes(SHARED_TRACKER_MARKER) ? "the stop paragraph" : null,
  ].filter((k): k is string => k !== null);
}

/** The `declaration=` context token for `sharedDeclarationParts`' result. */
export function declarationContext(parts: string[]): string {
  return `declaration=${parts.join("+").replace(/ /g, "_")}`;
}

/**
 * The remedy both "no `project:`" refusals name when a declaration survives:
 * the project it was declared for is only recoverable from history (STE-645).
 */
export const RESTORE_PROJECT_REMEDY =
  "restore the `project:` line from git (git log -p -- CLAUDE.md, then git checkout <rev> -- CLAUDE.md or re-add the line by hand), then re-run.";

/**
 * The trimmed value of every `project:` line in a sub-section body, in order,
 * `<deferred>` and empty values included. Two or more lines refuse on the
 * writer and on the repoint alike (STE-645), so both count them here.
 */
export function projectLinesOf(body: string[]): string[] {
  const re = keyLineRe("project");
  return body.filter((l) => re.test(l)).map((l) => l.replace(/^project\s*:\s*/, "").trim());
}

/** The trimmed value of `key:`, or "" when the key is absent. */
function keyValue(lines: string[], key: string): string {
  const at = findKey(lines, key);
  return at >= 0 ? lines[at]!.replace(new RegExp(`^${key}\\s*:\\s*`), "").trim() : "";
}

function renderLabels(labels: string[]): string {
  return `default_labels: [${labels.join(", ")}]`;
}

function parseLabels(line: string): string[] {
  const raw = line.replace(/^default_labels\s*:\s*/, "").trim();
  const inner = raw.replace(/^\[/, "").replace(/\]$/, "");
  return inner
    .split(",")
    .map((s) => s.trim().replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1"))
    .filter((s) => s.length > 0);
}

/**
 * Remove EVERY stop paragraph (each marker line through its last contiguous
 * `>` line, ending early at the next marker) and one blank line before each.
 * Every copy goes, so a hand-duplicated paragraph is healed by a re-run
 * rather than surviving beside the fresh render.
 */
function stripParagraph(lines: string[]): string[] {
  let out = lines;
  for (let start = out.indexOf(SHARED_TRACKER_MARKER); start >= 0; start = out.indexOf(SHARED_TRACKER_MARKER)) {
    let end = start + 1;
    while (end < out.length && out[end]!.startsWith(">") && out[end] !== SHARED_TRACKER_MARKER) end++;
    let from = start;
    if (from > 0 && out[from - 1] === "") from--;
    out = [...out.slice(0, from), ...out.slice(end)];
  }
  return out;
}

/** Set `key: value` in place, or insert it after the last present `afterKeys` line (none → first content slot). */
function setKey(lines: string[], key: string, value: string, afterKeys: string[]): void {
  const line = `${key}: ${value}`;
  const at = findKey(lines, key);
  if (at >= 0) {
    lines[at] = line;
    return;
  }
  let anchor = -1;
  for (const k of afterKeys) anchor = Math.max(anchor, findKey(lines, k));
  if (anchor >= 0) {
    lines.splice(anchor + 1, 0, line);
    return;
  }
  let i = 0;
  while (i < lines.length && lines[i] === "") i++;
  lines.splice(i, 0, line);
}

function removeKey(lines: string[], key: string): void {
  const at = findKey(lines, key);
  if (at >= 0) lines.splice(at, 1);
}

function unifiedDiff(path: string, before: string, after: string): string {
  if (before === after) return "";
  const a = before.split("\n");
  const b = after.split("\n");
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (
    suf < a.length - pre &&
    suf < b.length - pre &&
    a[a.length - 1 - suf] === b[b.length - 1 - suf]
  )
    suf++;
  const ctx = 3;
  const from = Math.max(0, pre - ctx);
  const aEnd = Math.min(a.length, a.length - suf + ctx);
  const bEnd = Math.min(b.length, b.length - suf + ctx);
  const out = [`--- ${path}`, `+++ ${path}`, `@@ -${from + 1},${aEnd - from} +${from + 1},${bEnd - from} @@`];
  for (let i = from; i < pre; i++) out.push(` ${a[i]}`);
  for (let i = pre; i < a.length - suf; i++) out.push(`-${a[i]}`);
  for (let i = pre; i < b.length - suf; i++) out.push(`+${b[i]}`);
  for (let i = a.length - suf; i < aEnd; i++) out.push(` ${a[i]}`);
  return `${out.join("\n")}\n`;
}

/**
 * Write the tracker sub-section: project/team always, plus a shared-container
 * declaration (`shared: { repoTag }`), its removal (`"unshare"`), or neither.
 */
export function writeTrackerSubsection(
  claudeMdPath: string,
  adapter: WorkspaceAdapterKey,
  opts: TrackerSubsectionOptions,
): TrackerSubsectionResult {
  const context = `file=${basename(claudeMdPath)}, adapter=${adapter}, helper=writeTrackerSubsection`;
  let before: string;
  try {
    before = readFileSync(claudeMdPath, "utf-8");
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code ?? "unknown";
    throw new TrackerBindingWriteError(
      `CLAUDE.md at ${claudeMdPath} cannot be read (${code}).`,
      `make ${claudeMdPath} a readable regular file, then re-run.`,
      `${context}, error=${code}`,
    );
  }
  if (before.startsWith("\uFEFF") || before.includes("\r")) {
    // A line editor that splits on "\n" would misread every heading of a
    // CRLF or BOM file; refuse by name rather than write a half-parsed file.
    throw new TrackerBindingWriteError(
      `CLAUDE.md at ${claudeMdPath} carries a byte-order mark or CRLF line endings, which this writer does not edit.`,
      `convert CLAUDE.md to UTF-8 without a BOM and LF line endings, then re-run.`,
      `${context}, encoding=${before.startsWith("\uFEFF") ? "bom" : "crlf"}`,
    );
  }
  if (opts.project.trim().length === 0) {
    throw new TrackerBindingWriteError(
      `--project was given an empty value; the writer never writes an empty \`project:\`.`,
      `pass the tracker project (e.g. --project STE), then re-run.`,
      `${context}, key=project, value=""`,
    );
  }
  if (opts.team !== undefined && opts.team.trim().length === 0) {
    throw new TrackerBindingWriteError(
      `--team was given an empty value; the writer never writes an empty \`team:\`.`,
      `pass the tracker team (e.g. --team STE), or omit --team to leave the existing line as it is.`,
      `${context}, key=team, value=""`,
    );
  }
  if (opts.issueType !== undefined) {
    if (adapter !== "jira") {
      throw new TrackerBindingWriteError(
        `jira_issue_type is a Jira key; a \`### Linear\` binding has no issue type.`,
        `drop --issue-type on a Linear binding.`,
        `${context}, key=jira_issue_type, adapter=${adapter}`,
      );
    }
    if (opts.issueType.trim().length === 0) {
      throw new TrackerBindingWriteError(
        `--issue-type was given an empty value; the writer never writes an empty \`jira_issue_type:\`.`,
        `pass the Jira issue type (e.g. --issue-type Task), or omit --issue-type to leave the existing line as it is.`,
        `${context}, key=jira_issue_type, value=""`,
      );
    }
  }
  const shared = opts.shared;
  if (shared !== undefined && shared !== "unshare" && !REPO_TAG_RE.test(shared.repoTag)) {
    throw new TrackerBindingWriteError(
      `repo_tag "${shared.repoTag}" is not lowercase-kebab (^[a-z0-9]+(-[a-z0-9]+)*$).`,
      `choose a tag of lowercase letters, digits and single hyphens (e.g. "glacy-be").`,
      `${context}, key=repo_tag, value="${shared.repoTag}"`,
    );
  }

  const lines = before.split("\n");
  const sectionStart = lines.indexOf(SECTION_HEADING);
  if (sectionStart < 0) {
    throw new TrackerBindingWriteError(
      `CLAUDE.md has no \`${SECTION_HEADING}\` section, so there is no tracker sub-section to write.`,
      `run /dev-process-toolkit:setup to create the section, then re-run.`,
      `${context}, section=missing`,
    );
  }
  let sectionEnd = lines.length;
  for (let i = sectionStart + 1; i < lines.length; i++) {
    if (/^#{1,2}\s/.test(lines[i]!)) {
      sectionEnd = i;
      break;
    }
  }
  const modeLine = lines.slice(sectionStart + 1, sectionEnd).find((l) => /^mode\s*:/.test(l));
  const mode = modeLine?.replace(/^mode\s*:\s*/, "").trim() ?? "none";
  if (mode === "none" || mode.length === 0) {
    throw new TrackerBindingWriteError(
      `\`## Task Tracking\` is in \`mode: none\` — there is no tracker to bind.`,
      `set \`mode: ${adapter}\` through /dev-process-toolkit:setup first.`,
      `${context}, mode=${mode}`,
    );
  }

  const subTitle = adapter === "linear" ? "### Linear" : "### Jira";
  let subStart = -1;
  for (let i = sectionStart + 1; i < sectionEnd; i++) {
    if (lines[i] === subTitle) {
      subStart = i;
      break;
    }
  }
  if (subStart < 0) {
    // Append a fresh sub-section at the end of the section.
    let at = sectionEnd;
    while (at > sectionStart + 1 && lines[at - 1] === "") at--;
    lines.splice(at, 0, "", subTitle, "");
    subStart = at + 1;
    sectionEnd += 3;
  }
  let subEnd = sectionEnd;
  for (let i = subStart + 1; i < sectionEnd; i++) {
    if (/^#{2,3}\s/.test(lines[i]!)) {
      subEnd = i;
      break;
    }
  }

  // Checked first and on every route, `repoint: true` included: keyValue
  // reads the FIRST `project:` line; readWorkspaceBinding reads the
  // LAST. With several lines, a value differing from ANY of them refuses —
  // a `<deferred>` or empty line counts too, or `<deferred>` + `GB` would
  // let the write rewrite the first line while the reader keeps `GB`.
  const bound = projectLinesOf(lines.slice(subStart + 1, subEnd));
  if (bound.length > 1 && bound.some((v) => v !== opts.project)) {
    throw new TrackerBindingWriteError(
      `the \`${subTitle}\` sub-section carries ${bound.length} \`project:\` lines (${bound.join(", ")}); writing \`project: ${opts.project}\` would pick one of them, which this writer does not do.`,
      `keep exactly one \`project:\` line in the \`${subTitle}\` sub-section by hand, then re-run.`,
      `${context}, key=project, current="${bound.join("|")}", requested="${opts.project}"`,
    );
  }
  if (opts.repoint !== true) {
    const body = lines.slice(subStart + 1, subEnd);
    const current = keyValue(body, "project");
    if (current.length === 0) {
      const kept = sharedDeclarationParts(body);
      if (kept.length > 0) {
        throw new TrackerBindingWriteError(
          `the \`${subTitle}\` sub-section carries a shared-container declaration (${kept.join(", ")}) but no \`project:\` value, so the project it was declared for is unknown.`,
          RESTORE_PROJECT_REMEDY,
          `${context}, key=project, current="", ${declarationContext(kept)}, requested="${opts.project}"`,
        );
      }
    }
    if (current.length > 0 && current !== DEFERRED_PROJECT && current !== opts.project) {
      throw new TrackerBindingWriteError(
        `CLAUDE.md binds \`project: ${current}\`; writing \`project: ${opts.project}\` would re-point this repository, which this writer does not do.`,
        `to keep the binding, re-run with --project ${current}; to move this repository to ${opts.project}, run /dev-process-toolkit:setup's repoint flag (bun run adapters/_shared/src/repoint_tracker_binding.ts <projectRoot> ${adapter} ${opts.project} …).`,
        `${context}, key=project, current="${current}", requested="${opts.project}"`,
      );
    }
    if (adapter === "linear" && opts.team !== undefined) {
      const team = keyValue(body, "team");
      if (LINEAR_TEAM_KEY.test(team) && team !== opts.team) {
        throw new TrackerBindingWriteError(
          `CLAUDE.md binds Linear \`team: ${team}\`; writing \`team: ${opts.team}\` would re-point this repository, which this writer does not do.`,
          `to keep the binding, re-run with --team ${team}; to move this repository to team ${opts.team}, run /dev-process-toolkit:setup's repoint flag.`,
          `${context}, key=team, current="${team}", requested="${opts.team}"`,
        );
      }
    }
  }

  let sub = stripParagraph(lines.slice(subStart + 1, subEnd));
  // Split trailing blank lines off so the paragraph lands as the last block.
  let trail = 0;
  while (trail < sub.length && sub[sub.length - 1 - trail] === "") trail++;
  const trailing = sub.slice(sub.length - trail);
  sub = sub.slice(0, sub.length - trail);

  if (opts.team !== undefined) setKey(sub, "team", opts.team, []);
  setKey(sub, "project", opts.project, ["team"]);
  if (opts.issueType !== undefined) setKey(sub, "jira_issue_type", opts.issueType, ["team", "project"]);

  let paragraph: string | null = null;
  if (shared === "unshare") {
    removeKey(sub, "repo_tag");
    removeKey(sub, "min_dpt_version");
  } else if (shared !== undefined) {
    const tag = shared.repoTag;
    const labelsAt = findKey(sub, "default_labels");
    if (labelsAt >= 0) {
      const labels = parseLabels(sub[labelsAt]!);
      if (!labels.includes(tag)) sub[labelsAt] = renderLabels([...labels, tag]);
    } else {
      setKey(sub, "default_labels", `[${tag}]`, ["team", "project"]);
    }
    const running = runningDptVersion();
    const existing = keyValue(sub, "min_dpt_version");
    const cmp = existing.length > 0 ? compareSemver(existing, running) : -1;
    if (cmp === null) {
      // Never guess: a floor that cannot be compared cannot be proven lower,
      // so replacing it could lower it.
      throw new TrackerBindingWriteError(
        `min_dpt_version "${existing}" is not strict X.Y.Z, so the writer cannot tell whether replacing it would lower the floor.`,
        `correct min_dpt_version by hand to a strict X.Y.Z version, then re-run.`,
        `${context}, key=min_dpt_version, value="${existing}"`,
      );
    }
    const floor = cmp > 0 ? existing : running;
    setKey(sub, "repo_tag", tag, ["team", "project", "default_labels"]);
    setKey(sub, "min_dpt_version", floor, ["repo_tag"]);
    paragraph = renderSharedTrackerSentinel({
      adapter,
      project: opts.project,
      repoTag: tag,
      minDptVersion: floor,
    });
  } else if (findKey(sub, "repo_tag") >= 0) {
    // A kept declaration re-renders its paragraph for the (possibly new) project.
    const tag = keyValue(sub, "repo_tag");
    const floor = keyValue(sub, "min_dpt_version");
    if (tag.length > 0 && floor.length > 0) {
      paragraph = renderSharedTrackerSentinel({ adapter, project: opts.project, repoTag: tag, minDptVersion: floor });
    }
  }
  if (paragraph !== null) sub.push("", ...paragraph.split("\n"));
  const newSub = [...sub, ...(trailing.length > 0 ? trailing : subEnd < lines.length ? [""] : [])];

  const after = [...lines.slice(0, subStart + 1), ...newSub, ...lines.slice(subEnd)].join("\n");
  const diff = unifiedDiff(claudeMdPath, before, after);
  if (after === before) return { changed: false, before, after, diff };

  writeFileSync(claudeMdPath, after);
  try {
    readWorkspaceBinding(claudeMdPath, adapter);
  } catch (e) {
    writeFileSync(claudeMdPath, before);
    throw e;
  }
  return { changed: true, before, after, diff };
}

function usage(): never {
  process.stderr.write(
    `${nfr10Message(
      "TrackerBindingWriteError: invalid arguments.",
      "usage: tracker_binding_write.ts <projectRoot> <jira|linear> --project <p> [--team <t>] [--issue-type <t>] [--shared <tag> | --unshare]",
      `argv=${process.argv.slice(2).join(" ")}`,
    )}\n`,
  );
  process.exit(1);
}

if (import.meta.main) {
  const [root, adapter, ...rest] = process.argv.slice(2);
  if (!root || (adapter !== "jira" && adapter !== "linear")) usage();
  const opts: TrackerSubsectionOptions = { project: "" };
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (flag === "--project") opts.project = rest[++i] ?? "";
    else if (flag === "--team") opts.team = rest[++i] ?? "";
    else if (flag === "--issue-type") opts.issueType = rest[++i] ?? "";
    else if (flag === "--shared") {
      if (opts.shared === "unshare") usage();
      opts.shared = { repoTag: rest[++i] ?? "" };
    } else if (flag === "--unshare") {
      if (opts.shared !== undefined) usage();
      opts.shared = "unshare";
    } else usage();
  }
  if (opts.project.length === 0) usage();
  try {
    const result = writeTrackerSubsection(join(root, "CLAUDE.md"), adapter, opts);
    process.stdout.write(result.diff);
    if (opts.shared === "unshare") {
      process.stdout.write(
        result.changed
          ? "unshared: removed repo_tag, min_dpt_version and the stop paragraph; default_labels left as found.\n"
          : "unshared: no declaration was present; nothing changed.\n",
      );
    }
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  }
}
