#!/usr/bin/env bash
# Runs agent-hooks' Stop pass (format, lint fix, knip, vitest related) once a
# machine-wide slot is free: at most two sessions check at once. A session that
# waits past the limit skips this pass; its edits stay in the ledger, so its next
# Stop checks them.
set -uo pipefail
common=$(git rev-parse --path-format=absolute --git-common-dir 2> /dev/null) || exit 0
repo=$(dirname "$common")
# shellcheck source=scripts/check-slots.sh
source "$repo/scripts/check-slots.sh"
take_check_slot stop-checks 2 "${STOP_CHECKS_WAIT_SECONDS:-420}" || {
  echo "stop-checks: no slot free after ${check_slot_waited}s; skipped, the next Stop checks these edits" >&2
  exit 0
}
node "$repo/node_modules/@instrument-org/agent-hooks/format.mjs"
