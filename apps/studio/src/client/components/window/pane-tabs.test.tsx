import { renderWithProviders } from "@/tests/render";
import { ChatIdSchema, StoreId } from "@instrument-org/workspace/client";
import { fireEvent, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { PaneTabs } from "./pane-tabs";
import { taskHref } from "./tab-location";

const CHAT = ChatIdSchema.parse("2026-11-17-compare-plans");
// Read by the tasks mock as it is made, ahead of the file's own lines.
const TASKS = vi.hoisted(() => ({
  done: "ses_01JAAAAAAAAAAAAAAAAAAAAAAA",
  working: "ses_01JBBBBBBBBBBBBBBBBBBBBBBB",
}));

// Where each task stands, as its chat's list says: one at work, one done.
vi.mock("./child-tasks-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./child-tasks-query")>()),
  useTasksOf: () =>
    new Map([
      [TASKS.done, { status: { kind: "done", line: "" }, working: false }],
      [
        TASKS.working,
        { status: { kind: "running", line: "Reading plans" }, working: true },
      ],
    ]),
}));

const tab = (id: string) => ({
  href: `/settings/${id}`,
  id,
  kind: "screen" as const,
});

const row = () => {
  const onClose = vi.fn();
  const onDuplicate = vi.fn();
  const onSelect = vi.fn();
  renderWithProviders(
    <PaneTabs
      chatTitles={new Map()}
      chosenId="a"
      onNew={() => {}}
      onClose={onClose}
      onDuplicate={onDuplicate}
      onSelect={onSelect}
      tabs={[tab("a"), tab("b")]}
      taskTitles={new Map()}
    />,
  );
  const [, second] = screen.getAllByRole("tab");
  if (!second) {
    throw new Error("the row has no second tab");
  }
  return { onClose, onDuplicate, onSelect, second };
};

describe("PaneTabs", () => {
  // jsdom has no layout, and so no scrolling a tab into view.
  beforeAll(() => {
    HTMLElement.prototype.scrollTo = () => {};
  });

  it.each([
    ["the tab", (pane: ReturnType<typeof row>) => pane.second],
    [
      "its name",
      (pane: ReturnType<typeof row>) => {
        const name = pane.second.querySelector("span + span");
        if (!name) {
          throw new Error("the tab has no name");
        }
        return name;
      },
    ],
    [
      "its close",
      (pane: ReturnType<typeof row>) =>
        within(pane.second).getByRole("button", { name: /^Close / }),
    ],
  ])("closes a tab on a middle press on %s", (_where, target) => {
    const pane = row();

    fireEvent.pointerDown(target(pane), { button: 1 });

    expect(pane.onClose).toHaveBeenCalledTimes(1);
    expect(pane.onSelect).not.toHaveBeenCalled();
  });

  // Drawn with no window around it, so with nowhere else to open a copy.
  it("offers a screen's tab the menu a window's tab has, without a reload", async () => {
    const pane = row();

    fireEvent.contextMenu(pane.second);

    const rows = (await screen.findAllByRole("menuitem")).map(
      (item) => item.textContent,
    );
    expect(rows).toEqual([
      "Duplicate",
      "Add to Bookmarks",
      "Close",
      "Close Other Tabs",
      "Close Tabs to the Left",
    ]);
  });

  it("closes the tabs other than the one its menu is for", async () => {
    const pane = row();

    fireEvent.contextMenu(pane.second);
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Close Other Tabs" }),
    );

    expect(pane.onClose).toHaveBeenCalledExactlyOnceWith("a");
  });

  // The menu opens at the pointer, which near the window's edge puts an item
  // under the right-click's own release.
  it("picks nothing on the release of the right-click that opened its menu", async () => {
    const pane = row();

    fireEvent.contextMenu(pane.second);
    fireEvent.pointerUp(
      await screen.findByRole("menuitem", { name: /^Close Tab/ }),
    );

    expect(pane.onClose).not.toHaveBeenCalled();
  });

  it("selects a tab on a left press on it, and keeps it", () => {
    const pane = row();

    fireEvent.pointerDown(pane.second, { button: 0 });

    expect(pane.onSelect).toHaveBeenCalledExactlyOnceWith("b");
    expect(pane.onClose).not.toHaveBeenCalled();
  });

  // The row is the window's strip, so the keyboard moves through it the same way.
  it("selects the next tab with the arrow keys, as a window's strip does", () => {
    const pane = row();

    fireEvent.keyDown(pane.second, { key: "ArrowRight" });

    expect(pane.onSelect).toHaveBeenCalledExactlyOnceWith("a");
  });

  describe("a side of a split group", () => {
    const sideOfSplit = () => {
      const onCloseSplit = vi.fn();
      const onJoinSides = vi.fn();
      const onNewChatInSplit = vi.fn();
      const view = renderWithProviders(
        <PaneTabs
          chatTitles={new Map()}
          chosenId="a"
          onClose={() => {}}
          onDuplicate={() => {}}
          onNew={() => {}}
          onSelect={() => {}}
          reopen={() => {}}
          split={{
            group: "g",
            hasKeyboard: true,
            hasOtherSide: true,
            onCloseSplit,
            onJoinSides,
            onMoveToNewGroup: undefined,
            onMoveToNewWindow: undefined,
            onMoveToOtherSide: () => {},
            onMoveToWindow: () => {},
            onNewChatInSplit,
            onOpenInSplit: () => {},
          }}
          tabs={[tab("a"), tab("b")]}
          taskTitles={new Map()}
        />,
      );
      return { onCloseSplit, onJoinSides, onNewChatInSplit, view };
    };

    it("offers the side's actions on a right click in the strip's empty space", async () => {
      const { onCloseSplit, view } = sideOfSplit();
      const strip = view.container.querySelector("[data-group-tabs]");
      if (!strip) {
        throw new Error("no strip");
      }

      fireEvent.contextMenu(strip);

      const rows = (await screen.findAllByRole("menuitem")).map(
        (item) => item.querySelector("span")?.textContent,
      );
      expect(rows).toEqual([
        "New Tab",
        "Reopen Closed Tab",
        "New Tab in Split",
        "Join Sides",
        "Close Split",
        "New Window",
      ]);
      fireEvent.click(screen.getByRole("menuitem", { name: /^Close Split/ }));
      expect(onCloseSplit).toHaveBeenCalledTimes(1);
    });

    it("offers Close Split in a tab's menu", async () => {
      const { onCloseSplit } = sideOfSplit();
      const [first] = screen.getAllByRole("tab");
      if (!first) {
        throw new Error("no tab");
      }

      fireEvent.contextMenu(first);
      fireEvent.click(
        await screen.findByRole("menuitem", { name: /^Close Split/ }),
      );

      expect(onCloseSplit).toHaveBeenCalledTimes(1);
    });
  });

  it("shimmers a task's tab, name and mark, only while the task works", () => {
    const working = StoreId.SessionSchema.parse(TASKS.working);
    const done = StoreId.SessionSchema.parse(TASKS.done);
    renderWithProviders(
      <PaneTabs
        chatTitles={new Map()}
        chosenId="w"
        onClose={() => {}}
        onDuplicate={() => {}}
        onNew={() => {}}
        onSelect={() => {}}
        tabs={[
          { href: taskHref(working, CHAT), id: "w", kind: "screen" },
          { href: taskHref(done, CHAT), id: "d", kind: "screen" },
        ]}
        taskTitles={
          new Map([
            [working, "Compare plans"],
            [done, "Book the hotel"],
          ])
        }
      />,
    );
    const [atWork, finished] = screen.getAllByRole("tab");

    expect(atWork?.querySelector(".brand-shiny-text")?.textContent).toContain(
      "Compare plans",
    );
    expect(atWork?.querySelector(".brand-shiny-icon")).not.toBeNull();
    expect(finished?.querySelector(".brand-shiny-text")).toBeNull();
    expect(finished?.querySelector(".brand-shiny-icon")).toBeNull();
  });

  it("opens and closes a tab with the window's motions", () => {
    const view = renderWithProviders(panes([tab("a"), tab("b")]));

    view.rerender(panes([tab("a"), tab("b"), tab("c")]));
    expect(view.container.querySelector(".pane-tab-arriving")).not.toBeNull();

    view.rerender(panes([tab("a"), tab("c")]));
    expect(
      view.container.querySelector('[role="tab"][aria-hidden]'),
    ).not.toBeNull();
  });
});

function panes(tabs: ReturnType<typeof tab>[]) {
  return (
    <PaneTabs
      chatTitles={new Map()}
      chosenId="a"
      onNew={() => {}}
      onClose={() => {}}
      onDuplicate={() => {}}
      onSelect={() => {}}
      tabs={tabs}
      taskTitles={new Map()}
    />
  );
}
