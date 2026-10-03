import { renderWithProviders } from "@/tests/render";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { describe, expect, it, vi } from "vitest";

import {
  FileSystem,
  type FileSystemHandle,
  type FileSystemItem,
  FileSystemRowGlyph,
  type FileSystemView,
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

describe("renaming in place", () => {
  /** A list of five files that can be renamed, with the saves it was asked for. */
  function renderRenamable({
    save = () => Promise.resolve(),
    view = "list",
  }: {
    save?: (item: FileSystemItem, name: string) => Promise<void>;
    view?: FileSystemView;
  } = {}) {
    const onRenameCommit = vi.fn(save);
    const onFileOpen = vi.fn();
    const handle = React.createRef<FileSystemHandle>();
    const props = {
      defaultView: view,
      onFileOpen,
      onRenameCommit,
      ref: handle,
    };
    const { rerender } = renderWithProviders(
      <FileSystem {...props} items={FILES} />,
    );
    const field = () =>
      screen.queryByRole<HTMLInputElement>("textbox", {
        name: "Name",
      });
    const row = (name: string) => screen.getByRole("option", { name });
    return {
      field,
      handle,
      onFileOpen,
      onRenameCommit,
      rerenderWith: (items: FileSystemItem[]) => {
        rerender(<FileSystem {...props} items={items} />);
      },
      row,
    };
  }

  it("renames on Return and saves the new name once", async () => {
    const { field, onRenameCommit, row } = renderRenamable();

    fireEvent.click(row("b.txt"));
    fireEvent.keyDown(row("b.txt"), { key: "Enter" });
    const input = field();
    expect(input?.value).toBe("b.txt");
    // The base name is selected, so typing keeps the extension.
    expect([input?.selectionStart, input?.selectionEnd]).toEqual([0, 1]);

    fireEvent.change(input!, { target: { value: "plans.txt" } });
    fireEvent.keyDown(input!, { key: "Enter" });
    fireEvent.blur(input!);
    fireEvent.pointerDown(row("a.txt"));

    expect(onRenameCommit).toHaveBeenCalledTimes(1);
    expect(onRenameCommit.mock.lastCall?.[1]).toBe("plans.txt");
    await waitFor(() => expect(field()).toBeNull());
  });

  it("saves nothing on Escape", () => {
    const { field, onRenameCommit, row } = renderRenamable();

    fireEvent.click(row("b.txt"));
    fireEvent.keyDown(row("b.txt"), { key: "Enter" });
    fireEvent.change(field()!, { target: { value: "plans.txt" } });
    fireEvent.keyDown(field()!, { key: "Escape" });

    expect(field()).toBeNull();
    expect(onRenameCommit).not.toHaveBeenCalled();
  });

  it("accepts what was typed when something else is pressed", () => {
    const { field, onRenameCommit, row } = renderRenamable();

    fireEvent.click(row("b.txt"));
    fireEvent.keyDown(row("b.txt"), { key: "Enter" });
    fireEvent.change(field()!, { target: { value: "plans.txt" } });
    fireEvent.pointerDown(row("d.txt"));

    expect(onRenameCommit.mock.lastCall?.[1]).toBe("plans.txt");
  });

  it("opens the field again with what was typed when the save fails", async () => {
    const { field, onRenameCommit, row } = renderRenamable({
      save: () =>
        Promise.reject(new Error("Something with that name is already there")),
    });

    fireEvent.click(row("b.txt"));
    fireEvent.keyDown(row("b.txt"), { key: "Enter" });
    fireEvent.change(field()!, { target: { value: "c.txt" } });
    fireEvent.keyDown(field()!, { key: "Enter" });

    await waitFor(() => expect(field()?.readOnly).toBe(false));
    expect(field()?.value).toBe("c.txt");
    expect(onRenameCommit).toHaveBeenCalledTimes(1);
  });

  it("renames none of several on Return", () => {
    const { field, row } = renderRenamable();

    fireEvent.click(row("a.txt"));
    fireEvent.click(row("c.txt"), { metaKey: true });
    fireEvent.keyDown(row("c.txt"), { key: "Enter" });

    expect(field()).toBeNull();
  });

  it("opens rather than renames on Return in the gallery, which has no name to type over", async () => {
    const { field, onFileOpen } = renderRenamable({ view: "gallery" });
    const tile = screen.getByTitle("b.txt");

    fireEvent.click(tile);
    fireEvent.keyDown(tile, { key: "Enter" });

    expect(field()).toBeNull();
    await waitFor(() => expect(onFileOpen).toHaveBeenCalledTimes(1));
    expect(onFileOpen.mock.lastCall?.[0]).toMatchObject({ path: "b.txt" });
  });

  // Named to sort first: jsdom has no layout, so the list's virtual window
  // never grows past the rows it first drew.
  const MADE: FileSystemItem = { kind: "folder", path: "a folder/" };

  it("names a thing asked for before its row is listed, once it is", () => {
    const { field, handle, rerenderWith } = renderRenamable();

    act(() => {
      handle.current?.startRename(MADE.path);
    });
    expect(field()).toBeNull();

    rerenderWith([...FILES, MADE]);
    expect(field()?.value).toBe("a folder");
  });

  it("calls off a rename still waiting for its row when a key is pressed first", () => {
    const { field, handle, rerenderWith } = renderRenamable();

    act(() => {
      handle.current?.startRename(MADE.path);
    });
    fireEvent.keyDown(window, { key: "ArrowDown" });
    rerenderWith([...FILES, MADE]);

    expect(field()).toBeNull();
  });

  it("renames on a second, slow click on the name, and not on a double-click", () => {
    vi.useFakeTimers();
    try {
      const { field, row } = renderRenamable();
      const name = (file: string) =>
        row(file).querySelector("[data-file-system-name]")!;
      const clickName = (file: string, detail = 1) => {
        fireEvent.pointerDown(name(file), { button: 0, pointerType: "mouse" });
        fireEvent.click(name(file), { detail });
      };

      clickName("b.txt");
      clickName("b.txt");
      clickName("b.txt", 2);
      fireEvent.doubleClick(name("b.txt"));
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(field()).toBeNull();

      clickName("b.txt");
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(field()?.value).toBe("b.txt");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the keyboard", () => {
  it("walks the rows from the browser itself when no row has it", () => {
    const { reported } = renderList();
    const browser = document.querySelector<HTMLElement>(
      '[data-slot="file-system"]',
    )!;

    fireEvent.keyDown(browser, { key: "ArrowDown" });
    expect(reported()).toEqual(["a.txt"]);
    fireEvent.keyDown(browser, { key: "ArrowDown" });
    expect(reported()).toEqual(["b.txt"]);
  });

  it("jumps to a name by its first letters", () => {
    const { reported, row } = renderList();

    fireEvent.click(row("a.txt"));
    fireEvent.keyDown(row("a.txt"), { key: "d" });
    expect(reported()).toEqual(["d.txt"]);
  });

  it("does not narrow several to one after an arrow has moved the selection", () => {
    vi.useFakeTimers();
    try {
      const { mouseClick, reported, row } = renderList();

      fireEvent.click(row("a.txt"));
      fireEvent.click(row("c.txt"), { shiftKey: true });
      mouseClick("b.txt");
      fireEvent.keyDown(row("b.txt"), { key: "ArrowDown" });
      expect(reported()).toEqual(["d.txt"]);

      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(reported()).toEqual(["d.txt"]);
    } finally {
      vi.useRealTimers();
    }
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
