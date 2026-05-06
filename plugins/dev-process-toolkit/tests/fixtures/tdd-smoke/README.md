# tdd-smoke fixture

Trivial fixture for STE-225 AC.9 headless live smoke of `/dev-process-toolkit:tdd`. Single AC: `add(a, b)` returns the sum.

The live-smoke runner copies this directory into a temp checkout, then invokes `claude -p /dev-process-toolkit:tdd STE-SMOKE` against the copy. Behavioral assertions only.
