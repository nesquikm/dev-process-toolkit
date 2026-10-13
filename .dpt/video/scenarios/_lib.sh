# Shared helpers for terminal scenarios. `show <display> [real]` types the
# display command at a readable pace, then runs the real one (or the display).
type_out() { local s="$1" i; for ((i=0;i<${#s};i++)); do printf '%s' "${s:i:1}"; sleep 0.025; done; printf '\n'; }
show() { printf '\033[1;35m❯\033[0m '; type_out "$1"; sleep 0.3; eval "${2:-$1}"; sleep "${3:-1.2}"; }
banner() { printf '\033[1;36m%s\033[0m\n\n' "$1"; sleep 0.6; }
clear
