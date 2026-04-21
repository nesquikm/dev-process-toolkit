# Requirements

## 1. Overview

Fixture input representing a minimal v1 tree: 3 active FRs, 2 archived milestones, 1 in-flight milestone. Used by migration round-trip test.

## 2. Functional Requirements

### FR-1: First Active Requirement {#FR-1}

Minimal active requirement; its technical design + testing live per-FR in the sibling spec files and must be co-located by migration.

**Acceptance Criteria:**
- AC-1.1: Requirement text stays intact after migration
- AC-1.2: Per-FR tech + testing content co-locates under the new FR file

### FR-2: Second Active Requirement {#FR-2}

Tracker-less FR (no frontmatter tracker after migration; empty `tracker: {}`).

**Acceptance Criteria:**
- AC-2.1: Tracker field is empty after migration
- AC-2.2: Filename stem equals frontmatter id

### FR-3: Third Active Requirement {#FR-3}

Belongs to in-flight milestone M99.

**Acceptance Criteria:**
- AC-3.1: Milestone frontmatter reads M99

## 3. Non-Functional Requirements

### NFR-1: Example NFR

Cross-cutting NFR preserved in slimmed requirements.md.

## 4. Edge Cases

Cross-cutting edge case preserved.

## 5. Out of Scope

Nothing.

## 6. Traceability Matrix

| Requirement | Implementation | Tests |
|-------------|---------------|-------|
| FR-1 | src/one.ts | tests/one.test.ts |
| FR-2 | src/two.ts | tests/two.test.ts |
| FR-3 | src/three.ts | tests/three.test.ts |
