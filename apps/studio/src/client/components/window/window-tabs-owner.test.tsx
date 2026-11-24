import {
  type TabsAsk,
  type TabsChanged,
  WINDOW_TABS_KEY,
} from "@/shared/kept-state";
import { act, renderHook } from "@testing-library/react";
import { createStore, Provider, useAtomValue } from "jotai";
import { type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { splitTabGroups } from "./tab-members";
import { type WindowTabs } from "./tab-model";

const GROUP = "group:a";
const KEY = `${WINDOW_TABS_KEY}/${GROUP}`;

const screen = (id: string, href: string) =>
  ({ group: GROUP, href, id, kind: "screen" }) as const;

/** A group as the main process keeps it, with these tabs and the last one up. */
const member = (...tabs: ReturnType<typeof screen>[]) =>
  splitTabGroups({
    activeByGroup: { [GROUP]: tabs.at(-1)?.id ?? "" },
    groups: {},
    tabs,
  } satisfies WindowTabs).get(GROUP);

const home = screen("t1", "/files?path=%2Fhome");

/** The main process as a window reaches it: what it was asked, and a way to tell the window what changed. */
function owner() {
  const asked: TabsAsk[] = [];
  let tell: (told: TabsChanged) => void = () => undefined;
  window.api.keptState = {
    askTabs: (ask) => {
      asked.push(ask);
    },
    initial: { groups: { [KEY]: member(home) } },
    onChange: () => () => undefined,
    onTabsChanged: (listener) => {
      tell = listener;
      return () => undefined;
    },
    otherWindows: () => [],
    set: () => undefined,
  };
  return {
    asked,
    tell: (told: TabsChanged) => {
      act(() => {
        tell(told);
      });
    },
  };
}

/** This window's tabs, read and changed as its screens do, over a main process of its own. */
async function drawWindow() {
  vi.resetModules();
  const main = owner();
  const { useWindowTabsChange, windowTabsAtom } = await import("./window-tabs");
  const store = createStore();
  const { result } = renderHook(
    () => ({
      change: useWindowTabsChange(),
      tabs: useAtomValue(windowTabsAtom),
    }),
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <Provider store={store}>{children}</Provider>
      ),
    },
  );
  return {
    ...main,
    ids: () =>
      result.current.tabs.tabs
        .filter((tab) => tab.group === GROUP)
        .map((tab) => tab.id),
    pick: (id: string) => {
      act(() => {
        result.current.change("pickTab", id);
      });
    },
    openScreen: (id: string) => {
      act(() => {
        result.current.change("openScreen", {
          group: GROUP,
          href: "/settings",
          id,
          select: true,
        });
      });
    },
  };
}

describe("a window's tabs, which the main process owns", () => {
  const was = window.api.keptState;
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    window.api.keptState = was;
  });

  it("shows a change it asked for at once, and asks the main process for it", async () => {
    const drawn = await drawWindow();
    drawn.openScreen("mine");

    expect(drawn.ids()).toEqual(["t1", "mine"]);
    expect(drawn.asked.map((ask) => ask.command.op)).toEqual(["openScreen"]);
  });

  it("lays what it asked over what another window changed meanwhile", async () => {
    const drawn = await drawWindow();
    drawn.openScreen("mine");
    drawn.tell({
      changes: [["groups", KEY, member(home, screen("theirs", "/activity"))]],
    });

    expect(drawn.ids()).toEqual(["t1", "theirs", "mine"]);
  });

  it("shows what the main process made of an ask once it answers, whatever it expected", async () => {
    const drawn = await drawWindow();
    drawn.openScreen("mine");
    const [ask] = drawn.asked;
    drawn.tell({
      answers: ask?.id ?? "",
      changes: [
        [
          "groups",
          KEY,
          member(
            home,
            screen("theirs", "/activity"),
            screen("mine", "/settings"),
          ),
        ],
      ],
    });
    expect(drawn.ids()).toEqual(["t1", "theirs", "mine"]);

    // Told since that the tab is gone, it is not laid over again.
    drawn.tell({ changes: [["groups", KEY, member(home)]] });
    expect(drawn.ids()).toEqual(["t1"]);
  });

  it("lets go of an ask the main process answered with no change", async () => {
    const drawn = await drawWindow();
    drawn.openScreen("mine");
    const [ask] = drawn.asked;
    drawn.tell({ answers: ask?.id ?? "", changes: [] });

    expect(drawn.ids()).toEqual(["t1"]);
  });

  it("asks nothing for a change that changes nothing here", async () => {
    const drawn = await drawWindow();
    drawn.pick("t1");

    expect(drawn.asked).toEqual([]);
  });
});
