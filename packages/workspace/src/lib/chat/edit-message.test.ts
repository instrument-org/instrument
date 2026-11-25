import { AIGatewayModelURI } from "@instrument-org/ai-gateway";
import { describe, expect, it, vi } from "vitest";

import { type WorkspaceActorRef } from "../../machines/workspace";
import { type ChatId } from "../../schemas/chat-id";
import { type SessionMessage } from "../../schemas/session/message";
import { StoreId } from "../../schemas/store-id";
import { chatTaskFor } from "../../test/helpers/chat-task";
import { ChatReads } from "../chat-reads";
import { ChatWrites } from "../chat-writes";
import { newMessage } from "../new-message";
import { sessionOfChat } from "../record-folders";
import { branchChat } from "./branch-chat";
import { ensureChat } from "./chat-records";
import { asNewVersion, beginEdit } from "./edit-message";

// Nothing runs in a test, which the edit waits on the machine about.
vi.mock(import("./activity"), async (importOriginal) => ({
  ...(await importOriginal()),
  chatActivity: () => Promise.resolve({ running: [] }),
  isWorking: () => false,
}));

function said(
  sessionId: StoreId.Session,
  role: "assistant" | "user",
  text: string,
): SessionMessage.WithParts {
  const id = StoreId.newMessageId();
  const createdAt = new Date();
  const metadata = { createdAt, sessionId };
  const parts: SessionMessage.WithParts["parts"] = [
    {
      metadata: {
        ...metadata,
        id: StoreId.newPartId(),
        messageId: id,
      },
      state: "done",
      text,
      type: "text",
    },
  ];
  return role === "user"
    ? { id, metadata, parts, role }
    : {
        id,
        metadata: {
          ...metadata,
          finishReason: "stop",
          modelId: "m",
          providerId: "openai",
        },
        parts,
        role,
      };
}

function wordsOf(messages: readonly SessionMessage.WithParts[]) {
  return messages.flatMap(({ parts }) =>
    parts.flatMap((part) => (part.type === "text" ? [part.text] : [])),
  );
}

async function chat() {
  const sessionId = StoreId.newSessionId();
  const chatId = await ensureChat(sessionId, "Pricing");
  const messages = [
    said(sessionId, "user", "one"),
    said(sessionId, "assistant", "reply one"),
    said(sessionId, "user", "two"),
    said(sessionId, "assistant", "reply two"),
  ];
  for (const message of messages) {
    (await ChatWrites.saveMessageWithParts(message, chatId))._unsafeUnwrap();
  }
  return { chatId, messages, sessionId };
}

const sent: unknown[] = [];
const workspaceRef = {
  send: (event: unknown) => {
    sent.push(event);
  },
  // Only `send` is asked of it.
} as unknown as WorkspaceActorRef;

/** Edits `messageId` to say `text`, as the send route does. */
async function edit(
  chatId: ChatId,
  sessionId: StoreId.Session,
  messageId: StoreId.Message,
  text: string,
) {
  const { edited, takesOut } = await beginEdit({
    chatId,
    messageId,
    sessionId,
    workspaceRef,
  });
  const draft = said(sessionId, "user", text);
  if (draft.role !== "user") {
    throw new Error("expected a user message");
  }
  const message = asNewVersion(draft, edited);
  (await ChatWrites.saveMessageWithParts(message, chatId))._unsafeUnwrap();
  (
    await ChatWrites.retract(chatId, sessionId, takesOut, edited.id)
  )._unsafeUnwrap();
  return message;
}

async function history(chatId: ChatId, sessionId: StoreId.Session) {
  return wordsOf(
    (await ChatReads.history({ chatId, sessionId }))._unsafeUnwrap(),
  );
}

describe("editing a message", () => {
  it("takes its place and keeps every version it was", async () => {
    const { chatId, messages, sessionId } = await chat();
    const two = messages[2]?.id ?? StoreId.newMessageId();

    const first = await edit(chatId, sessionId, two, "two, again");
    const second = await edit(chatId, sessionId, first.id, "two, thrice");

    expect(await history(chatId, sessionId)).toEqual([
      "one",
      "reply one",
      "two, thrice",
    ]);
    expect(second.metadata.earlierVersions).toEqual([two, first.id]);
    const version = await ChatReads.versionTranscript({
      chatId,
      edited: two,
      sessionId,
    });
    expect(wordsOf(version._unsafeUnwrap())).toEqual(["two", "reply two"]);
  });

  it("branches from an earlier version's reply", async () => {
    const { chatId, messages, sessionId } = await chat();
    const two = messages[2]?.id ?? StoreId.newMessageId();
    const replyTwo = messages[3]?.id ?? StoreId.newMessageId();
    await edit(chatId, sessionId, two, "two, again");

    const branch = await branchChat({ chatId, upTo: replyTwo, version: two });

    const branchSession = sessionOfChat(branch) ?? StoreId.newSessionId();
    expect(await history(branch, branchSession)).toEqual([
      "one",
      "reply one",
      "two",
      "reply two",
    ]);
  });

  it("stops the chat's own turn and only the tasks started since the message", async () => {
    const { chatId, messages, sessionId } = await chat();
    const task = await chatTaskFor(chatId, { title: "Later" });
    const after = said(sessionId, "user", "three");
    (await ChatWrites.saveMessageWithParts(after, chatId))._unsafeUnwrap();

    const stoppedBy = async (messageId: StoreId.Message) => {
      const before = sent.length;
      await beginEdit({ chatId, messageId, sessionId, workspaceRef });
      return sent
        .slice(before)
        .map((event) => (event as { value: { sessionId: string } }).value)
        .map((value) => value.sessionId);
    };

    expect(await stoppedBy(after.id)).toEqual([sessionId]);
    expect(await stoppedBy(messages[2]?.id ?? after.id)).toEqual([
      sessionId,
      task,
    ]);
  });

  it("builds the new version from what the agent will have been told", async () => {
    const { chatId, messages, sessionId } = await chat();
    const away = said(sessionId, "user", "three");
    away.metadata.createdAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
    (await ChatWrites.saveMessageWithParts(away, chatId))._unsafeUnwrap();
    const gapOf = async (without?: ReadonlySet<StoreId.Message>) => {
      const built = await newMessage({
        chatId,
        modelURI: AIGatewayModelURI.Schema.parse(
          "openai/gpt-5?provider=openai&providerConfigId=test",
        ),
        prompt: "again",
        sessionId,
        ...(without ? { without } : {}),
      });
      const message = built._unsafeUnwrap();
      return message && "parts" in message
        ? message.parts.find(({ type }) => type === "data-messageGap")
        : expect.unreachable();
    };

    expect(await gapOf()).toBeDefined();
    const all = [...messages, away].map(({ id }) => id);
    expect(await gapOf(new Set(all))).toBeUndefined();
  });

  it("refuses a reply, which is not the person's to edit", async () => {
    const { chatId, messages, sessionId } = await chat();
    const before = sent.length;

    await expect(
      beginEdit({
        chatId,
        messageId: messages[1]?.id ?? StoreId.newMessageId(),
        sessionId,
        workspaceRef,
      }),
    ).rejects.toThrow("to edit");
    expect(sent).toHaveLength(before);
  });
});
