import { renderInBrowser } from "@/tests/render-browser";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { ImageViewer } from "./image-viewer";

const IMAGE_W = 2000;
const IMAGE_H = 1200;
const LARGE = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${IMAGE_W}" height="${IMAGE_H}"><rect width="100%" height="100%" fill="red"/></svg>`)}`;

function Viewer({ url = LARGE }: { url?: string }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  return (
    <div>
      <div data-testid="row" ref={setSlot} />
      <div data-testid="pane" style={{ height: 300, width: 400 }}>
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
    // An arrow while nothing can move, an open hand once something can.
    expect(globalThis.getComputedStyle(image).cursor).toBe("auto");

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
});
