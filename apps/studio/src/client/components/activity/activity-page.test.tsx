import { renderWithProviders } from "@/tests/render";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { ActivityPage } from "./activity-page";

const { calls, data, reads } = vi.hoisted(() => ({
  calls: new Map<string, (input: unknown) => unknown>(),
  data: new Map<string, unknown>(),
  reads: new Map<string, (input: unknown) => unknown>(),
}));

/**
 * Every route as a query whose data is what `reads`' entry for it answers
 * its input with, or `data`'s entry, and as a call or a mutation answered by
 * `calls`' entry, so the section reads and asks what each test sets.
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
              queryFn: () => reads.get(key)?.(input) ?? data.get(key) ?? null,
              queryKey: [key, input],
            });
          default:
            return route([...path, name]);
        }
      },
    });
  return { rpcClient: route([]) };
});

// Noon today, held for every test, so a row a few minutes old reads as
// today even when the suite runs just after midnight.
const NOW = new Date().setHours(12, 0, 0, 0);
const minutesAgo = (minutes: number) =>
  new Date(NOW - minutes * 60_000).toISOString();

afterEach(() => {
  vi.useRealTimers();
});

// jsdom lays nothing out, so the list's scrollport is given a height to
// draw its rows into.
for (const side of ["offsetHeight", "offsetWidth"] as const) {
  Object.defineProperty(HTMLElement.prototype, side, {
    configurable: true,
    get: () => 800,
  });
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  calls.clear();
  data.clear();
  reads.clear();
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
  const { queryClient } = renderWithProviders(<Routed />);
  return { onSearch, queryClient };
}

const ReadInput = z.object({
  cursor: z.number().optional(),
  limit: z.number(),
  since: z.number().optional(),
  until: z.number().optional(),
});

/**
 * The action log as `log`, a setting changed at each of its times, read the
 * way the route reads it: the history up to `until`, and the live read's
 * newest `limit` after `since`. Returns each history read's `until`.
 */
function serveActions(log: { n: number; time: number }[]) {
  const untils: number[] = [];
  const read = (input: unknown) => {
    const {
      cursor = 0,
      limit,
      since = 0,
      until = Date.now(),
    } = ReadInput.parse(input);
    const found = log
      .filter(({ time }) => time >= since && time <= until)
      .toSorted((a, b) => b.time - a.time);
    return {
      actions: found.slice(cursor, cursor + limit).map(({ n, time }) => ({
        at: new Date(time).toISOString(),
        kind: "setting",
        name: `Setting ${n}`,
        value: "On",
      })),
      next: found.length > cursor + limit ? cursor + limit : null,
      until,
    };
  };
  calls.set("actions.list", (input) => {
    const listed = read(input);
    if (!untils.includes(listed.until)) {
      untils.push(listed.until);
    }
    return listed;
  });
  reads.set("actions.list", read);
  return untils;
}

const settingsListed = () =>
  screen.getAllByText(/^Setting \d+$/).map((row) => row.textContent);

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
      screen.getByRole("button", { name: "Remove from History" }),
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
      screen.getByRole("button", { name: "Remove from History" }),
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

describe("ActivityPage left open", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads the history again up to a live read that came back full, each row listed once", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const opened = new Date(2026, 10, 5, 12, 0).getTime();
    vi.setSystemTime(opened);
    const log = [{ n: 1050, time: opened - 60_000 }];
    const untils = serveActions(log);
    // The search leaves four of the rows, so each is drawn: the newest, two
    // more made since the page opened (150 among the newest 200 of those, 50
    // past them), and the one from before.
    const { queryClient } = page({ q: "Setting 50" });
    await screen.findByText("Setting 1050");
    expect(untils).toEqual([opened]);

    for (let n = 1; n <= 250; n += 1) {
      log.push({ n, time: opened + n });
    }
    vi.setSystemTime(opened + 1000);
    await queryClient.refetchQueries({ queryKey: ["actions.list"] });

    await waitFor(() => {
      expect(settingsListed()).toEqual([
        "Setting 250",
        "Setting 150",
        "Setting 50",
        "Setting 1050",
      ]);
    });
    expect(untils).toEqual([opened, opened + 1000]);
  });

  it("names the days by the day it is after midnight", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const opened = new Date(2026, 10, 5, 23, 59).getTime();
    vi.setSystemTime(opened);
    const log = [{ n: 1, time: opened - 60_000 }];
    serveActions(log);
    const { queryClient } = page();
    await screen.findByText("Setting 1");
    expect(screen.getAllByText(/^Today · /)).toHaveLength(1);

    log.push({ n: 2, time: opened + 90_000 });
    vi.setSystemTime(opened + 120_000);
    await queryClient.refetchQueries({ queryKey: ["actions.list"] });

    await screen.findByText("Setting 2");
    await waitFor(() => {
      expect(screen.getAllByText(/^Today · /)).toHaveLength(1);
    });
    expect(screen.getAllByText(/^Yesterday · /)).toHaveLength(1);
  });
});
