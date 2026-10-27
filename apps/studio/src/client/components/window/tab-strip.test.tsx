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
});
