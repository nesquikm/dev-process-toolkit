// STE-737 (M_b2fdc0) — shared fixtures and NAMED legs for the signature
// extractor's subfolder search (AC-STE-737.1), the Rust warning (AC-STE-737.2)
// and the root-tsconfig no-change contract (AC-STE-737.3).
//
// Every leg takes an `extractSignatures` function and returns `null` when it
// holds, or a problem string when it does not. The main suite runs the legs
// against the shipped extractor; the mutation battery
// (m_b2fdc0-ste-737-mutation.test.ts) runs the SAME legs against a mutated
// copy, so "removing X turns a named test red" is measured on the legs the
// suite actually runs.
//
// The v3.3.0 baseline for AC-STE-737.3 is the extractor as it stood at the
// v3.3.0 release commit, read from git — not the working tree — so the
// comparison cannot become self-referential once this FR is committed.

import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { DocsConfig } from "../adapters/_shared/src/docs_config";
import type { ExtractOptions, SignatureGroundTruth } from "../adapters/_shared/src/signature_extractor";

export const PLUGIN_ROOT = join(import.meta.dir, "..");
export const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
export const EXTRACTOR_REL = "adapters/_shared/src/signature_extractor.ts";
/** The v3.3.0 release commit (`chore(release): v3.3.0`). */
export const V330_COMMIT = "fc4bb2b1f762939a9fb99c31329b58d8b3b9510a";
export const ROOT_FIXTURE = join(PLUGIN_ROOT, "tests", "fixtures", "signature_extraction");

export type Extract = (root: string, config: DocsConfig, options?: ExtractOptions) => SignatureGroundTruth;

export const CONFIG: DocsConfig = { userFacingMode: true, packagesMode: true, changelogCiOwned: false };

const temps: string[] = [];
export function tempDir(label: string): string {
  const d = mkdtempSync(join(tmpdir(), `ste737-${label}-`));
  temps.push(d);
  return d;
}
export function cleanupTemps(): void {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
}

function write(root: string, rel: string, body: string): void {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, body);
}

const TSCONFIG = JSON.stringify(
  {
    compilerOptions: { target: "ES2022", module: "ES2022", moduleResolution: "Bundler", strict: true, skipLibCheck: true },
    include: ["src/**/*"],
  },
  null,
  2,
);

/** A TS package at `<root>/<dir>` with one exported function `fnName` in src/lib.ts. */
export function tsPackage(root: string, dir: string, fnName: string): void {
  const base = dir === "" ? root : join(root, dir);
  write(base, "tsconfig.json", TSCONFIG);
  write(base, "src/lib.ts", `/** ${fnName} doc. */\nexport function ${fnName}(name: string): string {\n  return name;\n}\n`);
}

function git(args: string[]): string {
  const p = Bun.spawnSync(["git", "-C", REPO_ROOT, ...args], { stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${p.stderr.toString()}`);
  return p.stdout.toString();
}

/**
 * Import `extractSignatures` from a temporary copy of adapters/_shared/src.
 * `source` replaces signature_extractor.ts in the copy (a mutant or the v3.3.0
 * file); omitted, the copy is the shipped working-tree file. The copy resolves
 * `ts-morph` through a symlink to the repo's node_modules.
 */
export async function extractorFrom(label: string, source?: string): Promise<Extract> {
  const base = tempDir(`ext-${label}`);
  symlinkSync(join(REPO_ROOT, "node_modules"), join(base, "node_modules"));
  const root = join(base, "plugin");
  mkdirSync(join(root, "adapters", "_shared"), { recursive: true });
  cpSync(join(PLUGIN_ROOT, "adapters", "_shared", "src"), join(root, "adapters", "_shared", "src"), {
    recursive: true,
    dereference: true,
  });
  const target = join(root, EXTRACTOR_REL);
  if (source !== undefined) writeFileSync(target, source);
  const mod = (await import(target)) as { extractSignatures: Extract };
  return mod.extractSignatures;
}

export function shippedSource(): string {
  return readFileSync(join(PLUGIN_ROOT, EXTRACTOR_REL), "utf-8");
}

export function v330Source(): string {
  return git(["show", `${V330_COMMIT}:plugins/dev-process-toolkit/${EXTRACTOR_REL}`]);
}

/** A stub typedoc binary that writes a minimal JSON naming `add` (forces a cross-check warning on non-`add` trees). */
export function typedocStub(dir: string): string {
  const bin = join(dir, "typedoc-stub.sh");
  const json = JSON.stringify({ name: "fixture", kind: 1, children: [{ name: "add", kind: 64 }] });
  writeFileSync(
    bin,
    `#!/usr/bin/env bash\nset -e\nwhile [ $# -gt 0 ]; do\n  case "$1" in\n    --json) shift; OUT="$1"; shift ;;\n    *) shift ;;\n  esac\ndone\ncat > "$OUT" <<'JSON'\n${json}\nJSON\nexit 0\n`,
  );
  chmodSync(bin, 0o755);
  return bin;
}

const NO_TOOLS: ExtractOptions = { typedocBinary: null, dartBinary: null, griffeBinary: null };

function show(g: SignatureGroundTruth): string {
  return JSON.stringify({ strategy: g.strategy, modules: g.modules.map((m) => m.modulePath), warnings: g.warnings });
}

function isRustWarning(w: string): boolean {
  return w.includes("Rust") && w.includes("Cargo.toml") && /\bno\b[^.]*\bextractor/i.test(w);
}

// --- AC-STE-737.1 legs -----------------------------------------------------

export function subdirTsIsRead(extract: Extract): string | null {
  const root = join(tempDir("subdir"), "proj");
  tsPackage(root, "app", "greet");
  const g = extract(root, CONFIG, NO_TOOLS);
  if (g.strategy !== "ts-morph") return `expected strategy ts-morph for a tsconfig in app/, got ${show(g)}`;
  const mod = g.modules.find((m) => m.modulePath === "app/src/lib.ts");
  if (!mod) return `expected module "app/src/lib.ts" (root-relative), got ${show(g)}`;
  const greet = mod.exports.find((e) => e.name === "greet");
  if (!greet) return `expected export "greet" in app/src/lib.ts, got ${JSON.stringify(mod.exports.map((e) => e.name))}`;
  if (greet.kind !== "function" || !greet.signature.includes("function greet(name: string): string"))
    return `greet signature not verbatim: ${JSON.stringify(greet)}`;
  if (greet.sourceFile !== "app/src/lib.ts") return `expected sourceFile "app/src/lib.ts", got "${greet.sourceFile}"`;
  if (g.warnings.some((w) => w.includes("regex fallback"))) return `a read TS subfolder still reported the regex fallback: ${show(g)}`;
  return null;
}

export function subdirsReadInNameOrder(extract: Extract): string | null {
  const root = join(tempDir("two"), "proj");
  tsPackage(root, "zeta", "fromZeta");
  tsPackage(root, "alpha", "fromAlpha");
  const g = extract(root, CONFIG, NO_TOOLS);
  const paths = g.modules.map((m) => m.modulePath);
  const expected = ["alpha/src/lib.ts", "zeta/src/lib.ts"];
  if (JSON.stringify(paths) !== JSON.stringify(expected))
    return `expected both subfolders read in name order ${JSON.stringify(expected)}, got ${show(g)}`;
  const names = g.modules.flatMap((m) => m.exports.map((e) => e.name));
  if (JSON.stringify(names) !== JSON.stringify(["fromAlpha", "fromZeta"])) return `expected exports [fromAlpha, fromZeta], got ${JSON.stringify(names)}`;
  return null;
}

export function skipsNodeModulesAndDotDirs(extract: Extract): string | null {
  const root = join(tempDir("skip"), "proj");
  tsPackage(root, "node_modules", "fromNodeModules");
  tsPackage(root, ".cache", "fromDotDir");
  tsPackage(root, "web", "fromWeb");
  const g = extract(root, CONFIG, NO_TOOLS);
  const paths = g.modules.map((m) => m.modulePath);
  if (JSON.stringify(paths) !== JSON.stringify(["web/src/lib.ts"]))
    return `expected only web/src/lib.ts (node_modules and .cache skipped), got ${show(g)}`;
  return null;
}

export function onlySkippedDirsIsNoStack(extract: Extract): string | null {
  const root = join(tempDir("onlyskip"), "proj");
  tsPackage(root, "node_modules", "fromNodeModules");
  tsPackage(root, ".hidden", "fromDotDir");
  const g = extract(root, CONFIG, NO_TOOLS);
  if (g.strategy !== "regex-fallback" || g.modules.length !== 0)
    return `tsconfigs only under node_modules/ and a dot-directory must not count as a TS stack, got ${show(g)}`;
  return null;
}

export function onlyOneLevelDown(extract: Extract): string | null {
  const root = join(tempDir("deep"), "proj");
  tsPackage(root, "packages/deep", "fromDeep");
  const g = extract(root, CONFIG, NO_TOOLS);
  if (g.modules.length !== 0) return `a tsconfig two levels down must not be read, got ${show(g)}`;
  return null;
}

// --- AC-STE-737.2 legs -----------------------------------------------------

export function rustAtRootWarns(extract: Extract): string | null {
  const root = join(tempDir("rust-root"), "proj");
  write(root, "Cargo.toml", `[package]\nname = "crate_x"\nversion = "0.1.0"\n`);
  write(root, "src/lib.rs", `pub fn add(a: i32, b: i32) -> i32 { a + b }\n`);
  const g = extract(root, CONFIG, NO_TOOLS);
  if (g.strategy !== "regex-fallback") return `expected regex-fallback for a Rust project, got ${show(g)}`;
  if (g.modules.length !== 0) return `expected zero modules for a Rust project, got ${show(g)}`;
  if (!g.warnings.some(isRustWarning)) return `expected a warning naming Rust and Cargo.toml and saying no extractor covers it, got ${show(g)}`;
  return null;
}

export function rustOneLevelDownWarns(extract: Extract): string | null {
  const root = join(tempDir("rust-sub"), "proj");
  write(root, "engine/Cargo.toml", `[package]\nname = "engine"\nversion = "0.1.0"\n`);
  write(root, "engine/src/lib.rs", `pub fn run() {}\n`);
  const g = extract(root, CONFIG, NO_TOOLS);
  if (g.strategy !== "regex-fallback" || g.modules.length !== 0) return `expected regex-fallback with zero modules, got ${show(g)}`;
  if (!g.warnings.some(isRustWarning)) return `expected the Rust warning for engine/Cargo.toml, got ${show(g)}`;
  return null;
}

export function rustWithPythonDoesNotWarn(extract: Extract): string | null {
  const root = join(tempDir("rust-py"), "proj");
  write(root, "Cargo.toml", `[package]\nname = "mixed"\nversion = "0.1.0"\n`);
  write(root, "pyproject.toml", `[project]\nname = "mixed"\n`);
  const g = extract(root, CONFIG, NO_TOOLS);
  if (g.warnings.some((w) => w.includes("Cargo.toml") || w.includes("Rust")))
    return `a detected Python stack must suppress the Rust warning, got ${show(g)}`;
  return null;
}

export function bareProjectHasNoRustWarning(extract: Extract): string | null {
  const root = join(tempDir("bare"), "proj");
  write(root, "README.md", "# nothing here\n");
  const g = extract(root, CONFIG, NO_TOOLS);
  if (g.strategy !== "regex-fallback" || g.modules.length !== 0) return `expected regex-fallback with zero modules, got ${show(g)}`;
  if (g.warnings.some((w) => w.includes("Rust") || w.includes("Cargo.toml"))) return `no Cargo.toml, yet a Rust warning: ${show(g)}`;
  return null;
}

// --- AC-STE-737.3 legs (vs the v3.3.0 extractor) ---------------------------

export interface RootCase {
  name: string;
  build: (root: string) => void;
  typedoc: boolean;
}

export const ROOT_CASES: RootCase[] = [
  { name: "root tsconfig, ts-morph", build: (r) => cpSync(ROOT_FIXTURE, r, { recursive: true }), typedoc: false },
  { name: "root tsconfig, typedoc stub", build: (r) => cpSync(ROOT_FIXTURE, r, { recursive: true }), typedoc: true },
  {
    name: "root tsconfig plus a tsconfig in a subfolder",
    build: (r) => {
      cpSync(ROOT_FIXTURE, r, { recursive: true });
      tsPackage(r, "tools", "fromTools");
    },
    typedoc: false,
  },
  {
    name: "root tsconfig plus a Cargo.toml",
    build: (r) => {
      cpSync(ROOT_FIXTURE, r, { recursive: true });
      write(r, "Cargo.toml", `[package]\nname = "side"\nversion = "0.1.0"\n`);
    },
    typedoc: false,
  },
];

export function sameAsV330(extract: Extract, baseline: Extract, c: RootCase): string | null {
  const dir = tempDir("root");
  const root = join(dir, "proj");
  c.build(root);
  const opts: ExtractOptions = { ...NO_TOOLS, typedocBinary: c.typedoc ? typedocStub(dir) : null };
  const now = extract(root, CONFIG, opts);
  const then = baseline(root, CONFIG, opts);
  if (then.modules.length === 0) return `${c.name}: the v3.3.0 baseline read no modules (a broken baseline, not a comparison): ${show(then)}`;
  if (c.typedoc && then.strategy !== "typedoc") return `${c.name}: the typedoc stub did not run on the v3.3.0 baseline: ${show(then)}`;
  const a = JSON.stringify({ strategy: now.strategy, modules: now.modules, warnings: now.warnings });
  const b = JSON.stringify({ strategy: then.strategy, modules: then.modules, warnings: then.warnings });
  if (a !== b) return `${c.name}: result differs from v3.3.0\n  now:    ${show(now)}\n  v3.3.0: ${show(then)}`;
  return null;
}
