# Technical Spec

## Architecture

Single-package Flutter app, no plugins. View-model layer is plain Dart
(no state-management library) until complexity warrants one.

## ADR-1: No state-management library at M1

- **Context:** Two screens, three pieces of state. A library adds boilerplate
  and a learning surface that isn't justified yet.
- **Decision:** Plain `ChangeNotifier` view models for M1–M2.
- **Reconsider when:** A third feature lands or cross-cutting state appears.
