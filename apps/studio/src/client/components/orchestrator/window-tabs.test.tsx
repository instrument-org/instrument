import {
  draftGroupOf,
  NEW_TAB_HREF,
  THREADS_HREF,
  type WindowTab,
  windowTabsAtom,
} from "@/client/atoms/orchestrator";
import { renderWithProviders } from "@/tests/render";
import { StoreId } from "@instrument-org/workspace/client";
import { act, fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useWindowTabs } from "./window-tabs";

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
  const threadA = `${THREADS_HREF}/${THREAD_A}`;
  const threadB = `${THREADS_HREF}/${THREAD_B}`;

  it("keeps each thread's tabs in a group of its own, the thread itself first and held there", () => {
    const read = setup({
      href: "/orchestrator/apps",
      id: "apps",
      kind: "screen",
    });
    fireEvent.click(screen.getByText("Thread A"));
    expect(read().group).toBe(THREAD_A);
    expect(strip()).toBe(threadA);
    // Opened while the thread is up, so the thread's.
    fireEvent.click(screen.getByText("Open apps"));
    expect(strip()).toBe(`${threadA}|/orchestrator/apps`);
    expect(read().tabs.find((tab) => tab.id === read().activeId)?.group).toBe(
      THREAD_A,
    );
    // Another thread swaps the whole row.
    fireEvent.click(screen.getByText("Thread B"));
    expect(strip()).toBe(threadB);
    // Coming back lands where the thread was left; asking again while it is
    // up lands on the thread itself.
    fireEvent.click(screen.getByText("Thread A"));
    expect(strip()).toBe(`${threadA}|/orchestrator/apps`);
    const active = () => read().tabs.find((tab) => tab.id === read().activeId);
    expect(active()).toMatchObject({ href: "/orchestrator/apps" });
    fireEvent.click(screen.getByText("Thread A"));
    expect(active()).toMatchObject({ href: threadA });
    // Leaving shows nothing; every group keeps what it has.
    fireEvent.click(screen.getByText("Leave"));
    expect(read().group).toBeUndefined();
    expect(strip()).toBe("");
    expect(read().tabs).toHaveLength(4);
  });

  it("never closes the thread's own tab, and sends what the thread's screen is sent to beside it", () => {
    const read = setup({
      href: "/orchestrator/apps",
      id: "apps",
      kind: "screen",
    });
    fireEvent.click(screen.getByText("Thread A"));
    fireEvent.click(screen.getByText("Close active"));
    expect(strip()).toBe(threadA);
    // Navigating the thread's screen elsewhere opens a tab rather than
    // moving the thread.
    fireEvent.click(screen.getByText("Folder"));
    expect(strip()).toBe(`${threadA}|/orchestrator/computer`);
    expect(
      read().tabs.find((tab) => tab.kind === "screen" && tab.href === threadA),
    ).toMatchObject({ trail: [threadA] });
    fireEvent.click(screen.getByText("Close active"));
    expect(strip()).toBe(threadA);
  });

  it("files a tab opened for a thread that is not up in that thread's group, behind", () => {
    const read = setup({
      href: "/orchestrator/apps",
      id: "apps",
      kind: "screen",
    });
    fireEvent.click(screen.getByText("Thread A"));
    fireEvent.click(screen.getByText("Open ideas for B"));
    // Still on A, at the tab it had.
    expect(read().group).toBe(THREAD_A);
    expect(strip()).toBe(threadA);
    // B's group was made for it, its own screen first.
    fireEvent.click(screen.getByText("Thread B"));
    expect(strip()).toBe(`${threadB}|/orchestrator/ideas`);
  });
});

describe("a draft's tabs", () => {
  const strip = () => screen.getByTestId("strip").textContent;
  const threadB = `${THREADS_HREF}/${THREAD_B}`;

  it("starts at the new-tab page, gathers beside it, and hands everything to the thread as it is", () => {
    const read = setup({
      href: "/orchestrator/apps",
      id: "apps",
      kind: "screen",
    });
    fireEvent.click(screen.getByText("Draft"));
    expect(read().group).toBe(draftGroupOf("d1"));
    expect(strip()).toBe(NEW_TAB_HREF);
    // Opened from the home page: beside it, never in its place; a second
    // thing asked for as a tab of its own lands beside that.
    fireEvent.click(screen.getByText("Apps"));
    fireEvent.click(screen.getByText("Conversation file"));
    expect(strip()).toBe(
      `${NEW_TAB_HREF}|/orchestrator/apps|/orchestrator/computer`,
    );
    const gathered = read()
      .tabs.filter((tab) => tab.group === draftGroupOf("d1"))
      .slice(1)
      .map((tab) => tab.id);
    fireEvent.click(screen.getByText("Adopt"));
    expect(read().group).toBe(THREAD_B);
    expect(strip()).toBe(
      `${threadB}|/orchestrator/apps|/orchestrator/computer`,
    );
    // The same tabs, under the thread now; the draft's home is gone.
    expect(
      read()
        .tabs.filter((tab) => tab.group === THREAD_B)
        .slice(1)
        .map((tab) => tab.id),
    ).toEqual(gathered);
    expect(read().tabs.some((tab) => tab.group === draftGroupOf("d1"))).toBe(
      false,
    );
    expect(read().tabs.find((tab) => tab.id === read().activeId)).toMatchObject(
      { anchor: true, href: threadB },
    );
  });
});
