---
milestone: M_102cfa
status: archived
archived_at: 2026-10-12T20:31:50Z
kickoff_branch: feat/m_102cfa-stored-video-style
frozen_at: null
migration: none
codename: House Style
shipped_in: v2.97.0
---

# Implementation Plan

## M_102cfa — Stored video style and merge-proof guards {#M_102cfa}

**Goal:** A project's videos should sound and feel the same every time, without anyone retyping the vibe. Today the music prompt is hard-coded to calm background music and the narration tone is asked fresh on every run. This milestone stores both in the project's style file and threads them through the pipeline. It also fixes the one test that went red on merged main after v2.96.0, because it measured its suite against a moving trunk.

**Prerequisites:** v2.96.0 merged at 24e25900 (PR #109). Merged-main gate: 18686 pass / 1 fail / 16 skip, the fail being the test this milestone fixes.

**Release target:** v2.97.0, a minor: new style keys (Added) and one Fixed FR.

**Operator rulings.** 2026-10-12 brainstorm (via /deliver): approach 1 of 3, extend style.yaml with music.prompt and narration.tone. Tone drives both the script and eleven_v4 audio tags placed in the script; the ElevenLabs adapter passes tags through and the Google adapter strips them. Default music prompt: the upbeat tech-explainer wording. The red test is pinned to 134fe2e6, never a moving main. Title and codename composed automatically.

**Migration:** none — both new keys are optional, and an existing style.yaml stays valid.

### FRs

| FR | Title | Tracker |
|----|-------|---------|
| STE-671 | Stored video style: music prompt and narration tone | linear:`STE-671` |
| STE-672 | Suite-edit guards measure against a pinned commit | linear:`STE-672` |

### Tasks

- [x] Add music.prompt and narration.tone to the style schema, defaults and video_init
  verify: parser accepts, caps and refuses fixtures; absent file yields the new defaults
- [x] Pass the stored music prompt through the pipeline's music stage
  verify: recorded request body carries the stored prompt, or the upbeat default
- [x] Pass bracket audio tags through ElevenLabs and strip them for Google
  verify: request fixtures for both adapters
- [x] Teach the /video skill to read narration.tone and stop re-asking tone
  verify: skill-text pins for the tone read and the trimmed brief
- [x] Pin the 590 guard's suite diff to 134fe2e6 and sweep for moving-main twins
  verify: guard passes on the branch and on a simulated merged main
- [x] Run the mutation battery
  verify: each mutation applied and reddened its test

### Recorded runs

- 2026-10-12, AC-STE-672.2: the fixed `tests/m_79b1f6-ste-590-offers-ask-the-gate.test.ts` in a detached worktree of merged trunk `24e25900` (outside temp, node_modules linked): 52 pass, 0 fail. Control, the unfixed suite in the same worktree: 51 pass, 1 fail (the m143-551 MUTATION test). On this branch: 52 pass, 0 fail.
- 2026-10-12, mutation battery: AC-STE-671.9 and AC-STE-672.3 run in-suite (each mutation asserted applied, each with an unmutated control); the music-stage lazy style read was mutation-checked by hand (unconditional read → its test red, source restored by hash).

### Gate

- `bun test` from `plugins/dev-process-toolkit`: 0 fail, skip identities equal to main's baseline
- `/gate-check` clean

<!-- token-stats:begin -->

## Token Stats

| scope | model | input | output | cache-read | cache-creation |
| --- | --- | ---: | ---: | ---: | ---: |
| dev-process-toolkit:gate-check | claude-opus-5-5 | 128 | 33794 | 23196253 | 263240 |
| dev-process-toolkit:implement | claude-opus-5-5 | 70 | 11644 | 3887126 | 198342 |
| dev-process-toolkit:ship-milestone | claude-opus-5-5 | 26 | 8756 | 5564651 | 54931 |
| dev-process-toolkit:tdd | claude-opus-5-5 | 20 | 9766 | 1533503 | 25300 |
| (main-loop) | claude-opus-5-5 | 428 | 90901 | 39954536 | 238810 |
| total |  | 672 | 154861 | 74136069 | 780623 |

<!-- token-stats:end -->
