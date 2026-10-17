import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";

import { AbsolutePathSchema, WorkspaceDirSchema } from "../../schemas/paths";
import { type SessionMessage } from "../../schemas/session/message";
import { SessionMessagePart } from "../../schemas/session/message-part";
import { StoreId } from "../../schemas/store-id";
import { chatFor } from "../../test/helpers/chat-record";
import { removeChatsDir } from "../../test/helpers/remove-chats-dir";
import { withTestRecords } from "../../test/helpers/with-test-records";
import { ChatWrites } from "../chat-writes";
import { createSession } from "../create-session";
import { forgetChatFolders } from "../record-folders";
import { liveView } from "../records/views";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { latestStep } from "./activity";

/**
 * The step a session at work is read by, while the call that names it is
 * still arriving: it is in the turn's own memory and nowhere else until it
 * settles, and the snapshot that settles it takes it back out.
 */

const records = withTestRecords();

let rootDir: string;

beforeEach(async () => {
  rootDir = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "live-step-")),
  );
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    chatsDir: AbsolutePathSchema.parse(path.join(rootDir, "chats")),
    rootDir: WorkspaceDirSchema.parse(rootDir),
  });
  forgetChatFolders();
});

afterEach(async () => {
  forgetChatFolders();
  await removeChatsDir(rootDir);
});

/** A `bash` call of the reply's, with the input the model has typed so far. */
function bashCall(
  message: SessionMessage.Assistant,
  input: Record<string, string>,
  state: "input-available" | "input-streaming",
  id: StoreId.Part,
): SessionMessagePart.Type {
  return SessionMessagePart.coerce({
    input,
    metadata: {
      createdAt: new Date(),
      id,
      messageId: message.id,
      sessionId: message.metadata.sessionId,
    },
    state,
    toolCallId: `call-${id}`,
    type: "tool-bash",
  });
}

it("reads the step off a call still arriving, and off the written one once it settles", async () => {
  const sessionId = StoreId.newSessionId();
  const chatId = await chatFor(sessionId);
  (await createSession({ chatId, sessionId }))._unsafeUnwrap();
  const ref = { chatId, sessionId };
  const replying: SessionMessage.Assistant = {
    id: StoreId.newMessageId(),
    metadata: {
      createdAt: new Date(),
      finishReason: "unknown",
      modelId: "test-model",
      providerId: "test-provider",
      sessionId,
    },
    role: "assistant",
  };
  (await ChatWrites.saveMessage(replying, chatId))._unsafeUnwrap();
  const partId = StoreId.newPartId();
  const arriving = bashCall(
    replying,
    { activity: "Reading the list", command: "cat li" },
    "input-streaming",
    partId,
  );

  const live = records.service.live(chatId, sessionId);
  live.setMessage(replying);
  live.setPart(arriving);

  // Nothing of the call is written, so this is the turn's memory talking.
  expect(await latestStep(ref)).toBe("Reading the list");

  const settled = bashCall(
    replying,
    { activity: "Reading the whole list", command: "cat list.md" },
    "input-available",
    partId,
  );
  (await ChatWrites.savePart(settled, chatId))._unsafeUnwrap();

  // The record stands for it now, so the turn no longer holds it.
  const read = await records.service.read(chatId);
  expect(liveView(read, sessionId)).toEqual([{ ...replying, parts: [] }]);
  expect(await latestStep(ref)).toBe("Reading the whole list");
});

it("reads no step from a turn nothing is holding", async () => {
  const sessionId = StoreId.newSessionId();
  const chatId = await chatFor(sessionId);
  (await createSession({ chatId, sessionId }))._unsafeUnwrap();

  expect(await latestStep({ chatId, sessionId })).toBeUndefined();
});
