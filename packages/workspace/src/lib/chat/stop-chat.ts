import { stopRunningProcesses } from "../background-processes";
import { sessionOfChat } from "../record-folders";
import { type WorkspaceActorRef } from "../../machines/workspace";
import { type ChatId } from "../../schemas/chat-id";
import { type StoreId } from "../../schemas/store-id";
import { type WorkspaceConfig } from "../../types";
import { isWorking } from "./activity";
import { closeAsksOf } from "./asks";
import { markChatStopped } from "./chats";
import { listChildTasks } from "./children";
import { openAsks, openAsksOf, openQuestions } from "./open-asks";
import { type TakenBack, takeBackUnanswered } from "./take-back";
import { noteTaskStoppedOnCard } from "./wake";

/**
 * What the person's Stop of a whole chat would end: whether an agent of it
 * is at work, and how many cards it waits on the person's answer to.
 */
export async function whatStopEnds(
  chatId: ChatId,
): Promise<{ asks: number; working: boolean }> {
  return { asks: (await openAsks(chatId)).length, working: isWorking(chatId) };
}

/** Whether the person's Stop of a whole chat has something to end. */
export async function hasSomethingToStop(chatId: ChatId): Promise<boolean> {
  const ends = await whatStopEnds(chatId);
  return ends.working || ends.asks > 0;
}

/**
 * The person's Stop of a record's agents: a chat's, which is its own
 * conversation and every task it started; or with `sessionId`, that one session alone, a task's
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
export async function stopChat(
  chatId: ChatId,
  {
    captureException,
    sessionId,
    takeBack = false,
    workspaceRef,
  }: Pick<WorkspaceConfig, "captureException"> & {
    sessionId?: StoreId.Session;
    takeBack?: boolean;
    workspaceRef: WorkspaceActorRef;
  },
): Promise<{ takenBack?: TakenBack }> {
  // When the user pressed Stop, on the clock a message is dated by, and
  // whether it reaches a turn of the chat's own, read before the stop
  // lands on it.
  const pressedAt = new Date();
  const chatSessionId = sessionOfChat(chatId);
  const reachesChat =
    chatSessionId !== undefined &&
    (sessionId === undefined || sessionId === chatSessionId);
  const stopsOwnTurn = reachesChat && isWorking(chatId, chatSessionId);
  // A question the chat asked closes with the Stop, which its record says,
  // so a chat waiting on one is marked stopped even with no turn to end.
  const closesQuestions =
    reachesChat && (await openQuestions(chatId)).length > 0;
  // A task whose turn ended with a card still up has no turn for the stop
  // to end, so nothing would say it stopped; read before its cards go.
  // The whole chat's Stop reaches every task of it.
  const stopsTasks =
    sessionId === undefined
      ? (await listChildTasks(chatId)).map((task) => task.id)
      : sessionId === chatSessionId
        ? []
        : [sessionId];
  const waitingOnCard = (
    await Promise.all(
      stopsTasks.map(async (task) =>
        !isWorking(chatId, task) && (await openAsksOf(chatId, task)).length > 0
          ? task
          : undefined,
      ),
    )
  ).filter((task) => task !== undefined);
  // A task the person stops ends what it runs in the background too, as
  // the agent's `instrument task stop --all` does. A job handed to the task is the
  // task's, so this reaches it. A process can take seconds to go, so the
  // turn is not kept waiting on it; the note the stop leaves the chat waits
  // instead (`wake.ts`), so it names nothing as still running.
  if (sessionId !== undefined && sessionId !== chatSessionId) {
    stopRunningProcesses({ by: "user", sessionId }).catch(captureException);
  }
  // The user's stop, which the task's page ends on. Every task it ends,
  // one stopped alone or all of them with the whole chat, is written into
  // the chat as a note that starts no turn, so its agent does not wait on a
  // task nobody is running; the chat's own session tells it nothing, since
  // only a task reports to its chat.
  workspaceRef.send({
    type: "stopSessions",
    value: {
      id: chatId,
      notice: {
        by: "person",
        ...(takeBack ? { takesBack: true } : {}),
        wakesChat: true,
      },
      ...(sessionId ? { sessionId } : {}),
    },
  });
  // What the stopped sessions were waiting on the person to allow goes
  // with them, unanswered, so it neither keeps the chat waiting nor
  // starts them again when answered.
  const closing = closeAsksOf(chatId, sessionId);
  const takenBack =
    takeBack && stopsOwnTurn && chatSessionId !== undefined
      ? await takeBackUnanswered({ chatId, sessionId: chatSessionId })
      : undefined;
  await Promise.all([
    closing,
    // The chat says the user stopped it until a turn starts after the
    // Stop, however far its turn had got, before it began included.
    (stopsOwnTurn || closesQuestions) && takenBack === undefined
      ? markChatStopped(chatId, pressedAt)
      : undefined,
  ]);
  // Not waited on, as a turn's end is not: its note waits out the
  // processes the stop ends.
  for (const task of waitingOnCard) {
    noteTaskStoppedOnCard(chatId, task, workspaceRef, "person").catch(
      captureException,
    );
  }
  return takenBack ? { takenBack } : {};
}
