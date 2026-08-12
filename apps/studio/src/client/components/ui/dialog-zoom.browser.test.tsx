import { ZOOM_MAX, zoomAtom } from "@/client/atoms/zoom";
import { renderInBrowser } from "@/tests/render-browser";
import { createStore } from "jotai";
import { describe, expect, it } from "vitest";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
} from "./alert-dialog";
import { Dialog, DialogContent, DialogTitle } from "./dialog";

// A dialog is portalled outside the zoomed app root and self-applies `zoom`, so
// it is the one place in the app where an element's own size and the window it
// has to fit inside are measured in different units. Getting that backwards is
// invisible at the 1x default -- the dialog is smaller than the window anyway --
// and only puts content off-screen once someone zooms in, which is why every
// case here runs at more than one zoom level.
//
// `getBoundingClientRect()` is on-screen px, the same units `innerWidth` and
// `innerHeight` are in, so the two are directly comparable. `offsetWidth` is
// not: it is layout px, and an assertion written with it reads as passing at
// every zoom whether the dialog fits or not.

const ZOOMS = [1, 1.5, ZOOM_MAX] as const;

// Wider and taller than the 1280x900 test window once zoomed: the point is a
// dialog asking for more room than it can have.
const OVERSIZED = "60rem";

function rectOf(screen: { container: Element }, slot: string) {
  const content = screen.container.ownerDocument.querySelector(
    `[data-slot='${slot}']`,
  );
  if (!content) {
    throw new Error(`no [data-slot='${slot}'] in the document`);
  }
  return content.getBoundingClientRect();
}

function renderAtZoom(ui: React.ReactNode, zoom: number) {
  const store = createStore();
  store.set(zoomAtom, zoom);
  return renderInBrowser(ui, { store });
}

describe("dialog sizing under zoom", () => {
  it.each(ZOOMS)("keeps an oversized dialog on screen at %sx", async (zoom) => {
    const screen = await renderAtZoom(
      <Dialog open>
        <DialogContent
          aria-describedby={undefined}
          maxHeight={OVERSIZED}
          maxWidth={OVERSIZED}
        >
          <DialogTitle>Oversized</DialogTitle>
          <div style={{ height: 4000 }} />
        </DialogContent>
      </Dialog>,
      zoom,
    );

    const rect = rectOf(screen, "dialog-content");
    expect({
      fitsHeight: Math.round(rect.height) <= globalThis.innerHeight,
      fitsWidth: Math.round(rect.width) <= globalThis.innerWidth,
    }).toEqual({ fitsHeight: true, fitsWidth: true });
  });

  it.each(ZOOMS)(
    "keeps an oversized alert dialog on screen at %sx",
    async (zoom) => {
      const screen = await renderAtZoom(
        <AlertDialog open>
          <AlertDialogContent
            aria-describedby={undefined}
            maxHeight={OVERSIZED}
            maxWidth={OVERSIZED}
          >
            <AlertDialogTitle>Oversized</AlertDialogTitle>
            <div style={{ height: 4000 }} />
          </AlertDialogContent>
        </AlertDialog>,
        zoom,
      );

      const rect = rectOf(screen, "alert-dialog-content");
      expect({
        fitsHeight: Math.round(rect.height) <= globalThis.innerHeight,
        fitsWidth: Math.round(rect.width) <= globalThis.innerWidth,
      }).toEqual({ fitsHeight: true, fitsWidth: true });
    },
  );

  // The other half of the contract. An intrinsic size is room the content
  // needs, so it has to grow on screen with the text inside it rather than stay
  // pinned at the same rendered size. Dividing an intrinsic size by the zoom
  // factor -- the mistake that reads as "compensating for zoom" -- passes the
  // cases above while failing this one.
  it.each([
    [1, 320],
    [2, 640],
  ])("renders a 20rem dialog at %sx as %spx", async (zoom, expected) => {
    const screen = await renderAtZoom(
      <Dialog open>
        <DialogContent aria-describedby={undefined} maxWidth="20rem">
          <DialogTitle>Roomy</DialogTitle>
        </DialogContent>
      </Dialog>,
      zoom,
    );

    expect(rectOf(screen, "dialog-content").width).toBe(expected);
  });
});
