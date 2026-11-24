import { type ChatId } from "@instrument-org/workspace/electron";
import { describe, expect, it, vi } from "vitest";

import { createPhoneChatGroups } from "./phone-chat-groups";

const CHAT = "2026-10-26-weather-in-nashville" as ChatId;

function setUp() {
  const file: { chats: unknown; window: number | undefined } = {
    chats: undefined,
    window: 1,
  };
  const ask = vi.fn((_chat: ChatId) => file.window);
  const launch = () =>
    createPhoneChatGroups({
      ask,
      keep: (chats) => {
        file.chats = chats;
      },
      kept: () => file.chats,
    });
  return { ask, file, launch };
}

describe("createPhoneChatGroups", () => {
  it("asks one window once, and forgets the chat when it is listed", () => {
    const { ask, file, launch } = setUp();
    const groups = launch();
    groups.add(CHAT);
    groups.offer();
    expect(ask).toHaveBeenCalledExactlyOnceWith(CHAT);
    expect(file.chats).toEqual([CHAT]);
    groups.listed(CHAT);
    groups.offer();
    expect(file.chats).toEqual([]);
    expect(ask).toHaveBeenCalledOnce();
  });

  it("keeps a chat sent with no window open through a quit, for the next window", () => {
    const { ask, file, launch } = setUp();
    file.window = undefined;
    launch().add(CHAT);
    expect(file.chats).toEqual([CHAT]);
    ask.mockClear();
    file.window = 2;
    launch().offer();
    expect(ask).toHaveBeenCalledExactlyOnceWith(CHAT);
  });

  it("asks another window when the one asked stops hearing before it answers", () => {
    const { ask, file, launch } = setUp();
    const groups = launch();
    groups.add(CHAT);
    file.window = 2;
    groups.stopped(1);
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it("reads a kept value it cannot use as no chats", () => {
    const { ask, file, launch } = setUp();
    file.chats = { not: "a list" };
    launch().offer();
    expect(ask).not.toHaveBeenCalled();
  });
});
