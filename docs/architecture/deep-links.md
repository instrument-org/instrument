# Deep links

An `instrument://` address names something in the app. Inside the window it is a link in a reply or a document, read by [`open-target.ts`](../../apps/studio/src/client/lib/open-target.ts). From outside (a browser, a note, another app) the OS hands it to the app, and this doc is about that road in.

## The scheme

Each build answers to its own scheme (`appProtocolOf` in [`constants.ts`](../../packages/shared/src/constants.ts)): `instrument` for the app people install, `instrument-local` for development and `instrument-preview-<name>` for a preview, so a link never reaches a build it was not meant for. A reply always writes `instrument://`, and every build reads that as its own inside the window.

## The links

| Address | Opens |
| --- | --- |
| `instrument://chat/<id>` | the chat |
| `instrument://task/<id>` | the task |
| `instrument://app/<id>` | the app's page |
| `instrument://skill/<name>` | the skill (`skill/instrument:create-page`) |
| `instrument://memory/<name>` | the memory |
| `instrument://settings/<name>` | the settings section (`settings/models`) |
| `instrument://screen/<name>` | one of `SCREENS` in [`instrument-screens.ts`](../../apps/studio/src/shared/instrument-screens.ts) |
| `instrument://file/<absolute path>` | a file in its viewer, or a folder in Files |
| `instrument://files?path=<path>&path=<path>` | each file or folder as `file/` opens one, up to 20, in tabs of their own |
| `instrument://page/<id>` | a copy of the page hosted at `https://<id>.instrument.page/`, kept in Downloads |
| `instrument://new?text=<words>&project=<id>` | a new chat's draft with the words in it |

A noun names one thing by one path segment and only takes the person to it. `new` is the one verb, and what it makes is written in query parameters, so a later verb has the same shape. A Windows path keeps its drive letter as the first segment (`instrument://file/C:/Users/windows-user/report.pdf`).

## How a link arrives

Three roads, all into `handleDeepLink` in [`index.ts`](../../apps/studio/src/electron-main/index.ts): `open-url` on macOS, the launch's own arguments on Windows and Linux, and `second-instance` when the app is already running there. The first two are listened for before `ready`, because the link that launches the app arrives before it. None runs while the workspace is refused.

[`outside-links.ts`](../../apps/studio/src/electron-main/lib/outside-links.ts) reads the link (`outsideLinkOf` in [`instrument-link.ts`](../../packages/shared/src/instrument-link.ts)) into an ask, and the window's asks queue ([`app-window-asks.ts`](../../apps/studio/src/electron-main/windows/app-window-asks.ts)) holds it until the window can show it: while its page loads and while setup is up. The window comes forward only for a link that opens something or says why it can't, and only boot opens the first window, since a link's ask can arrive after `ready` while boot still waits on setup.

## The same thing, the same tab

A link to a file, a folder or a screen that a tab already shows brings that tab up, in whichever window has it, and opens a new tab only where no tab does. A file handed over from the Finder (a double click, Open With, a drop on the Dock icon) does the same. Main finds the window by what each window keeps of its tabs (`showInWindowHolding`, by the tab address `tabHrefOfAsk` gives the ask), and the window it hands the ask to looks again in its own strip (`selectShowing`), since a tab can have closed since the strip was kept. A tab counts by what it shows, not its exact address (`tabIdentityOf` in [`tab-identity.ts`](../../apps/studio/src/shared/tab-identity.ts)), so one that has walked within the file or folder since (its layout, its selection) still counts. Nothing else does: not a new tab, not a tab near the file, not a tab beside a chat.

An agent usually links a file again because it has just rewritten it, and the tab brought up shows the file as it is now without being asked, since every viewer already follows its file. A page in its file tab is watched and reloads when written, keeping its place on the page. Markdown, text and code pull a write into the editor, watching only while their tab is up and catching up in one pull when it comes up. An image, a video, a PDF and the other viewers take the file at a URL carrying its modified time, which a tab behind another holds still until it comes up again, so coming up is when a write shows. Each watch looks about once a second, so a link sent the moment a file is written can show the old version for up to that second before the new one replaces it.

## A file that isn't there

A link to a path with nothing at it opens the folder it was in, in the tab already showing that folder where there is one, and the window says the file is no longer there. Where the folder is gone too, nothing opens and the window says that as well. A path the system won't say anything about (a folder the app may not read) is not counted as missing, so the file opens and its viewer says whose refusal it is.

## Several files at once

Instrument's own website writes `files`, from its `/open` page: a `path` parameter for each file or folder, each value as `encodeURIComponent` writes it and read back with `URLSearchParams`, so a space, a `+`, a `&` or a `#` in a name comes through as it was. A value is the plain path, `/Users/mac-user/a.md` or `C:/Users/windows-user/a.md`, with no slash before a drive letter.

Each path goes through everything a `file/` link's does and comes to the same thing: refused, a downloaded page shown in its folder, a folder in Files, a missing file said over its folder, or the file in a tab of its own, or in the tab already showing it. They come up in the order written, and a path written twice, or two ways that lead to one place, opens once. A path is read as written, with no step up taken out of it first, so one with a `..` opens nothing. A web address opens nothing either: the link takes only paths. At most `OUTSIDE_FILES_MAX` (20) open, and the window says how many more the link named, the way it says a file is missing.

However many paths a link has, one window comes forward, once (`showFromOutside` in [`app-window.ts`](../../apps/studio/src/electron-main/windows/app-window.ts)): the window with a tab showing the first path, else the one in front, and every path no window shows goes to that one too. A path another window shows comes up there, behind it.

## A page from instrument.page

A page the agent shares is hosted at `https://<id>.instrument.page/`, one self-contained HTML file, and its Open in Instrument control hands the app `instrument://page/<id>`, which the website writes with nothing but the id: one DNS label of lowercase letters, digits and hyphens, 1 to 63 of them, a hyphen at neither end (`outsideLinkOf`). A query, a fragment, a second segment or any other id is not a link.

The link opens no web page. Main ([`hosted-page.ts`](../../apps/studio/src/electron-main/lib/hosted-page.ts)) fetches `https://<id>.instrument.page/` asking for HTML, from that host and no other: a redirect that stays on the host is followed a few times, and one anywhere else, the pages domain itself included, fails. The page has thirty seconds and sixteen megabytes. What comes back goes into the person's Downloads folder, where their browser would have put it, under the page's own title as a file name (`cleanName`, the same cleaning Save Page As gives a name), else its id, with `.html`, and the ` (2)`, ` (3)` a browser adds when the name is taken; the write claims the name, so two links a moment apart never share a file. The copy carries the system's downloaded-from-the-internet mark, written as the app's own downloads are marked. Then the copy opens as a file link's page would, in the tab already showing that path where there is one.

It opens straight from the link, where a marked page a `file` link names is only shown in its folder, because of where it is. A page in the Downloads folder, or anywhere below it, reaches only itself ([`local-file-policy.ts`](../../apps/studio/src/electron-main/browser-view/local-file-policy.ts), judged by name and by where the name really leads): that folder is a pile of unrelated files a browser dropped there, so no page in it needs its neighbors, and a page from the internet opened there reads none of them. A page kept anywhere else would have its folder, which is why the copy goes nowhere else.

When the host answers anything but 200, sends the request elsewhere, takes too long or sends too much, nothing is kept and nothing opens: the window says `<id>.instrument.page didn't answer`, the way it says a file is missing. When the page comes but Downloads takes no file, the window says a copy couldn't be kept. The link counts once against the gate, like a link to a file.

## What keeps a link harmless

A link carries no word of who wrote it, and a site the person has let open Instrument can send one with no click at all. So a link only ever puts something in front of the person:

- **A path is a plain absolute one.** It goes through the same check as the file channel's (`hostPathOfUrlPath` in [`computer-files.ts`](../../apps/studio/src/electron-main/lib/computer-files.ts)) before anything touches the disk: no doubled separator, which is how a network share is spelled (opening one would hand the share the person's Windows sign-in), no backslash where a backslash separates, and on Windows a drive letter. A step up is taken by the address itself before it is read, so the path judged is the one it leads to. Then the places every way of showing a file refuses ([`refused-files.ts`](../../apps/studio/src/electron-main/lib/refused-files.ts)) are refused here too, by name and by where the name leads.
- **A downloaded page is shown, not opened.** A page opened in the app's browser can read its folder and everything below it ([`local-file-policy.ts`](../../apps/studio/src/electron-main/browser-view/local-file-policy.ts)), so a page a site dropped into Downloads could read the rest of the folder. What tells such a page apart is the mark the system puts on a file downloaded from the internet ([`download-mark.ts`](../../apps/studio/src/electron-main/lib/download-mark.ts)), read where the path really leads, so a link to the page carries it too: the `com.apple.quarantine` attribute on macOS, and on Windows a `Zone.Identifier` stream naming zone 3 (Internet) or higher. Linux browsers record the source in `user.xdg.origin.url`, which Node cannot read without a native module, so there a page under the Downloads folder counts as marked, and only there: a page saved anywhere else carries no mark Linux can read. The app's own browser marks what it downloads the same way ([`downloads.ts`](../../apps/studio/src/electron-main/browser-view/downloads.ts)): Chromium writes the Windows stream itself, the app writes the macOS attribute when a download finishes, and on Linux its downloads land in the Downloads folder unless the person picks another place, where they are not marked. A link to a marked page opens its folder in Files with the page selected, and the person opens it from there. Any other page opens like every other file: an image, a PDF, Markdown and text run nothing. The copy a `page` link keeps is the one marked page a link opens, and only because it is in Downloads, where a page reaches only itself.
- **A path with nothing at it is never a file to open.** It becomes the missing file's ask, the folder and the name and nothing the window could load, so a page a site manages to put there a moment later is still not run from the link. The mark reader counts a path that leads nowhere as marked too, for the same reason.
- **A new chat is never sent.** Its words are a draft of its own beside any already open, so nothing the person wrote is replaced, and, like every draft, it carries only what the person adds, never what is on screen. The characters a person cannot see but the model reads (zero-width ones, the marks that turn text around, the tag block) are taken out, longer words than `OUTSIDE_WORDS_MAX` open nothing, and the project is used only when one has that id.
- **A site cannot flood the window.** The same link again within a few seconds is one click, at most ten links a minute open, and once ten asks wait for the window another link is let go (`createLinkGate`). A link to several files counts once against the minute however many paths it has, while each of its paths is an ask that waits.

There is no link that opens a web page. One would add nothing a link to the person's own browser does not, and paired with `new` it would put a page a site chose in front of the agent, signed in as the person. A `page` link is not one: it names a page by its id alone, so the only address it can lead to is one under instrument.page, the app's own host, and what opens is a copy kept on this computer, in the one folder where a page reads nothing beside it.

Asks from outside are answered even while something holds the window: setup's hold can still be up when what waited for setup arrives (`use-window-commands.test.tsx`).
