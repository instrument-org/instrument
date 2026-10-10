import { StoreId } from "../../../schemas/store-id";
import { type TaskId } from "../../../schemas/task-id";
import { isWorking } from "../../chat/activity";
import { stepInFlight } from "../../chat/in-flight";
import { renderSteps, sessionSteps } from "../../chat/steps";
import { type SubcommandInput, subcommand } from "../subcommands";
import { TASK_COMMAND } from "../task-command";
import { requireChild } from "./children";
import { type TaskCommandContext } from "./context";

const DEFAULT_LOG_TAIL_LINES = 120;
const LOG_MAX_BYTES = 24 * 1024;

export const logSubcommand = subcommand<TaskCommandContext>({
  booleans: ["steps"],
  flags: ["tail"],
  positional: 1,
  run: runLog,
  usage: `  ${TASK_COMMAND.name} log <t id> [--steps] [--tail <lines>]
      Its transcript, last ${DEFAULT_LOG_TAIL_LINES} lines by default. Composes: \`${TASK_COMMAND.name} log t1 | rg error\`.
      \`--steps\` is the outline instead: what it set out to do, each call and how it ended, what it said, one line each and no tool output. Read this first to see what a task is doing; the transcript's tail is whatever printed last.
`,
});

async function runLog(input: SubcommandInput, context: TaskCommandContext) {
  const task = await requireChild(input.positional[0], context);
  const tailRaw = input.value("tail");
  const tail =
    tailRaw === undefined
      ? DEFAULT_LOG_TAIL_LINES
      : Number.parseInt(tailRaw, 10);
  if (!Number.isFinite(tail) || tail <= 0) {
    throw new Error("--tail takes a number of lines.");
  }
  const ref = { sessionId: task.id, taskId: task.chatId };
  const rendered = input.has("steps")
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
    input.has("steps") && isWorking(task.chatId, task.id)
      ? await stepInFlight(ref)
      : undefined;
  return `${header}${text}\n${inFlight ? `now: ${inFlight}\n` : ""}`;
}

async function renderTranscript({
  sessionId,
  taskId,
}: {
  sessionId: StoreId.Session;
  taskId: TaskId;
}) {
  // Loaded here rather than at the top: the renderer imports the tool registry,
  // which imports the bash tool, which imports this command, so a static import
  // would close a cycle that leaves the registry half-built when it is read.
  const { getSessionMarkdown } = await import("../../session-to-markdown");
  return getSessionMarkdown({
    includeContextMessages: false,
    sessionId,
    taskId,
  });
}
