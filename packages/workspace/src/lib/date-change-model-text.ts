import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { formatContextDate } from "./context-date";
import { systemNote } from "./system-note";

/**
 * Tells the model the session has crossed into a new day.
 *
 * The date in the session's system information is the day the session started
 * and is never rewritten, so this supersedes it rather than replacing it: a
 * conversation that ran overnight keeps a truthful record of when each turn
 * happened, and everything cached behind that snapshot stays cached.
 */
export function dateChangeModelNote(
  data: SessionMessageDataPart.DateChangeDataPart,
) {
  return systemNote`
    Today is now ${formatContextDate(data.date)}. This supersedes the current date in the system information above; that date is when this session began.
  `;
}
