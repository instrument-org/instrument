import { renderInBrowser } from "@/tests/render-browser";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  pictureHoldingKeyboard,
  runPictureChord,
} from "@/client/lib/picture-keys";

import { ImageViewer } from "./image-viewer";

const IMAGE_W = 2000;
const IMAGE_H = 1200;
const LARGE = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${IMAGE_W}" height="${IMAGE_H}"><rect width="100%" height="100%" fill="red"/></svg>`)}`;

function Viewer({
  height = 300,
  url = LARGE,
  width = 400,
}: {
  height?: number;
  url?: string;
  width?: number;
}) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  return (
    <div>
      <div data-testid="row" ref={setSlot} />
      <div data-testid="pane" style={{ height, width }}>
        <ImageViewer
          controlsInto={slot}
          file={{ filename: "large.svg", url }}
          onError={() => {
            throw new Error("the image should load");
          }}
        />
      </div>
    </div>
  );
}

function wheel(target: Element, init: WheelEventInit) {
  target.dispatchEvent(
    new WheelEvent("wheel", { bubbles: true, cancelable: true, ...init }),
  );
}

const transformOf = (image: Element) =>
  image.parentElement?.style.transform ?? "";
const scaleOf = (image: Element) =>
  Number(/scale\(([\d.]+)\)/.exec(transformOf(image))?.[1] ?? 1);

describe("ImageViewer", () => {
  it("puts its zoom in the row and nothing over the picture", async () => {
    const screen = await renderInBrowser(<Viewer />);
    const trigger = screen.getByRole("button", { name: "Zoom: Fit" });
    await expect.element(trigger).toBeVisible();
    expect(
      screen.getByTestId("row").element().contains(trigger.element()),
    ).toBe(true);
    expect(
      screen.getByTestId("pane").element().querySelector("button"),
    ).toBeNull();
  });

  it("offers Actual size again when the file comes back larger", async () => {
    const small = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="100%" height="100%" fill="red"/></svg>`)}`;
    const screen = await renderInBrowser(<Viewer url={small} />);
    const trigger = screen.getByRole("button", { name: "Zoom: Fit" });
    await expect.element(trigger).toBeVisible();

    await trigger.click();
    await expect
      .element(screen.getByRole("menuitemcheckbox", { name: "Actual size" }))
      .toHaveAttribute("aria-disabled", "true");
    await screen.rerender(<Viewer url={LARGE} />);
    await expect
      .element(screen.getByRole("menuitemcheckbox", { name: "Actual size" }))
      .not.toHaveAttribute("aria-disabled", "true");
  });

  it("zooms on a pinch and moves on a scroll, stopping at the picture's edge", async () => {
    const screen = await renderInBrowser(<Viewer />);
    await expect
      .element(screen.getByRole("button", { name: "Zoom: Fit" }))
      .toBeVisible();
    const image = screen.getByRole("img").element();

    // At fit there is nowhere to move, so a scroll leaves the picture alone.
    wheel(image, { deltaY: 100 });
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    expect(scaleOf(image)).toBe(1);
    // A magnifier while a click would zoom in, an open hand once it can move.
    expect(globalThis.getComputedStyle(image).cursor).toBe("zoom-in");

    wheel(image, { ctrlKey: true, deltaY: -400 });
    await vi.waitFor(() => {
      expect(scaleOf(image)).toBeGreaterThan(1.5);
    });
    const zoomed = scaleOf(image);
    await vi.waitFor(() => {
      expect(globalThis.getComputedStyle(image).cursor).toBe("grab");
    });
    await expect
      .element(screen.getByRole("button", { name: /^Zoom: \d+%$/ }))
      .toBeVisible();

    const before = transformOf(image);
    wheel(image, { deltaX: 40, deltaY: 30 });
    await vi.waitFor(() => {
      expect(transformOf(image)).not.toBe(before);
    });
    expect(scaleOf(image)).toBe(zoomed);

    // Far past the edge: the picture stops with its corner on the viewport's.
    wheel(image, { deltaX: 100_000, deltaY: 100_000 });
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    const box = image.getBoundingClientRect();
    const view = screen.getByTestId("pane").element().getBoundingClientRect();
    expect(box.right).toBeGreaterThanOrEqual(view.right - 1);
    expect(box.bottom).toBeGreaterThanOrEqual(view.bottom - 1);
  });

  describe("once zoomed", () => {
    const zoomedIn = async (props: { width?: number } = {}) => {
      const screen = await renderInBrowser(<Viewer {...props} />);
      await expect
        .element(screen.getByRole("button", { name: "Zoom: Fit" }))
        .toBeVisible();
      const image = screen.getByRole("img").element();
      const pane = image.closest("[data-picture-keys]");
      if (!(pane instanceof HTMLElement)) {
        throw new Error("the picture should be in a pane");
      }
      wheel(image, { clientX: 20, clientY: 20, ctrlKey: true, deltaY: -600 });
      await vi.waitFor(() => {
        expect(scaleOf(image)).toBeGreaterThan(2);
      });
      return { image, pane, screen };
    };
    const expectOnEdges = (image: Element, pane: Element) => {
      const box = image.getBoundingClientRect();
      const view = pane.getBoundingClientRect();
      if (box.width >= view.width) {
        expect(box.left).toBeLessThanOrEqual(view.left + 1);
        expect(box.right).toBeGreaterThanOrEqual(view.right - 1);
      }
      if (box.height >= view.height) {
        expect(box.top).toBeLessThanOrEqual(view.top + 1);
        expect(box.bottom).toBeGreaterThanOrEqual(view.bottom - 1);
      }
    };
    const press = (
      target: Element,
      type: string,
      clientX: number,
      clientY: number,
    ) => {
      target.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          button: 0,
          cancelable: true,
          clientX,
          clientY,
          pointerId: 1,
        }),
      );
    };

    it("stops a drag at the picture's edge", async () => {
      const { image, pane } = await zoomedIn();
      press(image, "pointerdown", 100, 100);
      press(window.document.body, "pointermove", 3000, 3000);
      press(window.document.body, "pointerup", 3000, 3000);
      expectOnEdges(image, pane);
      const before = transformOf(image);
      press(image, "pointermove", 0, 0);
      expect(transformOf(image)).toBe(before);
    });

    it("keeps the picture on its edges zooming out somewhere else", async () => {
      const { image, pane } = await zoomedIn();
      const rect = pane.getBoundingClientRect();
      wheel(image, {
        clientX: rect.right - 5,
        clientY: rect.bottom - 5,
        ctrlKey: true,
        deltaY: 250,
      });
      await vi.waitFor(() => {
        expect(scaleOf(image)).toBeLessThan(2);
      });
      expectOnEdges(image, pane);
    });

    it("keeps its size on screen and its place when the pane resizes", async () => {
      const { image, screen } = await zoomedIn();
      const width = image.getBoundingClientRect().width;
      const word = screen.getByRole("button", { name: /^Zoom: \d+%$/ });
      const label = word.element().getAttribute("aria-label");
      await screen.rerender(<Viewer width={300} />);
      await vi.waitFor(() => {
        expect(image.clientWidth).toBeLessThan(352);
      });
      await vi.waitFor(() => {
        expect(image.getBoundingClientRect().width).toBeCloseTo(width, 0);
      });
      await expect.element(word).toHaveAttribute("aria-label", label);
    });

    it("moves with the arrows only while the picture has the keyboard", async () => {
      const { image, pane } = await zoomedIn();
      const arrow = () => {
        const event = new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "ArrowRight",
        });
        (document.activeElement ?? document.body).dispatchEvent(event);
        return event;
      };
      const before = transformOf(image);
      expect(arrow().defaultPrevented).toBe(false);
      expect(transformOf(image)).toBe(before);

      pane.focus();
      expect(arrow().defaultPrevented).toBe(true);
      expect(transformOf(image)).not.toBe(before);
    });
  });

  // A width held for the longest reading left a gap between the glass and
  // "Fit", and a shorter, differently styled button than the row's others.
  it("sizes the zoom button to its reading at the row's button height", async () => {
    const screen = await renderInBrowser(<Viewer />);
    const fit = screen.getByRole("button", { name: "Zoom: Fit" });
    await expect.element(fit).toBeVisible();
    const atFit = fit.element().getBoundingClientRect();
    const image = screen.getByRole("img").element();

    wheel(image, { ctrlKey: true, deltaY: -600 });
    const zoomed = screen.getByRole("button", { name: /^Zoom: \d+%$/ });
    await expect.element(zoomed).toBeVisible();
    expect(zoomed.element().getBoundingClientRect().width).toBeGreaterThan(
      atFit.width,
    );
    expect(atFit.height).toBe(32);
  });

  it("answers the zoom chords only while it has the keyboard", async () => {
    const screen = await renderInBrowser(<Viewer />);
    await expect
      .element(screen.getByRole("button", { name: "Zoom: Fit" }))
      .toBeVisible();
    const image = screen.getByRole("img").element();
    expect(runPictureChord("zoomIn")).toBe(false);
    expect(scaleOf(image)).toBe(1);

    wheel(image, { ctrlKey: true, deltaY: 1 });
    image.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
    );
    expect(pictureHoldingKeyboard()).not.toBeNull();
    expect(runPictureChord("zoomIn")).toBe(true);
    expect(scaleOf(image)).toBeGreaterThan(1);
    expect(runPictureChord("zoomReset")).toBe(true);
    expect(scaleOf(image)).toBe(1);
  });

  it("answers the zoom chords from a panel holding the keyboard", async () => {
    const screen = await renderInBrowser(
      <div data-testid="panel" role="dialog" tabIndex={-1}>
        <Viewer />
      </div>,
    );
    await expect
      .element(screen.getByRole("button", { name: "Zoom: Fit" }))
      .toBeVisible();
    const panel = screen.getByTestId("panel").element();
    if (panel instanceof HTMLElement) {
      panel.focus();
    }
    expect(runPictureChord("zoomIn")).toBe(true);
  });

  it("leaves a press alone while the picture has nowhere to move", async () => {
    const screen = await renderInBrowser(<Viewer />);
    await expect
      .element(screen.getByRole("button", { name: "Zoom: Fit" }))
      .toBeVisible();
    const event = new PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
      cancelable: true,
    });
    screen.getByRole("img").element().dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  describe("by a click, as a browser shows a picture", () => {
    const SMALL = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="100%" height="100%" fill="red"/></svg>`)}`;

    const atFit = async (url?: string) => {
      const screen = await renderInBrowser(
        <Viewer {...(url ? { url } : {})} />,
      );
      await expect
        .element(screen.getByRole("button", { name: "Zoom: Fit" }))
        .toBeVisible();
      const image = screen.getByRole("img").element();
      const pane = image.closest("[data-picture-keys]");
      if (!(pane instanceof HTMLElement)) {
        throw new Error("the picture should be in a pane");
      }
      return { image, pane, screen };
    };
    const cursorOf = (element: Element) =>
      globalThis.getComputedStyle(element).cursor;
    /** A press at a point, moved by `by`, let go, and the click the browser sends after it. */
    const press = (
      target: Element,
      at: { x: number; y: number },
      by = { x: 0, y: 0 },
    ) => {
      const point = (x: number, y: number) => ({
        bubbles: true,
        button: 0,
        cancelable: true,
        clientX: x,
        clientY: y,
      });
      target.dispatchEvent(new PointerEvent("pointerdown", point(at.x, at.y)));
      if (by.x !== 0 || by.y !== 0) {
        window.dispatchEvent(
          new PointerEvent("pointermove", point(at.x + by.x, at.y + by.y)),
        );
      }
      window.dispatchEvent(
        new PointerEvent("pointerup", point(at.x + by.x, at.y + by.y)),
      );
      target.dispatchEvent(
        new MouseEvent("click", point(at.x + by.x, at.y + by.y)),
      );
    };
    /** Where a point falls across the picture, as fractions of its box. */
    const spotOf = (image: Element, x: number, y: number) => {
      const box = image.getBoundingClientRect();
      return {
        x: (x - box.left) / box.width,
        y: (y - box.top) / box.height,
      };
    };
    const settled = async (image: Element) => {
      let last = "";
      await vi.waitFor(() => {
        const now = JSON.stringify(image.getBoundingClientRect());
        const same = now === last;
        last = now;
        expect(same).toBe(true);
      });
    };

    it("shows the zoom-in cursor on a picture larger than its pane", async () => {
      const { image } = await atFit();
      expect(cursorOf(image)).toBe("zoom-in");
    });

    it("leaves a picture that fits at its actual size without one", async () => {
      const { image } = await atFit(SMALL);
      expect(cursorOf(image)).toBe("auto");
      const box = image.getBoundingClientRect();
      press(image, { x: box.left + 5, y: box.top + 5 });
      await new Promise(requestAnimationFrame);
      expect(scaleOf(image)).toBe(1);
    });

    it("zooms in at the spot clicked, then fits again on the next click", async () => {
      const { image, pane } = await atFit();
      const box = image.getBoundingClientRect();
      const at = {
        x: box.left + box.width * 0.25,
        y: box.top + box.height * 0.3,
      };
      const before = spotOf(image, at.x, at.y);

      press(image, at);
      await vi.waitFor(() => {
        expect(scaleOf(image)).toBeGreaterThan(2);
      });
      await settled(image);
      const after = spotOf(image, at.x, at.y);
      expect(after.x).toBeCloseTo(before.x, 2);
      expect(after.y).toBeCloseTo(before.y, 2);
      expect(cursorOf(pane)).toBe("grab");

      press(image, at);
      await vi.waitFor(() => {
        expect(scaleOf(image)).toBe(1);
      });
      expect(cursorOf(image)).toBe("zoom-in");
    });

    it("moves a zoomed picture on a drag and leaves its zoom alone", async () => {
      const { image } = await atFit();
      const box = image.getBoundingClientRect();
      const at = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
      press(image, at);
      await vi.waitFor(() => {
        expect(scaleOf(image)).toBeGreaterThan(2);
      });
      await settled(image);
      const zoomed = scaleOf(image);
      const was = transformOf(image);

      press(image, at, { x: 60, y: 40 });
      await new Promise(requestAnimationFrame);
      expect(scaleOf(image)).toBe(zoomed);
      expect(transformOf(image)).not.toBe(was);
    });

    it("takes a drag at Fit for no click", async () => {
      const { image } = await atFit();
      const box = image.getBoundingClientRect();
      press(image, { x: box.left + 20, y: box.top + 20 }, { x: 30, y: 0 });
      await new Promise(requestAnimationFrame);
      expect(scaleOf(image)).toBe(1);
    });
  });
});
