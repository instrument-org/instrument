import { ABOVE_REPLY_BOX } from "../../lib/screen-words";
import { type SessionMessageDataPart } from "../../schemas/session/message-data-part";

/**
 * What the agent reads about a command it asked to run as an administrator
 * (`bash` with `admin`): the call's result, and the note the person's answer
 * wakes it with.
 */

/** The call's result once the card is up. */
export const ADMIN_ASKED = `The user now sees a card ${ABOVE_REPLY_BOX} with this command. Their answer reaches you as a message of its own.`;

/** The call's result for a command the person refused since they last wrote. */
export const ADMIN_REFUSED_AGAIN =
  "The user already said no to this command in this turn. Ask them what they want instead.";

/** The call's result where no system prompt can run it. */
export const ADMIN_UNAVAILABLE =
  "Nothing ran: this computer has no way to run a command as an administrator. Give the user the steps in words, with the command to run themselves if one does it.";

/** The call's result for a command with sudo in it. */
export const ADMIN_NO_SUDO =
  "Nothing ran: leave sudo out. `admin` already runs the command as an administrator.";

/** The call's result for an admin command with no reason for the card. */
export const ADMIN_NEEDS_REASON =
  "Nothing ran: with `admin`, give a `reason`, one line saying what the command changes.";

/** The call's result for a command the card can't carry. */
export function adminTooLong(length: number, max: number): string {
  return `Nothing ran: the command is ${length} characters, and one run as an administrator takes at most ${max}. Split it into smaller steps.`;
}

/** What a refusal reads where the call came from a chat no card can show in. */
export const ADMIN_NO_CARD = "Nothing ran: nobody can answer a card here.";

/** What the person's no to an admin card, or a canceled system prompt, tells the agent. */
export const ADMIN_NOT_ALLOWED =
  "The user didn't allow this command, and nothing ran. Don't run it another way: give them a Markdown link that opens its page of the system's settings, as your system information shows, and say what to change there.";

/** The note an admin card's answer wakes the agent with, by how the run went. */
export function adminAnswerText(
  data: SessionMessageDataPart.PermissionAnswerDataPart,
): string {
  const { run } = data;
  if (data.answer === "declined" || run?.is === "canceled") {
    return ADMIN_NOT_ALLOWED;
  }
  switch (run?.is) {
    case "ran": {
      return `Ran as administrator. Exit code ${run.exitCode}.${run.output === "" ? "" : `\n${run.output}`}`;
    }
    case "failed": {
      return `The user allowed this command, but the system couldn't run it as an administrator: ${run.message}`;
    }
    default: {
      return "The app closed while this command waited to run as an administrator, so whether it ran is unknown. Check before asking to run it again.";
    }
  }
}
