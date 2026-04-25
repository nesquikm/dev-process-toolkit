// STE-105: toolchain_probe unit tests covering the AC-STE-105.4 detection
// matrix. Tests inject a `pathLookup` mock so they're hermetic against the
// developer machine's PATH state.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { preferredFromStatus, probeToolchains } from "./toolchain_probe";

let work: string;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "dpt-tcp-"));
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

function makeStub(path: string, body: string): void {
  writeFileSync(path, `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(path, 0o755);
}

describe("probeToolchains — AC-STE-105.4 detection logic", () => {
  test("all PATH lookups null and no node_modules → ts.typedoc=false, dart=false, griffe=false, tsMorph=true", () => {
    const status = probeToolchains(work, { pathLookup: () => null });
    expect(status).toEqual({
      ts: { typedoc: false, tsMorph: true },
      dart: { dartSdk: false },
      python: { griffe: false },
    });
  });

  test("typedoc present in node_modules/.bin → ts.typedoc=true even when PATH lookup misses", () => {
    mkdirSync(join(work, "node_modules/.bin"), { recursive: true });
    writeFileSync(join(work, "node_modules/.bin/typedoc"), "#!/bin/sh\nexit 0\n");
    chmodSync(join(work, "node_modules/.bin/typedoc"), 0o755);

    const status = probeToolchains(work, { pathLookup: () => null });
    expect(status.ts.typedoc).toBe(true);
  });

  test("typedoc on PATH → ts.typedoc=true even without node_modules", () => {
    const stub = join(work, "typedoc-stub");
    makeStub(stub, "exit 0");
    const status = probeToolchains(work, {
      pathLookup: (tool) => (tool === "typedoc" ? stub : null),
    });
    expect(status.ts.typedoc).toBe(true);
  });

  test("dart resolved + --version emits output → dart.dartSdk=true", () => {
    const dartStub = join(work, "dart-stub");
    makeStub(dartStub, "echo 'Dart SDK version: 3.11.4 (stable) on macos_arm64'");
    const status = probeToolchains(work, {
      pathLookup: (tool) => (tool === "dart" ? dartStub : null),
    });
    expect(status.dart.dartSdk).toBe(true);
  });

  test("dart resolved but --version exits non-zero → dart.dartSdk=false", () => {
    const dartStub = join(work, "dart-stub");
    makeStub(dartStub, "exit 1");
    const status = probeToolchains(work, {
      pathLookup: (tool) => (tool === "dart" ? dartStub : null),
    });
    expect(status.dart.dartSdk).toBe(false);
  });

  test("griffe resolved + --version emits output → python.griffe=true", () => {
    const griffeStub = join(work, "griffe-stub");
    makeStub(griffeStub, "echo 'griffe 2.0.2'");
    const status = probeToolchains(work, {
      pathLookup: (tool) => (tool === "griffe" ? griffeStub : null),
    });
    expect(status.python.griffe).toBe(true);
  });

  test("griffe resolved but --version emits no output → python.griffe=false", () => {
    const griffeStub = join(work, "griffe-stub");
    makeStub(griffeStub, "exit 0");
    const status = probeToolchains(work, {
      pathLookup: (tool) => (tool === "griffe" ? griffeStub : null),
    });
    expect(status.python.griffe).toBe(false);
  });

  test("AC-STE-105.2 shape — ToolchainStatus is the documented shape", () => {
    const status = probeToolchains(work, { pathLookup: () => null });
    expect(Object.keys(status).sort()).toEqual(["dart", "python", "ts"]);
    expect(status.ts.tsMorph).toBe(true);
    expect(typeof status.ts.typedoc).toBe("boolean");
    expect(typeof status.dart.dartSdk).toBe("boolean");
    expect(typeof status.python.griffe).toBe("boolean");
  });
});

describe("preferredFromStatus — AC-STE-105.5 mapping", () => {
  test("all toolchains present → typedoc / dart-analyzer / griffe", () => {
    const status = {
      ts: { typedoc: true, tsMorph: true as const },
      dart: { dartSdk: true },
      python: { griffe: true },
    };
    expect(preferredFromStatus(status)).toEqual({
      ts: "typedoc",
      dart: "dart-analyzer",
      python: "griffe",
    });
  });

  test("typedoc missing but ts-morph present → ts-morph", () => {
    const status = {
      ts: { typedoc: false, tsMorph: true as const },
      dart: { dartSdk: false },
      python: { griffe: false },
    };
    expect(preferredFromStatus(status)).toEqual({
      ts: "ts-morph",
      dart: "regex-fallback",
      python: "regex-fallback",
    });
  });
});
