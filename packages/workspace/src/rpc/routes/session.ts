import { AIGatewayModelURI, fetchModel } from "@instrument-org/ai-gateway";
import { call } from "@orpc/server";
import { z } from "zod";

import { stopRunningProcesses } from "../../lib/background-processes";
import { changedMessageBatches } from "../../lib/changed-message-batches";
import { isWorking } from "../../lib/chat/activity";
import { markChatStopped } from "../../lib/chat/chats";
import { noteTaskStoppedOnCard } from "../../lib/chat/wake";
import { closeAsksOf, openAsksOf } from "../../lib/chat/asks";
import { sessionOfChat } from "../../lib/record-folders";
import { getSessionMarkdown } from "../../lib/session-to-markdown";
import { ChatReads } from "../../lib/chat-reads";
import { Session } from "../../schemas/session";
import { StoreId } from "../../schemas/store-id";
import { ChatIdSchema } from "../../schemas/chat-id";
import { base, toORPCError } from "../base";

const byIdWithMessagesAndParts = base
  .input(
    z.object({
      id: ChatIdSchema,
      sessionId: StoreId.SessionSchema,
    }),
  )
  .output(Session.WithMessagesAndPartsSchema)
  .handler(async ({ errors, input }) => {
    const { id, sessionId } = input;
    const chatId = id;
    const session = await ChatReads.sessionWithMessages({ chatId, sessionId });

    if (session.isErr()) {
      throw toORPCError(session.error, errors);
    }

    return session.value;
  });

// Run the agent over the session as it stands, with nothing added to it. What
// the agent answers is the request already in the transcript, so a turn that
// failed on its way to the model is asked for again exactly as it was sent the
// first time, and the user is not made to say something to get it.
const run = base
  .input(
    z.object({
      id: ChatIdSchema,
      modelURI: AIGatewayModelURI.Schema,
      sessionId: StoreId.SessionSchema,
    }),
  )
  .output(z.void())
  .handler(async ({ context, errors, input }) => {
    const { id, modelURI, sessionId } = input;

    const modelResult = await fetchModel({
      captureException: context.workspaceConfig.captureException,
      configs: context.workspaceConfig.getAIProviderConfigs(),
      modelCache: context.workspaceConfig.modelCache,
      modelRoutes: context.workspaceConfig.modelRoutes,
      modelURI,
    });

    if (!modelResult.ok) {
      throw toORPCError(modelResult.error, errors);
    }

    context.workspaceRef.send({
      type: "runTurn",
      value: {
        id,
        model: modelResult.value,
        sessionId,
      },
    });
  });

/**
 * Stops a record's agents: a chat's, which is its own conversation and every
 * task it started; or with `sessionId`, that one session alone, a task's
 * from its row or page, with everything it has running in the background,
 * or the chat's own turn alone, which leaves its tasks working and its
 * processes running.
 */
const stop = base
  .input(
    z.object({
      id: ChatIdSchema,
      sessionId: StoreId.SessionSchema.optional(),
    }),
  )
  .handler(async ({ context, input }) => {
    // When the user pressed Stop, on the clock a message is dated by, and
    // whether it reaches a turn of the chat's own, read before the stop
    // lands on it.
    const pressedAt = new Date();
    const chatSessionId = sessionOfChat(input.id);
    const stopsOwnTurn =
      chatSessionId !== undefined &&
      (input.sessionId === undefined || input.sessionId === chatSessionId) &&
      isWorking(input.id, chatSessionId);
    // A task whose turn ended with a card still up has no turn for the stop
    // to end, so nothing would say it stopped; read before its cards go.
    const waitingOnCard =
      input.sessionId !== undefined &&
      input.sessionId !== chatSessionId &&
      !isWorking(input.id, input.sessionId) &&
      (await openAsksOf(input.id, input.sessionId)).length > 0
        ? input.sessionId
        : undefined;
    // A task the person stops ends what it runs in the background too, as
    // the agent's `instrument task stop --all` does. A job handed to the task is the
    // task's, so this reaches it. A process can take seconds to go, so the
    // turn is not kept waiting on it; the note the stop leaves the chat waits
    // instead (`wake.ts`), so it names nothing as still running.
    if (input.sessionId !== undefined && input.sessionId !== chatSessionId) {
      stopRunningProcesses({ by: "user", sessionId: input.sessionId }).catch(
        context.workspaceConfig.captureException,
      );
    }
    // The user's stop, which the task's page ends on. One task stopped
    // while the chat carries on is written into the chat as a note that
    // starts no turn; the chat's own session tells it nothing, since only a
    // task reports to its chat, and nor does a stop of the whole chat.
    context.workspaceRef.send({
      type: "stopSessions",
      value: {
        id: input.id,
        notice: { by: "user", wakesChat: input.sessionId !== undefined },
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      },
    });
    await Promise.all([
      // What the stopped sessions were waiting on the person to allow goes
      // with them, unanswered, so it neither keeps the chat waiting nor
      // starts them again when answered.
      closeAsksOf(input.id, input.sessionId),
      // The chat says the user stopped it until a turn starts after the
      // Stop, however far its turn had got, before it began included.
      stopsOwnTurn ? markChatStopped(input.id, pressedAt) : undefined,
    ]);
    // Not waited on, as a turn's end is not: its note waits out the
    // processes the stop ends.
    if (waitingOnCard !== undefined) {
      noteTaskStoppedOnCard(
        input.id,
        waitingOnCard,
        context.workspaceRef,
        "user",
      ).catch(context.workspaceConfig.captureException);
    }
  });

const toMarkdown = base
  .input(
    z.object({
      frontMatter: z.record(z.string(), z.unknown()).optional(),
      id: ChatIdSchema,
      sessionId: StoreId.SessionSchema,
    }),
  )
  .output(z.object({ markdown: z.string() }))
  .handler(async ({ input }) => {
    const { frontMatter, id, sessionId } = input;
    const chatId = id;

    const markdown = await getSessionMarkdown({
      frontMatter,
      sessionId,
      chatId,
    });
    return { markdown };
  });

const contextTokens = base
  .input(
    z.object({
      id: ChatIdSchema,
      sessionId: StoreId.SessionSchema,
    }),
  )
  .output(z.object({ inputTokens: z.number() }))
  .handler(async ({ errors, input }) => {
    const { id, sessionId } = input;
    const chatId = id;

    const inputTokens = await ChatReads.contextTokens({ chatId, sessionId });
    if (inputTokens.isErr()) {
      throw toORPCError(inputTokens.error, errors);
    }

    return { inputTokens: inputTokens.value };
  });

const live = {
  contextTokens: base
    .input(
      z.object({
        id: ChatIdSchema,
        sessionId: StoreId.SessionSchema,
      }),
    )
    .handler(async function* ({ context, input, signal }) {
      // Coalesce this session's message/part events into batches: the token
      // count depends only on this session, and a streaming turn's event storm
      // collapses into one recompute per batch instead of one per event.
      const batches = changedMessageBatches(input, signal);
      try {
        yield call(contextTokens, input, { context, signal });
        for await (const _batch of batches) {
          yield call(contextTokens, input, { context, signal });
        }
      } finally {
        await batches.return();
      }
    }),
};

export const session = {
  byIdWithMessagesAndParts,
  live,
  run,
  stop,
  toMarkdown,
};
