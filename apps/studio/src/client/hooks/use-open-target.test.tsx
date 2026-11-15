import { bookmarksAtom } from "@/client/bookmarks/store";
import { FileOpenContext } from "@/client/components/file-open-context";
import { PageOpenContext } from "@/client/components/page-open-context";
import {
  type WindowContextValue,
  WindowContext,
} from "@/client/components/window/context";
import { GroupTabContext } from "@/client/components/window/group-tab";
import { ChatIdSchema } from "@instrument-org/workspace/client";
import { renderHook, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  openClickGestures,
  showOpenMenu,
  useGesturesFor,
} from "./use-open-target";

const hostPaths = vi.fn(
  ({ filePaths }: { filePaths: string[] }): Record<string, null | string> =>
    Object.fromEntries(
      filePaths.map((filePath) => [
        filePath,
        filePath === "workspace:/Notes/plan.md"
          ? "/Users/sam/Instrument/Notes/plan.md"
          : null,
      ]),
    ),
);

const { toastError, toastSaid } = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastSaid: vi.fn(),
}));
vi.mock("@/client/lib/toast", () => ({
  toast: Object.assign(toastSaid, { error: toastError }),
}));
const { showContextMenu } = vi.hoisted(() => ({
  showContextMenu: vi.fn((_input: { items: unknown[] }) =>
    Promise.resolve({ id: undefined }),
  ),
}));

// Nothing here opens a link.
vi.mock("@/client/hooks/use-open-external-link", () => ({
  useOpenExternalLink: () => () => undefined,
}));
vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    utils: { showContextMenu: { call: showContextMenu } },
    workspace: {
      chats: {
        files: {
          hostPaths: {
            call: (input: { filePaths: string[] }) =>
              Promise.resolve(hostPaths(input)),
          },
        },
      },
    },
  },
}));

const chatId = ChatIdSchema.parse("2026-10-19-copy-path");

afterEach(() => {
  hostPaths.mockClear();
  showContextMenu.mockClear();
  toastError.mockClear();
  toastSaid.mockClear();
});

async function copied(
  target: Parameters<ReturnType<typeof useGesturesFor>>[0],
) {
  const writeText = vi.fn(() => Promise.resolve());
  Object.assign(navigator, { clipboard: { writeText } });
  const { result } = renderHook(() => useGesturesFor());
  const copy = result
    .current(target)
    .destinations.find((destination) => destination.id === "copy");
  copy?.run();
  await waitFor(
    () => {
      expect(writeText).toHaveBeenCalled();
    },
    { interval: 1 },
  );
  return writeText.mock.calls[0];
}

describe("Copy Path", () => {
  // A chat keeps a file in the workspace by its place there, which no other
  // program can open; what is pasted is where it is on this computer.
  it("copies where a path a chat kept is on this computer", async () => {
    await expect(
      copied({ chatId, kind: "path", path: "workspace:/Notes/plan.md" }),
    ).resolves.toEqual(["/Users/sam/Instrument/Notes/plan.md"]);
  });

  it("copies the path as named when it names nothing the chat reaches", async () => {
    await expect(
      copied({ chatId, kind: "path", path: "attachments/gone.png" }),
    ).resolves.toEqual(["attachments/gone.png"]);
  });

  it("copies the path as named with no chat to read it against", async () => {
    await expect(copied({ kind: "path", path: "report.md" })).resolves.toEqual([
      "report.md",
    ]);
    expect(hostPaths).not.toHaveBeenCalled();
  });

  // Where a file in the workspace is depends on the workspace alone.
  it("copies where a file in the workspace is with no chat to read it against", async () => {
    await expect(
      copied({ kind: "path", path: "workspace:/Notes/plan.md" }),
    ).resolves.toEqual(["/Users/sam/Instrument/Notes/plan.md"]);
  });

  it("copies nothing for a file in the workspace that names nothing here", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });
    const { result } = renderHook(() => useGesturesFor());
    result
      .current({ chatId, kind: "path", path: "workspace:/Gone/plan.md" })
      .destinations.find((destination) => destination.id === "copy")
      ?.run();
    await waitFor(
      () => {
        expect(toastError).toHaveBeenCalled();
      },
      { interval: 1 },
    );
    expect(writeText).not.toHaveBeenCalled();
  });
});

describe("a click on a link", () => {
  const press = (keys: { meta?: boolean; shift?: boolean }) => {
    const open = vi.fn();
    const openInNewTab = vi.fn();
    openClickGestures({ open, openInNewTab }).onClick({
      altKey: false,
      button: 0,
      ctrlKey: keys.meta ?? false,
      metaKey: keys.meta ?? false,
      shiftKey: keys.shift ?? false,
    } as React.MouseEvent);
    return [open, openInNewTab].map((each) => each.mock.calls.length);
  };

  // Only a menu's Open in New Tab Group makes a group, so Shift, a
  // browser's new window, is a new tab too.
  it.each([
    { expected: [1, 0], keys: {}, name: "plain, here" },
    { expected: [0, 1], keys: { meta: true }, name: "Command, a tab" },
    { expected: [0, 1], keys: { shift: true }, name: "Shift, a tab" },
    {
      expected: [0, 1],
      keys: { meta: true, shift: true },
      name: "Command and Shift, a tab",
    },
  ])("opens $name", ({ expected, keys }) => {
    expect(press(keys)).toEqual(expected);
  });
});

describe("a link's menu in a window with tabs", () => {
  const ask = vi.fn();
  const openPage = vi.fn();
  const openPath = vi.fn();
  const openScreen = vi.fn();
  const surfaceOpen = vi.fn();
  const store = createStore();
  const appWindow = {
    ask,
    browser: null,
    chatId,
    openPage,
    openPath,
    openScreen,
  } satisfies WindowContextValue;
  // A link drawn in a chat's tab: the window's, the tab's, and the chat's
  // own places for a page and a file.
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>
      <WindowContext value={appWindow}>
        <GroupTabContext
          value={{
            close: vi.fn(),
            id: "tab-left",
            isShown: true,
            showPage: vi.fn(),
          }}
        >
          <PageOpenContext value={surfaceOpen}>
            <FileOpenContext value={openPath}>{children}</FileOpenContext>
          </PageOpenContext>
        </GroupTabContext>
      </WindowContext>
    </Provider>
  );
  const menuOf = (...asked: Parameters<ReturnType<typeof useGesturesFor>>) =>
    renderHook(() => useGesturesFor(), { wrapper }).result.current(...asked);

  afterEach(() => {
    openPage.mockClear();
    openPath.mockClear();
    openScreen.mockClear();
    surfaceOpen.mockClear();
  });

  it.each([
    { kind: "page", url: "https://example.com/" },
    { chatId, kind: "path", path: "/Users/sam/report.md" },
    { href: "/chat-list", kind: "screen" },
  ] as const)("lists the places for a $kind in one order", (target) => {
    expect(menuOf(target).destinations.map((row) => row.label)).toEqual([
      "Open",
      "Open in Split",
      "Open in New Tab",
      "Open in New Tab Group",
      "Open in New Window",
      "Add to Bookmarks",
      target.kind === "path" ? "Copy Path" : "Copy Link",
    ]);
  });

  it.each([
    { kind: "page", url: "https://example.com/" },
    { href: "/chat-list", kind: "screen" },
  ] as const)(
    "words a link's menu as a browser does, without the Open its click does, for a $kind",
    async (target) => {
      const link = menuOf(target, { isLink: true });
      link.onContextMenu({
        preventDefault: vi.fn(),
      } as unknown as React.MouseEvent);
      await waitFor(() => {
        expect(showContextMenu).toHaveBeenCalled();
      });
      expect(
        showContextMenu.mock.calls
          .at(-1)?.[0]
          .items.map((item) =>
            typeof item === "object" && item !== null && "label" in item
              ? item.label
              : "---",
          ),
      ).toEqual([
        "Open Link in Split",
        "Open Link in New Tab",
        "Open Link in New Tab Group",
        "Open Link in New Window",
        "---",
        "Bookmark Link",
        "Copy Link",
      ]);
      link.onClick({
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        preventDefault: vi.fn(),
        shiftKey: false,
      } as unknown as React.MouseEvent);
      expect(
        target.kind === "page" ? surfaceOpen : openScreen,
      ).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ["Open in Split", { from: "tab-left", into: "split" }],
    ["Open in New Tab", { behind: true, newTab: true }],
    ["Open in New Tab Group", { into: "group" }],
    ["Open in New Window", { into: "window" }],
  ])("opens a page from %s in the place it names", (label, options) => {
    menuOf({ kind: "page", url: "https://example.com/" })
      .destinations.find((row) => row.label === label)
      ?.run();
    expect(openPage).toHaveBeenCalledWith("https://example.com/", options);
  });

  it("opens with Shift and a click as a new tab, never a group", () => {
    menuOf({ kind: "page", url: "https://example.com/" }).onClick({
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      preventDefault: vi.fn(),
      shiftKey: true,
    } as unknown as React.MouseEvent);
    expect(openPage).toHaveBeenCalledWith("https://example.com/", {
      behind: true,
      newTab: true,
    });
  });

  it("keeps a page, a built-in page and a file as bookmarks, once each", async () => {
    const keep = (target: Parameters<typeof menuOf>[0]) =>
      menuOf(target)
        .destinations.find((row) => row.id === "bookmark")
        ?.run();
    keep({ kind: "page", url: "https://example.com/" });
    keep({ href: "/chat-list", kind: "screen" });
    keep({ chatId, kind: "path", path: "workspace:/Notes/plan.md" });
    keep({ kind: "page", url: "https://example.com" });
    await waitFor(
      () => {
        expect(toastSaid).toHaveBeenCalledTimes(4);
      },
      { interval: 1 },
    );
    expect(
      store.get(bookmarksAtom).map(({ title, url }) => ({ title, url })),
    ).toEqual([
      { title: "", url: "https://example.com/" },
      { title: "Chats", url: "instrument://screen/chats" },
      {
        title: "plan.md",
        url: "instrument://file/Users/sam/Instrument/Notes/plan.md",
      },
    ]);
    // The file's is said once its place on this computer is found.
    expect(toastSaid.mock.calls.map(([said]) => said).toSorted()).toEqual([
      "Added to Bookmarks",
      "Added to Bookmarks",
      "Added to Bookmarks",
      "Already in Bookmarks",
    ]);
  });

  it("sets keeping and copying apart from the places in the OS's menu", async () => {
    await showOpenMenu(
      menuOf({ kind: "page", url: "https://example.com/" }).destinations,
    );
    expect(
      showContextMenu.mock.calls[0]?.[0].items.map((item) =>
        typeof item === "object" && item !== null && "label" in item
          ? item.label
          : "---",
      ),
    ).toEqual([
      "Open",
      "Open in Split",
      "Open in New Tab",
      "Open in New Tab Group",
      "Open in New Window",
      "---",
      "Add to Bookmarks",
      "Copy Link",
    ]);
  });
});
