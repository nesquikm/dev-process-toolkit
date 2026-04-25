// extractSignatures — mechanical API signature extraction.
//
// LLM-invented API signatures that look authoritative were the largest
// unmitigated failure mode identified in the M20 brainstorm duck council
// (STE-72). This module closes the hole by making the LLM a prose writer,
// not a signature inventor: it collects verbatim signatures from source
// via per-stack chains, and `validateGeneratedReference` verifies the LLM
// reproduced them without modification.
//
// Stack-aware dispatch (AC-STE-103.3):
//   1. Detect every stack present at projectRoot (TS via tsconfig.json,
//      Dart via pubspec.yaml, Python via pyproject.toml/setup.py/setup.cfg).
//   2. Run each detected stack's chain and concatenate ModuleSignatures[].
//   3. Report `strategy` = the first-applied strategy that succeeded;
//      stacks whose preferred tool failed surface as warnings.
//   4. No stack detected → "regex-fallback" with the manual-review banner.
//
// Per-stack chains:
//   • TS:     typedoc (preferred, AC-STE-72.2) → ts-morph → regex-fallback
//   • Dart:   dart-analyzer via bundled helper (STE-103)  → regex-fallback
//   • Python: griffe (STE-104)                            → regex-fallback

import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { Project, SyntaxKind, type Node } from "ts-morph";
import type { DocsConfig } from "./docs_config";

export type Strategy = "typedoc" | "ts-morph" | "dart-analyzer" | "griffe" | "regex-fallback";

export interface ExtractOptions {
  /**
   * Explicit path to a typedoc binary, or null to force-skip the typedoc
   * probe. When undefined (default), the resolver searches
   * `<projectRoot>/node_modules/.bin/typedoc` and `PATH` for `typedoc`.
   */
  typedocBinary?: string | null;
  /**
   * Explicit path to a dart binary, or null to force-skip the dart-analyzer
   * strategy. When undefined (default), the resolver looks up `dart` on
   * `PATH`. Test injection point for the AC-STE-103.2 fallthrough cases.
   */
  dartBinary?: string | null;
  /**
   * Override for the bundled Dart helper directory. When undefined
   * (default), resolves to the sibling `dart/` next to this source file.
   */
  dartHelperDir?: string;
  /**
   * Explicit path to a griffe binary, or null to force-skip the griffe
   * strategy. When undefined (default), the resolver looks up `griffe` on
   * `PATH`. Test injection point for the AC-STE-104.7 fallthrough cases.
   */
  griffeBinary?: string | null;
}

export interface ExportSignature {
  name: string;
  kind: "function" | "class" | "type" | "interface" | "const" | "enum";
  /** Verbatim signature text as it appears in source (whitespace preserved). */
  signature: string;
  docComment?: string;
  sourceFile: string;
  sourceLineStart: number;
  sourceLineEnd: number;
}

export interface ModuleSignatures {
  /** Project-root-relative path, POSIX separators. */
  modulePath: string;
  exports: ExportSignature[];
}

export interface SignatureGroundTruth {
  strategy: Strategy;
  modules: ModuleSignatures[];
  warnings: string[];
}

/** AC-STE-72.1 / AC-STE-103.3 public entry — stack-aware dispatch. */
export function extractSignatures(
  projectRoot: string,
  _config: DocsConfig,
  options: ExtractOptions = {},
): SignatureGroundTruth {
  const warnings: string[] = [];
  const stacks = detectStacks(projectRoot);

  if (!stacks.ts && !stacks.dart && !stacks.python) {
    warnings.push(
      "signature extraction for this stack uses regex fallback; manual review of generated reference docs is strongly advised.",
    );
    return { strategy: "regex-fallback", modules: [], warnings };
  }

  let strategy: Strategy = "regex-fallback";
  let modules: ModuleSignatures[] = [];

  if (stacks.ts) {
    const ts = runTsChain(projectRoot, options);
    if (strategy === "regex-fallback") strategy = ts.strategy;
    modules = modules.concat(ts.modules);
    warnings.push(...ts.warnings);
  }

  if (stacks.dart) {
    const dart = extractViaDartAnalyzer(projectRoot, options);
    if (dart.ok) {
      if (strategy === "regex-fallback") strategy = "dart-analyzer";
      modules = modules.concat(dart.modules);
    } else {
      warnings.push(
        `dart-analyzer fell through to regex-fallback: ${dart.reason}; manual review advised.`,
      );
    }
  }

  if (stacks.python) {
    const py = extractViaGriffe(projectRoot, options);
    if (py.ok) {
      if (strategy === "regex-fallback") strategy = "griffe";
      modules = modules.concat(py.modules);
    } else {
      warnings.push(
        `griffe fell through to regex-fallback: ${py.reason}; manual review advised.`,
      );
    }
  }

  return { strategy, modules, warnings };
}

interface DetectedStacks {
  ts: boolean;
  dart: boolean;
  python: boolean;
}

function detectStacks(projectRoot: string): DetectedStacks {
  return {
    ts: existsSync(join(projectRoot, "tsconfig.json")),
    dart: existsSync(join(projectRoot, "pubspec.yaml")),
    python:
      existsSync(join(projectRoot, "pyproject.toml")) ||
      existsSync(join(projectRoot, "setup.py")) ||
      existsSync(join(projectRoot, "setup.cfg")),
  };
}

function runTsChain(
  projectRoot: string,
  options: ExtractOptions,
): { strategy: "typedoc" | "ts-morph"; modules: ModuleSignatures[]; warnings: string[] } {
  const tsConfig = join(projectRoot, "tsconfig.json");
  const modules = extractViaTsMorph(projectRoot, tsConfig);
  let strategy: "typedoc" | "ts-morph" = "ts-morph";
  const warnings: string[] = [];
  const typedocBinary = resolveTypedocBinary(projectRoot, options);
  if (typedocBinary) {
    const typedocResult = runTypedoc(typedocBinary, projectRoot);
    if (typedocResult.ok) {
      strategy = "typedoc";
      const disagreement = crossCheckNames(typedocResult.names, modules);
      if (disagreement) warnings.push(disagreement);
    } else {
      warnings.push(
        `typedoc invocation failed (${typedocResult.reason}); falling back to ts-morph.`,
      );
    }
  }
  return { strategy, modules, warnings };
}

// --- typedoc path ---------------------------------------------------------

function resolveTypedocBinary(projectRoot: string, options: ExtractOptions): string | null {
  if (options.typedocBinary === null) return null;
  if (typeof options.typedocBinary === "string" && options.typedocBinary.length > 0) {
    return existsSync(options.typedocBinary) ? options.typedocBinary : null;
  }
  // Auto-resolve: node_modules/.bin/typedoc first, then PATH.
  const local = join(projectRoot, "node_modules/.bin/typedoc");
  if (existsSync(local)) return local;
  // `which` resolves from ambient PATH; still gate on existsSync so a PATH
  // entry that points at a missing binary (stale shim, removed dependency)
  // doesn't cause `Bun.spawnSync` to throw downstream.
  const res = Bun.spawnSync(["which", "typedoc"], { stdout: "pipe", stderr: "pipe" });
  if (res.exitCode !== 0) return null;
  const resolved = new TextDecoder().decode(res.stdout).trim();
  if (!resolved || !existsSync(resolved)) return null;
  return resolved;
}

interface TypedocOk {
  ok: true;
  names: Set<string>;
}
interface TypedocFail {
  ok: false;
  reason: string;
}
type TypedocResult = TypedocOk | TypedocFail;

function runTypedoc(binary: string, projectRoot: string): TypedocResult {
  const work = mkdtempSync(join(tmpdir(), "dpt-typedoc-"));
  const outFile = join(work, "typedoc.json");
  try {
    const res = Bun.spawnSync([binary, "--json", outFile, projectRoot], {
      cwd: projectRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (res.exitCode !== 0) {
      return { ok: false, reason: `exit ${res.exitCode}` };
    }
    if (!existsSync(outFile)) {
      return { ok: false, reason: "no output file" };
    }
    const rawJson = readFileSync(outFile, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawJson);
    } catch {
      return { ok: false, reason: "output is not JSON" };
    }
    return { ok: true, names: collectTypedocNames(parsed) };
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  } finally {
    try {
      if (existsSync(outFile)) unlinkSync(outFile);
      rmSync(work, { recursive: true, force: true });
    } catch {
      /* ignore cleanup errors */
    }
  }
}

function collectTypedocNames(root: unknown): Set<string> {
  const out = new Set<string>();
  walkTypedoc(root, out);
  return out;
}
function walkTypedoc(node: unknown, acc: Set<string>): void {
  if (!node || typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  if (typeof obj.name === "string" && obj.name.length > 0 && obj.kind !== 1 /* project */) {
    acc.add(obj.name);
  }
  const children = obj.children;
  if (Array.isArray(children)) for (const c of children) walkTypedoc(c, acc);
  const sigs = obj.signatures;
  if (Array.isArray(sigs)) for (const s of sigs) walkTypedoc(s, acc);
}

function crossCheckNames(typedocNames: Set<string>, modules: ModuleSignatures[]): string | null {
  const tsMorphNames = new Set<string>();
  for (const mod of modules) {
    for (const exp of mod.exports) tsMorphNames.add(exp.name);
  }
  const missingInTsMorph: string[] = [];
  for (const n of typedocNames) if (!tsMorphNames.has(n)) missingInTsMorph.push(n);
  if (missingInTsMorph.length === 0) return null;
  return `typedoc reported ${missingInTsMorph.length} name(s) not found by ts-morph: ${missingInTsMorph.slice(0, 5).join(", ")}${missingInTsMorph.length > 5 ? "…" : ""}`;
}

// --- ts-morph path --------------------------------------------------------

function extractViaTsMorph(projectRoot: string, tsConfigPath: string): ModuleSignatures[] {
  let project: Project;
  try {
    project = new Project({ tsConfigFilePath: tsConfigPath, skipAddingFilesFromTsConfig: false });
  } catch {
    return [];
  }
  const out: ModuleSignatures[] = [];
  for (const sf of project.getSourceFiles()) {
    const rel = toPosixRelative(projectRoot, sf.getFilePath());
    if (rel.startsWith("node_modules/") || rel.includes("/node_modules/")) continue;
    const exports = sf.getExportedDeclarations();
    const exp: ExportSignature[] = [];
    for (const [name, decls] of exports) {
      const decl = decls[0];
      if (!decl) continue;
      const kind = classifyKind(decl);
      if (!kind) continue;
      exp.push({
        name,
        kind,
        signature: decl.getText(),
        docComment: extractJsDoc(decl),
        sourceFile: rel,
        sourceLineStart: decl.getStartLineNumber(),
        sourceLineEnd: decl.getEndLineNumber(),
      });
    }
    out.push({ modulePath: rel, exports: exp });
  }
  // Stable sort to keep output deterministic.
  out.sort((a, b) => a.modulePath.localeCompare(b.modulePath));
  for (const mod of out) {
    mod.exports.sort((a, b) => a.name.localeCompare(b.name));
  }
  return out;
}

function classifyKind(node: Node): ExportSignature["kind"] | null {
  const k = node.getKind();
  if (k === SyntaxKind.FunctionDeclaration) return "function";
  if (k === SyntaxKind.ClassDeclaration) return "class";
  if (k === SyntaxKind.TypeAliasDeclaration) return "type";
  if (k === SyntaxKind.InterfaceDeclaration) return "interface";
  if (k === SyntaxKind.EnumDeclaration) return "enum";
  if (k === SyntaxKind.VariableDeclaration) return "const";
  return null;
}

function extractJsDoc(node: Node): string | undefined {
  // ts-morph exposes `getJsDocs()` on supported nodes; not all ExportedDeclaration
  // types have it, so we bail safely when absent.
  const anyNode = node as unknown as {
    getJsDocs?: () => Array<{ getInnerText: () => string }>;
  };
  const docs = anyNode.getJsDocs?.();
  if (!docs || docs.length === 0) return undefined;
  return docs.map((d) => d.getInnerText()).join("\n").trim() || undefined;
}

function toPosixRelative(root: string, abs: string): string {
  return relative(root, abs).split(/[\\/]/).join("/");
}

// --- dart-analyzer path (STE-103) ----------------------------------------

interface DartOk {
  ok: true;
  modules: ModuleSignatures[];
}
interface DartFail {
  ok: false;
  reason: string;
}
type DartResult = DartOk | DartFail;

function resolveDartBinary(options: ExtractOptions): string | null {
  if (options.dartBinary === null) return null;
  if (typeof options.dartBinary === "string" && options.dartBinary.length > 0) {
    return existsSync(options.dartBinary) ? options.dartBinary : null;
  }
  const res = Bun.spawnSync(["which", "dart"], { stdout: "pipe", stderr: "pipe" });
  if (res.exitCode !== 0) return null;
  const resolved = new TextDecoder().decode(res.stdout).trim();
  if (!resolved || !existsSync(resolved)) return null;
  return resolved;
}

function defaultDartHelperDir(): string {
  return join(import.meta.dir, "..", "dart");
}

function extractViaDartAnalyzer(projectRoot: string, options: ExtractOptions): DartResult {
  const dartBin = resolveDartBinary(options);
  if (!dartBin) return { ok: false, reason: "dart not found on PATH" };
  const helperDir = options.dartHelperDir ?? defaultDartHelperDir();
  if (!existsSync(helperDir)) {
    return { ok: false, reason: `dart helper missing: ${helperDir}` };
  }

  if (!existsSync(join(helperDir, ".dart_tool"))) {
    const pg = Bun.spawnSync([dartBin, "pub", "get"], {
      cwd: helperDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (pg.exitCode !== 0) {
      const err = new TextDecoder().decode(pg.stderr).trim();
      return { ok: false, reason: `dart pub get failed (exit ${pg.exitCode}): ${err}` };
    }
  }

  const res = Bun.spawnSync([dartBin, "run", "extract_signatures.dart", projectRoot], {
    cwd: helperDir,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (res.exitCode !== 0) {
    const err = new TextDecoder().decode(res.stderr).trim();
    return { ok: false, reason: `dart-analyzer exit ${res.exitCode}: ${err}` };
  }
  const out = new TextDecoder().decode(res.stdout).trim();
  if (!out) return { ok: false, reason: "empty stdout from dart-analyzer" };
  try {
    const parsed = JSON.parse(out) as ModuleSignatures[];
    return { ok: true, modules: parsed };
  } catch (e) {
    return { ok: false, reason: `invalid JSON from dart-analyzer: ${(e as Error).message}` };
  }
}

// --- griffe path (STE-104) -----------------------------------------------

interface GriffeOk {
  ok: true;
  modules: ModuleSignatures[];
}
interface GriffeFail {
  ok: false;
  reason: string;
}
type GriffeResult = GriffeOk | GriffeFail;

function resolveGriffeBinary(options: ExtractOptions): string | null {
  if (options.griffeBinary === null) return null;
  if (typeof options.griffeBinary === "string" && options.griffeBinary.length > 0) {
    return existsSync(options.griffeBinary) ? options.griffeBinary : null;
  }
  const res = Bun.spawnSync(["which", "griffe"], { stdout: "pipe", stderr: "pipe" });
  if (res.exitCode !== 0) return null;
  const resolved = new TextDecoder().decode(res.stdout).trim();
  if (!resolved || !existsSync(resolved)) return null;
  return resolved;
}

function extractViaGriffe(projectRoot: string, options: ExtractOptions): GriffeResult {
  const griffeBin = resolveGriffeBinary(options);
  if (!griffeBin) return { ok: false, reason: "griffe not found on PATH" };
  const pkgName = derivePackageName(projectRoot);
  if (!pkgName) {
    return {
      ok: false,
      reason:
        "could not derive package name (checked pyproject.toml, setup.cfg, setup.py, top-level __init__.py)",
    };
  }
  const res = Bun.spawnSync([griffeBin, "dump", pkgName], {
    cwd: projectRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (res.exitCode !== 0) {
    const err = new TextDecoder().decode(res.stderr).trim();
    return { ok: false, reason: `griffe exit ${res.exitCode}: ${err}` };
  }
  const out = new TextDecoder().decode(res.stdout).trim();
  if (!out) return { ok: false, reason: "empty stdout from griffe" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(out);
  } catch (e) {
    return { ok: false, reason: `invalid JSON from griffe: ${(e as Error).message}` };
  }
  return { ok: true, modules: griffeJsonToModuleSignatures(parsed, projectRoot) };
}

function derivePackageName(projectRoot: string): string | null {
  const pyproject = join(projectRoot, "pyproject.toml");
  if (existsSync(pyproject)) {
    const content = readFileSync(pyproject, "utf8");
    const projName = extractTomlSectionName(content, "project");
    if (projName) return projName;
    const poetryName = extractTomlSectionName(content, "tool.poetry");
    if (poetryName) return poetryName;
  }
  const setupCfg = join(projectRoot, "setup.cfg");
  if (existsSync(setupCfg)) {
    const content = readFileSync(setupCfg, "utf8");
    const cfgName = extractCfgMetadataName(content);
    if (cfgName) return cfgName;
  }
  const setupPy = join(projectRoot, "setup.py");
  if (existsSync(setupPy)) {
    const content = readFileSync(setupPy, "utf8");
    const m = content.match(/setup\s*\([^)]*\bname\s*=\s*['"]([^'"]+)['"]/);
    if (m) return m[1] ?? null;
  }
  // Fallback: first __init__.py-bearing dir under projectRoot or src/
  const candidates = [projectRoot, join(projectRoot, "src")];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    let entries: string[] = [];
    try {
      entries = readdirSync(candidate);
    } catch {
      continue;
    }
    entries.sort();
    for (const entry of entries) {
      const sub = join(candidate, entry);
      try {
        const stat = statSync(sub);
        if (!stat.isDirectory()) continue;
      } catch {
        continue;
      }
      if (existsSync(join(sub, "__init__.py"))) return entry;
    }
  }
  return null;
}

function extractTomlSectionName(content: string, section: string): string | null {
  const escaped = section.replace(/\./g, "\\.");
  const re = new RegExp(`^\\[${escaped}\\][^\\[]*?^\\s*name\\s*=\\s*['"]([^'"]+)['"]`, "ms");
  const m = re.exec(content);
  return m && m[1] ? m[1] : null;
}

function extractCfgMetadataName(content: string): string | null {
  const re = /^\[metadata\][^\[]*?^\s*name\s*=\s*([^\n]+)$/ms;
  const m = re.exec(content);
  return m && m[1] ? m[1].trim() : null;
}

/**
 * Translate griffe's recursive `module → members` JSON tree into the flat
 * `ModuleSignatures[]` shape (Schema Z). One ModuleSignatures entry per
 * module-kind node; each module's function/class/attribute children become
 * ExportSignatures. Class members live inside the class signature
 * (mirroring TS-side handling) — they are not flattened to top-level
 * (AC-STE-104.2).
 */
export function griffeJsonToModuleSignatures(
  json: unknown,
  projectRoot: string,
): ModuleSignatures[] {
  const modules: ModuleSignatures[] = [];
  if (json && typeof json === "object" && !Array.isArray(json)) {
    for (const root of Object.values(json as Record<string, unknown>)) {
      walkGriffeModule(root, projectRoot, modules);
    }
  }
  modules.sort((a, b) => a.modulePath.localeCompare(b.modulePath));
  return modules;
}

function walkGriffeModule(
  node: unknown,
  projectRoot: string,
  modules: ModuleSignatures[],
): void {
  if (!isPlainObject(node)) return;
  if (node.kind !== "module") return;
  const exports: ExportSignature[] = [];
  const members = isPlainObject(node.members) ? node.members : {};
  const filepath = typeof node.filepath === "string" ? node.filepath : "";
  for (const [memberName, child] of Object.entries(members)) {
    if (!isPlainObject(child)) continue;
    if (child.kind === "module") {
      walkGriffeModule(child, projectRoot, modules);
      continue;
    }
    if (child.kind === "alias") continue;
    if (isPrivatePythonName(memberName)) continue;
    const exp = griffeNodeToExport(child, memberName, filepath, projectRoot);
    if (exp) exports.push(exp);
  }
  exports.sort((a, b) => a.name.localeCompare(b.name));
  const modulePath = filepath
    ? toPosixRelative(projectRoot, filepath)
    : typeof node.name === "string"
      ? node.name
      : "";
  if (modulePath) modules.push({ modulePath, exports });
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isPrivatePythonName(name: string): boolean {
  if (!name.startsWith("_")) return false;
  if (name.startsWith("__") && name.endsWith("__")) return false;
  return true;
}

function griffeNodeToExport(
  node: Record<string, unknown>,
  name: string,
  modulePath: string,
  projectRoot: string,
): ExportSignature | null {
  const kind = mapGriffeKind(node);
  if (!kind) return null;
  const signature = reconstructPythonSignature(node, name);
  const docstring = isPlainObject(node.docstring) ? node.docstring : undefined;
  const docComment =
    docstring && typeof docstring.value === "string" ? docstring.value : undefined;
  const lineno = typeof node.lineno === "number" ? node.lineno : 1;
  const endlineno = typeof node.endlineno === "number" ? node.endlineno : lineno;
  return {
    name,
    kind,
    signature,
    docComment,
    sourceFile: modulePath ? toPosixRelative(projectRoot, modulePath) : "",
    sourceLineStart: lineno,
    sourceLineEnd: endlineno,
  };
}

function mapGriffeKind(node: Record<string, unknown>): ExportSignature["kind"] | null {
  const k = node.kind;
  if (k === "function") return "function";
  if (k === "class") {
    const baseNames = griffeBaseNames(node);
    if (
      baseNames.some(
        (n) => n === "Enum" || n === "IntEnum" || n === "Flag" || n === "IntFlag" || n === "StrEnum",
      )
    ) {
      return "enum";
    }
    if (baseNames.some((n) => n === "Protocol")) return "interface";
    return "class";
  }
  if (k === "attribute") {
    const ann = isPlainObject(node.annotation) ? node.annotation : undefined;
    if (ann && ann.name === "TypeAlias") return "type";
    return "const";
  }
  if (k === "type-alias") return "type";
  return null;
}

function griffeBaseNames(node: Record<string, unknown>): string[] {
  const bases = Array.isArray(node.bases) ? node.bases : [];
  const names: string[] = [];
  for (const b of bases) {
    if (isPlainObject(b) && typeof b.name === "string") names.push(b.name);
  }
  return names;
}

function reconstructPythonSignature(node: Record<string, unknown>, name: string): string {
  const k = node.kind;
  if (k === "function") {
    const params = Array.isArray(node.parameters) ? node.parameters : [];
    const paramStrs: string[] = [];
    for (const p of params) {
      if (!isPlainObject(p)) continue;
      paramStrs.push(formatParam(p));
    }
    const ret = formatExpr(node.returns);
    return `def ${name}(${paramStrs.join(", ")})${ret ? ` -> ${ret}` : ""}:`;
  }
  if (k === "class") {
    const bases = Array.isArray(node.bases) ? node.bases : [];
    const baseStrs = bases.map((b) => formatExpr(b)).filter((s) => s.length > 0);
    return `class ${name}${baseStrs.length > 0 ? `(${baseStrs.join(", ")})` : ""}:`;
  }
  if (k === "attribute") {
    const ann = formatExpr(node.annotation);
    const value = node.value !== undefined ? formatExpr(node.value) : "";
    let s = name;
    if (ann) s += `: ${ann}`;
    if (value) s += ` = ${value}`;
    return s;
  }
  if (k === "type-alias") {
    const value = formatExpr((node as Record<string, unknown>).value);
    return `type ${name}${value ? ` = ${value}` : ""}`;
  }
  return name;
}

function formatExpr(expr: unknown): string {
  if (expr == null) return "";
  if (typeof expr === "string") return expr;
  if (isPlainObject(expr) && typeof expr.name === "string") return expr.name;
  return "";
}

function formatParam(p: Record<string, unknown>): string {
  const name = typeof p.name === "string" ? p.name : "";
  const ann = formatExpr(p.annotation);
  let s = name;
  if (ann) s += `: ${ann}`;
  if (p.default !== null && p.default !== undefined) {
    const def = formatExpr(p.default);
    if (def) s += ` = ${def}`;
  }
  return s;
}

// --- Validator (AC-STE-72.4) ---------------------------------------------

export type ValidatorResult =
  | { ok: true }
  | { ok: false; invented: string[] };

const TS_FENCE_RE = /```(?:typescript|ts)\s*\n([\s\S]*?)```/g;
const DECLARATION_RE =
  /(?:export\s+)?(?:declare\s+)?(function\*?|class|type|interface|const|let|var|enum)\s+([A-Za-z_][A-Za-z0-9_]*)/g;

/** Parse the LLM output's TS code blocks and verify every declared name
 *  appears in `ground` with a whitespace-normalized signature match. */
export function validateGeneratedReference(
  llmOutput: string,
  ground: SignatureGroundTruth,
): ValidatorResult {
  const declaredIndex = new Map<string, Set<string>>();
  for (const mod of ground.modules) {
    for (const exp of mod.exports) {
      const set = declaredIndex.get(exp.name) ?? new Set<string>();
      set.add(normalizeSignature(exp.signature));
      declaredIndex.set(exp.name, set);
    }
  }
  const invented: string[] = [];
  const seenInvented = new Set<string>();
  TS_FENCE_RE.lastIndex = 0;
  for (const fenceMatch of llmOutput.matchAll(TS_FENCE_RE)) {
    const block = fenceMatch[1] ?? "";
    for (const declMatch of block.matchAll(DECLARATION_RE)) {
      const name = declMatch[2];
      if (!name) continue;
      const groundSet = declaredIndex.get(name);
      if (!groundSet) {
        recordInvented(invented, seenInvented, name);
        continue;
      }
      const sigLine = extractSignatureForName(block, name);
      if (!sigLine) continue;
      const norm = normalizeSignature(sigLine);
      let match = false;
      for (const expected of groundSet) {
        if (expected === norm || norm.includes(expected) || expected.includes(norm)) {
          match = true;
          break;
        }
      }
      if (!match) recordInvented(invented, seenInvented, name);
    }
  }
  return invented.length === 0 ? { ok: true } : { ok: false, invented };
}

function recordInvented(list: string[], seen: Set<string>, name: string): void {
  if (seen.has(name)) return;
  seen.add(name);
  list.push(name);
}

function extractSignatureForName(block: string, name: string): string | null {
  const lines = block.split(/\r?\n/);
  for (const line of lines) {
    if (
      new RegExp(
        `(?:^|\\s)(?:export\\s+)?(?:declare\\s+)?(?:function\\*?|class|type|interface|const|let|var|enum)\\s+${escapeRegex(name)}\\b`,
      ).test(line)
    ) {
      return line;
    }
  }
  return null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeSignature(sig: string): string {
  return sig.replace(/\s+/g, " ").trim().replace(/;\s*$/, "");
}
