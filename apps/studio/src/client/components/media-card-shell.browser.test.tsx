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

// Past the moment the overlay controls finish arriving and may be pressed.
const ARMED_MS = 800;

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
 * The delays exist so that arriving at a card and pressing in one motion opens
 * the card, rather than pressing whichever action happens to be materialising
 * under the cursor. Asserted with real input, because a dispatched `click`
 * skips hit-testing and hit-testing is the whole subject.
 *
 * Both waits are chosen to land well clear of the moment the controls arm, not
 * beside it: a `setTimeout` overruns by around 80ms here and the press itself
 * costs another 35, so a case aimed at the last 150ms of the window measures
 * the scheduler rather than the card. That is also why the back half of the
 * reveal has no case of its own -- there is no way to aim a press into it that
 * holds under load, and a case that cannot fail is worse than no case.
 */
describe("MediaCardShell before its controls are armed", () => {
  it.each([
    // Nothing has begun to arrive yet.
    { after: 60, when: "the controls have not appeared" },
    // The window the controls used to take the pointer in while still fully
    // transparent, which is what made a quick press open a file in its native
    // app instead of opening the card.
    { after: 330, when: "the controls are armed early but still invisible" },
  ])("opens the card when pressed while $when", async ({ after }) => {
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

    // Arrive at the card, then press where the action is about to be, the way a
    // pointer crossing the card in one motion does.
    await userEvent.hover(card);
    await wait(after);
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
    await wait(ARMED_MS);

    const download = container.querySelector("[data-testid='download']");
    const controlBox = download?.getBoundingClientRect();
    expect(controlBox).toBeTruthy();
    if (!controlBox) {
      return;
    }

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
    await wait(ARMED_MS);

    const download = container.querySelector("[data-testid='download']");
    expect(download).toBeTruthy();
    const box = download?.getBoundingClientRect();
    expect(box).toBeTruthy();
    if (!box) {
      return;
    }

    const hit = document.elementFromPoint(
      box.left + box.width / 2,
      box.top + box.height / 2,
    );
    expect(hit).toBe(download);
    expect(onClick).not.toHaveBeenCalled();
  });
});
