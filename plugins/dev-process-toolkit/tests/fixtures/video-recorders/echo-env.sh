#!/usr/bin/env bash
# STE-666 fixture command recorder: echoes the four recorder variables and its
# cwd into the markers file it is told to write, and records a 2s lavfi clip.
set -euo pipefail
ffmpeg -hide_banner -loglevel error -y -f lavfi -i testsrc=duration=2:size=160x120:rate=10 \
  -pix_fmt yuv420p -c:v libx264 "$DPT_VIDEO_OUT_CLIP"
cat > "$DPT_VIDEO_OUT_MARKERS" <<JSON
[
  {"name": "shot=$DPT_VIDEO_SHOT", "t": 0.1},
  {"name": "scenario=$DPT_VIDEO_SCENARIO", "t": 0.2},
  {"name": "clip=$DPT_VIDEO_OUT_CLIP", "t": 0.3},
  {"name": "markers=$DPT_VIDEO_OUT_MARKERS", "t": 0.4},
  {"name": "cwd=$(pwd -P)", "t": 0.5}
]
JSON
