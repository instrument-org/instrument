#!/usr/bin/env bash
# Refuses a commit message whose subject breaks one of the instrument-commit-message
# skill's checkable rules, naming each broken rule by the id the skill gives it.
# A writer takes the style from `git log`, so a rule nothing checks drifts. Run by
# the commit-msg hook and by scripts/commit.sh, which builds commits without git's
# hooks.
#
#   scripts/commit-subject.sh <message-file>
#
# A revert, merge, fixup or squash subject quotes another one, so it passes.
# COMMIT_ALLOW=<id>[,<id>] lets a subject through a wording rule it breaks on
# purpose, as COMMIT_ALLOW=subject-verb for a commit really about drawing. The
# scope rule has no such case, so it takes no COMMIT_ALLOW.
set -euo pipefail

message=${1:?usage: scripts/commit-subject.sh <message-file>}

# The first line that is not one of git's own comment lines.
subject=$(grep -v -m1 '^#' "$message" || true)
case "$subject" in
  'Revert "'* | 'Merge '* | 'fixup! '* | 'squash! '* | 'amend! '*) exit 0 ;;
esac

allowed=",${COMMIT_ALLOW:-},"
broken=()
# check <id> <must|never> <extended regex, case-insensitive> <how to fix it>
check() {
  [[ "$1" =~ ^subject-(verb|contrast)$ && "$allowed" == *",$1,"* ]] && return 0
  local matched=no
  grep -Eiq -- "$3" <<< "$subject" && matched=yes
  if [[ "$2" == must && $matched == no || "$2" == never && $matched == yes ]]; then
    broken+=("[$1] $4")
  fi
}
# A word or phrase, not part of a longer word.
word() { echo "(^|[^[:alnum:]_])($1)([^[:alnum:]_]|\$)"; }

check subject-scope must '^[a-z0-9][a-z0-9._-]*(, ?[a-z0-9][a-z0-9._-]*)*: [^ ]' \
  "start with the scope that owns the change and a colon: studio: …, workspace: …, dx: …"
check subject-contrast never "$(word 'rather than|instead of')|, (not|never) " \
  "say what it does now; a comparison with what it did before goes in the body"
check subject-verb never "$(word 'draw|draws|drawn|drawing|drew')" \
  "name what changed: show <thing> as <form>, use <icon> for <thing>, render, or build/read/load from a source"
((${#broken[@]} == 0)) && exit 0

{
  echo "commit: refused: $subject"
  printf 'commit:   %s\n' "${broken[@]}"
  echo "commit: rules: .agents/skills/instrument-commit-message/SKILL.md. Rewrite the subject; never --no-verify."
  echo "commit: a subject breaking subject-verb or subject-contrast on purpose goes through with COMMIT_ALLOW=<id>"
  echo "commit: a subject someone gave you that breaks a rule: tell them which, and let them choose"
} >&2
exit 1
