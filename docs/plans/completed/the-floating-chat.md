# Plan: the floating chat

Status: landed. The small view, the Included region, pop-out and the placeholder, the file tab's tree and links between files, Home as a landing page, the connect buttons, and the `float_every_draft` flag are built. The Apps scenario (a draft started over a connected app's page) and several small views standing at once were not tried in the app.

## What it is

A draft started from a place other than Chat (Files, Apps, Home) does not send the person to Chat when it starts. The draft's window, already docked to the window's bottom-right corner, becomes the conversation in the same corner: a **small view** of the thread, the thin chat we already have, with minimize, expand and close in its head. The place behind it keeps its tabs and its whole width. The small view is a new thing that lives alongside drafts: the same layer, the same corner, the same bars along the bottom edge when put down, small enough that another draft can stand beside it.

Four rules make it one feature rather than four:

1. **The draft names what the screen already gives it.** The band under the words keeps its own doors (Attach, Browse, This Mac, Apps). At the band's top a region on a brand tint, labeled **Included**, holds the thing the draft was opened over (the file in the tab, the page in the tab) as a chip with its own x. Dismissing the chip leaves it out. The page itself is never drawn in the draft and never opened in the draft's band.
2. **The small view holds the conversation and a picture of the thread's tabs.** Under its head, the thread's tabs as they stand in the thread's pane (mark or pulse, the name), none in front, no plus, no close: a read-only version of the tabs, to look at and to go to, never to manage. The pages the agent opens land in the thread's group as they do today and nowhere else: never in the place's tabs behind the small view. A website never joins the files.
3. **Everything that leaves the corner goes to Chat.** Expand lands in Chat with this thread open, its row in the list and its pane as it was. A tab in the picture does the same and puts that tab in front of the pane. In Chat, the column of a thread that is floating shows a placeholder rather than the conversation (rule 4), and expand, a tab press, Bring back or close put the conversation back in the column and take the window down.
4. **Any thread can float, and floating leaves a placeholder.** A glyph on a thread's head in Chat pops it out into the small view. The head, with its title and topics, stays in the column; under it a placeholder card says the conversation is in the corner, carries the thread's work line, and offers **Bring back**. The pane keeps its tabs. The window stays in the corner in every place, Chat included, the way a video keeps playing in its small window over the page that owns it; it comes along to Files and Apps because it is the window's, not a place's. Minimized, it is a bar on the bottom edge with the pulse while the thread works. This is the shape chosen over two others (the thread staying whole in the column with the window drawn only elsewhere, and the working thread following on its own with no glyph); it keeps the focused thread's name on the right and costs an overlap in Chat, which is accepted for now.

The same behavior for a draft started in Chat is a flag for now: it may become the default, since the small view is a stronger place to watch a thread arrive than a row lighting up in the list.

## What exists to build on

- **The draft windows.** `composeAtom` holds `ComposeEntry { draftId, placement: "bar" | "docked" | "expanded" }`; `useCompose(width)` lays them along the foot through `layoutCompose` (`COMPOSE_WIDTH` 600, `COMPOSE_BAR_WIDTH` 300, `COMPOSE_GAP` 12), keeps the element each window's band draws its guest into and what each band has on screen, and reports `covers` so the pane's guest parks under a window. `ComposeLayer` draws the windows and bars over the row and lets the pointer through everywhere else. `ComposeWindow` and `ComposeBar` in `compose-window.tsx` are the window (head with minimize, expand, close; `COMPOSE_HEIGHT` 640) and the bar; `ComposeZeroState` is the band's four doors; `ComposeFiles` is This Mac inside the band. A DOM window already floats over a guest here, so overlapping a page is nothing new.
- **Starting a thread.** `startThread(id, send)` in the orchestrator route reads the draft, builds `viewing` with `draftContext(id)` (what the draft's own tab group has up: a file's path, a page's words read from its guest, the group's tabs described), and calls `createMessage`. On success it removes the compose entry, sets `arrivedId` so the new row lights up, and either adopts the draft's tab group as the thread's (`windowTabs.adoptGroup(group, sessionId)`) or shows the thread (`windowTabs.showThread`).
- **Tabs and groups.** `windowTabsAtom` keeps every tab under a group key: `draft:<id>` for a draft, `place:<place>` for Files, Apps and Home, and the session id for a thread. `useWindowTabs()` gives `showThread`, `showGroup`, `tabUpIn(group)`, `selectIn(group, id)`, `openScreen`, `adoptGroup`, `allTabs`. `appPlaceAtom` is the place the window stands in; `chatGroupAtom` remembers the group Chat had up; `paneOpenByGroupAtom` whether a group's pane is open.
- **The places.** Home, Apps and Files are each a tab group drawn by the chat's pane with the conversation put away. Apps opens on its new tab (the apps as marks, Recent held to each app's host, the directory to connect) and an app's front is its mark, Open <site>, and the pages recently visited in it. Files opens on the Finder and a file opens as its own tab beside it.
- **The conversation.** `ThreadStage` mounts the threads on screen and lately left and shows the one whose group is up; `RightPane` holds the conversation beside its pane. The thread's head is `thread-header.tsx` with its actions from `useThreadActionsFor` (archive, read, star, rename, transcript).
- **What is on screen.** `ScreenView` and `screenViewAtom`, `useOnScreen`, and `screenPresentation` say what a screen is showing, which is how the composer's chip and `viewing` are built today.

## The pieces

| Piece | Where | What it does |
| --- | --- | --- |
| The included thing | `Draft` gains `included?: { tabId: string; group: string }` (or the tab's own description), set by `startDraft` when the window stands in a tabbed place: the tab that place's group has up (`windowTabs.tabUpIn(placeGroupOf(place))`). | The draft carries a pointer to the thing it was opened over, not a copy of it and not a tab of its own. |
| The Included region | `ComposeZeroState`, and the band's head once things are gathered | A region at the band's top on a brand tint: the word Included, then the included thing as a chip (its kind mark or site mark, its name) with an x. The x clears `included`. Drawn only while there is one. |
| Included at send | `draftContext(id)` | When the draft has an included tab and its own group has nothing but a new tab up, `viewing` is built from the included tab instead: a file's path (and mount), or a page's words read from the place's guest and its address, with the place's tab described among `tabs`. When the draft gathered its own things too, the included tab is described as one more tab. |
| The thread entry | `composeAtom` entries gain a kind: `{ kind: "draft", draftId, placement }` or `{ kind: "thread", sessionId, placement }`; `layoutCompose` lays both, a thread window at 420 and a bar at 300. | The small view is the same layer and the same row of bars as the drafts. |
| Becoming the small view | `startThread` on success | When the window stands outside Chat (or the flag is on), the draft's entry is replaced in place by a thread entry at the same position, the draft's tab group is adopted as the thread's as today, `arrivedId` is not set, and neither `showThread` nor the place changes. Otherwise today's behavior. |
| The small view | `ThreadWindow` in `compose-window.tsx` beside `ComposeWindow`, drawn by `ComposeLayer` | The head (the pulse while working, the thread's title, minimize, expand, close), the tab picture under it (the tabs of `allTabs` in the thread's group, drawn as the pane's tabs with no active one, no plus, no x), the conversation (the same transcript, work line and reply box the thread column shows, at 420 wide), and the bar when put down (pulse, title, x). The conversation is the thread's own components, mounted here while the thread floats, so a floating thread does not render twice. |
| Leaving the corner | `ThreadWindow` handlers | Expand: `appPlaceAtom = "chat"`, `windowTabs.showThread(sessionId)`, the entry removed. A tab in the picture: the same, then `windowTabs.selectIn(sessionId, tabId)` and the group's pane opened. Close: the entry removed; the thread is unchanged in Chat's list. Minimize: placement `bar`. |
| The placeholder | the thread column in Chat (`ThreadStage` or the column's own component) | While a session has a thread entry, its column in Chat keeps the head (title, topics, the pop-out glyph lit, the tri-dot) and shows, in place of the transcript and the reply box, a card: the pop-out mark, the words **Popped out**, the thread's work line, and a labeled **Bring back** button that removes the entry. The pane and the list's row are untouched. The same column shows for a thread that became a small view from a draft when its row is opened in Chat, so there is one rule: a floating thread's column is its placeholder. |
| Pop-out | `thread-header.tsx`: a glyph at the head's right, beside the tri-dot (`ph-picture-in-picture` is the mark the wireframe used), lit while the thread floats | Adds a thread entry for the session at the right end of the row; pressing it while lit is Bring back. The window follows the window into every place. |
| The flag | a developer setting, `floatEveryDraft` | Starting from Chat also becomes the small view instead of lighting the row. Off by default until it has been lived with. |
| Guest parking | `useCompose().covers` | A thread window counts as covering the row exactly as a draft window does, so the pane's guest parks under it. |

## Files and Apps, what remains

Three pieces of the places are not built as the wireframes have them and belong with this work:

| Piece | Where | What it does |
| --- | --- | --- |
| The file tab's tree | the file tab's screen in the Files group | A file opened from the Finder (a double-click) gets an editor-style file tree at its left, rooted at the folder the Finder was standing in when the file was opened (three folders deep, that top folder open down to the file), the file selected, no search field. A row in the tree swaps the document in the same tab, which is what lets a person leaf between the files of a folder without going back to the Finder. The head is the file's crumbs and a close at the right that closes the tab back to the Finder; no omnibar on a file tab. Today a file tab has no tree, so this is the piece most visibly missing. |
| Links between files | the Markdown viewer in a file tab | A relative link to another file in a Markdown document opens that file in the same tab: the tab's label, crumbs and tree selection follow the document, so a folder of linked notes reads like a wiki. A link to a site opens as a page tab as today. |
| Home | the Home place | Home is not a tab group and shows no tab strip. It is a landing page: a big, chunky overview a person jumps into recent things from. The date as a large heading, one quiet line of what the agent is doing now, then the things lately made (files and pages, each drawn small with its mark and name and the thread it came from under it) and the recent chats, as large tiles three or four across. A tile opens the thing where it lives: a file in Files as its tab, a chat in Chat on that thread. Nothing counts and nothing is unread on Home. The Home place as built (the ordinary new-tab page in a tab group) is replaced, not extended. |

The Apps place as built is close to its wireframe; read the two against each other for the zero states (the new tab's Recent held to each app's host, an app's front with Open <site> over its recently visited pages) and close the gaps found.

## Also in this work

- **The connect buttons carry the Instrument mark.** Every button on the app connection screen that hands words to the conversation (Connect, Finish connecting, Ask about) is the product's glyph button: white, the green Instrument mark, a verb. The places build drew plain buttons there; make them the glyph button.
- **The omnibar's back button can land on an empty window.** Pressing back in the omnibar while standing in Apps has been seen to leave a fully empty screen, which reads as the window closing. Reproduce it in the places as built (it may have been a hot reload), and fix it if it is real before the small view adds more ways to arrive in a place.

## What does not change

- The thread's tabs land in the thread's group, whoever opened them. The place's group (`place:files`, `place:apps`) is never written by a thread.
- Chat's list, rows, arrival, filters. A thread that began as a small view is an ordinary thread there.
- The draft as it stands in Chat when the flag is off: it starts, the row arrives, the window goes.
- The composer's band, its doors and its tabs. The Included region sits above them and takes nothing from them.

## Order of work

1. The included thing on the draft and the Included region in the band, with dismissal and the merge into `viewing`. Testable alone: start a draft from a file tab, see the chip, start the thread, read `viewing` in the transcript.
2. The thread entry kind, `layoutCompose` for it, and `startThread` replacing the draft's entry outside Chat. The window can be a placeholder head over the transcript at this step.
3. `ThreadWindow` proper: head, tab picture, the conversation, the bar; expand, tab press, close, minimize.
4. The placeholder column in Chat and pop-out from the thread head, with Bring back.
5. The file tab's tree and links between files.
6. Home as the landing page.
7. The flag, the connect buttons, and the back button.

## How to check it

- Unit: `layoutCompose` with mixed entries (a draft window, a thread window, two bars); the `viewing` merge with an included file, an included page, and a draft that gathered its own things besides.
- Browser tests: New from a file tab shows the Included chip and starting leaves the place unchanged with a small view in the corner; expand lands in Chat on that thread; a tab pressed in the picture lands with that tab in front; pop-out from Chat leaves the placeholder and a place change keeps the window; Bring back restores the column.
- The app: the Levoit scenario from the wireframes, then the Gmail invoice from an Apps tab, watching that nothing the agent opens appears in the place's strip.

## Open

- Width. The wireframe drew the small view at 420 by 560 against the draft window's 600; both are one constant each in `compose-layout.ts` and `compose-window.tsx`, so it is a number to settle by looking, not a design.
- Whether floating entries survive a launch. Drafts' windows do not (`composeAtom` is in memory); the small view should match until there is a reason not to.
- The head's expand is the way to Chat and nothing else; there is no larger floating size. If a larger size is wanted later, it is a placement like the draft's `expanded`.
- Several small views at once: the bars line up along the bottom like drafts do; the layout already drops the ones there is no room for. Whether two open windows are allowed at once is the layout's existing rule for drafts.
