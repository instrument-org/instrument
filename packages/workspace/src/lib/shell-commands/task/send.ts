import { folderReach } from "../../chat/folder-reach";
import { mountAliases, toTaskPaths } from "../../chat/mount-paths";
import { taskDir } from "../../task-dir-utils";
import { getTaskState } from "../../task-record";
import {
  type SubcommandInput,
  type SubcommandShell,
  subcommand,
} from "../subcommands";
import { requireFilesNamedInBrief, resolveFileUploads } from "../task-args";
import { TASK_COMMAND } from "../task-command";
import { recordHandOff } from "../task-hand-off";
import { requireOwnChild } from "./children";
import { type TaskCommandContext } from "./context";
import { deliver, describeHold, promptFrom } from "./delivery";
import {
  chatLayout,
  chatPathsOf,
  filePaths,
  handedFiles,
  requireFoldersNamedInBriefHanded,
} from "./folders";

export const sendSubcommand = subcommand<TaskCommandContext>({
  booleans: ["now"],
  flags: ["file"],
  repeatable: ["file"],
  run: runSend,
  usage: `  ${TASK_COMMAND.name} send <id> [--now] [--file <path>]... <<'EOF'
  <message>
  EOF
      Deliver a message into a task: it runs now if idle; if busy, the task
      hears it at its next step; if still waiting to start, right after its
      brief once it starts. Follow-ups, corrections, answers to its
      questions. --now stops the step in flight and runs the message as its
      next turn: for a correction that makes the current work wrong, or a
      task whose latest step has run for minutes without a tool call. Same
      heredoc, and --file hands it a file the way \`new --file\` does.
`,
});

async function runSend(
  input: SubcommandInput,
  context: TaskCommandContext,
  { cwd, stdin }: SubcommandShell,
) {
  const now = input.has("now");
  const task = await requireOwnChild(input.positional[0], context);
  const prompt = promptFrom(input.positional.slice(1).join(" "), stdin);
  if (!prompt) {
    throw new Error(
      "send: a message is required, on stdin through a quoted heredoc.",
    );
  }
  const state = await getTaskState(taskDir(task.id));
  const chatFolders = await folderReach(context.chatId);
  const askedFiles = input.all("file");
  const layout = await chatLayout(context, chatFolders);
  await requireFilesNamedInBrief(prompt, askedFiles, { cwd, layout });
  const files = await resolveFileUploads(askedFiles, { cwd, layout });
  const aliases = mountAliases(chatFolders, state.attachedFolders ?? {});
  requireFoldersNamedInBriefHanded(
    "send",
    prompt,
    chatFolders,
    [...chatPathsOf(aliases), ...filePaths(askedFiles, cwd)],
    task.id,
  );
  const { held, message, running } = await deliver({
    command: "send",
    context,
    files,
    interrupt: now,
    // In the task's paths, as the brief that started it was.
    prompt: toTaskPaths(prompt, aliases),
    task,
  });
  if (!held) {
    recordHandOff({ kind: "sent", taskId: task.id });
  }
  const sent = held
    ? `Queued for ${task.id}, which has not started: ${describeHold(held)}. It hears this right after its brief once it starts; you will be told when it finishes.`
    : running
      ? now
        ? `Sent to ${task.id}. Its step in flight was stopped, and it takes this up as its next turn; you will be told when that turn finishes.`
        : `Sent to ${task.id}. It is busy and will hear this at its next step; you will be told when its turn finishes. If its latest step has run for minutes without a tool call, \`send --now\` interrupts it.`
      : `Sent to ${task.id}. It is running now; you will be told when it finishes.`;
  return `${sent}\n${handedFiles(message)}`;
}
