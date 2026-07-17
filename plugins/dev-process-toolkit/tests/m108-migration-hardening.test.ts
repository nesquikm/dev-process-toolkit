// M108 — robustness hardening surfaced by the /implement Phase 3 Stage B code
// review of the migration framework. Each test pins a corruption/crash path in
// the destructive or security-sensitive file operations that the AC suites did
// not exercise. All target production behavior the code SHOULD have but didn't.

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeJsonIfChanged } from "../adapters/_shared/src/migrations/consumer_files";
import { freezeMonolith, MonolithFreezeError } from "../adapters/_shared/src/migrations/monolith_split";
import { permissionShapes } from "../adapters/_shared/src/migrations/entries/permission_shapes";

const roots: string[] = [];
const mkRoot = (): string => {
  const r = mkdtempSync(join(tmpdir(), "m108-harden-"));
  roots.push(r);
  return r;
};
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Concern 3 — writeJsonIfChanged preserves a CRLF file's internal line endings.
// The seed entries promise "every other byte of user settings is preserved";
// JSON.stringify always emits \n, so a Windows-authored (CRLF) config had every
// internal line ending silently rewritten to LF on the first real change.
// ---------------------------------------------------------------------------

describe("writeJsonIfChanged — internal line endings survive", () => {
  test("a CRLF-authored JSON file keeps CRLF after a real change", () => {
    const root = mkRoot();
    const path = join(root, "settings.json");
    // A CRLF file, pretty-printed with 2-space indent (what the writer emits).
    const crlf = JSON.stringify({ a: 1, keep: "me" }, null, 2).replace(/\n/g, "\r\n") + "\r\n";
    writeFileSync(path, crlf);

    const wrote = writeJsonIfChanged(path, { a: 2, keep: "me" });
    expect(wrote).toBe(true);
    const after = readFileSync(path, "utf-8");
    expect(after).toContain("\r\n");
    // No lone LF crept in — every newline is a CRLF.
    expect(after.replace(/\r\n/g, "")).not.toContain("\n");
  });

  test("an LF file stays LF", () => {
    const root = mkRoot();
    const path = join(root, "settings.json");
    writeFileSync(path, JSON.stringify({ a: 1 }, null, 2) + "\n");
    writeJsonIfChanged(path, { a: 2 });
    expect(readFileSync(path, "utf-8")).not.toContain("\r\n");
  });
});

// ---------------------------------------------------------------------------
// Concern 5 — projectGlobRule indexes template.stacks[command] with `command`
// taken verbatim from the consumer's own settings. `Bash(__proto__ *)` resolved
// through the prototype chain to a non-array and crashed the whole rewrite.
// ---------------------------------------------------------------------------

describe("permission-shapes apply — prototype-named glob does not crash the rewrite", () => {
  const bootstrap = (root: string, allow: unknown[]): string => {
    const dir = join(root, ".claude");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "settings.json");
    writeFileSync(path, JSON.stringify({ permissions: { allow } }, null, 2) + "\n");
    return path;
  };

  test("a `Bash(__proto__ *)` rule is dropped, not a thrown crash", () => {
    const root = mkRoot();
    const path = bootstrap(root, ["Bash(__proto__ *)", "Bash(ls)"]);
    // Must not throw. The prototype-named glob has no real projection, so it is
    // dropped like any unprojectable glob; the plain rule is untouched.
    expect(() => permissionShapes.apply!(root)).not.toThrow();
    const after = JSON.parse(readFileSync(path, "utf-8")) as { permissions: { allow: string[] } };
    expect(after.permissions.allow).toContain("Bash(ls)");
    expect(after.permissions.allow).not.toContain("Bash(__proto__ *)");
  });

  test("a `Bash(constructor *)` rule likewise does not crash", () => {
    const root = mkRoot();
    bootstrap(root, ["Bash(constructor *)"]);
    expect(() => permissionShapes.apply!(root)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Concern 4 — PLAN_MILESTONE_HEADING was case-sensitive while milestoneKey()
// normalizes M2/m2/2. A lowercase `## m2:` plan heading silently minted a stub
// with ZERO remaining rows instead of the milestone's real unfinished work.
// ---------------------------------------------------------------------------

describe("freezeMonolith — a lowercase milestone heading still yields its rows", () => {
  test("`## m2:` open milestone stub carries the real unchecked ACs", () => {
    const root = mkRoot();
    const specs = join(root, "specs");
    mkdirSync(specs, { recursive: true });
    writeFileSync(
      join(specs, "requirements.md"),
      "### FR-12: Import {#FR-12}\n\n- AC-12.1: rows become widgets.\n- AC-12.2: malformed rows rejected.\n",
    );
    // Lowercase milestone heading — the case milestoneKey() tolerates but the
    // heading regex used not to.
    writeFileSync(
      join(specs, "plan.md"),
      "# Plan\n\n## m2: Import pipeline\n\n- [x] AC-12.1 — rows become widgets\n- [ ] AC-12.2 — malformed rows rejected\n",
    );

    freezeMonolith(root, ["M2"]);
    const stub = readFileSync(join(specs, "plan", "M2.md"), "utf-8");
    // The unchecked row survives into the stub; the shipped one is dropped.
    expect(stub).toMatch(/AC-12\.2/);
    expect(stub).not.toMatch(/AC-12\.1/);
  });
});

// ---------------------------------------------------------------------------
// Concerns 1 + 2 — freezeMonolith's relocate() clobbered an existing archive
// destination with no guard, and a raw I/O throw escaped uncaught instead of
// the module's own MonolithFreezeError (which names the restore-from-backup
// path). A pre-existing archive file is the observable trigger for both.
// ---------------------------------------------------------------------------

describe("freezeMonolith — a pre-existing archive destination is a structured refusal", () => {
  test("throws MonolithFreezeError (not a raw Error) rather than clobbering", () => {
    const root = mkRoot();
    const specs = join(root, "specs");
    mkdirSync(specs, { recursive: true });
    writeFileSync(join(specs, "requirements.md"), "### FR-8: Thing {#FR-8}\n\n- AC-8.1: x.\n");

    // A residue archive file from a prior half-run — relocate must not overwrite.
    const legacyDir = join(specs, "frs", "archive", "legacy");
    mkdirSync(legacyDir, { recursive: true });
    const victim = join(legacyDir, "requirements.md");
    writeFileSync(victim, "PRIOR ARCHIVED CONTENT — must not be clobbered\n");

    let thrown: unknown;
    try {
      freezeMonolith(root, []);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(MonolithFreezeError);
    // The refusal points the operator at the backup, and the victim is intact.
    expect((thrown as Error).message).toMatch(/backup/i);
    expect(readFileSync(victim, "utf-8")).toContain("PRIOR ARCHIVED CONTENT");
  });
});
