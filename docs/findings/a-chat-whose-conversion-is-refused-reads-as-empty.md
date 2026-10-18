# A chat whose conversion is refused reads as empty, and nobody is told

**Status:** open, and bounded: nothing is lost on disk and every launch tries again. What is missing is a word to the person.

The converter writes a chat's records into a work folder and moves them into place only once they read back as the database does. A chat it refuses (`different`, `half-written`, `failed`, `unreadable`) therefore keeps its `chat.db` and gains no records: `setAsideStores` moves a database out of the workspace for a converted chat alone, so the conversation is still there, whole, in the file it was always in.

What the person sees is the gap. The chat list is built from the folders under `chats/`, so the chat is still listed; its title comes from its records, so it is listed under its folder name; opening it shows a conversation with nothing in it. The app logs a warning per chat (`Chat records: left <id> on its database and will try again next launch: <reason>`) and shows nothing.

For a transient failure that resolves itself on the next launch. For a refusal that is about the data rather than the moment, `different` above all, it repeats every launch and the chat stays empty for good while its conversation sits beside it.

## What would close it

Either of these, and the second is the smaller:

- A read that falls back to the database for a chat that has one and no records. This is the thing the branch deliberately removed: one write door, one read gate. Putting a second read path back for a case that has not been seen in 392 real chats buys little for what it costs.
- A word to the person for a chat the converter refused: the chat says it could not be brought over yet and its conversation is safe, rather than opening empty. Nothing else in the app has to change, and the logs already name the chats.

## What is already true

- The database is never deleted or moved for a refused chat, so the conversation is recoverable by hand today.
- The acceptance run converted 392 real chats with no refusal.
- A chat that fails for a reason that passes (a locked file, a disk that filled) converts on the next launch with no one involved.
