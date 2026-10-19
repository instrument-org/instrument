---
name: chat-history
description: Search the user's earlier chats, everything said, decided and done in them (commands and their output, tasks), and link the one you drew on. For when the user asks about something from before (what was picked, a command that worked, where they left off), even without naming a chat, or when what they ask for depends on details settled in another chat.
---

# Chat history

Every chat's records, this one's included, are in `$INSTRUMENT_CHATS`, read-only: a folder per chat, named by its id. `records.md` beside this file says what each file and record in them is.

- Search them with your own tools. `rg -il '<words>' "$INSTRUMENT_CHATS"` names the chats a word is in, and the folder each file is in is that chat's id.
- A record is one line, often a long one: `rg -o '.{0,120}<words>.{0,120}'` shows what is around a match, and `jq` reads a record whole.
- A message whose `role` is `session-context` is what the app told the agent at the start of every chat, so a match there says nothing about the conversation.
- A chat's title is in its `marks.<device>.jsonl`. The newest chats are first in `ls -t "$INSTRUMENT_CHATS"`.
- When an answer comes from another chat, link that chat in the reply, as `[the user's words for it](instrument://chat/<id>)`, so the user can open it.
- Another chat's work is that chat's to steer: read it, and change nothing of it.
