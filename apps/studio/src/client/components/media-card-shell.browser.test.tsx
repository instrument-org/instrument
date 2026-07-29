import { type TaskId } from "@instrument-org/workspace/client";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

// Every assertion here is about what the pointer can reach, which is a question
// only the real stylesheet can answer: unstyled, none of these boxes overlap.
import "../styles/globals.css";
import { MediaCardShell } from "./media-card-shell";
import { TooltipProvider } from "./ui/tooltip";

const FILE = {
  filename: "clip.mp4",
  filePath: "/task/clip.mp4",
  mimeType: "video/mp4",
  modifiedAt: 0,
  taskId: "task_1" as TaskId,
  url: "blob:none",
};

// Long enough to clear both INTERACTIVE_DELAY_MS and VISIBLE_DELAY_MS.
const ARMED_MS = 500;

async function renderCard(onClick: () => void) {
  const { container } = await render(
    // Radix throws without one, and a test rendering a single component is
    // the app root it is asking for.
    // eslint-disable-next-line no-restricted-syntax -- see above
    <TooltipProvider>
      <div style={{ width: 320 }}>
        <MediaCardShell
          aspectRatio="video"
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
      </div>
    </TooltipProvider>,
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

    hit?.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        pointerType: "mouse",
      }),
    );
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
