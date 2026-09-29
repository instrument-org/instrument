# The macOS folder ask holds a listing, not a write

**Status:** observed on macOS 27 with an installed beta build, and worked around in `task new`. The mechanism inside macOS is not established; the behavior is.

## What happened

A chat handed a task `--folder <home>/Desktop:rw` on a Mac where Instrument had never been asked about the Desktop. `task new` looks inside each folder it hands over (`requireReadable` in `lib/shell-commands/task-args.ts`), which is what raises the system's "Instrument would like to access files in your Desktop folder" dialog. The TCC log (`/usr/bin/log show --predicate 'process == "tccd"'`) placed the request, attributed to Instrument's main process, at 10:51:51.09, and the user's Allow at 10:52:02.78. The task's `cp attachments/cat.md <Desktop>/cat.md` ran at 10:51:54, exited 0 in 7 ms, and the file appeared on the Desktop while the dialog was still up. No second TCC request was logged for the write.

A probe run afterwards as the same app identity, with the Desktop grant reset (`tccutil reset SystemPolicyDesktopFolder <bundle id>`), agreed: the directory listing never returned (it kept the process from exiting), while creating a file, `stat`ing it, and reading an existing file by path all answered at once. That probe was launched over ssh and left no TCC request in the log, but the Desktop dialog was on the Mac's screen, and outlived the probe after it was killed.

## What it means

- A listing (`opendir`, `readdir`, `ls`) waits on the user's answer, and settles the moment they give it. That is the one deterministic signal of the answer an app gets.
- A file addressed by its path is not held. Work started before the answer writes into the folder whatever the user then says.
- A denial does not undo anything already written; it only refuses what comes after.

## What `task new` does about it

The look is given 750 ms. One that answers in time either lets the task start or refuses the command with the reason. One still waiting is the dialog: the task is created, but its first step is held on the look's answer, and the command tells the chat that macOS is asking so it can tell the user to answer. A refusal starts the task with the reason added to its brief, so the refusal reaches the chat the way any finish does, without the work being done.

`task folder --add` on a task already running does not hold anything: the folder is added when the command returns, whatever the answer.
