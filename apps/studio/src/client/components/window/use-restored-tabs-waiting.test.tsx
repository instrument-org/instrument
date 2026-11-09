import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { type Tab, TabIdSchema } from "@/shared/tabs";

import { useRestoredTabsWaiting } from "./use-restored-tabs-waiting";

const tab = (id: string): Tab => ({
  id: TabIdSchema.parse(id),
  pathname: `/chats/${id}`,
});

const restored = [tab("a"), tab("b"), tab("c")];

describe("useRestoredTabsWaiting", () => {
  it("draws the tab in front and every tab once it has come up, while the rest wait", () => {
    const view = renderHook(
      ({ selected, tabs }) =>
        useRestoredTabsWaiting(tabs, TabIdSchema.parse(selected)),
      { initialProps: { selected: "b", tabs: restored } },
    );
    expect([...view.result.current]).toEqual(["a", "c"]);

    view.rerender({ selected: "c", tabs: restored });
    expect([...view.result.current]).toEqual(["a"]);

    view.rerender({ selected: "b", tabs: restored });
    expect([...view.result.current]).toEqual(["a"]);
  });

  it("draws a tab opened since the launch at once, in front or not", () => {
    const view = renderHook(
      ({ selected, tabs }) =>
        useRestoredTabsWaiting(tabs, TabIdSchema.parse(selected)),
      { initialProps: { selected: "a", tabs: restored } },
    );

    view.rerender({ selected: "a", tabs: [...restored, tab("d")] });

    expect(view.result.current.has(TabIdSchema.parse("d"))).toBe(false);
  });
});
