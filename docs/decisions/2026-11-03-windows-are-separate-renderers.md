# Windows are separate renderers, and a chat can be open in two

## Context

The app went from one window to any number on one workspace, with tabs that tear off and drop between windows. Two questions decide the shape of everything else: how the windows relate to the renderer, and what happens when the same chat is wanted in two windows.

## Decision

Each window is its own renderer. A window keeps its own strip of tabs, and shares each chat's, draft's and site's tabs with the others. A chat can be open in any number of windows at once, live in each, as it can already be in two tabs of one window. A page is in one window at a time: another window showing it says so and offers Show Here, and takes it by itself once the first stops showing it.

## Alternatives

**One renderer drawing into several native windows** (`window.open` children, as VS Code's auxiliary windows are) would move a tab without touching most of its state, though not a `<webview>`, whose guest goes when its element leaves the document. The whole of the client reads the global `document` and `window` for focus, keyboard homes, floating positions, zoom and pointer math, so every one of those would have to learn which window it is in. That is a rewrite with a long tail of bugs that look like nothing.

**A chat lives in one window**, as a document does in a document-based Mac app, where opening it again brings its window forward. Every question about shared state would go away. But stepping through the inbox with the arrows would throw the person into another window partway down the list, and one window could not be used to read a chat that another is merely holding in a background tab. The tabs in one window already allow a chat twice.

**Each window keeps a chat's tabs itself.** Then a chat flipped to in a second window shows no tabs, and the tabs an agent opened are lost behind whichever window happened to be up. A chat's tabs are the chat's.

**Guests as main-process views (`WebContentsView`)**, which can change windows without a reload. The guest moved into the renderer so that the window's own layers stack over it by `z-index` ([in-app-browser.md](../architecture/in-app-browser.md)), and that stays worth more than a move without a reload.

## Consequences

- A page moved to another renderer reloads, which [tearing a tab off](2026-11-04-a-pulled-tab-keeps-its-window.md) mostly avoids. Its address and the pages behind it come with it; the pages ahead of it, and what a page held only in memory, do not.
- What one window does has to reach the others on its own. State that a mutation refreshes only in the renderer that made it goes stale in the rest, so what a person can change is a live route or an event stream.
- The tabs of a chat open in two windows are the same tabs, and the one up is the same in both.
