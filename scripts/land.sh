#!/usr/bin/env bash
# Lands the worktree you are in on main: rebases its branch onto the local
# main, checks what it changed, fast-forwards main in the primary checkout,
# then removes the worktree and its branch.
#
#   scripts/land.sh [--keep]    run from inside a linked worktree
#
# The checks are the ones CI would fail on for the packages the branch touched:
# types and lint (turbo, affected only), unused code (knip), and the tests that
# import a changed file (vitest related). --keep leaves the worktree and branch
# in place after landing. Nothing is pushed.
set -euo pipefail

keep=false
if [[ "${1:-}" == "--keep" ]]; then
  keep=true
fi

fail() {
  echo "land: $1" >&2
  exit 1
}

worktree_root=$(git rev-parse --show-toplevel)
main_root=$(git worktree list --porcelain | awk '/^worktree /{print $2; exit}')
[[ "$worktree_root" != "$main_root" ]] ||
  fail "run this from a linked worktree, not the primary checkout"

branch=$(git branch --show-current)
[[ -n "$branch" ]] || fail "the worktree is on a detached HEAD; commit on a branch first"
[[ "$(git -C "$main_root" branch --show-current)" == "main" ]] ||
  fail "the primary checkout at $main_root is not on main"
[[ -z "$(git status --porcelain --untracked-files=no)" ]] ||
  fail "commit or drop the worktree's changes first"

# Main may have moved since the worktree started; commits it already holds
# under other hashes drop out of the rebase.
git rebase --quiet main
changed=$(git diff --name-only main...HEAD)
[[ -n "$changed" ]] || fail "nothing on $branch that main does not already have"
echo "land: $(git rev-list --count main..HEAD) commit(s) on $branch"

pnpm exec turbo run check:types check:lint --filter='[main]' --output-logs errors-only
pnpm exec knip

# The tests that import a changed source file, run in the package that owns
# it and in the projects its test:ci runs (Studio's browser project is not).
for package in apps/studio packages/workspace packages/ai-gateway packages/shared; do
  files=$(grep -E "^$package/.*\.(ts|tsx)$" <<< "$changed" | sed "s#^$package/##" || true)
  if [[ -n "$files" && -f "$package/vitest.config.ts" ]]; then
    projects=()
    if [[ "$package" == "apps/studio" ]]; then
      projects=(--project node --project dom)
    fi
    # shellcheck disable=SC2086
    (cd "$package" && CI=true pnpm exec vitest related --run --passWithNoTests \
      ${projects[@]+"${projects[@]}"} $files)
  fi
done

# Fails, leaving main alone, when main moved again or a file it would update
# has uncommitted changes in the primary checkout; rerun to rebase again.
git -C "$main_root" merge --ff-only --quiet "$branch" ||
  fail "main could not fast-forward; rerun to rebase onto it again"
echo "land: main is at $(git -C "$main_root" log -1 --format='%h %s')"

if [[ "$keep" == false ]]; then
  cd "$main_root"
  # --force because git refuses to remove a worktree holding a submodule
  # (registry/), clean or not; the branch is on main by now.
  git worktree remove --force "$worktree_root"
  git branch --quiet -D "$branch"
  echo "land: removed $worktree_root and $branch"
fi
