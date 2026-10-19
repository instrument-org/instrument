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
 * The quit alert's words, or nothing when quitting stops nothing: agents in
 * the middle of a turn, and every job a chat left running, named so the
 * person knows what goes with the app.
 */
export function quitPrompt({
  agentCount,
  jobNames,
}: {
  agentCount: number;
  jobNames: string[];
}): { detail: string; message: string } | undefined {
  if (agentCount === 0 && jobNames.length === 0) {
    return undefined;
  }
  const parts: string[] = [];
  if (agentCount > 0) {
    parts.push(
      "Active tasks will be interrupted and you may lose in-progress work.",
    );
  }
  if (jobNames.length > 0) {
    const also = agentCount > 0 ? " also" : "";
    const lead =
      jobNames.length === 1
        ? `Quitting${also} stops this job, which is still running:`
        : `Quitting${also} stops these jobs, which are still running:`;
    const named = jobNames.slice(0, NAMED_JOBS_MAX);
    const rest = jobNames.length - named.length;
    parts.push(
      [lead, ...named, ...(rest > 0 ? [`and ${rest} more`] : [])].join("\n"),
    );
  }
  return { detail: parts.join("\n\n"), message: `Quit ${APP_NAME}?` };
}
