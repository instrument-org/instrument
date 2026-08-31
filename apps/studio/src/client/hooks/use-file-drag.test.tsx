import { useFileDrag } from "@/client/hooks/use-file-drag";
import { renderWithProviders } from "@/tests/render";
import { TaskIdSchema } from "@instrument-org/workspace/client";
import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

// Preparing a drag asks the main process to resolve the file. Nothing here is
// about that round trip, and a rendering surface must not make one.
vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    utils: {
      prepareTaskFileDrag: { call: vi.fn(() => Promise.resolve()) },
    },
  },
}));

const TASK_ID = TaskIdSchema.parse("a-task");

/**
 * The shape every draggable file surface has: the drag props on the box, and
 * something inside it that opens the file when clicked.
 */
function Card({ onOpen }: { onOpen: () => void }) {
  const dragProps = useFileDrag({ filePath: "output/a.png", taskId: TASK_ID });

  return (
    <div {...dragProps}>
      <button onClick={onOpen} type="button">
        Open a.png
      </button>
    </div>
  );
}

/** The bridge the shared preload stub leaves off, since it is Electron-only. */
function installFileDragBridge() {
  const api = window.api;
  const startFileDrag = vi.fn();
  Object.defineProperty(window, "api", {
    configurable: true,
    value: { ...api, startFileDrag },
  });
  onTestFinished(() => {
    Object.defineProperty(window, "api", { configurable: true, value: api });
  });
  return startFileDrag;
}

let startFileDrag: ReturnType<typeof installFileDragBridge>;
let onOpen: ReturnType<typeof vi.fn<() => void>>;

function press(target: Element) {
  fireEvent.pointerDown(target, { clientX: 0, clientY: 0 });
  // Blink decides a press is a drag at a threshold of its own, a few pixels in
  // and well before ours.
  fireEvent.dragStart(target);
}

beforeEach(() => {
  startFileDrag = installFileDragBridge();
  onOpen = vi.fn<() => void>();
});

function drawCard() {
  renderWithProviders(<Card onOpen={onOpen} />);
  return screen.getByRole("button", { name: "Open a.png" });
}

describe("the distance a press has to travel", () => {
  it("leaves a click that drifted a few pixels as a click", () => {
    const button = drawCard();

    press(button);
    fireEvent.pointerMove(window, { clientX: 6, clientY: 4 });
    fireEvent.pointerUp(window);
    fireEvent.click(button);

    expect(startFileDrag).not.toHaveBeenCalled();
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("hands the file over once the pointer means it", () => {
    const button = drawCard();

    press(button);
    fireEvent.pointerMove(window, { clientX: 40, clientY: 30 });

    expect(startFileDrag).toHaveBeenCalledTimes(1);
    expect(startFileDrag).toHaveBeenCalledWith([
      { filePath: "output/a.png", taskId: TASK_ID },
    ]);
  });

  it("never starts a drag from a press Blink did not read as one", () => {
    const button = drawCard();

    // No dragstart: a press on a text selection, or a non-primary button.
    fireEvent.pointerDown(button, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 200, clientY: 200 });

    expect(startFileDrag).not.toHaveBeenCalled();
  });
});

describe("the click after a gesture", () => {
  it("does not open the file the drag came from", () => {
    const button = drawCard();

    press(button);
    fireEvent.pointerMove(window, { clientX: 40, clientY: 30 });
    // Dropping the file back on the card it came from. The press and the
    // release land on one element, which is all Blink needs to call it a click
    // once the dragstart has been cancelled.
    fireEvent.click(button);

    expect(onOpen).not.toHaveBeenCalled();
  });

  it("opens the file on the press after a drag", () => {
    const button = drawCard();

    press(button);
    fireEvent.pointerMove(window, { clientX: 40, clientY: 30 });
    fireEvent.click(button);

    fireEvent.pointerDown(button, { clientX: 0, clientY: 0 });
    fireEvent.click(button);

    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
