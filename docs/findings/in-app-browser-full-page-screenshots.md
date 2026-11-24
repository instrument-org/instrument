# In-app browser: full-page screenshots tile unless taken a viewport at a time

**Status:** resolved 2026-11-24: `agent-browser screenshot --full` is taken a viewport's worth at a time and joined. What follows is why one capture of the whole page cannot work, and what the joined one leaves out.

See also [in-app-browser-device-emulation.md](in-app-browser-device-emulation.md): `Emulation.setDeviceMetricsOverride` (an agent's `set viewport`) reached the same root cause via a different CDP entry point, and is served by resizing the guest rather than overriding it. [browser-guest-raster-cap](browser-guest-raster-cap.md) measures the ceiling a guest's surface runs into, 1.3x the window per axis, which a full page is normally taller than.

## Symptom

`agent-browser screenshot --full`, sent to the guest as the one capture agent-browser asks for, produces a vertically **tiled**, far-too-tall image — the top of the page repeated many times — instead of a real full-page capture.

## Root cause

The in-app browser is an Electron `<webview>` guest, and its **compositor surface is pinned to the on-screen viewport**. A full-page screenshot uses CDP `Page.captureScreenshot` with `captureBeyondViewport: true`, which asks Chromium to render past the viewport. The guest can't rasterize beyond the viewport, so Chromium fills the over-viewport clip by **tiling the top of the page**.

(Secondary, not the main issue: agent-browser once built its clip from the deprecated device-pixel `contentSize` instead of `cssContentSize`, which doubled the tiling on HiDPI. It reads `cssContentSize` as of 0.44, and that alone does not help.)

## What we tried — all still tile

- **Rebuild the clip from `cssContentSize`** (correct CSS px): still tiles. It's a surface cap, not a clip-units problem.
- **`Emulation.setDeviceMetricsOverride`** to the full document height: still tiles.
- **Grow the guest element** to the document height and poll `getLayoutMetrics` until the visual viewport reports the new height, then capture (the approach some webview-based apps use): the **layout** viewport grows, so the poll passes, but the **rasterized surface does not** — so it still tiles. Verified in the running app.
- **DOM-serialization libraries** (snapdom / html-to-image family): avoid tiling, but drop cross-origin images, iframes, and canvas/WebGL, which makes them unreliable for arbitrary sites. Rejected.
- **Scroll-and-stitch**: works in principle (real pixel slices) but sticky/fixed headers repeat in every slice and it needs stitching + overlap handling. Deferred.

## What works: one capture per viewport's worth, none of them scrolled

Every attempt above asked the guest for one image larger than its surface. The guest does draw a `captureBeyondViewport` clip correctly wherever it lies in the document, without scrolling, as long as the clip is no larger than the viewport: Chromium moves what is drawn under the surface for that one capture and puts it back. So the gateway cuts the page into viewport-sized clips, captures each, and copies them into one bitmap (`apps/studio/src/electron-main/browser-view/element-screenshot.ts`). The same path serves `screenshot <selector>` for an element larger than the viewport.

This is not scroll-and-stitch, and does not have its problem. The page is never scrolled, so it is laid out once, at the scroll position it is at, for every piece: a `position: fixed` header is in the image once, where that scroll position puts it, and a sticky element is where it is stuck now. Nothing is hidden and no overlap is trimmed by comparing pixels. `scrollY` and the visible view are the same after the capture as before.

Measured in the running app (macOS, 1280x800 and 577x800 at device scale 2):

- **Lazy content stays unloaded.** Nothing scrolls, so an `IntersectionObserver` never fires and a `loading="lazy"` image far below the viewport is its placeholder. Chromium loads lazy images within a few viewports of the visible one, so those near the top are there. Headless Chrome behaves the same way for the same reason.
- **An inner scroller is one screen.** The capture is of the document. A page whose content scrolls inside an element of its own has a document one viewport tall, and that is the image; `screenshot <selector>` on the scroller's content captures the rest.
- **The image stops at 16384 pixels a side** (`MAX_SCREENSHOT_PIXELS`): Chromium's largest texture, and where its own DevTools cuts a full-size screenshot. At device scale 2 that is 8192 CSS pixels, about ten viewports. The command says so under the saved path when a screenshot is that large.
- **Pieces of two sizes come back as two colors.** On a display that is not sRGB, the guest tags a capture of exactly the viewport's size with the display's color profile and returns a smaller one in the same space untagged, so the two decode differently: `rgb(0, 128, 128)` came back as itself in full pieces and as `rgb(55, 126, 127)` in a shorter last piece, a visible seam. Every piece is therefore the viewport's size, the last of a row or column reaching back over the one before, with the overlap skipped by position.

- **The page gets a `resize` event per piece.** Chromium takes any clipped capture by switching an emulated offset on and off, and each switch fires `resize` on the window and its visual viewport with the size unchanged. An element capture fires one; a long page fires one per viewport's worth. No `scroll` event fires.
- **A piece sometimes stalls on a very long page.** On two Wikipedia articles of about 35,000 CSS pixels, roughly one piece in thirty waited 7 to 11 seconds where the rest took 150 ms. The page's main thread was in one long task for that time (a `longtask` entry of the same length), with the page's own `resize` listeners blocked, so the work is the renderer's and not the site's script; the embedding window drew throughout. A 19,500-pixel MDN page and a 12,000-pixel local page never stalled in eight captures each. A piece that takes over 20 seconds fails the command with the capture timeout, which happened twice in about sixty Wikipedia captures, both on a page loaded seconds before. The cause is not found.
- **The guest must stay awake.** A parked guest is put to sleep five seconds after an agent's last command when no working agent drives it, and a sleeping guest draws nothing, so a capture still running then would wait on a frame forever. The entry counts captures in progress (`capturesRunning`), which `isGuestBusy` reads.
- **Joining holds the main process for about half a second** on a capture at the cap, encoding the PNG.

## What might still improve it

- Finding what the renderer does in the stalled piece, or taking the pieces under one emulation rather than one each.


- Loading lazy content first would mean scrolling the person's page, which the capture avoids on purpose; an agent that needs it can scroll and wait itself.
- A single-piece capture smaller than the viewport (most element screenshots) is still returned untagged in the display's color space, as Chromium gives it.
