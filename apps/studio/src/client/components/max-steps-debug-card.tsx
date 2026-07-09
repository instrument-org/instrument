import {
  maxStepsModelNote,
  type SessionMessageDataPart,
} from "@instrument-org/workspace/client";

import { ModelContextDebugCard } from "./model-context-debug-card";

// Developer-mode-only peek at the max-steps stop recorded on this message. Shows
// the system note the model receives when the run resumes on the next user turn.
// Not user-facing; the "Resume the agent" alert is the user affordance.
export function MaxStepsDebugCard({
  className,
  data,
}: {
  className?: string;
  data: SessionMessageDataPart.MaxStepsDataPart;
}) {
  return (
    <ModelContextDebugCard
      className={className}
      text={maxStepsModelNote(data)}
    />
  );
}
