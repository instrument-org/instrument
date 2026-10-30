# Plan: honest browser context and an honest agent-browser proxy

Status: done. Landed, all three steps.

## Why

A run in the app turned up three ways the agent is told about, or given, a tab it should never see:

- A message carries context nothing on screen shows: a draft opened over another chat sent "the browser showed" that chat's page with no chip for it, and a chat's own reply carries its tab and the window's screen behind it with no chip at all.
- The note named another chat's tab by its id, and the new chat handed that tab to its task: a tab moved between chats.
- A task that ran `agent-browser tab` to look left a blank tab in its chat, because the CDP endpoint turns every page `agent-browser` asks for into a window tab on the spot.

The cause underneath is that the window and the workspace each keep their own idea of a chat's tabs. The renderer decides which tab ids a note names; the workspace decides what an agent can drive, from the tabs a session holds; nothing makes them agree.

## Step 1: the chips are the context

Everything a message carries about what the user was looking at is a chip in the composer, removable with its x, and nothing else goes. One function lists a composer's context items (the draft's picked files, what it was opened over, what is behind it; the chat composer's own tab up, or what is behind it), and both the chips and the sent context are built from that list, so they cannot disagree.

- Another chat's tab, or a screen inside another chat, is a **chat** chip: it names the chat, and the context links the chat. No page words, no tab id.
- The chat composer gets the same chips, so a reply says what goes with it.
- The chat's own tab list (the ids `tab` and `--tab` take) is not a chip: it is the chat's, not something the user was looking at.

## Step 2: the window answers which tabs are a chat's

The window holds every tab and the group it is in, so the workspace asks it (`list`, an ask of the window like `open` and `read`) at the moment a tab is named, rather than keeping a copy that could drift:

- The note's tab ids are only the sending chat's own (step 1).
- `task new --tab` refuses an id the window does not list for the chat, so a tab outside it cannot be handed over whatever id a model copies. `tab` already looks ids up among the chat's tabs, and the CDP endpoint drives only the tabs a session holds, which come from those two.
- The window's own tabs are in no chat's list, so they stay the user's. Handing one to an agent later is a change to this list, not a second path.

## Step 3: an honest agent-browser proxy

Keep the CDP endpoint (the agent drives the app's guests through upstream `agent-browser`, with the guide true and every command working), and make what it does match what the agent asked:

- **Tabs appear when a page does.** `Target.createTarget` with no address makes a guest with no tab (`inWindow: false` on the held tab), which the window leaves alone; it joins the chat's tabs (`adopt`) on its first navigation to a real address. One the session never navigates is closed when its turn ends.
- Answering `tab` and `tab list` here was dropped: the tab ids they print (`t1`) are the daemon's, and a page asked for to list tabs no longer shows anywhere, which was the harm.
- **One invocation classifier.** The 370-line closure in `shell-commands/agent-browser.ts` becomes a pure `classifyInvocation(args, config)` with a plan per kind (info, external, read, headless, tabs), table-tested, and the cruft from when a task had one browser of its own goes.
- **One rule per tab**, from step 2's list: the file gate, the cap, and what `Target.*` answers.

## Checking it

Unit suites for the classifier, the context list, and the chat tab list. In the app, on a clean room with sign-ins: a draft over another chat (one chat chip, removable, and no tab id in the note), a task asked to look at tabs (no blank tab left), a handed tab and a tab the task opens (both driven, both in the chat).
