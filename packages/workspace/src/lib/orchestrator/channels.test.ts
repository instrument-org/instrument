import { describe, expect, it, vi } from "vitest";

import { StoreId } from "../../schemas/store-id";
import { TaskIdSchema } from "../../schemas/task-id";
import { createMockTaskConfig } from "../../test/helpers/mock-task-config";
import { Store } from "../store";
import {
  channelByName,
  channelName,
  channelStandings,
  createChannel,
  DEFAULT_CHANNEL_NAME,
  listChannels,
  markChannelSeen,
} from "./channels";

vi.mock(import("../session-store-storage"));

// Task state is a real file under the mock workspace, so a task id reused
// across runs would read the last run's channels.
let counter = 0;
const freshTask = () =>
  createMockTaskConfig(
    TaskIdSchema.parse(`channels-${Date.now()}-${(counter += 1)}`),
  );

describe("channelName", () => {
  it.each([
    ["#Reddit", "reddit"],
    ["  Pelican News  ", "pelican-news"],
    ["a name that runs past the limit", "a-name-that-runs"],
  ])("makes %j into %j", (raw, expected) => {
    expect(channelName(raw)).toBe(expected);
  });
});

describe("listChannels", () => {
  it("makes the first channel, and answers with it after", async () => {
    const taskId = freshTask();

    const first = await listChannels(taskId);
    const again = await listChannels(taskId);

    expect(first).toHaveLength(1);
    expect(first[0]?.name).toBe(DEFAULT_CHANNEL_NAME);
    expect(again[0]?.id).toBe(first[0]?.id);
  });

  it("adopts the session a conversation was already using", async () => {
    const taskId = freshTask();
    const existing = StoreId.newSessionId();
    await Store.saveSession(
      { createdAt: new Date(), id: existing, title: "Add 10 and 32" },
      taskId,
    );

    const channels = await listChannels(taskId);

    expect(channels).toEqual([
      { createdAt: expect.any(Number), id: existing, name: "general" },
    ]);
  });
});

describe("createChannel", () => {
  it("adds a channel with a session of its own, keeping the order", async () => {
    const taskId = freshTask();
    await listChannels(taskId);

    const made = await createChannel(taskId, "# Reddit");

    const channels = await listChannels(taskId);
    expect(channels.map((channel) => channel.name)).toEqual([
      "general",
      "reddit",
    ]);
    expect(await channelByName(taskId, "reddit")).toEqual(made);
    const session = await Store.getSession(made.id, taskId);
    expect(session._unsafeUnwrap().title).toBe("reddit");
  });
});

describe("channelStandings", () => {
  it("counts what the agent said since the user last looked, and nothing else", async () => {
    const taskId = freshTask();
    const [channel] = await listChannels(taskId);
    const sessionId = channel?.id ?? StoreId.newSessionId();
    const say = async (role: "assistant" | "user") => {
      const id = StoreId.newMessageId();
      const saved = await Store.saveMessage(
        role === "assistant"
          ? {
              id,
              metadata: {
                createdAt: new Date(),
                modelId: "glm-5.3-flash",
                providerId: "openai-compatible",
                sessionId,
              },
              role,
            }
          : { id, metadata: { createdAt: new Date(), sessionId }, role },
        taskId,
      );
      expect(saved.isOk()).toBe(true);
      return id;
    };
    await say("user");
    await say("assistant");

    const before = await channelStandings(taskId);
    expect(before[0]?.unread).toBe(1);

    await markChannelSeen(taskId, sessionId);
    await say("user");

    const after = await channelStandings(taskId);
    expect(after[0]?.unread).toBe(0);
  });
});
