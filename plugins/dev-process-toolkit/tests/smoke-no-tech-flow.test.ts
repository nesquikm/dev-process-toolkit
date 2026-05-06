// STE-227 AC-STE-227.11 — Smoke fixture for the end-to-end --no-tech flow.
//
// Phase 2.X group N covers:
//   /spec-write --no-tech creates flagged FR
//   → /implement <FR-id> refuses
//   → /spec-write <FR-id> completes
//   → /implement <FR-id> proceeds
//   → archival lands.
//
// Both adapters (Linear + Jira).
//
// **Deferred per memory `feedback_smoke_post_ship_retroactive`.** The smoke
// driver runs at /conformance-loop time outside this TDD cycle. The TDD
// directive for AC.11 is explicit: "treat AC.11 as deferred — write a
// skip()-marked test or test stub documenting the deferred status; the test
// should not gate this run."
//
// This file documents the deferred status so the gate-check probe-26
// notes-scanner picks it up and the operator sees the deferral in the
// closing summary.

import { describe, test } from "bun:test";

describe("AC-STE-227.11 — smoke fixture for end-to-end --no-tech flow [DEFERRED]", () => {
  test.skip(
    "Phase 2.X group N: /spec-write --no-tech → /implement refuses → /spec-write completes → /implement proceeds → archival (Linear)",
    () => {
      // Deferred. Lands at /conformance-loop time per
      // memory `feedback_smoke_post_ship_retroactive`. The end-to-end
      // smoke walks the full lifecycle on the Linear adapter:
      //   1. /spec-write --no-tech feature-prose
      //      → flagged FR lands in specs/frs/<id>.md with
      //        `needs_technical_review: true` frontmatter
      //      → tracker ticket created with `needs-technical-review` label
      //   2. /implement <FR-id>
      //      → refuses at Phase 0.b′ with NFR-10 canonical refusal
      //      → no claim, no branch, zero side effects
      //   3. /spec-write <FR-id> (no flag)
      //      → auto-detects flag at § 0a, runs technical+testing interview
      //      → on save, flag removed from frontmatter, label removed from
      //        tracker
      //   4. /implement <FR-id>
      //      → proceeds normally through Phase 0.b′ (flag is gone)
      //   5. Archival
      //      → FR archived to specs/frs/archive/, tracker → Done
    },
  );

  test.skip(
    "Phase 2.X group N: /spec-write --no-tech → /implement refuses → /spec-write completes → /implement proceeds → archival (Jira)",
    () => {
      // Deferred. Mirrors the Linear walk on the Jira adapter — same
      // behavioral assertions, different adapter wiring. Validates that
      // both label-supporting tracker adapters honor the
      // needs_technical_review label-push contract from AC.3 and the
      // refusal contract from AC.6.
    },
  );
});
