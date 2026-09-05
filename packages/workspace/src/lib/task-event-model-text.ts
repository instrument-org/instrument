import ms from "ms";

import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { TASK_COMMAND } from "./shell-commands/task-command";
import { systemNote } from "./system-note";

/**
 * The note that wakes an orchestrator: which of its tasks finished a turn,
 * what each cost, and where to read more. Points at the log rather than
 * inlining it, so a wake costs the same context whether the child wrote one
 * line or a thousand.
 */
export function taskEventModelNote(
  data: SessionMessageDataPart.TaskEventDataPart,
) {
  const lines = data.events.map((event) => {
    const outcome =
      event.status === "error" ? "stopped with an error" : "finished a turn";
    const spent = [
      event.activeMs === undefined
        ? undefined
        : `${ms(Math.max(1000, event.activeMs), { long: true })} of work`,
      event.tokens === undefined
        ? undefined
        : `${formatTokens(event.tokens)} tokens so far`,
    ].filter((part) => part !== undefined);
    const cost = spent.length > 0 ? ` (${spent.join(", ")})` : "";
    const summary = event.summary
      ? ` It last said: "${event.summary}"`
      : " It said nothing.";
    return `- ${event.taskId} ("${event.title}") ${outcome}${cost}.${summary}`;
  });

  return systemNote`
    ${data.events.length === 1 ? "A task you created has finished:" : "Tasks you created have finished:"}
    ${lines.join("\n")}
    Read the details with \`${TASK_COMMAND.name} log <id> --tail 60\` or \`${TASK_COMMAND.name} show <id>\` if the summary is not enough, then tell the user the outcome. If the task asked a question or stopped short, decide whether to answer it with \`${TASK_COMMAND.name} send\`, ask the user, or start over. Nobody typed anything; this note is why you are awake.
  `;
}

function formatTokens(tokens: number) {
  return tokens >= 1000
    ? `${(tokens / 1000).toFixed(tokens >= 10_000 ? 0 : 1)}K`
    : String(tokens);
}
