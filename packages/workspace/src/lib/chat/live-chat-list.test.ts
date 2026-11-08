import { describe, expect, it, vi } from "vitest";

import { publisher } from "../../rpc/publisher";
import { type ChatId, ChatIdSchema } from "../../schemas/chat-id";

const ids = vi.hoisted(() => {
  const listed: string[] = [];
  return { listed };
});
const slugs = vi.hoisted(() => ({ known: new Set<string>() }));
/** How many times rows have been read, which each row carries so a read moves it. */
const reads = vi.hoisted(() => ({ count: 0 }));

vi.mock("./chat-records", () => ({
  listChatIds: () => ids.listed,
}));
vi.mock("./chats", () => ({
  knownAppSlugs: vi.fn(async () => new Set(slugs.known)),
  listedChats: vi.fn(async (read: readonly ChatId[]) => {
    reads.count += 1;
    return new Map(
      read.map((id) => [id, { id, reads: reads.count, sessionId: id }]),
    );
  }),
}));
vi.mock(import("../record-folders"), async (importOriginal) => ({
  ...(await importOriginal()),
  resolveChat: (id: string) =>
    ids.listed.includes(id) ? ChatIdSchema.parse(id) : undefined,
}));
// The bus alone: the folder's watch says its edits there too.
vi.mock("../host-events", () => ({
  appListChanges: vi.fn((signal: AbortSignal | undefined) =>
    publisher.subscribe("app.updated", { signal }),
  ),
}));

const { knownAppSlugs, listedChats } = await import("./chats");
const { appListChanges } = await import("../host-events");
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

describe("the live chat list on a change to a chat", () => {
  it("reads a chat again for changes only in memory at most once per 500 ms, and for a written one at once", async () => {
    vi.mocked(listedChats).mockClear();
    ids.listed = ["a", "b"];
    const a = ChatIdSchema.parse("a");
    const controller = new AbortController();
    const list = liveChatList(controller.signal);
    await list.next();
    const pulled = list.next().catch(() => undefined);
    const inMemory = () => {
      publisher.publish("record.changed", {
        id: a,
        kind: "messages",
        live: true,
      });
    };

    // Within a moment of the first read, so held.
    inMemory();
    await new Promise((resolve) => setTimeout(resolve, 50));
    inMemory();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(rowsRead()).toEqual([["a", "b"]]);
    await vi.waitFor(
      () => {
        expect(rowsRead()).toEqual([["a", "b"], ["a"]]);
      },
      { timeout: 1000 },
    );

    publisher.publish("record.changed", { id: a, kind: "messages" });
    await vi.waitFor(
      () => {
        expect(rowsRead()).toEqual([["a", "b"], ["a"], ["a"]]);
      },
      { timeout: 100 },
    );
    controller.abort();
    await pulled;
  });
});

describe("the live chat list followed twice", () => {
  it("reads a moved row once for both, and sends each the answer", async () => {
    vi.mocked(listedChats).mockClear();
    ids.listed = ["a", "b"];
    const controller = new AbortController();
    const first = liveChatList(controller.signal);
    expect((await first.next()).value).toHaveLength(2);
    // Comes after the first read, so starts from its answer.
    const second = liveChatList(controller.signal);
    expect((await second.next()).value).toHaveLength(2);
    expect(rowsRead()).toEqual([["a", "b"]]);

    const answers = Promise.all([first.next(), second.next()]);
    publisher.publish("record.changed", {
      id: ChatIdSchema.parse("a"),
      kind: "messages",
    });
    const [one, two] = await answers;

    expect(rowsRead()).toEqual([["a", "b"], ["a"]]);
    expect(one.value).toEqual(two.value);
    controller.abort();
  });

  it("starts reading again for a follower after the last one left", async () => {
    vi.mocked(listedChats).mockClear();
    ids.listed = ["a"];
    const before = new AbortController();
    await liveChatList(before.signal).next();
    before.abort();

    const after = new AbortController();
    await liveChatList(after.signal).next();

    expect(rowsRead()).toEqual([["a"], ["a"]]);
    after.abort();
  });
});

describe("the live chat list when a read fails", () => {
  it("fails its follower and lets go of what it listened to", async () => {
    ids.listed = ["a"];
    vi.mocked(appListChanges).mockClear();
    vi.mocked(listedChats).mockRejectedValueOnce(new Error("unreadable"));
    const controller = new AbortController();
    const list = liveChatList(controller.signal);

    await expect(list.next()).rejects.toThrow("unreadable");
    const [listening] = vi.mocked(appListChanges).mock.calls.at(-1) ?? [];
    expect(listening?.aborted).toBe(true);

    // The next follower reads the list afresh.
    const again = liveChatList(controller.signal);
    await expect(again.next()).resolves.toMatchObject({ done: false });
    controller.abort();
  });
});
