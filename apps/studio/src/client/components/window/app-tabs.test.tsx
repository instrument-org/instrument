import { type TabRouter } from "@/client/lib/tab-router";
import { setTabRouter } from "@/client/lib/tab-router-registry";
import { fileHref, folderHref } from "@/shared/computer-href";
import { TabIdSchema } from "@/shared/tabs";
import { ChatIdSchema } from "@instrument-org/workspace/client";
import { act, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { appTabsAtom, useAppTabs } from "./app-tabs";

const { otherWindows, showInOtherWindow } = vi.hoisted(() => ({
  /** What the other windows keep of their strips. */
  otherWindows: { models: [] as unknown[] },
  showInOtherWindow: vi.fn<(input: { href: string }) => Promise<boolean>>(),
}));

vi.mock("@/client/lib/kept-state", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/client/lib/kept-state")>()),
  keptInOtherWindows: () => otherWindows.models,
}));

// Where Files starts is read from the computer's places, which no test here
// asks about.
vi.mock("@/client/hooks/use-files-start-href", () => ({
  useFilesStartHref: () => "/files?path=&root=~",
}));

vi.mock("@/client/rpc/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/client/rpc/client")>()),
  rpcClient: { window: { showInOtherWindow: { call: showInOtherWindow } } },
}));

beforeEach(() => {
  otherWindows.models = [];
  showInOtherWindow.mockReset();
});

const CHAT = ChatIdSchema.parse("2026-10-01-roofer");
const OTHER = ChatIdSchema.parse("2026-10-02-trip");
const HOME = TabIdSchema.parse("home");

function window(pathname = "/chats") {
  const store = createStore();
  const { result } = renderHook(() => useAppTabs(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    ),
  });
  // Once mounted, since mounting reads the tabs back from storage.
  act(() => {
    store.set(appTabsAtom, {
      recentlyClosed: [],
      selectedId: HOME,
      tabs: [{ id: HOME, pathname }],
    });
  });
  return { result, store };
}

const NOTES = "/Users/mac-user/notes.md";
const DOCUMENTS = "/Users/mac-user/Documents";
const UP = TabIdSchema.parse("up");
const SHOWING = TabIdSchema.parse("showing");

/**
 * Each kind of thing there is one of: the address something asks to open it
 * at, and the address of a tab that has walked since it opened there.
 */
const ONE_OF_A_KIND = [
  [
    "a file",
    fileHref(NOTES),
    `/files?file=${encodeURIComponent(NOTES)}&path=&root=%2FUsers%2Fmac-user&select=notes.md&tree=%2FUsers%2Fmac-user&view=columns`,
  ],
  [
    "a folder in Files",
    folderHref(DOCUMENTS),
    `/files?path=&root=${encodeURIComponent(DOCUMENTS)}&select=a.txt&view=list`,
  ],
  ["a chat", `/chats/${CHAT}`, `/chats/${CHAT}`],
  ["a draft", "/chats?draft=d1", "/chats/?draft=d1"],
  ["the apps", "/apps", "/apps/"],
  ["an app", "/apps/github", "/apps/github"],
  ["the release notes", "/release-notes", "/release-notes"],
  ["the extensions", "/extensions", "/extensions"],
] as const;

/** A window with a new tab up and, behind it, the tab at `showing`. */
function windowShowing(showing: string) {
  const store = createStore();
  const { result } = renderHook(() => useAppTabs(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    ),
  });
  act(() => {
    store.set(appTabsAtom, {
      recentlyClosed: [],
      selectedId: UP,
      tabs: [
        { id: UP, pathname: "/new-tab" },
        { id: SHOWING, pathname: showing },
      ],
    });
  });
  return { result, store };
}

describe("a window's tabs", () => {
  it.each(ONE_OF_A_KIND)(
    "opens %s in a tab of its own even where another tab shows it",
    (_, asked, showing) => {
      const { result, store } = windowShowing(showing);

      act(() => {
        result.current.open(asked);
      });

      const tabs = store.get(appTabsAtom);
      expect(tabs.tabs).toHaveLength(3);
      expect(tabs.selectedId).not.toBe(SHOWING);
      expect(
        tabs.tabs.find((tab) => tab.id === tabs.selectedId)?.pathname,
      ).toBe(asked);
    },
  );

  it("opens another behind when the open waits behind", () => {
    const { result, store } = windowShowing(fileHref(NOTES));

    act(() => {
      result.current.open(fileHref(NOTES), { select: false });
    });

    expect(store.get(appTabsAtom).selectedId).toBe(UP);
    expect(store.get(appTabsAtom).tabs).toHaveLength(3);
  });

  it("sends a rail place to the tab up whatever another tab shows", () => {
    const { result, store } = windowShowing("/apps/");

    act(() => {
      result.current.goToPlace("apps");
    });

    // With no router mounted for the tab up, the place opens in a tab of its own.
    expect(store.get(appTabsAtom).selectedId).not.toBe(SHOWING);
    expect(store.get(appTabsAtom).tabs).toHaveLength(3);
  });
});

describe("navigate", () => {
  it.each([
    [`/chats/${CHAT}`, "replace"],
    ["/chats?draft=01K0000000000000000000000A", "replace"],
    ["/debug/errors", "push"],
  ])("goes to %s by %s", (href, by) => {
    const push = vi.fn();
    const replace = vi.fn();
    // Only the history a step moves: the tab up has no route mounted here.
    setTabRouter(HOME, {
      history: { location: { href: `/chats/${OTHER}` }, push, replace },
    } as unknown as TabRouter);
    const { result } = window(`/chats/${OTHER}`);

    act(() => {
      result.current.navigate(href);
    });

    // A tab group's address stands in place of the one before it, so the
    // window's tab keeps no trail of groups to step back through.
    expect(by === "replace" ? replace : push).toHaveBeenCalledWith(href);
    expect(by === "replace" ? push : replace).not.toHaveBeenCalled();
  });
});

describe("a tab another window asks for, by an address that asks more of it", () => {
  const SINCE = "/release-notes?since=2.0.0";

  it("walks a shown tab by its router, from the window's command too", () => {
    const push = vi.fn();
    const showing = "/release-notes";
    const kept = TabIdSchema.parse("kept");
    // Only the history a walk pushes onto.
    setTabRouter(kept, {
      history: { location: { href: showing }, push },
    } as unknown as TabRouter);
    const store = createStore();
    const { result } = renderHook(() => useAppTabs(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <Provider store={store}>{children}</Provider>
      ),
    });
    act(() => {
      store.set(appTabsAtom, {
        recentlyClosed: [],
        selectedId: UP,
        tabs: [
          { id: UP, pathname: "/new-tab" },
          { id: kept, pathname: showing },
        ],
      });
    });

    let shown = false;
    act(() => {
      shown = result.current.selectShowing(SINCE);
    });

    expect(shown).toBe(true);
    expect(push).toHaveBeenCalledWith(SINCE);
    expect(store.get(appTabsAtom).selectedId).toBe(kept);
  });
});
