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
| `instrument://new?text=<words>&topic=<id>` | a new chat's draft with the words in it |

A noun names one thing by one path segment and only takes the person to it. `new` is the one verb, and what it makes is written in query parameters, so a later verb has the same shape. A Windows path keeps its drive letter as the first segment (`instrument://file/C:/Users/windows-user/report.pdf`).

## How a link arrives

Three roads, all into `handleDeepLink` in [`index.ts`](../../apps/studio/src/electron-main/index.ts): `open-url` on macOS, the launch's own arguments on Windows and Linux, and `second-instance` when the app is already running there. The first two are listened for before `ready`, because the link that launches the app arrives before it. None runs while the workspace is refused.

[`outside-links.ts`](../../apps/studio/src/electron-main/lib/outside-links.ts) reads the link (`outsideLinkOf` in [`instrument-link.ts`](../../packages/shared/src/instrument-link.ts)) into an ask, and the window's asks queue ([`app-window-asks.ts`](../../apps/studio/src/electron-main/windows/app-window-asks.ts)) holds it until the window can show it: while its page loads and while setup is up. The window comes forward only for a link that opens something.

## What keeps a link harmless

A link carries no word of who wrote it, and a site the person has let open Instrument can send one with no click at all. So a link only ever puts something in front of the person:

- **A path is a plain absolute one.** It goes through the same check as the file channel's (`hostPathOfUrlPath` in [`computer-files.ts`](../../apps/studio/src/electron-main/lib/computer-files.ts)) before anything touches the disk: no doubled separator, which is how a network share is spelled (opening one would hand the share the person's Windows sign-in), no backslash where a backslash separates, and on Windows a drive letter. A step up is taken by the address itself before it is read, so the path judged is the one it leads to. Then the places every way of showing a file refuses ([`refused-files.ts`](../../apps/studio/src/electron-main/lib/refused-files.ts)) are refused here too, by name and by where the name leads.
- **A page is shown, not opened.** A page opened in the app's browser reads the files beside it, so a page a site saved into Downloads could read the rest of the folder. A link to an HTML file opens its folder in Files with the page selected, and the person opens it from there. Every other kind of file opens: an image, a PDF, Markdown and text run nothing.
- **A new chat is never sent.** Its words are a draft of its own beside any already open, so nothing the person wrote is replaced, with no file or tab attached. The characters a person cannot see but the model reads (zero-width ones, the marks that turn text around, the tag block) are taken out, longer words than `OUTSIDE_WORDS_MAX` open nothing, and the topic is used only when one has that id.
- **A site cannot flood the window.** The same link again within a few seconds is one click, at most ten links a minute open, and once ten asks wait for the window another link is let go (`createLinkGate`).

There is no link that opens a web page. One would add nothing a link to the person's own browser does not, and paired with `new` it would put a page a site chose in front of the agent, signed in as the person.

Asks from outside are answered even while something holds the window: setup's hold can still be up when what waited for setup arrives (`use-window-commands.test.tsx`).
