# A file tab's new page loses what the workspace kept by page

**Status:** fixed for the records; the bridge's attached session is kept as it was (below). Not a regression: the same records were lost the same way when agents named a file tab by its page's id.

A tab on an HTML file is drawn by a page of its own, and the page's id is what the workspace drives it by. The agent names the tab by one id for as long as it stands (`agentIdOf`), but the page under it can change:

- A file tab walks from an HTML file to one of another kind (an image, Markdown) and stays there longer than `PARKED_PAGE_MS`, then walks back to an HTML file. Its old page was closed, and a new one, under a new id, draws the file.
- A file tab behind another, which no viewer draws, walks off an HTML file. Its page is closed at once (`strandedHostedPages`, `useCloseStrandedHostedPages`), and walking back opens a new one.

What the workspace keeps about a tab it keeps by page id, so all of it stays with the old page:

- `openedTabs` in the chat's state. A tab an agent opened becomes the user's: the hidden-tab cap stops counting and closing it (`tab-cap.ts`), archiving the chat leaves it open, and the bridge lists it to a new connection only if the session worked in it since.
- `actsIn` and `lastActOf` in `tab-activity.ts`. A task working in the tab stops showing as working there (`tabHolders`, the tab's working mark, the holder clauses in `instrument window` results), and tab news about who else used it starts over.
- The CDP bridge's attached session. The agent hears `Target.targetDestroyed` for the tab when its page closes, and the tab comes back to it only when the next reconcile lists it or the agent names it again (`agent-browser tab <id>`). Its id is the same throughout.

The records are keyed by the id agents name the tab by (the window's `pages[].id`): `openedTabs`, the acts in `tab-activity.ts`, and the person's use marks. A page reporting activity is turned into its tab by the last command or window list that named it (`tabOfPage`, fed by `noteTabCommand` and `chatPageTabs`), and the cap drives a tab's page through the window's list (`pageOf` in `tab-cap.ts`). An entry an earlier build kept by page id still reads as its tab, and the cap writes it under the tab's id.

What remains: the bridge still sends `Target.targetDestroyed` when the page closes. In both cases above the tab shows a file no page draws for a while, so there is nothing to move the session to at that moment, and a session moved onto a new page would miss the domains agent-browser switched on (`Page.enable`, `Runtime.enable`), leaving it waiting on events that never come. With the records keyed by tab, the next `getTargets` lists the tab again under the same id, and an attached tab whose page changed before a command reached it is brought back on its new page. A page the window drew for a tab that no command or list has named since (`tabOfPage` falls back to the page's own id) shows no working mark until one does.
