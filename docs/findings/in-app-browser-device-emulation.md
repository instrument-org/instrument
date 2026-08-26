# In-app browser: device/viewport emulation isn't safe for agent-browser

**Status:** superseded — the request is honored again, by a different mechanism. Last updated 2026-08-26.

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

## How it was resolved

Both rejected attempts argued with Chromium over the *layout* while leaving the compositor surface at the panel's size. The third mechanism moves the surface: an agent's `Emulation.setDeviceMetricsOverride` is read as a size for the guest **element**, applied by the renderer pool, and no override is set at all. A guest's layout viewport follows its element size exactly, so the mismatch the two attempts were trying to survive never arises.

That works because a parked guest is not bounded by the panel — it is a fixed, near-transparent element that can be any size. It is bounded by something else, measured afterwards: Chromium rasterizes at most 1.3x the window's content box per axis and crops past that while the page keeps reporting the larger size. Requests over that budget are refused with the maximum rather than clamped, since a clamped guest would report a viewport its own screenshots disagree with. See [browser-guest-raster-cap](browser-guest-raster-cap.md).

What has not changed: an agent still cannot capture more than a viewport, and PDF export is still the answer for a whole page. The sibling [full-page screenshot finding](in-app-browser-full-page-screenshots.md) is unaffected.

## Previous behavior, while the command was refused

`Emulation.setDeviceMetricsOverride` was rejected outright for agent-browser callers, same treatment as `captureBeyondViewport`, pointing the agent at PDF export. See `apps/studio/src/electron-main/browser-view/dispatch-command.ts`.

## What still stands

The two attempts above remain dead ends: both were verified live and both reproduce real corruption, not theoretical edge cases. What unblocked this was not a third attempt at an override but abandoning the override entirely, which is the bar any future change here should clear.

The panel's own "View as" menu is unaffected and still uses a real CDP override with a computed `scale` — it is a bounded visual preview with no capture attached, so it never meets either failure mode. See `apps/studio/src/electron-main/browser-view/device-emulation.ts`.
