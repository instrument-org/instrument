import { describe, expect, it, vi } from "vitest";

import { type SessionMessagePart } from "../../schemas/session/message-part";
import { StoreId } from "../../schemas/store-id";
import { TaskIdSchema } from "../../schemas/task-id";
import { publisher } from "../publisher";
import { threadChanges } from "./orchestrator";

const taskId = TaskIdSchema.parse("orchestrator-changes");
const otherTaskId = TaskIdSchema.parse("orchestrator-other");
const childTaskId = TaskIdSchema.parse("orchestrator-child");

vi.mock(import("../../lib/task-settings"), async (importOriginal) => ({
  ...(await importOriginal()),
  getTaskSettings: (dir: string) =>
    Promise.resolve(
      dir.endsWith(childTaskId)
        ? { kind: "task" as const, name: "Child", parentTaskId: taskId }
        : undefined,
    ),
}));

/** A child's bash call as it lands, in the state a tool part reaches. */
const toolPart = (
  state: "input-available" | "input-streaming",
): SessionMessagePart.Type => ({
  input: { command: "ls", explanation: "Listing" },
  metadata: {
    createdAt: new Date(),
    id: StoreId.newPartId(),
    messageId: StoreId.newMessageId(),
    sessionId: StoreId.newSessionId(),
  },
  state,
  toolCallId: "call_1",
  type: "tool-bash",
});

/** Whether the stream fires within a tick, so a silence can be asserted too. */
async function fired(
  pending: Promise<IteratorResult<null, void>>,
): Promise<boolean> {
  return Promise.race([
    pending.then(() => true),
    new Promise<boolean>((resolve) => {
      setTimeout(() => {
        resolve(false);
      }, 50);
    }),
  ]);
}

describe("threadChanges", () => {
  it("fires when the workspace's apps change, since a thread's holds name only the apps the workspace has", async () => {
    const controller = new AbortController();
    const changes = threadChanges(taskId, controller.signal);
    const next = changes.next();
    publisher.publish("app.updated", null);
    expect(await fired(next)).toBe(true);
    controller.abort();
    await changes.return();
  });

  it.each([
    ["session.tagsChanged", { id: taskId, sessionId: StoreId.newSessionId() }],
    [
      "session.done",
      {
        id: taskId,
        parentSessionId: undefined,
        sessionId: StoreId.newSessionId(),
      },
    ],
  ] as const)(
    "fires on %s, since a thread's state is read off its agent's actor rather than the store",
    async (topic, payload) => {
      const controller = new AbortController();
      const changes = threadChanges(taskId, controller.signal);
      const next = changes.next();
      publisher.publish(topic, payload);
      expect(await fired(next)).toBe(true);
      controller.abort();
      await changes.return();
    },
  );

  it.each([
    ["session.updated", { id: otherTaskId, sessionId: StoreId.newSessionId() }],
    [
      "session.tagsChanged",
      { id: otherTaskId, sessionId: StoreId.newSessionId() },
    ],
  ] as const)("stays quiet on another task's %s", async (topic, payload) => {
    const controller = new AbortController();
    const changes = threadChanges(taskId, controller.signal);
    const next = changes.next();
    publisher.publish(topic, payload);
    expect(await fired(next)).toBe(false);
    controller.abort();
    await changes.return();
  });

  it.each([
    [
      "fires when a task filed from it starts a call",
      childTaskId,
      "input-available",
      true,
    ],
    [
      "stays quiet while a child's call is still streaming in",
      childTaskId,
      "input-streaming",
      false,
    ],
    [
      "stays quiet on a call in a task it did not file",
      otherTaskId,
      "input-available",
      false,
    ],
  ] as const)("%s", async (_name, id, state, expected) => {
    const controller = new AbortController();
    const changes = threadChanges(taskId, controller.signal);
    const next = changes.next();
    publisher.publish("part.updated", { id, part: toolPart(state) });
    expect(await fired(next)).toBe(expected);
    controller.abort();
    await changes.return();
  });
});
