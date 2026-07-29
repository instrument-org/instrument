---
name: instrument-commit-message
description: Generate a git commit message matching the Instrument monorepo's scope-first commit style. Use when the user asks for a commit message, wants to commit changes, or asks how to describe their changes. Knows the repo's scopes (studio, workspace, dx, etc.) and real examples from the commit history.
---

# Commit Message

## Format

`scope: clear, concise description of what changed`

- **Scope:** default to the package/app that owns the change (`studio`, `workspace`, `ai-gateway`, `shim-client`) or an established workflow scope (`dx`, `ci`, `release`, `docs`). Use a feature-area scope only when recent history shows that scope is established; do not invent one from the subject matter.
- **No conventional types.** Drop `feat:`/`fix:`/`refactor:`/`chore:` etc. Let the description imply the nature of the change.
- **Description:** lowercase, no period, imperative-ish, informative and scannable, no redundancy. Keep the subject under ~72 chars.
- **Body:** add a short body when context, rationale, or follow-on detail would help.

## Examples

```plaintext
studio: darken dark-mode secondary button to sit below default
workspace: move pins into task settings and drop KV store
dx: drop eslint --cache from lint scripts and editor
studio: revert dark-mode secondary variant on new task button
```

Use comma-separated package/app scopes only when changes genuinely span both areas (`studio,workspace`). Omit scope only for truly repo-wide changes.

## What the message describes

- If conversation context describes recent work, use that as the primary signal -- don't let unrelated staged or unstaged changes dilute the subject.
- Otherwise, prefer staged changes (`git diff --cached`). If nothing is staged, assume the user wants to commit everything (`git diff HEAD`).
