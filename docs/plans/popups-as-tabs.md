# Plan: a page's popup is a tab of its group

Status: open.

A page that opens a popup (`window.open` with a size, a sign-in, a support chat) got a window of its own on the desktop: outside the group the page is in, reachable by no agent, and able to take the person's focus or move them to another Space. An agent's click got a tab at the popup's address instead, with the page's link to it cut, so a flow that reports back to its page (a sign-in, a chat widget) never finished. A whole class of the web was out of an agent's reach.

## Shape

The popup's page is Chromium's own, so everything the web expects of a popup holds: `window.open` returns it, `window.opener` and `postMessage` reach across, a page can point it somewhere later or write into it, and `window.close()` closes it. Only where it is drawn changes.

- **No window.** `setWindowOpenHandler` answers with `createWindow`, which hands over the popup's page for us to place: it goes in a `WebContentsView` in the opener's window, hidden until its tab is up. There is no OS window to take focus.
- **A tab of the group.** The popup gets a tab id and a browser entry bound straight to its page (`bindGuest`, with no `<webview>` to attach), and its tab opens beside the page that opened it: behind, when an agent's click opened it; in front, for a person's. The workspace files it as the clicking session's (`notePageOpenedTab`), so the agent's result names it and `agent-browser tab <id>` drives it through the usual bridge and the page's own debugger.
- **Drawn where the tab's page goes.** The renderer pool places a popup's view as it places a `<webview>`: the slot's bounds go to main, which moves the view there and shows it, and hides it when no slot shows the tab. While a menu or dialog is open over the slot the view hides and its last picture stands in, since a native view draws over the window's own layers.
- **Closing.** A popup that closes itself takes its tab with it, and the opener's tab comes up when the popup's was up; closing the tab closes the popup. A popup outlives the page that opened it, as in Chrome.

If a popup in a view ever behaves differently from Chromium's own popup in a way a site depends on, popups go back to being windows (made as children of the app's window and shown without focus) rather than ship a popup that breaks.

## Phases

1. Main: popups adopted into views, bound as entries, opened as tabs; agent access through the existing bridge.
2. Renderer: the pool places a popup's view over its slot, a guest handle for a page with no `<webview>`, the picture under overlays, closing the tab.
3. Checks: a localhost page of popup shapes driven by a real agent and a person, with focus and window counts read before and after.

## Known gaps

- A reload of the app window's own page (a crash recovery, or a development rebuild) drops its popups: their tabs come back as ordinary tabs at the popup's address, with no opener.
- Permission checks that ask whether a page is a tab's `<webview>` (camera and microphone, fullscreen, links to other apps) refuse inside a popup.
- Where the view lands over the slot is worked out from the slot's CSS pixels, which equal the window's points only while the window's own page is unzoomed; it has been checked by the popup's size and its picture, not yet by eye on an unlocked screen.
