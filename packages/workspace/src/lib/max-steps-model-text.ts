import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { systemNote } from "./system-note";

export function maxStepsModelNote(
  data: SessionMessageDataPart.MaxStepsDataPart,
) {
  return systemNote`
    The previous run stopped after reaching the maximum of ${String(data.maxStepCount)} unattended steps, not because the task was finished. Review what was done so far and continue the remaining work.
  `;
}
