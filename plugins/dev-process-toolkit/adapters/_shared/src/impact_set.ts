// computeImpactSet — STE-71 deterministic extractor. Converts a diff
// (working-tree, staged, or range) into an `ImpactSet` naming exactly which
// code-level surfaces changed in four categories: symbols, routes,
// configKeys, stateEvents.
//
// Why deterministic: the M20 brainstorm duck council identified
// "LLM freeform inference over which doc fragment a given FR touches" as
// the biggest drift risk. Letting the LLM read the diff and decide
// produces orphan entries + silent drift. This module replaces inference
// with mechanical extraction — the LLM consumes the set verbatim at
// `/docs --quick` time (NFR-22 grounding invariant).
//
// No LLM calls, no network I/O (AC-STE-71.2). Reads: raw file snapshots
// (or `git` output when running in production mode), project source files
// for AST parsing, nothing else.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Project, SyntaxKind, type ExportedDeclarations } from "ts-morph";

export type Stack = "typescript" | "markdown" | "other";

export interface FileSnapshot {
  /** Project-root-relative path. */
  path: string;
  /** null = file was newly added. */
  before: string | null;
  /** null = file was deleted. */
  after: string | null;
}

export interface DiffInput {
  mode: "working-tree" | "staged" | "range";
  /** Required when `mode === "range"`; defaults to `HEAD` for the others. */
  baseRef?: string;
  headRef?: string;
  projectRoot: string;
  /**
   * Test escape hatch: when present, `computeImpactSet` skips git plumbing
   * and uses these snapshots directly. Production code paths pass
   * `mode` + `projectRoot` and let the extractor invoke `git`.
   */
  fileSnapshots?: FileSnapshot[];
  /** Skip stack detection; pin the stack for deterministic tests. */
  stackOverride?: Stack;
}

export interface SymbolChange {
  kind: "function" | "class" | "type" | "interface" | "const" | "enum";
  name: string;
  file: string;
  change: "added" | "modified" | "removed";
  visibility: "public" | "internal";
  /** SHA-256 over whitespace-normalized declaration text; empty when removed. */
  signatureHash: string;
}

export interface RouteChange {
  kind: "http" | "cli" | "rpc";
  path: string;
  method?: "get" | "post" | "put" | "delete" | "patch";
  file: string;
  change: "added" | "removed";
}

export interface ConfigKeyChange {
  file: string;
  /** JSON Pointer-ish path, e.g. `/scripts/build`. */
  keyPath: string;
  change: "added" | "modified" | "removed";
}

export interface StateEventChange {
  kind: "enum-value" | "action-type" | "case-branch";
  name: string;
  file: string;
  change: "added" | "removed";
}

export interface ImpactSet {
  symbols: SymbolChange[];
  routes: RouteChange[];
  configKeys: ConfigKeyChange[];
  stateEvents: StateEventChange[];
}

const JSON_CONFIG_FILES = new Set([
  "package.json",
  "plugin.json",
  ".claude-plugin/plugin.json",
  ".claude-plugin/marketplace.json",
  "tsconfig.json",
]);

/** Public entry. Production wrapper around `extractFromSnapshots` that
 * builds `FileSnapshot[]` from `git` when callers don't supply them. */
export function computeImpactSet(input: DiffInput): ImpactSet {
  const snapshots = input.fileSnapshots ?? collectSnapshotsFromGit(input);
  const stack = input.stackOverride ?? detectStack(input.projectRoot);
  return extractFromSnapshots(snapshots, stack);
}

/** Pure extractor — what unit tests call. */
export function extractFromSnapshots(snapshots: FileSnapshot[], stack: Stack): ImpactSet {
  const symbols: SymbolChange[] = [];
  const routes: RouteChange[] = [];
  const configKeys: ConfigKeyChange[] = [];
  const stateEvents: StateEventChange[] = [];

  for (const snap of snapshots) {
    const { path } = snap;
    // Symbols — only for TypeScript stack (AC-STE-71.3/.4).
    if (stack === "typescript" && (path.endsWith(".ts") || path.endsWith(".tsx"))) {
      symbols.push(...diffTypeScriptSymbols(snap));
      stateEvents.push(...diffEnumValues(snap));
    }
    // Routes + action-type + case-branch: scan any text-bearing file.
    routes.push(...diffRoutes(snap));
    stateEvents.push(...diffActionTypes(snap));
    stateEvents.push(...diffCaseBranches(snap));
    // Config keys: scan specific JSON files regardless of stack (AC covers
    // "added package.json script" independent of project stack).
    if (JSON_CONFIG_FILES.has(normalizeConfigPath(path))) {
      configKeys.push(...diffJsonKeys(snap));
    }
  }

  return {
    symbols: stableSort(symbols, symbolKey),
    routes: stableSort(routes, routeKey),
    configKeys: stableSort(configKeys, configKeyKey),
    stateEvents: stableSort(stateEvents, stateEventKey),
  };
}

/** AC-STE-71.5: retain only `visibility === "public"` symbols. */
export function filterPublicSymbols(set: ImpactSet): ImpactSet {
  return {
    ...set,
    symbols: set.symbols.filter((s) => s.visibility === "public"),
  };
}

/** AC-STE-71.6: empty when all four arrays are empty. */
export function isEmptyImpactSet(set: ImpactSet): boolean {
  return (
    set.symbols.length === 0 &&
    set.routes.length === 0 &&
    set.configKeys.length === 0 &&
    set.stateEvents.length === 0
  );
}

// --- Symbol extraction (ts-morph) -----------------------------------------

interface SymbolMeta {
  kind: SymbolChange["kind"];
  visibility: SymbolChange["visibility"];
  signatureHash: string;
}

function diffTypeScriptSymbols(snap: FileSnapshot): SymbolChange[] {
  const before = parseTypeScriptSymbols(snap.before, snap.path);
  const after = parseTypeScriptSymbols(snap.after, snap.path);

  const out: SymbolChange[] = [];
  const seen = new Set<string>();

  for (const [name, afterMeta] of after) {
    seen.add(name);
    const beforeMeta = before.get(name);
    if (!beforeMeta) {
      out.push({
        name,
        file: snap.path,
        kind: afterMeta.kind,
        visibility: afterMeta.visibility,
        change: "added",
        signatureHash: afterMeta.signatureHash,
      });
      continue;
    }
    if (beforeMeta.signatureHash !== afterMeta.signatureHash) {
      out.push({
        name,
        file: snap.path,
        kind: afterMeta.kind,
        visibility: afterMeta.visibility,
        change: "modified",
        signatureHash: afterMeta.signatureHash,
      });
    }
  }
  for (const [name, beforeMeta] of before) {
    if (seen.has(name)) continue;
    out.push({
      name,
      file: snap.path,
      kind: beforeMeta.kind,
      visibility: beforeMeta.visibility,
      change: "removed",
      signatureHash: "",
    });
  }
  return out;
}

function parseTypeScriptSymbols(
  source: string | null,
  relPath: string,
): Map<string, SymbolMeta> {
  const out = new Map<string, SymbolMeta>();
  if (source === null || source.trim() === "") return out;
  const project = new Project({ useInMemoryFileSystem: true, skipAddingFilesFromTsConfig: true });
  const sf = project.createSourceFile(`/virtual/${relPath}`, source);

  // Exported declarations — includes named + re-exports.
  for (const [name, decls] of sf.getExportedDeclarations()) {
    const decl = decls[0];
    if (!decl) continue;
    out.set(name, {
      kind: classifyKind(decl),
      visibility: "public",
      signatureHash: hashDeclaration(decl.getText()),
    });
  }
  // Internal (non-exported) top-level declarations — visibility=internal per
  // AC-STE-71.3 ("private symbols recorded with visibility: 'internal'").
  for (const fn of sf.getFunctions()) {
    const name = fn.getName();
    if (!name || fn.isExported()) continue;
    if (out.has(name)) continue;
    out.set(name, {
      kind: "function",
      visibility: "internal",
      signatureHash: hashDeclaration(fn.getText()),
    });
  }
  for (const cls of sf.getClasses()) {
    const name = cls.getName();
    if (!name || cls.isExported()) continue;
    if (out.has(name)) continue;
    out.set(name, {
      kind: "class",
      visibility: "internal",
      signatureHash: hashDeclaration(cls.getText()),
    });
  }
  for (const ta of sf.getTypeAliases()) {
    const name = ta.getName();
    if (ta.isExported() || out.has(name)) continue;
    out.set(name, {
      kind: "type",
      visibility: "internal",
      signatureHash: hashDeclaration(ta.getText()),
    });
  }
  for (const iface of sf.getInterfaces()) {
    const name = iface.getName();
    if (iface.isExported() || out.has(name)) continue;
    out.set(name, {
      kind: "interface",
      visibility: "internal",
      signatureHash: hashDeclaration(iface.getText()),
    });
  }
  for (const enm of sf.getEnums()) {
    const name = enm.getName();
    if (enm.isExported() || out.has(name)) continue;
    out.set(name, {
      kind: "enum",
      visibility: "internal",
      signatureHash: hashDeclaration(enm.getText()),
    });
  }
  return out;
}

function classifyKind(decl: ExportedDeclarations): SymbolChange["kind"] {
  const k = decl.getKind();
  if (k === SyntaxKind.FunctionDeclaration) return "function";
  if (k === SyntaxKind.ClassDeclaration) return "class";
  if (k === SyntaxKind.TypeAliasDeclaration) return "type";
  if (k === SyntaxKind.InterfaceDeclaration) return "interface";
  if (k === SyntaxKind.EnumDeclaration) return "enum";
  if (k === SyntaxKind.VariableDeclaration) return "const";
  return "const";
}

function hashDeclaration(text: string): string {
  // Strip block comments + whitespace so JSDoc edits don't mask as signature drift.
  const stripped = text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  return createHash("sha256").update(stripped).digest("hex");
}

// --- Enum-value extraction (feeds stateEvents) ----------------------------

function diffEnumValues(snap: FileSnapshot): StateEventChange[] {
  const before = enumMembers(snap.before, snap.path);
  const after = enumMembers(snap.after, snap.path);
  const out: StateEventChange[] = [];
  for (const key of after) {
    if (!before.has(key)) out.push({ kind: "enum-value", name: memberNameFromKey(key), file: snap.path, change: "added" });
  }
  for (const key of before) {
    if (!after.has(key)) out.push({ kind: "enum-value", name: memberNameFromKey(key), file: snap.path, change: "removed" });
  }
  return out;
}

// Enum keys are built as `${enumName}::${memberName}` by enumMembers. TypeScript
// identifiers cannot contain `::`, so splitting on the last occurrence is
// safe — but `lastIndexOf` guards against a future refactor that introduces
// a longer separator or a nested-namespace key.
function memberNameFromKey(key: string): string {
  const i = key.lastIndexOf("::");
  return i < 0 ? key : key.slice(i + 2);
}

function enumMembers(source: string | null, relPath: string): Set<string> {
  const out = new Set<string>();
  if (source === null || source.trim() === "") return out;
  const project = new Project({ useInMemoryFileSystem: true, skipAddingFilesFromTsConfig: true });
  const sf = project.createSourceFile(`/virtual/${relPath}`, source);
  for (const enm of sf.getEnums()) {
    const enumName = enm.getName();
    for (const m of enm.getMembers()) {
      out.add(`${enumName}::${m.getName()}`);
    }
  }
  return out;
}

// --- Route extraction (regex — deliberately conservative) -----------------

const HTTP_ROUTE_RE = /\b(?:app|router)\.(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]/g;
const CLI_ROUTE_RE = /\bcli(?:\.[A-Za-z_][A-Za-z0-9_]*)?\.command\s*\(\s*['"]([^'"]+)['"]/g;
const RPC_ROUTE_RE = /@(Get|Post|Put|Delete|Patch)\s*\(\s*['"]([^'"]+)['"]/g;

function diffRoutes(snap: FileSnapshot): RouteChange[] {
  const before = extractRoutes(snap.before, snap.path);
  const after = extractRoutes(snap.after, snap.path);
  const beforeKeys = new Set(before.map((r) => routeKey(r)));
  const afterKeys = new Set(after.map((r) => routeKey(r)));
  const out: RouteChange[] = [];
  for (const r of after) if (!beforeKeys.has(routeKey(r))) out.push({ ...r, change: "added" });
  for (const r of before) if (!afterKeys.has(routeKey(r))) out.push({ ...r, change: "removed" });
  return out;
}

function extractRoutes(source: string | null, path: string): Array<Omit<RouteChange, "change">> {
  const out: Array<Omit<RouteChange, "change">> = [];
  if (source === null) return out;
  for (const m of source.matchAll(HTTP_ROUTE_RE)) {
    out.push({ kind: "http", method: m[1] as RouteChange["method"], path: m[2], file: path });
  }
  for (const m of source.matchAll(CLI_ROUTE_RE)) {
    out.push({ kind: "cli", path: m[1], file: path });
  }
  for (const m of source.matchAll(RPC_ROUTE_RE)) {
    out.push({ kind: "rpc", method: m[1].toLowerCase() as RouteChange["method"], path: m[2], file: path });
  }
  return out;
}

// --- Config-key JSON diff -------------------------------------------------

function diffJsonKeys(snap: FileSnapshot): ConfigKeyChange[] {
  const before = parseJsonPaths(snap.before);
  const after = parseJsonPaths(snap.after);
  const out: ConfigKeyChange[] = [];
  const file = snap.path;
  for (const [path, afterVal] of after) {
    if (!before.has(path)) out.push({ file, keyPath: path, change: "added" });
    else if (JSON.stringify(before.get(path)) !== JSON.stringify(afterVal))
      out.push({ file, keyPath: path, change: "modified" });
  }
  for (const path of before.keys()) {
    if (!after.has(path)) out.push({ file, keyPath: path, change: "removed" });
  }
  return out;
}

function parseJsonPaths(source: string | null): Map<string, unknown> {
  const out = new Map<string, unknown>();
  if (source === null || source.trim() === "") return out;
  let root: unknown;
  try {
    root = JSON.parse(source);
  } catch {
    return out;
  }
  walkJson(root, "", out);
  return out;
}

function walkJson(node: unknown, prefix: string, acc: Map<string, unknown>): void {
  if (node === null || typeof node !== "object") {
    acc.set(prefix || "/", node);
    return;
  }
  if (Array.isArray(node)) {
    // Record the array itself as a leaf so reordering is detected — avoids
    // over-reporting each index as a path.
    acc.set(prefix || "/", node);
    return;
  }
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    const p = `${prefix}/${k.replace(/~/g, "~0").replace(/\//g, "~1")}`;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) walkJson(v, p, acc);
    else acc.set(p, v);
  }
}

// --- State-event extraction (action-type, case-branch) --------------------

const ACTION_TYPE_RE = /\{\s*type\s*:\s*['"]([^'"]+)['"]/g;
const CASE_BRANCH_RE = /case\s+['"]([^'"]+)['"]\s*:/g;

function diffActionTypes(snap: FileSnapshot): StateEventChange[] {
  return diffRegexSet(snap, ACTION_TYPE_RE, "action-type");
}

function diffCaseBranches(snap: FileSnapshot): StateEventChange[] {
  return diffRegexSet(snap, CASE_BRANCH_RE, "case-branch");
}

function diffRegexSet(
  snap: FileSnapshot,
  pattern: RegExp,
  kind: StateEventChange["kind"],
): StateEventChange[] {
  const before = uniqueMatches(snap.before, pattern);
  const after = uniqueMatches(snap.after, pattern);
  const out: StateEventChange[] = [];
  for (const name of after) {
    if (!before.has(name)) out.push({ kind, name, file: snap.path, change: "added" });
  }
  for (const name of before) {
    if (!after.has(name)) out.push({ kind, name, file: snap.path, change: "removed" });
  }
  return out;
}

function uniqueMatches(source: string | null, pattern: RegExp): Set<string> {
  const out = new Set<string>();
  if (source === null) return out;
  for (const m of source.matchAll(pattern)) {
    const value = m[1];
    if (value) out.add(value);
  }
  return out;
}

// --- git plumbing ---------------------------------------------------------

function collectSnapshotsFromGit(input: DiffInput): FileSnapshot[] {
  // Implemented only for the production path; unit tests pass
  // `fileSnapshots` directly. Synchronous shelling to `git` keeps the API
  // synchronous and avoids a top-level await in the extractor.
  const out: FileSnapshot[] = [];
  const cwd = input.projectRoot;
  const mode = input.mode;

  const baseRef = sanitizeGitRef(input.baseRef) ?? "HEAD~1";
  const headRef = sanitizeGitRef(input.headRef) ?? "HEAD";

  const args =
    mode === "staged"
      ? ["diff", "--name-status", "--cached"]
      : mode === "range"
        ? ["diff", "--name-status", `${baseRef}..${headRef}`]
        : ["diff", "--name-status", "HEAD"];

  const nameStatus = runGitSync(cwd, args);
  for (const line of nameStatus.trim().split("\n")) {
    if (!line) continue;
    const [status, ...rest] = line.split(/\s+/);
    const file = rest.join(" ");
    if (!file) continue;
    const before = readBefore(cwd, file, mode, input);
    const after = readAfter(cwd, file, mode, input, status);
    out.push({ path: file, before, after });
  }
  return out;
}

function readBefore(
  cwd: string,
  file: string,
  mode: DiffInput["mode"],
  input: DiffInput,
): string | null {
  // Before = HEAD (working-tree/staged) or baseRef (range).
  const ref = mode === "range" ? (sanitizeGitRef(input.baseRef) ?? "HEAD~1") : "HEAD";
  try {
    return runGitSync(cwd, ["show", `${ref}:${file}`]);
  } catch {
    return null;
  }
}

function readAfter(
  cwd: string,
  file: string,
  mode: DiffInput["mode"],
  input: DiffInput,
  status: string,
): string | null {
  if (status.startsWith("D")) return null;
  if (mode === "range") {
    const ref = sanitizeGitRef(input.headRef) ?? "HEAD";
    try {
      return runGitSync(cwd, ["show", `${ref}:${file}`]);
    } catch {
      return null;
    }
  }
  // working-tree + staged: read from filesystem (staged content differs but
  // for impact-set purposes we compare against HEAD; close enough for v1).
  const abs = join(cwd, file);
  if (!existsSync(abs)) return null;
  try {
    return readFileSync(abs, "utf8");
  } catch {
    return null;
  }
}

function runGitSync(cwd: string, args: string[]): string {
  // Bun provides synchronous spawn via `Bun.spawnSync`.
  const res = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (res.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} exit ${res.exitCode}: ${new TextDecoder().decode(res.stderr)}`);
  }
  return new TextDecoder().decode(res.stdout);
}

// Conservative ref validator: pass-through for git-valid refs (tags, branches,
// SHAs, `HEAD`, `HEAD~N`, `@{upstream}`), reject anything containing
// whitespace, `..`, or ref-separator characters that could cause the argv
// interpolation to produce a wrong git command. Returns null when the input
// is undefined OR fails validation — caller falls back to the default ref.
function sanitizeGitRef(ref: string | undefined): string | null {
  if (ref === undefined) return null;
  // Reject empty, whitespace, or `..` (range operator); allow SHA-hex,
  // kebab/slash branch names, `HEAD`, `HEAD~N`, `HEAD^`, `@{N}`, etc.
  // Reject leading `-` so a caller-supplied `--foo` can never be misread
  // as a git CLI flag when interpolated into `argv`.
  if (!/^[A-Za-z0-9_./@{}^~!-]+$/.test(ref)) return null;
  if (ref.startsWith("-")) return null;
  if (ref.includes("..")) return null;
  return ref;
}

// --- Stack detection ------------------------------------------------------

function detectStack(projectRoot: string): Stack {
  if (existsSync(join(projectRoot, "tsconfig.json"))) return "typescript";
  if (existsSync(join(projectRoot, "package.json"))) return "typescript";
  // No TS markers — return "other". ts-morph never runs; the regex-driven
  // route/config/state extractors still fire unconditionally (AC-STE-71.4).
  // The `Stack = "markdown"` value is a test/caller escape hatch: callers
  // that *know* their source is pure Markdown pass `stackOverride:"markdown"`
  // to express intent, but auto-detection deliberately never guesses
  // markdown — a bare `.md`-only directory is correctly classified as "other".
  return "other";
}

function normalizeConfigPath(p: string): string {
  return p.replace(/^\.\//, "");
}

// --- sorting --------------------------------------------------------------

function stableSort<T>(items: T[], key: (t: T) => string): T[] {
  return [...items].sort((a, b) => key(a).localeCompare(key(b)));
}

function symbolKey(s: SymbolChange): string {
  return `${s.file} ${s.kind} ${s.name} ${s.change}`;
}
function routeKey(r: { kind: string; method?: string; path: string; file: string }): string {
  return `${r.file} ${r.kind} ${r.method ?? ""} ${r.path}`;
}
function configKeyKey(c: ConfigKeyChange): string {
  return `${c.file} ${c.keyPath} ${c.change}`;
}
function stateEventKey(e: StateEventChange): string {
  return `${e.file} ${e.kind} ${e.name} ${e.change}`;
}
