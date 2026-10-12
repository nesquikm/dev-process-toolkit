---
milestone: M_102cfa
status: active
archived_at: null
kickoff_branch: feat/m_102cfa-stored-video-style
frozen_at: null
migration: none
codename: House Style
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

- [ ] Add music.prompt and narration.tone to the style schema, defaults and video_init
  verify: parser accepts, caps and refuses fixtures; absent file yields the new defaults
- [ ] Pass the stored music prompt through the pipeline's music stage
  verify: recorded request body carries the stored prompt, or the upbeat default
- [ ] Pass bracket audio tags through ElevenLabs and strip them for Google
  verify: request fixtures for both adapters
- [ ] Teach the /video skill to read narration.tone and stop re-asking tone
  verify: skill-text pins for the tone read and the trimmed brief
- [ ] Pin the 590 guard's suite diff to 134fe2e6 and sweep for moving-main twins
  verify: guard passes on the branch and on a simulated merged main
- [ ] Run the mutation battery
  verify: each mutation applied and reddened its test

### Gate

- `bun test` from `plugins/dev-process-toolkit`: 0 fail, skip identities equal to main's baseline
- `/gate-check` clean
