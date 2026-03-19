---
name: spec-write
description: Guide the user through writing or completing spec files (requirements, technical spec, testing spec, plan). Use after /setup to fill in specs before implementation, or to update existing specs.
disable-model-invocation: true
argument-hint: '[requirements | technical | testing | plan | all]'
---

# Spec Write

Guide the user through writing or completing the project specification files.

## Process

### 1. Assess current state

Check which spec files exist in `specs/` and how complete they are:
- Read each file and determine: empty template, partially filled, or complete
- Report status to the user

If `specs/` doesn't exist, suggest running `/dev-process-toolkit:setup` first.

### 2. Determine scope

If `$ARGUMENTS` specifies a file (requirements, technical, testing, plan), work on that one.
If `$ARGUMENTS` is "all" or empty, work through all files in precedence order:

```
requirements.md → technical-spec.md → testing-spec.md → plan.md
```

This order matters because each spec builds on the previous one.

### 3. For each spec file

#### requirements.md (WHAT to build)

Ask the user:
- What is this project? Who is it for? What problem does it solve?
- What are the main features? (List them as functional requirements)
- For each feature: what are the acceptance criteria? (Binary pass/fail)
- What is explicitly out of scope?
- Any non-functional requirements? (Performance, security, accessibility)

Write the answers into the spec using the template structure (FR-1, AC-1.1, etc.).

#### technical-spec.md (HOW to build it)

Read `requirements.md` first to understand what needs building. Then ask:
- What's the high-level architecture? (Read existing code if any)
- What are the key design decisions and their rationale?
- What's the data model? (Schemas, types, database tables)
- What APIs or interfaces are needed?
- What are the key patterns? (State management, error handling, etc.)

Pre-fill what you can from the codebase and CLAUDE.md. Ask the user to confirm or correct.

#### testing-spec.md (HOW to test it)

Read `requirements.md` and `technical-spec.md`. Then:
- Pre-fill the test framework, mocking approach, and file conventions from CLAUDE.md
- Ask about coverage targets per layer
- Ask about test data strategy (factories, fixtures, seeds, frozen times)
- Identify what NOT to test (generated code, third-party internals)

Most of this can be inferred — present your best guess and let the user correct.

#### plan.md (WHEN to build it)

Read all other specs. Then:
- Break the requirements into milestones (each independently gatable)
- Order milestones by dependency
- For each milestone: list tasks in dependency order, acceptance criteria, and gate commands
- Draw the milestone dependency graph

Present the plan and ask for approval.

### 4. Review and confirm

After completing each spec file:
- Show the user what was written
- Ask for approval before saving
- Note any open questions or decisions that need human input

### 5. Report

Summarize what was completed:
- Which specs are done vs. still need work
- Any open questions flagged during the process
- Remind: "Run `/dev-process-toolkit:implement <milestone>` when specs are ready"

## Rules

- Work through specs in precedence order (requirements → technical → testing → plan)
- Each later spec should reference and build on earlier ones
- Ask the user for domain knowledge — don't invent requirements
- Pre-fill technical details from the codebase and CLAUDE.md where possible
- Present drafts for approval before saving — specs are the source of truth
- Keep acceptance criteria binary (pass/fail, not "good enough")
