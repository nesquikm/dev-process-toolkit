bash <<'EOF'
echo "attribution: operator's own instruction ('to be 100% sure we didn't break anything'), Phase 0 y delivered by supervisor keystroke (peer dev-process-toolkit-ad); tracker writes = the named work" >> /tmp/dpt-conformance-loop-2026-09-11-approval.txt
date "+local=%Y-%m-%d %H:%M:%S %Z"
stat -f "%Sm %N" -t "%H:%M:%S" /tmp/dpt-smoke-verdict-*.json
ls -ld /tmp/dpt-smoke-*-phase9 2>/dev/null | head
echo "== bun / claude processes"
ps -axo pid,etime,command | grep -E 'bun (test|run)|claude -p' | grep -v grep | head -20
EOF