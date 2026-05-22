// Doc-conformance tests for STE-317 — Explicit-subcommand example permission
// blocks (M84).
//
// Asserts that the four stack-example permission blocks under
// plugins/dev-process-toolkit/examples/ no longer carry glob-shaped
// `Bash(<cmd> *)` rules, but instead match the explicit-subcommand
// allowlists exported from templates/permissions.json. Same root cause
// as STE-209 (M54), which closed this drift at the canonical
// templates/permissions.json surface — STE-317 closes the residual
// example surface.
//
// In-scope files:
//   - examples/bun-typescript.md
//   - examples/typescript-node/gate-commands.md
//   - examples/python/gate-commands.md
//   - examples/flutter-dart/gate-commands.md
//
// Coverage matches AC-STE-317.{1..5}: zero-glob grep gate across the
// four files (AC.1), byte-exact projection of `_common + stacks.bun`
// into the bun-typescript example and lockstep update to the existing
// gate-check-bun-zero-match-placeholder.test.ts assertion (AC.2),
// equivalent rewrites for typescript-node / python / flutter-dart
// (AC.3), STE-209 empirical-proof cross-reference at the top of each
// rewritten block (AC.4), and a vacuous setup-permissions-shape probe
// run on a fixture that mirrors the bun example block (AC.5).

import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSetupPermissionsShapeProbe } from "../adapters/_shared/src/setup_permissions_shape";

const pluginRoot = join(import.meta.dir, "..");
const examplesDir = join(pluginRoot, "examples");
const permissionsJsonPath = join(pluginRoot, "templates", "permissions.json");

const FOUR_EXAMPLES = [
  "bun-typescript.md",
  join("typescript-node", "gate-commands.md"),
  join("python", "gate-commands.md"),
  join("flutter-dart", "gate-commands.md"),
] as const;

function readExample(rel: string): string {
  return readFileSync(join(examplesDir, rel), "utf8");
}

interface PermissionsJson {
  _common: string[];
  stacks: Record<string, string[]>;
}

function readPermissions(): PermissionsJson {
  return JSON.parse(readFileSync(permissionsJsonPath, "utf8")) as PermissionsJson;
}

// Glob-shaped Bash rule: `Bash(<cmd> *)` — asterisk after a lowercase
// command token + space, possibly inside a JSON string. Matches the AC.1
// grep gate: `Bash\(([a-z]+ )\*\)`.
const GLOB_RULE_REGEX = /Bash\(([a-z]+ )\*\)/g;

describe("AC-STE-317.1 — zero glob-shaped Bash rules across the four example files", () => {
  for (const rel of FOUR_EXAMPLES) {
    test(`examples/${rel} contains zero \`Bash(<cmd> *)\` glob rules`, () => {
      const body = readExample(rel);
      const hits: string[] = [];
      const lines = body.split("\n");
      for (let i = 0; i < lines.length; i++) {
        GLOB_RULE_REGEX.lastIndex = 0;
        if (GLOB_RULE_REGEX.test(lines[i]!)) {
          hits.push(`${i + 1}: ${lines[i]}`);
        }
      }
      expect(hits).toEqual([]);
    });
  }
});

describe("AC-STE-317.2 — bun-typescript.md permission block matches `_common + stacks.bun`", () => {
  const body = readExample("bun-typescript.md");
  const perms = readPermissions();
  const expectedRules = [...perms._common, ...(perms.stacks.bun ?? [])];

  for (const rule of expectedRules) {
    test(`bun-typescript.md contains explicit rule \`${rule}\``, () => {
      // Each canonical rule must appear verbatim somewhere in the file.
      expect(body).toContain(rule);
    });
  }

  test("bun-typescript.md no longer carries `Bash(bun *)` glob", () => {
    expect(body).not.toMatch(/Bash\(bun \*\)/);
    expect(body).not.toMatch(/Bash\(bunx \*\)/);
  });

  test("bun-typescript.md prose claim about `bun` stack key matches the example block beneath it", () => {
    // The L52-54 prose claim must continue to mention the bun stack key in
    // templates/permissions.json AND the block beneath it must show the
    // explicit subcommands from `stacks.bun`.
    expect(body).toMatch(/templates\/permissions\.json/);
    expect(body).toMatch(/bun.*stack key/i);
    expect(body).toContain("Bash(bun install)");
    expect(body).toContain("Bash(bun test)");
    expect(body).toContain("Bash(bun run)");
    expect(body).toContain("Bash(bun --version)");
    expect(body).toContain("Bash(bunx)");
  });

  test("gate-check-bun-zero-match-placeholder.test.ts L148-151 assertion updated to explicit-subcommand form", () => {
    // Cross-test coordination per AC.2: the legacy assertion
    //   expect(example).toMatch(/bun \*|Bash\(bun \*\)/)
    // must be replaced with an explicit-subcommand pattern such as
    //   expect(example).toMatch(/Bash\(bun install\)|Bash\(bun test\)/)
    // in the same FR. Without the update, the assertion would go RED once
    // bun-typescript.md drops the `bun *` glob shape.
    const peerTestPath = join(
      pluginRoot,
      "tests",
      "gate-check-bun-zero-match-placeholder.test.ts",
    );
    const peer = readFileSync(peerTestPath, "utf8");
    // The legacy glob-form assertion must be gone.
    expect(peer).not.toMatch(/toMatch\(\/bun \\\*\|Bash\\\(bun \\\* \\\)\//);
    expect(peer).not.toMatch(/bun \\\*\|Bash\\\(bun \\\*\\\)/);
    // The new assertion must reference at least one explicit Bun subcommand.
    expect(peer).toMatch(/Bash\\\(bun install\\\)|Bash\\\(bun test\\\)|Bash\\\(bun run\\\)/);
  });
});

describe("AC-STE-317.3 — typescript-node / python / flutter-dart example blocks rewritten to explicit-subcommand allowlists", () => {
  const perms = readPermissions();

  test("examples/typescript-node/gate-commands.md no longer carries `Bash(npm run *)` glob or related globs", () => {
    const body = readExample(join("typescript-node", "gate-commands.md"));
    expect(body).not.toMatch(/Bash\(npm run \*\)/);
    expect(body).not.toMatch(/Bash\(npx \*\)/);
    expect(body).not.toMatch(/Bash\(git \*\)/);
    expect(body).not.toMatch(/Bash\(gh \*\)/);
  });

  test("examples/typescript-node/gate-commands.md contains at least one explicit `_common` git/gh rule", () => {
    const body = readExample(join("typescript-node", "gate-commands.md"));
    // The `_common` set must project into the example block.
    expect(body).toContain("Bash(git status)");
    expect(body).toContain("Bash(gh pr view)");
  });

  test("examples/typescript-node/gate-commands.md contains explicit stacks.node rules (or _common-only note if absent)", () => {
    const body = readExample(join("typescript-node", "gate-commands.md"));
    const nodeRules = perms.stacks.node ?? [];
    if (nodeRules.length > 0) {
      // At least one of the canonical node rules must appear verbatim.
      const anyPresent = nodeRules.some((r) => body.includes(r));
      expect(anyPresent).toBe(true);
    } else {
      // AC.3 escape hatch: `_common` only + a one-line note pointing to
      // where to add per-stack entries.
      expect(body).toMatch(/templates\/permissions\.json/);
    }
  });

  test("examples/python/gate-commands.md no longer carries glob-shaped Bash rules", () => {
    const body = readExample(join("python", "gate-commands.md"));
    expect(body).not.toMatch(/Bash\(python \*\)/);
    expect(body).not.toMatch(/Bash\(pytest \*\)/);
    expect(body).not.toMatch(/Bash\(mypy \*\)/);
    expect(body).not.toMatch(/Bash\(ruff \*\)/);
    expect(body).not.toMatch(/Bash\(pip \*\)/);
    expect(body).not.toMatch(/Bash\(uv \*\)/);
    expect(body).not.toMatch(/Bash\(git \*\)/);
    expect(body).not.toMatch(/Bash\(gh \*\)/);
  });

  test("examples/python/gate-commands.md contains explicit `_common` + stacks.python rules", () => {
    const body = readExample(join("python", "gate-commands.md"));
    // _common must surface.
    expect(body).toContain("Bash(git status)");
    const pyRules = perms.stacks.python ?? [];
    if (pyRules.length > 0) {
      const anyPresent = pyRules.some((r) => body.includes(r));
      expect(anyPresent).toBe(true);
    } else {
      expect(body).toMatch(/templates\/permissions\.json/);
    }
  });

  test("examples/flutter-dart/gate-commands.md no longer carries glob-shaped Bash rules", () => {
    const body = readExample(join("flutter-dart", "gate-commands.md"));
    expect(body).not.toMatch(/Bash\(fvm \*\)/);
    expect(body).not.toMatch(/Bash\(make \*\)/);
    expect(body).not.toMatch(/Bash\(git \*\)/);
    expect(body).not.toMatch(/Bash\(gh \*\)/);
  });

  test("examples/flutter-dart/gate-commands.md contains explicit `_common` + stacks.flutter rules", () => {
    const body = readExample(join("flutter-dart", "gate-commands.md"));
    expect(body).toContain("Bash(git status)");
    const flutterRules = perms.stacks.flutter ?? [];
    if (flutterRules.length > 0) {
      const anyPresent = flutterRules.some((r) => body.includes(r));
      expect(anyPresent).toBe(true);
    } else {
      expect(body).toMatch(/templates\/permissions\.json/);
    }
  });
});

describe("AC-STE-317.4 — each rewritten permission block carries an empirical-proof cross-reference", () => {
  for (const rel of FOUR_EXAMPLES) {
    test(`examples/${rel} cites the empirical proof (setup_permissions_shape + permissions.json)`, () => {
      const body = readExample(rel);
      // The cross-reference must call out both the canonical-shape probe
      // and the canonical-list source-of-truth file. The FR ID itself stays
      // out of example prose to honor AC-STE-137.7 (shipped examples carry
      // no internal namespace tokens in non-fenced content).
      expect(body).toMatch(/Cross-reference:/);
      expect(body).toMatch(/setup_permissions_shape/);
      expect(body).toMatch(/templates\/permissions\.json/);
    });
  }
});

describe("AC-STE-317.5 — setup-permissions-shape probe finds zero glob rules on a fixture mirroring the bun example", () => {
  test("a fresh `.claude/settings.json` projecting `_common + stacks.bun` passes the probe clean", async () => {
    // AC.5 cross-checks the canonical-shape probe from STE-209 against
    // what the rewritten bun example documents. The fixture below mirrors
    // a `/setup` run that wrote the explicit-subcommand allowlist for the
    // bun stack — the probe must return zero violations.
    const perms = readPermissions();
    const allow = [...perms._common, ...(perms.stacks.bun ?? [])];
    const root = mkdtempSync(join(tmpdir(), "dpt-ste-317-"));
    try {
      mkdirSync(join(root, ".claude"), { recursive: true });
      writeFileSync(
        join(root, ".claude", "settings.json"),
        JSON.stringify({ permissions: { allow } }, null, 2) + "\n",
      );
      const r = await runSetupPermissionsShapeProbe(root);
      expect(r.violations).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("control: a fixture that mirrors the LEGACY glob-form bun example flags violations", async () => {
    // Negative control — confirms the probe wired up via AC.5 actually
    // catches the pre-rewrite drift shape, so AC.5's GREEN result on the
    // rewritten fixture is meaningful.
    const root = mkdtempSync(join(tmpdir(), "dpt-ste-317-legacy-"));
    try {
      mkdirSync(join(root, ".claude"), { recursive: true });
      writeFileSync(
        join(root, ".claude", "settings.json"),
        JSON.stringify(
          {
            permissions: {
              allow: ["Bash(bun *)", "Bash(bunx *)", "Bash(git *)", "Bash(gh *)"],
            },
          },
          null,
          2,
        ) + "\n",
      );
      const r = await runSetupPermissionsShapeProbe(root);
      expect(r.violations.length).toBeGreaterThan(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
