import { isWorking, leftRunning } from "../../chat/activity";
import { type ChatTask, listChildTasks } from "../../chat/children";
import { taskStanding } from "../../chat/standing";
import { type SubcommandInput, subcommand } from "../subcommands";
import { TASK_COMMAND } from "../task-command";
import {
  TASK_LIST_WINDOW,
  type TaskListQuery,
  type TaskListRow,
  parseListDate,
  renderTaskList,
  selectTasks,
} from "../task-list-output";
import { type TaskCommandContext } from "./context";

export const listSubcommand = subcommand<TaskCommandContext>({
  booleans: ["all", "running"],
  flags: ["limit", "since", "until"],
  positional: 0,
  run: runList,
  usage: `  ${TASK_COMMAND.name} list [--since <date>] [--until <date>] [--running] [--limit <n>] [--all]
      Your tasks, newest activity first: id, status, what it has running in the
      background when anything does, the day it was last active, how long ago
      that was, the title, and the step it is on, what it waits for, or what it
      last said. The newest ${TASK_LIST_WINDOW} unless narrowed, and a count of
      the rest; --all shows every match. --since and --until take a day
      (2026-08-14) or a span back from now (30d), and read the day a task was
      last active.
`,
});

async function runList(input: SubcommandInput, context: TaskCommandContext) {
  const query = listQueryFrom(input);
  const children = await listChildTasks(context.chatId);
  const selection = selectTasks(await listRowsOf(children), query);
  if (selection.shown.length === 0) {
    if (children.length === 0) {
      return "No tasks yet. Create one with `task new`.\n";
    }
    if (query.running && !query.since && !query.until) {
      return "No tasks running.\n";
    }
    return `No task in that range, out of ${children.length}. Widen the dates, or list them all with \`task list --all\`.\n`;
  }
  return renderTaskList(selection);
}

/** The window and date flags `list` takes. */
function listQueryFrom(input: SubcommandInput): TaskListQuery {
  const rawLimit = input.value("limit");
  if (rawLimit !== undefined && !Number.isInteger(Number(rawLimit))) {
    throw new Error(`--limit takes a whole number, not "${rawLimit}".`);
  }
  const rawSince = input.value("since");
  const rawUntil = input.value("until");
  return {
    all: input.has("all"),
    ...(rawLimit === undefined ? {} : { limit: Number(rawLimit) }),
    running: input.has("running"),
    ...(rawSince ? { since: parseListDate(rawSince) } : {}),
    ...(rawUntil ? { until: parseListDate(rawUntil, { endOfDay: true }) } : {}),
  };
}

function listRowsOf(tasks: ChatTask[]): Promise<TaskListRow[]> {
  return Promise.all(
    tasks.map(async (task) => {
      const isRunning = isWorking(task.chatId, task.id);
      const standing = await taskStanding({
        isRunning,
        sessionId: task.id,
        taskId: task.chatId,
      });
      return {
        id: task.handle,
        isRunning,
        leftRunning: leftRunning(task.id).length,
        line: standing.line,
        status: standing.kind,
        title: task.title,
        updatedAt: task.updatedAt,
      };
    }),
  );
}
