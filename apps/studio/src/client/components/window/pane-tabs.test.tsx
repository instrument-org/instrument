import { renderWithProviders } from "@/tests/render";
import { fireEvent, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { PaneTabs } from "./pane-tabs";

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
      isChatWorking={false}
      onAddComputer={() => {}}
      onAddWeb={() => {}}
      onClose={onClose}
      onDuplicate={onDuplicate}
      onHide={() => {}}
      onReorder={() => {}}
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
    expect(rows).toEqual(["Duplicate Tab", "Close Tab", "Close Other Tabs"]);
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
      isChatWorking={false}
      onAddComputer={() => {}}
      onAddWeb={() => {}}
      onClose={() => {}}
      onDuplicate={() => {}}
      onHide={() => {}}
      onReorder={() => {}}
      onSelect={() => {}}
      tabs={tabs}
      taskTitles={new Map()}
    />
  );
}
