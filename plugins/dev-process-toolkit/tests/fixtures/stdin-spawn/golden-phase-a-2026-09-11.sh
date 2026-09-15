bash <<'OUTER'
set -u
ITER=1
DATE=2026-09-11
SELECTED_LEGS="linear jira none"
LINEAR_TEAM=STE
JIRA_PROJECT=DST
LOG_LINEAR=/tmp/dpt-conformance-loop-${DATE}-iter-${ITER}-linear.log
LOG_JIRA=/tmp/dpt-conformance-loop-${DATE}-iter-${ITER}-jira.log
LOG_NONE=/tmp/dpt-conformance-loop-${DATE}-iter-${ITER}-none.log
PID_FILE_LINEAR=/tmp/dpt-conformance-loop-${DATE}-iter-${ITER}-linear.pid
PID_FILE_JIRA=/tmp/dpt-conformance-loop-${DATE}-iter-${ITER}-jira.pid
PID_FILE_NONE=/tmp/dpt-conformance-loop-${DATE}-iter-${ITER}-none.pid
RC_FILE_LINEAR=/tmp/dpt-conformance-loop-${DATE}-iter-${ITER}-linear.rc
RC_FILE_JIRA=/tmp/dpt-conformance-loop-${DATE}-iter-${ITER}-jira.rc
RC_FILE_NONE=/tmp/dpt-conformance-loop-${DATE}-iter-${ITER}-none.rc
RUN_START_MS=1789072862000
PLUGIN_DIR="$(pwd)/plugins/dev-process-toolkit"
export CLAUDE_CONFIG_DIR=~/.claude-st

# F9 baseline inventory
{ echo "== F9 baseline $(date '+%H:%M:%S')"; stat -f "%Sm %z %N" -t "%H:%M:%S" /tmp/dpt-smoke-verdict-*.json; ls -ld /tmp/dpt-smoke-*-phase9; } > /tmp/dpt-conformance-loop-${DATE}-f9-baseline.txt 2>&1

case " ${SELECTED_LEGS} " in *" linear "*)
{
  claude -p "/smoke-test --tracker linear --linear-team ${LINEAR_TEAM:-STE}" \
    --plugin-dir "${PLUGIN_DIR}" \
    > "${LOG_LINEAR}" 2>&1 <<'PROMPT_EOF'
<dpt:auto-approve>v1</dpt:auto-approve>
PROMPT_EOF
  RC_RAW_LINEAR=$?
  bun "${PLUGIN_DIR}/adapters/_shared/src/smoke_verdict.ts" reconcile \
    --rc "${RC_RAW_LINEAR}" \
    --artifact /tmp/dpt-smoke-verdict-linear.json \
    --run-start "${RUN_START_MS}" > "${RC_FILE_LINEAR}"
} </dev/null >/dev/null 2>&1 &
PID_LINEAR=$!; echo $! > "${PID_FILE_LINEAR}"
;; esac

case " ${SELECTED_LEGS} " in *" jira "*)
{
  claude -p "/smoke-test --tracker jira --jira-project ${JIRA_PROJECT}" \
    --plugin-dir "${PLUGIN_DIR}" \
    > "${LOG_JIRA}" 2>&1 <<'PROMPT_EOF'
<dpt:auto-approve>v1</dpt:auto-approve>
PROMPT_EOF
  RC_RAW_JIRA=$?
  bun "${PLUGIN_DIR}/adapters/_shared/src/smoke_verdict.ts" reconcile \
    --rc "${RC_RAW_JIRA}" \
    --artifact /tmp/dpt-smoke-verdict-jira.json \
    --run-start "${RUN_START_MS}" > "${RC_FILE_JIRA}"
} </dev/null >/dev/null 2>&1 &
PID_JIRA=$!; echo $! > "${PID_FILE_JIRA}"
;; esac

case " ${SELECTED_LEGS} " in *" none "*)
{
  claude -p "/smoke-test --tracker none" \
    --plugin-dir "${PLUGIN_DIR}" \
    > "${LOG_NONE}" 2>&1 <<'PROMPT_EOF'
<dpt:auto-approve>v1</dpt:auto-approve>
PROMPT_EOF
  RC_RAW_NONE=$?
  bun "${PLUGIN_DIR}/adapters/_shared/src/smoke_verdict.ts" reconcile \
    --rc "${RC_RAW_NONE}" \
    --artifact /tmp/dpt-smoke-verdict-none.json \
    --run-start "${RUN_START_MS}" > "${RC_FILE_NONE}"
} </dev/null >/dev/null 2>&1 &
PID_NONE=$!; echo $! > "${PID_FILE_NONE}"
;; esac

DETACHED=""
for SEL in ${SELECTED_LEGS}; do
  DETACHED="${DETACHED}${DETACHED:+ }${SEL}=$(cat "/tmp/dpt-conformance-loop-${DATE}-iter-${ITER}-${SEL}.pid" 2>/dev/null)"
done
echo "spawned_at=$(date '+%H:%M:%S')"
echo "detached: ${DETACHED} — poll until all exit"
OUTER