# A thumbnail request nobody wants is still drawn

**Status:** contained, checked 2026-10-27. The request's abort never reaches the main process, so the renderer decides what to ask for instead: a picture is asked for only once its box has been on screen for a moment, and both drawing queues take the newest ask first. Measured on a folder of 300 pages in the List view.

Files asks for a file's picture with an `<img>` whose `src` is the file's address on the app's own protocol plus `?thumbnail=<px>` (`electron-main/lib/computer-files.ts`). Main draws it in one of two queues: the system's thumbnailer, four at a time (`withTurn` in `file-thumbnails.ts`), or, for pages, Markdown, code and SVGs, two hidden windows of the app's own (`withWindow` in `rendered-pictures.ts`), each draw a page load of up to six seconds.

## What happened

Scrolled quickly through a folder of pages, the rows the scroll stopped on waited more than half a minute for their pictures, and the store kept growing for long after with pictures of rows already gone. Both queues were first in, first out, so every row the scroll had mounted on the way was drawn before the ones on screen.

## What does not work: cancelling from the main process

A virtualized list drops the rows it scrolls past, and Chromium cancels an `<img>`'s request when the element goes. The obvious fix is to take a queued drawing out of line when its request is cancelled, through the `Request`'s `signal` that `protocol.handle` hands the handler (Hono's `c.req.raw.signal`).

That signal never fires. Instrumented over a full scroll through 300 pages, it reported zero aborts. Main cannot tell a request nobody is waiting for from one somebody is, so any cancelling has to be decided where the rows are.

## What the renderer does instead

- **Ask only for what has been seen.** `FileThumbnail` (`client/components/extend/file-thumbnail.tsx`) sets the image's `src` only after its box has been on screen, by an `IntersectionObserver`, for `ASK_AFTER_MS` (200ms), or at once for a picture already shown this session. Counting from mount was not enough: a list keeps rows drawn past its edges, and those rows stayed mounted long enough to ask.
- **Newest first.** Both queues pop the newest waiter, so the rows a scroll stops on, asked for last, are drawn first. A drawing already started is never stopped.
- **A failed page drawing is not remembered.** A page the app draws itself that drew nothing once (a load that ran out of time on a busy machine, a file caught half written) used to fall through to the system's thumbnailer and, when that had nothing either, write a `.none` marker for that version of the file, so a page an agent stopped writing just then never got its picture. Only files the system draws are marked now.

## The measurement

One run per row on 300 copies of wireframe pages, freshly copied so neither the store nor the HTTP cache had seen them: twenty jumps over two seconds to two thirds of the way down the List, then the time until the 15 rows on screen showed pictures, and how many pictures the store took in (two per page: the drawing and its size).

| Build | Rows on screen filled after | Written by then | Written 20s later |
| --- | --- | --- | --- |
| First in, first out (main at 63af08322) | 32.2s, 40.6s | 296 | 296 |
| Newest first | 10.4s | 104 | 236 |
| Newest first, asked after 200ms mounted | 4.8s, 4.9s | 76, 96 | 304, 326 |
| Newest first, asked after 200ms on screen | 3.0s, 3.1s | 68, 68 | 142, 126 |

Times depend on the machine's load and are worth comparing only side by side; the counts are steadier. A page rewritten three times two seconds apart, on screen, showed its last version's picture 2.5s after the last write, most of it the listing's four-second refresh.

## What might come next

- Two drawing windows bound how fast a screen of pages fills (about 0.2s a page). A third would cost a renderer process.
- The drawings still waiting when a scroll moves on are drawn eventually. They are rows that were on screen for at least 200ms, so the picture is likely wanted again; a cap on the line would bound it if it turns out not to be.
