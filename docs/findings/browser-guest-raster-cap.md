# In-app browser: the guest's rasterized surface is capped at 1.3x the window

**Status:** open — measured on macOS, Linux and Windows. Last updated 2026-08-26.

## The rule

A parked browser guest may be laid out larger than the Studio window that contains it, but only up to a point. Chromium rasterizes the guest's compositor surface to **1.3x the host window's content box, per axis**. Past that the surface stops growing while the layout viewport keeps going, so a capture returns a top-left-anchored crop of the page rather than the whole viewport.

```text
raster cap (per axis) = 1.3 x window content box
```

Measured against four window sizes on three platforms, all Electron 42.3.3 / Chromium 148:

| Platform | Window content (CSS) | dpr | Window (device) | Raster cap (device) | Ratio |
| --- | --- | --- | --- | --- | --- |
| macOS arm64 | 1440x1265 | 2 | 2880x2530 | 3746x3290 | 1.301 / 1.300 |
| macOS arm64 | 760x520 | 2 | 1520x1040 | 1978x1352 | 1.301 / 1.300 |
| Linux aarch64 | 1163x779 | 1 | 1163x779 | 1513x1013 | 1.301 / 1.300 |
| Windows x64 | 1444x923 | 1.5 | 2166x1385 | 2816x1801 | 1.300 / 1.301 |

The factor is multiplicative, not a fixed margin: the absolute headroom ranged from 234 to 866 device px across those rows while the ratio held at 1.300–1.301 in every axis of every row. Device pixel ratio does not enter into it; the same ratio appears at dpr 1, 1.5 and 2.

## Why this is worth writing down

**A guest larger than its window works.** This was the open question behind [in-app-browser-device-emulation](in-app-browser-device-emulation.md), and within the cap the answer is a clean yes. An 800x400 guest in a 760x520 window rasterizes completely, all four viewport corners present. The paint host is not confined to the window.

**The cap is invisible from inside the page and from CDP.** `window.innerWidth` / `innerHeight` and `Page.getLayoutMetrics`'s `cssLayoutViewport` and `cssVisualViewport` all report the **requested** size at every size tested, including sizes whose capture came back cropped. A 2000x600 guest in a 1163x779 window reports 2000x600 everywhere and captures at 1513x600. Nothing observable at the page or protocol level says the raster fell short.

That is the load-bearing consequence: a scheme that resizes the surface and then *waits for the layout viewport to catch up* before capturing cannot detect this. The layout viewport was never behind. Any implementation has to clamp against the window up front rather than verify after the fact.

**The failure is a crop, not corruption.** Past the cap the returned image contains the correct top-left region of the page and the page's own background beyond it. No tiling, no transparency, no dead space. This is a materially better failure mode than the one recorded in the device-emulation finding, and it is detectable by comparing the returned image size against the size requested.

**Both capture paths hit the same cap.** `Page.captureScreenshot` over the raw guest debugger and the same command through the agent-facing CDP gateway (which serves clip-less viewport captures from `webContents.capturePage`) returned byte-identical dimensions at every size on macOS. The gateway is not the limiting factor and does not soften the cap.

## What it means for parked-guest sizing

`applyPaintHost` in [browser-pool.ts](../../apps/studio/src/client/lib/browser-pool.ts) parks the guest at `lastVisibleBounds ?? BROWSER_GUEST_VIEWPORT` (1280x800). Against the rule above:

- 1280x800 needs a window of at least **985x616** CSS px to rasterize in full.
- The enforced window minimum is **720x480**, whose cap is **936x624**.

So a guest parked at the 1280x800 default in a window near its minimum is already cropped to 936x624 today, silently, with the page and CDP both reporting 1280x800. Reaching it takes a deliberately shrunken window, the same way the narrow-pane case takes a deliberately dragged pane, but nothing prevents it.

Any floor, and any agent-declared viewport, has to be clamped to the window rather than chosen in absolute pixels:

```text
surface = min(desired, 1.3 x window content box)   // per axis, with margin for rounding
```

The renderer already holds both numbers at the point where it applies the paint host, so the clamp costs a `Math.min` and no new plumbing. What it does not solve is what to tell the caller: an agent that asked for 1280x800 and got 936x624 should be told the effective size, because nothing else will tell it.

## Method

No product code was changed. Against a running Studio on each platform:

1. `workspace.browser.open` creates a target and the renderer pool mounts a guest. With no panel showing it, the guest sits in paint-host at the default size.
2. Paint a marker page into the guest over its own CDP target: `position: fixed` squares in the four viewport corners, distinct colors, on a flat background. Fixed positioning means they follow every resize without repainting.
3. For each test size, set `width` / `height` on the paint-host container and the `<webview>` from the renderer, settle, then read `Page.getLayoutMetrics` plus `Runtime.evaluate` of `innerWidth`/`innerHeight`, and capture with `Page.captureScreenshot`.
4. Compare the returned image dimensions against the requested size times dpr, and sample the four corner pixels. All four markers present means the surface rasterized in full; the background color where a marker should be means the raster was cropped there.

Sweeping one axis at a time with the other held small isolates the per-axis cap and rules out an area limit. Remote hosts were driven the same way over an SSH tunnel to their loopback CDP port, so the images were decoded on the driving machine and no toolchain was needed on the host.

## What might resolve it later

Nothing here needs resolving to be usable; the cap is generous relative to the sizes the product asks for at ordinary window sizes, and clamping to it is straightforward. What would change the picture is an Electron or Chromium capability to rasterize a guest surface larger than the compositor's window-derived budget, which is the same capability the sibling [full-page screenshot finding](in-app-browser-full-page-screenshots.md) is waiting on.

Re-measure when the Electron major changes. The ratio is a Chromium compositor heuristic, not a documented contract, and this finding records one Chromium version.
