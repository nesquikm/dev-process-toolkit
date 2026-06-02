import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runKotlinDetektConfiguredProbe } from "../adapters/_shared/src/kotlin_detekt_configured";

// STE-336 AC-STE-336.7 / AC-STE-336.8 — `kotlin-detekt-configured` probe.
//
// A generic Gradle/JVM Kotlin project standardizes its lint gate on detekt
// (`./gradlew detekt`). If the project's gate-commands declare `detekt` but
// the detekt Gradle plugin is never applied, `./gradlew detekt` fails with
// "task 'detekt' not found" — killing the lint gate. The probe enforces the
// /setup step 2c scaffolding contract (AC-STE-336.5): when a Gradle Kotlin
// project is detected AND its gate-commands declare detekt, the detekt plugin
// must be applied (`io.gitlab.arturbosch.detekt` referenced in
// build.gradle.kts, OR a `detekt { … }` config block present).
//
// The probe is stack-conditional (mirrors bun-zero-match-placeholder): vacuous
// on projects with no Gradle files OR that do not declare detekt as a gate.
//
// Four fixtures (per AC-STE-336.8), in-memory mkdtempSync (STE-82 contract):
//   (a) Kotlin project declaring detekt but missing the plugin → fail (1 violation)
//   (b) Kotlin project with the detekt plugin present → pass (0 violations)
//   (c) Kotlin project that does NOT declare detekt as a gate → vacuous pass
//   (d) non-Kotlin project (no build.gradle.kts/settings.gradle.kts) → vacuous pass

const pluginRoot = join(import.meta.dir, "..");

interface ProjectOpts {
  buildGradleKts?: string | null;
  settingsGradleKts?: string | null;
}

function makeProject(opts: ProjectOpts): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "kotlin-detekt-"));
  if (opts.buildGradleKts != null) {
    writeFileSync(join(root, "build.gradle.kts"), opts.buildGradleKts);
  }
  if (opts.settingsGradleKts != null) {
    writeFileSync(join(root, "settings.gradle.kts"), opts.settingsGradleKts);
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

// A build.gradle.kts that DECLARES detekt as a gate task but does NOT apply
// the detekt plugin (no `io.gitlab.arturbosch.detekt`, no `detekt { }` block).
// The bare reference to the `detekt` task name is how the project "declares
// detekt as a gate"; the missing plugin is the violation.
const BUILD_DECLARES_DETEKT_NO_PLUGIN = `plugins {
    kotlin("jvm") version "2.0.0"
}

// Our gate runs: ./gradlew compileKotlin && ./gradlew detekt && ./gradlew test
// but the detekt plugin is never applied, so the detekt task does not exist.
`;

// Plugin applied via the plugins {} DSL id.
const BUILD_PLUGIN_APPLIED = `plugins {
    kotlin("jvm") version "2.0.0"
    id("io.gitlab.arturbosch.detekt") version "1.23.6"
}

detekt {
    buildUponDefaultConfig = true
}
`;

// A Kotlin project that does NOT mention detekt anywhere — its gate set does
// not declare detekt, so the probe must be vacuous.
const BUILD_NO_DETEKT = `plugins {
    kotlin("jvm") version "2.0.0"
}

tasks.test {
    useJUnitPlatform()
}
`;

describe("AC-STE-336.8(a) Kotlin + declares detekt + plugin missing → fail", () => {
  test("one violation; message carries NFR-10 Remedy:+Context: shape", async () => {
    const ctx = makeProject({
      buildGradleKts: BUILD_DECLARES_DETEKT_NO_PLUGIN,
      settingsGradleKts: `rootProject.name = "demo"\n`,
    });
    try {
      const report = await runKotlinDetektConfiguredProbe(ctx.root);
      expect(report.violations.length).toBe(1);
      const v = report.violations[0]!;
      // Violation shape: { file, line, reason, note, message }
      expect(typeof v.file).toBe("string");
      expect(typeof v.line).toBe("number");
      expect(typeof v.reason).toBe("string");
      expect(typeof v.note).toBe("string");
      expect(v.message).toMatch(/Remedy:/);
      expect(v.message).toMatch(/Context:/);
      // Points to the AC-STE-336.5 scaffold workaround (detekt plugin).
      expect(v.message).toMatch(/detekt/i);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-336.8(b) Kotlin + detekt plugin present → pass", () => {
  test("plugin applied (io.gitlab.arturbosch.detekt + detekt {} block) → zero violations", async () => {
    const ctx = makeProject({
      buildGradleKts: BUILD_PLUGIN_APPLIED,
      settingsGradleKts: `rootProject.name = "demo"\n`,
    });
    try {
      const report = await runKotlinDetektConfiguredProbe(ctx.root);
      expect(report.violations).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-336.8(c) Kotlin project does NOT declare detekt as a gate → vacuous pass", () => {
  test("no detekt mention anywhere → zero violations even though plugin absent", async () => {
    const ctx = makeProject({
      buildGradleKts: BUILD_NO_DETEKT,
      settingsGradleKts: `rootProject.name = "demo"\n`,
    });
    try {
      const report = await runKotlinDetektConfiguredProbe(ctx.root);
      expect(report.violations).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-336.8(d) non-Kotlin project → vacuous pass", () => {
  test("no build.gradle.kts / settings.gradle.kts → zero violations", async () => {
    const ctx = makeProject({});
    try {
      const report = await runKotlinDetektConfiguredProbe(ctx.root);
      expect(report.violations).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });

  test("a project with only an unrelated file is still vacuous", async () => {
    const ctx = makeProject({});
    try {
      writeFileSync(join(ctx.root, "README.md"), "# not a gradle project\n");
      const report = await runKotlinDetektConfiguredProbe(ctx.root);
      expect(report.violations).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-336.8 — settings.gradle.kts alone is enough to detect a Gradle Kotlin project", () => {
  test("declares detekt via settings + missing plugin → fail", async () => {
    // Detection fires on settings.gradle.kts OR build.gradle.kts. Here the
    // detekt declaration + a build.gradle.kts without the plugin are present.
    const ctx = makeProject({
      settingsGradleKts: `rootProject.name = "demo"\n`,
      buildGradleKts: BUILD_DECLARES_DETEKT_NO_PLUGIN,
    });
    try {
      const report = await runKotlinDetektConfiguredProbe(ctx.root);
      expect(report.violations.length).toBe(1);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-336.8 — gate-check SKILL.md prose declares the probe", () => {
  const gateCheckSkill = readFileSync(
    join(pluginRoot, "skills", "gate-check", "SKILL.md"),
    "utf-8",
  );
  test("SKILL.md references probe `kotlin-detekt-configured`", () => {
    expect(gateCheckSkill).toMatch(/kotlin-detekt-configured/);
  });
});

describe("AC-STE-336.8 — kotlin-detekt-configured runs clean on this repo's baseline", () => {
  test("runKotlinDetektConfiguredProbe(repoRoot) returns zero violations", async () => {
    const repoRoot = join(import.meta.dir, "..", "..", "..");
    const report = await runKotlinDetektConfiguredProbe(repoRoot);
    expect(report.violations).toEqual([]);
  });
});
