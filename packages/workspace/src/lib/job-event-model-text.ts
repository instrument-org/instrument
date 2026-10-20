import ms from "ms";

import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import {
  FG_COMMAND,
  MAX_RUNNING_AGE_MS,
} from "./shell-commands/background-job-commands";
import { systemNote } from "./system-note";

type JobEvent = SessionMessageDataPart.JobEventDataPart["events"][number];

/**
 * The note a session is woken with when background processes it left running
 * end on their own: which ones, how each ended, and where its output is, since
 * nobody typed anything and the agent may be the only one who knows the user
 * is waiting on it.
 */
export function jobEventModelNote(
  data: SessionMessageDataPart.JobEventDataPart,
): string {
  const one = data.events.length === 1;
  const lines = data.events.map(
    (event) =>
      `- ${event.id} (\`${event.command}\`) ${howItEnded(event)} Read what it wrote with \`${FG_COMMAND.name} ${event.id}\`; all of it is in \`${event.logFilePath}\`.`,
  );
  return systemNote`
    ${one ? "A command you started has ended in the background:" : "Commands you started have ended in the background:"}
    ${lines.join("\n")}
    Nobody typed anything; this note is why you are awake. If the user was waiting on ${one ? "it" : "one of these"}, read its output and finish what they asked for. Otherwise tell them in a line what came of it.
  `;
}

function howItEnded(event: JobEvent): string {
  const after = ms(Math.max(1000, event.durationMs), { long: true });
  switch (event.status) {
    case "exited":
    case "failed": {
      return event.exitCode === undefined
        ? `failed after ${after}.`
        : `finished with exit code ${event.exitCode} after ${after}.`;
    }
    case "expired": {
      return `was stopped after ${after}, the most a background process may run (${ms(MAX_RUNNING_AGE_MS, { long: true })}). Nobody asked for it to stop and it did not fail; start it again only if the work still needs it.`;
    }
    case "killed": {
      return `ended without an exit code after ${after}.`;
    }
    case "termination-uncertain": {
      return `was stopped after ${after}, the most a background process may run (${ms(MAX_RUNNING_AGE_MS, { long: true })}), and did not confirm it exited; it may still be running.`;
    }
  }
}
