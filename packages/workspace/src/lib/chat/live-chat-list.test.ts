import { describe, expect, it, vi } from "vitest";

import { publisher } from "../../rpc/publisher";
import { type ChatId, ChatIdSchema } from "../../schemas/chat-id";

const ids = vi.hoisted(() => {
  const listed: string[] = [];
  return { listed };
});
const slugs = vi.hoisted(() => ({ known: new Set<string>() }));

vi.mock("./chat-records", () => ({
  listChatIds: () => ids.listed,
}));
vi.mock("./chats", () => ({
  knownAppSlugs: vi.fn(async () => new Set(slugs.known)),
  listedChats: vi.fn(
    async (read: readonly ChatId[]) => new Map(read.map((id) => [id, { id }])),
  ),
}));
// The bus alone: the folder's watch says its edits there too.
vi.mock("../host-events", () => ({
  appListChanges: (signal: AbortSignal | undefined) =>
    publisher.subscribe("app.updated", { signal }),
}));

const { knownAppSlugs, listedChats } = await import("./chats");
const { liveChatList } = await import("./live-chat-list");

/** The chats each read asked for, leaving out the reads that asked for none. */
function rowsRead() {
  return vi
    .mocked(listedChats)
    .mock.calls.flatMap(([read]) => (read.length === 0 ? [] : [[...read]]));
}

describe("the live chat list on a change to the apps", () => {
  it("reads every row again only when the apps the workspace has change", async () => {
    ids.listed = ["a", "b"].map((id) => ChatIdSchema.parse(id));
    slugs.known = new Set(["linear"]);
    const controller = new AbortController();
    const list = liveChatList(controller.signal);
    await list.next();
    expect(rowsRead()).toEqual([["a", "b"]]);
    // Pulled for what comes next, which a change that moved nothing never sends.
    // It ends with the abort's error, as a live route does when its request goes.
    const pulled = list.next().catch(() => undefined);

    // An edit that leaves the same apps, such as a guide rewritten.
    publisher.publish("app.updated", null);
    await vi.waitFor(() => {
      expect(knownAppSlugs).toHaveBeenCalledTimes(2);
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(rowsRead()).toEqual([["a", "b"]]);

    // An app added.
    slugs.known = new Set(["linear", "drafts"]);
    publisher.publish("app.updated", null);
    await vi.waitFor(() => {
      expect(rowsRead()).toEqual([
        ["a", "b"],
        ["a", "b"],
      ]);
    });
    controller.abort();
    await pulled;
  });
});
