#!/usr/bin/env bash
# STE-666 fixture: 30 numbered stderr lines, then exit 3.
for i in $(seq -w 1 30); do echo "stderr-line-$i" >&2; done
exit 3
