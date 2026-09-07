import { describe, expect, it, vi } from "vitest";

import { type SessionMessage } from "../../schemas/session/message";
import { StoreId } from "../../schemas/store-id";
import { TaskIdSchema } from "../../schemas/task-id";
import { createMockTaskConfig } from "../../test/helpers/mock-task-config";
import { Store } from "../store";
import {
  archiveChannel,
  channelByName,
  channelName,
  channelStandings,
  createChannel,
  DEFAULT_CHANNEL_NAME,
  listChannels,
  markChannelSeen,
  renameChannel,
  reorderChannels,
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
    ["#Reddit", "Reddit"],
    ["  Pelican News  ", "Pelican News"],
    ["a name that runs past the limit", "a name that runs"],
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
      {
        createdAt: expect.any(Number),
        id: existing,
        name: DEFAULT_CHANNEL_NAME,
      },
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
      DEFAULT_CHANNEL_NAME,
      "Reddit",
    ]);
    expect(await channelByName(taskId, "reddit")).toEqual(made);
    const session = await Store.getSession(made.id, taskId);
    expect(session._unsafeUnwrap().title).toBe("Reddit");
  });
});

describe("channelStandings", () => {
  it("counts what the agent said since the user last looked, and nothing else", async () => {
    const taskId = freshTask();
    const [channel] = await listChannels(taskId);
    const sessionId = channel?.id ?? StoreId.newSessionId();
    const sayUser = async () => {
      const saved = await Store.saveMessage(
        {
          id: StoreId.newMessageId(),
          metadata: { createdAt: new Date(), sessionId },
          role: "user",
        },
        taskId,
      );
      expect(saved.isOk()).toBe(true);
    };
    const sayAgent = async () => {
      const message: SessionMessage.Assistant = {
        id: StoreId.newMessageId(),
        metadata: {
          createdAt: new Date(),
          finishReason: "stop",
          modelId: "glm-5.3-flash",
          providerId: "openai-compatible",
          sessionId,
        },
        role: "assistant",
      };
      const saved = await Store.saveMessage(message, taskId);
      expect(saved.isOk()).toBe(true);
    };
    await sayUser();
    await sayAgent();

    const before = await channelStandings(taskId);
    expect(before[0]?.unread).toBe(1);

    await markChannelSeen(taskId, sessionId);
    await sayUser();

    const after = await channelStandings(taskId);
    expect(after[0]?.unread).toBe(0);
  });
});

describe("renameChannel", () => {
  it("renames in place, keeping the order", async () => {
    const taskId = freshTask();
    await listChannels(taskId);
    const made = await createChannel(taskId, "reddit");

    await renameChannel(taskId, made.id, "# Cross Stitch");

    expect((await listChannels(taskId)).map((channel) => channel.name)).toEqual(
      [DEFAULT_CHANNEL_NAME, "Cross Stitch"],
    );
  });
});

describe("archiveChannel", () => {
  it("takes a channel out of the strip and keeps its session", async () => {
    const taskId = freshTask();
    await listChannels(taskId);
    const made = await createChannel(taskId, "reddit");

    const result = await archiveChannel(taskId, made.id);

    expect(result.archived).toBe(true);
    expect((await listChannels(taskId)).map((channel) => channel.name)).toEqual(
      [DEFAULT_CHANNEL_NAME],
    );
    expect((await Store.getSession(made.id, taskId)).isOk()).toBe(true);
  });

  it("refuses the first channel, since the conversation happens somewhere", async () => {
    const taskId = freshTask();
    const [first] = await listChannels(taskId);
    await createChannel(taskId, "reddit");

    const result = await archiveChannel(taskId, first?.id ?? made());

    expect(result).toEqual({
      archived: false,
      reason: "The first channel stays.",
    });
  });
});

describe("reorderChannels", () => {
  it("keeps the order the strip was dragged into", async () => {
    const taskId = freshTask();
    const [first] = await listChannels(taskId);
    const second = await createChannel(taskId, "reddit");
    const third = await createChannel(taskId, "notion");

    await reorderChannels(taskId, [third.id, second.id, first?.id ?? made()]);

    expect((await listChannels(taskId)).map((channel) => channel.name)).toEqual(
      ["notion", "reddit", DEFAULT_CHANNEL_NAME],
    );
  });
});

/** A session id that is not a channel, for a branch that should never run. */
function made() {
  return StoreId.newSessionId();
}
