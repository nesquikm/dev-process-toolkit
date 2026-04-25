// STE-103: dart-analyzer strategy tests for signature_extractor.ts.
// AC-STE-103.1/.4/.5/.6/.7/.8 — happy path against the bundled fixtures plus
// the AC-STE-103.2 fallthrough branches (missing dart, pub get failure,
// invalid JSON, non-zero exit). Tests requiring real `dart` on PATH live
// under `describe.skipIf(!hasDart)` so machines without the SDK pass cleanly
// (AC-STE-103.8).

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DocsConfig } from "./docs_config";
import { extractSignatures, type SignatureGroundTruth } from "./signature_extractor";

const FIXTURE_ROOT = join(
  __dirname,
  "../../../tests/fixtures/signature-extraction-dart",
);

const bothModes: DocsConfig = {
  userFacingMode: true,
  packagesMode: true,
  changelogCiOwned: false,
};

const hasDart = (() => {
  try {
    const r = Bun.spawnSync(["which", "dart"], { stdout: "pipe", stderr: "pipe" });
    return r.exitCode === 0;
  } catch {
    return false;
  }
})();

let work: string;
beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "dpt-sig-dart-"));
});
afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

// The Dart VM + analyzer cold-start pushes the helper past Bun's 5 s default
// test timeout, so the happy-path suite extracts ONCE in beforeAll and shares
// the result across assertions. Each negative test (which uses stubbed dart
// binaries with no VM cost) keeps its per-test tempdir.
describe.skipIf(!hasDart)("extractSignatures dart-analyzer — AC-STE-103.4/.5/.6/.7 happy path", () => {
  let ground: SignatureGroundTruth;

  beforeAll(() => {
    ground = extractSignatures(FIXTURE_ROOT, bothModes, { typedocBinary: null });
  }, 60_000);

  test("AC-STE-103.3 — pubspec.yaml stack yields strategy='dart-analyzer'", () => {
    expect(ground.strategy).toBe("dart-analyzer");
  });

  test("AC-STE-103.4 — simple_function.dart yields 'add' function with docComment + verbatim signature", () => {
    const mod = ground.modules.find((m) => m.modulePath.endsWith("simple_function.dart"));
    expect(mod).toBeDefined();
    const add = mod!.exports.find((e) => e.name === "add");
    expect(add).toBeDefined();
    expect(add!.kind).toBe("function");
    expect(add!.signature).toContain("int add(int a, int b)");
    expect(add!.docComment ?? "").toContain("Add two integers");
    expect(add!.sourceLineStart).toBeGreaterThan(0);
    expect(add!.sourceLineEnd).toBeGreaterThanOrEqual(add!.sourceLineStart);
  });

  test("AC-STE-103.4 — generic_class.dart yields 'Container' class with generic parameter preserved", () => {
    const mod = ground.modules.find((m) => m.modulePath.endsWith("generic_class.dart"));
    const cls = mod!.exports.find((e) => e.name === "Container");
    expect(cls).toBeDefined();
    expect(cls!.kind).toBe("class");
    expect(cls!.signature).toContain("class Container<T extends Object>");
  });

  test("AC-STE-103.4 — enum_with_methods.dart yields 'Light' with kind='enum'", () => {
    const mod = ground.modules.find((m) => m.modulePath.endsWith("enum_with_methods.dart"));
    const light = mod!.exports.find((e) => e.name === "Light");
    expect(light).toBeDefined();
    expect(light!.kind).toBe("enum");
    expect(light!.signature).toContain("enum Light");
  });

  test("AC-STE-103.6 — private_helpers.dart filters _-prefixed declarations", () => {
    const mod = ground.modules.find((m) => m.modulePath.endsWith("private_helpers.dart"));
    const names = mod!.exports.map((e) => e.name);
    expect(names).toContain("hello");
    expect(names).not.toContain("_greet");
    expect(names).not.toContain("_PrivateThing");
  });

  test("AC-STE-103.4 — mixin Greeter and extension StringX both map to kind='class'", () => {
    const mod = ground.modules.find((m) => m.modulePath.endsWith("mixin_and_extension.dart"));
    const greeter = mod!.exports.find((e) => e.name === "Greeter");
    expect(greeter).toBeDefined();
    expect(greeter!.kind).toBe("class");
    expect(greeter!.signature).toContain("mixin Greeter");
    const sx = mod!.exports.find((e) => e.name === "StringX");
    expect(sx).toBeDefined();
    expect(sx!.kind).toBe("class");
    expect(sx!.signature).toContain("extension StringX on String");
  });

  test("AC-STE-103.5 — docComment normalization strips '/// ' per line", () => {
    const mod = ground.modules.find((m) => m.modulePath.endsWith("private_helpers.dart"));
    const hello = mod!.exports.find((e) => e.name === "hello");
    expect(hello!.docComment).toBe("Greet the world.");
    expect(hello!.docComment).not.toMatch(/^\/\//);
  });
});

describe("extractSignatures dart-analyzer — AC-STE-103.2 fallthrough branches", () => {
  test("missing dart on PATH (dartBinary: null) → regex-fallback + 'dart not found' warning", () => {
    const projectRoot = join(work, "dart-only");
    mkdirSync(join(projectRoot, "lib"), { recursive: true });
    writeFileSync(join(projectRoot, "pubspec.yaml"), `name: x\n`);
    writeFileSync(join(projectRoot, "lib/foo.dart"), `int foo() => 1;\n`);

    const ground = extractSignatures(projectRoot, bothModes, {
      typedocBinary: null,
      dartBinary: null,
    });
    expect(ground.strategy).toBe("regex-fallback");
    expect(ground.warnings.some((w) => w.includes("dart not found"))).toBe(true);
  });

  test("dart pub get failure → regex-fallback + 'pub get failed' warning", () => {
    const projectRoot = join(work, "dart-only");
    mkdirSync(join(projectRoot, "lib"), { recursive: true });
    writeFileSync(join(projectRoot, "pubspec.yaml"), `name: x\n`);
    writeFileSync(join(projectRoot, "lib/foo.dart"), `int foo() => 1;\n`);

    const stubBin = join(work, "dart-stub.sh");
    writeFileSync(
      stubBin,
      `#!/usr/bin/env bash
case "$1" in
  pub) echo "pub get exploded" 1>&2; exit 1 ;;
  run) echo "[]" ;;
  *) exit 1 ;;
esac
`,
    );
    chmodSync(stubBin, 0o755);

    // Helper dir without .dart_tool to force the pub get branch.
    const helperDir = join(work, "stub-helper");
    mkdirSync(helperDir, { recursive: true });
    writeFileSync(join(helperDir, "pubspec.yaml"), `name: stub\n`);

    const ground = extractSignatures(projectRoot, bothModes, {
      typedocBinary: null,
      dartBinary: stubBin,
      dartHelperDir: helperDir,
    });
    expect(ground.strategy).toBe("regex-fallback");
    expect(ground.warnings.some((w) => w.includes("dart pub get failed"))).toBe(true);
  });

  test("dart-analyzer prints invalid JSON → regex-fallback + 'invalid JSON' warning", () => {
    const projectRoot = join(work, "dart-only");
    mkdirSync(join(projectRoot, "lib"), { recursive: true });
    writeFileSync(join(projectRoot, "pubspec.yaml"), `name: x\n`);
    writeFileSync(join(projectRoot, "lib/foo.dart"), `int foo() => 1;\n`);

    const stubBin = join(work, "dart-stub.sh");
    writeFileSync(
      stubBin,
      `#!/usr/bin/env bash
case "$1" in
  pub) exit 0 ;;
  run) echo "this-is-not-json" ;;
  *) exit 1 ;;
esac
`,
    );
    chmodSync(stubBin, 0o755);

    // Helper dir already has .dart_tool to skip pub get.
    const helperDir = join(work, "stub-helper");
    mkdirSync(join(helperDir, ".dart_tool"), { recursive: true });
    writeFileSync(join(helperDir, "pubspec.yaml"), `name: stub\n`);

    const ground = extractSignatures(projectRoot, bothModes, {
      typedocBinary: null,
      dartBinary: stubBin,
      dartHelperDir: helperDir,
    });
    expect(ground.strategy).toBe("regex-fallback");
    expect(ground.warnings.some((w) => w.includes("invalid JSON"))).toBe(true);
  });

  test("dart-analyzer non-zero exit → regex-fallback + 'dart-analyzer exit' warning", () => {
    const projectRoot = join(work, "dart-only");
    mkdirSync(join(projectRoot, "lib"), { recursive: true });
    writeFileSync(join(projectRoot, "pubspec.yaml"), `name: x\n`);
    writeFileSync(join(projectRoot, "lib/foo.dart"), `int foo() => 1;\n`);

    const stubBin = join(work, "dart-stub.sh");
    writeFileSync(
      stubBin,
      `#!/usr/bin/env bash
case "$1" in
  pub) exit 0 ;;
  run) echo "boom" 1>&2; exit 5 ;;
  *) exit 1 ;;
esac
`,
    );
    chmodSync(stubBin, 0o755);

    const helperDir = join(work, "stub-helper");
    mkdirSync(join(helperDir, ".dart_tool"), { recursive: true });
    writeFileSync(join(helperDir, "pubspec.yaml"), `name: stub\n`);

    const ground = extractSignatures(projectRoot, bothModes, {
      typedocBinary: null,
      dartBinary: stubBin,
      dartHelperDir: helperDir,
    });
    expect(ground.strategy).toBe("regex-fallback");
    expect(ground.warnings.some((w) => w.includes("dart-analyzer exit"))).toBe(true);
  });
});

describe.skipIf(!hasDart)("extractSignatures dart-analyzer — AC-STE-103.8 empty lib/", () => {
  let emptyRoot: string;
  let emptyGround: SignatureGroundTruth;

  beforeAll(() => {
    emptyRoot = mkdtempSync(join(tmpdir(), "dpt-sig-dart-empty-"));
    mkdirSync(join(emptyRoot, "lib"), { recursive: true });
    writeFileSync(
      join(emptyRoot, "pubspec.yaml"),
      `name: empty\nenvironment:\n  sdk: ^3.0.0\n`,
    );
    emptyGround = extractSignatures(emptyRoot, bothModes, { typedocBinary: null });
  }, 60_000);

  afterAll(() => {
    rmSync(emptyRoot, { recursive: true, force: true });
  });

  test("dart project with no .dart sources yields strategy='dart-analyzer' + zero exports", () => {
    expect(emptyGround.strategy).toBe("dart-analyzer");
    const totalExports = emptyGround.modules.reduce((acc, m) => acc + m.exports.length, 0);
    expect(totalExports).toBe(0);
  });
});
