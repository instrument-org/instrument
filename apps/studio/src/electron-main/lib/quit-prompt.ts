import { APP_NAME } from "@instrument-org/shared";
import { listRunningBackgroundProcesses } from "@instrument-org/workspace/electron";

/** Jobs named one per line before the rest are counted. */
const NAMED_JOBS_MAX = 5;

/** How much of a command stands in for a job the agent gave no label. */
const COMMAND_PREVIEW_MAX = 60;

/**
 * What each job still running in any chat is called: the agent's own label
 * for the call that started it, or the start of its command when it wrote
 * none.
 */
export function runningJobNames(): string[] {
  return listRunningBackgroundProcesses().map(
    ({ command, explanation }) =>
      explanation?.trim() ||
      (command.length > COMMAND_PREVIEW_MAX
        ? `${command.slice(0, COMMAND_PREVIEW_MAX).trimEnd()}…`
        : command),
  );
}

/**
 * The quit alert's words and its button, or nothing when quitting stops
 * nothing: the chats with an agent at work, counted, and every job a chat
 * left running, named so the person knows what goes with the app.
 */
export function quitPrompt({
  chatCount,
  jobNames,
}: {
  chatCount: number;
  jobNames: string[];
}): { confirm: string; detail: string; message: string } | undefined {
  if (chatCount === 0 && jobNames.length === 0) {
    return undefined;
  }
  const parts: string[] = [];
  if (chatCount > 0) {
    parts.push(
      chatCount === 1
        ? "Quitting stops what it's working on."
        : "Quitting stops what they're working on.",
    );
  }
  if (jobNames.length > 0) {
    const also = chatCount > 0 ? " also" : "";
    const lead =
      jobNames.length === 1
        ? `Quitting${also} stops this command, which is still running:`
        : `Quitting${also} stops these commands, which are still running:`;
    const named = jobNames.slice(0, NAMED_JOBS_MAX);
    const rest = jobNames.length - named.length;
    parts.push(
      [lead, ...named, ...(rest > 0 ? [`and ${rest} more`] : [])].join("\n"),
    );
  }
  return chatCount > 0
    ? {
        confirm: "Stop and Quit",
        detail: parts.join("\n\n"),
        message: `Stop ${chatCount.toString()} ${chatCount === 1 ? "chat" : "chats"} and quit?`,
      }
    : {
        confirm: "Quit",
        detail: parts.join("\n\n"),
        message: `Quit ${APP_NAME}?`,
      };
}
