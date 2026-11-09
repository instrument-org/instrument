import { renderWithProviders } from "@/tests/render";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ActivityPage } from "./activity-page";

const { calls, data } = vi.hoisted(() => ({
  calls: new Map<string, (input: unknown) => unknown>(),
  data: new Map<string, unknown>(),
}));

/**
 * Every route as a query whose data is `data`'s entry for it, and as a call
 * or a mutation answered by `calls`' entry, so the section reads and asks
 * what each test sets.
 */
vi.mock("@/client/components/theme-provider", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));

vi.mock("@/client/rpc/client", () => {
  const route = (path: string[]): unknown =>
    new Proxy(() => {}, {
      get: (_target, name: string) => {
        const key = path.join(".");
        switch (name) {
          case "call":
            return async (input: unknown) => calls.get(key)?.(input) ?? null;
          case "key":
          case "queryKey":
            return () => [key];
          case "mutationOptions":
            return (options: object = {}) => ({
              ...options,
              mutationFn: async (input: unknown) =>
                calls.get(key)?.(input) ?? null,
            });
          case "experimental_liveOptions":
          case "queryOptions":
            return ({ input }: { input?: unknown } = {}) => ({
              queryFn: () => data.get(key) ?? null,
              queryKey: [key, input],
            });
          default:
            return route([...path, name]);
        }
      },
    });
  return { rpcClient: route([]) };
});

const NOW = Date.now();
const minutesAgo = (minutes: number) =>
  new Date(NOW - minutes * 60_000).toISOString();

// jsdom lays nothing out, so the list's scrollport is given a height to
// draw its rows into.
for (const side of ["offsetHeight", "offsetWidth"] as const) {
  Object.defineProperty(HTMLElement.prototype, side, {
    configurable: true,
    get: () => 800,
  });
}

beforeEach(() => {
  calls.clear();
  data.clear();
  data.set("preferences.live.get", { keepHistory: true });
  data.set("gateway.models.live.list", { models: [] });
  calls.set("actions.list", () => ({
    actions: [
      {
        at: minutesAgo(1),
        kind: "page",
        title: "Where's My Refund?",
        url: "https://www.irs.gov/refunds",
      },
      { at: minutesAgo(2), kind: "edit", path: "/Users/sam/Taxes/notes.md" },
      { at: minutesAgo(3), kind: "setting", name: "Zoom", value: "110%" },
    ],
    next: null,
    until: NOW,
  }));
  calls.set("workspace.activity.list", () => []);
});

/** The page with its address held the way the route holds it, so a row picked opens its details. */
function page(props: Partial<Parameters<typeof ActivityPage>[0]> = {}) {
  const onSearch = vi.fn();
  function Routed() {
    const [item, setItem] = useState<string | undefined>();
    return (
      <ActivityPage
        item={item}
        onSearch={(next) => {
          onSearch(next);
          if ("item" in next) {
            setItem(next.item);
          }
        }}
        q=""
        show={undefined}
        {...props}
      />
    );
  }
  renderWithProviders(<Routed />);
  return { onSearch };
}

describe("ActivityPage", () => {
  it("lists each thing on one line under its day, and narrows to the filter in the address", async () => {
    page();
    expect(await screen.findByText("Where's My Refund?")).toBeTruthy();
    expect(screen.getByText("irs.gov")).toBeTruthy();
    expect(screen.getByText("notes.md")).toBeTruthy();
    expect(screen.getByText("Edited")).toBeTruthy();
    expect(screen.getByText(/^Today · /)).toBeTruthy();
  });

  it("shows only the rows a filter or a search leaves", async () => {
    page({ show: "files" });
    expect(await screen.findByText("notes.md")).toBeTruthy();
    expect(screen.queryByText("Where's My Refund?")).toBeNull();
  });

  it("asks for a filter by changing the address", async () => {
    const { onSearch } = page();
    await screen.findByText("notes.md");
    fireEvent.click(screen.getByRole("radio", { name: "Pages" }));
    expect(onSearch).toHaveBeenCalledWith({ item: undefined, show: "pages" });
  });

  it("shows a row's details beside the list, and removes it from there", async () => {
    const remove = vi.fn(() => ({ requestsKept: 0 }));
    calls.set("activity.remove", remove);
    page();
    fireEvent.click(await screen.findByText("notes.md"));
    const details = await screen.findByRole("complementary", {
      name: "Details",
    });
    expect(details.textContent).toMatch(/Edited.*Today at /);
    fireEvent.click(
      screen.getByRole("button", { name: "Remove from Activity" }),
    );
    await waitFor(() => {
      expect(remove).toHaveBeenCalledWith({
        actions: [
          {
            at: minutesAgo(2),
            kind: "edit",
            path: "/Users/sam/Taxes/notes.md",
          },
        ],
        requests: [],
      });
    });
  });

  it("removes the rows ticked, together", async () => {
    const remove = vi.fn(() => ({ requestsKept: 0 }));
    calls.set("activity.remove", remove);
    page();
    fireEvent.click(
      await screen.findByRole("checkbox", { name: "Select notes.md" }),
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Zoom" }));
    expect(screen.getByText("2 selected")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Remove from Activity" }),
    );
    await waitFor(() => {
      expect(remove).toHaveBeenCalledWith({
        actions: [
          {
            at: minutesAgo(2),
            kind: "edit",
            path: "/Users/sam/Taxes/notes.md",
          },
          { at: minutesAgo(3), kind: "setting", name: "Zoom", value: "110%" },
        ],
        requests: [],
      });
    });
  });

  it("says the history is off", async () => {
    data.set("preferences.live.get", { keepHistory: false });
    page();
    expect(
      await screen.findByText("Instrument isn't keeping a history right now."),
    ).toBeTruthy();
  });
});
