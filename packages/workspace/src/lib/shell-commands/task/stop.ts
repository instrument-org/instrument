import {
  killBackgroundProcess,
  listBackgroundProcesses,
} from "../../background-processes";
import { isWorking, leftRunning } from "../../chat/activity";
import { type ChatTask } from "../../chat/children";
import { describeLeftRunning } from "../../chat/left-running";
import { expectStop } from "../../chat/wake";
import { getWorkspaceActorRef } from "../../workspace-actor-ref";
import { type SubcommandInput, subcommand } from "../subcommands";
import { TASK_COMMAND } from "../task-command";
import { requireChild } from "./children";
import { type TaskCommandContext } from "./context";

export const stopSubcommand = subcommand<TaskCommandContext>({
  booleans: ["all"],
  run: runStop,
  usage: `  ${TASK_COMMAND.name} stop <t id>... [<bg id> | --all]
      End each running task's turn where it is, and say whether it stopped;
      \`send\` gives it the next thing to do. With a process id after one task
      (bg_1, as the note on its finish names them), stop only that process it
      left in the background, and leave its turn alone. --all ends the turns
      and every process they left running. A server the user is still using
      is theirs to keep; a scan nobody is waiting on is not.
`,
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
async function runStop(input: SubcommandInput, context: TaskCommandContext) {
  const [first, ...more] = input.positional;
  const all = input.has("all");
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
  { all, context }: { all: boolean; context: TaskCommandContext },
) {
  const turn = isWorking(task.chatId, task.id)
    ? await stopTurn(task, context)
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
  const targets =
    wanted === undefined
      ? running
      : running.filter((process) => process.id === wanted);
  if (wanted !== undefined && targets.length === 0) {
    const background = leftRunning(task.id)
      .map((process) => describeLeftRunning(process))
      .join(", ");
    throw new Error(
      `no ${wanted} running in ${task.handle}. In the background: ${background}.`,
    );
  }
  const now = Date.now();
  const lines = await Promise.all(
    targets.map(async (process) => {
      const described = describeLeftRunning({
        command: process.command,
        id: process.id,
        runningForMs: now - process.startedAt.getTime(),
      });
      const killed = await killBackgroundProcess({
        by: "conversation",
        id: process.id,
        sessionId: task.id,
      });
      if (!killed?.stoppedByThisCall) {
        return `${process.id} had already ended.`;
      }
      return killed.terminationConfirmed
        ? `Stopped ${described}.`
        : `Told ${described} to stop, but could not confirm it did; \`${TASK_COMMAND.name} list\` will say.`;
    }),
  );
  return `${lines.join("\n")}\n`;
}

/** Ends a working task's turn, and says whether it went idle in time. */
async function stopTurn(task: ChatTask, context: TaskCommandContext) {
  // The wake would report the turn this ends as a finish; it is not news.
  expectStop(task.id, { by: "chat", wakesChat: false });
  getWorkspaceActorRef().send({
    type: "stopSessions",
    value: { id: task.chatId, sessionId: task.id },
  });
  const timeoutMs = Math.max(
    0,
    Math.min(STOP_CONFIRM_MS, context.remainingYieldMs() - WAIT_MARGIN_MS),
  );
  const stopped = await waitForIdle(task, timeoutMs);
  return stopped
    ? `Stopped ${task.handle}. Its turn ended where it was; \`task send\` gives it the next thing to do.\n`
    : `Told ${task.handle} to stop, and it is still ending; \`task list\` will say when it has.\n`;
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
