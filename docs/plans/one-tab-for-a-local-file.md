# Plan: one tab for a local file

Status: open.

A local HTML file is one tab, the way a browser has one tab at a `file://` address: the person views it, the agent drives it, and both act on the same page. Today the same file can be two kinds of tab: a file tab, whose page the viewer draws from a guest in a hidden group (`hostGroupOf`, `useHostedPage`), and a page tab on the `file://` address, which `agent-browser open`, a link opened in a new tab, or a bookmark makes. The agent can drive only the second, so a chat that shows a page with `instrument window show` and checks it with `agent-browser` makes two tabs of one file, and its checks run in a tab the person is not looking at.

The split was kept on purpose: `a22827a39` committed to "a person's view of a local file is its file tab; a file:// page tab is the agent's or a link's", because the agent drove page tabs only. This plan removes that reason and so the second kind.

## Which kind stays

The file tab. A tab in Files walks a folder's files with the arrows, an HTML file among images and documents, so the tab's record cannot change kind with the file it shows. Its page stays the implementation of how an HTML file is drawn, never a tab of its own in any strip or list.

## Steps

1. **A file tab's page lives as long as the tab shows an HTML file**, not as long as its viewer is mounted. The tab-groups branch did this for a tab behind another on its side (`edd29c1bc`, `keepsHostedPage`, `strandedHostedPages`); here it covers every file tab on an HTML file, including one opened behind and never drawn, whose page the window opens when the agent first needs it.
2. **The window lists a file tab on an HTML file as a page**: `instrument window list` and `chatPageTabs` name it by the file tab's id, with its page's target. The CDP bridge already announces a tab by its `tabId` and drives it by its `targetId` (`cdp-task-bridge.ts`), so agent-browser sees one tab under the id `window show` printed. Working marks, `openedTabs`, turn-end closing and the tab cap name the file tab.
3. **Every `file://` open the agent makes is a file tab**: `agent-browser open <path>`, `tab new file://…`, and a page tab sent to a local file turns into a file tab in place, as a file tab's page that leaves the computer already turns into a page tab (`useHostedPageNavigation`). A link a page opens into a new tab, and a bookmark, on a local file open its file tab too.
4. **A stored `file://` page tab is read as a file tab**, once, so tabs kept from earlier builds come back as the one kind.
5. Replace `a22827a39`'s contract in `docs/architecture/in-app-browser.md`.

## Tab groups

The tab-groups branch rewrote `use-openers.ts` and the window's tab model, and has step 1's first half. Porting: take step 1 from the branch's `keepsHostedPage`, extend it to tabs never drawn; steps 2 to 4 carry over in the workspace unchanged and in the renderer by the same rule, in the branch's `act` and `openBeside` paths.
