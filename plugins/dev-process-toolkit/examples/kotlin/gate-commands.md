# Kotlin/Gradle Gate Commands

## Gate Check Commands

```bash
./gradlew compileKotlin    # Typecheck (compile main Kotlin sources)
./gradlew detekt           # Static analysis (lint)
./gradlew test             # Run all tests (JUnit5 / kotlin.test)
./gradlew build            # Full build (compile + test + assemble)
```

## TDD Patterns

- **Test runner:** JUnit5 (Jupiter) with `kotlin.test` assertions
- **Mocking:** MockK (idiomatic Kotlin mocking, NOT Mockito)
- **Test location:** `src/test/kotlin` mirroring `src/main/kotlin` structure
- **File naming:** `*Test.kt` (e.g. `FooTest.kt` for `Foo.kt`)
- **Run a single test class:** `./gradlew test --tests "com.example.FooTest"`

## Key Conventions

- Always invoke Gradle via the `./gradlew` wrapper (never a system-installed `gradle`) — the wrapper pins the project's Gradle version
- Use Kotlin-DSL build files: `build.gradle.kts` / `settings.gradle.kts` (not the Groovy `.gradle` form)
- Production code lives in `src/main/kotlin`; tests in `src/test/kotlin`
- Apply the `kotlin("jvm")` and `io.gitlab.arturbosch.detekt` Gradle plugins in `build.gradle.kts`
- Keep `./gradlew detekt` clean before committing — it is the lint gate

## Settings Example

> Cross-reference: the canonical-shape probe at `adapters/_shared/src/setup_permissions_shape.ts` empirically rejects glob-form `Bash(<cmd> *)` rules; the canonical allowlist lives in `templates/permissions.json` — both are the source of truth for the block below.

```json
{
  "permissions": {
    "allow": [
      "Bash(git status)",
      "Bash(git diff)",
      "Bash(git log)",
      "Bash(git show)",
      "Bash(git rev-parse)",
      "Bash(git ls-files)",
      "Bash(git branch)",
      "Bash(git blame)",
      "Bash(gh pr list)",
      "Bash(gh pr view)",
      "Bash(gh issue list)",
      "Bash(gh issue view)",
      "Bash(gh repo view)",
      "Bash(gh api)",
      "Bash(ls)",
      "Bash(mkdir)",
      "Bash(./gradlew compileKotlin)",
      "Bash(./gradlew detekt)",
      "Bash(./gradlew test)",
      "Bash(./gradlew build)",
      "Bash(./gradlew --version)"
    ]
  }
}
```
