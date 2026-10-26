import { type Draft, type DraftOp, type DraftsSnapshot } from "@/shared/drafts";
import { type ChatId } from "@instrument-org/workspace/electron";
import { describe, expect, it, vi } from "vitest";

import {
  ASK_FRESH_MS,
  type AskedReply,
  startSendingAskedDrafts,
} from "./send-asked-drafts";

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
    sendOn: THIS_DEVICE,
    updatedAt: NOW - 1000,
    words: "Will it rain on Saturday?",
    ...fields,
  };
}

/**
 * The sender over drafts held here: each op is applied to them and the
 * sender told again, as the store tells main of its own changes.
 */
function run(drafts: Draft[], send: (reply: AskedReply) => Promise<void>) {
  const applied: DraftOp[] = [];
  let listener: ((snapshot: DraftsSnapshot) => void) | undefined;
  let held = drafts;
  startSendingAskedDrafts({
    apply: (ops) => {
      applied.push(...ops);
      for (const op of ops) {
        if (op.type === "sent") {
          held = held.filter((draft) => draft.id !== op.id);
        } else if (op.type === "claim") {
          held = held.map((draft) =>
            draft.id === op.id ? { ...draft, sendingTo: op.chatId } : draft,
          );
        } else if (op.type === "release" || op.type === "update") {
          held = held.map((draft) => {
            if (draft.id !== op.id) {
              return draft;
            }
            const { sendOn: _ask, sendingTo: _sending, ...rest } = draft;
            return op.type === "release"
              ? { ...rest, sendOn: draft.sendOn }
              : rest;
          });
        }
      }
      listener?.({ acks: {}, drafts: held });
    },
    deviceId: THIS_DEVICE,
    now: () => NOW,
    send,
    watch: (heard) => {
      listener = heard;
      heard({ acks: {}, drafts: held });
      return () => undefined;
    },
  });
  return applied;
}

describe("startSendingAskedDrafts", () => {
  it("sends a fresh reply asked of this computer once, claimed first and marked sent after", async () => {
    const send = vi.fn(() => Promise.resolve());
    const applied = run([reply()], send);
    await vi.waitFor(() => {
      expect(applied.map((op) => op.type)).toEqual(["claim", "sent"]);
    });
    expect(send).toHaveBeenCalledExactlyOnceWith({
      chatId: CHAT,
      draftId: "01KFDRAFT0000000000000001",
      words: "Will it rain on Saturday?",
    });
  });

  it("leaves a reply asked too long ago in its box, unsent", async () => {
    const send = vi.fn(() => Promise.resolve());
    const applied = run([reply({ updatedAt: NOW - ASK_FRESH_MS - 1 })], send);
    await vi.waitFor(() => {
      expect(applied).toEqual([
        {
          id: "01KFDRAFT0000000000000001",
          set: {},
          type: "update",
          unset: ["sendOn"],
        },
      ]);
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("puts a reply whose send failed back in its box, and does not try again", async () => {
    const send = vi.fn(() =>
      Promise.reject(new Error("No model is chosen to send with")),
    );
    const applied = run([reply()], send);
    await vi.waitFor(() => {
      expect(applied.map((op) => op.type)).toEqual([
        "claim",
        "release",
        "update",
      ]);
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("leaves alone a reply asked of another computer, and one nobody asked to send", async () => {
    const send = vi.fn(() => Promise.resolve());
    const applied = run(
      [
        reply({ id: "01KFDRAFT0000000000000002", sendOn: "dev_OTHER000" }),
        reply({ id: "01KFDRAFT0000000000000003", sendOn: undefined }),
      ],
      send,
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(applied).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });
});
