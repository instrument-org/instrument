import { AIGatewayModelURI, fetchModel } from "@instrument-org/ai-gateway";
import { eventIterator, type } from "@orpc/server";
import { z } from "zod";

import {
  BubbleProjection,
  type BubbleFeedEvent,
} from "../../lib/bubble-messages";
import { changedMessageBatches } from "../../lib/changed-message-batches";
import { getChatAgentStatus } from "../../lib/get-chat-agent-status";
import {
  attachmentsWaitingToMove,
  rewriteChatFolder,
} from "../../lib/chat-folders/write-chat-folder";
import { ChatReads } from "../../lib/chat-reads";
import { ChatWrites } from "../../lib/chat-writes";
import { ensureChatSession } from "../../lib/create-session";
import { createWriteQueue } from "../../lib/create-write-queue";
import { nameChat } from "../../lib/chat/chat-name";
import { LiveMessagesSnapshot } from "../../lib/live-messages-snapshot";
import {
  removeSentFromDraft,
  withDraftFolder,
} from "../../lib/drafts/send-from-folder";
import { newMessage } from "../../lib/new-message";
import { attendChatArrivals } from "../../lib/records/take-arrivals";
import { setChatTopic } from "../../lib/chat/chats";

import { updateSessionTitle } from "../../lib/update-session-title";
import { FileUpload } from "../../schemas/file-upload";
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
      /**
       * The draft this message was sent from, by its id, recorded on the
       * message: what tells the next launch the draft was sent, so a send
       * interrupted partway through is finished rather than sent again.
       */
      fromDraft: z.string().optional(),
      id: ChatIdSchema,
      modelURI: AIGatewayModelURI.Schema,
      prompt: z.string(),
      /** The earlier message this one answers. */
      replyTo: SessionMessageDataPart.ReplyDataPartSchema.optional(),
      sessionId: StoreId.SessionSchema.optional(),
      /** The topic id for the chat this message opens, when it opens one. */
      topic: z.string().optional(),
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
        fromDraft,
        id,
        modelURI,
        prompt,
        replyTo,
        sessionId,
        topic,
        viewing,
      },
    }) =>
      sendsInOrder(id, async () => {
        const chatId = id;

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

        const model = modelResult.value;

        // The chat's own session is written with the chat; a chat from
        // before that gets it here, whichever of its sessions is named.
        const chatSession = await ensureChatSession(
          chatId,
          sessionId ? undefined : prompt,
        );
        if (chatSession.isErr()) {
          throw toORPCError(chatSession.error, errors);
        }
        // Without a session named, the message goes to the chat's own.
        const finalSessionId = sessionId ?? chatSession.value.id;
        if (!sessionId && topic) {
          await setChatTopic(chatId, topic);
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

        // A draft's folder is read now, so what landed in it a beat before
        // the press goes too, whatever the window had seen of it.
        const sending = await withDraftFolder({
          files,
          folders,
          fromDraft,
          rootDir: context.workspaceConfig.rootDir,
        });
        const messageResult = await newMessage({
          asks,
          files: sending.files,
          folders: sending.folders,
          ...(fromDraft ? { fromDraft } : {}),
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
            const title = await nameChat({
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
        const written = await ChatWrites.saveMessageWithParts(message, chatId);
        if (written.isErr()) {
          throw toORPCError(written.error, errors);
        }
        context.workspaceConfig.lookUpSentLinkTitles?.(prompt);
        // The chat's `CHAT.md` takes the message the person just sent,
        // without the send waiting on it, unless what they sent is still to
        // move into the chat's folder: the turn names each file where it is,
        // so it starts once they are there.
        const moving = await attachmentsWaitingToMove(chatId);
        const rewritten = rewriteChatFolder(chatId).catch((error: unknown) => {
          context.workspaceConfig.captureException(error);
        });
        if (moving) {
          await rewritten;
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
        // The chat has its own copies now, so sending moved them. Last, and
        // never failing the send, which is done: what cannot be taken out
        // stays, for the draft's removal to move to the Trash.
        try {
          const stuck = removeSentFromDraft(sending.sent);
          if (stuck.length > 0) {
            context.workspaceConfig.captureException(
              new Error(
                `Left ${stuck.length.toString()} sent file(s) in the draft's folder`,
              ),
            );
          }
        } catch (error) {
          context.workspaceConfig.captureException(error);
        }

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
      // Another device's records of the chat are noticed while it is shown.
      const unattend = attendChatArrivals(input.id);

      try {
        const initial = await ChatReads.transcript({
          bytes: true,
          chatId: input.id,
          sessionId: input.sessionId,
        });
        if (initial.isErr()) {
          throw toORPCError(initial.error, errors);
        }
        const snapshot = new LiveMessagesSnapshot(initial.value);
        yield snapshot.toArray();

        // Each batch re-reads only the changed messages and splices them into
        // the snapshot, so store work per update is proportional to the
        // change, not the session. Bursts coalesce: a turn's token storm
        // targets one message, so its record changes collapse into a
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
        unattend();
        await batches.return();
      }
    }),
};

/**
 * What a chat's bubbles draw of a session (`bubble-messages.ts`), as it
 * changes: the whole of it, then only the messages whose bubbles moved. A
 * token streaming into a reply moves none, so nothing is sent for it.
 */
const liveBubbles = base
  .input(
    z.object({
      id: ChatIdSchema,
      sessionId: StoreId.SessionSchema,
    }),
  )
  .output(eventIterator(type<BubbleFeedEvent>()))
  .handler(async function* ({ context, errors, input, signal }) {
    // Subscribed before the first read, as `live.list` is, and woken by the
    // agent too: a reply is held back only while its run is going.
    const batches = changedMessageBatches({ ...input, agent: true }, signal);
    const unattend = attendChatArrivals(input.id);
    const isRunning = () =>
      getChatAgentStatus({
        id: input.id,
        workspaceRef: context.workspaceRef,
      })
        .value.sessionActors.find(
          (actor) => actor.sessionId === input.sessionId,
        )
        ?.tags.includes("agent.running") ?? false;

    try {
      const read = (only?: Set<StoreId.Message>) =>
        ChatReads.transcript({
          bytes: true,
          chatId: input.id,
          sessionId: input.sessionId,
          ...(only ? { only } : {}),
        });
      const initial = await read();
      if (initial.isErr()) {
        throw toORPCError(initial.error, errors);
      }
      const snapshot = new LiveMessagesSnapshot(initial.value);
      const projection = new BubbleProjection();
      const first = projection.update({
        isRunning: isRunning(),
        messages: snapshot.toArray(),
      });
      if (first.event) {
        yield first.event;
      }

      for await (const batch of batches) {
        for (const messageId of batch.removed) {
          snapshot.remove(messageId);
        }
        if (batch.updated.size > 0) {
          const messages = await read(batch.updated);
          if (messages.isOk()) {
            for (const message of messages.value) {
              snapshot.upsert(message);
            }
            const found = new Set(messages.value.map(({ id }) => id));
            for (const messageId of batch.updated) {
              if (!found.has(messageId)) {
                snapshot.remove(messageId);
              }
            }
          } else {
            const reload = await read();
            if (reload.isErr()) {
              throw toORPCError(reload.error, errors);
            }
            snapshot.reset(reload.value);
          }
        }
        const { event } = projection.update({
          isRunning: isRunning(),
          messages: snapshot.toArray(),
          touched: batch.updated,
        });
        if (event) {
          yield event;
        }
      }
    } finally {
      unattend();
      await batches.return();
    }
  });

export const message = {
  create,
  list: listWithParts,
  live: { ...live, bubbles: liveBubbles },
};
