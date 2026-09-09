import { type WindowTab, windowTabsAtom } from "@/client/atoms/orchestrator";
import { renderWithProviders } from "@/tests/render";
import { act, fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useWindowTabs } from "./window-tabs";

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
    </>
  );
}

function setup(tab: WindowTab) {
  const { store } = renderWithProviders(<Navigation />);
  act(() => {
    store.set(windowTabsAtom, { activeId: tab.id, tabs: [tab] });
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
