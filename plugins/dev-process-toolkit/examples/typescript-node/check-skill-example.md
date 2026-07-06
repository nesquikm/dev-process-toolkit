---
name: taskboard-drive
description: Drive the running Task Board web UI in a real browser and assert the create-a-task journey end-to-end (navigate, click, type, read the DOM, check the console).
disable-model-invocation: true
allowed-tools: Bash, mcp__claude-in-chrome__navigate, mcp__claude-in-chrome__computer, mcp__claude-in-chrome__read_page, mcp__claude-in-chrome__read_console_messages
---

# taskboard-drive — Web UI runtime check

A worked example of a project-authored verification skill (a "check skill") for
a TypeScript/Vite web app. Copy this file to `.claude/skills/taskboard-drive/SKILL.md`
in your project and adapt the marked spots. It drives the **running Task Board
UI** in a real browser and asserts the user journey end-to-end — the thing your
Vitest component tests cannot see.

> Read the authoring guide — `docs/verification-skills.md` — before adapting
> this. It explains how `verify_skill: taskboard-drive` wires this skill into the
> `## Verification` hook so `/implement` runs it after the deterministic gates
> pass, and why `disable-model-invocation: true` keeps it opt-in.

## What this checks

The real front-end journey rendered in a browser — routing, interaction, dynamic
list updates, and console health. `tsc --noEmit`, `eslint`, and `vitest run` run
first and always win; this check adds the runtime UI behavior on top:

- [ ] `/board` renders the empty-state ("No tasks yet") with no console errors.
- [ ] Typing "Ship the release" into the new-task input and pressing Enter adds
      a card to the "To do" column.
- [ ] Clicking that card's checkbox moves it to the "Done" column and strikes
      the title through.
- [ ] Reloading the page keeps the task in "Done" (persisted to localStorage).

*Adapt:* replace the routes, copy, and selectors above with your app's real
journey. Keep it to the one or two flows that would embarrass you if they broke.

## How to run

1. **Start the dev server** and confirm it answers:

   ```bash
   # Adapt: your dev-server command + URL.
   bun run dev &            # or: npm run dev
   curl -s -o /dev/null -w "%{http_code}" http://localhost:5173/board
   ```

   If it is not `200`, wait a couple seconds for Vite to boot, then re-check.

2. **Prefer the duck when available.** If a rubber-duck MCP is configured, hand
   this checklist to `/dev-process-toolkit:visual-check` and let it drive Chrome
   and judge layout. Otherwise drive Chrome MCP directly (steps 3–4).

3. **Navigate + drive** with the Chrome MCP tools:
   - `mcp__claude-in-chrome__navigate` to `http://localhost:5173/board`.
   - `mcp__claude-in-chrome__read_page` to confirm the empty-state text and to
     locate the new-task input and the column containers.
   - `mcp__claude-in-chrome__computer` to type "Ship the release" + Enter, then
     click the new card's checkbox.
   - `mcp__claude-in-chrome__read_page` again to assert the card moved to "Done".

4. **Check the console** with `mcp__claude-in-chrome__read_console_messages`
   after the flow. Any JS error or unhandled promise rejection is a FAIL.

5. **Report** a pass/fail line per journey step:
   - ✓ what passed
   - ✗ what failed (with the path/selector where it broke)

## Notes

- `verify_skill: visual-check` is a valid shortcut if all you need is the generic
  visual pass — reach for this bespoke skill when the journey needs app logic
  (list reordering, persistence) that a generic pass would not exercise.
- The `disable-model-invocation: true` marker keeps this skill opt-in: it runs
  only when a workflow invokes it explicitly, never by autonomous model choice.
