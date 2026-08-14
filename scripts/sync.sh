#!/usr/bin/env bash
set -euo pipefail

if [[ -t 1 ]]; then
  BOLD="\033[1m"
  DIM="\033[2m"
  GREEN="\033[32m"
  RED="\033[31m"
  RESET="\033[0m"
else
  BOLD=""
  DIM=""
  GREEN=""
  RED=""
  RESET=""
fi

step() { echo -e "${BOLD}$1${RESET}  ${DIM}$2${RESET}"; }
ok() { echo -e "${GREEN}✓${RESET}  $1"; }
done_msg() { echo -e "${GREEN}${BOLD}$1${RESET}"; }
error() { echo -e "${RED}${BOLD}Error:${RESET} $1"; }
detail() { echo -e "${DIM}$1${RESET}"; }

# Everything below assumes the repo root: pnpm install in a package directory
# would only install that package's dependencies.
cd "$(git rev-parse --show-toplevel)"

BRANCH="main"
# The number of incoming commits listed before the rest are summarized.
LIST_LIMIT=15

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)

if [[ "$CURRENT_BRANCH" == "HEAD" ]]; then
  error "You are not on a branch (detached HEAD). Check out '$BRANCH' to sync."
  exit 1
fi

if [[ "$CURRENT_BRANCH" != "$BRANCH" ]]; then
  error "You must be on the '$BRANCH' branch to sync (currently on '$CURRENT_BRANCH')."
  exit 1
fi

echo ""

step "Pulling latest changes..." "git pull --rebase origin $BRANCH"

if ! FETCH_OUTPUT=$(git fetch origin "$BRANCH" --quiet 2>&1); then
  error "Could not reach origin."
  detail "$FETCH_OUTPUT"
  exit 1
fi

# Resolved now because submodule and rebase operations can rewrite FETCH_HEAD.
UPSTREAM=$(git rev-parse FETCH_HEAD)
COUNT=$(git rev-list --count "HEAD..$UPSTREAM")

if [[ "$COUNT" == "0" ]]; then
  ok "Already up to date, no new changes."
else
  if ! git diff --quiet HEAD; then
    error "You have uncommitted changes, which would block the rebase."
    detail "  Commit or stash them, then run this script again."
    exit 1
  fi

  # --no-pager, or a long list of commits opens less and blocks the script.
  INCOMING=$(git --no-pager log --format="     • %s" --max-count="$LIST_LIMIT" "HEAD..$UPSTREAM")

  if ! REBASE_OUTPUT=$(git rebase "$UPSTREAM" 2>&1); then
    git rebase --abort 2> /dev/null || true
    error "The latest changes could not be applied. The rebase was cancelled."
    detail "$REBASE_OUTPUT"
    detail "  If you have local changes you don't need, try discarding them and running this script again."
    exit 1
  fi

  ok "$COUNT new update(s) pulled:"
  echo "$INCOMING"
  if ((COUNT > LIST_LIMIT)); then
    detail "     …and $((COUNT - LIST_LIMIT)) more"
  fi
fi

echo ""
step "Updating submodules..." "git submodule update --init --recursive"
git submodule update --init --recursive --quiet
ok "Submodules are up to date."

echo ""
step "Installing dependencies..." "pnpm install"
pnpm install --silent
ok "Dependencies are installed."

echo ""
done_msg "You're up to date with $BRANCH."
echo ""
