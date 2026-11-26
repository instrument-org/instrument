# shellcheck shell=bash
# Sourced, not run. Bounds how many heavy checks (type-aware lint, types, knip,
# tests) run at once across every checkout and worktree of this repo, since each
# one alone can take several cores and a dozen sessions stopping together starve
# the machine.
#
#   take_check_slot <name> <slots> [<max-wait-seconds>]  # returns 1 on timeout
#   release_check_slot
#
# A slot is a directory under the shared git dir holding the taker's pid; one
# whose process is gone is taken over. Taking a slot releases it on exit. Every
# take or timeout appends `<time> <name> <outcome> <seconds waited>` to
# check-slots/log, which the agent-load follow-up reads.

check_slot_dir=
check_slot_waited=0

check_slot_holder() {
  cat "$1/pid" 2> /dev/null || true
}

take_check_slot() {
  local name=$1 slots=$2 max_wait=${3:-0} root slot holder i announced=false
  root="$(git rev-parse --path-format=absolute --git-common-dir)/check-slots"
  mkdir -p "$root"
  check_slot_waited=0
  while true; do
    for ((i = 0; i < slots; i++)); do
      slot="$root/$name.$i"
      if mkdir "$slot" 2> /dev/null; then
        echo $$ > "$slot/pid"
        check_slot_dir=$slot
        trap release_check_slot EXIT
        trap 'exit 143' TERM INT HUP
        echo "$(date +%FT%T) $name took $check_slot_waited" >> "$root/log"
        return 0
      fi
      holder=$(check_slot_holder "$slot")
      # An empty pid is a taker between mkdir and its write; leave it be.
      if [[ -n "$holder" ]] && ! kill -0 "$holder" 2> /dev/null; then
        mv "$slot" "$slot.stale.$$" 2> /dev/null && rm -rf "$slot.stale.$$"
      fi
    done
    if ((max_wait > 0 && check_slot_waited >= max_wait)); then
      echo "$(date +%FT%T) $name gave-up $check_slot_waited" >> "$root/log"
      return 1
    fi
    if [[ "$announced" == false ]]; then
      echo "waiting for a $name slot, held by pid(s): $(cat "$root/$name".*/pid 2> /dev/null | tr '\n' ' ')" >&2
      announced=true
    fi
    sleep 3
    check_slot_waited=$((check_slot_waited + 3))
  done
}

release_check_slot() {
  if [[ -n "$check_slot_dir" && "$(check_slot_holder "$check_slot_dir")" == "$$" ]]; then
    rm -rf "$check_slot_dir"
  fi
  check_slot_dir=
}
