import { type Result } from "neverthrow";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TASKS_DIR_NAME } from "../constants";
import { type SessionMessage } from "../schemas/session/message";
import { type SessionMessagePart } from "../schemas/session/message-part";
import { StoreId } from "../schemas/store-id";
import { type TaskId, TaskIdSchema } from "../schemas/task-id";
import { createMockTaskConfigForDir } from "../test/helpers/mock-task-config";
import { INTERRUPTED_TOOL_CALL_ERROR_TEXT } from "./interrupted-tool-calls";
import { isToolPart } from "./is-tool-part";
import {
  disposeSessionsStoreStorage,
  getSessionsStoreStorage,
} from "./session-store-storage";
import { Store } from "./store";
import { taskDir } from "./task-dir-utils";

const id = TaskIdSchema.parse("interrupted-tool-calls-test");
const createdAt = new Date("2025-01-01T00:00:00.000Z");

let taskId: TaskId;
let root: string;
let sessionId: StoreId.Session;

beforeEach(async () => {
  root = await fs.mkdtemp(
    path.join(os.tmpdir(), "interrupted-tool-calls-test-"),
  );
  taskId = createMockTaskConfigForDir(path.join(root, TASKS_DIR_NAME, id));
  await fs.mkdir(taskDir(taskId), { recursive: true });
  sessionId = StoreId.newSessionId();
});

afterEach(async () => {
  await disposeSessionsStoreStorage(id);
  await fs.rm(root, { force: true, recursive: true });
});

function assistantMessage(
  messageSessionId: StoreId.Session = sessionId,
): SessionMessage.Assistant {
  return {
    id: StoreId.newMessageId(),
    metadata: {
      createdAt,
      finishReason: "tool-calls",
      modelId: "test-model",
      providerId: "test",
      sessionId: messageSessionId,
    },
    role: "assistant",
  };
}

/** Closes the database, which is what a process ending does to it. */
async function endProcess() {
  unwrap(await disposeSessionsStoreStorage(id));
}

async function readParts(message: SessionMessage.Type) {
  return unwrap(
    await Store.getParts(message.metadata.sessionId, message.id, taskId),
  );
}

/** Writes a message and its parts the way a run does, in one open. */
async function seed(
  message: SessionMessage.Type,
  parts: SessionMessagePart.Type[],
) {
  unwrap(await Store.saveMessage(message, taskId));
  for (const part of parts) {
    unwrap(await Store.savePart(part, taskId, { publish: false }));
  }
}

// start_activity: the one tool whose input and output are small enough to
// spell out here in every state.
function toolPart(
  message: SessionMessage.Type,
  state: SessionMessagePart.ToolPart["state"],
): SessionMessagePart.Type {
  const metadata = {
    createdAt,
    id: StoreId.newPartId(),
    messageId: message.id,
    sessionId: message.metadata.sessionId,
  };
  const call = {
    input: { title: "Waiting" },
    metadata,
    toolCallId: `call-${metadata.id}`,
    type: "tool-start_activity" as const,
  };
  switch (state) {
    case "input-available": {
      return { ...call, state };
    }
    case "input-streaming": {
      return { ...call, state };
    }
    case "output-available": {
      return {
        ...call,
        metadata: { ...metadata, endedAt: createdAt },
        output: {},
        state,
      };
    }
    case "output-error": {
      return {
        ...call,
        errorText: "failed",
        metadata: { ...metadata, endedAt: createdAt },
        state,
      };
    }
  }
}

function unwrap<T, E>(result: Result<T, E>): T {
  if (result.isErr()) {
    throw result.error instanceof Error
      ? result.error
      : new Error(String(result.error));
  }
  return result.value;
}

function userMessage(): SessionMessage.User {
  return {
    id: StoreId.newMessageId(),
    metadata: { createdAt, sessionId },
    role: "user",
  };
}

describe("sweepInterruptedToolCalls", () => {
  it.each(["input-available", "input-streaming"] as const)(
    "finalizes a %s tool call the previous process left behind",
    async (state) => {
      const message = assistantMessage();
      await seed(message, [toolPart(message, state)]);
      await endProcess();

      const [part] = await readParts(message);

      expect(part).toMatchObject({
        errorText: INTERRUPTED_TOOL_CALL_ERROR_TEXT,
        state: "output-error",
      });
      expect(part?.metadata).toHaveProperty("endedAt", expect.any(Date));
    },
  );

  it("leaves finished calls and non-tool parts alone", async () => {
    const message = assistantMessage();
    const finished = toolPart(message, "output-available");
    const errored = toolPart(message, "output-error");
    const text: SessionMessagePart.Type = {
      metadata: {
        createdAt,
        id: StoreId.newPartId(),
        messageId: message.id,
        sessionId,
      },
      text: "hello",
      type: "text",
    };
    await seed(message, [finished, errored, text]);
    await endProcess();

    const parts = await readParts(message);

    expect(parts.map((part) => ("state" in part ? part.state : part.type)))
      .toMatchInlineSnapshot(`
        [
          "output-available",
          "output-error",
          "text",
        ]
      `);
  });

  // The call the process died in is in the newest assistant message; user
  // messages saved after it, while the run was still going, do not hide it.
  it("finds the call behind user messages the run never answered", async () => {
    const answered = assistantMessage();
    const running = assistantMessage();
    const unanswered = userMessage();
    await seed(answered, [toolPart(answered, "output-available")]);
    await seed(running, [toolPart(running, "input-available")]);
    await seed(unanswered, []);
    await endProcess();

    const [part] = await readParts(running);

    expect(part).toMatchObject({ state: "output-error" });
  });

  it("sweeps every session in the task", async () => {
    const rootMessage = assistantMessage();
    const childMessage = assistantMessage(StoreId.newSessionId());
    await seed(rootMessage, [toolPart(rootMessage, "input-available")]);
    await seed(childMessage, [toolPart(childMessage, "input-streaming")]);
    await endProcess();

    const [rootPart] = await readParts(rootMessage);
    const [childPart] = await readParts(childMessage);

    expect(rootPart).toMatchObject({ state: "output-error" });
    expect(childPart).toMatchObject({ state: "output-error" });
  });

  it("runs on open, before the first read", async () => {
    const message = assistantMessage();
    await seed(message, [toolPart(message, "input-available")]);
    await endProcess();

    // The first thing this process does with the task.
    const storage = unwrap(await getSessionsStoreStorage(taskId));
    const keys = unwrap(await storage.getKeys("parts"));
    const stored = unwrap(await storage.getItemRaw<string>(keys[0] ?? ""));

    expect(stored).toContain('"output-error"');
  });

  it("is unchanged by a second open", async () => {
    const message = assistantMessage();
    await seed(message, [toolPart(message, "input-available")]);
    await endProcess();
    const [swept] = await readParts(message);
    await endProcess();

    const [again] = await readParts(message);

    expect(again).toEqual(swept);
  });

  it("does not touch a call a live run is executing", async () => {
    const message = assistantMessage();
    // Written after this process opened the task: the run that owns it is
    // this process's own, and only its finish may settle it.
    await seed(message, [toolPart(message, "input-available")]);

    const parts = await readParts(message);

    expect(parts.filter(isToolPart).map((part) => part.state))
      .toMatchInlineSnapshot(`
        [
          "input-available",
        ]
      `);
  });
});
