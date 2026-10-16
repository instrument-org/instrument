import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { systemNote } from "./system-note";

/**
 * What the model is told on the turn that follows a run which ran out of room
 * to write every time it tried. The run already carried `LENGTH_NOTE` on each
 * continuation, so this note says the bound was reached rather than repeating
 * the advice.
 */
export function outputLimitModelNote(
  data: SessionMessageDataPart.OutputLimitDataPart,
) {
  return systemNote`
    The previous run was cut off at the output limit ${String(data.continuations + 1)} times in a row and stopped there, not because the task was finished. What was written is above. Pick up from where it stops, and write the rest in several short replies rather than one long one.
  `;
}
