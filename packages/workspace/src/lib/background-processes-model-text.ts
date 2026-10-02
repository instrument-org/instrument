import ms from "ms";

import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import {
  FG_COMMAND,
  JOBS_COMMAND,
  KILL_COMMAND,
} from "./shell-commands/background-job-commands";
import { systemNote } from "./system-note";

export function backgroundProcessesModelNote(
  data: SessionMessageDataPart.BackgroundProcessesDataPart,
) {
  const lines: string[] = [];

  if (data.running.length > 0) {
    const listed = data.running
      .map(
        (process) =>
          `${process.id} (\`${process.command}\`), running ${ms(Math.max(1000, process.runningForMs), { long: true })}`,
      )
      .join("; ");
    lines.push(
      `Still running from earlier in this session: ${listed}. Do not start a second copy of any of these. Read one with \`${FG_COMMAND.name} <id>\`, list them with \`${JOBS_COMMAND.name}\`, and stop what is no longer needed with \`${KILL_COMMAND.name} <id>\`.`,
    );
  }

  if (data.ended.length > 0) {
    const listed = data.ended
      .map((process) => `${process.id} (\`${process.command}\`)`)
      .join("; ");
    // The correction. Earlier turns said these were running and that claim is
    // still sitting in the transcript, so silence would leave it standing.
    lines.push(
      `No longer running: ${listed}. Anything that depended on one of these -- a URL you gave the user, a watcher you assumed was rebuilding -- is no longer true. Start it again if the work needs it.`,
    );
  }

  return systemNote`
    ${lines.join("\n")}
  `;
}
