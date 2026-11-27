# Plan: one tab for a local file

Status: open. Steps 1 to 5 built and checked in the app through the agent's own commands; not yet run with a real model, and the agent-working overlay does not yet show over a file tab's page.

A local HTML file is one tab, the way a browser has one tab at a `file://` address: the person views it, the agent drives it, and both act on the same page. Today the same file can be two kinds of tab: a file tab, whose page the viewer draws from a guest in a hidden group (`hostGroupOf`, `useHostedPage`), and a page tab on the `file://` address, which `agent-browser open`, a link opened in a new tab, or a bookmark makes. The agent can drive only the second, so a chat that shows a page with `instrument window show` and checks it with `agent-browser` makes two tabs of one file, and its checks run in a tab the person is not looking at.

The split was kept on purpose: `a22827a39` committed to "a person's view of a local file is its file tab; a file:// page tab is the agent's or a link's", because the agent drove page tabs only. This plan removes that reason and so the second kind.

## Which kind stays

The file tab. A tab in Files walks a folder's files with the arrows, an HTML file among images and documents, so the tab's record cannot change kind with the file it shows. Its page stays the implementation of how an HTML file is drawn, never a tab of its own in any strip or list.

## Steps

1. **Done.** **A file tab's page lives as long as the tab shows an HTML file**, not as long as its viewer is mounted. The tab-groups branch did this for a tab behind another on its side (`edd29c1bc`, `keepsHostedPage`, `strandedHostedPages`); here it covers every file tab in a chat's pane that stands on an HTML file.
2. **Done.** **An agent names a file tab by one id.** `instrument window list`, `window show`, and `chatPageTabs` give a file tab on an HTML file as a page tab under the tab's id, with its page's id beside it (`targetId`) for the workspace to drive it by. A tab keeps the id agents know it by through every change of kind (`agentId`, `agentIdOf`), so a file opened behind reads the same before and after its page is drawn, and the workspace names anything it keeps by page (`openedTabs`, working marks, tab news) by the tab's id when an agent reads it (`agentTabIdOf`). The window takes that id, or the page's, which earlier builds handed out, for the file tab in every action (`agentNamedTab`), and opens the page of a file tab that has none yet (one opened behind and never drawn) when it lists it. A page let go (its file tab walked to an image for more than `PARKED_PAGE_MS`) comes back under a new id. The agent goes on naming the tab by the same id, but what the workspace keeps by page is lost with the old page ([a file tab's new page loses what the workspace kept by page](../findings/a-file-tabs-new-page-loses-what-was-kept-by-page.md)).
3. **Done.** **Every `file://` open the agent makes is a file tab**: `agent-browser open <path>`, `tab new file://…`, and a page tab sent to a local file turns into a file tab in place, the page tab's guest becoming the new file tab's page (`moveToGroup` into its `hostGroupOf`) so the id the agent holds and its CDP session carry on, as a file tab's page that leaves the computer already turns into a page tab (`useHostedPageNavigation`). What the page tab showed before is a step back in the file tab's history, and the guest's history is cleared, as a page leaving its file does; a file tab behind another, whose viewer is not drawn, follows its page's moves through the window (`undrawnHostedStep`). A link a page opens into a new tab, and a bookmark, on a local file open its file tab too.
4. **Done by step 3.** A stored `file://` page tab turns into its file's tab the first time its page loads, so tabs kept from earlier builds come back as the one kind without a migration.
5. **Done.** Replace `a22827a39`'s contract in `docs/architecture/in-app-browser.md`.

## Tab groups

The tab-groups branch rewrote `use-openers.ts` and the window's tab model, and has step 1's first half. Porting: take step 1 from the branch's `keepsHostedPage`, extend it to tabs never drawn; steps 2 to 4 carry over in the workspace unchanged and in the renderer by the same rule, in the branch's `act` and `openBeside` paths.
