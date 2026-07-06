---
name: notes-app-drive
description: Drive the running Notes Flutter app end-to-end and assert the create-a-note journey (widget tree, taps, typed input, no runtime errors).
disable-model-invocation: true
allowed-tools: Bash, Read, mcp__dart__connect_dart_tooling_daemon, mcp__dart__get_widget_tree, mcp__dart__get_runtime_errors, mcp__dart__hot_reload
---

# notes-app-drive — Flutter runtime check

A worked example of a project-authored verification skill (a "check skill") for
a Flutter/Dart app. Copy this file to `.claude/skills/notes-app-drive/SKILL.md`
in your project and adapt the marked spots. Modeled on a `glacy-drive`-style
skill, it drives the **running Notes app** on a device/simulator — connect to
the live app, read the widget tree, tap and type, then confirm the expected
screen with no runtime errors. This is what `flutter test` cannot see.

> Read the authoring guide — `docs/verification-skills.md` — before adapting
> this. It explains how `verify_skill: notes-app-drive` wires this skill into the
> `## Verification` hook so `/implement` runs it after the analyzer and
> `flutter test` pass, and why `disable-model-invocation: true` keeps it opt-in.

## What this checks

The end-to-end runtime journey a user walks through, exercised against the app
running on a real device or simulator. `dart analyze` and `flutter test` run
first and always win; this check adds the runtime behavior those gates cannot
see:

- [ ] App launches to the notes list (route `/`) with no runtime exceptions.
- [ ] Tapping the FAB (key `add_note_fab`) opens the editor screen.
- [ ] Typing "Buy milk" into the body field (key `note_body_field`) and tapping
      Save returns to the list with a "Buy milk" tile visible.
- [ ] The widget tree contains exactly one `NoteTile` after the flow, and
      `get_runtime_errors` reports none.

*Adapt:* replace the routes, widget keys, and sample text above with your app's
real journey. Pick the one flow whose breakage would ship a broken app.

## How to run

1. **Boot the app in debug mode** so the Dart Tooling Daemon is reachable:

   ```bash
   # Adapt: your target device id (flutter devices) and entrypoint.
   flutter run -d <device-id> --debug
   ```

2. **Connect** to the running app with `mcp__dart__connect_dart_tooling_daemon`.
   *Adapt:* the interaction tool names below assume the dart/Flutter MCP in your
   `.mcp.json` — swap them for the tap/enter-text tools your MCP actually exposes.

3. **Drive the journey.** For each step in *What this checks*:
   - Read the current UI with `mcp__dart__get_widget_tree` and locate the target
     by its `Key` (e.g. `add_note_fab`, `note_body_field`).
   - Tap or type into it via your MCP's interaction tool.
   - Use `mcp__dart__hot_reload` only if a step requires re-running after a code
     edit — a plain drive does not need it.

4. **Assert no runtime errors** via `mcp__dart__get_runtime_errors` after the
   final step. Any uncaught exception or red error screen is a FAIL, even if the
   widget you expected is present.

5. **Report** a pass/fail line per journey step:
   - ✓ what passed
   - ✗ what failed (with the widget key / route where it broke)

## Notes

- Keep the run hermetic: if the flow writes to a local store, clear it (or use a
  throwaway profile) so the check is repeatable.
- The `disable-model-invocation: true` marker keeps this skill opt-in: it runs
  only when a workflow invokes it explicitly, never by autonomous model choice.
