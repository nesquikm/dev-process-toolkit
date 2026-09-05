// STE-167 — release_config parser + per-kind bump helpers.
//
// Parses the `## Release Files` block from CLAUDE.md and rewrites version
// strings inside the listed files per their declared `kind`. End-user
// projects use this to drive `/ship-milestone` against their own layout
// (package.json / pyproject.toml / pubspec.yaml / CHANGELOG.md / README
// "Latest:" line / arbitrary regex).
//
// YAML scope is intentionally narrow — see frontmatter.ts for the same
// design rationale (no runtime dep, hand-rolled minimal parser tuned for
// our schema).

// STE-545 AC-STE-545.3: the CHANGELOG's closing sentence is rendered by the
// ONE renderer that lives beside the parser producing its numbers. This module
// imports it rather than spelling the sentence out: a second copy here is
// exactly the drift AC-STE-545.5 scans the tree for.
import { renderClosingLine, type ClosingLineCount } from "./test_count_parser";
// STE-545 correction D2: `changelog_ci_owned: true` means CI owns the
// CHANGELOG, so the release writer must not touch it. The declaration is read
// through the ONE reader that owns its schema — a substring sniff here would
// read a malformed `changelog_ci_owned: yes` as `false` and rewrite the file
// the project told us not to touch.
import { readDocsConfig, MalformedDocsConfigError } from "./docs_config";

export type ReleaseKind = "json" | "toml" | "yaml" | "changelog" | "regex";

export interface ReleaseFile {
  path: string;
  kind: ReleaseKind;
  field?: string;
  pattern?: string;
  replace?: string;
  optional?: boolean;
}

export interface BumpOptions {
  newVersion: string;
  codename?: string;
  date?: string;
  changelogBody?: string;
  // STE-545 AC-STE-545.3: the gate's measured counts, FORWARDED from whoever
  // ran the gate — never re-measured here. Three fields, not four: the
  // rendered sentence reads total/failures/errors and `skipped` is reported
  // alongside them, never folded in (AC-STE-508.6 pins that byte-for-byte).
  testCount?: ClosingLineCount;
}

export class MissingReleaseFilesBlockError extends Error {
  constructor(reason: string) {
    super(
      `release_config: ${reason}. ` +
        `Remedy: add a \`## Release Files\` block to CLAUDE.md (run /setup or copy from examples/<stack>/release.yml). ` +
        `Context: skill=ship-milestone`,
    );
    this.name = "MissingReleaseFilesBlockError";
  }
}

export class MalformedReleaseFilesError extends Error {
  readonly index: number;
  constructor(index: number, reason: string) {
    super(`release_config: entry ${index}: ${reason}`);
    this.name = "MalformedReleaseFilesError";
    this.index = index;
  }
}

/**
 * STE-555. A `kind: regex` entry whose pattern matched nothing.
 *
 * A CLASS, not a message: the command-line door has to tell this miss apart
 * from every other way a bumper can fail, because `optional: true` skips this
 * one and nothing else. Matching on the message text would make the skip
 * hostage to a wording change, and `optional` would then start guarding — or
 * stop guarding — without anybody editing the guard.
 */
export class RegexPatternMissError extends Error {
  readonly pattern: string;
  constructor(pattern: string) {
    super(`bumpRegex: pattern did not match`);
    this.name = "RegexPatternMissError";
    this.pattern = pattern;
  }
}

/**
 * STE-554. A `replace` template names `{codename}` and no codename was supplied.
 *
 * The shipped writer had no codename to render at all, so the placeholder went
 * to disk as its six literal characters — measured on a v2.81.0 dry-run of this
 * repository. Falling back to leaving `{version}` substituted and `{codename}`
 * alone would reproduce that byte-for-byte, so the miss refuses instead.
 */
export class MissingCodenameError extends Error {
  constructor() {
    super(
      "bumpRegex: `replace` template names {codename} but no codename was supplied",
    );
    this.name = "MissingCodenameError";
  }
}

/**
 * STE-555. The CHANGELOG already carries a section for the version being written.
 *
 * The shipped inserter looked only for the topmost `## [` heading, so a second
 * run of an identical release produced a second identical section and reported
 * success — the JSON bumpers being idempotent is what made the doubled file the
 * only trace.
 */
export class DuplicateChangelogSectionError extends Error {
  readonly version: string;
  constructor(version: string) {
    super(
      `bumpChangelog: CHANGELOG already carries a \`## [${version}]\` section — ` +
        `refusing to insert a second one`,
    );
    this.name = "DuplicateChangelogSectionError";
    this.version = version;
  }
}

const HEADING_RE = /^##\s+Release Files\s*$/m;
const FENCE_RE = /```ya?ml\s*\n([\s\S]*?)\n```/;

/**
 * Fold a CLAUDE.md source to LF and drop a leading BOM before anything is
 * matched against it — the idiom `normalizeFrontmatterSource` and the
 * module-scanner `normalizeSource` helpers already carry.
 *
 * Folding the `\r\n` PAIRS alone is not enough here, which is what the shipped
 * reader did. The fenced payload's last line keeps an ORPHAN `\r`, because the
 * closing fence consumed its `\n` partner; `.` never matches a line terminator,
 * so `^(\s*)(- )?(.*)$` fails on that line and the walk drops it silently. The
 * measured result was `entry 0: missing required field \`kind\`` — a
 * CRLF-authored project could not release at all.
 *
 * Read-only: the parser never writes a release file back from this string, so
 * folding here cannot change any byte on disk.
 */
function normalizeSource(raw: string): string {
  return raw.replace(/^﻿/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function parseReleaseFiles(claudeMd: string): ReleaseFile[] {
  const source = normalizeSource(claudeMd);
  const headingMatch = HEADING_RE.exec(source);
  if (!headingMatch) {
    throw new MissingReleaseFilesBlockError(
      "no `## Release Files` heading found in CLAUDE.md",
    );
  }
  const after = source.slice(headingMatch.index + headingMatch[0]!.length);
  // Stop at next ## heading.
  const nextHeading = /^##\s+/m.exec(after);
  const block = nextHeading ? after.slice(0, nextHeading.index) : after;
  const fence = FENCE_RE.exec(block);
  if (!fence) {
    throw new MissingReleaseFilesBlockError(
      "`## Release Files` block has no fenced YAML payload",
    );
  }
  const payload = fence[1] ?? "";
  const entries = parseFilesYaml(payload);
  if (entries.length === 0) {
    throw new MissingReleaseFilesBlockError(
      "`## Release Files` block has zero entries",
    );
  }
  for (let i = 0; i < entries.length; i++) {
    validateEntry(entries[i]!, i);
  }
  return entries;
}

function parseFilesYaml(payload: string): ReleaseFile[] {
  // Minimal YAML for our schema:
  //   files:
  //     - path: <str>
  //       kind: <enum>
  //       field: <str>
  //       pattern: <str>
  //       replace: <str>
  //       optional: <bool>
  // Normalized independently of `parseReleaseFiles`: this function is the one
  // that walks lines, so the orphan-`\r` fold belongs where the walk is.
  const lines = normalizeSource(payload).split("\n");
  let i = 0;
  // Skip blank lines and full-line comments.
  while (i < lines.length && (lines[i]!.trim() === "" || lines[i]!.trim().startsWith("#"))) i++;
  if (i >= lines.length) return [];
  const first = lines[i]!.trim();
  if (first === "files: []") return [];
  if (!/^files\s*:\s*$/.test(first)) {
    // No `files:` key found — empty.
    return [];
  }
  i++;
  const out: ReleaseFile[] = [];
  let current: Partial<ReleaseFile> | null = null;
  for (; i < lines.length; i++) {
    const raw = lines[i]!;
    if (raw.trim() === "" || raw.trim().startsWith("#")) continue;
    const m = /^(\s*)(- )?(.*)$/.exec(raw);
    if (!m) continue;
    const indent = m[1]!.length;
    const isItemStart = m[2] === "- ";
    const body = m[3]!;
    if (indent < 2) {
      // Out of `files:` block.
      break;
    }
    if (isItemStart) {
      if (current) out.push(current as ReleaseFile);
      current = {};
      // Body might carry the first key inline: `- path: foo`.
      assignKv(current, body, out.length);
    } else {
      if (!current) {
        throw new MalformedReleaseFilesError(
          out.length,
          `unexpected non-list line in files block: "${raw}"`,
        );
      }
      assignKv(current, body, out.length);
    }
  }
  if (current) out.push(current as ReleaseFile);
  return out;
}

function assignKv(target: Partial<ReleaseFile>, line: string, idx: number): void {
  const c = line.indexOf(":");
  if (c < 0) return;
  const key = line.slice(0, c).trim();
  const value = line.slice(c + 1).trim();
  const stripped = stripQuotes(value);
  switch (key) {
    case "path":
      target.path = stripped;
      break;
    case "kind":
      target.kind = stripped as ReleaseKind;
      break;
    case "field":
      target.field = stripped;
      break;
    case "pattern":
      target.pattern = stripped;
      break;
    case "replace":
      target.replace = stripped;
      break;
    case "optional":
      target.optional = stripped === "true";
      break;
    default:
      throw new MalformedReleaseFilesError(idx, `unknown key "${key}"`);
  }
}

function stripQuotes(v: string): string {
  if (v.length >= 2) {
    if (v.startsWith('"') && v.endsWith('"')) return unescapeYamlString(v.slice(1, -1));
    if (v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1);
  }
  return v;
}

function unescapeYamlString(v: string): string {
  return v.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

const VALID_KINDS = new Set<ReleaseKind>([
  "json",
  "toml",
  "yaml",
  "changelog",
  "regex",
]);

function validateEntry(entry: ReleaseFile, idx: number): void {
  if (!entry.path) throw new MalformedReleaseFilesError(idx, "missing required field `path`");
  if (!entry.kind) throw new MalformedReleaseFilesError(idx, "missing required field `kind`");
  if (!VALID_KINDS.has(entry.kind)) {
    throw new MalformedReleaseFilesError(
      idx,
      `unknown kind "${entry.kind}" — expected one of ${[...VALID_KINDS].join("|")}`,
    );
  }
  if (entry.kind === "json" || entry.kind === "toml" || entry.kind === "yaml") {
    if (!entry.field) {
      throw new MalformedReleaseFilesError(
        idx,
        `kind="${entry.kind}" requires a \`field:\` dot-path`,
      );
    }
    validateEntryPathShape(entry.kind, entry.field, idx);
  }
  if (entry.kind === "regex") {
    if (!entry.pattern) {
      throw new MalformedReleaseFilesError(idx, `kind="regex" requires a \`pattern:\``);
    }
    if (!entry.replace) {
      throw new MalformedReleaseFilesError(idx, `kind="regex" requires a \`replace:\` template`);
    }
    if (!/\(\?<version>/.test(entry.pattern)) {
      throw new MalformedReleaseFilesError(
        idx,
        `kind="regex" pattern must contain a named (?<version>...) capture group`,
      );
    }
  }
}

// Per-kind path-shape dispatch — STE-324 AC.3.
//
// Each `kind` carries a different path-shape capability tied to its bumper:
//   - `yaml`: bumpYaml only rewrites top-level `field: <semver>` lines, so any
//     dotted `field:` is rejected here with the NFR-10 canonical refusal.
//   - `toml`: bumpToml handles top-level (`version`) and one-level-dotted
//     (`project.version`). Deeper paths are rejected by bumpToml at rewrite
//     time; we surface that here too for early failure.
//   - `json`: bumpJson supports arbitrary dotted paths including array-indexed
//     (`plugins[0].version`), so no path-shape rejection applies.
function validateEntryPathShape(
  kind: "json" | "toml" | "yaml",
  field: string,
  idx: number,
): void {
  if (kind === "yaml" && field.includes(".")) {
    throw new MalformedReleaseFilesError(
      idx,
      `yaml kind only supports top-level fields; got dotted path '${field}' at line ${idx}`,
    );
  }
  if (kind === "toml" && field.split(".").length > 2) {
    throw new MalformedReleaseFilesError(
      idx,
      `toml kind only supports top-level and one-level-dotted fields; got '${field}' at line ${idx}`,
    );
  }
}

// ---- per-kind bumpers -----------------------------------------------------

// Rewrites a JSON property at the given dot-path. **Known reformat:** output
// uses 2-space indent (matches npm's default) — files using tab indent,
// 4-space indent, or compact JSON will be reformatted on bump. Documented in
// docs/ship-milestone-reference.md § Per-kind worked examples; reach for
// `kind: regex` if you need byte-preserving rewrites of an unusually-formatted
// JSON file.
export function bumpJson(content: string, field: string, version: string): string {
  const data = JSON.parse(content);
  setDottedPath(data, field, version);
  return JSON.stringify(data, null, 2) + "\n";
}

function setDottedPath(obj: unknown, dotted: string, value: string): void {
  // Supports `version`, `package.version`, `plugins[0].version`.
  const tokens: Array<string | number> = [];
  const re = /([^.\[\]]+)|\[(\d+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(dotted)) !== null) {
    if (m[1] !== undefined) tokens.push(m[1]);
    else if (m[2] !== undefined) tokens.push(Number(m[2]));
  }
  let cursor: any = obj;
  for (let i = 0; i < tokens.length - 1; i++) {
    const t = tokens[i]!;
    if (cursor == null || typeof cursor !== "object" || !(t in cursor)) {
      throw new Error(`bumpJson: path "${dotted}" not found at "${t}"`);
    }
    cursor = cursor[t as keyof typeof cursor];
  }
  const last = tokens[tokens.length - 1]!;
  if (cursor == null || typeof cursor !== "object" || !(last in cursor)) {
    throw new Error(`bumpJson: path "${dotted}" not found at terminal "${last}"`);
  }
  cursor[last as keyof typeof cursor] = value;
}

export function bumpToml(content: string, field: string, version: string): string {
  // Minimal TOML rewrite: locate the [table] (if any) and rewrite the
  // `field = "..."` line. Supports top-level `version = "x"` (no table)
  // and one-level dotted `table.field`.
  const parts = field.split(".");
  if (parts.length === 1) {
    return rewriteTomlField(content, null, parts[0]!, version);
  }
  if (parts.length === 2) {
    return rewriteTomlField(content, parts[0]!, parts[1]!, version);
  }
  throw new Error(`bumpToml: dotted paths deeper than 1 level not supported (got "${field}")`);
}

function rewriteTomlField(
  content: string,
  table: string | null,
  key: string,
  version: string,
): string {
  const lines = content.split("\n");
  let inTable = table === null;
  let rewrote = false;
  const tableHeader = table ? `[${table}]` : null;
  const fieldRe = new RegExp(`^(\\s*)${escapeRegex(key)}\\s*=\\s*['"][^'"]*['"](.*)$`);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      inTable = tableHeader !== null && trimmed === tableHeader;
      continue;
    }
    if (!inTable) continue;
    const m = fieldRe.exec(line);
    if (m) {
      lines[i] = `${m[1]}${key} = "${version}"${m[2]}`;
      rewrote = true;
      break;
    }
  }
  if (!rewrote) {
    throw new Error(
      `bumpToml: could not find ${table ? `[${table}].` : ""}${key} = "..."`,
    );
  }
  return lines.join("\n");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function bumpYaml(content: string, field: string, version: string): string {
  // Top-level `field: <semver>[+<build>]` rewrite. Preserves any `+<build>`
  // suffix (Flutter pubspec.yaml convention).
  const lines = content.split("\n");
  const fieldRe = new RegExp(`^(${escapeRegex(field)}):\\s*(\\d+\\.\\d+\\.\\d+)([+\\-][^\\s]*)?\\s*$`);
  let rewrote = false;
  for (let i = 0; i < lines.length; i++) {
    const m = fieldRe.exec(lines[i]!);
    if (m) {
      const suffix = m[3] ?? "";
      lines[i] = `${m[1]}: ${version}${suffix}`;
      rewrote = true;
      break;
    }
  }
  if (!rewrote) {
    throw new Error(`bumpYaml: could not find top-level "${field}: <semver>" line`);
  }
  return lines.join("\n");
}

export function bumpChangelog(
  content: string,
  version: string,
  codename: string,
  date: string,
  body: string,
  // AC-STE-545.3: optional HERE, mandatory at the release boundary. The
  // count-less shape is the pre-STE-545 signature that predates the closing
  // line, kept working for callers rewriting a section for other reasons; what
  // makes the count non-negotiable for a RELEASE is `bumpFile`'s changelog
  // guard, which refuses without one. Putting the refusal here instead would
  // only move it off the boundary that actually writes release files.
  testCount?: ClosingLineCount,
): string {
  // STE-555 AC-STE-555.4. Before anything is computed: the file already
  // answers whether this release was written, and the answer is only knowable
  // here, where the existing content is in hand.
  if (hasChangelogSection(content, version)) {
    throw new DuplicateChangelogSectionError(version);
  }
  const header = `## [${version}] — ${date} — "${codename}"`;
  const bodyBlock = body.endsWith("\n") ? body : `${body}\n`;
  // The closing line is the LAST line of the new section, rendered from
  // `testCount` — two different counts therefore produce two different
  // sections, which a literal could never do.
  const closing = testCount === undefined ? "" : `\n${renderClosingLine(testCount)}\n`;
  const newSection = `${header}\n\n${bodyBlock}${closing}`;
  // Insert above the topmost `## [` heading; if none, append after the
  // intro block (everything up to the first blank line after `# Title`).
  const firstSectionIdx = content.search(/^##\s+\[/m);
  if (firstSectionIdx >= 0) {
    return content.slice(0, firstSectionIdx) + newSection + "\n" + content.slice(firstSectionIdx);
  }
  // No prior versioned sections — append at the end with a separator.
  const trimmed = content.replace(/\s+$/, "");
  return `${trimmed}\n\n${newSection}`;
}

/**
 * True iff the CHANGELOG already carries a `## [<version>]` heading. The
 * leading `v` is tolerated on the heading side, matching every other version
 * comparison in the release path.
 */
function hasChangelogSection(content: string, version: string): boolean {
  return new RegExp(String.raw`^##\s+\[v?${escapeRegex(version)}\]`, "m").test(content);
}

/**
 * Rewrite every occurrence of `pattern` with the rendered `replace` template.
 *
 * THREE properties this function did not have, all measured on the shipped
 * version (STE-554 / STE-555):
 *
 *  - `{codename}` renders. The shipped renderer substituted `{version}` alone
 *    and `bumpFile` never forwarded a codename, so a template naming the
 *    codename put the six characters `{codename}` on disk.
 *  - EVERY occurrence is rewritten. `new RegExp(pattern)` carried no flags, so
 *    a project naming its version twice got the first one bumped and a success
 *    report for both.
 *  - The template lands LITERALLY. The rewrite passed `rendered` as a
 *    replacement STRING, so `$&`, `$1`, `` $` ``, `$'` and `$$` in a user's
 *    template were expanded by the engine — measured: `[$&] v{version}`
 *    produced `[v1.0.0] v2.0.0`. A replacer FUNCTION is the only form the
 *    engine does not scan for `$` patterns; hand-escaping would hold until
 *    something rendered a `$` of its own.
 *
 * `m` is deliberately NOT added alongside `g`: it would change what `^` and `$`
 * mean in every consumer pattern already written against this writer.
 */
export function bumpRegex(
  content: string,
  pattern: string,
  replace: string,
  version: string,
  codename?: string,
): string {
  if (replace.includes("{codename}") && codename === undefined) {
    throw new MissingCodenameError();
  }
  const re = new RegExp(pattern, "g");
  // `test` on a global regex advances `lastIndex`; the rewrite below reuses the
  // same instance, so the cursor is put back before it does. `replace` resets
  // it too — asserting it here is what keeps the detection and the rewrite from
  // disagreeing if either ever stops doing so (AC-STE-555.9).
  const matched = re.test(content);
  re.lastIndex = 0;
  if (!matched) {
    throw new RegexPatternMissError(pattern);
  }
  const rendered = replace
    .replace(/\{version\}/g, version)
    .replace(/\{codename\}/g, codename ?? "");
  return content.replace(re, () => rendered);
}

export function bumpFile(file: ReleaseFile, content: string, opts: BumpOptions): string {
  switch (file.kind) {
    case "json":
      return bumpJson(content, file.field!, opts.newVersion);
    case "toml":
      return bumpToml(content, file.field!, opts.newVersion);
    case "yaml":
      return bumpYaml(content, file.field!, opts.newVersion);
    case "changelog":
      // AC-STE-545.4: the count joins the three companions this boundary already
      // demanded, so no release section can be written without one. The refusal
      // lives HERE and not in `bumpChangelog` (see its `testCount` note).
      if (
        !opts.codename ||
        !opts.date ||
        opts.changelogBody === undefined ||
        opts.testCount === undefined
      ) {
        throw new Error(
          "bumpFile: changelog kind requires codename, date, changelogBody, and testCount",
        );
      }
      return bumpChangelog(
        content,
        opts.newVersion,
        opts.codename,
        opts.date,
        opts.changelogBody,
        opts.testCount,
      );
    case "regex":
      // STE-554 AC-STE-554.2: the codename is forwarded HERE. `BumpOptions`
      // has always carried it and the changelog arm has always consumed it;
      // this arm dropped it, which is why the README banner's codename went
      // stale on every release since that entry was written.
      return bumpRegex(content, file.pattern!, file.replace!, opts.newVersion, opts.codename);
  }
}

// ---------------------------------------------------------------------------
// Preview rendering
// ---------------------------------------------------------------------------

/**
 * A unified diff between the two sides the preview already holds in memory.
 *
 * STE-545 correction E2. The round-1 preview computed the new content and threw
 * it away, printing `would rewrite <path> (dry-run)` — while `/ship-milestone`
 * step 6 promises the operator "a single unified diff covering every modified
 * file". Nothing produced it, so the operator approved hunks assembled by hand.
 *
 * The hunk is COMPUTED, not templated: the common prefix and suffix are trimmed
 * off both sides and what remains is the change. Two different target versions
 * therefore give two different diffs, which a literal could never do. A release
 * bump touches one region per file, so one hunk describes it exactly; a
 * multi-region change is reported as a single wider hunk rather than several
 * tight ones — still a correct unified diff, and never a wrong one.
 *
 * Returns "" when the sides are identical, so an unchanged (or skipped) entry
 * contributes no hunk at all.
 *
 * KNOWN LIMITATION, recorded deliberately (STE-545 correction F2): this
 * renderer never emits the `\ No newline at end of file` marker, so a hunk over
 * a side that lacks a trailing newline is an incomplete unified diff by the
 * strict grammar. The output is rendered for a human to read under `--dry-run`
 * and is never fed to `patch` or `git apply`, and every release file this door
 * touches (JSON manifests, CHANGELOG.md, README.md) is newline-terminated, so
 * the marker would never fire in practice. Emitting it correctly would mean
 * reworking the line model — `split("\n")` represents a trailing newline as an
 * empty final element that currently participates in both the common-suffix
 * trim and the `@@` line counts — for a case that cannot arise here. The
 * omission is therefore admitted rather than papered over; if this renderer is
 * ever reused for content fed to a patch tool, fix the line model first.
 */
export function renderUnifiedDiff(
  path: string,
  before: string,
  after: string,
  context = 3,
): string {
  if (before === after) return "";
  const a = before.split("\n");
  const b = after.split("\n");

  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const ctxStart = Math.max(0, start - context);
  const ctxEndA = Math.min(a.length, endA + context);
  const ctxEndB = Math.min(b.length, endB + context);

  const out: string[] = [
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${ctxStart + 1},${ctxEndA - ctxStart} +${ctxStart + 1},${ctxEndB - ctxStart} @@`,
  ];
  for (let i = ctxStart; i < start; i++) out.push(` ${a[i]!}`);
  for (let i = start; i < endA; i++) out.push(`-${a[i]!}`);
  for (let i = start; i < endB; i++) out.push(`+${b[i]!}`);
  // Trailing context is common to both sides by construction, so either side
  // renders it; `a` is used so the loop bound and the index agree.
  for (let i = endA; i < ctxEndA; i++) out.push(` ${a[i]!}`);
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// Command-line front door
// ---------------------------------------------------------------------------

// STE-545 (M141). This module rewrites every file a release touches, and until
// now nothing could run it: zero `import.meta.main` occurrences and zero
// non-test importers, so `/ship-milestone`'s write step named a module the
// operator could only read and then imitate by hand. A guard inside a function
// nobody calls changes nothing — the door comes first.
//
// Usage:
//
//     bun run release_config.ts <projectRoot> <newVersion> \
//         [--codename <name>] [--date <YYYY-MM-DD>] [--body <text>] \
//         [--test-count <total>,<failures>,<errors>] [--dry-run]
//
// `--dry-run` computes every rewrite exactly as the real run does, prints a
// unified diff per changed path — the diff `/ship-milestone` step 6 asks the
// operator to approve — writes nothing, and exits zero; and it refuses whatever
// the real run refuses, with the same verdict. That parity is the point: the
// ceremony previews before the operator approves, so a declined release leaves
// no bumped version and no written CHANGELOG section behind.
//
// It reads `<projectRoot>/CLAUDE.md`, parses the `## Release Files` block, and
// rewrites each listed file per its declared `kind`, printing one line per
// rewritten path. Every rewrite is computed BEFORE the first byte is written,
// so a refusal — an absent block, a missing version, a bumper that cannot find
// its anchor — leaves the tree exactly as it found it. A half-applied release
// is worse than a refused one.
//
// The count is FORWARDED on `--test-count`, never re-measured here: detection
// answers differently per directory, and the ceremony has already measured it
// against the root the gate actually ran in.
//
// Imported by the suite, where `import.meta.main` is false and this block never
// runs: the module stays side-effect-free at import.
if (import.meta.main) {
  const { existsSync, readFileSync, writeFileSync } = await import("node:fs");
  const { join, isAbsolute } = await import("node:path");

  const refuse = (verdict: string, remedy: string, context: string): void => {
    console.error(
      [verdict, `Remedy: ${remedy}`, `Context: ${context}, skill=ship-milestone`].join("\n"),
    );
    process.exitCode = 1;
  };

  const USAGE =
    "bun run release_config.ts <projectRoot> <newVersion> " +
    "[--codename <name>] [--date <YYYY-MM-DD>] [--body <text>] " +
    "[--test-count <total>,<failures>,<errors>] [--dry-run]";

  // Boolean flags take NO value. Parsing `--dry-run` as value-taking would eat
  // the next argument — or refuse outright when it lands last — so the preview
  // would never run and the refusal would be about argv, not about the input.
  const BOOLEAN_FLAGS = new Set(["--dry-run"]);

  // STE-545 correction E7. Every flag the door knows, enumerated — because the
  // round-1 loop enumerated only the boolean one and STORED anything else,
  // consuming the token behind it. Measured: `--dryrun --codename Zed` printed
  // `rewrote pkg.json`, exited 0, left the bump on disk and swallowed the
  // codename. For a flag whose entire purpose is "nothing reaches disk",
  // failing open on a misspelling is the wrong default, so an unrecognised
  // `--` token refuses by name and does not eat its neighbour.
  const VALUE_FLAGS = new Set(["--codename", "--date", "--body", "--test-count"]);

  // First line only, and with any inline `Remedy:` tail removed: the canonical
  // shape wants a one-line verdict, and the envelope below supplies the rest.
  const verdictOf = (error: unknown): string => {
    const raw = error instanceof Error ? error.message : String(error);
    return (raw.split(/\s*Remedy:/)[0] ?? raw).replace(/\r?\n[\s\S]*$/, "").trim();
  };

  const argv = process.argv.slice(2);
  const positional: string[] = [];
  const flags = new Map<string, string>();
  const booleans = new Set<string>();
  let argvOk = true;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith("--")) {
      if (BOOLEAN_FLAGS.has(arg)) {
        booleans.add(arg);
        continue;
      }
      if (!VALUE_FLAGS.has(arg)) {
        refuse(
          `Refusing: to rewrite any release file — unrecognised flag \`${arg}\`.`,
          USAGE,
          `argv=unknown-flag, flag=${arg}`,
        );
        argvOk = false;
        break;
      }
      const value = argv[i + 1];
      if (value === undefined) {
        refuse(
          `Refusing: to rewrite any release file — \`${arg}\` was given with no value.`,
          USAGE,
          `argv=incomplete, flag=${arg}`,
        );
        argvOk = false;
        break;
      }
      // STE-545 correction F1, the mirror image of E7. E7 closed the branch
      // where an UNRECOGNISED flag ate its neighbour; this branch checked only
      // that a successor token EXISTS, never that the token was itself a flag.
      // Measured: `--codename --dry-run` stored "--dry-run" as the codename,
      // never saw the preview flag, and put the release on disk at exit 0 —
      // exactly the failure `--dry-run` exists to prevent.
      //
      // A recognised flag behind a value flag always refuses: it is a flag that
      // would otherwise silently stop working. `--codename` / `--date` /
      // `--test-count` refuse on ANY `--`-prefixed successor, recognised or
      // not, since none of those three can legitimately begin with `--` — that
      // costs nothing and also closes `--codename --dryrun`. `--body` is the
      // deliberate carve-out: it is free text, changelog bodies open with
      // markdown bullets and can open with `---`, and there is no `--`
      // separator to escape them with, so for `--body` the successor test is
      // known-flag MEMBERSHIP only.
      const successorIsKnownFlag = BOOLEAN_FLAGS.has(value) || VALUE_FLAGS.has(value);
      const successorLooksLikeFlag =
        successorIsKnownFlag || (arg !== "--body" && value.startsWith("--"));
      if (successorLooksLikeFlag) {
        refuse(
          `Refusing: to rewrite any release file — \`${arg}\` was given no value; the next ` +
            `token \`${value}\` is a flag.`,
          USAGE,
          `argv=incomplete, flag=${arg}, successor=${value}`,
        );
        argvOk = false;
        break;
      }
      flags.set(arg, value);
      i++;
    } else {
      positional.push(arg);
    }
  }

  const projectRoot = positional[0];
  const newVersion = positional[1];

  if (argvOk && (projectRoot === undefined || newVersion === undefined)) {
    refuse(
      "Refusing: to rewrite any release file without both a project root and a new version.",
      USAGE,
      `argv=incomplete, positional=${positional.length}`,
    );
    argvOk = false;
  }

  let testCount: ClosingLineCount | undefined;
  const rawCount = flags.get("--test-count");
  if (argvOk && rawCount !== undefined) {
    const parts = rawCount.split(",").map((p) => p.trim());
    const nums = parts.map(Number);
    if (parts.length !== 3 || nums.some((n) => !Number.isInteger(n) || n < 0)) {
      refuse(
        `Refusing: to rewrite any release file — \`--test-count ${rawCount}\` is not ` +
          `<total>,<failures>,<errors>.`,
        "pass the three counts the gate reported, e.g. `--test-count 9340,0,0`",
        `argv=malformed, flag=--test-count`,
      );
      argvOk = false;
    } else {
      testCount = { total: nums[0]!, failures: nums[1]!, errors: nums[2]! };
    }
  }

  const dryRun = booleans.has("--dry-run");

  if (argvOk) {
    const root = isAbsolute(projectRoot!) ? projectRoot! : join(process.cwd(), projectRoot!);
    const claudeMdPath = join(root, "CLAUDE.md");

    const opts: BumpOptions = {
      newVersion: newVersion!,
      ...(flags.has("--codename") ? { codename: flags.get("--codename")! } : {}),
      ...(flags.has("--date") ? { date: flags.get("--date")! } : {}),
      ...(flags.has("--body") ? { changelogBody: flags.get("--body")! } : {}),
      ...(testCount ? { testCount } : {}),
    };

    // Compute every rewrite first; write only once all of them succeeded.
    const pending: Array<{ path: string; abs: string; before: string; content: string }> = [];
    const skipped: Array<{ path: string; reason: string }> = [];
    // How many files this run has actually put on disk. The refusal envelope
    // reads it rather than asserting from the fact that a refusal happened:
    // the catch below also covers the write loop, so "nothing was written" is
    // a claim the envelope can only make when it is true (correction E8).
    let wrote = 0;
    try {
      if (!existsSync(claudeMdPath)) {
        throw new Error(`release_config: no CLAUDE.md at ${claudeMdPath}`);
      }
      // Same CLAUDE.md, second reader: `readDocsConfig` owns the `## Docs`
      // schema and THROWS on a value that is neither lowercase `true` nor
      // `false`, so drift surfaces as a refusal here instead of being silently
      // coerced to "CI does not own it" and rewriting the file anyway.
      const ciOwnsChangelog = readDocsConfig(claudeMdPath).changelogCiOwned;
      const entries = parseReleaseFiles(readFileSync(claudeMdPath, "utf-8"));
      for (const entry of entries) {
        const abs = join(root, entry.path);
        // CI owns the CHANGELOG: skip the entry entirely — no rewrite, and no
        // missing-count refusal either, because there is no section to put a
        // count in. Every other kind in the same run is still rewritten.
        if (entry.kind === "changelog" && ciOwnsChangelog) {
          skipped.push({ path: entry.path, reason: "changelog_ci_owned: true" });
          continue;
        }
        if (!existsSync(abs)) {
          if (entry.optional) {
            skipped.push({ path: entry.path, reason: "optional, absent" });
            continue;
          }
          throw new Error(`release_config: required release file is missing: ${entry.path}`);
        }
        const before = readFileSync(abs, "utf-8");
        // STE-555 AC-STE-555.1. `optional` used to guard a missing FILE and
        // nothing else, so an optional entry whose pattern stopped matching
        // aborted the whole release — and the toolkit's own README entry is
        // exactly that shape: `optional: true` over a hand-maintained banner
        // that always exists. The skip reads the SAME declaration the
        // `existsSync` branch above reads, and reports through the same
        // channel; every other failure still throws (AC-STE-555.2).
        let content: string;
        try {
          content = bumpFile(entry, before, opts);
        } catch (error) {
          if (error instanceof RegexPatternMissError && entry.optional) {
            skipped.push({ path: entry.path, reason: "optional, pattern did not match" });
            continue;
          }
          throw error;
        }
        pending.push({ path: entry.path, abs, before, content });
      }
      // Every refusal above is reached identically in both modes: the preview
      // is the SAME computation, and only this last step diverges. A preview
      // that accepted input the real run rejects would have the operator
      // approve a diff the write step then refuses.
      if (dryRun) {
        // The preview holds both sides, so both sides reach the operator: the
        // named path AND the hunks step 6 asks them to approve. A skipped entry
        // never enters `pending`, so it contributes no hunk — the diff
        // describes what would change, not what was considered.
        for (const { path, before, content } of pending) {
          console.log(`would rewrite ${path} (dry-run)`);
          const diff = renderUnifiedDiff(path, before, content);
          if (diff !== "") console.log(diff);
        }
        for (const { path, reason } of skipped) console.log(`would skip ${path} (${reason}) (dry-run)`);
      } else {
        // Written and reported one at a time: a report printed ahead of the
        // write it describes is the same lie the envelope below stopped telling.
        for (const { abs, path, content } of pending) {
          writeFileSync(abs, content);
          wrote++;
          console.log(`rewrote ${path}`);
        }
        for (const { path, reason } of skipped) console.log(`skipped ${path} (${reason})`);
      }
    } catch (error) {
      // Name the block that actually failed. `readDocsConfig` and
      // `parseReleaseFiles` read the same CLAUDE.md through two different
      // schemas, and sending an operator to `## Release Files` for a `## Docs`
      // failure sends them to a block that is fine.
      const block = error instanceof MalformedDocsConfigError ? "## Docs" : "## Release Files";
      const outcome =
        wrote === 0
          ? "nothing was written."
          : `${wrote} file(s) were already rewritten before the failure — check the tree ` +
            `before re-running.`;
      refuse(
        `Refusing: to rewrite the release files — ${verdictOf(error)}`,
        `fix the \`${block}\` block in CLAUDE.md (or the offending file) and re-run; ${outcome}`,
        `root=${root}, version=${newVersion}`,
      );
    }
  }
}
