#!/usr/bin/env bash
# Refuses a commit message whose subject says "draw", which the history has used
# for icons, layout, rendering and data alike until it says nothing, and which a
# writer reading `git log` for the style copies. The instrument-commit-message
# skill gives the verb to use instead. Run by the commit-msg hook and by
# scripts/commit.sh, which builds commits without git's hooks.
#
#   scripts/commit-subject.sh <message-file>
#
# A revert, merge, fixup or squash subject quotes another one, so it passes.
# COMMIT_ALLOW_DRAW=1 lets a subject that is really about drawing through.
set -euo pipefail

message=${1:?usage: scripts/commit-subject.sh <message-file>}
[[ "${COMMIT_ALLOW_DRAW:-}" == "1" ]] && exit 0

# The first line that is not one of git's own comment lines.
subject=$(grep -v -m1 '^#' "$message" || true)
case "$subject" in
  'Revert "'* | 'Merge '* | 'fixup! '* | 'squash! '* | 'amend! '*) exit 0 ;;
esac

if grep -Eiq '(^|[^[:alnum:]_])(draw|draws|drawn|drawing|drew)([^[:alnum:]_]|$)' <<< "$subject"; then
  cat >&2 << EOF
commit: the subject says "draw": $subject
commit: name what changed instead (the instrument-commit-message skill):
commit:   how it looks or is laid out: show <thing> as <form>, or the property (make tooltip hairlines opaque)
commit:   an icon: use <icon> for <thing>, change <thing> icon to <icon>
commit:   when or how it paints: render
commit:   where its content comes from: build, read or load
commit: a subject really about drawing goes through with COMMIT_ALLOW_DRAW=1
EOF
  exit 1
fi
