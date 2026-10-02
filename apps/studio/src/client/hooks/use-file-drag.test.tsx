import { useFileDrag, useFileDragArea } from "@/client/hooks/use-file-drag";
import { renderWithProviders } from "@/tests/render";
import { fireEvent, screen } from "@testing-library/react";
import { type SyntheticEvent } from "react";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

// Preparing a drag asks the main process to render the file's drag image.
// Nothing here is about that round trip, and a rendering surface must not
// make one.
vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    utils: {
      prepareDrag: { call: vi.fn(() => Promise.resolve()) },
    },
  },
}));

const HOST_PATH = "/Users/casey/tasks/a-task/output/a.png";

/**
 * The shape every draggable file surface has: the drag props on the box, and
 * something inside it that opens the file when clicked.
 */
function Card({ onOpen }: { onOpen: () => void }) {
  const dragProps = useFileDrag({ hostPath: HOST_PATH });

  return (
    <div {...dragProps}>
      <button onClick={onOpen} type="button">
        Open a.png
      </button>
    </div>
  );
}

const ROW_PATHS = [
  "/Users/casey/Documents/a.png",
  "/Users/casey/Documents/b.pdf",
];

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

/**
 * The shape of a browser that draws its own rows: one gesture on the list,
 * rows that name their file and say they drag, and a field inside the list
 * whose own text still drags as text.
 */
function Listing({ onOpen }: { onOpen: (path: string) => void }) {
  const dragArea = useFileDragArea((event: SyntheticEvent) => {
    for (const target of event.nativeEvent.composedPath()) {
      const hostPath =
        target instanceof HTMLElement ? target.dataset.hostPath : undefined;
      if (hostPath) {
        return { hostPath };
      }
    }
    return;
  });

  return (
    <div role="listbox" {...dragArea}>
      <input aria-label="Name" defaultValue="a.png" />
      {ROW_PATHS.map((path) => (
        <button
          data-host-path={path}
          draggable={dragArea.draggable}
          key={path}
          onClick={() => {
            onOpen(path);
          }}
          role="option"
          type="button"
        >
          <span>{path.split("/").at(-1)}</span>
        </button>
      ))}
    </div>
  );
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
    expect(startFileDrag).toHaveBeenCalledWith([HOST_PATH]);
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

describe("a listing that drags its own rows", () => {
  let onOpenPath: ReturnType<typeof vi.fn<(path: string) => void>>;

  function drawListing() {
    onOpenPath = vi.fn<(path: string) => void>();
    renderWithProviders(<Listing onOpen={onOpenPath} />);
    return {
      field: screen.getByRole("textbox", { name: "Name" }),
      list: screen.getByRole("listbox"),
      // The press lands on the row's own text, which is what the pointer is
      // over, not the row itself.
      rowText: (name: string) => screen.getByText(name),
    };
  }

  it("hands over the file under the press, found along the event's path", () => {
    const { rowText } = drawListing();

    press(rowText("b.pdf"));
    fireEvent.pointerMove(window, { clientX: 40, clientY: 30 });

    expect(startFileDrag).toHaveBeenCalledTimes(1);
    expect(startFileDrag).toHaveBeenCalledWith([ROW_PATHS[1]]);
  });

  it("drags nothing from a press on the list's empty space", () => {
    const { list } = drawListing();

    press(list);
    fireEvent.pointerMove(window, { clientX: 200, clientY: 200 });

    expect(startFileDrag).not.toHaveBeenCalled();
  });

  it("cancels the dragstart on a row and leaves a field's own to Blink", () => {
    const { field, rowText } = drawListing();

    fireEvent.pointerDown(rowText("a.png"), { clientX: 0, clientY: 0 });
    expect(fireEvent.dragStart(rowText("a.png"))).toBe(false);
    fireEvent.pointerUp(window);

    fireEvent.pointerDown(field, { clientX: 0, clientY: 0 });
    expect(fireEvent.dragStart(field)).toBe(true);
  });

  it("does not open the row a drag came from", () => {
    const { rowText } = drawListing();

    press(rowText("a.png"));
    fireEvent.pointerMove(window, { clientX: 40, clientY: 30 });
    fireEvent.click(rowText("a.png"));

    expect(onOpenPath).not.toHaveBeenCalled();

    fireEvent.pointerDown(rowText("a.png"), { clientX: 0, clientY: 0 });
    fireEvent.click(rowText("a.png"));

    expect(onOpenPath).toHaveBeenCalledWith(ROW_PATHS[0]);
  });
});
