---
name: instrument-guide
description: How Instrument itself works, what each part of the app is for, and how to link the user straight to a setting or screen. Read it when the user asks how to do something in Instrument, how to bring in what they had in another AI or app, where a setting is, or what a part of the app does.
---

# Instrument guide

What a person can do in Instrument and where each thing is, so a question about the app gets a short answer with a link that takes them there. `reference.md` beside this file lists every page and row of Settings, every screen a link opens, and every keyboard shortcut, read off the app itself. Read it for any question about a setting or a shortcut, and take names and keys from it rather than from memory.

## Linking

A setting, a page of Settings, or a screen is linked the way anything else in the app is, a Markdown link to its own address, and it draws as a chip the user clicks to go there:

- A row of Settings: [Zoom](instrument://settings/zoom). Settings opens on its page with the row lit.
- A page of Settings: [Memory](instrument://settings/memory).
- A screen: [Keyboard shortcuts](instrument://screen/shortcuts).
- A project: `instrument://project/<id>`, with the id `instrument projects list` prints. Its details open over the window.

The label is the thing in the user's words, and the name in the address comes from `reference.md`. Give the keyboard shortcut beside the link when there is one. Answer the question first, then link where they would click through; a reply that is only a link makes them do the reading.

## The window

The rail down the left side holds New, which starts a chat, then Chat, Files, Browser and Apps, and at the bottom Feedback, then Settings (the user's picture once they are signed in). Each place opens in a tab across the top of the window, and a tab holds a chat, a folder, a page or a screen. Move Tab to New Window, in the Tab menu, gives a tab a window of its own, a chat's menu in the list has Open in New Window, and Merge All Windows, in the Window menu, puts them back together.

- **Chat** is the inbox beside the open chat. Inbox, Drafts and Archived are tabs under the search, and clicking into the search offers Unread and Starred to narrow the list. The button at the end of the search sets how many lines each chat shows and groups the list by day.
- **Files** shows the files on this computer. Results nobody put anywhere else land in the Instrument folder. With files picked, Ask opens a new chat about them, and Convert… opens one that begins "Convert this to", for the user to finish.
- **Browser** is a browser of the user's own: [Browser](instrument://screen/browser). Tasks open the pages they work on in tabs of the chat that started them. While Instrument works in a page, the page glows, and Take over stops it and hands the page to the user. Chrome extensions, 1Password among them, run in it, installed from the Chrome Web Store: [Extensions](instrument://screen/extensions). Clear browsing data…, in its menu and the History menu, clears its history, cache and what sites keep, sign-ins included.
- **Apps** is where services like Gmail, Notion or Linear are connected, so Instrument can work in them: [Apps](instrument://screen/apps). Its search takes any service, listed or not. An app's menu tests the connection, names the account, connects another account to the same service, disconnects it, or removes it.

## Chats and tasks

A chat is where the user talks to Instrument. Instrument answers small things itself and starts tasks for longer work, each running on its own and reporting back to the chat. What a chat made or opened, its files and pages, opens in tabs across a pane beside the chat; Show tabs brings the pane back once it is put away. A chat can be popped out into a small window floating over the inbox inside Instrument's window, and put down to a bar.

- **Reply box**: + adds files, or a folder to work in, and typing / offers the same, with the skills and apps to name. Dictate takes speech instead of typing, and needs the user signed in to Instrument.
- **Model**: the model a chat runs on is picked at the bottom right of its reply box. The one picked in a new chat becomes the default for new chats. More models come from the user's own plans and keys: [Providers](instrument://settings/providers).
- **Branch from here**, under any reply, starts a new chat with the conversation up to that reply.
- **Ask on a selection**: selecting text in an open file shows Ask, which notes what should change there. The notes gather at the foot of the file and go into a chat together.
- **The chat's menu**, the caret after its title or a right-click on it in the list, renames, stars, archives, files it under a project, sends feedback about it, and deletes it: Delete chat… asks first and can delete the chat's folder too. A chat can't delete another one. Its Copy › For an Agent copies what another coding agent like Claude Code needs to pick up the chat.

The user can ask a chat to tidy up the others: rename them, archive them or bring them back, star them, or file them under a project. The chat does it with `instrument chats` (`instrument projects` names the projects), and a line under its reply says what changed, with Undo.

## What Instrument keeps

Everything Instrument keeps for the user is plain files in their Instrument folder, which they can open in Files or any other app: [Instrument folder](instrument://settings/instrument-folder) says where it is and moves it. The folders at its top are Instrument's, so Files won't rename or delete them; what is inside them is the user's to read and change.

- **Projects**: a folder each in the Projects folder, for filing chats. The inbox lists them at its top, with + for a new one, and a chat's Project control files it under one. A project's `AGENTS.md` has the instructions every chat filed under it follows and what stays true about the project. The user changes it in View project details, on the project's menu, in the file itself, or by asking Instrument. Each project is marked with an icon from the app's set or an emoji, on one of sixteen colors; the chat makes one with `instrument projects create`, changes the mark, the color, the name or the about line with `instrument projects set`, finds icons with `instrument projects icons`, and deletes one with `instrument projects retire`, as the app's Delete project does: it leaves the menus, its folder stays, and a card under the reply offers Undo. Renaming the folder renames the project, and other coding agents opened in the folder read the same `AGENTS.md`.
- **Instructions for every chat**: `AGENTS.md` at the top of the Instrument folder, which every chat follows. It has no screen in the app: the user edits the file, or asks Instrument to add to it.
- **Chats**: a folder each in the Chats folder, named for the chat, with what the chat made and a `CHAT.md` copy of the conversation for reading and searching outside Instrument. Instrument rewrites `CHAT.md` after every reply, so changes to it don't stay. Deleting a chat's folder leaves the chat in the list, and it makes a new folder the next time it gets a message. The folder button at the top of a chat opens its folder once the chat has made files.
- **Drafts**: messages to Instrument the user started and hasn't sent yet, a `DRAFT.md` each in the Drafts folder, with anything pasted into it beside it. The inbox's Drafts tab shows them, and editing the file edits the draft. A draft the user asks Instrument to write (a post, a letter, a document) is their own work and never goes here.
- **Apps**: a folder each in the Apps folder, with an `APP.md` saying how the service is reached and what Instrument has learned about using it. Sign-ins and keys are kept apart, never in the file. Instrument changes it as it works with the app, and the user can fix it by hand.
- **Memory**: what Instrument remembers about the user, one Markdown file per memory in the Memory folder of their Instrument folder. Settings lists them to search, forget, or bring in from another AI: [Memory](instrument://settings/memory). Pressing one there, or a link to one, opens its file to read or edit; [Memory folder](instrument://settings/memory-folder) opens the folder in Files.
- **Skills**: recipes tasks use for a kind of work, and new ones the user asks for: [Skills](instrument://settings/skills). Each skill is a folder: clicking one in Settings opens its folder in Files, where the user reads or edits it, or asks Instrument to change it. Only skills in the workspace's own `Skills` folder can be deleted, from the "⋯" on their row.
- **Models**: Instrument works with its own plan, or the user's ChatGPT, Claude or Grok plan (SuperGrok or X Premium+), or a provider with their own key: [Providers](instrument://settings/providers).

## Coming from another AI

Someone moving to Instrument from ChatGPT, Claude, Gemini or another AI brings what it knows about them, can keep the plan they pay for, and starts new chats here:

- **Memories**: [Import from another AI](instrument://settings/memory-import). The user copies a question into the other AI and pastes its answer back, or picks ChatGPT, Claude, Gemini or Grok and Instrument opens it in its browser and asks there once they are signed in. Claude Code, Codex, Gemini CLI and opencode on this computer show there too, and are read from their own folders. Each one opens a new chat with the request in its reply box; once the user sends it, the chat saves the facts as memories and says what it kept and left out. The Memory list groups them under that chat, to be forgotten together if the user wants.
- **Their plan**: a ChatGPT, Claude or Grok plan they already pay for runs Instrument's chats once they sign in to it: [Providers](instrument://settings/providers).
- **Projects**: a project they kept there becomes a project here, its instructions in the project's `AGENTS.md` and its files in its folder.
- **Skills**: skills that Claude Code, Codex and other coding agents keep in their own folders on this computer are in [Skills](instrument://settings/skills) already.
- **Chats**: chats from another AI don't come over as chats here. An export of them is files like any other, which a chat can read to pick up where they left off.

## Something wrong

Feedback, on the rail above Settings, sends the team a problem or an idea, about the chat on screen when there is one. Typing /feedback in the reply box, Send feedback… in a chat's menu, and Send Feedback… in the Help menu open the same thing. The diagnostic log goes with it if the user wants: [Diagnostic log](instrument://settings/diagnostic-log).
