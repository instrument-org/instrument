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

The prompt's Memory section says what to keep, when to save it (in the same reply, said in a few words), the slug and the second-person sentence, replacement under the same name, and the do-not-save list. It also names `memory` as a command in the bash tool and shows the save riding in the same command as a `task new`, both for the reason below. `SESSION_CONTEXT_VERSION` moved to 28 so threads with a stored baseline get the section.

## What it does on a weak model

Measured 2026-09-19 on GLM 5.3 Flash at high effort, which is what this project tests against and not what the conversation ships on. A preference stated inside a work ask is the hard case, and it now passes three times out of three: the save rides in the same command as the `task new`, because a turn ends the moment a task is created and anything the model meant to do after that never gets a step.

A preference stated on its own passes about one run in three, and Qwen3.8 27B passed it first try. Sampled with a fresh home each time, the two failures are the model's rather than the mechanism's: it wrote `memory save ...` as text inside its reply, or it reasoned "Save memory" and then called nothing at all. Both end with the user told that something was remembered when it was not, which is the failure worth naming and the reason one assertion looks only for that. Nothing in the prompt moved the rate: naming the bash tool and showing the command fenced and unfenced all measured the same.

A third failure is repaired in the harness rather than prompted away. The model emits a tool call whose name is a shell command, sometimes the entire script with its heredoc, and the step is spent on a tool that does not exist. `repair-shell-command-tool-call.ts` turns such a call back into the bash call it meant, for `memory`, `task`, `app` and `chat` alike; the same mistake on `task` was measured at two to four wasted calls a run when the first-class task tool was being weighed. It is a real fix for a failure seen twice here, and it is not why any pass rate above is what it is.

What the agent is told: a `data-memory` part on a thread's user message carries every memory's first line, the thread it came from, and when, rendered as a system note with relative times measured from the message's own instant so a rebuilt transcript reads the same. State cadence: the part is attached only when memory's revision (a hash over names, times, and text) differs from the one this session was last told, recorded per session in the session store the way the pane report is. So a thread hears the list once, on its first message, and again only when another thread, the user, or a file edit changed it. A change the thread made through its own command is recorded as told, so the next note never restates what the agent just did. The note lists at most 64 memories and counts the rest.

Tasks do not see memory. The conversation carries what matters into a brief in its own words, as it does with everything else it knows.

## The user's side

A Memory tab in Settings, beside General and Providers: one row per memory, the memory itself, and under it the thread it was learned in and how long ago. A memory that runs past a line opens on its caret; the thread's name is a link that closes Settings and opens that thread, and it is drawn only where there are threads to open, since a name the reader cannot reach is worth less than the room it takes. A trash button forgets one. Live over `orchestrator.memory.live.list`, which re-reads the folder on every `memory.changed` event the store publishes. Revealing the folder in the file manager is still there, quiet, at the foot. In developer mode the transcript shows the note as a context card, the way the topics note shows.

A tab rather than a block under General because this is a list that grows and none of it is a setting. Not a screen of its own in the window: every screen there is a tab inside a thread or a draft, by design, and a global list has no thread to belong to.

## Importing from another tool

Under the list, one product button per chat tool worth asking: ChatGPT, Claude, Gemini, Grok, Copilot, Perplexity. Pressing one opens a thread whose first message asks Instrument to open that tool, check the user is signed in, ask it in a chat what it remembers about them, bring the answer back, and save the durable facts here. Nothing is parsed and nothing is scraped by the app: the conversation drives the page and decides what is worth keeping, so a tool that redesigns its screens next month costs a sentence rather than a parser. The prompt is explicit that the saving happens back in the thread, because a task has no memory command and a brief that told one to save would end in a task reporting a thing it could not do.

## Next

- Per-topic memory: a `topic` on the frontmatter or a folder per topic, the note split into the thread's topics' memories and everyone's, and the topic overview's "What I know" list from the wireframe.
- The row in the reply and its popup, once saving is drawn as a row rather than read off the command's label.
- A folder watcher, so a file edited by hand reaches open threads without waiting for the next save.
- Whether a task may read memory, and whether the conversation should hand a task the memories that bear on its brief.
- A turn that hands off ends, which is why the save has to ride in the hand-off command. If prompt wording turns out not to hold across models, the alternative is letting the turn-ending rule grant one more step to a turn that handed off without saving what it said it saved, the way it already grants one to a turn that promised a task and started none.
