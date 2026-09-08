import { zoomAtom } from "@/client/atoms/zoom";
import { ZoomRoot } from "@/client/components/zoom-root";
import { useWindowPointStyle } from "@/client/hooks/use-app-zoom";
import { renderInBrowser } from "@/tests/render-browser";
import { createStore } from "jotai";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";

// A press hands over where it happened in window coordinates, and the menu it
// opens is drawn inside the zoomed window, where a length is in the units the UI
// is laid out in. Reading one as the other is exact at the 1x default and puts
// the menu half a window from the pointer at 2x, so this presses a real button
// at a real place and asks where the marker landed.

/** A button somewhere other than the corner, and a marker put where it was pressed. */
function PressAndMark() {
  const [at, setAt] = useState<{ x: number; y: number }>();
  const markStyle = useWindowPointStyle(at ?? { x: 0, y: 0 });

  return (
    <ZoomRoot>
      <div style={{ paddingLeft: 100, paddingTop: 60 }}>
        <button
          onClick={(event) => {
            setAt({ x: event.clientX, y: event.clientY });
          }}
          type="button"
        >
          Open
        </button>
      </div>
      {at && (
        <span
          data-testid="mark"
          style={{ height: 1, position: "fixed", width: 1, ...markStyle }}
        />
      )}
    </ZoomRoot>
  );
}

function storeAtZoom(zoom: number) {
  const store = createStore();
  store.set(zoomAtom, zoom);
  return store;
}

describe("placing content where the pointer is", () => {
  it.each([1, 2])("marks the press at %sx zoom", async (zoom) => {
    await renderInBrowser(<PressAndMark />, { store: storeAtZoom(zoom) });

    const button = page.getByRole("button", { name: "Open" });
    const box = button.element().getBoundingClientRect();
    await button.click();

    const mark = page.getByTestId("mark");
    await expect.element(mark).toBeInTheDocument();
    // A locator presses the center of what it is given, and lands on a whole
    // device pixel, so the mark sits within one of that center. An uncorrected
    // point is out by the press's own distance from the corner: a whole button
    // at 2x, and a whole window for a press near the far edge.
    const pressed = mark.element().getBoundingClientRect();
    const off = Math.hypot(
      pressed.left - (box.left + box.width / 2),
      pressed.top - (box.top + box.height / 2),
    );
    expect(off).toBeLessThan(2);
  });
});
