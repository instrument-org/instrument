#!/usr/bin/env bash
# PreToolUse hook on Bash: refuses a session's commit until that session (or
# subagent) has loaded the instrument-commit-message skill, so a writer reads
# the rules before taking the style from `git log`. Once the skill is in the
# transcript every later commit goes straight through. Anything unexpected lets
# the command run: this is a reminder, and scripts/commit-subject.sh is the check.
input=$(cat)

# A string field of the hook's JSON input, still JSON-escaped.
field() { grep -oE "\"$1\" *: *\"([^\"\\\\]|\\\\.)*\"" <<< "$input" | head -1 | sed -E "s/^\"$1\" *: *\"(.*)\"$/\1/"; }

sep='(^|[[:space:];&|(]|\\n)'
commit="${sep}git([[:space:]]+-[cC][[:space:]]+[^[:space:]]+)*[[:space:]]+commit(-tree)?([^[:alnum:]_-]|$)"
commit+="|${sep}([^[:space:]]*/)?scripts/commit\.sh([^[:alnum:]_.-]|$)"
grep -Eq -- "$commit" <<< "$(field command)" || exit 0

transcript=$(field transcript_path)
[[ -n "$transcript" ]] || exit 0
# A subagent's own calls are in its own transcript beside the session's.
agent=$(field agent_id)
[[ -n "$agent" ]] && transcript="${transcript%.jsonl}/subagents/agent-$agent.jsonl"
[[ -f "$transcript" ]] || exit 0
grep -Eq '"skill":"([^"]*:)?instrument-commit-message"|"file_path":"[^"]*instrument-commit-message/SKILL\.md"' "$transcript" && exit 0

printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Load the instrument-commit-message skill (or Read .agents/skills/instrument-commit-message/SKILL.md), check this commit message against it, then commit again. git log has older subjects that break its rules; do not copy them. Asked once per session."}}'
