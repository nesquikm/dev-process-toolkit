// STE-104: griffe strategy tests for signature_extractor.ts.
// AC-STE-104.1/.2/.3/.4/.5/.6/.7/.8/.9 — happy path against the bundled
// Python fixtures plus the AC-STE-104.7 fallthrough branches (missing
// griffe, missing pkg metadata, invalid JSON, non-zero exit) using stub
// griffe binaries. Tests requiring a real `griffe` on PATH live under
// `describe.skipIf(!hasGriffe)` so machines without the tool pass cleanly
// (AC-STE-104.9).

import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DocsConfig } from "./docs_config";
import {
  extractSignatures,
  griffeJsonToModuleSignatures,
  type SignatureGroundTruth,
} from "./signature_extractor";

const FIXTURE_ROOT = join(
  __dirname,
  "../../../tests/fixtures/signature-extraction-python",
);

const bothModes: DocsConfig = {
  userFacingMode: true,
  packagesMode: true,
  changelogCiOwned: false,
};

const hasGriffe = (() => {
  try {
    const r = Bun.spawnSync(["which", "griffe"], { stdout: "pipe", stderr: "pipe" });
    return r.exitCode === 0;
  } catch {
    return false;
  }
})();

let work: string;
beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "dpt-sig-py-"));
});
afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

describe.skipIf(!hasGriffe)("extractSignatures griffe — AC-STE-104 happy path", () => {
  let ground: SignatureGroundTruth;

  beforeAll(() => {
    ground = extractSignatures(FIXTURE_ROOT, bothModes, { typedocBinary: null });
  }, 60_000);

  test("AC-STE-104.6 — pyproject.toml stack yields strategy='griffe'", () => {
    expect(ground.strategy).toBe("griffe");
  });

  test("AC-STE-104.5 — simple_function.py yields 'add' function with reconstructed signature + docstring", () => {
    const mod = ground.modules.find((m) => m.modulePath.endsWith("simple_function.py"));
    expect(mod).toBeDefined();
    const add = mod!.exports.find((e) => e.name === "add");
    expect(add).toBeDefined();
    expect(add!.kind).toBe("function");
    expect(add!.signature).toBe("def add(a: int, b: int) -> int:");
    expect(add!.docComment).toBe("Add two integers.");
    expect(add!.sourceLineStart).toBeGreaterThan(0);
    expect(add!.sourceLineEnd).toBeGreaterThanOrEqual(add!.sourceLineStart);
  });

  test("AC-STE-104.5 — Container dataclass yields kind='class' with Container signature", () => {
    const mod = ground.modules.find((m) => m.modulePath.endsWith("dataclass_with_methods.py"));
    const cls = mod!.exports.find((e) => e.name === "Container");
    expect(cls).toBeDefined();
    expect(cls!.kind).toBe("class");
    expect(cls!.signature).toMatch(/^class Container/);
    // Class members live inside the class — they are NOT separate exports.
    expect(mod!.exports.find((e) => e.name === "doubled")).toBeUndefined();
    expect(mod!.exports.find((e) => e.name === "value")).toBeUndefined();
  });

  test("AC-STE-104.2 — Enum subclass maps to kind='enum'", () => {
    const mod = ground.modules.find((m) => m.modulePath.endsWith("enum_module.py"));
    const light = mod!.exports.find((e) => e.name === "Light");
    expect(light).toBeDefined();
    expect(light!.kind).toBe("enum");
    expect(light!.signature).toContain("class Light");
    expect(light!.signature).toContain("Enum");
  });

  test("AC-STE-104.3 — private_helpers.py filters _-prefixed names but keeps 'hello'", () => {
    const mod = ground.modules.find((m) => m.modulePath.endsWith("private_helpers.py"));
    const names = mod!.exports.map((e) => e.name);
    expect(names).toContain("hello");
    expect(names).not.toContain("_greet");
    expect(names).not.toContain("_PrivateThing");
  });

  test("AC-STE-104.2 — Protocol subclass maps to kind='interface'", () => {
    const mod = ground.modules.find((m) => m.modulePath.endsWith("protocol_and_typealias.py"));
    const greeter = mod!.exports.find((e) => e.name === "Greeter");
    expect(greeter).toBeDefined();
    expect(greeter!.kind).toBe("interface");
  });

  test("AC-STE-104.2 — TypeAlias annotation maps to kind='type'", () => {
    const mod = ground.modules.find((m) => m.modulePath.endsWith("protocol_and_typealias.py"));
    const userId = mod!.exports.find((e) => e.name === "UserId");
    expect(userId).toBeDefined();
    expect(userId!.kind).toBe("type");
  });
});

describe("extractSignatures griffe — AC-STE-104.7 fallthrough branches", () => {
  test("missing griffe on PATH (griffeBinary: null) → regex-fallback + 'griffe not found' warning", () => {
    const projectRoot = join(work, "py-only");
    mkdirSync(projectRoot, { recursive: true });
    writeFileSync(join(projectRoot, "pyproject.toml"), `[project]\nname = "x"\n`);
    mkdirSync(join(projectRoot, "x"), { recursive: true });
    writeFileSync(join(projectRoot, "x/__init__.py"), `\n`);

    const ground = extractSignatures(projectRoot, bothModes, {
      typedocBinary: null,
      griffeBinary: null,
    });
    expect(ground.strategy).toBe("regex-fallback");
    expect(ground.warnings.some((w) => w.includes("griffe not found"))).toBe(true);
  });

  test("missing pyproject metadata + no __init__.py-bearing dir → 'could not derive package name' warning", () => {
    const projectRoot = join(work, "py-bare");
    mkdirSync(projectRoot, { recursive: true });
    // setup.cfg without [metadata] name; we still create one of the trigger
    // files so stacks.python flips true.
    writeFileSync(join(projectRoot, "setup.cfg"), `[options]\npackages = find:\n`);

    const stubBin = join(work, "griffe-stub.sh");
    writeFileSync(
      stubBin,
      `#!/usr/bin/env bash
echo "should not be invoked" 1>&2
exit 99
`,
    );
    chmodSync(stubBin, 0o755);

    const ground = extractSignatures(projectRoot, bothModes, {
      typedocBinary: null,
      griffeBinary: stubBin,
    });
    expect(ground.strategy).toBe("regex-fallback");
    expect(
      ground.warnings.some((w) => w.includes("could not derive package name")),
    ).toBe(true);
  });

  test("non-PEP 8 directory name with __init__.py is rejected by derivePackageName fallback", () => {
    // Defense against a hostile or accidental directory name reaching
    // `griffe dump <pkg>` argument array. The fallback only accepts
    // /^[A-Za-z_][A-Za-z0-9_]*$/ identifiers.
    const projectRoot = join(work, "py-hostile");
    mkdirSync(projectRoot, { recursive: true });
    writeFileSync(join(projectRoot, "setup.cfg"), `[options]\npackages = find:\n`);
    // A directory whose name contains a hyphen — valid on disk but invalid
    // as a Python package identifier; the helper must NOT accept it as the
    // pkg-name fallback.
    const hostileDir = join(projectRoot, "my-pkg");
    mkdirSync(hostileDir, { recursive: true });
    writeFileSync(join(hostileDir, "__init__.py"), `\n`);

    const stubBin = join(work, "griffe-stub.sh");
    writeFileSync(stubBin, `#!/usr/bin/env bash\necho "[]"\nexit 0\n`);
    chmodSync(stubBin, 0o755);

    const ground = extractSignatures(projectRoot, bothModes, {
      typedocBinary: null,
      griffeBinary: stubBin,
    });
    expect(ground.strategy).toBe("regex-fallback");
    expect(
      ground.warnings.some((w) => w.includes("could not derive package name")),
    ).toBe(true);
  });

  test("griffe prints invalid JSON → regex-fallback + 'invalid JSON' warning", () => {
    const projectRoot = join(work, "py-only");
    mkdirSync(projectRoot, { recursive: true });
    writeFileSync(join(projectRoot, "pyproject.toml"), `[project]\nname = "x"\n`);

    const stubBin = join(work, "griffe-stub.sh");
    writeFileSync(
      stubBin,
      `#!/usr/bin/env bash
echo "this-is-not-json"
exit 0
`,
    );
    chmodSync(stubBin, 0o755);

    const ground = extractSignatures(projectRoot, bothModes, {
      typedocBinary: null,
      griffeBinary: stubBin,
    });
    expect(ground.strategy).toBe("regex-fallback");
    expect(ground.warnings.some((w) => w.includes("invalid JSON"))).toBe(true);
  });

  test("griffe non-zero exit → regex-fallback + 'griffe exit' warning (stderr surfaced)", () => {
    const projectRoot = join(work, "py-only");
    mkdirSync(projectRoot, { recursive: true });
    writeFileSync(join(projectRoot, "pyproject.toml"), `[project]\nname = "x"\n`);

    const stubBin = join(work, "griffe-stub.sh");
    writeFileSync(
      stubBin,
      `#!/usr/bin/env bash
echo "could not import package" 1>&2
exit 1
`,
    );
    chmodSync(stubBin, 0o755);

    const ground = extractSignatures(projectRoot, bothModes, {
      typedocBinary: null,
      griffeBinary: stubBin,
    });
    expect(ground.strategy).toBe("regex-fallback");
    const griffeWarn = ground.warnings.find((w) => w.includes("griffe exit"));
    expect(griffeWarn).toBeDefined();
    expect(griffeWarn).toContain("could not import package");
  });
});

describe("griffeJsonToModuleSignatures translator — AC-STE-104.2 unit coverage", () => {
  // Translator is exported for unit-level coverage of the kind-mapping cases
  // independent of the griffe binary. Inputs mirror the shapes captured from
  // griffe 2.0 against fixture_pkg.

  test("Enum-subclass class node maps to kind='enum'", () => {
    const json = {
      pkg: {
        kind: "module",
        filepath: "/abs/pkg/m.py",
        members: {
          Light: {
            kind: "class",
            name: "Light",
            bases: [{ name: "Enum" }],
            lineno: 1,
            endlineno: 5,
          },
        },
      },
    };
    const out = griffeJsonToModuleSignatures(json, "/abs");
    expect(out).toHaveLength(1);
    const light = out[0]!.exports.find((e) => e.name === "Light");
    expect(light!.kind).toBe("enum");
  });

  test("Protocol-subclass class node maps to kind='interface'", () => {
    const json = {
      pkg: {
        kind: "module",
        filepath: "/abs/pkg/m.py",
        members: {
          Greeter: {
            kind: "class",
            name: "Greeter",
            bases: [{ name: "Protocol" }],
            lineno: 1,
            endlineno: 3,
          },
        },
      },
    };
    const out = griffeJsonToModuleSignatures(json, "/abs");
    const greeter = out[0]!.exports.find((e) => e.name === "Greeter");
    expect(greeter!.kind).toBe("interface");
  });

  test("attribute with TypeAlias annotation maps to kind='type'", () => {
    const json = {
      pkg: {
        kind: "module",
        filepath: "/abs/pkg/m.py",
        members: {
          UserId: {
            kind: "attribute",
            name: "UserId",
            annotation: { name: "TypeAlias" },
            value: { name: "int" },
            lineno: 1,
            endlineno: 1,
          },
        },
      },
    };
    const out = griffeJsonToModuleSignatures(json, "/abs");
    const ua = out[0]!.exports.find((e) => e.name === "UserId");
    expect(ua!.kind).toBe("type");
    expect(ua!.signature).toBe("UserId: TypeAlias = int");
  });

  test("PEP 695 type-alias kind maps to kind='type'", () => {
    const json = {
      pkg: {
        kind: "module",
        filepath: "/abs/pkg/m.py",
        members: {
          Vec: {
            kind: "type-alias",
            name: "Vec",
            value: { name: "list[int]" },
            lineno: 1,
            endlineno: 1,
          },
        },
      },
    };
    const out = griffeJsonToModuleSignatures(json, "/abs");
    const v = out[0]!.exports.find((e) => e.name === "Vec");
    expect(v!.kind).toBe("type");
    expect(v!.signature).toBe("type Vec = list[int]");
  });

  test("alias-kind nodes (imports) are dropped", () => {
    const json = {
      pkg: {
        kind: "module",
        filepath: "/abs/pkg/m.py",
        members: {
          dataclass: { kind: "alias", name: "dataclass", target_path: "dataclasses.dataclass" },
          Foo: {
            kind: "class",
            name: "Foo",
            bases: [],
            lineno: 1,
            endlineno: 2,
          },
        },
      },
    };
    const out = griffeJsonToModuleSignatures(json, "/abs");
    const names = out[0]!.exports.map((e) => e.name);
    expect(names).toContain("Foo");
    expect(names).not.toContain("dataclass");
  });

  test("nested module nodes recurse into their own ModuleSignatures entries", () => {
    const json = {
      pkg: {
        kind: "module",
        filepath: "/abs/pkg/__init__.py",
        members: {
          sub: {
            kind: "module",
            filepath: "/abs/pkg/sub.py",
            members: {
              foo: {
                kind: "function",
                name: "foo",
                parameters: [],
                returns: null,
                lineno: 1,
                endlineno: 1,
              },
            },
          },
        },
      },
    };
    const out = griffeJsonToModuleSignatures(json, "/abs");
    const subMod = out.find((m) => m.modulePath === "pkg/sub.py");
    expect(subMod).toBeDefined();
    expect(subMod!.exports.find((e) => e.name === "foo")).toBeDefined();
  });

  test("function reconstruction renders parameters and return annotation", () => {
    const json = {
      pkg: {
        kind: "module",
        filepath: "/abs/pkg/m.py",
        members: {
          add: {
            kind: "function",
            name: "add",
            parameters: [
              { name: "a", annotation: { name: "int" }, default: null },
              { name: "b", annotation: { name: "int" }, default: null },
            ],
            returns: { name: "int" },
            lineno: 1,
            endlineno: 2,
          },
        },
      },
    };
    const out = griffeJsonToModuleSignatures(json, "/abs");
    const add = out[0]!.exports.find((e) => e.name === "add");
    expect(add!.signature).toBe("def add(a: int, b: int) -> int:");
  });
});
