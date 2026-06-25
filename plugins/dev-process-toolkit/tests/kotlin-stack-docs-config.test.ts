import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// STE-336 — Kotlin first-class stack: docs/config presence assertions.
//
// These guard the non-code ACs against the real repo files (RED until the
// files/sections are authored):
//   AC-STE-336.1  examples/kotlin/ exists with exactly 2 files; gate-commands.md
//                 content + Settings Example byte-consistent with stacks.kotlin
//   AC-STE-336.2  templates/permissions.json stacks.kotlin (5 explicit subcmds,
//                 inserted after python before generic, no glob shape)
//   AC-STE-336.3  examples/kotlin/release.yml Gradle version-bump file set
//   AC-STE-336.4  /setup auto-detection covers Kotlin/Gradle
//   AC-STE-336.5  /setup scaffolding + detekt scaffold-verify branch + doc
//   AC-STE-336.9  adaptation-guide Kotlin row + Java narrowing; README mentions
//   AC-STE-336.10 CHANGELOG ### Added entry cross-referencing the FR

const pluginRoot = join(import.meta.dir, "..");
const repoRoot = join(pluginRoot, "..", "..");

const read = (p: string): string => readFileSync(p, "utf-8");

// ── AC-STE-336.2: permissions.json stacks.kotlin ───────────────────────────
const KOTLIN_ALLOW = [
  "Bash(./gradlew compileKotlin)",
  "Bash(./gradlew detekt)",
  "Bash(./gradlew test)",
  "Bash(./gradlew build)",
  "Bash(./gradlew --version)",
];

describe("AC-STE-336.2 — templates/permissions.json stacks.kotlin", () => {
  const permPath = join(pluginRoot, "templates", "permissions.json");
  const raw = read(permPath);
  const parsed = JSON.parse(raw);

  test("stacks.kotlin exists and is an array", () => {
    expect(Array.isArray(parsed.stacks?.kotlin)).toBe(true);
  });

  test("contains EXACTLY the five explicit gradle subcommands (order-sensitive)", () => {
    expect(parsed.stacks.kotlin).toEqual(KOTLIN_ALLOW);
  });

  test("inserted after python, before generic (key ordering)", () => {
    const keys = Object.keys(parsed.stacks);
    const pIdx = keys.indexOf("python");
    const kIdx = keys.indexOf("kotlin");
    const gIdx = keys.indexOf("generic");
    expect(pIdx).toBeGreaterThanOrEqual(0);
    expect(kIdx).toBeGreaterThan(pIdx);
    expect(gIdx).toBeGreaterThan(kIdx);
  });

  test("no Bash(./gradlew ... *) glob shape anywhere in templates/permissions.json", () => {
    // Mirrors the AC's `git grep -nE "Bash\(\./gradlew [^)]*\*\)"` → zero.
    expect(raw).not.toMatch(/Bash\(\.\/gradlew [^)]*\*\)/);
  });
});

// ── AC-STE-336.1: examples/kotlin/ dir shape + gate-commands.md content ─────
describe("AC-STE-336.1 — examples/kotlin/ directory + gate-commands.md", () => {
  const kotlinDir = join(pluginRoot, "examples", "kotlin");

  test("examples/kotlin/ exists", () => {
    expect(existsSync(kotlinDir)).toBe(true);
  });

  test("contains EXACTLY two files: gate-commands.md + release.yml", () => {
    const entries = existsSync(kotlinDir) ? readdirSync(kotlinDir).sort() : [];
    expect(entries).toEqual(["gate-commands.md", "release.yml"]);
  });

  describe("gate-commands.md content", () => {
    const gcPath = join(kotlinDir, "gate-commands.md");
    const gc = existsSync(gcPath) ? read(gcPath) : "";

    test("documents the four gradle gate commands", () => {
      expect(gc).toMatch(/\.\/gradlew compileKotlin/);
      expect(gc).toMatch(/\.\/gradlew detekt/);
      expect(gc).toMatch(/\.\/gradlew test/);
      expect(gc).toMatch(/\.\/gradlew build/);
    });

    test("documents TDD patterns (JUnit5 / kotlin.test, MockK, src/test/kotlin mirror)", () => {
      expect(gc).toMatch(/JUnit5|kotlin\.test/);
      expect(gc).toMatch(/MockK/i);
      expect(gc).toMatch(/src\/test\/kotlin/);
      expect(gc).toMatch(/src\/main\/kotlin/);
    });

    test("documents key conventions (./gradlew wrapper, Kotlin-DSL build files)", () => {
      expect(gc).toMatch(/\.\/gradlew/);
      expect(gc).toMatch(/Kotlin-DSL|build\.gradle\.kts|\.kts/);
    });

    test("has a `## Settings Example` JSON block byte-consistent with stacks.kotlin", () => {
      expect(gc).toMatch(/## Settings Example/);
      // Parse the fenced JSON block under Settings Example and compare its
      // permissions.allow tail against the canonical kotlin allowlist.
      const idx = gc.indexOf("## Settings Example");
      const after = idx === -1 ? "" : gc.slice(idx);
      const fence = after.match(/```json\s*([\s\S]*?)```/);
      expect(fence).not.toBeNull();
      const block = JSON.parse(fence![1]!);
      const allow: string[] = block.permissions.allow;
      // Every kotlin entry must appear verbatim (byte-consistent).
      for (const e of KOTLIN_ALLOW) {
        expect(allow).toContain(e);
      }
      // And they must be the trailing stack-specific entries (after _common),
      // in the same order as the permissions.json stacks.kotlin array.
      const tail = allow.slice(allow.length - KOTLIN_ALLOW.length);
      expect(tail).toEqual(KOTLIN_ALLOW);
    });
  });
});

// ── AC-STE-336.3: examples/kotlin/release.yml ──────────────────────────────
describe("AC-STE-336.3 — examples/kotlin/release.yml Gradle version-bump set", () => {
  const relPath = join(pluginRoot, "examples", "kotlin", "release.yml");
  const rel = existsSync(relPath) ? read(relPath) : "";

  test("release.yml exists", () => {
    expect(existsSync(relPath)).toBe(true);
  });

  test("declares gradle.properties as kind: regex with a version=<semver> pattern", () => {
    expect(rel).toMatch(/path:\s*gradle\.properties/);
    expect(rel).toMatch(/kind:\s*regex/);
    // The version= semver capture, e.g. ^version=(?<version>\d+\.\d+\.\d+)
    expect(rel).toMatch(/\^version=\(\?<version>\\d\+\\\.\\d\+\\\.\\d\+\)/);
  });

  test("declares CHANGELOG.md as kind: changelog", () => {
    expect(rel).toMatch(/path:\s*CHANGELOG\.md/);
    expect(rel).toMatch(/kind:\s*changelog/);
  });

  test("declares an optional README Latest: regex entry", () => {
    expect(rel).toMatch(/path:\s*README\.md/);
    expect(rel).toMatch(/Latest:/);
    expect(rel).toMatch(/optional:\s*true/);
  });
});

// ── AC-STE-336.4: /setup auto-detection ────────────────────────────────────
describe("AC-STE-336.4 — /setup auto-detection covers Kotlin/Gradle", () => {
  const skill = read(join(pluginRoot, "skills", "setup", "SKILL.md"));

  test("step-1 project-file probe lists build.gradle.kts / settings.gradle.kts markers", () => {
    expect(skill).toMatch(/build\.gradle\.kts/);
    expect(skill).toMatch(/settings\.gradle\.kts/);
  });

  test("example-match step maps the detected Kotlin stack to examples/kotlin/", () => {
    expect(skill).toMatch(/examples\/kotlin/);
  });

  test("doctor invocation probes ./gradlew --version for Kotlin (not bare gradle --version)", () => {
    expect(skill).toMatch(/\.\/gradlew --version/);
  });
});

// ── AC-STE-336.5: /setup scaffolding + detekt scaffold-verify branch ───────
describe("AC-STE-336.5 — /setup scaffolding handles Kotlin", () => {
  const skill = read(join(pluginRoot, "skills", "setup", "SKILL.md"));
  const setupRef = read(join(pluginRoot, "docs", "setup-reference.md"));

  test("step 2b gains a Kotlin (Gradle/JVM) guidance bullet", () => {
    expect(skill).toMatch(/Kotlin \(Gradle\/JVM\)/);
  });

  test("scaffold guidance mentions Kotlin-JVM + detekt Gradle plugins and src dirs", () => {
    // build.gradle.kts applying Kotlin-JVM AND detekt plugins, settings.gradle.kts,
    // placeholder src/main/kotlin + src/test/kotlin.
    expect(skill).toMatch(/detekt/);
    expect(skill).toMatch(/src\/main\/kotlin/);
    expect(skill).toMatch(/src\/test\/kotlin/);
  });

  test("docs/setup-reference.md documents the Kotlin detekt scaffold-verify branch", () => {
    expect(setupRef).toMatch(/Kotlin detekt scaffold-verify branch/);
  });
});

// ── AC-STE-336.9: adaptation-guide + README ────────────────────────────────
describe("AC-STE-336.9 — adaptation-guide + README reflect the Kotlin stack", () => {
  const guide = read(join(pluginRoot, "docs", "adaptation-guide.md"));
  const readme = read(join(repoRoot, "README.md"));

  test("adaptation-guide gains a dedicated Kotlin (Gradle/JVM) gate-table row", () => {
    // A table row whose cells are the four ./gradlew gate commands.
    const rowRe =
      /\|\s*Kotlin \(Gradle\/JVM\)\s*\|.*compileKotlin.*\|.*detekt.*\|.*\btest\b.*\|.*build.*\|/;
    expect(guide).toMatch(rowRe);
  });

  test("the combined Java/Kotlin row is narrowed to Java (keeps spotlessCheck)", () => {
    // The old combined row must be gone; a Java-only row keeping spotlessCheck remains.
    expect(guide).not.toMatch(/\|\s*Java\/Kotlin\s*\|/);
    expect(guide).toMatch(/\|\s*Java\s*\|.*spotlessCheck.*\|/);
  });

  test("README 'auto-detects …' line includes Kotlin", () => {
    const line = readme
      .split("\n")
      .find((l) => /auto-detects/.test(l));
    expect(line).toBeDefined();
    expect(line!).toMatch(/Kotlin/);
  });

  test("README 'Examples Provided For' has a Kotlin entry", () => {
    const idx = readme.indexOf("Examples Provided For");
    expect(idx).toBeGreaterThanOrEqual(0);
    // Look within the section (until the next top-level "## " heading).
    const after = readme.slice(idx);
    const nextTop = after.slice(3).search(/\n## /);
    const section = nextTop === -1 ? after : after.slice(0, nextTop + 3);
    expect(section).toMatch(/Kotlin/);
  });
});

// ── AC-STE-336.10: CHANGELOG cross-reference ───────────────────────────────
describe("AC-STE-336.10 — CHANGELOG ### Added entry cross-references the FR", () => {
  const changelog = read(join(repoRoot, "CHANGELOG.md"));

  test("an ### Added line mentions Kotlin and/or STE-336", () => {
    // AC-STE-336.10 is about M88's CHANGELOG entry, which lives permanently in
    // the `## [2.32.0]` section. Pin the scan to that section (not the topmost
    // ### Added) so a later release adding a newer section on top can't move
    // STE-336 out of view and break this historical-entry assertion.
    const releaseIdx = changelog.indexOf("## [2.32.0]");
    expect(releaseIdx).toBeGreaterThanOrEqual(0);
    const addedIdx = changelog.indexOf("### Added", releaseIdx);
    expect(addedIdx).toBeGreaterThanOrEqual(0);
    const after = changelog.slice(addedIdx);
    // Bound to the next "## " release heading.
    const nextRelease = after.search(/\n## \[/);
    const section = nextRelease === -1 ? after : after.slice(0, nextRelease);
    expect(section).toMatch(/Kotlin|STE-336/);
  });
});
