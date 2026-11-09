import { type LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { OUR_PROVIDER_CONFIG } from "@instrument-org/shared";
import { call } from "@orpc/server";
import { MockLanguageModelV4 } from "ai/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { type AnyActorRef, createActor, setup, waitFor } from "xstate";

import { UNTITLED_CHAT_TITLE } from "../../constants";
import { ChatWrites } from "../../lib/chat-writes";
import {
  applyFeedEvent,
  type TranscriptFeed,
  type TranscriptFeedEvent,
} from "../../lib/transcript/feed";
import { getWorkspaceConfig } from "../../lib/workspace-config";
import { llmRequestLogic } from "../../logic/llm-request";
import { type WorkspaceActorRef } from "../../machines/workspace";
import { type SessionMessage } from "../../schemas/session/message";
import { StoreId } from "../../schemas/store-id";
import { createMockAIGatewayModel } from "../../test/helpers/mock-ai-gateway-model";
import { createMockChatConfigForDir } from "../../test/helpers/mock-chat-config";
import { message } from "./message";

let dir = "";

beforeEach(async () => {
  dir = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "message-feed-")),
  );
});

afterEach(async () => {
  await fs.rm(dir, { force: true, recursive: true });
});

function contextMessages(
  sessionId: StoreId.Session,
): SessionMessage.ContextWithParts[] {
  const id = StoreId.newMessageId();
  const createdAt = new Date();
  return [
    {
      id,
      metadata: {
        agentName: "main",
        createdAt,
        realRole: "assistant",
        sessionId,
      },
      parts: [
        {
          metadata: {
            createdAt,
            id: StoreId.newPartId(),
            messageId: id,
            sessionId,
          },
          text: "You are a helpful assistant.",
          type: "text",
        },
      ],
      role: "session-context",
    },
  ];
}

/**
 * The real path from a model's stream to a reader: the request that writes the
 * reply, the records that hold it, and the route that follows them. The test
 * hands the stream each chunk itself, so what the reader holds can be read
 * between two of them without any clock.
 */
async function replyFollowedByAReader() {
  let stream: ReadableStreamDefaultController<LanguageModelV4StreamPart>;
  const aiSDKModel = new MockLanguageModelV4({
    doStream: () =>
      Promise.resolve({
        stream: new ReadableStream<LanguageModelV4StreamPart>({
          start: (controller) => {
            stream = controller;
          },
        }),
      }),
    provider: OUR_PROVIDER_CONFIG.type,
  });
  const model = createMockAIGatewayModel({
    provider: OUR_PROVIDER_CONFIG.type,
  });
  const sessionId = StoreId.newSessionId();
  const chatId = createMockChatConfigForDir(path.join(dir, "chat"), {
    aiSDKModel,
    model,
  });
  await ChatWrites.saveSession(
    { createdAt: new Date(), id: sessionId, title: UNTITLED_CHAT_TITLE },
    chatId,
  );

  const reading = new AbortController();
  const events = await call(
    message.live.feed,
    { id: chatId, sessionId },
    {
      context: {
        workspaceConfig: getWorkspaceConfig(),
        workspaceRef: { send: () => undefined } as unknown as WorkspaceActorRef,
      },
      signal: reading.signal,
    },
  );
  const reader: { feed?: TranscriptFeed; sent: TranscriptFeedEvent[] } = {
    sent: [],
  };
  void (async () => {
    for await (const event of events) {
      // A copy, as what crosses the port to the window is.
      const sent = structuredClone(event);
      reader.sent.push(sent);
      reader.feed = applyFeedEvent(reader.feed, sent);
    }
  })().catch(() => undefined);

  const request = createActor(
    setup({ actors: { llmRequest: llmRequestLogic } }).createMachine({
      initial: "Asking",
      states: {
        Answered: { type: "final" },
        Asking: {
          invoke: {
            input: () => ({
              agent: {
                agentTools: {},
                getMessages: () => Promise.resolve(contextMessages(sessionId)),
                getTools: () => Promise.resolve([]),
                name: "instrument",
                onFinish: () => Promise.resolve(),
                onStart: () => Promise.resolve(),
                shouldContinue: () => Promise.resolve(true),
                systemPrompt: () => "You are a helpful assistant.",
              },
              chatId,
              model,
              self: { send: vi.fn() } as unknown as AnyActorRef,
              sessionId,
              stepCount: 1,
            }),
            onDone: "Answered",
            src: "llmRequest",
          },
        },
      },
    }),
  );
  request.start();
  await vi.waitFor(() => {
    expect(aiSDKModel.doStreamCalls).toHaveLength(1);
    expect(stream).toBeDefined();
  });

  return {
    /** What the reader holds of the reply, as its text parts. */
    held: () =>
      (reader.feed?.messages.at(-1)?.parts ?? []).flatMap((part) =>
        part.type === "text"
          ? [{ id: part.metadata.id, state: part.state, text: part.text }]
          : [],
      ),
    push: (chunk: LanguageModelV4StreamPart) => {
      stream.enqueue(chunk);
    },
    finish: async () => {
      stream.enqueue({
        finishReason: { raw: "stop", unified: "stop" },
        type: "finish",
        usage: {
          inputTokens: {
            cacheRead: undefined,
            cacheWrite: undefined,
            noCache: undefined,
            total: 3,
          },
          outputTokens: { reasoning: undefined, text: undefined, total: 10 },
        },
      });
      stream.close();
      await waitFor(request, (state) => state.status === "done");
    },
    reader,
    stopReading: () => {
      reading.abort();
    },
  };
}

it("hands a reader a reply's words as they arrive, and settles them in the same row", async () => {
  const reply = await replyFollowedByAReader();
  reply.push({ id: "1", type: "text-start" });

  let said = "";
  for (const delta of ["Looking ", "at the ", "list ", "now."]) {
    reply.push({ delta, id: "1", type: "text-delta" });
    said += delta;
    await vi.waitFor(() => {
      expect(reply.held().map(({ text }) => text)).toEqual([said]);
    });
  }
  const [streaming] = reply.held();
  expect(streaming?.state).toBe("streaming");

  reply.push({ id: "1", type: "text-end" });
  await reply.finish();
  await vi.waitFor(() => {
    expect(reply.held()).toEqual([
      { id: streaming?.id, state: "done", text: said },
    ]);
  });

  // The words after the first went out as what they added, not the whole part.
  const appended = reply.reader.sent.flatMap((event) =>
    event.kind === "change"
      ? event.patches.flatMap((patch) =>
          patch.kind === "append" ? [patch.text] : [],
        )
      : [],
  );
  expect(appended).toEqual(["at the ", "list ", "now."]);
  reply.stopReading();
});
