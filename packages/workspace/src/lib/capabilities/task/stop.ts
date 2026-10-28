import { z } from "zod";

import {
  listBackgroundProcesses,
  stopRunningProcesses,
} from "../../background-processes";
import { isWorking, leftRunning } from "../../chat/activity";
import { type ChatTask } from "../../chat/children";
import { describeLeftRunning } from "../../chat/left-running";
import { noteTaskStoppedOnCard } from "../../chat/wake";
import { closeAsksOf } from "../../chat/asks";
import { openAsksOf } from "../../chat/open-asks";
import { getWorkspaceActorRef } from "../../workspace-actor-ref";
import { TASK_COMMAND } from "../../shell-commands/task-command";
import { type CapabilityContext, defineCapability } from "../define";
import { requireChild } from "./children";
import { TASKS_ARE_THE_CHATS } from "./roles";

const TASK_REQUIRED = "a task id (t1) is required. See `instrument task list`.";

export const taskStop = defineCapability({
  input: z.object({
    tasks: z.array(z.string(), { error: TASK_REQUIRED }).min(1, TASK_REQUIRED),
    all: z.boolean().default(false).meta({
      description: "End the turns and every process they left running.",
    }),
  }),
  name: "task.stop",
  output: z.string(),
  run: ({ all, tasks }, ctx) => runStop(tasks, all, ctx),
  summary:
    "End each running task's turn where it is, and say whether it stopped; `send` gives it the next thing to do.",
  surfaces: {
    cli: {
      help: `With a process id after one task (bg_1, as the note on its finish names
them), stop only that process it left in the background, and leave its
turn alone. A server the user is still using is theirs to keep; a scan
nobody is waiting on is not.`,
      positional: ["tasks"],
      words: ["task", "stop"],
    },
  },
  text: (said) => said,
  where: TASKS_ARE_THE_CHATS,
});

/** How long `stop` waits to see a task go idle before saying it is still ending. */
const STOP_CONFIRM_MS = 5000;
const STOP_POLL_MS = 100;
/** Held back from the yield window so a stop returns inside it. */
const WAIT_MARGIN_MS = 500;

/**
 * One stop verb for everything a task has going. Bare, it ends the task's
 * turn and leaves what it started in the background running, since a server
 * the user is looking at outlives the turn that started it; with a process id
 * it stops that one process and leaves the turn alone; `--all` ends both.
 *
 * Background processes are stopped through the registry directly rather than
 * by asking the task to, which would cost it a turn and trust the model that
 * left them behind: the same act as the stop button beside the task's title.
 */
async function runStop(
  named: readonly string[],
  all: boolean,
  context: CapabilityContext,
) {
  const [first, ...more] = named;
  // A second argument is a process of the first task's unless it names a
  // task too, which is how "stop everything" reads: `stop t1 t2`.
  const processId =
    more.length === 1 && !namesATask(more[0] ?? "") ? more[0] : undefined;
  if (processId !== undefined && all) {
    throw new Error(
      "stop: a process id or --all, not both. --all already stops every process.",
    );
  }
  const task = await requireChild(first, context);
  if (processId !== undefined) {
    return await stopBackground(task, processId);
  }
  const others = await Promise.all(
    more.map((raw) => requireChild(raw, context)),
  );
  const said: string[] = [];
  for (const each of [task, ...others]) {
    said.push(await stopOne(each, { all, context }));
  }
  return said.join("");
}

/** Whether an argument reads as a task's handle or session rather than a process. */
function namesATask(raw: string): boolean {
  return /^t\d+$/i.test(raw) || raw.startsWith("ses_");
}

/** Ends one task's turn, and with `all` what it left running too. */
async function stopOne(
  task: ChatTask,
  { all, context }: { all: boolean; context: CapabilityContext },
) {
  const turn = isWorking(task.chatId, task.id)
    ? await stopTurn(task, context)
    : (await openAsksOf(task.chatId, task.id)).length > 0
      ? await stopWaiting(task)
      : `${task.handle} is not running.\n`;
  if (all) {
    return `${turn}${await stopBackground(task)}`;
  }
  const background = leftRunning(task.id);
  if (background.length === 0) {
    return turn;
  }
  return `${turn}It left running in the background: ${background.map((process) => describeLeftRunning(process)).join(", ")}. \`${TASK_COMMAND.name} stop ${task.handle} <bg id>\` stops one, \`${TASK_COMMAND.name} stop ${task.handle} --all\` every one.\n`;
}

/**
 * Stops what a task left running in the background: the one process named, or
 * every one. Says so when there is nothing, so `--all` on a task with no
 * processes reads as done rather than as silence.
 */
async function stopBackground(task: ChatTask, wanted?: string) {
  const running = listBackgroundProcesses(task.id).filter(
    (process) => process.status === "running",
  );
  if (running.length === 0) {
    return `${task.handle} has nothing running in the background.\n`;
  }
  if (
    wanted !== undefined &&
    !running.some((process) => process.id === wanted)
  ) {
    const background = leftRunning(task.id)
      .map((process) => describeLeftRunning(process))
      .join(", ");
    throw new Error(
      `no ${wanted} running in ${task.handle}. In the background: ${background}.`,
    );
  }
  const now = Date.now();
  const stopped = await stopRunningProcesses({
    by: "conversation",
    ...(wanted === undefined ? {} : { id: wanted }),
    sessionId: task.id,
  });
  const lines = stopped.map(({ killed, process }) => {
    const described = describeLeftRunning({
      command: process.command,
      id: process.id,
      runningForMs: now - process.startedAt.getTime(),
    });
    if (!killed?.stoppedByThisCall) {
      return `${process.id} had already ended.`;
    }
    return killed.terminationConfirmed
      ? `Stopped ${described}.`
      : `Told ${described} to stop, but could not confirm it did; \`${TASK_COMMAND.name} list\` will say.`;
  });
  return `${lines.join("\n")}\n`;
}

/**
 * Stops a task whose turn ended on a card still waiting for the person: takes
 * it off its cards, so an answer cannot wake it, and marks it stopped by the
 * chat, as the person's Stop of such a task does for them.
 */
async function stopWaiting(task: ChatTask) {
  await closeAsksOf(task.chatId, task.id);
  await noteTaskStoppedOnCard(
    task.chatId,
    task.id,
    getWorkspaceActorRef(),
    "agent",
  );
  return `Stopped ${task.handle}, which was waiting on the person's answer to a card; an answer no longer wakes it. \`instrument task send\` gives it the next thing to do.\n`;
}

/** Ends a working task's turn, and says whether it went idle in time. */
async function stopTurn(task: ChatTask, context: CapabilityContext) {
  // The wake would report the turn this ends as a finish; it is not news.
  getWorkspaceActorRef().send({
    type: "stopSessions",
    value: {
      id: task.chatId,
      notice: { by: "agent", wakesChat: false },
      reason: "chat",
      sessionId: task.id,
    },
  });
  // A card it raised on the way would otherwise wake it once answered.
  await closeAsksOf(task.chatId, task.id);
  const timeoutMs = Math.max(
    0,
    Math.min(STOP_CONFIRM_MS, context.remainingYieldMs() - WAIT_MARGIN_MS),
  );
  const stopped = await waitForIdle(task, timeoutMs);
  return stopped
    ? `Stopped ${task.handle}. Its turn ended where it was; \`instrument task send\` gives it the next thing to do.\n`
    : `Told ${task.handle} to stop, and it is still ending; \`instrument task list\` will say when it has.\n`;
}

/**
 * Whether a task went idle within `timeoutMs`, checked every
 * {@link STOP_POLL_MS}. A stop ends the step in flight at once, and a session
 * that does not answer is torn down a second later, so a few seconds is
 * enough for anything but a store write that hangs.
 */
async function waitForIdle(task: ChatTask, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (isWorking(task.chatId, task.id)) {
    if (Date.now() >= deadline) {
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, STOP_POLL_MS));
  }
  return true;
}
