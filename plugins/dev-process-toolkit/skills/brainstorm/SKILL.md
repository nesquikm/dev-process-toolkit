---
name: brainstorm
description: Socratic design session for greenfield features with open solution spaces. Clarifies goals one question at a time, proposes 2-3 approaches with tradeoffs, gets design approval, then feeds into /spec-write.
argument-hint: '<feature or problem description>'
---

# Brainstorm

Run a structured design session for: `$ARGUMENTS`

## When to Use This

Use `/brainstorm` before `/spec-write` when the solution space is genuinely open — you have a goal but not yet a clear approach. For features where the design is already settled, go straight to `/spec-write`.

## Process

### 1. Clarify the Problem

Ask **one clarifying question at a time** until you have a clear picture of:

- The core problem being solved (not the proposed solution)
- Who the user or stakeholder is and what they actually need
- What constraints exist (technical, time, compatibility)
- What success looks like as a measurable outcome

Wait for the answer before asking the next question. Don't batch all questions upfront — ask one, get the answer, then ask the next if still needed. Usually 2–4 questions are enough.

### 2. Explore Approaches

Once the problem is clear, propose **2–3 distinct approaches**. For each:

- Describe the approach in 2–3 sentences
- List the key tradeoffs: what it makes easy vs. what it makes harder
- Name the main risk or unknown

Present them as a numbered list so the user can refer to them by number.

### 3. Get Design Approval

Ask the user to pick an approach or describe a hybrid. If they want to modify one, discuss the implications of the change.

Do not proceed to spec writing until the user explicitly approves a direction. This is the handoff contract: the brainstorm session ends with a clear, human-approved design decision.

### 4. Hand Off to Spec Write

Once the design is approved:

1. Summarize the approved decision in 2–3 sentences
2. Transition: "Design approved. Run `/dev-process-toolkit:spec-write` and reference this decision, or I can start now."
3. If the user says to start now, proceed into the `/dev-process-toolkit:spec-write` flow using the approved design as input — the design decision answers the "HOW" questions in `technical-spec.md`

## Rules

- Ask one clarifying question per turn. Wait for the answer before asking the next. This rule holds at phase transitions too — when two questions look independent, still ask the first, wait, then ask the second.
- Present real tradeoffs, not strawmen — each approach should be genuinely viable
- Do NOT write code or spec content during brainstorming
- Do NOT proceed to spec writing without explicit design approval
- The goal is a clear, approved design decision — not an exhaustive analysis

### Rationalization Prevention

The one-at-a-time rule fails most often at phase transitions and when the user is being responsive. The excuses below are the ones to watch for — stop and ask only the first question each time.

| Excuse | Reality |
|--------|---------|
| These two questions are independent | Ask the first, wait, then the second |
| Efficiency wins — batch them | Efficiency ≠ batching; the socratic form is the gate |
| The user is responsive, I'll batch | Responsiveness is not license to batch |
| We're at the handoff, last chance | Phase transitions are where batching happens most — same rule applies |
