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

/** Where each toast currently sits, as a comparable string. */
function positions() {
  return [...document.querySelectorAll("[data-sonner-toast]")]
    .map((node) => {
      const rect = node.getBoundingClientRect();
      return `${Math.round(rect.top)}:${Math.round(rect.bottom)}`;
    })
    .sort()
    .join(",");
}

async function stackToasts(zoom: number) {
  await render(
    <div style={{ zoom }}>
      <Toaster duration={Infinity} expand gap={GAP} position="top-center" />
    </div>,
  );

  for (let index = 0; index < TOAST_COUNT; index++) {
    toast.success(`Toast ${index + 1}`);
  }

  await expect
    .poll(() => document.querySelectorAll("[data-sonner-toast]").length, {
      timeout: 2000,
    })
    .toBe(TOAST_COUNT);

  // Sonner moves each toast into place with a transform, so the rects are worth
  // reading only once they have stopped changing. Waited out by watching them
  // rather than by sleeping for the transition's declared length: the browser
  // project zeroes transition durations, so that sleep was 600ms of nothing on
  // every case, and reading the positions answers the question whether or not
  // that stays true.
  let previous = "";
  await expect
    .poll(
      () => {
        const current = positions();
        const settled = current === previous;
        previous = current;
        return settled;
      },
      { timeout: 2000 },
    )
    .toBe(true);

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
