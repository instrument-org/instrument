import { renderInBrowser } from "@/tests/render-browser";
import { type TaskId } from "@instrument-org/workspace/client";
import { describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

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
 * The delays exist so that arriving at a card and pressing in one motion opens
 * the card, rather than pressing whichever action happens to be materialising
 * under the cursor.
 *
 * Note what cannot be asserted here: the browser project zeroes transition
 * durations (`tests/setup-browser.ts`), so the reveal is instant and the box
 * reads as fully opaque from the first frame. Nothing about the fade is
 * observable. What is observable is the moment the controls begin answering the
 * pointer, which a timer drives rather than CSS -- and that is the moment the
 * bug was in.
 */
describe("MediaCardShell before its controls are armed", () => {
  it("does not answer the pointer until the reveal has had time to finish", async () => {
    // The regression guard. Measuring when the controls arm, rather than aiming
    // a press at a moment, is what makes this robust: a busy scheduler can only
    // push that moment later, never earlier, so load makes it pass harder
    // instead of flaking. Aiming a press has the opposite property, which is
    // how the first version of this drifted into the armed window under a full
    // run.
    //
    // No real pointer either. `pointer-events` here follows React state, not
    // the CSS `:hover` the fade follows, so the dispatched enter that starts
    // the timer is the whole input this needs -- and a real one would carry the
    // previous test's cursor position into this one, since a file's tests share
    // a page.
    const onClick = vi.fn();
    const { container } = await renderCard(onClick);
    const download = container.querySelector<HTMLElement>(
      "[data-testid='download']",
    );
    if (!download) {
      throw new Error("card did not render");
    }

    const start = performance.now();
    let armedAfter: null | number = null;
    while (armedAfter === null && performance.now() - start < 2000) {
      if (globalThis.getComputedStyle(download).pointerEvents === "auto") {
        armedAfter = performance.now() - start;
      }
      await wait(20);
    }

    expect(armedAfter).not.toBeNull();
    // The reveal runs 400ms of delay then 200ms of fade. Anything under that is
    // a control taking presses aimed at the card behind it; the slack below is
    // only for the sampling interval.
    expect(armedAfter).toBeGreaterThan(500);
  });

  it("opens the card when pressed before anything has appeared", async () => {
    const onClick = vi.fn();
    const onOverlayClick = vi.fn();
    const { container } = await renderInBrowser(
      <div style={{ width: 320 }}>
        <MediaCardShell
          file={FILE}
          onClick={onClick}
          overlayActions={
            <button
              data-testid="download"
              onClick={onOverlayClick}
              type="button"
            >
              Download
            </button>
          }
        >
          <div data-testid="media" style={{ height: "100%", width: "100%" }} />
        </MediaCardShell>
      </div>,
    );

    const download = container.querySelector<HTMLElement>(
      "[data-testid='download']",
    );
    const card = container.querySelector<HTMLElement>(
      "[data-testid='media']",
    )?.parentElement;
    if (!download || !card) {
      throw new Error("card did not render");
    }

    // Arrive at the card and press where the action is about to be, the way a
    // pointer crossing the card in one motion does. End to end, through real
    // hit-testing, which is what a dispatched `click` would skip.
    await userEvent.hover(card);
    const box = download.getBoundingClientRect();
    await userEvent.click(document.body, {
      position: { x: box.left + box.width / 2, y: box.top + box.height / 2 },
    });

    expect(onOverlayClick).not.toHaveBeenCalled();
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

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
