import { createTabRouter } from "@/client/lib/tab-router";
import { TabIdSchema } from "@/shared/tabs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { act, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { appTabsAtom } from "./window/app-tabs";
import { GroupTabContext } from "./window/group-tab";
import { missingHref } from "./window/missing-page";

// Sending a report is the report button's own business, tested with it;
// here it shows the message it would send.
vi.mock("./report-error-button", () => ({
  ReportErrorButton: ({ error }: { error: Error }) => (
    <span>{error.message}</span>
  ),
}));

// The root route's theme reads the system's through `matchMedia`, which is
// not here.
vi.mock("./theme-provider", () => ({
  ThemeProvider: ({ children }: { children: ReactNode }) => children,
}));

const WINDOW_TAB = TabIdSchema.parse("window");

afterEach(() => {
  window.api.windowType = undefined;
});

/**
 * A tab's router at `entries`, the last up, drawn in a group's tab when
 * `closeTab` is given, and in the window's own tab otherwise.
 */
async function tabAt(entries: string[], closeTab?: () => void) {
  window.api.windowType = "app";
  const store = createStore();
  store.set(appTabsAtom, {
    recentlyClosed: [],
    selectedId: WINDOW_TAB,
    tabs: [{ id: WINDOW_TAB, pathname: "/chats" }],
  });
  const router = createTabRouter({
    history: { entries, index: entries.length - 1 },
    pathname: entries.at(-1) ?? "",
  });
  await act(() => router.load());
  const view = render(
    <QueryClientProvider client={new QueryClient()}>
      <Provider store={store}>
        {closeTab ? (
          <GroupTabContext
            value={{
              close: closeTab,
              id: "tab_missing",
              isShown: true,
              showPage: () => {},
              step: () => undefined,
              versionsOf: undefined,
            }}
          >
            <RouterProvider router={router} />
          </GroupTabContext>
        ) : (
          <RouterProvider router={router} />
        )}
      </Provider>
    </QueryClientProvider>,
  );
  return { router, store, view };
}

describe("a group's tab at a page that doesn't exist", () => {
  it("says so, with ways out for that tab and the address it was asked for in its report", async () => {
    const closeTab = vi.fn();
    const { store } = await tabAt(
      ["/files?path=&root=~", "/removed-page?from=older-build"],
      closeTab,
    );
    expect(await screen.findByText("Page not found")).toBeDefined();
    expect(
      screen.getByText("No screen at /removed-page?from=older-build"),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Go back" })).toBeDefined();
    act(() => {
      screen.getByRole("button", { name: "Close tab" }).click();
    });
    expect(closeTab).toHaveBeenCalledOnce();
    // The window's own tab, and with it the window, stays.
    expect(store.get(appTabsAtom).tabs.map((tab) => tab.id)).toEqual([
      WINDOW_TAB,
    ]);
  });

  it("reports an instrument address the app doesn't know as it was typed, with no Go back for a tab with no history", async () => {
    await tabAt([missingHref("instrument://nowhere/x")], vi.fn());
    expect(
      await screen.findByText("No screen at instrument://nowhere/x"),
    ).toBeDefined();
    expect(screen.queryByRole("button", { name: "Go back" })).toBeNull();
  });
});

describe("the window's own tab at a page that doesn't exist", () => {
  it("draws nothing, since the window moves the address into a group's tab", async () => {
    const { view } = await tabAt(["/removed-page"]);
    expect(view.container.textContent).toBe("");
  });
});
