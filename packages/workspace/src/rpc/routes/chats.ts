import { eventIterator, ORPCError } from "@orpc/server";
import { z } from "zod";

import { ChatWrites } from "../../lib/chat-writes";
import { isWorking, latestStep } from "../../lib/chat/activity";
import { ensureChat } from "../../lib/chat/chat-records";
import {
  archiveChat,
  chatById,
  chatIsWorking,
  ChatSchema,
  markChatRead,
  markChatUnread,
  renameChat,
  setChatStarred,
  setChatTopic,
  settleChatTitle,
  unarchiveChat,
} from "../../lib/chat/chats";
import {
  followTitle,
  titlesToFollow,
} from "../../lib/chat-folders/follow-title";
import { cappedTitle } from "../../lib/chat-folders/folder-name";
import { ChatTaskSchema, listChildTasks } from "../../lib/chat/children";
import { chatRowAsked, liveChatList } from "../../lib/chat/live-chat-list";
import { retitleChat } from "../../lib/chat/retitle";
import { TaskStandingKindSchema, taskStanding } from "../../lib/chat/standing";
import { answerQuestion, openAsks, openAsksOf } from "../../lib/chat/open-asks";
import { wakeAskers } from "../../lib/chat/wake";
import { openSignInsOf } from "../../lib/apps/sign-in-group";
import { AskSchema } from "../../schemas/chat-state";
import { SessionMessageDataPart } from "../../schemas/session/message-data-part";
import { type RecordChanged, recordChanges } from "../../lib/record-changes";
import {
  chatOfSession,
  resolveChat,
  sessionOfChat,
} from "../../lib/record-folders";
import { trashChat } from "../../lib/trash-chat";
import { StoreId } from "../../schemas/store-id";
import { ChatIdSchema, type ChatId } from "../../schemas/chat-id";
import { chatRoutes } from "./chat";
import { base, toORPCError } from "../base";
import { distinct, liveRead } from "../live-read";

/** A task the chat started, as its tasks screen lists it. */
const ChildTaskSchema = ChatTaskSchema.extend({
  /** Where it stands and the line the list says about it. */
  standing: z.object({
    kind: TaskStandingKindSchema,
    line: z.string(),
  }),
  /** The label of its newest step of its own, when it gave one. */
  step: z.string().optional(),
  /**
   * Whether a stop has something to end: an agent at work, or a wait on a
   * card it ran into, which the stop takes it off.
   */
  stoppable: z.boolean(),
  /** Whether an agent of its is at work. */
  working: z.boolean(),
});

export type ChildTask = z.output<typeof ChildTaskSchema>;

/** The tasks a chat created, newest activity first. */
async function childTasks(id: ChatId) {
  const tasks = await listChildTasks(id);
  return await Promise.all(
    tasks.map(async (task) => {
      const ref = { sessionId: task.id, chatId: id };
      const running = isWorking(id, task.id);
      const step = await latestStep(ref);
      return {
        ...task,
        standing: await taskStanding({ ...ref, isRunning: running }),
        ...(step ? { step } : {}),
        stoppable: running || (await openAsksOf(id, task.id)).length > 0,
        working: running,
      };
    }),
  );
}

/**
 * Whether a change is to the chat whose tasks a list shows: what one of its
 * rows shows (its title, its standing, its step) is in the chat's store and
 * the cards in its state, and whether it works is its session's agent.
 */
function inChat(chatId: ChatId) {
  return (change: RecordChanged) =>
    change.id === chatId && change.kind !== "settings";
}

/**
 * A chat's tasks once, as the live list's first answer. The id must be a
 * chat's: nothing lists every chat's tasks.
 */
const childTasksRoute = base
  .input(z.object({ id: ChatIdSchema }))
  .output(ChildTaskSchema.array())
  .handler(async ({ errors, input }) => {
    const chatId = resolveChat(input.id);
    if (!chatId) {
      throw errors.NOT_FOUND({ message: "That chat is not there any more." });
    }
    return await childTasks(chatId);
  });

/** A chat's tasks, re-read whenever one of them may have changed. */
const liveChildTasksRoute = base
  .input(z.object({ id: ChatIdSchema }))
  .output(eventIterator(ChildTaskSchema.array()))
  .handler(async function* ({ errors, input, signal }) {
    const chatId = resolveChat(input.id);
    if (!chatId) {
      throw errors.NOT_FOUND({ message: "That chat is not there any more." });
    }
    yield* distinct(
      liveRead({
        changes: [recordChanges(signal, inChat(chatId))],
        read: () => childTasks(chatId),
      }),
    );
  });

/**
 * Acts on the chat an id names; an id that is no chat's does nothing. Every
 * live chat list answers once it has finished, changed or not, which takes
 * back what a window painted ahead of the request.
 */
async function whenChat(
  id: ChatId,
  act: (chatId: ChatId) => Promise<unknown>,
): Promise<void> {
  const chatId = resolveChat(id);
  try {
    if (chatId) {
      await act(chatId);
    }
  } finally {
    chatRowAsked(chatId ?? id);
  }
}

/** One chat as the list shows it, or none for an id that is not a chat's. */
const chatByIdRoute = base
  .input(z.object({ id: ChatIdSchema }))
  .output(ChatSchema.optional())
  .handler(({ input }) => chatById(input.id));

/** The chats, oldest first, kept current: see `liveChatList`. */
const liveListChatsRoute = base
  .output(eventIterator(ChatSchema.array()))
  .handler(async function* ({ signal }) {
    yield* liveChatList(signal);
  });

/** Takes a chat's unread mark off: the user has looked at it, or said so. */
const readChatRoute = base
  .input(z.object({ id: ChatIdSchema }))
  .handler(async ({ input }) => {
    await whenChat(input.id, markChatRead);
  });

/** Marks a chat unread by the user's hand, which holds until they come back to it. */
const unreadChatRoute = base
  .input(z.object({ id: ChatIdSchema }))
  .handler(async ({ input }) => {
    await whenChat(input.id, (chatId) =>
      markChatUnread(chatId, { byUser: true }),
    );
  });

/** Puts a chat away: out of the inbox, still in the list, marked. */
const archiveChatRoute = base
  .input(z.object({ id: ChatIdSchema }))
  .handler(async ({ input }) => {
    await whenChat(input.id, archiveChat);
  });

/** Stars a chat, or takes the star off. */
const starChatRoute = base
  .input(z.object({ id: ChatIdSchema, starred: z.boolean() }))
  .handler(async ({ input }) => {
    await whenChat(input.id, (chatId) => setChatStarred(chatId, input.starred));
  });

/** Brings a chat back into the inbox. */
const unarchiveChatRoute = base
  .input(z.object({ id: ChatIdSchema }))
  .handler(async ({ input }) => {
    await whenChat(input.id, unarchiveChat);
  });

/**
 * Names a chat again from where it stands now, on the user's ask, as
 * often as they ask; answers with the title it has afterward, or nothing when
 * there was nothing to name it from. A name the user asked for settles the
 * title the same as one they typed.
 */
const retitleChatRoute = base
  .input(z.object({ id: ChatIdSchema }))
  .output(z.object({ title: z.string().optional() }))
  .handler(async ({ input }) => {
    const sessionId = sessionOfChat(input.id);
    if (!sessionId) {
      return {};
    }
    const title = await retitleChat({ id: input.id, sessionId });
    if (title === undefined) {
      return {};
    }
    await settleChatTitle(input.id);
    await followTitleBetweenTurns(input.id, title);
    return { title };
  });

/**
 * Moves a chat's folder to a title it was just given, unless something of
 * the chat's is running in it: a rename under a working agent takes its
 * working directory out from under it, and Windows refuses it outright. The
 * folder then catches up when the chat's turn settles (`retitle.ts`).
 */
async function followTitleBetweenTurns(chatId: ChatId, title: string) {
  if (await chatIsWorking(chatId)) {
    titlesToFollow.add(chatId);
    return;
  }
  titlesToFollow.delete(chatId);
  await followTitle(chatId, title);
}

/** Names a chat as the user typed it, and its folder with it. */
const renameChatRoute = base
  .input(z.object({ id: ChatIdSchema, title: z.string().trim().min(1) }))
  .handler(async ({ input }) => {
    await whenChat(input.id, async (chatId) => {
      const renamed = await renameChat(chatId, input.title);
      if (renamed) {
        await followTitleBetweenTurns(chatId, cappedTitle(input.title));
      }
      return renamed;
    });
  });

/** Files a chat under a topic, or under none with `null`. */
const setChatTopicRoute = base
  .input(z.object({ id: ChatIdSchema, topic: z.string().nullable() }))
  .handler(async ({ input }) => {
    await whenChat(input.id, (chatId) => setChatTopic(chatId, input.topic));
  });

/**
 * A chat's record, made before the window shows it, so the window never asks
 * for a chat that is not there yet, and named for the words it opens with.
 * The window picks the session its conversation will have, which is what
 * makes asking again safe: the same session answers with the same chat.
 */
const ensureChatRoute = base
  .input(
    z.object({
      firstWords: z.string().optional(),
      sessionId: StoreId.SessionSchema,
    }),
  )
  .output(z.object({ id: ChatIdSchema }))
  .handler(async ({ input }) => ({
    id: await ensureChat(input.sessionId, input.firstWords),
  }));

/**
 * A chat's session, which its transcript is read and its messages are sent
 * through, or none for an id that is no chat's.
 */
const chatSessionRoute = base
  .input(z.object({ id: ChatIdSchema }))
  .output(z.object({ sessionId: StoreId.SessionSchema.nullable() }))
  .handler(({ input }) => {
    const chatId = resolveChat(input.id);
    return { sessionId: (chatId && sessionOfChat(chatId)) ?? null };
  });

/**
 * The chat a session is, or none: for an address that names a chat by its
 * session, as a link in an older reply does.
 */
const chatOfSessionRoute = base
  .input(z.object({ sessionId: StoreId.SessionSchema }))
  .output(z.object({ id: ChatIdSchema.nullable() }))
  .handler(({ input }) => ({ id: chatOfSession(input.sessionId) ?? null }));

/**
 * Deletes a chat with every task it started: their work stops, and the
 * records and work folder, which hold theirs, go to the trash.
 *
 * The chat's own folder under `Chats/` goes only when asked. What is in it
 * is the person's: a transcript they can read and whatever the agent
 * finished for them, and deleting a chat to tidy a list is not a request to
 * throw that away.
 */
const trashChatRoute = base
  .input(
    z.object({
      id: ChatIdSchema,
      /** Whether the chat's own folder goes with it; off unless asked. */
      itsFolder: z.boolean().optional(),
    }),
  )
  .handler(async ({ context, errors, input }) => {
    const id = resolveChat(input.id);
    if (!id) {
      throw errors.NOT_FOUND({ message: "That chat is not there any more." });
    }
    const result = await trashChat({
      id,
      itsFolder: input.itsFolder,
      workspaceConfig: context.workspaceConfig,
      workspaceRef: context.workspaceRef,
    });
    if (result.isErr()) {
      throw toORPCError(result.error, errors);
    }
  });

/**
 * The chat's open asks, as its cards draw them, oldest first, read again
 * whenever the chat's state moves: what its agent's work ran into, and the
 * questions it asked.
 */
const liveAsksRoute = base
  .input(z.object({ id: ChatIdSchema }))
  .output(eventIterator(AskSchema.array()))
  .handler(async function* ({ input, signal }) {
    yield* distinct(
      liveRead({
        changes: [
          recordChanges(
            signal,
            // A card and its answers are session records; a question is in
            // the transcript.
            (change) =>
              change.id === input.id &&
              (change.kind === "messages" || change.kind === "session"),
          ),
        ],
        read: () => openAsks(input.id),
      }),
    );
  });

/**
 * The person's answers to a card the chat put up with `choose`: for each
 * question a choice, their own words, or a skip. Closes the card and wakes
 * the chat once with every answer, or joins its turn at the next step if it
 * is still going.
 */
const answerQuestionRoute = base
  .input(
    z.object({
      answer: SessionMessageDataPart.QuestionCardAnswerSchema,
      askId: z.string(),
      id: ChatIdSchema,
    }),
  )
  .output(z.void())
  .handler(async ({ context, input }) => {
    // The answer written onto the call is what closes the question, and what
    // the card draws.
    const question = await answerQuestion(
      input.id,
      input.askId,
      async ({ askers, messageId, questions }) => {
        if (input.answer.replies.length !== questions.length) {
          throw new ORPCError("BAD_REQUEST", {
            message: `The card asks ${questions.length} questions, and the answer has ${input.answer.replies.length} replies.`,
          });
        }
        for (const { partId, sessionId } of askers) {
          if (!partId) {
            continue;
          }
          const written = await ChatWrites.updatePart(
            { chatId: input.id, messageId, partId, sessionId },
            (part) =>
              part.type === "tool-choose" &&
              part.state === "output-available" &&
              "asked" in part.output
                ? { ...part, output: { ...part.output, answer: input.answer } }
                : part,
          );
          if (written.isErr()) {
            throw written.error;
          }
        }
      },
    );
    if (!question) {
      throw new ORPCError("NOT_FOUND", {
        message: "That question was already answered.",
      });
    }
    await Promise.all(
      question.askers.map(async ({ partId, sessionId }) => {
        if (!partId) {
          return;
        }
        const signIns = await openSignInsOf(input.id, sessionId);
        await wakeAskers(
          {
            data: {
              answer: input.answer,
              partId,
              questions: question.questions,
              ...(signIns === undefined ? {} : { signIns }),
            },
            type: "data-questionAnswer",
          },
          context.workspaceRef,
          input.id,
          [sessionId],
        );
      }),
    );
  });

/**
 * What the person did with the agent's offer to send the team a problem:
 * sent it or put it away. Written onto the call for the card to draw, and
 * never wakes the chat, so the agent never hears how it went.
 */
const settleFeedbackOfferRoute = base
  .input(
    z.object({
      id: ChatIdSchema,
      messageId: StoreId.MessageSchema,
      outcome: z.enum(["sent", "dismissed"]),
      partId: StoreId.PartSchema,
      sessionId: StoreId.SessionSchema,
    }),
  )
  .output(z.void())
  .handler(async ({ errors, input }) => {
    const written = await ChatWrites.updatePart(
      {
        chatId: input.id,
        messageId: input.messageId,
        partId: input.partId,
        sessionId: input.sessionId,
      },
      (part) =>
        part.type === "tool-offer_feedback" &&
        part.state === "output-available" &&
        part.output.offered &&
        part.output.outcome === undefined
          ? { ...part, output: { ...part.output, outcome: input.outcome } }
          : part,
    );
    if (written.isErr()) {
      throw toORPCError(written.error, errors);
    }
  });

export const chats = {
  ...chatRoutes,
  answerQuestion: answerQuestionRoute,
  settleFeedbackOffer: settleFeedbackOfferRoute,
  archive: archiveChatRoute,
  byId: chatByIdRoute,
  ensure: ensureChatRoute,
  live: {
    ...chatRoutes.live,
    asks: liveAsksRoute,
    list: liveListChatsRoute,
    tasks: liveChildTasksRoute,
  },
  ofSession: chatOfSessionRoute,
  read: readChatRoute,
  rename: renameChatRoute,
  retitle: retitleChatRoute,
  session: chatSessionRoute,
  setTopic: setChatTopicRoute,
  star: starChatRoute,
  tasks: childTasksRoute,
  trash: trashChatRoute,
  unarchive: unarchiveChatRoute,
  unread: unreadChatRoute,
};
