# Plan: chat surface

Status: slices 1 through 8 built, except suggesting the output, which waits on open question 7; 9 landed under its own plan, [app-level tabs](../completed/app-level-tabs.md).

---

## Why

The 2.0 draft window grew into a corner. Its head carries the name, the topic, the output picker, the model and send; the band under the words is both the doors for bringing things in and the things already brought in; and anything placed near that band reads as one more attachment. A chat viewed in Chats has a right pane that competes with the conversation, and a popped-out chat leaves a placeholder in the column. App-level tabs are coming, which changes where opened files live. This plan sets one structure for drafting, bringing things in, and seeing what a chat holds, the same in the Chats column and in a popped-out window.

## Decisions

- **Chat, not thread.** Everything a person reads says "chat": "New chat", never "New thread". Code names can follow separately.
- **The draft's head stays a chat.** The person is starting a chat, so the head says "New chat", followed by the topic. Its dropdown is where an output is picked by hand, which is rare; once one is picked or suggested the head reads "Make a [page type] in [topic]". Suggesting the output from the draft's words does most of the work. Both pills are filled by Instrument when it is confident (the topic already is, from the draft's words), tinted while they are its pick, removable with × (and then left alone for that draft), and pickable by hand. "in" is the only joiner.
- **One topic picker.** A search field that also makes a topic, best fit first, New topic at the foot; the same component in the draft head, on rows, and in a chat's head.
- **Bringing things in is two steps.** A fresh draft's band shows tiles to open (Web, This Mac, Apps) and, under them and smaller, a place to attach a file or a folder that is also the drop zone, leaving room above for typing; the whole window takes a drop. Pressing Apps opens the Apps landing page (the same page the rail's Apps place shows, without its prompts to connect more) in the band, and pressing an app goes into that app's own page there, so a connected Gmail can be opened and browsed in the draft; naming an app in the words is the @ mention, not the tile. Pressing Web opens the browser right there in its own zero state (bookmarks, recents, an address bar), with no popover in between; This Mac opens the Finder the same way. A dropped or pasted file opens as a tab, never a chip. The first zero state never shows tabs; once something is open, bringing in more goes through +, which opens a new tab showing the same zero state.
- **Apps are named in the words.** Typing @ (or an app's name) offers connected apps by their marks; the pick becomes a token in the line, deleted like a word. The Apps choice opens the same list.
- **The + mirrors the draft's zero state.** In any chat's reply box, in Chats and in a popped-out chat, the + opens mouse-first tiles and Attach files / Add a folder buttons (no drop target), no group headings, plus the skill and model pickers it already carries. Its Apps lists connected apps to insert as mentions, with a way to the Apps landing page to connect another. The + is the mouse path; the / menu in the prompt stays the keyboard path. "Work in a local folder" goes, since it is only adding a folder. Web and This Mac open immediately as a new view at the chat's side; the + is where the person chooses what kind of thing opens there.
- **No new-tab page, no tasks pane.** Nothing opens a blank tab: every opening names what it opens. The pane's New tab experience and the tasks pane as a concept go.
- **No pane inside a chat.** What a chat holds (the agent's browsers, pages it made, files brought in) is a rail of thumbnails along its right edge, newest first, scrolling when long. Only the agent's current page and the visible thumbnails are live; the rest are pictures retaken now and then.
- **A + on the rail.** The rail keeps room for a small + of its own for opening another thing beside the chat. It offers only Web and This Mac, drawn as icons of the kind rather than live content, and opens that thing's zero state, as the draft does. Apps never sit in the rail.
- **Things open edge to edge.** An opened browser takes the space with no header bar or inset; the Finder shows its own omnibar and no title bar. In the full view an item carries a close button of its own as well as the one on its rail thumbnail, even though the viewer shows none elsewhere.
- **A file replaces the Finder's view in place.** Double-clicking a file in any Finder opens it in that view, with the omnibar's back and forward to return, never a new tab. This is the rule product-wide.
- **A file named in the chat opens beside it.** Clicking it opens the full view with the file; there is no choice of where to open it.
- **The full view.** Pressing a thumbnail shows the item large in the middle and the rail stays a strip on the right. The list of chats simply gets narrower for now; a layout engine that decides what to close down for the space is later work. Choosing Web or This Mac from + opens straight into it. Popping a chat out keeps today's pop-out control.
- **Maximize is a modal.** A popped-out chat's maximize opens it as a modal over whatever the person is viewing (the chat, the item large, the rail), the way a draft's maximize does, with a top bar carrying the chat's title, close, and return to the small window. It never navigates to Chats.
- **App-level tabs belong to the person.** A file can be opened from its thumbnail as the person's own tab in the window bar; the chat keeps its thumbnail. The agent never opens or closes app-level tabs.
- **Popping out deselects.** A popped-out chat stays listed in Chats and is simply no longer the selected row; seeing it in both places is fine. No placeholder, no badge.
- **Thumbnails carry no status badges.** Which are live is an implementation detail, never drawn.

## Suggesting the output

Filling the head's output from the draft's words uses the same decision model that files a draft under a topic. A blind test across 120 page kinds picked the right kind about 95% of the time when it was confident (0.7 and up), and suggested a page for fewer than 3% of ordinary chat messages. What made that work, and has to carry into the build:

- Options that are not pages (an answer, an action, an image, a file) beside the page kinds, so a request for an image or a Markdown file does not land on the nearest page kind.
- Generic kinds (an email draft, a how-to, a should-I, a pros and cons) never auto-suggested; they draw almost every false alarm. They stay pickable by hand.
- Only confident picks shown; nothing is shown in between.

Page types will come from onboarding rather than a fixed catalog, so the classifier reads each type's description when it asks, and a new type should pass a check before it is offered: a few natural requests for it are recognized, and a few nearby chat messages are not.

## Out of scope

- New page templates.

## Rail thumbnails, measured

Measured on an M1 Max with eight real sites open as parked guests (Wikipedia, GitHub, BBC, a YouTube video page, Google Maps, Apple, Hacker News, the New York Times):

- A capture with `webContents.capturePage()` takes about 14ms (17ms at the 95th percentile) at 2560×1600, and scaling it to a 240px-wide JPEG takes about 3ms more; a thumbnail is 5 to 10KB. All captures of parked guests came back with the right page, none failed.
- The main process pays roughly half a percent of one core per capture per second: eight thumbnails every two seconds costs about 2%, every second about 5%, every 250ms about 17%, against an idle 0.4 to 1.8%. The GPU process barely moves.
- The pages themselves are the cost: eight open pages added about 2.9GB to the app (about 360MB each, 400 to 550MB for the heaviest), whether or not anything captures them.

So thumbnails are pictures, never scaled live pages: a guest can be shown in only one place, the item in the full view needs a picture anyway, and a picture is cheap. A chat usually holds one or two pages, so the first version aims only to cost nothing noticeable:

- A page is captured only while it is on screen: when it finishes loading, when it navigates, and once more as it leaves the view. Nothing is captured on a timer for pages nobody is looking at.
- Each thumbnail is saved with its chat, so opening a chat, including after the app was quit, shows the rail at once from the saved pictures. A page that was not restored (the usual case after a relaunch) keeps its last thumbnail and loads only when opened.
- Documents and pages the chat made use the file thumbnails the app already draws; a folder shows its icon and name. The app's own views are not screenshotted.
- Because a thumbnail no longer needs its page, a page left unopened for a while can later be discarded and rebuilt from its address, which is where the memory saving is.

## Open questions

1. Is Files the system file dialog, or a Finder tab like This Mac?
2. On a narrow window, does the rail fold to marks or hide?
3. Should an app be connectable from inside the + menu instead of sending the person to the Apps landing page?
4. Can two chats be maximized as modals at once, or does a second replace the first?
5. Does a pasted image leave a mark in the words as well as a tab?
6. Where does the model picker live once the + is not the best home for it?
7. Where do the page types the output dropdown offers come from: the shipped templates, a catalog generated at onboarding, or both? Suggesting the output from the draft's words waits on this, since each type needs a description the classifier reads and a check that it is recognized before it is offered.

## What changes in code

- `compose-window.tsx`: the head becomes a sentence component shared by the topic and output pickers; the band's zero state becomes the chooser; drops and pastes route to the draft's tab group instead of the attachment list; app chips become editor tokens with an @ trigger.
- Topic picker: one search-or-create component, reused wherever a topic is chosen.
- `RightPane` and the pane toggle go. A rail component reads the chat's tab group (the data the pane read) and draws thumbnails; browser guests stay mounted but draw as snapshots except the focused one and the agent's.
- The full view reuses the pane's tab contents at a new layout, for Chats and the popped-out window alike.
- A file in the full view is `FileViewer`, which renders standalone in whatever area it is given. It draws its own header unless handed `actionsInto` (the 2.0 file tab portals Edit/Done, Ask and ⋯ into its tab row that way), and its editors, Edit source and comments tray need nothing from a pane. The Open-in app button lives in the location pill (`tab-location-row.tsx`, `open-in-app.tsx`), so the full view's chrome or the viewer header has to host it.
- An HTML file shown as a page is a webview guest in a slot: the host registers a `<div>` in `pageSlotsAtom` under `page:<tabId>` and opens the page tab in that group, and page editing keys off that tab's id (`pageEditTabsAtom`, `PageEditSession`). The full view needs the same slot and hosted page tab, the way the Files screen and quick look do.
- The comments tray's "Add to chat" targets the chat on screen beside the file, else a new draft; in the rail's world it targets the chat whose rail the file was opened from.
- `ChatWindow` gains the rail and a maximize-as-modal state; its tab row goes. `PoppedOut` goes; the chat column stops skipping floating sessions and draws them too, and popping out only clears the selection.
- The reply box's + menu becomes the tile chooser: Web, This Mac, Apps (connected apps to mention, and a way to the Apps landing page), Attach files and Add a folder, and the skill and model pickers. The local-folder item goes.
- Every Finder opens a double-clicked file in place with back and forward; opening a file as a new tab goes, and so does any "where to open" choice for a file named in a chat.
- The pane's New tab page and the tasks pane go.
- App-level tabs: a window-bar model owned by the person; a chat only offers into it.

## Order

Each step lands and is checked in the app on its own.

1. Copy: "thread" becomes "chat" in everything a person reads.
2. The Finder opens a double-clicked file in place, with back and forward; the "where to open" choice goes.
3. Rail thumbnails as captured pictures (measured; see above).
4. The reply box's +: tiles, Attach files and Add a folder, skills, model, apps to mention; / stays the keyboard path.
5. The draft's zero state: tiles over a slim attach row, Web opening the browser inline, Apps opening the Apps landing page.
6. The rail and the full view in Chats; the pane, its New tab page, and the tasks pane go.
7. The popped-out chat's rail, maximize as a modal, and staying listed in Chats.
8. The head's output dropdown and suggesting the output, with the shared topic picker.
9. App-level tabs, with their own plan.
