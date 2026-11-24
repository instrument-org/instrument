import { renderWithProviders } from "@/tests/render";
import { browserTargetOf, StoreId } from "@instrument-org/workspace/client";
import { act } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { BrowserTabs } from "./browser-tabs";
import { windowTabGroupsAtom } from "./open-groups";
import { seedWindowTabsAtom, windowTabsAtom } from "./window-tabs";

const GROUP = "group_a";
const PAGE = StoreId.newTabId();
const OTHER = StoreId.newTabId();

const pool = vi.hoisted(() => {
  const listeners = new Set<(event: string) => void>();
  return {
    attached: new Set<string>(),
    heard: (event: string) => {
      for (const listener of listeners) {
        listener(event);
      }
    },
    listeners,
    redraw: () => {},
    stepping: new Set<string>(),
    url: "https://b.example/",
  };
});

vi.mock("@/client/lib/browser-pool", () => ({
  getGuest: () => ({
    on: (event: string, listener: (fired: object) => void) => {
      const relay = (fired: string) => {
        if (fired === event) {
          listener({});
        }
      };
      pool.listeners.add(relay);
      return () => {
        pool.listeners.delete(relay);
      };
    },
    title: () => "",
    url: () => pool.url,
  }),
  hasGuestTraversal: (target: string) => pool.stepping.has(target),
  setPagePanes: () => {},
  takeGuestTraversal: (target: string) => pool.stepping.delete(target),
}));

vi.mock("@/client/hooks/use-browser-targets", async () => {
  const { useState } = await import("react");
  return {
    useBrowserTargets: () => {
      const [attached, setAttached] = useState<ReadonlySet<string>>(
        pool.attached,
      );
      pool.redraw = () => {
        setAttached(new Set(pool.attached));
      };
      return attached;
    },
  };
});

vi.mock("@/client/components/window/browser-panel", () => ({
  BrowserPanel: () => null,
}));
vi.mock("./page-edit", () => ({
  PageEditMenuItem: () => null,
  PageEditSession: () => null,
}));
vi.mock("./ask-tray", () => ({ AskTray: () => null }));

vi.mock("@/client/rpc/client", () => {
  const pending = () => new Promise(() => undefined);
  const procedure = (path: string[]): unknown =>
    new Proxy(() => undefined, {
      apply: pending,
      get(_target, key) {
        if (key === "queryOptions" || key === "experimental_liveOptions") {
          return () => ({ queryFn: pending, queryKey: path });
        }
        return typeof key === "string" ? procedure([...path, key]) : undefined;
      },
    });
  return { rpcClient: procedure([]) };
});

it("keeps the tab's forward steps when another page attaches before a step back lands", () => {
  pool.attached.add(browserTargetOf(PAGE));
  const { store } = renderWithProviders(
    <BrowserTabs
      chromeInto={null}
      fieldInto={null}
      ref={null}
      reloadInto={null}
      rowWidth={800}
    />,
  );
  act(() => {
    store.set(windowTabGroupsAtom, [GROUP]);
    store.set(seedWindowTabsAtom, {
      activeByGroup: { [GROUP]: PAGE },
      groups: {},
      tabs: [
        {
          future: [{ href: "/settings/general", id: "ahead", kind: "screen" }],
          group: GROUP,
          id: PAGE,
          kind: "page",
          openedAt: 1,
          url: "https://b.example/",
        },
        { group: GROUP, id: OTHER, kind: "page", openedAt: 2 },
      ],
    });
  });
  const ahead = () =>
    store.get(windowTabsAtom).tabs.find((tab) => tab.id === PAGE)?.future
      ?.length;
  expect(ahead()).toBe(1);

  expect(ahead()).toBe(1);

  pool.stepping.add(browserTargetOf(PAGE));
  act(() => {
    pool.attached.add(browserTargetOf(OTHER));
    pool.redraw();
  });
  pool.url = "https://a.example/";
  act(() => {
    pool.heard("did-navigate");
  });
  expect(ahead()).toBe(1);

  // A page going somewhere new drops them.
  pool.url = "https://c.example/";
  act(() => {
    pool.heard("did-navigate");
  });
  expect(ahead()).toBe(0);
});
