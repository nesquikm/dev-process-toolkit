---
name: visual-check
description: Visually verify web UI using a rubber duck MCP with Chrome browser tools. Use after building or modifying web UI components.
argument-hint: '[page-path] [checklist items...]'
---

# Visual Check

Visually verify the web UI by using a rubber duck (MCP) with Chrome browser tools.

## Process

### 1. Ensure the dev server is running

<!-- ADAPT: Replace with your dev server URL and start command -->
Check if http://localhost:5173 is reachable:

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:5173
```

- If it returns `200`, proceed.
- If not, start the server (run in background), wait a few seconds, then re-check.

### 2. Ask a duck to verify the page

Use `ask_duck` to have a duck open the page in Chrome and verify it visually. The duck should NOT run shell commands — it should only use its Chrome/browser MCP tools.

The default page is `/` unless `$ARGUMENTS` specifies a different path.

#### Base verification (always check)

Ask the duck to open the page and report:
- Does the page render without errors?
- Is the layout correct (no broken styles, overlapping elements, missing content)?
- Are all expected UI elements visible?

#### Interaction testing (if applicable)

After verifying the base page, ask the duck to check interactive elements:
- Navigation between pages
- Filter/form changes via URL params
- Dynamic content updates

#### Custom checklist

If `$ARGUMENTS` includes specific items to check, verify those as well.

### 3. Report results

Summarize findings as a pass/fail checklist:
- ✓ Page renders correctly
- ✓ Layout and styling look good
- ✗ [Any issues found]

### 4. Clean up

Kill the dev server if you started it.

## Prerequisites

- A rubber duck MCP server with Chrome/browser tools must be configured (e.g., `mcp-rubber-duck`). Without it, the `ask_duck` calls will fail.

## Notes

- The duck uses Chrome browser MCP tools — it should NOT run shell commands
- For SPA pages, the duck needs to navigate to the full URL — WebFetch won't work for client-rendered apps
