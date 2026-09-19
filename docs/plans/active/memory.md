# Memory: what the conversation keeps about the user

Status: built, first version, global only. One folder of Markdown files the conversation's agent writes through a `memory` command and every thread is told about; a Memory tab in Settings reads them, forgets one, and starts an import from the coding agents already on this computer or from a chat tool on the web. Per-topic memory, editing a memory in place, and the row in the reply the wireframe draws are the next version.

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

A Memory tab in Settings, beside General and Providers: one row per memory, the memory itself, and under it the thread it was learned in and how long ago. The thread's name is a link that closes Settings and opens that thread, drawn only where there are threads to open, since a name the reader cannot reach is worth less than the room it takes. Revealing the folder sits beside the list it holds rather than adrift at the foot of the screen. Live over `orchestrator.memory.live.list`. In developer mode the transcript shows the note as a context card, the way the topics note shows.

A tab rather than a block under General because this is a list that grows and none of it is a setting. Not a screen of its own in the window: every screen there is a tab inside a thread or a draft, by design, and a global list has no thread to belong to.

A memory taller than a few lines is folded, with the whole of it a click away, so one long import does not bury the rest. Forgetting one asks first and quotes what it is about to forget, since nothing else on the screen is destructive. The folder is watched while the list is on screen (`lib/memory/watch.ts`), so a file edited by hand, or by another window, reaches the list without a reload.

## Importing what the user already has

Above the list, because an empty list is exactly when someone needs it, and folded once there is a list to read, because importing is done once.

Two groups, because the difference decides what happens next. **On this computer** is the coding agents already installed: their memory is a file on disk, read in a moment. The app looks for them itself and offers only what is there, with the folder shown the way a person writes it (`~/.claude`). Looking is free, and this is the part worth knowing: macOS puts Desktop, Documents, Downloads, iCloud and other cloud storage, removable and network volumes, and Time Machine behind a consent prompt, and nothing else in the home folder. A hidden folder there is not protected, so nothing is asked of the user to find out a tool is installed. Which tools and their markers are in `lib/memory/sources.ts`; the same homes the skill discovery already walks.

**On the web** is the chat tools, whose memory is on their own servers. The only road that works across all of them is the one they all answer: ask in a chat.

The folder is only ever read. The home folder is attached whole, and a folder holding the workspace is read-only by rule (`effectiveFolderAccess`), so a write into `~/.claude` fails with EROFS: verified in the running app, where `mkdir` there was refused and nothing was created. The prompt says the same thing in words, and says to read it in the conversation rather than hand it to a task, since a task can be granted write access to a folder inside home and this one is another tool's memory.

Either way the app parses nothing. Pressing a row opens a thread whose first message asks Instrument to do it, and the conversation reads, judges, and saves. A tool that redesigns its screens or moves its file next month costs a sentence rather than a parser. The prompts say plainly that the saving happens back in the thread, because a task has no memory command and a brief that told one to save would end in a task reporting a thing it could not do; and the local one names the folder rather than `~`, which is not a path the agent can open.

## What the local import does on a weak model

Measured 2026-09-19, four runs on GLM 5.3 Flash and one on Qwen3.8 27B, each against a copy of a real `~/.claude`: an 8 KB instructions file and 87 project memory files. A copy rather than the real folder, so a bad run could cost nothing; the content is the genuine article, which is what the question was about.

Two of the four GLM runs imported, and Qwen imported first try. The two failures are the ones already recorded above and neither is particular to importing: one said "Looking in the .claude folder" and called nothing, the other died on a malformed tool call the provider rejects before any repair can see it.

What the runs that worked did is the encouraging part. None started a task. None attempted a write. One read the instructions file, then the memory index, then named the dozen files it wanted rather than reading all 87. What they saved was genuinely about the person: how they dictate, how they want prose wrapped, American English, terse reports, the shape of an end-of-turn block, the machines they work across. The esoterica risk is real but mild: the richest run also kept a few facts that are really about how one project works. A clause was added for that, preferring what a tool was told about the person over what it worked out about a project, and calling a fact that names a repository, a branch, or a file almost never about the person.

Cost is the thing to watch rather than safety: reading a memory store that size ran 160K to 310K tokens for one import. One run's habit of reading the index first is what keeps that bounded, and nothing enforces it.

## Next

- Per-topic memory: a `topic` on the frontmatter or a folder per topic, the note split into the thread's topics' memories and everyone's, and the topic overview's "What I know" list from the wireframe.
- The row in the reply and its popup, once saving is drawn as a row rather than read off the command's label.
- The voice of an imported memory wobbles: the prompt asks for the user's own words and models write half of them in the third person.
- The watcher covers the screen that lists memories; an open thread still hears only about changes made through the command.
- Whether a task may read memory, and whether the conversation should hand a task the memories that bear on its brief.
- A turn that hands off ends, which is why the save has to ride in the hand-off command. If prompt wording turns out not to hold across models, the alternative is letting the turn-ending rule grant one more step to a turn that handed off without saving what it said it saved, the way it already grants one to a turn that promised a task and started none.
