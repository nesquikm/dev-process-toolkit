#!/usr/bin/env bash
# .dpt/video/scripts/record-shot.sh — command recorder for terminal demos.
#
# Runs .dpt/video/scenarios/<scenario>.sh inside an asciinema recording,
# renders the cast with agg, and transcodes it to the clip ffmpeg expects.
# A scenario marks moments the narration points at by calling `mark <name>`;
# each mark becomes {name, t} in the markers file, t in seconds from the start.
#
# Contract (docs/video-recorders.md): DPT_VIDEO_SHOT, DPT_VIDEO_SCENARIO,
# DPT_VIDEO_OUT_CLIP, DPT_VIDEO_OUT_MARKERS are set; cwd is the project root.
# Optional: DPT_VIDEO_COLS / DPT_VIDEO_ROWS (default 100x28).
set -euo pipefail

: "${DPT_VIDEO_SHOT:?}" "${DPT_VIDEO_SCENARIO:?}" "${DPT_VIDEO_OUT_CLIP:?}" "${DPT_VIDEO_OUT_MARKERS:?}"
for tool in asciinema agg ffmpeg ffprobe python3; do
  command -v "$tool" >/dev/null || { echo "record-shot: '$tool' not found on PATH (brew install asciinema agg ffmpeg)" >&2; exit 1; }
done

# Motion scene: an HTML/CSS scenario is captured frame by frame instead of recorded.
html="$(pwd)/.dpt/video/scenarios/${DPT_VIDEO_SCENARIO}.html"
if [ -f "$html" ]; then
  tools="$(pwd)/.dpt/video/work/_tools"
  [ -f "$tools/node_modules/playwright-core/index.mjs" ] || {
    mkdir -p "$tools" && (cd "$tools" && { [ -f package.json ] || echo '{"private":true}' > package.json; } && bun add playwright-core@1.55.0 >&2); }
  exec bun "$(pwd)/.dpt/video/scripts/capture-motion.mjs" "$html" "$DPT_VIDEO_OUT_CLIP" "$DPT_VIDEO_OUT_MARKERS" "$(pwd)"
fi

scenario="$(pwd)/.dpt/video/scenarios/${DPT_VIDEO_SCENARIO}.sh"
[ -f "$scenario" ] || { echo "record-shot: no scenario file at $scenario" >&2; exit 1; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
cols="${DPT_VIDEO_COLS:-72}"
rows="${DPT_VIDEO_ROWS:-16}"

# `mark <name>` appends "<name>\t<seconds since the recording started>".
export DPT_MARK_FILE="$tmp/marks.tsv"
: > "$DPT_MARK_FILE"
cat > "$tmp/prelude.sh" <<'PRELUDE'
# No pager may open inside a headless recording: it would wait for a key forever.
export PAGER=cat GIT_PAGER=cat LESS=FRX
DPT_MARK_T0="$(python3 -c 'import time; print(time.time())')"
mark() { python3 -c 'import sys, time; print(f"{sys.argv[1]}\t{time.time() - float(sys.argv[2]):.3f}")' "$1" "$DPT_MARK_T0" >> "$DPT_MARK_FILE"; }
PRELUDE

echo "record-shot: recording $DPT_VIDEO_SHOT ($DPT_VIDEO_SCENARIO) at ${cols}x${rows}" >&2
asciinema rec --quiet --overwrite --headless --window-size "${cols}x${rows}" \
  --command "bash -c 'source \"$tmp/prelude.sh\"; source \"$scenario\"'" "$tmp/shot.cast" >&2

agg --font-size "${DPT_VIDEO_FONT_SIZE:-30}" --idle-time-limit 30 --last-frame-duration 4 "$tmp/shot.cast" "$tmp/shot.gif" >&2
ffmpeg -y -loglevel error -i "$tmp/shot.gif" -movflags +faststart -pix_fmt yuv420p -fps_mode cfr -r 30 \
  -vf "fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2,tpad=stop_mode=clone:stop_duration=${DPT_VIDEO_TAIL_HOLD:-12}" "$DPT_VIDEO_OUT_CLIP" >&2

duration="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$DPT_VIDEO_OUT_CLIP")"
python3 - "$DPT_MARK_FILE" "$duration" "$DPT_VIDEO_OUT_MARKERS" <<'PY'
import json, sys
marks_path, duration, out = sys.argv[1], float(sys.argv[2]), sys.argv[3]
marks, last = [], 0.0
for line in open(marks_path):
    name, _, t = line.rstrip("\n").partition("\t")
    if not name:
        continue
    t = min(max(float(t), last), duration)  # non-decreasing, within the clip
    marks.append({"name": name, "t": round(t, 3)})
    last = t
json.dump(marks, open(out, "w"), indent=2)
PY
echo "record-shot: wrote $DPT_VIDEO_OUT_CLIP (${duration}s) and $(python3 -c 'import json,sys; print(len(json.load(open(sys.argv[1]))))' "$DPT_VIDEO_OUT_MARKERS") marker(s)" >&2
