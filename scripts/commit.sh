#!/usr/bin/env bash
# Commits exactly the named paths onto the current branch, in a checkout other
# sessions edit and commit in at the same time:
#
#   scripts/commit.sh -F <message-file> [--] <path>...
#
# A <path> goes in as the working tree has it: changed, new, or deleted.
# <path>=<copy> commits <copy>'s contents as <path>, for committing only part
# of a file's edits. Nothing else in the working tree or the shared index goes
# in, and the shared index comes out matching the commit for those paths.
#
# The commit is built on a private index from the branch tip and the branch
# moves only if it is still at that tip, so a commit another session lands in
# between is never undone: the commit is built again on the new tip. A
# <path>=<copy> whose file the new tip changed fails instead, since the copy
# was made from the older version.
#
#   scripts/commit.sh --amend <sha> -F <message-file> [--] [<path>...]
#
# Replaces <sha>, the branch tip, with a commit of the new message and, when
# paths are named, those paths as the working tree has them. It refuses once
# anything has landed on top of <sha> or <sha> has been pushed, since either
# would mean rewriting work that is no longer only yours to rewrite.
set -euo pipefail

fail() {
  echo "commit: $1" >&2
  exit 1
}

usage="usage: scripts/commit.sh [--amend <sha>] -F <message-file> [--] <path>..."
amend=""
if [[ "${1:-}" == "--amend" ]]; then
  [[ -n "${2:-}" ]] || fail "$usage"
  amend=$(git rev-parse --verify --quiet "$2^{commit}") || fail "$2 is not a commit"
  shift 2
fi
[[ "${1:-}" == "-F" && -n "${2:-}" ]] || fail "$usage"
message=$(cd "$(dirname "$2")" && pwd)/$(basename "$2")
[[ -s "$message" ]] || fail "$2 is empty or missing"
shift 2
[[ "${1:-}" == "--" ]] && shift
[[ -n "$amend" ]] || (($# > 0)) || fail "name the paths to commit"

# Paths come relative to where this runs; git wants them from the top.
top=$(git rev-parse --show-toplevel)
specs=$(node -e '
  const path = require("node:path");
  const [top, ...args] = process.argv.slice(1);
  for (const arg of args) {
    const [file, copy] = arg.split("=");
    const relative = path.relative(top, path.resolve(file));
    if (relative.startsWith("..")) throw new Error(`${file} is outside the repository`);
    console.log(copy === undefined ? relative : `${relative}\t${path.resolve(copy)}`);
  }
' "$top" "$@")
cd "$top"
paths=$(cut -f1 <<< "$specs" | sort -u)

index_dir=$(mktemp -d)
trap 'rm -rf "$index_dir"' EXIT
subject=$(head -1 "$message")
# commit-tree is plumbing and ignores commit.gpgsign, so a commit is signed
# only when asked for here, the way `git commit` would sign it.
sign=()
if [[ "$(git config --bool commit.gpgsign || true)" == "true" ]]; then
  sign=(-S)
fi

if [[ -n "$amend" ]]; then
  [[ "$(git rev-parse HEAD)" == "$amend" ]] ||
    fail "$(git rev-parse --short "$amend") is not the branch tip any more; something landed on top of it, so make a new commit instead"
  if upstream=$(git rev-parse --verify --quiet '@{upstream}') &&
    git merge-base --is-ancestor "$amend" "$upstream"; then
    fail "$(git rev-parse --short "$amend") is already pushed; make a new commit instead"
  fi
  parent=$(git rev-parse --verify --quiet "$amend^") || fail "cannot amend a root commit"
  export GIT_INDEX_FILE="$index_dir/index"
  git read-tree "$amend"
  if [[ -n "$specs" ]]; then
    while IFS=$'\t' read -r file copy; do
      if [[ -z "$copy" ]]; then
        git update-index --add --remove -- "$file"
      else
        mode=$(git ls-tree "$amend" -- "$file" | cut -d' ' -f1)
        git update-index --add --cacheinfo "${mode:-100644},$(git hash-object -w -- "$copy"),$file"
      fi
    done <<< "$specs"
  fi
  commit=$(git commit-tree ${sign[@]+"${sign[@]}"} "$(git write-tree)" -p "$parent" -F "$message")
  unset GIT_INDEX_FILE
  # Moves the branch only if it is still at the commit being replaced.
  git update-ref -m "commit (amend): $subject" HEAD "$commit" "$amend" 2> /dev/null ||
    fail "the branch moved while amending; make a new commit instead"
  if [[ -n "$specs" ]]; then
    tr '\n' '\0' <<< "$paths" | xargs -0 git reset -q --
  fi
  git log -1 --format='commit: %h %s (replaces '"$(git rev-parse --short "$amend")"')' "$commit"
  exit 0
fi

for attempt in 1 2 3 4 5; do
  base=$(git rev-parse HEAD)
  if [[ -n "${previous_base:-}" && "$base" != "$previous_base" ]]; then
    while IFS=$'\t' read -r file copy; do
      [[ -z "$copy" ]] || git diff --quiet "$previous_base" "$base" -- "$file" ||
        fail "$file changed on the branch since its copy was made; make the copy again from the current version"
    done <<< "$specs"
  fi
  previous_base=$base

  export GIT_INDEX_FILE="$index_dir/index"
  git read-tree "$base"
  while IFS=$'\t' read -r file copy; do
    if [[ -z "$copy" ]]; then
      git update-index --add --remove -- "$file"
    else
      mode=$(git ls-tree "$base" -- "$file" | cut -d' ' -f1)
      git update-index --add --cacheinfo "${mode:-100644},$(git hash-object -w -- "$copy"),$file"
    fi
  done <<< "$specs"
  # Without renames, so a renamed file's old path counts as the deletion it is.
  staged=$(git diff --cached --name-only --no-renames "$base")
  [[ -n "$staged" ]] || fail "none of the named paths differ from HEAD"
  unchanged=$(comm -23 <(echo "$paths") <(echo "$staged"))
  [[ -z "$unchanged" ]] || fail "these named paths do not differ from HEAD: $unchanged"
  commit=$(git commit-tree ${sign[@]+"${sign[@]}"} "$(git write-tree)" -p "$base" -F "$message")
  unset GIT_INDEX_FILE

  # Moves the branch only if it is still at the commit's parent.
  if git update-ref -m "commit: $subject" HEAD "$commit" "$base" 2> /dev/null; then
    tr '\n' '\0' <<< "$paths" | xargs -0 git reset -q --
    git log -1 --format='commit: %h %s' "$commit"
    exit 0
  fi
  echo "commit: the branch moved while committing; building on the new tip (attempt $attempt)"
done
fail "the branch kept moving; rerun"
