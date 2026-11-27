import { renderWithProviders } from "@/tests/render";
import { ChatIdSchema, StoreId } from "@instrument-org/workspace/client";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { type GroupRowMenuActions } from "./group-row-menu";
import { GroupRow } from "./group-sidebar";
import { type TabGroup } from "./tab-groups";

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
        if (key === "mutationOptions") {
          return (options: object) => ({ mutationFn: pending, ...options });
        }
        return typeof key === "string" ? procedure([...path, key]) : undefined;
      },
    });
  return { rpcClient: procedure([]) };
});

const CHAT = ChatIdSchema.parse("2026-11-14-trip-plan");

const GROUPS: [string, TabGroup][] = [
  [
    "a chat's",
    {
      chat: {
        archived: false,
        firstAsk: "Plan the trip",
        holds: { apps: [], files: [], sites: [] },
        id: CHAT,
        lastUserMessageAt: 0,
        project: "house",
        sessionId: StoreId.newSessionId(),
        starred: false,
        status: "idle",
        title: "Trip plan",
        titleByApp: true,
        unread: true,
        unreadByUser: false,
        working: false,
      },
      group: CHAT,
      kind: "chat",
      pinned: false,
      title: "Trip plan",
    },
  ],
  [
    "a new chat's",
    {
      draft: {
        createdAt: 0,
        id: "draft-1",
        projectId: "house",
        updatedAt: 0,
        words: "Plan the trip",
      },
      group: "draft:draft-1",
      kind: "draft",
      pinned: false,
      title: "Plan the trip",
    },
  ],
  [
    "a group of pages'",
    { group: "group:pages", kind: "tabs", pinned: true, title: "Weather" },
  ],
];

function menuFor(entry: TabGroup): GroupRowMenuActions {
  return {
    isPinned: entry.pinned,
    onClose: vi.fn(),
    onCloseAbove: vi.fn(),
    onCloseBelow: undefined,
    onCloseOthers: vi.fn(),
    onDuplicate: vi.fn(),
    onNewWindow: vi.fn(),
    onRemoveLabel: undefined,
    onTogglePin: vi.fn(),
  };
}

describe("a tab group row's menu", () => {
  // Whatever the group's tabs show, a chat among them or not, the row's menu
  // acts on the group: what acts on a chat is in that chat's tab menu.
  it.each(GROUPS)(
    "offers only the group's own items on %s row",
    async (_kind, entry) => {
      renderWithProviders(
        <GroupRow
          chatTitles={new Map()}
          entry={entry}
          isUp={false}
          menu={menuFor(entry)}
        />,
      );

      fireEvent.contextMenu(screen.getByRole("button"));

      const rows = (await screen.findAllByRole("menuitem")).map(
        (item) => item.textContent,
      );
      expect(rows).toEqual([
        "Open in New Window",
        "Duplicate Tab Group",
        entry.pinned ? "Unpin" : "Pin",
        "Close Tab Group",
        "Close Other Tab Groups",
        "Close Tab Groups Above",
      ]);
    },
  );

  it("pins the group from its menu", async () => {
    const entry = GROUPS[0]?.[1];
    if (!entry) {
      throw new Error("no group");
    }
    const menu = menuFor(entry);
    renderWithProviders(
      <GroupRow
        chatTitles={new Map()}
        entry={entry}
        isUp={false}
        menu={menu}
      />,
    );

    fireEvent.contextMenu(screen.getByRole("button"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Pin" }));

    expect(menu.onTogglePin).toHaveBeenCalledTimes(1);
  });

  it("offers Remove Label on a group a link named, and takes it off", async () => {
    const entry = GROUPS[0]?.[1];
    if (!entry) {
      throw new Error("no group");
    }
    const menu = { ...menuFor(entry), onRemoveLabel: vi.fn() };
    renderWithProviders(
      <GroupRow
        chatTitles={new Map()}
        entry={entry}
        isUp={false}
        menu={menu}
      />,
    );

    fireEvent.contextMenu(screen.getByRole("button"));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Remove Label" }),
    );

    expect(menu.onRemoveLabel).toHaveBeenCalledTimes(1);
  });
});
