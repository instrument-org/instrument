# Memory: what the conversation keeps about the user

Status: built, first version, global only. One folder of Markdown files the conversation's agent writes through a `memory` command and every thread is told about; a Memory section in Settings lists them, forgets one, and opens the folder. Per-topic memory, the row in the reply, and the popup the wireframe draws are the next version.

## The rule

Memory is what the agent learned about the user that will matter in a thread next week: how they like things done, standing facts about them, a decision that stands, a correction they gave. The agent keeps it itself, one fact per memory, corrected in place rather than piled up, and says in a few words when it saved one. The user never configures it, but all of it is inspectable: a folder of plain files they can read, edit, and delete with a file manager, and a list in Settings with a way to forget each one.

Most turns save nothing. What a task made and where it is belongs to the thread and its files fence; work in flight, the details of one ask, guesses, and secrets are never memory. What the user asks to remember is a memory whatever it is; what they ask to forget is gone.

A memory is what was true when it was saved. When it disagrees with what the user says now or a task reports, the present wins and the memory gets corrected. This is the one line every harness surveyed converges on, and it is in the note the agent reads.

## Where it lives

`memory/` at the workspace root, beside `apps/` and `skills/`. One file per memory, named by a slug (`pacific-time.md`, `no-stevia.md`): a short frontmatter naming the thread it was learned in (`from`, `thread`) and when (`at`), then the memory as text, written to the user in a sentence ("You are on Pacific time and mornings are best for calls."). A file with no frontmatter is still a memory, dated by the file, so a note the user drops into the folder counts. The folder is the system of record; nothing is indexed or cached from it.

Why files and not rows: the surveyed harnesses that have memory at all keep it as Markdown in a per-user folder, with a database only as a derived index, because the person has to be able to read and edit it with nothing but a file manager. Why one file per memory and not one list: the wireframe's per-item trash glyph, and correction by replacement under a name, are each one file operation, and the same operations the user can do by hand.

## The agent's side

The conversation's agent has no tool that writes a file's contents, on purpose, so memory is a command in its shell rather than a file it edits: `memory list`, `memory save <name>` with the text on stdin through a quoted heredoc (or as one quoted argument), `memory show <name>`, `memory forget <name>`. Saving to a name that exists replaces what it held and says `Replaced` rather than `Saved`. The command names the thread it ran in on what it saves.

The prompt's Memory section says what to keep, when to save it (in the same reply, said in a few words), the slug and the second-person sentence, replacement under the same name, and the do-not-save list. `SESSION_CONTEXT_VERSION` moved to 27 so threads with a stored baseline get the section.

What the agent is told: a `data-memory` part on a thread's user message carries every memory's first line, the thread it came from, and when, rendered as a system note with relative times measured from the message's own instant so a rebuilt transcript reads the same. State cadence: the part is attached only when memory's revision (a hash over names, times, and text) differs from the one this session was last told, recorded per session in the session store the way the pane report is. So a thread hears the list once, on its first message, and again only when another thread, the user, or a file edit changed it. A change the thread made through its own command is recorded as told, so the next note never restates what the agent just did. The note lists at most 64 memories and counts the rest.

Tasks do not see memory. The conversation carries what matters into a brief in its own words, as it does with everything else it knows.

## The user's side

Settings, General, a Memory section: what Instrument remembers, one row per memory with its text, the thread it came from, and how long ago, a trash button that forgets it, and a button that opens the folder in the file manager. Live over `orchestrator.memory.live.list`, which re-reads the folder on every `memory.changed` event the store publishes. In developer mode the transcript shows the note as a context card, the way the topics note shows.

## Next

- Per-topic memory: a `topic` on the frontmatter or a folder per topic, the note split into the thread's topics' memories and everyone's, and the topic overview's "What I know" list from the wireframe.
- The row in the reply and its popup, once saving is drawn as a row rather than read off the command's label.
- A folder watcher, so a file edited by hand reaches open threads without waiting for the next save.
- Whether a task may read memory, and whether the conversation should hand a task the memories that bear on its brief.
