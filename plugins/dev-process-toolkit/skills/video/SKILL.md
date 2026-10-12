---
name: video
description: Turn a feature into a finished explainer video in your own session. `/video init` writes the video settings and names the key to add; `/video <slug>` asks the brief, checks every technical claim against the code, drafts a script with shots, and voices, records and renders only after the script is approved.
argument-hint: 'init | <slug>'
---

# Video

User-invocable surface that takes a feature to a finished explainer video. The skill is thin: research and script writing stay in this session, and everything else goes through two front doors — `adapters/_shared/src/video_init.ts` (setup) and `adapters/_shared/src/video_pipeline.ts` (the cached stage pipeline). The pipeline runs in the invoking session, never in hidden subagents.

Schemas, provider/recorder details and worked examples live in `docs/video-reference.md`.

## Subcommand router

Parse `$ARGUMENTS` and route on the first token:

- `init` → **Setup**.
- anything else → treat it as the video `<slug>` → **Run**.

## Setup — `/video init`

Ask for the TTS provider, the recorder and the music source, one question at a time, then run `video_init.ts <projectRoot> <provider> <recorder> <music>`. It writes `config.yaml`, a default `style.yaml` and `scenarios/`, ensures the `.dpt/.gitignore` lines, and prints the key variable name to put in `.dpt/.env`. Never ask for a key and never write `.dpt/.env`.

## Run — `/video <slug>`

Run the steps below in order, in this session. The pipeline runs in the invoking session, never in hidden subagents. Every stage command is `bun run ${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/video_pipeline.ts <projectRoot> <slug> <stage>`; the front door re-checks readiness and refuses every stage after `script` unless the approval record matches the current `script.md` hash. Never ask for an API key and never write one anywhere.

### 1. Readiness

Run `bun run ${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/video_readiness.ts <projectRoot>`. It prints `ready`, or one reason per line. When it is not ready, show the reasons and stop (suggest `/video init` when the settings are missing).

### 2. Brief

Ask each brief question as its own `AskUserQuestion` call, one question at a time, in this order:

1. The feature to explain.
2. The audience.
3. The length.
4. Demo or technical depth.
5. Tone and humor.

When `narration.tone` in `style.yaml` is non-empty, it is the house style: skip the tone half of question 5 and ask about humor only.

Never bundle two questions into one `AskUserQuestion` call.

### 3. Research

Read the code behind the feature. Record each technical claim the video will make together with its source location (`path:line`). A claim with no source location does not go into the script.

### 4. Script

Write `script.md` in the work dir (`videoWorkDir(slug)`) with the narration and a shot list, each claim carrying its source location, then run the `script` stage to confirm it is in place.

Read `narration.tone` from `style.yaml` as the house style and write the narration in that tone. Audio tags such as `[excited]` or `[laughs]` set the delivery: ElevenLabs passes square-bracket tags through untouched, and Google strips them before synthesis, so never rely on a tag to carry meaning.

### 5. Script approval

Show the developer `script.md` and wait for an explicit approval. Only after the human approves, run the `approve-script` stage, which records the script's hash. If the script changes later, the approval no longer matches and every later stage refuses until `approve-script` runs again.

### 6. Voice

Write `segments.json` in the work dir (the narration split into numbered segments), then run the `voice` stage.

### 7. Record

Write `shots.json` in the work dir (the shot list the recorder plays), then run the `record` stage.

### 8. Music

Run the `music` stage.

### 9. Edit list

Write `edl.json` in the work dir, then run the `edl` stage.

### 10. Render

Run the `render` stage.

### 11. QA

Run the `qa` stage and fix what it reports before the review.

### 12. Final-cut review

This step always runs, driven-run marker or not. Show the developer the final cut. They either approve it, or send it back to the script (return to step 4; the changed script needs a fresh approval) or to the edit (return to step 9).

Stage inputs, cache layout and worked examples live in `docs/video-reference.md`.

## Closing report

**Driven runs.** Omit this offer when the invocation body carries the driven-run marker: the step it offers was already fixed by the orchestrator that named it. The offer is the `/video init` suggestion on a not-ready project; standalone runs still make it.

**Closing summary — the status block.** `/video` closes with **exactly one** `stage-status-block` fence as the LAST thing in its report, with at most 12 lines of prose lead-in above it. The block carries a `stages run: <K> (<D> done, <R> refused)` `summary:` row plus **at most the first 3** as `first 3 of <K>` rows; the total `<K>` is always stated, so the bound is never a silent truncation. Fixed section order, the `- (none found)` fallback and the caps live in `docs/stage-status-block.md`; adoption is graded by `adapters/_shared/src/stage_block_adoption.ts`. Skip this block when the invocation body carries the driven-run marker: the orchestrator drives the next step in the same turn.

```stage-status-block
stage: video   # then milestone, status, summary, gate, drive, e2e, follow_ups in fixed order — docs/stage-status-block.md
```
