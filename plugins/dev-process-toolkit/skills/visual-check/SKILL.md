---
name: visual-check
description: Visually verify web UI using a rubber duck MCP with Chrome browser tools. Use after building or modifying web UI components.
argument-hint: '[page-path] [checklist items...]'
---

# Visual Check

Visually verify the web UI by using a rubber duck (MCP) with Chrome browser tools.

## Process

### 0. Check MCP availability

Before anything else, check if the rubber duck MCP is available:

1. Attempt a `list_ducks` MCP call
2. If the call succeeds, proceed to step 1

If the call fails or returns an error, MCP is unavailable. Display:

> ⚠️ `mcp-rubber-duck is not configured`. See [setup instructions](https://github.com/nesquikm/mcp-rubber-duck) to enable automated visual verification.

Then fall back to the manual verification path below.

### Manual Verification Checklist

When MCP is unavailable, guide the user through manual checks:

- [ ] **Layout correctness** — Page structure matches the design, no overlapping or misaligned elements
- [ ] **Responsive behavior** — Page renders correctly at mobile (375px), tablet (768px), and desktop (1280px) widths
- [ ] **Accessibility basics** — Interactive elements are keyboard-navigable, images have alt text, color contrast is sufficient
- [ ] **Browser console errors** — No JavaScript errors or unhandled promise rejections in the console
- [ ] **Visual regressions** — No unintended changes compared to the previous known-good state

Report results as a pass/fail summary:
- ✓ Description of what passed
- ✗ Description of what failed

Then skip to step 4 (clean up).

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

- **Optional:** [mcp-rubber-duck](https://github.com/nesquikm/mcp-rubber-duck) — an MCP server that delegates tasks to independent AI "ducks," each with their own tools and context. Improves quality through cross-model evaluation and enables this skill to have a duck visually inspect pages in Chrome. Without it, the `ask_duck` calls will fail and this skill won't work.
- `chrome-devtools-mcp` should be configured in `.mcp.json` for direct Chrome access from Claude Code. The duck may also have its own Chrome MCP tools configured separately. `/setup` configures `.mcp.json` automatically for web-based stacks.

## Notes

- The duck uses Chrome browser MCP tools — it should NOT run shell commands
- For SPA pages, the duck needs to navigate to the full URL — WebFetch won't work for client-rendered apps
