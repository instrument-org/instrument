import { renderWithProviders } from "@/tests/render";
import { installWindowStubs } from "@/tests/window-stubs";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from "vitest";

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
  const onTrash = vi.fn();
  renderWithProviders(
    <FileSystem
      defaultView="table"
      items={FILES}
      onFileOpen={onFileOpen}
      onOpenSeveral={onOpenSeveral}
      onSelectionChange={onSelectionChange}
      onTrash={onTrash}
    />,
  );
  const row = (name: string) => screen.getByRole("option", { name });
  // A press on a row's name, rather than its blank space, which drags a run.
  const nameOf = (name: string) =>
    row(name).querySelector("[data-file-system-name-text]") ?? row(name);
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
  const trashed = () =>
    (onTrash.mock.lastCall?.[0] as FileSystemItem[] | undefined)?.map(
      (item) => item.path,
    );
  /** A real mouse click: the press, then the click with how many it is. */
  const mouseClick = (name: string, detail = 1) => {
    fireEvent.pointerDown(nameOf(name), { button: 0, pointerType: "mouse" });
    fireEvent.click(row(name), { detail });
  };
  return {
    mouseClick,
    nameOf,
    onFileOpen,
    onTrash,
    opened,
    reported,
    row,
    selected,
    trashed,
  };
}

describe("FileSystem", () => {
  it.each(["icons", "list", "table"] as const)(
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
    renderWithProviders(<FileSystem defaultView="table" items={[]} />);

    expect(screen.getByText("This folder is empty")).toBeTruthy();
  });

  // A file's kind reads the same whether its extension or only its type
  // says what it is, and never as the type itself.
  it("names each file's kind in the table in words", () => {
    // The list drops columns it has no room for, and nothing is laid out here.
    const width = vi
      .spyOn(HTMLElement.prototype, "clientWidth", "get")
      .mockReturnValue(800);
    onTestFinished(() => {
      width.mockRestore();
    });
    renderWithProviders(
      <FileSystem
        defaultView="table"
        items={[
          { contentType: "text/plain", kind: "file", path: "task.txt" },
          { contentType: "text/plain", kind: "file", path: "2024" },
          { contentType: "text/plain", kind: "file", path: "empty", size: 0 },
          { contentType: "text/html", kind: "file", path: "page.html" },
          { contentType: "text/html", kind: "file", path: "a\\b.html" },
          { contentType: "audio/mpeg", kind: "file", path: "song.mp3" },
          { contentType: "video/mp4", kind: "file", path: "clip.mp4" },
          {
            contentType: "application/octet-stream",
            kind: "file",
            path: "blob",
          },
        ]}
        listColumns={["kind"]}
      />,
    );

    expect(
      screen
        .getAllByRole("option")
        .map(
          (row) =>
            `${row.querySelector("[data-file-system-name]")?.textContent ?? ""}: ${row.lastElementChild?.textContent ?? ""}`,
        ),
    ).toMatchInlineSnapshot(`
      [
        "2024: Plain Text",
        "a\\b.html: HTML Document",
        "blob: Document",
        "clip.mp4: Video",
        "empty: Plain Text",
        "page.html: HTML Document",
        "song.mp3: Audio",
        "task.txt: Plain Text",
      ]
    `);
  });

  // Show hidden files sits at the foot of the sort menu, and the menu stays
  // open on it so the dotfiles can be watched arriving.
  it("lists dotfiles once the sort menu shows hidden files", () => {
    renderWithProviders(
      <FileSystem
        defaultView="table"
        items={[
          { kind: "file", path: ".env" },
          { kind: "file", path: "notes.md" },
        ]}
      />,
    );
    const names = () =>
      [...document.querySelectorAll("[data-file-system-name]")].map(
        (name) => name.textContent,
      );
    expect(names()).toMatchInlineSnapshot(`
      [
        "notes.md",
      ]
    `);

    fireEvent.pointerDown(screen.getByRole("button", { name: "Sort by" }), {
      button: 0,
      pointerType: "mouse",
    });
    fireEvent.click(
      screen.getByRole("menuitemcheckbox", { name: "Show hidden files" }),
    );

    expect(
      screen
        .getByRole("menuitemcheckbox", { name: "Show hidden files" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    // jsdom has no height, so the list draws only the rows it first drew.
    expect(names()).toContain(".env");
  });

  it("offers the order files were opened in for a list of them, the recents", () => {
    renderWithProviders(
      <FileSystem
        defaultView="table"
        items={[
          {
            kind: "file",
            openedAt: "2026-10-15T09:00:00Z",
            path: "notes.md",
          },
        ]}
      />,
    );
    fireEvent.pointerDown(screen.getByRole("button", { name: "Sort by" }), {
      button: 0,
      pointerType: "mouse",
    });
    expect(screen.getAllByRole("menuitemradio")[0]?.textContent).toBe(
      "Date last opened",
    );
  });

  describe("grouped, as the Finder groups a folder", () => {
    it("offers no sort in the menu, since the groups are the order", () => {
      renderWithProviders(
        <FileSystem
          defaultView="icons"
          group="kind"
          items={[{ kind: "file", path: "notes.md" }]}
        />,
      );
      fireEvent.pointerDown(screen.getByRole("button", { name: "Group by" }), {
        button: 0,
        pointerType: "mouse",
      });
      expect(
        screen.getAllByRole("menuitemradio").map((item) => item.textContent),
      ).toMatchInlineSnapshot(`
        [
          "None",
          "Kind",
          "Date modified",
          "Date created",
          "Size",
        ]
      `);
    });

    // Headings and names in the order the grid draws them, which has no
    // header to hold the first group's name.
    const drawn = () =>
      [
        ...document.querySelectorAll(
          "[data-file-system-listing] [aria-hidden], [data-file-system-name]",
        ),
      ]
        .map((part) => part.textContent)
        .filter(Boolean);

    it("puts kinds in the Finder's order, sorted by name within each", () => {
      renderWithProviders(
        <FileSystem
          defaultView="icons"
          group="kind"
          items={[
            { kind: "file", path: "zeta.png" },
            { kind: "file", path: "notes.md" },
            { kind: "folder", path: "photos/" },
            { kind: "file", path: "app.ts" },
            { kind: "file", path: "data.json" },
            { kind: "file", path: "alpha.png" },
          ]}
        />,
      );
      expect(drawn()).toMatchInlineSnapshot(`
        [
          "Folders",
          "photos",
          "Documents",
          "notes.md",
          "Images",
          "alpha.png",
          "zeta.png",
          "Developer",
          "app.ts",
          "Other",
          "data.json",
        ]
      `);
    });

    it("steps sizes by powers of ten, largest first and folders last", () => {
      renderWithProviders(
        <FileSystem
          defaultView="icons"
          group="size"
          items={[
            { kind: "file", path: "tiny.txt", size: 99 },
            { kind: "file", path: "hundred.txt", size: 100 },
            { kind: "file", path: "thousand.txt", size: 1000 },
            { kind: "file", path: "movie.mp4", size: 1_260_000_000 },
            { kind: "folder", path: "photos/" },
          ]}
        />,
      );
      expect(drawn()).toMatchInlineSnapshot(`
        [
          "From 1 GB to 10 GB",
          "movie.mp4",
          "From 1 KB to 10 KB",
          "thousand.txt",
          "From 100 bytes to 1 KB",
          "hundred.txt",
          "Under 100 bytes",
          "tiny.txt",
          "--",
          "photos",
        ]
      `);
    });

    it("ladders dates by calendar day, then months and years", () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(2026, 9, 15, 12));
      onTestFinished(() => {
        vi.useRealTimers();
      });
      const at = (month: number, day: number, year = 2026) =>
        new Date(year, month, day, 9).toISOString();
      renderWithProviders(
        <FileSystem
          defaultView="icons"
          group="updatedAt"
          items={[
            { kind: "file", path: "today.md", updatedAt: at(9, 15) },
            { kind: "file", path: "yesterday.md", updatedAt: at(9, 14) },
            { kind: "file", path: "week.md", updatedAt: at(9, 7) },
            { kind: "file", path: "month.md", updatedAt: at(8, 7) },
            { kind: "file", path: "september.md", updatedAt: at(8, 6) },
            { kind: "file", path: "last-year.md", updatedAt: at(11, 31, 2025) },
          ]}
        />,
      );
      expect(drawn()).toMatchInlineSnapshot(`
        [
          "Today",
          "today.md",
          "Yesterday",
          "yesterday.md",
          "Previous 7 Days",
          "week.md",
          "Previous 30 Days",
          "month.md",
          "September",
          "september.md",
          "2025",
          "last-year.md",
        ]
      `);
    });

    // jsdom has no height, so the grid draws only its first few rows, and a
    // folder of three groups is all of it.
    it("puts no date, and a date still to come, last", () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(2026, 9, 15, 12));
      onTestFinished(() => {
        vi.useRealTimers();
      });
      renderWithProviders(
        <FileSystem
          defaultView="icons"
          group="updatedAt"
          items={[
            { kind: "file", path: "undated.md" },
            {
              kind: "file",
              path: "next-week.md",
              updatedAt: new Date(2026, 9, 22).toISOString(),
            },
            {
              kind: "file",
              path: "today.md",
              updatedAt: new Date(2026, 9, 15, 9).toISOString(),
            },
          ]}
        />,
      );
      expect(drawn()).toMatchInlineSnapshot(`
        [
          "Today",
          "today.md",
          "No Date",
          "next-week.md",
          "undated.md",
        ]
      `);
    });
  });

  describe("a folder the caller cannot list", () => {
    const ITEMS: FileSystemItem[] = [
      { hasChildren: true, kind: "folder", path: "locked/" },
      { kind: "file", path: "readme.md" },
    ];
    const renderUnreadable = (folderPath: string, place: "inline" | "pane") =>
      folderPath === "locked/" ? (
        <p>
          Refused {folderPath} {place}
        </p>
      ) : null;

    it.each(["columns", "gallery", "icons", "list", "table"] as const)(
      "stands in for the whole folder on screen in %s",
      (view) => {
        renderWithProviders(
          <FileSystem
            defaultPath="locked/"
            defaultView={view}
            items={ITEMS}
            renderUnreadable={renderUnreadable}
          />,
        );

        expect(screen.getByText("Refused locked/ pane")).toBeTruthy();
        expect(screen.queryByText("This folder is empty")).toBeNull();
        expect(screen.queryByRole("option")).toBeNull();
      },
    );

    it("takes the column's place beside the folder above it in the columns", () => {
      renderWithProviders(
        <FileSystem
          defaultSelectedPath="locked/"
          defaultView="columns"
          items={ITEMS}
          renderUnreadable={renderUnreadable}
        />,
      );

      expect(screen.getByText("Refused locked/ pane")).toBeTruthy();
      expect(
        screen.getAllByRole("option").map((option) => option.textContent),
      ).toEqual(["locked", "readme.md"]);
    });

    it("says so in a line under the folder opened in place in the table", () => {
      renderWithProviders(
        <FileSystem
          defaultView="table"
          items={ITEMS}
          renderUnreadable={renderUnreadable}
        />,
      );

      // The chevron, which opens the folder in place.
      const chevron = screen
        .getByRole("option", { name: /locked/ })
        .querySelector("span[aria-hidden]");
      if (!chevron) {
        throw new Error("no chevron on the folder's row");
      }
      fireEvent.click(chevron);

      expect(screen.getByText("Refused locked/ inline")).toBeTruthy();
    });
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

    it("hands every selected row to the Trash on ⌘⌫, and nothing on ⌫ alone", () => {
      const { onTrash, row, trashed } = renderList();

      fireEvent.click(row("b.txt"));
      fireEvent.click(row("d.txt"), { metaKey: true });
      fireEvent.keyDown(row("d.txt"), { key: "Backspace" });
      expect(onTrash).not.toHaveBeenCalled();

      fireEvent.keyDown(row("d.txt"), { key: "Backspace", metaKey: true });
      expect(trashed()).toEqual(["b.txt", "d.txt"]);
    });

    it("names the row after what is trashed, for the page to select", () => {
      const handle = React.createRef<FileSystemHandle>();
      renderWithProviders(
        <FileSystem defaultView="table" items={FILES} ref={handle} />,
      );

      expect(handle.current?.rowAfter(["b.txt"])).toBe("c.txt");
      expect(handle.current?.rowAfter(["c.txt", "d.txt"])).toBe("e.txt");
      expect(handle.current?.rowAfter(["e.txt"])).toBeNull();
    });

    it("steps the selection for the page, saying whether it moved", () => {
      const handle = React.createRef<FileSystemHandle>();
      renderWithProviders(
        <FileSystem
          defaultSelectedPath="d.txt"
          defaultView="table"
          items={FILES}
          ref={handle}
        />,
      );

      const step = (direction: "down" | "up") => {
        let moved: boolean | undefined;
        React.act(() => {
          moved = handle.current?.step(direction);
        });
        return moved;
      };
      expect(step("down")).toBe(true);
      expect(step("down")).toBe(false);
      expect(step("up")).toBe(true);
    });

    it("hands ← and → on one file to what shows it, and keeps them on several", () => {
      const onArrowBesideFile = vi.fn(() => true);
      renderWithProviders(
        <FileSystem
          defaultView="table"
          items={FILES}
          onArrowBesideFile={onArrowBesideFile}
        />,
      );
      const row = (name: string) => screen.getByRole("option", { name });

      fireEvent.click(row("b.txt"));
      fireEvent.keyDown(row("b.txt"), { key: "ArrowRight", shiftKey: true });
      expect(onArrowBesideFile).not.toHaveBeenCalled();
      fireEvent.keyDown(row("b.txt"), { key: "ArrowRight" });
      fireEvent.keyDown(row("b.txt"), { key: "ArrowLeft" });
      expect(onArrowBesideFile.mock.calls).toEqual([["right"], ["left"]]);

      fireEvent.click(row("c.txt"), { metaKey: true });
      fireEvent.keyDown(row("c.txt"), { key: "ArrowRight" });
      expect(onArrowBesideFile).toHaveBeenCalledTimes(2);
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
        const { mouseClick, nameOf, reported, row } = renderList();

        fireEvent.click(row("a.txt"));
        fireEvent.click(row("c.txt"), { shiftKey: true });
        mouseClick("b.txt");
        fireEvent.pointerDown(nameOf("d.txt"), {
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
          defaultView="table"
          getHostPath={(item) => `/Users/sam/${item.path}`}
          items={FILES}
        />,
      );
      const row = (name: string) => screen.getByRole("option", { name });

      fireEvent.click(row("a.txt"));
      fireEvent.click(row("c.txt"), { metaKey: true });
      fireEvent.pointerDown(
        row("c.txt").querySelector("[data-file-system-name-text]") ??
          row("c.txt"),
        {
          button: 0,
          clientX: 0,
          clientY: 0,
          pointerType: "mouse",
        },
      );
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

  it("opens in the table the folders it is told are open, and says when one closes", () => {
    const onOpenFolderChange = vi.fn();
    const items: FileSystemItem[] = [
      { kind: "folder", path: "drafts/" },
      { kind: "file", path: "drafts/report.txt" },
      { kind: "file", path: "notes.txt" },
    ];
    renderWithProviders(
      <FileSystem
        defaultView="table"
        items={items}
        onOpenFolderChange={onOpenFolderChange}
        openFolders={new Set(["drafts/"])}
      />,
    );
    const names = () =>
      screen
        .getAllByRole("option")
        .map((option) => option.textContent?.split("--")[0] ?? "");

    expect(names()).toEqual(["drafts", "report.txt", "notes.txt"]);
    // The list counts what it draws, what is open in place included.
    expect(
      document.querySelector("[data-file-system-status]")?.textContent,
    ).toBe("3 items");
    const drafts = screen.getByRole("option", { name: /^drafts/ });
    fireEvent.click(drafts);
    fireEvent.keyDown(drafts, { key: "ArrowLeft" });

    expect(onOpenFolderChange.mock.calls).toEqual([["drafts/", false]]);
  });

  it("selects a run down the list from a row's blank space, and drags nothing out", () => {
    const startFileDrag = vi.fn();
    Object.defineProperty(window, "api", {
      configurable: true,
      value: { ...window.api, startFileDrag },
    });
    // jsdom lays nothing out: every box is the window's, from its corner.
    const rect = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockReturnValue(new DOMRect(0, 0, 800, 600));
    onTestFinished(() => {
      rect.mockRestore();
    });
    const { reported, row } = renderList();

    // The row itself, past its name: rows are 24 tall from the top.
    fireEvent.pointerDown(row("a.txt"), {
      button: 0,
      clientX: 300,
      clientY: 12,
      pointerType: "mouse",
    });
    fireEvent.dragStart(row("a.txt"));
    fireEvent.pointerMove(window, { clientX: 300, clientY: 60 });
    fireEvent.pointerUp(window, { clientX: 300, clientY: 60 });

    expect(reported()).toEqual(["a.txt", "b.txt", "c.txt"]);
    expect(startFileDrag).not.toHaveBeenCalled();
  });

  it("says how many items the folder lists and how many are selected", () => {
    const { row } = renderList();
    const status = () =>
      document.querySelector("[data-file-system-status]")?.textContent;

    expect(status()).toBe("5 items");
    fireEvent.click(row("a.txt"));
    expect(status()).toBe("1 of 5 selected");
    fireEvent.click(row("c.txt"), { metaKey: true });
    expect(status()).toBe("2 of 5 selected");
  });

  describe("searching", () => {
    const FOLDERS: FileSystemItem[] = [
      { kind: "folder", path: "drafts/" },
      { kind: "file", path: "drafts/report.txt" },
      { kind: "file", path: "notes.txt" },
    ];
    const names = () =>
      screen
        .queryAllByRole("option")
        .map((option) => option.textContent?.split("--")[0] ?? "");

    it("opens searched for what it was handed", () => {
      renderWithProviders(
        <FileSystem
          defaultSearch="notes"
          defaultView="table"
          items={FOLDERS}
        />,
      );

      expect(names()).toEqual(["notes.txt"]);
      // Folded into the toolbar, the button says what is searched for.
      expect(
        screen.getByRole("button", { name: "Search: notes" }),
      ).toBeTruthy();
    });

    it("offers to clear a search that matches nothing", () => {
      const onSearchChange = vi.fn();
      renderWithProviders(
        <FileSystem
          defaultView="table"
          items={FOLDERS}
          onSearchChange={onSearchChange}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Search" }));
      fireEvent.change(screen.getByRole("searchbox"), {
        target: { value: "zebra" },
      });

      expect(screen.getByText("Nothing here matches “zebra”.")).toBeTruthy();
      fireEvent.click(screen.getByText("Clear search"));

      expect(onSearchChange.mock.calls).toEqual([["zebra"], [""]]);
      expect(names()).toEqual(["drafts", "notes.txt"]);
    });

    it("says the search is emptied by walking into a folder", () => {
      const onSearchChange = vi.fn();
      renderWithProviders(
        <FileSystem
          defaultSearch="draft"
          defaultView="icons"
          items={FOLDERS}
          onSearchChange={onSearchChange}
        />,
      );
      fireEvent.doubleClick(screen.getByRole("option", { name: /^drafts/ }));

      expect(onSearchChange.mock.calls).toEqual([[""]]);
    });
  });
});

describe("the file manager's keys for going up and making a folder", () => {
  const NESTED: FileSystemItem[] = [
    { hasChildren: true, kind: "folder", path: "docs/" },
    { kind: "file", path: "docs/a.txt" },
    { kind: "file", path: "b.txt" },
  ];

  describe.each([
    {
      newFolder: { ctrlKey: false, key: "N", metaKey: true, shiftKey: true },
      platform: "darwin",
      up: { altKey: false, key: "ArrowUp", metaKey: true },
    },
    {
      newFolder: { ctrlKey: true, key: "N", metaKey: false, shiftKey: true },
      platform: "win32",
      up: { altKey: true, key: "ArrowUp", metaKey: false },
    },
  ])("on $platform", ({ newFolder, platform, up }) => {
    beforeEach(() => {
      Object.defineProperty(window, "electron", {
        configurable: true,
        value: { process: { platform } },
      });
    });
    afterEach(() => {
      installWindowStubs();
    });

    it("goes up with the folder left selected, then past the top to the page", () => {
      const onLeaveRoot = vi.fn();
      const onPathChange = vi.fn();
      renderWithProviders(
        <FileSystem
          defaultPath="docs/"
          defaultView="table"
          items={NESTED}
          onLeaveRoot={onLeaveRoot}
          onPathChange={onPathChange}
        />,
      );

      fireEvent.keyDown(screen.getByRole("option", { name: "a.txt" }), up);
      expect(onPathChange).toHaveBeenLastCalledWith("");
      const docs = screen.getByRole("option", { name: "docs" });
      expect(docs.getAttribute("aria-selected")).toBe("true");
      expect(onLeaveRoot).not.toHaveBeenCalled();

      fireEvent.keyDown(docs, up);
      expect(onLeaveRoot).toHaveBeenCalledTimes(1);
    });

    it("asks the page for a new folder", () => {
      const onNewFolder = vi.fn();
      renderWithProviders(
        <FileSystem
          defaultView="table"
          items={NESTED}
          onNewFolder={onNewFolder}
        />,
      );

      fireEvent.keyDown(
        screen.getByRole("option", { name: "b.txt" }),
        newFolder,
      );
      expect(onNewFolder).toHaveBeenCalledTimes(1);
    });
  });
});

describe("renaming in place", () => {
  /** A list of five files that can be renamed, with the saves it was asked for. */
  function renderRenamable({
    save = () => Promise.resolve(),
    view = "table",
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
    /** The name field, failing the test when no rename has it open. */
    const openField = () =>
      screen.getByRole<HTMLInputElement>("textbox", { name: "Name" });
    const row = (name: string) => screen.getByRole("option", { name });
    return {
      field,
      handle,
      openField,
      onFileOpen,
      onRenameCommit,
      rerenderWith: (items: FileSystemItem[]) => {
        rerender(<FileSystem {...props} items={items} />);
      },
      row,
    };
  }

  it("renames on Return and saves the new name once", async () => {
    const { openField, field, onRenameCommit, row } = renderRenamable();

    fireEvent.click(row("b.txt"));
    fireEvent.keyDown(row("b.txt"), { key: "Enter" });
    const input = openField();
    expect(input?.value).toBe("b.txt");
    // The base name is selected, so typing keeps the extension.
    expect([input?.selectionStart, input?.selectionEnd]).toEqual([0, 1]);

    fireEvent.change(input, { target: { value: "plans.txt" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input);
    fireEvent.pointerDown(row("a.txt"));

    expect(onRenameCommit).toHaveBeenCalledTimes(1);
    expect(onRenameCommit.mock.lastCall?.[1]).toBe("plans.txt");
    await waitFor(() => expect(field()).toBeNull());
  });

  it("saves nothing on Escape", () => {
    const { openField, field, onRenameCommit, row } = renderRenamable();

    fireEvent.click(row("b.txt"));
    fireEvent.keyDown(row("b.txt"), { key: "Enter" });
    fireEvent.change(openField(), { target: { value: "plans.txt" } });
    fireEvent.keyDown(openField(), { key: "Escape" });

    expect(field()).toBeNull();
    expect(onRenameCommit).not.toHaveBeenCalled();
  });

  it("accepts what was typed when something else is pressed", () => {
    const { onRenameCommit, openField, row } = renderRenamable();

    fireEvent.click(row("b.txt"));
    fireEvent.keyDown(row("b.txt"), { key: "Enter" });
    fireEvent.change(openField(), { target: { value: "plans.txt" } });
    fireEvent.pointerDown(row("d.txt"));

    expect(onRenameCommit.mock.lastCall?.[1]).toBe("plans.txt");
  });

  it("opens the field again with what was typed when the save fails", async () => {
    const { field, onRenameCommit, openField, row } = renderRenamable({
      save: () =>
        Promise.reject(new Error("Something with that name is already there")),
    });

    fireEvent.click(row("b.txt"));
    fireEvent.keyDown(row("b.txt"), { key: "Enter" });
    fireEvent.change(openField(), { target: { value: "c.txt" } });
    fireEvent.keyDown(openField(), { key: "Enter" });

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

  describe.each(["win32", "linux"])("on %s", (platform) => {
    beforeEach(() => {
      Object.defineProperty(window, "electron", {
        configurable: true,
        value: { process: { platform } },
      });
    });
    afterEach(() => {
      installWindowStubs();
    });

    it("opens on Enter and renames on F2, as File Explorer does", async () => {
      const { field, onFileOpen, openField, row } = renderRenamable();

      fireEvent.click(row("b.txt"));
      fireEvent.keyDown(row("b.txt"), { key: "Enter" });
      expect(field()).toBeNull();
      await waitFor(() => expect(onFileOpen).toHaveBeenCalledTimes(1));
      expect(onFileOpen.mock.lastCall?.[0]).toMatchObject({ path: "b.txt" });

      fireEvent.keyDown(row("b.txt"), { key: "F2" });
      expect(openField().value).toBe("b.txt");
    });

    it("opens nothing on F2 in the gallery, which has no name to type over", () => {
      const { field, onFileOpen } = renderRenamable({ view: "gallery" });
      const tile = screen.getByTitle("b.txt");

      fireEvent.click(tile);
      fireEvent.keyDown(tile, { key: "F2" });

      expect(field()).toBeNull();
      expect(onFileOpen).not.toHaveBeenCalled();
    });
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
        row(file).querySelector("[data-file-system-name-text]") ??
        row(file).querySelector("[data-file-system-name]") ??
        expect.unreachable(`no name in the row for ${file}`);
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
    const browser =
      document.querySelector<HTMLElement>('[data-slot="file-system"]') ??
      expect.unreachable("no file system on screen");

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

describe("FileSystem's List", () => {
  const PAGES: FileSystemItem[] = [
    { kind: "file", path: "a.html", title: "Pricing against competitors" },
    { kind: "file", path: "b.md", title: "Zendesk tiers" },
    { kind: "file", path: "c.csv" },
  ];
  function renderPages(
    props: Partial<React.ComponentProps<typeof FileSystem>> = {},
  ) {
    const onSelectionChange = vi.fn();
    renderWithProviders(
      <FileSystem
        defaultView="list"
        items={PAGES}
        onSelectionChange={onSelectionChange}
        {...props}
      />,
    );
    const reported = () =>
      (
        onSelectionChange.mock.lastCall?.[1] as FileSystemItem[] | undefined
      )?.map((item) => item.path);
    return { reported };
  }

  it("leads with a file's own title over its name, and with the name and kind where it has none", () => {
    renderPages();

    expect(
      screen
        .getAllByRole("option")
        .map((option) => [
          option.querySelector("[data-file-system-name]")?.textContent,
          option.textContent,
        ]),
    ).toMatchInlineSnapshot(`
      [
        [
          "Pricing against competitors",
          "htmlPricing against competitorsa.html--",
        ],
        [
          "Zendesk tiers",
          "mdZendesk tiersb.md--",
        ],
        [
          "c.csv",
          "csvc.csvCSV Document--",
        ],
      ]
    `);
  });

  it("finds a file by its title", () => {
    renderPages({ defaultSearch: "zendesk" });

    expect(
      screen
        .getAllByRole("option")
        .map((option) => option.dataset.fileSystemItem),
    ).toEqual(["b.md"]);
  });

  it("jumps to a title by its first letters", () => {
    const { reported } = renderPages();
    const first =
      screen.getAllByRole("option")[0] ?? expect.unreachable("no rows");

    fireEvent.click(first);
    fireEvent.keyDown(first, { key: "z" });
    expect(reported()).toEqual(["b.md"]);
  });
});
