# A file tab's new page loses what the workspace kept by page

**Status:** open, checked 2026-11-27. Not a regression: the same records were lost the same way when agents named a file tab by its page's id.

A tab on an HTML file is drawn by a page of its own, and the page's id is what the workspace drives it by. The agent names the tab by one id for as long as it stands (`agentIdOf`), but the page under it can change:

- A file tab walks from an HTML file to one of another kind (an image, Markdown) and stays there longer than `PARKED_PAGE_MS`, then walks back to an HTML file. Its old page was closed, and a new one, under a new id, draws the file.
- A file tab behind another, which no viewer draws, walks off an HTML file. Its page is closed at once (`strandedHostedPages`, `useCloseStrandedHostedPages`), and walking back opens a new one.

What the workspace keeps about a tab it keeps by page id, so all of it stays with the old page:

- `openedTabs` in the chat's state. A tab an agent opened becomes the user's: the hidden-tab cap stops counting and closing it (`tab-cap.ts`), archiving the chat leaves it open, and the bridge lists it to a new connection only if the session worked in it since.
- `actsIn` and `lastActOf` in `tab-activity.ts`. A task working in the tab stops showing as working there (`tabHolders`, the tab's working mark, the holder clauses in `instrument window` results), and tab news about who else used it starts over.
- The CDP bridge's attached session. The agent hears `Target.targetDestroyed` for the tab when its page closes, and the tab comes back to it only when the next reconcile lists it or the agent names it again (`agent-browser tab <id>`). Its id is the same throughout.

The fix is to key those records by the id agents name the tab by (the window's `pages[].id`) rather than by the page's, translating at the point a page reports activity (`noteTabCommand`, popups, downloads), which needs the page-to-tab mapping `chatPageTabs` already returns. The bridge could then move an attached session to the tab's new page in place.
