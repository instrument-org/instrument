import { useFileDrag } from "@/client/hooks/use-file-drag";
import { renderWithProviders } from "@/tests/render";
import { TaskIdSchema } from "@instrument-org/workspace/client";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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

describe("a click after a drag", () => {
  it("does not open the file the drag came from", () => {
    const onOpen = vi.fn();
    renderWithProviders(<Card onOpen={onOpen} />);
    const button = screen.getByRole("button", { name: "Open a.png" });

    // Dropping a dragged file back onto the card it came from: the press and
    // the release land on one element, which is all Blink needs to call it a
    // click once the dragstart has been cancelled.
    fireEvent.pointerDown(button);
    fireEvent.dragStart(button);
    fireEvent.click(button);

    expect(onOpen).not.toHaveBeenCalled();
  });

  it("still opens the file on a press that never became a drag", () => {
    const onOpen = vi.fn();
    renderWithProviders(<Card onOpen={onOpen} />);
    const button = screen.getByRole("button", { name: "Open a.png" });

    fireEvent.pointerDown(button);
    fireEvent.click(button);

    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("opens the file on the press after a drag", () => {
    const onOpen = vi.fn();
    renderWithProviders(<Card onOpen={onOpen} />);
    const button = screen.getByRole("button", { name: "Open a.png" });

    fireEvent.pointerDown(button);
    fireEvent.dragStart(button);
    fireEvent.click(button);

    fireEvent.pointerDown(button);
    fireEvent.click(button);

    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
