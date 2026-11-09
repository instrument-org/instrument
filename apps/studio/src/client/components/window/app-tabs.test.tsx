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
  const tabsAt = (at: string) =>
    store.get(appTabsAtom).tabs.filter((tab) => tab.pathname === at);
  return { result, store, tabsAt };
}

describe("openOrFocusChat", () => {
  it("opens one tab for two calls from the same render", () => {
    const { result, tabsAt } = window();
    // What a window on its way out of the screen holds: the handlers of the
    // render before the first call, which never saw the tab it opened.
    const { openOrFocusChat } = result.current;

    act(() => {
      openOrFocusChat(CHAT);
    });
    act(() => {
      openOrFocusChat(CHAT);
    });

    expect(tabsAt(`/chats/${CHAT}`)).toHaveLength(1);
  });

  it("opens one tab for two calls before a render", () => {
    const { result, tabsAt } = window();

    act(() => {
      result.current.openOrFocusChat(CHAT);
      result.current.openOrFocusChat(CHAT);
    });

    expect(tabsAt(`/chats/${CHAT}`)).toHaveLength(1);
  });

  it("brings up the tab that has the chat instead of opening another", () => {
    const { result, store, tabsAt } = window(`/chats/${CHAT}`);
    act(() => {
      result.current.openOrFocusChat(OTHER);
    });
    expect(store.get(appTabsAtom).selectedId).not.toBe(HOME);

    act(() => {
      result.current.openOrFocusChat(CHAT);
    });

    expect(store.get(appTabsAtom).selectedId).toBe(HOME);
    expect(tabsAt(`/chats/${CHAT}`)).toHaveLength(1);
  });

  it("opens a new tab with the chat up when none has it", () => {
    const { result, store, tabsAt } = window();

    act(() => {
      result.current.openOrFocusChat(CHAT);
    });

    const [opened] = tabsAt(`/chats/${CHAT}`);
    expect(store.get(appTabsAtom).selectedId).toBe(opened?.id);
  });
});

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

describe("opening what a tab already shows", () => {
  it.each(ONE_OF_A_KIND)(
    "brings up the tab showing %s rather than opening another",
    (_, asked, showing) => {
      const { result, store } = windowShowing(showing);

      act(() => {
        result.current.open(asked);
      });

      expect(store.get(appTabsAtom).selectedId).toBe(SHOWING);
      expect(store.get(appTabsAtom).tabs).toHaveLength(2);
    },
  );

  it.each(ONE_OF_A_KIND)(
    "brings up the tab showing %s rather than walking the tab up there",
    (_, asked, showing) => {
      const { result, store } = windowShowing(showing);

      act(() => {
        result.current.go(asked);
      });

      expect(store.get(appTabsAtom).selectedId).toBe(SHOWING);
      expect(store.get(appTabsAtom).tabs).toMatchObject([
        { id: UP, pathname: "/new-tab" },
        { id: SHOWING, pathname: showing },
      ]);
    },
  );

  it.each(ONE_OF_A_KIND)(
    "opens %s again in a tab of its own when one is asked for",
    (_, asked, showing) => {
      const { result, store } = windowShowing(showing);

      act(() => {
        result.current.open(asked, { newTab: true });
      });
      act(() => {
        result.current.go(asked, { newTab: true });
      });

      expect(store.get(appTabsAtom).tabs).toHaveLength(4);
    },
  );

  it("leaves a tab found behind where it is when the open waits behind", () => {
    const { result, store } = windowShowing(fileHref(NOTES));

    act(() => {
      result.current.open(fileHref(NOTES), { select: false });
    });

    expect(store.get(appTabsAtom).selectedId).toBe(UP);
    expect(store.get(appTabsAtom).tabs).toHaveLength(2);
  });

  it.each([
    ["the web's start", "/browser"],
    ["the inbox", "/chats"],
  ])("opens %s as it always has, since it is not one of a kind", (_, href) => {
    const { result, store } = windowShowing(href);

    act(() => {
      result.current.open(href);
    });

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

  it("asks main to bring forward another window's tab showing it", async () => {
    otherWindows.models = [
      {
        recentlyClosed: [],
        selectedId: "theirs",
        tabs: [{ id: "theirs", pathname: fileHref(NOTES) }],
      },
    ];
    showInOtherWindow.mockResolvedValue(true);
    const { result, store } = windowShowing("/apps");

    act(() => {
      result.current.open(fileHref(NOTES));
    });
    await vi.waitFor(() => {
      expect(showInOtherWindow).toHaveBeenCalledWith({
        href: fileHref(NOTES),
      });
    });

    expect(store.get(appTabsAtom).tabs).toHaveLength(2);
  });

  it("opens it here when only a window closed since has it", async () => {
    otherWindows.models = [
      {
        recentlyClosed: [],
        selectedId: "theirs",
        tabs: [{ id: "theirs", pathname: fileHref(NOTES) }],
      },
    ];
    showInOtherWindow.mockResolvedValue(false);
    const { result, store } = windowShowing("/apps");

    act(() => {
      result.current.open(fileHref(NOTES));
    });

    await vi.waitFor(() => {
      expect(store.get(appTabsAtom).tabs).toHaveLength(3);
    });
  });
});

describe("stepChat", () => {
  it.each([
    ["another tab in this window", "here"],
    ["a tab in another window", "elsewhere"],
  ])("walks the tab up to the next chat when %s has it", (_, where) => {
    const push = vi.fn();
    // Only the history a step walks: the tab up has no route mounted here.
    const router = {
      history: { location: { href: `/chats/${OTHER}` }, push },
    } as unknown as TabRouter;
    setTabRouter(UP, router);
    if (where === "elsewhere") {
      otherWindows.models = [
        {
          recentlyClosed: [],
          selectedId: "theirs",
          tabs: [{ id: "theirs", pathname: `/chats/${CHAT}` }],
        },
      ];
    }
    const { result, store } = windowShowing(
      where === "here" ? `/chats/${CHAT}` : "/apps",
    );

    act(() => {
      result.current.stepChat([OTHER, CHAT], OTHER, 1);
    });

    expect(push).toHaveBeenCalledWith(`/chats/${CHAT}`);
    expect(store.get(appTabsAtom).selectedId).toBe(UP);
    expect(store.get(appTabsAtom).tabs).toHaveLength(2);
    expect(showInOtherWindow).not.toHaveBeenCalled();
  });
});

describe("a tab found for an address that asks more of it", () => {
  const SINCE = "/release-notes?since=2.0.0";
  const SELECTED = folderHref(DOCUMENTS, { select: "a.txt" });

  it.each([
    ["the notes since a version", SINCE, "/release-notes"],
    [
      "a selection in a folder",
      SELECTED,
      `/files?path=&root=${encodeURIComponent(DOCUMENTS)}&view=list`,
    ],
  ])("walks a restored tab with no router yet to %s", (_, asked, showing) => {
    const { result, store } = windowShowing(showing);

    act(() => {
      result.current.open(asked);
    });

    const tabs = store.get(appTabsAtom);
    expect(tabs.selectedId).toBe(SHOWING);
    expect(tabs.tabs.find((tab) => tab.id === SHOWING)).toMatchObject({
      history: { entries: [showing, asked], index: 1 },
      pathname: asked,
    });
  });

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

  it("leaves a tab found for the bare address as it stands", () => {
    const walked = `/files?path=&root=${encodeURIComponent(DOCUMENTS)}&select=a.txt&view=list`;
    const { result, store } = windowShowing(walked);

    act(() => {
      result.current.open(folderHref(DOCUMENTS));
    });

    expect(
      store.get(appTabsAtom).tabs.find((tab) => tab.id === SHOWING),
    ).toEqual({ id: SHOWING, pathname: walked });
  });
});
