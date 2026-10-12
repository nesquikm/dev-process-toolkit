#!/usr/bin/env bash
# STE-666 fixture: 30 numbered stderr lines, exit 0, no recording written.
for i in $(seq -w 1 30); do echo "stderr-line-$i" >&2; done
exit 0
