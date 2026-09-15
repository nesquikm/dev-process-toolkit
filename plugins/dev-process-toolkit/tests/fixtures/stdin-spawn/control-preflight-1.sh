bash <<'EOF'
F=/tmp/dpt-conformance-loop-2026-09-11-approval.txt
RUN_START_MS=$(($(date +%s) * 1000))
{
  echo "approved=y source=operator-interactive (AskUserQuestion, no auto-approve marker) at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "run_start_ms=${RUN_START_MS}"
  echo "legs_selected=linear jira none auto_fix=off max_iterations=3 linear_team=STE jira_project=DST plugin=2.83.0 head=$(git rev-parse --short HEAD)"
} >> "$F"
cat "$F"
if [ -t 0 ]; then
  echo "LOOP-CTX: interactive tty"
else
  echo "LOOP-CTX: headless (claude -p) — background-task notifications will NOT arrive; the ONLY sanctioned wait is the bounded kill-0 poll. Do NOT run_in_background, do NOT Monitor, do NOT yield the turn to await a leg."
fi
EOF