import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { type SessionMessagePart } from "../schemas/session/message-part";

// Folds the frozen project-context snapshot together with any later
// `data-projectChanges` parts to produce the project context as it stands now.
// The snapshot (first message) seeds identity and instructions; each later
// change part that touched instructions overrides them, so the returned
// `instructions` is the effective value the agent should treat as current.
// Returns undefined for tasks not started from a project (no snapshot).
export function getEffectiveProjectContext(
  parts: SessionMessagePart.Type[],
): SessionMessageDataPart.ProjectContextDataPart | undefined {
  let snapshot: SessionMessageDataPart.ProjectContextDataPart | undefined;
  let instructions: string | undefined;

  for (const part of parts) {
    if (part.type === "data-projectContext") {
      snapshot = part.data;
      instructions = part.data.instructions;
    } else if (
      part.type === "data-projectChanges" &&
      part.data.instructionsChanged
    ) {
      instructions = part.data.instructions;
    }
  }

  if (!snapshot) {
    return undefined;
  }

  return { ...snapshot, instructions };
}
