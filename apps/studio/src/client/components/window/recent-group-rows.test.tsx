import { type WindowTab } from "@/client/atoms/window";
import { renderWithProviders } from "@/tests/render";
import { TabIdSchema } from "@/shared/tabs";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RecentGroupRows } from "./recent-group-rows";
import { type RecentGroup } from "./recent-groups";

// Every query stays pending, and nothing is called.
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

const page = (id: string, title: string): WindowTab => ({
  group: id,
  id,
  kind: "page",
  openedAt: 0,
  title,
  url: `https://${id}.example/`,
});

const CLOSED_AT = new Date(2020, 2, 4, 9, 30).getTime();

const GROUPS: RecentGroup[] = [
  {
    at: 2,
    key: "open",
    pick: { group: "open", kind: "open" },
    sides: [{ tabs: [page("open", "Plans")], up: page("open", "Plans") }],
  },
  {
    at: CLOSED_AT,
    key: "closed",
    pick: { id: TabIdSchema.parse("entry"), kind: "closed" },
    sides: [{ tabs: [page("closed", "Quotes")], up: page("closed", "Quotes") }],
  },
];

function rows(props: Partial<Parameters<typeof RecentGroupRows>[0]> = {}) {
  const spies = { onAllChats: vi.fn(), onLeave: vi.fn(), onPick: vi.fn() };
  renderWithProviders(
    <RecentGroupRows
      chatTitles={new Map()}
      groups={GROUPS}
      hasChats
      {...spies}
      {...props}
    />,
  );
  return spies;
}

describe("the tab groups under a new tab's box", () => {
  it("says Open for an open group and when a closed one closed, then All chats", () => {
    rows();
    expect(
      screen.getAllByRole("button").map((button) => button.textContent),
    ).toEqual([
      "Plansopen.exampleOpen",
      "Quotesclosed.exampleMar 4, 2020",
      "All chats",
    ]);
  });

  it("is nothing with no groups and no chats", () => {
    rows({ groups: [], hasChats: false });
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("ends without All chats where there are no chats", () => {
    rows({ hasChats: false });
    expect(screen.queryByRole("button", { name: "All chats" })).toBeNull();
  });

  it("picks the group pressed, and All chats opens the page", () => {
    const spies = rows();
    fireEvent.click(screen.getByRole("button", { name: /Quotes/ }));
    expect(spies.onPick).toHaveBeenCalledWith(GROUPS[1]);
    fireEvent.click(screen.getByRole("button", { name: "All chats" }));
    expect(spies.onAllChats).toHaveBeenCalledOnce();
  });

  it("walks the rows by the arrows, and hands the keyboard back from the first row or on Escape", () => {
    const spies = rows();
    const [first, second, all] = screen.getAllByRole("button");
    first?.focus();
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "ArrowDown",
    });
    expect(document.activeElement).toBe(second);
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "ArrowDown",
    });
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "ArrowDown",
    });
    expect(document.activeElement).toBe(all);
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    expect(spies.onLeave).toHaveBeenCalledTimes(1);
    first?.focus();
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "ArrowUp",
    });
    expect(spies.onLeave).toHaveBeenCalledTimes(2);
  });
});
