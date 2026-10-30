# Explicit permission asks

Status: done. Landed in full in `489ff735f`: `ask_permission` (`tools/ask-permission.ts`) is the only way a card goes up, refusals name what to ask for and raise nothing, `refusedPathIn` and `refusalNote` are gone, the macOS look after Allow keeps a refused folder open as `macos-refused`, and the permission evals look for the call. The macOS look was reworked after (`0e199fb8a`, `a3f8cc58c`). Open point 2 (a Linux eval) was not run; `connect_app` stays its own hand-off.

## Problem

A permission card (a folder or a Mac app the person has not answered for) is raised as a side effect of the agent running into it, and the agent is told in prose to end its turn. Two things follow.

- **Detection for real programs is guesswork.** Builtins (`cp`, `mv`, `ls`, `cat`, `write_file`, `edit_file`) go through `rules-fs.ts`, which knows the path and the op at the filesystem call and raises the card there. Real programs (`python`, `node`, `git`, `ffmpeg`, and the uutils commands in [native-and-builtin-commands.md](../architecture/native-and-builtin-commands.md)) are refused by the kernel sandbox, and the app learns of it only by matching their output afterward (`native-sandbox/refusals.ts`, called from `exec-shim.ts`), and only when the program exits nonzero. A script that catches its own `EPERM` and prints it exits 0, raises no card, and the agent reports the folder as closed for good. On Linux, bubblewrap shows a closed folder as missing or read-only, so the same refusal reads as "no such file". The uutils argument check (`native-text.ts`) is structural for paths named on the command line and blind to any path a program computes.
- **Stopping is a request.** The refusal note and `choose`'s description both say "end your turn here". The agent may keep working and raise more cards, and it writes a line after the card goes up, which can land after the person already answered.

Apps are not affected by the first problem: every route to a Mac app is one our code knows before it runs (`mac-helper.ts`, `app-scripts.ts`, `path-program.ts`'s `REACHABLE_APPS`), and `appRefusal` decides structurally. They share the second.

## Design

One agent tool, `ask_permission`, is the only way a permission card goes up. Running into something stops raising cards and tells the agent to ask.

### The tool

- Input: `kind` (`folder` or `app`), `target` (a path, or an app's name), `reason` (one sentence the card shows: what the folder or app is needed for).
- A tool rather than an `instrument` subcommand because it is a stopping point: the call ends the turn, which a bash command cannot do cleanly.
- The server decides the target, never the agent:
  - A folder goes through `folderToAskFor`: one level below a place that asks, sign-in folders whole, the nearest folder on disk. The home folder, a disk's root and a folder holding the app's own data are refused, with the notes `ruleRefusal` gives today. The stored target is an absolute host path.
  - A folder or app already allowed returns "already allowed, run it again" and raises nothing. One closed in Settings, or one the person said not now to in this chat, returns that note and raises nothing.
  - An app is matched by name or bundle id as `appReach` does.
- One ask per (kind, target), as `recordAsk` keeps today: a second session asking for the same thing joins it and is woken with the answer. The reason is per asker, and the card shows the first.
- Cards stack only when more than one thing asks before the person answers: one step calling it for two things at once (a folder and an app the job needs both of), or the chat and its tasks each asking. A single session cannot ask again after its turn ends until it is woken.
- Tasks may call it, unlike `choose`: the card is drawn above the reply box (see Open points), so a task's ask needs no call in the chat's transcript.

### Ending the turn

The call is a hand-off in `shouldContinueAfterHandingOff` (`agents/instrument.ts`), beside `connect_app` today: no further step runs after it. The line the person reads is the card's reason, so a step that called it without saying anything does not get one more step to say a line (unlike `connect_app`). That closes the race where "I need access" lands after the person answered.

### What refusals say

Every refusal that raises a card today returns a note with no side effect, naming the folder the agent should ask for:

- `rules-fs.ts` (`ruleRefusal`): `"<path>" needs the person's yes. Ask with ask_permission for "<folder>" if the work needs it.`
- `appRefusal`: the same for the app.
- `native-text.ts`'s argument check: the same, through `ruleRefusal`.
- Real programs: nothing appended. The agent reads the program's own `Operation not permitted` against the folders section of its context, which says which folders ask. `refusedPathIn`, `REFUSALS`, `refusalNote` and the refusal branch of `exec-shim.ts` are deleted, with their tests.

The system prompt's folders line ("Changing anything in it … shows them a card on its own") becomes: a folder that asks is opened with `ask_permission`, after which the turn ends and the answer wakes you.

### The answer

- `permissions.answer` loses `path` and the client loses "Choose a folder…": an answer is for the folder asked about.
- A batch decline for the card stack's "no to all".
- On macOS only, after Allow and before anyone is woken, the app lists the folder itself, from its own process. Windows and Linux have no OS-level folder grant: a refusal there is the account's own file permissions (`readRefusalOf` gives `account`), which no setting fixes, so they skip the check. That is when macOS shows its own Desktop or Documents prompt: a listing waits on that prompt and settles the moment the person answers, while a write by path is never held ([macos-folder-ask-holds-listings-not-writes.md](../findings/macos-folder-ask-holds-listings-not-writes.md)), so the check is a `readdir`, never a write. When macOS refuses (`readRefusalOf` gives `system`), the ask stays open with a status (`open` or `macos-refused`) and the card offers the Mac's folder picker at that folder, or System Settings › Files and Folders. The askers are woken once the check passes or the person declines. A picked folder other than the one asked about is a failed retry, leaving the card refused. Opening System Settings works the way a sign-in does: the card waits, with Cancel back to its two options, and the app reruns the listing when its window regains focus until it passes or the person cancels or declines. Whether a change in Files and Folders reaches the running app without a relaunch is to be checked first (`studio-drive boot --own-privacy`). `permissions.answer` resolves only when the check settles, and that pending call is the only waiting state: the pressed button spins and the other answers are disabled, with no copy, since the first macOS prompt is the only slow case and it explains itself. Another window showing the same card sees no spinner.
- The listing waits as long as the macOS prompt stays up, and the person can walk away from it; the button spins for as long as that, which is true. The grant is written when Allow is pressed, and the ask is closed (and its askers woken, or it is marked `macos-refused`) only when the listing settles. One check runs per ask: an Allow from another window while one is in flight joins it, so nothing closes twice. Apps: open with Jeremy whether they get a check.

### Deleted

`native-sandbox/refusals.ts` (output matching), the refusal branch in `exec-shim.ts`, `raiseAsk` calls in `rules-fs.ts` and `apps.ts`, `waitingNote`, the `path` override on `permissions.answer`, and the picker in the card.

## Open points

1. **Where the card draws.** The permission UI direction is one card above the reply box, stacking several asks; under the call it draws nothing, or the answer once given. Not final.
2. **Linux.** With no `EPERM`, the agent has to infer from "no such file" in a folder that asks. An eval on the Linux host would show whether it does.
3. **`connect_app`.** A sibling hand-off for services. It could fold into `ask_permission` later; out of scope here.

## Checks

- The macOS check, in a dev build answering with its own privacy grants rather than the terminal's: `studio-drive boot --own-privacy`, reset between runs with `tccutil reset All <the clone's bundle identifier>` (`devBundleId` in `apps/studio/scripts/dev-supervisor.ts`).
- Unit: the tool's target normalization (`it.each` over home, a disk root, app data, a sign-in folder, a file in Desktop, an already-allowed folder, a declined one), the hand-off in `shouldContinueAfterHandingOff`, and each refusal's note.
- Evals on Haiku 5.5, three repeats each, rewriting the `ASKED` checks in `evals/cases/permissions.ts` to look for the call:
  - `cp` into Desktop (a builtin refusal).
  - A Python script that writes into Music and catches the error (a native refusal exiting 0).
  - `shortcuts list` (an app).
  - A task that needs a folder.
  - "Organize my whole home folder" (it must not ask for `~`).
  - A job needing Desktop and Downloads: count the cards and the turns.
