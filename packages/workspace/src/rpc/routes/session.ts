import {
  AIGatewayModelURI,
  ModelChoiceSchema,
  fetchModel,
} from "@instrument-org/ai-gateway";
import { call, type } from "@orpc/server";
import { sleep } from "radashi";
import { z } from "zod";

import { stopRunningProcesses } from "../../lib/background-processes";
import { changedMessageBatches } from "../../lib/changed-message-batches";
import { isWorking } from "../../lib/chat/activity";
import { markChatStopped } from "../../lib/chat/chats";
import { listChildTasks } from "../../lib/chat/children";
import { type TakenBack, takeBackUnanswered } from "../../lib/chat/take-back";
import { noteTaskStoppedOnCard } from "../../lib/chat/wake";
import { enqueueWake, saveNote } from "../../lib/chat/wake-queue";
import { askWindow } from "../../lib/chat/window-tab";
import { closeAsksOf } from "../../lib/chat/asks";
import { openAsksOf, openQuestions } from "../../lib/chat/open-asks";
import { sessionOfChat } from "../../lib/record-folders";
import { ChatReads } from "../../lib/chat-reads";
import { type SessionMessage } from "../../schemas/session/message";
import { StoreId } from "../../schemas/store-id";
import { type ChatId, ChatIdSchema } from "../../schemas/chat-id";
import { setChatModelChoice } from "../../lib/chat-settings";
import { base, toORPCError } from "../base";

// Run the agent over the session as it stands, with nothing added to it. What
// the agent answers is the request already in the transcript, so a turn that
// failed on its way to the model is asked for again exactly as it was sent the
// first time, and the user is not made to say something to get it.
const run = base
  .input(
    z.object({
      id: ChatIdSchema,
      /** Does nothing if the session is running, rather than running it next. */
      ifIdle: z.boolean().optional(),
      /** What was chosen for the model, `null` for its defaults; left out, the chat's stands. */
      modelChoice: ModelChoiceSchema.nullable().optional(),
      modelURI: AIGatewayModelURI.Schema,
      sessionId: StoreId.SessionSchema,
    }),
  )
  .output(z.void())
  .handler(async ({ context, errors, input }) => {
    const { id, ifIdle, modelChoice, modelURI, sessionId } = input;

    // A session whose last word is a reply the model finished has no request
    // in it to answer, and a provider handed a conversation ending on its own
    // turn refuses it, so the run is a no-op there.
    const history = await ChatReads.history({ chatId: id, sessionId });
    if (history.isOk() && endsOnFinishedReply(history.value)) {
      return;
    }

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

    if (modelChoice !== undefined) {
      const chosen = await setChatModelChoice(id, modelChoice);
      if (chosen.isErr()) {
        throw toORPCError(chosen.error, errors);
      }
    }

    context.workspaceRef.send({
      type: "runTurn",
      value: {
        id,
        ifIdle,
        model: modelResult.value,
        sessionId,
      },
    });
  });

/**
 * Whether the conversation ends on a reply the model ended on its own: not
 * one that failed, was stopped, or ran out of steps or room.
 */
function endsOnFinishedReply(messages: readonly SessionMessage.WithParts[]) {
  const last = messages.findLast(
    (message) => message.role === "assistant" || message.role === "user",
  );
  return (
    last?.role === "assistant" &&
    last.metadata.error === undefined &&
    last.metadata.finishReason === "stop"
  );
}

/**
 * Stops a record's agents: a chat's, which is its own conversation and every
 * task it started; or with `sessionId`, that one session alone, a task's
 * from its row or page, with everything it has running in the background,
 * or the chat's own turn alone, which leaves its tasks working and its
 * processes running.
 *
 * With `takeBack`, a Stop that reaches the chat's own turn before the model
 * has answered the person's message takes that message back
 * (`takeBackUnanswered`): it goes from the chat, the Stop is not recorded,
 * since what it stopped is gone, and what it was sent with is answered for
 * the reply box.
 */
export const stop = base
  .input(
    z.object({
      id: ChatIdSchema,
      sessionId: StoreId.SessionSchema.optional(),
      takeBack: z.boolean().optional(),
    }),
  )
  .output(type<{ takenBack?: TakenBack }>())
  .handler(async ({ context, input }) => {
    // When the user pressed Stop, on the clock a message is dated by, and
    // whether it reaches a turn of the chat's own, read before the stop
    // lands on it.
    const pressedAt = new Date();
    const chatSessionId = sessionOfChat(input.id);
    const reachesChat =
      chatSessionId !== undefined &&
      (input.sessionId === undefined || input.sessionId === chatSessionId);
    const stopsOwnTurn = reachesChat && isWorking(input.id, chatSessionId);
    // A question the chat asked closes with the Stop, which its record says,
    // so a chat waiting on one is marked stopped even with no turn to end.
    const closesQuestions =
      reachesChat && (await openQuestions(input.id)).length > 0;
    // A task whose turn ended with a card still up has no turn for the stop
    // to end, so nothing would say it stopped; read before its cards go.
    // The whole chat's Stop reaches every task of it.
    const stopsTasks =
      input.sessionId === undefined
        ? (await listChildTasks(input.id)).map((task) => task.id)
        : input.sessionId === chatSessionId
          ? []
          : [input.sessionId];
    const waitingOnCard = (
      await Promise.all(
        stopsTasks.map(async (sessionId) =>
          !isWorking(input.id, sessionId) &&
          (await openAsksOf(input.id, sessionId)).length > 0
            ? sessionId
            : undefined,
        ),
      )
    ).filter((sessionId) => sessionId !== undefined);
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
    // The user's stop, which the task's page ends on. Every task it ends,
    // one stopped alone or all of them with the whole chat, is written into
    // the chat as a note that starts no turn, so its agent does not wait on a
    // task nobody is running; the chat's own session tells it nothing, since
    // only a task reports to its chat.
    context.workspaceRef.send({
      type: "stopSessions",
      value: {
        id: input.id,
        notice: { by: "person", wakesChat: true },
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      },
    });
    // What the stopped sessions were waiting on the person to allow goes
    // with them, unanswered, so it neither keeps the chat waiting nor
    // starts them again when answered.
    const closing = closeAsksOf(input.id, input.sessionId);
    const takenBack =
      input.takeBack && stopsOwnTurn && chatSessionId !== undefined
        ? await takeBackUnanswered({
            chatId: input.id,
            sessionId: chatSessionId,
          })
        : undefined;
    await Promise.all([
      closing,
      // The chat says the user stopped it until a turn starts after the
      // Stop, however far its turn had got, before it began included.
      (stopsOwnTurn || closesQuestions) && takenBack === undefined
        ? markChatStopped(input.id, pressedAt)
        : undefined,
    ]);
    // Not waited on, as a turn's end is not: its note waits out the
    // processes the stop ends.
    for (const sessionId of waitingOnCard) {
      noteTaskStoppedOnCard(
        input.id,
        sessionId,
        context.workspaceRef,
        "person",
      ).catch(context.workspaceConfig.captureException);
    }
    return takenBack ? { takenBack } : {};
  });

/** How long Take over waits for the stopped turn to wind down before it writes its note. */
const STOP_SETTLE_MS = 3000;

/** A chat's tab as the window has it now, or nothing when it is not one of the chat's pages. */
async function chatPage(id: ChatId, tab: string) {
  const listed = await askWindow({
    action: { kind: "list" },
    askedBy: id,
    group: id,
  }).catch(() => undefined);
  const found = listed?.pages?.find((each) => each.id === tab);
  return found && { title: found.title, url: found.url };
}

/**
 * Waits for the stopped turn's last message, which the stop writes as its
 * turn winds down, so a note saved next reads after the work it stopped.
 */
async function stoppedTurnWritten(id: ChatId, sessionId: StoreId.Session) {
  const until = Date.now() + STOP_SETTLE_MS;
  while (isWorking(id, sessionId) && Date.now() < until) {
    await sleep(50);
  }
}

/**
 * Take over on a page the chat is working in: the chat stops as Stop stops
 * it, and a note that starts no turn says the person has the page, which the
 * chat reads with whatever starts its next turn. The transcript draws the
 * note as the paused line with Continue.
 */
const takeOver = base
  .input(z.object({ id: ChatIdSchema, tab: z.string() }))
  .handler(async ({ context, input }) => {
    await call(stop, { id: input.id }, { context });
    const sessionId = sessionOfChat(input.id);
    const page = await chatPage(input.id, input.tab);
    if (sessionId === undefined || page === undefined) {
      return;
    }
    await stoppedTurnWritten(input.id, sessionId);
    await saveNote(input.id, sessionId, {
      data: { page, stage: "taken", tab: input.tab },
      type: "data-pageTakeover",
    });
  });

/**
 * Continue after Take over: the chat is woken with the page as it stands
 * now, and picks the work up from there.
 */
const giveBack = base
  .input(z.object({ id: ChatIdSchema, tab: z.string() }))
  .handler(async ({ context, input }) => {
    const sessionId = sessionOfChat(input.id);
    const page = await chatPage(input.id, input.tab);
    if (sessionId === undefined || page === undefined) {
      return;
    }
    await enqueueWake({
      chatId: input.id,
      part: {
        data: { page, stage: "returned", tab: input.tab },
        type: "data-pageTakeover",
      },
      sessionId,
      workspaceRef: context.workspaceRef,
    });
  });

/** A page of the chat's that closed, as the window last had it. */
const ClosedPageSchema = z.object({
  id: ChatIdSchema,
  page: z.object({ title: z.string(), url: z.string() }),
  tab: z.string(),
});

/**
 * The person closed the page the chat was on: the chat stops as Stop stops
 * it, and a note that starts no turn says which page, which the chat reads
 * with whatever starts its next turn. The transcript draws the note as the
 * stopped line with Continue. The window names the page, whose tab may be
 * gone before this is read.
 */
const stopOnClose = base
  .input(ClosedPageSchema)
  .handler(async ({ context, input }) => {
    const { id, page, tab } = input;
    await call(stop, { id }, { context });
    const sessionId = sessionOfChat(id);
    if (sessionId === undefined) {
      return;
    }
    await stoppedTurnWritten(id, sessionId);
    await saveNote(id, sessionId, {
      data: { page, stage: "closed", tab },
      type: "data-pageTakeover",
    });
  });

/** Continue after a close stopped the chat: the chat is woken and told which page closed. */
const continueAfterClose = base
  .input(ClosedPageSchema)
  .handler(async ({ context, input }) => {
    const { id, page, tab } = input;
    const sessionId = sessionOfChat(id);
    if (sessionId === undefined) {
      return;
    }
    await enqueueWake({
      chatId: id,
      part: {
        data: { page, stage: "continued", tab },
        type: "data-pageTakeover",
      },
      sessionId,
      workspaceRef: context.workspaceRef,
    });
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
  continueAfterClose,
  giveBack,
  live,
  run,
  stop,
  stopOnClose,
  takeOver,
};
