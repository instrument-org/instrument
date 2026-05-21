---
name: instrument-commit-message
description: Generate a git commit message matching the Instrument monorepo's conventional commit style. Use when the user asks for a commit message, wants to commit changes, or asks how to describe their changes. Knows the repo's scopes (studio, workspace, shim-client), types (feat, fix, dx, refactor, chore, release), and real examples from the commit history.
paths:
  - "apps/studio/**"
  - "packages/**"
---

# Commit Message

## Format

`<type>(<scope>): <short description>`

- **Types:** `feat`, `fix`, `refactor`, `chore`, `dx`, `docs`, `release`
- **Scope:** always include; use the package/app name (`studio`, `workspace`,
  `shim-client`, etc.) or omit only for truly repo-wide changes
- **Description:** lowercase, no period, imperative mood, under 72 chars
- **Body:** optional bullet list explaining the _why_ or _what_ in more detail

## Examples

One per type, drawn from the repo:

```plaintext
feat(studio): migrate split pane to react-resizable-panels
feat(workspace): sync ai titles to default session chat titles and generate for new sessions
fix(studio): keep agent browser views composited via shield z-layer
fix(studio,workspace): avoid Windows agent-browser command hangs
fix(workspace): stub the model always to avoid usage during replay
refactor(studio): unify agent session status into shared hook and component
refactor(studio,workspace): export and use explanation helper by name for extraction
dx(workspace,studio): add session replay feature
dx: migrate type checking to tsgo (TypeScript 7 native preview)
perf(studio): virtualize model picker
chore(deps): bump vitest to 4.1.5 and fix studio smoke tests
docs(studio,ai-gateway): explain cacheidentifier for openrouter user caching
ci: gate release to s3 on successful smoke test
```

Scopes: `studio` (`apps/studio`), `workspace` (`packages/workspace`),
`shim-client` (`packages/shim-client`), `ai-gateway`, `registry`, `ci`;
omit scope only for repo-wide changes. Use comma-separated scopes only when
changes genuinely span two packages.

## How to write the message

**Determine what's being committed:**

- If conversation context describes recent work, use that as the primary signal
  for what the commit covers -- don't let unrelated staged or unstaged changes
  dilute the subject.
- Otherwise, prefer staged changes (`git diff --cached`). If nothing is staged,
  assume the user wants to commit everything (`git diff HEAD`).

**Then write the message:**

1. Pick `type` based on intent -- new or changed user-visible behavior
   (including UI redesigns, new interactions, visual changes) → `feat`,
   broken thing → `fix`, pure internal restructuring with zero behavior change
   → `refactor`, tooling/deps/config → `chore`/`dx`
2. Pick `scope` from the list above; comma-separate only when changes genuinely
   span two packages
3. Write the subject as a short imperative: _what does this commit do?_
4. Add a body only when the subject alone would be cryptic -- keep bullets tight

## Display & clipboard

Display the message inline at the end of your response — no code block.
Subject-only example (no trailing newline):

feat(studio): animate collapsible tool call cards

With body:

fix(workspace): write initial project name in single manifest write

- avoid a race where two writes could stomp each other during initializeProject

Copy to clipboard immediately after displaying
(pipe through `tr -s '\n'` to suppress blank lines):

```bash
printf %s "feat(studio): animate collapsible tool call cards" | tr -s '\n' | pbcopy
```

With body:

```bash
printf %s "fix(workspace): write initial project name in single manifest write

- avoid a race where two writes could stomp each other during initializeProject" | tr -s '\n' | pbcopy
```
