# The agent's context only grows forward

What the agent has already been told is never rewritten. A change reaches it as something appended: a note after the chat's start, a new message part, a delta. That keeps the provider's cache valid, so every turn is faster and cheaper, and it keeps the agent's picture of the chat current and honest: it learns what changed and when, instead of finding its past silently different.

**Applies when:** changing a system prompt across releases, pruning images or old content, adding details that vary by model or computer, correcting something the agent already saw.

- A chat's start is written once. A release's new prompt reaches an old chat when its context window rolls over.
- Tool descriptions stay static. Details that vary by model or computer go in appended message parts.
- Tools are not added or removed in the middle of a conversation.
- Nothing retracts or edits earlier context.
- Switching computers breaks the cache on purpose, so the agent is told about the switch.

**Not:** a ban on the rollover itself, which already rewrites the front of the request and is where a new start belongs.

**Sources:**
- [A chat's start is written once, and what changes is told after it](../decisions/2026-10-15-a-chats-start-is-written-once.md) (2026-10-15), landed `8cec69ccc`; append, never rewrite, stated the same day.
- Token savings must not break the cache, stated 2026-10-04; no tools added or removed mid-conversation, 2026-10-07.
- No retraction of earlier context, stated 2026-10-18; static tool descriptions with appended parts, 2026-10-21.
- Appending also keeps the agent aware of what changed, stated 2026-10-30.
