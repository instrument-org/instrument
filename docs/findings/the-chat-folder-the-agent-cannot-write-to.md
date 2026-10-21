# The chat folder the agent cannot write to

**Status:** settled. Found 2026-10-16 by driving a real chat on the Windows test host, and fixed the same day by sending finished work to the chat's own folder only where that folder is one the person opens.

The agent's shell knows where a chat's own folder is and cannot write a byte into it, on any platform, as long as the workspace sits in the app's own data. Which is where every install's workspace sits today.

## What happens

In a chat on the Windows host, with the branch's layout in place:

```
$ echo "OUT=$INSTRUMENT_OUTPUT"
OUT=/c/Users/windows-user/AppData/Roaming/Instrument (Dev)/workspace/Chats/Snow poem on Windows

$ echo hi >> "$INSTRUMENT_OUTPUT/ticks.txt"
bash: .../workspace/Chats/Snow poem on Windows/ticks.txt: Permission denied
```

The variable is right, the folder is there, the mount is there and writable, and the write is refused.

## Why

Two folders stand in every chat (`chat/folder-reach.ts`): the person's home folder, and `outputFolderPath()`, which is the folder they picked for their work or else `~/Documents/Instrument`. Nothing else is standing, so a chat's own folder is reached only as something inside the home folder.

Inside the home folder, the rules then go by place (`permissions/places.ts`). The app's own data is a place of its own, `appFiles`, which starts at Ask: `~/Library` on macOS, `~/AppData` on Windows, the home folder's dot-entries on Linux. A workspace in app data puts `Chats/<name>/` inside that place, so writing there is a question rather than a yes, and a shell with nobody to ask it (a command the person did not start, a task's shell between turns) reads the answer as no.

Meanwhile `output`, the one place that starts at Allowed, is `~/Documents/Instrument`: a different folder from the workspace on every install that has not picked one. So the prompt tells the agent to put finished work in the conversation's folder, the shell hands it a path it cannot write, and the only writable Instrument folder it can see is the old output folder, which is also the folder the prompt's own sentence about reachable folders points at ("the Instrument folder this conversation's own folder is in", which on these installs it is not).

A model follows the writable path. Both turns driven on Windows wrote their file into `Documents/Instrument/` and said so plainly: "Writing a three-line poem about snow to snow.md in the Instrument folder."

## It is a refusal, not a question

The place that gates the app's own data is not the one that asks. A workspace the app keeps in its own data is inside the folder every rule marks as the app's (`appData`), which is closed to every command whatever the person's rules say, with no card to allow it. Driving a real chat is what showed it: the pasted CSV went into the chat's own folder, `read_file` came back "is Instrument's own data, which no command reads or changes", and the agent told the person it could not read the file they had just sent it.

So this is not only about where finished work goes. Everything under such a workspace is closed to the agent: what the person pastes, the handoff notes, anything the agent is told to write for them. All three keep to the record folder there, which the rules open, and move into the chat's own folder on a workspace the person picked.

## What was done

`$INSTRUMENT_OUTPUT` is the chat's own folder when that folder is inside the person's Instrument folder, and the Instrument folder itself otherwise (`finishedWorkFolder`). A workspace the person picked makes the first true for every chat in it, so the chat's own folder wins there with no further change; any other workspace keeps the folder they will actually open.

The other way round was to make the workspace's own top level the allowed place, so the chat's folder works wherever the workspace is. That was rejected: on an app-data workspace, the folder the agent would then write to is one the person never opens, so the work would be as good as gone, and allowing the workspace root before `.instrument/` is closed to the agent would hand it the records.

Nothing caught this earlier because the end state has no app-data workspace in it. Once the workspace is always a folder the person picked, the condition is always true and could be dropped.

## What is not the problem

- Not Windows. The place that gates it exists on all three systems, and the workspace is in app data on all three.
- Not the mount. `buildWorkspaceFsLayout` carries the chat's folder as a writable mount, and `$INSTRUMENT_OUTPUT` is spelled correctly for the shell, drive letter and all.
- Not the prompt alone. Pointing the prompt harder at `$INSTRUMENT_OUTPUT` would make the agent try a folder it cannot write to.
