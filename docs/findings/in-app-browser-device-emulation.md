# In-app browser: device/viewport emulation isn't safe for agent-browser

**Status:** closed — rejected outright (same treatment as full-page screenshots). Last updated 2026-07-08.

## Symptom

An agent using `agent-browser set viewport <w> <h>` (CDP `Emulation.setDeviceMetricsOverride`) as a workaround for the full-page screenshot limitation (see [in-app-browser-full-page-screenshots.md](in-app-browser-full-page-screenshots.md)) corrupts the browser panel and/or produces broken screenshots. Observed concretely on `set viewport 1920 8000 && screenshot`:

- The panel renders the guest's emulated layout only in a corner, dead space around it, stuck that way until the user resizes the split or closes and reopens the panel.
- The resulting screenshot file is a tiny, mostly-transparent image.
- On a later attempt, the resulting screenshot file is the page's real content **tiled** in a grid to fill the requested height, instead of a real capture.

## Root cause

Same root cause as the sibling full-page-screenshot finding: this guest's compositor surface is pinned to what's actually on-screen. Asking Chromium to lay out or capture content at a size that doesn't match reality breaks down the same way regardless of which CDP entry point asks for it — `captureBeyondViewport` there, `Emulation.setDeviceMetricsOverride` here — just via a different code path, and manifesting differently depending on which capture API reads the result afterward.

## What we tried — two rounds, each traded one corruption for another

1. **Clamp width/height to a fixed safe max** (e.g. 4096, matching a comparable Electron-based product with the same `<webview>`-guest architecture). Still corrupts: the clamp is independent of the _actual_ current panel size, which is very often much smaller than any reasonable fixed clamp.
2. **Track the panel's live bounds** (reported by the renderer on every show/resize) and scale the override to fit those bounds, applying via CDP with a computed `scale` parameter. Confirmed live: the guest's internal layout viewport (`window.innerWidth`/`innerHeight`) correctly reflects the scaled request, and on-screen compositing correctly renders shrunk-to-fit with no dead space for reasonable, bounded requests. But:
   - `webContents.capturePage()` (Electron's native capture, used for normal viewport screenshots) does **not** respect the CDP `scale` parameter — it returns a canvas sized to the panel widget with only the unscaled, top-left corner of the emulated layout painted, the rest transparent. Confirmed via a raw capture comparing `capturePage()` against `Page.captureScreenshot` side by side.
   - Routing the capture through real CDP `Page.captureScreenshot` instead **does** respect the full emulated size (e.g. a 1920×8000 request produces a 3840×16000 image, at 2x DPR) — but for a height that vastly exceeds the page's actual rendered content, Chromium's rasterizer tiles the content to fill the requested canvas instead of laying it out once. This is the exact tiling failure from the sibling finding, reached through `Emulation.setDeviceMetricsOverride` + a plain screenshot instead of `captureBeyondViewport`.
   - Also found and fixed independently, but doesn't change the verdict: the renderer's own reconciliation deduped against the last value _it_ sent, which could suppress the corrective "clear" RPC even on a legitimate resize/reopen, since it never accounted for an agent's CDP call changing the guest's actual state out-of-band.
3. **Push an immediate resync to the renderer the moment an agent's CDP call changes emulation**, so the panel could self-heal without a manual resize. Considered, not implemented: `agent-browser` chains `set viewport` and `screenshot` as one shell command with minimal gap between them. An immediate same-process IPC resync could plausibly race into that gap and silently revert the agent's own screenshot to the wrong size before it's even taken — a worse, silent failure mode than the visible one it would fix.

## Current behavior (workaround)

`Emulation.setDeviceMetricsOverride` is rejected outright for agent-browser callers, same treatment as `captureBeyondViewport`, pointing the agent at PDF export. See `apps/studio/src/electron-main/browser-view/dispatch-command.ts`.

The browser panel's own first-party "View as" menu (Mobile/Tablet/Desktop presets) uses the same underlying CDP mechanism but stays safe, and is kept: it only offers a few bounded, real device sizes, always computes `scale` from the panel's live, freshly-measured bounds at the moment it's applied (never a stale or reported value), and is a pure visual preview with no corresponding capture action — so it never intersects with either failure mode above. See `apps/studio/src/electron-main/browser-view/device-emulation.ts`.

## What might resolve it later

Whatever eventually resolves the sibling full-page-screenshot finding (scroll-and-stitch, or an Electron/Chromium capability to rasterize a guest surface larger than its on-screen size) would likely also unlock safe agent-driven device emulation, since it's the same underlying compositor limitation. Short of that, don't retry either of the two approaches above without a materially different mechanism — both were verified live and both reproduce real corruption, not theoretical edge cases.
