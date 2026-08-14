# Document thumbnails

Status: active (not started)

Cover images for documents wherever Studio lists files — the message file grid and the sidebar file list — instead of the file-type icons drawn today. Split out of [document-viewers.md](../completed/document-viewers.md), which established the viewers this would reuse.

## Why cover thumbnails are their own piece of work

All three document libraries expose a thumbnail hook — `useDocxPageThumbnails`, `usePptxViewerThumbnails`, `useXlsxViewerThumbnails` — and the DOCX rail here is built on one. None of them is the feature a file grid wants. They enumerate the pages, slides or sheets *of a document already open in a controller*, so what they answer is "draw page 7 of the thing on screen", not "draw a cover for this path on disk". DOCX is explicit about it: its thumbnails paint from the live page DOM, which is why generating a full set means turning page virtualization off so every page is mounted at once.

So a cover thumbnail costs a full open: fetch the bytes, boot that format's wasm, parse the document, mount it, paint page one, throw it away. Between 0.5MB and 5.1MB of wasm per format, once per file. A chat message listing eight attachments would pay that eight times, in the renderer, while the transcript scrolls. PDF is the one cheap case — the pdfium engine is already module-cached and can render a page without any of it being in the DOM — but shipping covers for PDF alone means a grid where PDFs have pictures and Word and PowerPoint have icons.

What makes it a subsystem rather than a component change is that the render has to happen once, not once per mount. That needs a cache keyed by path and mtime, living in the main process where it survives a reload, with a protocol route to serve entries, a generation path that cannot block the message list, and an eviction policy. The rendering itself is the small part.

The insertion point is clean when someone does it: `FileThumbnail` is the single component behind both the grid's row cards and the sidebar's file list, so a cover branch there covers both surfaces at once.

One shortcut is worth knowing about and not worth relying on. OOXML packages may carry a `docProps/thumbnail.jpeg`, and PDFs may embed page thumbnails, either of which would be a cheap read with no wasm at all. Both are optional, Office does not write them by default on every platform, and a file an agent generated will not have one — so it can only ever be a fast path in front of real rendering, never the mechanism.

## How it should be built, when it is

PDF and the rest are not the same problem, and the shape of the answer differs.

PDF needs no DOM at all. `PdfEngine.renderThumbnail(document, page, { dpr, imageType, scaleFactor, withAnnotations })` hands back an image blob directly, so the whole path is: share one engine, open the document, render page zero. That is a small amount of code over what the PDF viewer already module-caches.

DOCX, PPTX and XLSX have no equivalent, because their thumbnails are captured from painted DOM. The only way to get one is to mount the viewer, let it lay out, and read the pages back off canvases. Extend UI does exactly this in its file explorer, and it is worth reading their `file-system-docx-thumbnails.tsx` before writing ours, mostly for the failure modes it documents: pagination reports a rising page count while it measures, so the capture waits for a quiet period rather than the first count; the canvas reports ready once for the blank pre-import page, so a "does this have ink" sample rejects the empty frame; and a capture in flight can be invalidated by pagination moving underneath it, so the settled count is re-checked before the result is accepted. It is roughly two hundred lines of racing the library's own layout, and their version mounts an 816x1056 viewer per file behind `opacity-0` in the live page, with results held in React state that a reload discards.

Being an Electron app is what makes this better rather than merely possible. A hidden `BrowserWindow` can host that generation code as a service: main sends it a job, it renders, it returns bytes, main writes them under the cache dir and serves them over the app protocol like any other vendor asset. What that buys over doing it in the app renderer is most of the objection above.

- The app renderer pays nothing. No wasm boots, no offscreen viewers mounted in the message list, no layout thrash while the transcript scrolls.
- Each engine boots once for the life of the window instead of once per file, so the marginal cost of the eighth DOCX is a parse, not a parse plus 1.1MB of wasm.
- Jobs can be serialized. The DOCX capture is a race against pagination even when it is the only thing running; eight concurrent ones in a shared event loop is asking for the blank-frame and stale-count paths to fire constantly. A queue in the main process is the natural place to say "one at a time".
- A hang or a crash is contained. The window is disposable — kill it, restart it, and thumbnails degrade to the icons we draw today.
- The cache outlives the window and the app, so a given file version is rendered once ever rather than once per session.

Two details that will bite. Hidden windows get their timers and rAF throttled, which stalls exactly the layout-then-paint sequence the capture depends on, so that window needs `backgroundThrottling: false`. And the cache key has to include mtime, not just path, or a regenerated file keeps its old cover.

Studio already creates windows with `show: false` in `windows/main` and `windows/onboarding.ts`, so the lifecycle pattern is established; what is new is the job protocol, the disk cache and its eviction, and the protocol route to serve entries.

## Caching engine state across restarts is not the win it looks like

Every restart re-reads the file and re-boots an engine, which invites the idea of holding something back in the main process. Measured over the app protocol, cold, that whole cost is about 65ms: pdfium 4.4MB in 21ms with an 8ms compile, xlsx 4.1MB in 15ms/6ms, docx 1.1MB in 8ms/2ms, pptx 0.5MB in 4ms/2ms. The bytes never leave the machine — the file is already in the task folder — and V8's baseline compile of a 4.4MB module is single-digit milliseconds. There is nothing to win.

The expensive part is the parse and layout, and that is the part no cache can hold. A parsed document lives in wasm linear memory as an opaque object graph; none of the four libraries exposes a serialization API, and a snapshot would be locked to the exact engine build and invalidated by every dependency bump.

What survives a restart usefully is the engines' *output* — rendered page bitmaps and extracted text — which is the artifact the thumbnail service above already produces. So reopening a document is a free upgrade on that work rather than a subsystem of its own: paint the cached page-one bitmap immediately, boot the engine behind it, swap to live rendering when it is ready. Same cache, same key, first paint becomes a disk read.

## The storage and addressing half already exists

The file-open app icons solve exactly this shape, and a thumbnail store should be the same thing rather than a parallel one. `storePng` in `app-protocol.ts` hashes the bytes, writes `<sha256>.png` through a temp path and an atomic rename, and returns an `instrument://file-open-icon/<hash>.png` URL. The protocol host reads that file back with an immutable cache header, which is honest because the URL *is* the content hash — changed pixels get a different URL, so nothing ever serves stale. Alongside it, `file-open-target/cache-store.ts` persists the lookup from a key to its resolved value with a `resolvedAt` stamp and an `isStale` TTL, serving the cached answer immediately while refreshing behind it.

Both halves transfer. Content-addressed storage means the cache key problem lives entirely in the lookup layer: storage is keyed by output hash, and the lookup maps (path, mtime) to that hash the way the icon cache maps an extension to its resolved target. Consumers stay dumb — `FileThumbnail` receives a URL or null and renders an `<img>` or the icon fallback, exactly as the open-with menu already does with `iconUrl`. There is no stateful rendering path in the UI; the answer simply changes later, and the `<img>` is as reload-proof as any other file URL.

The one structural difference is worth stating plainly, because it is what stops the URL being the whole mechanism. Icons can be *pulled*: `app.getFileIcon` and the platform resolvers run in the main process, so main can satisfy a miss by itself. Thumbnails can only be *pushed*, because the pixels require DOM layout that only a renderer can perform. A request for a thumbnail that has never been rendered therefore cannot be answered by main synthesizing it on the spot — main can only report the miss, and something else has to fill the cache. That is the job queue, and it is why production and serving are separate concerns rather than one handler.

## Start with opportunistic capture

Given that split, the cheapest useful version needs no hidden window at all.

The viewers already mount and paint whenever someone opens a document. At the moment a viewer has page one on screen, it can hand those pixels to main through the same content-addressed store, and the grid has a cover for that file from then on. No wasm boots that were not already happening, no queue, no window lifecycle, no racing pagination — the capture is a byproduct of work the user asked for, and the hard part of the DOCX generator (waiting for a document that may not have finished paginating) does not arise, because the user is looking at the finished layout.

Coverage is partial by construction: only files somebody has opened get covers. But it grows with use, it is the right subset — files people actually return to — and it exercises the whole storage, lookup and serving path against real output. The hidden window then becomes a second phase whose only job is backfilling files nobody has opened yet, added behind the interface the first phase already proved.
