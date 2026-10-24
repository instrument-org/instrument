import { renderInBrowser } from "@/tests/render-browser";
import { afterEach, beforeEach, expect, test } from "vitest";

import { FileThumbnail } from "./file-thumbnail";

/**
 * What a tile shows while its picture is on the way: the file's type, faded
 * in only once a picture has had a moment to arrive, and faded out as the
 * picture fades in. Opacity under a running animation is a question for a
 * real browser, so this lives here, with the setup's cut of every animation
 * and transition to zero lifted, since that timing is what is under test.
 */

let lifted: HTMLStyleElement[] = [];
beforeEach(() => {
  lifted = [...document.querySelectorAll("style")].filter((style) =>
    style.textContent.includes("animation-duration: 0s !important"),
  );
  for (const style of lifted) {
    style.disabled = true;
  }
});
afterEach(() => {
  for (const style of lifted) {
    style.disabled = false;
  }
});

// One white pixel, standing in for the picture the channel keeps of a file.
const PICTURE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";

/**
 * A tile, below the fold when `far`: the grid's pictures load lazily, so one
 * out of sight waits for its picture until it is scrolled to.
 */
function Tile({ far }: { far: boolean }) {
  return (
    <div style={{ paddingTop: far ? 20_000 : 0, width: 120 }}>
      <FileThumbnail
        file={{ name: "digest.docx", type: "" }}
        previewImageUrl={PICTURE}
        previewUnavailableContent={<span data-testid="type">DOCX</span>}
      />
    </div>
  );
}

/** The opacity the type's layer is drawn at, its own times its parent's. */
function typeOpacity() {
  const type = document.querySelector("[data-testid=type]");
  const inner = type?.parentElement;
  const outer = inner?.parentElement;
  if (!inner || !outer) {
    return undefined;
  }
  return (
    Number(getComputedStyle(outer).opacity) *
    Number(getComputedStyle(inner).opacity)
  );
}

test("shows the file's type once its picture has been a moment coming, and lets it go when the picture comes", async () => {
  await renderInBrowser(<Tile far />);

  // Nothing yet: a picture on hand would have arrived by now.
  expect(typeOpacity()).toBe(0);
  await expect.poll(typeOpacity, { timeout: 2000 }).toBe(1);

  document.querySelector("[data-testid=type]")?.scrollIntoView();
  await expect.poll(typeOpacity, { timeout: 2000 }).toBe(0);
  expect(document.querySelector("img")?.complete).toBe(true);
});

test("never shows the type for a picture that was on hand", async () => {
  await renderInBrowser(<Tile far={false} />);

  const seen: number[] = [];
  for (let at = 0; at < 8; at += 1) {
    seen.push(typeOpacity() ?? 0);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  expect(seen.every((opacity) => opacity === 0)).toBe(true);
});
