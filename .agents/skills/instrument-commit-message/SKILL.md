---
name: instrument-commit-message
description: Generate a git commit message matching the Instrument monorepo's scope-first commit style. Use when the user asks for a commit message, wants to commit changes, or asks how to describe their changes. Knows the repo's scopes (studio, workspace, dx, etc.) and real examples from the commit history.
---

# Commit Message

## Format

`scope: clear, concise description of what changed`

- **Scope:** default to the package/app that owns the change (`studio`, `workspace`, `ai-gateway`, `shim-client`) or an established workflow scope (`dx`, `ci`, `release`, `docs`). Use a feature-area scope only when recent history shows that scope is established; do not invent one from the subject matter.
- **No conventional types.** Drop `feat:`/`fix:`/`refactor:`/`chore:` etc. Let the description imply the nature of the change.
- **Description:** lowercase, no period, under ~72 chars. Start with a concrete verb and name the product noun or feature affected, then the observable behavior: `restore window bounds`, `open reply folders`, `suppress duplicate folder notices`.
- **Standalone subject:** write a history label, not a sentence from the implementation story. Avoid starting with articles or pronouns; personification, metaphors, comparisons, and contrast clauses belong in the body. Prefer product behavior over an implementation detail unless that detail is the public contract.
- **Check:** someone scanning `git log --oneline` should identify the feature and behavior without reading the diff or task. Rewrite the subject if they cannot.
- **Body:** use a body for context, rationale, follow-on detail, or edge cases an agent will need later. Keep that detail out of the subject.

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
