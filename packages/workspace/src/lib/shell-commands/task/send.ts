import {
  type SubcommandInput,
  type SubcommandShell,
  subcommand,
} from "../subcommands";
import { TASK_COMMAND } from "../task-command";
import { recordHandOff } from "../task-hand-off";
import { requireChild } from "./children";
import { type TaskCommandContext } from "./context";
import { deliver, promptFrom } from "./delivery";

export const sendSubcommand = subcommand<TaskCommandContext>({
  booleans: ["now"],
  run: runSend,
  usage: `  ${TASK_COMMAND.name} send <t id> [--now] <<'EOF'
  <message>
  EOF
      Deliver a message into a task: it runs now if idle; if busy, the task
      hears it at its next step. Follow-ups, corrections, answers to its
      questions. --now stops the step in flight and runs the message as its
      next turn: for a correction that makes the current work wrong, or a
      task whose latest step has run for minutes without a tool call. Same
      heredoc as \`new\`.
`,
});

async function runSend(
  input: SubcommandInput,
  context: TaskCommandContext,
  { stdin }: SubcommandShell,
) {
  const now = input.has("now");
  const task = await requireChild(input.positional[0], context);
  const prompt = promptFrom(input.positional.slice(1).join(" "), stdin);
  if (!prompt) {
    throw new Error(
      "send: a message is required, on stdin through a quoted heredoc.",
    );
  }
  const { running } = await deliver({
    command: "send",
    context,
    interrupt: now,
    prompt,
    task,
  });
  recordHandOff({ kind: "sent", taskId: task.id });
  const sent = running
    ? now
      ? `Sent to ${task.handle}. Its step in flight was stopped, and it takes this up as its next turn; you will be told when that turn finishes.`
      : `Sent to ${task.handle}. It is busy and will hear this at its next step; you will be told when its turn finishes. If its latest step has run for minutes without a tool call, \`send --now\` interrupts it.`
    : `Sent to ${task.handle}. It is running now; you will be told when it finishes.`;
  return `${sent}\n`;
}
