import { renderWithProviders } from "@/tests/render";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { type StripTab, TabStrip } from "./tab-strip";

const tab = (key: string): StripTab => ({
  icon: null,
  key,
  title: key,
  tooltip: { detail: `${key} detail`, title: key },
});

const strip = (tabs: StripTab[]) => (
  <TabStrip
    onClose={() => {}}
    onReorder={() => {}}
    onSelect={() => {}}
    selectedKey="b"
    tabs={tabs}
  />
);

describe("TabStrip", () => {
  // The collapse is a CSS transition, which runs only on the element that
  // was drawn whole a frame before.
  it("collapses a closed tab with a tooltip on the element it was drawn as", () => {
    const view = renderWithProviders(strip([tab("a"), tab("b"), tab("c")]));
    const before = screen.getByRole("tab", { name: "b" });

    view.rerender(strip([tab("a"), tab("c")]));

    const closing = view.container.querySelector('[role="tab"][aria-hidden]');
    expect(closing).toBe(before);
  });

  // A window given another's tabs: they were already open, and five tabs
  // opening at once is not what happened.
  it("takes on a whole other set of tabs with nothing opening or closing", () => {
    const view = renderWithProviders(strip([tab("a"), tab("b")]));

    view.rerender(strip([tab("x"), tab("y"), tab("z")]));

    expect(
      view.container.querySelector('[role="tab"][aria-hidden]'),
    ).toBeNull();
    expect(view.container.querySelector(".pane-tab-arriving")).toBeNull();
    expect(screen.getAllByRole("tab")).toHaveLength(3);
  });

  it("opens a tab beside the others with its motion", () => {
    const view = renderWithProviders(strip([tab("a"), tab("b")]));

    view.rerender(strip([tab("a"), tab("b"), tab("c")]));

    expect(view.container.querySelector(".pane-tab-arriving")).not.toBeNull();
  });
});
