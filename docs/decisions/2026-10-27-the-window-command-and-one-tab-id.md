# `instrument window` is what is in front of the person, a tab has one id, and the prompt holds for a task too

Date: 2026-10-27

## Context

The chat and the tasks it forks share one system prompt, word for word, so a provider caches it once, and the same tools ([one agent that forks](2026-10-07-one-agent-that-forks.md)). Tasks report to their chat, and the chat owns the person's memory, their window and the other tasks ([tasks report to their chat](2026-09-29-tasks-report-to-their-chat-not-to-each-other.md)); a task starts no task of its own.

The prompt was written for the chat alone. It told every session "This chat's tabs are yours to arrange with `instrument tab`" and "Save the place they pick as a memory", and a task's shell had neither `instrument tab` nor `instrument memory`: it refused both with "only the chat has this". In the `task-tabs-compare` eval on Claude Haiku 5.5, a task asked to open two pages side by side ran `instrument tab open`, was refused, and read both pages with `curl` instead, dropping the two tabs; `agent-browser tab new`, which it had, was never tried. Every saved eval transcript with that refusal was this case, one run saved twice: three refusals, all `instrument tab` (`list` once, `open` twice).

Separately, one set of tabs, the chat's tabs in the person's window, was reached by two commands with two ids. `instrument tab` (the chat's: open, show, replace, close, list, read, request) named each by its `tab_` id; `agent-browser tab` (chat and tasks: new, switch, close, for driving pages) printed its own `t1`, `t2` with the `tab_` id beside it. A model handed `tab_…` by a note and shown `t2` by agent-browser has to keep a mapping in its head, and `instrument task new --tab t2` was already refused often enough to need its own message.

## Options weighed

- **Name.** `instrument tab` named the object, which collides with agent-browser's `tab`. `instrument screen` was rejected: "screen" already means an app view inside a tab (the Apps screen, the Tasks screen). `instrument window` names the purpose, what is in front of the person, and matches what the context notes already say ("the window showed …").
- **Forms.** `open` and `show` collapse into `show <url|path|tab_id>…`: putting something in front is one act whether it is new or already open. `replace <id> <url>` becomes `show <url> --in <id>`. `list`, `read`, `close` and `request` keep their words. `list` reads as what is in the window: one line per tab with its id, whether it is in front, its title and address, and which task is working in it.
- **Ids.** Keep both and teach the mapping (what we had); print only agent-browser's labels; or print only `tab_` ids. agent-browser already takes a CDP target id anywhere it takes a label, and the bridge makes the target id the window's `tab_` id, so the last needs no change to agent-browser itself, only to what the wrapper prints.
- **The task gap.** Split the prompt into a chat prompt and a task prompt (loses the cached prefix the shared prompt exists for); keep the shared prompt chat-worded and rely on refusals (what we had, and what failed); or make the shared prompt true for both roles and give tasks the read-only forms.
- **Old calls.** Drop `instrument tab` outright, or keep it as an alias. Stored conversations hold old calls, and a model imitates its own history.

## Decision

- `instrument window` replaces `instrument tab` (`shell-commands/window.ts`, `window-command.ts`), with the forms above. The window's `list` answer carries `front` for the tab the chat has up while the chat is on screen.
- One id per tab. The agent-browser wrapper prints the `tab_` id in place of `t1` in `tab list` (text and `--json`) and ends `tab new` with the id it opened (`agent-browser-tab-ids.ts`). agent-browser still accepts `t1` if a model types it, since that costs nothing and refusing it would break a model working from the upstream guide; the guide's addendum says the `tab_` id is the one to use.
- A task's shell has `instrument window list|read` and `instrument memory list|show`. Changing the window, saving or forgetting a memory, and `instrument task` stay the chat's, and each refusal says what to do instead: open pages of its own with `agent-browser tab new <url>` and say in the report what the chat should show; say what the chat should remember; do the work here and say what is left.
- The shared prompt is role-neutral and stays byte-identical between chat and task: one line says that changing the window, saving or forgetting memories, and starting or steering tasks are the chat's, and that a task's report says what the chat should save, show or start; the window paragraph says the chat arranges the window; "Save the place they pick as a memory" became "The place they pick is a memory to keep".
- `instrument tab …` keeps working as an alias: it runs the `instrument window` form it became (`open` and `show` as `show`, `replace <id> <x>` as `show <x> --in <id>`) and prints one line naming that form. It is left out of `instrument`'s listing. `SESSION_CONTEXT_VERSION` is not bumped, since a chat still holding the old prompt runs its old calls through the alias.

## Consequences

- A task can see what is in front of the person and read a page there, and can read what is remembered, without being able to change either.
- The chat's digest of opened sites reads both `instrument window show <url>` and the old `instrument tab open|replace` from transcripts.
- A model may still type `t1`; it works, and is never printed back.
- The alias is one more word the shell answers. It can go once stored conversations no longer carry the old form, which is a later decision.
