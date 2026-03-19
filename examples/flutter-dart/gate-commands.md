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
- `/bump-version` — Increment version in pubspec.yaml

## Settings Example

```json
{
  "permissions": {
    "allow": [
      "Bash(fvm *)",
      "Bash(make *)",
      "Bash(git *)",
      "Bash(gh *)"
    ]
  }
}
```
