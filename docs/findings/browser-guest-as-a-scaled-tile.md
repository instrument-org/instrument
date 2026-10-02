# A browser guest can be shown as a scaled-down live tile

**Status:** verified, not built. Last updated 2026-09-21.

## Question

The 2.0 thread wants to show what the agent has open as small live pictures at the foot of the chat (a shelf of thumbnails), each a real rendering of the page shrunk to about 232 by 180, not a page reflowed into a 232px-wide viewport. Can a `<webview>` guest be drawn that way?

## Answer

Yes. The guest element keeps its logical size (the page lays out at, say, 732 by 759) and its container is set to the tile's size with `overflow: hidden`; the `<webview>` itself gets `transform: scale(<tile width / logical width>)` with `transform-origin: top left`. Chromium composites the guest's surface scaled, so the tile shows the page as it is, crisp at the display's device pixel ratio, scroll position and all, and keeps updating live.

Verified in a dev instance against a Wikipedia article in the classic task page's browser panel, by styling the pool's container and guest directly:

- The tile drew the full-width layout at 0.317 scale, readable, over the chat column.
- The guest's own viewport stayed 732 by 759 (`innerWidth`/`innerHeight` inside the page), so the page did not reflow.
- `webview.capturePage()` returned the full 1464 by 1518 image (2x), unaffected by the transform, so an agent's screenshots keep working while its tab is a tile.
- Scrolling the guest moved the picture.

The contrast case, sizing the element itself to 232 by 180, reflows the page to a phone layout and shows a crop of its corner, which is the thing the shelf must not do.

## What building it means

The pool ([`client/lib/browser-pool.ts`](../../apps/studio/src/client/lib/browser-pool.ts)) has two modes today, paint-host (parked, near-transparent, full size) and visible (over a slot, full size). A tile is a third: over a slot, scaled, `pointer-events: none`. The `transform`/`transformOrigin` fields the pool already clears on every show are where it goes. Because parked guests are painted anyway, showing several as tiles costs no extra rasterization; each tile is the guest's existing surface composited smaller.

Two things to keep in mind:

- `use-browser-slot` re-applies `showOverSlot` on every slot resize and window resize, so a tile has to be a mode the pool knows about, not styles laid over the visible mode; a style set from outside is reset by the next measure.
- The raster cap ([browser-guest-raster-cap](browser-guest-raster-cap.md)) still bounds the guest's logical size, so a tile of a guest the agent sized past the window is a tile of the cropped surface, as the panel is today.

Related: [in-app-browser](../architecture/in-app-browser.md), [in-app-browser-device-emulation](in-app-browser-device-emulation.md) (the panel's "View as" preview scales through a CDP emulation override instead; that route is for a bounded preview with input, not for a picture).
