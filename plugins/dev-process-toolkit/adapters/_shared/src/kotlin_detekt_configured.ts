// kotlin_detekt_configured — /gate-check probe (STE-336 AC-STE-336.7).
//
// A generic Gradle/JVM Kotlin project standardizes its lint gate on detekt
// (`./gradlew detekt`). If the project's gate-commands declare `detekt` but the
// detekt Gradle plugin is never applied, `./gradlew detekt` fails with
// "task 'detekt' not found" — killing the lint gate. The probe enforces the
// /setup step 2c scaffolding contract (AC-STE-336.5): when a Gradle Kotlin
// project is detected AND its gate-commands declare detekt, the detekt plugin
// must be applied (`io.gitlab.arturbosch.detekt` referenced in
// build.gradle.kts, OR a `detekt { … }` config block present).
//
// Stack-conditional (mirrors bun-zero-match-placeholder): vacuous on projects
// with no root Gradle files OR that do not declare detekt as a gate.

import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

export interface Violation {
  file: string;
  line: number;
  reason: string;
  note: string;
  message: string;
}

export interface KotlinDetektConfiguredReport {
  violations: Violation[];
}

export async function runKotlinDetektConfiguredProbe(
  projectRoot: string,
): Promise<KotlinDetektConfiguredReport> {
  // 1. Detect Gradle Kotlin — root-only check (like the bun probe checks root
  //    bun.lock). If neither marker exists → not a Gradle Kotlin project.
  const buildPath = join(projectRoot, "build.gradle.kts");
  const settingsPath = join(projectRoot, "settings.gradle.kts");
  const hasBuild = existsSync(buildPath);
  const hasSettings = existsSync(settingsPath);
  if (!hasBuild && !hasSettings) return { violations: [] };

  // 2. Read build.gradle.kts (if present). "Declares detekt as a gate" = its
  //    content contains the token `detekt`. Absent or no detekt mention →
  //    vacuous (does not declare detekt).
  if (!hasBuild) return { violations: [] };
  let build: string;
  try {
    build = readFileSync(buildPath, "utf-8");
  } catch {
    return { violations: [] };
  }
  if (!build.includes("detekt")) return { violations: [] };

  // 3. "Plugin applied" = build.gradle.kts references the detekt plugin id OR
  //    carries a `detekt { … }` config block. If applied → pass.
  const pluginApplied =
    build.includes("io.gitlab.arturbosch.detekt") || /detekt\s*\{/.test(build);
  if (pluginApplied) return { violations: [] };

  // 4. Declares detekt but the plugin is missing → one violation (NFR-10).
  const rel = relative(projectRoot, buildPath) || "build.gradle.kts";
  const reason =
    "build.gradle.kts declares detekt as a gate but the detekt Gradle plugin is not applied — `./gradlew detekt` will fail with \"task 'detekt' not found\"";
  const note = `${rel}:1 — ${reason}`;
  const message = [
    `kotlin_detekt_configured: ${reason}`,
    "Remedy: apply the detekt Gradle plugin per the AC-STE-336.5 /setup step 2c scaffold workaround — " +
      "add `id(\"io.gitlab.arturbosch.detekt\") version \"<latest>\"` to the `plugins { }` block (and an optional `detekt { }` config block) in build.gradle.kts.",
    `Context: project=${projectRoot}, probe=kotlin_detekt_configured`,
  ].join("\n");

  return {
    violations: [{ file: buildPath, line: 1, reason, note, message }],
  };
}
