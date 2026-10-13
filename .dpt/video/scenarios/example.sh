# .dpt/video/scenarios/example.sh — a sample scenario for the command recorder.
# Runs inside the recording; `mark <name>` stamps a moment the narration can cut on.
# Copy it per shot and replace the commands with the feature you are demoing.
type_cmd() { printf '\033[1;32m$\033[0m %s\n' "$1"; sleep 0.6; eval "$1"; sleep 0.8; }

mark start
type_cmd "bun --version"
mark gate
type_cmd "git log --oneline -3"
mark end
sleep 0.5
