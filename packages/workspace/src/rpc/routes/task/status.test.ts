import { call } from "@orpc/server";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TASKS_DIR_NAME } from "../../../constants";
import { recordChanged } from "../../../lib/record-changes";
import { Store } from "../../../lib/store";
import { cancelHold, holdTask } from "../../../lib/task-hold";
import { updateTaskSettings } from "../../../lib/task-settings";
import { setWorkspaceActorRef } from "../../../lib/workspace-actor-ref";
import { getWorkspaceConfig } from "../../../lib/workspace-config";
import { type SessionMessage } from "../../../schemas/session/message";
import { StoreId } from "../../../schemas/store-id";
import { type TaskId } from "../../../schemas/task-id";
import { createMockTaskConfigForDir } from "../../../test/helpers/mock-task-config";
import { type WorkspaceRPCContext } from "../../base";
import { taskStatus } from "./status";

vi.mock(import("../../../lib/session-store-storage"));

// Which tasks have an agent alive: the machine's answer, as a dial.
const alive = new Set<TaskId>();
setWorkspaceActorRef({
  getSnapshot: () => ({
    context: {
      sessionRefsByTaskId: {
        get: (id: TaskId) =>
          alive.has(id)
            ? [
                {
                  getSnapshot: () => ({
                    context: { sessionId: StoreId.newSessionId() },
                    tags: new Set(["agent.alive"]),
                  }),
                },
              ]
            : [],
      },
    },
  }),
} as never);

const context: WorkspaceRPCContext = {
  workspaceConfig: getWorkspaceConfig(),
  workspaceRef: undefined as never,
};

let root: string;
let taskId: TaskId;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "task-status-"));
  taskId = createMockTaskConfigForDir(
    path.join(root, TASKS_DIR_NAME, "lisbon-hotel"),
  );
  await fs.mkdir(path.join(root, TASKS_DIR_NAME, "lisbon-hotel"), {
    recursive: true,
  });
  (await updateTaskSettings(taskId, { name: "Lisbon hotel" }))._unsafeUnwrap();
  alive.clear();
});

afterEach(async () => {
  await fs.rm(root, { force: true, recursive: true });
});

/** An assistant message at work on a step, as a turn writes it. */
async function agentIsAt(sessionId: StoreId.Session, explanation: string) {
  const messageId = StoreId.newMessageId();
  const message: SessionMessage.AssistantWithParts = {
    id: messageId,
    metadata: {
      createdAt: new Date(),
      finishReason: "unknown",
      modelId: "glm-5.3-flash",
      providerId: "openai-compatible",
      sessionId,
    },
    parts: [
      {
        input: { command: "ls", explanation, yieldMs: 1000 },
        metadata: {
          createdAt: new Date(),
          id: StoreId.newPartId(),
          messageId,
          sessionId,
        },
        state: "input-available",
        toolCallId: `call_${messageId}`,
        type: "tool-bash",
      },
    ],
    role: "assistant",
  };
  (await Store.saveMessageWithParts(message, taskId))._unsafeUnwrap();
}

describe("task.live.status", () => {
  it("answers again as the task is held, let go, starts, and moves to a step", async () => {
    const controller = new AbortController();
    const live = await call(
      taskStatus.live,
      { id: taskId },
      { context, signal: controller.signal },
    );
    const next = async () => {
      const answer = await live.next();
      return answer.done ? undefined : answer.value;
    };

    expect(await next()).toMatchObject({
      isWorking: false,
      title: "Lisbon hotel",
    });

    holdTask(taskId, {
      reason: "r",
      start: () => undefined,
      until: new Promise<undefined>(() => undefined),
      userReason: "Waiting for you to allow access to Desktop",
    });
    expect((await next())?.held).toBe(
      "Waiting for you to allow access to Desktop",
    );
    cancelHold(taskId);
    expect((await next())?.held).toBeUndefined();

    const sessionId = StoreId.newSessionId();
    (
      await Store.saveSession(
        { createdAt: new Date(), id: sessionId, title: "Lisbon hotel" },
        taskId,
      )
    )._unsafeUnwrap();
    expect((await next())?.newestSessionId).toBe(sessionId);

    alive.add(taskId);
    recordChanged(taskId, "agent");
    expect(await next()).toMatchObject({ isWorking: true });

    await agentIsAt(sessionId, "Comparing prices");
    expect((await next())?.step).toBe("Comparing prices");

    expect(await call(taskStatus.status, { id: taskId }, { context })).toEqual(
      expect.objectContaining({
        isWorking: true,
        newestSessionId: sessionId,
        step: "Comparing prices",
      }),
    );
    controller.abort();
  });
});
