import { formatDistanceStrict } from "date-fns";

import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { systemNote } from "./system-note";

/**
 * Tells the model the user went away and came back.
 *
 * Says the gap and stops there. What it means for a promise left unstarted is
 * the agent's own instructions, the same way the date correction states a date
 * and leaves the rest alone.
 */
export function messageGapModelNote(
  data: SessionMessageDataPart.MessageGapDataPart,
) {
  // Two instants a fixed distance apart rather than a distance from now: the
  // words have to come out the same every time this message is rebuilt.
  const gap = formatDistanceStrict(
    new Date(data.minutes * 60_000),
    new Date(0),
  );

  return systemNote`
    The user last wrote in this channel about ${gap} ago. Anything since was you and your tasks.
  `;
}
