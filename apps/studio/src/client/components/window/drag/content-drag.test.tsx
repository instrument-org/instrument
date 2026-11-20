import { renderWithProviders } from "@/tests/render";
import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

import {
  type Content,
  contentOfAddress,
  ownLinkInAir,
  useContentDrag,
} from "./content-drag";
import { currentDrag } from "./session";

vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    utils: {
      prepareDrag: { call: vi.fn(() => Promise.resolve()) },
    },
  },
}));

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

/** What a drag start hands the system, as a page's `DataTransfer` takes it. */
function transfer() {
  const data = new Map<string, string>();
  return {
    data,
    dataTransfer: {
      clearData: () => {
        data.clear();
      },
      effectAllowed: "all",
      setData: (type: string, value: string) => {
        data.set(type, value);
      },
      setDragImage: vi.fn(),
    },
  };
}

function Handle({ content }: { content: Content }) {
  const dragProps = useContentDrag(content);
  return <div {...dragProps}>Handle</div>;
}

let startFileDrag: ReturnType<typeof installFileDragBridge>;

beforeEach(() => {
  startFileDrag = installFileDragBridge();
});

describe("contentOfAddress", () => {
  it.each([
    [
      "file:///Users/mac-user/Book%20one.xlsx",
      { hostPath: "/Users/mac-user/Book one.xlsx", kind: "file" },
    ],
    [
      "file:///Users/mac-user/Reports/",
      { hostPath: "/Users/mac-user/Reports", kind: "file" },
    ],
    [
      "https://example.com/a",
      { kind: "link", title: "A", url: "https://example.com/a" },
    ],
    [
      "instrument://chat/abc",
      { kind: "link", title: "A", url: "instrument://chat/abc" },
    ],
  ])("%s carries %o", (address, expected) => {
    expect(contentOfAddress(address, "A")).toEqual(expected);
  });
});

describe("a content drag's start", () => {
  it("puts a link in the system's drag, by its address and its name, and holds nothing by the pointer", () => {
    renderWithProviders(
      <Handle
        content={{
          kind: "link",
          title: "Example",
          url: "https://example.com/",
        }}
      />,
    );
    const handle = screen.getByText("Handle");
    expect(handle.getAttribute("draggable")).toBe("true");

    const { data, dataTransfer } = transfer();
    fireEvent.pointerDown(handle, {
      button: 0,
      clientX: 0,
      clientY: 0,
      isPrimary: true,
    });
    fireEvent.dragStart(handle, { dataTransfer });
    fireEvent.pointerMove(window, {
      buttons: 1,
      clientX: 60,
      clientY: 0,
      isPrimary: true,
    });

    expect(Object.fromEntries(data)).toEqual({
      "text/html": '<a href="https://example.com/">Example</a>',
      "text/plain": "https://example.com/",
      "text/uri-list": "https://example.com/",
    });
    expect(ownLinkInAir()).toEqual({
      title: "Example",
      url: "https://example.com/",
    });
    expect(currentDrag()).toBeUndefined();

    fireEvent.dragEnd(handle);
    expect(ownLinkInAir()).toBeUndefined();
  });

  it("hands a file to the system as the file once the pointer means it", () => {
    renderWithProviders(
      <Handle
        content={{ hostPath: "/Users/mac-user/Book.xlsx", kind: "file" }}
      />,
    );
    const handle = screen.getByText("Handle");

    fireEvent.pointerDown(handle, { clientX: 0, clientY: 0 });
    fireEvent.dragStart(handle);
    fireEvent.pointerMove(window, { clientX: 40, clientY: 30 });

    expect(startFileDrag).toHaveBeenCalledWith(["/Users/mac-user/Book.xlsx"]);
    expect(currentDrag()).toBeUndefined();
  });
});
