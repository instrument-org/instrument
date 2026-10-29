# Testing the Instrument folder

Status: under way. Section 1 (the migration rehearsal) is built and passes. Section 2 passes all eight steps on Windows; Linux has the migration and renames checked and waits on credentials for live turns; the Mac pass is not recorded. Section 3 (two computers) is not started. Section 4's eval cases were updated for the chat's own folder (`1d61e95f7`, `10cf632fa`); no run is recorded here. Written 2026-10-16, after F1 landed and F3 and F4 began.

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

Built, as `apps/studio/src/electron-main/lib/migration-rehearsal.test.ts`: skipped unless `REHEARSE_WORKSPACE` names a workspace, which it clones and runs the launch steps over.

```
REHEARSE_WORKSPACE="$HOME/Library/Application Support/Instrument/workspace" \
  pnpm --filter @instrument-org/studio exec vitest run \
  src/electron-main/lib/migration-rehearsal.test.ts
```

It passes whole on the 1.x install here: 393 chats, 157,437 files, two and a half minutes. Nothing lost, one folder per chat and one chat per folder, a `CHAT.md` in each naming its chat, what was sent in the chat's own folder and not in the records too, the hidden folders out, each topic down to one `TOPIC.md` and each app to one `APP.md`, every store set aside with none left where a chat is read, and a second run that changes nothing at all.

Two things it found on the way, both fixed:

- 77 transcripts gained a `topics:` line on the second run, because the chat folders were written before the topics came out of `.instrument/`, so the first pass had no topic names. The order at the call site was the fix.
- The three folders stopped at an empty folder of their own name, which is what a real workspace has: ten skills stayed hidden under an empty `Skills/`. Fixed in the shared move.

Three of the assertions had to be written against what the migration is actually for, which is worth knowing before writing the next one: a work folder deliberately leaves `node_modules`, `.venv` and `.tmp` behind, 1.x staged a copy of the app's own skills inside every task, and a 1.x task's store is folded into the chat's records rather than set aside on its own.

## 2. One chained session per operating system

The same walkthrough on each of the three, in one sitting each, rather than a matrix of isolated cases. A case that needs its own setup does not get run.

The Mac, then the Windows test host, then the Linux test host. Each step leaves the state the next one needs:

1. New chat, paste a screenshot, send. The folder exists before the first command runs, with the screenshot in it.
2. Ask for something that produces a file. It lands in the chat's own folder, not in a job subfolder and not in the Instrument folder.
3. Let the title settle. The folder is renamed, and the screenshot and the finished file are both still in it.
4. Rename the chat in the app. The folder follows between turns.
5. Rename the folder in the file manager. The chat adopts it, and the next turn writes the transcript there.
6. Start a background job, then rename the chat while it runs. Nothing crashes. On Windows the rename is refused and retried later; on macOS and Linux it happens. Either way the job keeps running and the chat keeps working.
7. Attach a file from Documents and have the agent change it. The original changes. No copy appears anywhere.
8. Delete a chat, leaving the folder. Then delete another, taking the folder. The first one's files are still there.

Windows earns the most attention: it is the platform where the rename genuinely fails, where paths are spelled differently for the shell, and where the 260-character limit bites.

What the Windows pass has shown so far, against the branch in the host's own checkout:

- The launch migrations ran over its 13 chats: converted in 234ms, the stores set aside, the workspace at format version 2, 13 folders written in 91ms, numbered where four chats shared a name. `.instrument` is not hidden, as decided.
- Renaming the chat in the app renames the folder, between turns, with the transcript still in it.
- `$INSTRUMENT_OUTPUT` is spelled for the shell with its drive letter and points at the chat's own folder. Writing into it is refused: [the chat folder the agent cannot write to](../../findings/the-chat-folder-the-agent-cannot-write-to.md).
All eight steps pass there, on Auto. What the live turns showed that nothing else could:

- What the person pasted landed in the chat's own folder and the agent was **refused** it: "is Instrument's own data, which no command reads or changes", and it told the person it could not read the file they had just sent. A workspace the app keeps in its own data is inside the folder the rules close to every command, so the refusal is flat, with no card. What they send now stays in the record folder on such a workspace, as finished work and the handoff notes already did, and the agent reads it.
- Before that fix, a turn asked for a file in the conversation's folder wrote a relative path instead, which landed in the work folder, and the reply named that path. No error anywhere: the folder it was told to use is one it cannot write.
- A title that sanitizes to a Windows device name is handled (`NUL` becomes `NUL_`), and one full of characters Windows forbids (`Q: what now? <draft> | "quoted" * and CON`) becomes `Q what now draft quoted and CON`.
- A background job ticking into the work folder ran straight through a rename of its chat: the folder followed, the job kept writing, nothing crashed.
- Deleting a chat left its folder and `CHAT.md` where they were; deleting another with its folder took only that one.
- A folder renamed in Explorer is adopted at the next launch, with no second folder made.

Getting a live turn there needed two things that had nothing to do with the branch. The dev build's API was `http://localhost:49100`, where nothing listens on a test host, so there was no account to sign in to and no Auto in its model list; the installed beta beside it was signed in, which is per user-data folder and says nothing about the dev build's. With the API pointed at the real one, `auth.signInSocial` completed with no clicks at all, since the host's browser already had a Google session.

Linux, against a packaged preview of the branch with a copy of that machine's own pre-2.0 workspace in its data folder:

- The 45 chats, 2 topics and 11 skills migrated at the first launch: `Chats/`, `Drafts/`, `Skills/` and `Topics/` at the top level, a folder per chat with its title and numbered where two shared a name, each topic one `TOPIC.md` with its instructions as the body, and `.instrument/` down to the records and the app's own files.
- Renaming the chat in the app renamed the folder, with the transcript still in it.
- Renaming that folder in the file manager and launching again: the chat adopted the new name, and no second folder was made.
- A live turn needs credentials the copied workspace does not carry, so the same two steps as Windows are waiting.

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
- **A folder the person has open.** Windows refuses a rename while Explorer has the folder selected, which the test in section 2 does not cover and a person will hit.
