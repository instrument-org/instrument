import {
  applyDraftOps,
  type Draft,
  type DraftOp,
  type DraftsSnapshot,
} from "@/shared/drafts";
import { type ChatId } from "@instrument-org/workspace/electron";
import { describe, expect, it, vi } from "vitest";

import { ASK_FRESH_MS, SEND_FRESH_MS } from "@instrument-org/shared";

import { type AskedDraftCarries } from "./asked-draft-carries";
import { type AskedReply, startSendingAskedDrafts } from "./send-asked-drafts";

vi.mock("../lib/electron-logger", () => ({
  logger: { scope: () => ({ warn: vi.fn() }) },
}));

const CHAT = "2026-10-26-weather-in-nashville" as ChatId;
const THIS_DEVICE = "dev_7Q2M4K9X";
const NOW = Date.parse("2026-10-26T22:00:00.000Z");

function reply(fields: Partial<Draft> = {}): Draft {
  return {
    chatId: CHAT,
    createdAt: NOW - 1000,
    id: "01KFDRAFT0000000000000001",
    send: { device: THIS_DEVICE, stage: "asked" },
    updatedAt: NOW - 1000,
    words: "Will it rain on Saturday?",
    ...fields,
  };
}

/**
 * The sender over drafts held here: each op is applied to them and the
 * sender told again, as the store tells main of its own changes. The
 * message route, which marks a draft sent, is not part of it.
 */
function run(
  drafts: Draft[],
  send: (reply: AskedReply) => Promise<void>,
  startChat: (words: string) => Promise<ChatId> = () =>
    Promise.reject(new Error("No chat is started in this test")),
  carries: () => Promise<AskedDraftCarries | undefined> = () =>
    Promise.resolve({}),
  showChat: (chatId: ChatId) => void = () => undefined,
) {
  const applied: DraftOp[] = [];
  let listener: ((snapshot: DraftsSnapshot) => void) | undefined;
  let held = drafts;
  startSendingAskedDrafts({
    apply: (ops) => {
      applied.push(...ops);
      held = applyDraftOps(held, ops);
      listener?.({ acks: {}, drafts: held });
    },
    carries,
    deviceId: THIS_DEVICE,
    now: () => NOW,
    send,
    showChat,
    startChat,
    watch: (heard) => {
      listener = heard;
      heard({ acks: {}, drafts: held });
      return () => undefined;
    },
  });
  return applied;
}

describe("startSendingAskedDrafts", () => {
  it("sends what the draft carries with its words", async () => {
    const viewing = {
      links: [{ url: "https://weather.example/" }],
      screen: "conversation" as const,
    };
    const send = vi.fn(() => Promise.resolve());
    run([reply()], send, undefined, () => Promise.resolve({ viewing }));
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledWith(expect.objectContaining({ viewing }));
    });
  });

  it.each([
    ["can't all go from here", () => Promise.resolve(undefined)],
    ["can't be read", () => Promise.reject(new Error("No chat list"))],
  ])(
    "leaves a draft whose parts %s, starting no chat",
    async (_name, carries) => {
      const send = vi.fn(() => Promise.resolve());
      const startChat = vi.fn(() => Promise.resolve(CHAT));
      const applied = run(
        [reply({ chatId: undefined })],
        send,
        startChat,
        carries,
      );
      await vi.waitFor(() => {
        expect(applied).toEqual([
          { id: "01KFDRAFT0000000000000001", type: "release" },
        ]);
      });
      expect(send).not.toHaveBeenCalled();
      expect(startChat).not.toHaveBeenCalled();
    },
  );

  it("sends a draft of asks alone", async () => {
    const send = vi.fn(() => Promise.resolve());
    const ask = {
      createdAt: NOW,
      id: "a",
      instruction: "Shorten",
      path: "/w/plan.md",
      target: "line 3",
    };
    run([reply({ asks: [ask], words: "" })], send);
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledOnce();
    });
  });

  it("sends a fresh reply asked of this computer once, claimed first", async () => {
    const send = vi.fn(() => Promise.resolve());
    const applied = run([reply()], send);
    await vi.waitFor(
      () => {
        expect(send).toHaveBeenCalledOnce();
      },
      { interval: 1 },
    );
    expect(applied.map((op) => op.type)).toEqual(["claim"]);
    expect(send).toHaveBeenCalledExactlyOnceWith({
      chatId: CHAT,
      draftId: "01KFDRAFT0000000000000001",
      words: "Will it rain on Saturday?",
    });
  });

  // A sleeping Mac takes a phone's draft only in a short wake.
  it("sends a reply asked for longer ago than an answer stays fresh", async () => {
    const send = vi.fn(() => Promise.resolve());
    run([reply({ updatedAt: NOW - ASK_FRESH_MS - 1 })], send);
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledOnce();
    });
  });

  it("leaves a reply asked too long ago in its box, unsent", async () => {
    const send = vi.fn(() => Promise.resolve());
    const applied = run([reply({ updatedAt: NOW - SEND_FRESH_MS - 1 })], send);
    await vi.waitFor(
      () => {
        expect(applied).toEqual([
          { id: "01KFDRAFT0000000000000001", type: "release" },
        ]);
      },
      { interval: 1 },
    );
    expect(send).not.toHaveBeenCalled();
  });

  it("puts a reply whose send failed back in its box, and does not try again", async () => {
    const send = vi.fn(() =>
      Promise.reject(new Error("No model is chosen to send with")),
    );
    const applied = run([reply()], send);
    await vi.waitFor(
      () => {
        expect(applied.map((op) => op.type)).toEqual(["claim", "release"]);
      },
      { interval: 1 },
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("leaves alone a reply asked of another computer, and one nobody asked to send", async () => {
    const send = vi.fn(() => Promise.resolve());
    const applied = run(
      [
        reply({
          id: "01KFDRAFT0000000000000002",
          send: { device: "dev_OTHER000", stage: "asked" },
        }),
        reply({ id: "01KFDRAFT0000000000000003", send: undefined }),
      ],
      send,
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(applied).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });

  it("starts the chat a draft of its own opens, then sends it there under its project", async () => {
    const send = vi.fn(() => Promise.resolve());
    const startChat = vi.fn(() => Promise.resolve(CHAT));
    const { chatId: _reply, ...newChat } = reply({ projectId: "top_weather" });
    const applied = run([newChat], send, startChat);
    await vi.waitFor(
      () => {
        expect(send).toHaveBeenCalledOnce();
      },
      { interval: 1 },
    );
    expect(applied.map((op) => op.type)).toEqual(["claim"]);
    expect(startChat).toHaveBeenCalledExactlyOnceWith(
      "Will it rain on Saturday?",
    );
    expect(applied[0]).toMatchObject({ chatId: CHAT, type: "claim" });
    expect(send).toHaveBeenCalledExactlyOnceWith({
      chatId: CHAT,
      draftId: "01KFDRAFT0000000000000001",
      projectId: "top_weather",
      words: "Will it rain on Saturday?",
    });
  });

  const newChat = () => reply({ chatId: undefined });

  it("shows a new chat once its message is written", async () => {
    const shown: ChatId[] = [];
    const send = vi.fn(() => Promise.resolve());
    const showChat = vi.fn((chatId: ChatId) => {
      expect(send).toHaveBeenCalledOnce();
      shown.push(chatId);
    });
    const applied = run(
      [newChat()],
      send,
      () => Promise.resolve(CHAT),
      undefined,
      showChat,
    );
    await vi.waitFor(() => {
      expect(shown).toEqual([CHAT]);
    });
    expect(applied.map((op) => op.type)).toEqual(["claim"]);
  });

  it("leaves a new chat's draft sent when the chat could not be shown", async () => {
    const showChat = vi.fn(() => {
      throw new Error("No window file");
    });
    const applied = run(
      [newChat()],
      () => Promise.resolve(),
      () => Promise.resolve(CHAT),
      undefined,
      showChat,
    );
    await vi.waitFor(() => {
      expect(showChat).toHaveBeenCalledOnce();
    });
    expect(applied.map((op) => op.type)).toEqual(["claim"]);
  });

  it.each([
    ["a reply into a chat there is", reply(), () => Promise.resolve()],
    [
      "a new chat whose send failed",
      newChat(),
      () => Promise.reject(new Error("No model is chosen to send with")),
    ],
  ])("shows nothing for %s", async (_name, draft, send) => {
    const showChat = vi.fn();
    const sent = vi.fn(send);
    run([draft], sent, () => Promise.resolve(CHAT), undefined, showChat);
    await vi.waitFor(() => {
      expect(sent).toHaveBeenCalledOnce();
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(showChat).not.toHaveBeenCalled();
  });
});
