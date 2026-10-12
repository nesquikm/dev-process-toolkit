# Video Recorders — The Recorder Contract

A feature explainer video is cut from per-shot clips. Whatever records a shot — committed footage, or a program the project supplies — hands the edit the same two files, and a checker confirms them before the edit uses them. This page states that contract so a project can build its own recorder without reading toolkit code.

## The contract

A recorder receives one shot:

| Field | Meaning |
| --- | --- |
| `id` | The shot's identifier; it names both output files. |
| `scenario` | The scenario the shot demonstrates. |
| `durationHint` | The intended length in seconds. A hint, not a limit. |

For that shot it must produce two files in the video's work dir, `.dpt/video/work/<slug>/` (machine-local, git-ignored):

| File | Content |
| --- | --- |
| `clips/<id>.mp4` | The recorded clip. |
| `markers/<id>.json` | A JSON array of named moments, `[{ "name": "...", "t": 1.25 }]`, with `t` in seconds from the start of the clip. |

## Validation

Every recording is checked before the edit uses it. A recording is refused, naming the shot, when:

- `clips/<id>.mp4` or `markers/<id>.json` is missing;
- the clip is not readable by `ffprobe`, or has no video stream;
- the markers file is not a JSON array of `{ name, t }` objects;
- a marker's `t` is smaller than the one before it (markers must be non-decreasing);
- a marker's `t` is past the clip's duration.

An empty markers array (`[]`) is valid.

## Choosing a recorder

The project default lives in `.dpt/video/config.yaml` under `recorder.kind`. Two kinds need no toolkit-side capture: `footage` and `command`.

### Footage recorder

```yaml
recorder:
  kind: footage
```

The footage recorder maps each shot id to a file under `.dpt/video/footage/`, transcodes that file to `clips/<id>.mp4`, and writes `markers/<id>.json` from the mapping's markers, or `[]` when the mapping names none. A shot with no mapping, or a mapping to a file that does not exist, is refused naming the shot and the path.

### Command recorder

```yaml
recorder:
  kind: command
  command: [bash, scripts/record-shot.sh]
```

The command recorder runs `recorder.command` — an argv list, not a shell string — once per shot, with the working directory set to the project root and these environment variables set:

| Variable | Value |
| --- | --- |
| `DPT_VIDEO_SHOT` | The shot's `id`. |
| `DPT_VIDEO_SCENARIO` | The shot's `scenario`. |
| `DPT_VIDEO_OUT_CLIP` | Absolute path the clip must be written to (`.../clips/<id>.mp4`). |
| `DPT_VIDEO_OUT_MARKERS` | Absolute path the markers must be written to (`.../markers/<id>.json`). |

The `clips/` and `markers/` directories already exist when the command starts. The command must exit 0 after writing both files. A non-zero exit, or an exit 0 without a recording that passes [validation](#validation), is refused naming the shot and quoting the last 20 lines of the command's stderr — so write diagnostics to stderr.

The variable list is a single exported constant, `RECORDER_ENV` in `adapters/_shared/src/video/recorder.ts`; a test reads it and this page together, so a renamed variable reds until this table follows.

## Per-shot override

A shot may name its own recorder kind with `recorder: <kind>`, overriding the project default for that shot only. In a project whose default is `command`, a shot declaring `recorder: footage` is recorded from its footage mapping, and every other shot by the command. A shot can override to `command` only when the project's `recorder` block declares the command; otherwise it is refused.

## A minimal command recorder

This script records a two-second test pattern and one marker. Replace the `ffmpeg` line with whatever drives your app and captures its screen.

```bash
#!/usr/bin/env bash
# scripts/record-shot.sh — a minimal command recorder.
set -euo pipefail
echo "recording shot $DPT_VIDEO_SHOT ($DPT_VIDEO_SCENARIO)" >&2

ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i testsrc=duration=2:size=1280x720:rate=30 \
  -pix_fmt yuv420p -c:v libx264 "$DPT_VIDEO_OUT_CLIP"

cat > "$DPT_VIDEO_OUT_MARKERS" <<JSON
[{ "name": "start", "t": 0.0 }]
JSON
```

With `recorder.command: [bash, scripts/record-shot.sh]`, every shot runs this script from the project root and its output passes validation.
