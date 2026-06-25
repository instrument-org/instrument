import {
  attachedFolderRemovalsModelNote,
  type SessionMessageDataPart,
} from "@instrument-org/workspace/client";

import { ModelContextDebugCard } from "./model-context-debug-card";

// Developer-mode-only peek at the attached folders the agent was told were
// removed for this message. Intentionally minimal; not user-facing.
export function AttachedFolderChangesDebugCard({
  className,
  data,
}: {
  className?: string;
  data: SessionMessageDataPart.AttachedFolderChangesDataPart;
}) {
  const modelContext = attachedFolderRemovalsModelNote(data);
  if (!modelContext) {
    return null;
  }

  return <ModelContextDebugCard className={className} text={modelContext} />;
}
