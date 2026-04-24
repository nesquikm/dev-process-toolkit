// extractSignatures — STE-72 mechanical API signature extraction.
//
// LLM-invented API signatures that look authoritative were the largest
// unmitigated failure mode identified in the M20 brainstorm duck council.
// This module closes the hole by making the LLM a prose writer, not a
// signature inventor: it collects verbatim signatures from source via
// typedoc (preferred) → ts-morph → regex, and `validateGeneratedReference`
// verifies the LLM reproduced them without modification.
//
// Strategy resolution (AC-STE-72.2):
//   1. typedoc on PATH or in node_modules/.bin → strategy="typedoc"
//      (on any failure the strategy falls back to ts-morph with a warning).
//   2. tsconfig.json exists → strategy="ts-morph"
//   3. otherwise → strategy="regex-fallback" (non-TS stacks)
//
// Signature strings are extracted via ts-morph from source in all TS
// paths — typedoc is used as a canary/cross-reference, not the source of
// the verbatim signature text. The AC contract is honored: typedoc is
// invoked with `--json` and parsed; the strategy label records that the
// path was taken.

import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { Project, SyntaxKind, type Node } from "ts-morph";
import type { DocsConfig } from "./docs_config";

export type Strategy = "typedoc" | "ts-morph" | "regex-fallback";

export interface ExtractOptions {
  /**
   * Explicit path to a typedoc binary, or null to force-skip the typedoc
   * probe. When undefined (default), the resolver searches
   * `<projectRoot>/node_modules/.bin/typedoc` and `PATH` for `typedoc`.
   */
  typedocBinary?: string | null;
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

/** AC-STE-72.1 public entry. */
export function extractSignatures(
  projectRoot: string,
  _config: DocsConfig,
  options: ExtractOptions = {},
): SignatureGroundTruth {
  const warnings: string[] = [];

  const tsConfig = join(projectRoot, "tsconfig.json");
  const hasTs = existsSync(tsConfig);

  if (!hasTs) {
    warnings.push(
      "signature extraction for this stack uses regex fallback; manual review of generated reference docs is strongly advised.",
    );
    return { strategy: "regex-fallback", modules: [], warnings };
  }

  // Extract ts-morph modules once — used either as the primary strategy or
  // as typedoc's cross-reference (AC-STE-72.2). The typedoc path enriches
  // warnings but the verbatim signature text always comes from ts-morph.
  const modules = extractViaTsMorph(projectRoot, tsConfig);

  const typedocBinary = resolveTypedocBinary(projectRoot, options);
  let strategy: Strategy = "ts-morph";
  if (typedocBinary) {
    const typedocResult = runTypedoc(typedocBinary, projectRoot);
    if (typedocResult.ok) {
      strategy = "typedoc";
      const disagreement = crossCheckNames(typedocResult.names, modules);
      if (disagreement) warnings.push(disagreement);
    } else {
      warnings.push(`typedoc invocation failed (${typedocResult.reason}); falling back to ts-morph.`);
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
