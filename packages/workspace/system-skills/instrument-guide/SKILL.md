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

## What Instrument keeps

- **Memory**: what Instrument remembers about the user, which they can search, forget, or bring in from another AI: [Memory](instrument://settings/memory).
- **Skills**: recipes tasks use for a kind of work, and new ones the user asks for: [Skills](instrument://settings/skills).
- **Models**: Instrument works with its own plan, or the user's ChatGPT or Claude plan, or a provider with their own key: [Providers](instrument://settings/providers).

## Something wrong

A problem can be reported from the Help menu, and the diagnostic log goes with it if the user wants: [Diagnostic log](instrument://settings/diagnostic-log).
