import { call, eventIterator } from "@orpc/server";
import { z } from "zod";

import { ChatWrites } from "../../lib/chat-writes";
import { isWorking, ownMessages } from "../../lib/chat/activity";
import { latestStepIn } from "../../lib/chat/step-label";
import { taskSlices } from "../../lib/chat/task-slices";
import { branchChat } from "../../lib/chat/branch-chat";
import { ensureChat } from "../../lib/chat/chat-records";
import { ChangesCardSchema, markCardUndone } from "../../lib/chat/card-undone";
import {
  chatById,
  markChatRead,
  markChatUnread,
  setChatStarred,
  setChatProject,
  settleChatTitle,
  unarchiveChat,
} from "../../lib/chat/chats";
import {
  archiveChatAndTabs,
  followTitleBetweenTurns,
  renameChatAndFolder,
  undoChatChanges,
} from "../../lib/chat/organize";
import { ChatTaskSchema, listChildTasks } from "../../lib/chat/children";
import { chatRow, ChatRowSchema } from "../../lib/chat/chat-row";
import { liveChatRows, refreshChatRow } from "../../lib/chat/live-chat-list";
import { retitleChat } from "../../lib/chat/retitle";
import { TaskStatusKindSchema, taskStatus } from "../../lib/chat/task-status";
import { answerQuestionAsk, declineSignInAsk } from "../../lib/chat/drive-asks";
import { openAsks, openAsksOf, openAsksUntil } from "../../lib/chat/open-asks";
import { AskSchema, SignInAskSchema } from "../../schemas/chat-state";
import { signInOfCall } from "../../lib/chat/asks";
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
import { type ListedAt } from "../../lib/chat/chat-list-events";
import { chatRoutes } from "./chat";
import { stop } from "./session";
import { base, toORPCError } from "../base";
import { atMoment, distinct, liveRead, where } from "../live-read";
import { publisher } from "../publisher";
import {
  chatNextMessages,
  watchNextMessage,
} from "../../lib/chat/next-message";

/** A task the chat started, as its tasks screen lists it. */
const ChildTaskSchema = ChatTaskSchema.extend({
  /** Where it stands and the line the list says about it. */
  status: z.object({
    kind: TaskStatusKindSchema,
    line: z.string(),
    summary: z.string().optional(),
  }),
  /**
   * Its own log cut into the stretches its cards in the chat stand for, oldest
   * first: from its start, and from each message the chat sent it after.
   */
  slices: z.array(
    z.object({
      endedAt: z.date(),
      failed: z.literal(true).optional(),
      from: StoreId.MessageSchema,
      handedOn: z.literal(true).optional(),
      line: z.string().optional(),
      startedAt: z.date(),
    }),
  ),
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
      const messages = await ownMessages(ref);
      const step = latestStepIn(messages);
      return {
        ...task,
        slices: taskSlices(messages),
        status: await taskStatus({ ...ref, isRunning: running }),
        ...(step ? { step } : {}),
        stoppable: running || (await openAsksOf(id, task.id)).length > 0,
        working: running,
      };
    }),
  );
}

/**
 * Whether a change is to the chat whose tasks a list shows: what one of its
 * rows shows (its title, its status, its step) is in the chat's store and
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
 * Each task's title, by its session, for a tab that names one: re-read only
 * when a session's header or settings move, which is where a title is
 * written, so a turn's messages never wake it.
 */
const liveTaskTitlesRoute = base
  .input(z.object({ id: ChatIdSchema }))
  .output(
    eventIterator(
      z.array(z.object({ id: StoreId.SessionSchema, title: z.string() })),
    ),
  )
  .handler(async function* ({ errors, input, signal }) {
    const chatId = resolveChat(input.id);
    if (!chatId) {
      throw errors.NOT_FOUND({ message: "That chat is not there any more." });
    }
    yield* distinct(
      liveRead({
        changes: [
          recordChanges(
            signal,
            (change) =>
              change.id === chatId &&
              (change.kind === "session" || change.kind === "removed"),
          ),
        ],
        read: async () =>
          (await listChildTasks(chatId)).map(({ id, title }) => ({
            id,
            title,
          })),
      }),
    );
  });

/**
 * Where the live chat list stands once a request is in its rows: the run of
 * the list and its revision, or none when no list is read.
 */
const ListedAtSchema = z
  .object({ epoch: z.string(), rev: z.number() })
  .nullable();

/**
 * Acts on the chat an id names; an id that is no chat's does nothing.
 * Answers with where the live chat list stands once it has read the chat's
 * row again after the act, changed or not, which is what a window waits for
 * before it takes back what it painted ahead of the request.
 */
async function whenChat(
  id: ChatId,
  act: (chatId: ChatId) => Promise<unknown>,
): Promise<ListedAt | null> {
  const chatId = resolveChat(id);
  if (chatId) {
    await act(chatId);
  }
  return await refreshChatRow(chatId ?? id);
}

/** One chat as the list shows it, or none for an id that is not a chat's. */
const chatByIdRoute = base
  .input(z.object({ id: ChatIdSchema }))
  .output(ChatRowSchema.optional())
  .handler(async ({ input }) => {
    const chat = await chatById(input.id);
    return chat && chatRow(chat);
  });

/**
 * The chats, oldest first: every row, then the rows each change moved and
 * the chats gone, numbered so a reader that misses one starts over. See
 * `liveChatRows`.
 */
const liveChatRowsRoute = base
  .output(
    eventIterator(
      z.discriminatedUnion("kind", [
        z.object({
          epoch: z.string(),
          kind: z.literal("snapshot"),
          rev: z.number(),
          rows: ChatRowSchema.array(),
        }),
        z.object({
          epoch: z.string(),
          from: z.number(),
          kind: z.literal("patch"),
          removed: ChatIdSchema.array(),
          rev: z.number(),
          upserts: ChatRowSchema.array(),
        }),
      ]),
    ),
  )
  .handler(async function* ({ signal }) {
    for await (const event of liveChatRows(signal)) {
      yield event.kind === "snapshot"
        ? { ...event, rows: event.rows.map(chatRow) }
        : { ...event, upserts: event.upserts.map(chatRow) };
    }
  });

/** Takes a chat's unread mark off: the user has looked at it, or said so. */
const readChatRoute = base
  .input(z.object({ id: ChatIdSchema }))
  .output(ListedAtSchema)
  .handler(async ({ input }) => {
    return await whenChat(input.id, markChatRead);
  });

/** Marks a chat unread by the user's hand, which holds until they come back to it. */
const unreadChatRoute = base
  .input(z.object({ id: ChatIdSchema }))
  .output(ListedAtSchema)
  .handler(async ({ input }) => {
    return await whenChat(input.id, (chatId) =>
      markChatUnread(chatId, { byUser: true }),
    );
  });

/**
 * Puts a chat away: out of the inbox, still in the list, marked. The person
 * archiving a chat is done with it, so whatever of it is at work or waiting
 * on them stops as Stop stops it.
 */
const archiveChatRoute = base
  .input(z.object({ id: ChatIdSchema }))
  .output(ListedAtSchema)
  .handler(async ({ context, input }) => {
    const chatId = resolveChat(input.id);
    if (chatId && (isWorking(chatId) || (await openAsks(chatId)).length > 0)) {
      await call(stop, { id: chatId }, { context });
    }
    return await whenChat(input.id, archiveChatAndTabs);
  });

/** Stars a chat, or takes the star off. */
const starChatRoute = base
  .input(z.object({ id: ChatIdSchema, starred: z.boolean() }))
  .output(ListedAtSchema)
  .handler(async ({ input }) => {
    return await whenChat(input.id, (chatId) =>
      setChatStarred(chatId, input.starred),
    );
  });

/** Brings a chat back into the inbox. */
const unarchiveChatRoute = base
  .input(z.object({ id: ChatIdSchema }))
  .output(ListedAtSchema)
  .handler(async ({ input }) => {
    return await whenChat(input.id, unarchiveChat);
  });

/**
 * Names a chat again from where it stands now, on the user's ask, as
 * often as they ask; answers with the title it has afterward and where the
 * live chat list stands once its row shows it, or nothing when there was
 * nothing to name it from. A name the user asked for settles the title the
 * same as one they typed.
 */
const retitleChatRoute = base
  .input(z.object({ id: ChatIdSchema }))
  .output(z.object({ listed: ListedAtSchema, title: z.string().optional() }))
  .handler(async ({ input }) => {
    const sessionId = sessionOfChat(input.id);
    if (!sessionId) {
      return { listed: null };
    }
    const title = await retitleChat({ id: input.id, sessionId });
    if (title === undefined) {
      return { listed: null };
    }
    await settleChatTitle(input.id);
    await followTitleBetweenTurns(input.id, title);
    return { listed: await refreshChatRow(input.id), title };
  });

/** Names a chat as the user typed it, and its folder with it. */
const renameChatRoute = base
  .input(z.object({ id: ChatIdSchema, title: z.string().trim().min(1) }))
  .output(ListedAtSchema)
  .handler(async ({ input }) => {
    return await whenChat(input.id, (chatId) =>
      renameChatAndFolder(chatId, input.title),
    );
  });

/**
 * Takes back what a turn's `chats` commands did, from its note's entries:
 * each field goes back to what it held before, but for one changed since.
 */
const undoChatChangesRoute = base
  .input(
    z.object({
      /** The card the Undo is on, which is marked undone. */
      card: ChangesCardSchema.optional(),
      changes: z.array(SessionMessageDataPart.ChatChangeSchema),
    }),
  )
  .output(z.object({ skipped: z.number(), undone: z.number() }))
  .handler(async ({ input }) => {
    const outcome = await undoChatChanges(input.changes);
    if (input.card) {
      await markCardUndone(input.card, outcome);
    }
    return outcome;
  });

/** Files a chat under a project, or under none with `null`. */
const setChatProjectRoute = base
  .input(z.object({ id: ChatIdSchema, project: z.string().nullable() }))
  .output(ListedAtSchema)
  .handler(async ({ input }) => {
    return await whenChat(input.id, (chatId) =>
      setChatProject(chatId, input.project),
    );
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
 * A new chat with a chat's conversation up to one of its replies, `upTo`
 * being that reply's last message: see `branchChat`.
 */
const branchChatRoute = base
  .input(z.object({ id: ChatIdSchema, upTo: StoreId.MessageSchema }))
  .output(z.object({ id: ChatIdSchema, listed: ListedAtSchema }))
  .handler(async ({ errors, input }) => {
    const chatId = resolveChat(input.id);
    if (!chatId) {
      throw errors.NOT_FOUND({ message: `${input.id} is not a chat` });
    }
    const id = await branchChat({ chatId, upTo: input.upTo });
    // Where the list stands with the new chat in it, so a window can wait
    // for its row before opening it.
    return { id, listed: await refreshChatRow(id) };
  });

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
 *
 * Answers with where the live chat list stands once the chat has left it.
 */
const trashChatRoute = base
  .input(
    z.object({
      id: ChatIdSchema,
      /** Whether the chat's own folder goes with it; off unless asked. */
      itsFolder: z.boolean().optional(),
    }),
  )
  .output(ListedAtSchema)
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
    return await refreshChatRow(id);
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
    // An answer still waiting for the computer that asked reads as given
    // while away once it goes stale, with no record changing then.
    const stale = atMoment(signal);
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
          stale.fires,
        ],
        read: async () => {
          const { asks, staleAt } = await openAsksUntil(input.id);
          stale.set(staleAt);
          return asks;
        },
      }),
    );
  });

/**
 * The sign-in a `connect_app` call put up, read again as the chat's records
 * move: which computer asked it, where signing in happens, and its rows as
 * that computer last wrote them, still up or not. None for a call that
 * raised no ask.
 */
const liveSignInRoute = base
  .input(z.object({ id: ChatIdSchema, partId: StoreId.PartSchema }))
  .output(
    eventIterator(SignInAskSchema.extend({ live: z.boolean() }).nullable()),
  )
  .handler(async function* ({ input, signal }) {
    yield* distinct(
      liveRead({
        changes: [
          recordChanges(
            signal,
            (change) =>
              change.id === input.id &&
              (change.kind === "messages" || change.kind === "session"),
          ),
        ],
        read: () => signInOfCall(input.id, input.partId),
      }),
    );
  });

/**
 * The messages this computer suggests the chat's person send next, likeliest
 * first, read again when they are made and as the chat's records move, which
 * is how a sent message or a new turn takes them away. Empty while nothing
 * is suggested.
 */
const liveNextMessagesRoute = base
  .input(z.object({ id: ChatIdSchema }))
  .output(eventIterator(z.array(z.string()).readonly()))
  .handler(async function* ({ input, signal }) {
    // A window reading this shows the chat, which is what asks for them.
    const unwatch = watchNextMessage(input.id);
    try {
      yield* distinct(
        liveRead({
          changes: [
            recordChanges(
              signal,
              (change) => change.id === input.id && change.kind === "messages",
            ),
            where(
              publisher.subscribe("chat.nextMessage", { signal }),
              (event) => event.id === input.id,
            ),
          ],
          read: async () => chatNextMessages(input.id),
        }),
      );
    } finally {
      unwatch();
    }
  });

/**
 * Not now to a sign-in card, from any device: the computer that asked
 * turns down every app on it still waiting and wakes the chat once. Signing
 * in itself happens on that computer alone, where its sign-ins and keys
 * are, so another device offers only this (`drive-asks.ts`).
 */
const declineSignInRoute = base
  .input(z.object({ askId: z.string(), id: ChatIdSchema }))
  .output(z.void())
  .handler(async ({ context, input }) => {
    await declineSignInAsk(input.id, input.askId, context.workspaceRef);
  });

/**
 * The person's answers to a card the chat put up with `choose`: for each
 * question a choice, their own words, or a skip, from any device. The
 * computer that asked writes them onto the call, which the card draws, and
 * wakes the chat once with every answer, or joins its turn at the next step
 * if it is still going (`drive-asks.ts`).
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
    await answerQuestionAsk(
      input.id,
      input.askId,
      input.answer,
      context.workspaceRef,
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

/**
 * What the person did with the card asking how the chat went: sent feedback
 * or closed it. Written onto the card for it to draw, and never wakes the
 * chat, so the agent never hears how it went.
 */
const settleRatingCardRoute = base
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
        part.type === "data-ratingCard" && part.data.outcome === undefined
          ? { ...part, data: { outcome: input.outcome } }
          : part,
    );
    if (written.isErr()) {
      throw toORPCError(written.error, errors);
    }
  });

export const chats = {
  ...chatRoutes,
  answerQuestion: answerQuestionRoute,
  declineSignIn: declineSignInRoute,
  settleFeedbackOffer: settleFeedbackOfferRoute,
  settleRatingCard: settleRatingCardRoute,
  archive: archiveChatRoute,
  branch: branchChatRoute,
  byId: chatByIdRoute,
  ensure: ensureChatRoute,
  live: {
    ...chatRoutes.live,
    asks: liveAsksRoute,
    nextMessages: liveNextMessagesRoute,
    signIn: liveSignInRoute,
    rows: liveChatRowsRoute,
    tasks: liveChildTasksRoute,
    taskTitles: liveTaskTitlesRoute,
  },
  ofSession: chatOfSessionRoute,
  read: readChatRoute,
  rename: renameChatRoute,
  retitle: retitleChatRoute,
  session: chatSessionRoute,
  setProject: setChatProjectRoute,
  star: starChatRoute,
  tasks: childTasksRoute,
  trash: trashChatRoute,
  unarchive: unarchiveChatRoute,
  undoChanges: undoChatChangesRoute,
  unread: unreadChatRoute,
};
