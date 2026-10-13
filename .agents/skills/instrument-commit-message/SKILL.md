---
name: instrument-commit-message
description: Generate a git commit message matching the Instrument monorepo's scope-first commit style. Use when the user asks for a commit message, wants to commit changes, or asks how to describe their changes. Knows the repo's scopes (studio, workspace, dx, etc.) and real examples from the commit history.
---

# Commit Message

## Format

`scope: clear, concise description of what changed`

- **Scope:** default to the package/app that owns the change (`studio`, `workspace`, `ai-gateway`, `shared`) or an established workflow scope (`dx`, `ci`, `release`, `docs`, `evals`, `studio-drive`). Use a feature-area scope only when recent history shows that scope is established (`task`, `topics`); do not invent one from the subject matter.
- **No conventional types.** Drop `feat:`/`fix:`/`refactor:`/`chore:` etc. Let the description imply the nature of the change.
- **Description:** lowercase, no period, under ~72 chars. Start with a concrete verb and name the product noun or feature affected, then the observable behavior: `restore window bounds`, `open reply folders`, `suppress duplicate folder notices`.
- **Plain verbs, not `draw`:** history since mid-2026 uses `draw` for icons, layout, rendering, and data alike; don't copy it. Pick the verb for what changed:
  - An icon: `use <icon> for <thing>`, or `change <thing> icon to <icon>` for a swap: `use feather icon for the rail's New button`, `change skills icon to cube`.
  - How something looks or is laid out: `show <thing> as <form>`, or name the property: `show recent pages as a dense grid`, `make tooltip hairlines opaque`.
  - When or how it paints: `render`: `render a transcript's last turns first`, `render thumbnails offscreen on Linux`.
  - Where its content comes from: `build`, `read`, or `load` from a source: `build chat rows from a stored digest`.
- **Standalone subject:** write a history label, not a sentence from the implementation story. Avoid starting with articles or pronouns; personification, metaphors, comparisons, and contrast clauses belong in the body. Prefer product behavior over an implementation detail unless that detail is the public contract.
- **Check:** someone scanning `git log --oneline` should identify the feature and behavior without reading the diff or task. Rewrite the subject if they cannot.
- **Body:** use a body for context, rationale, follow-on detail, or edge cases an agent will need later. Keep that detail out of the subject.
- **Trailers:** a commit that makes a choice ends with decision trailers (below). Styling, copy, and mechanical commits carry none.

## Decision trailers

The final paragraph, one `Key: value` per line. Never wrap a value onto a second line: git then reads none of the block as trailers. Write only lines the session actually supports; skip any you would have to invent. When the session never weighed another way, the commit carries no `Rejected:`.

| Trailer                               | Records                                                                                                                                                                                                             |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Rejected: <alternative> \| <reason>` | An alternative raised or tried in the session before the change was made, by the user or the agent. Never one thought up while writing the message. Repeatable.                                                     |
| `Commits-to:`                         | A shape, contract, or invariant later code has to keep honoring.                                                                                                                                                    |
| `Not-tested:`                         | What was not checked: never run in the app, not checked against a real agent, a known gap left open. Required when the change never ran where its behavior shows (the running app, a packaged build, a real agent). |
| `Related: <sha>`                      | A commit this one reverses or extends.                                                                                                                                                                              |
| `Tested:`                             | Only a check beyond the unit suites: the running app, a real agent run, a test host. Never test counts.                                                                                                             |

Every reason stands without the session. `Rejected: per-folder read-only setting | user dropped it` is chat history; `Rejected: per-folder read-only setting | the allowlist and task grants already limit writes` is a reason.

```plaintext
workspace: work out a chat's folders when used and drop the access choice

<body>

Rejected: keep the stored per-chat list | it protects nothing; the allowlist and task grants do
Rejected: derive task folders too | a task can run python; its stored grant is its real limit
Commits-to: chat records hold only folders the user sent
Commits-to: folderReach is the one source for shell, prompt, grants and state
Not-tested: never run end to end in the app
Related: 56f0e30d4 (reverses its attach-on-message)
```

## Examples

```plaintext
studio: refuse deleting a workspace folder that holds userData
workspace: run osascript scripts as code, with /task literals bridged
topics: edit a topic's instructions in its details dialog
dx: hash the root oxlint config into every package's lint cache
```

Use comma-separated package/app scopes only when changes genuinely span both areas (`studio,workspace`). Omit scope only for truly repo-wide changes.

## What the message describes

- If conversation context describes recent work, use that as the primary signal -- don't let unrelated staged or unstaged changes dilute the subject.
- Otherwise, prefer staged changes (`git diff --cached`). If nothing is staged, assume the user wants to commit everything (`git diff HEAD`).
