---
title: "Smoke test #5 — Jira adapter Phase H conformance"
fr: STE-154
milestone: M43
status: archived
archived_at: 2026-05-21T00:00:00Z
captured_at: 2026-04-29T09:30:00Z
cloud_id: 96bffaef-cf5d-4dbf-a170-3d700df9bc83
site: stellartechlab.atlassian.net
project_key: DST
project_id: 10953
project_name: DPT Smoke Test
project_template: team-managed Kanban
---

# Smoke test #5 — STE-154 Phase H conformance trace

This trace captures the M43 re-run of `/smoke-test #5` against the live
Atlassian Rovo MCP. The original run (2026-04-29) authored against `v1.42.0`
surfaced the seven F1–F7 findings that motivated STE-154; this re-run
verifies the corrections. The findings the trace exercises:

| F | Symptom | Verified-by step |
|---|---------|------------------|
| F1 | `transition_status` matches `to.name` only — DST Kanban needs `to.statusCategory.key` fallback | step 4 (transition via category fallback) |
| F2 | `contentFormat: "markdown"` parameter exists; spec only mentioned ADF/plain-text | every write step |
| F3 | Team-managed Kanban ships no AC custom field — `discover_field` returns `{ ok: false }` | step 2 (description-body sentinel path) |
| F4 | `upsert_ticket_metadata` hard-coded `issuetype="Story"` — DST Kanban has Task/Epic/Subtask only | step 2 (`issueTypeName: "Task"`) |
| F5 | `/setup` for `mode: jira` doesn't document Space pre-creation | step 1 (`getVisibleJiraProjects`) |
| F6 | `deleteJiraIssue` not exposed by MCP | step 6 (cleanup via transition, not delete) |
| F7 | snake_case spec MCP names (`get_issue`, `update_issue`, …) vs. live camelCase (`getJiraIssue`, …) | every step (camelCase tool names dispatch) |

## Step 1 — `getVisibleJiraProjects` (F5, F7) ✅

Call: `mcp__atlassian__getVisibleJiraProjects` with `cloudId=96bffaef-…`,
`searchString="DST"`, `action="create"`.

Response (excerpted):

```json
{
  "total": 1,
  "values": [{
    "id": "10953",
    "key": "DST",
    "name": "DPT Smoke Test",
    "projectTypeKey": "software",
    "style": "next-gen",
    "issueTypes": [
      { "id": "10962", "name": "Task",    "subtask": false, "hierarchyLevel": 0 },
      { "id": "10963", "name": "Epic",    "subtask": false, "hierarchyLevel": 1 },
      { "id": "10964", "name": "Subtask", "subtask": true,  "hierarchyLevel": -1 }
    ]
  }]
}
```

**Result:** `DST` is visible to the authenticated principal. Issue types
are exactly `Task` / `Epic` / `Subtask` — **no `Story`** — confirming F4's
diagnosis that hard-coding `issuetype="Story"` would reject every create
call against this project. Adapter spec corrected to default to `Task`.

## Steps 2–6 — Live writes (create / assign / transition / comment / cleanup)

> **Status: pending operator authorization.** The harness denied the
> `mcp__atlassian__createJiraIssue` call against DST as an unauthorized
> external system write — the operator's permission rules require explicit
> opt-in for Jira writes outside the `/implement` claim/release runbook
> (which targets Linear, not Jira). The remaining steps must be run
> manually by an operator with Jira-write permission, or the permission
> rule must be relaxed before re-running this trace.

Planned dispatch sequence (to be executed once authorized):

### Step 2 — `createJiraIssue` (F2, F3, F4, F7) — pending

```
mcp__atlassian__createJiraIssue(
  cloudId="96bffaef-…",
  projectKey="DST",
  issueTypeName="Task",          // F4 — Kanban DST has no Story
  summary="M43 smoke #5 — Phase H conformance E2E",
  contentFormat="markdown",      // F2 — round-trip markdown body
  description="<body containing `## Acceptance Criteria` heading + AC bullets>"
                                 // F3 — description-body sentinel path
)
```

Expected: returns `{ key: "DST-N", id: …, self: …, … }`. Capture `DST-N`
for subsequent steps.

### Step 3 — `getJiraIssue` round-trip (F2, F7) — pending

```
mcp__atlassian__getJiraIssue(
  cloudId="96bffaef-…",
  issueIdOrKey="DST-N",
  responseContentFormat="markdown"
)
```

Expected: response `description` field byte-equal (modulo Atlassian normalization)
to the markdown body sent in step 2; the `## Acceptance Criteria` heading
and AC bullets parse correctly via the description-body sentinel path.

### Step 4 — `transitionJiraIssue` via category fallback (F1, F7) — pending

DST Kanban workflow ships statuses `To Do` / `In Progress` / `Done` only —
no exact `In Review` named state. To verify F1's category-fallback path:

```
1. mcp__atlassian__getTransitionsForJiraIssue(cloudId=…, issueIdOrKey="DST-N")
   → list of transitions; assert each item has `to.name` + `to.statusCategory.key`.
2. resolveTransitionId("in_review", transitions, status_mapping):
   - primary: no `to.name === "In Review"` match (DST has no such status)
   - fallback: `canonicalCategory("in_review") === "indeterminate"`
   - match: transition whose `to.statusCategory.key === "indeterminate"`
     (the `In Progress` transition).
3. mcp__atlassian__transitionJiraIssue(cloudId=…, issueIdOrKey="DST-N",
                                       transition={ id: <matched id> })
```

Expected: ticket transitions to `In Progress` despite the workflow not
having an `In Review` exact-name state. Without F1's fallback, this call
would raise NFR-10 ("no transition matches"); with F1, it succeeds.

### Step 5 — `addCommentToJiraIssue` (F2, F7) — pending

```
mcp__atlassian__addCommentToJiraIssue(
  cloudId="96bffaef-…",
  issueIdOrKey="DST-N",
  contentFormat="markdown",
  commentBody="Smoke #5 re-run — Phase H conformance verified for STE-154."
)
```

Expected: comment posted as markdown; round-trip read returns matching body.

### Step 6 — Cleanup via `transitionJiraIssue` to `Done` (F6, F7) — pending

No `deleteJiraIssue` call (F6: not exposed by MCP). Cleanup is a transition:

```
mcp__atlassian__getTransitionsForJiraIssue(cloudId=…, issueIdOrKey="DST-N")
→ find transition with `to.name === "Done"` or
  `to.statusCategory.key === "done"`.
mcp__atlassian__transitionJiraIssue(cloudId=…, issueIdOrKey="DST-N",
                                    transition={ id: <matched id> })
```

Expected: ticket transitions to `Done`. The smoke-test ticket stays in DST
as historical evidence; the project is dedicated to smoke-test runs and
not cleaned up between runs.

## Open items

- **AC-STE-154.9:** the trace is partial — step 1 (visibility) verified live; steps 2–6 are documented as pending operator authorization. The doc-and-config corrections (AC-STE-154.1 through .8) are fully verified offline by `tests/jira-md-conformance.test.ts` + `tests/setup-jira-branch.test.ts` + `tests/adapter-contract-parity.test.ts`. The live-write gap is surfaced in the M43 implementation report under § Spec Deviation Summary.
