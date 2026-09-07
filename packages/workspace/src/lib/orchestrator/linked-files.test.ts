import { describe, expect, it, vi } from "vitest";

import { type SessionMessage } from "../../schemas/session/message";
import { StoreId } from "../../schemas/store-id";
import { type TaskId, TaskIdSchema } from "../../schemas/task-id";
import { createMockTaskConfig } from "../../test/helpers/mock-task-config";
import { Store } from "../store";
import { taskDir } from "../task-dir-utils";
import { getTaskState, setTaskState } from "../task-record";
import { linkedFiles } from "./linked-files";

vi.mock(import("../session-store-storage"));

// Task state and sessions are real files under the mock workspace, so a task
// id reused across runs would read the last run's conversation.
let counter = 0;
const freshTask = () =>
  createMockTaskConfig(
    TaskIdSchema.parse(`linked-${Date.now()}-${(counter += 1)}`),
  );

/** A channel of the conversation, with a session behind it. */
async function channel(taskId: TaskId, name: string) {
  const sessionId = StoreId.newSessionId();
  await Store.saveSession(
    { createdAt: new Date(), id: sessionId, title: name },
    taskId,
  );
  const state = await getTaskState(taskDir(taskId));
  await setTaskState(taskDir(taskId), {
    channels: [
      ...(state.channels ?? []),
      { createdAt: Date.now(), id: sessionId, name },
    ],
  });
  return sessionId;
}

/** A reply in a channel, said at a given moment. */
async function said(
  taskId: TaskId,
  sessionId: StoreId.Session,
  text: string,
  at: Date,
) {
  const messageId = StoreId.newMessageId();
  const message: SessionMessage.AssistantWithParts = {
    id: messageId,
    metadata: {
      createdAt: at,
      finishReason: "stop",
      modelId: "glm-5.3-flash",
      providerId: "openai-compatible",
      sessionId,
    },
    parts: [
      {
        metadata: {
          createdAt: at,
          id: StoreId.newPartId(),
          messageId,
          sessionId,
        },
        text,
        type: "text",
      },
    ],
    role: "assistant",
  };
  await Store.saveMessageWithParts(message, taskId);
}

const at = (minute: number) => new Date(Date.UTC(2026, 8, 7, 12, minute));

describe("linkedFiles", () => {
  it("names what a reply put on screen, newest first", async () => {
    const taskId = freshTask();
    const sessionId = await channel(taskId, "General");
    await said(
      taskId,
      sessionId,
      "Here is the draft.\n\n```files\noutput/report.md\n```",
      at(1),
    );
    await said(
      taskId,
      sessionId,
      "And the chart: [chart](output/chart.png)",
      at(2),
    );

    const shown = await linkedFiles(taskId);

    expect(shown.map((file) => file.path)).toEqual([
      "output/chart.png",
      "output/report.md",
    ]);
  });

  it("reads every channel, since the user saw all of them", async () => {
    const taskId = freshTask();
    const work = await channel(taskId, "Work");
    const home = await channel(taskId, "Home");
    await said(taskId, work, "```files\noutput/deck.pdf\n```", at(1));
    await said(taskId, home, "```files\n/mnt/Documents/plan.md\n```", at(2));

    const shown = await linkedFiles(taskId);

    expect(shown.map((file) => file.path)).toEqual([
      "/mnt/Documents/plan.md",
      "output/deck.pdf",
    ]);
  });

  it("leaves a path the reply only talked about out of it", async () => {
    const taskId = freshTask();
    const sessionId = await channel(taskId, "General");
    await said(
      taskId,
      sessionId,
      "I read output/notes.md and wrote this one.\n\n```files\noutput/report.md\n```",
      at(1),
    );

    const shown = await linkedFiles(taskId);

    expect(shown.map((file) => file.path)).toEqual(["output/report.md"]);
  });

  it("names a file shown twice once, at the last time it was shown", async () => {
    const taskId = freshTask();
    const sessionId = await channel(taskId, "General");
    await said(taskId, sessionId, "```files\noutput/report.md\n```", at(1));
    await said(taskId, sessionId, "```files\noutput/chart.png\n```", at(2));
    await said(taskId, sessionId, "```files\noutput/report.md\n```", at(3));

    const shown = await linkedFiles(taskId);

    expect(shown).toEqual([
      { at: at(3).getTime(), path: "output/report.md" },
      { at: at(2).getTime(), path: "output/chart.png" },
    ]);
  });

  it("has nothing to show for a conversation with no channels", async () => {
    const taskId = freshTask();

    await expect(linkedFiles(taskId)).resolves.toEqual([]);
  });
});
