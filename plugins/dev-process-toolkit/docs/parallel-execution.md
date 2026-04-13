# Parallel Execution Patterns

> **Advisory only.** The patterns below are opt-in suggestions for fan-out-friendly work. `/implement`'s default flow is sequential; parallelization is something you reach for when the task graph genuinely benefits from it, not a standing requirement.

This doc covers three ways to run work in parallel alongside `/implement`:

1. **Native subagents** — one-shot task isolation via the `Agent` tool.
2. **Agent-teams** — ongoing multi-agent collaboration with shared task state.
3. **Worktree-per-subagent isolation** — git-level isolation so parallel workers don't step on each other.

The value of each is **context isolation first, wall-clock second**. Parallel execution lets you keep the parent skill's context clean of review noise, partitioned file edits, or side-quest research.

## Native Subagents

See the [Claude Code sub-agents documentation](https://code.claude.com/docs/en/sub-agents) for the full primitive.

**When to use with `/implement`:** Reach for a native subagent whenever a discrete piece of the milestone benefits from running in its own context — typically when the subagent's output should not influence the parent's ongoing reasoning. Canonical fits:

- **Code review** — Phase 3 Stage B already delegates to `code-reviewer` via `Agent` (two passes as of v1.13.0). The reviewer reads the diff cold, without being anchored by the builder's rationalizations.
- **Research side-quests** — When Phase 1 needs to explore an unfamiliar dependency or API, dispatch a subagent with the narrow question, harvest its report, and continue the parent flow without polluting the build context with docs pages.
- **Fan-out during Phase 2** — If a milestone has ≥3 tasks that touch fully disjoint files (see *Worktree-per-Subagent Isolation* below), dispatching each task to its own subagent keeps the parent free to orchestrate instead of switching contexts.

**When not to use:** A subagent can't resume long-lived state or coordinate with peers. For anything that needs back-and-forth across multiple conversation turns, use agent-teams instead.

## Agent-Teams

See the [Claude Code agent-teams documentation](https://code.claude.com/docs/en/agent-teams) for setup and lifecycle details.

**Differential with subagents:** teams for ongoing collaboration; subagents for one-shot task isolation. A team persists across multiple turns and can hand tasks back and forth; a subagent runs once and returns.

**Direct skill invocation from subagents.** As of v1.13.0, a team-member subagent can invoke `/implement` and `/pr` directly via the `Skill` tool — both skills dropped their `disable-model-invocation` flag (FR-27). No workaround (reading `SKILL.md` body manually to execute its phases by hand) is needed; the lead dispatches the milestone and the worker runs `/dev-process-toolkit:implement M{N}` from its own context. `/setup` keeps the flag because a subagent re-running project bootstrap mid-flight would clobber the working tree.

**When to use with `/implement`:**

- **Multi-milestone sequential runs** — When the user runs `/implement all`, a team lead can own the plan graph while worker agents execute individual milestones, messaging the lead at each Phase 4 approval gate. This is the "team lead + implementer" pattern used by this toolkit itself when running M10 dogfood.
- **Cross-cutting refactors** — A refactor that spans multiple modules with real interaction (shared types, migration ordering) benefits from ongoing coordination. One agent per module, team lead resolves interface conflicts.

**When not to use:** Solo features, single-milestone work, or any task where one subagent invocation can do the whole job. Teams have setup cost; pay it only when the coordination value is there.

**Concrete examples:**

- **Subagent example:** Phase 3 Stage B Pass 1 fires a `code-reviewer` subagent with the AC checklist and changed files, waits for `OVERALL: OK` or `OVERALL: CONCERNS (N)`, integrates, moves on. One turn, one return value.
- **Team example:** A 5-milestone `/implement all` run uses a team: lead reads `plan.md`, dispatches M1 to worker A with a worktree, receives completion, approves Phase 4, dispatches M2 to worker B in a fresh worktree, etc. Lead and workers exchange messages across ~50 conversation turns.

## Worktree-per-Subagent Isolation

Git worktrees let parallel workers edit the repo without fighting over the index. Pair one worktree with one subagent (or one team member) and the isolation is complete: each worker has its own checkout, its own branch, its own dependencies installed.

**Setup:**

- One worktree per parallel agent. Branch name should encode the task (e.g., `m10-task-4-parallel-docs`).
- The parent orchestrator creates worktrees before dispatching (`git worktree add ../<branch-name> -b <branch-name>`), not the subagent itself. Subagents receive the working-directory path in their initial brief.
- Each subagent installs its own dependencies inside its worktree (`npm install`, `uv sync`, `cargo build`, etc.) — the parent's `node_modules` is not shared.

**Merge-back:**

Use the same merge-back options `/implement` offers for single-worktree runs — they compose:

1. **Cherry-pick completed commits** onto `main` (`git checkout main && git cherry-pick <hash>...`).
2. **Keep the worktree as a feature branch** for PR review, merge via the usual PR flow.
3. **Discard the worktree** entirely if the work didn't pan out (`git worktree remove <path> --force`).

The `/implement` Partial Failure Recovery section covers what to do when *some* parallel workers succeeded and others failed — cherry-pick the winners, decide case-by-case on the rest.

**Conflict avoidance: partition by file.**

The single most important rule: **never dispatch two parallel workers onto overlapping files.** Parallelism is fast only when merge-back is trivial; it is trivial only when each worker owns a disjoint slice of the filesystem.

Concrete partitioning tactics:

- **Per-module slicing** — `src/auth/` goes to worker A, `src/billing/` goes to worker B. Zero overlap.
- **Per-layer slicing** — models go to worker A, services go to worker B, views go to worker C. Only works if the layers are decoupled (no shared interface under active change).
- **Per-doc slicing** — docs tasks fan out extremely well; each worker owns one file in `docs/`.

Shared files (barrel exports, `index.ts`, `CLAUDE.md`, changelogs) are landmines. If parallel tasks must touch the same shared file, serialize the writes — one worker appends, the next worker pulls and rebases, or the parent orchestrator does the shared-file edit after all workers finish.

**Dogfood pointer:** the M10 release itself was implemented under a team-lead + implementer pair using this pattern. The implementer ran inside a worktree, the lead held the approval gate and the merge-back decision.
