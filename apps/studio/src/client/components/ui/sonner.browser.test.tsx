import { toast, Toaster } from "sonner";
import { afterEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

// The app zooms its whole UI with CSS `zoom` on `ZoomRoot`, and the Toaster
// renders inside it. Sonner measures each toast with `getBoundingClientRect()`
// (on-screen px) and spends the result on `--offset`, a `translateY` resolved in
// layout px, so an unpatched build spaces a stack out by the zoom factor: gaps
// stretch above 1x and toasts overlap below it. See
// `patches/sonner@2.0.7.patch` and
// `docs/findings/css-zoom-rect-vs-layout-px.md`.
//
// Only a real browser can answer this. jsdom has no layout engine, so every
// height it reports is 0 and the spacing is identical whether the patch is
// applied or not.

const GAP = 14;
const TOAST_COUNT = 3;

async function stackToasts(zoom: number) {
  await render(
    <div style={{ zoom }}>
      <Toaster duration={Infinity} expand gap={GAP} position="top-center" />
    </div>,
  );

  for (let index = 0; index < TOAST_COUNT; index++) {
    toast.success(`Toast ${index + 1}`);
  }

  // Toasts settle into place over sonner's 400ms transform transition.
  await expect
    .poll(() => document.querySelectorAll("[data-sonner-toast]").length, {
      timeout: 2000,
    })
    .toBe(TOAST_COUNT);
  await new Promise((resolve) => setTimeout(resolve, 600));

  return [...document.querySelectorAll("[data-sonner-toast]")]
    .map((node) => node.getBoundingClientRect())
    .sort((a, b) => a.top - b.top);
}

afterEach(() => {
  toast.dismiss();
});

describe("Toaster under app zoom", () => {
  // Rects are on-screen px on both sides of the subtraction, so an expanded
  // stack should show exactly the configured gap scaled by the zoom -- one gap
  // in the units the user sees it in, at every zoom level.
  it.each([0.5, 1, 2])(
    "spaces an expanded stack by the gap at %sx",
    async (zoom) => {
      const rects = await stackToasts(zoom);

      for (const [index, rect] of rects.entries()) {
        const previous = rects[index - 1];
        if (previous) {
          expect(rect.top - previous.bottom).toBeCloseTo(GAP * zoom, 0);
        }
      }
    },
  );
});
