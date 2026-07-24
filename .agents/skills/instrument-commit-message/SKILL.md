---
name: instrument-commit-message
description: Generate a git commit message matching the Instrument monorepo's scope-first commit style. Use when the user asks for a commit message, wants to commit changes, or asks how to describe their changes. Knows the repo's scopes (studio, workspace, dx, etc.) and real examples from the commit history.
---

# Commit Message

## Format

`scope: clear, concise description of what changed`

- **Scope:** the main area touched -- a package/app (`studio`, `workspace`, `shim-client`), a workflow (`dx`, `ci`, `release`), or a feature area (`breadcrumb`, `task`). Prioritize scope over type.
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

Use comma-separated scopes only when changes genuinely span two areas (`studio,workspace`). Omit scope only for truly repo-wide changes.

## How to write the message

**Determine what's being committed:**

- If conversation context describes recent work, use that as the primary signal -- don't let unrelated staged or unstaged changes dilute the subject.
- Otherwise, prefer staged changes (`git diff --cached`). If nothing is staged, assume the user wants to commit everything (`git diff HEAD`).

**Then write the message:**

1. Pick the `scope` -- the main area touched.
2. Write the subject as a short description: _what does this commit do?_
3. Add a body when it adds useful context -- keep bullets tight.

## Display & clipboard

Display the message inline at the end of your response -- no code block. Example without body (no trailing newline):

studio: animate collapsible tool call cards

With body:

workspace: write initial task name in single manifest write

- avoid a race where two writes could stomp each other during initializeProject

Copy to clipboard immediately after displaying (pipe through `tr -s '\n'` to suppress blank lines):

```bash
printf %s "studio: animate collapsible tool call cards" | tr -s '\n' | pbcopy
```

With body:

```bash
printf %s "workspace: write initial task name in single manifest write

- avoid a race where two writes could stomp each other during initializeProject" | tr -s '\n' | pbcopy
```
