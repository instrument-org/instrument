import { AIGatewayModelURI, fetchModel } from "@instrument-org/ai-gateway";
import { eventIterator, type } from "@orpc/server";
import { isEqual } from "radashi";
import { z } from "zod";

import { changedMessageBatches } from "../../lib/changed-message-batches";
import {
  attachmentsWaitingToMove,
  rewriteChatFolder,
} from "../../lib/chat-folders/write-chat-folder";
import { ChatReads } from "../../lib/chat-reads";
import { ChatWrites } from "../../lib/chat-writes";
import { ensureChatSession } from "../../lib/create-session";
import { createWriteQueue } from "../../lib/create-write-queue";
import { nameChat } from "../../lib/chat/chat-name";
import { sessionDeveloperNotes } from "../../lib/chat/session-developer-notes";
import {
  type DeveloperNote,
  type DeveloperNoteBody,
} from "../../lib/transcript/developer-notes";
import {
  findInTranscript,
  type TurnMatches,
} from "../../lib/transcript/find-in-transcript";
import {
  transcriptMessage,
  type WrittenOn,
} from "../../lib/transcript/transcript-message";
import {
  lastTurnsOf,
  type TranscriptFeed,
  type TranscriptFeedEvent,
  type WrittenOnByMessage,
  TranscriptProjection,
} from "../../lib/transcript/feed";
import {
  removeSentFromDraft,
  withDraftFolder,
} from "../../lib/drafts/send-from-folder";
import { newMessage } from "../../lib/new-message";
import { attendChatArrivals } from "../../lib/records/take-arrivals";
import { setChatProject } from "../../lib/chat/chats";
import { computerName, thisDevice } from "../../lib/chat/asks";

import { updateSessionTitle } from "../../lib/update-session-title";
import { FileUpload } from "../../schemas/file-upload";
import { SessionMessage } from "../../schemas/session/message";
import { SessionMessageDataPart } from "../../schemas/session/message-data-part";
import { StoreId } from "../../schemas/store-id";
import { type ChatId, ChatIdSchema } from "../../schemas/chat-id";
import { base, toORPCError } from "../base";

/** How often a session's notes are worked out again while it moves. */
const NOTES_AT_MOST_EVERY_MS = 400;

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
      sessionId: StoreId.SessionSchema.optional(),
      /** The project id for the chat this message opens, when it opens one. */
      project: z.string().optional(),
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
        sessionId,
        project,
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
        if (!sessionId && project) {
          await setChatProject(chatId, project);
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

/**
 * The computer each message the person sent among `messages` was sent on, as
 * the chat's records say, for the line where a chat moved computers. None
 * when the writers cannot be read, since the line only adds to the chat.
 */
async function writtenOnFor(
  chatId: ChatId,
  messages: readonly SessionMessage.WithParts[],
): Promise<WrittenOnByMessage> {
  const found = new Map<StoreId.Message, WrittenOn>();
  // A streaming reply's changes hold no message the person sent.
  if (!messages.some((message) => message.role === "user")) {
    return found;
  }
  const writers = await ChatReads.writers({ chatId });
  if (writers.isErr()) {
    return found;
  }
  const here = thisDevice();
  for (const message of messages) {
    const device =
      message.role === "user" ? writers.value.get(message.id) : undefined;
    if (device !== undefined) {
      found.set(message.id, {
        device,
        here: device === here,
        name: await computerName(device),
      });
    }
  }
  return found;
}

/**
 * What the transcript draws of a session (`transcript/feed.ts`), as it changes:
 * the end of the session, then only what moved. A reader that scrolls up asks
 * `older` for the turns before.
 */
const liveFeed = base
  .input(
    z.object({
      id: ChatIdSchema,
      sessionId: StoreId.SessionSchema,
    }),
  )
  .output(eventIterator(type<TranscriptFeedEvent>()))
  .handler(async function* ({ errors, input, signal }) {
    // Subscribed before the first read, so no change lands unobserved.
    const batches = changedMessageBatches(input, signal);
    const unattend = attendChatArrivals(input.id);
    try {
      const read = (only?: Set<StoreId.Message>) =>
        ChatReads.transcript({
          chatId: input.id,
          sessionId: input.sessionId,
          ...(only ? { only } : {}),
        });
      const projection = new TranscriptProjection();
      const initial = await read();
      if (initial.isErr()) {
        throw toORPCError(initial.error, errors);
      }
      yield projection.reset(
        initial.value,
        await writtenOnFor(input.id, initial.value),
      );

      for await (const batch of batches) {
        const changed = await read(batch.updated);
        if (changed.isErr()) {
          // A message and its parts are written together, so a read that fails
          // falls back to the whole session.
          const reload = await read();
          if (reload.isErr()) {
            throw toORPCError(reload.error, errors);
          }
          yield projection.reset(
            reload.value,
            await writtenOnFor(input.id, reload.value),
          );
          continue;
        }
        const messages = changed.value;
        const found = new Set(messages.map(({ id }) => id));
        const event = projection.update({
          changed: messages,
          removed: [
            ...batch.removed,
            ...[...batch.updated].filter((id) => !found.has(id)),
          ],
          writtenOn: await writtenOnFor(input.id, messages),
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

/** The turns before `before`, for a reader scrolling up. */
const older = base
  .input(
    z.object({
      before: StoreId.MessageSchema,
      id: ChatIdSchema,
      sessionId: StoreId.SessionSchema,
    }),
  )
  .output(type<TranscriptFeed>())
  .handler(async ({ errors, input }) => {
    const messages = await ChatReads.transcript({
      chatId: input.id,
      sessionId: input.sessionId,
    });
    if (messages.isErr()) {
      throw toORPCError(messages.error, errors);
    }
    return lastTurnsOf(messages.value, {
      ...input,
      writtenOn: await writtenOnFor(input.id, messages.value),
    });
  });

/**
 * Which turns of the session have `query` in the words they show, and how
 * many times, oldest first: what a chat's find counts of the turns it has
 * not loaded to draw yet.
 */
const find = base
  .input(
    z.object({
      id: ChatIdSchema,
      query: z.string().min(1),
      sessionId: StoreId.SessionSchema,
    }),
  )
  .output(type<TurnMatches[]>())
  .handler(async ({ errors, input }) => {
    const messages = await ChatReads.transcript({
      chatId: input.id,
      sessionId: input.sessionId,
    });
    if (messages.isErr()) {
      throw toORPCError(messages.error, errors);
    }
    return findInTranscript({
      messages: messages.value.flatMap((message) => {
        const light = transcriptMessage(message);
        return light ? [light] : [];
      }),
      query: input.query,
      sessionId: input.sessionId,
    });
  });

/**
 * One message whole, as it changes: what a step opened in the transcript reads
 * for the command and output the feed leaves out.
 */
const liveWhole = base
  .input(
    z.object({
      id: ChatIdSchema,
      messageId: StoreId.MessageSchema,
      sessionId: StoreId.SessionSchema,
    }),
  )
  .output(eventIterator(type<SessionMessage.WithParts | null>()))
  .handler(async function* ({ errors, input, signal }) {
    const batches = changedMessageBatches(input, signal);
    const only = new Set([input.messageId]);
    const read = async () => {
      const messages = await ChatReads.transcript({
        bytes: true,
        chatId: input.id,
        only,
        sessionId: input.sessionId,
      });
      if (messages.isErr()) {
        throw toORPCError(messages.error, errors);
      }
      return messages.value[0] ?? null;
    };
    try {
      yield await read();
      for await (const batch of batches) {
        if (
          batch.updated.has(input.messageId) ||
          batch.removed.has(input.messageId)
        ) {
          yield await read();
        }
      }
    } finally {
      await batches.return();
    }
  });

/**
 * What a developer reads beside a session's transcript, as it changes. Worked
 * out from the whole session, so what a page of turns doesn't hold still counts,
 * and sent again only when it says something new.
 */
const liveDeveloperNotes = base
  .input(z.object({ id: ChatIdSchema, sessionId: StoreId.SessionSchema }))
  .output(eventIterator(type<DeveloperNote[]>()))
  .handler(async function* ({ errors, input, signal }) {
    const batches = changedMessageBatches(input, signal);
    const read = async () => {
      const notes = await sessionDeveloperNotes({
        chatId: input.id,
        sessionId: input.sessionId,
      });
      if (notes.isErr()) {
        throw toORPCError(notes.error, errors);
      }
      return notes.value.notes;
    };
    try {
      let last = await read();
      yield last;
      for await (const _batch of batches) {
        // Changes that land meanwhile join the next batch, so a reply
        // streaming costs a read at this rate rather than one per token.
        await new Promise((resolve) => {
          setTimeout(resolve, NOTES_AT_MOST_EVERY_MS);
        });
        const next = await read();
        if (!isEqual(next, last)) {
          last = next;
          yield next;
        }
      }
    } finally {
      await batches.return();
    }
  });

/** What one note's card shows, read when the card opens. */
const developerNoteBody = base
  .input(
    z.object({
      id: ChatIdSchema,
      note: z.string(),
      sessionId: StoreId.SessionSchema,
    }),
  )
  .output(type<DeveloperNoteBody | null>())
  .handler(async ({ errors, input }) => {
    const notes = await sessionDeveloperNotes({
      chatId: input.id,
      sessionId: input.sessionId,
    });
    if (notes.isErr()) {
      throw toORPCError(notes.error, errors);
    }
    return notes.value.bodies.get(input.note) ?? null;
  });

export const message = {
  create,
  developerNoteBody,
  find,
  list: listWithParts,
  live: {
    developerNotes: liveDeveloperNotes,
    feed: liveFeed,
    whole: liveWhole,
  },
  older,
};
