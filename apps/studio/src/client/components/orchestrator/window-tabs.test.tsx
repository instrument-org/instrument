import {
  APPS_HREF,
  draftGroupOf,
  NEW_TAB_HREF,
  placeGroupOf,
  THREADS_HREF,
  type WindowTab,
  windowTabsAtom,
} from "@/client/atoms/orchestrator";
import { renderWithProviders } from "@/tests/render";
import { StoreId } from "@instrument-org/workspace/client";
import { act, fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { threadOfHrefPrefix, useWindowTabs } from "./window-tabs";

const THREAD_A = StoreId.newSessionId();
const THREAD_B = StoreId.newSessionId();

function Navigation() {
  const tabs = useWindowTabs();
  return (
    <>
      <button
        onClick={() => {
          tabs.navigateScreen("/orchestrator/computer");
        }}
      >
        Folder
      </button>
      <button
        onClick={() => {
          tabs.navigateScreen("/orchestrator/apps");
        }}
      >
        Apps
      </button>
      <button onClick={() => tabs.step(-1)}>Back</button>
      <button onClick={() => tabs.stepVisit(-1)}>Previous visit</button>
      <button onClick={() => tabs.stepVisit(1)}>Next visit</button>
      <button onClick={() => tabs.openOrFocusScreen("/orchestrator/computer")}>
        Conversation file
      </button>
      <button onClick={() => tabs.openScreen(`${THREADS_HREF}/${THREAD_A}`)}>
        Thread A
      </button>
      <button onClick={() => tabs.openScreen(`${THREADS_HREF}/${THREAD_B}`)}>
        Thread B
      </button>
      <button onClick={() => tabs.openScreen("/orchestrator/apps")}>
        Open apps
      </button>
      <button
        onClick={() => {
          tabs.closeActive();
        }}
      >
        Close active
      </button>
      <button
        onClick={() => {
          tabs.leaveGroup();
        }}
      >
        Leave
      </button>
      <button
        onClick={() => {
          tabs.showDraft("d1");
        }}
      >
        Draft
      </button>
      <button
        onClick={() => {
          tabs.openScreen(NEW_TAB_HREF);
        }}
      >
        Home
      </button>
      <button
        onClick={() => {
          tabs.adoptGroup(draftGroupOf("d1"), THREAD_B);
        }}
      >
        Adopt
      </button>
      <button
        onClick={() => {
          tabs.openScreen("/orchestrator/ideas", { group: THREAD_B });
        }}
      >
        Open ideas for B
      </button>
      <button
        onClick={() => {
          tabs.showPlace("apps");
        }}
      >
        Apps place
      </button>
      <span data-testid="strip">
        {tabs.tabs
          .map((tab) => (tab.kind === "screen" ? tab.href : tab.url))
          .join("|")}
      </span>
    </>
  );
}

/** A window with one group up, holding the tab given; every tab belongs to a group. */
function setup(tab: WindowTab) {
  const { store } = renderWithProviders(<Navigation />);
  act(() => {
    store.set(windowTabsAtom, {
      activeId: tab.id,
      group: "g",
      tabs: [{ ...tab, group: "g" }],
    });
  });
  return () => store.get(windowTabsAtom);
}

describe("window navigation", () => {
  it("keeps ordinary screen navigation in one tab with a back trail", () => {
    const read = setup({
      href: "/orchestrator/tasks/example",
      id: "task",
      kind: "screen",
    });
    fireEvent.click(screen.getByText("Folder"));
    expect(read().tabs).toHaveLength(1);
    fireEvent.click(screen.getByText("Back"));
    expect(read().tabs[0]).toMatchObject({
      href: "/orchestrator/tasks/example",
      id: "task",
    });
    fireEvent.click(screen.getByText("Apps"));
    expect(read().tabs[0]).toMatchObject({
      trail: ["/orchestrator/tasks/example", "/orchestrator/apps"],
    });
  });

  it("reuses the website's tab and restores its guest through Back and Forward", () => {
    const page: WindowTab = {
      id: "guest",
      kind: "page",
      openedAt: 1,
      url: "https://example.com",
    };
    const read = setup(page);
    fireEvent.click(screen.getByText("Folder"));
    expect(read().tabs).toHaveLength(1);
    expect(read().tabs[0]).toMatchObject({ kind: "screen", stripKey: "guest" });
    fireEvent.click(screen.getByText("Previous visit"));
    expect(read().tabs[0]).toMatchObject(page);
    fireEvent.click(screen.getByText("Next visit"));
    expect(read().tabs[0]).toMatchObject({
      href: "/orchestrator/computer",
      kind: "screen",
    });
  });

  it("opens conversation destinations separately and focuses an existing destination", () => {
    const read = setup({
      href: "/orchestrator/tasks/example",
      id: "task",
      kind: "screen",
    });
    fireEvent.click(screen.getByText("Conversation file"));
    expect(read().tabs).toHaveLength(2);
    expect(read().tabs[0]?.id).toBe("task");
    fireEvent.click(screen.getByText("Conversation file"));
    expect(read().tabs).toHaveLength(2);
  });
});

describe("a thread's tabs", () => {
  const strip = () => screen.getByTestId("strip").textContent;
  const active = (read: () => { activeId: null | string; tabs: WindowTab[] }) =>
    read().tabs.find((tab) => tab.id === read().activeId);

  it("keeps each thread's tabs in a group of its own, with the thread over them rather than among them", () => {
    const read = setup({
      href: "/orchestrator/apps",
      id: "apps",
      kind: "screen",
    });
    fireEvent.click(screen.getByText("Thread A"));
    expect(read().group).toBe(THREAD_A);
    expect(strip()).toBe("");
    expect(read().activeId).toBeNull();
    // Opened while the thread is up, so the thread's.
    fireEvent.click(screen.getByText("Open apps"));
    expect(strip()).toBe("/orchestrator/apps");
    expect(active(read)?.group).toBe(THREAD_A);
    // Another thread swaps the whole row.
    fireEvent.click(screen.getByText("Thread B"));
    expect(strip()).toBe("");
    // Coming back lands where the thread was left; asking again while it is
    // up changes nothing.
    fireEvent.click(screen.getByText("Thread A"));
    expect(strip()).toBe("/orchestrator/apps");
    expect(active(read)).toMatchObject({ href: "/orchestrator/apps" });
    const before = read();
    fireEvent.click(screen.getByText("Thread A"));
    expect(read()).toBe(before);
    // Leaving shows nothing; every group keeps what it has.
    fireEvent.click(screen.getByText("Leave"));
    expect(read().group).toBeUndefined();
    expect(strip()).toBe("");
    expect(read().tabs).toHaveLength(2);
  });

  it("closes a thread's last tab and keeps the thread up with nothing under it", () => {
    const read = setup({
      href: "/orchestrator/apps",
      id: "apps",
      kind: "screen",
    });
    fireEvent.click(screen.getByText("Thread A"));
    fireEvent.click(screen.getByText("Open apps"));
    fireEvent.click(screen.getByText("Close active"));
    expect(read().group).toBe(THREAD_A);
    expect(strip()).toBe("");
    expect(read().activeId).toBeNull();
    fireEvent.click(screen.getByText("Open apps"));
    expect(strip()).toBe("/orchestrator/apps");
  });

  it("files a tab opened for a thread that is not up in that thread's group, behind", () => {
    const read = setup({
      href: "/orchestrator/apps",
      id: "apps",
      kind: "screen",
    });
    fireEvent.click(screen.getByText("Thread A"));
    fireEvent.click(screen.getByText("Open ideas for B"));
    // Still on A, with nothing under it.
    expect(read().group).toBe(THREAD_A);
    expect(strip()).toBe("");
    // B's group was made by the tab landing in it.
    fireEvent.click(screen.getByText("Thread B"));
    expect(strip()).toBe("/orchestrator/ideas");
  });
});

describe("a draft's tabs", () => {
  const strip = () => screen.getByTestId("strip").textContent;

  it("gathers from the new-tab page and hands everything to the thread exactly as it is", () => {
    const read = setup({
      href: "/orchestrator/apps",
      id: "apps",
      kind: "screen",
    });
    fireEvent.click(screen.getByText("Draft"));
    expect(read().group).toBe(draftGroupOf("d1"));
    fireEvent.click(screen.getByText("Home"));
    expect(strip()).toBe(NEW_TAB_HREF);
    // The home page is a tab like any other: a screen it is sent to takes
    // its place, and a second thing asked for as a tab of its own lands
    // beside it.
    fireEvent.click(screen.getByText("Apps"));
    fireEvent.click(screen.getByText("Conversation file"));
    expect(strip()).toBe("/orchestrator/apps|/orchestrator/computer");
    const gathered = read()
      .tabs.filter((tab) => tab.group === draftGroupOf("d1"))
      .map((tab) => tab.id);
    const up = read().activeId;
    fireEvent.click(screen.getByText("Adopt"));
    expect(read().group).toBe(THREAD_B);
    expect(strip()).toBe("/orchestrator/apps|/orchestrator/computer");
    // The same tabs, under the thread now, the same one up.
    expect(
      read()
        .tabs.filter((tab) => tab.group === THREAD_B)
        .map((tab) => tab.id),
    ).toEqual(gathered);
    expect(read().activeId).toBe(up);
    expect(read().tabs.some((tab) => tab.group === draftGroupOf("d1"))).toBe(
      false,
    );
    // The group handed over is gone from the memory of what each group had
    // up, so a window that starts many drafts does not keep a key per one.
    expect(read().activeByGroup ?? {}).not.toHaveProperty(draftGroupOf("d1"));
  });

  // A task the thread started can open its browser before the start comes
  // back, and its tab is filed under the thread's own id then; adoption
  // keeps it beside what the draft gathered rather than dropping it.
  it("keeps a tab already filed under the thread when the draft is handed over", () => {
    const read = setup({
      href: "/orchestrator/apps",
      id: "apps",
      kind: "screen",
    });
    fireEvent.click(screen.getByText("Draft"));
    fireEvent.click(screen.getByText("Home"));
    fireEvent.click(screen.getByText("Apps"));
    fireEvent.click(screen.getByText("Open ideas for B"));
    expect(read().tabs.filter((tab) => tab.group === THREAD_B)).toHaveLength(1);
    fireEvent.click(screen.getByText("Adopt"));
    expect(
      read()
        .tabs.filter((tab) => tab.group === THREAD_B)
        .map((tab) => (tab.kind === "screen" ? tab.href : tab.url)),
    ).toEqual(["/orchestrator/ideas", "/orchestrator/apps"]);
    expect(strip()).toBe("/orchestrator/ideas|/orchestrator/apps");
  });

  it("never runs out of tabs: closing the last one puts the new-tab page back", () => {
    const read = setup({
      href: "/orchestrator/apps",
      id: "apps",
      kind: "screen",
    });
    fireEvent.click(screen.getByText("Draft"));
    fireEvent.click(screen.getByText("Home"));
    fireEvent.click(screen.getByText("Apps"));
    expect(strip()).toBe("/orchestrator/apps");
    fireEvent.click(screen.getByText("Close active"));
    expect(strip()).toBe(NEW_TAB_HREF);
    expect(read().activeId).not.toBeNull();
  });
});

describe("a place's tabs", () => {
  const strip = () => screen.getByTestId("strip").textContent;

  it("comes up on its own kind of new tab, keeps it, and never runs out of tabs", () => {
    const read = setup({
      href: "/orchestrator/computer",
      id: "folder",
      kind: "screen",
    });
    fireEvent.click(screen.getByText("Apps place"));
    expect(read().group).toBe(placeGroupOf("apps"));
    expect(strip()).toBe(APPS_HREF);
    // A tab opened in the place is the place's; leaving and coming back
    // lands on it.
    fireEvent.click(screen.getByText("Conversation file"));
    expect(strip()).toBe(`${APPS_HREF}|/orchestrator/computer`);
    fireEvent.click(screen.getByText("Thread A"));
    expect(strip()).toBe("");
    fireEvent.click(screen.getByText("Apps place"));
    expect(strip()).toBe(`${APPS_HREF}|/orchestrator/computer`);
    expect(read().activeId).toBe(
      read().tabs.find(
        (tab) =>
          tab.group === placeGroupOf("apps") &&
          tab.kind === "screen" &&
          tab.href === "/orchestrator/computer",
      )?.id,
    );
    // Closing the last tab puts the place's own new tab back rather than
    // the page that reaches everything.
    fireEvent.click(screen.getByText("Close active"));
    fireEvent.click(screen.getByText("Close active"));
    expect(strip()).toBe(APPS_HREF);
    expect(read().activeId).not.toBeNull();
  });
});

describe("threadOfHrefPrefix", () => {
  const threads = [
    StoreId.SessionSchema.parse("ses_01JAAAAAAAAAAAAAAAAAAAAAAA"),
    StoreId.SessionSchema.parse("ses_01JABBBBBBBBBBBBBBBBBBBBBB"),
    StoreId.SessionSchema.parse("ses_01JCCCCCCCCCCCCCCCCCCCCCCC"),
  ];

  it.each([
    ["the start of one id", "/orchestrator/threads/ses_01JC", threads[2]],
    [
      "a whole id",
      "/orchestrator/threads/ses_01JAAAAAAAAAAAAAAAAAAAAAAA",
      threads[0],
    ],
    ["an id in the wrong case", "/orchestrator/threads/SES_01jcc", threads[2]],
    ["a start two ids share", "/orchestrator/threads/ses_01JA", undefined],
    ["a start no id has", "/orchestrator/threads/ses_01JZ", undefined],
    ["the threads as a whole", "/orchestrator/threads", undefined],
    ["another screen", "/orchestrator/tasks/ses_01JC", undefined],
  ])("resolves %s", (_case, href, expected) => {
    expect(threadOfHrefPrefix(href, threads)).toBe(expected);
  });
});
