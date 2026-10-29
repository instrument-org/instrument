import { type Result } from "neverthrow";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SessionMessage } from "../schemas/session/message";
import { SessionMessagePart } from "../schemas/session/message-part";
import { StoreId } from "../schemas/store-id";
import { withChatDb } from "../test/helpers/chat-db";
import { INTERRUPTED_TOOL_CALL_ERROR_TEXT } from "../constants";
import { getParsedStorageItem } from "./get-parsed-storage-item";
import { sweepInterruptedToolCalls } from "./interrupted-tool-calls";
import { setParsedStorageItem } from "./set-parsed-storage-item";
import { StorageKey } from "./storage-key";

const createdAt = new Date("2025-01-01T00:00:00.000Z");

let file: string;
let root: string;
let sessionId: StoreId.Session;

beforeEach(async () => {
  root = await fs.mkdtemp(
    path.join(os.tmpdir(), "interrupted-tool-calls-test-"),
  );
  file = path.join(root, "chat.db");
  sessionId = StoreId.newSessionId();
});

afterEach(async () => {
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

/** Sweeps the database, as the converter does on its way through one. */
async function sweep() {
  await withChatDb(file, async (storage) => {
    unwrap(await sweepInterruptedToolCalls({ storage }));
  });
}

function readParts(message: SessionMessage.Type) {
  return withChatDb(file, async (storage) => {
    const keys = unwrap(
      await storage.getKeys(
        StorageKey.parts(message.metadata.sessionId, message.id),
      ),
    );
    return Promise.all(
      keys.map(async (key) =>
        (
          await getParsedStorageItem(
            key,
            SessionMessagePart.CoercedSchema,
            storage,
          )
        )._unsafeUnwrap(),
      ),
    );
  });
}

/**
 * Writes a message and its parts the way the store wrote them, in one open:
 * the sweep runs over a `chat.db` an older build left, which is the only
 * shape it has ever had to read.
 */
async function seed(
  message: SessionMessage.Type,
  parts: SessionMessagePart.Type[],
) {
  await withChatDb(file, async (storage) => {
    (
      await setParsedStorageItem(
        StorageKey.message(message.metadata.sessionId, message.id),
        message,
        SessionMessage.Schema,
        storage,
      )
    )._unsafeUnwrap();
    for (const part of parts) {
      (
        await setParsedStorageItem(
          StorageKey.part(
            part.metadata.sessionId,
            part.metadata.messageId,
            part.metadata.id,
          ),
          part,
          SessionMessagePart.CoercedSchema,
          storage,
        )
      )._unsafeUnwrap();
    }
  });
}

// request_folder: a tool whose input and output are small enough to spell out
// here in every state.
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
    input: {
      questions: [
        {
          choices: [{ label: "Desktop" }, { label: "Documents" }],
          header: "Pick",
          question: "Where?",
        },
      ],
    },
    metadata,
    toolCallId: `call-${metadata.id}`,
    type: "tool-choose" as const,
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
        output: { declined: true as const, note: undefined },
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
      await sweep();

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
    await sweep();

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
    await sweep();

    const [part] = await readParts(running);

    expect(part).toMatchObject({ state: "output-error" });
  });

  it("sweeps every session in the chat", async () => {
    const rootMessage = assistantMessage();
    const childMessage = assistantMessage(StoreId.newSessionId());
    await seed(rootMessage, [toolPart(rootMessage, "input-available")]);
    await seed(childMessage, [toolPart(childMessage, "input-streaming")]);
    await sweep();

    const [rootPart] = await readParts(rootMessage);
    const [childPart] = await readParts(childMessage);

    expect(rootPart).toMatchObject({ state: "output-error" });
    expect(childPart).toMatchObject({ state: "output-error" });
  });

  it("is unchanged by a second sweep", async () => {
    const message = assistantMessage();
    await seed(message, [toolPart(message, "input-available")]);
    await sweep();
    const [swept] = await readParts(message);
    await sweep();

    const [again] = await readParts(message);

    expect(again).toEqual(swept);
  });
});
