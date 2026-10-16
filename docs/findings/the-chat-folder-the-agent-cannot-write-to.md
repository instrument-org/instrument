# The chat folder the agent cannot write to

**Status:** open, and the one thing between the visible-folder work and a person seeing it work. Found 2026-10-16 by driving a real chat on the Windows test host.

The agent's shell knows where a chat's own folder is and cannot write a byte into it, on any platform, as long as the workspace sits in the app's own data. Which is where every install's workspace sits today.

## What happens

In a chat on the Windows host, with the branch's layout in place:

```
$ echo "OUT=$INSTRUMENT_OUTPUT"
OUT=/c/Users/cubetop/AppData/Roaming/Instrument (Dev)/workspace/Chats/Snow poem on Windows

$ echo hi >> "$INSTRUMENT_OUTPUT/ticks.txt"
bash: .../workspace/Chats/Snow poem on Windows/ticks.txt: Permission denied
```

The variable is right, the folder is there, the mount is there and writable, and the write is refused.

## Why

Two folders stand in every chat (`chat/folder-reach.ts`): the person's home folder, and `outputFolderPath()`, which is the folder they picked for their work or else `~/Documents/Instrument`. Nothing else is standing, so a chat's own folder is reached only as something inside the home folder.

Inside the home folder, the rules then go by place (`permissions/places.ts`). The app's own data is a place of its own, `appFiles`, which starts at Ask: `~/Library` on macOS, `~/AppData` on Windows, the home folder's dot-entries on Linux. A workspace in app data puts `Chats/<name>/` inside that place, so writing there is a question rather than a yes, and a shell with nobody to ask it (a command the person did not start, a task's shell between turns) reads the answer as no.

Meanwhile `output`, the one place that starts at Allowed, is `~/Documents/Instrument`: a different folder from the workspace on every install that has not picked one. So the prompt tells the agent to put finished work in the conversation's folder, the shell hands it a path it cannot write, and the only writable Instrument folder it can see is the old output folder, which is also the folder the prompt's own sentence about reachable folders points at ("the Instrument folder this conversation's own folder is in", which on these installs it is not).

A model follows the writable path. Both turns driven on Windows wrote their file into `Documents/Instrument/` and said so plainly: "Writing a three-line poem about snow to snow.md in the Instrument folder."

## What fixes it

The workspace's visible folders have to be the output place: `Chats/`, `Drafts/`, `Topics/`, `Memory/`, `Skills/`, `Apps/` at the workspace's top level, allowed by default the way `~/Documents/Instrument` is today, with `.instrument/` closed to the agent with no exceptions. Those are two halves of one change, and the second one is F4 in the Instrument-folder plan: without it, allowing the workspace root would hand the agent the records.

Once the workspace is the folder the person picked, the two folders are one and the question disappears on its own, which is why nothing caught this earlier: the end state has no app-data workspace in it.

## What is not the problem

- Not Windows. The place that gates it exists on all three systems, and the workspace is in app data on all three.
- Not the mount. `buildWorkspaceFsLayout` carries the chat's folder as a writable mount, and `$INSTRUMENT_OUTPUT` is spelled correctly for the shell, drive letter and all.
- Not the prompt alone. Pointing the prompt harder at `$INSTRUMENT_OUTPUT` would make the agent try a folder it cannot write to.
