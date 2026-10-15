import { AIGatewayModelURI, fetchModel } from "@instrument-org/ai-gateway";
import { eventIterator, type } from "@orpc/server";
import { z } from "zod";

import { changedMessageBatches } from "../../lib/changed-message-batches";
import { ChatReads } from "../../lib/chat-reads";
import { ensureChatSession } from "../../lib/create-session";
import { createWriteQueue } from "../../lib/create-write-queue";
import { generateTitleFromUserMessage } from "../../lib/generate-title-from-user-message";
import { LiveMessagesSnapshot } from "../../lib/live-messages-snapshot";
import { newMessage } from "../../lib/new-message";
import { setChatTopics } from "../../lib/chat/chats";

import { Store } from "../../lib/store";
import { recordChatActivity } from "../../lib/chat-settings";
import { updateSessionTitle } from "../../lib/update-session-title";
import { FileUpload } from "../../schemas/file-upload";
import { closeQuestions } from "../../lib/chat/asks";
import { SessionMessage } from "../../schemas/session/message";
import { SessionMessageDataPart } from "../../schemas/session/message-data-part";
import { StoreId } from "../../schemas/store-id";
import { ChatIdSchema } from "../../schemas/chat-id";
import { base, toORPCError } from "../base";

const listWithParts = base
  .input(
    z.object({
      id: ChatIdSchema,
      sessionId: StoreId.SessionSchema,
    }),
  )
  .output(z.array(SessionMessage.WithPartsSchema))
  .handler(async ({ errors, input }) => {
    const { id, sessionId } = input;
    const chatId = id;
    const messages = await ChatReads.transcript({
      bytes: true,
      chatId,
      sessionId,
    });

    if (messages.isErr()) {
      throw toORPCError(messages.error, errors);
    }

    return messages.value;
  });

/**
 * One send at a time per chat, in the order they arrived. The opening
 * message of a chat reads the other chats before it is stored, which can
 * take a moment, and a message sent into the chat meanwhile would otherwise
 * be stored, numbered, and handed to the agent ahead of the one it follows.
 */
const sendsInOrder = createWriteQueue();

const create = base
  .input(
    z.object({
      /** Places in files the user marked, with what to change at each. */
      asks: SessionMessageDataPart.AsksDataPartSchema.optional(),
      files: z.array(FileUpload.Schema).optional(),
      folders: z.array(z.object({ path: z.string() })).optional(),
      id: ChatIdSchema,
      modelURI: AIGatewayModelURI.Schema,
      prompt: z.string(),
      /** The earlier message this one answers. */
      replyTo: SessionMessageDataPart.ReplyDataPartSchema.optional(),
      sessionId: StoreId.SessionSchema.optional(),
      /** Topic ids for the chat this message opens, when it opens one. */
      topics: z.array(z.string()).optional(),
      viewing: SessionMessageDataPart.ViewContextDataPartSchema.optional(),
    }),
  )
  .output(z.object({ sessionId: StoreId.SessionSchema }))
  .handler(
    async ({
      context,
      errors,
      input: {
        asks,
        files,
        folders,
        id,
        modelURI,
        prompt,
        replyTo,
        sessionId,
        topics,
        viewing,
      },
    }) =>
      sendsInOrder(id, async () => {
        const chatId = id;

        const modelResult = await fetchModel({
          captureException: context.workspaceConfig.captureException,
          configs: context.workspaceConfig.getAIProviderConfigs(),
          modelCache: context.workspaceConfig.modelCache,
          modelURI,
        });

        if (!modelResult.ok) {
          throw toORPCError(modelResult.error, errors);
        }

        const model = modelResult.value;

        // The chat's own session is written with the chat; a chat from
        // before that gets it here, whichever of its sessions is named.
        const chatSession = await ensureChatSession(chatId);
        if (chatSession.isErr()) {
          throw toORPCError(chatSession.error, errors);
        }
        // Without a session named, the message goes to the chat's own.
        const finalSessionId = sessionId ?? chatSession.value.id;
        if (!sessionId && topics && topics.length > 0) {
          await setChatTopics(chatId, topics);
        }

        const messageIdsBeforeResult = await ChatReads.messageIds({
          chatId,
          sessionId: finalSessionId,
        });
        if (messageIdsBeforeResult.isErr()) {
          throw toORPCError(messageIdsBeforeResult.error, errors);
        }
        const isFirstMessageInSession =
          messageIdsBeforeResult.value.length === 0;

        const messageResult = await newMessage({
          asks,
          files,
          folders,
          modelURI,
          prompt,
          replyTo,
          sessionId: finalSessionId,
          chatId,
          viewing,
        });

        if (messageResult.isErr()) {
          throw toORPCError(messageResult.error, errors);
        }

        const message = messageResult.value;

        if (isFirstMessageInSession) {
          // Titling is deliberately non-blocking, so the agent's turn never
          // waits behind it on the first message of a session.
          void (async () => {
            const title = await generateTitleFromUserMessage({
              message,
              model,
              chatId,
              workspaceConfig: context.workspaceConfig,
            });
            if (title.isOk()) {
              await updateSessionTitle({
                sessionId: message.metadata.sessionId,
                chatId,
                title: title.value,
              });
            }
          })().catch((error: unknown) => {
            context.workspaceConfig.captureException(error);
          });
        }

        // Written now, so the conversation shows it the moment it was sent; the
        // session runs it when its turn comes and never writes it again.
        const written = await Store.saveMessageWithParts(message, chatId);
        if (written.isErr()) {
          throw toORPCError(written.error, errors);
        }
        // Writing in the chat is the person's answer to whatever it asked,
        // so a question still open there is closed rather than left to be
        // answered against a turn that has moved on.
        if (finalSessionId === chatSession.value.id) {
          await closeQuestions(chatId);
        }
        context.workspaceRef.send({
          type: "addMessage",
          value: {
            id,
            message,
            model,
            saved: true,
            sessionId: message.metadata.sessionId,
          },
        });

        // A settings write, which the record change feed reports: what moves
        // the chat in the list.
        await recordChatActivity(chatId);

        return { sessionId: message.metadata.sessionId };
      }),
  );

const live = {
  list: base
    .input(
      z.object({
        id: ChatIdSchema,
        sessionId: StoreId.SessionSchema,
      }),
    )
    // Messages are Zod-validated when read from the store; re-validating the
    // whole array on every yield would make each update O(session) again.
    .output(eventIterator(type<SessionMessage.WithParts[]>()))
    .handler(async function* ({ errors, input, signal }) {
      // Subscribing before the initial read means no event can land
      // unobserved between the two; an event for a message the read already
      // covered only costs a redundant re-read of that message.
      const batches = changedMessageBatches(input, signal);

      try {
        const initial = await ChatReads.transcript({
          bytes: true,
          chatId: input.id,
          sessionId: input.sessionId,
          signal,
        });
        if (initial.isErr()) {
          throw toORPCError(initial.error, errors);
        }
        const snapshot = new LiveMessagesSnapshot(initial.value);
        yield snapshot.toArray();

        // Each batch re-reads only the changed messages and splices them into
        // the snapshot, so store work per update is proportional to the
        // change, not the session. Bursts coalesce: a turn's token storm
        // targets one message, so its part.updated events collapse into a
        // single re-read + yield. Every yield is the complete sorted array.
        for await (const batch of batches) {
          for (const messageId of batch.removed) {
            snapshot.remove(messageId);
          }

          if (batch.updated.size > 0) {
            const messageIds = [...batch.updated];

            // A message and its parts are written and removed together, so
            // a read that fails falls back to a full reload, which surfaces a
            // persistent error the same way the initial read does.
            const messages = await ChatReads.transcript({
              bytes: true,
              chatId: input.id,
              only: batch.updated,
              sessionId: input.sessionId,
              signal,
            });

            if (messages.isOk()) {
              for (const message of messages.value) {
                snapshot.upsert(message);
              }
              // The read omits ids the index named but the fetch couldn't
              // find, just removed. Drop them; a later event re-adds a
              // message that reappears.
              const found = new Set(messages.value.map(({ id }) => id));
              for (const messageId of messageIds) {
                if (!found.has(messageId)) {
                  snapshot.remove(messageId);
                }
              }
            } else {
              const reload = await ChatReads.transcript({
                bytes: true,
                chatId: input.id,
                sessionId: input.sessionId,
                signal,
              });
              if (reload.isErr()) {
                throw toORPCError(reload.error, errors);
              }
              snapshot.reset(reload.value);
            }
          }

          yield snapshot.toArray();
        }
      } finally {
        // for await only closes the iterator once the loop has been entered;
        // this also unsubscribes when the initial read throws.
        await batches.return();
      }
    }),
};

export const message = {
  create,
  list: listWithParts,
  live,
};
