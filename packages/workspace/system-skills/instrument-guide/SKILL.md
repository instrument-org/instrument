---
name: instrument-guide
description: How Instrument itself works, what each part of the app is for, and how to link the user straight to a setting or screen. Read it when the user asks how to do something in Instrument, where a setting is, or what a part of the app does.
---

# Instrument guide

What a person can do in Instrument and where each thing is, so a question about the app gets a short answer with a link that takes them there. `reference.md` beside this file lists every page and row of Settings, every screen a link opens, and every keyboard shortcut, read off the app itself. Read it for any question about a setting or a shortcut, and take names and keys from it rather than from memory.

## Linking

A setting, a page of Settings, or a screen is linked the way anything else in the app is, a Markdown link to its own address, and it draws as a chip the user clicks to go there:

- A row of Settings: [Zoom](instrument://settings/zoom). Settings opens on its page with the row lit.
- A page of Settings: [Memory](instrument://settings/memory).
- A screen: [Keyboard shortcuts](instrument://screen/shortcuts).

The label is the thing in the user's words, and the name in the address comes from `reference.md`. Give the keyboard shortcut beside the link when there is one. Answer the question first, then link where they would click through; a reply that is only a link makes them do the reading.

## The window

The rail down the left side holds New, which starts a chat, then Chat, Files, Browser and Apps, and Settings at the bottom (the user's picture once they are signed in). Each place opens in a tab across the top of the window, and a tab holds a chat, a folder, a page or a screen.

- **Chat** is the inbox beside the open chat. The picker beside the search switches the inbox to starred chats, drafts, or archived chats.
- **Files** shows the files on this computer. Results nobody put anywhere else land in the Instrument folder.
- **Browser** is a browser of the user's own: [Browser](instrument://screen/browser). Tasks open the pages they work on in tabs of the chat that started them.
- **Apps** is where services like Gmail, Notion or Linear are connected, so Instrument can work in them: [Apps](instrument://screen/apps).

## Chats and tasks

A chat is where the user talks to Instrument. Instrument answers small things itself and starts tasks for longer work, each running on its own and reporting back to the chat. What a chat made or opened, its files and pages, sits in a row of tiles over the reply box, and opening one shows it in a pane beside the chat. A chat can be popped out into a small floating window that stays over the others.

The user can ask a chat to tidy up the others: rename them, archive them or bring them back, star them, or file them under a project. The chat does it with `instrument chats` (`instrument projects` names the projects), and a line under its reply says what changed, with Undo.

## What Instrument keeps

Everything Instrument keeps for the user is plain files in their Instrument folder, which they can open in Files or any other app: [Instrument folder](instrument://settings/instrument-folder) says where it is and moves it. The folders at its top are Instrument's, so Files won't rename or delete them; what is inside them is the user's to read and change.

- **Projects**: a folder each in the Projects folder, for filing chats. The inbox lists them at its top, with + for a new one, and a chat's Project control files it under one. A project's `AGENTS.md` has the instructions every chat filed under it follows and what stays true about the project. The user changes it in View project details, on the project's menu, in the file itself, or by asking Instrument. Renaming the folder renames the project, and other coding agents opened in the folder read the same `AGENTS.md`.
- **Instructions for every chat**: `AGENTS.md` at the top of the Instrument folder, which every chat follows. It has no screen in the app: the user edits the file, or asks Instrument to add to it.
- **Chats**: a folder each in the Chats folder, named for the chat, with what the chat made and a `CHAT.md` copy of the conversation for reading and searching outside Instrument. Instrument rewrites `CHAT.md` after every reply, so changes to it don't stay. Deleting a chat's folder leaves the chat in the list, and it makes a new folder the next time it gets a message. The folder button at the top of a chat opens its folder once the chat has made files.
- **Drafts**: messages not sent yet, a `DRAFT.md` each in the Drafts folder, with anything pasted into it beside it. The inbox's picker shows them, and editing the file edits the draft.
- **Apps**: a folder each in the Apps folder, with an `APP.md` saying how the service is reached and what Instrument has learned about using it. Sign-ins and keys are kept apart, never in the file. Instrument changes it as it works with the app, and the user can fix it by hand.
- **Memory**: what Instrument remembers about the user, one Markdown file per memory in the Memory folder of their Instrument folder. Settings lists them to search, forget, or bring in from another AI: [Memory](instrument://settings/memory). Pressing one there, or a link to one, opens its file to read or edit; [Memory folder](instrument://settings/memory-folder) opens the folder in Files.
- **Skills**: recipes tasks use for a kind of work, and new ones the user asks for: [Skills](instrument://settings/skills). Each skill is a folder: clicking one in Settings opens its folder in Files, where the user reads or edits it, or asks Instrument to change it. Only skills in the workspace's own `Skills` folder can be deleted, from the "⋯" on their row.
- **Models**: Instrument works with its own plan, or the user's ChatGPT, Claude or Grok plan (SuperGrok or X Premium+), or a provider with their own key: [Providers](instrument://settings/providers).

## Something wrong

A problem can be reported from the Help menu, and the diagnostic log goes with it if the user wants: [Diagnostic log](instrument://settings/diagnostic-log).
