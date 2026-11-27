#!/usr/bin/env bash
# Formats with oxfmt what the index holds for a commit, so the commit records
# formatted files even where the format hook has not run yet: it formats after
# the Bash command that wrote a file and at Stop, so a commit made in that
# command or earlier in the turn would otherwise record the file unformatted
# and leave the formatted one behind as an uncommitted change.
#
#   scripts/format-staged.sh [<base>]   # commit.sh, on its private index
#   scripts/format-staged.sh --hook     # the pre-commit hook
#   scripts/format-staged.sh --after    # the post-commit hook
#
# Formats each file added or changed against <base> (HEAD by default) in the
# index GIT_INDEX_FILE names, the shared one when unset. A working file that
# matches what was staged gets the formatted text too, so the checkout stays
# clean; one that differs (part of it staged, or a commit.sh <path>=<copy>) is
# left as it is. Files oxfmt does not format or ignores go in unchanged.
#
# `git commit -- <path>` builds the commit on a temporary index and writes the
# shared one itself with the text as it was before the hook, so --hook notes
# what it formatted and --after moves each shared index entry that still holds
# the old text to the formatted one.
set -uo pipefail

top=$(git rev-parse --show-toplevel)
# Both hooks of one commit run as children of the same git process.
record="$(git rev-parse --path-format=absolute --git-dir)/format-staged.$PPID"

if [[ "${1:-}" == "--after" ]]; then
  [[ -f "$record" ]] || exit 0
  while IFS=$'\t' read -r line file; do
    read -r mode old new <<< "$line"
    entry=$(git ls-files --stage -- "$file")
    [[ "$(cut -d' ' -f2 <<< "$entry")" == "$old" ]] &&
      git update-index --cacheinfo "$mode,$new,$file"
  done < "$record"
  rm -f "$record"
  exit 0
fi

hook=false
base=HEAD
if [[ "${1:-}" == "--hook" ]]; then
  hook=true
elif [[ -n "${1:-}" ]]; then
  base=$1
fi
oxfmt="$top/node_modules/.bin/oxfmt"
[[ -x "$oxfmt" ]] || exit 0
git rev-parse --verify --quiet "$base^{commit}" > /dev/null || exit 0
cd "$top"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# Prints `<mode> <staged blob> <formatted blob>\t<path>` for a file whose
# staged text oxfmt changes.
format_one() {
  local file=$1 entry mode blob out new
  entry=$(git ls-files --stage -- "$file")
  mode=${entry%% *}
  blob=$(cut -d' ' -f2 <<< "$entry")
  [[ "$mode" == 100644 || "$mode" == 100755 ]] || return 0
  out=$(mktemp "$work/blob.XXXXXX")
  git cat-file blob "$blob" | "$oxfmt" --stdin-filepath "$file" > "$out" 2> /dev/null || return 0
  new=$(git hash-object -w -- "$out")
  [[ "$new" != "$blob" ]] || return 0
  if [[ -f "$file" && "$(git hash-object -- "$file")" == "$blob" ]]; then
    cat "$out" > "$file"
  fi
  printf '%s %s %s\t%s\n' "$mode" "$blob" "$new" "$file"
}
export -f format_one
export oxfmt work

git diff --cached --name-only --diff-filter=AM --no-renames -z "$base" |
  xargs -0 -n 1 -P 8 bash -c 'format_one "$1"' _ > "$work/formatted"
[[ -s "$work/formatted" ]] || exit 0
awk -F'\t' '{ split($1, f, " "); print f[1] " " f[3] "\t" $2 }' "$work/formatted" |
  git update-index --index-info
if [[ "$hook" == true ]]; then
  cp "$work/formatted" "$record"
fi
