# Requirements

## 1. Overview

Baseline fixture project. Two FRs. No tracker integration.

## 2. Functional Requirements

### FR-1: Greet a named user {#FR-1}

**Acceptance Criteria:**
- AC-1.1: `greet(name)` returns `Hello, {name}!`
- AC-1.2: Empty name returns `Hello, world!`

### FR-2: Sum two numbers {#FR-2}

**Acceptance Criteria:**
- AC-2.1: `sum(a, b)` returns `a + b`
- AC-2.2: Non-number inputs throw `TypeError`

## 3. Non-Functional Requirements

- NFR-1: Each source file ≤ 200 lines.

## 6. Traceability Matrix

| Requirement | Implementation | Tests |
|-------------|---------------|-------|
| FR-1 AC-1.1 | src/util.ts | tests/util.test.ts |
| FR-1 AC-1.2 | src/util.ts | tests/util.test.ts |
| FR-2 AC-2.1 | src/util.ts | tests/util.test.ts |
| FR-2 AC-2.2 | src/util.ts | tests/util.test.ts |
