import { renderWithProviders } from "@/tests/render";
import { fireEvent, screen } from "@testing-library/react";
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
  if (!second?.parentElement) {
    throw new Error("the row has no second tab");
  }
  return {
    onClose,
    onDuplicate,
    onSelect,
    second,
    surface: second.parentElement,
  };
};

describe("PaneTabs", () => {
  // jsdom has no layout, and so no scrolling a tab into view.
  beforeAll(() => {
    HTMLElement.prototype.scrollTo = () => {};
  });

  it.each([
    ["its label", (pane: ReturnType<typeof row>) => pane.second],
    ["its padding", (pane: ReturnType<typeof row>) => pane.surface],
    [
      "its close",
      (pane: ReturnType<typeof row>) => {
        const close = pane.surface.lastElementChild;
        if (!close) {
          throw new Error("the tab has no close");
        }
        return close;
      },
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

  it("keeps a tab on a left press on it", () => {
    const pane = row();

    fireEvent.pointerDown(pane.second, { button: 0 });

    expect(pane.onClose).not.toHaveBeenCalled();
  });
});
