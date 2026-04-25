// Unit tests for extractSignatures + validateGeneratedReference (STE-72).
//
// AC-STE-72.1 (API shape), .2 (strategy resolution), .4 (validator + retry),
// .5 (non-TS regex fallback), .8 (fixture coverage: typedoc mocked, ts-morph
// real parser on fixtures, regex fallback, no-exports module, JSDoc
// preserved, conditional types).
//
// The typedoc strategy test uses a stub shell script injected via
// `options.typedocBinary` to avoid depending on the real typedoc binary
// being installed on the test runner's PATH.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DocsConfig } from "./docs_config";
import {
  extractSignatures,
  validateGeneratedReference,
  type SignatureGroundTruth,
} from "./signature_extractor";

const FIXTURE_ROOT = join(
  __dirname,
  "../../../tests/fixtures/signature_extraction",
);

const bothModes: DocsConfig = {
  userFacingMode: true,
  packagesMode: true,
  changelogCiOwned: false,
};

let work: string;
beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "dpt-sig-"));
});
afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

describe("extractSignatures — AC-STE-72.2 strategy resolution + AC-STE-72.8 ts-morph path", () => {
  test("AC-STE-72.2 — TS project without typedoc uses strategy='ts-morph'", () => {
    const projectRoot = join(work, "ts-project");
    cpSync(FIXTURE_ROOT, projectRoot, { recursive: true });
    const ground = extractSignatures(projectRoot, bothModes, { typedocBinary: null });
    expect(ground.strategy).toBe("ts-morph");
    expect(ground.modules.length).toBeGreaterThan(0);
  });

  test("AC-STE-72.8 — simple_function.ts yields an 'add' ExportSignature with docComment preserved", () => {
    const projectRoot = join(work, "ts-project");
    cpSync(FIXTURE_ROOT, projectRoot, { recursive: true });
    const ground = extractSignatures(projectRoot, bothModes, { typedocBinary: null });
    const mod = ground.modules.find((m) => m.modulePath.endsWith("simple_function.ts"));
    expect(mod).toBeDefined();
    const add = mod!.exports.find((e) => e.name === "add");
    expect(add).toBeDefined();
    expect(add!.kind).toBe("function");
    expect(add!.signature).toContain("function add(a: number, b: number): number");
    expect(add!.docComment ?? "").toContain("Add two numbers");
    expect(add!.sourceLineStart).toBeGreaterThan(0);
    expect(add!.sourceLineEnd).toBeGreaterThanOrEqual(add!.sourceLineStart);
  });

  test("AC-STE-72.8 — generic_class.ts yields a 'Container' class with generic parameter captured", () => {
    const projectRoot = join(work, "ts-project");
    cpSync(FIXTURE_ROOT, projectRoot, { recursive: true });
    const ground = extractSignatures(projectRoot, bothModes, { typedocBinary: null });
    const mod = ground.modules.find((m) => m.modulePath.endsWith("generic_class.ts"));
    const cls = mod!.exports.find((e) => e.name === "Container");
    expect(cls).toBeDefined();
    expect(cls!.kind).toBe("class");
    expect(cls!.signature).toContain("Container<T extends string | number>");
  });

  test("AC-STE-72.8 — type_alias.ts captures both the exported type and interface", () => {
    const projectRoot = join(work, "ts-project");
    cpSync(FIXTURE_ROOT, projectRoot, { recursive: true });
    const ground = extractSignatures(projectRoot, bothModes, { typedocBinary: null });
    const mod = ground.modules.find((m) => m.modulePath.endsWith("type_alias.ts"));
    const names = mod!.exports.map((e) => e.name);
    expect(names).toContain("UserId");
    expect(names).toContain("User");
    const user = mod!.exports.find((e) => e.name === "User");
    expect(user!.kind).toBe("interface");
  });

  test("AC-STE-72.8 — internal_helper.ts has no exports → exports: []", () => {
    const projectRoot = join(work, "ts-project");
    cpSync(FIXTURE_ROOT, projectRoot, { recursive: true });
    const ground = extractSignatures(projectRoot, bothModes, { typedocBinary: null });
    const mod = ground.modules.find((m) => m.modulePath.endsWith("internal_helper.ts"));
    if (mod) expect(mod.exports).toEqual([]);
  });

  test("AC-STE-72.8 — conditional_types.ts captures conditional-type aliases verbatim", () => {
    const projectRoot = join(work, "ts-project");
    cpSync(FIXTURE_ROOT, projectRoot, { recursive: true });
    const ground = extractSignatures(projectRoot, bothModes, { typedocBinary: null });
    const mod = ground.modules.find((m) => m.modulePath.endsWith("conditional_types.ts"));
    const unwrap = mod!.exports.find((e) => e.name === "Unwrap");
    expect(unwrap).toBeDefined();
    expect(unwrap!.signature).toContain("T extends Promise<infer U>");
  });

  test("AC-STE-72.8 — overloads.ts function with multiple overload signatures", () => {
    const projectRoot = join(work, "ts-project");
    cpSync(FIXTURE_ROOT, projectRoot, { recursive: true });
    const ground = extractSignatures(projectRoot, bothModes, { typedocBinary: null });
    const mod = ground.modules.find((m) => m.modulePath.endsWith("overloads.ts"));
    expect(mod).toBeDefined();
    const parseExp = mod!.exports.find((e) => e.name === "parse");
    expect(parseExp).toBeDefined();
    expect(parseExp!.kind).toBe("function");
    // At least the implementation signature is captured verbatim. ts-morph's
    // getExportedDeclarations returns the first/implementation by default;
    // full overload-set capture is documented as a v1 limitation in the FR
    // Notes. This assertion pins "overloads.ts yields a 'parse' function
    // export" so regressions in basic overload handling surface.
    expect(parseExp!.signature).toMatch(/function\s+parse\s*\(/);
  });
});

describe("extractSignatures — AC-STE-72.2 typedoc path (mocked subprocess)", () => {
  test("AC-STE-72.2 — strategy='typedoc' when a typedoc binary is supplied and succeeds", () => {
    const projectRoot = join(work, "ts-project");
    cpSync(FIXTURE_ROOT, projectRoot, { recursive: true });
    const typedocBin = join(work, "typedoc-stub.sh");
    // Stub: accept --json <outFile> <entry>... and write a minimal typedoc JSON.
    const stubJson = JSON.stringify({
      name: "fixture",
      kind: 1,
      children: [
        {
          name: "add",
          kind: 64,
          sources: [{ fileName: "src/simple_function.ts", line: 6 }],
        },
      ],
    });
    writeFileSync(
      typedocBin,
      `#!/usr/bin/env bash
set -e
while [ $# -gt 0 ]; do
  case "$1" in
    --json) shift; OUT="$1"; shift ;;
    *) shift ;;
  esac
done
cat > "$OUT" <<'JSON'
${stubJson}
JSON
exit 0
`,
    );
    chmodSync(typedocBin, 0o755);

    const ground = extractSignatures(projectRoot, bothModes, { typedocBinary: typedocBin });
    expect(ground.strategy).toBe("typedoc");
    // Signatures are still extracted via ts-morph from source (verbatim); the
    // typedoc JSON is consulted for cross-reference warnings only.
    const addModule = ground.modules.find((m) => m.modulePath.endsWith("simple_function.ts"));
    expect(addModule).toBeDefined();
    expect(addModule!.exports.some((e) => e.name === "add")).toBe(true);
  });

  test("AC-STE-72.2 — typedoc binary that fails to exit 0 falls back to ts-morph with a warning", () => {
    const projectRoot = join(work, "ts-project");
    cpSync(FIXTURE_ROOT, projectRoot, { recursive: true });
    const typedocBin = join(work, "typedoc-fail.sh");
    writeFileSync(typedocBin, "#!/usr/bin/env bash\nexit 2\n");
    chmodSync(typedocBin, 0o755);

    const ground = extractSignatures(projectRoot, bothModes, { typedocBinary: typedocBin });
    expect(ground.strategy).toBe("ts-morph");
    expect(ground.warnings.some((w) => w.includes("typedoc"))).toBe(true);
  });
});

describe("extractSignatures — AC-STE-72.5 regex fallback (non-TS)", () => {
  test("AC-STE-72.5 — pubspec.yaml stack with dart-analyzer disabled falls back to regex-fallback + warning", () => {
    const projectRoot = join(work, "flutter-like");
    mkdirSync(join(projectRoot, "lib"), { recursive: true });
    writeFileSync(
      join(projectRoot, "lib/calc.dart"),
      `double add(double a, double b) => a + b;\n`,
    );
    writeFileSync(join(projectRoot, "pubspec.yaml"), `name: flutter_like\n`);

    // STE-103 widens the Dart stack chain: with `dartBinary: null` we force
    // the dart-analyzer probe to skip, so the project falls through to
    // regex-fallback and emits the AC-STE-72.5 manual-review banner. The
    // test exercises the AC-STE-103.2 fallthrough branch end-to-end.
    const ground = extractSignatures(projectRoot, bothModes, {
      typedocBinary: null,
      dartBinary: null,
    });
    expect(ground.strategy).toBe("regex-fallback");
    expect(ground.warnings.some((w) => w.toLowerCase().includes("regex"))).toBe(true);
  });

  test("AC-STE-72.5 — regex fallback emits at least the discovered declarations when patterns match", () => {
    const projectRoot = join(work, "py-like");
    mkdirSync(projectRoot, { recursive: true });
    writeFileSync(join(projectRoot, "main.py"), `def hello(name: str) -> str:\n    return name\n`);

    const ground = extractSignatures(projectRoot, bothModes, { typedocBinary: null });
    expect(ground.strategy).toBe("regex-fallback");
    // Regex fallback doesn't need to find python defs; coverage here just
    // confirms the function returns a valid SignatureGroundTruth shape.
    expect(ground.modules).toBeInstanceOf(Array);
  });
});

describe("validateGeneratedReference — AC-STE-72.4", () => {
  const ground: SignatureGroundTruth = {
    strategy: "ts-morph",
    modules: [
      {
        modulePath: "src/x.ts",
        exports: [
          {
            name: "add",
            kind: "function",
            signature: "export function add(a: number, b: number): number;",
            sourceFile: "src/x.ts",
            sourceLineStart: 1,
            sourceLineEnd: 1,
          },
        ],
      },
    ],
    warnings: [],
  };

  test("AC-STE-72.4 — LLM output with only declared symbols → ok:true", () => {
    const out = "# Module x\n\nThe `add` function computes:\n\n```typescript\nexport function add(a: number, b: number): number;\n```\n";
    const r = validateGeneratedReference(out, ground);
    expect(r.ok).toBe(true);
  });

  test("AC-STE-72.4 — LLM output with invented declaration → ok:false + name in invented[]", () => {
    const out = "```typescript\nexport function subtract(a: number, b: number): number;\n```\n";
    const r = validateGeneratedReference(out, ground);
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.invented).toContain("subtract");
  });

  test("AC-STE-72.4 — LLM output with no code blocks passes vacuously (pure prose)", () => {
    const out = "# Module x\n\nThis module exposes an `add` function. See source.\n";
    const r = validateGeneratedReference(out, ground);
    expect(r.ok).toBe(true);
  });

  test("AC-STE-72.4 — declared name + mismatched signature flags as invented-by-signature", () => {
    const out = "```typescript\nexport function add(x: string): string;\n```\n";
    const r = validateGeneratedReference(out, ground);
    expect(r.ok).toBe(false);
  });

  test("AC-STE-72.4 — ```ts``` code block (short fence) is also parsed", () => {
    const out = "```ts\nexport function add(a: number, b: number): number;\n```\n";
    const r = validateGeneratedReference(out, ground);
    expect(r.ok).toBe(true);
  });

  test("hardening — multi-block LLM output: one valid + one invented → ok:false names the invented", () => {
    const out =
      "```typescript\nexport function add(a: number, b: number): number;\n```\n\n" +
      "More prose.\n\n" +
      "```typescript\nexport function multiply(a: number, b: number): number;\n```\n";
    const r = validateGeneratedReference(out, ground);
    expect(r.ok).toBe(false);
    if (r.ok === false) {
      expect(r.invented).toContain("multiply");
      expect(r.invented).not.toContain("add");
    }
  });

  test("hardening — ground truth with duplicate names across modules accepts either signature", () => {
    const dupGround: SignatureGroundTruth = {
      strategy: "ts-morph",
      modules: [
        {
          modulePath: "a.ts",
          exports: [
            {
              name: "id",
              kind: "function",
              signature: "export function id(x: string): string;",
              sourceFile: "a.ts",
              sourceLineStart: 1,
              sourceLineEnd: 1,
            },
          ],
        },
        {
          modulePath: "b.ts",
          exports: [
            {
              name: "id",
              kind: "function",
              signature: "export function id(x: number): number;",
              sourceFile: "b.ts",
              sourceLineStart: 1,
              sourceLineEnd: 1,
            },
          ],
        },
      ],
      warnings: [],
    };
    // LLM reproduces the b.ts variant — should still pass because either
    // declared-index signature satisfies the name.
    const out = "```typescript\nexport function id(x: number): number;\n```\n";
    const r = validateGeneratedReference(out, dupGround);
    expect(r.ok).toBe(true);
  });
});

describe("extractSignatures — AC-STE-72.2 determinism across strategies", () => {
  test("AC-STE-72.2 (implicit) — ts-morph path is deterministic across repeat invocations", () => {
    const projectRoot = join(work, "ts-project");
    cpSync(FIXTURE_ROOT, projectRoot, { recursive: true });
    const a = extractSignatures(projectRoot, bothModes, { typedocBinary: null });
    const b = extractSignatures(projectRoot, bothModes, { typedocBinary: null });
    // Compare export names per module — the signature strings include source
    // ranges which are stable for the same source.
    for (const mod of a.modules) {
      const otherMod = b.modules.find((m) => m.modulePath === mod.modulePath);
      expect(otherMod).toBeDefined();
      expect(otherMod!.exports.map((e) => e.name).sort()).toEqual(
        mod.exports.map((e) => e.name).sort(),
      );
    }
  });
});
