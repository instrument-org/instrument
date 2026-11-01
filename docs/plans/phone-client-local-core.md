# The phone runs the window's renderer on a local records core, with a host when one answers

Status: open. The remote half is built as a development spike: `apps/studio/src/electron-main/phone-host/` serves the router to `apps/studio/src/phone.html` over one WebSocket, and the page runs the window's own renderer on an iPhone against a Mac on the same network, list to reply. The local half, steps 1 to 4 below, is not started.

## Goal

Away from home, open Instrument on the phone and see every chat as iCloud Drive has synced it. Open one, send a message, and the computer at home that runs the chat picks it up and completes it, with the result arriving on the phone as its records sync. A link in a reply opens on the phone. When a host is reachable, the phone also gets what only a host can do: a turn streamed as it runs, the computer's own files, the browser, apps.

The iOS prototype (`instrument-org/instrument-ios-demo`, SwiftUI) already gives that experience without a host: it reads and writes the records through iCloud, and a reply typed on the phone is a draft naming the computer that sends it. This plan gives the same experience to the desktop's own React renderer, so the phone and the desktop are one codebase, the way Obsidian's desktop and mobile are.

## The shape

Three pieces, two of which exist in some form:

1. **The renderer**, unchanged. `phone.tsx` stands in for the preload (`window.api`, `window.electron`) and loads `main.tsx`; the RPC client (`client/rpc/client.ts`) picks its transport as it loads.
2. **A local records core** running inside the page: the workspace package's fold, record reading and writing, drafts, topics and chat-list derivation, over a log interface the page implements with its own storage, the shell implements with the phone's iCloud folder, and the Mac keeps implementing with Node's file system. It answers the routes that are files: the chat list and its live feed, a chat's messages, drafts, the settings a device sets on a chat (title, star, archive, unread, topic), topics, memory, the Files tab over the workspace folder.
3. **A host**, optional: the computer running the chat, reached over the WebSocket the spike built, later a relay through the API, later still a cloud host. It answers the routes that need a machine: sending a message into a running chat, the turn's stream, the browser, the computer's files, apps, settings of the computer.

The router splits by route: a local router answers the records routes from the core, the socket answers the rest, and the client picks per route, so no component changes. With no host, a send is what the iOS prototype does: a draft file in `Drafts/` naming the chat and the computer to send it (`send:`), which that computer sends when it sees it (`electron-main/drafts/send-asked-drafts.ts`). With a host, the same send goes straight to it.

The cloud is the third implementation of the same log interface, not a second core. It will want positions and a push feed that a synced folder cannot give, so the interface is shaped as a log read from a position and a feed of changes, which files answer by polling and a sync service answers natively. Nothing of the cloud is built here; the interface is kept honest for it.

## The core, and the log interface

What moves into the core is what the Expo prototype loaded straight from the desktop's checkout with shims for two schema files: `lib/records/` (fold, `read-records`, `record-writer`, `file-names`, `device-id`, `device-file`, `record`, `views`, `session-of`, `own-log-cursors`), the draft file and folder (`lib/drafts/draft-file.ts`, `draft-folder.ts`, `context-line.ts`), the topic front matter, and the chat-list row (`ChatSchema`, `chat/chat-list-file.ts`'s derivation). A build guard fails the core on any Node import, as the workspace package already fails on an Electron one.

The log interface is written from what that code does today, not designed ahead of it:

- list the record files of a chat, and the chats of the workspace;
- read a file from a position, so a log being written costs only its new lines;
- append a line to this device's own file;
- read and write a whole small file (settings, state, `DRAFT.md`, `TOPIC.md`, `chat-list.json`);
- a feed of changes: which file grew or appeared.

Implementations, in the order they are written: Node files (the Mac, as now); page storage (OPFS or IndexedDB, seeded from the Mac over the host, for the test); the phone's iCloud folder through a native plugin (the iOS prototype's `CoordinatedFiles.swift` behind a JavaScript surface, which the Expo prototype's module already was); a sync service, later.

## Order

Each step is checkable on its own.

1. **Carve the core.** A browser-safe entry of the workspace package with the modules above and the guard. The Expo prototype's resolver (`records-resolve.js`) is the map of what shimmed and why.
2. **The log interface**, with the Node and page-storage implementations, and the core's tests run against both.
3. **The split router.** A local router inside the page for the records routes; the client dispatches by route. With the socket cut, the list and a transcript render from page storage; with it back, a send goes through.
4. **Measure on the phone** with a real workspace's records: time to list from a cold store, a long chat's fold, memory. The iOS prototype's trial put iCloud's listing, not CPU, as the cost of a first open (93 s for 400 chats from folder listings, under 5 s from `chat-list.json`); this says whether that holds in JavaScript.
5. **The shell.** A Capacitor app around the built renderer: the file plugin replaces page storage with the iCloud folder picked the way the prototype picks it, the web view is a secure context (so the microphone works), and the socket survives the app going to the background. This is the no-account experience; an account adds a host to attach to.
6. **A built bundle served by the host**, so a browser on the network loads the renderer without the development server, and the phone's load time is the bundle's rather than the module graph's.
7. **The phone's layout.** A phone-width shell for the window: list or chat, a way back, the rail and tab strip folded, and a decision per desktop surface on whether it exists on the phone. Left until 4 and 5 say whether the phone is a page in Safari or a shell with the page inside.

Out of scope here: the relay through the API, the cloud host, dictation over HTTPS, and the process extraction on the Mac ([workspace host and protocol](workspace-host-and-protocol.md), [agent turn off the main thread](agent-turn-off-the-main-thread.md)), which keeps the same seam: the core runs in the Mac's workspace process with the Node implementation.

## What the spike learned

- **The router over HTTP cannot carry the window.** A browser allows six connections to a host over plain HTTP, and the window holds dozens of live subscriptions, so every call queued forever. One WebSocket carries all of it (`@orpc/server/ws`, `@orpc/client/websocket`).
- **Over plain HTTP the page is no secure context.** `crypto.randomUUID` is absent and is built from `getRandomValues` in `phone.tsx`; the microphone and clipboard stay off until HTTPS or the shell.
- **Module order decides the transport.** The RPC client picks its link as it loads, so nothing that reaches it may load before `phone.tsx` sets the host; `computer-file-url` is imported late for that reason.
- **A phone's content blocker can hide the window** with a stylesheet the page cannot see or outrank; one hid the window's root by its test id. The shell's web view runs no blocker. [The follow-up](../follow-ups/phone-page-under-content-blockers.md) says what to check.
- **The phone's console is nowhere**, so the page posts failures and one status snapshot to the host's `/log`, which the dev log carries under the `phone-host` scope. Read it before guessing.
- **The whole window fits a phone's width without a line of layout work**: the inbox collapses, the rail, transcript and composer stay usable, the toolbar overflows.

## Related

- [Workspace host and protocol](workspace-host-and-protocol.md): the host every client attaches to, and the log-storage seam this core is.
- [Chat records](chat-records.md) and [the records architecture](../architecture/chat-records.md): the files the core folds.
- [Each device writes its chat list into the workspace](../decisions/2026-10-26-each-device-writes-its-chat-list-into-the-workspace.md): the first-open fix the phone reads.
- [Drafts](../architecture/drafts.md): a reply left for a computer to send.
