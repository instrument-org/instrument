import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { publisher } from "../../rpc/publisher";
import { type ChatId, ChatIdSchema } from "../../schemas/chat-id";

const ids = vi.hoisted(() => {
  const listed: string[] = [];
  return { listed };
});
const slugs = vi.hoisted(() => ({ known: new Set<string>() }));
/** How many times rows have been read, which each row carries so a read moves it. */
const reads = vi.hoisted(() => ({ count: 0 }));
/**
 * `performance.now()` where a test stands it in, and how long the next read
 * of rows takes on it.
 */
const clock = vi.hoisted(() => ({ at: 0, nextReadMs: 0 }));

/** The alarm gate, made afresh for each test so a key warns again in the next one. */
const gate = vi.hoisted(() => ({
  current: undefined as
    | undefined
    | {
        raise: (
          key: string,
          line: () => string,
          warn: (line: string) => void,
        ) => boolean;
      },
}));

vi.mock(import("@instrument-org/shared/alarms"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    alarms: {
      raise: (key, line, warn) =>
        (gate.current ??= actual.createAlarmGate()).raise(key, line, warn),
    },
  };
});
vi.mock("./chat-records", () => ({
  listChatIds: () => ids.listed,
}));
vi.mock("./chats", () => ({
  knownAppSlugs: vi.fn(async () => new Set(slugs.known)),
  listedChats: vi.fn(async (read: readonly ChatId[]) => {
    reads.count += 1;
    clock.at += clock.nextReadMs;
    clock.nextReadMs = 0;
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

describe("the live chat list's re-read warnings", () => {
  beforeEach(() => {
    gate.current = undefined;
    clock.at = 0;
    clock.nextReadMs = 0;
    vi.spyOn(performance, "now").mockImplementation(() => clock.at);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.mocked(listedChats).mockClear();
  });
  afterEach(() => {
    vi.mocked(performance.now).mockRestore();
    vi.mocked(console.warn).mockRestore();
  });
  const listChats = (count: number) => {
    ids.listed = Array.from({ length: count }, (_, index) =>
      ChatIdSchema.parse(`c${index}`),
    );
  };
  const warned = () =>
    vi.mocked(console.warn).mock.calls.map(([line]) => String(line));

  it("warns once an hour for a burst that reads every row, and never for the first read", async () => {
    listChats(150);
    slugs.known = new Set(["linear"]);
    const controller = new AbortController();
    const list = liveChatList(controller.signal);
    await list.next();
    expect(warned()).toEqual([]);

    slugs.known = new Set(["linear", "drafts"]);
    publisher.publish("app.updated", null);
    await list.next();
    slugs.known = new Set(["linear"]);
    publisher.publish("app.updated", null);
    await list.next();

    expect(rowsRead()).toHaveLength(3);
    expect(warned()).toMatchInlineSnapshot(`
      [
        "Chat list: read 150 rows again in 0 ms for a change to the apps (0 new to the list; 150 rows in 1 read in the last minute; 150 listed)",
      ]
    `);
    controller.abort();
  });

  it("warns for a burst that takes long, naming what moved it", async () => {
    listChats(3);
    const controller = new AbortController();
    const list = liveChatList(controller.signal);
    await list.next();

    clock.nextReadMs = 300;
    publisher.publish("record.changed", {
      id: ChatIdSchema.parse("c0"),
      kind: "messages",
    });
    await list.next();

    expect(warned()).toMatchInlineSnapshot(`
      [
        "Chat list: read 1 row again in 300 ms for record changes (0 new to the list; 1 row in 1 read in the last minute; 3 listed)",
      ]
    `);
    controller.abort();
  });

  it("warns when small bursts pass 1,000 rows within a minute", async () => {
    listChats(60);
    const controller = new AbortController();
    const list = liveChatList(controller.signal);
    await list.next();
    const burst = async () => {
      for (const id of ids.listed) {
        publisher.publish("record.changed", {
          id: ChatIdSchema.parse(id),
          kind: "messages",
        });
      }
      await list.next();
    };

    for (let index = 0; index < 16; index += 1) {
      await burst();
    }
    expect(warned()).toEqual([]);
    await burst();
    expect(warned()).toMatchInlineSnapshot(`
      [
        "Chat list: read 1020 rows again in 17 reads within a minute (60 listed; the last for record changes)",
      ]
    `);

    // A minute on, the count starts over: with a fresh gate, a burst still says nothing.
    clock.at += 60_000;
    gate.current = undefined;
    await burst();
    expect(warned()).toHaveLength(1);
    controller.abort();
  });

  it("warns for a first read that keeps every window waiting", async () => {
    listChats(3);
    clock.nextReadMs = 2_500;
    const controller = new AbortController();
    await liveChatList(controller.signal).next();

    expect(warned()).toMatchInlineSnapshot(`
      [
        "Chat list: first read of 3 rows took 2500 ms",
      ]
    `);
    controller.abort();
  });
});
