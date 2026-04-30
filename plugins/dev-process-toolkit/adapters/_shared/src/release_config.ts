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

const HEADING_RE = /^##\s+Release Files\s*$/m;
const FENCE_RE = /```ya?ml\s*\n([\s\S]*?)\n```/;

export function parseReleaseFiles(claudeMd: string): ReleaseFile[] {
  const headingMatch = HEADING_RE.exec(claudeMd);
  if (!headingMatch) {
    throw new MissingReleaseFilesBlockError(
      "no `## Release Files` heading found in CLAUDE.md",
    );
  }
  const after = claudeMd.slice(headingMatch.index + headingMatch[0]!.length);
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
  const lines = payload.replace(/\r\n/g, "\n").split("\n");
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
): string {
  const header = `## [${version}] — ${date} — "${codename}"`;
  const newSection = body.endsWith("\n") ? `${header}\n\n${body}` : `${header}\n\n${body}\n`;
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

export function bumpRegex(
  content: string,
  pattern: string,
  replace: string,
  version: string,
): string {
  const re = new RegExp(pattern);
  const m = re.exec(content);
  if (!m) {
    throw new Error(`bumpRegex: pattern did not match`);
  }
  const rendered = replace.replace(/\{version\}/g, version);
  return content.replace(re, rendered);
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
      if (!opts.codename || !opts.date || opts.changelogBody === undefined) {
        throw new Error("bumpFile: changelog kind requires codename, date, and changelogBody");
      }
      return bumpChangelog(content, opts.newVersion, opts.codename, opts.date, opts.changelogBody);
    case "regex":
      return bumpRegex(content, file.pattern!, file.replace!, opts.newVersion);
  }
}
