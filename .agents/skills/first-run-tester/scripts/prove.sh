#!/bin/bash
# The pre-run check: boots the scenario off screen and drives it through the
# tester's own tool server with no model (proof.mjs for returning-user,
# proof-fresh.mjs for new), then stops it. Repeat with PROOFS="1 2 3".
#
#   prove.sh <studio checkout> <scenario> <account file> <account's first name>
#
# WORK names the work folder (default ~/.instrument-first-run-tester), as
# run.mjs's --work does.
set -o pipefail
cd "$(dirname "$0")"
CHECKOUT=$(cd "$1" && pwd) || exit 2
SCENARIO=${2:?scenario: returning-user or new}
ACCOUNT=$(cd "$(dirname "$3")" && pwd)/$(basename "$3")
WORK=${WORK:-$HOME/.instrument-first-run-tester}
HOME_NAME=$([ "$SCENARIO" = new ] && echo first-launch || echo "$SCENARIO")
STANDIN="$WORK/sandbox/home/$HOME_NAME"
INSPECT=9377
mkdir -p "$WORK/runs" "$WORK/bin"
# The watchdog that ends the instance if any of its windows reaches the screen.
[ -x "$WORK/bin/onscreen" ] || swiftc -O -o "$WORK/bin/onscreen" lib/onscreen.swift || exit 2
export FRT_ONSCREEN_BIN="$WORK/bin/onscreen"
stop() {
  node run.mjs stop --work "$WORK" --checkout "$CHECKOUT" --scenario "$SCENARIO" --home "$HOME_NAME" > /dev/null 2>&1
  [ -f "$WORK/sandbox/instance.json" ] && kill -TERM -"$(node -p "require('$WORK/sandbox/instance.json').pid")" 2>/dev/null
}
for n in ${PROOFS:-1}; do
  echo "=== proof $n"
  stop
  sleep 4
  log="$WORK/runs/proof-$SCENARIO-$n.boot.log"
  boot_account=$([ "$SCENARIO" = new ] || echo "--account $ACCOUNT")
  # Through a pipe: a process inside the profile cannot have a file out here as its output.
  # shellcheck disable=SC2086
  if ! node run.mjs boot --work "$WORK" --checkout "$CHECKOUT" --scenario "$SCENARIO" --inspect $INSPECT $boot_account 2>&1 | cat > "$log"; then
    echo "boot failed: $(grep -m1 ERR_ "$log")"
    continue
  fi
  port=$(node -p "require('$WORK/sandbox/instance.json').port")
  supervisor=$(node -p "require('$WORK/sandbox/instance.json').pid")
  # The scenario's workspace, under the cache studio-drive keeps in the stand-in home.
  # setup creates it, so for a first launch it appears only partway through.
  chats="$(ls -d "$STANDIN"/Library/Caches/instrument-studio-drive/*/scenario-"$SCENARIO"-home | head -1)/Documents/Instrument Dev/.instrument/chats"
  run="$WORK/runs/proof-$SCENARIO-$n"
  rm -rf "$run" && mkdir -p "$run"
  if [ "$SCENARIO" = new ]; then
    FRT_SUPERVISOR_PID=$supervisor FRT_FIRST_LAUNCH_ACCOUNT="$ACCOUNT" node proof-fresh.mjs --greets "$4" --port "$port" --inspect $INSPECT --run "$run" --chats "$chats"
  else
    FRT_SUPERVISOR_PID=$supervisor node proof.mjs --greets "$4" --port "$port" --inspect $INSPECT --run "$run" --chats "$chats" --page "$STANDIN/Documents/neighborhood-walks.html"
  fi
  echo "exit=$? windows on screen: $("$WORK/bin/onscreen" "$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t | head -1)" | wc -l | tr -d ' ') front app: $(lsappinfo front)"
done
stop
echo "=== done"
