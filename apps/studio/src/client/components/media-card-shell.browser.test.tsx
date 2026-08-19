import { renderInBrowser } from "@/tests/render-browser";
import { type TaskId } from "@instrument-org/workspace/client";
import { describe, expect, it, vi } from "vitest";

// Every assertion here is about what the pointer can reach, which is a question
// only the real stylesheet can answer: unstyled, none of these boxes overlap.
import { MediaCardShell } from "./media-card-shell";

const FILE = {
  filename: "clip.mp4",
  filePath: "/task/clip.mp4",
  mimeType: "video/mp4",
  modifiedAt: 0,
  taskId: "task_1" as TaskId,
  url: "blob:none",
};

async function renderCard(onClick: () => void) {
  const { container } = await renderInBrowser(
    <div style={{ width: 320 }}>
      <MediaCardShell
        file={FILE}
        onClick={onClick}
        overlayActions={
          <button data-testid="download" type="button">
            Download
          </button>
        }
      >
        <div data-testid="media" style={{ height: "100%", width: "100%" }} />
      </MediaCardShell>
    </div>,
  );

  const card = container.querySelector("[data-testid='media']")?.parentElement;
  const overlay = container
    .querySelector("[data-testid='download']")
    ?.closest("div");
  expect(card).toBeTruthy();
  expect(overlay).toBeTruthy();
  if (!card || !overlay) {
    throw new Error("card did not render");
  }

  card.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  card.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
  return { card, container, overlay };
}

function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Resolve once the overlay controls will answer the pointer.
 *
 * Polled rather than waited out. The controls arm on a timer 600ms after the
 * pointer arrives, and a fixed wait long enough to clear that on an idle
 * machine is not long enough on a busy one -- the timer slips, React re-renders
 * late, and a test that assumed it had happened fails for reasons that have
 * nothing to do with the card.
 */
async function waitUntilArmed(control: HTMLElement) {
  const start = performance.now();
  while (performance.now() - start < 5000) {
    if (globalThis.getComputedStyle(control).pointerEvents === "auto") {
      return;
    }
    await wait(20);
  }
  throw new Error("the overlay controls never armed");
}

/**
 * The delay these wait out exists so that arriving at a card and pressing in
 * one motion opens the card, rather than pressing whichever action happens to
 * be materializing under the cursor. The controls arm 600ms after the pointer
 * arrives, matching a reveal of 400ms of delay and 200ms of fade.
 *
 * That timing is not asserted here, and two attempts to assert it were removed
 * for failing under load in ways nobody has explained: one raced a press
 * against the 600ms window, and the one after it read the controls as armed far
 * earlier than the timer can fire, from a page whose state no test in this file
 * accounts for. What these cover instead is the consequence -- where a press
 * lands once the controls are armed -- which needs no clock.
 *
 * Note also what cannot be asserted: the browser project zeroes transition
 * durations (`tests/setup-browser.ts`), so the reveal is instant and the box
 * reads as fully opaque from its first frame. Nothing about the fade is
 * observable, and an assertion on opacity agrees with you whatever the code
 * does.
 */
describe("MediaCardShell overlay hit testing", () => {
  it("lets a press through the empty space beside the overlay controls", async () => {
    const onClick = vi.fn();
    const { container, overlay } = await renderCard(onClick);

    const download = container.querySelector<HTMLElement>(
      "[data-testid='download']",
    );
    if (!download) {
      throw new Error("card did not render");
    }
    await waitUntilArmed(download);
    const controlBox = download.getBoundingClientRect();

    // Just past the control's right edge, still well inside the box that spans
    // the card. The box must not answer here: the card's own open button must.
    const hit = document.elementFromPoint(
      controlBox.right + 10,
      controlBox.top + controlBox.height / 2,
    );
    expect(hit).not.toBe(overlay);
    expect(hit?.tagName).toBe("BUTTON");

    hit?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("still routes a press on an overlay control to that control", async () => {
    const onClick = vi.fn();
    const { container } = await renderCard(onClick);

    const download = container.querySelector<HTMLElement>(
      "[data-testid='download']",
    );
    if (!download) {
      throw new Error("card did not render");
    }
    await waitUntilArmed(download);
    const box = download.getBoundingClientRect();

    const hit = document.elementFromPoint(
      box.left + box.width / 2,
      box.top + box.height / 2,
    );
    expect(hit).toBe(download);
    expect(onClick).not.toHaveBeenCalled();
  });
});
