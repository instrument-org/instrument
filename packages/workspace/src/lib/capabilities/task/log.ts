import { z } from "zod";

import { StoreId } from "../../../schemas/store-id";
import { type ChatId } from "../../../schemas/chat-id";
import { isWorking } from "../../chat/activity";
import { stepInFlight } from "../../chat/in-flight";
import { renderSteps, sessionSteps } from "../../chat/steps";
import { TASK_COMMAND } from "../../shell-commands/task-command";
import { defineCapability } from "../define";
import { requireChild } from "./children";
import { TASKS_ARE_THE_CHATS } from "./roles";

const DEFAULT_LOG_TAIL_LINES = 120;
const LOG_MAX_BYTES = 24 * 1024;

export const taskLog = defineCapability({
  input: z.object({
    task: z.string({
      error: "a task id (t1) is required. See `instrument task list`.",
    }),
    steps: z.boolean().default(false).meta({
      description:
        "The outline instead: what it set out to do, each call and how it ended, what it said, one line each and no tool output. Read this first to see what a task is doing; the transcript's tail is whatever printed last.",
    }),
    tail: z
      .number({ error: "--tail takes a number of lines." })
      .int("--tail takes a number of lines.")
      .positive("--tail takes a number of lines.")
      .default(DEFAULT_LOG_TAIL_LINES)
      .meta({
        description: `The last this many lines (${DEFAULT_LOG_TAIL_LINES} unless given).`,
      }),
  }),
  name: "task.log",
  output: z.string(),
  async run({ steps, tail, task: named }, ctx) {
    const task = await requireChild(named, ctx);
    const ref = { sessionId: task.id, chatId: task.chatId };
    const rendered = steps
      ? // The outline rather than the transcript: one line per thing the task
        // set out to do or called, with tool output left out. The transcript's
        // tail is whatever printed last, which for a wide search is a page of
        // paths that says nothing about what the task is doing.
        renderSteps(await sessionSteps(ref))
      : await renderTranscript(ref);
    const lines = rendered.trimEnd().split("\n");
    const omitted = Math.max(0, lines.length - tail);
    let text = lines.slice(-tail).join("\n");
    if (text.length > LOG_MAX_BYTES) {
      text = `[...${text.length - LOG_MAX_BYTES} earlier characters omitted]\n${text.slice(-LOG_MAX_BYTES)}`;
    }
    const header =
      omitted > 0
        ? `[${omitted} earlier lines omitted; raise --tail to see more]\n`
        : "";
    // The outline's lines are steps that happened; a working task's last line
    // is the one still happening, which no step line measures.
    const inFlight =
      steps && isWorking(task.chatId, task.id)
        ? await stepInFlight(ref)
        : undefined;
    return `${header}${text}\n${inFlight ? `now: ${inFlight}\n` : ""}`;
  },
  summary: `A task's transcript, last ${DEFAULT_LOG_TAIL_LINES} lines by default.`,
  surfaces: {
    cli: {
      help: `Composes: \`${TASK_COMMAND.name} log t1 | rg error\`.`,
      positional: ["task"],
      words: ["task", "log"],
    },
  },
  text: (log) => log,
  where: TASKS_ARE_THE_CHATS,
});

async function renderTranscript({
  sessionId,
  chatId,
}: {
  sessionId: StoreId.Session;
  chatId: ChatId;
}) {
  // Loaded here rather than at the top: the renderer imports the tool registry,
  // which imports the bash tool, which imports this command, so a static import
  // would close a cycle that leaves the registry half-built when it is read.
  const { getSessionMarkdown } = await import("../../session-to-markdown");
  return getSessionMarkdown({
    includeContextMessages: false,
    sessionId,
    chatId,
  });
}
