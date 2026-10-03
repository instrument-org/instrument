import { renderWithProviders } from "@/tests/render";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  FileSystem,
  type FileSystemItem,
  FileSystemRowGlyph,
} from "./file-system";

const FILES = ["a.txt", "b.txt", "c.txt", "d.txt", "e.txt"].map(
  (path): FileSystemItem => ({ kind: "file", path }),
);

/** A list of five files, and what the browser last said is selected. */
function renderList() {
  const onSelectionChange = vi.fn();
  const onOpenSeveral = vi.fn();
  const onFileOpen = vi.fn();
  renderWithProviders(
    <FileSystem
      defaultView="list"
      items={FILES}
      onFileOpen={onFileOpen}
      onOpenSeveral={onOpenSeveral}
      onSelectionChange={onSelectionChange}
    />,
  );
  const row = (name: string) => screen.getByRole("option", { name });
  const selected = () =>
    screen
      .getAllByRole("option")
      .filter((option) => option.getAttribute("aria-selected") === "true")
      .map((option) => option.textContent?.split("--")[0] ?? "");
  const reported = () =>
    (onSelectionChange.mock.lastCall?.[1] as FileSystemItem[] | undefined)?.map(
      (item) => item.path,
    );
  const opened = () =>
    (onOpenSeveral.mock.lastCall?.[0] as FileSystemItem[] | undefined)?.map(
      (item) => item.path,
    );
  /** A real mouse click: the press, then the click with how many it is. */
  const mouseClick = (name: string, detail = 1) => {
    fireEvent.pointerDown(row(name), { button: 0, pointerType: "mouse" });
    fireEvent.click(row(name), { detail });
  };
  return { mouseClick, onFileOpen, opened, reported, row, selected };
}

describe("FileSystem", () => {
  it.each(["icons", "list"] as const)(
    "holds off saying a folder still being read is empty in %s",
    (view) => {
      renderWithProviders(
        <FileSystem
          defaultView={view}
          items={[]}
          pendingFolders={new Set([""])}
        />,
      );

      expect(screen.queryByText("This folder is empty")).toBeNull();
      expect(screen.getByRole("status")).toBeTruthy();
    },
  );

  it("says a folder read with nothing in it is empty", () => {
    renderWithProviders(<FileSystem defaultView="list" items={[]} />);

    expect(screen.getByText("This folder is empty")).toBeTruthy();
  });

  describe("selecting several, the way the Finder does", () => {
    it("adds and lets go of one with ⌘-click", () => {
      const { reported, row } = renderList();

      fireEvent.click(row("a.txt"));
      fireEvent.click(row("c.txt"), { metaKey: true });
      fireEvent.click(row("e.txt"), { metaKey: true });
      expect(reported()).toEqual(["a.txt", "c.txt", "e.txt"]);

      fireEvent.click(row("c.txt"), { metaKey: true });
      expect(reported()).toEqual(["a.txt", "e.txt"]);
    });

    it("reaches from the last click with Shift, replacing the last reach", () => {
      const { reported, row } = renderList();

      fireEvent.click(row("b.txt"));
      fireEvent.click(row("d.txt"), { shiftKey: true });
      expect(reported()).toEqual(["b.txt", "c.txt", "d.txt"]);

      // From the same anchor, upward: the reach to d.txt is let go.
      fireEvent.click(row("a.txt"), { shiftKey: true });
      expect(reported()).toEqual(["b.txt", "a.txt"]);
    });

    it("keeps what ⌘ picked when Shift reaches from it", () => {
      const { reported, row } = renderList();

      fireEvent.click(row("a.txt"));
      fireEvent.click(row("c.txt"), { metaKey: true });
      fireEvent.click(row("e.txt"), { shiftKey: true });
      expect(reported()).toEqual(["a.txt", "c.txt", "d.txt", "e.txt"]);
    });

    it("narrows several to one on a plain click", () => {
      const { reported, row } = renderList();

      fireEvent.click(row("a.txt"));
      fireEvent.click(row("c.txt"), { shiftKey: true });
      fireEvent.click(row("b.txt"));
      expect(reported()).toEqual(["b.txt"]);
    });

    it("reaches with Shift and an arrow, and takes the folder with ⌘A", () => {
      const { reported, row } = renderList();

      fireEvent.click(row("b.txt"));
      fireEvent.keyDown(row("b.txt"), { key: "ArrowDown", shiftKey: true });
      fireEvent.keyDown(row("c.txt"), { key: "ArrowDown", shiftKey: true });
      expect(reported()).toEqual(["b.txt", "c.txt", "d.txt"]);

      fireEvent.keyDown(row("d.txt"), { key: "ArrowUp", shiftKey: true });
      expect(reported()).toEqual(["b.txt", "c.txt"]);

      fireEvent.keyDown(row("c.txt"), { key: "a", metaKey: true });
      expect(reported()).toEqual(FILES.map((file) => file.path));
    });

    it("draws every selected row as selected", () => {
      const { row, selected } = renderList();

      fireEvent.click(row("a.txt"));
      fireEvent.click(row("d.txt"), { metaKey: true });
      expect(selected()).toEqual(["a.txt", "d.txt"]);
    });

    it("waits out a double-click before narrowing several to one", () => {
      vi.useFakeTimers();
      try {
        const { mouseClick, reported, row } = renderList();

        fireEvent.click(row("a.txt"));
        fireEvent.click(row("c.txt"), { shiftKey: true });
        mouseClick("b.txt");
        expect(reported()).toEqual(["a.txt", "b.txt", "c.txt"]);

        vi.advanceTimersByTime(1000);
        expect(reported()).toEqual(["b.txt"]);
      } finally {
        vi.useRealTimers();
      }
    });

    it("narrows before a ⌘-click that lands while the narrowing waits", () => {
      vi.useFakeTimers();
      try {
        const { mouseClick, reported, row } = renderList();

        fireEvent.click(row("a.txt"));
        fireEvent.click(row("c.txt"), { shiftKey: true });
        mouseClick("b.txt");
        fireEvent.pointerDown(row("d.txt"), {
          button: 0,
          metaKey: true,
          pointerType: "mouse",
        });
        fireEvent.click(row("d.txt"), { detail: 1, metaKey: true });
        expect(reported()).toEqual(["b.txt", "d.txt"]);

        vi.advanceTimersByTime(1000);
        expect(reported()).toEqual(["b.txt", "d.txt"]);
      } finally {
        vi.useRealTimers();
      }
    });

    it("lets go of what a search takes off the screen", () => {
      const { reported, row, selected } = renderList();

      fireEvent.click(row("a.txt"));
      fireEvent.click(row("c.txt"), { metaKey: true });
      fireEvent.click(row("e.txt"), { metaKey: true });
      fireEvent.click(screen.getByRole("button", { name: "Search" }));
      fireEvent.change(screen.getByRole("searchbox"), {
        target: { value: "c" },
      });

      expect(selected()).toEqual(["c.txt"]);
      expect(reported()).toEqual(["c.txt"]);
    });

    it("opens all of several on a double-click on one of them", () => {
      const { mouseClick, onFileOpen, opened, reported, row } = renderList();

      fireEvent.click(row("a.txt"));
      fireEvent.click(row("c.txt"), { shiftKey: true });
      mouseClick("b.txt", 1);
      mouseClick("b.txt", 2);
      fireEvent.doubleClick(row("b.txt"));

      expect(opened()).toEqual(["a.txt", "b.txt", "c.txt"]);
      expect(onFileOpen).not.toHaveBeenCalled();
      expect(reported()).toEqual(["a.txt", "b.txt", "c.txt"]);
    });

    it("drags the rest of a selection along with the row pressed", () => {
      const startFileDrag = vi.fn();
      Object.defineProperty(window, "api", {
        configurable: true,
        value: { ...window.api, startFileDrag },
      });
      renderWithProviders(
        <FileSystem
          defaultView="list"
          getHostPath={(item) => `/Users/sam/${item.path}`}
          items={FILES}
        />,
      );
      const row = (name: string) => screen.getByRole("option", { name });

      fireEvent.click(row("a.txt"));
      fireEvent.click(row("c.txt"), { metaKey: true });
      fireEvent.pointerDown(row("c.txt"), {
        button: 0,
        clientX: 0,
        clientY: 0,
        pointerType: "mouse",
      });
      fireEvent.dragStart(row("c.txt"));
      fireEvent.pointerMove(window, { clientX: 40, clientY: 0 });

      expect(startFileDrag).toHaveBeenCalledWith([
        "/Users/sam/c.txt",
        "/Users/sam/a.txt",
      ]);
    });

    it("says what several are where one file's preview stands", () => {
      renderWithProviders(
        <FileSystem
          defaultView="columns"
          items={[
            {
              createdAt: "2026-09-10T12:00:00Z",
              kind: "file",
              path: "a.md",
              size: 4000,
              updatedAt: "2026-09-12T12:00:00Z",
            },
            {
              createdAt: "2026-09-22T12:00:00Z",
              kind: "file",
              path: "b.html",
              size: 10_000,
              updatedAt: "2026-09-22T12:00:00Z",
            },
            { kind: "folder", path: "c/" },
          ]}
        />,
      );
      const row = (name: string) => screen.getByRole("option", { name });

      fireEvent.click(row("a.md"));
      fireEvent.click(row("b.html"), { metaKey: true });
      expect(screen.getByText("2 items")).toBeTruthy();
      // Intl sets the dash between thin spaces.
      expect(screen.getByText("Created").nextSibling?.textContent).toMatch(
        /^Sep 10\s–\s22, 2026$/,
      );
      expect(screen.getByText("Modified").nextSibling?.textContent).toMatch(
        /^Sep 12\s–\s22, 2026$/,
      );

      fireEvent.click(row("c"), { metaKey: true });
      expect(screen.getByText("3 items")).toBeTruthy();
      expect(screen.getByText(/^1 folder, 2 documents/)).toBeTruthy();
    });
  });
});

describe("FileSystemRowGlyph", () => {
  it.each([
    ["artwork.ai", "application/postscript"],
    ["ARTWORK.AI", undefined],
    ["artwork.psd", "image/vnd.adobe.photoshop"],
    ["artwork.psd", undefined],
  ])("shows the artwork thumbnail for %s (%s)", (name, contentType) => {
    const { container } = renderWithProviders(
      <FileSystemRowGlyph
        entry={{
          contentType,
          kind: "file",
          name,
          previewImageUrl: "data:image/png;base64,QUJD",
        }}
      />,
    );

    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "data:image/png;base64,QUJD",
    );
  });
});
