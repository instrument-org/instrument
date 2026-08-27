# In-app browser: the guest's rasterized surface is capped at 1.3x the viewport

**Status:** open — mechanism traced to Blink source, bound confirmed on macOS, Linux and Windows. Last updated 2026-08-26.

## The rule

A parked browser guest may be laid out larger than the window that contains it, but only up to a point. Blink rasterizes it only within its **compositing rect**, and past that a capture returns a top-left-anchored crop while the page keeps reporting the size it was laid out at.

```text
cap (per axis) = v + 2 * ceil(0.15 * v)      where v = the embedder's viewport
```

which is never below `1.3 * v`, so `floor(1.3 * v)` is a safe clamp with room for device-pixel rounding.

The `v` is **this renderer's viewport** (`window.innerWidth` / `innerHeight`), not the OS window and not the display. That is not an assumption: shrinking only the renderer's viewport through `Emulation.setDeviceMetricsOverride` on the embedder, with the OS window untouched at 1440 CSS px, moved the cap from 3746 to 1822 device px and back when cleared — 1.3x the emulated viewport each time.

## Where the number comes from

`RemoteFrameView::ComputeCompositingRect()` in `third_party/blink/renderer/core/frame/remote_frame_view.cc`. A `<webview>` guest is an inner WebContents, which the embedder sees as a remote frame, so this is the code that decides how much of it gets rastered:

```cpp
// Iframes that fit within the window viewport get fully rastered. For
// iframes that are larger than the window viewport, add a 30% buffer to the
// draw area to try to prevent guttering during scroll.
// TODO(kenrb): The 30% value is arbitrary, it gives 15% overdraw in both
// directions when the iframe extends beyond both edges of the viewport, and
// it seems to make guttering rare with slow to medium speed wheel scrolling.
compositing_rect.Outset(
    gfx::Outsets::VH(ceilf(local_viewport_rect.Height() * 0.15f),
                     ceilf(local_viewport_rect.Width() * 0.15f)));
compositing_rect.set_width(std::min(frame_size.width(), compositing_rect.width()));
compositing_rect.set_height(std::min(frame_size.height(), compositing_rect.height()));
```

The rect starts as the local root frame view's size — the embedder's viewport — is outset by 15% of it on each side, then clamped to the frame's own size. 15% on both sides is where 1.3 comes from, and the first line of that comment is the other half of the rule: **a guest that fits inside the viewport is always fully rastered**, which is why a guest sized to a panel is never at risk.

Two things follow that matter more than the number. The 30% is documented upstream as arbitrary and carries an open TODO, so it is a value to re-measure on a Chromium bump rather than a contract. And because the outset is `ceilf` per side, the true cap is always at or just above `1.3v`, never below — which is what makes flooring safe rather than lucky.

## Measurements

Taken before the source was found, by setting the guest element to a series of sizes and comparing the returned capture against what was asked for. All Electron 42.3.3 / Chromium 148.

| Platform | Viewport (CSS) | dpr | Predicted `v + 2*ceil(0.15v)` | Measured cap (CSS) |
| --- | --- | --- | --- | --- |
| macOS arm64 | 1440 x 1265 | 2 | 1872 x 1645 | 1873 x 1645 |
| macOS arm64 | 760 x 520 | 2 | 988 x 676 | 989 x 676 |
| macOS arm64 (emulated) | 700 | 2 | 910 | 911 |
| Linux aarch64 | 1163 x 779 | 1 | 1513 x 1013 | 1513 x 1013 |
| Windows x64 | 1444 x 923 | 1.5 | 1878 x 1201 | 1877.3 x 1200.7 |

Exact on four axes, within one CSS pixel on the rest — the residual is enclosing-rect and device-pixel rounding between Blink's layout units and the captured bitmap. Sweeping one axis with the other held small confirmed it binds per axis rather than by area.

## Why it is worth writing down

**The cap is invisible from inside the page and from CDP.** `window.innerWidth`/`innerHeight` and `Page.getLayoutMetrics`'s `cssLayoutViewport` and `cssVisualViewport` all report the size the guest was laid out at, including when the capture came back cropped. A 2000x600 guest in a 1163-wide viewport reports 2000x600 everywhere and captures at 1513x600.

That is the load-bearing consequence: a scheme that resizes and then waits for the layout viewport to catch up before capturing cannot detect this, because the layout viewport was never behind. Clamping has to happen up front, against the viewport.

**The failure is a crop, not corruption.** Past the cap the image holds the correct top-left region and the page's own background beyond it. No tiling, no transparency. Detectable by comparing the returned size against the size requested.

**Both capture paths hit the same cap.** `Page.captureScreenshot` over the raw guest debugger and the same command through the agent-facing CDP gateway (which serves clip-less viewport captures from `webContents.capturePage`) returned identical dimensions at every size.

## What it means for guest sizing

[`browser-pool.ts`](../../apps/studio/src/client/lib/browser-pool.ts) clamps every parked guest to `floor(1.3 * innerWidth/innerHeight)`, and re-clamps on window resize. An agent asking for a viewport past that budget is refused with the maximum rather than clamped, since a clamped guest still reports the size it was asked for and its captures would disagree with it — see [in-app-browser-device-emulation](in-app-browser-device-emulation.md).

Worth keeping in view: the enforced window minimum is 720x480, whose budget is 936x624. The paint-host default of 1280x800 sat over that budget before the clamp existed.

## One unreproduced failure

During this work, a guest that had been driven through repeated oversized captures stopped accepting a resize (`set viewport` reported success, the page stayed at its old size) and its next capture failed with `UnknownVizError`. Three targeted attempts to reproduce it — emulating and clearing the embedder viewport, forcing the element far past the cap, and capturing repeatedly at 6000px — each failed to trigger it on a fresh instance.

So it is recorded rather than explained. Every path that reached it went through raw CDP writes the product cannot make: the clamp keeps the element under the cap and the refusal keeps an agent from asking for more. If a stuck guest with `UnknownVizError` ever shows up in the wild, this is the note to start from.

## Method

No product code was changed to measure this. Against a running Studio on each platform:

1. `workspace.browser.open` creates a target and the renderer pool mounts a guest. With no panel showing it, the guest sits in paint-host.
2. Paint a marker page into the guest over its own CDP target: `position: fixed` squares in the four viewport corners on a flat background, so they follow every resize without repainting.
3. For each size, set `width`/`height` on the paint-host container and the `<webview>` from the renderer, settle, then read `Page.getLayoutMetrics` and `innerWidth`/`innerHeight`, and capture.
4. Compare returned image dimensions against the requested size times dpr, and sample the four corners. All four markers means the surface rasterized in full; the background color where a marker should be means it was cropped there.

Remote hosts were driven the same way over an SSH tunnel to their loopback CDP port, so images were decoded on the driving machine and no toolchain was needed on the host.
