# In-app browser: full-page screenshots aren't supported

**Status:** open — workaround in place (PDF export). Last updated 2026-07-07.

## Symptom

`agent-browser screenshot --full` against the in-app browser produces a
vertically **tiled**, far-too-tall image — the top of the page repeated many
times — instead of a real full-page capture.

## Root cause

The in-app browser is an Electron `<webview>` guest, and its **compositor
surface is pinned to the on-screen viewport**. A full-page screenshot uses CDP
`Page.captureScreenshot` with `captureBeyondViewport: true`, which asks Chromium
to render past the viewport. The guest can't rasterize beyond the viewport, so
Chromium fills the over-viewport clip by **tiling the top of the page**.

(Secondary, not the main issue: agent-browser builds its clip from the
deprecated device-pixel `contentSize` instead of `cssContentSize`, which doubles
the tiling on HiDPI. Fixing that alone does not help.)

## What we tried — all still tile

- **Rebuild the clip from `cssContentSize`** (correct CSS px): still tiles. It's
  a surface cap, not a clip-units problem.
- **`Emulation.setDeviceMetricsOverride`** to the full document height: still
  tiles.
- **Grow the guest element** to the document height and poll `getLayoutMetrics`
  until the visual viewport reports the new height, then capture (the approach
  some webview-based apps use): the **layout** viewport grows, so the poll
  passes, but the **rasterized surface does not** — so it still tiles. Verified
  in the running app.
- **DOM-serialization libraries** (snapdom / html-to-image family): avoid tiling,
  but drop cross-origin images, iframes, and canvas/WebGL, which makes them
  unreliable for arbitrary sites. Rejected.
- **Scroll-and-stitch**: works in principle (real pixel slices) but sticky/fixed
  headers repeat in every slice and it needs stitching + overlap handling.
  Deferred.

## Current behavior (workaround)

Full-page (`captureBeyondViewport`) requests are rejected with an error that
directs the agent to **PDF export** (`agent-browser pdf <path>`), which renders
the whole document via the print path and works. Plain viewport `screenshot` and
element `screenshot @ref` are unaffected. See
`apps/studio/src/electron-main/browser-view/dispatch-command.ts`.

## What might resolve it later

- **Scroll-and-stitch**: capture viewport slices with `webContents.capturePage`
  (reliable), hide `position: fixed`/sticky elements after the first slice, trim
  overlap between slices, and stitch with the already-bundled ffmpeg (`vstack`
  filter). This is the only path to a faithful in-browser full page.
- An Electron/Chromium capability to rasterize a guest surface larger than the
  viewport (e.g. offscreen rendering that isn't pinned to the element box).
- Upstream: agent-browser using `cssContentSize` — corrects real headless
  Chrome, but does not fix our embedded guest.
