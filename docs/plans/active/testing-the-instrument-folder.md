# Testing the Instrument folder

Status: proposed. Nothing here has been run. Written 2026-10-16, after F1 landed and F3 and F4 began.

What changed is where a person's data lives and what moves it there. The unit tests cover the pieces; they cannot cover a real install's data, a second computer, or an agent actually using a folder. This is what to do before any of it reaches a build.

Ordered by what it would cost to get wrong.

## 1. The migration, rehearsed on a copy of real data

The only part of this work that can lose something a person cannot get back. It runs once per install, against 688 chats on the dev workspace, and a bug in it is permanent.

No app, no GUI. Copy the workspace, run the launch migrations against the copy, and assert. Scripted, so it can run again after every change to a migration.

What to assert, in this order, because the first failure makes the rest meaningless:

- **Nothing is lost.** Total bytes and total file count under the workspace are the same before and after, allowing only for the files the migration is known to add. A move that silently drops a file shows up here and nowhere else.
- Every chat has exactly one folder, and the count of folders under `Chats/` equals the count of chats.
- No two chats claim the same folder.
- The 15 chats with attachments have them in their own folder, and **not** in both places.
- Memories are in `Memory/` and not in `.instrument/memory/`.
- Every `CHAT.md` parses, carries its chat's id, and renders the same bytes when rendered twice.
- Running the whole migration a second time changes nothing at all: no file written, no folder made.
- A `Memory/` or an `attachments/` the person made first is untouched, with the hidden copy left where it is rather than merged over.

Run it against a copy of the real dev workspace (688 chats) and against a seeded fixture, so a failure can be told apart from a quirk of one install.

## 2. One chained session per operating system

The same walkthrough on each of the three, in one sitting each, rather than a matrix of isolated cases. A case that needs its own setup does not get run.

Mac Studio, then Windows (`cubetop`), then Linux (`ubuntu-vm`). Each step leaves the state the next one needs:

1. New chat, paste a screenshot, send. The folder exists before the first command runs, with the screenshot in it.
2. Ask for something that produces a file. It lands in the chat's own folder, not in a job subfolder and not in the Instrument folder.
3. Let the title settle. The folder is renamed, and the screenshot and the finished file are both still in it.
4. Rename the chat in the app. The folder follows between turns.
5. Rename the folder in the file manager. The chat adopts it, and the next turn writes the transcript there.
6. Start a background job, then rename the chat while it runs. Nothing crashes. On Windows the rename is refused and retried later; on macOS and Linux it happens. Either way the job keeps running and the chat keeps working.
7. Attach a file from Documents and have the agent change it. The original changes. No copy appears anywhere.
8. Delete a chat, leaving the folder. Then delete another, taking the folder. The first one's files are still there.

Windows earns the most attention: it is the platform where the rename genuinely fails, where paths are spelled differently for the shell, and where the 260-character limit bites.

## 3. Two computers, which nothing has tested

The record format exists to survive this and it has never been tried outside a simulation.

Two Macs with the workspace in iCloud Drive. The Mac Studio and the macOS VM will do; the VM has to be running, which it is not by default.

- A chat made on each, at the same time. Both appear on both, once.
- The same chat starred on one and archived on the other. Both marks survive; neither wins over the other.
- A chat renamed on one. The other follows the rename rather than making a second folder.
- A folder renamed in the Finder on one computer while the other has the chat open.
- A draft typed on both at once. The conflict copy is read as a second draft rather than lost.
- One computer offline for a while, then back. Nothing is lost and nothing is duplicated.

The thing to watch for is a `name 2` folder, which is the sync engine's own conflict suffix and identical to ours.

## 4. Evals, for the two prompt changes

The prompt now says finished work goes in the conversation's own folder, and that a sent file is read where the person keeps it. Both are instructions a model can ignore.

- A handful of chat cases that produce a file: does it land in the chat's folder.
- A case that attaches a file and asks for a change: is the original changed, or is a copy made somewhere.
- The existing `work-folder` eval cases still grade against `$INSTRUMENT_ATTACHMENTS` and need updating with the prompt.

Needs Jeremy's go, as every eval run does.

## 5. What cannot be tested yet, and should be said rather than assumed

- **The phone.** The format is shaped for a second client that does not exist. Until it does, "another client can author a draft" is a claim held up by a schema, not by a client.
- **`$INSTRUMENT_CHATS`.** Decided, not built.
- **A folder the person has open.** Windows refuses a rename while Explorer has the folder selected, which the test in section 2 does not cover and a person will hit.
