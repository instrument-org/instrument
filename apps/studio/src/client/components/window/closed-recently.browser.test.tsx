import { renderInBrowser } from "@/tests/render-browser";
import { ChatIdSchema, StoreId } from "@instrument-org/workspace/client";
import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { type Chat } from "./chats";
import { ClosedRecently } from "./closed-recently";
import { type TabGroup } from "./tab-groups";

/** What History lists, newest first, as `useOpenGroups` reads it. */
const history = vi.hoisted(() => ({ entries: [] as TabGroup[] }));

vi.mock("./tab-groups", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./tab-groups")>()),
  useOpenGroups: () => ({ elsewhere: [], history: history.entries, open: [] }),
}));

const HOUR_MS = 60 * 60 * 1000;

const closedChat = (
  slug: string,
  title: string,
  hoursAgo: number,
): TabGroup => {
  const chat: Chat = {
    archived: false,
    firstAsk: "",
    holds: { apps: [], files: [], sites: [] },
    id: ChatIdSchema.parse(`2026-11-14-${slug}`),
    lastUserMessageAt: Date.now() - hoursAgo * HOUR_MS,
    sessionId: StoreId.newSessionId(),
    starred: false,
    status: "idle",
    title,
    titleByApp: true,
    unread: false,
    unreadByUser: false,
    working: false,
  };
  return { chat, group: chat.id, kind: "chat", pinned: false, title };
};

const keptDraft: TabGroup = {
  draft: { createdAt: 0, id: "d", updatedAt: Date.now(), words: "Plan it" },
  group: "draft:d",
  kind: "draft",
  pinned: false,
  title: "Plan it",
};

describe("a new tab's Closed recently list", () => {
  it("lists History's chats alone, newest first, five at most, and opens the one pressed", async () => {
    history.entries = [
      closedChat("lisbon", "Packing list for Lisbon", 1),
      keptDraft,
      closedChat("seats", "Seat forecast for 2027", 2),
      closedChat("soc", "SOC 2 quotes", 3),
      closedChat("deck", "Board deck outline", 4),
      closedChat("kitchen", "Kitchen remodel budget", 5),
      closedChat("offsite", "Team offsite", 6),
    ];
    const onOpen = vi.fn();
    await renderInBrowser(<ClosedRecently onOpen={onOpen} />);

    const list = page.getByRole("region", { name: "Closed recently" });
    await expect.element(list).toBeVisible();
    const rows = list.getByRole("button").elements();
    expect(rows.map((row) => row.textContent)).toMatchInlineSnapshot(`
      [
        "Packing list for Lisbon1 hour ago",
        "Seat forecast for 20272 hours ago",
        "SOC 2 quotes3 hours ago",
        "Board deck outline4 hours ago",
        "Kitchen remodel budget5 hours ago",
      ]
    `);

    await userEvent.click(list.getByRole("button", { name: /Seat forecast/ }));
    expect(onOpen).toHaveBeenCalledWith("2026-11-14-seats");
  });

  it("shows nothing while History has no chats", async () => {
    history.entries = [keptDraft];
    await renderInBrowser(<ClosedRecently onOpen={vi.fn()} />);

    await expect
      .element(page.getByText("Closed recently"))
      .not.toBeInTheDocument();
  });
});
