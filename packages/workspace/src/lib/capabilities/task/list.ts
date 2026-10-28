import { z } from "zod";

import { isWorking, leftRunning } from "../../chat/activity";
import { type ChatTask, listChildTasks } from "../../chat/children";
import { taskStanding } from "../../chat/standing";
import { TASK_COMMAND } from "../../shell-commands/task-command";
import {
  TASK_LIST_WINDOW,
  type TaskListQuery,
  type TaskListRow,
  parseListDate,
  renderTaskList,
  selectTasks,
} from "../../shell-commands/task-list-output";
import { defineCapability } from "../define";
import { TASKS_ARE_THE_CHATS } from "./roles";

const Day = (description: string) =>
  z.string().optional().meta({ description });

const TaskRow = z.object({
  /** Its handle in the chat, `t1`. */
  id: z.string(),
  status: z.enum(["done", "failed", "running", "waiting"]),
  /** Whether an agent turn is live in it. */
  working: z.boolean(),
  /** How many processes it has running in the background. */
  in_background: z.number(),
  title: z.string(),
  /** The step it is on, what it waits for, or what it last said. */
  line: z.string(),
  updated_at: z.date(),
});

export const taskList = defineCapability({
  input: z.object({
    since: Day(
      "Only tasks last active on or after a day (2026-08-14) or a span back from now (30d).",
    ),
    until: Day("Only tasks last active up to a day, or a span back from now."),
    running: z.boolean().default(false).meta({
      description: "Only tasks at work now.",
    }),
    limit: z
      .number({ error: "--limit takes a whole number." })
      .int("--limit takes a whole number.")
      .optional()
      .meta({
        description: `At most this many (${TASK_LIST_WINDOW} unless given).`,
      }),
    all: z.boolean().default(false).meta({ description: "Every match." }),
  }),
  name: "task.list",
  output: z.object({
    tasks: z.array(TaskRow),
    /** Matched but left out past the window. */
    omitted: z.number(),
    /** How many matched. */
    total: z.number(),
    /** What an empty answer says, where nothing is shown. */
    none: z.string().optional(),
  }),
  async run({ all, limit, running, since, until }, ctx) {
    const query: TaskListQuery = {
      all,
      ...(limit === undefined ? {} : { limit }),
      running,
      ...(since ? { since: parseListDate(since) } : {}),
      ...(until ? { until: parseListDate(until, { endOfDay: true }) } : {}),
    };
    const children = await listChildTasks(ctx.chatId);
    const selection = selectTasks(await listRowsOf(children), query);
    const tasks = selection.shown.map((row) => ({
      id: row.id,
      in_background: row.leftRunning,
      line: row.line,
      status: row.status,
      title: row.title,
      updated_at: row.updatedAt,
      working: row.isRunning,
    }));
    const answer = {
      omitted: selection.omitted,
      tasks,
      total: selection.total,
    };
    if (tasks.length > 0) {
      return answer;
    }
    if (children.length === 0) {
      return {
        ...answer,
        none: `No tasks yet. Create one with \`${TASK_COMMAND.name} new\`.`,
      };
    }
    if (running && !since && !until) {
      return { ...answer, none: "No tasks running." };
    }
    return {
      ...answer,
      none: `No task in that range, out of ${children.length}. Widen the dates, or list them all with \`${TASK_COMMAND.name} list --all\`.`,
    };
  },
  summary:
    "Your tasks, newest activity first: id, status, what it has running in the background when anything does, the day it was last active, how long ago that was, the title, and the step it is on, what it waits for, or what it last said.",
  surfaces: {
    cli: {
      help: `The newest ${TASK_LIST_WINDOW} unless narrowed, and a count of the rest. --since and
--until read the day a task was last active.`,
      words: ["task", "list"],
    },
  },
  text: ({ none, omitted, tasks, total }) =>
    none ??
    renderTaskList({
      omitted,
      shown: tasks.map(
        (task): TaskListRow => ({
          id: task.id,
          isRunning: task.working,
          leftRunning: task.in_background,
          line: task.line,
          status: task.status,
          title: task.title,
          updatedAt: task.updated_at,
        }),
      ),
      total,
    }).trimEnd(),
  where: TASKS_ARE_THE_CHATS,
});

function listRowsOf(tasks: ChatTask[]): Promise<TaskListRow[]> {
  return Promise.all(
    tasks.map(async (task) => {
      const isRunning = isWorking(task.chatId, task.id);
      const standing = await taskStanding({
        isRunning,
        sessionId: task.id,
        chatId: task.chatId,
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
