# /video reference

Overflow for `skills/video/SKILL.md`: the details the skill points at instead of carrying inline.

## Front doors

### `adapters/_shared/src/video_init.ts <projectRoot> <provider> <recorder> <music>`

- Writes `config.yaml` with the three chosen values plus the placeholders a fresh config needs to parse: `tts.voice` (`21m00Tcm4TlvDq8ikWAM` for `elevenlabs`, `en-US-Neural2-D` for `google`), `recorder.device: booted` for `ios-sim`, `recorder.command: [bash, scripts/record.sh]` for `command`, and `music.file: music.mp3` for `music: file`. Tune them by hand afterwards.
- Writes `style.yaml` with the documented defaults spelled out (pacing, captions, music level, banned effects, humor, layout viewport), only when no `style.yaml` exists yet.
- Creates `scenarios/`, runs `writeDptGitignore`, and prints the key variable name the chosen provider reads from `.dpt/.env`. It never asks for, reads or writes a key.
- Refuses (NFR-10 shape, exit 1) to overwrite an existing `config.yaml`, and refuses an unknown provider, recorder or music source; both refusals happen before anything is written.

### `adapters/_shared/src/video_pipeline.ts <projectRoot> <slug> <stage>`

Runs one stage against the work dir `.dpt/video/work/<slug>/`. Stages, in pipeline order: `script`, `approve-script`, `voice`, `record`, `music`, `edl`, `render`, `qa`. Any other stage name is refused.

- **Readiness first.** A not-ready project is refused at every stage, with the readiness reasons, before any approval check, provider call or recording.
- **Approval gate.** `approve-script` writes `script-approval.json` (the SHA-256 of the current `script.md` and an `approvedAt` timestamp). Every stage after `approve-script` is refused unless that record exists and its hash matches the current `script.md`; editing `script.md` re-arms the refusal.
- **Work-dir inputs.** The session writes these; a stage that needs a missing one refuses naming it:

  | Stage | Reads |
  |---|---|
  | `script` | `script.md` (checks it exists) |
  | `approve-script` | `script.md` |
  | `voice` | `segments.json` — synthesises each segment with the configured provider |
  | `record` | `shots.json` — records each shot with the configured recorder |
  | `music` | `segments.json`, `alignment/<n>.json` — resolves a track for the planned length (the sum of each segment's last word end) |
  | `edl` | `edl.json` — validates it |
  | `render` | `segments.json`, `edl.json`, `style.yaml` — renders `final.mp4` |
  | `qa` | `edl.json`, `final.mp4` — refuses listing every problem found |

### `segments.json`

The narration, split into the segments the `voice` stage synthesises: `[{ index, text }]`. `index` is the segment number (it names `alignment/<index>.json` and the segment's audio); `text` is the line spoken. `voice` writes one `alignment/<n>.json` per segment with its word timings, and `music` plans the track length from the last word end of each.

### `shots.json`

The shots the `record` stage captures, one object per shot:

- `id` — the shot id; names `clips/<id>.mp4` and `markers/<id>.json`.
- `scenario` — what the shot shows, in words.
- `durationHint` — the expected length in seconds (the `android-emu` recorder refuses more than 180).
- `recorder` — optional; overrides the configured recorder for this shot.
- `driver` — the argv that drives the app while `ios-sim` or `android-emu` records; those recorders refuse a shot without one.
- `footage` — optional `{ file, markers? }` for the `footage` recorder: `file` is relative to the footage dir `.dpt/video/footage/`, and `markers` is an optional `[{ name, t }]` list.

## Approval stops

Two: the script (before any voice, recording or music) and the final cut (approve, or send back to the script or the edit).

## Recorders

See `docs/video-recorders.md`.
