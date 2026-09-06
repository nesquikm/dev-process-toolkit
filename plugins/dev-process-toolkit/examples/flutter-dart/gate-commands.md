# Flutter/Dart Gate Commands

## Gate Check Commands

```bash
fvm flutter analyze    # Static analysis (includes lint)
fvm flutter test       # Run all tests
make codegen           # Code generation (Freezed, json_serializable, Retrofit, auto_route)
                       # Assumes a Makefile target; raw command: dart run build_runner build --delete-conflicting-outputs
```

## TDD Patterns

- **Test runner:** flutter_test
- **Mocking:** mocktail (NOT mockito)
- **BLoC testing:** bloc_test package
- **Test location:** `test/` mirroring `lib/` structure
- **File naming:** `*_test.dart`
- **Code generation:** Run `make codegen` after modifying annotated classes

## Key Conventions

- Always use `fvm flutter` / `fvm dart` (never bare `flutter`/`dart`)
- Never manually edit `*.g.dart` or `*.freezed.dart` files
- Use `const` constructors for widgets
- Use `tryEmit()` for safe state emission in cubits
- Register dependencies in DI container

## Additional Skills

- `/codegen` — Run build_runner for code generation
- `/build-run` — Build or run the app with correct flavor
- `/l10n` — Add/update localization keys
- `/feature-scaffold` — Create feature module structure

These are skills you would author yourself — none of them ships with the plugin. Do NOT add a `/bump-version` skill: `pubspec.yaml`'s `version` field is written by `/ship-milestone` from the `## Release Files` block (see `examples/flutter-dart/release.yml`), and a second writer for one field is how a release silently disagrees with itself.

## Settings Example

> Cross-reference: the canonical-shape probe at `adapters/_shared/src/setup_permissions_shape.ts` empirically rejects glob-form `Bash(<cmd> *)` rules; the canonical allowlist lives in `templates/permissions.json` — both are the source of truth for the block below.

```json
{
  "permissions": {
    "allow": [
      "Bash(git status:*)",
      "Bash(git diff:*)",
      "Bash(git log:*)",
      "Bash(git show:*)",
      "Bash(git rev-parse:*)",
      "Bash(git ls-files:*)",
      "Bash(git branch:*)",
      "Bash(git blame:*)",
      "Bash(gh pr list:*)",
      "Bash(gh pr view:*)",
      "Bash(gh issue list:*)",
      "Bash(gh issue view:*)",
      "Bash(gh repo view:*)",
      "Bash(gh api:*)",
      "Bash(ls:*)",
      "Bash(mkdir:*)",
      "Bash(echo:*)",
      "Bash(flutter test:*)",
      "Bash(flutter analyze:*)",
      "Bash(flutter --version)",
      "Bash(fvm flutter:*)",
      "Bash(dart:*)"
    ]
  }
}
```
