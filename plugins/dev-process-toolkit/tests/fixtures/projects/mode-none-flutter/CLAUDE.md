# Flutter Fixture

Real-shape downstream Flutter project used to widen pre-M12 `mode: none`
baseline coverage beyond the Node/TypeScript canonical fixture.
This file intentionally omits any `## Task Tracking` section — absence
is the canonical form for `mode: none` (FR-29 AC-29.5).

## Tech Stack

- **Language:** Dart
- **Framework:** Flutter (stable channel)
- **Build:** flutter build
- **Testing:** flutter test
- **Linting:** flutter analyze (`analysis_options.yaml`)

## Architecture

```
lib/
├── main.dart
├── app/
│   ├── router.dart
│   └── theme.dart
└── features/
    └── home/
        ├── home_page.dart
        └── home_view_model.dart
test/
└── home_test.dart
```

## Key Commands

```bash
flutter analyze
flutter test
flutter pub get
```

**Gating rule:** `flutter analyze && flutter test`

## Workflows

**Bugfix:** `/debug → /implement → /gate-check → /pr`
**Feature:** `/brainstorm → /spec-write → /implement → /spec-review → /gate-check → /pr`
**Refactor:** `/implement → /simplify → /gate-check → /pr`

## DO NOT

- Do not commit without user approval
- Do not add features not in the spec
- Do not edit generated files (*.g.dart, *.freezed.dart, *.mocks.dart)
- Do not connect to real external services from tests
