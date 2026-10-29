# A chat's start is written once, and what changes is told after it

Date: 2026-10-15

Builds on [plans/active/immutable-session-context.md](../plans/completed/immutable-session-context.md), which made the baseline survive a clock and left compaction open.

## Context

A session's baseline (its system prompt and context message) is the front of every request, and so the bytes a provider's cache is keyed on. It was written once, with one exception: a stored system prompt that differed from the one the running build writes was replaced on the next turn, so a prompt edit reached every chat with no version bump.

That rule could not tell an app update from a computer. The system prompt named the output, apps and skills folders by full path, an example under the home folder, and the Mac's or Windows's own guidance. Once chats sync, two computers with different user names, or a Mac and a PC, each read the other's prompt as outdated and rewrote the chat's start on every switch, missing every cache each time. On the records branch a rewrite is a retract record plus new message records appended to that device's log, so the two would grow each other's logs on every turn. And between two computers with the same paths, nothing was rewritten, so the chat kept telling the agent about the first one's OS, time zone and folders.

The agents that work hardest at caching ended up in one place: Codex, Claude Code, opencode and pi keep what the model was first told, and append only what changed. Codex, Claude Code and pi keep a conversation's system prompt across app updates; Claude Code swaps it in at compaction.

## Options weighed

**Keep rewriting on a differing prompt, and take the paths out.** Rejected: it fixes the paths and keeps the loop for anything else that differs per computer, and it still rewrites every chat on every release.

**Rewrite once per declared prompt version.** Kept as the escape hatch it already was (`SESSION_CONTEXT_VERSION`), not the default: one cache write per chat per bump, for a change old chats must hear before their next rollover.

**Append a note when a release changes the prompt.** Not taken: workable for one rule, unwieldy for a rewrite, and someone writes each note.

**Keep the start until the window rolls over.** Chosen. The rollover already rewrites the front of the request, so writing the baseline again there costs nothing extra, and it is where a release's new prompt reaches an old chat.

## Decision

`lib/session-baseline.ts` writes a session's baseline when it has none, when the window rolls over past it, or when it is marked older than `SESSION_CONTEXT_VERSION`, and at no other time. A task sends its own baseline once it has one, else the one it inherited.

The system prompt is the same on every computer. It names folders by the shell's variables (`$INSTRUMENT_OUTPUT`, `$INSTRUMENT_APPS`, `$INSTRUMENT_WORKSPACE_SKILLS`), never by path, and says nothing true of only one platform. The context message carries what is: the OS, the time zone, where each variable's folder is (written out, since the file tools read no variable), and the platform's shell guidance. It records those facts on its metadata as `environment`.

When the computer, OS version, time zone or a folder differs from what the session was last told, the next message carries a `data-environmentChange` part with the facts that changed, compared as values, and its note supersedes the system information without rewriting it. "Last told" is read from the session's own history (the baseline's record, with each note since laid over it), so it is what the model saw on whichever computer the chat was last used, and it syncs with the chat's messages.
