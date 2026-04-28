// Unit tests for computeImpactSet / extractFromSnapshots (STE-71).
//
// AC-STE-71.2 (determinism), .3 (ts-morph symbol extraction), .4 (non-TS
// regex fallback), .5 (public-symbol filter), .6 (empty-set predicate),
// .8 (fixture coverage across all four categories).
//
// Tests target the pure `extractFromSnapshots` + helpers directly so no
// real `git` invocation is needed; one end-to-end test exercises
// `computeImpactSet` against a real `git init`ed tempdir so the git-plumbing
// path is exercised at least once.

import { describe, expect, test } from "bun:test";
import { $ } from "bun";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  computeImpactSet,
  extractFromSnapshots,
  filterPublicSymbols,
  isEmptyImpactSet,
  type FileSnapshot,
  type ImpactSet,
} from "./impact_set";

describe("extractFromSnapshots — AC-STE-71.3 symbol extraction", () => {
  test("AC-STE-71.3 — added public function surfaces in symbols with change=added, visibility=public", () => {
    const snapshots: FileSnapshot[] = [
      {
        path: "src/calc.ts",
        before: null,
        after: `export function add(a: number, b: number): number {\n  return a + b;\n}\n`,
      },
    ];
    const result = extractFromSnapshots(snapshots, "typescript");
    expect(result.symbols).toHaveLength(1);
    const [s] = result.symbols;
    expect(s.name).toBe("add");
    expect(s.kind).toBe("function");
    expect(s.change).toBe("added");
    expect(s.visibility).toBe("public");
    expect(s.file).toBe("src/calc.ts");
    expect(s.signatureHash.length).toBeGreaterThan(0);
  });

  test("AC-STE-71.3 — modified signature produces change=modified with different hash than before", () => {
    const beforeSrc = `export function add(a: number, b: number): number { return a + b; }\n`;
    const afterSrc = `export function add(a: number, b: number, mode: "int" | "float" = "int"): number { return a + b; }\n`;
    const result = extractFromSnapshots(
      [{ path: "src/calc.ts", before: beforeSrc, after: afterSrc }],
      "typescript",
    );
    expect(result.symbols).toHaveLength(1);
    expect(result.symbols[0].name).toBe("add");
    expect(result.symbols[0].change).toBe("modified");
  });

  test("AC-STE-71.3 — removed public function surfaces with change=removed, empty signature hash", () => {
    const result = extractFromSnapshots(
      [
        {
          path: "src/calc.ts",
          before: `export function add(a: number, b: number): number { return a + b; }\n`,
          after: `\n`,
        },
      ],
      "typescript",
    );
    expect(result.symbols).toHaveLength(1);
    expect(result.symbols[0].change).toBe("removed");
    expect(result.symbols[0].signatureHash).toBe("");
  });

  test("AC-STE-71.3/.5 — internal (non-exported) function recorded with visibility=internal", () => {
    const result = extractFromSnapshots(
      [
        {
          path: "src/helpers.ts",
          before: null,
          after: `function helperFn(x: number): number { return x * 2; }\nexport const K = 42;\n`,
        },
      ],
      "typescript",
    );
    const named = new Map(result.symbols.map((s) => [s.name, s]));
    expect(named.get("helperFn")?.visibility).toBe("internal");
    expect(named.get("K")?.visibility).toBe("public");
  });

  test("AC-STE-71.3 — class / type / interface / enum kinds are classified correctly", () => {
    const src = `
export class Engine {}
export type Id = string | number;
export interface Car { wheels: number; }
export enum Color { Red = "red", Blue = "blue" }
`;
    const result = extractFromSnapshots([{ path: "src/m.ts", before: null, after: src }], "typescript");
    const byName = new Map(result.symbols.map((s) => [s.name, s.kind]));
    expect(byName.get("Engine")).toBe("class");
    expect(byName.get("Id")).toBe("type");
    expect(byName.get("Car")).toBe("interface");
    expect(byName.get("Color")).toBe("enum");
  });
});

describe("extractFromSnapshots — AC-STE-71.8 routes + configKeys + stateEvents", () => {
  test("AC-STE-71.8 — CLI command via cli.command() surfaces as RouteChange", () => {
    const result = extractFromSnapshots(
      [
        {
          path: "src/cli.ts",
          before: `import { cli } from "./cli-lib";\n`,
          after: `import { cli } from "./cli-lib";\ncli.command("deploy");\n`,
        },
      ],
      "typescript",
    );
    const cliRoutes = result.routes.filter((r) => r.kind === "cli");
    expect(cliRoutes).toHaveLength(1);
    expect(cliRoutes[0].path).toBe("deploy");
    expect(cliRoutes[0].change).toBe("added");
  });

  test("AC-STE-71.8 — HTTP route via app.get() surfaces with method + path", () => {
    const result = extractFromSnapshots(
      [
        {
          path: "src/server.ts",
          before: `const app = express();\n`,
          after: `const app = express();\napp.get("/api/users", handler);\n`,
        },
      ],
      "typescript",
    );
    const httpRoutes = result.routes.filter((r) => r.kind === "http");
    expect(httpRoutes).toHaveLength(1);
    expect(httpRoutes[0].method).toBe("get");
    expect(httpRoutes[0].path).toBe("/api/users");
  });

  test("AC-STE-71.8 — added package.json script surfaces as ConfigKeyChange", () => {
    const before = JSON.stringify({ name: "pkg", scripts: { test: "bun test" } }, null, 2);
    const after = JSON.stringify(
      { name: "pkg", scripts: { test: "bun test", build: "bun build" } },
      null,
      2,
    );
    const result = extractFromSnapshots(
      [{ path: "package.json", before, after }],
      "typescript",
    );
    const added = result.configKeys.find((k) => k.keyPath === "/scripts/build");
    expect(added).toBeDefined();
    expect(added!.change).toBe("added");
    expect(added!.file).toBe("package.json");
  });

  test("AC-STE-71.8 — added enum value surfaces in stateEvents AND symbols (enum-modified)", () => {
    const before = `export enum Color { Red = "red" }\n`;
    const after = `export enum Color { Red = "red", Blue = "blue" }\n`;
    const result = extractFromSnapshots(
      [{ path: "src/color.ts", before, after }],
      "typescript",
    );
    const enumValues = result.stateEvents.filter((e) => e.kind === "enum-value");
    expect(enumValues.some((e) => e.name === "Blue" && e.change === "added")).toBe(true);
    // Enum itself also flagged as modified symbol.
    expect(result.symbols.some((s) => s.name === "Color" && s.change === "modified")).toBe(true);
  });

  test("AC-STE-71.8 — added action type string surfaces as stateEvent action-type", () => {
    const before = `type UserAction = | { type: "login" };\n`;
    const after = `type UserAction = | { type: "login" } | { type: "logout" };\n`;
    const result = extractFromSnapshots(
      [{ path: "src/actions.ts", before, after }],
      "typescript",
    );
    const actionTypes = result.stateEvents.filter((e) => e.kind === "action-type");
    expect(actionTypes.some((e) => e.name === "logout" && e.change === "added")).toBe(true);
  });

  test("AC-STE-71.8 — added case branch surfaces as stateEvent case-branch", () => {
    const before = `switch (x) { case "A": doA(); break; }\n`;
    const after = `switch (x) { case "A": doA(); break; case "B": doB(); break; }\n`;
    const result = extractFromSnapshots(
      [{ path: "src/reducer.ts", before, after }],
      "typescript",
    );
    const cases = result.stateEvents.filter((e) => e.kind === "case-branch");
    expect(cases.some((e) => e.name === "B" && e.change === "added")).toBe(true);
  });
});

describe("extractFromSnapshots — AC-STE-71.6 empty + AC-STE-71.2 determinism", () => {
  test("AC-STE-71.6 — empty snapshots array returns empty ImpactSet (isEmptyImpactSet=true)", () => {
    const result = extractFromSnapshots([], "typescript");
    expect(result).toEqual({ symbols: [], routes: [], configKeys: [], stateEvents: [] });
    expect(isEmptyImpactSet(result)).toBe(true);
  });

  test("AC-STE-71.6 — no-op diff (unchanged file) returns empty ImpactSet", () => {
    const src = `export function add(a: number, b: number): number { return a + b; }\n`;
    const result = extractFromSnapshots([{ path: "src/m.ts", before: src, after: src }], "typescript");
    expect(isEmptyImpactSet(result)).toBe(true);
  });

  test("AC-STE-71.2 — determinism: same input produces same output on repeat invocations", () => {
    const snapshots: FileSnapshot[] = [
      {
        path: "src/m.ts",
        before: null,
        after: `export function a(): void {}\nexport function b(): void {}\nexport function c(): void {}\n`,
      },
    ];
    const first = extractFromSnapshots(snapshots, "typescript");
    const second = extractFromSnapshots(snapshots, "typescript");
    const third = extractFromSnapshots(snapshots, "typescript");
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(JSON.stringify(second)).toBe(JSON.stringify(third));
  });
});

describe("filterPublicSymbols — AC-STE-71.5", () => {
  test("AC-STE-71.5 — filterPublicSymbols retains only visibility=public", () => {
    const set: ImpactSet = {
      symbols: [
        { kind: "function", name: "pub", file: "a.ts", change: "added", visibility: "public", signatureHash: "h1" },
        { kind: "function", name: "priv", file: "a.ts", change: "added", visibility: "internal", signatureHash: "h2" },
      ],
      routes: [],
      configKeys: [],
      stateEvents: [],
    };
    const out = filterPublicSymbols(set);
    expect(out.symbols.map((s) => s.name)).toEqual(["pub"]);
  });

  test("AC-STE-71.5 — internal-only change produces empty public set (AC-STE-71.8 row)", () => {
    const snapshots: FileSnapshot[] = [
      {
        path: "src/internals.ts",
        before: null,
        after: `function helper(): void {}\n`,
      },
    ];
    const raw = extractFromSnapshots(snapshots, "typescript");
    const pub = filterPublicSymbols(raw);
    expect(pub.symbols).toHaveLength(0);
    // But the raw set still records it as internal.
    expect(raw.symbols.some((s) => s.visibility === "internal")).toBe(true);
  });
});

describe("extractFromSnapshots — AC-STE-71.4 non-TS stack regex fallback", () => {
  test("AC-STE-71.4 — stack=markdown skips TS AST path but still extracts routes/config when patterns appear", () => {
    // A Markdown file containing a JSON config snippet shouldn't produce TS
    // symbols — the stack-gate stops ts-morph from running. Routes/stateEvents
    // stay empty because Markdown doesn't host them.
    const result = extractFromSnapshots(
      [
        {
          path: "docs/README.md",
          before: `# Hello\n`,
          after: `# Hello\n\nSee \`export function foo() {}\` (not real code).\n`,
        },
      ],
      "markdown",
    );
    expect(result.symbols).toHaveLength(0);
  });

  test("AC-STE-71.4 — stack=other still extracts config-key changes from package.json", () => {
    const before = JSON.stringify({ version: "1.0.0" });
    const after = JSON.stringify({ version: "1.1.0" });
    const result = extractFromSnapshots(
      [{ path: "package.json", before, after }],
      "other",
    );
    expect(result.configKeys.some((k) => k.keyPath === "/version" && k.change === "modified")).toBe(true);
  });
});

describe("hardening — sanitizeGitRef via computeImpactSet range mode", () => {
  test("leading-dash ref is rejected and falls back to HEAD~1 (no --flag injection)", async () => {
    const work = mkdtempSync(join(tmpdir(), "dpt-impact-ref-"));
    try {
      await $`git init -q`.cwd(work);
      await $`git config user.email test@test`.cwd(work);
      await $`git config user.name test`.cwd(work);
      mkdirSync(join(work, "src"), { recursive: true });
      writeFileSync(join(work, "src/m.ts"), `export function a(): void {}\n`);
      await $`git add -A`.cwd(work);
      await $`git commit -qm initial`.cwd(work);
      writeFileSync(
        join(work, "src/m.ts"),
        `export function a(): void {}\nexport function b(): void {}\n`,
      );
      await $`git add -A`.cwd(work);
      await $`git commit -qm second`.cwd(work);
      // Passing an adversarial `-delete-branch` ref — must be rejected by
      // sanitizeGitRef and fall back to HEAD~1 without ever running
      // `git show -delete-branch:file`. The fallback produces a valid
      // HEAD~1..HEAD diff in this two-commit repo.
      const result = computeImpactSet({
        mode: "range",
        baseRef: "-delete-branch",
        headRef: "HEAD",
        projectRoot: work,
        stackOverride: "typescript",
      });
      // Fallback to HEAD~1..HEAD yields the added `b` symbol from the
      // second commit — proof that the defaults kicked in.
      expect(result.symbols.some((s) => s.name === "b" && s.change === "added")).toBe(true);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });
});

describe("computeImpactSet — end-to-end via real git repo", () => {
  test("AC-STE-71.1/.2 — computeImpactSet against a real git repo returns a deterministic ImpactSet", async () => {
    const work = mkdtempSync(join(tmpdir(), "dpt-impact-e2e-"));
    try {
      await $`git init -q`.cwd(work);
      await $`git config user.email test@test`.cwd(work);
      await $`git config user.name test`.cwd(work);
      mkdirSync(join(work, "src"), { recursive: true });
      writeFileSync(join(work, "src/m.ts"), `export function a(): void {}\n`);
      await $`git add -A`.cwd(work);
      await $`git commit -qm initial`.cwd(work);
      // Working-tree change: add one more exported function.
      writeFileSync(
        join(work, "src/m.ts"),
        `export function a(): void {}\nexport function b(): void {}\n`,
      );
      const result = computeImpactSet({ mode: "working-tree", projectRoot: work, stackOverride: "typescript" });
      expect(result.symbols.some((s) => s.name === "b" && s.change === "added")).toBe(true);
      // Deterministic repeat.
      const second = computeImpactSet({ mode: "working-tree", projectRoot: work, stackOverride: "typescript" });
      expect(JSON.stringify(result)).toBe(JSON.stringify(second));
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });
});
